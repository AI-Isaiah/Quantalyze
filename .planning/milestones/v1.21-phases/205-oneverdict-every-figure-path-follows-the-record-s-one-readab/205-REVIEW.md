---
phase: 205-oneverdict-every-figure-path-follows-the-record-s-one-readab
reviewed: 2026-11-10T20:22:05Z
depth: standard
diff_range: 240999b5f..81e6e825e (excluding .planning)
files_reviewed: 8
files_reviewed_list:
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/__tests__/figure-parity-pages.test.tsx
  - src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx
  - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
  - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
  - src/lib/factsheet/audit-c20.test.ts
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
  necessity: 0
status: issues_found
---

# Phase 205: Code Review Report

**Reviewed:** 2026-11-10T20:22:05Z
**Depth:** standard. Cross-file reads were done where the brief asked: payload readers, cache key holders, and the USD build's option provenance.
**Files Reviewed:** 8
**Status:** issues_found
**Scope rule:** MEDIUM and above only, as the brief asked. LOW and INFO are left out on purpose.

## Summary

The three fixes do what CONTEXT D-01..D-03 and D-05 ask:
- **D-01:** the USD record is unreadable exactly when the native record is. `inheritedUnreadable` is OR'd into the USD `totalRecord`, and the second date scan is gone.
- **D-02:** every bundle withholds its stress block on the record verdict. The `dates[0]` half stays only to keep bad input away from `computeStressWindows`.
- **D-03:** the api arm sets `allocatorPortfolios: null` on an unreadable record, so `alignBlend` is never reached with an unparseable first date.
- **D-05:** the cache key moved to v23.

`npx tsc --noEmit` is clean. The three changed test files pass (126/126).

What the brief asked me to check:
- **Readers of the changed fields.**
  - `allocatorPortfolios`: no non-test reader exists. The only source hits are its type (`src/lib/factsheet/types.ts:1146`, already `| null`), the builder, and the v23 cache comment. The test readers either build readable fixtures (`build-payload.null-honest.test.ts:185` throws on null) or hand-build null.
  - Withheld `stressWindows`: its readers are `StressWindowsPanel.tsx:29` and `FactsheetView.tsx:710`, which both already handle `unreadable`. The browser leverage arm spreads the bundle's `stressWindows` (`basis-context.tsx:478`) and passes `view.figureRecord` (`basis-context.tsx:288`), so a levered factsheet view withholds the same way. `windowView` does not take `stressWindows` from its slice bundle.
  - `figureRecord` on the USD view: read like the native one.
  - The tearsheet and the PDF route read none of the three changed fields.
- **Cache key.** `page.tsx:285` holds the only `factsheet-v2-payload-*` key in the repo. The share page and the tearsheet call `fetchAndBuildPayload` uncached. The PDF route keys an ETag on `computed_at` and reads none of the changed fields. v23 covers every key holder.
- **Can the tests fail?** They are not tautological. The neuter logs in all three SUMMARYs show each gate going RED with its fix removed. I re-read the D-01 "absent day" case for vacuity: it asserts `toBeFalsy()` on `usdView?.payload...`, which would pass if `usdView` were missing. That is ruled out because the D-02 parity cases build from the same `btcNativeAnalytics` fixture and assert `toBe(true)` through `usdView`. One weakness is folded into WR-01: the once-only Sentry gate picks its input to avoid the case that fails.
- **The named known gap (headlineSince double report).** Judged in WR-01. The executor's description is wrong in both directions:
  - The arm it names cannot happen in production.
  - A different arm it does not name, a malformed FIRST curve point (`recordSeriesStart`), is reachable and does send two events.

Necessity rubric (`necessity-review.md`) was read. No necessity finding reached MEDIUM.

Out-of-scope observation, recorded so it is not lost, not counted as a finding. The USD build gets `singleKeyDataQuality(dqf)` only (`fetch-and-build-payload.ts:1163`). The native build gets the `dataQuality` from `readSingleKeyBasisOpts`, which adds `headlineCoversFrom` (`composite-read-path.ts:1069`). So on a chain-broken Dated row, the USD view's record span and windows do not follow the headline suffix the native view uses. This behaviour existed before this phase and is unrelated to readability.

## Warnings

### WR-01: The USD build still sends a second `figure-record-unreadable` event for an inherited verdict, through `recordSeriesStart`, not `headlineSince`

