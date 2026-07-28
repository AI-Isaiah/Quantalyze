---
phase: 03-mandate-aware-scoring-engine
plan: 01
subsystem: scoring-engine

tags:
  - scoring
  - match-engine
  - python
  - postgres
  - supabase-rpc
  - security-definer
  - jsonb
  - schema-sync
  - mandate
  - migration
  - compute-jobs
  - tdd

# Dependency graph
requires:
  - phase: 02-mandate-profile-builder
    provides: allocator_preferences mandate columns (max_weight, correlation_ceiling, liquidity_preference, style_exclusions, mandate_edited_at) via migration 061; update_allocator_mandates SECURITY DEFINER RPC (amended by this plan to PERFORM enqueue); ALLOCATOR_PREFERENCES_COLUMNS const (extended by this plan); schema-sync Vitest test
provides:
  - "supabase/migrations/062_scoring_weight_overrides.sql (9-step atomic migration, D-14 Option B)"
  - "allocator_preferences.scoring_weight_overrides JSONB column (nullable, app-layer validated)"
  - "compute_jobs.allocator_id UUID FK to auth.users (ON DELETE CASCADE)"
  - "compute_jobs_target_xor CHECK extended to 3-way XOR (strategy/portfolio/allocator)"
  - "compute_jobs_kind_target_coherence CHECK with rescore_allocator branch"
  - "rescore_allocator kind registered in compute_job_kinds"
  - "compute_jobs_one_inflight_per_kind_allocator partial unique index"
  - "_enqueue_compute_job_internal + enqueue_compute_job extended with p_allocator_id UUID DEFAULT NULL trailing param"
  - "update_allocator_mandates amended with PERFORM enqueue_compute_job(kind='rescore_allocator', p_allocator_id=auth.uid())"
  - "ENGINE_VERSION='v2.0.0' + WEIGHTS_VERSION='v2.0.0' in match_engine.py (lockstep)"
  - "_compute_mandate_fit_score helper (average of 4 per-dimension contributions in [0,1])"
  - "_liquidity_tier_from_aum helper ($10M/$1M/>0 threshold mapping)"
  - "SOFT_EXCLUSION_REASONS gains 'style_excluded'; _eligibility_check compares candidate.subtype against allocator.style_exclusions"
  - "Composition effective_preference_fit = 0.6 * preference_fit + 0.4 * mandate_fit_score inside W_PREFERENCE_FIT (D-02)"
  - "Multiplicative scoring_weight_overrides with per-key clamp [0.5, 1.5] + renormalize so sum=1.0 (D-08)"
  - "score_breakdown.mandate_fit_score scalar + score_breakdown.raw.mandate_fit_raw per-dimension dict (SCORING-02)"
  - "DEFAULT_PREFERENCES extended with 5 mandate keys (flat-dict merge semantics, D-10)"
  - "ALLOCATOR_PREFERENCES_COLUMNS ends with 'scoring_weight_overrides'"
  - "AllocatorPreferences TS interface includes scoring_weight_overrides: Record<string, number> | null"
  - "test_match_engine.py — 20 new pytest unit tests (per-dimension math, composition, overrides renormalization, determinism, backward compat, v1→v2 golden snapshot)"
  - "test_match_defaults.py — 5 new pytest unit tests asserting each new DEFAULT_PREFERENCES key"
  - "mandate-columns-schema-sync.test.ts — scoring_weight_overrides assertion in static layer; live-DB projection green"
  - "analytics-service/tests/fixtures/match_engine_v2_golden.json — frozen v2.0.0 output for determinism regression"
