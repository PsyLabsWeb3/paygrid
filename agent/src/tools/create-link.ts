import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const createPaymentLink = tool({
  description: "Creates a new stablecoin payment link for the given amount and recipient.",
  parameters: z.object({
    amount: z.string().describe("The payment amount as a string (e.g. '10.50')"),
    token: z.enum(["USDC", "USDT", "USDm"]).describe("The token to receive payment in"),
    description: z.string().describe("Description for the payment link"),
    recipientAddress: z.string().describe("0x address of the recipient"),
    acceptedMethods: z.array(z.enum(["crypto", "fonbnk"])).describe("List of accepted payment methods"),
  }),
  execute: async (params) => {
    const response = await fetchWithAgentAuth("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to create payment link: ${errorData}`);
    }

    return await response.json();
  },
});
