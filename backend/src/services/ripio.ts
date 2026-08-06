import { createHmac } from "node:crypto";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddressEqual,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Env } from "../config/env.js";
import {
  getSupabase,
  type RipioCanaryRunRow,
  type RipioProfileRow,
  type UserRow,
} from "../db/supabase.js";
import { withServerAttribution } from "../lib/attribution.js";
import { createChainClients, paygridLinkAbiConst, paygridRouterAbiConst } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import {
  calculateRouterFee,
  hasRipioAssetNetwork,
  isValidMexicanClabe,
  mapRipioEventStatus,
  shouldAdvanceRipioStatus,
  verifyRipioWebhookSignature,
} from "../lib/ripio.js";
import { createPaymentLink } from "./links.js";

type Json = Record<string, any>;
type RipioFetch = typeof fetch;

let oauthCache: { token: string; expiresAt: number } | null = null;

function apiBase(env: Env) {
  if (env.RIPIO_API_BASE_URL) return env.RIPIO_API_BASE_URL.replace(/\/$/, "");
  return env.RIPIO_ENV === "production" ? "https://skala.ripio.com" : "https://skala-sandbox.ripio.com";
}

const ripioSymbol = (env: Env) => env.RIPIO_WMXN_SYMBOL ?? "wMXN";
const ripioNetwork = (env: Env) => env.RIPIO_CELO_NETWORK ?? "CELO";
const ripioMaxMxn = (env: Env) => env.RIPIO_CANARY_MAX_MXN ?? "100";

function requireCanary(env: Env) {
  if (env.RIPIO_CANARY_ENABLED !== "true") {
    throw new ApiError(503, "CANARY_DISABLED", "Ripio SPEI canary is disabled");
  }
}

function privateKey(env: Env): Hex {
  const value = env.ROUTER_OWNER_PRIVATE_KEY;
  if (!value) throw new ApiError(503, "PREFLIGHT_FAILED", "Router operator key is not configured");
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new ApiError(503, "PREFLIGHT_FAILED", "Router operator key is invalid");
  }
  return normalized as Hex;
}

