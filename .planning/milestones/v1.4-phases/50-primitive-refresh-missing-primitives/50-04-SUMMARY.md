---
phase: 50-primitive-refresh-missing-primitives
plan: 04
subsystem: ui
tags: [view-transitions, motion, css, prefers-reduced-motion, density, accessibility]

# Dependency graph
requires:
  - phase: 50-01
    provides: Radix + user-event installed, new-primitive test contracts, Wave-1 CSS-only core refresh baseline
provides:
  - withViewTransition(update) — native document.startViewTransition wrapper with SSR / no-support / reduced-motion instant fallback (no React <ViewTransition>, no experimental.viewTransition flag)
  - globals.css reduced-motion ::view-transition-old/new animation-duration:0s zeroing (extends the existing L152 block, belt-and-suspenders with the helper)
  - table-scoped [data-strategy-table][data-density] density rule reusing --row-h / --density-pad (no global font-size:13px leak; does not touch body[data-density])
affects: [50-05, 50-06, StrategyTable, Tabs, density-toggle, Wave-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Native View Transitions via document.startViewTransition in a tiny client-safe helper (NOT React <ViewTransition> + experimental flag) — lower blast radius for two opt-in micro-interactions"
    - "Reduced-motion handled twice: helper short-circuits to synchronous update(), globals.css zeroes any ::view-transition pseudo that slips through"
    - "Table-scoped data-density root (data-strategy-table) so a public table's density control never flips the global allocator-dashboard density (RESEARCH Q2)"

key-files:
  created:
    - src/lib/view-transition.ts
    - src/lib/view-transition.test.ts
  modified:
    - src/app/globals.css

key-decisions:
  - "Followed the PLAN's NATIVE startViewTransition decision over the RESEARCH's earlier React <ViewTransition> lean — the plan frontmatter, must_haves, and acceptance criteria all gate on the native path + no next.config flag (more-recent decision wins per CLAUDE.md Rule 7)"
  - "Extended the existing L152 prefers-reduced-motion block in place rather than adding a competing standalone block — keeps the .animate-pulse rule byte-unchanged and centralizes reduced-motion handling"
  - "Scoped table density to a [data-strategy-table] root attribute (the StrategyTable root Wave 2 / Plan 50-06 will carry) so the discovery density control is isolated from body[data-density]"

patterns-established:
  - "withViewTransition(update): feature-detect document.startViewTransition + window.matchMedia reduced-motion guard, else run update() — wraps any setState for a crossfade with graceful degradation"
  - "VT reduced-motion CSS: ::view-transition-old(*)/new(*) { animation-duration: 0s !important } inside @media (prefers-reduced-motion: reduce)"

requirements-completed: [STATE-04]

# Metrics
duration: 3min
completed: 2026-06-29
---

# Phase 50 Plan 04: Motion + Density CSS Scaffolding Summary

**Native `withViewTransition` helper wrapping `document.startViewTransition` with SSR / no-support / reduced-motion instant fallback, plus globals.css extensions zeroing View-Transition animation under reduced motion and a table-scoped `[data-strategy-table][data-density]` rule that reuses the existing `--row-h`/`--density-pad` tokens without leaking the global `font-size:13px`.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-29T02:21:10Z
- **Completed:** 2026-06-29T02:24:24Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `withViewTransition(update)` client-safe helper: calls `document.startViewTransition(update)` only when the API exists AND the user does not prefer reduced motion; otherwise runs `update()` synchronously (instant swap). SSR-safe (`typeof document === "undefined"` → instant). No motion library, no `experimental.viewTransition` next.config flag.
- 3-branch unit test (`view-transition.test.ts`): VT-supported-and-allowed → `startViewTransition` called with the update; reduced-motion → `startViewTransition` NOT called, `update()` runs; unsupported → instant `update()`, no throw. jsdom branch control via `vi.stubGlobal("matchMedia", …)` + patching `document.startViewTransition`.
- `globals.css` extended the existing L152 `@media (prefers-reduced-motion: reduce)` block with `::view-transition-old(*), ::view-transition-new(*) { animation-duration: 0s !important }` — the `.animate-pulse` rule there is byte-unchanged.
- Table-scoped `[data-strategy-table][data-density="tight"|"loose"]` rules set `--row-h`/`--density-pad` to the 36px/12px and 52px/20px steps WITHOUT the global `font-size:13px`, leaving `body[data-density]` and `[data-allocator-dashboard]` untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): failing test for withViewTransition** - `4210f5bc` (test)
2. **Task 1 (TDD GREEN): native withViewTransition helper** - `b49d332a` (feat)
3. **Task 2: extend globals.css — reduced-motion VT kill + table-scoped density** - `afff330d` (feat)

