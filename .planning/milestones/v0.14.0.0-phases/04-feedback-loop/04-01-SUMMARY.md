---
phase: 04-feedback-loop
plan: 01
subsystem: scoring-engine

tags:
  - feedback-engine
  - python
  - supabase
  - pg_cron
  - migration
  - scoring
  - audit
  - tdd
  - analytics-service

# Dependency graph
requires:
  - phase: 01-outcome-tracker
    provides: "`bridge_outcomes` table with rejection_reason enum + percent_allocated + delta_30d/90d/180d columns + deltas_computed_at timestamp (migration 059); pg_cron schedule `0 3 * * *` executes `compute_bridge_outcome_deltas()` daily (migration 060)"
  - phase: 03-mandate-aware-scoring-engine
    provides: "`match_engine.py` v2.0.0 reads `prefs.scoring_weight_overrides` and defensively clamps to [0.5, 1.5] + renormalizes; `match_defaults.merge_with_defaults` carries None-skipping semantics so injected overrides flow into `match_batches.effective_preferences` without snapshot-code changes (FEEDBACK-06 comes for free); migration 062 ships `scoring_weight_overrides` JSONB column + `enqueue_compute_job(..., p_allocator_id UUID)` signature + `rescore_allocator` compute_jobs kind + `compute_jobs_one_inflight_per_kind_allocator` partial unique index for dedup"
provides:
  - "analytics-service/services/feedback_engine.py (NEW) — compute_adjusted_weights(allocator_id) public entry + D3 fast-path probe (_has_any_bridge_outcomes) + _fetch_eligible_outcomes (D-08 SQL filters) + _fetch_score_breakdowns + _success_value (D-01/D-02 most-mature delta) + _attribute_dimension (D-05 hybrid: rejection enum -> W_i; otherwise score-dominant max; D-07 uniform fallback; Pitfall 6 key-presence guard) + _apply_shape (D-13 step function + D-15 min-5 gate + D-16 omit-key semantics) + _persist_overrides (writes allocator_preferences.scoring_weight_overrides + audit emission gated on UPDATE-affected) + REJECTION_REASON_TO_DIMENSION constant (3 direct mappings; already_owned + other intentionally omitted per D5 finding)"
  - "analytics-service/routers/match.py — surgical 7-line lazy seam inside `_score_one_allocator` immediately after `ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)`. `from services.feedback_engine import compute_adjusted_weights` at 4-space function-body indent (D6 — lazy import enforced by grep); `overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)` + None-preferences guard + `ctx['preferences']['scoring_weight_overrides'] = overrides or None`"
  - "supabase/migrations/063_feedback_delta_enqueue.sql (NEW) — CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas with two-phase CTE: Phase A UPDATE ... RETURNING bo.allocator_id + SELECT array_agg(DISTINCT allocator_id) INTO v_allocator_ids; Phase B FOREACH v_allocator_id IN ARRAY v_allocator_ids LOOP BEGIN PERFORM enqueue_compute_job(p_kind:='rescore_allocator', p_allocator_id:=v_allocator_id) EXCEPTION WHEN OTHERS subtransaction. Predicate restricts UPDATE to rows transitioning NULL -> non-NULL on any of delta_30d/90d/180d (D1 fix — the old `SELECT DISTINCT allocator_id FROM bridge_outcomes WHERE deltas_computed_at = v_started` pattern fires on every touched row, not just transitions, and is EXPLICITLY REJECTED). Hardened self-verify DO block asserts 5 patterns via pg_get_functiondef string search + 1 null-body check, each raising EXCEPTION on failure"
  - "src/lib/audit.ts — AuditAction union extended with 'feedback.overrides_updated'; AuditEntityType union extended with 'allocator_preference_feedback' (strictly additive, under new '// --- Sprint 8 Phase 4: Feedback loop' block)"
  - "docs/architecture/adr-0023-audit-event-taxonomy.md — registered-actions + registered-entities tables each extended with the feedback row (D7 sync gate mirrors the src/lib/audit.ts unions)"
  - "analytics-service/tests/test_feedback_engine.py (NEW) — 28 def test_ names matching VALIDATION.md rows 04-01-01..04-01-28; IMPORTS_OK sentinel pattern (Phase 3 test_match_integration.py:14-31 precedent); _make_outcome + _make_mock_supabase helpers; 3-scenario golden snapshot loop with REGENERATE_GOLDEN=1 guard + D2 anti-silent-accept sentinel (ceiling/floor regenerating to {} fails the test); in-band parametrize sweep at strict < 0.4 / > 0.7 boundaries"
  - "analytics-service/tests/fixtures/feedback_engine_v1_{cold,ceiling,floor}_golden.json (NEW × 3) — frozen v1 outputs per scenario: cold={}, ceiling={\"W_PORTFOLIO_FIT\": 1.5}, floor={\"W_PREFERENCE_FIT\": 0.5}"
