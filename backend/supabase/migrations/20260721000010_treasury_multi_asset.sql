ALTER TABLE public.treasury_quant_signals
  DROP CONSTRAINT IF EXISTS treasury_quant_signals_base_asset_check;

ALTER TABLE public.treasury_quant_signals
  ADD CONSTRAINT treasury_quant_signals_base_asset_check
  CHECK (base_asset IN ('CELO', 'XAUT0', 'WETH', 'WBTC', 'EURM'));

ALTER TABLE public.treasury_quant_positions
  DROP CONSTRAINT IF EXISTS treasury_quant_positions_asset_check;

ALTER TABLE public.treasury_quant_positions
  ADD CONSTRAINT treasury_quant_positions_asset_check
  CHECK (asset IN ('CELO', 'XAUT0', 'WETH', 'WBTC', 'EURM'));

CREATE OR REPLACE FUNCTION public.request_treasury_close_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_at timestamptz := now();
  open_ids uuid[];
  newly_requested integer;
BEGIN
  INSERT INTO public.treasury_quant_control (id, paused, pause_reason, updated_at)
  VALUES ('global', true, 'Closing all treasury positions', requested_at)
  ON CONFLICT (id) DO UPDATE SET
    paused = true,
    pause_reason = EXCLUDED.pause_reason,
    updated_at = EXCLUDED.updated_at;

  SELECT coalesce(array_agg(id ORDER BY opened_at), ARRAY[]::uuid[])
  INTO open_ids
  FROM public.treasury_quant_positions
  WHERE status = 'open';

  UPDATE public.treasury_quant_positions
  SET close_requested_at = requested_at,
      close_reason = 'manual_close_all'
  WHERE status = 'open'
    AND close_requested_at IS NULL;

  GET DIAGNOSTICS newly_requested = ROW_COUNT;

  RETURN jsonb_build_object(
    'paused', true,
    'requested', newly_requested,
    'openPositions', coalesce(array_length(open_ids, 1), 0),
    'positionIds', to_jsonb(open_ids),
    'requestedAt', requested_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_treasury_close_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_treasury_close_all() TO service_role;
