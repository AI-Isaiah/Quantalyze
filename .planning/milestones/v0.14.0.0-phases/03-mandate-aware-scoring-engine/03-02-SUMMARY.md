---
phase: 03-mandate-aware-scoring-engine
plan: 02
subsystem: scoring-engine

tags:
  - router
  - skip-logic
  - worker-dispatch
  - cache-invalidation
  - integration-tests
  - python
  - mocked-supabase
  - asyncmock

# Dependency graph
requires:
  - phase: 03-mandate-aware-scoring-engine (plan 01)
    provides: "ENGINE_VERSION='v2.0.0' + WEIGHTS_VERSION='v2.0.0' in match_engine.py (makes the version-mismatch trigger meaningful); migration 062 LIVE (compute_jobs.allocator_id column + rescore_allocator kind + 3-way XOR + kind_target_coherence rescore_allocator arm + compute_jobs_one_inflight_per_kind_allocator partial unique index + enqueue_compute_job trailing p_allocator_id param + update_allocator_mandates PERFORM enqueue_compute_job); candidate['subtype'] enum target already honored by Plan 03-01 _eligibility_check style_exclusions branch"
provides:
  - "_should_skip_allocator(allocator_id, force) triple check in analytics-service/routers/match.py — force OR engine_version mismatch OR mandate_edited_at > computed_at → return False; otherwise apply existing RECOMPUTE_MIN_AGE_HOURS (12h) age guard"
  - "_load_candidate_universe SELECT extended to include 'subtypes'; candidate dict now populates 'subtype': strategies.subtypes[0] (Pitfall 1 fix — closes SCORING-07 style_exclusions path end-to-end)"
  - "services/job_worker.py TIMEOUT_PER_KIND['rescore_allocator'] = 5 * 60 (5 minutes)"
  - "services/job_worker.py dispatch ladder: elif kind == 'rescore_allocator': handler = run_rescore_allocator_job"
  - "services/job_worker.py new run_rescore_allocator_job async handler — deferred import of _load_candidate_universe + _score_one_allocator from routers.match (breaks circular import at module load); FAILED/permanent on missing allocator_id; DONE on empty universe; FAILED/transient on scoring exception (allocator scoring idempotent)"
  - "analytics-service/tests/test_match_integration.py (NEW) — 5 integration tests: 3 skip-logic triple-check + 1 worker dispatch + 1 D4 per-voice-revision stale-cache regression guard. Mocked-Supabase chain pattern from test_daily_enqueue_lock.py + AsyncMock dispatch pattern from test_job_worker.py. asyncio_mode=auto, no decorators needed."
