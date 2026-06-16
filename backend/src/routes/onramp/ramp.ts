import { Hono } from "hono";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { handleRampWebhook } from "../../services/ramp.js";

export function rampRoutes(env: Env) {
  const app = new Hono();

  app.post("/webhook", async (c) => {
    const parsed = (await c.req.json().catch(() => null)) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid JSON payload");
    }

    const result = await handleRampWebhook(
      env,
      parsed,
      new Headers(c.req.raw.headers),
      c.req.query("sessionId"),
    );
    return c.json(result);
  });

  return app;
}
