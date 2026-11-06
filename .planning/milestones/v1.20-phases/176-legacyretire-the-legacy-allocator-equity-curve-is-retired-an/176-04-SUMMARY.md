---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 04
subsystem: bridge-outcomes
tags: [live-db-test, runbook, adr, D-03, D-05, D-06, vitest]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "plan 02: derived_account_return_over, the re-based compute_bridge_outcome_deltas and the D-06 reset"
provides:
  - "src/__tests__/bridge-outcome-cron-holding.test.ts seeds an allocator_equity_derived equity_curve row and asserts the compounded 1.01^N - 1 holding deltas through the service-role RPC"
  - "docs/runbooks/bridge-outcome-cron.md describes all three branches, the per-account holding rule and the one-time D-06 reset"
  - "one dated AMENDED blockquote in ADR-0023 under the migration 073 paragraph"
affects: [176-07 (reads CI frontend-live-db-lane for this file on the PR head SHA)]

actuals:
  tokens: 5700
  tasks: 2
  commits: 2
plan_head_before: f5475112e6d1c4b1a3ecdfbe76d81904f3e436ab
plan_head_after: d36d8cca2163a52a5aa6618cdc40057a28ac8d11
commits: 2

tech-stack:
  added: []
  patterns:
    - "live-DB fixture dates are relative to the run day (today minus 200, UTC) so they stay inside a rolling CHECK window"
    - "an independent Math.pow oracle (1.01^N - 1) compared at 1e-9 instead of a copy of the SQL formula"

key-files:
  created: []
  modified:
    - src/__tests__/bridge-outcome-cron-holding.test.ts
    - docs/runbooks/bridge-outcome-cron.md
    - docs/architecture/adr-0023-audit-event-taxonomy.md

key-decisions:
  - "Test 2 replaces the allocator's one derived row (primary key allocator_id + kind) rather than adding a second allocator: Test 1's outcome is already computed (needs_recompute false, delta_30d set), so it is not a candidate again"
  - "The strategy-branch tests moved to the same relative anchor: their fixed 2026-01-01 anchor would have left bridge_outcomes_allocated_at_check on 2027-01-01 too"

requirements-completed: [SC-1]

completed: 2026-10-31
---

# Phase 176 Plan 04: The live bridge test and its documents follow the derived holding branch

**The only test that runs the daily bridge batch through PostgREST now seeds the account's derived equity curve and asserts the compounded holding deltas (1.01^N - 1), a NULL on a missing day, and the unchanged strategy branches; the runbook and ADR-0023 say what the holding branch now measures.**

## Task Commits

1. **Task 1 (tracer): the live bridge test measures the derived account curve** - `e1376ae3b` (test)
2. **Task 2: the bridge runbook and ADR-0023 describe the per-account holding branch** - `d36d8cca2` (docs)

Tracer feedback gate: Task 1's `<verify>` was re-run end to end after the commit and printed OK (the live run is not possible here, see below), so the docs task went ahead.

## What changed

- **Test (4 tests, same shape):** (1) a holding outcome gets delta_30d/90d/180d equal to `Math.pow(1.01, N) - 1` to 1e-9; (2) a derived returns series without anchor + 45 gives delta_30d set and delta_90d / delta_180d NULL (the gap sits inside the 90 and 180 day windows only); (3) a strategy-sourced outcome still gets 0.05 / 0.15 / 0.30; (4) a `match_decision_id`-NULL allocated row is still processed by the strategy branch. The seeded payload is version 2, `is_trustworthy: true`, with a dense `returns` series for anchor + 1 .. anchor + 180 and a compounding dollar `curve` the outcome deliberately does not read. No legacy snapshot row is written or read; cleanup deletes the derived rows. `it.skipIf(!HAS_LIVE_DB)` and `advertiseLiveDbSkipReason` are kept.
- **Relative dates:** the anchor is today minus 200 days in UTC (was the fixed 2026-01-01, which would leave `bridge_outcomes_allocated_at_check` on 2027-01-01). Anchor + 180 is 20 days before today, so the whole window is in the past.
- **Runbook:** the Overview bullet and "What it computes" cover the strategy, voluntary_add and holding branches; the holding branch is per ACCOUNT, compounds the derived `returns` through `public.derived_account_return_over`, is NULL when the derived row is missing, not version 2, not trustworthy or lacks any day, writes no `estimated_*` column, and takes no row outside the `allocated_at` CHECK window (`176-BRIDGE-CHECK-WINDOW-ABORT` named for the other two branches). A subsection covers the one-time D-06 reset (what it touched, Pending until the next 03:00Z run, owner-only, when it may be re-run, the rollback file). "Rows awaiting compute" points at the `r3-bridge-holding` form in `docs/runbooks/legacyretire-go-live.md`.
- **ADR-0023:** one `AMENDED 2026-10-31 (Phase 176 LEGACYRETIRE, D-03 and D-05)` blockquote after the migration 073 paragraph; the original text is untouched and the blockquote ends with "Original text kept above."

