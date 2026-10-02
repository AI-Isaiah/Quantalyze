---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 07
subsystem: testing
tags: [playwright, e2e, a11y, ci, no-clip, truncation, ellipsis, flow-01]

# Dependency graph
requires:
  - phase: 54-04
    provides: "lighthouse-mobile job ownership boundary (left untouched here)"
  - phase: 46
    provides: "reflow-sweep public+authed scaffolding (PUBLIC_ROUTES, HAS_SEED_ENV, loginViaForm, seedTestAllocator) + helpers/reflow.ts assertTargetSizes per-element walk idiom"
provides:
  - "e2e/no-clip-sweep.spec.ts — runtime content cut-off guard (scrollWidth>clientWidth+1 under text-overflow:ellipsis on non-empty text) across public + seeded-authed routes x 1280/375/2560"
  - "FLOW-01 dual-wiring of no-clip-sweep into BOTH ci.yml playwright lists (unseeded + seeded MA-8) with a HAS_SEED_ENV gate on the authed half"
affects: [phase-54-verification, visual-regression, design-system, a11y]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runtime clip detection: a page.evaluate per-element walk (adapted from assertTargetSizes) flags genuine cut-off (scrollWidth>clientWidth+1 + CSS text-overflow:ellipsis + overflow!=visible + non-empty text), with an ALLOW selector set for deliberate clamps — truer than a static class ban"
    - "measured>0 sentinel (__NO_ELEMENTS_MEASURED__) layered on top of the visible-anchor + HTTP<400 guards as the false-green belt-and-suspenders"

key-files:
  created:
    - "e2e/no-clip-sweep.spec.ts"
  modified:
    - ".github/workflows/ci.yml"

key-decisions:
  - "Single new spec carrying BOTH a public (unseeded, no env gate) describe and a seeded (HAS_SEED_ENV-gated) authed describe — the RESEARCH-recommended option over two co-located files"
  - "Allowlist = [data-clamp-ok], .avatar, [class*=line-clamp] — deliberate clamps are NOT failures; only unintended clip fails"
  - "/admin EXCLUDED from the seeded authed routes (seedTestAllocator stamps role=allocator; /admin redirects a non-admin → false-green). Admin clip coverage rides the public routes + the static admin-width test (Plan 54-03)"
  - "Reused the exact PUBLIC_ROUTES floor + authed allocator route anchors from reflow-sweep so the no-clip sweep covers the same surface as the reflow sweep"

patterns-established:
  - "Runtime no-clip probe (VERIFY-03): browser-measured truncation guard that catches the @container 2560 trap jsdom class-string tests false-pass"

requirements-completed: [VERIFY-03]

# Metrics
duration: 13min
completed: 2026-06-29
---

# Phase 54 Plan 07: Runtime No-Clip Playwright Sweep (VERIFY-03) + FLOW-01 Dual-Wiring Summary

**A runtime Playwright no-clip guard (`e2e/no-clip-sweep.spec.ts`) that fails the build on any reintroduced truncation — detecting genuine content cut-off (`scrollWidth>clientWidth+1` under `text-overflow:ellipsis` on non-empty text) across public + seeded-authed routes × 1280/375/2560 viewports, allowlisting deliberate clamps, and FLOW-01 dual-wired into both ci.yml playwright lists.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-29T23:50:06Z
- **Completed:** 2026-06-29T23:52:26Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Authored `e2e/no-clip-sweep.spec.ts` — a RUNTIME clip-detection sweep (more truthful than a static `truncate`/`line-clamp` class ban: it flags *actual* visible cut-off, not mere utility usage). Public (unseeded) half over the 5-route `PUBLIC_ROUTES` floor + seeded (HAS_SEED_ENV-gated) authed half over 10 allocator routes, each × 3 viewports (desktop 1280, mobile 375, ultra-wide 2560) = 45 recognized tests.
- Allowlisted deliberate clamps (`[data-clamp-ok]`, `.avatar`, `[class*="line-clamp"]`) so only UNINTENDED clip fails.
- Layered three false-green guards per probe: HTTP `status()>=400` early throw, visible-anchor `toBeVisible()` assertion, and a `measured>0` sentinel (`__NO_ELEMENTS_MEASURED__`).
- FLOW-01 dual-wired the spec into BOTH ci.yml playwright lists (unseeded ~L1073 + seeded MA-8 ~L1281) with the `HAS_SEED_ENV` const + `test.skip` on the authed describe (place 2) — so the gate actually runs in CI (public unseeded + seeded MA-8).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author e2e/no-clip-sweep.spec.ts (public + seeded halves)** - `b9d9b712` (test)
2. **Task 2: FLOW-01 dual-wire no-clip-sweep into ci.yml (both lists)** - `8a657141` (ci)

