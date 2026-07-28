---
phase: 11-onboarding-and-security-readiness
plan: 04
subsystem: dashboard-primitives
tags: [widget-state, primitive, accessibility, feature-flag, tdd]
requires: []
provides:
  - "WidgetState primitive — 5-mode dispatcher (loading / empty / partial / error / success) with locked props"
  - "isWidgetStateV2Enabled — universal-rollout feature flag (default OFF, localStorage + URL override)"
  - "WIDGET_MATRIX fixture — typed per-widget × per-state coverage for the 7 DEFAULT_LAYOUT widgets"
affects:
  - "Future widget owners can consume <WidgetState mode={...}> for uniform 5-state rendering"
  - "Phase 11+1 universal rollout: 32 long-tail WIDGET_REGISTRY widgets opt-in via the flag"
tech-stack:
  added: []
  patterns:
    - "Stateless dispatcher primitive (Pitfall 4 prevention via fs.readFileSync source-grep test)"
    - "Default-OFF localStorage flag with URL override — inverse of allocations.ui_v2 precedent"
    - "Dual-ARIA partial-state rendering (visible aria-hidden + sr-only sibling per UI-SPEC AC #16)"
    - "Meta-test guarding zero-state copy non-duplication via node:fs walk"
key-files:
  created:
    - "src/app/(dashboard)/allocations/components/WidgetState.tsx"
    - "src/app/(dashboard)/allocations/components/WidgetState.test.tsx"
    - "src/lib/widget-state-flag.ts"
    - "src/lib/widget-state-flag.test.ts"
    - "src/__tests__/widget-state-no-duplicate-empty.test.ts"
    - "src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx"
    - "src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx"
  modified: []
decisions:
  - "Inlined LoadingState + ErrorState renderers inside WidgetState.tsx (RESEARCH §Open Question #3 — Claude's discretion)"
  - "Fixtures file is .tsx (not .ts as listed in plan frontmatter) — JSX render thunks require .tsx; Vite resolves import without extension"
  - "Allow-list for non-duplicate-empty meta-test = EmptyState.tsx + ScenarioComposer.tsx (pre-existing) + OnboardingBanner.tsx (Plan 05 forward-compat)"
  - "Success fixtures are typed Partial<MyAllocationDashboardPayload> not per-widget Props — every widget consumes the universal WidgetProps.data slot, so per-widget Props interfaces don't exist"
metrics:
  duration: "15min 51s"
  completed: "2026-04-26T19:33Z"
---

# Phase 11 Plan 04: WidgetState Primitive + 5-State Coverage Summary

Shared `<WidgetState>` primitive that every allocator-facing widget will wrap to render the 5 states (loading / empty / partial / error / success) consistently — replaces ad-hoc per-widget state handling with a single locked API surface, gated by a default-OFF feature flag for universal-rollout safety (RISK-1).

## Final WidgetState API Surface

```typescript
export type WidgetStateMode = "loading" | "empty" | "partial" | "error" | "success";

export interface WidgetStateProps {
  mode: WidgetStateMode;
  children?: ReactNode;
  partial?: { pill: string; children: ReactNode };
  error?: { message: string; onRetry?: () => void };
  empty?: { title: string; description?: string; ctaHref?: string; ctaLabel?: string };
}

export function WidgetState(props: WidgetStateProps): JSX.Element;
```

**Locked exact union order:** `loading | empty | partial | error | success`
**Stateless invariant:** zero `useState` / `useEffect` / `useRef` calls in WidgetState.tsx (Pitfall 4 — enforced by Test 8 reading the source via `fs.readFileSync` and grepping for hook-call patterns; the file ships with comments explaining the invariant but no actual hook invocations).
**No `category` prop** — UI-SPEC AC #6 LOCKS the 5-mode union; primitive does not branch on widget category.

## Mode Rendering Contract (UI-SPEC §S3)

| Mode | Render |
|------|--------|
| `loading` | `<Card aria-busy="true">` with two `animate-pulse` Skeleton lines (h-5 w-1/3 + h-32 w-full). |
| `empty` | `<Card className="text-center py-8">` with optional title (h3) + description (p) + accent CTA Link (`bg-accent px-4 py-2`). Chrome reuses the EmptyState pattern; copy is caller-supplied so each widget tells its own story. |
| `partial` | Children + dual-ARIA pill: `<span aria-hidden="true">{pill}</span>` (visible warning chip) + `<span class="sr-only">State: {pill}</span>` (announcement). UI-SPEC AC #16 contract preserved. |
| `error` | `<Card role="alert" aria-live="polite" className="border-negative/30 bg-negative/5">` with caller-supplied message + optional Retry button (only mounted when `error.onRetry` is supplied). |
| `success` | Bare `<>{children}</>` — NO Card chrome. Widget body renders directly. |

