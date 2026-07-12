import { randomBytes } from "node:crypto";
import { tool } from "ai";
import { keccak256, toBytes } from "viem";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

async function request(path: string, init: RequestInit = {}) {
  const response = await fetchWithAgentAuth(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Gift API request failed: ${await response.text()}`);
  return response.json();
}

export const createGift = tool({
  description: "Create a personal, claimable stablecoin gift for a human recipient.",
  inputSchema: z.object({
    senderAddress: z.string(),
    senderAlias: z.string(),
    recipientAlias: z.string(),
    message: z.string(),
    amount: z.string(),
    token: z.enum(["USDC", "USDT", "USDm"]),
    expiresAt: z.string().optional(),
    sourceReferralCode: z.string().optional(),
  }),
  execute: async (params) => {
    const secret = randomBytes(32).toString("hex");
    const gift = await request("/api/gifts/minipay", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        claimHash: keccak256(toBytes(secret)),
        expiresAt: params.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      }),
    });
    return { ...gift, claimUrl: `${gift.shareUrl}#k=${secret}` };
  },
});

const fundingSchema = z.object({
  id: z.string(),
  payerToken: z.enum(["USDC", "USDT", "USDm"]),
  slippageBps: z.number().int().min(1).max(1000).optional(),
});

export const quoteGiftFunding = tool({
  description: "Quote exact-token or swap-routed funding for a gift.",
  inputSchema: fundingSchema,
  execute: ({ id, ...body }) => request(`/api/gifts/${id}/quote`, { method: "POST", body: JSON.stringify(body) }),
});

export const prepareGiftFunding = tool({
  description: "Prepare approval and funding transactions for a gift.",
  inputSchema: fundingSchema,
  execute: ({ id, ...body }) => request(`/api/gifts/${id}/funding-tx`, { method: "POST", body: JSON.stringify(body) }),
});

export const getGift = tool({
  description: "Get public gift status and settlement evidence.",
  inputSchema: z.object({ id: z.string() }),
  execute: ({ id }) => request(`/api/gifts/${id}/public`),
});

export const verifyGiftClaim = tool({
  description: "Verify whether a gift was claimed on Celo.",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const gift = await request(`/api/gifts/${id}/status`);
    return { id: gift.id, claimed: gift.status === "claimed", status: gift.status, claimTxHash: gift.claimTxHash };
  },
});

export const prepareGiftRefund = tool({
  description: "Prepare a refund transaction for an expired gift.",
  inputSchema: z.object({ id: z.string() }),
  execute: ({ id }) => request(`/api/gifts/${id}/refund-tx`, { method: "POST" }),
});

export const getGiftLeaderboard = tool({
  description: "Get the PayGrid Gifts campaign leaderboard.",
  inputSchema: z.object({}),
  execute: () => request("/api/gifts/leaderboard"),
});
