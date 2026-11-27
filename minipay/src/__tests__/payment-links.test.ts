import assert from "node:assert/strict";
import test from "node:test";
import { availableLinkTokens, isValidLinkAmount, linkPayerTokens, linkPaymentMethods } from "../lib/payment-links";
import { paymentTokens, tokenAddresses, tokenDecimals } from "../lib/tokens";

test("wMXN links accept exact wallet payments without dollar conversion or fiat", () => {
  assert.deepEqual(linkPaymentMethods("wMXN"), ["crypto"]);
  assert.deepEqual(linkPayerTokens("wMXN"), ["wMXN"]);
  assert.deepEqual(linkPayerTokens("wMXN", ["USDC", "wMXN"]), ["wMXN"]);
  assert.deepEqual(linkPayerTokens("wMXN", ["USDC"]), []);
  assert.deepEqual(linkPayerTokens("USDC"), ["USDC", "USDT", "USDm"]);
  assert.deepEqual(linkPayerTokens("USDC", ["USDC"]), ["USDC"]);
});

test("wMXN creation requires backend readiness on Celo mainnet", () => {
  const config = { chainId: 42220, tokens: [...paymentTokens, "wMXN" as const] };
  assert.ok(availableLinkTokens(config, 42220).includes("wMXN"));
  assert.deepEqual(availableLinkTokens(config, 11142220), []);
  assert.ok(!availableLinkTokens({ ...config, chainId: 11142220 }, 11142220).includes("wMXN"));
  assert.ok(!availableLinkTokens(undefined, 42220).includes("wMXN"));
  assert.ok(!availableLinkTokens({ ...config, tokens: paymentTokens }, 42220).includes("wMXN"));
});

test("link amounts preserve 18 decimal pesos and reject rounding, zero, exponent and storage overflow", () => {
  assert.equal(isValidLinkAmount("9.230000000000000001", "wMXN"), true);
  assert.equal(isValidLinkAmount("0.000000000000000001", "wMXN"), true);
  assert.equal(isValidLinkAmount("999999999999999999.999999999999999999", "wMXN"), true);
  for (const value of ["0", "0.000000000000000000", "1.0000000000000000001", "1000000000000000000", "1e2", "-1", "1,23", "Infinity"])
    assert.equal(isValidLinkAmount(value, "wMXN"), false, value);
  assert.equal(isValidLinkAmount("0.000001", "USDC"), true);
  assert.equal(isValidLinkAmount("0.0000001", "USDC"), false);
});

test("gifts and treasury retain their existing dollar asset set", () => {
  assert.deepEqual(paymentTokens, ["USDC", "USDT", "USDm"]);
  assert.equal(tokenDecimals.wMXN, 18);
  assert.equal(tokenAddresses.wMXN, "0x337E7456B420bD3481e7FA61fA9850343d610d34");
});
