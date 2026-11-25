import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { authorizationTypes } from "@x402/evm";
import {
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { config, TOKENS } from "../x402/config.js";
import {
  encrypt,
  decrypt,
  validateRequest,
  select,
  authorization,
  digest,
  readResult,
} from "../x402/security.js";
import { publicAddress, SafeTransport } from "../x402/transport.js";
import { CeloProtocol } from "../x402/protocol.js";
import { Payments, publicOperation } from "../x402/service.js";
import { x402Routes } from "../routes/x402.js";
import type { Env } from "../config/env.js";
import { X402Error, type Protocol, type Transport } from "../x402/types.js";
import { MemoryStore } from "./helpers/x402-store.js";

const key = generatePrivateKey(),
  payer = privateKeyToAccount(key).address,
  payTo = "0x0000000000000000000000000000000000000003";
const env = {
  CHAIN_ID: 42220,
  X402_SELLER_ENABLED: "true",
  X402_PAYER_ENABLED: "true",
  X402_PAY_TO: payTo,
  X402_PAYER_PRIVATE_KEY: key,
  X402_EXECUTOR_API_KEY: "x".repeat(32),
  X402_ENCRYPTION_KEY: "11".repeat(32),
  X402_API_KEY: "test",
  CELO_RPC_URL: "https://example.invalid",
} as unknown as Env;
function setup() {
  const cfg = config(env),
    store = new MemoryStore();
  const accepts: PaymentRequirements[] = cfg.assets.map((a) => ({
    scheme: "exact",
    network: cfg.network,
    asset: a.address,
    amount: a.price,
    payTo,
    maxTimeoutSeconds: 120,
    extra: {
      name: a.name,
      version: a.version,
      assetTransferMethod: a.method,
      paymentFlow: "upfront",
    },
  }));
  const required: PaymentRequired = {
    x402Version: 2,
    resource: { url: cfg.publicApiUrl + "/api/x402/data" },
    accepts,
    extensions: { "payment-identifier": { info: { required: false } } },
  };
  let signed = 0,
    settled = 0,
    confirmed = 0,
    invalid = false,
    expired = false,
    drop = false,
    changed = false;
  const receipt: SettleResponse = {
    success: true,
    transaction: "0x" + "ab".repeat(32),
    network: cfg.network,
    payer,
  };
  const protocol: Protocol = {
    requirements: async () => required,
    preflight: async () => ({ ok: true }),
    expiredUnused: async () => expired,
    sign: async (r, selected) => {
      signed++;
      return {
        x402Version: 2,
        resource: r.resource,
        accepted: selected,
        payload: {
          signature: "0x" + "cd".repeat(65),
          authorization: {
            from: payer,
            to: payTo,
            value: selected.amount,
            nonce: "0x" + String(signed).padStart(64, "0"),
            validBefore: String(Math.floor(Date.now() / 1000) + 120),
          },
        },
        extensions: r.extensions,
      };
    },
    verify: async () => {
      if (invalid) throw new X402Error(402, "INVALID_PAYMENT", "Rejected");
    },
    settle: async () => {
      settled++;
      return receipt;
    },
    confirm: async () => {
      confirmed++;
    },
  };
  const transport: Transport = {
    send: async (_request, headers) => {
      if (!headers)
        return new Response(JSON.stringify(required), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
          },
        });
      if (drop) {
        drop = false;
        throw new Error("connection lost");
      }
      if (changed)
        return new Response("{}", {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
              ...required,
              accepts: accepts.map((a) => ({ ...a, amount: "5000000000" })),
            }),
          },
        });
      return new Response('{"data":"paid"}', {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt),
          "content-type": "application/json",
        },
      });
    },
  };
  const service = new Payments(cfg, store, protocol, transport);
  return {
    cfg,
    store,
    required,
    protocol,
    service,
    receipt,
    counters: () => ({ signed, settled, confirmed }),
    setInvalid: () => {
      invalid = true;
    },
    setExpired: () => {
      expired = true;
    },
    drop: () => {
      drop = true;
    },
    change: () => {
      changed = true;
    },
  };
}
const request = { url: "https://api.celopaygrid.xyz/api/x402/data" };
const id = "operation-reference-0001";

