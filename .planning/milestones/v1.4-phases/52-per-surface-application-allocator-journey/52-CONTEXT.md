# Phase 52: Per-Surface Application — Allocator Journey - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring the highest-traffic allocator-journey surfaces — **allocations, scenario composer, factsheets, discovery, bridge, risk, single-strategy** — fully to the v1.4 bar: fluid no-clip type, layouts that hold from 320px to ultra-wide (2560px), container-query component responsiveness, complete honest state coverage (loading/empty/error/skeleton), and React-19/Next-16 boundary correctness.

**Frozen client islands — chrome/layout only, math byte-identical:** `src/lib/scenario.ts` (SCENARIO-05 zero-diff), `src/lib/factsheet/compute.ts` (BODY-02 parity), `FactsheetProvider` (`src/app/factsheet/[id]/v2/factsheet-context.tsx`), `useBreakpoint`, the Monte-Carlo Web Worker (`src/app/(dashboard)/allocations/lib/montecarlo.worker.ts`), and chart-interactivity files (`EquityChart.tsx`, `TouchTooltip.tsx`, `useTapPin`). None may be RSC-ified. The no-invented-data and no-peer-rank invariants and the v1.3 WCAG-AA floor stay LOCKED.

Requirements delivered here: **APPLY-01, TYPE-02, TYPE-03, TYPE-04, STATE-01, STATE-02, BP-01**.

</domain>

<decisions>
## Implementation Decisions

### Ultra-Wide Layout (2560px)
- **Fluid-fill to a ~1920px cap.** Data surfaces (allocations dashboard, factsheets, compare/bridge, discovery tables) use more horizontal width on ultra-wide rather than capping at 1280/1440 — content fills toward ~1920px, then centers with gutters beyond that. Allocations raises its current `max-w-[1280px]` accordingly; prose/detail pages (single-strategy) keep a narrower readable measure.
- Charts and tables must not visually break or stretch awkwardly when filling the wider measure; tune chart aspect/legibility and table column behavior so the wider canvas reads as deliberate, not stretched.
- No horizontal scroll or overlap at any width 320px → 2560px (TYPE-03).

### No-Clip / Truncation Policy (TYPE-02)
- **Wrap by default; single-line + `title=` only where tabular row-alignment requires it.** Entity names (strategy/scenario/holding names) wrap via `break-words` + `min-w-0` so nothing is silently cut. In dense data tables where wrapping would break tabular-number row alignment, keep single-line and add a `title=` attribute (and aria where needed) so the full text is recoverable on hover/AT.
- Fix the 5 known accidental-clip sites in scope: `AlertBanner.tsx:127`, `SavedScenariosList.tsx:529`, `ScenarioComposer.tsx:2779` (constituent name), `StrategyGrid.tsx:63` (marketplace tile name), plus Holdings/Discovery/Compare table name cells.
- Legitimate, intentional truncation (e.g., factsheet KPI fixed labels, chart-legend `…` with tooltip recovery, correlation-matrix axis labels that already carry `title=`) stays as-is — the Phase 49 truncation audit (`.planning/audits/truncation-audit.md`) is the classification source of truth.

### Container-Query Adoption (TYPE-04)
- **Broad rollout.** Migrate responsive components from viewport breakpoints to CSS container queries (`@container` / `container-type`) across the allocator surfaces wherever a component renders at varying width inside a parent — KPI strips, cards in the fixed-width 380px metrics rail, factsheet panels, dashboard widgets, table-embedded controls. Viewport breakpoints stay only where the decision is genuinely viewport-level (e.g., app shell, mobile nav already shipped in v1.3).
- Preserve `tabular-nums` alignment under fluid type everywhere numbers are columnar.
- Do this per-surface via the strangler pattern (no big-bang rewrite); each surface's container migration is independently verifiable.

### State Coverage (STATE-01/02)
- **Fill route files + shared primitives.** Add route-level `loading.tsx` + `error.tsx` for every in-scope surface that lacks one (allocations, compare/bridge, single-strategy; risk is a tab so its skeleton stays tab-level). Back them with shared `Skeleton` / `EmptyState` / `ErrorState` primitives (reuse the Phase-50 `Skeleton` primitive; factsheet already has a strong `loading.tsx` to model fidelity on) so every surface is consistent.
- Honest degenerate states preserved exactly: 0/1 strategy, <10 overlapping days, non-finite returns, compute-in-progress, watchlist-unavailable, baseline-unknown — never fabricated zeros, demo numbers, or count-ups (no-invented-data LOCKED).

