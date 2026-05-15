-- Migration 022: make public.public_profiles a SECURITY INVOKER view.
--
-- The Supabase database advisor flagged this view as SECURITY DEFINER
-- (the Postgres default for views), which means queries against the
-- view run with the view creator's privileges and bypass RLS on the
-- underlying `profiles` table. Even though this view only exposes safe
-- public columns (id, display_name, company, description, avatar_url,
-- role, created_at), the best practice is to defer to the querying
-- user's privileges so any future change to RLS policies on `profiles`
-- automatically propagates to the view.
--
-- Reference:
--   https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view

ALTER VIEW public.public_profiles SET (security_invoker = on);

-- Self-verifying assertion — rolls back the transaction if the option
-- didn't take effect.
DO $$
DECLARE
  opts text[];
BEGIN
  SELECT reloptions INTO opts
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relname = 'public_profiles'
    AND relkind = 'v';

  IF opts IS NULL OR NOT ('security_invoker=on' = ANY(opts)) THEN
    RAISE EXCEPTION
      'Migration 022 failed: public.public_profiles does not have security_invoker=on. reloptions=%',
      opts;
  END IF;
END $$;
