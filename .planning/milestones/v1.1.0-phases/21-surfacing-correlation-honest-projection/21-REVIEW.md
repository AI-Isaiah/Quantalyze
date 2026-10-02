---
phase: 21-surfacing-correlation-honest-projection
reviewed: 2026-06-21T15:39:10Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/portfolio/CorrelationHeatmap.tsx
  - src/components/scenarios/ScenarioBuilder.tsx
  - src/components/strategy/PercentileRankBadge.tsx
  - src/lib/scenario-history.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: resolved
resolved_at: 2026-06-21
resolution_commit: 766311ad
---

> **Resolution (2026-06-21, commit `766311ad` + `e4ceee7d`):** All
> phase-21-introduced findings fixed — CR-01 (surface-neutral empty-state copy +
> pin test), WR-01 (honest `shortestHistoryName` doc). The four WARNINGs that
> were pre-existing (WR-02/03/04/05, predating Phase 21) were **also fixed at the
> user's request**: WR-02 projected-AUM disclosure (+tests), WR-03 local weight
> clamp, WR-04 `typeof` narrowing, WR-05 defensive baseline default. INFO items
> IN-01/02/03 left as-is (pre-existing convention / backlog god-file split);
> IN-04 left as-is (logic verified correct + tested). tsc clean; 155 tests green.

# Phase 21: Code Review Report

**Reviewed:** 2026-06-21T15:39:10Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 21 surfaces an already-shipped scenario engine: the frozen engine
(`src/lib/scenario.ts`) was confirmed **unchanged** in the `28baffee..HEAD`
diff — no accidental engine edits. The no-invented-data honesty contract is
largely well-implemented and well-tested:

- **Single-sourced Avg |ρ|** is correct end-to-end. `CorrelationHeatmap` no
  longer self-computes an average (`pickTopTenByAvgCorr` was deleted); it
  renders the host-passed `avgAbsCorrelation`, and `ScenarioComposer` /
  `ScenarioBuilder` both pass `scenarioMetrics.avg_pairwise_correlation` — the
  same value the KPI strip reads. The CORR-03 test proves divergence is caught.
- **IMPACT-02 neuter guards are genuinely non-vacuous.** Both
  `ScenarioBuilder.honesty.test.tsx` and `ScenarioComposer.test.tsx` assert
  absence via `queryByTestId("percentile-rank-badge")` AND render a real
  `PercentileRankBadge` in isolation as a positive control. The render-only
  `data-testid` added to `PercentileRankBadge.tsx` is the correct mechanism.
- **SURF-02/03 role gating is correct.** The Sandbox sidebar link gates on
  `isAllocator` only (NOT `showsAllocatorWorkspace`), exactly as specified.
- **`shortestHistoryName` degenerate handling is sound** (empty → null, single
  → lone name, deterministic tiebreak) and well unit-tested.

The one **BLOCKER** is a cross-surface regression: the `CorrelationHeatmap`
empty-state gate was tightened from `ids.length === 0` to `ids.length < 2` and
truncation was removed, but a third, **out-of-scope caller**
(`portfolios/[id]/page.tsx`) was not updated and is silently affected — a
legitimate 1-strategy portfolio now renders a scenario-flavored empty state,
and large portfolios lose their top-10 cap. The remaining findings are honesty
caveat imprecision, an AUM-in-scenario-mode presentation gap, and minor
robustness/quality items.

## Critical Issues

### CR-01: CorrelationHeatmap gate/truncation change silently breaks the out-of-scope portfolio-detail caller

**File:** `src/components/portfolio/CorrelationHeatmap.tsx:159-190` (affects `src/app/(dashboard)/portfolios/[id]/page.tsx:308-311`)

**Issue:** Phase 21 made two behavior changes to the shared, presentational
`CorrelationHeatmap` to serve the scenario surfaces:

1. The empty-state gate changed from `!correlationMatrix || ids.length === 0`
   to `!correlationMatrix || ids.length < 2` (CORR-02, line 168).
2. The top-10 truncation (`pickTopTenByAvgCorr`) was deleted in favor of
   show-all (CORR-04, line 160: `ids = Object.keys(correlationMatrix)`).

`CorrelationHeatmap` has **three** production callers, but only the two new
scenario callers (`ScenarioComposer`, `ScenarioBuilder`) were updated. The
third — `portfolios/[id]/page.tsx:308` — was **not changed in this phase**
(confirmed: not in the diff range) and does NOT pass the new
`overlappingDays` / `avgAbsCorrelation` props. It feeds a server-computed
`heatmapMatrix` derived from a single portfolio's `correlation_matrix`.

