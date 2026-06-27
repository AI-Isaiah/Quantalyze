# Roadmap: Quantalyze

## Milestones

- ✅ **v1.0.0 — API-Key Rewrite** — Phases 15–20 (shipped 2026-06-20) — [archive](milestones/v1.0.0-ROADMAP.md)
- ✅ **v1.1.0 — Scenario Analysis** — Phases 21–28 (shipped 2026-06-22) — [archive](milestones/v1.1.0-ROADMAP.md)
- ✅ **v1.2 — Allocator Cohesion** — Phases 29–33 (shipped 2026-06-24) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.2.1 — scenario-tab-hardening** — Phases 34–38 (shipped 2026-06-25) — [archive](milestones/v1.2.1-ROADMAP.md)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** — Phases 39–43 (shipped 2026-06-26) — [archive](milestones/v1.2.2-ROADMAP.md)
- 🚧 **v1.3 — Mobile & Adaptive UI** — Phases 44–48 (in progress; see `## v1.3 — Mobile & Adaptive UI` below)

> Pre-v1.0 milestones (v0.14.0.0 → v0.17.0.0, the original phases) are archived under
> `.planning/milestones/`. The authoritative shipped record for every milestone is the git
> tag + CHANGELOG + `.planning/MILESTONES.md`; per-milestone phase detail lives in each
> `milestones/v*-ROADMAP.md`. The active milestone's authoritative phase detail lives in the
> `## v1.3 …` section at the bottom of this file.

## Phases

All phases through Phase 43 are shipped and archived. Full per-phase detail (goals,
requirements, success criteria, plans) lives in the milestone archives linked above.
The active v1.3 phases (44–48) are detailed in the `## v1.3 — Mobile & Adaptive UI`
section below.

<details>
<summary>✅ v1.0.0 API-Key Rewrite (Phases 15–20) — SHIPPED 2026-06-20</summary>

See [milestones/v1.0.0-ROADMAP.md](milestones/v1.0.0-ROADMAP.md).

</details>

<details>
<summary>✅ v1.1.0 Scenario Analysis (Phases 21–28) — SHIPPED 2026-06-22</summary>

Surfacing + correlation + honest projection (21); methodology-honesty scaffolding (22);
persistence & compare (23); benchmark comparison (24); read-only sharing (25); stress &
VaR (26); Monte-Carlo bands (27); weight optimizer (28).
See [milestones/v1.1.0-ROADMAP.md](milestones/v1.1.0-ROADMAP.md).

</details>

<details>
<summary>✅ v1.2 Allocator Cohesion (Phases 29–33) — SHIPPED 2026-06-24</summary>

Unify the three allocator surfaces into one composer (29); factsheet-grade graphs on the
blend (30); collapsible composition controls (31); retire `/scenarios` + nav consolidation
(32); journey polish + composer axe gate (33).
See [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md).

</details>

<details>
<summary>✅ v1.2.1 scenario-tab-hardening (Phases 34–38) — SHIPPED 2026-06-25</summary>

Explicit unified 252 annualization (34); per-key dailies foundation (35); repoint stats
reads (36); honest per-data-source toggle (37); composer factsheet parity + blank-mode fix
(38).
See [milestones/v1.2.1-ROADMAP.md](milestones/v1.2.1-ROADMAP.md).

</details>

<details>
<summary>✅ v1.2.2 scenario-tab-factsheet-parity (Phases 39–43) — SHIPPED 2026-06-26</summary>

Complete payload adapter (39); mount the real factsheet body (40); constituent correlation
& diversification (41); peer-cohort override + mandate + own-book delta (42); edge states,
toggle fold & four permanent guards (43).
See [milestones/v1.2.2-ROADMAP.md](milestones/v1.2.2-ROADMAP.md).

</details>

<details>
<summary>🚧 v1.3 Mobile & Adaptive UI (Phases 44–48) — IN PROGRESS</summary>

Foundation primitives + verification gates (44); navigation shell completion (45);
surface-by-surface reflow + tables + wizard (46); hand-rolled SVG charts touch + legibility
(47); Recharts + EquityChart + final verification + mobile perf budget (48).
Full detail in the `## v1.3 — Mobile & Adaptive UI` section below.

</details>

## Progress