_Task 1 was `tdd="true"` → test (RED) then feat (GREEN); no REFACTOR commit needed (helper already minimal)._

## Files Created/Modified
- `src/lib/view-transition.ts` (46 lines) - Native `withViewTransition` helper + private `prefersReducedMotion()` guard; degrades to instant `update()` on SSR / no API / reduced-motion.
- `src/lib/view-transition.test.ts` (65 lines) - Three-branch unit test driving each fallback by stubbing `matchMedia` and `document.startViewTransition`.
- `src/app/globals.css` - Additive: VT-zeroing rule inside the L152 reduced-motion block; `[data-strategy-table][data-density]` density rules reusing existing tokens.

## Decisions Made
- **PLAN over RESEARCH on the VT mechanism.** The 50-RESEARCH text leaned toward React `<ViewTransition>` + `experimental.viewTransition: true`, but the 50-04 PLAN frontmatter (`must_haves`, `key_links`), the orchestrator prompt, and the acceptance criteria explicitly mandate the NATIVE `document.startViewTransition` path with NO config flag. Per CLAUDE.md Rule 7 (pick the more-recent/tested pattern, don't blend) and the executor's role (execute the PLAN), the native path was implemented; `next.config.ts` was not touched (`grep -c experimental` stayed 0).
- **Extend, don't bypass.** The reduced-motion VT rule was added inside the existing L152 `@media (prefers-reduced-motion: reduce)` block, not in a new competing block, so reduced-motion handling stays centralized and the `.animate-pulse` rule is preserved byte-for-byte.
- **Table-scoped density root = `[data-strategy-table]`.** Chosen to satisfy RESEARCH Q2 (a public table's density must not flip allocator-dashboard density). The `font-size:13px` from the global tight rule was deliberately omitted so type does not shrink on the public surface.

## Deviations from Plan

None - plan executed exactly as written.

(The PLAN-vs-RESEARCH mechanism choice was a documented plan decision the executor honored, not an unplanned deviation — see Decisions Made.)

## Issues Encountered
- jsdom implements neither `document.startViewTransition` nor `window.matchMedia`. Resolved in the test by `vi.stubGlobal("matchMedia", …)` per branch and patching/deleting `document.startViewTransition` in `afterEach` — exactly the surface the helper feature-detects, so the test exercises real branch logic rather than a mocked module.

## User Setup Required

None - no external service configuration required. (`user_setup: []` in the plan frontmatter.)

## Next Phase Readiness
- **Plan 50-06 (StrategyTable reshape, Wave 3)** can now: (1) wrap its density `setState` in `withViewTransition` for a reduced-motion-safe crossfade, and (2) put `data-strategy-table data-density={…}` on the table root to drive the scoped `--row-h`/`--density-pad` rule.
- **Tabs panel swap (Wave 2/3)** can wrap its panel-change `setState` in `withViewTransition` the same way.
- No blockers. No motion library entered the bundle; `next.config.ts` unchanged; the global allocator-dashboard density behavior is untouched.

## Verification

- `npx vitest run src/lib/view-transition.test.ts` → 3 passed.
- `npx vitest run src/components/ui/` → 11 files, 59 passed (no CSS-driven regression).
- `npm run lint` → 0 errors (577 pre-existing warnings, none in this plan's files).
- `npx tsc --noEmit` → exit 0.
- `grep -c experimental next.config.ts` → 0 (unchanged); no `framer-motion`/`motion`/`@headlessui` in package.json.
- `git diff` on globals.css → purely additive (zero deletions; `body[data-density]` / `[data-allocator-dashboard]` / `.animate-pulse` unchanged).

## Self-Check: PASSED

- Files: `src/lib/view-transition.ts`, `src/lib/view-transition.test.ts`, `src/app/globals.css`, `50-04-SUMMARY.md` — all present.
- Commits: `4210f5bc` (test), `b49d332a` (feat helper), `afff330d` (feat globals.css) — all in git history.

---
*Phase: 50-primitive-refresh-missing-primitives*
*Completed: 2026-06-29*
