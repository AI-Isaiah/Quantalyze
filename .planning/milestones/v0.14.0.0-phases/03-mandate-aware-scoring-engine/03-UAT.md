---
status: complete
phase: 03-mandate-aware-scoring-engine
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md
started: 2026-04-19T18:10:00Z
updated: 2026-04-19T18:40:00Z
mode: /qa autonomous (no human-in-loop)
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: analytics-service + Next.js boot from cold without error; migration 062 is already applied; health check returns live data.
result: pass
evidence: "python -c 'import main' from analytics-service imports cleanly. ENGINE_VERSION=v2.0.0, WEIGHTS_VERSION=v2.0.0, all 5 new DEFAULT_PREFERENCES mandate keys present. TIMEOUT_PER_KIND['rescore_allocator']=300. Next.js on :3000 responds at /login with 200."

### 2. ENGINE_VERSION bumped to v2.0.0 (SCORING-01)
expected: `ENGINE_VERSION` and `WEIGHTS_VERSION` constants both equal `"v2.0.0"`; v1 cached batches invalidated via version-check short-circuit.
result: pass
evidence: "test_engine_version_bumped + test_skip_on_engine_version_mismatch green."

### 3. mandate_fit_score present in score_breakdown (SCORING-02)
expected: Every new `match_candidates` row has `mandate_fit_score` ∈ [0.0, 1.0] in score_breakdown JSONB (both modes).
result: pass
evidence: "test_mandate_fit_key_present_both_modes green."

### 4. max_weight constraint taper below 1.0 (SCORING-03)
expected: allocator max_weight=0.10, candidate add_weight=0.25 → mandate_fit_score < 1.0 via linear taper; final score lower.
result: pass
evidence: "test_max_weight_violation_tapers_below_one green."

### 5. Empty mandates → rank order preserved (SCORING-04)
expected: Allocator with NULL mandates gets mandate_fit_score=1.0 on every candidate; v1→v2 rank order identical.
result: pass
evidence: "test_empty_mandates_fit_score_one + test_v1_prefs_backward_compat_rank_order green."

### 6. effective_preferences snapshot includes mandate keys (SCORING-06)
expected: `match_batches.effective_preferences` contains all 5 new mandate keys; frozen in fixture.
result: pass
evidence: "fixtures/match_engine_v2_golden.json shows scoring_weight_overrides:null + the 5 keys. Live-DB vitest schema-sync projection green (2/2)."

### 7. Composition 0.6 preference + 0.4 mandate (SCORING-03, D-02)
expected: effective_preference_fit = 0.6 × preference_fit + 0.4 × mandate_fit_score inside W_PREFERENCE_FIT; top-level weights sum = 1.0.
result: pass
evidence: "test_weight_overrides_normalization_invariant green."

### 8. scoring_weight_overrides clamp + renormalize (D-08)
expected: Override values outside [0.5, 1.5] clamped; effective weights renormalize to sum=1.0 ± 1e-9; extreme 10.0 == 1.5.
result: pass
evidence: "test_weight_overrides_clamp_to_one_point_five green."

### 9. Triple-check skip logic (SCORING-05)
expected: `_should_skip_allocator` short-circuits: force → engine_version → mandate_edited_at → age guard.
result: pass
evidence: "test_skip_force_and_fresh + test_skip_on_engine_version_mismatch + test_skip_on_mandate_edit all green."

### 10. Subtype mapping for style_exclusions (SCORING-07, Pitfall 1 fix)
expected: `_load_candidate_universe` populates candidate['subtype']; style_exclusions filter end-to-end.
result: pass
evidence: "test_style_excluded_hard_exclude green. test_correlation_ceiling_breach_penalty also green (dimension independence)."

### 11. rescore_allocator worker dispatch end-to-end
expected: dispatch() routes kind='rescore_allocator' to run_rescore_allocator_job; handler reads allocator_id; calls _load_candidate_universe + _score_one_allocator.
result: pass
evidence: "test_dispatch_routes_rescore_allocator + test_worker_reads_latest_allocator_preferences green. TIMEOUT_PER_KIND['rescore_allocator']=300 confirmed at import time."

### 12. scoring_weight_overrides column exists on live DB
expected: information_schema shows scoring_weight_overrides on public.allocator_preferences, jsonb, nullable.
result: pass
evidence: "Live-DB query confirms col_swo=pass."

### 13. rescore_allocator kind registered on live DB
expected: `compute_job_kinds` has row name='rescore_allocator'.
result: pass
evidence: "Live-DB query confirms kind_rescore_allocator=pass."

### 14. update_allocator_mandates RPC body contains PERFORM enqueue
expected: pg_get_functiondef returns body containing PERFORM enqueue_compute_job(p_kind := 'rescore_allocator', ...).
result: pass
evidence: "Full function body dumped: contains literal PERFORM enqueue_compute_job(..., p_kind := 'rescore_allocator', p_allocator_id := v_auth_uid) at end."

### 15. TypeScript contract: AllocatorPreferences includes scoring_weight_overrides
expected: tsc clean; preferences.ts declares Record<string, number> | null (required); ALLOCATOR_PREFERENCES_COLUMNS ends with scoring_weight_overrides.
result: pass
evidence: "npx tsc --noEmit exit 0, no output."

### 16. Vitest schema-sync live-DB projection green
expected: HAS_LIVE_DB=1 npx vitest run src/__tests__/mandate-columns-schema-sync.test.ts passes 2/2.
result: pass
evidence: "2 test files / 4 tests passed (schema-sync static + live-DB + vercel-cron-limits 2/2)."

### 17. Browser E2E — /allocations renders without regression
expected: Demo allocator sign-in → /profile?tab=mandate renders mandate slider + style checkboxes + ticket-size + advanced. /allocations renders widgets with no console errors.
result: pass
evidence: "Login flow 200. /profile?tab=mandate shows Max weight slider (0.05–0.50, default 0.28), 7 style-exclusion checkboxes (Long-Only..Other), 3 exchange checkboxes, ticket size spinbutton, mandate textarea, Advanced constraints expander. /allocations renders Equity Curve + Drawdown Chart + Correlation Matrix + 5 more widgets. Console: 2 Recharts width(-1)/height(-1) warnings during initial layout (pre-existing — not introduced by Phase 3/4). Zero errors."

### 18. [bonus] API /api/preferences PUT fires enqueue — dedup behavior
expected: PUT /api/preferences {max_weight: 0.15} returns 200; mandate_edited_at updates; a rescore_allocator compute_job exists in pending state (either newly created or the pre-existing one held by the partial-unique index).
result: pass
evidence: "PUT returned 200 {success:true}. mandate_edited_at advanced from 13:43:18 → 16:36:19 → 16:38:27. Pre-existing pending rescore_allocator job id=d89e7f3f-48b3... (created 12:43:09) holds the single-inflight slot per the partial unique index `(allocator_id, kind) WHERE status IN ('pending','running','done_pending_children')`. Subsequent PUTs correctly dedup per D-12 Option B design. No worker running locally → job stays pending (operational state, not a code gap)."

## Summary

total: 18
passed: 18
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
