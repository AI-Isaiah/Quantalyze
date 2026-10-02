# Voices Accepted — Phase 4 (Feedback Loop)

This is the change list the planner MUST fold into `04-01-PLAN.md` in voice-revision mode.

## C1 — CONSENSUS (auto-accepted)

**Finding:** Migration 063 verification is semantically weak — static text assertion passes against broken SQL; copied CTE from migration 060 is not pinned.

**Changes to PLAN.md:**
1. Add to Task 2 `<read_first>`: `analytics-service/../supabase/migrations/060_bridge_outcome_cron.sql` (the FULL CURRENT body, not the snippet quoted in RESEARCH.md).
2. Add a new test (Task 0) `test_migration_063_enqueues_only_transitioned_allocators`:
   - Seed 2 bridge_outcomes rows: row A has `returns_series` rich enough for `extract_delta` to produce a non-NULL delta for the first time; row B is still immature (extract_delta returns NULL).
   - `SELECT public.compute_bridge_outcome_deltas();`
   - Assert `SELECT COUNT(*) FROM compute_jobs WHERE kind='rescore_allocator'` equals 1 AND `allocator_id` equals row A's allocator.
   - If HAS_LIVE_DB-gated (Phase 3 D-17 precedent): mark the test `@pytest.mark.skipif(not HAS_LIVE_DB, reason="requires Postgres")` and add a mocked-Supabase counterpart.
3. Strengthen migration 063 self-verify DO block: in addition to `LIKE '%PERFORM enqueue_compute_job%'`, also assert the body contains `extract_delta(` (pins CTE signature parity with migration 060).

## D1 — APPLY A (BLOCKER, genuine SQL bug)

**Finding:** Migration 063's enqueue predicate fires on every row UPDATE touched, not just NULL→non-NULL transitions.

**Changes to PLAN.md:**
1. Rewrite migration 063's function body to capture the transitioned rowset via `RETURNING` into a CTE or PL/pgSQL array BEFORE the PERFORM loop. Concretely:
   - In the SQL body, replace the current monolithic UPDATE + downstream `SELECT DISTINCT allocator_id FROM bridge_outcomes WHERE deltas_computed_at = v_started` with a two-phase pattern:
     ```sql
     WITH transitioned AS (
       UPDATE bridge_outcomes bo
       SET delta_30d  = COALESCE(extract_delta(c.series, c.allocated_at, 30), bo.delta_30d),
           delta_90d  = COALESCE(extract_delta(c.series, c.allocated_at, 90), bo.delta_90d),
           delta_180d = COALESCE(extract_delta(c.series, c.allocated_at, 180), bo.delta_180d),
           deltas_computed_at = v_started
       FROM candidates c
       WHERE bo.id = c.id
         AND (
           (bo.delta_30d  IS NULL AND extract_delta(c.series, c.allocated_at, 30)  IS NOT NULL) OR
           (bo.delta_90d  IS NULL AND extract_delta(c.series, c.allocated_at, 90)  IS NOT NULL) OR
           (bo.delta_180d IS NULL AND extract_delta(c.series, c.allocated_at, 180) IS NOT NULL)
         )
       RETURNING bo.allocator_id
     )
     SELECT array_agg(DISTINCT allocator_id) INTO v_allocator_ids FROM transitioned;
     ```
   - Then `FOREACH v_allocator_id IN ARRAY v_allocator_ids LOOP PERFORM enqueue_compute_job(...); END LOOP;`
2. Update Task 0's `test_migration_063_body_has_enqueue` to additionally assert the body contains `RETURNING bo.allocator_id` and `array_agg(DISTINCT allocator_id)` (or equivalent capture).
3. Update Task 2's acceptance_criteria to include `grep -c "RETURNING bo.allocator_id" supabase/migrations/063_feedback_delta_enqueue.sql >= 1`.
4. Add test coverage per C1 item 2 above (the transition-vs-unchanged seed test).

## D2 — APPLY A (BLOCKER, golden fixture blind spot)

**Finding:** Golden snapshot's only asserted value is `{}`, identical to Wave 0 placeholder.

**Changes to PLAN.md:**
1. Replace the single golden fixture with THREE fixtures in `analytics-service/tests/fixtures/`:
   - `feedback_engine_v1_cold_golden.json` — CONTEXT.md Specifics 12-outcome seed; expected `{}` (cold start, per the worked example).
   - `feedback_engine_v1_ceiling_golden.json` — 5 allocated-positive outcomes attributed to W_PORTFOLIO_FIT; expected `{"W_PORTFOLIO_FIT": 1.5}`.
   - `feedback_engine_v1_floor_golden.json` — 5 rejected+mandate_conflict outcomes; expected `{"W_PREFERENCE_FIT": 0.5}`.
