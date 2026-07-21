import { paygridRequest, createAgentSigner } from "./paygrid-client.js";
import { randomBytes } from "node:crypto";
import { keccak256, toBytes } from "viem";

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
    name: "get_treasury_quant_status",
    description: "Return Treasury Quant Agent mode, limits, balances, positions and recent signals.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_treasury_quant_positions",
    description: "List paper or live CELO, XAUt0, ETH, BTC and EURm long positions managed by the Treasury Quant Agent.",
    write: false,
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", minimum: 1, maximum: 100 } },
    },
  },
  {
    name: "list_treasury_quant_signals",
    description: "List deduplicated TradingView signals and their execution state.",
    write: false,
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", minimum: 1, maximum: 100 } },
    },
  },
  {
    name: "pause_treasury_quant_agent",
    description: "Pause new Treasury Quant Agent entries while keeping open positions monitored.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
    },
  },
  {
    name: "resume_treasury_quant_agent",
    description: "Resume Treasury Quant Agent signal processing after an operator pause.",
    write: true,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "close_treasury_quant_position",
    description: "Request a full close of an open Treasury Quant Agent position.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "close_all_treasury_quant_positions",
    description: "Pause new entries and request a market-safe close for every open Treasury Quant Agent position.",
    write: true,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_gift",
    description: "Create a claimable, personal stablecoin gift draft for a human recipient.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["senderAddress", "senderAlias", "recipientAlias", "message", "amount", "token"],
      properties: {
        senderAddress: { type: "string" },
        senderAlias: { type: "string" },
        recipientAlias: { type: "string" },
        message: { type: "string" },
        amount: { type: "string" },
        token: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        expiresAt: { type: "string" },
        sourceReferralCode: { type: "string" },
      },
    },
  },
  {
    name: "quote_gift_funding",
    description: "Quote exact-token or Mento-routed funding for a Paygrid gift.",
    write: false,
    inputSchema: {
      type: "object",
      required: ["id", "payerToken"],
      properties: {
        id: { type: "string" },
        payerToken: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        slippageBps: { type: "number" },
      },
    },
  },
  {
    name: "prepare_gift_funding",
    description: "Prepare approval and funding transactions for a Paygrid gift.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["id", "payerToken"],
      properties: {
        id: { type: "string" },
        payerToken: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        slippageBps: { type: "number" },
      },
    },
  },
  {
    name: "get_gift",
    description: "Fetch the public state and verifiable settlement evidence for a gift.",
    write: false,
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "verify_gift_claim",
    description: "Verify whether a gift was claimed and return its settlement transaction.",
    write: false,
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "prepare_gift_refund",
    description: "Prepare a permissionless refund transaction for an expired gift.",
    write: true,
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "get_gift_leaderboard",
    description: "Return the live gift campaign leaderboard and referral metrics.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
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
    name: "quote_payment_request",
    description: "Quote paying a Paygrid request with USDC, USDT, or USDm, including automatic stablecoin swap details when needed.",
    write: false,
    inputSchema: {
      type: "object",
      required: ["id", "payerToken"],
      properties: {
        id: { type: "string" },
        payerToken: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        slippageBps: { type: "number" },
      },
    },
  },
  {
    name: "pay_payment_request",
    description: "Prepare a Paygrid payment transaction for an agent, using an automatic stablecoin swap if payerToken differs from the request token.",
    write: true,
    inputSchema: {
      type: "object",
      required: ["id", "payerToken"],
      properties: {
        id: { type: "string" },
        payerToken: { type: "string", enum: ["USDC", "USDT", "USDm"] },
        maxSlippageBps: { type: "number" },
        preferExactToken: { type: "boolean" },
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
    case "get_treasury_quant_status":
      return text(await paygridRequest(config, "/api/treasury/status"));
    case "list_treasury_quant_positions": {
      const query = new URLSearchParams({ limit: String(args.limit ?? 25) });
      return text(await paygridRequest(config, `/api/treasury/positions?${query}`));
    }
    case "list_treasury_quant_signals": {
      const query = new URLSearchParams({ limit: String(args.limit ?? 25) });
      return text(await paygridRequest(config, `/api/treasury/signals?${query}`));
    }
    case "pause_treasury_quant_agent":
      if (!config.treasuryAdminApiKey) throw new Error("TREASURY_ADMIN_API_KEY is not configured");
      return text(await paygridRequest(config, "/api/treasury/control/pause", {
        method: "POST",
        headers: { "x-treasury-admin-key": config.treasuryAdminApiKey },
        body: JSON.stringify({ reason: args.reason }),
      }));
    case "resume_treasury_quant_agent":
      if (!config.treasuryAdminApiKey) throw new Error("TREASURY_ADMIN_API_KEY is not configured");
      return text(await paygridRequest(config, "/api/treasury/control/resume", {
        method: "POST",
        headers: { "x-treasury-admin-key": config.treasuryAdminApiKey },
      }));
    case "close_treasury_quant_position":
      if (!config.treasuryAdminApiKey) throw new Error("TREASURY_ADMIN_API_KEY is not configured");
      return text(await paygridRequest(
        config,
        `/api/treasury/positions/${encodeURIComponent(requireString(args, "id"))}/close`,
        {
          method: "POST",
          headers: { "x-treasury-admin-key": config.treasuryAdminApiKey },
        },
      ));
    case "close_all_treasury_quant_positions":
      if (!config.treasuryAdminApiKey) throw new Error("TREASURY_ADMIN_API_KEY is not configured");
      return text(await paygridRequest(config, "/api/treasury/control/close-all", {
        method: "POST",
        headers: { "x-treasury-admin-key": config.treasuryAdminApiKey },
      }));
    case "create_gift": {
      const secret = randomBytes(32).toString("hex");
      const payload = {
        senderAddress: requireString(args, "senderAddress"),
        senderAlias: requireString(args, "senderAlias"),
        recipientAlias: requireString(args, "recipientAlias"),
        message: requireString(args, "message"),
        amount: requireString(args, "amount"),
        token: requireString(args, "token"),
        claimHash: keccak256(toBytes(secret)),
        expiresAt: args.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        sourceReferralCode: args.sourceReferralCode,
      };
      const gift = await paygridRequest(config, "/api/gifts/minipay", {
        method: "POST",
        body: JSON.stringify(payload),
      }, { agentAuth: true });
      return text({
        ...gift,
        claimUrl: `${gift.shareUrl}#k=${secret}`,
        warning: "Treat claimUrl as a bearer invitation and share it only with the intended recipient.",
      });
    }
    case "quote_gift_funding":
      return text(await paygridRequest(config, `/api/gifts/${encodeURIComponent(requireString(args, "id"))}/quote`, {
        method: "POST",
        body: JSON.stringify({
          payerToken: requireString(args, "payerToken"),
          slippageBps: args.slippageBps ?? 100,
        }),
      }));
    case "prepare_gift_funding":
      return text(await paygridRequest(config, `/api/gifts/${encodeURIComponent(requireString(args, "id"))}/funding-tx`, {
        method: "POST",
        body: JSON.stringify({
          payerToken: requireString(args, "payerToken"),
          slippageBps: args.slippageBps ?? 100,
        }),
      }, { agentAuth: true }));
    case "get_gift":
      return text(await paygridRequest(config, `/api/gifts/${encodeURIComponent(requireString(args, "id"))}/public`));
    case "verify_gift_claim": {
      const gift = await paygridRequest(config, `/api/gifts/${encodeURIComponent(requireString(args, "id"))}/status`);
      return text({
        id: gift.id,
        status: gift.status,
        claimed: gift.status === "claimed",
        claimTxHash: gift.claimTxHash,
        claimedAt: gift.claimedAt,
      });
    }
    case "prepare_gift_refund":
      return text(await paygridRequest(config, `/api/gifts/${encodeURIComponent(requireString(args, "id"))}/refund-tx`, {
        method: "POST",
      }, { agentAuth: true }));
    case "get_gift_leaderboard":
      return text(await paygridRequest(config, "/api/gifts/leaderboard"));
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
    case "quote_payment_request":
      return text(
        await paygridRequest(config, `/api/links/${encodeURIComponent(requireString(args, "id"))}/quote`, {
          method: "POST",
          body: JSON.stringify({
            payerToken: requireString(args, "payerToken"),
            slippageBps: args.slippageBps ?? 100,
          }),
        }),
      );
    case "pay_payment_request":
      return text(
        await paygridRequest(config, `/api/links/${encodeURIComponent(requireString(args, "id"))}/pay`, {
          method: "POST",
          body: JSON.stringify({
            method: "crypto",
            payerToken: requireString(args, "payerToken"),
            slippageBps: args.maxSlippageBps ?? 100,
          }),
        }, { agentAuth: true }),
      );
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
          current: [
            "API-key protected write tools",
            "ERC-8004 signed backend requests",
            "rate-limited backend routes",
            "Treasury per-trade, total-exposure, daily-loss, slippage and entry-deviation limits",
            "CELO, XAUt0, ETH, BTC and EURm allowlist with per-asset oracle freshness and route checks",
          ],
          planned: ["per-agent API keys", "delegated user wallets", "scoped user-owned treasury policies"],
        },
        primaryFlows: [
          "Treasury Quant Agent receives deduplicated TradingView LONG signals and manages guarded CELO, XAUt0, ETH, BTC and EURm positions",
          "operators inspect positions, pause entries and request full closes through MCP",
          "agent creates a personal claimable gift and prepares exact-token or swap-routed funding",
          "recipient claims a gift and agents verify its onchain settlement",
          "agent creates a payment request and receives Celo stablecoins",
          "agent verifies whether a payment request is paid",
          "agent prepares card-funded checkout for humans",
          "agent calls x402-protected endpoints with caller-provided payment headers",
          "agent quotes and prepares stablecoin payments with automatic USDC/USDT/USDm swaps",
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
          current: "Paygrid quotes USDC/USDT/USDm swaps with Mento first and falls back to Uniswap when configured",
          treasuryQuant: "TradingView LONG signals can be paper-traded or executed through guarded Mento-first / Uniswap-fallback routes",
          recommendedNextTool: "get_treasury_quant_status",
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