affects:
  - 04-feedback-loop (Phase 4 populates allocator_preferences.scoring_weight_overrides; this plan's skip-logic triple check will correctly invalidate batches when the feedback engine writes a fresh override — the version check still fires because Phase 4 does NOT bump ENGINE_VERSION, so the mandate_edited_at trigger or a fresh-enqueue is the invalidation path)
  - 05-dashboard-widget (reads engine_version filter on match_batches — this plan persists v2.0.0 via _score_one_allocator unchanged)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferred import pattern to break circular dependency at module load: `from routers.match import ...` inside the handler function body rather than module top (services/job_worker.py cannot top-level import routers/match.py because routers/match.py indirectly pulls in services/match_engine.py which is a peer of services/job_worker.py)"
    - "Triple short-circuit skip gate: force → version → mandate_edited → age. Each trigger short-circuits to return False BEFORE the next query, minimizing round-trips when the earlier trigger fires"
    - "maybe_single() null-safe guard: `(prefs_result.data or {}) if prefs_result else {}` handles the Supabase-py convention where maybe_single returns None (not an empty data object) for no-match rows"
    - "candidate['subtype'] one-level derivation from strategies.subtypes[0]: mirrors existing `strategy_type` derivation from strategies.strategy_types[0] and `exchange` from strategies.supported_exchanges[0] — additive extension, zero breakage to existing callers"
    - "Test file pattern with try/except ImportError guard + IMPORTS_OK sentinel: Wave 0 tests collect cleanly even when Wave 1 hasn't shipped; tests pytest.skip if imports fail, otherwise run. Avoids collection errors during TDD red phase"
    - "monkeypatch at consumer namespace, not producer: `monkeypatch.setattr('routers.match.score_candidates', ...)` works; `monkeypatch.setattr('services.match_engine.score_candidates', ...)` does NOT because routers/match.py binds score_candidates at import time via `from services.match_engine import score_candidates`"

key-files:
  created:
    - analytics-service/tests/test_match_integration.py
  modified:
    - analytics-service/routers/match.py
    - analytics-service/services/job_worker.py

key-decisions:
  - "Run 03-02 directly on the feature branch (no worktree isolation) — orchestrator directive; no --no-verify, standard pre-commit hooks active"
  - "Place run_rescore_allocator_job immediately after _mark_intro_snapshot_failed in job_worker.py — keeps per-kind handlers clustered, matches the plan's structural-analog guidance (run_compute_intro_snapshot_job family)"
  - "test_worker_reads_latest_allocator_preferences invokes run_rescore_allocator_job directly (bypassing dispatch) — isolates the stale-cache contract to the handler itself rather than the dispatch ladder. The dispatch test (test_dispatch_routes_rescore_allocator) separately proves the ladder hits the handler"
  - "In test_worker_reads_latest_allocator_preferences, ADDED extra monkeypatches beyond the plan's interface block: _load_candidate_universe returned a single strategy so the empty-universe short-circuit in run_rescore_allocator_job doesn't return DONE early, AND the Supabase client was mocked for match_batches/match_candidates persistence so _score_one_allocator can complete without a live DB. Also added 4 extra keys to the _capture_score_candidates return shape (excluded_total, mode, filter_relaxed, effective_preferences, effective_thresholds, source_strategy_count) that _score_one_allocator reads — these are necessary for the test to exercise the full scoring path without NotImplementedError / KeyError. Not a plan deviation; the plan's interface block covered the capture mechanism, not the test-harness completeness"
  - "test_worker_reads_latest_allocator_preferences uses a sync capture function passed via monkeypatch, not an async one — routers/match.py calls score_candidates directly (not via asyncio.to_thread or await), so a sync replacement is the shape-correct mock. The plan's interface block had `async def _capture_score_candidates` which would break because _score_one_allocator does `result = score_candidates(...)` not `await score_candidates(...)`"

patterns-established:
  - "D-11 triple-check short-circuit order: force → engine_version → mandate_edited_at → age. Each condition short-circuits to return False on match; only the final age guard returns True (skip). Minimizes DB round-trips when earlier triggers fire"
  - "Allocator-scoped compute_jobs dispatch: handler reads allocator_id directly from the job dict (migration 062 kind_target_coherence CHECK ensures it's non-null); strategy_analytics bridge self-gates on `if strategy_id:` so no explicit bypass needed (T-03-F invariant honored structurally)"
  - "Handler return shape for proactive rescore jobs: FAILED/permanent on missing allocator_id (migration 062 bug indicator — should never fire in production); DONE on empty universe (no-op success, not a failure); FAILED/transient on scoring exception (allocator scoring is idempotent → retry-safe)"

requirements-completed:
  - SCORING-05
  - SCORING-07

# Metrics
duration: ~15m
completed: 2026-04-18
---

# Phase 03 Plan 02: Caller wiring — _should_skip_allocator triple check + subtype candidate mapping + rescore_allocator worker dispatch + 5 integration tests Summary

**Caller-side wiring that makes Plan 03-01's v2.0.0 engine + migration 062 actually invalidate stale batches (D-11 triple check) and route the proactive rescore enqueue (D-12 Option B end-to-end) — `_should_skip_allocator` triple check + `_load_candidate_universe` subtype mapping + `rescore_allocator` worker handler + 5 integration tests (3 skip-logic + 1 dispatch + 1 D4 fresh-prefs stale-cache regression guard).**

## Performance

- **Duration:** ~15m
- **Started:** 2026-04-18T20:01:00Z
- **Completed:** 2026-04-18T20:16:00Z
- **Tasks:** 3 (W0 red scaffolds, W1-A router, W1-B worker)
- **Files modified:** 3 (1 created test + 2 modified Python production)

## Accomplishments

- All 5 integration tests green on first implementation pass; zero rework.
- `_should_skip_allocator` triple check (force + engine_version + mandate_edited_at) closes SCORING-05 end-to-end — the v1→v2 cutover trigger is LIVE because 03-01 shipped `ENGINE_VERSION='v2.0.0'` and this plan added the equality check.
- `_load_candidate_universe` subtype mapping closes RESEARCH Pitfall 1 — Plan 03-01's `_eligibility_check` compared `candidate.get("subtype")` against `allocator.style_exclusions`, but `subtype` was never populated. Extending the SELECT and dict construction to include `subtypes[0]` makes SCORING-07 fire correctly without a schema change.
- `run_rescore_allocator_job` handler wires D-12 Option B end-to-end: mandate write → migration 062 `update_allocator_mandates` PERFORM enqueue → compute_jobs row with `kind='rescore_allocator'` + `allocator_id=auth.uid()` → `dispatch()` routes to this handler → `_load_candidate_universe` + `_score_one_allocator(allocator_id, universe)` → fresh v2.0.0 batch.
- Full analytics-service suite passes: **452 tests green** (up from 447 in Plan 03-01 — the 5 new integration tests contribute). Coverage holds at 81.05% (threshold 80%). Zero regression in test_job_worker (27/27) or Plan 03-01's match_engine/match_defaults tests (58/58).
- T-03-F (spoofing) mitigation structurally honored: strategy_analytics bridge self-gates on `if strategy_id:` so allocator-scoped jobs skip it naturally, no explicit bypass needed.

## Task Commits

Each task was committed atomically:

1. **Task 0 (W0): Red integration test scaffolds** — `fbca15d` (test) — 5 test stubs in NEW `analytics-service/tests/test_match_integration.py`. IMPORTS_OK sentinel + try/except ImportError guard. Wave 0 state: 1 coincidental pass (force+fresh path hits the age guard correctly even pre-Wave-1) + 4 fail (red) against un-extended code — all acceptable per plan WR-03.
2. **Task 1 (W1-A): routers/match.py triple check + subtype mapping** — `35ec80b` (feat) — `_should_skip_allocator` extended; `_load_candidate_universe` SELECT extended; `candidate["subtype"]` derived. 3 skip-logic tests pass. Plan 03-01 regression: 58/58 green.
3. **Task 2 (W1-B): services/job_worker.py rescore_allocator dispatch** — `b37a361` (feat) — TIMEOUT_PER_KIND entry + elif branch + new run_rescore_allocator_job handler with deferred import. 2 dispatch tests pass. test_job_worker regression: 27/27 green. Full suite: 452/452 green.

## Files Created/Modified

- `analytics-service/tests/test_match_integration.py` — NEW — 5 integration tests covering D-11 triple check (3 tests) + D-12 Option B dispatch (1 test) + D4 per-voice-revision stale-cache regression guard (1 test). Uses `asyncio_mode=auto` from pytest.ini — no decorators. Mocked Supabase chain pattern from test_daily_enqueue_lock.py + AsyncMock dispatch pattern from test_job_worker.py. IMPORTS_OK sentinel + try/except ImportError guard.
- `analytics-service/routers/match.py` — MODIFIED — `_should_skip_allocator` grows from single age-check to D-11 triple check (force + engine_version mismatch + mandate_edited_at > computed_at); SELECT on match_batches now includes engine_version; new query against allocator_preferences.mandate_edited_at (indexed PK lookup); `_load_candidate_universe` SELECT extended to include `subtypes`; new `primary_subtype` derivation (one line after `primary_exchange`); `strategies_by_id[sid]["subtype"]` added to dict literal.
- `analytics-service/services/job_worker.py` — MODIFIED — `TIMEOUT_PER_KIND["rescore_allocator"] = 5 * 60`; dispatch ladder gains `elif kind == "rescore_allocator": handler = run_rescore_allocator_job`; new async def `run_rescore_allocator_job(job: dict) -> DispatchResult` with deferred import from routers.match (circular-safe), FAILED/permanent guard on missing allocator_id, DONE short-circuit on empty universe, FAILED/transient on scoring exception. Strategy-analytics bridge unchanged (self-gates on `if strategy_id:`).

## Decisions Made

- **Run directly on the feature branch (no worktree).** Orchestrator directive. Standard pre-commit hooks active. No `--no-verify`.
- **Place `run_rescore_allocator_job` immediately after `_mark_intro_snapshot_failed`.** Keeps per-kind handlers clustered, matches the plan's structural-analog guidance (the compute_intro_snapshot family).
- **Deferred import pattern chosen over top-level.** `routers/match.py` imports from `services/match_engine.py`, and `services/match_engine.py` sits as a peer of `services/job_worker.py` in the services namespace — a top-level `from routers.match import ...` in job_worker would create a module-load cycle. Pushing the import into the handler body breaks the cycle at no runtime cost (Python caches module imports after first call).
- **T-03-F spoofing mitigation is structural, not code.** The existing `if strategy_id:` self-gate on the strategy_analytics bridge already skips allocator-scoped jobs; no explicit bypass was added. Verified by the `mock_bridge.assert_not_called()` assertion in `test_dispatch_routes_rescore_allocator`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] test_worker_reads_latest_allocator_preferences: `_capture_score_candidates` signature mismatch**
- **Found during:** Task 0 (W0) scaffolding review before commit.
- **Issue:** The plan's interface block at line 471 defined `_capture_score_candidates` as `async def`, but `_score_one_allocator` calls `score_candidates(...)` synchronously (line 259 of routers/match.py — no `await`). An async mock would return a coroutine object that the caller treats as a dict, raising `TypeError: argument of type 'coroutine' is not iterable` on the subsequent `len(result["candidates"])` call in `_score_one_allocator`.
- **Fix:** Changed to `def _capture_score_candidates(*args, **kwargs)` (sync) matching the actual call site. Also extended the return shape from the plan's minimal `{"candidates": [], "excluded": []}` to include `excluded_total`, `mode`, `filter_relaxed`, `effective_preferences`, `effective_thresholds`, `source_strategy_count` — all keys `_score_one_allocator` reads from the result dict at lines 278-290 when persisting the match_batches row. Without these, the test would raise KeyError before the capture assertion fired.
- **Files modified:** analytics-service/tests/test_match_integration.py
- **Verification:** `pytest tests/test_match_integration.py::test_worker_reads_latest_allocator_preferences -x -q` passes. Captured `max_weight == 0.17` (the FRESH_MAX_WEIGHT fixture).
- **Committed in:** fbca15d (W0 scaffold commit — the fix landed before the first test run, so the scaffold was already green-shaped against Wave 1 production).

