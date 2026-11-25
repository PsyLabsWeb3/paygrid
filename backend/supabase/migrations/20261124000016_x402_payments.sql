-- Isolated from payment links: x402 transfers settle directly to the API seller.
CREATE TABLE public.x402_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('incoming','outgoing')),
  identity_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  network text NOT NULL CHECK (network IN ('eip155:42220','eip155:11142220')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','settled','failed','unknown')),
  phase text NOT NULL DEFAULT 'created' CHECK (phase IN ('created','reserved','signed','submitted','complete')),
  payer text, asset text, token text CHECK (token IN ('USDC','USDT','wMXN')),
  amount_atomic text CHECK (amount_atomic ~ '^[1-9][0-9]{0,77}$' AND amount_atomic::numeric < power(2::numeric,256)),
  requirements jsonb,
  authorization_key text, authorization_hash text, authorization_expires_at timestamptz,
  ciphertext text, receipt jsonb, result jsonb, result_expires_at timestamptz,
  reserved boolean NOT NULL DEFAULT false, budget_date date,
  error text, lease_owner uuid, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(direction, authorization_key)
);
CREATE UNIQUE INDEX x402_settlement_once ON public.x402_operations(direction,network,lower(receipt->>'transaction'))
  WHERE receipt->>'success'='true';
CREATE INDEX x402_operations_recovery ON public.x402_operations(updated_at)
  WHERE state IN ('pending','unknown') OR (state='settled' AND phase<>'complete');
CREATE INDEX x402_operations_budget ON public.x402_operations(network,lower(payer),lower(asset),budget_date);
ALTER TABLE public.x402_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.x402_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.x402_operations TO service_role;

