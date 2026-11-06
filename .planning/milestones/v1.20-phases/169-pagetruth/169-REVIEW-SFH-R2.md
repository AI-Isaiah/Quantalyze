# Phase 169 FACTSHEETTRUTH: silent-failure review, confirmation round 2 (SFH-R2)

**Scope:** `git diff 8d9155b7a..HEAD -- src` on `feat/169-pagetruth` (HEAD `7872478e6`), read against the full phase diff vs `origin/main`.
**Inputs:** `169-REVIEW-SFH.md` (round 1), `169-REVIEW.md`, and `169-REVIEW-FIX-T1.md` to `-T5.md`.
**Reviewed:** 2026-09-29. Line numbers are HEAD line numbers.
**Gates:** not re-run. No `src` file has changed since T5's gate run at `def0c931e` (`git diff --stat def0c931e..HEAD -- src` is empty). So T5's result stands: tsc 0, lint 0, vitest 613 files green, 9 live-DB tests skipped.

---

## Verdict

- The round-1 HIGHs are closed: H-1, H-2 and H-3.
- The MEDIUMs are closed: M-1 to M-5.
- **One new user-facing MEDIUM was introduced by a fix: R2-1.** The WR-03 change makes the Terms panel call a live track record "backtest" when the MTM toggle is on. It is the one item that changes the answer. The fix is one line.
- Everything else found in part (2) is LOW or Info.

---

## Part 1: status of each round-1 finding at HEAD

