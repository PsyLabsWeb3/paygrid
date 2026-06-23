import { paygridRequest, createAgentSigner } from "./paygrid-client.js";

const CELO_MAINNET_DEFI = {
  chainId: 42220,
  rpcUrl: "https://forno.celo.org",
  tokens: {
    USDC: { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
    USDT: { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
    USDm: { address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
    CELO: { address: "0x471EcE3750Da237f93B8E339c536989b8978a438", decimals: 18 },
  },
  protocols: {
    uniswapV3: {
      swapRouter02: "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
      quoterV2: "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8",
      universalRouter: "0x643770E279d5D0733F21d6DC03A8efbABf3255B4",
    },
    uniswapV4: {
      poolManager: "0x288dc841A52FCA2707c6947B3A777c5E56cd87BC",
      universalRouter: "0xcb695bc5d3aa22cad1e6df07801b061a05a0233a",
      v4Quoter: "0x28566da1093609182dff2cb2a91cfd72e61d66cd",
    },
    aaveV3: {
      pool: "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402",
      uiPoolDataProvider: "0xe48424542b30b0b8D1Dc09099aceE407f40b4491",
    },
    morphoBlue: {
      morpho: "0xd24ECdD8C1e0E57a4E26B1a7bbeAa3e95466A569",
    },
  },
  knownLiveDexes: ["Uniswap V3", "SushiSwap", "Curve", "Mento Asset Exchange", "Ubeswap V2", "Ubeswap V3"],
};

function text(payload) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
  };
}

function requireString(args, key) {
  const value = args?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function getSelfProtocol(config) {
  return {
    status: config.selfVerificationStatus || "pending",
    agentId: config.selfAgentId || null,
    agentAddress: config.selfAgentAddress || null,
    verificationUrl: config.selfVerificationUrl || null,
  };
}

function getSupportedTrust(config) {
  return [
    "erc8004",
    "x402",
    ...(getSelfProtocol(config).status === "verified" ? ["self-agent-id"] : []),
  ];
}

export const toolDefinitions = [
  {
    name: "create_payment_request",
    description: "Create an agent-owned Paygrid payment request on Celo.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["amount", "token", "description", "recipientAddress"],
      properties: {
        amount: { type: "string" },
        token: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        description: { type: "string" },
        recipientAddress: { type: "string" },
        acceptedMethods: { type: "array", items: { type: "string", enum: ["crypto", "fonbnk", "card"] } },
        expiresAt: { type: "string" },
      },
    },
  },
  {
    name: "get_payment_request",
    description: "Fetch a Paygrid payment request and its payment state.",
    write: false,
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "verify_payment",
    description: "Verify whether a Paygrid payment request is paid.",
    write: false,
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_agent_requests",
    description: "List payment requests owned by the configured ERC-8004 agent.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "paid", "expired", "cancelled"] },
        token: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_card_checkout",
    description: "Create a card-funded Ramp checkout for an existing Paygrid request.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        finalUrl: { type: "string" },
      },
    },
  },
  {
    name: "pay_x402_endpoint",
    description: "Call an x402-protected endpoint with caller-provided payment headers.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        method: { type: "string" },
        body: { type: "object" },
        paymentHeaders: { type: "object" },
      },
    },
  },
  {
    name: "get_supported_stablecoins",
    description: "List Paygrid-supported Celo stablecoins and configured addresses.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_capabilities",
    description: "Describe how autonomous agents can use Paygrid, including tools, auth, endpoints, and guardrails.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_connection_guide",
    description: "Return MCP connection examples for remote HTTP agents and local stdio adapters.",
    write: false,
    inputSchema: {
      type: "object",
      properties: {
        runtime: { type: "string", enum: ["generic", "hermes", "openclaw", "stdio"] },
      },
    },
  },
  {
    name: "get_celo_defi_context",
    description: "Return Celo DeFi rails Paygrid can use for future agent spend, swaps, and liquidity-aware payments.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_profile",
    description: "Return the configured Paygrid ERC-8004 agent profile.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "treasury_report",
    description: "Return payment volume for the configured agent from Paygrid backend.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
    },
  },
];

const toolMap = new Map(toolDefinitions.map((tool) => [tool.name, tool]));

export function listTools() {
  return {
    tools: toolDefinitions.map(({ write, ...tool }) => tool),
  };
}

export function getToolDefinition(name) {
  return toolMap.get(name);
}

