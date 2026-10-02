---
phase: 39-complete-payload-adapter
reviewed: 2026-06-26T08:55:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - src/lib/factsheet/quantiles.ts
  - src/lib/factsheet/quantiles.test.ts
  - src/lib/factsheet/build-payload.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 39: Code Review Report

**Reviewed:** 2026-06-26T08:55:00Z
**Depth:** deep (cross-file: composer → chart → adapter → engine + helper call chains)
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 39 makes `buildScenarioFactsheetPayload` synthesize a COMPLETE `FactsheetCsvPayload`: scalar metrics + every panel array now derive from the blend's `portfolio_daily_returns` (returns form) via the factsheet `compute.ts`/`rolling.ts` helper family, while the equity/drawdown chart LINE stays on the wealth series (D-2 Option a). `quantileSummary` was extracted verbatim to a shared module.

The mechanical work is clean and well-tested. Verified correct:

- **quantiles extraction is byte-identical** — verbatim move, call site in `build-payload.ts` unchanged, the dropped type import (`QuantilePayload`) is correctly removed only where now unused, no stale references anywhere. New unit test covers empty / n=1 / interpolation / no-mutation. (build & tests green.)
- **Returns-degenerate gate ordering is correct** — `buildReturnsBody` evaluates `degenerate` (empty / any non-finite / <2 dates) and returns the safe-empty body BEFORE any `compute()` call. I traced every helper (`compute`, `rolling*`, `bootstrapCI`, `streakLengths`, `calmarByYear`, `monthlyReturnsMatrix`, `dailyReturnsByYear`, `computeStressWindows`, `quantileSummary`): none throws or emits NaN/Inf for a short-but-nonempty (n≥2) all-finite blend. `compute()` only throws on `n===0` or `dates.length!==n`, both excluded by the gate. The two axes (wealth / returns) degenerate-collapse independently and correctly.
- **Returns-vs-wealth split is not crossed** — scalars + panels read `rets`/`datesR`; the chart line reads `scenario`/`dates`. No wealth value is fed to a returns helper or vice-versa. The composer threads the engine's true unrounded `portfolio_daily_returns` (returns form), pinned by a dedicated composer test asserting `|value| < 0.5` and both signs.
- **Honesty invariants hold** — `ingestSource: "csv"` hard-set; the 4 synth panels (`peerPercentile`/`allocatorPortfolios`/`eventSignatures`/`benchEventSignatures`) structurally absent (`in payload === false`, asserted); `styleDrift: null`; `correlations`/`correlationMatrix` honest-empty. No path fabricates a zero-as-real-metric — degenerate emits the zeroed summary only when genuinely degenerate.
- **Prop wiring** — `portfolioDaily` is correctly in the chart's `useMemo` dependency array; default `[]` collapses to the safe-empty body, not a fake all-zero factsheet. Types are sound (`portfolio_daily_returns: Array<{date,value}>` is structurally `DailyPoint[]`).
- **No type-safety / RSC / serialization issues** — no `as any` (one documented, type-safe `as ComparatorBlock["cumulative"]` at the sparse-benchmark boundary, pre-existing), pure TS in a `useMemo`, no non-serializable props.

Two WARNINGs concern a real structural defect in the *produced payload* (not a Phase-39 visible crash, but a latent correctness hazard the next phase steps on) and the test fixture that masks it. Two LOW items are convention/defense-in-depth.

## Warnings

### WR-01: Synthesized payload violates the `FactsheetPayload` axis invariant — `dates` (downsampled) and the returns-panel arrays (full-resolution) have different lengths in production

