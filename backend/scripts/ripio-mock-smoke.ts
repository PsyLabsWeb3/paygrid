import assert from "node:assert/strict";
import { formatUnits, parseUnits } from "viem";
import type { RipioCanaryStatus } from "../src/db/supabase.js";
import { calculateRouterFee, mapRipioEventStatus, shouldAdvanceRipioStatus } from "../src/lib/ripio.js";

const runId = "00000000-0000-4000-8000-000000000001";
const transactionId = "00000000-0000-4000-8000-000000000002";
const gross = parseUnits("100", 18);
const { fee, net } = calculateRouterFee(gross, 1n);
let routerBalance = gross;
let status: RipioCanaryStatus = "WAITING_SPEI";
const seen = new Set<string>();

const providerEvents = [
  "ON-RAMP.DEPOSIT.RECEIVED",
  "ON-RAMP.DEPOSIT.RECEIVED", // provider retry
  "ON-RAMP.TRADE.COMPLETED",
  "ON-RAMP.DEPOSIT.RECEIVED", // late event
  "ON-RAMP.WITHDRAWAL.PROCESSING",
  "ON-RAMP.WITHDRAWAL.COMPLETED",
] as const;

for (const eventType of providerEvents) {
  const fingerprint = `${eventType}:${transactionId}`;
  if (seen.has(fingerprint)) continue;
  seen.add(fingerprint);
  const next = mapRipioEventStatus(eventType);
  if (next && shouldAdvanceRipioStatus(status, next)) status = next;
}

assert.equal(status, "READY_FOR_RELEASE");
assert.equal(routerBalance, gross);
assert.equal(fee, parseUnits("0.01", 18));
assert.equal(net, parseUnits("99.99", 18));

// Equivalent accounting outcome of the owner-only payWithFiat settlement.
routerBalance -= fee + net;
status = "RELEASED";

for (const eventType of [
  "OFF-RAMP.DEPOSIT.RECEIVED",
  "OFF-RAMP.TRADE.COMPLETED",
  "OFF-RAMP.WITHDRAWAL.PROCESSING",
  "OFF-RAMP.WITHDRAWAL.COMPLETED",
] as const) {
  const next = mapRipioEventStatus(eventType);
  if (next && shouldAdvanceRipioStatus(status, next)) status = next;
}

assert.equal(status, "COMPLETED");
assert.equal(routerBalance, 0n);

console.log(JSON.stringify({
  ok: true,
  runId,
  finalStatus: status,
  gross: formatUnits(gross, 18),
  feeBps: 1,
  fee: formatUnits(fee, 18),
  net: formatUnits(net, 18),
  routerBalance: formatUnits(routerBalance, 18),
  duplicateEventsIgnored: providerEvents.length - seen.size,
}, null, 2));