Consequences on that surface:
- **A legitimate single-strategy portfolio** previously rendered its (trivial)
  1×1 grid. It now hits `ids.length < 2` and renders the empty state. Because
  `overlappingDays` is `undefined` there, `tooFewDays=false` and the body
  resolves to `EMPTY_BODY_FEW_STRATEGIES` ("Add at least 2 active strategies to
  see how they move together. **Adjust your selection**...") — copy that
  references a toggle/selection UX that does not exist on the portfolio detail
  page. This is a user-facing regression with misleading copy.
- **A portfolio with >10 strategies** previously showed the top-10 most-correlated;
  it now renders an unbounded N×N grid on a page that has no other scroll
  guard around this card, potentially pushing the layout.

This is the classic "shared presentational component changed for one consumer,
blast radius not checked" defect (Rule 8 — read immediate callers before
writing).

**Fix:** Decide the contract for the legacy caller and make it explicit. Either
(a) restore the per-caller behavior by passing `overlappingDays` from the
portfolio analytics and accepting that a 1-strategy portfolio shows the
empty state with appropriate copy, or (b) preserve the prior 1×1 render for
callers that opt out of the `< 2` gate. Minimal option (a):

```tsx
// portfolios/[id]/page.tsx — pass the day count so the empty-state copy is honest,
// and confirm the single-strategy empty state is the intended UX here.
<CorrelationHeatmap
  correlationMatrix={heatmapMatrix}
  strategyNames={strategyNames}
  overlappingDays={overlappingDaysFromAnalytics /* wire from parsed analytics */}
/>
```

If the single-strategy portfolio SHOULD still render its 1×1 grid, gate the
new `< 2` behavior behind an opt-in prop (e.g. `requireTwoStrategies`) so the
scenario surfaces get the honest empty state without regressing the portfolio
page. At minimum, add a test that pins the portfolio-page caller's expected
behavior for the 1-strategy and >10-strategy cases.

## Warnings

### WR-01: "Shortest history" caveat can name a strategy that is NOT the binding overlap constraint

**File:** `src/lib/scenario-history.ts:41-57` (consumed at `ScenarioComposer.tsx:609-612`, `ScenarioBuilder.tsx:217-220`)

**Issue:** `shortestHistoryName` defines "shortest" as the strategy with the
fewest `daily_returns` **points** (array length). The caveat then presents this
name as the strategy "most constraining the analysis." But the engine's
overlap `n` (`scenario.ts`) is the count of the **union** of dates each strategy
covers *after its own include-from*, and the per-strategy contribution depends
on *which* dates each covers, not merely how many points it has. A strategy
with fewer total points but densely overlapping the common window is not
necessarily the binding constraint; conversely a strategy with many points
clustered outside the common window could constrain `n` more. So the named
strategy can be misleading. On a surface whose entire purpose is honest
disclosure ("no invented data"), naming the wrong limiting strategy is a soft
honesty defect, not just cosmetic. The helper's own doc comment claims it is
"the one whose short record most constrains an honest correlation/overlap" —
that claim is not guaranteed by counting points.

**Fix:** Either soften the user-facing copy to match what is actually computed
("Shortest record: {name}" / "Fewest data points: {name}") so the label is
truthful, or compute the constraint from the actual overlapping-window
contribution (count of points falling inside the common date range) rather than
total `daily_returns.length`. The copy change is the lower-risk fix:

```tsx
// ScenarioComposer.tsx / ScenarioBuilder.tsx caveat
{coverageShortestName !== null
  ? ` Shortest record: ${coverageShortestName}.`
  : ""}
```

### WR-02: AUM cell in scenario mode shows a different number than live AUM with no delta and no scenario label

**File:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx:373-381`, `506`; `ScenarioComposer.tsx:1094`

**Issue:** In scenario mode, `ScenarioComposer` passes `aum={scenarioAum}` (the
sum of toggled-ON live holdings, which can be far less than live AUM when
holdings are toggled off or weights changed). The AUM cell has `metricKey: null`,
so the scenario-primary / delta-pill path is intentionally suppressed and the
cell renders `scenarioAum` as a plain currency value with `valueColorClass(... null)`
(no color, no pill, no "Live: X" tooltip). Every OTHER cell in scenario mode
shows a scenario value with a delta vs. live; the AUM cell shows a scenario
value styled identically to a live value, with no indication it changed. An
allocator who toggles holdings off sees AUM silently shrink with no signal that
this is the *projected* book size rather than their real AUM. The composer's
top-level PROJECTED badge mitigates this but does not flag the per-cell
discrepancy the way the other cells do.

**Fix:** Either suppress the AUM number in scenario mode (render "—" / "n/a"
since the engine has no AUM concept and the value is composer-derived), or add a
sub-line / tooltip on the AUM cell in scenario mode disclosing it is the
projected toggled-on AUM, e.g. surface a `sub` of "projected from N enabled
holdings" when `mode === "scenario"`.

### WR-03: `handleWeightChange` clamp-error message can mislead — out-of-range >1 is reported as "clamped to 1" but the state layer governs the actual clamp

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:346-376`