| ID | Status | Evidence at HEAD |
|---|---|---|
| **H-1** | **CLOSED** | Data: `composite-read-path.ts:496-506` threads `twrChainBroken` (strict `=== true`, present only when true). `:528-546` `deriveHeadlineCoversFrom` gives a date for `broker_nan` rows and `null` for every other row. `:798-813` reads it only when the stored headline is actually overlaid. Render: `MetricsColumn.tsx:37-47` `headlineCoverageCaveat` shows in Main Metrics (`:134-138`), in Cumulative Return Metrics (`:478-482`) and in the KPI strip (`FactsheetView.tsx:1440, 1632-1642`). Gating checked: the dated case names the date; the `null` case says the same with no date; a clean row gets no caveat (`twrChainBroken` is absent); a non-rankable chain-broken row gets none (`headlineCoversFrom` is absent, `:1041`); MTM and smoothed get none (the basis gate). No path invents a date (`isoToMonthDay` returns "—" and then the undated sentence is used). Residuals are in R2-4 and R2-7. |
| **H-2** | **CLOSED** | `composite-read-path.ts:772-773` sets `cumulativeMethod: "arithmetic"` through `attributionBasisFromConfig`, which uses the same literal as Python's `parse_returns_denominator_config` (`"simple"`). Both surfaces pass the config: `fetch-and-build-payload.ts:553` and discovery `page.tsx:254`. `strategies.*` carries it. Leverage is withheld through `returnsConventionOverride` (`:783`). Accepted residual, recorded by T1: windows, rolling metrics and Years Observed stay geometric and calendar. A new small edge is in R2-6. |
| **H-3** | **CLOSED** | On discovery, `page.tsx:53-78` (`reportSeriesReadFailure`) captures `err` once with `level:error`, `read: err.read`, `stage` and `code`. Both arms catch `instanceof CompositeSeriesReadError` only and rethrow everything else (`:182-187`, `:256-261`). The read-failure sentence renders in place of KCS-10 (`:363`). The v2 public lane still renders KCS-10 on `read_error` (`v2/page.tsx:503-515`), and the resolve stage captures it once. That divergence is documented and is not a miss. |
| **M-1** | **CLOSED** (except one unreachable arm) | `composite-read-path.ts:872-880`: the lingering raw `cash_settlement` now warns with the strategy id. `:882-895`: `missing_keys` is logged with the key list and captured. `:896-913`: `non_finite_cumulative_return` is warned and captured at `warning` with `nonFinite` and `computationStatus`. Each log names its real cause. I checked the discovery projection: all seven `BASIS_KPI_MAP` server keys are in `PUBLIC_ANALYTICS_COLUMNS` (`queries.ts:1064`), and `shapeRowAnalytics` passes a rankable row through unchanged (`queries.ts:564`). So `missing_keys` does not fire per view on healthy rows. Still silent: `persistedRow == null` (`:868`). Both production callers pass a row, so that arm is unreachable today. |
| **M-2** | **CLOSED** | `basis-context.tsx:469-472`: `leverageEligibleFor` is false on `twrChainBroken` and on `returnsConventionOverride`, and the view returns `base` by reference. `KpiStrip` and `ControlBar` read the same predicate. The suggested L = 1 ± ε continuity pin for clean rows was not added (T1 gives the reason). That was a hardening suggestion, not the defect. |
| **M-3** | **CLOSED** | `readMtmSeries` (`:115`), `readSmoothedSeries` (`:161-163`) and `readHeadlineCoversFrom` (`:563`) throw `CompositeSeriesReadError` with `read`. The resolve stage answers `read_error` for both arms (`fetch-and-build-payload.ts:453-456`, `:558-561`) through `seriesReadError` (`:263-290`), which captures for `build` only. The public cache callback throws `FactsheetReadError` on `read_error` (`v2/page.tsx:142`), so nothing is stored. The false "→ Sentry" comment is gone. |
| **M-4** | **CLOSED** | `OpenPositionsTable.tsx:143-166, 281-304`: when no row has P&L, the total is "—" (uncoloured, because `pnlColor(null)` is `undefined`). When some rows lack it, the total keeps the sum and a "Partial total: …" note is shown. A reported zero still reads "$0.00". Residual: the key-trust clause (R2-5). |
| **M-5** | **CLOSED** | `portfolio-analytics-adapter.ts:133` no longer falls back with `?? 0`. `RiskAttribution.tsx:102-116` treats `assessable` as needing both values; a null weight renders "—" (`formatPercent(null)` returns "—", `utils.ts:8`), and the assessment is "—". `portfolio-insights.ts:89-93, 227-231` filters null weights. No other consumer of `weight_pct` exists (grep). |
| **L-1** | **CLOSED** | `scenario-factsheet-payload.ts:173-176`: `p6m`, `p1y`, `p3y` and `p5y` are `null`, so all four rows are omitted together. |
| **L-2** | **CLOSED** | `fetch-and-build-payload.ts:285`: `extra: { errorMessage }`. Discovery sends the reader's own error, which carries `cause`. |
| **L-3** | **CLOSED** | `dollar-validation.ts:128`: `price = n + 0`. `:54` `formatUsd` also rounds, then normalises, then returns "—" for non-finite input (T4 closed the class, not just the one function). |
| **L-4** | **SKIPPED, accepted** | This needs a rendering and copy decision (how a negative stacked segment and a hedge's assessment should look), and it cannot be verified under the recharts mock. The gap is named in the code comment at `RiskAttribution.tsx:52-55`. It is LOW and pre-existing. It stays in this file; do not route it anywhere. |
| **L-5** | **SKIPPED, accepted** | Locked by 169 D-49. Making `standalone_vol` nullable would reach `portfolio-insights` `volByStrategy`. Info. |
| **L-6** | **NOT CLOSED, out of diff** | No fix report touches it. Browse and compare still show the stored `six_month_return` (126 observations), while the factsheet's "6 Month" is 182 calendar days. This is recorded, not a 169 regression. |
| **L-7** | **CLOSED**, but the fix introduced R2-1 | `MandatePanels.tsx:33, 67` read `useBasisSeriesView(payload).strategyMetrics`. |

---

## Part 2: silent failures and regressions the fixes introduced

### R2-1 MEDIUM [introduced by the WR-03 / L-7 fix]: under the MTM toggle, the Terms panel calls a live track record "backtest"

- **Where:** `src/app/factsheet/[id]/v2/MandatePanels.tsx:81-86` (`obsStart = new Date(m.start)`) and `:100-104` (the warning span).
- **Mechanism:** WR-03 moved every `strategyMetrics` read in `TermsPanel` onto the SELECTED basis, and that included the live-date comparison. `hasBacktestGap` means "the declared live date is before the observation start". That is a fact about the strategy's record, not about which basis is on screen. When the MTM series starts later than the cash series, `m.start` is the MTM start.
- **Failing scenario:**
  - `start_date` = 2024-01-01. The cash series starts 2024-01-01. The MTM series starts 2024-08-08, which is the shape T2's own WR-03 test models: 180-day MTM inside a 400-day cash record.
  - Under cash, the Terms panel reads "Live since 2024-01-01" and shows no flag.
  - The user toggles to mark_to_market. It now reads "Live since 2024-01-01 — observation window starts 2024-08-08; portion before live date is backtest".
  - The strategy was live the whole time. The page presents MTM series availability as a live-versus-backtest claim, and the claim changes with a display toggle.
- **Why no test caught it:** `MetricsColumn.record-length.test.tsx` has no `startDate` (grep: 0 hits for `startDate` or `backtest`).
- **Recommendation:**
  - Keep the length fields (Observation start and end, Sample size) on the selected basis.
  - Compute `hasBacktestGap` from the cash record, `payload.strategyMetrics.start`, which is the record the live date describes.
  - Add a red-first case: MTM starts later than cash, `startDate` equals the cash start, the toggle is on MTM, and the backtest span is absent.

### R2-2 LOW [introduced by CSV-READ-CAP]: the paged composite read is no longer one snapshot, so a concurrent restitch can hand back a truncated series as whole

- **Where:** `composite-read-path.ts:252-276`, against the writer `job_worker.py:8492-8519` (`_reconcile_full_delete`, then upserts in 1000-row chunks, each chunk a separate request).
- **Mechanism:** the old single `.limit(20000)` request saw one snapshot. The keyset read issues one request per page. `page_order` detects a cursor the server ignored. It cannot detect rows disappearing between two pages.
- **Scenario:**
  - A 1112-row composite.
  - The reader receives page 1 (1000 old rows).
  - The restitch deletes every row and upserts chunk 1.
  - The reader asks for `date > d999` before chunk 2 lands.
  - It gets an empty page and returns 1000 rows as the complete series.
- **Bound:** the entry is cached under the pre-job `computed_at`. The status bridge stamps a new `computed_at` at job start, and the resolve stage's G1 gate refuses a `computing` row, so the bad entry is orphaned quickly. This is not a new class: the old read could also land between the delete and the upsert, and see nothing. Info or LOW. There is no fix round for this. The durable fix is an atomic replace in the writer (a single RPC).

### R2-3 LOW [behaviour change from M-3, not in any fix report]: a share-link recipient now loses the whole factsheet on an MTM or smoothed read outage

- **Where:** `factsheet-share/[token]/page.tsx:363-390`.
- **Before and after:** before M-3, an MTM or smoothed read failure degraded, and the recipient saw the factsheet with cash charts. Now `fetchAndBuildPayload` returns null (`read_error`), and the recipient gets the KCS-11 "not available" card.
- **What still works:** the outage is captured once per build (caller `"build"`), and the card promises nothing.
- **Why record it:** this is consistent with D-41's "an outage is never a degraded payload". It is recorded because none of T1 to T5 names this surface. Info.

### R2-4 LOW: `covered_span_unnamed` is captured per view for a permanent, by-design state

- **Where:** `composite-read-path.ts:800-811`.
- **Mechanism:** a `zero_fill` or `sparse` densify echo can never name the span, by construction (`deriveHeadlineCoversFrom`, `:532`). The orchestrator measured 2 such chain-broken rows on PROD. For those rows the event fires:
  - on every discovery view (uncached, `captureDefects` defaults to true, `page.tsx:247-255` passes no options);
  - on every owner-lane and share-lane build (both uncached, caller `"build"`);
  - hourly on the public lane.
- **Why it matters:** the event is deterministic. It is not a defect signal, and a `warning` event that recurs forever about an expected state trains people to ignore the tag.
- **Recommendation:** capture only when the echo is `broker_nan` and the date still cannot be derived, which is unexpected. Log the other cases. The durable fix is T1's suggestion: Python persists `twr_retained_from`.

### R2-5 LOW [pre-existing, now beside the fixed total]: the key-trust note can still print "$0.00" for P&L nobody knows

- **Where:** `live-holdings-summary.ts:392-397` (`phrase`), called from `OpenPositionsTable.tsx:318-322`.
- **Scenario:** every row is on an untrusted key and has a null P&L. The footer total now reads "—" (M-4). The note below it reads "Includes $0.00 from keys needing attention (P&L unavailable for 1 position)".
- **Why it is LOW:** the same sentence discloses that the P&L is unavailable. T4 saw this and left it because the builder is shared with 167.1.2's composer and existing pins cover its output.
- **Recommendation:** when `part.unavailable === part.count`, omit the amount (for example "1 position from keys needing attention, P&L unavailable"). This is for the builder's owner.

### R2-6 LOW [introduced by the H-2 fix]: on the persisted-headline refusal arms, a `simple` single-key row gets an arithmetic curve under a geometric TypeScript headline

- **Where:** `composite-read-path.ts:772-773` applies `cumulativeMethod: "arithmetic"` whether or not `cashHeadline` was applied (`:785-794`).
- **Mechanism:** when the overlay is refused, `strategyMetrics.cum_ret` is `compute()`'s geometric figure while the curve is Σr. That is round-1 H-2's mismatch in reverse. The composite reader never has this state, because it returns null without a trusted headline.
- **Reachability:** reachable only on the arms that are already logged and captured: `missing_keys` and the lingering raw `cash_settlement`. On discovery, a non-rankable row's series is nulled by `shapeRowAnalytics`, so no payload is built.
- **Recommendation:** set `cumulativeMethod` only when `cashHeadline` is applied.

### R2-7 LOW (answer to the coverage question): yes, the WR-02 weekday rule can admit a window the record does not cover

- **Where:** `compute.ts:210-226`.
- **Mechanism:** the rule treats `periodsPerYear === 252` as meaning "this venue closes on weekends". But 252 is also the default for anything that is not `crypto`: `annualizationPeriods` (`closed-sets.ts:582-586`), and `strategies.asset_class NOT NULL DEFAULT 'traditional'` (migration `20260709130000:26`).
- **Scenario:**
  - A 24/7 crypto CSV strategy left on the default `traditional`.
  - Its first row is Monday the 3rd, and the 1st of the month is a Saturday.
  - MTD is shown for the whole month, over a record that is missing two traded days.
  - The same happens for YTD when a year starts on a weekend, and transiently for 3M to 5Y.
- **Magnitude:** at most 3 missing days at the window start, and only when the record starts exactly on the first weekday session. T2 named this as the existing asset-class misclassification class.
- **Cheap guard (data, not metadata):** apply the weekday tolerance only when the record itself has no Saturday or Sunday observation. MT5 brokers that print a Sunday bar would also be excluded by the same guard.
- A 7-day venue is unchanged (neuter table in T2). A weekday venue that trades on 1 January or 25 December is not a real case.

### R2-8 Info: persistent conditions classified as outages

- **Where:** `row_ceiling` and `page_order` (`composite-read-path.ts:266-274`), and a `cash_settlement` read failure that exists only to date the caveat (`:563`). All of them become `read_error`.
- **Consequences:**
  - None of these is ever cached.
  - Each is rebuilt and captured at `error` on every request.
  - Discovery tells the user "Reload this page to try again".
- **Why only Info:** `row_ceiling` needs more than 20000 daily rows, and `page_order` needs a server that ignores the cursor. Neither is reachable today.
- **Design note, not a defect:** a failed read of the auxiliary caveat date takes down the whole page, where an undated caveat would still be true.

---

## Checked and clean

- **Catch discipline.** Every production caller of a throwing reader catches `instanceof CompositeSeriesReadError` and rethrows the rest:
  - discovery `page.tsx:183, 257`;
  - resolve `fetch-and-build-payload.ts:454, 559`.
  - No other `src` caller exists (grep).
  - `Promise.all` in both readers handles the second rejection.
  - The probe's `Promise.race` handles the loser.
- **Capture count.**
  - Resolve stage: one event per build (`seriesReadError`, `caller === "build"`); the probe captures nothing (`:273`, `captureDefects: caller === "build"` at `:556`). `/strategies` aggregates probe `read_error`s itself.
  - v2 page: does not capture again on `FactsheetReadError` (`v2/page.tsx:497-515`).
  - Discovery: one event per request by design (an uncached page), as T1 note 4 records.
- **Caching.**
  - The v8 callback throws on `read_error` (`v2/page.tsx:142`), so a miss stores nothing and a failed background revalidation keeps the last good entry.
  - Only facts about the row are cached as `null` or degraded: an untrusted composite headline, a malformed series payload, and a missing series row.
  - No v8 entry predates the round-1 payload changes, because v8 is not on `origin/main`.
- **Keyset read.**
  - It stops only on an empty page, so a server cap below 1000 cannot truncate.
  - Dates are checked strictly increasing across and within pages.
  - `no_data` covers a page that returns neither rows nor an error.
  - `(strategy_id, date)` is unique, and `strategy_analytics_series` is `PRIMARY KEY (strategy_id, kind)`, so `maybeSingle()` cannot fail on duplicates.
  - The only partial-as-complete path is the concurrency window in R2-2.
- **Persisted-headline logs.** Each refusal names its cause: raw cash key, `missing_keys` with the list, `non_finite_cumulative_return` with `nonFinite` and the status. A lone null Sortino or Calmar is correctly not captured.
- **Money "—".**
  - `formatUsd`, `formatUsdPrice` and `formatUsdSigned` return "—" for null and non-finite input, and normalise -0.
  - The open-positions total is "—" when every P&L is unknown.
  - A null weight is "—" with no assessment.
  - The only remaining "$0" for an unknown value is the key-trust clause (R2-5).
- **WR-04.** `bucketSeriesAge` and the chip floor the same age, and `Math.floor(NaN)` still reaches the `!Number.isFinite` → `stale` arm.
