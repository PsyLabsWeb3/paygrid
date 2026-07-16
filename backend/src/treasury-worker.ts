import { loadEnv } from "./config/env.js";
import { runTreasuryWorkerCycle } from "./services/treasury.js";

const env = loadEnv();
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runTreasuryWorkerCycle(env);
    if (result.signal || result.positions.length > 0) {
      console.log("[treasury-worker]", JSON.stringify(result));
    }
  } catch (error) {
    console.error("[treasury-worker]", error);
  } finally {
    running = false;
  }
}

console.log(
  `[treasury-worker] mode=${env.TREASURY_QUANT_MODE ?? "paper"} enabled=${env.TREASURY_QUANT_ENABLED ?? "false"}`,
);
void tick();
setInterval(() => void tick(), env.TREASURY_POLL_INTERVAL_MS ?? 15000);
