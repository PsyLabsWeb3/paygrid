import type { Address } from "viem";
import type { Env } from "../config/env.js";

export type Stablecoin = "USDm" | "USDC" | "USDT";

export const TOKEN_DECIMALS: Record<Stablecoin, number> = {
  USDC: 6,
  USDT: 6,
  USDm: 18,
};

export const DEFAULT_TOKEN_ADDRESSES: Record<Stablecoin, Address> = {
  USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
};

export const TOKEN_ADDRESSES = DEFAULT_TOKEN_ADDRESSES;

export function getTokenAddresses(env?: Pick<Env, "USDC_ADDRESS" | "USDT_ADDRESS" | "USDM_ADDRESS">) {
  return {
    USDm: env?.USDM_ADDRESS ?? DEFAULT_TOKEN_ADDRESSES.USDm,
    USDC: env?.USDC_ADDRESS ?? DEFAULT_TOKEN_ADDRESSES.USDC,
    USDT: env?.USDT_ADDRESS ?? DEFAULT_TOKEN_ADDRESSES.USDT,
  } satisfies Record<Stablecoin, Address>;
}

export function getTokenAddress(
  env: Pick<Env, "USDC_ADDRESS" | "USDT_ADDRESS" | "USDM_ADDRESS">,
  token: Stablecoin,
) {
  return getTokenAddresses(env)[token];
}

export function getStablecoinByAddress(
  env: Pick<Env, "USDC_ADDRESS" | "USDT_ADDRESS" | "USDM_ADDRESS">,
  address: Address,
) {
  const normalized = address.toLowerCase();
  const entry = Object.entries(getTokenAddresses(env)).find(
    ([, tokenAddress]) => tokenAddress.toLowerCase() === normalized,
  );
  return entry?.[0] as Stablecoin | undefined;
}

export function parseHumanAmount(amount: string | number, token: Stablecoin): bigint {
  const trimmed = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid amount format");
  }
  const [whole, frac = ""] = trimmed.split(".");
  const decimals = TOKEN_DECIMALS[token];
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

export function formatHumanAmount(value: bigint, token: Stablecoin): string {
  const decimals = TOKEN_DECIMALS[token];
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
