import { Router } from "express";
import { store } from "../state/store.js";

export const auditRouter = Router();

auditRouter.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const kind = req.query.kind as string | undefined;
  const target = req.query.target as string | undefined;
  let list = store.audit;
  if (kind) list = list.filter((e) => e.kind === kind);
  if (target) list = list.filter((e) => e.target === target);
  res.json(list.slice(-limit).reverse());
});
