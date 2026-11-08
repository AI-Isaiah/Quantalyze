# Phase 194: FIGURETRUTH - Pattern Map

**Mapped:** 2026-11-07
**Files analyzed:** 22 (9 new, 13 modified)
**Analogs found:** 20 / 22 (2 partial, no true gap)
**Line numbers:** read at worktree HEAD `e673bbc68` of `feat/194-figuretruth`; the planner re-resolves by symbol (195 is moving in parallel). All analog paths verified git-tracked (`git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/figure-gate.ts` (NEW) | utility (pure) | transform | `src/lib/factsheet/comparator-block.ts` (`COMPARATOR_ANNUALIZATION_FLOOR_DAYS`, `elapsedDays`, `comparatorAnnualizationWithheld`) | exact (same rule, generalised) |
| `src/lib/figure-gate.test.ts` (NEW) | test | transform | `src/lib/factsheet/comparator-block.annualization-floor.test.ts` | exact |
| `src/lib/list-figures.ts` (NEW) | utility (pure) | transform | `matchesRange` / `matchesRangeRaw` / `getSortValue` / sort comparator in `StrategyTable.tsx` | exact (extract + fix) |
| `src/lib/list-figures.test.ts` (NEW) | test | transform | `src/lib/return-stats.test.ts` (pure-fn describe/it.each) | role-match |
| `src/lib/return-stats.ts` (MOD: add `historicalVarCvar`) | utility | transform | `compute.ts:236-238` + `portfolio-stats.ts computeVaR/computeExpectedShortfall` | exact |
| `src/lib/factsheet/compute.ts` (MOD: call helper; p3m 90 -> 91) | utility | transform | itself | exact |
| `src/lib/portfolio-stats.ts` (MOD: Scenario VaR/CVaR via helper) | utility | transform | `compute.ts:236-238` | exact |
| `analytics-service/services/metrics.py` (MOD: historical VaR/CVaR, calendar 3M/6M, marker) | service | transform | `_cvar_of_tail` (:676), `six_month` (:2156), `three_month` (:2245), `_var_95` try-block (:2184) | exact |
| `analytics-service/tests/fixtures/figure_parity_vectors.json` (NEW) | test fixture | transform | `analytics-service/tests/fixtures/*_golden.json` + `src/lib/return-stats.test.ts` reads Python as text | partial |
| `analytics-service/tests/test_figure_parity.py` (NEW) | test | transform | `tests/test_metrics.py` (`test_compute_all_metrics_var_1d_95_uses_correct_kwarg`, :1633) | role-match |
| `analytics-service/tests/test_metrics.py` + `golden_252d_expected.json` (MOD) | test | transform | itself (`_RANK05_PARITY_SITES` ~:2811, failure-injection ~:1551) | exact |
| `src/lib/figure-parity.test.ts` (NEW) | test | cross-language | `return-stats.test.ts` lines 85-103 (reads `metrics.py` as text, asserts equal to TS constant) | exact |
| `src/__tests__/figure-parity-pages.test.tsx` (NEW) | test | request-response | `tearsheet/page.test.tsx` mocks + `StrategyTable.test.tsx` fixtures | role-match |
| `src/components/strategy/StrategyTable.tsx` (MOD) | component | CRUD (client sort/filter) | itself :495-530, :831-912, :1010-1030, :1655-1685 | exact |
| `src/lib/queries.ts` (MOD: `CATEGORY_RANKING_ANALYTICS_COLUMNS` aliases) + `queries.test.ts` pin | service (query) | CRUD read | existing aliases in same constant (`series_end`, `native_unit`) | exact |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (MOD) | component | request-response | itself :360-392 (amber caveat, comparator reason line) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (MOD, after 195) | component | request-response | itself ~:2030-2062 | exact |
| `src/app/factsheet/[id]/tearsheet/page.tsx` (MOD) | route (RSC) | request-response | itself :333-350 (auth/attestation gate), :509-592, :651-669 | exact |
| `src/app/factsheet/[id]/tearsheet/page.test.tsx` (MOD) | test | request-response | itself (five-branch auth test, `createClient` mock) | exact |
| `src/app/(dashboard)/allocations/lib/holdings-adapter.ts` (MOD) | utility (pure adapter) | transform | itself :170-186 | exact |
| `positions/ExposureByClass.tsx`, `positions/NetExposureChart.tsx` (MOD, labels) | component | transform | themselves | exact |
| `allocations/components/ScenarioComposer.tsx` (MOD, "Modelled equity" + blend note) | component | request-response | itself :5290-5312, :5505 | exact |

No file lacks an analog. The two "partial" rows are the cross-language fixture and the page-parity test, which compose existing idioms rather than copy one file.

## Pattern Assignments

### `src/lib/figure-gate.ts` (utility, transform) and its test

**Analog:** `src/lib/factsheet/comparator-block.ts` lines 6-44 (the 170.6 rule, same threshold and same span definition).

**Constant + reason helper to generalise** (comparator-block.ts:20, :28-30):
```typescript
export const COMPARATOR_ANNUALIZATION_FLOOR_DAYS = 90;
export function comparatorAnnualizationWithheld(summary: ComparatorSummary | null | undefined): boolean {
  return summary != null && Number.isFinite(summary.cum_ret) && !Number.isFinite(summary.ann_vol);
}
```
**Span arithmetic to move/export** (comparator-block.ts:34-44; the "one calendar-day definition"):
```typescript
const DAY_MS = 86_400_000;
function elapsedDays(dates: readonly string[]): number {
  if (dates.length < 2) return 0;
  return Math.round((Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / DAY_MS);
}
```
Planner action: define `MIN_ANNUALIZATION_DAYS = 90` and `ONE_YEAR_DAYS = 365` in `figure-gate.ts`, make `COMPARATOR_ANNUALIZATION_FLOOR_DAYS` re-export it (its doc says "neither restates the 90"), export `spanDays`. Gate: `withheld: span < 90` (strict `<`, matches Python `_simple_elapsed_days < MIN_ANNUALIZATION_DAYS`), `short: 90 <= span < 365`, `full`. All UI-SPEC copy strings live here as exported constants/functions.

**Test pattern** (comparator-block.annualization-floor.test.ts:1-40): hand-typed expected numbers, `addDays`/`span` date helpers, a `describe` that pins the constant is 90, boundary spans 89/90/364/365. Add the FIX-04 regex-read of `MIN_ANNUALIZATION_DAYS = 90` from `metrics.py` (pattern below).

---

### `src/lib/list-figures.ts` (utility, transform) and its test

**Analog:** `src/components/strategy/StrategyTable.tsx` :495-530 and :866-909. Extract and fix; do not restate.

**Defect to replace** (StrategyTable.tsx:495-510, :518-529):
```typescript
function matchesRange(value: number | null | undefined, range: RangeFilter, scale: number): boolean {
  if (range.from === "" && range.to === "") return true;
  const v = value ?? 0;               // <- D-09 bug: missing matches a range containing 0
  ...
}
function getSortValue(s, key): number | string {
  ...
    case "aum": return s.aum ?? 0;
    case "six_month_return": return s.analytics.six_month_return ?? 0;
    default: return (s.analytics[key as keyof StrategyAnalytics] as number) ?? 0;
```
**Existing partition to extend, not flip** (StrategyTable.tsx:866-909): unranked rows are partitioned BEFORE the direction flip, independent of `effectiveSortDir`, and `created_at` is exempt:
```typescript
if (effectiveSortKey !== "created_at") {
  const aRanked = isRankedRow(a);
  const bRanked = isRankedRow(b);
  if (aRanked !== bRanked) return aRanked ? -1 : 1;
}
const aVal = getSortValue(a, effectiveSortKey);
const bVal = getSortValue(b, effectiveSortKey);
if (aVal < bVal) return effectiveSortDir === "asc" ? -1 : 1;
```
Add a second partition for "missing for THIS key" right after, also direction-independent (RESEARCH Pitfall 5). `getSortValue` returns `null` for missing and for withheld annualised keys (`cagr`, `sharpe`, `volatility`, `calmar`) after consulting `figure-gate`. Keep the `name`/`computed_at`/`created_at` string handling (`""` sorts oldest, never an invented date). Shapes for `compareWithMissingLast` and `rangeMatches` are in RESEARCH "Code Examples". Compute the excluded-because-missing count in the same `useMemo` as the filters (:831-858) from the pre-filter set (Pitfall 6).

**Test pattern:** `return-stats.test.ts` style (pure-fn `describe`, `it.each`). Required cases: missing sorts last asc AND desc, never matches a range containing 0, inactive filter matches all, out-of-range row not counted as excluded. Neuter test: restore `?? 0`, see RED.

---

### `src/lib/return-stats.ts` + `compute.ts` + `portfolio-stats.ts` (historical VaR/CVaR, one definition)

**Definition (analog, compute.ts:236-238)**:
```typescript
const sortedRets = [...rets].sort((a, b) => a - b);
const var95 = sortedRets[Math.max(0, Math.floor(0.05 * n))];
const cvar95Slice = sortedRets.slice(0, Math.max(1, Math.floor(0.05 * n)));
const cvar95 = cvar95Slice.reduce((acc, x) => acc + x, 0) / cvar95Slice.length;
```
**The divergent Scenario variant to align** (portfolio-stats.ts:111-137): `computeVaR` same index but clamped to `n-1`; `computeExpectedShortfall` is `returns.filter(r => r <= var_)` then `mean(tail)`, which INCLUDES the VaR element and ties (one observation more than compute.ts). Route both through `historicalVarCvar(returns)` in `return-stats.ts`; re-derive `scenario-stress.test.ts` / `StressVarSection.test.tsx` expectations, do not blind-update. Keep the F2 M-0541 upper clamp comment's intent.

**Module convention** (`return-stats.ts` header): pure functions, no Date/random/I/O, `import { mean, stdDev } from "@/lib/portfolio-math-utils"`, doc block that names the twin Python source and which test pins them.

---

### `analytics-service/services/metrics.py` (service, transform)

**Analog:** itself. Edit sites:

**VaR/CVaR site to replace** (:2184-2196): the RANK-05 try/except block that sets `metrics_json["var_1d_95"]` from `qs.stats.value_at_risk(returns, confidence=0.95, prepare_returns=False)` and logs `qstats scalar var_1d_95 failed (returns_len=%s, nonnan_len=%s)`. Keep the try/except + `_safe_float` + the process-level warning-dedupe style; swap the body for the Python port (RESEARCH Pattern 1):
```python
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
`_cvar_of_tail` (:676-690, mean of values `< var`) is superseded for `cvar` only; its serenity-mirror caller (plan 166-03) keeps it, so do not delete.

**Window sites** (:2156 and :2245), today row counts:
```python
six_month = _safe_float(_bucket_return(headline.tail(126))) if len(headline) >= 126 else None
metrics_json["three_month"] = _safe_float(_bucket_return(headline.tail(63))) if len(headline) >= 63 else None
```
Replace with a calendar-window helper that ports `recordCoversWindow` (compute.ts:45-97: weekday-venue tolerance, skip Sat/Sun/1 Jan/25 Dec for first session) and `returnFrom(cutoff)` (dates `> last - N days`, N = 182 / 91). `None` when uncovered. Continue to use `_bucket_return` (:1771) so `cumulative_method == "simple"` sums. They still ride `headline` (the FACTSHEETTRUTH D-01 suffix).

**Constants** (:70-90): `_CALENDAR_DAYS_PER_YEAR = 365.0`, `MIN_ANNUALIZATION_DAYS = 90` with a dated comment block. Add `FIGURE_DEFS_VERSION` marker the same way (a numeric `metrics_json["figure_defs_version"] = 2` is the safer shape; read `sanitize_metrics` :506 first, RESEARCH A1). The tearsheet prints VaR/CVaR only when the marker is present.

**Tests (existing pins to re-derive deliberately, RESEARCH Pitfall 2):** `tests/test_metrics.py` `_RANK05_PARITY_SITES` (`("var_1d_95", "mj", lambda s: qs.stats.value_at_risk(...))`, `("cvar", ...)`) ~:2811-2812, failure-injection `("var_1d_95", "value_at_risk")` ~:1551-1556, `test_compute_all_metrics_var_1d_95_uses_correct_kwarg` (:1633, populated-and-finite-negative assertion survives), `tests/test_qstats_gate.py:936`, and `fixtures/golden_252d_expected.json` (`var_1d_95`, `cvar`, `three_month`, `six_month_return`). Import idiom: `from services.metrics import compute_all_metrics, _safe_float, sanitize_metrics`; pytest ONLY from `analytics-service/`; mypy strict over `services/`.

---

### `analytics-service/tests/fixtures/figure_parity_vectors.json`, `tests/test_figure_parity.py`, `src/lib/figure-parity.test.ts` (cross-language oracle)

**Analog (TS reads Python as text and pins equality):** `src/lib/return-stats.test.ts:85-103`:
```typescript
it("exactly one numeric-literal definition exists across dispersion.py and metrics.py, equal to the TS constant", () => {
  const hits: string[] = [];
  for (const file of PY_FILES) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (DEFINITION.test(line)) hits.push(line);
    }
  }
  expect(hits, hits.join("\n")).toHaveLength(1);
  const literal = DEFINITION.exec(hits[0])![1].replace(/_/g, "");
  expect(Number(literal)).toBe(DISPERSION_RESIDUE_REL);
});
```
Copy for `MIN_ANNUALIZATION_DAYS = 90` ↔ `figure-gate.ts`. For the numeric vectors there is no direct analog; use the JSON fixtures already in `analytics-service/tests/fixtures/` (e.g. `constit_parity_fixture.json`) as the shape precedent and have BOTH pytest and vitest load the same file. Vectors are constructed by independent invariant (RESEARCH "Cross-language oracle vectors"): 200 days with 10 known worst values; n not divisible by 20; n < 20 (VaR = CVaR = min); tied worst days; constant `0.001` daily over 400 days gives `1.001^182 - 1` for 6M; a weekday-venue case; gate spans 89/90/364/365. Never call the implementation under test to produce an expected value.

---

### `src/components/strategy/StrategyTable.tsx` (component, client sort/filter)

**Analog:** itself. Edits are call-site swaps into `list-figures.ts` / `figure-gate.ts` (land AFTER 195, which removes the density toggle).

**Filter block to re-route** (:831-858): `matchesRange(s.analytics.cagr, advancedFilters.cagr, 100)`, `matchesRangeRaw(s.aum, advancedFilters.aum)`, the `three_month` branch that prefers the alias then `mj?.three_month`. Keep the alias-first-then-blob fallback comment (Phase 159, identical on anon and owner surfaces). Withheld annualised value goes in as `null`.

**Cell block to gate** (:1659-1680): CAGR / Sharpe / Volatility cells currently `formatPercent(s.analytics.cagr)` with `magnitudeColor(...)`. For withheld: render `—` with no tone, `title` = reason, plus sr-only text. For `short`: append the `<1y` marker modelled on `pctSuffix` (:1019-1030), fixed-width slot so digits stay aligned:
`ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted`. Pass `null`, not the stored number, to `signColor`/`magnitudeColor`.

**Excluded-count line:** one `role="status" aria-live="polite"` caption above the scroll region, `px-4 mt-2`, hidden at 0, also under the "No strategies match your filters." empty state.

**Span inputs:** the list row carries only `series_end` today (queries.ts below). `src/components/strategy/StrategyTable.test.tsx` has the `makeAnalytics(overrides)` fixture factory and `installFetchMock` helper to reuse. Also expect `StrategyTable.default-mounts.test.tsx` and `__fixtures__/strategy-table-default-mounts.json` to need a re-bake after both 194 and 195 land.

---

### `src/lib/queries.ts` (`CATEGORY_RANKING_ANALYTICS_COLUMNS`) + `queries.test.ts`

**Analog:** the constant itself (:460). Existing alias styles to copy:
```
three_month:metrics_json->three_month,
series_end:returns_series->-1->>date,
native_unit:data_quality_flags->>native_unit,
last_success_native_unit:data_quality_flags->last_success_snapshot->flags->>native_unit
```
Add `series_start:returns_series->0->>date` (positive index; the negative-index form is the one PostgREST's type parser rejects, :381-396, so MEASURE the alias against TEST first, RESEARCH A2) and `headline_since:data_quality_flags->>headline_since`. `queries.test.ts` pins the exact alias set and regex-allows only listed `->>` forms: update the pin deliberately. It stays an explicit allowlist, never `strategy_analytics (*)` (RANK-02). `shapeRowAnalytics` drops the `last_success_*` aliases before they reach a client; new aliases are scalars and must be deliberately kept or dropped there.

---

### `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (component)

