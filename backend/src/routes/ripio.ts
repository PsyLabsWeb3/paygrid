import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { createPrivyAuthMiddleware, getAuthUser } from "../middleware/privy-auth.js";
import {
  createOrResumeRipioProfile,
  createRipioCanary,
  createRipioFiatAccount,
  createRipioOfframpSession,
  getRipioCanary,
  getRipioProfile,
  releaseRipioCanary,
  runRipioPreflight,
} from "../services/ripio.js";

const profileSchema = z.object({ email: z.string().email(), redirectUrl: z.string().url() });
const fiatAccountSchema = z.object({ clabe: z.string().regex(/^\d{18}$/) });
const canarySchema = z.object({ amountMxn: z.string().regex(/^\d+(\.\d{1,2})?$/) });
const releaseSchema = z.object({ confirmation: z.string() });
const idSchema = z.string().uuid();

function userOrThrow(c: any) {
  const auth = getAuthUser(c);
  if (!auth) throw new ApiError(401, "UNAUTHORIZED", "Privy authentication required");
  return auth;
}

export function ripioRoutes(env: Env) {
  const app = new Hono();
  const requirePrivy = createPrivyAuthMiddleware(env, { required: true });
  app.use("/*", requirePrivy);

  app.get("/profile", async (c) => c.json({ profile: await getRipioProfile(env, userOrThrow(c).user) }));
  app.post("/profile", async (c) => {
    const body = profileSchema.parse(await c.req.json());
    return c.json(await createOrResumeRipioProfile(env, userOrThrow(c).user, body.email, body.redirectUrl), 201);
  });
  app.post("/profile/fiat-account", async (c) => {
    const body = fiatAccountSchema.parse(await c.req.json());
    return c.json({ profile: await createRipioFiatAccount(env, userOrThrow(c).user, body.clabe) }, 201);
  });
  app.post("/profile/offramp-session", async (c) =>
    c.json({ profile: await createRipioOfframpSession(env, userOrThrow(c).user) }, 201));

  app.post("/canaries/preflight", async (c) => c.json(await runRipioPreflight(env)));
  app.post("/canaries", async (c) => {
    const body = canarySchema.parse(await c.req.json());
    return c.json(await createRipioCanary(env, userOrThrow(c).user, body.amountMxn), 201);
  });
  app.get("/canaries/:id", async (c) =>
    c.json(await getRipioCanary(env, userOrThrow(c).user, idSchema.parse(c.req.param("id")))));
  app.post("/canaries/:id/release", async (c) => {
    const auth = userOrThrow(c);
    const body = releaseSchema.parse(await c.req.json());
    return c.json(await releaseRipioCanary(env, auth.user, auth.privyId, idSchema.parse(c.req.param("id")), body.confirmation));
  });
  return app;
}
