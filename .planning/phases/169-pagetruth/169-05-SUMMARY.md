---
phase: 169-pagetruth
plan: 05
subsystem: factsheet
status: complete
tags: [factsheet, record-length, return-windows, metrics-column, scenario, SC5, SC6, SC9]
requires:
  - phase: 169-pagetruth (plan 04)
    provides: "compute() p6m / p1y / p3y / p5y are null when the record does not cover the window"
  - phase: 167.1.2 (plan 07, PR C2 on origin/main)
    provides: "MetricsColumn warning on payload.periodsPerYear and MetricsColumn.periods-per-year.test.tsx"
provides:
  - "formatRecordLength({ n, years }) in src/lib/factsheet/record-length.ts, the one record-length phrasing"
  - "MetricsColumn: Years Observed and the warning state calendar years through the formatter"
  - "CumulativeReturnsPanel: 3 Year / 5 Year rows from compute()'s p3y / p5y, omitted when absent or null; the index-clamped look-back deleted"
  - "6 Month / 1 Year rows omitted when the strategy window is null, in Cumulative Return Metrics AND Returns, on the factsheet and the scenario mount"
  - "MandatePanels: thesis parenthesis and Sample size Term through the formatter"
affects:
  - "169.5-03 (edits MandatePanels.tsx's comparator sentence and Bench frequency Term after this plan)"
  - "169.5-04 (pads comparator dailyReturns and guards MetricsColumn's EoY loop; gated on formatRecordLength being on origin/main)"
  - "169-06 (browser re-check: no 6M / 1Y / 3Y / 5Y row for a shorter record on the factsheet and /allocations?tab=scenario, 390px and desktop 200%)"
tech-stack:
  added: []
  patterns:
    - "a period row renders only when the strategy's compute() window is non-null (`m.pXX != null && <Row …/>`); a bench null never removes a row"
    - "record length is formatted once (calendar years + daily observations), never derived from the observation count"
key-files:
  created:
    - src/lib/factsheet/record-length.ts
    - src/lib/factsheet/record-length.test.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/MandatePanels.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
key-decisions:
  - "formatRecordLength returns { years, observations, text } so every site calls the one function: Years Observed shows `years`, the thesis and the Sample size Term show `text` (\"1.20 years, 166 daily observations\")"
  - "The Main Metrics warning keeps 167.1.2's sentence shape `Only {n} observations ({years}y)` with `years` from the formatter: the calendar figure is what changed. Changing the words too would have broken the two 365-basis assertions in 167.1.2's test (which already agree with the calendar) and gone past D-51's single-assertion allowance"
  - "D-51 touched TWO assertions, not one: HEAD has two 252-basis `(0.79y)` literals (the factsheet case and the scenario-default case). Both moved to the calendar 0.54y inside the plan's 5-line diff cap"
  - "FactsheetBody.basis.test.tsx Finding C (Phase 103) pinned the deleted equity-curve look-back. Its MTM sentinel moved from the equity curve to the bundle's p3y, so the test still proves the rows follow the active basis (neutered: RED when the panel reads the cash summary)"
patterns-established:
  - "omit, do not em-dash, a period row whose window the record does not cover; em-dash only a statistic that is undefined for another reason"
requirements-completed: [SC5, SC6, SC9]
coverage:
  - id: D1
    description: "One record-length formatter (calendar years plus daily observations, em-dash on non-finite)"
    requirement: SC5
    verification:
      - kind: unit
        ref: "src/lib/factsheet/record-length.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Years Observed and the Main Metrics warning state the same calendar years; a sparse record no longer reads short"
    requirement: SC5
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx#a SPARSE record (166 observations over 1.20 calendar years)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "3 Year / 5 Year rows read compute()'s p3y / p5y and are absent for a shorter record"
    requirement: SC6
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx#Cumulative Return Metrics: 3 Year / 5 Year rows exist only when the record covers them (D-17)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx#Finding C"
        status: pass
    human_judgment: false
  - id: D4
    description: "6 Month / 1 Year rows absent for a shorter record in both return panels, on the factsheet and the scenario mount"
    requirement: SC6
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Thesis sentence and Sample size Term on the formatter"
    requirement: SC5
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx#MandatePanels state the record length through formatRecordLength (D-12)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The rendered rail at 390px and desktop 200% zoom after deploy (no orphaned layout where rows are omitted)"
    verification: []
    human_judgment: true
    rationale: "Visual layout on the deployed page is 169-06's post-deploy browser item; no unit test measures it"
