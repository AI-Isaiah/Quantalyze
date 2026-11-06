---
phase: 169-pagetruth
round: 2 (confirmation, after the round-1 fixers T1-T5)
reviewed: 2026-09-29T21:30:00Z
reviewed_at_sha: 7872478e6
diff_base: 8d9155b7a
depth: standard
files_reviewed: 41
files_reviewed_list:
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/composite-read-path.test.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/fetch-and-build-payload.test.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/build-payload.headline-source.test.ts
  - src/lib/factsheet/basis-metrics.ts
  - src/lib/factsheet/compute.ts
  - src/lib/factsheet/compute.metrics.test.ts
  - src/lib/factsheet/types.ts
  - src/lib/freshness.ts
  - src/lib/freshness.two-surfaces.test.tsx
  - src/lib/dollar-validation.ts
  - src/lib/dollar-validation.test.ts
  - src/lib/portfolio-insights.ts
  - src/lib/portfolio-insights.test.ts
  - src/lib/portfolio-analytics-adapter.ts
  - src/lib/portfolio-analytics-adapter.test.ts
  - src/lib/types.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/basis-context.cash-leverage-repin.test.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx
  - src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx
  - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
  - src/components/portfolio/RiskAttribution.tsx
  - src/components/portfolio/RiskAttribution.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/exchanges/AllocatorExchangeManager.test.tsx
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 169: Code Review Report, round 2 (confirmation)

**Reviewed:** 2026-09-29, at `7872478e6` (branch `feat/169-pagetruth`)
**Depth:** standard, plus call-chain reads into `analytics-service` where a fix rests on a Python claim
**Files Reviewed:** 41 (every `src/**` file in `git diff 8d9155b7a..HEAD`)
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This is a confirmation round. Round 1 had three HIGHs (SFH H-1, H-2, H-3), so a confirmation review is
required after the fixers. I re-read every fix at HEAD and did not rely on the fix reports. I also read the
Python that H-1's copy depends on.

**Gates re-run by this reviewer at HEAD.** `npx vitest run` over `src/lib/factsheet`, `src/app/factsheet`,
`src/app/(dashboard)/discovery`, `src/lib/freshness*`, `src/lib/dollar-validation.test.ts`,
`src/components/portfolio`, `src/lib/portfolio-insights.test.ts`, `src/lib/portfolio-analytics-adapter.test.ts`,
`src/app/(dashboard)/allocations/components` and `src/components/exchanges`: **163 files, 2782 tests, all
passed, 0 skipped.** I did not run tsc or lint this round. T5 reports both at exit 0 on the parent of its
report commit.

**Verdict:**
- All three HIGHs are closed.
- Four of the five MEDIUMs are closed. The fifth (M-2) is closed with a residual that was recorded.
- No fix introduced a BLOCKER.
- Three WARNINGs remain:
  - WR-R2-01 is new, and a fix introduced it: the WR-02 coverage rule can admit an uncovered window.
  - WR-R2-02 is the round-1 L-4, which was skipped and is still a false claim in the UI.
  - WR-R2-03 is a contract conflict the H-1 reader created.
- Under the review-findings policy, round 3+ fixes only CRIT/HIGH. None of these three is HIGH, so none
  forces another fix round. They are recorded here for the verifier and the founder.

## Part 1: round-1 findings, status at HEAD