| Milestone | Phases | Status | Shipped | Tag |
|-----------|--------|--------|---------|-----|
| v1.0.0 API-Key Rewrite | 15–20 | ✅ Complete | 2026-06-20 | `v1.0.0` |
| v1.1.0 Scenario Analysis | 21–28 | ✅ Complete | 2026-06-22 | `v1.1.0` |
| v1.2 Allocator Cohesion | 29–33 | ✅ Complete | 2026-06-24 | `v1.2` |
| v1.2.1 scenario-tab-hardening | 34–38 | ✅ Complete | 2026-06-25 | `v1.2.1` |
| v1.2.2 scenario-tab-factsheet-parity | 39–43 | ✅ Complete | 2026-06-26 | `v1.2.2` |
| v1.3 Mobile & Adaptive UI | 44–48 | 🚧 In progress | — | — |

---

## v1.3 — Mobile & Adaptive UI

**Goal:** Every surface in Quantalyze becomes fluidly responsive — adapting to screen resolution,
mobile viewport, and browser/screen zoom (reflow-correct, content never clips) — with UI best
practices held as the bar throughout. A RETROFIT / gap-closing milestone (the hard primitives — the
mobile nav shell, a gold-standard responsive+touch SVG chart, an SSR-safe breakpoint hook — already
exist). Additive presentation layer over the FROZEN `scenario.ts` / `compute.ts` engine. Phases 44–48
(numbering continues from 43; no reset).

**Granularity:** standard (5 phases). **Coverage:** 14 v1 requirements → 5 phases (CHART-01 split into
CHART-01a/SVG + CHART-01b/Recharts by chart family so each owns one phase). 16 REQ-IDs mapped, 0
orphans, 0 duplicates.

**LOCKED invariants (never relaxed by responsive work):**
- **No-invented-data** — degenerate inputs keep honest empty states at every viewport; tables RESHAPE
  (scroll / stack / labeled-summary), never DROP material columns; charts never downsample displayed data.
- **Frozen math byte-identity** — `scenario.ts` SCENARIO-05 zero-diff + the factsheet byte-identity guard
  (BODY-02) + `compute.ts` parity + chart-parity snapshots stay green throughout. A red guard is
  information (you crossed the boundary), never an obstacle to weaken.
- **No-peer-rank-a-hypothetical-blend** — carried from v1.2.2; the one audited `scenarioPeer` aggregate
  override stands, never an `ingestSource` flip.

