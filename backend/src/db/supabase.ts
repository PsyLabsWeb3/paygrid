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
  amount: string;
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

let client: SupabaseClient | null = null;

export function getSupabase(env: Env): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
