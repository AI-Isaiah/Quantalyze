---
phase: 198-mybook
verified: 2026-11-09T00:00:00Z
status: human_needed
score: 11/11 must-haves verified (10 original truths regression-checked; gap 198-UAT-01 closed in code); browser re-check outstanding
verified_at_sha: c71cbcc221977d479886d15b50a363119a57b64a
re_verification: true
drift_subjects:
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
  - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.test.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/lib/add-allocation.ts
  - src/app/(dashboard)/allocations/lib/book-figures.ts
  - src/app/(dashboard)/allocations/lib/dust.ts
  - src/app/(dashboard)/allocations/lib/key-data-gaps.ts
  - src/app/(dashboard)/allocations/lib/exposure-snapshot.ts
  - src/lib/closed-sets.ts
  - src/lib/portfolio-exposure.ts
  - src/lib/queries.ts
  - e2e/allocations-add.spec.ts
behavior_unverified: 0
overrides_applied: 0
re_verification_detail:
  previous_status: gaps_found
  previous_score: "10/10 at issue; 1 gap from browser UAT"
  previous_verified_at_sha: 87878904ed3bb27d8c350cec7d9e73d5585b9250
  gaps_closed:
    - gap_id: 198-UAT-01
      status: closed
      resolved_by: 198-14-PLAN.md
      resolved_at: 2026-11-09
      truth: "SC-2 second half: the missing-data message agrees with what the Overview shows"
  gaps_remaining: []
  regressions: []
gaps: []
human_verification:
  - test: "UAT test 3 re-run on the deployed build at 375px and 1280px, on a book whose history is withheld (rebuilding or held back): read the glance and the 'What is missing' note together, then run a screen reader over the glance cells"
    expected: "Glance prints YTD TWR, Sharpe and Max DD; the note says only that the equity chart and the ratios built from it are hidden or recomputed (never that book return and risk are not shown); no glance cell that prints a value announces a note; a fully dashed glance (no live series) announces 'No live figures yet. See the note below.' only on its dash cells; the Risk section says 'This section needs your book's history. See the note above.'"
    why_human: "Needs the deployed build and the founder's real book; the original contradiction was found only in the browser, and the code review flagged that 'the ratios ... are hidden' sits under a glance that prints Sharpe, a wording call a human must make."
  - test: "Seeded e2e e2e/allocations-add.spec.ts (valid ?add=<id> opens step 2 pre-filled, add leaves the URL, axe clean on both steps, reload does not reopen; malformed id opens step 1 with the not-available notice)"
    expected: "Both tests pass in CI's seeded e2e job bound to the head SHA"
    why_human: "Runs only in CI against a seeded stack; not runnable locally. CI-pending, not failed."
  - test: "Visual pass on /allocations at desktop and mobile: Overview ordering (glance, missing-data lines, Risk, Mandate) and the header + Allocation slide-over on each tab"
    expected: "Matches 198-UI-SPEC and DESIGN.md (Numbers Contract, 9-State Matrix); no clipping of the tab strip or header button"
    why_human: "Visual layout and density cannot be judged from jsdom tests. UAT 2026-11-09 tests 1 and 2 passed on production at 375px and 1280px (tabs, glance presence, Holdings labels, dust), so what remains is the Overview ordering and the slide-over on every tab."
---

# Phase 198: MYBOOK Verification Report

**Phase Goal:** An allocator opening My allocation sees the book's return, risk and holdings at a glance (or exactly what is missing), "+ Allocation" opens the allocator's own flow, Holdings labels positions correctly, and the page has at most three tabs with each position listed once and dust hidden.
**Verified:** 2026-11-09 at `c71cbcc221977d479886d15b50a363119a57b64a` (worktree `quantalyze-198-gaps`, branch `phase-198-gaps`)
**Status:** human_needed
**Re-verification:** Yes, after gap closure (plan 198-14, gap 198-UAT-01). Original truths first verified at `87878904ed3bb27d8c350cec7d9e73d5585b9250`.

## Re-verification: gap 198-UAT-01 (CLOSED in code)

Browser UAT 2026-11-09 found the Overview glance printing YTD TWR, Sharpe and Max DD while the note below said "book return and risk are not shown", and a glance dash pointing at that note. Closure is verified against `git diff 86e158616..HEAD -- src` (8 files, +238/-33), not against 198-14-SUMMARY.md.

