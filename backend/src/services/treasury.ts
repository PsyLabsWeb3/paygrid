import {
  decodeFunctionData,
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
  formatExactTreasuryAssetAmount,
  getClosingPositionRecoveryAction,
  getTreasuryCloseReason,
  getTreasuryPriceSafetyTransition,
  getStaleSignalRecoveryAction,
  isLegacyTreasuryDivergencePause,
  isOraclePriceFresh,
  parseTradingViewSignal,
  resolveTreasuryAssetLimits,
  retryTreasuryOracleRead,
  type TradingViewSignal,
  type TreasuryCloseReason,
} from "../lib/treasury.js";
import { getTokenAddress, TOKEN_DECIMALS, type Stablecoin } from "../lib/tokens.js";
import {
  buildTreasurySwapCalls,
  quoteTreasurySwap,
  type TreasuryCall,
  type TreasuryRoute,
  type TreasuryRoutingPreference,
  type TreasurySwapQuote,
} from "./treasury-routing.js";

const DEFAULT_CELO_ADDRESS = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const DEFAULT_CELO_ORACLE_ADDRESS = "0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e" as Address;
const DEFAULT_XAUT0_ADDRESS = "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff" as Address;
const DEFAULT_XAUT0_ORACLE_ADDRESS = "0x98DC6E90D4c2f212ed9d124aD2aFBa4833268633" as Address;
const DEFAULT_WETH_ADDRESS = "0xD221812de1BD094f35587EE8E174B07B6167D9Af" as Address;
const DEFAULT_WETH_ORACLE_ADDRESS = "0x1FcD30A73D67639c1cD89ff5746E7585731c083B" as Address;
const DEFAULT_WBTC_ADDRESS = "0x8aC2901Dd8A1F17a1A4768A6bA4C3751e3995B2D" as Address;
const DEFAULT_WBTC_ORACLE_ADDRESS = "0x128fE88eaa22bFFb868Bb3A584A54C96eE24014b" as Address;
const DEFAULT_EURM_ADDRESS = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73" as Address;
const DEFAULT_EURM_ORACLE_ADDRESS = "0x3D207061Dbe8E2473527611BFecB87Ff12b28dDa" as Address;
const aggregatorV3Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type TreasuryAsset = "CELO" | "XAUT0" | "WETH" | "WBTC" | "EURM";
const TREASURY_ASSETS: TreasuryAsset[] = ["CELO", "XAUT0", "WETH", "WBTC", "EURM"];

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
    readonly scope: "asset" | "global" = "global",
  ) {
    super(message);
    this.name = "TreasuryPriceSafetyError";
  }
}

class TreasuryEntryDivergenceError extends TreasuryPriceSafetyError {
  constructor(message: string, details: Record<string, unknown>) {
    super(message, details);
    this.name = "TreasuryEntryDivergenceError";
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
    xaut0OracleMaxAgeSeconds: env.TREASURY_XAUT0_ORACLE_MAX_AGE_SECONDS ?? 90_000,
    wethOracleMaxAgeSeconds: env.TREASURY_WETH_ORACLE_MAX_AGE_SECONDS ?? 3_600,
    wbtcOracleMaxAgeSeconds: env.TREASURY_WBTC_ORACLE_MAX_AGE_SECONDS ?? 3_600,
    eurmOracleMaxAgeSeconds: env.TREASURY_EURM_ORACLE_MAX_AGE_SECONDS ?? 90_000,
  };
}

