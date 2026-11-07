---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 09
subsystem: testing
tags: [playwright, e2e, axe, reflow, no-clip, seeded-lane]
requires:
  - phase: 192-publictruth
    provides: "192-05 makes /demo fail loudly without data; 192-07 deletes /demo/founder-view"
provides:
  - "/demo no-clip, axe and reflow rows run only in the seeded lane (HAS_SEED_ENV-gated describes)"
  - "marketing-shell canary no longer visits /demo or the deleted founder view"
affects: [192-08, 192-10]
actuals:
  tokens: 2200
  tasks: 3
  commits: 3
plan_head_before: 2a10f0cc1f0392c5687bfdc594235252b4de4c92
plan_head_after: ef6f0e192706ed9a563efe6ac6630b0dcd5af207
commits: 3
tech-stack:
  added: []
  patterns:
    - "A public route that fails loudly without data lives in a describe gated by the file's own HAS_SEED_ENV constant, never in the seed-free public describe"
key-files:
  created: []
  modified:
    - e2e/no-clip-sweep.spec.ts
    - e2e/axe-app-wide.spec.ts
    - e2e/reflow-sweep.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
    - e2e/marketing-shell.spec.ts
key-decisions:
  - "Width floor is 390px, not the UI-SPEC backstops' 320px: the founder decision of 2026-09-27 wins (CLAUDE.md Rule 7)"
  - "No ci.yml change: no-clip-sweep and axe-app-wide are already in both Playwright lists with their own HAS_SEED_ENV constants; reflow-sweep-authed is already in the seeded list"
requirements-completed: [ROUTE-03]
duration: 6min
completed: 2026-11-07
status: complete
coverage:
  - id: D1
    description: "/demo no-clip rows (1280, 375, 2560) run in the seeded lane and are collected-but-skipped in the placeholder lane"
    requirement: ROUTE-03
    verification:
      - kind: e2e
        ref: "playwright e2e/no-clip-sweep.spec.ts against a placeholder build: 15 passed, 36 skipped, 0 failed (3 /demo rows skipped)"
        status: pass
    human_judgment: true
    rationale: "The seeded run itself (the /demo rows executing against rendered data) was not run here; it happens in the CI seeded lane."
  - id: D2
    description: "/demo axe rows and /demo reflow rows (390px, 2560px) moved to seeded describes; reflow-sweep.spec.ts stays seed-free"
    requirement: ROUTE-03
    verification:
      - kind: e2e
        ref: "playwright e2e/axe-app-wide.spec.ts e2e/reflow-sweep.spec.ts e2e/reflow-sweep-authed.spec.ts against a placeholder build: 23 passed, 68 skipped, 0 failed (5 /demo rows skipped)"
        status: pass
    human_judgment: true
    rationale: "The /demo rows execute for real only in the CI seeded lane; locally they were observed as skipped."
  - id: D3
    description: "marketing-shell.spec.ts no longer visits /demo or the deleted founder view and stays grep-provably seed-free"
    requirement: ROUTE-03
    verification:
      - kind: e2e
        ref: "playwright e2e/marketing-shell.spec.ts against a placeholder build: 7 passed"
        status: pass
    human_judgment: false
---

# Phase 192 Plan 09: Move the /demo layout-sweep rows to the seeded lane Summary

**The /demo rows of the no-clip, axe and reflow sweeps now live in HAS_SEED_ENV-gated describes (they render only with data), and the marketing-shell canary dropped /demo and the deleted founder view.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-11-07T00:26:03Z
- **Completed:** 2026-11-07T00:31:57Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `no-clip-sweep.spec.ts`: the `/demo` row left `PUBLIC_ROUTES` and sits in `SEEDED_PUBLIC_ROUTES`, driven by describe "no-clip sweep (VERIFY-03) — /demo, seeded" under `test.skip(!HAS_SEED_ENV, ...)`, same `probeNoClip` body and `VIEWPORTS`.
- `axe-app-wide.spec.ts`: same move, describe "axe app-wide (A11Y-01) — /demo, seeded", same status check, visible anchor and AxeBuilder call; header route list no longer claims /demo runs unseeded.
- `reflow-sweep.spec.ts`: `/demo` row and its three comment lines removed, header sentence now points to the seeded spec; still no seed-env token.
- `reflow-sweep-authed.spec.ts`: new describe "reflow sweep — /demo (public, seeded)" with two tests (390x800 and 2560x1440, no login) calling `assertNoReflow(page, "#editorial-hero-headline")`.
- `marketing-shell.spec.ts`: both /demo rows removed, header gains the sentence naming `demo-public.spec.ts`'s seeded describe as the home of /demo's canary assertions.
- The home sign-up band and `/security` table backstops (plans 192-03 and 192-04) are covered by the existing public rows of `reflow-sweep.spec.ts` (`/` and `/security` at 390px and 2560px), which passed against the placeholder build.