affects:
  - 03-02-mandate-aware-scoring-engine (caller + invalidation: routers/match.py skip-logic, proactive enqueue consumer, rescore_allocator job handler — SCORING-05)
  - 04-feedback-loop (Phase 4 populates scoring_weight_overrides from bridge_outcomes via FEEDBACK-02)
  - 05-dashboard-widget (reads engine_version filter on match_batches)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "9-step atomic migration (D-14 Option B): DDL + CHECK expansion + kind registry + partial unique index + RPC signature evolution + self-verifying DO block with full RPC wrapper probe"
    - "Postgres overload evolution via explicit DROP FUNCTION IF EXISTS + CREATE FUNCTION (CREATE OR REPLACE does NOT replace across parameter-count changes)"
    - "PL/pgSQL probe cleanup via explicit DELETE statements (SAVEPOINT/ROLLBACK TO prohibited in DO blocks)"
    - "Multiplicative override with clamp + renormalize (preserves sum-to-1.0 invariant under adversarial input)"
    - "Graceful-degradation mandate fit (NULL per-dimension → 1.0, preserves rank order for empty-mandate allocators per SCORING-04)"
    - "Frozen golden-snapshot test with REGENERATE_GOLDEN=1 escape hatch (catches accidental math drift without blocking intentional refactors)"
    - "TDD order enforcement: Wave 0 red scaffolds → Wave 1 production makes green (no green test precedes its production code)"

key-files:
  created:
    - supabase/migrations/062_scoring_weight_overrides.sql
    - analytics-service/tests/fixtures/match_engine_v2_golden.json
  modified:
    - analytics-service/services/match_engine.py
    - analytics-service/services/match_defaults.py
    - analytics-service/tests/test_match_engine.py
    - analytics-service/tests/test_match_defaults.py
    - src/lib/admin/match.ts
    - src/lib/preferences.ts
    - src/__tests__/mandate-columns-schema-sync.test.ts
    - src/components/mandate/MandateForm.test.tsx

key-decisions:
  - "ENGINE_VERSION and WEIGHTS_VERSION bumped in lockstep to v2.0.0; v1 cached batches naturally age out via existing _retention_sweep (D-13)"
  - "D-12 Option B confirmed — compute_jobs schema expansion (allocator_id + 3-way XOR + rescore_allocator kind + partial unique index) shipped in migration 062; no rescore_hints shadow table, no force_recompute persistent flag"
  - "D-14 Option B: single atomic migration 062 contains all 9 Phase 3 DB changes; no separate migration 063"
  - "Rule 1 auto-fix: DROP FUNCTION IF EXISTS with explicit signature precedes CREATE OR REPLACE when parameter count changes (CREATE OR REPLACE creates a new overload rather than replacing)"
  - "Rule 1 auto-fix: SAVEPOINT/ROLLBACK TO prohibited inside PL/pgSQL DO blocks; probe state cleanup via explicit DELETE of sentinel rows"
  - "Rule 2 auto-fix: MandateForm.test.tsx populatedPrefs fixture updated with scoring_weight_overrides: null so TS interface stays strict (no optional marker)"
  - "Golden snapshot approach: REGENERATE_GOLDEN=1 env var to intentionally refresh fixture, default run asserts byte-identical output (catches math drift without blocking refactors)"

patterns-established:
  - "Three-scope compute_jobs (strategy / portfolio / allocator): 3-way target XOR + kind-target coherence CHECK + partial unique index per scope (DoS mitigation T-03-B)"
  - "Multiplicative scoring override: clamp [floor, ceiling] per key → renormalize across all keys → sum == 1.0 ± 1e-9 invariant (Phase 4 feedback loop consumes directly)"
  - "Per-dimension mandate fit via AVERAGE of contributions in [0, 1]; NULL inputs return neutral 1.0 (no penalty for data sparseness; rank-order preservation for empty-mandate allocators per SCORING-04)"
  - "Composition inside existing top-level weight term: effective = k * existing + (1-k) * new (D-02 0.6/0.4 split — no top-level rebalance, no weight-sum drift)"
  - "Self-verifying DO block with full RPC wrapper probe: exercises public RPC → private internal RPC → INSERT path AND partial unique index violation path at migration apply time (catches f2-class signature/GRANT bugs pre-production)"

