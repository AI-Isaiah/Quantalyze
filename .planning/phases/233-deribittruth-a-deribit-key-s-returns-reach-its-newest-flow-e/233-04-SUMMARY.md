---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 04
subsystem: prod-prober
tags: [prober, freshness, FRESH-02, PROOF-01, deribit]
requires: ["233-02"]
provides:
  - "freshness arm that cannot read GREEN on an empty, truncated, renamed or malformed read"
  - "defect kind `freshness-no-scope`; measure-fail on no terminal day, a row-count mismatch, an unparsable row, a non-ISO day and a scope psql failure"
  - "day-by-day and boundary rules proven from both sides by held-back fixtures"
  - "describe binding the arm's SQL field names to the writers that store them, with a calibration"
affects: [233-06]
tech-stack:
  added: []
  patterns: ["cron-obs completeness idiom (the database's own count against the parsed rows)", "WR-02 binding describe with a calibration it"]
key-files:
  created:
    - scripts/prod-prober/fixtures/freshness/no-scope.json
    - scripts/prod-prober/fixtures/freshness/partial-cover.json
    - scripts/prod-prober/fixtures/freshness/bound-plus-one.json
  modified:
    - scripts/prod-prober/arms/freshness.mjs
    - scripts/prod-prober/run.mjs
    - src/__tests__/prod-prober-wiring.test.ts
key-decisions:
  - "The scope log line `freshness: scope derived=<n> with_inputs=<n> with_terminal=<n>` is printed before any guard, so a later failure cannot hide it (plan 233-06 reads it as the A5 evidence)"
  - "A row-count mismatch is a measure-fail but judging still runs on the rows returned"
metrics:
  duration: "resumed after a machine restart; the resume (PROOF-01 re-runs, gates, summary) took about 20 min wall clock"
  completed: 2026-11-25
status: complete
commits: 4
plan_head_before: 8bbe50e772d615e8e0057f43e39408586bb3cc74
plan_head_after: d8ebe24964e08bb6b24f9948961985ab00ad66f1
actuals:
  tokens: 21000
  tasks: 3
  commits: 4
---

# Phase 233 Plan 04: Freshness arm expansion Summary

The freshness arm now reads GREEN only on a full, well-formed read: zero derived keys pages as `freshness-no-scope`, every truncated, renamed, malformed or failed read is a `measure-fail` naming the arm, a reason covering only part of a gap does not count, a gap of bound plus one pages while the gap-equal-to-bound control stays fresh, an anchor reason on one key never covers another, and the arm's SQL field names are bound to the source lines that write them.

## What shipped

- Task 1 (`d88e86888`): `freshness.mjs` gains `REMEDIES["freshness-no-scope"]` and the three guards in `run` (derived 0, with_terminal 0, row count differs from derived). `no-scope.json` fixture. `run.mjs`: kind `freshness-no-scope`, `KIND_ASSERTIONS` entry, red-map entry, the `fixtureSql` measure-fail and raw-string modes, six dedicated `freshness:` scenarios (unparsable row, truncated read, no terminal day, scope psql failure, non-ISO day, the pinned scope log line). Wiring roster and scenario literal moved in the same commit.
- Task 2 (`8ed7c43cf`): `partial-cover.json` and `bound-plus-one.json` fixtures, both in the red map as `freshness-stale`; the dedicated scenario proving an anchor reason on key X never covers key Y; scenario literal moved.
- Task 3 (`3cabd9ae3`): the `[233 FRESH-02]` describe: baseline `compute_jobs_kind_check` admits `derive_broker_dailies`, the writers still store every `key_inputs` field the keys statement reads, the statements quote each as a SQL literal, the `csv_daily_returns` and `allocator_equity_derived` columns are present, and a calibration `it` proves a drifted spelling is caught.
- Follow-up (`d8ebe2496`): see Deviations.

Scenario count history (read from the self-test header, never restated): **93** (plan 233-02) to **100** (Task 1: one red fixture and six dedicated scenarios) to **103** (Task 2: two red fixtures and one dedicated scenario).

## PROOF-01

Backups were written to the session scratchpad, restored with `cp` and compared with `cmp` (no output, exit 0). The five arms were re-run in the resumed session after the first executor's readings were lost; every RED below is the first failing line of the command, copied verbatim, and the failing scenario header is named where it is not in the cell. fresh-b-per-day: the RED line is the first `SELF-TEST FAIL:` line. fresh-e-scope: the isolating scenario still passed its exit and count checks and failed on the kind, because the neuter turns the empty scope into a `measure-fail` through the downstream guard rather than letting it read GREEN. fresh-f-terminal failed in scenario 44/103 and fresh-g-count in scenario 43/103. fresh-h-binding: the self-test was also run under the neuter and still printed `=== SELF-TEST PASSED: 103/103 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===`, which is the point of the binding.

