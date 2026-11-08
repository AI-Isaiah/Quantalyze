---
phase: 198-mybook
verified: 2026-11-09T00:00:00Z
status: human_needed
score: 10/10 must-haves verified (code and unit/component evidence); 0 gaps; seeded e2e CI-pending
verified_at_sha: 87878904ed3bb27d8c350cec7d9e73d5585b9250
drift_subjects:
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
  - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
  - src/app/(dashboard)/allocations/components/GlancePanel.tsx
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
human_verification:
  - test: "Seeded e2e e2e/allocations-add.spec.ts (valid ?add=<id> opens step 2 pre-filled, add leaves the URL, axe clean on both steps, reload does not reopen; malformed id opens step 1 with the not-available notice)"
    expected: "Both tests pass in CI's seeded e2e job bound to the head SHA"
    why_human: "Runs only in CI against a seeded stack; not runnable locally. CI-pending, not failed."
  - test: "Visual pass on /allocations at desktop and mobile: three-tab strip, Overview glance then missing-data lines then Risk then Mandate, Holdings order, dust control, header + Allocation slide-over"
    expected: "Matches 198-UI-SPEC and DESIGN.md (Numbers Contract, 9-State Matrix); no clipping of the tab strip or header button"
    why_human: "Visual layout and density cannot be judged from jsdom tests."
---

# Phase 198: MYBOOK Verification Report

