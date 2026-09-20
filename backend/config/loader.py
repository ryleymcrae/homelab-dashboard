"""
Loads and validates config.yml, and safely rewrites it when settings are
changed from the UI (Settings page). YAML remains the canonical source of
truth on disk -- the UI is a view onto it, never a separate store that can
drift out of sync.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from threading import RLock

import yaml
from pydantic import BaseModel, ValidationError

from backend.config.schema import AppConfig

FALLBACK_CONFIG_PATH = "/config/config.yml"


def default_config_path() -> Path:
    """Resolve DASHBOARD_CONFIG at call time, not at import time, so the
    environment is read by whoever constructs the store rather than being
    frozen by whichever module happened to import this one first."""
    return Path(os.environ.get("DASHBOARD_CONFIG", FALLBACK_CONFIG_PATH))


class ConfigError(Exception):
    pass


class ConfigStore:
    """Thread-safe holder for the current validated configuration, with
    atomic, validated writes back to disk."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else default_config_path()
        self._lock = RLock()
        self._config: AppConfig = self._load_from_disk()

    def _load_from_disk(self) -> AppConfig:
        if not self.path.exists():
            raise ConfigError(
                f"Config file not found at {self.path}. Copy config.example.yml "
                "to config.yml and edit it, then restart the dashboard."
            )
        try:
            # utf-8-sig: config.yml is UTF-8 regardless of the host's locale
            # codepage, and tolerates the BOM that Windows editors often add.
            raw = yaml.safe_load(self.path.read_text(encoding="utf-8-sig")) or {}
        except yaml.YAMLError as exc:
            raise ConfigError(f"config.yml is not valid YAML: {exc}") from exc
        try:
            return AppConfig.model_validate(raw)
        except ValidationError as exc:
            raise ConfigError(f"config.yml failed validation:\n{exc}") from exc

    @property
    def config(self) -> AppConfig:
        with self._lock:
            return self._config

    def reload(self) -> AppConfig:
        with self._lock:
            self._config = self._load_from_disk()
            return self._config

    def update(self, patch: dict) -> AppConfig:
        """Merge a partial update (typically from the Settings UI), validate
        it in isolation, and only then atomically replace config.yml. Never
        leaves the file in a partially-written or invalid state."""
        with self._lock:
            # Only what was actually set, not a full dump: "set" is
            # meaningful -- an alert override replaces just the fields it
            # names (backend/alerting/evaluator.py:merge_thresholds), and
            # a full dump would mark every default as set on the way back
            # in, pinning each override to the built-in defaults.
            current = self._config.model_dump(mode="python", exclude_unset=True)
            merged = _deep_merge(current, patch)
            try:
                candidate = AppConfig.model_validate(merged)
            except ValidationError as exc:
                raise ConfigError(f"Rejected settings update:\n{exc}") from exc

            fd, tmp_path = tempfile.mkstemp(
                dir=str(self.path.parent), prefix=".config.", suffix=".yml.tmp"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    yaml.safe_dump(_to_yaml_data(candidate), f, sort_keys=False)
                shutil.move(tmp_path, self.path)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

            self._config = candidate
            return self._config


def _to_yaml_data(value):
    """What config.yml gets: the fields that were set, under their
    config.yml names (`host_address`, not `tcp_host`), minus nulls that
    only restate a None default. Nulls that *mean* something survive --
    `temp_c: null` disables a threshold whose default is 70, which a
    blanket exclude_none would silently undo on the next restart."""
    if isinstance(value, BaseModel):
        out = {}
        for name, field in type(value).model_fields.items():
            if name not in value.model_fields_set:
                continue
            v = getattr(value, name)
            if v is None and field.default is None and field.default_factory is None:
                continue
            out[field.alias or name] = _to_yaml_data(v)
        return out
    if isinstance(value, list):
        return [_to_yaml_data(v) for v in value]
    if isinstance(value, dict):
        return {k: _to_yaml_data(v) for k, v in value.items()}
    return value


# Maps keyed by a user-chosen name, sent whole and replaced wholesale
# rather than merged: merging can only ever add keys, so there'd be no
# way to remove an override (or put one field back to "inherit"), or put
# a nav tab back to its built-in icon -- and `null` can't mean "delete"
# for an override, it already means "disabled".
_REPLACE_ON_PATCH = {("alerting", "host_overrides"), ("alerting", "service_overrides"), ("dashboard", "nav_icons")}


def _deep_merge(base: dict, patch: dict, path: tuple[str, ...] = ()) -> dict:
    result = dict(base)
    for key, value in patch.items():
        here = (*path, key)
        if isinstance(value, dict) and isinstance(result.get(key), dict) and here not in _REPLACE_ON_PATCH:
            result[key] = _deep_merge(result[key], value, here)
        else:
            result[key] = value
    return result
