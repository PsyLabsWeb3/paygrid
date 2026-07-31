export const TREASURY_FUND_ASSETS = [
  "USDC",
  "USDT",
  "USDm",
  "CELO",
  "XAUT0",
  "WETH",
  "WBTC",
  "EURM",
] as const;

export type TreasuryFundAsset = typeof TREASURY_FUND_ASSETS[number];
export type TreasuryWithdrawalMode = "free" | "evacuate";

export const KNOWN_TREASURY_ASSET_DECIMALS: Partial<Record<TreasuryFundAsset, number>> = {
  USDC: 6,
  USDT: 6,
  USDm: 18,
  CELO: 18,
};

export function normalizeFundAmount(value: string, decimals: number) {
  const amount = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || BigInt(match[1] + (match[2] ?? "")) <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  if ((match[2]?.length ?? 0) > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }
  return amount;
}

export function calculateAvailableUnits(balance: bigint, reserved: bigint, gasReserve: bigint) {
  const unavailable = reserved + gasReserve;
  return balance > unavailable ? balance - unavailable : 0n;
}

export function requiresPositionReconciliation(mode: TreasuryWithdrawalMode, reserved: bigint) {
  return mode === "evacuate" && reserved > 0n;
}

export function isMiniPayWithdrawalAsset(asset: TreasuryFundAsset) {
  return asset === "USDC" || asset === "USDT" || asset === "USDm";
}
