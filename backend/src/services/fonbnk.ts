import { createHash, timingSafeEqual } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import type { Env } from "../config/env.js";
import { getSupabase, type OnrampSessionRow, type PaymentLinkRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";
import { paygridRouterAbiConst } from "../lib/chain.js";
import { TOKEN_ADDRESSES, formatHumanAmount, parseHumanAmount, type Stablecoin } from "../lib/tokens.js";

const FONBNK_NETWORK = "CELO";
const FONBNK_DEFAULT_API_BASE_URL = "https://sandbox-api.fonbnk.com";
const FONBNK_DEFAULT_PAY_BASE_URL = "https://sandbox-pay.fonbnk.com";
const FONBNK_SUPPORTED_ASSETS: Stablecoin[] = ["USDC", "USDT"];
const FONBNK_PAYMENT_CHANNELS = new Set(["bank", "mobile_money", "airtime"] as const);
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

type FonbnkPaymentChannel = "bank" | "mobile_money" | "airtime";

type JsonRecord = Record<string, unknown>;

export type FonbnkCountry = {
  countryIsoCode: string;
  countryName: string;
  currencyIsoCode: string;
  carriers: Array<{
    paymentChannel: FonbnkPaymentChannel;
    paymentChannelLabel: string;
    carrierId?: string;
    carrierCode?: string;
    carrierName?: string;
    limits: FonbnkLimits | null;
  }>;
  rates: Partial<Record<Stablecoin, FonbnkRate>>;
  supportedAssets: Stablecoin[];
};

export type FonbnkLimits = {
  minCrypto?: number | null;
  maxCrypto?: number | null;
  minLocalCurrency?: number | null;
  maxLocalCurrency?: number | null;
  minUsd?: number | null;
  maxUsd?: number | null;
};

export type FonbnkRate = {
  quoteId?: string | null;
  paymentChannel: FonbnkPaymentChannel;
  carrierCode?: string | null;
  localCurrencyAmount?: string | null;
  cryptoAmount?: string | null;
  exchangeRate?: string | null;
};

export type FonbnkPaySession = {
  method: "fonbnk";
  session: {
    id: string;
    provider: "fonbnk";
    redirectUrl: string;
    orderId?: string | null;
    countryIsoCode: string;
    paymentChannel: FonbnkPaymentChannel;
    carrierCode?: string | null;
    token: Stablecoin;
    amount: string;
    fiatCurrency: string;
  };
};

export type FonbnkSessionInput = {
  countryIsoCode: string;
  paymentChannel?: FonbnkPaymentChannel;
  carrierCode?: string;
  email: string;
  userIp?: string;
  redirectUrl?: string;
  extraFields?: Record<string, unknown>;
};

export type FonbnkWebhookPayload = {
  status?: string;
  txHash?: string;
  hash?: string;
  orderId?: string;
  orderParams?: string;
  sessionId?: string;
  amount?: string | number;
  token?: string;
  fiatCurrency?: string;
  data?: JsonRecord;
};

type FonbnkFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

type FonbnkDeps = {
  fetch?: FonbnkFetch;
};

type FonbnkOrder = {
  orderId: string;
  redirectUrl: string;
  raw: JsonRecord;
};

function requireConfig(value: string | undefined, name: string) {
  if (!value) {
    throw new ApiError(500, "INTERNAL_ERROR", `${name} is not configured`);
  }
  return value;
}

function fonbnkApiBaseUrl(env: Env) {
  return env.FONBNK_API_BASE_URL ?? FONBNK_DEFAULT_API_BASE_URL;
}

function fonbnkPayBaseUrl(env: Env) {
  return env.FONBNK_PAY_BASE_URL ?? FONBNK_DEFAULT_PAY_BASE_URL;
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as JsonRecord;
}

function toStringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function stablecoinFromAsset(asset: string | null): Stablecoin | null {
  if (!asset) {
    return null;
  }
  const normalized = asset.toUpperCase();
  if (normalized === "USDC" || normalized === "USDT") {
    return normalized;
  }
  return null;
}

function toPaymentChannel(value: unknown): FonbnkPaymentChannel | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (FONBNK_PAYMENT_CHANNELS.has(normalized as FonbnkPaymentChannel)) {
    return normalized as FonbnkPaymentChannel;
  }
  return null;
}

