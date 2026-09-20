import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { IconGlyph } from "../../components/ServiceIcon";
import { IconPicker } from "../../components/IconPicker";

// Config travels through GET/PATCH /api/config as Pydantic's own
// snake_case dump -- loosely typed on purpose, see the note on Alert in
// frontend/src/api/types.ts.
export type SettingsConfig = Record<string, any>;
export type ConfigPatch = Record<string, unknown>;

/**
 * Takes either a patch or a function computing one from the latest saved
 * config. Saves are queued one at a time (SettingsPage.tsx), and any edit
 * to a *list* (widgets, notifiers, connections, hosts) must use the
 * function form: PATCH replaces lists wholesale, so a list computed from
 * the config as it was when the control last rendered would silently
 * drop an earlier edit to the same list that's still in the queue.
 * The function may return `null` for "nothing to change after all".
 * Resolves `true` once this save has landed, `false` if it was rejected.
 */
export type SaveFn = (patch: ConfigPatch | ((latest: SettingsConfig) => ConfigPatch | null)) => Promise<boolean>;

export interface SectionProps {
  config: SettingsConfig | null;
  onSave: SaveFn;
  /** Guest mode without an admin login -- the backend would 403 anyway. */
  disabled: boolean;
}

interface SettingsUi {
  /** The setting the page last jumped to (search result or ?s= deep link). */
  focusId: string | null;
  /** Bumped on every jump, so picking the same result twice still scrolls/flashes. */
  focusNonce: number;
  /** Bumped whenever a save settles (success or failure), so a text field
   * that isn't being edited re-syncs to what was actually saved. */
  revision: number;
}

export const SettingsUiContext = createContext<SettingsUi>({ focusId: null, focusNonce: 0, revision: 0 });

function useSettingAnchor(id?: string) {
  const { focusId, focusNonce } = useContext(SettingsUiContext);
  const ref = useRef<HTMLDivElement>(null);
  const focused = !!id && focusId === id;
  useEffect(() => {
    // Optional call: jsdom (frontend tests) doesn't implement scrollIntoView.
    if (focused) ref.current?.scrollIntoView?.({ block: "center" });
  }, [focused, focusNonce]);
  // Keyed by nonce so the flash animation replays on a repeat jump.
  const flash = focused ? <span key={focusNonce} className="setting-flash" aria-hidden /> : null;
  return { ref, flash };
}

/** One labeled setting: label (+ optional help text) on the left, its
 * control on the right, wrapping the control underneath on narrow screens. */
