---
phase: 30-factsheet-graphs-on-the-blend
reviewed: 2026-06-23T14:30:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/lib/scenario-blend-panels.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-06-23T14:30:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the Phase 30 ("Factsheet Graphs on the Blend") delta vs `03d0699c`: the new
pure-TS adapter `scenario-blend-panels.ts`, the two new blend-graph Card mounts in
`ScenarioComposer.tsx` (Returns-distribution + Rolling-metrics), and the
token-swap-only change to `DrawdownChart.tsx`.

The phase's load-bearing invariants verified CLEAN:

- **Frozen engine** — `git diff 03d0699c..HEAD -- src/lib/scenario.ts src/lib/scenario.test.ts`
  returns empty; the `phase-30-frozen-spine-guards` suite passes and the fallback base SHA
  `03d0699c` is reachable, so the guard fails loud (not silent) if the base cannot resolve.
- **Rolling vol / Sharpe parity** — byte-for-byte identical loop shape to
  `portfolio-stats.ts::computeRollingMetric` (sample `stdDev(slice, true)` = n-1 Bessel,
  `× √252`, `[]` below window). The unit test asserts point-for-point equality and passes.
- **Rolling Sortino** — downside RMS `÷ window` (total n), numerator `mean × 252`, `× √252`,
  exactly mirroring the frozen engine (`scenario.ts:354-361`: `downsideSumSq / n`).
- **No annualization drift** — only `252` appears; the lone `365` token is the
  `sharpe_365d` accent KEY string, not a `√365`/`*365` factor (source-read test passes).
- **Histogram cumulative-wealth feed** — `cumprod(1+r)` starting at `1+r[0]`, matching the
  product-wide `returns_series` convention `ReturnHistogram` consumes; a raw-daily mis-feed
  is caught by the round-trip + first-point-≈1.0 assertions. Cannot slip through.
- **Degenerate guard** — `hasNonFinite || length < MIN_USABLE(10) || length < window`
  collapses every series to `[]`/`{}`; positive + negative controls both assert.
- **Honesty invariant** — no `FactsheetBody`/`MetricsColumn`/`buildAllocatorPortfolioFactsheetPayload`/
  `PercentileRankBadge` import; no `ingestSource:"api"`; the R3/IMPACT-02 guard runs WITH the
  new panels mounted (non-vacuous) and the absent-peer-badge assertion keys on a unique testid
  with an in-isolation positive control. Leaf charts only, 0 strategyId/fetch.
- **Empty branch** — both panels render a `role="status"` `PartialDataBanner` (never
  `role="alert"`) below floor; the disclosure lines are panel-local (not relying on the page badge).
- **Memoization fix** — `portfolioDaily` memo keys on the engine output reference and keeps
  `?? []` OUTSIDE the dep array, so a stable `undefined` does not re-allocate a fresh `[]`
  every render and defeat the downstream `buildBlendPanels` memo. `buildBlendPanels` is pure
  and reads only its arguments; no stale-closure risk. Correct.
- **DrawdownChart** — Phase-30 delta is a pure inline-hex → chart-tokens swap with identical
  token values (`#DC2626`/`#E2E8F0`); no logic change. Token test passes and is non-vacuous.

No security issues, secrets, injection vectors, or debug artifacts in the delta.

Two real defects below — both on the Rolling-metrics panel — plus one info item.

## Warnings

### WR-01: Rolling-Sharpe line is mislabeled "365d" for the 3M / 6M windows (legend + tooltip lie)

**File:** `src/lib/scenario-blend-panels.ts:176` (the `sharpe_365d` key) consumed by
`src/components/charts/RollingMetrics.tsx:56-60,136,138` via `LABELS`.

**Issue:** The adapter keys the single rolling-Sharpe series `sharpe_365d` so that
`RollingMetrics.STROKE_BY_KEY` resolves the `CHART_ACCENT` stroke (the documented A3
contract). But `RollingMetrics` reuses the SAME key map for the user-visible text:
`LABELS["sharpe_365d"]` renders `"365d"` in BOTH the `<Legend>` (`RollingMetrics.tsx:138`)
and the `<Tooltip>` (`:136`). The series is actually a `rollingWindow`-day window
(63/126/252). So when the allocator selects 3M or 6M, the chart legend/tooltip labels the
line **"365d"** while the panel's own disclosure line directly below it
(`ScenarioComposer.tsx:2205-2208`) reads `"{rollingWindow}-day rolling window · 252-day
annualized …"` — e.g. "126-day rolling window". The two on-screen labels contradict each
other on the same card. This is a no-invented-data / honesty defect on a factsheet-grade
panel: a 6-month rolling Sharpe is presented to the allocator as a "365d" (annual) rolling
Sharpe. The planning docs reasoned only about the STROKE color resolution and overlooked
the user-facing `LABELS` lookup that piggybacks on the same key. The blend test suite never
asserts the legend/tooltip text, so this passes CI silently.

