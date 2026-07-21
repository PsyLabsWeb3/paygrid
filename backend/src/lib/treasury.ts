import { z } from "zod";

const positiveDecimal = z
  .union([z.string(), z.number().finite()])
  .transform(String)
  .pipe(z.string().regex(/^\d+(\.\d+)?$/))
  .refine((value) => Number(value) > 0);

const treasuryAsset = z.preprocess(
  (value) => (typeof value === "string" ? value.toUpperCase() : value),
  z.enum(["CELO", "XAUT", "XAUT0", "ETH", "WETH", "BTC", "WBTC", "EUR", "EURM", "CEUR"]),
).transform((value) => {
  if (value === "XAUT" || value === "XAUT0") return "XAUT0" as const;
  if (value === "ETH" || value === "WETH") return "WETH" as const;
  if (value === "BTC" || value === "WBTC") return "WBTC" as const;
  if (value === "EUR" || value === "EURM" || value === "CEUR") return "EURM" as const;
  return "CELO" as const;
});

export const tradingViewSignalSchema = z
  .object({
    externalSignalId: z.string().trim().min(1).max(160),
    source: z.literal("tradingview"),
    timeframe: z.string().trim().min(1).max(20),
    side: z.literal("LONG"),
    signalType: z.literal("ENTRY"),
    entryPrice: positiveDecimal,
    slPrice: positiveDecimal,
    tpPrice: positiveDecimal,
    strategy: z.object({
      code: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(300).optional().default(""),
    }),
    symbol: z.object({
      code: z.string().trim().min(1).max(40),
      baseAsset: treasuryAsset,
      quoteAsset: z.enum(["USDC", "USDT", "USDm"]),
    }),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((signal, ctx) => {
    const entry = Number(signal.entryPrice);
    const stop = Number(signal.slPrice);
    const target = Number(signal.tpPrice);
    if (!(stop < entry)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slPrice"],
        message: "slPrice must be below entryPrice for LONG signals",
      });
    }
    if (!(target > entry)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tpPrice"],
        message: "tpPrice must be above entryPrice for LONG signals",
      });
    }
    if (["XAUT0", "WETH", "WBTC", "EURM"].includes(signal.symbol.baseAsset)
      && signal.symbol.quoteAsset !== "USDT") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["symbol", "quoteAsset"],
        message: `${signal.symbol.baseAsset} positions currently require USDT as the quote asset`,
      });
    }
    const aliases = {
      CELO: ["CELO"],
      XAUT0: ["XAUT", "XAUT0"],
      WETH: ["ETH", "WETH"],
      WBTC: ["BTC", "WBTC"],
      EURM: ["EUR", "EURM", "CEUR"],
    } as const;
    const expectedSymbols = aliases[signal.symbol.baseAsset]
      .map((base) => `${base}${signal.symbol.quoteAsset}`);
    if (!expectedSymbols.includes(signal.symbol.code.toUpperCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["symbol", "code"],
        message: `symbol.code must be ${expectedSymbols.join(" or ")}`,
      });
    }
  });

export type TradingViewSignal = z.infer<typeof tradingViewSignalSchema>;

export function parseTradingViewSignal(value: unknown) {
  return tradingViewSignalSchema.parse(value);
}

export type TreasuryRiskSnapshot = {
  paused: boolean;
  assetConfigured: boolean;
  openPositionsForAsset: number;
  maxOpenPositionsPerAsset: number;
  tradeUsd: number;
  maxPerTradeUsd: number;
  totalExposureUsd: number;
  maxTotalExposureUsd: number;
  assetExposureUsd: number;
  maxAssetExposureUsd: number;
  dailyLossUsd: number;
  dailyLossLimitUsd: number;
};

export function evaluateTreasuryRisk(snapshot: TreasuryRiskSnapshot) {
  if (snapshot.paused) return { ok: false as const, reason: "Treasury Quant Agent is paused" };
  if (!snapshot.assetConfigured) return { ok: false as const, reason: "Asset is not configured" };
  if (snapshot.openPositionsForAsset >= snapshot.maxOpenPositionsPerAsset) {
    return { ok: false as const, reason: "Maximum open positions reached for this asset" };
  }
  if (snapshot.tradeUsd <= 0 || snapshot.tradeUsd > snapshot.maxPerTradeUsd) {
    return { ok: false as const, reason: "Position size exceeds the per-trade limit" };
  }
  if (snapshot.totalExposureUsd + snapshot.tradeUsd > snapshot.maxTotalExposureUsd) {
    return { ok: false as const, reason: "Position would exceed total exposure" };
  }
  if (snapshot.assetExposureUsd + snapshot.tradeUsd > snapshot.maxAssetExposureUsd) {
    return { ok: false as const, reason: "Position would exceed asset exposure" };
  }
  if (snapshot.dailyLossUsd >= snapshot.dailyLossLimitUsd) {
    return { ok: false as const, reason: "Daily loss limit reached" };
  }
  return { ok: true as const };
}

