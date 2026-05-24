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
  parseHumanAmount,
  TOKEN_ADDRESSES,
  type Stablecoin,
} from "../lib/tokens.js";

export type CreateLinkInput = {
  amount: string;
  token: Stablecoin;
  description?: string;
  acceptedMethods: ("crypto" | "fonbnk")[];
  recipientAddress: `0x${string}`;
  expiresAt?: string;
};

export async function createPaymentLink(env: Env, input: CreateLinkInput) {
  if (parseFloat(input.amount) <= 0) {
    throw new ApiError(400, "INVALID_AMOUNT", "Amount must be greater than zero");
  }

  const amountWei = parseHumanAmount(input.amount, input.token);
  const tokenAddress = TOKEN_ADDRESSES[input.token];
  const acceptsFiat = input.acceptedMethods.includes("fonbnk");
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
      recipient_address: input.recipientAddress.toLowerCase(),
      amount: input.amount,
      token: input.token,
      description: input.description ?? null,
      accepted_methods: input.acceptedMethods,
      status: "active",
      expires_at: input.expiresAt ?? null,
      creator_id: null,
      creator_type: null,
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
    url: `https://paygrid.xyz/pay/${row.id}`,
    amount: input.amount,
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
  const tokenAddress = TOKEN_ADDRESSES[token];

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
      amount: paymentLink.amount,
      token: paymentLink.token,
    },
  };
}

export { formatHumanAmount };
