import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import type { Env } from "./config/env.js";
import { ApiError, errorResponse } from "./lib/errors.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { linksRoutes } from "./routes/links.js";
import { paymentsRoutes } from "./routes/payments.js";
import { fonbnkRoutes } from "./routes/onramp/fonbnk.js";
import { rampRoutes } from "./routes/onramp/ramp.js";
import { x402Routes } from "./routes/x402.js";
import { giftsRoutes } from "./routes/gifts.js";

const defaultCorsOrigins = [
  "http://localhost:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3002",
];

function getCorsOrigins(env: Env) {
  return (
    env.CORS_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? defaultCorsOrigins
  );
}

export function createApp(env: Env) {
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

  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        const allowedOrigins = getCorsOrigins(env);
        if (allowedOrigins.includes("*")) {
          return origin;
        }
        return allowedOrigins.includes(origin) ? origin : undefined;
      },
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-API-Key",
        "X-Signature",
        "X-ERC8004-Agent-ID",
        "X-ERC8004-Address",
        "X-ERC8004-Timestamp",
        "X-ERC8004-Nonce",
        "X-ERC8004-Signature",
        "X-Body-Signature",
      ],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("/api/*", rateLimit);
  app.route("/api/links", linksRoutes(env));
  app.route("/api/gifts", giftsRoutes(env));
  app.route("/api/payments", paymentsRoutes(env));
  app.route("/api/onramp/fonbnk", fonbnkRoutes(env));
  app.route("/api/onramp/ramp", rampRoutes(env));
  app.route("/api/x402", x402Routes(env));

  return app;
}

export function serveApp(env: Env) {
  const app = createApp(env);
  return serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Paygrid API listening on http://localhost:${info.port}`);
  });
}
