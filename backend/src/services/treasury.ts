import {
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Env } from "../config/env.js";
import {
  getSupabase,
  type TreasuryPositionRow,
  type TreasurySignalRow,
} from "../db/supabase.js";
import { withServerAttribution } from "../lib/attribution.js";
import { createChainClients } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import {
  calculateEntryDeviationBps,
  calculatePaperAssetAmount,
  calculatePositionPnl,
  calculatePriceDivergenceBps,
  evaluateTreasuryRisk,
  getTreasuryCloseReason,
  getStaleSignalRecoveryAction,
  isOraclePriceFresh,
  parseTradingViewSignal,
  type TradingViewSignal,
  type TreasuryCloseReason,
} from "../lib/treasury.js";
import { getTokenAddress, TOKEN_DECIMALS, type Stablecoin } from "../lib/tokens.js";
import {
  buildTreasurySwapCalls,
  quoteTreasurySwap,
  type TreasuryCall,
  type TreasuryRoute,
  type TreasurySwapQuote,
} from "./treasury-routing.js";

const DEFAULT_CELO_ADDRESS = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const DEFAULT_CELO_ORACLE_ADDRESS = "0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e" as Address;
const aggregatorV3Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type TreasuryAsset = "CELO" | "ORO";

type OracleSnapshot = {
  price: number;
  source: string;
  updatedAt: string;
  updatedAtSeconds: number;
  roundId: string;
  blockNumber: string;
};

type PositionMarketSnapshot = {
  oracle: OracleSnapshot;
  executablePrice: number;
  divergenceBps: number;
  route: TreasuryRoute;
  quote: TreasurySwapQuote;
};

class TreasuryPriceSafetyError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TreasuryPriceSafetyError";
  }
}

function quantEnabled(env: Env) {
  return env.TREASURY_QUANT_ENABLED === "true";
}

