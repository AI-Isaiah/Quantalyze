# Phase 4: Feedback Loop - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `analytics-service/services/feedback_engine.py` (new module) that closes the Bridge recommendation-feedback loop. The engine reads an allocator's `bridge_outcomes` history, maps each outcome to one of the four top-level scoring dimensions (`W_PORTFOLIO_FIT`, `W_PREFERENCE_FIT`, `W_TRACK_RECORD`, `W_CAPACITY_FIT`), computes a per-dimension `success_rate`, and emits a multiplicative scale factor per dimension — floor `0.5×` when `success_rate < 0.4`, ceiling `1.5×` when `success_rate > 0.7`, `1.0×` (no change) in between — with a per-dimension minimum of 5 attributed outcomes before any adjustment fires.

The output is written to `allocator_preferences.scoring_weight_overrides` (the column Phase 3 migration 062 already added) and returned in-memory for immediate use inside `_score_one_allocator`. Phase 3's engine already consumes the column via multiplicative clamp + renormalize, and `match_batches.effective_preferences` already snapshots it — no scoring-engine changes required for v2 reads.

Scope:
- `feedback_engine.py` with `compute_adjusted_weights(allocator_id) -> dict[str, float]` as the single public entry point.
- Wire the call into `routers/match.py::_score_one_allocator` between `_load_allocator_context` and `score_candidates` so the scoring run sees the just-computed overrides.
- Extend the Phase 1 daily delta cron (`compute_bridge_outcome_deltas` in `supabase/migrations/060_bridge_outcome_cron.sql` / Python caller) to enqueue `rescore_allocator` via the existing `enqueue_compute_job` RPC for every allocator whose deltas transitioned NULL → non-NULL and crossed a per-dimension threshold band.
- Unit test suite covering: cold start (<5), per-dim activation, floor breach, ceiling breach, stateless snap-back, rejection-reason enum mapping, missing-history uniform fallback, `already_owned` drop, `percent_allocated < 1%` drop, golden-snapshot determinism.
- One integration test: delta cron completes → `rescore_allocator` job enqueued → worker dispatches → `scoring_weight_overrides` column reflects feedback output.

Out of scope:
- Sub-weight overrides (Phase 3 D-09 locked top-level only).
- Screening-mode overrides (Phase 3 D-09).
- ML-based weight adjustment (REQUIREMENTS.md v1 out-of-scope).
- Outcomes-dashboard surfacing of feedback adjustments (Phase 5).
- Property-based tests, mutation testing (Phase 6 hardening).
- Postgres trigger on `bridge_outcomes` UPDATE (rejected in D-12 below in favor of explicit Python enqueue).
- New `FEEDBACK_VERSION` constant (deferred — add when the rule format changes).

</domain>

<decisions>
## Implementation Decisions

### Success definition
- **D-01: Positive-outcome signal = realized delta sign.** For each eligible `bridge_outcomes` row, success = `1` iff the most-mature non-NULL delta column is strictly `> 0`; `0` iff `≤ 0`. Rationale: `kind='allocated'` alone is a conviction signal, not a validation signal — what matters is whether the suggestion actually outperformed. Uses only columns the Phase 1 delta cron already populates; zero new schema.
- **D-02: Delta window = most-mature-available.** Prefer `delta_180d`, fall back to `delta_90d`, fall back to `delta_30d` — take the first non-NULL. Matches Phase 1 D-12's "always show most mature label" UX pattern and converges over time as outcomes mature. An outcome with only `delta_30d` populated today will re-classify automatically once 180d lands.
- **D-03: Pending allocated outcomes (all delta_Xd columns NULL) are EXCLUDED** from both the success-rate numerator/denominator AND the per-dimension min-5 threshold. They re-enter the calculation automatically once the delta cron populates the first delta column. Rationale: "we don't know yet" is cheaper to wait on than to bias with a default. No time-bias of new allocators.
- **D-04: Rejected outcomes count as FAILURE (0) in success_rate AND drive dimension attribution via `rejection_reason`.** The Phase 1 enum (`mandate_conflict`, `already_owned`, `timing_wrong`, `underperforming_peers`, `other`) was explicitly designed for Phase 4 attribution (Phase 1 D-10 note). Using it for attribution only would waste the failure signal in the success_rate; using it for success_rate only would waste the structured reason signal.

