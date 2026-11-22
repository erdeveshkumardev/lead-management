"""
Multi-channel notifications (Email, WhatsApp, SMS) using each company's own gateway settings.

Security notes
  * gateway credentials are stored encrypted and only decrypted here, at the moment of use
  * tenant supplied URLs / SMTP hosts go through app.core.net (SSRF protection, no redirects)
  * message bodies and credentials are never written to logs; provider error details stay server-side
  * every user supplied value placed in an HTML e-mail is escaped
"""
import asyncio
import logging
import smtplib
import ssl
import urllib.parse
from email.utils import formataddr
from html import escape
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings
from app.core.crypto import decrypt_str
from app.core.net import UnsafeDestination, safe_request, validate_smtp_host
from app.models.tenant import Tenant
from app.models.user import User
from app.services import email_service

logger = logging.getLogger("app.notifications")
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _digits(phone: Optional[str]) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    return f"91{digits}" if len(digits) == 10 else digits


def _portal_url() -> str:
    return settings.FRONTEND_BASE_URL.rstrip("/")


def _error(message: str, **extra: Any) -> Dict[str, Any]:
    return {"status": "error", "message": message, **extra}


class NotificationService:
    # ------------------------------------------------------------------ e-mail
    @staticmethod
    async def send_email(tenant: Optional[Tenant], to_email: str, subject: str, body_text: str,
                         body_html: Optional[str] = None) -> Dict[str, Any]:
        """Company gateway first, then the platform SMTP relay. Never raises."""
        cfg = tenant.communication_settings.email if tenant else None
        if cfg and cfg.is_enabled:
            try:
                if cfg.mode == "api":
                    return await NotificationService._send_email_api(cfg, to_email, subject, body_text, body_html)
                return await NotificationService._send_email_smtp(cfg, to_email, subject, body_text, body_html)
            except UnsafeDestination as exc:
                return _error(f"E-mail gateway rejected: {exc}", to=to_email)
            except Exception as exc:
                logger.warning("E-mail delivery failed via company gateway (%s)", type(exc).__name__)
                return _error("E-mail could not be delivered. Check the gateway settings and credentials.", to=to_email)

        if settings.smtp_enabled:
            sent = await email_service.send_email(to_email, subject, body_text, body_html)
            if sent:
                return {"status": "success", "provider": "platform_smtp", "to": to_email}
            return _error("E-mail could not be delivered by the platform mail relay.", to=to_email)

        return {"status": "not_configured", "to": to_email,
                "message": "E-mail is not configured. Enable an e-mail gateway under Settings > Communications."}

    @staticmethod
    async def _send_email_smtp(cfg, to_email: str, subject: str, body_text: str, body_html: Optional[str]) -> Dict[str, Any]:
        if not cfg.smtp_host or not cfg.smtp_user:
            return _error("SMTP host or username is missing in the e-mail settings.", to=to_email)
        port = int(cfg.smtp_port or 587)
        if port != 465 and not cfg.smtp_use_tls:
            return _error("TLS must be enabled for SMTP so that the mailbox password is never sent in clear text.", to=to_email)
        ip = await validate_smtp_host(cfg.smtp_host, port)
        password = decrypt_str(cfg.smtp_password)
        from_email = cfg.from_email or cfg.smtp_user

        message = email_service.build_message(
            formataddr((cfg.from_name or "LeadCRM", from_email)), to_email, subject, body_text, body_html)
        host = cfg.smtp_host.strip()

        def _send() -> None:
            # connect to the validated IP; the TLS certificate is still verified against the configured host name
            context = ssl.create_default_context()
            if port == 465:
                server: smtplib.SMTP = email_service.PinnedSMTPSSL(ip, host, port, timeout=10, context=context)
            else:
                server = email_service.PinnedSMTP(ip, host, port, timeout=10)
                if cfg.smtp_use_tls:
                    server.starttls(context=context)
            try:
                if cfg.smtp_user and password:
                    server.login(cfg.smtp_user, password)
                server.send_message(message)
            finally:
                try:
                    server.quit()
                except Exception:
                    pass

        await asyncio.to_thread(_send)
        return {"status": "success", "provider": "smtp", "to": to_email}

    @staticmethod
    async def _send_email_api(cfg, to_email: str, subject: str, body_text: str, body_html: Optional[str]) -> Dict[str, Any]:
        api_key = decrypt_str(cfg.api_key)
        if not api_key:
            return _error("E-mail API key is not configured.", to=to_email)
        from_email = cfg.from_email or cfg.smtp_user
        if not from_email:
            return _error("A 'From' e-mail address is required in the e-mail settings.", to=to_email)
        from_name = cfg.from_name or "LeadCRM"
        html = body_html or f"<p>{escape(body_text)}</p>"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            if cfg.api_provider == "resend":
                resp = await client.post("https://api.resend.com/emails", headers=headers, json={
                    "from": formataddr((from_name, from_email)), "to": [to_email], "subject": subject,
                    "text": body_text, "html": html})
                ok = resp.status_code in (200, 201)
            elif cfg.api_provider == "sendgrid":
                resp = await client.post("https://api.sendgrid.com/v3/mail/send", headers=headers, json={
                    "personalizations": [{"to": [{"email": to_email}]}],
                    "from": {"email": from_email, "name": from_name}, "subject": subject,
                    "content": [{"type": "text/plain", "value": body_text}, {"type": "text/html", "value": html}]})
                ok = resp.status_code in (200, 202)
            else:
                return _error("Unsupported e-mail API provider. Choose SendGrid or Resend.", to=to_email)
        if ok:
            return {"status": "success", "provider": cfg.api_provider, "to": to_email}
        logger.warning("E-mail API %s returned status %s", cfg.api_provider, resp.status_code)
        return _error(f"The e-mail provider rejected the request (HTTP {resp.status_code}).", to=to_email)

    # ------------------------------------------------------------------ WhatsApp
    @staticmethod
    async def send_whatsapp(tenant: Optional[Tenant], to_phone: str, message: str) -> Dict[str, Any]:
        """Sends through the configured provider. Always returns a wa.me link as a manual fallback."""
        phone = _digits(to_phone)
        if len(phone) < 8:
            return _error("Recipient phone number is not valid.")
        wa_link = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"
        cfg = tenant.communication_settings.whatsapp if tenant else None
        if not cfg or not cfg.is_enabled:
            return {"status": "simulated", "to_phone": phone, "whatsapp_link": wa_link,
                    "message": "WhatsApp API is not enabled. Use the link to send the message manually."}
        try:
            if cfg.provider == "cloud_api":
                token = decrypt_str(cfg.access_token)
                phone_id = (cfg.phone_number_id or "").strip()
                if not phone_id.isdigit() or not token:
                    return _error("Meta Cloud API Phone Number ID or Access Token is missing.", whatsapp_link=wa_link)
                url = f"https://graph.facebook.com/{settings.META_GRAPH_API_VERSION}/{phone_id}/messages"
                async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
                    resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json={
                        "messaging_product": "whatsapp", "recipient_type": "individual", "to": phone,
                        "type": "text", "text": {"preview_url": False, "body": message}})
            elif cfg.provider == "twilio":
                sid = (cfg.account_sid or "").strip()
                token = decrypt_str(cfg.auth_token)
                if not sid.isalnum() or not token:
                    return _error("Twilio Account SID or Auth Token is missing.", whatsapp_link=wa_link)
                sender = cfg.from_phone_number or ""
                if not sender:
                    return _error("Twilio WhatsApp sender number is missing.", whatsapp_link=wa_link)
                if not sender.startswith("whatsapp:"):
                    sender = f"whatsapp:{sender}"
                url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
                async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
                    resp = await client.post(url, auth=(sid, token),
                                             data={"From": sender, "To": f"whatsapp:+{phone}", "Body": message})
            elif cfg.provider == "custom_webhook":
                if not cfg.custom_webhook_url:
                    return _error("Custom webhook URL is missing.", whatsapp_link=wa_link)
                resp = await safe_request("POST", cfg.custom_webhook_url, json={"to": phone, "message": message})
            else:
                return _error("Unknown WhatsApp provider.", whatsapp_link=wa_link)
        except UnsafeDestination as exc:
            return _error(f"WhatsApp gateway rejected: {exc}", whatsapp_link=wa_link)
        except Exception as exc:
            logger.warning("WhatsApp delivery failed (%s)", type(exc).__name__)
            return _error("WhatsApp message could not be sent. Check the gateway settings.", whatsapp_link=wa_link)

        if resp.status_code in (200, 201, 202):
            return {"status": "success", "provider": cfg.provider, "to_phone": phone, "whatsapp_link": wa_link}
        logger.warning("WhatsApp provider %s returned status %s", cfg.provider, resp.status_code)
        return _error(f"The WhatsApp provider rejected the request (HTTP {resp.status_code}).", whatsapp_link=wa_link)

    # ------------------------------------------------------------------ SMS
    @staticmethod
    async def send_sms(tenant: Optional[Tenant], to_phone: str, message: str) -> Dict[str, Any]:
        phone = "".join(c for c in (to_phone or "") if c.isdigit())
        if len(phone) < 8:
            return _error("Recipient phone number is not valid.")
        cfg = tenant.communication_settings.sms if tenant else None
        if not cfg or not cfg.is_enabled:
            return {"status": "not_configured", "to": phone,
                    "message": "SMS gateway is not enabled. Configure it under Settings > Communications."}
        api_key = decrypt_str(cfg.api_key) or ""
        try:
            if cfg.provider == "fast2sms":
                if not api_key:
                    return _error("Fast2SMS API key is missing.")
                async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
                    resp = await client.post("https://www.fast2sms.com/dev/bulkV2", headers={"authorization": api_key},
                                             json={"route": cfg.route or "q", "message": message, "numbers": phone[-10:]})
            elif cfg.provider == "custom_http" and cfg.custom_url:
                url = (cfg.custom_url
                       .replace("{API_KEY}", urllib.parse.quote(api_key, safe=""))
                       .replace("{TO}", urllib.parse.quote(phone, safe=""))
                       .replace("{MESSAGE}", urllib.parse.quote(message, safe="")))
                resp = await safe_request("GET", url)
            else:
                return _error("SMS provider is not configured.")
        except UnsafeDestination as exc:
            return _error(f"SMS gateway rejected: {exc}")
        except Exception as exc:
            logger.warning("SMS delivery failed (%s)", type(exc).__name__)
            return _error("SMS could not be sent. Check the gateway settings.")
        if resp.status_code in (200, 201, 202):
            return {"status": "success", "provider": cfg.provider, "to": phone}
        return _error(f"The SMS provider rejected the request (HTTP {resp.status_code}).")

    # ------------------------------------------------------------------ business notifications
    @staticmethod
    def _credentials_email(*, heading: str, subheading: str, accent: str, greeting_name: str, intro_html: str,
                           rows: List[tuple], notice: str) -> str:
        portal = escape(_portal_url())
        details = "".join(
            f'<p style="margin:6px 0;"><strong>{escape(label)}:</strong> '
            f'<span style="font-family:monospace;background:{"#fef08a" if highlight else "#e2e8f0"};'
            f'padding:2px 6px;border-radius:4px;">{escape(str(value))}</span></p>'
            for label, value, highlight in rows
        )
        return f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
  <div style="background:{accent};padding:20px;border-radius:8px;text-align:center;color:#ffffff;">
    <h1 style="margin:0;font-size:22px;">{escape(heading)}</h1>
    <p style="margin:4px 0 0 0;font-size:13px;opacity:0.9;">{escape(subheading)}</p>
  </div>
  <div style="padding:24px 8px;color:#1e293b;line-height:1.6;">
    <p style="font-size:16px;">Dear <strong>{escape(greeting_name)}</strong>,</p>
    <p>{intro_html}</p>
    <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;padding:18px;margin:20px 0;">
      <p style="margin:6px 0;"><strong>Portal:</strong> <a href="{portal}" style="color:#4f46e5;text-decoration:none;">{portal}</a></p>
      {details}
    </div>
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px 16px;border-radius:4px;margin-bottom:24px;font-size:13px;color:#1e3a8a;">
      {escape(notice)}
    </div>
    <div style="text-align:center;margin:28px 0;">
      <a href="{portal}" style="background:#4f46e5;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;">Sign In</a>
    </div>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;font-size:11px;color:#64748b;">
    <p>This is an automated e-mail. If you were not expecting it, please ignore it and inform your administrator.</p>
  </div>
