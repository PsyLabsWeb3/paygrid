import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { Env } from "../config/env.js";
import type { UserRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";
import { createPrivyAuthMiddleware, getAuthUser } from "../middleware/privy-auth.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CELO_SEPOLIA_RPC: "https://example-rpc.invalid",
  CHAIN_ID: 11142220,
  PAYGRID_LINK_ADDRESS: "0x0000000000000000000000000000000000000001",
  PAYGRID_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000002",
  BACKEND_WALLET_PRIVATE_KEY: ("0x" + "1".repeat(64)) as `0x${string}`,
  PORT: 3001,
} satisfies Env;

const fakeUser: UserRow = {
  id: "user-1",
  privy_id: "did:privy:abc",
  phone_number: null,
  address: null,
  created_at: new Date().toISOString(),
};

function makeApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code }, err.status as any);
    }
    return c.json({ error: "internal" }, 500);
  });
  return app;
}

test("privy auth middleware rejects missing token", async () => {
  const app = makeApp();
  app.get(
    "/",
    createPrivyAuthMiddleware(env, {
      required: true,
      verifyAuthToken: async () => {
        throw new Error("should not be called");
      },
      resolveUser: async () => fakeUser,
    }),
    (c) => c.json({ ok: true }),
  );

  const res = await app.request("http://localhost/");
  assert.equal(res.status, 401);
});

test("privy auth middleware attaches the user context", async () => {
  const app = makeApp();
  app.get(
    "/",
    createPrivyAuthMiddleware(env, {
      required: true,
      verifyAuthToken: async () => ({
        user_id: "did:privy:abc",
        session_id: "sess_123",
        app_id: "app_123",
        issuer: "privy",
        issued_at: 1,
        expiration: 2,
      }),
      resolveUser: async () => fakeUser,
    }),
    (c) => c.json({ privyId: getAuthUser(c)?.privyId }),
  );

  const res = await app.request("http://localhost/", {
    headers: { authorization: "Bearer token-123" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { privyId: string };
  assert.equal(body.privyId, "did:privy:abc");
});
