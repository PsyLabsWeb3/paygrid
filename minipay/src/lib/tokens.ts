import type { Address } from "viem";
import { appConfig } from "@/lib/env";

export type Stablecoin = "USDm" | "USDC" | "USDT";
export type SupportedPaymentToken = Stablecoin | "wMXN";

export const tokenDecimals: Record<SupportedPaymentToken, number> = {
  USDC: 6,
  USDT: 6,
  USDm: 18,
  wMXN: 18,
};

export const paymentTokens: Stablecoin[] = ["USDC", "USDT", "USDm"];

export const tokenAddresses: Record<SupportedPaymentToken, Address> = {
  USDC: appConfig.usdcAddress,
  USDT: appConfig.usdtAddress,
  USDm: appConfig.usdmAddress,
  wMXN: appConfig.wmxnAddress,
};
