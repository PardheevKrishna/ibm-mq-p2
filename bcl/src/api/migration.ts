import { Router } from "express";
import { store } from "../state/store.js";
import { planAppMigration } from "../migration/planner.js";
import { executePlan, rollbackPlan } from "../migration/executor.js";
import type { MqAdapter } from "../mq/adapter.js";

export function buildMigrationRouter(adapter: MqAdapter) {
  const r = Router();

  r.get("/plans", (_req, res) => res.json(Object.values(store.plans)));

  r.get("/plans/:id", (req, res) => {
    const p = store.plans[req.params.id];
    if (!p) return res.status(404).json({ code: "PLAN_NOT_FOUND" });
    res.json(p);
  });

  r.post("/plan/:appId", (req, res) => {
    const { appId } = req.params;
    const allPlans = Object.values(store.plans);
    const complete = allPlans.find((p) => p.appId === appId && p.status === "complete");
    if (complete) {
      return res.status(409).json({
        code: "ALREADY_MIGRATED",
        message: `App ${appId} is already fully migrated (plan ${complete.id}). Roll back before re-migrating.`,
      });
    }
    const executing = allPlans.find((p) => p.appId === appId && p.status === "executing");
    if (executing) {
      return res.status(409).json({
        code: "MIGRATION_IN_PROGRESS",
        message: `App ${appId} has an active migration in progress (plan ${executing.id}).`,
      });
    }
    const plan = planAppMigration(store.current, store.target, appId);
    store.plans[plan.id] = plan;
    store.record(
      "migration.plan",
      "operator",
      true,
      `Plan drafted for ${appId} (${plan.steps.length} steps)`,
      { planId: plan.id }
    );
    store.emit("event", { type: "plan.update", plan });
    res.status(201).json(plan);
  });

  r.post("/plans/:id/execute", async (req, res) => {
    const plan = store.plans[req.params.id];
    if (!plan) return res.status(404).json({ code: "PLAN_NOT_FOUND" });
    res.status(202).json({ accepted: true, planId: plan.id });
    // Fire-and-forget; UI follows along over WS.
    executePlan(adapter, plan, { pauseBetweenSteps: 280 }).catch((e) => {
      store.record("migration.step.fail", "operator", false, `Executor crash: ${(e as Error).message}`);
    });
  });

  r.post("/plans/:id/rollback", async (req, res) => {
    const plan = store.plans[req.params.id];
    if (!plan) return res.status(404).json({ code: "PLAN_NOT_FOUND" });
    res.status(202).json({ accepted: true });
    rollbackPlan(adapter, plan).catch(() => undefined);
  });

  r.post("/rollback-all", (_req, res) => {
    store.rollbackToSource();
    res.json({ ok: true });
  });

  return r;
}