### Claude's Discretion
- Exact per-surface skeleton fidelity (match-layout vs generic) within the "shared primitives + fill route files" decision — bias toward match-layout where the factsheet already sets the bar.
- The `@container` breakpoint values and which specific components qualify under "broad rollout" — decided per surface in planning, guided by where viewport breakpoints actually mislead.
- React/Next boundary refactors (keys/memo/hook hygiene, RSC vs client splits) so long as no frozen island is RSC-ified and live recompute / Worker / chart tap+tooltip all keep working (BP-01).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-50 primitives** (`src/components/ui/`): `Button`, `Modal`, `Tabs`, `Table`, `Field`, `Select`, `Card`, `CardShell`, `CollapsibleSection`, `Skeleton`, `Badge`, `Tooltip`, `Input`, `Textarea`, banners. Reuse for chrome; assemble new states from `Skeleton`/`Card`.
- **Phase-49 fluid tokens** (`src/app/globals.css` ~lines 136–143): `--text-hero` → `--text-micro` clamp tiers (zoom-safe, already live on factsheet/single-strategy); `--space-*` grid tokens. Apply the type tiers across surfaces; consider a fluid `--space-*` suite if needed.
- `ResponsiveTable` (`src/components/ResponsiveTable.tsx`) — horizontal-scroll affordance + can host an `@container` context (gained `scrollRef`+`className` in Phase 50-06).
- `EmptyState` (`src/app/(dashboard)/allocations/.../EmptyState.tsx`) — existing zero-holdings pattern to generalize.

### Established Patterns
- **RSC page + client tab tree**: allocations/discovery/compare/factsheet pages are RSC and server-fetch; client interactivity (`AllocationsTabs`, `StrategyTable`, `FactsheetView`) is `"use client"`. Tab panels lazy-load via `next/dynamic({ ssr:false })`.
- **Two-tier max-width** today: `max-w-[1280px]` (allocations) / `max-w-[1440px]` (factsheets, composer 1440) / `max-w-3xl` (single-strategy). This phase moves data surfaces toward fluid-fill ~1920.
- **No `@container` anywhere yet** — this phase introduces it broadly.
- **Honest degenerate branches** already exist and are tested (baseline-unknown, staleness, payload-pending, watchlist-unavailable) — extend coverage, don't replace.

### Integration Points
- Page routes: `src/app/(dashboard)/allocations/page.tsx`, `src/app/factsheet/[id]/v2/page.tsx`, `src/app/(dashboard)/discovery/[slug]/page.tsx`, `src/app/(dashboard)/compare/page.tsx`, `src/app/strategy/[id]/page.tsx`.
- Composer + risk live inside the allocations tab structure (`?tab=scenario` / `?tab=risk`), `AllocationsTabs.tsx`.
- "Bridge" surface = the recommendation-engine surface; **plan-phase must reconcile bridge vs compare scope** (the scout mapped `/compare`; confirm whether bridge has its own route/surface to include).
- Frozen islands listed in `<domain>` — guard against RSC-ification; the existing SCENARIO-05 / BODY-02 / `useBreakpoint` gates protect math/byte-identity.

</code_context>

<specifics>
## Specific Ideas

- Raise allocations from `max-w-[1280px]` toward the fluid-fill ~1920 measure; keep factsheet/composer at their existing wide measure but verify they read well filling toward 1920.
- Standardize entity-name treatment: `break-words min-w-0` wrap default; `title=` single-line in tables.
- Introduce `@container`/`container-type` broadly (KPI strips, metrics-rail cards, factsheet panels, dashboard widgets) — first `@container` usage in the codebase.
- Add `loading.tsx`+`error.tsx` to allocations, compare/bridge, single-strategy; model fidelity on the existing `factsheet/[id]/v2/loading.tsx`.
- Truncation audit at `.planning/audits/truncation-audit.md` is the SoT for which clips are legitimate vs accidental.

</specifics>

<deferred>
## Deferred Ideas

- Lower-traffic surfaces (manager wizard, `/portfolios`, `/security`, admin, public/marketing) — Phase 53.
- App-wide verification gates (ultra-wide 2560px axe/reflow row, no-clip CI guard, tolerance Playwright goldens, lighthouse ratchet, authed/mobile axe rows) — Phase 54.
- A second `--space-*` fluid token suite, if the existing grid tokens prove insufficient — only if a surface forces it.

</deferred>
