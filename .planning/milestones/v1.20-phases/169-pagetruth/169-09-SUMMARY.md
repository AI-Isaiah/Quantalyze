---
phase: 169-pagetruth
plan: 09
subsystem: ui
tags: [react, recharts, vitest, units, portfolio-analytics]

requires:
  - phase: 166.1
    provides: "D7 null risk-share arms in RiskAttribution (kept)"
provides:
  - "RiskAttribution renders the producer's percent (0 to 100) once, unsigned, 1 dp, via one percentToFraction conversion"
  - "The stacked bar plots the same fraction the table formats; axis [0, 1] and tooltip x100 agree with the table"
  - "RiskDecompositionRow documents marginal_risk_pct and weight_pct as percent 0 to 100"
  - "RiskAttribution.test.tsx built from the adapter's complete.json producer fixture, with a prop-capturing recharts mock"
affects: ["169-06 browser re-check of /portfolios/[id] risk decomposition", "170.1 standalone_vol copy"]

actuals:
  tokens: 3540
  tasks: 2
  commits: 3
plan_head_before: e9c1caafa9650ff81eec4173340e304f593a34fe
plan_head_after: 1c7ff3f2cc41b600ff2e9b9e1f6e598443c4d87f

tech-stack:
  added: []
  patterns:
    - "Convert a producer's unit at the one wrong consumer, not at the adapter boundary"
    - "vi.hoisted capture arrays in a vi.mock factory so a no-layout recharts mock still exposes BarChart / XAxis / Tooltip props"

key-files:
  created: []
  modified:
    - src/components/portfolio/RiskAttribution.tsx
    - src/components/portfolio/RiskAttribution.test.tsx
    - src/lib/types.ts

key-decisions:
  - "Unit choice for the chart (Task 2): plot the converted FRACTIONS, keep XAxis domain [0, 1] and keep the tooltip's existing x100. One conversion feeds both the table and the bar, so the bar cannot drift from the table; the tooltip line is unchanged."
  - "The Assessment compare stays on the raw percent values (percent against percent); Standalone Vol is left exactly as it was (D-49)."

patterns-established:
  - "Producer-shape pins: component tests read the adapter's fixture through adaptPortfolioAnalytics instead of hand-written fraction rows"

requirements-completed: [R1, SC9]

coverage:
  - id: D1
    description: "Risk % and Weight % cells render the producer's percent once, unsigned, at 1 dp (28.0% / 40.0%, never +2800.00% / +4000.00%)"
    requirement: R1
    verification:
      - kind: unit
        ref: "src/components/portfolio/RiskAttribution.test.tsx#renders each weight and risk share once, unsigned, at 1 decimal place"
        status: pass
    human_judgment: false
  - id: D2
    description: "Assessment reads Balanced / Overweight risk / Balanced on the producer rows (percent against percent)"
    requirement: R1
    verification:
      - kind: unit
        ref: "src/components/portfolio/RiskAttribution.test.tsx#assesses each row percent against percent: Balanced, Overweight risk, Balanced"
        status: pass
    human_judgment: false
  - id: D3
    description: "Stacked bar values fill the XAxis domain and the tooltip shows the table's percent"
    requirement: R1
    verification:
      - kind: unit
        ref: "src/components/portfolio/RiskAttribution.test.tsx#plots risk shares that fill the axis domain, and the tooltip shows the table's percent"
        status: pass
    human_judgment: false
  - id: D4
    description: "Neuter RED -> restore GREEN recorded for the table cell, the plotted values and the tooltip"
    requirement: SC9
    verification:
      - kind: unit
        ref: "npx vitest run src/components/portfolio/RiskAttribution.test.tsx (three neuters, below)"
        status: pass
    human_judgment: false
  - id: D5
    description: "/portfolios/[id] risk decomposition shows single-scaled, unsigned shares and weights after deploy, or (D-53) no data"
    requirement: R1
    verification: []
    human_judgment: true
    rationale: "Post-deploy browser item owned by plan 169-06; an empty panel is not evidence against this fix (D-53)."

duration: 7min
completed: 2026-09-29
status: complete
---

# Phase 169 Plan 09: RISKUNIT Summary

**Risk attribution now shows the producer's percent once: `percentToFraction` converts `marginal_risk_pct` and `weight_pct` a single time before an unsigned 1 dp `formatPercent`, and the stacked bar plots the same fraction against its `[0, 1]` axis.**

## Performance

