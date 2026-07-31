REVOKE ALL PRIVILEGES
  ON FUNCTION public.reserve_gift_gas_sponsorship(uuid, text, numeric, numeric, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.reserve_gift_gas_sponsorship(uuid, text, numeric, numeric, integer)
  TO service_role;
