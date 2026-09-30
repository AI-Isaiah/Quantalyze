---
phase: 170-pagecopy
plan: 11
subsystem: ui
tags: [factsheet, kpi, container-query, layout-narrow, census]

requires:
  - phase: 169
    provides: "169-04 FactsheetView.tsx, 169-05 MetricsColumn.tsx and record-length.ts, 169-10 DESIGN.md on origin/main"
  - phase: 170
    provides: "170-01 main-aware assertNoReflow, 170-02 layout-narrow spec and composed-scenario seeding"
provides:
  - "Factsheet KpiStrip container ladder: grid-cols-2 @md:grid-cols-3 plus the unchanged @5xl column class"
  - "data-testid factsheet-kpi-label / factsheet-kpi-value on the KPI tile paragraphs"
  - "e2e/layout-narrow.spec.ts describe 'factsheet KPI — N-KPI' (V390, V640; composed scenario and published factsheet)"
  - "SHA-bound residual-offender census for run 36755290085 and the item (b) verdict"
affects: [170-12, 170-13, 170-14]

actuals:
  tokens: 2200
  tasks: 3
  commits: 2

plan_head_before: 74a64cc855f2e3eb7911eba272afc4512646750c
plan_head_after: eb92ba0f29f759344f6b8040d11491271fa36487

tech-stack:
  added: []
  patterns:
    - "KPI grid ladder on a separate @container host (KpiPanel precedent): 2 columns, 3 from @md (28rem), full row from @5xl (64rem)"

key-files:
  created:
    - .planning/phases/170-pagecopy/deferred-items.md
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
    - e2e/layout-narrow.spec.ts

key-decisions:
  - "Item (j): the factsheet KpiStrip grid base is grid-cols-2 @md:grid-cols-3; break-words and the label clip stay; no border change was needed because every cell carries its own right and top hairline"
  - "Item (b): SectionNav is not the cause at 20895bcc, run 36755290085. main=0 on every offender line rules out normal-flow factsheet markup; the composed-scenario page does overflow at the document, and that overflow is unattributed because the census walker cannot name a descendant of #main-content. No FactsheetView change."
  - "The no-bare-base pin arm is whitespace-anchored, because \\bgrid-cols-3\\b also matches @md:grid-cols-3"
  - "N-KPI asserts the tiles before assertNoReflow, so a red reflow does not hide whether the tiles themselves read cleanly"

patterns-established:
  - "N-KPI: label scrollWidth <= clientWidth and value height <= 1.3 x computed line-height, measured over visible tiles with a count > 0 guard"

requirements-completed: ["(j)", "SC2-(b)", "SC2-NOSCROLL"]

coverage: []

duration: 6 min
completed: 2026-09-30
status: complete
---

# Phase 170 Plan 11: Factsheet KPI ladder Summary

**The factsheet KPI strip now uses two columns below a 28rem container, three up to 64rem, then the full row. A held-out N-KPI e2e describe checks it. Item (b) is not caused by SectionNav at this SHA, but the page that mounts it still overflows at the document, and the census tool cannot name what overflows.**

This replaces the 2026-09-27 halt record. That run stopped at the Phase 169 gate with `NOT_REBASED`. This re-run was rebased onto origin/main (merged in at `aa4e5a36f`) and the gate is green.

## Performance

- **Duration:** about 6 min of execution, plus the census read
- **Started:** 2026-09-30T18:48:08Z
- **Completed:** 2026-09-30T18:54Z
- **Tasks:** 3 of 3
- **Files modified:** 3 source files, 1 planning file created

## Task 1: gate, re-read, census

### Gate

The gate is the amended, pipe-free command in the plan's verify block. It ran at HEAD `74a64cc85` after `git fetch`, with origin/main at `25182655c`, which is an ancestor of HEAD:

```
169 169-04 src/app/factsheet/[id]/v2/FactsheetView.tsx 3357a2eb5824c0f5f4381beff348f942a5680f7a
169 169-05 src/app/factsheet/[id]/v2/MetricsColumn.tsx f1ca32b560743cc8c2011bb5198391b192a0d93d
169 169-10 DESIGN.md 3357a2eb5824c0f5f4381beff348f942a5680f7a
PAGETRUTH_ON_MAIN_OK
```

Phase 169.1 (ZOOMKPIS, including plan 02, which also edits FactsheetView.tsx) is on origin/main. The 169.3 merge `25182655c` lists `169.1-01..09` in its body. The strings below were read at a HEAD that contains it.

### Class strings re-read at HEAD 74a64cc85, before any edit

