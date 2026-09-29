# Phase 169 FACTSHEETTRUTH: silent-failure review (SFH)

**Scope:** `git diff origin/main...HEAD -- src DESIGN.md` on `feat/169-pagetruth` (head `70ddb7d01`), plans 169-01, 04, 05, 07, 09, 10.
**Reviewed:** 2026-09-29. Every finding was re-checked against HEAD. Line numbers are HEAD line numbers.
**Tag:** `[169]` means Phase 169 introduced it. `[pre]` means it was already there and 169 touches it or makes it easier to see.

Measured facts the findings depend on:

- **Nothing written with `console.*` reaches Sentry.** `src/instrumentation.ts:236` calls `Sentry.init` without `integrations`, so `captureConsoleIntegration` is off. `src/lib/resilient-fetch.test.ts:3182` pins this. The comment at `composite-read-path.ts:106-107` ("Log at ERROR (→ Sentry)") is therefore false.
- **The factsheet has no chain-break caveat.** `twr_chain_broken` is a `NAV_TWR_GUARD_KEYS` member (`analytics-service/services/nav_twr.py:228`) and lands in `data_quality_flags`. Nothing under `src` reads it. The only grep hit is `email.ts`'s unrelated `correlation_chain_broken`. The single-key `dataQuality` is `{ composite:false, insufficientWindow }` and nothing else (`composite-read-path.ts:408-412`).

---

## HIGH

### H-1 [169] On a chain-broken single-key row, "Since Inception" and CAGR show a suffix-only figure beside a whole-history chart, with no caveat

- **Where:** `src/lib/factsheet/composite-read-path.ts:554-627` (`readSingleKeyBasisOpts` / `persistedCashHeadline`) → `build-payload.ts:476` (the strict overlay) → `MetricsColumn.tsx:440-441` (Since Inception / CAGR) and the KpiStrip.
- **Mechanism:**
  - Python's `cumulative_return` compounds only the stretch after the last interior break. So does its CAGR. See `nav_twr.py:503-559` (`_last_interior_break_suffix`, `cumulative_twr_segmented`) and `metrics.py:1747-1749, 1846-1854`.
  - On the broker path the runner re-densifies the series precisely so that gap days become NaN (`analytics_runner.py:1695-1705`).
  - TypeScript `compute()` and the equity chart compound the whole normalised series. They also compute Years Observed and every MTD to 5Y window from that whole series.
  - Before 169, every one of these numbers came from TypeScript. The page disagreed with discovery, but it agreed with itself. After 169, the seven headline scalars are Python's, and nothing else on the page is.
- **How it fails:** take an api strategy with one refused day (a NAV guard) 14 months into a 3-year record. Python stores `twr_chain_broken: true`, `cumulative_return` = the last 22 months only, and a CAGR over those 22 months.
  - The factsheet shows "Since Inception +18%".
  - The equity curve ends at +61%.
  - The "3 Year" row (TypeScript, whole series) shows +61%. That is larger than "Since Inception" on a record that is only 3 years long.
  - "Years Observed 3.00" sits next to a CAGR annualised over 1.8 years.
  - The Sharpe bootstrap CI and the rolling Sharpe are TypeScript on the whole series, so the CI need not contain the displayed Sharpe.
  - Nothing on the page says a break exists.
- **Why it slipped:** RESEARCH Pitfall 1 made this safe on the condition that "the existing `dataQuality` caveat renders on a broken one". 169-01-SUMMARY:190 records that half as "existing behaviour ... not re-pinned". The premise is false: that caveat does not exist on this surface. The only test (`build-payload.headline-source.test.ts:181`) pins a clean series.
- **Recommendation:** pick one, and record the decision:
  - (a) Thread `twr_chain_broken` into `singleKeyDataQuality`, and render a dated caveat beside the headline and the Cumulative Return Metrics panel that names the retained window ("Since inception figures cover the record from <date>, after a break on <date>").
  - (b) Or do not apply the persisted overlay when `dqf.twr_chain_broken === true`. Log this at `warn` with the strategy id, and capture it once per build.

  Before choosing, measure how many rows are affected on PROD. This is a read-only query; run the marker check first:
  `SELECT count(*) FROM strategy_analytics WHERE data_quality_flags->>'twr_chain_broken'='true' AND computation_status IN ('complete','complete_with_warnings');`
  Add a red-first test that uses a chain-broken fixture.

