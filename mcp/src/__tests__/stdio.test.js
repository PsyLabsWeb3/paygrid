import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
test("real stdio transport emits only MCP messages and exposes read-only tools", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/stdio.js"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-integration", version: "1" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "get_x402_payment_status"));
    const result = await client.callTool({
      name: "get_celo_defi_context",
      arguments: {},
    });
    assert.equal(JSON.parse(result.content[0].text).chainId, 42220);
  } finally {
    await client.close();
  }
});