**Severity:** MEDIUM · **Classification:** neither (observability only; no figure or rendered text changes)
**File:** `src/lib/factsheet/build-payload.ts:975`, with `src/lib/factsheet/fetch-and-build-payload.ts:1166`. Test gap at `src/__tests__/figure-parity-pages.test.tsx:1257-1262`.

**Issue:** The report condition is `(firstBad || endsRecord.unreadable) && opts?.reportUnreadable`. In the USD build, both halves can be true for reasons that belong to the native record:

1. **`recordSeriesStart` arm. Reachable; not named by the executor.**
   - For a curve-derived row, `curveRecordStart` (`resolve-series.ts:156-163`) returns the stored curve's first date as raw text, malformed or not.
   - `buildUsdView` passes that same value into the USD build (`fetch-and-build-payload.ts:1166`). Its own comment calls it "a fact about the record, not its unit".
   - The USD build then scans it as axis 3 (`build-payload.ts:961-966`), so `firstBad.axis === 3` and `endsRecord.unreadable` (`seriesStart = recordStart`) are both true, and it reports.
   - The native build has already reported the same date.
   - Measured with a vitest probe that runs the native build and then the USD build with the native verdict inherited: `recordSeriesStart` gives 2 reports, both `firstBadAxis: "record_start"`. The interior-date control gives 1 report.
2. **`headlineSince` arm. Named by the executor; cannot happen in production.**
   - The USD build never receives `headlineCoversFrom`. `buildUsdView` sets `dataQuality: singleKeyDataQuality(dqf)` (`fetch-and-build-payload.ts:1163`), and that function emits no `headlineCoversFrom` (`composite-read-path.ts:642-660`). Only the native build gets it, via `readSingleKeyBasisOpts` (`composite-read-path.ts:1069`).
   - The native value is itself parsed by `isValidIsoDate` (`headline-basis.ts:86-93, 119`), so a malformed `headline_since` becomes `null` and the row is withheld. It is never an unreadable `headlineSince`.
   - The probe reproduces a double report only when `headlineCoversFrom` is injected directly into opts, which no production caller does.
   - The 205-01-SUMMARY "Known residual" (and RESEARCH Pitfall 1) therefore describes an arm that cannot occur and misses the one that can.

**Does it violate D-01?** Yes, for the `recordSeriesStart` arm.
- D-01 says the USD build "does not send a second `figure-record-unreadable` event for an inherited verdict". It allows only "its own scan [...] if it ever finds an unreadable date of its own".
- D-01 itself defines the USD's own dates as "its own converted dates [...] a subset of priced, readable days".
- `recordSeriesStart` is not a converted date. It is the native record's first date, copied verbatim, so the second event is for the inherited verdict.
- It is not a regression: before this diff, both arms reported twice as well.

The once-only gate was written around this case. The comment at `figure-parity-pages.test.tsx:1257-1261` picks an interior date on purpose, because "a bad FIRST curve point reaches the USD build through `recordSeriesStart`, where the USD build legitimately reports its own verdict, and a count of one would fail". That calls the decision's excluded case "legitimate".

**Failure scenario:** A PROD api-arm BTC-native strategy (`daily_returns` empty) has a malformed stored first curve point. Every cache-miss build of `/factsheet/<id>` sends two error-level `figure-record-unreadable` events for one record. They group into one Sentry issue at double the event count, and any event-rate alert on that reason counts the record twice. No figure, page text or payload value is affected.

**Fix:** If the native build reported, the USD build stays silent. The native build always reports when it is unreadable (it has no inherited flag and the same condition), so this gives exactly one event per record:

```ts
// build-payload.ts:975
if ((firstBad || endsRecord.unreadable) && opts?.reportUnreadable && !opts?.inheritedUnreadable) {
```

Then add a bad-first-curve-point case to the once-only test (`figure-parity-pages.test.tsx:1262` describe), asserting `reports.length === 1` with `firstBadAxis: "record_start"`, and reword the `:1257-1261` comment. Correct the 205-01-SUMMARY residual line to name the `recordSeriesStart` arm.

### WR-02: The Scenario factsheet's stress block does not follow its own record verdict; after this diff its levered view withholds where its base view prints a table

