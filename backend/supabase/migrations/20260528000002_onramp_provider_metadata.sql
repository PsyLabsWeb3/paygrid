-- Add provider-agnostic metadata for future onramp integrations.

ALTER TABLE onramp_sessions
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_onramp_provider_order
  ON onramp_sessions(provider, provider_order_id);
