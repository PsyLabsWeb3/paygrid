import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  NETWORK, RESOURCE, PAYER, PAY_TO, profiles, newIntent, validateIntent, ensureIntent,
  patchIntent, raceRequests, validateSettled, recoverySend, recoveredStatus,
} from '../x402-advanced-canary.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const tx = '0x' + 'ab'.repeat(32);
const digest = value => createHash('sha256').update(value).digest('hex');
const terms = mode => ({ scheme: 'exact', network: NETWORK, asset: profiles[mode].asset,
  amount: profiles[mode].amount, payTo: PAY_TO });
function settled(mode) {
  return { operationId: id, state: 'settled', paid: true, error: null, resultExpired: false,
    result: { httpStatus: 200 }, payment: { network: NETWORK, token: profiles[mode].token,
      asset: profiles[mode].asset, amountAtomic: profiles[mode].amount, payer: PAYER, payTo: PAY_TO, txHash: tx } };
}
function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'paygrid-advanced-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'evidence.json');
}
function inMemory(mode) {
  let record = newIntent(mode);
  return { read: () => record, save: patch => (record = { ...record, ...patch }) };
}
function pending() {
  return { id, state: 'pending', phase: 'submitted', reserved: true, receipt: null,
    ciphertext: 'private-encrypted-authorization', authorization_hash: 'auth-digest',
    requirements: terms('recovery'), lease_owner: 'old-owner', lease_until: '2026-11-28T02:03:00Z' };
}
const receipt = { success: true, network: NETWORK, payer: PAYER, transaction: tx };

