// Mirror of the BCL types — kept in sync by hand for now (no codegen).

export interface AppRef {
  appId: string;
  appName: string;
  neighborhood: string;
}
export interface QueueManager {
  name: string;
  apps: string[];
  region?: "WEST" | "EAST" | "LEGACY";
  zone?: "STANDARD" | "SECURE";
  dlq: string;
  state: "absent" | "provisioning" | "running" | "draining" | "decommissioned" | "failed";
  health: "ok" | "starting" | "degraded" | "down";
  listenerPort: number;
  consolePort: number;
  tls: { enabled: boolean; cipher: string };
  isTarget?: boolean;
}
export interface Queue {
  qm: string;
  name: string;
  type: "Local" | "Remote";
  appId: string;
  rqmname?: string;
  rname?: string;
  xmitq?: string;
}
export interface TransmitQueue { qm: string; name: string; targetQm: string; }
export interface Channel {
  name: string;
  kind: "SDR" | "RCVR" | "SVRCONN";
  fromQm: string;
  toQm?: string;
  xmitq?: string;
  conn?: string;
  sslCipher: string;
  mcaUser: string;
}
export interface Flow {
  flowType: "Local" | "Remote";
  producer: { appId: string; appName: string; neighborhood: string; qm: string; queue: string; queueType: "Local"|"Remote"; transmitQueue?: string; channel?: string };
  consumer: { appId: string; appName: string; neighborhood: string; qm: string; queue: string; queueType: "Local"|"Remote"; };
}
export interface Topology {
  apps: AppRef[];
  qms: Record<string, QueueManager>;
  queues: Queue[];
  transmits: TransmitQueue[];
  channels: Channel[];
  flows: Flow[];
}

export interface AuditEvent {
  id: string;
  ts: string;
  kind: string;
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
  status: "pending" | "running" | "ok" | "failed" | "rolled_back" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
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
