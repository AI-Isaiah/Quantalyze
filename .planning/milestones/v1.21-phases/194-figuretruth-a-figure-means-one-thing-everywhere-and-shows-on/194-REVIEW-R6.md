---
phase: 194-figuretruth
round: 6
reviewed: 2026-11-08T10:30:00Z
reviewed_range: 27aa038c0..583369907
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.unreadable-reason.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/comparator-block.ts
  - src/lib/factsheet/figure-malformed-dates.test.ts
  - src/lib/factsheet/figure-record-unreadable.test.ts
  - src/lib/factsheet/types.ts
  - src/lib/figure-gate.ts
  - src/lib/queries.figure-record-report.test.ts
  - src/lib/queries.ts
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
status: issues_found
---

# Phase 194: Code Review Report, round 6

**Reviewed:** 2026-11-08. Range `27aa038c0..583369907` (fixer L: `c1a9ed112`, `aa1e5f304`, `0bb54a54a`, `19db04791`, `cad68ad66`, plus the worktree merge). `.planning/` is excluded.
**Depth:** standard. I also read the callers each fix depends on:
- every `figureRecord(` construction site (14);
- every importer of `build-payload.ts`, `allocator-portfolio-payload.ts` and `fetch-and-build-payload.ts`, to check where `captureToSentry` runs;
- `align.ts` `alignCoveredReturns`, to check when a comparator's covered span can be unreadable;
- `basis-context.tsx`, for the basis-bundle merge and `resolveRangeScope`;
- `headline-basis.ts` `isValidIsoDate`, the input to `suffixStart`;
- `queries.ts` `shapedRecordScalars` / `shapeRowAnalytics`, and `annualized-cell.tsx` `rowRecord`;
- the SQL `get_verified_cohort_rank` snapshot.

**Status:** issues_found. 3 MEDIUM, 0 HIGH, 0 CRITICAL. The brief asked for MEDIUM and above only.

## Summary

I judged the range against D-11 and D-13 to D-21 in `194-CONTEXT.md`, and against D-17 as the brief states it: an absent date is unknown and shows the value; a present but malformed date must not show it.

**Verification run at HEAD:**
- vitest, 7 files, 148 tests, all passed: `FactsheetView.unreadable-reason`, `figure-record-unreadable`, `queries.figure-record-report`, `figure-malformed-dates`, `ScenarioComposer.d11`, `figure-gate`, `audit-c20`.
- `npx tsc --noEmit -p .` exited 0.

**Readable records are byte-identical. Checked:**
- `figureRecord`: a readable or absent `headlineSince` leaves `unreadable` false. The spread stays `{}`.
- `build-payload.ts`: for a readable series, `totalRecord` is the very `endsRecord` object (`badDateIndex < 0`), and nothing is reported.
- `comparator-block.ts`: `coveredSpanUnreadable` is false on every readable block. `vmAvailable` is unchanged, and the new key is spread only when true.
- `MetricsColumn.tsx`: `benchNote` falls through to the old expression exactly when `coveredSpanUnreadable` is unset.
- `ScenarioComposer.tsx`: `ownBookUnreadable` is unchanged for finite returns.
- `queries.ts`: the only change is the added `strategyId` argument.

**The new `strategyId` parameters reach every caller. Checked:**
- `percentileRecord` has 3 call sites: `getPercentiles`, and the population and subject arms of `getOwnRowPercentiles`.
- `figureRecordScalars` has 3 call sites: two in `getOwnCapitalStrategies`, one in `getMyAllocationDashboard`.
- tsc is clean.

**`captureToSentry` cannot throw into a page build. Checked:**
- It wraps the scrub and the import in try/catch, and its `.catch` resolves.
- The new calls discard the returned promise, which is safe because it never rejects.

**`captureToSentry` is not server-only here. FAILED:** `buildFactsheetPayload` also runs in a `"use client"` component's `useMemo`. See WR-01.

