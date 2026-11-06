# Phase 170: LAYOUT - Research

**Researched:** 2026-09-27
**Domain:** Responsive layout (Tailwind v4 flex/grid overflow, sticky/fixed stacking), WCAG AA contrast, Next.js 16 App Router session-aware layout
**Confidence:** MEDIUM overall. HIGH for the owning files and root causes read at HEAD; MEDIUM/LOW for rendering behaviour not probed in a real browser (tagged `[ASSUMED]`).
**HEAD measured:** `8eafe1057` (origin/main, worktree `feat/170-layout`).

<user_constraints>
## User Constraints (from ROADMAP `### Phase 170`; no CONTEXT.md exists)

No `/gsd-discuss-phase` was run. The founder decisions recorded in the ROADMAP section are the locked decisions and are copied here verbatim.

### Locked Decisions
- **Founder decision, 2026-09-27 (AskUserQuestion, "390px + 200% zoom (Recommended)"; founder: "The oldest phone that will use it is an iphone 12, or desktop"):** the narrowest supported viewport is 390 px (iPhone 12), plus desktop at 200% zoom. Every "320 px" check in this phase, including the 2026-09-26 routed item below, is now a 390 px + desktop 200% zoom check, run by the orchestrator in the logged-in browser. The 400%-zoom WCAG 1.4.10 reflow check is deliberately not required.
- **Founder decision, 2026-09-25 (AskUserQuestion):** the second of the two QA phases; ships after Phase 169 PAGETRUTH.
- **Split 2026-09-26 by founder decision: one topic per phase.** Sibling: Phase 170.1 COPY. This phase was 170 PAGECOPY and keeps the former criteria 1 and 5 (renumbered 1 and 2 below) plus its own copy of the former criterion 7 (now 3), text unchanged. The former criteria 2, 3, 4 and 6 and the goal's copy clauses ("no raw ids or internal labels, no test text, no typos") moved to 170.1 verbatim. The phase directory keeps its original `170-pagecopy` slug.
- **Scope (founder 2026-09-27, "Implement the whole 170 phase"):** EVERY item in `### Phase 170` is in scope, including the four items routed from 169 (a)-(d), the 2026-09-26 routed items, the grey-chip contrast item and the 2026-09-27 narrow-width items (f)-(l).
- **Criterion 3 is run by the orchestrator** in the logged-in browser after deploy, not by the founder.
- **Depends on:** Phase 169.

### Success Criteria (verbatim)
1. Factsheet and Allocations panels no longer stack as near-identical layers; the private-link control is secondary and never overlaps content.
2. `/security` and the legal pages show the signed-in header when signed in; the floating tweaks control never covers the bottom navigation; `/compare` does not point to controls that do not exist; `/admin/match` on mobile is read-only in fact, not only in words; no page scrolls horizontally at 390 px (iPhone 12) or at desktop 200% zoom.
3. Each page is re-checked at 390 px (iPhone 12) and at desktop 200% zoom in the logged-in browser after deploy, by the orchestrator, and shows no horizontal page scroll and no clipped primary action.

### Claude's Discretion
- Fix approach per item, provided it stays inside DESIGN.md tokens, palette, type scale and spacing.
- Test strategy and plan grouping.

