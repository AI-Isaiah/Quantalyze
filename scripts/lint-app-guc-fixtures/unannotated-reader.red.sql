-- RED fixture for `unannotated-reader` (Phase 164.7, criterion 1).
--
-- One EXECUTABLE app-GUC read, no lineage header. This is the shape the gate
-- exists to stop: a fresh migration that resolves configuration from a GUC
-- nobody on this platform can set (ALTER DATABASE ... SET on a placeholder GUC
-- returns 42501 on Supabase), so the read silently yields NULL forever.
--
-- MUST fire exactly one finding kind: unannotated-reader.

DO $$
DECLARE
  v_url text;
BEGIN
  v_url := current_setting('app.analytics_service_url', TRUE);
  RAISE NOTICE 'url=%', v_url;
END $$;