**Analog:** itself :360-392.

**Amber caveat to replace with the shared muted note** (:363-368):
```tsx
{obsPerYear != null && m.n < obsPerYear && (
  <p className="mb-2 text-fixed-10 italic" style={{ color: "var(--color-warning, #B45309)" }}>
    ⚠ Only {m.n} observations ({recordLength.years}y) — Sharpe / Sortino / Calmar below ...
```
**Muted reason-line idiom to copy** (:380-384, the 170.6 SFH-1 precedent):
```tsx
{bn != null && comparatorAnnualizationWithheld(hb) && (
  <p className="mb-2 text-fixed-10 italic text-text-muted" data-testid="comparator-annualization-reason">
    {bn} annualized figures need {COMPARATOR_ANNUALIZATION_FLOOR_DAYS} days of overlap.
  </p>
)}
```
Main Metrics `Kpm` rows (:384-392): CAGR, Ann. Volatility, Sharpe, Sortino, Calmar print `—` (no tone) when `withheld`, via the shared gate; ONE reason line above `Kpm`. Keep the existing `isHeadlineWithheld` / `headlineCoverageNote` (:83-122) path untouched; D-04 is a second, independent gate. Selected-range variant: use the range wording (UI-SPEC copy table); the rail already hides trailing rows while a range is selected (`window-trailing-note`). Add the VaR method line beneath the VaR/CVaR rows. `Row`/`pct`/`ratio` helpers already render NaN/null as `—`.

