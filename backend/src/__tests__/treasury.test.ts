import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { Env } from "../config/env.js";
import {
  calculateEntryDeviationBps,
  calculatePaperAssetAmount,
  calculatePriceDivergenceBps,
  evaluateTreasuryRisk,
  getTreasuryCloseReason,
  getTreasuryPriceSafetyTransition,
  getStaleSignalRecoveryAction,
  isLegacyTreasuryDivergencePause,
  isOraclePriceFresh,
  parseTradingViewSignal,
  resolveTreasuryAssetLimits,
  retryTreasuryOracleRead,
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

test("normalizes numeric TradingView prices to decimal strings", () => {
  const parsed = parseTradingViewSignal({
    ...signal,
    entryPrice: 0.07018,
    slPrice: 0.06948,
    tpPrice: 0.07229,
  });
  assert.equal(parsed.entryPrice, "0.07018");
  assert.equal(parsed.slPrice, "0.06948");
  assert.equal(parsed.tpPrice, "0.07229");
});

test("accepts XAUt TradingView aliases and normalizes the asset to XAUT0", () => {
  const parsed = parseTradingViewSignal({
    ...signal,
    entryPrice: "3350",
    slPrice: "3300",
    tpPrice: "3450",
    symbol: {
      code: "XAUTUSDT",
      baseAsset: "XAUt",
      quoteAsset: "USDT",
    },
  });
  assert.equal(parsed.symbol.baseAsset, "XAUT0");
  assert.equal(parsed.symbol.code, "XAUTUSDT");

  assert.equal(parseTradingViewSignal({
    ...signal,
    entryPrice: "3350",
    slPrice: "3300",
    tpPrice: "3450",
    symbol: {
      code: "XAUT0USDT",
      baseAsset: "XAUT0",
      quoteAsset: "USDT",
    },
  }).symbol.baseAsset, "XAUT0");

  assert.throws(() => parseTradingViewSignal({
    ...signal,
    entryPrice: "3350",
    slPrice: "3300",
    tpPrice: "3450",
    symbol: {
      code: "XAUTUSDC",
      baseAsset: "XAUT0",
      quoteAsset: "USDC",
    },
  }));
});

test("accepts ETH, BTC and EUR TradingView aliases and normalizes treasury assets", () => {
  const cases = [
    { code: "ETHUSDT", baseAsset: "ETH", normalized: "WETH", entry: 3500 },
    { code: "WETHUSDT", baseAsset: "WETH", normalized: "WETH", entry: 3500 },
    { code: "BTCUSDT", baseAsset: "BTC", normalized: "WBTC", entry: 100000 },
    { code: "WBTCUSDT", baseAsset: "WBTC", normalized: "WBTC", entry: 100000 },
    { code: "EURUSDT", baseAsset: "EUR", normalized: "EURM", entry: 1.15 },
    { code: "CEURUSDT", baseAsset: "cEUR", normalized: "EURM", entry: 1.15 },
    { code: "EURMUSDT", baseAsset: "EURm", normalized: "EURM", entry: 1.15 },
  ] as const;
  for (const item of cases) {
    const parsed = parseTradingViewSignal({
      ...signal,
      entryPrice: item.entry,
      slPrice: item.entry * 0.98,
      tpPrice: item.entry * 1.02,
      symbol: {
        code: item.code,
        baseAsset: item.baseAsset,
        quoteAsset: "USDT",
      },
    });
    assert.equal(parsed.symbol.baseAsset, item.normalized);
  }
});

test("new treasury markets reject inverted or non-USDT pairs", () => {
  assert.throws(() => parseTradingViewSignal({
    ...signal,
    entryPrice: 3500,
    slPrice: 3400,
    tpPrice: 3600,
    symbol: { code: "ETHUSDC", baseAsset: "ETH", quoteAsset: "USDC" },
  }));
  assert.throws(() => parseTradingViewSignal({
    ...signal,
    entryPrice: 1.15,
    slPrice: 1.1,
    tpPrice: 1.2,
    symbol: { code: "USDTEUR", baseAsset: "EUR", quoteAsset: "USDT" },
  }));
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

test("risk engine enforces pause, round-robin position count and exposure limits", () => {
  const base = {
    paused: false,
    assetConfigured: true,
    openPositionsForAsset: 0,
    maxOpenPositionsPerAsset: 3,
    tradeUsd: 1,
    maxPerTradeUsd: 5,
    totalExposureUsd: 0,
    maxTotalExposureUsd: 20,
    assetExposureUsd: 0,
    maxAssetExposureUsd: 20,
    dailyLossUsd: 0,
    dailyLossLimitUsd: 5,
  };
  assert.equal(evaluateTreasuryRisk(base).ok, true);
  assert.equal(evaluateTreasuryRisk({ ...base, paused: true }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, openPositionsForAsset: 2 }).ok, true);
  assert.equal(evaluateTreasuryRisk({ ...base, openPositionsForAsset: 3 }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, totalExposureUsd: 20 }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, assetExposureUsd: 20 }).ok, false);
  assert.equal(evaluateTreasuryRisk({ ...base, dailyLossUsd: 5 }).ok, false);
});

