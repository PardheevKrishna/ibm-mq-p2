# IBM MQ Topology Migration & Validation Automation

Demo Hackathon — Operable IBM MQ control plane that provisions a source topology, migrates it incrementally to a target topology where each application owns a dedicated queue manager, validates message flows at every step, and rolls back automatically on failure.

---

## 1. Solution Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  React UI Control Plane (brand themed)                                  │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ Topology   │ │ Migration    │ │ Fleet / QM   │ │ Audit &          │  │
│  │ Graph      │ │ Cockpit      │ │ Dashboard    │ │ Validation Log   │  │
│  └────────────┘ └──────────────┘ └──────────────┘ └──────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ REST + WebSocket  (single BCL surface)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  BCL — Business Control Layer (Node.js + Express + TypeScript + WS)     │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ Topology API     │  │ Migration        │  │ Validation Engine    │   │
│  │ /qms /queues     │  │ Planner +        │  │ producer/consumer    │   │
│  │ /channels /apps  │  │ Executor         │  │ probes + assertions  │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ Guardrails       │  │ Audit Log +      │  │ Health & Probes      │   │
│  │ naming · DLQ ·   │  │ Event Stream     │  │ /healthz /readyz     │   │
│  │ TLS · MCA · zone │  │ (WS + SSE)       │  │ per-component        │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │   MQ Adapter (pluggable)                                        │    │
│  │   ├── RealAdapter  → IBM MQ Admin REST (HTTPS:9443) + MQSC      │    │
│  │   └── SimAdapter   → in-memory state machine (demo / CI)        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ Admin REST + AMQP/MQI
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MQ Fleet  (docker-compose / OpenShift Deployment per QM)               │
│  Source QMs:   WL6EEBDJ · WL6ER0C · WL6ER2C · WQ22 · WQ31 · WL6ES3C ... │
│  Target QMs:   APPQM_LIY_KW · APPQM_RO · APPQM_JUUD_C9 · APPQM_*  ...   │
└─────────────────────────────────────────────────────────────────────────┘
```

The **BCL is the only path** to the fleet. The UI never talks to MQ directly. Every mutation goes through guardrail validation, is recorded in the audit log, and emits a WebSocket event so all open UI sessions update live.

---

## 2. Source vs. Target Topology

### Source (current state, derived from `data/source_slice.csv`)
Six applications share queue managers and queues are co-located. Cross-QM flows already exist as `Remote` queues that funnel through transmit queues + sender channels.

| App ID | App Name | Role | Domain | QMs (shared) |
|---|---|---|---|---|
| `LIY/KW` | Lnvoriywf1 Pnhyrfhhvvn… | Producer | Data & Analytics | `WL6EEBDJ`, `WL6ER0C`, `WL6ER2C` |
| `RO` | LNVOR JUUD WRQPIEL YEH-TF | Producer | Mainframe | `WQ22`, `WQ31` |
| `JUUD/C9` | LCU-Juudoflf… | Consumer | Core Banking | `WL6EEBDJ`, `WL6ER0C` |
| `APUMN/GC` | ArcxsIlfsZyuMogzcypdcdok | Consumer | Core Banking | `WL6EEBDJ`, `WL6ER2C` |
| `HMR/QX` | Tundi-Jhcxnxs… | Consumer | Core Banking | `WL6ES3C`, `WUZ03`, `WLZ03`, `WQ21` |
| `ZN` | Joowugphl Iapuign… | Consumer | Mainframe | `WQ22`, `WQ31` |
| `LDCWH/TH` | Lnvoriywf1 Tevkdtao Oud | Consumer | Data & Analytics | `WQ22` |

### Target (desired end state, derived from `data/target_slice.csv`)
Each application owns a single dedicated queue manager. **All** cross-app flows become `Remote` queues that traverse `APPQM_<PROD>.APPQM_<CONS>` channels with transmit queues `APPQM_<CONS>.XMIT`.

| App | Dedicated QM |
|---|---|
| LIY/KW | `APPQM_LIY_KW` |
| RO | `APPQM_RO` |
| JUUD/C9 | `APPQM_JUUD_C9` |
| APUMN/GC | `APPQM_APUMN_GC` |
| HMR/QX | `APPQM_HMR_QX` |
| ZN | `APPQM_ZN` |
| LDCWH/TH | `APPQM_LDCWH_TH` |

### Naming convention (inferred from the data)
- Queue Managers: `APPQM_<APPID>` (uppercased, slash → underscore)
- Channels: `<SRC_QM>.<DST_QM>`
- Transmit queues: `<DST_QM>.XMIT`
- Local/remote queue names preserve their original business name across the move.

---

## 3. Guardrails enforced by the BCL

| # | Constraint | Where enforced |
|---|---|---|
| 1 | Each target app on a dedicated QM | `migration.planner` rejects plans that violate isolation |
| 2 | Mandatory DLQ per QM | `guardrails.policy.requireDLQ` on every QM create |
| 3 | Encryption (auth'n) | Channel CRUD requires `sslCipher`; non-TLS rejected |
| 4 | MCA-based auth'z | Every channel gets an `MCAUSER` + ChannelAuth record |
| 5 | Cross-region traffic via QM-to-QM channels | Detected by neighborhood + zone fields → forces SDR/RCVR pair |
| 6 | Cross-zone connections via SVRCONN | App→QM bindings produce SVRCONN with TLS |
| 7 | Naming convention | Regex validators per object type; non-compliant blocked |
| 8 | No direct MQ access from UI/external | UI bundle has no MQ client; CORS limited; admin REST not exposed externally |
| 9 | Transparent rewiring | Migration writes Remote queue + transmit + channel **before** flipping the producer; old defs only deleted after success |
| 10 | Automated rollback | Every step records inverse op; failure replays inverses in reverse order |

---

## 4. Migration Strategy (per application)

```
For each app A (selected one at a time):
  1. PLAN   — diff source vs. target for A; emit ordered op list
  2. STAGE  — provision target QM, DLQ, listener, server-conn (idempotent)
  3. WIRE   — create remote queue defs + transmit queues + sender/receiver
              channels on producers so messages reach the new QM via XMIT
  4. CUTOVER — drain source local queues; flip routing so producers'
              "Remote" defs point at the new APPQM_<A>; consumer rebinds
              to APPQM_<A> SVRCONN — connection string handled by BCL
              alias, so client config never changes
  5. VERIFY — validation engine sends N test messages end-to-end; asserts
              delivery, ordering, no-loss, no-dup, latency budget
  6. CLEAN  — only after VERIFY passes, decommission old objects
              (or keep dormant for grace window)
  ON ANY FAILURE → executor replays the inverse op list; UI flashes red;
                   audit log records the failure + rollback trace.
