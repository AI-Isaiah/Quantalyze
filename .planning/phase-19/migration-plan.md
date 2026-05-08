# Phase 19 — Migration Plan (slots 103-107)

**Generated:** 2026-05-08
**Phase entry condition:** migration numbers reserved upfront in this document; plan-checker rejects Phase 19 entry if any of slots 103-107 collide with shipped migrations or if numbering is not sequential.

## Why 103-107, not 093-097

REQUIREMENTS.md FINGERPRINT-01 originally referenced "Migration 096" and the autoplan reserved 093-097. Those slots are taken:

| Slot | Status | Title |
|------|--------|-------|
| 093 | shipped | strategy_verifications (Phase 15 / CSV-01) |
| 094 | shipped | strategy_verifications_rls_polish |
| 095..097 | NOT ASSIGNED in repo (consumed in absentia by Phase 16 prep `migration-drift-resolution.md`) |
| 098 | shipped | resend_message_correlation |
| 099 | shipped | mark_compute_job_atomic_status_bridge |
| 100 | shipped | strategies_source_csv |
| 101 | shipped | partner_tag_check_constraint |
| 102 | shipped | sync_trades_preserve_fills |

Phase 19 claims the next 5 sequential slots: 103, 104, 105, 106, 107.

## Slot Reservation

| Slot | Title | Phase 19 Plan | Required For | Rollback Semantics |
|------|-------|---------------|--------------|---------------------|
| 103 | strategy_verifications state-machine extensions + transition_strategy_verification RPC + transitioned_at + encrypted_credentials + public_token first-class column | P2 | BACKBONE-03 (state-machine completion) + P4 router pipeline | Drop RPC, drop transitioned_at + encrypted_credentials + public_token columns. Existing rows preserved (no DELETE). Phase 15 finalize_csv_strategy continues working (INSERTs fresh `validated` row using DEFAULT now() for transitioned_at). Down-migration: `down/103-rollback.sql` covers each forward DDL. |
| 104 | wizard_session_id UNIQUE INDEX + compute_jobs.kind widened to admit `process_key_long` + claim_compute_jobs_with_priority extended with 3rd arg `p_unified_backbone_active BOOLEAN DEFAULT NULL` writing `unified_backbone_at_claim` metadata + feature_flags kill-switch table | P2 | BACKBONE-08 (UNIQUE INDEX duplicate prevention) + BACKBONE-09 (process_key_long dispatch) + BACKBONE-05 (kill-switch row) + drain semantics | Drop UNIQUE INDEX (safe — no other code reads it); narrow kind CHECK after verifying zero `process_key_long` rows in flight; drop feature_flags table (kills auto-rollback but flags fall back to env var read). Down-migration: `down/104-rollback.sql`. |
| 105 | strategies.fingerprint JSONB + partial index `WHERE fingerprint IS NOT NULL` + CHECK constraint `((fingerprint->>'version') IS NOT NULL AND (fingerprint->>'version')::INT = 1)` + compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC plain plpgsql cosine (IMMUTABLE PARALLEL SAFE) | P2 | FINGERPRINT-01 (column + persistence) + FINGERPRINT-02 (cosine function) | Drop column (preserves existing rows by NULL-out via prior backup; backfill required if reverted). Drop function. CHECK lifts on column drop. Down-migration: `down/105-rollback.sql`. |
| 106 | VIEW-shim step (a) sentinel — repoint `verify-strategy/route.ts:115` UPDATE to `strategy_verifications` BEFORE rename. Empty migration body except `DO $$ ... RAISE NOTICE 'Migration 106: BACKBONE-04 step (a) sentinel.' END $$;` | P5 (commit a) | BACKBONE-04 step (a) | No-op rollback — migration is sentinel only; route.ts revert handles the actual rollback. |
| 107 | VIEW-shim step (d) — rename `verification_requests` → `verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT ... FROM strategy_verifications` + INSTEAD OF INSERT/UPDATE/DELETE triggers + RLS retention 90 days on legacy table + `verification_requests_legacy` retains public_token-gated SELECT policy for 90 days (M-6) | P5 (commit d) | BACKBONE-04 step (d) | Drop VIEW + INSTEAD OF triggers; `ALTER TABLE verification_requests_legacy RENAME TO verification_requests`; flip kill-switch row to `off`; restart Vercel + Railway to clear 30s flag cache. Forward migration is 30s; rollback path documented in `.planning/phase-19/rollback-runbook.md` post-PR-D section. Down-migration: `down/107-rollback.sql` performs the rename in reverse + drops VIEW + drops triggers. |

## Sequencing

- 103, 104, 105 land in Wave 1 (P2) — independent foundation; can apply atomically via `supabase db push` after all three files are written.
- 106 lands AT commit (a) of P5 (Wave 3) — the migration is a sentinel; the load-bearing change is the route.ts repoint shipping in the same commit.
- 107 lands AT commit (d) of P5 (Wave 3) — AFTER 7 calendar days of zero writes to `verification_requests` legacy table per BACKBONE-04 stability window. Plan-checker enforces 168h delta between commit (b) flag-flip timestamp and commit (d) shipping.

## Self-verifying DO blocks

Each migration MUST end with a `DO $$ ... END $$;` block asserting the migration's load-bearing changes (e.g., column exists, RPC exists, function flags are correct). Pattern: see `supabase/migrations/093_strategy_verifications.sql` STEP 7 (lines 296-370). 086_compute_jobs_priority.sql also a reference.

## Down-Migrations (C-8 fix)

Every forward migration in 103-107 ships a paired `supabase/migrations/down/{N}-rollback.sql` (or single `down/103-107-rollback.sql`) covering the inverse statements. Tested at least once in dev before production push.

## Plan-Checker Enforcement

- File presence: `test -f supabase/migrations/103_*.sql && test -f supabase/migrations/104_*.sql && test -f supabase/migrations/105_*.sql && test -f supabase/migrations/106_*.sql && test -f supabase/migrations/107_*.sql`
- Sequencing: `ls supabase/migrations/ | grep -E '^10[3-7]_' | wc -l` returns 5
- Down-migration paired: `ls supabase/migrations/down/ | wc -l` returns ≥ 1 covering 103-107
- Schema push: `supabase db push` BEFORE Phase 19 verification (else build/types pass while live DB diverges).
