import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";
import type { Env } from "../config/env.js";
import paygridLinkAbi from "./contracts/PaygridLink.json" with { type: "json" };
import paygridRouterAbi from "./contracts/PaygridRouter.json" with { type: "json" };

export const paygridLinkAbiConst = paygridLinkAbi as readonly unknown[];
export const paygridRouterAbiConst = paygridRouterAbi as readonly unknown[];

export function createChainClients(env: Env, privateKey = env.BACKEND_WALLET_PRIVATE_KEY) {
  const account = privateKeyToAccount(privateKey);
  const baseChain = env.CHAIN_ID === celo.id ? celo : celoSepolia;
  const chain: Chain = {
    ...baseChain,
    id: env.CHAIN_ID,
    rpcUrls: { default: { http: [env.CELO_RPC_URL] } },
  };

  const transport = http(env.CELO_RPC_URL);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  return { publicClient, walletClient, account };
}
