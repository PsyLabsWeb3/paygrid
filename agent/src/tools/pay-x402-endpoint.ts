import { tool } from "ai";
import { z } from "zod";
import {
  fetchX402Endpoint,
  getX402PaymentStatus,
  getX402Capabilities,
} from "../x402-payer";
export const payX402Endpoint = tool({
  description:
    "Pay an authorized x402 API through Paygrid's central executor. Reuse the same idempotencyKey for every retry of one intent. A pending or unknown outcome must be queried, never paid again with a fresh key.",
  inputSchema: z
    .object({
      url: z
        .string()
        .url()
        .default("https://api.celopaygrid.xyz/api/x402/data"),
      method: z.enum(["GET", "POST"]).default("GET"),
      body: z.record(z.string(), z.unknown()).optional(),
      preferredToken: z.enum(["USDC", "USDT", "wMXN"]).optional(),
      idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
    })
    .strict(),
  execute: async (options) => fetchX402Endpoint(options),
});
export const x402PaymentStatus = tool({
  description:
    "Look up an existing x402 operation without authorizing another payment.",
  inputSchema: z.object({ operationId: z.string().uuid() }).strict(),
  execute: async ({ operationId }) => getX402PaymentStatus(operationId),
});
export const x402Capabilities = tool({
  description: "Read enabled x402 networks, currencies and API prices.",
  inputSchema: z.object({}).strict(),
  execute: async () => getX402Capabilities(),
});
