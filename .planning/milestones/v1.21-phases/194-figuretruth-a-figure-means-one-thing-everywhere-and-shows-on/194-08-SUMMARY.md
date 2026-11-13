---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 08
subsystem: factsheet-strip, cross-page-parity
tags: [trust-04, trust-05, d-01, d-04, d-11, d-13, d-15, figure-gate, parity-test]

requires:
  - phase: 194-04
    provides: payload.figureRecord, stored overlay (6 Month, 3 Month, VaR, CVaR), the fetch select aliases
  - phase: 194-06
    provides: StrategyTable record scalars and gated cells
  - phase: 194-07
    provides: tearsheet record-span read and gate
  - phase: 194-11
    provides: toStrategyRows Sharpe gate (Holdings)
  - phase: 194-12
    provides: widenedWithheldReason, widenedShortNote
  - phase: 194-21
    provides: comparator block jointAnnualization
provides:
  - "FactsheetView KpiStrip: CAGR, Sharpe, Sortino, Calmar and Ann. Vol read gatedValue over payload.figureRecord; one muted `strip-figure-gate-note` replaces the two amber caveats"
  - "src/__tests__/figure-parity-pages.test.tsx: one stored fixture through fetchAndBuildPayload, toStrategyRows, the StrategyTable cell and the tearsheet (SC-2)"
affects: [194-09]

actuals:
  tokens: 52000
  tasks: 3
  commits: 3

commits: 3
plan_head_before: e70815a89aafefec4a42875b85a1803c4213fd18
plan_head_after: ddfb76fb0b5f6983df90829b4ae02ecfa2c4fe6c

key-files:
  created:
    - src/__tests__/figure-parity-pages.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.leverage-honesty.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.usd-toggle.test.tsx
    - src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/deferred-items.md

key-decisions:
  - "The strip reads the SAME verdict as the rail: `gateAnnualized(payload.figureRecord, windowSpan)`, scope 'blend' under scenarioMode, 'range' when a range is selected, 'record' at full history. The window only qualifies; it never withholds."
  - "The overlap sentence joins the strip note only when the alpha and IR cells show the active block's joint (`j` present, not suppressed, not whole-record withheld), read from `wv.comparators[cmpKey].jointAnnualization` so a zoom uses the window's own block."
  - "The parity test's admin fake PROJECTS the select string (plain column, alias:metrics_json->key). A fake that returns the whole seeded row cannot go RED when a plan-04 alias is dropped."
  - "The Holdings reader shares only Sharpe and Max DD with the other pages (toStrategyRows exposes no other metric), so the parity test compares those two there."

requirements-completed: []  # TRUST-04 / TRUST-05 close with the phase; the orchestrator owns REQUIREMENTS.md

completed: 2026-11-07
status: complete
---

# Phase 194 Plan 08: FactsheetView strip note and the cross-page parity gate Summary

**The factsheet KPI strip withholds its five annualised cells only on a short TOTAL record and carries one muted note, and a parity test now feeds one stored row through the factsheet fetch path, the Holdings adapter, the StrategyTable and the tearsheet, going RED on today's 6 Month mismatch.**

## What was built

- **Task 1 (tracer): `figure-parity-pages.test.tsx`.** One marker-2 crypto row (400 calendar days, stored values deliberately unlike what `compute()` derives, stored observation count 1234 against a 400-row series) and a 13-digit cumulative variant (D-05). Readers, each through its production entry point:
  - factsheet: `fetchAndBuildPayload` over a fake admin client that projects the `strategy_analytics ( ... )` embed by the select string it is asked for, so the plan-04 aliases are exercised. All 11 shared metrics (Return %, CAGR, Sharpe, Sortino, Calmar, Volatility, Max DD, 6 Month, 3 Month, VaR 95%, CVaR 95%) equal the stored field within 1e-12, and `figureRecord` carries the stored count, not the series' own.
  - Holdings: `toStrategyRows` Sharpe and Max DD within 1e-12.
  - StrategyTable and tearsheet: each cell's text equals that page's own `formatPercent` / `formatNumber` applied to the stored field; no rendered value is parsed back; the table and tearsheet texts are also asserted equal to each other.
  - Labels, not compared: the "Selected range" eyebrow (rendered through `RangeEyebrow`) and the Scenario `methodologyLine`.
  - D-15 interim: an UNMARKED non-crypto row (no `figure_defs_version`, no `record_observations`, 60 weekday returns spanning under 90 days) gives `figureRecord.observations` null and `gateAnnualized` `withheld` on the fetch path, `sharpeState` `withheld` on Holdings, and a dash in the StrategyTable Sharpe cell and the tearsheet Sharpe value.
- **Task 2: `FactsheetView.tsx` `KpiStrip`.** CAGR, Sharpe, Sortino, Calmar and Ann. Vol go through `gatedValue` over the record verdict. The `n < 252` amber caveat and the `insufficientWindow` amber caveat are replaced by one `text-text-muted` paragraph (`data-testid="strip-figure-gate-note"`, same `borderTop`). `scenarioMode` is threaded to `KpiStrip` as one prop. The alpha/IR overlap sentence (`widenedWithheldReason("overlap", record)` or `widenedShortNote("overlap", days)`) joins the same paragraph when those cells show the joint. No D-08 row is routed to plan 08 (`d08-apply-194-08: 0` in `194-D08-SITES.md`), so `EquityChart.tsx`, `BridgeWidget.tsx` and `AllocationsTabs.tsx` are not edited.
- **Task 3: phase-wide gates** (below).

## Neuter, RED, restore (byte backups via `cp -p`, `cmp` clean after each)

