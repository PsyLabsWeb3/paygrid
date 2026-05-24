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

export type PaymentRow = {
  id: string;
  link_id: string;
  payer_address: string;
  amount: string;
  token: "USDm" | "USDC" | "USDT";
  fee_amount: string;
  payment_method: "crypto" | "fonbnk";
  onramp_session_id: string | null;
  onramp_tx_id: string | null;
  tx_hash: string | null;
  status: "pending" | "confirmed" | "failed";
  created_at: string;
  confirmed_at: string | null;
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
