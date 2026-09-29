---
phase: 169-pagetruth
fixed_at: 2026-09-29T20:40:00Z
review_path: .planning/phases/169-pagetruth/169-REVIEW.md
review_paths:
  - .planning/phases/169-pagetruth/169-REVIEW.md
  - .planning/phases/169-pagetruth/169-REVIEW-SFH.md
topic: T2 (compute.ts, record-length.ts, MandatePanels.tsx, MetricsColumn.tsx, FactsheetView.tsx)
iteration: 1
findings_in_scope: 4
fixed: 2
skipped: 2
status: partial
---

# Phase 169: Code Review Fix Report, topic T2

**Fixed at:** 2026-09-29
**Source reviews:** `169-REVIEW.md` (WR-02, WR-03, WR-04, IN-03) and `169-REVIEW-SFH.md` (L-1, L-7)
**Branch:** `feat/169-fix2`, cut from `feat/169-pagetruth` at `8d9155b7a`. Every edit, test and
commit was made in the `quantalyze-169-fix2` worktree.
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (WR-02, WR-03, WR-04, IN-03). The SFH items touching T2's files are L-1
  (the same issue as IN-03) and L-7 (the same issue as WR-03). No other SFH LOW/Info names a T2 file.
- Fixed: 2 (WR-02, WR-03)
- Skipped: 2 (WR-04, IN-03). In both cases the correct fix needs a file outside T2. WR-04 was fixed,
  then reverted. The reason is below.

## Fixed Issues

### WR-02: The D-11 "cutoff + 1 day" rule hides a covered window on weekday venues

