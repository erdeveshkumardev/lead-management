import logging
import re
import time
import uuid

from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.request_context import set_request_id

access_logger = logging.getLogger("app.access")
_REQ_ID_RE = re.compile(r"^[A-Za-z0-9\-_.]{8,64}$")
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
_WEBHOOK_TOKEN_RE = re.compile(r"(/webhooks/[a-z]+/[^/]+/)[^/]+")


def redact_path(path: str) -> str:
    """Webhook URLs carry a secret token as their last segment - it must never reach the logs."""
    return _WEBHOOK_TOKEN_RE.sub(r"\1[redacted]", path)


class SecurityHeadersMiddleware:
    """Adds OWASP recommended headers, request id and structured access logs to every response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        request_id = incoming if _REQ_ID_RE.match(incoming or "") else uuid.uuid4().hex
        set_request_id(request_id)
        path = scope.get("path", "")
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"server"]
                existing = {k.lower() for k, _ in headers}

                def add(name: str, value: str) -> None:
                    if name.encode() not in existing:
                        headers.append((name.encode(), value.encode()))

                add("x-request-id", request_id)
                add("x-content-type-options", "nosniff")
                add("x-frame-options", "DENY")
                add("referrer-policy", "no-referrer")
                add("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()")
                add("cross-origin-opener-policy", "same-origin")
                add("cross-origin-resource-policy", "same-site")
                add("x-permitted-cross-domain-policies", "none")
                if not path.startswith(_DOCS_PATHS):
                    add("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
                    add("cache-control", "no-store")
                if settings.is_production and settings.HSTS_MAX_AGE_SECONDS > 0:
                    # same policy as the web server (frontend/nginx-security-headers.conf). No "preload": that is
                    # a separate, hard-to-reverse decision for the whole domain.
                    add("strict-transport-security", f"max-age={settings.HSTS_MAX_AGE_SECONDS}; includeSubDomains")
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            if path not in ("/healthz", "/readyz"):
                access_logger.info(
                    "request method=%s path=%s status=%s duration_ms=%s request_id=%s",
                    scope.get("method"), redact_path(path), status_holder["status"], duration_ms, request_id,
                )


class BodySizeLimitMiddleware:
    """Rejects request bodies larger than MAX_REQUEST_BODY_BYTES (protects against memory exhaustion)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    await self._reject(send)
                    return
            except ValueError:
                await self._reject(send, 400, b'{"detail":"Invalid Content-Length"}')
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await self._reject(send)

    @staticmethod
    async def _reject(send: Send, status: int = 413, body: bytes = b'{"detail":"Request body too large"}') -> None:
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class _BodyTooLarge(Exception):
    pass


class PublicWebhookCORSMiddleware:
    """
    Website lead-capture forms are posted by browsers from the customers' own websites, so that single
    endpoint must answer cross-origin requests. It never uses cookies or credentials, therefore a
    wildcard origin is safe here; every other route keeps the strict application CORS policy.
    """

    def __init__(self, app: ASGIApp, path_prefix: str) -> None:
        self.app = app
        self.prefix = path_prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.prefix):
            await self.app(scope, receive, send)
            return
        cors = [
            (b"access-control-allow-origin", b"*"),
            (b"access-control-allow-methods", b"POST, OPTIONS"),
            (b"access-control-allow-headers", b"Content-Type, X-Webhook-Token"),
            (b"access-control-max-age", b"600"),
        ]
        if scope.get("method") == "OPTIONS":
            await send({"type": "http.response.start", "status": 204, "headers": cors + [(b"content-length", b"0")]})
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if not k.lower().startswith(b"access-control-")]
                message["headers"] = headers + cors[:1]
            await send(message)

        await self.app(scope, receive, send_wrapper)


class ProbeAwareTrustedHostMiddleware(TrustedHostMiddleware):
    """
    Host-header allow-list (blocks Host-header injection, e.g. poisoned links in e-mails or caches),
    with one exception: the health endpoints.

    Kubernetes and Docker call /healthz and /readyz on the container's own address, so the Host header
    is the pod IP and can never be on the allow-list. Those two endpoints only return a fixed status.
    """

    PROBE_PATHS = frozenset({"/healthz", "/readyz"})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") in self.PROBE_PATHS:
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)
