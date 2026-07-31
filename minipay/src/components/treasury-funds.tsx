"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Plus, Send, Trash2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import type { Address } from "viem";
import {
  addTreasuryWithdrawalAddress,
  createTreasuryDepositLink,
  deactivateTreasuryWithdrawalAddress,
  executeTreasuryWithdrawal,
  getTreasuryFunds,
  previewTreasuryWithdrawal,
  type TreasuryDestinationType,
  type TreasuryFundAsset,
  type TreasuryWithdrawalPreview,
  type TreasuryWithdrawalRequest,
} from "@/lib/api";
import type { Stablecoin } from "@/lib/tokens";

const STABLECOINS: Stablecoin[] = ["USDT", "USDC", "USDm"];
const EXTERNAL_ASSETS: TreasuryFundAsset[] = ["USDT", "USDC", "USDm", "XAUT0", "WETH", "WBTC", "EURM"];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function displayDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function OperationStatus({ status }: { status: string }) {
  const active = status === "paid" || status === "confirmed";
  return <span className={`status-pill ${active ? "status-active" : ""}`}>{status}</span>;
}

function attributionLabel(value: boolean | null) {
  if (value === true) return "Attributed";
  if (value === false) return "Attribution missing";
  return "Pending verification";
}

export function TreasuryFunds({ operatorKey }: { operatorKey: string }) {
  const [section, setSection] = useState<"deposit" | "withdraw" | "addresses" | "history">("deposit");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositToken, setDepositToken] = useState<Stablecoin>("USDT");
  const [depositDescription, setDepositDescription] = useState("Treasury funding");
  const [createdLink, setCreatedLink] = useState<Awaited<ReturnType<typeof createTreasuryDepositLink>> | null>(null);
  const [addressLabel, setAddressLabel] = useState("");
  const [addressValue, setAddressValue] = useState("");
  const [destinationType, setDestinationType] = useState<TreasuryDestinationType>("minipay");
  const [addressAsset, setAddressAsset] = useState<TreasuryFundAsset>("USDT");
  const [withdrawAsset, setWithdrawAsset] = useState<TreasuryFundAsset>("USDT");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddressId, setWithdrawAddressId] = useState("");
  const [withdrawMode, setWithdrawMode] = useState<"free" | "evacuate">("free");
  const [withdrawRequestId, setWithdrawRequestId] = useState("");
  const [preview, setPreview] = useState<TreasuryWithdrawalPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["treasury-funds", operatorKey],
    queryFn: () => getTreasuryFunds(operatorKey),
    enabled: Boolean(operatorKey),
    refetchInterval: 10_000,
  });
  const funds = query.data;
  const activeAddresses = useMemo(
    () => funds?.addresses.filter((address) => address.active) ?? [],
    [funds?.addresses],
  );
  const matchingAddresses = activeAddresses.filter((address) => address.asset === withdrawAsset);
  const selectedBalance = funds?.balances.find((balance) => balance.asset === withdrawAsset);
  const selectedAddress = activeAddresses.find((address) => address.id === withdrawAddressId);
  const confirmationText = preview
    ? `${preview.asset} ${preview.amount} ${preview.destination.address.slice(-4)}`
    : "";

  function resetPreview() {
    setPreview(null);
    setConfirmation("");
    setWithdrawRequestId("");
  }

  async function createDeposit() {
    if (!depositAmount.trim()) return;
    setBusy(true);
    try {
      const result = await createTreasuryDepositLink(operatorKey, {
        requestId: `deposit:${crypto.randomUUID()}`,
        amount: depositAmount,
        token: depositToken,
        description: depositDescription,
      });
      setCreatedLink(result);
      toast.success("Treasury funding link created");
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create funding link");
    } finally {
      setBusy(false);
    }
  }

  async function addAddress() {
    if (!addressLabel.trim() || !addressValue.trim()) return;
    setBusy(true);
    try {
      await addTreasuryWithdrawalAddress(operatorKey, {
        label: addressLabel,
        address: addressValue as Address,
        destinationType,
        asset: addressAsset,
      });
      setAddressLabel("");
      setAddressValue("");
      toast.success("Destination approved");
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to approve destination");
    } finally {
      setBusy(false);
    }
  }

  async function requestPreview() {
    if (!withdrawAmount.trim() || !withdrawAddressId) return;
    const requestId = withdrawRequestId || `withdrawal:${crypto.randomUUID()}`;
    const request: TreasuryWithdrawalRequest = {
      requestId,
      asset: withdrawAsset,
      amount: withdrawAmount,
      withdrawalAddressId: withdrawAddressId,
      mode: withdrawMode,
    };
    setBusy(true);
    try {
      const result = await previewTreasuryWithdrawal(operatorKey, request);
      setWithdrawRequestId(requestId);
      setPreview(result);
      setConfirmation("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Withdrawal preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawal() {
    if (!preview || confirmation.trim() !== confirmationText) return;
    setBusy(true);
    try {
      const result = await executeTreasuryWithdrawal(operatorKey, {
        requestId: preview.requestId,
        asset: preview.asset,
        amount: preview.amount,
        withdrawalAddressId: preview.destination.id,
        mode: preview.mode,
      });
      toast.success(result.status === "confirmed" ? "Withdrawal confirmed" : "Withdrawal submitted");
      setWithdrawAmount("");
      resetPreview();
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Withdrawal failed");
    } finally {
      setBusy(false);
    }
  }

  if (!operatorKey) {
    return (
      <section className="panel panel-pad empty-state">
        <div>
          <WalletCards size={26} color="var(--lime)" />
          <p style={{ margin: "10px 0 0" }}>Unlock the private operator session to manage funds.</p>
        </div>
      </section>
    );
  }
  if (query.isLoading) return <section className="panel panel-pad empty-state"><p className="muted">Loading funds</p></section>;
  if (!funds || query.isError) return <section className="panel panel-pad empty-state"><p className="negative">Funds are unavailable.</p></section>;

  return (
    <div className="stack treasury-funds">
      {!funds.enabled ? (
        <section className="panel panel-pad"><p className="fine negative">Treasury funds are disabled on the backend.</p></section>
      ) : null}

      <div className="segmented treasury-funds-segments" aria-label="Funds section">
        {(["deposit", "withdraw", "addresses", "history"] as const).map((item) => (
          <button key={item} className={`segment ${section === item ? "segment-active" : ""}`} onClick={() => setSection(item)}>
            {item === "addresses" ? "Destinations" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {section === "deposit" ? (
        <>
          <section className="panel panel-pad">
            <p className="fine muted">Stablecoin payment link</p>
            <h2 className="top-title">Fund Treasury</h2>
            <div className="field-grid" style={{ marginTop: 16 }}>
              <input className="input" inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="90" />
              <select className="select" value={depositToken} onChange={(event) => setDepositToken(event.target.value as Stablecoin)}>
                {STABLECOINS.map((token) => <option key={token}>{token}</option>)}
              </select>
            </div>
            <label className="label" htmlFor="deposit-description" style={{ marginTop: 14 }}>Description</label>
            <input id="deposit-description" className="input" value={depositDescription} onChange={(event) => setDepositDescription(event.target.value)} />
            <p className="fine muted" style={{ margin: "12px 0 0" }}>
              The payment transaction includes Paygrid&apos;s Celo attribution tag.
            </p>
            <button className="primary-button" style={{ marginTop: 16 }} disabled={busy || !funds.enabled || !depositAmount.trim()} onClick={createDeposit}>
              <Link2 size={18} /> {busy ? "Creating" : "Create funding link"}
            </button>
          </section>
          {createdLink ? (
            <section className="panel panel-pad">
              <div className="split-row"><h2 className="top-title">Link ready</h2><OperationStatus status={createdLink.status} /></div>
              <p className="fine muted" style={{ margin: "10px 0" }}>
                Estimated net: {createdLink.estimatedNet} {createdLink.asset} · Fee: {createdLink.fee} {createdLink.asset}
              </p>
              <span className="inline-code">{createdLink.paymentUrl}</span>
              <div className="funds-actions">
                <button className="secondary-button" onClick={() => void navigator.clipboard.writeText(createdLink.paymentUrl)}><Copy size={17} /> Copy</button>
                <a className="secondary-button" href={createdLink.paymentUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Open</a>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {section === "withdraw" ? (
        <section className="panel panel-pad">
          <p className="fine muted">Approved Celo destination</p>
          <h2 className="top-title">Withdraw assets</h2>
          <label className="label" htmlFor="withdraw-asset" style={{ marginTop: 16 }}>Asset</label>
          <select id="withdraw-asset" className="select" value={withdrawAsset} onChange={(event) => {
            setWithdrawAsset(event.target.value as TreasuryFundAsset);
            setWithdrawAddressId("");
            resetPreview();
          }}>
            {EXTERNAL_ASSETS.map((asset) => <option key={asset}>{asset}</option>)}
          </select>
          <div className="split-row" style={{ marginTop: 12 }}>
            <span className="fine muted">Available {selectedBalance?.available ?? "0"}</span>
            <span className="fine muted">Reserved {selectedBalance?.reserved ?? "0"}</span>
          </div>
          <label className="label" htmlFor="withdraw-amount" style={{ marginTop: 14 }}>Amount</label>
          <div className="field-grid">
            <input id="withdraw-amount" className="input" inputMode="decimal" value={withdrawAmount} onChange={(event) => { setWithdrawAmount(event.target.value); resetPreview(); }} />
            <button className="secondary-button" type="button" onClick={() => { setWithdrawAmount(selectedBalance?.available ?? "0"); resetPreview(); }}>Max</button>
          </div>
          <label className="label" htmlFor="withdraw-destination" style={{ marginTop: 14 }}>Destination</label>
          <select id="withdraw-destination" className="select" value={withdrawAddressId} onChange={(event) => { setWithdrawAddressId(event.target.value); resetPreview(); }}>
            <option value="">Select approved destination</option>
            {matchingAddresses.map((address) => (
              <option key={address.id} value={address.id}>{address.label} · {address.destinationType === "minipay" ? "MiniPay" : shortAddress(address.address)}</option>
            ))}
          </select>
          <label className="label" htmlFor="withdraw-mode" style={{ marginTop: 14 }}>Mode</label>
          <select id="withdraw-mode" className="select" value={withdrawMode} onChange={(event) => { setWithdrawMode(event.target.value as "free" | "evacuate"); resetPreview(); }}>
            <option value="free">Available balance only</option>
            <option value="evacuate">Evacuate reserved positions</option>
          </select>
          {!preview ? (
            <button className="primary-button" style={{ marginTop: 16 }} disabled={busy || !funds.enabled || !withdrawAmount || !withdrawAddressId} onClick={requestPreview}>
              Preview withdrawal
            </button>
          ) : (
            <div className="treasury-close-confirmation">
              <p className="fine"><strong>{preview.amount} {preview.asset}</strong> to {preview.destination.label}</p>
              <p className="fine muted" style={{ margin: "6px 0 0" }}>{shortAddress(preview.destination.address)} · {funds.chainId === 42220 ? "Celo Mainnet" : "Celo Sepolia"}</p>
              <p className="fine muted" style={{ margin: "6px 0 0" }}>Positions reconciled: {preview.positionIds.length} · Attribution: {preview.attributionCode ?? "not configured"}</p>
              <label className="label" htmlFor="withdraw-confirm" style={{ marginTop: 14 }}>Type “{confirmationText}” to confirm</label>
              <input id="withdraw-confirm" className="input" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              <div className="funds-actions">
                <button className="primary-button" disabled={busy || confirmation.trim() !== confirmationText} onClick={submitWithdrawal}><Send size={17} /> Send</button>
                <button className="secondary-button" disabled={busy} onClick={resetPreview}>Cancel</button>
              </div>
            </div>
          )}
          {!matchingAddresses.length ? <p className="fine muted" style={{ margin: "12px 0 0" }}>Approve a destination for {withdrawAsset} first.</p> : null}
          {selectedAddress?.destinationType === "minipay" ? <p className="fine muted" style={{ margin: "12px 0 0" }}>MiniPay destination on Celo. No destination memo is required.</p> : null}
        </section>
      ) : null}

      {section === "addresses" ? (
        <>
          <section className="panel panel-pad">
            <p className="fine muted">Allowlist by asset and network</p>
            <h2 className="top-title">Approve destination</h2>
            <label className="label" htmlFor="address-label" style={{ marginTop: 16 }}>Label</label>
            <input id="address-label" className="input" value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} placeholder="Operations MiniPay" />
            <label className="label" htmlFor="address-value" style={{ marginTop: 14 }}>Celo address</label>
            <input id="address-value" className="input" value={addressValue} onChange={(event) => setAddressValue(event.target.value)} placeholder="0x…" />
            <div className="field-grid" style={{ marginTop: 14 }}>
              <select className="select" value={destinationType} onChange={(event) => {
                const nextType = event.target.value as TreasuryDestinationType;
                setDestinationType(nextType);
                if (nextType === "minipay" && !STABLECOINS.includes(addressAsset as Stablecoin)) setAddressAsset("USDT");
              }}>
                <option value="minipay">MiniPay wallet</option>
                <option value="exchange">Exchange</option>
                <option value="external_wallet">External wallet</option>
              </select>
              <select className="select" value={addressAsset} onChange={(event) => setAddressAsset(event.target.value as TreasuryFundAsset)}>
                {(destinationType === "minipay" ? STABLECOINS : EXTERNAL_ASSETS).map((asset) => <option key={asset}>{asset}</option>)}
              </select>
            </div>
            <p className="fine muted" style={{ margin: "12px 0 0" }}>Confirm that this destination accepts {addressAsset} on Celo Mainnet.</p>
            <button className="primary-button" style={{ marginTop: 16 }} disabled={busy || !funds.enabled || !addressLabel || !addressValue} onClick={addAddress}><Plus size={18} /> Approve destination</button>
          </section>
          <section className="panel panel-pad">
            <h2 className="top-title">Approved destinations</h2>
            <div className="treasury-list" style={{ marginTop: 14 }}>
              {activeAddresses.length ? activeAddresses.map((address) => (
                <article className="treasury-row" key={address.id}>
                  <div className="split-row">
                    <div><strong>{address.label}</strong><p className="fine muted" style={{ margin: "4px 0 0" }}>{address.asset} · {address.destinationType === "minipay" ? "MiniPay" : address.destinationType}</p></div>
                    <button className="icon-button" title="Deactivate" disabled={busy} onClick={async () => {
                      setBusy(true);
                      try { await deactivateTreasuryWithdrawalAddress(operatorKey, address.id); await query.refetch(); toast.success("Destination deactivated"); }
                      catch (error) { toast.error(error instanceof Error ? error.message : "Unable to deactivate destination"); }
                      finally { setBusy(false); }
                    }}><Trash2 size={16} /></button>
                  </div>
                  <span className="inline-code" style={{ marginTop: 8 }}>{address.address}</span>
                </article>
              )) : <p className="fine muted">No approved destinations.</p>}
            </div>
          </section>
        </>
      ) : null}

      {section === "history" ? (
        <section className="panel panel-pad">
          <div className="split-row"><h2 className="top-title">Funds history</h2><button className="icon-button" title="Refresh" onClick={() => void query.refetch()}>↻</button></div>
          <div className="treasury-list" style={{ marginTop: 14 }}>
            {funds.operations.length ? funds.operations.map((operation) => (
              <article className="treasury-row" key={operation.id}>
                <div className="split-row">
                  <div><strong>{operation.type === "deposit" ? "Deposit link" : "Withdrawal"} · {operation.amount} {operation.asset}</strong><p className="fine muted" style={{ margin: "4px 0 0" }}>{displayDate(operation.createdAt)}</p></div>
                  <OperationStatus status={operation.status} />
                </div>
                <p className={`fine ${operation.attributionVerified === false ? "negative" : "muted"}`} style={{ margin: "8px 0 0" }}>
                  {attributionLabel(operation.attributionVerified)}{operation.attributionCode ? ` · ${operation.attributionCode}` : ""}
                </p>
                {operation.txHash ? <a className="fine positive" href={`https://celoscan.io/tx/${operation.txHash}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 5, marginTop: 8 }}>CeloScan <ExternalLink size={13} /></a> : null}
                {!operation.txHash && operation.creationTxHash ? <a className="fine positive" href={`https://celoscan.io/tx/${operation.creationTxHash}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 5, marginTop: 8 }}>Link transaction <ExternalLink size={13} /></a> : null}
                {operation.paymentLinkId ? <a className="fine positive" href={`/pay/${operation.paymentLinkId}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 5, margin: "8px 0 0 12px" }}>Checkout <ExternalLink size={13} /></a> : null}
                {operation.error ? <p className="fine negative treasury-error" style={{ margin: "8px 0 0" }}>{operation.error}</p> : null}
              </article>
            )) : <p className="fine muted">No fund operations yet.</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