**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:436,438,443-449,460-464` (assembly) + `src/lib/scenario.ts:264-267,434-447` (the two source series)

**Issue:**
The payload's top-level `dates` axis is built from `scenario` (the chart wealth line), which the composer derives from `scenarioMetrics.equity_curve`. But `equity_curve` is **downsampled to every 5 business days and rounded** (`scenario.ts:436` `for (i = 0; i < n; i += 5)`). The returns-derived panels (`strategyReturns`, `strategyRollingVol`, `strategyRollingSharpe`, `strategyRollingSortino`, `monthlyReturns`, `dailyHeatmap`) are built from `portfolioDaily` = `scenarioMetrics.portfolio_daily_returns`, which is **full-resolution, all `n` points** (`scenario.ts:264-267`).

Result: the synthesized `FactsheetCsvPayload` has `dates.length ≈ n/5` but `strategyReturns.length === n`. The factsheet's core axis invariant — `dates[i] ↔ strategyReturns[i] ↔ strategyRollingVol[i]` — is **broken** in the produced object. I confirmed this empirically against the real `computeScenario` (a 60-day blend produced `dates.length !== strategyReturns.length`).

The Phase-39 chart (`ScenarioFactsheetChart`) only mounts the equity and drawdown panels (`SCENARIO_EQUITY_CONFIG` / `SCENARIO_DRAWDOWN_CONFIG`), both of which read the wealth axis (`dates`/`strategyEquity`/`strategyDrawdowns`) and are internally length-consistent — so **there is no visible bug in Phase 39's own rendering today**, and the headline `strategyMetrics` scalars are actually *more* accurate (full-res, unrounded) than computing them off the downsampled wealth. That is why this is a WARNING, not a BLOCKER.

But the payload is a structurally inconsistent artifact and a live footgun: the factsheet's own `TimeSeriesChart` indexes the strat field against `payload.dates[i]` for tooltips and CSV export (`TimeSeriesChart.tsx:866 date={payload.dates[crossIdx]}`, `:912 cells=[dates[i]]`), and the real factsheet `dailyReturns` / `rollingVol` configs (`chart-configs.ts:125-148`) plot `strategyReturns`/`strategyRollingVol` against `dates`. Milestone v1.2.2's stated north-star (Phase 40: "mount the REAL factsheet on the scenario blend") will mount exactly those panels against this payload and silently desync the returns/rolling panels by ~5x — tooltips, CSV rows, and warmup overlays will misalign date↔value.

Critically, the plan's own rationale was based on a false premise. `39-02-PLAN.md:184` states: *"on a healthy blend they [`dates` and `datesR`] are the same ISO dates."* They are not — `dates` is downsampled relative to `datesR`. The implementation inherited this incorrect assumption; the executor self-check and verifier did not catch it.

**Fix:**
Make the chart-line axis and the returns axis genuinely share one date model. The cleanest options:
1. **Source the chart line from the full-resolution returns too** (preferred for parity-by-construction): derive `strategyEquity = cumEq(rets)` and `dates = datesR` from `portfolioDaily`, dropping the dependency on the downsampled `equity_curve`. This makes `dates.length === strategyReturns.length` by construction and removes the 5-decimal rounding from the chart line. (Re-pin the Phase-38 exact-equality tests against the full-res series; verify the chart still renders acceptably at full resolution.)
2. **Or** explicitly assert the invariant and fail loud if violated, so the desync can never reach a consumer that reads returns panels against `dates`:
   ```ts
   // After assembling the body, before returning:
   if (body.strategyReturns.length > 0 && body.strategyReturns.length !== dates.length) {
     // dates (downsampled wealth axis) cannot index the full-resolution returns panels.
     // Either align the axes (option 1) or this payload must NOT feed any returns/rolling panel.
     throw new Error(
       `scenario factsheet payload: dates(${dates.length}) != strategyReturns(${body.strategyReturns.length}) — returns panels would desync`,
     );
   }
   ```
   At minimum, document this constraint loudly at the top of the file and on the `portfolioDaily` field so Phase 40 does not mount a returns/rolling panel against this payload unguarded.

### WR-02: Parity tests use a full-resolution `wealthFor()` fixture that masks the production axis mismatch (Rule 9 — test cannot fail when the real hazard regresses)

**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts:186-191, 369-381`