**2. [Rule 2 - Missing Critical] test_worker_reads_latest_allocator_preferences: additional monkeypatches needed for _score_one_allocator to run**
- **Found during:** Task 0 (W0) authoring (same scaffold review).
- **Issue:** The plan's interface block patched only `_load_allocator_context` and `score_candidates`. But `run_rescore_allocator_job` calls `_load_candidate_universe()` first — if that returned an empty `strategies_by_id` dict (as it would against no real DB), the handler short-circuits with `DispatchResult(DONE)` BEFORE invoking `_score_one_allocator`, meaning `_capture_score_candidates` would never run and the fresh-prefs assertion would never fire. Additionally, `_score_one_allocator` persists the batch to `match_batches` and `match_candidates` via `supabase.table(...).insert(...).execute()` — without a mocked supabase, those calls would hit a real DB URL and fail.
- **Fix:** Added two more monkeypatches: (a) `monkeypatch.setattr("routers.match._load_candidate_universe", lambda: {"strategies_by_id": {"sfresh": {...}}, "returns_by_id": {}})` so the handler proceeds past the empty-universe short-circuit; (b) `monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)` with a MagicMock chain that returns `[{"id": "batch-fresh"}]` on the batch insert so `_score_one_allocator` can extract `batch_id` without AttributeError.
- **Files modified:** analytics-service/tests/test_match_integration.py
- **Verification:** Same test run as above — passes end-to-end.
- **Committed in:** fbca15d (W0 scaffold commit).

