import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const checkPaymentStatus = tool({
  description: "Checks the status of a specific payment link by its ID.",
  parameters: z.object({
    linkId: z.string().describe("The unique ID of the payment link"),
  }),
  execute: async ({ linkId }) => {
    const response = await fetchWithAgentAuth(`/api/links/${linkId}`);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to fetch payment link status: ${errorData}`);
    }

    return await response.json();
  },
});
