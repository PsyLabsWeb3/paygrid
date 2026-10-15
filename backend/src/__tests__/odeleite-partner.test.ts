import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { Env } from "../config/env.js";
import { isValidPartnerAuthorization } from "../middleware/partner-auth.js";
import { odeleitePaymentLinkCreateSchema } from "../routes/partner-links.js";
import {
  classifyCancellationRace,
  partnerRequestFingerprint,
  type OdeleitePaymentLinkInput,
} from "../services/partner-links.js";
import { quoteCryptoPayment, quoteStablecoinAmount } from "../services/swaps.js";
import type { PaymentLinkRow } from "../db/supabase.js";
import { signPartnerWebhook } from "../services/partner-webhooks.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  PUBLIC_APP_URL: "https://celopaygrid.xyz",
  CELO_RPC_URL: "https://example-rpc.invalid",
  CHAIN_ID: 42220,
  PAYGRID_LINK_ADDRESS: "0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89",
  PAYGRID_ROUTER_ADDRESS: "0x8d290c97100f0e87e04Efd1a790F27004fA3f08B",
  BACKEND_WALLET_PRIVATE_KEY: ("0x" + "1".repeat(64)) as `0x${string}`,
  ODELEITE_PARTNER_ENABLED: "true",
  ODELEITE_PARTNER_API_KEY: "partner-test-secret",
  ODELEITE_WEBHOOK_URL: "https://api.odeleite.com/api/v1/webhooks/paygrid/",
  ODELEITE_WEBHOOK_SECRET: "webhook-test-secret",
  ODELEITE_RELAYER_PRIVATE_KEY: ("0x" + "2".repeat(64)) as `0x${string}`,
  RAMP_ENV: "demo",
  PORT: 3001,
} satisfies Env;

const input: OdeleitePaymentLinkInput = {
  external_business_id: "11111111-1111-4111-8111-111111111111",
  external_link_id: "22222222-2222-4222-8222-222222222222",
  recipient_address: "0x1111111111111111111111111111111111111111",
  amount_atomic: "1000000",
  settlement_asset: "USDC",
  accepted_payer_assets: ["USDC", "USDT", "USDm"],
  description: "Pedido 123",
  merchant_display_name: "Comercio",
  expires_at: "2026-10-01T00:00:00.000Z",
  brand: "odeleite",
};

test("partner bearer comparison requires exact credential", () => {
  assert.equal(isValidPartnerAuthorization("Bearer partner-test-secret", "partner-test-secret"), true);
  assert.equal(isValidPartnerAuthorization("Bearer partner-test-secreu", "partner-test-secret"), false);
  assert.equal(isValidPartnerAuthorization("partner-test-secret", "partner-test-secret"), false);
});

test("partner request fingerprint is stable across object key order", () => {
  const reordered = Object.fromEntries(Object.entries(input).reverse()) as OdeleitePaymentLinkInput;
  assert.equal(partnerRequestFingerprint(input), partnerRequestFingerprint(reordered));
  assert.notEqual(
    partnerRequestFingerprint(input),
    partnerRequestFingerprint({ ...input, amount_atomic: "2000000" }),
  );
});

test("partner link creation accepts the ISO offset emitted by Django", () => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("Z", "+00:00");
  const parsed = odeleitePaymentLinkCreateSchema.safeParse({
    ...input,
    expires_at: expiresAt,
  });

  assert.equal(
    parsed.success,
    true,
    parsed.success ? undefined : JSON.stringify(parsed.error.issues),
  );
});

test("payment wins a concurrent payment/cancellation race", () => {
  assert.equal(classifyCancellationRace({ paid: true, cancelled: false }), "paid");
  assert.equal(classifyCancellationRace({ paid: false, cancelled: true }), "cancelled");
  assert.equal(classifyCancellationRace({ paid: false, cancelled: false }), "active");
});

test("partner webhook signature covers timestamp and exact body", () => {
  const body = JSON.stringify({ id: "evt", type: "payment_link.active" });
  const first = signPartnerWebhook("secret", "1700000000", body);
  assert.equal(first, signPartnerWebhook("secret", "1700000000", body));
  assert.notEqual(first, signPartnerWebhook("secret", "1700000001", body));
  assert.notEqual(first, signPartnerWebhook("secret", "1700000000", `${body} `));
});

test("partner route rejects missing bearer before touching the database", async () => {
  const response = await createApp(env).request(
    "http://localhost/api/partners/v1/payment-links/22222222-2222-4222-8222-222222222222",
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
});


test("wMXN partner links preserve atomics above int64 and only accept exact wMXN", () => {
  const wmxn = {...input, settlement_asset: "wMXN", accepted_payer_assets: ["wMXN"], amount_atomic: "10000000000000000000000", expires_at: new Date(Date.now()+7*86400000).toISOString()};
  assert.equal(odeleitePaymentLinkCreateSchema.parse(wmxn).amount_atomic, wmxn.amount_atomic);
  for (const amount of ["0", "1.2", "not-a-number", "999999999999999999", "10000000000000000000001", "1000000000000000001", (2n**256n).toString()]) {
    assert.equal(odeleitePaymentLinkCreateSchema.safeParse({...wmxn, amount_atomic:amount}).success, false);
  }
  assert.equal(odeleitePaymentLinkCreateSchema.safeParse({...wmxn, accepted_payer_assets:["USDC"]}).success, false);
  assert.notEqual(partnerRequestFingerprint(input), partnerRequestFingerprint({...input, settlement_asset:"wMXN", accepted_payer_assets:["wMXN"]}));
});


test("wMXN exact quote uses atomic TEXT instead of the human numeric column", async () => {
  const link = {status:"active", partner_name:"odeleite", token:"wMXN", accepted_methods:["crypto"], accepted_payer_assets:["wMXN"], amount:"9.23", amount_atomic:"9230000000000000001", expires_at:new Date(Date.now()+86400000).toISOString()} as unknown as PaymentLinkRow;
  const quote = await quoteCryptoPayment({...env,ODELEITE_WMXN_ENABLED:"true"},link,{payerToken:"wMXN"});
  assert.equal(quote.amountOut,"9230000000000000001");
  assert.equal(quote.amountInMax,quote.amountOut);
  assert.equal(quote.paymentMode,"exact");
  await assert.rejects(() => quoteCryptoPayment(env,link,{payerToken:"wMXN"}));
  await assert.rejects(() => quoteStablecoinAmount(env,"USDC","wMXN",10n**18n));
  await assert.rejects(() => quoteStablecoinAmount(env,"wMXN","USDC",1000000n));
});
