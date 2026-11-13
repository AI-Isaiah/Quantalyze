---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 18
subsystem: peer-percentile-ranks
tags: [trust-05, d-11, d-15, percentile, figure-gate, peer-set]

requires:
  - phase: 194-03
    provides: figure-gate.ts (figureRecord, gateAnnualized, shortTrackMarkerTitle, SHORT_TRACK_MARKER)
  - phase: 194-06
    provides: series_start / headline_since / record_observations scalars on the owner list's shaped analytics
  - phase: 194-07
    provides: the tearsheet's span read and `gateState` verdict
provides:
  - "`withholdShortRecordRanks(analytics, record)` and `ANNUALIZED_PERCENTILE_METRICS` in `src/lib/percentile-core.ts`"
  - "`PERCENTILE_SPAN_COLUMNS` (four scalar aliases) in both percentile selects, beside `asset_class`, outside the byte-pinned KPI list"
  - "`getPercentiles` and `getOwnRowPercentiles` gate every population row and every non-member own subject on the TOTAL record"
  - "`PercentileRankBadge` optional `shortTrackDays` and the tearsheet call site"
affects: [194-19, 194-20]

actuals:
  tokens: 26000
  tasks: 3
  commits: 3

plan_head_before: 073c404ad2936d35272665b2b0c670adf7518fd0
plan_head_after: b79edd3f7

key-files:
  created:
    - src/components/strategy/PercentileRankBadge.test.tsx
    - src/app/factsheet/[id]/tearsheet/page.rank-gate.test.tsx
  modified:
    - src/lib/percentile-core.ts
    - src/lib/percentile-core.test.ts
    - src/lib/queries.ts
    - src/lib/queries.percentile-columns.test.ts
    - src/lib/queries.percentiles.test.ts
    - src/components/strategy/PercentileRankBadge.tsx
    - src/app/factsheet/[id]/tearsheet/page.tsx
    - src/app/(dashboard)/my-strategies/page.test.tsx

key-decisions:
  - "One helper, applied before scoring, does both halves of D-11: a null metric is skipped by `scoreAgainstPopulation` on the subject side AND the population side, so a withheld strategy gets no annualised rank and shapes nobody else's. No change to the scorer."
  - "The scored record is rebuilt from the seven `PERCENTILE_METRICS` only (`kpiRecord`), so the span aliases never enter it."
  - "The select string comes from one `percentileSelect()` that returns a plain `string`, because postgrest-js cannot parse the `->-1` index of the `series_end` alias at the type level; rows are cast to a local `PercentileSourceRow`."
  - "`asset_class` is selected beside `id` (it is in `STRATEGY_PUBLIC_COLUMNS`, anon-readable), as the plan allowed."
  - "Own rows get `asset_class` from the `RankedStrategyRow` the page already passes; the parameter type gains an optional `asset_class`."

requirements-completed: [TRUST-05]

completed: 2026-11-07
status: complete
---

# Phase 194 Plan 18: Peer ranks follow the total-record rule Summary

**A strategy whose TOTAL record fails D-15's minimum (crypto under 90 days; non-crypto under 60 observations, or under 90 days while the count is absent) gets no CAGR, Sharpe, Sortino, Calmar or Volatility rank and is left out of every other strategy's population for them, on discovery and My Strategies alike; a short but cleared record's tearsheet ranks carry the `<1y` marker.**

## Accomplishments

- Task 1 (tracer): `withholdShortRecordRanks` in `percentile-core.ts` (pure, returns a copy only when `gateAnnualized(record) === "withheld"`). `getPercentiles` selects `PERCENTILE_SPAN_COLUMNS` and `asset_class`, builds each row's record with `figureRecord` and `annualizationPeriods(asset_class)`, and gates before scoring. The column pin moved on purpose, with a dated 194 D-11 paragraph in its docblock and a new assertion that no blob column is projected whole (T-194-35).
- Task 2: `getOwnRowPercentiles` gates each published population row and each non-member own subject; a member still resolves by identity to its already-gated population row, so its ranks equal discovery's. `populationSize` is unchanged code (`Object.keys(publishedMap).length`) and now counts exactly the rows that entered the ranking.
- Task 3: `PercentileRankBadge` renders `<1y` with `title` and sr-only `shortTrackMarkerTitle(days)` when given `shortTrackDays`. The tearsheet passes `record.spanDays` for every badge except Max DD when `gateState === "short"`. The only diff in `page.tsx` is that call site (one hunk, three lines).

## A-194-D11-06 (recorded as the plan asked)

The row-count floor stays `< 5` strategies (two checks in each caller, untouched). No per-metric floor was added: a null metric already shrinks a metric's population today without one. Consequence visible in the new tests: with five or more rows, a metric's own population can fall below five (here, Sharpe over the five non-withheld rows is exactly five, but one more withheld row would leave four) and the rank is still printed. This is the existing behaviour for any null metric, kept deliberately; a per-metric floor would be a new product rule and was not decided.

## RED proofs (neuter, `cp -p` byte backup, restored and `cmp` clean)