## Decision: Inline vs Sibling LoadingState/ErrorState (RESEARCH §Open Question #3)

**Chose: inline.** All five mode renderers live inside `WidgetState.tsx` as a flat dispatcher. The plan gave the executor discretion here; inline keeps the primitive a single 145-line file readable end-to-end without cross-file navigation. Sibling files (LoadingState.tsx / ErrorState.tsx) were specifically declined per plan note ("DO NOT introduce a separate LoadingState.tsx / ErrorState.tsx file — RESEARCH §Open Question #3 + CONTEXT discretion").

## 7 DEFAULT_LAYOUT Widgets Covered + Fixture File

`src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx`

| Order | Designer Key | Widget | Component Path | Category |
|-------|--------------|--------|----------------|----------|
| 1 | `bridge` | `BridgeHeroWidget` | `widgets/bridge/BridgeHeroWidget.tsx` | card |
| 2 | `kpi` | `KpiStripWidget` | `widgets/meta/KpiStripWidget.tsx` | kpi |
| 3 | `equity` | `EquityChartWidget` | `widgets/performance/EquityChart.tsx` (default export) | chart |
| 4 | `holdings` | `HoldingsTableWidget` | `widgets/positions/HoldingsTableWidget.tsx` | table |
| 5 | `allocation` | `AllocationByStyleWidget` | `widgets/allocation/AllocationByStyleWidget.tsx` | sparkline |
| 6 | `mandate` | `MandateSnapshotWidget` | `widgets/risk/MandateSnapshotWidget.tsx` | card |
| 7 | `outcomes` | `OutcomesWidget` | `widgets/outcomes/OutcomesWidget.tsx` | chart |

Total: 7 widgets × 5 modes = 35 fixture-mode renders, plus 2 sanity-check assertions (length === 7, per-category coverage ≥ 5) = **37 it() cases, all GREEN**.

## W-01 Outcome (pre-fill execution)

The plan committed to 5 pre-filled representative entries (one per category) with the executor adding 2. **Outcome: WIDGET_MATRIX ships with all 7 entries fully populated.**

- **Pre-filled patterns (5 categories):** kpi (KpiStripWidget) / chart (EquityChartWidget) / table (HoldingsTableWidget) / sparkline (AllocationByStyleWidget) / card (MandateSnapshotWidget).
- **Executor-added (2):** `bridge` (BridgeHeroWidget, category=card) and `outcomes` (OutcomesWidget, category=chart). Both follow the typed `Partial<MyAllocationDashboardPayload>` pattern from the pre-filled entries.

The matrix's `category` distribution: kpi×1, chart×2 (equity + outcomes), table×1, sparkline×1, card×2 (bridge + mandate) — all 5 categories covered, no `any` casts (D-12 LOCKED).

## RISK-1 Outcome (widget_state_v2 feature flag)

**`src/lib/widget-state-flag.ts`** ships `isWidgetStateV2Enabled()` with the locked precedence:

1. **URL override (highest):** `?widget_state=v2|true|on` → forces ON. `?widget_state=off|false` → forces OFF. (Mirrors `?ui=v2` precedent on AllocationDashboardV2.)
2. **localStorage:** `widget_state_v2 = "true"` → ON. Any other value (or missing) → falls through to default OFF.
3. **Default OFF (RISK-1 mitigation).** SSR-safe: no window → false.

**Admin toggle pattern (mirrors `allocations.ui_v2` from AllocationsTabs.tsx):**
- DevTools console: `localStorage.setItem("widget_state_v2", "true")` to flip ON; reload.
- DevTools console: `localStorage.removeItem("widget_state_v2")` to clear.
- Ad-hoc QA: append `?widget_state=v2` to any /allocations URL to force ON for one load.

**Constants exported:** `WIDGET_STATE_V2_STORAGE_KEY` (= `"widget_state_v2"`), `WIDGET_STATE_V2_URL_OVERRIDE` (= `"widget_state"`).

## Confirmation: EmptyState.tsx Reused (NOT Duplicated)

