---
phase: 44-foundation-primitives-verification-gates
plan: 03
subsystem: testing
tags: [accessibility, wcag, viewport, vitest, nextjs, a11y, source-scan-guard]

# Dependency graph
requires:
  - phase: 44-foundation-primitives-verification-gates
    provides: "chart-accessibility-layer.test.ts source-scan-guard pattern (walk + per-file regex + violations[]) to clone"
provides:
  - "tests/visual/viewport-zoom-meta.test.ts — whole-src Vitest guard failing on any zoom-disabling viewport directive (WCAG 1.4.4 Resize Text)"
  - "src/app/layout.tsx explicit zoom-permissive `export const viewport: Viewport` (width device-width, initialScale 1; NO maximumScale, NO userScalable:false)"
affects: [phase-45, phase-46, phase-47, phase-48, mobile-adaptive-ui, accessibility-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-scan CI guard as a Vitest test (not a tsx script + ci.yml step): runs unconditionally in existing frontend-test + frontend-coverage jobs via the tests/visual/** include glob — zero ci.yml edits, zero seed gate, lowest FLOW-01 surface"
    - "Next 16 typed viewport export as the single source of truth for the <meta name='viewport'> (no hand-written meta)"

key-files:
  created:
    - tests/visual/viewport-zoom-meta.test.ts
  modified:
    - src/app/layout.tsx

key-decisions:
  - "Implemented the zoom-meta gate as a Vitest source-scan test (clone of chart-accessibility-layer.test.ts), NOT a tsx script + ci.yml step — runs in the existing frontend-test/frontend-coverage jobs with ZERO ci.yml edits and ZERO seed gate (lowest FLOW-01 risk)"
  - "Guard regexes match the DIRECTIVE shapes only (maximumScale: / userScalable:false / maximum-scale= / user-scalable=no), so an explanatory prose mention of the field names in layout.tsx's OMITTED comment does not false-trip the guard — verified the guard stays green with the comment present"
  - "viewport export OMITS maximumScale and userScalable entirely (zoom-permissive) per WCAG 1.4.4; the typed export is the sole source of truth, no hand-written <meta name='viewport'>"

patterns-established:
  - "Pattern: WCAG-1.4.4 zoom-permissive viewport enforced CI-wide by a falsifiable source-scan guard — future commits cannot re-introduce a zoom-locking directive in src/ without failing frontend-test/frontend-coverage"

requirements-completed: [A11Y-02]

# Metrics
duration: ~6min
completed: 2026-06-27
---

# Phase 44 Plan 03: Zoom-Meta Source-Scan Guard + Root Viewport Export Summary

**A falsifiable Vitest source-scan guard (clone of chart-accessibility-layer.test.ts) that fails the build on any zoom-disabling viewport directive anywhere in src/, plus an explicit zoom-permissive `export const viewport: Viewport` in the root layout — closing the WCAG 1.4.4 Resize Text gap axe structurally cannot test.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-27T14:00:16Z
- **Completed:** 2026-06-27T14:02:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- New `tests/visual/viewport-zoom-meta.test.ts` walks all of `src/` (skipping node_modules/.next, scanning `.tsx?`/`.html`) and fails on all four zoom-disabling shapes: `maximumScale:`, `userScalable:false` (Next Viewport export fields) and `maximum-scale=`, `user-scalable=no` (raw `<meta name='viewport'>` content).
- Guard runs unconditionally in the existing `frontend-test` (sharded) + `frontend-coverage` (full) jobs via the `tests/visual/**/*.test.ts` include glob — ZERO ci.yml edits, ZERO seed gate (lowest possible FLOW-01 surface).
- Guard proven falsifiable: injecting `export const v = { maximumScale: 1 }` into a temp src file made it FAIL with the exact breadcrumb; reverted before commit.
- Root `src/app/layout.tsx` now declares an explicit zoom-permissive `export const viewport: Viewport = { width: "device-width", initialScale: 1 }` (Next 16 typed export), emitting `<meta name="viewport" content="width=device-width, initial-scale=1">` with no maximumScale/userScalable — the guard passes its own export.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the zoom-meta Vitest source-scan guard** - `dd30f9b6` (test)
2. **Task 2: Add the zoom-permissive root viewport export to layout.tsx** - `b6c4475f` (feat)

## Files Created/Modified
- `tests/visual/viewport-zoom-meta.test.ts` - Whole-src source-grep guard (clone of chart-accessibility-layer.test.ts): `walk(SRC_DIR)` + 4 forbidden regexes + `violations[]` → `expect(violations).toEqual([])`. Read-only (`readFileSync`); never eval/import of scanned files. Second `it()` smoke-asserts the walk matches >50 files so the guard can't go vacuously green.
- `src/app/layout.tsx` - Added `Viewport` to the existing `import type { Metadata } from "next"` and a new `export const viewport: Viewport = { width: "device-width", initialScale: 1 }` near the existing `metadata` export. Everything else (correlation-id `<meta>`, fonts, `dynamic = "force-dynamic"`, body classes) unchanged.

## Decisions Made
- **Gate as a Vitest test, not a tsx-script + ci.yml step** (per plan/RESEARCH): runs in existing jobs via the include glob, no ci.yml edit, no seed gate — strictly less FLOW-01 surface than a script.
- **Directive-shaped regexes** (`maximumScale\s*:`, `userScalable\s*:\s*false`, etc.): the guard targets the actual config-directive shapes, so an explanatory prose mention of the field names in layout.tsx's "deliberately OMITTED" comment does not false-trip it. Verified: the guard stays green with that comment present, and a precise directive-only grep of layout.tsx returns zero matches.
- **OMIT maximumScale/userScalable entirely** from the viewport export (zoom-permissive) — setting them is the WCAG 1.4.4 failure the guard fails on. Typed export is the single source of truth; no hand-written `<meta name="viewport">`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- A blanket grep `grep -E "maximumScale|userScalable" src/app/layout.tsx` in the self-check matched the explanatory comment line ("deliberately OMITTED"), which initially read as "UNEXPECTED". Resolved by re-running with the guard's actual directive-shaped regexes (`maximumScale\s*:` etc.), which returned zero matches — confirming the only occurrence is prose, and the guard (which uses the same directive-shaped regexes) correctly stays green. No code change needed.

## Verification

- `npx vitest run tests/visual/viewport-zoom-meta.test.ts` → 2 passed (green against current src/ AND with the new viewport export present).
- Negative control: injected `maximumScale: 1` into a temp src file → guard FAILED with `src/__zoom_guard_negctrl__.ts: maximumScale: (Next Viewport export field)` → temp file removed → guard GREEN again. Proves the guard is falsifiable, not vacuously green.
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (the `Viewport` type resolves and the object satisfies it).
- `npx eslint` on both touched files → clean (exit 0).
- Coverage ratchet holds: the new test file is coverage-excluded (`tests/**` in vitest.config.ts exclude), and the viewport export is a static object literal with zero new branches — no impact on lines/statements/functions/branches thresholds.
- `git diff src/app/layout.tsx` confirms only the two intended regions changed (import + viewport export); existing metadata/dynamic/correlation-id meta untouched.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SC#2 delivered: the WCAG 1.4.4 zoom-meta gate now exists, runs in CI, and is enforced CI-wide; the root layout is zoom-permissive.
- Subsequent v1.3 phases (responsive primitives, table/chart reshape, mobile layouts) inherit a guard that will fail any future commit re-introducing a zoom-locking directive in src/.
- No blockers.

## Self-Check: PASSED
- FOUND: tests/visual/viewport-zoom-meta.test.ts
- FOUND: src/app/layout.tsx
- FOUND commit: dd30f9b6 (Task 1)
- FOUND commit: b6c4475f (Task 2)

---
*Phase: 44-foundation-primitives-verification-gates*
*Completed: 2026-06-27*
