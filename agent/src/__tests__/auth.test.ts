import assert from "node:assert/strict";
import test, { before } from "node:test";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
process.env.AGENT_PRIVATE_KEY = privateKey;
process.env.ERC8004_AGENT_ID = "9113";
process.env.BACKEND_URL = "http://localhost:3001";
process.env.CHAIN_ID = "11142220";

let fetchWithAgentAuth: typeof import("../utils/auth").fetchWithAgentAuth;

before(async () => {
  ({ fetchWithAgentAuth } = await import("../utils/auth"));
});

test("fetchWithAgentAuth signs pathname while preserving query in request URL", async () => {
  const originalFetch = globalThis.fetch;
  const account = privateKeyToAccount(privateKey);
  let captured: { url: string; headers: Headers } | null = null;

  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured = {
      url: url.toString(),
      headers: new Headers(init?.headers),
    };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const response = await fetchWithAgentAuth("/api/payments?limit=20&status=confirmed");
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(captured);
  assert.equal(captured.url, "http://localhost:3001/api/payments?limit=20&status=confirmed");

  const timestamp = captured.headers.get("x-erc8004-timestamp");
  const nonce = captured.headers.get("x-erc8004-nonce");
  const signature = captured.headers.get("x-erc8004-signature") as `0x${string}` | null;
  assert.ok(timestamp);
  assert.ok(nonce);
  assert.ok(signature);

  const signedPathMessage = `paygrid:erc8004:9113:${account.address.toLowerCase()}:GET:/api/payments:${timestamp}:${nonce}`;
  assert.equal(
    await verifyMessage({ address: account.address, message: signedPathMessage, signature }),
    true,
  );

  const signedQueryMessage = `paygrid:erc8004:9113:${account.address.toLowerCase()}:GET:/api/payments?limit=20&status=confirmed:${timestamp}:${nonce}`;
  assert.equal(
    await verifyMessage({ address: account.address, message: signedQueryMessage, signature }),
    false,
  );
});