CREATE FUNCTION public.x402_create_operation(p_direction text,p_key text,p_hash text,p_request jsonb,p_network text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op x402_operations;
BEGIN
  INSERT INTO x402_operations(direction,identity_key,request_hash,request,network)
  VALUES(p_direction,p_key,p_hash,p_request,p_network) ON CONFLICT(identity_key) DO NOTHING;
  SELECT * INTO STRICT op FROM x402_operations WHERE identity_key=p_key;
  IF op.request_hash<>p_hash OR op.direction<>p_direction THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN to_jsonb(op);
END $$;

CREATE FUNCTION public.x402_claim_operation(p_id uuid,p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op x402_operations;
BEGIN
  UPDATE x402_operations SET lease_owner=p_owner,lease_until=now()+interval '180 seconds',updated_at=now()
  WHERE id=p_id AND (state IN ('pending','unknown') OR (state='settled' AND phase<>'complete')) AND (lease_until IS NULL OR lease_until<now() OR lease_owner=p_owner)
  RETURNING * INTO op;
  RETURN CASE WHEN op.id IS NULL THEN NULL ELSE to_jsonb(op) END;
END $$;

CREATE FUNCTION public.x402_patch_operation(p_id uuid,p_owner uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op x402_operations; changed x402_operations;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN (
    'state','phase','payer','asset','token','amount_atomic','requirements','authorization_key',
    'authorization_hash','authorization_expires_at','ciphertext','receipt','result',
    'result_expires_at','reserved','error','lease_until')) THEN RAISE EXCEPTION 'INVALID_PATCH'; END IF;
  SELECT * INTO STRICT op FROM x402_operations WHERE id=p_id FOR UPDATE;
  IF op.lease_owner IS DISTINCT FROM p_owner OR op.lease_until<now() THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  changed=jsonb_populate_record(op,p_patch);
  IF op.authorization_key IS NOT NULL AND (
    changed.authorization_key IS DISTINCT FROM op.authorization_key OR
    changed.authorization_hash IS DISTINCT FROM op.authorization_hash OR
    changed.requirements IS DISTINCT FROM op.requirements OR
    changed.payer IS DISTINCT FROM op.payer OR changed.asset IS DISTINCT FROM op.asset OR
    changed.amount_atomic IS DISTINCT FROM op.amount_atomic OR changed.ciphertext IS DISTINCT FROM op.ciphertext
  ) THEN RAISE EXCEPTION 'AUTHORIZATION_IMMUTABLE'; END IF;
  UPDATE x402_operations SET state=changed.state,phase=changed.phase,payer=changed.payer,
    asset=changed.asset,token=changed.token,amount_atomic=changed.amount_atomic,
    requirements=changed.requirements,authorization_key=changed.authorization_key,
    authorization_hash=changed.authorization_hash,authorization_expires_at=changed.authorization_expires_at,
    ciphertext=changed.ciphertext,receipt=changed.receipt,result=changed.result,
    result_expires_at=changed.result_expires_at,reserved=changed.reserved,error=changed.error,
    budget_date=CASE WHEN op.direction='outgoing' AND op.state<>'settled' AND changed.state='settled'
      THEN timezone('utc',now())::date ELSE op.budget_date END,
    lease_until=CASE WHEN p_patch ? 'lease_until' THEN changed.lease_until ELSE now()+interval '180 seconds' END,updated_at=now()
  WHERE id=p_id RETURNING * INTO op;
  RETURN to_jsonb(op);
END $$;

CREATE FUNCTION public.x402_reserve_budget(p_id uuid,p_owner uuid,p_payment jsonb,p_requirements jsonb,p_daily text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op x402_operations; total numeric; amount numeric; today date=timezone('utc',now())::date;
BEGIN
  amount=(p_payment->>'amountAtomic')::numeric;
  IF amount<=0 OR amount>=power(2::numeric,256) OR amount<>trunc(amount) OR p_daily::numeric<=0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  -- All assets share the wallet lock: EIP-2612 nonce reads must never race.
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(p_payment->>'payer')||':'||(p_payment->>'network'),0));
  SELECT * INTO STRICT op FROM x402_operations WHERE id=p_id FOR UPDATE;
  IF op.direction<>'outgoing' OR op.lease_owner IS DISTINCT FROM p_owner OR op.lease_until<now()
    OR op.state<>'pending' OR op.phase NOT IN ('created','reserved') THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  IF p_payment->>'network'<>op.network THEN RAISE EXCEPTION 'NETWORK_MISMATCH'; END IF;
  IF op.reserved THEN
    IF op.requirements IS DISTINCT FROM p_requirements OR op.amount_atomic::numeric<>amount THEN RAISE EXCEPTION 'RESERVATION_IMMUTABLE'; END IF;
    RETURN to_jsonb(op);
  END IF;
  IF EXISTS(SELECT 1 FROM x402_operations WHERE direction='outgoing' AND network=op.network
    AND lower(payer)=lower(p_payment->>'payer') AND id<>p_id AND reserved) THEN RAISE EXCEPTION 'WALLET_BUSY'; END IF;
  SELECT coalesce(sum(amount_atomic::numeric),0) INTO total FROM x402_operations
    WHERE direction='outgoing' AND network=op.network AND lower(payer)=lower(p_payment->>'payer')
      AND lower(asset)=lower(p_payment->>'asset')
      AND ((state='settled' AND budget_date=today) OR reserved);
  IF total+amount>p_daily::numeric THEN RAISE EXCEPTION 'BUDGET_EXCEEDED'; END IF;
  UPDATE x402_operations SET payer=lower(p_payment->>'payer'),asset=lower(p_payment->>'asset'),
    token=p_payment->>'token',amount_atomic=amount::text,requirements=p_requirements,reserved=true,
    budget_date=today,phase='reserved',lease_until=now()+interval '180 seconds',updated_at=now()
    WHERE id=p_id RETURNING * INTO op;
  RETURN to_jsonb(op);
END $$;

CREATE FUNCTION public.x402_prune_results()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE x402_operations SET result=NULL
  WHERE result_expires_at<now() AND result IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.x402_create_operation(text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.x402_claim_operation(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.x402_patch_operation(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.x402_reserve_budget(uuid,uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.x402_prune_results() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.x402_create_operation(text,text,text,jsonb,text),
  public.x402_claim_operation(uuid,uuid),public.x402_patch_operation(uuid,uuid,jsonb),
  public.x402_reserve_budget(uuid,uuid,jsonb,jsonb,text),public.x402_prune_results() TO service_role;

CREATE FUNCTION public.x402_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('schemaVersion',1,'ready',
    to_regprocedure('public.x402_create_operation(text,text,text,jsonb,text)') IS NOT NULL AND
    to_regprocedure('public.x402_claim_operation(uuid,uuid)') IS NOT NULL AND
    to_regprocedure('public.x402_patch_operation(uuid,uuid,jsonb)') IS NOT NULL AND
    to_regprocedure('public.x402_reserve_budget(uuid,uuid,jsonb,jsonb,text)') IS NOT NULL AND
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='x402_settlement_once'));
$$;
REVOKE ALL ON FUNCTION public.x402_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.x402_health() TO service_role;