### H-2 [169] A single-key row with `returns_denominator_config` (`simple` + `active`) gets an arithmetic headline over a geometric chart

- **Where:** `fetch-and-build-payload.ts:~664` and `discovery/[slug]/[strategyId]/page.tsx:~172`. Neither sets `cumulativeMethod` on the single-key arm. Only `readCompositeFactsheet` resolves it (`composite-read-path.ts:~316`). So `build-payload.ts` runs with `isArithmetic = false`.
- **Mechanism:** the single-key runner applies the config to single-key rows (`analytics_runner.py:1751-1790`). Under `simple`, the stored `cumulative_return` is Σr, CAGR and Calmar are annualised arithmetically, and max_dd is taken from the running sum. Under `active`, volatility, Sharpe and Sortino are computed over non-zero days only. The page then overlays those numbers on a geometric equity curve, geometric windows, and calendar-day rolling Sharpe and vol.
- **How it fails:** an allocated-capital single-key strategy with daily returns of +2% / −2% repeated. Σr ≈ 0 and the geometric product is < 0, so "Since Inception" and the curve's endpoint diverge more with every period. The Sharpe is on active days while "Ann. Vol" in the rail's extended stats is not, which makes Sharpe × vol ≠ return.
- **Reachability:** reachable in code. How many PROD rows are affected has not been measured. Measure with `SELECT count(*) FROM strategies s JOIN strategy_analytics a ON a.strategy_id=s.id WHERE s.returns_denominator_config IS NOT NULL AND (a.data_quality_flags->>'composite') IS DISTINCT FROM 'true';`
- **Recommendation:** resolve `cumulativeMethod` on the single-key arm through the same config reader the composite uses. Otherwise, do not apply the persisted overlay when the config is not `geometric` + `calendar`, and log that.

### H-3 [169, partly pre] A composite outage on the discovery detail page reaches no alert, and the copy tells the user it is a permanent state

