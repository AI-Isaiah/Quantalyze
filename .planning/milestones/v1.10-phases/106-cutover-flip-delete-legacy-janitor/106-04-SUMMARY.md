---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 04
subsystem: csv-finalize observability
tags: [d7, fail-loud, sentry, after, tdd, observability]
requires: [106-01]
provides:
  - "csv-finalize after() epilogue: all 4 warn-only failure arms captureToSentry (D7 prevention half)"
affects:
  - src/app/api/strategies/csv-finalize/route.ts
tech-stack:
  added: []
  patterns:
    - "captureToSentry paired alongside console.warn on fire-and-forget after() arms (:620 idiom)"
key-files:
  created:
    - src/__tests__/csv-finalize-after-failloud.test.ts
  modified:
    - src/app/api/strategies/csv-finalize/route.ts
decisions:
  - "Distinct step tags per arm (placeholder-upsert / placeholder-upsert-throw / csv-analytics-enqueue / csv-analytics-enqueue-throw) so Sentry can disambiguate which after() arm silently failed"
  - "console.warn KEPT on every arm — Sentry is ADDED alongside for Vercel-log parity, not a replacement"
  - "Sentry extra carries only strategy_id + correlation_id (the :620 precedent) — no PII, no key material (T-106-09)"
metrics:
  duration: "~15m"
  completed: 2026-07-14
  tasks: 1
  files: 2
---

# Phase 106 Plan 04: csv-finalize after() Fail-Loud Summary

D7 prevention half — the 4 `console.warn`-only failure arms in csv-finalize's `after()` epilogue now also `captureToSentry` with distinct per-arm step tags, so a silent post-response failure (placeholder-upsert error/throw, enqueue RPC error/throw) that leaves a strategy stuck `computing` becomes alertable instead of vanishing into Vercel logs. Additive observability only — happy path and response timing unchanged.

## What Was Built

- **`src/__tests__/csv-finalize-after-failloud.test.ts`** (new): 4 TDD regression cases driving each failure arm through `POST` on the legacy path. Each asserts (a) `captureToSentry` fires with the correct `tags.surface` / `tags.step` / `extra.{strategy_id,correlation_id}`, and (b) the `console.warn` is still emitted. The describe blocks encode WHY: a silent `after()` failure = strategy stuck computing with zero trace.
- **`src/app/api/strategies/csv-finalize/route.ts`** (modified): added 4 `captureToSentry` calls immediately after the existing `console.warn` at each arm, copying the `:620` `placeholder-precheck` idiom exactly (same import at `:13`, same payload key shape), mapping the helpers' local `strategyId` / `opts.correlationId` into the `strategy_id` / `correlation_id` keys.

| Arm | Location (helper) | Step tag |
| --- | --- | --- |
| placeholder upsert returned error | `writeFailedStrategyAnalyticsPlaceholder` | `placeholder-upsert` |
| placeholder upsert threw | `writeFailedStrategyAnalyticsPlaceholder` catch | `placeholder-upsert-throw` |
| enqueue_compute_job RPC returned error | `enqueueCsvAnalyticsAfter` after() | `csv-analytics-enqueue` |
| enqueue side-effect threw | `enqueueCsvAnalyticsAfter` after() catch | `csv-analytics-enqueue-throw` |

## Verification

- RED → GREEN order proven: `test(106-04)` commit `242c68a7` (4 cases fail — no capture exists), then `feat(106-04)` commit `0725a2f2` (green).
- New + sibling suites green: `csv-finalize-after-failloud` (4), `csv-finalize-rpc`, `csv-finalize-c14-regression` — 50 passed / 6 skipped.
- `npx tsc --noEmit` exit 0; `eslint` on both touched files exit 0.
- `grep -c "captureToSentry"` on the route: 7 → 11 = **+4 exactly** (plan verification met). The 4 new sites carry distinct step tags; the `:684-694` `USE_COMPUTE_JOBS_QUEUE` flag branch was NOT touched (its deletion is Stage B / plan 106-07).
- Scope re-grep: `finalize-wizard/route.ts` after() arms remain already-Sentry-paired — no new warn-only after() path appeared there since 2026-07-14, so nothing added outside the 4 csv-finalize sites.

## Deviations from Plan

**1. [Rule 3 - Blocking] Widened `adminRpcMock` return type in the new test**
- **Found during:** Task 1 GREEN (tsc gate).
- **Issue:** The hoisted `vi.fn(async () => ({ error: null }))` narrowed the mock's resolved type to `{ error: null }`, so `mockResolvedValue({ error: { message } })` failed `tsc` with TS2322.
- **Fix:** Annotated the mock as `Promise<{ error: { message: string } | null }>`. No behavior change; test still green.
- **Files modified:** `src/__tests__/csv-finalize-after-failloud.test.ts`
- **Commit:** `0725a2f2` (folded into GREEN since it is test-harness plumbing for the same task).

Otherwise plan executed as written.

## Out of Scope (not actioned)

- Vercel `posttooluse-validate` hook flagged "manual retry logic" at route lines 1099/1112 (the pre-existing 23505 idempotent-recovery block). Unrelated to this additive change — left untouched per surgical-changes.

## Self-Check: PASSED

- FOUND: `src/__tests__/csv-finalize-after-failloud.test.ts`
- FOUND: commit `242c68a7` (RED test)
- FOUND: commit `0725a2f2` (GREEN feat)
