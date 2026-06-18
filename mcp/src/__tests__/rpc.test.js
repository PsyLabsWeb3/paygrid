import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, isWriteAuthorized } from "../config.js";
import { handleRpc } from "../rpc.js";

test("lists Paygrid MCP tools", async () => {
  const result = await handleRpc(loadConfig(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(result.id, 1);
  assert.ok(result.result.tools.some((tool) => tool.name === "create_payment_request"));
  assert.ok(result.result.tools.some((tool) => tool.name === "verify_payment"));
});

test("blocks remote write tools without API key", async () => {
  const result = await handleRpc(
    { ...loadConfig(), mcpApiKey: "secret" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_payment_request", arguments: {} },
    },
    { remote: true, writeAuthorized: false },
  );
  assert.equal(result.error.code, -32001);
});

test("accepts bearer or x-api-key for remote write auth", () => {
  const config = { mcpApiKey: "secret" };
  assert.equal(isWriteAuthorized(config, { authorization: "Bearer secret" }), true);
  assert.equal(isWriteAuthorized(config, { "x-api-key": "secret" }), true);
  assert.equal(isWriteAuthorized(config, { authorization: "Bearer nope" }), false);
});
