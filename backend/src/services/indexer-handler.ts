import type { Env } from "../config/env.js";
import { getSupabase } from "../db/supabase.js";
import { formatHumanAmount, getStablecoinByAddress } from "../lib/tokens.js";
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
    .select("id")
    .eq("tx_hash", event.transactionHash)
    .maybeSingle();

  if (existing) {
    return;
  }

  const { data: link } = await supabase
    .from("payment_links")
    .select("id, amount, token")
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
  const paymentMethod = event.method === 2 ? "card" : event.method === 1 ? "fonbnk" : "crypto";
  const now = new Date().toISOString();

  const { error: payErr } = await supabase.from("payments").insert({
    link_id: link.id,
    payer_address: event.payer.toLowerCase(),
    amount: amountHuman,
    token: tokenSymbol,
    fee_amount: feeHuman,
    payment_method: paymentMethod,
    tx_hash: event.transactionHash,
    status: "confirmed",
    confirmed_at: now,
  });

  if (payErr) {
    console.error("[indexer] payment insert failed", payErr.message);
    return;
  }

  await supabase
    .from("payment_links")
    .update({ status: "paid", tx_hash: event.transactionHash })
    .eq("id", link.id);

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
