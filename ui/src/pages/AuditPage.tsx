import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.ts";
import { useBclSocket } from "../api/ws.ts";
import type { AuditEvent, ValidationResult } from "../api/types.ts";

const KIND_GROUPS = [
  { label: "All", match: () => true },
  { label: "Migration", match: (k: string) => k.startsWith("migration.") },
  { label: "Validation", match: (k: string) => k.startsWith("validation.") },
  { label: "Topology ops", match: (k: string) => k.startsWith("qm.") || k.startsWith("queue.") || k.startsWith("channel.") },
  { label: "Guardrails", match: (k: string) => k === "guardrail.violation" },
];

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");

  useBclSocket((m) => {
    if (m.type === "audit" && m.event) {
      setEvents((e) => [m.event, ...e].slice(0, 500));
    } else if (m.type === "validation" && m.result) {
      setValidations((v) => [m.result, ...v].slice(0, 200));
    }
  });

  useEffect(() => {
    Promise.all([api.audit(300), api.validations()]).then(([a, v]) => {
      setEvents(a);
      setValidations(v);
    });
  }, []);

  const filtered = useMemo(() => {
    const matcher = KIND_GROUPS[filter].match;
    return events.filter((e) =>
      matcher(e.kind) && (!search || e.message.toLowerCase().includes(search.toLowerCase()) || (e.target ?? "").toLowerCase().includes(search.toLowerCase()))
    );
  }, [events, filter, search]);

  const okCount = validations.filter((v) => v.ok).length;
  const failCount = validations.length - okCount;

  return (
    <div className="wf-grid" style={{ gap: 20 }}>
      <div className="wf-grid wf-grid-4">
        <Kpi label="Audit events" value={events.length} />
        <Kpi label="Validations" value={validations.length} />
        <Kpi label="Validations passed" value={okCount} tone="good" />
        <Kpi label="Validations failed" value={failCount} tone={failCount ? "bad" : "default"} />
      </div>

      <div className="wf-grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div className="wf-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span className="wf-kicker">Audit log (newest first)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {KIND_GROUPS.map((g, i) => (
                <button key={g.label} className={`wf-btn ${i === filter ? "wf-btn-primary" : ""}`} onClick={() => setFilter(i)} style={{ padding: "6px 10px", fontSize: 12 }}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="wf-divider" />
          <input
            placeholder="Filter by message or target (case-insensitive)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--wf-line)", borderRadius: 8, fontFamily: "inherit", fontSize: 13 }}
          />
          <div className="wf-divider" />
          <div className="wf-scroll" style={{ maxHeight: 560 }}>
            <table className="wf-table">
              <thead><tr><th style={{ width: 110 }}>Time</th><th style={{ width: 160 }}>Kind</th><th>Message</th><th style={{ width: 140 }}>Target</th><th style={{ width: 60 }}>OK</th></tr></thead>
              <tbody>
                {filtered.map((ev) => (
                  <tr key={ev.id}>
                    <td className="wf-mono" style={{ color: "var(--wf-mute)" }}>{new Date(ev.ts).toLocaleTimeString()}</td>
                    <td><KindPill kind={ev.kind} /></td>
                    <td>{ev.message}</td>
                    <td className="wf-mono" style={{ color: "var(--wf-mute)" }}>{ev.target ?? "—"}</td>
                    <td>{ev.ok ? <span className="wf-pill wf-pill-good">✓</span> : <span className="wf-pill wf-pill-bad">✗</span>}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={5}><div className="wf-empty">No matching events</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="wf-card">
          <span className="wf-kicker">Validation history</span>
          <div className="wf-divider" />
          <div className="wf-scroll" style={{ maxHeight: 620 }}>
            <table className="wf-table">
              <thead><tr><th>Time</th><th>App</th><th>Sent</th><th>Recv</th><th>Loss</th><th>Dup</th><th>Avg ms</th><th>Result</th></tr></thead>
              <tbody>
                {validations.map((v) => (
                  <tr key={v.id}>
                    <td className="wf-mono" style={{ color: "var(--wf-mute)" }}>{new Date(v.ts).toLocaleTimeString()}</td>
                    <td className="wf-mono">{v.appId}</td>
                    <td>{v.sent}</td>
                    <td>{v.received}</td>
                    <td>{v.lost}</td>
                    <td>{v.duplicates}</td>
                    <td>{v.avgLatencyMs.toFixed(1)}</td>
                    <td><span className={`wf-pill ${v.ok ? "wf-pill-good" : "wf-pill-bad"}`}>{v.ok ? "PASS" : "FAIL"}</span></td>
                  </tr>
                ))}
                {validations.length === 0 && <tr><td colSpan={8}><div className="wf-empty">No validation runs yet</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "bad" }) {
  const accent = tone === "good" ? "var(--wf-good)" : tone === "bad" ? "var(--wf-bad)" : "var(--wf-ink)";
  return (
    <div className="wf-card wf-card-tight" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="wf-kpi">
        <span className="wf-kpi-label">{label}</span>
        <span className="wf-kpi-num" style={{ color: accent }}>{value}</span>
      </div>
    </div>
  );
}

function KindPill({ kind }: { kind: string }) {
  let cls = "wf-pill";
  if (kind.endsWith(".fail") || kind === "guardrail.violation") cls = "wf-pill wf-pill-bad";
  else if (kind.endsWith(".ok") || kind === "migration.complete") cls = "wf-pill wf-pill-good";
  else if (kind.startsWith("migration.")) cls = "wf-pill wf-pill-info";
  else if (kind.startsWith("validation.")) cls = "wf-pill wf-pill-warn";
  return <span className={cls} style={{ fontFamily: "var(--wf-font-mono)", fontSize: 10.5 }}>{kind}</span>;
}