**Issue:**
`wealthFor(blend)` builds the chart's wealth series as `cumEq(blend)` over **every** point — same length and same dates as `portfolioDaily`. So in every Phase-39 parity test, `scenario.length === portfolioDaily.length` and `dates === datesR`. That is **not** what production feeds: production's `scenarioWealthSeries` comes from the *downsampled* `equity_curve` (≈ `n/5` points), while `portfolioDaily` is full-resolution.

Consequently the test that pins the chart line (`:369 "strategyEquity/strategyDrawdowns still track the WEALTH series…"`) and the axis behavior are exercised only on a synthetic equal-length case. The tests would stay green even if the production axis mismatch worsened, so they do not encode the real invariant (per CLAUDE.md Rule 9, a test that can't fail when the behavior that matters changes is incomplete). This is why WR-01 shipped undetected.

**Fix:**
Add a test that builds the scenario series the way production does — via `computeScenario(...).equity_curve` → `toWealth(...)` (downsampled) paired with `computeScenario(...).portfolio_daily_returns` (full-res) — and assert the intended axis contract explicitly. Either pin `payload.dates.length === payload.strategyReturns.length` (after the WR-01 fix) so it fails today and goes green only once aligned, or, if the two-axis split is kept intentionally, pin and document the mismatch with a comment stating that no returns/rolling panel may be mounted against this payload. Example skeleton:
```ts
const m = computeScenario([strat], state, buildDateMapCache([strat]));
const wealth = toWealth(m.equity_curve.map(p => ({ date: p.date, value: p.value + 1 })));
const p = buildScenarioFactsheetPayload({ scenario: wealth, portfolioDaily: m.portfolio_daily_returns ?? [] });
// Intent: dates must index every returns/rolling panel (factsheet axis invariant).
expect(p.dates.length).toBe(p.strategyReturns.length); // fails today → WR-01
```

## Info

### IN-01: Composer passes a fresh `?? []` allocation instead of the already-memoized `portfolioDaily` const

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2228`

**Issue:**
Line 2228 passes `portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}` to `<ScenarioFactsheetChart>`, which feeds the chart's `useMemo` (dep array includes `portfolioDaily`). The codebase already created a memoized `portfolioDaily` const at `:1519-1522` *specifically* to avoid this pattern — its comment (`:1516-1518`) warns that a bare `?? []` "allocates a fresh array each render and would defeat the memoization." Reusing the existing `portfolioDaily` const would feed a stable reference into the chart memo.

Real impact is low: `computeScenario` always returns a concrete array (never `undefined`), so `?? []` returns the stable engine reference and the fresh `[]` only materializes in the never-hit nullish case. The new line is also consistent with the sibling sections (`:2273`, `:2290`, `:2309`) which use the same inline `?? []`. Flagged for consistency with the file's own documented anti-`?? []` rationale, not because it causes a live re-render bug.

**Fix:** Pass the existing const: `portfolioDaily={portfolioDaily}` (already in scope at `:1519`). This also drops one redundant `?? []` and matches the memo-feeding convention the file documents at `:1516-1518`.

### IN-02: `computeStressWindows` ISO-date precondition is not guarded by the returns-degenerate gate (defense-in-depth)

**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:353` → `src/lib/factsheet/stress-windows.ts:89-91`

**Issue:**
`buildReturnsBody` passes `datesR` straight to `computeStressWindows`, which throws if `dates[0]` is not ISO `YYYY-MM-DD` (`stress-windows.ts:89`). The returns-degenerate gate validates finiteness and length≥2 but not date format. In practice the dates originate from strategy `daily_returns[].date`, which are ISO throughout the codebase (the same source the real `build-payload.ts` feeds to the same helper without issue), so this is not reachable today. Noted only as a defense-in-depth gap: a malformed-date upstream regression would surface as a thrown error inside the `useMemo` (uncaught → render crash) rather than the safe-empty collapse the rest of the adapter guarantees.

**Fix:** Either add an ISO-format check to the degenerate gate (collapse to safe-empty on a non-ISO `datesR[0]`), or rely on the existing upstream ISO guarantee and leave a one-line comment noting the precondition. Low priority.

---

_Reviewed: 2026-06-26T08:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
