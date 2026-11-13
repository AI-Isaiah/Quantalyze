---
phase: 194-figuretruth
round: 3
reviewed: 2026-11-08T00:30:00Z
reviewed_range: ea523bee1..cf90e373a
depth: standard
files_reviewed: 26
files_reviewed_list:
  - analytics-service/routers/match.py
  - analytics-service/services/match_engine.py
  - analytics-service/services/portfolio_optimizer.py
  - analytics-service/tests/test_match_engine.py
  - analytics-service/tests/test_portfolio_optimizer.py
  - scripts/seed-demo-data.ts
  - src/__tests__/seed-demo-data-kpi-series.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.book-btc.test.tsx
  - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx
  - src/app/factsheet/[id]/tearsheet/page.rank-gate.test.tsx
  - src/app/factsheet/[id]/tearsheet/page.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.figure-gate.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/components/portfolio/PortfolioOptimizer.test.tsx
  - src/components/portfolio/PortfolioOptimizer.tsx
  - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
  - src/lib/factsheet/comparator-block.ts
  - src/lib/factsheet/types.ts
  - src/lib/portfolio-analytics-adapter.test.ts
  - src/lib/portfolio-analytics-adapter.ts
  - src/lib/scenario-peer-request.test.ts
  - src/lib/scenario-peer-request.test.tsx
  - src/lib/scenario-peer-request.ts
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
status: issues_found
---

# Phase 194: Code Review Report, round 3

**Reviewed:** 2026-11-08, range `ea523bee1..cf90e373a` (17 commits), `.planning/` excluded
**Depth:** standard, plus call-chain reads where a fix depends on another file (KpiStrip, BatchDPanels, PercentileRankBadge, queries.ts live baseline, routers/portfolio.py)
**Status:** issues_found. 3 MEDIUM, 0 HIGH, 0 CRITICAL. The brief asked for MEDIUM and above only, so LOW and INFO are left out.

## Summary

Judged against D-11 and D-13 to D-19 in `194-CONTEXT.md`.

I ran the touched tests at HEAD:
- vitest: the 8 touched files, 144 passed;
- pytest: `test_match_engine.py` and `test_portfolio_optimizer.py`, 112 passed;
- pytest: every other `tests/*match*.py`, 350 passed.

**Fixes I checked and found closed:**
- **Round-2 WR-01 (benchmark note, D-16).** `comparator-block.ts:96-98` carries `coveredShortSpanDays` only under 365 days. `MetricsColumn.tsx:367-370` shows the benchmark note only at full history, only while the cells show (`gateState !== "withheld"`, `hb != null`), so D-19 still decides the withhold. The test (`MetricsColumn.figure-gate.test.tsx`, 731-day strategy, 20-day comparator) fails if the note is removed. The factsheet cache key is still the unreleased v21, so no deployed cache entry is missing the field.
- **Round-2 WR-02 (match engine lift gate).** `match_engine.py:805-811` gates each side on its real class through `blend_gate_crypto`. An unknown class still counts as crypto, the stricter side. The router projects `asset_class` for candidates (`match.py:421`, `:566`) and for book legs (`:1223`, `:1287-1290`). `portfolio_strategies` has one FK to `strategies`, so the `strategies(asset_class)` embed is unambiguous. Engine tests at 62 and 59 observations, plus an end-to-end `score_candidates` test, can fail. See WR-03 below for the router half.
- **R2-M3 (optimizer, unknown candidate class).** `portfolio_optimizer.py:177-179` makes an unknown candidate crypto, the same as the book side. `routers/portfolio.py:619-634` projects candidate classes, so known candidates keep their real bound.
- **R2-M1 / R2-M2 (optimizer card).** `PortfolioOptimizer.tsx:158-195`: a present out-of-set state is withheld and reported, an absent or null state shows as before (D-17), and a withheld lift with an unreadable record gets a reason and a report. The adapter (`portfolio-analytics-adapter.ts:197-200`) fails closed in the same way. No UI reads the adapter's `sharpe_lift_state`, so the adapter sending no report has no visible effect.
- **WR-01 (tearsheet ranks).** `tearsheet/page.tsx:643-650`: when the record is withheld or the span read fails (`gateState` is `"withheld"` for a null record, `:446`), the CAGR, Sharpe, Sortino and Volatility ranks are not rendered, and the Max DD rank stays. Both new tests can fail.
- **WR-02 (scenario peer request, D-18).** `scenario-peer-request.ts` no longer judges the record, and `PeerPercentilePanel` (`BatchDPanels.tsx:136-152`) blanks Sharpe and Sortino from the payload's own blend record. Max DD stays. The new jsdom test renders the panel and can fail.
- **WR-04 (alpha widget beta).** `AlphaBetaDecomposition.tsx:150-158` keeps the beta and its contribution when alpha is withheld. This matches the Overview, which sets only alpha, IR, TE and Treynor to NaN (`comparator-block.ts:167-169`).
- **WR-05 (seed span).** 366 returns span 365 days. The test fails at 365.
- **WR-03 (rolling caption).** `ScenarioComposer.tsx:6545` prints `blendBasis`, the same basis `deriveBlendPanels` receives (`:4210-4216`). But two sibling captions on the same Scenario factsheet still hard-code 252 (WR-02 below).

