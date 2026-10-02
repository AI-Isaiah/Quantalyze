---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 10
subsystem: infra
tags: [feature-flags, cron, kill-switch, backbone-unification, stage-b, grep-gate]

# Dependency graph
requires:
  - phase: 106-09
    provides: dark run_strategy_analytics chain deleted; permanent grep-gate test_dark_path_deleted.py
provides:
  - flag-monitor cron is ALERT-ONLY (never writes the feature_flags kill-switch row)
  - phase19-error-rollup cron retired (route + vercel.json entry gone)
  - kill-switch readers deleted (isUnifiedBackboneActive / is_unified_backbone_active)
  - /process-key runs unconditionally (flag-off 503 arm deleted)
  - main_worker claim stamp passes constant true (claim-RPC signature UNTOUCHED, no DDL)
  - grep-gate extended to the retired rollback net + cosmetic compute_analytics residue
affects: [106 Stage-B ship gates, backbone-unification, ops rollback runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Alert-only monitor: error-rate threshold -> email, never a state write"
    - "Permanent-on flag: reader deleted, constant literal replaces the read, RPC signature preserved"

key-files:
  created: []
  modified:
    - src/app/api/cron/flag-monitor/route.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - analytics-service/routers/process_key.py
    - analytics-service/main_worker.py
    - analytics-service/tests/test_dark_path_deleted.py
    - vercel.json

key-decisions:
  - "phase19-error-rollup RETIRED outright (its day-index premise died with the kill-switch row) rather than repointed"
  - "flag-monitor kept as the ongoing error-rate alerter, reworded honestly (auto-rollback retired, investigate manually)"
  - "main_worker passes constant true into the claim RPC — signature/metadata-stamp byte-identical; NO DDL, NO migration"
  - "kill-switch feature_flags DB row NOT deleted by code (no DDL/DML); becomes inert with zero readers"
  - "POST-STAGE-B ROLLBACK = git revert + redeploy (D1)"

patterns-established:
  - "Retire-with-the-arms: a rollback net + its monitor + its readers die together with the arms they controlled"

requirements-completed: [BB-03]

# Metrics
duration: ~55min
completed: 2026-07-15
---

# Phase 106 Plan 10: Stage B Wave 7 (FINAL) — Rollback Net Removal Summary

**The unified backbone is now MANDATORY: the flag-monitor auto-flip and error-rollup cron are retired, both kill-switch readers are deleted, and /process-key runs unconditionally — no code can route onto a path that no longer exists.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-15T12:40:00Z
- **Completed:** 2026-07-15T13:20:00Z
- **Tasks:** 3 (Task 1 TDD)
- **Files modified:** 30 (incl. 7 deletions)

## Accomplishments
- flag-monitor cron converted to ALERT-ONLY — the kill-switch upsert + D-3 PGRST fallback are gone; `triggerAutoRollback` → `sendErrorRateAlert`; the ALERT email is reworded honestly (auto-rollback retired Phase 106, investigate manually). The ZERO_DENOM_STREAK upsert + H-2 email + WARN email all survive unchanged.
- phase19-error-rollup cron retired entirely: route dir deleted, vercel.json cron entry removed, cron-limits inventory test updated.
- Kill-switch readers deleted in both runtimes: `src/lib/feature-flags.ts` + `analytics-service/services/feature_flags.py` (plus their dedicated tests). Every residual comment/mock swept so the whole-tree grep-gates are zero.
- `/process-key` flag-off 503 (`UNIFIED_BACKBONE_DISABLED`) arm deleted → body runs unconditionally.
- `main_worker.py` `flag_active` is now a literal `True` — **claim-RPC signature UNTOUCHED, NO DDL, NO migration written**.
- Cosmetic `compute_analytics` JobKind residue removed (admin table + types).
- `test_dark_path_deleted.py` grep-gate extended with a Stage-B (D1) TS scan.

## Task Commits

1. **Task 1 (RED): flag-monitor alert-only expectations** — `e729ffad` (test)
2. **Task 1 (GREEN): flag-monitor alert-only; phase19-error-rollup retired** — `ce32afbd` (feat!)
3. **Task 2: kill-switch readers deleted; process-key unconditional** — `b7e2723a` (feat!)
4. **Task 3: cosmetic residue + extended grep-gate + full-suite fallout** — `ac91aff1` (feat)

## Verify Gate Results

- **Task 1** (`vitest flag-monitor + cron-limits` && `! test -d phase19-error-rollup` && `! grep phase19-error-rollup vercel.json`): **48 tests passed → NET-RETIRED ✓**
- **Task 2** (`! git grep isUnifiedBackboneActive -- src` && `! git grep is_unified_backbone_active -- services routers main_worker.py` && full pytest): **both greps ZERO; pytest 3672 passed ✓**
- **Task 3** (`pytest test_dark_path_deleted.py` && `vitest --coverage` && `tsc --noEmit`): **gate 7 passed; suite green; tsc clean ✓**

## Four Stage-B Exit Gates

| Gate | Result |
|------|--------|
| `python -m pytest` (full) | **3672 passed, 93 skipped, 0 failed** |
| `npx vitest run --coverage` | **8131 passed, 0 failed, 287 skipped.** Coverage All files: stmts 84.47 / branch 77.75 / funcs 81.46 / lines 86.6 — all above thresholds (80/72/74/82), no threshold error |
| `npx tsc --noEmit` | **clean** (after removing stale gitignored `.next/types` + `.next/dev/types` route-validators that referenced the deleted route; CI regenerates them via `next build`) |
| `npm run lint` | **0 errors** (1 pre-existing warning in untouched `EquityChart.tsx`); route-contract + admin-manifest checks OK |

### Four Stage-B Exit Greps (zero live-code re-entry)

| Token | Result |
|-------|--------|
| `USE_COMPUTE_JOBS_QUEUE` (src) | **ZERO** |
| `run_strategy_analytics` (non-gate) | zero live code — matches only CHANGELOG (history), applied migrations, planning docs, permanent grep-gate test files, and JSDoc comments. Comment-stripped `test_dark_path_deleted.py` asserts 0 on the live Python compute surface and passes |
| `legacyKeysSyncHandler` | zero live — only the grep-gate test's own assertion string |
| `BROKER_DAILIES_VIA_FUNDING` | zero live — only CHANGELOG (history), an applied migration comment, and one JSDoc comment in `composite-read-path.ts` |

## flag-monitor alert-only diff (summary)

- **Removed:** the kill-switch `feature_flags` upsert (`value: "off"`), the D-3 PostgREST-resolution fallback catch, the `isPostgrestResolutionError` helper, and the now-unused `KILL_SWITCH_KEY` const.
- **Renamed:** `triggerAutoRollback` → `sendErrorRateAlert`; no longer takes `admin`/`now`.
- **Reworded:** ALERT email subject/body — no rollback claim; states auto-rollback retired (Phase 106), directs to manual investigation; runbook kept. Return envelope `action: "rolled_back"` → `action: "alerted"`.
- **KEPT unchanged:** ZERO_DENOM_STREAK upsert (different row), H-2 zero-denominator SEV-2 email, WARN email, all Sentry-fetch resilience + rate-limit handling.

## Claim-RPC / DDL confirmation

**The claim RPC (`claim_compute_jobs_with_priority`) signature was NOT touched and NO migration was written.** `main_worker.py` replaces `flag_active = await is_unified_backbone_active()` with a literal `True` plus the comment "Phase 106: backbone permanent-on; param retained — claim-RPC signature unchanged, NO DDL in 106-proper". `p_unified_backbone_active` still flows into the RPC, passed constant true, so the migration-104 metadata stamp is byte-identical to prod's 7-week steady state.

## Kill-switch DB row disposition

The `feature_flags` `process_key_unified_backbone` row is **NOT deleted by this plan** (no DDL/DML). With both readers gone it is now inert (zero readers) — the orchestrator may clean it up manually post-merge.

## Deviations from Plan

The plan's per-task file lists cover the arms/readers/comment sweep. The full-suite exit gate surfaced additional broken references caused directly by the reader deletion; these are Rule 3 auto-fixes (blocking issues from my own changes) and Rule 1/3 scope cleanups:

**1. [Rule 3 - Blocking] Deleted obsolete `tests/integration/cron-flag-monitor-rollback-e2e.test.ts`**
- **Found during:** Task 2 tsc gate.
- **Issue:** The whole file validated the retired auto-rollback (kill-switch flip, D-3 fallback, D-4 cache TTL parity) and imported both now-deleted `feature-flags` modules.
- **Fix:** Deleted the file wholesale (behavior no longer exists).
- **Commit:** `b7e2723a`

**2. [Rule 3 - Blocking] Updated `tests/integration/process-key-thin-adapters.test.ts`**
- **Found during:** Task 2 tsc gate (imported deleted `@/lib/feature-flags`).
- **Fix:** Dropped the dead `isUnifiedBackboneActive` vi.mock + import + all 21 `mockResolvedValue(true)` lines; the routes still delegate unconditionally to `/process-key`, so the assertions hold.
- **Commit:** `b7e2723a`

**3. [Rule 3 - Blocking] Converted `tests/integration/cron-flag-monitor.test.ts` to alert-only**
- **Found during:** Task 3 full `vitest --coverage` gate (4 tests asserted flip/D-3).
- **Fix:** Flip cases → alert-only (`action: "alerted"`, zero kill-switch writes); deleted the D-3 PGRST-fallback test + its now-dead `featureFlagsUpsertImpl` mock plumbing; retired `PHASE_19_STABILITY_CACHE_TTL_S` from the env-save list.
- **Commit:** `ac91aff1`

**4. [Rule 3 - Blocking] Removed dead env vars from `.env.example`**
- **Found during:** Task 3 full `vitest` gate (the `env-manifest` contract test failed).
- **Issue:** `PROCESS_KEY_UNIFIED_BACKBONE` + `PHASE_19_STABILITY_CACHE_TTL_S` are read nowhere after the reader deletion (both src and analytics-service = zero).
- **Fix:** Removed both blocks; reworded the still-live `SENTRY_API_BASE` comment off the retired auto-rollback/soak-gate wording.
- **Commit:** `ac91aff1`

**5. [Rule 1 - Cleanup] Removed dead `STATE.unifiedBackboneActive` scaffolding in `finalize-wizard/route.test.ts`**
- **Issue:** The field (and ~20 assignments) backed the deleted flag mock and was already dead since 106-07 (the route stopped calling the reader then). Deleting the mock left it wholly unread.
- **Fix:** Removed the field + all assignments; reworded the associated comments.
- **Commit:** `b7e2723a`

**6. [Rule 3 - Blocking, env-only] Removed stale gitignored `.next/types` + `.next/dev/types`**
- **Issue:** The generated Next route-validators still referenced the deleted `phase19-error-rollup/route.js`, breaking local `tsc`.
- **Fix:** Removed the stale generated dirs (not committed — `.next` is gitignored; CI regenerates them via `next build`).

### Scope decisions (NOT changed, by design)
- **Historical records left intact:** CHANGELOG.md, applied `supabase/migrations/**`, and `.planning/**` reference `phase19-error-rollup` / `run_strategy_analytics` / `BROKER_DAILIES_VIA_FUNDING` as history — rewriting them would corrupt the ledger. The Task 1 verify gate only checks `vercel.json` + the route-dir deletion, confirming no whole-tree zero-grep was intended for `phase19-error-rollup` (unlike the four exit greps, which are satisfied on live code).
- **Out-of-scope live comments left:** `scripts/verify-no-legacy-writes.sh` (legacy-verification helper, not in `files_modified`) and JSDoc comments in `SyncProgress.tsx` / `composite-read-path.ts` mention retired tokens; they are comments (grep-gate-stripped) and out of this plan's file boundaries.

## POST-STAGE-B ROLLBACK

**`git revert + redeploy` (D1, honest).** There is no runtime kill-switch anymore — the row is inert, its readers are deleted, and the arms it controlled are gone. Any regression is reverted by reverting the Stage-B commits and redeploying.

## Self-Check: PASSED
- flag-monitor route.ts alert-only, phase19-error-rollup deleted, readers deleted — verified below.
- All 4 task commits exist on `feat/106-stage-b-cutover-delete-legacy`.