---

**Total deviations:** 2 auto-fixed (1 Rule 1 async/sync signature bug in a test harness stub provided by the plan interface block; 1 Rule 2 missing critical test-harness scaffolding)
**Impact on plan:** Both fixes necessary for the single test `test_worker_reads_latest_allocator_preferences` to actually exercise the fresh-preferences contract rather than short-circuit before the assertion. No production-code deviations. No scope creep — every fix was strictly required for the test-as-specified to run end-to-end.

## Issues Encountered

- **None related to the plan.** Test framework needed the `.venv/bin/activate` preamble to find pandas on the PATH (project convention; not a plan issue). Documented for future sessions.

## User Setup Required

None — all changes are Python-code-only against already-live database state. Migration 062 was applied by Plan 03-01 Task 3 (W2-PUSH) to the linked Supabase project. No new dependencies, no new env vars, no new external services.

## Next Phase Readiness

- **Phase 3 is COMPLETE at the code level.** Both plans in Phase 3 have shipped their code and tests:
  - 03-01: migration 062 LIVE, match_engine v2.0.0, 25 new unit tests
  - 03-02: routers/match.py skip-logic + subtype mapping, worker dispatch, 5 new integration tests
- **SCORING-01 through SCORING-07 all satisfied.** Full traceability in VALIDATION.md.
- **D-12 Option B end-to-end chain is live.** Starting now, when an allocator writes a mandate via `update_allocator_mandates`, Postgres' RPC body runs `PERFORM enqueue_compute_job(kind='rescore_allocator', p_allocator_id=auth.uid())`, the compute_jobs row lands with the CHECK constraints satisfied, the worker's next tick picks it up, `dispatch()` routes to `run_rescore_allocator_job`, and `_score_one_allocator(allocator_id, universe)` produces a fresh v2.0.0 batch. The `compute_jobs_one_inflight_per_kind_allocator` partial unique index dedupes repeated mandate writes on the same allocator to one in-flight job.
- **Phase 4 readiness:** Phase 4 (feedback-loop) will read from `bridge_outcomes` + `match_batches.effective_preferences` to compute per-dimension success_rate and write to `allocator_preferences.scoring_weight_overrides`. Because Phase 4 does NOT bump `ENGINE_VERSION`, the skip-logic triple check relies on `mandate_edited_at` OR a Phase-4-initiated proactive enqueue to invalidate cached batches. Phase 4 will need to either (a) add a new compute_job kind `rescore_from_feedback` that mirrors `rescore_allocator` or (b) write to `scoring_weight_overrides` via a SECURITY DEFINER RPC that also PERFORMs an `enqueue_compute_job(kind='rescore_allocator', p_allocator_id=...)`. Both paths are unblocked by this plan.
- **No blockers.**

## Self-Check: PASSED

- `analytics-service/tests/test_match_integration.py` — FOUND (252 lines, 5 tests collected, all pass)
- `analytics-service/routers/match.py` — MODIFIED (triple check + subtype mapping verified by grep: engine_version=5, mandate_edited_at=4, "subtypes,"=1, "subtype": primary_subtype=1)
- `analytics-service/services/job_worker.py` — MODIFIED (rescore_allocator=6, run_rescore_allocator_job=3 — all plan thresholds exceeded)
- Commit `fbca15d` (W0) — FOUND in git log
- Commit `35ec80b` (W1-A) — FOUND in git log
- Commit `b37a361` (W1-B) — FOUND in git log
- Full analytics-service suite — 452 passed, 0 failed, coverage 81.05% (≥80% threshold)
- Plan 03-01 regression — 58/58 match_engine+match_defaults tests green
- test_job_worker regression — 27/27 green
- 5 new integration tests — all green

---
*Phase: 03-mandate-aware-scoring-engine*
*Completed: 2026-04-18*
