import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import type { Env } from "../config/env.js";
import paygridLinkAbi from "./contracts/PaygridLink.json" with { type: "json" };
import paygridRouterAbi from "./contracts/PaygridRouter.json" with { type: "json" };

export const paygridLinkAbiConst = paygridLinkAbi as readonly unknown[];
export const paygridRouterAbiConst = paygridRouterAbi as readonly unknown[];

export function createChainClients(env: Env) {
  const account = privateKeyToAccount(env.BACKEND_WALLET_PRIVATE_KEY);
  const chain = {
    ...celoSepolia,
    id: env.CHAIN_ID,
    rpcUrls: { default: { http: [env.CELO_RPC_URL] } },
  };

  const transport = http(env.CELO_RPC_URL);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  return { publicClient, walletClient, account };
}
