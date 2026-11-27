import assert from "node:assert/strict";
import test from "node:test";
import { formatHumanAmount, parseHumanAmount } from "../lib/tokens.js";

test("parseHumanAmount preserves token decimals", () => {
  assert.equal(parseHumanAmount("10", "USDC"), 10_000_000n);
  assert.equal(parseHumanAmount("10.5", "USDC"), 10_500_000n);
  assert.equal(parseHumanAmount(0.01, "USDC"), 10_000n);
  assert.equal(parseHumanAmount("1.000000000000000001", "USDm"), 1_000_000_000_000_000_001n);
});

test("formatHumanAmount trims trailing zeros", () => {
  assert.equal(formatHumanAmount(10_500_000n, "USDC"), "10.5");
  assert.equal(formatHumanAmount(1_000_000_000_000_000_000n, "USDm"), "1");
});


test("wMXN is parsed exactly and excess decimal places are rejected before signing", () => {
  assert.equal(parseHumanAmount("9.230000000000000001", "wMXN"), 9230000000000000001n);
  assert.throws(() => parseHumanAmount("1.0000000000000000001", "wMXN"));
  assert.throws(() => parseHumanAmount("1.0000001", "USDC"));
});
