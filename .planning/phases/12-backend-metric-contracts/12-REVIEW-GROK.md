# Phase 12 Plan Review - Grok 4-1 Fast Reasoning (3-persona)

**Generated:** 2026-04-27T12:27:55.214469
**Model:** grok-4-1-fast-reasoning
**Prompt tokens:** 54809
**Completion tokens:** 1749
**Note:** RESEARCH.md (70KB) was summarized inline due to xAI gateway size limit.

---

# Phase 12 Plan Bundle Review

## PERSONA A: Critical Eng Reviewer
**Feasibility**: High feasibility overall—additive math on existing pandas/quantstats stack, no new deps. Waves are coherent: schema (12-02) blocks writers (12-06); math TDD (12-03/04/05) before orchestrator (12-06); throttle swap (12-07) independent post-schema. Deploy scripts (12-10) are thin wrappers, runnable post-schema.

**Race conditions**: 
- 12-10 backfill enqueue blasts ~20 `compute_jobs` inserts concurrently—risk of duplicate key errors if unique constraint on `(strategy_id, kind)` exists (migration 032 not shown, but assumed). LOW: Idempotent re-run ok, but add `on_conflict_do_nothing` to insert.
- 12-06 sibling upsert loop (12 RPCs/strategy): No txn wrapper—partial failure leaves partial kinds. MEDIUM: Wrap loop in single txn via raw SQL `BEGIN; ... COMMIT;`.

**Edge cases**:
- 12-01 is_maker audit: Handles <99% gracefully (2-bucket fallback), but regen_golden.py (12-09) hard-codes fills with `is_maker`—mismatches real data if fallback. LOW: Fixture simulates both modes via env.
- 12-04 turnover_series: `nav <=0` → 0.0 good; missing dates/symbols skipped. Good coverage.
- 12-09 fixture: Synthetic fills lack full position_recon inputs → `exposure_series`/`turnover_series` empty in expected.json. Parity test passes but SC#1 "no NULLs" risks real data NULLs. HIGH: regen_golden.py must simulate positions_by_date/prices/nav_by_date to populate all 12 kinds.

**Error paths**:
- 12-02 migrations: Self-verifying DO $$ good.
- 12-06 runner: No error handling if sibling upsert fails (e.g., JSONB too large)—metrics_json writes succeed, sibling partial. MEDIUM: Add try/except per upsert, log + retry.
- 12-10 kill-switch: Per-strategy atomic good, but client-side p99.9 approx via `len(json.dumps())` ≠ `pg_column_size`. LOW: Use raw SQL probe.

**Idempotency**: Upserts ON CONFLICT everywhere (12-06, kill-switch). Backfill re-enqueue idempotent if worker dedups.

**Executor coherence**: 12-05 Trade Mix branches on TODOS.md flag—12-09/10 read env from it, but no enforcement (e.g., deploy sets env). LOW: 12-10 deploy.py must parse TODOS.md → env.

