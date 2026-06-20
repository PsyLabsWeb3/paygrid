import http from "node:http";
import { loadConfig, isWriteAuthorized } from "./config.js";
import { handleRpc } from "./rpc.js";
import { createAgentSigner } from "./paygrid-client.js";

const config = loadConfig();

function publicAgentMetadata() {
  const signer = createAgentSigner(config);
  const address = config.agentAddress || signer?.address || null;
  return {
    type: "Agent",
    name: config.agentName,
    description:
      "Paygrid is agent spend infrastructure on Celo, exposing programmable stablecoin payment requests, payment verification, card-funded checkout preparation, and x402-ready commerce tools through MCP.",
    agentId: config.agentId || null,
    address,
    chainId: config.chainId,
    apiEndpoint: config.publicApiUrl,
    mcpEndpoint: `${config.publicBaseUrl}/mcp`,
    healthEndpoint: `${config.publicBaseUrl}/health`,
    endpoints: [
      { type: "mcp", url: `${config.publicBaseUrl}/mcp` },
      { type: "api", url: config.publicApiUrl },
      { type: "health", url: `${config.publicBaseUrl}/health` },
      ...(address ? [{ type: "wallet", address, chainId: config.chainId }] : []),
    ],
    capabilities: [
      "create_payment_request",
      "verify_payment",
      "list_agent_requests",
      "create_card_checkout",
      "pay_x402_endpoint",
      "get_supported_stablecoins",
      "get_agent_capabilities",
      "get_agent_connection_guide",
      "get_celo_defi_context",
      "treasury_report",
    ],
    supportedTrust: ["erc8004", "x402"],
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization,x-api-key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "paygrid-mcp", chainId: config.chainId }));
    return;
  }

  if (
    req.method === "GET" &&
    (req.url === "/metadata" || req.url === "/.well-known/paygrid-agent.json")
  ) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(publicAgentMetadata()));
    return;
  }

  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const body = await readBody(req);
    const message = JSON.parse(body);
    const result = await handleRpc(config, message, {
      remote: true,
      writeAuthorized: isWriteAuthorized(config, req.headers),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
  }
});

server.listen(config.httpPort, "0.0.0.0", () => {
  console.log(`Paygrid MCP HTTP listening on http://0.0.0.0:${config.httpPort}`);
});
