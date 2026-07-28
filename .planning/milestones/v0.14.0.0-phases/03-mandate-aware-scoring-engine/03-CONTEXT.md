# Phase 3: Mandate-Aware Scoring Engine - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend `analytics-service/services/match_engine.py` so every scored candidate carries a `mandate_fit_score` inside its `score_breakdown` JSONB, composed with the existing preference-fit term as `W_PREFERENCE_FIT_effective = 0.6 × existing_preference_fit + 0.4 × mandate_fit_score`. The four top-level weights (`W_PORTFOLIO_FIT`, `W_PREFERENCE_FIT`, `W_TRACK_RECORD`, `W_CAPACITY_FIT`) stay at `0.40 / 0.30 / 0.15 / 0.15` (sum = 1.0). `ENGINE_VERSION` bumps to `v2.0.0`; cached v1 batches are invalidated via engine-version check in `_should_skip_allocator`.

The engine reads five mandate columns from `allocator_preferences` (all nullable, added by migration 061 in Phase 2):
- `max_weight` (fraction 0.05–0.50) → soft penalty when `add_weight > max_weight`
- `correlation_ceiling` (fraction 0–1) → soft penalty when candidate-vs-weighted-portfolio correlation breaches ceiling
- `liquidity_preference` (`high | medium | low`) → tier-gap soft penalty based on candidate `manager_aum`
- `style_exclusions` (`TEXT[]` of SUBTYPES) → **SOFT** exclusion reason (relaxes on <5-candidate universe)
- `preferred_strategy_types` (unchanged; existing `off_mandate_type` logic covers this)

Phase 3 also adds one new column via migration 062 (`scoring_weight_overrides JSONB NULL` on `allocator_preferences`) so SCORING-06's "snapshot includes scoring_weight_overrides (if set)" contract is literally true at merge. Phase 4 writes to it.

Scope: one atomic scoring-math change across two plans:
- **03-01** — migration 062 (column + any Phase 3 DB changes in one migration) + match_engine.py v2.0.0 math (new `compute_mandate_fit_score()`, SOFT `style_excluded` reason, score_breakdown extension, engine-version constant bump)
- **03-02** — routers/match.py skip-logic (mandate_edited_at + engine_version awareness) + proactive enqueue on Phase 2 RPC mandate write (new `kind='rescore_allocator'` via existing `enqueue_compute_job` pattern) + integration tests

ROADMAP edit required: split `- [ ] 03-01: match_engine.py extension…` into 03-01 and 03-02 with `03-02 Depends on: 03-01`.

Out of scope (handled by other phases): UI changes (backend-only phase), populating `scoring_weight_overrides` (Phase 4), outcomes dashboard (Phase 5), any rebalance of top-level weight constants.

</domain>

<decisions>
## Implementation Decisions

### mandate_fit_score composition (locked upstream, restated)
- **D-01:** `mandate_fit_score` is the AVERAGE of the four per-dimension contributions (max_weight, correlation_ceiling, liquidity_preference, style_exclusions). Each contribution is in [0, 1]. Empty mandates → every dimension returns `1.0` → `mandate_fit_score = 1.0` (SCORING-04 graceful fallback).
- **D-02:** Composition inside `W_PREFERENCE_FIT`: `effective_preference_fit = 0.6 × _compute_preference_fit(cand, prefs) + 0.4 × mandate_fit_score`. The top-level weight line stays `W_PREFERENCE_FIT * effective_preference_fit` — no rebalance of `W_PORTFOLIO_FIT` / `W_TRACK_RECORD` / `W_CAPACITY_FIT`. Invariant: sum of top-level weights = 1.0, pre- and post-Phase-3.

### Per-dimension constraint enforcement
- **D-03 (max_weight):** **Linear taper above ceiling.** Let `add_weight = ticket_size / portfolio_aum` clamped to `[0.01, 0.5]` (already computed in `score_candidates` for personalized mode). For screening mode or missing `portfolio_aum`, `add_weight` defaults to 0.10 (existing engine behavior). Contribution:
  - `max_weight` is NULL → `1.0`
  - `add_weight ≤ max_weight` → `1.0`
  - `add_weight > max_weight` → `max(0, 1 - (add_weight - max_weight) / max_weight)` (2× ceiling → `0.0`)
