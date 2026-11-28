import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateEvidence, auditReplays } from "../x402-replay-check.js";

function fixture() {
  const expected = ["USDC", "USDT", "wMXN"].map((token, index) => ({
    token, operationId: `existing-operation-${index}`, txHash: `0x${String(index + 1).repeat(64)}`,
    keySha256: createHash("sha256").update(`existing-client-key-${index}`).digest("hex"),
  }));
  const entries = expected.map((proof, index) => ({
    ...proof, idempotencyKey: `existing-client-key-${index}`, network: "eip155:42220",
    resource: "https://api.celopaygrid.xyz/api/x402/data", state: "settled", replayChecked: true,
  }));
  const operation = token => {
    const proof = expected.find(p => p.token === token);
    return {
      operationId: proof.operationId, state: "settled", paid: true, result: { httpStatus: 200 }, resultExpired: false,
      payment: { network: "eip155:42220", token, txHash: proof.txHash,
        asset: { USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", wMXN: "0x337E7456B420bD3481e7FA61fA9850343d610d34" }[token],
        amountAtomic: token === "wMXN" ? "2000000000000000000" : "100000",
        payer: "0xFB44350f335A823244C1C59948BcC838f81AFA34", payTo: "0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6" },
    };
  };
  return { expected, entries, operation };
}

test("only validated existing evidence starts clients, bounded to three in parallel", async () => {
  const f = fixture(); let active = 0, peak = 0, calls = 0;
  const original = JSON.stringify(f.entries);
  const reports = await auditReplays({ ...f, runClient: async token => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return f.operation(token);
  }});
  assert.equal(calls, 9); assert.equal(peak, 3); assert.equal(reports.length, 3);
  assert.equal(JSON.stringify(f.entries), original);
});
for (const [field, value] of Object.entries({
  idempotencyKey: "replacement-client-key", operationId: "replacement-operation", txHash: `0x${"f".repeat(64)}`,
  network: "eip155:11142220", resource: "https://other.example/api/x402/data", state: "pending", replayChecked: false,
})) {
  test(`changed ${field} aborts before starting any client`, async () => {
    const f = fixture(); f.entries[2][field] = value; let calls = 0;
    await assert.rejects(auditReplays({ ...f, runClient: async () => { calls++; } }));
    assert.equal(calls, 0);
  });
}
test("missing, duplicate and malformed evidence are rejected", () => {
  const f = fixture();
  assert.throws(() => validateEvidence({}, f.expected));
  assert.throws(() => validateEvidence(f.entries.slice(1), f.expected));
  assert.throws(() => validateEvidence([...f.entries, f.entries[0]], f.expected));
});
for (const changed of [
  p => { p.operationId = "new-operation"; }, p => { p.payment.txHash = `0x${"f".repeat(64)}`; },
  p => { p.payment.amountAtomic = "200000"; }, p => { p.payment.payTo = p.payment.payer; },
  p => { p.payment.asset = p.payment.payTo; }, p => { p.payment.network = "eip155:11142220"; },
  p => { p.result.httpStatus = 500; }, p => { p.resultExpired = true; }, p => { p.state = "unknown"; },
]) {
  test("changed payment or delivery aborts remaining token groups", async () => {
    const f = fixture(); let calls = 0;
    await assert.rejects(auditReplays({ ...f, runClient: async token => { calls++; const p = f.operation(token); changed(p); return p; } }));
    assert.equal(calls, 3);
  });
}
