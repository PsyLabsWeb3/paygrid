import { paygridRequest, createAgentSigner } from "./paygrid-client.js";

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
    case "get_agent_profile": {
      const signer = createAgentSigner(config);
      return text({
        name: config.agentName,
        agentId: config.agentId ?? null,
        address: config.agentAddress ?? signer?.address ?? null,
        chainId: config.chainId,
        apiEndpoint: config.publicApiUrl,
        mcpEndpoint: config.publicBaseUrl,
        capabilities: toolDefinitions.map((tool) => tool.name),
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
