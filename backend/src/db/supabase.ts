import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";

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

let client: SupabaseClient | null = null;

export function getSupabase(env: Env): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
