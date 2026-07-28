---
phase: 12-backend-metric-contracts
plan: 10
subsystem: infra
tags: [python, supabase, postgres, deploy-orchestration, kill-switch, backfill, ci]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    provides: "Plan 12-02 migrations 086 + 087 (priority enum, sibling table, M-Grok-1 batch upsert RPC); Plan 12-06 MetricsResult.sibling_kinds with 12 D-01 kinds; Plan 12-07 dispatch_tick swapped to claim_compute_jobs_with_priority RPC; Plan 12-09 cross-runtime parity tests reading TRADE_MIX_HAS_MAKER_TAKER from env"
provides:
  - "analyze_metrics_size.sql — pg_column_size p99.9 probe (post-TOAST, M-03 source-of-truth)"
  - "phase12_kill_switch.py — D-07 automation, SKIP_KILL_SWITCH=1 honored, --p999/--count CLI args (M-03), M-Grok-1 atomic batch RPC for cutover, HEAVY_KINDS = 12 D-01 kinds (equity_series_1y excluded per H-D)"
  - "phase12_backfill_enqueue.py — D-08 eager re-enqueue at priority='low' with M-02 duplicate-job pre-check guarding against post-drain re-runs"
  - "phase12_deploy.py — top-level orchestrator: M-01 TODOS.md → .env.test propagation, M-03 SQL probe → kill-switch, M-02 backfill enqueue"
  - ".env.test gitignored explicitly (Plan 12-10 acceptance grep contract)"
  - "12-CONTEXT.md <specifics> documents M-01 propagation path canonically"
  - "TODOS.md SC#4 queue-depth probe section header (data filled in at deploy time)"