- **D-04 (correlation_ceiling):** Reuse the existing `corr_with_portfolio` scalar already produced by `_compute_portfolio_fit_components`. Contribution:
  - `correlation_ceiling` is NULL → `1.0`
  - `corr_with_portfolio` is NULL (insufficient overlap) → `1.0` (neutral — don't penalize data sparseness)
  - `corr_with_portfolio ≤ correlation_ceiling` → `1.0`
  - `corr_with_portfolio > correlation_ceiling` → `max(0, 1 - (corr - ceiling) / (1 - ceiling))` (perfectly correlated → `0.0`, smooth degradation)
  - Screening mode (no portfolio) → always `1.0` (no correlation to compute)
- **D-05 (liquidity_preference):** Tier-gap soft penalty. Map candidate `manager_aum` to tier: `>= $10M` = `high`, `>= $1M` and `< $10M` = `medium`, `> 0` and `< $1M` = `low`, `NULL`/`0`/unknown = `1.0` (neutral). Contribution:
  - `liquidity_preference` is NULL → `1.0`
  - Candidate tier matches allocator's → `1.0`
  - One-tier gap (e.g., allocator=high, candidate=medium) → `0.5`
  - Two-tier gap (allocator=high, candidate=low) → `0.0`
  - "Gap direction": penalize ONLY when candidate tier is lower than allocator's preference (allocator wants high and gets low → penalty; allocator wants low and gets high → `1.0`, more liquid is strictly better). Planner to confirm direction semantics in 03-01 PR description.
- **D-06 (style_exclusions):** Hard-exclude candidate whose `subtype` (or `strategy_type` fallback — planner to confirm field; SUBTYPES values are string-typed) matches any entry in the allocator's `style_exclusions` array. Implemented as a new **SOFT** exclusion reason `style_excluded` — relaxable when `<5 eligible` (same relaxation path as `off_mandate_type`). Does **NOT** contribute to `mandate_fit_score` (excluded candidates don't get scored). Rationale: preserves the engine's "show SOMETHING rather than empty" invariant without breaking the principle that allocator-stated exclusions are honored on full-universe runs.

### Scoring weights + overrides
- **D-07 (scoring_weight_overrides column):** Phase 3 ships **migration 062** that adds `scoring_weight_overrides JSONB NULL` to `allocator_preferences`. Phase 3 engine reads it; Phase 4 writes to it. Rationale: SCORING-06 snapshot requires the column at Phase 3 merge; phase-ordering means Phase 3 lands first regardless of same-day shipping.
- **D-08 (overrides read shape):** **Multiplicative.** Stored shape: `{"W_PORTFOLIO_FIT": 1.3, "W_PREFERENCE_FIT": 0.8, ...}` (missing keys = `1.0`). Engine:
  1. Read `scoring_weight_overrides` (NULL or missing → no override, engine behaves exactly as v1 in this regard)
  2. `scaled = {W: DEFAULT_W × override_scale.get(W, 1.0) for W in [W_PORTFOLIO_FIT, W_PREFERENCE_FIT, W_TRACK_RECORD, W_CAPACITY_FIT]}`
  3. Clamp each scale to `[0.5, 1.5]` defensively (Phase 4 enforces this, but engine guards against bad data)
  4. Renormalize: `effective = {W: scaled[W] / sum(scaled.values()) for W in …}`. Invariant: `sum(effective.values()) == 1.0`.
- **D-09 (overrides surface):** Only the four top-level weights are overridable. Sub-weights (`W_SHARPE_LIFT`, `W_CORR_REDUCTION`, `W_DD_IMPROVEMENT`) are fixed constants in v2.0.0. Screening-mode weights (`W_SCREENING_*`) are **not** overridable (feedback loop is personalized-mode-only per Phase 4 design).

### effective_preferences snapshot
- **D-10 (snapshot shape):** **Flat merge** — every mandate field is a peer key in the `match_batches.effective_preferences` JSONB. Shape at minimum:
  ```json
  {
    "max_drawdown_tolerance": …, "min_sharpe": …, "min_track_record_days": …,
    "target_ticket_size_usd": …, "preferred_strategy_types": [], "excluded_exchanges": [],
    "max_weight": …, "correlation_ceiling": …, "liquidity_preference": …,
    "style_exclusions": [], "scoring_weight_overrides": {…} | null,
    "mandate_archetype": …, "preferred_markets": []
  }
  ```
  Consistent with v1 shape; downstream readers (admin UI, audit, Phase 4 feedback engine) keep flat-dict access. `DEFAULT_PREFERENCES` in `match_defaults.py` extends to include the new keys with sensible defaults (all new mandate fields default to `None` / `[]`; `scoring_weight_overrides` defaults to `None`).

