---
phase: 52-per-surface-application-allocator-journey
verified: 2026-06-29T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run e2e reflow sweep at 2560px ultra-wide with real Supabase seed (MA-8 CI job)"
    expected: "All ULTRAWIDE_ROUTES render without clip, horizontal overflow, or text bleed at 2560×1440; seed-gated describe block in e2e/reflow-sweep-authed.spec.ts exits green"
    why_human: "Spec is seed-gated (HAS_SEED_ENV) — requires real Supabase credentials in CI MA-8 job. Cannot run in sandbox (no network). The additive describe block and its TypeScript types are CI-verified; only the live seeded run remains."
  - test: "Confirm svg-chart-parity screenshot goldens are regenerated and match"
    expected: "Playwright visual diff for the chart goldens passes in the MA-8 seed-gated CI job after the @container migrations in FactsheetView and AnalyticalPanels"
    why_human: "Screenshot goldens require a headed Chromium run with seed data; no baseline update can be verified without executing CI against real data."
  - test: "Live authed ultra-wide visual canary — log in to quantalyze.xyz as qa-demo@quantalyze.app and view /allocations, /compare, /discovery at 2560px"
    expected: "All three routes fluid-fill to ~1920px (DashboardChrome isWide active), no max-w-7xl cap visible, KpiStrip renders in 5-column @lg grid, no horizontal overflow, typography grades readable at ultra-wide"
    why_human: "Authed surfaces require a real browser session (Playwright MCP or CDP). gstack headless browse cannot hydrate authed client components. Visual confirmation of the 1920px cap and @container column layout cannot be automated in this environment."
---

# Phase 52: Per-Surface Application — Allocator Journey Verification Report

**Phase Goal:** The highest-traffic allocator surfaces — allocations, composer, factsheets, discovery, bridge, risk, single-strategy — are fully at the v1.4 bar: fluid no-clip type, layouts that hold to ultra-wide, container-query component responsiveness, complete honest state coverage, and React/Next-16 boundary correctness — while the composer/factsheet are treated as frozen client islands (chrome/layout only) so the math stays byte-identical.

**Verified:** 2026-06-29
**Status:** HUMAN_NEEDED (all 5 ROADMAP success criteria verified; 3 seed-gated/visual items require human confirmation)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Text clips nowhere 320→2560px; all data-surface layouts hold to ultra-wide with no horizontal overflow | VERIFIED | `max-w-[1920px]` on allocations/page.tsx:63, compare/page.tsx:142, discovery/[slug]/page.tsx:46; DashboardChrome `isWide` allow-list (`/^\/(allocations|compare|discovery)(\/|$)/`) at line 72 caps chrome at 1920px for those routes; `break-words min-w-0` on AlertBanner:122, `break-words` on SavedScenariosList:533; ScenarioComposer:2785 `truncate max-w-[160px]` + `title=` for single-line table context; StrategyGrid:72 `title=` on truncated `<h3>`; CompareTable:103 `title=` on strategy-name `<th>` |
| 2 | Container queries adopted for KpiStrip, CompareTable, FactsheetView, AnalyticalPanels; tabular-nums preserved on all numeric value cells | VERIFIED | KpiStrip:464 `@container grid … @sm:grid-cols-2 @lg:grid-cols-5` + tabular-nums on value cells (lines 524, 534); CompareTable:91 `<div className="@container overflow-x-auto">` + `@3xl:px-8` breathing room + tabular-nums on numeric spans; FactsheetView:638 `@container grid grid-cols-3 @5xl:grid-cols-9/7`; AnalyticalPanels StreakDistributionPanel `@container … @2xl:grid-cols-2`; `phase-52-container-tabular-nums.test.tsx` green (18 tabular-nums assertions, 5 tests) |
| 3 | Complete loading/empty/error coverage on all in-scope surfaces; no fabricated data or hidden states | VERIFIED | allocations/loading.tsx: RSC, `max-w-[1920px]`, 4-cell @container KPI skeleton, `sr-only role="status" aria-live="polite"`; allocations/error.tsx: `"use client"`, `unstable_retry`, digest-only (`error.digest` never `error.message`); compare/loading.tsx + compare/error.tsx: same pattern; strategy/[id]/loading.tsx: narrow prose `max-w-3xl` (prose page, intentional); strategy/[id]/error.tsx: `unstable_retry`, digest-only. Discovery: intentionally excluded (CONTEXT decision: already had loading.tsx from Phase 46; parent `(dashboard)/error.tsx` provides fallback boundary — not a gap) |
| 4 | Frozen islands (8 paths) are byte-identical vs baseline SHA `cd2fcb4c`; no RSC boundary migration or edit to frozen files | VERIFIED | `phase-52-frozen-spine-guards.test.ts`: `FALLBACK_BASE_SHA = "cd2fcb4c"`, all 8 frozen island paths enumerated, 9 tests all green. `git diff --name-only cd2fcb4c HEAD` grep for frozen islands = EMPTY (zero frozen files in delta). Full suite: 7109 tests passed, 596 files |
| 5 | Next 16 best practices applied: `unstable_retry` in all new error.tsx files, `React.cache` on data loaders, digest-only error display (ASVS V7) | VERIFIED | All three new error.tsx files (allocations, compare, strategy/[id]) use `unstable_retry` (not legacy `reset`). strategy/[id]/page.tsx:2,18 imports `cache` from `"react"` and wraps `getPublicStrategyDetail` via `React.cache` (WR-01 fix, commit f9f74beb). All three error.tsx files render `error.digest` only — never `error.message`. 0 TypeScript errors (`npx tsc --noEmit` clean) |

