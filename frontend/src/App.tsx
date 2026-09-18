import React, { useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { applyAccentColor } from "./api/color";
import { Header } from "./components/Header";
import { BottomNav } from "./components/BottomNav";
import { HomePage } from "./pages/HomePage";
import { ServicesPage } from "./pages/ServicesPage";
import { ServiceDetailPage } from "./pages/ServiceDetailPage";
import { SystemPage } from "./pages/SystemPage";
import { NetworkPage } from "./pages/NetworkPage";
import { AlertsPage } from "./pages/AlertsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { SnapshotProvider, useSnapshot } from "./hooks/SnapshotContext";
import { AuthProvider, useAuth } from "./hooks/AuthContext";

const SUBTITLES: Record<string, string> = {
  "/": "System Overview",
  "/services": "Services",
  "/network": "Network Status",
  "/system": "System Metrics",
  "/alerts": "Alerts",
  "/settings": "Settings & System",
};

function Shell({ children }: { children: React.ReactNode }) {
  const { snapshot } = useSnapshot();
  const subtitle = SUBTITLES[window.location.hash.replace("#", "") || "/"] ?? "Overview";
  const dashboard = snapshot?.dashboard;

  // Applies config-driven appearance on every snapshot (cheap -- just a
  // few attribute/property writes) rather than only when Settings
  // changes something in this session -- fixes a real gap main.tsx had
  // on its own: theme was hardcoded to "dark" at boot and only ever
  // matched config.yml if you happened to change it via Settings first.
  useEffect(() => {
    if (!dashboard) return;
    document.documentElement.setAttribute("data-theme", dashboard.theme);
    document.documentElement.setAttribute("data-density", dashboard.density);
    applyAccentColor(dashboard.accentColor);
  }, [dashboard]);

  return (
    <div className="app-shell">
      <Header
        title={(snapshot?.dashboard.title ?? "My Homelab").toUpperCase()}
        subtitle={snapshot?.dashboard.tagline || subtitle}
        overallStatus={snapshot?.overallStatus ?? "unknown"}
      />
      {children}
      <BottomNav />
    </div>
  );
}

function Gate() {
  const { loading, required, authenticated } = useAuth();

  // Blank rather than a flash of the login screen while the very first
  // /api/auth/status check is in flight -- most installs never set
  // DASHBOARD_PASSWORD, so this resolves to "not required" almost
  // instantly.
  if (loading) return <div style={{ height: "100%", background: "var(--color-bg)" }} />;
  if (required && !authenticated) return <LoginPage />;

  return (
    <SnapshotProvider>
      <HashRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Shell>
      </HashRouter>
    </SnapshotProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
