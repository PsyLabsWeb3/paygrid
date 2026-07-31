import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAvailableUnits,
  isMiniPayWithdrawalAsset,
  normalizeFundAmount,
  requiresPositionReconciliation,
} from "../lib/treasury-funds.js";

test("treasury fund amounts enforce positive values and token precision", () => {
  assert.equal(normalizeFundAmount("90.4523", 6), "90.4523");
  assert.equal(normalizeFundAmount(" 1.25 ", 18), "1.25");
  assert.throws(() => normalizeFundAmount("0", 6));
  assert.throws(() => normalizeFundAmount("1.0000001", 6));
  assert.throws(() => normalizeFundAmount("-1", 6));
});

test("available balance preserves positions and the network-fee reserve", () => {
  assert.equal(calculateAvailableUnits(1_000n, 700n, 50n), 250n);
  assert.equal(calculateAvailableUnits(100n, 100n, 50n), 0n);
});

test("only an evacuation reconciles reserved positions", () => {
  assert.equal(requiresPositionReconciliation("free", 10n), false);
  assert.equal(requiresPositionReconciliation("evacuate", 0n), false);
  assert.equal(requiresPositionReconciliation("evacuate", 10n), true);
});

test("MiniPay destinations are restricted to supported stablecoins", () => {
  assert.equal(isMiniPayWithdrawalAsset("USDT"), true);
  assert.equal(isMiniPayWithdrawalAsset("USDC"), true);
  assert.equal(isMiniPayWithdrawalAsset("USDm"), true);
  assert.equal(isMiniPayWithdrawalAsset("CELO"), false);
  assert.equal(isMiniPayWithdrawalAsset("WETH"), false);
});