| Element | Class string |
|---|---|
| KpiStrip `@container` host (`<section>`) | `mt-6 overflow-hidden @container` (border inline) |
| KpiStrip grid | `` grid grid-cols-3 ${containerCols} @5xl:divide-y-0 ``, `containerCols` = `@5xl:grid-cols-9` (9 cells) / `@5xl:grid-cols-7` (7 cells) |
| KPI cell | `px-3 py-3 sm:px-4 sm:py-4 min-w-0`, inline `borderRight` + `borderTop` on every cell |
| KPI label | `text-micro font-mono uppercase tracking-[0.14em] sm:tracking-[0.18em] whitespace-nowrap overflow-hidden text-ellipsis` |
| KPI value | `mt-1.5 sm:mt-2 font-mono tabular-nums text-h2 leading-tight break-words` |
| SectionNav `<nav>` | `factsheet-v2-no-print mt-4 -mx-1 overflow-x-auto` |
| SectionNav `<ul>` | `flex items-center gap-1 px-1 text-micro font-mono uppercase tracking-[0.18em]` |

Pins in `FactsheetView.kpistrip.test.tsx` at HEAD: Test 1 `toMatch(/\bgrid-cols-3\b/)`; Test 2 value `break-words`, label `whitespace-nowrap` and `text-ellipsis`.

### Census source, bound to a SHA