affects: [phase-14a-eager-panels, phase-14b-lazy-panels, sprint-12-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "M-03 single-source-of-truth size measurement: SQL probe (pg_column_size) is the only authoritative measurement; Python json round-trip explicitly forbidden in docstrings + grep-asserted absence"
    - "M-01 TODOS.md → .env.test propagation: project-local TODOS.md is canonical; deploy script is the only writer of .env.test; grep regex `TRADE_MIX_HAS_MAKER_TAKER\\s*=\\s*(true|false)` is the contract"
    - "M-02 duplicate-job guard pre-check: pending-status count via PostgREST `count='exact'` before insert; bails with the literal log line that the acceptance grep matches"
    - "M-Grok-1 atomic batch sibling-table cutover: kill-switch uses `upsert_strategy_analytics_series_batch` RPC for transactional multi-kind upsert"
    - "argparse CLI on standalone scripts: `--p999` / `--count` floats so deploy orchestrator can pass authoritative DB-side values without re-running psql"

key-files:
  created:
    - "analytics-service/scripts/analyze_metrics_size.sql"
    - "analytics-service/scripts/phase12_kill_switch.py"
    - "analytics-service/scripts/phase12_backfill_enqueue.py"
    - "analytics-service/scripts/phase12_deploy.py"
  modified:
    - ".gitignore (explicit `.env.test` line satisfying ^\\.env\\.test$ acceptance grep)"
    - ".planning/phases/12-backend-metric-contracts/12-CONTEXT.md (M-01 propagation path under <specifics>)"
    - ".planning/phases/12-backend-metric-contracts/TODOS.md (SC#4 queue-depth probe section)"

key-decisions:
  - "Defer Task 2 production run (running phase12_deploy.py against the live DB + 12-min queue-depth window) to a checkpoint:human-verify operator action per orchestrator directive 'plan ships SCRIPTS, not the deploy itself'. Plan closes at 10/10 with all 4 artifacts committed; the operational deploy is a separate human-gated step."
  - "Use the M-Grok-1 atomic batch RPC (`upsert_strategy_analytics_series_batch`) inside `phase12_kill_switch.cutover_strategy` instead of a per-kind upsert loop. Migration 087 already ships the RPC with SECURITY DEFINER + SET search_path = public, pg_temp; mirroring the runner's batch-RPC pattern keeps the kill-switch atomically consistent per strategy."
  - "Add explicit `.env.test` line to `.gitignore` even though the existing `.env*` glob already covers it. The Plan 12-10 acceptance grep `^\\.env\\.test$` is the literal contract — explicit pin satisfies the contract; comment in `.gitignore` documents why."
  - "Place TODOS.md kill-switch trigger log entry behind a path-existence check so the script remains runnable when invoked from a deploy environment that does not have `.planning/` (e.g. a Railway one-off job)."

patterns-established:
  - "Production-action-as-checkpoint: when a plan task requires a real production action (live deploy, multi-minute monitoring), STOP at the script-shipping point and return checkpoint state for the orchestrator/operator to execute the production half. The plan's autonomous=false frontmatter is the signal."
  - "M-01 env propagation regex: `r\"TRADE_MIX_HAS_MAKER_TAKER\\s*=\\s*(true|false)\"` matched against `TODOS.md` text — used by `phase12_deploy.py._read_trade_mix_flag_from_todos`. Default 'false' on absent file or unmatched line."
  - "psql CSV output parsing pattern: `psql -tAF, -c <sql>` produces unquoted CSV; consumers split on `,`, treat empty fields as 0/None, and validate `len(parts) >= expected_cols` before parsing."

requirements-completed: [METRICS-16]

# Metrics
duration: 7min
completed: 2026-04-28
---

# Phase 12 Plan 10: Phase 12 Deploy Orchestration Summary

**Four-artifact deploy orchestration: pg_column_size SQL probe + automated kill-switch with --p999/--count CLI args + M-02-guarded backfill enqueuer + top-level orchestrator that propagates TRADE_MIX_HAS_MAKER_TAKER from TODOS.md to .env.test before running the SQL probe and chaining kill-switch + backfill in correct order.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-28T13:55:07Z
- **Completed:** 2026-04-28T14:02:25Z (approx)
- **Tasks:** 1 of 2 fully autonomous; Task 2's production-run portion deferred to checkpoint:human-verify per orchestrator directive
- **Files created:** 4 (3 in `analytics-service/scripts/`, plus `phase12_deploy.py`)
- **Files modified:** 3 (`.gitignore`, `12-CONTEXT.md`, `TODOS.md`)

## Accomplishments

- **`analyze_metrics_size.sql`** — single-source-of-truth p99.9 size probe using `pg_column_size(metrics_json)` (post-TOAST-compression, M-03 contract). CSV output schema: `p50,p95,p99,p999,max,strategy_count`.
- **`phase12_kill_switch.py`** — D-07 automation. SKIP_KILL_SWITCH=1 honored; --p999 / --count CLI args (M-03 path); falls back to direct psql subprocess re-run when invoked standalone; uses M-Grok-1 atomic batch RPC (`upsert_strategy_analytics_series_batch`) for sibling-table cutover so all 12 D-01 heavy keys per strategy upsert in one implicit transaction; HEAVY_KINDS list contains exactly the 12 D-01 sibling kinds (equity_series_1y intentionally excluded per H-D); appends a TODOS.md log entry on trigger.
- **`phase12_backfill_enqueue.py`** — D-08 eager re-enqueue at priority='low'. M-02 duplicate-job pre-check via PostgREST `count='exact'` on pending compute_analytics rows; emits the literal log line `[backfill] {N} existing pending compute_analytics jobs found — skipping to avoid duplicates` that the acceptance grep matches. Insert payload uses the actual `compute_jobs` schema (`strategy_id`, `kind`, `status`, `priority`, `next_attempt_at`, `metadata`).
- **`phase12_deploy.py`** — top-level orchestrator chaining all 4 artifacts in the M-01 → M-03 → kill-switch → M-02 order. `_read_trade_mix_flag_from_todos` regex-reads the literal TODOS.md line and propagates to `.env.test` (gitignored); `_run_sql_probe` invokes `psql` against `DATABASE_URL`/`SUPABASE_DB_URL`; passes `(p999, count)` to `phase12_kill_switch.main(...)` so the kill-switch never re-runs the probe (single round-trip).
- **`.gitignore`** — explicit `.env.test` line so the Plan 12-10 acceptance grep `^\.env\.test$` matches the literal contract. The pre-existing `.env*` glob already covered the file.
- **`12-CONTEXT.md`** — `<specifics>` documents the canonical propagation path: TODOS.md → phase12_deploy.py regex → `.env.test` → CI sources before parity tests. Without this, CI defaults to env-absent and only the 2-bucket Trade Mix path is tested even when the audit passes.
- **`TODOS.md`** — SC#4 queue-depth probe section added with the `## Phase 12 SC#4 — queue-depth probe` heading + bash invocation + table scaffold for recording the 12-minute monitoring window. Data fields filled in at deploy time.
- **Import + round-trip validation passed locally**: import-shape check confirms 12 HEAVY_KINDS (no equity_series_1y), TODOS.md regex returns the audited `false`, `_write_env_test` round-trips through replace + key-preservation correctly.

## Task Commits

Each task was committed atomically:

1. **Task 1: size probe + kill-switch + backfill enqueue scripts** — `629a998` (feat)
2. **Task 2 (autonomous portion): phase12_deploy orchestrator + M-01 propagation scaffold** — `ddd7ac3` (feat)

**Plan metadata:** committed alongside Task 2 (`.gitignore`, `12-CONTEXT.md`, `TODOS.md` queue-depth section all in `ddd7ac3`); the final docs metadata commit (SUMMARY + STATE + ROADMAP) lands separately.

_Note: Task 2 is `checkpoint:human-verify gate="blocking"`. The script-shipping portion (file artifacts + acceptance grep contracts) is fully autonomous and lands in `ddd7ac3`. The production-run portion (executing `phase12_deploy.py` against `khslejtfbuezsmvmtsdn` and recording 12 minutes of `compute_analytics` queue-depth probe data into TODOS.md) is deferred to the operator/orchestrator per the plan's `autonomous: false` frontmatter and the orchestrator directive that this plan ships SCRIPTS, not the deploy itself._

## Files Created/Modified

- `analytics-service/scripts/analyze_metrics_size.sql` — pg_column_size p99.9 probe (M-03 source-of-truth)
- `analytics-service/scripts/phase12_kill_switch.py` — D-07 kill-switch automation (M-03 + M-Grok-1)
- `analytics-service/scripts/phase12_backfill_enqueue.py` — D-08 eager re-enqueue (M-02 guarded)
- `analytics-service/scripts/phase12_deploy.py` — top-level orchestrator (M-01 + M-03 + chains the others)
- `.gitignore` — explicit `.env.test` pin
- `.planning/phases/12-backend-metric-contracts/12-CONTEXT.md` — M-01 propagation path documented under `<specifics>`
- `.planning/phases/12-backend-metric-contracts/TODOS.md` — SC#4 queue-depth probe section header

## Decisions Made

- **Production-run deferred to checkpoint:human-verify per orchestrator directive.** The orchestrator's prompt was unambiguous: "*This plan ships the deploy SCRIPTS, not the deploy itself. Do not run `phase12_deploy.py` against production. Verify the scripts are well-formed and committed.*" Plan closes at 10/10 with all 4 script artifacts committed and acceptance grep contracts satisfied; the live deploy + 12-min queue-depth recording is a separate operator action.
- **Used M-Grok-1 batch RPC (not per-kind loop) inside the kill-switch.** Migration 087 already ships `upsert_strategy_analytics_series_batch` with SECURITY DEFINER + `SET search_path = public, pg_temp`. Mirroring the runner's pattern in `analytics_runner.py` keeps the kill-switch atomically consistent per strategy — partial-success rollback is no longer possible.
- **Explicit `.env.test` line in `.gitignore` even though `.env*` already covered it.** The acceptance grep `grep -qE "^\.env\.test$" .gitignore` is the literal contract; explicit pin satisfies it. Commented in `.gitignore` so future maintainers know why the apparent duplication exists.
- **TODOS.md kill-switch trigger log gated on path existence.** Some deploy environments (e.g. Railway one-off jobs, Docker-only runs) don't ship `.planning/`. The `if TODOS_PATH.exists():` guard makes the kill-switch robust to those environments without losing the in-tree audit trail when run locally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `len(json.dumps` literal from kill-switch docstring**
- **Found during:** Task 1 verification grep (`! grep -q "len(json.dumps"`)
- **Issue:** Initial draft of `phase12_kill_switch.py` had a docstring warning `"NEVER measure via len(json.dumps(...)) — that bypasses TOAST..."` that contained the literal regex pattern the inverted grep was looking for. The grep correctly flagged the file as containing the forbidden string even though it was only in a comment.
- **Fix:** Rephrased the docstring warning to "NEVER measure via Python json round-trip — that bypasses TOAST compression and misreports by 30-50% (see M-03 in 12-REVIEWS.md)." — preserves the educational warning, removes the literal pattern.
- **Files modified:** `analytics-service/scripts/phase12_kill_switch.py`
- **Verification:** `! grep -q "len(json.dumps" ...` now returns `OK: no Python json approx`.
- **Committed in:** Folded into Task 1 commit `629a998` (the rephrasing happened before the commit landed).

**2. [Rule 2 - Missing Critical] Added `strategy_id` to backfill enqueue insert payload**
- **Found during:** Task 1 (`phase12_backfill_enqueue.py` action body)
- **Issue:** The plan's code skeleton in `<action>` Step 3 omitted `strategy_id` from the `compute_jobs` insert payload — only set `kind`, `status`, `priority`, `payload`, `next_attempt_at`. Migration 032's `compute_jobs_kind_target_coherence` CHECK constraint requires `kind IN ('sync_trades', 'compute_analytics') AND strategy_id IS NOT NULL`, so the insert would have failed at the DB layer.
- **Fix:** Added `"strategy_id": strategy_id` to the insert dict (already in scope from the loop variable). Renamed `payload` → `metadata` to match the actual column name on `compute_jobs` (`metadata JSONB`, line 136 of migration 032; there is no `payload` column).
- **Files modified:** `analytics-service/scripts/phase12_backfill_enqueue.py`
- **Verification:** Schema review of migration 032 STEP 2 confirms columns; import-shape sanity check passed.
- **Committed in:** Folded into Task 1 commit `629a998`.

**3. [Rule 3 - Blocking] Used `services.db` (real module) instead of plan's placeholder `services.supabase_client` / `services.db_execute`**
- **Found during:** Task 1 (writing the Python imports)
- **Issue:** The plan's code skeleton imported from `services.supabase_client` and `services.db_execute` with the comment "adjust to actual module path". The actual canonical path in the codebase is `services.db` (single module exposing both `get_supabase` and `db_execute`, verified via `grep -rn "def get_supabase|def db_execute"`).
- **Fix:** Both imports now read `from services.db import db_execute, get_supabase` — same pattern `main_worker.py` uses on line 47.
- **Files modified:** `analytics-service/scripts/phase12_kill_switch.py`, `analytics-service/scripts/phase12_backfill_enqueue.py`
- **Verification:** Import-shape sanity check from analytics-service directory succeeded with stub env vars.
- **Committed in:** Folded into Task 1 commit `629a998`.

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing critical, 1 blocking)
**Impact on plan:** All three were grep-contract / DB-schema correctness fixes. No scope creep — every other detail of the plan executed verbatim including the M-01 / M-02 / M-03 / M-Grok-1 reviewer directives.

