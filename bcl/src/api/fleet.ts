import { Router } from "express";
import { store } from "../state/store.js";
import type { MqAdapter } from "../mq/adapter.js";
import { checkChannelPolicy, checkQmPolicy } from "../guardrails/policy.js";
import { validateChannelName, validateTargetQmName, validateTransmitName } from "../guardrails/naming.js";

export function buildFleetRouter(adapter: MqAdapter) {
  const r = Router();

  r.get("/qms", (_req, res) => res.json(Object.values(store.current.qms)));

  r.get("/qms/:name", (req, res) => {
    const qm = store.current.qms[req.params.name];
    if (!qm) return res.status(404).json({ code: "QM_NOT_FOUND" });
    res.json(qm);
  });

  r.get("/qms/:name/health", async (req, res) => {
    const h = await adapter.qmHealth(req.params.name);
    store.record("qm.health", "operator", h.ok, `Health for ${req.params.name}: ${h.health}`, h, req.params.name);
    res.json(h);
  });

  r.post("/qms", async (req, res) => {
    const qm = req.body;
    if (qm.isTarget) {
      const v = validateTargetQmName(qm.name);
      if (!v.ok) {
        store.record("guardrail.violation", "operator", false, v.message ?? "naming violation", v);
        return res.status(400).json({ code: "NAMING_VIOLATION", details: v });
      }
    }
    const violations = checkQmPolicy(qm);
    if (violations.length) {
      store.record("guardrail.violation", "operator", false, `Policy violations on ${qm.name}`, violations);
      return res.status(400).json({ code: "POLICY_VIOLATION", violations });
    }
    await adapter.createQm(qm);
    store.current.qms[qm.name] = { ...qm, state: "running", health: "ok" };
    store.record("qm.create", "operator", true, `Created QM ${qm.name}`, qm, qm.name);
    res.status(201).json(store.current.qms[qm.name]);
  });

  r.delete("/qms/:name", async (req, res) => {
    await adapter.deleteQm(req.params.name);
    delete store.current.qms[req.params.name];
    store.record("qm.delete", "operator", true, `Deleted QM ${req.params.name}`, undefined, req.params.name);
    res.status(204).end();
  });

  // ---- queues ------------------------------------------------------------
  r.get("/queues", (req, res) => {
    const qm = req.query.qm as string | undefined;
    const list = qm ? store.current.queues.filter((q) => q.qm === qm) : store.current.queues;
    res.json(list);
  });

  r.post("/queues", async (req, res) => {
    const q = req.body;
    await adapter.createQueue(q);
    store.current.queues = [
      ...store.current.queues.filter((x) => !(x.qm === q.qm && x.name === q.name)),
      q,
    ];
    store.record("queue.create", "operator", true, `Created queue ${q.name} on ${q.qm}`, q);
    res.status(201).json(q);
  });

  r.delete("/queues/:qm/:name", async (req, res) => {
    await adapter.deleteQueue(req.params.qm, req.params.name);
    store.current.queues = store.current.queues.filter(
      (q) => !(q.qm === req.params.qm && q.name === req.params.name)
    );
    store.record("queue.delete", "operator", true, `Deleted queue ${req.params.name} on ${req.params.qm}`);
    res.status(204).end();
  });

  // ---- channels ----------------------------------------------------------
  r.get("/channels", (_req, res) => res.json(store.current.channels));

  r.post("/channels", async (req, res) => {
    const ch = req.body;
    const nv = validateChannelName(ch.name, ch.kind);
    if (!nv.ok) return res.status(400).json({ code: "NAMING_VIOLATION", details: nv });
    const violations = checkChannelPolicy(ch);
    if (violations.length) return res.status(400).json({ code: "POLICY_VIOLATION", violations });
    await adapter.createChannel(ch);
    store.current.channels = [...store.current.channels.filter((c) => c.name !== ch.name), ch];
    store.record("channel.create", "operator", true, `Created ${ch.kind} channel ${ch.name}`, ch);
    res.status(201).json(ch);
  });

  r.delete("/channels/:name", async (req, res) => {
    await adapter.deleteChannel(req.params.name);
    store.current.channels = store.current.channels.filter((c) => c.name !== req.params.name);
    store.record("channel.delete", "operator", true, `Deleted channel ${req.params.name}`);
    res.status(204).end();
  });

  // ---- transmits ---------------------------------------------------------
  r.get("/transmits", (_req, res) => res.json(store.current.transmits));

  r.post("/transmits", async (req, res) => {
    const t = req.body;
    const v = validateTransmitName(t.name);
    if (!v.ok) return res.status(400).json({ code: "NAMING_VIOLATION", details: v });
    await adapter.createTransmit(t);
    store.current.transmits = [
      ...store.current.transmits.filter((x) => !(x.qm === t.qm && x.name === t.name)),
      t,
    ];
    res.status(201).json(t);
  });

  return r;
}
