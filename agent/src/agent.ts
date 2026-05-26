import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";

import { createPaymentLink } from "./tools/create-link";
import { checkPaymentStatus } from "./tools/check-status";
import { getBalance } from "./tools/get-balance";
import { getPaymentHistory } from "./tools/get-history";
import { executeTreasuryReport } from "./tools/treasury-report";

const agentTools = {
  createPaymentLink,
  checkPaymentStatus,
  getBalance,
  getPaymentHistory,
  executeTreasuryReport,
};

export async function runAgent(prompt: string) {
  const { text, toolCalls, toolResults } = await generateText({
    model: openai("gpt-4o-mini"),
    system: "You are the Paygrid Agent. You manage payments, create links, and summarize treasury data. You operate autonomously.",
    prompt,
    tools: agentTools,
  });

  return { text, toolCalls, toolResults };
}
