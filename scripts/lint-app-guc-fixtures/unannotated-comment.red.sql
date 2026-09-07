-- RED fixture for `unannotated-reader`, COMMENT arm (decision D-05).
--
-- This file's ONLY app-GUC read sits inside a `--` comment, and it carries no
-- lineage header. The gate MUST still fire.
--
-- WHY. Criterion 1's gate is a grep, and a grep does not know a comment from a
-- statement. The measured instance is
-- `20260408113029_cron_heartbeat.sql:113`: the RUNTIME never sees it, the GATE
-- does. Its disposition is a lineage annotation, not a code fix — but an
-- annotation is exactly what a gate that ignored comments could never demand.
--
-- This is also why this linter is a sibling of `lint-sql-gates.mjs` rather than
-- an eighth rule inside it: that engine lints `maskSql()` output, which blanks
-- comment text, and after masking the line below does not exist.
--
-- MUST fire exactly one finding kind: unannotated-reader.

CREATE OR REPLACE FUNCTION example_heartbeat()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Historical note: this used to read current_setting('app.analytics_service_url', TRUE)
  -- before the URL moved to a settings table. Nothing executes that read now.
  PERFORM 1;
END $$;
