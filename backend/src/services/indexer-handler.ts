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
