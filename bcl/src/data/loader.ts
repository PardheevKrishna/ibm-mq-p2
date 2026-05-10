import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import type {
  AppRef,
  Channel,
  Flow,
  Queue,
  QueueManager,
  Topology,
  TransmitQueue,
} from "../types.js";

interface CsvRow {
  flow_type: string;
  producer_app_id: string;
  producer_app_name: string;
  producer_neighborhood: string;
  producer_queue_manager: string;
  producer_queue_name: string;
  producer_queue_type: string;
  transmit_queue_name: string;
  channel_name: string;
  consumer_app_id: string;
  consumer_app_name: string;
  consumer_neighborhood: string;
  consumer_queue_manager: string;
  consumer_queue_name: string;
  consumer_queue_type: string;
}

function readCsv(file: string): CsvRow[] {
  const text = readFileSync(file, "utf-8");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    // Local-flow rows in the provided CSVs omit the channel_name field
    // (one empty field instead of two), so 14 columns land instead of 15.
    // Local flows never have channels, so if channel_name is non-empty the
    // column is misaligned — detect by flow_type and missing consumer_queue_type.
    on_record: (rec: Record<string, string>) => {
      if (rec.flow_type === "Local" && rec.channel_name && !rec.consumer_queue_type) {
        return {
          flow_type:             rec.flow_type,
          producer_app_id:       rec.producer_app_id,
          producer_app_name:     rec.producer_app_name,
          producer_neighborhood: rec.producer_neighborhood,
          producer_queue_manager:rec.producer_queue_manager,
          producer_queue_name:   rec.producer_queue_name,
          producer_queue_type:   rec.producer_queue_type,
          transmit_queue_name:   rec.transmit_queue_name ?? "",
          channel_name:          "",
          consumer_app_id:       rec.channel_name,
          consumer_app_name:     rec.consumer_app_id  ?? "",
          consumer_neighborhood: rec.consumer_app_name ?? "",
          consumer_queue_manager:rec.consumer_neighborhood ?? "",
          consumer_queue_name:   rec.consumer_queue_manager ?? "",
          consumer_queue_type:   rec.consumer_queue_name ?? "",
        } as CsvRow;
      }
      return rec as CsvRow;
    },
  }) as CsvRow[];
}

// Source CSV has a typo: "LDCHH/TH" should be "LDCWH/TH" (same app, same name).
// Normalize here so source and target app IDs match and migration plans are correct.
const APP_ID_ALIASES: Record<string, string> = {
  "LDCHH/TH": "LDCWH/TH",
};
function normalizeAppId(id: string): string {
  return APP_ID_ALIASES[id] ?? id;
}

function ensureApp(map: Map<string, AppRef>, id: string, name: string, hood: string) {
  const nid = normalizeAppId(id);
  if (!map.has(nid)) map.set(nid, { appId: nid, appName: name, neighborhood: hood });
}

function inferRegion(qm: string): "WEST" | "EAST" | "LEGACY" {
  if (qm.startsWith("WL6")) return "WEST";
  if (qm.startsWith("APPQM_")) return "WEST";
  if (qm.startsWith("WQ") || qm.startsWith("WU") || qm.startsWith("WL")) return "EAST";
  return "LEGACY";
}

function inferZone(hood: string): "STANDARD" | "SECURE" {
  return /Mainframe|Core Banking/i.test(hood) ? "SECURE" : "STANDARD";
}

