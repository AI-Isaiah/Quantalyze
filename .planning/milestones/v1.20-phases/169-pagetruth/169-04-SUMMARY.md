---
phase: 169-pagetruth
plan: 04
subsystem: factsheet
status: complete
tags: [factsheet, compute, return-windows, freshness-chip, SC5, SC6, SC9]
requires: []
provides:
  - "compute(): one calendar coverage rule (windowReturn) for mtd / ytd / p3m / p6m / p1y"
  - "compute(): p3y / p5y on 3 x 365 / 5 x 365 calendar-day cutoffs"
  - "ComputeResult windows typed number | null; optional p3y / p5y (D-21)"
  - "FreshnessChip date line bound to its subject, plus a labelled Computed line (D-16)"
affects:
  - "169-05 (consumes p6m / p1y / p3y / p5y nulls to omit rows, D-17 / D-57)"
  - "169.5-01 / 169.5-02 (edit types.ts and the build-payload snapshot after this lands)"
tech-stack:
  added: []
  patterns:
    - "coverage-gated window: null unless first observation <= cutoff + 1 UTC day"
key-files:
  created: []
  modified:
    - src/lib/factsheet/compute.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/compute.metrics.test.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx
key-decisions:
  - "The chip prints the series end's age as whole elapsed UTC days (Math.floor), not Math.round: the series end is a UTC date, and rounding would call a bar dated 120 days ago 121d every afternoon UTC"
  - "An UNKNOWN series end under the Track record subject prints the em dash on the date line (never the compute date); the compute date keeps its labelled Computed line"
  - "chip-honesty C-12 pinned the pre-D-16 contract and was rewritten to D-16 (the plan file owns that test)"
patterns-established:
  - "a return window is shown only when the record covers it; multi-year windows are calendar days, never an observation count"
requirements-completed: [SC5, SC6, SC9]
metrics:
  duration: "~14 min"
  completed: 2026-09-29
actuals:
  tokens: 4100
  tasks: 2
  commits: 2
plan_head_before: e9c1caafa9650ff81eec4173340e304f593a34fe
plan_head_after: be5af7d09ba6bf10425eb18a5239d160367620d6
---

# Phase 169 Plan 04: return windows never outrun the record; the chip's date matches its subject — Summary

`compute()` now nulls every return window (MTD, YTD, 3M, 6M, 1Y and the new 3Y / 5Y) that the record does not cover, through one calendar coverage helper, and the freshness chip prints the series end (not the compute date) under a "Track record" subject, with the compute date kept on its own "Computed" line.

## What was built

**Task 1 (tracer), commit `d2b01a494`.** In `compute()` a single internal helper `windowReturn(cutoff)` returns null when the first observation date is after `cutoff` plus one UTC day, and otherwise the existing `compoundFrom(cutoff)` value. `mtd`, `ytd`, `p3m`, `p6m` and `p1y` all route through it, and `p3y` / `p5y` are added with cutoffs `offsetDays(3 * 365)` / `offsetDays(5 * 365)`. The comment states the rule once and cites D-11. `years` is untouched. In `types.ts` the five windows are `number | null`, and `p3y?` / `p5y?` are optional so the 167.1.2 hand-built summary (`emptyComputeSummary`, named `zeroedComputeSummary` in the plan) compiles unedited (D-21). The `ComparatorBlock.summary` Pick is unchanged. `tsc` flagged no reader. `pct()` in MetricsColumn already renders null as "—".