```

Two-phase wire-then-cutover guarantees the **transparent rewiring** constraint: producers and consumers that aren't part of this app's migration are never touched.

---

## 5. Validation

The validation engine is a small built-in producer/consumer harness that:
- Sends a sequenced batch of test messages (`hackathon-probe-<uuid>-<seq>`) to a chosen flow.
- Subscribes on the consumer side and asserts:
  - all sequence numbers received exactly once (no loss, no dup)
  - end-to-end latency under threshold
  - no DLQ growth attributable to the probe
- Runs **before**, **during** (per app cutover), and **after** migration.
- Failure → automatic rollback hook fires.

---

## 6. Components & how to run

```
bcl/    Node 20 + TypeScript + Express + ws    REST :8080 / WS :8080/ws
ui/     Vite + React + TypeScript               Static :5173 (dev) / :80 (docker)
docker-compose.yml  brings up BCL + UI + 3 MQ containers (subset of fleet for laptops)
```

**Quick start (local, sim mode — no MQ required):**

```bash
cd bcl && npm install && npm run dev          # → BCL on :8080
cd ui  && npm install && npm run dev          # → UI on :5173
```

**Full demo with real MQ containers:**

```bash
docker-compose up --build
# UI:  http://localhost:5173
# BCL: http://localhost:8080  (health: /healthz, ready: /readyz)
# MQ web consoles: https://localhost:9443, :9444, :9445
```

The BCL picks adapter mode from `BCL_MODE=sim|real` (default `sim`). In sim mode the entire fleet is simulated — perfect for the demo machine. In real mode it talks to actual MQ admin REST APIs and will create live MQSC objects.

---

## 7. Operability

| Quality | Implementation |
|---|---|
| Liveness probe | `GET /healthz` — process up |
| Readiness probe | `GET /readyz` — adapter handshake + state hydrated |
| Logging | structured JSON (`pino`), correlation id per request |
| Audit | append-only event log w/ user, op, before/after, ts |
| Observability | WS event stream; UI shows live ops; counters per QM |
| E2E tests | `bcl/test/` exercises plan→execute→validate→rollback |
| Error responses | RFC7807 problem+json with `code`, `field`, `hint` |

---

## 8. Repository layout

```
.
├── README.md                  this file
├── data/                      source_slice.csv, target_slice.csv (inputs)
├── info/                      problem statement, FAQ, patterns
├── mq-v2.yaml                 reference QM Deployment (used as template)
├── bcl/                       Business Control Layer
│   ├── src/
│   │   ├── index.ts                  Express + WS bootstrap
│   │   ├── data/loader.ts            CSV → typed topology model
│   │   ├── state/store.ts            in-memory state of record + audit
│   │   ├── mq/                       adapters (sim + real)
│   │   ├── guardrails/               naming + policy validators
│   │   ├── migration/                planner + executor + rollback
│   │   ├── validation/               probe runner
│   │   ├── api/                      REST routes
│   │   └── ws/                       event broadcaster
│   ├── package.json · tsconfig.json · Dockerfile
└── ui/                        React control plane
    ├── src/
    │   ├── main.tsx · App.tsx
    │   ├── theme/brand.ts            Brand color tokens
    │   ├── api/                      REST + WS clients
    │   ├── components/               Layout, header, sidebar, graphs
    │   └── pages/                    Topology, Migration, Fleet, Audit
    ├── index.html · vite.config.ts · package.json · Dockerfile
└── docker-compose.yml         BCL + UI + MQ fleet
```
