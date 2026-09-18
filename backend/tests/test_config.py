import pytest
from pydantic import ValidationError

from backend.config.schema import AppConfig


def test_minimal_config_uses_defaults():
    cfg = AppConfig.model_validate({})
    assert cfg.dashboard.title == "My Homelab"
    assert cfg.hosts == []
    assert cfg.services == []
    assert cfg.history.retention_days == 14


def test_docker_service_requires_container():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"services": [{"name": "Plex", "type": "docker"}]}
        )


def test_http_service_requires_url():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"services": [{"name": "Home Assistant", "type": "http"}]}
        )


def test_tcp_service_requires_host_and_port():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"services": [{"name": "Minecraft", "type": "tcp", "port": 25565}]}
        )


def test_custom_service_requires_plugin():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"services": [{"name": "Custom Thing", "type": "custom"}]}
        )


def test_tcp_service_survives_a_dump_and_revalidate_round_trip():
    """Regression test: `host_address` is an alias for `tcp_host`.
    ConfigStore.update() (backend/config/loader.py) dumps the current
    config with model_dump(mode="python") -- which uses field names, not
    aliases, unless told otherwise -- then re-validates the merged
    result. Without `populate_by_name=True` on ServiceConfig, that
    re-validation only accepts the alias and rejects its own dump,
    breaking PATCH /api/config for every config with a `type: tcp`
    service."""
    cfg = AppConfig.model_validate(
        {"services": [{"name": "Minecraft", "type": "tcp", "host_address": "192.168.1.30", "port": 25565}]}
    )
    dumped = cfg.model_dump(mode="python")
    revalidated = AppConfig.model_validate(dumped)  # must not raise
    assert revalidated.services[0].tcp_host == "192.168.1.30"


def test_valid_full_config_parses():
    cfg = AppConfig.model_validate(
        {
            "dashboard": {"title": "Test Lab"},
            "hosts": [{"name": "local", "is_local": True}],
            "services": [
                {"name": "Plex", "type": "docker", "container": "plex"},
                {"name": "HA", "type": "http", "url": "http://x/"},
                {"name": "MC", "type": "tcp", "host_address": "1.2.3.4", "port": 25565},
            ],
        }
    )
    assert cfg.dashboard.title == "Test Lab"
    assert len(cfg.services) == 3


def test_blank_service_name_rejected():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"services": [{"name": "  ", "type": "docker", "container": "x"}]}
        )


def test_service_accepts_custom_icon_and_banner():
    cfg = AppConfig.model_validate(
        {
            "services": [
                {
                    "name": "Plex", "type": "docker", "container": "plex",
                    "icon": "/icons/plex.png", "banner": "/banners/plex.jpg",
                }
            ],
        }
    )
    svc = cfg.services[0]
    assert svc.icon == "/icons/plex.png"
    assert svc.banner == "/banners/plex.jpg"


def test_empty_widget_list_is_the_default():
    cfg = AppConfig.model_validate({})
    assert cfg.dashboard.widgets == []
    assert cfg.dashboard.density == "compact"
    assert cfg.dashboard.accent_color is None
    assert cfg.guest_mode is False


def test_host_overview_widget_requires_host_id():
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"dashboard": {"widgets": [{"id": "w1", "type": "host_overview"}]}})


def test_host_metric_widget_requires_host_id_and_metric():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"dashboard": {"widgets": [{"id": "w1", "type": "host_metric", "host_id": "ziri-mini"}]}}
        )


def test_custom_card_widget_requires_its_fields():
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"dashboard": {"widgets": [{"id": "w1", "type": "custom_card", "name": "Shortcut"}]}})


def test_valid_widgets_of_every_type_parse():
    cfg = AppConfig.model_validate(
        {
            "dashboard": {
                "widgets": [
                    {"id": "w1", "type": "host_overview", "host_id": "ziri-mini"},
                    {"id": "w2", "type": "host_metric", "host_id": "ziri-mini", "metric": "cpu", "display": "sparkline"},
                    {"id": "w3", "type": "services_grid", "group": "Games"},
                    {"id": "w4", "type": "fleet_overview"},
                    {
                        "id": "w5", "type": "custom_card", "name": "Restart Plex",
                        "target_type": "service", "target_id": "plex", "action_kind": "restart",
                    },
                ]
            }
        }
    )
    assert len(cfg.dashboard.widgets) == 5


def test_duplicate_widget_ids_rejected():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {
                "dashboard": {
                    "widgets": [
                        {"id": "dup", "type": "fleet_overview"},
                        {"id": "dup", "type": "fleet_overview"},
                    ]
                }
            }
        )
