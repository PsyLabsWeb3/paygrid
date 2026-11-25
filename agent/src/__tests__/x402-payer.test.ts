import test from "node:test";
import assert from "node:assert/strict";
import { fetchX402Endpoint } from "../x402-payer";
process.env.X402_EXECUTOR_API_KEY = "executor-test";
process.env.BACKEND_URL = "http://localhost:3001";
test("agent delegates x402 to the fixed backend and preserves idempotency", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        operationId: "op",
        state: "unknown",
        paid: false,
        payment: null,
        result: null,
        resultExpired: false,
        error: null,
      }),
      { status: 202 },
    );
  }) as typeof fetch;
  const options = {
    url: "https://merchant.example/data",
    preferredToken: "wMXN" as const,
    idempotencyKey: "stable-operation-0001",
    fetchImpl,
  };
  const first = await fetchX402Endpoint(options);
  await fetchX402Endpoint(options);
  assert.equal(first.state, "unknown");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, "http://localhost:3001/api/x402/pay");
    const headers = new Headers(call.init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer executor-test");
    assert.equal(headers.get("Idempotency-Key"), options.idempotencyKey);
    const body = JSON.parse(String(call.init?.body));
    assert.equal(body.url, options.url);
    assert.equal(body.preferredToken, "wMXN");
    assert.equal("paymentHeaders" in body, false);
  }
});
test("executor failures are surfaced without automatic payment retries", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchX402Endpoint({
        idempotencyKey: "stable-operation-0001",
        fetchImpl: (async () => {
          calls++;
          return new Response(
            JSON.stringify({ error: { message: "Budget exceeded" } }),
            { status: 409 },
          );
        }) as typeof fetch,
      }),
    /Budget exceeded/,
  );
  assert.equal(calls, 1);
});
test("agent rejects missing idempotency before network access", async () => {
  await assert.rejects(
    () => fetchX402Endpoint({ idempotencyKey: "" }),
    /stable Idempotency/,
  );
});
