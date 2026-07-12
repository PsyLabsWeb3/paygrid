"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, Gift, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConnect, usePublicClient, useSendTransaction } from "wagmi";
import { createGiftClaimSession, getGift, prepareGiftClaim } from "@/lib/api";
import { withAttribution } from "@/lib/attribution";
import { appConfig } from "@/lib/env";

const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.opera.minipay";
const APP_STORE_URL = "https://apps.apple.com/us/app/minipay-easy-global-wallet/id6504087257";

export function GiftClaimView({ id }: { id: string }) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, status: connectStatus } = useConnect();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const [secret, setSecret] = useState("");
  const [resumeToken, setResumeToken] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);
  const [isOpeningMiniPay, setIsOpeningMiniPay] = useState(false);

  const query = useQuery({
    queryKey: ["gift", id],
    queryFn: () => getGift(id),
    refetchInterval: (state) => state.state.data?.status === "active" ? 3500 : false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resumed = params.get("resume");
    if (resumed) setResumeToken(resumed);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get("k") ?? localStorage.getItem(`paygrid-gift-claim:${id}`) ?? "";
    if (value) {
      setSecret(value);
      localStorage.setItem(`paygrid-gift-claim:${id}`, value);
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [id]);

  const canClaim = useMemo(
    () => query.data?.status === "active" && isConnected && Boolean(address) && Boolean(secret || resumeToken),
    [address, isConnected, query.data?.status, resumeToken, secret],
  );

  async function claimGift() {
    if (!address || !publicClient || !canClaim) return;
    setIsClaiming(true);
    try {
      const sessionToken = resumeToken || (await createGiftClaimSession(id, secret)).token;
      const prepared = await prepareGiftClaim(id, sessionToken, address);
      const hash = await sendTransactionAsync({
        to: prepared.tx.to,
        data: withAttribution(prepared.tx.data),
        value: 0n,
      });
      toast.message("Confirming your gift");
      await publicClient.waitForTransactionReceipt({ hash });
      localStorage.removeItem(`paygrid-gift-claim:${id}`);
      toast.success("Gift claimed");
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gift claim failed");
    } finally {
      setIsClaiming(false);
    }
  }

  async function openInMiniPay() {
    if (!appConfig.miniPayDeepLinkEnabled) return;
    setIsOpeningMiniPay(true);
    try {
      const token = resumeToken || (secret ? (await createGiftClaimSession(id, secret)).token : "");
      if (!token) throw new Error("Gift claim code unavailable");
      const returnUrl = `${window.location.origin}/gift/${id}?resume=${encodeURIComponent(token)}`;
      window.location.href = `https://link.minipay.xyz/browse?url=${encodeURIComponent(returnUrl)}`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open MiniPay");
      setIsOpeningMiniPay(false);
    }
  }

  if (query.isLoading) return <section className="panel empty-state"><Loader2 size={28} className="animate-spin" /></section>;
  if (query.isError || !query.data) {
    return <section className="panel empty-state"><div><h1 className="top-title">Gift unavailable</h1><p className="fine muted">This gift could not be loaded.</p></div></section>;
  }

  const gift = query.data;
  return (
    <div className="stack">
      <section className="hero-band">
        <div className="top-bar">
          <span className="icon-button"><Gift size={20} /></span>
          <span className="fine">{gift.reference}</span>
          <span className="icon-button"><ShieldCheck size={20} /></span>
        </div>
        <p className="fine">A gift from {gift.senderAlias}</p>
        <h1 className="checkout-amount">${gift.amount} {gift.token}</h1>
      </section>

      <section className="panel panel-pad">
        <p className="fine muted">For {gift.recipientAlias}</p>
        <h2 className="top-title" style={{ marginTop: 8 }}>“{gift.message}”</h2>
        <p className="fine muted" style={{ marginTop: 14 }}>PayGrid will never ask for your recovery phrase, private key or verification code.</p>
      </section>

      {gift.status === "claimed" ? (
        <section className="panel panel-pad">
          <CheckCircle2 size={32} color="var(--lime)" />
          <h2 className="top-title" style={{ marginTop: 12 }}>Gift claimed</h2>
          {gift.claimTxHash ? (
            <a className="secondary-button" style={{ marginTop: 14 }} href={`https://celoscan.io/tx/${gift.claimTxHash}`} target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> View settlement
            </a>
          ) : null}
          <Link className="primary-button" style={{ marginTop: 10 }} href={`/gifts?ref=${gift.referralCode}`}>
            <Gift size={18} /> Send the next gift
          </Link>
        </section>
      ) : gift.status !== "active" ? (
        <section className="panel empty-state"><div><h2 className="top-title">Gift {gift.status}</h2><p className="fine muted">This gift can no longer be claimed.</p></div></section>
      ) : (
        <>
          {!isConnected ? (
            <section className="panel panel-pad">
              <p className="label">Choose a Celo account</p>
              <div className="stack" style={{ marginTop: 12 }}>
                {connectors.map((connector) => (
                  <button className="secondary-button" type="button" key={connector.uid} disabled={connectStatus === "pending"} onClick={() => connect({ connector })}>
                    <Wallet size={19} /> {connector.name}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <button className="primary-button" type="button" disabled={!canClaim || isClaiming} onClick={() => void claimGift()}>
              {isClaiming ? <Loader2 size={20} className="animate-spin" /> : <Gift size={20} />}
              Claim gift
            </button>
          )}

          {appConfig.miniPayDeepLinkEnabled ? (
            <button className="secondary-button" type="button" disabled={isOpeningMiniPay} onClick={() => void openInMiniPay()}>
              {isOpeningMiniPay ? <Loader2 size={19} className="animate-spin" /> : <ExternalLink size={19} />}
              Open in MiniPay
            </button>
          ) : null}

          <section className="panel panel-pad">
            <p className="label">New to MiniPay?</p>
            <p className="fine muted" style={{ marginTop: 8 }}>Install MiniPay, return to this message and claim with your new account.</p>
            <div className="field-grid" style={{ marginTop: 14 }}>
              <a className="secondary-button" href={GOOGLE_PLAY_URL} target="_blank" rel="noreferrer"><Download size={18} /> Google Play</a>
              <a className="secondary-button" href={APP_STORE_URL} target="_blank" rel="noreferrer"><Download size={18} /> App Store</a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
