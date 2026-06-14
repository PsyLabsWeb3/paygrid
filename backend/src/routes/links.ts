import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { TOKEN_ADDRESSES, type Stablecoin } from "../lib/tokens.js";
import { createOwnershipAuthMiddleware } from "../middleware/ownership-auth.js";
import { getAuthAgent } from "../middleware/erc8004-auth.js";
import { getAuthUser } from "../middleware/privy-auth.js";
import {
  buildCryptoPayTx,
  createPaymentLink,
  getPaymentLink,
  listOwnedLinks,
} from "../services/links.js";
import { createFonbnkPaySession } from "../services/fonbnk.js";

const stablecoins = ["USDm", "USDC", "USDT"] as const;
const fonbnkPaymentChannels = ["bank", "mobile_money", "airtime"] as const;

const createLinkSchema = z.object({
  amount: z.string(),
  token: z.enum(stablecoins),
  description: z.string().optional(),
  acceptedMethods: z.array(z.enum(["crypto", "fonbnk"])).min(1).default(["crypto"]),
  recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  expiresAt: z.string().datetime().optional(),
});

const cryptoPaySchema = z.object({
  method: z.literal("crypto"),
});

const fonbnkPaySchema = z.object({
  method: z.literal("fonbnk"),
  countryIsoCode: z.string().min(2).max(3),
  paymentChannel: z.enum(fonbnkPaymentChannels).optional(),
  carrierCode: z.string().min(1).optional(),
  email: z.string().email(),
  userIp: z.string().ip().optional(),
  redirectUrl: z.string().url().optional(),
  extraFields: z.record(z.string(), z.unknown()).optional(),
});

const paySchema = z.discriminatedUnion("method", [cryptoPaySchema, fonbnkPaySchema]);

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

  app.get("/:id", async (c) => {
    const { link, payments } = await getPaymentLink(env, c.req.param("id"));
    return c.json({
      id: link.id,
      onChainLinkId: String(link.on_chain_link_id),
      recipientAddress: link.recipient_address,
      amount: String(link.amount),
      token: link.token,
      description: link.description,
      acceptedMethods: link.accepted_methods,
      status: link.status,
      txHash: link.tx_hash,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      payments: payments.map((payment) => ({
        ...payment,
        amount: String(payment.amount),
        fee_amount: String(payment.fee_amount),
      })),
    });
  });

  app.post("/:id/pay", async (c) => {
    const body = paySchema.parse(await c.req.json());
    if (body.method === "crypto") {
      const result = await buildCryptoPayTx(env, c.req.param("id"));
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
