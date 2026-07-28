---
status: complete
phase: 04-feedback-loop
source: 04-01-SUMMARY.md
started: 2026-04-19T18:10:00Z
updated: 2026-04-19T18:40:00Z
mode: /qa autonomous (no human-in-loop)
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: analytics-service + Next.js boot from cold without error; migration 063 is live; Phase 4 lazy seam doesn't trigger at module load.
result: pass
evidence: "Import of routers.match confirms services.feedback_engine NOT in sys.modules (D6 lazy-import invariant). feedback_engine.compute_adjusted_weights imports cleanly on demand. Migration 063 registered in schema_migrations as version 063."

### 2. Ceiling: high success rate → 1.5x (SC1, FEEDBACK-03)
expected: ≥5 outcomes, success rate > 0.7 in a dimension → scoring_weight_overrides[W_X] == 1.5.
result: pass
evidence: "test_ceiling_on_high_rate green. Golden fixture feedback_engine_v1_ceiling_golden.json == {\"W_PORTFOLIO_FIT\": 1.5}."

### 3. Floor: low success rate → 0.5x (SC2, FEEDBACK-03)
expected: ≥5 outcomes, success rate < 0.4 in a dimension → scoring_weight_overrides[W_X] == 0.5.
result: pass
evidence: "test_floor_on_low_rate green. Golden fixture feedback_engine_v1_floor_golden.json == {\"W_PREFERENCE_FIT\": 0.5}."

### 4. Cold start under 5 outcomes (SC3, FEEDBACK-04)
expected: <5 outcomes in a dimension → dimension omitted from override dict; all-cold → {}.
result: pass
evidence: "test_cold_start_under_five + test_omit_undertrained_dims green. Golden fixture feedback_engine_v1_cold_golden.json == {}."

### 5. Per-dimension independence (SC4, FEEDBACK-03)
expected: Dimensions computed independently; one dimension can hit ceiling while another is cold.
result: pass
evidence: "test_per_dimension_independence green."

### 6. Persistence + snapshot (SC5, FEEDBACK-05, FEEDBACK-06)
expected: Overrides persisted to allocator_preferences.scoring_weight_overrides; audit feedback.overrides_updated emitted; flows into match_batches.effective_preferences.
result: pass
evidence: "test_persist_column + test_inline_merge_reaches_snapshot + test_full_scoring_propagation green. scoring_weight_overrides column verified live on Supabase. Audit union 'feedback.overrides_updated' registered in src/lib/audit.ts:133."

### 7. Rejection reason → dimension mapping (D-05)
expected: REJECTION_REASON_TO_DIMENSION has exactly 3 entries; already_owned + other intentionally omitted.
result: pass
evidence: "test_rejection_reason_mapping green."

### 8. D3 fast-path probe for empty history
expected: Allocator with zero bridge_outcomes returns {} in ≤ 2 round-trips.
result: pass
evidence: "test_fastpath_skip_no_outcomes green."

### 9. Migration 063 body contains two-phase CTE
expected: compute_bridge_outcome_deltas body has UPDATE ... RETURNING bo.allocator_id + array_agg(DISTINCT allocator_id) + FOREACH ... PERFORM enqueue_compute_job.
result: pass
evidence: "Live-DB checks all green: compute_deltas_has_array_agg=1, compute_deltas_has_foreach_perform=1, compute_deltas_has_update_returning=1, compute_deltas_rescore_literal=1."

### 10. pg_cron 0 3 * * * schedule intact
expected: cron.job row jobname='compute_bridge_outcome_deltas', schedule='0 3 * * *', active=true.
result: pass
evidence: "Live-DB check cron_schedule_intact=1."

### 11. Audit taxonomy sync (D7)
expected: src/lib/audit.ts unions extended; ADR-0023 tables sync.
result: pass
evidence: "grep confirms src/lib/audit.ts:133 'feedback.overrides_updated' + :175 'allocator_preference_feedback'. ADR-0023 line 156 registers both. Same-commit sync (f89115c per SUMMARY)."

### 12. Lazy import: feedback_engine not imported at module load (D6)
expected: routers.match imports without pulling in services.feedback_engine.
result: pass
evidence: "Fresh Python interpreter: `import routers.match` then assert 'services.feedback_engine' not in sys.modules → passes. services.feedback_engine only appears after explicit import. test_lazy_import_not_triggered_at_module_load (subprocess) green."

### 13. Full scoring propagation (SC5 end-to-end)
expected: compute_adjusted_weights output reaches score_candidates(prefs) AND match_batches.effective_preferences snapshot.
result: pass
evidence: "test_full_scoring_propagation green."

### 14. 3-scenario golden snapshots green
expected: cold={}, ceiling={W_PORTFOLIO_FIT:1.5}, floor={W_PREFERENCE_FIT:0.5}. D2 anti-silent-accept sentinel active.
result: pass
evidence: "Fixture contents exactly match. Full feedback_engine suite: 34 passed in 3.36s."

### 15. Vercel cron cap (Hobby 2/2) preserved
expected: vercel-cron-limits.test.ts passes 2/2; no new Vercel cron in Phase 4 (uses pg_cron).
result: pass
evidence: "npx vitest run src/__tests__/vercel-cron-limits.test.ts 2/2 passed."

## Summary

total: 15
passed: 15
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