**Phase Goal:** An allocator opening My allocation sees the book's return, risk and holdings at a glance (or exactly what is missing), "+ Allocation" opens the allocator's own flow, Holdings labels positions correctly, and the page has at most three tabs with each position listed once and dust hidden.
**Verified:** 2026-11-09 at `87878904ed3bb27d8c350cec7d9e73d5585b9250` (worktree `quantalyze-198`, branch `feat/198-mybook`)
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: "+ Allocation" opens an allocator's flow on every tab, never the manager's wizard | VERIFIED | One header button in `AllocationsTabs.tsx` (`handleHeaderAdd` sets `addFlow.open`, no per-tab branching) renders `AddAllocationFlow`, a tab-agnostic host mounted outside the three tabpanels. `AddAllocationFlow.tsx` does not import `WizardClient` or `ContributionWizardOverlay` (grep). `ContributionWizardOverlay` survives only inside `ScenarioComposer`/`StrategyBrowseDrawer` for the connect-a-key path, not behind "+ Allocation". Test: `AllocationsTabs.addalloc.test.tsx` passes. |
| 2 | SC-2: Overview shows return, risk and holdings at a glance, same values as Scenario and Holdings (single source) | VERIFIED | `lib/book-figures.ts` is the one module. Consumers: `GlancePanel.tsx` (Overview, `liveBookFigures` + `bookEquityUsd`), `ScenarioComposer.tsx:4488` (`liveBookFigures(payload.liveBaselineMetrics)`), `HoldingsTabPanel.tsx:549` (`bookEquityUsd`), `AllocationsTabs.tsx:650` (same for the flow). Figures are independent of `equityHistoryState` (C7); Sharpe gated through 194 D-15 (`gateAnnualized`/`gatedValue`). `GlancePanel.scenario-parity.test.tsx` passes. |
| 3 | SC-2 (second half): when data is missing the page names key, days and action instead of the generic notice | VERIFIED | `lib/key-data-gaps.ts` produces per-key gaps into the SSR payload (`queries.ts` `keyDataGaps`, `deriveKeyDataGapsField`). `MissingDataMessage.tsx` prints one line per affected key, labelled through `apiKeyLabelById(apiKeys)` (foreign ids print nothing), unnamed fallbacks only when no key is named. "holding back your equity history" appears in src only in tests asserting its absence and in a comment. `MissingDataMessage.test.tsx` (incl. "no named-key line blames 'your keys'") passes. Dead key affects only itself (founder rule) is test-pinned. |
| 4 | SC-3a: Holdings does not call allocated positions "not allocated" | VERIFIED | No user-visible "not allocated" string in non-test src (only two code comments in `strategies-row-adapter.ts`). `HoldingsTable.tsx:566` renders "no amount entered" for an own-capital strategy with no amount; `HoldingsTable.strategy-rows.test.tsx:447,710` assert it and that it is never "not allocated". |
| 5 | SC-3b: cash is not counted as Spot exposure; cash rows typed Cash | VERIFIED | `closed-sets.ts` `CASH_SYMBOLS` = {USDT, USDC, DAI, BUSD, TUSD, FDUSD, USD}, member-for-member equal to Python `STABLECOINS` (analytics-service `closed_sets.py:237`), pinned by `closed-sets.cash-symbols.test.ts`. `isCashHolding` excluded from slices (`exposure-snapshot.ts:58`, `portfolio-exposure.ts:378`), `cashUsd` reported separately (null when unread, never 0). `HoldingsTable.tsx:859` Type cell reads "Cash". `HoldingsTabPanel.exposure.test.tsx` "ROUTE-08: a spot USDT row is the Cash cell, not Spot gross" and the exposure-agreement test pass. |
| 6 | SC-4a: at most three tabs; legacy `?tab` aliases keep working (D-02) | VERIFIED | `VISIBLE_TAB_KEYS = [overview, holdings, scenario]`; closed `LEGACY_TAB_ALIASES` map: outcomes -> Holdings `#outcomes`, risk -> Overview `#risk`, mandate -> Overview `#mandate`; `performance` and unknown fall to Overview; the anchor is never read from the URL. Sections exist with those ids (`HoldingsTabPanel` `#outcomes`; `AllocationDashboardV2` `#risk`, `#mandate`, including the no-key early-return branch per review WR-04). `AllocationsTabs.test.tsx` passes. |
| 7 | SC-4b: each position listed once (D-02) | VERIFIED | `flagged-position-map.ts` + `flag` prop on both position tables; the separate flagged list is gone from Holdings. `HoldingsTabPanel.positions-once.test.tsx` asserts every row id appears in exactly one `[data-position-row]`. Holdings order Strategies, Positions, Exposure, Outcomes (`HoldingsTabPanel.tsx` sections 1-4; `exposure.test.tsx` "Exposure AFTER Positions and BEFORE Outcomes"). |
| 8 | SC-4c / D-04: dust (strictly under $50 or under 0.1% of Book equity) hidden by default behind "Show n small positions" | VERIFIED | `lib/dust.ts`: strict `<` on both tests, unpriced/untrusted-key/non-finite rows never dust, one `dustIds` set over spot and derivative rows, remount re-hides. `HoldingsTabPanel.dust.test.tsx` covers hidden-by-default, toggle, "exactly $50 stays visible", "exactly 0.1% stays visible; a dollar under hides", totals unchanged hidden vs shown. |
| 9 | D-07: `/allocations?add=<strategyId>` opens the flow pre-filled and is stripped from the URL | VERIFIED (unit); e2e CI-pending | `AllocationsTabs.tsx` effect reads `add`, sets flow state, `replaceState` removes it; flow validates uuid and resolves against the allocator-gated browse list (URL never trusted, no write without a press). `AllocationsTabs.add-param.test.tsx` passes. Seeded e2e is human_needed below. |
| 10 | D-05: two existing write routes, idempotent third-party add, no new endpoint | VERIFIED | `lib/add-allocation.ts`: own strategy (`isOwn === true`) -> `ALLOCATION_ROUTE` `{strategy_id, allocated_amount}`; anyone else's -> one `voluntary_add` diff to `/api/allocator/scenario/commit`, refused when Book equity is unusable or all keys stale. `AddAllocationFlow.tsx` sends `Idempotency-Key` (`generateIdempotencyKey`, held in `idempotencyKeyRef`), re-sends the SAME key and stored body on Retry (R2-01), clears on a new request, handles `idempotency_body_mismatch`. Only `src/app/api/allocator/{holdings,scenario}` and `portfolio-strategies/{alias,allocation}` exist; no new route. Commit route validates `voluntary_add` and the key shape. `add-allocation.test.ts` and `AddAllocationFlow.test.tsx` pass. |

**Score:** 10/10 truths verified (0 present-but-behavior-unverified; the one e2e is a CI-pending human item, not a failed truth).

