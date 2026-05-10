import type {
  AuditEvent,
  Channel,
  MigrationPlan,
  Queue,
  QueueManager,
  Topology,
  ValidationResult,
} from "./types.ts";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  if (r.status === 204) return undefined as unknown as T;
  return r.json();
}

export const api = {
  health: () => get<{ ok: boolean }>("/healthz"),
  ready: () => get<{ ok: boolean; adapter: { mode: string }; qms: number }>("/readyz"),

  source: () => get<Topology>("/api/topology/source"),
  target: () => get<Topology>("/api/topology/target"),
  current: () => get<Topology>("/api/topology/current"),

  qms: () => get<QueueManager[]>("/api/fleet/qms"),
  qmHealth: (name: string) =>
    get<{ ok: boolean; state: string; health: string }>(`/api/fleet/qms/${name}/health`),
  queues: (qm?: string) =>
    get<Queue[]>(`/api/fleet/queues${qm ? `?qm=${encodeURIComponent(qm)}` : ""}`),
  channels: () => get<Channel[]>("/api/fleet/channels"),

  plans: () => get<MigrationPlan[]>("/api/migration/plans"),
  plan: (id: string) => get<MigrationPlan>(`/api/migration/plans/${id}`),
  draftPlan: (appId: string) => post<MigrationPlan>(`/api/migration/plan/${encodeURIComponent(appId)}`),
  executePlan: (id: string) => post<{ accepted: boolean }>(`/api/migration/plans/${id}/execute`),
  rollbackPlan: (id: string) => post<{ accepted: boolean }>(`/api/migration/plans/${id}/rollback`),
  rollbackAll: () => post<{ ok: boolean }>("/api/migration/rollback-all"),

  validations: (appId?: string) =>
    get<ValidationResult[]>(`/api/validation${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`),
  runValidation: (appId: string) =>
    post<ValidationResult>(`/api/validation/run/${encodeURIComponent(appId)}`),

  audit: (limit = 200) => get<AuditEvent[]>(`/api/audit?limit=${limit}`),

  provisionSourceStatus: () =>
    get<{ total: number; done: number; failed: number; status: string; errors: string[] }>(
      "/api/topology/provision-source/status"
    ),
  provisionSource: () => post<{ accepted: boolean; message: string }>("/api/topology/provision-source"),
};
