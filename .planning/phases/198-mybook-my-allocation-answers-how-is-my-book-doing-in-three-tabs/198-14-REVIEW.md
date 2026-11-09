---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 14
gap: 198-UAT-01
reviewed: 2026-11-09T09:05:37Z
depth: standard
diff_range: 86e158616..a0e20046c
files_reviewed: 9
files_reviewed_list:
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-header.test.tsx
  - src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.test.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.scenario-parity.test.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
  necessity: 0
status: issues_found
---

# Phase 198 Plan 14 (gap 198-UAT-01): Code Review Report

**Reviewed:** 2026-11-09T09:05:37Z
**Depth:** standard, with call-chain reads into `EquityHistoryRebuilding.tsx`, `ScenarioComposer.tsx` (own-book sentence), `lib/history-gate.ts`, `lib/book-figures.ts`, `annualized-cell.tsx`, `figure-gate.ts`, `queries.ts` (`MissingSeriesReason`) and `allocator-portfolio-payload.ts`
**Files Reviewed:** 9
**Status:** issues_found (one MEDIUM)

Scope is limited to MEDIUM and above, as the caller asked. MEDIUM maps to the WARNING tier (`WR-`).

## Summary

The change closes the reported contradiction. On a rebuilding Overview no visible or assistive-tech text says return or risk is missing while the glance prints them:

- The two `BOOK_LINE` values no longer name return or risk.
- The glance's sr-only pointer and the `noteBelow` prop are gone. `grep -rl noteBelow src` is empty, and `tsc` proves no caller still passes the prop.
- The Risk not-ready line no longer says risk figures need the history.

I checked the rest of the rebuilding Overview tree for the same claim and found none. The glance caption says "Return and risk: live book…". The key lines, the needs-action lines, `UNKNOWN_REASON_LINE` and the truncated and read-failed lines name neither. A withheld Sharpe's `annualizedCell` sr-only text names its own threshold and points at no note. The `allKeysStale` dashes are explained by the staleness banner.

Rebuild-reason class meaning stays consistent with the Scenario own-book sentence:
- `awaiting_derivation` (`rebuilding`) still names the daily run. The quote "recomputed ... once a day" in the `EquityHistoryRebuilding.tsx` class comment is still true.
- `derivation_rejected` (`held_back`) names no run. It now carries "did not pass its checks, so it is not shown" verbatim, so the quotes in `EquityHistoryRebuilding.tsx:32`, `ScenarioComposer.tsx:930` and `ScenarioComposer.test.tsx:18965` are true again. Before this change they were false.
- Scenario's held_back line ("We are holding back your book's own history") and its rebuilding line ("being rebuilt") still match.

The tests can fail on regression:
- The exact-string pins catch any change to the two lines.
- The 9-case agreement test's `\b(return|risk)\b` check on the note and on the `#risk` paragraph catches the old wording returning.
- The rebuilding test's strict `glance-ytd === "—"` and its region-level `/note below|not shown/i` checks catch the pointer returning on any cell.
- I re-ran the six affected files at HEAD: 230 passed.

One defect remains. The rewritten `awaiting_derivation` line now promises, by name, that "the ratios built from it" appear after the next recompute. That is false for the "no row yet" state that reason also covers (WR-01).

## Warnings

### WR-01: `awaiting_derivation` promises the ratios after the next recompute, but the figure gate and the warm-up branch withhold them for a short record

**File:** `src/app/(dashboard)/allocations/components/MissingDataMessage.tsx:70-71`

**Issue:** The new line ends: "The equity chart and the ratios built from it appear after the next recompute." It renders for every `awaiting_derivation` book. `queries.ts:5058` defines that reason as "no row yet, or a pre-v2 row". So it covers a brand-new book whose first derived row has not been written, not only the pre-v2 re-compose case.

For a book with a short record, the next recompute does not bring the ratios:

- **Fewer than 2 returns:** `allocator-portfolio-payload.ts:105` (`if (dailyReturns.length < 2) return null`) sends the ready Overview to `FactsheetWarmupNote` ("Aggregated factsheet panels appear once at least three days…", `AllocationDashboardV2.tsx:339-343`). No ratios render.
- **Under 90 days or 60 observations:** every annualised ratio on the factsheet is withheld by the 194 D-15 gate (`figure-gate.ts:26,32`, `MIN_ANNUALIZATION_DAYS = 90` and `MIN_ANNUALIZATION_OBS = 60`, applied in `FactsheetView.tsx`, `MetricsColumn.tsx`, `AnalyticalPanels.tsx`, `BatchDPanels.tsx`). It prints a dash with "Withheld until the record reaches…".

So the line names a specific figure class and an unlock that will not happen for that class. That breaks DESIGN.md Voice ("State limitations with the threshold attached… The reader learns exactly what unlocks it") and the file's own rule that each line "states only what a running job does" (doc comment, lines 49-50).

The pre-198 line made a similar promise in vaguer words ("They appear after the next recompute"). This plan narrowed the promise onto "the ratios", which is the class the figure gate withholds hardest. The question for this review was whether the new copy is true in every state it renders in, and here it is not.

**Fix (minimal):** state the hidden set and the run without promising when the ratios unlock. Keep "recomputed once a day" so the class comment and `queries.ts` stay true:

