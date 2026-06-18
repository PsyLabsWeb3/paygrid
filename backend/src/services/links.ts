import { decodeEventLog, encodeFunctionData } from "viem";
import type { Env } from "../config/env.js";
import type { PaymentLinkRow } from "../db/supabase.js";
import { getSupabase } from "../db/supabase.js";
import {
  createChainClients,
  paygridLinkAbiConst,
  paygridRouterAbiConst,
} from "../lib/chain.js";
import { ApiError } from "../lib/errors.js";
import {
  formatHumanAmount,
  getTokenAddress,
  parseHumanAmount,
  type Stablecoin,
} from "../lib/tokens.js";

export type CreateLinkInput = {
  amount: string;
  token: Stablecoin;
  description?: string;
  acceptedMethods: ("crypto" | "fonbnk" | "card")[];
  recipientAddress: `0x${string}`;
  expiresAt?: string;
  creator?: {
    id: string;
    type: "user" | "agent";
  };
};

export type ListLinksOptions = {
  cursor?: string;
  limit?: number;
  status?: PaymentLinkRow["status"];
  token?: Stablecoin;
};

export type LinkOwner = {
  id: string;
  type: "user" | "agent";
};

function serializeLink(row: PaymentLinkRow) {
  return {
    id: row.id,
    onChainLinkId: row.on_chain_link_id,
    paygridLinkAddress: row.paygrid_link_address,
    creatorId: row.creator_id,
    creatorType: row.creator_type,
    recipientAddress: row.recipient_address,
    amount: String(row.amount),
    token: row.token,
    description: row.description,
    acceptedMethods: row.accepted_methods,
    status: row.status,
    txHash: row.tx_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function createPaymentLink(env: Env, input: CreateLinkInput) {
  if (parseFloat(input.amount) <= 0) {
    throw new ApiError(400, "INVALID_AMOUNT", "Amount must be greater than zero");
  }

  const amountWei = parseHumanAmount(input.amount, input.token);
  const tokenAddress = getTokenAddress(env, input.token);
  const acceptsFiat = input.acceptedMethods.includes("fonbnk") || input.acceptedMethods.includes("card");
  const expiresAtUnix = input.expiresAt
    ? BigInt(Math.floor(new Date(input.expiresAt).getTime() / 1000))
    : 0n;

  const { publicClient, walletClient } = createChainClients(env);

  const { request } = await publicClient.simulateContract({
    address: env.PAYGRID_LINK_ADDRESS,
    abi: paygridLinkAbiConst,
    functionName: "createLink",
    args: [
      input.recipientAddress,
      amountWei,
      tokenAddress,
      input.description ?? "",
      acceptsFiat,
      expiresAtUnix,
    ],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

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
      // not our event
    }
  }

  if (onChainLinkId === null) {
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to read LinkCreated event");
  }

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from("payment_links")
    .insert({
      on_chain_link_id: onChainLinkId.toString(),
      paygrid_link_address: env.PAYGRID_LINK_ADDRESS.toLowerCase(),
      recipient_address: input.recipientAddress.toLowerCase(),
      amount: input.amount,
      token: input.token,
      description: input.description ?? null,
      accepted_methods: input.acceptedMethods,
      status: "active",
      expires_at: input.expiresAt ?? null,
      creator_id: input.creator?.id ?? null,
      creator_type: input.creator?.type ?? null,
    })
    .select()
    .single();

  const row = data as PaymentLinkRow | null;
  if (error || !row) {
    throw new ApiError(500, "INTERNAL_ERROR", error?.message ?? "Insert failed", {
      code: error?.code,
    });
  }

  return {
    id: row.id,
    onChainLinkId: onChainLinkId.toString(),
    url: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/pay/${row.id}`,
    amount: String(input.amount),
    token: input.token,
    status: row.status,
    createdAt: row.created_at,
    txHash,
  };
}

export async function getPaymentLink(env: Env, id: string) {
  const supabase = getSupabase(env);
  const { data: link, error } = await supabase
    .from("payment_links")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }
  if (!link) {
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  }

  const paymentLink = link as PaymentLinkRow;

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("link_id", id)
    .order("created_at", { ascending: false });

  return { link: paymentLink, payments: payments ?? [] };
}

export async function buildCryptoPayTx(env: Env, linkId: string) {
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

  const paymentLink = link as PaymentLinkRow;
  if (paymentLink.status === "paid") {
    throw new ApiError(409, "ALREADY_PAID", "Link already settled");
  }
  if (paymentLink.status !== "active") {
    throw new ApiError(410, "EXPIRED", `Link is ${paymentLink.status}`);
  }
  if (!paymentLink.accepted_methods.includes("crypto")) {
    throw new ApiError(400, "UNSUPPORTED_METHOD", "Crypto payments not accepted for this link");
  }

  const token = paymentLink.token as Stablecoin;
  const amountWei = parseHumanAmount(paymentLink.amount, token);
  const tokenAddress = getTokenAddress(env, token);

  const data = encodeFunctionData({
    abi: paygridRouterAbiConst,
    functionName: "pay",
    args: [BigInt(paymentLink.on_chain_link_id), tokenAddress, amountWei],
  });

  return {
    method: "crypto" as const,
    tx: {
      to: env.PAYGRID_ROUTER_ADDRESS,
      data,
      value: "0",
    },
    link: {
      id: paymentLink.id,
      onChainLinkId: String(paymentLink.on_chain_link_id),
      amount: String(paymentLink.amount),
      token: paymentLink.token,
    },
  };
}

export async function listUserLinks(env: Env, userId: string, options: ListLinksOptions = {}) {
  return listOwnedLinks(env, { id: userId, type: "user" }, options);
}

export async function listOwnedLinks(env: Env, owner: LinkOwner, options: ListLinksOptions = {}) {
  const supabase = getSupabase(env);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  let query = supabase
    .from("payment_links")
    .select("*")
    .eq("creator_id", owner.id)
    .eq("creator_type", owner.type)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.token) {
    query = query.eq("token", options.token);
  }
  if (options.cursor) {
    query = query.lt("created_at", options.cursor);
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }

  const rows = (data ?? []) as PaymentLinkRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: page.map(serializeLink),
    pagination: {
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.created_at ?? null : null,
    },
  };
}

export { formatHumanAmount };