### Deferred Ideas (OUT OF SCOPE)
- **Phase 170.1 COPY is FROZEN:** raw ids, test text, typos, "submitted" wording, the list-vs-banner copy mismatch from `.planning/uat/2026-09-26-browser-pass.md`. Do not pull copy items into 170. (The 169-routed LABEL items (a)-(d) are 170's by the ROADMAP and stay in scope.)
- The 400%-zoom / 320 px WCAG 1.4.10 reflow check.
</user_constraints>

## Project Constraints (from CLAUDE.md / AGENTS.md / memory)

- **AGENTS.md:** this Next.js (16.2.11) has breaking changes; read `node_modules/next/dist/docs/` before claiming API behaviour. [VERIFIED: main checkout node_modules `next/package.json` = 16.2.11]
- **DESIGN.md is binding** for every visual change; flag deviations; no new colours outside the palette. Record any palette/usage decision in the DESIGN.md Decisions Log.
- **Repo is PUBLIC and `.planning/` is tracked:** no home paths, usernames, production names, emails or ids in plans or test fixtures. Run `check-planning-hygiene` after any agent writes `.planning/`.
- **Tests must be able to fail** (neuter → observe RED → restore) for user-facing gates.
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry + VERSION bump (4-digit, VERSION and package.json byte-equal; never `npm version`).
- **Never write the CI skip token** in a commit message or PR body, not even to deny it.
- **Min width = 390 px + desktop 200% zoom, not 320 px** (founder 2026-09-27); the orchestrator runs visual checks in the logged-in Chrome.
- **No database / migration work** in this phase (see "Database" below). Merging `supabase/migrations/**` auto-applies to PROD; nothing here touches it.
- **Same-wave plans must be file-disjoint;** worktrees are used (`use_worktrees: true`). The worktree has no `node_modules` (see Environment).
- **gsd-tools state handlers clobber STATE.md/ROADMAP.md:** diff after any handler.

<phase_requirements>
## Phase Requirements

Requirement ids are phase-local ("TBD"). The planner should use these ids.

| ID | Description | Premise at HEAD | Research Support |
|----|-------------|-----------------|------------------|
| SC1-LAYERS | Factsheet / Allocations panels no longer stack as near-identical layers | Unmeasurable from code; design decision | §Item C1 — route through a UI-SPEC / checkpoint |
| SC1-PRIVLINK | Private-link control secondary, never overlaps content | HOLDS (`/strategies` row) | §Item R1 |
| SC2-HEADER | `/security` + legal show signed-in header | HOLDS | §Item H1 |
| SC2-TWEAKS | Floating Tweaks never covers bottom nav | HOLDS | §Item A2 |
| SC2-COMPARE | `/compare` does not point to non-existent controls | HOLDS | §Item H2 |
| SC2-MATCH | `/admin/match` mobile read-only in fact | HOLDS | §Item M3 |
| SC2-NOSCROLL | No horizontal page scroll at 390 px / 200% zoom | Offenders (a)(d) HOLD; (b)(c)(e) likely contained scroll, unverified | §Items A1, S1, F1-F3, P1 |
| SC2-(a) | AllocationsTabs tab bar 682 px | HOLDS, probe-confirmed | §Item A1 |
| SC2-(b) | Stress/Streaks/Metrics sub-tabs overflow | LIKELY NOT a page overflow `[ASSUMED]` | §Item F2 |
| SC2-(c) | HeatmapPanels chart container 770 px | LIKELY NOT a page overflow (by design, inside scroll region) `[ASSUMED]` | §Item F2 |
| SC2-(d) | Scenario member rows 573 px | HOLDS | §Item S1 |
| SC2-(e) | Drawdown table + one other table | Drawdown table is inside `ResponsiveTable`; "other table" unidentified | §Item F3 |
| SC2-PROFILE | `/profile` tab row + key-card Disconnect unreachable | HOLDS | §Items P1, P2 |
| R169-(a) | "Month-to-date" on ended record → record's last month | HOLDS; file rewritten by 169-05 first | §Item F4 |
| R169-(b) | Venue label on CSV-ingested strategies (QA D12) | SITE UNKNOWN (QA text unrecoverable) | §Item V1 |
| R169-(c) | `/admin` "by <display_name> · Synced" disambiguation, no short id | HOLDS | §Item M1 |
| R169-(d) | Intro-requests "N in progress" relabel (QA I5) | HOLDS | §Item M2 |
| R0926-PRIVLINK | `/strategies` "Get private link" overlaps name at narrow width | HOLDS | §Item R1 |
| R0926-TWEAKS | Tweaks overlaps bottom nav | HOLDS | §Item A2 |
| CHIP | Grey chip 4.34:1 → ≥4.5:1 | HOLDS, computed | §Item K1 |
| (f) | ScenarioFooter overlaps "Distribution of daily returns" heading | HOLDS (mechanism `[ASSUMED]`) | §Item S2 |
| (g) | "Commit scenario" pushed off-screen | HOLDS | §Item S2 |
| (h) | "No changes yet" rendered twice | HOLDS | §Item S2 |
| (j) | Scenario KPI tiles break numbers / truncate labels | HOLDS; file rewritten by 169-04 first | §Item F1 |
| (k) | Sticky "# / STRATEGY" header overlaps Sort controls | Route label wrong ("/strategies" has no table); mechanism `[ASSUMED]` | §Item T1 |
| (l) | Names/tags break mid-word at hyphen | HOLDS on `/strategies` row | §Item R1 |
| SC3 | Orchestrator post-deploy re-check at 390 px + 200% | n/a | §Validation Architecture |
</phase_requirements>

## Summary

This is a UI-only layout phase: no database, no migration, no new package. Every in-scope item except two maps to one owning component at HEAD, and most share one root cause. A flex item with the default `min-width: auto` cannot shrink below its content, and that content is fixed-width, `shrink-0` or `nowrap`. The pattern shows up in the AllocationsTabs action row, the scenario constituent rows, the ScenarioFooter, the `/strategies` card row, the profile key card and the shared underline `TabsList`. The fix at each site is local: let the item shrink (`min-w-0`), let it wrap (`flex-wrap`, or stack below `sm`), or move it into an explicit contained scroll region (the repo's `ResponsiveTable` idiom).

**The most important finding: the repo's existing reflow gate cannot catch any of these defects on a dashboard route.** `e2e/helpers/reflow.ts` measures `document.documentElement.scrollWidth`. Every `(dashboard)` page renders inside `<main id="main-content" class="flex-1 … overflow-y-auto">` (`src/components/layout/DashboardChrome.tsx:225`, and `:159` for full-bleed), and `overflow-y: auto` makes `main` the horizontal scroller as well. So any overflow is absorbed by `main` and the document never overflows. A headless-Chromium probe of the exact AllocationsTabs structure printed `docOverflow: 0, mainOverflow: 395`. That is why the seeded 320 px `reflow-sweep-authed.spec.ts` stays green while PROD shows a 682 px tab bar. Wave 0 must fix the helper to measure the `#main-content` scroller. Until then, any re-run of the existing sweep proves nothing.

The second structural fact concerns widths. Desktop 200% zoom on a 1280 px display is 640 CSS px, and on a 1440 px display it is 720. Both are below Tailwind `md` (768), so "200% zoom" normally renders the MOBILE shell: bottom nav, top bar, no sidebar. Only a 1920 px display (960 CSS px) gets the sidebar layout. Automated checks and the orchestrator's criterion-3 pass should therefore run at **390, 640 and 960** CSS px. Two items need a human decision before a plan, not code research. Criterion 1's "near-identical stacked layers" is a design judgment with no evidence text in the repo; the ui safety gate is on. QA D12's "venue label" cannot be located, because the QA sweep report is untracked and was not found.

**Primary recommendation:** Wave 0 fixes the reflow helper (it measures the `main` scroller and skips contained scroll regions), adds 390/640/960 viewports and a composed-scenario route, and wires them through FLOW-01. Then run file-disjoint fix plans per the topic table. Plans that touch `FactsheetView.tsx`, `MetricsColumn.tsx` or `DESIGN.md` wait until Phase 169 is on `origin/main`. Criterion 1's layering decision and the D12 site go to a founder checkpoint.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Horizontal overflow containment (tabs, rows, tables) | Browser / Client (CSS in components) | — | Pure layout; no data change |
| Sticky / fixed stacking (footer, Tweaks, table header) | Browser / Client | — | z-index / offsets vs the app-shell `MobileNav` / `MobileTopBar` |
| Grey chip contrast | Browser / Client (class choice) | CDN/Static (`globals.css` tokens, unchanged) | Change the class pairing at 4 sites, not the global tokens |
| Signed-in marketing header | Frontend Server (SSR layout reads session cookie) | — | Session is read server-side via `createClient()`; opts routes into dynamic rendering |
| `/admin/match` mobile read-only | Browser / Client (UI withholds writes) | API / Backend (admin auth, unchanged) | Viewport is not a trust boundary; server already enforces admin identity |
| `/admin` owner disambiguation | Frontend Server (select `email`/`company`) | Database (RLS read, unchanged) | Extra columns on an existing admin-only select |
| "Month-to-date" relabel | Browser / Client (label from existing `m.end`) | — | No number changes |

## Standard Stack

No new libraries. Everything uses what is installed.

### Core (in use, versions from the main checkout's node_modules)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.11 | App Router, server layouts | Project framework [VERIFIED: node_modules/next/package.json] |
| tailwindcss | 4.3.2 | Utilities incl. `@container` variants, `min-w-0`, `isolate` | Project styling [VERIFIED: node_modules/tailwindcss/package.json] |
| vitest | 4.1.10 | jsdom unit/RTL tests | Project unit runner [VERIFIED] |
| @playwright/test | 1.61.1 | Real-layout e2e at fixed viewports | Only tool that measures geometry [VERIFIED] |
| @axe-core/playwright | ^4.12.1 | `color-contrast` gate (the 164.9.4 finding) | Already wired via `e2e/helpers/axe.ts` [VERIFIED: package.json:55] |

### Existing in-repo primitives to reuse (do not re-create)
| Primitive | Path | Use |
|-----------|------|-----|
| `ResponsiveTable` | `src/components/ResponsiveTable.tsx` | Focusable, labelled `overflow-x-auto` region (satisfies axe `scrollable-region-focusable`) |
| NAV-02 tab strip | `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (`computeTabStripScroll`, tablist classes) | Horizontal scrollable tab strip, `snap-x`, hidden scrollbar, inset focus ring |
| UIFIX-02 inset ring | `focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent` | Focus ring that survives `overflow-x-auto` clipping |
| `KpiPanel` container ladder | `src/components/kpi/KpiPanel.tsx:63` `grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-4` | Precedent for a container-query column ladder |
| Contrast hand-roll | `tests/a11y/palette-contrast.test.ts` | The repo's documented "don't hand-roll, except this helper" luminance trio |
| `useMediaQuery` | `src/hooks/useMediaQuery.ts` | Server snapshot is `false` (see Pitfall 5) |

**Installation:** none.

## Package Legitimacy Audit

This phase installs no external packages. **Packages removed due to [SLOP]:** none. **Packages flagged [SUS]:** none.

## Database

**No `supabase/migrations/**` change is needed for any item.** [VERIFIED: every item traced to a component or an existing select]. The only data-shape change is item M1, which adds `email` (and optionally `company`) to an existing PostgREST embed in `src/app/(dashboard)/admin/page.tsx:37` (`profiles!strategies_user_id_fkey(display_name)`). The same page already selects `email` from `profiles` for pending profiles (`:45` `.select("id, display_name, company, email, role, allocator_status, created_at")`), so an admin session can already read it under current RLS. No policy change. [VERIFIED: src/app/(dashboard)/admin/page.tsx:37,45]

## The Structural Finding — the reflow gate is blind on every dashboard route

**Code facts.**
- `src/components/layout/DashboardChrome.tsx:225`: `className="flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0"` on `<main id="main-content">` (the full-bleed branch at `:159`: `className="flex-1 overflow-y-auto pb-16 md:pb-0"`). [VERIFIED]
- `src/app/layout.tsx`: `<html … h-full>` / `<body className="h-full …">`, so `main` is height-bounded and is the scroll container. [VERIFIED: src/app/layout.tsx:79,90]
- `e2e/helpers/reflow.ts:67-69`: `const doc = document.documentElement;` … `const slop = doc.scrollWidth - doc.clientWidth;`. It measures the DOCUMENT only. [VERIFIED]

**Probe (positive falsification).** A static HTML fixture copies the dashboard shell and the AllocationsTabs action row as plain CSS (`.shell{display:flex;height:100%}`, `main{flex:1 1 0%;overflow-y:auto}`, a `flex-wrap` strip, the `margin-left:auto; display:flex` action wrapper, and the `flex-nowrap overflow-x-auto` tablist with six `flex-shrink:0` 90 px tabs plus the Export and "+ Allocation" buttons). It ran in headless Chromium through the repo's Playwright 1.61.1 at a 390×800 viewport. "FIX" adds `min-width:0;max-width:100%` on the action wrapper and `min-width:0` on the tablist. Output, verbatim:

```
HEAD  {"docOverflow":0,"mainOverflow":395,"actWidth":769,"tablistClient":560,"tablistScroll":560}
FIX   {"docOverflow":0,"mainOverflow":0,"actWidth":358,"tablistClient":150,"tablistScroll":560}
```

This proves two things. (1) The document never overflows, even while `main` overflows by 395 px, so `assertNoReflow` passes vacuously on dashboard routes. (2) At HEAD the `overflow-x-auto` tablist never scrolls, because its flex parent grows to content width (`tablistClient == tablistScroll`). With `min-w-0` it becomes a real 150 px scroller holding 560 px of tabs. [VERIFIED: probe output above]

**Consequence for planning.** Wave 0 must change `assertNoReflow` to:
1. measure `#main-content` (`scrollWidth - clientWidth`) as well as `documentElement`, and fail when either exceeds 1 px;
2. find offenders relative to `main`'s client box, and **skip any element whose nearest `overflow-x: auto|scroll` ancestor is itself within bounds**. The current walker flags anything whose right edge passes `clientWidth`, including content that is correctly clipped inside a scroll region. That is the likely source of offenders (b), (c) and (e); see §F2/F3.

⚠️ Once the helper is fixed, the existing seeded sweeps will go RED at HEAD. That is the intended failing signal. Land the helper fix in the same branch as the layout fixes, so the phase PR goes green only when both are in.

⚠️ **Scope collision T0 must resolve.** `e2e/reflow-sweep-authed.spec.ts` runs all seven `/allocations` routes plus the wizard and `/security` at `setViewportSize({ width: 320, height: 800 })`. With a `main`-aware helper it will go RED at 320 px, and the founder removed 320 px from scope (2026-09-27). **Recommendation:** raise that spec's viewport to 390 (and add 640/960) rather than make the main-scroller measurement opt-in. Fixing 320-only overflow is work nobody asked for, and an opt-in flag would recreate the blindness. `e2e/reflow-sweep.spec.ts` (public, marketing layout, no inner scroller) is unaffected either way, because the document is the scroller there. No existing e2e spec measures `#main-content` (grep: only `mobile-drawer-keyboard.spec.ts` references it, for skip-link focus and `inert`), so there is no in-repo precedent to reuse.

## Item-by-item findings (owner, root cause, fix)

Every class string below is quoted from the file at HEAD `8eafe1057`. Line numbers are hints; cite by symbol.

### A1 — (a) AllocationsTabs tab bar 682 px  [HOLDS, probe-confirmed]
- **Owner:** `AllocationsTabs` in `src/app/(dashboard)/allocations/AllocationsTabs.tsx`. The strip `data-allocator-tabstrip` has `className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border pb-3"`. The action wrapper at `:812` has `<div className="ml-auto flex items-center gap-1">`. The tablist at `:832` has `className="flex flex-nowrap items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"`. Tabs append `snap-start shrink-0`. [VERIFIED: AllocationsTabs.tsx:789-834,864]
- **Root cause:** the `ml-auto` wrapper is a flex item of a `flex-wrap` strip with default `min-width:auto`, so it sizes to its content: tablist + separator + Export + "+ Allocation". The NAV-02 `overflow-x-auto` on the tablist never engages. [VERIFIED: probe]
- **Fix:** below `sm`, give the tablist its own full-width row and let it scroll. Wrapper: `ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-1 sm:flex-nowrap`. Tablist: add `min-w-0 basis-full sm:basis-auto`. Export and "+ Allocation" get `shrink-0`. Probe of exactly this variant (`.act{min-width:0;max-width:100%;flex-wrap:wrap}`, `.tl{min-width:0;flex-basis:100%}`, buttons `flex-shrink:0`) at 390 px, verbatim: `FIX {"docOverflow":0,"mainOverflow":0,"actWidth":358,"tablistClient":358,"tablistScroll":560}`, so the tablist becomes a full-width 358 px scroller over 560 px of tabs and the page overflow is 0. [VERIFIED: probe output] Keep JOURNEY-03 intact: the tablist stays the same element with the same direct `role="tab"` children, and no role is added to a wrapper. `computeTabStripScroll` needs no change. Everything stays within DESIGN.md: no new tokens.
- **Tests at HEAD:** `AllocationsTabs.tabstrip-scroll.test.ts` pins only the scroll math. `AllocationsTabs.test.tsx` and others do not pin the wrapper class (grep found no test containing `ml-auto flex items-center gap-1`). [VERIFIED: grep]

### A2 — Tweaks toggle overlaps bottom nav  [HOLDS]
- **Owner:** `TweaksToggle`, `src/app/(dashboard)/allocations/components/TweaksToggle.tsx:35-38`, inline style `position: "fixed", bottom: 20, right: 20, zIndex: 49`. Panel `Tweaks.tsx:58-68` `position: "fixed", bottom: 20, right: 20, width: 300, zIndex: 50`. [VERIFIED]
- **Bottom nav:** `MobileNav` `src/components/layout/MobileNav.tsx:67` `className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-surface md:hidden"`. Its cells are `min-h-[44px] py-2` with a 20 px icon over a 10 px label, about 54 px tall. `main` reserves `pb-16` (64 px). [VERIFIED: MobileNav.tsx:67,101,121; DashboardChrome.tsx:225]
- **Root cause:** a fixed 20 px bottom offset sits inside the ~54 px nav band at `<md`, and z-49 paints over nav z-30.
- **Fix:** move positioning to classes so the offset can be responsive: `fixed right-5 bottom-20 md:bottom-5` (80 px clears the nav's ~54 px plus a gap, and matches `main`'s `pb-16` rhythm). Apply the same offset to the `Tweaks` panel. Keep the z-index. `Tweaks.test.tsx` references `data-tweaks-toggle`; check it before editing.
- **Co-defect to measure `[ASSUMED]`:** at `≥md` the chip at `bottom:20 right:20` sits over the `ScenarioFooter` right end, where "Commit scenario" renders (footer: sticky bottom 0, 56 px tall). The same fix does not clear it at `md+`. Measure at 960 and 1280 in the Wave-0 spec. If confirmed, raise the chip on the scenario tab or give the footer right padding.

### S1 — (d) Scenario constituent rows 573 px  [HOLDS]
- **Owner:** the constituent list in `ScenarioComposer` (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`), `data-testid="scenario-constituent-list"`. Per-key rows (`scenario-constituent-perkey`, around `:7314`) and added rows (`scenario-constituent-added`, around `:7590`) use `<div className="flex w-full items-center justify-between gap-3">`. The control cluster is `className="flex items-center gap-2"` (`:7359`; the added-row cluster also carries `onClick={(e) => e.stopPropagation()}`). It holds a weight input `w-20`, a content-sized mode toggle, an optional `w-16` target input, a leverage input `w-16`, and the notional span `w-20` (`renderNotional`). Added rows also have a dollar input and a remove button. Two `aria-hidden` header strips (`scenario-perkey-header` around `:7255`, `scenario-added-header` around `:7447`) mirror the cluster widths so the column labels line up. Their comment calls out that alignment contract ("Pitfall 3"). [VERIFIED: ScenarioComposer.tsx:7200-7420, 7440-7450, 7590-7780]
- **Root cause:** a nowrap cluster of fixed-width inputs has a min-content of ~350-450 px, the row does not wrap, and the name group (`min-w-0`) collapses first.
- **Fix (prescriptive):** wrap the `ul` in `ResponsiveTable` (`label="Strategies and weights"`) and give the `ul` `min-w-max` (keep `grid gap-2`, so every `li` stretches to the widest row). The list becomes a labelled, focusable contained scroll region below its natural width, and the page stops overflowing. The header strips stay aligned by construction, since same-width rows in the same grid keep the Pitfall-3 contract without per-row logic. Wrapping below `sm` was rejected: it breaks the header alignment the file protects, and the added rows' cluster (dollar input + remove) does not fit 358 px on one line anyway.
- **Tests at HEAD:** `ScenarioComposer.test.tsx` has deep class and DOM pins, for example `:10585` `expect(chip.className).toContain("bg-track")`. Grep for `scenario-constituent-list`, `scenario-perkey-header` and `scenario-added-header` before editing.

### S2 — (f)(g)(h) ScenarioFooter  [HOLDS; (f) mechanism `[ASSUMED]`]
- **Owner:** `ScenarioFooter`, `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx`. `FOOTER_STYLE` (`:78-90`): `position: "sticky", bottom: 0, height: 56, … display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 10`. Children: the count `<span>` (`countLabel`), the summary `<span className="font-mono text-fixed-13 …">` (`summaryText`), and a `flex items-center gap-3` group with Reset and "Commit scenario". [VERIFIED]
- **(g) root cause:** three nowrap flex children in a fixed row with `space-between`. At 358 px the right group is pushed past the edge. [VERIFIED by reading; widths `[ASSUMED]`]
- **(f) root cause `[ASSUMED]`:** the fixed `height: 56` with overflowing content wraps the summary text. With `alignItems: center` the overflow spills ABOVE the painted 56 px box, whose background does not cover it, so the text overlays the heading above. A second candidate to measure: `main` is the sticky scroll container and `MobileNav` is `fixed bottom-0 z-30`, so at `<md` the z-10 footer may sit partly behind the nav.
- **(h) root cause [VERIFIED]:** at zero diffs both strings are literally `"No changes yet"`: `countLabel = diffCount === 0 ? "No changes yet" : …` (`:110`) and `summaryText = !hasDiffs ? "No changes yet" : …` (`:124`). They render in two fonts (`text-xs font-medium` vs `font-mono text-fixed-13`).
- **Fix:** replace `height: 56` with `minHeight: 56` and allow wrapping (`flexWrap: "wrap"`, `rowGap: 8`, vertical padding). Give the action group `margin-left: auto` and `flex-shrink: 0` so "Commit scenario" stays whole and tappable. Render the summary slot only when `hasDiffs` (at zero diffs the chip alone says it). At `<md` offset the sticky `bottom` above the nav (`bottom: 64px` / `bottom-16 md:bottom-0`) if the Wave-0 measurement confirms the nav overlap. Moving the style object to Tailwind classes is acceptable and makes the responsive offset expressible.
- **Test that fails at HEAD:** `ScenarioFooter.test.tsx` T_F1 asserts `getAllByText(/No changes yet/i).length > 0`, which tolerates the duplicate. The new assertion is `getAllByText(/No changes yet/i)).toHaveLength(1)` at `diffCount=0`. It is RED at HEAD. [VERIFIED: ScenarioFooter.test.tsx:32-50]

### F1 — (j) Scenario KPI tiles break numbers / truncate labels  [HOLDS; ⚠️ file rewritten by 169-04]
- **Owner:** the factsheet `KpiStrip` inside `FactsheetView.tsx` (the scenario tab mounts it via `ScenarioFactsheetChart` → `FactsheetBody`). It is not the allocations `KpiStrip`, whose labels (YTD TWR, Sharpe, Max DD 12m, Avg |ρ|) contain no "Sortino" or "Calmar". The grid at `:1517` is `` `grid grid-cols-3 ${containerCols} @5xl:divide-y-0` ``. The label at `:1525` is `"text-micro font-mono uppercase tracking-[0.14em] sm:tracking-[0.18em] whitespace-nowrap overflow-hidden text-ellipsis"`. The value at `:1543` is `"mt-1.5 sm:mt-2 font-mono tabular-nums text-h2 leading-tight break-words"`. `--text-h2: clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem)`. [VERIFIED: FactsheetView.tsx:1457-1560; globals.css:138]
- **Root cause:** three tracks in a ~300 px container leave ~70 px of content per cell. A signed decimal in `text-h2` mono is wider than that, and `break-words` (overflow-wrap) breaks it mid-number. Labels ellipsize.
- **Fix:** follow the `KpiPanel` container ladder: `grid-cols-2 @md:grid-cols-3 ${containerCols}`. `@md` is a 28 rem (448 px) container [VERIFIED: node_modules/tailwindcss/theme.css:337 `--container-md: 28rem;`, `:336` `--container-sm: 24rem;`], so the 390 px phone and the ~326 px scenario mount get 2 columns and a 640 px zoom gets 3. Keep `break-words` as a last resort (UIFIX-03 forbids clipping values). Values then fit on one line at normal magnitudes. Keep the label clip, which becomes readable at double the width.
- **Tests:** `FactsheetView.kpistrip.test.tsx:125` `expect(kpiGrid!.className).toMatch(/\bgrid-cols-3\b/)` pins the old decision. It needs an intentional pin update with a dated comment. `:154-158` pin `break-words` and the label `whitespace-nowrap`; keep those.
- ⚠️ **Sequencing:** 169-04 `files_modified` includes `src/app/factsheet/[id]/v2/FactsheetView.tsx` (from the 169 plan set at `origin/feat/169-pagetruth`). Plan this against post-169 HEAD.

### F2 — (b) Stress/Streaks/Metrics sub-tabs and (c) HeatmapPanels 770 px  [LIKELY CONTAINED SCROLL — `[ASSUMED]`]
- **(b) owner:** `SectionNav` in `FactsheetView.tsx:1684`: `<nav … className="factsheet-v2-no-print mt-4 -mx-1 overflow-x-auto">` wrapping a `flex` `ul`. It is a block child of the article, so its width is bounded and the `ul` scrolls inside it. [VERIFIED]
- **(c) owner:** `YearCalendarCanvas` in `src/app/factsheet/[id]/v2/HeatmapPanels.tsx:495-496`: `className="flex-1 relative pointer-coarse:min-h-[44px]"` with `style={{ height: h * scale, minWidth: w, … }}`. The 770 px `minWidth` is DELIBERATE (the comment "minWidth = w forces the canvas to render at natural size; the parent … overflow-x-auto on the year stack lets the user pan"). The parent at `:198` is `className="flex flex-col gap-4 -mx-2 px-2 overflow-x-auto …"` with `role="region" tabIndex={0}`. [VERIFIED]
- **Assessment:** both sit inside correctly bounded scroll regions. A right-edge walker (like `assertNoReflow`'s offender loop) reports them even though they are clipped. The PROD offender list was probably produced that way. **Plan no change** for (b) or (c) until the Wave-0 helper, which skips content inside a bounded scroll ancestor, re-measures the composed scenario page at 390 and 640. If the corrected walker still names them, the real cause is an ancestor that is not bounded, not these elements.

### F3 — (e) drawdown table (~389 px) and "one other table" (~378 px)  [PARTLY CONTAINED; other table UNIDENTIFIED]
- The worst-drawdowns table is already wrapped: `MetricsColumn.tsx:529` `<ResponsiveTable label="Worst 10 drawdowns">`. It is contained scroll, the same as F2. [VERIFIED]
- Tables with NO scroll wrapper, where a ~378 px table could overflow: `MetricsColumn.tsx:117, 252, 346, 621`, `BatchDPanels.tsx:48, 183, 327, 347`, `AnalyticalPanels.tsx:279, 365` (all `<table className="w-full …">`). `StressWindowsPanel.tsx:59` and `HeatmapPanels.tsx:65` are wrapped. [VERIFIED: grep]
- **Fix:** after Wave-0 re-measurement names the actual offender, wrap THAT table in `ResponsiveTable`. Do not blanket-wrap, because each wrapper adds a tab stop.
- ⚠️ `MetricsColumn.tsx` is rewritten by 169-05. Sequence after 169.

### F4 — R169-(a) "Month-to-date" on an ended record  [HOLDS; ⚠️ file rewritten by 169-05]
- **Owner:** `MetricsColumn.tsx:90` `<Row label="Month-to-date" value={pct(m.mtd, true)} bench={pct(b?.mtd, true)} />` (Returns panel) and `:418` (CumulativeReturnsPanel). `compute()` derives `mtd` from the series' LAST month: `src/lib/factsheet/compute.ts:176-177,208` (`const mtdCutoff = new Date(\`${lastMonth}-01T00:00:00Z\`)` … `mtd: compoundFrom(mtdCutoff)`). [VERIFIED]
- **Fix:** a pure label function. If the record's last month (`m.end`, already shown as "End Date") is the current calendar month (UTC), keep "Month-to-date". Otherwise label it `"<Mon YYYY> (last month of record)"`, or the equivalent the planner picks, built with the existing `MONTHS` / `formatIsoDate` helpers in `FactsheetView.tsx:2390-2398` or a MetricsColumn-local formatter (DESIGN.md: one formatter module per surface family). Unit-test both branches with a fixed clock. Do NOT change the number. Respect 169-05's locked truth: "Month-to-date, 3 Month and Year-to-date keep the em-dash".
- **Sequencing:** 169-05 edits the same rows. Plan against post-169 HEAD.

### P1 — /profile tab row unreachable  [HOLDS]
- **Owner:** the shared `TabsList` primitive, `src/components/ui/Tabs.tsx:56`, underline variant `"flex gap-1 border-b border-border"`, triggers at `:86` `"-mb-px border-b-2 border-transparent px-4 py-2 text-text-muted"`. It is consumed by `ProfileTabs` (`src/components/auth/ProfileTabs.tsx:101`, six tabs), `AdminTabs` and (segmented variant) `WatchlistTabs`. [VERIFIED]
- **Root cause:** no overflow handling. Six `px-4` triggers exceed 358 px.
- **Fix:** underline variant gets `overflow-x-auto [scrollbar-width:none]` and triggers get `shrink-0 whitespace-nowrap`. **Pitfall:** `overflow-x:auto` forces `overflow-y:auto`. That clips the trigger's `-mb-px` overlap onto the list's bottom border, and clips the outset `focus-visible:ring-2`. Switch the trigger ring to `ring-inset` (UIFIX-02), and draw the hairline as an inset shadow or a pseudo-element if the 1 px overlap is lost. `Tabs.test.tsx` pins `"flex gap-1 border-b border-border"`, so update that pin intentionally. `AdminTabs` inherits the fix, which is desirable on `/admin` at 390.

### P2 — /profile key card "Disconnect" ~420 px from left  [HOLDS]
- **Owner:** `AllocatorExchangeManager` `src/components/exchanges/AllocatorExchangeManager.tsx:909` `"divide-y divide-border border border-border rounded-lg overflow-hidden"` containing rows at `:919` `className="flex items-center gap-4 bg-surface px-4 py-3"`. Each row holds the avatar, a `flex-1 min-w-0` label, a "Last sync" block, `AllocatorSyncStatus`, "Sync now", an optional "Update password" and "Disconnect". [VERIFIED]
- **Root cause:** a nowrap row inside `overflow-hidden`, so it is CLIPPED rather than scrollable (matches "clipped, not scrollable").
- **Fix:** row `flex flex-wrap items-center gap-4` with the three buttons in a `flex flex-wrap gap-2 basis-full sm:basis-auto sm:ml-auto` group, so the actions drop to their own line below `sm`. The disconnected-keys card at `:1010` has the same container and should get the same treatment.

### R1 — /strategies row: "Get private link" overlaps name; (l) hyphen breaks  [HOLDS]
- **Owner:** `src/app/(dashboard)/strategies/page.tsx` (My Strategies card list). Row `:773` `<div className="flex items-center justify-between">`, left `flex-1 min-w-0`, tags `:778` `<div className="flex gap-1.5 mt-1">` of `<Badge>`, right group `:789` `<div className="flex items-center gap-3 ml-4">` holding `ShareableLink`, the status `Badge`, `StrategyActions` and the date. `ShareableLink` renders `<Button variant="secondary">` at the default size `md` (`min-h-[44px] px-4 py-2.5 text-body`, `src/components/ui/Button.tsx:17`) with an icon and "Get private link". [VERIFIED: page.tsx:773-812; ShareableLink.tsx:108,178-221; Button.tsx:15-18]
- **Root cause:** a nowrap row whose right group has a large min-content, so the `min-w-0` name column collapses to ~2 characters. The tags row is nowrap, so each `Badge` shrinks and wraps internally at the hyphen in a "Long-/Short" style label, which is (l).
- **Fix (also the SC1 "secondary" clause):** the row stacks below `sm` (`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`), the right group gets `flex flex-wrap items-center gap-3 sm:ml-4 sm:shrink-0`, the tags row gets `flex flex-wrap`, and each tag gets `whitespace-nowrap` at the call site (`<Badge className="whitespace-nowrap" …>`, not a global `Badge.tsx` change). Render `ShareableLink` at `size="sm"` on this list. That needs a `size` passthrough prop, since `ShareableLink` does not accept one today. The discovery detail page (`primary`) stays as is.
- **Tests:** `page.share-affordance.test.tsx` and `page.key-pill.test.tsx` exist. Grep them for the row structure before editing.

### T1 — (k) sticky "# / STRATEGY" header overlaps Sort controls  [ROUTE LABEL WRONG; mechanism `[ASSUMED]`]
- **Premise correction:** `/strategies` (`strategies/page.tsx`) renders cards and no table. The "# / STRATEGY" sticky header is `StrategyTable` (`src/components/strategy/StrategyTable.tsx:880` `` `sticky left-0 top-0 z-30 w-14 bg-surface …` ``, `:907-909` `"sticky left-[6.25rem] top-0 z-20 …"` / `"sticky top-0 z-20 bg-surface"`), mounted on `/my-strategies`, `/discovery/[slug]` and `/browse/[slug]`. The Sort selects live in `StrategyFilters` (`src/components/strategy/StrategyFilters.tsx:309` `className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-page pb-4"`, selects at `:350-366`). [VERIFIED]
- **Root cause `[ASSUMED]`:** the table sits inside `ResponsiveTable` (`overflow-x-auto`, which is also `overflow-y:auto`), so the `th` `top-0` never sticks vertically. But the `th`s still paint at z-20/z-30. Neither `ResponsiveTable` nor the `relative` table wrapper creates a stacking context, so while the page scrolls the header cells paint OVER the sticky z-10 filter bar. Separately, at `<md`, `MobileTopBar` is `md:hidden sticky top-0 z-20 … h-12` (`src/components/layout/MobileTopBar.tsx:23`), so the z-10 filter bar sticks UNDER the 48 px top bar.
- **Fix:** add `isolate` (Tailwind `isolation: isolate`) to the `data-strategy-table` wrapper so the internal z-20/30 stay local, and set the filter bar to `top-12 md:top-0`. Verify at 390/640 in the Wave-0 spec on `/my-strategies` (seeded).

### K1 — Grey chip contrast 4.34:1  [HOLDS, computed]
- **Sites (exactly four):** `CoverageStateChip.tsx:44` `"manually-excluded": { label: "Excluded", cls: "text-text-muted bg-track" }`, `:53` `"no-series": { label: "No data", cls: "text-text-muted bg-track" }`; `StrategyTable.tsx:1216` and `:1380` `` `${DATA_STATE_CHIP} text-text-muted bg-track` `` ("No data"). `DATA_STATE_CHIP` (`:88-89`) = `"inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide"`. No other `text-text-muted` + `bg-track` pairing exists (the other `bg-track` users are bars and rails with no text). [VERIFIED: grep + reads]
- **Tokens:** `src/app/globals.css:14` `--color-text-secondary: #4A5568;`, `:18` `--color-text-muted: #64748B;`, `:65` `--color-track: #F1F5F9;`, `:5` `--color-page: #F8F9FA;`, `:6` `--color-surface: #FFFFFF;`. [VERIFIED]
- **Computed (WCAG relative luminance, node), verbatim:**
  ```
  muted/track 4.344
  secondary/track 6.869
  muted/surface 4.759
  muted/page 4.515
  muted/surface-subtle 4.633
  ```
- **Fix:** change the TEXT class at the four sites to `text-text-secondary` and keep `bg-track` (6.87:1, still the neutral "muted" tone family: DESIGN.md "Text secondary: #4A5568"). Do NOT change the global `--color-text-muted` or `--color-track`. `text-muted` on `bg-page` is already only 4.515 (the inactive tab-count badge `bg-page … text-text-muted` in `AllocationsTabs.tsx` depends on it), and a global shift ripples app-wide. Add a DESIGN.md Decisions Log row. ⚠️ DESIGN.md is in 169-10's `files_modified`, so sequence that edit after 169.
- **Pins to update:** `CoverageStateChip.test.tsx:36,67` (`toContain("text-text-muted")`); `bg-track` pins at `CoverageStateChip.test.tsx:37,68`, `StrategyTable.pending-chip.test.tsx:380,412,618` and `ScenarioComposer.test.tsx:10585` stay valid.

### H1 — /security and legal pages: signed-in header  [HOLDS]
- **Owner:** `src/app/(marketing)/layout.tsx` (the shared masthead for `/`, `/legal/*`, `/for-quants`, `/security`, `/demo`). The header at `:31` always renders "Sign in" (`/login`) and "Sign up" (`/signup`) links. It is a sync server component with no session read. [VERIFIED]
- **Session plumbing already exists:** `src/proxy.ts` refreshes the session on every matched path and bounce-exempts `/security`, `/legal` and `/demo` for authed users (`isSecurityRoute`, `isLegalRoute`, `isAuthBounceExempt`). The landing page already does `createClient()` + `supabase.auth.getUser()` (`(marketing)/page.tsx:35-41`). [VERIFIED]
- **Fix:** extract the right-hand actions into an async server component (`MarketingHeaderActions`) that calls `createClient()` + `auth.getUser()`. When signed in it renders one link into the app (the dashboard default route) in place of Sign in / Sign up, styled with the existing masthead link classes. Otherwise it renders today's two links.
- **Consequence [CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:69]:** "`cookies` is a Request-time API … Using it in a layout or page will opt a route into dynamic rendering." Reading the session in the group layout makes `/security`, `/legal/*` and `/demo` dynamic (the landing page and `/for-quants` already are: `for-quants/page.tsx` notes `force-dynamic`). `cacheComponents` is not enabled in `next.config.ts` [VERIFIED: grep], so there is no PPR shell to keep the static parts cached. Accept this. The alternative, a client-side session check, flashes the wrong header on first paint and reintroduces a client session dependency that `/demo`'s layout comment explicitly avoids.
- **Test:** vitest with `createClient` mocked (both branches), plus an assertion in the seeded `reflow-sweep-authed.spec.ts` `/security` case that the signed-in link is visible.

### H2 — /compare points to "compare checkboxes" that do not exist  [HOLDS]
- **Owner:** `src/app/(dashboard)/compare/page.tsx:56` empty state: "Pick two or more strategies from discovery to see them side by side. Add up to 4 strategies using the compare checkboxes." [VERIFIED]
- **Evidence:** no compare checkbox exists anywhere in `src/` (the checkbox hits in `StrategyFilters.tsx` and `CustomizeDrawer.tsx` are filters and columns). The only entry points to `/compare` are the sidebar link (`Sidebar.tsx:126`, no ids) and the factsheet ControlBar link `href={\`/compare?ids=${payload.strategyId}\`}` (`FactsheetView.tsx:2246`, one id). [VERIFIED: grep]
- **Fix:** rewrite the empty state to name the control that exists: the "Compare" action on a strategy's factsheet. Only that sentence changes. The one-id render state is an open question (Q3). Building a strategy picker is a feature and out of scope.

### M1 — R169-(c) `/admin` Strategy Review "by <display_name> · Synced"  [HOLDS]
- **Owner:** `src/components/admin/AdminTabs.tsx:468-469` `by {profile?.display_name ?? "Unknown"} ·{" "}` / `Synced {formatRecency(analytics?.computed_at ?? null)}`. `PendingStrategyRow.profiles: { display_name: string } | null` (`:77`). Query: `admin/page.tsx:37` `profiles!strategies_user_id_fkey(display_name)`. [VERIFIED]
- **Fix:** extend the embed to `(display_name, company, email)` and the row type to match. Render `by <display_name>` followed by the owner's email in muted text, so two owners with the same display name read differently without a short id. Relabel "Synced" to "Computed", because the value is `computed_at`, the analytics compute time. The email is admin-only PII on an admin-gated page (`admin/page.tsx:18` `isAdminUser` redirect). Test fixtures must use synthetic addresses such as `owner-a@example.test`.

### M2 — R169-(d) intro-requests "N in progress"  [HOLDS]
- **Owner:** `AdminTabs.tsx:217` `<span className="text-accent font-medium">{counts.intro_made} in progress</span>`. The same file's filter label for that status is `"Intro Made"` (`:164`), and the allocator-facing status copy is `"Introduction in progress"` (`RequestIntroButton.tsx:15`). [VERIFIED]
- **Fix:** relabel the count to match the filter it counts (for example `"{n} intro made"` / `"{n} introduced"`), so the summary and the filter use one vocabulary. Same file as M1, so the same plan.

### M3 — `/admin/match` mobile read-only in fact  [HOLDS]
- **Owner:** `AllocatorMatchQueue` `src/components/admin/AllocatorMatchQueue.tsx`. The banner at `:460-468` renders under `!forceReadOnly` with `md:hidden`: "Read-only on mobile. Open on a desktop or tablet (1024px+) …". `const isLg = useMediaQuery("(min-width: 1024px)")` (`:174`) gates only the keyboard shortcuts and auto-select. `const guard = useCallback(… if (forceReadOnly) return; …)` (`:329-331`) does not consider the viewport. "Recompute now", "Edit preferences", `ShortlistCard` `onSendIntro={guard(…)}` and the detail-pane decision buttons all stay active below `md`. The component comment at `:172-173` states it: "below md (768): read-only banner rendered above the list; the action buttons still exist but a visible warning discourages use." [VERIFIED]
- **Fix:** pick ONE breakpoint and make the banner, the CSS and the handler guard agree. Recommendation: `md` (768), the breakpoint the banner already uses. (a) `const isMd = useMediaQuery("(min-width: 768px)")`, `readOnly = forceReadOnly || !isMd` feeding `guard` and every `readOnly` prop (`ShortlistCard readOnly`, the detail pane); (b) hide the write controls with CSS (`hidden md:inline-flex`), so there is no flash of enabled buttons (see Pitfall 5); (c) correct the banner's "(1024px+)" to agree with the chosen breakpoint (a label, so in scope). The server stays as is. Observed: all seven `/api/admin/match/*` route files, plus `preferences/[allocator_id]/route.ts` (import at `:4`), reference `isAdminUser`/admin helpers [VERIFIED: grep -l]. Per-handler enforcement was NOT read this session [ASSUMED], so the security reviewer should confirm each exported handler calls it before any write.

### V1 — R169-(b) venue label on CSV-ingested strategies (QA D12)  [SITE UNKNOWN]
- The 2026-09-25 QA sweep report is untracked. It was not found in the repo, in `.gstack/qa-reports/` (newest 2026-08-28), or in the gstack project dirs. The 169 CONTEXT (D-06) also records "The QA sweep report is untracked and its text is not available". Candidate sites for a venue label that could be wrong on a CSV strategy: the factsheet header chip line (`FactsheetView.tsx` `FactsheetHeader`, `payload.supportedExchanges.join(", ")`), `StrategyTable` venue/exchange cells, and `HoldingsTable.tsx`/`OpenPositionsTable.tsx` `venueLabel()`. `[ASSUMED]`
- **Recommendation:** a `checkpoint:human-verify` in which the founder names the page and the label, followed by a small label-only task. Do not guess.

### C1 — SC1 "Factsheet and Allocations panels no longer stack as near-identical layers"  [DESIGN DECISION]
- No evidence text exists in the repo beyond the ROADMAP sentence ("too many similar layers stacked", founder notes 2026-09-24). Concrete candidates found at HEAD `[ASSUMED]`:
  1. `/allocations?tab=scenario`: the allocations `KpiStrip mode="scenario"` (4 rounded cards via `KpiPanel`, `ScenarioComposer.tsx:5432`) sits directly above the factsheet `KpiStrip` (a 9/7-cell square data panel) inside `ScenarioFactsheetChart`. That is two KPI strips back to back, and both show Sharpe and Max DD.
  2. `/allocations` Overview: `AllocationDashboardV2` mounts the whole `FactsheetBody` (KpiStrip → SectionNav → ControlBar → panels) under the tab header (`AllocationDashboardV2.tsx:205-211`).
  3. The owner factsheet: `OwnerUnpublishedNotice` (bordered `bg-surface-subtle` box) → masthead → KPI strip → SectionNav → ControlBar, a run of similar hairline bands.
- **Recommendation:** the ui safety gate is on (`workflow.ui_phase: true`, `ui_safety_gate: true`). Phase 169 skipped the UI gate because it changed no layout; 170 does change layout. Route C1 through `/gsd-ui-phase` (UI-SPEC) or a founder checkpoint that picks which layer goes, before any plan edits `ScenarioComposer.tsx` / `AllocationDashboardV2.tsx` for it. Do not invent the design. If the answer touches `ScenarioComposer.tsx`, sequence it after S1/S2.

## Topic grouping (file-disjoint plans)

| Topic | Items | Files touched | Wave constraint |
|-------|-------|---------------|-----------------|
| T0 Harness | Structural finding; SC3 automation | `e2e/helpers/reflow.ts`, `e2e/reflow-sweep-authed.spec.ts`, new `e2e/layout-narrow.spec.ts` (composed scenario, `/my-strategies`, `/profile?tab=exchanges`, `/admin/match` needs an admin seed), `.github/workflows/ci.yml` (FLOW-01 place 1, seeded list) | Wave 0. Its RED is the proof for every other topic; lands in the same PR |
| T-A Allocations shell | A1, A2 | `AllocationsTabs.tsx`, `components/TweaksToggle.tsx`, `components/Tweaks.tsx` (+ tests) | Parallel |
| T-S Scenario composer | S1, S2 (f)(g)(h) | `components/ScenarioComposer.tsx`, `components/ScenarioFooter.tsx` (+ `ScenarioFooter.test.tsx`, `ScenarioComposer.test.tsx`) | Parallel. C1, if it touches the composer, runs after |
| T-P Tabs + key card | P1, P2 | `src/components/ui/Tabs.tsx`, `src/components/exchanges/AllocatorExchangeManager.tsx` (+ `Tabs.test.tsx`) | Parallel |
| T-R /strategies row | R1, (l), SC1-PRIVLINK | `src/app/(dashboard)/strategies/page.tsx`, `src/components/strategy/ShareableLink.tsx` (size prop) | Parallel |
| T-K StrategyTable family + chip | T1 (k), K1 | `StrategyTable.tsx`, `StrategyFilters.tsx`, `CoverageStateChip.tsx`, new `tests/a11y/chip-contrast.test.ts` (+ chip test pins) | Parallel. The DESIGN.md row is deferred to T-F (post-169) or a later ship plan |
| T-M Admin | M1, M2, M3 | `src/components/admin/AdminTabs.tsx`, `src/app/(dashboard)/admin/page.tsx`, `src/components/admin/AllocatorMatchQueue.tsx` | Parallel. (AdminTabs consumes `Tabs.tsx` but does not edit it) |
| T-H Marketing + compare | H1, H2 | `src/app/(marketing)/layout.tsx` (+ new header-actions component), `src/app/(dashboard)/compare/page.tsx` | Parallel |
| T-F Factsheet (post-169) | F1 (j), F4 (MTD), F3 fix once identified, K1's DESIGN.md row | `FactsheetView.tsx`, `FactsheetView.kpistrip.test.tsx`, `MetricsColumn.tsx`, possibly `BatchDPanels.tsx`/`AnalyticalPanels.tsx`, `DESIGN.md` | **Blocked until Phase 169 (169-04, 169-05, 169-10) is on origin/main.** Re-read the files at HEAD before planning |
| Checkpoints | C1 (layers), V1 (D12 site) | none until decided | Founder checkpoint / UI-SPEC before any plan |
| Ship + SC3 | CHANGELOG/VERSION; orchestrator post-deploy pass | `CHANGELOG.md`, `VERSION`, `package.json` | Last |

Shared-file notes: `ScenarioComposer.tsx` (T-S, possibly C1), `FactsheetView.tsx` (T-F; also 169-04), `MetricsColumn.tsx` (T-F; also 169-05) and `DESIGN.md` (T-F; also 169-10) are the sequencing forces. `ci.yml` is touched only by T0.

## Architecture Patterns

### System Architecture Diagram

```
viewport (390 / 640 / 960 CSS px)
   │
   ▼
<html h-full> → <body h-full> → DashboardChrome  ─┬─ MobileTopBar (sticky top-0 z-20, <md)
                                                   ├─ <main#main-content overflow-y-auto>  ◄── THE horizontal scroller
                                                   │     └─ page content
                                                   │          ├─ flex rows (min-width:auto) ──► overflow leaks into main
                                                   │          ├─ ResponsiveTable / overflow-x-auto regions ──► contained (OK)
                                                   │          └─ sticky bars (ScenarioFooter bottom-0 z-10, StrategyFilters top-0 z-10)
                                                   ├─ MobileNav (fixed bottom-0 z-30, <md)
                                                   └─ TweaksToggle (fixed bottom:20 right:20 z-49, /allocations only)
(marketing) group: MarketingLayout header (no inner scroller → document measures correctly)
```

### Pattern 1: Shrinkable flex item
**What:** give any flex item that holds a scroller or truncating text `min-w-0` (and `max-w-full` if it is `ml-auto`). Otherwise `overflow-x-auto` and `truncate` never engage.
**When:** every nowrap row in this phase.

### Pattern 2: Contained scroll region, not page scroll
**What:** fixed-anatomy content (tables, input clusters, calendars) goes inside `ResponsiveTable` (focusable `role="region"`, labelled, `overflow-x-auto`, inset focus ring).
**When:** content whose columns must stay aligned (S1, F3).

### Pattern 3: Responsive fixed/sticky offsets clear the app shell
**What:** at `<md` the shell owns the top 48 px (`MobileTopBar h-12`) and the bottom ~54 px (`MobileNav`, `main pb-16`). Floating and sticky elements offset by those: `top-12 md:top-0`, `bottom-20 md:bottom-5`, `bottom-16 md:bottom-0`.

### Anti-Patterns to Avoid
- **Measuring `documentElement` on a dashboard route:** always vacuous (probe above).
- **Blanket `overflow-x-hidden` on `main` or a page wrapper:** it hides the defect and makes the clipped primary action unreachable, which fails criterion 3's "no clipped primary action".
- **Global token shifts for a local contrast defect:** the four chip sites change class. `--color-text-muted` stays.
- **Re-nesting the AllocationsTabs tablist:** reintroduces the critical axe `aria-required-children` violation (JOURNEY-03 comment in `AllocationsTabs.tsx`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scrollable table / cluster region | New wrapper div with ad-hoc a11y | `ResponsiveTable` | Already satisfies axe `scrollable-region-focusable` and the SR hint |
| Scrollable tab strip | New strip component | NAV-02 classes in `AllocationsTabs.tsx` | Tested scroll math, snap, reduced-motion |
| Contrast math | A new dependency | The luminance trio in `tests/a11y/palette-contrast.test.ts` | The repo's documented exception to "don't hand-roll" |
| Viewport detection for read-only | Window-width reads in effects | `useMediaQuery` + CSS `hidden md:*` | SSR-safe store; CSS avoids the hydration flash |

## Common Pitfalls

### Pitfall 1: The reflow gate passes vacuously on dashboard routes
**What goes wrong:** `assertNoReflow` reports no overflow while `main` scrolls horizontally.
**Why:** `main` is the scroller (`overflow-y-auto` ⇒ `overflow-x:auto`).
**How to avoid:** measure `#main-content` (T0).
**Warning signs:** a green 390 px sweep on a page the browser shows overflowing.

### Pitfall 2: A right-edge walker names contained content
**What goes wrong:** elements inside a bounded `overflow-x-auto` region are reported as offenders ((b)(c)(e)).
**How to avoid:** skip elements whose nearest horizontal scroll ancestor fits the scroller.

### Pitfall 3: `overflow-x-auto` clips borders and rings
**What goes wrong:** the underline tab `-mb-px` overlap and outset `ring-2` focus rings disappear once `TabsList` scrolls.
**How to avoid:** `ring-inset` (UIFIX-02); draw the hairline inside the scroll box.

### Pitfall 4: 200% zoom is not a desktop layout
**What goes wrong:** a check run at 1280 px with CSS `zoom` or at 1280 CSS px misses the mobile shell. 200% zoom on a 1280/1440 display is 640/720 CSS px, below `md`.
**How to avoid:** test at 390, 640 and 960 CSS px viewports.

### Pitfall 5: `useMediaQuery` returns `false` on the server
**What goes wrong:** `getServerSnapshot` returns `false` (`src/hooks/useMediaQuery.ts`), so on desktop `readOnly = !isMd` is `true` for the first paint, and write controls flash hidden (or, inverted, flash enabled on mobile).
**How to avoid:** hide via CSS breakpoint classes. Use the JS value only as the handler guard.

### Pitfall 6: Tests that tolerate the defect
`ScenarioFooter.test.tsx` T_F1 (`length > 0`) passes with the duplicate. `FactsheetView.kpistrip.test.tsx` pins `grid-cols-3`, the old decision. Update these intentionally with dated comments, and add assertions that fail at HEAD.

### Pitfall 7: Phase-169 collisions
`FactsheetView.tsx`, `MetricsColumn.tsx` and `DESIGN.md` are in 169's `files_modified`. Planning T-F against pre-169 HEAD produces stale anchors (the `plan-anchor-verify` CI job will red).

## Code Examples

### Reflow helper: measure the dashboard scroller (T0 sketch)
```typescript
// e2e/helpers/reflow.ts — inside page.evaluate
const doc = document.documentElement;
const main = document.getElementById("main-content");
const scroller = main ?? doc;
const slop = Math.max(doc.scrollWidth - doc.clientWidth,
                      main ? main.scrollWidth - main.clientWidth : 0);
// offender walk: skip el if an ancestor with computed overflow-x auto|scroll
// (other than `scroller`) has scrollWidth > clientWidth AND fits inside scroller.
```

### Chip contrast unit test (K1) that reads the tokens
```typescript
// tests/a11y/chip-contrast.test.ts — luminance trio copied from palette-contrast.test.ts
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const tok = (n: string) => css.match(new RegExp(`--color-${n}:\\s*(#[0-9A-Fa-f]{6})`))![1];
// also read the class pair from CoverageStateChip.tsx / StrategyTable.tsx so a revert to
// text-text-muted fails: text-muted on track = 4.344 < 4.5 (RED at HEAD).
expect(getContrastRatio(tok("text-secondary"), tok("track"))).toBeGreaterThanOrEqual(4.5);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 320 px / 400% zoom reflow floor | 390 px + desktop 200% zoom | Founder 2026-09-27 | Test at 390 / 640 / 960 |
| `grid-cols-3` KPI fallback (Phase 52-06) | Container ladder like `KpiPanel` | This phase | Update `kpistrip` test pin |

**Deprecated/outdated:** the phase-46 statement that the authed reflow sweep "proves" dashboard reflow. It measured the document, not `main`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | (b) SectionNav and (c) DailyReturnsHeatmap are contained scroll, not page overflow | F2 | A real offender goes unfixed. Mitigated by T0 re-measure |
| A2 | The "one other table ~378 px" is one of the unwrapped factsheet tables | F3 | Fix lands on the wrong table. Mitigated by re-measure first |
| A3 | (f) is fixed-height content spill and/or the footer behind MobileNav | S2 | Fix misses (f). Verify in T0 spec with a heading-overlap assertion |
| A4 | (k) is a z-index inversion plus MobileTopBar cover, on StrategyTable surfaces (not `/strategies`) | T1 | Wrong fix. Verify on `/my-strategies` at 390/640 |
| A5 | Tweaks overlaps "Commit scenario" at `≥md` | A2 | Unfixed overlap on desktop. Measure at 960/1280 |
| A6 | C1's "near-identical layers" means the doubled KPI strips (scenario) / nested factsheet (Overview) | C1 | Wrong design change. Founder checkpoint |
| A7 | D12 candidate sites (factsheet exchanges chip, StrategyTable, Holdings `venueLabel`) | V1 | Wrong label changed. Founder checkpoint |
| A8 | `md` (768) is the right single breakpoint for `/admin/match` read-only | M3 | Tablet admins lose writes (768-1023). Founder may prefer `lg` |
| A9 | Showing the owner email on `/admin` Strategy Review is acceptable disambiguation | M1 | Founder may prefer company. Both are no-migration |
| A10 | Making `/security`, `/legal/*`, `/demo` dynamic is acceptable | H1 | Small TTFB cost on marketing pages |

## Open Questions

1. **Phase 169 is not on origin/main** (`22275a673` on `origin/feat/169-pagetruth` is not an ancestor of HEAD). Recommendation: plan T-F only after 169 merges, and re-read `FactsheetView.tsx` / `MetricsColumn.tsx` / `DESIGN.md` then. Every other topic is independent of 169.
2. **C1 layering:** which layer goes, per page? Recommendation: `/gsd-ui-phase 170` or a founder checkpoint before planning C1.
3. **`/compare` with one id:** what renders when the factsheet link seeds a single strategy, and does it offer a path to a second? Recommendation: read `compare/page.tsx`'s results branch during planning. If there is no path, the empty-state copy should say so honestly.
4. **D12 site:** founder to point at the page and label.
5. **Existing 320 px sweep vs the corrected helper:** `reflow-sweep-authed.spec.ts` goes RED at 320 once the helper measures `main`. Recommendation: raise it to 390/640/960 (see §Structural Finding). This is a scope call on an existing spec, so the planner should note it in the plan's decisions.
6. **Seeding for T0:** a seeded allocator has no book. `e2e/composer-axe.spec.ts` shows how to drive the composer into composed mode (`seedStrategyWithHistory` + Browse add). `/admin/match` needs an admin seed. Check whether `seed-test-project.ts` can mint one, or scope M3's proof to vitest.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node_modules in the worktree | every test | ✗ (worktree is a sibling dir, no walk-up) | — | `npm ci` in the worktree before any test |
| Node | build/tests | ✓ | 25.8.1 | — |
| Playwright + cached Chromium | T0 local probe | ✓ (main checkout; chromium-1217/1228/1234 cached) | 1.61.1 | — |
| Seeded e2e (TEST Supabase) | reflow-sweep-authed, axe chip gate | CI only (`e2e-seeded`, gated on `vars.E2E_TEST_DB_CONFIGURED`) | — | None locally. ⚠️ `e2e-seeded` currently contends on the shared-TEST advisory key (ROADMAP 164.9.4 records 3600 s lock timeouts) and is being moved by Phase 164.9.4 |
| Logged-in Chrome (claude-in-chrome) | SC3 orchestrator pass | orchestrator-side | — | — |

**Missing with no fallback:** none. **Missing with fallback:** worktree `node_modules` (`npm ci`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.10 (jsdom) + Playwright 1.61.1 (chromium) |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` (vitest); seeded e2e runs in CI `e2e-seeded` only |

jsdom has no layout engine, so a layout defect cannot be observed there. vitest can pin STRUCTURE (the class that makes shrinking possible, the absence of a duplicate string, the read-only gating, the contrast math). Only Playwright at a real viewport can prove "no page overflow". Both are needed. A vitest class pin must be one that fails when the fix is reverted (neuter the class → RED).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | Failing signal at HEAD | File Exists? |
|--------|----------|-----------|-------------------|------------------------|-------------|
| T0 | main-scroller overflow detected | e2e helper self-test | `npx playwright test e2e/reflow.spec.ts` + new fixture case | new case with a wide flex child inside `#main-content` must go RED | ❌ Wave 0 |
| SC2-(a)/A1 | tab bar within main at 390/640/960 | e2e seeded + vitest class pin | `npx playwright test e2e/layout-narrow.spec.ts`; `npx vitest run src/app/(dashboard)/allocations/AllocationsTabs.test.tsx` | mainOverflow > 1 | ❌ Wave 0 |
| SC2-TWEAKS | chip rect does not intersect `nav[aria-label="Primary mobile"]` | e2e seeded | same spec, rect-intersection assertion | intersect at 390 | ❌ |
| (d)/S1 | constituent list is a region; page no overflow | vitest + e2e (composed scenario) | `npx vitest run …/ScenarioComposer.test.tsx` | no `role=region` around list; mainOverflow | ❌ |
| (f)(g)(h)/S2 | one "No changes yet"; Commit visible and inside viewport; footer not over heading | vitest + e2e | `npx vitest run …/ScenarioFooter.test.tsx` | `toHaveLength(1)` RED (2 today) | ✅ extend |
| (j)/F1 | 2-col KPI at narrow container | vitest pin + e2e | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx` | `grid-cols-3` fallback | ✅ update (post-169) |
| R169-(a)/F4 | ended record → "last month of record" label | vitest, fixed clock | `npx vitest run src/app/factsheet/[id]/v2/MetricsColumn.*.test.tsx` | label reads "Month-to-date" for a past `m.end` | ❌ (post-169) |
| P1/P2 | profile tabs scroll; Disconnect inside viewport | vitest pin + e2e seeded `/profile?tab=exchanges` | `npx vitest run src/components/ui/Tabs.test.tsx` | Disconnect right edge > clientWidth | ✅ update / ❌ e2e |
| R1/(l) | row stacks; tags nowrap | vitest + e2e (manager seed) | `npx vitest run src/app/(dashboard)/strategies/page.share-affordance.test.tsx` | name box width < N px at 390 | ✅ extend |
| (k)/T1 | filter bar above table header while scrolled | e2e seeded `/my-strategies` | `elementFromPoint` on the Sort select returns the select | a `th` returned | ❌ |
| CHIP/K1 | ≥4.5:1 on all four sites | vitest (tokens + class read) + axe | `npx vitest run tests/a11y/chip-contrast.test.ts`; CI `e2e-seeded` axe | 4.344 < 4.5 | ❌ Wave 0 |
| SC2-HEADER/H1 | signed-in header when session | vitest (mock `createClient`) + seeded e2e `/security` | `npx vitest run src/app/(marketing)/…test.tsx` | "Sign in" shown with a session | ❌ |
| SC2-COMPARE/H2 | empty state names an existing control | vitest | `npx vitest run src/app/(dashboard)/compare/page.test.tsx` | text contains "compare checkboxes" | ✅ extend |
| SC2-MATCH/M3 | write handlers no-op and controls hidden below md | vitest (mock `useMediaQuery`) | `npx vitest run src/components/admin/AllocatorMatchQueue*.test.tsx` | click at 390 fires fetch | ❌/extend |
| M1/M2 | email shown; "Computed"; count label matches filter | vitest | `npx vitest run src/components/admin/AdminTabs*.test.tsx` | "Synced" / "in progress" | extend |
| SC3 | 390 / 640 / 960 in logged-in browser after deploy | manual (orchestrator, claude-in-chrome) | — | horizontal page scroll or clipped primary action | orchestrator checkpoint |
| C1, V1 | design / site decisions | manual (founder checkpoint) | — | — | checkpoint |

### Sampling Rate
- **Per task commit:** the touched component's vitest file(s).
- **Per wave merge:** `npm test` + `npx tsc --noEmit` + lint.
- **Phase gate:** full vitest green; CI `e2e-seeded` (incl. the corrected reflow sweep and the axe chip gate) green and SHA-bound; then the orchestrator's SC3 pass.

### Wave 0 Gaps
- [ ] `e2e/helpers/reflow.ts`: measure `#main-content`; scroll-aware offender walk.
- [ ] `e2e/layout-narrow.spec.ts` (or extend `reflow-sweep-authed.spec.ts`): 390/640/960; composed scenario (seed via the `composer-axe` idiom); `/profile?tab=exchanges`; `/my-strategies`; Tweaks-vs-nav intersection; Commit-in-viewport. FLOW-01: the `HAS_SEED_ENV` skip AND the ci.yml seeded list.
- [ ] `tests/a11y/chip-contrast.test.ts`.

## Security Domain

UI-only phase; `security_enforcement` is not disabled in config, so this section is included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (session only read) | Supabase `auth.getUser()` server-side (H1) |
| V3 Session Management | read-only | Existing `src/proxy.ts` refresh. H1 adds a read, no write |
| V4 Access Control | yes (M1, M3) | `isAdminUser` page gate (`admin/page.tsx:18`, read) + `/api/admin/match/*` route files that reference `isAdminUser` (grep only; per-handler enforcement to be confirmed by the security reviewer). The viewport-based read-only (M3) is UX, NOT a control |
| V5 Input Validation | no new inputs | — |
| V6 Cryptography | no | — |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Treating "read-only on mobile" as an authorization boundary | Elevation of privilege | Never. Server admin checks are the boundary and are unchanged. M3 only stops the UI offering writes it disclaims |
| Owner email disclosure (M1) | Information disclosure | Admin-only page, admin-gated select. Synthetic fixtures only (public repo) |
| Signed-in header leaking identity on cached HTML (H1) | Information disclosure | Reading cookies makes the route dynamic [CITED], so no shared static HTML carries a user. Do not add `use cache` / `revalidate` to these layouts. Render no email or name in the header, only a generic app link |

## Sources

### Primary (HIGH confidence)
- Codebase reads at HEAD `8eafe1057`: every file cited above.
- Headless-Chromium probe (Playwright 1.61.1): output pasted in §Structural Finding.
- Node contrast computation: output pasted in §K1.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:69`: cookies opt a layout into dynamic rendering.
- Phase 169 plan set at `22275a673` (`origin/feat/169-pagetruth`): `files_modified` of 169-04/05/10; CONTEXT D-04, D-06.

### Secondary (MEDIUM)
- ROADMAP `### Phase 170` evidence lines (PROD measurements at 367 CSS px, 2026-09-27). Dated claims, re-measured in code where possible.
- `.planning/uat/2026-09-26-browser-pass.md`.

### Tertiary (LOW)
- None used as a basis for a recommendation.

## Metadata

**Confidence breakdown:**
- Owners and root causes: HIGH (read at HEAD; (a) probe-confirmed; chip computed).
- Fix approaches: MEDIUM (standard CSS; T1/S2(f)/F2/F3 mechanisms `[ASSUMED]` pending the T0 re-measure).
- Pitfalls: HIGH for the reflow-gate blindness (probed), MEDIUM otherwise.

**Research date:** 2026-09-27
**Valid until:** Phase 169 merge (T-F anchors), otherwise about 14 days (fast-moving repo).