requirements-completed:
  - SCORING-01
  - SCORING-02
  - SCORING-03
  - SCORING-04
  - SCORING-06
  - SCORING-07

# Metrics
duration: ~2h 17m
completed: 2026-04-18
---

# Phase 03 Plan 01: Migration 062 + match_engine.py v2.0.0 math + schema-sync contracts Summary

**9-step atomic migration expanding compute_jobs to a 3-way target XOR with rescore_allocator kind, scoring_weight_overrides JSONB column on allocator_preferences, and match_engine.py v2.0.0 with 4-dimension mandate fit composed inside W_PREFERENCE_FIT as 0.6*preference_fit + 0.4*mandate_fit_score.**

## Performance

- **Duration:** ~2h 17m
- **Started:** 2026-04-18T19:40:00Z
- **Completed:** 2026-04-18T19:57:05Z
- **Tasks:** 4 (W0 red scaffolds, W1-A migration authoring, W1-B engine math, W2-PUSH live DB apply)
- **Files modified:** 9 (1 created migration + 2 Python production + 2 Python test + 2 TS production + 1 TS test + 1 TS fixture)

## Accomplishments

- Migration 062 applied successfully to the linked Supabase project (`khslejtfbuezsmvmtsdn` / quantalyze) — NOTICE `Migration 062: scoring_weight_overrides + compute_jobs allocator_id + rescore_allocator kind verified.` emitted in stdout, `anon` lacks EXECUTE on the new `enqueue_compute_job` signature (ADR-0001 baseline preserved), live-DB schema-sync projection green.
- 25 new pytest unit tests green (20 match_engine + 5 match_defaults), zero regression in the 422-test pre-existing analytics-service suite, full suite passes at 447 tests.
- Engine math: four per-dimension mandate contributions (max_weight linear taper, correlation_ceiling smooth degradation, liquidity_preference tier-gap, style_exclusions SOFT exclude) averaged into mandate_fit_score ∈ [0, 1]; composition inside W_PREFERENCE_FIT preserves top-level weight sum == 1.0.
- Multiplicative `scoring_weight_overrides` reader with per-key `_clamp(v, 0.5, 1.5)` and cross-key renormalization so the four effective weights always sum to 1.0 ± 1e-9 under adversarial input.
- TS schema-sync contract stays tight: ALLOCATOR_PREFERENCES_COLUMNS const appended, AllocatorPreferences interface expanded, static vitest assertion + live-DB projection both green.

## Task Commits

Each task was committed atomically:

1. **Task 0 (W0): Red test scaffolds** — `a26ed50` (test) — 20 match_engine stubs + 5 match_defaults stubs + golden snapshot placeholder + schema-sync extension. Wave 0 leaves 9 red + 14 skipped (intentional TDD red).
2. **Task 1 (W1-A): Author migration 062** — `0cd00c6` (feat) — 9-step atomic migration, 625 lines including self-verifying DO block. Not yet applied.
3. **Task 2 (W1-B): match_engine v2.0.0 math + TS schema-sync** — `f278c0d` (feat) — ENGINE_VERSION bump, _compute_mandate_fit_score helper, composition, overrides renormalization, DEFAULT_PREFERENCES extension, TS const + interface, golden snapshot regenerated. All 25 tests green, zero regression.
4. **Task 3 (W2-PUSH): Apply migration 062 via `supabase db push`** — no code commit (live-DB effect only). NOTICE captured in `/tmp/migration-062-push.log`.
5. **Fix: migration 062 bug fixes discovered at push time** — `4be79ab` (fix) — two Rule 1 auto-fixes (DROP FUNCTION IF EXISTS preceding signature change; explicit DELETE cleanup replacing SAVEPOINT). Re-apply succeeded, NOTICE emitted.

## Files Created/Modified

