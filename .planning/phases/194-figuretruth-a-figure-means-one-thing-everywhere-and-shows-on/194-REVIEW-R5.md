---
phase: 194-figuretruth
round: 5
reviewed: 2026-11-08T07:57:30Z
reviewed_range: 48d11de9f..868d27cee
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/lib/factsheet/audit-c20.test.ts
  - src/lib/factsheet/comparator-block.ts
  - src/lib/factsheet/figure-malformed-dates.test.ts
  - src/lib/factsheet/rolling.ts
  - src/lib/factsheet/types.ts
  - src/lib/figure-gate.ts
findings:
  critical: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 194: Code Review Report, round 5

**Reviewed:** 2026-11-08. Range `48d11de9f..868d27cee` (fixer K: commits `31a0f4409`, `3698d11fd`, plus the worktree merge), `.planning/` excluded.
**Depth:** standard. I also read the callers each fix depends on: every `figureRecord` / `coveredDays` caller, `basis-context.tsx` `resolveRangeScope` and `windowView`, `build-payload.ts` `totalRecord`, the `OwnBookDeltaPanel` in `BatchDPanels.tsx`, the rolling verdict notes, and the metrics.py `headline_since` producer.
**Status:** issues_found. 4 MEDIUM, 0 HIGH, 0 CRITICAL. The brief asked for MEDIUM and above only, so LOW and INFO are left out.

## Summary

I judged the range against D-11 and D-13 to D-21 in `194-CONTEXT.md`, and against D-17 as the brief states it: an absent date is unknown and shows the value, and a present but malformed date must not show it.

I ran the touched tests at HEAD with vitest: `figure-malformed-dates`, `audit-c20`, `ScenarioBenchmarkSection`, `ScenarioComposer.d11`, `figure-gate`, `figure-gate.d11`, `comparator-block.d11`, `rolling-calendar` and `MetricsColumn.figure-gate`. That is 9 files and 236 tests, and all of them passed.

**Readable records are byte-identical: checked.**
- `figureRecord` spreads `{}` when nothing is malformed, so the object shape is unchanged and the snapshot tests pass.
- `figureSpan` only differs when `headlineSince` is unreadable.
- In `rolling.ts:190` the new guard can only fire on a NaN span.
- In `comparator-block.ts` the joint branch returns the same `{ state, days: overlapSpan }` for a readable overlap. With no record it stays `"null"` (no change). `summaryOf` is identical when `coveredSpanUnreadable` is false.
- The FactsheetView and MetricsColumn note branches only change when `marker.unreadable` is set.
- The R4 WR-01 caption prints `252-day` at the default basis.

**Absent dates still read as unknown: checked.**
- `figureRecord` tests `!!d` before parsing, so `null`, `undefined` and `""` stay unknown.
- `ownBookUnreadable` guards the empty array.
- The comparator's `coveredSpan` stays `null` below 2 covered dates.

**Non-annualised figures:**
- The comparator keeps `cum_ret`, `max_dd`, `longest_dd`, the trailing windows, beta, correlation and the captures.
- One surface does hide a non-annualised figure: the own-book Max DD delta. See WR-01.

**audit-c20 fixture: no hidden regression.**
- The other blocks in the file still use the default `makeReturns()`, whose rows 32-40 are invalid dates. Those blocks now build an unreadable total record.
- But they only assert on `ingestSource`, `rollingWindow`, synthesized-panel absence and type shape. None of those reads the gate.
- In the #597 block, 80 real days would fail the 90-day crypto minimum (D-15), so the move to 120 real days is needed. The scaling tests still compare live values.

**R4 findings:**
- **R4 WR-01 (Scenario vs BTC caption): closed.**
  - `ScenarioBenchmarkSection.tsx:209` prints `{periodsPerYear}-day`.
  - The new test renders at 365 and asserts `365-day` and not `252-day`, so it turns red on the old literal.
- **R4 WR-02 (present but malformed dates read as unknown): partially closed.**
  - The record's two end dates, the comparator's covered and overlap ends, and the rolling window are handled.
  - A malformed `headline_since` still lets the figures show (WR-02 below).
  - An interior malformed date still reaches a shown annualised figure on the factsheet strip and rail (WR-03 below).

I did not assess necessity this round, so `necessity:` is left out of the frontmatter.

## Warnings

### WR-01: A malformed own-book date now hides the whole "vs Your Book" panel, including the non-annualised Max DD delta (MEDIUM, user-facing)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:4284-4295` (the date clause), `:4312-4317` (returns `undefined`), `:4298-4304` (Sentry message); panel `src/app/factsheet/[id]/v2/BatchDPanels.tsx:211-247`

