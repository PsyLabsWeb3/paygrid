"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { WalletConnection } from "@/components/wallet-connection";
import { StatusPill } from "@/components/status-pill";
import { buildPayTx, createRampSession, getPaymentLink, quotePaymentLink, type PaymentLink, type SwapQuote } from "@/lib/api";
import { redirectToMiniPayDeposit } from "@/lib/minipay";
import { tokenDecimals, tokenAddresses, type SupportedPaymentToken } from "@/lib/tokens";
import { useQuery } from "@tanstack/react-query";
import { appConfig } from "@/lib/env";
import { linkPayerTokens } from "@/lib/payment-links";
import { withAttribution } from "@/lib/attribution";

function getPaymentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("returned no data") ||
    message.includes("address is not a contract") ||
    message.includes("does not have the function")
  ) {
    return "Payment token unavailable on this network. Please refresh and try again.";
  }
  if (message.toLowerCase().includes("user rejected")) {
    return "Payment cancelled.";
  }
  return message || "Payment failed";
}

export function CheckoutView({ id }: { id: string }) {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const [isPaying, setIsPaying] = useState(false);
  const [isStartingCard, setIsStartingCard] = useState(false);
  const [balances, setBalances] = useState<Partial<Record<SupportedPaymentToken, bigint>>>({});
  const [selectedToken, setSelectedToken] = useState<SupportedPaymentToken>("USDC");
  const [quote, setQuote] = useState<SwapQuote<SupportedPaymentToken> | null>(null);

  const query = useQuery({
    queryKey: ["payment-link", id],
    queryFn: () => getPaymentLink(id),
    refetchInterval: (queryState) =>
      queryState.state.data?.status === "active" ? 4000 : false,
  });

  const link = query.data;
  const expectedChainId = link?.chainId ?? appConfig.chainId;
  const correctNetwork = chainId === expectedChainId && publicClient?.chain.id === expectedChainId;
  const payable = link?.status === "active" && (!link.expiresAt || Date.parse(link.expiresAt) > Date.now());
  const payerKey = linkPayerTokens(link?.token ?? "USDC", link?.acceptedPayerAssets).join(",");
  const payerTokens = useMemo(() => payerKey.split(",").filter(Boolean) as SupportedPaymentToken[], [payerKey]);
  const amountWei = useMemo(() => {
    if (!link) return 0n;
    return link.amountAtomic ? BigInt(link.amountAtomic) : parseUnits(link.amount, tokenDecimals[link.token]);
  }, [link?.amount, link?.amountAtomic, link?.token]);
  const settlementToken = link?.token;
  const settlementAddress = link?.tokenAddress;

  useEffect(() => {
    if (settlementToken) setSelectedToken(settlementToken);
  }, [id, settlementToken]);

  useEffect(() => {
    let cancelled = false;
    setBalances({});
    async function loadBalances() {
      if (!address || !isConnected || !publicClient || !correctNetwork) return;
      const results = await Promise.allSettled(payerTokens.map(async (token) => {
        const balance = await publicClient.readContract({
          address: token === settlementToken && settlementAddress ? settlementAddress : tokenAddresses[token],
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        return [token, balance] as const;
      }));
      if (!cancelled) {
        setBalances(Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])));
      }
    }
    loadBalances().catch((error) => toast.error(getPaymentErrorMessage(error)));
    return () => { cancelled = true; };
  }, [address, correctNetwork, isConnected, payerTokens, publicClient, settlementToken, settlementAddress]);

  useEffect(() => {
    setQuote(null);
  }, [selectedToken, link?.id]);

  async function previewQuote(linkData: PaymentLink, payerToken: SupportedPaymentToken) {
    setSelectedToken(payerToken);
    if (payerToken === linkData.token) {
      setQuote(null);
      return;
    }
    const nextQuote = await quotePaymentLink(linkData.id, { payerToken, slippageBps: 100 });
    setQuote(nextQuote);
  }

  async function pay(linkData: PaymentLink) {
    if (!address || !isConnected || !publicClient || !correctNetwork) {
      toast.error("Connect an account on the payment network");
      return;
    }

    setIsPaying(true);
    try {
      const prepared = await buildPayTx(linkData.id, {
        payerToken: selectedToken,
        slippageBps: 100,
      });
      if (prepared.chainId !== expectedChainId || !payerTokens.includes(selectedToken))
        throw new Error("Payment network or token does not match this request");
      const payTx = prepared.payTx ?? prepared.tx;
      const amountToApprove = prepared.approveTx ? BigInt(prepared.approveTx.amount) : amountWei;
      const tokenAddress = prepared.approveTx?.to ?? (selectedToken === linkData.token && linkData.tokenAddress ? linkData.tokenAddress : tokenAddresses[selectedToken]);
      const balance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });

      if (!payTx) {
        throw new Error("Payment transaction unavailable");
      }
      if (balance < amountToApprove) {
        toast.error(`Insufficient ${selectedToken} balance. Add ${selectedToken} to your wallet and try again.`);
        return;
      }

      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, payTx.to],
      });

      if (allowance < amountToApprove) {
        toast.message("Approval requested");
        const approvalHash = prepared.approveTx
          ? await sendTransactionAsync({
              chainId: expectedChainId,
              to: prepared.approveTx.to,
              data: withAttribution(prepared.approveTx.data),
              value: BigInt(prepared.approveTx.value),
            })
          : await writeContractAsync({
              chainId: expectedChainId,
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "approve",
              args: [payTx.to, amountToApprove],
            });
        toast.message("Confirming approval");
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error("Token approval failed");
      }

      toast.message("Sending payment");
      const paymentHash = await sendTransactionAsync({
        chainId: expectedChainId,
        to: payTx.to,
        data: withAttribution(payTx.data),
        value: BigInt(payTx.value),
      });
      toast.message("Confirming payment");
      const paymentReceipt = await publicClient.waitForTransactionReceipt({ hash: paymentHash });
      if (paymentReceipt.status !== "success") throw new Error("Payment transaction failed");
      toast.success("Payment sent");
      await query.refetch();
    } catch (error) {
      toast.error(getPaymentErrorMessage(error));
    } finally {
      setIsPaying(false);
    }
  }

  async function payWithCard(linkData: PaymentLink) {
    setIsStartingCard(true);
    try {
      const session = await createRampSession(linkData.id, {
        finalUrl: window.location.href,
      });
      window.location.href = session.session.redirectUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Card payment unavailable");
    } finally {
      setIsStartingCard(false);
    }
  }

  if (query.isLoading) {
    return (
      <section className="panel empty-state">
        <Loader2 size={28} className="animate-spin" />
      </section>
    );
  }

  if (query.isError || !link) {
    return (
      <section className="panel empty-state">
        <div>
          <h1 className="top-title">Request unavailable</h1>
          <p className="fine muted">This payment request could not be loaded.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="hero-band">
        <div className="top-bar">
          <button className="icon-button" aria-label="Checkout">
            <ShieldCheck size={20} />
          </button>
          <h1 className="top-title">Checkout</h1>
          <StatusPill status={link.status} />
        </div>
        <p className="fine">Payment request</p>
        <h2 className={`checkout-amount${link.amount.length > 12 ? " precise-amount" : ""}`}>
          {link.amount} {link.token}
        </h2>
      </section>

      <div className="stack">
        <section className="panel panel-pad">
          <div className="split-row">
            <div>
              <p className="fine muted">Memo</p>
              <h2 className="top-title">{link.description || "Payment request"}</h2>
            </div>
            <span className="token-chip">
              <span className="token-mark">$</span>
              {link.token}
            </span>
          </div>
        </section>

        <section className="panel panel-pad">
          <div className="split-row">
            <span className="fine muted">Pay with</span>
            <strong>{selectedToken}</strong>
          </div>
          <div className="token-row" style={{ marginTop: 14 }}>
            {payerTokens.map((token) => (
              <button
                key={token}
                type="button"
                className={token === selectedToken ? "token-chip active" : "token-chip"}
                onClick={() => previewQuote(link, token).catch((error) => toast.error(getPaymentErrorMessage(error)))}
              >
                <span className="token-mark">$</span>
                {token}
              </button>
            ))}
          </div>
          <div className="split-row" style={{ marginTop: 14 }}>
            <span className="fine muted">Balance</span>
            <strong>
              {balances[selectedToken] === undefined ? "—" : formatUnits(balances[selectedToken], tokenDecimals[selectedToken])} {selectedToken}
            </strong>
          </div>
          <div className="split-row" style={{ marginTop: 14 }}>
            <span className="fine muted">Network fee</span>
            <strong>Shown in wallet</strong>
          </div>
          {selectedToken !== link.token && (
            <p className="fine muted" style={{ marginTop: 14 }}>
              Pay with {selectedToken}; recipient receives {link.token}
              {quote ? ` (${formatUnits(BigInt(quote.amountInMax), tokenDecimals[selectedToken])} ${selectedToken} max)` : ""}
            </p>
          )}
        </section>

        <WalletConnection chainId={expectedChainId} />
        {isConnected && !correctNetwork ? <p className="fine muted">Connect your account to the payment network to continue.</p> : null}
        {link.token === "wMXN" ? <p className="fine muted">Pay directly in wMXN from your wallet.</p> : null}

        {link.acceptedMethods.includes("crypto") ? <button
          className="primary-button"
          disabled={!payable || isPaying || !isConnected || !correctNetwork || !payerTokens.includes(selectedToken)}
          onClick={() => pay(link)}
          type="button"
        >
          {isPaying ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
          Pay with {selectedToken}
        </button> : null}

        {link.token !== "wMXN" && link.acceptedMethods.includes("card") ? <button
          className="secondary-button"
          disabled={!payable || isStartingCard}
          onClick={() => payWithCard(link)}
          type="button"
        >
          {isStartingCard ? <Loader2 size={20} className="animate-spin" /> : <CreditCard size={20} />}
          Pay with card
        </button> : null}

        {link.token !== "wMXN" && link.acceptedMethods.includes("crypto") ? <button className="secondary-button" type="button" onClick={redirectToMiniPayDeposit}>
          <ArrowDownToLine size={20} />
          Deposit
        </button> : null}
      </div>
    </>
  );
}
