import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { createX402Middleware, getX402Proof } from "../middleware/x402.js";

export function x402Routes(env: Env) {
  const app = new Hono();
  const requirePayment = createX402Middleware(env);

  app.get("/data", requirePayment, (c) => {
    const proof = getX402Proof(c);
    return c.json({
      ok: true,
      resource: c.req.path,
      message: "x402 payment accepted",
      proof,
    });
  });

  return app;
}
