import { loadEnv } from "./config/env.js";
import { createChainClients } from "./lib/chain.js";
import { getPaymentLinkConfig } from "./services/link-config.js";
import { formatEther } from "viem";
try {
  const env = loadEnv();
  const proposed = { ...env, WMXN_LINKS_ENABLED: "true" as const };
  const config = await getPaymentLinkConfig(proposed);
  const { publicClient, account } = createChainClients(env);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(JSON.stringify({ ...config, creatorAddress: account.address,
    creatorNetworkBalance: formatEther(balance), notice: "Read-only: no payment link or transaction was created." }));
  if (!config.wMXN.enabled) process.exitCode = 1;
} catch { console.error(JSON.stringify({ error: "Payment link preflight failed" })); process.exitCode = 1; }
