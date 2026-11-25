import { loadEnv } from "./config/env.js";
import { getPayments } from "./x402/runtime.js";
const env = loadEnv(),
  payments = getPayments(env);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  try {
    await payments.reconcile();
  } catch {
    console.error(JSON.stringify({ event: "x402_reconciliation_unavailable" }));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 15_000));
}
