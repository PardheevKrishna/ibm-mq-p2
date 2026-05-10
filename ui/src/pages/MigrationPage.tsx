import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.ts";
import { useBclSocket } from "../api/ws.ts";
import type { AppRef, MigrationPlan, Topology, ValidationResult } from "../api/types.ts";
import TopologyGraph from "../components/TopologyGraph.tsx";

const PHASES: Array<MigrationPlan["steps"][number]["phase"]> = ["STAGE", "WIRE", "CUTOVER", "VERIFY", "CLEAN"];

export default function MigrationPage() {
  const [apps, setApps] = useState<AppRef[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>("");
  const [plans, setPlans] = useState<Record<string, MigrationPlan>>({});
  const [activePlanId, setActivePlanId] = useState<string>("");
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [current, setCurrent] = useState<Topology | null>(null);

  async function refreshCurrent() {
    try { setCurrent(await api.current()); } catch { /* ignore */ }
  }

  useBclSocket((m) => {
    if (m.type === "plan.update" && m.plan) {
      setPlans((p) => ({ ...p, [m.plan.id]: m.plan }));
      // Topology mutates as steps run — pull a fresh snapshot.
      refreshCurrent();
    } else if (m.type === "validation" && m.result) {
      setValidations((v) => [m.result, ...v].slice(0, 50));
    } else if (m.type === "audit") {
      refreshCurrent();
    }
  });

  useEffect(() => {
    let alive = true;
    Promise.all([api.source(), api.plans(), api.validations(), api.current()]).then(([s, ps, vs, c]) => {
      if (!alive) return;
      setApps(s.apps);
      if (s.apps.length && !selectedApp) setSelectedApp(s.apps[0].appId);
      const map: Record<string, MigrationPlan> = {};
      for (const p of ps) map[p.id] = p;
      setPlans(map);
      setValidations(vs);
      setCurrent(c);
    });
    // Slow poll as a safety net in case a WS frame is dropped.
    const id = setInterval(refreshCurrent, 5000);
    return () => { alive = false; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePlan = activePlanId ? plans[activePlanId] : undefined;
  const orderedPlans = useMemo(() => Object.values(plans).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [plans]);

  // When the selected app changes, auto-pick the most recent plan for that app
  // so the steps table, phase bars, and rollback button all track the right plan.
  // We use a ref for orderedPlans so this effect doesn't re-fire on every WS tick.
  const orderedPlansRef = useRef(orderedPlans);
  orderedPlansRef.current = orderedPlans;
  useEffect(() => {
    if (!selectedApp) return;
    const latest = orderedPlansRef.current.find((p) => p.appId === selectedApp);
    setActivePlanId(latest?.id ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApp]);

  const selectedAppComplete = useMemo(
    () => orderedPlans.some((p) => p.appId === selectedApp && p.status === "complete"),
    [orderedPlans, selectedApp]
  );
  const selectedAppExecuting = useMemo(
    () => orderedPlans.some((p) => p.appId === selectedApp && p.status === "executing"),
    [orderedPlans, selectedApp]
  );

  // Rollback is only meaningful for plans whose ops actually mutated state.
  // - draft: nothing was applied → nothing to undo
  // - executing: in flight; auto-rollback fires on failure, manual rollback would race
  // - rolled_back: already reverted
  // - complete / failed: real candidates for manual rollback
  const rollbackState = useMemo<{ canRollback: boolean; reason: string }>(() => {
    if (!activePlan) return { canRollback: false, reason: "Select a plan from Recent plans, or draft one first" };
    switch (activePlan.status) {
      case "draft":       return { canRollback: false, reason: "Plan not yet executed — nothing to roll back" };
      case "executing":   return { canRollback: false, reason: "Migration in progress — wait for it to finish" };
      case "rolled_back": return { canRollback: false, reason: "Already rolled back" };
      case "complete":    return { canRollback: true,  reason: "Roll back this completed migration" };
      case "failed":      return { canRollback: true,  reason: "Roll back partially-applied changes" };
      default:            return { canRollback: false, reason: "" };
    }
  }, [activePlan]);

  async function draft() {
    if (!selectedApp) return;
    if (selectedAppComplete) {
      alert(`${selectedApp} is already fully migrated. Roll back the existing plan first before re-migrating.`);
      return;
    }
    if (selectedAppExecuting) {
      alert(`${selectedApp} already has a migration in progress. Wait for it to finish or roll it back first.`);
      return;
    }
    const p = await api.draftPlan(selectedApp);
    setPlans((m) => ({ ...m, [p.id]: p }));
    setActivePlanId(p.id);
  }
  async function execute() {
    if (!activePlan) return;
    await api.executePlan(activePlan.id);
  }
  async function rollback() {
    if (!activePlan) return;
    await api.rollbackPlan(activePlan.id);
  }
  async function rollbackAll() {
    await api.rollbackAll();
  }

  const stopAllRef = useRef(false);
  const [migrateAllRunning, setMigrateAllRunning] = useState(false);

  async function migrateAll() {
    if (migrateAllRunning) {
      stopAllRef.current = true;
      return;
    }
    stopAllRef.current = false;
    setMigrateAllRunning(true);
    const pending = apps.filter((a) => {
      const st = orderedPlansRef.current.find((p) => p.appId === a.appId)?.status;
      return st !== "complete" && st !== "executing";
    });
    for (const app of pending) {
      if (stopAllRef.current) break;
      try {
        const p = await api.draftPlan(app.appId);
        setPlans((m) => ({ ...m, [p.id]: p }));
        setActivePlanId(p.id);
        setSelectedApp(app.appId);
        await api.executePlan(p.id);
        // Poll until this plan reaches a terminal state before moving to the next app.
        let done = false;
        while (!done && !stopAllRef.current) {
          await new Promise((r) => setTimeout(r, 600));
          try {
            const latest = await api.plan(p.id);
            setPlans((m) => ({ ...m, [latest.id]: latest }));
            done = latest.status === "complete" || latest.status === "failed" || latest.status === "rolled_back";
          } catch { done = true; }
        }
      } catch { /* plan blocked or network error — skip this app */ }
    }
    setMigrateAllRunning(false);
  }

  return (
    <div className="wf-grid" style={{ gap: 20 }}>
      {/* Top control bar */}
      <div className="wf-card">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <span className="wf-kicker">Select application</span>
            <div style={{ marginTop: 6 }}>
              <AppPicker apps={apps} plans={orderedPlans} value={selectedApp} onChange={setSelectedApp} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <button
              className="wf-btn"
              onClick={draft}
              disabled={selectedAppComplete || selectedAppExecuting}
              title={
                selectedAppComplete ? "Already migrated — roll back first" :
                selectedAppExecuting ? "Migration in progress" : undefined
              }
            >
              {selectedAppComplete ? "Already migrated" : selectedAppExecuting ? "Migrating…" : "Plan migration"}
            </button>
            <button
              className="wf-btn wf-btn-primary"
              onClick={execute}
              disabled={
                !activePlan ||
                activePlan.status === "executing" ||
                activePlan.status === "complete" ||
                activePlan.status === "rolled_back"
              }
              title={
                activePlan?.status === "complete" ? "Already executed — roll back first to re-run" :
                activePlan?.status === "rolled_back" ? "Plan was rolled back — draft a new plan" :
                undefined
              }
            >
              {activePlan?.status === "executing" ? <><span className="wf-spinner" /> Executing…</> : "Execute plan"}
            </button>
            <button
              className="wf-btn wf-btn-danger"
              onClick={rollback}
              disabled={!rollbackState.canRollback}
              title={rollbackState.reason}
            >
              Rollback this plan
            </button>
            <button className="wf-btn" onClick={rollbackAll} disabled={migrateAllRunning}>Rollback ALL → source</button>
            <button
              className={`wf-btn ${migrateAllRunning ? "wf-btn-danger" : "wf-btn-primary"}`}
              onClick={migrateAll}
              title={migrateAllRunning ? "Stop after current app finishes" : "Plan + execute migrations for all non-migrated apps sequentially"}
            >
              {migrateAllRunning ? <><span className="wf-spinner" /> Stop migrate all</> : "Migrate ALL apps"}
            </button>
          </div>
        </div>
      </div>

      <div className="wf-grid" style={{ gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        {/* Plan + steps */}
        <div className="wf-card" style={{ minHeight: 420 }}>
          {!activePlan ? (
            <div className="wf-empty">
              No plan selected. Choose an application and click <strong>Plan migration</strong> to draft a sequenced, idempotent step list.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="wf-kicker">Migration plan</span>
                  <h2 style={{ margin: "4px 0 0" }}>
                    {activePlan.appId}
                    <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 500, color: "var(--wf-mute)" }}>
                      plan id <span className="wf-mono">{activePlan.id}</span>
                    </span>
                  </h2>
                </div>
                <PlanStatusBadge status={activePlan.status} />
              </div>
              <div className="wf-divider" />
              <PhaseProgress key={activePlan.id} plan={activePlan} />
              <div className="wf-divider" />
              <StepsTable plan={activePlan} />
            </>
          )}
        </div>

        {/* Recent plans + validations */}
        <div className="wf-grid" style={{ gridTemplateColumns: "1fr", gap: 16 }}>
          <div className="wf-card">
            <span className="wf-kicker">Recent plans</span>
            <div className="wf-divider" />
            {orderedPlans.length === 0 ? (
              <div style={{ color: "var(--wf-mute)", fontSize: 12.5 }}>No plans yet — draft one to get started.</div>
            ) : (
              <table className="wf-table">
                <thead><tr><th>App</th><th>Steps</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {orderedPlans.slice(0, 8).map((p) => (
                    <tr key={p.id} onClick={() => setActivePlanId(p.id)} style={{ cursor: "pointer" }}>
                      <td className="wf-mono">{p.appId}</td>
                      <td>{p.steps.length}</td>
                      <td><PlanStatusBadge status={p.status} compact /></td>
                      <td>{activePlanId === p.id ? <span className="wf-pill wf-pill-info">selected</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="wf-card">
            <span className="wf-kicker">Latest validation runs</span>
            <div className="wf-divider" />
            {validations.length === 0 ? (
              <div style={{ color: "var(--wf-mute)", fontSize: 12.5 }}>No validations yet. The VERIFY step in any plan triggers one automatically.</div>
            ) : (
              <table className="wf-table">
                <thead><tr><th>App</th><th>Sent</th><th>Recv</th><th>Loss</th><th>Dup</th><th>Latency</th><th>Result</th></tr></thead>
                <tbody>
                  {validations.slice(0, 6).map((v) => (
                    <tr key={v.id}>
                      <td className="wf-mono">{v.appId}</td>
                      <td>{v.sent}</td>
                      <td>{v.received}</td>
                      <td>{v.lost}</td>
                      <td>{v.duplicates}</td>
                      <td>{v.avgLatencyMs.toFixed(1)} ms</td>
                      <td><span className={`wf-pill ${v.ok ? "wf-pill-good" : "wf-pill-bad"}`}>{v.ok ? "PASS" : "FAIL"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Live working state ─────────────────────────────────────────── */}
      <div className="wf-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div>
            <span className="wf-kicker">Live working state</span>
            <h2 style={{ margin: "4px 0 2px", fontSize: 17 }}>BCL fleet — current view</h2>
            <div style={{ color: "var(--wf-mute)", fontSize: 12 }}>
              Reflects the BCL's current topology. Updates over WebSocket as migrations and rollbacks run.
            </div>
          </div>
          {current && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="wf-pill">{Object.keys(current.qms).length} QMs</span>
              <span className="wf-pill">{current.queues.length} queues</span>
              <span className="wf-pill">{current.channels.length} channels</span>
              {activePlan && (
                <span className="wf-pill wf-pill-info">
                  highlighting {activePlan.appId}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="wf-divider" />
        {!current ? (
          <div className="wf-empty"><span className="wf-spinner" /> Loading live topology…</div>
        ) : (
          <TopologyGraph
            topology={current}
            highlightAppId={activePlan?.appId || selectedApp || undefined}
            variant="source"
            onAppClick={(id) => { setSelectedApp(id); setActivePlanId(orderedPlansRef.current.find((p) => p.appId === id)?.id ?? ""); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── App status colour map ────────────────────────────────────────────────────
type AppMigStatus = MigrationPlan["status"] | "idle";

const APP_STATUS_META: Record<AppMigStatus, { dot: string; bg: string; label: string }> = {
  idle:        { dot: "#9CA3AF",          bg: "transparent",         label: "Not started" },
  draft:       { dot: "#6366F1",          bg: "rgba(99,102,241,.08)", label: "Plan ready" },
  executing:   { dot: "var(--wf-warn)",   bg: "var(--wf-warn-50)",   label: "Migrating…" },
  complete:    { dot: "var(--wf-good)",   bg: "var(--wf-good-50)",   label: "Migrated" },
  failed:      { dot: "var(--wf-bad)",    bg: "var(--wf-bad-50)",    label: "Failed" },
  rolled_back: { dot: "var(--wf-gold-dark)", bg: "var(--wf-gold-50)", label: "Rolled back" },
};

function appMigStatus(appId: string, plans: MigrationPlan[]): AppMigStatus {
  // plans is already sorted newest-first
  return plans.find((p) => p.appId === appId)?.status ?? "idle";
}

function AppPicker({ apps, plans, value, onChange }: {
  apps: AppRef[];
  plans: MigrationPlan[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const selectedApp = apps.find((a) => a.appId === value);
  const selStatus = value ? appMigStatus(value, plans) : "idle";
  const selMeta = APP_STATUS_META[selStatus];

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 360 }}>
      {/* Trigger */}
      <button
        className="wf-btn"
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", justifyContent: "space-between" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <StatusDot color={selMeta.dot} pulsing={selStatus === "executing"} />
          <span style={{ fontWeight: 500 }}>
            {selectedApp ? `${selectedApp.appId} — ${selectedApp.appName.slice(0, 32)}` : "Select application…"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {selStatus !== "idle" && (
            <span style={{ fontSize: 10.5, color: selMeta.dot, fontWeight: 600 }}>{selMeta.label}</span>
          )}
          <span style={{ color: "var(--wf-mute)", fontSize: 10, marginLeft: 2 }}>▾</span>
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: "var(--wf-white)", border: "1px solid var(--wf-line)", borderRadius: 10,
          boxShadow: "0 8px 28px rgba(28,18,12,.13)", overflow: "hidden",
        }}>
          {apps.map((a) => {
            const st = appMigStatus(a.appId, plans);
            const m = APP_STATUS_META[st];
            const isSelected = a.appId === value;
            return (
              <div
                key={a.appId}
                onClick={() => { onChange(a.appId); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", cursor: "pointer", gap: 12,
                  background: isSelected ? m.bg || "var(--wf-red-50)" : "transparent",
                  borderBottom: "1px solid var(--wf-line-soft)",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--wf-cream)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? (m.bg || "var(--wf-red-50)") : "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusDot color={m.dot} pulsing={st === "executing"} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400, color: "var(--wf-ink)" }}>{a.appId}</div>
                    <div style={{ fontSize: 11, color: "var(--wf-mute)", marginTop: 1 }}>{a.appName.slice(0, 44)}</div>
                  </div>
                </div>
                <span style={{
                  fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap", padding: "2px 8px",
                  borderRadius: 20, background: m.bg, color: m.dot,
                  border: `1px solid ${m.dot}22`,
                }}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusDot({ color, pulsing }: { color: string; pulsing?: boolean }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, flexShrink: 0 }}>
      <span style={{
        width: 10, height: 10, borderRadius: "50%", background: color, display: "block",
        ...(pulsing ? { boxShadow: `0 0 0 3px ${color}44`, animation: "wf-pulse 1.4s ease-in-out infinite" } : {}),
      }} />
    </span>
  );
}

function PlanStatusBadge({ status, compact }: { status: MigrationPlan["status"]; compact?: boolean }) {
  const map: Record<MigrationPlan["status"], { cls: string; label: string }> = {
    draft:       { cls: "wf-pill",          label: "Draft" },
    executing:   { cls: "wf-pill wf-pill-info", label: "Executing" },
    complete:    { cls: "wf-pill wf-pill-good", label: "Complete" },
    failed:      { cls: "wf-pill wf-pill-bad",  label: "Failed" },
    rolled_back: { cls: "wf-pill wf-pill-warn", label: "Rolled back" },
  };
  const s = map[status];
  return <span className={s.cls} style={compact ? { fontSize: 10.5, padding: "2px 8px" } : undefined}>{s.label}</span>;
}

function PhaseProgress({ plan }: { plan: MigrationPlan }) {
  // Imperative width: React must NOT own the `width` style property — if it
  // does, every render rewrites it and the CSS transition restarts from 0.
  // Inline ref callbacks have the same problem (React calls them with null
  // then element on every render, clearing our Map). Use STABLE per-phase
  // refs via useMemo so React only calls them on real mount/unmount.
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  const refCallbacks = useMemo(
    () => PHASES.map((_, i) => (el: HTMLDivElement | null) => {
      if (el && barRefs.current[i] !== el) {
        // First attach (mount or post-key remount): start at 0% so the
        // first effect animates 0 → current.
        el.style.width = "0%";
      }
      barRefs.current[i] = el;
    }),
    []
  );

  useEffect(() => {
    for (let i = 0; i < PHASES.length; i++) {
      const el = barRefs.current[i];
      if (!el) continue;
      const inPhase = plan.steps.filter((s) => s.phase === PHASES[i]);
      const done = inPhase.filter((s) => s.status === "ok").length;
      const pct = inPhase.length === 0 ? 0 : Math.round((done / inPhase.length) * 100);
      el.style.width = `${pct}%`;
    }
  }, [plan]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
      {PHASES.map((phase, i) => {
        const inPhase = plan.steps.filter((s) => s.phase === phase);
        const done = inPhase.filter((s) => s.status === "ok").length;
        const failed = inPhase.some((s) => s.status === "failed");
        const running = inPhase.some((s) => s.status === "running");
        const color = failed ? "var(--wf-bad)" : running ? "var(--wf-warn)" : done === inPhase.length && inPhase.length > 0 ? "var(--wf-good)" : "var(--wf-line)";
        return (
          <div key={phase} style={{ border: "1px solid var(--wf-line)", borderRadius: 10, padding: "10px 12px", background: "var(--wf-white)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 11.5, letterSpacing: "0.06em", color: "var(--wf-ink)" }}>{phase}</strong>
              <span style={{ fontSize: 11, color: "var(--wf-mute)" }}>{done}/{inPhase.length}</span>
            </div>
            <div style={{ marginTop: 8, height: 6, background: "var(--wf-line-soft)", borderRadius: 3, overflow: "hidden" }}>
              <div
                ref={refCallbacks[i]}
                style={{ height: "100%", background: color, transition: "width 280ms ease" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepsTable({ plan }: { plan: MigrationPlan }) {
  return (
    <div className="wf-scroll" style={{ maxHeight: 480 }}>
      <table className="wf-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th style={{ width: 96 }}>Phase</th>
            <th>Description</th>
            <th style={{ width: 110 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {plan.steps.map((s) => (
            <tr key={s.id}>
              <td className="wf-mono" style={{ color: "var(--wf-mute)" }}>{s.order}</td>
              <td><span className="wf-pill">{s.phase}</span></td>
              <td>{s.description}{s.error ? <div style={{ color: "var(--wf-bad)", fontSize: 11.5, marginTop: 4 }}>↳ {s.error}</div> : null}</td>
              <td>
                {s.status === "running" && <span className="wf-pill wf-pill-warn"><span className="wf-spinner" /> running</span>}
                {s.status === "ok" && <span className="wf-pill wf-pill-good">✓ ok</span>}
                {s.status === "failed" && <span className="wf-pill wf-pill-bad">✗ failed</span>}
                {s.status === "rolled_back" && <span className="wf-pill wf-pill-warn">↩ rolled back</span>}
                {s.status === "skipped" && <span className="wf-pill wf-pill-mute">skipped</span>}
                {s.status === "pending" && <span className="wf-pill wf-pill-mute">pending</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
