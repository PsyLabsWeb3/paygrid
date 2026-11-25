import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../http.js";
import { loadConfig } from "../config.js";
test("Streamable HTTP negotiates through the official client and keeps remote writes protected", async () => {
  const config = {
    ...loadConfig(),
    httpPort: 0,
    backendUrl: "http://127.0.0.1:1",
    mcpApiKey: "server-key",
  };
  const server = createHttpServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({ name: "http-integration", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(url));
    assert.equal(client.getServerVersion().version, "0.2.0");
    assert.ok(
      (await client.listTools()).tools.some(
        (t) => t.name === "pay_x402_endpoint",
      ),
    );
    await assert.rejects(
      () =>
        client.callTool({
          name: "pay_x402_endpoint",
          arguments: {
            url: "https://api.celopaygrid.xyz/api/x402/data",
            idempotencyKey: "http-operation-0001",
          },
        }),
      /API key/,
    );
    const read = await client.callTool({
      name: "get_celo_defi_context",
      arguments: {},
    });
    assert.equal(JSON.parse(read.content[0].text).chainId, 42220);
    const metadata = await fetch(new URL("/metadata", url));
    assert.equal((await metadata.json()).x402Support, false);
    const evil = await fetch(url, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(evil.status, 403);
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
