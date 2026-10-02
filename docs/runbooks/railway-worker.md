# Runbook — Restart / redeploy the Railway analytics worker

tech-debt #17. The analytics worker (`analytics-service`, Python) runs the trade
sync, optimizer, and verification jobs on Railway. This covers "is it alive?",
"restart it", "it's stuck on old code", and one-off scripts.

## Health check first

```bash
curl -s https://quantalyze-analytics-production.up.railway.app/health
```
Returns JSON: `{status, version, git_sha, worker_last_tick_at, worker_age_s}`.
- `status: "ok"` + low `worker_age_s` → worker is ticking. Healthy.
- `status: "stale"` / HTTP 503 → `worker_age_s` exceeded the ~90s tick threshold:
  the worker process is wedged or dead. `analytics-service/railway.toml` sets
  `restartPolicyType = "ON_FAILURE"` with `restartPolicyMaxRetries = 3`, so a
  crash self-restarts up to 3×; beyond that it stays down.
- `git_sha` ≠ current `main` HEAD → prod is on **stale code** (likely a skipped
  deploy — see below).

## Restart a wedged worker

Railway has no graceful "restart" button per se; a **redeploy** of the current
image restarts the process cleanly.

1. Railway dashboard → `analytics-service` → **Deployments**.
2. On the latest SUCCESS deployment: **⋯ → Redeploy**.
3. Watch it go BUILDING → SUCCESS, then re-curl `/health` until `status: "ok"`
   and `worker_age_s` is low again.

CLI equivalent (verified subcommands; confirm others with `railway --help`):
```bash
railway redeploy        # redeploy the current image for the linked service
railway up              # build & deploy the current working tree
```

## Stuck on stale code (the skipped-deploy gotcha)

**Railway only deploys when the main CI check-suite is GREEN.** If ANY check on
the merge commit is red/cancelled, Railway **silently skips** the deploy
(`skippedReason="CI check suite failed"`) and prod stays on old code with no
error.

Common triggers, current as of phase 158:

- A **red** `python` / `sql-tests` / `e2e-seeded` job from the shared TEST-DB
  **advisory lock** — the acquire step hitting its wait cap (deep cross-run
  queue *or* a wedged holder; it prints a `pg_locks` census naming both), or the
  job blowing its `timeout-minutes`. See
  [`shared-test-db-mutex.md`](./shared-test-db-mutex.md) sections 2-3.
- A **cancelled** main-branch run, which
  `.github/workflows/main-ci-cancelled-watcher.yml` files as a dedup'd
  `main-ci-cancelled` issue. See that runbook's section 6.

> ⚠️ The `shared-test-db` **concurrency group** was deleted in phase 158 and no
> longer exists anywhere in the repo. It used to be the common trigger named
> here: GitHub keeps one pending entry per group and cancels it when a third
> arrives, so an evicted run concluded `cancelled` (grey, not red) and Railway
> skipped the deploy — issue #616. The advisory lock replaced it precisely so
> waiters block instead of being evicted.

Detection is automated: `.github/workflows/analytics-deploy-verify.yml` runs every
6h, compares prod `/health` `git_sha` to `main` HEAD, and files a dedup'd P1
issue (label `analytics-deploy-stale`) on a persistent mismatch. That probe
deliberately **exits 0** even when stale — a red check on HEAD would make Railway
skip the very deploy it verifies (the #9b self-block; do not "fix" the probe to
fail).

**Recovery:**
1. Find the merge commit that should be live (`git log main`).
2. Re-run its main CI until the whole suite is GREEN
   (`gh run rerun <run-id>` or the Actions UI). Railway gates on the
   **check-runs** of that commit, not the combined status — so every workflow's
   check on it must be non-red.
3. Trigger the deploy: dashboard **Redeploy**, or `railway redeploy`.
4. Verify convergence: `/health` `git_sha` == `main` HEAD, `status: "ok"`.
5. Close the `analytics-deploy-stale` issue once converged.

## One-off scripts (backfills, manual recovery)

Run inside the prod container via SSH. The Python env key is
`SUPABASE_SERVICE_KEY` (NOT the TS-side `SUPABASE_SERVICE_ROLE_KEY`).
```bash
railway ssh "cd /app && python -m scripts.<name>"
```

## Unverified / check before relying on

- Exact Railway CLI for restart-without-redeploy and replica scaling varies by
  CLI version and is not pinned in this repo — prefer the dashboard Redeploy
  flow above, or confirm with `railway --help`.
- Current replica count is a dashboard setting, not in `analytics-service/railway.toml`.