**Files modified:** `src/lib/factsheet/compute.ts`, `src/lib/factsheet/compute.metrics.test.ts`
**Commit:** `a592a3f14`
**Status:** fixed: requires human verification (it is a logic rule, and it amends D-11's letter)

**The rule chosen.** A window is covered when every UTC day strictly between its cutoff and the
record's first observation is a day the venue did not trade.
- On the **7-day basis (365)** no day is non-trading, so the rule stays exactly "cutoff + 1 day", byte
  for byte.
- On the **weekday basis (252)** these days are non-trading: Saturday, Sunday, 1 January and
  25 December (UTC).
- The basis is `periodsPerYear === 252`. This codebase only ever passes 252 or 365:
  `annualizationPeriods`, the blend rule, and `compute()`'s default of 252.

**Why this rule.** The brief had two requirements: tolerate non-trading days at the window start, and
never re-admit a window the record does not cover.
- The fixed set meets both on every venue that closes on those four days. Weekday equities and FX/CFD
  through MT5 all do.
- It covers the two persistent cases. YTD was the em-dash for the whole of a launch year that started
  on 2 January, and MTD for the whole of a January launch.
- Rejected: "at most one skipped weekday". It generalises to every single-day holiday, but it admits a
  window that is missing one session the venue did trade. That is the exact claim D-11 exists to
  prevent. The advisor first proposed it and then withdrew it for this reason.
- Rejected: an observed-holiday shift (a Monday after 1 January on a Sunday). It re-admits a missing
  session on venues that trade that Monday.

**Known limits (they fail safe, as the em-dash, and never as a false number).**
- A start just after any other holiday reads the em-dash:
  - for the rolling 3M to 5Y windows, this is transient, because the cutoff moves forward daily;
  - for MTD in a month whose 1st is an unlisted holiday (a Labor Day Monday), it lasts the whole month;
  - for YTD in a year whose 1 January falls on a Sunday and whose venue closes on Monday 2 January, it
    lasts the whole year.
- A crypto strategy misclassified as `traditional` (252) would get the weekend tolerance. That belongs
  to the existing asset-class misclassification class, and this rule does not create it.
- On the 7-day basis, a record whose first return is dated the day after inception still nulls a
  window whose cutoff is the inception date. Every day trades there, so the record really is missing a
  day. This is unchanged and deliberate.
- 6M and 1Y cutoffs on a weekday-only series (whose END is a weekday) are never a Saturday: 182 ≡ 0 and
  365 ≡ 1 (mod 7). For those two windows the change only bites through the holidays, which the tests
  use.

**Moved test lines, each justified.** The existing `it.each` boundary table in
`compute.metrics.test.ts` used consecutive calendar days, which is a 24/7 venue, but ran on the default
252 basis. Under the new rule, two of its "short" starts are covered weekday windows:
- Friday 2 Jan 2026, after the Thursday 1 January holiday.
- Monday 3 Jul 2023, after a Saturday cutoff.

The table now passes `365` explicitly, matching the venue it models. Every row, date and expected
value is unchanged. The title gains "on a 7-day venue". No snapshot moved:
`__snapshots__/build-payload.test.ts.snap` is byte-identical.

**New tests** (a 252 table, red-first):
- For each of YTD, MTD, 3M, 6M, 1Y, 3Y and 5Y, one case across a weekend or a 1 Jan / 25 Dec holiday.
  Each case checks three things:
  - a start at the first session shows the window, and the value equals an independent
    compounded-after-cutoff oracle;
  - the same dates on the 365 basis give null;
  - a start one trading day later gives null.
- A March-launched weekday record, a genuinely short record, still nulls YTD, 6M, 1Y, 3Y and 5Y.
- The Labor Day known limit is pinned as the em-dash.

**Red, then green:**
- Red-first: 7 of the new cases failed on `8d9155b7a` with `expected null not to be null`.
- The fix was then neutered four ways. Each neuter was restored byte-identical and checked with `cmp`:

  | Neuter | Tests red |
  |---|---|
  | no weekday calendar | 7 |
  | weekends only | 3 (the holiday rows) |
  | every day closed | 8 |
  | weekday calendar applied to 365 | 9 |

**For the orchestrator (deviation policy).** This changes D-11's wording ("on or before C plus one
day") for the 252 basis. D-11 is marked reversible, and the brief asked for the change. CONTEXT.md was
not edited while the sibling fixers ran. D-11 needs a dated amendment in `169-CONTEXT.md` and the
matching ROADMAP note.

### WR-03: The record length was stated from two summaries when MTM or smoothed was active (SFH L-7)

**Files modified:** `src/app/factsheet/[id]/v2/MandatePanels.tsx`,
`src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx`
**Commit:** `6bc68f933`

**Applied fix.**
- `StrategyThesisPanel` and `TermsPanel` now read `useBasisSeriesView(usePayload()).strategyMetrics`.
  That is the summary "Years Observed" and the observation warning already read.
- The change covers every `strategyMetrics` field the two panels use: the observation window years, the
  length, Observation start and end, and the live-date backtest-gap comparison. Without that, a
  sentence would state an MTM length over a cash window.
- Under cash the view is the payload by reference, so the cash page is unchanged.
- The hook goes through the shared levered-view memo that the other 23 callers use, so this adds no
  second re-derive.
- `MetricsColumn.tsx` needed no change.

**Test.**
- The case renders `MetricsColumn` under `mark_to_market`, with a 180-day MTM bundle that starts later
  than a 400-day cash record.
- It asserts that the thesis, Sample size, Years Observed and the warning all state
  "0.49 years, 180 daily observations", and that the Terms window is the MTM window.
- A cash-basis control asserts the cash length at every site.

**Red, then green.** Red-first on `8d9155b7a`: the thesis still stated the cash length. The fix was
then neutered at each site, and each neuter went red on its own assertion:
- thesis reverted to cash: the thesis assertion failed;
- Sample size reverted to cash: `'1.09 years, 400 daily observations'` was returned where
  `'0.49 years, 180 …'` was expected;
- Terms window reverted to cash: `2024-01-01` was returned where `2024-08-08` was expected.

Each neuter was restored byte-identical.

## Skipped Issues

### WR-04: The chip buckets the tone on the fractional age but prints the floored age

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1234-1241,1279`
**Reason:** the correct fix needs `src/lib/freshness.ts`, which is not a T2 file. A chip-only fix was
applied, went green, and was **reverted** (`98bb9b16b`).

**Why it was reverted.**
- The series age is judged by two bucketers:
  - `bucketByAge` in `FactsheetView.tsx`, the factsheet chip;
  - `bucketSeriesAge` in `src/lib/freshness.ts`, the discovery `SyncBadge`.
- `src/lib/freshness.two-surfaces.test.tsx` states the repo's rule: fixing one bucketer manufactures a
  new contradiction. TODOS asks for both to be changed in one commit, with a test that renders both
  surfaces from one row.
- With only the chip floored:
  - a series 3.6 days old under a fresh job read `Computed · fresh` on the factsheet while the badge
    put the row on the series arm (`warm`). That is a disagreement about the subject.
  - at 7.6 days, the two surfaces named different bands.
- That is the HONEST-08 class measured on production. The existing two-surfaces matrix stayed green
  only because it has no case on a fractional boundary.

**Ready to re-land (for whoever owns `freshness.ts`, in one commit):**
1. Cherry-pick `34edabc65` and `5cadefab7`. They carry the chip change and 5 red-first tests
   (WR04-1 to WR04-5).
   - Red-first on `8d9155b7a`: 3 of the 5 failed (7 days read "old", 3 days read "stale", and the
     boundary sweep failed).
   - With the fix: 28/28.
   - Neutered to the pre-fix shape: 3 red. Neutered to ceil: 7 red.
2. In `src/lib/freshness.ts` `bucketSeriesAge`, floor the age before the ladder:
   `const days = Math.floor((now.getTime() - seriesEndMs) / (1000 * 60 * 60 * 24));`. The future
   allowance holds: floor(−0.4) = −1 (fresh), and two days ahead is −2 (future).
3. Add two rows to the `freshness.two-surfaces.test.tsx` matrix, with the clock frozen mid-afternoon
   UTC: a series 3.6 days old and one 7.6 days old, each under a fresh job. For each, assert that both
   surfaces agree on the subject.

**Original issue:** `seriesAgeDays` is fractional and drives the tone, but the printed age is
`Math.floor(seriesAgeDays)`. The chip reads "old (7d)" or "stale (3d)" for most of each boundary day.

### IN-03 / SFH L-1: An empty scenario blend renders 6 Month / 1 Year as em-dash rows while hiding 3Y / 5Y

**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:148-170`
(owned by 167.1.2; not a T2 file). It renders through `MetricsColumn.tsx`.
**Reason:** the correct fix is in the summary producer, which is outside T2. Both fixes possible inside
`MetricsColumn.tsx` are wrong:
- **A `Number.isFinite` gate** would hide a row whose window is long enough but whose value cannot be
  computed. That breaks 166.2 D7 and D-57's split ("undefined for another reason keeps the em-dash"),
  which `MetricsColumn.record-length.test.tsx` pins: "a non-finite p3y on a long record still renders
  the row".
- **An `m.n === 0` gate** is a second rule in the renderer, standing in for a fact the summary should
  encode.

**The one-line fix, for 167.1.2's file:** in `emptyComputeSummary`, set `p6m: null` and `p1y: null`,
and add `p3y: null, p5y: null`. MTD, YTD and 3M stay NaN. A zero-observation blend is shorter than
every period, so D-57's omission applies.
**Original issue:** `p6m`/`p1y` are NaN, which passes `!= null` and renders "—". `p3y`/`p5y` are
absent, so those rows are hidden. One panel applies two rules for one reason.

## Verification

Every gate ran in the `quantalyze-169-fix2` worktree (branch `feat/169-fix2`) at the final code
state, `98bb9b16b`. That code state is the one this report ships with. The report commit adds only
this file.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run lint` (eslint + admin-route manifest + route contract + planning hygiene) | exit 0 |
| `npx vitest run src/lib/factsheet src/app/factsheet "…/allocations/components/scenario" "…/components/Scenario" "…/components/KpiStrip.scenario" "…/allocations/widgets/performance"` | 105 files, 1814 tests passed |
| Dependent tests outside those folders (factsheet-share, the OG route page-agreement test, `/strategies` share and key-pill, AllocationDashboardV2 ×3, SyncBadge staler-of-two, phase-147/148 guards, `leverage.test.ts`, `src/lib/freshness*` including `two-surfaces`) | 18 files, 278 tests passed. Run before the revert, while the chip change was live, which is how the two-surfaces risk surfaced. |

- **Baseline** on `8d9155b7a`, before any edit: the four lower-case gate folders ran 104 files and
  1788 tests, all passing. The `components/Scenario` and `KpiStrip.scenario` filters were added after
  that run, because the brief's `scenario*` glob is lower-case and the files are named `Scenario…`.
- **Load note:** the load average was about 43 while three fixers ran in parallel. The first run of the
  now-reverted WR04-4 sweep hit the default 5 s timeout. It was trimmed and given an explicit 30 s
  budget before the revert, and `5cadefab7` carries that version.

---

_Fixed: 2026-09-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
