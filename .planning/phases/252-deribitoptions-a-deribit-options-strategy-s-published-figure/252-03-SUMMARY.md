---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 03
subsystem: figure-gate
tags: [figure-record, options-book, returns-route, recommendations, scenario-composer, proof-01]
requires: ["252-01"]
provides:
  - "FigureRecord.withheldBy 'options_cash_wallet': a record that never clears, with cash-wallet reason sentences"
  - "recordFromScalars marker (RecordScalarRow.mtm_gated_reason, caller-supplied from its own effective flags)"
  - "GET /api/strategies/[id]/returns figure_withheld_by"
  - "parseConstituentRecord and constituentFigure read figure_withheld_by (drawer leg and book leg)"
  - "recommendations card withholds CAGR, Sharpe and Max DD on the effective flags generation"
affects: [252-04, 252-05]
status: complete
commits: 3
plan_head_before: 3ed0bfaaf3b22ae0e85c385bcc31ead0aa2617fc
plan_head_after: c1f4dc3dd6c748819fafdc479b9db93565663db6
actuals:
  tokens: 9200
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "a structural withhold rides the D-15 figure record as a marker that recordClears refuses first, so every gate site withholds with no per-site edit"
    - "a caller that wants the marker reads the reason from its own effective flags generation and puts it on the row; the shared alias list stays four"
key-files:
  created: []
  modified:
    - src/lib/figure-gate.ts
    - src/lib/figure-gate.test.ts
    - src/lib/figure-record-scalars.ts
    - src/lib/figure-record-scalars.test.ts
    - src/app/api/strategies/[id]/returns/route.ts
    - src/app/api/strategies/[id]/returns/route.test.ts
    - src/app/(dashboard)/allocations/lib/constituent-figure.ts
    - src/app/(dashboard)/allocations/lib/constituent-figure.test.ts
    - src/app/(dashboard)/recommendations/page.tsx
    - src/app/(dashboard)/recommendations/page.figure-gate.test.tsx
    - src/__tests__/recompute-verdict-census.test.ts
key-decisions:
  - "figure-gate.ts types its withheldBy literal locally and owns its sentences: it must not import headline-basis (import cycle through basis-metrics). A test pins the absence of that import."
  - "The marker beats an unreadable record's sentence: the cash-wallet measurement is the stronger fact, and a pinned case says so."
  - "The route builds its record from the analytics row plus mtm_gated_reason taken from the existing effectiveFlags object: no second effectiveDataQualityFlags call, census stays at 1."
requirements-completed: []
---

# Phase 252 Plan 03: the options-book marker on the figure record Summary

A figure record marked `withheldBy: "options_cash_wallet"` never clears, so every annualized-figure surface that builds its record through `figureRecord` withholds an options book's figures with a sentence naming the cash-wallet measurement. The returns route, the Scenario composer's two constituent paths and the recommendations card now carry it. No stored value changes; blend-level figures are untouched (deferred per CONTEXT).

## What was built

- **Task 1 (tracer), commit `9d7452602`.** `figure-gate.ts`: `FigureRecord.withheldBy`, `figureRecord`'s optional input spread conditionally (an unmarked record has no `withheldBy` key), `recordClears` refuses first, and a first branch in `withheldReason` (record and blend scope), `withheldCellTitle` and `widenedWithheldReason` (every kind, including `rolling-record`). Module header carries one sentence on the marker. `figure-record-scalars.ts`: `RecordScalarRow.mtm_gated_reason`, and `recordFromScalars` spreads `withheldBy` only when `isOptionsCashWalletReason(row?.mtm_gated_reason)`; `RECORD_SCALAR_ALIASES` is byte for byte the four-alias string. Returns route: `ReturnsResponse.figure_withheld_by`, the record built from the row plus the reason from the existing `effectiveFlags`, and the field on the 200 body under the same rankable conjunction `figure_unreadable` uses. Tests also landed for the carrier (`figure-record-scalars.test.ts`, a Task 2 file by the plan's table, committed here because the tracer's PROOF-01 neuter needs it).
- **Task 2, commit `7a8ca992a`.** `constituent-figure.ts`: `parseConstituentRecord` spreads `withheldBy` only for the exact literal; `BookScalars.figure_withheld_by`; `constituentFigure`'s book arm carries it into the record. The producer of the book field (`getMyAllocationDashboard` in `queries.ts`) and `gatedSharpe` are plan 252-04's; until then a book leg reads an absent field and behaves as today.
- **Task 3, commit `c1f4dc3dd`.** `recommendations/page.tsx`: in the bounded status read's loop the reason is read once through `effectiveDataQualityFlags(r).flags?.mtm_gated_reason` and placed on the `scalarsById` row; the select string is unchanged. Max DD is nulled when the record carries `withheldBy`. CAGR and Sharpe already go through `gateAnnualized` and `annualizedCell`, so they dash and carry the sentence with no edit. Census row `src/app/(dashboard)/recommendations/page.tsx::effectiveDataQualityFlags` (count 1, class holds) added.

