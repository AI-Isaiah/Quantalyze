# Phase 236: FIGUREMATH - Research

**Researched:** 2026-11-25
**Domain:** annualization conventions across the Python stored engine and the TypeScript factsheet / Scenario / compare engines; quantstats 0.0.81 -> 0.0.86; fleet re-derive
**Confidence:** HIGH on the census and the quantstats diff (primary sources read this session); MEDIUM on the fleet re-derive mechanism (not traced end to end); the 0.0.86 parity corpus was NOT executed (see Environment Availability).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- F-5: "Figures: one convention, '365, ddof 1 everywhere'. This applies inside the existing annualization rule: risk is annualized by frequency (crypto 365, traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The TypeScript engines move to match Python."
- F-6: "CVaR is historical CVaR, null below a minimum number of observations."
- F-2: "No composites" - the composite half of `L2214` is out.
- FIG-03: "quantstats moves to 0.0.86 in the same PR as a per-metric decision record. Re-pinning moved values without a decision is not a close."
- FIG-05: "The frozen spine is re-baselined as a reviewed act (never by re-running `regen_golden.py` in a constants PR), and the CHANGELOG entry names the figures that moved."
- ROADMAP Depends-on: "Phases 229, 233 and 234 merged, so one fleet re-derive covers the stored inputs they change. 155.2 freeze: merges before 155.2 plan 12's recapture or after plan 14, never in between; with F-5 and F-6 ruled either side is open, and the side is recorded. The SCENARIO-05 / BODY-02 regression pins move in the same PR."
- Q1 (FIG-04), founder 2026-11-25, verbatim "Keep calendar span, show it (Recommended)". Emptied stretches stay in the span. The factsheet states the span CAGR covers. One rule in every engine: first to last observed date of the same suffix, whole days, divided by 365. Reversibility: costly.
- Q2 (FIG-03), founder 2026-11-25, verbatim "Total record only (Recommended)". `CVAR_MIN_OBS = 60`, one named constant per language. It nulls CVaR only when the TOTAL record has fewer than 60 observations; a zoomed window always shows CVaR (2026-11-07 KPI rule). Reversibility: costly.
- Q3 (FIG-03), founder 2026-11-25, verbatim "Yes, adopt under that rule (Recommended)". Adopt each upstream correction unless F-5/F-6 says otherwise (CVaR stays historical). Confirm each against the 0.0.86 source; per-metric decision record. Reversibility: costly.
- Scheduling: 236's merge and FIG-05's fleet re-derive wait for 233 and 234 (234 is PR #1339). Plan and execute now. The fleet re-derive is a PROD write: stop and hand it to the coordinator. Re-check `155.2-12-SUMMARY.md` is absent on origin/main before shipping; record which side of the freeze the merge lands on.

### Claude's Discretion
Constant module names and locations per language; the census mechanism; the parity-oracle shape (must import no production helper); the pinned parity tolerance (set from a stated derivation, never loosened to absorb a move).

### Deferred Ideas (OUT OF SCOPE)
The fleet re-derive execution itself (PROD write) - handed to the coordinator after 233 and 234 merge.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIG-01 | Every annualizing engine follows F-5; one named constant set per language; cross-language pin | Census (section 1), constants + pin design (section 6a) |
| FIG-02 | Same CAGR, Sharpe, TWR across engines within a pinned tolerance; oracle imports no production helper | Parity design + tolerance derivation (section 6b) |
| FIG-03 | CVaR historical, null below one named constant; quantstats 0.0.86 with decision record | Decision record (section 2), CVaR floor (section 3) |
| FIG-04 | One CAGR span rule in every engine, pinned | Span rule + sites (section 1), UI span (section 4) |
| FIG-05 | Moved figures re-derived fleet-wide; frozen spine re-baselined as reviewed act; CHANGELOG names the figures | Frozen spine (section 5), fleet re-derive (section 7) |
</phase_requirements>

## Summary

The Python stored engine already IS F-5 for CAGR and Sharpe: the stored CAGR uses `_CALENDAR_DAYS_PER_YEAR = 365.0` over whole `.days` of the post-last-break suffix, and Sharpe/vol use pandas `std()` (ddof 1) with `sqrt(periods_per_year)`. The work is therefore mostly TypeScript: `compute.ts` (`days / 365.25`, `ddof: 0`, `dispersion(rets, 0)`), `closed-sets.ts` `calendarYears` (365.25, feeds `scenario.ts` and `og-metrics.ts`), and ddof-0 population sd at `rolling.ts`, `joint.ts`, `bootstrap.ts`, `og-metrics.ts`, `holding-compare-adapter.ts`. Scenario already uses ddof 1; it moves only on the year length. Three Python stragglers exist outside metrics.py's headline path: hard-coded `math.sqrt(252)` for `smart_sharpe`/`smart_sortino`, `services/portfolio_metrics.py` XIRR on 365.25, and `services/optimizer.py` `TRADING_DAYS = 252`.

Several names in the `L2214` list are stale at HEAD and the census must say so rather than carry them: `scenario-blend-panels.ts` does not exist (git ls-files finds no such file); `equity_reconstruction.py` has no annualizer (`MetricsSnapshot(sharpe=None, twr=None, ...)`); `health-score.ts` only scores a stored Sharpe; `routers/match.py` only reads stored Sharpe; `_compute_portfolio_analytics` already calls `blend_periods_per_year` and the shared `sharpe_vol_status_from_backbone`. The live annualizing sites in `match_engine.py` / portfolio scoring are `_compute_sharpe` in `services/portfolio_optimizer.py` (pandas `std()` = ddof 1, already F-5) and a display string `years = track / 365`.

quantstats 0.0.86 (sdist downloaded and AST-diffed against 0.0.81 this session): the stored `cvar` and `var_1d_95` no longer touch quantstats at all (194 D-02 replaced them with `_historical_var_cvar`), so the "CVaR moved" headline mostly bites the serenity mirror and parity arms, not stored `cvar`. PSR, rolling-greek alpha, benchmark pairing and the `max_drawdown` baseline are corrections the repo mirrors ALREADY adopted (D-16, D-17, 166.4 D-A, Phase 166). The genuinely open per-metric calls are NaN counting (`win_rate`, `exposure`, `common_sense_ratio` via `_prepare_returns` no longer zero-filling) and the CVaR leg inside `serenity_index`.

**Primary recommendation:** Land in four code waves: (1) constants + census + cross-language pin written RED first, (2) TS engines and Python engine in parallel (disjoint files), (3) quantstats 0.0.86 + decision record on `metrics.py` after the Python F-5 plan, (4) independent-oracle parity test, frozen-spine re-baselines, CHANGELOG, TODOS deletions, and a written fleet re-derive handoff. Bump `FIGURE_DEFS_VERSION` 2 -> 3 in both languages so unmigrated rows fall back to computed figures during the gap before the coordinator's re-derive.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stored headline figures (CAGR, Sharpe, CVaR, ...) | API / Backend (`analytics-service/services/metrics.py`) | Database (`strategy_analytics.metrics_json`) | Canonical at full history (D-01); overlay reads stored |
| Narrowed-range / zoomed figures | Browser / Client (`compute.ts`) | Frontend Server (payload build) | Recomputed from the dailies for the selected window |
| Scenario / blend figures | Browser / Client (`scenario.ts`) | -- | Pure TS projection engine over `commonDates` |
| Portfolio analytics, matching | API / Backend (`routers/portfolio.py`, `match_engine.py`) | -- | Python scoring on the same backbone |
| Convention constants | Both (one named set per language) | Test layer | Cross-language pin reads both literals |
| CAGR span statement | API (stored span keys) | Browser (renders) | Span is the post-break suffix, only the backend knows it at full history |
| Fleet re-derive | Database / worker (compute jobs) | Coordinator (PROD write) | Not run by this phase |

## Standard Stack

No new package. One version move.

| Library | Current | Target | Purpose |
|---------|---------|--------|---------|
| quantstats | 0.0.81 | 0.0.86 | live leaves + parity reference. [VERIFIED: PyPI sdists `quantstats-0.0.81.tar.gz` and `quantstats-0.0.86.tar.gz` downloaded and read this session] |

Pin sites (one PR): `analytics-service/requirements.in` (line `quantstats==0.0.81`), `analytics-service/requirements.txt` (`quantstats==0.0.81`, regenerate with `make lock`), `analytics-service/requirements-dev.txt` (`quantstats==0.0.81`, plus the comment "Note: quantstats==0.0.81 is also pinned in requirements.txt today"), `.github/dependabot.yml` (the `- dependency-name: "quantstats"` ignore block under the comment "quantstats is held at 0.0.81 until QUANTSTATS-0086-REDERIVE-01"), `docs/runbooks/metrics-nan-policy.md` line 88 ("quantstats 0.0.81 returns a per-period"). [VERIFIED: grep this session]

### Package Legitimacy Audit
Existing, already-locked dependency; this phase changes its version only. The `gsd_run query package-legitimacy check` seam was not run (no new package; the 0.0.86 artifact was fetched from PyPI by `pip download --no-binary :all:` and only parsed with `ast`, never imported). Planner: add one `checkpoint:human-verify` before `make lock` is committed, to eyeball the lock diff touches quantstats only. [ASSUMED: PyPI provenance; 0.0.86 release date 2026-09-27 per STACK.md]

## 1. CENSUS of annualizing sites

Convention targets (F-5, Q1): year length 365 (CAGR, calendar); sd ddof 1; `sqrt(periods_per_year)` where `periods_per_year` stays by frequency (crypto 365 / traditional 252 / blend 365 if any crypto-or-unknown leg); CAGR span = "first to last observed date of the same suffix, whole days, divided by 365", `max(days, 1)`. F-5 does NOT change the 252/365 frequency split.

### Python (`analytics-service/`)

| Site (file : symbol) | Year length | ddof / sd | Span rule | Under F-5 / Q1 |
|---|---|---|---|---|
| `services/metrics.py` `compute_all_metrics` CAGR | `_CALENDAR_DAYS_PER_YEAR = 365.0` | n/a | `(_cagr_index[-1] - _cagr_index[0]).days`, `max(.., 1)`, over `_last_interior_break_suffix(returns).index` | NO CHANGE (already the rule). Becomes the reference. Add stored span keys (section 4) |
| `metrics.py` `_annualized_vol_sharpe` | n/a | `r.std()` (pandas ddof 1), `sqrt(periods_per_year)` | n/a | NO CHANGE |
| `metrics.py` rolling windows `_rolling_sharpe`, `_rolling_calendar_stats`, `_rolling_volatility`, `_rolling_sortino` | n/a | pandas ddof 1 | window by rows / 365 calendar (`ROLLING_1Y_WINDOW_DAYS`) | NO CHANGE (TS rolling moves to match) |
| `metrics.py` smart_sharpe / smart_sortino | n/a | ddof 1 | n/a | CHANGE candidate: hard-coded `math.sqrt(252)` at the two `_smart_*` return lines (comment: "sites use quantstats' DEFAULT `periods=252` rather than `periods_per_year`"). Crypto strategies read smart_* on sqrt(252) though every other risk figure rides `periods_per_year`. Recommend thread `periods_per_year`; moves stored `smart_sharpe`/`smart_sortino` for crypto by sqrt(365/252); name in CHANGELOG. DECISION FLAG (see Assumptions A3) |
| `metrics.py` `DEFAULT_PERIODS_PER_YEAR = 252`, `PERIODS_PER_YEAR_CRYPTO = 365`, `blend_periods_per_year`, `periods_per_year_for_asset_class` | frequency clock | -- | -- | NO CHANGE of values; become part of the named constant set |
| `metrics.py` `_historical_var_cvar` | n/a | n/a | n/a | CVaR floor lands here (section 3) |
| `routers/portfolio.py` `_compute_portfolio_analytics` | via `blend_periods_per_year(...)` -> `sharpe_vol_status_from_backbone(portfolio_returns_series, periods_per_year=blend_ppy)` (metrics.py) | ddof 1 (backbone) | no own CAGR; `total_return_from_equity` TWR only | NO CHANGE of math. It is NOT an independent stack at HEAD; census row = "verified on the backbone" |
| `services/portfolio_optimizer.py` `_compute_sharpe` (used by `match_engine.py` via `compute_sharpe = _compute_sharpe`, and portfolio scoring) | `periods_per_year` param, default `DEFAULT_PERIODS_PER_YEAR` | `returns.std()` ddof 1 | n/a | NO CHANGE (already F-5). Keep in the parity oracle set |
| `services/match_engine.py` `years = track / 365` | 365 | n/a | `track_record_days` | NO CHANGE. Display text ("Long track record (x years)"), not a figure; list as already-365 |
| `services/allocated_capital.py` `_annualised_sharpe/_annualised_sortino`, `_ANNUALISATION_DAYS = 365.0` | 365 (sqrt) | `std(ddof=1)` | n/a | NO CHANGE (already F-5; Zavara-convention headline) |
| `services/portfolio_metrics.py` XIRR `t_years = ... (d - t0).days / 365.25` | 365.25 | n/a | first cash-flow date | CHANGE: `/ 365`. Hand-solved test `tests/test_portfolio_metrics.py` pins "365.25-day basis" (`1.1 ** (365.25/365)`); re-derive it. Money-weighted rate, so decision record row, not an oracle site. [ASSUMED: founder intends XIRR under F-5; flag A4] |
| `services/optimizer.py` `TRADING_DAYS = 252` (`cov * TRADING_DAYS`, `mean * TRADING_DAYS`) | 252 fixed | `ledoit_wolf_shrinkage` | n/a | OPEN: weight-search risk model, not a published figure; not on the L2214 list. Recommend leave and record "out, not a published figure" in the census (A5) |
| `services/equity_reconstruction.py` | none (`MetricsSnapshot(sharpe=None, twr=None, ...)`) | none | none | Census row "no annualizer at HEAD" - the L2214 name is stale |
| `routers/match.py` | reads stored `sharpe` only | -- | -- | Census row "consumer, no annualizer" |
| `services/mt5_parity_findings.py` / `parity_diff.py` `REANNUALIZATION_FACTOR = 365.0 / 252.0` | explains the old 252->365 move | -- | -- | Diagnostic constants. Out of the convention set; census marks "classifier of past moves" |
| Composite paths (`stitch_composite`, composite blend) | -- | -- | -- | OUT (F-2) |

### TypeScript (`src/`)

| Site (file : symbol) | Year length | sd | Span rule | Under F-5 / Q1 |
|---|---|---|---|---|
| `src/lib/factsheet/compute.ts` `compute` (`const years = days / 365.25`, `days = Math.max(1, ms / 86_400_000)`) | 365.25 | `dispersion(rets, 0)` and `dispersion(basisReturns, 0)`; `sharpeRatio(basisReturns, { periodsPerYear, ddof: 0, rf })` | first to last of `dates` | CHANGE: `/ 365`; basis sd and Sharpe to ddof 1. Keep `dispersion(rets, 0)` ONLY for skew/kurtosis (population moments, not annualized) with a comment saying so. `ann_vol = basisSd * Math.sqrt(periodsPerYear)` inherits ddof 1 |
| `compute.ts` `ddDev` Sortino downside RMS over `basisN` | -- | RMS / N | -- | NO CHANGE (matches Python `_downside_rms` observed count) |
| `src/lib/closed-sets.ts` `calendarYears` (`ms / (365.25 * 86_400_000)`) | 365.25 | n/a | caller supplies first/last | CHANGE: whole days over 365, `max`-guard stays "0 when non-positive". Callers: `scenario.ts`, `factsheet/og-metrics.ts` |
| `closed-sets.ts` `annualizationPeriods`, `blendPeriodsPerYear` | frequency clock 365/252 | -- | -- | NO CHANGE; join the constant set |
| `src/lib/scenario.ts` (`calendarYears(Date.parse(commonDates[0]), Date.parse(commonDates[n - 1]))`; `dispersion(portDaily, 1)`; `returnStatsSharpe(.., ddof: 1)`) | 365.25 via calendarYears | ddof 1 already | `commonDates` first-last | CHANGE only through `calendarYears` |
| `src/lib/factsheet/og-metrics.ts` (`calendarYears(Math.min(...times), Math.max(...times))`, `sharpeRatio(values, { periodsPerYear, ddof: 0 })`) | 365.25 | ddof 0 | min/max of times | CHANGE ddof to 1; year via `calendarYears` |
| `src/lib/factsheet/rolling.ts` (`dispersion(w, 0).sd * sqrtN`, `sharpe(.., ddof: 0)` for the row windows; a ddof-1 branch for the 365-day window) | -- | ddof 0 (126/30 rows) | rows | CHANGE to ddof 1 (the D-14 residual, `A-194-D14-02`). Stored Python rolling is ddof 1 |
| `src/lib/factsheet/joint.ts` `jointMetrics` (`dispersion(active, 0).sd`, `sharpe(active, { ddof: 0 })`) | -- | ddof 0 | -- | CHANGE ddof 1 (tracking error, info ratio). Python `te`/`info_ratio` use `_annualized_vol_sharpe` ddof 1 |
| `src/lib/factsheet/bootstrap.ts` (`sharpeRatio(rets, { periodsPerYear, ddof: 0 })`) | -- | ddof 0 | -- | CHANGE ddof 1 (CI band must center on the headline Sharpe) |
| `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` (`dispersion(returns, 0).sd * Math.sqrt(periodsPerYear)`, `ddof: 0`, twice) | -- | ddof 0 | -- | CHANGE ddof 1 (not on the L2214 list; found by grep. It prints vol/Sharpe on the compare surface) |
| `src/lib/portfolio-stats.ts` (`dispersion(diff, 1).sd * Math.sqrt(periodsPerYear)`; alpha `(mean(r) - beta * mean(b)) * periodsPerYear`) | frequency | ddof 1 | -- | NO CHANGE |
| `src/lib/sample-basis-ratios.ts` (`sharpe(.., { periodsPerYear, ddof: 1 })`) | frequency | ddof 1 | -- | NO CHANGE |
| `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` (`sharpe(diff, { periodsPerYear, ddof: 1 })`) | frequency | ddof 1 | -- | NO CHANGE |
| `src/app/(dashboard)/allocations/lib/book-figures.ts` (`LIVE_BASELINE_PERIODS_PER_YEAR = 365`) | 365 | -- | -- | NO CHANGE; add to constant set import |
| `src/lib/factsheet/record-length.ts` `formatRecordLength` (`years` doc: "days / 365.25") | doc says 365.25 | -- | -- | Doc string follows `compute().years`; update the comment; value follows compute |
| `src/lib/figure-gate.ts` `ONE_YEAR_DAYS = 365`, `coveredDays` (+1 inclusive) | 365 | -- | covered days, inclusive | NO CHANGE (gate unit, not the CAGR span; keep distinct and say so in the census) |
| `src/lib/health-score.ts` | none (scores a stored Sharpe) | -- | -- | Census "consumer" |
| `src/lib/scenario-blend-panels.ts` | FILE DOES NOT EXIST at HEAD | -- | -- | Census "stale name"; actual blend files: `scenario-blend-adapter.ts`, `scenario-factsheet-payload.ts` (both pass `periodsPerYear` through, default 252) |
| `src/app/factsheet/[id]/v2/BatchDPanels.tsx` (`basisDays = ... ? 252 : 365`) | frequency | -- | -- | Display basis for the gate sentence; not a computation. Census "display" |
| composite-only paths | -- | -- | -- | OUT (F-2) |

Source: every row read from the file this session (grep + targeted reads). [VERIFIED: codebase]

**Census mechanism (recommended):** a vitest `src/__tests__/annualization-census.test.ts` that greps `src/**` (non-test) and a pytest `tests/test_annualization_census.py` that greps `analytics-service/**` (non-test) for the tokens `365.25`, `/ 365`, `365.0`, `252`, `ddof`, `.std(`, `dispersion(` with a second arg of `0`, `sqrt(`, and requires every hit file to appear in an explicit CLASSIFIED map (`engine` | `display` | `consumer` | `composite-out` | `gate-unit`) with a one-line reason. A new, unclassified site fails by name. Pitfall guard: the census test must itself be neuter-proven (add a `365.25` to a copy, see RED naming the file).

## 2. quantstats 0.0.86 per-metric decision record (DRAFT)

Method: `pip download --no-binary :all:` of both sdists into scratchpad dirs, `ast` function-level diff of `quantstats/stats.py` and `quantstats/utils.py` (parsed, never imported), formatting/docstring-only hunks filtered. Python called with `-I`. The repo's sandbox policy denied EXECUTING the 0.0.86 code, so the parity corpus under 0.0.86 is a Wave 0 task, not a finding here (see A1).

Upstream changes confirmed in source:
- `conditional_value_at_risk`: gains `method="parametric"` default (closed-form `_gaussian_expected_shortfall`) and `"historical"` (`series[series <= series.quantile(alpha)]` mean); drops the 0.0.81 mixed estimator (`returns[returns < var]` mean, fall back to VaR); empty tail -> NaN not VaR. `cvar`/`expected_shortfall` pass `method`.
- `_prepare_returns(data, rf, nperiods, apply_rf=True)`: removes the `inspect.stack()` caller-name hack and the unconditional `fillna(0)` (the removed line was `data = data.fillna(0).replace([_np.inf, -_np.inf], float("NaN"))`; no replacement was visible in the diff, so zero-fill is gone from `_prepare_returns`; confirm in Wave 0).
- `_get_baseline_value(prices, from_returns)`: baseline 1.0 for series rebuilt from returns, else the first price; the price-magnitude guess is gone. `max_drawdown`/`to_drawdown_series` call `_utils._looks_like_returns`.
- `probabilistic_ratio`: `kurtosis_no = kurtosis(series, prepare_returns=False) + 3`; variance `1 - skew*base + ((kurtosis_no - 1)/4) * base**2`; `rf` threaded; `annualize` deprecated and ignored.
- `rolling_greeks` alpha per window (`means = df.rolling(int(periods)).mean()`); `greeks`/`r_squared` use `_paired_observations`.
- `_exposure`: denominator `observed = int((~_np.isnan(ret)).sum())`, 0.0 when none.
- `sortino`: downside divides by `returns.count()` not `len(returns)`.
- `_win_rate`/`win_rate`: `series = series.dropna()` first.
- `avg_win`/`avg_loss`: `.dropna()` removed (pandas `mean` skips NaN: no value change).
- `kelly_criterion`: docstring-only net (0.0.82-0.0.83 change reverted in 0.0.84).
- UNCHANGED bodies: `value_at_risk`, `volatility`, `recovery_factor`, `ulcer_index`. `profit_factor`, `tail_ratio`, `drawdown_details`, `payoff_ratio`, `cpc_index`, `omega`, `sharpe`, `ulcer_performance_index`: formatting / docstring / `_rf_is_nonzero` only.

### Decision table (founder rule: adopt unless F-5/F-6 says otherwise; CVaR stays historical)

| Metric (metrics.py symbol) | 0.0.86 change | Repo state | Decision |
|---|---|---|---|
| stored `cvar`, `var_1d_95` (`_historical_var_cvar`) | upstream default is parametric normal ES | repo rule: sort, `k = floor(0.05 n)`, `CVaR = mean(sorted[0:max(1,k)])`, no quantstats call | **KEEP repo historical rule (F-6).** Do NOT adopt 0.0.86 `method="historical"` either: its tail is `<= quantile(0.05)` with linear interpolation, a different estimator from the repo's floor-index rule and from the TS twin `historicalVarCvar`. Add the `CVAR_MIN_OBS` floor (section 3) |
| `_cvar_of_tail` (serenity mirror: `serenity_index` CVaR leg on the drawdown series, via `value_at_risk(dd)`) | serenity now calls parametric `cvar` by default | mirrors the 0.0.81 mixed estimator | **Recommend historical tail on the drawdown series** (F-6 spirit; fat tails). Parity arm then recomposes serenity from live `ulcer_index` + `qs.stats.cvar(dd, method="historical", prepare_returns=False)` and the std term, not from `qs.stats.serenity_index` (which now bakes the parametric default). Moves stored `serenity_index`. DECISION FLAG A2 |
| PSR (`_probabilistic_sharpe_ratio` / `probabilistic_sharpe_ratio`) | upstream now equals the published formula | mirror already carries D-16 (`gamma4 = r.kurtosis() + 3`, `(gamma4 - 3)/4`) | **ADOPT / CONVERGE.** The two forms are algebraically equal: mirror `1 + .5b^2 - s*b + (kurt/4) b^2` vs 0.0.86 `1 - s*b + ((kurt+3-1)/4) b^2`. No value move. The existing `test_q166_psr_matches_the_published_formula` stays the anchor; add a live-quantstats parity row (previously "PSR has no live-quantstats parity row" because 0.0.81 carried the defect) |
| `_rolling_greeks` alpha | per-window alpha | mirror already windowed (D-17) | **ADOPT (already adopted).** Replace `test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form` (asserts difference from the 0.0.81 form) with a parity arm against live 0.0.86 |
| `_greeks_no_guess`, `r_squared` mirrors | `_paired_observations` | already interval-paired (166.4 D-A) | **ADOPT (already adopted).** Parity reference moves; measure |
| `_max_drawdown_from_wealth`, drawdown series | baseline 1.0 for returns-derived | mirror already pins 1.0 ("minus the price guess") | **ADOPT (already adopted).** Parity reference moves; no stored value moves |
| `_downside_rms` / headline sortino | denominator `count()` | repo already `int(x.count())` | **ADOPT (already adopted).** No move |
| `time_in_market` (H-0724: `(returns != 0).sum() / len(returns)`) | observed-count denominator | `len(returns)` | **ADOPT observed count only if NaN reaches the site** - measure; identical on NaN-free series |
| `win_rate` (live, `qs.stats.win_rate(p, prepare_returns=False)`) | `dropna()` first | `p` is the repo-prepared (zero-filled) series | No move expected; measure (Wave 0) |
| `common_sense_ratio` (`profit_factor * tail_ratio`; live leaves at the `_common_sense_ratio` mirror) | NaN no longer zero-filled by `_prepare_returns` | mirror zero-fills ("P(r)") | **ADOPT observed-only NaN handling** (a NaN day is not a 0% return; matches the repo's skipna convention at headline Sharpe/Sortino and the no-invented-data rule). Moves stored `common_sense_ratio` only on NaN-carrying series. DECISION FLAG A2 |
| `cpc_index`, `payoff_ratio`, `kelly_criterion`, `omega`, `recovery_factor`, `ulcer_index`, `ulcer_performance_index` | none in value | mirrors | No decision needed; one-line "unchanged by diff" rows; parity arms must stay GREEN unchanged |
| live leaves `value_at_risk`, `avg_win`, `avg_loss`, `profit_factor`, `tail_ratio`, `volatility`, `drawdown_details` | none in value | called `prepare_returns=False` | No move. `profit_factor`/`tail_ratio` are called on RAW `returns` at their `compute_all_metrics` sites: measure NaN behavior under 0.0.86 |

**Tests that pin 0.0.81 values or the version (re-derive each, record a decision; never re-pin without one).** Files with `0.0.81` text (grep): `analytics-service/tests/test_metrics.py` (the version pin `assert qs.__version__ == "0.0.81"` and its message "cite 0.0.81 source and must be re-derived against the new version"; also the `_rolling_greeks` direct math pin vs "live 0.0.81" and the `r_squared` notes), `tests/test_metrics_parity.py` (RANK-05 live arms, Q166 arms for `serenity_index` and `common_sense_ratio`), `tests/test_qstats_gate.py` and `tests/qstats_gate.py` (AST gate + `cvar` calibration arm), `tests/test_mt5_golden_fixtures.py`, `tests/test_mt5_deal_reconstruction.py`. TODOS lists the red set from Dependabot #953: `test_rank05_quantstats_pin_is_still_0_0_81`, RANK-05 `cvar` live parity (-0.0279 -> -0.0344), Q166 `serenity_index` and `common_sense_ratio`, `test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form`, qstats-gate `cvar` calibration (8 tests). Wave 0 re-enumerates by running the full `analytics-service` pytest against 0.0.86 in a throwaway venv and recording the RED list verbatim before touching any expected value. TS side: `src/__tests__/metrics-parity.test.ts` (schema gate, reads `golden_252d_expected.json`), `src/lib/sample-basis-ratios.ts` and its tests cite quantstats as the basis; stored-value-driven, check only.

## 3. CVaR floor

- Constant: `CVAR_MIN_OBS = 60`. Python: next to `MIN_ANNUALIZATION_OBS = 60` in `metrics.py`. TS: next to `MIN_ANNUALIZATION_OBS = 60` in `src/lib/figure-gate.ts`. Same value as the annualization obs floor today but a SEPARATE named constant (founder: "one named constant per language"; do not alias, so a later retune of one does not move the other). A vitest reads `metrics.py` and pins the pair (pattern: `figure-gate.test.ts` reads `analytics-service/services/metrics.py` with `readFileSync` and a regex, asserting each name is defined exactly once).
- Python: `_historical_var_cvar` currently floors only `n == 0` ("`n == 0` gives `(None, None)`"). Change CVaR to `None` when `n < CVAR_MIN_OBS`; `n` = non-NaN returns of the record the helper is handed. The only stored call is `compute_all_metrics` (`_historical_var_cvar(returns)` writing `metrics_json["cvar"]`), and `returns` there is the TOTAL record, so "total record only" is automatic in Python. Leave `var_1d_95` unfloored (F-6 names CVaR only) and return the VaR leg even when CVaR is None; update the docstring and the pinned `figure_parity_vectors.json` `var_cvar` section (add a `n = 59` -> null and `n = 60` -> value vector, hand-derived by closed form).
- TS sites and "total record known?":
  - `compute.ts` `compute`: `const hist = historicalVarCvar(rets); const cvar95 = hist.cvar ?? NaN;` runs on whatever `rets` is passed (the zoomed window). The floor must NOT apply to the window. At full history the factsheet reads the STORED `cvar` via `overlayStoredFigureDefs` (`cvar95: num(stored.cvar95) ?? NaN`, gated by `figureDefsVersion`), so total-record nulling arrives through the stored value. For a zoomed window `compute()` keeps computing CVaR whenever `n >= 1`. Because `compute()` cannot tell total from window, add NO floor inside `compute`; put the total-record floor in the one place that knows the total: `fetch-and-build-payload.ts` where the full series is in hand (apply `CVAR_MIN_OBS` to the full record's observation count when building the payload's whole-record `cvar95`) and in the stored overlay (stored null stays null, already so).
  - `scenario-factsheet-payload.ts` sets `cvar95: NaN` (Scenario preview shows none): no change.
  - `allocations/lib/scenario-stress.ts` `computeVarPath`: `computeVaR` / `computeExpectedShortfall` over the blend's `portfolioDaily`, with the engine's own "n<10" emptiness; the blend's total record IS `portfolioDaily`, so the 60 floor applies to `portfolioDaily.length` there. [ASSUMED: founder Q2 covers this blend CVaR; flag A6]
  - `portfolio-stats.ts` `computeExpectedShortfall` delegates to `historicalVarCvar(returns, tailOf(confidence)).cvar ?? NaN`: callers pass whole books; floor at the call sites that hold the total, not inside the helper (the helper is also the zoomed-window path).
  - Display: `MetricsColumn.tsx` prints `m.cvar95` through `wr(pctSigned(m.cvar95, 2))` in three rows (NaN renders the dash). No UI change needed beyond the dash.
- Cross-language: `historicalVarCvar` in `src/lib/return-stats.ts` and `_historical_var_cvar` are already pinned to one JSON fixture (`figure_parity_vectors.json`, read by `tests/test_figure_parity.py` and `src/lib/figure-parity.test.ts`); extend that fixture, do not fork it.

## 4. Factsheet "states the span CAGR covers"

- Today the stored row persists only `record_observations` (`metrics_json["record_observations"] = int(headline.dropna().shape[0])`); the CAGR suffix span (`_cagr_index` first/last after `_last_interior_break_suffix`) is not stored. At full history the factsheet reads the stored CAGR, so it cannot state the span without a stored fact.
- Recommended: add two additive keys to `metrics_json` in `compute_all_metrics`, `cagr_start` and `cagr_end` (ISO days of `_cagr_index[0]` and `_cagr_index[-1]`; null when CAGR is null), select them in `fetch-and-build-payload.ts` beside `figure_defs_version:metrics_json->figure_defs_version`, and for a narrowed range derive the string from `dates[0]` / `dates[n-1]` that `compute()` already holds. One formatter `formatCagrSpan(start, end)` next to `formatRecordLength` in `src/lib/factsheet/record-length.ts`: "CAGR over 14 Mar 2024 to 02 Nov 2025 (598 days)", days = whole first-to-last days (NOT `coveredDays`, which is inclusive +1; keep the two named differently). Pre-re-derive rows without the keys render no span line (no invented text; fail-quiet is the existing convention for absent stored keys).
- Render: one muted line directly under the CAGR row in `MetricsColumn.tsx`, same muted-note treatment as the existing short-track note (DESIGN.md governs: use existing muted text token and Numbers Contract, em-dash for absent; no new component). Read DESIGN.md before the UI task (project rule). Add a rendered test on a book with an emptied stretch (closes the TODOS gate "with a test on a book with an emptied stretch"): the span string covers the emptied stretch.
- Emptied stretches stay in the span (Q1): no denominator change in any engine; the TODOS "Not a close: removing the stretch from the chart" still applies.

## 5. Frozen spine and re-baselining

- `src/__tests__/phase-29-frozen-spine-guards.test.ts`: its scenario.ts zero-diff assertion is ALREADY RETIRED. Quote (L347-353): "the frozen-engine assertion (scenario.ts SCENARIO-05 zero-diff) was RETIRED here as a reviewed act ... scenario.ts is now protected by scenario.test.ts's own pins". Phases 30, 31, 32 carry the same retirement note ("the freeze is RETIRED here as a reviewed act"). `phase-52-frozen-spine-guards.test.ts` lists scenario.ts and compute.ts as "reviewed-edit carve-outs", REMOVED from `FROZEN_ISLANDS`. So editing `scenario.ts` / `compute.ts` does not trip a git-delta guard; the guards that remain live are the RLS honesty pins (phase 29 point 3) and baseline-ref resolution. Re-baseline act for FIG-05 = a dated reviewed-act comment block in the phase-29..32 / 52 style naming 236, plus moving the numeric pins below, each with a recorded decision. Do not delete or invert any guard.
- The pins that actually move (grep-verified, this is the SCENARIO-05 / BODY-02 regression set): `src/lib/scenario.test.ts` (`CAL_MS_PER_YEAR = 365.25 * 86_400_000`, `calendarYearsIndep`, the "Plan 84-06 - CAGR rides the CALENDAR clock (days / 365.25)" block), `src/lib/closed-sets.test.ts` (`calendarYears: elapsed span on the 365.25-day civil clock`, `toBeCloseTo(1, 12)` at `365.25 * DAY`), `src/lib/factsheet/compute.metrics.test.ts` (`toBeCloseTo(165 / 365.25, 12)` and the asset-class-invariant CAGR note), `src/lib/factsheet/og-metrics.test.ts` (`365.25 / 299`, `365.25 / 28`, 1e6-growth overflow case), `src/lib/factsheet/return-stats.sites.test.ts` (`(t1 - t0) / (365.25 * 86_400_000)`), `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts` (365.25 axis), `src/lib/scenario-blend07.test.ts` (812d / 365.25 = 2.2231y numpy gate), `src/lib/factsheet/fetch-and-build-payload.test.ts` (`years = 1461 / 365.25 = 4 EXACTLY`), `src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx` (438 / 365.25 = 1.1992), `src/lib/factsheet/allocator-portfolio-payload.test.ts`. Python: `tests/test_portfolio_metrics.py` (XIRR 365.25).
- How to re-baseline without `regen_golden.py`: `regen_golden.py` (header: "Run via `python -m tests.fixtures.regen_golden --i-am-fixing-a-real-bug`"; "this script imports the same helpers that test_metrics_parity.py asserts against, so a math bug bakes silently into the fixture on regen") must NOT run in this PR. The Python stored engine does not change math for the golden CAGR/Sharpe (already F-5), so `golden_252d_expected.json` should not move from F-5; if the quantstats move changes golden keys, move ONLY those keys by hand with a per-key decision row in the SUMMARY, and write the independent closed-form or hand-derived expected next to each (pattern: the `test_mt5_golden_fixtures.py` hand arithmetic). For TS pins: recompute each expected from an INDEPENDENT oracle (plain `Date.parse` arithmetic over 365, as `calendarYearsIndep` already does, just with 365) in the same commit as the engine change, and record old -> new -> why in the plan SUMMARY. `metrics-parity.test.ts` is a schema gate reading the committed expected JSON; it moves only if the JSON moves.

## 6. Test design

### 6a. Constant set and cross-language pin
- Python: one named set in a new tiny module `analytics-service/services/figure_conventions.py` (or the top of `metrics.py` where `_CALENDAR_DAYS_PER_YEAR = 365.0`, `DEFAULT_PERIODS_PER_YEAR = 252`, `PERIODS_PER_YEAR_CRYPTO = 365` already live; new module preferred so the TS pin reads a file with exactly one definition per name). Names: `CALENDAR_DAYS_PER_YEAR = 365.0`, `SD_DDOF = 1`, `PERIODS_PER_YEAR_CRYPTO = 365`, `PERIODS_PER_YEAR_TRADITIONAL = 252`, `CVAR_MIN_OBS = 60`. `metrics.py` imports them (keep `_CALENDAR_DAYS_PER_YEAR` as an alias only if a test imports it; grep first).
- TS: `src/lib/figure-conventions.ts` exporting the same names; `calendarYears`, `compute.ts`, `og-metrics.ts`, `rolling.ts`, `joint.ts`, `bootstrap.ts`, `holding-compare-adapter.ts` import `SD_DDOF`; `calendarYears` imports `CALENDAR_DAYS_PER_YEAR`; `ddof` literal `0` anywhere in an annualizing call fails the census.
- Pin test: a vitest reads `analytics-service/services/figure_conventions.py` with `readFileSync` and a regex per name (exactly-once rule, as `figure-gate.test.ts` does), compares to the TS import; a pytest reads the TS file the same way. Either side changing a value (one-sided) fails with the constant named. The fixed `0` ddof, a `365.25` literal, or a missing name each fail the census arm.

### 6b. Cross-engine parity with an independent oracle
- Oracle: a fixture `analytics-service/tests/fixtures/annualization_parity_vectors.json` (new file; do not widen `figure_parity_vectors.json`'s sections) holding closed-form series, read by BOTH `tests/test_annualization_parity.py` and a vitest. Expected values are written in the JSON from math, not from any engine. Closed-form construction: repeating `[+0.02, -0.01]` for even `n`: mean exactly 0.005; sample sd `0.015 * sqrt(n/(n-1))`; Sharpe `0.005 / sd * sqrt(P)`; TWR `(1.02 * 0.99)^(n/2) - 1`; with consecutive daily dates the span is `n - 1` days so CAGR `= (1 + TWR)^(365/(n - 1)) - 1`. Include (i) a 24/7 crypto vector (P = 365), (ii) a weekday vector (P = 252) with weekend gaps (span in days != n), (iii) a narrowed suffix after an interior break, (iv) an emptied-stretch vector (calendar span includes the gap, per Q1). The test computes the oracle inline with `math`/plain loops (Python) and plain arithmetic (TS), importing no production helper; the existing `calendarYearsIndep` in `scenario.test.ts` and the TS block in `metrics-parity.test.ts` ("deliberately NOT importing any production helper") are the in-repo precedent.
- Engines compared per vector: Python `compute_all_metrics`, `_compute_sharpe` (portfolio_optimizer, the match path), `sharpe_vol_status_from_backbone`; TS `compute()`, `computeScenario` (scenario.ts), `og-metrics`, `sample-basis-ratios` Sharpe, `holding-compare-adapter`. TWR from `cumulative_twr_segmented`/`total_return_from_equity` and TS `cumEq`.
- Tolerance derivation (state it in the test header): all engines evaluate the same closed forms; differences are float summation order. Mean carries relative error <= n * eps, with n <= 2000 and eps = 2.2e-16 that is <= 4.4e-13. CAGR raises `(1 + TWR)` to `365 / span`; with span >= 365 on the fixtures the exponent <= 1 so relative error does not amplify (for span 30, exponent ~12, amplification 12x: still <= 5.3e-12). Sharpe divides two quantities each with that bound. Pin `rtol = 1e-9` (more than 100x headroom over 5.3e-12), `atol = 0`. A move outside 1e-9 is a convention divergence, never a reason to widen. Do not set the tolerance by running the engines.

## 7. Fleet re-derive (NOT run here)

- Stored figures are written by `derive_basis_series` + `persist_basis_series` (`services/basis_series.py`), reached from `job_worker.py` jobs (`run_derive_broker_dailies_job`, `run_derive_allocator_equity_job`, `run_sync_trades_job`, `run_compute_analytics_from_csv_job` via `analytics_runner.run_csv_strategy_analytics`). All enqueue through `public._enqueue_compute_job_internal` (`supabase/schema/functions/_enqueue_compute_job_internal.sql`; kind `compute_analytics` is retired there: "kind compute_analytics is retired (Phase 106)").
- Existing fan-outs: `enqueue_derive_broker_dailies_for_allocator_keys()` (pg_cron `derive-allocator-key-dailies`, schedule `30 5 * * *`), `enqueue_ledger_refresh_for_strategies()` (system_flags-gated fan-out with a weekly cap per 20261114152300 `ledger_fanout_no_advance_weekly_cap`; runbook `docs/runbooks/ledger-refresh-go-live.md`). The daily derive cron will re-derive allocator keys on its own after the merge; strategy rows and CSV strategies need an explicit enqueue. The Phase 167.1.2.2.1 precedent (`docs/runbooks/deribitwedge-rebaseline-readings.md`) enqueues the recompute "through the product's own enqueue path" and orders explicit recomputes so no row is recomputed twice.
- Planner deliverable, not execution: a runbook `docs/runbooks/figuremath-fleet-rederive.md` (handoff to the coordinator) that (1) names the enqueue path chosen after Wave 0 reads the `enqueue_ledger_refresh_for_strategies` cap and the CSV path, (2) states the marker query first (`SELECT shobj_description(oid, 'pg_database') ...`), (3) states the before/after readings to capture for the CHANGELOG (per-figure: cagr, sharpe, sortino, vol, calmar, cvar, serenity_index, common_sense_ratio, smart_sharpe, smart_sortino, alpha), (4) states freshness is `strategy_analytics.computed_at`, never `last_sync_at`, and a pg_net cron "success" only means queued, (5) says nothing about Binance/composite legs (F-2).
- FIGURE_DEFS_VERSION gate: `basis-metrics.ts` `overlayStoredFigureDefs` returns `base` (computed) when `figureDefsVersion < FIGURE_DEFS_VERSION`, "the computed figures use the same definitions". Bump both `FIGURE_DEFS_VERSION = 2` (metrics.py) and `export const FIGURE_DEFS_VERSION = 2` (figure-gate.ts, pinned pair) to 3 in this PR: until a row is re-derived the factsheet shows computed figures (same definitions, now F-5 in TS), never a stale-convention stored CVaR/p6m/p3m. Hazard: a half-bumped pair fails the pin test by design; bump in one commit.

## Architecture Patterns

```
daily returns + dates (strategy dailies / blend commonDates / narrowed window)
   |
   +--> Python stored engine: compute_all_metrics
   |        CAGR: suffix first..last whole days / 365.0
   |        vol/Sharpe: std(ddof=1) * sqrt(periods_per_year by frequency)
   |        CVaR: _historical_var_cvar, null if n < CVAR_MIN_OBS
   |        -> strategy_analytics.metrics_json (+ cagr_start/cagr_end, figure_defs_version 3)
   |
   +--> TS engines (compute.ts / scenario.ts / og-metrics.ts / rolling / joint / bootstrap / compare)
            CAGR: first..last whole days / 365 (calendarYears)
            vol/Sharpe: SD_DDOF = 1, sqrt(periodsPerYear)
            full history: overlayStoredFigureDefs reads stored when figure_defs_version >= 3
   |
   +--> parity oracle: closed-form vectors (JSON) read by pytest + vitest, imports no production helper
   +--> pin tests: constant literals in both languages; census of annualizing sites
```

Recommended structure: `analytics-service/services/figure_conventions.py`, `src/lib/figure-conventions.ts`, `analytics-service/tests/fixtures/annualization_parity_vectors.json`, `src/__tests__/annualization-census.test.ts`, `analytics-service/tests/test_annualization_census.py`, `tests/test_annualization_parity.py`, a vitest parity file, `docs/runbooks/figuremath-fleet-rederive.md`, and the decision record `236-QUANTSTATS-DECISIONS.md` in the phase dir.

Anti-patterns: aligning one engine and leaving its mirror; aligning the constant and leaving rolling windows on ddof 0; "fixing" a red parity test by re-pinning from new output; running `regen_golden.py`; editing a migration or workflow to get a deploy out; adding a CVaR floor inside `compute()` (it cannot tell total from window).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---|---|---|
| Sample sd / Sharpe in TS | a new local std | `dispersion(xs, 1)` and `sharpe(xs, { periodsPerYear, ddof: 1 })` in `src/lib/return-stats.ts` (reports float-residue sd as 0) |
| Historical VaR/CVaR | a third copy | `historicalVarCvar` (TS) / `_historical_var_cvar` (Py), fixture-pinned |
| Year/periods mapping | a local `365`/`252` ternary | `annualizationPeriods`, `blendPeriodsPerYear`, `periods_per_year_for_asset_class`, `blend_periods_per_year` |
| Cross-language literal pin | a snapshot | regex-read both source files (pattern in `figure-gate.test.ts`) |
| Re-baselining golden JSON | `regen_golden.py` | hand-edit keys with per-key decisions and independent expected values |

## Common Pitfalls

1. **Mirror left behind.** Aligning `compute.ts` but not `rolling.ts`/`joint.ts`/`bootstrap.ts`/`og-metrics.ts`/`holding-compare-adapter.ts` leaves the headline and its CI band on different ddof. Census is the guard; warning sign: any `ddof: 0` in an annualizing call.
2. **`calendarYears` whole-day rounding.** Python uses `.days` (floor) on normalized daily timestamps; TS must use whole days from `Date.parse` of ISO day strings (UTC, no DST). Use `Math.round(ms / 86_400_000)`, not a fractional day count; keep `max(days, 1)` for the factsheet and "0 when non-positive" for `calendarYears` callers that gate on `years > 0`.
3. **Span of "the same suffix".** Stored CAGR uses the post-last-break suffix; a TS narrowed window uses its own first/last. They agree whenever the window is that suffix; the parity vector (iii) must cover a broken chain.
4. **Gate unit vs CAGR span.** `coveredDays` is inclusive (+1) and `ONE_YEAR_DAYS = 365`; the CAGR span is first-to-last without +1. Do not unify them; name both in the census.
5. **FIGURE_DEFS_VERSION half-bump.** Bump both languages in one commit or the pin test goes red.
6. **Stale L2214 names.** Do not "fix" `scenario-blend-panels.ts` or `equity_reconstruction.py`; record them as stale in the census.
7. **Tolerance loosening.** Any parity RED is investigated as a convention divergence first. A tolerance edit without a derivation is not a close.
8. **PR-run drift gates.** VAC-08 and the baseline-content-drift pair can be red on a PR by construction (CLAUDE.md); a migration is not part of this phase (no schema change: `metrics_json` keys are additive).

## Code Examples

```typescript
// Source: src/lib/closed-sets.ts (current) -> target shape. Whole days over 365, same guard.
export function calendarYears(firstDateMs: number, lastDateMs: number): number {
  const ms = lastDateMs - firstDateMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 86_400_000) / CALENDAR_DAYS_PER_YEAR; // CALENDAR_DAYS_PER_YEAR = 365
}
```
Python reference (already in `compute_all_metrics`): `_elapsed_days = max((_cagr_index[-1] - _cagr_index[0]).days, 1)`; `(1.0 + total_return) ** (_CALENDAR_DAYS_PER_YEAR / _elapsed_days) - 1.0`.

## State of the Art

| Old | Current | When | Impact |
|---|---|---|---|
| quantstats CVaR mixed estimator | normal ES default, `method="historical"` | 0.0.83 | repo keeps its own historical rule |
| PSR kurtosis double-subtract | corrected | 0.0.82 | repo fixed first (D-16) |
| `_prepare_returns` zero-fill + stack inspection | observed-only, explicit `apply_rf` | 0.0.83-0.0.86 | NaN convention decision |
| Price-magnitude drawdown baseline | `from_returns` baseline | 0.0.82 | repo fixed first (Phase 166) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Running the full pytest corpus against 0.0.86 will produce the red set listed in TODOS plus any NaN-driven arms; not executed here (sandbox denied executing the downloaded code) | 2 | Decision table may miss a red arm; Wave 0 must run it in a venv before any expected value changes |
| A2 | Serenity CVaR leg -> historical tail; `common_sense_ratio` -> observed-only NaN handling | 2 | Founder may read "adopt upstream" as parametric ES inside serenity; confirm before executing plan 04 |
| A3 | `smart_sharpe`/`smart_sortino` should thread `periods_per_year` (crypto sqrt(365)) | 1 | Moves two more stored figures for crypto strategies; if not wanted, record "intended: quantstats default periods=252" in the census |
| A4 | XIRR (`portfolio_metrics.py`) moves 365.25 -> 365 under F-5 | 1 | Money-weighted rate shifts ~7e-4 relative; confirm or record as excluded |
| A5 | `services/optimizer.py` `TRADING_DAYS = 252` is out (weight search, not a published figure) | 1 | A reviewer may call it an unthreaded crypto risk model |
| A6 | Q2's 60-obs floor also governs the Scenario blend CVaR (`scenario-stress.ts`, currently "n<10") | 3 | Blend CVaR changes for 10-59 day blends; confirm |
| A7 | `_prepare_returns` in 0.0.86 no longer zero-fills (inferred from a removed line with no visible replacement in the AST diff) | 2 | Wrong NaN reading of `common_sense_ratio`/`win_rate`; read the 0.0.86 function in Wave 0 |
| A8 | Fleet re-derive enqueue path (`enqueue_ledger_refresh_for_strategies` cap, CSV path) not traced end to end | 7 | Runbook may name a path that does not cover every strategy |

## Open Questions

1. Whether `var_1d_95` should stay unfloored while `cvar` nulls below 60 (recommended yes; F-6 names CVaR only).
2. Whether the CHANGELOG names the quantstats-moved figures as "moved for every strategy at next recompute" (TODOS says yes) or only those the Wave 0 measurement shows moving; measure first, then name each.
3. 155.2 side: `git ls-tree origin/main` (local ref `3703ad74f`, may be stale) shows `155.2-12-PLAN.md` and `155.2-14-PLAN.md` but no `155.2-12-SUMMARY.md`; plans 11-14 have no SUMMARY. Merging now lands BEFORE plan 12's recapture. The coordinator must `git fetch` and re-check at ship; record the side in the CHANGELOG.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| python3 + pandas/numpy/scipy | pytest, AST diff | yes | pandas 3.0.1, system `quantstats` 0.0.81 | -- |
| quantstats 0.0.86 runnable | Wave 0 corpus run | NO (execution denied in this session) | sdist at `<scratchpad>` | Plan 04 task 1 builds a throwaway venv from the repo lock plus `quantstats==0.0.86` and runs the corpus, capturing the RED list verbatim |
| Node / vitest | TS pins | yes (repo toolchain) | -- | -- |
| PROD / DB write | fleet re-derive | not used | -- | Coordinator |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`analytics-service/`, run from that dir only) and vitest (repo root) |
| Quick run | `cd analytics-service && python -m pytest tests/test_figure_parity.py tests/test_annualization_parity.py tests/test_annualization_census.py -q` ; `npx vitest run src/lib/figure-conventions.test.ts src/__tests__/annualization-census.test.ts src/lib/figure-parity.test.ts` |
| Full suite | `cd analytics-service && python -m pytest -q` ; `npx vitest run` ; `cd analytics-service && mypy` (CI mypy strict belongs in every analytics brief) |

### Phase Requirements -> Test Map
| Req | Behavior | Type | Command | Exists |
|---|---|---|---|---|
| FIG-01 | constants equal across languages; census classifies every site | unit | `npx vitest run src/lib/figure-conventions.test.ts src/__tests__/annualization-census.test.ts` ; pytest census | Wave 0 |
| FIG-02 | engines agree on closed-form vectors at rtol 1e-9 | unit | `pytest tests/test_annualization_parity.py` + vitest parity | Wave 0 |
| FIG-03 | CVaR None at n=59, value at n=60; quantstats pin 0.0.86; every decision row has a parity arm | unit | `pytest tests/test_figure_parity.py tests/test_metrics_parity.py tests/test_qstats_gate.py` | partly |
| FIG-04 | one span rule; emptied stretch inside the span; span line renders | unit + component | vitest `compute.metrics`, `closed-sets`, new CAGR-span render test | partly |
| FIG-05 | pins re-baselined with recorded decisions; CHANGELOG names figures; TODOS entries deleted | review + lint | `npm run lint` (planning hygiene), vitest critical-regressions | n/a |

Sampling: per task commit the quick run; per wave the full suites; phase gate full green. Wave 0 gaps: the six new files above, plus the venv run of the 0.0.86 corpus.

## Security Domain

| ASVS | Applies | Control |
|---|---|---|
| V5 Input validation | yes (stored/derived numerics) | `_safe_float`, null-never-zero (no invented data), existing `dispersion` residue floor |
| V6 Cryptography | no | -- |
| V2/V3/V4 | no (no auth/session/access change) | -- |
| Supply chain | yes (quantstats bump) | lockfile diff review checkpoint; no postinstall (sdist/wheel of an existing dependency) |

Threat: a dependency bump silently changing money-adjacent figures (Tampering/Integrity): mitigated by the per-metric record, RED-first corpus run, and the pin tests.

## 8. Suggested plan split, waves, write scope, PROOF-01 neuter targets

| Plan | Wave | Topic | Write scope (file + symbol) | PROOF-01 neuter -> expected RED arm |
|---|---|---|---|---|
| 236-01 | 1 | Constants, pin, census (RED first) | NEW `services/figure_conventions.py`, `src/lib/figure-conventions.ts`, census + pin tests | bump `CALENDAR_DAYS_PER_YEAR` to 365.25 in ONE language -> pin test RED naming the constant; add a `365.25` literal in a copy of an engine file -> census RED naming the file; restore by `cp` + `cmp` |
| 236-02 | 2 (parallel with 03) | TS engines | `compute.ts` `compute` (years, basis sd, Sharpe), `closed-sets.ts` `calendarYears`, `og-metrics.ts`, `rolling.ts`, `joint.ts`, `bootstrap.ts`, `holding-compare-adapter.ts`, `record-length.ts` (doc + `formatCagrSpan`), `MetricsColumn.tsx` (span line), `figure-gate.ts` (`CVAR_MIN_OBS`, `FIGURE_DEFS_VERSION = 3`), `fetch-and-build-payload.ts` (select span keys, total-record CVaR floor), `scenario-stress.ts` (A6) | revert `calendarYears` divisor to 365.25 -> parity + scenario pin RED; set one `ddof: 0` in `rolling.ts` -> census/parity RED; remove the floor -> CVaR n=59 vector RED |
| 236-03 | 2 (parallel with 02) | Python engine | `metrics.py` (`_historical_var_cvar` floor, `CVAR_MIN_OBS`, `FIGURE_DEFS_VERSION = 3`, `cagr_start`/`cagr_end`, smart_* threading per A3, import constants), `portfolio_metrics.py` (A4), `tests/fixtures/figure_parity_vectors.json` var_cvar vectors | drop the floor -> `n = 59` vector RED; change `_CALENDAR_DAYS_PER_YEAR` -> pin RED |
| 236-04 | 3 (after 03: same file `metrics.py`) | quantstats 0.0.86 + decision record | `requirements.in`, `requirements.txt` (`make lock`), `requirements-dev.txt`, `.github/dependabot.yml`, `docs/runbooks/metrics-nan-policy.md`, `metrics.py` mirrors per decision table, the six pinning test files, NEW `236-QUANTSTATS-DECISIONS.md` | in a copy, make each mirror disagree with 0.0.86 -> its named parity arm RED; reinstate the 0.0.81 version pin assertion -> RED |
| 236-05 | 4 | Independent-oracle cross-engine parity | NEW `annualization_parity_vectors.json`, `test_annualization_parity.py`, vitest parity | one engine on 252 for a crypto vector -> parity RED naming engine+metric; one engine ddof 0 -> RED; tolerance never edited |
| 236-06 | 4 | FIG-05 close-out | frozen-spine reviewed-act comments + moved numeric pins (section 5), CHANGELOG entry, `TODOS.md` deletions (`194-ENGINE-CONSTANTS`, `QUANTSTATS-0086-REDERIVE-01`, `167.1.2.2.1-CAGR-EMPTY-SPAN`, non-composite half of the `portfolio.py` backbone-bypass bullet; fix the pointer in CLAUDE.md/runbooks if any cites them), `docs/runbooks/figuremath-fleet-rederive.md`, REQUIREMENTS/ROADMAP via hand edit | restore an old 365.25 expected in one pin -> that engine's RED; CHANGELOG cross-check: every commit maps to a bullet |

Ship notes: CHANGELOG entry per the repo's mechanism; `VERSION`/`package.json` byte-equal 4-digit; the ship branch changes nothing under `.planning`; never write the CI skip tokens in any message; `planning-hygiene` rules 6d/6e/7 guard ROADMAP shape; `git diff` after every gsd-tools handler. The coordinator hands over the PROD fleet re-derive after 233 and 234 merge.

## Project Constraints (from CLAUDE.md)
- AGENTS.md: Next.js here differs from training data; read `node_modules/next/dist/docs/` before Next-specific code (this phase edits no routing; the factsheet render change is a component edit).
- DESIGN.md governs the span line; no deviation without approval.
- CHANGELOG entry for every ship, before push, in the VERSION-bump commit; the repo's section vocabulary; name the moved figures.
- `TODOS.md` holds open work only: delete closed entries in the same PR and name them in the CHANGELOG; no LOW/Info survivors booked there.
- Cite by symbol, not line number; never restate a floor/threshold count from memory (read `vitest.config.ts` ratchets).
- `verified_at_sha` + `drift_subjects` (never `covered_files`/`covered_digest`) in VERIFICATION.
- Tests must be able to fail: neuter, see RED, restore from a byte backup (`cp` back + `cmp`); never `git checkout/restore/stash` on uncommitted work.
- Always `grep -a`; pytest only from `analytics-service/`; never `importlib.reload` in tests; CI mypy strict in analytics briefs.
- PROD writes need the marker query first; this phase does none (re-derive is the coordinator's).
- Banned packages list: none involved.

## Sources

Primary (read this session): the repo files named by symbol above; `quantstats-0.0.81.tar.gz` and `quantstats-0.0.86.tar.gz` (PyPI sdists, AST-diffed); `.planning/research/v1.22/STACK.md` ("FIGUREMATH: the quantstats move in detail"), `PITFALLS.md`; `TODOS.md` entries `194-ENGINE-CONSTANTS`, `QUANTSTATS-0086-REDERIVE-01`, `167.1.2.2.1-CAGR-EMPTY-SPAN`, and the "Backbone-bypass parity surfaces" bullet (the `L2214` entry); `REQUIREMENTS.md`; `ROADMAP.md` Phase 236.
Not consulted: Context7 / web docs (no external API in play; the primary source is the sdist). The `research-plan` / `classify-confidence` seams were not invoked.

## Metadata
**Research date:** 2026-11-25. **Valid until:** the next merge touching `metrics.py`, `compute.ts`, `scenario.ts`, or phases 229/233/234 landing (re-measure the census then).
