ALTER TABLE IF EXISTS public.schema_migrations
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public.schema_migrations
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT
  ON TABLE public.schema_migrations
  TO service_role;
