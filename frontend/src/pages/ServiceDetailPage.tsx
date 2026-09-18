import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Service, ServiceAction, ServiceConfigState } from "../api/types";
import { ServiceHeader, ServiceBody } from "../components/ServiceHero";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ConfigEditorDialog } from "../components/ConfigEditorDialog";
import { FailureBanner } from "../components/FailureBanner";
import { PendingRestartBanner } from "../components/PendingRestartBanner";
import { LogsDialog } from "../components/LogsDialog";
import { useSnapshot } from "../hooks/SnapshotContext";

export function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const { snapshot } = useSnapshot();
  const [service, setService] = useState<Service | null>(null);
  const [configState, setConfigState] = useState<ServiceConfigState | null>(null);
  const [pendingAction, setPendingAction] = useState<ServiceAction | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!serviceId) return;
    try {
      const data = await api.getService(serviceId);
      setService(data);
      if (data.hasConfig) {
        api.getServiceConfig(serviceId).then(setConfigState).catch(() => undefined);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    // The service list is almost always already in the shared snapshot by
    // the time you navigate here (from Services, or just from being open
    // in the background) -- show it immediately instead of a blank
    // "Loading…" screen, then let the poll below refresh/replace it.
    const cached = snapshot?.services.find((s) => s.id === serviceId) ?? null;
    setService(cached);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  if (!service) {
    return <div className="page">{error ? `Failed to load: ${error}` : "Loading…"}</div>;
  }

  const runAction = async (action: ServiceAction) => {
    if (!serviceId) return;
    setBusy(true);
    try {
      const updated = await api.runAction(serviceId, action.kind);
      setService(updated);
      setPendingAction(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn--ghost" onClick={() => navigate(-1)} style={{ padding: "0 8px" }}>
          ‹ Back
        </button>
      </div>

      <ServiceHeader service={service} />

      {service.failure && <FailureBanner title="SERVICE ISSUE" failure={service.failure} />}

      {configState?.pending && (
        <PendingRestartBanner
          onRestartNow={() => {
            const restart = service.actions.find((a) => a.kind === "restart");
            if (restart) setPendingAction(restart);
          }}
        />
      )}

      <ServiceBody
        service={service}
        onAction={setPendingAction}
        onViewLogs={() => setShowLogs(true)}
        onEditConfig={() => setShowConfigEditor(true)}
      />

      {pendingAction && (
        <ConfirmDialog
          action={pendingAction}
          targetName={service.name}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => runAction(pendingAction)}
        />
      )}

      {showLogs && serviceId && (
        <LogsDialog serviceId={serviceId} serviceName={service.name} onClose={() => setShowLogs(false)} />
      )}

      {showConfigEditor && serviceId && (
        <ConfigEditorDialog
          serviceId={serviceId}
          serviceName={service.name}
          onClose={() => setShowConfigEditor(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