## Issues Encountered

- **First commit invocation hit `.gitignore` advice** when also adding the `.planning/` paths. The repo already tracks `.planning/phases/12-backend-metric-contracts/TODOS.md` (verified via `git ls-files`), so the staging worked but the visible advice noise made the first commit attempt look like it failed. Recovered by re-running `git commit` against the already-staged tree.

## User Setup Required

**External services require manual configuration.** Plan 12-10 ships the deploy *scripts* but not the deploy *run*. To complete the operational rollout:

1. **Run the deploy orchestrator against production** (operator action):
   ```bash
   cd /Users/helios-mammut/claude-projects/quantalyze/analytics-service
   export DATABASE_URL="<production SUPABASE_DB_URL>"
   python -m scripts.phase12_deploy
   ```
   Expected output should include:
   - `phase12_deploy: wrote TRADE_MIX_HAS_MAKER_TAKER=false to /…/.env.test`
   - `phase12_deploy: SQL probe — p99.9 = ... bytes across N strategies`
   - `phase12_kill_switch: probe — p99.9 = ... bytes ... [M-03: pg_column_size, DB-side only]`
   - `phase12_kill_switch: p99.9 < threshold — no cutover needed.` (assuming sub-800kB)
   - `phase12_backfill_enqueue: enqueueing N published strategies as priority='low'` (or M-02 skip notice if pending jobs exist)

