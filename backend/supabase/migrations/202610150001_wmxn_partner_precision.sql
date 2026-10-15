-- Atomic columns are decimal TEXT (no int64 or floating-point conversion).
-- Human-readable numeric(36,18) columns exactly cover the 1..10,000 wMXN pilot.
ALTER TABLE payment_links ADD CONSTRAINT partner_amount_uint256
  CHECK (amount_atomic IS NULL OR (length(amount_atomic) <= 78 AND amount_atomic::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935));
ALTER TABLE payments ADD CONSTRAINT partner_payment_uint256
  CHECK ((payer_amount_atomic IS NULL OR (length(payer_amount_atomic) <= 78 AND payer_amount_atomic::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935))
    AND (gross_amount_atomic IS NULL OR (length(gross_amount_atomic) <= 78 AND gross_amount_atomic::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935))
    AND (fee_amount_atomic IS NULL OR (length(fee_amount_atomic) <= 78 AND fee_amount_atomic::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935))
    AND (net_amount_atomic IS NULL OR (length(net_amount_atomic) <= 78 AND net_amount_atomic::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)));
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
        'payer_asset_decimals', CASE WHEN NEW.payer_token IN ('USDm', 'wMXN') THEN 18 ELSE 6 END,
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