export async function callTool(config, name, args = {}) {
  switch (name) {
    case "create_payment_request": {
      const payload = {
        amount: requireString(args, "amount"),
        token: requireString(args, "token"),
        description: args.description ?? "",
        recipientAddress: requireString(args, "recipientAddress"),
        acceptedMethods: args.acceptedMethods ?? ["crypto", "card"],
        expiresAt: args.expiresAt,
      };
      return text(await paygridRequest(config, "/api/links", { method: "POST", body: JSON.stringify(payload) }, { agentAuth: true }));
    }
    case "get_payment_request":
      return text(await paygridRequest(config, `/api/links/${encodeURIComponent(requireString(args, "id"))}`));
    case "verify_payment": {
      const payment = await paygridRequest(config, `/api/links/${encodeURIComponent(requireString(args, "id"))}`);
      return text({
        id: payment.id,
        onChainLinkId: payment.onChainLinkId,
        status: payment.status,
        paid: payment.status === "paid",
        txHash: payment.txHash,
        payments: payment.payments ?? [],
      });
    }
    case "list_agent_requests": {
      const query = new URLSearchParams();
      if (args.status) query.set("status", String(args.status));
      if (args.token) query.set("token", String(args.token));
      if (args.limit) query.set("limit", String(args.limit));
      const suffix = query.toString() ? `?${query}` : "";
      return text(await paygridRequest(config, `/api/links${suffix}`, {}, { agentAuth: true }));
    }
    case "create_card_checkout":
      return text(
        await paygridRequest(config, `/api/links/${encodeURIComponent(requireString(args, "id"))}/pay`, {
          method: "POST",
          body: JSON.stringify({ method: "ramp", finalUrl: args.finalUrl }),
        }),
      );
    case "pay_x402_endpoint": {
      const response = await fetch(requireString(args, "url"), {
        method: args.method ?? "GET",
        headers: {
          "content-type": "application/json",
          ...(args.paymentHeaders ?? {}),
        },
        body: args.body ? JSON.stringify(args.body) : undefined,
      });
      return text({
        status: response.status,
        ok: response.ok,
        body: await response.text(),
      });
    }
    case "get_supported_stablecoins":
      return text({
        chainId: config.chainId,
        rpcUrl: config.celoRpcUrl,
        stablecoins: config.tokenAddresses,
      });
    case "get_agent_capabilities":
      return text({
        name: "Paygrid Agent Spend Infrastructure",
        chainId: config.chainId,
        endpoints: {
          api: config.publicApiUrl,
          mcp: `${config.publicBaseUrl}/mcp`,
          metadata: `${config.publicBaseUrl}/.well-known/paygrid-agent.json`,
          health: `${config.publicBaseUrl}/health`,
        },
        identity: {
          standard: "ERC-8004",
          agentId: config.agentId ?? null,
          address: config.agentAddress ?? createAgentSigner(config)?.address ?? null,
          selfProtocol: getSelfProtocol(config),
          supportedTrust: getSupportedTrust(config),
        },
        access: {
          readOnlyTools: toolDefinitions.filter((tool) => !tool.write).map((tool) => tool.name),
          writeTools: toolDefinitions.filter((tool) => tool.write).map((tool) => tool.name),
          remoteWriteAuth: "Authorization: Bearer <PAYGRID_MCP_API_KEY>",
          backendAgentAuth: "ERC-8004 signed HTTP headers generated by the MCP using AGENT_PRIVATE_KEY",
        },
        guardrails: {
          current: ["API-key protected write tools", "ERC-8004 signed backend requests", "rate-limited backend routes"],
          planned: ["per-agent API keys", "scoped permissions", "daily spend limits", "token allowlists", "max slippage"],
        },
        primaryFlows: [
          "agent creates a payment request and receives Celo stablecoins",
          "agent verifies whether a payment request is paid",
          "agent prepares card-funded checkout for humans",
          "agent calls x402-protected endpoints with caller-provided payment headers",
        ],
      });
    case "get_agent_connection_guide": {
      const runtime = args.runtime ?? "generic";
      return text({
        runtime,
        remoteHttp: {
          url: `${config.publicBaseUrl}/mcp`,
          authHeader: "Authorization: Bearer <PAYGRID_MCP_API_KEY>",
          exampleConfig: {
            mcpServers: {
              paygrid: {
                type: "http",
                url: `${config.publicBaseUrl}/mcp`,
                headers: {
                  Authorization: "Bearer <PAYGRID_MCP_API_KEY>",
                },
              },
            },
          },
        },
        readOnlyProbe: {
          method: "tools/list",
          curl: `curl -X POST ${config.publicBaseUrl}/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
        },
        localStdioFallback: {
          whenToUse: "Use a local adapter when the agent runtime supports only stdio MCP clients.",
          env: {
            PAYGRID_MCP_URL: `${config.publicBaseUrl}/mcp`,
            PAYGRID_MCP_API_KEY: "<optional write key>",
          },
        },
        agentIdentity: {
          paygridAgentId: config.agentId ?? null,
          note: "External agents can identify themselves to Paygrid backend routes with ERC-8004 signed headers. Paygrid auto-creates an agents row on the first valid signed request.",
        },
      });
    }
    case "get_celo_defi_context":
      return text({
        ...CELO_MAINNET_DEFI,
        paygridUseCases: [
          "quote_swap: estimate conversion into the stablecoin required by a payment request",
          "prepare_swap: return calldata for review without executing",
          "fund_payment_request: future guarded flow to swap then pay",
          "stablecoin_route_quote: compare USDC, USDT, USDm and Mento local-currency rails",
          "agent_spend_policy: future per-agent limits for tokens, slippage, daily volume, and merchants",
        ],
        status: {
          current: "context only; Paygrid does not execute swaps yet",
          recommendedNextTool: "quote_swap",
        },
      });
    case "get_agent_profile": {
      const signer = createAgentSigner(config);
      return text({
        name: config.agentName,
        agentId: config.agentId ?? null,
        address: config.agentAddress ?? signer?.address ?? null,
        selfProtocol: getSelfProtocol(config),
        chainId: config.chainId,
        apiEndpoint: config.publicApiUrl,
        mcpEndpoint: config.publicBaseUrl,
        capabilities: toolDefinitions.map((tool) => tool.name),
        supportedTrust: getSupportedTrust(config),
      });
    }
    case "treasury_report": {
      const query = new URLSearchParams();
      if (args.from) query.set("from", String(args.from));
      if (args.to) query.set("to", String(args.to));
      const suffix = query.toString() ? `?${query}` : "";
      return text(await paygridRequest(config, `/api/payments${suffix}`, {}, { agentAuth: true }));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
