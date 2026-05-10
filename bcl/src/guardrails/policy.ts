import type { Channel, QueueManager } from "../types.js";

/**
 * Enterprise constraints from the problem statement, enforced at the BCL.
 * Each rule returns a list of violations; an empty list means "compliant".
 */

export interface Violation {
  rule: string;
  message: string;
  hint?: string;
}

export function checkQmPolicy(qm: QueueManager): Violation[] {
  const v: Violation[] = [];
  if (!qm.dlq || qm.dlq.trim() === "") {
    v.push({
      rule: "DLQ_REQUIRED",
      message: `QM ${qm.name} has no Dead Letter Queue assigned`,
      hint: "Set dlq=SYSTEM.DEAD.LETTER.QUEUE or a custom DLQ before provisioning",
    });
  }
  if (!qm.tls?.enabled) {
    v.push({
      rule: "TLS_REQUIRED",
      message: `QM ${qm.name} has TLS disabled — encryption is mandatory`,
      hint: "Enable TLS with a TLS 1.2+ cipher",
    });
  }
  return v;
}

export function checkChannelPolicy(ch: Channel): Violation[] {
  const v: Violation[] = [];
  if (!ch.sslCipher || ch.sslCipher.trim() === "") {
    v.push({
      rule: "ENCRYPTION_REQUIRED",
      message: `Channel ${ch.name} has no sslCipher — auth'n requires encryption`,
    });
  }
  if (!ch.mcaUser || ch.mcaUser.trim() === "") {
    v.push({
      rule: "MCA_AUTHZ_REQUIRED",
      message: `Channel ${ch.name} has no MCAUSER — MCA-based auth'z required`,
    });
  }
  return v;
}

/**
 * Cross-region traffic must flow QM-to-QM (SDR/RCVR pair).
 * Cross-zone traffic from app to QM uses SVRCONN. Pure local on the same QM
 * is fine (no channel needed).
 */
export function checkRoutingPolicy(
  fromQm: QueueManager,
  toQm: QueueManager,
  channel: Channel
): Violation[] {
  const v: Violation[] = [];
  const crossRegion = fromQm.region && toQm.region && fromQm.region !== toQm.region;
  if (crossRegion && channel.kind === "SVRCONN") {
    v.push({
      rule: "CROSS_REGION_QMQM_ONLY",
      message: `Cross-region traffic ${fromQm.name} → ${toQm.name} cannot use SVRCONN`,
      hint: "Use a SDR/RCVR pair instead",
    });
  }
  const crossZone = fromQm.zone && toQm.zone && fromQm.zone !== toQm.zone;
  if (crossZone && channel.kind === "SVRCONN") {
    // OK — SVRCONN is correct for cross-zone client connections.
  }
  return v;
}