| Closure requirement (UAT `missing`) | Evidence in code at c71cbcc22 | Status |
|---|---|---|
| Book-level lines name what the withheld history hides, never "book return and risk" | `MissingDataMessage.tsx` `BOOK_LINE.awaiting_derivation`: "...Until the next recompute, the equity chart and the ratios built from it are hidden."; `BOOK_LINE.derivation_rejected`: "...did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden." `grep -a -rli "book return and risk" src` prints nothing. Round-1 WR-01 also removed the false promise that ratios appear after the next recompute. | CLOSED |
| No visible or sr-only text says return or risk is not shown on a rebuilding Overview with live figures | The Risk not-ready paragraph in `AllocationDashboardV2.tsx` reads "This section needs your book's history. See the note above." The string "Not shown: see the note below." is gone from non-test source (remaining hits are `not.toContain` absence assertions). The agreement test renders the full Overview for 8 rebuild reasons plus null with populated live figures. | CLOSED |
| Narrowed sr-only pointer renders only on dash cells, only with no live series, only with a note below | `GlancePanel.tsx`: `noLiveFigures = noteBelow && !allKeysStale && figures.seriesEndDay === null`; `noFiguresPointer(value, withheld)` requires `value === null && noLiveFigures && !withheld`. `AllocationDashboardV2.tsx:291` passes `noteBelow={missingLines.length > 0}`; `MissingDataMessage` returns null exactly when there are no lines, so the note below always exists. Review round 2 traced both live-baseline builders: an empty series implies all three live figures are null, so "No live figures yet" is true wherever it renders. | CLOSED |
| A failing-capable test pins both on a rebuilding book with populated live figures | `GlancePanel.test.tsx` describe "198-UAT-01: the glance and the missing-data note agree on a rebuilding Overview" (9 cases) plus the SFH-01 block. Neuter below. | CLOSED |

### Neuter (the gap test can fail)

Backed up `MissingDataMessage.tsx` to `/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/811b5ebe-bc14-48be-a394-2c28565a5150/scratchpad/MissingDataMessage.tsx.bak`, put the old `derivation_rejected` sentence ("The latest rebuild of your book's history did not pass its checks, so book return and risk are not shown.") back, ran `GlancePanel.test.tsx`: RED by name, 1 failed of 29 ("198-UAT-01 ... reason derivation_rejected: the glance prints its live values and the note names neither return nor risk"), the other 28 passed. Restored with `cp -p`; `cmp` silent (exit 0); `git status` clean. No git checkout, restore or stash used.

### Gate runs in this re-verification

