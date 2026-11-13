---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 40
subsystem: copy-census
tags: [plainwords, dates, copy-census, rule-c, gap-closure, sc-3, f-11, d-11, d-21, clar-06]
requires: ["201-35", "201-36", "201-37", "201-38", "201-39"]
provides:
  - "copy census rule C forms date-field and iso-literal over all of src/"
  - "DATES.fieldNames in policy.ts, typed again in scan.test.ts in both directions"
  - "three reasoned rule C exceptions (38 total); TODO 201-F11-DATE-RESIDUALS-01 closed"
affects: []
key-files:
  modified:
    - scripts/copy-census/scan.ts
    - scripts/copy-census/scan.test.ts
    - scripts/copy-census/policy.ts
    - src/__tests__/copy-census.test.ts
    - TODOS.md
decisions:
  - "The date-field form is mechanism only: it reads policy.dates.fieldNames, and a planted policy with one invented name proves it holds no list."
  - "The iso-literal day pattern lives in scan.ts, like the 0..10 slice bounds: it is mechanism, not vocabulary."
  - "The three R3-01 exclusions are reasoned rows with existing closed-set reasons; no reason shape was added."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
commits: 3
plan_head_before: 0ede02fe9d201f861ca3fef713f65434773558a7
plan_head_after: 4522858fb263462d3b93ec9824b0bf19b46a12be
actuals:
  tokens: 6500
  tasks: 3
  commits: 3
---

# Phase 201 Plan 40: SC-3 date gate Summary

Copy census rule C now reads a raw date field printed as a JSX child or in a prose template (`date-field`) and an ISO day typed into JSX text (`iso-literal`), so a reintroduced raw date at any R3-01 site, or a new one, fails the census by file and rule; TODO `201-F11-DATE-RESIDUALS-01` is closed with re-runnable evidence.

`plan_head_after` is the head after the last task commit; the SUMMARY commit follows it.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | iso-literal: an ISO day in JSX text is a rule C hit | 7f1541403 | scan.ts, scan.test.ts |
| 2 | date-field: a raw date field as a child or in a prose template | 876e4a887 | scan.ts, scan.test.ts, policy.ts, copy-census.test.ts |
| 3 | close the booked TODO, run every gate | 4522858fb | TODOS.md |

## What changed

- `scan.ts`: `ruleC` gained a `JsxText` branch (`iso-literal`, one hit per text node, read through `.text`, hit text is the normalised trimmed text), a `JsxExpression` branch (child of an element or fragment only) and a `TemplateExpression` branch (prose in the literal parts, `skipsCopy` honoured), both `date-field`. `printedLeaves` unwraps parentheses, `!`, `as`, `satisfies`, both conditional branches and both operands of `??` and `||`; `leafName` reads an identifier, a property's final name, or the object of a numeric-literal index. `DatePolicy.fieldNames` is new and required. The header names both forms and their blind spots.
- `policy.ts`: `DATES.fieldNames` (the 21 names), a comment that a name is never a reason to except a hit, and three rule C exception rows.
- `scan.test.ts`: RED and GREEN arms for both forms (including one planted template and one child per name in `DATES.fieldNames`), the typed name list in both directions, and the policy-supplied-names arm. The hand-built policy literal gained `fieldNames`.
- `copy-census.test.ts`: `PINNED_EXCEPTION_COUNT` 35 to 38, three typed rows, comment updated.
- `TODOS.md`: `201-F11-DATE-RESIDUALS-01` closed in place, Reading, Owner and Trigger kept as lineage.

## Verification (real output)

