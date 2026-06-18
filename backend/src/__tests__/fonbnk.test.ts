import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Env } from "../config/env.js";
import { getFonbnkCountryConfig, verifyFonbnkWebhookAuth } from "../services/fonbnk.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  PUBLIC_APP_URL: "https://celopaygrid.xyz",
  CELO_RPC_URL: "https://example-rpc.invalid",
  CHAIN_ID: 11142220,
  PAYGRID_LINK_ADDRESS: "0x0000000000000000000000000000000000000001",
  PAYGRID_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000002",
  BACKEND_WALLET_PRIVATE_KEY: ("0x" + "1".repeat(64)) as `0x${string}`,
  FONBNK_API_KEY: "fonbnk-key",
  FONBNK_WEBHOOK_SECRET: "webhook-secret",
  RAMP_ENV: "demo",
  PORT: 3001,
} satisfies Env;

function makeResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("verifyFonbnkWebhookAuth accepts x-api-key", () => {
  const headers = new Headers({ "x-api-key": "webhook-secret" });
  assert.equal(verifyFonbnkWebhookAuth(env, "{}", headers), true);
});

test("verifyFonbnkWebhookAuth accepts x-signature", () => {
  const rawBody = JSON.stringify({ orderId: "order-1" });
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const secretHash = createHash("sha256").update("webhook-secret").digest("hex");
  const signature = createHash("sha256").update(bodyHash + secretHash).digest("hex");

  const headers = new Headers({ "x-signature": signature });
  assert.equal(verifyFonbnkWebhookAuth(env, rawBody, headers), true);
});

test("getFonbnkCountryConfig normalizes channels, carriers and indicative rates", async () => {
  const seenPaths: string[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    seenPaths.push(url.pathname + url.search);
    const clientId = init?.headers ? new Headers(init.headers).get("x-client-id") : null;
    assert.equal(clientId, "fonbnk-key");

    if (url.pathname.endsWith("/payment-channels")) {
      return makeResponse({
        countries: [
          {
            countryIsoCode: "KE",
            countryName: "Kenya",
            currencyIsoCode: "KES",
            paymentChannels: [
              {
                paymentChannel: "mobile_money",
                name: "Mobile money",
                carriers: [
                  { id: "safaricom", code: "safaricom", name: "Safaricom" },
                ],
              },
            ],
          },
        ],
      });
    }

    if (url.pathname.endsWith("/assets")) {
      return makeResponse({
        assets: [{ symbol: "USDC" }, { symbol: "USDT" }, { symbol: "CUSD" }],
      });
    }

    if (url.pathname.endsWith("/limits")) {
      return makeResponse({
        minCrypto: "1",
        maxCrypto: "100",
        minLocalCurrency: "100",
        maxLocalCurrency: "10000",
        minUsd: "1",
        maxUsd: "100",
      });
    }

    if (url.pathname.endsWith("/best-offer")) {
      return makeResponse({
        quoteId: "quote-1",
        localCurrencyAmount: "100",
        cryptoAmount: "1",
        exchangeRate: "100",
      });
    }

    throw new Error(`Unexpected path ${url.pathname}`);
  };

  const config = await getFonbnkCountryConfig(env, "KE", { fetch: fetchStub });

  assert.deepEqual(config.supportedAssets, ["USDC", "USDT"]);
  assert.equal(config.countryIsoCode, "KE");
  assert.equal(config.countryName, "Kenya");
  assert.equal(config.currencyIsoCode, "KES");
  assert.equal(config.carriers.length, 1);
  assert.equal(config.carriers[0]?.paymentChannel, "mobile_money");
  assert.equal(config.carriers[0]?.carrierCode, "safaricom");
  assert.equal(config.carriers[0]?.limits?.minCrypto, 1);
  assert.equal(config.rates.USDC?.quoteId, "quote-1");
  assert.equal(config.rates.USDC?.exchangeRate, "100");
  assert.ok(seenPaths.includes("/api/onramp/payment-channels"));
  assert.ok(seenPaths.includes("/api/onramp/assets"));
  assert.ok(seenPaths.some((path) => path.startsWith("/api/onramp/limits")));
  assert.ok(seenPaths.some((path) => path.startsWith("/api/onramp/best-offer")));
});