function pickPaymentChannel(raw: unknown): FonbnkPaymentChannel | null {
  return toPaymentChannel(raw);
}

function buildSignature(rawBody: string, secret: string) {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const secretHash = createHash("sha256").update(secret).digest("hex");
  return createHash("sha256").update(bodyHash + secretHash).digest("hex");
}

function timingSafeEquals(left: string, right: string) {
  const leftBuf = Buffer.from(left, "hex");
  const rightBuf = Buffer.from(right, "hex");
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

async function requestFonbnkJson(
  env: Env,
  path: string,
  init: RequestInit = {},
  deps: FonbnkDeps = {},
) {
  const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const url = new URL(path, fonbnkApiBaseUrl(env));
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-client-id", requireConfig(env.FONBNK_API_KEY, "FONBNK_API_KEY"));
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchImpl(url, { ...init, headers });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(502, "FONBNK_ERROR", `Fonbnk request failed for ${path}`, {
      status: response.status,
      body: parsed,
    });
  }

  return parsed as JsonRecord;
}

async function requestFonbnkBestOffer(
  env: Env,
  input: {
    countryIsoCode: string;
    paymentChannel: FonbnkPaymentChannel;
    carrierCode?: string;
    asset: Stablecoin;
    amount: string;
  },
  deps: FonbnkDeps = {},
) {
  const query = new URLSearchParams({
    network: FONBNK_NETWORK,
    asset: input.asset,
    currency: "crypto",
    amount: input.amount,
    countryIsoCode: input.countryIsoCode,
    paymentChannel: input.paymentChannel,
  });
  if (input.carrierCode) {
    query.set("carrierCode", input.carrierCode);
  }
  const raw = await requestFonbnkJson(env, `/api/onramp/best-offer?${query.toString()}`, {}, deps);
  return asRecord(raw);
}

async function requestFonbnkLimits(
  env: Env,
  input: {
    countryIsoCode: string;
    paymentChannel: FonbnkPaymentChannel;
    carrierCode?: string;
    asset: Stablecoin;
  },
  deps: FonbnkDeps = {},
) {
  const query = new URLSearchParams({
    network: FONBNK_NETWORK,
    asset: input.asset,
    currency: "crypto",
    countryIsoCode: input.countryIsoCode,
    paymentChannel: input.paymentChannel,
  });
  if (input.carrierCode) {
    query.set("carrierCode", input.carrierCode);
  }
  const raw = await requestFonbnkJson(env, `/api/onramp/limits?${query.toString()}`, {}, deps);
  return asRecord(raw);
}

async function requestFonbnkPaymentChannels(env: Env, deps: FonbnkDeps = {}) {
  return asRecord(await requestFonbnkJson(env, "/api/onramp/payment-channels", {}, deps));
}

async function requestFonbnkAssets(env: Env, deps: FonbnkDeps = {}) {
  return asRecord(await requestFonbnkJson(env, "/api/onramp/assets", {}, deps));
}

async function requestFonbnkOrderCreate(
  env: Env,
  body: JsonRecord,
  deps: FonbnkDeps = {},
) {
  return asRecord(
    await requestFonbnkJson(
      env,
      "/api/onramp/order/create",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      deps,
    ),
  );
}

async function requestFonbnkOrderDetails(
  env: Env,
  params: URLSearchParams,
  deps: FonbnkDeps = {},
) {
  return asRecord(await requestFonbnkJson(env, `/api/onramp/order?${params.toString()}`, {}, deps));
}

