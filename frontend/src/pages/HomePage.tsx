import React, { useEffect, useState } from "react";
import { useSnapshot } from "../hooks/SnapshotContext";
import { api } from "../api/client";
import { ServiceCard } from "../components/ServiceCard";
import { HostCard } from "../components/HostCard";
import { FleetOverview } from "../components/FleetOverview";
import { HostMetricWidget, CustomCardWidget } from "../components/HomeWidgets";
import type { HostInfo, Service, Snapshot, WidgetConfig } from "../api/types";

function ServicesGrid({ services, group }: { services: Service[]; group?: string | null }) {
  const filtered = services.filter((s) => s.visible && (!group || s.group === group));
  if (filtered.length === 0) return null;
  return (
    <div>
      <div className="section-title">SERVICES{group ? ` · ${group.toUpperCase()}` : ""}</div>
      <div className="grid grid-2">
        {filtered.map((s) => (
          <ServiceCard key={s.id} service={s} compact />
        ))}
      </div>
    </div>
  );
}

function Widget({ widget, snapshot }: { widget: WidgetConfig; snapshot: Snapshot }) {
  switch (widget.type) {
    case "host_overview": {
      const host = snapshot.hosts.find((h) => h.id === widget.host_id);
      return host ? <HostCard host={host} /> : null;
    }
    case "host_metric": {
      const host = snapshot.hosts.find((h) => h.id === widget.host_id);
      if (!host) return null;
      return <HostMetricWidget host={host} metric={widget.metric} display={widget.display ?? "gauge"} />;
    }
    case "services_grid":
      return <ServicesGrid services={snapshot.services} group={widget.group} />;
    case "fleet_overview":
      return <FleetOverview />;
    case "custom_card":
      return <CustomCardWidget widget={widget} />;
    default:
      return null;
  }
}

// The built-in layout every install had before customization existed --
// one HostCard per host, then all visible services. Rendered directly
// (not as a synthesized widget list) whenever dashboard.widgets is empty,
// so a fresh install looks exactly like it always did without anyone
// having to configure a single widget (spec: "keep sensible defaults").
function DefaultLayout({ hosts, services }: { hosts: HostInfo[]; services: Service[] }) {
  return (
    <>
      {hosts.map((host) => (
        <HostCard key={host.id} host={host} />
      ))}
      <ServicesGrid services={services} />
    </>
  );
}

export function HomePage() {
  const { snapshot } = useSnapshot();
  const [widgets, setWidgets] = useState<WidgetConfig[] | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then((config) => setWidgets(((config as any)?.dashboard?.widgets as WidgetConfig[]) ?? []))
      .catch(() => setWidgets([]));
  }, []);

  if (!snapshot || widgets === null) {
    return <div className="page">Loading…</div>;
  }

  return (
    <div className="page">
      {widgets.length === 0 ? (
        <DefaultLayout hosts={snapshot.hosts} services={snapshot.services} />
      ) : (
        widgets.filter((w) => w.visible).map((w) => <Widget key={w.id} widget={w} snapshot={snapshot} />)
      )}
    </div>
  );
}
