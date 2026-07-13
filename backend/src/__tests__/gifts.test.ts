import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGasSafety,
  cleanGiftText,
  feeAmountForSixDecimalToken,
  hashGiftSecret,
  parseStoredGiftAmount,
  roundUp,
  selectClaimFeeSource,
} from "../services/gifts.js";

test("gift text removes control characters and normalizes whitespace", () => {
  assert.equal(cleanGiftText("  Happy\n\tbirthday\u0000 Ana  ", 240), "Happy birthday Ana");
});

test("gift claim hashes are deterministic without storing the secret", () => {
  const secret = "correct-horse-battery-staple";
  const hash = hashGiftSecret(secret);
  assert.match(hash, /^0x[a-f0-9]{64}$/);
  assert.equal(hash, hashGiftSecret(secret));
  assert.ok(!hash.includes(secret));
});

test("gift amounts accept numeric values returned by Supabase", () => {
  assert.equal(parseStoredGiftAmount(1, "USDC"), 1_000_000n);
  assert.equal(parseStoredGiftAmount("1.25", "USDm"), 1_250_000_000_000_000_000n);
});

test("sponsored fee calculation applies safety and rounds up to one micro USDm", () => {
  const estimatedGas = 200_000n;
  const safeGas = applyGasSafety(estimatedGas, 2500);
  assert.equal(safeGas, 250_000n);
  assert.equal(roundUp(1_000_000_000_000_001n, 1_000_000_000_000n), 1_001_000_000_000_000n);
});

test("fee abstraction converts 18-decimal fee units to six-decimal token units conservatively", () => {
  assert.equal(feeAmountForSixDecimalToken(1_000_000_000_000n), 1n);
  assert.equal(feeAmountForSixDecimalToken(1_000_000_000_001n), 2n);
});

test("claim fee selection prefers CELO, then stablecoin adapters, then sponsorship", () => {
  const empty = { USDm: 0n, USDC: 0n, USDT: 0n };
  const requirements = { USDm: 5n, USDC: 2n, USDT: 2n };
  assert.equal(selectClaimFeeSource({
    nativeBalance: 10n,
    nativeRequired: 10n,
    stablecoinBalances: empty,
    stablecoinRequirements: requirements,
  }), "native");
  assert.equal(selectClaimFeeSource({
    nativeBalance: 0n,
    nativeRequired: 10n,
    stablecoinBalances: { ...empty, USDC: 2n },
    stablecoinRequirements: requirements,
  }), "USDC");
  assert.equal(selectClaimFeeSource({
    nativeBalance: 0n,
    nativeRequired: 10n,
    stablecoinBalances: empty,
    stablecoinRequirements: requirements,
  }), "sponsor");
});

test("stablecoin dust blocks sponsorship when it cannot cover the fee", () => {
  assert.equal(selectClaimFeeSource({
    nativeBalance: 0n,
    nativeRequired: 10n,
    stablecoinBalances: { USDm: 1n, USDC: 0n, USDT: 0n },
    stablecoinRequirements: { USDm: 5n },
  }), "deposit");
});