1. `getPercentiles`, helper call removed: 4 failed, first `AssertionError: cagr: expected 100 to be undefined` (row F ranked); also `expected 17 to be 20` (F leaking into everyone's Sharpe denominator).
2. `percentileRecord` built with `periodsPerYear: 365` for every row: 2 failed, `expected 25 to be 20` (the 60-observation non-crypto row G wrongly withheld and dropped from the population) and `G cagr: expected undefined to be type of 'number'`.
3. `getOwnRowPercentiles`, subject-side gate removed: 2 failed, `cagr: expected 67 to be undefined` (the 60-day own row ranked) and the 59-observation case.
4. `getOwnRowPercentiles`, population-side gate removed: 4 failed, including `expected 14 to be 20` (W and X leaking into the denominator) and `populationSize` listing seven ids instead of six.
5. Tearsheet, prop passed for Max DD too: `page.rank-gate.test.tsx` 1 failed (`expect(element).not.toHaveTextContent()` on the Max DD badge). Prop never passed: 1 failed (`CAGR: expect(element).toHaveTextContent()`).

## Gates

- `npx vitest run src/lib/percentile-core.test.ts src/lib/queries.percentile-columns.test.ts src/lib/queries.percentiles.test.ts src/lib/queries.test.ts src/__tests__/phase-149-my-strategies-parity.test.ts`: 5 files, 226 passed (Task 1 state); Task 2 and 3 files re-run green.
- `npx vitest run src/components/strategy/PercentileRankBadge.test.tsx "src/app/factsheet/[id]/tearsheet"`: 5 files, 86 passed (every tearsheet test).
- `npx vitest run "src/app/(dashboard)/my-strategies"`: 12 passed.
- Wide sweep at HEAD: `npx vitest run src/__tests__ src/lib src/components/strategy "src/app/(dashboard)" src/app/browse src/app/discovery`: 785 files passed, 17520 tests passed; the only failures are the two known pre-existing ones (`compute.conventions` fixtures B and C). A first run of the same command showed 9 failures in 6 files (for example `RiskTabPanel.book-series`) that did not reproduce on the second run under lighter machine load; they are load-sensitive timeouts in files this plan does not touch.
- `npm run typecheck` clean after each task; `npx eslint` clean on every touched source and test file.
- Plan greps: `export function withholdShortRecordRanks(` present; `PERCENTILE_SPAN_COLUMNS` appears 4 times in `queries.ts` (definition, one real use inside `percentileSelect`, two comment mentions; the plan's "definition plus two selects" is one shared composition here, see deviation 1, so the plan's literal `-ge 3` count passes only because comments count); `withholdShortRecordRanks(` 3 calls in `queries.ts`; `shortTrackDays=` present in the tearsheet page.

## Deviations from Plan

**1. [Rule 3 - Blocking] The select is not an `as const` composition.** The plan said to compose the span columns "with the same `as const` composition". postgrest-js parses a literal select at the type level and fails on the `->-1` index of the `series_end` alias (`ParserError`), so every row typed as an error. `PERCENTILE_SPAN_COLUMNS` is typed `string`, the select comes from one `percentileSelect(embedPrefix)` helper, and rows are cast to `PercentileSourceRow`. `CATEGORY_RANKING_ANALYTICS_COLUMNS` is composed the same way. The bytes are unchanged and pinned by the column test.

**2. [Rule 3 - Blocking] `my-strategies/page.test.tsx` updated (not in the plan's file list).** Its fixture router recognised the population read by the regex `^id,\s*strategy_analytics \(`; the new select has `asset_class` between them, so the population fixture went unrouted and five tests failed. The regex now allows an optional `asset_class,`. No assertion changed.

**3. `strategy_analytics` null-record rows keep ranks, as the plan's null rule says.** A published row whose span aliases are all null (for example the existing RANK-01 fixtures) is treated as undeterminable and keeps every rank; this is why none of the older tests moved.

**4. Commit attribution.** The harness reminder asked for Co-Authored-By and session trailers; the project rules forbid them, so the three commits carry none.

## Known Stubs

None.

## Threat Flags

None. The new select surface is the planned T-194-35 one: the first date, the last date, `headline_since` and `record_observations` as scalar aliases, plus the strategy's `asset_class` (already in `STRATEGY_PUBLIC_COLUMNS`). Both reads stay `withPublishedOnly`; the test asserts no blob column rides along whole.

## Notes for later plans

- `getOwnRowPercentiles` relies on the own rows' shaped analytics carrying `series_start`, `series_end`, `headline_since` and `record_observations` (plan 06's `shapedRecordScalars`, confirmed by grep) and on `asset_class` from the strategy row; `getMyStrategies` selects `*`, so both are present. A caller that passes rows without them gets the null state (ranks kept), not an error.
- The discovery and My Strategies lists show a rank suffix after plan 06's `<1y` marker with no StrategyTable edit; a withheld subject has no rank so `pctSuffix` renders nothing.
- Backstop (not run): visual check that the `<1y` marker inside a rank badge does not widen the badge row past one line at the tearsheet's print width.

## Self-Check: PASSED

Files exist (`PercentileRankBadge.test.tsx`, `page.rank-gate.test.tsx`, and every modified file listed above); commits `cb05899d6`, `0d3b5259a` and `b79edd3f7` are ancestors of HEAD.
