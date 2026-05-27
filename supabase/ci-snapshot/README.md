# CI schema snapshot (F10)

A committed, schema-only snapshot of the production/test database, used to stand
up an **ephemeral local Supabase** inside CI so the SQL self-tests stop hitting
the shared remote test project (`qmnijlgmdhviwzwfyzlc`). Hitting that shared DB
caused cross-run contention and flakes; an ephemeral per-job stack is isolated.

## Why a snapshot instead of replaying migrations

`supabase start` / `db reset` replay `supabase/migrations/**` through the pgx
**pipeline** protocol, which rejects `CREATE INDEX CONCURRENTLY` (7 migrations
use it — correct for prod, fatal for local replay: `SQLSTATE 25001`). Raw
`psql -f` of the migrations instead chokes on the `ROLLBACK TO SAVEPOINT`
statements inside `DO $$ … $$` self-test probe blocks (3 migrations). The two
are mutually exclusive — no single local applier handles both.

`pg_dump --schema-only` sidesteps both: it emits **final-state** DDL with plain
`CREATE INDEX` (no `CONCURRENTLY`) and no `DO`-block savepoints, all idempotent
(`IF NOT EXISTS` / `OR REPLACE`). That snapshot loads into a bootstrap-only
stack cleanly.

## Files (loaded in numeric order, after `supabase start`)

| File | Purpose |
|------|---------|
| `01-pre-load.sql` | Neutralize Supabase's `ALTER DEFAULT PRIVILEGES` so the dump's explicit ACLs are authoritative. **Without it, 4 EXECUTE-hardening tests fail** — see the file header for the pg_dump ACL-delta mechanism. |
| `02-schema.sql` | `supabase db dump` output (schema only, no data → no PII). Excludes internal schemas (`auth`, `storage`, `extensions`, `supabase_migrations`, `cron`, …) — those are provided by the bootstrap stack. |
| `03-cron-jobs.sql` | `cron.schedule(...)` calls for the retention jobs. The dump excludes the `cron` schema, so `cron.job` registrations (asserted by `test_retention_crons_safe.sql`) are replayed from this supplement. |
| `MIGRATIONS.sha256` | Staleness sentinel: SHA-256 of `supabase/migrations/**` contents at generation time. CI compares it against the live tree and fails loud if they drift (snapshot needs regeneration). |

The bootstrap stack must be started with `supabase/migrations/**` and
`supabase/seed.sql` relocated out (so no replay/seed runs), then PostgREST's
schema cache reloaded (`NOTIFY pgrst, 'reload schema';`) after the load.

## Regenerating (after any schema migration lands on `main`)

The snapshot reflects **`main`'s deployed schema**. A migration applies to the
test/prod DB only when it merges to `main` (the `supabase-migrate` pipeline), so
the snapshot is regenerated **after merge**, not at PR time — matching how the
remote test DB behaved before F10.

Use the secret-gated workflow (preferred — canonical source is the test project):

```
gh workflow run ci-db-snapshot.yml
```

It dumps from `secrets.TEST_SUPABASE_DB_URL`, regenerates all three SQL files +
`MIGRATIONS.sha256`, and uploads them as an artifact to review and commit. It
does **not** auto-push to `main`.

To regenerate locally against the linked project (schema is identical across
test/prod — same migration head):

```
supabase db dump --linked -f supabase/ci-snapshot/02-schema.sql
# cron supplement:
#   SELECT string_agg(format('SELECT cron.schedule(%L, %L, %L);', jobname, schedule, command), E'\n' ORDER BY jobname) FROM cron.job;
( cd supabase/migrations && find . -name '*.sql' | LC_ALL=C sort | xargs cat | shasum -a 256 | awk '{print $1}' ) > supabase/ci-snapshot/MIGRATIONS.sha256
```
