# Project Research Summary

**Project:** Quantalyze
**Domain:** UI/UX overhaul of an existing institutional financial dashboard (Next.js 16 App Router)
**Researched:** 2026-06-28
**Confidence:** HIGH

## Executive Summary

v1.4 is a **quality milestone, not a feature build**. Every surface already exists; the goal is best-in-class rendering — fluid typography that never clips, an evolved design system, restructured navigation, and React/Next-16 best practices — while the scenario math engine, the WCAG-AA floor, and all frozen invariants stay locked. All four researchers independently converged on the same dependency order: **design-system spine first, surfaces second, verification last.** Doing these out of order forces double-touches on every surface and makes failure classes (visual vs routing) impossible to isolate.

The net-new technical footprint is deliberately minimal. Fluid type is **pure CSS** (`clamp()` in `--text-*`/`--space-*` tokens — no dependency); container queries are **Tailwind v4 core** (no dependency); motion is **CSS transitions + the native View Transitions API** (no dependency); visual regression is **Playwright `toHaveScreenshot()`** (already installed); design-lint **extends the existing local `eslint-plugin-quantalyze`**. The one justified new production dependency is **`radix-ui@1.6.0`**, scoped to hand-rolled widgets with no native HTML equivalent (tabs, menus, popovers, combobox). Native `<dialog>` and `<select>` stay native.

The three load-bearing risks: (1) Tailwind v4 `@theme inline` bakes literal values, so fluid `clamp()` tokens must live in a separate **plain `@theme`** block or the variable chain flattens; (2) every `clamp()` must include a **`rem` middle term** or it fails WCAG 1.4.4 / W3C F94 — uncatchable by the existing zoom-meta guard, so a new lint guard is needed; (3) lifting desktop byte-identity removes v1.3's safety net and turns existing pixel-golden specs red on *intended* changes → replace with deliberate per-chart re-baseline + tolerance-based Playwright goldens, never blind `--update-snapshots`.

## Key Findings

### Recommended Stack

Almost everything ships with what's already installed. The highest-leverage change is a Tailwind v4 *wiring* change (split `@theme` blocks for fluid tokens), not a new package.

**Core technologies:**
- **Fluid type/space tokens** (pure CSS `clamp()` in a plain `@theme` block): scale across 320px → ultra-wide — no dependency; Utopia methodology for min/max viewport + ratios.
- **Container queries** (`@container`, Tailwind v4 core): component-by-its-own-width responsiveness; *reduces* JS vs the window-coupled `useBreakpoint`.
- **`radix-ui@1.6.0`** (the ONE new prod dep, React-19 peer-clean): only for widgets with no native HTML equivalent. Keep native `<dialog>`/`<select>`. Stance, not a rewrite mandate.
- **Motion native-only**: CSS transitions (house style) + CSS View Transitions API. No motion library (DESIGN.md is anti-decoration). React `<ViewTransition>` is Canary — skip.
- **Playwright `toHaveScreenshot()`** for visual regression (reuse the app-wide route×viewport matrix); **extend `eslint-plugin-quantalyze`** with `no-raw-hex` / `no-raw-px-font-size` / `clamp-without-rem` rules.

### Expected Features

**Must have (table stakes):**
- Fluid, no-clip typography & layout across all resolutions (zero `clamp()` in repo today).
- Honest, complete loading/empty/error/skeleton coverage (the `ErrorEnvelope`, 9-state matrix, `MetricCell` em-dash-for-null patterns already exist — extend app-wide).
- Data-table reshape: sticky header + first column, priority-collapse to reachable detail, scroll cue, density control (`ResponsiveTable` is scroll-only today, with its own TODO).
- Role-scoped nav, breadcrumbs, consistent active/back-path states.

**Should have (differentiators):**
- Command palette (⌘K) — none exists today; the headline navigation differentiator.
- Restrained, purposeful micro-interactions appropriate to an Industrial/Utilitarian financial product.
- Wizard polish (field-level validation surfacing, review-before-submit).

**Defer / Out of Scope (anti-features — several VIOLATE no-invented-data, not merely taste):**
- Animated count-ups, demo numbers in empty states, optimistic un-computed metrics → **no-invented-data violations**.
- Decorative motion (gradients/blobs/parallax) → against DESIGN.md.
- Big-bang component rewrites → strangler migration instead.

