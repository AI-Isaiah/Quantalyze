---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 14
subsystem: overview-glance-and-missing-data-note
tags: [route-07, gap-closure, 198-uat-01, d-10, c7, glance, missing-data]
requires:
  - phase: 198-01
    provides: the glance prints live figures regardless of the history state (C7, D-06)
  - phase: 198-09
    provides: the Overview missing-data message and `BOOK_LINE`
provides:
  - the two book-level lines (`awaiting_derivation`, `derivation_rejected`) name what the withheld history hides, never return or risk
  - the glance carries no pointer to the missing-data note; a null figure is a bare dash
  - the Risk section's not-ready line says the section needs the book's history, not that risk figures do
  - one agreement test that renders the full Overview for every rebuild reason with live figures
affects: [198-UAT test 3 (browser re-run)]
tech-stack:
  added: []
  patterns: [agreement test across surfaces instead of per-component pins]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
    - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.test.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.scenario-parity.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
    - src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-header.test.tsx
key-decisions:
  - "The sr-only pointer was retired, not narrowed: under C7 no line of the note explains a glance figure, and narrowing would need a new signal for 'this line explains that cell'. Scenario's live strip (`KpiStrip`) prints a bare dash for a null figure, and the glance now does the same."
  - "Two clauses stay passive on purpose ('is recomputed once a day', 'so it is not shown'): comments in queries.ts, queries.my-allocation.test.ts, EquityHistoryRebuilding.tsx and the Scenario own-book sentence quote them verbatim, and an active rewrite would make those quotes false."
  - "The Risk section line is a planner extension of D-10's principle and sits in its own commit so it can be reverted alone."
requirements-completed: [ROUTE-07]
status: complete
duration: about 45 min
completed: 2026-11-09
commits: 3
plan_head_before: 86e158616e30ab0a252283174c574b8bbad3cc9d
plan_head_after: a0e20046cb84bd5fb09c0344ba432af48d24a374
actuals:
  tokens: 5000
  tasks: 3
  commits: 3
---

# Phase 198 Plan 14: the glance and the note stop contradicting each other Summary

Gap 198-UAT-01 closed: on a rebuilding Overview the glance prints YTD TWR, Sharpe and Max DD from the live per-key figures, and nothing below it (note, glance cell, Risk section) says return or risk is missing.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (tracer) | Book-level lines name what the withheld history hides | 3c9a1b771 |
| 2 | The glance points at no note: sr-only pointer and its prop retired | 8bae6f65c |
| 3 | The Risk line names what the section needs; phase gates | a0e20046c |

## The new copy (exact strings)

- `BOOK_LINE.awaiting_derivation`: "Your book's history is recomputed once a day from each account's returns and cash flows. The equity chart and the ratios built from it appear after the next recompute."
- `BOOK_LINE.derivation_rejected`: "The latest rebuild of your book's history did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden."
- Risk section not-ready paragraph (rendered): "This section needs your book's history. See the note above."

Each reason keeps its class meaning (`REBUILD_REASON_CLASS`): `awaiting_derivation` still names the daily recompute (`recomputed once a day`, which `queries.ts`, `queries.my-allocation.test.ts` and the `EquityHistoryRebuilding.tsx` class comment quote), and `derivation_rejected` names no run and carries `did not pass its checks, so it is not shown` verbatim.

## What was built

- `MissingDataMessage.tsx`: the two `BOOK_LINE` values above, plus one sentence in the `BOOK_LINE` doc comment recording D-10. Every other line, `UNKNOWN_REASON_LINE`, `CAUSE_BY_REASON`, key-line code and ordering are byte-unchanged (D-01).
- `GlancePanel.tsx`: the `notShown` helper, its three call sites and the boolean pointer prop are deleted; each cell's value is the formatted string or `sharpeContent` alone. A withheld Sharpe still carries its own reason through `annualizedCell`. Header comment rewritten (C7, D-10); the C5 sentence kept.
- `AllocationDashboardV2.tsx`: the `<GlancePanel` mount no longer passes the pointer prop (comment above it rewritten); the Risk not-ready paragraph reads the new sentence.
- Tests: new `describe` "198-UAT-01" in `GlancePanel.test.tsx` renders the full Overview for the 8 rebuild reasons plus null, asserts the three glance values, that the missing-data section matches neither `/\b(return|risk)\b/i`, that the page never matches `/note below/i`, that the three hidden-history reasons name "The equity chart and the ratios built from it", and that the `#risk` paragraph names neither return nor risk and keeps "See the note above.". Pins in `MissingDataMessage.test.tsx`, `AllocationDashboardV2.rebuilding.test.tsx` and `OverviewRisk.history-parity.test.tsx` rewritten in place (none deleted); the two glance-pointer assertions in the rebuilding test were inverted; the removed prop was dropped from the `GlancePanel.scenario-parity.test.tsx` and `HoldingsTabPanel.positions-header.test.tsx` renders.

## Deviations from Plan

### DESIGN.md Voice: two passive clauses

