"""
Notifiers are all simulated for now (backend/notifications/base.py) --
these tests check the credential-checking and result-shape behavior,
not any real network call, since there isn't one yet.
"""
import pytest

from backend.config.schema import NotifierConfig
from backend.notifications import base as notif_base
from backend.notifications.base import build_notifier


@pytest.fixture(autouse=True)
def _no_delay(monkeypatch):
    monkeypatch.setattr(notif_base, "SEND_DELAY_SCALE", 0)


@pytest.mark.asyncio
async def test_discord_without_env_var_set_fails_with_a_clear_reason():
    config = NotifierConfig(id="d1", type="discord", name="Discord", url_env="DASHBOARD_TEST_MISSING_VAR")
    result = await build_notifier(config).send("Title", "Body")
    assert result.success is False
    assert "DASHBOARD_TEST_MISSING_VAR" in result.message


@pytest.mark.asyncio
async def test_discord_with_env_var_set_returns_a_result_either_way(monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_DISCORD_URL", "https://discord.example/webhook")
    config = NotifierConfig(id="d1", type="discord", name="Discord", url_env="DASHBOARD_TEST_DISCORD_URL")
    result = await build_notifier(config).send("Title", "Body")
    assert result.message  # success is probabilistic (95%); either way there's a human-readable message


@pytest.mark.asyncio
async def test_ntfy_without_topic_fails():
    config = NotifierConfig(id="n1", type="ntfy", name="ntfy")
    result = await build_notifier(config).send("Title", "Body")
    assert result.success is False


@pytest.mark.asyncio
async def test_ntfy_with_topic_returns_a_result(monkeypatch):
    config = NotifierConfig(id="n1", type="ntfy", name="ntfy", ntfy_topic="my-dashboard-alerts")
    result = await build_notifier(config).send("Title", "Body")
    assert result.message


@pytest.mark.asyncio
async def test_pushover_missing_both_env_vars_names_both():
    config = NotifierConfig(
        id="p1", type="pushover", name="Pushover",
        pushover_user_key_env="DASHBOARD_TEST_MISSING_USER",
        pushover_api_token_env="DASHBOARD_TEST_MISSING_TOKEN",
    )
    result = await build_notifier(config).send("Title", "Body")
    assert result.success is False
    assert "DASHBOARD_TEST_MISSING_USER" in result.message
    assert "DASHBOARD_TEST_MISSING_TOKEN" in result.message


@pytest.mark.asyncio
async def test_webhook_without_env_var_fails():
    config = NotifierConfig(id="w1", type="webhook", name="Webhook", url_env="DASHBOARD_TEST_MISSING_WEBHOOK")
    result = await build_notifier(config).send("Title", "Body")
    assert result.success is False


def test_build_notifier_dispatches_by_type():
    for type_, cls_name in [
        ("discord", "DiscordNotifier"),
        ("ntfy", "NtfyNotifier"),
        ("pushover", "PushoverNotifier"),
        ("webhook", "WebhookNotifier"),
    ]:
        config = NotifierConfig(id="x", type=type_, name="x")
        assert type(build_notifier(config)).__name__ == cls_name
