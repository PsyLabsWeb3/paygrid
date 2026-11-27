import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { STABLECOINS, TOKEN_ADDRESSES, getTokenAddress, TOKEN_DECIMALS, formatHumanAmount, type Stablecoin } from "../lib/tokens.js";
import { createOwnershipAuthMiddleware } from "../middleware/ownership-auth.js";
import { getAuthAgent } from "../middleware/erc8004-auth.js";
import { getAuthUser } from "../middleware/privy-auth.js";
import {
  buildCryptoPayTx,
  buildPreparedPayTx,
  createPaymentLink,
  getPaymentLink,
  listOwnedLinks,
  quotePaymentLink,
} from "../services/links.js";
import { createFonbnkPaySession } from "../services/fonbnk.js";
import { createRampPaySession } from "../services/ramp.js";
import { getPaymentLinkConfig } from "../services/link-config.js";
import { linkAmount } from "../lib/link-amount.js";

const stablecoins = STABLECOINS;
const fonbnkPaymentChannels = ["bank", "mobile_money", "airtime"] as const;

const createLinkSchema = z.object({
  amount: z.string().trim().min(1).max(80),
  token: z.enum(stablecoins),
  description: z.string().optional(),
  acceptedMethods: z.array(z.enum(["crypto", "fonbnk", "card"])).min(1).default(["crypto"]),
  recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  expiresAt: z.string().datetime().optional(),
}).superRefine((body, ctx) => {
  if (body.token === "wMXN" && (body.acceptedMethods.length !== 1 || body.acceptedMethods[0] !== "crypto"))
    ctx.addIssue({ code: "custom", path: ["acceptedMethods"], message: "wMXN links accept direct wallet payments only" });
});

const quoteSchema = z.object({
  payerToken: z.enum(STABLECOINS),
  slippageBps: z.number().int().positive().optional(),
});

const cryptoPaySchema = z.object({
  method: z.literal("crypto"),
  payerToken: z.enum(STABLECOINS).optional(),
  slippageBps: z.number().int().positive().optional(),
});

const fonbnkPaySchema = z.object({
  method: z.literal("fonbnk"),
  countryIsoCode: z.string().min(2).max(3),
  paymentChannel: z.enum(fonbnkPaymentChannels).optional(),
  carrierCode: z.string().min(1).optional(),
  email: z.string().email(),
  userIp: z.union([z.ipv4(), z.ipv6()]).optional(),
  redirectUrl: z.string().url().optional(),
  extraFields: z.record(z.string(), z.unknown()).optional(),
});

const rampPaySchema = z.object({
  method: z.literal("ramp"),
  finalUrl: z.string().url().optional(),
  selectedCountryCode: z.string().min(2).max(2).optional(),
  userEmailAddress: z.string().email().optional(),
});

const paySchema = z.discriminatedUnion("method", [cryptoPaySchema, fonbnkPaySchema, rampPaySchema]);

const listQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["active", "paid", "expired", "cancelled"]).optional(),
  token: z.enum(stablecoins).optional(),
});

function resolveOwner(c: any) {
  const authUser = getAuthUser(c);
  if (authUser) {
    return { id: authUser.user.id, type: "user" as const };
  }

  const authAgent = getAuthAgent(c);
  if (authAgent) {
    return { id: authAgent.agent.id, type: "agent" as const };
  }

  return null;
}

export function linksRoutes(env: Env) {
  const app = new Hono();
  const requireOwnershipAuth = createOwnershipAuthMiddleware(env);

  app.get("/", requireOwnershipAuth, async (c) => {
    const owner = resolveOwner(c);
    if (!owner) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing authenticated user or agent");
    }

    const query = listQuerySchema.parse(c.req.query());
    const result = await listOwnedLinks(env, owner, query);
    return c.json(result);
  });

  app.post("/", requireOwnershipAuth, async (c) => {
    const body = createLinkSchema.parse(await c.req.json());
    if (!Object.keys(TOKEN_ADDRESSES).includes(body.token)) {
      throw new ApiError(400, "INVALID_TOKEN", `Token ${body.token} is not supported`);
    }

    const owner = resolveOwner(c);
    const result = await createPaymentLink(env, {
      ...body,
      recipientAddress: body.recipientAddress as `0x${string}`,
      token: body.token as Stablecoin,
      creator: owner ?? undefined,
    });
    return c.json(result, 201);
  });

  app.post("/minipay", async (c) => {
    const body = createLinkSchema.parse(await c.req.json());
    if (!Object.keys(TOKEN_ADDRESSES).includes(body.token)) {
      throw new ApiError(400, "INVALID_TOKEN", `Token ${body.token} is not supported`);
    }

    const result = await createPaymentLink(env, {
      ...body,
      recipientAddress: body.recipientAddress as `0x${string}`,
      token: body.token as Stablecoin,
    });
    return c.json(result, 201);
  });

  app.get("/config", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await getPaymentLinkConfig(env));
  });

  app.get("/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    const { link, payments } = await getPaymentLink(env, c.req.param("id"));
    return c.json({
      id: link.id,
      onChainLinkId: String(link.on_chain_link_id),
      paygridLinkAddress: link.paygrid_link_address,
      recipientAddress: link.recipient_address,
      amount: linkAmount(link),
      amountAtomic: link.amount_atomic ?? undefined,
      tokenAddress: getTokenAddress(env, link.token),
      chainId: env.CHAIN_ID,
      settlementDecimals: link.settlement_decimals ?? TOKEN_DECIMALS[link.token],
      acceptedPayerAssets: link.partner_name || link.amount_atomic ? link.accepted_payer_assets : undefined,
      token: link.token,
      description: link.description,
      acceptedMethods: link.accepted_methods,
      status: link.status,
      txHash: link.tx_hash,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      payments: payments.map((payment) => ({
        ...payment,
        amount: payment.gross_amount_atomic ? formatHumanAmount(BigInt(payment.gross_amount_atomic), payment.token) : String(payment.amount),
        fee_amount: payment.fee_amount_atomic ? formatHumanAmount(BigInt(payment.fee_amount_atomic), payment.token) : String(payment.fee_amount),
      })),
    });
  });

  app.post("/:id/quote", async (c) => {
    const body = quoteSchema.parse(await c.req.json());
    const result = await quotePaymentLink(env, c.req.param("id"), body);
    return c.json(result);
  });

  app.post("/:id/pay", async (c) => {
    const body = paySchema.parse(await c.req.json());
    if (body.method === "crypto") {
      const result = body.payerToken
        ? await buildPreparedPayTx(env, c.req.param("id"), {
            payerToken: body.payerToken,
            slippageBps: body.slippageBps,
          })
        : await buildCryptoPayTx(env, c.req.param("id"));
      return c.json(result);
    }

    if (body.method === "ramp") {
      const result = await createRampPaySession(env, c.req.param("id"), {
        finalUrl: body.finalUrl,
        selectedCountryCode: body.selectedCountryCode,
        userEmailAddress: body.userEmailAddress,
      });
      return c.json(result);
    }

    const result = await createFonbnkPaySession(env, c.req.param("id"), {
      countryIsoCode: body.countryIsoCode,
      paymentChannel: body.paymentChannel,
      carrierCode: body.carrierCode,
      email: body.email,
      userIp: body.userIp,
      redirectUrl: body.redirectUrl,
      extraFields: body.extraFields,
    });
    return c.json(result);
  });

  return app;
}
