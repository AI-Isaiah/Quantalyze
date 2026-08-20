# Contributing & Operations

This file captures the things that are not obvious from the code and that, if
you get them wrong, break production. Read the "Deploy semantics" section before
your first merge — merging to main triggers production deploys through three
paths (Vercel, Supabase migrations, and Railway).

For local setup, see [README.md](README.md). For architecture decisions, see
[`docs/architecture/`](docs/architecture/) (ADRs). For incident response, see
[`docs/runbooks/`](docs/runbooks/).

## Prerequisites

- Node.js 20+ (pinned in `.nvmrc`; enforced by `package.json` `engines`)
- Python 3.12 (pinned — the analytics service Dockerfile and CI both use
  3.12; do not develop against 3.13/3.14, it drifts from CI)
- [Supabase CLI](https://supabase.com/docs/guides/cli) for migrations
- A Supabase project (see README for env setup)

## Deploy semantics — read this first

There is no manual "deploy" step. Merging to `main` triggers production
deploys through **three independent paths** (Vercel and Supabase fire on every
qualifying merge; Railway is gated on green CI):

### 1. Vercel (frontend) — deploys on every push to `main`

Every merge to `main` rebuilds and deploys the Next.js app to production
(`https://quantalyze-rho.vercel.app`). A docs/config-only change still triggers
a (functionally identical) rebuild.

### 2. Supabase migrations — auto-apply to PROD on merge

**Merging a file under `supabase/migrations/**` to `main` applies it to the
production database**, via the `push` trigger in
[`.github/workflows/supabase-migrate.yml`](.github/workflows/supabase-migrate.yml)
(`supabase db push --include-all`). There is no separate "apply" button — the
merge *is* the apply.

- Backdated / drift-introducing migrations are blocked at **PR-time** by
  `migration-policy.yml` and `migration-drift-check.yml`. They fire before
  merge, which is the only place they can prevent a bad apply.
- **The apply job fails loud on a push if its secrets are unset** (v0.52.0.0). A
  push run only happens when migrations merged, so "skipped, nothing applied"
  is never a legitimate outcome there — it is how a freshly-deployed worker ends
  up talking to an old prod schema (`PGRST204`) while every dashboard stays
  green. A manual `workflow_dispatch` on an unconfigured clone still skips
  tolerantly. See [`docs/runbooks/migration-failure.md`](docs/runbooks/migration-failure.md).
- **Behavioural SQL gates run in the `sql-tests` CI job**, which serializes
  with `python` and `e2e-seeded` through a Postgres session advisory lock on
  the TEST project (key 61616158, the "Acquire shared-test-db mutex" step —
  Phase 158). The old repo-wide `shared-test-db` **concurrency group is gone**:
  it held exactly one pending slot, so a PR opening mid-run could evict a
  queued main-branch run, conclude main CI `cancelled`, and silently skip the
  Railway deploy (issue #616). `sql-tests` is still ordered behind `python`
  (`needs: python` is kept) and now gates the `frontend` aggregator. Do not
  reintroduce a job-level concurrency group for these jobs; the ⛔ comments in
  `ci.yml` and
  [`docs/runbooks/shared-test-db-mutex.md`](docs/runbooks/shared-test-db-mutex.md)
  say why.
- **⛔ A migration that adds a column the frontend already `SELECT`s must be
  applied to prod BEFORE the deployment that reads it.** The auto-apply and the
  Vercel build both fire on the same merge with **no ordering between them**, so
  "they land together" is not "they land in order". If the deployment wins,
  PostgREST answers `42703` / `PGRST204` for the duration — and a route that
  fails CLOSED on an unreadable shape (the correct posture for a security read)
  turns that window into a full outage of that path, not a degraded one.
  Procedure: apply the migration first (Supabase MCP `apply_migration` or
  `supabase db push`), confirm the `Supabase Migrate` run is green, **then**
  merge/promote. Worked example and the exact blast radius:
  `20260811210000_api_keys_attested_venue.sql`, whose header carries the same
  warning (Phase 153.6 WR-03 / MIG-03).
- The **test project lags prod** (it is not on the auto-apply path — that
  workflow writes only to the prod ref). A PR that adds a column the frontend
  `SELECT`s can fail the e2e gate with "column does not exist" because e2e runs
  against the lagging test DB. The fix is to **catch the test DB up** (apply the
  migration to it via the Supabase MCP / CLI) and re-run e2e — *not* to soften
  the query. The codebase fails loud on schema drift by design.

### 3. Railway (analytics service) — deploys on GREEN main CI, skips silently on red

Merging an `analytics-service/**` change does **not** guarantee a Railway
deploy. Railway **skips** the deploy when the `main` CI check-suite is red
(`skippedReason="CI check suite failed"`), with no alert for a red run. When a
main run concludes **`cancelled`**, the `main-ci-cancelled-watcher` workflow
(Phase 158) files a dedup'd `main-ci-cancelled` issue — triage via
[`docs/runbooks/shared-test-db-mutex.md`](docs/runbooks/shared-test-db-mutex.md)
§6. If a fix seems not to have shipped:

```bash
railway deployment list      # check whether the deploy ran
# rerun the failed main CI, then if still skipped:
railway up                   # force a deploy
```

The `/health` endpoint reports worker-tick liveness and the deployed `git_sha`,
so "is prod running main HEAD?" is machine-checkable:
`curl .../health | jq -r .git_sha`. The `analytics-deploy-verify` workflow
checks it on a 6h schedule, with the staleness window sized for post-mutex CI
queue depth (4800s — Phase 158).

## Invariants that break CI or prod

- **Bump `VERSION` and `package.json` together.** `critical-regressions.test.ts`
  fails CI if they disagree. Also add a `CHANGELOG.md` entry for the release
  (a `/ship` convention — not separately CI-gated). `/ship` does all three; if
  you bump by hand, do them in one commit.
- **Railway one-off scripts use `SUPABASE_SERVICE_KEY`** (not
  `SUPABASE_SERVICE_ROLE_KEY`). Run prod backfills/one-offs via:
  `railway ssh "cd /app && python -m scripts.<name>"`.
- **Never point a local analytics-service run at the prod Supabase project.** Both
  `uvicorn main:app` and `python -m main_worker` start job-claiming worker loops, so a
  laptop aimed at prod claims real `compute_jobs` and strands them as orphaned `running`
  rows when you Ctrl-C. Local env loads `analytics-service/.env.qa-local` (TEST) before
  `.env`, and startup refuses outright when `SUPABASE_URL` names the prod project off
  Railway. `ALLOW_PROD_WORKER_OFF_PLATFORM=1` is the deliberate escape hatch for a
  sanctioned emergency run.
- **Never commit a recorded VCR cassette** that contains a real
  `DEBUG_KEY_FLOW_*` value or a high-entropy literal in a signing-key field —
  `scripts/repro-key-flow.sh` exits non-zero on either, and the secret-scan CI
  gate blocks the push.

## Workflow

- Branch from `main`; never commit directly to `main`.
- Open a PR. CI must be green before merge (which auto-deploys — see above).
- Migrations: one logical change per migration; never edit an
  already-merged migration (it has already applied to prod) — ship a forward
  migration instead.
- SQL function snapshot: when a migration adds, changes, or drops a SQL
  function, run `npm run schema:functions` and commit the regenerated
  `supabase/schema/functions/` — these files are the canonical current body of
  every function (replayed from the migrations) and exist so you can read one
  file instead of grepping every migration. The "SQL Function Snapshot — Drift
  Gate" CI check (`.github/workflows/sql-function-snapshot.yml`, which runs
  `npm run schema:functions:check`) fails if the committed snapshot is stale.
- Generated DB types: `src/lib/database.types.ts` is produced by `npx supabase
  gen types typescript --linked` against the live remote schema. After a
  migration that changes a table/column/enum, regenerate and commit it — then
  **re-apply the two hand-written sections a fresh regen wipes**: the
  GENERATED-FILE/NUMERIC-precision header preamble and the `for_quants_leads`
  HAND-PATCHED block (its comment explains why — a regen linked to a project
  missing migration 115 silently reverts the `notify_*` columns). The `[#14]`
  block in `critical-regressions.test.ts` fails CI if either section is lost, so
  you'll be told if a regen stripped them. (There is no auto-diff against the
  live schema — that needs prod creds + a normalizer; see
  `docs/deferred-findings.md` #14.)
- Env manifest: `.env.example` is the **enforced** manifest. Every literal
  `process.env.<KEY>` read in `src/` must be documented there (with its owning
  plane), or allowlisted in `src/__tests__/contracts/env-manifest.test.ts` as a
  platform/test/indirect key; and every active key there must be read in `src/`
  (no dead entries). Add a key in the same PR that introduces its read.
- Python dependency lock: `analytics-service/requirements.txt` is a **generated
  lock**, not hand-edited. Edit the source manifest
  `analytics-service/requirements.in` and run `make lock` (in
  `analytics-service/`) to regenerate the fully-pinned `requirements.txt`, then
  commit both. `make lock` runs `uv pip compile --python-version 3.12
  --universal` (CI/prod is 3.12; `--universal` keeps the lock installable on
  both macOS dev and Linux CI/Railway), so you need `uv` on PATH. Dependabot
  bumps land on `requirements.txt` directly — re-run `make lock` to restore the
  canonical format before merging. Dev/test-only deps stay in
  `requirements-dev.txt` (range-pinned, not shipped to prod).
