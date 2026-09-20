import React, { useEffect, useState } from "react";
import { useSnapshot } from "../hooks/SnapshotContext";
import { api } from "../api/client";
import { ServiceCard } from "../components/ServiceCard";
import { HostCard } from "../components/HostCard";
import { FleetOverview } from "../components/FleetOverview";
import { HostMetricWidget, CustomCardWidget } from "../components/HomeWidgets";
import type { HostInfo, Service, Snapshot, WidgetConfig } from "../api/types";

function ServicesGrid({ services, group, title }: { services: Service[]; group?: string | null; title?: string }) {
  const filtered = services.filter((s) => s.visible && (!group || s.group === group));
  if (filtered.length === 0) return null;
  return (
    <div className="card">
      <div className="section-title">{title ?? "SERVICES"}{group ? ` · ${group.toUpperCase()}` : ""}</div>
      <div className="grid grid-2">
        {filtered.map((s) => (
          <ServiceCard key={s.id} service={s} compact />
        ))}
      </div>
    </div>
  );
}

// Which services belong to a host is a config fact (`service.host`,
// matched against the host's own `name` -- not `HostInfo.id`, which is a
// server-computed slug `service.host` never uses), never an assumption
// this code bakes in about which host "usually" runs what. A service
// with no `host:` set, or one that doesn't match any configured host
// (stale/renamed), simply isn't returned here -- callers fall back to
// showing it unassigned rather than silently dropping it.
function servicesForHost(services: Service[], host: HostInfo): Service[] {
  return services.filter((s) => s.visible && s.host === host.name);
}

function Widget({ widget, snapshot }: { widget: WidgetConfig; snapshot: Snapshot }) {
  switch (widget.type) {
    case "host_overview": {
      const host = snapshot.hosts.find((h) => h.id === widget.host_id);
      return host ? <HostCard host={host} services={servicesForHost(snapshot.services, host)} /> : null;
    }
    case "host_metric": {
      const host = snapshot.hosts.find((h) => h.id === widget.host_id);
      if (!host) return null;
      return <HostMetricWidget host={host} metric={widget.metric} display={widget.display} />;
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
// one HostCard per host (now with that host's own services consolidated
// into the same card, rather than a separate flat services list), then
// anything left over. Rendered directly (not as a synthesized widget
// list) whenever dashboard.widgets is empty, so a fresh install looks
// like a sensible default without anyone having to configure a widget.
function DefaultLayout({ hosts, services }: { hosts: HostInfo[]; services: Service[] }) {
  const assignedIds = new Set(hosts.flatMap((host) => servicesForHost(services, host).map((s) => s.id)));
  const unassigned = services.filter((s) => !assignedIds.has(s.id));
  return (
    <>
      {hosts.map((host) => (
        <HostCard key={host.id} host={host} services={servicesForHost(services, host)} />
      ))}
      <ServicesGrid services={unassigned} title="OTHER SERVICES" />
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