function assetLimitOverrides(env: Env, asset: TreasuryAsset) {
  if (asset === "WETH") {
    return {
      maxPerTradeUsd: env.TREASURY_WETH_MAX_PER_TRADE_USD,
      maxTotalExposureUsd: env.TREASURY_WETH_MAX_TOTAL_EXPOSURE_USD,
      maxOpenPositions: env.TREASURY_WETH_MAX_OPEN_POSITIONS,
    };
  }
  if (asset === "WBTC") {
    return {
      maxPerTradeUsd: env.TREASURY_WBTC_MAX_PER_TRADE_USD,
      maxTotalExposureUsd: env.TREASURY_WBTC_MAX_TOTAL_EXPOSURE_USD,
      maxOpenPositions: env.TREASURY_WBTC_MAX_OPEN_POSITIONS,
    };
  }
  if (asset === "EURM") {
    return {
      maxPerTradeUsd: env.TREASURY_EURM_MAX_PER_TRADE_USD,
      maxTotalExposureUsd: env.TREASURY_EURM_MAX_TOTAL_EXPOSURE_USD,
      maxOpenPositions: env.TREASURY_EURM_MAX_OPEN_POSITIONS,
    };
  }
  return {};
}

function assetLimits(env: Env, asset: TreasuryAsset) {
  const config = quantConfig(env);
  return resolveTreasuryAssetLimits({
    maxPerTradeUsd: config.maxPerTradeUsd,
    maxTotalExposureUsd: config.maxTotalExposureUsd,
    maxOpenPositions: config.maxOpenPositionsPerAsset,
  }, assetLimitOverrides(env, asset));
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

function parseDatabaseInteger(value: string | number) {
  const [whole, fraction = ""] = String(value).split(".");
  if (fraction && /[1-9]/.test(fraction)) {
    throw new Error(`Expected integer token units, received ${value}`);
  }
  return BigInt(whole);
}

function assetAddress(env: Env, asset: TreasuryAsset) {
  if (asset === "CELO") return env.TREASURY_CELO_ADDRESS ?? DEFAULT_CELO_ADDRESS;
  const configured = {
    XAUT0: env.TREASURY_XAUT0_ADDRESS ?? DEFAULT_XAUT0_ADDRESS,
    WETH: env.TREASURY_WETH_ADDRESS ?? DEFAULT_WETH_ADDRESS,
    WBTC: env.TREASURY_WBTC_ADDRESS ?? DEFAULT_WBTC_ADDRESS,
    EURM: env.TREASURY_EURM_ADDRESS ?? DEFAULT_EURM_ADDRESS,
  } as const;
  const address = env.CHAIN_ID === 42220 ? configured[asset] : {
    XAUT0: env.TREASURY_XAUT0_ADDRESS,
    WETH: env.TREASURY_WETH_ADDRESS,
    WBTC: env.TREASURY_WBTC_ADDRESS,
    EURM: env.TREASURY_EURM_ADDRESS,
  }[asset];
  if (!address) throw new ApiError(409, "ASSET_NOT_CONFIGURED", `${asset} is not configured`);
  return address;
}

function assetOracleAddress(env: Env, asset: TreasuryAsset) {
  const configured = {
    CELO: env.TREASURY_CELO_ORACLE_ADDRESS ?? DEFAULT_CELO_ORACLE_ADDRESS,
    XAUT0: env.TREASURY_XAUT0_ORACLE_ADDRESS ?? DEFAULT_XAUT0_ORACLE_ADDRESS,
    WETH: env.TREASURY_WETH_ORACLE_ADDRESS ?? DEFAULT_WETH_ORACLE_ADDRESS,
    WBTC: env.TREASURY_WBTC_ORACLE_ADDRESS ?? DEFAULT_WBTC_ORACLE_ADDRESS,
    EURM: env.TREASURY_EURM_ORACLE_ADDRESS ?? DEFAULT_EURM_ORACLE_ADDRESS,
  } as const;
  const address = env.CHAIN_ID === 42220 ? configured[asset] : {
    CELO: env.TREASURY_CELO_ORACLE_ADDRESS,
    XAUT0: env.TREASURY_XAUT0_ORACLE_ADDRESS,
    WETH: env.TREASURY_WETH_ORACLE_ADDRESS,
    WBTC: env.TREASURY_WBTC_ORACLE_ADDRESS,
    EURM: env.TREASURY_EURM_ORACLE_ADDRESS,
  }[asset];
  if (!address) throw new TreasuryPriceSafetyError(`${asset} oracle is not configured`, {}, "asset");
  return address;
}

function assetIsConfigured(env: Env, asset: TreasuryAsset) {
  const explicitlyEnabled = {
    CELO: true,
    XAUT0: true,
    WETH: env.TREASURY_WETH_ENABLED === "true",
    WBTC: env.TREASURY_WBTC_ENABLED === "true",
    EURM: env.TREASURY_EURM_ENABLED === "true",
  }[asset];
  if (!explicitlyEnabled) return false;
  try {
    return Boolean(assetAddress(env, asset) && assetOracleAddress(env, asset));
  } catch {
    return false;
  }
}

function assetRoutingPreference(asset: TreasuryAsset): TreasuryRoutingPreference {
  return asset === "WETH" || asset === "WBTC" ? "uniswap-only" : "mento-first";
}

function quoteAssetSwap(
  env: Env,
  asset: TreasuryAsset,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
) {
  return quoteTreasurySwap(
    env,
    tokenIn,
    tokenOut,
    amountIn,
    quantConfig(env).maxSlippageBps,
    assetRoutingPreference(asset),
  );
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

async function waitForTreasuryApproval(
  env: Env,
  token: Address,
  owner: Address,
  approval: TreasuryCall,
  requiredAmount: bigint,
) {
  const decoded = decodeFunctionData({ abi: erc20Abi, data: approval.data });
  if (decoded.functionName !== "approve") return;
  const spender = decoded.args[0] as Address;
  const { publicClient } = createChainClients(env);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, spender],
      }),
    ]);
    if (balance < requiredAmount) {
      throw new Error("Treasury token balance became insufficient before swap execution");
    }
    if (allowance >= requiredAmount) {
      // Celo RPC providers may briefly disagree immediately after a receipt.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Treasury approval was not visible before swap execution");
}