for (const mode of ['concurrency', 'recovery']) {
  test(`${mode}: durable intent survives retry and uses the same key even if the file is lost`, t => {
    const file = folder(t), before = ensureIntent(file, mode);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(ensureIntent(file, mode), before);
    patchIntent(file, mode, { operationId: id, txHash: tx });
    assert.throws(() => patchIntent(file, mode, { operationId: 'another-operation' }), /RECEIPT_CHANGED/);
    assert.throws(() => patchIntent(file, mode, { txHash: 'another-transaction' }), /RECEIPT_CHANGED/);
    assert.equal(JSON.parse(readFileSync(file)).operationId, id);
    rmSync(file);
    assert.equal(ensureIntent(file, mode).idempotencyKey, before.idempotencyKey);
  });
  test(`${mode}: tampered authorization scope is rejected without replacing the file`, t => {
    const file = folder(t), original = newIntent(mode);
    for (const field of ['network', 'payer', 'payTo', 'asset', 'amountAtomic', 'idempotencyKey']) {
      const changed = { ...original, [field]: 'changed' };
      writeFileSync(file, JSON.stringify(changed));
      assert.throws(() => ensureIntent(file, mode), /INTENT_CHANGED/);
      assert.deepEqual(JSON.parse(readFileSync(file)), changed);
    }
    assert.throws(() => validateIntent({ ...original, request: { ...original.request, url: RESOURCE + '/elsewhere' } }, mode), /INTENT_CHANGED/);
  });
}
test('six concurrent first requests use one intent across API and MCP and retain the confirmed result', async () => {
  const state = inMemory('concurrency');
  let calls = [], release;
  const gate = new Promise(resolve => { release = resolve; });
  const report = await raceRequests({ intent: state.read(), save: state.save,
    send: async (client, request, key) => {
      calls.push({ client, request, key });
      if (calls.length === 6) release();
      await gate;
      return { operationId: id, state: calls[0].client === client ? 'pending' : 'settled' };
    }, status: async operationId => { assert.equal(operationId, id); return settled('concurrency'); } });
  assert.equal(report.firstAttempt, true);
  assert.equal(report.clients, 6);
  assert.equal(calls.filter(c => c.client === 'api').length, 3);
  assert.equal(calls.filter(c => c.client === 'mcp').length, 3);
  assert.ok(calls.every(c => c.key === profiles.concurrency.key && c.request.url === RESOURCE));
  assert.equal(state.read().txHash, tx);
  assert.equal(state.read().completed, true);
  assert.ok(state.read().attemptStartedAt);
});
test('resumed concurrency check cannot claim to be the first attempt', async () => {
  const state = inMemory('concurrency');
  state.save({ attemptStartedAt: '2026-11-28T01:00:00Z', operationId: id });
  const report = await raceRequests({ intent: state.read(), save: state.save,
    send: async () => settled('concurrency'), status: async () => settled('concurrency') });
  assert.equal(report.firstAttempt, false);
});
test('one failed concurrent client preserves the bound operation and does not dispatch a replacement intent', async () => {
  const state = inMemory('concurrency');
  let calls = 0;
  await assert.rejects(() => raceRequests({ intent: state.read(), save: state.save,
    send: async () => { if (++calls === 6) throw new Error('response lost'); return { operationId: id, state: 'pending' }; },
    status: async () => { throw new Error('must not reach'); } }), /PRESERVE_INTENT/);
  assert.equal(calls, 6);
  assert.equal(state.read().operationId, id);
  assert.equal(state.read().idempotencyKey, profiles.concurrency.key);
  assert.equal(state.read().completed, undefined);
});
test('settlement evidence rejects wrong assets, amounts, recipients, networks and unavailable results', () => {
  for (const patch of [{ network: 'eip155:1' }, { asset: profiles.recovery.asset },
    { amountAtomic: '100001' }, { payTo: PAYER }, { payer: PAY_TO }, { txHash: 'invalid' }]) {
    const op = settled('concurrency'); Object.assign(op.payment, patch);
    assert.throws(() => validateSettled(op, 'concurrency'), /SETTLEMENT_CHANGED/);
  }
  for (const patch of [{ state: 'unknown' }, { paid: false }, { resultExpired: true }, { result: { httpStatus: 502 } }])
    assert.throws(() => validateSettled({ ...settled('concurrency'), ...patch }, 'concurrency'), /SETTLEMENT_CHANGED/);
  assert.throws(() => validateSettled(settled('concurrency'), 'concurrency', { txHash: 'another' }), /SETTLEMENT_CHANGED/);
});
test('unpaid challenge passes through without an interruption or new evidence', async () => {
  const response = new Response(null, { status: 402 });
  const forbidden = () => { throw new Error('must not reach'); };
  const send = recoverySend({ send: async () => response, find: forbidden, save: forbidden, decodeReceipt: forbidden, interrupt: forbidden });
  assert.equal(await send({ url: RESOURCE }), response);
});
test('process exits only after settlement with signed data durable and the outgoing reservation still held', async () => {
  const state = inMemory('recovery'), op = pending(), stopped = new Error('injected exit 75');
  let report;
  const send = recoverySend({ send: async () => new Response('paid-result', { headers: { 'payment-response': 'encoded-test-receipt' } }),
    find: async () => op, save: state.save, decodeReceipt: () => receipt,
    interrupt: value => { report = value; throw stopped; } });
  await assert.rejects(() => send({ url: RESOURCE }, { 'PAYMENT-SIGNATURE': 'secret-signed-payment' }), error => error === stopped);
  assert.equal(report.expectedExitCode, 75);
  assert.equal(state.read().operationId, id);
  assert.equal(state.read().txHash, tx);
  assert.equal(state.read().ciphertextSha256, digest(op.ciphertext));
  assert.equal(state.read().interruptedAfterSettlement, true);
  const output = JSON.stringify({ report, evidence: state.read() });
  for (const secret of ['secret-signed-payment', 'encoded-test-receipt', op.ciphertext]) assert.ok(!output.includes(secret));
});
test('unexpected receipt or crash point cannot be reported as a successful interruption', async () => {
  const cases = [
    { receipt: { ...receipt, success: false } }, { receipt: { ...receipt, payer: PAY_TO } },
    { op: { ...pending(), state: 'settled' } }, { op: { ...pending(), phase: 'signed' } },
    { op: { ...pending(), reserved: false } }, { op: { ...pending(), receipt } },
    { op: { ...pending(), requirements: { ...terms('recovery'), amount: '200000' } } },
  ];
  for (const c of cases) {
    let saved = false, interrupted = false;
    const send = recoverySend({ send: async () => new Response(null, { headers: { 'payment-response': 'encoded' } }),
      find: async () => c.op ?? pending(), decodeReceipt: () => c.receipt ?? receipt,
      save: () => { saved = true; }, interrupt: () => { interrupted = true; } });
    await assert.rejects(() => send({}, { 'PAYMENT-SIGNATURE': 'signed' }));
    assert.equal(saved, false); assert.equal(interrupted, false);
  }
});
test('worker recovery requires the same transaction and signed ciphertext, a new owner, and released reservation', () => {
  const before = pending(), intent = { ...newIntent('recovery'), operationId: id, txHash: tx,
    interruptedAfterSettlement: true, authorizationHash: before.authorization_hash,
    ciphertextSha256: digest(before.ciphertext), previousLeaseOwner: before.lease_owner };
  assert.equal(recoveredStatus(before, intent, null).ok, false);
  const after = { ...before, state: 'settled', phase: 'complete', reserved: false, lease_owner: 'worker-owner', receipt };
  const report = recoveredStatus(after, intent, settled('recovery'));
  assert.equal(report.ok, true); assert.equal(report.authorizationUnchanged, true);
  assert.equal(report.ciphertextUnchanged, true);
  for (const patch of [{ ciphertext: 'new-signature' }, { authorization_hash: 'new-authorization' }, { lease_owner: 'old-owner' }])
    assert.throws(() => recoveredStatus({ ...after, ...patch }, intent, settled('recovery')), /RECOVERY_PROOF_CHANGED/);
  const changed = settled('recovery'); changed.payment.txHash = '0x' + 'cd'.repeat(32);
  assert.throws(() => recoveredStatus(after, intent, changed), /SETTLEMENT_CHANGED/);
});
