import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, type Hex } from "viem";
import { createApp } from "../app.js";
import type { Env } from "../config/env.js";
import type { PaymentLinkRow } from "../db/supabase.js";
import { paygridRouterAbiConst } from "../lib/chain.js";
import { getTokenAddress, type Stablecoin } from "../lib/tokens.js";

const env = {
  SUPABASE_URL: "https://links-wmxn.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  PUBLIC_APP_URL: "https://example.invalid",
  CELO_RPC_URL: "https://rpc.example.invalid",
  CHAIN_ID: 42220,
  PAYGRID_LINK_ADDRESS: "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89",
  PAYGRID_ROUTER_ADDRESS: "0x8d290c97100f0e87e04Efd1a790F27004fA3f08B",
  BACKEND_WALLET_PRIVATE_KEY: `0x${"1".repeat(64)}` as Hex,
  RIPIO_WMXN_ADDRESS: "0x337E7456B420bD3481e7FA61fA9850343d610d34",
  ODELEITE_WMXN_ENABLED: "true",
  RAMP_ENV: "demo",
  PORT: 3001,
} satisfies Env;

function makeLink(): PaymentLinkRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    creator_id: null,
    creator_type: null,
    on_chain_link_id: "84",
    paygrid_link_address: env.PAYGRID_LINK_ADDRESS,
    recipient_address: "0x1111111111111111111111111111111111111111",
    amount: "3",
    amount_atomic: "3000000000000000000",
    token: "wMXN",
    settlement_decimals: 18,
    partner_name: "odeleite",
    accepted_payer_assets: ["wMXN"],
    accepted_methods: ["crypto"],
    status: "active",
    description: "Prueba 3 wMXN",
    tx_hash: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

let link: PaymentLinkRow;
let databaseReads: number;
let rpcReads: number;
let unexpectedRequests: string[];

beforeEach(() => {
  link = makeLink();
  databaseReads = 0;
  rpcReads = 0;
  unexpectedRequests = [];
  // Exercise the real HTTP routes, database client and calldata builder offline.
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.origin === env.SUPABASE_URL && url.pathname === "/rest/v1/payment_links") {
      assert.equal(url.searchParams.get("id"), `eq.${link.id}`);
      databaseReads += 1;
      return Response.json([link]);
    }
    if (request.method === "POST" && request.url === `${env.CELO_RPC_URL}/`) {
      const body = await request.json();
      assert.equal(body.method, "eth_call");
      assert.equal(body.params[0].to.toLowerCase(), env.PAYGRID_ROUTER_ADDRESS.toLowerCase());
      const call = decodeFunctionData({ abi: paygridRouterAbiConst, data: body.params[0].data });
      assert.equal(call.functionName, "feeBps");
      rpcReads += 1;
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: encodeFunctionResult({ abi: paygridRouterAbiConst, functionName: "feeBps", result: 1n }),
      });
    }
    unexpectedRequests.push(`${request.method} ${request.url}`);
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
});

afterEach(() => {
  mock.restoreAll();
  assert.deepEqual(unexpectedRequests, [], "tests must never contact an unmocked service");
});

