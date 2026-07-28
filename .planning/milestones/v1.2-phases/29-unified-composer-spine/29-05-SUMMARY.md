---
phase: 29-unified-composer-spine
plan: 05
subsystem: testing
tags: [vitest, git-diff-guard, execFileSync, rls, exit-gate, scenario, frozen-engine]

# Dependency graph
requires:
  - phase: 29-01
    provides: "GET /api/strategies/[id]/returns scoped lazy-returns route (the phase-delta surface the guard inspects + the route the B15 fix classified)"
  - phase: 29-02
    provides: "extended /api/strategies/browse with is_example rows (part of the inspected delta)"
  - phase: 29-03
    provides: "Browse-drawer Example tag + SavedScenariosList portfolio copy (part of the inspected delta)"
  - phase: 29-04
    provides: "Composer entry-mode control + lazy-returns wiring + portfolio copy (part of the inspected delta)"
provides:
  - "Automated, non-vacuous Phase 29 frozen-spine exit-gate guard (no scenarios/share migration, scenario.ts zero-diff, RLS sql byte-unchanged)"
  - "A recorded full-suite + frozen-engine-diff + SCENARIO-05 + RLS-sql consolidation gate run"
affects: [phase-30, phase-31, phase-32, phase-33, exit-gates, frozen-engine, rls]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "git-delta exit-gate guard via execFileSync (merge-base origin/main HEAD, fallback base sha, fail-loud if unresolvable) mirroring strategy-sources-migration-parity.test.ts"
    - "Non-vacuity proven by a temporary dummy migration that trips the guard, then removed"

key-files:
  created:
    - "src/__tests__/phase-29-frozen-spine-guards.test.ts"
  modified:
    - "src/lib/api/limiter-ordering.test.ts (deviation: classify the 29-01 lazy-returns route)"

key-decisions:
  - "Single git-delta guard enforces all three LOCKED gates; reads the REAL delta (committed diff vs merge-base PLUS untracked-not-ignored files) so an uncommitted migration is still caught"
  - "FORBIDDEN_MIGRATION_RE = /scenario|share/i — the locked set (scenarios / scenario_shares / get_shared_scenario / create_scenario_share) all match it"
  - "execFileSync with an argument array (no shell) instead of execSync string interpolation — eliminates the command-injection surface the security hook flagged and matches the project's spawnSync precedent"
  - "Fail-loud on an unresolvable baseline ref (throws), never a silent skip (CLAUDE.md Rule 12)"
  - "The lazy-returns route is NO_INPUT (authenticated, per-user limiter, no request body — only the isUuid-validated [id] param), same shape as its sibling strategies/browse/route.ts"

patterns-established:
  - "Phase exit gates that fail silently (schema change / engine drift / RLS loosening) get a content/diff-inspecting CI guard, not a hope"
  - "A consolidation gate that runs the FULL suite is the backstop that catches sibling-plan completeness regressions (B15 registry omission) that pass in the sibling's own scoped tests"

requirements-completed: [UNIFY-01, UNIFY-02, UNIFY-03, UNIFY-04, UNIFY-05]

# Metrics
duration: 18min
completed: 2026-06-23
---

# Phase 29 Plan 05: Frozen-Spine Exit-Gate Guards & Consolidation Gate Summary

**A non-vacuous git-delta vitest guard that fails CI on any new scenarios/share migration, any `src/lib/scenario.ts` diff, or any edit to the two RLS sql honesty tests — plus a full-suite consolidation gate that caught and fixed a sibling-plan B15 limiter-registry omission, ending green (6535 passed, 0 failed).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-23T12:14:00Z (approx)
- **Completed:** 2026-06-23T12:20:00Z (approx)
- **Tasks:** 2 (1 code + 1 verification gate)
- **Files modified:** 2 (1 created, 1 modified via deviation)

## Accomplishments

