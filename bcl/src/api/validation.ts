import { Router } from "express";
import { store } from "../state/store.js";
import { runValidation } from "../validation/runner.js";
import type { MqAdapter } from "../mq/adapter.js";

export function buildValidationRouter(adapter: MqAdapter) {
  const r = Router();

  r.get("/", (req, res) => {
    const appId = req.query.appId as string | undefined;
    const list = appId
      ? store.validations.filter((v) => v.appId === appId)
      : store.validations;
    res.json(list.slice(-200).reverse());
  });

  r.post("/run/:appId", async (req, res) => {
    const result = await runValidation(adapter, req.params.appId);
    res.json(result);
  });

  return r;
}
