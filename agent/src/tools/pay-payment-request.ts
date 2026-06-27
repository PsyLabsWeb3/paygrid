import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const payPaymentRequest = tool({
  description: "Prepares a Paygrid payment transaction, using an automatic stablecoin swap when needed.",
  inputSchema: z.object({
    id: z.string().describe("Payment request ID"),
    payerToken: z.enum(["USDC", "USDT", "USDm"]).describe("Stablecoin the payer wants to spend"),
    maxSlippageBps: z.number().int().positive().max(100).default(100),
    preferExactToken: z.boolean().default(true),
  }),
  execute: async (params) => {
    const response = await fetchWithAgentAuth(`/api/links/${encodeURIComponent(params.id)}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "crypto",
        payerToken: params.payerToken,
        slippageBps: params.maxSlippageBps,
        preferExactToken: params.preferExactToken,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to prepare payment request: ${errorData}`);
    }

    return await response.json();
  },
});