test("x402 capabilities fail closed and Sepolia advertises USDC only", () => {
  assert.deepEqual(
    config({ ...env, CHAIN_ID: 11142220 }).assets.map((a) => a.token),
    ["USDC"],
  );
  assert.equal(
    config({
      ...env,
      X402_SELLER_ENABLED: undefined,
      X402_PAYER_ENABLED: undefined,
    }).seller,
    false,
  );
  assert.throws(() => config({ ...env, X402_ENCRYPTION_KEY: undefined }));
  assert.throws(
    () => config({ ...env, BACKEND_WALLET_PRIVATE_KEY: key }),
    /dedicated/,
  );
});
test("atomic encryption authenticates records and never uses floating point", () => {
  const text = { amount: TOKENS.wMXN.daily };
  assert.deepEqual(
    decrypt(encrypt(text, env.X402_ENCRYPTION_KEY!), env.X402_ENCRYPTION_KEY!),
    text,
  );
  assert.throws(() =>
    decrypt(encrypt(text, env.X402_ENCRYPTION_KEY!), "22".repeat(32)),
  );
});
test("signer uses real x402 EIP-3009 signatures bounded to policy", async () => {
  const s = setup(),
    protocol = new CeloProtocol(s.cfg),
    r = s.required.accepts[0];
  protocol.balance = async () => 100000000n;
  const payload = await protocol.sign(s.required, r),
    auth = payload.payload.authorization as Record<string, string>;
  assert.equal(
    await verifyTypedData({
      address: payer,
      domain: {
        name: "USDC",
        version: "2",
        chainId: 42220,
        verifyingContract: TOKENS.USDC.address,
      },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as `0x${string}`,
        to: auth.to as `0x${string}`,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as `0x${string}`,
      },
      signature: payload.payload.signature as `0x${string}`,
    }),
    true,
  );
  await assert.rejects(() =>
    protocol.sign(s.required, { ...r, amount: "5000001" }),
  );
});
test("requests reject caller-supplied headers, signing overrides, GET bodies and unsafe URL syntax", () => {
  for (const bad of [
    { ...request, paymentHeaders: {} },
    { ...request, body: {} },
    { url: "http://api.celopaygrid.xyz" },
    { url: "https://name:secret@api.celopaygrid.xyz" },
    { url: request.url + "#fragment" },
  ])
    assert.throws(() => validateRequest(bad));
});
test("DNS policy rejects private, metadata, mapped IPv4, special ranges and rebinding answers", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "192.168.1.1",
    "0.0.0.0",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  const s = setup(),
    transport = new SafeTransport(s.cfg, (async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]) as any);
  await assert.rejects(
    () => transport.send(validateRequest(request)),
    /public IP/,
  );
});
test("payment selection rejects wrong domains, token adapters, chains, recipients and amounts", () => {
  const s = setup(),
    r = s.required.accepts[0],
    req = validateRequest(request);
  for (const bad of [
    { ...r, network: "eip155:1" },
    { ...r, payTo: payer },
    { ...r, amount: "5000001" },
    { ...r, amount: "1.1" },
    { ...r, asset: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" },
    { ...r, extra: { ...r.extra, name: "FAKE" } },
  ])
    assert.throws(() => select(s.cfg, req, [bad as PaymentRequirements]));
  assert.throws(() =>
    select(s.cfg, { ...req, url: "https://evil.example/api/x402/data" }, [r]),
  );
});
test("outgoing payment persists encrypted authorization and duplicate intent never signs twice", async () => {
  const s = setup(),
    first = await s.service.pay(request, id),
    retry = await s.service.pay(request, id);
  assert.equal(first.state, "settled");
  assert.equal(first.id, retry.id);
  assert.equal(s.counters().signed, 1);
  assert.equal(first.reserved, false);
  assert.ok(first.ciphertext);
  assert.ok(!JSON.stringify(publicOperation(first)).includes("signature"));
  await assert.rejects(
    () => s.service.pay({ ...request, preferredToken: "USDT" }, id),
    /Key reused/,
  );
});
test("concurrent identical requests execute one payment", async () => {
  const s = setup();
  await Promise.all(
    Array.from({ length: 12 }, () => s.service.pay(request, id)),
  );
  assert.equal(s.counters().signed, 1);
});
test("a lost paid response is recovered after restart using the same signature", async () => {
  const s = setup();
  s.drop();
  const op = await s.service.pay(request, id);
  assert.equal(op.state, "unknown");
  assert.equal(op.reserved, true);
  const restarted = new Payments(
    s.cfg,
    s.store,
    s.protocol,
    s.service.transport,
  );
  await restarted.reconcile();
  const recovered = await s.store.get(op.id);
  assert.equal(recovered?.state, "settled");
  assert.equal(s.counters().signed, 1);
});
test("corrective 402 changes never create another signature or release a live budget", async () => {
  const s = setup();
  s.change();
  const op = await s.service.pay(request, id);
  assert.equal(op.state, "unknown");
  assert.equal(op.error, "PAYMENT_TERMS_CHANGED");
  assert.equal(op.reserved, true);
  await s.service.reconcile();
  assert.equal(s.counters().signed, 1);
});
test("daily token budget is shared across executor instances and accepts its exact boundary", async () => {
  const s = setup();
  s.cfg.assets[0].daily = "200000";
  await s.service.pay({ ...request, preferredToken: "USDC" }, id);
  await new Payments(s.cfg, s.store, s.protocol, s.service.transport).pay(
    request,
    id + "-2",
  );
  await assert.rejects(
    () => s.service.pay({ ...request, preferredToken: "USDC" }, id + "-3"),
    /Budget exhausted/,
  );
  assert.equal(s.counters().signed, 2);
});
test("unknown outgoing authorization blocks new signatures until expiry is proven unused", async () => {
  const s = setup();
  s.drop();
  const op = await s.service.pay(request, id);
  await assert.rejects(() => s.service.pay(request, id + "-2"), /Wallet busy/);
  assert.equal(s.counters().signed, 1);
  s.setExpired();
  await s.service.reconcile();
  assert.equal((await s.store.get(op.id))?.reserved, false);
});
test("incoming invalid proofs cannot poison authorization replay records", async () => {
  const s = setup();
  s.setInvalid();
  const payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  await assert.rejects(() =>
    s.service.receive(encodePaymentSignatureHeader(payload)),
  );
  assert.equal(s.store.rows.size, 0);
});
test("incoming settlement precedes resource delivery and replay returns its cached result", async () => {
  const s = setup(),
    payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  const first = await s.service.receive(encodePaymentSignatureHeader(payload)),
    retry = await s.service.receive(encodePaymentSignatureHeader(payload));
  assert.equal(first?.state, "settled");
  assert.equal(first?.id, retry?.id);
  assert.equal(s.counters().settled, 1);
  assert.ok(first?.result?.body.includes("payment accepted"));
  const changed = {
    ...payload,
    accepted: { ...payload.accepted, amount: "1" },
  };
  await assert.rejects(
    () => s.service.receive(encodePaymentSignatureHeader(changed)),
    /another request/,
  );
});
test("HTTP routes issue standard headers, reject the legacy fake proof and protect executor APIs", async () => {
  const s = setup(),
    app = new Hono().route("/api/x402", x402Routes(env, s.service));
  const res = await app.request("http://local/api/x402/data", {
    headers: { "x-paygrid-x402-proof": JSON.stringify({ txHash: "fake" }) },
  });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get("PAYMENT-REQUIRED"));
  assert.equal(
    (
      await app.request("http://local/api/x402/pay", {
        method: "POST",
        body: JSON.stringify(request),
      })
    ).status,
    401,
  );
  const paid = await app.request("http://local/api/x402/pay", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + s.cfg.executorKey,
      "Idempotency-Key": id,
    },
    body: JSON.stringify(request),
  });
  assert.equal(paid.status, 200);
  assert.equal(((await paid.json()) as any).paid, true);
  const payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  const data = await app.request("http://local/api/x402/data", {
    headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) },
  });
  assert.equal(data.status, 200);
  assert.ok(data.headers.get("PAYMENT-RESPONSE"));
  assert.ok(data.headers.get("cache-control")?.includes("no-store"));
});