- **Head SHA:** `20895bcc25ebf1a2e8c31375f262c2eb12fc4bc7` (draft PR #910). It contains plans 170-01 to 170-10.
- **Runs for that SHA:** 2 (`gh api "repos/AI-Isaiah/Quantalyze/actions/runs?head_sha=20895bcc…"`). `Contracts` 36755289869 completed success; `CI` **36755290085**, still `in_progress` when read, so the run as a whole had no conclusion yet.
- **Job:** `e2e-seeded` **110024318330**, `completed`, conclusion `failure`, head_sha matches, completed 2026-09-30T18:39:01Z. Totals: 14 failed, 1 flaky, 11 skipped, 180 passed.
- **Census-tool limitation:** every `LAYOUT-NARROW-OFFENDER` line prints `offender=<unknown>` with `main=0`. The walker marks every descendant of `#main-content` as contained, because `main` is `overflow-y-auto` (computed `overflow-x: auto`) and inside the viewport. So it cannot name a box that escapes `main` onto the document. Rows are classified by row and page below. No owner is invented from the breadcrumb. Logged in `deferred-items.md` #1.

### Census table (run 36755290085, job 110024318330, head 20895bcc)

The job uses the dot reporter, so passing tests are not named. "Pass" means listed by `--list` and absent from the failed and flaky lists. The 11 job-wide skips cannot be attributed per test. The N-SCN V960 record line and the N-TWEAKS rows show that composed mode was reached. Offender readings are the doc values over the three attempts.

| Viewport | Row | Result | Offender breadcrumb / failure | Owner |
|---|---|---|---|---|
| V390 | composed scenario — N-FOOT | FAIL | reflow `main=0 doc=472..487`, `<unknown>` | composed-scenario page; unattributed (deferred #2, likely 170-04) |
| V640 | composed scenario — N-FOOT | FAIL | reflow `main=0 doc=216..223`, `<unknown>` | same |
| V960 | composed scenario — N-FOOT | FAIL | reflow `main=0 doc=180..184`, `<unknown>` | same |
| V390 | constituent rows — N-SCN | FAIL | reflow `main=0 doc=468..481`, `<unknown>` | same |
| V640 | constituent rows — N-SCN | FAIL | reflow `main=0 doc=209..222`, `<unknown>` | same |
| V960 | constituent rows — N-SCN (record only) | ran | `scrollWidth=853 clientWidth=554 scrolls=true` | not asserted |
| V390 / V640 / V960 | Tweaks — N-TWEAKS | pass | — | — |
| V390 | allocations tab strip — SC2-(a) | pass | — | — |
| V640 | allocations tab strip — SC2-(a) | FAIL | tablist does not scroll inside itself (`scrollWidth=264 clientWidth=264`): it fits, and the row asserts it must scroll | 170-03 (outside the factsheet) |
| V960 | allocations tab strip — SC2-(a) | FAIL | tablist top 696 vs Export row 709 (13 > 8) | 170-03 (outside the factsheet) |
| V390 | /profile — SC2-PROFILE | pass | — | — |
| V640 | /profile — SC2-PROFILE | FAIL | Disconnect box y=439 is below the 640x400 viewport | 170-08 (outside the factsheet) |
| V390 / V960 | /strategies — N-STRAT | pass | — | — |
| V640 | /strategies — N-STRAT | FAIL | name block 142 px < 160 | 170-05 (outside the factsheet) |
| V390 / V640 | /my-strategies — N-TABLE | FAIL | `a[href="/my-strategies"]` not visible (spec line 483), before any Sort assertion | 170-05 (outside the factsheet); why the anchor is hidden is not read from this log |
| V960 | /my-strategies — N-TABLE | pass | — | — |
| V390 | /admin/match — N-MATCH | FAIL | no `h1` found (spec line 538) | 170-06 / seed or route (outside the factsheet) |
| V960 | /admin/match — N-MATCH | FAIL | no `h1` found (spec line 560) | same |
| V390 | /compare — N-CMP (both rows) | pass | — | — |

**Factsheet-owned offenders (this plan): none named.** The only rows whose page mounts `FactsheetBody` are the composed-scenario rows. Their overflow is document-level with `main=0`. `KpiStrip` and `SectionNav` are normal-flow blocks inside `main`, and a normal-flow overflow there would raise `main` above 1. So that markup is ruled out, and no replacement owner is named from this log.

**Not layout-narrow, reported rather than fixed:**

- `target-size.spec.ts` EquityChart tap-rect @ 320px on /allocations: FAIL, `locator.scrollIntoViewIfNeeded: Element is not attached to the DOM`. The element re-rendered under the locator. Not factsheet-owned.
- `composite-factsheet-render.spec.ts` composite factsheet zero axe violations: FLAKY, passed on retry. The violation was `page-has-heading-one` (moderate) on `html`, which looks like a check taken before the heading mounted. It is on a factsheet route but is not a layout offender. Reported to the orchestrator.
- The frontend-test shard failure is already fixed by the orchestrator in `74a64cc85`.

## Task 2 (tracer): KPI ladder

- **Pin updated** (`FactsheetView.kpistrip.test.tsx` Test 1, dated comment for Phase 170 (j), superseding the Phase 52-06 three-column base). It now asserts `\bgrid-cols-2\b`, contains `@md:grid-cols-3`, and does not match `(^|\s)grid-cols-3(\s|$)`. The last arm is anchored on whitespace because `\bgrid-cols-3\b` also matches `@md:grid-cols-3`. The `break-words` and label `whitespace-nowrap` pins are unchanged.
- **RED at HEAD 74a64cc85:** `expected 'grid grid-cols-3 @5xl:grid-cols-7 @5x…' to match /\bgrid-cols-2\b/`, 1 failed / 19 passed.
- **Fix:** grid base `grid grid-cols-2 @md:grid-cols-3 ${containerCols} @5xl:divide-y-0`. The `@container` host stays a separate `<section>`. `break-words` and the label clip are unchanged. `data-testid="factsheet-kpi-label"` / `"factsheet-kpi-value"` were added for the e2e.
- **Hairlines:** no border change was needed. Every cell carries its own inline right and top hairline whatever the column count, so the odd last cell in the 2-column layout (7 cells) keeps both without a filler cell.
- **Breakpoint arithmetic:** `--container-md: 28rem` (448 px) and `--container-5xl: 64rem`, from `node_modules/tailwindcss/theme.css`. At V390 the strip is about 358 px wide, so it gets 2 columns. The ~326 px composer mount also gets 2. At V640 it is about 592 px, so it gets 3.
- **GREEN:** 20 passed. `grep -c 'grid-cols-2 @md:grid-cols-3'` = 1. `break-words` count 2, equal to HEAD.
- **Neuter 1** (three-column base restored from a `cp` byte backup): RED with the same message; restored and verified by grep `grid-cols-2 @md:grid-cols-3` = 1.
- **Neuter 2** (a bare `grid-cols-3` added beside the ladder): RED `not to match /(^|\s)grid-cols-3(\s|$)/`; restored; 20 passed.
- **N-KPI describe:** `factsheet KPI — N-KPI` in `e2e/layout-narrow.spec.ts`, FLOW-01 skip-guarded like its siblings, with its own prefix cleanup. It has 4 tests: V390 and V640 × (composed scenario, published factsheet `/factsheet/<seeded>/v2` anchored on `#factsheet-main`). Each test checks, over visible tiles with a count > 0 guard, that every label has `scrollWidth <= clientWidth` and every value has `height <= 1.3 × computed line-height`. It then runs `assertNoReflow` last. `CI=1 npx playwright test --list` prints 4 N-KPI rows (28 tests in the file).
- **Expected CI result:** the published-factsheet N-KPI rows and the tile assertions of the composed rows should be GREEN. The composed rows' final `assertNoReflow` stays RED until deferred #2 (document overflow on the composed scenario) is closed. This is the same overflow that fails N-FOOT and N-SCN, and it is not a KPI defect.
- **Tracer gate:** both `<verify>` commands were re-run after the commit: vitest 20 passed, `--list` N-KPI count 4.

## Task 3: item (b) verdict

**Item (b): not caused by SectionNav at `20895bcc`, run `36755290085`, job `110024318330`.** No code change.

- The census names no offender in `FactsheetView.tsx`.
- Every offender line on the composed scenario reads `main=0`. SectionNav is a normal-flow `<nav>` inside `main`, and it is a bounded `overflow-x-auto` block (contained scroll). If it overflowed, `main` would read above 1.
- **This is not a clean page.** The composed-scenario page that mounts SectionNav overflows at the document at every viewport. That overflow is **unattributed**, because the walker cannot name a descendant of `#main-content` (deferred #1). It is routed to the orchestrator as deferred #2. The likely cause is the `sr-only` labels in the constituent rows, which escape `ResponsiveTable`. That is a hypothesis and was not measured.
- `overflow-x-hidden` count in `FactsheetView.tsx`: 0 before, 0 after.
- Verify: `npx vitest run "src/app/factsheet/[id]/v2/"` gave 59 files, 561 tests passed.

## Verification

- Gate: `PAGETRUTH_ON_MAIN_OK`, exit 0.
- `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx"`: 20 passed.
- `npx vitest run "src/app/factsheet/[id]/v2/"`: 561 passed.
- `npx vitest related --run "src/app/factsheet/[id]/v2/FactsheetView.tsx"`: 51 files, 1038 tests passed. This covers the composer and ScenarioFactsheetChart consumers.
- `npx tsc --noEmit -p .`: clean. `npx eslint` on the three touched files: clean.
- **Not run here:** the CI `e2e-seeded` N-KPI and composed-scenario rows. Seeded e2e is CI-only, and the orchestrator controls pushes. No push was made.

## Deviations from Plan

1. **[Rule 3 - Blocking] Test hooks added.** The KPI tiles had no stable selector, so `data-testid="factsheet-kpi-label"` and `"factsheet-kpi-value"` were added in `FactsheetView.tsx`, which is in scope. The kpistrip test's className-based grid finder is unaffected. Commit `eb92ba0f2`.
2. **Item (b) verdict wording.** The plan's canned "not reproduced (contained scroll)" was not used on its own. The page that mounts SectionNav does overflow, so the verdict says SectionNav is not the cause and that the residual overflow is unattributed and routed.
3. **Branch namespace.** Commits are on `feat/170-layout`, in a worktree the orchestrator designated. That is outside the executor's `agent-*` pattern and is recorded here, not treated as a halt.

## Known Stubs

None.

## Threat Flags

None. Only grid columns and two `data-testid` attributes changed. The census copies viewport, row, doc values and failure text only. No fixture names, ids, emails, or log-line UUIDs are copied (T-170-29).

## For plans 170-12 / 170-13 and the orchestrator

- **Orchestrator:** deferred #1 (the walker cannot name descendants of `#main-content`, in `e2e/helpers/reflow.ts`) and deferred #2 (the unattributed composed-scenario document overflow; N-FOOT and N-SCN fail at their first reflow, so 170-04's footer assertions were not measured in that run).
- **Outside the factsheet, per row:** SC2-(a) V640/V960 (170-03), SC2-PROFILE V640 (170-08), N-STRAT V640 (170-05), N-TABLE V390/V640 `a[href="/my-strategies"]` not visible (170-05), N-MATCH missing `h1` (170-06).
- **Non-layout:** target-size EquityChart @320 on /allocations (element detached) and the composite-factsheet axe flake (`page-has-heading-one`).
- **170-13:** nothing in this census names `MetricsColumn.tsx`, the table panels or `HeatmapPanels.tsx`.

## Commits

- `16e5cd8a6` test(170-11): pin the factsheet KPI ladder at grid-cols-2 @md:grid-cols-3
- `eb92ba0f2` feat(170-11): factsheet KPI strip follows a 2 / 3 / full container ladder

## Self-Check: PASSED

- FOUND: src/app/factsheet/[id]/v2/FactsheetView.tsx, FactsheetView.kpistrip.test.tsx, e2e/layout-narrow.spec.ts, .planning/phases/170-pagecopy/deferred-items.md
- FOUND: commits 16e5cd8a6, eb92ba0f2
