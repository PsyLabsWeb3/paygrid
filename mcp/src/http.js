import http from "node:http";
import { loadConfig, isWriteAuthorized } from "./config.js";
import { handleRpc } from "./rpc.js";
import { createAgentSigner } from "./paygrid-client.js";

const config = loadConfig();

function publicAgentMetadata() {
  const signer = createAgentSigner(config);
  const address = config.agentAddress || signer?.address || null;
  const agentId = config.agentId || null;
  const chainId = config.chainId;
  const chainRef = `eip155:${chainId}`;
  const publicBaseUrl = config.publicBaseUrl;
  const mcpEndpoint = `${publicBaseUrl}/mcp`;
  const healthEndpoint = `${publicBaseUrl}/health`;
  const metadataEndpoint = `${publicBaseUrl}/.well-known/paygrid-agent.json`;
  const appUrl = "https://celopaygrid.xyz/agents";
  const docsUrl = "https://celopaygrid.xyz/docs/overview.html";
  const iconUrl = "https://celopaygrid.xyz/PaygridIconLime.png";
  const mcpTools = [
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
  ];
  const selfProtocol = {
    status: config.selfVerificationStatus || "pending",
    agentId: config.selfAgentId || null,
    agentAddress: config.selfAgentAddress || null,
    verificationUrl: config.selfVerificationUrl || null,
  };
  const supportedTrust = [
    "erc8004",
    "x402",
    ...(selfProtocol.status === "verified" ? ["self-agent-id"] : []),
  ];

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: config.agentName,
    description:
      "Celo PayGrid is a payment execution, settlement verification and business workflow layer for AI agents on Celo Mainnet. Through a remote MCP endpoint, agents can create payment requests, coordinate stablecoin payment workflows, track activity, verify settlement with onchain evidence, and connect payments to agentic collections, ERP/CRM reconciliation and x402-ready commerce flows.",
    image: iconUrl,
    url: appUrl,
    version: "0.1.0",
    active: true,
    x402Support: true,
    provider: {
      organization: "Kilauea Tec Lab / Celo PayGrid",
      name: "Kilauea Tec Lab / Celo PayGrid",
      url: appUrl,
    },
    publisher: {
      name: "Kilauea Tec Lab / Celo PayGrid",
      url: appUrl,
      icon: iconUrl,
      did: address ? `did:pkh:${chainRef}:${address}` : null,
      contact: "team@celopaygrid.xyz",
    },
    defaultInputModes: ["text", "json"],
    defaultOutputModes: ["text", "json"],
    agentId,
    address,
    selfProtocol,
    selfAgentId: selfProtocol.agentId,
    selfAgentAddress: selfProtocol.agentAddress,
    chainId,
    apiEndpoint: config.publicApiUrl,
    mcpEndpoint,
    healthEndpoint,
    endpoints: [
      { type: "mcp", url: mcpEndpoint },
      { type: "api", url: config.publicApiUrl },
      { type: "health", url: healthEndpoint },
      { type: "metadata", url: metadataEndpoint },
      { type: "docs", url: docsUrl },
      { type: "llms", url: "https://celopaygrid.xyz/llms.txt" },
      ...(address ? [{ type: "wallet", address, chainId }] : []),
    ],
    services: [
      { name: "web", type: "web", endpoint: appUrl },
      {
        name: "MCP",
        type: "mcp",
        endpoint: mcpEndpoint,
        version: "2025-06-18",
        transport: "Streamable HTTP",
        mcpTools,
      },
      { name: "API", type: "api", endpoint: config.publicApiUrl },
      {
        name: "metrics",
        type: "metrics",
        endpoint: healthEndpoint,
        description: "Live MCP health and Celo chain status.",
      },
      { name: "docs", type: "docs", endpoint: docsUrl },
      ...(address ? [{ name: "DID", type: "did", endpoint: `did:pkh:${chainRef}:${address}`, version: "v1" }] : []),
    ],
    skills: [
      {
        id: "digital_payments",
        name: "Digital Payments",
        description: "Create and verify stablecoin payment requests on Celo for agent-to-human and business workflows.",
        tags: ["finance-and-business", "finance", "digital-payments", "stablecoins", "celo"],
      },
      {
        id: "tool_interaction_automation_workflow_automation",
        name: "Workflow Automation",
        description: "Coordinate payment request creation, activity tracking and settlement verification through MCP.",
        tags: ["tool-interaction", "automation", "workflow-automation", "mcp"],
      },
      {
        id: "business_collections",
        name: "Agentic Collections",
        description: "Generate and track payment requests for invoices, customer balances and ERP/CRM collections workflows.",
        tags: ["finance", "collections", "erp", "crm", "business-automation"],
      },
      {
        id: "business_reconciliation",
        name: "Payment Reconciliation",
        description: "Connect verified payments to invoices, orders, customers and business records.",
        tags: ["finance", "accounting", "reconciliation", "erp"],
      },
      {
        id: "smart_contracts",
        name: "Smart Contracts",
        description: "Uses Celo Mainnet contracts and ERC-8004 identity for verifiable agent payment workflows.",
        tags: ["technology", "blockchain", "smart-contracts", "erc-8004"],
      },
      {
        id: "x402_ready_commerce",
        name: "x402-ready Commerce",
        description: "Prepare payment flows for HTTP-native paid APIs and agent commerce.",
        tags: ["x402", "api-monetization", "agent-commerce"],
      },
      {
        id: "question_answering",
        name: "Question Answering",
        description: "Answer questions about payment status, supported stablecoins, agent capabilities and settlement evidence.",
        tags: ["natural-language-processing", "information-retrieval-and-synthesis", "question-answering"],
      },
      {
        id: "problem_solving",
        name: "Problem Solving",
        description: "Resolve payment status, token support, checkout preparation and verification issues.",
        tags: ["analytical-and-logical-reasoning", "problem-solving"],
      },
      {
        id: "agent_commerce",
        name: "Agent Commerce",
        description: "Enable agents to transact with freelancers, service providers, businesses and agent-enabled systems.",
        tags: ["agent-commerce", "agent-to-human", "payments", "celo"],
      },
    ],
    registrations: [
      ...(agentId
        ? [
            {
              agentId: Number.isNaN(Number(agentId)) ? agentId : Number(agentId),
              agentRegistry: `${chainRef}:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
            },
          ]
        : []),
    ],
    trustMechanisms: [
      { type: "identity", description: "ERC-8004 identity on Celo Mainnet." },
      ...(selfProtocol.status === "verified"
        ? [
            {
              type: "self-agent-id",
              description: `Self Protocol Agent ID ${selfProtocol.agentId} for sybil-resistant agent identity.`,
            },
          ]
        : []),
      {
        type: "settlement-verification",
        description: "Payment requests and receipts are verified against Celo Mainnet transaction evidence.",
      },
      { type: "x402", description: "x402-ready payment workflows for agent commerce and paid API interactions." },
    ],
    contracts: {
      "paygridLink.celoMainnet": "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89",
      "paygridRouter.celoMainnet": "0x2924FEf3eF7c3ADBFF22b286C42764a96c53f9f4",
      "treasurySafe.celoMainnet": "0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6",
    },
    framework: "Node.js MCP HTTP server, Hono/TypeScript backend, Foundry smart contracts, Supabase indexer, Next.js MiniPay checkout",
    capabilities: [
      "stablecoin-payment-requests",
      "agent-to-human-payments",
      "payment-verification",
      "agentic-collections",
      "business-reconciliation",
      "x402-ready-commerce",
      "mcp-tooling",
      "celo-mainnet-settlement",
    ],
    tools: mcpTools,
    extensions: {
      x402: {
        spec: "https://github.com/coinbase/x402",
        currency: "USDC",
        chain: "Celo",
        network: "celo",
        description: "Paygrid supports x402-ready payment workflows for agent commerce and paid API interactions.",
      },
      mcp: {
        endpoint: mcpEndpoint,
        discovery: metadataEndpoint,
        transport: "Streamable HTTP",
        description: "Remote MCP endpoint for payment request creation, activity tracking and settlement verification.",
      },
      erc8004: {
        chainId,
        agentId,
        registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      },
      self: {
        agentId: selfProtocol.agentId,
        agentAddress: selfProtocol.agentAddress,
        status: selfProtocol.status,
      },
    },
    chains: [chainRef],
    tags: [
      "celo",
      "stablecoins",
      "mcp",
      "x402",
      "erc-8004",
      "self-protocol",
      "agent-payments",
      "agentic-commerce",
      "erp",
      "crm",
      "business-automation",
      "collections",
      "settlement-verification",
    ],
    supportedTrust,
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
    (req.url === "/metadata" ||
      req.url === "/.well-known/paygrid-agent.json" ||
      req.url === "/.well-known/agent.json")
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