- **Frozen-spine exit-gate guard** (`src/__tests__/phase-29-frozen-spine-guards.test.ts`): a single non-vacuous test enforcing all three LOCKED Phase 29 exit gates against the REAL git delta:
  - (a) NO added/changed migration under `supabase/migrations/` matching `/scenario|share/i` — covers the forbidden set scenarios / scenario_shares / get_shared_scenario / create_scenario_share.
  - (b) `src/lib/scenario.ts` is NOT in the changed-file set (frozen engine, SCENARIO-05).
  - (c) Neither `supabase/tests/test_scenarios_rls.sql` nor `supabase/tests/test_scenario_shares_rls.sql` is in the changed-file set (RLS honesty tests byte-unchanged).
- **Non-vacuity proven:** `touch supabase/migrations/29_test_scenario_dummy.sql` made assertion (a) FAIL with the exact actionable message (the untracked file was caught via `git ls-files --others`); `rm` restored 4/4 green.
- **Fail-loud (Rule 12):** if neither `git merge-base origin/main HEAD` nor the fallback base sha resolves, the guard throws an actionable error at module load — it never silently passes.
- **Consolidation gate run, recorded honestly** — see "Consolidation Gate Results" below. The full suite initially went RED (the gate doing its job) on a sibling-plan regression, which was fixed; the suite is now green.

## Task Commits

1. **Task 1: Write the frozen-spine exit-gate guard test** — `640f269e` (test)
2. **Task 2 deviation: classify the 29-01 lazy-returns route in the B15 registry** — `c5bffdb8` (test)

_Plan metadata (SUMMARY/STATE/ROADMAP) is NOT committed — `commit_docs: false`._

## Files Created/Modified

- `src/__tests__/phase-29-frozen-spine-guards.test.ts` (created) — the three-gate git-delta guard. Pure git/file inspection (execFileSync), no network. ~199 lines, runs <1s.
- `src/lib/api/limiter-ordering.test.ts` (modified) — added `strategies/[id]/returns/route.ts` to the `NO_INPUT` bucket (deviation, see below).

## Consolidation Gate Results (Task 2)

| Check | Command | Result |
|-------|---------|--------|
| Full vitest suite | `npm test` | **PASS** — 537 files passed, 19 skipped; **6535 tests passed, 284 skipped, 0 failed** (exit 0) |
| Frozen-engine zero-diff | `git diff --exit-code src/lib/scenario.ts` | **PASS** — exit 0 (also zero-diff vs the phase baseline) |
| No migration added | `git status --porcelain supabase/migrations/` | **PASS** — empty; zero scenarios/share migrations in the phase delta |
| SCENARIO-05 pins | `npx vitest run src/lib/scenario.test.ts` | **PASS** — 37/37 |
| Frozen-spine guard | `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts` | **PASS** — 4/4 (non-vacuity verified) |
| RLS sql suite | `psql -f supabase/tests/test_scenarios_rls.sql` + `test_scenario_shares_rls.sql` | **CI-DEFERRED (with guard backing)** — see below |

**RLS sql verification status — CI-deferred, guard-backed:** there is no local sql-test harness in this environment (`psql` is not installed; no `npm`/script runner for the `.sql` files). The CI `sql-tests` job (`.github/workflows/ci.yml:598`) globs `supabase/tests/test_*.sql` — which includes both RLS files — and runs each under `psql -v ON_ERROR_STOP=1` against `TEST_SUPABASE_DB_URL`; a `RAISE EXCEPTION` fails the step. That is the authoritative live RLS run. The "files byte-unchanged this phase" half is already proven non-vacuously by the new vitest guard (assertion c) AND by `git diff --exit-code` on both files (clean vs baseline and in the working tree). So the live RLS behavior is correctly the CI / `verify-work` responsibility, with the byte-unchanged invariant CI-enforced locally.

## Decisions Made