function normalizeLimits(raw: JsonRecord): FonbnkLimits | null {
  const minCrypto = toNumberValue(raw.minCrypto ?? raw.min_crypto ?? raw.minCryptoAmount);
  const maxCrypto = toNumberValue(raw.maxCrypto ?? raw.max_crypto ?? raw.maxCryptoAmount);
  const minLocalCurrency = toNumberValue(raw.minLocalCurrency ?? raw.min_local_currency ?? raw.minLocalAmount);
  const maxLocalCurrency = toNumberValue(raw.maxLocalCurrency ?? raw.max_local_currency ?? raw.maxLocalAmount);
  const minUsd = toNumberValue(raw.minUsd ?? raw.min_usd ?? raw.minUsdAmount);
  const maxUsd = toNumberValue(raw.maxUsd ?? raw.max_usd ?? raw.maxUsdAmount);

  if (
    minCrypto === null &&
    maxCrypto === null &&
    minLocalCurrency === null &&
    maxLocalCurrency === null &&
    minUsd === null &&
    maxUsd === null
  ) {
    return null;
  }

  return {
    minCrypto,
    maxCrypto,
    minLocalCurrency,
    maxLocalCurrency,
    minUsd,
    maxUsd,
  };
}

function normalizeRate(raw: JsonRecord, paymentChannel: FonbnkPaymentChannel, carrierCode?: string): FonbnkRate {
  const quoteId = toStringValue(raw.quoteId ?? raw.id ?? raw.quote_id);
  const localCurrencyAmount = toStringValue(
    raw.localCurrencyAmount ?? raw.local_currency_amount ?? raw.amountLocalCurrency ?? raw.localAmount,
  );
  const cryptoAmount = toStringValue(raw.cryptoAmount ?? raw.crypto_amount ?? raw.amountCrypto ?? raw.amount);
  const exchangeRate =
    toStringValue(raw.exchangeRate ?? raw.exchange_rate) ??
    (() => {
      const local = toNumberValue(localCurrencyAmount);
      const crypto = toNumberValue(cryptoAmount);
      if (local !== null && crypto !== null && crypto > 0) {
        return String(local / crypto);
      }
      return null;
    })();

  return {
    quoteId,
    paymentChannel,
    carrierCode,
    localCurrencyAmount,
    cryptoAmount,
    exchangeRate,
  };
}

function extractCountry(raw: JsonRecord, countryIsoCode: string) {
  const countries = Array.isArray(raw.countries) ? raw.countries : Array.isArray(raw.data) ? raw.data : [];
  const country = countries.find((entry) => {
    const value = asRecord(entry);
    const iso = toStringValue(value.countryIsoCode ?? value.country_iso_code ?? value.isoCode ?? value.code);
    return iso?.toUpperCase() === countryIsoCode.toUpperCase();
  });

  return country ? asRecord(country) : null;
}

function extractSupportedAssets(raw: JsonRecord) {
  const assets = Array.isArray(raw.assets) ? raw.assets : Array.isArray(raw.data) ? raw.data : [];
  const result = new Set<Stablecoin>();
  for (const asset of assets) {
    const value = asRecord(asset);
    const token = stablecoinFromAsset(
      toStringValue(value.asset ?? value.symbol ?? value.token ?? value.code),
    );
    if (token) {
      result.add(token);
    }
  }
  for (const token of FONBNK_SUPPORTED_ASSETS) {
    if (result.size === 0) {
      result.add(token);
    }
  }
  return [...result];
}

function extractPaymentChannels(raw: JsonRecord, country: JsonRecord) {
  const channels = Array.isArray(country.paymentChannels)
    ? country.paymentChannels
    : Array.isArray(country.payment_channels)
      ? country.payment_channels
      : Array.isArray(raw.paymentChannels)
        ? raw.paymentChannels
        : Array.isArray(raw.data)
          ? raw.data
          : [];

  return channels
    .map((channel) => {
      const value = asRecord(channel);
      const paymentChannel =
        pickPaymentChannel(
          value.paymentChannel ?? value.payment_channel ?? value.channel ?? value.type ?? value.id,
        ) ?? null;
      if (!paymentChannel) {
        return null;
      }

      const carriers = Array.isArray(value.carriers) ? value.carriers : [];
      const carrierList = carriers
        .map((carrier) => {
          const carrierValue = asRecord(carrier);
          const carrierId = toStringValue(carrierValue.id ?? carrierValue.carrierId ?? carrierValue.carrier_id);
          const carrierCode = toStringValue(carrierValue.code ?? carrierValue.carrierCode ?? carrierValue.carrier_code);
          const carrierName = toStringValue(carrierValue.name ?? carrierValue.carrierName ?? carrierValue.label);
          return {
            carrierId: carrierId ?? undefined,
            carrierCode: carrierCode ?? undefined,
            carrierName: carrierName ?? carrierId ?? carrierCode ?? paymentChannel,
          };
        })
        .filter(Boolean);

      return {
        paymentChannel,
        paymentChannelLabel:
          toStringValue(value.name ?? value.label ?? value.paymentChannelLabel ?? paymentChannel) ?? paymentChannel,
        carriers: carrierList,
      };
    })
    .filter((channel): channel is NonNullable<typeof channel> => Boolean(channel));
}

