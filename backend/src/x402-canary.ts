import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadEnv } from "./config/env.js";
import { config } from "./x402/config.js";
// Real-money canary: explicit operator invocation, fixed target and prices only.
const cfg = config(loadEnv());
if (!cfg.seller || !cfg.payer)
  throw new Error("Enable seller and payer only after migration and preflight");
if (!cfg.executorKey) throw new Error("Executor credential missing");
const evidence =
  process.env.X402_CANARY_EVIDENCE ??
  `x402-canary-evidence-${cfg.chainId}.json`;
type Entry = {
  token: string;
  idempotencyKey: string;
  operationId?: string;
  state?: string;
  txHash?: string;
  replayChecked?: boolean;
};
const entries: Entry[] = existsSync(evidence)
  ? JSON.parse(readFileSync(evidence, "utf8"))
  : [];
const save = () =>
  writeFileSync(evidence, JSON.stringify(entries, null, 2) + "\n", {
    mode: 0o600,
  });
const api = process.env.X402_CANARY_EXECUTOR_URL ?? "http://127.0.0.1:3001";
const origin = new URL(api);
if (
  origin.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(origin.hostname)
)
  throw new Error("Executor must use TLS or loopback");
for (const asset of cfg.assets) {
  let entry = entries.find((e) => e.token === asset.token);
  if (!entry) {
    entry = { token: asset.token, idempotencyKey: randomUUID() };
    entries.push(entry);
    save();
  }
  const response = await fetch(new URL("/api/x402/pay", api), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${cfg.executorKey}`,
      "content-type": "application/json",
      "Idempotency-Key": entry.idempotencyKey,
    },
    body: JSON.stringify({
      url: cfg.publicApiUrl + "/api/x402/data",
      method: "GET",
      preferredToken: asset.token,
    }),
  });
  const body = (await response.json()) as any;
  if (!response.ok)
    throw new Error(
      `Canary refused: ${response.status}; inspect configuration without replacing its idempotency key`,
    );
  if (
    (entry.operationId && entry.operationId !== body.operationId) ||
    (entry.txHash && entry.txHash !== body.payment?.txHash)
  )
    throw new Error(
      "Saved canary evidence changed; do not create another payment",
    );
  Object.assign(entry, {
    operationId: body.operationId,
    state: body.state,
    txHash: body.payment?.txHash,
  });
  save();
  console.log(JSON.stringify({ token: entry.token, ...body }));
  if (body.state !== "settled" || !body.paid)
    throw new Error(
      "Canary pending or failed. Reconcile and reuse the saved operation; do not create a fresh payment.",
    );
  const replay = await fetch(new URL("/api/x402/pay", api), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${cfg.executorKey}`,
      "content-type": "application/json",
      "Idempotency-Key": entry.idempotencyKey,
    },
    body: JSON.stringify({
      url: cfg.publicApiUrl + "/api/x402/data",
      method: "GET",
      preferredToken: asset.token,
    }),
  });
  const repeated = (await replay.json()) as any;
  if (
    !replay.ok ||
    repeated.state !== "settled" ||
    !repeated.paid ||
    repeated.operationId !== body.operationId ||
    repeated.payment?.txHash !== body.payment?.txHash
  )
    throw new Error("Replay mismatch");
  entry.replayChecked = true;
  save();
}
console.log(JSON.stringify({ ok: true, network: cfg.network, evidence }));
