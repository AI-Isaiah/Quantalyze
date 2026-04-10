# ADR-0021: CI/CD gates and version-controlled cron schedules

## Status
Proposed (decision needed to codify CI gates and schedule management)

## Context
The deployment topology (ADR-0017) exists but the "how does a change
reach production" story is implicit. Key gaps:

1. **Cron schedules**: `vercel.json` now declares cron schedules (lines
   6-9), but historically these were registered via the Vercel dashboard
   only. A redeploy could lose the schedule if `vercel.json` is not the
   source of truth.

2. **CI gates**: `package.json` has `lint`, `typecheck`, `test`, and
   `test:e2e` scripts, but no single script runs them all in order.
   Without a pinned CI gate, a PR can land with a failing typecheck.

3. **Environment documentation**: `.env.example` lists development
   secrets but does not document which environments (preview, production)
   get which secrets, or how preview deployments differ from production.

## Decision

### 1. Cron schedules in `vercel.json` (mandatory)
All Vercel Cron schedules MUST be declared in `vercel.json`. Dashboard-only
schedules are not version-controlled and will be lost on project
recreation or team transfer.

Current schedules (from `vercel.json`):
```json
{
  "crons": [
    { "path": "/api/cron/warm-analytics", "schedule": "*/5 * * * *" },
    { "path": "/api/alert-digest", "schedule": "0 9 * * *" }
  ]
}
```

### 2. CI gates (to be codified)
The following checks should be enforced as required status checks on PRs:

| Gate | Script | Purpose |
|------|--------|---------|
| Type check | `npm run typecheck` | Catches type errors |
| Lint | `npm run lint` | Enforces code style |
| Unit tests | `npm run test` | Vitest suite |
| E2E tests | `npm run test:e2e` | Playwright suite |

A composite script (`npm run ci` or equivalent) should run all four in
order. The CI workflow in `.github/workflows/` should use this composite.

### 3. Environment variable documentation
`.env.example` should document:
- Which vars are required vs optional
- Which vars differ between preview and production
- Which vars are public (`NEXT_PUBLIC_*`) vs server-only
- Which vars are shared with the analytics service

## Consequences

### Positive
- Cron schedules are version-controlled and survive project transfers.
- CI gates prevent broken code from landing.
- Environment documentation reduces onboarding friction.

### Negative
- CI enforcement may slow down PR velocity if E2E tests are flaky.
- Environment documentation must be kept in sync with actual Vercel
  project settings.

## Evidence
- `vercel.json` (lines 1-10): framework stub with crons block.
- `package.json` (lines 5-14): lint, typecheck, test, test:e2e scripts.
- `.env.example` (lines 1-33): 15+ secrets listed without environment
  annotations.
- `.github/workflows/` directory: CI workflows exist but were not fully
  audited.
- ADR-0008 job inventory: cross-reference for which cron schedules must
  be version-controlled.
