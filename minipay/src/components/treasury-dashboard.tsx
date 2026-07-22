"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Pause, Play, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import {
  closeTreasuryPosition,
  closeAllTreasuryPositions,
  getTreasuryQuantStatus,
  pauseTreasuryQuantAgent,
  resumeTreasuryQuantAgent,
  type TreasuryPosition,
} from "@/lib/api";

function money(value: string | undefined, maximumFractionDigits = 4) {
  if (!value || value === "unavailable") return value ?? "0";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString(undefined, { maximumFractionDigits });
}

function approximateUsd(balance: string | undefined, price: string | undefined) {
  const parsedBalance = Number(balance);
  const parsedPrice = Number(price);
  if (!Number.isFinite(parsedBalance) || !Number.isFinite(parsedPrice)) return null;
  return parsedBalance * parsedPrice;
}

function assetLabel(asset: TreasuryPosition["asset"]) {
  if (asset === "XAUT0") return "XAUt0";
  if (asset === "WETH") return "ETH";
  if (asset === "WBTC") return "BTC";
  if (asset === "EURM") return "EURm";
  return asset;
}

function getSignalReason(reason: string) {
  const normalized = reason.toLowerCase();

  if (normalized.includes("execution reverted with reason: stf")) {
    return "Swap could not access the required token balance or allowance.";
  }
  if (normalized.includes("execution reverted")) {
    return "The swap was rejected onchain. No position was opened.";
  }
  if (normalized.includes("open position already exists")) {
    return "The maximum number of open positions for this asset was reached.";
  }
  if (normalized.includes("paused")) {
    return "New entries are currently paused.";
  }

  const firstLine = reason.split("\n", 1)[0]?.trim() ?? "Signal could not be processed.";
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
}