---

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` (component; land after 195)

**Analog:** itself ~:2030-2062. Two amber `⚠` caveats (`wv.strategyMetrics.n < 252` and `payload.dataQuality?.insufficientWindow === true`) are replaced by the shared note constant. Keep the diff limited to those two sentences (195 removes dark mode in the same file). Preserve the `borderTop: "1px solid var(--color-border)"` wrapper; drop only the amber `color`.

---

### `src/app/factsheet/[id]/tearsheet/page.tsx` (route RSC, request-response)

**Analog:** itself. Sits next to a 195 plan-05 edit (custody `Disclaimer`), so keep hunks disjoint.

**AUM role gate: copy the attestation fail-closed shape** (:325-350). Default false, `try/catch`, request client hoisted and reused:
```typescript
let isAttested = false;
let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
try {
  supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (!userError && userData?.user != null) { ... }
} catch (err) {
  console.error("[tearsheet] attestation lookup failed:", err);
  // Stay redacted — the safer default.
}
```
Add a sibling `showAum = false` that reuses this same `supabase`/`userData`: `own = user.id === strategy.user_id` (`user_id` is in `STRATEGY_PUBLIC_COLUMNS`) OR `getUserRolesResult(supabase, user.id)` returning `ok && roles.includes("allocator")`. `getUserRolesResult` is at `src/lib/auth.ts:184`, returns `GetUserRolesResult = { ok: true; roles: AppRole[] } | { ok: false; error }` (auth.ts:111) and logs real faults itself; treat `ok:false` as absent. Never `getSession()`. The page is `force-dynamic` (`:44`); do not add `use cache`. The PDF wrapper fetches without cookies so the PDF never carries the AUM row.

**Row edit** (:657-669). Today:
```tsx
<TermRow label="Minimum Allocation" value={unitUndetermined || returnsUnit != null ? WITHHELD
  : strategy.aum ? `$${Math.round(strategy.aum).toLocaleString()}` : "Negotiable"} />