test("official SDK constructs the seller challenge and dispatches upfront settlement", async () => {
  const s = setup(),
    protocol = new CeloProtocol(s.cfg);
  protocol.balance = async () => 100000000n;
  protocol.facilitator.getSupported = async () => ({
    kinds: [{ x402Version: 2, network: s.cfg.network, scheme: "exact" }],
    extensions: ["payment-identifier", "eip2612GasSponsoring"],
    signers: {},
  });
  let called = 0;
  protocol.facilitator.settle = async (payload, requirement) => {
    called++;
    assert.equal(payload.accepted.payTo, payTo);
    assert.equal(requirement.extra?.paymentFlow, "upfront");
    return s.receipt;
  };
  const required = await protocol.requirements();
  assert.deepEqual(
    required.accepts.map((r) => r.asset),
    s.cfg.assets.map((a) => a.address),
  );
  assert.ok(required.extensions?.eip2612GasSponsoring);
  const payload = await protocol.sign(required, required.accepts[0]);
  const receipt = await protocol.settle(payload, required.accepts[0]);
  assert.equal(receipt.success, true);
  assert.equal(called, 1);
});
test("wMXN refuses to sign when the merchant omits sponsorship and allowance is insufficient", async () => {
  const s = setup(),
    protocol = new CeloProtocol(s.cfg);
  protocol.balance = async () => 10n ** 21n;
  Object.assign(protocol.rpc, { readContract: async () => 0n });
  await assert.rejects(
    () =>
      protocol.sign({ ...s.required, extensions: {} }, s.required.accepts[2]),
    /sponsoring/,
  );
});
test("confirmed payments release wallet holds while their interrupted resource is recovered", async () => {
  const s = setup(),
    normal = s.service.transport.send.bind(s.service.transport);
  let broken = true;
  s.service.transport.send = async (request, headers) => {
    if (headers && broken) {
      broken = false;
      return new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error("download interrupted"));
          },
        }),
        {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader(s.receipt),
          },
        },
      );
    }
    return normal(request, headers);
  };
  const first = await s.service.pay(request, id);
  assert.equal(first.state, "settled");
  assert.equal(first.reserved, false);
  assert.equal(first.error, "RESOURCE_DELIVERY_PENDING");
  await new Payments(
    s.cfg,
    s.store,
    s.protocol,
    s.service.transport,
  ).reconcile();
  const recovered = await s.store.get(first.id);
  assert.equal(recovered?.state, "settled");
  assert.equal(recovered?.phase, "complete");
  assert.ok(recovered?.result);
  assert.equal(s.counters().signed, 1);
});
test("failed settlement never executes or returns the protected resource", async () => {
  const s = setup(),
    payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  s.protocol.settle = async () => {
    throw new Error("insufficient facilitator credits");
  };
  const first = await s.service.receive(encodePaymentSignatureHeader(payload));
  assert.equal(first?.state, "unknown");
  assert.equal(first?.result, null);
  s.protocol.settle = async () => s.receipt;
  await s.service.reconcile();
  assert.equal((await s.store.get(first!.id))?.state, "settled");
});
test("expired results and malformed signatures do not create replacement charges", async () => {
  const s = setup(),
    payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  const first = await s.service.receive(encodePaymentSignatureHeader(payload));
  const row = s.store.rows.get(first!.id)!;
  row.result_expires_at = "2000-01-01T00:00:00Z";
  await s.store.prune();
  const app = new Hono().route("/api/x402", x402Routes(env, s.service));
  assert.equal(
    (
      await app.request("http://local/api/x402/data", {
        headers: { "PAYMENT-SIGNATURE": "malformed" },
      })
    ).status,
    402,
  );
  const expired = await app.request("http://local/api/x402/data", {
    headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) },
  });
  assert.equal(expired.status, 410);
  assert.equal(s.counters().settled, 1);
});

