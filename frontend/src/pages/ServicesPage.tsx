import React from "react";
import { Link } from "react-router-dom";
import { useSnapshot } from "../hooks/SnapshotContext";
import { StatusPill } from "../components/StatusPill";
import { ServiceIcon } from "../components/ServiceIcon";
import { formatMetricValue } from "../api/format";

export function ServicesPage() {
  const { snapshot } = useSnapshot();
  if (!snapshot) return <div className="page">Loading…</div>;

  const groups = new Map<string, typeof snapshot.services>();
  for (const s of snapshot.services.filter((s) => s.visible)) {
    const key = s.group || "Services";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  return (
    <div className="page">
      {[...groups.entries()].map(([group, services]) => (
        <div key={group}>
          <div className="section-title">{group.toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {services.map((service) => {
              const primary = service.metrics.find((m) => !m.secondary && m.key !== "state");
              return (
                <Link
                  key={service.id}
                  to={`/services/${service.id}`}
                  className="card"
                  style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}
                >
                  <ServiceIcon icon={service.icon} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{service.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                      {service.type.replace("custom:", "")}
                      {service.host ? ` · ${service.host}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <StatusPill status={service.status} />
                    {primary && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: 4 }}>
                        {formatMetricValue(primary.value, primary.type, primary.unit)}
                      </div>
                    )}
                  </div>
                  <span style={{ color: "var(--color-text-faint)" }}>›</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