### Dimension attribution
- **D-05: Attribution rule = HYBRID.** Rejected rows use the `rejection_reason` enum mapping (D-06). Allocated rows (whether positive or negative delta) attribute to the dimension with the highest contribution in the historical `match_candidates.score_breakdown` at intro time — `max(portfolio_fit, effective_preference_fit, track_record, capacity_fit)` on the persisted row. Rationale: rejection signals WHY the allocator said no (and the enum nails that); allocated-but-underperforming signals require us to pick the dimension most responsible for surfacing the recommendation. The score_breakdown already exists on every `match_candidates` row — zero schema change.
- **D-06: Rejection-reason → dimension table (locked):**
  | rejection_reason | attributed dimension |
  | --- | --- |
  | `mandate_conflict` | `W_PREFERENCE_FIT` — the intro violated allocator's stated mandate |
  | `underperforming_peers` | `W_TRACK_RECORD` — the strategy's track record was weak |
  | `timing_wrong` | `W_PORTFOLIO_FIT` — market context / correlation failure |
  | `already_owned` | **excluded** — data hygiene issue, not a scoring error |
  | `other` | falls back to score-dominant rule (same path as allocated-negative) |
- **D-07: Missing-history fallback = UNIFORM attribution.** If the `match_candidates` row for a given outcome is gone (retention_sweep keeps last 7 batches per allocator, so intros from 8+ runs ago may be aged out), that outcome's success/failure contributes uniformly across all four dimensions — i.e., it increments each dimension's `(num_successes, num_total)` pair by the same amount. Does NOT drop the row (preserves its threshold contribution). Does NOT try to re-score against a fresh universe (strategy's current metrics aren't what they were at intro).
- **D-08: Noise filtering BEFORE success_rate computation:**
  1. Drop every `kind='rejected' AND rejection_reason='already_owned'` row (data hygiene, not feedback).
  2. Drop every `kind='allocated' AND percent_allocated < 1.0` row (token-size dabbles aren't conviction).
  3. Drop every pending allocated row per D-03.
  Rationale: keeps the signal reflective of meaningful allocator behavior. Filtering happens before min-5 counting.

### Execution cadence
- **D-09: Invocation point = INLINE inside `_score_one_allocator`, pre-scoring.** `routers/match.py::_score_one_allocator` calls `feedback_engine.compute_adjusted_weights(allocator_id)` after `_load_allocator_context` returns, merges the result into `ctx["preferences"]["scoring_weight_overrides"]`, then calls `score_candidates` as today. Rationale: scoring's engine already consumes `scoring_weight_overrides` from `prefs` — the merge-before-score step is the lowest-blast-radius integration.
- **D-10: Persist AND return.** `compute_adjusted_weights` also writes the result to `allocator_preferences.scoring_weight_overrides` via Supabase UPDATE before returning. Satisfies FEEDBACK-04 literally ("adjusted weights persisted to the column"), feeds FEEDBACK-06 automatically because `merge_with_defaults(prefs)` already reads the column value into `effective_preferences`, and gives Phase 5 dashboard + admin UI a queryable source of truth. Write is idempotent (same inputs → same overrides → same UPDATE body).
- **D-11: Triggers for a fresh feedback computation (TWO layered triggers, no new ones):**
  1. **Every scoring run** — since feedback is computed inline in `_score_one_allocator`, every code path that scores (daily cron, mandate-edit-driven `rescore_allocator`, admin-triggered POST /recompute) automatically picks up the freshest feedback.
  2. **Delta cron follow-up** — when the Phase 1 `compute_bridge_outcome_deltas` cron populates delta columns for an allocator's outcome AND that allocator has ≥5 attributed outcomes in at least one dimension, the cron enqueues `rescore_allocator` for that allocator. Reuses the Phase 3 worker and partial unique index (dedupes across concurrent runs).
  Bridge-outcome INSERT/UPDATE alone does NOT trigger rescore — delta_Xd is NULL at record time, so immediate feedback wouldn't change anything. Wait-for-delta is the natural gate.
- **D-12: Delta-hook mechanism = SQL-side `PERFORM enqueue_compute_job(...)` inside `compute_bridge_outcome_deltas()` SQL function body (migration 063), NOT a Postgres trigger and NOT a Python caller.** Discovered during Phase 4 research: migration 060 registered `compute_bridge_outcome_deltas` directly with pg_cron — there is NO Python caller to extend; Vercel Hobby plan is at 2/2 cron cap so adding a Python wrapper is not viable. Migration 063 ALTERs the SQL function to append a distinct-allocator PERFORM loop after the UPDATE that writes delta columns. Precedent: `supabase/migrations/062_scoring_weight_overrides.sql:458-466` already uses `PERFORM enqueue_compute_job(p_kind := 'rescore_allocator', p_allocator_id := ...)` inside `update_allocator_mandates`. Dedup handled by the existing `compute_jobs_one_inflight_per_allocator` partial unique index. Atomic with delta write (same SQL txn).

### Threshold shape
- **D-13: Scale function = LITERAL step per FEEDBACK-02.**
  ```
  success_rate < 0.4                 → scale = 0.5
  0.4 ≤ success_rate ≤ 0.7           → scale = 1.0   (no adjustment)
  success_rate > 0.7                 → scale = 1.5
  ```
  Rationale: matches the requirement verbatim, predictable, easy to test, easy to explain to allocators in Phase 5 dashboard copy. Smoother functions (linear/stepped) are deferred — revisit if the step function proves visibly coarse in production.
- **D-14: NO hysteresis — stateless snap-back.** `compute_adjusted_weights` is a pure function of `(bridge_outcomes, match_history)` at call time. If `success_rate` drifts from `0.75` into `0.6` the next scoring run emits `scale = 1.0×` for that dimension immediately — no decay, no sticky bias, no memory of prior adjustments. Rationale: pure-functional shape is trivially testable and matches the idempotent-write contract of D-10.
- **D-15: Min-5 gating is PER-DIMENSION.** A dimension `W_i` is eligible for adjustment only when `count(attributed outcomes to W_i after D-08 filtering) ≥ 5`. Dimensions below that threshold default to `1.0×` (no override key emitted — see D-16). Aligns with FEEDBACK-05 ("dimensions adjust independently") and FEEDBACK-03 ("cold start falls back to defaults"). An allocator with 20 `mandate_conflict` rejections and zero other-dimension outcomes adjusts only `W_PREFERENCE_FIT`; the other three dimensions stay at defaults.
- **D-16: Cold-start / under-threshold write shape = OMIT the key.** If dimension `W_i` has `<5` attributed outcomes, `compute_adjusted_weights` does NOT include `W_i` in the returned/persisted dict. Phase 3's engine already reads `overrides.get(W_i, 1.0)` — the missing key yields `1.0×` scale naturally. An allocator with zero eligible outcomes gets `scoring_weight_overrides = NULL` (column never written). An allocator with ≥5 on only `W_PORTFOLIO_FIT` gets `{"W_PORTFOLIO_FIT": 1.5}` — a three-key absence signals "no signal yet on these three." Minimal writes, cleanest semantic, zero impact on existing renormalization math.

### Claude's Discretion
- Exact internal helper decomposition of `feedback_engine.py` — e.g., whether to split into `_fetch_outcomes`, `_attribute`, `_compute_success_rate`, `_apply_shape` private functions vs one larger function with internal comments. Follow `match_engine.py` precedent — mid-sized private helpers + one public entry.
- Exact Supabase query shape for loading bridge_outcomes + joining against match_candidates to pull score_breakdown — planner's call whether to use a single PostgREST `select` with `match_candidates(score_breakdown)` embedded expansion or two sequential queries.
- Whether to emit an `audit` event on every scoring_weight_overrides write (ADR-0023 pattern). Lean YES for admin observability parity with Phase 2 mandates, but planner can defer if it adds test complexity.
- Whether the delta-cron follow-up enqueues on EVERY delta-column transition or only on transitions that flip a dimension across a threshold band (0.4/0.7 crossings). Lean toward "every transition" — the partial unique index dedupes concurrent jobs and missed enqueues are recovered by the daily cron.
- Exact shape of the integration test — in-memory Supabase mock vs HAS_LIVE_DB-gated real run. Follow Phase 3 D-17 precedent (no live-DB E2E).
- Whether to expose a read-only debug endpoint for "show me this allocator's feedback state right now" — admin-useful but not required by any FEEDBACK-* requirement.
- Naming of the dimension attribution table/lookup — whether `REJECTION_REASON_TO_DIMENSION` is a module-level dict in `feedback_engine.py` or a new constant in `match_defaults.py`. Lean co-located in `feedback_engine.py` for minimal cross-module churn.
- Exact test-file placement: extend existing `analytics-service/tests/test_match_engine.py` vs new `test_feedback_engine.py`. Lean NEW FILE — feedback is a distinct module with its own public API; keeping tests co-located with source is the established pattern.

### Folded Todos
None — no pending repo-level TODOs relevant to Phase 4 surfaced during discussion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Sprint 8 vision; feedback engine is the closing loop
- `.planning/REQUIREMENTS.md` — FEEDBACK-01 through FEEDBACK-06 (locked), SCORING-* for Phase 3 context
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria SC1–SC5, plan breakdown (1 plan: `04-01`)
- `.planning/STATE.md` — current phase entry point; Phase 3 decisions already folded in

### Cross-phase coupling — READ THESE FIRST
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — D-10 rejection_reason enum, D-12 delta label progression, D-15/D-16 cron idempotency + needs_recompute semantics, D-17 editable outcomes
- `.planning/phases/01-outcome-tracker/01-01-SUMMARY.md` — migration 059 actual output (bridge_outcomes + dismissals tables, three-tier RLS, needs_recompute trigger)
- `.planning/phases/01-outcome-tracker/01-04-SUMMARY.md` — migration 060 `compute_bridge_outcome_deltas` function + cron registration; **Phase 4 extends this cron's Python caller**
- `.planning/phases/03-mandate-aware-scoring-engine/03-CONTEXT.md` — D-08 multiplicative overrides + clamp + renormalize, D-09 top-level-only overrides, D-10 effective_preferences flat shape, D-11 skip-logic triple check, D-12 Option B compute_jobs allocator_id expansion
- `.planning/phases/03-mandate-aware-scoring-engine/03-01-SUMMARY.md` — migration 062 actual shape (scoring_weight_overrides column, compute_jobs 3-way XOR, rescore_allocator kind, enqueue_compute_job signature); match_engine.py v2.0.0 overrides consumer at line 762–792
- `.planning/phases/03-mandate-aware-scoring-engine/03-02-SUMMARY.md` — routers/match.py skip-logic triple check + run_rescore_allocator_job handler

### Architecture decision records
- `docs/architecture/adr-0001-rls-primary-authorization.md` — RLS as primary auth (feedback writes are server-role, no user-path)
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — if we audit feedback writes, use `entity_type = 'allocator_preference_feedback'` pattern
- `docs/architecture/adr-0003-service-role-bypass.md` — service_role bypasses RLS; feedback engine runs under service_role in the analytics-service context

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — analytics-service FastAPI layering; feedback_engine.py sits alongside match_engine.py
- `.planning/codebase/STACK.md` — Python 3.14 + Supabase patterns
- `.planning/codebase/TESTING.md` — pytest + fixtures conventions
- `.planning/codebase/CONVENTIONS.md` — code style; lazy imports for circular-risk modules (see job_worker.py precedent)

### Engine source (read-only for Phase 4; Phase 4 wires in, doesn't modify)
- `analytics-service/services/match_engine.py` — `score_candidates()` (line 549); multiplicative overrides reader (line 762–792); `ENGINE_VERSION = v2.0.0`; `DEFAULT_PREFERENCES` keys include `scoring_weight_overrides` (imported via `match_defaults`)
- `analytics-service/services/match_defaults.py` — `DEFAULT_PREFERENCES` (line 9); `merge_with_defaults` NULL-skip semantic — scoring_weight_overrides injected here flows into effective_preferences naturally
- `analytics-service/services/job_worker.py` — `run_rescore_allocator_job` (line 1106); `TIMEOUT_PER_KIND['rescore_allocator'] = 5*60`; dispatch routing at line 1188

### Caller integration (target of Phase 4)
- `analytics-service/routers/match.py` — `_load_allocator_context` (line 172); `_score_one_allocator` (line 251) — **Phase 4 inserts feedback_engine call between these two**; `_should_skip_allocator` (line 355)

### New Phase 4 module
- `analytics-service/services/feedback_engine.py` — **to be created**; imports lazily from routers.match if needed (circular import guard, follow job_worker.py pattern)

### Phase 1 delta cron (target for D-11/D-12 extension)
- `supabase/migrations/060_bridge_outcome_cron.sql` — `compute_bridge_outcome_deltas()` SQL function + pg_cron schedule; **extends in Phase 4** to also enqueue `rescore_allocator` via pg_cron Python caller OR via direct SQL `PERFORM enqueue_compute_job(...)` after delta population (planner to pick — lean SQL-side PERFORM for atomicity)
- `analytics-service/routers/cron.py` — if the delta cron is called via HTTP endpoint (Vercel cron hitting analytics-service), this is the integration point

### Source of bridge_outcomes schema
- `supabase/migrations/059_bridge_outcomes.sql` — table definition, CHECK constraints on `kind`/`percent_allocated`/`allocated_at`/`rejection_reason`; unique index on (allocator_id, strategy_id); three-tier RLS
- `supabase/migrations/060_bridge_outcome_cron.sql` — delta cron SQL body

### Source of score_breakdown for attribution
- `supabase/migrations/011_perfect_match.sql` — `match_candidates` table; `score_breakdown JSONB NOT NULL` column; `match_batches.effective_preferences` schema
- `supabase/migrations/062_scoring_weight_overrides.sql` — scoring_weight_overrides column + compute_jobs.allocator_id expansion

### Schema-sync contract
- `src/lib/admin/match.ts` — `ALLOCATOR_PREFERENCES_COLUMNS` constant (Phase 3 appended `scoring_weight_overrides`); **Phase 4 does NOT touch** — engine writes, no new columns
- `src/lib/preferences.ts` — `AllocatorPreferences` interface already has `scoring_weight_overrides: Record<string, number> | null` (Phase 3)

### Testing references
- `analytics-service/tests/test_match_engine.py` — 20+ Phase 3 unit tests, `_make_candidate` fixture pattern, `scoring_weight_overrides` renormalization test (line 817–884) — reuse patterns for Phase 4 tests
- `analytics-service/tests/test_match_integration.py` — FastAPI client + mocked Supabase pattern
- `analytics-service/tests/fixtures/match_engine_v2_golden.json` — frozen v2.0.0 output pattern; Phase 4 should add its own golden fixture `feedback_engine_v1_golden.json`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `compute_jobs` queue + `rescore_allocator` kind + partial unique index — Phase 3 already built the delivery pipeline; Phase 4 just pushes jobs onto it.
- `enqueue_compute_job(p_kind, p_allocator_id)` RPC (Phase 3 D-12 step 5) — signature already supports allocator-scoped jobs; `update_allocator_mandates` precedent for call syntax.
- `merge_with_defaults(prefs)` — single extension point; any new default key (e.g., a future `FEEDBACK_VERSION`) lands here.
- `match_batches.effective_preferences` JSONB snapshot — picks up the Phase 4 overrides automatically because Phase 3's snapshot is a post-merge flat dict; no snapshot-code change needed for FEEDBACK-06.
- `log_audit_event` — Phase 2 mandate-edit precedent for allocator-scoped audit; use `entity_type = 'allocator_preference_feedback'` if D-10's audit discretion goes YES.
- `routers.match._score_one_allocator` acquires `_scoring_semaphore` — inline feedback call inherits this concurrency gate for free.

### Established Patterns
- **Lazy imports for circular risk** (`job_worker.py::run_rescore_allocator_job` imports `routers.match._score_one_allocator` inside the function body) — `feedback_engine.py` should follow if it needs any import from `routers/match.py`.
- **Pure-function scoring components** (`_compute_preference_fit`, `_compute_mandate_fit_score` — Phase 3 pattern) — `compute_adjusted_weights` is the Phase 4 analog: single-responsibility, deterministic, testable in isolation.
- **Golden-snapshot determinism tests** (Phase 3 D-15 #20) — `REGENERATE_GOLDEN=1 pytest tests/test_feedback_engine.py::test_golden_snapshot` — intentional refresh escape hatch.
- **Multiplicative override with clamp + renormalize** — already implemented in `match_engine.py:762–792`. Phase 4 outputs get clamped by the engine defensively; Phase 4 should still clamp internally to `[0.5, 1.5]` per D-13 so the column stores honest values.
- **Three-scope compute_jobs** (strategy / portfolio / allocator) — Phase 3 established, Phase 4 just produces work for the allocator scope.
- **Pytest fixtures for match_candidates + bridge_outcomes** — Phase 1 and Phase 3 both seed via `_make_candidate` / direct dict construction. Phase 4 tests need combined fixtures (outcomes + historical score_breakdown).

### Integration Points
- **`routers/match.py::_score_one_allocator`** — insert call between `_load_allocator_context` (line 259) and `score_candidates` (line 265). Merge the result into `ctx["preferences"]["scoring_weight_overrides"]` before passing `preferences=ctx["preferences"]` to the engine.
- **Phase 1 delta cron caller** (SQL function `compute_bridge_outcome_deltas` or the Python scheduler that invokes it) — extend to `PERFORM enqueue_compute_job(p_kind := 'rescore_allocator', p_allocator_id := <allocator_id>)` after each allocator's deltas write, guarded by `compute_jobs_one_inflight_per_allocator` dedup.
- **`allocator_preferences.scoring_weight_overrides`** — Phase 4 is the first writer. Phase 3 wrote the column spec but never populated it; Phase 4 owns the write path via `feedback_engine.compute_adjusted_weights`.
- **`match_candidates.score_breakdown`** — Phase 4 READS this to attribute allocated outcomes. Query: for a given `bridge_outcomes` row, join to the `match_candidates` row where `allocator_id` + `strategy_id` + `match_batches.computed_at ≤ bridge_outcomes.created_at` (take most recent before-or-equal-to outcome record time).
- **`match_batches.effective_preferences`** — snapshots `scoring_weight_overrides` automatically via Phase 3's merge. FEEDBACK-06 satisfied with zero snapshot-code changes.

</code_context>

<specifics>
## Specific Ideas

- **Concrete flow** (D-05 + D-06 hybrid rule worked example): allocator has recorded 12 bridge_outcomes — 3 `allocated + delta_90d > 0` (success), 2 `allocated + delta_90d < 0` (failure), 3 `rejected + mandate_conflict`, 2 `rejected + underperforming_peers`, 1 `rejected + already_owned` (dropped D-08), 1 `allocated + percent_allocated=0.5%` (dropped D-08). After filtering: 10 rows. Attribution:
  - Allocated-positive × 3 → score-dominant dimension each; say all 3 had `W_PORTFOLIO_FIT` dominant at intro → 3 successes to W_PORTFOLIO_FIT.
  - Allocated-negative × 2 → score-dominant each; say both had `W_TRACK_RECORD` dominant → 2 failures to W_TRACK_RECORD.
  - `mandate_conflict` × 3 → 3 failures to W_PREFERENCE_FIT.
  - `underperforming_peers` × 2 → 2 failures to W_TRACK_RECORD.
  Final per-dim count: W_PORTFOLIO_FIT (3/3), W_PREFERENCE_FIT (0/3), W_TRACK_RECORD (0/4), W_CAPACITY_FIT (0/0). Only W_TRACK_RECORD hits min-5 (4 outcomes — still below!), so NOTHING adjusts. Example shows how conservative the min-5 per-dim gate is for early allocators — on purpose per FEEDBACK-03.
- **`compute_adjusted_weights` signature:**
  ```python
  def compute_adjusted_weights(allocator_id: str) -> dict[str, float]:
      """Reads bridge_outcomes + match history, returns {W_i: scale} for
      dimensions with ≥5 attributed outcomes. Missing keys mean 1.0×
      (no override — see Phase 3 D-16). Also writes the result to
      allocator_preferences.scoring_weight_overrides as a side effect.
      Empty result → column set to NULL (engine path unchanged).
      """
  ```
- **Golden-snapshot fixture shape**: `analytics-service/tests/fixtures/feedback_engine_v1_golden.json` — deterministic 12-outcome allocator like the flow above, frozen expected output `{"W_PORTFOLIO_FIT": 1.5}` or whatever the math yields. `REGENERATE_GOLDEN=1 pytest tests/test_feedback_engine.py::test_golden_snapshot` regenerates.
- **Delta-cron enqueue SQL** (D-12 recommendation): add at the end of `compute_bridge_outcome_deltas()` function body after the UPDATE that writes delta columns:
  ```sql
  FOR v_allocator_id IN
    SELECT DISTINCT allocator_id
    FROM bridge_outcomes
    WHERE deltas_computed_at >= v_cron_start_at
      AND kind = 'allocated'
  LOOP
    PERFORM enqueue_compute_job(
      p_kind := 'rescore_allocator',
      p_allocator_id := v_allocator_id
    );
  END LOOP;
  ```
  Partial unique index dedupes concurrent enqueues; kind_target_coherence CHECK validated at insert time.
- **FEEDBACK-04 literal satisfaction**: after every `compute_adjusted_weights` call, `allocator_preferences.scoring_weight_overrides` reflects the latest computation. A follow-up `SELECT scoring_weight_overrides FROM allocator_preferences WHERE user_id = $1` returns exactly what the scoring run used. Phase 5 dashboard reads this directly.
- **FEEDBACK-06 via Phase 3 snapshot**: `match_batches.effective_preferences` already flat-merges `scoring_weight_overrides` via `merge_with_defaults`. When Phase 4's inline call updates the column AND passes the value through `ctx["preferences"]["scoring_weight_overrides"]`, the snapshot contains the value automatically — zero new snapshot code.

</specifics>

<deferred>
## Deferred Ideas

- **`FEEDBACK_VERSION` constant** — for override-format versioning analogous to `ENGINE_VERSION`/`WEIGHTS_VERSION`. Not needed until the feedback rule format changes in a way that invalidates stored overrides. Revisit when Phase 6+ introduces sub-weight overrides or a non-step shape.
- **Sub-weight overrides** (`W_SHARPE_LIFT`, `W_CORR_REDUCTION`, `W_DD_IMPROVEMENT`) — Phase 3 D-09 locked top-level only. Revisit in Phase 6+ if per-dimension feedback granularity proves insufficient.
- **Linear / stepped / continuous adjustment shapes** — D-13 locked literal step per spec. If production data shows the step function is too coarse (e.g., an allocator hovering at 0.69 success_rate never gets the ceiling), revisit with a smoother function.
- **Hysteresis / decay / sticky adjustments** — D-14 locked stateless snap-back. If allocators complain about weight flapping run-to-run, revisit with a time-decay or sticky model.
- **Postgres trigger on `bridge_outcomes` UPDATE** — D-12 chose explicit Python enqueue for visibility. Revisit if ops needs a belt-and-suspenders fallback for delta writes that bypass the cron (there are currently none).
- **Admin dashboard / feedback-observability UI** — Phase 5 (Outcomes Dashboard) scope; Phase 4 writes the column and audit events, Phase 5 visualizes.
- **Property-based tests (hypothesis)** for monotonicity (success_rate↑ ⇒ scale↑ weakly) — Phase 6 test-hardening scope.
- **Mutation testing** on `feedback_engine.py` — Phase 6 scope.
- **`percent_allocated` as a continuous conviction weight** beyond the 1% floor (D-08) — revisit if allocators want a 10% allocation to count more than a 1.5% allocation in the signal. For v1 every qualifying allocated row weighs the same.
- **Score-proportional attribution** (Phase 4 Area 2 alt option) — D-05 chose score-dominant. Revisit if dominant-dimension attribution produces visibly noisy weight updates.
- **Re-scoring against fresh universe** to recover aged-out score_breakdown (Phase 4 Area 2 Q3 alt) — D-07 chose uniform fallback. Revisit if retention_sweep aging-out proves to eat a significant fraction of outcomes.
- **Audit-event emission on feedback writes** — Claude's Discretion in this doc; plan may include or defer based on test complexity.
- **Debug endpoint** (`GET /feedback/{allocator_id}/state`) — Claude's Discretion; admin-useful, not required.

### Reviewed Todos (not folded)
None — no pending repo-level TODOs relevant to Phase 4 surfaced during discussion.

</deferred>

---

*Phase: 04-feedback-loop*
*Context gathered: 2026-04-18*
