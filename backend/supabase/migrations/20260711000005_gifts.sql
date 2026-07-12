CREATE TYPE gift_status AS ENUM ('draft', 'funding', 'active', 'claimed', 'cancelled', 'expired', 'refunded');
CREATE TYPE gift_event_type AS ENUM ('funded', 'claimed', 'refunded', 'referral_conversion');

CREATE TABLE gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  on_chain_gift_id bigint,
  sender_address text NOT NULL,
  claimant_address text,
  sender_alias text NOT NULL,
  recipient_alias text NOT NULL,
  message text NOT NULL,
  amount numeric(36, 18) NOT NULL CHECK (amount >= 0.5),
  token token NOT NULL,
  payer_token token,
  claim_hash text UNIQUE NOT NULL,
  metadata_hash text NOT NULL,
  status gift_status NOT NULL DEFAULT 'draft',
  funding_tx_hash text UNIQUE,
  claim_tx_hash text UNIQUE,
  refund_tx_hash text UNIQUE,
  used_swap boolean NOT NULL DEFAULT false,
  referral_code text UNIQUE NOT NULL,
  source_referral_code text,
  expires_at timestamptz NOT NULL,
  funded_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gift_claim_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gift_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_address text NOT NULL,
  referred_address text NOT NULL,
  source_gift_id uuid NOT NULL REFERENCES gifts(id),
  conversion_gift_id uuid REFERENCES gifts(id),
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referrer_address, referred_address)
);

CREATE TABLE gift_leaderboard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL REFERENCES gifts(id),
  address text NOT NULL,
  event_type gift_event_type NOT NULL,
  amount numeric(36, 18) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gift_id, address, event_type)
);

CREATE TABLE indexer_checkpoints (
  stream text PRIMARY KEY,
  block_number bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gifts_status ON gifts(status);
CREATE INDEX idx_gifts_sender ON gifts(sender_address);
CREATE INDEX idx_gifts_claimant ON gifts(claimant_address);
CREATE INDEX idx_gifts_on_chain ON gifts(on_chain_gift_id);
CREATE INDEX idx_gifts_created ON gifts(created_at DESC);
CREATE INDEX idx_gift_claim_sessions_gift ON gift_claim_sessions(gift_id);
CREATE INDEX idx_gift_referrals_referrer ON gift_referrals(referrer_address);
CREATE INDEX idx_gift_leaderboard_address ON gift_leaderboard_events(address);

ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_claim_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_leaderboard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE indexer_checkpoints ENABLE ROW LEVEL SECURITY;