DESIGN.md Voice prefers active, declarative copy. "is recomputed once a day" and "so it is not shown" stay passive because comments in files this plan must not or need not touch quote them verbatim (see key-decisions). The pre-198 shipped lines and the shipped unknown-reason line ("are hidden for now") use the same form. This was decided in the plan, not discovered during execution.

### UI-SPEC rows superseded (D-08, D-10)

D-10 and this plan override these UI-SPEC copy rows (research corrections win over the UI-SPEC):

1. the book-level sentence for `awaiting_derivation` (the "Book return and risk are recomputed ... They appear after the next recompute." wording),
2. the book-level sentence for `derivation_rejected` (the "... so book return and risk are not shown." wording),
3. the glance's sr-only pointer row ("Not shown: see the note below."), retired and not narrowed (C7, D-06: the glance reads `liveBaselineMetrics`, which the history state does not withhold, so no note line explains a glance figure),
4. the Risk section's not-ready line row ("Risk figures need the equity history ...").

The UI-SPEC additional truth "At-a-glance panel, partial" stays overridden by C7 / D-06 (plan 198-01); D-10 now retires its sr-only half too. E3 (missing-data message states) still holds: only the two book-level sentences changed.

### Auto-fixed issues

None. The plan executed as written. One mechanical note: the plan's acceptance greps count comments, so comments describe the retired copy and prop by concept and quote neither.

## Neuter records

Each neuter backed the edited file up to the session scratchpad, applied the neuter, saw RED by name, restored with `cp -p`, confirmed `cmp` exit 0 and silent, and saw GREEN again. No git checkout, restore or stash was used.

- gc-198-14-neuter: gate=GlancePanel.test 198-UAT-01 book-level lines result=red restored=identical
  (pre-edit `MissingDataMessage.tsx` copied over the edited file: exactly the `awaiting_derivation` and `derivation_rejected` cases failed, 2 failed of 24; the other 7 reasons passed, which shows the assertion reads real copy. Before the source change the same 2 failed at HEAD.)
- gc-198-14-neuter: gate=AllocationDashboardV2.rebuilding glance pointer result=red restored=identical
  (the retired sr-only span, taken from the pre-edit `GlancePanel.tsx`, rendered in the YTD cell when `ytd === null`: the K1 named-gap case and the "every reason prints at least one line" case failed, 2 of 57.)
- gc-198-14-neuter: gate=GlancePanel.test 198-UAT-01 Risk line result=red restored=identical
  (pre-edit `AllocationDashboardV2.tsx`, carrying Task 2's change and the old Risk line, copied over the edited file: all 9 agreement cases and the `RISK_LINE` cases in `OverviewRisk.history-parity.test.tsx` failed, 79 failed of 118.)

gc-198-14-gates: vitest=green census=green tsc=clean lint=clean

Gate detail: `npx vitest run "src/app/(dashboard)/allocations" src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/figure-gate-census.test.ts` reported 186 test files passed, 3629 tests passed, none failed or skipped. `npx tsc --noEmit` exit 0 with no output. `npm run lint` exit 0 with 0 errors and 2 warnings, both pre-existing unused-var warnings in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`). `node scripts/verify-plan-anchors.mjs` on the plan: 21 claims checked, no stale claims.

Acceptance greps: `grep -a -rli "book return and risk" src` and `grep -a -rl "noteBelow" src` print nothing; `GlancePanel.tsx` has 0 `sr-only` elements of its own and 0 "see the note below"; `MissingDataMessage.tsx` carries "recomputed once a day" once, "did not pass its checks, so it is not shown" once and "The equity chart and the ratios built from it" 3 times; `AllocationDashboardV2.tsx` carries "Risk figures need" 0 times, the new Risk line once and "See the note above." once. Task 1 and Task 2 commits list only paths from their `<files>`; `EquityHistoryRebuilding.tsx`, `ScenarioComposer*` and all Phase 196 files are untouched.

## Known Stubs

None.

## Threat Flags

None. Copy-only change, no new endpoint, auth path or schema; T-198-24 mitigated by the agreement test and the three neuter records.

## For the orchestrator

Browser UAT test 3 in `198-UAT.md` needs a re-run at 375px and 1280px on the deployed build, on a book whose history is withheld. STATE.md and ROADMAP.md were not touched (no state handlers run), per the dispatch notes.

## Self-Check: PASSED

- Commits 3c9a1b771, 8bae6f65c and a0e20046c are ancestors of HEAD.
- All nine modified source and test files exist and carry the expected strings (acceptance greps above).

## Post-review amendments (review round 1, 2026-11-09)

Superseding two statements above, per 198-14-REVIEW.md:
- WR-01: `awaiting_derivation` now reads "Your book's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden." The earlier "appear after the next recompute" promised ratios a short-record book would not get (194 D-15 gate).
- SFH-01: the glance pointer is NARROWED, not retired. A dash cell carries sr-only "No live figures yet. See the note below." only when the live series is empty (`figures.seriesEndDay === null`, all three live figures null), not all keys are stale, and a missing-data note renders below. A cell that prints a value never carries it, so 198-UAT-01 stays closed.
- SFH-02: the agreement test's return/risk guard now catches plural wording.
Round 2 (code reviewer and silent-failure hunter): no MEDIUM+ findings.