test("default currency priority falls back only to another authorized token when its budget is exhausted", async () => {
  const s = setup();
  s.cfg.assets[0].daily = "100000";
  const first = await s.service.pay(request, id),
    second = await s.service.pay(request, id + "-next");
  assert.equal(first.token, "USDC");
  assert.equal(second.token, "USDT");
  assert.equal(s.counters().signed, 2);
});

test("an unconfirmed facilitator receipt never exposes paid status or a resource", async () => {
  const s = setup();
  const payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  const confirm = s.protocol.confirm;
  s.protocol.confirm = async () => {
    throw new Error("Receipt not confirmed on chain");
  };
  const op = await s.service.receive(encodePaymentSignatureHeader(payload));
  assert.equal(op?.state, "unknown");
  assert.equal(publicOperation(op!).paid, false);
  assert.equal(op?.result, null);
  s.protocol.confirm = confirm;
  await s.service.reconcile();
  const recovered = await s.store.get(op!.id);
  assert.equal(publicOperation(recovered!).paid, true);
  assert.equal(s.counters().settled, 1);
});
test("a worker never reconciles operations belonging to a different network", async () => {
  const s = setup();
  s.drop();
  const op = await s.service.pay(request, id);
  const other = new Payments(
    { ...s.cfg, network: "eip155:11142220", chainId: 11142220 },
    s.store,
    s.protocol,
    s.service.transport,
  );
  await other.reconcile();
  assert.equal((await s.store.get(op.id))?.state, "unknown");
  assert.equal(s.counters().confirmed, 0);
  await s.service.reconcile();
  assert.equal((await s.store.get(op.id))?.state, "settled");
});

