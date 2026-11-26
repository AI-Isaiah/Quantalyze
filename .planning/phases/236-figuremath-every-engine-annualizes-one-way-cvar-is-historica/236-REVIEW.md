---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
reviewed: 2026-11-25T19:24:34Z
depth: deep
files_reviewed: 102
files_reviewed_list:
  - .github/dependabot.yml
  - TODOS.md
  - analytics-service/models/schemas.py
  - analytics-service/requirements-dev.txt
  - analytics-service/requirements.in
  - analytics-service/requirements.txt
  - analytics-service/routers/optimizer.py
  - analytics-service/services/allocated_capital.py
  - analytics-service/services/figure_conventions.py
  - analytics-service/services/metrics.py
  - analytics-service/services/optimizer.py
  - analytics-service/services/portfolio_metrics.py
  - analytics-service/services/portfolio_optimizer.py
  - analytics-service/tests/fixtures/annualization_parity_vectors.json
  - analytics-service/tests/fixtures/constit_parity_golden.json
  - analytics-service/tests/fixtures/figure_parity_vectors.json
  - analytics-service/tests/fixtures/golden_252d_expected.json
  - analytics-service/tests/qstats_gate.py
  - analytics-service/tests/test_annualization_census.py
  - analytics-service/tests/test_annualization_parity.py
  - analytics-service/tests/test_constit_blend_parity.py
  - analytics-service/tests/test_dispersion_floor_sites.py
  - analytics-service/tests/test_e2_parity_oracle.py
  - analytics-service/tests/test_figure_conventions.py
  - analytics-service/tests/test_figure_gate_span.py
  - analytics-service/tests/test_figure_parity.py
  - analytics-service/tests/test_metrics.py
  - analytics-service/tests/test_optimizer.py
  - analytics-service/tests/test_optimizer_parity.py
  - analytics-service/tests/test_optimizer_route.py
  - analytics-service/tests/test_portfolio_metrics.py
  - analytics-service/tests/test_qstats_gate.py
  - docs/runbooks/figuremath-fleet-rederive.md
  - docs/runbooks/metrics-nan-policy.md
  - scripts/capture-constit-parity-golden.ts
  - src/__tests__/annualization-census.test.ts
  - src/__tests__/annualization-parity.test.ts
  - src/__tests__/cvar-reader-census.test.ts
  - src/__tests__/phase-29-frozen-spine-guards.test.ts
  - src/__tests__/phase-52-frozen-spine-guards.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.test.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx
  - src/app/(dashboard)/allocations/lib/book-figures.ts
  - src/app/(dashboard)/allocations/lib/scenario-benchmark.ts
  - src/app/(dashboard)/allocations/lib/scenario-stress.test.ts
  - src/app/(dashboard)/allocations/lib/scenario-stress.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.boundary.test.tsx
  - src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx
  - src/app/(dashboard)/allocations/widgets/widgets.signed-zero.test.tsx
  - src/app/(dashboard)/compare/lib/holding-compare-adapter.test.ts
  - src/app/(dashboard)/compare/lib/holding-compare-adapter.ts
  - src/app/api/scenario/optimize/route.test.ts
  - src/app/api/scenario/optimize/route.ts
  - src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.cagr-span.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/TimeSeriesChart.coverage-gap.test.tsx
  - src/lib/analytics-client.test.ts
  - src/lib/analytics-client.ts
  - src/lib/closed-sets.test.ts
  - src/lib/closed-sets.ts
  - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
  - src/lib/factsheet/allocator-portfolio-payload.test.ts
  - src/lib/factsheet/basis-metrics.test.ts
  - src/lib/factsheet/bootstrap.conventions.test.ts
  - src/lib/factsheet/bootstrap.ts
  - src/lib/factsheet/build-payload.benchmark-opt.test.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/compute.conventions.test.ts
  - src/lib/factsheet/compute.metrics.test.ts
  - src/lib/factsheet/compute.ts
  - src/lib/factsheet/cvar-floor.test.ts
  - src/lib/factsheet/fetch-and-build-payload.test.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/joint.test.ts
  - src/lib/factsheet/joint.ts
  - src/lib/factsheet/og-metrics.test.ts
  - src/lib/factsheet/og-metrics.ts
  - src/lib/factsheet/record-length.test.ts
  - src/lib/factsheet/record-length.ts
  - src/lib/factsheet/return-stats.sites-joint.test.ts
  - src/lib/factsheet/return-stats.sites.test.ts
  - src/lib/factsheet/rolling.test.ts
  - src/lib/factsheet/rolling.ts
  - src/lib/factsheet/types.ts
  - src/lib/figure-conventions.test.ts
  - src/lib/figure-conventions.ts
  - src/lib/figure-gate.ts
  - src/lib/portfolio-stats.ts
  - src/lib/resilient-fetch.wiring.test.ts
  - src/lib/return-stats.sites.test.ts
  - src/lib/sample-basis-ratios.ts
  - src/lib/scenario-blend-adapter.test.ts
  - src/lib/scenario-blend-adapter.ts
  - src/lib/scenario-blend07.test.ts
  - src/lib/scenario.test.ts
  - src/lib/scenario.ts
findings:
  critical: 3
  warning: 4
  info: 15
  total: 22
  necessity: 2
status: clean
---

# Phase 236: Code Review Report

**Reviewed:** 2026-11-25T19:24:34Z
**Depth:** deep
**Files Reviewed:** 102
**Status:** issues_found

## Summary

Scope: `git diff 8507564ef..HEAD -- . ':!.planning'` on `gsd/phase-236-figuremath`, which is 102 files. I read the
phase CONTEXT (with the locked Q1, Q2 and Q3 rulings), REQUIREMENTS FIG-01..05, F-5 and F-6,
`236-QUANTSTATS-DECISIONS.md`, `236-FIGURES-MOVED.md`, the 236-0x SUMMARYs that bear on the findings, and the
necessity rubric. Call chains were traced into code the diff does not touch: `basis-context.tsx`,
`AllocationDashboardV2.tsx`, `StressVarSection.tsx`, `page.tsx`'s payload cache, `nav_twr._last_interior_break_suffix`,
`analytics_runner.run_csv_strategy_analytics`, and the latest `enqueue_compute_job` / `_assert_owner`.

The engine arithmetic itself holds up:
- Python's stored CAGR, the whole-day TS helper, XIRR on 365 and the Python sd sites are correct.
- The smart ratios now use `sqrt(periods_per_year)`.
- The serenity historical tail matches 0.0.86 `method="historical"`.
- The pydantic and route closed sets agree.
- The constit golden CAGR re-pin checks out: I recomputed `(1+twr)^(365/119)-1 = 0.9500320554` from
  `portfolio_daily_returns` independently. I did NOT independently recompute the hand-moved
  `golden_252d_expected.json` `serenity_index` (0.01893104775322315).

The defects sit where the rules meet the surfaces:
- The total-record CVaR floor is applied to exactly one whole-record object (`overlaid`). Every other
  whole-record figure bypasses it: the MTM and smoothed bundles, and the leverage re-derive.
- On a chain-broken row, the TS floor counts a different "total record" than Python does.
- The Q1 span line only exists where a stored row supplies `cagr_start`. The allocator book, which is the
  surface the deleted `167.1.2.2.1-CAGR-EMPTY-SPAN` entry named, never states its span.
- The factsheet payload cache key was not moved even though computed values change at deploy.
- The PROD runbook cannot produce the per-figure aggregates FIG-05 needs for two of the figures it lists as moving.

Necessity: two findings (IN-02, IN-03) carry the necessity marker.

## Critical Issues

### CR-01: The CVaR floor is bypassed on whole-record figures outside `overlaid` (MTM/smoothed basis, leverage what-if)

**File:** `src/lib/factsheet/build-payload.ts:894-899`, `src/lib/factsheet/build-payload.ts:1036-1050`, `src/app/factsheet/[id]/v2/basis-context.tsx:404`
**Issue:** Q2 (locked): CVaR is null when the TOTAL record has fewer than 60 observations, and only a
zoomed window always shows it. The floor is applied once, to `overlaid` (the cash `strategyMetrics`). The same
builder also emits `seriesByBasis.mark_to_market` and `seriesByBasis.smoothed_mtm` through
`deriveSeriesBundle`. Their `strategyMetrics` is `compute()` over the whole record with no floor. `useWindowedView`
merges that bundle into `view.strategyMetrics` at full history, and MetricsColumn prints `m.cvar95` from
it (lines 624, 802 and 1572). The leverage what-if is the same: at L != 1 it re-derives
`deriveSeriesBundle(levered, …)` (basis-context.tsx:404) over the whole record. So a 40-observation record
shows "—" for CVaR on cash and a number on MTM, smoothed, or under leverage. All three are full-history views of
the same record, which contradicts Q2 on a user-facing surface. `cvar-reader-census.test.ts` classifies by
file, so it marks build-payload as "total-record (floored)" and cannot see the unfloored bundles emitted from
the same file (see WR-03).
**Fix:** Apply the floor where every whole-record `strategyMetrics` is final, not only on `overlaid`. The minimal
version reuses `cvarRecordObs`, which is a fact about the record and not about the basis:
```ts
const floorCvar = <T extends { cvar95: number }>(m: T): T =>
  cvarRecordObs < CVAR_MIN_OBS ? { ...m, cvar95: NaN } : m;
// apply to overlaid, and to each deriveSeriesBundle(...).strategyMetrics built at lines 1038/1062
```
Carry the record count on the payload (it already rides `figureRecord`) so the leverage arm in
`basis-context.tsx` applies the same floor to `lb.strategyMetrics`. The window arm (line 660) stays
unfloored. Add a test at n = 59 per basis and at L = 2.

