import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig, isWriteAuthorized } from "../config.js";
import { createMcpServer } from "../rpc.js";
async function connected(run, config = loadConfig(), options = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair(),
    server = createMcpServer(config, options),
    client = new Client({ name: "test", version: "1.0" });
  await server.connect(b);
  await client.connect(a);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}
test("official MCP SDK negotiates and lists all existing and x402 tools", async () => {
  await connected(async (client) => {
    assert.equal(client.getServerVersion().version, "0.2.0");
    const result = await client.listTools(),
      names = result.tools.map((t) => t.name);
    for (const name of [
      "create_payment_request",
      "verify_payment",
      "get_agent_capabilities",
      "get_celo_defi_context",
      "quote_payment_request",
      "pay_payment_request",
      "create_gift",
      "close_all_treasury_quant_positions",
      "pay_x402_endpoint",
      "get_x402_capabilities",
      "get_x402_payment_status",
    ])
      assert.ok(names.includes(name), name);
  });
});
test("remote write tools require an API key", async () => {
  await connected(
    async (client) => {
      await assert.rejects(
        () =>
          client.callTool({ name: "create_payment_request", arguments: {} }),
        /API key/,
      );
    },
    loadConfig(),
    { remote: true, writeAuthorized: false },
  );
});
test("remote bearer and x-api-key authentication remain compatible", () => {
  const cfg = { mcpApiKey: "secret" };
  assert.equal(
    isWriteAuthorized(cfg, { authorization: "Bearer secret" }),
    true,
  );
  assert.equal(isWriteAuthorized(cfg, { "x-api-key": "secret" }), true);
  assert.equal(isWriteAuthorized(cfg, { authorization: "Bearer nope" }), false);
});
test("input schemas reject paymentHeaders and missing idempotency before executing", async () => {
  await connected(async (client) => {
    for (const args of [
      { url: "https://example.com" },
      {
        url: "https://example.com",
        idempotencyKey: "operation-key-0001",
        paymentHeaders: { evil: "value" },
      },
    ])
      await assert.rejects(
        () => client.callTool({ name: "pay_x402_endpoint", arguments: args }),
        /input schema/,
      );
  });
});
test("Celo context remains available without authentication", async () => {
  await connected(async (client) => {
    const result = await client.callTool({
      name: "get_celo_defi_context",
      arguments: {},
    });
    const value = JSON.parse(result.content[0].text);
    assert.equal(value.chainId, 42220);
    assert.equal(
      value.tokens.USDC.address,
      "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    );
  });
});
test("MCP delegates payments to the fixed backend without forwarding its service credential upstream", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ operationId: "op", state: "unknown", error: null }),
      { status: 202 },
    );
  };
  try {
    await connected(
      async (client) => {
        const result = await client.callTool({
          name: "pay_x402_endpoint",
          arguments: {
            url: "https://merchant.example/api",
            idempotencyKey: "operation-key-0001",
            preferredToken: "wMXN",
          },
        });
        assert.equal(JSON.parse(result.content[0].text).state, "unknown");
      },
      {
        ...loadConfig(),
        backendUrl: "https://backend.example",
        x402ExecutorKey: "executor",
      },
      { remote: true, writeAuthorized: true },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://backend.example/api/x402/pay");
    assert.equal(calls[0].init.headers.Authorization, "Bearer executor");
    assert.equal(
      JSON.parse(calls[0].init.body).url,
      "https://merchant.example/api",
    );
  } finally {
    globalThis.fetch = original;
  }
});
