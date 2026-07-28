# PR-D — ready, parked, NOT yet active

These files are the **reviewed-but-inert** "PR-D" of the Phase 19 VIEW-shim
sequence. They live here (not in `supabase/migrations/`) on purpose: an
unapplied destructive migration sitting in the active migrations dir is a
landmine — the next `supabase db push --include-all` would attempt it, and its
STEP 0.5 apply-time gate would abort (kill-switch is `off`), failing the
migrate workflow.

| File | What it does |
|---|---|
| `20260525120000_verification_requests_view_shim_apply.sql` | Renames `verification_requests` → `_legacy`, creates the `security_invoker` VIEW over `strategy_verifications`, adds INSTEAD OF triggers, sets legacy-table RLS, and repoints `sanitize_user`'s GDPR delete (B3). Has a rebuild-safe apply-time gate that aborts unless the kill-switch is `on`. |
| `20260525120000-rollback.sql` | Stage-D reversal (drops VIEW+triggers, renames back, restores `sanitize_user`). |

Reviewed clean by `migration-reviewer` + `rls-policy-auditor` on 2026-05-25
(1 HIGH addressed via the STEP 0.5 gate; LOW policy-comment restored).

## Activating PR-D (only after the 168h soak is genuinely green)

1. Move both files back:
   - `git mv .planning/phase-19/pr-d-ready/20260525120000_verification_requests_view_shim_apply.sql supabase/migrations/`
   - `git mv .planning/phase-19/pr-d-ready/20260525120000-rollback.sql supabase/migrations/down/`
2. Repoint `analytics-service/tests/test_legacy_table_rls.py` `_MIGRATION_PATH`
   to `20260525120000_verification_requests_view_shim_apply.sql` (it currently
   pins the inert `20260509082818` placeholder).
3. Ship as PR-D; apply via `supabase-migrate` (manual `workflow_dispatch`).

Prereqs already merged: PR-X1 (#145), PR-X2 (#146), PR-X5 (#163).