2. Replace Wave 0 placeholder content (currently `{}`) with a sentinel that will fail equality against any plausible code output (e.g., `{"__placeholder": "regenerate via REGENERATE_GOLDEN=1"}`) so a stale placeholder is caught by the equality check.
3. Update `test_golden_snapshot` to loop over the three scenarios; under `REGENERATE_GOLDEN=1`, fail if the regenerated fixture for ceiling/floor scenarios contains `{}`.
4. Update Task 4 acceptance_criteria and Task 0 stub list (adds ~2 tests, total 25 or 26).

## D3 — APPLY A (BLOCKER, hot-path overhead)

**Finding:** Inline `compute_adjusted_weights` call defeats `_should_skip_allocator` optimization, adds unconditional 5-round-trip overhead inside `_scoring_semaphore`.

**Changes to PLAN.md:**
1. Add a first-touch skip at the top of `compute_adjusted_weights` in `services/feedback_engine.py`:
   ```python
   def compute_adjusted_weights(allocator_id: str) -> dict[str, float]:
       # Fast-path: allocators with no bridge_outcomes skip all query work.
       resp = (
           supabase.table("bridge_outcomes")
           .select("id", count="exact")
           .eq("allocator_id", allocator_id)
           .limit(1)
           .execute()
       )
       if not resp.data:
           return {}
       # ... remainder unchanged
   ```
2. In `routers/match.py` inline seam, guard the call behind `_should_skip_allocator`'s decision so skipped scoring runs also skip feedback computation:
   - Only call `compute_adjusted_weights` on the non-skipped path (i.e., after the existing `if _should_skip_allocator(...): return` gate).
3. Add acceptance criterion to Task 1: `pytest tests/test_feedback_engine.py::test_fastpath_skip_no_outcomes -x` — asserts the fast-path returns `{}` with at most 1 Supabase query call (mock-side assertion via a call-count counter).
4. Add Task 0 stub: `test_fastpath_skip_no_outcomes`.

## D4 — APPLY A (WARNING, migration rollback)

**Finding:** No rollback / dry-run step for migration 063.

**Changes to PLAN.md:**
1. Add to Task 3 (BLOCKING schema push) a pre-apply step:
   ```bash
   supabase db query --linked --file supabase/migrations/063_feedback_delta_enqueue.sql --dry-run
   ```
   Acceptance: dry-run exits 0 before the real push.
2. Append a `## Rollback` section to Task 3 specifying the exact psql snippet that restores `compute_bridge_outcome_deltas` to migration 060's body (copy the verified 060 body verbatim, gated by the same CREATE OR REPLACE pattern).
3. Note explicitly that rollback is **human-only** — no auto-rollback task, because the failure mode is rare and the operator must verify pg_cron state before re-applying.

## D5 — APPLY A (WARNING, attribution dict ambiguity)

**Finding:** `REJECTION_REASON_TO_DIMENSION` has 3 keys vs D-06's 5 entries; test wording ambiguous.

**Changes to PLAN.md:**
1. Rename or comment the constant in `services/feedback_engine.py` to explicitly document omissions:
   ```python
   # Direct-mapping subset of CONTEXT.md D-06. Two omissions are INTENTIONAL:
   #   - 'already_owned': filtered at D-08 SQL stage, never reaches attribution.
   #   - 'other':         falls through to score-dominant attribution (allocated-negative path).
   # See .planning/phases/04-feedback-loop/04-CONTEXT.md D-06.
   REJECTION_REASON_TO_DIMENSION: dict[str, str] = {
       "mandate_conflict":     "W_PREFERENCE_FIT",
       "underperforming_peers": "W_TRACK_RECORD",
       "timing_wrong":         "W_PORTFOLIO_FIT",
   }
   ```
2. Rewrite Task 0's `test_rejection_reason_mapping` stub to assert all three explicitly:
   - The 3 direct-map keys present and mapped to the exact dimension constant.
   - `'already_owned' not in REJECTION_REASON_TO_DIMENSION`.
   - `'other' not in REJECTION_REASON_TO_DIMENSION`.

## D6 — APPLY A (WARNING, lazy-import enforcement)

