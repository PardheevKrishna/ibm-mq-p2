// Domain model — shared across BCL modules and serialized over REST/WS.

export type Neighborhood =
  | "Data & Analytics"
  | "Mainframe"
  | "Core Banking, Mainframe"
  | "Core Banking"
  | "Standard"
  | "Secure";

export type FlowType = "Local" | "Remote";
export type QueueType = "Local" | "Remote";

export interface AppRef {
  appId: string;        // e.g. "LIY/KW"
  appName: string;
  neighborhood: Neighborhood | string;
}

export interface Flow {
  flowType: FlowType;
  producer: AppRef & {
    qm: string;
    queue: string;
    queueType: QueueType;
    transmitQueue?: string;
    channel?: string;
  };
  consumer: AppRef & {
    qm: string;
    queue: string;
    queueType: QueueType;
  };
}

export interface QueueManager {
  name: string;
  apps: string[];                  // app ids that bind to this QM
  region?: "WEST" | "EAST" | "LEGACY";
  zone?: "STANDARD" | "SECURE";
  dlq: string;                     // mandatory; default SYSTEM.DEAD.LETTER.QUEUE
  state: "absent" | "provisioning" | "running" | "draining" | "decommissioned" | "failed";
  health: "ok" | "starting" | "degraded" | "down";
  listenerPort: number;            // default 1414
  consolePort: number;             // default 9443
  tls: { enabled: boolean; cipher: string };
  createdAt?: string;
  lastEventAt?: string;
  isTarget?: boolean;
}

export interface Queue {
  qm: string;
  name: string;
  type: QueueType;
  appId: string;                   // owning app
  rqmname?: string;                // remote QM (for Remote queues)
  rname?: string;                  // remote queue name (for Remote queues)
  xmitq?: string;                  // transmit queue name (for Remote queues)
}

export interface TransmitQueue {
  qm: string;
  name: string;                    // e.g. APPQM_JUUD_C9.XMIT
  targetQm: string;
}

export interface Channel {
  name: string;                    // e.g. APPQM_LIY_KW.APPQM_JUUD_C9
  kind: "SDR" | "RCVR" | "SVRCONN";
  fromQm: string;                  // for SDR/RCVR
  toQm?: string;                   // for SDR pair
  xmitq?: string;                  // for SDR
  conn?: string;                   // for SDR (host(port))
  sslCipher: string;               // mandatory non-empty (TLS)
  mcaUser: string;                 // mandatory (MCA-based authz)
}

export interface Topology {
  apps: AppRef[];
  qms: Record<string, QueueManager>;
  queues: Queue[];
  transmits: TransmitQueue[];
  channels: Channel[];
  flows: Flow[];
}

export type AuditEventKind =
  | "topology.loaded"
  | "qm.create" | "qm.update" | "qm.delete" | "qm.health"
  | "queue.create" | "queue.update" | "queue.delete"
  | "channel.create" | "channel.update" | "channel.delete"
  | "migration.plan" | "migration.step.start" | "migration.step.ok" | "migration.step.fail"
  | "migration.complete" | "migration.rollback.start" | "migration.rollback.ok"
  | "validation.run.start" | "validation.run.ok" | "validation.run.fail"
  | "guardrail.violation";

export interface AuditEvent {
  id: string;
  ts: string;
  kind: AuditEventKind;
  actor: string;
  target?: string;
  ok: boolean;
  message: string;
  data?: unknown;
  correlationId?: string;
}

export interface MigrationStep {
  id: string;
  appId: string;
  order: number;
  phase: "STAGE" | "WIRE" | "CUTOVER" | "VERIFY" | "CLEAN";
  description: string;
  op: MigrationOp;
  inverse?: MigrationOp;
  status: "pending" | "running" | "ok" | "failed" | "rolled_back" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export type MigrationOp =
  | { kind: "createQm"; qm: string; isTarget: true }
  | { kind: "deleteQm"; qm: string }
  | { kind: "createQueue"; qm: string; queue: Queue }
  | { kind: "deleteQueue"; qm: string; queueName: string }
  | { kind: "createTransmit"; qm: string; xmit: TransmitQueue }
  | { kind: "deleteTransmit"; qm: string; name: string }
  | { kind: "createChannel"; channel: Channel }
  | { kind: "deleteChannel"; name: string }
  | { kind: "rebindAppToQm"; appId: string; from: string; to: string }
  | { kind: "drainQueue"; qm: string; queueName: string }
  | { kind: "validate"; appId: string; flowSelector?: string };

export interface MigrationPlan {
  id: string;
  appId: string;
  createdAt: string;
  steps: MigrationStep[];
  status: "draft" | "executing" | "complete" | "failed" | "rolled_back";
  currentStep?: number;
}

export interface ValidationResult {
  id: string;
  appId: string;
  ts: string;
  ok: boolean;
  sent: number;
  received: number;
  duplicates: number;
  lost: number;
  avgLatencyMs: number;
  notes?: string;
}