<TermRow label="Leverage" value={strategy.leverage_range ?? "Not disclosed"} />
<TermRow label="Lockup" value="None (read-only API)" />
<TermRow label="Benchmark" value={strategy.benchmark ?? "BTC"} />
```
Result: `{showAum && <TermRow label="AUM" value={unitUndetermined || returnsUnit != null ? WITHHELD : formatUsd(strategy.aum)} />}` (row ABSENT from DOM otherwise, no placeholder), keep the D-21 unit rule, delete `Negotiable` and the Lockup row, keep `Benchmark ?? "BTC"` untouched. `formatUsd` is in `src/lib/dollar-validation.ts`.

**Hero/detail gating** (:509-520, :566-592): `HeroMetric label="Sharpe" value={formatNumber(analytics.sharpe)}`, `DetailMetric label="VaR (95%)"` / `"CVaR"`. Wrap CAGR, Sharpe, Sortino, Volatility, Calmar through the gate (span from the stored series via the same query path); relabel to `VaR 95%` / `CVaR 95%`; VaR/CVaR print only when `m?.figure_defs_version` marker is present, else `—`. The `m` cast is `analytics.metrics_json as Record<string, number> | null`, so a numeric marker fits. ONE caption under the hero grid (withheld or short-track) and ONE VaR method line under the Detail grid. Existing `withUnit(...)` and `unitUndetermined ? WITHHELD` guards stay.

**Test analog:** `tearsheet/page.test.tsx`. Mocks `@/lib/queries` (`getFactsheetDetail` with `strategy.user_id: "u-1"`, `aum: 100_000`, `metrics_json.var_1d_95`), `@/lib/supabase/server` `createClient` (swap `getUser()` per case via `vi.mocked(createClient)`), `server-only`, `next/link`. It already enumerates five fail-closed branches (anonymous, attested, unattested, lookup throws, lookup `error != null`). Add AUM cases: anonymous, attested non-allocator, other manager, own manager, allocator, role lookup error. The role read needs a `user_app_roles` mock on the same client or a `vi.mock("@/lib/auth")`.

---

### `src/app/(dashboard)/allocations/lib/holdings-adapter.ts` (pure adapter)

**Analog:** itself :170-186. Analytics resolution `analyticsByStrategyId?.[strat.id] ?? { sharpe: strat.strategy_analytics?.sharpe ?? null, ... }`. The adapter is PURE (no network, no implicit time reads); keep it so: add span inputs (`series_start`, `series_end`, `headline_since`) to the input shape, call `figure-gate`, emit a gated Sharpe plus a `short` flag. The query feeding `analyticsByStrategyId` is built outside the files read (RESEARCH Open Question 4): the planner enumerates it first.

---

### D-08 label sites (component, transform)

**ExposureByClass.tsx** (~:111-115): `<KpiCell testid="kpi-gross" label="Gross" .../>` and a literal `<p ...>Net</p>` beside `data-testid="kpi-net"`. Change visible text only to `Gross exposure` / `Net exposure`; `Long`, `Short`, test ids unchanged.

**NetExposureChart.tsx** (~:127-128, :150, :159): `<LegendChip label="Net" .../>`, `<LegendChip label="Gross" .../>` plus the series `name`s. Heading and aria-label unchanged.

**ScenarioComposer.tsx**: `PORTFOLIO AUM (USD)` label (~:5300) is a typed input in blank mode and stays; only the book-mode measured figure becomes `Modelled equity`, with the existing `Models {allocatorEligibleCount - notYetContributing} of ...` note (~:5505) kept beside it. Overview/Holdings whole-book headline becomes `Book equity`: enumerate remaining sites first with the UI-SPEC grep (known non-test hits of `"AUM"`: `src/app/portfolio-pdf/[id]/page.tsx:195`, `src/components/portfolio/PortfolioKpiPanel.tsx:43`, `StrategyFilters.tsx:121`, `CustomizeDrawer.tsx:24`, `StrategyTable.tsx:317`). Do NOT touch `PortfolioKpiPanel.tsx` (195 removes `/portfolios`), and the discovery `AUM` column/filter option stays (UI-SPEC A-5). Existing `*.test.tsx` beside each file assert the old strings and must be updated in the same plan.

## Shared Patterns

### One verdict, strings in one place
**Source:** `src/lib/factsheet/comparator-block.ts:6-30`. Every `90`, `365` and every user-facing sentence lives in `figure-gate.ts`; no page restates them. Pin Python and TS thresholds equal via the `return-stats.test.ts` text-read pattern.
**Apply to:** MetricsColumn, FactsheetView, tearsheet, StrategyTable, holdings-adapter, ScenarioComposer.

### A missing or withheld figure is `null`, rendered `—`, never 0 and never toned
**Source:** `src/lib/return-stats.ts` header ("A NULL RATIO IS AN ABSENCE, END TO END"; renderers test `Number.isFinite`), `compute.ts` (`avgWin = winCount > 0 ? ... : NaN`). Pass `null` to `signTone` / `formatFixedSigned` (`src/lib/factsheet/display-sign.ts`) / `signColor` / `magnitudeColor` for a withheld figure. Add no new formatter outside the display-sign census (`src/__tests__/display-sign-single-source.test.ts`).
**Apply to:** every gated cell, list sort/filter.

### D-05: no plausibility code anywhere
No `> 1000%` branch, title, glyph, badge or withhold. Include one 13-digit cumulative in the page-parity test; it must render like any finite value.

### Server-side fail-closed role gating
**Source:** tearsheet attestation block (:325-350) plus `getUserRolesResult` (auth.ts:184, :111).
**Apply to:** the AUM row only. Default false, any error removes the row, log with `console.error("[tearsheet] ...")`.

### Muted note idiom (no amber, no glyph)
**Source:** MetricsColumn.tsx:380 `mb-2 text-fixed-10 italic text-text-muted` (rail); `pctSuffix` (StrategyTable ~:1019) for cell markers; `text-xs`/`text-caption` captions on the tearsheet and list. Each withheld `—` and `<1y` carries its reason in `title` AND sr-only text.

### Gates must be able to fail
Neuter (restore `?? 0`, restore `tail(126)`, restore parametric VaR), see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Money-math oracles are constructed invariants. `grep -a` always; a new test file moves censuses, grep them all.

### Python gates
`pytest` only from `analytics-service/`; `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py ...` (CI step; Makefile `typecheck`); no `importlib.reload` in tests; no ruff gate exists.

### Release hygiene
CHANGELOG entry plus 4-digit VERSION bump (`VERSION` byte-equal to `package.json`, never `npm version`); never write the CI skip-trailer tokens; a ship branch changes nothing under `.planning`; no AI-authorship trailers (user's memory rule overrides the harness reminder).

## No Analog Found

None. Two items compose multiple idioms rather than copy one file:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/__tests__/figure-parity-pages.test.tsx` | test | request-response | No existing test renders the same stored fixture through StrategyTable cell, tearsheet, factsheet payload and Holdings. Compose `StrategyTable.test.tsx` fixtures (`makeAnalytics`), `tearsheet/page.test.tsx` mocks and `build-payload.ts` `overlayBasisScalars` (`basis-metrics.ts:18-27` seven-key overlay). Must be RED today on 6 Month before the fix. |
| `analytics-service/tests/fixtures/figure_parity_vectors.json` | fixture | transform | First fixture read by BOTH pytest and vitest; shape follows existing `tests/fixtures/*.json`, read pattern follows `return-stats.test.ts`. |

## Phase 195 overlap (sequence, from RESEARCH)

Land after 195: `StrategyTable.tsx` (density toggle), `FactsheetView.tsx` (dark mode), and `tearsheet/page.tsx` (195 plan 05 removes the custody `Disclaimer` and edits the Risk Disclosure paragraph; the RESEARCH correction of the UI-SPEC "none known"). Avoid `PortfolioKpiPanel.tsx`, `StrategyBreakdownTable.tsx`, and expect overlap in `EquityChart.tsx`, `BridgeWidget.tsx`, `AllocationsTabs.tsx` if D-08 "Book equity" lands there. `MetricsColumn.tsx` is free.

## Metadata

**Analog search scope:** `src/lib`, `src/lib/factsheet`, `src/components/strategy`, `src/app/factsheet`, `src/app/(dashboard)/allocations`, `analytics-service/services`, `analytics-service/tests`
**Files read or grepped:** ~25
**Pattern extraction date:** 2026-11-07