**Finding:** `grep` acceptance check for the lazy import doesn't enforce function-body placement.

**Changes to PLAN.md:**
1. Replace Task 1's import acceptance grep with:
   ```bash
   grep -c '^    from services\.feedback_engine import compute_adjusted_weights' analytics-service/routers/match.py
   # must equal 1 (leading 4-space indent = function-body placement, not module-level)
   ```
2. Add a positive test to Task 0 stubs: `test_lazy_import_not_triggered_at_module_load` — imports `routers.match`, asserts `sys.modules.get('services.feedback_engine') is None` before any function is called.

## D7 — APPLY A (WARNING, ADR-0023 sync)

**Finding:** `src/lib/audit.ts` union change not mirrored in ADR-0023 registered-actions/entities tables.

**Changes to PLAN.md:**
1. Add `docs/architecture/adr-0023-audit-event-taxonomy.md` to Plan 04-01 `files_modified`.
2. Add a task step in Task 1's action list: append rows for action `feedback.overrides_updated` and entity `allocator_preference_feedback` to the ADR's registered tables, with a 1-2 sentence description per the existing row format.
3. Add acceptance criteria:
   - `grep -c "feedback.overrides_updated" docs/architecture/adr-0023-audit-event-taxonomy.md >= 1`
   - `grep -c "allocator_preference_feedback" docs/architecture/adr-0023-audit-event-taxonomy.md >= 1`

## D8 — APPLY B (WARNING, end-to-end propagation test)

**Finding:** No test verifies overrides propagate through `match_engine.py` multiplicative clamp + renormalize into the `effective_preferences` snapshot.

**Changes to PLAN.md:**
1. Add to Task 0 stubs: `test_full_scoring_propagation` — integration-style (mocked Supabase).
2. Behavior:
   - Seed bridge_outcomes such that `compute_adjusted_weights` returns `{"W_PORTFOLIO_FIT": 1.5}`.
   - Call `_score_one_allocator(allocator_id)` via the test harness.
   - Assert the resulting `match_batches.effective_preferences` payload contains `scoring_weight_overrides == {"W_PORTFOLIO_FIT": 1.5}`.
   - Assert the top-level normalized weight for `W_PORTFOLIO_FIT` in the payload equals the expected post-clamp-post-renormalize value (compute it via `match_engine.compute_effective_weights` helper or re-derive inline with the sum-to-1 invariant).
3. Update VALIDATION.md to add row 04-01-25 mapped to FEEDBACK-06 (integration).

## D9 — APPLY B (WARNING, line-number fragility)

**Finding:** Literal line numbers ("line 259", "lines 251-275") in Task 1 will drift.

**Changes to PLAN.md:**
1. Replace every literal `line N` reference in Task 1's `<action>` and `<read_first>` with a contextual anchor:
   - "insert immediately after `ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)` and before `candidate_strategies = list(universe["strategies_by_id"].values())`" (or the exact surrounding statements as verified in the current routers/match.py).
2. Keep a SINGLE line-number reference in `<read_first>` as a hint ("anchor is near line 259 at time of planning") but label it as an advisory, not a verification point.

## D10 — APPLY A (INFO, filename drift)

**Finding:** CONTEXT.md canonical_refs says `060_bridge_outcome_deltas.sql`; actual file is `060_bridge_outcome_cron.sql`.

**Changes to CONTEXT.md (direct edit, not planner revision):**
1. Update `.planning/phases/04-feedback-loop/04-CONTEXT.md` canonical_refs section — replace `060_bridge_outcome_deltas.sql` with `060_bridge_outcome_cron.sql` (two occurrences).

## D11 — APPLY A (INFO, SC1 wording anchor)

**Finding:** ROADMAP SC1 says "toward 1.5×" but D-13 is literal step (exactly 1.5×).

**Changes to PLAN.md:**
1. Add a 1-line annotation to `must_haves.truths` noting: "'toward 1.5×' in ROADMAP SC1 means exactly `1.5×` per D-13 literal step function. Do not introduce smoothing / linear interpolation."

## Explicitly IGNORED (user-decided / workflow-standard)

- **D12 (Voice B BLOCKER — audit scope creep):** User authorized audit events via AskUserQuestion in this planning session. Ignoring preserves user intent.
- **D13 (Voice B BLOCKER — autonomous):** [BLOCKING] schema-push is the standard workflow gate (step 5.7 in plan-phase). Matches Phase 1 plan 01-01 + Phase 3 plan 03-01 precedent. Ignoring matches established convention.
