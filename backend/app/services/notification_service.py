import asyncio
import logging
import smtplib
import urllib.parse
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Dict, Any, List, Optional
import httpx
from app.models.tenant import Tenant
from app.models.user import User

logger = logging.getLogger("leadcrm.notifications")


def _generate_clean_temp_password(prefix: str = "Welcome") -> str:
    import secrets
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    suffix = "".join(secrets.choice(chars) for _ in range(6))
    return f"{prefix}@{suffix}"


class NotificationService:
    """
    Enterprise Notification Service for LeadCRM:
    - Multi-Channel: Email (SMTP / API), WhatsApp (Meta Cloud API / Twilio / Webhook), SMS
    - Tenant-Aware: Uses company's own configured gateway or safe simulation fallback
    - Reliable: Gracefully handles failures without crashing API endpoints
    """

    @staticmethod
    async def send_email(
        tenant: Optional[Tenant],
        to_email: str,
        subject: str,
        body_text: str,
        body_html: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Sends email using the tenant's EmailConfig (SMTP or API).
        If not configured, simulates and logs safely.
        """
        email_cfg = tenant.communication_settings.email if tenant and hasattr(tenant, "communication_settings") else None
        
        from_name = email_cfg.from_name if email_cfg and email_cfg.from_name else "LeadCRM"
        from_email = (
            (email_cfg.from_email if email_cfg and email_cfg.from_email else None)
            or (email_cfg.smtp_user if email_cfg and email_cfg.smtp_user else None)
            or "no-reply@leadcrm.travistas.in"
        )

        if not email_cfg or not email_cfg.is_enabled:
            logger.info(
                f"ℹ️ [SIMULATED EMAIL] To: {to_email} | Subject: '{subject}'\n"
                f"Notice: Tenant email settings not enabled. Configure SMTP/API in Settings > Communications.\n"
                f"Body Preview: {body_text[:200]}..."
            )
            return {
                "status": "simulated",
                "message": "Email logged to server console (SMTP/API not enabled in Settings).",
                "to": to_email,
                "subject": subject
            }

        # 1. Mode: SMTP
        if email_cfg.mode == "smtp":
            if not email_cfg.smtp_host or not email_cfg.smtp_user:
                return {
                    "status": "error",
                    "message": "SMTP host or username is missing in email settings.",
                    "to": to_email
                }

            def _smtp_send():
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = f"{from_name} <{from_email}>"
                msg["To"] = to_email

                part1 = MIMEText(body_text, "plain", "utf-8")
                msg.attach(part1)

                if body_html:
                    part2 = MIMEText(body_html, "html", "utf-8")
                    msg.attach(part2)

                port = email_cfg.smtp_port or 587
                if port == 465:
                    server = smtplib.SMTP_SSL(email_cfg.smtp_host, port, timeout=10)
                else:
                    server = smtplib.SMTP(email_cfg.smtp_host, port, timeout=10)
                    if email_cfg.smtp_use_tls:
                        server.starttls()

                if email_cfg.smtp_user and email_cfg.smtp_password:
                    server.login(email_cfg.smtp_user, email_cfg.smtp_password)

                server.sendmail(from_email, [to_email], msg.as_string())
                server.quit()

            try:
                await asyncio.to_thread(_smtp_send)
                logger.info(f"✅ [EMAIL SENT - SMTP] Successfully sent email to {to_email}")
                return {"status": "success", "provider": "smtp", "to": to_email}
            except Exception as e:
                logger.error(f"❌ [EMAIL FAILED - SMTP] Error sending to {to_email}: {str(e)}")
                return {"status": "error", "error": str(e), "to": to_email}

        # 2. Mode: API (SendGrid, Resend, or Custom HTTP)
        elif email_cfg.mode == "api":
            if not email_cfg.api_key:
                return {"status": "error", "message": "Email API Key is not configured.", "to": to_email}

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    if email_cfg.api_provider == "resend":
                        resp = await client.post(
                            "https://api.resend.com/emails",
                            headers={"Authorization": f"Bearer {email_cfg.api_key}", "Content-Type": "application/json"},
                            json={
                                "from": f"{from_name} <{from_email}>",
                                "to": [to_email],
                                "subject": subject,
                                "text": body_text,
                                "html": body_html or f"<p>{body_text}</p>"
                            }
                        )
                        if resp.status_code in [200, 201]:
                            return {"status": "success", "provider": "resend", "data": resp.json()}
                        else:
                            return {"status": "error", "code": resp.status_code, "detail": resp.text}

                    elif email_cfg.api_provider == "sendgrid":
                        resp = await client.post(
                            "https://api.sendgrid.com/v3/mail/send",
                            headers={"Authorization": f"Bearer {email_cfg.api_key}", "Content-Type": "application/json"},
                            json={
                                "personalizations": [{"to": [{"email": to_email}]}],
                                "from": {"email": from_email, "name": from_name},
                                "subject": subject,
                                "content": [
                                    {"type": "text/plain", "value": body_text},
                                    {"type": "text/html", "value": body_html or f"<p>{body_text}</p>"}
                                ]
                            }
                        )
                        if resp.status_code in [200, 202]:
                            return {"status": "success", "provider": "sendgrid"}
                        else:
                            return {"status": "error", "code": resp.status_code, "detail": resp.text}

                    else:
                        return {"status": "error", "message": f"Unsupported API provider '{email_cfg.api_provider}'"}
            except Exception as e:
                logger.error(f"❌ [EMAIL FAILED - API] Error sending to {to_email}: {str(e)}")
                return {"status": "error", "error": str(e), "to": to_email}

        return {"status": "error", "message": "Unknown email configuration"}

    @staticmethod
    async def send_whatsapp(
        tenant: Optional[Tenant],
        to_phone: str,
        message: str
    ) -> Dict[str, Any]:
        """
        Sends WhatsApp message via Meta Cloud API, Twilio, or Custom Webhook.
        Also returns a direct wa.me link as seamless instant fallback.
        """
        clean_phone = "".join(filter(str.isdigit, to_phone or ""))
        if len(clean_phone) == 10:
            clean_phone = f"91{clean_phone}"

        wa_link = f"https://wa.me/{clean_phone}?text={urllib.parse.quote(message)}"

        wa_cfg = tenant.communication_settings.whatsapp if tenant and hasattr(tenant, "communication_settings") else None

        if not wa_cfg or not wa_cfg.is_enabled:
            logger.info(
                f"ℹ️ [SIMULATED WHATSAPP] To: {clean_phone} | Message: {message[:120]}...\n"
                f"Direct Link: {wa_link}"
            )
            return {
                "status": "simulated",
                "message": "WhatsApp logged (API not enabled in Settings). Direct link generated.",
                "to_phone": clean_phone,
                "whatsapp_link": wa_link
            }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # 1. Meta WhatsApp Cloud API
                if wa_cfg.provider == "cloud_api":
                    if not wa_cfg.phone_number_id or not wa_cfg.access_token:
                        return {
                            "status": "error",
                            "message": "Meta Cloud API Phone Number ID or Access Token is missing.",
                            "whatsapp_link": wa_link
                        }

                    url = f"https://graph.facebook.com/v19.0/{wa_cfg.phone_number_id}/messages"
                    headers = {
                        "Authorization": f"Bearer {wa_cfg.access_token}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": clean_phone,
                        "type": "text",
                        "text": {"preview_url": True, "body": message}
                    }
                    resp = await client.post(url, headers=headers, json=payload)
                    if resp.status_code in [200, 201]:
                        return {"status": "success", "provider": "cloud_api", "data": resp.json(), "whatsapp_link": wa_link}
                    else:
                        logger.error(f"❌ [WHATSAPP ERROR] Meta API returned {resp.status_code}: {resp.text}")
                        return {"status": "error", "code": resp.status_code, "detail": resp.text, "whatsapp_link": wa_link}

                # 2. Twilio WhatsApp
                elif wa_cfg.provider == "twilio":
                    if not wa_cfg.account_sid or not wa_cfg.auth_token:
                        return {
                            "status": "error",
                            "message": "Twilio Account SID or Auth Token missing.",
                            "whatsapp_link": wa_link
                        }

                    url = f"https://api.twilio.com/2010-04-01/Accounts/{wa_cfg.account_sid}/Messages.json"
                    from_num = wa_cfg.from_phone_number or "whatsapp:+14155238886"
                    if not from_num.startswith("whatsapp:"):
                        from_num = f"whatsapp:{from_num}"

                    resp = await client.post(
                        url,
                        auth=(wa_cfg.account_sid, wa_cfg.auth_token),
                        data={
                            "From": from_num,
                            "To": f"whatsapp:+{clean_phone}",
                            "Body": message
                        }
                    )
                    if resp.status_code in [200, 201]:
                        return {"status": "success", "provider": "twilio", "whatsapp_link": wa_link}
                    else:
                        return {"status": "error", "code": resp.status_code, "detail": resp.text, "whatsapp_link": wa_link}

                # 3. Custom Webhook
                elif wa_cfg.provider == "custom_webhook":
                    if not wa_cfg.custom_webhook_url:
                        return {"status": "error", "message": "Custom Webhook URL missing.", "whatsapp_link": wa_link}

                    resp = await client.post(
                        wa_cfg.custom_webhook_url,
                        json={"to": clean_phone, "message": message}
                    )
                    return {"status": "success", "provider": "custom_webhook", "code": resp.status_code, "whatsapp_link": wa_link}

        except Exception as e:
            logger.error(f"❌ [WHATSAPP EXCEPTION] {str(e)}")
            return {"status": "error", "error": str(e), "whatsapp_link": wa_link}

        return {"status": "error", "message": "Unknown WhatsApp provider", "whatsapp_link": wa_link}

    @staticmethod
    async def send_sms(
        tenant: Optional[Tenant],
        to_phone: str,
        message: str
    ) -> Dict[str, Any]:
        """
        Sends SMS via Fast2SMS, MSG91, Twilio, or Custom HTTP endpoint.
        """
        clean_phone = "".join(filter(str.isdigit, to_phone or ""))
        sms_cfg = tenant.communication_settings.sms if tenant and hasattr(tenant, "communication_settings") else None

        if not sms_cfg or not sms_cfg.is_enabled:
            logger.info(f"ℹ️ [SIMULATED SMS] To: {clean_phone} | Message: {message[:100]}...")
            return {"status": "simulated", "message": "SMS logged (Gateway not enabled in Settings).", "to": clean_phone}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                if sms_cfg.provider == "fast2sms":
                    resp = await client.post(
                        "https://www.fast2sms.com/dev/bulkV2",
                        headers={"authorization": sms_cfg.api_key or ""},
                        json={
                            "route": sms_cfg.route or "q",
                            "message": message,
                            "numbers": clean_phone
                        }
                    )
                    return {"status": "success" if resp.status_code == 200 else "error", "data": resp.json()}

                elif sms_cfg.provider == "custom_http" and sms_cfg.custom_url:
                    formatted_url = (
                        sms_cfg.custom_url
                        .replace("{API_KEY}", sms_cfg.api_key or "")
                        .replace("{TO}", clean_phone)
                        .replace("{MESSAGE}", urllib.parse.quote(message))
                    )
                    resp = await client.get(formatted_url)
                    return {"status": "success" if resp.status_code in [200, 201] else "error", "code": resp.status_code}

        except Exception as e:
            logger.error(f"❌ [SMS EXCEPTION] {str(e)}")
            return {"status": "error", "error": str(e)}

        return {"status": "error", "message": "SMS provider not configured"}

    # =========================================================================
    # HIGH-LEVEL BUSINESS NOTIFICATIONS
    # =========================================================================

    @staticmethod
    async def notify_company_created(
        tenant: Tenant,
        admin_user: User,
        temp_password: str,
        portal_url: str = "https://leadcrm.travistas.in"
    ) -> Dict[str, Any]:
        """
        Triggered when Super Admin creates a company.
        Sends an onboarding email with credentials and temporary password.
        """
        subject = f"🎉 Welcome to LeadCRM - Account Created for {tenant.company_name}"
        
        body_text = (
            f"Dear {admin_user.full_name},\n\n"
            f"Congratulations! Your company '{tenant.company_name}' has been registered on LeadCRM.\n\n"
            f"Your Login Credentials:\n"
            f"----------------------------------------\n"
            f"Login URL: {portal_url}\n"
            f"Email ID: {admin_user.email}\n"
            f"Temporary Password: {temp_password}\n"
            f"Assigned Role: Company Administrator\n"
            f"User Quota: {tenant.max_users_limit} Users\n"
            f"Plan: {tenant.plan_name}\n"
            f"----------------------------------------\n\n"
            f"IMPORTANT SECURITY STEP:\n"
            f"When you log in for the first time, you will be prompted to set a new password in your profile.\n\n"
            f"Best Regards,\n"
            f"LeadCRM Platform Support\n"
            f"{portal_url}"
        )

        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="background: linear-gradient(135deg, #4f46e5, #06b6d4); padding: 20px; border-radius: 8px; text-align: center; color: #ffffff;">
                <h1 style="margin: 0; font-size: 24px;">Lead-to-Cash CRM</h1>
                <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Enterprise Lead Management & GST Billing</p>
            </div>
            
            <div style="padding: 24px 8px; color: #1e293b; line-height: 1.6;">
                <p style="font-size: 16px;">Dear <strong>{admin_user.full_name}</strong>,</p>
                <p>Welcome aboard! Your company <strong>{tenant.company_name}</strong> is now live on LeadCRM.</p>
                
                <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 18px; margin: 20px 0;">
                    <h3 style="margin: 0 0 12px 0; color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Your Corporate Login Credentials:</h3>
                    <p style="margin: 6px 0;"><strong>Portal URL:</strong> <a href="{portal_url}" style="color: #4f46e5; text-decoration: none;">{portal_url}</a></p>
                    <p style="margin: 6px 0;"><strong>Email Address:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{admin_user.email}</span></p>
                    <p style="margin: 6px 0;"><strong>Temporary Password:</strong> <span style="font-family: monospace; background: #fef08a; padding: 3px 8px; border-radius: 4px; font-weight: bold; color: #854d0e;">{temp_password}</span></p>
                    <p style="margin: 6px 0;"><strong>Role:</strong> Company Admin</p>
                    <p style="margin: 6px 0;"><strong>Team Seat Limit:</strong> {tenant.max_users_limit} Members</p>
                </div>

                <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
                    <strong style="color: #1e40af;">🔒 First-Time Login Notice:</strong>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #1e3a8a;">
                        For security reasons, upon your first login you will be guided to your <strong>Profile</strong> to replace this temporary password with your permanent private password.
                    </p>
                </div>

                <div style="text-align: center; margin: 28px 0;">
                    <a href="{portal_url}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                        Sign In to LeadCRM &rarr;
                    </a>
                </div>
            </div>

            <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; font-size: 11px; color: #64748b;">
                <p>This is an automated system email from LeadCRM. Please do not reply directly.</p>
            </div>
        </div>
        """

        return await NotificationService.send_email(
            tenant=tenant,
            to_email=admin_user.email,
            subject=subject,
            body_text=body_text,
            body_html=body_html
        )

    @staticmethod
    async def notify_team_member_created(
        tenant: Tenant,
        member_user: User,
        temp_password: str,
        portal_url: str = "https://leadcrm.travistas.in"
    ) -> Dict[str, Any]:
        """
        Triggered when Company Admin adds a user/staff.
        Sends email with login details and temporary password.
        """
        subject = f"👋 You have been invited to {tenant.company_name} on LeadCRM"
        role_label = member_user.role.replace('_', ' ').title()
        
        body_text = (
            f"Dear {member_user.full_name},\n\n"
            f"You have been added to the sales and operations team of '{tenant.company_name}' on LeadCRM.\n\n"
            f"Your Login Details:\n"
            f"----------------------------------------\n"
            f"Login URL: {portal_url}\n"
            f"Email ID: {member_user.email}\n"
            f"Temporary Password: {temp_password}\n"
            f"Role: {role_label}\n"
            f"Designation: {member_user.designation or 'Team Member'}\n"
            f"----------------------------------------\n\n"
            f"Please sign in and set your new permanent password in your Profile.\n\n"
            f"Best Regards,\n"
            f"{tenant.company_name} Team\n"
            f"{portal_url}"
        )

        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 20px; border-radius: 8px; text-align: center; color: #ffffff;">
                <h1 style="margin: 0; font-size: 22px;">{tenant.company_name}</h1>
                <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Sales Team Portal Invitation</p>
            </div>
            
            <div style="padding: 24px 8px; color: #1e293b; line-height: 1.6;">
                <p style="font-size: 16px;">Hello <strong>{member_user.full_name}</strong>,</p>
                <p>An account has been created for you at <strong>{tenant.company_name}</strong> on LeadCRM.</p>
                
                <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 18px; margin: 20px 0;">
                    <h3 style="margin: 0 0 12px 0; color: #334155; font-size: 14px; text-transform: uppercase;">Your Login Access:</h3>
                    <p style="margin: 6px 0;"><strong>Portal:</strong> <a href="{portal_url}" style="color: #059669; text-decoration: none;">{portal_url}</a></p>
                    <p style="margin: 6px 0;"><strong>Email:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{member_user.email}</span></p>
                    <p style="margin: 6px 0;"><strong>Temporary Password:</strong> <span style="font-family: monospace; background: #fef08a; padding: 3px 8px; border-radius: 4px; font-weight: bold; color: #854d0e;">{temp_password}</span></p>
                    <p style="margin: 6px 0;"><strong>Role:</strong> {role_label}</p>
                    {f'<p style="margin: 6px 0;"><strong>Designation:</strong> {member_user.designation}</p>' if member_user.designation else ''}
                </div>

                <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
                    <strong style="color: #065f46;">🔑 Password Setup on First Login:</strong>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #047857;">
                        When you sign in for the first time, please open your <strong>Profile</strong> and set a permanent personal password.
                    </p>
                </div>

                <div style="text-align: center; margin: 28px 0;">
                    <a href="{portal_url}" style="background-color: #059669; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                        Sign In Now &rarr;
                    </a>
                </div>
            </div>

            <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; font-size: 11px; color: #64748b;">
                <p>Sent by {tenant.company_name} via LeadCRM.</p>
            </div>
        </div>
        """

        return await NotificationService.send_email(
            tenant=tenant,
            to_email=member_user.email,
            subject=subject,
            body_text=body_text,
            body_html=body_html
        )

    @staticmethod
    async def notify_staff_pending_followups(
        tenant: Tenant,
        staff_user: User,
        pending_leads: List[Any],
        portal_url: str = "https://leadcrm.travistas.in"
    ) -> Dict[str, Any]:
        """
        Sends WhatsApp message to staff member detailing their pending follow-ups count & summary.
        """
        phone = staff_user.whatsapp_number or staff_user.phone
        if not phone:
            return {
                "status": "skipped",
                "message": f"Staff user '{staff_user.full_name}' does not have a phone or WhatsApp number configured.",
                "user_id": str(staff_user.id)
            }

        total_pending = len(pending_leads)
        if total_pending == 0:
            return {"status": "skipped", "message": "No pending follow-ups for this staff member."}

        # Build list preview (up to first 3 leads)
        preview_lines = []
        for i, lead in enumerate(pending_leads[:3]):
            name = getattr(lead, "full_name", "Customer")
            lead_phone = getattr(lead, "phone", "")
            fu = getattr(lead, "next_follow_up", None)
            fu_type = getattr(fu, "follow_up_type", "Call").upper() if fu else "CALL"
            preview_lines.append(f"{i+1}. {name} ({lead_phone}) - {fu_type}")

        preview_str = "\n".join(preview_lines)
        if total_pending > 3:
            preview_str += f"\n... aur {total_pending - 3} aur leads"

        message = (
            f"🔔 *LeadCRM Follow-up Reminder*\n\n"
            f"Namaste *{staff_user.full_name}* Ji! 👋\n"
            f"Aapke paas aaj *{total_pending} pending follow-up(s)* hain jin par customer ko connect karna hai:\n\n"
            f"{preview_str}\n\n"
            f"👉 CRM Dashboard check karein aur status update karein:\n"
            f"{portal_url}\n\n"
            f"_{tenant.company_name} Sales Operations_"
        )

        return await NotificationService.send_whatsapp(
            tenant=tenant,
            to_phone=phone,
            message=message
        )