| Gate | Command | Result |
|---|---|---|
| Targeted vitest | `npx vitest run "src/app/(dashboard)/allocations" src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts` | 184 files, 3598 tests passed, 0 failed |
| Types | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` | 0 errors, 2 warnings (`MetricsColumn.tsx` `nativeUnitReason`, `composite-read-path.ts` `isRankableAnalyticsRow`, neither touched by this phase); route-contract, planning-hygiene and canonical-domain checks OK. The shell exit code was not captured through the pipe; the tool's own summary reports 0 errors. |

### Residual risks (recorded, not gaps)

- `GlancePanel`'s `!withheld` and `value === null` guards cannot change output on the two server-side builders (review round 2, LOW); two SFH-01 cases would stay green if either guard were deleted.
- The note can explain a different cause than the dashes when a live series is empty under a rebuilding reason; the pointer sentence stays true.
- "The ratios built from it are hidden" sits under a glance that prints Sharpe; the wording follows the `UNKNOWN_REASON_LINE` precedent and the glance caption distinguishes the sources, but the review asked for a browser look (human item 1).
- The pointer is announced once per dashed cell (three times).
- Two copy clauses stay passive against DESIGN.md Voice by documented plan decision.
- Review round 2 of 198-14 found no MEDIUM+; the round-1 fixes had no third round, but round 2 traced them end to end.

## Goal Achievement

### Observable Truths (original ten, regression-checked at c71cbcc22)

| # | Truth | Status | Evidence (from the 87878904 verification) | Regression |
|---|-------|--------|----------|------------|
| 1 | SC-1: "+ Allocation" opens an allocator's flow on every tab, never the manager's wizard | VERIFIED | One header button in `AllocationsTabs.tsx` (`handleHeaderAdd` sets `addFlow.open`, no per-tab branching) renders `AddAllocationFlow`, a tab-agnostic host mounted outside the three tabpanels. `AddAllocationFlow.tsx` does not import `WizardClient` or `ContributionWizardOverlay` (grep). `ContributionWizardOverlay` survives only inside `ScenarioComposer`/`StrategyBrowseDrawer` for the connect-a-key path, not behind "+ Allocation". Test: `AllocationsTabs.addalloc.test.tsx` passes. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 2 | SC-2: Overview shows return, risk and holdings at a glance, same values as Scenario and Holdings (single source) | VERIFIED | `lib/book-figures.ts` is the one module. Consumers: `GlancePanel.tsx` (Overview, `liveBookFigures` + `bookEquityUsd`), `ScenarioComposer.tsx:4488` (`liveBookFigures(payload.liveBaselineMetrics)`), `HoldingsTabPanel.tsx:549` (`bookEquityUsd`), `AllocationsTabs.tsx:650` (same for the flow). Figures are independent of `equityHistoryState` (C7); Sharpe gated through 194 D-15 (`gateAnnualized`/`gatedValue`). `GlancePanel.scenario-parity.test.tsx` passes. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 3 | SC-2 (second half): when data is missing the page names key, days and action instead of the generic notice | VERIFIED | `lib/key-data-gaps.ts` produces per-key gaps into the SSR payload (`queries.ts` `keyDataGaps`, `deriveKeyDataGapsField`). `MissingDataMessage.tsx` prints one line per affected key, labelled through `apiKeyLabelById(apiKeys)` (foreign ids print nothing), unnamed fallbacks only when no key is named. "holding back your equity history" appears in src only in tests asserting its absence and in a comment. `MissingDataMessage.test.tsx` (incl. "no named-key line blames 'your keys'") passes. Dead key affects only itself (founder rule) is test-pinned. | re-verified in full (gap closed, below) |
| 4 | SC-3a: Holdings does not call allocated positions "not allocated" | VERIFIED | No user-visible "not allocated" string in non-test src (only two code comments in `strategies-row-adapter.ts`). `HoldingsTable.tsx:566` renders "no amount entered" for an own-capital strategy with no amount; `HoldingsTable.strategy-rows.test.tsx:447,710` assert it and that it is never "not allocated". | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 5 | SC-3b: cash is not counted as Spot exposure; cash rows typed Cash | VERIFIED | `closed-sets.ts` `CASH_SYMBOLS` = {USDT, USDC, DAI, BUSD, TUSD, FDUSD, USD}, member-for-member equal to Python `STABLECOINS` (analytics-service `closed_sets.py:237`), pinned by `closed-sets.cash-symbols.test.ts`. `isCashHolding` excluded from slices (`exposure-snapshot.ts:58`, `portfolio-exposure.ts:378`), `cashUsd` reported separately (null when unread, never 0). `HoldingsTable.tsx:859` Type cell reads "Cash". `HoldingsTabPanel.exposure.test.tsx` "ROUTE-08: a spot USDT row is the Cash cell, not Spot gross" and the exposure-agreement test pass. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 6 | SC-4a: at most three tabs; legacy `?tab` aliases keep working (D-02) | VERIFIED | `VISIBLE_TAB_KEYS = [overview, holdings, scenario]`; closed `LEGACY_TAB_ALIASES` map: outcomes -> Holdings `#outcomes`, risk -> Overview `#risk`, mandate -> Overview `#mandate`; `performance` and unknown fall to Overview; the anchor is never read from the URL. Sections exist with those ids (`HoldingsTabPanel` `#outcomes`; `AllocationDashboardV2` `#risk`, `#mandate`, including the no-key early-return branch per review WR-04). `AllocationsTabs.test.tsx` passes. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 7 | SC-4b: each position listed once (D-02) | VERIFIED | `flagged-position-map.ts` + `flag` prop on both position tables; the separate flagged list is gone from Holdings. `HoldingsTabPanel.positions-once.test.tsx` asserts every row id appears in exactly one `[data-position-row]`. Holdings order Strategies, Positions, Exposure, Outcomes (`HoldingsTabPanel.tsx` sections 1-4; `exposure.test.tsx` "Exposure AFTER Positions and BEFORE Outcomes"). | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 8 | SC-4c / D-04: dust (strictly under $50 or under 0.1% of Book equity) hidden by default behind "Show n small positions" | VERIFIED | `lib/dust.ts`: strict `<` on both tests, unpriced/untrusted-key/non-finite rows never dust, one `dustIds` set over spot and derivative rows, remount re-hides. `HoldingsTabPanel.dust.test.tsx` covers hidden-by-default, toggle, "exactly $50 stays visible", "exactly 0.1% stays visible; a dollar under hides", totals unchanged hidden vs shown. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 9 | D-07: `/allocations?add=<strategyId>` opens the flow pre-filled and is stripped from the URL | VERIFIED (unit); e2e CI-pending | `AllocationsTabs.tsx` effect reads `add`, sets flow state, `replaceState` removes it; flow validates uuid and resolves against the allocator-gated browse list (URL never trusted, no write without a press). `AllocationsTabs.add-param.test.tsx` passes. Seeded e2e is human_needed below. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |
| 10 | D-05: two existing write routes, idempotent third-party add, no new endpoint | VERIFIED | `lib/add-allocation.ts`: own strategy (`isOwn === true`) -> `ALLOCATION_ROUTE` `{strategy_id, allocated_amount}`; anyone else's -> one `voluntary_add` diff to `/api/allocator/scenario/commit`, refused when Book equity is unusable or all keys stale. `AddAllocationFlow.tsx` sends `Idempotency-Key` (`generateIdempotencyKey`, held in `idempotencyKeyRef`), re-sends the SAME key and stored body on Retry (R2-01), clears on a new request, handles `idempotency_body_mismatch`. Only `src/app/api/allocator/{holdings,scenario}` and `portfolio-strategies/{alias,allocation}` exist; no new route. Commit route validates `voluntary_add` and the key shape. `add-allocation.test.ts` and `AddAllocationFlow.test.tsx` pass. | no regression (allocations suite green, tsc clean, symbols re-grepped at c71cbcc22) |