**Task 2, commit `be5af7d09`.** In `FreshnessChip`, on the series-binding arm the date line is `seriesEnd?.formatted ?? "—"` followed by the series age in whole days. The age reuses the `seriesAgeDays` value the tone was bucketed from, hoisted into a variable. A `<p>` line reading "Computed <compute date>" follows it (`mt-0.5 text-caption font-mono tabular-nums text-text-muted`, which is DESIGN.md's muted timestamp tier in the mono data voice). The line is rendered second, so the existing `querySelector("p")` readers still find the date line first. The job-binding arm renders byte-identically to before. The docblock now says the date line always belongs to the subject. No threshold, tone or formatter was added.

## Task Commits

1. **Task 1 (tracer): one calendar coverage rule plus p3y / p5y.** Commit `d2b01a494` (fix). The tests, implementation and snapshot are in one commit. The tracer gate re-ran the task's verify end-to-end after that commit and it was green.
2. **Task 2: the chip's date line states its subject's fact.** Commit `be5af7d09` (fix). The tests and implementation are in one commit; see deviation 4.
3. **SUMMARY:** `c9dd1a099` (docs), plus the follow-up docs commit that adds this section.

## Verification (exact output, run by the executor)

- `npx tsc --noEmit -p .` → no output, `tsc exit=0`
- `npm run lint` → `lint exit=0` (eslint, admin-route manifest OK, route contract OK, `[check-planning-hygiene] OK — 7804 tracked files scanned`)
- `npx vitest run src/lib/factsheet src/lib/return-stats.single-source.test.ts "src/app/factsheet/[id]/v2"` → `Test Files 68 passed (68)`, `Tests 990 passed (990)`, exit 0
- Task 1 verify (tracer gate re-run after its commit): `Tests 539 passed (539)`, exit 0; tsc exit 0
- Task 2 verify `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView"` → `Test Files 8 passed (8)`, `Tests 116 passed (116)`
- Read-only regression run of `src/app/(dashboard)/allocations` (the forbidden 167.1.2 area): `Test Files 133 passed (133)`, `Tests 2107 passed (2107)`
- Acceptance greps: `grep -c p3y compute.ts` = 1, `grep -c p5y compute.ts` = 1, the non-comment `\* 252` count = 0, no diff in `MetricsColumn.tsx` or under `src/app/(dashboard)/allocations/`, `grep -cE 'seriesEnd\??\.formatted' FactsheetView.tsx` = 1
- Full `npx vitest run`: 1 failure, `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` ("refuses a handoff whose DB_URL is not loopback…"). It passes in isolation (`Tests 33 passed (33)`) and touches nothing in this plan, so it is a load-sensitive flake outside scope. Recorded here and not fixed.

## SC9 neuter evidence (cp backup → hand-revert the fix line → RED → restore → cmp → GREEN)

**Task 1, pre-change RED.** The new tests were written first and run on HEAD code: 10 failed, 11 passed. Failing: the 166-day case, the 6-year case, boundary mtd / ytd / p3m / p1y / p3y / p5y, the 800-point 3Y case, and the sparse 4-year 3Y case. The cutoff self-check stayed green.

**Task 1, neuter A.** `windowReturn` was changed to never return null (`return compoundFrom(cutoff);`). Result: `Tests 9 failed | 12 passed (21)`. Failing: the 166-day case, all six boundaries, the 800-point case, and the sparse 4-year case. The last one fails because p5y is no longer null. The backup was restored and `cmp` reported "restored cmp OK", then `Tests 21 passed (21)`.

**Task 1, neuter B (off-by-one).** The `+ 1` UTC-day line was removed. Result: `Tests 6 failed | 15 passed (21)`, with all six boundary cases failing. Restored, `cmp` OK, `21 passed`.

**Task 2, pre-change RED.** Run on HEAD code: 5 failed, 18 passed. Failing: C-12 (rewritten), D16-1, D16-3, D16-4 and D16-5. D16-2, the job-binding control, passed on HEAD as intended.

**Task 2, neuter.** The binding arm was made to print `formatIsoDate(computedAt)` again (`const dateText = formatIsoDate(computedAt);`). Result: `Tests 5 failed | 111 passed (116)`. Failing: C-12, D16-1, D16-3, D16-4 and D16-5. Restored, `cmp` OK, `116 passed`.

## Moved snapshot keys (`build-payload.test.ts.snap`, 3 exports, 78 key changes)

The snapshot is one JSON string per export, so the diff was read with a deep JSON diff of the before and after snapshots rather than as a line diff. The fixture runs 62 days, 2025-03-15 to 2025-05-15. It covers MTD (cutoff 2025-04-30) and no other window. Every export (single-key geometric, composite arithmetic, and `ingestSource:'api'`) moved identically, 26 keys each:

| Block | Keys moved | Before → after | Why |
|---|---|---|---|
| `strategyMetrics` | `ytd`, `p3m`, `p6m`, `p1y` | -0.0484943648387 → null (all four) | Each old value was the whole-record geometric return, printed under four different labels. The record starts after each cutoff + 1 day. |
| `strategyMetrics` | `p3y`, `p5y` | absent → null | New keys; the record is shorter than 3 and 5 years |
| `comparators.btc.summary` | `ytd`, `p3m`, `p6m`, `p1y` | 0.230325222994 → null | Same rule. `comparator-block.ts` calls `compute()` over the same dates. The value equalled the BTC whole-record `cum_ret`. |
| `comparators.spx.summary` | `ytd`, `p3m`, `p6m`, `p1y` | 0.0426088075211 → null | Same rule; the value equalled the SPX whole-record `cum_ret` |
| `styleDrift.h1` | `ytd`, `p3m`, `p6m`, `p1y` | 0.0770036969915 → null | `style-drift.ts` calls `compute()` on the first half (2025-03-15 to 2025-04-14). The value equalled h1's `cum_ret`. |
| `styleDrift.h1` | `p3y`, `p5y` | absent → null | New keys |
| `styleDrift.h2` | `ytd`, `p3m`, `p6m`, `p1y` | -0.116525191307 → null | Second half (2025-04-15 to 2025-05-15); the value equalled h2's `cum_ret` |
| `styleDrift.h2` | `p3y`, `p5y` | absent → null | New keys |

Unmoved, as expected:
- `mtd` in every block, because every record starts on or before its MTD cutoff + 1 day.
- `comparators.*.summary` gains no `p3y` / `p5y`, because the Pick and `comparator-block.ts`'s explicit field list are unchanged.
- `metricsByBasis` carries no window keys.

No moved value is anything other than a newly-null window or a new `p3y` / `p5y` key.

One note on the composite export: its `strategyMetrics.cum_ret` is the persisted arithmetic overlay (0.33), while the nulled windows held the geometric whole-record compound. Both were the whole record, and neither was a real 3M / 6M / 1Y figure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] chip-honesty C-12 pinned the contract D-16 replaces**
- **Found during:** Task 2
- **Issue:** The plan said to run "the other FactsheetView tests unchanged", but C-12 asserted the opposite of D-16. It required the date line under "Track record · old" to be the compute date and NOT the series end.
- **Fix:** C-12 was rewritten to the D-16 contract: date line = series end + "(89d)", the compute date on the "Computed" line, and the recency line unchanged. Its original intent, "provenance was not traded away", is kept through the labelled line. A lineage comment in the test records the change. The file is in this plan's `files_modified`.
- **Commit:** `be5af7d09`

