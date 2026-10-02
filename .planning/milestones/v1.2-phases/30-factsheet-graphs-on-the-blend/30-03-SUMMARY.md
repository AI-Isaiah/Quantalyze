---
phase: 30-factsheet-graphs-on-the-blend
plan: 03
subsystem: scenario-composer-analytics
tags: [graph-01, chart-tokens, factsheet-chart-stack, recharts, visual-identity, surgical]
requires:
  - "src/components/charts/chart-tokens.ts (CHART_TICK_STYLE, CHART_BORDER, CHART_TOOLTIP_STYLE, CHART_NEGATIVE — the factsheet chart-stack literal-hex contract)"
provides:
  - "DrawdownChart.tsx reskinned to the chart-tokens.ts factsheet chart-stack contract (axes/grid/tooltip/negative-fill read tokens, not inline hexes)"
  - "DrawdownChart.test.tsx — non-vacuous GRAPH-01 token-contract pin (drawdown reads chart-tokens; equity verified CSS-var accent stroke)"
affects:
  - "Phase 33 WCAG-audited palette shift now lands in chart-tokens.ts alone for the drawdown chart (no inline drift)"
tech-stack:
  added: []
  patterns:
    - "Recharts leaf reads chart-tokens.ts literals (CSS vars don't resolve in Recharts stroke/fill) — RollingVolatilityChart.tsx is the canonical analog"
    - "node:fs source-read token-contract assertion (non-vacuous: red on inline-hex reintroduction) — RollingVolatilityChart.test.tsx precedent"
key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx"
decisions:
  - "Scoped the test's fontSize:11 assertion to the Recharts tick={{ … }} axis shape (matching the RollingVolatilityChart.test.tsx analog) rather than the whole file — the remaining line-192 fontSize:11 is the visibility-toggle radio button (HTML chrome), out of GRAPH-01 chart-stack scope and out of the plan's <action> swap list (Rule 7 conflict resolution: surgical scope wins over the V2 grep's literal 0)"
  - "EquityChart confirmed already chart-stack compliant (hand-rolled SVG, var(--color-chart-strategy) primary stroke = CHART_ACCENT) — verification-only, pinned by a source-read it, not edited"
  - "Created DrawdownChart.test.tsx fresh (the .scenario.test.tsx and .boundary.test.tsx siblings exist but the plan named DrawdownChart.test.tsx in files_modified) — additive, all 18 prior tests still green"
metrics:
  duration: "~6 min"
  completed: "2026-06-23"
  tasks: 2
  files: 2
---

# Phase 30 Plan 03: GRAPH-01 Equity/Drawdown Chart-Stack Alignment Summary

**One-liner:** Surgically reskinned `DrawdownChart.tsx`'s inline axis-tick / axis-line / tooltip / drawdown-fill hexes (`#DC2626` / `#64748B` / `#E2E8F0`, `fontSize: 11`) to the shared `chart-tokens.ts` factsheet chart-stack constants, pinned by a non-vacuous source-read token-contract test, and verified `EquityChart` is already chart-stack compliant (CSS-var accent stroke) — so a future palette change (the WCAG-audited Phase 33 shift) lands in one place instead of drifting on this leaf.

## What Was Built

GRAPH-01 was, by planning's source inspection, a single-file token swap plus a verification-only acceptance for the already-compliant equity chart. No new data path, no relocation, engine untouched.

- **`src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx`** (modified) — the Recharts drawdown chart now reads its styling from `@/components/charts/chart-tokens`:
  - Added `import { CHART_BORDER, CHART_NEGATIVE, CHART_TICK_STYLE, CHART_TOOLTIP_STYLE } from "@/components/charts/chart-tokens"`.
  - Bare-hex live-stroke arm `"#DC2626"` → `CHART_NEGATIVE` (the `var(--color-chart-benchmark)` scenario arm left verbatim).
  - Both `<stop stopColor="#DC2626" …>` gradient stops → `stopColor={CHART_NEGATIVE}` (`stopOpacity` values 0.3 / 0.02 kept verbatim).
  - XAxis `tick={{ fontSize: 11, fill: "#64748B" }}` → `tick={CHART_TICK_STYLE}` (Geist Mono 12px tabular-nums, `#64748B`); `axisLine={{ stroke: "#E2E8F0" }}` → `axisLine={{ stroke: CHART_BORDER }}`.
  - YAxis `tick={{ fontSize: 11, fill: "#64748B", fontFamily: … }}` → `tick={CHART_TICK_STYLE}` (`axisLine={false}` preserved).
  - Tooltip `contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}` → `contentStyle={CHART_TOOLTIP_STYLE}`.
  - Untouched (surgical, Rule 3): the data prop, `hasScenario` logic, gradient `id`s, the two scenario/benchmark gradients, `tickFormatter`s, `domain`, `interval`, layout, and the visibility-toggle radiogroup.