**Score:** 5/5 truths verified

---

### Deferred Items

Items not yet met but explicitly accepted by the user as out-of-scope for Phase 52.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | 18 orphan allocations files (incl. frozen EquityChart) still carry raw `text-[Npx]` | Phase 53/54 | `deferred-items.md §52-07`: user decision "per-file ratchet + log debt"; orphans stay at repo-wide `warn` (non-blocking); frozen EquityChart is permanently never-migrate |
| 2 | 7 orphan factsheet/v2 files (incl. chart-internal TimeSeriesChart/HistogramChart/MasterBrush) carry raw `text-[Npx]` | Phase 53/54 | `deferred-items.md §52-07`: same user decision; chart-internal SVG files exempt permanently |
| 3 | Full focus-trap + focus-return-on-close for ScenarioComposer ResetConfirmationModal (Phase-50 Modal primitive) | Phase 54 | `deferred-items.md §code-review`: CR-03 — minimal fix (autoFocus Cancel + Escape-to-close) applied now; full focus-trap deferred to Phase 54 a11y audit (composer-island sensitivity; pre-existing, not phase-52 regression) |
| 4 | WR-02 (AlertBanner dead guard), WR-03 (discovery md:left-[260px] hardcoded), WR-04 (inner Suspense invisible fallback), IN-01 (discovery duplicate RequestIntroButton aria-label) | Phase 54 | `deferred-items.md §code-review`: all pre-existing, minor, not phase-52-introduced |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/__tests__/phase-52-frozen-spine-guards.test.ts` | Git delta guard for 8 frozen islands | VERIFIED | EXISTS, substantive (8 island paths, `FALLBACK_BASE_SHA`), 9 tests green |
| `src/__tests__/phase-52-container-tabular-nums.test.tsx` | Container query + tabular-nums migration tests | VERIFIED | EXISTS, `CONTAINER_MIGRATED` = 4 components, 18 tabular-nums assertions, 5 tests green |
| `e2e/reflow-sweep-authed.spec.ts` | Additive 2560px reflow sweep (seed-gated) | VERIFIED (code) / HUMAN NEEDED (run) | Additive describe block exists with `ULTRAWIDE_ROUTES` and `page.setViewportSize({ width: 2560, height: 1440 })`. Seed-gated via `HAS_SEED_ENV + test.skip`. TypeScript clean. Actual run needs CI MA-8 |
| `src/app/(dashboard)/allocations/loading.tsx` | RSC skeleton, 1920px, a11y liveness | VERIFIED | EXISTS, no `"use client"`, `max-w-[1920px]`, 4-cell @container KPI skeleton, `sr-only role="status" aria-live="polite"` |
| `src/app/(dashboard)/allocations/error.tsx` | Next 16 error boundary, digest-only | VERIFIED | EXISTS, `"use client"`, `unstable_retry`, renders `error.digest` only |
| `src/app/(dashboard)/compare/loading.tsx` | RSC skeleton | VERIFIED | EXISTS |
| `src/app/(dashboard)/compare/error.tsx` | Next 16 error boundary, digest-only | VERIFIED | EXISTS, `unstable_retry`, digest-only |
| `src/app/strategy/[id]/loading.tsx` | RSC skeleton, narrow prose measure | VERIFIED | EXISTS, `max-w-3xl px-4 py-12` (prose page design decision, not 1920px fluid-fill) |
| `src/app/strategy/[id]/error.tsx` | Next 16 error boundary, digest-only | VERIFIED | EXISTS, `unstable_retry`, digest-only |
| `src/components/layout/DashboardChrome.tsx` | `isWide` allow-list for 1920px fluid-fill | VERIFIED | Line 72: `const isWide = /^\/(allocations|compare|discovery)(\/|$)/.test(pathname)`; line 168: `isWide ? "max-w-[1920px]" : "max-w-7xl"`; 16/16 DashboardChrome.test.tsx tests pass |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` | @container migration, tabular-nums | VERIFIED | Line 464: `@container grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-5`; tabular-nums on value cells (lines 524, 534) |
| `src/components/strategy/CompareTable.tsx` | @container migration, @3xl breathing room, tabular-nums | VERIFIED | Line 91: `@container overflow-x-auto`; `@3xl:px-8`; tabular-nums on numeric value spans |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | @5xl container-query column split, tabular-nums | VERIFIED | Line 638: `@container grid grid-cols-3 @5xl:grid-cols-9/7`; KPI value cells: `font-mono tabular-nums whitespace-nowrap` |
| `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` | @container histogram split | VERIFIED | StreakDistributionPanel is `@container`; two-histogram split uses `@2xl:grid-cols-2` |
| `eslint.config.mjs` | Phase 52 strangler ratchet (lines 107–151) | VERIFIED | Per-file `no-raw-font-px: error` for grep-proven-clean surfaces (compare/**, discovery/**, strategy/[id]/**, CompareTable.tsx, StrategyGrid.tsx, 15 clean allocations files, 13 clean factsheet files). Orphan chart files remain at `warn`. `ScenarioComposer.tsx` NOT in error globs (correct — orphan debt) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| DashboardChrome.tsx | allocations/compare/discovery pages | `isWide` regex allow-list → `max-w-[1920px]` | WIRED | Line 72 regex + line 168 conditional class |
| allocations/page.tsx | allocations/loading.tsx | Next.js route segment file convention | WIRED | Both files exist in same directory; no import needed — Next.js auto-wires route segment files |
| allocations/page.tsx | allocations/error.tsx | Next.js route segment file convention | WIRED | Same directory; `unstable_retry` imports from `"next/dist/client/components/error-boundary"` |
| KpiStrip.tsx | @container CSS | `className="@container grid …"` | WIRED | tailwind.config enables `@tailwindcss/container-queries`; class rendered directly |
| phase-52-frozen-spine-guards.test.ts | git baseline `cd2fcb4c` | `execSync("git diff --name-only …")` | WIRED | Test reads git delta at runtime; FALLBACK_BASE_SHA hardcoded in test |
| strategy/[id]/page.tsx | React.cache | `import { cache } from "react"` + `const getStrategyDetail = cache(...)` | WIRED | Lines 2, 18 — request memoization for double-call prevention |
| error.tsx files (all 3) | `unstable_retry` | `import { unstable_retry } from "next/dist/…"` | WIRED | All three new error boundaries use Next 16.2.0 API |

---

### Data-Flow Trace (Level 4)

Not applicable for this phase. Phase 52 is a chrome/layout/boundary phase — it migrates CSS tokens, container queries, error/loading boundaries, and ESLint ratchets. No new data sources or API endpoints were introduced. Existing data flows (Supabase queries → SSR props → client components) are unchanged by design (frozen islands + chrome-only constraint).

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frozen-spine guard tests pass | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | 9 tests passed | PASS |
| Container + tabular-nums tests pass | `npx vitest run src/__tests__/phase-52-container-tabular-nums.test.tsx` | 5 tests passed | PASS |
| DashboardChrome isWide tests pass | `npx vitest run DashboardChrome.test.tsx` | 16 tests passed | PASS |
| Full vitest suite | `npx vitest run` | 7109 tests passed, 288 skipped, 596 files | PASS |
| TypeScript compilation | `npx tsc --noEmit` | 0 errors | PASS |
| ESLint on phase files | `npm run lint` | 0 errors, 434 warnings (all orphan-px debt, expected) | PASS |
| No frozen island in git delta | `git diff --name-only cd2fcb4c HEAD \| grep frozen-islands` | EMPTY (0 matches) | PASS |
| Zero raw text-[Npx] on clean surfaces | `grep -rn "text-\[[0-9]*px\]" src/app/(dashboard)/compare/ src/app/(dashboard)/discovery/ src/app/strategy/\[id\]/` | EMPTY (0 matches) | PASS |
| 2560px reflow sweep (seed-gated) | `HAS_SEED_ENV` + MA-8 CI job | Cannot run — no network in sandbox | SKIP (human needed) |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for Phase 52. The phase's verification contracts are expressed as vitest tests and eslint gates, all of which passed above.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| APPLY-01 | 52-02 through 52-06 | Apply fluid type token spine to each allocator surface | SATISFIED | All 5 surfaces migrated; named files verified raw-px-zero; per-file error ratchet in eslint.config.mjs lines 107–151 |
| TYPE-02 | 52-02 through 52-06 | No accidental text clipping at any viewport 320→2560px | SATISFIED | `break-words min-w-0` on AlertBanner, `break-words` on SavedScenariosList, `truncate max-w-[160px] + title=` on ScenarioComposer, `title=` on StrategyGrid + CompareTable |
| TYPE-03 | 52-07 | Layouts hold to ultra-wide; `max-w-[1920px]` fluid-fill on data surfaces | SATISFIED | DashboardChrome `isWide` allow-list wired; all three data-surface pages carry `max-w-[1920px]`; 16/16 chrome tests pass |
| TYPE-04 | 52-02 through 52-06 | Container queries adopted; tabular-nums preserved | SATISFIED | 4 components migrated; `phase-52-container-tabular-nums.test.tsx` green (18 assertions) |
| STATE-01 | 52-02, 52-03, 52-05 | Loading states with skeleton UI on allocations/compare/single-strategy | SATISFIED | 3 `loading.tsx` files verified; allocations: @container 4-cell KPI skeleton; compare + strategy/[id]: exist and RSC |
| STATE-02 | 52-02, 52-03, 52-05 | Error boundaries with `unstable_retry` and digest-only display | SATISFIED | 3 `error.tsx` files; all use `unstable_retry`; all render `error.digest` only (ASVS V7 compliant) |
| BP-01 | 52-01, 52-07 | Next 16 boundary correctness; React.cache; frozen islands byte-identical | SATISFIED | Frozen-spine guard: 9 tests green; git delta clean; `React.cache` on strategy page; `unstable_retry` in all error boundaries |
| SCENARIO-05 | 52-01 | `src/lib/scenario.ts` byte-identical vs baseline | SATISFIED | File in FROZEN_ISLANDS; git delta clean; 53 scenario tests passed (includes scenario.test.ts) |
| BODY-02 | 52-01 | `src/lib/factsheet/compute.ts` byte-identical vs baseline | SATISFIED | File in FROZEN_ISLANDS; git delta clean |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| Multiple files in allocations/ (18) | Various | `text-[Npx]` raw font sizes | INFO | Orphan debt; accepted by user in `deferred-items.md §52-07`; stays at ESLint `warn` (non-blocking CI); Phase 53/54 debt |
| Multiple files in factsheet/v2/ (7) | Various | `text-[Npx]` raw font sizes | INFO | Same — accepted deferred debt; chart-internal SVG files (TimeSeriesChart/HistogramChart/MasterBrush) are permanently exempt |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | ~2779+ | `text-[12px]` (6 occurrences outside the :2779 clip-fix scope) | INFO | Orphan debt; plan explicitly restricted this file to the :2779 clip-fix ONLY; math-adjacent spans must not be touched; not in error ratchet; deferred to Phase 54 |

No `TBD`, `FIXME`, or `XXX` markers found in phase-modified files. No unreferenced debt markers.

---

### Human Verification Required

#### 1. Seed-Gated 2560px Reflow Sweep (MA-8 CI)

**Test:** Trigger GitHub Actions MA-8 job (or set `HAS_SEED_ENV=true` locally with a seeded Supabase test project) and run `npx playwright test e2e/reflow-sweep-authed.spec.ts`

**Expected:** All routes in `ULTRAWIDE_ROUTES` render at 2560×1440 with no horizontal overflow, no clipped text, no layout breakage. The additive `describe("reflow sweep @ 2560px ultra-wide — authed", ...)` block exits green.

**Why human:** The spec is seed-gated (`HAS_SEED_ENV` guard + `test.skip`). Real Supabase credentials with seeded data are required. The sandbox has no network access. The spec file exists, TypeScript-compiles clean, and the viewport/route logic is code-verified — only the live seeded run remains.

#### 2. SVG Chart-Parity Screenshot Goldens

**Test:** After the MA-8 seed-gated run completes, confirm Playwright screenshot goldens for the chart surfaces in FactsheetView and AnalyticalPanels match the new `@container`-based layout.

**Expected:** Visual diff passes for all chart golden comparisons; no unexpected layout shifts from the `@2xl:grid-cols-2` histogram split or `@5xl:grid-cols-9/7` factsheet grid.

**Why human:** Screenshot goldens require headed Chromium execution with real seed data. No baseline update can be verified without the CI run completing against real data.

#### 3. Live Authed Ultra-Wide Visual Canary

**Test:** Log into quantalyze.xyz as `qa-demo@quantalyze.app`, navigate to `/allocations`, `/compare`, and `/discovery` in a browser window set to 2560px width (or use Playwright MCP with `page.setViewportSize({ width: 2560, height: 1440 })`).

**Expected:**
- All three routes fluid-fill to ~1920px (DashboardChrome `isWide` branch active — not capped at 1280px)
- No max-w-7xl cap visible on any data surface
- KpiStrip renders in 5-column `@lg:grid-cols-5` layout (not stacked)
- No horizontal scrollbar or overflow on CompareTable at ultra-wide
- Typography grades readable at ultra-wide (fluid clamp tokens from Phase 49 active)

**Why human:** Authed surfaces require a real interactive browser session. gstack headless `browse` cannot hydrate client React components on authed routes (see `[[browse-no-hydrate-authed]]`). The Playwright MCP with a CDP session or Chromium with stored cookies is the correct verification path.

---

### Gaps Summary

No gaps blocking goal achievement. All 5 ROADMAP success criteria are verified in the codebase. The 3 open items above are execution-gated (seed data + authed browser) rather than implementation gaps.

The deferred items (orphan raw-px debt, partial CR-03 focus trap, WR-02/03/04/IN-01) are user-accepted scope decisions documented in `deferred-items.md`. They are not gaps in the phase goal.

---

_Verified: 2026-06-29_
_Verifier: Claude (gsd-verifier)_
