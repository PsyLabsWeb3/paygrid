import {
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "./config.js";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const requestedTokens = process.env.X402_CANARY_TOKENS?.split(",").map((t) =>
  t.trim(),
);
if (
  requestedTokens &&
  (!requestedTokens.length ||
    requestedTokens.some((t) => !["USDC", "USDT", "wMXN"].includes(t)))
)
  throw new Error("X402_CANARY_TOKENS contains an unsupported asset");
const config = loadConfig();
if (!config.mcpApiKey) throw new Error("PAYGRID_MCP_API_KEY is required");
const client = new Client({ name: "paygrid-x402-canary", version: "1" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(config.publicBaseUrl + "/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${config.mcpApiKey}` } },
  }),
);
try {
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 180_000,
    });
    if (result.isError)
      throw new Error(
        "Canary tool rejected the operation; preserve its saved idempotency key",
      );
    return JSON.parse(result.content[0].text);
  };
  const capabilities = await call("get_x402_capabilities");
  if (
    !capabilities.ready ||
    !capabilities.sellerEnabled ||
    !capabilities.payerEnabled
  )
    throw new Error("x402 has not passed readiness");
  if (capabilities.network !== `eip155:${config.chainId}`)
    throw new Error("MCP and backend networks differ");
  if (
    requestedTokens?.some(
      (t) => !capabilities.assets.some((a) => a.token === t),
    )
  )
    throw new Error("Requested canary token is not enabled on this network");
  const assets = capabilities.assets.filter(
    (a) => !requestedTokens || requestedTokens.includes(a.token),
  );
  const file =
    process.env.X402_CANARY_EVIDENCE ??
    resolve(
      process.env.X402_CANARY_EVIDENCE_DIR ?? ".",
      `x402-canary-evidence-mcp-${config.chainId}.json`,
    );
  const evidence = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : [];
  if (
    evidence.some(
      (e) =>
        e.network !== capabilities.network ||
        e.resource !== capabilities.resource,
    )
  )
    throw new Error(
      "Canary evidence belongs to another network or resource, or needs operator migration. Preserve its keys.",
    );
  const save = () => {
    const temporary = file + "." + randomUUID() + ".tmp";
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(evidence, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
    const directory = openSync(dirname(file), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  };
  for (const asset of assets) {
    let entry = evidence.find((e) => e.token === asset.token);
    if (!entry) {
      entry = {
        token: asset.token,
        network: capabilities.network,
        resource: capabilities.resource,
        idempotencyKey: randomUUID(),
      };
      evidence.push(entry);
      save();
    }
    const args = {
      url: capabilities.resource,
      preferredToken: asset.token,
      idempotencyKey: entry.idempotencyKey,
    };
    const operation = await call("pay_x402_endpoint", args);
    if (
      (entry.operationId && entry.operationId !== operation.operationId) ||
      (entry.txHash && entry.txHash !== operation.payment?.txHash)
    )
      throw new Error(
        "Saved canary evidence changed; preserve its idempotency key",
      );
    Object.assign(entry, {
      operationId: operation.operationId,
      state: operation.state,
      txHash: operation.payment?.txHash,
    });
    save();
    console.log(JSON.stringify({ token: entry.token, ...operation }));
    if (
      operation.state === "settled" &&
      operation.paid &&
      (operation.payment?.network !== capabilities.network ||
        operation.payment?.asset?.toLowerCase() !==
          asset.address.toLowerCase() ||
        operation.payment?.amountAtomic !== asset.priceAtomic)
    )
      throw new Error(
        "Confirmed canary receipt differs from advertised asset or price",
      );
    if (operation.state !== "settled" || !operation.paid)
      throw new Error(
        "Reconcile the saved operation before continuing the canary",
      );
    if (
      !operation.result ||
      operation.resultExpired ||
      operation.result.httpStatus !== 200
    )
      throw new Error(
        "Canary paid but its resource is unavailable; preserve the operation",
      );
    const replay = await call("pay_x402_endpoint", args);
    if (
      replay.state !== "settled" ||
      !replay.paid ||
      replay.operationId !== operation.operationId ||
      replay.payment?.txHash !== operation.payment?.txHash
    )
      throw new Error("Replay changed the payment");
    entry.replayChecked = true;
    save();
  }
  console.log(
    JSON.stringify({
      ok: true,
      network: capabilities.network,
      tokens: assets.map((a) => a.token),
      evidence: file,
    }),
  );
} finally {
  await client.close();
}