- **`src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.test.tsx`** (created) — two non-vacuous `node:fs` source-read assertions:
  1. `GRAPH-01 chart-stack tokens — drawdown reads chart-tokens, not inline hexes`: strips comments, then asserts (a) the chart-tokens import is present, (b) no `#DC2626`/`#64748B`/`#E2E8F0` in executable source, (c) no `tick={{ … fontSize … }}` inline axis literal, plus a positive control that the swapped-in tokens (`tick={CHART_TICK_STYLE}`, `axisLine={{ stroke: CHART_BORDER }}`, `contentStyle={CHART_TOOLTIP_STYLE}`, `stopColor={CHART_NEGATIVE}`) ARE present (so the negative asserts can't pass on a gutted chart).
  2. `GRAPH-01 — equity chart already chart-stack compliant (verification-only)`: asserts `EquityChart.tsx` primary stroke reads `stroke="var(--color-chart-strategy)"` (the `CHART_ACCENT` `#1B6B5A` identity) — pins the verified resolution so a future regression hardcoding the equity stroke fails.

## Verification

- `npx vitest run "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.test.tsx"` → 2 passed.
- All `DrawdownChart*` tests together (new + `.scenario` + `.boundary`) → 20 passed (the prior 18 unchanged; scenario test's stroke/gradient assertions confirm `CHART_NEGATIVE` resolves to the expected `#DC2626` and the benchmark/scenario arms are intact).
- `ScenarioComposer.test.tsx` (the host mounting DrawdownChart) → 71 passed (no downstream regression from the import).
- `npx tsc --noEmit` → no DrawdownChart type errors.
- `git diff --quiet HEAD -- src/lib/scenario.ts` → exit 0 (engine untouched).
- **Non-vacuity proof (Rule 9):** temporarily reintroducing an inline `axisLine={{ stroke: "#E2E8F0" }}` made the token test FAIL (`expected … not to match /#E2E8F0/`); `git checkout --` revert restored green. The token pin genuinely catches inline-hex reintroduction.

## Deviations from Plan

### Rule 7 — Conflict resolution (surface conflicts, don't average)

**1. [Rule 7] Scoped the `fontSize: 11` assertion to the Recharts axis shape, not the whole file**
- **Found during:** Task 1 (post-edit grep) / Task 2 (writing the assertion).
- **Conflict:** The plan's Task 2 acceptance + V2 verification grep imply the non-comment source must contain ZERO `fontSize: 11`. But one `fontSize: 11` remains at line 192 — inside the **visibility-toggle radio `<button>`** (`Live / Scenario / Both`) inline `style={{…}}`. That button is HTML chrome on an overlay control, NOT a Recharts chart axis/grid/tooltip — and it is explicitly NOT in the plan's `<action>` swap list (which enumerates only `:155/:213-214/:227/:229/:234/:242`), and the same `<action>` forbids touching "any layout" / the toggle. GRAPH-01's intent (UI-SPEC §4) is the chart-stack identity = axes/grid/tooltip/fill, not the overlay toggle.
- **Resolution:** Honored the plan's surgical `<action>` scope (and CLAUDE.md Rule 3) over the V2 grep's literal `0`. The Task 2 test scopes its `fontSize` assertion to `tick={{ … fontSize … }}` (zero matches) — mirroring the analog `RollingVolatilityChart.test.tsx` Test 8 (`/tick=\{\{[^}]*fontSize/`). The pin stays non-vacuous for GRAPH-01 (a reintroduced inline axis tick fails) without forcing an out-of-scope edit to the toggle button.
- **Files modified:** none beyond the planned swap (the toggle button was deliberately left untouched).
- **Commit:** test in `c5683552`; the decision is also recorded in this SUMMARY's `decisions` frontmatter.

### Note (not a deviation)

- The plan's `files_modified` named `DrawdownChart.test.tsx`; that file did not pre-exist (siblings `DrawdownChart.scenario.test.tsx` and `DrawdownChart.boundary.test.tsx` do). Created it fresh as named — additive, no existing test removed or altered.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` — FOUND (modified, committed `395a58eb`).
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.test.tsx` — FOUND (created, committed `c5683552`).
- Commit `395a58eb` (feat 30-03 reskin) — FOUND in git log.
- Commit `c5683552` (test 30-03 token assertion) — FOUND in git log.
