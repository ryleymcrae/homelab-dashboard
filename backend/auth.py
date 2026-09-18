"""
Shared-password authentication.

This is a single-operator LAN tool, not a multi-tenant service, so there
is deliberately no user system -- one operator password, set via the
DASHBOARD_PASSWORD environment variable (never config.yml; see
docs/security.md on keeping secrets out of version-controlled config).
If that variable is unset, auth is disabled entirely and every request is
treated as authenticated -- unchanged behavior from before this module
existed, so existing installs are never surprised by a new login screen.

`auth.trusted_ips` in config.yml (IPs/CIDRs) skip login entirely -- meant
for a kiosk touchscreen that should never show a login prompt while any
other browser on the LAN still has to authenticate. Session tokens are
HMAC-signed with a key derived from the password itself, so changing the
password invalidates every existing session without needing a separate
secret file to provision or persist.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import time
from typing import Optional

SESSION_COOKIE = "dashboard_session"
SESSION_LIFETIME_SECONDS = 30 * 86400  # 30 days -- long enough a kiosk browser never expires mid-use


def get_password() -> Optional[str]:
    """Read at call time (not import time) so tests can set/unset the env
    var per-case without reloading this module."""
    return os.environ.get("DASHBOARD_PASSWORD") or None


def auth_enabled() -> bool:
    return get_password() is not None


def _secret_key(password: str) -> bytes:
    return hashlib.sha256(f"homelab-dashboard-session:{password}".encode()).digest()


def issue_session_token() -> str:
    password = get_password()
    if password is None:
        raise RuntimeError("cannot issue a session token when auth is disabled")
    expires_at = int(time.time()) + SESSION_LIFETIME_SECONDS
    payload = str(expires_at)
    signature = hmac.new(_secret_key(password), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify_session_token(token: Optional[str]) -> bool:
    password = get_password()
    if password is None:
        return True
    if not token or "." not in token:
        return False
    payload, _, signature = token.partition(".")
    expected = hmac.new(_secret_key(password), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        expires_at = int(payload)
    except ValueError:
        return False
    return time.time() < expires_at


def verify_password(candidate: str) -> bool:
    password = get_password()
    if password is None:
        return True
    return hmac.compare_digest(candidate, password)


def _parse_trusted_ips(trusted_ips: list[str]) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    networks = []
    for entry in trusted_ips:
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            continue  # invalid entries are already rejected at config validation time; defense in depth here
    return networks


def is_trusted_ip(client_ip: Optional[str], trusted_ips: list[str]) -> bool:
    if not client_ip or not trusted_ips:
        return False
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    return any(addr in net for net in _parse_trusted_ips(trusted_ips))


def client_ip_from_headers(client_host: Optional[str], forwarded_for: Optional[str]) -> Optional[str]:
    """Prefer X-Forwarded-For, set only by this project's own nginx (see
    deploy/nginx.conf) sitting directly in front of the backend on an
    internal Docker network -- not attacker-controlled in the shipped
    deployment. Falls back to the direct connection's address for
    bare-metal/dev runs with no proxy in front."""
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return client_host


def is_authenticated(client_ip: Optional[str], trusted_ips: list[str], session_token: Optional[str]) -> bool:
    if not auth_enabled():
        return True
    if is_trusted_ip(client_ip, trusted_ips):
        return True
    return verify_session_token(session_token)


def is_admin(session_token: Optional[str]) -> bool:
    """Whether this request presents a real, password-verified admin
    session -- unlike is_authenticated()/verify_session_token(), this
    does NOT treat "no password configured" or a trusted IP as admin.
    Guest mode (AppConfig.guest_mode) needs to know whether someone has
    actually proven identity via the password, not just whether viewing
    happens to be open right now. Trusted IPs deliberately don't count:
    that bypasses the login wall for kiosk *viewing*, not an admin grant
    -- a kiosk in guest mode must still require a real login to act,
    even though it never sees a login wall to view. Without a password
    configured at all, this always returns False -- there is nothing to
    authenticate against, so guest mode simply blocks every action until
    one is set (see AppConfig.guest_mode's docstring)."""
    if get_password() is None:
        return False
    return verify_session_token(session_token)


def describe_actor(client_ip: Optional[str], trusted_ips: list[str], session_token: Optional[str]) -> str:
    """The most specific "who did this" available today, for the audit
    log (backend/persistence/audit.py) -- there's no per-user login, so
    this is IP plus how the request got in, e.g. "trusted:192.168.1.50"
    or "session:192.168.1.20". Swapping in a real username once
    multi-user accounts exist is a change to this function alone; the
    audit log schema and every call site stay the same."""
    ip = client_ip or "unknown"
    if not auth_enabled():
        return f"open:{ip}"
    if is_trusted_ip(client_ip, trusted_ips):
        return f"trusted:{ip}"
    if verify_session_token(session_token):
        return f"session:{ip}"
    return f"unauthenticated:{ip}"
