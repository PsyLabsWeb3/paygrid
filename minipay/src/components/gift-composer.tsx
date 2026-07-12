"use client";

import { FormEvent, useState } from "react";
import { Gift, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { keccak256, toBytes } from "viem";
import { useAccount, usePublicClient, useSendTransaction } from "wagmi";
import { createGift, getGift, prepareGiftFunding, type Gift as GiftRecord } from "@/lib/api";
import { withAttribution } from "@/lib/attribution";
import { parseGiftIntent } from "@/lib/gift-intent";
import { paymentTokens, type Stablecoin } from "@/lib/tokens";

function createSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function waitForActiveGift(id: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const gift = await getGift(id);
    if (gift.status === "active") return gift;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return getGift(id);
}

export function GiftComposer() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const [prompt, setPrompt] = useState("Send Ana $2 for coffee");
  const [senderAlias, setSenderAlias] = useState("");
  const [recipientAlias, setRecipientAlias] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("2.00");
  const [token, setToken] = useState<Stablecoin>("USDC");
  const [payerToken, setPayerToken] = useState<Stablecoin>("USDC");
  const [planned, setPlanned] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparedFunding, setPreparedFunding] = useState<Awaited<ReturnType<typeof prepareGiftFunding>> | null>(null);
  const [pendingSecret, setPendingSecret] = useState("");
  const [pendingGiftId, setPendingGiftId] = useState("");
  const [fundedGift, setFundedGift] = useState<GiftRecord | null>(null);
  const [claimUrl, setClaimUrl] = useState("");

  function planGift() {
    const intent = parseGiftIntent(prompt);
    if (!intent) {
      toast.error("Include a recipient and dollar amount, for example: Send Ana $2 for coffee");
      return;
    }
    setRecipientAlias(intent.recipientAlias);
    setAmount(intent.amount);
    setMessage(intent.message);
    setPlanned(true);
  }

  async function prepareFunding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || !isConnected || !publicClient) {
      toast.error("Connect a Celo account to fund this gift");
      return;
    }
    if (!senderAlias.trim()) {
      toast.error("Add the name your recipient will recognize");
      return;
    }

    setIsPreparing(true);
    try {
      const secret = createSecret();
      const claimHash = keccak256(toBytes(secret));
      const referral = new URLSearchParams(window.location.search).get("ref") ?? undefined;
      const draft = await createGift({
        senderAddress: address,
        senderAlias,
        recipientAlias,
        message,
        amount,
        token,
        claimHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        sourceReferralCode: referral,
      });
      const prepared = await prepareGiftFunding(draft.id, { payerToken, slippageBps: 100 });
      setPreparedFunding(prepared);
      setPendingSecret(secret);
      setPendingGiftId(draft.id);
      toast.success("Funding plan ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gift preparation failed");
    } finally {
      setIsPreparing(false);
    }
  }

  async function executeFunding() {
    if (!preparedFunding || !pendingGiftId || !pendingSecret || !publicClient) return;
    setIsFunding(true);
    try {
      toast.message("Confirm token approval");
      const approvalHash = await sendTransactionAsync({
        to: preparedFunding.approveTx.to,
        data: withAttribution(preparedFunding.approveTx.data),
        value: 0n,
      });
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });

      toast.message(preparedFunding.quote.paymentMode === "swap" ? "Routing and funding gift" : "Funding gift");
      const fundingHash = await sendTransactionAsync({
        to: preparedFunding.fundTx.to,
        data: withAttribution(preparedFunding.fundTx.data),
        value: 0n,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundingHash });

      const nextGift = await waitForActiveGift(pendingGiftId);
      const url = `${window.location.origin}/gift/${pendingGiftId}#k=${encodeURIComponent(pendingSecret)}`;
      localStorage.setItem(`paygrid-gift-secret:${pendingGiftId}`, pendingSecret);
      setFundedGift(nextGift);
      setClaimUrl(url);
      setPreparedFunding(null);
      toast.success("Gift ready to share");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gift funding failed");
    } finally {
      setIsFunding(false);
    }
  }

  async function shareGift() {
    if (!fundedGift || !claimUrl) return;
    const text = `${senderAlias} sent you a gift\n\n“${fundedGift.message}”\n\nYou received $${fundedGift.amount} ${fundedGift.token} through Celo PayGrid.\n\nReference: ${fundedGift.reference}\nClaim: ${claimUrl}`;
    if (navigator.share) {
      await navigator.share({ title: "A gift from Celo PayGrid", text });
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="stack">
      <section className="panel panel-pad">
        <label>
          <span className="label">Tell the Gift Agent</span>
          <textarea
            className="textarea"
            value={prompt}
            maxLength={180}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <button className="secondary-button" type="button" onClick={planGift} style={{ marginTop: 14 }}>
          <Sparkles size={19} />
          Plan gift
        </button>
      </section>

      {planned ? (
        <section className="panel panel-pad">
          <form className="stack" onSubmit={prepareFunding}>
            <div className="field-grid">
              <label>
                <span className="label">From</span>
                <input className="input" value={senderAlias} maxLength={40} onChange={(event) => setSenderAlias(event.target.value)} placeholder="Your name" />
              </label>
              <label>
                <span className="label">To</span>
                <input className="input" value={recipientAlias} maxLength={40} onChange={(event) => setRecipientAlias(event.target.value)} />
              </label>
            </div>
            <label>
              <span className="label">Personal message</span>
              <textarea className="textarea" value={message} maxLength={240} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <div className="field-grid">
              <label>
                <span className="label">Gift amount</span>
                <input className="input amount-input" inputMode="decimal" min="0.5" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label>
                <span className="label">They receive</span>
                <select className="select" value={token} onChange={(event) => setToken(event.target.value as Stablecoin)}>
                  {paymentTokens.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span className="label">Fund with</span>
              <select className="select" value={payerToken} onChange={(event) => setPayerToken(event.target.value as Stablecoin)}>
                {paymentTokens.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={isPreparing || Boolean(preparedFunding)}>
              {isPreparing ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
              Review funding
            </button>
          </form>
        </section>
      ) : null}

      {preparedFunding ? (
        <section className="panel panel-pad">
          <p className="fine muted">Agent funding plan</p>
          <div className="split-row" style={{ marginTop: 12 }}><span>Recipient receives</span><strong>{amount} {token}</strong></div>
          <div className="split-row" style={{ marginTop: 10 }}><span className="muted">PayGrid fee</span><strong>{preparedFunding.quote.displayFee} {token}</strong></div>
          <div className="split-row" style={{ marginTop: 10 }}><span className="muted">Settlement total</span><strong>{preparedFunding.quote.displayTotal} {token}</strong></div>
          <div className="split-row" style={{ marginTop: 10 }}><span className="muted">Approve up to</span><strong>{preparedFunding.quote.displayAmountInMax} {payerToken}</strong></div>
          <div className="split-row" style={{ marginTop: 10 }}><span className="muted">Route</span><strong>{preparedFunding.quote.protocol === "none" ? "Direct" : preparedFunding.quote.protocol}</strong></div>
          <button className="primary-button" type="button" disabled={isFunding} onClick={() => void executeFunding()} style={{ marginTop: 16 }}>
            {isFunding ? <Loader2 size={20} className="animate-spin" /> : <Gift size={20} />}
            Confirm and fund
          </button>
        </section>
      ) : null}

      {fundedGift ? (
        <section className="panel panel-pad">
          <p className="fine muted">{fundedGift.reference}</p>
          <h2 className="top-title">{fundedGift.amount} {fundedGift.token} for {fundedGift.recipientAlias}</h2>
          <p className="fine muted" style={{ marginTop: 10 }}>“{fundedGift.message}”</p>
          <button className="primary-button" type="button" onClick={() => void shareGift()} style={{ marginTop: 16 }}>
            <MessageCircle size={20} />
            Share gift
          </button>
        </section>
      ) : null}
    </div>
  );
}
