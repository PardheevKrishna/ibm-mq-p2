import type { Channel, Queue, QueueManager, TransmitQueue } from "../types.js";
import type { MqAdapter } from "./adapter.js";

/**
 * In-memory simulator. Mirrors the operational latency + failure shape of
 * real MQ closely enough to drive the UI end-to-end without an OCP cluster.
 *
 * - Operations have a small randomized delay (50-250ms).
 * - QM creation goes through `provisioning` → `running` over ~600ms.
 * - `probe` simulates near-perfect delivery with a 10ms avg latency unless
 *   chaos mode is enabled (env BCL_CHAOS=1) which injects loss/dup.
 */
export class SimAdapter implements MqAdapter {
  private qms = new Map<string, QueueManager>();
  private queues = new Map<string, Queue>();          // key = qm|name
  private transmits = new Map<string, TransmitQueue>(); // key = qm|name
  private channels = new Map<string, Channel>();
  private chaos = process.env.BCL_CHAOS === "1";

  private async wait(min = 60, max = 220) {
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
  }

  async ping() {
    return { ok: true, mode: "sim" as const, details: this.chaos ? "chaos enabled" : "stable" };
  }

  async createQm(qm: QueueManager) {
    await this.wait();
    const next: QueueManager = { ...qm, state: "provisioning", health: "starting" };
    this.qms.set(qm.name, next);
    setTimeout(() => {
      const cur = this.qms.get(qm.name);
      if (cur) {
        cur.state = "running";
        cur.health = "ok";
      }
    }, 500);
  }

  async deleteQm(qmName: string) {
    await this.wait();
    const cur = this.qms.get(qmName);
    if (cur) cur.state = "decommissioned";
    this.qms.delete(qmName);
  }

  async qmHealth(qmName: string) {
    const cur = this.qms.get(qmName);
    if (!cur) return { ok: false, state: "absent" as const, health: "down" as const, message: "not found" };
    return { ok: cur.health === "ok", state: cur.state, health: cur.health };
  }

  async createQueue(q: Queue) {
    await this.wait(40, 120);
    this.queues.set(`${q.qm}|${q.name}`, q);
  }

  async deleteQueue(qm: string, name: string) {
    await this.wait(20, 80);
    this.queues.delete(`${qm}|${name}`);
  }

  async createTransmit(t: TransmitQueue) {
    await this.wait(40, 120);
    this.transmits.set(`${t.qm}|${t.name}`, t);
  }

  async deleteTransmit(qm: string, name: string) {
    await this.wait(20, 80);
    this.transmits.delete(`${qm}|${name}`);
  }

  async createChannel(c: Channel) {
    await this.wait(40, 120);
    this.channels.set(c.name, c);
  }

  async deleteChannel(name: string) {
    await this.wait(20, 80);
    this.channels.delete(name);
  }

  async probe({ count }: {
    fromQm: string; fromQueue: string; toQm: string; toQueue: string; count: number;
  }) {
    await this.wait(80, 250);
    const sent = count;
    let received = count;
    let duplicates = 0;
    let lost = 0;
    if (this.chaos) {
      lost = Math.random() < 0.4 ? Math.floor(Math.random() * 3) : 0;
      duplicates = Math.random() < 0.2 ? Math.floor(Math.random() * 2) : 0;
      received = sent - lost + duplicates;
    }
    const avgLatencyMs = 6 + Math.random() * 14;
    return { sent, received, duplicates, lost, avgLatencyMs };
  }
}
