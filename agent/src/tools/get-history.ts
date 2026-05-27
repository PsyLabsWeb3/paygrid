import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const getPaymentHistory = tool({
  description: "Gets the payment history for the agent.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Number of records to fetch"),
    status: z.enum(["pending", "confirmed", "failed", "all"]).optional(),
  }),
  execute: async ({ limit = 20, status = "all" }) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (status !== "all") {
      query.set("status", status);
    }

    const response = await fetchWithAgentAuth(`/api/payments?${query.toString()}`);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to fetch payment history: ${errorData}`);
    }

    return await response.json();
  },
});
