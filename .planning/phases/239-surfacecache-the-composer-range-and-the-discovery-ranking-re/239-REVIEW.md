---
phase: 239-surfacecache-the-composer-range-and-the-discovery-ranking-re
reviewed: 2026-11-24T21:45:00Z
depth: deep
round: 3
files_reviewed: 14
files_reviewed_list:
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.window.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx
  - src/app/factsheet/[id]/v2/factsheet-context.tsx
  - src/app/factsheet/[id]/v2/range-dates.test.ts
  - src/app/factsheet/[id]/v2/range-dates.ts
  - src/components/strategy/StrategyTable.native-unit-ranking.test.tsx
  - src/lib/dateday.test.ts
  - src/lib/dateday.ts
  - src/lib/queries.native-unit-ranking.test.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
  necessity: 0
status: clean
---

# Phase 239: Code Review Report (round 1)

**Reviewed:** 2026-11-24T21:10:00Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Scope: `git diff origin/main...HEAD -- . ':!.planning'` on `gsd/phase-239-surfacecache`, 13 files. I read them against
`239-CONTEXT.md`, which holds the founder rulings Q1, Q2, Q4 and Q5, and against the `### Phase 239` ROADMAP entry with its
2026-11-24 corrections.

Verdict: **no CRITICAL or HIGH, one MEDIUM.** The MEDIUM is a Rule 9 / SC-2 test-intent gap: the CACHE-04 percentile pin cannot fail
for the "separate group" behaviour the founder ruled out. It is not user-facing and not a data-integrity defect in shipped code.

**CACHE-02, traced end to end.** The provider holds a `StoredRange`. A manual range is held as its two dates; a preset is held as a
month count. `useXRange` resolves the stored range on the ACTIVE basis axis, which `BasisProvider` publishes through `ActiveBasisContext`.
I checked these points:

