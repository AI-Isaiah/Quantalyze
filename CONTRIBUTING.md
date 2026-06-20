# Contributing & Operations

This file captures the things that are not obvious from the code and that, if
you get them wrong, break production. Read the "Deploy semantics" section before
your first merge — merging to main triggers production deploys through three
paths (Vercel, Supabase migrations, and Railway).

For local setup, see [README.md](README.md). For architecture decisions, see
[`docs/architecture/`](docs/architecture/) (ADRs). For incident response, see
[`docs/runbooks/`](docs/runbooks/).

## Prerequisites

- Node.js 20.9+
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
- The **test project lags prod** (it is not on the auto-apply path — that
  workflow writes only to the prod ref). A PR that adds a column the frontend
  `SELECT`s can fail the e2e gate with "column does not exist" because e2e runs
  against the lagging test DB. The fix is to **catch the test DB up** (apply the
  migration to it via the Supabase MCP / CLI) and re-run e2e — *not* to soften
  the query. The codebase fails loud on schema drift by design.

### 3. Railway (analytics service) — deploys on GREEN main CI, skips silently on red

Merging an `analytics-service/**` change does **not** guarantee a Railway
deploy. Railway **skips** the deploy when the `main` CI check-suite is red
(`skippedReason="CI check suite failed"`), with no alert. If a fix seems not to
have shipped:

```bash
railway deployment list      # check whether the deploy ran
# rerun the failed main CI, then if still skipped:
railway up                   # force a deploy
```

The `/health` endpoint reports worker-tick liveness only (no deployed git SHA),
so "is prod running main HEAD?" is not machine-checkable today.

## Invariants that break CI or prod

- **Bump `VERSION` and `package.json` together.** `critical-regressions.test.ts`
  fails CI if they disagree. Also add a `CHANGELOG.md` entry for the release
  (a `/ship` convention — not separately CI-gated). `/ship` does all three; if
  you bump by hand, do them in one commit.
- **Railway one-off scripts use `SUPABASE_SERVICE_KEY`** (not
  `SUPABASE_SERVICE_ROLE_KEY`). Run prod backfills/one-offs via:
  `railway ssh "cd /app && python -m scripts.<name>"`.
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
