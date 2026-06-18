import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { Env } from "../config/env.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  PUBLIC_APP_URL: "https://celopaygrid.xyz",
  CORS_ORIGINS: "http://localhost:3002",
  CELO_RPC_URL: "https://example-rpc.invalid",
  CHAIN_ID: 11142220,
  PAYGRID_LINK_ADDRESS: "0x0000000000000000000000000000000000000001",
  PAYGRID_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000002",
  PAYGRID_TREASURY_ADDRESS: "0x0000000000000000000000000000000000000003",
  BACKEND_WALLET_PRIVATE_KEY: ("0x" + "1".repeat(64)) as `0x${string}`,
  RAMP_ENV: "demo",
  PORT: 3001,
} satisfies Env;

test("api routes allow configured frontend preflight requests", async () => {
  const app = createApp(env);
  const res = await app.request("http://localhost/api/links/minipay", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:3002",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });

  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3002");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /Content-Type/i);
});
