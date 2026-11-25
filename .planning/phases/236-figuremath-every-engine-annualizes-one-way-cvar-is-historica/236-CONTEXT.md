# Phase 236: FIGUREMATH — every engine annualizes one way, CVaR is historical, and moved figures are re-derived and announced - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Every engine that annualizes follows F-5, "365, ddof 1 everywhere": the stored Python metrics (`analytics-service/services/metrics.py`), the factsheet engine (`src/lib/factsheet/compute.ts`), the Scenario engine (`src/lib/scenario.ts`, `calendarYears` in `src/lib/closed-sets.ts`), portfolio analytics (`routers/portfolio.py` `_compute_portfolio_analytics`, non-composite half of `L2214`) and matching (`services/match_engine.py`). CVaR is historical and null below one named minimum. quantstats moves 0.0.81 → 0.0.86 with a per-metric decision record. CAGR uses one span rule everywhere. Moved figures are re-derived for the whole fleet (a PROD write, handed to the coordinator) and named in the CHANGELOG. Requirements FIG-01..FIG-05. Composite work is out (F-2).

</domain>

<decisions>
## Implementation Decisions

### Milestone decisions (quoted from REQUIREMENTS.md / ROADMAP.md v1.22)
- F-5 "Figures: one convention, '365, ddof 1 everywhere'. This applies inside the existing annualization rule: risk is annualized by frequency (crypto 365, traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The TypeScript engines move to match Python."
- F-6 "CVaR is historical CVaR, null below a minimum number of observations."
- F-2 "No composites" — the composite half of `L2214` is out.
- FIG-03: "quantstats moves to 0.0.86 in the same PR as a per-metric decision record. Re-pinning moved values without a decision is not a close."
- FIG-05: "The frozen spine is re-baselined as a reviewed act (never by re-running `regen_golden.py` in a constants PR), and the CHANGELOG entry names the figures that moved."
- ROADMAP Depends-on: "Phases 229, 233 and 234 merged, so one fleet re-derive covers the stored inputs they change. 155.2 freeze: merges before 155.2 plan 12's recapture or after plan 14, never in between; with F-5 and F-6 ruled either side is open, and the side is recorded. The SCENARIO-05 / BODY-02 regression pins move in the same PR."

### Founder ruling 2026-11-25 — Q1 CAGR span (FIG-04)
- Founder answer, verbatim: "Keep calendar span, show it (Recommended)".
- Emptied stretches stay in the span. The factsheet states the span CAGR covers.
- One rule in every engine: first to last observed date of the same suffix, whole days, divided by 365.
- **Reversibility:** costly — moves every published CAGR/Calmar on narrowed-range and Scenario surfaces and needs a fleet re-derive.

### Founder ruling 2026-11-25 — Q2 CVaR floor (FIG-03)
- Founder answer, verbatim: "Total record only (Recommended)".
- `CVAR_MIN_OBS = 60`, one named constant per language.
- It nulls CVaR only when the TOTAL record has fewer than 60 observations; a zoomed window always shows CVaR (consistent with the 2026-11-07 KPI rule).
- **Reversibility:** costly — changes stored `cvar` for short records on re-derive.

### Founder ruling 2026-11-25 — Q3 quantstats 0.0.86 (FIG-03)
- Founder answer, verbatim: "Yes, adopt under that rule (Recommended)".
- Adopt each upstream correction unless F-5/F-6 says otherwise (CVaR stays historical).
- Confirm each against the 0.0.86 source and record a per-metric decision record.
- **Reversibility:** costly — dependency move plus stored figure changes.

