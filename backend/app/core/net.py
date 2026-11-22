"""
Outbound network safety (SSRF protection).

Company administrators can configure custom gateway URLs and SMTP hosts. Those destinations are
attacker-controllable input, so before the server connects anywhere on a tenant's behalf we:
  * accept only https:// URLs without embedded credentials,
  * resolve the host and refuse private, loopback, link-local, metadata and other non-public addresses,
  * connect to the exact IP that was validated (prevents DNS re-binding), and
  * never follow redirects.
"""
import asyncio
import ipaddress
import socket
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import SplitResult, urlsplit, urlunsplit

import httpx

from app.core.config import settings

ALLOWED_HTTPS_PORTS = {443, 8443}
ALLOWED_SMTP_PORTS = {25, 465, 587, 2525}
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class UnsafeDestination(ValueError):
    """Raised when an outbound destination is not allowed."""


def is_public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return bool(ip.is_global) and not ip.is_multicast


async def resolve_public_host(host: str, port: int) -> List[str]:
    """Returns the resolved addresses, or raises if the host is missing or resolves to a non-public address."""
    host = (host or "").strip().rstrip(".").lower()
    if not host or len(host) > 253:
        raise UnsafeDestination("Host name is missing or invalid.")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise UnsafeDestination("Host name could not be resolved.")
    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        raise UnsafeDestination("Host name could not be resolved.")
    if settings.ALLOW_PRIVATE_OUTBOUND and not settings.is_production:
        return addresses
    if any(not is_public_ip(addr) for addr in addresses):
        raise UnsafeDestination("Destination is not a public internet address.")
    return addresses


async def validate_public_url(url: str) -> Tuple[SplitResult, str, int]:
    """Validates a tenant supplied URL. Returns (parsed_url, pinned_ip, port)."""
    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        raise UnsafeDestination("URL is not valid.")
    if parts.scheme != "https":
        raise UnsafeDestination("Only https:// URLs are allowed.")
    if parts.username or parts.password:
        raise UnsafeDestination("URLs with embedded credentials are not allowed.")
    if not parts.hostname:
        raise UnsafeDestination("URL has no host name.")
    try:
        port = parts.port or 443
    except ValueError:
        raise UnsafeDestination("URL port is not valid.")
    if port not in ALLOWED_HTTPS_PORTS:
        raise UnsafeDestination("Only ports 443 and 8443 are allowed.")
    addresses = await resolve_public_host(parts.hostname, port)
    return parts, addresses[0], port


async def validate_smtp_host(host: str, port: int) -> str:
    if port not in ALLOWED_SMTP_PORTS:
        raise UnsafeDestination("SMTP port must be one of 25, 465, 587 or 2525.")
    return (await resolve_public_host(host, port))[0]


async def safe_request(
    method: str,
    url: str,
    *,
    json: Any = None,
    data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    """HTTP request to a tenant supplied URL, pinned to the validated IP and without redirects."""
    parts, ip, port = await validate_public_url(url)
    host = parts.hostname or ""
    literal = f"[{ip}]" if ":" in ip else ip
    pinned = urlunsplit(parts._replace(netloc=f"{literal}:{port}"))
    request_headers = {**(headers or {}), "Host": host if port == 443 else f"{host}:{port}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
        return await client.request(
            method, pinned, json=json, data=data, headers=request_headers,
            extensions={"sni_hostname": host},  # TLS certificate is still verified against the real host name
        )