affects:
  - 05-outcomes-dashboard (widget reads bridge_outcomes; Phase 4 has no UI surface but the feedback loop is now closed end-to-end so dashboard copy can reference \"your last rescore\" accurately)
  - future-engine-version-bumps (ENGINE_VERSION='v2.0.0' NOT bumped by Phase 4; _should_skip_allocator version trigger stays quiet; invalidation happens via the `rescore_allocator` enqueue from migration 063 + the fresh-write path through Phase 2's RPC)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D3 fast-path probe: `_has_any_bridge_outcomes` runs a count='exact'.limit(1) SELECT on bridge_outcomes before any attribution work. Allocators with zero history return `{}` in one Supabase round-trip, preserving the Phase 3 `_should_skip_allocator` optimization budget inside `_scoring_semaphore`."
    - "D6 body-placed lazy import: `from services.feedback_engine import compute_adjusted_weights` at 4-space indent inside `_score_one_allocator`, NOT module-level. Enforced by regression test `test_lazy_import_not_triggered_at_module_load` (subprocess isolation to avoid pytest sys.modules contamination — see Deviations)."
    - "D-13 step function: rate < 0.4 -> 0.5x; 0.4 <= rate <= 0.7 -> omit key (D-16 — missing key means 1.0x to match_engine defensive clamp); rate > 0.7 -> 1.5x. No smoothing / linear interpolation."
    - "D-16 omit-key semantics: in-band dimensions never appear in the output dict. match_engine.py reads `overrides.get('W_i', 1.0)` defensively — omitted key equals 1.0x at the consumer. Empty result dict triggers NULL write to scoring_weight_overrides column."
    - "Two-phase CTE for transition-scoped enqueue (D1): UPDATE ... RETURNING bo.allocator_id -> array_agg(DISTINCT allocator_id) -> FOREACH PERFORM. Predicate subclauses `(delta_30d IS NULL AND c.d30 IS NOT NULL)` per delta column ensure only NULL -> non-NULL transitions appear in the RETURNING rowset, not every UPDATE-touched row. Inner BEGIN...EXCEPTION WHEN OTHERS subtransaction isolates individual enqueue failures so one bad allocator cannot abort the batch."
    - "D7 ADR sync gate: src/lib/audit.ts AuditAction/AuditEntityType additions are mirrored in docs/architecture/adr-0023-audit-event-taxonomy.md registered-actions + registered-entities tables in the same commit. Preserves doc-drift protection per Phase 2 precedent."
    - "Supabase MCP apply_migration wrapper: strip the outer BEGIN;/COMMIT; brackets from migration body SQL — the MCP manages its own transaction. Keep SET lock_timeout, CREATE OR REPLACE, REVOKE/GRANT, DO block intact. Post-apply reconcile `supabase_migrations.schema_migrations.version` from the MCP's timestamp (e.g. `20260419061340`) back to the file prefix (e.g. `063`) so future `supabase db push` treats the migration as applied."
    - "Golden-snapshot 3-scenario loop: cold (12-outcome seed producing {}) + ceiling (5 allocated-positive + portfolio_fit-dominant -> {W_PORTFOLIO_FIT: 1.5}) + floor (5 rejected+mandate_conflict -> {W_PREFERENCE_FIT: 0.5}). REGENERATE_GOLDEN=1 writes each fixture; D2 sentinel refuses to silently accept ceiling/floor regenerating to {}."

key-files:
  created:
    - analytics-service/services/feedback_engine.py
    - analytics-service/tests/test_feedback_engine.py
    - analytics-service/tests/fixtures/feedback_engine_v1_cold_golden.json
    - analytics-service/tests/fixtures/feedback_engine_v1_ceiling_golden.json
    - analytics-service/tests/fixtures/feedback_engine_v1_floor_golden.json
    - supabase/migrations/063_feedback_delta_enqueue.sql
  modified:
    - analytics-service/routers/match.py
    - analytics-service/tests/test_match_integration.py
    - src/lib/audit.ts
    - docs/architecture/adr-0023-audit-event-taxonomy.md

key-decisions:
  - "Migration applied via Supabase MCP `apply_migration` (not CLI) — outer BEGIN/COMMIT stripped because the MCP wraps SQL in its own transaction. Post-apply, reconciled `supabase_migrations.schema_migrations.version` from the timestamp `20260419061340` back to file prefix `063` to keep local-file and remote-registry versioning aligned (Phase 1 precedent for file-prefix convention)."
  - "Ran Phase 4 directly on the phase-02-mandate-profile-builder branch (branching_strategy=none per config.json). Four task commits + this SUMMARY commit land on the same branch that has shipped phases 01-03."
  - "Subprocess isolation for `test_lazy_import_not_triggered_at_module_load`: the in-process `sys.modules.pop` + re-import pattern contaminated pytest's sys.modules state, breaking `test_full_scoring_propagation` (monkeypatch.setattr targeted the re-imported module while the test module's cached `compute_adjusted_weights` reference pointed to the pre-pop object). Subprocess keeps the D6 lazy-import assertion semantically identical while avoiding cross-test interference. Trade-off: ~400 ms extra runtime per invocation, accepted."
  - "Lazy import placed at function-body indent (4 spaces) INSIDE `_score_one_allocator` but OUTSIDE the `async with _scoring_semaphore:` block. Plan's `<action>` text put it inside the semaphore at 8-space indent, but the plan's own D6 acceptance grep required exactly 4-space indent. Moved the import to function-body top level while keeping the `compute_adjusted_weights(...)` call inside the semaphore where the ctx load happens — preserves lazy loading (still in-body, not module-level) and satisfies the exact grep."
  - "test_step_function_boundaries rewritten as a 7-case sweep with 10-outcome denominators producing exact rates 0.0/0.3/0.4/0.5/0.7/0.8/1.0 mapped to floor/floor/omit/omit/omit/ceiling/ceiling. The Wave 0 scaffold's initial `(2, 3, 0.5)` entry produced rate 0.4 which must OMIT (not floor) per strict `< 0.4` D-13 predicate — replaced."
  - "Migration 063 outer BEGIN;/COMMIT; brackets retained in the file (convention-aligned with migrations 060/062) but stripped at MCP apply time. The bracket pair is harmless for future `supabase db push --include-all` reruns (idempotent CREATE OR REPLACE). The file-level brackets also preserve the pattern for environments where the CLI (not MCP) executes the migration."

patterns-established:
  - "Lazy body-placed import as a performance + decoupling gate: new dependencies plugged into hot paths ship as function-local imports. Phase 5 and beyond should follow this pattern when adding new services that could otherwise bloat module load time or introduce circular dependencies."
  - "REGENERATE_GOLDEN=1 + anti-silent-accept sentinel: golden regeneration MUST fail when a non-cold scenario regenerates to a known-trivial output (like {}). Prevents future developers from running `REGENERATE_GOLDEN=1` after a broken math change and committing garbage fixtures."
  - "Migration self-verify DO block with pg_get_functiondef string search: 5-pattern assertion on the live function body catches CREATE OR REPLACE drift at apply time (e.g. accidental body replacement by a later migration). RAISE EXCEPTION rolls back the entire apply; the explicit BEGIN/COMMIT brackets make this atomic."
  - "Cross-layer audit taxonomy sync: src/lib/audit.ts TypeScript union + docs/architecture/adr-0023-audit-event-taxonomy.md registered-actions + registered-entities tables must be extended in the same commit (D7). Future analytics-service audit emissions should follow this 3-way sync."

requirements-completed:
  - FEEDBACK-01
  - FEEDBACK-02
  - FEEDBACK-03
  - FEEDBACK-04
  - FEEDBACK-05
  - FEEDBACK-06

# Metrics
duration: ~50m
completed: 2026-04-19
---

# Phase 04 Plan 01: feedback-loop — `services/feedback_engine.py` + routers/match.py lazy seam + migration 063 two-phase CTE + ADR/audit taxonomy sync + 3-scenario golden snapshots Summary

**Closed the Bridge recommendation-feedback loop: allocator outcomes now flow back into scoring weights via `services/feedback_engine.compute_adjusted_weights` (rule-based v1: D-13 step function, D-15 min-5 gate, D-16 omit-key semantics, D3 fast-path probe). The `rescore_allocator` worker — dispatched by migration 063's transition-scoped `pg_cron` enqueue (D1 two-phase CTE) — picks up delta updates and re-runs scoring. Overrides land in `allocator_preferences.scoring_weight_overrides` with audit emission and propagate through `match_engine.py`'s clamp + renormalize into `match_batches.effective_preferences`. FEEDBACK-01..06 satisfied; ROADMAP SC1–SC5 all green.**

## Performance

- **Duration:** ~50m (wall-clock orchestrator + subagent, not counting earlier discuss/plan phases)
- **Started:** 2026-04-19T07:30:00Z (approx — first Wave 0 commit at 07:41)
- **Completed:** 2026-04-19T08:20:00Z
- **Tasks:** 5 (Task 0 W0 red scaffolds, Task 1 W1-A production, Task 2 W1-B migration SQL file, Task 3 W1-BLOCK migration apply, Task 4 W1-C golden regen)
- **Files created:** 6 (feedback_engine.py, test_feedback_engine.py, 3 golden fixtures, migration 063)
- **Files modified:** 4 (routers/match.py, tests/test_match_integration.py, src/lib/audit.ts, ADR-0023)

## Accomplishments
- `services/feedback_engine.py` public `compute_adjusted_weights(allocator_id) -> dict[str, float]` with fast-path probe + 6 private helpers (96% line coverage; 4 uncovered lines are defensive log paths).
- Migration 063 live on Supabase project `khslejtfbuezsmvmtsdn` — `public.compute_bridge_outcome_deltas` now enqueues `rescore_allocator` jobs only for allocators whose outcomes transitioned NULL -> non-NULL on at least one delta column; `cron.job` schedule `0 3 * * *` intact from migration 060.
- 34 feedback_engine tests green (28 distinct `def test_` names; parametrize expansions push the runtime count higher) plus 452 pre-existing analytics-service tests still green — zero regressions.
- End-to-end propagation proved: `test_full_scoring_propagation` (04-01-28) asserts `compute_adjusted_weights` output reaches `score_candidates(prefs)` AND snapshots into `match_batches.effective_preferences` via Phase 3's `merge_with_defaults` (FEEDBACK-06 verified).
- Zero Vercel crons added — `src/__tests__/vercel-cron-limits.test.ts` still 2/2 green (Hobby 2/2 cap preserved; all Phase 4 scheduling rides existing pg_cron infrastructure).

## Task Commits

Each task was committed atomically on branch `phase-02-mandate-profile-builder`:

1. **Task 0: Wave 0-A red test scaffolds** — `ca8053f` (test: 28 feedback_engine tests + IMPORTS_OK sentinel + 3 golden placeholders)
2. **Task 1: Wave 1-A feedback_engine.py + match.py seam + audit.ts + ADR** — `f89115c` (feat: services/feedback_engine.py fast-path + routers/match.py lazy seam + src/lib/audit.ts taxonomy + ADR-0023 sync; FEEDBACK-01..06 D-01..D-16, D3+D6+D7)
3. **Task 2: Wave 1-B migration 063 two-phase CTE** — `5005bfa` (feat: supabase/migrations/063_feedback_delta_enqueue.sql; D-12 + D1 fix + C1 CTE parity)
4. **Task 3: Wave 1-BLOCK apply migration 063** — applied via Supabase MCP `apply_migration` (no git commit; migration registered in `supabase_migrations.schema_migrations` as version `063`, reconciled from timestamp)
5. **Task 4: Wave 1-C regenerate 3-scenario golden fixtures** — `6d67291` (test: cold/ceiling/floor fixture regen + full suite green; D2 fix)

**Plan metadata (this SUMMARY commit):** pending (follows this file write).

## Files Created/Modified
- `analytics-service/services/feedback_engine.py` — new module. Public `compute_adjusted_weights`. D3 fast-path `_has_any_bridge_outcomes`. D-08 SQL filters inside `_fetch_eligible_outcomes` (kind='rejected' neq already_owned; kind='allocated' gte percent_allocated 1.0; Python-side pending-delta drop). D-05 hybrid attribution in `_attribute_dimension` (rejection enum -> W_i; otherwise score-dominant max; D-07 uniform fallback). D-13 step function + D-15 min-5 + D-16 omit-key in `_apply_shape`. `_persist_overrides` writes column + audit emission gated on UPDATE-affected.
- `analytics-service/tests/test_feedback_engine.py` — new test file (1383 lines). 28 `def test_` names mapped to VALIDATION.md 04-01-01..04-01-28. IMPORTS_OK sentinel + 25 wave-0-placeholder skip guards. `_make_outcome` + `_make_mock_supabase` helpers for deterministic seeding. 3-scenario golden loop with D2 anti-silent-accept sentinel. Subprocess isolation for lazy-import test.
- `analytics-service/tests/fixtures/feedback_engine_v1_cold_golden.json` — frozen `{}`.
- `analytics-service/tests/fixtures/feedback_engine_v1_ceiling_golden.json` — frozen `{"W_PORTFOLIO_FIT": 1.5}`.
- `analytics-service/tests/fixtures/feedback_engine_v1_floor_golden.json` — frozen `{"W_PREFERENCE_FIT": 0.5}`.
- `supabase/migrations/063_feedback_delta_enqueue.sql` — new migration. Two-phase CTE (UPDATE RETURNING bo.allocator_id -> array_agg -> FOREACH PERFORM enqueue_compute_job). Inner BEGIN/EXCEPTION WHEN OTHERS per-iteration subtxn. Hardened self-verify DO block with 5 RAISE EXCEPTION assertions + 1 null-body check + 1 success NOTICE.
- `analytics-service/routers/match.py` — surgical 7-line insert inside `_score_one_allocator`: function-body 4-space lazy import (D6) + `await asyncio.to_thread(compute_adjusted_weights, allocator_id)` + None-preferences guard (Pitfall 1) + `ctx['preferences']['scoring_weight_overrides'] = overrides or None`.
- `analytics-service/tests/test_match_integration.py` — added mock for `services.feedback_engine.get_supabase` (empty probe -> D3 fast-path returns {}) + no-op audit stub in `test_worker_reads_latest_allocator_preferences`; required because Plan 04-01's new lazy seam in `_score_one_allocator` introduces a feedback_engine call path that the Phase 3 integration test was not prepared for. Zero change to test intent.
- `src/lib/audit.ts` — additive union extensions: `AuditAction += 'feedback.overrides_updated'`, `AuditEntityType += 'allocator_preference_feedback'`. Group comment `// --- Sprint 8 Phase 4: Feedback loop`.
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — registered-actions and registered-entities tables each extended with the feedback row (D7 sync gate).

## Migration Apply Log

Task 3 applied migration 063 via Supabase MCP `apply_migration` (the user explicitly authorized in-tool apply to skip the human-verify checkpoint — no dashboard operator action needed).

**Pre-apply** (sanity check against pre-phase function body):
```
has_perform_pre=false, has_returning_capture_pre=false, has_rescore_literal_pre=false
```
Confirmed the live function body on `khslejtfbuezsmvmtsdn` was still at migration 060's state before apply.

**Apply** (`mcp__plugin_supabase_supabase__apply_migration`, name=`feedback_delta_enqueue`):
```
{"success": true}
```

**Post-apply body verification** (`pg_get_functiondef` string search via `execute_sql`):
```
has_perform=true, has_returning_capture=true, has_rescore_literal=true,
has_array_agg=true, has_extract_delta=true, has_foreach_loop=true
```

**Cron schedule still intact:**
```
jobname='compute_bridge_outcome_deltas', schedule='0 3 * * *', command=' SELECT public.compute_bridge_outcome_deltas(); ', active=true
```

**Migration registry reconciled** — renamed the MCP-assigned timestamp `20260419061340` to the file-prefix `063` so `supabase db push --include-all` treats the migration as applied and does not re-run it. `schema_migrations` now contains rows for versions `062` and `063`.

**Rollback:** not triggered. Documented in the plan's Task 3 `<how-to-verify>` block. If ever needed, migration 060's body is preserved in that section as the verbatim snippet.

## Verification Results

| Check | Result |
|-------|--------|
| `pytest tests/test_feedback_engine.py` | 34/34 passed (28 unique test names; parametrize expansions) |
| `pytest` (full analytics-service suite) | 486/486 passed — zero regressions |
| `pytest --cov=services.feedback_engine` | **96%** line coverage on the new module (target was ≥90%) |
| `npm run typecheck` | exit 0 — TypeScript union additions compile cleanly |
| `npx vitest run src/__tests__/vercel-cron-limits.test.ts` | 2/2 passed (Hobby 2/2 cron cap sentinel preserved) |
| Migration 063 live body — 6 patterns | All true (has_perform, has_returning_capture, has_rescore_literal, has_array_agg, has_extract_delta, has_foreach_loop) |
| `cron.job` schedule — migration 060 | Active, `0 3 * * *`, command unchanged |
| ROADMAP SC1 (ceiling) | `test_ceiling_on_high_rate` + `test_full_scoring_propagation` + ceiling golden fixture all green |
| ROADMAP SC2 (floor) | `test_floor_on_low_rate` + floor golden fixture green |
| ROADMAP SC3 (cold start) | `test_cold_start_under_five` + `test_omit_undertrained_dims` + cold golden fixture green |
| ROADMAP SC4 (per-dim independence) | `test_per_dimension_independence` green |
| ROADMAP SC5 (persistence + snapshot) | `test_persist_column` + `test_persist_null_on_cold_start` + `test_inline_merge_reaches_snapshot` + `test_full_scoring_propagation` green |

## Deviations Applied

All deviations were Rule 1 (auto-fix bugs) or Rule 3 (auto-fix blockers) per execute-plan.md deviation protocol. No Rule 4 architectural escalations.

- **[Rule 1 — Bug fix]** `test_step_function_boundaries` — Wave 0 scaffold had `(2, 3, 0.5)` case which is rate=0.4; per strict `< 0.4` D-13 predicate, rate=0.4 OMITS (not floors). Replaced with a 7-case sweep using 10-outcome denominators for exact rates 0.0/0.3/0.4/0.5/0.7/0.8/1.0 mapped to floor/floor/omit/omit/omit/ceiling/ceiling. File: `analytics-service/tests/test_feedback_engine.py` parametrize block.
- **[Rule 1 — Bug fix]** `test_lazy_import_not_triggered_at_module_load` — in-process `sys.modules.pop + re-import` pattern contaminated pytest's sys.modules, breaking `test_full_scoring_propagation` which followed it. Rewrote as subprocess invocation: spawn a fresh Python interpreter, import `routers.match`, assert `'services.feedback_engine' not in sys.modules`. D6 assertion semantically identical; zero cross-test interference. File: `analytics-service/tests/test_feedback_engine.py` lines 1223-1254.
- **[Rule 3 — Unblock Phase 3 regression]** `test_worker_reads_latest_allocator_preferences` — Plan 04-01's new lazy seam in `_score_one_allocator` introduces `compute_adjusted_weights` via `asyncio.to_thread`; the existing Phase 3 integration test did not mock `services.feedback_engine.get_supabase`. Added a mock with empty probe data (D3 fast-path short-circuit: allocator has no bridge_outcomes, returns `{}` in one round-trip) plus a no-op audit stub. Zero change to test intent. File: `analytics-service/tests/test_match_integration.py` lines 229-238.
- **[Rule 3 — Unblock D6 grep self-contradiction]** Plan's `<action>` insert placed `from services.feedback_engine import compute_adjusted_weights` inside `async with _scoring_semaphore:` at 8-space indent, but the plan's own D6 acceptance grep (`^    from services\.feedback_engine import compute_adjusted_weights`) requires exactly 4-space indent. Moved import to function-body top level (before `async with`), preserving lazy loading (still in-body, not module-level) and satisfying the exact grep count. `compute_adjusted_weights` call stays inside `async with _scoring_semaphore:` after ctx load, unchanged. File: `analytics-service/routers/match.py` lines 256-274.
- **[Rule 1 — Bug fix]** Migration 063 comment lines — acceptance criteria require `grep -c SAVEPOINT == 0`, `grep -c auth.uid == 0`, `grep -c "CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas" == 1`, `grep -c pg_get_functiondef == 1`. Initial comment block mentioned each token in prose, producing counts of 1/2/2/2 respectively. Rephrased comments to preserve intent without the literal tokens. File: `supabase/migrations/063_feedback_delta_enqueue.sql` lines 11, 29, 41-44, 47-49.
- **[Rule 3 — Orchestrator-side workflow adaptation]** `gsd-sdk` is not installed on this machine; the execute-phase workflow references `gsd-sdk query ...` extensively. Fell back to plain `git add` + `git commit -m` for commits; skipped `gsd-sdk query commit`, `state.advance-plan`, `roadmap.update-plan-progress`, etc. STATE.md / ROADMAP.md / REQUIREMENTS.md updates handled centrally by the orchestrator (this SUMMARY commit + a follow-up docs commit).
- **[Rule 3 — Checkpoint bypass via Supabase MCP]** Task 3 was originally a `checkpoint:human-verify gate="blocking"` requiring the operator to run `supabase db push --include-all --yes` manually. User authorized mid-execution switch to `mcp__plugin_supabase_supabase__apply_migration` — the MCP executes the migration directly, skipping the CLI path. Stripped outer BEGIN;/COMMIT; from the SQL (MCP manages its own transaction). Post-apply reconciled the `schema_migrations.version` from timestamp to file prefix `063`. Checkpoint semantics preserved (human approved the switch); acceptance criteria satisfied via direct post-apply pg_get_functiondef assertions.

## VOICES-ACCEPTED Integration

All cross-AI findings that were accepted in VOICES-ACCEPTED.md are implemented in this shipping artifact:

- **C1** (CTE signature parity pin): Migration 063 `extract_delta(` appears 6× (3 × in the `computed` CTE + 1 × in the self-verify DO block NOT LIKE clause; file grep counts 6 due to SQL formatting), matching migration 060's call shape verbatim.
- **D1** (two-phase CTE RETURNING capture): `UPDATE ... RETURNING bo.allocator_id` + `SELECT array_agg(DISTINCT allocator_id) INTO v_allocator_ids FROM transitioned` + `FOREACH v_allocator_id IN ARRAY v_allocator_ids LOOP PERFORM ...`. Old `SELECT DISTINCT allocator_id FROM bridge_outcomes WHERE deltas_computed_at = v_started` pattern EXPLICITLY ABSENT.
- **D2** (3-scenario golden snapshot + anti-silent-accept): `test_golden_snapshot` loops cold/ceiling/floor scenarios; REGENERATE_GOLDEN=1 raises `pytest.fail` if ceiling or floor regenerates to `{}`.
- **D3** (fast-path probe): `_has_any_bridge_outcomes` first statement in `compute_adjusted_weights`. `test_fastpath_skip_no_outcomes` asserts ≤ 2 `.table()` calls for empty-history allocator.
- **D4** (human-only rollback): Documented in the plan's Task 3 `<how-to-verify>` rollback section; not triggered.
- **D5** (rejection_reason 3-key direct map + 2 intentional omissions): `REJECTION_REASON_TO_DIMENSION` has exactly 3 keys; `test_rejection_reason_mapping` asserts `already_owned` + `other` NOT present.
- **D6** (lazy body-placed import): 4-space indent enforced by grep + `test_lazy_import_not_triggered_at_module_load` subprocess assertion.
- **D7** (audit taxonomy ADR sync gate): `src/lib/audit.ts` + `docs/architecture/adr-0023-audit-event-taxonomy.md` extended in the same commit (f89115c).
- **D8** (end-to-end scoring propagation): `test_full_scoring_propagation` (04-01-28) asserts `scoring_weight_overrides` propagates from `compute_adjusted_weights` output through `score_candidates(prefs)` AND into the captured `match_batches.effective_preferences` row payload.
- **D9** (anchor by statement, not line number): Plan's `<read_first>` blocks and this SUMMARY use anchor statements (`ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)`) rather than line numbers, which drift.
- **D11** (literal "toward 1.5x" = exactly 1.5x): D-13 step function produces exactly 0.5 or 1.5 — no smoothing. Asserted by `test_ceiling_on_high_rate`, `test_floor_on_low_rate`, and the ceiling/floor golden fixtures.

## Next

Phase 4 closes Sprint 8's FEEDBACK-01..06 leaf. With Phase 4 complete, the scoring_weight_overrides column now has a live writer — this unblocks Phase 5 (Outcomes Dashboard) which only depends on Phase 1's `bridge_outcomes` data but reads the same effective_preferences snapshot that Phase 4 populates.

Recommended follow-ups:
- Run `/gsd-progress` to view the updated ROADMAP.
- Start Phase 5 via `/gsd-discuss-phase 5` (CONTEXT.md doesn't yet exist) or `/gsd-plan-phase 5`.
- A follow-up `/review` + `/ship` cycle can squash-merge phases 2-4 to main if ready.
