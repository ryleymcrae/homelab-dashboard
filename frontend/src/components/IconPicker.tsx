import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { formatBytes } from "../api/format";
import { GLYPHS } from "../api/icons";
import type { AssetInfo } from "../api/types";
import { Modal } from "./Modal";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/x-icon,.ico";

// Several galleries can be on screen at once (Branding's library plus a
// picker opened from the same page) -- an upload or delete in one tells
// the others to re-fetch rather than each showing its own stale list.
const ASSETS_CHANGED = "homelab:assets-changed";

/**
 * Uploaded images (GET/POST/DELETE /api/assets). `onPick` makes each one
 * selectable (inside IconPicker); `manage` shows size, where it's used,
 * and a Delete button instead (Settings > Branding). Uploading from
 * either picks the new image straight away when there's something to
 * pick it for.
 */
export function AssetGallery({
  selected, onPick, manage, disabled, refreshKey,
}: {
  selected?: string | null;
  onPick?: (url: string) => void;
  manage?: boolean;
  disabled?: boolean;
  /** Re-fetch when this changes -- e.g. the config, since "used by" follows it. */
  refreshKey?: unknown;
}) {
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    api.listAssets()
      .then(setAssets)
      .catch((err) => setError((err as Error).message));
  useEffect(() => {
    refresh();
  }, [refreshKey]);
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener(ASSETS_CHANGED, onChanged);
    return () => window.removeEventListener(ASSETS_CHANGED, onChanged);
  }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.uploadAsset(file);
      window.dispatchEvent(new Event(ASSETS_CHANGED));
      onPick?.(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (asset: AssetInfo) => {
    setError(null);
    try {
      await api.deleteAsset(asset.name);
      window.dispatchEvent(new Event(ASSETS_CHANGED));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <div className="asset-grid">
        {assets?.map((a) => (
          <div key={a.name} className="asset-tile">
            {onPick ? (
              <button type="button" className="asset-tile__image" aria-pressed={selected === a.url} aria-label={`Use image ${a.name}`} disabled={disabled} onClick={() => onPick(a.url)}>
                <img src={a.url} alt="" />
              </button>
            ) : (
              <div className="asset-tile__image">
                <img src={a.url} alt="" />
              </div>
            )}
            {manage && (
              <>
                <div className="settings-note" style={{ margin: 0 }}>
                  {formatBytes(a.size)} · {a.usedBy.length ? `Used by ${a.usedBy.join(", ")}` : "Not used"}
                </div>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={disabled || a.usedBy.length > 0}
                  title={a.usedBy.length ? "Still in use -- change those settings first" : undefined}
                  onClick={() => remove(a)}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
        <button type="button" className="asset-tile asset-tile--upload" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
          {busy ? "Uploading…" : "+ Upload image"}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label="Image file to upload"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      {assets?.length === 0 && !manage && <div className="settings-note">No images uploaded yet.</div>}
      {error && <div className="settings-note" style={{ color: "var(--color-danger)" }} role="alert">{error}</div>}
    </div>
  );
}

/**
 * Picks an icon (a built-in glyph, an uploaded image, or a URL/path) or,
 * with kind="image", an image only -- banners have no glyph form. Every
 * choice is the same kind of value config.yml already stored for icons
 * (a glyph name or a URL/path), so nothing downstream had to change.
 */
export function IconPicker({
  title,
  value,
  kind = "icon",
  defaultLabel,
  disabled,
  onPick,
  onClose,
}: {
  title: string;
  value?: string | null;
  kind?: "icon" | "image";
  /** What "use the default" means here, e.g. "▲" or "none". */
  defaultLabel: string;
  disabled?: boolean;
  onPick: (value: string | null) => void;
  onClose: () => void;
}) {
  const external = value && !GLYPHS[value] && !value.startsWith("/api/assets/") ? value : "";
  const [url, setUrl] = useState(external);
  const pick = (v: string | null) => {
    onPick(v);
    onClose();
  };

  return (
    <Modal onClose={onClose} size="panel">
      <div className="picker__header">
        <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>{title}</div>
        <button className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="picker__body">
        <section>
          <div className="section-title">YOUR IMAGES</div>
          <div className="settings-note">PNG, JPEG, GIF, WebP, or ICO, up to 2 MB.</div>
          <AssetGallery selected={value} onPick={pick} disabled={disabled} />
        </section>
        {kind === "icon" && (
          <section>
            <div className="section-title">BUILT-IN</div>
            <div className="glyph-grid">
              {Object.entries(GLYPHS).map(([name, glyph]) => (
                <button key={name} type="button" className="glyph-option" aria-pressed={value === name} aria-label={name} disabled={disabled} onClick={() => pick(name)}>
                  <span aria-hidden className="glyph-option__glyph">{glyph}</span>
                  <span className="glyph-option__name">{name}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <div className="section-title">FROM A URL OR PATH</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="field"
              style={{ flex: 1, fontFamily: "var(--font-mono)" }}
              aria-label="Image URL or path"
              placeholder="https://… or /icons/plex.png"
              value={url}
              disabled={disabled}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && pick(url.trim())}
            />
            <button className="btn btn--ghost" disabled={disabled || !url.trim()} onClick={() => pick(url.trim())}>
              Use
            </button>
          </div>
        </section>
      </div>
      <div className="picker__footer">
        <button className="btn btn--ghost" disabled={disabled} onClick={() => pick(null)}>
          Use default ({defaultLabel})
        </button>
      </div>
    </Modal>
  );
}