**Partly closed:** CR-01. See WR-01 below.

Necessity was not assessed. I did not read `necessity-review.md` this round, so `necessity:` is left out of the frontmatter.

## Warnings

### WR-01: CR-01 gated the footer's Sharpe delta on both records, but the "Scenario blend" strip shows the same delta gated on the blend alone (MEDIUM, user-facing)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:4155-4164` (`gatedBlendMetrics`), `:5967-5975` (KpiStrip props), `:4860-4864` (footer state); `src/app/(dashboard)/allocations/components/KpiStrip.tsx:487-516`, `:552-555`

**Issue:** CR-01 now judges the footer's Sharpe chip with `gateDelta(records.blend, records.book, …)`. The KpiStrip on the same page works differently:
- in scenario mode it computes its own Sharpe delta pill as `scenarioMetrics.sharpe − liveMetrics.sharpe`;
- `scenarioMetrics` is `gatedBlendMetrics`, gated only on `blendGateState`;
- `liveMetrics` is `liveMetricsForKpi`, the book's Sharpe from `computeScenario` over the per-key dailies (`queries.ts:4271-4302`), with no gate at all.

Failure scenario: an allocator whose book was connected 45 days ago composes a 400-day crypto blend.
- The footer drops the Sharpe chip, which is correct, because the book's record fails D-15.
- The strip directly above still prints "+1.2 vs current book".
- The strip's `title` prints "Current book: 3.41", an annualised book Sharpe from 45 days.

That is two verdicts for one delta on one page (TRUST-05), and an annualised figure shown while its total record is withheld. The CR-01 test (`ScenarioComposer.d11.test.tsx`, "a withheld LIVE BOOK record") checks the footer only, so it stays green.

A second gap in the same area: when `scenarioOwnBookDelta` is undefined, the footer falls back to the blend's state alone (`:4864`). That happens when the own-book series is rebuilding (`equityHistoryState !== "ready"`, `:1111-1119`) or holds a non-finite return (`:4283-4289`). `live.sharpe` still comes from `liveBaselineMetrics` (D-03 keeps it). So during a rebuild, the book side of the delta is not judged at all.

**Fix (minimal):** compute `sharpeDeltaState` once, outside `deltaSummary`, and pass both surfaces the same gated live Sharpe:

```tsx
const sharpeDeltaState = useMemo(() => {
  const r = scenarioOwnBookDelta?.records;
  return r !== undefined ? gateDelta(r.blend, r.book, scenarioOwnBookDelta?.span_days ?? null) : blendGateState;
}, [scenarioOwnBookDelta, blendGateState]);
const gatedLiveForDelta = useMemo<ComputedMetrics>(
  () => ({ ...liveMetricsForKpi, sharpe: gatedValue(liveMetricsForKpi.sharpe, sharpeDeltaState) }),
  [liveMetricsForKpi, sharpeDeltaState],
);
// KpiStrip: liveMetrics={gatedLiveForDelta}; deltaSummary: reuse sharpeDeltaState
```

