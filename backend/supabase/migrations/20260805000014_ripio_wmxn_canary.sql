-- Ripio wMXN mainnet canary. All tables are service-role only.

ALTER TYPE token ADD VALUE IF NOT EXISTS 'wMXN';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'ripio_spei';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS fee_bps integer
  CHECK (fee_bps IS NULL OR fee_bps BETWEEN 0 AND 10000);

CREATE TABLE ripio_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider_customer_id text UNIQUE,
  terms_id text,
  terms_accepted_at timestamptz,
  kyc_submission_id text,
  kyc_status text NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (kyc_status IN ('NOT_STARTED', 'INCOMPLETE_USER_DATA', 'IN_REVIEW', 'COMPLETED', 'FAILED')),
  fiat_account_id text UNIQUE,
  fiat_account_status text NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (fiat_account_status IN ('NOT_STARTED', 'UNCONFIRMED', 'PROCESSING', 'ENABLED', 'DISABLED')),
  clabe_last4 text CHECK (clabe_last4 IS NULL OR clabe_last4 ~ '^\d{4}$'),
  clabe_hmac text,
  offramp_session_id text UNIQUE,
  offramp_deposit_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ripio_canary_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES ripio_profiles(id),
  payment_link_id uuid UNIQUE REFERENCES payment_links(id),
  onramp_session_id uuid UNIQUE REFERENCES onramp_sessions(id),
  provider_quote_id text UNIQUE,
  provider_order_id text UNIQUE,
  offramp_transaction_id text UNIQUE,
  fiat_amount numeric(36, 18) NOT NULL,
  gross_amount numeric(36, 18),
  fee_bps integer CHECK (fee_bps IS NULL OR fee_bps BETWEEN 0 AND 10000),
  fee_amount numeric(36, 18),
  net_amount numeric(36, 18),
  funding_instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
  quote_expires_at timestamptz,
  status text NOT NULL DEFAULT 'CREATING'
    CHECK (status IN (
      'CREATING', 'WAITING_SPEI', 'MXN_RECEIVED', 'TRADE_COMPLETED',
      'WITHDRAWAL_PROCESSING', 'READY_FOR_RELEASE', 'RELEASING', 'RELEASED',
      'OFFRAMP_DEPOSIT_RECEIVED', 'OFFRAMP_TRADE_COMPLETED',
      'OFFRAMP_WITHDRAWAL_PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'
    )),
  onramp_tx_hash text,
  release_tx_hash text UNIQUE,
  error_code text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE ripio_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canary_run_id uuid REFERENCES ripio_canary_runs(id),
  payload_hash text NOT NULL UNIQUE,
  event_type text NOT NULL,
  transaction_id text,
  issue_datetime timestamptz,
  processed boolean NOT NULL DEFAULT false,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_ripio_canary_profile_created
  ON ripio_canary_runs(profile_id, created_at DESC);
CREATE INDEX idx_ripio_canary_status ON ripio_canary_runs(status);
CREATE INDEX idx_ripio_webhook_transaction ON ripio_webhook_events(transaction_id);
CREATE UNIQUE INDEX idx_ripio_webhook_event_transaction_unique
  ON ripio_webhook_events(event_type, transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE ripio_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ripio_canary_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ripio_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE ripio_profiles, ripio_canary_runs, ripio_webhook_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE ripio_profiles, ripio_canary_runs, ripio_webhook_events
  TO service_role;
