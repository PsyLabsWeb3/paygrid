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
export const odeleitePaymentLinkCreateSchema = z.object({
  external_business_id: uuid,
  external_link_id: uuid,
  recipient_address: evmAddress,
  amount_atomic: z.string().regex(/^\d+$/).refine((value) => {
    const amount = BigInt(value);
    return amount >= 10_000n && amount <= 10_000_000n;
  }, "amount_atomic must be between 0.01 and 10 USDC"),
  settlement_asset: z.literal("USDC"),
  accepted_payer_assets: z.tuple([z.literal("USDC"), z.literal("USDT"), z.literal("USDm")]),
  description: z.string().max(200).default(""),
  merchant_display_name: z.string().trim().min(1).max(120),
  // Django serializes UTC datetimes with an explicit `+00:00` offset. Accept
  // valid RFC 3339 offsets in addition to the `Z` form produced by browsers.
  expires_at: z.string().datetime({ offset: true }),
  brand: z.literal("odeleite"),
}).superRefine((value, ctx) => {
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
    const body = odeleitePaymentLinkCreateSchema.parse(await c.req.json());
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
