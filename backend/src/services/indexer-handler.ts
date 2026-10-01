import { decodeEventLog } from "viem";
import type { Env } from "../config/env.js";
import { getSupabase } from "../db/supabase.js";
import { formatHumanAmount, getStablecoinByAddress } from "../lib/tokens.js";
import { createChainClients, paygridRouterAbiConst } from "../lib/chain.js";
import { notifyPaymentReceived } from "./notifier.js";

export async function handlePaymentReceived(
  env: Env,
  event: {
    linkId: bigint;
    payer: `0x${string}`;
    token: `0x${string}`;
    amount: bigint;
    fee: bigint;
    method: number;
    transactionHash: `0x${string}`;
    blockNumber?: bigint;
  },
) {
  const supabase = getSupabase(env);
  const tokenSymbol = getStablecoinByAddress(env, event.token);
  if (!tokenSymbol) {
    console.warn("[indexer] unknown token address", event.token);
    return;
  }

  const { data: existing } = await supabase
    .from("payments")
    .select("id,link_id")
    .eq("tx_hash", event.transactionHash)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("payment_links")
      .update({ status: "paid", tx_hash: event.transactionHash })
      .eq("id", existing.link_id);
    if (error) throw new Error(`Existing payment link recovery failed: ${error.message}`);
    return;
  }

  const { data: link } = await supabase
    .from("payment_links")
    .select("id, amount, token, accepted_methods, partner_name")
    .eq("on_chain_link_id", event.linkId.toString())
    .eq("paygrid_link_address", env.PAYGRID_LINK_ADDRESS.toLowerCase())
    .maybeSingle();

  if (!link) {
    console.warn(
      "[indexer] no DB link for contract/link",
      env.PAYGRID_LINK_ADDRESS,
      event.linkId.toString(),
    );
    return;
  }

  const amountHuman = formatHumanAmount(event.amount, tokenSymbol);
  const feeHuman = formatHumanAmount(event.fee, tokenSymbol);
  let payerToken = tokenSymbol;
  let payerAmountAtomic = event.amount;
  if (link.partner_name === "odeleite") {
    const { publicClient } = createChainClients(env);
    const receipt = await publicClient.getTransactionReceipt({ hash: event.transactionHash });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: paygridRouterAbiConst,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "SwapPayment"
          && "linkId" in decoded.args
          && decoded.args.linkId === event.linkId
          && "tokenIn" in decoded.args
          && "amountIn" in decoded.args
        ) {
          const symbol = getStablecoinByAddress(env, decoded.args.tokenIn as `0x${string}`);
          if (symbol) {
            payerToken = symbol;
            payerAmountAtomic = decoded.args.amountIn as bigint;
          }
          break;
        }
      } catch {
        // Ignore unrelated logs in the receipt.
      }
    }
  }
  const paymentMethod = tokenSymbol === "wMXN" && link.accepted_methods?.includes("ripio_spei")
    ? "ripio_spei"
    : event.method === 2 ? "card" : event.method === 1 ? "fonbnk" : "crypto";
  const { publicClient } = createChainClients(env);
  const feeBps = await publicClient.readContract({
    address: env.PAYGRID_ROUTER_ADDRESS,
    abi: paygridRouterAbiConst,
    functionName: "feeBps",
    ...(event.blockNumber === undefined ? {} : { blockNumber: event.blockNumber }),
  }) as bigint;
  const now = new Date().toISOString();

  const { error: payErr } = await supabase.from("payments").insert({
    link_id: link.id,
    payer_address: event.payer.toLowerCase(),
    amount: amountHuman,
    token: tokenSymbol,
    fee_amount: feeHuman,
    fee_bps: Number(feeBps),
    payment_method: paymentMethod,
    tx_hash: event.transactionHash,
    status: "confirmed",
    confirmed_at: now,
    payer_token: payerToken,
    payer_amount_atomic: payerAmountAtomic.toString(),
    gross_amount_atomic: event.amount.toString(),
    fee_amount_atomic: event.fee.toString(),
    net_amount_atomic: (event.amount - event.fee).toString(),
    settlement_decimals: tokenSymbol === "USDm" ? 18 : 6,
    block_number: event.blockNumber?.toString() ?? null,
  });

  if (payErr) {
    throw new Error(`Payment insert failed: ${payErr.message}`);
  }

  const { error: linkUpdateError } = await supabase
    .from("payment_links")
    .update({ status: "paid", tx_hash: event.transactionHash })
    .eq("id", link.id);
  if (linkUpdateError) {
    throw new Error(`Payment link status update failed: ${linkUpdateError.message}`);
  }

  notifyPaymentReceived({
    linkId: link.id,
    onChainLinkId: event.linkId.toString(),
    payer: event.payer,
    txHash: event.transactionHash,
    amount: amountHuman,
    token: tokenSymbol,
  });
}

