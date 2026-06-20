"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { StatusPill } from "@/components/status-pill";
import { buildPayTx, createRampSession, getPaymentLink, type PaymentLink } from "@/lib/api";
import { appConfig } from "@/lib/env";
import { redirectToMiniPayDeposit } from "@/lib/minipay";
import { tokenDecimals, tokenAddresses } from "@/lib/tokens";
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
  const [balanceLabel, setBalanceLabel] = useState<string | null>(null);

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

  async function pay(linkData: PaymentLink) {
    if (linkData.token !== "USDC") {
      toast.error("This stablecoin is not available in the MiniPay checkout yet");
      return;
    }
    if (!address || !isConnected || !publicClient) {
      toast.error("MiniPay account unavailable");
      return;
    }

    setIsPaying(true);
    try {
      const tokenAddress = tokenAddresses[linkData.token];
      const balance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });

      setBalanceLabel(`${formatUnits(balance, tokenDecimals[linkData.token])} ${linkData.token}`);
      if (balance < amountWei) {
        toast.error(`Insufficient ${linkData.token} balance. Deposit and try again.`);
        return;
      }

      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, appConfig.paygridRouterAddress],
      });

      if (allowance < amountWei) {
        toast.message("Approval requested");
        await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [appConfig.paygridRouterAddress, amountWei],
        });
      }

      const payTx = await buildPayTx(linkData.id);
      toast.message("Payment requested");
      await sendTransactionAsync({
        to: payTx.tx.to,
        data: payTx.tx.data,
        value: BigInt(payTx.tx.value),
      });
      toast.success("Payment submitted");
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
            <span className="fine muted">Balance</span>
            <strong>{balanceLabel ?? "Check on pay"}</strong>
          </div>
          <div className="split-row" style={{ marginTop: 14 }}>
            <span className="fine muted">Network fee</span>
            <strong>Celo</strong>
          </div>
        </section>

        <button
          className="primary-button"
          disabled={!payable || isPaying || link.token !== "USDC"}
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