### Cache invalidation + v1→v2 cutover
- **D-11 (skip-logic triple check):** `_should_skip_allocator(allocator_id, force)` returns `False` when ANY of:
  1. `force == True` (existing request-level override — no schema change)
  2. `last_batch.engine_version != ENGINE_VERSION` (catches v1 → v2 cutover; also any future bump)
  3. `allocator_preferences.mandate_edited_at > last_batch.computed_at` (catches mandate edits)
  Otherwise applies the existing `RECOMPUTE_MIN_AGE_HOURS = 12` age guard. Implementation: one extra `.select("engine_version")` on the existing last-batch query + one new query against `allocator_preferences` (indexed by allocator_id PK).
- **D-12 (proactive enqueue on mandate write) — LOCKED to Option B (compute_jobs schema expansion, user-confirmed 2026-04-18 after research surfaced blocker):** Research (RESEARCH.md §Domain #3) confirmed `compute_jobs` has `compute_jobs_target_xor` + `compute_jobs_kind_target_coherence` CHECK constraints (migrations 032:138, 048:127) that reject an allocator-scoped `rescore_allocator` kind as-is. User chose Option B: expand `compute_jobs` in migration 062. Concretely:
  1. `ALTER TABLE compute_jobs ADD COLUMN allocator_id uuid NULL REFERENCES auth.users(id)` (nullable, follows existing strategy_id/portfolio_id FK pattern).
  2. DROP the existing `compute_jobs_target_xor` CHECK and re-ADD a 3-way XOR: exactly one of `strategy_id`, `portfolio_id`, `allocator_id` is non-null.
  3. DROP the existing `compute_jobs_kind_target_coherence` CHECK and re-ADD including a new branch: `kind = 'rescore_allocator'` REQUIRES `allocator_id IS NOT NULL` and `strategy_id IS NULL` and `portfolio_id IS NULL`. (Follow the DROP+ADD pattern from migrations 036 and 048.)
  4. Add a partial unique index `compute_jobs_one_inflight_per_allocator` mirroring the existing per-strategy/per-portfolio indexes, to prevent duplicate queued rescore jobs for the same allocator.
  5. Amend `enqueue_compute_job(...)` RPC: add `p_allocator_id uuid DEFAULT NULL` parameter; amend the INSERT to include `allocator_id`; preserve backwards-compat (strategy/portfolio callers untouched — no behavior change for them).
  6. CREATE OR REPLACE `update_allocator_mandates(...)` from migration 061 with `PERFORM enqueue_compute_job(p_kind := 'rescore_allocator', p_allocator_id := auth.uid(), p_priority := <existing default>);` appended before the final RETURN.
  7. Add a `rescore_allocator` handler to the analytics-service job worker (research identified `services/scheduled_tasks.py` `_enqueue_each` pattern + the worker dispatch site — planner to confirm exact file during planning; likely `job_worker.py` per CONCERNS.md). Handler calls the existing `_score_one_allocator` path with `force=True` (since the enqueue itself signals intent).
  8. Self-verifying DO block asserts: new column present, new CHECK constraints present, new unique index present, RPC signature updated, `rescore_allocator` kind accepts an allocator-scoped job row in a pg_savepoint test, trigger/RPC-body amendment present.
  The `rescore_hints` lightweight-table alternative (Option C) and the "defer D-12" alternative (Option A) are both rejected in favor of the schema expansion to keep the long-term compute_jobs abstraction uniform across all three entity scopes. `force_recompute` persistent flag remains **not needed** — request-level `force: bool` + `mandate_edited_at` timestamp + proactive enqueue now cover synchronous and asynchronous recompute paths.
- **D-13 (v1 rollover):** No data migration. Existing `_retention_sweep` (keep last 7 batches per allocator) naturally ages out v1 rows. Ad-hoc queries that want "only v2 batches" filter on `engine_version = 'v2.0.0'`.

### Migration 062 scope
- **D-14 (expanded per D-12 Option B lock):** **Single atomic migration 062** contains all Phase 3 DB changes:
  1. `ALTER TABLE allocator_preferences ADD COLUMN scoring_weight_overrides JSONB` (NULLable, no default)
  2. Optional CHECK constraint on shape (e.g., "only known weight keys") — planner's call; lean toward app-layer validation for easier iteration (Phase 2 pattern)
  3. `ALTER TABLE compute_jobs ADD COLUMN allocator_id uuid NULL REFERENCES auth.users(id)` — follows strategy_id/portfolio_id FK pattern (per D-12 Option B).
  4. DROP + re-ADD `compute_jobs_target_xor` as a 3-way XOR across `strategy_id`, `portfolio_id`, `allocator_id`.
  5. DROP + re-ADD `compute_jobs_kind_target_coherence` adding `kind = 'rescore_allocator' ⇒ allocator_id NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL` (follow migrations 036 + 048 precedent).
  6. `CREATE UNIQUE INDEX compute_jobs_one_inflight_per_allocator` partial index mirroring existing per-strategy / per-portfolio indexes — prevents duplicate queued rescore jobs per allocator.
  7. `CREATE OR REPLACE FUNCTION enqueue_compute_job(...)` with new `p_allocator_id uuid DEFAULT NULL` parameter appended to the signature; INSERT extended to include `allocator_id`. Backwards-compat preserved (existing strategy/portfolio callers don't pass the new param).
  8. `CREATE OR REPLACE FUNCTION update_allocator_mandates(...)` (from migration 061) with `PERFORM enqueue_compute_job(p_kind := 'rescore_allocator', p_allocator_id := auth.uid(), p_priority := <existing default>);` appended before the final RETURN.
  9. Self-verifying DO block: asserts every schema object from steps 1-8 is present; runs a SAVEPOINTed test INSERT of an allocator-scoped `rescore_allocator` job to prove the new CHECK branch accepts it and the partial unique index enforces single-inflight.
  No separate migration 063 unless a late surprise forces it.

### Test strategy
- **D-15 (unit test suite):** **~15–20 pytest tests** in `analytics-service/tests/test_match_engine.py` (extend existing file, don't fork):
  1. Empty mandates → `mandate_fit_score == 1.0` (ROADMAP SC4)
  2. Partial mandates (1–2 dimensions set) → averaging correctness
  3. Fully specified mandates → all four dimensions active
  4. `max_weight` violation: `add_weight > max_weight` → `mandate_fit < 1.0` and final score reflects penalty (ROADMAP SC3)
  5. `max_weight` boundary: `add_weight == max_weight` → `1.0` exactly
  6. `style_exclusions` hard exclude: candidate with excluded subtype → `match_candidates` row has `exclusion_reason = 'style_excluded'`, no score
  7. `style_exclusions` relaxation: <5 eligible with style-excluded → relaxation branch drops it, candidate resurfaces
  8. `correlation_ceiling` breach: high-corr candidate → `mandate_fit < 1.0`
  9. `correlation_ceiling` NULL corr_with_portfolio (sparse overlap) → neutral `1.0` (no penalty for data sparseness)
  10. `liquidity_preference` tier-gap: allocator=high/candidate=low → contribution `0.0`
  11. `liquidity_preference` "more liquid than preferred": allocator=low/candidate=high → `1.0` (gap direction matters)
  12. Weight normalization invariant: `sum(effective_weights) == 1.0` under any `scoring_weight_overrides` input (including extreme ones)
  13. `scoring_weight_overrides` missing keys: override `{"W_PORTFOLIO_FIT": 1.3}` only → other three scale by 1.0, renormalized
  14. `scoring_weight_overrides` clamp: override `{"W_PORTFOLIO_FIT": 10.0}` → clamps to 1.5× before renormalize
  15. `scoring_weight_overrides == None` → engine behaves exactly as v1 on top-level weights
  16. Determinism: same inputs → byte-identical `to_canonical_json` output (existing pattern)
  17. `mandate_fit_score` key present in `score_breakdown` for every personalized + screening row (SCORING-02)
  18. Engine version bumped: `ENGINE_VERSION == 'v2.0.0'`; imported constant changes (SCORING-01)
  19. v1 allocator prefs dict (no mandate keys) → engine merges defaults, `mandate_fit_score = 1.0`, scoring unchanged from v1 for that allocator (backward compat)
  20. Golden snapshot: pin a specific allocator+candidate fixture; assert v2 output matches a frozen JSON (regenerable via env var). Catches accidental math changes across future refactors.

- **D-16 (integration tests — 03-02):** Extend `analytics-service/tests/test_accuracy.py` or add `test_match_engine_integration.py` to cover routers/match.py skip-logic: build a fixture where `mandate_edited_at > last_batch.computed_at`, call `_should_skip_allocator` → `False`; same fixture with `mandate_edited_at < last_batch.computed_at` → `True`. Engine-version mismatch (pin `last_batch.engine_version = 'v1.0.0'`) → `False`. These run inside the FastAPI test client against a mocked Supabase (existing test infrastructure).
- **D-17 (no E2E):** No Playwright, no full API E2E with real DB. Phase 3 has no user-facing surface (backend-only, UI hint = no in ROADMAP). HAS_LIVE_DB gate also skipped — no value add over unit tests for scoring math.

### Claude's Discretion
- `mandate_fit_score` averaging shape (D-01 locks "mean of contributions"). Planner may adjust if edge cases (e.g., one NULL dimension vs. four NULL dimensions) need weighting — but average-of-present-dimensions is the default.
- Mechanism of D-12 proactive enqueue is now RPC-body PERFORM (locked in D-14 step 8 under Option B). Planner's remaining discretion: exact position of the PERFORM within the function body (before or after audit emission — should be AFTER the UPSERT completes so a rollback doesn't leave a phantom enqueue), and whether to guard with a `IF TG_OP = 'UPDATE' AND (NEW.max_weight IS DISTINCT FROM OLD.max_weight OR ...)` change detector (recommended: skip the guard — enqueue on every mandate write is simplest and the partial unique index dedupes).
- `force_recompute` persistent flag (admin-settable) vs only-request-level `force: bool`: D-11 picks the latter; planner may revisit if admin UX demands persistent override.
- New `_compute_mandate_fit_score()` placement: inside `match_engine.py` (co-located with other sub-scores) vs own module `services/mandate_fit.py`. Lean co-located for minimal churn.
- Reason copy for `style_excluded` exclusion (e.g., "Matches excluded style: Mean Reversion"). Must be user-friendly; pattern from existing `_generate_reasons` helper.
- `score_breakdown` JSONB ordering — Python dicts preserve insertion order; placing `mandate_fit_score` after `preference_fit` is the natural reading order.
- `DEFAULT_PREFERENCES` extension shape — add `max_weight: None`, `correlation_ceiling: None`, `liquidity_preference: None`, `style_exclusions: []`, `scoring_weight_overrides: None`. Existing `merge_with_defaults` skips `None` values, so first-visit allocators keep semantic clarity.
- Whether to add a `"mandate_fit_raw": {max_weight: …, correlation_ceiling: …, liquidity_preference: …, style_exclusions_honored: bool}` breakdown inside `score_breakdown.raw` for debuggability — recommended but not required by any SC.

### Folded Todos
None — cross-phase todo check returned no pending repo-level items relevant to Phase 3.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Sprint 8 vision; Phase 3 locked decisions (`mandate_fit_score` composes inside `W_PREFERENCE_FIT` 0.6/0.4, no top-level rebalance)
- `.planning/REQUIREMENTS.md` — SCORING-01 through SCORING-07 (locked), FEEDBACK-04/05/06 (downstream consumer — Phase 4)
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria SC1–SC5, plan breakdown (current: 1 plan; discussion added split into 03-01 + 03-02 — **planner must update ROADMAP.md**)
- `.planning/STATE.md` — current Phase 3 entry point; running log of Phase 1/2 decisions

### Cross-phase coupling
- `.planning/phases/02-mandate-profile-builder/02-CONTEXT.md` — D-05 (liquidity tier mapping), D-06 (risk_budget reuse of max_drawdown_tolerance), D-07 (column shapes), D-09 (empty=NULL=no-constraint semantics)
- `.planning/phases/02-mandate-profile-builder/02-01-SUMMARY.md` — migration 061 actual output (columns + RPC + RLS policy drop)
- `.planning/phases/02-mandate-profile-builder/02-02-SUMMARY.md` — `mandate_edited_at` column usage from the form
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — `bridge_outcomes.needs_recompute` pattern (considered but NOT adopted here; Phase 3 uses timestamp comparison instead)

### Architecture decision records
- `docs/architecture/adr-0001-rls-primary-authorization.md` — RLS as primary auth; SECURITY DEFINER RPC pattern
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — any Phase 3 audit events should use the established `entity_type` pattern
- `docs/architecture/adr-0005-admin-authorization.md` — admin read path for match_batches

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — analytics-service FastAPI layering
- `.planning/codebase/STACK.md` — Python 3.14 + pandas + Supabase client patterns
- `.planning/codebase/TESTING.md` — pytest + fixtures conventions
- `.planning/codebase/CONVENTIONS.md` — code style
- `.planning/codebase/CONCERNS.md` — `compute_jobs` RLS wide-open (noted; Phase 3 does NOT widen)

### Engine source (target of change)
- `analytics-service/services/match_engine.py` — 742 lines; `score_candidates()` is the entry point (line 427); `_compute_preference_fit` (line 221); `_eligibility_check` + `_eligibility_check_hard_only` (line 149 + 197); `ENGINE_VERSION` (line 45); top-level weights (lines 54–57)
- `analytics-service/services/match_defaults.py` — 34 lines; `DEFAULT_PREFERENCES` dict (line 9); `merge_with_defaults()` (line 22) — extend for new mandate keys

### Caller + invalidation (target of 03-02)
- `analytics-service/routers/match.py` — `_should_skip_allocator` (line 349); `_score_one_allocator` (line 245); `_load_allocator_context` (line ~170 — allocator_preferences read); `RECOMPUTE_MIN_AGE_HOURS = 12` (line 36); existing `force: bool` on `SingleRequest` (line 46)
- `analytics-service/services/scheduled_tasks.py` — `_enqueue_each` pattern (line 39); existing `enqueue_compute_job` RPC call convention; add new `kind='rescore_allocator'`
- `supabase/migrations/061_mandate_columns.sql` — `update_allocator_mandates(...)` RPC body (Phase 3 amends if D-12 RPC-body path is chosen)

### Phase 3 new migration target
- `supabase/migrations/` — migration 062 will be the next number. Pattern: follow 061's self-verifying DO block + BEGIN/COMMIT structure.

### Existing tests (extend, don't fork)
- `analytics-service/tests/test_match_engine.py` — 535 lines; existing fixtures (`_make_candidate`, `_make_returns_series`); imports pattern (`from services.match_engine import …`); add mandate-fit tests here
- `analytics-service/tests/test_match_defaults.py` — extend for new default keys
- `analytics-service/tests/test_accuracy.py` — 318 lines; golden-snapshot candidate for v1→v2 diff test

### Enums + constraints
- `src/lib/constants.ts` — `SUBTYPES` (style_exclusions source), `STRATEGY_TYPES` (preferred_strategy_types source), `EXCHANGES` (excluded_exchanges source); Python side has no direct mirror — engine compares strings
- `supabase/migrations/011_perfect_match.sql` — original `match_batches` + `match_candidates` table definitions; `effective_preferences JSONB NOT NULL` (line 91); `engine_version` column already present

### Phase 4 downstream consumer (read-only reference — do NOT implement)
- Phase 4 will consume `bridge_outcomes` + `match_batches.effective_preferences` to compute per-dimension `success_rate`, adjust `scoring_weight_overrides` via floor/ceiling (FEEDBACK-02 — `min(1.5×default, …)`, `max(0.5×default, …)`) — Phase 3's multiplicative read shape (D-08) is designed for this.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_compute_portfolio_fit_components` produces `corr_with_portfolio` — D-04 reuses directly (zero new corr computation)
- `_eligibility_check` HARD vs SOFT split + relaxation branch in `score_candidates` — D-06 adds `style_excluded` to SOFT_EXCLUSION_REASONS alongside `off_mandate_type`
- `merge_with_defaults(prefs)` — single extension point for all new mandate keys (D-10); preserves the existing "NULL → default" semantic
- `enqueue_compute_job` Supabase RPC — proven from `scheduled_tasks.py`; D-12 reuses with new kind `'rescore_allocator'`
- `_almost_passed_score` helper — extends naturally to rank style-excluded rows for the TOP_N_EXCLUDED debugging surface
- `to_canonical_json` — golden-snapshot test (D-15 #20) uses this directly
- `SingleRequest.force: bool` on POST /scoring/run — the "force" escape hatch of D-11; no new request param

### Established Patterns
- **Hard vs soft exclusion split** with auto-relaxation on sparse — engine philosophy; D-06 style_excluded must join the SOFT bucket to preserve
- **Min-max normalization of components within the eligible set** (`_normalize_min_max`) — mandate contributions are ALREADY in [0, 1] per-dimension so no normalization needed; mandate_fit is raw average
- **Top-level weights sum to 1.0 invariant** — existing v1 has `W_PORTFOLIO_FIT + W_PREFERENCE_FIT + W_TRACK_RECORD + W_CAPACITY_FIT = 1.0` exactly; D-07 + D-08 + D-11 preserve after overrides via defensive clamp + renormalize
- **engine_version persisted per row** — already on `match_batches` (line 284, routers/match.py); D-11 + D-13 leverage this directly
- **Screening mode short-circuit** — `mode == 'screening'` path skips portfolio_fit entirely; D-04 must return `1.0` in screening mode (no portfolio to correlate against)
- **`score_breakdown` JSONB is free-form** — no migration needed to add `mandate_fit_score` + optional `mandate_fit_raw` debug dict; just write the keys

### Integration Points
- **Migration 062** — `supabase/migrations/062_scoring_weight_overrides.sql` (name is planner's call); adds column + optional RPC/trigger amendment
- **`match_engine.py` entry point** — `score_candidates()` signature does not change; internal sub-score added (`mandate_fit_score`); `ENGINE_VERSION` + `WEIGHTS_VERSION` bump to `v2.0.0` together (they're in lockstep per the module docstring)
- **`match_defaults.py`** — `DEFAULT_PREFERENCES` gains 5 new keys; `merge_with_defaults` behavior unchanged (NULL-skips)
- **`routers/match.py`** — `_should_skip_allocator` gains two new checks (D-11); `_load_allocator_context` already reads `allocator_preferences` row in full (`.select("*")` pattern) so new columns come for free
- **Phase 2 RPC (`update_allocator_mandates`)** — D-12 amendment; migration 062 uses `CREATE OR REPLACE FUNCTION` against the signature from 061 or adds a trigger on `allocator_preferences` UPDATE
- **`score_breakdown` consumers** — admin match queue UI reads `score_breakdown.preference_fit`, `.portfolio_fit`, etc. (grep `score_breakdown` in src/); Phase 3 adds new keys, doesn't remove any → zero UI breakage

### Schema Sync Contract
- `allocator_preferences` columns ↔ `ALLOCATOR_PREFERENCES_COLUMNS` const in `src/lib/admin/match.ts` — migration 062 MUST bump this const; Phase 2 MANDATE-07 schema-sync test catches drift
- `match_batches.effective_preferences` JSONB keys ↔ `DEFAULT_PREFERENCES` Python dict — D-10 flat shape means Python defaults are authoritative; no cross-language generator
- `AllocatorPreferences` TS interface (`src/lib/preferences.ts`) — add `scoring_weight_overrides?: Record<string, number> | null` for type completeness (even though Phase 3 has no frontend change, admin types leak into the frontend panel)

</code_context>

<specifics>
## Specific Ideas

- **Composition precedence** (D-02 worked example): for a candidate with `preference_fit = 0.8` and `mandate_fit_score = 0.5`, the effective preference term is `0.6 × 0.8 + 0.4 × 0.5 = 0.68`. That's the number multiplied by `W_PREFERENCE_FIT` in the top-level sum. Allocators with NULL mandates get `mandate_fit_score = 1.0`, effective = `0.6 × 0.8 + 0.4 × 1.0 = 0.88` — strictly higher than pre-composition `0.8`. **Check with planner:** is this upward shift acceptable given v1/v2 cutover (SCORING-01 says invalidate), or should we anchor v1 semantics via `effective = 0.8 × 1.0 + 0.2 × mandate_fit_score` shape (0.8/0.2) instead of 0.6/0.4? ROADMAP SCORING-03 locks 0.6/0.4, so we ship that.
- **Golden-snapshot fixture** (D-15 #20): seed a 3-candidate universe with deterministic returns (fixed seed, fixed strategy metadata), a fully-specified mandate allocator, and one NULL-mandate allocator. Snapshot JSON lives in `analytics-service/tests/fixtures/match_engine_v2_golden.json`. Regenerable via `REGENERATE_GOLDEN=1 pytest tests/test_match_engine.py::test_v1_to_v2_golden_snapshot`.
- **`_compute_mandate_fit_score` signature**: `def _compute_mandate_fit_score(candidate: dict, preferences: dict, corr_with_portfolio: Optional[float], add_weight: float, mode: str) -> tuple[float, dict]` — returns `(score, breakdown)` where breakdown is the per-dimension dict for `score_breakdown.mandate_fit_raw`.
- **`score_breakdown.mandate_fit_score`** is a scalar in [0, 1]; `score_breakdown.mandate_fit_raw` is an optional dict with per-dimension contributions (allocator Claude's Discretion to include for debuggability).
- **ROADMAP edit** (required, planner owns): change the Phase 3 Plans section from 1 bullet to 2:
  ```
  - [ ] 03-01: migration 062 (scoring_weight_overrides column + CONSTRAINTs + optional RPC amendment) + match_engine.py v2.0.0 (new compute_mandate_fit_score helper, composition inside W_PREFERENCE_FIT, SOFT style_excluded reason, effective_preferences snapshot) + unit tests (15-20 cases incl. determinism + v1->v2 golden snapshot)
  - [ ] 03-02: routers/match.py skip-logic extension (mandate_edited_at + engine_version checks) + proactive enqueue wiring (Phase 2 RPC amendment OR Postgres trigger for 'rescore_allocator' compute_job) + integration tests — Depends on 03-01
  ```

</specifics>

<deferred>
## Deferred Ideas

- **`force_recompute` persistent flag** on `allocator_preferences` (admin-settable) — rejected in D-12 in favor of request-level `force: bool` + timestamp comparison; revisit if ops needs a UI toggle
- **Sub-weight overrides** (W_SHARPE_LIFT, W_CORR_REDUCTION, etc.) in `scoring_weight_overrides` — D-09 scopes to top-level only; revisit in Phase 6+ if feedback loop needs finer control
- **`max_weight` as hard exclude above 2× ceiling** — engine currently tapers to 0 (D-03); revisit if allocators complain "I set max_weight=10% but I still see 50%-weight candidates in the list" (they'd see `mandate_fit = 0` and a low final score, but they might want hard-exclude); could add a second `max_weight_hard` column in a future sprint
- **Pairwise correlation max vs. scalar** (D-04 picked scalar) — revisit if allocators report "my portfolio corr is low overall but one holding is 95% correlated with the recommendation"; would add a new `_compute_max_pairwise_corr` helper
- **Liquidity gap direction (D-05 Claude's-Discretion)** — if allocators want symmetric penalty (high-pref allocator gets low → penalize; low-pref allocator gets high → also penalize, for oversize-for-strategy reasons) revisit in a follow-up
- **`effective_preferences` nested shape** (D-10 picked flat) — if Phase 4 or Phase 6 accumulates many more scoring parameters, a nested `mandate: {…}` + `feedback: {…}` split may help readability; breaking change when it lands
- **Property-based tests (hypothesis)** for monotonicity (mandate_fit never increases when more constraints bind) — Phase 6 test hardening scope
- **Mutation testing on match_engine** — same; too heavy for Phase 3
- **Playwright E2E for admin match queue** showing v2 mandate-fit column — possible future UI follow-up; not required by any SCORING-* requirement
- **`ENGINE_VERSION` + `WEIGHTS_VERSION` split** (currently both bump to v2.0.0) — future phases may want independent versioning; not Phase 3 scope

### Reviewed Todos (not folded)
None — no pending repo-level TODOs relevant to Phase 3 surfaced during cross-reference.

</deferred>

---

*Phase: 03-mandate-aware-scoring-engine*
*Context gathered: 2026-04-18*