### CR-02: Chain-broken rows: the TS floor counts the headline suffix while the Python floor counts the whole record

**File:** `src/lib/factsheet/build-payload.ts:894-897`, `src/lib/factsheet/fetch-and-build-payload.ts:944`, `analytics-service/services/metrics.py:2602`, `analytics-service/services/metrics.py:2628`
**Issue:** Python floors stored `cvar` on `_historical_var_cvar(returns)`. `returns` there is the whole record:
it is not reassigned to `headline` anywhere between lines 1994 and 2602. TS floors on
`opts.recordObservations`, which is the stored `metrics_json.record_observations =
int(headline.dropna().shape[0])`. On a chain-broken row (FACTSHEETTRUTH D-01), `headline` is the
post-break SUFFIX. Take a row with 200 total observations and 40 after its last break:
- Python stores a CVaR (200 >= 60), and that value is computed over all 200 days.
- The factsheet overrides it to "—" (40 < 60).

The two engines disagree on one strategy, and the TS side is not the "TOTAL record" that Q2 names. No test
covers a chain-broken record. `cvar-floor.test.ts` feeds `recordObservations` directly.
**Fix:** Floor on the same count Python uses. The least intrusive way is to store it: add
`metrics_json.cvar_observations = len(returns.dropna())` beside `cvar` (additive key, no migration), and read it in
`fetch-and-build-payload.ts` as the floor's count, falling back to `stratRet`'s finite count. Alternatively, have the
TS floor trust a stored v3 `cvar` as already floored and floor only the computed fallback. Pin it with a
chain-broken fixture: 200 total observations, 40 in the suffix.

### CR-03: Phase-goal gap: the allocator book (and every full-history view whose CAGR is computed) never states its CAGR span

**File:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx:447-454`, `src/lib/factsheet/fetch-and-build-payload.ts:965-980`, `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:189`
**Issue:** Q1 (locked) says "The factsheet states the span CAGR covers." `cagrStart`/`cagrEnd` are set only by
`fetch-and-build-payload`, and only when the stored cash headline was admitted. At full history,
MetricsColumn shows the line only when `railBasis === "cash_settlement"` AND the payload carries the stored
keys. So there is no span line on:
- the allocator-book factsheet (`buildAllocatorPortfolioFactsheetPayload`, rendered by AllocationDashboardV2),
- the MTM and smoothed bases,
- any unadmitted or composite row,
- every v2 row until the fleet re-derive.

On all of these, the CAGR shown is `compute()`'s, whose span is `m.start`..`m.end`. The deleted TODOS entry
`167.1.2.2.1-CAGR-EMPTY-SPAN` named "the first allocator-facing factsheet or book whose span contains an emptied stretch"
as its trigger, and "the factsheet states the span it annualized over, with a test on a book with an emptied
stretch" as its gate. The shipped tests exercise a strategy row with stored keys (`MetricsColumn.cagr-span.test.tsx`),
not a book. So the entry was deleted as closed with its gate unmet.
**Fix:** When no stored span describes the shown CAGR, state the span of the CAGR that IS shown:
```ts
const storedSpan = railBasis === "cash_settlement" ? formatCagrSpan(payload.cagrStart, payload.cagrEnd) : null;
const cagrSpanText = gv(m.cagr) === null ? null
  : selected ? formatCagrSpan(m.start, m.end)
  : storedSpan ?? (cagrIsComputed ? formatCagrSpan(m.start, m.end) : null);
