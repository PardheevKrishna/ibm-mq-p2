import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { store } from "../state/store.js";

export function attachWs(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "hello", ts: new Date().toISOString() }));
    // Replay last 50 audit events for context.
    for (const ev of store.audit.slice(-50)) {
      ws.send(JSON.stringify({ type: "audit", event: ev }));
    }
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  store.on("event", (msg) => {
    const text = JSON.stringify(msg);
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(text);
    }
  });

  return wss;
}
