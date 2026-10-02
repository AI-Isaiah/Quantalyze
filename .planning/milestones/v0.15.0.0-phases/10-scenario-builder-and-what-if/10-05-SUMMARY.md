---
phase: 10
plan: 05
subsystem: scenario-builder-discovery-surfaces
tags: [drawer, mandate-fit, browse, bridge, client-only]
requires:
  - "10-01 (scenario-state.ts AddedStrategy contract)"
  - "10-03 (GET /api/strategies/browse route)"
  - "Phase 09.1 D-16 (BridgeDrawer 2-stage shell)"
provides:
  - "StrategyBrowseDrawer — 620px right slide-over for browse-add (SCENARIO-04)"
  - "BridgeDrawer.onAddToScenario — second confirm-stage CTA for Bridge-add (SCENARIO-03)"
  - "computeMandateFitApprox — pure client-side mandate-fit tier rubric (Pitfall 7 fix)"
affects:
  - "src/app/(dashboard)/allocations/components/BridgeDrawer.tsx (additive props extension)"
tech_stack:
  patterns:
    - "BridgeDrawer drawer shell copied verbatim (backdrop, panel, Esc, keyframe animations)"
    - "fetchStrategies?: () => Promise<...> override for clean test injection"
    - "Multi-add session — drawer stays open after onAdd; per-row 2s 'Added ✓' transient + permanent dim"
    - "Pure-TS mandate-fit module: zero React, zero fetch, zero DOM"
key_files:
  created:
    - "src/app/(dashboard)/allocations/lib/mandate-fit.ts"
    - "src/app/(dashboard)/allocations/lib/mandate-fit.test.ts"
    - "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx"
    - "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/BridgeDrawer.tsx"
    - "src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx"
decisions:
  - "Mandate-fit thresholds pinned to D-08 0.7/0.4 verbatim (L2 fix; earlier draft used 0.8)"
  - "Mandate-fit pill is INFORMATIONAL only — allocator never blocked from adding (D-08)"
  - "BridgeDrawer extension is additive — onAddToScenario optional; existing call sites unchanged"
  - "BridgeAddToScenarioCandidate.markets defaults to [holding.venue]; strategy_types defaults to []"
  - "fetchStrategies?: prop on StrategyBrowseDrawer enables test injection without globally mocking fetch"
metrics:
  tasks_completed: 3
  commits: 6
  tests_added: 35
  tests_passing: 45  # mandate-fit (13) + StrategyBrowseDrawer (15) + BridgeDrawer (17 = 10 existing + 7 new)
  duration_minutes: 12
  completed_date: 2026-04-26
---

# Phase 10 Plan 05: Scenario Browse + Bridge "Add to scenario" + Mandate-Fit Approximation — Summary

Built the two discovery surfaces (SCENARIO-03 + SCENARIO-04) for the Phase 10 scenario composer plus a pure mandate-fit approximation module that resolves RESEARCH Pitfall 7 (mandate_fit_score is engine-computed into match_candidates.score_breakdown JSONB and is NOT a column on the strategies table).

## What Shipped

### 1. `mandate-fit.ts` — pure client-side tier approximation

Pure TypeScript module — no React, no fetch, no DOM. Exports `computeMandateFitApprox(strategy, mandate) → "green" | "yellow" | "red"`.

**Threshold rubric (D-08 pinned VERBATIM per L2 cross-review fix — earlier draft used 0.8):**
- HARD-RED: any strategy_type matches `mandate.excluded_strategy_types` → red regardless of market overlap
- GREEN: market overlap fraction ≥ 0.7
- YELLOW: 0.4 ≤ fraction < 0.7  OR mandate is null/empty (informational fallback)
- RED: fraction < 0.4 (including zero overlap when mandate has prefs)

13 vitest cases (T1–T8 + T3b 7/4/3-of-10 boundary fixtures) — all green.