## Evidence

- **Local run of the live file, before and after (Rule 12, a skip is a skip):** before (`/tmp/legacyretire-04/before.log`): `Test Files  1 skipped (1)`, `Tests  4 skipped (4)`. After (`t1.log`): `Test Files  1 skipped (1)`, `Tests  4 skipped (4)`. **4 skipped locally (no live DB); CI frontend-live-db-lane is the oracle, read in plan 07.** `node scripts/live-db-lane-corpus.mjs` still selects the file (`corpus: 51 file(s)`).
- **The live run was NOT executed and no RED-then-GREEN of the live file was observed.** Docker is down here (`docker info` failed), so no local stack could be started. No remote database was substituted (no TEST, PROD, `--linked`, `db push`). What stands in for it: the seed payload has the same shape and the same 0.01 daily r as plan 02's SQL gate (`bd_payload`, arm B1, which was seen RED on the base body and GREEN on the migration, see the 176-02 SUMMARY); the test's own correctness (insert shapes, the oracle, the relative anchor) is reviewed by reading against the baseline DDL (`allocator_equity_derived`, `bridge_outcomes` CHECKs, numeric delta columns so 1e-9 is meaningful). Plan 07 must read this file's run in the CI lane on the head SHA.
- **Task 1 verify:** vitest skipped 4 / failed 0; `npm run typecheck` rc 0; the file names `allocator_equity_derived`; no non-comment line writes `from("allocator_equity_snapshots")` (baseline at HEAD had 3, now 0). Printed GATEOK/SKIPOK.
- **Task 2 verify:** `audit-coverage.test.ts` 26 passed; with `vercel-cron-limits` and `legacyretire-runbook-forms` (the other tests naming these docs) 3 files, 236 tests passed; the plan's one-line verify printed OK. Baseline at HEAD: `derived_account_return_over` in the runbook 0, the AMENDED line in the ADR 0; after: 1 and 1. `git status --porcelain` empty after the last task commit.
- **D-03 copy re-measured:** `grep -rIinE 'per symbol|per-symbol|symbol value' src` finds 7 lines, none a UI string saying an outcome is per symbol: a comment in `src/lib/queries.ts` (latest-asof-per-symbol collapse of holdings), `queries.my-allocation.test.ts` (2, holdings collapse), `funding-fee-runtime-guard.test.ts` (funding fees), `allocator-equity-rls.test.ts` (legacy snapshot RLS header), `redteam-b02-regressions.test.ts` (symbol values stripped to null), and this plan's own test header (the word per-symbol in the history sentence). So no UI copy changes, as expected.

## CHANGELOG inputs

- **Tests:** the live bridge test (`bridge-outcome-cron-holding`) seeds the account's derived equity curve and checks the compounded holding deltas, a NULL on a missing day, and the unchanged strategy branches; its dates are now relative to the run day, which also removes a fixed-date failure that would have started on 2027-01-01 once the allocated_at CHECK window moved past it.
- **Changed (docs):** the bridge outcome runbook describes the three branches, the per-account holding rule and the one-time reset; ADR-0023 carries a dated amendment that the holding branch no longer reads the per-symbol breakdown.

## Deviations from Plan

None - plan executed as written. One judgement inside it: the plan said to keep "the four tests"; the strategy tests' fixed anchor was also made relative (same file, same CHECK), which the plan's relative-date truth implies.

## Known Stubs

None.

## Threat Flags

None. T-176-11 mitigated (the local skip is recorded as a skip above); T-176-12 mitigated (synthetic ids and relative dates only, no PROD reading).

## Self-Check: PASSED

Files found: the test file, the runbook, the ADR. Commits found on HEAD: e1376ae3b, d36d8cca2.
