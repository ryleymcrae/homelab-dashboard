"""
The notifier contract.

Mirrors backend/providers/base.py's shape deliberately: one abstract
interface, one concrete class per real-world integration (Discord, ntfy,
Pushover, generic webhook), selected by `NotifierConfig.type`
(backend/config/schema.py) through `build_notifier()` below -- the one
place that maps a type string to a class, same role as
backend/adapters/factory.py.

Every notifier makes a real HTTP request. Secrets (webhook URLs, API
tokens) come from the environment variables config.yml names
(docs/security.md), are read at send time, and never appear in a
result message or log line -- a Discord webhook URL *is* its credential.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from backend.adapters.base import describe_exception
from backend.config.schema import NotifierConfig

TIMEOUT_SECONDS = 10.0
# Tests swap in an httpx.MockTransport; None means real network.
HTTP_TRANSPORT: httpx.AsyncBaseTransport | None = None

# Discord caps a message at 2000 characters.
_DISCORD_MAX = 2000


@dataclass
class NotifyResult:
    success: bool
    message: str


class Notifier(ABC):
    def __init__(self, config: NotifierConfig):
        self.config = config

    @abstractmethod
    async def send(self, title: str, body: str) -> NotifyResult:
        """Send one notification. Never raises for a routine failure
        (missing/misconfigured credentials, a network error, the service
        refusing it) -- returns NotifyResult(success=False, ...) instead,
        the same "represent failure as data, not an exception" rule
        ServiceAdapter.get_status() follows."""


def _secret(env_name: str | None, what: str) -> tuple[str | None, NotifyResult | None]:
    if not env_name:
        return None, NotifyResult(False, f"No environment variable set for the {what}.")
    value = os.environ.get(env_name, "").strip()
    if not value:
        return None, NotifyResult(False, f"Environment variable '{env_name}' is not set.")
    return value, None


def _http_url(url: str, env_name: str | None) -> NotifyResult | None:
    if not url.startswith(("https://", "http://")):
        return NotifyResult(False, f"'{env_name}' doesn't hold an http(s) URL.")
    return None


async def _post(service: str, url: str, **kwargs) -> tuple[httpx.Response | None, NotifyResult | None]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=HTTP_TRANSPORT) as client:
            return await client.post(url, **kwargs), None
    except httpx.HTTPError as exc:
        # Some httpx errors quote the URL -- for a webhook, the secret itself.
        return None, NotifyResult(False, f"Could not reach {service}: {describe_exception(exc).replace(url, '[webhook URL]')}")


def _refused(service: str, resp: httpx.Response) -> NotifyResult:
    if resp.status_code == 429:
        retry = resp.headers.get("retry-after")
        return NotifyResult(False, f"{service} is rate-limiting this sender" + (f" -- retry in {retry}s." if retry else "."))
    if resp.status_code in (401, 403, 404):
        return NotifyResult(False, f"{service} refused it ({resp.status_code}) -- check the URL/credentials in the environment variable.")
    return NotifyResult(False, f"{service} returned {resp.status_code}.")


class DiscordNotifier(Notifier):
    """POSTs to the Discord webhook URL in `config.url_env`. Mentions are
    disabled, so a host or service named "@everyone" can't ping the whole
    server through an alert."""

    async def send(self, title: str, body: str) -> NotifyResult:
        url, problem = _secret(self.config.url_env, "Discord webhook URL")
        if problem or (problem := _http_url(url, self.config.url_env)):
            return problem
        content = f"**{title}**\n{body}"
        if len(content) > _DISCORD_MAX:
            content = content[: _DISCORD_MAX - 1] + "…"
        resp, problem = await _post("Discord", url, json={"content": content, "allowed_mentions": {"parse": []}})
        if problem:
            return problem
        if resp.is_success:
            return NotifyResult(True, "Posted to Discord.")
        return _refused("Discord", resp)


class NtfyNotifier(Notifier):
    """Publishes as JSON to the ntfy server's root (not the plaintext
    per-topic form): JSON carries a title with any characters, where an
    HTTP header can't."""

    async def send(self, title: str, body: str) -> NotifyResult:
        if not self.config.ntfy_topic:
            return NotifyResult(False, "No ntfy topic configured.")
        server = self.config.ntfy_server.rstrip("/")
        resp, problem = await _post("ntfy", server, json={"topic": self.config.ntfy_topic, "title": title, "message": body})
        if problem:
            return problem
        if resp.is_success:
            return NotifyResult(True, f"Published to {server}/{self.config.ntfy_topic}.")
        return _refused("ntfy", resp)


class PushoverNotifier(Notifier):
    async def send(self, title: str, body: str) -> NotifyResult:
        user, problem = _secret(self.config.pushover_user_key_env, "Pushover user key")
        if problem:
            return problem
        token, problem = _secret(self.config.pushover_api_token_env, "Pushover API token")
        if problem:
            return problem
        resp, problem = await _post(
            "Pushover", "https://api.pushover.net/1/messages.json", data={"token": token, "user": user, "title": title, "message": body}
        )
        if problem:
            return problem
        if resp.is_success:
            return NotifyResult(True, "Sent via Pushover.")
        return _refused("Pushover", resp)


class WebhookNotifier(Notifier):
    """POSTs {"title": ..., "body": ...} as JSON to the URL in `config.url_env`."""

    async def send(self, title: str, body: str) -> NotifyResult:
        url, problem = _secret(self.config.url_env, "webhook URL")
        if problem or (problem := _http_url(url, self.config.url_env)):
            return problem
        resp, problem = await _post("The webhook", url, json={"title": title, "body": body})
        if problem:
            return problem
        if resp.is_success:
            return NotifyResult(True, f"Webhook accepted it ({resp.status_code}).")
        return _refused("The webhook", resp)


_NOTIFIER_CLASSES: dict[str, type[Notifier]] = {
    "discord": DiscordNotifier,
    "ntfy": NtfyNotifier,
    "pushover": PushoverNotifier,
    "webhook": WebhookNotifier,
}


def build_notifier(config: NotifierConfig) -> Notifier:
    return _NOTIFIER_CLASSES[config.type](config)
