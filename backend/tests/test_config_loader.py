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
