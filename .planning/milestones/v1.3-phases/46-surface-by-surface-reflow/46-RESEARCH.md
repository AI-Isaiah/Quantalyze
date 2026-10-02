# Phase 46: Surface-by-Surface Reflow (CSS-first, no charts) - Research

**Researched:** 2026-06-27
**Domain:** Responsive CSS retrofit (WCAG 1.4.10 Reflow / 1.4.4 Resize Text / 2.5.8 Target Size) over a Next.js 16 / React 19 / Tailwind v4 app
**Confidence:** HIGH

## Summary

This is a **CSS-first retrofit phase with all decisions already locked** in `46-CONTEXT.md` and pinned in `46-UI-SPEC.md`. The research job is not to choose an approach — it is to surface the implementation-ready specifics the planner needs and to **flag the discrepancies between the spec's prose and the actual code** so plans anchor on reality, not on the spec's column-labelling.

The work has three concrete jobs plus an all-route sweep: (1) wrap/migrate 6 financial tables onto the existing `ResponsiveTable` primitive (horizontal scroll, never drop a column) and add a fail-loud all-columns guard to the 4 highest-stakes tables; (2) delete `DesktopGate.tsx` so the wizard renders the real flow on a phone, preserving the `<Suspense key={source}>` CSR-bailout boundary; (3) verify the honest-state components (`EmptyStateCard`, `SampleFloorEmptyState`, allocations `EmptyState`, `Skeleton` family) reflow at 320px and fix only on overflow. All gated by a parametrized reflow sweep extending the phase-44 `assertNoReflow` helper, dual-wired into `ci.yml` per FLOW-01.

