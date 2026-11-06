---
phase: 170-pagecopy
plan: 13
subsystem: ui
tags: [factsheet, copy, month-label, census, layout-narrow]

requires:
  - phase: 169
    provides: "169-05 MetricsColumn.tsx (em-dash lock for Month-to-date / 3 Month / Year-to-date)"
  - phase: 170
    provides: "170-11 residual-offender census (head 20895bcc, run 36755290085, job 110024318330); 170-12 DESIGN.md rows"
provides:
  - "monthRowLabel(end, now) in MetricsColumn.tsx: 'Final month (MMM YYYY)' for an ended record, 'Month-to-date' for the current UTC month"
  - "MetricsColumn.final-month.test.tsx: both branches on a faked Date clock, UTC boundary, em-dash lock, empty end"
  - "DESIGN.md Decisions Log row for AD-10"
  - "SHA-bound verdicts for items (c) and (e): no layout edit"
affects: [170-14]

actuals:
  tokens: 4500
  tasks: 2
  commits: 3

plan_head_before: ced57cdb7c6c96ba69c78d497a28e1c9ca943347
plan_head_after: f8a7b26dc455aeb334c7850adff0ce345377fa51

tech-stack:
  added: []
  patterns:
    - "Clock-dependent label tested with vi.useFakeTimers({ toFake: ['Date'] }) + vi.setSystemTime, rendered through FactsheetProvider + MetricsColumn"

key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
    - DESIGN.md

key-decisions:
  - "The month row label branches on the UTC year+month of m.end against the current UTC month; the value (m.mtd) and 169-05's em-dash are untouched"
  - "An empty or unparseable m.end (the scenario composer's empty-blend summary sets end: \"\") keeps 'Month-to-date'"
  - "Items (c) and (e): no layout edit. The 170-11 census names nothing in HeatmapPanels.tsx or the factsheet tables, and no reflow row in that run measured /factsheet/<id>/v2 at V390/V640"

requirements-completed: []

duration: 12 min
completed: 2026-09-30
status: complete
---

# Phase 170 Plan 13: Factsheet month label and items (c)/(e) Summary

**An ended record's month row now reads `Final month (Jun 2024)` in both return panels, and `Month-to-date` only while the record's last month is the current UTC month. Items (c) and (e) get SHA-bound "not named" verdicts with no layout edit, because the 170-11 census did not measure the published factsheet route.**

## Performance

- **Duration:** about 12 min
- **Started:** 2026-09-30T21:05Z
- **Completed:** 2026-09-30T21:17Z
- **Tasks:** 2 of 2
- **Files modified:** 5 (1 created)

## Precondition and Phase 169 gate

- **170-11 census:** present and bound. Head `20895bcc25ebf1a2e8c31375f262c2eb12fc4bc7`, CI run `36755290085`, job `110024318330` (e2e-seeded). The plan continues.
- **Phase 169 gate:** this plan has no explicit gate block. For the record, the pipe-free form was run at HEAD `ced57cdb7`: `git log origin/main --format=%H -1 --grep="169-05" --fixed-strings -- "src/app/factsheet/[id]/v2/MetricsColumn.tsx"` printed `f1ca32b560743cc8c2011bb5198391b192a0d93d`, so 169-05 is on origin/main. The old `git show | grep -q` form was not used.

## Task 1: items (c) and (e), verdicts