The meta-test `src/__tests__/widget-state-no-duplicate-empty.test.ts` walks `src/` recursively via `node:fs` only (no `child_process` / `execSync` / `spawn`) and asserts the literal string `"Connect Exchange →"` only appears in:

1. **`src/app/(dashboard)/allocations/EmptyState.tsx`** — the canonical Phase 07 zero-state.
2. **`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`** — pre-existing scenario-builder empty state (distinct copy "Scenario builder needs holdings", same CTA label is intentional).
3. **`src/app/(dashboard)/allocations/components/OnboardingBanner.tsx`** — forward-compat for Plan 05.

`WidgetState mode='empty'` reuses the **chrome pattern** (centered Card + accent button) but accepts caller-supplied `title` / `description` / `ctaLabel` / `ctaHref` so each widget tells its own story without duplicating EmptyState's verbatim copy. Verified: `WidgetState.tsx` does NOT contain the literal `"Connect Exchange →"` string.

## Long-tail Coverage Boundary (32 Long-Tail Widgets)

The 32 WIDGET_REGISTRY widgets NOT in DEFAULT_LAYOUT do not get per-state fixtures in this phase. They will:

- Continue to use their pre-Phase-11 ad-hoc state handling **until** the `widget_state_v2` flag flips ON.
- After flip: opt-in to `<WidgetState>` wrapping incrementally. The flag isolates blast radius — a primitive defect can only regress the 7 in-scope widgets, not all 39.

These 32 widgets are listed in `src/app/(dashboard)/allocations/lib/widget-registry.ts` as the entries NOT in the DEFAULT_LAYOUT 7-tile set. Per-state fixtures for them are deferred to Phase 11+1 per CONTEXT `<deferred>`.

## Test Results

| Test File | Cases | Status |
|-----------|-------|--------|
| `WidgetState.test.tsx` | 8 | GREEN |
| `widget-state-no-duplicate-empty.test.ts` (src/__tests__) | 1 | GREEN |
| `widget-state-flag.test.ts` (src/lib) | 6 | GREEN |
| `widget-states.test.tsx` (matrix) | 37 | GREEN |
| **Total** | **52** | **52/52 GREEN** |

**Wider regression sweep:** `npx vitest run src/app/(dashboard)/allocations/` → 645/645 GREEN (no regression introduced). `npm run typecheck` clean. ESLint clean on the 7 changed files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Fixtures file extension changed from .ts to .tsx**
- **Found during:** Task 2 RED → GREEN
- **Issue:** Plan frontmatter listed `widget-states.fixtures.ts`, but the file contains JSX `renderSuccess` thunks. TypeScript rejects JSX in `.ts` files — would have failed `npm run typecheck` immediately.
- **Fix:** File is named `widget-states.fixtures.tsx`. Vite resolves `from "./widget-states.fixtures"` to the `.tsx` file automatically (no test code change required).
- **Files modified:** `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx`
- **Commit:** 77c0e74

**2. [Rule 3 — Blocking] Allow-list expanded for EmptyState non-duplication meta-test**
- **Found during:** Task 1 RED test design
- **Issue:** Plan's allow-list = `EmptyState.tsx` + `OnboardingBanner.tsx` (Plan 05 not yet shipped). But `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` already contains "Connect Exchange →" at line 548 (pre-existing, distinct empty-state copy "Scenario builder needs holdings"). With the plan's allow-list as written, the meta-test would fail immediately on existing code — making the test useless.
- **Fix:** Allow-list expanded to 3 paths: `EmptyState.tsx` + `ScenarioComposer.tsx` (existing) + `OnboardingBanner.tsx` (Plan 05 forward-compat). The meta-test now correctly catches new offenders without false-positive on the pre-existing ScenarioComposer.
- **Files modified:** `src/__tests__/widget-state-no-duplicate-empty.test.ts`
- **Commit:** 12bdbdd (the meta-test allow-list ships in the GREEN commit; allow-list rationale documented inline in the JSDoc)

**3. [Rule 3 — Blocking] Per-widget Props interfaces don't exist — fixtures typed against MyAllocationDashboardPayload**
- **Found during:** Task 2 RED test design / read of widget files
- **Issue:** Plan's fixture template imported `KpiStripProps`, `HoldingsTableProps`, `AllocationByStyleWidgetProps`, etc. None of these named exports exist. Every widget in `widgets/**` consumes the universal `WidgetProps = { data: any; timeframe: string; width: number; height: number }` from `lib/types.ts`.
- **Fix:** Fixtures type the `data` payload as `Partial<MyAllocationDashboardPayload>` (the canonical type every widget reads in production) and pass it through the universal `WidgetProps` shape via render thunks. D-12 (no `any`) is preserved at the fixture-data boundary; the `WidgetProps.data: any` is from the project's pre-existing widget contract, not new code.
- **Files modified:** `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx`
- **Commit:** 77c0e74