async function accessToken(env: Env, fetcher: RipioFetch = fetch) {
  if (oauthCache && oauthCache.expiresAt > Date.now() + 30_000) return oauthCache.token;
  const credentials = Buffer.from(`${env.RIPIO_CLIENT_ID}:${env.RIPIO_CLIENT_SECRET}`).toString("base64");
  const response = await fetcher(`${apiBase(env)}/oauth2/token/`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await response.json() as Json;
  if (!response.ok || !body.accessToken) {
    throw new ApiError(502, "RIPIO_ERROR", "Ripio authentication failed", { status: response.status });
  }
  oauthCache = { token: body.accessToken, expiresAt: Date.now() + Number(body.expiresIn ?? 300) * 1000 };
  return oauthCache.token;
}

async function ripioRequest(env: Env, path: string, init: RequestInit = {}, fetcher: RipioFetch = fetch) {
  const token = await accessToken(env, fetcher);
  const response = await fetcher(`${apiBase(env)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let body: Json = {};
  try { body = text ? JSON.parse(text) as Json : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    throw new ApiError(502, "RIPIO_ERROR", "Ripio request failed", {
      status: response.status,
      path,
      providerCode: body.code ?? body.error,
    });
  }
  return body;
}

function items(body: Json | Json[]): Json[] {
  if (Array.isArray(body)) return body;
  const value = body.results ?? body.items ?? body.data ?? body;
  return Array.isArray(value) ? value : [value];
}

function pickId(body: Json, ...names: string[]) {
  for (const name of names) if (typeof body[name] === "string" && body[name]) return body[name] as string;
  return null;
}

function serializeProfile(profile: RipioProfileRow) {
  return {
    id: profile.id,
    customerCreated: Boolean(profile.provider_customer_id),
    termsAccepted: Boolean(profile.terms_accepted_at),
    kycStatus: profile.kyc_status,
    fiatAccountStatus: profile.fiat_account_status,
    clabeLast4: profile.clabe_last4,
    offrampReady: Boolean(profile.offramp_session_id && profile.offramp_deposit_address),
    celoDepositAddress: profile.offramp_deposit_address,
  };
}

function serializeRun(run: RipioCanaryRunRow) {
  return {
    id: run.id,
    paymentLinkId: run.payment_link_id,
    fiatAmount: String(run.fiat_amount),
    grossAmount: run.gross_amount && String(run.gross_amount),
    feeBps: run.fee_bps,
    feeAmount: run.fee_amount && String(run.fee_amount),
    netAmount: run.net_amount && String(run.net_amount),
    fundingInstructions: run.funding_instructions,
    status: run.status,
    onrampTxHash: run.onramp_tx_hash,
    releaseTxHash: run.release_tx_hash,
    createdAt: run.created_at,
    completedAt: run.completed_at,
  };
}

async function getProfileRow(env: Env, userId: string, required = false) {
  const { data, error } = await getSupabase(env).from("ripio_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!data && required) throw new ApiError(409, "RIPIO_ERROR", "Complete the Ripio profile first");
  return data as RipioProfileRow | null;
}

export async function getRipioProfile(env: Env, user: UserRow) {
  requireCanary(env);
  let profile = await getProfileRow(env, user.id);
  if (!profile) return null;
  const update: Json = {};
  if (profile.provider_customer_id && profile.kyc_status !== "COMPLETED") {
    const submissions = items(await ripioRequest(env, `/api/v1/customers/${profile.provider_customer_id}/kycSubmissions/`));
    const latest = submissions[0];
    const status = String(latest?.status ?? "").toUpperCase();
    if (["INCOMPLETE_USER_DATA", "IN_REVIEW", "COMPLETED", "FAILED"].includes(status)) update.kyc_status = status;
  }
  if (profile.provider_customer_id && profile.fiat_account_id && profile.fiat_account_status !== "ENABLED") {
    const accounts = items(await ripioRequest(env, `/api/v1/fiatAccounts/?customerId=${encodeURIComponent(profile.provider_customer_id)}&paymentMethodType=bank_transfer`));
    const account = accounts.find((item) => pickId(item, "fiatAccountId", "id") === profile!.fiat_account_id);
    const status = String(account?.status ?? "").toUpperCase();
    if (["UNCONFIRMED", "PROCESSING", "ENABLED", "DISABLED"].includes(status)) update.fiat_account_status = status;
  }
  if (Object.keys(update).length) {
    update.updated_at = new Date().toISOString();
    await getSupabase(env).from("ripio_profiles").update(update).eq("id", profile.id);
    profile = { ...profile, ...update } as RipioProfileRow;
  }
  return serializeProfile(profile);
}

export async function createOrResumeRipioProfile(env: Env, user: UserRow, email: string, redirectUrl: string) {
  requireCanary(env);
  const supabase = getSupabase(env);
  let profile = await getProfileRow(env, user.id);
  if (!profile) {
    const { data, error } = await supabase.from("ripio_profiles").insert({ user_id: user.id }).select().single();
    if (error || !data) throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Profile insert failed");
    profile = data as RipioProfileRow;
  }
  let customerId = profile.provider_customer_id;
  if (!customerId) {
    const customer = await ripioRequest(env, "/api/v1/customers/", {
      method: "POST", body: JSON.stringify({ email, type: "INDIVIDUAL" }),
    });
    customerId = pickId(customer, "customerId", "id");
    if (!customerId) throw new ApiError(502, "RIPIO_ERROR", "Ripio returned no customer id");
    await supabase.from("ripio_profiles").update({ provider_customer_id: customerId, updated_at: new Date().toISOString() }).eq("id", profile.id);
  }
  let termsId = profile.terms_id;
  if (!profile.terms_accepted_at) {
    const terms = items(await ripioRequest(env, "/api/v1/termsAndConditions/"))[0] ?? {};
    termsId = pickId(terms, "termsId", "id");
    if (!termsId) throw new ApiError(502, "RIPIO_ERROR", "Ripio returned no terms id");
    await ripioRequest(env, `/api/v1/customers/${customerId}/acceptTerms/`, {
      method: "POST", body: JSON.stringify({ termsId }),
    });
    await supabase.from("ripio_profiles").update({ terms_id: termsId, terms_accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", profile.id);
  }
  let providerUrl: string | null = null;
  if (profile.kyc_status !== "COMPLETED") {
    const kyc = await ripioRequest(env, `/api/v1/customers/${customerId}/kyc/`, {
      method: "POST", body: JSON.stringify({ redirectUrl }),
    });
    providerUrl = kyc.providerUrl ?? kyc.url ?? null;
    await supabase.from("ripio_profiles").update({
      kyc_submission_id: pickId(kyc, "submissionId", "id"), kyc_status: "IN_REVIEW", updated_at: new Date().toISOString(),
    }).eq("id", profile.id);
  }
  profile = await getProfileRow(env, user.id, true);
  return { profile: serializeProfile(profile!), kycUrl: providerUrl };
}

export async function createRipioFiatAccount(env: Env, user: UserRow, clabe: string) {
  requireCanary(env);
  if (!isValidMexicanClabe(clabe)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid CLABE");
  const profile = await getProfileRow(env, user.id, true);
  if (profile!.kyc_status !== "COMPLETED") throw new ApiError(409, "RIPIO_ERROR", "KYC must be completed first");
  const clabeHmac = createHmac("sha256", env.RIPIO_CLABE_HMAC_SECRET!).update(clabe).digest("hex");
  if (profile!.fiat_account_id) {
    if (profile!.clabe_hmac !== clabeHmac) throw new ApiError(409, "RIPIO_ERROR", "A different SPEI account is already registered for this canary");
    return getRipioProfile(env, user);
  }
  const account = await ripioRequest(env, "/api/v1/fiatAccounts/", {
    method: "POST",
    body: JSON.stringify({ customerId: profile!.provider_customer_id, paymentMethodType: "bank_transfer", accountFields: { clabe_destination: clabe } }),
  });
  const accountId = pickId(account, "fiatAccountId", "id");
  if (!accountId) throw new ApiError(502, "RIPIO_ERROR", "Ripio returned no fiat account id");
  const status = String(account.status ?? "PROCESSING").toUpperCase();
  await getSupabase(env).from("ripio_profiles").update({
    fiat_account_id: accountId,
    fiat_account_status: ["ENABLED", "DISABLED", "UNCONFIRMED"].includes(status) ? status : "PROCESSING",
    clabe_last4: clabe.slice(-4), clabe_hmac: clabeHmac, updated_at: new Date().toISOString(),
  }).eq("id", profile!.id);
  return getRipioProfile(env, user);
}

function findCeloAddress(body: Json, env: Env) {
  const candidates = items(body).flatMap((item) => item.depositAddresses ?? item.addresses ?? [item]);
  const match = candidates.find((item) => {
    const chain = String(item.chain ?? item.network ?? item.networkName ?? "").toUpperCase();
    const currency = String(item.currency ?? item.asset ?? ripioSymbol(env)).toUpperCase();
    return chain === ripioNetwork(env).toUpperCase() && currency === ripioSymbol(env).toUpperCase();
  });
  const address = match?.address ?? match?.depositAddress;
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() as Address : null;
}

export async function createRipioOfframpSession(env: Env, user: UserRow) {
  requireCanary(env);
  const profile = await getProfileRow(env, user.id, true);
  if (profile!.fiat_account_status !== "ENABLED") throw new ApiError(409, "RIPIO_ERROR", "The SPEI account is not enabled");
  if (profile!.offramp_session_id && profile!.offramp_deposit_address) return getRipioProfile(env, user);
  const session = await ripioRequest(env, "/api/v1/offrampSession/", {
    method: "POST", body: JSON.stringify({ fiatAccountId: profile!.fiat_account_id }),
  });
  const sessionId = pickId(session, "offrampSessionId", "sessionId", "id");
  const address = findCeloAddress(session, env);
  if (!sessionId || !address) throw new ApiError(502, "PREFLIGHT_FAILED", "Ripio returned no wMXN Celo deposit address");
  await getSupabase(env).from("ripio_profiles").update({
    offramp_session_id: sessionId, offramp_deposit_address: address, updated_at: new Date().toISOString(),
  }).eq("id", profile!.id);
  return getRipioProfile(env, user);
}

async function assertProviderSupport(env: Env) {
  const [deposits, withdrawals] = await Promise.all([
    ripioRequest(env, `/api/v1/depositNetworks/?currency=${encodeURIComponent(ripioSymbol(env))}&include_currency=true`),
    ripioRequest(env, `/api/v1/withdrawalNetworks/?currency=${encodeURIComponent(ripioSymbol(env))}&include_currency=true`),
  ]);
  for (const response of [deposits, withdrawals]) {
    const match = hasRipioAssetNetwork(response, ripioNetwork(env), ripioSymbol(env), env.RIPIO_WMXN_ADDRESS!);
    if (!match) throw new ApiError(503, "PREFLIGHT_FAILED", "Ripio did not confirm the configured wMXN contract on Celo");
  }
}

export async function runRipioPreflight(env: Env, mxnAmount?: string) {
  requireCanary(env);
  if (env.CHAIN_ID !== 42220) throw new ApiError(503, "PREFLIGHT_FAILED", "Celo Mainnet is required");
  if (mxnAmount) {
    const amount = parseUnits(mxnAmount, 2);
    if (amount <= 0n) throw new ApiError(400, "INVALID_AMOUNT", "Canary amount must be greater than zero");
    if (amount > parseUnits(ripioMaxMxn(env), 2)) throw new ApiError(400, "INVALID_AMOUNT", `Canary limit is ${ripioMaxMxn(env)} MXN`);
  }
  const account = privateKeyToAccount(privateKey(env));
  const { publicClient } = createChainClients(env, privateKey(env));
  const [feeBps, owner, decimals, symbol, , routerLink, treasury] = await Promise.all([
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "feeBps" }) as Promise<bigint>,
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "owner" }) as Promise<Address>,
    publicClient.readContract({ address: env.RIPIO_WMXN_ADDRESS!, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: env.RIPIO_WMXN_ADDRESS!, abi: erc20Abi, functionName: "symbol" }),
    assertProviderSupport(env),
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "paygridLink" }) as Promise<Address>,
    publicClient.readContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "treasury" }) as Promise<Address>,
  ]);
  if (feeBps !== 1n) throw new ApiError(503, "PREFLIGHT_FAILED", "Router feeBps must equal 1", { observed: feeBps.toString() });
  if (!isAddressEqual(owner, account.address)) throw new ApiError(503, "PREFLIGHT_FAILED", "Router operator key does not control the configured Router");
  if (!isAddressEqual(routerLink, env.PAYGRID_LINK_ADDRESS)) throw new ApiError(503, "PREFLIGHT_FAILED", "Configured payment-link contract does not belong to the Router");
  if (env.PAYGRID_TREASURY_ADDRESS && !isAddressEqual(treasury, env.PAYGRID_TREASURY_ADDRESS)) throw new ApiError(503, "PREFLIGHT_FAILED", "Configured treasury does not match the Router");
  if (decimals !== 18 || symbol.toUpperCase() !== ripioSymbol(env).toUpperCase()) {
    throw new ApiError(503, "PREFLIGHT_FAILED", "Configured token is not the expected 18-decimal wMXN contract");
  }
  return { chainId: env.CHAIN_ID, feeBps: Number(feeBps), owner, routerLink, treasury, token: env.RIPIO_WMXN_ADDRESS, decimals, symbol };
}

export async function createRipioCanary(env: Env, user: UserRow, amountMxn: string) {
  await runRipioPreflight(env, amountMxn);
  const profile = await getProfileRow(env, user.id, true);
  if (profile!.kyc_status !== "COMPLETED" || profile!.fiat_account_status !== "ENABLED" || !profile!.offramp_deposit_address) {
    throw new ApiError(409, "RIPIO_ERROR", "Ripio profile, KYC, SPEI account and withdrawal session must be ready");
  }
  const supabase = getSupabase(env);
  const { data: existing } = await supabase.from("ripio_canary_runs").select("id, status").eq("profile_id", profile!.id).not("status", "in", '("FAILED","REFUNDED","COMPLETED")').maybeSingle();
  if (existing) throw new ApiError(409, "RIPIO_ERROR", "An unfinished Ripio canary already exists", { runId: existing.id, status: existing.status });
  const { data: initial, error: initialError } = await supabase.from("ripio_canary_runs").insert({
    profile_id: profile!.id, fiat_amount: amountMxn, status: "CREATING",
  }).select().single();
  if (initialError || !initial) throw new ApiError(500, "INTERNAL_ERROR", initialError?.message ?? "Canary insert failed");
  const run = initial as RipioCanaryRunRow;
  try {
    const quote = await ripioRequest(env, "/api/v1/quotes/", {
      method: "POST",
      body: JSON.stringify({ fromCurrency: "MXN", toCurrency: ripioSymbol(env), fromAmount: amountMxn, chain: ripioNetwork(env), paymentMethodType: "bank_transfer" }),
    });
    const quoteId = pickId(quote, "quoteId", "id");
    const gross = String(quote.finalToAmount ?? "");
    if (!quoteId || !/^\d+(\.\d+)?$/.test(gross) || parseUnits(gross, 18) <= 0n) throw new ApiError(502, "RIPIO_ERROR", "Ripio returned an invalid quote");
    const link = await createPaymentLink(env, {
      amount: gross, token: "wMXN", recipientAddress: profile!.offramp_deposit_address as Address,
      description: `Ripio SPEI canary ${run.id}`, acceptedMethods: ["ripio_spei"], creator: { id: user.id, type: "user" },
    });
    const { data: session, error: sessionError } = await supabase.from("onramp_sessions").insert({
      payment_link_id: link.id, provider: "ripio", provider_metadata: { externalRef: run.id }, amount: gross,
      token: "wMXN", fiat_amount: amountMxn, fiat_currency: "MXN", status: "initiated",
    }).select().single();
    if (sessionError || !session) throw new ApiError(500, "INTERNAL_ERROR", sessionError?.message ?? "Session insert failed");
    const order = await ripioRequest(env, "/api/v1/onramp/", {
      method: "POST",
      body: JSON.stringify({ customerId: profile!.provider_customer_id, quoteId, depositAddress: env.PAYGRID_ROUTER_ADDRESS, externalRef: run.id }),
    });
    const transaction = order.transaction ?? order;
    const orderId = pickId(transaction, "transactionId", "orderId", "id");
    const funding = order.fiatPaymentInstructions ?? transaction.fiatPaymentInstructions ?? {};
    if (!orderId || Object.keys(funding).length === 0) throw new ApiError(502, "RIPIO_ERROR", "Ripio returned incomplete funding instructions");
    await supabase.from("onramp_sessions").update({ provider_order_id: orderId, provider_metadata: { externalRef: run.id, quoteId } }).eq("id", session.id);
    const { data: updated, error } = await supabase.from("ripio_canary_runs").update({
      payment_link_id: link.id, onramp_session_id: session.id, provider_quote_id: quoteId, provider_order_id: orderId,
      gross_amount: gross, funding_instructions: funding, quote_expires_at: quote.expiration ?? quote.expiresAt ?? null, status: "WAITING_SPEI", updated_at: new Date().toISOString(),
    }).eq("id", run.id).select().single();
    if (error || !updated) throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Canary update failed");
    return serializeRun(updated as RipioCanaryRunRow);
  } catch (error) {
    await supabase.from("ripio_canary_runs").update({ status: "FAILED", error_code: error instanceof ApiError ? error.code : "INTERNAL_ERROR", updated_at: new Date().toISOString() }).eq("id", run.id);
    throw error;
  }
}

async function ownedRun(env: Env, user: UserRow, id: string) {
  const { data, error } = await getSupabase(env).from("ripio_canary_runs").select("*, ripio_profiles!inner(user_id)").eq("id", id).eq("ripio_profiles.user_id", user.id).maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Canary run not found");
  return data as unknown as RipioCanaryRunRow;
}

export async function getRipioCanary(env: Env, user: UserRow, id: string) {
  requireCanary(env);
  return serializeRun(await ownedRun(env, user, id));
}

async function verifyRouterReceipt(env: Env, run: RipioCanaryRunRow) {
  if (!run.onramp_tx_hash || !/^0x[a-fA-F0-9]{64}$/.test(run.onramp_tx_hash)) throw new ApiError(409, "PREFLIGHT_FAILED", "Missing on-chain wMXN transaction");
  const gross = parseUnits(run.gross_amount!, 18);
  const { publicClient } = createChainClients(env, privateKey(env));
  const receipt = await publicClient.getTransactionReceipt({ hash: run.onramp_tx_hash as Hex });
  if (receipt.status !== "success") throw new ApiError(409, "PREFLIGHT_FAILED", "wMXN transfer failed");
  let received = 0n;
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, env.RIPIO_WMXN_ADDRESS!)) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Transfer" && isAddressEqual(decoded.args.to, env.PAYGRID_ROUTER_ADDRESS)) received += decoded.args.value;
    } catch { /* unrelated event */ }
  }
  if (received < gross) throw new ApiError(409, "PREFLIGHT_FAILED", "Router received less wMXN than quoted", { expected: gross.toString(), received: received.toString() });
}

function isOperator(env: Env, privyId: string) {
  return (env.RIPIO_OPERATOR_PRIVY_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(privyId);
}

export async function releaseRipioCanary(env: Env, user: UserRow, privyId: string, id: string, confirmation: string) {
  requireCanary(env);
  if (!isOperator(env, privyId)) throw new ApiError(403, "FORBIDDEN", "Operator access required");
  if (confirmation !== `RELEASE ${id}`) throw new ApiError(400, "VALIDATION_ERROR", `Type RELEASE ${id} exactly`);
  const supabase = getSupabase(env);
  const run = await ownedRun(env, user, id);
  if (run.status !== "READY_FOR_RELEASE" || run.release_tx_hash) throw new ApiError(409, "ALREADY_PAID", "Canary is not releasable");
  await runRipioPreflight(env);
  await verifyRouterReceipt(env, run);
  const { data: link } = await supabase.from("payment_links").select("*").eq("id", run.payment_link_id).single();
  if (!link || link.status !== "active") throw new ApiError(409, "ALREADY_PAID", "Payment link is not active");
  const gross = parseUnits(run.gross_amount!, 18);
  const { fee, net } = calculateRouterFee(gross, 1n);
  const providerTxId = keccak256(stringToHex(run.provider_order_id!));
  const { publicClient, walletClient } = createChainClients(env, privateKey(env));
  const routerBalance = await publicClient.readContract({ address: env.RIPIO_WMXN_ADDRESS!, abi: erc20Abi, functionName: "balanceOf", args: [env.PAYGRID_ROUTER_ADDRESS] });
  if (routerBalance !== gross) throw new ApiError(409, "PREFLIGHT_FAILED", "Router wMXN balance must equal this canary gross exactly", { expected: gross.toString(), observed: routerBalance.toString() });
  const args = [BigInt(link.on_chain_link_id), env.RIPIO_WMXN_ADDRESS!, gross, providerTxId] as const;
  await publicClient.simulateContract({ address: env.PAYGRID_ROUTER_ADDRESS, abi: paygridRouterAbiConst, functionName: "payWithFiat", args, account: walletClient.account });
  const { data: locked } = await supabase.from("ripio_canary_runs").update({ status: "RELEASING", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "READY_FOR_RELEASE").is("release_tx_hash", null).select().maybeSingle();
  if (!locked) throw new ApiError(409, "ALREADY_PAID", "Canary was already claimed for release");
  try {
    const data = encodeFunctionData({ abi: paygridRouterAbiConst, functionName: "payWithFiat", args });
    const txHash = await walletClient.sendTransaction({ account: walletClient.account, to: env.PAYGRID_ROUTER_ADDRESS, data: withServerAttribution(env, data), value: 0n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("Release transaction reverted");
    const now = new Date().toISOString();
    await Promise.all([
      supabase.from("ripio_canary_runs").update({ status: "RELEASED", fee_bps: 1, fee_amount: formatUnits(fee, 18), net_amount: formatUnits(net, 18), release_tx_hash: txHash, released_at: now, updated_at: now }).eq("id", id),
      supabase.from("payment_links").update({ status: "paid" }).eq("id", run.payment_link_id),
      supabase.from("onramp_sessions").update({ status: "completed", tx_hash: run.onramp_tx_hash, confirmed_at: now }).eq("id", run.onramp_session_id),
      supabase.from("payments").insert({ link_id: run.payment_link_id, payer_address: env.PAYGRID_ROUTER_ADDRESS.toLowerCase(), amount: run.gross_amount, token: "wMXN", fee_amount: formatUnits(fee, 18), fee_bps: 1, payment_method: "ripio_spei", onramp_session_id: run.onramp_session_id, onramp_tx_id: run.provider_order_id, tx_hash: txHash, status: "confirmed", confirmed_at: now }),
    ]);
    return getRipioCanary(env, user, id);
  } catch (error) {
    await supabase.from("ripio_canary_runs").update({ status: "READY_FOR_RELEASE", error_code: "RELEASE_FAILED", error_detail: error instanceof Error ? error.message.slice(0, 500) : "Release failed", updated_at: new Date().toISOString() }).eq("id", id).is("release_tx_hash", null);
    throw error;
  }
}

export async function processRipioWebhook(env: Env, rawBody: string, signature: string | undefined) {
  requireCanary(env);
  if (!verifyRipioWebhookSignature(rawBody, signature, env.RIPIO_WEBHOOK_SECRET!)) throw new ApiError(401, "UNAUTHORIZED", "Invalid Ripio webhook signature");
  const event = JSON.parse(rawBody) as Json;
  const eventType = String(event.eventType ?? "");
  const payload = event.payload ?? event.transactionObject ?? {};
  const transaction = payload.transactionObject ?? payload.transaction ?? payload;
  const transactionId = pickId(transaction, "transactionId", "id");
  const externalRef = transaction.externalRef ?? payload.externalRef;
  const payloadHash = createHmac("sha256", env.RIPIO_WEBHOOK_SECRET!).update(rawBody).digest("hex");
  const supabase = getSupabase(env);
  const { data: inserted, error: insertError } = await supabase.from("ripio_webhook_events").insert({
    payload_hash: payloadHash, event_type: eventType, transaction_id: transactionId, issue_datetime: event.issueDatetime ?? null,
  }).select().maybeSingle();
  if (insertError?.code === "23505") return { duplicate: true };
  if (insertError || !inserted) throw new ApiError(500, "INTERNAL_ERROR", insertError?.message ?? "Webhook insert failed");
  try {
    if (eventType.startsWith("KYC.")) {
      const customerId = payload.customerId;
      const kycStatus = eventType === "KYC.COMPLETED" ? "COMPLETED" : eventType === "KYC.FAILED" ? "FAILED" : "IN_REVIEW";
      if (customerId) await supabase.from("ripio_profiles").update({ kyc_status: kycStatus, updated_at: new Date().toISOString() }).eq("provider_customer_id", customerId);
    } else {
      let query = supabase.from("ripio_canary_runs").select("*");
      if (externalRef) query = query.eq("id", externalRef);
      else if (eventType.startsWith("OFF-RAMP")) {
        const fiatAccountId = transaction.fiatAccountId ?? payload.fiatAccountId;
        const address = transaction.address ?? transaction.depositAddress;
        let profileQuery = supabase.from("ripio_profiles").select("*");
        if (fiatAccountId) profileQuery = profileQuery.eq("fiat_account_id", fiatAccountId);
        else if (address) profileQuery = profileQuery.eq("offramp_deposit_address", String(address).toLowerCase());
        else throw new Error("Off-ramp webhook has no account or address");
        const { data: profile } = await profileQuery.maybeSingle();
        if (!profile) throw new Error("No matching Ripio profile");
        query = query.eq("profile_id", profile.id).in("status", ["RELEASED", "OFFRAMP_DEPOSIT_RECEIVED", "OFFRAMP_TRADE_COMPLETED", "OFFRAMP_WITHDRAWAL_PROCESSING"]).order("released_at", { ascending: false }).limit(1);
      } else if (transactionId) query = query.eq("provider_order_id", transactionId);
      else throw new Error("Webhook has no correlation id");
      const { data } = await query.maybeSingle();
      if (!data) throw new Error("No matching canary run");
      const run = data as RipioCanaryRunRow;
      const { data: profile } = await supabase.from("ripio_profiles").select("*").eq("id", run.profile_id).single();
      if (!profile) throw new Error("Canary profile missing");
      if (externalRef && externalRef !== run.id) throw new Error("externalRef mismatch");
      if (eventType.startsWith("ON-RAMP") && transactionId !== run.provider_order_id) throw new Error("transaction id mismatch");
      const customerId = transaction.customerId ?? payload.customerId;
      if (!customerId || customerId !== profile.provider_customer_id) throw new Error("customer mismatch");
      if (eventType.startsWith("ON-RAMP")) {
        const quoteId = transaction.quoteId ?? payload.quoteId;
        if (!quoteId || quoteId !== run.provider_quote_id) throw new Error("quote mismatch");
      }
      if (eventType.startsWith("OFF-RAMP")) {
        const fiatAccountId = transaction.fiatAccountId ?? payload.fiatAccountId;
        const address = transaction.address ?? transaction.depositAddress;
        if (fiatAccountId !== profile.fiat_account_id || !address || !isAddressEqual(address as Address, profile.offramp_deposit_address as Address)) throw new Error("off-ramp account mismatch");
        if (String(transaction.chain ?? "").toUpperCase() !== ripioNetwork(env).toUpperCase() || String(transaction.fromCurrency ?? "").toUpperCase() !== ripioSymbol(env).toUpperCase()) throw new Error("off-ramp network or currency mismatch");
        const providerAmount = String(transaction.amount ?? transaction.fromAmount ?? "");
        if (run.net_amount && (!/^\d+(\.\d+)?$/.test(providerAmount) || parseUnits(providerAmount, 18) !== parseUnits(run.net_amount, 18))) throw new Error("off-ramp net amount mismatch");
      }
      const chain = String(transaction.chain ?? "").toUpperCase();
      const currency = String(transaction.toCurrency ?? transaction.currency ?? "").toUpperCase();
      const address = transaction.address ?? transaction.depositAddress;
      if (eventType === "ON-RAMP.WITHDRAWAL.COMPLETED") {
        if (chain !== ripioNetwork(env).toUpperCase() || currency !== ripioSymbol(env).toUpperCase() || !address || !isAddressEqual(address as Address, env.PAYGRID_ROUTER_ADDRESS)) throw new Error("Network, currency or destination mismatch");
        const txHash = transaction.txnHash ?? transaction.txHash;
        await supabase.from("ripio_canary_runs").update({ onramp_tx_hash: txHash, updated_at: new Date().toISOString() }).eq("id", run.id);
        run.onramp_tx_hash = txHash;
        await verifyRouterReceipt(env, run);
      }
      const next = mapRipioEventStatus(eventType);
      if (next && shouldAdvanceRipioStatus(run.status, next)) {
        const update: Json = { status: next, updated_at: new Date().toISOString() };
        if (eventType.startsWith("OFF-RAMP") && transactionId) update.offramp_transaction_id = transactionId;
        if (next === "COMPLETED") update.completed_at = new Date().toISOString();
        await supabase.from("ripio_canary_runs").update(update).eq("id", run.id);
      }
      await supabase.from("ripio_webhook_events").update({ canary_run_id: run.id }).eq("id", inserted.id);
    }
    await supabase.from("ripio_webhook_events").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", inserted.id);
    return { accepted: true };
  } catch (error) {
    await supabase.from("ripio_webhook_events").update({ processing_error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed", processed_at: new Date().toISOString() }).eq("id", inserted.id);
    throw new ApiError(409, "RIPIO_ERROR", "Ripio webhook validation failed");
  }
}
