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
import type { GiftRow } from "../db/supabase.js";
import { getSupabase } from "../db/supabase.js";
import { createChainClients } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import { giftRouterAbi, giftVaultAbi, requireGiftContracts } from "../lib/gifts.js";
import { getTokenAddress, parseHumanAmount, TOKEN_DECIMALS, type Stablecoin } from "../lib/tokens.js";
import { buildSwapExecution, quoteStablecoinAmount } from "./swaps.js";

const MIN_GIFT_USD = 0.5;

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

export async function buildClaimAuthorization(
  env: Env,
  giftId: string,
  input: { sessionToken: string; recipientAddress: Address },
) {
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
    tx: { to: contracts.vault, data, value: "0" },
    authorization: { nonce: nonce.toString(), deadline: deadline.toString() },
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
