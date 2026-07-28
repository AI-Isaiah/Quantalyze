---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 02a
subsystem: ui
tags: [tailwind, design-tokens, eslint, no-raw-font-px, bp-03, strategy-tree]

# Dependency graph
requires:
  - phase: 54-01a
    provides: "--text-fixed-N @theme aliases in globals.css (9,10,11,12,13,18,22,24,28,32,36) — byte-identical to text-[Npx]"
provides:
  - "src/components/strategy/** + src/components/strategy-v2/** carry zero raw text-[Npx] (className) and zero raw fontSize:'Npx' (style)"
  - "One of three parallel halves of the BP-03 source migration (with 54-01b allocations/factsheet and 54-02b other-components/app-pages)"
affects: [54-01b, 54-02b, 54-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Byte-identical px->token migration: text-[Npx] className -> text-fixed-N utility; inline fontSize:'Npx' -> fontSize:'var(--text-fixed-N)'"

key-files:
  created: []
  modified:
    - src/components/strategy-v2/StrategyV2Shell.tsx
    - src/components/strategy/CompareCorrelationMatrix.tsx
    - src/components/strategy/FactsheetPreview.tsx
    - src/components/strategy/FreshnessBadge.tsx
    - src/components/strategy/HealthScore.tsx
    - src/components/strategy/HoldingFactsheet.tsx
    - src/components/strategy/ManagerIdentityPanel.tsx
    - src/components/strategy/PendingIntros.tsx
    - src/components/strategy/PercentileRankBadge.tsx
    - src/components/strategy/StarToggle.tsx
    - src/components/strategy/StrategyFilters.tsx
    - src/components/strategy/StrategyHeader.tsx
    - src/components/strategy/SyncBadge.tsx

key-decisions:
  - "StrategyV2Shell's raw size was an inline `fontSize:\"32px\"` STYLE (not a text-[Npx] className) — the critical constraint covers both forms, so migrated it to `fontSize:\"var(--text-fixed-32)\"` (the CSS custom property the text-fixed-32 utility resolves to: 2rem = 32px, byte-identical) with an in-situ comment. No new token; globals.css untouched."
  - "Every present px size (10, 11, 32) already has a matching --text-fixed-N alias from 54-01a — no rem-arbitrary fallback was needed; no token was added or edited."
  - "Pre-existing no-raw-font-px warning on ReturnsDistributionPanel.test.tsx:103 (`min-h-[240px]` in an assertion string, NOT a font-size, in a .test file) is OUT OF SCOPE — logged to deferred-items.md, not fixed."

patterns-established:
  - "px->token byte-identity: className text-[Npx]->text-fixed-N; inline fontSize:'Npx'->fontSize:'var(--text-fixed-N)'. The fluid text-micro clamp is NOT byte-identical and must not be used for locked surfaces."

requirements-completed: [BP-03]

# Metrics
duration: 7min
completed: 2026-06-29
---

# Phase 54 Plan 02a: strategy/strategy-v2 px->token migration Summary

**Migrated the entire `src/components/strategy/**` + `src/components/strategy-v2/**` tree (13 files, 27 raw-px sites) off raw `text-[Npx]`/`fontSize:'Npx'` onto the byte-identical `text-fixed-N` tokens from 54-01a, with globals.css/charts/eslint.config.mjs untouched and the rule NOT flipped.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-29T23:31Z
- **Completed:** 2026-06-29T23:37Z
- **Tasks:** 1 (auto)
- **Files modified:** 13

## Accomplishments
- 26 className `text-[10px]`/`text-[11px]`/`text-[32px]` swapped to `text-fixed-10`/`text-fixed-11`/`text-fixed-32` across 12 `strategy/*` files (byte-identical: 0.625rem / 0.6875rem / 2rem @16px root).
- 1 inline `fontSize:"32px"` STYLE in `StrategyV2Shell.tsx` migrated to `fontSize:"var(--text-fixed-32)"` (byte-identical), the form a `text-[Npx]`-only grep would miss but the critical constraint and `no-raw-font-px` rule both flag.
- Acceptance grep returns ZERO non-test raw `text-[Npx]` in both trees; `npx eslint` reports ZERO `no-raw-font-px` warnings on the production files in both trees.
- frozen-spine vitest guard GREEN (9/9); `tsc --noEmit` clean; 290 component tests across 30 files GREEN.
- `git diff --stat -- src/app/globals.css` EMPTY; no `charts/**` file (incl. `WorstDrawdowns.tsx`) and no `eslint.config.mjs` touched; rule left as-is (`warn`) for 54-05 to flip.

## Task Commits

1. **Task 1: Migrate the src/components/strategy + strategy-v2 tree** - `8761a6be` (refactor)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP) committed separately.