```
Here `cagrIsComputed` is true when no stored cash headline was overlaid (it can be derived from
`payload.metricsByBasis?.cash_settlement` being absent, or a non-cash basis). Add an
AllocationDashboardV2/allocator-payload test with an emptied stretch, and restore the TODOS entry until it passes.

## Warnings

### WR-01: The factsheet payload cache key was not moved although computed values change at deploy

**File:** `src/app/factsheet/[id]/v2/page.tsx:345`
**Issue:** `["factsheet-v2-payload-v27", id, computedAt, …]` is identical at base and HEAD. This phase changes the
payload's VALUES for the same inputs:
- `compute()`'s ddof 0→1 for vol and Sharpe, and its 365.25→365 whole-day CAGR and Calmar,
- the rolling 126- and 30-row sd, joint TE/IR and the bootstrap band,
- the new CVaR floor,
- the new `cagrStart`/`cagrEnd` fields.

None of the key's members move at deploy. The file's own history bumps the key for exactly this case: v17→v18,
v21→v22 and v22→v23 all read "the key's other members do not move at deploy, so … an entry built before the
deploy would keep serving the old figures for the 1 h TTL drain". The OG card was bumped (3→4) for the same reason and this
key was not. For up to an hour (plus stale-while-revalidate), a cached page shows pre-F-5 figures and an
unfloored CVaR beside a fresh v4 OG card.
**Fix:** Bump to `factsheet-v2-payload-v28` with a dated note in the established form ("Bumped v27→v28 (Phase 236
FIGUREMATH): values change without … ; `cagrStart`/`cagrEnd` added"). Update the keyParts comment in
`fetch-and-build-payload.ts:752`.

### WR-02: Runbook "before"/"after" reads omit two figures the runbook itself says move, so FIG-05's aggregates cannot be produced for them

**File:** `docs/runbooks/figuremath-fleet-rederive.md:20-23`, `docs/runbooks/figuremath-fleet-rederive.md:88-105`, `docs/runbooks/figuremath-fleet-rederive.md:289-296`
**Issue:** Lines 20-23 list `time_in_market` and `probabilistic_sharpe_ratio` among the stored figures that change
on re-derive. The `236-QUANTSTATS-DECISIONS.md` rows give the same list. Section 3's read captures `cvar`, `serenity_index`,
`common_sense_ratio`, `smart_sharpe`, `smart_sortino`, `alpha` and `cagr_start`, but neither of those two keys.
Section 6 then asks for "per figure … how many strategies changed, min/median/max of after/before".
That is impossible for two moved figures. FIG-05 requires that "the CHANGELOG entry names the figures that moved", and
this read is its only real-data evidence. `cagr_end` and `asset_class` (needed to split
smart_sharpe into crypto versus traditional for the stated 1.2035 check) are also absent.
**Fix:** Add `sa.metrics_json->>'time_in_market'`, `sa.metrics_json->>'probabilistic_sharpe_ratio'`,
`sa.metrics_json->>'cagr_end'` and `s.asset_class` (join `public.strategies s ON s.id = sa.strategy_id`) to the section 3
SELECT, which section 6 reuses.

### WR-03: The CVaR reader census cannot fail on the class of bug in CR-01 and misses bare `.cvar` readers

**File:** `src/__tests__/cvar-reader-census.test.ts:77`, `src/__tests__/cvar-reader-census.test.ts:155-161`
**Issue:** The census claims "a new reader cannot ship unclassified". But:
- `READER` matches `cvar95|computeExpectedShortfall|historicalVarCvar|cvar_95|expected_shortfall`, so a file reading a
  stored or computed `.cvar` is invisible. `StressVarSection.tsx` (`result.cvar`) is a live, unlisted reader today.
- The "total-record" arm passes if `CVAR_MIN_OBS` appears ANYWHERE in the file's code. So build-payload passes
  while emitting two unfloored whole-record bundles (CR-01).

A census that is green over the defect it exists to prevent is close to vacuous for that class.
**Fix:** Add `\bcvar\b` to `READER` and classify `StressVarSection.tsx` as display. Pin behaviour, not text, for
the total-record class: add a behavioural arm in `cvar-floor.test.ts` asserting `cvar95` is NaN at n = 59 on
`seriesByBasis.mark_to_market.strategyMetrics`, `seriesByBasis.smoothed_mtm.strategyMetrics` and a levered view.

### WR-04: The PROD runbook accepts that a failed re-derive un-publishes a strategy, but has no pre-flight and no recovery step

**File:** `docs/runbooks/figuremath-fleet-rederive.md:163-167`, `docs/runbooks/figuremath-fleet-rederive.md:208-231`
**Issue:** The batch is unmarked by design, so any failure takes the runner's loud path and stamps the row
`failed`. For example, `run_csv_strategy_analytics` with fewer than 2 `csv_daily_returns` rows upserts
`computation_status='failed'` with `data_quality_flags: {"csv_source": True}` (analytics_runner.py ~1938-1975).
That un-publishes a published factsheet. The runbook's only mitigations are batch size 10 and "stop and read why".
It has no read-only pre-flight that each target has a recomputable series. It also has no step that says how to
restore a row it stamped failed, and a failed row then drops out of every later target query
(`computation_status IN ('complete', …)`). That is a PROD data-integrity risk on the founder's published
strategies, executed by hand from this document.
**Fix:** Add a read-only pre-flight before section 4. It counts targets whose `csv_daily_returns` has fewer than 2
rows, using the same marker-first single-statement form, and STOPs if the count is non-zero. Add a "Recovery" subsection: for a row
stamped failed by a `figuremath-236-rederive` job, fix the cause and re-enqueue the same kind. Name the failed
ids, which the batch-outcome query does not return today.

## Info

LOW and Info survivors (recorded here only, per the repo's TODOS rule (a)):

- **IN-01: Optimizer `periods_per_year` is required, so a stale tab gets a 400 shown as "refused".**
  `src/app/api/scenario/optimize/route.ts:114-124`, `WeightOptimizerSection.tsx:168-172`. A browser tab holding the
  pre-deploy bundle posts without the field. The route answers 400, and the component maps any 4xx to "refused", which
  states the optimizer judged the data. The clock moves no weight (`optimizer.py` `_annualized_moments` docstring), so
  defaulting an absent field to `PERIODS_PER_YEAR_CRYPTO` at the route is enough. Pydantic's default `extra="ignore"`
  makes Vercel-first ordering safe against the old Python.
- **IN-02: Already-defended-elsewhere: the Scenario-stress CVaR floor is unreachable through the UI.** **Category:** necessity.
  `scenario-stress.ts:198`. Its only caller, `StressVarSection.tsx:163-172`, renders `SampleFloorEmptyState`
  whenever `n < SAMPLE_FLOOR_OVERLAPPING_DAYS` (60, `src/lib/sample-floor.ts:37`) before any CVaR row draws.
  Also, on a `state.window` Scenario that series is a window, which sits in tension with A6's "a zoomed window never nulls it".
  This is judgment-level: it rests on `scenarioMetrics.n === portfolio_daily_returns.length`.
- **IN-03: Necessity (judgment): a required closed-set `periods_per_year` on a scale-invariant optimizer.** **Category:** necessity.
  `analytics-service/models/schemas.py:344`. The docstring proves no weight moves, so the field's only runtime effect is
  IN-01's failure mode. It was kept because CONTEXT A5 locks the rule. That is a scope call, not a defect.
- **IN-04: `_mirror_keys_defined_by` still tests `P(r)` for `common_sense_ratio` and PSR.** `metrics.py:515-535`. Those mirrors
  moved to `O(r)`, so the broken-mirror WARNING can be spurious or missed on NaN-gap series. The docstring ("P(r) is the
  fillna(0) series the mirrors read") is stale. The effect is log-only.
- **IN-05: Runbook forced allocator compose cannot run as written.** Line 137: `enqueue_compute_job(p_allocator_id := …)`
  through `q()` (the CLI as `postgres`) hits the allocator branch's `auth.role() = 'service_role' OR uid` gate
  (migration 20260515210300, line 285 onward) and raises 42501. Either say it needs a service-role client, or drop it and rely on the cron.
- **IN-06: Runbook WRITE statement prints the marker but is not gated on it.** Lines 210-230. Add
  `WHERE shobj_description(...) = '<marker from cron-manifest>'` to the subquery so the statement itself refuses on a wrong database.
- **IN-07: Runbook can re-select a row forever.** Lines 218-229. A row whose job ends `done` but whose stored version is still not 3
  (no such path found in `run_csv_strategy_analytics`, but none is excluded) is re-picked by `ORDER BY … LIMIT 10` on every
  batch. Excluding rows with a `done` `figuremath-236-rederive` job is enough.
- **IN-08: Runbook done-criterion equality breaks on mid-run inserts.** Lines 270-274. "strategies equals before plus outside"
  fails if a strategy is created during the run. Compare on the `before.csv` id set instead.
- **IN-09: Runbook claim is broader than shown.** Lines 17-18, "Nothing shows a stale-convention stored CVaR". This is true for the factsheet. The
  claim holds only because no other reader of stored `cvar` exists today (measured: none in `src/`, `analytics-service/` or `supabase/migrations`).
- **IN-10: The TS annualization census has no sqrt, `/ 365` or `* 252` tokens** (`annualization-census.test.ts:40-49`),
  unlike its Python twin. Measured: no current escape in `src/`. A future `Math.sqrt(365)` would ship uncounted.
- **IN-11: The unknown-leg 252 (Python) / 365 (TS) asymmetry remains** and is excluded from the parity vectors. It is ruled
  "deliberate and unowned" (`236-FIGURES-MOVED.md`), so it is listed only.
- **IN-12: `wholeCalendarDays` floors raw ms.** A non-ISO local-time date string reaching `compute()` (`new Date(dates[0])`)
  would lose a day across a DST change. Every producer read emits `YYYY-MM-DD`, so this is not reachable today.
- **IN-13: `VarExpectedShortfall`** with 10 <= n < 60 and both VaRs exactly 0 now reads "Insufficient return data" where it
  used to show an ES. This is an edge case.
- **IN-14: The constit golden `_readme` and `capture-constit-parity-golden.ts:315` still say "scenario.ts is byte-untouched"**,
  which this phase made false.
- **IN-15: TODOS.md deletion of the `### QUANTSTATS-0086-REDERIVE-01` heading** left about 590 lines of unrelated open
  entries textually under the preceding heading (236-09-SUMMARY says so). This is ledger hygiene.

---

_Reviewed: 2026-11-25T19:24:34Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 1 (topic D): `docs/runbooks/figuremath-fleet-rederive.md`

All in one commit, `503983e76` (docs only; nothing here was run against PROD or TEST; the SQL was run on an empty local PostgreSQL with stub tables for syntax and the marker gate).

