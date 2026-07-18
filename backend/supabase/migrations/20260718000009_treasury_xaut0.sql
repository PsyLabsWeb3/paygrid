ALTER TABLE treasury_quant_signals
  DROP CONSTRAINT IF EXISTS treasury_quant_signals_base_asset_check;

ALTER TABLE treasury_quant_positions
  DROP CONSTRAINT IF EXISTS treasury_quant_positions_asset_check;

UPDATE treasury_quant_signals
SET
  base_asset = 'XAUT0',
  symbol_code = regexp_replace(symbol_code, '^ORO', 'XAUT'),
  payload = jsonb_set(
    jsonb_set(payload, '{symbol,baseAsset}', '"XAUT0"'::jsonb, true),
    '{symbol,code}',
    to_jsonb(regexp_replace(COALESCE(payload #>> '{symbol,code}', symbol_code), '^ORO', 'XAUT')),
    true
  )
WHERE base_asset = 'ORO';

UPDATE treasury_quant_positions
SET asset = 'XAUT0'
WHERE asset = 'ORO';

ALTER TABLE treasury_quant_signals
  ADD CONSTRAINT treasury_quant_signals_base_asset_check
  CHECK (base_asset IN ('CELO', 'XAUT0'));

ALTER TABLE treasury_quant_positions
  ADD CONSTRAINT treasury_quant_positions_asset_check
  CHECK (asset IN ('CELO', 'XAUT0'));
