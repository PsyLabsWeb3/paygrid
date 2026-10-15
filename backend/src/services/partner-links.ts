import { createHash } from "node:crypto";
import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import type { Env } from "../config/env.js";
import type { PaymentLinkRow, PaymentRow } from "../db/supabase.js";
import { getSupabase } from "../db/supabase.js";
import { withServerAttribution } from "../lib/attribution.js";
import { createChainClients, paygridLinkAbiConst } from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import { formatHumanAmount, getTokenAddress, TOKEN_DECIMALS, type Stablecoin } from "../lib/tokens.js";

export type OdeleitePaymentLinkInput = {
  external_business_id: string;
  external_link_id: string;
  recipient_address: Address;
  amount_atomic: string;
  settlement_asset: "USDC" | "wMXN";
  accepted_payer_assets: ("USDC" | "USDT" | "USDm" | "wMXN")[];
  description: string;
  merchant_display_name: string;
  expires_at: string;
  brand: "odeleite";
};

type PartnerPaymentLinkRow = Omit<PaymentLinkRow, "on_chain_link_id"> & {
  on_chain_link_id: string | null;
};

class PartnerTransactionRevertedError extends Error {}

type OnChainPaymentLink = {
  paid: boolean;
  cancelled: boolean;
};

export function classifyCancellationRace(state: OnChainPaymentLink) {
  if (state.paid) return "paid" as const;
  if (state.cancelled) return "cancelled" as const;
  return "active" as const;
}

let relayerQueue = Promise.resolve();

async function withRelayerLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = relayerQueue;
  let release = () => {};
  relayerQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function partnerRequestFingerprint(input: OdeleitePaymentLinkInput) {
  return createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex");
}

function serializePartnerLink(row: PartnerPaymentLinkRow, payment?: PaymentRow | null) {
  return {
    id: row.id,
    externalBusinessId: row.external_business_id,
    externalLinkId: row.external_link_id,
    onChainLinkId: row.on_chain_link_id,
    paygridLinkAddress: row.paygrid_link_address,
    recipientAddress: row.recipient_address,
    amountAtomic: row.amount_atomic,
    settlementAsset: row.token,
    settlementDecimals: row.settlement_decimals,
    acceptedPayerAssets: row.accepted_payer_assets,
    description: row.description,
    merchantDisplayName: row.merchant_display_name,
    expiresAt: row.expires_at,
    status: row.status,
    creationTxHash: row.creation_tx_hash,
    cancellationTxHash: row.cancellation_tx_hash,
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    payment: payment
      ? {
          payment_id: payment.id,
          external_link_id: row.external_link_id,
          provider_link_id: row.id,
          on_chain_link_id: row.on_chain_link_id,
          paygrid_link_address: row.paygrid_link_address,
          recipient_address: row.recipient_address,
          payer_address: payment.payer_address,
          payer_asset: payment.payer_token ?? payment.token,
          payer_asset_decimals: TOKEN_DECIMALS[(payment.payer_token ?? payment.token) as Stablecoin],
          payer_amount_atomic: payment.payer_amount_atomic,
          settlement_asset: row.token,
          settlement_decimals: row.settlement_decimals,
          fee_bps: payment.fee_bps,
          gross_amount_atomic: payment.gross_amount_atomic,
          fee_amount_atomic: payment.fee_amount_atomic,
          net_amount_atomic: payment.net_amount_atomic,
          transaction_hash: payment.tx_hash,
          block_number: payment.block_number,
          confirmed_at: payment.confirmed_at,
        }
      : null,
  };
}

async function readPartnerLink(env: Env, externalId: string) {
  const { data, error } = await getSupabase(env)
    .from("payment_links")
    .select("*")
    .eq("partner_name", "odeleite")
    .eq("external_link_id", externalId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Partner payment link not found");
  return data as PartnerPaymentLinkRow;
}

async function persistSignedTransaction(
  env: Env,
  rowId: string,
  data: Hex,
  kind: "creation" | "cancellation",
) {
  const { publicClient, walletClient, account } = createChainClients(
    env,
    env.ODELEITE_RELAYER_PRIVATE_KEY!,
  );
  const request = await publicClient.prepareTransactionRequest({
    account,
    to: env.PAYGRID_LINK_ADDRESS,
    data: withServerAttribution(env, data),
    value: 0n,
  });
  const serialized = await walletClient.signTransaction(request);
  const txHash = keccak256(serialized);
  const prefix = kind === "creation" ? "creation" : "cancellation";
  const { error } = await getSupabase(env).from("payment_links").update({
    [`signed_${prefix}_tx`]: serialized,
    [`${prefix}_tx_hash`]: txHash,
  }).eq("id", rowId);
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  return { serialized, txHash };
}

async function broadcastStoredTransaction(env: Env, serialized: Hex, txHash: Hex) {
  const { publicClient } = createChainClients(env, env.ODELEITE_RELAYER_PRIVATE_KEY!);
  try {
    await publicClient.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes("already known") && !message.includes("nonce too low")) throw error;
  }
  return publicClient.waitForTransactionReceipt({ hash: txHash });
}

