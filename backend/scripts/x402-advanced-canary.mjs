// Operator-only mainnet checks. Default mode is read-only; --execute opts in.
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const NETWORK = "eip155:42220";
export const RESOURCE = "https://api.celopaygrid.xyz/api/x402/data";
export const PAYER = "0xFB44350f335A823244C1C59948BcC838f81AFA34";
export const PAY_TO = "0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6";
export const profiles = {
  concurrency: { token: "USDC", asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", amount: "100000", key: "paygrid-mainnet-20261127-first-race-USDC-v1" },
  recovery: { token: "USDT", asset: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", amount: "100000", key: "paygrid-mainnet-20261127-worker-recovery-USDT-v1" },
};
const equal = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const hash = value => createHash("sha256").update(value).digest("hex");
export const requestFor = mode => ({ url: RESOURCE, method: "GET", preferredToken: profiles[mode].token });
export function newIntent(mode) {
  const p = profiles[mode];
  if (!p) throw new Error("INVALID_MODE");
  return { version: 1, mode, network: NETWORK, request: requestFor(mode), idempotencyKey: p.key,
    payer: PAYER, payTo: PAY_TO, asset: p.asset, amountAtomic: p.amount, createdAt: new Date().toISOString() };
}
export function validateIntent(record, mode) {
  const expected = newIntent(mode);
  for (const field of ["version", "mode", "network", "idempotencyKey", "payer", "payTo", "asset", "amountAtomic"])
    if (record?.[field] !== expected[field]) throw new Error("INTENT_CHANGED");
  if (JSON.stringify(record.request) !== JSON.stringify(expected.request)) throw new Error("INTENT_CHANGED");
}
export function readIntent(file, mode) {
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, "utf8"));
  validateIntent(record, mode);
  return record;
}
function atomicWrite(file, record, exclusive = false) {
  const temporary = exclusive ? file : file + "." + randomUUID() + ".tmp";
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(record, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (!exclusive) renameSync(temporary, file);
  const directory = openSync(dirname(file), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
export function ensureIntent(file, mode) {
  const existing = readIntent(file, mode);
  if (existing) return existing;
  try { atomicWrite(file, newIntent(mode), true); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  return readIntent(file, mode);
}
export function patchIntent(file, mode, patch) {
  const record = readIntent(file, mode);
  if (!record) throw new Error("INTENT_MISSING");
  if ((record.operationId && patch.operationId && record.operationId !== patch.operationId) ||
      (record.txHash && patch.txHash && record.txHash !== patch.txHash)) throw new Error("RECEIPT_CHANGED");
  const updated = { ...record, ...patch };
  validateIntent(updated, mode);
  atomicWrite(file, updated);
  return updated;
}
export function validateSettled(operation, mode, intent = {}) {
  const profile = profiles[mode], p = operation?.payment;
  if (!operation || !/^[0-9a-f-]{36}$/i.test(operation.operationId ?? "") ||
      operation.state !== "settled" || operation.paid !== true || operation.error || operation.resultExpired ||
      operation.result?.httpStatus !== 200 || !p || p.network !== NETWORK || p.token !== profile.token ||
      !equal(p.asset, profile.asset) || p.amountAtomic !== profile.amount || !equal(p.payer, PAYER) ||
      !equal(p.payTo, PAY_TO) || !/^0x[0-9a-f]{64}$/i.test(p.txHash ?? "") ||
      (intent.operationId && intent.operationId !== operation.operationId) ||
      (intent.txHash && intent.txHash !== p.txHash)) throw new Error("SETTLEMENT_CHANGED_OR_UNAVAILABLE");
}
export async function raceRequests({ intent, send, status, save }) {
  validateIntent(intent, "concurrency");
  const firstAttempt = !intent.attemptStartedAt && !intent.operationId;
  save({ attemptStartedAt: intent.attemptStartedAt ?? new Date().toISOString() });
  const replies = await Promise.allSettled(["api", "api", "api", "mcp", "mcp", "mcp"].map(async (client, index) => {
    const op = await send(client, intent.request, intent.idempotencyKey);
    if (!/^[0-9a-f-]{36}$/i.test(op?.operationId ?? "")) throw new Error("INVALID_OPERATION");
    save({ operationId: op.operationId }); // Bind even a pending response before further work.
    return { client, index, state: op.state, operationId: op.operationId };
  }));
  if (replies.some(r => r.status === "rejected")) throw new Error("CONCURRENT_REQUEST_FAILED_PRESERVE_INTENT");
  const results = replies.map(r => r.value);
  if (new Set(results.map(r => r.operationId)).size !== 1) throw new Error("MULTIPLE_OPERATIONS");
  const latest = save({ operationId: results[0].operationId, responses: results });
  const operation = await status(latest.operationId);
  validateSettled(operation, "concurrency", latest);
  save({ operationId: operation.operationId, txHash: operation.payment.txHash, completed: true });
  return { ok: true, mode: "first-operation-concurrency", token: "USDC", clients: 6,
    apiClients: 3, mcpClients: 3, firstAttempt, operationId: operation.operationId, txHash: operation.payment.txHash,
    initialStates: results.map(r => r.state) };
}
export function fixedTerms(requirement, mode) {
  const p = profiles[mode];
  if (requirement?.network !== NETWORK || requirement.scheme !== "exact" ||
      !equal(requirement.asset, p.asset) || requirement.amount !== p.amount || !equal(requirement.payTo, PAY_TO))
    throw new Error("CANARY_TERMS_CHANGED");
}
export function recoverySend({ send, find, save, decodeReceipt, interrupt }) {
  return async (request, headers = {}) => {
    const response = await send(request, headers);
    if (!headers["PAYMENT-SIGNATURE"]) return response;
    if (response.status !== 200 || !response.headers.get("payment-response")) throw new Error("UNCONFIRMED_SETTLEMENT");
    const receipt = decodeReceipt(response.headers.get("payment-response"));
    if (!receipt.success || receipt.network !== NETWORK || !equal(receipt.payer, PAYER) ||
        !/^0x[0-9a-f]{64}$/i.test(receipt.transaction ?? "")) throw new Error("RECEIPT_CHANGED");
    const op = await find();
    fixedTerms(op?.requirements, "recovery");
    if (op?.state !== "pending" || op.phase !== "submitted" || !op.reserved || op.receipt || !op.ciphertext || !op.authorization_hash)
      throw new Error("UNEXPECTED_CRASH_POINT");
    save({ operationId: op.id, txHash: receipt.transaction, authorizationHash: op.authorization_hash,
      ciphertextSha256: hash(op.ciphertext), previousLeaseOwner: op.lease_owner,
      leaseUntil: op.lease_until, interruptedAt: new Date().toISOString(), interruptedAfterSettlement: true });
    await response.body?.cancel();
    interrupt({ event: "intentional_payer_process_interruption", network: NETWORK, token: "USDT",
      operationId: op.id, txHash: receipt.transaction, expectedExitCode: 75, leaseUntil: op.lease_until });
    throw new Error("INTERRUPTION_DID_NOT_EXIT");
  };
}
export function recoveredStatus(op, intent, publicOp) {
  validateIntent(intent, "recovery");
  if (op?.id !== intent.operationId) throw new Error("OPERATION_CHANGED");
  if (op.state !== "settled" || op.phase !== "complete" || op.reserved || op.error)
    return { ok: false, mode: "worker-recovery-status", operationId: op.id, state: op.state, phase: op.phase, reserved: op.reserved, leaseUntil: op.lease_until };
  validateSettled(publicOp, "recovery", intent);
  if (!intent.interruptedAfterSettlement || op.authorization_hash !== intent.authorizationHash ||
      hash(op.ciphertext ?? "") !== intent.ciphertextSha256 || op.lease_owner === intent.previousLeaseOwner)
    throw new Error("RECOVERY_PROOF_CHANGED");
  return { ok: true, mode: "worker-recovery", token: "USDT", operationId: op.id,
    txHash: op.receipt.transaction, authorizationUnchanged: true, ciphertextUnchanged: true, reserved: false };
}

async function main() {
  const args = process.argv.slice(2), modeArg = args.find(a => a.startsWith("--mode="));
  const mode = modeArg?.slice(7), execute = args.includes("--execute");
  if (!profiles[mode] || args.some(a => a !== modeArg && a !== "--execute")) throw new Error("INVALID_ARGUMENTS");
  const profile = profiles[mode], file = `/evidence/x402-advanced-${mode}-42220.json`;
  const old = readIntent(file, mode);
  if (mode === "concurrency") {
    for (const p of [".env", ".env.x402"]) { try { process.loadEnvFile(p); } catch (e) { if (e.code !== "ENOENT") throw e; } }
    const { loadConfig } = await import(pathToFileURL(resolve("src/config.js")).href);
    const cfg = loadConfig();
    if (!cfg.mcpApiKey || !cfg.x402ExecutorKey || cfg.publicBaseUrl !== "https://mcp.celopaygrid.xyz" ||
        !["http://backend:3001", "https://api.celopaygrid.xyz"].includes(cfg.backendUrl)) throw new Error("INVALID_EXECUTOR_CONFIGURATION");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const client = new Client({ name: "paygrid-first-operation-race", version: "1" });
    const direct = async (path, init = {}) => {
      const r = await fetch(new URL(path, cfg.backendUrl), { ...init, redirect: "error", signal: AbortSignal.timeout(120000),
        headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.x402ExecutorKey}`, ...init.headers } });
      if (!r.ok) throw new Error("EXECUTOR_REJECTED"); return r.json();
    };
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(cfg.publicBaseUrl + "/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${cfg.mcpApiKey}` } } }));
      const tool = async (name, arguments_) => {
        const r = await client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 180000 });
        if (r.isError) throw new Error("MCP_REJECTED"); return JSON.parse(r.content[0].text);
      };
      const cap = await tool("get_x402_capabilities", {});
      if (!cap.ready || !cap.payerEnabled || !cap.sellerEnabled || !cap.sellerRestricted || cap.network !== NETWORK || cap.resource !== RESOURCE ||
          cap.assets.find(a => a.token === profile.token)?.priceAtomic !== profile.amount) throw new Error("CANARY_NOT_READY");
      // Authenticate both paths using an existing, already paid operation before dispatching.
      const baselineId = "c75a2120-03fa-4bb2-933d-20afdeb3879c";
      validateSettled(await direct(`/api/x402/payments/${baselineId}`), mode, { operationId: baselineId });
      validateSettled(await tool("get_x402_payment_status", { operationId: baselineId }), mode, { operationId: baselineId });
      if (!execute) { console.log(JSON.stringify({ ok: true, mode: "check-only", test: mode, token: profile.token, maxNewPaymentAtomic: profile.amount, existingIntent: !!old })); return; }
      const intent = ensureIntent(file, mode);
      if (intent.completed) {
        validateSettled(await direct(`/api/x402/payments/${intent.operationId}`), mode, intent);
        console.log(JSON.stringify({ ok: true, mode: "already-completed", test: mode, operationId: intent.operationId, txHash: intent.txHash })); return;
      }
      const report = await raceRequests({ intent, save: patch => patchIntent(file, mode, patch),
        send: (kind, request, key) => kind === "api"
          ? direct("/api/x402/pay", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(request) })
          : tool("pay_x402_endpoint", { ...request, idempotencyKey: key }),
        status: id => direct(`/api/x402/payments/${id}`) });
      console.log(JSON.stringify(report));
    } finally { await client.close(); }
  } else {
    const { loadEnv } = await import(pathToFileURL(resolve("dist/config/env.js")).href);
    const { getPayments } = await import(pathToFileURL(resolve("dist/x402/runtime.js")).href);
    const { publicOperation } = await import(pathToFileURL(resolve("dist/x402/service.js")).href);
    const { decodePaymentResponseHeader } = await import("@x402/core/http");
    const p = getPayments(loadEnv());
    if (p.cfg.network !== NETWORK || !p.cfg.payer || !p.cfg.seller || !equal(p.cfg.payerAddress, PAYER) ||
        !equal(p.cfg.payTo, PAY_TO) || p.cfg.publicApiUrl !== "https://api.celopaygrid.xyz" ||
        p.cfg.sellerAllowedPayers.length !== 1 || !equal(p.cfg.sellerAllowedPayers[0], PAYER)) throw new Error("CANARY_NOT_READY");
    await p.ready();
    const lookup = () => p.store.find(`out:${NETWORK}:${profile.key}`);
    const current = await lookup();
    if (current) {
      if (!old) throw new Error("EXISTING_OPERATION_NEEDS_ITS_ORIGINAL_EVIDENCE");
      const report = recoveredStatus(current, old, publicOperation(current));
      console.log(JSON.stringify(report)); if (!report.ok) process.exitCode = 2; return;
    }
    if (!execute) { console.log(JSON.stringify({ ok: true, mode: "check-only", test: mode, token: profile.token, maxNewPaymentAtomic: profile.amount, existingIntent: !!old })); return; }
    const intent = ensureIntent(file, mode), sign = p.protocol.sign.bind(p.protocol), send = p.transport.send.bind(p.transport);
    p.protocol.sign = (required, selected) => { fixedTerms(selected, mode); return sign(required, selected); };
    p.transport.send = recoverySend({ send, find: lookup, save: patch => patchIntent(file, mode, patch), decodeReceipt: decodePaymentResponseHeader,
      interrupt: event => { console.log(JSON.stringify(event)); process.exit(75); } });
    await p.pay(intent.request, intent.idempotencyKey);
    throw new Error("INTERRUPTION_NOT_REACHED_PRESERVE_INTENT");
  }
}
if (process.argv[1] === "-" || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  try { await main(); }
  catch (error) {
    const code = /^[A-Z][A-Z0-9_]{3,90}$/.test(error?.message ?? "") ? error.message : "ADVANCED_CANARY_STOPPED_PRESERVE_EVIDENCE";
    console.error(JSON.stringify({ ok: false, error: code, note: "Do not delete evidence or change its idempotency key." })); process.exitCode = 1;
  }
}
