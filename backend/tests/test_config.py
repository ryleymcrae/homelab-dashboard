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


def test_empty_integrations_list_is_the_default():
    cfg = AppConfig.model_validate({})
    assert cfg.integrations.connections == []


def test_docker_api_integration_requires_docker_url():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"integrations": {"connections": [{"id": "i1", "type": "docker_api", "name": "Remote Docker"}]}}
        )


def test_prometheus_integration_requires_prometheus_url():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"integrations": {"connections": [{"id": "i1", "type": "prometheus", "name": "Prom"}]}}
        )


def test_node_exporter_integration_requires_metrics_url():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"integrations": {"connections": [{"id": "i1", "type": "node_exporter", "name": "NE"}]}}
        )


def test_ssh_integration_requires_host_username_and_key_path():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"integrations": {"connections": [{"id": "i1", "type": "ssh", "name": "RPi", "ssh_host": "10.0.0.5"}]}}
        )


def test_custom_script_integration_requires_script_path():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"integrations": {"connections": [{"id": "i1", "type": "custom_script", "name": "Custom"}]}}
        )


def test_valid_integrations_of_every_type_parse():
    cfg = AppConfig.model_validate(
        {
            "integrations": {
                "connections": [
                    {"id": "i1", "type": "docker_api", "name": "Remote Docker", "docker_url": "tcp://10.0.0.5:2376"},
                    {"id": "i2", "type": "prometheus", "name": "Prom", "prometheus_url": "http://10.0.0.6:9090"},
                    {"id": "i3", "type": "node_exporter", "name": "NE", "metrics_url": "http://10.0.0.7:9100/metrics"},
                    {
                        "id": "i4", "type": "ssh", "name": "RPi",
                        "ssh_host": "10.0.0.8", "ssh_username": "pi", "ssh_key_path": "/etc/homelab-dashboard/keys/rpi",
                    },
                    {"id": "i5", "type": "custom_script", "name": "Custom", "script_path": "/opt/scripts/status.sh"},
                ]
            }
        }
    )
    assert len(cfg.integrations.connections) == 5


def test_duplicate_integration_ids_rejected():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {
                "integrations": {
                    "connections": [
                        {"id": "dup", "type": "prometheus", "name": "A", "prometheus_url": "http://a/"},
                        {"id": "dup", "type": "prometheus", "name": "B", "prometheus_url": "http://b/"},
                    ]
                }
            }
        )


def test_host_integration_id_must_reference_a_real_connection():
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"hosts": [{"name": "rpi", "integration_id": "does-not-exist"}]}
        )


def test_host_integration_id_accepts_a_matching_connection():
    cfg = AppConfig.model_validate(
        {
            "hosts": [{"name": "rpi", "integration_id": "i1"}],
            "integrations": {
                "connections": [
                    {
                        "id": "i1", "type": "ssh", "name": "RPi",
                        "ssh_host": "10.0.0.8", "ssh_username": "pi", "ssh_key_path": "/etc/homelab-dashboard/keys/rpi",
                    }
                ]
            },
        }
    )
    assert cfg.hosts[0].integration_id == "i1"


def test_old_display_section_is_ignored_rather_than_rejected():
    """`display:` (auto-dim/screen timeout/kiosk_url_path) was removed --
    none of it was ever applied. Configs written before that must still
    load."""
    cfg = AppConfig.model_validate({"display": {"auto_dim": True, "screen_timeout": "5m", "kiosk_url_path": "/"}})
    assert not hasattr(cfg, "display")


@pytest.mark.parametrize("entry", ["192.168.1.50", "192.168.1.0/24", "fd00::/8", " 10.0.0.1 "])
def test_trusted_ips_accept_addresses_and_ranges(entry):
    assert AppConfig.model_validate({"auth": {"trusted_ips": [entry]}}).auth.trusted_ips == [entry.strip()]


@pytest.mark.parametrize("entry", ["kiosk.local", "192.168.1.300", "0.0.0.0/0", "::/0"])
def test_trusted_ips_reject_garbage_and_match_everything_ranges(entry):
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"auth": {"trusted_ips": [entry]}})


