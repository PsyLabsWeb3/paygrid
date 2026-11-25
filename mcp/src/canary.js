import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "./config.js";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
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
  const file =
    process.env.X402_CANARY_EVIDENCE ??
    `x402-canary-evidence-mcp-${config.chainId}.json`;
  const evidence = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : [];
  const save = () =>
    writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n", {
      mode: 0o600,
    });
  for (const asset of capabilities.assets) {
    let entry = evidence.find((e) => e.token === asset.token);
    if (!entry) {
      entry = { token: asset.token, idempotencyKey: randomUUID() };
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
    if (operation.state !== "settled" || !operation.paid)
      throw new Error(
        "Reconcile the saved operation before continuing the canary",
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
  console.log(JSON.stringify({ ok: true, evidence: file }));
} finally {
  await client.close();
}