Pin it in the d11 harness: with a 60-day book beside a 400-day blend, the `KpiStrip` mock's `liveMetrics.sharpe` is `null`.

The rebuild case needs its own answer, because the book record cannot be built from the hidden series. Either build it from the live baseline's own window (the per-key `computeScenario` effective dates and `n`), or treat "a live Sharpe with no readable record" as withheld, as the tearsheet does for an unreadable span (`tearsheet/page.tsx:427-446`). Choosing between the two is a D-17 question, so route it to the founder rather than letting the fixer decide.

### WR-02: Sibling of WR-03. Two more captions on the Scenario factsheet still say "sample/252 basis" for a crypto blend annualised at √365 (MEDIUM, user-facing, pre-existing)

**File:** `src/app/factsheet/[id]/v2/BatchDPanels.tsx:160` (PeerPercentilePanel), `:236` (OwnBookDeltaPanel)

**Issue:** WR-03 fixed the rolling panel's caption. Two other captions on the same Scenario factsheet still hard-code the basis:
- the peer panel's disclosure, "hypothetical blend · ranked vs verified strategies · sample/252 basis";
- the own-book delta panel's disclosure, "Delta = blend minus your live book · sample/252 basis · …".

The values beside them are not on that basis:
- the peer request carries `scenarioMetrics.sharpe` and `sortino` at `blendBasis` (`ScenarioComposer.tsx:3733-3745`, `:4074-4077`), which is 365 when any leg is crypto or unknown;
- the own-book delta annualises both legs at `blendBasis` too (`:4294`, BLEND-01).

For any crypto blend, the default on this product, the caption names the wrong annualisation basis next to the figure. This is the crypto/traditional mix-up WR-03 was raised for, left in two places. It predates this phase (v0.34). It is reported here because the WR-03 fix leaves the page disagreeing with itself: the rolling caption says 365 and the two panel captions say 252.

**Fix:** read the basis from the blend record the payload already carries:

```tsx
const basisDays = payload.figureRecord?.crypto === false ? 252 : 365;
// ... `sample/${basisDays} basis`
```

Or add the blend's `periodsPerYear` to the scenario payload and read that. Update any test that pins the literal "sample/252".

### WR-03: The router half of the WR-02 fix has no test, so losing the `asset_class` projection would bring the defect back with every test green (MEDIUM, gate cannot fail)

**File:** `analytics-service/routers/match.py:421`, `:566`, `:1223`, `:1287-1290`

**Issue:** The engine tests (`test_match_engine.py`, the WR-02 block) pass `candidate_asset_class` and `book_asset_classes` directly. Nothing tests that the router fills them in. `grep asset_class tests/*match*.py` finds only `test_match_engine.py`.

Failure scenario: someone edits either select string, or renames the `strategies(asset_class)` embed. Then `cand.get("asset_class")` and the book map read `None`, every record falls back to the crypto 90-day bound, and a traditional strategy with 60 to 89 days loses its "Lifts portfolio Sharpe" reason again. The other readers would still show the lift. Every engine and router test stays green. The failure runs in the conservative direction, which is why this is MEDIUM and not HIGH. But it is exactly round-2 WR-02, and nothing guards against it coming back.

**Fix:** add one router-level test in `tests/test_match_router.py` (or the universe-loader test), on the existing fake-supabase fixture:
- a `strategies` row with `asset_class: "traditional"`: assert that `_load_candidate_universe()` gives that candidate `"asset_class" == "traditional"`;
- a `portfolio_strategies` row with `strategies: {"asset_class": "traditional"}`: assert that `_load_allocator_context(...)["portfolio_strategies"][0]["asset_class"] == "traditional"`.

Each assertion fails if its projection is dropped.

---

_Reviewed: 2026-11-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