**Issue:** `handleWeightChange` sets a user-facing error string asserting
"Weight clamped to 1 — the maximum allocation is 100% of portfolio AUM" whenever
`weight > 1`, then forwards the raw value to `scenario.setWeightOverride`, which
"silently clamps to 1" per the comment. The composer assumes the state layer
clamps to exactly 1, but the composer does not perform the clamp itself — it
trusts an invariant in `useScenarioState`/`clampWeight` that is not visible or
asserted here. If that layer ever changes its clamp bound (e.g. allows leverage
to push effective weight, or clamps to a different max), the error message
becomes a lie and the displayed `weight.toFixed(3)` (line 1460, sourced from
`draft.weightOverrides[ref]`) could disagree with the message. Leverage already
introduced multi-source weight semantics, raising the risk. Coupling a hardcoded
"clamped to 1" message to a clamp performed in a different module is fragile.

**Fix:** Clamp authoritatively at the boundary the message describes, or read
the clamp bound from a shared constant. Mirror the leverage handler, which
clamps locally (`Math.min(MAX_LEVERAGE, Math.max(0, leverage))`) before
dispatch:

```ts
if (weight > 1) {
  setCommitError("Weight clamped to 1 — the maximum allocation is 100% of portfolio AUM.");
}
const clampedWeight = Math.min(1, Math.max(0, weight));
scenario.setWeightOverride(scopeRef, clampedWeight);
```

### WR-04: `projectionState` uses `Number.isFinite(ov)` on a value typed as `number | undefined`, masking a 0-vs-absent ambiguity

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:557-563`

**Issue:** `const ov = scenario.draft.weightOverrides[s.id];` then
`weights[s.id] = Number.isFinite(ov) ? (ov as number) : (adapterOutput.state.weights[s.id] ?? 0);`.
`Number.isFinite(undefined)` is `false`, so an absent override correctly falls
back to the adapter default. But `Number.isFinite(0)` is `true`, so an explicit
override of `0` (a deliberate "zero this leg out" edit) is honored — which is
correct. The subtle issue is the `as number` cast: it suppresses the type
checker's knowledge that `ov` is `number | undefined`. If `weightOverrides` ever
stores a non-numeric sentinel (e.g. `null` for "cleared"), `Number.isFinite(null)`
is `false` so it falls back, but the cast would still compile silently for other
value-type drift. The same pattern repeats for leverage (line 562) where
`leverageByRef[s.id]` defaults to 1 — but the leverage default of 1 means a
stored explicit `0` (valid: shorting-clamped-to-zero) is treated as a real value
correctly. The weight path is fine functionally; the concern is the `as number`
casts hiding future type drift.

**Fix:** Narrow without the cast so the compiler protects you:

```ts
const ov = scenario.draft.weightOverrides[s.id];
weights[s.id] =
  typeof ov === "number" && Number.isFinite(ov)
    ? ov
    : (adapterOutput.state.weights[s.id] ?? 0);
const L = leverageByRef[s.id];
leverage[s.id] = typeof L === "number" && Number.isFinite(L) ? L : 1;
```

### WR-05: `liveBaselineToComputedMetrics` assumes `payload.liveBaselineMetrics` is always a populated object — no defense for an absent/partial payload

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:254-272`, `630-633`

**Issue:** `liveBaselineToComputedMetrics(baseline)` reads `baseline.equity.length`,
`baseline.equity[0]?.date`, `baseline.ytdTwr`, etc. with no guard that
`baseline` or `baseline.equity` is present. The type says `liveBaselineMetrics`
is non-optional with `equity: DailyPoint[]`, so this is type-safe **for payloads
produced by the current `getMyAllocationDashboard`**. But `ScenarioComposer`
receives `payload` via prop-drilling from a `"use client"` boundary
(`AllocationsTabs` → dynamic import), and the cast at line 298
(`payload as MyAllocationDashboardPayload & {...}`) signals the runtime shape is
already being coerced. If a stale client cache, a partial SSR payload, or a
future query variant ever omits `liveBaselineMetrics` (or sends `equity: null`),
`baseline.equity.length` throws `Cannot read properties of undefined`, crashing
the whole Scenario tab rather than degrading. The KPI strip and delta summary
both depend on this, so the blast radius is the entire composer.

**Fix:** Defensively default the shape at the adapter boundary:

