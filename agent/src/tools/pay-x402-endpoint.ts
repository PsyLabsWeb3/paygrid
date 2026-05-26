import { tool } from "ai";
import { z } from "zod";

import { fetchX402Endpoint } from "../x402-payer";

export const payX402Endpoint = tool({
  description: "Pays a Paygrid x402-protected endpoint and returns the protected response.",
  inputSchema: z.object({
    path: z.string().default("/api/x402/data").describe("Backend path for the x402 endpoint"),
    txHash: z.string().optional().describe("Optional transaction hash to include in the x402 proof"),
  }),
  execute: async ({ path, txHash }) => fetchX402Endpoint({
    path,
    txHash: txHash as `0x${string}` | undefined,
  }),
});
