# Runbook — Roll back a bad deploy

tech-debt #17. For restarting/redeploying the analytics worker specifically see
[railway-worker.md](./railway-worker.md); for a bad migration see
[migration-failure.md](./migration-failure.md).

Quantalyze has three independently-deploying surfaces. A "bad deploy" usually
means one of them; roll back only the one that regressed.

| Surface | Deploys when | Roll back via |
|---------|--------------|---------------|
| Vercel (frontend + API routes) | every push to `main` | promote the previous Vercel deployment |
| Railway (analytics worker) | GREEN main CI on any `main` push | redeploy the previous image — see [railway-worker.md](./railway-worker.md) |
| Supabase (schema) | merge of `supabase/migrations/**` | forward fix / DOWN script — see [migration-failure.md](./migration-failure.md) |

Code rolls back; **a migration does not** (it already applied to prod). If the
regression is schema, go to [migration-failure.md](./migration-failure.md).

## 1. Vercel (frontend / API routes)

Prod: `https://quantalyze-rho.vercel.app` (the canonical URL — NOT
`quantalyze.com` or `quantalyze.vercel.app`).

There is no version/SHA on the frontend health endpoint (`/api/health` returns
only `{ok, audit_emit_transient_failures}`), so identify the good deployment by
its commit in the Vercel dashboard, not by curling a version.

**Fastest path — dashboard (no CLI/auth juggling):**
1. Vercel → project → **Deployments**.
2. Find the last known-good production deployment (the one before the regressing
   commit).
3. **⋯ → Promote to Production** (a.k.a. Instant Rollback). This re-points the
   production alias to that existing build — no rebuild, takes seconds.
4. Verify: load the prod URL and confirm the regression is gone. Vercel marks
   the promoted deployment as Current.

**CLI alternative** (confirm the exact subcommand against your Vercel CLI
version — `vercel --help`; recent CLIs expose `vercel rollback` and
`vercel promote`):
```bash
vercel rollback            # interactive: pick the previous production deployment
# or, with a specific deployment URL:
vercel promote <deployment-url>
```

**Then fix forward.** Promotion does not change `main`. Revert or fix the bad
commit and let the normal push-to-`main` deploy carry the fix, or the next push
will re-deploy the broken code over your rollback.

## 2. Railway (analytics worker)

See [railway-worker.md](./railway-worker.md). Short version: redeploy a
known-good image from the Railway dashboard (service → Deployments → ⋯ →
Redeploy on the good one), then verify the deployed commit:
```bash
curl -s https://quantalyze-analytics-production.up.railway.app/health
# git_sha should be your intended commit; status "ok"; worker_age_s low
```

## 3. Database (schema)

Migrations have already applied to prod by the time you notice. **Do not** try to
"roll back" by deleting the migration. Either:
- ship a **forward** migration that corrects the change, or
- if a reversible DOWN exists for it, apply the matching script from
  `supabase/migrations/down/` (these are idempotent, `IF EXISTS`-guarded).

Details and the schema_migrations repair path: [migration-failure.md](./migration-failure.md).

## After any rollback

- Confirm the regression is actually gone on the live surface (don't trust the
  dashboard's "Current" label alone — exercise the broken path).
- Open/triage the incident in [sentry-triage.md](./sentry-triage.md): events lag
  deploys, so error rates settle a few minutes after the rollback.
- Land the real fix on `main` so the next deploy doesn't reintroduce the bug.