## Files Created/Modified
- `src/components/strategy/StrategyHeader.tsx` - `text-[32px]` -> `text-fixed-32` (the larger-size file; alias already existed)
- `src/components/strategy/HealthScore.tsx` - `text-[11px]` -> `text-fixed-11`
- `src/components/strategy/FreshnessBadge.tsx` - two `text-[11px]` -> `text-fixed-11`
- `src/components/strategy/CompareCorrelationMatrix.tsx` - two `text-[11px]` -> `text-fixed-11`
- `src/components/strategy/StrategyFilters.tsx` - `text-[11px]` -> `text-fixed-11`
- `src/components/strategy/PercentileRankBadge.tsx` - `text-[11px]` -> `text-fixed-11`
- `src/components/strategy/FactsheetPreview.tsx` - one `text-[11px]` + four `text-[10px]` -> `text-fixed-11`/`text-fixed-10`
- `src/components/strategy/HoldingFactsheet.tsx` - five `text-[10px]` -> `text-fixed-10`
- `src/components/strategy/ManagerIdentityPanel.tsx` - two `text-[10px]` + two `text-[11px]` -> `text-fixed-10`/`text-fixed-11`
- `src/components/strategy/PendingIntros.tsx` - two `text-[10px]` -> `text-fixed-10`
- `src/components/strategy/StarToggle.tsx` - `text-[10px]` -> `text-fixed-10`
- `src/components/strategy/SyncBadge.tsx` - `text-[10px]` -> `text-fixed-10`
- `src/components/strategy-v2/StrategyV2Shell.tsx` - inline `fontSize:"32px"` -> `fontSize:"var(--text-fixed-32)"` (byte-identical)

## Decisions Made
- **StrategyV2Shell uses the inline `fontSize` style form, not a className.** The plan listed it among the 13 files and a `text-[Npx]` grep showed nothing, but `no-raw-font-px` (and the critical constraint) also flag `fontSize:'Npx'`. Migrated it to `fontSize:"var(--text-fixed-32)"` — the exact CSS custom property the `text-fixed-32` utility resolves to (`2rem` = 32px) — so the raw px is gone and the render is byte-identical, without touching globals.css.
- **No rem-arbitrary fallback needed.** All three present sizes (10/11/32) already had a `--text-fixed-N` alias from 54-01a, so the `text-[(N/16)rem]` fallback path in the constraint was never exercised.
- **`charts/WorstDrawdowns.tsx` (off-globbed) confirmed not in either tree** — untouched per the threat model (T-54-02-01).

## Deviations from Plan

None that required auto-fix rules in the bug/missing-functionality/blocking sense. The only judgment call was recognizing StrategyV2Shell's px lived in an inline `fontSize` style rather than a `text-[Npx]` className — handled within the plan's explicit critical constraint ("replace every raw text-[Npx] (className) **and fontSize:'Npx' (style)**"), not a scope expansion.

## Issues Encountered
- **Out-of-scope pre-existing lint warning (SCOPE BOUNDARY):** `npx eslint` on the trees surfaced one residual `no-raw-font-px` warning at `src/components/strategy-v2/ReturnsDistributionPanel.test.tsx:103` — but it is (1) in a `.test.tsx` file the plan's acceptance grep explicitly excludes (`grep -v "\.test\."`), (2) NOT a font-size (`min-h-[240px]` inside an assertion string), and (3) untouched by this plan. Logged to `deferred-items.md`; not fixed (belongs to 54-05's rule-flip / test-exempt-glob decision, not this className migration). It is a warning, not an error — the rule is still `warn` repo-wide.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The strategy/strategy-v2 half of BP-03 is clean. Together with 54-01b (allocations/factsheet) and 54-02b (other components/app pages), this leaves zero non-frozen, non-test files carrying raw `text-[Npx]` — the precondition for the repo-wide `no-raw-font-px` `warn->error` flip in Plan 54-05.
- 54-05 should also resolve the deferred `ReturnsDistributionPanel.test.tsx:103` warning (test-file exemption or split the bracketed token) before the `error` flip, or test files must be globbed `off`.

## Self-Check: PASSED

- All 13 modified files exist on disk (FOUND).
- Task commit `8761a6be` exists in git log (FOUND).
- 12 `strategy/*` files contain `text-fixed-`; `StrategyV2Shell.tsx` contains `var(--text-fixed-32)` (1) — all migrations present.
- Acceptance grep ZERO non-test raw `text-[Npx]`; `npx eslint` ZERO `no-raw-font-px` warnings on production files in both trees; globals.css diff EMPTY; frozen-spine 9/9 GREEN; tsc clean; 290 component tests GREEN.

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-29*
