# Phase 3: Mandate-Aware Scoring Engine — Research

**Researched:** 2026-04-18
**Domain:** Python scoring engine (FastAPI + pandas) + Supabase migration + cache-invalidation caller
**Confidence:** HIGH for codebase reading (all signatures/line numbers verified). HIGH for the math spec (D-01..D-09 are locked upstream). MEDIUM for the proactive-enqueue mechanism (D-12) — see Open Questions.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 — mandate_fit_score shape:** AVERAGE of four per-dimension contributions (`max_weight`, `correlation_ceiling`, `liquidity_preference`, `style_exclusions`). Each contribution ∈ [0, 1]. Empty mandates → every dimension returns `1.0` → `mandate_fit_score = 1.0`.
- **D-02 — composition:** `effective_preference_fit = 0.6 × _compute_preference_fit + 0.4 × mandate_fit_score`. Top-level weight line stays `W_PREFERENCE_FIT × effective_preference_fit`. Sum of top-level weights = 1.0 pre- AND post-Phase-3.
- **D-03 — max_weight linear taper:** `add_weight = ticket_size / portfolio_aum` clamped to `[0.01, 0.5]`; screening-mode / missing-AUM default `0.10`. `max_weight` NULL → `1.0`. `add_weight ≤ max_weight` → `1.0`. `add_weight > max_weight` → `max(0, 1 - (add_weight - max_weight) / max_weight)`. At 2× ceiling → `0.0`.
- **D-04 — correlation_ceiling:** Reuse existing `corr_with_portfolio` scalar. NULL ceiling OR NULL corr (sparse overlap) → `1.0` (neutral). `corr ≤ ceiling` → `1.0`. `corr > ceiling` → `max(0, 1 - (corr - ceiling) / (1 - ceiling))`. Screening mode → always `1.0`.
- **D-05 — liquidity_preference tier-gap:** Map candidate `manager_aum` to `high` (≥$10M) / `medium` (≥$1M, <$10M) / `low` (>0, <$1M) / neutral (NULL or 0). NULL mandate → `1.0`. Same tier → `1.0`. One-tier gap → `0.5`. Two-tier gap → `0.0`. **Gap direction:** penalize ONLY when candidate tier is LOWER than allocator's preference (allocator=high ∧ candidate=low → 0.0; allocator=low ∧ candidate=high → 1.0 — more liquid is strictly better).
- **D-06 — style_exclusions:** Candidate `subtype` (or `strategy_type` fallback — see §Codebase Research #1 for correct field) matching any entry in `style_exclusions` → **SOFT** exclusion reason `style_excluded`. Relaxable when <5 eligible (same path as `off_mandate_type`). Excluded rows are NOT scored; `style_excluded` does NOT contribute to `mandate_fit_score`.
- **D-07 — scoring_weight_overrides column:** Migration 062 adds `scoring_weight_overrides JSONB NULL` to `allocator_preferences`. Phase 3 engine READS; Phase 4 WRITES.
- **D-08 — overrides shape (multiplicative):** `{"W_PORTFOLIO_FIT": 1.3, …}` (missing keys = `1.0`). Engine: (1) read overrides (NULL → skip); (2) `scaled = DEFAULT_W × override_scale.get(W, 1.0)`; (3) clamp each scale to `[0.5, 1.5]`; (4) renormalize: `effective = scaled[W] / sum(scaled.values())`. Invariant: `sum(effective.values()) == 1.0`.
- **D-09 — override surface:** Only the 4 top-level weights (`W_PORTFOLIO_FIT`, `W_PREFERENCE_FIT`, `W_TRACK_RECORD`, `W_CAPACITY_FIT`) are overridable. Sub-weights (`W_SHARPE_LIFT`, `W_CORR_REDUCTION`, `W_DD_IMPROVEMENT`) are fixed v2.0.0 constants. Screening-mode weights (`W_SCREENING_*`) are NOT overridable.
- **D-10 — effective_preferences snapshot shape:** FLAT merge — every mandate field is a peer key. Includes: `max_drawdown_tolerance, min_sharpe, min_track_record_days, target_ticket_size_usd, preferred_strategy_types, excluded_exchanges, max_weight, correlation_ceiling, liquidity_preference, style_exclusions, scoring_weight_overrides, mandate_archetype, preferred_markets`.
- **D-11 — skip-logic triple check:** `_should_skip_allocator(allocator_id, force)` returns `False` when ANY of: (1) `force == True`; (2) `last_batch.engine_version != ENGINE_VERSION`; (3) `allocator_preferences.mandate_edited_at > last_batch.computed_at`. Otherwise applies `RECOMPUTE_MIN_AGE_HOURS = 12` guard.
- **D-12 — proactive enqueue:** When `update_allocator_mandates(...)` RPC runs, append an enqueue call for `kind='rescore_allocator'`. Mechanism choice (RPC-body PERFORM vs Postgres trigger on `allocator_preferences UPDATE`) is planner's discretion. **CRITICAL CAVEAT:** see §Domain Research #3 — `compute_jobs` has XOR + kind_target_coherence CHECK constraints that do NOT currently accommodate allocator-scoped jobs.
- **D-13 — no data migration:** Existing `_retention_sweep` (keep last 7 batches/allocator) naturally ages out v1 rows.
- **D-14 — single atomic migration 062:** (1) `ALTER TABLE allocator_preferences ADD COLUMN scoring_weight_overrides JSONB`; (2) optional CHECK constraint (lean app-layer per Phase 2 pattern); (3) RPC-body amendment OR trigger install; (4) self-verifying DO block.
- **D-15 — ~15-20 pytest tests in test_match_engine.py (extend, don't fork).** Twenty concrete cases enumerated (empty mandates, per-dimension penalty math, style_excluded hard + relaxation, weight normalization invariants, overrides clamp, determinism, engine version bump, golden snapshot).
- **D-16 — integration tests (Plan 03-02):** Extend `test_accuracy.py` or add `test_match_engine_integration.py` against mocked Supabase. Skip-logic triple check (mandate_edited_at >/< computed_at, engine_version mismatch).
- **D-17 — no E2E, no HAS_LIVE_DB gated tests.** Backend-only phase, `ui_hint=no`.

### Claude's Discretion

- `mandate_fit_score` averaging with NULL dimensions: default = average of present dimensions; may adjust if edge cases demand weighting. **Note:** since every dimension returns 1.0 on NULL mandate (per D-01..D-05), "average of present" ≡ "average of all four" by construction.
- D-12 mechanism: RPC-body PERFORM vs Postgres trigger. Lean RPC body (explicit, auditable, runs in SECURITY DEFINER context).
- `force_recompute` persistent flag: DEFERRED — request-level `force: bool` + `mandate_edited_at` cover the use cases.
- `_compute_mandate_fit_score` placement: co-located in `match_engine.py` (minimal churn).
- `style_excluded` reason copy (user-friendly, e.g. "Matches excluded style: Mean Reversion").
- `score_breakdown` ordering: Python dicts preserve insertion order; place `mandate_fit_score` after `preference_fit`.
- `DEFAULT_PREFERENCES` extension: add `max_weight: None, correlation_ceiling: None, liquidity_preference: None, style_exclusions: [], scoring_weight_overrides: None`.
- Optional `mandate_fit_raw: {max_weight: …, correlation_ceiling: …, liquidity_preference: …, style_exclusions_honored: bool}` dict inside `score_breakdown.raw` for debuggability — RECOMMENDED but not required by any SC.

### Deferred Ideas (OUT OF SCOPE)

- `force_recompute` persistent flag on `allocator_preferences`
- Sub-weight overrides in `scoring_weight_overrides` (Phase 6+)
- `max_weight` as hard exclude above 2× ceiling (future sprint)
- Pairwise-max correlation vs scalar (future)
- Symmetric liquidity-gap direction (future)
- `effective_preferences` nested shape (Phase 6+)
- Property-based (hypothesis) tests, mutation testing (Phase 6)
- Playwright E2E for admin match queue v2 column (possible future)
- Independent `ENGINE_VERSION` + `WEIGHTS_VERSION` versioning (future)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCORING-01 | `match_engine.py` bumps to `ENGINE_VERSION = v2.0.0`; v1 cached batches invalidated via existing version-check. | §Codebase Research #1 locates `ENGINE_VERSION` (line 45) and `WEIGHTS_VERSION` (line 46) as module-level constants — single-line edits. §Codebase Research #2 maps `_should_skip_allocator` (line 349) where D-11 version-check lands. |
| SCORING-02 | `score_candidates()` outputs `mandate_fit_score` inside `score_breakdown` JSONB on `match_candidates`. | §Codebase Research #1 #3 locates the `score_breakdown` dict construction (match_engine.py:643-657). Python dict insert-order preserves placement after `preference_fit`. No migration needed (JSONB is free-form). |
| SCORING-03 | `mandate_fit_score` composes inside `W_PREFERENCE_FIT` as `0.6 × existing_preference_fit + 0.4 × mandate_fit_score`; total scoring weights sum = 1.0 unchanged. | §Codebase Research #1 confirms W_PORTFOLIO_FIT(0.40)+W_PREFERENCE_FIT(0.30)+W_TRACK_RECORD(0.15)+W_CAPACITY_FIT(0.15)=1.0 exactly. D-02 preserves invariant — 0.6/0.4 lives INSIDE the 0.30 `W_PREFERENCE_FIT` term. |
| SCORING-04 | Allocators with empty mandates get `mandate_fit_score = 1.0` (graceful degradation). | D-01 guarantees per-dimension contribution `1.0` on NULL mandate field. Implementation: each sub-function short-circuits to `1.0` on NULL. Test case D-15 #1 asserts this. |
| SCORING-05 | Mandate updates invalidate the allocator's cached batch via `updated_at` comparison (no full recompute). | Correction: uses `mandate_edited_at` (not `updated_at`) — Phase 2 D-08 separates allocator-initiated write timestamp from admin-edit. D-11 check #3 is literally this. §Codebase Research #2 locates extension site. |
| SCORING-06 | `match_batches.effective_preferences` snapshots the effective scoring inputs at scoring time (mandates + overrides). | D-10 locks flat-dict shape. `effective_preferences` persisted on line 286 of routers/match.py; `result["effective_preferences"]` built on line 685 of match_engine.py (`prefs = merge_with_defaults(...)`). DEFAULT_PREFERENCES extension (§Codebase Research #7) ensures all keys present. |
| SCORING-07 | Constraint enforcement: `max_weight` exceeded → `mandate_fit < 1.0`; style exclusion → hard exclude; correlation ceiling breach → penalized. | D-03 (taper), D-04 (smooth degradation), D-06 (SOFT exclude via `style_excluded` reason). §Codebase Research #1 confirms `corr_with_portfolio` already computed. Test cases D-15 #4, #6, #8 cover each. |

</phase_requirements>

## Summary

Phase 3 extends `analytics-service/services/match_engine.py` v1.0.0 → v2.0.0 by inserting a `mandate_fit_score` sub-scalar inside the existing `W_PREFERENCE_FIT` term (`effective = 0.6×preference_fit + 0.4×mandate_fit`), reading four mandate columns already shipped by Phase 2 migration 061, and bumping `ENGINE_VERSION` to invalidate v1 cached batches via the existing version-check in `_should_skip_allocator`. Migration 062 adds one new column (`scoring_weight_overrides JSONB NULL`) consumed by the engine's multiplicative weight-override logic (renormalized to sum=1.0 with `[0.5, 1.5]` clamp). Split into two plans: **03-01** is atomic (migration + engine math + unit tests), **03-02** is caller wiring (`_should_skip_allocator` triple-check + proactive enqueue + integration tests, Depends on 03-01).

**Primary recommendation:** Co-locate `_compute_mandate_fit_score()` in `match_engine.py` alongside `_compute_preference_fit` / `_compute_track_record_score` / `_compute_capacity_fit` (three existing peer helpers at lines 221/253/259). Keep the signature `(candidate, preferences, corr_with_portfolio, add_weight, mode) -> tuple[float, dict]` returning `(score, per-dimension breakdown)` so `score_breakdown.mandate_fit_raw` debuggability is optional but cheap.

**Blocker for Plan 03-02:** The "proactive enqueue via `compute_jobs`" path in D-12 is architecturally incompatible with the current `compute_jobs` schema — see §Domain Research #3 and §Open Questions #1. Planner MUST resolve before 03-02 begins.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mandate-fit scoring math | Analytics / Python | — | Pure compute, no I/O; lives with `score_candidates()`. |
| Score breakdown persistence | Analytics / Python → Postgres | — | Writer is `_score_one_allocator` in routers/match.py; row lands in `match_candidates.score_breakdown` JSONB. |
| `scoring_weight_overrides` read | Analytics / Python | — | Engine consumes; column exists in Postgres allocator_preferences. |
| `scoring_weight_overrides` write | Analytics (Phase 4 only) | — | Phase 3 ships column + reader; Phase 4 adds the `feedback_engine.py` writer. |
| Cache-invalidation skip logic | Analytics / Python → Postgres | — | `_should_skip_allocator` queries Postgres; decision lives in FastAPI. |
| Proactive rescore enqueue | Postgres (RPC or trigger) → Analytics worker | — | D-12 debate is RPC-body PERFORM vs table trigger; dispatch lives in Python worker once the kind is added. |
| Migration 062 DDL | Postgres | — | Standard Supabase migration; no app-tier logic. |
| `ALLOCATOR_PREFERENCES_COLUMNS` TS const | API/Next.js (server-only) | — | Schema-sync contract; caught by `src/__tests__/mandate-columns-schema-sync.test.ts`. |
| `score_breakdown` UI read | Admin Match Queue (Next.js) | — | Phase 3 adds keys, doesn't remove; zero UI change required. |

**Why it matters:** Phase 3 is purely backend (Python + Postgres). The one crossover into Next.js is the schema-sync TS const update — a single literal edit + a test-import. No admin-UI code changes required (score_breakdown is already read as a free-form JSONB `Record<string, unknown>`).

## Domain Research

### 1. Scoring Math Validation — Exact field names and call sites

**D-03 `add_weight`:** computed at `match_engine.py:534-538`:

```python
if mode == "personalized" and portfolio_aum and portfolio_aum > 0:
    ticket = prefs.get("target_ticket_size_usd") or 0
    add_weight = _clamp(ticket / portfolio_aum, 0.01, 0.5)
else:
    add_weight = 0.10  # Default for cold-start or unknown AUM
```

Clamp range confirmed: `[0.01, 0.5]`. Screening-mode default: `0.10`. D-03's `max_weight` math lines up with this exactly.

**D-04 `corr_with_portfolio`:** stored in `raw_components[i]["corr_with_portfolio"]` at `match_engine.py:593`, copied into `score_breakdown.raw.corr_with_portfolio` at `match_engine.py:648`. Produced by `_compute_corr_with_portfolio` (line 112) with `min_overlap_days=10` default; returns `None` (not 0.0) on short overlap — D-04 must treat `None` as neutral (`1.0`).

**Screening mode branch:** `match_engine.py:574-580` forces all four `pf_components` (including `corr_with_portfolio`) to `None` in screening mode. D-04 correctly returns `1.0` in screening mode (no portfolio to correlate against).

**D-05 liquidity tier — candidate AUM field:** `candidate.get("manager_aum")`. Confirmed at `match_engine.py:264` (capacity_fit reads it) and at `routers/match.py:148`:

```python
"manager_aum": float(strategy.get("aum")) if strategy.get("aum") else None,
```

This is `strategies.aum` from the DB (migration 011), populated from wizard/exchange sync. NOT `strategy_aum`. The field IS nullable; D-05 maps `NULL`/`0`/unknown → neutral `1.0`. Threshold ladder `>=$10M`/`>=$1M`/`>0` → high/medium/low is a plain `if/elif` in Python.

**D-06 style_exclusions field:** `candidate.get("strategy_type")`. Confirmed at `match_engine.py:188-192`:

```python
pref_types = preferences.get("preferred_strategy_types") or []
if pref_types:
    cand_type = candidate.get("strategy_type")
    if cand_type and cand_type not in pref_types:
        return ("off_mandate_type", cand_type)
```

However, `SUBTYPES` and `STRATEGY_TYPES` are DIFFERENT enums in `src/lib/constants.ts`:
- `STRATEGY_TYPES = ["Long-Only", "Short-Only", "Long-Short", "Market Neutral", "Delta Neutral", "Arbitrage", "Other"]`
- `SUBTYPES = ["Trend Following", "Momentum", "Breakout", "Mean Reversion", "Statistical Arbitrage", "Market Making", "Basis Trading", "Funding Rate"]`

`style_exclusions` stores SUBTYPES values. `candidate["strategy_type"]` (populated from `strategies.strategy_types[0]` at `routers/match.py:137` as primary-type) stores a STRATEGY_TYPES value. **These will never match each other on equality.** Pitfall: naïvely comparing `candidate["strategy_type"]` to `style_exclusions` entries yields zero matches → `style_excluded` never fires.

The `strategies` table has `strategy_types TEXT[]` (ARRAY of STRATEGY_TYPES) AND `subtypes TEXT[] NOT NULL DEFAULT '{}'` (ARRAY of SUBTYPES) `[VERIFIED: supabase/migrations/001_initial_schema.sql:54-55]`. `routers/match.py:133-141` currently selects only `strategy_types` + `supported_exchanges`, not `subtypes`. Planner MUST (a) extend the SELECT at `routers/match.py:91-97` to include `subtypes`; (b) populate `candidate["subtype"] = strategy.get("subtypes", [])[0] if strategy.get("subtypes") else None` in `_load_candidate_universe`; (c) compare `candidate.get("subtype")` against `style_exclusions` in `_eligibility_check`. This is not a pedantic issue — SCORING-07 hinges on it working.

**`SOFT_EXCLUSION_REASONS` set:** `match_engine.py:141-146`:

```python
SOFT_EXCLUSION_REASONS = {
    "below_min_sharpe",
    "below_min_track_record",
    "exceeds_max_dd",
    "off_mandate_type",
}
```

D-06 adds `"style_excluded"` to this set. Used at `match_engine.py:702-717` to classify almost-passed sort priority (`_almost_passed_score`). Planner should add a branch for `style_excluded` in that helper (heuristic: treat like `off_mandate_type` — neutral ~0.5).

**Eligibility check signatures:** `_eligibility_check(cand, prefs, owned_set, thumbs_down_set) -> (reason, provenance)` at line 149; `_eligibility_check_hard_only(...)` at line 197. D-06 adds its check in `_eligibility_check` only (hard-only is for the relaxation pass, which drops soft exclusions).

### 2. Cache Invalidation Flow — Extending `_should_skip_allocator`

Current implementation (`routers/match.py:349-370`):

```python
async def _should_skip_allocator(allocator_id: str, force: bool) -> bool:
    if force:
        return False
    supabase = get_supabase()
    result = await asyncio.to_thread(
        lambda: supabase.table("match_batches")
        .select("computed_at")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return False
    try:
        last_at = datetime.fromisoformat(rows[0]["computed_at"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    age_hours = (datetime.now(timezone.utc) - last_at).total_seconds() / 3600
    return age_hours < RECOMPUTE_MIN_AGE_HOURS
```

**D-11 extension needs:**
1. Extend `.select("computed_at")` → `.select("computed_at, engine_version")`. No index change — `match_batches` already has `idx_match_batches_allocator_recent(allocator_id, computed_at DESC)` from migration 011:97.
2. Add one new Supabase query against `allocator_preferences.mandate_edited_at` (indexed by PK `user_id`, O(1) lookup).
3. Compare: if any of (force / engine_version mismatch / mandate_edited_at > computed_at) → return False (don't skip). Else the existing 12-hour age check.

**`_load_allocator_context` already reads full row:** `routers/match.py:171-174`:
```python
prefs_result = supabase.table("allocator_preferences").select("*").eq(
    "user_id", allocator_id
).maybe_single().execute()
```

`.select("*")` means the 5 Phase 2 columns + new `scoring_weight_overrides` column come for free — no select list to update. CONTEXT.md §Integration Points confirms this.

**`SingleRequest.force: bool`:** `routers/match.py:44-46`:

```python
class RecomputeRequest(BaseModel):
    allocator_id: str
    force: bool = False
```

CONTEXT.md incorrectly names this `SingleRequest` — the actual class is `RecomputeRequest`. Planner should note this correction. `force` threaded through `_should_skip_allocator(req.allocator_id, req.force)` at line 408. Zero signature change needed.

### 3. Proactive Enqueue (D-12) — CRITICAL ARCHITECTURAL BLOCKER

CONTEXT.md D-12 assumes `enqueue_compute_job(kind='rescore_allocator', p_allocator_id=auth.uid())` can drop into the `update_allocator_mandates` RPC body. **It cannot — as specified — without schema changes to `compute_jobs`.** Three constraints block it:

**Blocker 1 — `compute_jobs_target_xor` CHECK constraint (migration 032:138-141):**
```sql
CONSTRAINT compute_jobs_target_xor CHECK (
  (strategy_id IS NOT NULL AND portfolio_id IS NULL) OR
  (strategy_id IS NULL AND portfolio_id IS NOT NULL)
)
```

Every `compute_jobs` row must target exactly one of `strategy_id` XOR `portfolio_id`. There is no `allocator_id` column. A naïve "allocator rescore" row has no legal target.

**Blocker 2 — `compute_jobs_kind_target_coherence` CHECK (last edited migration 048:127-138):**
```sql
CHECK (
  (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL) OR
  (kind IN ('sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding',
            'reconcile_strategy', 'compute_intro_snapshot')
   AND strategy_id IS NOT NULL)
)
```

Every kind is locked to either portfolio- or strategy-scoped. Adding `rescore_allocator` requires DROP+ADD of this CHECK (same pattern as migrations 036 and 048).

**Blocker 3 — `enqueue_compute_job(p_strategy_id UUID, p_kind TEXT, …)` RPC signature (migration 032:455-481):**

The public wrapper takes `p_strategy_id` as the first required param, calls `_assert_owner('strategies'::regclass, p_strategy_id, …)`, and delegates to `_enqueue_compute_job_internal(p_strategy_id, NULL, …)`. Same story for `enqueue_compute_portfolio_job` (migration 032:493-517) — takes `p_portfolio_id`, asserts owner on `portfolios`.

**There is no `enqueue_compute_allocator_job` RPC.** Authoring one means: (a) adding an `allocator_id UUID NULL` column on `compute_jobs` with a 3-way XOR CHECK; (b) new `_assert_owner` call against `profiles`; (c) new unique index for per-allocator in-flight dedup; (d) new entry in `compute_job_kinds`; (e) relax `kind_target_coherence` to a 3-way form; (f) add a `rescore_allocator` handler to `analytics-service/services/job_worker.py` (currently an if/elif ladder at line 1125-1140); (g) add a `TIMEOUT_PER_KIND["rescore_allocator"]` entry.

This is ~6× the scope Phase 3 currently assumes for "one SECURITY DEFINER PERFORM call inside migration 062."

**Three recovery paths** (planner picks):

| Option | Pros | Cons |
|--------|------|------|
| **A. Defer proactive enqueue; rely purely on skip-logic triple check (D-11).** `mandate_edited_at > last_batch.computed_at` already invalidates on next scoring run (daily cron or admin-triggered recompute). | Zero compute_jobs schema churn. Ships today. SC1 + SC3 still met — mandate edits DO invalidate, just on next-batch boundary not instantly. | 12-hour max latency between mandate edit and rescore (worst case: cron ran 11h58m ago, mandate edited 1m ago, next cron 12h away). For a founder-only demo this is irrelevant; at scale it becomes a UX wrinkle. |
| **B. Expand compute_jobs with allocator_id column + new RPC.** Full D-12 as spec'd, but migration 062 grows to ~300 lines of DDL + three new RPCs + worker handler. | Proactive enqueue fires on every mandate write; UX crisp. | Inflates Phase 3 scope ~3x. Touches `job_worker.py` (currently 1188 LoC, already flagged in CONCERNS.md as debt). Any cert/review requirement flags the schema change as non-trivial. |
| **C. Lightweight "rescore_hints" queue.** New single-purpose table `rescore_hints(allocator_id uuid pk, hinted_at timestamptz)`; RPC upserts on every mandate write; daily cron reads the table + runs `_score_one_allocator` for every hinted row; UPDATE `rescore_hints` on consumption. | Much simpler than B — one table, one index, one cron integration. No compute_jobs disturbance. | Adds a new table (Phase 2 already added 5 columns; Phase 3 already adds 1). Slight architectural debt. |

**Recommendation: Option A for Plan 03-02.** The D-11 skip-logic triple check ALREADY handles cache invalidation on the very next recompute attempt. "Proactive" only matters if someone wants *synchronous* rescoring — but the engine is founder-only admin surface (per match_engine.py docstring lines 3-5) and the cron runs daily. Plan 03-02 can defer proactive enqueue as a future enhancement, keep migration 062 minimal (one ALTER TABLE + one CHECK), and retire D-12 for Phase 3. This saves ~200 lines of migration DDL and avoids 1188-line `job_worker.py` churn.

If planner picks A: update CONTEXT.md D-12 to mark "DEFERRED to Phase 4 or later" and note in ROADMAP.md. The SCORING-05 requirement text — "invalidate the allocator's cached batch via `updated_at` comparison (no full recompute)" — is literally satisfied by D-11 without D-12. `[VERIFIED: requirement text in REQUIREMENTS.md:36]`.

**If planner picks B or C:** additional 03-02 tasks include worker handler + pytest harness extension.

### 4. Migration 062 scope + constraints

**Next available number:** 062 (061 is the last shipped, confirmed via `ls supabase/migrations/*.sql | sort -r | head`).

**Single-file multi-operation precedent:** Migration 061 itself does 4 operations (ADD COLUMN × 5, ADD CHECK, DROP POLICY, CREATE OR REPLACE FUNCTION) in one `BEGIN; … COMMIT;` block. Migration 048 does ALTER TABLE ADD COLUMN × 5, INSERT INTO compute_job_kinds, DROP+ADD CHECK, DROP INDEX + CREATE INDEX, all in one. Supabase CLI (`npx supabase db push`) handles this cleanly.

**Self-verifying DO block pattern (migration 061:222-280 is the precedent):**
```sql
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'allocator_preferences'
     AND column_name = 'scoring_weight_overrides';
  IF col_count <> 1 THEN
    RAISE EXCEPTION 'Migration 062 failed: scoring_weight_overrides column missing';
  END IF;
  -- more asserts …
  RAISE NOTICE 'Migration 062: scoring_weight_overrides + {RPC/trigger} verified.';
END
$$;
```

**JSONB CHECK constraint for shape (if planner chooses to add one):**
```sql
ALTER TABLE allocator_preferences
  ADD CONSTRAINT allocator_preferences_scoring_weight_overrides_keys_check
    CHECK (
      scoring_weight_overrides IS NULL OR (
        jsonb_typeof(scoring_weight_overrides) = 'object'
        AND (scoring_weight_overrides - ARRAY[
          'W_PORTFOLIO_FIT','W_PREFERENCE_FIT','W_TRACK_RECORD','W_CAPACITY_FIT'
        ]::text[]) = '{}'::jsonb
      )
    );
```

Rationale: reject rows with unknown top-level weight keys. D-09 locks this subset. App-layer validation is easier to iterate (Phase 2 D-07 precedent); DB-layer is stronger. Planner's call — lean app-layer for minimum Phase 3 footprint.

**`update_allocator_mandates(...)` amendment (if D-12 Option B is chosen):** `CREATE OR REPLACE FUNCTION` in migration 062 reusing the full 10-param signature from migration 061:100-111. The body appends `PERFORM enqueue_compute_job(...)` before the final `END`. **BUT:** per §Domain Research #3, the target param needs to be `p_allocator_id` which doesn't match the current `enqueue_compute_job` signature. This reinforces Recommendation A (defer proactive enqueue).

## Codebase Research

### 1. match_engine.py — Exact structure for the extension

```
Line 45    ENGINE_VERSION = "v1.0.0"         ← bump to "v2.0.0"
Line 46    WEIGHTS_VERSION = "v1.0.0"        ← bump to "v2.0.0" (lockstep per module docstring)
Line 54-57 W_PORTFOLIO_FIT / W_PREFERENCE_FIT / W_TRACK_RECORD / W_CAPACITY_FIT = 0.40/0.30/0.15/0.15
Line 65-67 W_SHARPE_LIFT / W_CORR_REDUCTION / W_DD_IMPROVEMENT = 0.50/0.30/0.20
Line 141-146  SOFT_EXCLUSION_REASONS set    ← add "style_excluded"
Line 149-194  _eligibility_check            ← insert style_exclusions branch (after off_mandate_type)
Line 221-250  _compute_preference_fit       ← NEW peer helper compute_mandate_fit_score goes near here
Line 253      _compute_track_record_score
Line 259-277  _compute_capacity_fit
Line 280-361  _compute_portfolio_fit_components   ← produces corr_with_portfolio
Line 427-691  score_candidates (main entry)
  Line 453      prefs = merge_with_defaults(preferences or {})  ← default merger, extend in match_defaults.py
  Line 461      mode = "personalized" if portfolio_strategies else "screening"
  Line 488-516  Relaxation branch (SOFT exclusions dropped). Add style_exclusions drop here.
  Line 534-538  add_weight computation
  Line 561-595  raw_components[i] populated (sharpe_lift, corr_reduction, dd_improvement, corr_with_portfolio)
  Line 611-670  Final scoring loop:
    Line 625      preference_fit = _compute_preference_fit(cand, prefs)
                  ← INSERT: mandate_fit_score, mandate_fit_raw = _compute_mandate_fit_score(...)
                  ← INSERT: effective_preference_fit = 0.6 * preference_fit + 0.4 * mandate_fit_score
    Line 626-627  track_record / capacity_fit
    Line 629-641  final_score = 100 * (weighted sum).
                  ← CHANGE: use effective_preference_fit in place of preference_fit.
                  ← CHANGE: if scoring_weight_overrides present, apply renormalized scaled weights
                     (screening-mode weights unaffected per D-09).
    Line 643-657  score_breakdown dict construction
                  ← INSERT key "mandate_fit_score": mandate_fit_score
                  ← OPTIONAL: breakdown["raw"]["mandate_fit_raw"] = mandate_fit_raw
Line 680-691  Result dict ("effective_preferences": prefs, etc.)
                  ← prefs ALREADY flat per merge_with_defaults; D-10 shape satisfied when DEFAULT_PREFERENCES adds mandate keys.
Line 740-742  to_canonical_json — determinism helper. Used by test_match_engine.py#test_determinism (line 355) and will be reused for the golden snapshot test (D-15 #20).
```

The module already has the `Optional` import and `pandas/numpy/json/math` — no new imports needed for mandate math.

### 2. routers/match.py — Caller extension points

```
Line 20-25   from services.match_engine import (ENGINE_VERSION, TOP_N_CANDIDATES, WEIGHTS_VERSION, score_candidates)
Line 36      RECOMPUTE_MIN_AGE_HOURS = 12
Line 44-46   class RecomputeRequest(BaseModel): allocator_id: str; force: bool = False
Line 166-242 _load_allocator_context(allocator_id)
  Line 171-174   preferences fetched via .select("*") — mandate cols + scoring_weight_overrides come free
Line 245-346 _score_one_allocator(allocator_id, universe)
  Line 259-269   score_candidates(...) call — UNCHANGED signature
  Line 276-290   batch_row dict construction — engine_version + effective_preferences fields already present (lines 284+286)
Line 349-370 _should_skip_allocator(allocator_id, force) ← D-11 triple-check goes here
  Line 355-361   Current: SELECT computed_at from match_batches
                 ← CHANGE: SELECT computed_at, engine_version
                 ← INSERT: if last.engine_version != ENGINE_VERSION: return False
                 ← INSERT: second query — SELECT mandate_edited_at FROM allocator_preferences WHERE user_id = allocator_id
                 ← INSERT: if mandate_edited_at > last.computed_at: return False
Line 408     await _should_skip_allocator(req.allocator_id, req.force) — forced path already wired
Line 490     cron path: await _should_skip_allocator(allocator_id, force=False)
```

`_should_skip_allocator` is called from both `POST /api/match/recompute` (line 408, via `req.force`) and the daily cron (line 490, `force=False`). Both must benefit from the triple check.

### 3. match_defaults.py — DEFAULT_PREFERENCES extension

Current (analytics-service/services/match_defaults.py:9-19):

```python
DEFAULT_PREFERENCES: dict[str, Any] = {
    "max_drawdown_tolerance": 0.30,
    "min_track_record_days": 180,
    "min_sharpe": 0.5,
    "target_ticket_size_usd": 50000.0,
    "max_aum_concentration": 0.20,
    "preferred_strategy_types": [],
    "preferred_markets": [],
    "excluded_exchanges": [],
    "mandate_archetype": None,
}
```

Extend with 5 keys per CONTEXT.md Claude's Discretion:

```python
    "max_weight": None,
    "correlation_ceiling": None,
    "liquidity_preference": None,
    "style_exclusions": [],
    "scoring_weight_overrides": None,
```

**`merge_with_defaults` semantics (line 22-34):** "A None value in prefs does NOT override the default — fields are nullable" — this is asserted by `test_match_defaults.py::test_merge_keeps_default_when_value_is_none`. So:
- Default `None` + input `None` → stays `None` (good, D-01 branch `NULL → 1.0` fires)
- Default `None` + input `0.25` → `0.25` (good, scalar flows through)
- Default `[]` + input `None` → stays `[]` (style_exclusions default empty list, per D-01 array branch)
- Default `[]` + input `["Mean Reversion"]` → `["Mean Reversion"]`

No behavior change to `merge_with_defaults` itself — only the dict literal extends.

### 4. Integration with test_match_engine.py (D-15)

**Fixtures (`_make_candidate`, `_make_returns_series`):**

```python
def _make_candidate(strategy_id="s1", sharpe=1.5, track_record_days=365,
                    max_drawdown_pct=-0.15, manager_aum=5_000_000,
                    exchange="binance", strategy_type="trend_following")
```

`_make_candidate` does NOT currently accept a `subtype` kwarg — the `strategy_type` kwarg is already lowercase `"trend_following"` which doesn't match any STRATEGY_TYPES value. For Phase 3 tests, planner adds `subtype="Mean Reversion"` kwarg (default to some SUBTYPES value) and updates the production candidate dict to carry `"subtype"`. Alternatively, update `_make_candidate` to accept `subtype: str | None = None` and test mandate-fit paths both with and without subtype set.

**`_make_returns_series(n_days=100, seed=42, daily_return=0.001)` — DETERMINISTIC** via explicit seed. Reusable for the golden snapshot fixture (D-15 #20).

**Golden snapshot regeneration pattern:** `to_canonical_json(result)` (match_engine.py:740-742) already exists. The snapshot test writes to / reads from `analytics-service/tests/fixtures/` (directory exists per `ls` output). Pattern:

```python
FIXTURES_DIR = Path(__file__).parent / "fixtures"

def test_v1_to_v2_golden_snapshot():
    result = score_candidates(**STATIC_ARGS)
    actual = to_canonical_json(result)
    expected_path = FIXTURES_DIR / "match_engine_v2_golden.json"
    if os.environ.get("REGENERATE_GOLDEN"):
        expected_path.write_text(actual + "\n")
    expected = expected_path.read_text().strip()
    assert actual == expected
```

**`HAS_LIVE_DB` gate:** D-17 says no. `HAS_LIVE_DB` is a TypeScript test convention (`src/lib/test-helpers/live-db.ts`); pytest has no Python equivalent in this codebase (no `HAS_LIVE_DB` in `conftest.py`). Integration tests for 03-02 use mocked Supabase via `MagicMock` (established pattern in `test_audit.py` lines cited in §Dependencies & Libraries).

### 5. Schema-sync test — `src/__tests__/mandate-columns-schema-sync.test.ts`

Line 42-47 asserts every Phase 2 key present in the exported constant:
```typescript
expect(EXPECTED_COLUMNS_SET.has("max_weight")).toBe(true);
// ... etc for correlation_ceiling / liquidity_preference / style_exclusions / mandate_edited_at / edited_by_user_id
```

**Phase 3 extension:** add one assertion:
```typescript
expect(EXPECTED_COLUMNS_SET.has("scoring_weight_overrides")).toBe(true);
```

And update `ALLOCATOR_PREFERENCES_COLUMNS` in `src/lib/admin/match.ts:34-40`:
```typescript
export const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, edited_by_user_id, updated_at, " +
  "max_weight, correlation_ceiling, liquidity_preference, style_exclusions, mandate_edited_at, " +
  // Phase 3 (migration 062)
  "scoring_weight_overrides";
```

Test layer = static (always runs, asserts constant contains key) + live-DB (HAS_LIVE_DB gate, does a `.select(ALLOCATOR_PREFERENCES_COLUMNS).limit(0)` probe). Both layers auto-cover the new key.

### 6. `AllocatorPreferences` TS interface (src/lib/preferences.ts)

Current interface (lines 17-39) already lists all 5 Phase 2 columns. Phase 3 extension adds one field:

```typescript
export interface AllocatorPreferences {
  // … existing fields …
  mandate_edited_at: string | null;
  // Phase 3 — scoring weight overrides (migration 062)
  scoring_weight_overrides: Record<string, number> | null;
}
```

Note: Phase 3 has zero frontend surface by design (`ui_hint: no` per ROADMAP). The interface edit is for type completeness only — Phase 4 writes to this field, admin UI will eventually show it.

### 7. `_score_one_allocator` — engine_version + effective_preferences persistence

`routers/match.py:276-290` already persists `engine_version` (line 284) and `effective_preferences` (line 286) into `match_batches`. Because match_engine.py's `score_candidates` now returns `effective_preferences` with the 5 new keys (via `prefs = merge_with_defaults(...)`), SCORING-06 auto-satisfies at merge. No routers/match.py code change required for this part.

## Dependencies & Libraries

**No new dependencies added.** Phase 3 is pure Python stdlib + existing `pandas`/`numpy`. `compute_sharpe`/`avg_corr`/`max_drawdown` already re-exported from `match_engine.py` (lines 38-40).

### External doc references (Context7 / WebSearch)

- `[CITED: analytics-service/services/portfolio_optimizer.py:1-53]` — existing `find_improvement_candidates` pattern for comparison; match_engine's `_compute_portfolio_fit_components` is its descendant. Unchanged by Phase 3.
- `[VERIFIED: .planning/codebase/ARCHITECTURE.md:109-119]` — analytics service layering and worker pattern. Phase 3 touches only `services/match_engine.py`, `services/match_defaults.py`, `routers/match.py` (read path + extension in `_should_skip_allocator`).
- `[VERIFIED: supabase/migrations/032_compute_jobs_queue.sql]` — full `enqueue_compute_job` RPC spec — see §Domain Research #3 for why this blocks the proactive enqueue path.
- `[VERIFIED: supabase/migrations/036/048]` — precedent for adding a new kind (`poll_positions`, `compute_intro_snapshot`) via INSERT + DROP/ADD CHECK. Template for the rescore_allocator path (if chosen).
- `[CITED: docs/architecture/adr-0001-rls-primary-authorization.md]` — SECURITY DEFINER RPC + RLS pattern. Migration 062 doesn't need new RLS (allocator_preferences already has 5 policies from migration 011, MANDATE-06 Option A dropped allocator_prefs_self_update, RPC is the write path).
- **Context7 lookup (pandas):** `pd.Series.corr` — deterministic given same inputs. `pandas.concat(...).dropna()` — order-preserving. Verified via `test_determinism` (test_match_engine.py:355-369) which currently passes on v1 scoring.
- **pandas version:** `[VERIFIED: analytics-service/requirements.txt]` not read here; pandas is present (match_engine.py:26 `import pandas as pd`). Match-engine determinism relies on `.corr()` being numerically stable across Python 3.14 + pandas 2.x. Existing test coverage at match_engine.py:355-369 is the regression guard.

## Test Infrastructure

### Python test framework

| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio (asyncio_mode=auto) |
| Config file | `analytics-service/pytest.ini` |
| Working directory | `analytics-service/` |
| Quick run command | `pytest tests/test_match_engine.py -x` |
| Full suite command | `pytest --cov=services --cov-report=term-missing` |
| Coverage gate | 80% (enforced in CI via `--cov-fail-under=80`) |

### Fixtures (reusable)

- `analytics-service/tests/conftest.py` — shared (`golden_returns`, `zero_vol_returns`, `benchmark_returns`, `sample_trades`, `empty_returns`, `single_trade_returns`)
- `analytics-service/tests/test_match_engine.py` — local (`_make_candidate`, `_make_returns_series`)

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCORING-01 | ENGINE_VERSION == "v2.0.0" | unit | `pytest tests/test_match_engine.py::test_engine_version_is_set -x` | ✅ — extend existing (line 533) to assert == "v2.0.0" |
| SCORING-02 | mandate_fit_score key present in every score_breakdown | unit | `pytest tests/test_match_engine.py::test_mandate_fit_score_always_present -x` | ❌ Wave 0 |
| SCORING-03 | composition math 0.6 × pref + 0.4 × mandate | unit | `pytest tests/test_match_engine.py::test_effective_preference_fit_composition -x` | ❌ Wave 0 |
| SCORING-04 | empty mandates → mandate_fit_score = 1.0 | unit | `pytest tests/test_match_engine.py::test_empty_mandates_fit_score_one -x` | ❌ Wave 0 |
| SCORING-05 | _should_skip_allocator returns False when mandate_edited_at > computed_at | integration (mocked Supabase) | `pytest tests/test_match_engine_integration.py::test_skip_logic_mandate_edit -x` | ❌ Wave 0 (Plan 03-02) |
| SCORING-06 | effective_preferences includes new mandate keys | unit | `pytest tests/test_match_engine.py::test_effective_preferences_includes_mandate -x` | ❌ Wave 0 |
| SCORING-07 | max_weight breach → mandate_fit < 1.0 AND style_exclusions → hard exclude AND correlation breach → penalty | unit (3 tests) | `pytest tests/test_match_engine.py -k "max_weight_violation or style_exclusion_hard_exclude or correlation_ceiling_breach"` | ❌ Wave 0 |
| Cross-cutting (D-15 #12-14) | `scoring_weight_overrides` renormalize + clamp | unit | `pytest tests/test_match_engine.py -k "override"` | ❌ Wave 0 |
| Determinism (D-15 #16, #20) | byte-identical JSON + golden snapshot | unit | `pytest tests/test_match_engine.py::test_determinism tests/test_match_engine.py::test_v1_to_v2_golden_snapshot` | ⚠️ existing test_determinism at line 355 covers current engine; golden snapshot is NEW |
| Backward compat (D-15 #19) | v1 prefs dict (no mandate keys) → unchanged scoring | unit | `pytest tests/test_match_engine.py::test_v1_prefs_backward_compat -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pytest tests/test_match_engine.py tests/test_match_defaults.py -x` (should run in <10s)
- **Per wave merge:** `pytest --cov=services --cov-fail-under=80` (full analytics-service suite, ~60s)
- **Phase gate:** Full suite green + 15-20 mandate-fit tests added + golden snapshot regenerable.

### Wave 0 Gaps

- [ ] `tests/fixtures/match_engine_v2_golden.json` — fixture file for golden snapshot regeneration (D-15 #20). Regenerable via `REGENERATE_GOLDEN=1 pytest tests/test_match_engine.py::test_v1_to_v2_golden_snapshot`. Pinned after first clean run.
- [ ] `tests/test_match_engine_integration.py` (Plan 03-02, deps: 03-01) — mocked-Supabase test harness for `_should_skip_allocator` triple check. Not needed for 03-01.
- [ ] Framework install: none — pytest + pytest-asyncio already present.

### Mocking pattern (from TESTING.md:319-330)

Python uses `monkeypatch` + `MagicMock`/`AsyncMock` for Supabase. Example for `_should_skip_allocator` tests:

```python
def test_skip_when_mandate_edited_before_last_batch(monkeypatch):
    mock_sb = MagicMock()
    # Chain: .table("match_batches").select(...).eq(...).order(...).limit(1).execute()
    mock_sb.table("match_batches").select().eq().order().limit().execute.return_value = \
        MagicMock(data=[{"computed_at": "2026-04-18T12:00:00Z", "engine_version": "v2.0.0"}])
    # Chain: .table("allocator_preferences").select("mandate_edited_at").eq().maybe_single().execute()
    mock_sb.table("allocator_preferences").select().eq().maybe_single().execute.return_value = \
        MagicMock(data={"mandate_edited_at": "2026-04-18T10:00:00Z"})
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)
    # ... call _should_skip_allocator, assert True (mandate edit is BEFORE last batch, skip)
```

Fresh test file in 03-02 because routers/match.py has no existing test file (grep confirms no `analytics-service/tests/test_routers_match.py`).

## Schema-sync Contract

### Migration 062 → TS const propagation

| Step | What | Where | When |
|------|------|-------|------|
| 1 | `ALTER TABLE allocator_preferences ADD COLUMN scoring_weight_overrides JSONB` | `supabase/migrations/062_scoring_weight_overrides.sql` | Plan 03-01 Task 1 |
| 2 | `npx supabase db push` (or equivalent) | Dev DB | Plan 03-01 Task 1 — self-verify DO block emits NOTICE |
| 3 | Append `", scoring_weight_overrides"` to `ALLOCATOR_PREFERENCES_COLUMNS` | `src/lib/admin/match.ts:34-40` | Plan 03-01 Task 2 (same commit as migration preferred — Phase 2 precedent) |
| 4 | Add `scoring_weight_overrides: Record<string, number> \| null` to `AllocatorPreferences` | `src/lib/preferences.ts:17-39` | Plan 03-01 Task 2 |
| 5 | Extend `SELF_EDITABLE_PREFERENCE_FIELDS` — NO (admin-only write per D-07/D-08: Phase 4 writes via feedback engine, not via mandate form) | N/A | |
| 6 | Extend schema-sync test: `expect(EXPECTED_COLUMNS_SET.has("scoring_weight_overrides")).toBe(true);` | `src/__tests__/mandate-columns-schema-sync.test.ts:42-47` | Plan 03-01 Task 2 |

**No generator exists.** Per CONCERNS.md §Supabase types stale: the codebase does NOT run `supabase gen types`. `ALLOCATOR_PREFERENCES_COLUMNS` is hand-maintained. The MANDATE-07 schema-sync test is the contract-drift backstop.

**Test coverage surfaces:**

- Static layer: `describe("MANDATE-07: allocator_preferences schema sync")` → asserts `scoring_weight_overrides` in the string. Runs always.
- Live-DB layer (`HAS_LIVE_DB`): `.select(ALLOCATOR_PREFERENCES_COLUMNS).limit(0)` against the real `allocator_preferences` table → PostgREST returns 400 if any column is unknown. Runs when `HAS_LIVE_DB=1`.

Both layers auto-cover `scoring_weight_overrides` after Step 6. Zero additional test scaffolding needed.

## Validation Architecture

Eight dimensions of validation for Phase 3 (per Nyquist convention):

### Dimension 1 — Functional correctness

**What we're validating:** Every per-dimension scoring function produces correct scalar ∈ [0, 1] for a given (candidate, mandate) pair.

**How:** D-15 unit tests #1 (empty → 1.0), #2 (partial mandate averaging), #3 (full mandate), #4-5 (max_weight boundary), #6 (style_excluded reason), #8 (correlation penalty), #10-11 (liquidity gap direction).

**Pass criterion:** All 10 tests green. Each exercises one formula branch.

### Dimension 2 — Determinism

**What we're validating:** Same inputs → byte-identical `to_canonical_json` output across reruns.

**How:** D-15 #16 (existing `test_determinism` extended with mandate inputs) + D-15 #20 (golden snapshot against frozen JSON fixture).

**Pass criterion:** Two consecutive `score_candidates(**args)` calls produce equal JSON; pinned fixture matches current run (regenerable via env var).

### Dimension 3 — Backward compatibility

**What we're validating:** An allocator whose prefs dict has NO mandate keys (pre-Phase-3 shape) gets v1-equivalent ranking (modulo the 0.6/0.4 composition, which per SCORING-03 specifically DOES change the numerical score even for empty-mandate case since `effective = 0.6 × 0.8 + 0.4 × 1.0 = 0.88` > `0.8` pre-Phase-3).

**Constraint:** SCORING-04 says "empty mandates get `mandate_fit_score = 1.0` and match ranking unchanged vs v1". Ranking is preserved because ALL candidates get the same `+0.4 × 1.0 = +0.4` uplift. The absolute final scores change (all lift by the same fraction) but the *ordering* is preserved.

**How:** D-15 #19 (v1 prefs dict, no mandate keys, assert engine behaves exactly as v1 on top-level weights + mandate_fit_score = 1.0). AND an ordering-invariance test: run v1-vs-v2 for a 5-candidate set with empty mandates, assert same rank order.

**Pass criterion:** Both tests green. Absolute scores differ (expected), rank order identical.

### Dimension 4 — Integration correctness

**What we're validating:** `_should_skip_allocator` returns the right boolean given the three invalidation sources (force, engine_version mismatch, mandate_edited_at > computed_at).

**How:** D-16 integration tests against mocked Supabase. 3-4 test cases covering: (a) force=True bypasses; (b) engine_version "v1.0.0" on last batch + ENGINE_VERSION="v2.0.0" → False; (c) mandate_edited_at > computed_at → False; (d) all three safe, age < 12h → True (skip).

**Pass criterion:** All 4 green.

### Dimension 5 — Persistence / schema correctness

**What we're validating:** Migration 062 applies cleanly; self-verify DO block emits NOTICE; schema-sync test green.

**How:** `npx supabase db push` exits 0 with NOTICE in stdout (Plan 02-01 precedent). `src/__tests__/mandate-columns-schema-sync.test.ts` runs green (static + live-DB layers).

**Pass criterion:** Migration apply succeeds; NOTICE in stdout; test green.

### Dimension 6 — Invariant preservation

**What we're validating:** Scoring-weight normalization invariant holds under adversarial `scoring_weight_overrides` inputs.

**How:** D-15 #12 (sum(effective_weights) == 1.0 ± 1e-9 under any input, including pathological ones like `{"W_PORTFOLIO_FIT": 10.0, "W_PREFERENCE_FIT": 0.01}`). Include property-ish checks (5-10 manually-constructed adversarial inputs).

**Pass criterion:** All inputs produce normalized weights summing to 1.0 within 1e-9.

### Dimension 7 — Graceful degradation

**What we're validating:** NULL mandate columns, missing `scoring_weight_overrides`, single-eligible-candidate edge cases don't crash or produce NaN.

**How:** D-15 #9 (sparse-overlap corr NULL → 1.0 not penalty), #15 (None overrides → v1 behavior), + existing `test_single_eligible_candidate_does_not_nan` (line 436) gets re-exercised with mandate fields.

**Pass criterion:** No exceptions, no NaN in final_score.

### Dimension 8 — Observability / debuggability

**What we're validating:** `mandate_fit_score` key reliably present in `score_breakdown` for admin debugging; optional `mandate_fit_raw` dict exposes per-dimension breakdown; `effective_preferences` snapshot faithfully mirrors the inputs.

**How:** D-15 #17 (key present check in both personalized and screening modes) + manual review of `mandate_fit_raw` breakdown shape in a targeted test. Verify `match_batches.effective_preferences` snapshot includes all 13 D-10 keys in at least one scoring run.

**Pass criterion:** All keys observable; admin UI can render `score_breakdown.mandate_fit_score` without a type error (TS side reads it as `Record<string, unknown>` anyway).

## Pitfalls & Landmines

### Pitfall 1 — `style_exclusions` vs `strategy_type` enum mismatch
**Description:** `style_exclusions` contains SUBTYPES (e.g. "Mean Reversion"); `candidate["strategy_type"]` contains STRATEGY_TYPES (e.g. "Long-Short"). These never overlap. A naïve `cand.get("strategy_type") in style_exclusions` silently returns zero hits, SCORING-07 quietly fails.
**Prevention:** Planner MUST populate `candidate["subtype"]` in `_load_candidate_universe` from `strategies.subtypes[0]` `[VERIFIED: supabase/migrations/001_initial_schema.sql:55 — subtypes TEXT[] NOT NULL DEFAULT '{}']`. Extension needed at `routers/match.py:91-97` (add `subtypes` to the SELECT string) and line 143-154 (map `subtypes[0]` → `candidate["subtype"]`). D-06 CONTEXT.md flagged "subtype (or strategy_type fallback — planner to confirm field)" — confirmed: use subtypes. See §Open Questions Q2 for the (now resolved) trace.
**Test:** D-15 #6 must USE a SUBTYPES value in `style_exclusions` AND must populate `subtype` on the test candidate.

### Pitfall 2 — D-12 proactive-enqueue architectural mismatch
**Description:** `compute_jobs` has no `allocator_id` column and the `compute_jobs_target_xor` + `kind_target_coherence` CHECK constraints block any allocator-scoped kind. Naïve implementation fails at migration apply.
**Prevention:** §Domain Research #3 Option A (defer proactive enqueue, rely on D-11 skip-logic triple-check). Planner updates CONTEXT.md D-12 status to "DEFERRED" and drops the RPC-body amendment from migration 062 scope.
**Alternative:** Options B (schema expansion) or C (rescore_hints table) — both require significantly more scope than D-12 implied.

### Pitfall 3 — Renormalization with all-zero scaled weights
**Description:** If a pathological `scoring_weight_overrides` input scales every weight below 0.5 AND the clamp is [0.5, 1.5], clamp floors them all back to 0.5 × default → renormalize fine. But if the clamp were [0.0, X] or default rounded very small, `sum(scaled) = 0` → division by zero.
**Prevention:** D-08 explicitly clamps to `[0.5, 1.5]` which guarantees `scaled[W] > 0` for every W. No division-by-zero possible. Unit test D-15 #14 (clamp test) + add a defensive assert `assert sum(scaled.values()) > 0` before renormalize.

### Pitfall 4 — Screening mode incorrectly applies D-04 correlation penalty
**Description:** Screening mode has no portfolio; `corr_with_portfolio = None` should return `1.0` per D-04. Naïve implementation might check `if ceiling is not None and corr > ceiling` forgetting the `corr is None → 1.0` branch, penalizing cold-start allocators.
**Prevention:** `_compute_mandate_fit_score` takes `corr_with_portfolio` as an explicit param; the function body must short-circuit to `1.0` when the param is `None` OR when `mode == 'screening'`. Explicit test D-15 #9 (NULL corr → neutral) guards this.

### Pitfall 5 — Liquidity gap direction semantics
**Description:** D-05 says ONLY penalize when candidate tier is LOWER than allocator's preference. Symmetric penalty (penalize both directions) would wrongly score an allocator who wants "low liquidity" but gets "high liquidity" candidate, when more-liquid is strictly better.
**Prevention:** D-05 test #11 asserts allocator=low + candidate=high → 1.0. Pure boolean logic in the mapping function. Easy to get wrong on first write — pair-review the function body specifically.

### Pitfall 6 — `WEIGHTS_VERSION` not bumped in lockstep
**Description:** Module docstring at match_engine.py:43 says "Bump on any change to the scoring math." Both `ENGINE_VERSION` and `WEIGHTS_VERSION` should bump to v2.0.0 together. Forgetting one leaves a debugging trail inconsistency.
**Prevention:** D-15 #18 asserts both == v2.0.0.

### Pitfall 7 — Banned packages (CLAUDE.md)
**Description:** CLAUDE.md bans `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Phase 3 is pure Python/SQL, zero new npm dependencies planned. One TS const edit in `src/lib/admin/match.ts` and one interface edit in `src/lib/preferences.ts` — no new imports.
**Prevention:** CI `check-banned-packages.test.ts` gates merges. Zero deviation risk for Phase 3.

### Pitfall 8 — Forgetting to persist `effective_preferences` after DEFAULT_PREFERENCES extension
**Description:** `routers/match.py:286` writes `effective_preferences: result["effective_preferences"]`. `result["effective_preferences"] = prefs` is the `merge_with_defaults(...)` output at match_engine.py:685. If DEFAULT_PREFERENCES doesn't add the 5 new keys, the snapshot omits them → SCORING-06 silently fails.
**Prevention:** Always extend `DEFAULT_PREFERENCES` BEFORE any code depending on the full merged dict. Test D-15 #17 (every key present) catches it.

### Pitfall 9 — Mocked-Supabase drift from real API shape
**Description:** Python integration tests in 03-02 mock Supabase chains. The chain `.select(...).eq(...).order(...).limit(1).execute()` returns `MagicMock(data=[{...}])`. If supabase-py 2.x changes the return shape, tests pass but prod breaks.
**Prevention:** D-16's ~3-4 integration tests should assert on the FINAL behavior (`_should_skip_allocator` returns bool) rather than chain internals. One lightweight smoke test of the real Supabase query via `analytics-service/services/db.py` `get_supabase()` in a separate HAS_LIVE_DB-gated file (optional, since D-17 says no — but the option exists).

### Pitfall 10 — Stale match_batches ordering
**Description:** `idx_match_batches_allocator_recent(allocator_id, computed_at DESC)` supports the sort. D-11 new query adds `engine_version` to the SELECT list — index covers. But if a concurrent batch insert arrives between the skip-check query and the next query in `_score_one_allocator`, the skip-check is based on stale info. Currently non-critical (recompute cadence is 12h+), but worth noting.
**Prevention:** No action needed for Phase 3. Current 12h cadence makes the race practically unobservable.

### Pitfall 11 — `_compute_mandate_fit_score` signature creep
**Description:** Signature `(candidate, preferences, corr_with_portfolio, add_weight, mode) -> tuple[float, dict]` threads 5 args. Adding a 6th (e.g. `screening_flag` separately from `mode`) invites creep. Keep the signature stable; `mode == 'screening'` short-circuits D-04 internally.
**Prevention:** Include the signature in the plan's Wave 0 scaffold so every test imports it identically.

### Pitfall 12 — Version-bump without invalidation test
**Description:** Bumping `ENGINE_VERSION = "v2.0.0"` is a one-line edit. Without a test that v1 batches are skipped on next recompute (D-16 integration test), the invalidation path is not proven.
**Prevention:** D-16 explicitly covers `engine_version = 'v1.0.0'` on last_batch → `_should_skip_allocator` returns False.

### Pitfall 13 — Golden snapshot flakiness from unordered dicts / floats
**Description:** `to_canonical_json` uses `sort_keys=True` (line 742), but Python's `float` representation is deterministic only within a single NumPy/pandas version. A `0.1 + 0.2` result can differ subtly between Python 3.13 and 3.14. Golden snapshot locked today may drift on Python upgrade.
**Prevention:** Pin fixture + document the regeneration trigger (`REGENERATE_GOLDEN=1`) so future Python bumps can be accommodated explicitly. Existing `test_determinism` (line 355) already proves intra-run stability — golden snapshot adds inter-run stability pinning.

## Open Questions

### Q1 — How should Plan 03-02 handle the D-12 proactive-enqueue architectural blocker?
**What we know:** `compute_jobs` XOR + kind_target_coherence CHECK constraints block an allocator-scoped kind without substantial schema expansion. D-12 is locked as a user decision but its implementation is underspecified.
**What's unclear:** Does the planner (a) defer D-12 entirely — rely on D-11 skip-logic (recommended per §Domain Research #3); (b) expand `compute_jobs` with allocator_id column + new RPC + worker handler; or (c) ship a lightweight `rescore_hints` table?
**Recommendation:** (a) Defer D-12. Update CONTEXT.md D-12 status to "DEFERRED to Phase 4 or later." The existing D-11 triple-check handles SCORING-05 on the very next recompute attempt without any new enqueue machinery. Proactive-sync only matters for synchronous rescoring, which Phase 3 doesn't need (founder-only admin surface, daily cron).

### Q2 — Which candidate field supplies the style-exclusion comparison: `strategies.subtypes[0]`? [CLOSED]
**Status:** CLOSED — `strategies.subtypes TEXT[] NOT NULL DEFAULT '{}'` confirmed from `supabase/migrations/001_initial_schema.sql:55` `[VERIFIED]`. Wizard RPC `finalize_wizard_strategy(p_subtypes TEXT[], …)` at migration 031 writes to it; strategies list endpoint `routers/match.py:91-97` does not currently SELECT it.
**Required change:** Extend the SELECT in `_load_candidate_universe` at `routers/match.py:91-97` to include `subtypes`; map `subtypes[0]` → `candidate["subtype"]` at line 143-154; `_eligibility_check` compares `candidate.get("subtype")` (NOT `strategy_type`) against `style_exclusions`.
**Note for 03-01 planner:** This is a one-line select-list extension + a two-line dict-construction change. No migration needed (column exists). Not a blocker.

### Q3 — Should scoring_weight_overrides CHECK constraint ship in migration 062 (DB-layer) or only app-layer validation?
**What we know:** D-14 says "optional CHECK constraint on shape (e.g., 'only known weight keys') — planner's call; lean toward app-layer validation for easier iteration (Phase 2 pattern)."
**What's unclear:** Trade-off between strictness (DB-layer catches all writes) vs velocity (app-layer easier to iterate on Phase 4 rules).
**Recommendation:** App-layer validation (match engine reads and defensively clamps per D-08 step 3). DB-layer adds burden without clear win — Phase 4 is the only writer, rules may evolve. Migration 062 stays lean: just ADD COLUMN.

### Q4 — Should `mandate_fit_raw` breakdown ship in score_breakdown for debuggability?
**What we know:** CONTEXT.md Claude's Discretion says "recommended but not required by any SC."
**What's unclear:** Cost vs benefit for admin debugging UX.
**Recommendation:** Ship it. Storage cost is negligible (4 small floats per candidate); debugging value is real when a mandate breach is non-obvious. Place inside `score_breakdown.raw.mandate_fit_raw` to keep the top-level breakdown dict compact:

```python
score_breakdown["raw"]["mandate_fit_raw"] = {
    "max_weight": mw_score,
    "correlation_ceiling": cc_score,
    "liquidity_preference": lp_score,
    "style_exclusions_honored": True,  # always True for scored rows; excluded rows skip
}
```

### Q5 — Ordering invariance test for empty-mandate allocators (SCORING-04 fidelity)
**What we know:** SCORING-04 says "match ranking unchanged vs v1" for empty mandates. Absolute scores differ (all lift by same 0.4 × 1.0 × W_PREFERENCE_FIT = 0.12 factor).
**What's unclear:** Does "ranking unchanged" mean (a) absolute scores equal (strict — fails); (b) ranking order equal (loose — passes); (c) both?
**Recommendation:** Interpret as (b). Add a test pairing v1 and v2 engine outputs for the same 5-candidate empty-mandate universe and assert identical `[strategy_id for c in candidates]` order. Document the interpretation in the test docstring.

## Sources

### Primary (HIGH confidence)

- `analytics-service/services/match_engine.py` — entire 742-line module, read end-to-end. Line refs in §Codebase Research are verbatim from this file.
- `analytics-service/routers/match.py` — entire 522-line module. Line refs verified.
- `analytics-service/services/match_defaults.py` — 34 lines, full read.
- `analytics-service/services/scheduled_tasks.py` — lines 39-58 verified (`_enqueue_each` + RPC call shape).
- `supabase/migrations/032_compute_jobs_queue.sql` — full 1084 lines, specifically RPC signatures + CHECK constraints.
- `supabase/migrations/061_mandate_columns.sql` — full 282 lines; migration + RPC pattern.
- `supabase/migrations/011_perfect_match.sql` — full 292 lines (match_batches shape, RLS baseline).
- `supabase/migrations/036_poll_positions_kind.sql` — full 105 lines; precedent for adding a new compute_job kind.
- `supabase/migrations/048_contact_request_metadata.sql` — precedent for multi-operation single migration + kind_target_coherence relaxation.
- `analytics-service/tests/test_match_engine.py` — 535 lines, full read; fixture shapes verified.
- `analytics-service/tests/test_match_defaults.py` — full read; merge_with_defaults semantics verified.
- `analytics-service/services/job_worker.py` — lines 1-220 + 1100-1189 (dispatch pattern + TIMEOUT_PER_KIND).
- `src/lib/admin/match.ts` — full read (ALLOCATOR_PREFERENCES_COLUMNS shape + query pattern).
- `src/lib/preferences.ts` — full read (AllocatorPreferences interface + validators).
- `src/lib/constants.ts` — SUBTYPES + STRATEGY_TYPES enum values confirmed.
- `src/__tests__/mandate-columns-schema-sync.test.ts` — full read (MANDATE-07 test structure).
- `.planning/codebase/ARCHITECTURE.md` — analytics service layering.
- `.planning/codebase/TESTING.md` — pytest + Vitest + Playwright conventions.
- `.planning/codebase/CONVENTIONS.md` — coding style.
- `.planning/codebase/CONCERNS.md` — compute_jobs RLS concern noted (Phase 3 does not widen).
- `.planning/phases/02-mandate-profile-builder/02-01-SUMMARY.md` — migration 061 actual output + 02-01 decisions.
- `.planning/phases/02-mandate-profile-builder/02-02-SUMMARY.md` — mandate_edited_at column usage.
- `.planning/ROADMAP.md` — Phase 3 goal + SC1-SC5 + plan list.
- `.planning/STATE.md` — Phase 03 status.
- `.planning/PROJECT.md` — Sprint 8 vision.
- `.planning/REQUIREMENTS.md` — SCORING-01..07 locked.

### Secondary (MEDIUM confidence)

- `docs/architecture/adr-0001-rls-primary-authorization.md` — referenced via CONTEXT.md + ARCHITECTURE.md (not directly read; content implied via RLS policies in migrations 011, 032, 061).
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — referenced via CONTEXT.md + 02-01-SUMMARY.md (extension pattern applied for `mandate_preference.update` action).

### Tertiary (LOW confidence)

- No WebSearch findings in Phase 3 research — all knowledge is from primary source code / docs. Context7 not invoked (no library-API questions; pandas/numpy API is known-stable for the operations used; `.corr()`, `.dropna()`, `pd.concat`).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Python 3.14 + pandas + FastAPI + Supabase is the established stack; no new tools.
- Architecture: HIGH — direct file reads, line numbers verified. Blocker on D-12 is VERIFIED against migration 032/036/048 CHECK constraints.
- Test strategy: HIGH — pytest + mocked Supabase is the existing pattern; no invention needed.
- Pitfalls: HIGH — every pitfall listed is either verified against code (Pitfall 1, 2, 6, 8, 10) or is a well-understood math concern (Pitfall 3, 4, 5, 11, 12, 13).
- Proactive enqueue path (D-12): MEDIUM — three architectural options surfaced, recommendation (Option A: defer) is strong but ultimately planner's call against user's locked D-12.

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days — stable backend, no fast-moving deps in scope).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pd.Series.corr` is bit-stable across Python 3.14 minor versions | Pitfall 13 | LOW — existing `test_determinism` guards intra-run; golden snapshot needs regeneration on Python bump (documented path). |
| A2 | `compute_jobs_one_inflight_per_kind_strategy` partial unique index does NOT need to include a hypothetical rescore_allocator kind | Domain Research §3 | LOW — only matters if planner picks Option B. |
| A3 | `DEFAULT_PREFERENCES` extension with `None`/`[]` defaults preserves `merge_with_defaults` existing semantic (None-skip) | Codebase Research #3 | LOW — verified against `test_merge_keeps_default_when_value_is_none` (test_match_defaults.py:23). |
| A4 | Phase 4 will be the sole writer to `scoring_weight_overrides` (Phase 3 reads only) | Schema-sync #3 | LOW — explicit in D-07 + FEEDBACK-04 in REQUIREMENTS.md. |

All four remaining assumptions are LOW risk. Previously-listed A1 (`strategies.subtypes` column exists) has been upgraded to VERIFIED via `supabase/migrations/001_initial_schema.sql:55` and closed.

## RESEARCH COMPLETE
