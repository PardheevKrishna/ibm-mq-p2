import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useBclSocket } from "../api/ws";
import type { Channel, Queue, QueueManager } from "../api/types";

export default function FleetPage() {
  const [qms, setQms] = useState<QueueManager[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "source" | "target">("all");

  useBclSocket((m) => {
    if (m.type === "audit" && /qm\.|queue\.|channel\./.test(m.event?.kind ?? "")) {
      refresh();
    } else if (m.type === "plan.update") {
      refresh();
    }
  });

  async function refresh() {
    const [q, qq, ch] = await Promise.all([api.qms(), api.queues(), api.channels()]);
    setQms(q);
    setQueues(qq);
    setChannels(ch);
  }

  useEffect(() => { refresh(); const id = setInterval(refresh, 4000); return () => clearInterval(id); }, []);

  const filtered = useMemo(() =>
    qms.filter((q) => filter === "all" ? true : filter === "target" ? !!q.isTarget : !q.isTarget)
       .sort((a, b) => a.name.localeCompare(b.name))
  , [qms, filter]);

  const selectedQm = selected ? qms.find((q) => q.name === selected) : undefined;
  const selectedQueues = selected ? queues.filter((q) => q.qm === selected) : [];
  const selectedChannels = selected ? channels.filter((c) => c.fromQm === selected || c.toQm === selected) : [];

  const counts = useMemo(() => ({
    total: qms.length,
    running: qms.filter((q) => q.state === "running").length,
    target: qms.filter((q) => q.isTarget).length,
    sourceLeft: qms.filter((q) => !q.isTarget).length,
  }), [qms]);

  return (
    <div className="wf-grid" style={{ gap: 20 }}>
      <div className="wf-grid wf-grid-4">
        <KpiCard label="Queue managers" value={counts.total} />
        <KpiCard label="Running" value={counts.running} tone="good" />
        <KpiCard label="Target QMs (APPQM_*)" value={counts.target} tone="info" />
        <KpiCard label="Source QMs remaining" value={counts.sourceLeft} tone="warn" />
      </div>

      <div className="wf-card wf-card-tight" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`wf-btn ${filter === "all" ? "wf-btn-primary" : ""}`} onClick={() => setFilter("all")}>All ({counts.total})</button>
          <button className={`wf-btn ${filter === "source" ? "wf-btn-primary" : ""}`} onClick={() => setFilter("source")}>Source legacy ({counts.sourceLeft})</button>
          <button className={`wf-btn ${filter === "target" ? "wf-btn-primary" : ""}`} onClick={() => setFilter("target")}>Target dedicated ({counts.target})</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--wf-mute)" }}>
          Click any tile to inspect queues, channels, and probes
        </div>
      </div>

      <div className="wf-grid wf-grid-3">
        {filtered.map((qm) => <QmCard key={qm.name} qm={qm} selected={qm.name === selected} onSelect={() => setSelected(qm.name)} />)}
      </div>

      {selectedQm && (
        <div className="wf-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="wf-kicker">Inspecting</span>
              <h2 style={{ margin: "4px 0 0", fontFamily: "var(--wf-font-mono)" }}>{selectedQm.name}</h2>
              <div style={{ color: "var(--wf-mute)", fontSize: 12 }}>
                {selectedQm.region ?? "?"} · {selectedQm.zone ?? "?"} · DLQ: <span className="wf-mono">{selectedQm.dlq}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="wf-btn" onClick={() => setSelected("")}>Close</button>
              <button className="wf-btn wf-btn-primary" onClick={async () => { await api.qmHealth(selectedQm.name); }}>Probe health</button>
            </div>
          </div>
          <div className="wf-divider" />
          <div className="wf-grid wf-grid-2">
            <div>
              <span className="wf-kicker">Queues ({selectedQueues.length})</span>
              <div className="wf-divider" style={{ margin: "8px 0" }} />
              <div className="wf-scroll" style={{ maxHeight: 320 }}>
                <table className="wf-table">
                  <thead><tr><th>Name</th><th>Type</th><th>App</th><th>Routing</th></tr></thead>
                  <tbody>
                    {selectedQueues.map((q) => (
                      <tr key={q.name}>
                        <td className="wf-mono">{q.name}</td>
                        <td><span className={`wf-pill ${q.type === "Remote" ? "wf-pill-info" : ""}`}>{q.type}</span></td>
                        <td>{q.appId}</td>
                        <td className="wf-mono" style={{ fontSize: 11.5, color: "var(--wf-mute)" }}>{q.type === "Remote" ? `${q.rname}@${q.rqmname} via ${q.xmitq}` : "—"}</td>
                      </tr>
                    ))}
                    {selectedQueues.length === 0 && <tr><td colSpan={4} style={{ color: "var(--wf-mute)", textAlign: "center" }}>No queues</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <span className="wf-kicker">Channels ({selectedChannels.length})</span>
              <div className="wf-divider" style={{ margin: "8px 0" }} />
              <div className="wf-scroll" style={{ maxHeight: 320 }}>
                <table className="wf-table">
                  <thead><tr><th>Name</th><th>Kind</th><th>TLS</th><th>MCAUSER</th></tr></thead>
                  <tbody>
                    {selectedChannels.map((c) => (
                      <tr key={c.name}>
                        <td className="wf-mono">{c.name}</td>
                        <td><span className="wf-pill">{c.kind}</span></td>
                        <td><span className="wf-pill wf-pill-good">{c.sslCipher.slice(0, 18)}…</span></td>
                        <td className="wf-mono" style={{ fontSize: 11.5 }}>{c.mcaUser}</td>
                      </tr>
                    ))}
                    {selectedChannels.length === 0 && <tr><td colSpan={4} style={{ color: "var(--wf-mute)", textAlign: "center" }}>No channels</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "good" | "warn" | "info" }) {
  const accent =
    tone === "good" ? "var(--wf-good)" :
    tone === "warn" ? "var(--wf-warn)" :
    tone === "info" ? "var(--wf-red)" :
    "var(--wf-ink)";
  return (
    <div className="wf-card wf-card-tight" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="wf-kpi">
        <span className="wf-kpi-label">{label}</span>
        <span className="wf-kpi-num" style={{ color: accent }}>{value}</span>
      </div>
    </div>
  );
}

function QmCard({ qm, selected, onSelect }: { qm: QueueManager; selected: boolean; onSelect: () => void }) {
  const healthColor = qm.health === "ok" ? "var(--wf-good)" : qm.health === "down" ? "var(--wf-bad)" : "var(--wf-warn)";
  return (
    <div
      className="wf-card"
      onClick={onSelect}
      style={{
        cursor: "pointer",
        borderColor: selected ? "var(--wf-red)" : qm.isTarget ? "var(--wf-red)" : "var(--wf-line)",
        borderWidth: selected ? 2 : 1,
        boxShadow: selected ? "var(--wf-shadow)" : "var(--wf-shadow-sm)",
        transition: "all 120ms ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: healthColor, boxShadow: `0 0 0 3px ${healthColor}22` }} />
          <span className="wf-mono" style={{ fontWeight: 700, fontSize: 14 }}>{qm.name}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {qm.isTarget && <span className="wf-pill wf-pill-info">TARGET</span>}
          <span className={`wf-pill ${qm.state === "running" ? "wf-pill-good" : qm.state === "provisioning" ? "wf-pill-warn" : "wf-pill-mute"}`}>{qm.state}</span>
        </div>
      </div>
      <div className="wf-divider" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
        <Stat label="Region" value={qm.region ?? "—"} />
        <Stat label="Zone" value={qm.zone ?? "—"} />
        <Stat label="Listener" value={`:${qm.listenerPort}`} />
        <Stat label="Console" value={`:${qm.consolePort}`} />
        <Stat label="DLQ" value={qm.dlq.split(".").slice(-2).join(".")} />
        <Stat label="TLS" value={qm.tls.enabled ? "✓ enabled" : "off"} tone={qm.tls.enabled ? "good" : "bad"} />
      </div>
      <div className="wf-divider" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {qm.apps.length === 0 ? (
          <span className="wf-pill wf-pill-mute">no app bindings yet</span>
        ) : qm.apps.map((a) => (
          <span key={a} className="wf-pill wf-pill-info" style={{ fontFamily: "var(--wf-font-mono)" }}>{a}</span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "var(--wf-good)" : tone === "bad" ? "var(--wf-bad)" : "var(--wf-ink)";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--wf-mute)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 2, color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
