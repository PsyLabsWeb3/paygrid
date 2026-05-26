import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";

// Placeholder for actual tools (Phase 3)
const agentTools = {
  // e.g. createPaymentLink: tool(...)
};

export async function runAgent(prompt: string) {
  const { text, toolCalls, toolResults } = await generateText({
    model: openai("gpt-4o-mini"),
    system: "You are the Paygrid Agent. You manage payments, create links, and summarize treasury data.",
    prompt,
    tools: agentTools,
    maxSteps: 5,
  });

  return { text, toolCalls, toolResults };
}
