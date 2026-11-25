import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import {
  callTool,
  getToolDefinition,
  listTools,
  toolDefinitions,
} from "./tools.js";

const validator = new AjvJsonSchemaValidator();
const inputs = new Map(
  toolDefinitions.map((tool) => [
    tool.name,
    validator.getValidator(tool.inputSchema),
  ]),
);
export function createMcpServer(config, options = {}) {
  const server = new Server(
    { name: "paygrid-mcp", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => listTools());
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = getToolDefinition(request.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, "Unknown tool");
    if (tool.write && options.remote && !options.writeAuthorized)
      throw new McpError(
        -32001,
        "Write tool requires a valid Paygrid MCP API key",
      );
    const args = request.params.arguments ?? {},
      checked = inputs.get(tool.name)(args);
    if (!checked.valid)
      throw new McpError(
        ErrorCode.InvalidParams,
        "Tool arguments do not match the published input schema",
      );
    try {
      const result = await callTool(config, tool.name, args);
      return result;
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              error instanceof Error ? error.message : "Tool execution failed",
          },
        ],
      };
    }
  });
  return server;
}
