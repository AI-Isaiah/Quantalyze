---
phase: 190-factsheetqueued
plan: 06
subsystem: strategy-gate
tags: [strategy-gate, admin-approval, recompute, stored-result, d-02, toctou]

requires:
  - phase: 190-03
    provides: hasStoredAnalyticsResult (stored-analytics-result.ts) and isRecomputeOverStoredResult (closed-sets.ts)
provides:
  - StrategyGateInput.hasStoredResult as a required boolean
  - checkStrategyGate passes a pending or computing row that holds a stored success result
  - admin approval (first pass and TOCTOU re-check) reads the stored-result evidence and the computed_at the snapshot binds to
affects: [190-08]

tech-stack:
  added: []
  patterns:
    - "the gate takes the evidence as a required input computed by the caller; the gate module imports only the closed-sets predicate"
    - "an unread evidence flag fails closed: callers that pass false get today's pending and computing refusals"

key-files:
  created: []
  modified:
    - src/lib/strategyGate.ts
    - src/lib/strategyGate.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/api/admin/strategy-review/route.ts
    - src/app/api/admin/strategy-review/route.test.ts

key-decisions:
  - "The ANALYTICS_PENDING and ANALYTICS_COMPUTING arms are guarded by !isRecomputeOverStoredResult; ANALYTICS_MISSING and ANALYTICS_FAILED are untouched, so a failed re-run and a missing row refuse whatever the evidence."
  - "SyncPreviewStep passes hasStoredResult false: the poller calls onTerminal only for failed (bails before the gate) or a computed status, so the re-run arms are unreachable there and the wizard verdict is byte-identical."
  - "PUB-01 (composite needs its latest stitch_composite job done) is left byte-unchanged; a composite approval during a re-stitch still answers 409. Plan 08 names this as not yet holding in the VERIFICATION hand-off."
  - "D-04 is not applied to the gate: a terminal-success row with an unbound derive prestamp passes its analytics arms on terminal status as today; a pending or computing row in that state fails check (c) and so is refused as today."

requirements-completed: [SC-3, SC-6]

actuals:
  tokens: 6000
  tasks: 2
  commits: 2
plan_head_before: 5e86c55dba334f520303a49bf9df76ea76bb0e17
plan_head_after: de07ba9d36911a7195339512bf8cdaf9a354ce2f

duration: ~25min
completed: 2026-11-03
status: complete
---

# Phase 190 Plan 06: The strategy gate passes a re-run over stored figures Summary

**`checkStrategyGate` now passes a `pending` or `computing` analytics row when it holds a stored success result (`hasStoredResult`, required), and admin approval computes that evidence with the factsheet's own `hasStoredAnalyticsResult` over the same row on both the first pass and the TOCTOU re-check; a first run, a failed run, a missing row and an unbound snapshot refuse exactly as before.**

## What changed

- `src/lib/strategyGate.ts`: `StrategyGateInput.hasStoredResult: boolean` (required, not optional, not nullable, JSDoc in the `seriesCompleteness` voice). A single `recomputeOverStoredResult = isRecomputeOverStoredResult(status, hasStoredResult)` guards the two return arms. Module header now says "analytics complete, or re-computing over a stored success result (phase 190 D-02)".
- `SyncPreviewStep.tsx`: the one call passes `hasStoredResult: false` with a comment saying why. Verified first by reading the poller (`useStrategySyncPoller`): `onTerminal` runs only for `failed` or `isComputedAnalytics`, and `failed` returns before the gate.
- `admin/strategy-review/route.ts`: both `strategy_analytics` selects add `daily_returns, returns_series, cumulative_return, data_quality_flags, computed_at`. The first pass passes `hasStoredResult: hasStoredAnalyticsResult(analytics)`. The re-check 409 now requires "not computed AND not a re-run over a stored result". The PUB-01 block is untouched.

## Tests

- `strategyGate.test.ts`: `BASE` carries `hasStoredResult: false` (no full-literal inputs existed; every case spreads BASE). New cases: pending and computing with evidence pass; without evidence they keep ANALYTICS_PENDING and ANALYTICS_COMPUTING; failed with evidence refuses; null status with evidence refuses ANALYTICS_MISSING; complete without evidence passes; a re-run row failing an earlier gate (too few trades, no data source) returns that earlier code. Each carries a WHY comment.
- `route.test.ts` (new nested describe running the REAL gate, since the suite's standard stub passes everything): computing at both passes with stored result -> 200 and publish UPDATE issued; prestamp with a snapshot bound to computed_at -> 200; snapshot one second off -> 400 GUARD_BLOCKED with the computing reason; no stored series -> 400 computing reason; first pass complete and re-check computing with evidence -> 200; same without evidence -> 409 REVIEW_RECHECK_FAILED; first pass failed with full evidence -> 400 failed reason; composite whose latest stitch is pending -> 409 (PUB-01 unchanged). The mock gained `firstPassStatus`, `firstPassEvidence`, `recheckEvidence` options; no existing test pinned the old select string, so no pin was changed.

## Can-fail proof

Byte backup of `route.ts` to the scratchpad; changed the first-pass argument to `hasStoredResult: false`; ran `route.test.ts`: 3 tests failed (computing-over-stored approval, the bound-snapshot approval, and the PUB-01 composite case, which needs the first pass to get through to reach the stitch check, so it is not vacuous). Restored with `cp`, `cmp` silent, rerun green (58 tests).

## Verification

- `npx vitest run` over strategyGate, strategyGate.invariant, route.test, and the three required SyncPreviewStep tests: green. Wider run (all `src/app/api/admin`, wizard steps, audit, no-store, contracts registry, limiter-ordering, sole-writer guard): 57 files, 1294 tests passed.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors. Two warnings in `MetricsColumn.tsx` (`nativeUnitReason`) and `composite-read-path.ts` (`isRankableAnalyticsRow`) are in files this plan did not touch (they come from the base).
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 4 claims.
- Acceptance greps: `hasStoredResult: boolean` 1, `isRecomputeOverStoredResult` in strategyGate.ts 2, `hasStoredResult: false` in SyncPreviewStep 1, `hasStoredAnalyticsResult(` in route.ts 2, the select string 2.
- `compute.conventions.test.ts` was not run (known pre-existing local Node 25 float failure, unrelated).

## Deviations from Plan

None - plan executed as written, with one wording note: the plan's behaviour text says "seven finite scalars" for the stored evidence. The implemented rule from plan 03 (`hasStoredAnalyticsResult`) asks for a stored series, a finite `cumulative_return` and a success-written `cumulative_method` marker, so the test fixtures use those three; the route reads the same rule the factsheet does, which is the plan's stated intent.

## Known Stubs

None.

## Threat Flags

None. The only new data read is the evidence columns on the `strategy_analytics` row the route already read, under the same admin auth, CSRF and rate limit.

## Hand-off to plan 08

PUB-01 is unchanged: approving a composite while its latest `stitch_composite` job is not done still answers 409, including during a re-stitch over stored figures. Name it in the VERIFICATION as not yet holding for composites.

## Self-Check: PASSED

- src/lib/strategyGate.ts, strategyGate.test.ts, route.ts, route.test.ts, SyncPreviewStep.tsx modified: FOUND
- commits d708e4b57 and de07ba9d3 on feat/190-p06: FOUND
