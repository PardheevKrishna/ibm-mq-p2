import type { MqAdapter } from "../mq/adapter.js";
import type { MigrationOp, MigrationPlan, MigrationStep } from "../types.js";
import { store } from "../state/store.js";
import { runValidation } from "../validation/runner.js";

interface ExecuteOpts {
  failOnAnyError?: boolean;
  pauseBetweenSteps?: number;
}

/**
 * Execute a migration plan, step by step, with automatic rollback on failure.
 *
 * Rollback strategy:
 *   - Each step's `inverse` op (if any) is collected on success.
 *   - On step failure, the executor walks the recorded inverses in REVERSE
 *     order and applies them. Each inverse failure is captured in the audit
 *     log but doesn't abort the rollback.
 *   - The store's working topology is also reset to the source baseline
 *     when rollback completes, guaranteeing a known-good state.
 */
export async function executePlan(
  adapter: MqAdapter,
  plan: MigrationPlan,
  opts: ExecuteOpts = {}
): Promise<MigrationPlan> {
  const correlation = `mig-${plan.id}`;
  plan.status = "executing";
  store.record("migration.plan", "operator", true, `Executing plan for ${plan.appId}`, { plan: plan.id }, plan.appId, correlation);
  store.emit("event", { type: "plan.update", plan });

  const undoStack: MigrationOp[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    plan.currentStep = i;
    step.status = "running";
    step.startedAt = new Date().toISOString();
    store.record(
      "migration.step.start",
      "operator",
      true,
      `[${step.phase}] ${step.description}`,
      { stepId: step.id, op: step.op },
      plan.appId,
      correlation
    );
    store.emit("event", { type: "plan.update", plan });

    try {
      await applyOp(adapter, step.op);
      step.status = "ok";
      step.finishedAt = new Date().toISOString();
      if (step.inverse) undoStack.push(step.inverse);
      store.record(
        "migration.step.ok",
        "operator",
        true,
        `[${step.phase}] ok: ${step.description}`,
        { stepId: step.id },
        plan.appId,
        correlation
      );
      store.emit("event", { type: "plan.update", plan });
      if (opts.pauseBetweenSteps) await new Promise((r) => setTimeout(r, opts.pauseBetweenSteps));
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      step.status = "failed";
      step.error = err;
      step.finishedAt = new Date().toISOString();
      store.record(
        "migration.step.fail",
        "operator",
        false,
        `[${step.phase}] FAILED: ${step.description} — ${err}`,
        { stepId: step.id, error: err },
        plan.appId,
        correlation
      );
      store.emit("event", { type: "plan.update", plan });

      // ---- Automated rollback ---------------------------------------
      store.record("migration.rollback.start", "operator", true, `Rolling back plan ${plan.id}`, undefined, plan.appId, correlation);
      while (undoStack.length > 0) {
        const inv = undoStack.pop()!;
        try {
          await applyOp(adapter, inv);
        } catch (re) {
          const m = re instanceof Error ? re.message : String(re);
          store.record(
            "migration.step.fail",
            "operator",
            false,
            `Rollback op failed (continuing): ${m}`,
            { inverse: inv },
            plan.appId,
            correlation
          );
        }
      }
      store.rollbackToSource();
      plan.status = "rolled_back";
      for (const s of plan.steps) {
        if (s.status === "ok") s.status = "rolled_back";
        if (s.status === "pending") s.status = "skipped";
      }
      store.emit("event", { type: "plan.update", plan });
      return plan;
    }
  }

  plan.status = "complete";
  store.record("migration.complete", "operator", true, `Migration of ${plan.appId} complete`, { plan: plan.id }, plan.appId, correlation);
  store.emit("event", { type: "plan.update", plan });
  return plan;
}

async function applyOp(adapter: MqAdapter, op: MigrationOp): Promise<void> {
  switch (op.kind) {
    case "createQm": {
      const qm = store.target.qms[op.qm];
      if (!qm) throw new Error(`Target QM ${op.qm} not found in target topology`);
      await adapter.createQm(qm);
      store.current.qms[op.qm] = { ...qm, state: "running", health: "ok" };
      break;
    }
    case "deleteQm": {
      await adapter.deleteQm(op.qm);
      delete store.current.qms[op.qm];
      break;
    }
    case "createQueue": {
      await adapter.createQueue(op.queue);
      store.current.queues = [
        ...store.current.queues.filter((q) => !(q.qm === op.queue.qm && q.name === op.queue.name)),
        op.queue,
      ];
      break;
    }
    case "deleteQueue": {
      await adapter.deleteQueue(op.qm, op.queueName);
      store.current.queues = store.current.queues.filter(
        (q) => !(q.qm === op.qm && q.name === op.queueName)
      );
      break;
    }
    case "createTransmit": {
      await adapter.createTransmit(op.xmit);
      store.current.transmits = [
        ...store.current.transmits.filter((t) => !(t.qm === op.xmit.qm && t.name === op.xmit.name)),
        op.xmit,
      ];
      break;
    }
    case "deleteTransmit": {
      await adapter.deleteTransmit(op.qm, op.name);
      store.current.transmits = store.current.transmits.filter(
        (t) => !(t.qm === op.qm && t.name === op.name)
      );
      break;
    }
    case "createChannel": {
      await adapter.createChannel(op.channel);
      store.current.channels = [
        ...store.current.channels.filter((c) => c.name !== op.channel.name),
        op.channel,
      ];
      break;
    }
    case "deleteChannel": {
      await adapter.deleteChannel(op.name);
      store.current.channels = store.current.channels.filter((c) => c.name !== op.name);
      break;
    }
    case "rebindAppToQm": {
      const fromQm = store.current.qms[op.from];
      const toQm = store.current.qms[op.to];
      if (fromQm) fromQm.apps = fromQm.apps.filter((a) => a !== op.appId);
      if (toQm && !toQm.apps.includes(op.appId)) toQm.apps.push(op.appId);
      break;
    }
    case "drainQueue": {
      // Sim: instantaneous drain; Real: would issue mqsc CLEAR QLOCAL after
      // confirming depth=0. Either way, audit-only here.
      await new Promise((r) => setTimeout(r, 100));
      break;
    }
    case "validate": {
      const res = await runValidation(adapter, op.appId);
      if (!res.ok) {
        throw new Error(
          `Validation failed for ${op.appId}: sent=${res.sent} received=${res.received} lost=${res.lost} dup=${res.duplicates}`
        );
      }
      break;
    }
  }
}

export async function rollbackPlan(adapter: MqAdapter, plan: MigrationPlan): Promise<MigrationPlan> {
  // Replay inverses for completed steps in reverse order.
  // NOTE: do NOT call store.rollbackToSource() here — that resets ALL plans.
  // The inverse ops already undo this specific plan's topology mutations.
  const completed = plan.steps.filter((s) => s.status === "ok");
  for (let i = completed.length - 1; i >= 0; i--) {
    const inv = completed[i].inverse;
    if (!inv) continue;
    try {
      await applyOp(adapter, inv);
      completed[i].status = "rolled_back";
    } catch (e) {
      store.record(
        "migration.step.fail",
        "operator",
        false,
        `Manual rollback op failed (continuing): ${(e as Error).message}`,
        { inverse: inv }
      );
    }
  }
  // Mark remaining pending steps as skipped.
  for (const s of plan.steps) {
    if (s.status === "pending") s.status = "skipped";
  }
  plan.status = "rolled_back";
  store.record("migration.rollback.ok", "operator", true, `Plan ${plan.id} (${plan.appId}) rolled back`);
  store.emit("event", { type: "plan.update", plan });
  return plan;
}
