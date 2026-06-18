import { callTool, getToolDefinition, listTools } from "./tools.js";

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleRpc(config, message, options = {}) {
  if (!message || typeof message !== "object") {
    return errorResponse(null, -32600, "Invalid request");
  }

  const { id, method, params } = message;
  if (id === undefined && method?.startsWith("notifications/")) {
    return null;
  }

  try {
    if (method === "initialize") {
      return response(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "paygrid-mcp", version: "0.1.0" },
      });
    }

    if (method === "tools/list") {
      return response(id, listTools());
    }

    if (method === "tools/call") {
      const name = params?.name;
      const tool = getToolDefinition(name);
      if (!tool) return errorResponse(id, -32602, `Unknown tool: ${name}`);
      if (tool.write && options.remote && !options.writeAuthorized) {
        return errorResponse(id, -32001, "Write tool requires a valid Paygrid MCP API key");
      }
      return response(id, await callTool(config, name, params?.arguments ?? {}));
    }

    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return errorResponse(id, -32000, error instanceof Error ? error.message : "Unexpected MCP error");
  }
}
