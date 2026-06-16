import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoAlfajores, celoSepolia } from "viem/chains";
import { createPublicKey, createVerify } from "node:crypto";
import type { Env } from "../config/env.js";
import { getSupabase, type OnrampSessionRow, type PaymentLinkRow } from "../db/supabase.js";
import { paygridRouterAbiConst } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import {
  formatHumanAmount,
  getTokenAddress,
  parseHumanAmount,
  type Stablecoin,
} from "../lib/tokens.js";
import { ONRAMP_PROVIDERS } from "./onramp/providers.js";

const RAMP_PROVIDER = ONRAMP_PROVIDERS.ramp;
const RAMP_DEMO_WIDGET_URL = "https://app.demo.rampnetwork.com";
const RAMP_PRODUCTION_WIDGET_URL = "https://app.rampnetwork.com";
const RAMP_DEMO_API_BASE_URL = "https://api.demo.rampnetwork.com/api";
const RAMP_PRODUCTION_API_BASE_URL = "https://api.rampnetwork.com/api";
const RAMP_PRODUCTION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAElvxpYOhgdAmI+7oL4mABRAfM5CwLkCbZ
m64ERVKAisSulWFC3oRZom/PeyE2iXPX1ekp9UD1r+51c9TiuIHU4w==
-----END PUBLIC KEY-----`;
const RAMP_DEMO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEevN2PMEeIaaMkS4VIfXOqsLebj19kVeu
wWl0AnkIA6DJU0r3ixkXVhJTltycJtkDoEAYtPHfARyTofB5ZNw9xA==
-----END PUBLIC KEY-----`;

const ERC20_TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

type JsonRecord = Record<string, unknown>;

export type RampSessionInput = {
  finalUrl?: string;
  selectedCountryCode?: string;
  userEmailAddress?: string;
};

export type RampPaySession = {
  method: "ramp";
  session: {
    id: string;
    provider: "ramp";
    redirectUrl: string;
    token: Stablecoin;
    amount: string;
    asset: string;
    environment: "demo" | "production";
  };
};

export type RampWebhookPayload = {
  type?: string;
  purchase?: JsonRecord;
  payload?: JsonRecord;
  id?: string;
};

