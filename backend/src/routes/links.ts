import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { TOKEN_ADDRESSES, type Stablecoin } from "../lib/tokens.js";
import {
  buildCryptoPayTx,
  createPaymentLink,
  getPaymentLink,
} from "../services/links.js";

const stablecoins = ["USDm", "USDC", "USDT"] as const;

const createLinkSchema = z.object({
  amount: z.string(),
  token: z.enum(stablecoins),
  description: z.string().optional(),
  acceptedMethods: z
    .array(z.enum(["crypto", "fonbnk"]))
    .min(1)
    .default(["crypto"]),
  recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  expiresAt: z.string().datetime().optional(),
});

const paySchema = z.object({
  method: z.enum(["crypto", "fonbnk"]),
});

export function linksRoutes(env: Env) {
  const app = new Hono();

  app.post("/", async (c) => {
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

  app.get("/:id", async (c) => {
    const { link, payments } = await getPaymentLink(env, c.req.param("id"));
    return c.json({
      id: link.id,
      onChainLinkId: String(link.on_chain_link_id),
      recipientAddress: link.recipient_address,
      amount: link.amount,
      token: link.token,
      description: link.description,
      acceptedMethods: link.accepted_methods,
      status: link.status,
      txHash: link.tx_hash,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      payments,
    });
  });

  app.post("/:id/pay", async (c) => {
    const { method } = paySchema.parse(await c.req.json());
    if (method === "fonbnk") {
      throw new ApiError(400, "UNSUPPORTED_METHOD", "Fonbnk payments are not enabled yet");
    }
    const result = await buildCryptoPayTx(env, c.req.param("id"));
    return c.json(result);
  });

  return app;
}
