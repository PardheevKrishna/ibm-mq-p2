import { Router } from "express";
import { store } from "../state/store.js";
import type { MqAdapter } from "../mq/adapter.js";

export const topologyRouter = Router();

topologyRouter.get("/source", (_req, res) => res.json(store.source));
topologyRouter.get("/target", (_req, res) => res.json(store.target));
topologyRouter.get("/current", (_req, res) => res.json(store.current));
topologyRouter.get("/apps", (_req, res) => res.json(store.source.apps));

topologyRouter.get("/diff", (_req, res) => {
  const sourceQms = new Set(Object.keys(store.source.qms));
  const targetQms = new Set(Object.keys(store.target.qms));
  const currentQms = new Set(Object.keys(store.current.qms));
  res.json({
    qms: {
      toCreate: [...targetQms].filter((q) => !currentQms.has(q)),
      toDelete: [...currentQms].filter((q) => !targetQms.has(q) && !sourceQms.has(q) === false),
      retained: [...currentQms].filter((q) => targetQms.has(q)),
    },
  });
});

// ── Provision source topology ──────────────────────────────────────────────
// Returns 202 immediately; executes async so the UI can follow progress via WS.
// Idempotent — skips any object that is already in the current working state.
let _adapter: MqAdapter | null = null;
export function injectAdapterForTopologyRouter(a: MqAdapter) { _adapter = a; }

export interface ProvisionProgress {
  total: number;
  done: number;
  failed: number;
  status: "idle" | "running" | "complete" | "failed";
  errors: string[];
}

const progress: ProvisionProgress = { total: 0, done: 0, failed: 0, status: "idle", errors: [] };

topologyRouter.get("/provision-source/status", (_req, res) => res.json(progress));

topologyRouter.post("/provision-source", async (_req, res) => {
  if (progress.status === "running") {
    return res.status(409).json({ code: "ALREADY_RUNNING", message: "Source provisioning is already in progress" });
  }
  if (!_adapter) return res.status(503).json({ code: "ADAPTER_NOT_READY" });

  res.status(202).json({ accepted: true, message: "Source topology provisioning started" });

  // async, fire-and-forget ─ UI follows via WS events
  provisionSource(_adapter).catch((e) => {
    store.record("topology.loaded", "provisioner", false, `Provisioner crashed: ${(e as Error).message}`);
  });
});

async function provisionSource(adapter: MqAdapter) {
  const src = store.source;
  const ops: Array<{ label: string; fn: () => Promise<void> }> = [];

  for (const qm of Object.values(src.qms)) {
    ops.push({
      label: `QM: ${qm.name}`,
      fn: async () => {
        await adapter.createQm(qm);
        store.current.qms[qm.name] = { ...qm, state: "running", health: "ok" };
        store.record("qm.create", "provisioner", true, `Provisioned source QM ${qm.name}`, { qm: qm.name }, qm.name);
      },
    });
  }
  for (const t of src.transmits) {
    const exists = store.current.transmits.some((x) => x.qm === t.qm && x.name === t.name);
    if (exists) continue;
    ops.push({
      label: `Transmit: ${t.name} on ${t.qm}`,
      fn: async () => {
        await adapter.createTransmit(t);
        store.current.transmits.push(t);
        store.record("queue.create", "provisioner", true, `Provisioned transmit ${t.name} on ${t.qm}`, { xmit: t.name });
      },
    });
  }
  for (const q of src.queues) {
    const exists = store.current.queues.some((x) => x.qm === q.qm && x.name === q.name);
    if (exists) continue;
    ops.push({
      label: `Queue: ${q.name} on ${q.qm}`,
      fn: async () => {
        await adapter.createQueue(q);
        store.current.queues.push(q);
        store.record("queue.create", "provisioner", true, `Provisioned queue ${q.name} on ${q.qm}`, { queue: q.name });
      },
    });
  }
  for (const ch of src.channels) {
    const exists = store.current.channels.some((x) => x.name === ch.name);
    if (exists) continue;
    ops.push({
      label: `Channel: ${ch.name}`,
      fn: async () => {
        await adapter.createChannel(ch);
        store.current.channels.push(ch);
        store.record("channel.create", "provisioner", true, `Provisioned channel ${ch.name}`, { channel: ch.name });
      },
    });
  }

  progress.total = ops.length;
  progress.done = 0;
  progress.failed = 0;
  progress.errors = [];
  progress.status = "running";
  store.emit("event", { type: "provision.progress", progress: { ...progress } });

  for (const op of ops) {
    try {
      await op.fn();
      progress.done++;
    } catch (e) {
      progress.failed++;
      const msg = `${op.label}: ${(e as Error).message}`;
      progress.errors.push(msg);
      store.record("qm.create", "provisioner", false, `Provision failed: ${msg}`);
    }
    store.emit("event", { type: "provision.progress", progress: { ...progress } });
  }

  progress.status = progress.failed === 0 ? "complete" : "failed";
  store.emit("event", { type: "provision.progress", progress: { ...progress } });
  store.record(
    "topology.loaded",
    "provisioner",
    progress.failed === 0,
    `Source provisioning ${progress.status}: ${progress.done}/${progress.total} ok, ${progress.failed} failed`,
  );
}
