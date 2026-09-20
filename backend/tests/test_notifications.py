"""
Notifiers make real HTTP requests (backend/notifications/base.py). These
run them against an httpx.MockTransport that records exactly what would
have gone over the wire.
"""
import json

import httpx
import pytest

from backend.config.schema import NotifierConfig
from backend.notifications import base as notif_base
from backend.notifications.base import build_notifier

WEBHOOK = "https://discord.com/api/webhooks/123/secret-token"


@pytest.fixture
def wire(monkeypatch):
    """Captured requests; set `wire.respond` to change the reply."""
    class Wire:
        requests: list[httpx.Request] = []
        respond = staticmethod(lambda request: httpx.Response(204))

    w = Wire()
    w.requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        w.requests.append(request)
        return w.respond(request)

    monkeypatch.setattr(notif_base, "HTTP_TRANSPORT", httpx.MockTransport(handler))
    return w


def discord(**extra):
    return build_notifier(NotifierConfig(id="d1", type="discord", name="Discord", url_env="DASHBOARD_TEST_DISCORD_URL", **extra))


@pytest.mark.asyncio
async def test_discord_posts_the_alert_with_mentions_disabled(wire, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_DISCORD_URL", WEBHOOK)
    result = await discord().send("CPU high on nas", "@everyone nas cpu at 97%")
    assert result.success and result.message == "Posted to Discord."
    [request] = wire.requests
    assert str(request.url) == WEBHOOK and request.method == "POST"
    assert json.loads(request.content) == {
        "content": "**CPU high on nas**\n@everyone nas cpu at 97%",
        "allowed_mentions": {"parse": []},
    }


@pytest.mark.asyncio
async def test_discord_trims_to_its_2000_character_limit(wire, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_DISCORD_URL", WEBHOOK)
    await discord().send("t", "x" * 5000)
    assert len(json.loads(wire.requests[0].content)["content"]) == 2000


@pytest.mark.asyncio
@pytest.mark.parametrize("status,expected", [
    (404, "Discord refused it (404)"),
    (429, "Discord is rate-limiting this sender -- retry in 3s."),
    (500, "Discord returned 500."),
])
async def test_discord_refusals_are_explained(wire, monkeypatch, status, expected):
    monkeypatch.setenv("DASHBOARD_TEST_DISCORD_URL", WEBHOOK)
    wire.respond = lambda request: httpx.Response(status, headers={"retry-after": "3"})
    result = await discord().send("t", "b")
    assert not result.success and result.message.startswith(expected)


@pytest.mark.asyncio
async def test_a_network_error_never_leaks_the_webhook_url(wire, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_DISCORD_URL", WEBHOOK)

    def fail(request):
        raise httpx.ConnectError(f"Connection refused for url {WEBHOOK}")

    wire.respond = fail
    result = await discord().send("t", "b")
    assert not result.success
    assert "secret-token" not in result.message and "[webhook URL]" in result.message


@pytest.mark.asyncio
async def test_discord_without_env_var_set_fails_with_a_clear_reason(wire):
    config = NotifierConfig(id="d1", type="discord", name="Discord", url_env="DASHBOARD_TEST_MISSING_VAR")
    result = await build_notifier(config).send("t", "b")
    assert result.success is False
    assert "DASHBOARD_TEST_MISSING_VAR" in result.message
    assert wire.requests == []


@pytest.mark.asyncio
async def test_discord_env_var_must_hold_a_url(wire, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_DISCORD_URL", "not-a-url")
    assert not (await discord().send("t", "b")).success
    assert wire.requests == []


@pytest.mark.asyncio
async def test_ntfy_publishes_json_to_the_server_root(wire):
    config = NotifierConfig(id="n", type="ntfy", name="ntfy", ntfy_server="https://ntfy.example/", ntfy_topic="lab")
    result = await build_notifier(config).send("Disk full ⚠", "nas at 99%")
    assert result.success
    [request] = wire.requests
    assert str(request.url) == "https://ntfy.example"
    assert json.loads(request.content) == {"topic": "lab", "title": "Disk full ⚠", "message": "nas at 99%"}


@pytest.mark.asyncio
async def test_ntfy_without_topic_fails(wire):
    result = await build_notifier(NotifierConfig(id="n", type="ntfy", name="ntfy")).send("t", "b")
    assert not result.success and wire.requests == []


@pytest.mark.asyncio
async def test_pushover_sends_both_credentials(wire, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_PO_USER", "u123")
    monkeypatch.setenv("DASHBOARD_TEST_PO_TOKEN", "t456")
    config = NotifierConfig(id="p", type="pushover", name="PO", pushover_user_key_env="DASHBOARD_TEST_PO_USER", pushover_api_token_env="DASHBOARD_TEST_PO_TOKEN")
    assert (await build_notifier(config).send("T", "B")).success
    [request] = wire.requests
    assert str(request.url) == "https://api.pushover.net/1/messages.json"
    assert dict(httpx.QueryParams(request.content.decode())) == {"token": "t456", "user": "u123", "title": "T", "message": "B"}


@pytest.mark.asyncio
async def test_pushover_missing_credentials_names_them(wire):
    config = NotifierConfig(
        id="p", type="pushover", name="PO",
        pushover_user_key_env="DASHBOARD_TEST_MISSING_USER", pushover_api_token_env="DASHBOARD_TEST_MISSING_TOKEN",
    )
    result = await build_notifier(config).send("t", "b")
    assert not result.success and "DASHBOARD_TEST_MISSING_USER" in result.message


@pytest.mark.asyncio
async def test_webhook_posts_title_and_body(wire, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_WEBHOOK", "https://hooks.example/abc")
    config = NotifierConfig(id="w", type="webhook", name="W", url_env="DASHBOARD_TEST_WEBHOOK")
    wire.respond = lambda request: httpx.Response(202)
    result = await build_notifier(config).send("T", "B")
    assert result.success and result.message == "Webhook accepted it (202)."
    assert json.loads(wire.requests[0].content) == {"title": "T", "body": "B"}


def test_build_notifier_dispatches_by_type():
    for type_, cls in [
        ("discord", notif_base.DiscordNotifier),
        ("ntfy", notif_base.NtfyNotifier),
        ("pushover", notif_base.PushoverNotifier),
        ("webhook", notif_base.WebhookNotifier),
    ]:
        assert isinstance(build_notifier(NotifierConfig(id="x", type=type_, name="x")), cls)