</div>"""

    @staticmethod
    def _temp_password_notice() -> str:
        days = settings.TEMP_PASSWORD_VALID_DAYS
        return (f"This temporary password works once: at first sign-in you must choose your own private password. "
                f"It expires in {days} day(s). Never share your password with anyone.")

    @staticmethod
    async def notify_company_created(tenant: Tenant, admin_user: User, temp_password: str) -> Dict[str, Any]:
        """Welcome e-mail for a new company administrator (sent through the platform relay)."""
        portal = _portal_url()
        notice = NotificationService._temp_password_notice()
        text = (
            f"Dear {admin_user.full_name},\n\n"
            f"Your company '{tenant.company_name}' has been registered on {settings.PROJECT_NAME}.\n\n"
            f"Login URL: {portal}\nEmail ID: {admin_user.email}\nTemporary Password: {temp_password}\n"
            f"Role: Company Administrator\nUser Quota: {tenant.max_users_limit} users\nPlan: {tenant.plan_name}\n\n"
            f"{notice}\n\nRegards,\nPlatform Support\n"
        )
        html = NotificationService._credentials_email(
            heading=settings.PROJECT_NAME, subheading="Your company workspace is ready",
            accent="linear-gradient(135deg,#4f46e5,#06b6d4)", greeting_name=admin_user.full_name,
            intro_html=f"Welcome aboard! Your company <strong>{escape(tenant.company_name)}</strong> is now live.",
            rows=[("Email", admin_user.email, False), ("Temporary Password", temp_password, True),
                  ("Role", "Company Admin", False), ("Team Seat Limit", f"{tenant.max_users_limit} members", False)],
            notice=notice,
        )
        return await NotificationService.send_email(
            None, str(admin_user.email), f"Welcome to {settings.PROJECT_NAME} - account created for {tenant.company_name}",
            text, html)

    @staticmethod
    async def notify_team_member_created(tenant: Tenant, member_user: User, temp_password: str) -> Dict[str, Any]:
        portal = _portal_url()
        role = member_user.role.replace("_", " ").title()
        notice = NotificationService._temp_password_notice()
        text = (
            f"Dear {member_user.full_name},\n\n"
            f"You have been added to the team of '{tenant.company_name}'.\n\n"
            f"Login URL: {portal}\nEmail ID: {member_user.email}\nTemporary Password: {temp_password}\n"
            f"Role: {role}\nDesignation: {member_user.designation or 'Team Member'}\n\n{notice}\n\n"
            f"Regards,\n{tenant.company_name}\n"
        )
        rows = [("Email", member_user.email, False), ("Temporary Password", temp_password, True), ("Role", role, False)]
        if member_user.designation:
            rows.append(("Designation", member_user.designation, False))
        html = NotificationService._credentials_email(
            heading=tenant.company_name, subheading="Sales team portal invitation",
            accent="linear-gradient(135deg,#059669,#10b981)", greeting_name=member_user.full_name,
            intro_html=f"An account has been created for you at <strong>{escape(tenant.company_name)}</strong>.",
            rows=rows, notice=notice,
        )
        return await NotificationService.send_email(
            tenant, str(member_user.email), f"You have been invited to {tenant.company_name}", text, html)

    @staticmethod
    async def notify_staff_pending_followups(tenant: Tenant, staff_user: User, pending_leads: List[Any]) -> Dict[str, Any]:
        """WhatsApp reminder to a team member about their pending follow-ups."""
        if not staff_user.receive_whatsapp_notifications:
            return {"status": "skipped", "message": f"{staff_user.full_name} has switched off WhatsApp notifications."}
        phone = staff_user.whatsapp_number or staff_user.phone
        if not phone:
            return {"status": "skipped", "message": f"{staff_user.full_name} has no phone / WhatsApp number on their profile."}
        total = len(pending_leads)
        if total == 0:
            return {"status": "skipped", "message": "No pending follow-ups for this team member."}

        lines = []
        for idx, lead in enumerate(pending_leads[:3], start=1):
            follow_up = lead.get("next_follow_up") if isinstance(lead, dict) else getattr(lead, "next_follow_up", None)
            kind = (follow_up.get("follow_up_type") if isinstance(follow_up, dict) else getattr(follow_up, "follow_up_type", None)) or "call"
            name = lead.get("full_name") if isinstance(lead, dict) else getattr(lead, "full_name", "Customer")
            lead_phone = lead.get("phone") if isinstance(lead, dict) else getattr(lead, "phone", "")
            lines.append(f"{idx}. {name} ({lead_phone}) - {str(kind).upper()}")
        preview = "\n".join(lines)
        if total > 3:
            preview += f"\n... aur {total - 3} aur leads"

        message = (
            f"🔔 *LeadCRM Follow-up Reminder*\n\n"
            f"Namaste *{staff_user.full_name}* Ji! 👋\n"
            f"Aapke paas aaj *{total} pending follow-up(s)* hain jin par customer ko connect karna hai:\n\n"
            f"{preview}\n\n"
            f"👉 CRM Dashboard check karein aur status update karein:\n{_portal_url()}\n\n"
            f"_{tenant.company_name} Sales Operations_"
        )
        return await NotificationService.send_whatsapp(tenant, phone, message)