**Issue:** The same commit (`3698d11fd`) made two changes:
1. It made `figureRecord` mark a present but malformed series end as `unreadable`.
2. It added a date clause to `ownBookUnreadable`.

After change 1, the date clause is redundant for every annualised figure:
- `sharpeDeltaState` is `gateDelta(blend, book, …)`, and the book record built at `:4352` is now `unreadable`, so `recordClears` is false and the state is `withheld`.
- `liveSharpeState` is `gateAnnualized(book)`, which is also `withheld`.
- The panel's note would read "Changes in annualized figures are not shown: the record's dates could not be read."

What the clause does add is the R3 SFH-M2 fail-closed path, which makes `scenarioOwnBookDelta` return `undefined` (`:4312`). With that, `OwnBookDeltaPanel` returns `null`, and the whole panel disappears with no reason shown to the user:
- **Max DD (blend vs book) is gone.** It is computed from the returns alone, and every return here is finite.
- The blend and book observation counts are gone too.

That fail-closed path was right for a non-finite return, which corrupts the drawdown as well. It is wrong for a bad date, which only makes the record length unknown. This is the "non-annualised figure wrongly hidden" case. On top of that, the Sentry error and the console line both say "non-finite own-book return", which misnames a date fault.

The new d11 test cannot catch this:
- It checks the footer's Max DD, which comes from `liveMetrics` vs `scenarioMetrics`, not from the panel.
- With the clause removed, only its Sentry-count assertion would change.

**Fix:** Keep `ownBookUnreadable` for non-finite returns only. Let the `unreadable` book record withhold Sharpe and Sortino through `gateDelta`. If a report is wanted, raise it under its own reason without dropping the payload:

```ts
const ownBookUnreadable = useMemo(
  () => !baselineEquityDailyReturns.every((point) => Number.isFinite(point.value)),
  [baselineEquityDailyReturns],
);
// optional: separate report, payload still built
const ownBookDateUnreadable = useMemo(
  () =>
    baselineEquityDailyReturns.length > 0 &&
    !Number.isFinite(
      coveredDays(baselineEquityDailyReturns[0].date, baselineEquityDailyReturns.at(-1)!.date),
    ),
  [baselineEquityDailyReturns],
);
```

Add a test that renders the panel with a malformed last book date. It should assert:
- Sharpe and Sortino read "—";
- the Max DD row keeps its value;
- the note says "could not be read".

### WR-02: A malformed `headline_since` is silently dropped, so a chain-broken record is judged on its LONGEST possible span (MEDIUM, D-17)

**File:** `src/lib/figure-gate.ts:100-101` (`figureSpan`), `:119` (`unreadable` checks only `seriesStart` and `seriesEnd`); pinned by `src/lib/factsheet/figure-malformed-dates.test.ts:30-32`

**Issue:** On a chain-broken row, `headline_since` is where the headline figures start. It is a present date that decides the record length. The two kinds of malformed date are treated differently:
- A malformed `seriesStart` or `seriesEnd` marks the record `unreadable`, so it is withheld.
- A malformed `headlineSince` is ignored. The span falls back to `seriesStart`, which is the most generous record the row could have.

Failure scenario: a crypto row whose series covers 2023-01-01..2025-12-31, chain-broken with a real suffix of about 20 days, where `headline_since` holds a value `isReadableDay` rejects.
- `figureSpan` returns 1096.
- `gateAnnualized` returns `full`.
- The headline CAGR, Sharpe and the rest, which cover the 20-day suffix, print with no note at all.
- The row stays in the annualised peer sets.

Before this fix the same row read `null`, which also showed the figures with no note. So this is not a regression on that row. But the fix claims "a present but malformed date withholds", and on this input it does not. The new test pins the generous fallback (`toBe(365)`) as the contract.

The fallback only helps where the series itself is short. That is the one case the test checks: a 20-day series with a garbage `headlineSince`.

**Fix:** Treat a present but unreadable `headlineSince` like a malformed series end. Fail it closed to `unreadable`, so the reason text names no length:

```ts
const unreadable = [input.seriesStart, input.seriesEnd, input.headlineSince].some(
  (d) => !!d && !isReadableDay(d),
);
```

`figureSpan` can keep ignoring it for the span value, because `recordClears` returns false first. Rewrite the `headlineSince %j falls back to seriesStart` cases to expect `unreadable: true` and `gateAnnualized === "withheld"`.

The metrics.py producer writes `strftime("%Y-%m-%d")` (`metrics.py:1960-1962`), so no legitimate stored value is withheld by this. `figureRecordScalars` in `queries.ts:2811` already normalises its own copy to 10 characters.

