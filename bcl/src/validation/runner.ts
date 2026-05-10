import { nanoid } from "nanoid";
import type { MqAdapter } from "../mq/adapter.js";
import type { Flow, ValidationResult } from "../types.js";
import { store } from "../state/store.js";

const PROBE_COUNT = 25;

/**
 * Validation engine — drives a producer/consumer probe end-to-end for every
 * flow that touches the given app, against the CURRENT working topology.
 * Aggregates per-flow results into a single per-app outcome so the migration
 * step can decide pass/fail.
 */
export async function runValidation(adapter: MqAdapter, appId: string): Promise<ValidationResult> {
  const id = nanoid(10);
  const ts = new Date().toISOString();
  store.record("validation.run.start", "validator", true, `Probing flows for ${appId}`, { appId }, appId);

  const flows: Flow[] = store.current.flows.filter(
    (f) => f.producer.appId === appId || f.consumer.appId === appId
  );

  let sent = 0, received = 0, lost = 0, duplicates = 0;
  const latencies: number[] = [];
  const notes: string[] = [];

  for (const f of flows) {
    try {
      const r = await adapter.probe({
        fromQm: f.producer.qm,
        fromQueue: f.producer.queue,
        toQm: f.consumer.qm,
        toQueue: f.consumer.queue,
        count: PROBE_COUNT,
      });
      sent += r.sent;
      received += r.received;
      duplicates += r.duplicates;
      lost += r.lost;
      latencies.push(r.avgLatencyMs);
    } catch (e) {
      notes.push(`flow ${f.producer.queue} → ${f.consumer.queue}: ${(e as Error).message}`);
      lost += PROBE_COUNT;
    }
  }

  const ok = lost === 0 && duplicates === 0 && received >= sent;
  const avgLatencyMs =
    latencies.length === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / latencies.length;

  const result: ValidationResult = {
    id,
    appId,
    ts,
    ok,
    sent,
    received,
    duplicates,
    lost,
    avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
    notes: notes.length ? notes.join(" | ") : undefined,
  };
  store.recordValidation(result);
  store.record(
    ok ? "validation.run.ok" : "validation.run.fail",
    "validator",
    ok,
    ok
      ? `Validation OK for ${appId}: ${received}/${sent} delivered, ${avgLatencyMs.toFixed(1)}ms avg`
      : `Validation FAILED for ${appId}: lost=${lost} dup=${duplicates}`,
    result,
    appId
  );
  return result;
}