function quantConfig(env: Env) {
  return {
    mode: env.TREASURY_QUANT_MODE ?? "paper",
    defaultPositionUsd: env.TREASURY_DEFAULT_POSITION_USD ?? "1",
    maxPerTradeUsd: env.TREASURY_MAX_PER_TRADE_USD ?? "5",
    maxTotalExposureUsd: env.TREASURY_MAX_TOTAL_EXPOSURE_USD ?? "20",
    maxOpenPositionsPerAsset: env.TREASURY_MAX_OPEN_POSITIONS_PER_ASSET ?? 1,
    dailyLossLimitUsd: env.TREASURY_DAILY_LOSS_LIMIT_USD ?? "5",
    maxSlippageBps: env.TREASURY_MAX_SLIPPAGE_BPS ?? 100,
    maxEntryDeviationBps: env.TREASURY_MAX_ENTRY_DEVIATION_BPS ?? 500,
    maxPriceDivergenceBps: env.TREASURY_MAX_PRICE_DIVERGENCE_BPS ?? 200,
    oracleMaxAgeSeconds: env.TREASURY_ORACLE_MAX_AGE_SECONDS ?? 600,
    oroSymbol: env.TREASURY_ORO_SYMBOL ?? "ORO",
  };
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value: number, decimals = 18) {
  return value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function parseStoredUnits(value: string | number, decimals: number) {
  const [whole, fraction = ""] = String(value).split(".");
  const truncated = fraction.length > 0
    ? `${whole}.${fraction.slice(0, decimals)}`
    : whole;
  return parseUnits(truncated, decimals);
}

function assetAddress(env: Env, asset: TreasuryAsset) {
  if (asset === "CELO") return env.TREASURY_CELO_ADDRESS ?? DEFAULT_CELO_ADDRESS;
  if (!env.TREASURY_ORO_ADDRESS) {
    throw new ApiError(409, "ASSET_NOT_CONFIGURED", `${quantConfig(env).oroSymbol} is not configured`);
  }
  return env.TREASURY_ORO_ADDRESS;
}

function assetOracleAddress(env: Env, asset: TreasuryAsset) {
  if (asset === "CELO") {
    const address = env.TREASURY_CELO_ORACLE_ADDRESS
      ?? (env.CHAIN_ID === 42220 ? DEFAULT_CELO_ORACLE_ADDRESS : undefined);
    if (!address) throw new TreasuryPriceSafetyError("CELO oracle is not configured");
    return address;
  }
  if (!env.TREASURY_ORO_ORACLE_ADDRESS) {
    throw new TreasuryPriceSafetyError(`${quantConfig(env).oroSymbol} oracle is not configured`);
  }
  return env.TREASURY_ORO_ORACLE_ADDRESS;
}

function assetIsConfigured(env: Env, asset: TreasuryAsset) {
  if (asset === "CELO") {
    return Boolean(
      env.TREASURY_CELO_ORACLE_ADDRESS
      ?? (env.CHAIN_ID === 42220 ? DEFAULT_CELO_ORACLE_ADDRESS : undefined),
    );
  }
  return Boolean(env.TREASURY_ORO_ADDRESS && env.TREASURY_ORO_ORACLE_ADDRESS);
}

function executorAccount(env: Env) {
  return env.TREASURY_EXECUTOR_PRIVATE_KEY
    ? privateKeyToAccount(env.TREASURY_EXECUTOR_PRIVATE_KEY)
    : null;
}

function executorAddress(env: Env) {
  return executorAccount(env)?.address ?? env.TREASURY_EXECUTOR_ADDRESS ?? null;
}

async function tokenDecimals(env: Env, address: Address) {
  if (address.toLowerCase() === DEFAULT_CELO_ADDRESS.toLowerCase()) return 18;
  const { publicClient } = createChainClients(env);
  return Number(await publicClient.readContract({
    address,
    abi: erc20Abi,
    functionName: "decimals",
  }));
}

async function tokenBalance(env: Env, token: Address, owner: Address) {
  const { publicClient } = createChainClients(env);
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

async function readOraclePrice(env: Env, asset: TreasuryAsset): Promise<OracleSnapshot> {
  const address = assetOracleAddress(env, asset);
  const { publicClient } = createChainClients(env);
  try {
    const [decimals, description, round, blockNumber] = await Promise.all([
      publicClient.readContract({
        address,
        abi: aggregatorV3Abi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address,
        abi: aggregatorV3Abi,
        functionName: "description",
      }),
      publicClient.readContract({
        address,
        abi: aggregatorV3Abi,
        functionName: "latestRoundData",
      }),
      publicClient.getBlockNumber(),
    ]);
    const [roundId, answer, , updatedAt, answeredInRound] = round;
    if (answer <= 0n) {
      throw new TreasuryPriceSafetyError(`${asset} oracle returned a non-positive price`, {
        oracle: address,
        answer: answer.toString(),
      });
    }
    if (updatedAt <= 0n || answeredInRound < roundId) {
      throw new TreasuryPriceSafetyError(`${asset} oracle returned an incomplete round`, {
        oracle: address,
        roundId: roundId.toString(),
        answeredInRound: answeredInRound.toString(),
      });
    }
    const updatedAtSeconds = Number(updatedAt);
    const maxAgeSeconds = quantConfig(env).oracleMaxAgeSeconds;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!isOraclePriceFresh({ updatedAtSeconds, nowSeconds, maxAgeSeconds })) {
      throw new TreasuryPriceSafetyError(`${asset} oracle price is stale`, {
        oracle: address,
        updatedAt: new Date(updatedAtSeconds * 1000).toISOString(),
        maxAgeSeconds,
      });
    }
    return {
      price: numeric(formatUnits(answer, Number(decimals))),
      source: `${description} @ ${address}`,
      updatedAt: new Date(updatedAtSeconds * 1000).toISOString(),
      updatedAtSeconds,
      roundId: roundId.toString(),
      blockNumber: blockNumber.toString(),
    };
  } catch (error) {
    if (error instanceof TreasuryPriceSafetyError) throw error;
    throw new TreasuryPriceSafetyError(`${asset} oracle is unavailable`, {
      oracle: address,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function addAudit(
  env: Env,
  eventType: string,
  details: Record<string, unknown>,
  ids: { signalId?: string; positionId?: string } = {},
) {
  await getSupabase(env).from("treasury_quant_audit").insert({
    event_type: eventType,
    signal_id: ids.signalId ?? null,
    position_id: ids.positionId ?? null,
    details,
  });
}

function serializeSignal(signal: TreasurySignalRow) {
  return {
    id: signal.id,
    externalSignalId: signal.external_signal_id,
    source: signal.source,
    timeframe: signal.timeframe,
    side: signal.side,
    signalType: signal.signal_type,
    entryPrice: String(signal.entry_price),
    slPrice: String(signal.sl_price),
    tpPrice: String(signal.tp_price),
    strategy: {
      code: signal.strategy_code,
      name: signal.strategy_name,
      description: signal.strategy_description,
    },
    symbol: {
      code: signal.symbol_code,
      baseAsset: signal.base_asset,
      quoteAsset: signal.quote_asset,
    },
    status: signal.status,
    positionId: signal.position_id,
    reason: signal.rejection_reason,
    receivedAt: signal.received_at,
    processedAt: signal.processed_at,
  };
}

function serializePosition(position: TreasuryPositionRow) {
  return {
    id: position.id,
    signalId: position.signal_id,
    asset: position.asset,
    quoteToken: position.quote_token,
    mode: position.mode,
    route: position.route,
    status: position.status,
    amountAsset: String(position.amount_asset),
    costQuote: String(position.cost_quote),
    entryPrice: String(position.entry_price),
    currentPrice: String(position.current_price),
    oraclePrice: position.oracle_price == null ? null : String(position.oracle_price),
    executablePrice: position.executable_price == null ? null : String(position.executable_price),
    priceDivergenceBps: position.price_divergence_bps,
    oracleSource: position.oracle_source,
    oracleUpdatedAt: position.oracle_updated_at,
    priceBlockNumber: position.price_block_number == null ? null : String(position.price_block_number),
    priceRoute: position.price_route,
    slPrice: String(position.sl_price),
    tpPrice: String(position.tp_price),
    pnlQuote: String(position.pnl_quote),
    entryTxHash: position.entry_tx_hash,
    exitTxHash: position.exit_tx_hash,
    closeReason: position.close_reason,
    closeRequestedAt: position.close_requested_at,
    openedAt: position.opened_at,
    closedAt: position.closed_at,
    lastCheckedAt: position.last_checked_at,
  };
}

export async function submitTreasurySignal(env: Env, payload: unknown) {
  if (!quantEnabled(env)) {
    throw new ApiError(503, "TREASURY_DISABLED", "Treasury Quant Agent is disabled");
  }
  const signal = parseTradingViewSignal(payload);
  const row = {
    external_signal_id: signal.externalSignalId,
    source: signal.source,
    timeframe: signal.timeframe,
    side: signal.side,
    signal_type: signal.signalType,
    entry_price: signal.entryPrice,
    sl_price: signal.slPrice,
    tp_price: signal.tpPrice,
    strategy_code: signal.strategy.code,
    strategy_name: signal.strategy.name,
    strategy_description: signal.strategy.description || null,
    symbol_code: signal.symbol.code.toUpperCase(),
    base_asset: signal.symbol.baseAsset,
    quote_asset: signal.symbol.quoteAsset,
    payload: signal,
  };
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from("treasury_quant_signals").insert(row).select("*").single();
  if (error?.code === "23505") {
    const { data: existing, error: lookupError } = await supabase
      .from("treasury_quant_signals")
      .select("*")
      .eq("external_signal_id", signal.externalSignalId)
      .single();
    if (lookupError || !existing) throw new ApiError(500, "INTERNAL_ERROR", lookupError?.message ?? "Signal lookup failed");
    return { duplicate: true, signal: serializeSignal(existing as TreasurySignalRow) };
  }
  if (error || !data) throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Signal insert failed");
  await addAudit(env, "signal_received", { externalSignalId: signal.externalSignalId }, { signalId: data.id });
  return { duplicate: false, signal: serializeSignal(data as TreasurySignalRow) };
}

async function getControl(env: Env) {
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_control")
    .select("*")
    .eq("id", "global")
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  return {
    paused: Boolean(data?.paused),
    reason: (data?.pause_reason as string | null | undefined) ?? null,
    updatedAt: (data?.updated_at as string | undefined) ?? null,
  };
}

async function riskSnapshot(env: Env, signal: TradingViewSignal) {
  const config = quantConfig(env);
  const supabase = getSupabase(env);
  const [{ data: positions, error: positionsError }, control] = await Promise.all([
    supabase.from("treasury_quant_positions").select("*").in("status", ["open", "closing"]),
    getControl(env),
  ]);
  if (positionsError) throw new ApiError(500, "INTERNAL_ERROR", positionsError.message);
  const openPositions = (positions ?? []) as TreasuryPositionRow[];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { data: closed, error: closedError } = await supabase
    .from("treasury_quant_positions")
    .select("pnl_quote")
    .eq("status", "closed")
    .gte("closed_at", today.toISOString());
  if (closedError) throw new ApiError(500, "INTERNAL_ERROR", closedError.message);
  const dailyLossUsd = (closed ?? []).reduce((sum, row) => {
    const pnl = numeric(row.pnl_quote);
    return pnl < 0 ? sum + Math.abs(pnl) : sum;
  }, 0);
  return {
    paused: control.paused,
    assetConfigured: assetIsConfigured(env, signal.symbol.baseAsset),
    openPositionsForAsset: openPositions.filter(
      (position) => position.asset === signal.symbol.baseAsset,
    ).length,
    maxOpenPositionsPerAsset: config.maxOpenPositionsPerAsset,
    tradeUsd: Number(config.defaultPositionUsd),
    maxPerTradeUsd: Number(config.maxPerTradeUsd),
    totalExposureUsd: openPositions.reduce((sum, position) => sum + numeric(position.cost_quote), 0),
    maxTotalExposureUsd: Number(config.maxTotalExposureUsd),
    dailyLossUsd,
    dailyLossLimitUsd: Number(config.dailyLossLimitUsd),
  };
}

async function insertExecution(
  env: Env,
  input: {
    signalId?: string;
    positionId?: string;
    action: "approve" | "entry" | "exit";
    route: "paper" | TreasuryRoute;
    tokenIn: Address | string;
    tokenOut: Address | string;
    amountIn: string;
    amountOut: string;
    txHash?: Hex;
    status: "paper" | "submitted" | "confirmed" | "failed";
    error?: string;
  },
) {
  await getSupabase(env).from("treasury_quant_executions").insert({
    signal_id: input.signalId ?? null,
    position_id: input.positionId ?? null,
    action: input.action,
    route: input.route,
    token_in: input.tokenIn,
    token_out: input.tokenOut,
    amount_in: input.amountIn,
    amount_out: input.amountOut,
    tx_hash: input.txHash ?? null,
    status: input.status,
    error: input.error ?? null,
    confirmed_at: input.status === "confirmed" ? new Date().toISOString() : null,
  });
}

async function sendTreasuryCall(
  env: Env,
  call: TreasuryCall,
  input: {
    signalId?: string;
    positionId?: string;
    action: "approve" | "entry" | "exit";
    route: TreasuryRoute;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: string;
  },
) {
  const account = executorAccount(env);
  if (!account || !env.TREASURY_EXECUTOR_PRIVATE_KEY) throw new Error("Treasury executor is not configured");
  const { publicClient, walletClient } = createChainClients(env, env.TREASURY_EXECUTOR_PRIVATE_KEY);
  const hash = await walletClient.sendTransaction({
    account,
    to: call.to,
    data: withServerAttribution(env, call.data),
    value: call.value,
  });
  await insertExecution(env, {
    ...input,
    amountOut: "0",
    txHash: hash,
    status: "submitted",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${input.action} transaction reverted`);
  await getSupabase(env)
    .from("treasury_quant_executions")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("tx_hash", hash);
  return hash;
}

async function executeTreasurySwap(
  env: Env,
  input: {
    signalId?: string;
    positionId?: string;
    action: "entry" | "exit";
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    quote?: TreasurySwapQuote;
  },
) {
  const account = executorAccount(env);
  if (!account) throw new Error("Treasury executor is not configured");
  const quote = input.quote ?? await quoteTreasurySwap(env, input.tokenIn, input.tokenOut, input.amountIn);
  if (
    quote.tokenIn.toLowerCase() !== input.tokenIn.toLowerCase()
    || quote.tokenOut.toLowerCase() !== input.tokenOut.toLowerCase()
    || quote.amountIn !== input.amountIn
    || quote.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Prepared treasury quote does not match the requested swap or has expired");
  }
  const calls = await buildTreasurySwapCalls(env, quote, account.address);
  const before = await tokenBalance(env, input.tokenOut, account.address);
  let approvalHash: Hex | null = null;
  if (calls.approval) {
    approvalHash = await sendTreasuryCall(env, calls.approval, {
      signalId: input.signalId,
      positionId: input.positionId,
      action: "approve",
      route: quote.protocol,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn.toString(),
    });
  }
  const swapHash = await sendTreasuryCall(env, calls.swap, {
    signalId: input.signalId,
    positionId: input.positionId,
    action: input.action,
    route: quote.protocol,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn.toString(),
  });
  const after = await tokenBalance(env, input.tokenOut, account.address);
  const amountOut = after > before ? after - before : quote.expectedAmountOut;
  await getSupabase(env)
    .from("treasury_quant_executions")
    .update({ amount_out: amountOut.toString() })
    .eq("tx_hash", swapHash);
  return { quote, amountOut, approvalHash, swapHash };
}

async function createPaperPosition(env: Env, signal: TreasurySignalRow) {
  const tradeUsd = Number(quantConfig(env).defaultPositionUsd);
  const entryPrice = numeric(signal.entry_price);
  const amountAsset = calculatePaperAssetAmount(tradeUsd, entryPrice);
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_positions")
    .insert({
      signal_id: signal.id,
      asset: signal.base_asset,
      quote_token: signal.quote_asset,
      mode: "paper",
      route: "paper",
      amount_asset: amountAsset,
      cost_quote: fixed(tradeUsd),
      entry_price: signal.entry_price,
      current_price: signal.entry_price,
      sl_price: signal.sl_price,
      tp_price: signal.tp_price,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Paper position insert failed");
  await insertExecution(env, {
    signalId: signal.id,
    positionId: data.id,
    action: "entry",
    route: "paper",
    tokenIn: signal.quote_asset,
    tokenOut: signal.base_asset,
    amountIn: fixed(tradeUsd),
    amountOut: amountAsset,
    status: "paper",
  });
  return data as TreasuryPositionRow;
}

async function createLivePosition(env: Env, signal: TreasurySignalRow) {
  const config = quantConfig(env);
  const account = executorAccount(env);
  if (!account) throw new Error("Treasury executor is not configured");
  const quoteToken = signal.quote_asset as Stablecoin;
  const quoteAddress = getTokenAddress(env, quoteToken);
  const outputAddress = assetAddress(env, signal.base_asset);
  const amountIn = parseUnits(config.defaultPositionUsd, TOKEN_DECIMALS[quoteToken]);
  const balance = await tokenBalance(env, quoteAddress, account.address);
  if (balance < amountIn) throw new Error(`Insufficient ${quoteToken} treasury balance`);
  const [quote, oracle] = await Promise.all([
    quoteTreasurySwap(env, quoteAddress, outputAddress, amountIn),
    readOraclePrice(env, signal.base_asset),
  ]);
  const assetDecimals = await tokenDecimals(env, outputAddress);
  const expectedAsset = numeric(formatUnits(quote.expectedAmountOut, assetDecimals));
  const costQuote = numeric(formatUnits(amountIn, TOKEN_DECIMALS[quoteToken]));
  const executionPrice = costQuote / expectedAsset;
  const signalPrice = numeric(signal.entry_price);
  const signalExecutionDeviationBps = calculateEntryDeviationBps(signalPrice, executionPrice);
  if (signalExecutionDeviationBps > config.maxEntryDeviationBps) {
    throw new Error(
      `Executable price deviates ${signalExecutionDeviationBps} bps from the TradingView signal`,
    );
  }
  const signalOracleDeviationBps = calculateEntryDeviationBps(signalPrice, oracle.price);
  if (signalOracleDeviationBps > config.maxEntryDeviationBps) {
    throw new Error(`Oracle price deviates ${signalOracleDeviationBps} bps from the TradingView signal`);
  }
  const priceDivergenceBps = calculatePriceDivergenceBps(oracle.price, executionPrice);
  if (priceDivergenceBps > config.maxPriceDivergenceBps) {
    throw new TreasuryPriceSafetyError(
      `Executable price diverges ${priceDivergenceBps} bps from the oracle`,
      {
        oraclePrice: oracle.price,
        executablePrice: executionPrice,
        maxPriceDivergenceBps: config.maxPriceDivergenceBps,
      },
    );
  }
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_positions")
    .insert({
      signal_id: signal.id,
      asset: signal.base_asset,
      quote_token: quoteToken,
      mode: "live",
      route: quote.protocol,
      amount_asset: fixed(expectedAsset, 24),
      cost_quote: fixed(costQuote, 24),
      entry_price: fixed(executionPrice),
      current_price: fixed(oracle.price),
      oracle_price: fixed(oracle.price),
      executable_price: fixed(executionPrice),
      price_divergence_bps: priceDivergenceBps,
      oracle_source: oracle.source,
      oracle_updated_at: oracle.updatedAt,
      price_block_number: oracle.blockNumber,
      price_route: quote.protocol,
      sl_price: signal.sl_price,
      tp_price: signal.tp_price,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Live position insert failed");
  try {
    const execution = await executeTreasurySwap(env, {
      signalId: signal.id,
      positionId: data.id,
      action: "entry",
      tokenIn: quoteAddress,
      tokenOut: outputAddress,
      amountIn,
      quote,
    });
    const actualAsset = numeric(formatUnits(execution.amountOut, assetDecimals));
    const actualPrice = costQuote / actualAsset;
    const actualDivergenceBps = calculatePriceDivergenceBps(oracle.price, actualPrice);
    const { data: updated, error: updateError } = await getSupabase(env)
      .from("treasury_quant_positions")
      .update({
        route: execution.quote.protocol,
        amount_asset: fixed(actualAsset, 24),
        entry_price: fixed(actualPrice),
        current_price: fixed(oracle.price),
        executable_price: fixed(actualPrice),
        price_divergence_bps: actualDivergenceBps,
        entry_tx_hash: execution.swapHash,
      })
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError || !updated) throw new Error(updateError?.message ?? "Live position update failed");
    if (actualDivergenceBps > config.maxPriceDivergenceBps) {
      await setTreasuryPause(
        env,
        true,
        `Entry execution diverged ${actualDivergenceBps} bps from the oracle`,
      );
      await addAudit(env, "treasury_price_safety_pause", {
        phase: "entry",
        oraclePrice: oracle.price,
        executablePrice: actualPrice,
        divergenceBps: actualDivergenceBps,
      }, { signalId: signal.id, positionId: data.id });
    }
    return updated as TreasuryPositionRow;
  } catch (executionError) {
    await getSupabase(env)
      .from("treasury_quant_positions")
      .update({
        status: "failed",
        close_reason: executionError instanceof Error ? executionError.message.slice(0, 500) : "Entry failed",
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    throw executionError;
  }
}

async function rejectSignal(env: Env, signal: TreasurySignalRow, reason: string, status: "rejected" | "failed") {
  await getSupabase(env)
    .from("treasury_quant_signals")
    .update({
      status,
      rejection_reason: reason.slice(0, 1000),
      processed_at: new Date().toISOString(),
    })
    .eq("id", signal.id);
  await addAudit(env, `signal_${status}`, { reason }, { signalId: signal.id });
}

export async function processNextTreasurySignal(env: Env) {
  if (!quantEnabled(env)) return null;
  const supabase = getSupabase(env);
  const { data: pending, error } = await supabase
    .from("treasury_quant_signals")
    .select("*")
    .eq("status", "pending")
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pending) return null;
  const { data: claimed, error: claimError } = await supabase
    .from("treasury_quant_signals")
    .update({ status: "processing", processing_started_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (claimError || !claimed) return null;
  const signal = claimed as TreasurySignalRow;
  try {
    const parsed = parseTradingViewSignal(signal.payload);
    const snapshot = await riskSnapshot(env, parsed);
    const risk = evaluateTreasuryRisk(snapshot);
    if (!risk.ok) {
      await rejectSignal(env, signal, risk.reason, "rejected");
      return { status: "rejected", reason: risk.reason };
    }
    const position = quantConfig(env).mode === "paper"
      ? await createPaperPosition(env, signal)
      : await createLivePosition(env, signal);
    await supabase
      .from("treasury_quant_signals")
      .update({
        status: "executed",
        position_id: position.id,
        processed_at: new Date().toISOString(),
      })
      .eq("id", signal.id);
    await addAudit(env, "position_opened", {
      mode: position.mode,
      route: position.route,
      asset: position.asset,
      quoteToken: position.quote_token,
    }, { signalId: signal.id, positionId: position.id });
    return { status: "executed", positionId: position.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await rejectSignal(env, signal, message, "failed");
    return { status: "failed", reason: message };
  }
}

export async function recoverStaleTreasurySignals(env: Env) {
  if (!quantEnabled(env)) return [];
  const supabase = getSupabase(env);
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("treasury_quant_signals")
    .select("*")
    .eq("status", "processing")
    .lt("processing_started_at", cutoff);
  if (error) throw new Error(error.message);
  const recovered = [];
  for (const raw of data ?? []) {
    const signal = raw as TreasurySignalRow;
    const [{ data: positions }, { data: executions }] = await Promise.all([
      supabase.from("treasury_quant_positions").select("id,status,entry_tx_hash").eq("signal_id", signal.id).limit(1),
      supabase.from("treasury_quant_executions").select("id,status,tx_hash").eq("signal_id", signal.id).limit(1),
    ]);
    const action = getStaleSignalRecoveryAction({
      hasPosition: (positions?.length ?? 0) > 0,
      hasExecution: (executions?.length ?? 0) > 0,
    });
    if (action === "manual_reconciliation") {
      await supabase
        .from("treasury_quant_positions")
        .update({
          status: "failed",
          close_reason: "Worker restarted during execution; operator reconciliation required",
          closed_at: new Date().toISOString(),
        })
        .eq("signal_id", signal.id)
        .is("entry_tx_hash", null);
      await rejectSignal(
        env,
        signal,
        "Worker restarted after execution state was created; operator reconciliation required",
        "failed",
      );
      recovered.push({ id: signal.id, action: "manual_reconciliation" });
      continue;
    }
    await supabase
      .from("treasury_quant_signals")
      .update({
        status: "pending",
        processing_started_at: null,
        rejection_reason: null,
      })
      .eq("id", signal.id)
      .eq("status", "processing");
    await addAudit(env, "signal_requeued_after_restart", {}, { signalId: signal.id });
    recovered.push({ id: signal.id, action: "requeued" });
  }
  return recovered;
}

async function currentPositionMarket(
  env: Env,
  position: TreasuryPositionRow,
): Promise<PositionMarketSnapshot> {
  const asset = assetAddress(env, position.asset);
  const quoteToken = position.quote_token as Stablecoin;
  const quoteAddress = getTokenAddress(env, quoteToken);
  const decimals = await tokenDecimals(env, asset);
  const amountIn = parseStoredUnits(position.amount_asset, decimals);
  const [oracle, quote] = await Promise.all([
    readOraclePrice(env, position.asset),
    quoteTreasurySwap(env, asset, quoteAddress, amountIn),
  ]);
  const amountAsset = numeric(formatUnits(amountIn, decimals));
  const amountQuote = numeric(formatUnits(quote.expectedAmountOut, TOKEN_DECIMALS[quoteToken]));
  const executablePrice = amountQuote / amountAsset;
  return {
    oracle,
    executablePrice,
    divergenceBps: calculatePriceDivergenceBps(oracle.price, executablePrice),
    route: quote.protocol,
    quote,
  };
}

async function closePaperPosition(
  env: Env,
  position: TreasuryPositionRow,
  market: PositionMarketSnapshot,
  reason: TreasuryCloseReason,
) {
  const pnl = calculatePositionPnl({
    amountAsset: numeric(position.amount_asset),
    costQuote: numeric(position.cost_quote),
    currentPrice: market.executablePrice,
  });
  await getSupabase(env).from("treasury_quant_executions").insert({
    signal_id: position.signal_id,
    position_id: position.id,
    action: "exit",
    route: "paper",
    token_in: position.asset,
    token_out: position.quote_token,
    amount_in: position.amount_asset,
    amount_out: fixed(numeric(position.amount_asset) * market.executablePrice, 24),
    status: "paper",
  });
  await getSupabase(env)
    .from("treasury_quant_positions")
    .update({
      status: "closed",
      current_price: fixed(market.oracle.price),
      oracle_price: fixed(market.oracle.price),
      executable_price: fixed(market.executablePrice),
      price_divergence_bps: market.divergenceBps,
      oracle_source: market.oracle.source,
      oracle_updated_at: market.oracle.updatedAt,
      price_block_number: market.oracle.blockNumber,
      price_route: market.route,
      pnl_quote: fixed(pnl, 24),
      close_reason: reason,
      closed_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", position.id);
}

async function closeLivePosition(
  env: Env,
  position: TreasuryPositionRow,
  market: PositionMarketSnapshot,
  reason: TreasuryCloseReason,
) {
  const asset = assetAddress(env, position.asset);
  const quoteToken = position.quote_token as Stablecoin;
  const quoteAddress = getTokenAddress(env, quoteToken);
  const decimals = await tokenDecimals(env, asset);
  const amountIn = parseStoredUnits(position.amount_asset, decimals);
  await getSupabase(env).from("treasury_quant_positions").update({ status: "closing" }).eq("id", position.id);
  const execution = await executeTreasurySwap(env, {
    signalId: position.signal_id,
    positionId: position.id,
    action: "exit",
    tokenIn: asset,
    tokenOut: quoteAddress,
    amountIn,
    quote: market.quote,
  });
  const amountOut = numeric(formatUnits(execution.amountOut, TOKEN_DECIMALS[quoteToken]));
  const pnl = amountOut - numeric(position.cost_quote);
  await getSupabase(env)
    .from("treasury_quant_positions")
    .update({
      status: "closed",
      route: execution.quote.protocol,
      current_price: fixed(market.oracle.price),
      oracle_price: fixed(market.oracle.price),
      executable_price: fixed(market.executablePrice),
      price_divergence_bps: market.divergenceBps,
      oracle_source: market.oracle.source,
      oracle_updated_at: market.oracle.updatedAt,
      price_block_number: market.oracle.blockNumber,
      price_route: market.route,
      pnl_quote: fixed(pnl, 24),
      exit_tx_hash: execution.swapHash,
      close_reason: reason,
      closed_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", position.id);
}

export async function monitorTreasuryPositions(env: Env) {
  if (!quantEnabled(env)) return [];
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_positions")
    .select("*")
    .eq("status", "open")
    .order("opened_at", { ascending: true });
  if (error) throw new Error(error.message);
  const results = [];
  for (const raw of data ?? []) {
    const position = raw as TreasuryPositionRow;
    try {
      const market = await currentPositionMarket(env, position);
      const marketFields = {
        current_price: fixed(market.oracle.price),
        oracle_price: fixed(market.oracle.price),
        executable_price: fixed(market.executablePrice),
        price_divergence_bps: market.divergenceBps,
        oracle_source: market.oracle.source,
        oracle_updated_at: market.oracle.updatedAt,
        price_block_number: market.oracle.blockNumber,
        price_route: market.route,
        last_checked_at: new Date().toISOString(),
      };
      if (market.divergenceBps > quantConfig(env).maxPriceDivergenceBps) {
        const maxPriceDivergenceBps = quantConfig(env).maxPriceDivergenceBps;
        const wasAlreadyUnsafe = numeric(position.price_divergence_bps) > maxPriceDivergenceBps;
        await getSupabase(env)
          .from("treasury_quant_positions")
          .update(marketFields)
          .eq("id", position.id);
        const message =
          `Executable price diverges ${market.divergenceBps} bps from the oracle`;
        if (!wasAlreadyUnsafe) {
          const control = await getControl(env);
          if (position.mode === "live" && !control.paused) {
            await setTreasuryPause(env, true, message);
          }
          await addAudit(env, "treasury_price_safety_pause", {
            message,
            oraclePrice: market.oracle.price,
            executablePrice: market.executablePrice,
            divergenceBps: market.divergenceBps,
            maxPriceDivergenceBps,
            route: market.route,
            blockNumber: market.oracle.blockNumber,
          }, {
            signalId: position.signal_id,
            positionId: position.id,
          });
        }
        results.push({
          id: position.id,
          status: "price_safety",
          reason: message,
          oraclePrice: market.oracle.price,
          executablePrice: market.executablePrice,
          divergenceBps: market.divergenceBps,
        });
        continue;
      }
      const reason = getTreasuryCloseReason({
        currentPrice: market.oracle.price,
        slPrice: numeric(position.sl_price),
        tpPrice: numeric(position.tp_price),
        closeRequested: Boolean(position.close_requested_at),
      });
      if (!reason) {
        const pnl = calculatePositionPnl({
          amountAsset: numeric(position.amount_asset),
          costQuote: numeric(position.cost_quote),
          currentPrice: market.executablePrice,
        });
        await getSupabase(env)
          .from("treasury_quant_positions")
          .update({
            ...marketFields,
            pnl_quote: fixed(pnl, 24),
          })
          .eq("id", position.id);
        results.push({
          id: position.id,
          status: "open",
          oraclePrice: market.oracle.price,
          executablePrice: market.executablePrice,
          divergenceBps: market.divergenceBps,
          route: market.route,
          blockNumber: market.oracle.blockNumber,
          oracleUpdatedAt: market.oracle.updatedAt,
        });
        continue;
      }
      if (position.mode === "paper") {
        await closePaperPosition(env, position, market, reason);
      } else {
        await closeLivePosition(env, position, market, reason);
      }
      await addAudit(env, "position_closed", {
        reason,
        oraclePrice: market.oracle.price,
        executablePrice: market.executablePrice,
        divergenceBps: market.divergenceBps,
        route: market.route,
        blockNumber: market.oracle.blockNumber,
      }, {
        signalId: position.signal_id,
        positionId: position.id,
      });
      results.push({
        id: position.id,
        status: "closed",
        reason,
        oraclePrice: market.oracle.price,
        executablePrice: market.executablePrice,
        divergenceBps: market.divergenceBps,
      });
    } catch (positionError) {
      const message = positionError instanceof Error ? positionError.message : String(positionError);
      const priceSafetyError = positionError instanceof TreasuryPriceSafetyError;
      const control = priceSafetyError ? await getControl(env) : null;
      if (position.mode === "live" && priceSafetyError && !control?.paused) {
        await setTreasuryPause(env, true, message);
      }
      if (!priceSafetyError || !control?.paused) {
        await addAudit(env, "position_monitor_error", {
          message,
          details: priceSafetyError ? positionError.details : undefined,
        }, {
          signalId: position.signal_id,
          positionId: position.id,
        });
      }
      results.push({ id: position.id, status: "error", reason: message });
    }
  }
  return results;
}

export async function runTreasuryWorkerCycle(env: Env) {
  const recovered = await recoverStaleTreasurySignals(env);
  const signal = await processNextTreasurySignal(env);
  const positions = await monitorTreasuryPositions(env);
  return { recovered, signal, positions };
}

export async function listTreasurySignals(env: Env, limit = 25) {
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_signals")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  return (data as TreasurySignalRow[]).map(serializeSignal);
}

export async function listTreasuryPositions(env: Env, limit = 25) {
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_positions")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  return (data as TreasuryPositionRow[]).map(serializePosition);
}

export async function getTreasuryQuantStatus(env: Env) {
  const config = quantConfig(env);
  const [control, signals, positions] = await Promise.all([
    getControl(env),
    listTreasurySignals(env, 10),
    listTreasuryPositions(env, 20),
  ]);
  const address = executorAddress(env);
  const balances: Partial<Record<Stablecoin | "CELO" | "ORO", string>> = {};
  if (address) {
    const stablecoins: Stablecoin[] = ["USDC", "USDT", "USDm"];
    await Promise.all(stablecoins.map(async (token) => {
      try {
        const value = await tokenBalance(env, getTokenAddress(env, token), address);
        balances[token] = formatUnits(value, TOKEN_DECIMALS[token]);
      } catch {
        balances[token] = "unavailable";
      }
    }));
    for (const asset of ["CELO", "ORO"] as const) {
      try {
        if (asset === "ORO" && !env.TREASURY_ORO_ADDRESS) continue;
        const token = assetAddress(env, asset);
        const decimals = await tokenDecimals(env, token);
        balances[asset] = formatUnits(await tokenBalance(env, token, address), decimals);
      } catch {
        balances[asset] = "unavailable";
      }
    }
  }
  const openPositions = positions.filter((position) => position.status === "open" || position.status === "closing");
  return {
    name: "Treasury Quant Agent",
    enabled: quantEnabled(env),
    mode: config.mode,
    paused: control.paused,
    pauseReason: control.reason,
    executorConfigured: Boolean(address),
    assets: {
      CELO: {
        enabled: assetIsConfigured(env, "CELO"),
        oracleConfigured: assetIsConfigured(env, "CELO"),
      },
      ORO: {
        enabled: assetIsConfigured(env, "ORO"),
        oracleConfigured: Boolean(env.TREASURY_ORO_ORACLE_ADDRESS),
        symbol: config.oroSymbol,
      },
    },
    limits: {
      defaultPositionUsd: config.defaultPositionUsd,
      maxPerTradeUsd: config.maxPerTradeUsd,
      maxTotalExposureUsd: config.maxTotalExposureUsd,
      maxOpenPositionsPerAsset: config.maxOpenPositionsPerAsset,
      dailyLossLimitUsd: config.dailyLossLimitUsd,
      maxSlippageBps: config.maxSlippageBps,
      maxPriceDivergenceBps: config.maxPriceDivergenceBps,
      oracleMaxAgeSeconds: config.oracleMaxAgeSeconds,
    },
    balances,
    metrics: {
      openPositions: openPositions.length,
      totalExposureUsd: fixed(openPositions.reduce((sum, position) => sum + numeric(position.costQuote), 0), 2),
      pendingSignals: signals.filter((signal) => signal.status === "pending" || signal.status === "processing").length,
    },
    recentSignals: signals,
    positions,
  };
}

export async function setTreasuryPause(env: Env, paused: boolean, reason?: string) {
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_control")
    .upsert({
      id: "global",
      paused,
      pause_reason: paused ? (reason?.trim().slice(0, 300) || "Paused by operator") : null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Control update failed");
  await addAudit(env, paused ? "agent_paused" : "agent_resumed", { reason: data.pause_reason });
  return { paused: data.paused, reason: data.pause_reason, updatedAt: data.updated_at };
}

export async function requestTreasuryPositionClose(env: Env, id: string) {
  const { data, error } = await getSupabase(env)
    .from("treasury_quant_positions")
    .update({
      close_requested_at: new Date().toISOString(),
      close_reason: "manual",
    })
    .eq("id", id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!data) throw new ApiError(409, "POSITION_UNAVAILABLE", "Position is not open");
  await addAudit(env, "position_close_requested", {}, {
    signalId: data.signal_id,
    positionId: data.id,
  });
  return serializePosition(data as TreasuryPositionRow);
}
