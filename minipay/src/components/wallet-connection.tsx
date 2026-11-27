"use client";

import { useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { Loader2, Wallet } from "lucide-react";
import { appConfig } from "@/lib/env";

export function WalletConnection({ chainId = appConfig.chainId }: { chainId?: number }) {
  const account = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [error, setError] = useState("");
  if (account.isConnected && account.chainId === chainId) return null;

  async function run(action: () => Promise<unknown>) {
    setError("");
    try { await action(); }
    catch { setError("Connection unavailable. Check your wallet and try again."); }
  }
  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      {account.isConnected ? (
        <button className="secondary-button" type="button" disabled={switching}
          onClick={() => run(() => switchChainAsync({ chainId }))}>
          {switching ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
          Switch to {chainId === 42220 ? "Celo" : "Celo Sepolia"}
        </button>
      ) : connectors.map((connector) => (
        <button className="secondary-button" type="button" key={connector.uid} disabled={isPending}
          onClick={() => run(() => connectAsync({ connector }))}>
          {isPending ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
          Connect {connector.id === "injected" ? "browser wallet" : connector.name}
        </button>
      ))}
      {error ? <p className="fine muted" role="alert">{error}</p> : null}
    </div>
  );
}