## Sentences (hand-typed again in the tests)

- `withheldReason("record")`: "Annualized figures are not shown: this record is measured on the cash wallet, which leaves out the market value of open option positions." (blend scope: "the blend's record").
- `withheldCellTitle`: "Withheld: measured on the cash wallet, which leaves out open option positions."
- `widenedWithheldReason(kind)`: "<subject> are not shown: the record is measured on the cash wallet, which leaves out open option positions." A test asserts none contains a digit, "record reaches", `unsmoothed_options_book` or `mtm_gated_reason`.

## RED runs on today's tree (before any source edit)

Returns route, flagged case written first (output trimmed to the FAIL lines):

```
 FAIL  ... > GET /api/strategies/[id]/returns > R-C — HONEST-05: the widening is additive — the existing consumer contract is unchanged   (key list now includes figure_withheld_by)
 FAIL  ... > 252 figure_withheld_by (the options-book marker) > a rankable row whose effective flags carry the options reason answers options_cash_wallet and still serves the values
 FAIL  ... > 252 figure_withheld_by (the options-book marker) > the same row without the reason, with another reason, or with a case variant answers null
 FAIL  ... > 252 figure_withheld_by (the options-book marker) > a non-rankable row carrying the reason answers null (the same rankable conjunction as figure_unreadable)
 FAIL  ... > 252 figure_withheld_by (the options-book marker) > the field is on a body with no analytics row at all, as null
 Test Files  1 failed (1)
      Tests  5 failed | 65 passed (70)
```

(The three null cases fail because the field is `undefined`, not `null`, at HEAD.)

Recommendations card, flagged cases plus the census row written first, against the unedited page:

```
 FAIL recompute verdict census (Phase 237 plan 11, SC-2) > every reader of the recompute verdict is classified, with an exact count
 FAIL 252 W5 · /recommendations - ... > live flags carrying the success marker and the reason: dashes for CAGR, Sharpe and Max DD, with the options sentence
 FAIL 252 W5 · /recommendations - ... > a held re-run: prestamped live flags (no marker, no reason) over a snapshot bound to computed_at that carries the reason is withheld the same way
 Test Files  2 failed (2)
      Tests  3 failed | 26 passed (29)
```

