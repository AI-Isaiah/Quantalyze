---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 14
subsystem: testing
tags: [playwright, ci, github-actions, lighthouse, e2e, retire-demo]
requires:
  - phase: 192-publictruth
    provides: "192-09 moved the seeded /demo rows into the sweeps; 192-11 retired /demo; 192-08 is superseded and its Task 3 retire branch is absorbed here"
provides:
  - "No e2e spec, screenshot baseline, CI command or Lighthouse URL exercises the retired /demo"
  - "ci.yml e2e job carries no screenshot-bake input, env line, run branch or upload step"
  - "Five sweep specs collect no /demo test and pass on a placeholder build"
affects: [192-10]
actuals:
  tokens: 12000
  tasks: 2
  commits: 2
plan_head_before: d66c5117edf2ed11109ffc28970ba56b6ba5fd16
plan_head_after: 09d63424c4a269d0b270d4b17ef8a743c6e6ff27
commits: 2
tech-stack:
  added: []
  patterns:
    - "A retired page's gate is deleted, never retargeted or re-baselined (D-11)"
key-files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - src/__tests__/critical-regressions.test.ts
    - .gitignore
    - e2e/no-clip-sweep.spec.ts
    - e2e/axe-app-wide.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
    - e2e/reflow-sweep.spec.ts
    - e2e/marketing-shell.spec.ts
    - lighthouserc.json
  deleted:
    - e2e/demo-public.spec.ts
    - e2e/demo-screenshot.spec.ts
    - e2e/demo-screenshot.spec.ts-snapshots/demo-375-chromium-linux.png
    - e2e/demo-screenshot.spec.ts-snapshots/demo-768-chromium-linux.png
    - e2e/demo-screenshot.spec.ts-snapshots/demo-1280-chromium-linux.png
    - e2e/bridge-flow.spec.ts
key-decisions:
  - "Absorbed plan 192-08 Task 3 retire branch per the founder answer 'Retire it (Recommended)' recorded in 192-EVIDENCE.md"
  - "lighthouserc.json minScore (0.65) left unchanged; a dated _demo_retired note records that the ratchet was derived with /demo as the lowest route"
requirements-completed: [ROUTE-03]
duration: 70min
completed: 2026-11-07
status: complete
coverage:
  - id: D1
    description: "demo-public, demo-screenshot (+3 PNG baselines) and bridge-flow specs deleted; ci.yml bake input, env line, run branch and upload step removed; the unconditional e2e command keeps auth and smoke"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/critical-regressions.test.ts src/__tests__/e2e-seeded-hydration-guard.test.ts src/__tests__/local-stack-lane-wiring.test.ts (276 passed)"
        status: pass
      - kind: other
        ref: "actionlint -shellcheck= -pyflakes= .github/workflows/ci.yml (exit 0); every e2e/*.spec.ts path named by a workflow exists on disk"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five layout sweeps collect no /demo test and pass on a placeholder build; Lighthouse URL list is four public routes with a dated note"
    requirement: ROUTE-03
    verification:
      - kind: e2e
        ref: "CI=1 PLAYWRIGHT_BASE_URL=http://localhost:3198 npx playwright test <five sweep specs> (45 passed, 96 skipped, 0 failed); --list names no /demo"
        status: pass
    human_judgment: false
---

# Phase 192 Plan 14: Retire the demo e2e and visual checks Summary

**Every end-to-end and visual check of the retired /demo (three specs, three PNG baselines, the CI screenshot-bake plumbing, the seeded /demo sweep rows and the Lighthouse URL) is deleted, with CI's structure pins and actionlint green and the five remaining sweeps passing on a placeholder build.**

## Performance

- **Duration:** about 70 min
- **Tasks:** 2 (Task 1 tracer, Task 2 auto)
- **Files:** 15 changed (6 deleted), 27 insertions, 805 deletions
- **Commits:** `b9ef99130` (Task 1), `09d63424c` (Task 2)

## What changed

### Task 1 (`b9ef99130`)

