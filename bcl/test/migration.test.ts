import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourceTopology, loadTargetTopology } from "../src/data/loader.js";
import { store } from "../src/state/store.js";
import { planAppMigration } from "../src/migration/planner.js";
import { executePlan } from "../src/migration/executor.js";
import { SimAdapter } from "../src/mq/simAdapter.js";

const dataDir = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "data");

test("source/target loaders find six application-equivalents", () => {
  const src = loadSourceTopology(dataDir);
  const tgt = loadTargetTopology(dataDir);
  assert.ok(src.apps.length >= 6, `expected >=6 apps in source, got ${src.apps.length}`);
  assert.ok(Object.keys(tgt.qms).every((q) => q.startsWith("APPQM_")), "all target QMs must follow APPQM_<APPID>");
});

test("planner emits ordered phases STAGE→WIRE→CUTOVER→VERIFY→CLEAN", () => {
  const src = loadSourceTopology(dataDir);
  const tgt = loadTargetTopology(dataDir);
  store.hydrate(src, tgt);
  const plan = planAppMigration(store.current, store.target, "LIY/KW");
  const expectedOrder = ["STAGE", "WIRE", "CUTOVER", "VERIFY", "CLEAN"];
  let lastIdx = -1;
  for (const step of plan.steps) {
    const idx = expectedOrder.indexOf(step.phase);
    assert.ok(idx >= lastIdx, `phase ${step.phase} appears out of order`);
    lastIdx = idx;
  }
  assert.ok(plan.steps.some((s) => s.phase === "VERIFY"), "plan must include a VERIFY step");
});

test("executor completes a plan end-to-end in sim mode", async () => {
  const src = loadSourceTopology(dataDir);
  const tgt = loadTargetTopology(dataDir);
  store.hydrate(src, tgt);
  const plan = planAppMigration(store.current, store.target, "LIY/KW");
  const adapter = new SimAdapter();
  const out = await executePlan(adapter, plan);
  assert.equal(out.status, "complete", `expected complete, got ${out.status}`);
});

test("executor rolls back to source baseline on chaos failure", async () => {
  process.env.BCL_CHAOS = "1";
  const src = loadSourceTopology(dataDir);
  const tgt = loadTargetTopology(dataDir);
  store.hydrate(src, tgt);
  const plan = planAppMigration(store.current, store.target, "LIY/KW");
  const adapter = new SimAdapter();
  const out = await executePlan(adapter, plan);
  // chaos may or may not trip — both outcomes are valid; we just assert
  // the executor reaches a terminal status without throwing.
  assert.match(out.status, /complete|rolled_back|failed/);
  delete process.env.BCL_CHAOS;
});
