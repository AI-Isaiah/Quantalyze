---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 21
subsystem: api-error-copy
tags: [d-04, d-06, d-11, api-routes, copy-census, error-codes-kept]
requires: [201-25, 201-26]
provides:
  - API error messages that speak the allocation and mandate words, with every machine value unchanged
  - the founder LP report month label through formatMonth
  - copy-census ledger plan-21 emptied (pending {})
affects: [201-24, 201-20, 201-27]
tech-stack:
  added: []
  patterns:
    - "messages are renamed, codes, fields and routes stay: PORTFOLIO_NOT_FOUND, portfolio_id and /api/preferences are recorded machine values"
    - "route tests pin the full hand-typed sentence, never a regex fragment, so a reverted message reddens"
key-files:
  created: []
  modified:
    - src/app/api/allocator/scenario/commit/route.ts
    - src/app/api/allocator/scenario/commit/route.test.ts
    - src/app/api/bridge/route.ts
    - src/app/api/bridge/route.test.ts
    - src/app/api/simulator/route.ts
    - src/app/api/simulator/route.test.ts
    - src/app/api/portfolio-alerts/route.ts
    - src/app/api/portfolio-alerts/route.test.ts
    - src/app/api/alerts/critical/route.ts
    - src/app/api/admin/match/preferences/[allocator_id]/route.ts
    - src/app/api/admin/match/preferences/[allocator_id]/route.test.ts
    - src/app/api/preferences/route.ts
    - src/app/api/preferences/route.test.ts
    - src/app/api/cron/founder-lp-report/route.ts
    - src/app/api/cron/founder-lp-report/route.test.ts
    - scripts/copy-census/ledgers/plan-21.ts
    - src/app/api/admin/match/send-intro/route.ts (runner-assigned, not in files_modified)
    - src/app/api/admin/match/send-intro/route.test.ts (runner-assigned)
    - src/app/api/allocator/scenario/share/route.ts (runner-assigned)
    - src/app/api/allocator/scenario/share/route.test.ts (runner-assigned)
    - src/app/api/portfolio-strategies/alias/route.ts (runner-assigned)
    - src/app/api/portfolio-strategies/alias/route.test.ts (runner-assigned)
    - src/app/api/portfolio-strategies/allocation/route.ts (runner-assigned)
    - src/app/api/portfolio-strategies/allocation/route.test.ts (runner-assigned)
decisions:
  - "Codes (PORTFOLIO_NOT_FOUND, DASHBOARD_ROW_STALE, book_only_draft, RATE_LIMITED), fields (portfolio_id) and routes are machine values and were not renamed; the ledger carries no exceptions because none of them was a census hit."
status: complete
commits: 3
plan_head_before: 8724de1ab
plan_head_after: 8538d40b272d49d6b44b885bf7dc11a48ffaa8ba
actuals:
  tokens: 24000
  tasks: 3
  commits: 3
---

# Phase 201 Plan 21: API error copy Summary

API error messages now say allocation and mandate instead of portfolio and preferences (stale scenario commit, not-found responses, admin mandate save, simulator and rate-limit text), the founder LP report prints its month through `formatMonth`, and the plan-21 census ledger is empty. Every error code, field and route is unchanged.

## What was built

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) stale scenario commit | 9e3834d75 | `Your allocation changed since you started this scenario`; status 409 and code `portfolio_fingerprint_stale` kept |
| 2 not-found and mandate save | 972213401 | `Allocation not found` on bridge, simulator, portfolio-alerts and alerts/critical (`PORTFOLIO_NOT_FOUND` kept); `Failed to save mandate` (admin), `Failed to load mandate` (allocator route) |
| 3 founder LP month, remaining hits | 8538d40b2 | both `monthLabel` builds use `formatMonth` (`Oct 2026`); send-intro, scenario share, portfolio-strategies alias and allocation, simulator rate-limit and failure text renamed; ledger `pending: {}` |

Other renamed messages (all full sentences pinned in their route tests): `This allocator has no allocation; cannot record an intro`, `Failed to verify the allocator's allocation`, the share route's `private allocation sources` sentence, the simulator's `Allocation impact simulation failed.` and `The allocation impact simulator is capped at 20 runs per hour.`

## Verification (real output, run on resume)

