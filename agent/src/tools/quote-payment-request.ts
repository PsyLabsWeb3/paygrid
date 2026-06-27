import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const quotePaymentRequest = tool({
  description: "Quotes a Paygrid payment request for a payer stablecoin, including automatic swap details.",
  inputSchema: z.object({
    id: z.string().describe("Payment request ID"),
    payerToken: z.enum(["USDC", "USDT", "USDm"]).describe("Stablecoin the payer wants to spend"),
    slippageBps: z.number().int().positive().max(100).default(100),
  }),
  execute: async (params) => {
    const response = await fetchWithAgentAuth(`/api/links/${encodeURIComponent(params.id)}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payerToken: params.payerToken,
        slippageBps: params.slippageBps,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to quote payment request: ${errorData}`);
    }

    return await response.json();
  },
});