**4. [Rule 3 — Blocking] Test 8 regex tightened to skip JSDoc comments**
- **Found during:** Task 1 GREEN run
- **Issue:** Test 8 grepped for `\buseState\b` in `WidgetState.tsx`. Initial WidgetState.tsx JSDoc warning copy mentioned "the primitive holds NO useState/useEffect/useRef" verbatim — false-positive against itself.
- **Fix:** Test 8 strips block + line comments before grepping, then asserts no `useState\s*\(` / `useEffect\s*\(` / `useRef\s*\(` invocations (the actual hook calls, not bare identifier mentions in comments). The Pitfall 4 contract is enforced just as strictly.
- **Files modified:** `src/app/(dashboard)/allocations/components/WidgetState.test.tsx`
- **Commit:** 12bdbdd (final GREEN form ships with the comment-stripping regex)

**5. [Rule 3 — Blocking] localStorage stub idiom for the flag-reader test**
- **Found during:** Task 1 GREEN run on `widget-state-flag.test.ts`
- **Issue:** Direct `window.localStorage.removeItem(...)` calls in `beforeEach`/`afterEach` failed under vitest+jsdom because `vi.stubGlobal("localStorage", ...)` from a sibling test file (`scenario-state.localStorage.test.ts`) had stubbed `globalThis.localStorage` with a non-jsdom object missing `.removeItem`.
- **Fix:** Adopted the project idiom — module-level Map-backed `localStorageMock` + `vi.stubGlobal("localStorage", ...)`, matching `scenario-state.localStorage.test.ts` pattern verbatim. Tests now run independently of jsdom localStorage state.
- **Files modified:** `src/lib/widget-state-flag.test.ts`
- **Commit:** 12bdbdd

**6. [Rule 3 — Blocking] next/navigation mock added to matrix test**
- **Found during:** Task 2 GREEN first run (HoldingsTableWidget success-mode case)
- **Issue:** `HoldingsTable` (consumed by `HoldingsTableWidget`) calls `useRouter()` at module level. Without a Next router context, the success-mode mount throws "invariant expected app router to be mounted".
- **Fix:** Stubbed `next/navigation` at the top of `widget-states.test.tsx` with `vi.mock(...)` — same pattern as `widgets/positions/HoldingsTableWidget.test.tsx`. All 7 success-mode renders now mount cleanly.
- **Files modified:** `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx`
- **Commit:** 77c0e74

### None Requiring User Decision (no Rule 4 events)

No architectural-change checkpoints encountered. All deviations were Rule-3 blocking fixes auto-applied to keep execution flowing.

## Self-Check: PASSED

**Files verified to exist:**
- ✓ `src/app/(dashboard)/allocations/components/WidgetState.tsx`
- ✓ `src/app/(dashboard)/allocations/components/WidgetState.test.tsx`
- ✓ `src/lib/widget-state-flag.ts`
- ✓ `src/lib/widget-state-flag.test.ts`
- ✓ `src/__tests__/widget-state-no-duplicate-empty.test.ts`
- ✓ `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.tsx`
- ✓ `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx`

**Commits verified in git log:**
- ✓ a08f63e — `test(11-04): RED — WidgetState primitive + widget_state_v2 flag + EmptyState reuse meta-test`
- ✓ 12bdbdd — `feat(11-04): GREEN — WidgetState 5-mode primitive + widget_state_v2 flag`
- ✓ 77c0e74 — `test(11-04): per-widget × per-state matrix fixtures + 37-case test (W-01)`

**TDD gate sequence:** Task 1 ships RED (test commit) → GREEN (feat commit). Task 2 ships as a single `test()` matrix-coverage commit (the matrix test is fixture coverage of an already-GREEN primitive, not driving new feature behavior — Task 1 alone satisfies the RED→GREEN cycle for the primitive).

**Acceptance criteria:** 13/13 grep checks pass for Task 1 + 9/9 grep checks pass for Task 2.

**Test totals:** 52/52 GREEN across the 4 new test files. 645/645 GREEN across the wider `src/app/(dashboard)/allocations/` regression sweep.
