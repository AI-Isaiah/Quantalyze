---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 39
subsystem: date-format
tags: [plainwords, dates, formatDay, formatDayTime, gap-closure, sc-3, f-11, d-11, d-21, u-13, clar-06]
requires: ["201-24"]
provides:
  - "departedHistorySentence prints its day through formatDay (Jun 10, 2026); decision.until stays ISO"
  - "/admin/usage heatmap column headers through formatDay; stale-cache notice through formatDayTime"
  - "match-eval weekly table Week cell through formatDay in a whitespace-nowrap cell"
affects: []
key-files:
  modified:
    - src/lib/departed-history.ts
    - src/lib/departed-history.test.ts
    - src/components/exchanges/AllocatorExchangeManager.departed-history.test.tsx
    - src/app/(dashboard)/admin/usage/page.tsx
    - src/app/(dashboard)/admin/usage/page.test.tsx
    - src/lib/admin/usage-metrics.ts
    - src/lib/admin/usage-metrics.test.ts
    - src/components/admin/MatchEvalDashboard.tsx
    - src/components/admin/MatchEvalDashboard.test.tsx
decisions:
  - "Wrap at the print position only: decision.until, the heatmap days keys / by_day lookups and the weekly row key keep their ISO values."
  - "The stale notice instant is built as formatDayTime(new Date(storedAt).toISOString()); the test pins Date.now so the printed stamp is exact (Apr 10, 2026, 14:05 UTC)."
metrics:
  tasks: 2
  completed: 2026-11-11
status: complete
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 95bf90ac7f0a1a7e3dabee322bf42a45678f2d15
plan_head_after: 4b7bb8cef20c907f42482bd049e6b2b9f78022d1
---

# Phase 201 Plan 39: exchange-manager history sentence and staff-facing dates Summary

Four sites moved onto the one date helpers: the departed-key history sentence (`History included until Jun 10, 2026.`), the `/admin/usage` heatmap headers (`Apr 16, 2026`), its stale-cache notice (`... cached data from Apr 10, 2026, 14:05 UTC`) and the match-eval weekly Week column (`Oct 5, 2026`, nowrap).

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 7b9c4ee15 | `departedHistorySentence` prints all three included variants through `formatDay`; both test files re-pinned; negative ISO assertion on the rendered block |
| 2 | 4b7bb8cef | heatmap headers, stale notice, Week column through the helpers; proof arms added to each test |

## Verification (real output)

- `npx vitest run` on the 6 files named by the plan's task-2 verify (page, usage-metrics, MatchEvalDashboard, departed-history, AllocatorExchangeManager.departed-history, copy-census): `Test Files 6 passed (6)`, `Tests 110 passed (110)`.
- Task-1 verify (2 files): `Tests 70 passed (70)`.
- `npx eslint` on the four source files: exit 0, clean. `npm run typecheck` (`tsc --noEmit`): no output, clean.
- Acceptance greps: `${decision.until}` 0, `formatDay(decision.until)` 3, `d.slice(5)` 0, `cached data from ${iso}` 0, `formatDayTime(` in usage-metrics 1, bare `{w.week_start}` 0.
- `git diff --quiet 95bf90ac7 -- src/components/exchanges/AllocatorExchangeManager.tsx src/components/strategy/ApiKeyManager.tsx` exit 0 (both components byte-identical at task 1 end and task 2 end).
- `node scripts/verify-plan-anchors.mjs` on the canonical plan: `claims: 6 checked`, OK.

## RED evidence (tests before code, then neuter on byte backup)

Tests-first RED against HEAD:
- task 1: `Tests 6 failed | 64 passed (70)`, e.g. `expected 'History included until 2026-06-10.' to contain 'History included until Jun 10, 2026.'`
- task 2: 3 failed (heatmap: `expected [ 'Day', 'session_start', ...] to include 'Apr 16, 2026'`; stale notice: ISO-timestamp string not equal; Week: `Unable to find an element with the text: Oct 5, 2026`).

Neuter lines (each: `cp -p` backup, neuter, RED naming the cause, `cp -p` back, `cmp` exit 0, GREEN):

gc-201-39-neuter: gate=src/lib/departed-history.test.ts + src/components/exchanges/AllocatorExchangeManager.departed-history.test.tsx site=src/lib/departed-history.ts result=red restored=identical (default included sentence printed raw `decision.until`; 5 arms red, e.g. `expected 'History included until 2026-06-10.' to contain 'History included until Jun 10, 2026.'`)
gc-201-39-neuter: gate=src/app/(dashboard)/admin/usage/page.test.tsx site=src/app/(dashboard)/admin/usage/page.tsx result=red restored=identical (`{d.slice(5)}` restored: `expected [ 'Day', 'session_start', ... ] to include 'Apr 16, 2026'`)
gc-201-39-neuter: gate=src/lib/admin/usage-metrics.test.ts site=src/lib/admin/usage-metrics.ts result=red restored=identical (raw `toISOString()` in the notice: stale-notice arm red)
gc-201-39-neuter: gate=src/components/admin/MatchEvalDashboard.test.tsx site=src/components/admin/MatchEvalDashboard.tsx result=red restored=identical (raw `{w.week_start}`: `Unable to find an element with the text: Oct 5, 2026`)

gc-201-39-gates: vitest=green eslint=clean tsc=clean

## exchange-manager-test-edited

`src/components/exchanges/AllocatorExchangeManager.departed-history.test.tsx` edited, assertion literals only (the component `AllocatorExchangeManager.tsx` is untouched): the five `History included until <ISO day>.` literals (the own-account block, the RPC-switch block, the revoked key block, the live-key-bound block with its `From the next day ...` tail, the WR-R2-02 block) now read `Jun 10, 2026` / `Jun 8, 2026` / `Jun 14, 2026`; one negative assertion `not.toMatch(/\d{4}-\d{2}-\d{2}/)` added after the first block's history assertion; a header note added. No other assertion changed. `src/lib/departed-history.test.ts`: the card `sentence` literal at the "anchored included key" arm; every `until` assertion on the decision stays ISO.

## Deviations from Plan

None - plan executed as written. Two small test-fixture additions the plan implied: `page.test.tsx`'s `createAdminClient` mock gained a `from().select().in()` chain, because a non-empty heatmap triggers the profile-label join (no profile matches, so the raw id stays as the row label). The planned `Date.now` pin was usable, so no fallback shape assertion was needed.

## reported-not-edited

None. No copy change was needed in `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts` or `e2e/sync-analytics-flow.spec.ts`.

## Known Stubs

None.

## Threat Flags

None. Display formatting only; T-201-56 mitigated (printed day is the computed day: `YYYY-MM-DD` parses as UTC midnight and `formatDay` reads UTC fields; `until` assertions run green), T-201-57 mitigated (both components byte-identical).

## Self-Check: PASSED

- 7b9c4ee15 and 4b7bb8cef are ancestors of HEAD; all 9 listed files exist and carry the changes.