- `git rm` of `e2e/demo-public.spec.ts`, `e2e/demo-screenshot.spec.ts` and its three `*-chromium-linux.png` baselines (the snapshot directory is gone).
- `ci.yml`:
  - both demo spec paths left the unconditional `npx playwright test` command, every other token kept in order;
  - the bake `if`/`else` collapsed to the normal command alone (`set +e`, `PW_EXIT=$?`, `set -e`, port cleanup and `exit $PW_EXIT` untouched);
  - the `BAKE_DEMO_SCREENSHOTS` env line and comment, the "Upload baked demo screenshots" step and the `bake_demo_screenshots` dispatch input were deleted, with the `bake_svg_goldens` input untouched;
  - the comment above `workflow_dispatch:` now describes the one input left;
  - the e2e job header and the env comment no longer name the demo specs or baselines;
  - the lighthouse-mobile header counts four public routes.
- `critical-regressions.test.ts`: only the H-1024 comment sentence changed. No code line changed.
- `.gitignore`: the comment above `!e2e/**/*.png` no longer cites the deleted sentinel; the rule line is kept.

### Task 2 (`09d63424c`)

- `no-clip-sweep`, `axe-app-wide`: seeded /demo describe, `SEEDED_PUBLIC_ROUTES` const and its comment removed (axe also lost its header route-list entry). `HAS_SEED_ENV` stays for the authed describes.
- `reflow-sweep-authed`: the /demo describe and its comment removed (it was the file's last block).
- `reflow-sweep`, `marketing-shell`: header sentences about /demo removed. `marketing-shell`'s wrapped-routes sentence now ends with `/contact`, which is the (marketing) folder's own list.
- `git rm e2e/bridge-flow.spec.ts`.
- `lighthouserc.json`: `/demo` removed (4 URLs), a top-level `_demo_retired` note dated 2026-11-07 naming Phase 192 D-11. `_baseline`, `_ratchet` and `minScore` (0.65) are unchanged.

## Reference check (Task 1)

`git grep -n -E "demo-public|demo-screenshot" -- src scripts e2e .github .gitignore` at the plan base found only the expected hits. None was wiring other than ci.yml, which is the file edited:

- `.github/workflows/ci.yml`: 12 hits (dispatch input, e2e header, bake branch, command, env, upload step) all removed.
- `.gitignore:106`: comment, rewritten.
- `src/__tests__/critical-regressions.test.ts:1047`: comment, rewritten.
- Comments inside the deleted specs: gone with them.
- Comments left in place (lineage, plan 192-10 lists them): `e2e/helpers/reflow.ts:7,16`, `e2e/reflow.spec.ts:25`, `e2e/reflow-sweep-authed.spec.ts:232`, `e2e/svg-chart-parity.spec.ts:95`.
- `e2e/marketing-shell.spec.ts:33` was a Task 2 hit and was removed there.

Also found outside the plan's grep scope, left alone and listed for plan 192-10: `README.md:65` names `demo-public` in its e2e directory blurb; `docs/runbooks/fix-list-reverify-2026-05-17.md:96` and two `docs/superpowers/plans/2026-04-09-*` files describe the old specs historically.

## Gates (real numbers)

| Gate | Result |
|---|---|
| `npx vitest run src/__tests__/critical-regressions.test.ts src/__tests__/e2e-seeded-hydration-guard.test.ts src/__tests__/local-stack-lane-wiring.test.ts` | 3 files, 276 passed |
| Wider vitest run of every test that reads ci.yml or names a changed spec (`src/__tests__/contracts`, `critical-regressions`, `e2e-seeded-hydration-guard`, `local-stack-lane-wiring`, `e2e-match-queue-no-vacuous-admin-gate`, `gitleaks-allowlist`, `sql-mutation-nightly-parity`, `sql-mutation-scope-step`, `test-restore-workflow-wiring`, `supabase-migrate-test-first`, `prod-prober-wiring`, `baseline-redump-wiring`, `baseline-wiring-claim`) | 23 files, 1025 passed, 1 skipped, 0 failed |
| `actionlint -shellcheck= -pyflakes= .github/workflows/ci.yml` | exit 0 |
| Every `e2e/*.spec.ts` path named by any workflow resolves on disk | no MISSING |
| Placeholder build, `npm run build` (frontend-build env, temporary `turbopack.root`) | exit 0 |
| Playwright, five sweep specs, port 3198 | 45 passed, 96 skipped (the HAS_SEED_ENV authed describes), 0 failed |
| `playwright test <five specs> --list \| grep -c '/demo'` | 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on the five edited specs | exit 0 |
| `npm run lint` | exit 0 (2 warnings, both pre-existing: `MetricsColumn.tsx` and `composite-read-path.ts`, neither touched here) |
| `lighthouserc.json` parses; `_demo_retired` carries 2026-11-07 | pass |
| Playwright seeded/Lighthouse CI runs | not run here (no seeded env, no lhci); the Lighthouse floor is unmeasured on the four remaining routes by design |

**Gate proven able to fail (T-192-32).** With `e2e/auth.spec.ts` removed from the unconditional command in a scratchpad-backed copy of ci.yml, `critical-regressions.test.ts` went RED on "ci.yml unconditional e2e command includes the protected-route-redirect spec (auth.spec.ts)" (1 failed, 183 passed). ci.yml was restored from the byte backup and `cmp` was silent. The deletions themselves add no new gate.

**Placeholder-build proof.** `next.config.ts` was backed up, given a temporary `turbopack.root`, built, and restored before the server started. `cmp` against the backup was silent and `grep -c turbopack next.config.ts` printed 0. Server on 3198 was started with `next start`, stopped afterwards, and `lsof -ti:3198` printed nothing.

## Acceptance criteria

- `grep -c 'demo-screenshot' .github/workflows/ci.yml` 0 (baseline 8); `grep -c -i 'bake_demo_screenshots'` 0 (baseline 7); `grep -c 'demo-public'` 0 (baseline 3).
- `grep -c 'e2e/smoke.spec.ts' ci.yml` 1; `grep -c 'bake_svg' ci.yml` 7 (HEAD value 7, unchanged).
- `demo-public.spec.ts`, `demo-screenshot.spec.ts` and its snapshot directory are gone.
- `.gitignore`: `demo-screenshot` 0 (baseline 1), `!e2e/**/*.png` rule present once.
- `grep -c '/demo'` is 0 in all five sweep specs (baselines 5, 8, 7, 2, 4); `editorial-hero-headline` 0 in the three that carried it.
- `reflow-sweep.spec.ts` and `marketing-shell.spec.ts` carry 0 `TEST_SUPABASE`/`HAS_SEED_ENV` tokens.
- `lighthouserc.json`: `localhost:3000/demo` 0, four URLs, `_demo_retired` once with 2026-11-07 and D-11.
- `e2e/bridge-flow.spec.ts` is gone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] One historical comment in `axe-app-wide.spec.ts` rewritten**
- **Found during:** Task 2, acceptance check `grep -c '/demo'` must be 0
- **Issue:** A header paragraph retelling an old incident said a public row "500'd /demo". It is not a demo test or route list, but it would fail the zero-hit criterion.
- **Fix:** Reworded to "500'd the since-retired demo page" (and re-wrapped). No test logic touched.
- **Files modified:** `e2e/axe-app-wide.spec.ts`
- **Commit:** `09d63424c`

**2. [Rule 3 - Blocker] Task 2 commit message amended once**
- The first message said "in no CI command", which contains a near-match of a skip token's words. It was not the bracketed token and cannot suppress CI, but the common rules ban writing it anywhere, so the unpushed commit was amended before anything else ran. Both final messages carry no skip token, trailer or attribution line.

**Total deviations:** 2 (both Rule 3, comment/message only). **Impact:** none on behavior.

## Known Stubs

None.

## Threat Flags

None. The change removes test and CI surface only.

## Items left for plan 192-10

- Lineage comments listed above; `README.md:65`, the 2026-05-17 runbook line and the two 2026-04-09 docs plans.
- TODOS `[158-OPS-03]` closure with the bridge-flow reason (per the plan's decision notes).
- The Lighthouse `minScore` stays at 0.65 until a CI run measures the four remaining routes.

## Self-Check: PASSED

- Deleted files absent: `demo-public.spec.ts`, `demo-screenshot.spec.ts` and snapshots, `bridge-flow.spec.ts`.
- Commits `b9ef99130` and `09d63424c` are on `wt/192-p14`.
- `commits: 2` measured with `git rev-list --count` from the persisted ledger base.
- STATE.md and ROADMAP.md untouched.