| Command | Result |
|---|---|
| `node scripts/verify-plan-anchors.mjs <plan>` (before work) | exit 0, 9 claims, no stale |
| Task 1: `vitest run scan.test.ts copy-census.test.ts` + `run.ts --summary` | 101 passed; `remaining  files=0  A=0 B=0 C=0  exceptions=35` |
| Task 2: same command | 111 passed; `remaining  files=0  A=0 B=0 C=0  exceptions=38` |
| `npm run lint` | exit 0, 0 errors, 4 warnings, all `no-unused-vars` in files this plan did not touch (MetricsColumn.tsx, composite-read-path.ts, queries.stale-analytics-detail.test.ts); planning-hygiene, route-contract, canonical-domain checks OK |
| `npm run typecheck` | exit 0 |
| `node scripts/verify-plan-anchors.mjs --pending` | exit 0, `claims: 9 checked`, `OK: 1 plan file(s), no stale claims.` |
| Task 3 guard files (12 files named in the plan's verify) | Test Files 12 passed (12), Tests 627 passed (627) |
| Full suite `npx vitest run --reporter=dot` | Test Files 1 failed, 1230 passed, 20 skipped (1251); Tests 2 failed, 25795 passed, 306 skipped (26103) |

The two full-suite failures are the accepted pre-existing ones: `src/lib/factsheet/compute.conventions.test.ts` fixture B (zero-return days) and fixture C (interior calendar gaps), the last-digit `skew` snapshot drift recorded in `201-VERIFICATION.md`. No other test failed.

`gc-201-40-gates: lint=clean tsc=clean anchors=ok guards=green suite=25795 passed/2 failed (compute.conventions fixtures B and C, pre-existing) stale-pins=0 missed-sites=0`

stale-pins: none.
missed-sites: none. On the fixed tree the two forms reported exactly the three R3-01 exclusions and nothing else, so no fix plan missed a site.

## gc-201-40-base: the pre-gap-closure tree

`git worktree add <scratchpad>/base-201-40 5655154af`, node_modules linked, this plan's `scan.ts` and `policy.ts` copied over, `run.ts --summary` run from inside it, worktree removed afterwards:

```
remaining  files=18  A=0 B=0 C=27  exceptions=38
```

`C=27` as the plan expected (25 `date-field` + 5 `iso-literal` = 30, less the three exceptions that consume theirs). Per-file `run.ts --file` output for the 18 files:

```
== src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
C ...HoldingsTabPanel.tsx:155 `Positions from ${phrase} are as last read on ${asof}: ${symbols.join(", ")}.`
C ...HoldingsTabPanel.tsx:184 `Spot holdings from ${phrase} are as last read on ${asof}: ${symbols.join(", ")}
C ...HoldingsTabPanel.tsx:272 `Open positions from ${keyPhrase(key, venue)} could not be read on its sync of $
== src/app/(dashboard)/allocations/components/BlendHeader.tsx
C ...BlendHeader.tsx:77 {effStart}
C ...BlendHeader.tsx:79 {effEnd}
== src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx
C ...OutcomeRecordedRow.tsx:61 {outcome.allocated_at}
== src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx
C ...ScenarioCompareTable.tsx:385 {c.metrics.effective_start}
C ...ScenarioCompareTable.tsx:387 {c.metrics.effective_end}
== src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx
C ...AllocationOverTime.tsx:164 {points.at(-1)!.asof}
== src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx
C ...NetExposureChart.tsx:123 {points.at(-1)!.asof}
== src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx
C ...CsvPreviewStep.tsx:116 `${preview.date_range[0]} → ${preview.date_range[1]}`
== src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
C ...CsvSubmitStep.tsx:716 `${preview.date_range[0]} → ${preview.date_range[1]}`
== src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
C ...MultiKeyConnectStep.tsx:2379 {p.windowStart}
C ...MultiKeyConnectStep.tsx:2379 {p.stillLive || !p.windowEnd ? "live" : p.windowEnd}
== src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx
C ...ReviewStep.tsx:215 `${csv.dateRange[0]} → ${csv.dateRange[1]}`
== src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
C ...SyncPreviewStep.tsx:2708 `, ${firstDay} – ${lastDay}`
C ...SyncPreviewStep.tsx:2887 `${pk.first_day} – ${pk.last_day}`
C ...SyncPreviewStep.tsx:2889 `${member.windowStart} – ${member.windowEnd ?? "live"}`
== src/app/(marketing)/legal/disclaimer/page.tsx
C ...disclaimer/page.tsx:16 Last updated: 2026-04-07
== src/app/(marketing)/legal/privacy/page.tsx
C ...privacy/page.tsx:20 Last updated: 2026-04-07
== src/app/(marketing)/legal/terms/page.tsx
C ...terms/page.tsx:22 Last updated: 2026-11-07
== src/app/(marketing)/security/page.tsx
C ...security/page.tsx:403 Last reviewed: 2026-11-07.
== src/app/portfolio-pdf/[id]/page.tsx
C ...portfolio-pdf/[id]/page.tsx:62 Retired 2026-11-07
== src/components/admin/MatchEvalDashboard.tsx
C ...MatchEvalDashboard.tsx:244 {w.week_start}
== src/lib/departed-history.ts
C ...departed-history.ts:386 `History included until ${decision.until}. From the next day a key you still hav
C ...departed-history.ts:388 `History included until ${decision.until}. From the next day a later key read th
C ...departed-history.ts:390 `History included until ${decision.until}.`
```

(The path prefix is abbreviated here with `...`; the real output carries the full repo-relative path.) The fixed tree reads `A=0 B=0 C=0` with the three exclusions consumed. The three exclusions on the fixed tree (before their rows): `MasterBrush.tsx:237 {startDate}`, `MasterBrush.tsx:237 {endDate}`, `StrategyHeader.tsx:78 {strategy.start_date}`, which is the same set the plan named.

## Neuter evidence (byte backup with `cp -p`, restore with `cp -p`, `cmp` exit 0, GREEN after)

- `gc-201-40-neuter: gate=copy-census.test.ts site=src/app/portfolio-pdf/[id]/page.tsx form=iso-literal result=red restored=identical`
  - RED line: `unregistered: src/app/portfolio-pdf/[id]/page.tsx:63 rule C: "Retired 2026-11-07" is not a reasoned exception in policy EXCEPTIONS` (1 failed, 20 passed); after restore 21 passed.
- `gc-201-40-neuter: gate=copy-census.test.ts site=src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx form=date-field result=red restored=identical`
  - RED line: `unregistered: ...NetExposureChart.tsx:123 rule C: "{points.at(-1)!.asof}" is not a reasoned exception in policy EXCEPTIONS` (1 failed, 20 passed).
- `gc-201-40-neuter: gate=copy-census.test.ts site=src/lib/departed-history.ts form=date-field result=red restored=identical`
  - RED line: `unregistered: src/lib/departed-history.ts:391 rule C: "`History included until ${decision.until}.`" is not a reasoned exception in policy EXCEPTIONS` (1 failed, 20 passed).
- Tests first: the new scan.test.ts arms were seen RED before `scan.ts` changed (Task 1: 1 failed, 79 passed; Task 2: 6 failed, 84 passed), then GREEN (90 passed).

## Acceptance greps

- `grep -a -c 'iso-literal'`: scan.ts 2, scan.test.ts 3 (0 at `5655154af`).
- `grep -a -c 'date-field' scripts/copy-census/scan.ts` 3; `grep -a -c fieldNames scripts/copy-census/policy.ts` 1.
- `PINNED_EXCEPTION_COUNT =[ ]38;` 1 hit, `=[ ]35;` 0 hits.
- No new reason shape: `diff` of the `REASONS` block against `git show 5655154af:scripts/copy-census/policy.ts` exits 0.
- TODOS entry: `CLOSED 2026-` 1 hit, `date-field` 1 hit.

## r3-01-coverage

Format: `r3-01-coverage: <site> | plan | test | neuter line`. The neuter column names the per-site `gc-` line; where a plan recorded none for that exact file, it says so and names what covers it instead.

- r3-01-coverage: 1 factsheet Terms panel `MandatePanels.tsx` | 201-35 | `FactsheetBody.tearsheet-homes.test.tsx`, `FactsheetView.usd-terms.test.tsx` | gc-201-35-neuter (MandatePanels.tsx)
- r3-01-coverage: 2 Exposure caption `NetExposureChart.tsx` | 201-36 | `NetExposureChart.test.tsx`, `HoldingsTabPanel.exposure.test.tsx` | gc-201-36-neuter (NetExposureChart.tsx), gc-201-40-neuter (date-field)
- r3-01-coverage: 2 Exposure caption `AllocationOverTime.tsx` | 201-36 | `AllocationOverTime.test.tsx` | no own neuter line in plan 201-36; the same `{points.at(-1)!.asof}` shape is neutered at NetExposureChart by gc-201-36 and gc-201-40, and rule C `date-field` now reports this file on the base tree
- r3-01-coverage: 3 Holdings notes `HoldingsTabPanel.tsx` | 201-36 | `HoldingsTabPanel.key-read-notes.test.tsx` | gc-201-36-neuter (HoldingsTabPanel.tsx)
- r3-01-coverage: 4a composer header `BlendHeader.tsx` | 201-37 | `BlendHeader.test.tsx` | gc-201-37-neuter (BlendHeader.tsx)
- r3-01-coverage: 4b effective-window stamp `ScenarioCompareTable.tsx` | 201-37 | `ScenarioCompareTable.test.tsx` | gc-201-37-neuter (ScenarioCompareTable.tsx)
- r3-01-coverage: 4c bar aria-label `CoverageTimeline.tsx` | 201-38 | `CoverageTimeline.test.tsx`, `SyncPreviewStep.composite.render.test.tsx` | gc-201-38-neuter (CoverageTimeline.tsx)
- r3-01-coverage: 4d clamp announcement `CustomRangePicker.tsx` | 201-37 | `CustomRangePicker.test.tsx` | gc-201-37-neuter (CustomRangePicker.tsx)
- r3-01-coverage: 5a wizard `SyncPreviewStep.tsx` | 201-38 | `SyncPreviewStep.composite.render.test.tsx` | gc-201-38-neuter (SyncPreviewStep.tsx)
- r3-01-coverage: 5b wizard `MultiKeyConnectStep.tsx` | 201-38 | `MultiKeyConnectStep.test.tsx` | gc-201-38-neuter (MultiKeyConnectStep.tsx, two lines)
- r3-01-coverage: 5c wizard `ReviewStep.tsx` | 201-38 | `ReviewStep.test.tsx` | gc-201-38-neuter (ReviewStep.tsx)
- r3-01-coverage: 6 exchange manager `departed-history.ts` | 201-39 | `departed-history.test.ts`, `AllocatorExchangeManager.departed-history.test.tsx` | gc-201-39-neuter (departed-history.ts), gc-201-40-neuter (date-field)
- r3-01-coverage: 7 retired PDF page `portfolio-pdf/[id]/page.tsx` | 201-35 | `portfolio-pdf/[id]/page.test.tsx` | gc-201-35-neuter (page.tsx), gc-201-40-neuter (iso-literal)
- r3-01-coverage: 8 composer both-ends Include label `ScenarioComposer.tsx` | 201-37 | `ScenarioComposer.test.tsx` | gc-201-37-neuter (ScenarioComposer.tsx)
- r3-01-coverage: staff `admin/usage/page.tsx` heatmap headers | 201-39 | `admin/usage/page.test.tsx` | gc-201-39-neuter (page.tsx)
- r3-01-coverage: staff `lib/admin/usage-metrics.ts` stale notice | 201-39 | `usage-metrics.test.ts` | gc-201-39-neuter (usage-metrics.ts)
- r3-01-coverage: planner-found factsheet footer stamp `FactsheetView.tsx` | 201-35 | `FactsheetBody.tearsheet-homes.test.tsx`, `FactsheetView.usd-terms.test.tsx` | gc-201-35-neuter (FactsheetView.tsx)
- r3-01-coverage: planner-found legal pages (disclaimer, privacy, terms) and security page | 201-35 | `legal/disclaimer/page.test.tsx`, `security/page.test.tsx`, `public-truth-copy.test.tsx` | no per-page neuter line in plan 201-35; rule C `iso-literal` reports all four on the base tree (see gc-201-40-base) and was neutered RED on the sibling retired PDF page (gc-201-40-neuter, iso-literal)
- r3-01-coverage: planner-found `OutcomeRecordedRow.tsx` | 201-36 | `ScenarioFlaggedHoldingsList.test.tsx` | gc-201-36-neuter (OutcomeRecordedRow.tsx)
- r3-01-coverage: planner-found CSV Preview and Submit pills `CsvPreviewStep.tsx`, `CsvSubmitStep.tsx` | 201-38 | `CsvPreviewStep.date-range.test.tsx`, `CsvSubmitStep.test.tsx` | no per-file neuter line in plan 201-38 (tests seen RED against HEAD first, 3 failed); rule C `date-field` reports both on the base tree, and the form was neutered RED on NetExposureChart and departed-history (gc-201-40-neuter)
- r3-01-coverage: planner-found match-eval Week column `MatchEvalDashboard.tsx` | 201-39 | `MatchEvalDashboard.test.tsx` | gc-201-39-neuter (MatchEvalDashboard.tsx)

## Deviations from Plan

None. The plan executed as written. No straggler arose: `missed-sites` and `stale-pins` are both 0.

## reported-not-edited

None. No phase-200 file was edited (`ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `AllocatorExchangeManager.tsx`, the shared Modal, `e2e/manager-keys.spec.ts`, `.github/workflows/ci.yml`, the two e2e specs). The diff against the plan base touches five files only.

## Known Stubs

None.

## Threat Flags

None. A test-time scanner over source files; nothing reaches production. T-201-58 mitigated (three rows, closed-set reasons, count and typed list moved together, each row consumes one live hit). T-201-59 mitigated (one RED arm per name, base tree measured at 27, three live neuters seen RED). T-201-60 accepted, blind spots stated in the scanner header and in the TODO.

## Notes for the orchestrator

- The CSV Preview pill reverses QA ISSUE-014 for the pill under F-11 (recorded by plan 201-38, restated in the TODO). The sample-row cells stay ISO as file contents.
- Full-suite wall time on this machine was about 262 s for the one run.

## Self-Check: PASSED

- Commits 7f1541403, 876e4a887 and 4522858fb are ancestors of HEAD; `scan.ts`, `scan.test.ts`, `policy.ts`, `copy-census.test.ts` and `TODOS.md` exist and carry the changes; no unexpected deletions; worktree clean before this SUMMARY.