- WR-02 (before/after carry every moved figure): fixed, `503983e76`. Section 3 now selects `time_in_market`, `probabilistic_sharpe_ratio`, `cagr_end`, `computation_status` and `s.asset_class` (join to `strategies`); section 6 lists the per-figure aggregates and the crypto / other split.
- WR-04 (pre-flight, Recovery, failed ids): fixed, `503983e76`. New 3a read-only pre-flight (finite `csv_daily_returns` rows under 2, plus every target carrying a `returns_denominator_config`, listed for an offline parse) with a STOP rule; the other failure conditions read from `run_csv_strategy_analytics` are tabulated. New Recovery subsection; the outcome query names the non-done ids.
- "Done means" must not read a failed recompute as done (a, b, c): fixed, `503983e76`. (a) a per-id status diff between `before.csv` and `after.csv` over the bound target set replaces the net `outside_complete_set` count; (b) the allocator gate is a query with failure condition `not_rederived = 0` (rows with `computed_at <= ENQ_AT`); (c) each batch returns `selected` and `enqueued`, saved per batch, and the stop rule fires when `enqueued < selected`.
- IN-05 (allocator enqueue needs service_role): fixed, `503983e76`. States the 42501, drops the hand compose, and names the product path (the cron's `enqueue_derive_broker_dailies_for_allocator_keys()`, which has no role gate; default is to wait for the 05:30 UTC cron).
- IN-06 (WRITE not gated on the marker): fixed, `503983e76`. `render` fills `<MARKER>` from the manifest; the batch, the forced allocator derive and the Recovery enqueue are gated on it.
- IN-07 (re-select forever): fixed, `503983e76`. The target and batch queries exclude every row with any `figuremath-236-rederive` job.
- IN-08 (mid-run inserts): fixed, `503983e76`. The target set is bound at the start from `before.csv` (`IDS`); the verification and the diff read only it.
- IN-09 (stale-CVaR claim): fixed, `503983e76`. Narrowed to the factsheet's `storedFigureDefs.cvar95` path behind the version gate, with the grep scope and its limits stated.

## Fix round 1 (topic A): the CVaR floor

Fixer: Claude (gsd-code-fixer), 2026-11-25. Commits are on `gsd/phase-236-figuremath`; nothing pushed.

| Finding | Commit | Status |
|---|---|---|
| CR-01 floor on every whole-record figure set | `53825b816` | fixed: requires human verification (logic) |
| CR-02 TS floor counts the whole record's non-NaN observations | `9ea00c313` (+ `dc08afff6` test fixture follow-up) | fixed: requires human verification (logic) |
| WR-03 / census (`\bcvar\b`, StressVarSection, string check replaced) | `b594507fd` | fixed |
| SFH #8 floor note on the CVaR dash | `de57d6104` | fixed |

- **CR-01.** `deriveSeriesBundle` takes an optional `totalRecordSeries: true`. The mark-to-market and smoothed bundles in `build-payload.ts` and the leverage arm in `basis-context.tsx` pass it, and `cvar95` is NaN when that series has fewer than `CVAR_MIN_OBS` observations. `windowView` does not pass it, so a narrowed window always shows CVaR. New `basis-context.cvar-floor.test.tsx` pins n = 59 per basis (cash, MTM, smoothed), L = 2 on all three bases, the n = 60 controls, and a window arm (30 days, and the whole 59-day range selected as a window).
- **CR-02.** Decision applied as the phase agent ruled: "total record" is every non-NaN observation of the record. `overlaid` now floors on `stratRet.length` (the series is already finite-filtered by `normalizeDailyReturns`), never `record_observations`. Python is untouched. `cvar-floor.test.ts` gains the 200-total / 40-after-break arm (stored CVaR shows; computed fallback is the hand-derived -0.03). The old "stored record_observations decides" test was rewritten to its opposite, and `fetch-and-build-payload.test.ts` now seeds 60 rows in the stored-CVaR test (it seeded 30 rows beside a stored count of 4242).
- **Census.** `READER` gains `\bcvar\b`; the only newly matched file is `StressVarSection.tsx`, classified display. The anywhere-in-file `CVAR_MIN_OBS` check is KEPT and the header now says plainly it is a string check, necessary and not sufficient. It is backed by a `pinnedBy` field: each total-record entry names the behaviour test file(s) that pin its floor, and the census asserts those files exist and use `CVAR_MIN_OBS`.
- **SFH #8.** `Row` in `MetricsColumn.tsx` takes an optional `note`, set on the three CVaR rows by `cvarFloorNote(view)`: shown only when `cvar95` is NaN and the view's `strategyReturns` count is under `CVAR_MIN_OBS`. `VarExpectedShortfall.tsx` shows the same text when `es95 === null` (the n < 10 state returns earlier). Text is `Needs ${CVAR_MIN_OBS} observations`, muted italic `text-fixed-10`, as the file's other notes.

PROOF-01 (each neuter applied to a byte backup, restored with `cp`, `cmp` identical, then GREEN):
- CR-02: count back on `record_observations` -> RED on the 200/40 arm and the stored-count arm; restored -> 10/10.
- CR-01: floor removed in `deriveSeriesBundle` -> RED on the n = 59 bundle arm and the three L = 2 arms; `totalRecordSeries` dropped from the leverage arm only -> RED on the three L = 2 arms; dropped from the MTM and smoothed callers only -> RED on the n = 59 bundle arm; restored -> 7/7.
- Census: `\bcvar\b` removed from `READER` -> RED naming `StressVarSection.tsx` as a stale entry; `pinnedBy` removed from the widget entry -> RED naming it; restored -> 5/5.
- SFH #8: record-under-floor condition dropped -> RED on the stored-null-CVaR arm; note never emitted -> RED on the floor and window arms; widget note made unconditional -> RED on the 60-return arm; restored -> GREEN.

Deviations and limits:
- The factsheet note has no `selected` guard: a selected window of two or more days always has a finite CVaR, so the note's NaN condition already excludes it. A one-day window arm also stayed GREEN with the guard neutered, so no test can tell the guard apart and it was dropped as dead code.
- CR-01's `totalRecordSeries` floors on each series' OWN finite count (cash, MTM and smoothed each count their own rows), not one shared count carried on the payload. They agree whenever the three series cover the same days. A payload with an MTM series shorter than 60 days beside a 60-plus-day cash record floors the MTM bundle only.
- `StressVarSection.tsx` (IN-02, necessity) was classified, not changed.

## Fix round 1 (topic C): engine and contract findings

Fixer: Claude (gsd-code-fixer), 2026-11-25. Commits are on `gsd/phase-236-figuremath`; nothing pushed.

| Finding | Commit | Status |
|---|---|---|
| C1 `compute()` unparseable first or last date gives the one-day floor and `eq^365 - 1` | `411bc0c1e` | fixed: requires human verification (logic) |
| C2 / WR-01 payload cache key v27 to v28 (dated note; both cache-key pins and the `fetch-and-build-payload.ts` doc comment moved) | `0dc0843f3` | fixed |
| C3 census: camelCase `periodsPerYear = 252\|365` defaults invisible | `7c8b45896` | fixed |
| C4 / IN-04 `_mirror_keys_defined_by` preconditions for `common_sense_ratio` and PSR read `P(r)` | `7ad4bf083` | fixed: requires human verification (logic) |
| C5 scenario optimize upstream 422 is a flat 502 Sentry never sees | `c09dbc987` | fixed |

- **C1.** A non-finite first or last date sets `days` and so `years` to NaN; `cagr` is NaN whenever `years` is not finite and positive (both conventions), so `calmar` is NaN. The one-day floor is kept for a real single-observation record. Test: first-date and last-date `garbage` in `compute.metrics.test.ts`.
- **C2.** One bump for the phase; the note says values change at deploy and `cagrStart` / `cagrEnd` are added.
- **C3.** New token `periodsDefault`. All 18 default sites in 13 files are classified: 8 existing engine entries carry a per-function `default` exempt each; 5 files (`comparator-block.ts`, `scenario-blend-adapter.ts`, `scenario-factsheet-payload.ts`, `ScenarioFactsheetChart.tsx`, `ScenarioBenchmarkSection.tsx`) get a new `default`-class entry; the two files that sat in `REVIEWED_NO_TOKEN` as token-free moved out of it. Engine defaults are unchanged.
- **C4.** The quantile conjunct (`common_sense_ratio`) and the dispersion conjunct (PSR) now read `O(r)`; the docstring says so. New cases: `psr_gapped_constant` in the necessity table (a NaN-gapped constant observed series logs no suspect line), and `test_fig03_common_sense_precondition_reads_the_observed_quantile` (3 losses in 40 observed rows plus 100 gap days: `P(r)`'s 5% quantile is 0 while `O(r)`'s is -0.01, so a broken mirror there is now reported).
- **C5.** `err.status === 422` captures with step `upstream-422-contract-drift`; the response is still the flat 502 with the same body, and no default is added for an absent field. The 424 non-capture case still holds.

PROOF-01 (byte backup, neuter, RED, `cp` restore, `cmp` identical, GREEN):
- C1: non-finite dates back to the `1` floor -> RED on both new date arms; restored -> 39/39.
- C2: key reverted to v27 in `page.tsx` -> RED on four cache-key arms (three in `page.public-cache-key.test.tsx`, one in `page.cache-isolation.test.tsx`); restored -> 100/100.
- C3: token regex neutered -> RED on the stale-file and per-file-count arms; `comparator-block.ts` entry deleted -> RED naming it as an unclassified site; restored -> 10/10.
- C4: both conjuncts back to `P(r)` -> RED on `psr_gapped_constant` and the common-sense arm; restored -> 317 passed over `test_metrics.py` and `test_annualization_census.py`; mypy strict clean.
- C5: the 422 branch disabled -> RED on the new arm; restored -> 41/41.

Limits: the full `src/lib/factsheet` run showed two `fetch-and-build-payload.test.ts` failures on `cvar95` while topic A's files were mid-edit (the stored-CVaR arms); they are outside this topic and none touches the files changed here. tsc over the whole project reports nothing for any file touched here.

## Fix round 1 (topic B): CR-03, the CAGR span on every surface that shows a CAGR

Fixer: Claude (gsd-code-fixer), 2026-11-25. One commit on `gsd/phase-236-figuremath`; nothing pushed.

| Finding | Status |
|---|---|
| CR-03 the span line only appeared for a stored row carrying `cagr_start` | fixed: requires human verification (logic) |

- **Premise check (the stop condition).** `compute()` annualizes over `dates[0]` to `dates[n - 1]` of the series it is handed, and returns exactly those two dates as `start` / `end`. So `m.start` / `m.end` are the CAGR's own span wherever the CAGR is `compute()`'s. They are NOT the span of a STORED CAGR on a chain-broken record: the stored headline covers the post-break suffix, while `buildFromBuildableSeries` runs `compute()` over the whole record (plan 08's "post-break suffix" is the engine test's input, not what the factsheet feeds). That one case therefore states nothing instead of a false span.
- **Fix** (`MetricsColumn.tsx`, `cagrSpanText`). At full history: the stored span where one exists (cash basis, unchanged); otherwise `formatCagrSpan(m.start, m.end)`. Covers the allocator book, the mark-to-market and smoothed bases (the basis's own bundle dates, not the cash span), a row whose headline was not admitted, an older row without the keys, the USD view (its payload carries no `metricsByBasis` or stored keys) and the Scenario composer. The one exception is a stored cash headline with no stored keys on a `twrChainBroken` record, which states nothing.
- **Tests.** `AllocationDashboardV2.cagr-span.test.tsx` (new): the real allocator builder, provider and rail on a book with a 40-day emptied stretch; the line reads Jan 2 to Oct 27, 2026 (298 days), the hole counted (the first curve point is the base, so the first return is Jan 2). `MetricsColumn.cagr-span.test.tsx`: the old "row without keys renders no line" arm now pins the computed span (399 days); new arms for mark-to-market (states its own 179-day span with a stored cash span present), an older stored-headline row without keys (computed span), and the chain-broken stored-headline row (no line).

PROOF-01 (byte backup, neuter, RED, `cp` restore, `cmp` identical, GREEN):
- Fix reverted to the previous `cagrSpanText`: RED on the allocator emptied-stretch arm, the row-without-keys arm, the older-stored-headline arm and the mark-to-market arm (4 failed, 6 passed); restored -> 10/10.
- Chain-broken guard neutered (`storedSuffixUnknown` always false): RED on the chain-broken arm only; restored, `cmp` identical, 9/9.

Gates (Node 22.22.1): `src/lib/factsheet`, `src/app/factsheet`, `src/app/(dashboard)/allocations` 398 files green; `RiskTabPanel.book-series` failed once under load (VaR from 60 returns) and passed alone, with no file it reads touched. `scripts/factsheet-census` and `scripts/copy-census` 120 passed (the census profile-A arm also timed out once under load and passed alone). `tsc --noEmit` clean. eslint on the three changed files: no errors, one existing warning (`nativeUnitReason` unused, line 14, not touched).

Limits and deviations:
- The TODOS entry `167.1.2.2.1-CAGR-EMPTY-SPAN` is not in `TODOS.md` in this tree (deleted already, and CONTEXT has the ship PR name it), so there was nothing to restore. Its gate, a test on a book with an emptied stretch, is now met by the new allocator test.
- A stored cash headline on a chain-broken record that lacks the stored keys states no span until the fleet re-derive writes `cagr_start` / `cagr_end`. That is the same limit plan 11 had, narrowed from "every row without keys" to this one case.
- The mark-to-market and smoothed spans assume the stored MTM or smoothed CAGR covers the same series the bundle's `compute()` ran on (both read the stored MTM series); not independently measured against Python.

## Round 2 (re-review after fix round 1)

status: issues_found

Reviewer: Claude (gsd-code-reviewer), 2026-11-25. Depth: deep. Scope: `git diff 38037d4f8..HEAD -- . ':!.planning'` (24 files, commits `9ea00c313`..`e16cbce20`), with call chains traced into files the fixes do not touch: `scenario-factsheet-payload.ts`, `ledger_refresh_staleness` (migration `20261114151700`), `basis_series.py`, `job_worker.py`'s per-basis derives, Next's `unstable_cache`, `gatedValue`, `formatCagrSpan` and `formatRecordLength`. Read-only: no source file changed, no test run, no database touched. CR-02 is judged against the phase agent's ruling that "total record" means every non-NaN observation, Python's `len(returns.dropna())`.

### Round-1 findings: resolved in code?

| Finding | Resolved | Evidence |
|---|---|---|
| CR-01 floor on whole-record figure sets | **partly** | MTM and smoothed bundles (`build-payload.ts`, `totalRecordSeries: true`) and the leverage arm (`basis-context.tsx`) are floored. The window arm (`windowView`) does not pass the flag. The unflagged cash bundle's `strategyMetrics` is never shown, because the top level uses `overlaid`. The Scenario composer's factsheet is still unfloored: see CR-04. |
| CR-02 count = whole record's finite observations | yes | `overlaid` floors on `stratRet.length`. `normalizeDailyReturns` keeps only finite values, and the stored series it reads (`daily_returns_grid`) drops NaN, so this is Python's `len(returns.dropna())` on single-key rows. |
| CR-03 span on every computed CAGR | yes | `cagrSpanText` falls back to `m.start`/`m.end`. Checked: the allocator book, MTM and smoothed (the single-key per-basis scalar input is `gap_fill(sparse)`, NaN-free, so the stored span equals the bundle's first and last dates), the USD view, Scenario, an older row without keys, and a chain-broken row without keys (shows no span). Leverage is excluded on chain-broken rows (`leverageEligibleFor`). A NaN CAGR, an empty blend (`start: ""`) or a C1 unparseable date makes `gv` or `formatCagrSpan` return null, so the line is never printed under a dash. |
| WR-01 cache key v27 to v28 | yes | `page.tsx` keyParts and the `fetch-and-build-payload.ts` doc comment. |
| WR-02 runbook before/after carry every moved figure | yes | Section 3 SELECT. |
| WR-03 census `\bcvar\b`, StressVarSection, `pinnedBy` | yes, for its named items | The census still classifies `scenario-factsheet-payload.ts` as pass-through, with a false reason: see CR-04. |
| WR-04 pre-flight, Recovery, failed ids | yes in form | Its population is wrong: see CR-05. |
| SFH #8 "Needs 60 observations" note | **no, on the cached path** | The widget is right. `cvarFloorNote` in the factsheet misses on a cache hit: see WR-05. |
| C1 `compute()` NaN years | yes | `years` NaN gives `cagr` and `calmar` NaN. After the JSON cache these become `null`, which `formatRecordLength`, `gatedValue` and `formatCagrSpan` all treat as a dash. Nothing in `src/` does arithmetic on `m.years`. |
| C3 camelCase defaults census | yes | 19 raw hits, 18 counted (one in `scenario-benchmark.ts` is a comment). No typed default (`periodsPerYear: number = 252`) exists. |
| C4 / IN-04 mirror preconditions on `O(r)` | yes | `metrics.py` `_mirror_keys_defined_by`. |
| C5 upstream 422 captured | yes | Python's only 422 is `validation_exception_handler`, whose body carries type and loc only, no `input`. The response is unchanged. |
| Topic D IN-05..IN-09 | yes | All forms gated on `<MARKER>`, the retry tag excluded from re-selection, the bound id set used throughout. |

### CR-04: The Scenario composer's factsheet shows an unfloored CVaR (CR-01 residual)

**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:477` (`buildScenarioFactsheetPayload`), `src/__tests__/cvar-reader-census.test.ts:69`
**Issue:** A non-degenerate blend runs `compute(rets, datesR, 0, periodsPerYear)` over its whole common series and ships `strategyMetrics.cvar95` from it. compute() carries no floor (`compute.ts:265`). The only floor-like gate there is `degenerate` (`datesR.length < 2`), so a blend with 10 to 59 common days reaches `ScenarioFactsheetChart` → `MetricsColumn`. Its CVaR row (`wr(pctSigned(m.cvar95, 2))`) then prints a number. A6 (locked under Q2) says the blend's CVaR is null below `CVAR_MIN_OBS` on that same series, and `StressVarSection` on the same screen honours it. The census entry calls this file pass-through, "sets cvar95: NaN, it never shows a CVaR". That is true only of `emptyComputeSummary()`, so the census is green over the defect.
**Fix:** Floor where the blend's whole-record metrics become final, and reclassify the census entry as `total-record` with a `pinnedBy` test:
```ts
const { eq, dd, ...computed } = compute(rets, datesR, 0, periodsPerYear);
const strategyMetrics = rets.length < CVAR_MIN_OBS ? { ...computed, cvar95: NaN } : computed;
```
Add an arm at 59 and 60 blend days in `scenario-factsheet-payload.test.ts`.

### CR-05: The fleet re-derive runbook only reaches Deribit, sFOX and MT5 strategies, then reports done

**File:** `docs/runbooks/figuremath-fleet-rederive.md` (sections 3, 3a, "Targets still to do", "One batch")
**Issue:** Every population query inner-joins `public.ledger_refresh_staleness`. That view ends `WHERE sv.exchanges && lv.venues` with `venues = ARRAY['deribit','sfox','mt5']` (migration `20261114151700_ledger_staleness_closed_composites.sql:113,255`), and its own comment says "one row per ledger-backed strategy". So these strategies never enter `before.csv`, the bound `IDS`, the pre-flight, the targets or the batches:
- CSV strategies,
- Binance, OKX and Bybit key strategies.

They also never enter the done gates. `still_old = 0`, `left_complete_set = 0` and the per-id diff all pass, so FIG-05 would be recorded as closed while most of the fleet keeps version-2 stored `cvar`, smart ratios and `serenity_index`, with no `cagr_start` or `cagr_end`. The runbook's own scope line and its section 4 table ("CSV strategies — the same call") say they are covered. This predates the fix round (it was present at `38037d4f8`) and round 1 missed it. Every fixed form carries it.
**Fix:** Drop the join and use the view's own composite predicate on `strategies`, in all four forms:
```sql
FROM public.strategy_analytics sa
JOIN public.strategies s ON s.id = sa.strategy_id
WHERE NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id)
```
Then re-run the local stub check.

### WR-05: The factsheet's "Needs 60 observations" note does not show on a cached page

**File:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx:1323` (`cvarFloorNote`)
**Issue:** The note tests `Number.isNaN(view.strategyMetrics.cvar95)`. The strategy page builds its payload through `unstable_cache`, which stores `JSON.stringify(result)` and returns `JSON.parse` on a hit (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:24,254`). So the floored `cvar95: NaN` reaches the client as `null`. That covers the cash `overlaid` value and the cached MTM and smoothed bundles. `Number.isNaN(null)` is false, so the note is missing on every cache hit, which is most views within the 1 h TTL. It shows only on a cache miss, or on views derived in the browser (leverage, window, allocator book). The tests build payloads in memory, so they cannot see it. (`compute.ts`'s own comment names this: "NaN (or the null a JSON cache turns it into)".)
**Fix:** `return !Number.isFinite(view.strategyMetrics.cvar95) && view.strategyReturns.length < CVAR_MIN_OBS ? ... : undefined;` (null-safe). Add an arm that round-trips the payload through `JSON.parse(JSON.stringify(payload))` before rendering.

### LOW / Info (recorded here only)

- The arithmetic CAGR is now NaN on an unparseable first or last date, though it uses no span. Not reachable today.
- A stored v3 `cvar` null beside a TS count of 60 or more (the curve-fallback reader counts bridged zero days) shows a dash with no note.
- The census reason for `MetricsColumn.tsx` ("it decides nothing") is stale now that it decides the note.
- Runbook "What this path rewrites" says per-basis figures go through `overlayStoredFigureDefs` "per basis". It is called for cash only.
- The annualization census's per-function `default` exemptions are pinned by count, not by function.
- On the allocator dashboard, `VarExpectedShortfall` floors on `compositeReturns` while the rail floors on the book payload's series. The two can disagree at the 60 boundary.

_Round 2 reviewed: 2026-11-25. Reviewer: Claude (gsd-code-reviewer). Depth: deep._

## Fix round 2 (runbook)

**CR-05: fixed, commit `a2117de2b`** (only `docs/runbooks/figuremath-fleet-rederive.md`). Nothing was run against PROD or TEST. The SQL and the bind and diff scripts were run on a throwaway local PostgreSQL 16 with stub tables, now deleted.

- **Population.** Every form reads `strategies` and `strategy_analytics`. Composites are dropped by the view's own predicate (`NOT EXISTS strategy_keys`). `ledger_refresh_staleness` is gone from the runbook (one prose mention says why). The before read adds `strategy_status`, `strategy_source` and `key_exchange`.
- **Bound set.** The pre-flight, "Targets still to do" and "One batch" now select `sa.strategy_id = ANY (ARRAY[<IDS>])`, so they act on the bound set rather than re-deriving the population. The bind step prints the bound count per key exchange and the outside-the-set count per status. It writes `bound-ids.txt`, which the per-id diff reads.
- **Kinds and paths.** Every kind with a stored `metrics_json` goes through `compute_analytics_from_csv` via `enqueue_compute_job(p_strategy_id, ...)`, because `run_csv_strategy_analytics` reads only the strategy-keyed `csv_daily_returns`. A CSV upload writes them directly. Every broker key writes them in `derive_broker_dailies`, which is gated on `api_key_id IS NOT NULL` for every venue. Binance, OKX and Bybit are covered by the same tail, and the daily sync re-derives only a strategy with new trades, so an idle strategy needs the explicit enqueue.
- **No safe path:** a strategy with stored analytics but under 2 finite rows. The runbook marks it a STOP and a manual step (a key-backed strategy rebuilds through `derive_broker_dailies`; a CSV re-upload is the owner's). The coordinator can take it out of scope in writing through `$FM_SP/out-of-scope.txt`, then re-run the bind step.
- **Kept:** marker gate, pre-flight, bound set, per-id diff, `enqueued < selected` stop and Recovery. The ledger cooldown note is narrowed to the three ledger venues.
- **Stub check:** one strategy of each kind (CSV, six venues, a composite, a failed row, a version-3 row, a one-row series). The composite and the failed row stayed out of the bound set, the other nine were bound, and the one-row series was the only pre-flight hit. A wrong marker enqueued 0. The out-of-scope id was removed from the bound set, and the diff exited 1 while jobs were pending.
- **Not verified:** whether PROD holds strategies with stored analytics and no series (old trades-path or imported rows). The pre-flight will show it at run time. An unrecognised `key_exchange` value rides the same tail and is to be named in the SUMMARY.

## Fix round 2 (code): CR-04 and WR-05

| Finding | Commit | Status |
|---|---|---|
| CR-04 the Scenario composer's blend CVaR floored on its whole common series | `97270eb81` | fixed |
| WR-05 the "Needs 60 observations" note on a JSON-cached payload | `6b7cc2dc7` | fixed |

- **CR-04.** `buildReturnsBody` destructures `...computed` off `compute()` and sets `cvar95: NaN` when `rets.length < CVAR_MIN_OBS`. A zoomed window re-derives through `windowView`, so it always shows CVaR. The census entry for `scenario-factsheet-payload.ts` is now `total-record`, pinned by `scenario-factsheet-payload.test.ts`. New arms: 59 blend days (CVaR NaN, VaR finite), 60 (equal to `compute()`'s figure), and a 30-day window inside a 59-day blend (shows). The two parity loops skip `cvar95` on their 30-day blends and the windowed one asserts it NaN. The parity guard's string pin follows the rename.
- **WR-05.** `cvarFloorNote` tests `!Number.isFinite(cvar95)`, so the `null` an `unstable_cache` hit returns counts. New arms render after `JSON.parse(JSON.stringify(payload))`: a strategy record under the floor (note shows), a cached record over the floor with a null stored CVaR (no note), and the Scenario blend at 59 and 60 days. A C1 arm in `MetricsColumn.cagr-span.test.tsx` pins that a NaN-years payload, after the round trip, prints no span line and no `NaN` or `null` text.
- **Neutered and restored from byte backups:** floor removed in `buildReturnsBody` -> 4 RED (the windowed parity arm, the 59-day arm, the window arm, the Scenario note arm); `cvarFloorNote` back to `Number.isNaN` -> 1 RED (the cached strategy arm). Restored -> 71/71 in the five touched files, 1213/1213 across 47 scenario- and factsheet-adjacent files. `tsc --noEmit` clean.

## Round 3 (re-review after fix round 2)

status: clean

Reviewer: Claude (gsd-code-reviewer), 2026-11-25T21:25Z. Depth: deep. Scope: `git diff e16cbce20..HEAD -- . ':!.planning'` at `249be750c` (8 files, commits `a2117de2b`, `97270eb81`, `6b7cc2dc7`). Read-only: no source file changed, no test run, no database touched. Call chains traced outside the diff: `ScenarioFactsheetChart` → `buildScenarioFactsheetPayload` (its only production caller) and the composer's `scenarioMetrics.portfolio_daily_returns`; every `cvar95` reader in `src/`; `basis-context.tsx` (`windowView`, which re-derives from `view.strategyReturns`, and the layer-1 basis merge `{ ...payload, ...bundle }`, whose bundle carries its own `strategyReturns`); `format.ts` `pctSigned` on `null`; `JOB_CHAIN_FOLLOW_ON` and `run_compute_analytics_from_csv_job` in `job_worker.py`; `_load_strategy_daily_returns` and the `data_quality_flags` carry-forward in `run_csv_strategy_analytics`; `enqueue_compute_job` in `supabase/schema/baseline.sql` (its wrapper only; `_enqueue_compute_job_internal`'s dedup was not re-read); `_enqueue_linked_strategy_recompute` and its cooldown constants in `job_worker.py`, and `routers/cron.py` for a tail-attempt cooldown (none); the `is_composite` expression in migration `20261114151700`; the removed lines of the runbook diff (`git diff e16cbce20..HEAD -- docs/`); and the baseline columns of `strategies`, `api_keys`, `csv_daily_returns`, `strategy_analytics`, `compute_jobs` and `strategy_keys`.

### Round-2 findings: resolved in code?

| Finding | Resolved | Evidence |
|---|---|---|
| CR-04 Scenario composer's factsheet CVaR unfloored | yes | `buildReturnsBody` floors `cvar95` to NaN when `rets.length < CVAR_MIN_OBS`. That code runs only on the non-degenerate path, where every return is finite, so `rets.length` is the blend's finite count: the same series and count `StressVarSection` / `scenario-stress.ts` floor on (A6). `ScenarioFactsheetChart` is the only production caller. `windowView` re-derives a zoomed range from `strategyReturns`, so a narrowed window still shows CVaR (Q2). No other `cvar95` reader exists in `src/` (the three MetricsColumn rows, `build-payload.ts`, `fetch-and-build-payload.ts`, `basis-metrics.ts`). The census entry is now `total-record` with a `pinnedBy` test that imports `CVAR_MIN_OBS`. The 59/60/window arms test the boundary at the right place. |
| CR-05 runbook reaches only Deribit, sFOX and MT5 | yes | All four population forms read `strategy_analytics` joined to `strategies`, and composites are excluded by `NOT EXISTS strategy_keys`. No form joins `ledger_refresh_staleness`. The later forms read the bound `IDS`. Routing claim checked: every chain ends in `compute_analytics_from_csv` (`JOB_CHAIN_FOLLOW_ON`: `sync_trades` → `derive_broker_dailies` → tail). The tail reads only `csv_daily_returns.eq("strategy_id", …)`, and the pre-flight counts that same set (`daily_return` is `NOT NULL` float8, NaN/±Inf excluded). The tail carries the hop-1 flags forward from `existing_flags` (navmtm, `native_unit`, `mtm_gated_reason`, `small_base_measured`, …), so running it alone on a key-backed strategy is the re-runnable path the OKXHISTORY precedent used. `enqueue_compute_job`'s strategy branch has no kind or source gate beyond `_assert_owner`. The composite predicate is the view's own `is_composite` expression (`EXISTS strategy_keys`, migration `20261114151700`). The rewrite's removed lines are only the `ledger_refresh_staleness` joins, the old scope and table prose, and the bind and diff scripts the new ones replace. The marker gates, the pre-flight, the in-flight and retag exclusions, the `enqueued < selected` stop and Recovery are all intact. The new sentence that CSV, Binance, OKX and Bybit strategies read no attempt cooldown checks out. The only other cooldown that counts `compute_analytics_from_csv` attempts is `_LINKED_RECOMPUTE_COOLDOWN` in `_enqueue_linked_strategy_recompute`, and its docstring scopes it to `ledger_refresh_staleness`, so to the three ledger venues only. `routers/cron.py` has no such cooldown. Every column the forms name exists in the baseline (`strategies.status/source/api_key_id/asset_class/returns_denominator_config`, `api_keys.exchange`, `compute_jobs.metadata`, `strategy_analytics.metrics_json_by_basis/computation_error`). |
| WR-05 floor note missing on a JSON-cached page | yes | `cvarFloorNote` uses `!Number.isFinite(cvar95)`, which is true for both NaN and the `null` an `unstable_cache` hit returns. The count it reads is the view's own `strategyReturns`. For a cached MTM or smoothed bundle that is the bundle's own series (`basis-context.tsx` merges `strategyReturns` with the bundle), so it is the count that bundle's floor used. `pctSigned(null)` renders the dash, so nothing else changes on that cell. The new arms render after `JSON.parse(JSON.stringify(payload))`. Those are the arms an in-memory payload could not exercise. |

No new MEDIUM-or-above defect was introduced by the three commits.

### LOW / Info (recorded here only)

- On a composer `state.window` (coverage window), the blend the payload is built from is the window, so CR-04 floors CVaR on it. The Phase 56 parity arm's 30-day windowed blend now shows a dash where it used to show a number. This is not the Q2 "zoomed window": the 2026-11-07 KPI rule, which Q2 says it is consistent with, already treats this series as the blend's TOTAL record. In the same `buildReturnsBody`, 194 D-15 builds `figureRecord` from the same `rets` / `datesR` ("the blend's TOTAL record … the blend's overlap"). `StressVarSection` floors on the same series too. The in-composer zoom (PeriodControl → `windowView`) is the zoom, and it still shows CVaR. This is the IN-02 tension already recorded, not a new defect. The phase agent can overrule it if "coverage window = zoom" was meant.
- Section 3 binds only `complete` / `complete_with_warnings` rows. A row that reads `computing` at the moment of the before-read (a nightly chain in flight, or a stuck job) is outside the bound set and outside every done gate. It surfaces only in the printed outside-the-set counts, which the SUMMARY records.
- On an empty bound set, `array_length(ARRAY[]::uuid[], 1)` is NULL, so section 5's `bound_found = bound` check reads NULL rather than true. A fleet of zero targets is not a real run.
- Carried from round 2: the census reason for `MetricsColumn.tsx` ("it decides nothing") is stale now that it decides the note.

_Round 3 reviewed: 2026-11-25. Reviewer: Claude (gsd-code-reviewer). Depth: deep._

## Fix round 3: silent-failure hunt round 3 (5 MEDIUM)

The round-3 code review was clean. The round-3 silent-failure hunt found 5 MEDIUM, one user-facing and four in the PROD runbook's gates (data integrity), so all five were fixed.

| Finding | Commit | Status |
|---|---|---|
| SFH-R3-1 an empty or failed "before" read binds zero ids and every gate passes | `2926732a1` | fixed |
| SFH-R3-2 the `enqueued < selected` stop cannot fire (dedup returns the existing job id) | `2926732a1` | fixed |
| SFH-R3-3 the "Needs 60 observations" note shows on a withheld window | `cf109ffb5` | fixed |
| SFH-R3-4 section 6 reports number-to-null for `cvar` only | `2926732a1` | fixed |
| SFH-R3-5 the 155.2 freeze check can read false-clear from lagging SUMMARYs | `2926732a1` | fixed |

- **SFH-R3-3.** `cvarFloorNote` takes the `WindowedView` and returns nothing when `view.withheld` is set. New arm: a 400-observation payload with no `periodsPerYear`, zoomed to a 31-day range, dashes CVaR and shows no note. The short-slice cause cannot be mounted through the zoom control (`MIN_VISIBLE_SAMPLES` = 5) and goes through the same guard. Guard removed -> 1 RED (two false notes); restored from a byte backup -> 8/8.
- **Runbook.** The bind step exits with a STOP on an empty file, a wrong or null marker, or an empty bound set, and the `IDS` assignment fails loud; `render` refuses an empty `IDS`; the diff exits 1 on an empty bound set. The batch-outcome query reports `tagged_total`, which must equal the running sum of `selected`. Section 6 reports number-to-null and null-to-number for every figure and the allocator MWR, any number-to-null a STOP needing a named cause. The 155.2 check decides on the coordinator's written confirmation, with any unlisted combination a STOP. Executed locally only (fixture CSVs, a throwaway PostgreSQL 16 with a stub `compute_jobs`); the freeze block, the CLI calls and the batch write were not executed.
- **Judgment accepted from round 3:** the Scenario coverage window is the engine's common overlap span, which A6 names as the blend's whole common series, so flooring CVaR on it is the decision, not a zoom.

## Round 4 (re-review after fix round 3)

status: issues_found

Reviewer: Claude (gsd-code-reviewer), 2026-11-25. Depth: deep. Scope: `git show cf109ffb5` (`MetricsColumn.tsx` and its floor-note test) and `git show 2926732a1` (`docs/runbooks/figuremath-fleet-rederive.md`), at `c145f3a47`. Read-only on source: no source or runbook file changed, no test suite run, no database touched. Outside the diff, this round traced `windowView`, `withheldWindowView` and `useWindowedView` in `basis-context.tsx`, and the three `cvarFloorNote` call sites (two read the view from line 324, one from line 1578, and all three are `useWindowedView` results). In `supabase/schema/baseline.sql` it traced both dedup look-ups of `_enqueue_compute_job_internal` and `_record_enqueue_dedup`, whose comment says it "Merges no caller key into the job row", plus `strategy_analytics_strategy_id_key`, which makes `strategy_id` UNIQUE so `sel` cannot call the enqueue twice for one id. It checked `job_worker.py` for an enqueue that copies a caller's `metadata` onto a new row (none does) and the baseline and `routers/cron.py` for a `compute_jobs` purge (none exists). The bind-step snippet was copied verbatim from the runbook and run, in a scratch directory, under `/bin/bash` (3.2) and `/bin/zsh` against fixture `before.csv` files: an empty file, a wrong marker, one bound row (a marker carrying commas, so the CSV quotes it), and no bound row.

### Fix-round-3 findings: resolved?

| Finding | Resolved | Evidence |
|---|---|---|
| SFH-R3-1 an empty or failed "before" read binds zero ids | yes, for `before.csv` | Run under both shells: an empty file, a wrong-marker row or an empty bound set each print their STOP and leave `IDS` unusable, and the one-bound-row fixture binds `'a1'`. `render` refuses both shapes a failed bind leaves behind. Bash leaves `IDS` unset (`render: <IDS> needs its variable`). In zsh, `export` of an unset name makes it set-and-empty in the shell, though `node` saw it as undefined in the run. The new empty-string arm covers that shell form. The diff now exits 1 on an empty `bound-ids.txt`. Its sibling reads are not guarded: see WR-06. |
| SFH-R3-2 the `enqueued < selected` stop cannot fire | yes | Confirmed: both dedup sites return the existing id, and `_record_enqueue_dedup` writes the caller's metadata only to `compute_job_dedup_events`. A dedup hit therefore leaves the returned job untagged, and `tagged_total` comes out short by one. No worker path inserts a row carrying the tag (the only `p_metadata` the worker sends is the ledger-refresh edge), and nothing deletes `compute_jobs` rows. So the count cannot run long or drift. `sel` is referenced twice, so it is materialized and `selected` equals the call count. A raised enqueue rolls the batch back, and the empty `batch-<n>.csv` it leaves is refused by the one-row check. |
| SFH-R3-3 the floor note on a withheld window | yes | `windowView` is the only producer of `withheld` (`short-slice`, `no-annualization-basis`). A full-range scope returns `base` by reference, so a whole-record view never carries it and the floor note keeps its one cause. A withheld view dashes every metric, so the note's absence is right. The new arm can fail. Its 31-observation slice is under `CVAR_MIN_OBS` and its `cvar95` is NaN, so without the guard the note renders. Its `"—"` assertion on every CVaR row proves the zoom took effect: an un-zoomed 400-observation record would print a number. `WindowedView` is `FactsheetPayload & { withheld? }`, so `tsc` cannot flag a caller that passes an un-windowed payload, but none does. |
| SFH-R3-4 number-to-null for `cvar` only | yes for the strategy figures | All twelve figures and the MWR now carry number-to-null and null-to-number counts, and a non-zero number-to-null is a STOP needing written acceptance. For the strategies, a failed `after.csv` cannot hide a regression, because the per-id diff reports every bound id missing. The MWR half has no such backstop: see WR-06. |
| SFH-R3-5 the 155.2 freeze reads false-clear | yes | The coordinator's written confirmation decides. Each of the three rows needs the counts to agree with it, and every other pair is a STOP: a disagreement, `0`/`1`, a count above 1, no confirmation, or a failed fetch. The `0`/`0` false clear now needs a written "not begun". |

### WR-06: The allocator MWR gates added in fix round 3 can pass on an empty or wrong-database allocator read

**File:** `docs/runbooks/figuremath-fleet-rederive.md:170-184` (allocator "before" read), `:684-686` (section 5 allocator gate), `:701-707` (section 6 number-to-null)
**Issue:** Fix round 3 guarded `before.csv` against the failure SFH-R3-1 names: `q ... > file` creates the file even when the read fails. It then made the allocator MWR a STOP-bearing figure in section 6, and section 5 now defers to it ("This gate checks freshness only; an MWR that went to null is read in section 6, where it is a STOP"). The input to that STOP is `allocator-before.csv` (plus `allocator-after.csv`). Neither file gets a data-row check or a marker check:
- An empty `allocator-before.csv` (a failed read) gives the section 6 join zero pairs. The MWR number-to-null count is 0 and the STOP cannot fire.
- With that same empty file, section 5's "none went missing" condition, `equity_curve_rows` at least the data rows of `allocator-before.csv`, holds trivially.
- An empty or failed `allocator-after.csv` also joins to zero pairs. The strategy side has the per-id diff as a backstop for this; the allocator side has none.
- Neither file's `which_database` column is checked by anything but the eye.

What still holds is `not_rederived = 0`, which reads live rows. So freshness is gated, but an allocator whose stored MWR went to null, or whose `equity_curve` row vanished while another appeared, reaches "FIG-05 closed" unseen. That is the vacuous pass SFH-R3-1 and SFH-R3-4 were fixed for, still open on the allocator half of the same gate.
**Fix:** Run the bind step's three checks on `allocator-before.csv` before `ENQ_AT` is set, and on `allocator-after.csv` before section 6: at least one data row (zero is a STOP unless the coordinator confirms in writing that PROD has no `equity_curve` row), every `which_database` equal to the manifest marker, and a printed row count. In section 6, count an allocator with a numeric MWR before and no row after as number-to-null.
```bash
for f in allocator-before allocator-after; do
python3 -I - "$FM_SP/$f.csv" "$ROOT" <<'PY' || echo "STOP: $f"
import csv, json, sys
marker = json.load(open(f"{sys.argv[2]}/scripts/prod-prober/cron-manifest.json"))["database_marker"]
rows = list(csv.DictReader(open(sys.argv[1], newline="")))
if not rows or any(r.get("which_database") != marker for r in rows):
    print("STOP: %s is empty or carries a row without the manifest marker" % sys.argv[1]); sys.exit(1)
print("%s rows=%d" % (sys.argv[1], len(rows)))
PY
done
```

### LOW / Info (recorded here only)

- The `tagged_total` gate is compared by eye. The batch-file script prints `sum_selected`, but it never reads `tagged_total`, and the batch outcome is not saved to a file. A short count is also permanent. Once an id has been deduplicated onto a job the runbook did not create, `tagged_total` stays one short for good, and section 5's "final `tagged_total` equals the sum of `selected`" can never hold. No reconcile step is written (for example: name the id, show that the foreign job ended `done` and the row is on version 3, and record the coordinator's written acceptance). This fails closed.
- The bind step says it STOPs with a "non-zero exit … `IDS` unset". Run as a pasted block, its last command is `export IDS`, which returns 0 in both shells. In zsh it also leaves `IDS` set-and-empty in the shell. `render`'s two refusals still stop every later form, so this is only a prose inaccuracy.
- The freeze snippet's empty-listing guard prints its STOP and then still prints the two counts (`0`, `0`). A failed `git fetch origin main` is not trapped, so the counts come from the stale local ref. Both are STOPs in the prose, and the written confirmation decides.
- "An empty CSV cell is null" (section 6) assumes how `supabase db query -o csv` writes a SQL NULL, and nobody has observed that output. If the CLI writes it as text, CSV strategies get labelled with that text in the bind step's per-exchange counts, and a by-eye null count could miss it. A version-2 row's `cagr_start` in the first `before.csv` should be null, so it shows the actual rendering. Read it there before section 6.
- The batch-file glob `batch-*.csv` would also match a batch outcome saved as `batch-<n>-outcome.csv`, and the one-row check then STOPs (fail-closed). Naming the outcome file in the runbook would avoid that.

_Round 4 reviewed: 2026-11-25. Reviewer: Claude (gsd-code-reviewer). Depth: deep._

## Fix round 4: WR-06 and the silent-failure hunt round 4

Round 4's code review found WR-06 (MEDIUM). Round 4's silent-failure hunt found the same hole (its M2) and one more MEDIUM (M1). Both are in the PROD runbook's gates.

| Finding | Commit | Status |
|---|---|---|
| WR-06 / SFH-R4-M2 `allocator-before.csv` and `allocator-after.csv` pass every gate when a read fails | `370a8194e` | fixed |
| SFH-R4-M1 the 155.2 freeze block prints the Proceed counts after its STOP, and a failed fetch goes undetected | `370a8194e` | fixed |

- **WR-06.** A `guard_alloc` function in the Environment block runs the bind step's checks: at least one data row, the manifest marker on every row, and a printed row count. It runs right after each allocator file is taken. The section 5 gate reads the printed count. In section 6, an allocator with a numeric MWR before and no row after counts as number-to-null. Both allocator SELECTs carry `which_database` (runbook section 3), so the guard can pass on a good read.
- **M1.** The freeze block is an if/elif/else, so the counts print only after a good fetch and a non-empty listing. The bind-step prose no longer claims a non-zero exit.
- **Executed locally only:** `guard_alloc` under bash and zsh against empty, header-only, wrong-marker, mixed, missing and good fixtures (the good one passes with `data rows=2`, the rest STOP with rc=1). The freeze block against a scratch repo with no remote (STOP, no counts), a bare remote with only the plan 12 SUMMARY (`1`, `0`), and an empty remote (STOP).
- **Review of this fix:** the phase agent read the diff and confirmed the allocator reads select `which_database`. No fifth reviewer round. The LOWs from round 4 (the `tagged_total` comparison done by eye with no reconcile step, a stale `bound-ids.txt` after a STOPped re-run, `cvarFloorNote` beside the chain-break Withheld row, the section 6 counts written as prose, the unanchored grep, unchecked `out-of-scope.txt` ids) stay here only.
