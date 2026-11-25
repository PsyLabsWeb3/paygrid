import { loadEnv } from "./config/env.js";
import { getPayments } from "./x402/runtime.js";
try {
  // Validate the proposed enabled configuration without activating routes or signing.
  const env = loadEnv();
  const payments = getPayments({
    ...env,
    X402_SELLER_ENABLED: "true",
    X402_PAYER_ENABLED: "true",
  });
  await payments.ready();
  const balances = await Promise.all(
    payments.cfg.assets.map(async (a) => ({
      token: a.token,
      amountAtomic: String(
        await (
          payments.protocol as import("./x402/protocol.js").CeloProtocol
        ).balance(a.address),
      ),
    })),
  );
  console.log(
    JSON.stringify({
      ok: true,
      ...(await payments.protocol.preflight()),
      payerAddress: payments.cfg.payerAddress,
      payTo: payments.cfg.payTo,
      balances,
      notice:
        "No transaction was submitted. Facilitator settlement credentials and credits are proven only by the canary.",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Preflight failed",
    }),
  );
  process.exitCode = 1;
}