async function readOraclePriceOnce(env: Env, asset: TreasuryAsset): Promise<OracleSnapshot> {
  const address = assetOracleAddress(env, asset);
  const { publicClient } = createChainClients(env);
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
    }, "asset");
  }
  if (updatedAt <= 0n || answeredInRound < roundId) {
    throw new TreasuryPriceSafetyError(`${asset} oracle returned an incomplete round`, {
      oracle: address,
      roundId: roundId.toString(),
      answeredInRound: answeredInRound.toString(),
    }, "asset");
  }
  const updatedAtSeconds = Number(updatedAt);
  const config = quantConfig(env);
  const maxAgeSeconds = {
    CELO: config.oracleMaxAgeSeconds,
    XAUT0: config.xaut0OracleMaxAgeSeconds,
    WETH: config.wethOracleMaxAgeSeconds,
    WBTC: config.wbtcOracleMaxAgeSeconds,
    EURM: config.eurmOracleMaxAgeSeconds,
  }[asset];
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!isOraclePriceFresh({ updatedAtSeconds, nowSeconds, maxAgeSeconds })) {
    throw new TreasuryPriceSafetyError(`${asset} oracle price is stale`, {
      oracle: address,
      updatedAt: new Date(updatedAtSeconds * 1000).toISOString(),
      maxAgeSeconds,
    }, "asset");
  }
  return {
    price: numeric(formatUnits(answer, Number(decimals))),
    source: `${description} @ ${address}`,
    updatedAt: new Date(updatedAtSeconds * 1000).toISOString(),
    updatedAtSeconds,
    roundId: roundId.toString(),
    blockNumber: blockNumber.toString(),
  };
}