**Primary recommendation:** Wrap every targeted table in `<ResponsiveTable>` (zero restyle), delete `DesktopGate` + its test, and extend the existing reflow harness — touching **zero** `scenario.ts`/`compute.ts` math and inventing **zero** new aesthetic. The single highest-value research finding: **the UI-SPEC's "NEW mode" (7-col) vs "legacy/DESIGN mode" (9-col) labels are inverted relative to the code** — `LegacyHoldingsTable` is the 7-column one, `DesignHoldingsTable` is the 9-column one. The planner must map the guard to the code constants (`TOTAL_COLUMNS === 7`, `DESIGN_TOTAL_COLUMNS === 9`), not to the spec's mode names.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Table Reshape (TABLE-01)**
- Default reshape for wide financial tables at 320px is **horizontal scroll via the existing `ResponsiveTable`** wrapper (`overflow-x-auto` + `role="region"` + focusable + sr-only scroll hint). Never drop columns — column-drop on a financial table is a no-invented-data violation. CSS-first, zero math risk.
- Scope: **wrap the 3 currently-unprotected tables** (`HoldingsTable` NEW + LEGACY + `StrategyRowsTable` modes, `OpenPositionsTable`) with `ResponsiveTable`, AND **migrate the highest-stakes already-scrolling tables** (`ScenarioCompareTable`, `CorrelationMatrix`) onto `ResponsiveTable` so they gain the a11y region contract. Low-stakes tables that already have a raw `overflow-x-auto` div may stay as-is (not a forced 30-file migration).
- **All-columns-present fail-loud guard (SC#2)** lands on the highest-stakes financial tables only: `HoldingsTable` (NEW + legacy modes), `ScenarioCompareTable`, `CorrelationMatrix`. The guard fails if a future `hidden` / `truncate` / column-drop edit removes a material column or status.
- **No sticky first column** — plain horizontal scroll (simplest, CSS-first, matches the existing `ScenarioCompareTable` pattern). The cut-off column edge peeking past the right is the scroll affordance.

**Area 2 — Wizard De-Block (WIZARD-01)**
- Below 640px, **render the real wizard**. Keep the two-pass `isNarrow === null` hydration-safe pattern (matchMedia + deferred setState, SSR renders children) — remove ONLY the `isNarrow === true` → email-capture branch so it falls through to `children` at all widths.
- **Remove the "resume on desktop" email-capture form** entirely — the wizard is now usable on a phone.
- **Remove `DesktopGate.tsx` from the wizard tree and delete the component** (dead after de-block) — cleaner than a pass-through stub.
- **Reflow the wizard's own layout CSS-first** (stack fields, full-width inputs, ensure the step nav/footer is reachable and usable at 320px). No new JS viewport branching.

**Area 3 — Honest States Across Breakpoints (REFLOW-03)**
- **Verify** `EmptyStateCard` / `SampleFloorEmptyState` / allocations `EmptyState` reflow correctly at 320px (simple cards — likely already fine); fix ONLY any that overflow. No new empty-state components.
- **Verify** `Skeleton` / `SkeletonText` / `SkeletonCard` reflow at 320px; change only on overflow.
- **Extend the phase-44 reflow e2e** to cover at least one degenerate-state route at 320px so a regression that breaks an honest-empty layout fails loudly.

**Area 4 — Scope & Verification (REFLOW-01 / REFLOW-02)**
- **Cover ALL authed + public routes** per SC#1 (it is explicit). Sequence: tables + wizard first (highest risk), then a route-by-route reflow sweep.
- **Prove "every route passes"** with a parametrized reflow spec iterating a curated route list at 320px + 400% zoom (extends the phase-44 reflow helper; seeded for authed routes, FLOW-01 dual-wired into ci.yml).
- **Admin tables**: scroll-wrap with `ResponsiveTable` only (internal, lower-stakes) — no deep restructure.

### Claude's Discretion
- Exact curated route list for the parametrized reflow sweep, the precise CSS utilities per surface, and which specific low-stakes raw-`overflow-x-auto` tables (if any trivial) to opportunistically migrate — all at executor discretion within the decisions above.

### Deferred Ideas (OUT OF SCOPE)
- Charts (SVG + Recharts + EquityChart) reflow — phases 47-48 (explicitly out of scope here).
- Per-row card-stack table layout (an alternative reshape) — not adopted; horizontal scroll chosen. Revisit only if a specific table proves unusable via scroll.
- Edge-tab focus-ring clip + flagged-count badge >99 (phase-45 P3 TODOs) — separate, not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TABLE-01 | Every data table usable at 320px, no horizontal page overflow, **no dropped material columns** | `ResponsiveTable` wrap of 4 raw `<table>`s + migration of 2 raw-div tables; all-columns guard on 4 highest-stakes tables (this doc §Table Reshape Mechanics) |
| WIZARD-01 | Onboarding/API-key wizard usable on a phone — `DesktopGate` hard-block removed | Delete `DesktopGate.tsx` + `.test.tsx`; render `<Suspense key={source}>` subtree directly in `page.tsx`; preserve the boundary (this doc §Wizard De-Block) |
| REFLOW-01 | Every authed + public route reflows at 320px, no horizontal scroll (WCAG 1.4.10) | Parametrized reflow sweep extends `assertNoReflow`; curated route list (this doc §All-Route Sweep) |
| REFLOW-02 | Every surface usable at 400% zoom; zoom never disabled (WCAG 1.4.4) | Phase-44 zoom-permissive viewport export already in place; sweep verifies no two-axis page scroll at 400% |
| REFLOW-03 | Loading/empty/error/partial states render honestly across breakpoints | Verify-and-fix-only on 4 honest-state components (all fluid by construction today); ≥1 degenerate-state route added to the reflow sweep |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Impact on this phase |
|-----------|--------|----------------------|
| **This is a modified Next.js (16.2.9)** — read `node_modules/next/dist/docs/` before assuming APIs | AGENTS.md | The `<Suspense key={source}>` CSR-bailout boundary in `wizard/page.tsx` is a Next-16/React-19-specific fix; do NOT remove it when deleting `DesktopGate`. |
| **DESIGN.md is the LOCKED source of truth; always read before any visual/UI decision** | CLAUDE.md | This is a RETROFIT — reuse existing tokens/utilities; invent no new aesthetic. |
| **Coverage is a BLOCKING CI gate** (lines 82 / stmts 80 / fns 74 / branches 72) | CLAUDE.md | New viewport conditionals / guard tests need branch coverage. Never lower a threshold or blanket-update a snapshot to go green. Deleting `DesktopGate` (a `"use client"` component with matchMedia branches) REMOVES coverage-bearing lines — net coverage impact must be checked, not assumed neutral. |
| **Rule 3 — Surgical changes**; **Rule 11 — match codebase conventions** | CLAUDE.md (global) | Wrap, don't restyle. The `ResponsiveTable` migration of `ScenarioCompareTable` / `CorrelationMatrix` must drop ONLY the raw scroll div and preserve every other class/style verbatim (incl. the pre-existing raw `#4A5568`/`#64748B` inline hex in CorrelationMatrix — a known non-token site, do not "fix" it here). |
| **Rule 12 — Fail loud**; no silently-skipped tests | CLAUDE.md (global) | The all-columns guard must be *falsifiable* (verify it fails when a column is deleted, then restore). Every new e2e gate must actually execute (FLOW-01 dual-wiring). |
| **Skill routing** — design/visual audits route to `design-review`; this is implementation, not audit | CLAUDE.md | N/A for the build itself; relevant if a visual-polish question arises. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Table horizontal-scroll reshape | Browser / Client (CSS) | — | Pure presentation — `overflow-x-auto` + ARIA region. Zero data/server change. `ResponsiveTable` is a Server Component (no client hooks) so it composes into both server- and client-rendered table parents. |
| All-columns fail-loud guard | Build-time / CI (Vitest source-scan or render test) | — | A structural assertion over component output; runs in the test tier, gates merges. Not a runtime concern. |
| Wizard de-block | Frontend Server (RSC `page.tsx`) + Client island (`WizardClient`) | — | Deleting `DesktopGate` simplifies the RSC tree; the `<Suspense key={source}>` boundary is the React-19 CSR-bailout anchor for the client island. No API/data change. |
| Honest-state reflow | Browser / Client (CSS) | — | Fluid card/skeleton layout — CSS-only verify-and-fix. |
| All-route reflow sweep | CI (Playwright, browser-measured) | — | DOM geometry probe (`scrollWidth - clientWidth`) at 320px + 400% zoom. Browser tier measurement, CI tier gating. |

**Tier note:** This phase touches the **client/presentation tier only**. The frozen `scenario.ts` / `compute.ts` math boundary (API/engine tier) is never crossed — that is what makes this the "zero-risk" phase in the v1.3 build order.

## Standard Stack

No new dependencies. Every tool needed already exists in the repo (verified against `node_modules/*/package.json`, not training data).

### Core (already installed — verified versions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | **16.2.9** | App framework | The `<Suspense>` CSR-bailout semantics for `useSearchParams()` are Next-16-specific (see AGENTS.md mandate). |
| `react` / `react-dom` | **19.2.4** | UI runtime | Two-pass hydration pattern (`isNarrow === null`) is the React-19-safe mount idiom already used across the app. |
| `tailwindcss` | **4.2.2** | Utility CSS | v4 defaults: `sm=640px`, `lg=1024px`. No custom `--breakpoint-*` tokens (confirmed: `@theme inline` in `globals.css` declares colors + radii only). Responsive prefixes (`sm:`, `grid-cols-1 sm:grid-cols-2`) are the reflow mechanism. |
| `@playwright/test` | **1.59.1** | E2E reflow/target-size gates | Already drives `e2e/reflow.spec.ts` + `e2e/target-size.spec.ts` (phase 44). `page.setViewportSize({width:320})` + the `assertNoReflow` helper are the verification mechanism. |
| `@axe-core/playwright` | **4.11.2** | a11y scan | Already scans wizard + composer + discovery. **Cannot test reflow/zoom/target-size** (that's why the bespoke phase-44 gates exist) — relevant only insofar as the wizard de-block must keep the existing `wizard-axe.spec.ts` green. |
| `vitest` / `@vitest/coverage-v8` | **4.1.2 / 4.1.5** | Unit + the all-columns guard (if implemented as a render/source test) + coverage gate | The phase-44 zoom-meta gate is a precedent for a **Vitest source-scan** guard (zero ci.yml edit, zero seed gate). The all-columns guard can follow the same pattern. |

### Supporting (existing in-repo primitives — the reusable assets)
| Primitive | Path | Purpose | Use |
|-----------|------|---------|-----|
| `ResponsiveTable` | `src/components/ResponsiveTable.tsx` | Server Component: `<div className="overflow-x-auto" role="region" aria-label={hint} tabIndex={0}>` | THE canonical reshape primitive. Wrap every targeted `<table>`. Do not reinvent per-table wrappers. |
| `assertNoReflow` / `assertTargetSizes` | `e2e/helpers/reflow.ts` | Route-agnostic DOM-geometry probes (fail-loud on blank/404) | Extend for the parametrized sweep. `MIN_TARGET_PX = 44` is the WCAG floor — never lowered. |
| `useBreakpoint` / `useMediaQuery` | `src/hooks/useBreakpoint.ts` / `useMediaQuery.ts` | SSR-safe two-pass (server snapshot `'desktop'`) | For any *unavoidable* JS branch — but this phase introduces **no new matchMedia site** (it removes one). |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | Honest-absence shell (`rounded-lg border bg-surface px-4 py-8 text-center`) | Verify at 320px; fluid by construction (no fixed width). |
| `Skeleton` / `SkeletonText` / `SkeletonCard` | `src/components/ui/Skeleton.tsx` | Loading placeholders (`aria-hidden`, fractional widths only) | Verify at 320px; fluid by construction. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| Horizontal scroll | Per-row card-stack reshape | More "mobile-native" but loses the shared-axis tabular comparison DESIGN.md prizes ("data density > card density"). | **Rejected by CONTEXT** (deferred idea — revisit only if a table proves unusable via scroll). |
| Horizontal scroll | `hidden md:table-cell` column drop | Smaller width, but **shows the mobile user a smaller truth** — a no-invented-data violation. | **Banned** (REQUIREMENTS Out-of-Scope anti-feature). |
| No sticky column | Sticky first column (`position: sticky`) | Keeps the row label in view while scrolling — but adds complexity, z-index/clip risk, and diverges from the existing `ScenarioCompareTable` pattern. | **Rejected by CONTEXT** — plain scroll; clipped right edge is the affordance. |

**Installation:** none — `npm install` not required. (Package legitimacy audit therefore N/A — see below.)

## Package Legitimacy Audit

**Not applicable.** This phase installs **zero external packages** (REQUIREMENTS Out-of-Scope explicitly bars "New charting library / UI component kit / CSS framework"; net-new deps for the whole milestone are limited to `@lhci/cli`, which lands in phase 48). Every tool used is already in `package.json` and verified above against the local `node_modules` manifests. No slopcheck/registry verification needed because no install occurs.

## Architecture Patterns

### System Architecture Diagram (data + verification flow)

```
                         ┌─────────────────────────────────────────────┐
   320px viewport  ──────▶  Browser renders existing components         │
   (+ 400% zoom)         │  with Tailwind sm:/responsive utilities      │
                         └───────────────┬─────────────────────────────┘
                                         │
            ┌────────────────────────────┼────────────────────────────────┐
            ▼                            ▼                                 ▼
   ┌─────────────────┐         ┌──────────────────┐            ┌────────────────────┐
   │ WIDE TABLES     │         │ WIZARD            │            │ HONEST STATES      │
   │ wrapped in      │         │ DesktopGate GONE  │            │ EmptyStateCard /   │
   │ ResponsiveTable │         │ → renders real    │            │ Skeleton family    │
   │ (overflow-x     │         │   WizardClient at │            │ (fluid cards)      │
   │  scroll region) │         │   all widths      │            │ verify-only        │
   └────────┬────────┘         └─────────┬────────┘            └─────────┬──────────┘
            │ table scrolls,             │ <Suspense key={source}>      │
            │ PAGE does not              │ boundary PRESERVED           │ no fixed-px width
            ▼                            ▼                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  VERIFICATION TIER (CI)                                                        │
   │                                                                               │
   │  (a) all-columns guard (Vitest render/source) — 4 highest-stakes tables       │
   │  (b) assertNoReflow sweep (Playwright) — curated authed + public routes @320px │
   │  (c) ≥1 degenerate-state route in the sweep — honest-empty layout fails loud  │
   │  (d) existing wizard-axe / composer-axe / coverage gates STAY GREEN           │
   │                                                                               │
   │  FLOW-01: each new e2e gate wired in BOTH ci.yml list AND its env self-skip    │
   └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                         FROZEN scenario.ts / compute.ts — NEVER TOUCHED
```

A reader traces the primary case: a 320px request renders existing components; wide tables scroll inside their own region (page does not); the wizard renders the real flow; honest states stay fluid; CI proves all of it. The math engine is untouched throughout.

### Recommended Project Structure (where edits land — no new dirs)

```
src/
├── components/
│   └── ResponsiveTable.tsx          # the wrap primitive (UNCHANGED — already exists)
├── app/(dashboard)/
│   ├── allocations/
│   │   ├── components/
│   │   │   ├── HoldingsTable.tsx     # wrap 3 inner tables in <ResponsiveTable>
│   │   │   ├── OpenPositionsTable.tsx# wrap 1 table in <ResponsiveTable>
│   │   │   └── ScenarioCompareTable.tsx  # swap raw div → <ResponsiveTable>
│   │   ├── widgets/risk/
│   │   │   └── CorrelationMatrix.tsx # swap raw div → <ResponsiveTable> (keep #hex inline verbatim)
│   │   └── EmptyState.tsx            # verify @320px
│   └── strategies/new/wizard/
│       ├── page.tsx                  # remove <DesktopGate> wrapper; keep <Suspense key={source}>
│       ├── DesktopGate.tsx           # DELETE
│       ├── DesktopGate.test.tsx      # DELETE
│       └── WizardClient.tsx + steps/ # CSS-first layout reflow (stack fields, full-width inputs)
├── components/
│   ├── admin/                        # admin tables: <ResponsiveTable> wrap only
│   ├── ui/EmptyStateCard.tsx         # verify @320px (fluid)
│   ├── ui/Skeleton.tsx               # verify @320px (fluid)
│   └── scenarios/SampleFloorEmptyState.tsx  # verify @320px (renders EmptyStateCard)
e2e/
├── helpers/reflow.ts                 # EXTEND: add a parametrized route-sweep helper
├── reflow-sweep.spec.ts (NEW)        # parametrized authed+public sweep (or extend reflow.spec.ts)
└── (degenerate-state coverage)       # ≥1 honest-empty route at 320px
```

### Pattern 1: ResponsiveTable wrap (the entire Table Reshape job)
**What:** Wrap an existing `<table>` (or replace a raw scroll `<div>`) with the Server Component. Adds scroll + ARIA region; restyles nothing.
**When to use:** Every targeted table in this phase.
**Example:**
```tsx
// Source: src/components/ResponsiveTable.tsx (verified in-repo)
// BEFORE (HoldingsTable / OpenPositionsTable — raw, no scroll wrapper):
<table className="w-full text-sm">…</table>

// AFTER:
<ResponsiveTable>
  <table className="w-full text-sm">…</table>
</ResponsiveTable>

// MIGRATION (ScenarioCompareTable:185 / CorrelationMatrix:173 — raw scroll div → primitive):
// BEFORE: <div className="overflow-x-auto"> <table>…</table> </div>
// AFTER:  <ResponsiveTable> <table>…</table> </ResponsiveTable>
//   NB CorrelationMatrix uses overflow-AUTO (two-axis). ResponsiveTable is
//   overflow-X only — for an N×N matrix vertical scroll comes from the page,
//   horizontal from the region. This is the intended behavior (page does the
//   vertical; region does the horizontal). Confirm the matrix still scrolls
//   wide N at 320px after the swap.
```

### Pattern 2: Wizard de-block (delete the gate, keep the boundary)
**What:** Remove the `<DesktopGate>` wrapper from `wizard/page.tsx`, render the `<Suspense key={source}>` subtree directly, delete the component + test.
**Example:**
```tsx
// Source: src/app/(dashboard)/strategies/new/wizard/page.tsx:91-123 (verified)
// BEFORE:
return (
  <DesktopGate>
    <Suspense key={source} fallback={null}>
      <WizardClient key={source} initialDraft={initialDraft} />
    </Suspense>
  </DesktopGate>
);
// AFTER (DesktopGate import + wrapper removed; boundary PRESERVED verbatim):
return (
  <Suspense key={source} fallback={null}>
    <WizardClient key={source} initialDraft={initialDraft} />
  </Suspense>
);
// Then: delete DesktopGate.tsx + DesktopGate.test.tsx. The /api/for-quants-lead
// route STAYS (other callers) — only the wizard's POST of
// wizard_context.wizard_session_id="desktop-gate" goes away.
```

### Pattern 3: CSS-first single-column collapse (wizard layout + any multi-col grid)
**What:** Collapse multi-column step grids and the broker-selector grid to one column at `<sm` using the project's existing responsive pattern.
**Example:**
```tsx
// Use the project's existing Tailwind v4 responsive pattern — DO NOT invent a breakpoint.
// e.g. grid-cols-1 sm:grid-cols-3  (broker selector: 3-col → 1-col at <640px)
//      grid-cols-1 sm:grid-cols-2  (multi-field step grids)
// Inputs: w-full at <sm. Step nav/footer Back/Next/Submit ≥44px, no page overflow.
```

### Anti-Patterns to Avoid
- **`hidden md:table-cell` on any material column** — banned (no-invented-data). The guard exists to catch this.
- **Restyling the wrapped table** — `ResponsiveTable` adds scroll + region ONLY; row heights are already ~44px (DESIGN.md). Don't touch padding/borders.
- **Removing the `<Suspense key={source}>` boundary** when deleting `DesktopGate` — re-introduces the empty-CsvUploadStep hydration bug (documented at `page.tsx:93-119`).
- **Adding a duplicate `sr-only` scroll-hint node** — `ResponsiveTable`'s `aria-label` IS the accessible name; a second node double-announces.
- **Shrinking text or recoloring tokens to fit 320px** — scroll (tables) or stack (cards); never shrink-to-fit or recolor (would break the AA-blessed contrast).
- **A second JS viewport branch** — this phase removes one matchMedia site and adds none.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Horizontal-scroll table region | A new per-table `<div className="overflow-x-auto">` with ad-hoc ARIA | `ResponsiveTable` | One source of the scroll + region + sr-only-hint contract; double-announce and tabIndex pitfalls already solved. |
| 320px-overflow assertion | A new geometry probe in each spec | `assertNoReflow(page, anchor)` | Already handles `clientWidth` (not `innerWidth`), ≤1px slop, fail-loud-on-blank, offender breadcrumb, toPass retry. |
| 44px target-size check | A new measurement loop | `assertTargetSizes(page, anchor, selector)` | Already handles measured>0 false-green guard + scoped selector. |
| Zoom-permissive viewport | A new viewport meta | The phase-44 root-layout viewport export (already zoom-permissive) | WCAG 1.4.4 already enforced; the sweep just verifies routes don't two-axis-scroll. |
| Honest empty/skeleton shell | A new mobile empty-state component | Existing `EmptyStateCard` / `Skeleton` (verify-and-fix-only) | CONTEXT forbids new empty-state components; both are already fluid. |
| Wizard mobile fallback | A read-only mobile review state (the old DESIGN-04 v2 plan) | The REAL wizard (de-block) | CONTEXT supersedes DESIGN-04's deferred mobile-fallback — the phone now renders the full flow. |

**Key insight:** Every primitive this phase needs was deliberately built in phase 44 (the foundation phase) precisely so phases 45-48 wire them in without re-deriving. The research finding is that the wiring is straightforward; the *risk* is entirely in (a) mapping the guard to the right code constants and (b) FLOW-01 wiring discipline — not in any missing capability.

## Table Reshape Mechanics (the implementation-ready specifics)

### ⚠️ CRITICAL: the UI-SPEC mode labels are INVERTED vs the code

`[VERIFIED: codebase grep — src/app/(dashboard)/allocations/components/HoldingsTable.tsx]`

The UI-SPEC §Component Contracts table calls the 7-column table "NEW row mode" and the 9-column table "legacy/DESIGN mode". **The code is the opposite.** The planner MUST anchor the guard on the code constants, not the spec's mode names:

| Code component | Code constant | Column count | Columns (verbatim `<th>`) | Row data-attr | Spec calls it |
|----------------|---------------|--------------|---------------------------|---------------|---------------|
| `LegacyHoldingsTable` (line ~360) | `TOTAL_COLUMNS = 7` (line 378) | **7** | Venue/Symbol · Type · Quantity · Entry price · Value (USD) · Unrealized P&L · *(Notes icon col)* | (none) | "NEW row mode" ❌ inverted |
| `DesignHoldingsTable` (line ~553) | `DESIGN_TOTAL_COLUMNS = 9` (line 551) | **9** | *(Status dot)* · Strategy · Symbol · Weight · Allocation · MTD · Sharpe · Max DD · Age | `data-row-id={row.id}` | "legacy/DESIGN mode" ❌ inverted |
| `StrategyRowsTable` (line ~223) | (8 `<th>`, no const) | **8** | Strategy · Manager · Weight · Allocation · MTD · Sharpe · Max DD · Age | `data-strategy-row={row.id}` | "StrategyRows mode" ✓ |

**Action for planner:** the all-columns guard targets `LegacyHoldingsTable` (assert 7) and `DesignHoldingsTable` (assert 9) — *by component, anchored to the constant*. Do not trust the spec's "NEW"/"DESIGN" labels for which set of columns to assert; use the `<th>` label sets above. The 7th column of `LegacyHoldingsTable` is the **Notes icon column** (`<th className="w-10 px-2 py-2" aria-label="Notes" />`) — it has no text label; the guard should count columns / assert the named material set (Venue/Symbol → Unrealized P&L), not require a "Notes" text label.

### The 6 tables to touch (verified current state)

| # | Table | File:line | Current state | Action |
|---|-------|-----------|---------------|--------|
| 1 | `LegacyHoldingsTable` | `HoldingsTable.tsx:399` | raw `<table>`, no wrapper | Wrap in `ResponsiveTable` + all-columns guard (7) |
| 2 | `DesignHoldingsTable` | `HoldingsTable.tsx:620` | raw `<table>`, no wrapper | Wrap in `ResponsiveTable` + all-columns guard (9) |
| 3 | `StrategyRowsTable` | `HoldingsTable.tsx:260` | raw `<table>`, no wrapper | Wrap in `ResponsiveTable` (no guard required) |
| 4 | `OpenPositionsTable` | `OpenPositionsTable.tsx:127` | raw `<table>` (+ `<tfoot>` total), no wrapper | Wrap in `ResponsiveTable` (no guard required) |
| 5 | `ScenarioCompareTable` | `ScenarioCompareTable.tsx:185` | raw `<div className="overflow-x-auto">` | Replace div with `ResponsiveTable` + all-columns guard |
| 6 | `CorrelationMatrix` | `CorrelationMatrix.tsx:173` | raw `<div className="overflow-auto">` | Replace div with `ResponsiveTable` + all-columns guard |

### All-columns guard anchors (verified data-testids / constants)

`[VERIFIED: codebase grep]`

| Table | What the guard asserts | Falsifiable anchor (already in code) |
|-------|------------------------|--------------------------------------|
| `LegacyHoldingsTable` | all 7 columns present | `TOTAL_COLUMNS === 7` + the 6 named `<th>` labels (Venue/Symbol … Unrealized P&L) + the Notes icon `<th>` |
| `DesignHoldingsTable` | all 9 columns present | `DESIGN_TOTAL_COLUMNS === 9` + status `<th aria-label="Status">` + Strategy/Symbol/Weight/Allocation/MTD/Sharpe/Max DD/Age headers |
| `ScenarioCompareTable` | Metric axis col + every scenario col + every METRICS row | `data-testid="scenario-col-{name}"` (line 195) per column; `data-testid="cell-{name}-{key}"` (line 220) per cell; `METRICS` array length |
| `CorrelationMatrix` | full N×N symmetric set | every name appears as a `<th>` AND a row-label `<td>`; `data-testid="corr-cell"` (line ~201) per cell; `data-testid="correlation-matrix"` on root. Guard: header-`<th>` count === row-label count === N. |

**CorrelationMatrix label-truncation is NOT a column drop (do not trip the guard on it):** `[VERIFIED: code line 181/194]` the long strategy-name LABELS carry `className="truncate" style={{maxWidth:80}}` with a `title={n}` tooltip. The name stays present and reachable — the guard polices column/row PRESENCE, never label ellipsis. Baseline confirmed: these 4 tables currently carry **no** `hidden md:table-cell` and **no** material-column `truncate`; the only `hidden` string in the holdings file is the `"{n} holdings hidden from view"` expand-copy (line 494/808) — that is a row-filter affordance, NOT a column drop.

### Implementation note: guard form
The phase-44 **zoom-meta gate is a precedent** (`[VERIFIED: STATE.md P44-03]`): a Vitest source-scan test with zero ci.yml edit + zero seed gate. The all-columns guard can be either (a) a **Vitest render test** (render each table with fixture rows, assert all `<th>`/columns present — strongest, catches runtime drops) or (b) a **source-scan** (grep the JSX for the column set + assert no `hidden`/`md:table-cell` on material `<th>`). A render test is recommended (it is falsifiable against an actual column delete and contributes branch coverage). Whichever form, **verify it fails when a material column is deleted, then restore** (CLAUDE.md Rule 12 falsifiability).

## Wizard De-Block (implementation-ready)

`[VERIFIED: src/app/(dashboard)/strategies/new/wizard/page.tsx + DesktopGate.tsx]`

**Files:**
- `page.tsx` — remove the `DesktopGate` import (line 5) + the `<DesktopGate>…</DesktopGate>` wrapper (lines 92/122). Render the `<Suspense key={source} fallback={null}>` subtree directly. **The Suspense boundary + `key={source}` are load-bearing** (Next-16/React-19 CSR-bailout fix — `page.tsx:93-119`); preserve verbatim.
- `DesktopGate.tsx` — **DELETE** (dead after de-block; CONTEXT chose delete over pass-through stub).
- `DesktopGate.test.tsx` — **DELETE** (subject gone). ⚠️ This is a coverage-bearing test file; confirm the coverage ratchet still holds after deletion (the `DesktopGate` `"use client"` branches it covered also disappear from the denominator — net effect must be measured, not assumed).
- `/api/for-quants-lead` — **STAYS** (other callers). Only the wizard's `wizard_context.wizard_session_id="desktop-gate"` POST goes away.

**Why no hydration mismatch (SC#5):** Today `DesktopGate` already returns `children` on the SSR pass (`isNarrow === null`) and on desktop (`!isNarrow`). Removing the narrow branch makes SSR and the first client paint render the **same tree at every width** — this REMOVES a viewport branch rather than adding one, so it cannot introduce a new hydration warning. There is an existing `e2e/wizard-hydration-probe.spec.ts` — keep it green.

**Wizard layout reflow (CSS-first, no new JS):**
- Stack fields vertically, full-width inputs at `<sm`.
- Broker-selector grid (DESIGN.md §Broker Selector Grid, 3-col) → 1-col at `<sm`; each broker card keeps white surface / 1px `#E2E8F0` border / 8px radius / `border-accent bg-accent/5` active state verbatim.
- CSV escape-hatch card stays full-width; verify no overflow at 320px.
- Step nav/footer Back/Next/Submit visible + tappable (≥44px) at 320px, no horizontal page overflow.
- Preserve the DESIGN.md §9-State Matrix a11y: `aria-current="step"`, step-transition focus management, `role="alert"`/`role="status"` live regions, Tab/Shift+Tab DOM order. The reflow is layout-only.

## Runtime State Inventory

> This phase is a CSS/component retrofit (rename-like surface, but no string-rename of stored keys). Inventory completed for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — verified. No datastore key, collection, or user_id is renamed. Tables read existing payloads unchanged; the engine is frozen. | none |
| Live service config | **None** — verified. No external-service UI/DB config references a string this phase changes. The deleted `wizard_session_id="desktop-gate"` is an outbound *value* the wizard stops sending, not stored config to migrate. | none |
| OS-registered state | **None** — verified. No OS task/process/unit references anything this phase touches. | none |
| Secrets/env vars | **None renamed.** `/api/for-quants-lead` keeps its existing env/secrets (route stays). No env var added or renamed. | none |
| Build artifacts | `DesktopGate.tsx` + `DesktopGate.test.tsx` are **deleted** — knip (non-blocking CI report) will stop flagging them; no stale build artifact persists (Next rebuilds from source). After deletion, run typecheck to catch any dangling import. | rebuild (automatic on next `npm run build`) |

**Net:** the only "state" change is the deletion of 2 wizard files + the removal of one outbound POST value. No data migration, no runtime registration, no env/secret rename.

## Common Pitfalls

### Pitfall 1: Mapping the all-columns guard to the spec's inverted mode labels
**What goes wrong:** The guard asserts the wrong column set (7 vs 9) because the UI-SPEC calls the 7-col table "NEW" and the 9-col table "DESIGN/legacy" — inverted from the code.
**Why it happens:** The spec was written from a code scout that mislabeled the modes; the code constants (`TOTAL_COLUMNS=7` in `LegacyHoldingsTable`, `DESIGN_TOTAL_COLUMNS=9` in `DesignHoldingsTable`) are authoritative.
**How to avoid:** Anchor the guard on the **code component + its constant**, using the verbatim `<th>` label sets in §Table Reshape Mechanics above. Never on the spec's "NEW"/"DESIGN" naming.
**Warning signs:** A guard that asserts 9 columns on `LegacyHoldingsTable` (which has 7) will fail at write-time — but a guard that asserts 7 on the wrong file passes vacuously. Verify each guard fails when *its* table's column is deleted.

### Pitfall 2: FLOW-01 — a new e2e gate wired in only one of two places (twice-burned)
**What goes wrong:** A new reflow-sweep / degenerate-state spec is added to `ci.yml` but not given an env self-skip (or vice-versa) → it either never runs (false-green) or crashes the unseeded run.
**Why it happens:** Two separate wirings are required and easy to half-do.
**How to avoid:** For each new spec wire BOTH: (1) the appropriate `npx playwright test …` list in `ci.yml` — **unseeded** routes go in the unseeded line (`e2e/auth.spec.ts … e2e/reflow.spec.ts e2e/target-size.spec.ts` at `ci.yml:1059`); **seeded** authed routes go in the **MA-8 seed-gated list** (`ci.yml:1222+`, gated on `vars.E2E_TEST_DB_CONFIGURED`); AND (2) the spec's own guard — seeded specs use `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY; test.skip(!HAS_SEED_ENV, …)`; unseeded specs carry NO env guard (matching `reflow.spec.ts`).
**Warning signs:** A "passing" CI where the new spec shows `skipped` (or doesn't appear) in the run summary. Precedents: `e2e/reflow.spec.ts` (unseeded), `e2e/mobile-drawer-keyboard.spec.ts` (seeded — full skip + MA-8 list).

### Pitfall 3: Coverage ratchet regression from deleting DesktopGate
**What goes wrong:** Deleting `DesktopGate.tsx` (a `"use client"` component with matchMedia/state branches) + `DesktopGate.test.tsx` shifts the coverage denominator; net branch/function coverage can move in either direction, and a blanket "it'll be fine" assumption trips the blocking gate.
**Why it happens:** `frontend-coverage` is a hard gate (lines 82 / stmts 80 / fns 74 / branches 72). New guard tests add covered lines; deleted component+test remove both numerator and denominator.
**How to avoid:** Run `npm run test:coverage` locally after the wizard de-block + guard additions; confirm all four metrics still clear. Never lower a threshold or blanket-update a snapshot to pass (CLAUDE.md). New viewport conditionals (if any) need their branches covered.
**Warning signs:** `frontend-coverage` red in CI with a metric just under threshold.

### Pitfall 4: CorrelationMatrix migration — overflow-AUTO vs overflow-X + inline hex
**What goes wrong:** Swapping CorrelationMatrix's `overflow-auto` (two-axis) div for `ResponsiveTable` (`overflow-x-auto`, one-axis) changes vertical-scroll behavior; OR the migration "tidies" the pre-existing raw `#4A5568`/`#64748B` inline hex into tokens and drifts the visual.
**Why it happens:** The two divs aren't identical; the matrix uses non-token inline hex (a pre-existing, intentional-for-now pattern).
**How to avoid:** After the swap, verify the N×N matrix still scrolls horizontally at 320px (page provides vertical). Preserve the inline `style` hex verbatim (Rule 3 — surgical; do not "fix" the non-token hex in this phase). Keep `data-testid="correlation-matrix"` + `data-testid="corr-cell"` intact (the guard + existing tests use them).
**Warning signs:** A composer/risk e2e or the all-columns guard fails after the swap; or a visual diff in the matrix colors.

### Pitfall 5: Degenerate-state route choice that doesn't actually render the honest-empty layout
**What goes wrong:** The "≥1 degenerate-state route" added to the sweep navigates to a route that, unseeded, shows a login/404 instead of the honest-empty card → the gate false-greens (or fails-loud but for the wrong reason).
**Why it happens:** Honest-empty states (0-strategy composer, <10-overlapping-day correlation) require either a seeded degenerate fixture or a public route that renders the empty card.
**How to avoid:** Anchor the spec on a *visible* honest-empty element (e.g. the `EmptyStateCard` heading text, or `data-testid="correlation-matrix"` empty branch). Prefer a route reachable in the chosen seed/unseeded context. The `assertNoReflow` anchor must be the empty-state DOM node, not generic chrome.
**Warning signs:** The degenerate spec passes against a login page (anchor too generic) or skips silently.

## Code Examples

### Wrapping a raw table (the most common operation)
```tsx
// Source: src/components/ResponsiveTable.tsx (verified in-repo)
import { ResponsiveTable } from "@/components/ResponsiveTable";

<ResponsiveTable>
  <table className="w-full text-sm">{/* unchanged */}</table>
</ResponsiveTable>
```

### Parametrized reflow sweep (extending the phase-44 helper)
```ts
// Pattern: extend e2e/reflow.spec.ts (unseeded public) + a seeded authed spec.
// Source: e2e/helpers/reflow.ts (assertNoReflow) + e2e/reflow.spec.ts (verified)
import { test } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";

// UNSEEDED public routes — no env guard (matches reflow.spec.ts), ci.yml unseeded list.
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/demo", anchor: "main h1" },
  // … landing, public factsheet/share, /discovery (public surface) …
];
test.describe("reflow sweep (WCAG 1.4.10) @ 320px — public", () => {
  for (const r of PUBLIC_ROUTES) {
    test(`${r.path} no horizontal overflow at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      const res = await page.goto(r.path);
      if (res && res.status() >= 400) throw new Error(`${r.path} HTTP ${res.status()}`);
      await assertNoReflow(page, r.anchor);
    });
  }
});
```

```ts
// SEEDED authed sweep — env self-skip (FLOW-01 place 2), ci.yml MA-8 list (place 1).
// Source pattern: e2e/mobile-drawer-keyboard.spec.ts (verified)
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
test.describe("reflow sweep @ 320px — authed", () => {
  test.skip(!HAS_SEED_ENV, "seed env not wired — prevents false-green on login/404 (W-02)");
  // login + iterate /allocations (+ tabs), composer, factsheets, bridge, risk,
  // discovery, wizard, /portfolios, /security, admin — each anchored on a
  // visible content element, assertNoReflow at 320px.
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wizard 640px hard-block + email-capture (DESIGN-04 deferred mobile fallback) | Real wizard at all widths (de-block) | This phase (CONTEXT supersedes DESIGN-04) | Phone users complete onboarding; the "build a read-only mobile review state" v2 plan is moot. |
| Per-surface raw `overflow-x-auto` divs (no a11y region) | Single `ResponsiveTable` Server Component (scroll + region + sr-only hint) | Phase 44 built it; phase 46 wires it | One contract, keyboard+SR reachable off-screen columns. |
| Inline reflow probe duplicated per spec (`demo-public.spec.ts`) | Shared `assertNoReflow` / `assertTargetSizes` helpers | Phase 44 | Route-agnostic, fail-loud, reused app-wide. |

**Deprecated/outdated:**
- DESIGN.md §9-State Matrix "Mobile fallback (DESIGN-04): deferred to v2 … ship the 640px `DesktopGate.tsx` as-is" — **superseded by this phase's WIZARD-01 de-block.** The trigger condition (PostHog mobile-start count > 0) is now moot; the real wizard ships on mobile regardless.
- `tailwind.config.*` / `components.json` — **do not exist** (Tailwind v4 `@theme inline` in `globals.css`; project is not shadcn). Any plan referencing a tailwind config file is wrong.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The curated authed route list (allocations + tabs, composer, factsheets, bridge, risk, discovery, single-strategy, wizard, portfolios, security, admin) is the right floor for the sweep | All-Route Sweep | LOW — CONTEXT explicitly delegates the exact list to executor discretion; SC#1 ("all authed + public") is the floor. Under-coverage is the only failure mode, caught at plan-review. |
| A2 | A Vitest **render** test is the best form for the all-columns guard (vs a source-scan) | Table Reshape Mechanics | LOW — both forms satisfy SC#2; render is recommended for falsifiability + coverage, but a source-scan (zoom-meta precedent) is equally valid. Planner's call. |
| A3 | Deleting `DesktopGate.test.tsx` nets out coverage-neutral-or-positive once the guard tests land | Wizard De-Block / Pitfall 3 | MEDIUM — coverage is a hard gate; the actual net depends on measured numbers. **Must be verified with `npm run test:coverage`, not assumed.** This is the one place a "looks fine" assumption could redden CI. |
| A4 | CorrelationMatrix swapping `overflow-auto` → `ResponsiveTable` (`overflow-x-auto`) keeps the matrix usable (page provides vertical scroll) | Pitfall 4 | LOW-MEDIUM — intended behavior, but verify the N×N matrix still scrolls wide N at 320px after the swap; an unusually tall matrix relying on the div's vertical scroll is the edge case. |

## Open Questions

1. **All-columns guard: render test vs source-scan?**
   - What we know: phase-44 zoom-meta gate is a Vitest source-scan precedent (zero ci.yml/seed-gate). A render test catches runtime column drops + adds branch coverage.
   - What's unclear: nothing blocking — both satisfy SC#2.
   - Recommendation: render test for the 4 highest-stakes tables (strongest falsifiability); verify each fails on a deleted column, then restore.

2. **Which exact degenerate-state route for the honest-empty reflow spec?**
   - What we know: candidates are a 0-strategy composer, a <10-overlapping-day `CorrelationMatrix` ("No correlation data available"), or a `SampleFloorEmptyState` surface.
   - What's unclear: which is reachable in the chosen (un)seeded context without false-greening on a login page.
   - Recommendation: anchor on the visible `EmptyStateCard` heading or `data-testid="correlation-matrix"` empty branch; pick the route whose empty state renders in the available test context. Executor discretion per CONTEXT.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | build + vitest + playwright | ✓ | node 20 (CI) | — |
| `@playwright/test` + chromium | reflow sweep + degenerate spec | ✓ | 1.59.1 | — |
| `vitest` + coverage-v8 | all-columns guard + coverage gate | ✓ | 4.1.2 / 4.1.5 | — |
| `tailwindcss` v4 | responsive utilities | ✓ | 4.2.2 | — |
| Seeded test Supabase (`vars.E2E_TEST_DB_CONFIGURED`) | authed routes in the sweep | ✓ in CI (gated) / ✗ on forks | — | Authed sweep self-skips via `HAS_SEED_ENV` on forks; public sweep runs unseeded. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** seeded authed sweep on fork PRs (falls back to skip via the FLOW-01 self-skip guard — by design).

## Validation Architecture

> nyquist_validation is enabled (no `workflow.nyquist_validation: false` in config). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Unit/guard framework | Vitest 4.1.2 (+ `@vitest/coverage-v8` 4.1.5) |
| E2E framework | Playwright 1.59.1 (chromium) |
| Unit config | `vitest.config.ts` (thresholds: lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run (unit) | `npx vitest run <file> --reporter=dot` |
| Coverage (gated) | `npm run test:coverage` (== `npx vitest run --coverage`) |
| E2E quick run | `npx playwright test e2e/reflow.spec.ts` (unseeded) |
| E2E full (CI) | the `ci.yml` unseeded list + the MA-8 seed-gated list |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TABLE-01 | 6 tables scroll, no page overflow @320px | e2e (reflow) | `npx playwright test e2e/reflow*.spec.ts` | ❌ Wave 0 (extend sweep to allocations/composer/risk) |
| TABLE-01 | no material column dropped (4 highest-stakes) | unit (render guard) | `npx vitest run src/**/*all-columns*.test.tsx` | ❌ Wave 0 (new guard test) |
| WIZARD-01 | wizard renders real flow @320px, no overflow, ≥44px nav | e2e | `npx playwright test e2e/reflow*.spec.ts` (wizard route) | ❌ Wave 0 (add wizard to authed sweep) |
| WIZARD-01 | no hydration mismatch after de-block | e2e (existing) | `npx playwright test e2e/wizard-hydration-probe.spec.ts` | ✅ exists — keep green |
| WIZARD-01 | wizard a11y stays clean | e2e (existing) | `npx playwright test e2e/wizard-axe.spec.ts` | ✅ exists — keep green |
| REFLOW-01 | every authed+public route, no overflow @320px | e2e (parametrized) | reflow sweep (public unseeded + authed seeded) | ❌ Wave 0 |
| REFLOW-02 | usable @400% zoom, zoom not disabled | e2e (sweep at 400%) + existing zoom-meta source gate | sweep + `npx vitest run <zoom-meta gate>` | partial — zoom-meta gate ✅ (phase 44); 400% page-scroll check in sweep ❌ Wave 0 |
| REFLOW-03 | honest-empty/skeleton layout unbroken @320px | e2e (degenerate route) + verify components fluid | sweep degenerate route | ❌ Wave 0 (≥1 degenerate route) |
| (gate) | coverage ratchet holds after de-block + guards | unit (coverage) | `npm run test:coverage` | ✅ gate exists — must stay green |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched guard/test> --reporter=dot` + `npx playwright test e2e/reflow.spec.ts` (the fast unseeded probe).
- **Per wave merge:** `npm run test:coverage` (full suite + ratchet) + the full reflow sweep (public unseeded locally; authed seeded in CI).
- **Phase gate:** full vitest + coverage green, full reflow sweep green (public in CI, authed in the seed-gated MA-8 run), existing wizard-axe/hydration-probe green, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] All-columns render guard test (4 highest-stakes tables) — covers TABLE-01 SC#2. **Verify falsifiable** (fails on a deleted column, then restore).
- [ ] Parametrized reflow sweep — **public unseeded spec** (extend/add alongside `e2e/reflow.spec.ts`), wired into the ci.yml unseeded list (no env guard).
- [ ] Parametrized reflow sweep — **authed seeded spec** (`HAS_SEED_ENV` self-skip), wired into the ci.yml MA-8 seed-gated list.
- [ ] ≥1 degenerate-state route in the sweep — covers REFLOW-03; anchor on the visible honest-empty DOM node.
- [ ] (Verify, not build) coverage stays green after `DesktopGate` + `DesktopGate.test.tsx` deletion + new guard tests.
- Framework install: **none** (all present).

## Security Domain

> `security_enforcement` not set to `false` in config — section included. This is a presentation-layer phase; the security surface is small.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes (minor) | The wizard's auth gate (`supabase.auth.getUser()` in `page.tsx:67`) is PRESERVED — the de-block removes only the viewport branch, not the auth check. `(dashboard)` layout auth still applies. |
| V2 Authentication | no | No auth logic touched. |
| V3 Session Management | no | No session handling touched. |
| V4 Access Control | yes (verify-no-regress) | Tables render existing tenant-scoped payloads; wrapping in `ResponsiveTable` adds no data path. The wizard still redirects unauthenticated users to `/login`. No new access path introduced. |
| V5 Input Validation | no | No new input. The deleted `DesktopGate` email form is removed (one fewer input surface). |
| V6 Cryptography | no | None. |
| V12 Files/Resources | no | None. |
| V14 Configuration | yes (minor) | Zoom-permissive viewport meta (no `maximum-scale`/`user-scalable=no`) is a WCAG control already enforced by the phase-44 source gate — keep it. |

### Known Threat Patterns for {Next.js 16 / React 19 presentation retrofit}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Removing an auth gate while "simplifying" the RSC tree during de-block | Elevation of Privilege | **Do NOT touch** `supabase.auth.getUser()` / the `redirect("/login…")` in `wizard/page.tsx`. Delete ONLY the `DesktopGate` wrapper; the auth check sits above the Suspense boundary and stays. |
| Hidden-but-present material data (e.g. a `hidden` column still in the DOM, scraped/announced) | Information Disclosure | N/A here — the reshape SCROLLS columns (all visible+reachable), never hides them. The anti-feature (`hidden md:table-cell`) is banned precisely to avoid a "smaller truth". |
| Leaking the deleted email-capture flow's data path | N/A | The `/api/for-quants-lead` route stays for legit callers; only the wizard's `desktop-gate` POST is removed. No new endpoint, no data exposure. |

**Net security posture:** this phase REDUCES attack surface (one fewer input form) and touches no auth/data/crypto path. The only security must-not-regress is preserving the wizard's server-side auth gate during the de-block.

## Sources

### Primary (HIGH confidence — verified this session)
- `src/components/ResponsiveTable.tsx` — the wrap primitive (Server Component, `overflow-x-auto` + `role="region"` + `tabIndex=0` + default hint).
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` — `TOTAL_COLUMNS=7` (`LegacyHoldingsTable`), `DESIGN_TOTAL_COLUMNS=9` (`DesignHoldingsTable`), `StrategyRowsTable` 8 cols; the spec/code mode-label inversion.
- `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` — raw 7-col `<table>` + `<tfoot>` total, no wrapper.
- `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx:185` — raw `overflow-x-auto` div; `data-testid="scenario-col-{name}"`, `cell-{name}-{key}`, `METRICS` rows.
- `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx:173` — raw `overflow-auto` div; N×N with `truncate maxWidth:80 title={n}` labels; `data-testid="correlation-matrix"` / `corr-cell`; raw inline `#4A5568`/`#64748B` hex.
- `src/app/(dashboard)/strategies/new/wizard/page.tsx` — `<DesktopGate><Suspense key={source}>…` structure; the CSR-bailout boundary doc (lines 93-119); the auth gate (line 67).
- `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` — two-pass `isNarrow:boolean|null`, matchMedia `(max-width:639px)`, narrow→email branch (lines 77-114).
- `src/components/ui/EmptyStateCard.tsx`, `src/components/ui/Skeleton.tsx` — fluid by construction (no fixed width).
- `e2e/helpers/reflow.ts`, `e2e/reflow.spec.ts`, `e2e/target-size.spec.ts`, `e2e/mobile-drawer-keyboard.spec.ts` — the reflow harness + unseeded/seeded FLOW-01 precedents.
- `.github/workflows/ci.yml` — unseeded Playwright list (line 1059), seed-gated MA-8 list (line 1222+), `frontend-coverage` gate (line 251+).
- `package.json` + `node_modules/*/package.json` — verified versions (next 16.2.9, react 19.2.4, tailwindcss 4.2.2, @playwright/test 1.59.1, @axe-core/playwright 4.11.2, vitest 4.1.2).
- `46-CONTEXT.md`, `46-UI-SPEC.md`, `REQUIREMENTS.md`, `ROADMAP.md` (STATE.md roadmap block), `DESIGN.md`, `CLAUDE.md`/`AGENTS.md` — locked decisions, design contract, requirements, constraints.

### Secondary (MEDIUM confidence)
- STATE.md Decisions log (P44-03 zoom-meta source-gate precedent; 44-04 reflow/target-size unseeded wiring; 45-02 scroll-on-existing-role-element precedent) — cross-references the phase-44/45 patterns this phase extends.

### Tertiary (LOW confidence)
- None — every load-bearing claim was verified against the codebase this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every tool verified against local `node_modules` manifests; no install.
- Architecture/patterns: HIGH — `ResponsiveTable` + reflow helpers read directly; wiring is mechanical.
- Table mechanics (incl. the mode-label inversion): HIGH — confirmed by reading `HoldingsTable.tsx` constants and `<th>` sets directly.
- Wizard de-block: HIGH — `page.tsx` + `DesktopGate.tsx` read in full; the Suspense-boundary risk is documented in the code itself.
- Pitfalls: HIGH for #1/#2/#4/#5 (code-verified); MEDIUM for #3 (coverage net effect must be measured, not predicted).

**Research date:** 2026-06-27
**Valid until:** ~2026-07-27 (stable — no fast-moving external deps; the only volatility is if the touched components are refactored by a parallel agent before planning. Re-verify the `HoldingsTable.tsx` column constants if the file's mtime changes before execution.)
