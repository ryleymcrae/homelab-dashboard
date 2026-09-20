"""
Uploaded images (backend/persistence/assets.py + /api/assets). The upload
endpoint is the one place this app writes user-supplied bytes to disk,
so most of this is about what it refuses.
"""
import tempfile
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from backend.persistence.assets import AssetError, AssetStore, AssetTooLarge, MAX_BYTES, references

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "config.yml").write_text(yaml.safe_dump({"demo_mode": True, "hosts": [{"name": "nas"}]}))
        monkeypatch.setenv("DASHBOARD_CONFIG", str(Path(tmp) / "config.yml"))
        monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
        for var, name in [("DASHBOARD_HISTORY_DB", "h.sqlite3"), ("DASHBOARD_AUDIT_DB", "a.sqlite3"), ("DASHBOARD_ALERTS_DB", "al.sqlite3")]:
            monkeypatch.setenv(var, str(Path(tmp) / name))
        monkeypatch.setenv("DASHBOARD_ASSETS_DIR", str(Path(tmp) / "assets"))
        import importlib

        import backend.api.main as main_module

        importlib.reload(main_module)
        with TestClient(main_module.app) as c:
            c.assets_dir = Path(tmp) / "assets"
            yield c


def upload(client, data: bytes, filename="logo.png"):
    return client.post("/api/assets", files={"file": (filename, data, "image/png")})


def test_upload_is_named_by_content_and_served_back_inertly(client):
    resp = upload(client, PNG)
    assert resp.status_code == 201
    body = resp.json()
    assert body["url"] == f"/api/assets/{body['name']}" and body["name"].endswith(".png")
    assert upload(client, PNG, "other-name.png").json() == body  # same bytes, same name

    served = client.get(body["url"])
    assert served.status_code == 200 and served.content == PNG
    assert served.headers["content-type"] == "image/png"
    assert served.headers["x-content-type-options"] == "nosniff"
    assert "immutable" in served.headers["cache-control"]


@pytest.mark.parametrize("data", [
    b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    b"<html><script>alert(1)</script></html>",
    b"#!/bin/sh\nrm -rf /\n",
])
def test_anything_but_a_raster_image_is_refused_whatever_its_name(client, data):
    resp = upload(client, data, "definitely-a-logo.png")
    assert resp.status_code == 415
    assert not client.assets_dir.exists() or not any(client.assets_dir.iterdir())


def test_oversized_uploads_are_refused_before_parsing(client):
    resp = upload(client, PNG + b"\x00" * (MAX_BYTES + 128 * 1024))
    assert resp.status_code == 413


@pytest.mark.parametrize("name", ["../config.yml", "..%2Fconfig.yml", "abc.png", "0123456789abcdef.svg", "0123456789abcdef.png"])
def test_only_well_formed_existing_names_are_served(client, name):
    assert client.get(f"/api/assets/{name}").status_code == 404


def test_an_image_in_use_cannot_be_deleted(client):
    url = upload(client, JPEG).json()["url"]
    client.patch("/api/config", json={"dashboard": {"logo": url}, "hosts": [{"name": "nas", "icon": url}]})

    listed = client.get("/api/assets").json()
    assert listed[0]["usedBy"] == ["dashboard › logo", "hosts › nas › icon"]
    resp = client.delete(url)
    assert resp.status_code == 409
    assert resp.json()["detail"]["usedBy"] == ["dashboard › logo", "hosts › nas › icon"]

    client.patch("/api/config", json={"dashboard": {"logo": None}, "hosts": [{"name": "nas"}]})
    assert client.delete(url).status_code == 200
    assert client.get(url).status_code == 404


def test_guest_mode_blocks_uploads_and_deletes_but_not_viewing(client):
    url = upload(client, PNG).json()["url"]
    client.patch("/api/config", json={"guest_mode": True})
    assert upload(client, JPEG).status_code == 403
    assert client.delete(url).status_code == 403
    assert client.get(url).status_code == 200


def test_store_rejects_unknown_types_and_oversize_directly():
    with tempfile.TemporaryDirectory() as tmp:
        store = AssetStore(tmp)
        with pytest.raises(AssetError):
            store.save(b"GIF90a nope")
        with pytest.raises(AssetTooLarge):
            store.save(PNG + b"\x00" * MAX_BYTES)
        assert store.save(b"RIFF\x00\x00\x00\x00WEBPVP8 ").endswith(".webp")


def test_references_names_list_items_by_name():
    dump = {"services": [{"name": "Plex", "icon": "/api/assets/a.png", "banner": "/api/assets/a.png"}], "dashboard": {"nav_icons": {"home": "/api/assets/a.png"}}}
    assert references(dump, "/api/assets/a.png") == ["services › Plex › icon", "services › Plex › banner", "dashboard › nav_icons › home"]
