ALTER TABLE treasury_quant_positions
  ADD COLUMN IF NOT EXISTS oracle_price numeric(36, 18),
  ADD COLUMN IF NOT EXISTS executable_price numeric(36, 18),
  ADD COLUMN IF NOT EXISTS price_divergence_bps integer,
  ADD COLUMN IF NOT EXISTS oracle_source text,
  ADD COLUMN IF NOT EXISTS oracle_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_block_number bigint,
  ADD COLUMN IF NOT EXISTS price_route text
    CHECK (price_route IS NULL OR price_route IN ('mento', 'uniswap-v3'));

CREATE INDEX IF NOT EXISTS idx_treasury_positions_oracle_updated
  ON treasury_quant_positions(oracle_updated_at DESC);
