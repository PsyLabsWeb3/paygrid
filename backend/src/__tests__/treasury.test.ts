import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { Env } from "../config/env.js";
import {
  calculateEntryDeviationBps,
  calculatePaperAssetAmount,
  evaluateTreasuryRisk,
  getTreasuryCloseReason,
  getStaleSignalRecoveryAction,
  parseTradingViewSignal,
} from "../lib/treasury.js";

const signal = {
  externalSignalId: "manual-celo-test-52852",
  source: "tradingview",
  timeframe: "5m",
  side: "LONG",
  signalType: "ENTRY",
  entryPrice: "0.52852",
  slPrice: "0.51266",
  tpPrice: "0.54438",
  strategy: {
    code: "WT-ST",
    name: "WaveTrend-S",
    description: "Filtered Wave",
  },
  symbol: {
    code: "CELOUSDT",
    baseAsset: "CELO",
    quoteAsset: "USDT",
  },
  payload: {
    exchange: "hyperliquid",
    originalTicker: "CELOUSDT",
  },
} as const;

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  PUBLIC_APP_URL: "https://celopaygrid.xyz",
  CELO_RPC_URL: "https://example-rpc.invalid",
  CHAIN_ID: 42220,
  PAYGRID_LINK_ADDRESS: "0x0000000000000000000000000000000000000001",
  PAYGRID_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000002",
  BACKEND_WALLET_PRIVATE_KEY: ("0x" + "1".repeat(64)) as `0x${string}`,
  RAMP_ENV: "demo",
  TREASURY_QUANT_ENABLED: "true",
  TREASURY_QUANT_MODE: "paper",
  TREASURY_SIGNAL_SECRET: "tradingview-secret",
  TREASURY_ADMIN_API_KEY: "operator-secret",
  PORT: 3001,
} satisfies Env;

test("accepts the existing TradingView webhook payload unchanged", () => {
  const parsed = parseTradingViewSignal(signal);
  assert.equal(parsed.externalSignalId, signal.externalSignalId);
  assert.equal(parsed.symbol.baseAsset, "CELO");
  assert.equal(parsed.symbol.quoteAsset, "USDT");
});

test("rejects shorts, invalid symbols and inverted LONG risk levels", () => {
  assert.throws(() => parseTradingViewSignal({ ...signal, side: "SHORT" }));
  assert.throws(() => parseTradingViewSignal({
    ...signal,
    symbol: { ...signal.symbol, code: "CELOUSDC" },
  }));
  assert.throws(() => parseTradingViewSignal({
    ...signal,
    slPrice: "0.60",
  }));
});

test("risk engine enforces pause, one position per asset and exposure limits", () => {
  const base = {
    paused: false,
    assetConfigured: true,
    hasOpenPosition: false,
    tradeUsd: 1,
    maxPerTradeUsd: 5,
    totalExposureUsd: 0,
    maxTotalExposureUsd: 20,
    dailyLossUsd: 0,
    dailyLossLimitUsd: 5,
  };
  assert.equal(evaluateTreasuryRisk(base).ok, true);
  assert.equal(evaluateTreasuryRisk({ ...base, paused: true }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, hasOpenPosition: true }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, totalExposureUsd: 20 }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, dailyLossUsd: 5 }).ok, false);
});

test("TP, SL and manual close triggers are deterministic", () => {
  assert.equal(getTreasuryCloseReason({
    currentPrice: 0.51,
    slPrice: 0.51266,
    tpPrice: 0.54438,
    closeRequested: false,
  }), "stop_loss");
  assert.equal(getTreasuryCloseReason({
    currentPrice: 0.55,
    slPrice: 0.51266,
    tpPrice: 0.54438,
    closeRequested: false,
  }), "take_profit");
  assert.equal(getTreasuryCloseReason({
    currentPrice: 0.53,
    slPrice: 0.51266,
    tpPrice: 0.54438,
    closeRequested: true,
  }), "manual");
});

test("entry deviation and paper sizing remain bounded", () => {
  assert.equal(calculateEntryDeviationBps(100, 101), 100);
  assert.equal(calculatePaperAssetAmount(1, 0.5), "2");
});

test("TradingView and operator routes reject missing dedicated secrets", async () => {
  const app = createApp(env);
  const webhook = await app.request("http://localhost/api/treasury/signals/tradingview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signal),
  });
  assert.equal(webhook.status, 401);

  const pause = await app.request("http://localhost/api/treasury/control/pause", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "test" }),
  });
  assert.equal(pause.status, 401);
});

test("worker restart recovery never replays a signal with execution state", () => {
  assert.equal(getStaleSignalRecoveryAction({
    hasPosition: false,
    hasExecution: false,
  }), "requeue");
  assert.equal(getStaleSignalRecoveryAction({
    hasPosition: true,
    hasExecution: false,
  }), "manual_reconciliation");
  assert.equal(getStaleSignalRecoveryAction({
    hasPosition: false,
    hasExecution: true,
  }), "manual_reconciliation");
});
