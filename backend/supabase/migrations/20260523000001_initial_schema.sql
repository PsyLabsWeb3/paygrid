-- Paygrid initial schema (Fase 1)

CREATE TYPE token AS ENUM ('USDm', 'USDC', 'USDT');
CREATE TYPE link_status AS ENUM ('active', 'paid', 'expired', 'cancelled');
CREATE TYPE payment_method AS ENUM ('crypto', 'fonbnk');
CREATE TYPE payment_status AS ENUM ('pending', 'confirmed', 'failed');
CREATE TYPE onramp_status AS ENUM ('initiated', 'processing', 'completed', 'failed');
CREATE TYPE creator_type AS ENUM ('user', 'agent');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_id text UNIQUE,
  phone_number text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text UNIQUE NOT NULL,
  address text NOT NULL,
  name text,
  metadata_uri text,
  reputation_score integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid,
  creator_type creator_type,
  on_chain_link_id bigint UNIQUE NOT NULL,
  recipient_address text NOT NULL,
  amount numeric(36, 18) NOT NULL,
  token token NOT NULL,
  description text,
  accepted_methods text[] NOT NULL DEFAULT ARRAY['crypto'],
  status link_status NOT NULL DEFAULT 'active',
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT payment_links_creator_pair CHECK (
    (creator_id IS NULL AND creator_type IS NULL) OR
    (creator_id IS NOT NULL AND creator_type IS NOT NULL)
  )
);

CREATE TABLE onramp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_link_id uuid NOT NULL REFERENCES payment_links(id),
  provider text NOT NULL DEFAULT 'fonbnk',
  provider_order_id text,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount numeric(36, 18) NOT NULL,
  token token NOT NULL,
  fiat_amount numeric(36, 18),
  fiat_currency text,
  carrier text,
  status onramp_status NOT NULL DEFAULT 'initiated',
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES payment_links(id),
  payer_address text NOT NULL,
  amount numeric(36, 18) NOT NULL,
  token token NOT NULL,
  fee_amount numeric(36, 18) NOT NULL DEFAULT 0,
  payment_method payment_method NOT NULL,
  onramp_session_id uuid REFERENCES onramp_sessions(id),
  onramp_tx_id text,
  tx_hash text UNIQUE,
  status payment_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX idx_payment_links_creator ON payment_links(creator_id);
CREATE INDEX idx_payment_links_status ON payment_links(status);
CREATE INDEX idx_payment_links_on_chain ON payment_links(on_chain_link_id);
CREATE INDEX idx_payments_link ON payments(link_id);
CREATE INDEX idx_payments_payer ON payments(payer_address);
CREATE UNIQUE INDEX idx_payments_onramp_session_unique
  ON payments(onramp_session_id)
  WHERE onramp_session_id IS NOT NULL;
CREATE INDEX idx_onramp_link ON onramp_sessions(payment_link_id);
CREATE INDEX idx_onramp_provider_order ON onramp_sessions(provider, provider_order_id);
CREATE INDEX idx_onramp_status ON onramp_sessions(status);

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE onramp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_active_links ON payment_links
  FOR SELECT USING (status = 'active');

CREATE POLICY read_agents ON agents FOR SELECT USING (true);
