import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";

export type UserRow = {
  id: string;
  privy_id: string | null;
  phone_number: string | null;
  address: string | null;
  created_at: string;
};

export type PaymentLinkRow = {
  id: string;
  creator_id: string | null;
  creator_type: "user" | "agent" | null;
  on_chain_link_id: string;
  paygrid_link_address: string;
  recipient_address: string;
  amount: string;
  token: "USDm" | "USDC" | "USDT";
  description: string | null;
  accepted_methods: string[];
  status: "active" | "paid" | "expired" | "cancelled";
  tx_hash: string | null;
  created_at: string;
  expires_at: string | null;
};


export type AgentRow = {
  id: string;
  agent_id: string;
  address: string;
  name: string | null;
  metadata_uri: string | null;
  reputation_score: number | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  link_id: string;
  payer_address: string;
  amount: string;
  token: "USDm" | "USDC" | "USDT";
  fee_amount: string;
  payment_method: "crypto" | "fonbnk" | "card";
  onramp_session_id: string | null;
  onramp_tx_id: string | null;
  tx_hash: string | null;
  status: "pending" | "confirmed" | "failed";
  created_at: string;
  confirmed_at: string | null;
};

export type OnrampSessionRow = {
  id: string;
  payment_link_id: string;
  provider: string;
  provider_order_id: string | null;
  provider_metadata: Record<string, unknown>;
  amount: string;
  token: "USDm" | "USDC" | "USDT";
  fiat_amount: string | null;
  fiat_currency: string | null;
  carrier: string | null;
  status: "initiated" | "processing" | "completed" | "failed";
  tx_hash: string | null;
  created_at: string;
  confirmed_at: string | null;
};

export type GiftRow = {
  id: string;
  on_chain_gift_id: string | null;
  sender_address: string;
  claimant_address: string | null;
  sender_alias: string;
  recipient_alias: string;
  message: string;
  amount: string | number;
  token: "USDm" | "USDC" | "USDT";
  payer_token: "USDm" | "USDC" | "USDT" | null;
  claim_hash: string;
  metadata_hash: string;
  status: "draft" | "funding" | "active" | "claimed" | "cancelled" | "expired" | "refunded";
  funding_tx_hash: string | null;
  claim_tx_hash: string | null;
  refund_tx_hash: string | null;
  used_swap: boolean;
  referral_code: string;
  source_referral_code: string | null;
  expires_at: string;
  funded_at: string | null;
  claimed_at: string | null;
  created_at: string;
};

export type GiftGasSponsorshipRow = {
  id: string;
  gift_id: string;
  recipient_address: string;
  amount: string;
  token: "USDm";
  status: "reserved" | "submitted" | "confirmed" | "failed";
  attempt_count: number;
  tx_hash: string | null;
  failure_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
};

export type TreasurySignalRow = {
  id: string;
  external_signal_id: string;
  source: string;
  timeframe: string;
  side: "LONG";
  signal_type: "ENTRY";
  entry_price: string;
  sl_price: string;
  tp_price: string;
  strategy_code: string;
  strategy_name: string;
  strategy_description: string | null;
  symbol_code: string;
  base_asset: "CELO" | "ORO";
  quote_asset: "USDC" | "USDT" | "USDm";
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "executed" | "rejected" | "failed";
  position_id: string | null;
  rejection_reason: string | null;
  received_at: string;
  processing_started_at: string | null;
  processed_at: string | null;
};

export type TreasuryPositionRow = {
  id: string;
  signal_id: string;
  asset: "CELO" | "ORO";
  quote_token: "USDC" | "USDT" | "USDm";
  mode: "paper" | "live";
  route: "paper" | "mento" | "uniswap-v3";
  status: "open" | "closing" | "closed" | "failed";
  amount_asset: string;
  cost_quote: string;
  entry_price: string;
  current_price: string;
  oracle_price: string | null;
  executable_price: string | null;
  price_divergence_bps: number | null;
  oracle_source: string | null;
  oracle_updated_at: string | null;
  price_block_number: string | null;
  price_route: "mento" | "uniswap-v3" | null;
  sl_price: string;
  tp_price: string;
  pnl_quote: string;
  entry_tx_hash: string | null;
  exit_tx_hash: string | null;
  close_reason: string | null;
  close_requested_at: string | null;
  opened_at: string;
  closed_at: string | null;
  last_checked_at: string | null;
};

let client: SupabaseClient | null = null;

export function getSupabase(env: Env): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
