# Runbook — Sentry triage

tech-debt #17. How to investigate a Sentry alert/error for Quantalyze without
chasing ghosts. This procedure previously lived only in agent memory.

## Config you need to know

| Thing | Value |
|-------|-------|
| Org | `metaworld-fund-ltd` (env: `SENTRY_ORG_SLUG`) |
| Region | **EU** — `https://de.sentry.io` (NOT the global `https://sentry.io`) |
| API base | `SENTRY_API_BASE` must be `https://de.sentry.io/api/0/organizations` for the EU org |
| DSN | `SENTRY_DSN` — wired in `src/instrumentation.ts` |
| Auth token | `SENTRY_AUTH_TOKEN` (scope `event:read`) |

**EU-region trap:** the default global host returns HTTP 200 + `{"data": []}`
for an EU org — a silent empty result, not an error. Any script/query MUST point
at `de.sentry.io`. Verify response shape before trusting a query:
`bash scripts/probe-sentry-events-api.sh` (exits non-zero if the shape changed).

## Two gotchas that cause wrong conclusions

1. **Events LAG deploys.** A spike you see now may be from code that's already
   fixed on `main` but not yet deployed (or just deployed — events are still
   draining). **Always check "is this already fixed on main?" FIRST**
   (`git log --oneline`, search the error/symptom) before treating an event as a
   live regression. Cross-check the deployed commit: Railway `git_sha` via
   `/health` (see [railway-worker.md](./railway-worker.md)); for Vercel, the
   Current deployment's commit in the dashboard.
2. **The MCP Sentry integration is READ-ONLY.** You cannot resolve or mutate
   issues through it. Triage produces a **resolve-list** to hand to a human who
   clicks Resolve in the Sentry UI — do not claim issues were resolved.

## Triage steps

1. **Identify** the issue: org `metaworld-fund-ltd`, environment `production`.
   Note the error, the `path`/route tag, and the `correlation_id` tag
   (`instrumentation.ts` stamps `x-correlation-id` as a queryable Sentry tag;
   `path`/`method`/`digest` are in `extra`).
2. **Already fixed on main?** Search the codebase/history for the symptom. If yes
   → it's deploy lag; confirm the deployed commit predates the fix, and the rate
   will fall once the fix deploys. Stop here (no new work).
3. **Live regression?** Establish blast radius via the events API (scoped to
   `environment:production` — preview/CI events must never count):
   ```bash
   curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
     "https://de.sentry.io/api/0/organizations/metaworld-fund-ltd/events/?..."
   # filter: level:error environment:production path:/api/<route>
   ```
4. **Decide:** code regression → fix forward (and if prod is actively broken,
   roll back first via [deploy-rollback.md](./deploy-rollback.md)); schema →
   [migration-failure.md](./migration-failure.md); config (e.g. a missing env
   key disabling a feature) → check the startup warn-loud log and `.env.example`.
5. **Resolve-list:** write up the issue IDs that are fixed/non-actionable and
   hand them to the human with Sentry write access to mark Resolved.

## Related automated paths

- `/api/cron/flag-monitor` polls Sentry every 15 min and can auto-flip the
  `process_key_unified_backbone` kill-switch on a sustained
  `/api/process-key` error rate (and emails the founder). If you're triaging a
  process-key incident, check whether the kill-switch already fired (Supabase
  `feature_flags`).
- A `environment:production` filter regression (e.g. CI/preview events leaking
  into the prod query) shows as a high error rate while the deployed `git_sha`
  matches main — suspect the environment filter / a preview deploy, not prod
  code.

## Unverified — confirm in the Sentry UI

- The exact **project name** inside the `metaworld-fund-ltd` org is not recorded
  in the repo; get it from the Sentry UI / DSN.
- `SENTRY_API_BASE` in Vercel prod should be the EU base — confirm via
  `vercel env` if a query unexpectedly returns empty.