Note on the held re-run case: at that RED run its fixture lacked `cumulative_return`, so `analyticsHold` would not admit it and the case failed for a fixture reason as well as the missing behaviour. The fixture was corrected afterwards (`cumulative_return: 0.42`, the stored success's headline), and the generation neuter below is the evidence that the case now fails for the right reason. The live-flags case is a clean RED.

## PROOF-01 (verbatim)

Each neuter was made on a file backed up byte for byte (backups in the session scratchpad), restored with `cp`, proven with `cmp` (exit 0), then re-run GREEN. Lines are the vitest FAIL and summary lines with the long describe prefixes shortened; the runs are three-file (figure-gate, figure-record-scalars, returns route) for Task 1, three-file (constituent-figure, figure-record-scalars, ScenarioComposer.constituent-figure-gate) for Task 2, three-file (recommendations figure-gate, rerun-hold, recompute-verdict census) for Task 3.

### Marker: the `withheldBy` test removed from `recordClears`

```
      Tests  4 failed | 147 passed (151)
 FAIL 252 recordFromScalars: the options-book marker > marks the record for the exact reason, and the gate withholds a record that would clear
 FAIL 252 withheldBy: the options-book marker never clears > withholds a 400-day crypto record that would otherwise be full
 FAIL 252 withheldBy: the options-book marker never clears > withholds a delta, a rolling window and a short-record rank through the same refusal
 FAIL 252 withheldBy: the options-book marker never clears > withholds a non-crypto record whose observation count clears
 Test Files  2 failed | 1 passed (3)
cmp exit 0
      Tests  151 passed (151)
 Test Files  3 passed (3)
```

### Carrier: the `withheldBy` spread dropped from `recordFromScalars`

```
      Tests  2 failed | 149 passed (151)
 FAIL 252 recordFromScalars: the options-book marker > marks the record for the exact reason, and the gate withholds a record that would clear
 FAIL GET /api/strategies/[id]/returns — 194.1 record scalars (B8) > 252 figure_withheld_by (the options-book marker) > a rankable row whose effective flags carry the options reason answers options_cash_wallet and still serves the
 Test Files  2 failed | 1 passed (3)
cmp exit 0
      Tests  151 passed (151)
 Test Files  3 passed (3)
```

### Route field: `figure_withheld_by` set to null unconditionally

```
      Tests  1 failed | 150 passed (151)
 FAIL GET /api/strategies/[id]/returns — 194.1 record scalars (B8) > 252 figure_withheld_by (the options-book marker) > a rankable row whose effective flags carry the options reason answers options_cash_wallet and still serves the
 Test Files  1 failed | 2 passed (3)
cmp exit 0
      Tests  151 passed (151)
 Test Files  3 passed (3)
```

### Constituent parse: the `withheldBy` spread dropped from `parseConstituentRecord`

```
      Tests  1 failed | 55 passed (56)
 FAIL 252 figure_withheld_by on a constituent > drawer path: the exact literal marks the record and the verdict is withheld despite a long span
 Test Files  1 failed | 2 passed (3)
cmp exit 0
      Tests  56 passed (56)
 Test Files  3 passed (3)
```

### Constituent book arm (extra, beyond the plan): the spread dropped from `constituentFigure`

```
      Tests  2 failed | 54 passed (56)
 FAIL 252 figure_withheld_by on a constituent > book path: a book strategy carrying the marker is withheld and its record carries withheldBy
 FAIL 252 figure_withheld_by on a constituent > the cell hands the raw value to no formatter once withheld
 Test Files  1 failed | 2 passed (3)
cmp exit 0
      Tests  56 passed (56)
 Test Files  3 passed (3)
```

### Alias guard: a fifth alias appended to `RECORD_SCALAR_ALIASES` (the grep count goes 1 to 0)

```
0
      Tests  4 failed | 52 passed (56)
 FAIL 252 recordFromScalars: the options-book marker > RECORD_SCALAR_ALIASES is still the four-alias string byte for byte
 FAIL RECORD_SCALAR_ALIASES: one alias list, three readers > equals the inner list of RECORD_SPAN_SELECT
 FAIL RECORD_SCALAR_ALIASES: one alias list, three readers > equals the PERCENTILE_SPAN_COLUMNS literal in queries.ts (read from source: the constant is module-private)
 FAIL RECORD_SCALAR_ALIASES: one alias list, three readers > names exactly the four scalar aliases and never a whole blob column
 Test Files  1 failed | 2 passed (3)
cmp exit 0
1
      Tests  56 passed (56)
 Test Files  3 passed (3)
```

### Generation: the reason read from the live flags blob instead of `effectiveDataQualityFlags` (grep count of `effectiveDataQualityFlags(` in page.tsx goes to 0)

```
0
      Tests  2 failed | 38 passed (40)
 FAIL 252 W5 · /recommendations - an options book's card shows no cash-wallet figures > a held re-run: prestamped live flags (no marker, no reason) over a snapshot bound to computed_at that carries the reason is withheld the same way
 FAIL recompute verdict census (Phase 237 plan 11, SC-2) > every reader of the recompute verdict is classified, with an exact count
 Test Files  2 failed | 1 passed (3)
cmp exit 0
      Tests  40 passed (40)
 Test Files  3 passed (3)
```

### Card: the reason dropped from the `scalarsById` row

```
      Tests  3 failed | 37 passed (40)
 FAIL 252 W5 · /recommendations - an options book's card shows no cash-wallet figures > a held re-run: prestamped live flags (no marker, no reason) over a snapshot bound to computed_at that carries the reason is withheld the same way
 FAIL 252 W5 · /recommendations - an options book's card shows no cash-wallet figures > live flags carrying the success marker and the reason: dashes for CAGR, Sharpe and Max DD, with the options sentence
 FAIL recompute verdict census (Phase 237 plan 11, SC-2) > every reader of the recompute verdict is classified, with an exact count
 Test Files  2 failed | 1 passed (3)
cmp exit 0
      Tests  40 passed (40)
 Test Files  3 passed (3)
```

Import-cycle guard: the acceptance grep `grep -a -c 'from "@/lib/factsheet/headline-basis"' src/lib/figure-gate.ts` reads 0 at HEAD. It is pinned by a test case in `figure-gate.test.ts` (a regex over the source), but that case was not itself neutered (the plan lists it as a guard mutation of the grep count, which I did not run as a separate RED).

## Verification

- Plan sweep: `npx vitest run src/lib/figure-gate.test.ts src/lib/figure-gate.d11.test.ts src/lib/figure-record-scalars.test.ts 'src/app/(dashboard)/recommendations' 'src/app/api/strategies/[id]/returns' 'src/app/(dashboard)/allocations' src/__tests__/figure-gate-census.test.ts src/__tests__/recompute-verdict-census.test.ts`: `Test Files 199 passed (199)`, `Tests 3695 passed (3695)`.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 4 warnings. All four are the unused-variable warnings recorded in plan 252-01's summary (`nativeUnitReason` in `MetricsColumn.tsx`, `isRankableAnalyticsRow` in `composite-read-path.ts`, `WARNED_ROW` and `COMPUTING_ROW` in `queries.stale-analytics-detail.test.ts`); none is in a file this plan edited.
- `node scripts/verify-plan-anchors.mjs --pending`: `OK: 18 plan file(s), no stale claims.`
- Acceptance greps at HEAD: `withheldBy` in figure-gate.ts well over 5; `isOptionsCashWalletReason` in figure-record-scalars.ts 2; `figure_withheld_by` in route.ts at least 2 and in constituent-figure.ts at least 2; `effectiveDataQualityFlags(` in recommendations/page.tsx 1; `mtm_gated_reason:data_quality_flags` 0; the census row 1; the four-alias line 1.
- Not run: `src/lib/factsheet/compute.conventions.test.ts` (fixtures B and C fail locally on Node 25, known, untouched). No database access.

## Deviations from Plan

None to the code. Two notes:

- The `figure-record-scalars.test.ts` cases were committed with Task 1 (its PROOF-01 carrier neuter needs them) rather than Task 2.
- Widened-reason cases went in `figure-gate.test.ts` as the plan's file list says, although the existing widened-reason cases live in `figure-gate.d11.test.ts`.

## Known Stubs

None. Until plan 252-04 fills `BookScalars.figure_withheld_by` from `getMyAllocationDashboard`, a composer book leg reads an absent field and keeps today's behaviour; that is the plan's stated interim, not a stub in this plan's files.

## Threat Flags

None. T-252-07 (the new response field is a closed literal or null, behind the route's existing published-or-owner probe, and the flags blob is never forwarded; the existing "never forwards the flags blob" case still passes) and T-252-08 (the card reads the effective flags generation, held re-run case pinned) are mitigated as planned.

## Self-Check: PASSED

- Commits `9d7452602`, `7a8ca992a`, `c1f4dc3dd` are reachable from HEAD; `commits: 3` was measured from the persisted ledger (`plan_head_before` to the head before this SUMMARY's own commit).
- All 11 files under `key-files.modified` exist and are in those commits.
- STATE.md, state.json and ROADMAP.md were not touched; Phase 233's files were not touched.
