import { loadEnv } from "./config/env.js";
import { createChainClients, paygridRouterAbiConst } from "./lib/chain.js";
import { handlePaymentReceived } from "./services/indexer-handler.js";

const env = loadEnv();
const { publicClient } = createChainClients(env);

console.log("[indexer] watching PaymentReceived on", env.PAYGRID_ROUTER_ADDRESS);

publicClient.watchContractEvent({
  address: env.PAYGRID_ROUTER_ADDRESS,
  abi: paygridRouterAbiConst,
  eventName: "PaymentReceived",
  onLogs: async (logs) => {
    for (const log of logs) {
      if (!("args" in log) || !log.args || !log.transactionHash) continue;
      const args = log.args as {
        linkId: bigint;
        payer: `0x${string}`;
        token: `0x${string}`;
        amount: bigint;
        fee: bigint;
        method: number;
      };
      await handlePaymentReceived(env, {
        linkId: args.linkId,
        payer: args.payer,
        token: args.token,
        amount: args.amount,
        fee: args.fee,
        method: args.method,
        transactionHash: log.transactionHash,
      });
    }
  },
  onError: (error) => {
    console.error("[indexer] subscription error", error);
  },
});
