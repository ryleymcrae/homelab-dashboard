"""
User-uploaded images (logo, favicon, host/service icons, banners) --
stored on disk under DASHBOARD_ASSETS_DIR and referenced from config.yml
by URL path (`/api/assets/<name>`), the same "store a reference, not the
thing" convention as every other icon/banner field. config.yml never
holds image data.

What makes this safe to expose as an upload endpoint:

- The type is decided from the file's own leading bytes, never its name
  or the client's Content-Type -- a script renamed `logo.png` is refused.
- Only raster formats a browser renders inertly are accepted. SVG is
  deliberately excluded: served from this origin it can carry script.
- Names are derived from the content hash, so the client never chooses a
  path (no traversal), identical uploads dedupe, and a name can be cached
  forever because its bytes can't change.
- A hard size cap, checked while reading.
"""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from pathlib import Path
from typing import Callable

FALLBACK_ASSETS_DIR = "/data/assets"
MAX_BYTES = 2 * 1024 * 1024
URL_PREFIX = "/api/assets/"

# (magic-byte check, extension, Content-Type)
_FORMATS: list[tuple[Callable[[bytes], bool], str, str]] = [
    (lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"), "png", "image/png"),
    (lambda b: b.startswith(b"\xff\xd8\xff"), "jpg", "image/jpeg"),
    (lambda b: b[:6] in (b"GIF87a", b"GIF89a"), "gif", "image/gif"),
    (lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP", "webp", "image/webp"),
    (lambda b: b.startswith(b"\x00\x00\x01\x00"), "ico", "image/x-icon"),
]
CONTENT_TYPES = {ext: ctype for _, ext, ctype in _FORMATS}
_NAME = re.compile(r"^[0-9a-f]{16}\.(png|jpg|gif|webp|ico)$")


class AssetError(Exception):
    pass


class AssetTooLarge(AssetError):
    pass


def default_assets_dir() -> Path:
    """Resolved at call time, like DASHBOARD_HISTORY_DB (history.py)."""
    return Path(os.environ.get("DASHBOARD_ASSETS_DIR", FALLBACK_ASSETS_DIR))


def detect_type(data: bytes) -> tuple[str, str] | None:
    for matches, ext, ctype in _FORMATS:
        if matches(data):
            return ext, ctype
    return None


def valid_name(name: str) -> bool:
    return bool(_NAME.match(name))


class AssetStore:
    def __init__(self, directory: str | Path | None = None):
        self.dir = Path(directory) if directory is not None else default_assets_dir()

    def save(self, data: bytes) -> str:
        if len(data) > MAX_BYTES:
            raise AssetTooLarge(f"Images can be at most {MAX_BYTES // (1024 * 1024)} MB.")
        detected = detect_type(data)
        if detected is None:
            raise AssetError("Only PNG, JPEG, GIF, WebP, or ICO images can be uploaded.")
        name = f"{hashlib.sha256(data).hexdigest()[:16]}.{detected[0]}"
        self.dir.mkdir(parents=True, exist_ok=True)
        target = self.dir / name
        if not target.exists():
            # temp file + rename, same as config.yml writes -- a crash
            # mid-write can't leave a truncated image under a valid name.
            fd, tmp = tempfile.mkstemp(dir=self.dir, prefix=".upload.")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                os.replace(tmp, target)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
        return name

    def path(self, name: str) -> Path | None:
        if not valid_name(name):
            return None
        p = self.dir / name
        return p if p.is_file() else None

    def list(self) -> list[dict]:
        if not self.dir.is_dir():
            return []
        items = []
        for p in self.dir.iterdir():
            if valid_name(p.name) and p.is_file():
                stat = p.stat()
                items.append({"name": p.name, "url": URL_PREFIX + p.name, "size": stat.st_size, "uploadedAt": int(stat.st_mtime)})
        return sorted(items, key=lambda a: a["uploadedAt"], reverse=True)

    def delete(self, name: str) -> bool:
        p = self.path(name)
        if p is None:
            return False
        p.unlink()
        return True


def references(config_dump, url: str, where: str = "") -> list[str]:
    """Every place in a config dump whose value is exactly `url` -- walked
    generically, so an image can't be deleted out from under a field this
    module doesn't know about yet. Returns readable locations, e.g.
    'hosts › nas › icon'."""
    found: list[str] = []
    if isinstance(config_dump, dict):
        for key, value in config_dump.items():
            found += references(value, url, f"{where} › {key}" if where else str(key))
    elif isinstance(config_dump, list):
        for i, item in enumerate(config_dump):
            label = item.get("name") or item.get("id") if isinstance(item, dict) else None
            found += references(item, url, f"{where} › {label or i}")
    elif config_dump == url:
        found.append(where)
    return found