- `supabase/migrations/062_scoring_weight_overrides.sql` — 9-step atomic migration with self-verifying DO block + full RPC wrapper probe (D-14 Option B).
- `analytics-service/services/match_engine.py` — ENGINE_VERSION + WEIGHTS_VERSION bump, SOFT_EXCLUSION_REASONS += "style_excluded", _eligibility_check subtype branch, _compute_mandate_fit_score + _liquidity_tier_from_aum helpers, composition + overrides renormalization in score_candidates, score_breakdown.mandate_fit_score key + score_breakdown.raw.mandate_fit_raw per-dimension dict, _almost_passed_score style_excluded branch.
- `analytics-service/services/match_defaults.py` — DEFAULT_PREFERENCES gains 5 mandate keys (max_weight: None, correlation_ceiling: None, liquidity_preference: None, style_exclusions: [], scoring_weight_overrides: None). merge_with_defaults body unchanged (None-skip semantic preserved).
- `analytics-service/tests/test_match_engine.py` — 20 new unit tests under Phase 3 / D-15 header, _make_candidate grew `subtype: str | None = None` kwarg, lazy _compute_mandate_fit_score import with MANDATE_FIT_IMPORTED sentinel.
- `analytics-service/tests/test_match_defaults.py` — 5 new stub tests under Phase 3 / D-15 header asserting each new DEFAULT_PREFERENCES key.
- `analytics-service/tests/fixtures/match_engine_v2_golden.json` — 2658-byte frozen v2.0.0 output; REGENERATE_GOLDEN=1 regenerates.
- `src/lib/admin/match.ts` — ALLOCATOR_PREFERENCES_COLUMNS literal appends `", scoring_weight_overrides"` with Phase 3 comment.
- `src/lib/preferences.ts` — AllocatorPreferences interface adds `scoring_weight_overrides: Record<string, number> | null` (required field, not optional — strictness preserved).
- `src/__tests__/mandate-columns-schema-sync.test.ts` — one new `.has()` assertion between `edited_by_user_id` and closing brace; live-DB layer untouched (auto-covers via projection select).
- `src/components/mandate/MandateForm.test.tsx` — populatedPrefs fixture gains `scoring_weight_overrides: null` to satisfy the non-optional AllocatorPreferences field (Rule 2 auto-fix).

## Decisions Made

- **D-14 Option B confirmed executable.** Plan hypothesized expanding compute_jobs to 3-way scope; plan-execution confirmed the schema evolution works end-to-end (CHECK DROP+ADD, partial unique index, RPC signature change, RPC-body PERFORM) within a single atomic migration. No rescue migration 063 needed.
- **Rule 1 auto-fixes applied during W2-PUSH** (post-commit for W1-A; committed as 4be79ab). Two bugs surfaced at `supabase db push` time: (1) CREATE OR REPLACE FUNCTION does NOT replace across parameter-count changes — fix: explicit DROP FUNCTION IF EXISTS with full arg types preceding the CREATE; (2) SAVEPOINT/ROLLBACK TO is prohibited inside PL/pgSQL DO blocks — fix: explicit DELETE of probe compute_jobs rows + sentinel auth.users row at the end of the DO block (the nested BEGIN/EXCEPTION around the duplicate-INSERT probe is PL/pgSQL-legal and preserves the partial-unique-index assertion). Both are DB-specific semantics not discoverable from codebase pattern-matching alone — visible only at apply time.
- **Rule 2 auto-fix**: MandateForm.test.tsx `populatedPrefs` fixture updated with `scoring_weight_overrides: null` so the TS interface can keep the field required (non-optional). Preferred over marking the field `?:` optional because Phase 4 feedback engine writes it unconditionally; optional would invite silent `undefined` round-trips.
- **SCORING-04 interpretation locked**: rank-order invariance, NOT absolute-score equality. Empty-mandate allocators get mandate_fit_score = 1.0 on every candidate; absolute scores shift uniformly by `+0.4 × 1.0 × W_PREFERENCE_FIT = +0.12` under the 0.6/0.4 composition. Rank order preserved. User sign-off captured in `.planning/phases/03-mandate-aware-scoring-engine/03-RESEARCH.md` Open Question Q5; test `test_v1_prefs_backward_compat_rank_order` asserts rank-order identity directly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration 062 CREATE OR REPLACE function overload collision**
- **Found during:** Task 3 (W2-PUSH) — `supabase db push` exit 1.
- **Issue:** Plan's STEP 7 used `CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(..., p_allocator_id UUID DEFAULT NULL)` against a function already existing with 7 args. Postgres overload resolution is strict on parameter count — CREATE OR REPLACE treats this as a SECOND overload alongside the original rather than replacing. The subsequent `COMMENT ON FUNCTION _enqueue_compute_job_internal IS ...` (unqualified) failed with SQLSTATE 42725 "function name is not unique".
- **Fix:** Prepend explicit `DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)` and `DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb)` before the CREATE OR REPLACE. After these DROPs, there is exactly one overload matching each name so COMMENT/REVOKE with unqualified name resolves correctly.
- **Files modified:** supabase/migrations/062_scoring_weight_overrides.sql
- **Verification:** `supabase db push --yes` completed successfully with NOTICE emitted; post-push `pg_proc` query shows only the new 8-arg _enqueue_compute_job_internal and 7-arg enqueue_compute_job signatures.
- **Committed in:** 4be79ab