async function readOraclePrice(env: Env, asset: TreasuryAsset): Promise<OracleSnapshot> {
  const address = assetOracleAddress(env, asset);
  try {
    return await retryTreasuryOracleRead(
      () => readOraclePriceOnce(env, asset),
      {
        attempts: 3,
        delayMs: 500,
        shouldRetry: (error) => !(error instanceof TreasuryPriceSafetyError),
      },
    );
  } catch (error) {
    if (error instanceof TreasuryPriceSafetyError) throw error;
    throw new TreasuryPriceSafetyError(`${asset} oracle is unavailable`, {
      oracle: address,
      attempts: 3,
      message: error instanceof Error ? error.message : String(error),
    }, "asset");
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
  const effectiveLimits = assetLimits(env, signal.symbol.baseAsset);
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
  const positionsForAsset = openPositions.filter(
    (position) => position.asset === signal.symbol.baseAsset,
  );
  return {
    paused: control.paused,
    assetConfigured: assetIsConfigured(env, signal.symbol.baseAsset),
    openPositionsForAsset: positionsForAsset.length,
    maxOpenPositionsPerAsset: effectiveLimits.maxOpenPositions,
    tradeUsd: Number(config.defaultPositionUsd),
    maxPerTradeUsd: Number(effectiveLimits.maxPerTradeUsd),
    totalExposureUsd: openPositions.reduce((sum, position) => sum + numeric(position.cost_quote), 0),
    maxTotalExposureUsd: Number(config.maxTotalExposureUsd),
    assetExposureUsd: positionsForAsset.reduce(
      (sum, position) => sum + numeric(position.cost_quote),
      0,
    ),
    maxAssetExposureUsd: Number(effectiveLimits.maxTotalExposureUsd),
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
    await waitForTreasuryApproval(
      env,
      input.tokenIn,
      account.address,
      calls.approval,
      input.amountIn,
    );
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
    quoteAssetSwap(env, signal.base_asset, quoteAddress, outputAddress, amountIn),
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
    throw new TreasuryEntryDivergenceError(
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
    const actualAssetExact = formatExactTreasuryAssetAmount(execution.amountOut, assetDecimals);
    const actualAsset = numeric(actualAssetExact);
    const actualPrice = costQuote / actualAsset;
    const actualDivergenceBps = calculatePriceDivergenceBps(oracle.price, actualPrice);
    const { data: updated, error: updateError } = await getSupabase(env)
      .from("treasury_quant_positions")
      .update({
        route: execution.quote.protocol,
        // Preserve the exact onchain token amount. Converting an 18-decimal
        // balance through a JavaScript number can round it above the wallet
        // balance and make the eventual exit fail by a few wei.
        amount_asset: actualAssetExact,
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
      await addAudit(env, "position_price_unsafe", {
        phase: "entry",
        message: `Entry execution diverged ${actualDivergenceBps} bps from the oracle`,
        oraclePrice: oracle.price,
        executablePrice: actualPrice,
        divergenceBps: actualDivergenceBps,
        maxPriceDivergenceBps: config.maxPriceDivergenceBps,
        route: execution.quote.protocol,
        blockNumber: oracle.blockNumber,
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
    const status = error instanceof TreasuryEntryDivergenceError ? "rejected" : "failed";
    await rejectSignal(env, signal, message, status);
    return { status, reason: message };
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
  oracleSnapshot?: OracleSnapshot,
): Promise<PositionMarketSnapshot> {
  const asset = assetAddress(env, position.asset);
  const quoteToken = position.quote_token as Stablecoin;
  const quoteAddress = getTokenAddress(env, quoteToken);
  const decimals = await tokenDecimals(env, asset);
  const amountIn = parseStoredUnits(position.amount_asset, decimals);
  const [oracle, quote] = await Promise.all([
    oracleSnapshot ?? readOraclePrice(env, position.asset),
    quoteAssetSwap(env, position.asset, asset, quoteAddress, amountIn),
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
  const oracleReads = new Map<TreasuryAsset, Promise<OracleSnapshot>>();
  const auditedOracleErrors = new Set<TreasuryAsset>();
  const readCycleOracle = (asset: TreasuryAsset) => {
    const existing = oracleReads.get(asset);
    if (existing) return existing;
    const pending = readOraclePrice(env, asset);
    oracleReads.set(asset, pending);
    return pending;
  };
  for (const raw of data ?? []) {
    const position = raw as TreasuryPositionRow;
    try {
      const oracle = await readCycleOracle(position.asset);
      const market = await currentPositionMarket(env, position, oracle);
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
      const maxPriceDivergenceBps = quantConfig(env).maxPriceDivergenceBps;
      const priceSafety = getTreasuryPriceSafetyTransition({
        previousDivergenceBps: position.price_divergence_bps,
        currentDivergenceBps: market.divergenceBps,
        maxDivergenceBps: maxPriceDivergenceBps,
      });
      if (priceSafety.unsafe) {
        await getSupabase(env)
          .from("treasury_quant_positions")
          .update(marketFields)
          .eq("id", position.id);
        const message =
          `Executable price diverges ${market.divergenceBps} bps from the oracle`;
        if (priceSafety.transition === "unsafe") {
          await addAudit(env, "position_price_unsafe", {
            phase: "monitor",
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
          status: "price_unsafe",
          reason: message,
          oraclePrice: market.oracle.price,
          executablePrice: market.executablePrice,
          divergenceBps: market.divergenceBps,
        });
        continue;
      }
      if (priceSafety.transition === "recovered") {
        await addAudit(env, "position_price_recovered", {
          previousDivergenceBps: numeric(position.price_divergence_bps),
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
      const reason = getTreasuryCloseReason({
        currentPrice: market.oracle.price,
        slPrice: numeric(position.sl_price),
        tpPrice: numeric(position.tp_price),
        closeRequested: Boolean(position.close_requested_at),
        closeRequestedReason: position.close_reason,
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
      const globallyScoped = priceSafetyError && positionError.scope === "global";
      const control = globallyScoped ? await getControl(env) : null;
      if (position.mode === "live" && globallyScoped && !control?.paused) {
        await setTreasuryPause(env, true, message);
      }
      const shouldAudit = !priceSafetyError
        || globallyScoped
        || !auditedOracleErrors.has(position.asset);
      if (shouldAudit) {
        await addAudit(env, "position_monitor_error", {
          message,
          details: priceSafetyError ? positionError.details : undefined,
          scope: priceSafetyError ? positionError.scope : undefined,
          asset: position.asset,
        }, {
          signalId: position.signal_id,
          positionId: position.id,
        });
        if (priceSafetyError && !globallyScoped) auditedOracleErrors.add(position.asset);
      }
      results.push({ id: position.id, status: "error", reason: message });
    }
  }
  return results;
}

export async function recoverStaleClosingTreasuryPositions(env: Env) {
  if (!quantEnabled(env)) return [];
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from("treasury_quant_positions")
    .select("*")
    .eq("status", "closing")
    .order("opened_at", { ascending: true });
  if (error) throw new Error(error.message);

  const recovered = [];
  for (const rawPosition of data ?? []) {
    const position = rawPosition as TreasuryPositionRow;
    const { data: executions, error: executionError } = await supabase
      .from("treasury_quant_executions")
      .select("action,status,amount_out,tx_hash,created_at")
      .eq("position_id", position.id)
      .order("created_at", { ascending: false });
    if (executionError) throw new Error(executionError.message);

    const executionRows = (executions ?? []) as Array<{
      action: string;
      status: string;
      amount_out: string | number;
      tx_hash: string | null;
      created_at: string;
    }>;
    const submittedExits = executionRows.filter(
      (execution) => execution.action === "exit"
        && execution.status === "submitted"
        && execution.tx_hash,
    );
    if (submittedExits.length > 0) {
      const { publicClient } = createChainClients(env);
      for (const execution of submittedExits) {
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: execution.tx_hash as Hex,
          });
          if (receipt.status !== "reverted") continue;
          const failure = "Exit transaction reverted onchain";
          const { error: executionUpdateError } = await supabase
            .from("treasury_quant_executions")
            .update({ status: "failed", error: failure })
            .eq("tx_hash", execution.tx_hash)
            .eq("status", "submitted");
          if (executionUpdateError) throw new Error(executionUpdateError.message);
          execution.status = "failed";
          await addAudit(env, "position_exit_reverted", {
            txHash: execution.tx_hash,
            blockNumber: receipt.blockNumber.toString(),
          }, {
            signalId: position.signal_id,
            positionId: position.id,
          });
        } catch {
          // A missing receipt or temporary RPC failure is ambiguous. Keep the
          // position in closing so the worker can never submit a second exit.
        }
      }
    }
    if (getClosingPositionRecoveryAction(executionRows) === "hold") {
      recovered.push({ id: position.id, status: "awaiting_exit_receipt" });
      continue;
    }

    const confirmedEntry = executionRows.find(
      (execution) => execution.action === "entry" && execution.status === "confirmed",
    );
    let amountAsset = position.amount_asset;
    if (confirmedEntry) {
      const decimals = await tokenDecimals(env, assetAddress(env, position.asset));
      amountAsset = formatExactTreasuryAssetAmount(
        parseDatabaseInteger(confirmedEntry.amount_out),
        decimals,
      );
    }

    const { data: reopened, error: reopenError } = await supabase
      .from("treasury_quant_positions")
      .update({
        status: "open",
        amount_asset: amountAsset,
      })
      .eq("id", position.id)
      .eq("status", "closing")
      .select("id")
      .maybeSingle();
    if (reopenError) throw new Error(reopenError.message);
    if (!reopened) continue;

    await addAudit(env, "position_closing_recovered", {
      previousAmountAsset: position.amount_asset,
      recoveredAmountAsset: amountAsset,
      closeReason: position.close_reason,
      closeRequestedAt: position.close_requested_at,
    }, {
      signalId: position.signal_id,
      positionId: position.id,
    });
    recovered.push({ id: position.id, status: "reopened", amountAsset });
  }
  return recovered;
}

function oraclePauseAsset(reason: string | null): TreasuryAsset | null {
  if (!reason) return null;
  const match = /^(CELO|XAUT0|WETH|WBTC|EURM) oracle (?:is unavailable|is not configured|price is stale|returned )/.exec(reason);
  return TREASURY_ASSETS.includes(match?.[1] as TreasuryAsset)
    ? match?.[1] as TreasuryAsset
    : null;
}

async function recoverLegacyOraclePause(env: Env) {
  const control = await getControl(env);
  if (!control.paused) return null;
  const asset = oraclePauseAsset(control.reason);
  if (!asset) return null;
  try {
    const oracle = await readOraclePrice(env, asset);
    await setTreasuryPause(env, false);
    await addAudit(env, "oracle_pause_recovered", {
      asset,
      previousReason: control.reason,
      oraclePrice: oracle.price,
      oracleUpdatedAt: oracle.updatedAt,
      blockNumber: oracle.blockNumber,
    });
    return { asset, oraclePrice: oracle.price, oracleUpdatedAt: oracle.updatedAt };
  } catch {
    return null;
  }
}

async function recoverLegacyDivergencePause(env: Env) {
  const control = await getControl(env);
  if (!control.paused || !isLegacyTreasuryDivergencePause(control.reason)) return null;
  await setTreasuryPause(env, false);
  await addAudit(env, "price_divergence_pause_recovered", {
    previousReason: control.reason,
  });
  return { previousReason: control.reason };
}

export async function runTreasuryWorkerCycle(env: Env) {
  const recovered = await recoverStaleTreasurySignals(env);
  const closingRecovery = await recoverStaleClosingTreasuryPositions(env);
  const divergenceRecovery = await recoverLegacyDivergencePause(env);
  const oracleRecovery = await recoverLegacyOraclePause(env);
  const signal = await processNextTreasurySignal(env);
  const positions = await monitorTreasuryPositions(env);
  return {
    recovered,
    closingRecovery,
    divergenceRecovery,
    oracleRecovery,
    signal,
    positions,
  };
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
  const [control, signals, recentPositions, openPositionResult] = await Promise.all([
    getControl(env),
    listTreasurySignals(env, 10),
    listTreasuryPositions(env, 20),
    getSupabase(env)
      .from("treasury_quant_positions")
      .select("*")
      .in("status", ["open", "closing"])
      .order("opened_at", { ascending: true }),
  ]);
  if (openPositionResult.error) {
    throw new ApiError(500, "INTERNAL_ERROR", openPositionResult.error.message);
  }
  const openPositionRows = (openPositionResult.data ?? []) as TreasuryPositionRow[];
  const openPositions = openPositionRows.map(serializePosition);
  const openIds = new Set(openPositions.map((position) => position.id));
  const positions = [
    ...openPositions,
    ...recentPositions.filter((position) => !openIds.has(position.id)),
  ];
  const address = executorAddress(env);
  const balances: Partial<Record<Stablecoin | TreasuryAsset, string>> = {};
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
    for (const asset of TREASURY_ASSETS) {
      try {
        if (!assetIsConfigured(env, asset)) continue;
        const token = assetAddress(env, asset);
        const decimals = await tokenDecimals(env, token);
        balances[asset] = formatUnits(await tokenBalance(env, token, address), decimals);
      } catch {
        balances[asset] = "unavailable";
      }
    }
  }
  const effectiveByAsset = Object.fromEntries(
    TREASURY_ASSETS.map((asset) => [
      asset,
      {
        ...assetLimits(env, asset),
        operational: assetIsConfigured(env, asset),
      },
    ]),
  );
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
      XAUT0: {
        enabled: assetIsConfigured(env, "XAUT0"),
        oracleConfigured: Boolean(
          env.TREASURY_XAUT0_ORACLE_ADDRESS
          ?? (env.CHAIN_ID === 42220 ? DEFAULT_XAUT0_ORACLE_ADDRESS : undefined),
        ),
        symbol: "XAUt0",
      },
      WETH: {
        enabled: assetIsConfigured(env, "WETH"),
        oracleConfigured: Boolean(assetIsConfigured(env, "WETH")),
        symbol: "ETH",
      },
      WBTC: {
        enabled: assetIsConfigured(env, "WBTC"),
        oracleConfigured: Boolean(assetIsConfigured(env, "WBTC")),
        symbol: "BTC",
      },
      EURM: {
        enabled: assetIsConfigured(env, "EURM"),
        oracleConfigured: Boolean(assetIsConfigured(env, "EURM")),
        symbol: "EURm",
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
      xaut0OracleMaxAgeSeconds: config.xaut0OracleMaxAgeSeconds,
      wethOracleMaxAgeSeconds: config.wethOracleMaxAgeSeconds,
      wbtcOracleMaxAgeSeconds: config.wbtcOracleMaxAgeSeconds,
      eurmOracleMaxAgeSeconds: config.eurmOracleMaxAgeSeconds,
      effectiveByAsset,
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

export async function requestAllTreasuryPositionsClose(env: Env) {
  const { data, error } = await getSupabase(env).rpc("request_treasury_close_all");
  if (error || !data) {
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Close-all request failed");
  }
  const result = data as {
    paused: boolean;
    requested: number;
    openPositions: number;
    positionIds: string[];
    requestedAt: string;
  };
  await addAudit(env, "all_positions_close_requested", {
    requested: result.requested,
    openPositions: result.openPositions,
    positionIds: result.positionIds,
    requestedAt: result.requestedAt,
  });
  return result;
}