async function markPartnerFailure(env: Env, row: PartnerPaymentLinkRow, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await getSupabase(env).from("payment_links").update({
    status: "failed",
    failure_code: "CHAIN_REJECTED",
    failure_detail: detail.slice(0, 500),
  }).eq("id", row.id);
  if (updateError) throw new ApiError(500, "INTERNAL_ERROR", updateError.message);
}

async function readOnChainPartnerLink(env: Env, onChainLinkId: string) {
  const { publicClient } = createChainClients(env, env.ODELEITE_RELAYER_PRIVATE_KEY!);
  return publicClient.readContract({
    address: env.PAYGRID_LINK_ADDRESS,
    abi: paygridLinkAbiConst,
    functionName: "getLink",
    args: [BigInt(onChainLinkId)],
  }) as Promise<OnChainPaymentLink>;
}

async function resolveCancellationRace(
  env: Env,
  row: PartnerPaymentLinkRow,
) {
  const onChain = await readOnChainPartnerLink(env, row.on_chain_link_id!);
  const outcome = classifyCancellationRace(onChain);
  if (outcome === "paid") {
    const { error } = await getSupabase(env).from("payment_links").update({
      status: "paid",
      signed_cancellation_tx: null,
    }).eq("id", row.id);
    if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
    throw new ApiError(409, "ALREADY_PAID", "Link was paid while cancellation was pending");
  }
  if (outcome === "cancelled") {
    const { data, error } = await getSupabase(env).from("payment_links").update({
      status: "cancelled",
      signed_cancellation_tx: null,
    }).eq("id", row.id).select("*").single();
    if (error || !data) {
      throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Update failed");
    }
    return serializePartnerLink(data as PartnerPaymentLinkRow);
  }

  const { error } = await getSupabase(env).from("payment_links").update({
    status: "active",
    cancellation_idempotency_key: null,
    cancellation_tx_hash: null,
    signed_cancellation_tx: null,
    failure_code: "CANCELLATION_REVERTED",
    failure_detail: "Cancellation reverted while the link remained active",
  }).eq("id", row.id);
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  throw new ApiError(502, "INTERNAL_ERROR", "Cancellation reverted; the link remains active");
}

async function activatePartnerLink(env: Env, row: PartnerPaymentLinkRow) {
  return withRelayerLock(async () => {
    const latest = row.external_link_id
      ? await readPartnerLink(env, row.external_link_id)
      : row;
    if (latest.status !== "creating") return latest;
    row = latest;
    let serialized = row.signed_creation_tx as Hex | null | undefined;
    let txHash = row.creation_tx_hash as Hex | null | undefined;
    if (!serialized || !txHash) {
      const data = encodeFunctionData({
        abi: paygridLinkAbiConst,
        functionName: "createLink",
        args: [
          getAddress(row.recipient_address),
          BigInt(row.amount_atomic!),
          getTokenAddress(env, row.token as Stablecoin),
          row.description ?? "",
          false,
          BigInt(Math.floor(new Date(row.expires_at!).getTime() / 1000)),
        ],
      });
      ({ serialized, txHash } = await persistSignedTransaction(
        env,
        row.id,
        data,
        "creation",
      ));
    }

    const receipt = await broadcastStoredTransaction(env, serialized, txHash);
    if (receipt.status !== "success") {
      throw new PartnerTransactionRevertedError("Link creation transaction reverted");
    }
    let onChainLinkId: bigint | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: paygridLinkAbiConst,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "LinkCreated" && "linkId" in decoded.args) {
          onChainLinkId = decoded.args.linkId as bigint;
          break;
        }
      } catch {
        // Another contract event from the same transaction.
      }
    }
    if (onChainLinkId === null) throw new Error("LinkCreated event missing from receipt");
    const { data, error } = await getSupabase(env).from("payment_links").update({
      on_chain_link_id: onChainLinkId.toString(),
      creation_tx_hash: txHash,
      tx_hash: txHash,
      signed_creation_tx: null,
      status: "active",
      failure_code: null,
      failure_detail: null,
    }).eq("id", row.id).select("*").single();
    if (error || !data) {
      throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Update failed");
    }
    return data as PartnerPaymentLinkRow;
  });
}

async function resumeIdempotentCreation(
  env: Env,
  row: PartnerPaymentLinkRow,
  fingerprint: string,
  idempotencyKey: string,
) {
  if (row.idempotency_key !== idempotencyKey || row.request_fingerprint !== fingerprint) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "External link or idempotency key was used with different data",
    );
  }
  const resumed = row.status === "creating" ? await activatePartnerLink(env, row) : row;
  return serializePartnerLink(resumed);
}

