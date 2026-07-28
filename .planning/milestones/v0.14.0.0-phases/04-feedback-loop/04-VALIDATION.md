---
phase: 4
slug: feedback-loop
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-18
updated: 2026-04-18
verified: 2026-04-19
revision: voice_revision (VOICES-ACCEPTED C1, D1, D2, D3, D5, D6, D7, D8)
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) with `asyncio_mode = auto` |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && pytest tests/test_feedback_engine.py -x -q` |
| **Full suite command** | `cd analytics-service && pytest --cov=services --cov-report=term-missing` |
| **Estimated runtime** | ~10s quick; ~95s full analytics-service suite |

---

## Sampling Rate

- **After every task commit:** `cd analytics-service && pytest tests/test_feedback_engine.py -x -q`
- **After every plan wave:** `cd analytics-service && pytest --cov=services.feedback_engine --cov-report=term-missing -x` (target ≥90% line coverage on new module)
- **Before `/gsd-verify-work`:** Full `analytics-service` suite green (currently 452 tests; Phase 4 adds 28)
- **Max feedback latency:** 10s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-W0-A | 01 | 0 | FEEDBACK-01..06 | — | test scaffolds red before implementation | unit | `pytest analytics-service/tests/test_feedback_engine.py --collect-only` | ❌ W0 | ⬜ pending |
| 04-01-01 | 01 | 1 | FEEDBACK-01 | — | `compute_adjusted_weights` exists + returns dict | unit | `pytest tests/test_feedback_engine.py::test_public_signature -x` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | FEEDBACK-02 | — | Floor 0.5× when success_rate < 0.4 | unit | `pytest tests/test_feedback_engine.py::test_floor_on_low_rate -x` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | FEEDBACK-02 | — | Ceiling 1.5× when success_rate > 0.7 | unit | `pytest tests/test_feedback_engine.py::test_ceiling_on_high_rate -x` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | FEEDBACK-02 | — | No change when 0.4 ≤ rate ≤ 0.7 | unit | `pytest tests/test_feedback_engine.py::test_no_change_in_band -x` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | FEEDBACK-02 | — | Step-function boundaries (0.3, 0.4, 0.5, 0.7, 0.8) | unit | `pytest tests/test_feedback_engine.py::test_step_function_boundaries -x` | ❌ W0 | ⬜ pending |
| 04-01-06 | 01 | 1 | FEEDBACK-03 | — | <5 outcomes → no adjustment (cold start) | unit | `pytest tests/test_feedback_engine.py::test_cold_start_under_five -x` | ❌ W0 | ⬜ pending |
| 04-01-07 | 01 | 1 | FEEDBACK-03 | — | Exactly 5 outcomes → adjustment fires | unit | `pytest tests/test_feedback_engine.py::test_threshold_at_five -x` | ❌ W0 | ⬜ pending |
| 04-01-08 | 01 | 1 | FEEDBACK-04 | T-04-02 | `scoring_weight_overrides` column reflects adjustment | integration (mocked Supabase) | `pytest tests/test_feedback_engine.py::test_persist_column -x` | ❌ W0 | ⬜ pending |
| 04-01-09 | 01 | 1 | FEEDBACK-04 | — | Empty result → column set to NULL | integration | `pytest tests/test_feedback_engine.py::test_persist_null_on_cold_start -x` | ❌ W0 | ⬜ pending |
| 04-01-10 | 01 | 1 | FEEDBACK-05 | — | Dimensions adjust independently (per-dim min-5) | unit | `pytest tests/test_feedback_engine.py::test_per_dimension_independence -x` | ❌ W0 | ⬜ pending |
| 04-01-11 | 01 | 1 | FEEDBACK-06 | — | `match_batches.effective_preferences` snapshot receives overrides via inline merge | integration | `pytest tests/test_feedback_engine.py::test_inline_merge_reaches_snapshot -x` | ❌ W0 | ⬜ pending |
| 04-01-12 | 01 | 1 | D-05 | — | Allocated outcome → attribution by max(score_breakdown.*) | unit | `pytest tests/test_feedback_engine.py::test_score_dominant_attribution -x` | ❌ W0 | ⬜ pending |
| 04-01-13 | 01 | 1 | D-06 | — | REJECTION_REASON_TO_DIMENSION = 3 direct-mapped keys (mandate_conflict→PREF, underperforming_peers→TRACK, timing_wrong→PORTFOLIO); `already_owned` AND `other` intentionally ABSENT (D5 finding) | unit | `pytest tests/test_feedback_engine.py::test_rejection_reason_mapping -x` | ❌ W0 | ⬜ pending |
| 04-01-14 | 01 | 1 | D-07 | — | Missing match_candidates row → uniform fallback | unit | `pytest tests/test_feedback_engine.py::test_uniform_fallback_missing_history -x` | ❌ W0 | ⬜ pending |
| 04-01-15 | 01 | 1 | D-08 | — | `rejection_reason='already_owned'` rows dropped before min-5 | unit | `pytest tests/test_feedback_engine.py::test_filter_already_owned -x` | ❌ W0 | ⬜ pending |
| 04-01-16 | 01 | 1 | D-08 | — | `percent_allocated < 1.0` rows dropped | unit | `pytest tests/test_feedback_engine.py::test_filter_small_allocation -x` | ❌ W0 | ⬜ pending |
| 04-01-17 | 01 | 1 | D-03 | — | Pending (all-NULL delta) rows dropped | unit | `pytest tests/test_feedback_engine.py::test_filter_pending -x` | ❌ W0 | ⬜ pending |
| 04-01-18 | 01 | 1 | D-14 | — | Stateless determinism — same inputs → same outputs | unit | `pytest tests/test_feedback_engine.py::test_determinism -x` | ❌ W0 | ⬜ pending |
| 04-01-19 | 01 | 1 | D-16 | — | Under-threshold dim omitted from result dict | unit | `pytest tests/test_feedback_engine.py::test_omit_undertrained_dims -x` | ❌ W0 | ⬜ pending |
| 04-01-20 | 01 | 1 | Pitfall 6 | — | Screening-mode outcomes exclude `W_PORTFOLIO_FIT` from score-dominant attribution | unit | `pytest tests/test_feedback_engine.py::test_screening_mode_excludes_portfolio_fit -x` | ❌ W0 | ⬜ pending |
| 04-01-21 | 01 | 1 | Golden (3-scenario per D2) | T-04-03 | v1 output byte-identical to each of 3 scenario fixtures (cold `{}` / ceiling `{"W_PORTFOLIO_FIT": 1.5}` / floor `{"W_PREFERENCE_FIT": 0.5}`); REGENERATE_GOLDEN=1 refuses to accept `{}` for ceiling/floor | unit | `pytest tests/test_feedback_engine.py::test_golden_snapshot -x` (regen: `REGENERATE_GOLDEN=1 ...`) | ❌ W0 | ⬜ pending |
| 04-01-22 | 01 | 1 | D-11 dispatch | — | `rescore_allocator` worker dispatch → inline `compute_adjusted_weights` fires → scoring_weight_overrides UPDATEd | integration (mocked) | `pytest tests/test_feedback_engine.py::test_dispatch_through_worker -x` | ❌ W0 | ⬜ pending |
| 04-01-23 | 01 | 1 | D-12 | T-04-04 | Migration 063 self-verify DO block — body contains `PERFORM enqueue_compute_job`, `'rescore_allocator'`, `RETURNING bo.allocator_id` (D1 CTE capture), `array_agg(DISTINCT allocator_id)` (D1 UUID[]), `extract_delta(` (C1 CTE parity pin) | migration self-verify + static CI check | `supabase db push` (apply-time) + `pytest tests/test_feedback_engine.py::test_migration_063_body_has_enqueue -x` (CI) | ❌ W0 | ⬜ pending |
| 04-01-24 | 01 | 1 | Audit | T-04-01 | Every `scoring_weight_overrides` write emits an audit event with `entity_type='allocator_preference_feedback'` | unit (audit stub) | `pytest tests/test_feedback_engine.py::test_audit_event_emitted -x` | ❌ W0 | ⬜ pending |
| 04-01-25 | 01 | 1 | D-12 + C1 + D1 | T-04-04 | Transition-vs-unchanged seed: only rows with NULL→non-NULL delta transitions enqueue; unchanged rows do NOT enqueue. Live-DB variant gated on HAS_LIVE_DB; mocked counterpart asserts migration 063 UPDATE predicate restricts on (delta_Xd IS NULL AND c.dXX IS NOT NULL) for all three delta columns | integration (live-DB gated) + unit (mocked) | `HAS_LIVE_DB=1 pytest tests/test_feedback_engine.py::test_migration_063_enqueues_only_transitioned_allocators -x` (live) ; `pytest tests/test_feedback_engine.py::test_migration_063_enqueues_only_transitioned_allocators -x` (mocked, unconditional) | ❌ W0 | ⬜ pending |
| 04-01-26 | 01 | 1 | D3 hot-path | — | Fast-path probe: allocator with zero bridge_outcomes rows returns `{}` with at most 1 Supabase `table()` call (the probe) and up to 2 if D-16 NULL-write path is retained. `_should_skip_allocator` optimization budget preserved | unit (call-count assertion) | `pytest tests/test_feedback_engine.py::test_fastpath_skip_no_outcomes -x` | ❌ W0 | ⬜ pending |
| 04-01-27 | 01 | 1 | D6 lazy-import | — | `routers.match` import does NOT eagerly import `services.feedback_engine`; body-indented 4-space import enforces function-body placement; `'services.feedback_engine' not in sys.modules` after `import routers.match` alone | unit (sys.modules probe) | `pytest tests/test_feedback_engine.py::test_lazy_import_not_triggered_at_module_load -x` | ❌ W0 | ⬜ pending |
| 04-01-28 | 01 | 1 | D8 FEEDBACK-06 end-to-end | — | Full propagation: seed bridge_outcomes s.t. `compute_adjusted_weights` returns `{"W_PORTFOLIO_FIT": 1.5}`; run `_score_one_allocator`; assert (a) captured `preferences["scoring_weight_overrides"] == {"W_PORTFOLIO_FIT": 1.5}`, (b) `match_batches.effective_preferences["scoring_weight_overrides"]` mirrors it, (c) normalized top-level `W_PORTFOLIO_FIT` weight equals the expected post-clamp-post-renormalize value within 1e-9 | integration (mocked Supabase) | `pytest tests/test_feedback_engine.py::test_full_scoring_propagation -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_feedback_engine.py` — NEW file with 28 stub tests + `try/except ImportError` guard + `IMPORTS_OK` sentinel + `HAS_LIVE_DB` gate + `REGENERATE_GOLDEN=1` hook + `GOLDEN_SCENARIOS` tuple
- [ ] `analytics-service/tests/fixtures/feedback_engine_v1_cold_golden.json` — NEW placeholder (sentinel `{"__placeholder": "regenerate via REGENERATE_GOLDEN=1"}`)
- [ ] `analytics-service/tests/fixtures/feedback_engine_v1_ceiling_golden.json` — NEW placeholder (sentinel, same shape as cold)
- [ ] `analytics-service/tests/fixtures/feedback_engine_v1_floor_golden.json` — NEW placeholder (sentinel, same shape as cold)
- [ ] No framework install needed — pytest + asyncio-auto already configured via `analytics-service/pytest.ini`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Delta-cron SQL extension fires `rescore_allocator` enqueue in production pg_cron run for ONLY transitioned allocators (D1 + D-11) | D-12 / FEEDBACK-04 downstream | pg_cron runs server-side; observable only via `SELECT * FROM compute_jobs WHERE kind = 'rescore_allocator' ORDER BY created_at DESC LIMIT 10;` after a production delta cron tick. Migration self-verify covers function body; actual cron invocation requires deploy + wait. Transition-vs-unchanged behavior verified by test 04-01-25 mocked counterpart at CI + live-DB variant when HAS_LIVE_DB set. | Post-deploy: (1) verify function body via `\df+ compute_bridge_outcome_deltas` contains the two-phase CTE with `RETURNING bo.allocator_id` + `array_agg(DISTINCT allocator_id)`; (2) after next 03:00 UTC tick, query `compute_jobs` for recent `rescore_allocator` rows; (3) cross-check that distinct allocator_ids in the batch match ONLY those who saw a NULL→non-NULL delta transition in `bridge_outcomes` since the previous cron run (compare `deltas_computed_at` before/after). |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (one manual post-deploy verification is non-blocking)
- [x] Sampling continuity: every task commits a test; no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`test_feedback_engine.py` + 3 golden fixture placeholders)
- [x] No watch-mode flags (all commands use `-x` single-run)
- [x] Feedback latency < 10s (quick run target)
- [ ] `nyquist_compliant: true` set in frontmatter (flipped after Wave 0 lands)
- [x] VOICES-ACCEPTED findings integrated: C1 (04-01-23 body check extended) + D1 (04-01-25 + 04-01-23) + D2 (04-01-21 now 3-scenario) + D3 (04-01-26 new) + D5 (04-01-13 rewritten) + D6 (04-01-27 new) + D7 (04-01-24 + ADR-0023 sync in PLAN Task 1) + D8 (04-01-28 new).

**Approval:** pending
