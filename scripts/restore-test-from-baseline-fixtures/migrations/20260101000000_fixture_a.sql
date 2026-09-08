-- Self-test fixture migration. NEVER executed by anything: the restore SEEDS the
-- ledger from the FILE LIST, it does not run these. Its only job is to be one of
-- three enumerable `<14-digit>_<description>.sql` names, so the seeded ledger can be
-- checked for 14-digit versions and description-only names.
SELECT 1;
