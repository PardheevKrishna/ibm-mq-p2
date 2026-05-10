import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Expected errors when BCL isn't reachable yet — suppress noisy stack traces.
const IGNORED_PROXY_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EPIPE"]);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err: NodeJS.ErrnoException) => {
            if (!IGNORED_PROXY_CODES.has(err.code ?? "")) {
              console.error("[proxy /api]", err.message);
            }
          });
        },
      },
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err: NodeJS.ErrnoException) => {
            if (!IGNORED_PROXY_CODES.has(err.code ?? "")) {
              console.error("[proxy /ws]", err.message);
            }
          });
        },
      },
      "/healthz": {
        target: "http://localhost:8080",
        configure: (proxy) => {
          proxy.on("error", () => undefined);
        },
      },
      "/readyz": {
        target: "http://localhost:8080",
        configure: (proxy) => {
          proxy.on("error", () => undefined);
        },
      },
    },
  },
});