## Files Created/Modified
- `e2e/no-clip-sweep.spec.ts` (created) - Runtime clip-detection sweep. Public describe (no seed gate) over `PUBLIC_ROUTES`; seeded describe (HAS_SEED_ENV-gated, `seedTestAllocator` in `beforeAll`, `loginViaForm` in `beforeEach`) over allocator-reachable authed routes. Each route × viewport: set viewport → goto → throw on HTTP>=400 → assert visible anchor → run `findClippedText` page.evaluate predicate → `expect(clipped).toEqual([])`.
- `.github/workflows/ci.yml` (modified) - Added `e2e/no-clip-sweep.spec.ts` to the unseeded playwright list (~L1073) and the seeded MA-8 list (~L1281, before `--timeout 60000`).

## Decisions Made
- One spec with two describes (public + seeded) rather than two co-located files — the RESEARCH-recommended option; keeps the shared `findClippedText`/`probeNoClip`/`VIEWPORTS` helpers in one place.
- Detection predicate scoped to text the user genuinely cannot read: `text-overflow:ellipsis` AND `overflow !== "visible"` AND `scrollWidth > clientWidth + 1` (the same sub-pixel slop `reflow.ts` uses) AND non-empty trimmed text. A `truncate` container wide enough to show its text never fires.
- `/admin` deliberately excluded from the seeded authed routes (allocator role redirects → false-green); documented inline, admin coverage rides the public routes + the Plan 54-03 static width test.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Typecheck (`npx tsc --noEmit`) clean; `npx playwright test e2e/no-clip-sweep.spec.ts --list` recognized all 45 tests; `no-clip-sweep` appears in 2 ci.yml lists; YAML re-parsed clean; the lighthouse-mobile job (Plan 54-04) was not touched.

## Acceptance Verification
- `e2e/no-clip-sweep.spec.ts` exists with the clip predicate (`scrollWidth`/`clientWidth`/`textOverflow`), the avatar/line-clamp/data-clamp-ok allowlist, `2560` viewport, `HAS_SEED_ENV` gate, and the `toBeVisible` false-green guard (Task 1 verify: PASS).
- `npx tsc --noEmit` exit 0.
- `npx playwright test e2e/no-clip-sweep.spec.ts --list` → "Total: 45 tests in 1 file".
- `no-clip-sweep` count in ci.yml = 2 (unseeded + seeded) (Task 2 verify: PASS).
- The seeded/authed half self-skips locally without seed env (`test.skip(!HAS_SEED_ENV, …)`).

## Next Phase Readiness
- ROADMAP success criterion 3 (no-clip portion) is met — a runtime no-clip CI guard fails the build on reintroduced truncation across routes × viewports incl. 2560.
- Cannot run the full seeded e2e in this sandbox (no network / no seeded DB); acceptance is spec-exists + typechecks + dual-wired + HAS_SEED_ENV gate present — all satisfied. The live seeded run executes in CI when `vars.E2E_TEST_DB_CONFIGURED == 'true'`.

## Self-Check: PASSED

- FOUND: e2e/no-clip-sweep.spec.ts
- FOUND: .github/workflows/ci.yml
- FOUND: .planning/phases/54-.../54-07-SUMMARY.md
- FOUND commit: b9d9b712 (Task 1, test)
- FOUND commit: 8a657141 (Task 2, ci)

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-29*