| ID | Status | Evidence at HEAD |
|---|---|---|
| **SFH H-1** chain-broken headline with no caveat | **CLOSED** (residual recorded) | Data: `composite-read-path.ts:496-506` (`twrChainBroken`, strict `=== true`), `:528-546` (`deriveHeadlineCoversFrom`, `broker_nan` only, otherwise `null`), `:798-813` (read only when the stored headline is overlaid). Render: `MetricsColumn.tsx:35-47` (one authored caveat), `:107,134` (Main Metrics), `:474,478` (Cumulative Return Metrics), `FactsheetView.tsx:1440,1632` (KPI strip). Copy checked against Python: `metrics.py:1854` annualises CAGR over `_last_interior_break_suffix`, `:1830` compounds `cumulative_return` over the same suffix, `:1883` takes max_dd over the whole series (`fillna(0)`), and `:1993` computes Calmar as that CAGR over that max_dd. So the three scalars the caveat names are the ones the suffix touches. Vol, Sharpe and Sortino are whole-series and are correctly left out. Residual: the windows and Years Observed stay whole-series by SC4 (T1 "Residuals"); Calmar is only half suffix (IN-R2-04). |
| **SFH H-2** arithmetic headline over a geometric curve | **CLOSED** | `composite-read-path.ts:772-773` (arithmetic when the config says `simple`), `:783` (`returnsConventionOverride`). Factsheet: `fetch-and-build-payload.ts:553`. Discovery: `page.tsx:254`. `strategies` is selected with `*` (`queries.ts:1402-1404`), so the column arrives. Residual: an active-day Sharpe/vol cannot be reproduced in TS, so leverage is withheld (T1 "Residuals"). |
| **SFH H-3** discovery outage reaches no alert and says "not available yet" | **CLOSED** | `discovery/.../page.tsx:52-78` (`reportSeriesReadFailure` captures to Sentry with `read: err.read`), `:183-185` and `:257-259` (a narrow catch on both arms; anything else rethrows), `:363` (read-failure sentence). `SERIES_READ_FAILED_SENTENCE` (`:39-40`) uses active voice with no em dash, per DESIGN.md "Voice / microcopy". |
| **SFH M-1 = WR-01** stored null `cumulative_return` falls back to the TS headline | **CLOSED** | `composite-read-path.ts:882-895` (structural gate: the seven keys must be present; `missing_keys` is logged and captured), `:896-913` (non-finite: warned and captured at `warning` with `nonFinite`), `:874-880` (a lingering raw-cash arm now warns). `build-payload.ts:485` overlays the result strictly with no `hasBasisHeadline` gate, so the stored CAGR and Sharpe render next to a "—". |
| **SFH M-2** leverage view mixes stored and recomputed scalars | **CLOSED** for the H-1/H-2 rows (the what-if is withheld); the clean-row seam stays D-25 (i) | `basis-context.tsx:468-472` (`leverageEligibleFor` refuses `twrChainBroken` and `returnsConventionOverride`). The L = 1 ± ε continuity test the SFH suggested was not added (T1 "Not done"). |
| **SFH M-3 = WR-05** MTM/smoothed read outage cached as a degraded payload | **CLOSED** | `composite-read-path.ts:115,161-163` (throws with the `read` discriminant). `fetch-and-build-payload.ts:541-561` (the single-key assembly moved into the resolve stage; the catch is narrow at `:559`, and `seriesReadError` at `:263-290` answers `read_error`). `v2/page.tsx:142` throws `FactsheetReadError` inside `unstable_cache`, so nothing is stored. See the consequence note in Part 2. |
| **SFH M-4** open-positions total presents missing P&L as $0.00 | **CLOSED** (one adjacent $0.00 remains, IN-R2-05) | `OpenPositionsTable.tsx:146,153,165-166` (counts `reported`; the total is `null` when no row reported), `:284-286` (`formatUsdSigned(null)` renders "—" in no colour), `:292-303` (partial / unavailable note). |
| **SFH M-5** null weight becomes 0.0% and "Overweight risk" | **CLOSED** | `portfolio-analytics-adapter.ts:133` (no `?? 0`), `types.ts:1500`, `RiskAttribution.tsx:102-104,111,115` (weight shown as "—", no assessment), `portfolio-insights.ts:89-93,227-231`. |
| **WR-02** "+1 day" hides covered weekday windows | **CLOSED as written; introduces WR-R2-01** | `compute.ts:210-226`. The four days in code (Sat, Sun, 1 Jan, 25 Dec; `md === 1` / `md === 1125` checked) match the D-11 amendment text (`169-CONTEXT.md:169-178`). ROADMAP carries the matching note. |
| **WR-03** record length stated from two summaries | **CLOSED** | `MandatePanels.tsx:33,67` read `useBasisSeriesView(payload).strategyMetrics`, which is the summary `MetricsColumn` reads. |
| **WR-04** chip buckets fractional age, prints floored | **CLOSED** on both surfaces in one commit | `FactsheetView.tsx:1241-1243` (floored age drives the tone and the printed value), `freshness.ts:258` (the badge floors too). Future arm: floor(-0.4) = -1 is fresh on both, and -2 is future on both (`FactsheetView.tsx:1146`, `freshness.ts:260-267`). |
| **IN-01** stale "single-key never overlaid" comments | **CLOSED** (the fix round added two new stale comments, IN-R2-01) | `basis-metrics.ts:33-37`, `types.ts:580-590`, `basis-context.tsx:89-94`, `build-payload.ts:476-485`. The "cached before Phase 169" clause is gone (`basis-context.tsx:359-360`). |
| **IN-02** `Record<string, number>` carrying nulls via a cast | **CLOSED** | `types.ts` `metricsByBasis` has three `number \| null` records. `composite-read-path.ts:919-923` builds the record with no cast. |
| **IN-03 = SFH L-1** empty blend 6M/1Y em-dash vs 3Y/5Y hidden | **CLOSED** | `scenario-factsheet-payload.ts:173-176` (`p6m/p1y/p3y/p5y: null`). |
| **IN-04** private `formatUsd` copies | **CLOSED** | `HoldingDetail.tsx:32` and `AllocatorExchangeManager.tsx:44` import the module. A contract test in `dollar-validation.test.ts` blocks a new copy. |
| **IN-05** "unsigned domain" comment false for risk shares | **CLOSED** for the comment and the pin; the U+2212 half is **NOT CLOSED** | Corrected at `RiskAttribution.tsx:16-20,52-55` and `types.ts:1483-1485`. Table and tooltip still print an ASCII hyphen-minus ("-12.0%") where DESIGN.md's Percentages row asks for U+2212. The fix is `formatPercent` (`utils.ts:3-11`), which is product-wide and outside this phase. |
| **SFH L-2** series read Sentry event carries only the code | **CLOSED** | `fetch-and-build-payload.ts:279-288` (`extra.errorMessage`). The discovery page sends the reader's own error, so `cause` travels with it (`page.tsx:67`). |
| **SFH L-3** `formatUsdPrice(-0)` gives "-$0.00" | **CLOSED** | `dollar-validation.ts:128` (`n + 0`). `formatUsd` was hardened as well: non-finite gives "—", and a value that rounds to zero loses its sign (`:53-55`). |
| **SFH L-4** hedge share clipped from the bar, row reads "Balanced" | **SKIPPED by T4 — still a false claim, see WR-R2-02** | `RiskAttribution.tsx:70` (`domain={[0, 1]}`), `:104,119`. |
| **SFH L-5** `standalone_vol` signed 2 dp and `?? 0` | **SKIPPED** (locked by D-49, Info) | `portfolio-analytics-adapter.ts:129` (`?? 0`). A missing vol renders "+0.00%" (`RiskAttribution.tsx:113`). This is the one remaining "risk '—' renders as 0" case. D-49 left the field alone; widening it to null reaches `portfolio-insights.ts`'s trailing-stop lookup. |
| **SFH L-6** "6 Month" means 126 obs vs 182 days | **NOT ADDRESSED** (out of 169's diff; round 1 left it unrouted, per policy) | — |
| **SFH L-7** record length depends on basis | **CLOSED** (= WR-03) | as WR-03 |
| **CSV-READ-CAP** (orchestrator-added) composite read dropped rows after 1000 | **CLOSED** | `composite-read-path.ts:252-276`. See Part 2 for the no-early-stop trace. |

## Part 2: regression checks the orchestrator asked for

1. **The headline caveat shows exactly when the headline covers less than the chart, and never invents a
   date.** HOLDS, and I traced it.
   - `headlineCoverageCaveat` (`MetricsColumn.tsx:35-47`) requires all three of `twrChainBroken`, a present
     `headlineCoversFrom`, and the cash basis. `headlineCoversFrom` is set only inside
     `if (cashHeadline && dqf?.twr_chain_broken === true)` (`composite-read-path.ts:798`). So a
     non-rankable chain-broken row, whose headline is the whole-series TS one, carries no caveat. That is
     correct.
   - Python sets `twr_chain_broken` only when `retained_valid_count > len(suffix)` (`nav_twr.py:557-558`),
     which is exactly "the headline suffix is shorter than the series the chart draws".
   - The date is the first stored row after the last `gap_spans` end, and only under `densify ===
     "broker_nan"` (`:532`). Every other echo, a missing row, no gap, or no row after the gap gives `null`,
     which renders the undated sentence (`:44-46`).
   - An unparseable date is caught too: `isoToMonthDay` returns "—", and that also takes the undated
     branch.
   - The KPI strip hides the caveat while a what-if is applied (`FactsheetView.tsx:1440`). A chain-broken
     row cannot be levered anyway (`basis-context.tsx:471`).
   - One caveat on the date's trust is WR-R2-03 (the reader skips the documented cash-series choke point).
     The writers are ordered series-before-status (`analytics_runner.py:1985-1997`, `job_worker.py:8828-8836`),
     so on a rankable row the series is the current run's. I found no path that names a stale date. The
     finding is about the contract, not an observed wrong date.

2. **The single-key series-read error path on discovery and on the factsheet never caches a failure and
   never swallows other errors.** HOLDS.
   - Factsheet: the only catch is `instanceof CompositeSeriesReadError` (`fetch-and-build-payload.ts:559`),
     which answers `read_error`, and `v2/page.tsx:142` throws inside `unstable_cache`. Anything else
     rethrows.
   - Discovery: the same narrow catch on both arms (`page.tsx:183,257`). This page is uncached. On an outage
     `dailyReturns = []` and `buildOpts` stays undefined, so `buildFactsheetPayload` returns null and the
     read-failure sentence renders. No partial payload is built.
   - Probe: capture is off (`captureDefects: caller === "build"`, `:556`; `seriesReadError` captures only
     for `build`, `:273`).
   - **Consequence, recorded as a decision and not a defect.** An MTM or smoothed series outage (and on a
     chain-broken row, a cash-series outage) now blanks the whole factsheet on every lane: KCS-10 on the
     public lane, "not_available" on the share lane, and `read_error` on the owner lane. This happens even
     though the cash series was readable. Round 1's WR-05 offered "keep the degrade but mark it uncacheable"
     as the alternative; T1 chose throw. The share lane's card (KCS-11 `not_available`) does not say "try
     again" for what is a transient outage. That is pre-existing behaviour for every `read_error`.

3. **The date-keyset composite read cannot stop early.** HOLDS.
   - `readCsvDailyReturns` (`composite-read-path.ts:252-276`) exits only on an empty page (`:263`). It
     throws on an error (`:259`), on a non-array body (`:260-262`), on a date that does not strictly follow
     the cursor (`:266-268`, which catches a server that ignores `.gt` and replays page 1), and above 20000
     rows (`:272-274`).
   - A server whose cap is below 1000 simply takes more pages.
   - Exactly 20000 rows reads a 21st, empty page and returns, which is correct.
   - Every non-empty page moves the cursor strictly forward and the ceiling bounds the loop, so the loop
     cannot run forever.
   - Cosmetic only: when `cursor === null`, the first row's date is not type-checked (`:265` casts). A null
     date there would become the cursor, and the next row would then throw `page_order`. `date` is NOT NULL,
     so this path is unreachable.

4. **The WR-02 coverage rule cannot admit an uncovered window.** DOES NOT HOLD. See **WR-R2-01**.
   - On a correctly classified venue the rule is sound: 7-day stays at "+1 day" exactly, and weekday skips
     only Sat, Sun, 1 Jan and 25 Dec, all of which are closed on every weekday venue carried.
   - The proxy for "weekday venue" is `periodsPerYear === 252`, however, and 252 is what every
     non-`"crypto"` asset class gets (`closed-sets.ts:582-586`), including the DB default `'traditional'`
     (`closed-sets.ts:604-607`).

5. **The chip and the discovery badge agree.** HOLDS for the series arm.
   - Both floor the age before the 3/7-day ladder (`FactsheetView.tsx:1241-1243`, `freshness.ts:258`).
   - Both use the same future allowance (one day, from the same constant).
   - `freshness.two-surfaces.test.tsx` renders both surfaces from one row at 3.6 and 7.6 days and asserts
     both the subject and the band.

6. **Money and risk "—" states never render as 0.** HOLDS for everything this round touched: the footer
   total, the weight, the price, the amount, and `formatUsd` on NaN. Two older cases remain:
   - `standalone_vol ?? 0` renders "+0.00%" (SFH L-5, locked by D-49).
   - The key-trust note prints "Includes $0.00 from keys needing attention (P&L unavailable for 1 position)"
     under a footer that now reads "—" (IN-R2-05).

## Warnings

### WR-R2-01: The WR-02 weekday tolerance keys off the annualisation basis, so a 24/7 strategy classed `traditional` gets a window that misses two traded days (introduced by fix `a592a3f14`)

**File:** `src/lib/factsheet/compute.ts:210-226` (the proxy); `src/lib/closed-sets.ts:582-586` (`annualizationPeriods`: everything that is not `"crypto"` is 252), `:595-598`, `:604-607`
**Issue:** `weekdayVenue = periodsPerYear === 252` is the venue calendar that decides whether a RETURN
window renders. `periodsPerYear` comes from `annualizationPeriods(asset_class)`, which gives 252 to every
class other than `"crypto"`. `strategies.asset_class` is `NOT NULL DEFAULT 'traditional'`, so a crypto or
other 24/7 strategy whose manager never set the class runs at 252. The project memory records this
population ("unknown asset_class annualizes crypto at √252").

For such a row, a record that starts on the Monday after a Saturday cutoff now shows "3 Month", "6 Month",
"1 Year", "3 Year" or "5 Year" (and YTD/MTD after a weekend 1st). It compounds from Monday while the venue
traded Saturday and Sunday. That is the claim D-11 exists to prevent: a window the record does not cover.
The amended D-11 text says "It never re-admits a window missing a session the venue traded". That holds
only if the asset class is right. T2 names this "the existing misclassification class", but the class
predates the fix and the new consequence does not:
- Before `a592a3f14`, a wrong 252 moved volatility, Sharpe and Sortino.
- Now it also decides whether a return figure exists.

That conflicts with `closed-sets.ts:595-598`: "RETURN/CAGR ride the CALENDAR clock and are
asset-class-invariant. A change here must never move a RETURN number." Changing a row's `asset_class` from
`crypto` to `traditional` now moves YTD from "—" to a number.

This is a WARNING, not a BLOCKER. The admitted window lacks at most about three leading days, so the number
is close to right. It is still a stated figure over a window the data does not cover, on a public surface.
**Fix:** Derive the calendar from the series, not the asset class. The dates are already in hand, so treat
the venue as weekday only if the record itself never trades on a weekend, for example:
```ts
// Weekday calendar only when the series proves it: no Saturday/Sunday observation anywhere.
const tradesWeekends = dates.some((d) => { const w = new Date(d).getUTCDay(); return w === 0 || w === 6; });
const weekdayVenue = periodsPerYear === 252 && !tradesWeekends;
```
This fails safe: a misclassified 24/7 record has weekend dates, so it keeps "+1 day". Add a red-first case:
`periodsPerYear = 252`, a record with weekend observations whose first date is the Monday after a Saturday
cutoff, expecting `p3m === null`. Before choosing the fix, measure the population (read-only; run the
marker check from CLAUDE.md first):
`SELECT count(*) FROM strategies s JOIN strategy_analytics a ON a.strategy_id = s.id WHERE s.asset_class <> 'crypto' AND s.status = 'published' AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.returns_series) e WHERE extract(isodow FROM (e->>'date')::date) IN (6,7));`
Adjust the series column and shape to the row's storage. Record the decision as a further D-11 note.

### WR-R2-02: A hedge's negative risk share still reads "Balanced" in green, and the bar clips it (SFH L-4, skipped by T4)

**File:** `src/components/portfolio/RiskAttribution.tsx:70` (`domain={[0, 1]}`), `:103-104,119`
**Issue:** IN-05's fix put it on record that `marginal_risk_pct` is negative for a strategy that offsets
the book (`types.ts:1483-1485`), and the new test pins "-12.0%" in the cell. The same row's assessment
still runs `share > weight * 1.3`, which is false for any negative share, so the row renders "Balanced" in
`text-positive`. That describes a hedge as a balanced risk/capital split, and the claim is false on a
user-facing allocator surface. The bar domain `[0, 1]` also clips the negative segment, and the positive
legs sum past 1 and overflow. T4 skipped it because the chart and copy decisions were open. The table half
does not need a chart decision.
**Fix:** Do not assess a negative share as balanced. The minimal honest change uses no new copy:
```tsx
const assessable = share !== null && weight !== null && share >= 0;
```
That renders the existing colourless "—" for a hedge until the founder picks a word, for example "Offsets
risk". Pin it with the existing -12% fixture, asserting the assessment cell is "—" and not "Balanced". The
chart half (drop negative segments, or `stackOffset="sign"` with a widened domain) stays a separate decision.

### WR-R2-03: The H-1 reader is the first production reader of the single-key `cash_settlement` series row and bypasses the choke point the same file says it MUST use

**File:** `src/lib/factsheet/composite-read-path.ts:556-565` (`readHeadlineCoversFrom`) vs `:983-1026` (the `shouldReadCashSettlementSeries` contract, in particular `:1001-1003`)
**Issue:** The contract at `:1001-1003` (105-FOLD-DECISION D3, caveat a) says the first cash-series reader
MUST route through `shouldReadCashSettlementSeries` before it trusts a row. The predicate requires (a) a
DONE status and (b) a raw `metrics_json_by_basis.cash_settlement` object. `readHeadlineCoversFrom` calls
neither half:
- Half (a) holds by construction: it runs only when `persistedCashHeadline` returned a headline, which
  requires `isRankableAnalyticsRow`.
- Half (b) can never hold on the rows this reader targets. `persistedCashHeadline` refuses exactly the rows
  that carry a raw `cash_settlement` object (`:872-881`), so routing through the predicate would disable
  H-1 entirely.

The contract and the reader contradict each other. Either the contract is stale for single-key rows, or the
reader violates it. Nothing records which, and the next person to read the predicate's docblock will
believe no caller exists. Per the project's rule on conflicts ("surface, don't average"), this is recorded
rather than smoothed over.

I found no path to a wrong date today. The Python writers persist the series before the status flip
(`analytics_runner.py:1985-1997`; `job_worker.py:8828-8836`), and a failed run heal-deletes it
(`analytics_runner.py:2305-2325`). The choke point exists for the arm-by-arm cases where that ordering is
missed.
**Fix:** Amend the contract at `:1001-1003` to name `readHeadlineCoversFrom` as a caller. State that for a
single-key row the DONE half is enforced upstream by `isRankableAnalyticsRow`, and that the object half
does not apply, because a single-key row never carries the raw object (SC-4). Alternatively, factor out a
`isComputedAnalytics(computationStatus)` check inside `readHeadlineCoversFrom` so the DONE gate sits at the
read site, as the MED-1 rationale asks. If `105-FOLD-DECISION.md` already carves out single-key rows, cite
it in the docblock instead.

## Info

### IN-R2-01: Two comments the fix round made stale

**File:** `src/lib/factsheet/composite-read-path.ts:718-719`; `:24-25`; `:727-728`
**Issue:**
- `:718-719` says "the discovery detail page does not pass it yet (reported to its owner, until
  169.1-01)". T5 (`e3c2fb190`) passes it (`discovery/.../page.tsx:254`).