**2. [Rule 2 - Missing case] Unknown series end on the binding arm**
- **Found during:** Task 2
- **Issue:** The "unknown" tone ranks above "fresh", so for an empty or unparseable series (C-7 / C-8) `seriesIsBinding` is true with `seriesEnd === null`. The plan's behaviour list did not cover this case, and the `<done>` criterion forbids printing the compute date under "Track record".
- **Fix:** The date line prints "—", the chip's existing render for an unreadable date (C-11), and the Computed line keeps the provenance. This is pinned by D16-4.
- **Commit:** `be5af7d09`

**3. [Rule 1 - Precision] Series age rounding**
- **Found during:** Task 2
- **Issue:** Reusing `Math.round` from the compute-age arm would make a date-only series end read "(121d)" instead of "(120d)" every afternoon UTC. That is wrong for a date, and it would make D16-1 depend on the hour.
- **Fix:** The series age uses `Math.floor` (whole elapsed UTC days). The compute arm keeps `Math.round` unchanged.
- **Commit:** `be5af7d09`

**4. [Process] Task 2 (`tdd="true"`): the RED tests and the GREEN implementation share one commit**
- **Found during:** post-execution check against `references/tdd.md`. The reference's task-level cycle asks for a separate `test(...)` RED commit, and its gate rule 3 says to flag a missing one in the SUMMARY.
- **What happened:** the failing tests were written first and run on the pre-change code, and the RED result is recorded under "SC9 neuter evidence" above (5 failed, including the rewritten C-12 and D16-1). They were then committed together with the fix in `be5af7d09`. History was not rewritten to split them.
- **Why it is acceptable here:** this plan is `type: execute`, not `type: tdd`, so the plan-level RED-commit gate does not apply. The RED evidence and a separate neuter RED are both on record. Task 1 followed the same shape.

### Anchor drift, not a deviation
- The plan names the 167.1.2 hand-built summary `zeroedComputeSummary`. At HEAD it is `emptyComputeSummary` in `scenario-factsheet-payload.ts`. It compiles unedited, which is D-21's point.
- The worktree's `node_modules` symlink was pre-created by the orchestrator. It points at a sibling worktree's `node_modules`, not the main checkout's. `require.resolve('vitest')` resolved, so it was kept. It was removed before each commit and re-created afterwards, and never staged.
- The generic executor's `agent-*` branch allow-list was not applied, because the orchestrator assigned `feat/169-w1-04`. The protected-branch check was applied before both commits.

## Issues Encountered

- A full-suite flake in `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` is recorded under Verification. `deferred-items.md` was deliberately not created, because the sibling wave-1 plans write to the same phase directory concurrently and a shared new file would conflict at merge. This SUMMARY entry is the record.

## User Setup Required

None.

## Next Phase Readiness

Plan 169-05 can now read `p6m`, `p1y`, `p3y` and `p5y` as null for a short record and omit those rows (D-17, D-57). It should hide on `== null` so that an ABSENT `p3y` / `p5y` in a hand-built summary is also hidden.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change. T-169-16 is mitigated by one helper, the boundary and short-record tests, two neuters and the key-by-key snapshot table. T-169-17 is mitigated because the date line reuses the `resolveSeriesEnd` value (D16-3 pins byte equality with the recency line). T-169-18 is mitigated because there is no diff in either forbidden area.

## Self-Check: PASSED

- All six modified files exist.
- Commits `d2b01a494` and `be5af7d09` are present in `git log`.
- `commits: 2` was measured with `git rev-list --count` from the plan ledger base.