```ts
awaiting_derivation:
  "Your book's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden.",
```

Then update the four pins to the new string:
- `MissingDataMessage.test.tsx:318`
- `AllocationDashboardV2.rebuilding.test.tsx:95,345`
- `OverviewRisk.history-parity.test.tsx:162`

The agreement test's `"The equity chart and the ratios built from it"` containment and its `\b(return|risk)\b` exclusion both stay green.

The plan's must-have text says the line "ends 'after the next recompute'". That phrase is not quoted by any comment (`grep -a -rn "after the next recompute" src` finds only the line and its pins), so dropping it breaks no comment.

---

## Checked, not raised (below MEDIUM or sanctioned)

- **"The ratios… are hidden" under a glance that prints Sharpe.** This is a near-repeat of the UAT's shape, since Sharpe is a ratio. The phrase is the wording the UAT `missing` list prescribes (the `UNKNOWN_REASON_LINE` precedent), and "built from it" plus the glance caption ("live book, blended from each key's daily returns") tell the two sources apart. Not raised. Worth a look in the browser re-run of UAT test 3.
- **`derivation_rejected` pronoun.** In "The latest rebuild… did not pass its checks, so it is not shown", the antecedent of "it" is the rebuild, not the history. The next sentence settles the meaning. Style only.
- **Two passive clauses against DESIGN.md "Active voice".** This is a documented plan decision (`198-14-SUMMARY.md`, Deviations) and a style point.
- **Absence assertions for the retired pointer string.** `AllocationDashboardV2.warmup.test.tsx:144` and `AllocationDashboardV2.ready-empty-book.test.tsx:98,111,130` can no longer fail now that the string is deleted. They are harmless, and the plan chose to keep them.
- **"See the note above" from the Risk section** always points at a note that exists. The gate is `rebuilding` exactly when `isRebuilding` is true, and `missingDataLines` always returns at least one line in that state.

---

_Reviewed: 2026-11-09T09:05:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter findings (round 1, merged by the orchestrator)

### SFH-01 (MEDIUM, user-facing / accessibility): a fully dashed glance has no explanation, and no test covers it
- **Where:** `src/app/(dashboard)/allocations/components/GlancePanel.tsx` (bare `formatPercent(...)` cells; `sharpeContent` falls back to "—"). Pointer removed in 8bae6f65c.
- **Evidence:** `src/lib/queries.ts` (around `:6669-6675`) returns `emptyLiveBaselineMetrics(...)` (every metric null) whenever no key contributes, which is the state for `key_not_syncing`, `account_identity_pending`, `awaiting_derivation` and `history_read_failed`. Then YTD TWR, Sharpe and Max DD all print "—", and only the note below explains why. The retired pointer was true in exactly this state; C7's "no note line explains a glance figure" does not hold when there is no live series at all.
- **Minimal fix:** narrow the pointer instead of deleting it: when the live series is absent (`figures.seriesEndDay === null`, not all keys stale) AND a missing-data note renders below, the Return and Risk dashes carry an sr-only pointer such as "No live figures yet. See the note below." Never on a cell that prints a value. Add a test with `emptyLiveBaselineMetrics(...)` plus a rebuilding reason asserting the pointer, and keep the existing tests asserting no pointer when values print.

### SFH-02 (MEDIUM, test can pass on a recurrence): `\b(return|risk)\b` misses plural wording
- **Where:** `src/app/(dashboard)/allocations/components/GlancePanel.test.tsx:373` and `:379`.
- **Evidence:** "your book's returns and risks are not shown" passes the guard. Widening to `returns?` would false-fail on the legitimate "each account's returns and cash flows".
- **Minimal fix:** assert the claim, not the word: e.g. strip the exact phrase "each account's returns and cash flows" before matching `/\b(returns?|risks?)\b/i`, or match a figure word followed by "not shown|hidden|withheld|appear after" in the same sentence.

## Fixes applied

Round 1 fixer, 2026-11-09. All three MEDIUM findings fixed; no LOW or INFO touched.

- **WR-01** (`5c251b610`): `BOOK_LINE.awaiting_derivation` now reads "Your book's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden." It promises no unlock. Four pins updated; the agreement test's containment check is now case-insensitive because the phrase moved mid-sentence.
- **SFH-01** (`4e7193526`): `GlancePanel` takes `noteBelow` again. Only when `figures.seriesEndDay === null`, not `allKeysStale`, and the missing-data note renders, a dash Return or Risk cell carries sr-only "No live figures yet. See the note below." Never on a cell that prints a value or on a withheld Sharpe. New describe block "198-14 SFH-01" in `GlancePanel.test.tsx` (empty live baseline plus rebuilding reason, all-keys-stale, populated figures, withheld Sharpe, ready book). Neutered three ways (pointer never rendered, pointer on populated cells, pointer under all-keys-stale), each RED by name, each restored byte-equal.
- **SFH-02** (`3ddc93a0a`): the guard strips "each account's returns and cash flows" and matches `/\b(returns?|risks?)\b/i`. Neutered with plural wording in `derivation_rejected`: RED on the `derivation_rejected` case; restored byte-equal.