- `:24-25` (`parseMtmSeriesPayload` docblock) still says a "malformed/failed series row degrades to 'no MTM
  bundle'". Since M-3 a failed read throws. Only a malformed row degrades.
- `:727-728` `@throws` names only the MTM and smoothed reads. The cash-series read (`:563`) throws too.

**Fix:** Delete the "does not pass it yet" clause, change "malformed/failed" to "malformed", and add
`cash_settlement` to the `@throws`.

### IN-R2-02: The caveat says "Cumulative return", but the Cumulative Return Metrics panel labels that figure "Since Inception"

**File:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx:44-46,478-481`
**Issue:** In the Cumulative Return Metrics panel the caveat sits above rows labelled "Month-to-date … Since
Inception". The figure it qualifies is "Since Inception". A reader has to infer that the two are the same
number. The Main Metrics panel and the KPI strip do say "Cumulative Return", so there it matches.
**Fix:** Name both terms once: "Cumulative return (Since Inception), CAGR and Calmar cover …". Or accept the
current wording as a copy call in the post-deploy browser checkpoint.

### IN-R2-03: The discovery page captures to Sentry on every view during an outage or for a defective row

**File:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:62-77,245-255`
**Issue:** The page is uncached and calls `readSingleKeyBasisOpts` without `captureDefects: false`. Three
kinds of event therefore fire once per request:
- a series outage (`reportSeriesReadFailure`);
- a rankable row with a non-finite `cumulative_return`;
- a chain-broken row whose span cannot be named. PROD has 2 such `zero_fill` rows today (T5).

