"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { wagmiConfig, NetworkEnforcer, useAutoConnect } from "@/contexts/wagmi-config";
import { CanaryAuthProvider } from "@/contexts/canary-auth";

function WalletBoot({ children }: { children: React.ReactNode }) {
  useAutoConnect();
  return (
    <>
      <NetworkEnforcer />
      {children}
    </>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CanaryAuthProvider><WalletBoot>{children}</WalletBoot></CanaryAuthProvider>
        <Toaster richColors position="top-center" />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
