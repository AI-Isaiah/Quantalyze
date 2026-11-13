---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 04
subsystem: factsheet-rail, factsheet-payload
tags: [trust-04, trust-05, d-01, d-02, d-04, d-15, figure-gate, stored-overlay]

requires:
  - phase: 194-03
    provides: figure-gate.ts (gateAnnualized, gatedValue, figureRecord, withheldReason, shortTrackNote, VAR_METHOD_LINE, FIGURE_DEFS_VERSION)
provides:
  - "`storedFigureDefs` opt and `overlayStoredFigureDefs`: stored 6 Month, 3 Month, VaR 95%, CVaR 95% win at full history behind `figure_defs_version >= 2`"
  - "`payload.figureRecord` (FigureRecord): full-history span, STORED `record_observations` or null, crypto flag"
  - "Rail gate in MetricsColumn: `figure-gate-note`, `var-method-line` test ids; blend wording under scenarioMode"
affects: [194-06, 194-07, 194-08, 194-10, 194-11, 194-15]

actuals:
  tokens: 21000
  tasks: 2
  commits: 2

plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: 28f4e953121b4b341c251e18e9383fa39946dc07

key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.figure-gate.test.tsx
  modified:
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/basis-metrics.ts
    - src/lib/factsheet/basis-metrics.test.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.signed-zero.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.periods-per-year.test.tsx

key-decisions:
  - "The stored overlay runs before `withSuffixWindows`, so a chain-broken row keeps its existing D-12 suffix windows for 3M/6M; VaR/CVaR stay stored."
  - "var95/cvar95 are numbers in `StrategyMetrics`, so a stored null becomes NaN (the existing missing-figure convention of compute()); p3m/p6m become null."
  - "`storedFigureDefs` is set only when `metricsByBasis.cash_settlement` was admitted, on both arms, in `buildFromResolved`."

requirements-completed: []  # TRUST-04 / TRUST-05 close with the remaining surface plans

completed: 2026-11-07
status: complete
---

# Phase 194 Plan 04: Factsheet stored overlay and rail gate Summary

**The factsheet reads the stored 3M, 6M, VaR and CVaR behind the figure-definitions marker, carries one `figureRecord` (stored observation count or null), and its rail dashes the five annualised rows only on a short TOTAL record, with one muted note and the VaR method line.**

## Accomplishments

- Task 1 (tracer): fetch embed now projects `six_month_return` and five `metrics_json` scalar aliases (never `metrics_json` whole, T-194-20); `buildFromResolved` threads them as `storedFigureDefs` on both arms when the cash headline was admitted; `overlayStoredFigureDefs` gates on `figure_defs_version >= 2` (T-194-07); `FactsheetCommon.figureRecord` set from `figureRecord(...)` with the stored count.
- Task 2: one `gateAnnualized(record, windowSpan)` in `MetricsColumn`; `gatedValue` on CAGR, Ann. Volatility, Sharpe, Sortino, Calmar (strategy column only); the amber observation sentence replaced by `figure-gate-note`; `var-method-line` under the Max Drawdown and Extended Metrics VaR/CVaR blocks.

## Snapshot key-level review (SC-4 pins)

Backup taken with `cp -p`, then `npx vitest run src/lib/factsheet/build-payload.test.ts -u` on that one file. Scratchpad script parsed the backup and updated entries, deleted `figureRecord`, required byte-equal re-serialization:

```
composite arithmetic | byte-equal after delete: true | figureRecord: {"spanDays":61,"observations":null,"crypto":true}
ingestSource:'api'   | byte-equal after delete: true | figureRecord: {"spanDays":61,"observations":null,"crypto":true}
single-key geometric | byte-equal after delete: true | figureRecord: {"spanDays":61,"observations":null,"crypto":true}
entries bak/upd: 3 3; "figureRecord": occurrences in .snap: 3
```

No other key, value or key position moved.

## RED proofs (neuter, byte backup, restore, `cmp` clean)

Task 1:
1. Marker check dropped (`basis-metrics.ts`): `marker absent (null)`, `marker below the current version` and fetch-level `a stored row WITHOUT the marker keeps the computed figures` RED (3 failed).
2. `six_month_return` dropped from the select: `the strategies select carries the six tokens and never a bare metrics_json` RED (1 failed). The value-level fetch case stays green here by construction, since the mocked client returns whatever row is seeded regardless of the select; the select-token case is the one that bites.
3. `observations` falls back to `dates.length`: `figureRecord.observations is null when the row has no stored count...` and `a non-crypto row with no stored count and 60 weekday returns inside 90 days is withheld` RED (2 failed).

Task 2:
1. `gv` returns raw values: `AssertionError: expected [ '+1.95%', '17.88%', '0.20', …(2) ] to deeply equal [ '—', '—', '—', '—', '—' ]` (crypto 60-day, non-crypto 59, and the 30-day range in a 60-day record, 3 failed).
2. Gate on the selected range's span (superseded D-04 reading): `AssertionError: expected '—' not to be '—'` in the 30-day range inside a 400-day record (1 failed).

## Gates

- `npx vitest run src/lib/factsheet`: 61 files passed; 2 failed, the known `compute.conventions` fixtures B and C.
- `npx vitest run "src/app/factsheet/[id]/v2" src/__tests__/display-sign-single-source.test.ts`: 103 files passed; 2 failed, both in `MetricsColumn.arithmetic-windows.test.tsx` (see Deferred Issues).
- `npm run typecheck` clean. eslint: 0 errors (two pre-existing unused-import warnings, `nativeUnitReason` and `isRankableAnalyticsRow`, untouched).

## Deviations from Plan

**1. [Rule 3 - Blocking] Three older rail tests asserted the retired amber sentence or used a sub-90-day fixture.** `MetricsColumn.periods-per-year`, `.record-length` (the amber "Only N observations" assertions) now assert the sentence is absent, citing D-15; `.signed-zero` builds a short record, so its `basePayload` now carries a cleared `figureRecord` (it tests the formatter, the gate has its own file). Plan files list did not name these.

**2. No Co-Authored-By or Claude-Session trailers** on the two commits (project rule overrides the system attribution reminder).

## Deferred Issues

`MetricsColumn.arithmetic-windows.test.tsx` (2 tests: `p3m` `+36.42%` vs expected `+36.85%`, and the geometric twin) fails at the base commit too, verified by running it against the pre-edit `MetricsColumn.tsx`. Cause is plan 02's calendar 3 Month definition, not this plan. Not fixed (out of scope); the owning plan should re-derive those expected values.

## Notes for later plans

- `scenarioMode` reads `payload.figureRecord` as the blend's record; plan 13/15 must set it on the composer's payload (a payload without it reads as the `null` state and shows figures with no note).
- The KPI strip (plan 08) and Holdings (plan 11) should read the same `payload.figureRecord`.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files exist (`MetricsColumn.figure-gate.test.tsx`, all modified files); commits `6745c3ec7` and `28f4e9531` are ancestors of HEAD.