duration: "24 min"
completed: 2026-09-29
actuals:
  tokens: 10350
  tasks: 3
  commits: 3
plan_head_before: 696dc524b1d141547cf2a42b6216b7aca70feeb5
plan_head_after: 738eee793616c496d7b76b544adcf0476dec03e1
---

# Phase 169 Plan 05: record length stated once, and no period row outruns the record — Summary

**The factsheet states a record's length one way (calendar years plus daily observations, from one formatter), and the 6 Month, 1 Year, 3 Year and 5 Year rows are omitted in both return panels, on the factsheet and the scenario mount, when the record is shorter than the period.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-29T16:52:56Z
- **Completed:** 2026-09-29T17:17:40Z
- **Tasks:** 3 of 3
- **Files:** 8 (4 created, 4 modified)

## Precondition (Task 1) and HEAD shape

`git fetch origin main --quiet && git cat-file -e 'origin/main:src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx' && test -f 'src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx'` → **exit 0**. HEAD was `696dc524b`, origin/main `81606e01a`, and origin/main is an ancestor of HEAD.

HEAD shape before any edit, re-resolved by symbol:
- **Main Metrics warning.** `obsPerYear` is `payload.periodsPerYear` when it is a positive finite number, otherwise undefined. The condition is `obsPerYear != null && m.n < obsPerYear`. The stated length was `(m.n / obsPerYear).toFixed(2)`, and 167.1.2's threshold sentence reads "Conventional reliability threshold is ≥ {obsPerYear} observations (1 year)." C3's shape matched the plan and absorbed cleanly.
- **Years Observed.** It was `m.years.toFixed(2)`, which was already the calendar value.
- **`CumulativeReturnsPanel`.** The MTD / 3M / 6M / YTD / 1Y rows read `view.strategyMetrics`. The 3 Year / 5 Year rows used the local look-back `periodReturn(3 * 252)` / `periodReturn(5 * 252)` over `view.strategyEquity`, clamped at index 0.
- **Returns panel (Main Metrics section).** Its 6 Month / 1 Year rows carry `pct(b?.p6m, true)` / `pct(b?.p1y, true)` as the bench cell.

## Accomplishments

- **Task 1 (tracer).** New `formatRecordLength({ n, years })`. Years Observed and the warning now state the same calendar years. A sparse 166-point record spread over 1.20 calendar years used to read "(0.45y)" in the warning and now reads "(1.20y)". The threshold condition and 167.1.2's threshold sentence are unchanged.
- **Task 2.** The 3 Year / 5 Year rows read `m.p3y` / `m.p5y` and are omitted on `== null`, so an absent key and a null value both hide the row. The index-clamped look-back and its `eq` / `n` / `last` locals are deleted. The thesis parenthesis and the Sample size Term go through the formatter ("trading days" is gone).
- **Task 3.** The 6 Month / 1 Year rows are omitted on the STRATEGY's null window in `CumulativeReturnsPanel` and in the Returns panel. The rule holds on the scenario mount too. A null bench value keeps its row with an em-dash in the bench cell. Year-to-date keeps its em-dash.

## Task Commits

1. **Task 1 (tracer): one record-length formatter, through Years Observed and the warning, with D-51.** `217af15f6` (fix). Tracer gate (auto mode, row 2): after the commit the task `<verify>` was re-run end to end and gave `Test Files 6 passed (6)`, `Tests 39 passed (39)`, exit 0. Tracer verified end-to-end, then expanded.
2. **Task 2: 3 Year / 5 Year rows on calendar windows, omitted when shorter; MandatePanels on the formatter.** `8cd75cc79` (fix)
3. **Task 3: 6 Month / 1 Year rows omitted in both panels, factsheet and scenario (D-57).** `738eee793` (fix)

Each task's tests and implementation share one commit. The RED run on the pre-change code is recorded below. The plan is `type: execute` and `workflow.tdd_mode` is false, so the plan-level RED-commit gate does not apply. This is the same shape as 169-04's deviation 4.

## Files Created/Modified