**Findings**:
- **BLOCKER**: None.
- **HIGH**: 12-09 regen_golden.py: Missing position simulation → incomplete `exposure_series`/`turnover_series` in fixture; parity falsely passes on real NULLs (cite D-01 12 kinds, SC#1 no NULLs).
- **MEDIUM**: 12-06 sibling loop: No txn wrapper (partial writes); 12-10 kill-switch: Approx size probe.
- **LOW**: 12-10 enqueue dupes; env flag propagation.

## PERSONA B: DBA / Schema Reviewer
Read 12-02 SQL closely.

**086_compute_jobs_priority.sql**:
- Column: `priority TEXT NOT NULL DEFAULT 'normal' CHECK (...)`—safe, no NULLs.
- Partial index: `WHERE priority IN ('normal','high') AND status='pending'`—excellent for live jobs.
- RPC `claim_compute_jobs_with_priority`: 
  - Params validated (mirror 032).
  - Atomic `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`—short locks, no long-held locks.
  - **MISSING**: `SET search_path = public, pg_temp` (prompt flag)—uses `pg_catalog` in plan, but pg_temp needed for temp tables if any. HIGH.
  - `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC, anon, authenticated`—no abuse risk (service_role only).
  - No RLS recursion (compute_jobs RLS existing).
- DO $$ self-verify: Covers column/index/RPC.

**087_strategy_analytics_series.sql**:
- Table: PK `(strategy_id, kind)` indexes FK; `ON DELETE CASCADE`—blast radius contained (per-strategy rows only, no chain to other tables).
- Partial index `(strategy_id, kind) WHERE payload NOT NULL`—good for queries.
- RLS `ENABLE ... deny_all USING(false) WITH CHECK(false)`—correct, no recursion.
- RPC `fetch_strategy_lazy_metrics`:
  - Visibility: `EXISTS ... auth.uid()`—tight.
  - `CASE p_panel_id` covers all 7 panels → `ANY(v_kinds)`.
  - `jsonb_object_agg` efficient (<200ms p95).
  - **MISSING**: `SET search_path = public, pg_temp` on SECURITY DEFINER. HIGH.
  - `STABLE`, `GRANT EXECUTE TO anon, authenticated`—correct exposure.
- DO $$ verifies table/index/RPC/policy.
- No unindexed FK (PK covers).

**Kill-switch (12-10)**: Per-strategy `UPDATE metrics_json` + upsert—bounded (20 rows), no unbounded UPDATE. Idempotent.

**Index strategy**: Partial indexes optimal; no bloat.

**Findings**:
- **BLOCKER**: None.
- **HIGH**: 12-02 Task1/2: Missing `SET search_path = public, pg_temp` in both RPCs (claim_compute_jobs_with_priority, fetch_strategy_lazy_metrics)—privilege escalation risk if search_path polluted.
- **MEDIUM**: None.
- **LOW**: None.

## PERSONA C: Test Engineering Reviewer
**Parity correctness**: TS correctly Reading A (schema gate on expected.json → types.ts; no math re-impl). Python math gate complete.

**Fixture reproducibility**: regen_golden.py seed=42, np.random.normal calibrated (~5% vol/0.4 Sharpe/10% DD), bytes-stable (no env deps except TRADE_MIX flag).

**CI gate scope**: ALL keys (missing/extra fail-loud via set diff in assertMetricParity)—excellent.

**False-positive risk**: 12-02 human-verify `supabase db push` + `npm run build` gates schema/TS sync. Parity tests read committed fixtures → no push bypass.

**NaN/+0/-0 handling**: Python: `math.isnan`, but no `math.copysign(1,actual)==math.copysign(1,expected)` for signed zero—+0/-0 mismatch fails as rel-eps>0. HIGH: Add signed-zero eq.

**Tolerance**: Scalars 12-sig round (good for float64), series 1e-9 rel (standard). But scalar rel-eps missing—uses exact post-round.

**regen_golden.py determinism**: Yes, but `_json_default` converts np.float → float (loses precision?); no pd.Timestamp handling in test comparator. LOW.

**Findings**:
- **BLOCKER**: None.
- **HIGH**: 12-09 Task2 Python parity: No signed-zero handling (`+0 != -0` fails rel-eps); common in returns=0 days.
- **MEDIUM**: 12-09 Task2: Scalar assert uses exact post-round (no rel-eps fallback for tiny diffs post-round).
- **LOW**: 12-09 regen: Fixture fills simplistic (no positions → empty exposure/turnover); test passes but SC#1 risks.

## SYNTHESIS
**Consolidated BLOCKER + HIGH** (reconciled):
- **HIGH (A)**: 12-09 regen_golden.py incomplete fixture (missing position sim → empty exposure/turnover; parity false-green on SC#1 NULLs).
- **HIGH (B)**: 12-02 RPCs missing `SET search_path = public, pg_temp` (sec risk).
- **HIGH (C)**: 12-09 Python parity no signed-zero eq (+0/-0 mismatch).
- **HIGH (A/C cross)**: 12-06/09 no txn on sibling loop + fixture gap → partial writes undetected.

No BLOCKERs.

**Verdict**: PROCEED WITH FIXES

---

## REVIEW COMPLETE