### Scheduling (coordinator, 2026-11-25)
- 236's merge and FIG-05's fleet re-derive wait for 233 and 234 to merge (234 is PR #1339). Plan and execute now.
- The fleet re-derive is a PROD write: stop and hand it to the coordinator.
- Re-check that `155.2-12-SUMMARY.md` is absent on origin/main before shipping; record which side of the 155.2 freeze window the merge lands on.

### Research open items resolved by the rulings above (2026-11-25, phase agent; each traced to a quoted decision)
- A2 `serenity_index`'s CVaR leg stays historical — F-6 "CVaR is historical CVaR".
- A3 `common_sense_ratio` / `win_rate` / exposure take 0.0.86's observed-only NaN handling — Q3 "adopt each upstream correction unless F-5/F-6 says otherwise", after plan 04 measures the RED list in a throwaway venv.
- A4 `smart_sharpe` / `smart_sortino` thread `periods_per_year` instead of a hard-coded sqrt(252) — F-5 "risk is annualized by frequency (crypto 365, traditional 252)".
- A5 XIRR in `portfolio_metrics.py` moves 365.25 to 365 — F-5 "365 ... everywhere". `optimizer.py` `TRADING_DAYS = 252` follows the frequency rule (blend periods), not a fixed 252.
- A6 Scenario blend CVaR uses `CVAR_MIN_OBS = 60` on the blend's whole common series (its total record), replacing the n<10 floor — Q2 "one per language ... nulls CVaR only when the TOTAL record has fewer than 60 observations". A zoomed window never nulls it.
- `FIGURE_DEFS_VERSION` bumps 2 to 3 in both languages so unmigrated rows fall back to computed figures until the fleet re-derive.

- Simple (capital-reset, arithmetic) convention: its CAGR is `mean x periods_per_year`, which uses no span, so the Q1 span rule has nothing to change there. To honour Q1's "the factsheet states the span CAGR covers", `cagr_start`/`cagr_end` on that convention are the first and last observed dates of the series the mean is taken over (phase agent, 2026-11-25, raised by plan 03; reversible display data).

### Claude's Discretion
- Constant module names and locations per language; the census mechanism for annualizing sites; the parity-oracle shape (must import no production helper); the pinned parity tolerance (set from a stated derivation, never loosened to absorb a move).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Python: `_CALENDAR_DAYS_PER_YEAR = 365.0` in `services/metrics.py`; `_historical_var_cvar` (stored CVaR already historical since 194 D-02, floor only `n == 0`); `MIN_ANNUALIZATION_DAYS`.
- TS: `historicalVarCvar` in `src/lib/return-stats.ts` (twin of the Python rule, pinned via `tests/fixtures/figure_parity_vectors.json`); `MIN_ANNUALIZATION_OBS = 60` in `src/lib/figure-gate.ts`; `periodsPerYearFor` / `blendPeriodsPerYear` in `src/lib/closed-sets.ts`.

### Established Patterns
- Stored CAGR: post-last-break suffix (`_last_interior_break_suffix`), whole `.days`, `/ 365.0`.
- `compute.ts`: `days / 365.25` fractional, Sharpe `ddof: 0`, `dispersion(rets, 0)` population sd; rolling 126/30-row windows ddof 0 (D-14 residual).
- `scenario.ts`: `calendarYears` 365.25 over `commonDates`; Sharpe ddof 1; behind `src/__tests__/phase-29-frozen-spine-guards.test.ts`.
- `match_engine.py` `years = track / 365`.
- quantstats live leaves called with `prepare_returns=False`; many inline 0.0.81 mirrors in `metrics.py` (79 citations of `0.0.81`).

### Integration Points
- quantstats pins: `analytics-service/requirements.in`, `requirements.txt` (`make lock`), `requirements-dev.txt`; `.github/dependabot.yml` quantstats ignore.
- Parity tests: `tests/test_metrics_parity.py`, `tests/test_qstats_gate.py`, `src/__tests__/metrics-parity.test.ts`, `src/lib/sample-basis-ratios.ts`.

</code_context>

<specifics>
## Specific Ideas

- PROOF-01 for every gate: neuter, RED with named arm first, restore by `cp` + `cmp`, GREEN, recorded verbatim in plan SUMMARY.
- TODOS closed by this phase (deleted in ship PR, named in CHANGELOG): `194-ENGINE-CONSTANTS`, `QUANTSTATS-0086-REDERIVE-01`, `167.1.2.2.1-CAGR-EMPTY-SPAN`, non-composite half of `L2214`.

</specifics>

<deferred>
## Deferred Ideas

- The fleet re-derive execution itself (PROD write) — handed to the coordinator after 233 and 234 merge.

</deferred>