test("asset limits inherit globals and apply only configured overrides", () => {
  const globalLimits = {
    maxPerTradeUsd: "12",
    maxTotalExposureUsd: "300",
    maxOpenPositions: 15,
  };
  assert.deepEqual(resolveTreasuryAssetLimits(globalLimits, {}), globalLimits);
  assert.deepEqual(resolveTreasuryAssetLimits(globalLimits, {
    maxPerTradeUsd: "5",
    maxOpenPositions: 4,
  }), {
    maxPerTradeUsd: "5",
    maxTotalExposureUsd: "300",
    maxOpenPositions: 4,
  });
  assert.deepEqual(resolveTreasuryAssetLimits(globalLimits, {
    maxPerTradeUsd: "20",
    maxTotalExposureUsd: "500",
    maxOpenPositions: 30,
  }), globalLimits);
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
  assert.equal(getTreasuryCloseReason({
    currentPrice: 0.53,
    slPrice: 0.51266,
    tpPrice: 0.54438,
    closeRequested: true,
    closeRequestedReason: "manual_close_all",
  }), "manual_close_all");
});

test("entry deviation and paper sizing remain bounded", () => {
  assert.equal(calculateEntryDeviationBps(100, 101), 100);
  assert.equal(calculatePriceDivergenceBps(100, 99), 100);
  assert.equal(calculatePriceDivergenceBps(0, 99), Number.POSITIVE_INFINITY);
  assert.equal(calculatePaperAssetAmount(1, 0.5), "2");
});

test("price divergence transitions are isolated and recover exactly once", () => {
  assert.deepEqual(getTreasuryPriceSafetyTransition({
    previousDivergenceBps: 100,
    currentDivergenceBps: 250,
    maxDivergenceBps: 200,
  }), { unsafe: true, transition: "unsafe" });
  assert.deepEqual(getTreasuryPriceSafetyTransition({
    previousDivergenceBps: 250,
    currentDivergenceBps: 240,
    maxDivergenceBps: 200,
  }), { unsafe: true, transition: null });
  assert.deepEqual(getTreasuryPriceSafetyTransition({
    previousDivergenceBps: 250,
    currentDivergenceBps: 180,
    maxDivergenceBps: 200,
  }), { unsafe: false, transition: "recovered" });
  assert.deepEqual(getTreasuryPriceSafetyTransition({
    previousDivergenceBps: 180,
    currentDivergenceBps: 150,
    maxDivergenceBps: 200,
  }), { unsafe: false, transition: null });
});

test("only inherited divergence pauses qualify for automatic recovery", () => {
  assert.equal(isLegacyTreasuryDivergencePause(
    "Executable price diverges 355 bps from the oracle",
  ), true);
  assert.equal(isLegacyTreasuryDivergencePause(
    "Entry execution diverged 217 bps from the oracle",
  ), true);
  assert.equal(isLegacyTreasuryDivergencePause("Paused by operator"), false);
  assert.equal(isLegacyTreasuryDivergencePause("Daily loss limit reached"), false);
  assert.equal(isLegacyTreasuryDivergencePause("CELO oracle is unavailable"), false);
});

test("oracle freshness rejects stale, future and invalid observations", () => {
  assert.equal(isOraclePriceFresh({
    updatedAtSeconds: 1_000,
    nowSeconds: 1_500,
    maxAgeSeconds: 600,
  }), true);
  assert.equal(isOraclePriceFresh({
    updatedAtSeconds: 1_000,
    nowSeconds: 1_601,
    maxAgeSeconds: 600,
  }), false);
  assert.equal(isOraclePriceFresh({
    updatedAtSeconds: 2_000,
    nowSeconds: 1_500,
    maxAgeSeconds: 600,
  }), false);
});

test("oracle reads retry transient failures and recover", async () => {
  let attempts = 0;
  const result = await retryTreasuryOracleRead(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary RPC failure");
    return 4009.2;
  }, { attempts: 3 });
  assert.equal(result, 4009.2);
  assert.equal(attempts, 3);
});

test("oracle reads do not retry deterministic safety failures", async () => {
  let attempts = 0;
  await assert.rejects(() => retryTreasuryOracleRead(async () => {
    attempts += 1;
    throw new Error("stale oracle round");
  }, {
    attempts: 3,
    shouldRetry: () => false,
  }));
  assert.equal(attempts, 1);
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
