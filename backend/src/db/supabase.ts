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
  token: "USDm" | "USDC" | "USDT" | "wMXN";
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
  token: "USDm" | "USDC" | "USDT" | "wMXN";
  fee_amount: string;
  fee_bps: number | null;
  payment_method: "crypto" | "fonbnk" | "card" | "ripio_spei";
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
  token: "USDm" | "USDC" | "USDT" | "wMXN";
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
  base_asset: "CELO" | "XAUT0" | "WETH" | "WBTC" | "EURM";
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
  asset: "CELO" | "XAUT0" | "WETH" | "WBTC" | "EURM";
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

export type RipioProfileRow = {
  id: string;
  user_id: string;
  provider_customer_id: string | null;
  terms_id: string | null;
  terms_accepted_at: string | null;
  kyc_submission_id: string | null;
  kyc_status: "NOT_STARTED" | "INCOMPLETE_USER_DATA" | "IN_REVIEW" | "COMPLETED" | "FAILED";
  fiat_account_id: string | null;
  fiat_account_status: "NOT_STARTED" | "UNCONFIRMED" | "PROCESSING" | "ENABLED" | "DISABLED";
  clabe_last4: string | null;
  clabe_hmac: string | null;
  offramp_session_id: string | null;
  offramp_deposit_address: string | null;
  created_at: string;
  updated_at: string;
};

export type RipioCanaryStatus =
  | "CREATING" | "WAITING_SPEI" | "MXN_RECEIVED" | "TRADE_COMPLETED"
  | "WITHDRAWAL_PROCESSING" | "READY_FOR_RELEASE" | "RELEASING" | "RELEASED"
  | "OFFRAMP_DEPOSIT_RECEIVED" | "OFFRAMP_TRADE_COMPLETED"
  | "OFFRAMP_WITHDRAWAL_PROCESSING" | "COMPLETED" | "FAILED" | "REFUNDED";

export type RipioCanaryRunRow = {
  id: string;
  profile_id: string;
  payment_link_id: string | null;
  onramp_session_id: string | null;
  provider_quote_id: string | null;
  provider_order_id: string | null;
  offramp_transaction_id: string | null;
  fiat_amount: string;
  gross_amount: string | null;
  fee_bps: number | null;
  fee_amount: string | null;
  net_amount: string | null;
  funding_instructions: Record<string, unknown>;
  quote_expires_at: string | null;
  status: RipioCanaryStatus;
  onramp_tx_hash: string | null;
  release_tx_hash: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  released_at: string | null;
  completed_at: string | null;
};

export type TreasuryWithdrawalAddressRow = {
  id: string;
  label: string;
  address: string;
  destination_type: "minipay" | "exchange" | "external_wallet";
  chain_id: number;
  asset: "USDC" | "USDT" | "USDm" | "CELO" | "XAUT0" | "WETH" | "WBTC" | "EURM";
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
};

export type TreasuryFundOperationRow = {
  id: string;
  request_id: string;
  operation_type: "deposit" | "withdrawal";
  asset: TreasuryWithdrawalAddressRow["asset"];
  amount: string;
  destination_address: string | null;
  withdrawal_address_id: string | null;
  payment_link_id: string | null;
  creation_tx_hash: string | null;
  mode: "free" | "evacuate" | null;
  status: "active" | "paid" | "expired" | "pending" | "submitted" | "confirmed" | "failed";
  tx_hash: string | null;
  attribution_code: string | null;
  attribution_verified: boolean | null;
  position_ids: string[];
  error: string | null;
  created_at: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
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