**The tests can fail.** I checked this by reading each assertion against the code it guards:
- `figure-record-unreadable.test.ts`: the interior case asserts `rec.unreadable === true` on a series whose two ends are readable. That reads `undefined` without the `findIndex` pass.
- `FactsheetView.unreadable-reason.test.tsx`:
  - The two WR-04 cases assert "could not be read" and reject `/covers|reaches|\bhas\b/`. Deleting either branch prints `widenedWithheldReason("overlap", <cleared record>)`, which contains "reaches" and "covers".
  - The control case proves the two branches differ.
  - The SFH-M2 case uses `getByTestId`, which throws if the new `benchNote` arm is removed.
- `ScenarioComposer.d11.test.tsx` now mounts `OwnBookDeltaPanel` on the delta the composer handed over. It asserts Max DD has a digit, Sharpe and Sortino read "—", and the note says "could not be read". With the old date clause the delta is `undefined`, and `expect(delta).toBeDefined()` fails.

**R5 findings:**
- **R5 WR-01 (own-book date hid the whole panel): closed.**
  - `ownBookUnreadable` is non-finite-return only.
  - The book record's `unreadable` withholds Sharpe and Sortino through `gateDelta`.
  - `shorterSpan` returns null on the NaN book span, so no length is printed.
  - The non-finite-return Sentry reason no longer fires for a date fault.
- **R5 WR-02 (malformed `headline_since` dropped silently): closed in `figureRecord`, and at every producer that hands it the raw value.**
  - The rule does not reach producers that normalise a malformed value to `null` before calling `figureRecord`, nor the SQL twin. See WR-03.
  - The Holdings path is excluded because it is booked.
- **R5 WR-03 (interior malformed date): closed on the cash date axis only.**
  - The mark-to-market and smoothed bundles have their own date axes, and those are not checked. See WR-02.
- **R5 WR-04 (untested could-not-be-read branches): closed** (tests above).

