import * as dotenv from "dotenv";
dotenv.config();

import { runAgent } from "./agent";

async function main() {
  console.log("Paygrid Agent Runtime booting...");
  console.log(`Agent ID: ${process.env.ERC8004_AGENT_ID}`);
  console.log(`Backend URL: ${process.env.BACKEND_URL}`);
  
  const args = process.argv.slice(2);
  const prompt = args.join(" ");
  
  if (prompt) {
    console.log(`\nExecuting prompt: "${prompt}"`);
    const result = await runAgent(prompt);
    console.log("\nResponse:", result.text);
  } else {
    console.log("No prompt provided. Agent is idle.");
    console.log("Usage: npm start <your prompt>");
  }
}

main().catch(console.error);