function request(endpoint: "quote" | "pay", payerToken?: string, overrides: Partial<Env> = {}) {
  return createApp({ ...env, ...overrides }).request(`http://localhost/api/links/${link.id}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(endpoint === "pay" ? { method: "crypto" } : {}), payerToken, slippageBps: 100 }),
  });
}

for (const endpoint of ["quote", "pay"] as const) {
  test(`${endpoint} accepts an exact 3 wMXN payment through the HTTP route`, async () => {
    const response = await request(endpoint, "wMXN");
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const quote = endpoint === "pay" ? body.quote : body;
    assert.equal(body.paymentMode, "exact");
    assert.equal(quote.payerToken, "wMXN");
    assert.equal(quote.settlementToken, "wMXN");
    for (const field of ["amountOut", "amountIn", "amountInMax", "minAmountOut"]) {
      assert.equal(quote[field], link.amount_atomic);
    }
    assert.equal(databaseReads, 1);
    assert.equal(rpcReads, endpoint === "pay" ? 1 : 0);
    if (endpoint === "pay") assertPreparedPayment(body, "wMXN");
  });

  test(`${endpoint} preserves atomic precision instead of using the human amount`, async () => {
    link.amount = "9.23";
    link.amount_atomic = "9230000000000000001";
    const response = await request(endpoint, "wMXN");
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const quote = endpoint === "pay" ? body.quote : body;
    assert.equal(quote.amountOut, link.amount_atomic);
    assert.equal(quote.amountInMax, link.amount_atomic);
    if (endpoint === "pay") assertPreparedPayment(body, "wMXN");
  });

  test(`${endpoint} respects the wMXN feature flag`, async () => {
    const response = await request(endpoint, "wMXN", { ODELEITE_WMXN_ENABLED: "false" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "UNSUPPORTED_METHOD");
    assert.equal(rpcReads, 0);
  });

  test(`${endpoint} rejects assets outside the partner link's accepted list`, async () => {
    const response = await request(endpoint, "USDC");
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "UNSUPPORTED_METHOD");
    assert.equal(body.error.message, "Unsupported payer asset");
    assert.equal(rpcReads, 0);
  });

  test(`${endpoint} rejects conversions to and from wMXN`, async () => {
    link.accepted_payer_assets = ["USDC", "wMXN"];
    for (const [settlementToken, payerToken] of [["wMXN", "USDC"], ["USDC", "wMXN"]] as const) {
      link.token = settlementToken;
      const response = await request(endpoint, payerToken);
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error.code, "UNSUPPORTED_METHOD");
      assert.equal(body.error.message, "wMXN requires exact payment");
    }
    assert.equal(rpcReads, 0);
  });

  test(`${endpoint} keeps paid and cancelled links blocked`, async () => {
    for (const [status, httpStatus, code] of [["paid", 409, "ALREADY_PAID"], ["cancelled", 410, "EXPIRED"]] as const) {
      link.status = status;
      const response = await request(endpoint, "wMXN");
      assert.equal(response.status, httpStatus);
      assert.equal((await response.json()).error.code, code);
    }
    assert.equal(rpcReads, 0);
  });

  test(`${endpoint} rejects an unknown token before accessing services`, async () => {
    const response = await request(endpoint, "UNKNOWN");
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
    assert.equal(databaseReads, 0);
    assert.equal(rpcReads, 0);
  });

  for (const token of ["USDm", "USDC", "USDT"] as const) {
    test(`${endpoint} continues accepting exact ${token} payments`, async () => {
      link.token = token;
      link.amount_atomic = token === "USDm" ? "3000000000000000000" : "3000000";
      link.accepted_payer_assets = [token];
      const response = await request(endpoint, token);
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      const quote = endpoint === "pay" ? body.quote : body;
      assert.equal(quote.payerToken, token);
      assert.equal(quote.amountOut, link.amount_atomic);
      if (endpoint === "pay") assertPreparedPayment(body, token);
    });
  }
}

function assertPreparedPayment(body: any, token: Stablecoin) {
  assert.equal(body.method, "crypto");
  assert.equal(body.feeBps, 1);
  assert.equal(body.link.id, link.id);
  assert.equal(body.link.onChainLinkId, link.on_chain_link_id);
  assert.equal(body.link.token, token);
  assert.equal(body.approveTx.to.toLowerCase(), getTokenAddress(env, token).toLowerCase());
  assert.equal(body.approveTx.value, "0");
  assert.equal(body.approveTx.amount, link.amount_atomic);
  assert.equal(body.approveTx.token, token);
  const approval = decodeFunctionData({ abi: erc20Abi, data: body.approveTx.data });
  assert.equal(approval.functionName, "approve");
  assert.deepEqual(approval.args, [env.PAYGRID_ROUTER_ADDRESS, BigInt(link.amount_atomic!)]);
  assert.equal(body.payTx.to.toLowerCase(), env.PAYGRID_ROUTER_ADDRESS.toLowerCase());
  assert.equal(body.payTx.value, "0");
  const payment = decodeFunctionData({ abi: paygridRouterAbiConst, data: body.payTx.data });
  assert.equal(payment.functionName, "pay");
  assert.deepEqual(payment.args, [BigInt(link.on_chain_link_id), getTokenAddress(env, token), BigInt(link.amount_atomic!)]);
}

test("pay continues supporting requests without payerToken", async () => {
  link.token = "USDC";
  link.amount_atomic = "3000000";
  link.accepted_payer_assets = ["USDC"];
  const response = await request("pay");
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.method, "crypto");
  assert.equal(body.link.token, "USDC");
  const payment = decodeFunctionData({ abi: paygridRouterAbiConst, data: body.tx.data });
  assert.equal(payment.functionName, "pay");
  assert.deepEqual(payment.args, [84n, getTokenAddress(env, "USDC"), 3000000n]);
  assert.equal(rpcReads, 0);
});


for (const endpoint of ["quote", "pay"] as const) {
  test(`${endpoint} pays an existing public wMXN request after creation is disabled`, async () => {
    link.partner_name = null;
    link.amount = "9.23";
    link.amount_atomic = "9230000000000000001";
    const response = await request(endpoint, "wMXN", { ODELEITE_WMXN_ENABLED: "false", WMXN_LINKS_ENABLED: "false" });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const quote = endpoint === "pay" ? body.quote : body;
    assert.equal(quote.amountInMax, "9230000000000000001");
    assert.equal(quote.paymentMode, "exact");
    if (endpoint === "pay") {
      assert.equal(body.link.amount, "9.230000000000000001");
      assert.equal(body.chainId, 42220);
      assertPreparedPayment(body, "wMXN");
    }
  });
  test(`${endpoint} rejects expired public requests before preparing a payment`, async () => {
    link.partner_name = null;
    link.expires_at = new Date(Date.now() - 1000).toISOString();
    const response = await request(endpoint, "wMXN");
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error.code, "EXPIRED");
    assert.equal(rpcReads, 0);
  });
}