- Every `useXRange` consumer that indexes a non-cash axis (`MasterBrush`, `TimeSeriesChart`, `useWindowedView`,
  `FactsheetView`'s chart section, `HistogramChart`) mounts under `BasisProvider` inside `FactsheetBody`.
- `PeriodControl` sits in `topSlot`, inside the `<article>` and so under `BasisProvider`.
- The USD unit view swaps the payload handed to `FactsheetProvider` (`SelectedPayloadProvider`), so the resolve axis and the drawn
  axis stay one axis.
- The basis-change and unit-change `resetXRange` effects are intact, and so are the `setXRange` clamps.
- `basisAxisDates` mirrors Layer 1 of `useBasisSeriesView`, and `basis-context.active-axis.test.tsx` pins that by value.
- No effect depends on `setXRange` identity, whose dependency list now includes `axis`.

SC-1 holds, and growth at both the front and the back is tested at the provider and composer levels. Both kinds of test fail on the
pre-fix index store: the old 12M preset was the indices `[247, 499]`, and those point at different days after either growth.

**CACHE-04.** `queries.ts` and `StrategyTable.tsx` are untouched. The table arms do bite: a unit-partitioned sort puts the BTC row at #3
in "a BTC row between two USD rows is #2". The percentile arm is weaker (WR-01).

**Gates I ran at the branch head** (all green):

- the 7 phase test files: 90 tests;
- `vitest run src/app/factsheet widgets/performance`: 162 files, 2296 tests;
- every `src/__tests__`, `scripts` or `tests` file that references the touched symbols, including
  `phase-52-frozen-spine-guards.test.ts`: 6 files, 206 tests;
- `tsc --noEmit`: clean;
- eslint on the 5 changed source files: clean.

**Phase-goal check.**

- SC-1: met.
- SC-2, as corrected: met. The table test uses one BTC row and one USD row, and the shaping test pins "no conversion". The
  population half is weaker than it claims (WR-01).
- SC-3: PROOF-01 runs are recorded verbatim in all three SUMMARYs. The `q-partition` neuter drops the BTC row instead of putting it in
  its own cohort, which is why WR-01 was not caught.
- `getOwnRowPercentiles`, which CONTEXT names beside `getPercentiles` as part of the cohort, has no arm (folded into WR-01).

The necessity rubric (`necessity-review.md`) was read. One necessity item is recorded (IN-01).

## Warnings

### WR-01: [MEDIUM] The CACHE-04 percentile pin cannot fail for a per-unit "separate group" cohort

**File:** `src/lib/queries.native-unit-ranking.test.ts:88-107`
**User-facing / data-integrity:** neither in shipped code. This is a test-intent gap (Rule 9) on the SC-2 gate for a ranking surface.

**Issue:** The arm "a BTC row is scored in the same population as the USD rows" puts the BTC row at the top of both metrics (cagr 0.9,
cumulative_return 3.2). It then asserts only `btc-1 === 100` and that all six ids are present.

`scoreAgainstPopulation` (`src/lib/percentile-core.ts:176-177`) scores `countLessOrEqual / n * 100`. Suppose a regression scores each
unit group within itself, the "separate group" that CONTEXT Q2 and the ROADMAP correction rule out. That could be
`scoreAgainstPopulation(btcRows, btcRows)` merged with `scoreAgainstPopulation(usdRows, usdRows)`, or the same split inside the loop.
Then:

- the BTC singleton scores 1/1, which is **100**;
- all six ids are still present;
- the test stays GREEN.

The recorded `q-partition` neuter (239-03-SUMMARY) only DROPS native-unit rows from the population, which is the one partition shape
this arm can see. A BTC→USD conversion that raises the BTC figure, for example in a BTC bull year, also leaves it at 100.

So the pin encodes "the BTC row is not dropped", not "one population". CONTEXT also names `getOwnRowPercentiles` as part of the cohort
that must stay unpartitioned. It has no arm, and it builds its population in a separate loop (`src/lib/queries.ts`, the
`populationRows` loop in `getOwnRowPercentiles`).

**Concrete failure scenario:** A future change ships "rank BTC strategies among BTC strategies". Every CACHE-04 pin stays green, and
Discovery percentiles stop comparing BTC-unit and USD returns side by side, which contradicts the founder ruling.

**Fix (minimal, test-only):** add an assertion whose value differs between one population and a per-unit cohort. With the current
fixture, a USD row's rank works, because the BTC row sits in its denominator only in one population:

```ts
// One population of six: 5 of 6 values <= 0.5, so 83. A USD-only cohort of five would give 100.
expect(ranks["usd-5"].cagr).toBe(83);
expect(ranks["usd-5"].cumulative_return).toBe(83);
```

Alternatively, move the BTC row mid-pack (cagr 0.25 gives 50 in one population and 100 as a singleton). Add one
`getOwnRowPercentiles` arm with the same discriminating assertion, for a BTC own row scored against USD published rows. Record a
PROOF-01 run with a neuter that scores per unit, not one that drops the row.

## Info

These are LOW and INFO items. Under the repo rule they are recorded here only, not in TODOS.md.

### IN-01: [LOW] `PeriodControl` turns a preset click into a reset on an axis of one point or less

**File:** `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx:152`
**Category:** necessity (already defended elsewhere)
**User-facing:** yes, minor.

The `axisLength <= 1` guard existed so the old code never computed an index window on a one-point axis. The preset is now stored
intent, and the resolver already handles that axis. `range-dates.test.ts` "a one-point axis gives [0, 0]" proves it.

So the guard only does harm: a 12M click made before the composer's lazy returns land (the 201.1 scenario this phase exists for) is
silently turned into ALL. When the series lands, the user sees full history, and no tab shows a selected state to reveal it. The
behaviour is pre-existing, not a regression.

**Fix:** guard only `period === "ALL"`, so `setPresetRange` runs on any axis.

### IN-02: [LOW] An inclusive preset boundary compounds 12 months plus one day of returns

**File:** `src/app/factsheet/[id]/v2/range-dates.ts:80-83`

`lowerBound(axis, latest − N months)` includes the return dated on the boundary day. `windowView` then compounds
`strategyReturns[s..e]`, so 12M over daily data covers 366 returns, not the 365 of a conventional
`equity(t) / equity(t − 12M) − 1`.

This follows the founder's literal wording ("latest date minus N calendar months to the latest date"). It matches the old 253-point
window, and the eyebrow names the exact dates, so label and figures agree. It is recorded in case "12M" is ever compared with a trailing
12M figure computed elsewhere.

### IN-03: [LOW] Month-end anchoring

**File:** `src/lib/dateday.ts:106-116`

With a latest day of 28 Feb, 1M starts on 28 Jan, not 31 Jan or 1 Feb. The clamp-down rule is tested, but there is no rule for a
month-END latest day. The effect is cosmetic, a few days at the window's start.

### IN-04: [LOW] A preset skips the `MIN_VISIBLE_SAMPLES` widening

**File:** `src/app/factsheet/[id]/v2/range-dates.ts:80-83`

Suppose the latest axis day sits more than N months after the previous point, for example an isolated late day on the union axis.
Then the preset resolves to `[last, last]`: a one-point window that `windowView` withholds as `short-slice`. That is the one-day
"Selected range" class Phase 201.1 fixed. It is unlikely on daily composer data.

### IN-05: [LOW] A non-ISO latest day silently turns a preset into ALL

**File:** `src/app/factsheet/[id]/v2/range-dates.ts:82`

`subtractMonths` returns null for a non-`YYYY-MM-DD` day, for example a timestamped date. The preset then resolves to `fullRange` with
no signal. Composer dates are DB `date` strings today, so this is latent.

### IN-06: [INFO] Stale comments now contradict the code

**Files:** `src/app/factsheet/[id]/v2/factsheet-context.tsx:452-454`, `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:265`,
`src/app/factsheet/[id]/v2/FactsheetView.tsx:3015`

- The `setXRange` comment still says the provider "cannot read the active basis, but it does not need to". It now reads it through
  `ActiveBasisContext`.
- `TimeSeriesChart` says the xRange is "maintained in cash-index space". It is now resolved on the active axis.
- `FactsheetView` says `factsheet-context.tsx` "is never edited".

### IN-07: [LOW] A drag in progress keeps stale start indices across front growth

**Files:** `src/app/factsheet/[id]/v2/MasterBrush.tsx` (`dragRef.startRange`), `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`
(`panRef.startRange`)

If the series grows at the front during a drag, the next move writes `startRange + d` in the OLD index space, so the dates jump by the
growth amount. The effect is transient and needs a drag at the same moment as the series grows.

### IN-08: [LOW] A manual range whose start falls off a shrunk front now resets to full history

**File:** `src/app/factsheet/[id]/v2/range-dates.ts:85`

Under the strict off-axis rule, a composer edit that moves the axis start later than a manual range's start shows the full history.
The old code kept the indices, so it showed shifted dates instead. This is the documented CONTEXT fallback, and is listed so the
behaviour change is on record.

---

_Reviewed: 2026-11-24T21:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunter (round 1, run in parallel)

Two MEDIUM, no CRITICAL or HIGH.

### SFH-M1: [MEDIUM, dismissed] A manual range resets to full history when the basis is switched
`range-dates.ts` `resolveStoredRange` returns `fullRange` for a manual range off the new basis axis. **Disposition: not a defect of this phase.** `FactsheetView.tsx` resets the visible range on every actual basis toggle and every unit-view toggle (Phase 103 MTM-04, UI-SPEC A), before and after this phase, so a range is never carried across a basis switch. The founder ruling "a manual range keeps its dates" (CONTEXT Q4) is about the series growing, not about a basis change. No fix.

### SFH-M2: [MEDIUM, fixed in round 1] The fallback is cash-sized on a longer basis axis
Every `resolveStoredRange` fallback returns the provider's cash-sized `fullRange`, even though the range now resolves on the active basis axis. On an MTM or smoothed axis longer than cash, the fallback (no range set, an off-axis or inverted range, an invalid preset boundary) shows a window that drops the axis's most recent days while it reads as full history. Routed to the round-1 fixer: the fallback becomes the full range of the axis being resolved.

### SFH LOW / INFO (recorded only)
- LOW: `setXRange` drops the write silently when the active axis is empty (transient).
- LOW: `setXRange` clamps to the longest axis but looks up dates on the active axis, so two indices past the active axis store a one-day range.
- LOW: a non-ISO latest day makes a preset resolve to full history (same as IN-05).
- LOW: presets and manual ranges are not widened to `MIN_VISIBLE_SAMPLES` on resolve (same as IN-04).
- INFO: the range is never persisted, so there is no codec mismatch.
- INFO: the period tabs keep `aria-selected={false}` (pre-existing, deliberate).
- INFO: the CACHE-04 tests pin existing behaviour; see WR-01 for the cohort gap.
- INFO: `basisAxisDates` matches Layer 1 of `useBasisSeriesView`; pinned by value.

## Round 1 disposition

- WR-01 (MEDIUM, phase-goal gap against SC-2 as corrected: the pin must encode "no separate group"): sent to the fixer.
- SFH-M2 (MEDIUM, user-facing): sent to the fixer.
- SFH-M1: dismissed, reason above.
- Every LOW and INFO is recorded here only and not fixed.


## Round 1 fixes

Applied by the round-1 fixer on 2026-11-24. Two commits on `gsd/phase-239-surfacecache`, not pushed.

| Finding | Commit | Files |
|---|---|---|
| WR-01 | `fa6f2c24a` `test(239): WR-01 ...` | `src/lib/queries.native-unit-ranking.test.ts` |
| SFH-M2 | `ad0b7f599` `fix(239): SFH-M2 ...` | `src/app/factsheet/[id]/v2/factsheet-context.tsx`, `src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx` |

### WR-01: what changed

The percentile arm now also asserts `usd-5` is 83 on both metrics (one population of six). A new arm calls
`getOwnRowPercentiles` with an unpublished mid-pack BTC own row (cagr 0.25, cumulative_return 0.5) against the six published
rows and asserts 43 (3 of 7). Discriminating values: a BTC-only cohort or a USD-only population both give 50 for the own row,
and a USD-only cohort of five gives 100 for `usd-5`.

### WR-01 PROOF-01

Neuter: `src/lib/queries.ts` byte-backed-up to `scratchpad/queries.ts.wr01.orig`, then `getPercentiles` and the `getOwnRowPercentiles`
`ownMap` were changed to score BTC and USD rows each within their own group (a per-unit cohort, NOT a dropped row). The old
arm's assertions (`btc-1 === 100`) stay green under this neuter, which is the review's point. RED, verbatim:

```
 RUN  v5.0.5 $REPO

 ❯ |jsdom| src/lib/queries.native-unit-ranking.test.ts (3 tests | 2 failed) 12ms
   ❯ Discovery percentiles — one population (CACHE-04) (2)
     × a BTC row is scored in the same population as the USD rows 6ms
     × an own BTC row is scored against the USD and BTC published rows together 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |jsdom| src/lib/queries.native-unit-ranking.test.ts > Discovery percentiles — one population (CACHE-04) > a BTC row is scored in the same population as the USD rows
AssertionError: expected 100 to be 83 // Object.is equality

- Expected
+ Received

- 83
+ 100

 ❯ src/lib/queries.native-unit-ranking.test.ts:110:33
    108|     // A USD-only cohort of five would give 100, so this fails when th…
    109|     // its own group or dropped, not only when it is missing.
    110|     expect(ranks["usd-5"].cagr).toBe(83);
       |                                 ^
    111|     expect(ranks["usd-5"].cumulative_return).toBe(83);
    112|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  |jsdom| src/lib/queries.native-unit-ranking.test.ts > Discovery percentiles — one population (CACHE-04) > an own BTC row is scored against the USD and BTC published rows together
AssertionError: expected 50 to be 43 // Object.is equality

- Expected
+ Received

- 43
+ 50

 ❯ src/lib/queries.native-unit-ranking.test.ts:130:44
    128|     const result = await getOwnRowPercentiles([{ id: "own-btc", analyt…
    129|     expect(result).not.toBeNull();
    130|     expect(result!.ownMap["own-btc"].cagr).toBe(43);
       |                                            ^
    131|     expect(result!.ownMap["own-btc"].cumulative_return).toBe(43);
    132|     // The published map is the one population too: usd-5 is 5 of 6.

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  21:04:32
   Duration  999ms (environment 53%, transform 16%, setup 15%, import 15%, tests 1%)
```

Restore by `cp` from the backup, then `cmp`:

```
cmp scratchpad/queries.ts.wr01.orig src/lib/queries.ts
cmp exit 0
```

GREEN, verbatim (`git status` showed only the test file modified, so `queries.ts` is byte-identical to the commit):

```
 RUN  v5.0.5 $REPO


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  21:04:40
   Duration  920ms (environment 58%, import 16%, setup 16%, transform 9%, tests 1%)
```

### SFH-M2: what changed

`useXRange` now passes `[0, max(0, axis.length - 1)]` (memoised on `axis.length`) of the axis it resolves on as the fallback to
`resolveStoredRange`. Under cash the axis is `payload.dates`, so the value equals the old cash `fullRange`. `resetXRange` is
unchanged (it clears the stored range, so the fallback applies). The provider's `fullRange` memo and store field had no reader
left and were removed, with the two comments that said it "stays cash-sized". No existing test pinned a cash-sized window under a
longer basis axis (the 162-file factsheet and performance run is green with no test edited). New test: an MTM axis of 150 days over
a 100-day cash axis resolves to `0..149` with no range set, and again after a stored manual range falls off a later-starting axis.

### SFH-M2 PROOF-01

Pre-fix `factsheet-context.tsx` byte copy (`scratchpad/factsheet-context.tsx.prefix.orig`) put back in place with the new test.
RED, verbatim:

```
 RUN  v5.0.5 $REPO

 ❯ |jsdom| src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx (6 tests | 1 failed) 231ms
   ❯ the fallback range is the full range of the ACTIVE axis, not the cash axis (1)
     × an MTM axis longer than cash resolves to the full MTM axis with no range set, and when a manual range falls off the axis 29ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |jsdom| src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx > the fallback range is the full range of the ACTIVE axis, not the cash axis > an MTM axis longer than cash resolves to the full MTM axis with no range set, and when a manual range falls off the axis
AssertionError: expected '0..99' to be '0..149' // Object.is equality

Expected: "0..149"
Received: "0..99"

 ❯ src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx:186:53
    184|     // No range set: the whole MTM axis (150 days), not the cash-sized…
    185|     // drop the 50 most recent MTM days while reading as full history.
    186|     expect(screen.getByTestId("range").textContent).toBe(`0..${MTM_LEN…
       |                                                     ^
    187|
    188|     act(() => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
   Start at  21:05:53
   Duration  1.07s (environment 46%, tests 27%, setup 13%, import 8%, transform 5%)
```

Fixed file restored by `cp` from `scratchpad/factsheet-context.tsx.fixed`, then `cmp`:

```
cmp scratchpad/factsheet-context.tsx.fixed src/app/factsheet/[id]/v2/factsheet-context.tsx
cmp exit 0
```

GREEN, verbatim:

```
 RUN  v5.0.5 $REPO


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  21:05:55
   Duration  1.06s (environment 45%, tests 27%, setup 12%, transform 8%, import 8%)
```

Only the first assertion (no range set) was observed failing on the pre-fix copy, because it throws before the off-axis step runs.
The off-axis step is covered by the GREEN run only.

### Gates

- 8 phase test files (the 7 listed plus `ScenarioFactsheetChart.period-presets.test.tsx`): 8 files, 95 tests passed.
- `vitest run src/app/factsheet widgets/performance`: 162 files, 2297 tests passed.
- `ScenarioComposer.d11`, `AllocationDashboardV2.warmup` and `src/app/api/og/factsheet`: 9 files, 123 tests passed.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0, 0 errors, 4 pre-existing warnings in files this round did not touch.

### Noted, not changed

`basis-context.tsx` `resolveRangeScope`'s doc comment still says "`fullRange` is cash-sized". The rule it documents still holds
(the new fallback ends at the view's last index, which is at or past `min(cash end, view end)`), so only the parenthetical is stale.
Left alone as out of scope for this round.


## Round 2 review

**Reviewed:** 2026-11-24T21:25:00Z, at branch head `ad0b7f599`, depth deep.
**Scope:** the round-1 fixer diff `434f3d33b..HEAD` (excluding `.planning`), then the full phase diff `origin/main...HEAD`
(excluding `.planning`) again, plus every consumer of `useXRange` and of `resolveRangeScope`.
**Verdict:** both round-1 fixes hold, and neither introduced a MEDIUM+ regression. One MEDIUM remains: WR-02, which is
user-facing. It predates this phase and sits outside the phase diff. SFH-M2 is what made its premise false. Status stays
`issues_found` so the caller can decide whether to fix it here or route it.

### (a) Are the round-1 fixes real?

**WR-01: fixed, and the test can fail.** `scoreAgainstPopulation` (`src/lib/percentile-core.ts:176-177`) scores
`count(x <= v) / n * 100`, adding the subject to its own denominator only when it is not a member. Checked by hand:

- `getPercentiles`, `usd-5`: one population of six gives 5/6 = **83**. A USD-only cohort of five gives 5/5 = 100. A per-unit
  split that merges both groups also gives 100.
- `getOwnRowPercentiles`, `own-btc` (cagr 0.25, cumulative_return 0.5): one population of seven gives 3/7 = **43**. A BTC-only
  cohort gives 1/2 = 50, and USD-only plus the own row gives 3/6 = 50.

Every per-unit shape gives a different number from one population, so the pin now encodes "one population" and not just
"the BTC row is not dropped". The recorded PROOF-01 neuter scores per unit and does not drop the row. That is the right
neuter, and its RED output shows both new assertions failing.

**SFH-M2: fixed, and the test encodes intent.** `useXRange` now falls back to `[0, axis.length - 1]` of
`basisAxisDates(payload, basis)`, which is the same axis it resolves on. Under cash the value equals the old `fullRange`.
`resetXRange` clears the store, so the fallback applies after a reset. The provider-level `fullRange` had no other reader, so
removing it is safe. The new test (`basis-context.active-axis.test.tsx`, "the fallback range is the full range of the ACTIVE
axis") is discriminating in both steps: a cash-sized fallback gives `0..99` where `0..149` is expected. Round 1 recorded the
first step going RED on the pre-fix copy (see IN-10 for the second step).

### (b) Did the fixes regress any consumer that compared `xRange` to a cash-sized range?

Callers checked, with what each one does:

| Consumer | What it does with `xRange` | Result after SFH-M2 |
|---|---|---|
| `resolveRangeScope` (`basis-context.tsx:553`) | `fullEnd = min(cashLen, viewLen) - 1`. A range with `s === 0 && e >= fullEnd` is full. | The default `[0, viewLen-1]` is full on every axis, shorter or longer than cash. No regression. See WR-02 for the pre-existing band above `cashLen - 1`. |
| `useWindowedView` (`basis-context.tsx:715-728`) | Takes `useDeferredValue(xRange)` and passes it to `resolveRangeScope` against the immediate `base`. | No regression once the value settles. It adds a one-render transient (IN-09). |
| `FactsheetView.tsx:1046` (`zoomed`, sets `railAvgWithheld`) | Calls `resolveRangeScope` with the LIVE range. | Full at default on every axis. |
| `TimeSeriesChart.tsx:282-285` | Clamps with `Math.min(xRange[i], view.dates.length - 1)`. | The default now fills the plot on a longer axis, so the FIX E "MTM tail briefly off-plot" frame is gone. |
| `TimeSeriesChart.tsx:919-924` (`ExportMenu`) | Indexes `view.dates` with the clamped `[xStart, xEnd]`. | Safe. |
| `MasterBrush.tsx:129-131` | Sets `n = view.dates.length` and positions the window with `idxToX(xs)` and `idxToX(xe)`. | The default window now spans the whole sparkline on a longer axis, where it used to stop at the cash length. |
| `HistogramChart.tsx:77-115` | Loops `i` over `[xStart, xEnd]` with `Number.isFinite` guards. The effect is keyed on the numbers, not on array identity. | Safe. |
| `MetricsColumn.tsx:1242` and `FactsheetView.tsx:2965, 3015-3031, 3091` | Call `resetXRange` only. | Unchanged. |
| `ScenarioFactsheetChart.tsx` (composer) | Calls `setPresetRange` and `resetXRange`. | The synth payload is csv with no `seriesByBasis`, so the axis is always cash. Byte-identical. |
| OG and factsheet API routes | Neither route imports the provider or the range (grep). Only their `route.*.test.tsx` mount `FactsheetProvider`, on cash. | Unaffected. 7 files, 90 tests green. |

Gates I ran at `ad0b7f599`, all green:

- `vitest run src/app/factsheet "src/app/(dashboard)/allocations/widgets/performance"` plus the 3 CACHE-04 and `dateday` test files
  and `phase-52-frozen-spine-guards.test.ts`: 166 files, 2342 tests.
- `vitest run src/app/api/og/factsheet`: 7 files, 90 tests.

I did not run a neuter of my own: this review is read-only. My verdict on (a) rests on round 1's recorded RED runs plus the
arithmetic above.

### Warnings

#### WR-02: [MEDIUM, pre-existing, user-facing] On a basis axis longer than cash, a range from day 0 that ends in `[cashLen-1, viewLen-2]` reads "Full history" with full-history figures

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:562-565`. The same rule decides `zoomed` at
`src/app/factsheet/[id]/v2/FactsheetView.tsx:1046`.
**User-facing / data-integrity:** user-facing. The KPI strip and rail put a "Full history: <first> – <last>" label on the
unwindowed whole-record figures, while the chart and the brush show a narrower window.
**Provenance:** the rule is byte-identical on `origin/main` (Phase 169.1, D-27 and W3). `ad0b7f599` did not touch it, so this is
**not** a fixer regression. Its only stated premise was "the initial and reset range (`fullRange` is cash-sized)". SFH-M2
removed that premise, so all the `cashLen` term does now is mislabel manual selections.

**Scenario:** a strategy whose `mark_to_market` or `smoothed_mtm` axis is longer than its cash axis. These are real: the two
bundles are built from their own persisted series with their own axes (`src/lib/factsheet/build-payload.ts:954-1055`, no clip
to cash). The `setXRange` clamp was widened in Phase 103 ("the reported harm") and Phase 133 ("the flagship options case")
precisely because these axes exist. Take cash = 300 days and smoothed = 1000 days:

1. The user selects smoothed and gets the new default `[0, 999]`, which is full and correct.
2. The user drags the brush's right handle left to index 600.
3. `resolveRangeScope([0, 600], 300, view1000)`: `fullEnd = min(300, 1000) - 1 = 299` and `600 >= 299`, so the scope is
   `kind: "full"`.
4. `useWindowedView` returns the unwindowed `base`. The strip and rail read "Full history" with whole-record figures, while the
   chart and brush show days 0 to 600. `zoomed` is false, so `railAvgWithheld` also follows the full-history arm.

Every right-edge trim that stays at or above index 299 (70% of the axis in this example) is mislabelled. On `origin/main` the
same band was reached by extending the handle from the old cash-sized default instead, so how often it is hit is roughly the
same as before. What changed is that nothing needs the `cashLen` term any more.

**Minimal fix:** in `resolveRangeScope`, decide full history on the view's own axis:

```ts
const fullEnd = last; // was Math.min(cashLen, viewLen) - 1
```

Two things travel with this change:

- Update the 169.1 arm that pins the old premise: `basis-context.window.test.tsx:92`, "[0, cashLen-1] is full ... under a
  longer MTM axis". Replace it with an arm that pins a range ending one day short of a longer view's end as `selected`. Keep
  "[0, viewLen-1] is full" (`:106`) and the W3 arm (`:335`). Both still pass, because the default is now `[0, viewLen-1]`.
- The `min()` currently absorbs the deferred-range frame on a cash-to-longer toggle (the deferred `[0, cashLen-1]` reads as
  full). With `fullEnd = last`, that frame becomes the same one-render transient IN-09 describes. The cure for both is in
  IN-09's fix. If it is not applied, the trade is one transient frame against a mislabel that persists.

If the caller judges this out of scope for 239 (it is not in the phase diff), route it under the existing rule for a
user-facing MEDIUM. Do not drop it.

### Info (recorded only, not fixed)

#### IN-09: [LOW] SFH-M2 consequence: leaving a SHORTER axis shows one render of "Selected range"

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:717-721`

Before SFH-M2 the default range was the same array on every basis. It now follows the axis length, while `useWindowedView`
reads it through `useDeferredValue` against an immediate `base`. `setBasis` (`FactsheetView.tsx:3215`) is not wrapped in a
transition.

Scenario: mark_to_market (60 days) to cash (100 days) with no range set, the common direction because MTM is usually no longer
than cash. On the urgent render the deferred value is `[0, 59]` against the 100-day cash view. `fullEnd` is 99, so the scope
is "selected". For one render the strip shows "Selected range: d0 – d59" with figures windowed to `[0, 59]`, and then the
deferred render settles to full. The same happens for any toggle onto an axis longer than the one being left, whenever both
lengths differ from the cash length. The transient does not survive the deferred commit, so it is LOW.

**Fix (optional):** defer the range together with the axis it was resolved on. In `useWindowedView`, defer
`{ range, basis }` as one value and treat the scope as full while the deferred basis differs from the current one (the reset
effect clears any stored range on that toggle anyway).

#### IN-10: [LOW] The off-axis step of the SFH-M2 test was never observed RED

`basis-context.active-axis.test.tsx`: round 1 says so itself. The first assertion throws before the off-axis step runs on the
pre-fix copy. The step shares the single fallback argument with the first assertion, and a cash fallback would give `0..99`
there too, so it is sound by construction. No action needed.

#### IN-11: [INFO] Comments that still describe a cash-sized default

- `basis-context.tsx:545-547`: the `resolveRangeScope` doc says "`fullRange` is cash-sized". The fixer noted this and left it.
  It goes away with WR-02's fix.
- `TimeSeriesChart.tsx:265-281`: the T-103-08 and FIX E comments say the range is "maintained in cash-index space" and that the
  MTM tail is "briefly off-plot". Neither is true now (this extends round 1's IN-06).
- `src/__tests__/phase-52-frozen-spine-guards.test.ts:219`: "`fullRange` stays cash-sized". This is a comment in a guard file,
  with no assertion behind it.

### Round 2 disposition

| Item | Verdict |
|---|---|
| WR-01 | Closed. The pin discriminates, and the recorded PROOF-01 is RED under a per-unit neuter. |
| SFH-M2 | Closed. No consumer regressed. |
| WR-02 | MEDIUM, user-facing, pre-existing and outside the phase diff. Needs the caller's call: fix it here (a one-line rule change plus one test arm) or route it. |
| IN-09 to IN-11 | Recorded here only. |
| New MEDIUM+ in the full phase diff | None besides WR-02. I re-read `range-dates.ts`, `dateday.ts` `subtractMonths`, the `useXRange` and `setXRange` changes, `ScenarioFactsheetChart.tsx`, and the `ActiveBasisContext` publication in `BasisProvider`. `BasisProvider` publishes the same immediate `basis` state that `useBasisSeriesView` reads, so the resolve axis and the drawn axis never come from different renders. |

_Reviewed: 2026-11-24T21:25:00Z_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: deep_

## Round 2 fixes

**Fixed at:** 2026-11-24, commit `70d75b85d49fdd849e14d97f6d7b6a331706f8c5` (`fix(239): WR-02 ...`).

### WR-02: fixed

**Files modified:** `src/app/factsheet/[id]/v2/basis-context.tsx`, `src/app/factsheet/[id]/v2/basis-context.window.test.tsx`
**Applied fix:** `resolveRangeScope` now treats a range as full only when it starts at 0 and ends at or past the VIEW's last index
(`e >= last`), replacing `fullEnd = Math.min(cashLen, viewLen) - 1`. Identical under cash and under a shorter axis; only a longer
axis changes. The doc comment states the new reason (the default/reset range is the active axis's full range since Phase 239).
The `cashLen` parameter is kept as `_cashLen` (unused) so the three callers and the PROOF-01 pre-fix copy share one signature.
The old pin ("[0, cashLen-1] is full under cash, under a longer MTM axis and under a shorter one") is replaced by two: `[0, viewLen-1]` is
full under cash/longer/shorter axes and names the view's first and last dates (W3), and on a 360-day axis `[0, cashLen-1]` reads
`selected` with `endIdx` 299 and `n` 300.
Status: fixed: requires human verification (logic rule change).

**PROOF-01.** Pre-fix byte copy of `basis-context.tsx` kept at `$SCRATCH/wr02/basis-context.tsx.prefix`; fixed copy at
`$SCRATCH/wr02/basis-context.tsx.fixed`. Steps: copy the pre-fix file over the source, run the test, restore with `cp`, `cmp`, run again.

RED, pre-fix file in place (`npx vitest run "src/app/factsheet/[id]/v2/basis-context.window.test.tsx"`):

```
   ❯ resolveRangeScope — full history vs a selected range (D-27, W3) (4)
     × on a longer axis, a range from day 0 ending at the cash end but short of the view's end is selected (WR-02) 8ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |jsdom| src/app/factsheet/[id]/v2/basis-context.window.test.tsx > resolveRangeScope — full history vs a selected range (D-27, W3) > on a longer axis, a range from day 0 ending at the cash end but short of the view's end is selected (WR-02)
AssertionError: expected { kind: 'full', …(5) } to match object { kind: 'selected', …(5) }

- Expected
+ Received

  {
-   "end": "2024-10-26",
-   "endIdx": 299,
-   "kind": "selected",
-   "n": 300,
+   "end": "2024-12-25",
+   "endIdx": 359,
+   "kind": "full",
+   "n": 360,
    "start": "2024-01-01",
    "startIdx": 0,
  }

 ❯ src/app/factsheet/[id]/v2/basis-context.window.test.tsx:113:15
    111|     const view = datesView(360);
    112|     const s = resolveRangeScope([0, cashLen - 1], cashLen, view);
    113|     expect(s).toMatchObject({ kind: "selected", start: view.dates[0], …
       |               ^
    114|   });
    115|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
   Start at  21:24:04
   Duration  3.47s (tests 58%, environment 29%, setup 7%, transform 3%, import 3%)
```

Restore: `cp $SCRATCH/wr02/basis-context.tsx.fixed "src/app/factsheet/[id]/v2/basis-context.tsx"`, then `cmp` of the two: `cmp exit 0`.

GREEN, fixed file restored (same command):

```
 RUN  v5.0.5 $REPO


 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  21:24:13
   Duration  3.08s (tests 62%, environment 27%, setup 5%, transform 3%, import 3%)
```

**Gates at the fix commit.** `tsc --noEmit`: exit 0. `npm run lint`: exit 0, 0 errors, 4 pre-existing warnings (none in the changed files).
`vitest run src/app/factsheet "src/app/(dashboard)/allocations/widgets/performance" src/app/api/og/factsheet
src/lib/queries.native-unit-ranking.test.ts src/components/strategy/StrategyTable.native-unit-ranking.test.tsx src/lib/dateday.test.ts
src/__tests__/figure-gate-census.test.ts src/__tests__/phase-52-frozen-spine-guards.test.ts`: 172 of 174 files passed on the first run,
2440 of 2442 tests. The two failures were 5000 ms timeouts (`FactsheetView.kpistrip.test.tsx`, `FactsheetView.window-kpis.test.tsx`)
while `tsc` ran in parallel; both files re-run alone: 2 files, 78 tests, all green. `figure-gate-census.test.ts` is the only
`src/__tests__` file that names `basis-context`, and it passed.

## Round 3 review

**Reviewed:** 2026-11-24T21:45:00Z (local +02:00 time with a `Z`, the same convention as the earlier stamps in this file), at branch
head `70d75b85d`, depth deep.
**Scope:** the round-2 fixer commit `70d75b85d`, every caller of `resolveRangeScope` and `useWindowedView`, then the full phase
diff `origin/main...HEAD` (excluding `.planning`) again. That diff has 14 files. The frontmatter list now includes
`basis-context.window.test.tsx`, which round 2 changed and which was missing from the list.
**Verdict:** **no MEDIUM or higher.** WR-02 is fixed, and its pin encodes the intent. The fix regresses none of the callers. It does
make IN-09's one-render transient reachable in one more direction, on a cash-to-longer-axis toggle with no range set. I measured
that transient: it is one committed render, nothing holds onto it, and it is LOW (IN-12). Status: `clean`.

### (a) WR-02: fixed, and the test encodes intent

`resolveRangeScope` (`src/app/factsheet/[id]/v2/basis-context.tsx:555-568`) now treats a range as full only when `s === 0 && e >= last`
holds on the view's own axis. Under cash and under a shorter axis it is the same as before: for `viewLen <= cashLen`, `min(cashLen,
viewLen) - 1` already equalled `last`. Only an axis longer than cash changes.

The new arm (`basis-context.window.test.tsx:106-114`) asserts the round-2 scenario by value: `[0, cashLen-1]` on a 360-day axis is
`selected`, with `endIdx` 299 and `n` 300. Its title and comment state why. I re-ran the RED myself rather than rely on the fixer's: in the scratch copy described in (b),
with the pre-WR-02 `min()` line put back, `basis-context.window.test.tsx` gave `1 failed | 12 passed (13)`, and the one failure
was this arm (`expected { kind: 'full', …(5) } to match object { kind: 'selected', …(5) }`). After restoring the line, `cmp`
against the worktree file exited 0 and the file gave `13 passed (13)`. The default-range half is pinned by the renamed first arm, by `:116-121`, and by the W3
arm (`:345`). That half matters because SFH-M2's fallback `[0, viewLen-1]` must still read as full on every axis. The D-03 arm
"one index short of the full history … show the reset" (`FactsheetView.window-kpis.test.tsx`) still pins `[0, last-1]` as
`selected` under cash.

### (b) Regression check across the callers

| Caller | Result |
|---|---|
| `FactsheetView.tsx:1046` `zoomed` (sets `railAvgWithheld`) | Uses the LIVE range against the immediate `useBasisSeriesView` on the same basis, so both are on one axis. The default is full, so the rail and chart average labels are unchanged. A trim on a longer axis that ends at or past the cash end now reads `zoomed`, and the rail shows the slice average. That is the intended effect of the fix. |
| `useWindowedView` (`basis-context.tsx:714-728`): KPI strip (`FactsheetView.tsx:2118`), metrics rail (`MetricsColumn.tsx:323`), rolling summary (`:1529`, `:1622`), Calmar-by-year note (`AnalyticalPanels.tsx:294`, `:402`) | Correct once the deferred value settles. The transient is measured below (IN-12, IN-13). |
| Pins on a cash-sized "full" reset | grep for `cash-sized`, `cashLen - 1` and `fullEnd` across `src`, `scripts` and `tests` finds none left that asserts a cash-sized range is full on a longer axis. `MasterBrush.basis.test.tsx:193` pins the cash clamp under CASH, where nothing changed. `phase-52-frozen-spine-guards.test.ts:219` only has a stale comment (IN-11). |
| 169.x D-27 / W3 / T-169-44 | The W3 arm passes. A full scope still names the view's first and last dates. The T-169-44 crafted-range clamp (`:133`) passes. A fixed-string search for `?range` in non-test `src` hits only this doc comment (`basis-context.tsx:553`), and no `searchParams.get("range")` exists. The range is session-local and never persisted (`factsheet-context.tsx:32`), so the clamp only bounds in-app writes. |
| Share and OG routes | Neither imports the provider or the range (round 2's grep, re-checked). `src/app/api/og/factsheet` is green. |
| Composer (`ScenarioFactsheetChart.tsx`) | The synth payload is csv with no `seriesByBasis`, so its axis is always cash, where the rule is unchanged. |

**IN-09 transient, measured.** I exported `HEAD` to a scratch directory with `git archive`. A `diff -rq` of its `src` against the
worktree's was empty. In that copy I ran two probe tests over `FactsheetProvider` and `BasisProvider`, with a 100-day cash axis plus a 150-day or 60-day
MTM bundle. Probe 1 (no range set) logs every render only. Probe 2 (a manual range set before the toggle) also logs every DOM
commit via `useLayoutEffect` and mirrors `FactsheetView`'s reset-on-basis-change effect. I ran both under the fixed rule and the
pre-WR-02 `min()` rule. Excerpts:

```
# probe 1: no range set, cash -> 150-day MTM, FIXED rule
render mark_to_market live=0..149 scope=selected:0-99 viewLen=100 label=2031-01-01..2031-04-10
render mark_to_market live=0..149 scope=full:0-149 viewLen=150 label=2031-01-01..2031-05-30
# same toggle, pre-WR-02 min() rule
render mark_to_market live=0..149 scope=full:0-149 viewLen=150 label=2031-01-01..2031-05-30
render mark_to_market live=0..149 scope=full:0-149 viewLen=150 label=2031-01-01..2031-05-30
# probe 2: manual [10,40] set, cash -> MTM (both rules, byte-identical logs: `diff` empty)
COMMIT mark_to_market live=10..43 scope=selected:10-40 viewLen=31
reset effect
COMMIT mark_to_market live=0..149 scope=selected:10-40 viewLen=31
COMMIT mark_to_market live=0..149 scope=full:0-149 viewLen=150
```

The probe was deleted afterwards and no worktree file was touched. The worktree `git status` shows only the untracked
`239-REVIEW.md`.

**Severity judgment for IN-09 as WR-02 extends it: LOW.**

- **What a user sees.** On a cash-to-longer-axis toggle with no range set, the strip, the rail, the rolling summary and the
  Calmar note commit ONE render showing "Selected range: <first MTM day> – <MTM day at the cash length>". The figures in that render
  are windowed to the same `[0, cashLen-1]`, so label and figures agree with each other. The chart and the rail's `zoomed` gate
  read the live range and show full history. The next commit, the deferred render, settles to full with no user input.
- **It lasts one render.** In the no-range case it never survives past the deferred commit. No later render shows the wrong scope.
- **Nothing holds onto it.** `RangeEyebrow` (`MetricsColumn.tsx:1235-1260`) has no `aria-live`, and its reset button exists only for
  that commit. No effect, state or ref in `KpiStrip`, `MetricsColumn` or `AnalyticalPanels` is keyed on `scope`, `selected` or
  `withheld`. The range is never persisted (`factsheet-context.tsx:32`). The stale `windowedViewCache` entry is replaced by the next
  window.
- **The manual-range case predates WR-02.** With a manual range set before the toggle, the stale `selected` scope lasts
  two commits (the toggle commit, then the reset-effect commit). That case is byte-identical under the pre-WR-02 rule, so WR-02
  did not cause it (IN-13). It was not measured on `origin/main`.

None of this is a data-integrity issue: nothing is written, and no label claims figures it does not show. It is a sub-second
flash, so it stays below the MEDIUM bar.

### (c) Remaining MEDIUM+ in the full phase diff

None. I re-read the whole diff of `factsheet-context.tsx` and `basis-context.tsx`, plus `range-dates.ts`, `dateday.ts`
`subtractMonths` and the `ScenarioFactsheetChart.tsx` preset change.

- `setXRange` stores dates of the active axis, after the three-term clamp.
- A drag to the right edge of any axis stores that axis's last date, so it resolves full.
- `ActiveBasisContext` carries the same immediate `basis` that `useBasisSeriesView` reads.
- The range is not persisted and not URL-written.

The round-1 and round-2 LOW and INFO items stand as recorded.

### Gates at `70d75b85d`

- In the scratch copy: `vitest run src/app/factsheet "src/app/(dashboard)/allocations/widgets/performance" src/app/api/og/factsheet`
  plus the CACHE-04 table and queries tests, `dateday.test.ts`, `figure-gate-census.test.ts`,
  `phase-52-frozen-spine-guards.test.ts` and `critical-regressions.test.ts`. Result: 172 of 175 files, 2616 of 2618 tests.
- The three failures:
  - `FactsheetView.kpistrip` and `FactsheetView.window-kpis`: one test each, 5.3 s and 5.8 s, over the 5000 ms timeout under the
    parallel load.
  - `phase-52-frozen-spine-guards`: failed at file level, because the scratch copy is not a git checkout.
- Re-run alone in the worktree, all three pass: 3 files, 83 tests.

### Info (recorded only, not fixed)

#### IN-12: [LOW] WR-02 extends IN-09 to a cash-to-longer-axis toggle with no range set

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:718-721`
**User-facing:** yes, for one committed render. It is new with `70d75b85d` and deterministic on every such toggle. See the
measurement in (b).

The urgent render also runs a `windowView` derive that the old rule skipped. That is a cost, not a correctness issue.

**Fix (optional, minimal):** skip the deferral when the live range already resolves full on `base`. A full scope returns `base` by
reference, so deferring it buys nothing:

```ts
const live = useXRange().xRange;
const deferred = useDeferredValue(live);
const held = useContext(RangeGestureContext)?.held;
const range = held ?? (resolveRangeScope(live, 0, base).kind === "full" ? live : deferred);
```

`held` still wins, so the MD-01 gesture rule and the Round-4 MEDIUM-2 zoom-out case are unchanged. This would also cure IN-09. The suggestion is untested.

#### IN-13: [LOW] A manual range shows a stale "Selected range" for two commits on a basis toggle (predates WR-02; not measured on `origin/main`)

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:718`, `src/app/factsheet/[id]/v2/FactsheetView.tsx:3019-3023`

The toggle commit and the reset-effect commit both read the deferred pre-toggle indices. Those indices are applied to the new
axis, so the label names MTM days at the old cash indices. The deferred commit then settles to full. The logs are identical under
both rules.

#### IN-14: [LOW] The renamed arm dropped the "over-long range on a shorter axis is full" case

**File:** `src/app/factsheet/[id]/v2/basis-context.window.test.tsx:92-104`

The old loop passed `[0, 299]` to a 240-day view, which pinned the clamp-to-`last` path. That clamp is what keeps the deferred frame
of a longer-to-shorter toggle reading as full, as the "click cash" lines of the longer probe show. No arm passes an end past a
shorter view's end with `s === 0` any more.

**Fix:** add `expect(resolveRangeScope([0, 299], 300, datesView(240)).kind).toBe("full")`.

#### IN-15: [INFO] `_cashLen` is a dead parameter, and one test title is stale

**Files:** `src/app/factsheet/[id]/v2/basis-context.tsx:557`, its callers at `FactsheetView.tsx:1046` and `basis-context.tsx:721`,
and `basis-context.window.test.tsx:123`

- All three call sites still compute `payload.dates.length` for a parameter nothing reads.
- The arm title "ending before the shorter axis end" describes the removed `min()` rule.
- This is dead code (category 3), not a necessity finding.

### Round 3 disposition

| Item | Verdict |
|---|---|
| WR-02 | Closed. Fixed, and the pin discriminates (RED recorded in round 2). |
| Callers of `resolveRangeScope` and `useWindowedView` | No regression. The 169.x D-27, W3 and T-169-44 pins and `zoomed` all hold. |
| IN-09 as extended by WR-02 | LOW (IN-12). Measured as one committed render, nothing holds onto it, and label and figures agree. |
| IN-12 to IN-15 | Recorded here only. Under the repo rule, LOW and INFO items are not booked in `TODOS.md`. |
| New MEDIUM+ | None. |

_Reviewed: 2026-11-24T21:45:00Z_
_Reviewer: Claude (gsd-code-reviewer), round 3_
_Depth: deep_

## Silent-failure hunter (rounds 2 and 3)

- Round 2 (after `fa6f2c24a`, `ad0b7f599`): no MEDIUM+. LOW only: a stale "`fullRange` is cash-sized" comment, the documented strict off-axis reset, and presets skipping the `MIN_VISIBLE_SAMPLES` widening.
- Round 3 (after `70d75b85d`): no MEDIUM+. LOW only: the one-frame deferred-range transient on a cash-to-longer basis switch (same as IN-12), the unannounced strict off-axis reset, and `setXRange` widening against the longest axis before clamping to the active one. INFO: the unused `_cashLen`, and held gesture indices across a mid-drag basis switch.

## Final disposition

Three rounds. Round 1: WR-01 and SFH-M2 fixed, SFH-M1 dismissed (the basis reset predates this phase). Round 2: WR-02 fixed. Round 3: clean. Every LOW and INFO is recorded here only.
