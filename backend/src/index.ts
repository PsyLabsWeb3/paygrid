import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ZodError } from "zod";
import { loadEnv } from "./config/env.js";
import { ApiError, errorResponse } from "./lib/errors.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { linksRoutes } from "./routes/links.js";

const env = loadEnv();
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, chainId: env.CHAIN_ID }));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorResponse(err), err.status as 400);
  }
  if (err instanceof ZodError) {
    const apiErr = new ApiError(400, "VALIDATION_ERROR", "Invalid request", {
      issues: err.issues,
    });
    return c.json(errorResponse(apiErr), 400);
  }
  console.error(err);
  const apiErr = new ApiError(500, "INTERNAL_ERROR", "Unexpected server error");
  return c.json(errorResponse(apiErr), 500);
});

app.use("/api/*", rateLimit);
app.route("/api/links", linksRoutes(env));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Paygrid API listening on http://localhost:${info.port}`);
});
