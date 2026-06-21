# Runbook — Migration failure & schema_migrations repair

tech-debt #17. Covers the generic "a migration broke prod / the auto-apply
workflow failed / the migration ledger drifted" cases. For a single migration's
bespoke fence procedure see `deploy-mig-117-claim-token-fence.md`.

## How migrations reach prod

Merging any `supabase/migrations/**` file to `main` triggers
`.github/workflows/supabase-migrate.yml`, which runs
`supabase db push --include-all` against the PROD project
(`SUPABASE_PROJECT_REF` = `khslejtfbuezsmvmtsdn`). There is **no separate apply
to the TEST project** — it is caught up by hand (this lag is tracked finding #18).
PRs touching migrations also run `migration-drift-check.yml` (a
`db push --include-all --dry-run` against prod) as a pre-merge gate.

## Failure mode 1 — auto-apply workflow fails

1. Read the failed `Supabase Migrate` run log. Two common stop points:
   - **Secrets missing** → the apply step no-ops with a `::notice::` (not a real
     failure). Set `SUPABASE_PROJECT_REF` (var) + `SUPABASE_ACCESS_TOKEN` /
     `SUPABASE_DB_PASSWORD` (secrets).
   - **SQL error mid-apply** → the offending statement is in the log. Fix it with
     a **forward** migration (see "Never edit a merged migration" below); never
     re-edit the failed file in place.
2. **The C-0331 "Reverted" guard.** The CLI can exit 0 while silently skipping a
   migration body (a swallowed SQL exception). So after `db push` the workflow
   runs `supabase migration list --linked` and **fails if any row says
   "Reverted"**. If you see that error: the migration did NOT apply despite a
   green-looking push. Inspect the migration, fix forward, re-run.

## Failure mode 2 — a migration broke prod (applied, but wrong)

The change is already live. Do not delete the migration.
- **Forward fix (default):** ship a new migration that corrects the schema/data.
- **DOWN script:** if a reversible script exists in `supabase/migrations/down/`
  (17 today, `IF EXISTS`-guarded + idempotent, named `<version>-rollback.sql`),
  apply the matching one to undo a function/constraint change. Confirm it targets
  the version you applied before running it.

## Failure mode 3 — schema_migrations ledger drift

Symptom: `db push` insists migrations are pending that are already applied, or
refuses to apply because "remote is ahead", with no real schema difference.

Root cause (documented repeat-bite): the Supabase MCP `apply_migration` stamps
`schema_migrations.version` with `now()` instead of the migration **file's**
timestamp, so the ledger row is off by a second or two from the filename. `db
push --include-all` then compares filename-prefix vs ledger and sees phantom
drift.

Repair (one of):
- Rename the **local file** so its 14-digit timestamp prefix matches the remote
  `schema_migrations.version` row, then re-run; or
- Correct the `schema_migrations` row to match the file via
  `supabase migration repair` / a manual `UPDATE` (prefer the file rename — it
  leaves no manual DB edit).

After repair, re-run `migration-drift-check.yml` (or a local
`db push --include-all --dry-run`) and confirm it reports a true no-op.

## Never edit a merged migration

A merged migration has already applied to prod; editing it changes nothing on
prod and desyncs the ledger from the files. Always ship a **forward** migration.
(CONTRIBUTING "Workflow" states this as an invariant.)

## Verify recovery

```bash
# Pre-merge dry-run should be a clean no-op:
supabase db push --include-all --dry-run        # against SUPABASE_PROJECT_REF
# No row should read "Reverted":
supabase migration list --linked
```
Then exercise the affected feature against prod, and watch
[sentry-triage.md](./sentry-triage.md) — error rates settle a few minutes after
the schema is corrected.
