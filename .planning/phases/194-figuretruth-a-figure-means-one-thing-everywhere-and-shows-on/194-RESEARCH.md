# Phase 194: FIGURETRUTH - Research

**Researched:** 2026-11-07
**Domain:** Cross-surface metric parity (Python analytics engine, TypeScript factsheet and Scenario engines, list/tearsheet/Holdings readers), figure withholding, null-safe list sort/filter
**Confidence:** HIGH on code facts (every `file:line` below was read at HEAD `90f383d99` of `feat/194-figuretruth` this session); MEDIUM on the PROD recompute path (precedent and comments read, no PROD query run); no PROD reads were needed for this research.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The analytics service's STORED figure for the full history is canonical on every page. The factsheet's browser engine (`src/lib/factsheet/compute.ts`) is used only for a range the user narrowed, and that range is labelled as such (193's "Selected range" label). Scenario's engine (`src/lib/scenario.ts`) is used only for blends, which have no stored value. A parity test goes RED when two pages disagree on the same strategy and period. (Founder 2026-11-07: "Stored value, full history".)
- **D-02:** VaR/CVaR use the HISTORICAL method (worst 5% of days) everywhere. The tearsheet and the stored metric (parametric today, `analytics-service/services/metrics.py` ~:2190) move to the historical method the factsheet uses (`compute.ts` ~:236). (Founder: "Historical".) Reversibility: costly, changes a stored metric, so a PROD recompute is needed for stored values to agree; the planner decides whether 194 runs it (cf. the never-run `[164.6.6.3.3-WAVE5-RECOMPUTE]`).
- **D-03 (settled by the house rule "returns by calendar"):** trailing-period returns (3 month, 6 month) are calendar windows (91/182 days), not row counts. Today `metrics.py` ~:2156 takes the last 126 rows, about 4 months on a 7-day crypto venue.
- **D-04:** Annualised figures (CAGR, Sharpe, Sortino, Calmar, annualised vol) are WITHHELD with a stated reason under 90 days of record (the existing `MIN_ANNUALIZATION_DAYS`). From 90 days to one year they show with a short-track note, and from one year on they show plain. The same rule applies on every page. (Founder: "Hide <90d, qualify 90d-1y".)
- **D-05:** Implausible values are SHOWN and NOT flagged: no plausibility bound, no withholding, no warning badge. (Founder 2026-11-07: "Show don't flag", choosing against the recommendation to withhold above +1,000% or at/below -100%.) Only D-04 and genuine nulls withhold a figure.
- **D-06:** The tearsheet's "Minimum Allocation" row (it prints AUM today, `src/app/factsheet/[id]/tearsheet/page.tsx` ~:657-665) is relabelled **"AUM"** and shown ONLY to signed-in users with the allocator role, plus the strategy's own manager on their own strategy. Public visitors and other managers do not see it. The "Negotiable" fallback goes.
- **D-07:** The hard-coded "Lockup: None (read-only API)" row is removed.
- **D-08:** Equity and exposure labels name the quantity: "Book equity", "Modelled equity", "Gross exposure", "Net exposure". The numbers are not merged or dropped; only the ambiguity goes.
- **D-09:** In lists (discovery `StrategyTable.tsx` ~:506, :518-529, My Strategies, and any other sortable/filterable metric list), a missing figure shows as withheld, sorts LAST in both directions, and never matches a range filter. The list states how many rows a filter excluded for missing data.

### Claude's Discretion
- The parity test's shape (D-01) and the wording of the withheld reasons and the short-track note (D-04), within DESIGN.md's voice.
- Whether the D-02 change to the stored metric needs a PROD recompute inside this phase or a booked follow-up. If a recompute is run, it goes through the product's own recompute path, and PROD writes need the orchestrator to ask the founder first.

### Deferred Ideas (OUT OF SCOPE)
- A plausibility bound (withholding values above +1,000% or at/below -100%) was offered and declined (D-05).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-04 | A metric with the same name shows the same value for the same strategy and period on every page; deliberate differences are labelled | Per-page engine/field matrix and divergence list (Section "Engine and field matrix"); the one shared VaR/CVaR and window definition (D-02, D-03); parity test shapes; label work (D-06..D-08) |
| TRUST-05 | A figure that cannot be meaningful is withheld or plainly qualified, never shown at full confidence | `figure-gate` helper contract and its span inputs per surface (D-04); null-last list contract (D-09); D-05 means NO plausibility code anywhere |
</phase_requirements>

## Summary

The three engines disagree on four named things, all provable from code at HEAD. (1) **3M/6M windows:** the stored value is a ROW count (`headline.tail(126)` / `tail(63)`, `metrics.py:2156`, `:2245`), the factsheet's is a calendar cutoff (`compute.ts` `offsetDays(182)` and, notably, `offsetDays(90)` for 3M, not the 91 D-03 locks). (2) **VaR/CVaR:** the stored value is quantstats' parametric `value_at_risk`; the factsheet is historical; and Scenario's `portfolio-stats.ts` is a THIRD historical variant whose CVaR averages one observation more than the factsheet's. (3) **Annualisation constants:** `metrics.py` uses 365 days/year and ddof 1; `compute.ts` and `scenario.ts` use 365.25 (`calendarYears`) and ddof 0 (compute) / ddof 1 (scenario). (4) **Withheld/short-track rules:** only the factsheet warns (amber, three sites), lists and tearsheet print the stored figure bare. The seven headline scalars (cum_ret, ann_vol, max_dd, cagr, sharpe, sortino, calmar) are ALREADY overlaid from the stored `cash_settlement` object on the factsheet for rankable rows (`build-payload.ts:738`, `basis-metrics.ts:18-27`), so at full history those seven already follow D-01; what is not overlaid (p3m, p6m, var95, cvar95, best/worst) is where the pages part today.

The work is therefore small in surface and sharp in risk: change two stored definitions in `metrics.py`, introduce ONE shared TS gate/read module, route every surface through it, replace `?? 0` in the list sort/filter, and relabel. The stored-definition change cannot reach PROD without a recompute, and parity on PROD is the phase's success criterion, so the recompute must be planned, not deferred by default.

**Primary recommendation:** Port the factsheet's exact historical VaR/CVaR and a calendar-window rule (with `recordCoversWindow` semantics) into `metrics.py`, share the same vectors with vitest as a cross-language oracle, add `src/lib/figure-gate.ts` as the only place the 90-day/1-year thresholds and every reason string live, and make a PROD recompute through `enqueue_compute_job` the last plan (an `autonomous: false` checkpoint requiring founder clearance), with VaR/CVaR on the tearsheet gated on a stored marker so a parametric value is never printed under a "historical" caption.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Canonical stored figures (VaR/CVaR, 3M/6M, annualised set) | API / Backend (`analytics-service/services/metrics.py`) | Database (`strategy_analytics`, `metrics_json`) | D-01: stored is truth; the producer owns definitions |
| Withheld / short-track verdict | Shared pure TS module (`src/lib/figure-gate.ts`) | Frontend Server (RSC pages pass span inputs), Browser (factsheet, StrategyTable) | One verdict, no page restates thresholds (UI-SPEC "Figure-state contract") |
| Span inputs for the verdict on lists | Database projection (`CATEGORY_RANKING_ANALYTICS_COLUMNS` aliases) | Frontend Server | The list rows carry only `series_end` today (`queries.ts:460`); start date and `headline_since` are missing |
| List sort/filter null handling | Browser (`StrategyTable.tsx`) via a pure helper | — | Sort and filter run client-side over rows already loaded |
| Tearsheet AUM role gate | Frontend Server (RSC, `tearsheet/page.tsx`) | Database RLS (`user_app_roles` owner-read) | Gate is server-rendered; fail closed on any read error |
| Narrowed-range figures | Browser (`compute.ts` via `useWindowedView`) | — | D-01: browser engine only for a user range |
| Blend figures | Browser (`scenario.ts`) | — | D-01: blends have no stored value |
| PROD recompute | API / Backend job queue (`enqueue_compute_job`) | Orchestrator (founder clearance) | Product's own path (Wave 5 precedent) |

## Standard Stack

No new packages. Everything below is already in the repo. [VERIFIED: package.json scripts read; analytics-service/pyproject.toml read]

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas / numpy / quantstats 0.0.81 | pinned in `analytics-service/requirements*.txt` | Python engine; quantstats stays for every other scalar | The VaR/CVaR change REMOVES the quantstats call for those two scalars only |
| vitest | repo config `vitest.config.ts` | TS tests; includes `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.*` | Existing |
| pytest + mypy strict | `analytics-service/pytest.ini`, `pyproject.toml` | Python tests and type gate | Existing; mypy strict is a CI gate over `services/` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Port the TS floor-index quantile into Python | `numpy.percentile` (linear interpolation) | numpy's 5th percentile interpolates between the 5th and 6th order statistics, so it would NOT equal `compute.ts`; D-02 says the factsheet's method is the target. Use the exact floor-index port. |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. Audit not applicable. Packages removed: none. Packages flagged: none.

## Engine and field matrix (D-01, TRUST-04 SC-1 input)

| Surface | Engine / source | Fields and where read | Evidence |
|---------|-----------------|-----------------------|----------|
| Discovery, My Strategies, manager `/strategies` (`StrategyTable`) | STORED columns | `cumulative_return, cagr, sharpe, calmar, max_drawdown, volatility, six_month_return` plus aliases `three_month:metrics_json->three_month`, `series_end:returns_series->-1->>date`; AUM is the manager-declared `strategies.aum` | `queries.ts:460` quoted: `"computed_at, computation_status, cumulative_return, cagr, sharpe, calmar, max_drawdown, volatility, six_month_return, sparkline_returns, sparkline_drawdown, three_month:metrics_json->three_month, series_end:returns_series->-1->>date, ..."`; cells `StrategyTable.tsx:1659-1680` [VERIFIED: read] |
| Factsheet rail / strip, full history | browser `compute()` over the series, THEN seven scalars overlaid from stored `cash_settlement` | overlay keys `cum_ret, ann_vol, max_dd, cagr, sharpe, sortino, calmar` (`BASIS_KPI_MAP`, `basis-metrics.ts:18-27`); NOT overlaid: `p3m, p6m, p1y, mtd, ytd, var95, cvar95, best/worst, skew, kurt` come from `compute()` | `build-payload.ts:721-738` `const overlaid = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement);` [VERIFIED: read] |
| Factsheet, user-narrowed range | `compute()` on the slice (`useWindowedView`) | all figures browser-computed; the rail already hides trailing rows while selected (`MetricsColumn.tsx` `window-trailing-note`) | `MetricsColumn.tsx:259-262, :430-433` [VERIFIED: read] |
| Tearsheet | STORED, direct | hero `cagr, sharpe, sortino, max_drawdown`; detail `volatility, calmar, six_month_return, cumulative_return`; from `metrics_json`: `var_1d_95`, `cvar`, `best_day`, `worst_day` | `tearsheet/page.tsx:509-592` [VERIFIED: read] |
| Holdings per-strategy | STORED | `sharpe`, `max_drawdown`, `mtd` from `analyticsByStrategyId` or `strategies[].strategy_analytics` | `holdings-adapter.ts:176-186` [VERIFIED: read] |
| Scenario blend | `scenario.ts` (+ `portfolio-stats.ts` for VaR) | own cagr (365.25), vol/sharpe ddof 1; VaR via `computeVaR`, CVaR via `computeExpectedShortfall` | `scenario.ts:588-616`, `portfolio-stats.ts:111-137` [VERIFIED: read] |

### Where the same name differs today (each is a code fact)

| Metric | Stored (`metrics.py`) | Factsheet `compute.ts` | Scenario | Phase action |
|--------|----------------------|------------------------|----------|--------------|
| 6 Month | last 126 ROWS, `None` if fewer (`:2156`) | calendar `offsetDays(182)` guarded by `recordCoversWindow` | n/a | D-03: stored moves to a calendar window with the same coverage rule |
| 3 Month | last 63 ROWS (`:2245`) | `offsetDays(90)` (`compute.ts` p3m line) | n/a | D-03 locks 91 days; the TS 90 must move to 91 or D-03 must be reread. Settle ONE constant (Open Question 1) |
| VaR 95% | quantstats parametric `value_at_risk(returns, confidence=0.95)` (`:2190`) | `sortedRets[max(0, floor(0.05*n))]` (`compute.ts:236`) | `computeVaR`: same index rule, clamped to n-1 | D-02 |
| CVaR 95% | `_cvar_of_tail(returns, var)`: mean of values `< var` (`:676-690`) | mean of the `max(1, floor(0.05*n))` smallest (`:237-238`), so it EXCLUDES the VaR element | `computeExpectedShortfall`: mean of `r <= var`, so it INCLUDES the VaR element and ties | D-02: all three must be one definition |
| CAGR year length | 365.0 (`_CALENDAR_DAYS_PER_YEAR`, `metrics.py:70-78`) | days/365.25 (`compute.ts` `years`) | `calendarYears` 365.25 (`closed-sets.ts:688`) | Not settled by any decision; see Open Question 2 |
| Sharpe ddof | ddof 1 (`_annualized_vol_sharpe`) | ddof 0 (`compute.ts` `sharpeRatio(..., ddof: 0)`) | ddof 1 | Same; invisible on full history because of the overlay |

[VERIFIED: all line references read this session]

## Architecture Patterns

### System Architecture Diagram

```
strategy returns (stored)
        |
        v
metrics.py compute_all_metrics  --(NEW)-->  six_month_return / three_month (calendar windows)
        |                                   metrics_json.var_1d_95 / cvar (historical)
        |                                   metrics_json.<marker> (var definition version)
        v
strategy_analytics row (stored, canonical, full history)
        |
        +--> list query (CATEGORY_RANKING_ANALYTICS_COLUMNS + NEW span aliases)
        |         |
        |         v
        |    figure-gate (span -> withheld | short | full | null) --> StrategyTable cell / "<1y" marker
        |         |                                                   sort/filter via null-last helper
        +--> tearsheet RSC --(span from series)--> figure-gate --> hero/detail cells + ONE caption
        |         \--(getUser + getUserRolesResult + strategy.user_id)--> AUM row present/absent
        +--> holdings-adapter --> figure-gate --> Sharpe cell + "<1y"
        +--> factsheet payload: stored seven overlay (already) + figure-gate --> rail/strip notes
                  |
                  +-- user narrows range --> compute() on slice --> figure-gate(selected span)
Scenario blend: scenario.ts --> figure-gate(overlap span) --> note
```

### Recommended Project Structure
```
src/lib/
  figure-gate.ts          # MIN_ANNUALIZATION_DAYS, ONE_YEAR_DAYS, spanDays(), gateAnnualized(), all reason/note strings (UI-SPEC copy table)
  figure-gate.test.ts
  list-figures.ts         # missing-last comparator, rangeMatch (no ?? 0), excludedCount(); pure, so StrategyTable diff is call-site swaps
  list-figures.test.ts
  return-stats.ts         # ADD historicalVarCvar(returns) here; compute.ts and portfolio-stats.ts call it
analytics-service/services/metrics.py   # historical var/cvar + calendar windows + marker
analytics-service/tests/fixtures/figure_parity_vectors.json   # shared oracle vectors (read by pytest AND vitest)
```

### Pattern 1: One shared definition, two languages, shared vectors
**What:** `compute.ts:236-238` is the definition: sort ascending; `k = max(0, floor(0.05*n))`; `VaR = sorted[k]`; `CVaR = mean(sorted[0 : max(1, k)])`. Port it byte-for-byte to Python on `returns.dropna()` and put the same numeric vectors in a JSON fixture asserted by both `pytest` and `vitest`. There is precedent for a TS test reading Python sources (`vitest.config.ts` comment "Phase 18 / FIX-04 — TS↔Python parity test reads both"; `MetricsColumn.arithmetic-windows.test.tsx` references `analytics-service`). [VERIFIED: grep, vitest.config.ts:30-40]
**Sign convention:** both are signed RETURN fractions (negative for a loss), exactly as stored today (`var_1d_95` negative per `test_metrics.py:1647` comment "a finite negative") and as `formatPercent` prints them.
**Why this exact rule, not numpy:** the UI-SPEC copy says "VaR is the loss exceeded on 5% of days, CVaR the average loss on those days". With `k` days strictly below `sorted[k]`, that sentence is literally true for the compute.ts rule and false for Scenario's `r <= var` rule. Recommend aligning `portfolio-stats.ts computeExpectedShortfall` to the shared helper; it moves Scenario's CVaR by one observation and needs `scenario-stress.test.ts` / `StressVarSection.test.tsx` expectations re-derived, not blind-updated.
**Example (Python target):**
```python
# Source: port of src/lib/factsheet/compute.ts:236-238 (read this session)
def _historical_var_cvar(returns: pd.Series) -> tuple[float | None, float | None]:
    r = np.sort(returns.dropna().to_numpy(dtype=float))
    n = len(r)
    if n == 0:
        return None, None
    k = int(math.floor(0.05 * n))
    var = float(r[max(0, k)]) if k < n else float(r[-1])
    cvar = float(r[: max(1, k)].mean())
    return var, cvar
```

### Pattern 2: Calendar window with the same coverage rule
Python must replicate `recordCoversWindow` (`compute.ts:45-97`), including its weekday-venue tolerance (a record counts as weekday-venue only if it spans a Saturday and has no Saturday/Sunday observation; the first session after the cutoff skips Sat, Sun, 1 Jan, 25 Dec) and `returnFrom(cutoff)`: product of `(1 + r)` over dates `> cutoff`, where `cutoff = last_date - N days`, N = 182 (6M) and the locked 91 (3M). Under `cumulative_method == "simple"` the window is the SUM (`_bucket_return`). A record that does not cover the window is `None`, which every surface prints `—`. Do NOT keep a row-count fallback.

### Pattern 3: The gate, one verdict from the span
`span = lastDate - firstDate` in calendar days, where for a chain-broken row first date is `max(first, headline_since)` (the stored annualised scalars are computed on the suffix, `metrics.py:1747-1757`, and `insufficient_window` is computed on that same window, `:1862-1869`). `withheld: span < 90`, `short: 90 <= span < 365`, `full: >= 365`, matching `_simple_elapsed_days < MIN_ANNUALIZATION_DAYS` (strict `<`). One TS constant mirrors Python's `MIN_ANNUALIZATION_DAYS`; `COMPARATOR_ANNUALIZATION_FLOOR_DAYS = 90` (`comparator-block.ts:20`) already exists and its doc says "neither restates the 90", so define the new constant in `figure-gate.ts` and make the comparator constant re-export it. Add a TS test that regex-reads `MIN_ANNUALIZATION_DAYS = 90` from `metrics.py` and asserts equality (the FIX-04 precedent).

### Anti-Patterns to Avoid
- **A plausibility check of any kind (D-05).** No `> 1000%` branch, no title, no glyph. UI-SPEC marks it a contract violation. The tests must include a 13-digit cumulative that renders like any finite value.
- **Keying the list on `series_end` alone.** It gives no span. Add `series_start` and `headline_since`.
- **Per-page threshold copies.** Every `90`/`365` and every sentence lives in `figure-gate.ts`.
- **`value ?? 0` in any comparator or range test.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar-window coverage | A new "enough rows" test in Python | A faithful port of `recordCoversWindow` plus shared vectors | The weekday-venue and 1 Jan / 25 Dec rules took two review rounds to settle (169 WR-02, WR-R2-01) |
| Role lookup for the AUM row | A raw `user_app_roles` query | `getUserRolesResult(supabase, user.id)` (`auth.ts`, ~:206-265) | Distinguishes a real fault (`ok:false`) from "no roles"; owner-read RLS lets the request client read the viewer's own roles |
| Money formatting | Inline `toLocaleString` | `formatUsd` (`src/lib/dollar-validation.ts`) | UI-SPEC; dash for null |
| Sign tone | New colour logic | `signTone` / `formatFixedSigned` (`display-sign.ts`) and pass `null` for withheld | Withheld cells carry no tone |
| Span arithmetic | A second date diff | `elapsedDays` logic from `comparator-block.ts:40-44`, exported or moved into `figure-gate.ts` | One calendar-day definition |

## Common Pitfalls

### Pitfall 1: Python and TS quantile drift by one observation
**What goes wrong:** `np.percentile` or `returns[returns < var]` returns different values than `compute.ts`. **Why:** the three existing historical variants already differ (table above). **Avoid:** port the floor-index rule exactly; the oracle vectors must include n not divisible by 20, n < 20 (k = 0, VaR = CVaR = min), and a tied-worst-days case. **Warning sign:** a parity vector passes for n = 200 only.

### Pitfall 2: Existing Python gates pin the parametric method
`tests/test_metrics.py` has `_RANK05_PARITY_SITES` entries `("var_1d_95", "mj", lambda s: qs.stats.value_at_risk(s, confidence=0.95))` and `("cvar", "mj", lambda s: qs.stats.cvar(s))` (~:2811-2812), a failure-injection parametrization `("var_1d_95", "value_at_risk")` / `("cvar", "value_at_risk")` (~:1551-1556), and `test_compute_all_metrics_var_1d_95_uses_correct_kwarg` (~:1633). Golden `tests/fixtures/golden_252d_expected.json` pins `var_1d_95` (`-0.0218254...`), `cvar`, `three_month`, `six_month_return`. `tests/test_qstats_gate.py:936` also calls `value_at_risk`. All must be re-derived deliberately (the VaR rows leave the quantstats parity set; golden changes are a reviewed value change, not a blind update). [VERIFIED: grep read]

### Pitfall 3: Printing a parametric value under a "historical" label
Until the recompute lands, PROD rows hold parametric `var_1d_95`. The new tearsheet label/caption says historical. **Avoid:** write a marker in `metrics_json` at compute time (for example `var_method: "historical"`) and have the tearsheet print VaR/CVaR only when it is present, else `—`. [ASSUMED: that `sanitize_metrics` and the `metrics_json` write path accept a string-valued key; the planner must read `sanitize_metrics` and the tearsheet's `Record<string, number>` cast (`page.tsx` `const m = analytics.metrics_json as Record<string, number> | null`) before choosing a numeric marker such as `figure_defs_version: 2`, which is the safer shape.]

### Pitfall 4: List span without `headline_since` is wrong on chain-broken rows
A row with a 400-day record and a 50-day post-break suffix has stored annualised figures computed on the suffix; a list that measures `series_end - series_start` would call it `full`. **Avoid:** alias `headline_since:data_quality_flags->>headline_since` (and optionally `insufficient_window`) in the same projection style as the existing `native_unit` alias; `queries.test.ts` pins the exact alias set and regex-allows only listed `->>` forms, so update that pin deliberately. `series_start:returns_series->0->>date` is a POSITIVE index (the negative-index form is the one PostgREST's type parser rejects, `queries.ts:381-396`), but measure it against TEST before relying on it. [ASSUMED: positive-index alias works; negative-index precedent is documented]

### Pitfall 5: Missing-last must not be direction-flipped
The existing comparator at `StrategyTable.tsx:866-909` already partitions unranked rows BEFORE the direction flip (`if (aRanked !== bRanked) return aRanked ? -1 : 1;`). Add a second partition for "missing for THIS sort key" in the same position, independent of `effectiveSortDir`, and keep the `created_at` exemption logic. Applies to grid mode (`sortKey`) as well as table mode.

### Pitfall 6: The "excluded because missing" count
The count is "rows excluded by an active range filter whose figure is missing". It needs the pre-filter row set, so compute it in the same `useMemo` as the filters (`StrategyTable.tsx:831-858`), not from the final list. A row excluded by out-of-range value must NOT count.

### Pitfall 7: Composite / calendar-dense VaR input
`compute.ts` VaR runs over `rets` as handed to it; Python runs over `returns` (the whole record, not the headline suffix, `metrics.py:2182-2229`). On a composite (zero-filled calendar series, `calendarDense`) confirm both receive the same series before asserting parity on PROD; keep the oracle in the single-key case and add one composite fixture if the planner can show identical inputs. [ASSUMED]

### Pitfall 8: CHANGELOG, VERSION and ship rules
Per CLAUDE.md: a CHANGELOG entry and a 4-digit VERSION bump in the release commit; `VERSION` and `package.json` byte-equal; never write the CI skip trailer tokens, even to deny them; a ship branch changes nothing under `.planning`.

## Code Examples

### List missing-last comparator (shape)
```typescript
// Source: pattern at src/components/strategy/StrategyTable.tsx:866-909 (read), extended
export function compareWithMissingLast(
  a: number | string | null, b: number | string | null, dir: "asc" | "desc",
): number {
  const aMissing = a === null || (typeof a === "number" && !Number.isFinite(a));
  const bMissing = b === null || (typeof b === "number" && !Number.isFinite(b));
  if (aMissing !== bMissing) return aMissing ? 1 : -1; // direction-independent
  if (aMissing) return 0;                              // caller keeps existing tie order
  if (a! < b!) return dir === "asc" ? -1 : 1;
  if (a! > b!) return dir === "asc" ? 1 : -1;
  return 0;
}
export function rangeMatches(v: number | null, from: string, to: string, scale = 1): boolean {
  if (from === "" && to === "") return true;          // inactive filter matches everything
  if (v === null || !Number.isFinite(v)) return false; // missing never matches (D-09)
  const s = v * scale;
  return !(from !== "" && s < parseFloat(from)) && !(to !== "" && s > parseFloat(to));
}
```
A withheld annualised figure must be passed in as `null` (so `getSortValue` for `cagr`/`sharpe`/`volatility`/`calmar` consults the gate first).

### Tearsheet AUM gate (shape; fail closed)
```typescript
// Source: attestation block at tearsheet/page.tsx:333-350 (read) and getUserRolesResult (auth.ts)
let showAum = false;
try {
  const { data } = await supabase!.auth.getUser();
  if (data?.user) {
    const own = data.user.id === strategy.user_id;           // user_id is in STRATEGY_PUBLIC_COLUMNS (constants.ts:286)
    const roles = await getUserRolesResult(supabase!, data.user.id);
    showAum = own || (roles.ok && roles.roles.includes("allocator"));
  }
} catch (err) { console.error("[tearsheet] aum gate failed:", err); } // stays false
```
`AppRole` is `"admin" | "allocator" | "quant_manager" | "analyst"` (`auth-types.ts:42`). D-06 names allocator and own manager only, so an admin who is neither does not see the row (Open Question 3). The page is `force-dynamic` (`page.tsx:44`), so a per-viewer row is safe from caching. The PDF wrapper fetches without cookies (`page.tsx` header comment), so the PDF never carries the AUM row; say so in the plan.

### Cross-language oracle vectors (independent invariants)
Build series whose answer is known by construction, not by calling either implementation: n = 200 with exactly 10 distinct known worst values `-0.10, -0.095, ... -0.055` and 190 positive days, shuffled. Then `k = 10`, VaR is the 11th smallest (constructed constant), CVaR the arithmetic mean of the ten known values. Windows: a constant `0.001` daily return over 400 calendar days gives `1.001^182 - 1` for 6M (closed form, no helper). Weekday-venue: skip Sat/Sun and assert the Monday-start rule. Boundary vectors for the gate: spans of 89, 90, 364, 365 days.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Row-count 3M/6M in the producer | Calendar windows (D-03) | this phase | stored `six_month_return`, `three_month` move; admin `CompareTable`, `AllocatorMatchQueue`, `CandidateDetail`, `src/lib/admin/match.ts:51` read `six_month_return` and move with it |
| Parametric VaR (quantstats) | Historical (D-02) | this phase | tearsheet only (stored VaR/CVaR are read by `tearsheet/page.tsx`, `types.ts` and the Scenario tests; the factsheet computes in-browser) |

## Runtime State Inventory (stored-definition change)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics.six_month_return` (column), `metrics_json.three_month`, `metrics_json.var_1d_95`, `metrics_json.cvar` on every complete row; PROD context reading from CONTEXT: 18 complete rows, 3 published | Data migration by RECOMPUTE (not a code edit). Code edit changes only how NEW rows are written |
| Live service config | Railway analytics service runs `metrics.py`; deploy must precede recompute (`/health` `git_sha` check precedent, TODOS `164.6.6.3.3-WAVE5-RECOMPUTE` "Order") | Deploy ordering step |
| OS-registered state | None found | None |
| Secrets / env vars | None touched | None |
| Build artifacts | `analytics-service/tests/fixtures/golden_252d_expected.json` is a committed expected-value artifact for these fields | Regenerate deliberately with review |

No DB migration is needed (the new marker lives inside the existing `metrics_json` JSONB). [ASSUMED: no CHECK constraint on `metrics_json` keys; planner confirms]

## PROD recompute: recommendation (research question 7)

**Facts.** The product's own recompute paths are the `compute_jobs` queue via `enqueue_compute_job` (Wave 5 precedent in `TODOS.md:1516-1572`: single-key CSV row through `compute_analytics_from_csv`, composite Quantum Drift through `stitch_composite`, each "done on attempt 1", the composite about 18 minutes). The cron sync path already enqueues `derive_broker_dailies` per strategy of a healthy key (`routers/cron.py` ~:1336-1375, comment "D-02 every eligible strategy of a healthy key"), and `derive_broker_dailies` chains to `compute_analytics_from_csv` which calls `compute_all_metrics` (`job_worker.py:1023-1024`). So API-sourced rows should self-heal on their next sync tick after the analytics deploy; CSV-sourced and composite rows need an explicit enqueue. [CITED: cron.py comments and job_worker.py:1023 read; not exercised]
`[164.6.6.3.3-WAVE5-RECOMPUTE]` was booked, then sat "NOT RUN" at phase close (2026-10-15, TODOS.md ~:1558) until a later consolidated run closed it the same day; the interim state was a withheld headline on affected rows.

**Recommendation: run the recompute INSIDE the phase, as the final plan, an `autonomous: false` PROD-WRITE checkpoint.** Reasons: (1) SC-2 and TRUST-04 are claims about PROD pages agreeing; without the recompute, the lists and tearsheet show row-count 6M and parametric VaR while the factsheet shows calendar 6M and historical VaR, which is the exact defect the phase exists to remove, on PROD, until someone remembers a follow-up. (2) The set is small (about 18 complete rows). (3) The precedent shows a booked recompute drifts. (4) The VERIFICATION needs a post-recompute per-page PROD reading anyway (SC-1 is a before and after reading). Gate it: preconditions are merged, main CI green, `/health` `git_sha` contains the merge; order is deploy, then recompute; the orchestrator asks the founder before the write; counts only in tracked text (public repo, no PROD ids). Per project memory, prefer enqueueing through the product path over hand SQL.
**If founder clearance is not given:** ship with the marker gate (Pitfall 3) so VaR/CVaR print `—` rather than a mislabelled value, accept the 6M mismatch as a recorded interim gap, and book `[194-RECOMPUTE]` with an owner and acceptance reading. Do not edit workflows to force it.
**Before any code (SC-1):** the PROD reading task is read-only via `mcp__claude_ai_Supabase__execute_sql` (marker query first, one aggregate query per call) and records, per metric, the value each page shows for one strategy and the cause. Re-run it after the recompute as the acceptance reading.

## Phase 195 overlap (research question 9)

Re-read from `git show feat/195-trim:.planning/phases/195-*/195-0N-PLAN.md` `files_modified` (195 has plans only at `e2fb131de`; no source changes on the branch yet). [VERIFIED: git show]

| File | 195 plan / change | 194 change | Mitigation |
|------|-------------------|------------|------------|
| `src/components/strategy/StrategyTable.tsx` (+ `.test.tsx`, `.default-mounts.test.tsx`, `__fixtures__/strategy-table-default-mounts.json`) | 03: delete density state, `handleDensityChange`, `data-density`, the strip div | cells, sort, filter, excluded line, `<1y` marker | land after 195; logic in `list-figures.ts`/`figure-gate.ts`; the default-mounts fixture may need a re-bake after both land |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | 04: dark-mode removal, palette signature, `DisplayMenu` | swap the two amber caveats (~:2030-2062) for the shared note | land after 195; diff limited to those two sentences |
| `src/app/factsheet/[id]/tearsheet/page.tsx` (+ `page.test.tsx`, `page.trade-fetch.test.tsx`) | **05: removes the custody `Disclaimer`, edits the Risk Disclosure paragraph** | Detail metrics (~:566-592), Allocation Terms (~:651-669), hero | UI-SPEC says "none known"; that is wrong. The edits are adjacent (Allocation Terms sits directly above the custody section). Land after 195 or keep hunks disjoint, and expect to rebase tests |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | none | Main Metrics gate, notes, VaR method line | free |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`, `components/BridgeWidget.tsx`, `AllocationsTabs.tsx` | 03 | D-08 "Book equity" headline sites, if they land in these files | enumerate D-08 sites first; avoid these three files or sequence after 195 |
| `src/components/portfolio/PortfolioKpiPanel.tsx` (`label: "AUM"` at :43), `StrategyBreakdownTable.tsx` (`?? 0` sort at :72-80) | 06 and 02 (the `/portfolios` surface being removed) | would be D-08 and D-09 hits | do NOT touch; the surface goes with 195 |
| `src/__tests__/display-sign-single-source.test.ts` | 01, 02, 06 | only if 194 adds a formatter | add no new formatter outside the census; reuse existing helpers |

Not touched by 194, so no overlap: `globals.css`, `DESIGN.md`, `Tweaks*`, `/browse`, `Disclaimer.tsx`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | vitest, tsc, lint | yes | v25.8.1 | none needed |
| node_modules | vitest, tsc | yes | 715 entries | `npm ci` |
| python3 | pytest, mypy | yes | 3.14.3 | none needed |
| pytest, mypy importable in system python | analytics tests | yes (import succeeded) | not pinned-checked | CI image |
| Supabase MCP | PROD reads (SC-1) | not exercised | n/a | orchestrator |

**Missing dependencies with no fallback:** none found. [VERIFIED: bash probes this session]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS, jsdom + node projects) and pytest (Python), mypy strict |
| Config files | `vitest.config.ts`; `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| Quick run (TS) | `npx vitest run src/lib/figure-gate.test.ts src/lib/list-figures.test.ts` |
| Quick run (Py) | `cd analytics-service && python3 -m pytest tests/test_metrics.py -x -q -k "var or cvar or window or six_month or three_month"` (pytest ONLY from `analytics-service/`) |
| Full suite | `npm test` ; `cd analytics-service && make test` |
| Type gates | `npx tsc --noEmit` ; `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (the CI step, `ci.yml` ~:5638, and Makefile `typecheck`) |
| Lint | `npm run lint` (eslint + route/planning-hygiene scripts); ruff is not configured in `pyproject.toml` (only mypy/coverage/pytest found), so do not add a ruff gate [VERIFIED: pyproject.toml grep] |

### Phase Requirements to Test Map
| Req | Behavior | Type | Command | Exists |
|-----|----------|------|---------|--------|
| TRUST-04 / D-02 | Python and TS return the same VaR/CVaR on shared vectors | cross-language | `pytest tests/test_figure_parity.py` + `vitest src/lib/figure-parity.test.ts` | Wave 0 |
| TRUST-04 / D-03 | stored 6M/3M equal the calendar rule on a 7-day and a weekday series; None when uncovered | unit | `pytest tests/test_metrics.py -k window` | Wave 0 |
| TRUST-04 / D-01 | same stored fixture through StrategyTable cell, tearsheet, factsheet payload and Holdings prints one string per metric; RED today on 6 Month | integration | `vitest src/__tests__/figure-parity-pages.test.tsx` | Wave 0 |
| TRUST-05 / D-04 | gate boundaries 89/90/364/365 days on every surface; withheld cell has no tone | unit | `vitest src/lib/figure-gate.test.ts` | Wave 0 |
| TRUST-05 / D-05 | a 13-digit cumulative return renders as any finite value: no badge, glyph, title | unit | in the page-parity test | Wave 0 |
| TRUST-05 / D-09 | missing sorts last asc and desc, never matches a filter (including a range containing 0), count line | unit | `vitest src/lib/list-figures.test.ts`, `StrategyTable.test.tsx` | Wave 0 |
| D-06 | AUM row for anonymous, attested non-allocator, other manager, own manager, allocator, lookup error | integration | `vitest "src/app/factsheet/[id]/tearsheet"` | Wave 0 |
| D-07 / D-08 | no "Lockup", "Negotiable", "Minimum Allocation"; new labels present | unit | tearsheet and widget tests | Wave 0 |

Per project rule, every gate must be shown able to FAIL: neuter the implementation (restore `?? 0`, restore `tail(126)`), see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Money-math oracles are the independent constructed vectors above, never a call to the implementation under test. Always `grep -a`; a new test file moves censuses, grep them all.

### Sampling Rate
- Per task commit: the quick commands for the touched side (TS or Python) plus `npx tsc --noEmit`
- Per wave merge: `npm test` shard of the touched areas and `make test` for Python waves; mypy strict
- Phase gate: full suites green, then `/gsd-verify-work` with the PROD per-page reading

### Wave 0 Gaps
- [ ] `analytics-service/tests/fixtures/figure_parity_vectors.json` and its pytest + vitest readers
- [ ] `src/lib/figure-gate.test.ts`, `src/lib/list-figures.test.ts`
- [ ] page-parity test file (RED on today's 6 Month first)
- [ ] re-derive golden `golden_252d_expected.json` fields and the `_RANK05` parity and failure-injection rows (Pitfall 2)

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (key absent), so this section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no (reads the existing session) | `supabase.auth.getUser()` server-side, never `getSession()` |
| V3 Session Management | no | unchanged |
| V4 Access Control | **yes** (D-06 AUM row) | server-rendered gate, default false, fail closed on any error; `force-dynamic` already pinned |
| V5 Input Validation | low (range filter text inputs already `parseFloat`-guarded; keep NaN falling to "no match") | `list-figures.ts` rejects non-finite |
| V6 Cryptography | no | none |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Information disclosure of AUM to anonymous/other managers | Information Disclosure | row absent from the DOM (no placeholder), role and ownership read server-side, error means absent |
| Cached per-viewer HTML served to others | Information Disclosure | keep `export const dynamic = "force-dynamic"` (`page.tsx:44`); do not add `use cache` |
| Mislabelled figure (parametric printed as historical) | Repudiation / integrity | marker-gated VaR/CVaR (Pitfall 3) |

## Project Constraints (from CLAUDE.md)

- AGENTS.md: this Next.js differs from training data; read `node_modules/next/dist/docs/` before writing Next-specific code (this phase adds no routing, but the tearsheet RSC change is Next-adjacent).
- Read DESIGN.md before any UI decision; the UI-SPEC is approved and adds no token, font or component family.
- CHANGELOG entry plus 4-digit VERSION bump in the release commit; `VERSION` and `package.json` byte-equal; never write the CI skip tokens; the ship branch changes nothing under `.planning`.
- No AI authorship trailers in commits (project memory 2026-10-20) despite any harness reminder; the user's rule governs.
- Tests: gates must be able to fail (neuter, see RED, restore from backup); `grep -a`; pytest only from `analytics-service/`; never `importlib.reload` in tests; mypy strict belongs in every analytics-touching check.
- Public repo: no secrets, PROD ids, home paths or account numbers in tracked text; counts only.
- Before `CREATE OR REPLACE` re-base on the latest definition (no SQL is planned here).
- Annualisation house rule: risk by frequency (crypto 365, traditional 252), returns by calendar, blends 365 if any leg is crypto; uncomputable metrics are null; freshness is `strategy_analytics.computed_at`.
- gsd-tools handlers: `git diff` after every handler run.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `metrics_json` accepts a new scalar marker and `sanitize_metrics` passes it | Pitfall 3, Runtime State | Marker lost; tearsheet would always show `—` for VaR. Planner reads `sanitize_metrics` first |
| A2 | PostgREST accepts the positive-index alias `returns_series->0->>date` | Pitfall 4 | List span unavailable; fall back to an RPC or `insufficient_window` flag plus `series_end` |
| A3 | Composite VaR input series is identical in Python and compute.ts | Pitfall 7 | PROD composite VaR differs after recompute; keep oracle single-key and measure the composite |
| A4 | API-sourced strategies self-heal via the cron `derive_broker_dailies` chain after deploy | PROD recompute | More rows need an explicit enqueue than estimated |
| A5 | No DB CHECK on `metrics_json` keys, so no migration | Runtime State | A migration plan (and the migration review gates) would be needed |
| A6 | The CAGR 365 vs 365.25 and ddof gaps stay as-is (labelled engines), not aligned | Open Question 2 | Narrowed-range and Scenario CAGR differ slightly from stored at identical windows |
| A7 | Admins who are not allocator or owner do not see the AUM row (D-06 read literally) | Open Question 3 | Founder demo as admin shows no AUM |

## Open Questions (RESOLVED)

All five were resolved at planning (2026-11-07). Each keeps its original text as lineage, followed by the resolution.

1. **3M window length: 90 or 91 days?**
   - Known: D-03 locks 91 and 182; `compute.ts` p3m uses `offsetDays(90)`; the UI-SPEC null-cell titles say "3 Month needs 91 days of record".
   - Unclear: whether the TS side is to change to 91 (moving the factsheet's 3M) or D-03's 91 is loose wording.
   - Recommendation: change TS to 91 to honour the locked decision, define both constants once (shared vectors), and note the factsheet 3M moves.
   - RESOLVED: 91 days, by plan 194-02 (`THREE_MONTH_WINDOW_DAYS = 91` and `SIX_MONTH_WINDOW_DAYS = 182` in `metrics.py` and `compute.ts`, pinned equal by a text-read vitest; orchestrator constraint 8 locks D-03 at 91/182). Re-checked against D-15 (2026-11-07): NOT superseded. D-15 moves only the withhold gate of ANNUALISED figures onto the total record. The 3 Month return is a non-annualised calendar window (D-03) that reads null when the record does not cover 91 days (UI-SPEC: "never gated by span"; `windowNeedsTitle("3m")`, plan 194-03). So the 91-day window and D-15's 90-day crypto bound are independent numbers, and neither replaces the other.
2. **CAGR year length and Sharpe ddof across engines**
   - Known: stored 365/ddof 1; compute.ts 365.25/ddof 0; Scenario 365.25/ddof 1. Invisible at full history for overlaid rows.
   - Unclear: whether the planner should align them (no decision covers it; D-01 resolves by canonical source).
   - Recommendation: do not change them in this phase; the parity test asserts equality at full history through the overlay and labels narrowed/blend as different engines. Book the residual gap if the planner wants it recorded.
   - RESOLVED: not aligned in Phase 194 (assumption A6). Plan 194-01 books the residual as TODOS `[194-ENGINE-CONSTANTS]`; plan 194-08's parity test compares at full history through the stored overlay (D-01) and asserts the narrowed-range and blend labels instead of their values. Plan 194-23 adds the 365-day rolling window's ddof residual (A-194-D14-02) to the same entry.
3. **Admin visibility of the AUM row.** D-06 says allocator or own manager. Recommend literal reading; flag A7.
   - RESOLVED: literal reading, confirmed by the founder as D-12 ("Admin gets the rule, no AUM"). Plan 194-07 renders the tearsheet `AUM` row only for an allocator or the strategy's own manager, and its test asserts an admin-only viewer gets no row.
4. **Holdings span inputs.** `analyticsByStrategyId` is built outside the files read; the planner enumerates the query feeding `strategies[].strategy_analytics` and adds `series_start`/`series_end`/`headline_since` there.
   - RESOLVED: by plan 194-11, by a different route from the one recommended above. The record is computed SERVER-side in both Holdings producers, `getOwnCapitalStrategies` and `getMyAllocationDashboard` in `queries.ts`, before the series and flags are stripped. They emit `figure_span_days`, `figure_observations` and `figure_crypto`, which `toStrategyRows` gates on. No list alias is added on that path.
5. **Scenario CVaR alignment.** Aligning `computeExpectedShortfall` changes Scenario's CVaR by one observation; UI-SPEC says Scenario "keeps its labels". Recommend aligning through the shared helper because the same name must show the same value.
   - RESOLVED: aligned, by plan 194-03 Task 3. `computeVaR` and `computeExpectedShortfall` in `portfolio-stats.ts` call `historicalVarCvar` (D-02 everywhere), and every changed test expectation is re-derived by hand.

## Sources

### Primary (HIGH confidence, read in this session)
- `analytics-service/services/metrics.py` :40-100, :640-690, :1700-1800, :1855-1900, :2040-2260
- `src/lib/factsheet/compute.ts` :1-420; `build-payload.ts` :600-780; `basis-metrics.ts` :1-140; `comparator-block.ts` :1-80
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx` :60-135, :228-470; `FactsheetView.tsx` :2025-2070
- `src/app/factsheet/[id]/tearsheet/page.tsx` :1-60, :270-400, :440-700
- `src/components/strategy/StrategyTable.tsx` :280-340, :470-545, :844-912, :1655-1685
- `src/lib/queries.ts` :425-478, :1298, :1590-1642; `src/lib/constants.ts` :284-320; `src/lib/auth.ts` :206-330; `src/lib/portfolio-stats.ts` :106-137; `src/lib/scenario.ts` :580-640; `src/lib/return-stats.ts`
- `analytics-service/tests/test_metrics.py` (VaR/CVaR sites), `tests/fixtures/golden_252d_expected.json` (grep)
- `TODOS.md` :1516-1572; `analytics-service/routers/cron.py` :1330-1375; `job_worker.py` :1023-1024
- `feat/195-trim` plans via `git show` (`files_modified` lists of plans 01-07)
- `194-CONTEXT.md`, `194-UI-SPEC.md`, ROADMAP Phase 194, REQUIREMENTS TRUST-04/05, optional scout notes (re-verified above)

### Secondary / Tertiary
- None. No web sources were needed; no PROD query was run.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependency)
- Architecture and divergences: HIGH (read at HEAD)
- Recompute path: MEDIUM (cron/job-worker read, not exercised)
- Pitfalls: HIGH for 1, 2, 5, 6; MEDIUM for 3, 4, 7 (assumptions A1-A3)

**Research date:** 2026-11-07
**Valid until:** 2026-11-14 (the 195 branch and main move fast; re-resolve every `file:line` by symbol)