### Architecture Approach

Tokens live in `globals.css` `@theme` (+ a drift-tested TS mirror in `src/lib/design-tokens/`); the IA gate is `src/proxy.ts` (Next 16's renamed middleware) with a hand-maintained `PUBLIC_ROUTES` allowlist. RSC boundaries are already correct — the server auth-shell wraps client islands (`DashboardChrome`/`Sidebar`), and the frozen scenario engine + `FactsheetProvider` must stay client islands. Primitives are well-adopted (`ui/Button` 68 importers) but raw-element sprawl is large (186 raw `<button>`, 64 raw `<table>`, 48 raw `<input>`) → strangler migration, not big-bang.

**Major components:**
1. **Token spine** — fluid `@theme` + DESIGN.md↔token drift tests; the dependency for everything downstream.
2. **Primitive library** — refresh existing + add Table/Tabs/Dialog/Select/Field/Breadcrumb; migrate raw elements per-surface.
3. **App shell + IA** — route groups (URL-invisible), nav, breadcrumbs, `proxy.ts` allowlist + redirect sync.

### Critical Pitfalls

1. **`@theme inline` flattens variables** — put fluid `clamp()` tokens in a separate plain `@theme` block (codebase-proven 4×).
2. **`clamp()` without a `rem` middle term fails WCAG zoom (F94)** — existing zoom-meta guard can't catch it; add a lint guard in Phase 49.
3. **IA restructure breaks share/deep links** — `proxy.ts` `PUBLIC_ROUTES` must sync in lockstep with any route move (the v1.1.0 #512 share-link 307→login bug class).
4. **Lifted byte-identity reds the chart-parity goldens** — deliberate per-chart re-baseline + tolerance goldens; never blind `--update-snapshots`.
5. **Client→server conversion silently breaks live recompute** — never RSC-ify files touching `scenario.ts`, the Web Worker, `FactsheetProvider`, `useBreakpoint`, or chart interactivity (237 `"use client"` files). And don't drop below the coverage ratchet — port tests in the same PR as any rewrite.

## Implications for Roadmap

Suggested phase structure (6 phases, numbering continues from 48 → Phase 49+):

### Phase 49: Design-system refresh + fluid token foundation
**Rationale:** spine before surfaces; lowest blast radius; unblocks everything.
**Delivers:** refreshed DESIGN.md (design-consultation), fluid `--text-*`/`--space-*` plain `@theme` block, clamp-without-rem + raw-hex + raw-px lint guards, contrast-validated colors, extended DESIGN.md↔token drift tests, v1.4 frozen-spine guard.
**Avoids:** `@theme inline` flatten, F94 zoom failure.

### Phase 50: Primitive refresh + missing primitives (strangler migration)
**Rationale:** depends on Phase 49 tokens; one refresh propagates to 68/48/21 consumers.
**Delivers:** refreshed Button/Card/Input/Badge/Modal/Skeleton; new Table/Tabs/Dialog/Select/Field/Breadcrumb; `radix-ui@1.6.0` only where a non-native widget is built.
**Uses:** radix-ui (scoped), tokens from 49.

### Phase 51: Shell + IA restructure
**Rationale:** highest blast radius; sequenced after primitives so visual vs routing failure classes stay isolated.
**Delivers:** optional `(marketing)` route group (URL-invisible), nav refinement, breadcrumbs, searchParams-aware active states, command palette; route-contract inventory + `PUBLIC_ROUTES` sync + redirect map + authed canary as exit criteria.
**Avoids:** #512 share-link regression.

### Phase 52: Per-surface application — allocator journey
**Rationale:** highest-traffic surface; depends on 50 + 51.
**Delivers:** primitives + fluid type + no-clip + container queries + data-table reshape + 9-state coverage across /allocations, composer, factsheets, discovery, bridge, risk, single-strategy. Composer is a frozen client island — chrome/layout only; `scenario.ts`/`FactsheetBody` byte-identical (BODY-02). Truncation-audit exits feed this phase.

### Phase 53: Per-surface application — wizard + /security + admin + public
**Rationale:** lower-traffic surfaces; depends on 50 + 51.
**Delivers:** wizard polish, `loading.tsx`/`error.tsx` gap-fill, per-surface DESIGN.md-conformance exit criterion (prevents "two apps" drift).

### Phase 54: Verification + v1.3 debt cleanup + visual-regression replacement
**Rationale:** last — everything must exist to gate against.
**Delivers:** ultra-wide (2560px) row added to the axe/reflow matrix; authed/mobile axe rows re-enabled (needs hermetic seeded DB); lhci budget ratcheted up from 0.60; no-clip CI guard; tolerance-based Playwright goldens (byte-identity replacement); deliberate per-chart re-baseline; real-device authed sign-off; app-wide design-review audit.

### Phase Ordering Rationale
- **Token spine (49) is a hard predecessor to everything** — no surface work before tokens lock, or every surface is touched twice.
- **A truncation classification audit** (legitimate ellipsis vs accidental clip; ~96 sites) is a **hard predecessor to introducing fluid type** — place at Phase 49 exit or Phase 52 entry, else fluid type relocates the clip.
- **The byte-identity replacement strategy must be established before Phase 52 changes any chart's visual output.**
- IA (51) after primitives (50) so a broken route and a broken style never blur into one failure.

### Research Flags
Phases likely needing a spike during planning:
- **Phase 51:** command-palette backend (RLS-scoped strategy search: Postgres FTS vs client-filtered; role-gating) + full route-contract inventory. **Do not start implementation without the inventory.**
- **Phase 54:** hermetic seeded-DB approach for re-enabling authed/mobile axe rows (per-spec isolated DB / seed-teardown transaction / dedicated axe project) + Playwright screenshot tolerances & dynamic-region masking.

Phases with standard patterns (skip research-phase):
- **Phase 49:** Tailwind v4 `@theme` + Utopia clamp are codebase-verified and docs-confirmed (exact scale numbers are a design-consultation output, not a research question).
- **Phase 50:** strangler primitive migration is the established house pattern (per-widget Radix list is a Phase-50 entry a11y audit).
- **Phases 52/53:** table sticky/density, skeleton/state coverage, wizard polish are well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified vs live `globals.css`, `npm view`, Tailwind v4 docs, Next 16 local docs |
| Features | HIGH | Grounded in live codebase grep counts; anti-features tied to locked invariants |
| Architecture | HIGH | Live read of `proxy.ts`, `globals.css`, Sidebar, factsheet-context; PROJECT.md invariants |
| Pitfalls | HIGH | W3C F94 authoritative; `@theme inline` codebase-proven 4×; #512 bug class in memory |

**Overall confidence:** HIGH

### Gaps to Address
- **Exact fluid scale values** — design-consultation output in Phase 49, not a research question.
- **Per-widget Radix migration list** — Phase 50 entry a11y audit (MEDIUM confidence on the list).
- **Command-palette backend architecture** — Phase 51 spike.
- **Hermetic seeded-DB approach** — Phase 54 spike (gates how early authed coverage returns).
- **Playwright visual-regression operational tolerances** — start from v1.3's ±2–5% chart-parity precedent.

## Sources

### Primary (HIGH confidence)
- Tailwind CSS v4 docs — theme variables, `--text-*` + clamp, container queries (`@container`)
- W3C WCAG 2.1 — Understanding SC 1.4.4 Resize Text; F94 (clamp/viewport-unit zoom failure)
- Next.js 16 docs — App Router, route groups, View Transitions; local `node_modules/next/dist/docs/`
- Radix Primitives releases / React 19 peer compatibility; shadcn/ui Tailwind v4 docs
- Live codebase — `globals.css`, `src/proxy.ts`, `src/lib/design-tokens/`, Sidebar, factsheet-context, frozen-spine + coverage CI guards

### Secondary (MEDIUM confidence)
- Utopia fluid type/space methodology; Smashing Magazine fluid-type & accessibility articles
- LogRocket / Pencil&Paper enterprise data-table UX; Stripe Apps patterns; NN/g + Carbon on motion restraint

---
*Research completed: 2026-06-28*
*Ready for roadmap: yes*