function PositionRow({
  position,
  operatorKey,
  onChanged,
}: {
  position: TreasuryPosition;
  operatorKey: string;
  onChanged: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [requestingClose, setRequestingClose] = useState(false);
  const pnl = Number(position.pnlQuote);
  const isOpen = position.status === "open" || position.status === "closing";
  const canClose = position.status === "open";

  async function requestClose() {
    setRequestingClose(true);
    try {
      await closeTreasuryPosition(position.id, operatorKey);
      toast.success("Position close requested");
      setConfirmClose(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to request close");
    } finally {
      setRequestingClose(false);
    }
  }

  return (
    <article className="treasury-row">
      <div className="split-row">
        <div>
          <p className="fine muted">{position.route} · {position.mode}</p>
          <h3 className="top-title">{assetLabel(position.asset)}/{position.quoteToken}</h3>
        </div>
        <span className={`status-pill ${isOpen ? "status-active" : ""}`}>{position.status}</span>
      </div>
      <div className="treasury-price-grid">
        <div><span className="fine muted">Entry</span><strong>{money(position.entryPrice)}</strong></div>
        <div><span className="fine muted">Oracle</span><strong>{money(position.oraclePrice ?? position.currentPrice)}</strong></div>
        <div>
          <span className="fine muted">PnL</span>
          <strong className={pnl >= 0 ? "positive" : "negative"}>{money(position.pnlQuote)} {position.quoteToken}</strong>
        </div>
      </div>
      <p className="fine muted" style={{ margin: "12px 0 0" }}>
        SL {money(position.slPrice)} · TP {money(position.tpPrice)}
      </p>
      {position.executablePrice ? (
        <p className="fine muted" style={{ margin: "6px 0 0" }}>
          Executable {money(position.executablePrice)}
          {position.priceDivergenceBps == null ? "" : ` · ${position.priceDivergenceBps} bps`}
          {position.priceRoute ? ` · ${position.priceRoute}` : ""}
        </p>
      ) : null}
      {position.entryTxHash ? (
        <a
          className="fine positive"
          href={`https://celoscan.io/tx/${position.exitTxHash ?? position.entryTxHash}`}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10 }}
        >
          Settlement evidence <ExternalLink size={14} />
        </a>
      ) : null}
      {canClose && operatorKey && !confirmClose ? (
        <button
          className="secondary-button"
          style={{ minHeight: 44, marginTop: 12 }}
          onClick={() => setConfirmClose(true)}
        >
          <X size={17} /> Close this position
        </button>
      ) : null}
      {canClose && operatorKey && confirmClose ? (
        <div className="treasury-close-confirmation">
          <p className="fine muted">Queue this position for a market-safe close?</p>
          <div className="split-row" style={{ marginTop: 10 }}>
            <button
              className="secondary-button"
              style={{ minHeight: 40 }}
              disabled={requestingClose}
              onClick={requestClose}
            >
              {requestingClose ? "Requesting" : "Confirm close"}
            </button>
            <button
              className="icon-button"
              title="Cancel close"
              disabled={requestingClose}
              onClick={() => setConfirmClose(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function TreasuryDashboard() {
  const [operatorKey, setOperatorKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const query = useQuery({
    queryKey: ["treasury-quant-status"],
    queryFn: getTreasuryQuantStatus,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    setOperatorKey(sessionStorage.getItem("paygrid-treasury-operator-key") ?? "");
  }, []);

  const status = query.data;

  function unlockControls() {
    const value = draftKey.trim();
    if (!value) return;
    sessionStorage.setItem("paygrid-treasury-operator-key", value);
    setOperatorKey(value);
    setDraftKey("");
  }

  async function togglePause() {
    if (!status || !operatorKey) return;
    try {
      if (status.paused) {
        await resumeTreasuryQuantAgent(operatorKey);
        toast.success("Treasury Quant Agent resumed");
      } else {
        await pauseTreasuryQuantAgent(operatorKey, "Paused from PayGrid operator console");
        toast.success("New entries paused");
      }
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Control request failed");
    }
  }

  async function requestCloseAll() {
    if (!operatorKey) return;
    try {
      const result = await closeAllTreasuryPositions(operatorKey);
      toast.success(`${result.requested} position${result.requested === 1 ? "" : "s"} queued for close`);
      setConfirmCloseAll(false);
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to close all positions");
    }
  }

  if (query.isLoading) {
    return <section className="panel panel-pad empty-state"><p className="muted">Loading Treasury Quant Agent</p></section>;
  }
  if (!status || query.isError) {
    return <section className="panel panel-pad empty-state"><p className="muted">Treasury status is unavailable.</p></section>;
  }

  const openPositions = status.positions.filter((position) => position.status === "open" || position.status === "closing");
  const displayedPositions = [...status.positions].sort(
    (left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt),
  );
  const balanceTokens = ["USDC", "USDT", "USDm", "CELO", "XAUT0", "WETH", "WBTC", "EURM"] as const;
  const balanceValuations = balanceTokens.map((token) => {
    const balance = status.balances[token];
    const price = token === "USDC" || token === "USDT" || token === "USDm"
      ? "1"
      : status.assetPrices?.[token];
    return { token, balance, valueUsd: approximateUsd(balance, price) };
  });
  const treasuryValueUsd = balanceValuations.reduce(
    (total, item) => total + (item.valueUsd ?? 0),
    0,
  );

  return (
    <div className="stack treasury-dashboard">
      <section className="metric-grid">
        <div className="metric"><span className="fine muted">Open positions</span><strong>{status.metrics.openPositions}</strong></div>
        <div className="metric"><span className="fine muted">Exposure</span><strong>${money(status.metrics.totalExposureUsd, 2)}</strong></div>
      </section>

      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">Execution state</p>
            <h2 className="top-title">{status.mode === "paper" ? "Paper mode" : "Live on Celo"}</h2>
          </div>
          <span className={`status-pill ${status.enabled && !status.paused ? "status-active" : ""}`}>
            {status.paused ? "paused" : status.enabled ? "monitoring" : "disabled"}
          </span>
        </div>
        <p className="fine muted" style={{ margin: "12px 0 0" }}>
          ${status.limits.defaultPositionUsd} per signal · ${status.limits.maxTotalExposureUsd} total exposure · {status.limits.maxSlippageBps / 100}% max slippage
        </p>
        <div className="treasury-list" style={{ marginTop: 14 }}>
          {Object.entries(status.limits.effectiveByAsset ?? {}).map(([asset, limits]) => (
            <div className="split-row treasury-limit-row" key={asset}>
              <span className="fine">
                <strong>{assetLabel(asset as TreasuryPosition["asset"])}</strong>
                {limits.operational ? "" : " · not active"}
              </span>
              <span className="fine muted">
                ${limits.maxPerTradeUsd}/trade · ${limits.maxTotalExposureUsd} exposure · {limits.maxOpenPositions} positions
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">Operational balances</p>
            <h2 className="top-title">Treasury account</h2>
          </div>
          <div className="treasury-total-value">
            <span className="fine muted">Approx. value</span>
            <strong>${money(String(treasuryValueUsd), 2)}</strong>
          </div>
        </div>
        <div className="token-row" style={{ marginTop: 14 }}>
          {balanceValuations.map(({ token, balance, valueUsd }) => {
            if (balance === undefined) return null;
            const label = token === "USDC" || token === "USDT" || token === "USDm"
              ? token
              : assetLabel(token);
            const precision = token === "WBTC" ? 8 : token === "XAUT0" || token === "WETH" ? 6 : 4;
            return (
              <div className="token-chip treasury-balance-chip" key={token}>
                <strong>{money(balance, precision)} {label}</strong>
                <span className="fine muted">
                  {valueUsd == null ? "Valuation unavailable" : `≈ $${money(String(valueUsd), 2)}`}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">TP / SL monitoring</p>
            <h2 className="top-title">Positions</h2>
          </div>
          <span className="status-pill">{openPositions.length} open</span>
        </div>
        <div className="treasury-list" style={{ marginTop: 14 }}>
          {displayedPositions.length ? displayedPositions.map((position) => (
            <PositionRow
              key={position.id}
              position={position}
              operatorKey={operatorKey}
              onChanged={() => void query.refetch()}
            />
          )) : <p className="fine muted">No positions yet.</p>}
        </div>
      </section>

      <section className="panel panel-pad">
        <p className="fine muted">TradingView queue</p>
        <h2 className="top-title">Recent signals</h2>
        <div className="treasury-list" style={{ marginTop: 14 }}>
          {status.recentSignals.slice(0, 6).map((signal) => (
            <article className="treasury-row" key={signal.id}>
              <div className="split-row">
                <div>
                  <strong>{signal.symbol.code}</strong>
                  <p className="fine muted" style={{ margin: "4px 0 0" }}>{signal.strategy.name} · {signal.timeframe}</p>
                </div>
                <span className={`status-pill ${signal.status === "executed" ? "status-active" : ""}`}>{signal.status}</span>
              </div>
              {signal.reason ? (
                <p className="fine negative treasury-error" style={{ margin: "10px 0 0" }}>
                  {getSignalReason(signal.reason)}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">Private operator session</p>
            <h2 className="top-title">Controls</h2>
          </div>
          <KeyRound size={22} color="var(--lime)" />
        </div>
        {operatorKey ? (
          <>
            <button className="secondary-button" style={{ marginTop: 14 }} onClick={togglePause}>
              {status.paused ? <Play size={18} /> : <Pause size={18} />}
              {status.paused ? "Resume entries" : "Pause new entries"}
            </button>
            {openPositions.length > 0 && !confirmCloseAll ? (
              <button
                className="secondary-button"
                style={{ minHeight: 44, marginTop: 10 }}
                onClick={() => setConfirmCloseAll(true)}
              >
                <ShieldAlert size={18} /> Close all positions
              </button>
            ) : null}
            {confirmCloseAll ? (
              <div className="treasury-row" style={{ marginTop: 10 }}>
                <p className="fine negative">This pauses new entries and queues every open position for a market-safe close.</p>
                <div className="split-row" style={{ marginTop: 10 }}>
                  <button className="secondary-button" style={{ minHeight: 40 }} onClick={requestCloseAll}>
                    Confirm close all
                  </button>
                  <button className="icon-button" title="Cancel" onClick={() => setConfirmCloseAll(false)}>
                    <X size={18} />
                  </button>
                </div>
              </div>
            ) : null}
            <button
              className="secondary-button"
              style={{ minHeight: 44, marginTop: 10 }}
              onClick={() => {
                sessionStorage.removeItem("paygrid-treasury-operator-key");
                setOperatorKey("");
              }}
            >
              Lock controls
            </button>
          </>
        ) : (
          <div style={{ marginTop: 14 }}>
            <label className="label" htmlFor="treasury-key">Operator key</label>
            <input
              id="treasury-key"
              className="input"
              type="password"
              autoComplete="off"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder="Stored for this browser session only"
            />
            <button className="secondary-button" style={{ marginTop: 10 }} onClick={unlockControls}>
              <KeyRound size={18} /> Unlock controls
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