- **Duration:** about 7 min
- **Started:** 2026-09-29T16:30:05Z
- **Completed:** 2026-09-29T16:37Z
- **Tasks:** 2 of 2
- **Files modified:** 3

## Accomplishments

- A 28% risk share on the producer's shape renders `28.0%` in the table, not `+2800.00%`. A 40% weight renders `40.0%`, not `+4000.00%`. Both cells are unsigned (D-49, the format-percent contract's unsigned domain).
- The stacked bar now plots `0.28 + 0.58 + 0.14`, which fills its `[0, 1]` domain. Before, it plotted `28 + 58 + 14 = 100` against `[0, 1]`, and its tooltip read `2800.0%`.
- `RiskAttribution.test.tsx` reads its rows from `complete.json` through `adaptPortfolioAnalytics`, the same parse the page uses. A unit drift at the producer's end or at this component now turns the suite red. The old fixtures used fractions the producer never sends; they are rewritten to percent, and each Assessment was re-derived (80 vs 30 x 1.3 is Overweight; 20 vs 70 x 1.3 is Balanced).
- `RiskDecompositionRow` now documents both fields as percent 0 to 100. Only doc lines were added; the type is unchanged.
- The adapter, `portfolio-insights.ts` and `analytics-service/` are untouched. Measured: `git diff --name-only` over them is empty.

## Task Commits

1. **Task 1 (tracer): producer percent through the adapter into the table, once and unsigned.** `2006594bd` (fix)
2. **Task 2 RED: the stacked bar states the table's unit.** `951a6154a` (test)
3. **Task 2 GREEN: the bar plots the table's fraction, and the row type states the unit.** `1c7ff3f2c` (feat)

The SUMMARY is committed separately after these.

## Files Created/Modified

- `src/components/portfolio/RiskAttribution.tsx`: adds `percentToFraction` (null stays null). The Weight % and Risk % cells go through `formatPercent(…, 1, { signed: false })`, and `chartData` plots the converted fraction. The props doc states the unit. The Assessment compare, the Standalone Vol cell, the `[0, 1]` domain and the tooltip line are unchanged.
- `src/components/portfolio/RiskAttribution.test.tsx`: a producer-shape describe (cells and Assessment) and a chart-unit describe. The recharts mock now captures props (`BarChart`, `XAxis`, `TouchTooltip`) through `vi.hoisted` and resets them in `beforeEach`. The null-share case also asserts the share stays out of the bar.
- `src/lib/types.ts`: unit docs on `RiskDecompositionRow.marginal_risk_pct` and `.weight_pct`.

## Neuter evidence (SC9)

Every neuter used the same steps: `cp` a byte backup to the session scratchpad, revert one line by hand with `perl`, record the RED run, copy the backup back, `cmp` (it printed `CMP_OK` each time), then record the GREEN run. `git checkout --`, `restore` and `stash` were never used.

