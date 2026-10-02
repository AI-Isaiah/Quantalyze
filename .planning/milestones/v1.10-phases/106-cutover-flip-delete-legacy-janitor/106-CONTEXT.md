# Phase 106: Cutover — flip + delete legacy + janitor (106-PROPER) — Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** research (opus) → discuss-phase (fable second-mind, research-first) → prod-state MCP audit → 1 user decision (rollback posture)

<domain>
## Phase Boundary — THE SPLIT (adopted)

Phase 106 is the prod-risk CUTOVER, split by reversibility (locked):
- **106 (this CONTEXT)** = flip/ratify BOTH backbone flags + retire ALL dark-path re-entry points + delete the dark path + `computing`-janitor cron + `after()` fail-loud + the M2 ordering fix. **Reversible-until-delete, NO store DDL.**
- **106.1** = the series-store fold DDL (rename `csv_daily_returns`→`daily_returns` + `basis` col, fold MTM/cash kinds in). Irreversible prod DDL, GDPR/RLS, an UNSOLVED metadata-home problem (the MTM store carries SC-4 round-trip JSONB — `densify_policy`/`nan_dates`/`gap_spans`/`conventions`/benchmark-identity — a flat tall-table row can't hold). Own research→discuss→plan cycle.
- **106.2** = `metrics_snapshot` retirement (3 reader repoints) + the deferred lead-capture teaser series ([[project_teaser_series_persist_for_lead_contact]]). Product feature, own cycle.

**NON-NEGOTIABLE:** the reversible flip+delete (106) stays firmly separate from the irreversible fold DDL (106.1).

## PROD-STATE AUDIT (MCP, prod project `khslejtfbuezsmvmtsdn`, 2026-07-14 — the flip is a RATIFICATION)
- `feature_flags.process_key_unified_backbone = 'on'` since **2026-05-25**. The unified backbone has been live in prod ~7 weeks.
- `compute_analytics` jobs: **45 all-time, LAST one 2026-05-27 → ZERO in the trailing 30 days (48 days cold)**. The dark path is provably unused in prod. **Fable's empirical Stage-B gate is ALREADY GREEN** (re-run at Stage-B time to confirm still green).
- Queue empty (no pending/running/failed_retry/done_pending_children).
- Those 45 historical rows EXIST → confirms the kind-teardown migration would fail (D3).
- ✅**ENV VALUES RESOLVED (CLI, 2026-07-14 — Blocker 1 CLEARED):** `USE_COMPUTE_JOBS_QUEUE="true"` (Vercel prod), `PROCESS_KEY_UNIFIED_BACKBONE="on"` (Vercel + Railway), `BROKER_DAILIES_VIA_FUNDING` UNSET in Railway → code default `true` (`job_worker.py:186`). **The entire prod stack is already on the unified path** → Stage A is a pure RATIFICATION (values are already what we'd pin). **The D6 wrong-money falsifier is CLEARED:** `BROKER_DAILIES_VIA_FUNDING=true` means the dark `compute_analytics` branch (`job_worker.py:1520` else) is NOT taken in prod → deleting the dark path shifts NO funding numbers. Wave-0 still re-verifies + pins (belt-and-braces) before Stage B.
</domain>

<decisions>
## Implementation Decisions (LOCKED — do not re-open in planning)

### D1 — Rollback posture: the net DIES WITH THE DELETION (USER DECISION 2026-07-14)
Staged, in order:
1. **Stage A (flip-ratify):** audit + pin both envs (Vercel + Railway); kill-switch row + `flag-monitor` auto-flip stay LIVE; dark path stays PRESENT. Full E2E (8 basis×connector cells + onboarding teaser + allocator per-key read + a resync). Rollback is REAL here (there's still a path to roll back to).
2. **Stability window** gated by the empirical check (D6): zero `compute_analytics` prod traffic (already 48 days cold).
3. **Stage B (retire + delete, ONE PR):** retire ALL re-entry points → delete dark path + legacy arms → convert every `isUnifiedBackboneActive()===false` / `USE_COMPUTE_JOBS_QUEUE` false arm to fail-loud 503 (or delete the read where the unified arm is unconditional) → **in the SAME PR neuter `flag-monitor`'s auto-flip to ALERT-ONLY** (keep the error-rate email) + repoint/retire `phase19-error-rollup/route.ts:41` (2nd row reader). The kill-switch row, its readers, and its monitor die together with the arms they controlled. **Post-Stage-B rollback = `git revert` + redeploy** (honest — the only real rollback once the alternative is deleted). Rejected: keeping the net armed through 106.1 (arms the auto-rollback-INTO-outage trap during the DDL window).

### D2 — Flag semantics (fable-verified)
- `USE_COMPUTE_JOBS_QUEUE` (env, TS-only, ZERO Python readers): its `false` branches are NOT a working legacy alternative (`csv-finalize:684` failed-placeholder, `finalize-wizard:890-904` 503, `keys/sync:183-192` 503; only `legacyKeysSyncHandler`'s after() arm is real, and doubly dormant). **Pin permanent-on and DELETE its branches** — guards nothing worth keeping.
- `process_key_unified_backbone` = the kill-switch (dies in Stage B per D1). `process_key.py:545` hard-503s when off (an OUTAGE post-deletion, not a rollback — hence D1).

### D3 — Kind teardown: RPC admission guard, NOT a CHECK/registry drop (Blocker-2 fix, prod-confirmed)
- 45 historical `compute_analytics` rows exist in prod → `DELETE FROM compute_job_kinds` is FK-blocked and `ALTER TABLE ... ADD CONSTRAINT CHECK` validates existing rows → the naive migration FAILS mid-deploy (auto-applies to prod).
- **Leave the `compute_job_kinds` registry row + both CHECKs (`compute_jobs_kind_check`, `compute_jobs_kind_target_coherence`) admitting the kind.** Put the fail-loud guard in `_enqueue_compute_job_internal` (RPC-level rejection of retired kinds — a `CREATE OR REPLACE`, reversible, validates no existing rows) + a grep-gate test. Reject idiom = `RAISE EXCEPTION ... USING ERRCODE='invalid_parameter_value'` (copy `20260510180226:190`). ⚠️**RE-BASE CORRECTION (pattern-mapper):** the LATEST RPC body is `20260510180226:164`, NOT `20260710130000:53,:85` (those are CHECK DDL). **TWO overloads coexist** (7-param + 10-param `20260420073003:330`) — the guard must land in the dispatched one(s); re-base on both if both are live. Migration-reviewer + rls-policy-auditor + test-project MCP catch-up before merge.

### D4 — Dark-path deletion ORDER (ZOMBIE trap — retire ALL before deleting the core)
pin `BROKER_DAILIES_VIA_FUNDING` (default already true `job_worker.py:185-187`) → delete `scripts/phase12_backfill_enqueue.py` (+ `phase12_deploy.py:350-353`) → delete BOTH funding ternaries (`job_worker.py:1519-1521` AND **`cron.py:450-452` — the 5th site, live**) → delete `legacyKeysSyncHandler` (`keys/sync/route.ts:526`, sole `computeAnalytics` caller `:619`) → delete `routers/analytics.py` + dispatch arm (`job_worker.py:5830-5831`) + `run_compute_analytics_job` (`:1590-1608`) + `TIMEOUT_PER_KIND` entry (`:262`) + **`main_worker.py:140` watchdog map (6th residue)** → grep-gate ZERO `run_strategy_analytics` callers (only 2 today: `routers/analytics.py:24`, `job_worker.py:1607`) → delete `analytics_runner.py:1208` chain. Cosmetic residue: `ComputeJobsTable.tsx:62`, `types.ts:1582`. In-flight/poisoned rows are NOT a zombie (unknown-kind dispatch → permanent FAILED `:5870-5882`; enqueue FK-fails on `compute_jobs.kind`).

### D5 — M2 ordering fix (in 106-proper; zero-DDL swap)
Move the single-key broker-derive seam's DONE-gating MTM scalar prestamp (`job_worker.py:3163-3175`) to AFTER both `persist_basis_series` calls (`:3188-3201` MTM, `:3268-3275` cash) — reversing the partial-write window into the self-healing "fresh-series + stale-scalar" direction (mirror the composite path `:4717-4762`). No data dependency between the writes; no reader consumes the prestamp between them. Does NOT need the finalize-RPC (strict atomicity stays deferred to ride 106.1). Fix the stale composite comment (`:4747` claims to match single-key `:3112-3136` — that anchor drifted; the current single-key order contradicts it). Update any single-key sibling test that pins scalar-first order (expected red → fix with the swap).

### D6 — SC-4 & the empirical Stage-B gate
The flip is a RATIFICATION (unified on since 2026-05-25) → SC-4 byte-identity risk lives in the DELETIONS, not the flip. Each flag `false` arm must be PROVEN dormant before deletion; the `true`-path stays byte-identical. **Empirical Stage-B gate:** re-run the prod query `SELECT count(*) FROM compute_jobs WHERE kind='compute_analytics' AND created_at > now()-interval '30 days'` == 0 (currently 0) immediately before Stage B. ⚠️Risk falsifier: if Railway has `BROKER_DAILIES_VIA_FUNDING=false` (runtime state — the Wave-0 env audit resolves this), deleting the dark path changes funding-inclusive vs -excluding numbers (a wrong-money regression). Re-test surface = 8 basis×connector cells + onboarding sync-teaser + per-key allocator dashboard + a resync.

### D7 — Janitor + after() fail-loud
Promote `scripts/reset_stuck_computing_rows.py` to a recurring `routers/cron.py` tick (10-15 min; threshold > the max per-kind watchdog ceiling ~20-25 min per `main_worker.py:140`; idempotent — skip-if-active-job + conditional update on `computation_status='computing'`). `after()` fail-loud wraps the unified-arm `after()` bodies in `csv-finalize`/`finalize-wizard` — the 4 console.warn-only `after()` paths are `csv-finalize:658,:662,:711,:718` (copy the `captureToSentry` idiom at `:620`). ✅**The janitor race is ALREADY CLOSED (pattern-mapper):** coherence CHECK `20260710130000:93` forces `process_key_long` rows to carry a NON-NULL `strategy_id` COLUMN (resolution at `services/ingestion/long_fetch.py:200`, not `:497`), which the existing `.eq("strategy_id", sid)` active-job probe matches → KEEP the column probe, do NOT extend to metadata.

### Claude's Discretion
- Wave shape (Wave 0 = env audit + pin; then re-entry retirement → dark-path delete → janitor/M2 as the risk order allows).
</decisions>

<canonical_refs>
## Canonical References (downstream agents MUST read)
- Flags: `src/lib/feature-flags.ts:95,105`, `src/app/api/cron/flag-monitor/route.ts:233-241`, `src/app/api/cron/phase19-error-rollup/route.ts:41`, `analytics-service/routers/process_key.py:545`, `analytics-service/main_worker.py:394`, `long_fetch.py:61-80`.
- Dark-path + re-entry: `analytics-service/services/job_worker.py` (:185, :1519-1521, :3163-3275, :4717-4782, :5830-5882, :1590-1608, :262), `routers/cron.py:450-452`, `routers/analytics.py:24`, `analytics_runner.py:1208`/`:1678`, `scripts/phase12_backfill_enqueue.py`, `phase12_deploy.py:350-353`, `main_worker.py:140`, `src/app/api/keys/sync/route.ts:526,615-619`.
- Kind teardown: `_enqueue_compute_job_internal`, `supabase/migrations/20260710130000_stitch_composite_kind.sql:53,:85` (re-base target), `20260411144407_compute_jobs_queue.sql:110-121`.
- Janitor: `analytics-service/scripts/reset_stuck_computing_rows.py`, `routers/cron.py`.
- 106-RESEARCH.md (full map) + 106-DISCUSS assumptions (in this session's transcript).
</canonical_refs>

<specifics>
## Standing constraints (LOCKED)
- Migrations auto-apply to PROD on merge → the ONLY DDL in 106-proper is the D3 `CREATE OR REPLACE` RPC guard (reversible, validates no rows); migration-reviewer + rls-policy-auditor + test-project MCP catch-up. NO store DDL here (that's 106.1).
- SC-4 byte-identity of every existing factsheet survives; supabase-migrate auto-on-push → watch the run + verify objects.
- NO git branch ops in subagents (only `git add <explicit paths>`, never `-A`/`.planning/`); executor has NO Supabase MCP.
- Wait-for-CI GREEN-first-try before the Railway deploy; verify `railway deployment list` commitHash + `/health`.
</specifics>

<deferred>
## Deferred
- Series-store fold DDL (Tier-2 #3 EXECUTION) → **Phase 106.1** (own cycle; the metadata-home for MTM's SC-4 round-trip JSONB is unsolved).
- `metrics_snapshot` retirement + 3 repoints + lead-capture teaser series → **Phase 106.2**.
- Strict-atomicity finalize SECDEF RPC → rides 106.1's fold migration if wanted (M2 here is order-only, no RPC).
</deferred>

---
*Phase: 106-cutover-flip-delete-legacy-janitor (106-PROPER)*
*Context locked 2026-07-14 via research → discuss-phase (fable) → prod-state MCP audit → user decision (rollback net dies with the deletion). Split adopted: 106 / 106.1 (fold DDL) / 106.2 (metrics_snapshot + lead-capture).*
