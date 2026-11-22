"""Platform mail relay (configured by the operator through SMTP_* environment variables) and SMTP helpers."""
import asyncio
import logging
import smtplib
import socket
import ssl
from email.message import EmailMessage
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("app.email")


class PinnedSMTP(smtplib.SMTP):
    """SMTP client that connects to an already validated IP while TLS is still verified against the host name."""

    def __init__(self, pinned_ip: str, *args, **kwargs):
        self._pinned_ip = pinned_ip
        super().__init__(*args, **kwargs)

    def _get_socket(self, host, port, timeout):
        return socket.create_connection((self._pinned_ip, port), timeout, self.source_address)


class PinnedSMTPSSL(smtplib.SMTP_SSL):
    def __init__(self, pinned_ip: str, *args, **kwargs):
        self._pinned_ip = pinned_ip
        super().__init__(*args, **kwargs)

    def _get_socket(self, host, port, timeout):
        sock = socket.create_connection((self._pinned_ip, port), timeout, self.source_address)
        return self.context.wrap_socket(sock, server_hostname=self._host)


def build_message(sender: str, to: str, subject: str, body_text: str, body_html: Optional[str] = None) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body_text)
    if body_html:
        message.add_alternative(body_html, subtype="html")
    return message


def _send_sync(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.SMTP_PORT == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15, context=context)
    else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15)
        if settings.SMTP_USE_TLS:
            server.starttls(context=context)
    try:
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
        server.send_message(message)
    finally:
        try:
            server.quit()
        except Exception:
            pass


async def send_email(to: str, subject: str, body_text: str, body_html: Optional[str] = None) -> bool:
    """Sends through the platform relay. Returns False (never raises) when not configured or on failure."""
    if not settings.smtp_enabled:
        logger.warning("Platform e-mail relay is not configured (SMTP_HOST / SMTP_FROM); message not sent.")
        return False
    try:
        await asyncio.to_thread(_send_sync, build_message(settings.SMTP_FROM, to, subject, body_text, body_html))
        return True
    except Exception as exc:
        logger.error("Platform e-mail delivery failed (%s)", type(exc).__name__)
        return False