- **One guard, three gates, real delta.** The guard builds the changed-file set from `git diff --name-only <base> HEAD` PLUS `git ls-files --others --exclude-standard`. The untracked half is load-bearing: a brand-new uncommitted migration would only appear via `ls-files --others` (it is the very thing the gate must catch).
- **`execFileSync` not `execSync`.** The first draft used `execSync` with `git \`...${BASE}...\``; a PostToolUse security hook flagged shell command injection. Refactored every git call to `execFileSync("git", [...args])` (no shell) — the only interpolated value (`BASE`) is a git-resolved sha or a hardcoded constant anyway, and this matches the project's `spawnSync` precedent in `gitleaks-allowlist.test.ts`. No behavior change.
- **Baseline resolution order:** `merge-base origin/main HEAD` → fallback `a759022c` (the documented branch point) → throw. The fallback keeps the guard working on shallow CI clones; the throw keeps it from silently passing when blind.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Sibling-plan B15 limiter-registry omission surfaced by the consolidation gate**
- **Found during:** Task 2 (consolidation gate — `npm test`)
- **Issue:** The full vitest suite went RED on `src/lib/api/limiter-ordering.test.ts` ("every rate-limited route is classified"): Plan 29-01's new `GET /api/strategies/[id]/returns` route consumes `checkLimit` but was never added to any B15 ordering bucket. The route is correct (uuid validated → auth → per-user limiter, no request body); only its completeness-guard classification was missing. This passed in 29-01's own scoped route test but failed the full-suite B15 completeness guard — exactly the sibling-plan regression Task 2 is designed to catch (plan: "this task may legitimately FAIL if a sibling plan regressed; that is the gate doing its job").
- **Fix:** Classified the route in the `NO_INPUT` bucket (authenticated, per-user limiter, NO request body — only the isUuid-validated `[id]` URL param; the "burn-a-token-on-bad-body" bug structurally cannot occur). Same shape as its sibling `strategies/browse/route.ts`, already in `NO_INPUT`. Verified the route reads no body via the test's own `BODY_READ` regex before classifying.
- **Files modified:** `src/lib/api/limiter-ordering.test.ts`
- **Verification:** `npx vitest run src/lib/api/limiter-ordering.test.ts` → 6/6 green; full `npm test` re-run → 6535 passed, 0 failed (exit 0); eslint clean.
- **Committed in:** `c5bffdb8`

**Why not routed back to 29-01 as a checkpoint:** 29-01 is a landed Wave 1 plan; the fix is a one-line classification entry in the B15 guard family (a test/registry file), not a change to the 29-01 route logic. Fixing it inline (Rule 3) and recording it here is the minimal, correct action and keeps Rule 12 (do not ship a red suite) satisfied. The frozen-engine, no-migration, and RLS gates were unaffected.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation was necessary to make the consolidation gate pass honestly. It touched only a B15 registry test file — no source/logic change, no scope creep, and none of the three frozen-spine gates were touched.

## Issues Encountered

- No local pgTAP/`psql` harness — handled per the plan's explicit branch (record the CI command + lean on the byte-unchanged vitest guard; flag the live run as CI/verify-work responsibility). Not a blocker.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The three LOCKED Phase 29 exit gates are now CI-enforced by a non-vacuous guard. Phase 30 (graphs on the blend) inherits this protection: its own "frozen engine zero-diff" gate (`scenario.ts` AND `scenario.test.ts`) can extend the same pattern. The guard's forbidden-migration regex and frozen-file list are the natural extension points for Phase 30's `scenario-blend-panels.ts` convention pins.
- Full suite green; frozen engine clean; no migration shipped. Phase 29 has no silent schema change, engine drift, or RLS regression in its delta.
- One follow-up for `/gsd:verify-work` / CI: run the live `supabase/tests/test_*.sql` RLS suite against `TEST_SUPABASE_DB_URL` (the byte-unchanged half is already locally guarded).

## Self-Check: PASSED

- FOUND: `src/__tests__/phase-29-frozen-spine-guards.test.ts`
- FOUND: `src/lib/api/limiter-ordering.test.ts`
- FOUND: `.planning/phases/29-unified-composer-spine/29-05-SUMMARY.md`
- FOUND commit `640f269e` (Task 1 guard)
- FOUND commit `c5bffdb8` (Task 2 B15 deviation)

---
*Phase: 29-unified-composer-spine*
*Completed: 2026-06-23*
