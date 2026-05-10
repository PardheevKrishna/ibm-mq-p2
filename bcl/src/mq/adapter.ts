import type { Channel, Queue, QueueManager, TransmitQueue } from "../types.js";

/**
 * Adapter contract — every method is the BCL's only path to the fleet.
 * Concrete implementations: SimAdapter (in-memory) and RealAdapter (MQ REST).
 */
export interface MqAdapter {
  ping(): Promise<{ ok: boolean; mode: "sim" | "real"; details?: string }>;

  createQm(qm: QueueManager): Promise<void>;
  deleteQm(qmName: string): Promise<void>;
  qmHealth(qmName: string): Promise<{ ok: boolean; state: QueueManager["state"]; health: QueueManager["health"]; message?: string }>;

  createQueue(q: Queue): Promise<void>;
  deleteQueue(qm: string, name: string): Promise<void>;

  createTransmit(t: TransmitQueue): Promise<void>;
  deleteTransmit(qm: string, name: string): Promise<void>;

  createChannel(c: Channel): Promise<void>;
  deleteChannel(name: string): Promise<void>;

  /** Send N messages onto a producer queue and read them back from the consumer. */
  probe(args: {
    fromQm: string;
    fromQueue: string;
    toQm: string;
    toQueue: string;
    count: number;
  }): Promise<{ sent: number; received: number; duplicates: number; lost: number; avgLatencyMs: number }>;
}
