---
phase: 169-pagetruth
fixed_at: 2026-09-29T21:50:00Z
review_path: .planning/phases/169-pagetruth/169-REVIEW-R2.md
review_paths:
  - .planning/phases/169-pagetruth/169-REVIEW-R2.md
  - .planning/phases/169-pagetruth/169-REVIEW-SFH-R2.md
topic: T6 (confirmation round 2 fix set; founder rule for round 2 - fix anything user-facing or data-integrity at any severity)
iteration: 2
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 169: Code Review Fix Report, topic T6 (round 2)

**Fixed at:** 2026-09-29
**Source reviews:** `169-REVIEW-R2.md` and `169-REVIEW-SFH-R2.md`
**Branch:** `feat/169-pagetruth`, from `1dbcc3b8b`. There were no sibling fixers. The checkout was
already a dedicated worktree, so the agent's own nested worktree step was not run. Every edit,
test, neuter and commit was made directly on the branch in the `quantalyze-169` checkout.
**Iteration:** 2

**Summary:**
- Findings in scope: 7. The same issue sometimes appears in both reviews: WR-R2-01 is SFH R2-7,
  IN-R2-05 is SFH R2-5, and WR-R2-02 is SFH L-4.
- Fixed: 7
- Skipped: 0

Every behaviour change was made test-first:
1. Write the test and observe it fail on the old code.
2. Apply the fix and observe it pass.
3. Neuter the fix, observe the test fail again, then restore the file from a byte backup and check
   the restore with `cmp`.

The counts are below. IN-R2-01 changes comments only.

## Fixed Issues

### SFH R2-1: Under the MTM toggle, the Terms panel called a live track record "backtest"

