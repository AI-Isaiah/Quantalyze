---
phase: 52-per-surface-application-allocator-journey
plan: 03
subsystem: allocator-journey
tags: [compare, container-queries, tabular-nums, fluid-fill, loading, error-boundary, font-px-migration, truncation]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "the fluid --text-* clamp tiers (--text-micro) the badge font-px migrates onto"
  - phase: 50-primitive-refresh
    provides: "the StrategyTable/ResponsiveTable @container precedent + the Skeleton/Button primitives the route files assemble from"
  - phase: 52-01
    provides: "the frozen-spine guard, the 2560px /compare reflow-sweep anchor (h1:has-text(Compare Strategies)), and the container-query tabular-nums contract this migration keeps green"
provides:
  - "compare surface brought to the v1.4 bar: page-level max-w-[1920px] fluid-fill (APPLY-01/TYPE-03)"
  - "CompareTable migrated to @container with tabular-nums preserved + name-cell title= recovery (TYPE-04/TYPE-02)"
  - "compare route-level loading.tsx + error.tsx (STATE-01) with render tests"
  - "compare surface raw-font-px-zero (ready for the 52-07 no-raw-font-px=error ratchet)"
affects: [52-07, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "data-surface page fluid-fill = mx-auto max-w-[1920px] shell wrapping the success-return (page layer; chrome max-w-7xl cap is the deferred consolidated-owner decision)"
    - "@container host on the table overflow wrapper + @3xl:px-8 column breathing room (un-collapse at @min, never strand 2 columns — Pitfall 4); plain @container never @container-size (Pitfall 1)"
    - "route loading.tsx = RSC, animate-pulse on the shell wrapper + Skeleton primitives inside, dominant comparison-table anchor, sr-only role=status"
    - "route error.tsx = client boundary mirroring (dashboard)/error.tsx: unstable_retry, digest-only never error.message"

key-files:
  created:
    - "src/app/(dashboard)/compare/loading.tsx"
    - "src/app/(dashboard)/compare/loading.test.tsx"
    - "src/app/(dashboard)/compare/error.tsx"
    - "src/app/(dashboard)/compare/error.test.tsx"
    - "src/components/strategy/CompareTable.test.tsx"
  modified:
    - "src/app/(dashboard)/compare/page.tsx"
    - "src/components/strategy/CompareTable.tsx"

key-decisions:
  - "Preserved the 'Compare Strategies' PageHeader title verbatim — it is the 52-01 e2e reflow-sweep anchor (h1:has-text). Applied the 52-UI-SPEC copy refinement to the empty-state BODY paragraph only (un-anchored), not the heading. Conflict surfaced + resolved per CLAUDE.md Rule 7 (dependency-locked contract wins)."
  - "Page-level max-w-[1920px] added per the plan's interface directive; logged that the shared DashboardChrome max-w-7xl (1280px) currently dominates the cap to deferred-items.md (raising the chrome cap is a single-owner shared-file decision outside 52-03's files_modified)."
  - "qual chip text-[10px] -> text-micro (the --text-micro 10->11px tier is the 52-UI-SPEC badge-text exception); surface is now raw-font-px-zero."
  - "Test 1 of CompareTable.test.tsx caught a REAL pre-existing gap: the numeric value spans had font-metric but NOT tabular-nums — the migration added tabular-nums to close it (TYPE-04 alignment)."

patterns-established:
  - "TDD RED->GREEN on the @container/title=/tabular-nums migration: the three behavior assertions were written + confirmed RED before the CompareTable migration, then driven GREEN."

requirements-completed: [APPLY-01, TYPE-02, TYPE-03, TYPE-04, STATE-01, STATE-02, BP-01]

# Metrics
duration: 8min
completed: 2026-06-29
---

# Phase 52 Plan 03: Compare Surface to the v1.4 Bar Summary

**The /compare side-by-side comparison surface is brought fully to the v1.4 bar: page-level `max-w-[1920px]` data-surface fluid-fill, CompareTable migrated to `@container` with `tabular-nums` preserved and name cells recovered via `title=`, route-level `loading.tsx` + `error.tsx` (STATE-01) with render tests, and the surface migrated raw-font-px-zero — all proven by a new RED->GREEN `CompareTable.test.tsx` plus the 52-01 phase guards staying green.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 3 completed
- **Files:** 7 (5 created, 2 modified)

## Accomplishments

- **APPLY-01 / TYPE-03 fluid-fill** — the compare success-return content is wrapped in a `<div className="mx-auto max-w-[1920px]">` data-surface shell; the auth gate (`redirect("/login")`) and `withPublishedOnly` visibility gate are preserved exactly. `mx-auto max-w-*` never overflows at 320/2560.
- **TYPE-04 @container migration** — `CompareTable`'s overflow wrapper is now the `@container` containment context (mirroring the ResponsiveTable/StrategyTable Phase-50 idiom). Column behavior reacts to the table's own measure via `@3xl:px-8` (deliberate breathing room at the wider canvas — Pitfall 4), never a viewport `lg:`. Plain `@container`, never `@container-size` (Pitfall 1). `tabular-nums` is now on every numeric value span (a real gap the test caught — see Deviations).
- **TYPE-02 truncation treatment** — each strategy-name `<th>` is single-line (`whitespace-nowrap`) + `title={strategy.name}` so the full (possibly long) name recovers on hover in the tabular-aligned context. The `CompareCorrelationMatrix` legitimate clips (its 3 `title=` axis-label recoveries) are left intact.
- **STATE-01 route states** — `loading.tsx` (RSC, dominant multi-column comparison-table skeleton above a correlation-matrix placeholder, `mx-auto max-w-[1920px]` shell, sr-only `role="status"` liveness hint) + `error.tsx` (client boundary mirroring `(dashboard)/error.tsx`: `unstable_retry`, `console.error("[compare-error]", …)`, digest-only, never `error.message` — T-52-09 info-disclosure mitigation).
- **STATE-02 honest empty states** — the empty-selection + not-available branches stay honest (neutral muted copy, no fabricated zeros/count-ups); the empty-selection body copy was refined to the 52-UI-SPEC string.
- **DS-04 prep** — the qual chip `text-[10px]` migrated onto `--text-micro`; the compare surface is raw-font-px-zero, ready for the Wave-3 52-07 `no-raw-font-px=error` ratchet on this glob.
- **BP-01** — no frozen island touched (frozen-spine guard green); no RSC-ification of any client island.

## Task Commits

1. **Task 1: page fluid-fill + CompareTable @container + name-cell title= (TDD RED->GREEN)** — `5b172de3` (feat)
2. **Task 2: route loading.tsx + error.tsx with tests** — `c911b143` (feat)
3. **Task 3: migrate raw font-px onto --text-* tiers + honest empty copy** — `0a7ccbd4` (feat)

_Note: Task 1 is `tdd="true"`. The three CompareTable behavior assertions were written into the new `CompareTable.test.tsx` and confirmed RED (no @container, no title=, no tabular-nums on value spans) before the migration, then driven GREEN. Test + implementation are intertwined (the test is the executable contract for the migration), so they land in one `feat` commit — matching how 52-01 handled its TDD task._

## Files Created/Modified

- `src/app/(dashboard)/compare/page.tsx` — MOD: `mx-auto max-w-[1920px]` shell around the success-return; empty-selection body copy refined to the UI-SPEC string (heading preserved). Auth gate + `withPublishedOnly` unchanged.
- `src/components/strategy/CompareTable.tsx` — MOD: `@container` host + `@3xl:px-8` column tuning + `tabular-nums` on numeric value spans + `title={strategy.name}` single-line name headers + qual chip `text-[10px]` -> `text-micro`.
- `src/components/strategy/CompareTable.test.tsx` — NEW: the three RED->GREEN behavior assertions (tabular-nums on value cells; `@container` present + no viewport `lg:` + no `@container-size`; name-cell `title=` renders the real name).
- `src/app/(dashboard)/compare/loading.tsx` + `loading.test.tsx` — NEW: RSC skeleton + smoke-render/role=status tests.
- `src/app/(dashboard)/compare/error.tsx` + `error.test.tsx` — NEW: client error boundary + heading/retry/digest-only/console.error tests.

## Verification

- `npx vitest run` over the plan's full verification set (`compare/page.test.tsx`, `loading.test.tsx`, `error.test.tsx`, `CompareTable.test.tsx`, `phase-52-container-tabular-nums.test.tsx`, `phase-52-frozen-spine-guards.test.ts`) -> **6 files passed, 33 tests passed**.
- `StrategyTable.test.tsx` (24 tests) re-run **green** — the shared metric idiom is uncontaminated.
- `npx tsc --noEmit` -> **no type errors in any compare-surface file**.
- Acceptance greps: `max-w-[1920px]` page=1; `withPublishedOnly`=2 (unchanged); `redirect("/login")`=1; `@container` in CompareTable >=1 (5); `@container-size` class=0 (only in a comment, not rendered); name-cell `title=`>=1; CorrelationMatrix `title=`=3 (unchanged); `loading.tsx` no `"use client"` directive (RSC); `error.tsx` no rendered `error.message`; raw `text-[Npx]` on the compare surface = **ZERO**.
- Frozen-island delta check on this plan's 3 commits -> **no frozen-island file touched**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CompareTable numeric value cells were missing `tabular-nums`**
- **Found during:** Task 1 (the RED test exposed it).
- **Issue:** the comparison-table numeric value spans carried `font-metric` (Geist Mono) but NOT `tabular-nums`, so digits were proportional and columns could mis-align under the fluid type spine — exactly the TYPE-04 alignment hazard the phase guards against. Pre-existing, surfaced by Test 1's `tabular-nums` assertion.
- **Fix:** added `tabular-nums` to the numeric value span className during the @container migration.
- **Files modified:** `src/components/strategy/CompareTable.tsx`
- **Commit:** `5b172de3`

### Plan/Contract conflict surfaced + resolved (CLAUDE.md Rule 7)

**Empty-state heading copy vs the 52-01 e2e anchor.** The 52-UI-SPEC copy contract names the empty-selection heading "Select strategies to compare", but the 52-01 reflow-sweep (a committed Wave-0 contract this plan `depends_on`) anchors `/compare` on `h1:has-text("Compare Strategies")`. Changing the PageHeader title would break that gate. Resolution: kept the "Compare Strategies" title verbatim (dependency-locked contract wins) and applied the UI-SPEC refinement to the empty-state BODY paragraph only (un-anchored by any test). No test asserts the old body string, so this is safe. Documented inline in `page.tsx`.

### Out-of-scope discovery (logged, not fixed)

**DashboardChrome `max-w-7xl` caps the page-level `max-w-[1920px]` fluid-fill.** `DashboardChrome.tsx` wraps every non-full-bleed dashboard route in `mx-auto max-w-7xl` (1280px), which currently dominates the page's `max-w-[1920px]` so compare does not visibly fill to 1920px yet. Not fixed here: `DashboardChrome.tsx` is a SHARED file outside 52-03's `files_modified`, and raising its cap affects the whole allocator journey (collides with the parallel surface plans 52-02/52-04). The page-level cap is correct and forward-compatible (compare fluid-fills the moment the chrome cap is raised, with no further compare-side change). Logged to `deferred-items.md` for the consolidated/shell owner. No overflow at 320/2560 either way.

No package installs (CSS / route-file / chrome only — matches the threat register's T-52-SC `accept`). No auth gates. No architectural changes.

## Threat Surface

The plan's STRIDE register is satisfied, no new surface introduced:
- **T-52-08 (EoP):** `withPublishedOnly` + `redirect("/login")` present and unchanged (greps assert both).
- **T-52-09 (Info Disclosure):** `error.tsx` is digest-only, never `error.message` (test + grep assert).
- **T-52-10 (Info Disclosure):** `title={strategy.name}` exposes only the already-rendered, already-visibility-filtered name.
- **T-52-11 (Tampering):** frozen-spine guard green; no island touched.

No threat flags — no new network endpoints, auth paths, file access, or schema changes were added.

## Known Stubs

None. The `loading.tsx` skeleton intentionally renders placeholder `Skeleton` bars (that is its purpose as a loading state); it carries the sr-only `role="status"` liveness hint and is not a data stub. The empty/not-available branches render honest absence copy, not fabricated data.

## Self-Check: PASSED

- Files: all 5 created code/test files + the SUMMARY exist on disk.
- Commits: `5b172de3`, `c911b143`, `0a7ccbd4` all present in git log.
- `.planning/` is gitignored (local-only, per PR #530) — the SUMMARY/STATE/ROADMAP updates are written to disk but not committed; the three `feat(...)` commits are the complete committed deliverable.