- **Where:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:120-127`, which renders `KCS10_PUBLIC_SENTENCE` (`status-surface-copy.ts:543`).
- **Mechanism:** the catch is correctly narrow (`instanceof CompositeSeriesReadError`, and every other error is rethrown). But its only sink is `console.error`, which does not reach Sentry (see above). The factsheet build path captures the same failure (`fetch-and-build-payload.ts:410-439`). This page does not.
- **How it fails:** PostgREST starts returning 503/`57014` on `csv_daily_returns`. Every authenticated allocator who opens a composite on `/discovery/.../<id>` reads "The detailed factsheet for this strategy is not available yet.", which describes the row as not ready rather than the read as failed. No event is raised. The v2 public lane raises an event only when a build runs, so while the cached entry is still being served, nobody is paged.
- **Note:** before 169 the reader logged this to the console only, so the missing alert is pre-existing. 169 now distinguishes the outage and still discards that information on this page. It stays open until 169.1-01 removes this assembly.
- **Recommendation:** in the catch, `captureToSentry(new Error(\`discovery detail: composite csv_daily_returns read failed (${err.code})\`), { level: "error", tags: { stage: "discovery-detail", code: err.code, strategy_id: strategy.id, read: "csv_daily_returns" } })`. Render a read-failure sentence ("could not be loaded right now; try again shortly") in place of the not-ready one.

---

## MEDIUM

### M-1 [169] When the persisted headline is refused, the log says so with an empty `missing` list and never reaches Sentry

- **Where:** `composite-read-path.ts:615-620`.
- **Mechanism:** `hasBasisHeadline` also fails when all seven keys are present but `cumulative_return` is null or non-finite. The row is still rankable, so it reaches this branch. `missing` only lists absent keys, so the warn line reads "rankable row carries no persisted headline", `missing: []`. That hides the actual cause. The factsheet then shows the whole TypeScript headline (Sharpe, CAGR and the rest), while discovery, recommendations and my-strategies show the stored values. That is exactly the SC4 split this plan closes, it happens on a `console.warn`, and nothing alerts on it.
- **Recommendation:** log the actual reason as `reason: "missing_keys" | "non_finite_cumulative_return"`, together with `typeof`/value of `cumulative_return` and `computationStatus`. A rankable row with a non-finite headline is a data defect, so capture it once per build at `warning`.

Two quieter arms of the same function are also silent:
- the lingering-raw-`cash_settlement` arm (`:607-610`) returns `undefined` without logging;
- a caller that passes no `persistedRow` gets the pre-169 headline without any log.

The first should at least `console.warn` with the strategy id.

### M-2 [169] The cash leverage view mixes stored and recomputed scalars, and on H-1/H-2 rows the jump at L = 1 → 1.01 is not a leverage effect

- **Where:** `basis-context.tsx:285` (by-reference return at L=1) and `:345-395` (levered re-pin).
- **Mechanism:**
  - At L=1, all seven cash scalars are the persisted Python values.
  - At L>0, L≠1, only Sharpe and Sortino are pinned to the stored values. `cum_ret`, `cagr`, `ann_vol` and `max_dd` are TypeScript on the levered series. Calmar is TypeScript unless the stored value is non-finite, in which case it becomes NaN.
  - The comment carries MTM's "accepted N-1 boundary tradeoff" over to cash. For MTM that gap was sparse vs dense, i.e. small. For cash, H-1 and H-2 make it structural.
- **How it fails:** on the H-1 strategy, moving the leverage input from 1.00 to 1.01 changes "Since Inception" from +18% to about +62%. The what-if caption presents this as the effect of 1.01× leverage. At the same time Sharpe stays pinned to the stored suffix and active-day value, while the vol shown next to it is TypeScript calendar vol. So the displayed Sharpe ≠ CAGR/vol, even though the page presents all three as belonging to one set.
- **Recommendation:** fix H-1 and H-2 first, since that removes the structural gap. Then add a test that pins continuity at L=1±ε for `cum_ret`/`cagr` on a clean series, so the tradeoff is measured rather than assumed. Until then, suppress leverage when the H-1 or H-2 predicate holds, as `leverageApplies` already does for composites.

### M-3 [pre] MTM and smoothed series read failures still degrade to null, and the degraded payload is cached for the run

- **Where:** `composite-read-path.ts:95-113` (`readMtmSeries`) and `:146-160` (`readSmoothedSeries`). Both are called by `readCompositeFactsheet` and `readSingleKeyBasisOpts`.
- **Mechanism:** this is the same class D-41 closed for `csv_daily_returns`. A failed read logs to the console only, which the comment wrongly says reaches Sentry. It returns `null`, and `buildFactsheetPayloadCached` stores the payload without `seriesByBasis` under `["factsheet-v2-payload-v8", id, computedAt]` for as long as the analytics run lasts. With no bundle, the MTM arm of `useBasisSeriesView` falls back to the cash payload (`basis-context.tsx:245-246`).
- **How it fails:** a single timeout on `strategy_analytics_series` leaves an options strategy's public factsheet without its MTM charts until the next compute. No alert fires.
- **Answer to the brief's question:** yes, something is still cached on failure. It is not in 169's diff. It should be routed rather than left behind the false "→ Sentry" comment. At minimum, correct the comment and capture once per build.

### M-4 [pre, amplified by 169-10] The open-positions total counts a trusted row's missing P&L as $0.00 and reports it to the cent

- **Where:** `OpenPositionsTable.tsx:136-151` (sum) and `:270-274` (render).
- **Mechanism:** a null or non-finite P&L on a trusted key is summed as 0, and the disclosure line only counts untrusted and unknown-status rows. If every row is null, the total is 0. `signAtCents(0)` returns `"zero"`, so the footer reads "$0.00" in the neutral colour, which says "flat" about a P&L nobody knows. 169-10 moved this from "$0" to cent precision, so the wrong total now looks more exact.
- **Recommendation:** track `unavailable` for all rows. If every row is unavailable, render "—". If only some are, add a clause ("excludes N positions with no P&L").

### M-5 [pre, surfaced by 169-09] A missing `weight_pct` becomes 0.0%, and every row with a risk share is then marked "Overweight risk"

- **Where:** `src/lib/portfolio-analytics-adapter.ts:131` (`weight_pct: asNumber(v.weight_pct) ?? 0`) → `RiskAttribution.tsx:89,96`.
- **Mechanism:** the producer writes `_safe_float(ordered_weights[i] * 100)` (`routers/portfolio.py:958`), which can be `None`. The adapter turns that into 0. The table shows "0.0%", and `share > 0 * 1.3` is true for any positive share, so the row reads "Overweight risk" in red. 166.1 D7 already fixed this exact pattern for `marginal_risk_pct` (the null is kept and the cell is "—"). `weight_pct` was left on `?? 0`.
- **Recommendation:** make `weight_pct` `number | null` in the type, the adapter and the display. Render "—", and assess nothing when it is null.

---

## LOW / Info (kept here per the review policy; not routed)

- **L-1 [169] An empty scenario blend shows "6 Month —" and "1 Year —" rows, where D-57 says to omit them.** `scenario-factsheet-payload.ts:166-168` sets `p6m`/`p1y` to `NaN`, and `MetricsColumn.tsx:116-117, 435-437` gates on `!= null`, which `NaN` passes. `p3y`/`p5y` are absent there, so those rows are omitted. The 3Y/5Y and 6M/1Y rows therefore disagree on one mount. Use `null`, or gate on `Number.isFinite`.
- **L-2 [169] The Sentry event for a composite read failure carries only the code.** `fetch-and-build-payload.ts:~427` captures a new `Error` that has neither `cause` nor the PostgREST message. A network failure has no code (`"none"`), so the event says "(none)" and nothing more. Attach `err` (it already holds the message as `cause`) or add the message to `extra`.
- **L-3 [169] `formatUsdPrice(-0)` returns "-$0.00".** Measured in node: `-0 !== 0` is false, so `-0` takes the 2-decimal branch, and `Intl` prints negative zero. A mark derived as `0 / -qty` produces it. Normalise with `n === 0 ? 0 : n` (or `n + 0`). `formatUsdSigned` is not affected because it takes `Math.abs` of the rounded value.
- **L-4 [pre, visible now the domain is right] A hedge leg's negative risk share is clipped out of the bar.** `RiskAttribution.tsx:59` fixes the domain to `[0, 1]`. The Euler `marginal_risk_pct` can be negative (`services/portfolio_risk.py:122-126`), so a hedge leg is drawn left of 0 and clipped, and the positive legs, which then sum to more than 100%, overflow. The table also labels a negative share "Balanced" in green.
- **L-5 [pre] `standalone_vol` is formatted with a `+` sign at 2 decimals** (`RiskAttribution.tsx:98`), next to unsigned 1-decimal columns, and is `?? 0` in the adapter. D-49 deliberately left it alone. Info.
- **L-6 [pre, cross-surface] "6 Month" means two different things.** Browse, compare and the tearsheet show the stored `six_month_return`, which is the last **126 observations** (`metrics.py:2068`, about 4 months on a 24/7 venue). The factsheet's "6 Month" is **182 calendar days**. On a 5-month crypto record the factsheet now omits the row while browse shows a "6 Month Return". This sits outside 169's diff but under SC4's principle.
- **L-7 [169] Record length depends on the basis.** Years Observed and the warning read `view.strategyMetrics` (MTM under the toggle). The Strategy Thesis and Terms "Sample size" read `payload.strategyMetrics` (cash). An MTM series that starts later states two lengths on one page while the toggle is on MTM.

## Checked and clean

- **169-10:** `signAtCents` / `formatUsdSigned` on `null`, `NaN`, `±Infinity`, `-0.004` → `-0` → "zero", "$0.00", neutral colour. `0.005` rounds to "+$0.01", and the text and colour agree because both read the one `toFixed(2)`. `formatUsdPrice` at the $1 boundary: `0.99995` → "$1.00" and `0.999949` → "$0.9999". Null and non-finite give "—".
- **169-09:** no consumer multiplies by 100 twice. `portfolio-insights.ts:88-98, 221-228` and the Python narrative (`portfolio_optimizer.py:212-216`, `routers/portfolio.py:1394-1401`) stay in percent. `RiskAttribution` converts once, and the tooltip's ×100 reads the fraction.
- **169-07:** both catches are narrow (`instanceof CompositeSeriesReadError`, and anything else is rethrown). The v2 cached callback throws `FactsheetReadError` on `read_error`, so a failed miss is not stored and a failed background revalidation keeps the last good entry. The build path captures once and the probe path does not.
- **169-04/05:** windows are null exactly when the record does not cover them (`compute.ts:192-196`). Every consumer of `mtd`/`ytd`/`p3m`/`p6m`/`p1y`/`p3y`/`p5y` formats null as "—" (`pct`, `MetricsColumn.tsx:329-334`) or omits the row. No path turns null into 0%. Since Inception still reads `cum_ret` under its own label. The benchmark window nulls follow the strategy's, because the benchmark is aligned to the strategy's dates. The cache key moved from v7 to v8, so no cached entry is missing `p3y`/`p5y`. `formatRecordLength` gives "—" for a non-finite value, never 0. `FreshnessChip` under "Track record" prints "—" for an unknown series end and hides a negative age.
