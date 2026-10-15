import { Hono } from "hono";
import { zeroAddress } from "viem";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { createPartnerAuthMiddleware } from "../middleware/partner-auth.js";
import {
  cancelOdeleitePaymentLink,
  createOdeleitePaymentLink,
  getOdeleitePaymentLink,
} from "../services/partner-links.js";

const uuid = z.string().uuid();
const idempotencyKey = z.string().uuid();
const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine(
  (value) => value.toLowerCase() !== zeroAddress,
  "Zero address is not allowed",
);
export function partnerLinkCreateSchema(minWmxn = 10n**18n, maxWmxn = 10_000n * 10n**18n) {
  return z.object({
    external_business_id: uuid,
    external_link_id: uuid,
    recipient_address: evmAddress,
    amount_atomic: z.string().regex(/^[1-9]\d{0,77}$/),
    settlement_asset: z.enum(["USDC", "wMXN"]),
    accepted_payer_assets: z.array(z.enum(["USDC", "USDT", "USDm", "wMXN"])),
    description: z.string().max(200).default(""),
    merchant_display_name: z.string().trim().min(1).max(120),
    // Django serializes UTC datetimes with an explicit `+00:00` offset. Accept
    // valid RFC 3339 offsets in addition to the `Z` form produced by browsers.
    expires_at: z.string().datetime({ offset: true }),
    brand: z.literal("odeleite"),
  }).superRefine((value, ctx) => {
    if (!/^[1-9]\d{0,77}$/.test(value.amount_atomic)) return;
    const amount = BigInt(value.amount_atomic);
    const wmxn = value.settlement_asset === "wMXN";
    if (wmxn ? (amount < minWmxn || amount > maxWmxn || amount > 2n**256n - 1n || amount % 10n**16n !== 0n) : (amount < 10_000n || amount > 10_000_000n)) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: ["amount_atomic"], message: "Amount outside pilot limits"});
    }
    if (JSON.stringify(value.accepted_payer_assets) !== JSON.stringify(wmxn ? ["wMXN"] : ["USDC", "USDT", "USDm"])) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: ["accepted_payer_assets"], message: "Invalid payer assets"});
    }
    const expiresAt = new Date(value.expires_at).getTime();
    // Odeleite enforces the exact 1-day boundary. Allow five minutes of clock
    // skew/transport time between both authenticated backends.
    const minimum = Date.now() + (24 * 60 - 5) * 60 * 1000;
    const maximum = Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (expiresAt < minimum || expiresAt > maximum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "expires_at must be between 1 and 30 days from now",
      });
    }
  });
}
export const odeleitePaymentLinkCreateSchema = partnerLinkCreateSchema();

function requireIdempotencyKey(header: string | undefined) {
  const parsed = idempotencyKey.safeParse(header);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Idempotency-Key must be a UUID");
  }
  return parsed.data;
}

export function partnerLinksRoutes(env: Env) {
  const app = new Hono();
  const authenticate = createPartnerAuthMiddleware(env);

  app.use("*", authenticate);

  app.post("/", async (c) => {
    const key = requireIdempotencyKey(c.req.header("Idempotency-Key"));
    const body = partnerLinkCreateSchema(BigInt(env.ODELEITE_WMXN_MIN_ATOMIC ?? "1000000000000000000"), BigInt(env.ODELEITE_WMXN_MAX_ATOMIC ?? "10000000000000000000000")).parse(await c.req.json());
    if (body.settlement_asset === "wMXN" && env.ODELEITE_WMXN_ENABLED !== "true") throw new ApiError(403, "UNSUPPORTED_METHOD", "wMXN is disabled");
    const result = await createOdeleitePaymentLink(env, {
      ...body,
      recipient_address: body.recipient_address as `0x${string}`,
    }, key);
    return c.json(result, 201);
  });

  app.get("/:externalId", async (c) => {
    const externalId = uuid.parse(c.req.param("externalId"));
    return c.json(await getOdeleitePaymentLink(env, externalId));
  });

  app.post("/:externalId/cancel", async (c) => {
    const externalId = uuid.parse(c.req.param("externalId"));
    const key = requireIdempotencyKey(c.req.header("Idempotency-Key"));
    return c.json(await cancelOdeleitePaymentLink(env, externalId, key));
  });

  return app;
}
