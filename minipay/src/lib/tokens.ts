import type { Address } from "viem";
import { appConfig } from "@/lib/env";

export type Stablecoin = "USDm" | "USDC" | "USDT";
export type SupportedPaymentToken = "USDC";

export const tokenDecimals: Record<Stablecoin, number> = {
  USDC: 6,
  USDT: 6,
  USDm: 18,
};

export const paymentTokens: SupportedPaymentToken[] = ["USDC"];

export const tokenAddresses: Record<SupportedPaymentToken, Address> = {
  USDC: appConfig.usdcAddress,
};