### WR-03: A malformed INTERIOR date still shows the strategy's annualised figures with no note, while the comparator built on the same slice says "the record's dates could not be read" (MEDIUM, user-facing)

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1805-1806`, `src/app/factsheet/[id]/v2/MetricsColumn.tsx:353`. Root cause: `src/lib/factsheet/build-payload.ts:895-901` judges the total record on `dates[0]` and `dates[n-1]` only. Related: `src/lib/factsheet/comparator-block.ts:116-120`, `src/lib/factsheet/rolling.ts:185-190`

**Issue:** Fix K validates only the end dates of each span it computes. A selected range on the factsheet starts at whatever index the user's zoom lands on (`resolveRangeScope`, `basis-context.tsx:556-567`). When that index holds a malformed date:
- **The strategy cells show the figures with no note.** `gateWindowSpan = coveredDays(scope.start, scope.end)` is NaN. `gateAnnualized(record, NaN)` takes the `!Number.isFinite(window)` arm and returns `"null"`. So the strip and the rail print CAGR, Sharpe, Sortino and Calmar for a slice of any length with no under-1y note. That is the "NaN read as unknown" defect this round set out to remove.
- **The comparator in the same view does the opposite.** `windowView` (`basis-context.tsx:648-655`) re-derives the comparator over the same slice. There, `coveredSpanUnreadable` dashes the benchmark's five annualised cells with no reason line. The overlap is NaN too, so α, IR, TE and Treynor are withheld under "Alpha, information ratio, Treynor and tracking error are not shown: the record's dates could not be read."
- **The rolling 1y chart blanks with no reason.** Once a window start reaches the malformed index, `rolling.ts:185` cannot step past it. So every later point is dropped (the new test pins `slice(385)` all null). Meanwhile `gateRollingWindow`'s calendar arm still reports the window `full`, from the readable record span.
- **The row-window rolling note invents a reason.** It reads `rollingWindowSpanDays` → `null` → cause `record`, which prints "appear once the record covers one full rolling window. This record covers 400 days." That is pre-existing, but it has the same cause.

So one screen tells the reader the record's dates cannot be read, beside the strategy's own annualised figures printed as if they could.

**Fix (root cause, one place):** Judge readability over the whole series where the total record is built. Then every surface that reads `payload.figureRecord` withholds together, under the one reason. That covers the strip, the rail, the comparator via `figureRecord`, rolling via `gateRollingWindow`, and JSON-LD.

```ts
// figure-gate.ts: export the existing helper
export function isReadableDay(d: string): boolean { ... }

// build-payload.ts:895
const totalRecord = figureRecord({ ... });
const allDatesReadable = dates.every(isReadableDay);
const record = allDatesReadable ? totalRecord : { ...totalRecord, unreadable: true as const };
```

If an all-dates rule is too broad, the minimum is to treat a non-finite `gateWindowSpan` in KpiStrip and MetricsColumn as `withheld` with the unreadable reason, as the comparator already does.

### WR-04: The two new UI reason branches have no test; removing either prints a false length-based reason with no test turning red (MEDIUM, user-facing copy)

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1938-1945`, `src/app/factsheet/[id]/v2/MetricsColumn.tsx:619`

**Issue:** The `jointAnnualization.unreadable` branches are what turn the comparator's new marker into "…could not be read". No test renders either one:
- A grep for `could not be read` across `*.test.ts(x)` finds only `figure-malformed-dates.test.ts`.
- That file asserts the `figure-gate.ts` strings directly. It never renders the strip or the rail.

If either branch is deleted or reordered, the marker falls into the `withheld` arm with the strategy's readable, cleared record. `widenedWithheldReason("overlap", record)` then prints "Alpha, information ratio, Treynor and tracking error appear once the record reaches 90 days. This record covers 400 days." That is a length-based reason for a record that clears, and it contradicts the figures shown beside it. Every test would still pass.

This is the "reason text prints an invented length" case the brief asks about, and only the wiring stands between the reader and that sentence.

**Fix:** Add one render test per surface:
- For KpiStrip and for the MetricsColumn joint table, feed a payload whose `comparators.btc.jointAnnualization` is `{ state: "withheld", days: 0, unreadable: true }` beside a cleared `figureRecord`.
- Assert that the note contains "could not be read".
- Assert that it does not match `/covers|reaches/`.

The fixture can come straight from `buildComparatorBlock` with `dates[n-1] = "garbage"`, as in `figure-malformed-dates.test.ts:174-182`.

---

_Reviewed: 2026-11-08T07:57:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
