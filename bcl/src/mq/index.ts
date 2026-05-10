import type { MqAdapter } from "./adapter.js";
import { SimAdapter } from "./simAdapter.js";
import { RealAdapter } from "./realAdapter.js";

export function createAdapter(): MqAdapter {
  const mode = (process.env.BCL_MODE ?? "sim").toLowerCase();
  return mode === "real" ? new RealAdapter() : new SimAdapter();
}