- `src/lib/factsheet/record-length.ts`: the formatter. Its header states the unit contract: calendar `years` only, `n` as a count, and the em-dash on non-finite values.
- `src/lib/factsheet/record-length.test.ts`: literal-oracle cases (the 0.45 dense case, the 1.20 sparse case, singular, thousands separator, non-finite years, non-finite count).
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx`: formatter at Years Observed and in the warning; 3Y / 5Y / 6M / 1Y row gates; the look-back is deleted; dated D-17 / D-57 lineage lines.
- `src/app/factsheet/[id]/v2/MandatePanels.tsx`: the thesis parenthesis and the Sample size Term only. The comparator sentence and the Bench frequency Term are untouched (they belong to 169.5-03).
- `src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx`: Task 1 and Task 2 pins.
- `src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx`: D-57 pins on the factsheet mount and the scenario mount, one test per panel.
- `src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx` (owned by 167.1.2): the D-51 edit. See "Cross-phase edits".
- `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx` (owned by Phase 103): the Finding C sentinel moved. See Deviations.

## Cross-phase edits (Phase 167.1.2's work)

**One 167.1.2-owned file was touched: `src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx` (D-51).** No other 167.1.2 file was edited. No D-57 row-omission assertion existed in any 167.1.2 test, so Task 3 step 3's exception was not needed. `scenario-factsheet-payload.ts` and `scenario-factsheet-payload.empty-render.test.tsx` were read only (`git diff --name-only 696dc524b -- "src/app/(dashboard)"` is empty).

The plan said the file held ONE observation-clock length assertion. HEAD has two `(0.79y)` literals, both in 252-basis cases: the factsheet "a 252 book with 200 observations" case and the scenario "no basis argument uses its own 252 default" case. Both moved to the calendar length of their own fixture dates: 199 days / 365.25 = 0.5448, so 0.54y. The two 365-basis `(0.82y)` assertions already equal the calendar length (299 / 365.25 = 0.8186) and are byte-identical. Every threshold assertion is unedited and green. The diff was measured before the commit with the criterion's own command and gave a count of 5 (at most 5):

```diff
@@ -120 +120,2 @@ describe("MetricsColumn observation warning follows payload.periodsPerYear (SC-5
-    expect(w).toContain("Only 200 observations (0.79y)");
+    // 2026-09-27, Phase 169 D-12 / D-51: record length is stated in calendar years; the threshold assertion below is 167.1.2's and unchanged.
+    expect(w).toContain("Only 200 observations (0.54y)");
@@ -149 +150 @@ describe("the Scenario surface's payload carries its basis to MetricsColumn (W2)
-    expect(w).toContain("Only 200 observations (0.79y)");
+    expect(w).toContain("Only 200 observations (0.54y)"); // Phase 169 D-12 / D-51: calendar years, as above
```

167.1.2's own CONTEXT is on another branch and outside this plan's write scope. This section and the ROADMAP note the orchestrator adds are the record.

## Panels `FactsheetBody` renders under `scenarioMode`

`FactsheetBody` mounts `MetricsColumnWithBasis`, which mounts `MetricsColumn scenarioMode`. `scenarioMode` hides no return panel. Both "Cumulative Return Metrics" and "Returns" (with "Compound Performance" and "Main Metrics") render on the scenario mount, and the new test's `section()` lookup found both. The lookup throws if a panel is missing. `scenarioMode` only adds the scenario-specific Peer / Own-book / Mandate panels. The degenerate scenario payload (`emptyComputeSummary`) sets `p6m` / `p1y` to NaN, not null, so a blend with no observations keeps those rows as em-dashes, which is 166.2 D7's "undefined for another reason". The existing empty-render test is green.

## SC9 evidence (RED first; neuter = cp backup, hand-revert, RED, restore, cmp, GREEN)

**Task 1 pre-change RED.** Run on HEAD code: `Tests 1 failed | 3 passed (4)`. The failing test is "a SPARSE record (166 observations over 1.20 calendar years): both sites state 1.20, never 166 / 365 = 0.45", with `expected '⚠ Only 166 observations (0.45y) — Sha…' to contain 'Only 166 observations (1.20y)'`. `record-length.test.ts` failed to import because the module did not exist yet. That is not a behavioural RED, so the formatter neuter below is its bite proof.

**Task 1 neuter (warning back on the observation clock, `(m.n / obsPerYear).toFixed(2)`).** `Tests 3 failed | 36 passed (39)`. Failing: the sparse case, plus the two D-51 assertions, which read "(0.79y)" again. Restored, `restored cmp OK`, `39 passed`.

**Task 1 formatter neuter (years from the count, `(n / 365).toFixed(2)`).** `Tests 2 failed | 4 passed (6)`. Failing: "never computes years from the count" and "a non-finite count is the em-dash". Restored, `cmp` OK, `6 passed`.

**Task 2 pre-change RED.** `Tests 7 failed | 4 passed (11)`. Failing: the 0.45-year case, the 800-point case, the ABSENT-keys case, the 4-year case (`'+3.24%'` vs p3y `'-6.95%'`), the 6-year case (`'-9.23%'` vs `'+0.36%'`), the non-finite-p3y case, and the thesis / Sample size case.

**Task 2 neuter A (3 Year row unconditional, em-dash on null).** `Tests 3 failed | 8 passed (11)`. Failing: the 0.45-year case, the 800-point case, and the ABSENT-keys case. Restored, `cmp` OK.

**Task 2 neuter B (3 Year reads `m.cum_ret`).** `Tests 3 failed | 8 passed (11)`. Failing: the 4-year case, the 6-year case, and the non-finite-p3y case. Restored, `cmp` OK, `11 passed`.

**Finding C neuter (CumulativeReturnsPanel reads `usePayload().strategyMetrics`, the cash summary).** `Tests 1 failed | 36 passed (37)`, and the failing test is Finding C. Restored, `cmp` OK, `37 passed`.

**Task 3 pre-change RED.** `Tests 5 failed | 4 passed (9)`. Failing: "a 100-day record: Cumulative Return Metrics has no 6 Month and no 1 Year row", "a 100-day record: the Returns panel has no 6 Month and no 1 Year row", "the gate reads the STRATEGY window…", "a 100-day blend: Cumulative Return Metrics has no 6 Month, 1 Year, 3 Year or 5 Year row…", and "a 100-day blend: the Returns panel has no 6 Month and no 1 Year row". Every one failed on `expected [...] to not include '6 Month'`.

**Task 3 neuter A (Cumulative 6 Month unconditional).** `Tests 2 failed | 7 passed (9)`. Failing: the factsheet Cumulative short case and the scenario Cumulative short case. Restored, `cmp` OK.

**Task 3 neuter B (gate removed from the Returns panel only).** `Tests 3 failed | 6 passed (9)`. Failing: the factsheet Returns short case, the strategy-gate case, and the scenario Returns short case. Both Cumulative short cases stayed green, so the two panels are pinned separately. Restored, `cmp` OK, `9 passed`.

## Verification (exact output, run by the executor on the committed tree at `738eee793`)

- `npx tsc --noEmit -p .` → no output, `tsc exit=0`
- `npm run lint` → `lint exit=0`. The output included `[check-admin-route-manifest] OK — 20 admin routes`, `[check-route-contract] OK — 58 page routes`, and `[check-planning-hygiene] OK — 7814 tracked files scanned`.
- `npx vitest run src/lib/factsheet/record-length.test.ts "src/app/factsheet" src/lib/factsheet "src/app/(dashboard)/allocations/widgets/performance"` → `Test Files 94 passed (94)`, `Tests 1258 passed (1258)`, exit 0
- Task 1 verify → `Test Files 6 passed (6)`, `Tests 39 passed (39)`
- Task 2 verify: `npx vitest run "src/app/factsheet/[id]/v2" src/lib/factsheet` was green after the Finding C fix (`37 passed` in that file). tsc exit 0.
- Task 3 verify: `npx vitest run "src/app/factsheet/[id]/v2/MetricsColumn" "src/app/(dashboard)/allocations/widgets/performance"` → `Test Files 22 passed (22)`, `Tests 223 passed (223)`, exit 0
- `npm test` (full), Task 2: `2 failed | 17349 passed | 292 skipped`. Task 3: `1 failed | 17359 passed | 292 skipped`. The failures are all load-sensitive timeouts in CI-script contract tests that this plan does not touch. `ci-anti-skip-gate.contract.test.ts` failed "refuses a handoff whose DB_URL is not loopback…" at 10.8s, which is the same flake 169-04 recorded; it passed in isolation. `lint-sql-gates.test.ts` failed "every EVENT-tolerated skip is CONDITIONED on the event…" at 5.2s and 6.2s under load; run alone it passed in 1.76s. This plan's diff touches no `.github/` or `scripts/` file. Neither failure was fixed.

Acceptance criteria:
- T1: `formatRecordLength` in MetricsColumn = 2 (≥1). The non-comment `m.n / (252|periodsPerYear|payload.periodsPerYear)` count = 0, and any `n / obsPerYear` = 0. D-51 diff count = 5 (≤5), measured before the commit.
- T2: non-comment `periodReturn` = 0. `p3y` lines = 1 (≥1). Strict `p[35]y (!==|===) null` = 0. `trading days` in MandatePanels = 0. `formatRecordLength` in MandatePanels = 3 (≥2).
- T3: loose `p(6m|1y) [!=]= null` = 4 (≥2; no helper was hoisted). Strict = 0. `buildScenarioFactsheetPayload` in the new test = 3 and `scenarioMode` = 2. The `git diff --name-only` of `scenario-factsheet-payload.ts` is empty.

## Decisions Made

See `key-decisions` in the frontmatter. The main one is the warning's wording. D-12 asks for "daily observations", but the warning keeps 167.1.2's "Only N observations (X.XXy)" shape. The calendar figure comes from the formatter, and the count is the same `n`, so the length is on one clock everywhere. Rewording the sentence would have forced edits to the two 365-basis assertions, which already agree with the calendar. That is past D-51's allowance. The count's noun in the warning is the one wording difference that remains. The thesis sentence and the Sample size Term say "daily observations". The rail's Years Observed row is labelled in years and shows only the years figure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test pinned the deleted mechanism] Phase 103 Finding C in `FactsheetBody.basis.test.tsx`**
- **Found during:** Task 2, while running the Task 2 verify
- **Issue:** Finding C proved "the 3Y/5Y rows follow the MTM basis" by mangling the MTM bundle's equity curve (`6.54 / 1 - 1 = +554.00%`), which fed the deleted index look-back. With the rows on `m.p3y` and a 300-day fixture, the row is correctly absent, and the test went RED on the intended change.
- **Fix:** The sentinel moved from the equity curve to the MTM bundle's `strategyMetrics.p3y = 5.54` (+554.00%). The mangled `strategyEquity` line is removed because its only purpose is gone. The test title and comments now say "basis", not "equity curve", with a dated lineage comment. Its intent is unchanged: under cash the row is absent, and under MTM it shows the bundle's p3y.
- **Bite proof:** the Finding C neuter above (RED when the panel reads the cash summary).
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx` (Phase 103's; not a 167.1.2 file)
- **Committed in:** `8cd75cc79`

**2. [Anchor drift] D-51 covers two assertions, not one.** Recorded under "Cross-phase edits". It stays within the plan's ≤5-line diff criterion.

---

**Total deviations:** 1 auto-fixed (Rule 1), plus 1 anchor drift. **Impact:** there is no scope creep. The Finding C move keeps a Phase 103 basis pin alive on the new source.

### Environment notes (not deviations)
- The orchestrator pre-created the worktree's `node_modules` as a symlink to a sibling worktree's `node_modules`, and `require.resolve('vitest')` resolved. It is gitignored (`/node_modules`). It was removed before each commit and re-created afterwards, and never staged. No pre-commit hook is installed; only pre-push.
- The branch is `feat/169-pagetruth`, assigned by the orchestrator, so the generic executor's `agent-*` allow-list was not applied. The `<project_root_pin>` guard and the protected-branch check passed before every commit.

## Issues Encountered

- Two load-sensitive full-suite flakes, recorded under Verification. `deferred-items.md` was not created, because sibling plan 169-07 writes to the same phase directory concurrently.
- Observation, not changed: a payload cached before 169-04 has no `p3y` / `p5y` key, so on a long record the 3 Year / 5 Year rows are hidden until the cache recomputes. That is the D-17 lineage contract (an absent key hides the row); it shows nothing rather than something wrong.

## User Setup Required

None.

## Next Phase Readiness

- 169.5-03 can edit MandatePanels' comparator sentence and Bench frequency Term. This plan touched neither.
- 169.5-04's gate is met in this branch: `formatRecordLength` is in HEAD. It still needs origin/main after Phase 169 merges.
- 169-06's browser item: check the omitted rows on a sub-six-month factsheet and a sub-six-month `/allocations?tab=scenario` blend, at 390px and desktop 200% zoom.

## Known Stubs

None.

## Threat Flags

None. There is no new endpoint, auth path, file access or schema change. T-169-23 and T-169-23b are mitigated by the gates, the deleted look-back, and four neuters. T-169-24 is mitigated by the precondition, the by-symbol re-read, and the measured 5-line D-51 diff.

## Self-Check: PASSED

- All four created files exist and all four modified files carry the changes.
- Commits `217af15f6`, `8cd75cc79` and `738eee793` are present in `git log`.
- `commits: 3` was measured with `git rev-list --count 696dc524b..HEAD`.
- STATE.md and ROADMAP.md were not modified.
