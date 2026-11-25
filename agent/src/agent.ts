import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";

import { createPaymentLink } from "./tools/create-link";
import { checkPaymentStatus } from "./tools/check-status";
import { getBalance } from "./tools/get-balance";
import { getPaymentHistory } from "./tools/get-history";
import { payX402Endpoint, x402PaymentStatus, x402Capabilities } from "./tools/pay-x402-endpoint";
import { executeTreasuryReport } from "./tools/treasury-report";
import { quotePaymentRequest } from "./tools/quote-payment-request";
import { payPaymentRequest } from "./tools/pay-payment-request";
import {
  createGift,
  getGift,
  getGiftLeaderboard,
  prepareGiftFunding,
  prepareGiftRefund,
  quoteGiftFunding,
  verifyGiftClaim,
} from "./tools/gifts";

const agentTools = {
  createGift,
  quoteGiftFunding,
  prepareGiftFunding,
  getGift,
  verifyGiftClaim,
  prepareGiftRefund,
  getGiftLeaderboard,
  createPaymentLink,
  checkPaymentStatus,
  getBalance,
  getPaymentHistory,
  executeTreasuryReport,
  payX402Endpoint,
  x402PaymentStatus,
  x402Capabilities,
  quotePaymentRequest,
  payPaymentRequest,
};

export async function runAgent(prompt: string) {
  const { text, toolCalls, toolResults } = await generateText({
    model: openai("gpt-4o-mini"),
    system: "You are the Paygrid Agent. You turn human intent into policy-aware payments and personal claimable gifts, prepare stablecoin routes, verify settlement, and summarize treasury data. You never sign for a human wallet and always ask for confirmation before preparing a human wallet transaction. Dedicated x402 wallet payments are automatic only within backend policy. Never replace the idempotency key to recover a pending or unknown x402 payment; query its operation ID.",
    prompt,
    tools: agentTools,
  });

  return { text, toolCalls, toolResults };
}
