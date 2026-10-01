-- Odeleite partner payment links. Existing Paygrid consumers keep using the
-- human-readable amount columns; partner reconciliation uses exact atomics.

ALTER TYPE link_status ADD VALUE IF NOT EXISTS 'creating';
ALTER TYPE link_status ADD VALUE IF NOT EXISTS 'canceling';
ALTER TYPE link_status ADD VALUE IF NOT EXISTS 'failed';

ALTER TABLE payment_links
  ALTER COLUMN on_chain_link_id DROP NOT NULL;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS partner_name text,
  ADD COLUMN IF NOT EXISTS external_business_id uuid,
  ADD COLUMN IF NOT EXISTS external_link_id uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS cancellation_idempotency_key text,
  ADD COLUMN IF NOT EXISTS merchant_display_name text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS amount_atomic text
    CHECK (amount_atomic IS NULL OR amount_atomic ~ '^[0-9]+$'),
  ADD COLUMN IF NOT EXISTS settlement_decimals smallint,
  ADD COLUMN IF NOT EXISTS accepted_payer_assets text[] NOT NULL DEFAULT ARRAY['USDC'],
  ADD COLUMN IF NOT EXISTS creation_tx_hash text,
  ADD COLUMN IF NOT EXISTS signed_creation_tx text,
  ADD COLUMN IF NOT EXISTS cancellation_tx_hash text,
  ADD COLUMN IF NOT EXISTS signed_cancellation_tx text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_detail text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_partner_external
  ON payment_links(partner_name, external_link_id)
  WHERE partner_name IS NOT NULL AND external_link_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_partner_idempotency
  ON payment_links(partner_name, idempotency_key)
  WHERE partner_name IS NOT NULL AND idempotency_key IS NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payer_token text,
  ADD COLUMN IF NOT EXISTS payer_amount_atomic text
    CHECK (payer_amount_atomic IS NULL OR payer_amount_atomic ~ '^[0-9]+$'),
  ADD COLUMN IF NOT EXISTS gross_amount_atomic text
    CHECK (gross_amount_atomic IS NULL OR gross_amount_atomic ~ '^[0-9]+$'),
  ADD COLUMN IF NOT EXISTS fee_amount_atomic text
    CHECK (fee_amount_atomic IS NULL OR fee_amount_atomic ~ '^[0-9]+$'),
  ADD COLUMN IF NOT EXISTS net_amount_atomic text
    CHECK (net_amount_atomic IS NULL OR net_amount_atomic ~ '^[0-9]+$'),
  ADD COLUMN IF NOT EXISTS settlement_decimals smallint,
  ADD COLUMN IF NOT EXISTS block_number text
    CHECK (block_number IS NULL OR block_number ~ '^[0-9]+$');

CREATE TABLE IF NOT EXISTS partner_webhook_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_response_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_webhook_outbox_pending
  ON partner_webhook_outbox(status, next_attempt_at);

ALTER TABLE partner_webhook_outbox ENABLE ROW LEVEL SECURITY;

-- Every partner state transition and its webhook are committed together.
-- The paid event is handled by the payments trigger below because it needs
-- the exact payer, gross, fee and net amounts from that row.
CREATE OR REPLACE FUNCTION public.enqueue_odeleite_link_state_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_name text;
BEGIN
  IF NEW.partner_name IS DISTINCT FROM 'odeleite'
     OR NEW.status = OLD.status
     OR NEW.status::text NOT IN ('active', 'expired', 'cancelled', 'failed') THEN
    RETURN NEW;
  END IF;

  event_name := 'payment_link.' || NEW.status::text;
  INSERT INTO public.partner_webhook_outbox(partner_name, event_type, payload)
  VALUES (
    'odeleite',
    event_name,
    jsonb_build_object(
      'external_business_id', NEW.external_business_id,
      'external_link_id', NEW.external_link_id,
      'provider_link_id', NEW.id,
      'on_chain_link_id', NEW.on_chain_link_id::text,
      'paygrid_link_address', NEW.paygrid_link_address,
      'recipient_address', NEW.recipient_address,
      'amount_atomic', NEW.amount_atomic::text,
      'settlement_asset', NEW.token,
      'settlement_decimals', NEW.settlement_decimals,
      'expires_at', NEW.expires_at,
      'status', NEW.status,
      'creation_tx_hash', NEW.creation_tx_hash,
      'cancellation_tx_hash', NEW.cancellation_tx_hash,
      'failure_code', NEW.failure_code,
      'failure_detail', NEW.failure_detail
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_links_odeleite_webhook_outbox ON public.payment_links;
CREATE TRIGGER payment_links_odeleite_webhook_outbox
AFTER UPDATE OF status ON public.payment_links
FOR EACH ROW EXECUTE FUNCTION public.enqueue_odeleite_link_state_webhook();

-- Payment + webhook outbox are committed by the same database transaction, so
-- an indexer crash can never persist money without persisting its notification.
CREATE OR REPLACE FUNCTION public.enqueue_odeleite_payment_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  partner_link public.payment_links%ROWTYPE;
BEGIN
  SELECT * INTO partner_link
  FROM public.payment_links
  WHERE id = NEW.link_id;

  IF partner_link.partner_name = 'odeleite' THEN
    INSERT INTO public.partner_webhook_outbox(partner_name, event_type, payload)
    VALUES (
      'odeleite',
      'payment_link.paid',
      jsonb_build_object(
        'external_business_id', partner_link.external_business_id,
        'external_link_id', partner_link.external_link_id,
        'provider_link_id', partner_link.id,
        'on_chain_link_id', partner_link.on_chain_link_id::text,
        'paygrid_link_address', partner_link.paygrid_link_address,
        'recipient_address', partner_link.recipient_address,
        'payment_id', NEW.id,
        'payer_address', NEW.payer_address,
        'payer_asset', NEW.payer_token,
        'payer_asset_decimals', CASE WHEN NEW.payer_token = 'USDm' THEN 18 ELSE 6 END,
        'payer_amount_atomic', NEW.payer_amount_atomic::text,
        'settlement_asset', partner_link.token,
        'settlement_decimals', NEW.settlement_decimals,
        'fee_bps', NEW.fee_bps,
        'gross_amount_atomic', NEW.gross_amount_atomic::text,
        'fee_amount_atomic', NEW.fee_amount_atomic::text,
        'net_amount_atomic', NEW.net_amount_atomic::text,
        'transaction_hash', NEW.tx_hash,
        'block_number', NEW.block_number::text,
        'confirmed_at', NEW.confirmed_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_odeleite_webhook_outbox ON public.payments;
CREATE TRIGGER payments_odeleite_webhook_outbox
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.enqueue_odeleite_payment_webhook();