**Files modified:** `src/app/factsheet/[id]/v2/MandatePanels.tsx`,
`src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx`
**Commit:** `508b56e31`
**Status:** fixed (it is a regression from T2's WR-03)

**Applied fix.**
- `hasBacktestGap` now compares the declared live date with `payload.strategyMetrics.start`. That
  is the cash record, which is the record the live date describes.
- The warning span prints that same cash start.
- Observation start, Observation end and Sample size stay on the selected basis (WR-03).
- One extra change beyond the brief: the span had printed the selected basis's `{start}`. Once the
  flag is computed from cash, that would have produced "observation window starts 2024-08-08"
  beside a flag computed from 2024-01-01. The span now prints the cash start.

**Tests.** They extend the WR-03 fixture: cash runs 400 days from 2024-01-01, and MTM is the last
180 days, starting 2024-08-08.
- Live since 2024-01-01, MTM view: "Live since" reads exactly `2024-01-01` with no backtest claim,
  and Observation start is still `2024-08-08`.
- The same payload on the cash view is unchanged. This is the control.
- A positive control: live since 2023-06-01. The flag shows on both bases and names
  `2024-01-01`.

**Red, then green.**
- Red-first: 2 of the 3 new cases failed.
- Neuter (`recordStart = m.start`): the same 2 failed.
- The file was restored and `cmp` confirmed it.

### WR-R2-01 (= SFH R2-7): The weekday tolerance keyed on the asset class, not the series

**Files modified:** `src/lib/factsheet/compute.ts`, `src/lib/factsheet/compute.metrics.test.ts`,
`.planning/phases/169-pagetruth/169-CONTEXT.md` (D-11), `.planning/ROADMAP.md` (the
"D-11 amended 2026-09-29" note)
**Commit:** `9b813427b`
**Status:** fixed: requires human verification (a logic rule; it amends D-11 a second time)

**The rule chosen.** The weekday tolerance (skip Saturday, Sunday, 1 January and 25 December) now
applies only when both of these hold:
- the record spans at least one Saturday;
- the record has no Saturday or Sunday observation anywhere.

`periodsPerYear` no longer takes part in the decision.

**Why the series decides alone, and not `252 && no weekend dates`.**
- The review's snippet kept the `=== 252` term. Under it, a weekday-only series still shows YTD at
  252 and "—" at 365. Changing the asset class would still move a return number, which is the
  `closed-sets.ts` (#597) contract the brief cites.
- Dropping the term makes the coverage rule invariant to the asset class.
- Under either version, a misclassified 24/7 record has weekend prints and gets the strict rule.
  The fail-safe the review wanted holds either way.

**Why the span condition was added.** A record too short to span a weekend (for example Mon to Wed)
has no weekend dates only vacuously. Without the span condition, a 3-day-old 24/7 record starting on
the Monday after a Saturday month-end would get MTD. Requiring the record to span a Saturday means
the absence of weekend prints is evidence, not an accident of length. This fails safe: the
em-dash, never a number.

**A test line changed on purpose.** In T2's weekday table, each case asserted that
`compute(rets, dates, 0, 365)[key]` was `null`. That encoded "asset class decides", which is the
defect. Each case now asserts the same value at 365, which is asset-class invariance. It also
asserts that the same start on an every-calendar-day record is `null` at 252.

**New tests:**
- The 7-day boundary table: every case now also asserts that 252 gives the same result as 365. A
  record that trades weekends gets no tolerance on the 252 basis.
- One Saturday print in the middle of an otherwise weekday-only record (the Mon 30 Mar start after
  a Sat 28 Mar 3M cutoff) makes `p3m` `null` at 252.
- A Mon to Wed record gives MTD `null` on both bases. Spanning one weekend with no print on it is
  enough to earn the tolerance.

**Red, then green.**
- Red-first: 11 of 32 failed.
- Neuters, each restored and checked with `cmp`:

  | Neuter | Tests red |
  |---|---|
  | the T2 rule (`periodsPerYear === 252`) | 11 |
  | drop the span check (`!tradesWeekends`) | 1 (the too-short case) |
  | drop the weekend check (`spansSaturday`) | 10 |

- `src/lib/factsheet` and `src/app/factsheet`: 80 files and 1151 tests passed. No snapshot moved.

**Known limits.**
- A 24/7 venue whose CSV omits every weekend is treated as a weekday venue. The record really has no
  weekend observations, so no traded day in it is missed.
- Every other limit from T2 still holds: any other holiday gives the em-dash.

**Population query not run.** The review suggested measuring the published non-crypto strategies
with weekend dates before choosing the fix. It was not run. The chosen rule fails safe for that
whole population whatever its size: every one of those strategies gets the strict rule. The count
would not change the decision.

**D-11 recorded.**
- `169-CONTEXT.md` has a new dated bullet, "D-11 amended again 2026-09-29 (review round 2, fix T6,
  WR-R2-01 ...)". T2's bullet is kept as lineage.
- `ROADMAP.md` has a matching note after the existing one, which is kept.

### WR-R2-02: A hedge's negative risk share read "Balanced" in green

**Files modified:** `src/components/portfolio/RiskAttribution.tsx`,
`src/components/portfolio/RiskAttribution.test.tsx`
**Commit:** `67be099dd`
**Status:** fixed

**Applied fix.** `assessable = share !== null && weight !== null && share >= 0`. A negative share
renders the same colourless "—" that the null-share and null-weight rows use. The chart
`domain={[0, 1]}` is not touched, because that is a separate decision.

**Test.** It uses the existing -12% fixture:
- The Hedge assessment cell is "—", with no `.text-positive` or `.text-negative` class.
- Control: Trend (112 against 60 × 1.3) still reads "Overweight risk".

**Red, then green.** The test failed first. Neuter (drop `share >= 0`): it failed again. The file
was restored and `cmp` confirmed it.

### IN-R2-02: The caveat said "Cumulative return" where the panel labels the figure "Since Inception"

**Files modified:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx`,
`src/app/factsheet/[id]/v2/FactsheetView.tsx`,
`src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx`
**Commit:** `e59cc0548`
**Status:** fixed

**Applied fix.** `headlineCoverageCaveat` takes a `subject`. Each surface passes the labels it
actually renders:

| Surface | Subject |
|---|---|
| Main Metrics | "Cumulative Return, CAGR and Calmar" |
| Cumulative Return Metrics panel | "Since Inception and CAGR" (the panel shows no Calmar) |
| KPI strip | "Cum. Return, CAGR and Calmar" |

Correction to the review: the review said the KPI strip reads "Cumulative Return". It reads
"Cum. Return" (`FactsheetView.tsx`, the `kpis` array).

**Tests.**
- Hand-typed dated and undated strings for each surface, each asserted in its own panel.
- New guards assert that each panel shows the labels its caveat names. Cumulative Return Metrics
  shows "Since Inception" and "CAGR" but not "Calmar". Main Metrics shows all three. The strip
  shows "Cum. Return", "CAGR" and "Calmar".

**Red, then green.** 4 of 10 failed first. Neuter (hard-code the old subject in the builder): the
same 4 failed. The file was restored and `cmp` confirmed it.

### IN-R2-05 (= SFH R2-5): The key-trust note printed "$0.00" for P&L nobody knows

**Files modified:** `src/app/(dashboard)/allocations/lib/live-holdings-summary.ts`, and the pins in
`live-holdings-summary.test.ts`, `components/untrusted-key-status.surfaces.test.tsx` and
`components/ScenarioComposer.test.tsx`
**Commit:** `52367ba40`
**Status:** fixed

**Applied fix.**
- This is in the shared `buildKeyTrustClause` `phrase()`, as the brief directed. (The review had
  proposed an `OpenPositionsTable`-only change.)
- When every row of a part is unavailable, the part now names its count instead of a dollar
  amount. For example: "Includes 1 position from keys needing attention (P&L unavailable for 1
  position)."
- The "(… unavailable for N …)" count is unchanged.
- A partly reported part keeps its amount, as the existing `part(8_000, 3, 2)` pin shows.
- The builder is shared, so the composer's AUM marker changes the same way ("Includes 1 holding
  from keys needing attention (value unavailable for 1 holding) …"). In both places the `$0` was
  the sum of nothing.

**Pins.** 7 pins were updated. Each carries a comment giving the reason (IN-R2-05 / SFH R2-5): a
part with every row unavailable has no known amount.

**Red, then green.** The 7 updated pins failed first. Neuter (disable the all-unavailable
branch): the same 7 failed. The file was restored and `cmp` confirmed it.

### WR-R2-03: The H-1 reader bypassed the MED-1 cash-series choke point

**Files modified:** `src/lib/factsheet/composite-read-path.ts`,
`src/lib/factsheet/composite-read-path.test.ts`
**Commit:** `f38776d23`
**Status:** fixed

**Decision.** Add a read-site gate and correct the contract. Routing through
`shouldReadCashSettlementSeries` was not an option, for three reasons:
- That predicate's object half needs a raw `metrics_json_by_basis.cash_settlement` object.
- A single-key row never carries one (SC-4).
- `persistedCashHeadline` refuses exactly the rows that do.

So that predicate is false on every row H-1 targets, and using it would switch H-1 off.
`105-FOLD-DECISION.md` §4(a) has no single-key carve-out. What it states is that "the status-gate
IS the guarantee".

**Applied fix.**
- New export `shouldReadSingleKeyCashSeries(metricsJsonByBasis, computationStatus)` joins the MED-1
  family as its single-key member. It requires:
  - a DONE status (`isComputedAnalytics`, the same half as MED-1);
  - no raw `cash_settlement` object. A row that has one is a composite-to-single stale window
    whose series belongs to another run.
- The two members are disjoint by construction, and a test pins that.
- The H-1 read in `readSingleKeyBasisOpts` is now gated on it at the read site.
- The `shouldReadCashSettlementSeries` contract now names the real first production reader, names
  the gate it goes through, and says why this predicate cannot serve it.
- `readHeadlineCoversFrom`'s docblock names the gate.

**No path yields a wrong date.**
- The gate refuses any non-DONE row before the read, so a series left by a failed or computing run
  is never read.
- The writers persist the series before they flip the status (`analytics_runner.py:1985-1997`,
  `job_worker.py:8828-8836`, as the review traced), so a DONE row's series is the current run's.
- Where the date cannot be derived, the result is still `null`, which renders the undated
  sentence.

**Honest limit of the test.** Today the call-site gate is implied by `cashHeadline`, because
`isRankableAnalyticsRow` is the same DONE check. A neuter of the call-site conjunct alone therefore
cannot go red through `readSingleKeyBasisOpts`. The tests pin the predicate directly, which is the
unit a future caller would reuse.

**Tests:**
- the truth table: DONE with no object is true, for `null`, `{}` and an MTM-only object;
- 8 non-DONE statuses are false;
- a raw cash object is false;
- the family is disjoint.

**Red, then green.** The 4 new cases failed first (the export did not exist). Neuter (drop the
predicate's DONE gate): the status case failed. The file was restored and `cmp` confirmed it.

### IN-R2-01: Three comments the round-1 fixes made stale

**Files modified:** `src/lib/factsheet/composite-read-path.ts`
**Commit:** `da13f532d`
**Status:** fixed (comments only)

- The `parseMtmSeriesPayload` docblock said "malformed/failed". It now says "malformed", and notes
  that a failed read throws `CompositeSeriesReadError` (M-3 / WR-05).
- `readSingleKeyBasisOpts`: the "the discovery detail page does not pass it yet" clause is replaced.
  Both production callers pass the config. Checked at `discovery/.../page.tsx:247-255` and
  `fetch-and-build-payload.ts:544`.
- The `@throws` note now also names the chain-broken row's `cash_settlement` series read
  (`read: "cash_settlement"`).

## Verification

Every gate ran in the `quantalyze-169` checkout (the main checkout of branch
`feat/169-pagetruth`, not a nested worktree), at the final code state `da13f532d`. This report
commit adds only this file.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run lint` (eslint, admin-route manifest, route contract, planning hygiene) | exit 0 |
| `npx vitest run src/lib src/app/factsheet src/app/factsheet-share src/components "src/app/(dashboard)"` | exit 0: 613 files passed, 10661 tests passed, 9 skipped |

- **The first full vitest run was not green.** It had one failure, in
  `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx` ("enables
  Continue with empty secrets …": `expected "vi.fn()" to be called at least once`).
  - T6 did not touch that file: `git diff 1dbcc3b8b -- "src/app/(dashboard)/strategies"` is empty.
  - Run alone, it passed 82/82.
  - The full re-run above passed with 0 failures.
  - This is recorded as a load-timing flake. It was not made green by a code change.
- **The 9 skipped tests are the live-database probes T5 recorded.** There are 4 in
  `src/lib/sec-005-live-probe.test.ts` and 5 in `src/lib/migration-028-tenant-check.test.ts`. They
  skip when no credential is present, so they were not run.
- **The test count adds up.** It is T5's 10649 plus the 12 new tests: 3 for R2-1, 2 for WR-R2-01,
  1 for WR-R2-02, 2 for IN-R2-02 and 4 for WR-R2-03.

STATE.md was not touched.

---

_Fixed: 2026-09-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
