---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 02b
subsystem: ui
tags: [tailwind-v4, design-tokens, eslint, no-raw-font-px, bp-03, byte-identity]

# Dependency graph
requires:
  - phase: 54-01a
    provides: "--text-fixed-N @theme token aliases in globals.css (9,10,11,12,13,18,22,24,28,32,36) = exact px-in-rem"
provides:
  - "21 mandate/notes/layout/connect/exchanges/ui components + top-level src/app/* orphan pages migrated off raw text-[Npx] onto byte-identical text-fixed-N tokens"
  - "Combined with 54-01b + 54-02a, the entire repo is free of raw text-[Npx] outside the 4 off-globbed frozen charts + WorstDrawdowns + test fixtures — the precondition for Plan 54-05's repo-wide no-raw-font-px error flip"
affects: [54-05, 54-01b, 54-02a]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mechanical text-[Npx] -> text-fixed-N className swap; render byte-identical (token value = N/16 rem); responsive prefix preserved (md:text-[32px] -> md:text-fixed-32)"

key-files:
  created: []
  modified:
    - src/components/connect/KeyPermissionBadge.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/layout/MobileNav.tsx
    - src/components/layout/PageHeader.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/mandate/MandateAdvancedSection.tsx
    - src/components/mandate/MandateForm.tsx
    - src/components/mandate/MandateSlider.tsx
    - src/components/notes/BridgeOutcomeNoteSection.tsx
    - src/components/notes/HoldingNoteRow.tsx
    - src/components/notes/StrategyNoteCard.tsx
    - src/components/ui/CardShell.tsx
    - src/components/ui/CollapsibleSection.tsx
    - src/components/ui/Tooltip.tsx
    - "src/app/(dashboard)/recommendations/page.tsx"
    - "src/app/browse/[slug]/[strategyId]/page.tsx"
    - src/app/browse/page.tsx
    - src/app/error.tsx
    - src/app/not-found.tsx
    - "src/app/portfolio-pdf/[id]/page.tsx"
    - "src/app/scenario-share/[token]/page.tsx"

key-decisions:
  - "All px sizes present in scope (10,11,12,13,28,32) already had a --text-fixed-N alias from 54-01a — no text-[(N/16)rem] fallback was ever needed and globals.css was not touched."
  - "Responsive variants (md:text-[32px]) swap to md:text-fixed-32 — the bracket-only regex preserves the prefix, and the token utility composes identically with the md: variant."

patterns-established:
  - "Bracket-only perl substitution s/text-\\[(\\d+)px\\]/text-fixed-$1/g preserves any Tailwind variant prefix while swapping the arbitrary-value bracket for the token utility."

requirements-completed: [BP-03]

# Metrics
duration: 8min
completed: 2026-06-30
---

# Phase 54 Plan 02b: BP-03 px→token migration (components + app pages) Summary

