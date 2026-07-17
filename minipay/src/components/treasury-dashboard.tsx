"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Pause, Play, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import {
  closeTreasuryPosition,
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

function PositionRow({
  position,
  operatorKey,
  onChanged,
}: {
  position: TreasuryPosition;
  operatorKey: string;
  onChanged: () => void;
}) {
  const pnl = Number(position.pnlQuote);
  const isOpen = position.status === "open" || position.status === "closing";

  async function requestClose() {
    try {
      await closeTreasuryPosition(position.id, operatorKey);
      toast.success("Position close requested");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to request close");
    }
  }

  return (
    <article className="treasury-row">
      <div className="split-row">
        <div>
          <p className="fine muted">{position.route} · {position.mode}</p>
          <h3 className="top-title">{position.asset}/{position.quoteToken}</h3>
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
      {isOpen && operatorKey ? (
        <button className="secondary-button" style={{ minHeight: 44, marginTop: 12 }} onClick={requestClose}>
          <X size={17} /> Close position
        </button>
      ) : null}
    </article>
  );
}

export function TreasuryDashboard() {
  const [operatorKey, setOperatorKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
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

  if (query.isLoading) {
    return <section className="panel panel-pad empty-state"><p className="muted">Loading Treasury Quant Agent</p></section>;
  }
  if (!status || query.isError) {
    return <section className="panel panel-pad empty-state"><p className="muted">Treasury status is unavailable.</p></section>;
  }

  const openPositions = status.positions.filter((position) => position.status === "open" || position.status === "closing");

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
          ${status.limits.defaultPositionUsd} per signal · {status.limits.maxOpenPositionsPerAsset} positions per asset · {status.limits.maxSlippageBps / 100}% max slippage
        </p>
      </section>

      <section className="panel panel-pad">
        <div className="split-row">
          <div>
            <p className="fine muted">Operational balances</p>
            <h2 className="top-title">Treasury account</h2>
          </div>
          <ShieldCheck size={22} color="var(--lime)" />
        </div>
        <div className="token-row" style={{ marginTop: 14 }}>
          {(["USDC", "USDT", "USDm", "CELO", "ORO"] as const).map((token) => {
            const balance = status.balances[token];
            if (balance === undefined) return null;
            return <span className="token-chip" key={token}>{money(balance)} {token}</span>;
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
          {status.positions.length ? status.positions.map((position) => (
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
              {signal.reason ? <p className="fine negative" style={{ margin: "10px 0 0" }}>{signal.reason}</p> : null}
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