function buildTopology(rows: CsvRow[], isTarget: boolean): Topology {
  const apps = new Map<string, AppRef>();
  const qms = new Map<string, QueueManager>();
  const queues = new Map<string, Queue>();        // key = qm + "|" + name
  const transmits = new Map<string, TransmitQueue>();
  const channels = new Map<string, Channel>();
  const flows: Flow[] = [];

  let listenerPort = 1414;
  let consolePort = 9443;

  function ensureQm(name: string, hood: string, appIds: string[]) {
    const existing = qms.get(name);
    if (existing) {
      for (const a of appIds) if (!existing.apps.includes(a)) existing.apps.push(a);
      return existing;
    }
    const qm: QueueManager = {
      name,
      apps: [...appIds],
      region: inferRegion(name),
      zone: inferZone(hood),
      dlq: "SYSTEM.DEAD.LETTER.QUEUE",
      state: isTarget ? "absent" : "running",
      health: isTarget ? "down" : "ok",
      listenerPort: listenerPort++,
      consolePort: consolePort++,
      tls: { enabled: true, cipher: "ANY_TLS12_OR_HIGHER" },
      createdAt: new Date().toISOString(),
      isTarget,
    };
    qms.set(name, qm);
    return qm;
  }

  for (const r of rows) {
    const pid = normalizeAppId(r.producer_app_id);
    const cid = normalizeAppId(r.consumer_app_id);

    ensureApp(apps, pid, r.producer_app_name, r.producer_neighborhood);
    ensureApp(apps, cid, r.consumer_app_name, r.consumer_neighborhood);
    ensureQm(r.producer_queue_manager, r.producer_neighborhood, [pid]);
    ensureQm(r.consumer_queue_manager, r.consumer_neighborhood, [cid]);

    const pqKey = `${r.producer_queue_manager}|${r.producer_queue_name}`;
    if (!queues.has(pqKey)) {
      queues.set(pqKey, {
        qm: r.producer_queue_manager,
        name: r.producer_queue_name,
        type: r.producer_queue_type as Queue["type"],
        appId: pid,
        rqmname:
          r.producer_queue_type === "Remote" ? r.consumer_queue_manager : undefined,
        rname:
          r.producer_queue_type === "Remote" ? r.consumer_queue_name : undefined,
        xmitq: r.transmit_queue_name || undefined,
      });
    }
    const cqKey = `${r.consumer_queue_manager}|${r.consumer_queue_name}`;
    if (!queues.has(cqKey)) {
      queues.set(cqKey, {
        qm: r.consumer_queue_manager,
        name: r.consumer_queue_name,
        type: r.consumer_queue_type as Queue["type"],
        appId: cid,
      });
    }

    if (r.transmit_queue_name) {
      const k = `${r.producer_queue_manager}|${r.transmit_queue_name}`;
      if (!transmits.has(k)) {
        transmits.set(k, {
          qm: r.producer_queue_manager,
          name: r.transmit_queue_name,
          targetQm: r.consumer_queue_manager,
        });
      }
    }
    if (r.channel_name && !channels.has(r.channel_name)) {
      channels.set(r.channel_name, {
        name: r.channel_name,
        kind: "SDR",
        fromQm: r.producer_queue_manager,
        toQm: r.consumer_queue_manager,
        xmitq: r.transmit_queue_name || undefined,
        conn: `${r.consumer_queue_manager.toLowerCase()}:1414`,
        sslCipher: "ANY_TLS12_OR_HIGHER",
        mcaUser: `mca_${cid.replace(/[^A-Za-z0-9]/g, "_").toLowerCase()}`,
      });
    }

    flows.push({
      flowType: r.flow_type as Flow["flowType"],
      producer: {
        appId: pid,
        appName: r.producer_app_name,
        neighborhood: r.producer_neighborhood,
        qm: r.producer_queue_manager,
        queue: r.producer_queue_name,
        queueType: r.producer_queue_type as Queue["type"],
        transmitQueue: r.transmit_queue_name || undefined,
        channel: r.channel_name || undefined,
      },
      consumer: {
        appId: cid,
        appName: r.consumer_app_name,
        neighborhood: r.consumer_neighborhood,
        qm: r.consumer_queue_manager,
        queue: r.consumer_queue_name,
        queueType: r.consumer_queue_type as Queue["type"],
      },
    });
  }

  // every QM gets a SVRCONN channel for app bindings
  for (const qm of qms.values()) {
    const svrName = `APP.SVRCONN.${qm.name}`;
    if (!channels.has(svrName)) {
      channels.set(svrName, {
        name: svrName,
        kind: "SVRCONN",
        fromQm: qm.name,
        sslCipher: "ANY_TLS12_OR_HIGHER",
        mcaUser: `mca_app_${qm.name.toLowerCase()}`,
      });
    }
  }

  return {
    apps: [...apps.values()],
    qms: Object.fromEntries(qms),
    queues: [...queues.values()],
    transmits: [...transmits.values()],
    channels: [...channels.values()],
    flows,
  };
}

export function loadSourceTopology(dataDir: string): Topology {
  return buildTopology(readCsv(resolve(dataDir, "source_slice.csv")), false);
}

export function loadTargetTopology(dataDir: string): Topology {
  return buildTopology(readCsv(resolve(dataDir, "target_slice.csv")), true);
}
