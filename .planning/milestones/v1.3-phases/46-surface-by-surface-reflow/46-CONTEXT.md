# Phase 46: Surface-by-Surface Reflow (CSS-first, no charts) - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all 4 areas accepted as recommended

<domain>
## Phase Boundary

Make every authed + public route reflow correctly at 320px CSS width and 400% browser zoom using CSS-first work that has ZERO risk of crossing the frozen compute/math boundary. Three concrete jobs: (1) reshape every data table so all columns stay reachable on a phone (never drop a material column); (2) de-block the onboarding / API-key wizard below 640px; (3) keep loading / empty / error / partial states honest and unbroken across breakpoints. Charts are explicitly OUT of scope (phases 47-48). Requirements: TABLE-01, WIZARD-01, REFLOW-01, REFLOW-02, REFLOW-03.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Table Reshape (TABLE-01)
- Default reshape for wide financial tables at 320px is **horizontal scroll via the existing `ResponsiveTable`** wrapper (`overflow-x-auto` + `role="region"` + focusable + sr-only scroll hint). Never drop columns — column-drop on a financial table is a no-invented-data violation. CSS-first, zero math risk.
- Scope: **wrap the 3 currently-unprotected tables** (`HoldingsTable` NEW + LEGACY + `StrategyRowsTable` modes, `OpenPositionsTable`) with `ResponsiveTable`, AND **migrate the highest-stakes already-scrolling tables** (`ScenarioCompareTable`, `CorrelationMatrix`) onto `ResponsiveTable` so they gain the a11y region contract. Low-stakes tables that already have a raw `overflow-x-auto` div may stay as-is (not a forced 30-file migration).
- **All-columns-present fail-loud guard (SC#2)** lands on the highest-stakes financial tables only: `HoldingsTable` (NEW + legacy modes), `ScenarioCompareTable`, `CorrelationMatrix`. The guard fails if a future `hidden` / `truncate` / column-drop edit removes a material column or status.
- **No sticky first column** — plain horizontal scroll (simplest, CSS-first, matches the existing `ScenarioCompareTable` pattern). The cut-off column edge peeking past the right is the scroll affordance.

### Area 2 — Wizard De-Block (WIZARD-01)
- Below 640px, **render the real wizard**. Keep the two-pass `isNarrow === null` hydration-safe pattern (matchMedia + deferred setState, SSR renders children) — remove ONLY the `isNarrow === true` → email-capture branch so it falls through to `children` at all widths.
- **Remove the "resume on desktop" email-capture form** entirely — the wizard is now usable on a phone.
- **Remove `DesktopGate.tsx` from the wizard tree and delete the component** (dead after de-block) — cleaner than a pass-through stub.
- **Reflow the wizard's own layout CSS-first** (stack fields, full-width inputs, ensure the step nav/footer is reachable and usable at 320px). No new JS viewport branching.

### Area 3 — Honest States Across Breakpoints (REFLOW-03)
- **Verify** `EmptyStateCard` / `SampleFloorEmptyState` / allocations `EmptyState` reflow correctly at 320px (simple cards — likely already fine); fix ONLY any that overflow. No new empty-state components.
- **Verify** `Skeleton` / `SkeletonText` / `SkeletonCard` reflow at 320px; change only on overflow.
- **Extend the phase-44 reflow e2e** to cover at least one degenerate-state route at 320px so a regression that breaks an honest-empty layout fails loudly.

### Area 4 — Scope & Verification (REFLOW-01 / REFLOW-02)
- **Cover ALL authed + public routes** per SC#1 (it is explicit). Sequence: tables + wizard first (highest risk), then a route-by-route reflow sweep.
- **Prove "every route passes"** with a parametrized reflow spec iterating a curated route list at 320px + 400% zoom (extends the phase-44 reflow helper; seeded for authed routes, FLOW-01 dual-wired into ci.yml).
- **Admin tables**: scroll-wrap with `ResponsiveTable` only (internal, lower-stakes) — no deep restructure.

### Claude's Discretion
- Exact curated route list for the parametrized reflow sweep, the precise CSS utilities per surface, and which specific low-stakes raw-`overflow-x-auto` tables (if any trivial) to opportunistically migrate — all at executor discretion within the decisions above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ResponsiveTable` (`src/components/ResponsiveTable.tsx`) — overflow-x-auto + role=region + sr-only hint; built in phase 44, currently UNUSED by major tables (prime wrap target).
- `useBreakpoint` (`src/hooks/useBreakpoint.ts`) + `useMediaQuery` (`src/hooks/useMediaQuery.ts`) — SSR-safe two-pass; for any unavoidable JS branch.
- `EmptyStateCard` (`src/components/ui/EmptyStateCard.tsx`), `SampleFloorEmptyState` (`src/components/scenarios/SampleFloorEmptyState.tsx`), allocations `EmptyState` (`src/app/(dashboard)/allocations/EmptyState.tsx`) — honest-absence shells (never alert/warning color).
- `Skeleton` / `SkeletonText` / `SkeletonCard` (`src/components/ui/Skeleton.tsx`) — loading placeholders (aria-hidden).
- Phase-44 reflow helper (`e2e/helpers/reflow.ts`) + reflow/target-size specs — extend for the route sweep.

### Established Patterns
- Tables already scrolling via a RAW `<div className="overflow-x-auto">` (no a11y region): `ScenarioCompareTable:185`, `CorrelationMatrix:173`, `StrategyBreakdownTable`, `CompareTable`, `StrategyTable`, admin `ComputeJobsTable`.
- UNPROTECTED raw `<table>` (no scroll wrapper): `HoldingsTable` (NEW row mode ~620, legacy ~399, StrategyRows ~260), `OpenPositionsTable`.
- Wizard gate: `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` — `(max-width: 639px)` at line 14, two-pass `isNarrow: boolean|null` (matchMedia + `setTimeout(0)` deferred setState at lines 23-34; render branches at 71-75), narrow → email-capture form (lines 77-114).
- DESIGN.md is the LOCKED source of truth; this phase is a RETROFIT — invent no new aesthetic, reuse existing tokens/utilities. Tailwind v4 defaults: sm=640, lg=1024 (no custom `--breakpoint-*`).

### Integration Points
- Tables live under `src/app/(dashboard)/allocations/components/`, `src/components/portfolio/`, `src/components/strategy/`, `src/components/admin/`.
- Wizard under `src/app/(dashboard)/strategies/new/wizard/`.
- Reflow gates: `e2e/` + `ci.yml` (FLOW-01 dual-wiring, both the seeded list and the unseeded list as appropriate).

</code_context>

<specifics>
## Specific Ideas

- The `ResponsiveTable` a11y region is the canonical reshape primitive — do not reinvent per-table scroll wrappers.
- The all-columns-present guard must assert the FULL material column set per highest-stakes table, and fail when a column is hidden/truncated/dropped (the SC#2 contract).
- The wizard de-block must NOT regress the two-pass hydration-safe pattern (no hydration mismatch is SC#5).

</specifics>

<deferred>
## Deferred Ideas

- Charts (SVG + Recharts + EquityChart) reflow — phases 47-48 (explicitly out of scope here).
- Per-row card-stack table layout (an alternative reshape) — not adopted; horizontal scroll chosen. Revisit only if a specific table proves unusable via scroll.
- Edge-tab focus-ring clip + flagged-count badge >99 (phase-45 P3 TODOs) — separate, not this phase.

</deferred>