**2. [Rule 1 - Bug] PL/pgSQL SAVEPOINT prohibition inside DO blocks**
- **Found during:** Task 3 (W2-PUSH) — after applying the Rule 1 #1 fix, `supabase db push` failed again with SQLSTATE 42601 "syntax error at or near 'TO'" at the `ROLLBACK TO SAVEPOINT verify_rescore_allocator;` statement inside the self-verifying DO block.
- **Issue:** Plan's STEP 9 relied on `SAVEPOINT verify_rescore_allocator` + `ROLLBACK TO SAVEPOINT verify_rescore_allocator` to isolate the probe INSERT of a sentinel auth.users row + compute_jobs rescore_allocator job. PL/pgSQL explicitly prohibits transaction-control statements (SAVEPOINT, ROLLBACK, COMMIT) inside function bodies and DO blocks — they're reserved for the outer BEGIN/COMMIT brackets.
- **Fix:** Remove the SAVEPOINT statements; add explicit `DELETE FROM compute_jobs WHERE allocator_id = v_probe_allocator; DELETE FROM auth.users WHERE id = v_probe_allocator;` at the end of the DO block. The inner `BEGIN ... EXCEPTION WHEN unique_violation THEN ... END` around the duplicate-INSERT probe remains — that pattern IS PL/pgSQL-legal (it creates an implicit subtransaction for exception handling). If any of the assertions fail, the outer migration-level `BEGIN; ... COMMIT;` still rolls back the entire transaction including any probe-row side effects.
- **Files modified:** supabase/migrations/062_scoring_weight_overrides.sql
- **Verification:** `supabase db push --yes` completed cleanly; `SELECT COUNT(*) FROM compute_jobs WHERE allocator_id = '00000000-0000-0000-0000-000000000001'` returns 0; `SELECT COUNT(*) FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001'` returns 0.
- **Committed in:** 4be79ab (same commit as Rule 1 #1 — both bugs surfaced during the same W2-PUSH iteration)

**3. [Rule 2 - Missing Critical] MandateForm.test.tsx fixture missing new required field**
- **Found during:** Task 2 (W1-B) — `npm run typecheck` failed with TS2741 "Property 'scoring_weight_overrides' is missing in type ...".
- **Issue:** Adding `scoring_weight_overrides: Record<string, number> | null` as a non-optional field on the AllocatorPreferences interface (per plan interfaces block) broke the existing `populatedPrefs()` fixture in MandateForm.test.tsx which constructs a literal AllocatorPreferences value.
- **Fix:** Append `scoring_weight_overrides: null` to the populatedPrefs return literal. Preferred over marking the interface field `?:` optional because Phase 4 feedback engine will ALWAYS write the field (a present-but-null value semantically means "no override set" per D-08; absent key would be confusing).
- **Files modified:** src/components/mandate/MandateForm.test.tsx
- **Verification:** `npm run typecheck` exits 0.
- **Committed in:** f278c0d (Task 2 commit — bundled with the TS interface change that required it)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 DB-semantics bugs + 1 Rule 2 TS strictness correction)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep — every fix was strictly needed for the plan-as-specified to apply/compile. The two migration bugs (#1 and #2) are Postgres/PL-pgSQL semantics that were not discoverable from codebase pattern-matching alone; the existing migration 061 (which created the pre-062 `update_allocator_mandates` signature) did not exercise either path.

## Issues Encountered

- **supabase CLI `--linked` flag invalid on `db execute`** — plan suggested `npx supabase db execute --linked --sql "..."` for verification; the current CLI version exposes only `db query --linked` (not `db execute`). Substituted `db query --linked --output=table` which works end-to-end against the Management API.
- **HAS_LIVE_DB env var not auto-sourced** — initial live-DB vitest run showed 1 test skipped (not 2) until `.env.local` env vars were explicitly sourced into the shell. Documented fallback for future CI: `set -a && . .env.local && set +a && HAS_LIVE_DB=1 npx vitest ...`.

## User Setup Required

None — the supabase CLI was already authed via macOS Keychain from Phase 02-01 (same project link), so `supabase db push --yes` ran non-interactively without requiring SUPABASE_ACCESS_TOKEN. Phase 02-01 precedent held.

## Next Phase Readiness

- **Plan 03-02 ready to start.** Prerequisites now live:
  - `ENGINE_VERSION == "v2.0.0"` in match_engine.py primes the `_should_skip_allocator` version-check branch (SCORING-05).
  - `compute_jobs.allocator_id` column + `rescore_allocator` kind are queryable — Plan 03-02's job worker handler can dispatch without a follow-up migration.
  - `update_allocator_mandates` RPC already calls `enqueue_compute_job(kind='rescore_allocator', p_allocator_id=auth.uid())` on every mandate write — Plan 03-02's worker just needs a consumer.
  - `match_batches.effective_preferences` JSONB (via merge_with_defaults in score_candidates) now contains all 14 flat keys including scoring_weight_overrides — Phase 4 feedback engine can read the historical snapshot directly without joining allocator_preferences.
- **No blockers.** Phase 3 Wave 2 (Plan 03-02 — routers/match.py skip-logic extension + proactive enqueue worker + integration tests) is pure code against an already-ready schema.
- **Observability note for Plan 03-02:** the first `rescore_allocator` job will land on the queue as soon as an allocator saves a mandate via `update_allocator_mandates`. Plan 03-02's worker handler needs to exist before the next mandate write in production (otherwise jobs accumulate in `pending` status indefinitely). Partial unique index prevents runaway growth, but pending jobs still surface in admin queue dashboards.

## Self-Check: PASSED

- `supabase/migrations/062_scoring_weight_overrides.sql` — FOUND
- `analytics-service/tests/fixtures/match_engine_v2_golden.json` — FOUND (2658 bytes, real content)
- Commit `a26ed50` (W0) — FOUND
- Commit `0cd00c6` (W1-A) — FOUND
- Commit `f278c0d` (W1-B) — FOUND
- Commit `4be79ab` (W1-A fix) — FOUND
- Migration 062 applied on linked DB — FOUND (NOTICE in /tmp/migration-062-push.log)
- `scoring_weight_overrides` column — FOUND in information_schema.columns (live-DB check)
- `rescore_allocator` kind — FOUND in compute_job_kinds (live-DB check)
- `anon` lacks EXECUTE on new enqueue_compute_job signature — FOUND (has_function_privilege=false)

---
*Phase: 03-mandate-aware-scoring-engine*
*Completed: 2026-04-18*
