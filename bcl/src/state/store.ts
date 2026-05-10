import { nanoid } from "nanoid";
import type {
  AuditEvent,
  AuditEventKind,
  MigrationPlan,
  Topology,
  ValidationResult,
} from "../types.js";
import { EventEmitter } from "node:events";

/**
 * In-memory system of record. Single source of truth for the current
 * topology, the source baseline (for rollback), the target spec, audit log,
 * migration plans, and validation results.
 *
 * All mutations go through this store so the audit log + WS event stream
 * stay consistent. The MQ adapter is the side-effect layer underneath.
 */
export class Store extends EventEmitter {
  source!: Topology;     // baseline (for rollback)
  target!: Topology;     // desired end state
  current!: Topology;    // working state, mutated by migrations
  audit: AuditEvent[] = [];
  plans: Record<string, MigrationPlan> = {};
  validations: ValidationResult[] = [];
  ready = false;

  hydrate(source: Topology, target: Topology) {
    this.source = source;
    this.target = target;
    // Start "current" as a deep clone of source. Migrations evolve it toward target.
    this.current = structuredClone(source);
    this.ready = true;
    this.record("topology.loaded", "system", true, "Source + target topologies loaded", {
      sourceQms: Object.keys(source.qms).length,
      targetQms: Object.keys(target.qms).length,
      apps: source.apps.length,
      flows: source.flows.length,
    });
  }

  record(
    kind: AuditEventKind,
    actor: string,
    ok: boolean,
    message: string,
    data?: unknown,
    target?: string,
    correlationId?: string
  ): AuditEvent {
    const ev: AuditEvent = {
      id: nanoid(10),
      ts: new Date().toISOString(),
      kind,
      actor,
      target,
      ok,
      message,
      data,
      correlationId,
    };
    this.audit.push(ev);
    if (this.audit.length > 5000) this.audit.shift();
    this.emit("audit", ev);
    this.emit("event", { type: "audit", event: ev });
    return ev;
  }

  recordValidation(v: ValidationResult) {
    this.validations.push(v);
    if (this.validations.length > 1000) this.validations.shift();
    this.emit("event", { type: "validation", result: v });
  }

  /** Reset the working topology back to the source baseline. */
  rollbackToSource() {
    this.current = structuredClone(this.source);
    // Mark every non-draft plan AND its steps as rolled_back so the UI fully reflects the reset.
    for (const p of Object.values(this.plans)) {
      if (p.status === "draft") continue;
      for (const s of p.steps) {
        if (s.status === "ok" || s.status === "running") s.status = "rolled_back";
        if (s.status === "pending") s.status = "skipped";
      }
      p.status = "rolled_back";
      this.emit("event", { type: "plan.update", plan: p });
    }
    this.record("migration.rollback.ok", "system", true, "Working state rolled back to source baseline");
  }
}

export const store = new Store();
