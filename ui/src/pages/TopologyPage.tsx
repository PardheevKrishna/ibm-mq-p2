import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useBclSocket } from "../api/ws";
import type { Topology } from "../api/types";
import TopologyGraph from "../components/TopologyGraph";

interface ProvisionProgress {
  total: number; done: number; failed: number; status: string; errors: string[];
}

export default function TopologyPage() {
  const [source, setSource] = useState<Topology | null>(null);
  const [target, setTarget] = useState<Topology | null>(null);
  const [highlight, setHighlight] = useState<string | "">("");
  const [prov, setProv] = useState<ProvisionProgress>({ total: 0, done: 0, failed: 0, status: "idle", errors: [] });
  const [provBusy, setProvBusy] = useState(false);

  useBclSocket((m) => {
    if (m.type === "provision.progress" && m.progress) {
      setProv(m.progress);
      if (m.progress.status !== "running") setProvBusy(false);
    }
  });

  async function provisionSource() {
    setProvBusy(true);
    try {
      await api.provisionSource();
    } catch {
      setProvBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    api.provisionSourceStatus().then((s) => { if (alive) setProv(s); }).catch(() => undefined);
    Promise.all([api.source(), api.target()]).then(([s, t]) => {
      if (!alive) return;
      setSource(s); setTarget(t);
    });
    return () => { alive = false; };
  }, []);

  const apps = source?.apps ?? [];

  const stats = useMemo(() => {
    if (!source || !target) return null;
    return {
      sourceQms: Object.keys(source.qms).length,
      targetQms: Object.keys(target.qms).length,
      sourceQueues: source.queues.length,
      targetQueues: target.queues.length,
      sourceChannels: source.channels.length,
      targetChannels: target.channels.length,
      flows: source.flows.length,
      apps: source.apps.length,
    };
  }, [source, target]);

  if (!source || !target) {
    return <div className="wf-empty"><span className="wf-spinner" /> Loading topology…</div>;
  }

  const provPct = prov.total > 0 ? Math.round((prov.done / prov.total) * 100) : 0;

  return (
    <div className="wf-grid" style={{ gap: 20 }}>

      {/* ── Provision Source Topology banner ───────────────────────────── */}
      <div className="wf-card" style={{
        borderLeft: `4px solid ${
          prov.status === "complete" ? "var(--wf-good)" :
          prov.status === "failed"   ? "var(--wf-bad)" :
          prov.status === "running"  ? "var(--wf-warn)" :
          "var(--wf-red)"
        }`
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <span className="wf-kicker">Step 1 — Source topology provisioning</span>
            <div style={{ marginTop: 4, fontSize: 13, color: "var(--wf-slate)" }}>
              Provision all source QMs, queues, channels, and transmit queues through the BCL.
              <br />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {prov.status === "complete" && <span className="wf-pill wf-pill-good">✓ provisioned</span>}
            {prov.status === "failed"   && <span className="wf-pill wf-pill-bad">✗ partial failure</span>}
            {prov.status === "running"  && <span className="wf-pill wf-pill-warn"><span className="wf-spinner" /> provisioning…</span>}
            <button
              className={`wf-btn ${prov.status === "idle" ? "wf-btn-primary" : "wf-btn"}`}
              onClick={provisionSource}
              disabled={provBusy || prov.status === "running"}
            >
              {prov.status === "complete" ? "Re-provision source" : prov.status === "running" ? "Provisioning…" : "Provision source topology"}
            </button>
          </div>
        </div>

        {prov.total > 0 && (
          <>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--wf-mute)", marginBottom: 4 }}>
                <span>{prov.done} of {prov.total} operations complete</span>
                <span>{prov.failed > 0 ? `${prov.failed} failed` : ""} {provPct}%</span>
              </div>
              <div style={{ height: 8, background: "var(--wf-line-soft)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${provPct}%`, height: "100%", borderRadius: 4,
                  background: prov.failed > 0 ? "var(--wf-bad)" : prov.status === "complete" ? "var(--wf-good)" : "var(--wf-red)",
                  transition: "width 300ms ease",
                }} />
              </div>
            </div>
            {prov.errors.length > 0 && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--wf-bad-50)", borderRadius: 6 }}>
                <div style={{ fontWeight: 600, color: "var(--wf-bad)", fontSize: 12, marginBottom: 4 }}>Errors:</div>
                {prov.errors.slice(0, 5).map((e, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: "var(--wf-bad)", fontFamily: "var(--wf-font-mono)" }}>{e}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* KPI strip */}
      <div className="wf-grid wf-grid-4">
        <div className="wf-card wf-card-tight"><div className="wf-kpi"><span className="wf-kpi-label">Applications (7 total)</span><span className="wf-kpi-num">{stats?.apps}</span></div></div>
        <div className="wf-card wf-card-tight"><div className="wf-kpi"><span className="wf-kpi-label">Source QMs → Target QMs</span><span className="wf-kpi-num">{stats?.sourceQms} → {stats?.targetQms}</span></div></div>
        <div className="wf-card wf-card-tight"><div className="wf-kpi"><span className="wf-kpi-label">Total Flows</span><span className="wf-kpi-num">{stats?.flows}</span></div></div>
        <div className="wf-card wf-card-tight"><div className="wf-kpi"><span className="wf-kpi-label">Channels target</span><span className="wf-kpi-num">{stats?.targetChannels}</span></div></div>
      </div>

          {/* Controls removed per request */}

      {/* Legend */}
      <div className="wf-card wf-card-tight" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <span className="wf-kicker">Legend</span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--wf-red)" strokeWidth="2" /></svg>
          Remote (cross-QM, channel-routed)
        </span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--wf-mute)" strokeWidth="1.5" strokeDasharray="4 4" /></svg>
          Local / app binding
        </span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, border: "2px solid var(--wf-red)", background: "white" }} /> Target QM
        </span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--wf-good)" }} /> healthy
          <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--wf-warn)", marginLeft: 6 }} /> starting
          <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--wf-bad)", marginLeft: 6 }} /> down
        </span>
      </div>

      <div className="wf-grid wf-grid-2">
        <TopologyPanel title="Source topology" subtitle="Shared queue managers · co-located queues" topology={source} highlight={highlight || undefined} variant="source" onAppClick={(id) => setHighlight((h) => h === id ? "" : id)} />
        <TopologyPanel title="Target topology" subtitle="Each app on its dedicated APPQM_* · transparent rewiring" topology={target} highlight={highlight || undefined} variant="target" onAppClick={(id) => setHighlight((h) => h === id ? "" : id)} />
      </div>
    </div>
  );
}

function TopologyPanel({ title, subtitle, topology, highlight, variant, onAppClick }: {
  title: string; subtitle: string; topology: Topology; highlight?: string; variant: "source"|"target";
  onAppClick?: (appId: string) => void;
}) {
  return (
    <div className="wf-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="wf-kicker">{variant === "target" ? "Future state" : "Current"}</span>
          <h2 style={{ margin: "4px 0 2px", fontSize: 17 }}>{title}</h2>
          <div style={{ color: "var(--wf-mute)", fontSize: 12 }}>
            {subtitle}
            {onAppClick && <span style={{ marginLeft: 8, color: "var(--wf-mute)", fontSize: 11 }}>· click a node to highlight</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="wf-pill">{Object.keys(topology.qms).length} QMs</span>
          <span className="wf-pill">{topology.queues.length} queues</span>
          <span className="wf-pill">{topology.channels.length} channels</span>
        </div>
      </div>
      <div className="wf-divider" />
      <TopologyGraph topology={topology} highlightAppId={highlight} variant={variant} onAppClick={onAppClick} />
    </div>
  );
}
