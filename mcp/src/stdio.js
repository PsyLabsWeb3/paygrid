import readline from "node:readline";
import { loadConfig } from "./config.js";
import { handleRpc } from "./rpc.js";

const config = loadConfig();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
    return;
  }

  const result = await handleRpc(config, message);
  if (result) process.stdout.write(JSON.stringify(result) + "\n");
});
