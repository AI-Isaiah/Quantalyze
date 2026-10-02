---
phase: 21-surfacing-correlation-honest-projection
verified: 2026-06-21T15:58:38Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 21: Surfacing, Correlation & Honest Projection — Verification Report

**Phase Goal:** Allocators can find and read the scenario surfaces, see honest pairwise correlation, and the projection is unambiguously framed as hypothetical.
**Verified:** 2026-06-21T15:58:38Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An allocator reaches the own-book Scenario tab from the visible dashboard tablist (not only via `?tab=scenario`) | VERIFIED | `"scenario"` at line 251 of `AllocationsTabs.tsx:VISIBLE_TAB_KEYS`; `keyboardKeys` derives from `VISIBLE_TAB_KEYS` (line 445); 17/17 tests pass |
| 2 | The Strategy Sandbox link is in the sidebar, gated on `isAllocator` ONLY (NOT `showsAllocatorWorkspace`) | VERIFIED | `Sidebar.tsx:74` — `if (isAllocator) { workspaceItems.push({ label: "Strategy Sandbox" ... })}`; `showsAllocatorWorkspace` is `isAllocator || isAdmin` (line 34) and is explicitly NOT used; 30/30 Sidebar tests pass |
| 3 | A manager-only or admin-only user sees NO Strategy Sandbox link | VERIFIED | Gated on `if (isAllocator)` alone; `Sidebar.test.tsx` asserts manager-only and admin-only do NOT see "Strategy Sandbox" |
| 4 | The Strategy Sandbox is labeled "Strategy Sandbox" with an "Example universe" badge | VERIFIED | `ScenarioBuilder.tsx:284-287` renders `data-testid="sandbox-example-universe-badge"` with text "Example universe"; `ScenarioBuilder.honesty.test.tsx` pins this with 4/4 passing tests |
| 5 | A scenario with ≥2 strategies shows a pairwise correlation heatmap labeled by de-aliased names; "Avg \|ρ\|" single-sourced from `avg_pairwise_correlation` | VERIFIED | `CorrelationHeatmap.tsx:163` — `ids = Object.keys(correlationMatrix)` (show-all); `ScenarioComposer.tsx:1190-1195` mounts with `strategyNames`, `overlappingDays={scenarioMetrics.n}`, `avgAbsCorrelation={scenarioMetrics.avg_pairwise_correlation}`; `KpiStrip.tsx:429` label is `"Avg \|ρ\|"`; 57/57 ScenarioComposer tests pass, 18/18 CorrelationHeatmap tests pass |
| 6 | With >10 strategies the heatmap shows ALL strategies in a scrollable container (no truncation); `aria-label` names the true count | VERIFIED | `pickTopTenByAvgCorr` is fully removed (0 occurrences); `ids = Object.keys(correlationMatrix)` (line 163); `aria-label` at line 209 uses `n = ids.length` (true count); `overflow-x-auto overflow-y-auto max-h-[70vh]` scroll container at line 210 |
| 7 | A single-holding or <10-overlapping-day scenario renders an honest empty state — never a 1×1 grid or a fabricated number | VERIFIED | `CorrelationHeatmap.tsx:171` — `if (!correlationMatrix \|\| ids.length < 2)` gate prevents 1×1 grid; `overlappingDays < 10` branch (line 180) routes distinct copy; empty state never shows an Avg \|ρ\| number; CorrelationHeatmap tests 18/18 pass |
| 8 | The projection is persistently framed "PROJECTED — hypothetical, not your live book" with coverage caveats on BOTH surfaces | VERIFIED | `ScenarioComposer.tsx:1042-1045` and `1059-1067` (badge + caveat with `scenarioMetrics.n` + `shortestHistoryName`); `ScenarioBuilder.tsx:289-302` (both badges + caveat with `metrics.n` + `shortestHistoryName`); `shortestHistoryName` at `scenario-history.ts:45` (exported pure helper, 5/5 tests pass) |
| 9 | No `PercentileRankBadge` renders on the hypothetical blend; neuter guards are non-vacuous (positive control proves testid query matches a real badge) | VERIFIED | `PercentileRankBadge.tsx:50` — `data-testid="percentile-rank-badge"` on root `<span>`; `ScenarioComposer.test.tsx:2194` asserts `queryByTestId("percentile-rank-badge")` is null; `ScenarioComposer.test.tsx:2201-2203` isolates a real `PercentileRankBadge` and asserts `getByTestId(...)` IS found (positive control); `ScenarioBuilder.honesty.test.tsx:164` and `:172-173` replicate the same structure |

**Score:** 9/9 truths verified

### ROADMAP Success Criteria Coverage

