"""
The notifier contract.

Mirrors backend/providers/base.py's shape deliberately: one abstract
interface, one concrete class per real-world integration (Discord, ntfy,
Pushover, generic webhook), selected by `NotifierConfig.type`
(backend/config/schema.py) through `build_notifier()` below -- the one
place that maps a type string to a class, same role as
backend/adapters/factory.py.

None of the concrete notifiers actually call out to a real service yet
(see each module's docstring) -- they simulate a delay and a plausible
outcome, same "mock now, real later" split as every other admin-action
capability in this app. Building the real HTTP call for a given service
later is a change to that one class alone; nothing about the interface,
the alert evaluator, or the API routes needs to change.
"""
from __future__ import annotations

import asyncio
import os
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass

from backend.config.schema import NotifierConfig

# Tests set this to 0, same pattern as backend/demo/runtime.py:ACTION_DELAY_SCALE.
SEND_DELAY_SCALE = 1.0


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
        (missing/misconfigured credentials, simulated or real network
        error) -- returns NotifyResult(success=False, ...) instead, the
        same "represent failure as data, not an exception" rule
        ServiceAdapter.get_status() follows."""


async def _simulate_send(delay_seconds: float, failure_chance: float, success_detail: str, failure_detail: str) -> NotifyResult:
    delay = delay_seconds * SEND_DELAY_SCALE * random.uniform(0.7, 1.3)
    if delay > 0:
        await asyncio.sleep(delay)
    if random.random() < failure_chance:
        return NotifyResult(success=False, message=failure_detail)
    return NotifyResult(success=True, message=success_detail)


class DiscordNotifier(Notifier):
    """Real implementation would POST {"content": f"**{title}**\\n{body}"}
    to the webhook URL named by `config.url_env`. Simulated for now."""

    async def send(self, title: str, body: str) -> NotifyResult:
        if self.config.url_env and not os.environ.get(self.config.url_env):
            return NotifyResult(False, f"Environment variable '{self.config.url_env}' is not set.")
        return await _simulate_send(
            0.6, 0.05,
            f"(simulated) Discord webhook would post: \"{title}: {body}\"",
            "(simulated) Discord webhook post failed.",
        )


class NtfyNotifier(Notifier):
    """Real implementation would POST `body` as plaintext to
    f"{config.ntfy_server}/{config.ntfy_topic}" with a Title header.
    Simulated for now."""

    async def send(self, title: str, body: str) -> NotifyResult:
        if not self.config.ntfy_topic:
            return NotifyResult(False, "No ntfy topic configured.")
        return await _simulate_send(
            0.5, 0.05,
            f"(simulated) ntfy would publish to {self.config.ntfy_server}/{self.config.ntfy_topic}: \"{title}: {body}\"",
            "(simulated) ntfy publish failed.",
        )


class PushoverNotifier(Notifier):
    """Real implementation would POST to api.pushover.net/1/messages.json
    with the user key and API token named by `config.pushover_user_key_env`
    / `config.pushover_api_token_env`. Simulated for now."""

    async def send(self, title: str, body: str) -> NotifyResult:
        missing = [
            env_name
            for env_name in (self.config.pushover_user_key_env, self.config.pushover_api_token_env)
            if env_name and not os.environ.get(env_name)
        ]
        if missing:
            return NotifyResult(False, f"Environment variable(s) not set: {', '.join(missing)}.")
        return await _simulate_send(
            0.7, 0.05,
            f"(simulated) Pushover would send: \"{title}: {body}\"",
            "(simulated) Pushover send failed.",
        )


class WebhookNotifier(Notifier):
    """Real implementation would POST a JSON body ({"title": ..., "body":
    ...}) to the URL named by `config.url_env`. Simulated for now."""

    async def send(self, title: str, body: str) -> NotifyResult:
        if self.config.url_env and not os.environ.get(self.config.url_env):
            return NotifyResult(False, f"Environment variable '{self.config.url_env}' is not set.")
        return await _simulate_send(
            0.4, 0.05,
            f"(simulated) Webhook would POST: \"{title}: {body}\"",
            "(simulated) Webhook POST failed.",
        )


_NOTIFIER_CLASSES: dict[str, type[Notifier]] = {
    "discord": DiscordNotifier,
    "ntfy": NtfyNotifier,
    "pushover": PushoverNotifier,
    "webhook": WebhookNotifier,
}


def build_notifier(config: NotifierConfig) -> Notifier:
    return _NOTIFIER_CLASSES[config.type](config)
