import { nanoid } from "nanoid";
import type {
  Channel,
  MigrationOp,
  MigrationPlan,
  MigrationStep,
  Queue,
  TransmitQueue,
  Topology,
} from "../types.js";
import { appIdToQm } from "../guardrails/naming.js";

/**
 * Build a per-app migration plan that diffs `current` against `target` for
 * the given app and emits an ordered, idempotent list of steps:
 *
 *   STAGE   – stand up the app's dedicated APPQM_* with DLQ + SVRCONN
 *   WIRE    – create remote/transmit/sender channel on every counterpart QM
 *             that talks to this app, so messages reach the new QM via XMIT
 *   CUTOVER – rebind the app to its dedicated QM (transparent to clients,
 *             handled by BCL connection alias)
 *   VERIFY  – probe every flow that touches this app
 *   CLEAN   – delete obsolete source-side queues/channels for this app
 *
 * Each step carries its inverse so the executor can roll back deterministically.
 */
export function planAppMigration(
  current: Topology,
  target: Topology,
  appId: string
): MigrationPlan {
  const targetQmName = appIdToQm(appId);
  const targetQm = target.qms[targetQmName];
  const steps: MigrationStep[] = [];
  let order = 1;

  function push(
    phase: MigrationStep["phase"],
    description: string,
    op: MigrationOp,
    inverse?: MigrationOp
  ) {
    steps.push({
      id: nanoid(8),
      appId,
      order: order++,
      phase,
      description,
      op,
      inverse,
      status: "pending",
    });
  }

  // ---- 1. STAGE: provision target QM if not already running ---------------
  if (targetQm && current.qms[targetQmName]?.state !== "running") {
    push(
      "STAGE",
      `Provision dedicated queue manager ${targetQmName} (DLQ enforced, TLS on)`,
      { kind: "createQm", qm: targetQmName, isTarget: true },
      { kind: "deleteQm", qm: targetQmName }
    );
    const svrconn: Channel = {
      name: `APP.SVRCONN.${targetQmName}`,
      kind: "SVRCONN",
      fromQm: targetQmName,
      sslCipher: "ANY_TLS12_OR_HIGHER",
      mcaUser: `mca_app_${targetQmName.toLowerCase()}`,
    };
    push(
      "STAGE",
      `Create SVRCONN ${svrconn.name} (TLS + MCA auth'z)`,
      { kind: "createChannel", channel: svrconn },
      { kind: "deleteChannel", name: svrconn.name }
    );
  }

  // ---- 2. WIRE: from every counterpart QM, create remote+xmit+SDR --------
  // For each target flow that touches this app, ensure the producer-side QM
  // has the right Remote/Transmit/Channel triple pointing at the new QM.
  const counterpartsHandled = new Set<string>();
  for (const f of target.flows) {
    if (f.producer.appId !== appId && f.consumer.appId !== appId) continue;

    const producerQm = f.producer.qm;
    const consumerQm = f.consumer.qm;
    if (producerQm === consumerQm) continue;

    const key = `${producerQm}->${consumerQm}`;
    if (counterpartsHandled.has(key)) continue;
    counterpartsHandled.add(key);

    const xmit: TransmitQueue = {
      qm: producerQm,
      name: `${consumerQm}.XMIT`,
      targetQm: consumerQm,
    };
    const channel: Channel = {
      name: `${producerQm}.${consumerQm}`,
      kind: "SDR",
      fromQm: producerQm,
      toQm: consumerQm,
      xmitq: xmit.name,
      conn: `${consumerQm.toLowerCase()}:1414`,
      sslCipher: "ANY_TLS12_OR_HIGHER",
      mcaUser: `mca_${appId.replace(/[^A-Za-z0-9]/g, "_").toLowerCase()}`,
    };

    push(
      "WIRE",
      `Provision transmit queue ${xmit.name} on ${producerQm}`,
      { kind: "createTransmit", qm: producerQm, xmit },
      { kind: "deleteTransmit", qm: producerQm, name: xmit.name }
    );
    push(
      "WIRE",
      `Provision sender channel ${channel.name} (TLS, MCA)`,
      { kind: "createChannel", channel },
      { kind: "deleteChannel", name: channel.name }
    );

    // Per-flow remote queue defs on the producer side
    const producerQueues = target.queues.filter(
      (q) => q.qm === producerQm && q.type === "Remote" && q.rqmname === consumerQm
    );
    for (const q of producerQueues) {
      push(
        "WIRE",
        `Define remote queue ${q.name} on ${producerQm} → ${q.rname}@${q.rqmname}`,
        { kind: "createQueue", qm: producerQm, queue: q },
        { kind: "deleteQueue", qm: producerQm, queueName: q.name }
      );
    }
    // Local queues on the consumer side (the new dedicated QM)
    const consumerLocals = target.queues.filter(
      (q) => q.qm === consumerQm && q.type === "Local"
    );
    for (const q of consumerLocals) {
      push(
        "WIRE",
        `Define local queue ${q.name} on ${consumerQm}`,
        { kind: "createQueue", qm: consumerQm, queue: q },
        { kind: "deleteQueue", qm: consumerQm, queueName: q.name }
      );
    }
  }

  // ---- 3. CUTOVER: drain old shared queues, rebind app to new QM ---------
  const oldQms = current.qms;
  for (const [qmName, qm] of Object.entries(oldQms)) {
    if (qm.isTarget) continue;
    if (!qm.apps.includes(appId)) continue;
    const drainTargets = current.queues.filter(
      (q) => q.qm === qmName && q.appId === appId && q.type === "Local"
    );
    for (const dq of drainTargets) {
      push(
        "CUTOVER",
        `Drain ${dq.name} on legacy QM ${qmName} before rebind`,
        { kind: "drainQueue", qm: qmName, queueName: dq.name }
      );
    }
    push(
      "CUTOVER",
      `Rebind app ${appId} from ${qmName} to ${targetQmName} (BCL alias updated; client config unchanged)`,
      { kind: "rebindAppToQm", appId, from: qmName, to: targetQmName },
      { kind: "rebindAppToQm", appId, from: targetQmName, to: qmName }
    );
  }

  // ---- 4. VERIFY: probe every flow that touches this app -----------------
  push(
    "VERIFY",
    `Probe end-to-end message flow for ${appId}: send + assert delivery, no loss, no dup`,
    { kind: "validate", appId }
  );

  // ---- 5. CLEAN: remove obsolete source-side defs (after VERIFY ok) ------
  const obsoleteQueues = current.queues.filter(
    (q) =>
      q.appId === appId &&
      !target.queues.some((tq) => tq.qm === q.qm && tq.name === q.name && tq.appId === appId) &&
      !current.qms[q.qm]?.isTarget
  );
  for (const oq of obsoleteQueues) {
    push(
      "CLEAN",
      `Decommission obsolete ${oq.type} queue ${oq.name} on ${oq.qm}`,
      { kind: "deleteQueue", qm: oq.qm, queueName: oq.name }
    );
  }

  return {
    id: nanoid(10),
    appId,
    createdAt: new Date().toISOString(),
    steps,
    status: "draft",
  };
}