def test_hosts_and_services_expose_their_id_but_it_is_never_input():
    cfg = AppConfig.model_validate(
        {"hosts": [{"name": "Rack Pi", "id": "ignored"}], "services": [{"name": "Plex Server", "type": "http", "url": "http://x"}]}
    )
    dumped = cfg.model_dump(mode="json")
    assert dumped["hosts"][0]["id"] == "rack-pi"
    assert dumped["services"][0]["id"] == "plex-server"


@pytest.mark.parametrize("field,items", [
    ("hosts", [{"name": "NAS"}, {"name": "nas"}]),
    ("services", [{"name": "Plex", "type": "http", "url": "http://a"}, {"name": "plex", "type": "http", "url": "http://b"}]),
])
def test_names_that_share_an_id_are_rejected(field, items):
    with pytest.raises(ValidationError, match="more than one"):
        AppConfig.model_validate({field: items})


def test_alert_overrides_dump_only_the_fields_they_set():
    cfg = AppConfig.model_validate({"alerting": {"host_overrides": {"nas": {"disk_percent": 95, "temp_c": None}}}})
    assert cfg.model_dump(mode="json")["alerting"]["host_overrides"] == {"nas": {"disk_percent": 95.0, "temp_c": None}}


@pytest.mark.parametrize("value,expected", [(None, None), ("", None), ("  ", None), ("Europe/London", "Europe/London"), (" UTC ", "UTC")])
def test_timezone_defaults_to_the_viewers_own(value, expected):
    assert AppConfig.model_validate({"dashboard": {"timezone": value}}).dashboard.timezone == expected


@pytest.mark.parametrize("value", ["Mars/Olympus_Mons", "../etc/passwd"])
def test_timezone_rejects_names_that_are_not_zones(value):
    with pytest.raises(ValidationError, match="time zone"):
        AppConfig.model_validate({"dashboard": {"timezone": value}})


def test_temperature_unit_is_display_only_and_defaults_to_celsius():
    assert AppConfig.model_validate({}).dashboard.temperature_unit == "celsius"
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"dashboard": {"temperature_unit": "kelvin"}})


def test_metric_display_defaults_and_per_metric_styles():
    md = AppConfig.model_validate({}).dashboard.metric_display
    assert (md.cpu.style, md.mem.style, md.disk.style) == ("sparkline", "sparkline", "bar")
    assert md.temp.color is None
    ok = AppConfig.model_validate({"dashboard": {"metric_display": {"disk": {"style": "gauge", "color": "#AABBCC"}}}})
    assert ok.dashboard.metric_display.disk.style == "gauge"


@pytest.mark.parametrize("patch", [
    {"cpu": {"style": "bar"}},          # no bar for CPU
    {"disk": {"style": "sparkline"}},   # no storage history to draw
    {"mem": {"color": "green"}},
    {"cpu": {"color": "#12345"}},
])
def test_metric_display_rejects_styles_a_metric_cannot_draw(patch):
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"dashboard": {"metric_display": patch}})


def test_accent_color_must_be_a_hex_color():
    assert AppConfig.model_validate({"dashboard": {"accent_color": "#8855ff"}}).dashboard.accent_color == "#8855ff"
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"dashboard": {"accent_color": "purple"}})


def test_widget_display_is_optional_and_allows_bar():
    cfg = AppConfig.model_validate({"dashboard": {"widgets": [
        {"id": "a", "type": "host_metric", "host_id": "nas", "metric": "disk", "display": "bar"},
        {"id": "b", "type": "host_metric", "host_id": "nas", "metric": "cpu"},
    ]}})
    assert [w.display for w in cfg.dashboard.widgets] == ["bar", None]


def test_nav_icons_only_accept_real_tabs():
    cfg = AppConfig.model_validate({"dashboard": {"nav_icons": {"home": "home", "devices": "/api/assets/0123456789abcdef.png"}}})
    assert cfg.dashboard.nav_icons["devices"].endswith(".png")
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"dashboard": {"nav_icons": {"homepage": "home"}}})
