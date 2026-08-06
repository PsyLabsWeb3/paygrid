import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseUnits } from "viem";
import {
  calculateRouterFee,
  hasRipioAssetNetwork,
  isValidMexicanClabe,
  mapRipioEventStatus,
  shouldAdvanceRipioStatus,
  verifyRipioWebhookSignature,
} from "../lib/ripio.js";

test("validates Mexican CLABE without retaining it", () => {
  assert.equal(isValidMexicanClabe("032180000118359719"), true);
  assert.equal(isValidMexicanClabe("032180000118359718"), false);
  assert.equal(isValidMexicanClabe("123"), false);
});

test("verifies Ripio sha256 webhook signatures exactly", () => {
  const secret = "test-secret";
  const raw = JSON.stringify({ eventType: "ON-RAMP.DEPOSIT.RECEIVED", payload: { amount: "100.00" } });
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyRipioWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyRipioWebhookSignature(`${raw} `, signature, secret), false);
  assert.equal(verifyRipioWebhookSignature(raw, undefined, secret), false);
});

test("calculates one-bp fee with 18-decimal precision", () => {
  const gross = parseUnits("100", 18);
  const { fee, net } = calculateRouterFee(gross, 1n);
  assert.equal(fee, parseUnits("0.01", 18));
  assert.equal(net, parseUnits("99.99", 18));
  assert.equal(fee + net, gross);
});

test("matches Ripio's nested network and asset response", () => {
  const address = "0x1111111111111111111111111111111111111111";
  const response = [{ network_name: "CELO", assets: [{ name: "wMXN", contract_address: address }] }];
  assert.equal(hasRipioAssetNetwork(response, "CELO", "wMXN", address), true);
  assert.equal(hasRipioAssetNetwork(response, "CELO", "wMXN", "0x2222222222222222222222222222222222222222"), false);
});

test("maps webhook stages and rejects duplicate or out-of-order progress", () => {
  assert.equal(mapRipioEventStatus("ON-RAMP.WITHDRAWAL.COMPLETED"), "READY_FOR_RELEASE");
  assert.equal(mapRipioEventStatus("OFF-RAMP.WITHDRAWAL.COMPLETED"), "COMPLETED");
  assert.equal(shouldAdvanceRipioStatus("WAITING_SPEI", "TRADE_COMPLETED"), true);
  assert.equal(shouldAdvanceRipioStatus("TRADE_COMPLETED", "MXN_RECEIVED"), false);
  assert.equal(shouldAdvanceRipioStatus("READY_FOR_RELEASE", "READY_FOR_RELEASE"), false);
  assert.equal(shouldAdvanceRipioStatus("COMPLETED", "FAILED"), false);
});