| arm | neuter edit | command | RED | cmp | GREEN |
|-----|-------------|---------|-----|-----|-------|
| fresh-b-per-day | freshness.mjs judgeFreshness: `if (uncovered.length === 0) {` to `if (uncovered.length < gap) {` (any stated day covers the gap) | node scripts/prod-prober/run.mjs --self-test | RED: SELF-TEST FAIL: partial-cover.json exits 1 (got 0) | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 103/103 scenarios, every arm's kinds fired on their own fixtures and nowhere else === |
| fresh-e-scope | freshness.mjs run: `if (scope.derived === 0) {` to `if (false && scope.derived === 0) {` (scope guard removed) | node scripts/prod-prober/run.mjs --self-test | RED: SELF-TEST FAIL: the defect kind is freshness-no-scope (got measure-fail) | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 103/103 scenarios, every arm's kinds fired on their own fixtures and nowhere else === |
| fresh-f-terminal | freshness.mjs run: `if (scope.withTerminal === 0) {` to `if (false && scope.withTerminal === 0) {` (terminal guard removed) | node scripts/prod-prober/run.mjs --self-test | RED: SELF-TEST FAIL: no terminal day: exits 1 (got 0) | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 103/103 scenarios, every arm's kinds fired on their own fixtures and nowhere else === |
| fresh-g-count | freshness.mjs run: `if (parsed.rows.length !== scope.derived) {` to `if (false && parsed.rows.length !== scope.derived) {` (count guard removed) | node scripts/prod-prober/run.mjs --self-test | RED: SELF-TEST FAIL: truncated read: exits 1 (got 0) | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 103/103 scenarios, every arm's kinds fired on their own fixtures and nowhere else === |
| fresh-h-binding | freshness.mjs FRESHNESS_KEYS_SQL: both `'tiny_base_days'` literals to `'tiny_base_dayz'` (a drifted SQL field name) | npx vitest run src/__tests__/prod-prober-wiring.test.ts -t "233 FRESH-02" | RED: × job_worker.py still writes every key_inputs field the keys statement reads, and the statement quotes each 5ms | cmp: exit 0, no output | GREEN: Tests  5 passed \| 118 skipped (123) |

## Pre-push gates (final lines)

- `node scripts/prod-prober/run.mjs --self-test`: `=== SELF-TEST PASSED: 103/103 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===`
- Reader vitest list (22 files): `Tests  1900 passed | 17 skipped (1917)`, `Test Files  22 passed (22)`.
- Whole-tree invariants: `Tests  660 passed (660)`, `Test Files  17 passed (17)`.
- `npm run lint`: `✖ 4 problems (0 errors, 4 warnings)`. The warnings are unused variables in `src/lib/factsheet/composite-read-path.ts` and `src/lib/queries.stale-analytics-detail.test.ts`, neither of which this plan touches; the hygiene checks after them all print OK.
- gitleaks over `freshness.mjs`, `fixtures/freshness`, `run.mjs` and the wiring test: `no leaks found` for each.
- `node scripts/verify-plan-anchors.mjs` on this plan: exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The binding describe's table helper tripped the whole-tree narrowing-call scan**
- **Found during:** Task 3 step 4, the reader vitest list (`test-restore-workflow-wiring.test.ts`, rule "no scanned file feeds a raw index into a narrowing call")
- **Issue:** `tableBody` passed `BASELINE.indexOf("\n);", at)` straight to `slice`; a miss would return -1 and silently narrow from the end.
- **Fix:** look the end index up, return an empty string on a miss, then slice. An empty body fails the column assertions, so the binding still fails loud.
- **Files modified:** `src/__tests__/prod-prober-wiring.test.ts`
- **Commit:** `d8ebe2496`

## Known Stubs

None.

## Threat Flags

None. The remedy and detail strings name tables and kinds, never an id; fixture tags are synthetic.

## Self-Check: PASSED

Files found: the three fixtures, `freshness.mjs`, `run.mjs`, the wiring test. Commits `d88e86888`, `8ed7c43cf`, `3cabd9ae3` and `d8ebe2496` are ancestors of HEAD.
