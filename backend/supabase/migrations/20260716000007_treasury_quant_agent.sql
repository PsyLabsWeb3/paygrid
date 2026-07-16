CREATE TABLE treasury_quant_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_signal_id text UNIQUE NOT NULL,
  source text NOT NULL,
  timeframe text NOT NULL,
  side text NOT NULL CHECK (side = 'LONG'),
  signal_type text NOT NULL CHECK (signal_type = 'ENTRY'),
  entry_price numeric(36, 18) NOT NULL CHECK (entry_price > 0),
  sl_price numeric(36, 18) NOT NULL CHECK (sl_price > 0),
  tp_price numeric(36, 18) NOT NULL CHECK (tp_price > 0),
  strategy_code text NOT NULL,
  strategy_name text NOT NULL,
  strategy_description text,
  symbol_code text NOT NULL,
  base_asset text NOT NULL CHECK (base_asset IN ('CELO', 'ORO')),
  quote_asset text NOT NULL CHECK (quote_asset IN ('USDC', 'USDT', 'USDm')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'executed', 'rejected', 'failed')),
  position_id uuid,
  rejection_reason text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz
);

CREATE TABLE treasury_quant_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid UNIQUE NOT NULL REFERENCES treasury_quant_signals(id),
  asset text NOT NULL CHECK (asset IN ('CELO', 'ORO')),
  quote_token text NOT NULL CHECK (quote_token IN ('USDC', 'USDT', 'USDm')),
  mode text NOT NULL CHECK (mode IN ('paper', 'live')),
  route text NOT NULL CHECK (route IN ('paper', 'mento', 'uniswap-v3')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closing', 'closed', 'failed')),
  amount_asset numeric(60, 24) NOT NULL CHECK (amount_asset > 0),
  cost_quote numeric(60, 24) NOT NULL CHECK (cost_quote > 0),
  entry_price numeric(36, 18) NOT NULL CHECK (entry_price > 0),
  current_price numeric(36, 18) NOT NULL CHECK (current_price > 0),
  sl_price numeric(36, 18) NOT NULL CHECK (sl_price > 0),
  tp_price numeric(36, 18) NOT NULL CHECK (tp_price > 0),
  pnl_quote numeric(60, 24) NOT NULL DEFAULT 0,
  entry_tx_hash text UNIQUE,
  exit_tx_hash text UNIQUE,
  close_reason text,
  close_requested_at timestamptz,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  last_checked_at timestamptz
);

ALTER TABLE treasury_quant_signals
  ADD CONSTRAINT treasury_quant_signals_position_fk
  FOREIGN KEY (position_id) REFERENCES treasury_quant_positions(id);

CREATE TABLE treasury_quant_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES treasury_quant_signals(id),
  position_id uuid REFERENCES treasury_quant_positions(id),
  action text NOT NULL CHECK (action IN ('approve', 'entry', 'exit')),
  route text NOT NULL CHECK (route IN ('paper', 'mento', 'uniswap-v3')),
  token_in text NOT NULL,
  token_out text NOT NULL,
  amount_in numeric(60, 24) NOT NULL DEFAULT 0,
  amount_out numeric(60, 24) NOT NULL DEFAULT 0,
  tx_hash text UNIQUE,
  status text NOT NULL CHECK (status IN ('paper', 'submitted', 'confirmed', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE treasury_quant_control (
  id text PRIMARY KEY CHECK (id = 'global'),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO treasury_quant_control (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE treasury_quant_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  signal_id uuid REFERENCES treasury_quant_signals(id),
  position_id uuid REFERENCES treasury_quant_positions(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_treasury_signals_status_received
  ON treasury_quant_signals(status, received_at);
CREATE INDEX idx_treasury_positions_status_asset
  ON treasury_quant_positions(status, asset);
CREATE INDEX idx_treasury_executions_position
  ON treasury_quant_executions(position_id, created_at DESC);
CREATE INDEX idx_treasury_audit_created
  ON treasury_quant_audit(created_at DESC);

ALTER TABLE treasury_quant_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_quant_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_quant_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_quant_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_quant_audit ENABLE ROW LEVEL SECURITY;
