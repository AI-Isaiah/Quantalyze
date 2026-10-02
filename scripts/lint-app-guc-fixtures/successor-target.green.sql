-- GREEN fixture: the SUCCESSOR that `lineage.green.sql` names.
--
-- It carries NO lineage header and ZERO app-GUC reads, because that is exactly
-- what a successor must be: the place the mechanism moved TO. If a successor
-- still read an app GUC, the lineage would just point at another copy of the
-- same defect, which is finding `successor-invalid`.
--
-- MUST fire nothing.

CREATE TABLE IF NOT EXISTS example_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO example_settings (key, value)
VALUES ('analytics_service_url', 'https://example.invalid')
ON CONFLICT (key) DO NOTHING;
