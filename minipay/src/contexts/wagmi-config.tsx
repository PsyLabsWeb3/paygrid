"use client";

import { useEffect } from "react";
import { http, createConfig, useAccount, useConnect, useSwitchChain } from "wagmi";
import { celo, celoAlfajores } from "wagmi/chains";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";
import { appConfig } from "@/lib/env";
import { isMiniPayEnvironment } from "@/lib/minipay";

export const celoSepolia = defineChain({
  id: 11142220,
  name: "Celo Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "CELO",
    symbol: "CELO",
  },
  rpcUrls: {
    default: {
      http: [appConfig.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "CeloScan",
      url: "https://sepolia.celoscan.io",
    },
  },
  testnet: true,
});

const isProduction = appConfig.appEnv === "production";
export const primaryChain = isProduction ? celo : celoSepolia;
const chains = isProduction
  ? ([primaryChain] as const)
  : ([celoSepolia, celoAlfajores, celo] as const);

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  ssr: true,
  transports: {
    [celo.id]: http(appConfig.rpcUrl),
    [celoAlfajores.id]: http(),
    [celoSepolia.id]: http(appConfig.rpcUrl),
  },
});

export function useAutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors, status } = useConnect();

  useEffect(() => {
    if (isConnected || status === "pending") return;
    const connector = connectors.find((item) => item.id === "injected") ?? connectors[0];
    if (!connector) return;
    if (!isMiniPayEnvironment() && typeof window === "undefined") return;
    connect({ connector });
  }, [connect, connectors, isConnected, status]);
}

export function NetworkEnforcer() {
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (!isConnected || !chainId || chainId === primaryChain.id) return;
    switchChain({ chainId: primaryChain.id });
  }, [chainId, isConnected, switchChain]);

  return null;
}
