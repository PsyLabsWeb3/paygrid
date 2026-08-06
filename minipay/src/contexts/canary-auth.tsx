"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { createContext, useContext, type ReactNode } from "react";
import { appConfig } from "@/lib/env";

type CanaryAuth = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const CanaryAuthContext = createContext<CanaryAuth>({
  configured: false,
  ready: true,
  authenticated: false,
  login: () => undefined,
  logout: async () => undefined,
  getAccessToken: async () => null,
});

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  return (
    <CanaryAuthContext.Provider value={{ configured: true, ready, authenticated, login, logout, getAccessToken }}>
      {children}
    </CanaryAuthContext.Provider>
  );
}

export function CanaryAuthProvider({ children }: { children: ReactNode }) {
  if (!appConfig.privyAppId) return <>{children}</>;
  return (
    <PrivyProvider appId={appConfig.privyAppId} config={{ loginMethods: ["email"] }}>
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

export const useCanaryAuth = () => useContext(CanaryAuthContext);