function requireConfig(value: string | undefined, name: string) {
  if (!value) {
    throw new ApiError(500, "INTERNAL_ERROR", `${name} is not configured`);
  }
  return value;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function toStringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function rampWidgetUrl(env: Env) {
  return env.RAMP_WIDGET_URL ?? (env.RAMP_ENV === "production" ? RAMP_PRODUCTION_WIDGET_URL : RAMP_DEMO_WIDGET_URL);
}

function rampApiBaseUrl(env: Env) {
  return env.RAMP_API_BASE_URL ?? (env.RAMP_ENV === "production" ? RAMP_PRODUCTION_API_BASE_URL : RAMP_DEMO_API_BASE_URL);
}

function rampPublicKey(env: Env) {
  return env.RAMP_WEBHOOK_PUBLIC_KEY ?? (env.RAMP_ENV === "production" ? RAMP_PRODUCTION_PUBLIC_KEY : RAMP_DEMO_PUBLIC_KEY);
}

function rampAssetForToken(env: Env, token: Stablecoin) {
  if (env.RAMP_ENV === "demo") {
    if (token === "USDm") return "CUSD";
    throw new ApiError(
      400,
      "UNSUPPORTED_METHOD",
      "Ramp demo supports Celo Alfajores CUSD, not the current Sepolia USDC checkout",
    );
  }

  if (token === "USDC") return "CELO_USDC";
  if (token === "USDT") return "CELO_USDT";
  return "CUSD";
}

function chainForEnv(env: Env) {
  if (env.CHAIN_ID === celo.id) return celo;
  if (env.CHAIN_ID === celoAlfajores.id) return celoAlfajores;
  return { ...celoSepolia, id: env.CHAIN_ID, rpcUrls: { default: { http: [env.CELO_RPC_URL] } } };
}

function getRouterOwnerWalletClient(env: Env) {
  const privateKey = requireConfig(env.ROUTER_OWNER_PRIVATE_KEY, "ROUTER_OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount(
    privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`),
  );
  return createWalletClient({ chain: chainForEnv(env), transport: http(env.CELO_RPC_URL), account });
}

function getRampWebhookUrl(env: Env, sessionId: string) {
  const baseUrl = requireConfig(env.RAMP_WEBHOOK_BASE_URL, "RAMP_WEBHOOK_BASE_URL").replace(/\/$/, "");
  return `${baseUrl}/api/onramp/ramp/webhook?sessionId=${encodeURIComponent(sessionId)}`;
}

function getRampPurchase(payload: RampWebhookPayload) {
  return asRecord(payload.purchase ?? payload.payload ?? payload);
}

function isRampSuccess(payload: RampWebhookPayload, purchase: JsonRecord) {
  const type = toStringValue(payload.type)?.toUpperCase();
  const status = toStringValue(purchase.status)?.toUpperCase();
  return type === "RELEASED" || status === "RELEASED";
}

function isRampFailure(payload: RampWebhookPayload, purchase: JsonRecord) {
  const type = toStringValue(payload.type)?.toUpperCase();
  const status = toStringValue(purchase.status)?.toUpperCase();
  return type === "RETURNED" || ["RETURNED", "ERROR", "CANCELLED", "EXPIRED"].includes(status ?? "");
}

function extractRampTxHash(purchase: JsonRecord) {
  return (
    toStringValue(purchase.finalTxHash) ??
    toStringValue(purchase.finalTxHashUrl) ??
    toStringValue(purchase.transactionHash) ??
    toStringValue(asRecord(purchase.crypto).transactionHash) ??
    null
  );
}

export function verifyRampWebhookSignature(env: Env, payload: unknown, headers: Headers) {
  const signature = headers.get("x-body-signature");
  if (!signature) {
    return false;
  }

  const verify = createVerify("sha256");
  verify.update(stableStringify(payload));
  verify.end();
  return verify.verify(createPublicKey(rampPublicKey(env)), signature, "base64");
}

async function settleRampPaymentOnChain(
  env: Env,
  args: {
    sessionId: string;
    link: PaymentLinkRow;
    token: Stablecoin;
    amount: string;
    onrampTxId: string;
    settlementTxHash: `0x${string}`;
  },
) {
  const tokenAddress = getTokenAddress(env, args.token);
  const amountWei = parseHumanAmount(args.amount, args.token);
  const publicClient = createPublicClient({ chain: chainForEnv(env), transport: http(env.CELO_RPC_URL) });
  const receipt = await publicClient.getTransactionReceipt({ hash: args.settlementTxHash });
  const routerAddress = env.PAYGRID_ROUTER_ADDRESS.toLowerCase();

  const transferFound = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: ERC20_TRANSFER_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Transfer") return false;
      const transfer = decoded.args as { to?: string; value?: bigint };
      return transfer.to?.toLowerCase() === routerAddress && transfer.value === amountWei;
    } catch {
      return false;
    }
  });

  if (!transferFound) {
    throw new ApiError(502, "ONRAMP_ERROR", "Ramp settlement tx did not transfer tokens to the router");
  }

  const walletClient = getRouterOwnerWalletClient(env);
  const { request } = await publicClient.simulateContract({
    address: env.PAYGRID_ROUTER_ADDRESS,
    abi: paygridRouterAbiConst,
    functionName: "payWithFiat",
    args: [
      BigInt(args.link.on_chain_link_id),
      tokenAddress,
      amountWei,
      keccak256(toBytes(args.onrampTxId)),
    ],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const now = new Date().toISOString();
  const fee = formatHumanAmount((amountWei * 50n) / 10000n, args.token);
  const supabase = getSupabase(env);
  const { error: paymentError } = await supabase.from("payments").insert({
    link_id: args.link.id,
    payer_address: env.PAYGRID_ROUTER_ADDRESS.toLowerCase(),
    amount: args.amount,
    token: args.token,
    fee_amount: fee,
    payment_method: "card",
    onramp_session_id: args.sessionId,
    onramp_tx_id: args.onrampTxId,
    tx_hash: txHash,
    status: "confirmed",
    confirmed_at: now,
  });

  if (paymentError && paymentError.code !== "23505") {
    throw new ApiError(500, "INTERNAL_ERROR", paymentError.message);
  }
  if (paymentError?.code === "23505") {
    let existingPaymentId: string | null = null;
    const { data: existingByTx } = await supabase
      .from("payments")
      .select("id")
      .eq("tx_hash", txHash)
      .maybeSingle();
    existingPaymentId = existingByTx?.id ?? null;

    if (!existingPaymentId) {
      const { data: existingBySession } = await supabase
        .from("payments")
        .select("id")
        .eq("onramp_session_id", args.sessionId)
        .maybeSingle();
      existingPaymentId = existingBySession?.id ?? null;
    }

    if (!existingPaymentId) {
      throw new ApiError(500, "INTERNAL_ERROR", paymentError.message);
    }

    await supabase
      .from("payments")
      .update({
        onramp_session_id: args.sessionId,
        onramp_tx_id: args.onrampTxId,
        payment_method: "card",
      })
      .eq("id", existingPaymentId);
  }

  await supabase
    .from("onramp_sessions")
    .update({ status: "completed", tx_hash: txHash, confirmed_at: now })
    .eq("id", args.sessionId);
  await supabase.from("payment_links").update({ status: "paid", tx_hash: txHash }).eq("id", args.link.id);

  return { txHash };
}

export async function createRampPaySession(
  env: Env,
  linkId: string,
  input: RampSessionInput,
): Promise<RampPaySession> {
  const apiKey = requireConfig(env.RAMP_API_KEY, "RAMP_API_KEY");
  const supabase = getSupabase(env);
  const { data: link, error } = await supabase.from("payment_links").select("*").eq("id", linkId).maybeSingle();

  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!link) throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  const paymentLink = link as PaymentLinkRow;
  if (paymentLink.status === "paid") throw new ApiError(409, "ALREADY_PAID", "Link already settled");
  if (paymentLink.status !== "active") throw new ApiError(410, "EXPIRED", `Link is ${paymentLink.status}`);
  if (!paymentLink.accepted_methods.includes("fonbnk")) {
    throw new ApiError(400, "UNSUPPORTED_METHOD", "Card payments are not accepted for this link");
  }

  const token = paymentLink.token as Stablecoin;
  const asset = rampAssetForToken(env, token);
  const amountUnits = parseHumanAmount(paymentLink.amount, token).toString();

  const sessionInsert = await supabase
    .from("onramp_sessions")
    .insert({
      payment_link_id: paymentLink.id,
      provider: RAMP_PROVIDER,
      provider_metadata: {
        environment: env.RAMP_ENV,
        asset,
      },
      amount: paymentLink.amount,
      token,
      fiat_amount: null,
      fiat_currency: null,
      carrier: "card",
      status: "initiated",
    })
    .select("*")
    .single();

  if (sessionInsert.error || !sessionInsert.data) {
    throw new ApiError(500, "INTERNAL_ERROR", sessionInsert.error?.message ?? "Failed to create Ramp session");
  }

  const session = sessionInsert.data as OnrampSessionRow;
  const url = new URL(rampWidgetUrl(env));
  url.searchParams.set("hostApiKey", apiKey);
  url.searchParams.set("hostAppName", "Paygrid");
  url.searchParams.set("enabledFlows", "ONRAMP");
  url.searchParams.set("defaultFlow", "ONRAMP");
  url.searchParams.set("enabledCryptoAssets", asset);
  url.searchParams.set("outAsset", asset);
  url.searchParams.set("outAssetValue", amountUnits);
  url.searchParams.set("userAddress", env.PAYGRID_ROUTER_ADDRESS);
  url.searchParams.set("webhookStatusUrl", getRampWebhookUrl(env, session.id));
  url.searchParams.set("paymentMethodType", "CARD_PAYMENT");
  if (input.finalUrl) url.searchParams.set("finalUrl", input.finalUrl);
  if (input.selectedCountryCode) url.searchParams.set("selectedCountryCode", input.selectedCountryCode);
  if (input.userEmailAddress) url.searchParams.set("userEmailAddress", input.userEmailAddress);

  await supabase
    .from("onramp_sessions")
    .update({
      provider_metadata: {
        environment: env.RAMP_ENV,
        asset,
        amountUnits,
        widgetUrl: rampWidgetUrl(env),
        apiBaseUrl: rampApiBaseUrl(env),
      },
    })
    .eq("id", session.id);

  return {
    method: "ramp",
    session: {
      id: session.id,
      provider: RAMP_PROVIDER,
      redirectUrl: url.toString(),
      token,
      amount: paymentLink.amount,
      asset,
      environment: env.RAMP_ENV,
    },
  };
}

export async function handleRampWebhook(
  env: Env,
  payload: RampWebhookPayload,
  headers: Headers,
  sessionId?: string | null,
) {
  if (!verifyRampWebhookSignature(env, payload, headers)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid Ramp webhook signature");
  }
  if (!sessionId) {
    throw new ApiError(400, "VALIDATION_ERROR", "Missing Ramp sessionId");
  }

  const supabase = getSupabase(env);
  const { data: session } = await supabase.from("onramp_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) throw new ApiError(404, "NOT_FOUND", "Ramp session not found");
  const onrampSession = session as OnrampSessionRow;

  const purchase = getRampPurchase(payload);
  const purchaseId = toStringValue(purchase.id) ?? toStringValue(payload.id);
  if (purchaseId) {
    await supabase
      .from("onramp_sessions")
      .update({ provider_order_id: purchaseId, provider_metadata: { ...onrampSession.provider_metadata, purchase } })
      .eq("id", onrampSession.id);
  }

  const existingPayment = await supabase
    .from("payments")
    .select("id")
    .eq("onramp_session_id", onrampSession.id)
    .maybeSingle();
  if (existingPayment.data) {
    return { status: "ok", idempotent: true };
  }

  if (isRampFailure(payload, purchase)) {
    await supabase.from("onramp_sessions").update({ status: "failed" }).eq("id", onrampSession.id);
    return { status: "failed" as const };
  }

  if (!isRampSuccess(payload, purchase)) {
    await supabase.from("onramp_sessions").update({ status: "processing" }).eq("id", onrampSession.id);
    return { status: "processing" as const };
  }

  const linkResult = await supabase
    .from("payment_links")
    .select("*")
    .eq("id", onrampSession.payment_link_id)
    .maybeSingle();
  if (!linkResult.data) {
    throw new ApiError(404, "NOT_FOUND", "Payment link not found for Ramp session");
  }

  const txHash = extractRampTxHash(purchase);
  if (!txHash || !txHash.startsWith("0x")) {
    throw new ApiError(502, "ONRAMP_ERROR", "Ramp webhook did not include a settlement tx hash");
  }

  const settlement = await settleRampPaymentOnChain(env, {
    sessionId: onrampSession.id,
    link: linkResult.data as PaymentLinkRow,
    token: onrampSession.token as Stablecoin,
    amount: String(onrampSession.amount),
    onrampTxId: purchaseId ?? onrampSession.id,
    settlementTxHash: txHash as `0x${string}`,
  });

  return { status: "ok", settled: true, txHash: settlement.txHash };
}
