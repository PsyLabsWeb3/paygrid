import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { Env } from "../config/env.js";
import type { AgentRow, UserRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";
import { createOwnershipAuthMiddleware } from "../middleware/ownership-auth.js";
import { createErc8004SignedMessage, getAuthAgent } from "../middleware/erc8004-auth.js";
import { privateKeyToAccount } from "viem/accounts";

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

test("ownership auth prefers a valid agent request over invalid Privy headers", async () => {
  const app = makeApp();
  const account = privateKeyToAccount(("0x" + "3".repeat(64)) as `0x${string}`);
  const timestamp = Date.now();
  const message = createErc8004SignedMessage({
    agentId: fakeAgent.agent_id,
    address: account.address,
    method: "GET",
    path: "/mixed",
    timestamp,
    nonce: "nonce-1",
  });
  const signature = await account.signMessage({ message });

  app.get(
    "/mixed",
    createOwnershipAuthMiddleware(env, {
      resolveAgent: async (_env, input) => ({
        ...fakeAgent,
        agent_id: input.agentId,
        address: input.address,
      }),
      resolveUser: async () => ({
        id: "user-row-1",
        privy_id: "user-1",
        phone_number: null,
        address: null,
        created_at: new Date().toISOString(),
      } satisfies UserRow),
      verifyPrivyToken: async () => {
        throw new Error("privy should not be used for a valid agent request");
      },
    }),
    (c) => c.json({ agentId: getAuthAgent(c)?.agent.agent_id }),
  );

  const res = await app.request("http://localhost/mixed", {
    headers: {
      authorization: "Bearer invalid",
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
