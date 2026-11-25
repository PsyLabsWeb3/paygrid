import { privateKeyToAccount } from "viem/accounts";
import { isAddress, type Address } from "viem";
import type { Env } from "../config/env.js";
import { X402Error, type Token } from "./types.js";

export const REQUEST_LIMIT = 64 * 1024;
export const RESPONSE_LIMIT = 1024 * 1024;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const TOKENS = {
  USDC: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    name: "USDC",
    version: "2",
    method: "eip3009",
    price: "100000",
    perPayment: "5000000",
    daily: "50000000",
  },
  USDT: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    name: "Tether USD",
    version: "1",
    method: "eip3009",
    price: "100000",
    perPayment: "5000000",
    daily: "50000000",
  },
  wMXN: {
    address: "0x337E7456B420bD3481e7FA61fA9850343d610d34",
    decimals: 18,
    name: "Peso Mexicano",
    version: "1",
    method: "permit2",
    price: "2000000000000000000",
    perPayment: "100000000000000000000",
    daily: "1000000000000000000000",
  },
} as const;
export type Asset = {
  token: Token;
  address: string;
  decimals: number;
  name: string;
  version: string;
  method: string;
  price: string;
  perPayment: string;
  daily: string;
};
export type Merchant = {
  origin: string;
  paths: string[];
  methods: ("GET" | "POST")[];
  payTo: string[];
};
export type Config = {
  seller: boolean;
  payer: boolean;
  chainId: number;
  network: `eip155:${number}`;
  rpcUrl: string;
  publicApiUrl: string;
  payTo?: Address;
  payerKey?: `0x${string}`;
  payerAddress?: Address;
  apiKey?: string;
  executorKey?: string;
  encryptionKey?: string;
  facilitatorUrl: string;
  assets: Asset[];
  merchants: Merchant[];
};
export function uint(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,77}$/.test(value) ||
    BigInt(value) >= 2n ** 256n
  ) {
    throw new X402Error(
      400,
      "INVALID_AMOUNT",
      "Expected a positive uint256 atomic amount string",
    );
  }
  return value;
}
export function config(env: Env): Config {
  const seller = env.X402_SELLER_ENABLED === "true",
    payer = env.X402_PAYER_ENABLED === "true";
  const chainId = env.CHAIN_ID;
  if ((seller || payer) && ![42220, 11142220].includes(chainId))
    throw new Error("x402 supports only Celo mainnet and Sepolia");
  const key = env.X402_PAYER_PRIVATE_KEY;
  const account = key ? privateKeyToAccount(key) : undefined;
  const publicApiUrl = (
    env.X402_PUBLIC_API_URL ?? "https://api.celopaygrid.xyz"
  ).replace(/\/$/, "");
  const assets: Asset[] = (
    chainId === 11142220 ? ["USDC"] : ["USDC", "USDT", "wMXN"]
  ).map((token) => {
    const t = token as Token,
      base = TOKENS[t];
    const overrides = env.X402_ASSET_CONFIG
      ? JSON.parse(env.X402_ASSET_CONFIG)
      : {};
    const fields = overrides[t] ?? {};
    return {
      ...base,
      token: t,
      address:
        chainId === 11142220
          ? "0x01C5C0122039549AD1493B8220cABEdD739BC44E"
          : base.address,
      price: uint(fields.price ?? base.price),
      perPayment: uint(fields.perPayment ?? base.perPayment),
      daily: uint(fields.daily ?? base.daily),
    };
  });
  const merchants: Merchant[] = env.X402_MERCHANTS
    ? JSON.parse(env.X402_MERCHANTS)
    : env.X402_PAY_TO
      ? [
          {
            origin: new URL(publicApiUrl).origin,
            paths: ["/api/x402/data"],
            methods: ["GET"],
            payTo: [env.X402_PAY_TO],
          },
        ]
      : [];
  for (const merchant of merchants) {
    const origin = new URL(merchant.origin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== merchant.origin ||
      !merchant.paths?.length ||
      !merchant.payTo?.length ||
      !merchant.methods?.length ||
      merchant.methods.some((m) => !["GET", "POST"].includes(m)) ||
      merchant.paths.some((p) => !p.startsWith("/") || p.includes("*")) ||
      merchant.payTo.some((a) => !isAddress(a))
    )
      throw new Error("Invalid x402 merchant policy");
  }
  if (seller || payer) {
    if (
      !env.X402_ENCRYPTION_KEY ||
      !/^[0-9a-f]{64}$/i.test(env.X402_ENCRYPTION_KEY)
    )
      throw new Error("X402_ENCRYPTION_KEY must be 32 bytes hex");
    if (!env.X402_EXECUTOR_API_KEY || env.X402_EXECUTOR_API_KEY.length < 32)
      throw new Error(
        "X402_EXECUTOR_API_KEY must contain at least 32 characters",
      );
    if (!env.CELO_RPC_URL) throw new Error("CELO_RPC_URL is required for x402");
  }
  if (seller && (!env.X402_API_KEY || !env.X402_PAY_TO))
    throw new Error(
      "X402_API_KEY and X402_PAY_TO are required for seller mode",
    );
  if (payer && (!account || !merchants.length))
    throw new Error(
      "Dedicated X402_PAYER_PRIVATE_KEY and merchant policy are required",
    );
  if (
    account &&
    env.X402_PAYER_ADDRESS &&
    env.X402_PAYER_ADDRESS.toLowerCase() !== account.address.toLowerCase()
  )
    throw new Error("X402_PAYER_ADDRESS does not match the configured signer");
  if (account) {
    for (const other of [
      env.BACKEND_WALLET_PRIVATE_KEY,
      env.TREASURY_EXECUTOR_PRIVATE_KEY,
      env.GIFT_CLAIM_SIGNER_PRIVATE_KEY,
      env.ROUTER_OWNER_PRIVATE_KEY,
    ]) {
      if (
        other &&
        /^0x[0-9a-f]{64}$/i.test(other) &&
        privateKeyToAccount(other as `0x${string}`).address === account.address
      )
        throw new Error("x402 payer must be a dedicated wallet");
    }
    if (env.X402_PAY_TO?.toLowerCase() === account.address.toLowerCase())
      throw new Error("x402 seller and payer wallets must differ");
  }
  return {
    seller,
    payer,
    chainId,
    network: `eip155:${chainId}`,
    rpcUrl: env.CELO_RPC_URL ?? "",
    publicApiUrl,
    payTo: env.X402_PAY_TO,
    payerKey: key,
    payerAddress: account?.address ?? env.X402_PAYER_ADDRESS,
    apiKey: env.X402_API_KEY,
    executorKey: env.X402_EXECUTOR_API_KEY,
    encryptionKey: env.X402_ENCRYPTION_KEY,
    facilitatorUrl:
      chainId === 11142220
        ? "https://api.x402.sepolia.celo.org"
        : "https://api.x402.celo.org",
    assets,
    merchants,
  };
}