test("expired incoming authorizations fail before settlement and cannot consume replay identities", async () => {
  const s = setup();
  const payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  (payload.payload.authorization as any).validBefore = String(
    Math.floor(Date.now() / 1000) - 1,
  );
  await assert.rejects(
    () => s.service.receive(encodePaymentSignatureHeader(payload)),
    /expiry/,
  );
  assert.equal(s.store.rows.size, 0);
  assert.equal(s.counters().settled, 0);
});
test("simultaneous incoming copies settle and execute the protected resource at most once", async () => {
  const s = setup();
  const payload = await s.protocol.sign(s.required, s.required.accepts[0]);
  const header = encodePaymentSignatureHeader(payload);
  const replies = await Promise.all([
    s.service.receive(header),
    s.service.receive(header),
    s.service.receive(header),
  ]);
  assert.equal(new Set(replies.map((r) => r!.id)).size, 1);
  const replay = await s.service.receive(header);
  assert.equal(replay?.state, "settled");
  assert.equal(s.counters().settled, 1);
  assert.equal(s.counters().confirmed, 1);
});
test("request and response limits enforce the exact byte boundary", async () => {
  assert.throws(
    () =>
      validateRequest({ ...request, body: "x".repeat(65536), method: "POST" }),
    /64 KiB/,
  );
  const result = await readResult(new Response("x".repeat(1024 * 1024)));
  assert.equal(Buffer.byteLength(result.body), 1024 * 1024);
  await assert.rejects(
    () => readResult(new Response("x".repeat(1024 * 1024 + 1))),
    /1 MiB/,
  );
});