export async function createOdeleitePaymentLink(
  env: Env,
  input: OdeleitePaymentLinkInput,
  idempotencyKey: string,
) {
  const supabase = getSupabase(env);
  const fingerprint = partnerRequestFingerprint(input);
  const { data: existing, error: readError } = await supabase
    .from("payment_links")
    .select("*")
    .eq("partner_name", "odeleite")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (readError) throw new ApiError(500, "INTERNAL_ERROR", readError.message);
  if (existing) {
    return resumeIdempotentCreation(
      env,
      existing as PartnerPaymentLinkRow,
      fingerprint,
      idempotencyKey,
    );
  }

  const amountAtomic = BigInt(input.amount_atomic);
  const { data, error } = await supabase.from("payment_links").insert({
    creator_id: null,
    creator_type: null,
    on_chain_link_id: null,
    paygrid_link_address: env.PAYGRID_LINK_ADDRESS.toLowerCase(),
    recipient_address: input.recipient_address.toLowerCase(),
    amount: formatHumanAmount(amountAtomic, input.settlement_asset),
    amount_atomic: input.amount_atomic,
    token: input.settlement_asset,
    settlement_decimals: TOKEN_DECIMALS[input.settlement_asset],
    description: input.description || null,
    accepted_methods: ["crypto"],
    accepted_payer_assets: input.accepted_payer_assets,
    status: "creating",
    expires_at: input.expires_at,
    partner_name: "odeleite",
    external_business_id: input.external_business_id,
    external_link_id: input.external_link_id,
    idempotency_key: idempotencyKey,
    request_fingerprint: fingerprint,
    merchant_display_name: input.merchant_display_name,
    brand: input.brand,
  }).select("*").single();
  if (error || !data) {
    if (error?.code === "23505") {
      const concurrent = await readPartnerLink(env, input.external_link_id);
      return resumeIdempotentCreation(env, concurrent, fingerprint, idempotencyKey);
    }
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Insert failed");
  }

  const row = data as PartnerPaymentLinkRow;
  try {
    return serializePartnerLink(await activatePartnerLink(env, row));
  } catch (error) {
    if (error instanceof PartnerTransactionRevertedError) {
      await markPartnerFailure(env, row, error);
    }
    throw error;
  }
}

export async function getOdeleitePaymentLink(env: Env, externalId: string) {
  const row = await readPartnerLink(env, externalId);
  const { data: payment, error } = await getSupabase(env)
    .from("payments")
    .select("*")
    .eq("link_id", row.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL_ERROR", error.message);
  return serializePartnerLink(row, payment as PaymentRow | null);
}

export async function cancelOdeleitePaymentLink(
  env: Env,
  externalId: string,
  idempotencyKey: string,
) {
  return withRelayerLock(async () => {
    const row = await readPartnerLink(env, externalId);
    if (row.status === "paid") {
      throw new ApiError(409, "ALREADY_PAID", "Link is already paid");
    }
    if (row.status === "cancelled" || row.status === "expired") {
      return serializePartnerLink(row);
    }
    if (!row.on_chain_link_id) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Link is not active yet");
    }
    if (
      row.cancellation_idempotency_key
      && row.cancellation_idempotency_key !== idempotencyKey
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "A different cancellation is already in progress",
      );
    }
    const { error: cancelingError } = await getSupabase(env).from("payment_links").update({
      status: "canceling",
      cancellation_idempotency_key: idempotencyKey,
    }).eq("id", row.id);
    if (cancelingError) {
      throw new ApiError(500, "INTERNAL_ERROR", cancelingError.message);
    }

    let serialized = row.signed_cancellation_tx as Hex | null | undefined;
    let txHash = row.cancellation_tx_hash as Hex | null | undefined;
    if (!serialized || !txHash) {
      const data = encodeFunctionData({
        abi: paygridLinkAbiConst,
        functionName: "cancelLink",
        args: [BigInt(row.on_chain_link_id)],
      });
      ({ serialized, txHash } = await persistSignedTransaction(
        env,
        row.id,
        data,
        "cancellation",
      ));
    }
    const receipt = await broadcastStoredTransaction(env, serialized, txHash);
    if (receipt.status !== "success") {
      return resolveCancellationRace(env, row);
    }
    const { data, error } = await getSupabase(env).from("payment_links").update({
      status: "cancelled",
      cancellation_tx_hash: txHash,
      signed_cancellation_tx: null,
    }).eq("id", row.id).select("*").single();
    if (error || !data) {
      throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Update failed");
    }
    return serializePartnerLink(data as PartnerPaymentLinkRow);
  });
}

export async function expireOdeleitePaymentLinks(env: Env) {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from("payment_links")
    .update({ status: "expired" })
    .eq("partner_name", "odeleite")
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .select("*");
  if (error) throw new Error(`Unable to expire partner links: ${error.message}`);
  return data?.length ?? 0;
}
