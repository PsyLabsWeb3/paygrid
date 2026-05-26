import assert from "node:assert/strict";
import test, { before } from "node:test";
import { generatePrivateKey } from "viem/accounts";

process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
process.env.ERC8004_AGENT_ID = "9113";
process.env.BACKEND_URL = "http://localhost:3001";
process.env.CHAIN_ID = "11142220";

let fetchX402Endpoint: typeof import("../x402-payer").fetchX402Endpoint;
const testTxHash = `0x${"22".repeat(32)}` as `0x${string}`;

before(async () => {
  ({ fetchX402Endpoint } = await import("../x402-payer"));
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("fetchX402Endpoint completes challenge, proof, and retry flow", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), init });

    if (calls.length === 1) {
      return jsonResponse({
        error: {
          code: "PAYMENT_REQUIRED",
          message: "Payment required",
          details: {
            challenge: {
              error: {
                code: "PAYMENT_REQUIRED",
                details: {
                  resource: "/api/x402/data",
                  chainId: 11142220,
                  token: "USDC",
                  amount: "0.10",
                  proofHeader: "x-paygrid-x402-proof",
                },
              },
            },
          },
        },
      }, 402);
    }

    const proof = JSON.parse((init?.headers as Record<string, string>)["x-paygrid-x402-proof"]);
    return jsonResponse({ ok: true, proof });
  }) as typeof fetch;

  const result = await fetchX402Endpoint({
    fetchImpl,
    txHash: testTxHash,
  });

  assert.equal(calls.length, 2);
  assert.equal(result.proof.resource, "/api/x402/data");
  assert.equal(result.proof.chainId, 11142220);
  assert.equal(result.proof.token, "USDC");
  assert.equal(result.proof.amount, "0.10");
  assert.equal(result.trace.txHash, testTxHash);
});

test("fetchX402Endpoint reports invalid proof retries", async () => {
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.headers) {
      return jsonResponse({
        error: {
          details: {
            challenge: {
              error: {
                details: {
                  resource: "/api/x402/data",
                  chainId: 11142220,
                  token: "USDC",
                  amount: "0.10",
                },
              },
            },
          },
        },
      }, 402);
    }

    return jsonResponse({ error: { code: "FORBIDDEN", message: "x402 proof resource mismatch" } }, 403);
  }) as typeof fetch;

  await assert.rejects(
    () => fetchX402Endpoint({ fetchImpl, maxRetries: 0 }),
    /x402 proof rejected with 403/,
  );
});