| SC# | Criterion | Status | Notes |
|-----|-----------|--------|-------|
| 1 | Allocator reaches Scenario tab from visible tablist; sandbox reachable from sidebar; manager/admin sees no Sandbox | VERIFIED | Truths 1-3 above |
| 2 | Sandbox labeled "Strategy Sandbox" with "Example universe" badge | VERIFIED | Truth 4 above |
| 3 | ≥2-strategy scenario shows heatmap with de-aliased labels; "Avg \|ρ\|" single-sourced; >10 strategies — scrollable show-all | VERIFIED | Truths 5-6 above. ROADMAP text says "discloses it shows the 10 most-correlated" but this was **reconciled** per the LOCKED Phase 21 CONTEXT decision: show-all supersedes top-10 disclosure (documented in `21-CONTEXT.md:36` and `REQUIREMENTS.md:CORR-04`). Show-all with scrollable container is the correct behavior. |
| 4 | Single-holding or <10-overlapping-day scenario renders honest empty state | VERIFIED | Truth 7 above |
| 5 | Projection persistently framed "PROJECTED — hypothetical"; coverage caveats; no peer-ranking locked by neuter-check regression test | VERIFIED | Truths 8-9 above |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SURF-01 | 21-01 | Visible Scenario tab in dashboard tablist | VERIFIED | `AllocationsTabs.tsx:251` — `"scenario"` in `VISIBLE_TAB_KEYS` |
| SURF-02 | 21-01 | Allocator-only Sandbox sidebar link | VERIFIED | `Sidebar.tsx:74` — `if (isAllocator)` gate |
| SURF-03 | 21-01, 21-04 | "Strategy Sandbox" + "Example universe" badge | VERIFIED | `ScenarioBuilder.tsx:284-287` |
| CORR-01 | 21-03 | Heatmap in composer with de-aliased labels | VERIFIED | `ScenarioComposer.tsx:1190-1195` |
| CORR-02 | 21-02 | Honest empty state for <2 strategies or <10 overlapping days | VERIFIED | `CorrelationHeatmap.tsx:171,180` |
| CORR-03 | 21-02, 21-03, 21-04 | "Avg \|ρ\|" single-sourced across KPI strip + heatmap caption | VERIFIED | `KpiStrip.tsx:429`; heatmap `avgAbsCorrelation` prop from host |
| CORR-04 | 21-02 | Show-all (no truncation); aria-label names true count | VERIFIED | `pickTopTenByAvgCorr` removed; `ids = Object.keys(correlationMatrix)` |
| IMPACT-01 | 21-03, 21-04 | Persistent PROJECTED badge + coverage caveat (N days + shortest history) on both surfaces | VERIFIED | `ScenarioComposer.tsx:1042-1067`, `ScenarioBuilder.tsx:289-302` |
| IMPACT-02 | 21-03, 21-04 | No peer-ranking on hypothetical blend — non-vacuous neuter guard | VERIFIED | `ScenarioComposer.test.tsx:2194,2202-2203`, `ScenarioBuilder.honesty.test.tsx:164,172-173` |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | `"scenario"` in `VISIBLE_TAB_KEYS` | VERIFIED | Line 251 |
| `src/components/layout/Sidebar.tsx` | `isAllocator`-gated Sandbox link + `BeakerIcon` | VERIFIED | Lines 74-78, 269-273 |
| `src/components/portfolio/CorrelationHeatmap.tsx` | Show-all + reason-routed empty state + `Avg \|ρ\|` caption | VERIFIED | Lines 163, 171-186, 274-276 |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` | `"Avg \|ρ\|"` label | VERIFIED | Line 429 |
| `src/lib/scenario-history.ts` | `shortestHistoryName` exported pure helper | VERIFIED | Line 45 |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | CorrelationHeatmap mount + PROJECTED badge + caveat + single-sourced Avg \|ρ\| | VERIFIED | Lines 1042-1067, 1190-1195 |
| `src/components/strategy/PercentileRankBadge.tsx` | `data-testid="percentile-rank-badge"` on root `<span>` | VERIFIED | Line 50 |
| `src/components/scenarios/ScenarioBuilder.tsx` | "Example universe" + PROJECTED badges + caveat + "Avg \|ρ\|" relabel | VERIFIED | Lines 284-302, 322 |
| `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` | New test file with IMPACT-01/02 + CORR-03 guards | VERIFIED | 4/4 tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Sidebar.tsx` | `isAllocator` (NOT `showsAllocatorWorkspace`) | `if (isAllocator)` at line 74 | WIRED | Correct; `showsAllocatorWorkspace = isAllocator \|\| isAdmin` and is explicitly avoided |
| `AllocationsTabs.tsx` keyboard nav | `VISIBLE_TAB_KEYS` | `keyboardKeys` derives from `VISIBLE_TAB_KEYS` (line 445) | WIRED | `"scenario"` is now in `VISIBLE_TAB_KEYS`, so keyboard nav reaches it automatically |
| `ScenarioComposer.tsx` | `CorrelationHeatmap` | import + mount at line 1190, props wired with `scenarioMetrics.n` + `avg_pairwise_correlation` | WIRED | Lines 64, 1190-1195 |
| `ScenarioComposer.tsx` coverage caveat | `shortestHistoryName` + `scenarioMetrics.n` | `import` at line 66; `shortestHistoryName(deAliased.strategies)` at line 627 | WIRED | Lines 66, 627, 1063-1067 |
| `ScenarioComposer.test.tsx` R3 guard | `PercentileRankBadge` ABSENT by `data-testid` | `queryByTestId("percentile-rank-badge")` at line 2194 + positive control at 2202 | WIRED | Non-vacuous; testid confirmed present on real badge |
| `ScenarioBuilder.tsx` | `shortestHistoryName` | import at line 35; call at line 218 | WIRED | Prop correctly passes de-aliased strategies |
| `ScenarioBuilder.honesty.test.tsx` neuter guard | `PercentileRankBadge` ABSENT by `data-testid` | `queryByTestId("percentile-rank-badge")` at line 164 + positive control at 172 | WIRED | Non-vacuous; identical structure to composer guard |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SURF-01: Sidebar tests (allocator/manager/admin visibility) | `npx vitest run Sidebar.test.tsx` | 30/30 passed | PASS |
| SURF-01: AllocationsTabs tests (Scenario tab visible + keyboard nav) | `npx vitest run AllocationsTabs.scenario-composer.test.tsx` | 17/17 passed | PASS |
| CORR-02/03/04: CorrelationHeatmap (show-all + empty state + caption) | `npx vitest run CorrelationHeatmap.test.tsx` | 18/18 passed | PASS |
| CORR-03: KpiStrip label relabel | `npx vitest run KpiStrip.test.tsx KpiStrip.scenario.test.tsx` | 29/29 passed | PASS |
| shortestHistoryName helper | `npx vitest run scenario-history.test.ts` | 5/5 passed | PASS |
| CORR-01 + IMPACT-01/02: ScenarioComposer (heatmap mount + badge + neuter guard) | `npx vitest run ScenarioComposer.test.tsx` | 57/57 passed | PASS |
| SURF-03 + IMPACT-01/02 + CORR-03: ScenarioBuilder honesty | `npx vitest run ScenarioBuilder.honesty.test.tsx` | 4/4 passed | PASS |