**Comparator `coveredSpanUnreadable`: correct, and nearly unreachable on a real factsheet.** `alignCoveredReturns` covers a strategy date only when `closeSet.has(cur)`, so a malformed date is never a covered or paired date there. The marker and its `benchNote` arm matter in practice only for blocks built from a plain return array (`toAlignment`'s array form: the Scenario path). This is not a defect. It does mean the SFH-M2 test fixture describes a state the factsheet builder does not itself produce.

I did not assess necessity this round, so `necessity:` is left out of the frontmatter.

## Warnings

### WR-01: The new "server-side" unreadable-record report runs in the browser, inside a `useMemo` (MEDIUM, silent-failure / Sentry-on-client)

**File:** `src/lib/factsheet/build-payload.ts:910-924` (the `captureToSentry` call in `buildFromBuildableSeries`). Client caller: `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:1` (`"use client"`) and `:117-135` (`useMemo(() => buildAllocatorPortfolioFactsheetPayload(...))`) → `src/lib/factsheet/allocator-portfolio-payload.ts:113` → `buildFactsheetPayload` → `buildFromBuildableSeries`.

**Issue:** The comment at `:907-908` says the report is made "once per build, never from a render-time gate", and the brief describes it as server-side. Neither is true.
- The allocator dashboard is a client component, and it calls `buildFactsheetPayload` inside a `useMemo`. So when an allocator's book series holds a malformed date, the browser calls `captureToSentry` during render.
- It fires on every mount, and again every time a memo dependency changes. That covers `equityDailyPoints`, `equityDailyReturns`, `btcBenchmarkPrices`, `marksStart`, `marksTrailingSince` and the rest.
- React may call a memo body more than once, so this is a side effect in the render phase. StrictMode calls it twice.
- This is the "Sentry calls on the client or per render" pattern the brief rules out. `ScenarioComposer` avoids the same problem with a `useEffect` keyed on the flag (`ScenarioComposer.tsx:4291-4300`).
- Side effect: the event carries `strategyId: "portfolio:<allocatorId>"` from the browser.

No test pins where the report runs. `figure-record-unreadable.test.ts` only asserts that it fires.

**Fix:** Keep the detection in the builder and move the report to the callers.
- Server: report from `fetch-and-build-payload.ts`, the server caller.
- Client: in `AllocationDashboardV2`, report from an effect keyed on the payload's flag:

```ts
// build-payload.ts: no captureToSentry; carry what the reporter needs
const totalRecord: FigureRecord = badDateIndex >= 0 ? { ...endsRecord, unreadable: true } : endsRecord;

// fetch-and-build-payload.ts (server), after the build:
if (payload?.figureRecord?.unreadable) {
  captureToSentry(new Error("factsheet figure record unreadable: a series date is not a date"), {
    tags: { op: "buildFactsheetPayload", reason: "figure-record-unreadable" },
    level: "error",
    extra: { strategyId, firstBadDate: dates.find((d) => !isReadableDay(d)) ?? null /* … */ },
  });
}

// AllocationDashboardV2.tsx (client):
const unreadable = factsheetPayload?.figureRecord?.unreadable === true;
useEffect(() => {
  if (unreadable) captureToSentry(new Error("allocator book figure record unreadable"), { tags: { component: "AllocationDashboardV2", reason: "figure-record-unreadable" } });
}, [unreadable]);
```

Then move the `figure-record-unreadable.test.ts` SFH-M3 cases to the server caller, and add a case asserting that `buildFactsheetPayload` itself never calls `captureToSentry`.

### WR-02: R5 WR-03 is closed on the cash date axis only; a malformed interior date on the mark-to-market or smoothed axis still shows annualised figures with no note on a zoom (MEDIUM, D-17, user-facing)

**File:** `src/lib/factsheet/build-payload.ts:907` (`dates.findIndex(...)` scans the cash `dates` only), `:952-1000` (the MTM and smoothed bundles are built from `normalizeDailyReturns(opts.mtmSeries.dailyReturns)` and `normalizeDailyReturns(opts.smoothedSeries.dailyReturns)`, each on its "Own axis", and both get `figureRecord: totalRecord`). Readers: `src/app/factsheet/[id]/v2/basis-context.tsx:332-339` (under `mark_to_market` / `smoothed_mtm` the view is the bundle, including its `dates`), `:549-563` (`resolveRangeScope` reads `view.dates`), `FactsheetView.tsx:1805-1806` and `MetricsColumn.tsx:353-354` (`gateWindowSpan = coveredDays(scope.start, scope.end)`).

**Issue:** The WR-03 fix judges readability over every cash date and marks the one shared `totalRecord`. The comment at `:903-906` says that withholds "every annualised figure under the one reason". The two other bases bring their own date arrays, and those are never scanned. Take a cash series that is clean and an MTM series with a present but malformed interior date:
1. `totalRecord` is readable.
2. On the MTM basis, a zoom whose start or end index lands on the bad date gives `gateWindowSpan = NaN`.
3. `gateAnnualized(record, NaN)` takes the `!Number.isFinite(window)` arm and returns `"null"`.
4. The strip and the rail print CAGR, Sharpe, Sortino and Calmar for that slice with no under-1y note.

That is the R5 WR-03 defect, still present on two of the three bases.

The MTM bundle's 1y rolling series also cannot step past the bad index, so it blanks. Meanwhile `gateRollingWindow` reports it `full` from the readable record, so no reason is shown. The same holds for `smoothed_mtm`.

**Fix:** Run the readability pass over every date axis that shares `totalRecord`. Build the two basis series before the record, or scan their raw dates directly:

```ts
const axisDates = [
  dates,
  opts?.mtmSeries ? normalizeDailyReturns(opts.mtmSeries.dailyReturns).map((d) => d.date) : [],
  opts?.smoothedSeries ? normalizeDailyReturns(opts.smoothedSeries.dailyReturns).map((d) => d.date) : [],
];
const badDate = axisDates.flat().find((d) => !isReadableDay(d));
const totalRecord: FigureRecord = badDate !== undefined ? { ...endsRecord, unreadable: true } : endsRecord;
```

Add a case to `figure-record-unreadable.test.ts`: a clean cash series plus an `mtmSeries` with one interior malformed date must give `figureRecord.unreadable === true`. Without the fix, that case reads `undefined`.

### WR-03: The D-17 headline-start and series-start rule is bypassed by producers that normalise a malformed date to `null` first, and by the SQL cohort twin. One strategy is withheld on its factsheet and shown in the discovery list (MEDIUM, D-17 / D-18 parity)

**Files:**
- `src/lib/queries.ts:874-897` (`shapedRecordScalars`):
  - `isoDay` maps any value that does not start `\d{4}-\d{2}-\d{2}` to `null`;
  - a malformed `series_start` is then replaced by the earliest readable date in `returns_series`.
- `src/lib/queries.ts:903-906, 913-937` (`shapeStoredAnalytics` / `shapeRowAnalytics`). They feed:
  - `src/components/strategy/annualized-cell.tsx:24-31` (`rowRecord`, read by `StrategyTable.tsx:505,1307` and `StrategyGrid.tsx:68`);
  - the own-row subject arm of `getOwnRowPercentiles` (`queries.ts:1405-1417`).
- SQL: `supabase/schema/functions/get_verified_cohort_rank.sql:67` (and the rank query's twin). There, a `headline_since` that fails the regex drops out of `GREATEST`. A non-crypto row with an integer `record_observations` is decided on the count alone. An unreadable series end makes `rec_ok` true, so the row stays in the cohort.

**Issue:** Fixer L made `figureRecord` treat a present but malformed `headlineSince` as unreadable (R5 WR-02). That only works for producers that hand it the raw value: `build-payload`, `percentileRecord`'s population arm, and the compare page. Take a published strategy whose `data_quality_flags.headline_since` is present but not date-shaped (for example `"n/a"`):
- **Factsheet and `/discovery` percentile population:** withheld ("could not be read"), and the row leaves the annualised peer sets.
- **Discovery / strategies list cells** (`rowRecord` on shaped analytics): `headline_since` reads `null` (absent), so the record is judged on its full `seriesStart` span. CAGR, Sharpe, Sortino and Calmar print with no marker. That is the "longest possible span" outcome R5 WR-02 described.
- **Own-row subjects (a draft or private row on `/my-strategies`):** the same `null`, so the row keeps its annualised ranks. The `percentileRecord` report added for this arm cannot fire for this input, because the shaped value is already `null`.
- **SQL blend cohort:** the row stays in the Sharpe and Sortino sets. D-18 requires SQL and TS to agree on who leaves.

A malformed first date is the same shape: the list rebuilds `series_start` from the earliest readable point, while the factsheet withholds.

The booked exclusion names only the Holdings path (`figureRecordScalars`). These are separate producers on other surfaces, so I report this and the orchestrator can decide whether to book it with that entry. The same premise applies ("PROD data has no malformed dates"), and should be re-measured rather than assumed.

**Fix (TS):** In `shapedRecordScalars`, keep a present but non-ISO value instead of nulling it, so `figureRecord` can judge it. Keep the 10-character slice for timestamp-shaped values. Use the `returns_series` scan only when `series_start` is genuinely absent:

```ts
const isoDay = (v: unknown): string | null =>
  typeof v !== "string" || v.length === 0 ? null : /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v; // malformed stays present
let series_start = isoDay(a.series_start);
if (series_start == null && Array.isArray(a.returns_series)) { /* earliest-date scan, absent case only */ }
```

**Fix (SQL):** In both `rec_ok` predicates, add a `WHEN` arm ahead of the count arm. It returns "fails" when `headline_since` or either `returns_series` end is present and does not match `'^\d{4}-\d{2}-\d{2}$'`, mirroring `recordClears`'s `unreadable → false`. Pin it in `test_get_verified_cohort_rank_gate.sql` with a red and a green arm, under the migration-reviewer and RLS gates the repo requires for a migration.

---

_Reviewed: 2026-11-08T10:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
