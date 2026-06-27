import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, isWriteAuthorized } from "../config.js";
import { handleRpc } from "../rpc.js";

test("lists Paygrid MCP tools", async () => {
  const result = await handleRpc(loadConfig(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(result.id, 1);
  assert.ok(result.result.tools.some((tool) => tool.name === "create_payment_request"));
  assert.ok(result.result.tools.some((tool) => tool.name === "verify_payment"));
  assert.ok(result.result.tools.some((tool) => tool.name === "get_agent_capabilities"));
  assert.ok(result.result.tools.some((tool) => tool.name === "get_celo_defi_context"));
  assert.ok(result.result.tools.some((tool) => tool.name === "quote_payment_request"));
  assert.ok(result.result.tools.some((tool) => tool.name === "pay_payment_request"));
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

test("returns Celo agent spend context", async () => {
  const result = await handleRpc(loadConfig(), {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_celo_defi_context", arguments: {} },
  });
  const payload = JSON.parse(result.result.content[0].text);
  assert.equal(payload.chainId, 42220);
  assert.equal(payload.tokens.USDC.address, "0xcebA9300f2b948710d2653dD7B07f33A8B32118C");
  assert.equal(payload.status.current, "Paygrid quotes USDC/USDT/USDm swaps with Mento first and falls back to Uniswap when configured");
});
