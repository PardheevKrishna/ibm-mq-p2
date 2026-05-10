import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { useBclSocket } from "./api/ws.ts";
import { api } from "./api/client.ts";
import TopologyPage from "./pages/TopologyPage.tsx";
import MigrationPage from "./pages/MigrationPage.tsx";
import FleetPage from "./pages/FleetPage.tsx";
import AuditPage from "./pages/AuditPage.tsx";
import "./app.css";

interface AppState {
  bclMode: string;
  qmCount: number;
  ready: boolean;
}

export default function App() {
  const [state, setState] = useState<AppState>({ bclMode: "?", qmCount: 0, ready: false });
  const [activity, setActivity] = useState<{ migrations: number; provisions: number; lastTs: number | null }>({
    migrations: 0, provisions: 0, lastTs: null,
  });

  const wsConnected = useBclSocket((m) => {
    if (m.type === "plan.update" || m.type === "provision.progress") {
      setActivity((a) => ({
        migrations: m.type === "plan.update" ? a.migrations + 1 : a.migrations,
        provisions: m.type === "provision.progress" ? a.provisions + 1 : a.provisions,
        lastTs: Date.now(),
      }));
    }
  });

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await api.ready();
        if (!alive) return;
        setState({ bclMode: r.adapter.mode, qmCount: r.qms, ready: r.ok });
      } catch {
        if (!alive) return;
        setState((s) => ({ ...s, ready: false }));
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="wf-app">
      <aside className="wf-sidebar">
        <div className="wf-brand">
          <BrandMark />
          <div>
            <div className="wf-brand-name">DEMO ORG</div>
            <div className="wf-brand-sub">MQ Topology Control Plane</div>
          </div>
        </div>

        <nav className="wf-nav">
          <NavLink to="/topology" className={navClass}>
            <Icon name="graph" /> Topology
          </NavLink>
          <NavLink to="/migration" className={navClass}>
            <Icon name="run" /> Migration Cockpit
          </NavLink>
          <NavLink to="/fleet" className={navClass}>
            <Icon name="server" /> Fleet · QM Dashboard
          </NavLink>
          <NavLink to="/audit" className={navClass}>
            <Icon name="log" /> Audit & Validation
          </NavLink>
        </nav>

        <div className="wf-sidebar-foot">
          <div className="wf-pill wf-pill-info" style={{ width: "100%", justifyContent: "center" }}>
            BCL · {state.bclMode.toUpperCase()} mode
          </div>
          <div className="wf-pill" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: wsConnected ? "var(--wf-good)" : "var(--wf-bad)" }} />
            {wsConnected ? "WebSocket live" : "WebSocket reconnecting…"}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--wf-mute)", textAlign: "center" }}>
            {state.qmCount} queue managers tracked
          </div>
        </div>
      </aside>

      <main className="wf-main">
        <header className="wf-header">
          <div>
            <div className="wf-kicker">IBM MQ Hackathon · 2026</div>
            <h1 className="wf-title">Topology Migration & Validation</h1>
          </div>
          <div className="wf-header-right">
            <span className={`wf-pill ${state.ready ? "wf-pill-good" : "wf-pill-bad"}`}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: state.ready ? "var(--wf-good)" : "var(--wf-bad)" }} />
              {state.ready ? "BCL ready" : "BCL not ready"}
            </span>
            {activity.lastTs ? (
              <span className="wf-pill wf-pill-info" title={`${activity.migrations} migration updates · ${activity.provisions} provision ticks this session`}>
                {activity.migrations > 0 && <>{activity.migrations} migration{activity.migrations !== 1 ? "s" : ""}</>}
                {activity.migrations > 0 && activity.provisions > 0 && " · "}
                {activity.provisions > 0 && <>{activity.provisions} provision tick{activity.provisions !== 1 ? "s" : ""}</>}
              </span>
            ) : (
              <span className="wf-pill wf-pill-mute" title="No migration or provision events yet this session">
                idle
              </span>
            )}
          </div>
        </header>

        <div className="wf-content">
          <Routes>
            <Route path="/" element={<Navigate to="/topology" replace />} />
            <Route path="/topology" element={<TopologyPage />} />
            <Route path="/migration" element={<MigrationPage />} />
            <Route path="/fleet" element={<FleetPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </div>

        <footer className="wf-foot">
          <span>Demo Org · Middleware Messaging · MQ Control Plane</span>
          <span>v1.0.0 · operable build</span>
        </footer>
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "wf-nav-link wf-nav-link-active" : "wf-nav-link";
}

function BrandMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="10" fill="var(--wf-red)" />
      <rect x="14" y="18" width="36" height="6" fill="var(--wf-gold)" />
      <rect x="14" y="29" width="36" height="6" fill="var(--wf-gold)" />
      <rect x="14" y="40" width="36" height="6" fill="var(--wf-gold)" />
    </svg>
  );
}

function Icon({ name }: { name: "graph" | "run" | "server" | "log" }) {
  const props = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "graph":
      return (<svg {...props}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7.5 7.5l3 9M16.5 7.5l-3 9M8 6h8" /></svg>);
    case "run":
      return (<svg {...props}><path d="M5 3v18l16-9z" /></svg>);
    case "server":
      return (<svg {...props}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><circle cx="7" cy="7" r=".8" fill="currentColor" /><circle cx="7" cy="17" r=".8" fill="currentColor" /></svg>);
    case "log":
      return (<svg {...props}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>);
  }
}
