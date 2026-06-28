"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { StatusPill } from "@/components/status-pill";
import { buildPayTx, createRampSession, getPaymentLink, quotePaymentLink, type PaymentLink, type SwapQuote } from "@/lib/api";
import { redirectToMiniPayDeposit } from "@/lib/minipay";
import { paymentTokens, tokenDecimals, tokenAddresses, type Stablecoin } from "@/lib/tokens";
import { useQuery } from "@tanstack/react-query";

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
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const [isPaying, setIsPaying] = useState(false);
  const [isStartingCard, setIsStartingCard] = useState(false);
  const [balances, setBalances] = useState<Partial<Record<Stablecoin, bigint>>>({});
  const [selectedToken, setSelectedToken] = useState<Stablecoin>("USDC");
  const [quote, setQuote] = useState<SwapQuote | null>(null);

  const query = useQuery({
    queryKey: ["payment-link", id],
    queryFn: () => getPaymentLink(id),
    refetchInterval: (queryState) =>
      queryState.state.data?.status === "active" ? 4000 : false,
  });

  const link = query.data;
  const payable = link?.status === "active";
  const amountWei = useMemo(() => {
    if (!link) return 0n;
    return parseUnits(link.amount, tokenDecimals[link.token]);
  }, [link]);

  useEffect(() => {
    if (!link) return;
    setSelectedToken(link.token);
  }, [link]);

  useEffect(() => {
    let cancelled = false;
    async function loadBalances() {
      if (!address || !isConnected || !publicClient) {
        setBalances({});
        return;
      }

      const entries = await Promise.all(
        paymentTokens.map(async (token) => {
          const balance = await publicClient.readContract({
            address: tokenAddresses[token],
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          });
          return [token, balance] as const;
        }),
      );

      if (!cancelled) {
        const nextBalances = Object.fromEntries(entries) as Partial<Record<Stablecoin, bigint>>;
        setBalances(nextBalances);
        if (link) {
          const exactBalance = nextBalances[link.token] ?? 0n;
          if (exactBalance >= amountWei) {
            setSelectedToken(link.token);
          } else {
            const funded = paymentTokens.find((token) => (nextBalances[token] ?? 0n) > 0n);
            if (funded) setSelectedToken(funded);
          }
        }
      }
    }
    loadBalances().catch((error) => toast.error(getPaymentErrorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [address, amountWei, isConnected, link, publicClient]);

  useEffect(() => {
    setQuote(null);
  }, [selectedToken, link?.id]);

  async function previewQuote(linkData: PaymentLink, payerToken: Stablecoin) {
    setSelectedToken(payerToken);
    if (payerToken === linkData.token) {
      setQuote(null);
      return;
    }
    const nextQuote = await quotePaymentLink(linkData.id, { payerToken, slippageBps: 100 });
    setQuote(nextQuote);
  }

  async function pay(linkData: PaymentLink) {
    if (!address || !isConnected || !publicClient) {
      toast.error("MiniPay account unavailable");
      return;
    }

    setIsPaying(true);
    try {
      const prepared = await buildPayTx(linkData.id, {
        payerToken: selectedToken,
        slippageBps: 100,
      });
      const payTx = prepared.payTx ?? prepared.tx;
      const amountToApprove = prepared.approveTx ? BigInt(prepared.approveTx.amount) : amountWei;
      const tokenAddress = tokenAddresses[selectedToken];
      const balance =
        balances[selectedToken] ??
        (await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }));

      if (!payTx) {
        throw new Error("Payment transaction unavailable");
      }
      if (balance < amountToApprove) {
        toast.error(`Insufficient ${selectedToken} balance. Deposit and try again.`);
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
              to: prepared.approveTx.to,
              data: prepared.approveTx.data,
              value: BigInt(prepared.approveTx.value),
            })
          : await writeContractAsync({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "approve",
              args: [payTx.to, amountToApprove],
            });
        toast.message("Confirming approval");
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }

      toast.message("Sending payment");
      const paymentHash = await sendTransactionAsync({
        to: payTx.to,
        data: payTx.data,
        value: BigInt(payTx.value),
      });
      toast.message("Confirming payment");
      await publicClient.waitForTransactionReceipt({ hash: paymentHash });
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
        <h2 className="checkout-amount">
          {link.amount} {link.token}
        </h2>
      </section>

      <div className="stack">
        <section className="panel panel-pad">
          <div className="split-row">
            <div>
              <p className="fine muted">Memo</p>
              <h2 className="top-title">{link.description || "Digital dollar payment"}</h2>
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
            {paymentTokens.map((token) => (
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
              {formatUnits(balances[selectedToken] ?? 0n, tokenDecimals[selectedToken])} {selectedToken}
            </strong>
          </div>
          <div className="split-row" style={{ marginTop: 14 }}>
            <span className="fine muted">Network fee</span>
            <strong>Stablecoin</strong>
          </div>
          {selectedToken !== link.token && (
            <p className="fine muted" style={{ marginTop: 14 }}>
              Pay with {selectedToken}; recipient receives {link.token}
              {quote ? ` (${formatUnits(BigInt(quote.amountInMax), tokenDecimals[selectedToken])} ${selectedToken} max)` : ""}
            </p>
          )}
        </section>

        <button
          className="primary-button"
          disabled={!payable || isPaying}
          onClick={() => pay(link)}
          type="button"
        >
          {isPaying ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
          Pay with stablecoin
        </button>

        <button
          className="secondary-button"
          disabled={!payable || isStartingCard}
          onClick={() => payWithCard(link)}
          type="button"
        >
          {isStartingCard ? <Loader2 size={20} className="animate-spin" /> : <CreditCard size={20} />}
          Pay with card
        </button>

        <button className="secondary-button" type="button" onClick={redirectToMiniPayDeposit}>
          <ArrowDownToLine size={20} />
          Deposit
        </button>
      </div>
    </>
  );
}
