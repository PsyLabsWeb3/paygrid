"use client";

import { FormEvent, useState } from "react";
import { Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { createMiniPayLink, getPaymentLinkConfig } from "@/lib/api";
import { WalletConnection } from "@/components/wallet-connection";
import { addLocalActivity } from "@/lib/local-activity";
import type { SupportedPaymentToken } from "@/lib/tokens";
import { useQuery } from "@tanstack/react-query";
import { availableLinkTokens, isValidLinkAmount, linkPaymentMethods } from "@/lib/payment-links";
import { appConfig } from "@/lib/env";

export function PaymentRequestForm() {
  const { address, isConnected, chainId } = useAccount();
  const [amount, setAmount] = useState("1.00");
  const [token, setToken] = useState<SupportedPaymentToken>("USDC");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState("");

  const config = useQuery({
    queryKey: ["payment-link-config"],
    queryFn: getPaymentLinkConfig,
    refetchInterval: 30_000,
  });
  const tokens = availableLinkTokens(config.data, appConfig.chainId);
  const canSubmit = Boolean(isConnected && address && isAddress(address) &&
    chainId === appConfig.chainId && tokens.includes(token) && isValidLinkAmount(amount, token));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || !canSubmit) {
      toast.error("Connect an account on the payment network and enter a valid amount");
      return;
    }

    setIsCreating(true);
    try {
      const link = await createMiniPayLink({
        amount,
        token,
        description: description.trim() || undefined,
        recipientAddress: address,
        acceptedMethods: linkPaymentMethods(token),
      });
      const url = `${window.location.origin}/pay/${link.id}`;
      setCheckoutUrl(url);
      addLocalActivity({
        id: link.id,
        amount: link.amount,
        token: link.token,
        description,
        status: link.status,
        createdAt: link.createdAt,
      });
      toast.success("Payment request ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setIsCreating(false);
    }
  }

  async function copyUrl() {
    if (!checkoutUrl) return;
    await navigator.clipboard.writeText(checkoutUrl);
    toast.success("Checkout copied");
  }

  return (
    <section className="panel panel-pad">
      <WalletConnection />
      <form className="stack" onSubmit={onSubmit}>
        <div className="field-grid">
          <label>
            <span className="label">Amount</span>
            <input
              className="input amount-input"
              inputMode="decimal"
              maxLength={80}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            <span className="label">Stablecoin</span>
            <select
              className="select"
              value={token}
              onChange={(event) => setToken(event.target.value as SupportedPaymentToken)}
            >
              {!tokens.includes(token) ? <option value={token} disabled>{token} (unavailable)</option> : null}
              {tokens.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span className="label">Memo</span>
          <textarea
            className="textarea"
            value={description}
            maxLength={140}
            placeholder="Service, order, agent task"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <button className="primary-button" type="submit" disabled={!canSubmit || isCreating}>
          {isCreating ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          Request payment
        </button>
      </form>

      {token === "wMXN" ? <p className="fine muted" style={{ marginTop: 12 }}>Mexican pesos on Celo. The payer needs wMXN in their wallet.</p> : null}

      {checkoutUrl ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <span className="inline-code">{checkoutUrl}</span>
          <button className="secondary-button" type="button" onClick={copyUrl}>
            <Copy size={18} />
            Copy checkout
          </button>
        </div>
      ) : null}
    </section>
  );
}