### 2. `StrategyBrowseDrawer.tsx` — 620px right slide-over for browse-add

- Backdrop, panel positioning, Esc handler, keyframe animations copied **verbatim** from BridgeDrawer (Phase 09.1 D-16).
- Lazy fetch on `isOpen=true` → `/api/strategies/browse` (Plan 03's route). Filter changes apply client-side — zero round-trip.
- Search input: case-insensitive substring on `alias` + `codename`.
- Markets multi-select pill row + strategy_types multi-select pill row.
- Per-row mandate-fit chip via `computeMandateFitApprox` with copy: "Strong / Partial / Weak mandate fit".
- Multi-add session: drawer stays OPEN after Add; row shows "Added ✓" for 2s then dims to opacity 0.6.
- Empty states: "No verified strategies are live yet." + "No strategies match your filters." with Clear filters action.

```typescript
export interface StrategyBrowseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (strategy: AddedStrategy) => void;
  allocatorMandate: AllocatorMandateForFit | null;
  fetchStrategies?: () => Promise<StrategyBrowseRow[]>;
}
```

15 vitest cases (T1–T15) — all green.

### 3. `BridgeDrawer.tsx` — extended with `onAddToScenario` optional prop

Additive — when the prop is omitted the drawer renders unchanged (full backward-compat). When provided, the confirm stage renders a SECOND accent CTA "Add to scenario" alongside the existing "Send intro" (50%/50% width, 12px gap).

```typescript
onAddToScenario?: (
  holdingScopeRef: string,
  candidate: BridgeAddToScenarioCandidate,
) => void;

export interface BridgeAddToScenarioCandidate {
  id: string;          // candidate strategy UUID
  name: string;        // top_candidate_name
  markets: string[];   // [holding.venue] best-effort
  strategy_types: string[];  // [] best-effort
}
```

`handleAddToScenario` invokes the callback then calls `onClose()` — client-only action; NO POST. The composer (Plan 06) wires this to `scenario-state.ts addStrategyBridge`.

**Phase 09 D-16 grep guard intact:** `sendBridgeIntro` is the ONLY wire-call site; no `fetch(` in BridgeDrawer.tsx; the existing D-16 invariant test still passes.

7 new vitest cases (T_AS1–T_AS7) appended below the 10 existing cases — total 17 cases all green.

## Mandate-Fit Tier Rubric (decisions)

| fraction | tier | chip copy |
|---|---|---|
| ≥ 0.7 | green | "Strong mandate fit" |
| 0.4 ≤ x < 0.7 | yellow | "Partial mandate fit" |
| < 0.4 | red | "Weak mandate fit" |
| any excluded strategy_type matched | red | "Weak mandate fit" (hard-red) |
| mandate null/undefined or preferred_markets empty | yellow | "Partial mandate fit" (informational fallback) |
| strategy.markets empty + mandate has prefs | red | "Weak mandate fit" (no overlap possible) |

**fraction** = `|strategy.markets ∩ mandate.preferred_markets| / |strategy.markets|`

## Test Counts per File

| File | Cases | Status |
|---|---|---|
| `mandate-fit.test.ts` | 13 | all green |
| `StrategyBrowseDrawer.test.tsx` | 15 | all green |
| `BridgeDrawer.test.tsx` | 17 (10 existing + 7 new) | all green |
| **Total Plan 05** | **45** | **all green** |

Full project suite: **1848 tests pass, 87 skipped** — zero regressions.

## Phase 09 D-16 Grep Guard — Confirmed Intact

```bash
$ grep -E '"/api/match/decisions/holding"|"/api/bridge' src/.../BridgeDrawer.tsx
(only an in-code-comment occurrence documenting the assertion itself — D-16 invariant test strips comments before matching)

$ grep -E '\bfetch\s*\(' src/.../BridgeDrawer.tsx
(none)
```

The existing 10 BridgeDrawer.test.tsx cases all pass without modification — including the D-16 invariant test that asserts no `fetch(` lives in the drawer's source.

## Integration Notes for Plan 06 (Composer)

The two callbacks ship as standalone components ready for integration:

```typescript
// In ScenarioComposer (Plan 06):
import { useScenarioState } from "../lib/scenario-state-hook";  // Plan 06 hook
import { StrategyBrowseDrawer } from "./StrategyBrowseDrawer";
import { BridgeDrawer } from "./BridgeDrawer";

const { draft, setDraft } = useScenarioState({ ... });

<StrategyBrowseDrawer
  isOpen={browseOpen}
  onClose={() => setBrowseOpen(false)}
  onAdd={(s) => setDraft(addStrategyBrowse(draft, { id: s.id as StrategyForBuilderId, ...s }))}
  allocatorMandate={payload.mandate}
/>

<BridgeDrawer
  ...
  onAddToScenario={(holdingRef, candidate) =>
    setDraft(addStrategyBridge(draft, holdingRef, { id: candidate.id as StrategyForBuilderId, ...candidate }))
  }
/>
```

The composer enriches the candidate's `markets` + `strategy_types` from `payload.strategies` if richer metadata is available before forwarding to the scenario-state mutator.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test fixture bug] T8 mandate-fit chip assertion**
- **Found during:** Task 2 GREEN test run.
- **Issue:** Test originally used `getByText("Weak mandate fit")` (singular) but two strategies (Arbitrage Gamma — excluded type → red; Trend Delta — coinbase only → red) produce two "Weak mandate fit" chips, causing `getByText` to throw on multiple matches.
- **Fix:** Switched to `getAllByText(...).length >= 2` and added a stronger green-chip assertion (`>= 3` rows green from the 5-strategy fixture).
- **Files modified:** `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx`
- **Commit:** `749c228` (folded into the GREEN commit since it was a test correctness fix discovered during the same RED→GREEN cycle).

### Worktree-base context note (no rule violation)

This worktree was branched from `1da894d` (v0.15.11.0, before Phase 10 started). Plan 01's `scenario-state.ts` and Plan 03's `/api/strategies/browse` route do not exist on this branch — they ship in parallel waves and will be merged together. The drawer's `AddedStrategy` and `StrategyBrowseRow` types are declared locally so the component is self-contained and tests run standalone in this worktree. When Plan 01 + Plan 03 merge, the composer (Plan 06) will reconcile the structural shapes with the canonical types from `scenario-state.ts` (the contract is structural and identical: `{ id, name, markets, strategy_types }`).

## Acceptance Criteria — All Met

| Criterion | Status |
|---|---|
| `mandate-fit.ts` exports `computeMandateFitApprox` + `MandateFitTier` | ✓ |
| Mandate-fit thresholds 0.7/0.4 (L2 — no 0.8 drift) | ✓ |
| Mandate-fit module cites Pitfall 7 + D-08 informational-only semantics | ✓ |
| `StrategyBrowseDrawer` 620px right slide-over with role=dialog + aria-modal + aria-label | ✓ |
| Lazy fetch `/api/strategies/browse` once on open | ✓ |
| Search + filter pills + mandate-fit pill render per row | ✓ |
| Multi-add session: drawer stays open after Add; "Added ✓" transient | ✓ |
| Empty states for both zero-strategies and zero-filtered cases | ✓ |
| `BridgeDrawer` accepts `onAddToScenario`; renders dual CTA when provided | ✓ |
| Existing send-intro flow preserved verbatim (Phase 09 D-16 grep guard) | ✓ |
| 6 atomic TDD-cadence commits | ✓ |
| `tsc --noEmit` clean | ✓ |
| `eslint --quiet` clean on all touched files | ✓ |
| Full vitest suite green (1848 pass, zero regressions) | ✓ |

## Self-Check: PASSED

All claimed files exist, all 6 commits are reachable in the branch history, full test suite passes with the new tests included.
