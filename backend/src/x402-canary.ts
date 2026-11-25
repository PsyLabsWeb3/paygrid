import {
  writeFileSync,
  existsSync,
  readFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { loadEnv } from "./config/env.js";
import { config } from "./x402/config.js";
// Real-money canary: explicit operator invocation, fixed target and prices only.
const cfg = config(loadEnv());
if (!cfg.seller || !cfg.payer)
  throw new Error("Enable seller and payer only after migration and preflight");
if (!cfg.executorKey) throw new Error("Executor credential missing");
const requestedTokens = process.env.X402_CANARY_TOKENS?.split(",").map((t) =>
  t.trim(),
);
if (
  requestedTokens &&
  (!requestedTokens.length ||
    requestedTokens.some((t) => !cfg.assets.some((a) => a.token === t)))
)
  throw new Error(
    "X402_CANARY_TOKENS must name assets enabled on the configured network",
  );
const assets = cfg.assets.filter(
  (a) => !requestedTokens || requestedTokens.includes(a.token),
);
const resource = cfg.publicApiUrl + "/api/x402/data";
const evidence =
  process.env.X402_CANARY_EVIDENCE ??
  resolve(
    process.env.X402_CANARY_EVIDENCE_DIR ?? ".",
    `x402-canary-evidence-${cfg.chainId}.json`,
  );
type Entry = {
  token: string;
  network: string;
  resource: string;
  idempotencyKey: string;
  operationId?: string;
  state?: string;
  txHash?: string;
  replayChecked?: boolean;
};
const entries: Entry[] = existsSync(evidence)
  ? JSON.parse(readFileSync(evidence, "utf8"))
  : [];
if (entries.some((e) => e.network !== cfg.network || e.resource !== resource))
  throw new Error(
    "Canary evidence is bound to another network or resource, or needs operator migration. Preserve its keys.",
  );
const save = () => {
  const temporary = evidence + "." + randomUUID() + ".tmp";
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(entries, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, evidence);
  const directory = openSync(dirname(evidence), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
};
const api = process.env.X402_CANARY_EXECUTOR_URL ?? "http://127.0.0.1:3001";
const origin = new URL(api);
if (
  origin.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(origin.hostname)
)
  throw new Error("Executor must use TLS or loopback");
for (const asset of assets) {
  let entry = entries.find((e) => e.token === asset.token);
  if (!entry) {
    entry = {
      token: asset.token,
      network: cfg.network,
      resource,
      idempotencyKey: randomUUID(),
    };
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
      url: resource,
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
  if (
    body.state === "settled" &&
    body.paid &&
    (body.payment?.network !== cfg.network ||
      body.payment?.asset?.toLowerCase() !== asset.address.toLowerCase() ||
      body.payment?.amountAtomic !== asset.price ||
      body.payment?.payTo?.toLowerCase() !== cfg.payTo?.toLowerCase())
  )
    throw new Error(
      "Confirmed canary receipt differs from the configured resource price or recipient",
    );
  if (body.state !== "settled" || !body.paid)
    throw new Error(
      "Canary pending or failed. Reconcile and reuse the saved operation; do not create a fresh payment.",
    );
  if (!body.result || body.resultExpired || body.result.httpStatus !== 200)
    throw new Error(
      "Canary paid but the resource is unavailable; preserve its receipt and operation",
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
      url: resource,
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
console.log(
  JSON.stringify({
    ok: true,
    network: cfg.network,
    tokens: assets.map((a) => a.token),
    evidence,
  }),
);