**Cross-cutting risk gates (mirror prior milestones' IMPACT-02 / BODY-02 silent-failure gates):**
- **axe is necessary but insufficient** — axe finds ~57% of WCAG issues and structurally CANNOT test
  Reflow (1.4.10), Resize Text (1.4.4), Target Size (2.5.8), or focus-trap correctness. Bespoke CI gates
  sit BESIDE app-wide axe, never instead of it.
- **FLOW-01 wiring** — every new e2e gate (reflow / target-size / zoom-meta / mobile-keyboard / mobile-axe
  / perf-budget) must be wired into BOTH the `HAS_SEED_ENV` seed-guard AND `ci.yml`, or it never runs
  (a false-green by omission — burned the project twice).
- **Coverage ratchet held** — lines 82 / statements 80 / functions 74 / branches 72; new viewport
  conditionals need branch coverage; never lower a threshold or blanket-update a snapshot to go green.
- **Real-device authed sign-off** — headless can't hydrate authed pages; the final acceptance is a human
  on a real phone across the authed surfaces.

### Phase Structure

| Phase | Goal | Requirements | Success Criteria |
|-------|------|--------------|------------------|
| 44 — Foundation Primitives & Verification Gates | 4/4 | Complete    | 2026-06-27 |
| 45 — Navigation Shell Completion | 3/3 | Complete    | 2026-06-27 |
| 46 — Surface-by-Surface Reflow (CSS-first, no charts) | 2/4 | In Progress|  |
| 47 — Hand-Rolled SVG Charts (touch + legibility + portrait) | The 16 SVG charts become touch-inspectable + legible at 320px + portrait-tuned, with frozen math byte-identical | CHART-01a, CHART-02, CHART-03 | 4 criteria |
| 48 — Recharts + EquityChart + Final Verification | The Recharts family + the 2200-LOC EquityChart get touch parity (NOT rewritten); the combined gate matrix + mobile perf budget gate app-wide; real-device authed sign-off makes "v1.3 done" falsifiable | CHART-01b, A11Y-01, A11Y-03 | 5 criteria |

### Phase Details

#### Phase 44: Foundation Primitives & Verification Gates
**Goal**: Build the highest-leverage shared primitives once, and stand up the bespoke verification gates
FIRST — so every later surface edit is "wrap + apply classes" instead of re-deriving the recipe 40×, and
so phases 45–48 are continuously checked at 320px / 400% zoom as they land (mirrors how the v1.2
JOURNEY-03 axe gate caught 3 real bugs only once it actually ran in CI).
**Depends on**: Nothing (first phase of the milestone)
**Requirements**: A11Y-02
**Success Criteria** (what must be TRUE):
  1. A Playwright reflow spec asserts `document.documentElement.scrollWidth <= clientWidth` (≤1px slop) at a
     320px CSS width — anchored on a visible content element so it can't false-green on a blank page — and a
     44px target-size measurement gate exists, both runnable against any route.
  2. A source-scan CI guard fails on any `maximum-scale` / `user-scalable=no` in the `viewport` export or a
     `<meta name="viewport">`; the root `layout.tsx` declares an explicit zoom-permissive viewport.
  3. The shared primitives exist and are unit-tested: `useBreakpoint` (thin two-pass wrapper over the
     existing SSR-safe `useMediaQuery`, server snapshot `'desktop'`), `ResponsiveTable` (`overflow-x-auto` +
     sr-only scroll hint), and `ResponsiveChartFrame` (the viewBox + `preserveAspectRatio` + `w-full`
     recipe extracted from `TimeSeriesChart` without breaking its parity test).
  4. Every new gate (reflow / target-size / zoom-meta) is wired into BOTH the `HAS_SEED_ENV` seed-guard AND
     `ci.yml`, proven to actually execute in a CI run (FLOW-01), and the coverage ratchet holds un-lowered.
**Plans**: 4 plans (all Wave 1 — file-disjoint, fully parallel)
- [x] 44-01-PLAN.md — useBreakpoint (SSR-safe, server snapshot 'desktop') + ResponsiveTable (overflow-x-auto + sr-only hint) primitives + unit tests [SC#3]
- [x] 44-02-PLAN.md — ResponsiveChartFrame extracted from TimeSeriesChart (parity-by-construction) + structural byte-identity unit test [SC#3]
- [x] 44-03-PLAN.md — zoom-meta Vitest source-scan guard + root layout.tsx zoom-permissive viewport export [SC#2]
- [x] 44-04-PLAN.md — reflow + target-size Playwright gates (reusable helper + /security specs) + FLOW-01 ci.yml dual-wiring + proven-execution [SC#1, SC#4]
**UI hint**: yes

#### Phase 45: Navigation Shell Completion
**Goal**: Complete the mobile navigation shell — role-aware bottom nav, a scrollable multi-tab strip, a
hardened drawer focus-trap, and an app-wide skip-link — because the shell frames every authed surface, so
fixing it first means Phase 46 work is tested inside real mobile chrome.
**Depends on**: Phase 44 (primitives + the keyboard/reflow gates)
**Requirements**: NAV-01, NAV-02, NAV-03
**Success Criteria** (what must be TRUE):
  1. On a 375px viewport an allocator reaches their primary workspace from the bottom nav — `/allocations`,
     Bridge, and Risk are present (replacing the role-blind 3-item `MobileNav.TABS` stub), and a manager /
     admin each get their own role-appropriate set from the props the drawer already receives.
  2. On a phone (`<sm`) the multi-tab surfaces (Overview / Holdings / Risk / Scenario) stay reachable via a
     horizontally scrollable tab strip with the JOURNEY-03 `role=tab` a11y fix preserved.
  3. A mobile-drawer keyboard e2e proves Tab/Shift+Tab are contained inside the open drawer (background
     `inert`, no leak to the page behind the backdrop), focus moves in on open and restores to the trigger
     on close, and an app-shell skip-link (generalized from the factsheet skip-link) lets a keyboard user
     jump to main content on every route.
  4. The drawer hamburger and bottom-nav targets measure ≥44px and the nav shell passes the Phase 44 reflow
     gate at 320px and under 400% zoom.
**Plans**: 3 plans (Wave 1 — 45-01 + 45-02 file-disjoint, parallel; Wave 2 — 45-03 depends on both)
- [x] 45-01-PLAN.md — Role-aware MobileNav (buildPrimaryMobileNav single-sourced from Sidebar) + DashboardChrome inert `<main>` + app-shell skip-link [NAV-01, NAV-03]
- [x] 45-02-PLAN.md — CSS-first horizontally-scrollable tab strip preserving the JOURNEY-03 role=tab a11y fix [NAV-02]
- [x] 45-03-PLAN.md — Seeded authed mobile-drawer keyboard e2e (containment + skip-link + 320px reflow/44px) + FLOW-01 dual-wiring [NAV-03]
**UI hint**: yes

#### Phase 46: Surface-by-Surface Reflow (CSS-first, no charts)
**Goal**: Make every authed + public route reflow correctly at 320px / 400% zoom using CSS-first work that
has zero risk of crossing the frozen math boundary — reshaping tables honestly, de-blocking the wizard, and
keeping degenerate empty states honest across breakpoints.
**Depends on**: Phase 45 (work tested inside the completed mobile shell)
**Requirements**: TABLE-01, WIZARD-01, REFLOW-01, REFLOW-02, REFLOW-03
**Success Criteria** (what must be TRUE):
  1. Every authed route (allocator `/allocations` + Scenario composer + factsheets + Bridge + Risk +
     Discovery + Single-Strategy; manager onboarding wizard + `/portfolios`; `/security`; admin) AND every
     public/marketing route passes the Phase 44 reflow gate — `scrollWidth <= clientWidth` at 320px, no
     horizontal page scroll (WCAG 1.4.10), and remains usable at 400% browser zoom with zoom never disabled
     (WCAG 1.4.4).
  2. Every data table (`HoldingsTable`, `ScenarioCompareTable`, `CorrelationMatrix`, admin tables) is usable
     at 320px with NO dropped material columns — reshaped via scroll / stack / labeled-summary so every
     column's data is reachable on the same viewport — and an all-columns-present guard on the highest-stakes
     tables fails loudly if a future `hidden`/`truncate` edit drops a material metric or status.
  3. The onboarding / API-key wizard is usable on a phone — the `DesktopGate.tsx` hard-block below 640px is
     removed while the `isNarrow===null` two-pass hydration-safe pattern is preserved (no hydration mismatch).
  4. Loading / empty / error / partial states render honestly across breakpoints — degenerate inputs
     (0/1 strategy, <10 overlapping days, non-finite returns) keep their honest empty states with no
     fabricated data and no broken layout at every viewport.
  5. No new hydration warning appears on any retrofitted route (CSS-first; any JS viewport branch routes
     through the single two-pass `useBreakpoint`), and the coverage ratchet holds.
**Plans**: 4 plans (Wave 1 — 46-01/46-02/46-03 file-disjoint, fully parallel; Wave 2 — 46-04 depends on all three)
- [x] 46-01-PLAN.md — Wrap the 3 HoldingsTable inner tables + OpenPositionsTable in ResponsiveTable + all-columns guard (legacy-7 / design-9, code constants) [TABLE-01]
- [x] 46-02-PLAN.md — Migrate ScenarioCompareTable + CorrelationMatrix onto ResponsiveTable (+ admin scroll-wrap) + their all-columns guards [TABLE-01]
- [ ] 46-03-PLAN.md — Wizard de-block: delete DesktopGate + test, render Suspense directly (auth gate + boundary preserved), CSS-first layout reflow, coverage ratchet measured [WIZARD-01]
- [ ] 46-04-PLAN.md — Parametrized reflow sweep (public unseeded + seeded authed + degenerate route) + honest-state verify + FLOW-01 ci.yml dual-wiring [REFLOW-01, REFLOW-02, REFLOW-03]
**UI hint**: yes

#### Phase 47: Hand-Rolled SVG Charts (touch + legibility + portrait)
**Goal**: Bring the 16 hand-rolled SVG charts to touch + legibility + portrait parity with the reference
`TimeSeriesChart` — the cleaner learning pass before the most complex Recharts family — while the frozen
math stays byte-identical (the highest-cost regression in the milestone).
**Depends on**: Phase 46 (CSS surfaces banked; the chart frame applied inside reflowed pages)
**Requirements**: CHART-01a, CHART-02, CHART-03
**Success Criteria** (what must be TRUE):
  1. Every hand-rolled SVG chart (`ReturnQuantiles`, `DailyHeatmap`, `DrawdownChart`, `Sparkline`, …) is
     touch-inspectable on a phone — a tap reveals (and pins) the value that hover gives on desktop, via the
     `TimeSeriesChart` tap-pins-crosshair recipe applied through `ResponsiveChartFrame` — with
     `pointer-coarse:` ≥44px hit targets, verified by the Phase 44 target-size gate.
  2. Chart text is legible at 320px (WCAG 1.4.4) — the viewBox-downscale trap (axis text shrinking to ~4–5px)
     is fixed by reduced tick density / larger viewBox font / HTML-overlay labels in real px, not by shrinking;
     verified by a portrait snapshot in the chart-parity suite.
  3. The densest panels (the 7-panel factsheet + correlation heatmaps) render portrait-tuned (lower density,
     taller aspect) on small screens.
  4. `scenario.test.ts` SCENARIO-05 zero-diff, the factsheet byte-identity guard (BODY-02), `compute.ts`
     parity, and the chart-parity snapshots are all GREEN and un-weakened throughout — no chart component
     re-derives a series/metric/domain; every value is read from the existing payload, never recomputed.
**Plans**: TBD
**UI hint**: yes

#### Phase 48: Recharts + EquityChart + Final Verification
**Goal**: Close out the most-touched, touch-weakest, highest-regression-risk chart family (23 Recharts files
+ the 2200-LOC live-book `EquityChart`) with touch parity — informed by the SVG pass and NOT a rewrite — then
make "v1.3 done" falsifiable with the combined app-wide gate matrix, a mobile performance budget, and a
real-device authed sign-off.
**Depends on**: Phase 47 (the touch pattern proven on SVG charts informs the Recharts per-family decision)
**Requirements**: CHART-01b, A11Y-01, A11Y-03
**Success Criteria** (what must be TRUE):
  1. Every Recharts chart is touch-inspectable on a phone — an explicit tap-to-show/tap-to-pin tooltip (plus
     the DESIGN.md KPI-cell value fallback) replaces the hover-first default — and `EquityChart`'s existing
     `onPointer`/`hoverIdx` handlers are tuned for touch + small width WITHOUT rewriting the chart (its
     measured-width path holds at small widths).
  2. The app-wide axe WCAG-AA gate covers all primary routes in CI (extended from the current 5-route
     coverage), run at BOTH Desktop and a mobile viewport, wired into both the seed-guard and `ci.yml`
     (FLOW-01), with the embedded-factsheet landmark exception handled the same scoped `serious+critical`
     way (never a rule disable).
  3. The complete bespoke gate matrix — 320px reflow, 44px target-size, zoom-meta grep, and mobile
     keyboard/focus — runs app-wide as BLOCKING CI checks BESIDE axe, each confirmed CI-wired and actually
     executed.
  4. A mobile performance budget gates public routes in CI via `@lhci/cli` + a Lighthouse-mobile job, with
     thresholds seeded from a baseline run and ratcheted tighter over time; no ResizeObserver-loop console
     error and stable memory on rotate.
  5. A human signs off on a real-device authed walkthrough across the authed surfaces (headless can't hydrate
     authed pages); the coverage ratchet is verified held (never lowered) and all frozen-math / byte-identity
     / parity guards remain green un-weakened.
**Plans**: TBD
**UI hint**: yes

### Phase Ordering Rationale

- **Primitives + gates before surfaces** — regressions surface immediately (continuous 320px/400% checks),
  not at the end. Mirrors the v1.2 JOURNEY-03 lesson.
- **Nav before surfaces** — the shell frames every authed surface; surface work is then tested inside real
  mobile chrome.
- **CSS surfaces before charts** — charts are the only category where the frozen math boundary is nearby and
  gestures are non-trivial; bank the cheap, safe CSS wins first.
- **SVG charts before Recharts** — simpler internal structure; prove the touch pattern before the
  most-complex family and the per-family migration decision.
- **EquityChart last** — 2200 LOC, live-book Overview, already ResizeObserver-responsive; touching it last
  limits regression surface to surgical touch-handler tuning.

---
*Last updated: 2026-06-27 — Phase 46 planned (4 plans: Wave 1 tables 46-01/46-02 + wizard de-block 46-03 file-disjoint parallel; Wave 2 reflow sweep + FLOW-01 dual-wiring 46-04. All 5 REQ-IDs covered: TABLE-01/WIZARD-01/REFLOW-01/02/03; all-columns guards anchored on the CODE constants per the UI-SPEC mode-label inversion; coverage ratchet measured after DesktopGate deletion). Phases 44/45 planned+complete earlier. v1.3 roadmap (44–48; 0 orphans).*
