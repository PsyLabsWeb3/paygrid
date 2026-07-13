CREATE TABLE gift_gas_sponsor_daily_budgets (
  budget_date date PRIMARY KEY,
  amount_reserved numeric(36, 18) NOT NULL DEFAULT 0,
  claims_reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gift_gas_sponsorships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL UNIQUE REFERENCES gifts(id) ON DELETE CASCADE,
  recipient_address text NOT NULL UNIQUE,
  amount numeric(36, 18) NOT NULL CHECK (amount > 0),
  token token NOT NULL DEFAULT 'USDm' CHECK (token = 'USDm'),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'submitted', 'confirmed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 2),
  tx_hash text UNIQUE,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gift_gas_sponsorships_status ON gift_gas_sponsorships(status);
CREATE INDEX idx_gift_gas_sponsorships_created ON gift_gas_sponsorships(created_at DESC);

ALTER TABLE gift_gas_sponsor_daily_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_gas_sponsorships ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reserve_gift_gas_sponsorship(
  p_gift_id uuid,
  p_recipient_address text,
  p_amount numeric,
  p_daily_amount_limit numeric,
  p_daily_claim_limit integer
) RETURNS gift_gas_sponsorships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing gift_gas_sponsorships;
  budget gift_gas_sponsor_daily_budgets;
  today date := timezone('utc', now())::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('paygrid-gift-gas-' || today::text));

  SELECT * INTO existing
  FROM gift_gas_sponsorships
  WHERE gift_id = p_gift_id OR recipient_address = lower(p_recipient_address)
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF existing.gift_id <> p_gift_id THEN
      RAISE EXCEPTION 'RECIPIENT_ALREADY_SPONSORED';
    END IF;
    IF existing.recipient_address <> lower(p_recipient_address) THEN
      RAISE EXCEPTION 'SPONSORED_RECIPIENT_MISMATCH';
    END IF;
    IF existing.status = 'failed'
       AND existing.attempt_count < 2
       AND existing.tx_hash IS NULL
       AND existing.updated_at < now() - interval '2 minutes' THEN
      UPDATE gift_gas_sponsorships
      SET status = 'reserved',
          attempt_count = attempt_count + 1,
          failure_reason = NULL,
          updated_at = now()
      WHERE id = existing.id
      RETURNING * INTO existing;
    END IF;
    RETURN existing;
  END IF;

  INSERT INTO gift_gas_sponsor_daily_budgets (budget_date)
  VALUES (today)
  ON CONFLICT (budget_date) DO NOTHING;

  SELECT * INTO budget
  FROM gift_gas_sponsor_daily_budgets
  WHERE budget_date = today
  FOR UPDATE;

  IF budget.amount_reserved + p_amount > p_daily_amount_limit
     OR budget.claims_reserved + 1 > p_daily_claim_limit THEN
    RAISE EXCEPTION 'SPONSOR_DAILY_LIMIT';
  END IF;

  INSERT INTO gift_gas_sponsorships (gift_id, recipient_address, amount)
  VALUES (p_gift_id, lower(p_recipient_address), p_amount)
  RETURNING * INTO existing;

  UPDATE gift_gas_sponsor_daily_budgets
  SET amount_reserved = amount_reserved + p_amount,
      claims_reserved = claims_reserved + 1,
      updated_at = now()
  WHERE budget_date = today;

  RETURN existing;
END;
$$;

REVOKE ALL ON FUNCTION reserve_gift_gas_sponsorship(uuid, text, numeric, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_gift_gas_sponsorship(uuid, text, numeric, numeric, integer) TO service_role;