**Severity:** MEDIUM (conditional; see reachability) · **Classification:** user-facing
**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:483` (unchanged file). The interaction is with `src/lib/factsheet/build-payload.ts:663-664` (changed) through `src/app/factsheet/[id]/v2/basis-context.tsx:400, 478`.

**Issue:**
- The phase goal reads "an unreadable record is withheld the same way on every path and an unparseable first date never reaches an error page". The Scenario payload builds its own record verdict (`record`, `scenario-factsheet-payload.ts:414`, 194.2's interior-date check). It then computes `stressWindows: computeStressWindows(datesR, rets, rets, "", [])` without consulting it. That is the WR-02 class this phase fixed, on the one remaining producer.
- Measured with a vitest probe of `buildScenarioFactsheetPayload` on 300 days from 2020-01-02 with an interior date `2020-03-31x`: `figureRecord.unreadable === true` with CAGR still computed, `stressWindows.windows.length === 1`, and `stressWindows.unreadable` undefined.
- With a first date of `2020-1-1`, the builder throws `stress-windows: dates must be ISO (YYYY-MM-DD)`. It runs in the browser inside `ScenarioFactsheetChart`.
- Diff interaction: `ScenarioFactsheetChart` mounts the real `FactsheetBody` (ControlBar included; `scenarioMode` hides only Share and Compare). The levered arm spreads the re-derived bundle's `stressWindows` (`basis-context.tsx:478`). Since D-02, `deriveSeriesBundle` withholds on `args.figureRecord?.unreadable`, which `rederiveArgs` reads from the Scenario view. So on an unreadable Scenario record, the base view prints a stress table and the levered view prints the withheld sentence. Before this diff the two agreed (both printed).

**Reachability, not traced:**
- Whether a malformed date can reach `scenarioMetrics.portfolio_daily_returns` (engine output, `ScenarioComposer.tsx:6105`) or the scenario-share page's `portfolioDaily` (`scenario-share/[token]/page.tsx:531`) was not proven.
- Whether the leverage control is enabled in `scenarioMode` was not proven either.
- The probe shows the builder behaviour only.
- CONTEXT bounds the phase to three named paths, so this is a goal-text gap on a sibling producer, not a defect in the diffed lines. I recommend booking it rather than fixing it in this phase unless reachability is shown.

**Failure scenario:** A scenario blend whose engine output carries one malformed interior date shows its annualised figures withheld as "dates could not be read", yet prints a stress-window table under them. Toggling leverage makes the table disappear and toggling back brings it back. With a non-ISO first date, the scenario factsheet widget throws.

**Fix:** Apply the same rule as `deriveSeriesBundle`. Withhold on the record verdict, and keep the first-date check as throw-avoidance only:

```ts
// scenario-factsheet-payload.ts:483
stressWindows:
  record.unreadable === true || !isReadableDay(datesR[0])
    ? { windows: [], benchName: "", totalCatalogued: 0, droppedOutOfRange: 0, droppedPartial: 0, unreadable: true }
    : computeStressWindows(datesR, rets, rets, "", []),
```

Add `isReadableDay` to the file's existing `@/lib/figure-gate` import. Then add a test that goes RED with the guard removed: an interior unreadable blend date gives `stressWindows.unreadable === true`, and a non-ISO first date gives no throw.

---

_Reviewed: 2026-11-10T20:22:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter findings

The silent-failure-hunter (model sonnet) read the same diff and reports **no MEDIUM-or-above findings**. It checked six things:
- The withheld stress form is tested before the empty-windows branch (`StressWindowsPanel.tsx:29-42`), so no "outside the observation period" claim appears for a withheld record.
- Nothing renders `allocatorPortfolios`, so a null makes no false claim.
- An inherited-only USD verdict sends no report.
- Every server call passes a real `totalRecord`.
- No `payload-v22` remains.
- The new tests fail on the old behaviour.

Its LOW notes (not fixed, per the review rules):
- **L1:** `figureRecord?.unreadable === true` treats a record-less payload as readable for the stress block. This is reachable only from hand-built payloads or stale cache entries, and v23 drains stale entries.
- **L2:** a duplicate Sentry report is possible through `recordSeriesStart`. This is the same mechanism as WR-01 above, which judges it MEDIUM.
- **L3:** the USD view only inherits the native verdict, with no reverse path. This is by design under D-01.