export function SettingRow({
  id, label, description, children,
}: { id?: string; label: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  const { ref, flash } = useSettingAnchor(id);
  return (
    <div ref={ref} id={id ? `setting-${id}` : undefined} className="setting-row">
      {flash}
      <div className="setting-row__text">
        <div className="setting-row__label">{label}</div>
        {description && <div className="setting-row__desc">{description}</div>}
      </div>
      {children !== undefined && <div className="setting-row__control">{children}</div>}
    </div>
  );
}

/** A search/deep-link anchor around something bigger than one row -- a
 * notifier, a connection, a widget, a host. */
export function SettingBlock({
  id, className, style, children,
}: { id: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const { ref, flash } = useSettingAnchor(id);
  return (
    <div ref={ref} id={`setting-${id}`} className={className} style={{ position: "relative", ...style }}>
      {flash}
      {children}
    </div>
  );
}

/**
 * Which cards in a list are expanded, keyed by something stable (a host
 * or service name). A search jump or deep link to `<prefix><key>` opens
 * that card; `rename` keeps a card open across a rename.
 */
export function useExpanded(prefix: string) {
  const { focusId, focusNonce } = useContext(SettingsUiContext);
  const focusedKey = focusId?.startsWith(prefix) ? focusId.slice(prefix.length) : null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusedKey ? [focusedKey] : []));
  useEffect(() => {
    if (focusedKey) setOpen((s) => new Set(s).add(focusedKey));
  }, [focusedKey, focusNonce]);
  return {
    isOpen: (key: string) => open.has(key),
    toggle: (key: string) =>
      setOpen((s) => {
        const next = new Set(s);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    rename: (from: string, to: string) =>
      setOpen((s) => {
        if (!s.has(from)) return s;
        const next = new Set(s);
        next.delete(from);
        next.add(to);
        return next;
      }),
  };
}

/** A host/service/device in a list: a tappable summary row that expands
 * into its full editor, so a long list stays scannable on a small screen. */
export function ItemCard({
  id, open, onToggle, icon, title, subtitle, badge, children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SettingBlock id={id} className="card settings-item">
      <button type="button" className="settings-item__summary" aria-expanded={open} onClick={onToggle}>
        {icon}
        <span className="settings-item__titles">
          <span className="settings-item__title">{title}</span>
          {subtitle && <span className="settings-item__subtitle">{subtitle}</span>}
        </span>
        {badge}
        <span className="settings-item__chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="settings-item__body">{children}</div>}
    </SettingBlock>
  );
}

/**
 * An icon (glyph, uploaded image, or URL/path) or, with kind="image", a
 * picture such as a banner: a preview of what it renders as now, and a
 * button opening the picker. Commits "" for "back to the default", which
 * every caller already maps to null.
 */
export function IconField({
  value, onCommit, disabled, label, kind = "icon", fallback = "▢", defaultLabel,
}: {
  value: string | null | undefined;
  onCommit: Commit<string>;
  disabled?: boolean;
  label: string;
  kind?: "icon" | "image";
  /** Glyph shown when unset (e.g. the built-in logo). */
  fallback?: string;
  defaultLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "100%" }}>
      {kind === "image" ? (
        value ? <img className="banner-thumb" src={value} alt="" /> : <span className="settings-note" style={{ margin: 0 }}>None</span>
      ) : (
        <span className="icon-preview" aria-hidden>
          <IconGlyph icon={value} fallback={fallback} size={20} />
        </span>
      )}
      <button type="button" className="btn btn--ghost" aria-label={`Change ${label}`} disabled={disabled} onClick={() => setOpen(true)}>
        Change…
      </button>
      {open && (
        <IconPicker
          title={label}
          value={value}
          kind={kind}
          defaultLabel={defaultLabel ?? (kind === "image" ? "none" : fallback)}
          disabled={disabled}
          onPick={(v) => onCommit(v ?? "")}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/** Multi-line JSON, saved on blur -- `false` from onCommit (e.g. it didn't
 * parse) snaps it back, same as TextField. */
export function JsonField({
  value, onCommit, disabled, label,
}: { value: unknown; onCommit: (parsed: Record<string, unknown>) => unknown; disabled?: boolean; label: string }) {
  const text = (v: unknown) => JSON.stringify(v ?? {}, null, 2);
  const [error, setError] = useState<string | null>(null);
  const draft = useDraft(value, text, (raw) => {
    try {
      const parsed = JSON.parse(raw || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
      setError(null);
      return onCommit(parsed);
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  });
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <textarea
        className="field field--textarea"
        aria-label={label}
        disabled={disabled}
        rows={4}
        value={draft.value}
        onFocus={draft.onFocus}
        onChange={(e) => draft.onChange(e as unknown as React.ChangeEvent<HTMLInputElement>)}
        onBlur={draft.onBlur}
      />
      {error && <span className="settings-note" style={{ color: "var(--color-danger)", margin: 0 }}>Not saved: {error}</span>}
    </span>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="settings-section-header">
      <div className="section-title" style={{ margin: 0 }}>{title}</div>
      {description && <div className="settings-note">{description}</div>}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <div className="settings-note">{children}</div>;
}

export function Banner({
  tone, children, onDismiss,
}: { tone: "info" | "warning" | "danger"; children: React.ReactNode; onDismiss?: () => void }) {
  return (
    <div className={`settings-banner settings-banner--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <span style={{ wordBreak: "break-word" }}>{children}</span>
      {onDismiss && (
        <button className="btn btn--ghost" style={{ flexShrink: 0 }} onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Toggle({
  checked, onChange, disabled, label,
}: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** A row of mutually exclusive buttons -- every option visible and one
 * tap away, unlike a <select>, for short option lists (2-4 choices). */
export function Segmented<T extends string>({
  value, options, onChange, disabled, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Local draft while typing; saves once on blur/Enter (Escape reverts) --
 * never a PATCH per keystroke. Each PATCH rewrites config.yml and
 * rebuilds the provider (backend/api/main.py:patch_config), and a
 * per-keystroke save used to disable the field mid-word, dropping focus.
 * `onCommit` returning `false` means "not saved" (e.g. a required field
 * was cleared), and the field snaps back to the saved value.
 */
type Commit<T> = (value: T) => unknown;

function useDraft<T>(value: T, toText: (v: T) => string, onCommit: Commit<string>) {
  const { revision } = useContext(SettingsUiContext);
  const [draft, setDraft] = useState(toText(value));
  const editing = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, revision]);

  return {
    value: draft,
    onFocus: () => {
      editing.current = true;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      editing.current = false;
      if (cancelled.current) {
        cancelled.current = false;
        setDraft(toText(value));
        return;
      }
      if (draft !== toText(value) && onCommit(draft) === false) setDraft(toText(value));
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        cancelled.current = true;
        e.currentTarget.blur();
      }
    },
  };
}

export function TextField({
  value, onCommit, disabled, placeholder, label, width = 220, mono,
}: {
  value: string | null | undefined;
  onCommit: Commit<string>;
  disabled?: boolean;
  placeholder?: string;
  label: string;
  width?: number | string;
  mono?: boolean;
}) {
  const draft = useDraft(value ?? "", (v) => v, onCommit);
  return (
    <input
      className="field"
      aria-label={label}
      disabled={disabled}
      placeholder={placeholder}
      style={{ width, maxWidth: "100%", fontFamily: mono ? "var(--font-mono)" : undefined }}
      {...draft}
    />
  );
}

/** Empty commits `null` when `nullable` (e.g. a disabled alert threshold
 * -- "0" is a real value, so "off" has to stay distinct from it). */
export function NumberField({
  value, onCommit, disabled, label, suffix, min, max, step, nullable, placeholder,
}: {
  value: number | null | undefined;
  onCommit: Commit<number | null>;
  disabled?: boolean;
  label: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  nullable?: boolean;
  placeholder?: string;
}) {
  const draft = useDraft(value ?? null, (v) => (v == null ? "" : String(v)), (text) => {
    if (text.trim() === "") return nullable ? onCommit(null) : false;
    const n = Number(text);
    return Number.isNaN(n) ? false : onCommit(n);
  });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input
        className="field field--number"
        type="number"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder ?? (nullable ? "off" : undefined)}
        {...draft}
      />
      {suffix && <span className="settings-note field-suffix">{suffix}</span>}
    </span>
  );
}

export function SelectField({
  value, onChange, disabled, label, children,
}: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string; children: React.ReactNode }) {
  return (
    <select className="field" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

/**
 * React's onChange on <input type="color"> fires continuously while the
 * picker is being dragged. `onPreview` gets every intermediate value
 * (cheap, e.g. restyling the page live); `onCommit` only gets the native
 * `change` event fired when the picker closes -- one save, not dozens.
 */
export function ColorField({
  value, onPreview, onCommit, disabled, label,
}: { value: string; onPreview?: (hex: string) => void; onCommit: (hex: string) => void; disabled?: boolean; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => commitRef.current(el.value);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, []);

  return (
    <input
      ref={ref}
      type="color"
      className="color-field"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        onPreview?.(e.target.value);
      }}
    />
  );
}
