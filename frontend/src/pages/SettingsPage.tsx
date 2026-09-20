import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useSnapshot } from "../hooks/SnapshotContext";
import { useAuth } from "../hooks/AuthContext";
import {
  CATEGORIES,
  STATIC_SETTINGS,
  categoryOf,
  dynamicSettings,
  searchSettings,
  type CategoryId,
  type SettingEntry,
} from "./settings/registry";
import { Banner, SettingsUiContext, type SaveFn, type SettingsConfig } from "./settings/controls";
import { GeneralSettings } from "./settings/GeneralSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { BrandingSettings } from "./settings/BrandingSettings";
import { LayoutSettings } from "./settings/LayoutSettings";
import { DevicesSettings } from "./settings/DevicesSettings";
import { ServicesSettings } from "./settings/ServicesSettings";
import { AlertsSettings } from "./settings/AlertsSettings";
import { NetworkSettings } from "./settings/NetworkSettings";
import { IntegrationsSettings } from "./settings/IntegrationsSettings";
import { AccessSettings } from "./settings/AccessSettings";
import { AboutSettings } from "./settings/AboutSettings";

type SaveState = "idle" | "saving" | "saved";

/**
 * Category + setting live in the URL (`#/settings?c=alerts&s=alerting.temp_c`)
 * so any other page can deep-link straight to the setting that controls
 * what it's showing, and the search box navigates the same way a link
 * would. On narrow screens this is a master/detail pair -- no `c`/`s` shows
 * the category list, either one shows that category -- purely via CSS on
 * `data-view`; wide screens always show both.
 */
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const [query, setQuery] = useState("");
  const { snapshot } = useSnapshot();
  const { canAct, required: passwordSet, isAdmin, refresh: refreshAuth } = useAuth();

  const navRef = useRef<HTMLElement>(null);
  const configRef = useRef<SettingsConfig | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(0);

  useEffect(() => {
    api.getConfig()
      .then((c) => {
        configRef.current = c;
        setConfig(c);
      })
      .catch(() => {});
  }, []);

  const save: SaveFn = (patch) => {
    pendingRef.current += 1;
    setSaveState("saving");
    setSaveError(null);
    const run = queueRef.current.then(async () => {
      let ok = false;
      try {
        const body = typeof patch === "function" ? patch(configRef.current ?? {}) : patch;
        if (body) {
          const updated = await api.patchConfig(body);
          configRef.current = updated;
          setConfig(updated);
        }
        ok = true;
      } catch (err) {
        // Most fields can't fail validation, but a few can -- notably
        // removing an integration a host is still assigned to. Surface it
        // rather than leaving the UI showing a value that was never saved.
        setSaveError((err as Error).message);
      }
      pendingRef.current -= 1;
      setRevision((r) => r + 1);
      if (pendingRef.current === 0) setSaveState(ok ? "saved" : "idle");
      return ok;
    });
    queueRef.current = run;
    return run;
  };

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState, revision]);

  const entries = useMemo(() => [...STATIC_SETTINGS, ...dynamicSettings(config)], [config]);
  const results = useMemo(() => searchSettings(entries, query), [entries, query]);

  const focusId = params.get("s");
  const requested = params.get("c");
  const linkedCategory = entries.find((e) => e.id === focusId)?.category;
  const active: CategoryId = CATEGORIES.find((c) => c.id === requested)?.id ?? linkedCategory ?? "general";
  const category = categoryOf(active);

  // A setting-only link (?s=host.nas) is resolved to its category once and
  // pinned in the URL -- otherwise renaming that very host would make the
  // id unresolvable and drop the page back to General mid-edit.
  useEffect(() => {
    if (!requested && focusId && linkedCategory) setParams({ c: linkedCategory, s: focusId }, { replace: true });
  }, [requested, focusId, linkedCategory]);

  // Every navigation that names a setting (a search result, a "Used by"
  // chip, a deep link from another page) re-scrolls and re-flashes it,
  // even when it's the same one as last time.
  useEffect(() => {
    if (focusId) setFocusNonce((n) => n + 1);
  }, [location.key]);

  // A deep link to a category below the fold of a scrolled nav (e.g.
  // About at 800x480) should still show which one is selected.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active, query]);

  const openCategory = (id: CategoryId) => setParams({ c: id });
  const jumpTo = (entry: SettingEntry) => setParams({ c: entry.category, s: entry.id });
  const backToList = () => setParams({});

  // Every settings field is a mutating PATCH /api/config -- the backend
  // already rejects these outright under guest mode (docs/security.md);
  // disabling them here too is purely so the UI doesn't show a control
  // that would just fail, not the actual enforcement boundary.
  const disabled = !canAct;
  const sectionProps = { config, onSave: save, disabled };

  return (
    <div className="page settings" data-view={requested || focusId ? "detail" : "master"}>
      <nav ref={navRef} className="settings__nav" aria-label="Settings categories">
        <div className="settings-search">
          <input
            className="field"
            type="search"
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) jumpTo(results[0]);
              if (e.key === "Escape") setQuery("");
            }}
          />
          {query && (
            <button className="settings-search__clear" aria-label="Clear search" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </div>

        {query ? (
          <>
            {results.length === 0 && <div className="settings-note">No settings match “{query}”.</div>}
            <ul className="settings-results" aria-label="Matching settings">
              {results.map((r) => (
                <li key={r.id}>
                  <button className="settings-result" aria-current={r.id === focusId ? "true" : undefined} onClick={() => jumpTo(r)}>
                    <span className="settings-result__label">{r.label}</span>
                    <span className="settings-result__crumb">
                      {categoryOf(r.category).icon} {categoryOf(r.category).label}
                      {r.section ? ` › ${r.section}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          CATEGORIES.map((c) => (
            <button
              key={c.id}
              className="settings-nav__item"
              aria-current={c.id === active ? "page" : undefined}
              onClick={() => openCategory(c.id)}
            >
              <span className="settings-nav__icon" aria-hidden>{c.icon}</span>
              {c.label}
            </button>
          ))
        )}
      </nav>

      <section className="card settings__content" aria-labelledby="settings-heading">
        <div className="settings__heading">
          <button className="btn btn--ghost settings__back" onClick={backToList} aria-label="All settings">
            ‹
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="settings-heading">
              <span aria-hidden style={{ color: "var(--color-primary)", marginRight: 8 }}>{category.icon}</span>
              {category.label}
            </h2>
            <div className="settings-note" style={{ margin: 0 }}>{category.description}</div>
          </div>
          <span className="settings__save-state" aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : ""}
          </span>
        </div>

        {!canAct && <Banner tone="warning">Guest mode is active -- log in (top right) to change settings.</Banner>}
        {saveError && (
          <Banner tone="danger" onDismiss={() => setSaveError(null)}>
            Save failed: {saveError}
          </Banner>
        )}

        <SettingsUiContext.Provider value={{ focusId, focusNonce, revision }}>
          {active === "general" && <GeneralSettings {...sectionProps} />}
          {active === "appearance" && <AppearanceSettings {...sectionProps} hosts={snapshot?.hosts ?? []} />}
          {active === "branding" && <BrandingSettings {...sectionProps} />}
          {active === "layout" && <LayoutSettings {...sectionProps} hosts={snapshot?.hosts ?? []} services={snapshot?.services ?? []} />}
          {active === "devices" && <DevicesSettings {...sectionProps} />}
          {active === "services" && <ServicesSettings {...sectionProps} />}
          {active === "alerts" && <AlertsSettings {...sectionProps} />}
          {active === "network" && <NetworkSettings {...sectionProps} />}
          {active === "integrations" && <IntegrationsSettings {...sectionProps} />}
          {active === "access" && <AccessSettings {...sectionProps} passwordSet={passwordSet} isAdmin={isAdmin} onAuthChanged={refreshAuth} />}
          {active === "about" && <AboutSettings {...sectionProps} />}
        </SettingsUiContext.Provider>
      </section>
    </div>
  );
}
