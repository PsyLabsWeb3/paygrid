CREATE TABLE public.treasury_withdrawal_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
  address text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  destination_type text NOT NULL CHECK (destination_type IN ('minipay', 'exchange', 'external_wallet')),
  chain_id integer NOT NULL CHECK (chain_id IN (42220, 11142220)),
  asset text NOT NULL CHECK (asset IN ('USDC', 'USDT', 'USDm', 'CELO', 'XAUT0', 'WETH', 'WBTC', 'EURM')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

CREATE UNIQUE INDEX treasury_withdrawal_addresses_active_unique
  ON public.treasury_withdrawal_addresses (lower(address), chain_id, asset)
  WHERE active;

CREATE TABLE public.treasury_fund_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL UNIQUE CHECK (char_length(request_id) BETWEEN 1 AND 120),
  operation_type text NOT NULL CHECK (operation_type IN ('deposit', 'withdrawal')),
  asset text NOT NULL CHECK (asset IN ('USDC', 'USDT', 'USDm', 'CELO', 'XAUT0', 'WETH', 'WBTC', 'EURM')),
  amount numeric(60, 24) NOT NULL CHECK (amount > 0),
  destination_address text CHECK (destination_address IS NULL OR destination_address ~ '^0x[0-9a-fA-F]{40}$'),
  withdrawal_address_id uuid REFERENCES public.treasury_withdrawal_addresses(id),
  payment_link_id uuid REFERENCES public.payment_links(id),
  creation_tx_hash text,
  mode text CHECK (mode IS NULL OR mode IN ('free', 'evacuate')),
  status text NOT NULL CHECK (status IN ('active', 'paid', 'expired', 'pending', 'submitted', 'confirmed', 'failed')),
  tx_hash text,
  attribution_code text,
  attribution_verified boolean,
  position_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX treasury_fund_operations_created
  ON public.treasury_fund_operations (created_at DESC);
CREATE INDEX treasury_fund_operations_link
  ON public.treasury_fund_operations (payment_link_id)
  WHERE payment_link_id IS NOT NULL;

CREATE TABLE public.treasury_execution_lease (
  id text PRIMARY KEY CHECK (id = 'global'),
  holder text,
  purpose text,
  acquired_at timestamptz,
  expires_at timestamptz
);

INSERT INTO public.treasury_execution_lease (id)
VALUES ('global')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.acquire_treasury_execution_lease(
  p_holder text,
  p_purpose text,
  p_ttl_seconds integer DEFAULT 180
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired boolean;
BEGIN
  IF p_holder IS NULL OR char_length(p_holder) < 1 THEN
    RAISE EXCEPTION 'Lease holder is required';
  END IF;
  IF p_ttl_seconds < 30 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'Lease TTL must be between 30 and 900 seconds';
  END IF;

  INSERT INTO public.treasury_execution_lease (id, holder, purpose, acquired_at, expires_at)
  VALUES ('global', p_holder, p_purpose, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (id) DO UPDATE SET
    holder = EXCLUDED.holder,
    purpose = EXCLUDED.purpose,
    acquired_at = EXCLUDED.acquired_at,
    expires_at = EXCLUDED.expires_at
  WHERE public.treasury_execution_lease.holder IS NULL
     OR public.treasury_execution_lease.expires_at <= now()
     OR public.treasury_execution_lease.holder = EXCLUDED.holder
  RETURNING true INTO acquired;

  RETURN coalesce(acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_treasury_execution_lease(p_holder text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released boolean;
BEGIN
  UPDATE public.treasury_execution_lease
  SET holder = NULL,
      purpose = NULL,
      acquired_at = NULL,
      expires_at = NULL
  WHERE id = 'global' AND holder = p_holder
  RETURNING true INTO released;

  RETURN coalesce(released, false);
END;
$$;

ALTER TABLE public.treasury_withdrawal_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_fund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_execution_lease ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.treasury_withdrawal_addresses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.treasury_fund_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.treasury_execution_lease FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.treasury_withdrawal_addresses TO service_role;
GRANT ALL ON TABLE public.treasury_fund_operations TO service_role;
GRANT ALL ON TABLE public.treasury_execution_lease TO service_role;

REVOKE ALL ON FUNCTION public.acquire_treasury_execution_lease(text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_treasury_execution_lease(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_treasury_execution_lease(text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_treasury_execution_lease(text)
  TO service_role;

-- Historical mainnet withdrawal performed before this console existed.
WITH approved_destination AS (
  INSERT INTO public.treasury_withdrawal_addresses (
    label,
    address,
    destination_type,
    chain_id,
    asset
  ) VALUES (
    'Binance CELO',
    '0xd777e3efe6a33f0e5988615665c88a72de2ee084',
    'exchange',
    42220,
    'CELO'
  )
  ON CONFLICT DO NOTHING
  RETURNING id
), destination AS (
  SELECT id FROM approved_destination
  UNION ALL
  SELECT id FROM public.treasury_withdrawal_addresses
  WHERE lower(address) = '0xd777e3efe6a33f0e5988615665c88a72de2ee084'
    AND chain_id = 42220
    AND asset = 'CELO'
    AND active
    AND NOT EXISTS (SELECT 1 FROM approved_destination)
  LIMIT 1
)
INSERT INTO public.treasury_fund_operations (
  request_id,
  operation_type,
  asset,
  amount,
  destination_address,
  withdrawal_address_id,
  mode,
  status,
  tx_hash,
  attribution_code,
  attribution_verified,
  position_ids,
  submitted_at,
  confirmed_at,
  updated_at
)
SELECT
  'historical:0x4d5cde5e3cf08c8f3e681b65c59e6da8f725bebd44eb7cb4d88488e07ea18aa3',
  'withdrawal',
  'CELO',
  1300,
  '0xd777e3efe6a33f0e5988615665c88a72de2ee084',
  destination.id,
  'evacuate',
  'confirmed',
  '0x4d5cde5e3cf08c8f3e681b65c59e6da8f725bebd44eb7cb4d88488e07ea18aa3',
  NULL,
  false,
  ARRAY[
    'ef595bdc-a4aa-4633-a1cf-67298539e9bc',
    '30139cef-98a7-4e32-b009-a43b5b1b8a4e',
    'e0c02b4d-cd9d-4830-a7a4-48b29c1788da',
    'a1b45cc5-3b31-444a-88db-19a9e704d37f',
    '93a926ad-bf5b-42f3-bc3b-85cff355a638',
    'ee16caf6-8d70-48f0-a868-119e2bbb8060'
  ]::uuid[],
  '2026-07-28T21:24:53Z',
  '2026-07-28T21:24:53Z',
  now()
FROM destination
ON CONFLICT (request_id) DO NOTHING;
