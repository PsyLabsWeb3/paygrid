import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const getPaymentHistory = tool({
  description: "Gets the payment history for the agent.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Number of records to fetch"),
    status: z.enum(["active", "paid", "all"]).optional(),
  }),
  execute: async ({ limit = 20, status = "all" }) => {
    const response = await fetchWithAgentAuth(`/api/payments?limit=${limit}&status=${status}`);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to fetch payment history: ${errorData}`);
    }

    return await response.json();
  },
});
