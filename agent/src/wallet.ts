import { createWalletClient, http, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
if (!privateKey) {
  throw new Error("AGENT_PRIVATE_KEY is missing in .env");
}

export const account = privateKeyToAccount(privateKey);

export const publicClient = createPublicClient({
  chain: celoSepolia,
  transport: http(process.env.CELO_RPC_URL),
});

export const walletClient = createWalletClient({
  account,
  chain: celoSepolia,
  transport: http(process.env.CELO_RPC_URL),
});

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? process.env.CELO_CHAIN_ID ?? celoSepolia.id);

export const ERC8004_AGENT_ID = process.env.ERC8004_AGENT_ID;
if (!ERC8004_AGENT_ID) {
  throw new Error("ERC8004_AGENT_ID is missing in .env");
}

export const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