### Behavioral Spot-Checks (run in this verification)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Targeted vitest | `npx vitest run "src/app/(dashboard)/allocations" src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/portfolio-exposure.test.ts src/lib/closed-sets.cash-symbols.test.ts src/__tests__/e2e-seeded-hydration-guard.test.ts` | 187 files, 3659 tests passed, exit 0 | PASS |
| Types | `npx tsc --noEmit` | exit 0, no output | PASS |
| Lint | `npm run lint` | exit 0; 0 errors, 2 warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, neither touched by this phase; planning-hygiene rules OK | PASS |
| Seeded e2e | `e2e/allocations-add.spec.ts` | not runnable locally | SKIP (CI-pending) |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| Header button | `AddAllocationFlow` | WIRED | `handleHeaderAdd`, `onRecorded` refreshes the SSR payload, `onClose` returns focus to the trigger |
| `?add=` | flow deep link | WIRED | effect in `AllocationsTabs.tsx`, one-shot, stripped from URL |
| `book-figures` | Glance, Scenario strip, Holdings header, flow | WIRED | four consumers, one module |
| `getMyAllocationDashboard` -> `keyDataGaps` -> `MissingDataMessage` | Overview | WIRED | field on payload type and both return paths; `AllocationDashboardV2` builds lines from it |
| Legacy `?tab` alias | section anchor | WIRED | closed map, retry-until-mounted scroll with reduced-motion guard |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ROUTE-06 (+ Allocation flow, `?add=` entry) | SATISFIED | truths 1, 9, 10 |
| ROUTE-07 (glance, same values, names what is missing) | SATISFIED | truths 2, 3 |
| ROUTE-08 (Holdings labels, cash out of exposure) | SATISFIED | truths 4, 5 |
| LEAN-06 (three tabs, positions once, dust hidden) | SATISFIED | truths 6, 7, 8 |

### Anti-Patterns Found

None blocking. No TBD/FIXME/XXX introduced in phase files that lack a reference (lint and hygiene pass). Residuals recorded in the review, below MEDIUM or explicitly out of scope, are listed under warnings.

### Warnings (not gaps)

1. **Fix round 3 was not re-reviewed.** `198-REVIEW.md` round 3 found R3-01 and R3-02 (both MEDIUM, user-facing); fix round 3 (`1ad4aeed4`, `d23d74eaf`) was seen RED then GREEN by the fixer and its tests pass here, but no round-4 review confirmed it. Truths 3 and 10 rest on tests, not on a clean re-review.
2. **R3-01 residual (stated by the fixer):** a `shared_account_failing` group whose latest day is yesterday, printed alongside a gap-bearing group, can still omit the attributed key's fallback, because that reason carries no attributed group list. The `key_not_syncing` case is closed.
3. **Review residual, below MEDIUM:** Retry re-runs `buildAllocationRequest` against live Book equity, so a 30 s refresh that lowers equity or turns all-keys-stale on can refuse a stored-body Retry with an amount error. Nothing false is sent.
4. **Carry note for Phase 196:** `resolveDeepLink` should adopt the same `notOwnCapital` test before 196 links an owner's own factsheet to `?add=`.
5. **Deferred by decision (CONTEXT, FD-3):** sidebar and mobile "Add a Strategy" still open the manager `WizardClient`; follow-up to be booked.
6. Local-only noise acknowledged, untouched by this phase: `src/lib/factsheet/compute.conventions.test.ts` skew last-digit; it was not in the targeted run.

### Human Verification Required

1. **Seeded e2e in CI.** Test: `e2e/allocations-add.spec.ts`. Expected: both tests green on the head SHA. Why human: CI-only.
2. **Visual pass.** Test: open `/allocations` desktop and mobile, step through the three tabs, the glance and missing-data lines, Holdings order and dust control, and the header "+ Allocation" slide-over on each tab. Expected: matches `198-UI-SPEC.md` and `DESIGN.md`. Why human: layout and density.

### Gaps Summary

No goal-blocking gaps. All four ROADMAP success criteria and the D-01..D-08 decisions are implemented, wired and covered by passing tests at this SHA. Status is human_needed only because the seeded e2e is CI-pending and a visual pass is outstanding.

---

_Verified: 2026-11-09_
_Verifier: Claude (gsd-verifier)_
