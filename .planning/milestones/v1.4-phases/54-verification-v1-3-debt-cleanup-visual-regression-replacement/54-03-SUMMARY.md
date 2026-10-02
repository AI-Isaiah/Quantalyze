---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 03
subsystem: ui
tags: [tailwind, max-width, admin, layout, vitest, source-scan, rt-w2]

# Dependency graph
requires:
  - phase: 53-per-surface-application
    provides: "DashboardChrome.isWide allow-list extended to /admin + /portfolios (the over-stretch this plan caps for prose/form pages)"
provides:
  - "Inner max-w-[1100px] cap on the 4 admin prose/form pages (partner-import, users, users/[id], for-quants-leads)"
  - "src/__tests__/admin-width.test.tsx — bidirectional static source-scan gating the RT-W2 fix (in-scope cap present; out-of-scope data page wide)"
affects: [54-verification, design-review-audit, rt-w2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-page inner max-w cap (NOT a shell-regex narrowing) to tame a fluid-fill shell for a mixed prose/data route tree"
    - "Static source-scan width test (readFileSync + className substring), NOT a jsdom render — the Phase-38 composer-width.test.tsx idiom"

key-files:
  created:
    - src/__tests__/admin-width.test.tsx
  modified:
    - src/app/(dashboard)/admin/partner-import/page.tsx
    - src/app/(dashboard)/admin/users/page.tsx
    - src/app/(dashboard)/admin/users/[id]/page.tsx
    - src/app/(dashboard)/admin/for-quants-leads/page.tsx

key-decisions:
  - "Cap value = max-w-[1100px], sourced from DESIGN.md 'Layout → Max content width: 1100px (main content area)'. Used the arbitrary-value Tailwind literal (matches the in-repo composer-width precedent) over a named scale token, since DESIGN.md states the prose measure in px, not a tier."
  - "Wrapped each fragment's full content (PageHeader included) in <div className=\"mx-auto max-w-[1100px]\"> so header + body share one centered measure."
  - "users/[id]/page.tsx: capped ONLY the primary content return; the Row() presentational helper's <div> (which carries no max-w) is untouched — the out-of-scope invariant holds there naturally."
  - "DashboardChrome.isWide regex left unchanged (CONTEXT-locked); admin DATA pages (partner-roi) keep the wide 1920px measure."

patterns-established:
  - "RT-W2 per-page width cap: a fluid-fill /admin shell stays wide for data tables while prose/form pages add their own mx-auto max-w-[1100px] cap."
  - "Bidirectional width source-scan: assert the in-scope literal present on each target file AND .not.toContain on a contrast data page so an over-broad future edit reds CI."

requirements-completed: [VERIFY-05]

# Metrics
duration: ~12min
completed: 2026-06-30
---

# Phase 54 Plan 03: RT-W2 admin prose/form width caps + static source-scan Summary

**The 4 prose/form admin pages get an inner `max-w-[1100px]` cap (DESIGN.md main-content measure) so their inputs/prose stop fluid-filling to ~1920px, while admin data tables keep the wide measure; a bidirectional static source-scan (`admin-width.test.tsx`) pins both directions.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-30T01:04Z
- **Completed:** 2026-06-30T01:08Z
- **Tasks:** 2
- **Files modified:** 5 (4 pages + 1 new test)

## Accomplishments
- Applied a consistent inner `max-w-[1100px]` cap to all 4 RT-W2 prose/form admin pages (`partner-import`, `users`, `users/[id]`, `for-quants-leads`) by wrapping each fragment's content in `<div className="mx-auto max-w-[1100px]">`.
- Created `src/__tests__/admin-width.test.tsx`: 5 cases (4 in-scope `.toContain` + exactly-one count guard, 1 out-of-scope `.not.toContain` on `partner-roi`). Static `readFileSync` scan, never a jsdom render (Pitfall 7).
- `DashboardChrome.isWide` regex left untouched (CONTEXT-locked); `partner-roi` (the contrast DATA page) untouched — both verified zero-diff vs `main`.
- eslint clean on all 5 touched files (admin/** is at `no-raw-font-px: error` — stayed clean; this is a className-wrapper edit, no raw font-px).

## Task Commits

Each task was committed atomically:

1. **Task 1: Apply inner max-w cap to the 4 admin prose/form pages** — `c5ce6a2d` (fix)
2. **Task 2: Static source-scan test admin-width.test.tsx** — `d240f8ec` (test)

**Plan metadata:** committed separately (SUMMARY/STATE/ROADMAP — note `.planning/` is gitignored, so the docs commit is local-only by design).

## Files Created/Modified
- `src/__tests__/admin-width.test.tsx` — bidirectional static source-scan: 4 prose/form pages contain `max-w-[1100px]` (exactly one each), `partner-roi` does NOT.
- `src/app/(dashboard)/admin/partner-import/page.tsx` — fragment → `<div className="mx-auto max-w-[1100px]">`.
- `src/app/(dashboard)/admin/users/page.tsx` — same.
- `src/app/(dashboard)/admin/users/[id]/page.tsx` — same, primary content return only (Row helper untouched).
- `src/app/(dashboard)/admin/for-quants-leads/page.tsx` — same.

## Decisions Made
- **Cap value `max-w-[1100px]`** chosen from DESIGN.md "Layout → Max content width: 1100px (main content area)" — the canonical prose/form measure. Used the arbitrary-value literal (rather than a named `max-w-Nxl` tier) to (a) match DESIGN.md's px-stated measure exactly and (b) mirror the in-repo `composer-width.test.tsx` arbitrary-value idiom the test copies.
- **Single consistent literal across all 4 files** so the static test asserts one token.
- **users/[id] scope:** the file's second function (`Row`, ~:179) is a presentational sub-component, not a loading/error return; it carries no `max-w` and was left untouched, so the OUT-OF-SCOPE invariant is satisfied by construction there too.

## Deviations from Plan

None - plan executed exactly as written.

(The plan's `<read_first>` referenced a possible loading/error second return in `users/[id]/page.tsx:179`; the actual second function at that location is the `Row` presentational helper. Capping only the primary content return — as the plan directed — was unambiguous and required no deviation.)

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RT-W2 is now gated by `admin-width.test.tsx` in the blocking `frontend-coverage` unit suite (no CI list edit needed).
- Per the plan's verification note: the authed reflow sweep does NOT cover `/admin` (allocator-role seed can't reach admin routes), so this static test is the sole automated RT-W2 gate — by design (RESEARCH admin-exclusion caveat).
- Visual confirmation of the capped pages on ultra-wide is part of the VERIFY-05 design-review audit / real-device sign-off (human checkpoint), consistent with the milestone's deferred authed UATs.

## Self-Check: PASSED
- FOUND: src/__tests__/admin-width.test.tsx
- FOUND: max-w-[1100px] in all 4 target pages (exactly one each)
- FOUND: commit c5ce6a2d (Task 1), d240f8ec (Task 2)
- VERIFIED: DashboardChrome.tsx + partner-roi/page.tsx zero-diff vs main
- VERIFIED: admin-width.test.tsx — 5 tests pass
- VERIFIED: eslint clean on all 5 touched files

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