function extractCountryIsoCode(raw: JsonRecord, fallback: string) {
  return (
    toStringValue(raw.countryIsoCode ?? raw.country_iso_code ?? raw.isoCode ?? raw.code)?.toUpperCase() ??
    fallback.toUpperCase()
  );
}

function deriveCountryName(raw: JsonRecord, countryIsoCode: string) {
  return (
    toStringValue(raw.countryName ?? raw.country_name ?? raw.name ?? raw.label) ?? countryIsoCode.toUpperCase()
  );
}

function deriveCurrencyIsoCode(raw: JsonRecord) {
  return toStringValue(raw.currencyIsoCode ?? raw.currency_iso_code ?? raw.currency ?? raw.localCurrency) ?? "";
}

function deriveRedirectUrl(env: Env, linkId: string, existing?: string | null) {
  return (
    existing ??
    `${fonbnkPayBaseUrl(env)}/wallet?redirectUrl=${encodeURIComponent(`https://paygrid.xyz/pay/${linkId}`)}`
  );
}

function getRouterOwnerWalletClient(env: Env) {
  const privateKey = requireConfig(env.ROUTER_OWNER_PRIVATE_KEY, "ROUTER_OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount(privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`));
  const chain = {
    ...celoSepolia,
    id: env.CHAIN_ID,
    rpcUrls: { default: { http: [env.CELO_SEPOLIA_RPC] } },
  };
  return createWalletClient({ chain, transport: http(env.CELO_SEPOLIA_RPC), account });
}

function isSuccessWebhookStatus(status: string) {
  return ["completed", "complete", "confirmed", "paid", "settled", "swap_seller_confirmed"].includes(
    status.toLowerCase(),
  );
}

function isFailureWebhookStatus(status: string) {
  return ["failed", "cancelled", "canceled", "expired", "rejected"].includes(status.toLowerCase());
}

function extractWebhookOrderKey(payload: FonbnkWebhookPayload) {
  return (
    payload.orderParams ??
    payload.orderId ??
    payload.sessionId ??
    toStringValue(payload.data?.orderParams ?? payload.data?.orderId ?? payload.data?.sessionId) ??
    null
  );
}

function extractWebhookTxHash(payload: FonbnkWebhookPayload) {
  return (
    payload.txHash ??
    payload.hash ??
    toStringValue(payload.data?.txHash ?? payload.data?.hash ?? payload.data?.transactionHash) ??
    null
  );
}

async function findSessionByWebhookOrderKey(env: Env, orderKey: string) {
  const supabase = getSupabase(env);
  const { data } = await supabase.from("onramp_sessions").select("*").eq("id", orderKey).maybeSingle();
  return data ?? null;
}

async function resolveWebhookSession(env: Env, payload: FonbnkWebhookPayload) {
  const orderKey = extractWebhookOrderKey(payload);
  if (!orderKey) {
    throw new ApiError(400, "VALIDATION_ERROR", "Missing order identifier in Fonbnk webhook payload");
  }

  const directSession = await findSessionByWebhookOrderKey(env, orderKey);
  if (directSession) {
    return { session: directSession as OnrampSessionRow, orderKey, orderId: orderKey, orderDetails: null as JsonRecord | null };
  }

  const orderDetails = await requestFonbnkOrderDetails(env, new URLSearchParams({ orderId: orderKey })).catch(
    () => ({} as JsonRecord),
  );
  const sessionId =
    toStringValue(orderDetails.orderParams ?? orderDetails.sessionId ?? orderDetails.order_params) ?? null;
  if (!sessionId) {
    throw new ApiError(404, "NOT_FOUND", `No onramp session found for ${orderKey}`);
  }

  const fallbackSession = await findSessionByWebhookOrderKey(env, sessionId);
  if (!fallbackSession) {
    throw new ApiError(404, "NOT_FOUND", `No onramp session found for ${orderKey}`);
  }

  return { session: fallbackSession as OnrampSessionRow, orderKey: sessionId, orderId: orderKey, orderDetails };
}

async function settlePaymentOnChain(
  env: Env,
  args: {
    sessionId: string;
    linkId: string;
    token: Stablecoin;
    amount: string;
    onrampTxId: string;
  },
) {
  const supabase = getSupabase(env);
  const { data: link, error } = await supabase
    .from("payment_links")
    .select("*")
    .eq("id", args.linkId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }
  if (!link) {
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  }

  const tokenAddress = TOKEN_ADDRESSES[args.token];
  const amountWei = parseHumanAmount(args.amount, args.token);
  const onrampTxId = keccak256(toBytes(args.onrampTxId));
  const walletClient = getRouterOwnerWalletClient(env);
  const publicClient = createPublicClient({
    chain: { ...celoSepolia, id: env.CHAIN_ID, rpcUrls: { default: { http: [env.CELO_SEPOLIA_RPC] } } },
    transport: http(env.CELO_SEPOLIA_RPC),
  });
  const { request } = await publicClient.simulateContract({
    address: env.PAYGRID_ROUTER_ADDRESS,
    abi: paygridRouterAbiConst,
    functionName: "payWithFiat",
    args: [BigInt(link.on_chain_link_id), tokenAddress, amountWei, onrampTxId],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const now = new Date().toISOString();
  const fee = formatHumanAmount((amountWei * 50n) / 10000n, args.token);
  const paymentInsert = {
    link_id: link.id,
    payer_address: env.PAYGRID_ROUTER_ADDRESS.toLowerCase(),
    amount: args.amount,
    token: args.token,
    fee_amount: fee,
    payment_method: "fonbnk",
    onramp_session_id: args.sessionId,
    onramp_tx_id: args.onrampTxId,
    tx_hash: txHash,
    status: "confirmed",
    confirmed_at: now,
  };

  const { error: paymentError } = await supabase.from("payments").insert(paymentInsert);

  if (paymentError) {
    if (paymentError.code !== "23505") {
      throw new ApiError(500, "INTERNAL_ERROR", paymentError.message);
    }

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
        payment_method: "fonbnk",
      })
      .eq("id", existingPaymentId);
  }

  await supabase
    .from("onramp_sessions")
    .update({ status: "completed", tx_hash: txHash, confirmed_at: now })
    .eq("id", args.sessionId);

  await supabase
    .from("payment_links")
    .update({ status: "paid", tx_hash: txHash })
    .eq("id", link.id);

  return { txHash };
}

export async function getFonbnkCountryConfig(
  env: Env,
  countryIsoCode: string,
  deps: FonbnkDeps = {},
): Promise<FonbnkCountry> {
  const paymentChannelsRaw = await requestFonbnkPaymentChannels(env, deps);
  const assetsRaw = await requestFonbnkAssets(env, deps);
  const country = extractCountry(paymentChannelsRaw, countryIsoCode);
  if (!country) {
    throw new ApiError(404, "NOT_FOUND", `Fonbnk is not available for country ${countryIsoCode}`);
  }

  const currencyIsoCode = deriveCurrencyIsoCode(country) || toStringValue(paymentChannelsRaw.currencyIsoCode) || "";
  const supportedAssets = extractSupportedAssets(assetsRaw).filter((asset) => FONBNK_SUPPORTED_ASSETS.includes(asset));
  const channels = extractPaymentChannels(paymentChannelsRaw, country);

  const carriers = await Promise.all(
    channels.flatMap((channel) =>
      channel.carriers.length > 0
        ? channel.carriers.map(async (carrier) => {
            const limitsRaw = await requestFonbnkLimits(
              env,
              {
                countryIsoCode: extractCountryIsoCode(country, countryIsoCode),
                paymentChannel: channel.paymentChannel,
                carrierCode: carrier.carrierCode,
                asset: supportedAssets[0] ?? "USDC",
              },
              deps,
            );
            return {
              paymentChannel: channel.paymentChannel,
              paymentChannelLabel: channel.paymentChannelLabel,
              carrierId: carrier.carrierId,
              carrierCode: carrier.carrierCode,
              carrierName: carrier.carrierName,
              limits: normalizeLimits(limitsRaw),
            };
          })
        : [
            (async () => ({
              paymentChannel: channel.paymentChannel,
              paymentChannelLabel: channel.paymentChannelLabel,
              carrierId: undefined,
              carrierCode: undefined,
              carrierName: channel.paymentChannelLabel,
              limits: normalizeLimits(
                await requestFonbnkLimits(
                  env,
                  {
                    countryIsoCode: extractCountryIsoCode(country, countryIsoCode),
                    paymentChannel: channel.paymentChannel,
                    asset: supportedAssets[0] ?? "USDC",
                  },
                  deps,
                ),
              ),
            }))(),
          ],
    ),
  );

  const rates: Partial<Record<Stablecoin, FonbnkRate>> = {};
  for (const asset of supportedAssets) {
    const firstChannel = channels[0]?.paymentChannel;
    if (!firstChannel) {
      continue;
    }
    const firstCarrier = channels[0]?.carriers[0]?.carrierCode;
    const bestOfferRaw = await requestFonbnkBestOffer(
      env,
      {
        countryIsoCode: extractCountryIsoCode(country, countryIsoCode),
        paymentChannel: firstChannel,
        carrierCode: firstCarrier,
        asset,
        amount: "1",
      },
      deps,
    );
    rates[asset] = normalizeRate(bestOfferRaw, firstChannel, firstCarrier);
  }

  return {
    countryIsoCode: extractCountryIsoCode(country, countryIsoCode),
    countryName: deriveCountryName(country, countryIsoCode),
    currencyIsoCode,
    carriers,
    rates,
    supportedAssets,
  };
}

export async function createFonbnkPaySession(
  env: Env,
  linkId: string,
  input: FonbnkSessionInput,
  deps: FonbnkDeps = {},
): Promise<FonbnkPaySession> {
  const supabase = getSupabase(env);
  const { data: link, error } = await supabase
    .from("payment_links")
    .select("*")
    .eq("id", linkId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }
  if (!link) {
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  }

  if (link.status === "paid") {
    throw new ApiError(409, "ALREADY_PAID", "Link already settled");
  }
  if (link.status !== "active") {
    throw new ApiError(410, "EXPIRED", `Link is ${link.status}`);
  }
  if (!Array.isArray(link.accepted_methods) || !link.accepted_methods.includes("fonbnk")) {
    throw new ApiError(400, "UNSUPPORTED_METHOD", "Fonbnk payments are not accepted for this link");
  }

  const token = link.token as Stablecoin;
  if (!FONBNK_SUPPORTED_ASSETS.includes(token)) {
    throw new ApiError(400, "UNSUPPORTED_METHOD", `Fonbnk does not support ${token} for fiat settlement yet`);
  }

  const countryConfig = await getFonbnkCountryConfig(env, input.countryIsoCode, deps);
  const paymentChannel = input.paymentChannel ?? countryConfig.carriers[0]?.paymentChannel;
  if (!paymentChannel) {
    throw new ApiError(502, "FONBNK_ERROR", `No Fonbnk payment channels available for ${input.countryIsoCode}`);
  }

  const carrierCode =
    input.carrierCode ?? countryConfig.carriers.find((carrier) => carrier.paymentChannel === paymentChannel)?.carrierCode;

  const amount = formatHumanAmount(parseHumanAmount(link.amount, token), token);
  const sessionInsert = await supabase
    .from("onramp_sessions")
    .insert({
      payment_link_id: link.id,
      provider: "fonbnk",
      amount: link.amount,
      token,
      fiat_amount: null,
      fiat_currency: countryConfig.currencyIsoCode || input.countryIsoCode,
      carrier: carrierCode ?? paymentChannel,
      status: "initiated",
    })
    .select("*")
    .single();

  if (sessionInsert.error || !sessionInsert.data) {
    throw new ApiError(500, "INTERNAL_ERROR", sessionInsert.error?.message ?? "Failed to create onramp session");
  }

  const session = sessionInsert.data as OnrampSessionRow;
  const quote = await requestFonbnkBestOffer(
    env,
    {
      countryIsoCode: input.countryIsoCode,
      paymentChannel,
      carrierCode,
      asset: token,
      amount,
    },
    deps,
  );
  const quoteId = toStringValue(quote.quoteId ?? quote.id ?? quote.quote_id);
  if (!quoteId) {
    throw new ApiError(502, "FONBNK_ERROR", "Fonbnk best-offer did not return a quoteId");
  }

  const orderBody: JsonRecord = {
    quoteId,
    network: FONBNK_NETWORK,
    amount,
    currency: "crypto",
    asset: token,
    email: input.email,
    userIp: input.userIp ?? "127.0.0.1",
    address: env.PAYGRID_ROUTER_ADDRESS,
    orderParams: session.id,
    redirectUrl:
      input.redirectUrl ?? `${fonbnkPayBaseUrl(env)}/wallet?redirectUrl=${encodeURIComponent(`https://paygrid.xyz/pay/${link.id}`)}`,
  };
  if (input.extraFields) {
    orderBody.extraFields = input.extraFields;
  }

  const order = await requestFonbnkOrderCreate(env, orderBody, deps);
  const orderId = toStringValue(order.id ?? order.orderId ?? order.order_id);
  const redirectUrl =
    toStringValue(order.redirectUrl ?? order.redirect_url ?? order.resumeUrl ?? order.resume_url) ??
    deriveRedirectUrl(env, link.id, input.redirectUrl);
  const fiatAmount =
    toStringValue(quote.localCurrencyAmount ?? quote.local_currency_amount ?? quote.amountLocalCurrency ?? quote.localAmount) ??
    null;

  const { error: updateError } = await supabase
    .from("onramp_sessions")
    .update({
      fiat_amount: fiatAmount,
      fiat_currency: toStringValue(order.fiatCurrency ?? order.fiat_currency ?? countryConfig.currencyIsoCode) ?? countryConfig.currencyIsoCode,
      carrier: carrierCode ?? paymentChannel,
    })
    .eq("id", session.id);

  if (updateError) {
    throw new ApiError(500, "INTERNAL_ERROR", updateError.message);
  }

  return {
    method: "fonbnk",
    session: {
      id: session.id,
      provider: "fonbnk",
      redirectUrl,
      orderId,
      countryIsoCode: input.countryIsoCode.toUpperCase(),
      paymentChannel,
      carrierCode: carrierCode ?? null,
      token,
      amount: link.amount,
      fiatCurrency: countryConfig.currencyIsoCode || input.countryIsoCode.toUpperCase(),
    },
  };
}

export function verifyFonbnkWebhookAuth(env: Env, rawBody: string, headers: Headers) {
  const secret = requireConfig(env.FONBNK_WEBHOOK_SECRET ?? env.FONBNK_API_KEY, "FONBNK_WEBHOOK_SECRET");
  const apiKey = headers.get("x-api-key");
  if (apiKey && apiKey === secret) {
    return true;
  }

  const signature = headers.get("x-signature");
  if (signature) {
    const expected = buildSignature(rawBody, secret);
    if (timingSafeEquals(signature, expected)) {
      return true;
    }
  }

  return false;
}

export async function handleFonbnkWebhook(
  env: Env,
  payload: FonbnkWebhookPayload,
  rawBody: string,
  headers: Headers,
) {
  if (!verifyFonbnkWebhookAuth(env, rawBody, headers)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid Fonbnk webhook signature");
  }

  const { session, orderKey, orderId, orderDetails } = await resolveWebhookSession(env, payload);
  const supabase = getSupabase(env);

  const existingPayment = await supabase
    .from("payments")
    .select("id")
    .eq("onramp_session_id", session.id)
    .maybeSingle();
  if (existingPayment.data) {
    return { status: "ok", idempotent: true };
  }

  const status = toStringValue(payload.status ?? payload.data?.status)?.toLowerCase() ?? "";
  if (isFailureWebhookStatus(status)) {
    await supabase.from("onramp_sessions").update({ status: "failed" }).eq("id", session.id);
    return { status: "failed" as const };
  }

  if (!isSuccessWebhookStatus(status)) {
    await supabase.from("onramp_sessions").update({ status: "processing" }).eq("id", session.id);
    return { status: "processing" as const };
  }

  const txHash = extractWebhookTxHash(payload);
  const resolvedTxHash =
    txHash ??
    toStringValue(orderDetails?.txHash ?? orderDetails?.hash ?? orderDetails?.transactionHash ?? orderDetails?.settlementTxHash) ??
    null;
  if (!resolvedTxHash) {
    throw new ApiError(502, "FONBNK_ERROR", "Fonbnk webhook did not include a settlement tx hash");
  }

  const linkResult = await supabase
    .from("payment_links")
    .select("*")
    .eq("id", session.payment_link_id)
    .maybeSingle();
  if (!linkResult.data) {
    throw new ApiError(404, "NOT_FOUND", "Payment link not found for Fonbnk session");
  }

  const link = linkResult.data as PaymentLinkRow;
  const amount = toStringValue(session.amount) ?? toStringValue(link.amount);
  if (!amount) {
    throw new ApiError(500, "INTERNAL_ERROR", "Missing payment amount for Fonbnk settlement");
  }
  const token = stablecoinFromAsset(toStringValue(session.token) ?? toStringValue(link.token));
  if (!token) {
    throw new ApiError(500, "INTERNAL_ERROR", "Missing settlement token for Fonbnk session");
  }

  const publicClient = createPublicClient({
    chain: { ...celoSepolia, id: env.CHAIN_ID, rpcUrls: { default: { http: [env.CELO_SEPOLIA_RPC] } } },
    transport: http(env.CELO_SEPOLIA_RPC),
  });
  const receipt = await publicClient.getTransactionReceipt({ hash: resolvedTxHash as `0x${string}` });
  const routerAddress = env.PAYGRID_ROUTER_ADDRESS.toLowerCase();
  const tokenAddress = TOKEN_ADDRESSES[token];
  const amountWei = parseHumanAmount(amount, token);
  const transferFound = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) {
      return false;
    }
    try {
      const decoded = decodeEventLog({ abi: ERC20_TRANSFER_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Transfer") {
        return false;
      }
      const args = decoded.args as { to?: string; value?: bigint };
      return args.to?.toLowerCase() === routerAddress && args.value === amountWei;
    } catch {
      return false;
    }
  });

  if (!transferFound) {
    throw new ApiError(502, "FONBNK_ERROR", "Fonbnk settlement tx did not transfer tokens to the router");
  }

  const settlement = await settlePaymentOnChain(env, {
    sessionId: session.id,
    linkId: session.payment_link_id,
    token,
    amount,
    onrampTxId: orderId ?? orderKey,
  });

  await supabase
    .from("onramp_sessions")
    .update({ status: "completed", tx_hash: settlement.txHash, confirmed_at: new Date().toISOString() })
    .eq("id", session.id);

  return { status: "ok", settled: true, txHash: settlement.txHash };
}

export async function getFonbnkOrderForSession(env: Env, orderId: string, deps: FonbnkDeps = {}) {
  return requestFonbnkOrderDetails(env, new URLSearchParams({ orderId }), deps);
}