export type TreasuryAssetLimitValues = {
  maxPerTradeUsd: string;
  maxTotalExposureUsd: string;
  maxOpenPositions: number;
};

export function resolveTreasuryAssetLimits(
  globalLimits: TreasuryAssetLimitValues,
  overrides: Partial<TreasuryAssetLimitValues>,
): TreasuryAssetLimitValues {
  const boundedDecimal = (override: string | undefined, globalValue: string) => (
    override !== undefined && Number(override) < Number(globalValue) ? override : globalValue
  );
  return {
    maxPerTradeUsd: boundedDecimal(overrides.maxPerTradeUsd, globalLimits.maxPerTradeUsd),
    maxTotalExposureUsd: boundedDecimal(
      overrides.maxTotalExposureUsd,
      globalLimits.maxTotalExposureUsd,
    ),
    maxOpenPositions: Math.min(
      overrides.maxOpenPositions ?? globalLimits.maxOpenPositions,
      globalLimits.maxOpenPositions,
    ),
  };
}

export type TreasuryCloseReason = "manual" | "manual_close_all" | "stop_loss" | "take_profit";

export function getTreasuryCloseReason(input: {
  currentPrice: number;
  slPrice: number;
  tpPrice: number;
  closeRequested: boolean;
  closeRequestedReason?: string | null;
}): TreasuryCloseReason | null {
  if (input.closeRequested) {
    return input.closeRequestedReason === "manual_close_all" ? "manual_close_all" : "manual";
  }
  if (input.currentPrice <= input.slPrice) return "stop_loss";
  if (input.currentPrice >= input.tpPrice) return "take_profit";
  return null;
}

export function calculateEntryDeviationBps(signalPrice: number, executionPrice: number) {
  if (signalPrice <= 0 || executionPrice <= 0) return Number.POSITIVE_INFINITY;
  return Math.round((Math.abs(executionPrice - signalPrice) / signalPrice) * 10_000);
}

export function calculatePriceDivergenceBps(referencePrice: number, executablePrice: number) {
  if (referencePrice <= 0 || executablePrice <= 0) return Number.POSITIVE_INFINITY;
  return Math.round((Math.abs(executablePrice - referencePrice) / referencePrice) * 10_000);
}

export function getTreasuryPriceSafetyTransition(input: {
  previousDivergenceBps: number | null | undefined;
  currentDivergenceBps: number;
  maxDivergenceBps: number;
}) {
  const previouslyUnsafe = Number.isFinite(input.previousDivergenceBps)
    && Number(input.previousDivergenceBps) > input.maxDivergenceBps;
  const unsafe = input.currentDivergenceBps > input.maxDivergenceBps;
  return {
    unsafe,
    transition: unsafe && !previouslyUnsafe
      ? "unsafe" as const
      : !unsafe && previouslyUnsafe
        ? "recovered" as const
        : null,
  };
}

export function isLegacyTreasuryDivergencePause(reason: string | null | undefined) {
  if (!reason) return false;
  return /^(?:Executable price diverges|Entry execution diverged) \d+(?:\.\d+)? bps from the oracle$/.test(
    reason,
  );
}

export function isOraclePriceFresh(input: {
  updatedAtSeconds: number;
  nowSeconds: number;
  maxAgeSeconds: number;
}) {
  if (
    !Number.isFinite(input.updatedAtSeconds)
    || !Number.isFinite(input.nowSeconds)
    || !Number.isFinite(input.maxAgeSeconds)
    || input.updatedAtSeconds <= 0
    || input.maxAgeSeconds <= 0
    || input.updatedAtSeconds > input.nowSeconds
  ) {
    return false;
  }
  return input.nowSeconds - input.updatedAtSeconds <= input.maxAgeSeconds;
}

export async function retryTreasuryOracleRead<T>(
  read: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
) {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 0);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (options.shouldRetry && !options.shouldRetry(error)) throw error;
      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

export function calculatePaperAssetAmount(tradeUsd: number, entryPrice: number) {
  if (tradeUsd <= 0 || entryPrice <= 0) throw new Error("Invalid paper position values");
  return (tradeUsd / entryPrice).toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

export function calculatePositionPnl(input: {
  amountAsset: number;
  costQuote: number;
  currentPrice: number;
}) {
  return input.amountAsset * input.currentPrice - input.costQuote;
}

export function getStaleSignalRecoveryAction(input: {
  hasPosition: boolean;
  hasExecution: boolean;
}) {
  return input.hasPosition || input.hasExecution
    ? "manual_reconciliation" as const
    : "requeue" as const;
}