| # | Neuter | Failing test | RED output | Restored |
|---|---|---|---|---|
| 1 (Task 1) | Risk % cell: `formatPercent(percentToFraction(d.marginal_risk_pct), 1, { signed: false })` changed back to `formatPercent(d.marginal_risk_pct, 1, { signed: false })` | `renders each weight and risk share once, unsigned, at 1 decimal place` | `Expected: "28.0%"` / `Received: "2800.0%"`; `Tests 1 failed \| 3 passed (4)` | `CMP_OK`, `Tests 4 passed (4)` |
| 2 (Task 2) | Chart: `const share = percentToFraction(d.marginal_risk_pct);` changed back to `const share = d.marginal_risk_pct;` (today's plotted values) | `plots risk shares that fill the axis domain, and the tooltip shows the table's percent` | `AssertionError: expected 100 to be less than or equal to 1.000000001`; `Tests 1 failed \| 4 passed (5)` | `CMP_OK`, `Tests 5 passed (5)` |
| 3 (Task 2, extra) | Tooltip: `(Number(v) * 100).toFixed(1)` changed to `Number(v).toFixed(1)` | same chart case | `Expected: "28.0%"` / `Received: "0.3%"` | `CMP_OK` |

Pre-change RED, before any production edit:
- **Task 1:** the producer-shape cell case failed with `Expected: "40.0%"` / `Received: "+4000.00%"` (`Tests 1 failed | 3 passed (4)`).
- **Task 2:** the chart case failed on the committed Task 1 code with `expected 100 to be less than or equal to 1.000000001`. In the TAP run it was the only `not ok` line (`not ok 3`), with exit 1 and 4 `ok`.

## Gates (run by this executor, at `1c7ff3f2c`)

```
$ npx vitest run src/components/portfolio src/lib/portfolio-insights.test.ts src/__tests__/format-percent-contract.test.ts src/lib/portfolio-analytics-adapter.test.ts
 Test Files  23 passed (23)
      Tests  306 passed (306)
vitest-exit=0

$ npx tsc --noEmit -p .
tsc-exit=0            (no output)

$ npm run lint
[check-admin-route-manifest] OK — 20 admin routes, all declared in manifest.
[check-route-contract] OK — 58 page routes, all declared in the manifest.
[check-planning-hygiene] OK — 7804 tracked files scanned, none carry the local username or an absolute home path (rule 1 needle: derived at runtime from the home-directory basename).
lint-exit=0
```

Acceptance greps:
- `complete.json` appears in the test 2 times.
- `signed: false` appears in the component 2 times.
- The adapter / insights / analytics-service diff is empty.
- `percent|0 to 100` in `types.ts`: 3 → 5.
- The `types.ts` diff holds only doc-comment lines; the non-doc line filter printed nothing.

## Decisions Made

- **Chart unit: fractions, not percent.** The bar plots `percentToFraction(...)`, the domain stays `[0, 1]` and the tooltip keeps `x100`. Plotting percent against `[0, 100]` would have changed three lines and given the table and the bar two different sources. This way one conversion feeds both.
- The test asserts two things about the stacked sum. It must lie inside the domain, and it must equal the domain's top to within float tolerance (`toBeCloseTo(domain[1], 9)`), because the risk shares apportion the whole portfolio risk. A strict `<= 1` would flake on `0.28 + 0.58 + 0.14`.

## Deviations from Plan

**1. [Process] The worktree branch is not in the `agent-*` namespace.** The executor's commit protocol accepts only `agent-*` / `worktree-agent-*` / `worktree-wf_*` branches. The orchestrator deliberately assigned `feat/169-w1-09` and supplied its own `project_root_pin` guard. I treated that pin as the authority: I ran it before each commit and ran the protected-branch check, which passed. No commit landed on a protected branch.

**2. [Process] The `node_modules` symlink was not removed before commits.** The plan says to remove it before every commit. The orchestrator created the symlink, and `.gitignore` (`/node_modules`) ignores it. Every commit staged files by explicit path, and `git status --short` showed no `node_modules` entry before any commit, so it could not be staged. I left it in place so as not to break the orchestrator's setup.

**3. [Tooling] `gsd_run check tdd-red-evidence` could not classify vitest output.** The Task 2 RED is real, and the raw TAP above shows it: exit 1, and the only `not ok` is the target test, on its assertion. The checker still returned INVALID_RED, for two reasons:
- **JUnit** (`--reporter=junit`): the checker's Surefire parser reads a test's name with `/name="([^"]*)"/`, and that regex also matches inside `classname="…"`. Every case was read as `file#file`, which the checker classifies as `fixture_or_load_failure`. This is an upstream gsd-core parser defect.
- **TAP** (`--reporter=tap-flat`): the TAP path needs `node --test`'s `# tests N` / `# fail N` summary lines, which vitest does not print, so it reported `zero_tests_discovered`.

I did not fabricate those summary lines. The RED record (command, exit code, target, expected, actual, raw output) is kept in the session scratchpad.

Otherwise the plan was executed as written.

## TDD Gate Compliance

For Task 2 (`tdd="true"`), the `test(169-09)` commit `951a6154a` comes before the `feat(169-09)` commit `1c7ff3f2c`. The RED run failed on the target assertion; see deviation 3 for the checker verdict.

## Issues Encountered

None beyond deviation 3.

## Known Stubs

None.

## Next Phase Readiness

- Plan 169-06's post-deploy browser item: `/portfolios/[id]` risk decomposition should read single-scaled, unsigned shares and weights, or no data. Under D-53, the portfolio analytics compute defect is routed to 166.4.1, so an empty panel is not evidence against this fix.
- The `standalone_vol` period label remains Phase 170.1's copy item.

## Self-Check: PASSED

- Files found: `RiskAttribution.tsx`, `RiskAttribution.test.tsx`, `types.ts`, this SUMMARY.
- Commits found: `2006594bd`, `951a6154a`, `1c7ff3f2c`.
- The SUMMARY carries no fixture strategy names or ids (grep count 0), and no home path.
