import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import {
  getFonbnkCountryConfig,
  handleFonbnkWebhook,
} from "../../services/fonbnk.js";

const configQuerySchema = z.object({
  country: z.string().min(2).max(3),
});

export function fonbnkRoutes(env: Env) {
  const app = new Hono();

  app.get("/config", async (c) => {
    const query = configQuerySchema.parse({
      country: c.req.query("country") ?? c.req.query("countryIsoCode"),
    });
    const result = await getFonbnkCountryConfig(env, query.country.toUpperCase());
    return c.json(result);
  });

  app.post("/webhook", async (c) => {
    const rawBody = await c.req.text();
    let parsed: unknown;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid JSON payload");
    }

    const result = await handleFonbnkWebhook(
      env,
      parsed as Parameters<typeof handleFonbnkWebhook>[1],
      rawBody,
      new Headers(c.req.raw.headers),
    );
    return c.json(result);
  });

  return app;
}
