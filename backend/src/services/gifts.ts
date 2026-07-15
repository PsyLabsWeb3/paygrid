import { createHash, randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import type { Env } from "../config/env.js";
import type { GiftGasSponsorshipRow, GiftRow } from "../db/supabase.js";
import { getSupabase } from "../db/supabase.js";
import { withServerAttribution } from "../lib/attribution.js";
import { createChainClients } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import { giftRouterAbi, giftVaultAbi, requireGiftContracts } from "../lib/gifts.js";
import { getTokenAddress, parseHumanAmount, TOKEN_DECIMALS, type Stablecoin } from "../lib/tokens.js";
import { buildSwapExecution, quoteStablecoinAmount } from "./swaps.js";

const MIN_GIFT_USD = 0.5;
const GAS_AMOUNT_GRANULARITY = 10n ** 12n; // 0.000001 USDm
const MAINNET_USDC_FEE_ADAPTER = "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" as Address;
const MAINNET_USDT_FEE_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as Address;

type CreateGiftInput = {
  senderAddress: Address;
  senderAlias: string;
  recipientAlias: string;
  message: string;
  amount: string;
  token: Stablecoin;
  claimHash: Hex;
  expiresAt: string;
  sourceReferralCode?: string;
};

export function cleanGiftText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function hashGiftSecret(secret: string) {
  return keccak256(toBytes(secret)).toLowerCase();
}

export function parseStoredGiftAmount(value: string | number, token: Stablecoin) {
  return parseHumanAmount(value, token);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function serializePublicGift(gift: GiftRow) {
  const status = gift.status === "active" && new Date(gift.expires_at).getTime() < Date.now()
    ? "expired"
    : gift.status;
  return {
    id: gift.id,
    onChainGiftId: gift.on_chain_gift_id,
    senderAlias: gift.sender_alias,
    recipientAlias: gift.recipient_alias,
    message: gift.message,
    amount: String(gift.amount),
    token: gift.token,
    status,
    usedSwap: gift.used_swap,
    referralCode: gift.referral_code,
    fundingTxHash: gift.funding_tx_hash,
    claimTxHash: gift.claim_tx_hash,
    refundTxHash: gift.refund_tx_hash,
    expiresAt: gift.expires_at,
    claimedAt: gift.claimed_at,
    createdAt: gift.created_at,
    reference: `PG-${gift.id.slice(0, 8).toUpperCase()}`,
  };
}

async function getGiftRow(env: Env, id: string) {
  const { data, error } = await getSupabase(env).from("gifts").select("*").eq("id", id).maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Gift not found");
  return data as GiftRow;
}

export async function createGiftDraft(env: Env, input: CreateGiftInput) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < MIN_GIFT_USD) {
    throw new ApiError(400, "INVALID_AMOUNT", `Gift amount must be at least ${MIN_GIFT_USD.toFixed(2)}`);
  }
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() + 5 * 60_000) {
    throw new ApiError(400, "INVALID_EXPIRATION", "Gift expiration must be at least five minutes away");
  }

  const senderAlias = cleanGiftText(input.senderAlias, 40);
  const recipientAlias = cleanGiftText(input.recipientAlias, 40);
  const message = cleanGiftText(input.message, 240);
  if (!senderAlias || !recipientAlias || !message) {
    throw new ApiError(400, "INVALID_GIFT", "Sender, recipient and message are required");
  }

  const metadataHash = keccak256(toBytes(JSON.stringify({
    senderAlias,
    recipientAlias,
    message,
    amount: input.amount,
    token: input.token,
    expiresAt: expiresAt.toISOString(),
  })));
  const referralCode = randomBytes(4).toString("hex").toUpperCase();
  const { data, error } = await getSupabase(env)
    .from("gifts")
    .insert({
      sender_address: input.senderAddress.toLowerCase(),
      sender_alias: senderAlias,
      recipient_alias: recipientAlias,
      message,
      amount: input.amount,
      token: input.token,
      claim_hash: input.claimHash.toLowerCase(),
      metadata_hash: metadataHash,
      referral_code: referralCode,
      source_referral_code: input.sourceReferralCode?.toUpperCase() ?? null,
      expires_at: expiresAt.toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Gift insert failed");
  }

  const gift = data as GiftRow;
  return {
    ...serializePublicGift(gift),
    metadataHash,
    shareUrl: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/gift/${gift.id}`,
  };
}

export async function getPublicGift(env: Env, id: string) {
  return serializePublicGift(await getGiftRow(env, id));
}

export async function buildGiftFundingTx(
  env: Env,
  id: string,
  input: { payerToken: Stablecoin; slippageBps?: number },
  markFunding = true,
) {
  const contracts = requireGiftContracts(env);
  const gift = await getGiftRow(env, id);
  if (gift.status !== "draft" && gift.status !== "funding") {
    throw new ApiError(409, "GIFT_UNAVAILABLE", `Gift is ${gift.status}`);
  }

  const giftAmount = parseStoredGiftAmount(gift.amount, gift.token);
  const { publicClient } = createChainClients(env);
  const feeBps = await publicClient.readContract({
    address: contracts.router,
    abi: giftRouterAbi,
    functionName: "feeBps",
  });
  const fee = (giftAmount * feeBps) / 10000n;
  const requiredOut = giftAmount + fee;
  const quote = await quoteStablecoinAmount(env, input.payerToken, gift.token, requiredOut, input.slippageBps);
  const tokenIn = getTokenAddress(env, input.payerToken);
  const tokenOut = getTokenAddress(env, gift.token);
  const expiresAt = BigInt(Math.floor(new Date(gift.expires_at).getTime() / 1000));
  const amountInMax = BigInt(quote.amountInMax);

  const approveTx = {
    to: tokenIn,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [contracts.router, amountInMax],
    }),
    value: "0",
    amount: amountInMax.toString(),
    token: input.payerToken,
  };

  let fundData: Hex;
  if (quote.paymentMode === "exact") {
    fundData = encodeFunctionData({
      abi: giftRouterAbi,
      functionName: "createGift",
      args: [
        tokenOut,
        giftAmount,
        gift.claim_hash as Hex,
        gift.metadata_hash as Hex,
        expiresAt,
      ],
    });
  } else {
    const execution = await buildSwapExecution(env, quote, contracts.router, input.slippageBps);
    fundData = encodeFunctionData({
      abi: giftRouterAbi,
      functionName: "createGiftWithSwap",
      args: [{
        tokenIn,
        tokenOut,
        giftAmount,
        amountInMax,
        minAmountOut: requiredOut,
        swapTarget: execution.target,
        swapCalldata: execution.data,
        deadline: execution.deadline,
        claimHash: gift.claim_hash as Hex,
        metadataHash: gift.metadata_hash as Hex,
        expiresAt,
      }],
    });
  }

  if (markFunding) {
    await getSupabase(env).from("gifts").update({
      status: "funding",
      payer_token: input.payerToken,
      used_swap: quote.paymentMode === "swap",
    }).eq("id", gift.id);
  }

  return {
    gift: serializePublicGift({
      ...gift,
      status: markFunding ? "funding" : gift.status,
      payer_token: input.payerToken,
    }),
    quote: {
      ...quote,
      giftAmount: giftAmount.toString(),
      fee: fee.toString(),
      totalSettlement: requiredOut.toString(),
      displayFee: formatUnits(fee, TOKEN_DECIMALS[gift.token]),
      displayTotal: formatUnits(requiredOut, TOKEN_DECIMALS[gift.token]),
      displayAmountInMax: formatUnits(amountInMax, TOKEN_DECIMALS[input.payerToken]),
    },
    approveTx,
    fundTx: { to: contracts.router, data: fundData, value: "0" },
  };
}

export async function quoteGiftFunding(
  env: Env,
  id: string,
  input: { payerToken: Stablecoin; slippageBps?: number },
) {
  const prepared = await buildGiftFundingTx(env, id, input, false);
  return { gift: prepared.gift, quote: prepared.quote };
}

export async function createClaimSession(env: Env, giftId: string, secret: string) {
  const gift = await getGiftRow(env, giftId);
  if (gift.status !== "active") throw new ApiError(409, "GIFT_UNAVAILABLE", `Gift is ${gift.status}`);
  if (new Date(gift.expires_at).getTime() <= Date.now()) {
    throw new ApiError(410, "EXPIRED", "Gift has expired");
  }
  const computedHash = hashGiftSecret(secret);
  if (computedHash !== gift.claim_hash.toLowerCase()) {
    throw new ApiError(403, "INVALID_CLAIM", "Gift claim code is invalid");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { error } = await getSupabase(env).from("gift_claim_sessions").insert({
    gift_id: gift.id,
    token_hash: hashSessionToken(token),
    expires_at: expiresAt,
  });
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  return { token, expiresAt };
}

type ClaimInput = { sessionToken: string; recipientAddress: Address };

type ClaimAuthorization = {
  gift: GiftRow;
  sessionId: string;
  tx: { to: Address; data: Hex; value: "0" };
  authorization: { nonce: string; deadline: string };
};

async function createClaimAuthorization(env: Env, giftId: string, input: ClaimInput): Promise<ClaimAuthorization> {
  const contracts = requireGiftContracts(env);
  const gift = await getGiftRow(env, giftId);
  if (gift.status !== "active" || !gift.on_chain_gift_id) {
    throw new ApiError(409, "GIFT_UNAVAILABLE", `Gift is ${gift.status}`);
  }
  if (new Date(gift.expires_at).getTime() <= Date.now()) {
    throw new ApiError(410, "EXPIRED", "Gift has expired");
  }
  if (input.recipientAddress.toLowerCase() === gift.sender_address.toLowerCase()) {
    throw new ApiError(400, "SELF_CLAIM", "Sender cannot claim their own gift");
  }

  const tokenHash = hashSessionToken(input.sessionToken);
  const { data: session, error } = await getSupabase(env)
    .from("gift_claim_sessions")
    .select("*")
    .eq("gift_id", gift.id)
    .eq("token_hash", tokenHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    throw new ApiError(403, "INVALID_SESSION", "Claim session is invalid or expired");
  }

  const { data: sponsorship, error: sponsorshipError } = await getSupabase(env)
    .from("gift_gas_sponsorships")
    .select("recipient_address")
    .eq("gift_id", gift.id)
    .maybeSingle();
  if (sponsorshipError && sponsorshipError.code !== "42P01") {
    throw new ApiError(500, "INTERNAL_ERROR", sponsorshipError.message);
  }
  if (sponsorship && String(sponsorship.recipient_address).toLowerCase() !== input.recipientAddress.toLowerCase()) {
    throw new ApiError(409, "GIFT_UNAVAILABLE", "Gift claim is already bound to another account");
  }

  const { publicClient } = createChainClients(env);
  const onchainGift = await publicClient.readContract({
    address: contracts.vault,
    abi: giftVaultAbi,
    functionName: "getGift",
    args: [BigInt(gift.on_chain_gift_id)],
  });
  const expectedAmount = parseStoredGiftAmount(gift.amount, gift.token);
  const expectedToken = getTokenAddress(env, gift.token);
  if (
    onchainGift.id !== BigInt(gift.on_chain_gift_id)
    || onchainGift.status !== 1
    || onchainGift.sender.toLowerCase() !== gift.sender_address.toLowerCase()
    || onchainGift.token.toLowerCase() !== expectedToken.toLowerCase()
    || onchainGift.amount !== expectedAmount
    || onchainGift.claimHash.toLowerCase() !== gift.claim_hash.toLowerCase()
    || onchainGift.expiresAt <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new ApiError(409, "GIFT_UNAVAILABLE", "Gift funding could not be verified onchain");
  }

  const signerKey = env.GIFT_CLAIM_SIGNER_PRIVATE_KEY ?? env.BACKEND_WALLET_PRIVATE_KEY;
  const signer = privateKeyToAccount(signerKey);
  const nonce = BigInt(`0x${randomBytes(8).toString("hex")}`);
  const deadline = BigInt(Math.floor((Date.now() + 10 * 60_000) / 1000));
  const signature = await signer.signTypedData({
    domain: {
      name: "PaygridGiftVault",
      version: "1",
      chainId: env.CHAIN_ID,
      verifyingContract: contracts.vault,
    },
    types: {
      ClaimGift: [
        { name: "giftId", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "ClaimGift",
    message: {
      giftId: BigInt(gift.on_chain_gift_id),
      recipient: input.recipientAddress,
      nonce,
      deadline,
    },
  });

  const data = encodeFunctionData({
    abi: giftVaultAbi,
    functionName: "claimGift",
    args: [BigInt(gift.on_chain_gift_id), nonce, deadline, signature],
  });
  return {
    gift,
    sessionId: String(session.id),
    tx: { to: contracts.vault, data, value: "0" },
    authorization: { nonce: nonce.toString(), deadline: deadline.toString() },
  };
}

export async function buildClaimAuthorization(env: Env, giftId: string, input: ClaimInput) {
  const prepared = await createClaimAuthorization(env, giftId, input);
  return { tx: prepared.tx, authorization: prepared.authorization };
}

export function roundUp(value: bigint, granularity: bigint) {
  if (granularity <= 0n) throw new Error("Granularity must be positive");
  return ((value + granularity - 1n) / granularity) * granularity;
}

export function applyGasSafety(value: bigint, safetyBps: number) {
  return (value * BigInt(10_000 + safetyBps) + 9_999n) / 10_000n;
}

export function feeAmountForSixDecimalToken(feeAmount18: bigint) {
  return (feeAmount18 + GAS_AMOUNT_GRANULARITY - 1n) / GAS_AMOUNT_GRANULARITY;
}

export function selectClaimFeeSource(input: {
  nativeBalance: bigint;
  nativeRequired: bigint;
  stablecoinBalances: Record<Stablecoin, bigint>;
  stablecoinRequirements: Partial<Record<Stablecoin, bigint>>;
}): "native" | Stablecoin | "sponsor" | "deposit" {
  if (input.nativeBalance >= input.nativeRequired) return "native";
  for (const token of ["USDm", "USDC", "USDT"] as const) {
    const required = input.stablecoinRequirements[token];
    if (required !== undefined && input.stablecoinBalances[token] >= required) return token;
  }
  return Object.values(input.stablecoinBalances).every((balance) => balance === 0n)
    ? "sponsor"
    : "deposit";
}

function getFeeAdapters(env: Env) {
  return {
    USDC: env.USDC_FEE_CURRENCY_ADDRESS ?? (env.CHAIN_ID === 42220 ? MAINNET_USDC_FEE_ADAPTER : undefined),
    USDT: env.USDT_FEE_CURRENCY_ADDRESS ?? (env.CHAIN_ID === 42220 ? MAINNET_USDT_FEE_ADAPTER : undefined),
  };
}

async function getFeeCurrencyGasPrice(publicClient: ReturnType<typeof createChainClients>["publicClient"], feeCurrency: Address) {
  const result = await publicClient.request({
    method: "eth_gasPrice",
    params: [feeCurrency],
  } as never) as unknown;
  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
    throw new Error("Invalid fee currency gas price");
  }
  return BigInt(result);
}

export function buildFeeCurrencyCaps(gasPrice: bigint, maxPriorityFeePerGas: bigint) {
  // Celo produces one-second blocks. A wider cap avoids a freshly prepared
  // CIP-64 transaction becoming stale before it reaches the next block.
  const maxFeePerGas = gasPrice * 2n;
  return {
    maxFeePerGas: maxFeePerGas > maxPriorityFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
    maxPriorityFeePerGas,
  };
}

async function getFeeCurrencyCaps(
  publicClient: ReturnType<typeof createChainClients>["publicClient"],
  feeCurrency: Address,
) {
  const [gasPrice, priorityResult] = await Promise.all([
    getFeeCurrencyGasPrice(publicClient, feeCurrency),
    publicClient.request({
      method: "eth_maxPriorityFeePerGas",
      params: [feeCurrency],
    } as never) as Promise<unknown>,
  ]);
  if (typeof priorityResult !== "string" || !/^0x[0-9a-f]+$/i.test(priorityResult)) {
    throw new Error("Invalid fee currency priority fee");
  }
  return buildFeeCurrencyCaps(gasPrice, BigInt(priorityResult));
}

async function estimateClaimGas(
  publicClient: ReturnType<typeof createChainClients>["publicClient"],
  recipient: Address,
  tx: ClaimAuthorization["tx"],
  fallback: bigint,
  feeCurrency?: Address,
) {
  try {
    return await publicClient.estimateGas({
      account: recipient,
      to: tx.to,
      data: tx.data,
      value: 0n,
      ...(feeCurrency ? { feeCurrency } : {}),
    } as never);
  } catch {
    return fallback;
  }
}

async function markSponsorship(
  env: Env,
  id: string,
  values: Partial<Pick<GiftGasSponsorshipRow, "status" | "tx_hash" | "failure_reason" | "submitted_at" | "confirmed_at">>,
) {
  const { error } = await getSupabase(env)
    .from("gift_gas_sponsorships")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
}

async function waitForSponsoredTransfer(env: Env, sponsorship: GiftGasSponsorshipRow) {
  if (!sponsorship.tx_hash) return sponsorship;
  const { publicClient } = createChainClients(env);
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: sponsorship.tx_hash as Hex,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      await markSponsorship(env, sponsorship.id, { status: "failed", failure_reason: "Transaction reverted" });
      throw new ApiError(503, "SPONSOR_UNAVAILABLE", "Account preparation is temporarily unavailable");
    }
    await markSponsorship(env, sponsorship.id, {
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      failure_reason: null,
    });
    return { ...sponsorship, status: "confirmed" as const };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "SPONSOR_UNAVAILABLE", "Account preparation is still confirming");
  }
}

async function sponsorClaimFee(
  env: Env,
  gift: GiftRow,
  recipient: Address,
  amount: bigint,
) {
  if (env.GIFT_GAS_SPONSOR_ENABLED !== "true" || !env.GIFT_GAS_SPONSOR_PRIVATE_KEY) {
    throw new ApiError(402, "INSUFFICIENT_NETWORK_FEE", "This account needs a small deposit before claiming");
  }
  const maxPerClaim = parseHumanAmount(env.GIFT_GAS_SPONSOR_MAX_PER_CLAIM_USDM ?? "0.01", "USDm");
  if (amount > maxPerClaim) {
    throw new ApiError(503, "SPONSOR_UNAVAILABLE", "Account preparation exceeds the configured safety limit");
  }

  const amountDisplay = formatUnits(amount, TOKEN_DECIMALS.USDm);
  const { data, error } = await getSupabase(env).rpc("reserve_gift_gas_sponsorship", {
    p_gift_id: gift.id,
    p_recipient_address: recipient.toLowerCase(),
    p_amount: amountDisplay,
    p_daily_amount_limit: env.GIFT_GAS_SPONSOR_DAILY_LIMIT_USDM ?? "2",
    p_daily_claim_limit: env.GIFT_GAS_SPONSOR_DAILY_CLAIM_LIMIT ?? 100,
  });
  if (error) {
    if (error.message.includes("SPONSOR_DAILY_LIMIT")) {
      throw new ApiError(429, "SPONSOR_LIMIT_REACHED", "Account preparation is temporarily at capacity");
    }
    if (error.message.includes("RECIPIENT_ALREADY_SPONSORED") || error.message.includes("SPONSORED_RECIPIENT_MISMATCH")) {
      throw new ApiError(409, "SPONSOR_UNAVAILABLE", "This account is not eligible for another preparation credit");
    }
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }
  const sponsorship = (Array.isArray(data) ? data[0] : data) as GiftGasSponsorshipRow | null;
  if (!sponsorship) throw new ApiError(500, "INTERNAL_ERROR", "Sponsorship reservation failed");
  if (sponsorship.status === "confirmed") return sponsorship;
  if (sponsorship.status === "submitted") return waitForSponsoredTransfer(env, sponsorship);
  if (sponsorship.status !== "reserved") {
    throw new ApiError(503, "SPONSOR_UNAVAILABLE", "Account preparation is temporarily unavailable");
  }

  const sponsor = createChainClients(env, env.GIFT_GAS_SPONSOR_PRIVATE_KEY);
  const usdm = getTokenAddress(env, "USDm");
  const reservedAmount = parseHumanAmount(sponsorship.amount, "USDm");
  const balance = await sponsor.publicClient.readContract({
    address: usdm,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [sponsor.account.address],
  });
  if (balance < reservedAmount) {
    await markSponsorship(env, sponsorship.id, { status: "failed", failure_reason: "Sponsor balance unavailable" });
    throw new ApiError(503, "SPONSOR_UNAVAILABLE", "Account preparation is temporarily unavailable");
  }

  let hash: Hex | undefined;
  try {
    const transferData = withServerAttribution(env, encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, reservedAmount],
    }));
    // The sponsor pays its own transaction fee in CELO. Using the USDm
    // stipend as fee currency here creates a bootstrap dependency and its
    // CIP-64 fee cap can become stale before the one-second Celo block lands.
    hash = await sponsor.walletClient.sendTransaction({
      account: sponsor.account,
      to: usdm,
      data: transferData,
      value: 0n,
    });
    await markSponsorship(env, sponsorship.id, {
      status: "submitted",
      tx_hash: hash,
      submitted_at: new Date().toISOString(),
    });
    return waitForSponsoredTransfer(env, { ...sponsorship, status: "submitted", tx_hash: hash });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (!hash) {
      await markSponsorship(env, sponsorship.id, {
        status: "failed",
        failure_reason: error instanceof Error ? error.message.slice(0, 240) : "Transfer failed",
      });
    }
    throw new ApiError(503, "SPONSOR_UNAVAILABLE", "Account preparation is temporarily unavailable");
  }
}

export async function buildClaimPreparation(env: Env, giftId: string, input: ClaimInput) {
  const prepared = await createClaimAuthorization(env, giftId, input);
  const tx = { ...prepared.tx, data: withServerAttribution(env, prepared.tx.data) };
  const { publicClient } = createChainClients(env);
  const fallbackGas = BigInt(env.GIFT_CLAIM_GAS_FALLBACK ?? 250_000);
  const estimatedNativeGas = await estimateClaimGas(publicClient, input.recipientAddress, tx, fallbackGas);
  const gas = applyGasSafety(estimatedNativeGas, env.GIFT_GAS_SPONSOR_SAFETY_BPS ?? 2500);
  const nativeGasPrice = await publicClient.getGasPrice();
  const nativeBalance = await publicClient.getBalance({ address: input.recipientAddress });

  let feeCurrency: Address | undefined;
  let sponsorship: GiftGasSponsorshipRow | undefined;
  if (nativeBalance < gas * nativeGasPrice) {
    const tokenAddresses = {
      USDm: getTokenAddress(env, "USDm"),
      USDC: getTokenAddress(env, "USDC"),
      USDT: getTokenAddress(env, "USDT"),
    };
    const [usdmBalance, usdcBalance, usdtBalance] = await Promise.all(
      (["USDm", "USDC", "USDT"] as const).map((token) => publicClient.readContract({
        address: tokenAddresses[token],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [input.recipientAddress],
      })),
    );
    const balances = { USDm: usdmBalance, USDC: usdcBalance, USDT: usdtBalance };
    const adapters = getFeeAdapters(env);
    const candidates = [
      { token: "USDm" as const, feeCurrency: tokenAddresses.USDm },
      ...(adapters.USDC ? [{ token: "USDC" as const, feeCurrency: adapters.USDC }] : []),
      ...(adapters.USDT ? [{ token: "USDT" as const, feeCurrency: adapters.USDT }] : []),
    ];

    const stablecoinRequirements: Partial<Record<Stablecoin, bigint>> = {};
    const feeCurrencies: Partial<Record<Stablecoin, Address>> = {};
    for (const candidate of candidates) {
      try {
        const candidateGasPrice = await getFeeCurrencyGasPrice(publicClient, candidate.feeCurrency);
        const needed18 = gas * candidateGasPrice;
        stablecoinRequirements[candidate.token] = candidate.token === "USDm"
          ? needed18
          : feeAmountForSixDecimalToken(needed18);
        feeCurrencies[candidate.token] = candidate.feeCurrency;
      } catch {
        // Continue to the next supported fee currency.
      }
    }

    const feeSource = selectClaimFeeSource({
      nativeBalance,
      nativeRequired: gas * nativeGasPrice,
      stablecoinBalances: balances,
      stablecoinRequirements,
    });
    if (feeSource === "deposit") {
      throw new ApiError(402, "INSUFFICIENT_NETWORK_FEE", "This account needs a small deposit before claiming");
    }
    if (feeSource === "sponsor") {
      const usdmFeeCaps = await getFeeCurrencyCaps(publicClient, tokenAddresses.USDm);
      const stipend = roundUp(gas * usdmFeeCaps.maxFeePerGas, GAS_AMOUNT_GRANULARITY);
      sponsorship = await sponsorClaimFee(env, prepared.gift, input.recipientAddress, stipend);
      feeCurrency = tokenAddresses.USDm;
    } else if (feeSource !== "native") {
      feeCurrency = feeCurrencies[feeSource];
    }
  }

  const { error: consumeError } = await getSupabase(env)
    .from("gift_claim_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", prepared.sessionId)
    .is("consumed_at", null);
  if (consumeError) throw new ApiError(500, "INTERNAL_ERROR", consumeError.message);

  return {
    tx: {
      ...tx,
      gas: gas.toString(),
      ...(feeCurrency ? { feeCurrency } : {}),
    },
    authorization: prepared.authorization,
    sponsorship: sponsorship
      ? {
          required: true,
          status: "confirmed",
          amount: sponsorship.amount,
          token: "USDm",
          txHash: sponsorship.tx_hash,
        }
      : { required: false, status: "not_needed", amount: "0", token: "USDm", txHash: null },
  };
}

export async function buildGiftRefundTx(env: Env, giftId: string) {
  const contracts = requireGiftContracts(env);
  const gift = await getGiftRow(env, giftId);
  if (!gift.on_chain_gift_id || gift.status !== "active") {
    throw new ApiError(409, "GIFT_UNAVAILABLE", `Gift is ${gift.status}`);
  }
  if (new Date(gift.expires_at).getTime() >= Date.now()) {
    throw new ApiError(409, "NOT_EXPIRED", "Gift has not expired");
  }
  return {
    tx: {
      to: contracts.vault,
      data: encodeFunctionData({
        abi: giftVaultAbi,
        functionName: "refundExpiredGift",
        args: [BigInt(gift.on_chain_gift_id)],
      }),
      value: "0",
    },
  };
}

export async function getGiftLeaderboard(env: Env) {
  const { data, error } = await getSupabase(env)
    .from("gifts")
    .select("sender_address,sender_alias,claimant_address,amount,used_swap,referral_code,source_referral_code,claimed_at")
    .eq("status", "claimed")
    .order("claimed_at", { ascending: true });
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);

  const bySender = new Map<string, {
    address: string;
    alias: string;
    claims: number;
    volume: number;
    swaps: number;
    recipients: Set<string>;
    referrals: number;
  }>();
  const codeOwners = new Map<string, string>();
  for (const row of data ?? []) codeOwners.set(String(row.referral_code), String(row.sender_address));

  for (const row of data ?? []) {
    const address = String(row.sender_address).toLowerCase();
    const claimant = String(row.claimant_address ?? "").toLowerCase();
    if (!claimant || claimant === address) continue;
    const entry = bySender.get(address) ?? {
      address,
      alias: String(row.sender_alias),
      claims: 0,
      volume: 0,
      swaps: 0,
      recipients: new Set<string>(),
      referrals: 0,
    };
    if (!entry.recipients.has(claimant)) {
      entry.claims += 1;
      entry.recipients.add(claimant);
    }
    entry.volume += Number(row.amount);
    if (row.used_swap) entry.swaps += 1;
    bySender.set(address, entry);

    const referrerAddress = row.source_referral_code ? codeOwners.get(String(row.source_referral_code)) : undefined;
    if (referrerAddress && referrerAddress !== address) {
      const referrer = bySender.get(referrerAddress);
      if (referrer) referrer.referrals += 1;
    }
  }

  const entries = [...bySender.values()]
    .sort((a, b) => b.claims - a.claims || b.volume - a.volume)
    .slice(0, 100)
    .map((entry, index) => ({
      rank: index + 1,
      accountHint: entry.alias || `Account ${entry.address.slice(2, 6)}`,
      claimedGifts: entry.claims,
      uniqueRecipients: entry.recipients.size,
      claimedVolume: entry.volume.toFixed(2),
      swapGifts: entry.swaps,
      referralConversions: entry.referrals,
    }));

  return { entries, prizePoolUsd: 50, updatedAt: new Date().toISOString() };
}