During a PostgREST incident, every allocator page view is one event. T1 and T5 both recorded this "until
169.1-01".
**Fix:** None needed if 169.1-01 lands soon. Otherwise, rely on a Sentry fingerprint or rate rule per
`strategy_id` + `reason`, and name that rule in the 169.1-01 plan.

### IN-R2-04: The caveat says Calmar "covers the record from <date>"; only its CAGR numerator does

**File:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx:44-46`; Python `metrics.py:1883,1993`
**Issue:** Calmar is the suffix CAGR over the whole-series max drawdown (`_max_drawdown_from_wealth` over
`returns.fillna(0)`). The sentence implies the whole ratio covers the suffix. This is not a false number,
and naming Calmar is better than omitting it.
**Fix:** Leave as is, or say "CAGR, and so Calmar," in a later copy pass.

### IN-R2-05: The key-trust note still prints "$0.00" for a part whose every P&L is unavailable, now under a footer that reads "—"

**File:** `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx:307-322`; `src/app/(dashboard)/allocations/lib/live-holdings-summary.ts:393-398`
**Issue:** When every untrusted row has a null P&L, `part.amount` is the 0 they summed to, and
`phrase()` renders "$0.00 from keys needing attention (P&L unavailable for 1 position)". This is pre-existing
(167.1 D-07: "an untrusted row with a null P&L is summed as 0 and still says so"), and the parenthetical
discloses it. After M-4, though, the footer above reads "—" and the note below it states a figure to the
cent. T4 saw it and left it, because the builder is shared with 167.1.2's composer.
**Fix:** In `OpenPositionsTable` only, pass `amount: NaN` for a part whose `unavailable === count` before
calling `buildKeyTrustClause`. `formatUsdSigned(NaN)` then renders "— from keys needing attention (P&L
unavailable for 1 position)". The shared builder and its pins stay untouched.

---

_Reviewed: 2026-09-29_
_Reviewer: Claude (gsd-code-reviewer), confirmation round 2_
_Depth: standard_