## Task Commits

1. **Task 1: /demo no-clip rows to a seeded describe** - `6550e0edd` (test)
2. **Task 2: /demo axe and reflow rows to the seeded lane** - `fadfe4769` (test)
3. **Task 3: marketing-shell canary stops visiting /demo** - `ef6f0e192` (test)

The plan asked for one commit of all five paths at the end of Task 3; each task was committed on its own instead (atomic per-task commits are the executor contract), so the three commits above carry the same five files.

## Files Created/Modified

- `e2e/no-clip-sweep.spec.ts` - `SEEDED_PUBLIC_ROUTES` plus the seeded /demo describe, defined after `HAS_SEED_ENV`
- `e2e/axe-app-wide.spec.ts` - `SEEDED_PUBLIC_ROUTES` plus the seeded /demo describe; header edited
- `e2e/reflow-sweep.spec.ts` - /demo row and comment removed; header edited
- `e2e/reflow-sweep-authed.spec.ts` - seeded /demo reflow describe appended
- `e2e/marketing-shell.spec.ts` - two route rows removed; header sentence added

## Decisions Made

- 390px over the UI-SPEC's 320px, per the founder decision recorded in the reflow-sweep header (2026-09-27), as the plan's decision note states.
- No ci.yml edit, as planned: all three seeded-lane specs were already listed where they need to be.

## Deviations from Plan

None - plan executed exactly as written (the per-task commit split noted above is the executor protocol, not a content change).

## Verification (real numbers)

Placeholder build (CI placeholder env including `SHARE_TOKEN_SECRET`; `next.config.ts` temporarily given a `turbopack.root`, restored from a byte backup, `grep -c turbopack next.config.ts` prints 0, never committed), `next start -p 3196` (port checked free before, freed after):

| Run | Result |
|-----|--------|
| `e2e/no-clip-sweep.spec.ts` | 15 passed, 36 skipped (3 /demo rows skipped + 33 authed), 0 failed |
| `e2e/axe-app-wide.spec.ts e2e/reflow-sweep.spec.ts e2e/reflow-sweep-authed.spec.ts` | 23 passed, 68 skipped (5 /demo rows skipped among them), 0 failed |
| `e2e/marketing-shell.spec.ts` | 7 passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 2 pre-existing warnings in `MetricsColumn.tsx` and `composite-read-path.ts` (not this plan's files) |

Acceptance greps: `SEEDED_PUBLIC_ROUTES` in no-clip-sweep prints 2; `/demo` row appears once in no-clip-sweep (inside `SEEDED_PUBLIC_ROUTES`) and once in axe-app-wide (inside `SEEDED_PUBLIC_ROUTES`); `grep -c '"/demo"' e2e/reflow-sweep.spec.ts` prints 0; `editorial-hero-headline` in reflow-sweep-authed prints 1; seed-env token count in `reflow-sweep.spec.ts` and `marketing-shell.spec.ts` prints 0; `grep -c 'path: "/demo' e2e/marketing-shell.spec.ts` prints 0.

**Not run here:** the seeded lane. No seeded Supabase environment exists in this worktree, so the new seeded /demo describes were observed as skipped only; they have not executed against a rendered /demo. They run in the CI seeded lane (T-192-21 mitigation: collected as skipped locally, never deleted).

## Issues Encountered

- A Next build in a worktree with a symlinked `node_modules` needs a temporary `turbopack.root`; handled as plan 192-07 documented, config restored byte-for-byte.

## Next Phase Readiness

Plan 192-08's seeded demo-public describe owns /demo's single-main and single-h1 canary. Plan 192-10 is unaffected.

## Self-Check: PASSED

- All five modified files exist and `git status` is clean apart from this SUMMARY.
- Commits `6550e0edd`, `fadfe4769`, `ef6f0e192` are ancestors of HEAD; `git rev-list --count 2a10f0cc1..HEAD` printed 3.

---
*Phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one*
*Completed: 2026-11-07*