2. **Record the 12-minute queue-depth probe in `TODOS.md`** (Phase 12 SC#4):
   ```bash
   cd /Users/helios-mammut/claude-projects/quantalyze
   export SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set this from local env}"
   supabase db remote query "SELECT priority, status, count(*) FROM compute_jobs WHERE kind='compute_analytics' AND status='pending' GROUP BY priority, status ORDER BY priority;"
   ```
   Run every 60s for ~12 minutes. Expected: total `compute_analytics` pending count never exceeds 50 for >10 min. Record the timeline in the existing `## Phase 12 SC#4 — queue-depth probe` table in TODOS.md.

3. **If queue depth ≥ 50 for >10 min:** SC#4 fails. Escalate — check `claim_compute_jobs_with_priority` RPC + worker logs. Do NOT mark Phase 12 complete.

## Next Phase Readiness

- **Phase 12 (backend-metric-contracts) is now feature-complete at the source level** — all 10 plans shipped, all 17 METRICS-XX requirements satisfied at the artifact level, both new migrations (086 + 087) applied to remote, both runtimes (Python + TS) parity-tested 5/5 green.
- **Operational rollout (this plan's deferred half)** — running `phase12_deploy.py` + recording the SC#4 queue-depth window — can happen any time after this plan closes. Phase 14a does NOT block on the deploy because Phase 14a only consumes the SQL contract (frozen TS types, sibling-kind set, RPC signatures) which all landed in earlier plans.
- **Phase 14a is unblocked** (eager panels 1–3 + identity baseline). The frozen contracts are: 12 D-01 sibling kinds, 33 FROZEN_TRADE_METRICS_KEYS (D-16), `panel_id` enum on `fetch_strategy_lazy_metrics`, the 2-bucket Trade Mix shape (TRADE_MIX_HAS_MAKER_TAKER=false). Phase 14a path-extracts above-the-fold scalars from `metrics_json` directly + reads heavy series via the lazy RPC.

## Self-Check: PASSED

All claimed files exist on disk and all claimed commits are reachable in git history.

- analytics-service/scripts/analyze_metrics_size.sql: FOUND
- analytics-service/scripts/phase12_kill_switch.py: FOUND
- analytics-service/scripts/phase12_backfill_enqueue.py: FOUND
- analytics-service/scripts/phase12_deploy.py: FOUND
- .planning/phases/12-backend-metric-contracts/12-10-SUMMARY.md: FOUND
- .gitignore: FOUND (modified)
- 12-CONTEXT.md: FOUND (modified)
- TODOS.md: FOUND (modified)
- Commit 629a998: FOUND
- Commit ddd7ac3: FOUND

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
