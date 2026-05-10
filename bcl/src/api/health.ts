import { Router } from "express";
import { store } from "../state/store.js";
import type { MqAdapter } from "../mq/adapter.js";

export function buildHealthRouter(adapter: MqAdapter) {
  const r = Router();

  r.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  r.get("/readyz", async (_req, res) => {
    const ping = await adapter.ping();
    const ready = store.ready && ping.ok;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      adapter: ping,
      stateLoaded: store.ready,
      qms: Object.keys(store.current?.qms ?? {}).length,
      audit: store.audit.length,
    });
  });

  return r;
}
