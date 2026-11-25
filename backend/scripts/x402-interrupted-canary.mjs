import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Operator-only fault injection: exit after a confirmed response, before the canary
// records it. Run again with the same evidence to prove recovery without another payment.
const chainId = process.env.CHAIN_ID ?? "11142220";
const evidence =
  process.env.X402_CANARY_EVIDENCE ??
  (process.env.X402_CANARY_EVIDENCE_DIR
    ? resolve(
        process.env.X402_CANARY_EVIDENCE_DIR,
        `x402-canary-evidence-${chainId}.json`,
      )
    : undefined);
if (!evidence)
  throw new Error(
    "Set persistent X402_CANARY_EVIDENCE or X402_CANARY_EVIDENCE_DIR",
  );
const ledgerPath = evidence + ".interruptions.json";
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, "utf8"))
  : {};
const expectedNetwork = `eip155:${chainId}`;
const executor = new URL(
  process.env.X402_CANARY_EXECUTOR_URL ?? "http://127.0.0.1:3001",
);
const nativeFetch = globalThis.fetch;
function save() {
  mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const temporary = ledgerPath + "." + randomUUID() + ".tmp";
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(ledger, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, ledgerPath);
  const directory = openSync(dirname(ledgerPath), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (
    url.origin !== executor.origin ||
    url.pathname !== "/api/x402/pay" ||
    init?.method !== "POST"
  )
    return nativeFetch(input, init);
  const request = JSON.parse(String(init.body));
  const key = new Headers(init.headers).get("idempotency-key");
  if (!key || !["USDC", "USDT", "wMXN"].includes(request.preferredToken))
    throw new Error(
      "Interrupted canary needs a token and stable idempotency key",
    );
  const entries = JSON.parse(readFileSync(evidence, "utf8"));
  const entry = entries.find((e) => e.token === request.preferredToken);
  if (
    !entry ||
    entry.idempotencyKey !== key ||
    entry.network !== expectedNetwork ||
    entry.resource !== request.url
  )
    throw new Error("Canary must persist this exact intent before sending");
  const group = expectedNetwork + ":" + request.preferredToken;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        method: init.method,
        url: url.href,
        body: init.body,
        key,
      }),
    )
    .digest("hex");
  let record = ledger[group];
  if (record && record.requestHash !== requestHash)
    throw new Error(
      "Interrupted canary intent changed; preserve the original evidence",
    );
  if (!record) {
    record = ledger[group] = { requestHash };
    save(); // Bind the intent before any network submission.
  }
  const response = await nativeFetch(input, init);
  if (!response.ok) return response;
  const body = await response.clone().json();
  if (body.state !== "settled" || !body.paid) return response;
  if (
    body.payment?.network !== expectedNetwork ||
    body.payment?.token !== request.preferredToken ||
    !/^0x[0-9a-f]{64}$/i.test(body.payment?.txHash ?? "") ||
    !body.operationId
  )
    throw new Error(
      "Interrupted canary receipt does not match the intended payment",
    );
  if (
    record.txHash &&
    (record.txHash !== body.payment.txHash ||
      record.operationId !== body.operationId)
  )
    throw new Error("Interrupted canary receipt changed");
  Object.assign(record, {
    operationId: body.operationId,
    txHash: body.payment.txHash,
  });
  const alreadyAcknowledged =
    entry.state === "settled" && entry.txHash === body.payment.txHash;
  if (!record.interrupted && !alreadyAcknowledged) {
    record.interrupted = true;
    save();
    console.log(
      JSON.stringify({
        event: "intentional_canary_interruption",
        network: expectedNetwork,
        token: request.preferredToken,
        operationId: record.operationId,
        txHash: record.txHash,
        expectedExitCode: 75,
        next: "Run the same command again; preserve its evidence and idempotency key",
      }),
    );
    process.exit(75);
  }
  save();
  return response;
};
await import(
  pathToFileURL(
    resolve(process.env.X402_CANARY_ENTRYPOINT ?? "dist/x402-canary.js"),
  ).href
);
