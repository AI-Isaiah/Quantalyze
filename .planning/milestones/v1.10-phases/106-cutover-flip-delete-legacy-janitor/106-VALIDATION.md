# Phase 106 (106-PROPER) — Validation Map

**Written:** 2026-07-14 (planner, anchors re-grepped same session)
**Structure:** STAGE A (reversible, executes now: plans 106-01..106-05) / STAGE B (irreversible, GATED: plans 106-06..106-10, `stage: B` in frontmatter — the execute-phase orchestrator runs Stage A only and STOPS)
**Test frameworks:** pytest (`analytics-service/`, `--cov-fail-under=80`) · Vitest v8 (`src/`, blocking coverage gate lines 82/stmts 80/fns 74/branches 72) · `supabase/tests/test_*.sql` (SQL gates)

---

## Behavior → Verify map

| # | Behavior (source) | Plan | Verify (automated unless marked) | Test lives at |
|---|-------------------|------|----------------------------------|---------------|
| 1 | Flag ratification: all 3 env values already-on; code comparison strings exact (`=== "true"`, `=== "on"`, default-true) (D1 step 1, D6) | 106-01 | grep gates on `job_worker.py:186` + `feature-flags.ts:95` + reader-site census; CLI env listing best-effort (fail-loud deviation if unavailable) | inline `<verify>` greps |
| 2 | **M2 ordering**: single-key seam persists MTM series → cash series → DONE-gating `metrics_json_by_basis` prestamp → enqueue, in that order (D5) | 106-02 | RED→GREEN ordering test: recorded call sequence — prestamp upsert index > both `persist_basis_series` indexes, < enqueue RPC; payload-integrity case; sc4 2-persist count invariant unchanged | `analytics-service/tests/test_job_worker.py` (new cases) |
| 3 | **Janitor reaps**: computing row staler than 60 min (> 40-min max watchdog ceiling — drift-corrected from CONTEXT's ~20-25) with no active job → `failed` (D7) | 106-03 | pytest: reap-when-stale case | `analytics-service/tests/test_cron_router.py` |
| 4 | **Janitor race-already-closed**: live job matched via the `strategy_id` COLUMN probe → skipped. Encodes WHY: coherence CHECK `20260710130000:93` guarantees `process_key_long` rows carry the column (D7, pattern-mapper proof) | 106-03 | pytest: skip-when-active-job case (status set pending/running/done_pending_children/failed_retry); docstring carries the CHECK citation | same |
| 5 | **Janitor idempotency**: compare-and-set update filters `computation_status='computing'` — never stomps a concurrent worker flip; per-row failures don't abort the batch | 106-03 | pytest: CAS-filter assertion + fresh-rows-never-selected case | same |
| 6 | Janitor is scheduled + auth-gated: `*/15` Vercel entry → CRON_SECRET proxy → X-Service-Key Python tick | 106-03 | vitest: `vercel-cron-limits` (SUB_DAILY_ALLOWLIST) + rbac/audit/no-store route-enumeration gates + tsc | `src/__tests__/vercel-cron-limits.test.ts` et al. |
| 7 | **after() fail-loud**: each of the 4 warn-only csv-finalize after() failure paths (placeholder err/throw at `:658`/`:663`, enqueue err/throw at `:711`/`:718`) captures to Sentry with distinct step tags; warns kept (D7) | 106-04 | RED→GREEN vitest, one case per path, asserting captureToSentry payload shape (the `:620` idiom) + warn spy | `src/__tests__/csv-finalize-after-failloud.test.ts` |
| 8 | **SC-4 full E2E surface** on prod's unified path after Stage-A code: 8 basis×connector cells + onboarding sync-teaser + per-key allocator dashboard + one resync + janitor 200 spot-check (D6) | 106-05 | **MANUAL/LIVE — the one documented exception** (see §Exceptions) | checkpoint:human-verify; results appended to 106-RATIFICATION.md |
| 9 | **D3 rejection**: `_enqueue_compute_job_internal` raises `invalid_parameter_value` for `kind='compute_analytics'` in BOTH overloads (7-param `20260510180226:164` re-base + 10-param `20260420073003:330` re-base); registry row + both CHECKs still ADMIT the kind | 106-06 | (a) migration's self-verifying DO block (deploy fails if either `pg_get_functiondef` lacks the reject, or if the CHECK stopped admitting); (b) SQL gate test (RED until test-project MCP catch-up — expected); (c) shape greps (2× CREATE OR REPLACE, ≥4× retirement literal) | migration DO block + `supabase/tests/test_compute_analytics_kind_retired.sql` |
| 10 | **TS flag-branch removal**: zero `USE_COMPUTE_JOBS_QUEUE` readers in src; `legacyKeysSyncHandler` + `computeAnalytics` + `legacyVerifyStrategyHandler` gone; unified arms unconditional AND their tests pass UNCHANGED (the per-file SC-4 evidence); per-site dormancy proof in commit messages (D1/D2/D4#10) | 106-07 | `! git grep USE_COMPUTE_JOBS_QUEUE -- src` + `! git grep legacyKeysSyncHandler` + full vitest --coverage + lint | route test suites + grep gates |
| 11 | **Python re-entry retirement in the LOCKED order**: phase12 → both funding ternaries (`job_worker.py:1519`, `cron.py:451` — the 5th site) → HTTP route + dispatch arm + handler + `TIMEOUT_PER_KIND` + watchdog map; `BROKER_DAILIES_VIA_FUNDING` zero readers; `run_strategy_analytics` prod-caller count hits 0 (SC-2 precondition) (D4) | 106-08 | grep gates (zero flag refs, zero quoted `"compute_analytics"` in worker/cron/main_worker, router file absent) + full pytest w/ coverage; SC-2 caller-grep output recorded in SUMMARY | inline gates + pruned suites |
| 12 | **Dark-path grep-gate (permanent)**: 0 `run_strategy_analytics`, 0 `run_compute_analytics_job`, 0 quoted `"compute_analytics"`, 0 `BROKER_DAILIES_VIA_FUNDING`, deleted files stay deleted, TS re-entry stays dead — PLUS positive KEEP asserts (`run_csv_strategy_analytics`, `"compute_analytics_from_csv"`, `trades_to_daily_returns_with_status` present) so the gate can't over-reach (SC-2/SC-3) | 106-09 | partial-RED first (fails only on the surviving chain), fully GREEN after deletion; comment-stripped literal counts (grep-gate hygiene — mirrors `test_cash_basis_series_sc4.py:705-750`) | `analytics-service/tests/test_dark_path_deleted.py` |
| 13 | **D1 net removal**: flag-monitor NEVER upserts the kill-switch row (streak row + emails survive; email reworded honestly); phase19-error-rollup retired; kill-switch readers deleted both runtimes (process_key unconditional; main_worker constant-true, claim-RPC signature untouched — no DDL) | 106-10 | RED→GREEN flag-monitor suite (zero-kill-switch-writes assertion); `! git grep isUnifiedBackboneActive -- src`; `! git grep is_unified_backbone_active` (non-test); full pytest | `flag-monitor/route.test.ts` + grep gates |
| 14 | Cosmetic residue dead + stays dead (`ComputeJobsTable.tsx:62`, `lib/types.ts:1582`) | 106-10 | extended `test_dark_path_deleted.py` scan list (lang="ts") | same gate file |

## Nyquist audit (no 3 consecutive tasks without automated verify)

Every task in every plan carries an `<automated>` verify **except** the single
`checkpoint:human-verify` task in 106-05. Per-plan task counts and their verifies:

| Plan | Tasks | Automated verifies | Gap check |
|------|-------|--------------------|-----------|
| 106-01 | 2 | 2 (grep gates ×2) | ✔ |
| 106-02 | 1 TDD feature (3 commits) | pytest each cycle | ✔ |
| 106-03 | 2 | pytest / vitest+tsc | ✔ |
| 106-04 | 1 | vitest+tsc | ✔ |
| 106-05 | 1 | **NONE — documented exception** (below) | exception |
| 106-06 | 2 | shape greps / SQL-test existence + DO-block-at-deploy | ✔ |
| 106-07 | 3 | vitest+grep / vitest+grep / grep+coverage+lint | ✔ |
| 106-08 | 2 | grep+pytest ×2 | ✔ |
| 106-09 | 2 | partial-RED pytest / full pytest+gate | ✔ |
| 106-10 | 3 | vitest+grep / grep+pytest / gate+coverage+tsc | ✔ |

Longest run without an automated verify = the single 106-05 checkpoint (1 task) — under
the 3-task ceiling everywhere, and it is bracketed by automated waves on both sides.

## §Exceptions — the ONE manual gate (called out explicitly)

**Behavior #8 (SC-4 full E2E surface, plan 106-05) is manual/live by design and is the
phase's only non-automated verification.** Reasons of record:
1. The executor has NO Supabase MCP and no authed prod browser session; the surface is
   prod-only (live factsheets, live resync, live cron logs).
2. Precedent: a prior flag flip exposed 2 latent CSV bugs that ONLY live E2E caught
   ([[project_unified_backbone_csv_flag_flip]]) — an automated proxy would be false
   confidence, violating no-invented-data at the process level.
3. It is structurally load-bearing: this checkpoint IS the Stage-A exit gate and a hard
   Stage-B precondition (with the explicit user go + the empirical prod query).
Mitigation: the surface is fully enumerated (12 points), results are written to
106-RATIFICATION.md, and any FAIL blocks Stage B.

## Stage-B preconditions (orchestrator-held, not executor tasks)

1. Explicit user go (Stage B never auto-executes; `stage: B` + `gated: true` on all five plans).
2. 106-05 approval recorded.
3. Empirical re-run via Supabase MCP on prod (khslejtfbuezsmvmtsdn):
   `SELECT count(*) FROM compute_jobs WHERE kind='compute_analytics' AND created_at > now() - interval '30 days'` == 0 (currently 0; 48 days cold).
4. Ship gates for the ONE Stage-B PR: migration-reviewer + rls-policy-auditor on 106-06;
   test-project (qmnijlgmdhviwzwfyzlc) MCP catch-up BEFORE merge (the SQL gate test is
   RED-guarded until then); CI GREEN-first-try before the Railway deploy;
   `railway deployment list` commitHash + `/health` verification after.
5. Post-Stage-B rollback statement in the PR body: **git revert + redeploy** (D1 —
   the kill-switch net dies with the deletion; that is the honest rollback).

## Sampling cadence

- **Per task commit:** the touched-suite quick run named in each task's `<verify>`.
- **Per wave merge:** full pytest AND `npx vitest run --coverage` (both are blocking CI gates) + `npm run lint` (react-hooks errors are lint-only — project rule).
- **Stage-A exit:** the 106-05 manual surface.
- **Stage-B exit:** the four zero-greps (USE_COMPUTE_JOBS_QUEUE / run_strategy_analytics / legacyKeysSyncHandler / BROKER_DAILIES_VIA_FUNDING) + `test_dark_path_deleted.py` fully green + both coverage gates + tsc.
