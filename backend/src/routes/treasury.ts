import { timingSafeEqual } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import {
  getTreasuryQuantStatus,
  listTreasuryPositions,
  listTreasurySignals,
  requestAllTreasuryPositionsClose,
  requestTreasuryPositionClose,
  setTreasuryPause,
  submitTreasurySignal,
} from "../services/treasury.js";
import {
  createTreasuryDepositLink,
  createTreasuryWithdrawalAddress,
  deactivateTreasuryWithdrawalAddress,
  executeTreasuryWithdrawal,
  getTreasuryFunds,
  previewTreasuryWithdrawal,
} from "../services/treasury-funds.js";
import { TREASURY_FUND_ASSETS } from "../lib/treasury-funds.js";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const pauseSchema = z.object({
  reason: z.string().trim().min(1).max(300).optional(),
});

const stablecoins = ["USDm", "USDC", "USDT"] as const;
const depositLinkSchema = z.object({
  requestId: z.string().trim().min(1).max(120).optional(),
  amount: z.string().trim().min(1),
  token: z.enum(stablecoins),
  description: z.string().trim().max(200).optional(),
});
const withdrawalAddressSchema = z.object({
  label: z.string().trim().min(1).max(80),
  address: z.string().trim(),
  destinationType: z.enum(["minipay", "exchange", "external_wallet"]),
  asset: z.enum(TREASURY_FUND_ASSETS),
});
const withdrawalSchema = z.object({
  requestId: z.string().trim().min(1).max(120),
  asset: z.enum(TREASURY_FUND_ASSETS),
  amount: z.string().trim().min(1),
  withdrawalAddressId: z.string().uuid(),
  mode: z.enum(["free", "evacuate"]),
});

function secretMatches(expected: string | undefined, provided: string | null | undefined) {
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearer(c: Context) {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function requireSignalSecret(env: Env, c: Context) {
  const provided =
    c.req.header("x-treasury-signal-secret")
    ?? bearer(c)
    ?? c.req.query("key");
  if (!secretMatches(env.TREASURY_SIGNAL_SECRET, provided)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid TradingView webhook secret");
  }
}

async function requireAdmin(env: Env, c: Context, next: Next) {
  const provided = c.req.header("x-treasury-admin-key") ?? bearer(c);
  if (!secretMatches(env.TREASURY_ADMIN_API_KEY, provided)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid Treasury operator key");
  }
  await next();
}

export function treasuryRoutes(env: Env) {
  const app = new Hono();

  app.get("/status", async (c) => c.json(await getTreasuryQuantStatus(env)));
  app.get("/signals", async (c) => {
    const query = listSchema.parse(c.req.query());
    return c.json({ signals: await listTreasurySignals(env, query.limit) });
  });
  app.get("/positions", async (c) => {
    const query = listSchema.parse(c.req.query());
    return c.json({ positions: await listTreasuryPositions(env, query.limit) });
  });

  app.post("/signals/tradingview", async (c) => {
    requireSignalSecret(env, c);
    const result = await submitTreasurySignal(env, await c.req.json());
    return c.json(result, result.duplicate ? 200 : 202);
  });

  app.post("/control/pause", (c, next) => requireAdmin(env, c, next), async (c) => {
    const body = pauseSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await setTreasuryPause(env, true, body.reason));
  });
  app.post("/control/resume", (c, next) => requireAdmin(env, c, next), async (c) => {
    return c.json(await setTreasuryPause(env, false));
  });
  app.post("/control/close-all", (c, next) => requireAdmin(env, c, next), async (c) => {
    return c.json(await requestAllTreasuryPositionsClose(env));
  });
  app.post("/positions/:id/close", (c, next) => requireAdmin(env, c, next), async (c) => {
    return c.json(await requestTreasuryPositionClose(env, c.req.param("id")));
  });

  app.get("/funds", (c, next) => requireAdmin(env, c, next), async (c) => {
    return c.json(await getTreasuryFunds(env));
  });
  app.post("/deposit-links", (c, next) => requireAdmin(env, c, next), async (c) => {
    const body = depositLinkSchema.parse(await c.req.json());
    return c.json(await createTreasuryDepositLink(env, body), 201);
  });
  app.post("/withdrawal-addresses", (c, next) => requireAdmin(env, c, next), async (c) => {
    const body = withdrawalAddressSchema.parse(await c.req.json());
    return c.json(await createTreasuryWithdrawalAddress(env, body), 201);
  });
  app.post("/withdrawal-addresses/:id/deactivate", (c, next) => requireAdmin(env, c, next), async (c) => {
    return c.json(await deactivateTreasuryWithdrawalAddress(env, c.req.param("id")));
  });
  app.post("/withdrawals/preview", (c, next) => requireAdmin(env, c, next), async (c) => {
    const body = withdrawalSchema.parse(await c.req.json());
    return c.json(await previewTreasuryWithdrawal(env, body));
  });
  app.post("/withdrawals", (c, next) => requireAdmin(env, c, next), async (c) => {
    const body = withdrawalSchema.parse(await c.req.json());
    return c.json(await executeTreasuryWithdrawal(env, body));
  });

  return app;
}
