import { Hono } from "hono";
import type { Context, Next } from "hono";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import {
  buildClaimAuthorization,
  buildClaimPreparation,
  buildGiftFundingTx,
  buildGiftRefundTx,
  createClaimSession,
  createGiftDraft,
  getGiftLeaderboard,
  getPublicGift,
  quoteGiftFunding,
} from "../services/gifts.js";

const stablecoins = ["USDm", "USDC", "USDT"] as const;
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value as `0x${string}`);

const createGiftSchema = z.object({
  senderAddress: address,
  senderAlias: z.string().trim().min(1).max(40),
  recipientAlias: z.string().trim().min(1).max(40),
  message: z.string().trim().min(1).max(240),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  token: z.enum(stablecoins),
  claimHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value as `0x${string}`),
  expiresAt: z.string().datetime(),
  sourceReferralCode: z.string().trim().min(4).max(32).optional(),
});

const fundingSchema = z.object({
  payerToken: z.enum(stablecoins),
  slippageBps: z.number().int().min(1).max(1000).optional(),
});

const claimSessionSchema = z.object({
  secret: z.string().min(16).max(256),
});

const claimAuthorizationSchema = z.object({
  sessionToken: z.string().min(20).max(256),
  recipientAddress: address,
});

const preparationHits = new Map<string, { count: number; resetAt: number }>();

async function claimPreparationRateLimit(c: Context, next: Next) {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
  const key = createHash("sha256").update(ip).digest("hex");
  const now = Date.now();
  const entry = preparationHits.get(key);
  if (!entry || now >= entry.resetAt) {
    preparationHits.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 5) {
    throw new ApiError(429, "RATE_LIMITED", "Too many account preparation requests");
  }
  return next();
}

export function giftsRoutes(env: Env) {
  const app = new Hono();

  app.get("/leaderboard", async (c) => c.json(await getGiftLeaderboard(env)));

  app.post("/minipay", async (c) => {
    const body = createGiftSchema.parse(await c.req.json());
    return c.json(await createGiftDraft(env, body), 201);
  });

  app.get("/:id/public", async (c) => c.json(await getPublicGift(env, c.req.param("id"))));
  app.get("/:id/status", async (c) => c.json(await getPublicGift(env, c.req.param("id"))));

  app.post("/:id/funding-tx", async (c) => {
    const body = fundingSchema.parse(await c.req.json());
    return c.json(await buildGiftFundingTx(env, c.req.param("id"), body));
  });

  app.post("/:id/quote", async (c) => {
    const body = fundingSchema.parse(await c.req.json());
    return c.json(await quoteGiftFunding(env, c.req.param("id"), body));
  });

  app.post("/:id/claim-session", async (c) => {
    const body = claimSessionSchema.parse(await c.req.json());
    return c.json(await createClaimSession(env, c.req.param("id"), body.secret));
  });

  app.post("/:id/claim-authorization", async (c) => {
    const body = claimAuthorizationSchema.parse(await c.req.json());
    return c.json(await buildClaimAuthorization(env, c.req.param("id"), body));
  });

  app.post("/:id/claim-preparation", claimPreparationRateLimit, async (c) => {
    const body = claimAuthorizationSchema.parse(await c.req.json());
    return c.json(await buildClaimPreparation(env, c.req.param("id")!, body));
  });

  app.post("/:id/refund-tx", async (c) => c.json(await buildGiftRefundTx(env, c.req.param("id"))));

  return app;
}
