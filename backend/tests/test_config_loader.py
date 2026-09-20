"""
ConfigStore.update() -- the PATCH /api/config path. Separate from
test_config.py (which only exercises the Pydantic schema directly)
because this is specifically about the load -> dump -> merge ->
re-validate round trip, where the tcp_host/host_address alias bug
actually manifested.
"""
import tempfile
from pathlib import Path

import yaml

from backend.config.loader import ConfigStore


def test_update_preserves_a_tcp_service_across_an_unrelated_patch():
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "config.yml"
        config_path.write_text(
            yaml.safe_dump(
                {
                    "services": [
                        {"name": "Minecraft", "type": "tcp", "host_address": "192.168.1.30", "port": 25565}
                    ]
                }
            )
        )
        store = ConfigStore(config_path)

        updated = store.update({"dashboard": {"title": "New Title"}})

        assert updated.dashboard.title == "New Title"
        assert updated.services[0].tcp_host == "192.168.1.30"
        assert updated.services[0].port == 25565


def _store(tmp: str, data: dict) -> tuple[ConfigStore, Path]:
    config_path = Path(tmp) / "config.yml"
    config_path.write_text(yaml.safe_dump(data))
    return ConfigStore(config_path), config_path


def test_unrelated_patch_keeps_an_alert_override_inheriting_unset_fields():
    # An override names only the fields it changes; the rest must keep
    # following the global defaults, not get pinned to the built-in ones.
    with tempfile.TemporaryDirectory() as tmp:
        store, path = _store(tmp, {"alerting": {"defaults": {"cpu_percent": 80}, "host_overrides": {"nas": {"disk_percent": 95}}}})

        store.update({"dashboard": {"title": "New Title"}})

        assert store.config.alerting.host_overrides["nas"].model_fields_set == {"disk_percent"}
        assert yaml.safe_load(path.read_text())["alerting"]["host_overrides"] == {"nas": {"disk_percent": 95.0}}
        assert ConfigStore(path).config.alerting.host_overrides["nas"].model_fields_set == {"disk_percent"}


def test_a_disabled_threshold_stays_disabled_after_a_restart():
    with tempfile.TemporaryDirectory() as tmp:
        store, path = _store(tmp, {"alerting": {"host_overrides": {"nas": {"temp_c": None}}}})

        store.update({"alerting": {"defaults": {"temp_c": None}}})
        reloaded = ConfigStore(path).config

        assert reloaded.alerting.defaults.temp_c is None
        assert reloaded.alerting.host_overrides["nas"].model_fields_set == {"temp_c"}
        assert reloaded.alerting.host_overrides["nas"].temp_c is None


def test_written_file_uses_config_yml_names_and_skips_redundant_nulls():
    with tempfile.TemporaryDirectory() as tmp:
        store, path = _store(tmp, {"services": [{"name": "MC", "type": "tcp", "host_address": "1.2.3.4", "port": 25565}]})

        # The Settings UI sends whole list items, nulls and all.
        store.update({"services": [{"name": "MC", "type": "tcp", "tcp_host": "1.2.3.4", "port": 25565, "icon": None, "banner": None}]})
        on_disk = yaml.safe_load(path.read_text())

        assert on_disk["services"] == [{"name": "MC", "type": "tcp", "host_address": "1.2.3.4", "port": 25565}]
        assert "dashboard" not in on_disk  # never set, so never written


def test_an_override_map_is_replaced_so_entries_and_fields_can_be_removed():
    with tempfile.TemporaryDirectory() as tmp:
        store, path = _store(tmp, {"alerting": {"host_overrides": {"nas": {"disk_percent": 95, "temp_c": 60}, "pi": {"cpu_percent": 70}}}})

        # `pi` removed entirely, `nas.temp_c` put back to inheriting.
        store.update({"alerting": {"host_overrides": {"nas": {"disk_percent": 95}}}})

        assert yaml.safe_load(path.read_text())["alerting"]["host_overrides"] == {"nas": {"disk_percent": 95.0}}


def test_derived_ids_are_never_written_to_config_yml():
    with tempfile.TemporaryDirectory() as tmp:
        store, path = _store(tmp, {"hosts": [{"name": "NAS Box"}]})
        # The UI sends back what GET /api/config gave it, `id` included.
        store.update({"hosts": [{"name": "NAS Box", "id": "nas-box", "model": "N100"}]})
        assert yaml.safe_load(path.read_text())["hosts"] == [{"name": "NAS Box", "model": "N100"}]


def test_nav_icons_are_replaced_so_a_tab_can_go_back_to_its_default():
    with tempfile.TemporaryDirectory() as tmp:
        store, path = _store(tmp, {"dashboard": {"nav_icons": {"home": "star", "alerts": "flame"}}})
        store.update({"dashboard": {"nav_icons": {"home": "star"}}})
        assert yaml.safe_load(path.read_text())["dashboard"]["nav_icons"] == {"home": "star"}
