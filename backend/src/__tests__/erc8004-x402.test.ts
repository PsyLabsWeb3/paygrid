import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { Env } from "../config/env.js";
import type { AgentRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";
import { createErc8004AuthMiddleware, createErc8004SignedMessage, getAuthAgent } from "../middleware/erc8004-auth.js";
import { createX402Middleware, getX402Proof } from "../middleware/x402.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CELO_SEPOLIA_RPC: "https://example-rpc.invalid",
  CHAIN_ID: 11142220,
  PAYGRID_LINK_ADDRESS: "0x0000000000000000000000000000000000000001",
  PAYGRID_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000002",
  PAYGRID_TREASURY_ADDRESS: "0x0000000000000000000000000000000000000003",
  BACKEND_WALLET_PRIVATE_KEY: ("0x" + "1".repeat(64)) as `0x${string}`,
  PORT: 3001,
} satisfies Env;

const fakeAgent: AgentRow = {
  id: "agent-row-1",
  agent_id: "9113",
  address: "0x2222222222222222222222222222222222222222",
  name: null,
  metadata_uri: null,
  reputation_score: 0,
  created_at: new Date().toISOString(),
};

function makeApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, details: err.details }, err.status as any);
    }
    return c.json({ error: "internal" }, 500);
  });
  return app;
}

test("erc8004 auth middleware accepts a signed agent request", async () => {
  const app = makeApp();
  const account = privateKeyToAccount(("0x" + "3".repeat(64)) as `0x${string}`);
  const timestamp = Date.now();
  const message = createErc8004SignedMessage({
    agentId: fakeAgent.agent_id,
    address: account.address,
    method: "GET",
    path: "/agent",
    timestamp,
    nonce: "nonce-1",
  });
  const signature = await account.signMessage({ message });

  app.get(
    "/agent",
    createErc8004AuthMiddleware(env, {
      required: true,
      resolveAgent: async (_env, input) => ({
        ...fakeAgent,
        agent_id: input.agentId,
        address: input.address,
      }),
    }),
    (c) => c.json({ agentId: getAuthAgent(c)?.agent.agent_id }),
  );

  const res = await app.request("http://localhost/agent", {
    headers: {
      "x-erc8004-agent-id": fakeAgent.agent_id,
      "x-erc8004-address": account.address,
      "x-erc8004-timestamp": String(timestamp),
      "x-erc8004-nonce": "nonce-1",
      "x-erc8004-signature": signature,
    },
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { agentId: string };
  assert.equal(body.agentId, fakeAgent.agent_id);
});

test("x402 middleware returns a payment challenge without proof", async () => {
  const app = makeApp();
  app.get("/api/x402/data", createX402Middleware(env), (c) => c.json({ ok: true }));

  const res = await app.request("http://localhost/api/x402/data");
  assert.equal(res.status, 402);
  const body = (await res.json()) as {
    error: string;
    details: {
      challenge: {
        error: {
          code: string;
          details: {
            resource: string;
            amount: string;
          };
        };
      };
    };
  };
  assert.equal(body.error, "PAYMENT_REQUIRED");
  assert.equal(body.details.challenge.error.code, "PAYMENT_REQUIRED");
  assert.equal(body.details.challenge.error.details.resource, "/api/x402/data");
  assert.equal(body.details.challenge.error.details.amount, "0.10");
});

test("x402 middleware accepts a well-formed proof", async () => {
  const app = makeApp();
  app.get("/api/x402/data", createX402Middleware(env), (c) => c.json({ ok: true, proof: getX402Proof(c) }));

  const res = await app.request("http://localhost/api/x402/data", {
    headers: {
      "x-paygrid-x402-proof": JSON.stringify({
        resource: "/api/x402/data",
        chainId: 11142220,
        token: "USDC",
        amount: "0.10",
        txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        payer: "0x1111111111111111111111111111111111111111",
      }),
    },
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; proof: { resource: string; token: string } };
  assert.equal(body.ok, true);
  assert.equal(body.proof.resource, "/api/x402/data");
  assert.equal(body.proof.token, "USDC");
});
