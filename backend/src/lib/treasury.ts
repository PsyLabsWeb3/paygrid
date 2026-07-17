import { z } from "zod";

const positiveDecimal = z
  .union([z.string(), z.number().finite()])
  .transform(String)
  .pipe(z.string().regex(/^\d+(\.\d+)?$/))
  .refine((value) => Number(value) > 0);

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
      baseAsset: z.enum(["CELO", "ORO"]),
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
    const expectedSymbol = `${signal.symbol.baseAsset}${signal.symbol.quoteAsset}`.toUpperCase();
    if (signal.symbol.code.toUpperCase() !== expectedSymbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["symbol", "code"],
        message: `symbol.code must be ${expectedSymbol}`,
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
  if (snapshot.dailyLossUsd >= snapshot.dailyLossLimitUsd) {
    return { ok: false as const, reason: "Daily loss limit reached" };
  }
  return { ok: true as const };
}

export type TreasuryCloseReason = "manual" | "stop_loss" | "take_profit";

export function getTreasuryCloseReason(input: {
  currentPrice: number;
  slPrice: number;
  tpPrice: number;
  closeRequested: boolean;
}): TreasuryCloseReason | null {
  if (input.closeRequested) return "manual";
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