Parity test (Task 1):
1. `six_month_return` dropped from the `fetch-and-build-payload.ts` select: `AssertionError: 6 Month: payload has null, stored is 0.07771: expected false to be true` (the factsheet fetch-path case, both fixtures).
2. Plan-04 overlay step dropped in `build-payload.ts`: `AssertionError: expected [ …(4) ] to deeply equal []` listing `6 Month: page has 0.1541328942193676, stored is 0.07771`, `3 Month: page has 0.07431433347284622, stored is 0.03331`, `VaR 95%: page has -0.003, stored is -0.02221`, `CVaR 95%: page has -0.003000000000000001, stored is -0.03337`.
3. `figureRecord.observations` falls back to `dates.length` when the stored count is absent: `AssertionError: expected 60 to be null` (the unmarked-row case on the factsheet fetch path).

Strip (Task 2), `FactsheetView.tsx`, test `FactsheetView.window-kpis.test.tsx`:
4. Gate on the selected range's span instead of the record: `AssertionError: expected '—' to be '5.65'` (the 30-day range inside a cleared 400-day record), with the 60-row-window and Scenario window cases RED beside it (3 failed).
5. Overlap note forced off (`false && jointAnnualization`): `AssertionError: expected 'Annualized figures appear once the re…' to contain 'Alpha, information ratio, Treynor and…'` (the 60-day crypto record case), and the 60-day-overlap-on-a-cleared-record case RED (2 failed).

The factsheet-v2 gate cases added to `FactsheetView.window-kpis.test.tsx`: a 30-day selected range inside a cleared 400-day record prints its figures with `shortTrackNote("range", 30)`; a 45-day crypto blend in the Scenario mount withholds the five cells and states the blend wording once; a 60-day crypto record dashes alpha and IR and carries the overlap withheld reason in the one strip note; a 60-day BTC overlap on a cleared record prints alpha and IR and carries `widenedShortNote("overlap", days)`. The overlap day count is read off the block's own `jointAnnualization.days`, which is 59 or 60 depending on the fixture's pairing edge, instead of being hard-coded.

## Gates (Task 3)

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors (the two pre-existing unused-import warnings, `nativeUnitReason` and `isRankableAnalyticsRow`, untouched); the four repo check scripts OK.
- `npx vitest run` (full): 1179 files passed, 2 failed, 20 skipped; 23990 tests passed, 4 failed. The failures: `compute.conventions` fixtures B and C (the known pre-existing pair) and two cases in `src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx`, which this plan caused and fixed (Deviation 2); that file re-run alone is 22 passed.
- `python3 -m mypy --strict ...` (the plan's command): Success, no issues found in 132 source files.
- `python3 -m pytest -q` from `analytics-service/`: 1 failed, 14450 passed, 101 skipped; the one failure is `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`, the known pre-existing one the brief names (analytics is untouched by this plan).

All five gates therefore carry exactly the two known pre-existing failures (`compute.conventions` B and C, `test_xdist_group_is_real`) and nothing else, so the plan's literal "all five gates exit 0" is not met at this base; neither failure is in a file this phase touched.

## Deviations from Plan

**1. [Rule 3 - Blocking] Six existing strip tests asserted the retired amber sentences or used a fixture under D-15's minimum.** Their files are outside the plan's `files_modified` but each is the plan's own consequence:
- `FactsheetView.kpistrip.test.tsx`: the two `insufficientWindow` tests now assert the retired sentence is absent; the tone-and-sign block's fixture is 120 days, not 30, so CAGR is not withheld by the record gate it is not testing.
- `FactsheetBody.basis.test.tsx`: F8 asserted the strip's per-basis observation count; it now asserts the caveat is gone and the one strip note is the TOTAL record's, equal under cash and MTM.
- `FactsheetView.window-kpis.test.tsx`: the two "Only N observations" cases became the range-note cases above.
- `FactsheetView.leverage.test.tsx`, `.leverage-honesty.test.tsx`, `.usd-toggle.test.tsx`: the short fixtures that dial leverage or units carry a cleared `figureRecord` (as plan 04 did for `signed-zero`), since they test leverage and units, not the record gate. The fixture that expects a dash (`fixtureMtmBundleNoScalars`) is also cleared, so its dash still means "no scalar" rather than "short record".

**2. [Rule 1 - Bug caused by this plan] `route.stored-parity.test.tsx` (OG card vs strip) went red on the 25-point row.** The strip now dashes Sharpe and CAGR on a short record while the OG card does not read the record gate: census row B3, assigned to Phase 194.1 by D-10. `renderStrip` now takes a cleared record by default so the stored-figure parity cases keep comparing stored values, and one `KNOWN DIVERGENCE (B3, Phase 194.1)` case pins the card-versus-strip disagreement on the live record, so Phase 194.1 closing it turns that case red. Logged in `deferred-items.md`.

**3. Task order.** Task 2 was built before Task 1 and committed first. The Task 1 tracer's early-feedback purpose was not lost (Task 1 touches no file Task 2 touches), but the expansion did precede the tracer commit.

**4. Parity-test scope of the Holdings reader.** The plan lists Holdings among the pages that agree on "each metric they share"; `toStrategyRows` exposes only Sharpe and Max DD, so those are the two compared there.

## Known Stubs

None.

## Threat Flags

None. The plan adds no endpoint, auth path or schema. T-194-16 is mitigated by the parity test and shown RED three ways above.

## Self-Check: PASSED

Files exist (`figure-parity-pages.test.tsx`, `FactsheetView.tsx`, `route.stored-parity.test.tsx`, this SUMMARY); commits `35fe45cb6`, `d7242b219` and `ddfb76fb0` are ancestors of HEAD and `git rev-list --count` over the plan range is 3. No trailers on any commit. STATE.md and ROADMAP.md untouched.