**21 mandate/notes/layout/connect/exchanges/ui components and top-level src/app/* orphan pages migrated off raw `text-[Npx]` onto byte-identical `text-fixed-N` tokens — completing (with 54-01b + 54-02a) the repo-wide cleanup that is the precondition for Plan 54-05's `no-raw-font-px` error flip.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-30T01:40Z
- **Completed:** 2026-06-30T01:43Z
- **Tasks:** 2
- **Files modified:** 21

## Accomplishments
- Migrated 14 component files (28 className sites) and 7 app pages (15 className sites) — 43 raw `text-[Npx]` sites total — to `text-fixed-N` tokens.
- Render byte-identical: every swap is `text-[Npx]` → `text-fixed-N` where the 54-01a token = exactly `N/16 rem`. Diff is exactly 43 insertions / 43 deletions across the two task commits.
- globals.css NOT touched (owned by 54-01a); `charts/WorstDrawdowns.tsx` NOT touched (off-globbed); the `no-raw-font-px` ESLint rule NOT flipped (54-05 owns that).
- Confirmed repo-wide grep is now clean: after this plan + the already-landed 54-01b/54-02a, the ONLY production files carrying raw `text-[Npx]` are the 4 off-globbed frozen charts (EquityChart, HistogramChart, MasterBrush, TimeSeriesChart) + WorstDrawdowns, plus 3 `.test.tsx` fixtures.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate mandate + notes + layout + connect + exchanges + ui components** - `04ff93ff` (refactor)
2. **Task 2: Migrate the top-level src/app/* orphan pages** - `e77f6c20` (refactor)

## Files Created/Modified

Task 1 (components — 14 files, 28 sites):
- `src/components/connect/KeyPermissionBadge.tsx` — 5 sites (text-[12px]×2, text-[13px]×3)
- `src/components/exchanges/AllocatorExchangeManager.tsx` — 5 sites (text-[10px]×4, text-[11px])
- `src/components/layout/MobileNav.tsx` — 2 sites (text-[10px])
- `src/components/layout/PageHeader.tsx` — 1 site (text-[32px])
- `src/components/layout/Sidebar.tsx` — 3 sites (text-[10px])
- `src/components/mandate/MandateAdvancedSection.tsx` — 1 site (text-[11px])
- `src/components/mandate/MandateForm.tsx` — 2 sites (text-[11px], text-[13px])
- `src/components/mandate/MandateSlider.tsx` — 2 sites (text-[13px])
- `src/components/notes/BridgeOutcomeNoteSection.tsx` — 1 site (text-[13px])
- `src/components/notes/HoldingNoteRow.tsx` — 1 site (text-[13px])
- `src/components/notes/StrategyNoteCard.tsx` — 1 site (text-[13px])
- `src/components/ui/CardShell.tsx` — 1 site (text-[10px])
- `src/components/ui/CollapsibleSection.tsx` — 2 sites (text-[10px], text-[11px])
- `src/components/ui/Tooltip.tsx` — 1 site (text-[13px])

Task 2 (app pages — 7 files, 15 sites):
- `src/app/(dashboard)/recommendations/page.tsx` — 2 sites (text-[10px])
- `src/app/browse/[slug]/[strategyId]/page.tsx` — 2 sites (text-[10px])
- `src/app/browse/page.tsx` — 1 site (md:text-[32px])
- `src/app/error.tsx` — 1 site (md:text-[32px])
- `src/app/not-found.tsx` — 1 site (md:text-[32px])
- `src/app/portfolio-pdf/[id]/page.tsx` — 5 sites (text-[10px]); rem output identical so PDF layout unchanged
- `src/app/scenario-share/[token]/page.tsx` — 3 sites (text-[10px], text-[11px], text-[28px])

## Decisions Made
- All px sizes present (10/11/12/13/28/32) already had a `--text-fixed-N` alias from 54-01a; no `text-[(N/16)rem]` fallback needed and globals.css was never opened for edit.
- Responsive variant `md:text-[32px]` → `md:text-fixed-32` — the bracket-only swap preserves the `md:` prefix and composes identically.

## Deviations from Plan

None - plan executed exactly as written. No bugs, no missing functionality, no blocking issues. Pure mechanical className token swaps with no runtime/network/DB surface.

## Issues Encountered
None.

## Verification Results
- **Per-tree grep (Task 1):** zero non-test raw `text-[Npx]` across mandate/notes/layout/connect/exchanges/ui.
- **Repo-wide grep (Task 2):** `grep -rEl "text-\[[0-9]+px\]" src --include="*.tsx" --include="*.ts" | grep -vE "(EquityChart|TimeSeriesChart|HistogramChart|MasterBrush|WorstDrawdowns)" | grep -vE "\.(test|spec)\.(ts|tsx)$"` prints **NOTHING** — repo is clean for the 54-05 error flip (54-01b + 54-02a already landed on this branch).
- **ESLint:** `npx eslint` over all 21 plan files → exit 0, zero `no-raw-font-px` warnings.
- **Typecheck:** `npm run typecheck` (tsc --noEmit) clean.
- **Vitest:** touched-primitive unit tests green — CardShell, CollapsibleSection, Tooltip, PageHeader, MandateForm, KeyPermissionBadge (63 tests) + phase-52-frozen-spine-guards (frozen islands untouched); scenario-share page/server-boundary/share-resolve + portfolio-pdf vintage + error (23 tests). All pass.
- **globals.css:** `git diff --stat -- src/app/globals.css` EMPTY.
- **No deletions:** post-commit deletion check clean on both task commits.

## Remaining raw text-[Npx] sites repo-wide (for Plan 54-05 awareness — NOT in this plan's scope, NOT fixed)
Production (the documented off-globbed frozen-chart islands — must NOT be migrated; covered by an `off` glob, not an edit):
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`
- `src/app/factsheet/[id]/v2/HistogramChart.tsx`
- `src/app/factsheet/[id]/v2/MasterBrush.tsx`
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`
- `src/components/charts/WorstDrawdowns.tsx`

Test fixtures (off-globbed for `.test`/`.spec`):
- `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx`
- `src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx`
- `src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx`

54-05 must ensure the EquityChart + the three factsheet/v2 chart-internal SVG files (HistogramChart/MasterBrush/TimeSeriesChart) + `charts/WorstDrawdowns.tsx` are covered by the `off`/`error`-exempt glob (or a documented file-scoped `eslint-disable`) before flipping `no-raw-font-px` to `error`, and that the `.test`/`.spec` off-glob covers the 3 fixtures above. No source migration of those frozen files is permitted (frozen-spine git-diff-zero guard at `src/__tests__/phase-52-frozen-spine-guards.test.ts`).

## Next Phase Readiness
- Plan 54-05's precondition is MET: every migratable orphan file is clean; only the documented frozen-chart islands + test fixtures carry raw `text-[Npx]`.
- No blockers from this plan.

## Self-Check: PASSED

- Commit `04ff93ff` (Task 1) — FOUND in git log
- Commit `e77f6c20` (Task 2) — FOUND in git log
- `54-02b-SUMMARY.md` — FOUND
- All 21 modified source files present on disk

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