### Anti-Patterns Found

No `TBD`, `FIXME`, or `XXX` markers in any phase-modified file. No `TODO` or `HACK` markers in the key implementation files. No stub patterns (empty returns, placeholder text) found.

One pre-existing behavioral change from CR-01 resolution is worth documenting: the portfolio-detail page (`portfolios/[id]/page.tsx`) now renders the heatmap's empty state (not a 1×1 grid) for single-strategy portfolios, because the shared `CorrelationHeatmap` gate was tightened from `ids.length === 0` to `ids.length < 2`. This behavioral change was explicitly accepted in the code review resolution (commit `766311ad`), is regression-pinned by `CorrelationHeatmap.test.tsx:64` ("CR-01: empty-state copy is surface-neutral"), and the copy is surface-neutral (no scenario-composer-specific toggle UX language). This is intentional, not a gap.

### Human Verification Required

The following visual/UX aspects cannot be verified programmatically:

**1. Scenario Tab Placement**
**Test:** Load the allocator dashboard and confirm the "Scenario" tab appears in the right position in the strip (after "Risk"), is click-reachable, and is keyboard-reachable via arrow keys.
**Expected:** Tab appears after "Risk" in the visible strip; clicking navigates to the Scenario panel; arrow-right from "Risk" moves focus to "Scenario."
**Why human:** DOM structure and visual placement require a real browser; automated tests verify the tab key is in `VISIBLE_TAB_KEYS` but not the rendered visual position.

**2. PROJECTED Badge Visual Appearance**
**Test:** Open the Scenario tab (own-book) and the Strategy Sandbox (`/scenarios`) and confirm both show "PROJECTED — hypothetical, not your live book" as a calm, neutral-outline pill — not accent, not warning-amber, not an alert.
**Expected:** Neutral grey outline badge, readable at a glance, always present (not on hover).
**Why human:** CSS token rendering and visual hierarchy require a real browser.

**3. Strategy Sandbox Sidebar Link**
**Test:** Log in as allocator — confirm "Strategy Sandbox" appears in MY WORKSPACE below "My Allocation". Log in as manager-only or admin-only — confirm "Strategy Sandbox" does NOT appear.
**Expected:** Link present only for allocators.
**Why human:** Role-based rendering requires authentication as multiple user roles in a real browser.

**4. Correlation Heatmap Visual Quality at Large N**
**Test:** Create a scenario with >10 strategies and verify the heatmap scrolls horizontally/vertically without breaking the page layout.
**Expected:** Heatmap contained in ~70vh scroll container; cells ≥48px wide; labels legible (truncated if needed, per the render contract).
**Why human:** Scroll container behavior and cell legibility require a real browser with real data.

### Gaps Summary

No gaps. All 9 required truths are VERIFIED against the actual codebase with live test results. The phase goal is achieved.

---

_Verified: 2026-06-21T15:58:38Z_
_Verifier: Claude (gsd-verifier)_
