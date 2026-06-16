"use client";

import { useAccount } from "wagmi";
import { getAccountHint, isMiniPayEnvironment } from "@/lib/minipay";

export function useMiniPayAccount() {
  const { address, isConnected } = useAccount();
  const isMiniPay = isMiniPayEnvironment();

  return {
    address,
    isConnected,
    isMiniPay,
    accountHint: getAccountHint(address),
  };
}
