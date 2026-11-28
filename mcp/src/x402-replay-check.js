// Operator-only audit of already settled canaries. This never creates keys.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const network = "eip155:42220";
const resource = "https://api.celopaygrid.xyz/api/x402/data";
const payer = "0xFB44350f335A823244C1C59948BcC838f81AFA34";
const payTo = "0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6";
const assets = {
  USDC: ["0xcebA9300f2b948710d2653dD7B07f33A8B32118C", "100000"],
  USDT: ["0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", "100000"],
  wMXN: ["0x337E7456B420bD3481e7FA61fA9850343d610d34", "2000000000000000000"],
};
// Public receipt IDs and SHA-256 fingerprints, verified against the ledger.
// These fingerprints deliberately cannot replace the original private keys.
export const expectedCanaries = [
  { token: "USDC", operationId: "c75a2120-03fa-4bb2-933d-20afdeb3879c", txHash: "0xf5008e8349bd5ddc5d8aea67e1cf7edd009c6b97161fd48a68428ade0132783d", keySha256: "a8304aa97d48cf16efa88226b14f9f965dd02bc464c87df4304e93fbd0089869" },
  { token: "USDT", operationId: "9274499f-6e24-42ad-b0b3-6a2f2fa95235", txHash: "0x70a25a04862bf5b22e385c489d0b2ae0394a64360d1eb9bfdf4d7bdd2181296b", keySha256: "ed1fca01839aeca7d066fc06df96d085cffc29989f0d0cf5ffb8d1d11770cb7c" },
  { token: "wMXN", operationId: "f0abaed8-2ddc-4e79-b2d2-04b158ad49bf", txHash: "0xe95ffc81e7f1dc65ea2a60ea59f6fc892ddff961f7db1b52e1adecb988d9fb85", keySha256: "1364f0f066267a0db158274ca7744c3a063b71db053b7898752e2f2bb2f420dc" },
];

export function validateEvidence(entries, expected = expectedCanaries) {
  if (!Array.isArray(entries)) throw new Error("INVALID_REPLAY_EVIDENCE");
  for (const proof of expected) {
    const matches = entries.filter(entry => entry?.token === proof.token);
    if (matches.length !== 1) throw new Error("MISSING_OR_DUPLICATED_REPLAY_EVIDENCE");
    const entry = matches[0];
    if (entry.network !== network || entry.resource !== resource ||
        entry.state !== "settled" || entry.replayChecked !== true ||
        entry.operationId !== proof.operationId || entry.txHash !== proof.txHash ||
        typeof entry.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(entry.idempotencyKey) ||
        createHash("sha256").update(entry.idempotencyKey).digest("hex") !== proof.keySha256)
      throw new Error("REPLAY_EVIDENCE_MISMATCH");
  }
}

export async function auditReplays({ entries, runClient, expected = expectedCanaries, onReport = () => {} }) {
  // Validate every token before starting even one client.
  validateEvidence(entries, expected);
  const reports = [];
  for (const proof of expected) {
    const clients = await Promise.all(Array.from({ length: 3 }, () => runClient(proof.token)));
    for (const operation of clients) {
      const payment = operation?.payment;
      if (operation?.operationId !== proof.operationId || operation.state !== "settled" ||
          operation.paid !== true || operation.result?.httpStatus !== 200 ||
          operation.resultExpired || operation.error || payment?.txHash !== proof.txHash ||
          payment.network !== network || payment.token !== proof.token ||
          payment.asset?.toLowerCase() !== assets[proof.token][0].toLowerCase() ||
          payment.amountAtomic !== assets[proof.token][1] ||
          payment.payer?.toLowerCase() !== payer.toLowerCase() ||
          payment.payTo?.toLowerCase() !== payTo.toLowerCase())
        throw new Error("REPLAY_RESPONSE_CHANGED");
    }
    const report = { ok: true, token: proof.token, parallelClients: 3, operationId: proof.operationId, txHash: proof.txHash };
    reports.push(report);
    onReport(report);
  }
  return reports;
}

function runExistingClient(token, file) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, ["src/canary.js"], {
      env: { ...process.env, X402_CANARY_TOKENS: token, X402_CANARY_EVIDENCE: file },
      stdio: ["ignore", "pipe", "pipe"], timeout: 90_000,
    });
    let output = "";
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) {
        child.kill("SIGTERM");
        reject(new Error("REPLAY_OUTPUT_TOO_LARGE"));
      }
    });
    child.stderr.resume(); // Never print client diagnostics containing credentials.
    child.once("error", () => reject(new Error("REPLAY_CLIENT_FAILED")));
    child.once("close", code => {
      if (code !== 0) return reject(new Error("REPLAY_CLIENT_FAILED"));
      try {
        const rows = output.trim().split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
        if (!rows.some(row => row.ok === true && row.network === network &&
            row.tokens?.length === 1 && row.tokens[0] === token && row.evidence === file))
          throw new Error("REPLAY_SUMMARY_MISSING");
        accept(rows.find(row => row.token === token && row.operationId));
      } catch { reject(new Error("REPLAY_CLIENT_RESULT_INVALID")); }
    });
  });
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== "--execute")) throw new Error("UNKNOWN_REPLAY_ARGUMENT");
  const file = "/evidence/x402-canary-evidence-mcp-42220.json";
  const entries = JSON.parse(readFileSync(file, "utf8"));
  validateEvidence(entries);
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ ok: true, mode: "check-only", network, existingCanaries: 3 }));
    return;
  }
  await auditReplays({ entries, runClient: token => runExistingClient(token, file), onReport: report => console.log(JSON.stringify(report)) });
  validateEvidence(JSON.parse(readFileSync(file, "utf8")));
  console.log(JSON.stringify({ ok: true, mode: "settled-operation-replay", network, parallelClientsPerToken: 3, successfulClients: 9 }));
}
if (process.argv[1] === "-" || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  try { await main(); }
  catch { console.error(JSON.stringify({ ok: false, error: "Replay audit failed; preserve all original evidence. No fresh keys were created by this checker." })); process.exitCode = 1; }
}