- `node scripts/verify-plan-anchors.mjs <plan>`: `claims: 3 checked`, `OK: 1 plan file(s), no stale claims.`, exit 0
- `npx tsx scripts/copy-census/run.ts --ledger plan-21`: exit 0, no remaining hits; ledger `pending: {}`, `exceptions: []`, `pinnedExceptionCount: 0`
- `npx vitest run src/app/api src/__tests__/copy-census.test.ts src/__tests__/figure-gate-census.test.ts`: 108 files passed, 2680 tests passed, 3 skipped (the skips were already skipped at the phase base, none added here)
- `npx vitest run src/lib/wizardErrors`: 456 passed
- `npx eslint` on every touched route.ts (12 files): exit 0
- `npm run typecheck` (`tsc --noEmit`): exit 0
- acceptance greps: `Portfolio changed since` in the commit route 0; `"Portfolio not found"` in bridge, simulator, portfolio-alerts and alerts/critical 0 each; `PORTFOLIO_NOT_FOUND` in bridge 1; `toLocaleString` in founder-lp-report 0

gc-201-21-neuter: gate=src/app/api/allocator/scenario/commit/route.test.ts result=red restored=identical
  RED: `AssertionError: expected 'Portfolio changed since you started t…' to be 'Your allocation changed since you sta…'` (1 failed, 105 passed), then cmp exit 0 and GREEN (106 passed, 1 skipped).
gc-201-21-neuter: gate=src/app/api/bridge/route.test.ts result=red restored=identical
  RED: TC6 and TC6b, `expected 'Portfolio not found' to be 'Allocation not found'` (2 failed, 33 passed), then cmp exit 0 and GREEN (35 passed).
gc-201-21-neuter: gate=src/app/api/cron/founder-lp-report/route.test.ts result=red restored=identical
  RED: both D-11 arms, `expected 'Founder LP report — October 2026' to be 'Founder LP report — Oct 2026'` and the failure alert missing `Oct 2026` (2 failed), then cmp exit 0 and GREEN (25 passed).
gc-201-21-gates: vitest=green eslint=clean tsc=clean

The neuter runs were redone on resume (the interrupted run's records were lost); backups in the scratchpad, `cmp` exit 0 on every restore, working tree clean afterwards.

## upstream-copy

`/api/bridge` and `/api/simulator` forward an upstream analytics 4xx message verbatim on the `AnalyticsUpstreamError` path (`err.message` on the forwarded 4xx, with the upstream code). The analytics service raises its 404 with the retired sentence as `detail`: `analytics-service/routers/simulator.py:262`, `analytics-service/routers/portfolio.py:1767`, `:1848`, `:2147` (`detail="Portfolio not found"`), and `portfolio.py:2184` (`Strategy not found in this portfolio`). This is Python copy outside `src/`, so the census cannot see it (D-22); this phase leaves it as it is. The bridge and simulator route tests keep `AnalyticsUpstreamError("Portfolio not found", 404)` and its forwarded `body.error` on purpose. The same applies to the Python `Portfolio impact simulation failed` detail (`PortfolioImpactPanel.test.tsx`, `wizardErrors.ts` SIMULATION_FAILED prose).

## cross-plan-pins

For plan 201-24 and the owners named:
- `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx:454` uses `"Portfolio changed since you started this scenario"` as a fixture string for the commit route's error (plan 201-27 owns that file). It is a fixture, not a comparison in code, so it still passes; it should say the new sentence.
- `src/components/admin/PreferencesPanel.tsx:159` has the client fallback `"Failed to save preferences"` (plan 201-20 renames it in parallel).
- `src/lib/wizardErrors.ts` (~line 5528) and `src/app/api/simulator/route.ts` comments quote the old simulator failure sentence in prose; `wizardErrors.ts` is not a plan-21 file.
- `src/app/scenario-share/[token]/page.tsx:387` and `SavedScenariosList.tsx:265` still say `private book sources` in their own copy (other plans' files); the share route now says `private allocation sources`.

No client was found that compares against any renamed message text (`grep -a -rn -F` over `src`, `e2e`, `tests` for every old message).

## reported-not-edited

None. No phase-200 file (ApiKeyManager, ConfirmKeyChangeDialog, the two e2e specs) was touched; no Bridge retirement (F-04) or egress (F-12) change was applied here, the bridge route's user-visible message was only renamed per D-04.

## Deviations from Plan

None to the work itself: plan executed as written. The runner assigned four additional route files to plan-21 (send-intro, scenario share, portfolio-strategies alias and allocation), which the plan anticipates ("any other `src/app/api/**` file the runner assigns to plan-21 is this plan's"); they are listed under key-files.

This resume re-verified three already-committed tasks and wrote the missing SUMMARY and neuter records; no code was changed on resume.

## Known Stubs

None.

## Threat Flags

None. T-201-27 mitigated (codes, fields and routes unchanged; `PORTFOLIO_NOT_FOUND` asserted in bridge and simulator tests).

## Self-Check: PASSED

Commits 9e3834d75, 972213401 and 8538d40b2 are ancestors of HEAD; the ledger file and every listed route file exist.