```ts
function liveBaselineToComputedMetrics(
  baseline: MyAllocationDashboardPayload["liveBaselineMetrics"] | null | undefined,
): ComputedMetrics {
  const eq = baseline?.equity ?? [];
  return {
    n: eq.length,
    twr: baseline?.ytdTwr ?? null,
    cagr: null,
    volatility: null,
    sharpe: baseline?.sharpe ?? null,
    sortino: null,
    max_drawdown: baseline?.maxDd ?? null,
    max_dd_days: null,
    correlation_matrix: null,
    avg_pairwise_correlation: baseline?.avgRho ?? null,
    equity_curve: [],
    effective_start: eq[0]?.date ?? null,
    effective_end: eq[eq.length - 1]?.date ?? null,
  };
}
```

## Info

### IN-01: `KpiStrip` uses optional chaining (`metrics?.twr`) on a non-optional prop

**File:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx:325-332`

**Issue:** `metrics` is declared `metrics: ComputedMetrics` (required, non-null)
in `KpiStripProps`, yet the value-resolution chain reads `metrics?.twr`,
`metrics?.sharpe`, etc. The optional chaining is dead defensiveness — if a caller
ever passed `undefined`, TypeScript would already reject it at the call site
(the sole caller, `ScenarioComposer:1092`, passes a real object). This is
harmless but signals either the type is wrong (should be nullable) or the
chaining is noise. Pick one so the contract is honest.

**Fix:** Drop the `?.` (relying on the non-null type) or make `metrics` nullable
in the interface if a null caller is genuinely expected.

### IN-02: `ScenarioComposer` reaches ~1650 lines with a nested sub-component — high single-file complexity

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (whole file)

**Issue:** The composer file is ~1650 lines containing the main component, the
`CompositionList` sub-component, the `ResetConfirmationModal`, the diff-type
unions, the live-baseline adapter, and ~15 `useMemo`/handler closures.
`handleCommit` alone is ~125 lines with five distinct guard/loop blocks. This is
near the top of the maintainability range and makes the hooks-ordering invariant
(noted at line 408-414) easy to violate on future edits. Per project memory this
is opportunistic-split territory (god-file split #19/#20 family), not a
this-PR requirement — flagged for the backlog, not as a gate.

**Fix:** When a future feature forces edits here, extract `CompositionList`,
`ResetConfirmationModal`, the diff-type module, and the `handleCommit` body into
sibling files. No action required this phase.

### IN-03: `console.warn` debug breadcrumbs ship in production client bundle

**File:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:32-35` (`warnAudit`), `ScenarioComposer.tsx:351,385-388`

**Issue:** Several intentional `console.warn` breadcrumbs (`warnAudit`,
`handleWeightChange`/`handleLeverageChange` non-finite logs) run in the shipped
client bundle. These are documented as deliberate audit breadcrumbs (cluster P)
and are non-blocking, so this is not a defect — but they do emit to every end
user's console and are the kind of artifact a `quick`-depth scan flags. Noted for
awareness; consistent with the existing codebase convention (the project routes
fail-loud signals through `console.warn` + Sentry). No change required unless the
team wants these gated behind a debug flag.

**Fix:** None required; optionally route through the existing Sentry-breadcrumb
helper rather than raw `console.warn` for consistency.

### IN-04: Heatmap empty-state `tooFewStrategies` guard contains a partially redundant sub-condition

**File:** `src/components/portfolio/CorrelationHeatmap.tsx:177-183`

**Issue:** The body-copy selector reads:
```ts
const tooFewStrategies = ids.length < 2 && !tooFewDays;
const body = tooFewDays
  ? EMPTY_BODY_FEW_DAYS
  : tooFewStrategies && (correlationMatrix !== null || overlappingDays !== undefined)
    ? EMPTY_BODY_FEW_STRATEGIES
    : EMPTY_BODY_COMBINED;
```
Since this block only runs when `!correlationMatrix || ids.length < 2`, and
`tooFewStrategies` already encodes `ids.length < 2 && !tooFewDays`, the extra
`(correlationMatrix !== null || overlappingDays !== undefined)` gate exists only
to route a "standalone null matrix, no host context" call to the COMBINED copy.
The logic is correct (verified by trace) but the triple-nested ternary with an
inline boolean conjunction is hard to audit and is exactly the kind of expression
where a future edit silently flips a branch. The CORR-02 tests cover the three
documented cases, but the dead-feeling redundancy invites bugs.

**Fix:** Flatten to explicit `if` branches keyed on the three documented reasons
(too-few-days, too-few-strategies-with-context, standalone-null) so each path is
independently readable and testable. Behavior should be unchanged.

---

_Reviewed: 2026-06-21T15:39:10Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