export async function handleGiftCreated(
  env: Env,
  event: {
    giftId: bigint;
    sender: `0x${string}`;
    claimHash: `0x${string}`;
    transactionHash: `0x${string}`;
  },
) {
  const supabase = getSupabase(env);
  const now = new Date().toISOString();
  const { data: gift, error } = await supabase
    .from("gifts")
    .update({
      on_chain_gift_id: event.giftId.toString(),
      sender_address: event.sender.toLowerCase(),
      status: "active",
      funding_tx_hash: event.transactionHash,
      funded_at: now,
    })
    .eq("claim_hash", event.claimHash.toLowerCase())
    .select("*")
    .maybeSingle();
  if (error || !gift) {
    console.warn("[indexer] no gift draft for claim hash", event.claimHash, error?.message);
    return;
  }

  await supabase.from("gift_leaderboard_events").upsert({
    gift_id: gift.id,
    address: event.sender.toLowerCase(),
    event_type: "funded",
    amount: gift.amount,
  }, { onConflict: "gift_id,address,event_type" });

  if (gift.source_referral_code) {
    const { data: sourceGift } = await supabase
      .from("gifts")
      .select("id,sender_address")
      .eq("referral_code", gift.source_referral_code)
      .maybeSingle();
    if (sourceGift && sourceGift.sender_address !== event.sender.toLowerCase()) {
      await supabase.from("gift_referrals").upsert({
        referrer_address: sourceGift.sender_address,
        referred_address: event.sender.toLowerCase(),
        source_gift_id: sourceGift.id,
        conversion_gift_id: gift.id,
        converted_at: now,
      }, { onConflict: "referrer_address,referred_address" });
      await supabase.from("gift_leaderboard_events").upsert({
        gift_id: gift.id,
        address: sourceGift.sender_address,
        event_type: "referral_conversion",
        amount: 0,
      }, { onConflict: "gift_id,address,event_type" });
    }
  }
}

export async function handleGiftClaimed(
  env: Env,
  event: {
    giftId: bigint;
    recipient: `0x${string}`;
    transactionHash: `0x${string}`;
  },
) {
  const supabase = getSupabase(env);
  const now = new Date().toISOString();
  const { data: gift, error } = await supabase
    .from("gifts")
    .update({
      claimant_address: event.recipient.toLowerCase(),
      status: "claimed",
      claim_tx_hash: event.transactionHash,
      claimed_at: now,
    })
    .eq("on_chain_gift_id", event.giftId.toString())
    .select("*")
    .maybeSingle();
  if (error || !gift) {
    console.warn("[indexer] no DB gift for claim", event.giftId.toString(), error?.message);
    return;
  }
  await supabase
    .from("gift_claim_sessions")
    .update({ consumed_at: now })
    .eq("gift_id", gift.id)
    .is("consumed_at", null);
  if (gift.sender_address === event.recipient.toLowerCase()) return;
  await supabase.from("gift_leaderboard_events").upsert({
    gift_id: gift.id,
    address: gift.sender_address,
    event_type: "claimed",
    amount: gift.amount,
  }, { onConflict: "gift_id,address,event_type" });
}

export async function handleGiftClosed(
  env: Env,
  event: {
    giftId: bigint;
    status: "cancelled" | "refunded";
    transactionHash: `0x${string}`;
  },
) {
  const update = event.status === "refunded"
    ? { status: event.status, refund_tx_hash: event.transactionHash }
    : { status: event.status };
  await getSupabase(env).from("gifts").update(update).eq("on_chain_gift_id", event.giftId.toString());
}