**Score:** 11/11 verified (10 original truths with no regression, plus gap 198-UAT-01 closed). 0 present-but-behavior-unverified. The e2e and browser items are human items, not failed truths.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ROUTE-06 (+ Allocation flow, `?add=` entry) | SATISFIED | truths 1, 9, 10 |
| ROUTE-07 (glance, same values, names what is missing, never contradicts it) | SATISFIED in code; browser re-check outstanding | truths 2, 3; 198-UAT-01 closed |
| ROUTE-08 (Holdings labels, cash out of exposure) | SATISFIED | truths 4, 5 (UAT test 2 passed in browser) |
| LEAN-06 (three tabs, positions once, dust hidden) | SATISFIED | truths 6, 7, 8 (UAT tests 1 and 2 passed in browser) |

### Anti-Patterns Found

None blocking. `grep -a -rn noteBelow src` outside tests shows only the narrowed prop and its wiring. No TBD/FIXME/XXX introduced.

### Warnings carried from the original verification (unchanged, not gaps)

1. R3-01 residual: a `shared_account_failing` group whose latest day is yesterday, printed beside a gap-bearing group, can still omit the attributed key's fallback.
2. Retry re-runs `buildAllocationRequest` against live Book equity; a refresh that lowers equity can refuse a stored-body Retry with an amount error. Nothing false is sent.
3. Carry note for Phase 196: `resolveDeepLink` should adopt the same `notOwnCapital` test before 196 links an owner's own factsheet to `?add=`.
4. Deferred by decision (CONTEXT FD-3): sidebar and mobile "Add a Strategy" still open the manager `WizardClient`; follow-up to be booked.
5. `src/lib/factsheet/compute.conventions.test.ts` skew last-digit is local-only noise, untouched by this phase and outside the targeted run.

### Human Verification Required

1. **UAT test 3 re-run on the deployed build (375px and 1280px).** Founder browser check of the fixed missing-data message on a book whose history is withheld, including the screen-reader reading of the glance cells. The fix is shipped-pending (not yet on the deployed build), so test 3 is not marked pass.
2. **Seeded e2e in CI** (`e2e/allocations-add.spec.ts`), CI-pending.
3. **Visual pass** on the Overview ordering and the "+ Allocation" slide-over on every tab; UAT tests 1 and 2 already passed on production.

### Gaps Summary

No open gaps. Gap 198-UAT-01 is closed in code and test-pinned (resolved_by 198-14-PLAN.md). Status is human_needed because the browser re-check of the fixed message on the deployed build, the CI-pending seeded e2e and the remaining visual pass are outstanding.

---

_Verified: 2026-11-09_
_Verifier: Claude (gsd-verifier), re-verification_
