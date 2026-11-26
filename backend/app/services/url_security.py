"""
AnimeSync — URL Validation & SSRF Protection Service

Validates external media and subtitle URLs before storing or fetching:
- Restricts schemes to http:// and https://
- Blocks localhost, .local, .internal, loopback, private (RFC1918), link-local,
  multicast, and reserved IP ranges
- Supports optional DNS resolution check before server-side HTTP requests
"""
import ipaddress
import socket
from typing import Any, Dict
from urllib.parse import urlparse

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata.google.internal",
}


def detect_media_format(url: str) -> str:
    clean = (url or "").lower().split("?")[0].split("#")[0]
    if clean.endswith(".m3u8") or ".m3u8" in (url or "").lower():
        return "hls"
    if clean.endswith(".webm"):
        return "webm"
    if clean.endswith(".mp4") or clean.endswith(".m4v"):
        return "mp4"
    return "unknown"


def _is_disallowed_ip(ip_obj: ipaddress._BaseAddress) -> bool:
    return (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def validate_external_media_url(url: str, resolve_dns: bool = False) -> Dict[str, Any]:
    """
    Validates that an external media/subtitle URL is syntactically safe and does
    not target internal, loopback, or link-local network addresses (SSRF protection).
    """
    if not url or not isinstance(url, str):
        return {"valid": False, "error": "URL is required."}

    trimmed = url.strip()
    if len(trimmed) > 2000:
        return {"valid": False, "error": "URL exceeds maximum length (2000 characters)."}

    parsed = urlparse(trimmed)
    if parsed.scheme.lower() not in ("http", "https"):
        return {"valid": False, "error": "Only http:// and https:// URLs are permitted."}

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        return {"valid": False, "error": "URL must contain a valid hostname."}

    if (
        hostname in BLOCKED_HOSTNAMES
        or hostname.endswith(".local")
        or hostname.endswith(".internal")
        or hostname.endswith(".localhost")
    ):
        return {"valid": False, "error": "Internal or localhost URLs are not permitted."}

    # Check literal IP addresses
    try:
        ip_obj = ipaddress.ip_address(hostname)
        if _is_disallowed_ip(ip_obj):
            return {"valid": False, "error": "Private, loopback, or reserved IP addresses are not permitted."}
    except ValueError:
        # Hostname is a domain name
        if resolve_dns:
            try:
                infos = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
                for info in infos:
                    addr = info[4][0]
                    ip_obj = ipaddress.ip_address(addr)
                    if _is_disallowed_ip(ip_obj):
                        return {
                            "valid": False,
                            "error": "Target hostname resolves to a private or restricted IP address.",
                        }
            except socket.gaierror:
                return {"valid": False, "error": f"Could not resolve hostname '{hostname}'."}

    return {
        "valid": True,
        "url": trimmed,
        "format": detect_media_format(trimmed),
    }