All three are bound to head `20895bcc`, run `36755290085`, job `110024318330`. **Caveat:** "not named" is weaker than "clean" here. Every offender line in that run is `offender=<unknown>` (deferred #1: the walker cannot name a descendant of `#main-content`). Also, no reflow row in that run measured `/factsheet/<id>/v2` at V390 or V640 (170-11 SUMMARY, N-KPI section). The first measurement of that route will be 170-11's N-KPI published-factsheet rows, and those need CI.

- **Item (c), YearCalendarCanvas:** not named at `20895bcc`, run `36755290085`. No code change. The canvas stays inside its bounded, focusable region in `HeatmapPanels.tsx`: `flex flex-col gap-4 -mx-2 px-2 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`, `role="region"`, `tabIndex={0}`, aria-label "Daily returns calendar: scrolls horizontally…". The monthly-returns table above it uses the same idiom. `overflow-x-hidden` count in `HeatmapPanels.tsx`: 0.
- **Item (e), drawdown table:** already inside `<ResponsiveTable label="Worst 10 drawdowns">` in `WorstDrawdownsTablePanel` (`MetricsColumn.tsx`). `MetricsColumn.worst-drawdowns-reflow.test.tsx` already covers it. No edit.
- **Item (e), the unidentified ~378 px table:** not reproduced at `20895bcc`; the census names no owning file. No wrap, per the plan's no-blanket-wrapping rule (T-170-35).

No edit to `HeatmapPanels.tsx` or `e2e/layout-narrow.spec.ts`.

## Task 2: Final month relabel

**Relabelled. 169 had not shipped it.** At HEAD `ced57cdb7`, both call sites (`Returns` panel and `CumulativeReturnsPanel`) had the literal `label="Month-to-date"` with no branch. `git log origin/main -S"Final month"` returned nothing.

- **Helper:** `monthRowLabel(end, now = new Date())` sits beside `isoToMonthDay` and reuses its `MONTHS` table (the existing month formatter). If the UTC year and month of `end` equal the current UTC ones, it returns `Month-to-date`. Otherwise it returns `` `Final month (${MMM} ${YYYY})` ``. An empty or unparseable `end` returns `Month-to-date`. This covers `emptyComputeSummary`, which sets `end: ""`.
- **Call sites:** both rows now pass `label={monthRowLabel(m.end)}`. The value expressions (`pct(m.mtd, true)`, bench `pct(b?.mtd, true)` / `""`) are byte-unchanged.
- **Why the label is right:** compute()'s `mtd` compounds returns after the last day of the month before the record's last month (`compute.metrics.test.ts` CUTOFF.mtd). So it is the return of the record's final month.

### RED, GREEN, neuter

- **RED at HEAD** (commit `9f1c4041a`, test only): 3 failed, 3 passed of 6. The failures read `AssertionError: Returns: expected 'Month-to-date' to be 'Final month (Jun 2024)'`, and the same for `Final month (Aug 2026)` on the UTC-boundary case. The 3 that pass at HEAD are the "stays Month-to-date" arms, which are true of the old code by definition.
- **GREEN** (commit `6b1b3f5de`): 6 of 6 passed. The full `src/app/factsheet/[id]/v2/` run gave 60 files and 567 tests passed.
- **Neuter:** I made a byte backup with `cp` to a per-agent scratchpad file, then replaced the ended branch's return with `"Month-to-date"`. Running the new test plus the two collateral tests gave **6 failed / 26 passed** across 3 files. I restored with `cp`. `git diff --stat` on the file was then empty, `grep -c 'Final month (${MONTHS'` returned 1, and the new test was back at 6 of 6.

### Tests in the new file

1. The current UTC month (clock 2026-09-30, end 2026-09-15) keeps `Month-to-date` in both panels, and the value equals `pct(m.mtd)`.
2. An ended record (end 2024-06-08) reads exactly `Final month (Jun 2024)` and matches `/^Final month \([A-Z][a-z]{2} \d{4}\)$/` in both panels. The value is unchanged, and no `Month-to-date` appears anywhere in the column.
3. UTC boundary: end 2026-08-31 at 2026-09-01T00:30Z reads `Final month (Aug 2026)`.
4. The same record at 2026-08-31T23:30Z still reads `Month-to-date`.
5. Em-dash lock: an ended record with `mtd: null` keeps the row, labelled `Final month (Jun 2024)`, with value `—`.
6. An empty `end` gives `Month-to-date` and never `Final month (undefined NaN)`.

## Verification

- Plan Task 2 `<verify>` run verbatim: exit 0 (`Tests 6 passed (6)`).
- Plan Task 1 `<verify>`: `npx vitest run "src/app/factsheet/[id]/v2/"`, 567 passed, exit 0.
- `npx vitest related --run "src/app/factsheet/[id]/v2/MetricsColumn.tsx"`: 61 files, 1149 tests passed.
- DESIGN.md readers (`tests/lib/design-changelog-table-shape.test.ts`, `tests/a11y/trust-tier-tokens.test.ts`, `tests/a11y/design-token-drift.test.ts`, `tests/visual/`): 9 files, 78 passed.
- `npx tsc --noEmit -p .`: clean. `npx eslint` on all four touched source/test files: clean.
- `grep -c 'Month-to-date' MetricsColumn.tsx`: 5. That is at least 1, as the acceptance criterion requires.
- **Seeded e2e: not run** (CI-only; no push was made). No e2e file changed in this plan. The expected CI outcome is unchanged from 170-11. The composed-scenario rows' final `assertNoReflow` (N-FOOT, N-SCN, N-KPI composed) stay RED until deferred #2 is fixed. The N-KPI published-factsheet rows are UNKNOWN: they are the first reflow measurement of `/factsheet/<id>/v2`, which is where items (c) and (e) would show up. No e2e row asserts the month label, and seeded strategies ending in a past month will now render `Final month (…)`.

## Deviations from Plan

1. **[Rule 3 - Blocking] Two existing tests updated outside `files_modified`.** `MetricsColumn.window-rows.test.tsx` (two `kept` lists plus the header comment) and `MetricsColumn.record-length.test.tsx` (one `kept` list) asserted `Month-to-date` on fixtures that end in June 2024 (SHORT ends 2024-06-08, `dense(166)` ends 2024-06-14; I checked both with node). The relabel turns them RED by design. Under the neuter they went RED (3 of the 6 failures). They now name `Final month (Jun 2024)`, which stays stable because 2024 can never become the current month. Commit `6b1b3f5de`.
2. **DESIGN.md row appended.** The plan's `coupling_justified` says this plan "only appends the MTD row if the relabel lands", but DESIGN.md is not in `files_modified`. The relabel landed, so one AD-10 row follows 170-12's two 2026-09-27 rows, in the same format and dated to the UI-SPEC decision. It is a separate `docs` commit, `f8a7b26dc`.
3. **Branch namespace.** Commits are on `feat/170-layout` in the orchestrator's worktree (isolation `none`). This is outside the executor's `agent-*` pattern, and I recorded it rather than halting, as 170-11 did.
4. **No STATE/ROADMAP/REQUIREMENTS updates**, per the orchestrator. `SC2-NOSCROLL` and `SC2-(b)` are **not** claimed complete. The composed-scenario page still overflows the document (deferred #2), and the published factsheet route has not been reflow-measured.

## Findings for the orchestrator

- **Hydration edge (low, not fixed):** `monthRowLabel` reads the clock during render in a `"use client"` component that is also server-rendered. If the server render and client hydration fall on opposite sides of a UTC month boundary, the label text differs and React logs a hydration mismatch for that one row. This can only happen within seconds of 00:00 UTC on the 1st. The label then corrects itself on the client.
- **Items (c)/(e) are not measured on their route.** Their verdicts depend on the N-KPI published-factsheet rows reading clean in the next CI run. If those rows go red, the walker still cannot name the offender until deferred #1 is fixed.

## Known Stubs

None.

## Threat Flags

None. T-170-34: only the label string branches on the clock, and the value and em-dash are unchanged (pinned by tests 2 and 5). T-170-35: no table was wrapped.

## Commits

- `9f1c4041a` test(170-13): pin the month row label on both branches of the UTC clock
- `6b1b3f5de` feat(170-13): an ended record's month row reads 'Final month (MMM YYYY)'
- `f8a7b26dc` docs(170-13): DESIGN.md Decisions Log records the Final month label (AD-10)

## Self-Check: PASSED

- FOUND: src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx, MetricsColumn.tsx, MetricsColumn.window-rows.test.tsx, MetricsColumn.record-length.test.tsx, DESIGN.md
- FOUND: commits 9f1c4041a, 6b1b3f5de, f8a7b26dc