**Fix:** Decouple the accent-resolution key from the visible label. Cleanest options
(no edit to the frozen leaf is required for the first):
```tsx
// ScenarioComposer.tsx — pass a window-true heading instead of leaning on the leaf LABELS,
// OR (preferred) have RollingMetrics accept an optional label override:
<RollingMetrics
  data={blendPanels.rollingSharpe}
  daysOfHistory={blendPanels.usableN}
  seriesLabels={{ sharpe_365d: `${rollingWindow}d` }}  // new optional prop, falls back to LABELS
/>
```
If touching `RollingMetrics` is out of scope, at minimum have the adapter key the series on
the actual window (`sharpe_${window}d`) and extend `STROKE_BY_KEY`/`LABELS` so 63/126/252
each resolve `CHART_ACCENT` and a truthful label — but that changes the leaf, so the prop
override is the lower-risk fix. Add a test that asserts the rendered legend/tooltip text
matches the selected window.

### WR-02: Distribution-panel empty gate diverges from the adapter guard — non-finite engine output yields a headed-but-empty panel with no banner

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2124`

**Issue:** The Returns-distribution panel gates its empty branch on
`portfolioDaily.length < 10`, but the adapter (`buildBlendPanels`) collapses EVERY series
to `[]`/`{}` on a STRICTER condition — `hasNonFinite || length < MIN_USABLE || length <
window`. The two predicates disagree when `portfolioDaily` has ≥ 10 points but contains a
non-finite value (NaN / ±Infinity). In that case the composer takes the populated branch
(`length ≥ 10`), renders the "Return histogram" / "Return quantiles" sub-headings + the
`{n} overlapping daily returns` disclosure, but `blendPanels.histogramSeries` is `[]` and
`blendPanels.quantiles` is `{}`, so `ReturnHistogram` (`returns.length < 10 → null`) and
`ReturnQuantiles` (`periods.length === 0 → null`) both render nothing. Result: two empty
headings and a disclosure claiming N overlapping returns, with NO "Awaiting more data"
banner — the opposite of the honest-empty contract the rest of the panel upholds. A
high-leverage leg (up to the 10x ceiling) producing a ≤ -1 daily return, or any upstream
data-quality NaN, is the realistic trigger. The Rolling-metrics panel has the same class of
divergence (it gates on `usableN < rollingWindow`, but `usableN` counts finite points while
`hasNonFinite` collapses regardless), though there the count mismatch makes it less likely
to head-but-empty.

**Fix:** Make the host gate read the adapter's own emptiness signal so the two can never
disagree. The adapter already exposes `usableN`; gate the distribution panel on the same
quantity the adapter uses, or expose a single `degenerate` boolean from `buildBlendPanels`:
```tsx
// Gate on the adapter's verdict, not a re-derived length:
{blendPanels.histogramSeries.length === 0 ? (
  <PartialDataBanner heading="Awaiting more data" body="This portfolio needs at least 10 overlapping daily returns to chart its distribution." />
) : ( /* populated body */ )}
```
Add a regression test that injects a non-finite point into a ≥10-length series and asserts
the panel shows the `role="status"` banner (not empty headings).

## Info

### IN-01: `WINDOW_LABEL` dead fallback / unreachable arm

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:136-140`, used at `:2180`

**Issue:** `WINDOW_LABEL` maps only `63|126|252`, and `rollingWindow` is only ever set to
those three values (initial `useState(126)` + the `SegmentedControl` options `"63"|"126"|"252"`).
The `?? \`${rollingWindow}-day\`` fallback in the banner body (`:2180`) is therefore
unreachable in current code. Not a bug — it is defensive and harmless — but it is dead by
construction. Leave as-is (cheap robustness) or drop the fallback if strict no-dead-code is
preferred; flagging only for completeness.

**Fix:** Optional — none required. If removing: `WINDOW_LABEL[rollingWindow]` is provably
defined for all reachable `rollingWindow` values.

---

_Reviewed: 2026-06-23T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
