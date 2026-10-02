---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 08
subsystem: testing
tags: [playwright, axe, wcag-aa, e2e, ci, supabase, seed-teardown, flow-01]

# Dependency graph
requires:
  - phase: 54-06
    provides: the 2560px ultra-wide row in the axe-app-wide VIEWPORTS matrix (now also fans out the re-enabled authed/embedded describes)
  - phase: 54-07
    provides: prior wave-3 verification wiring (no-clip-sweep already in the MA-8 list)
provides:
  - Authed + embedded + mobile + 2560 ultra-wide axe describes run hermetically in the seeded MA-8 CI job (VERIFY-02)
  - Hermetic teardown of the cross-spec-dangerous crypto-sma discovery seed (delete-by-id + bridge-owner cascade in a finally)
  - axe-app-wide.spec.ts FLOW-01 dual-wired into BOTH the unseeded and the seeded MA-8 ci.yml playwright lists
  - getCleanupAdmin() exported from cleanup-test-project.ts (prod-safe service-role admin accessor for scoped in-spec teardown)
affects: [verify-work, 54-09, future-seeded-axe-specs, milestone-v1.4-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VERIFY-02 hermetic seeded-DB: capture the cross-spec-dangerous seed's returned id, delete it by id in a finally (scoped) + cascade the throwaway owner; only the crypto-sma discovery seed is dangerous (other seeds are unique-user-scoped/inert)"
    - "FLOW-01 dual-wiring of an existing HAS_SEED_ENV-gated spec into the seeded MA-8 list while keeping it in the unseeded list (the spec's own gate decides which rows run in which context)"
    - "Scoped in-spec teardown via getCleanupAdmin() — reuse the existing prod-safe service-role client (assertNotProductionSupabaseUrl + service-role brand probe), never construct a new client in a spec"

key-files:
  created: []
  modified:
    - "e2e/axe-app-wide.spec.ts - crypto-sma seed captured + torn down in a try/finally (delete-by-id + owner cascade); the authed/embedded describes are now MA-8-wired"
    - ".github/workflows/ci.yml - axe-app-wide.spec.ts added to the seeded MA-8 list; rationale comment rewritten from 'intentionally NOT' to the VERIFY-02 hermetic re-enable"
    - "e2e/helpers/cleanup-test-project.ts - export getCleanupAdmin() (the existing guarded admin client) for scoped in-spec deletes"

key-decisions:
  - "Used delete-by-id (scoped) FIRST then cleanupTestStrategy owner-cascade for belt-and-braces hermeticity — the strategy row leaving crypto-sma is the load-bearing fix; the owner cascade is hygiene"
  - "Reused the existing prod-safe getAdmin() (exported as getCleanupAdmin) instead of constructing a new Supabase client in the spec, so assertNotProductionSupabaseUrl stays the sole path to a service-role client in tests (threat T-54-08-01)"
  - "Left the HAS_SEED_ENV self-skip + the two test.skip(!HAS_SEED_ENV) gates in place so unseeded/local runs stay green-by-skip; un-skipping = MA-8 wiring + hermetic teardown, not removing the gate"
  - "Did NOT advance the STATE plan counter (already at 10 of 11 from out-of-order parallel-wave execution); recorded the 54-08 metric/decision without regressing the position"

patterns-established:
  - "Pattern: only ONE seed in a parametrized authed axe spec is cross-spec-dangerous (the discovery crypto-sma row); tear it down by id, leave the inert unique-user seeds"
  - "Pattern: rewrite the ci.yml rationale comment when a 'dormant by design' spec is re-enabled, recording WHY it is now safe (the three v1.3 regressions and how each is closed)"

requirements-completed: [VERIFY-02]

# Metrics
duration: ~18min
completed: 2026-06-30
---

# Phase 54 Plan 08: VERIFY-02 Authed/Mobile Axe Re-enable Summary

**Re-enabled the dormant authed + embedded + mobile + 2560 ultra-wide axe describes against the seeded MA-8 DB hermetically — the one cross-spec-dangerous crypto-sma discovery seed is now torn down by id in a finally, and axe-app-wide is FLOW-01 dual-wired into the seeded MA-8 ci.yml list.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-30
- **Completed:** 2026-06-30
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- The authed standalone (`/allocations`, `/strategy/[id]/v2`, `/discovery/[slug]`, `/strategies/new/wizard`) + embedded factsheet composer axe describes now run in the seeded MA-8 CI job at Desktop + mobile + 2560 ultra-wide (the VERIFY-01 ultra-wide row from 54-06 fans out automatically). `playwright --list` enumerates all 30 rows.
- The crypto-sma discovery seed — the ONE row that broke `discovery-hide-examples-default.spec.ts` in the v1.3 attempt — is captured into `const seeded` and deleted by id in a `finally`, then the throwaway bridge-owner user is cascaded, restoring the empty crypto-sma category.
- `axe-app-wide.spec.ts` is now in BOTH the unseeded list (public rows) and the seeded MA-8 list (authed/embedded rows); the spec's `HAS_SEED_ENV` gate decides which rows run in which context (FLOW-01 dual-wire, both places satisfied).
- The ci.yml rationale comment no longer says "intentionally NOT in this seeded MA-8 list" — it records the hermetic re-enable and how each of the three v1.3 regressions is closed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Tear down the crypto-sma discovery seed (hermeticity)** - `72805fdd` (test)
2. **Task 2: Wire axe-app-wide into the seeded MA-8 list + update the rationale comment** - `218f799c` (ci)

## Files Created/Modified
- `e2e/axe-app-wide.spec.ts` - Captured `seedBridgeCandidate({crypto-sma})` into `seeded`; wrapped the discovery test's login+goto+axe body in `try`/`finally`; the `finally` issues `admin.from("strategies").delete().eq("id", seeded.strategyId)` via the prod-safe `getCleanupAdmin()` then `cleanupTestStrategy(seeded)` for the owner cascade.
- `.github/workflows/ci.yml` - Added `e2e/axe-app-wide.spec.ts` to the seeded MA-8 playwright list; rewrote the `:1294`-region rationale comment to document the VERIFY-02 hermetic re-enable (preserving the FLOW-01 dual-wire reminder at the list head).
- `e2e/helpers/cleanup-test-project.ts` - Exported `getCleanupAdmin()` (the existing guarded service-role admin accessor, unchanged behavior) so the spec can issue a scoped delete-by-id without constructing a new client.

## Decisions Made
- **Scoped delete-by-id + owner cascade (both):** the strategy row leaving the crypto-sma category is the load-bearing hermeticity fix (it is what `discovery-hide-examples-default` observes); the `cleanupTestStrategy` owner-cascade is added belt-and-braces hygiene. Both are idempotent if the row is already gone.
- **Reuse the guarded admin client (no new client in the spec):** the threat model (T-54-08-01) requires the teardown target only the TEST project. Rather than build a `createClient` in the spec, `getCleanupAdmin()` exposes the existing accessor that carries `assertNotProductionSupabaseUrl` (refuses prod ref `khslejtfbuezsmvmtsdn`) + the service-role brand probe.
- **Keep the `HAS_SEED_ENV` self-skip:** un-skipping the authed rows means wiring them into the MA-8 list + making the shared-DB run hermetic — NOT removing the env gate. The gate keeps unseeded/local CI green-by-skip and prevents false-green against login/404 pages (W-02).
- **STATE counter not advanced:** `STATE.md` already reads "Plan: 10 of 11" (parallel waves executed out of numeric order). Advancing would incorrectly push to 11 of 11. Recorded the 54-08 metric and decision without regressing the position.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `getCleanupAdmin()` from `cleanup-test-project.ts`**
- **Found during:** Task 1 (crypto-sma teardown)
- **Issue:** The plan's `<action>` requires obtaining the service-role admin client "the same way the seed helper does ... NOT a new client," and the acceptance criterion requires the teardown to use "the helper's existing admin client (with its prod-URL safety probe)." But neither `seed-test-project.ts` nor `cleanup-test-project.ts` exported its guarded `getAdmin()`. Issuing the literal scoped `delete().eq("id", seeded.strategyId)` inline (which the plan's `<verify>` regex and `key_links.via` both prescribe) was therefore impossible without either constructing a new (unsafe) client or exporting the existing guarded one.
- **Fix:** Renamed `cleanup-test-project.ts`'s private `getAdmin()` to an exported `getCleanupAdmin()` (behavior byte-identical — same `assertNotProductionSupabaseUrl` + `assertSupabaseServiceRoleKey` probes), with `getAdmin()` now delegating to it. The spec imports `getCleanupAdmin` for the scoped delete. `cleanup-test-project.ts` was not in `files_modified`; the change is the minimal, additive, prod-safe way to satisfy the plan's own "use the helper's existing admin client" constraint.
- **Files modified:** `e2e/helpers/cleanup-test-project.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx playwright test e2e/axe-app-wide.spec.ts --list` enumerates all 30 rows; faithful Task-1 acceptance check passes (captures seeded, finally present, scoped `delete().eq("id", seeded.strategyId)`, guarded admin + cascade helper, no raw `createClient` in spec).
- **Committed in:** `72805fdd` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The deviation is the minimal prod-safe way to satisfy the plan's own constraint that the teardown use the existing guarded admin client rather than a new one. No scope creep.

## Issues Encountered
- **The plan's `<automated>` verify regex for Task 1 is brittle and does not match a real implementation.** The regex `/seedBridgeCandidate[\s\S]{0,400}finally[\s\S]{0,200}delete\(\)\.eq\(.id./` anchors on the FIRST occurrence of `seedBridgeCandidate` (which is the import statement, ~7000 chars before the discovery test's `finally`) and assumes a minimal try-body, but the real `try` block legitimately contains the login+goto+expect+axe body. Both the `{0,400}` and `{0,200}` windows are exceeded by the load-bearing body and necessary comments. The teardown nonetheless satisfies EVERY Task-1 acceptance criterion verbatim (captured result, deleted by id in a `finally`, uses the helper's prod-safe admin client, only seeded rows deleted). Verified via an equivalent structural check (see Self-Check). Resolution: relied on the human-readable acceptance criteria (the binding contract) + a faithful equivalent automated check, not the over-strict regex literal.

## User Setup Required
None - no external service configuration required. The seeded MA-8 job runs only when `vars.E2E_TEST_DB_CONFIGURED == 'true'` against the dedicated TEST Supabase project (already wired); this sandbox has no network/seeded DB, so the authed rows self-skip locally by design.

## Next Phase Readiness
- ROADMAP success criterion 3 (authed/mobile axe rows re-enabled against a hermetic seeded DB) is met for the axe portion. The seeded MA-8 CI run will execute the authed/embedded/mobile/2560 rows; `discovery-hide-examples-default` + the `/demo` public rows stay green because the crypto-sma seed is torn down.
- 54-09 (VERIFY-05 design-review audit + real-device sign-off checkpoint) depends on 54-08 and is the final wave.
- A live seeded e2e run was NOT performed (no network/seeded DB in this sandbox, per the plan's acceptance — describes un-skipped behind HAS_SEED_ENV, teardown present + targets test project, ci.yml seeded list includes axe-app-wide, spec typechecks + `playwright --list` recognizes the authed/ultrawide rows). The actual seeded green/skip is the CI gate.

## Self-Check: PASSED

- `54-08-SUMMARY.md` exists.
- Commits `72805fdd` (Task 1) and `218f799c` (Task 2) exist in git.
- `e2e/axe-app-wide.spec.ts` + `e2e/helpers/cleanup-test-project.ts` present.
- Faithful Task-1 acceptance re-check passes: captures `seeded`, scoped `delete().eq("id", seeded.strategyId)`, guarded `getCleanupAdmin()` + `cleanupTestStrategy(seeded)`, no raw `createClient` in the spec.
- `npx tsc --noEmit` clean; `npx playwright test e2e/axe-app-wide.spec.ts --list` → 30 rows incl. authed standalone + embedded composer at Desktop/mobile/ultrawide.
- ci.yml: `axe-app-wide.spec.ts` in BOTH lists (4 occurrences); rationale comment no longer says "intentionally NOT"; FLOW-01 reminder at the MA-8 list head preserved; YAML parses cleanly.

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
