import type { Env } from "../config/env.js";
import { getSupabase, type PaymentLinkRow, type PaymentRow } from "../db/supabase.js";
import { ApiError } from "../lib/errors.js";
import type { Stablecoin } from "../lib/tokens.js";

export type ListPaymentsOptions = {
  cursor?: string;
  limit?: number;
  status?: PaymentRow["status"];
  token?: Stablecoin;
  from?: string;
  to?: string;
};

export type PaymentsOwner = {
  id: string;
  type: "user" | "agent";
};

function serializePayment(row: PaymentRow) {
  return {
    id: row.id,
    linkId: row.link_id,
    payerAddress: row.payer_address,
    amount: String(row.amount),
    token: row.token,
    feeAmount: String(row.fee_amount),
    paymentMethod: row.payment_method,
    onrampSessionId: row.onramp_session_id,
    onrampTxId: row.onramp_tx_id,
    txHash: row.tx_hash,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

export async function listUserPayments(
  env: Env,
  userId: string,
  options: ListPaymentsOptions = {},
) {
  return listOwnedPayments(env, { id: userId, type: "user" }, options);
}

export async function listOwnedPayments(
  env: Env,
  owner: PaymentsOwner,
  options: ListPaymentsOptions = {},
) {
  const supabase = getSupabase(env);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const { data: ownedLinks, error: linksError } = await supabase
    .from("payment_links")
    .select("id")
    .eq("creator_id", owner.id)
    .eq("creator_type", owner.type);

  if (linksError) {
    throw new ApiError(500, "INTERNAL_ERROR", linksError.message);
  }

  const linkIds = (ownedLinks ?? []).map((row) => row.id);
  if (linkIds.length === 0) {
    return {
      data: [],
      pagination: { hasMore: false, nextCursor: null },
    };
  }

  let query = supabase
    .from("payments")
    .select("*")
    .in("link_id", linkIds)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.token) {
    query = query.eq("token", options.token);
  }
  if (options.from) {
    query = query.gte("created_at", options.from);
  }
  if (options.to) {
    query = query.lte("created_at", options.to);
  }
  if (options.cursor) {
    query = query.lt("created_at", options.cursor);
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }

  const rows = (data ?? []) as PaymentRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: page.map(serializePayment),
    pagination: {
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.created_at ?? null : null,
    },
  };
}
