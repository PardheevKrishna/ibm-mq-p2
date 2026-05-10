import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { resolve } from "node:path";
import pino from "pino";
import pinoHttp from "pino-http";

import { loadSourceTopology, loadTargetTopology } from "./data/loader.js";
import { store } from "./state/store.js";
import { createAdapter } from "./mq/index.js";
import { topologyRouter, injectAdapterForTopologyRouter } from "./api/topology.js";
import { buildFleetRouter } from "./api/fleet.js";
import { buildMigrationRouter } from "./api/migration.js";
import { buildValidationRouter } from "./api/validation.js";
import { auditRouter } from "./api/audit.js";
import { buildHealthRouter } from "./api/health.js";
import { attachWs } from "./ws/events.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true }));
app.use(pinoHttp({ logger }));

const dataDir = process.env.BCL_DATA_DIR ?? resolve(process.cwd(), "..", "data");
const source = loadSourceTopology(dataDir);
const target = loadTargetTopology(dataDir);
store.hydrate(source, target);

const adapter = createAdapter();
injectAdapterForTopologyRouter(adapter);

app.use("/api/topology", topologyRouter);
app.use("/api/fleet", buildFleetRouter(adapter));
app.use("/api/migration", buildMigrationRouter(adapter));
app.use("/api/validation", buildValidationRouter(adapter));
app.use("/api/audit", auditRouter);
app.use("/", buildHealthRouter(adapter));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "unhandled error");
  res.status(500).json({ code: "INTERNAL_ERROR", message: err.message });
});

const port = Number(process.env.PORT ?? 8080);
const server = createServer(app);
attachWs(server);

server.listen(port, () => {
  logger.info(
    { port, mode: process.env.BCL_MODE ?? "sim", dataDir, qms: Object.keys(source.qms).length },
    "BCL up"
  );
});
