# Phase 4: Feedback Loop - Research

**Researched:** 2026-04-18
**Domain:** Rule-based scoring feedback engine (Python, Supabase, match_engine v2.0.0 consumer)
**Confidence:** HIGH (codebase verified line-by-line; D-12 transport layer has an open question)

## Summary

Phase 4 builds `analytics-service/services/feedback_engine.py` with a single public entry point `compute_adjusted_weights(allocator_id) -> dict[str, float]` that reads `bridge_outcomes` + `match_candidates.score_breakdown`, attributes each outcome to one of four top-level scoring dimensions (`W_PORTFOLIO_FIT`, `W_PREFERENCE_FIT`, `W_TRACK_RECORD`, `W_CAPACITY_FIT`), computes `success_rate` per-dimension, and emits a multiplicative scale factor (`0.5×` / `1.0×` / `1.5×`) when the per-dimension outcome count reaches 5. Result is **both persisted** to `allocator_preferences.scoring_weight_overrides` AND returned in-memory for immediate use inside `_score_one_allocator`.

Phase 3's migration 062 already added the `scoring_weight_overrides JSONB` column and `match_engine.py` at lines 762–792 already consumes it with defensive clamp + renormalize. Phase 4 is the **first writer** — zero engine changes required.

The single material risk is the D-12 delta-hook mechanism: CONTEXT.md assumes a Python delta-cron caller exists, but **migration 060 registers the delta cron directly in pg_cron as SQL** (`cron.schedule('compute_bridge_outcome_deltas', '0 3 * * *', $$SELECT public.compute_bridge_outcome_deltas()$$)`) — there is no Python layer between pg_cron and the SQL function. The Vercel Hobby plan is **also** at 2/2 cap (`warm-analytics` + `alert-digest`), so we cannot add a Python cron that wraps the SQL call. D-12 must become either (a) SQL-side `PERFORM enqueue_compute_job(...)` inside the SQL function body, or (b) relaxed to "post-insert trigger on delta_Xd columns" — open question below.

**Primary recommendation:** Build `feedback_engine.py` with `compute_adjusted_weights` + 3 private helpers (`_fetch_outcomes`, `_attribute_dimension`, `_apply_shape`), wire into `_score_one_allocator` at line 259 (after `_load_allocator_context`, before `score_candidates`), and implement the delta-cron follow-up as a **SQL-side `PERFORM enqueue_compute_job` inside `compute_bridge_outcome_deltas()`** (recommended option — see Pitfall 2). Persist both code and column in the same transactional flow; emit an audit event on every write (lean YES — matches Phase 2 mandate parity). Use a new `test_feedback_engine.py` file with a golden snapshot fixture.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Outcome→dimension attribution | API / Backend (Python, analytics-service) | — | Scoring math lives beside match_engine.py; Supabase supplies raw data only |
| Success-rate computation | API / Backend (Python) | — | Pure function over `bridge_outcomes` + `match_candidates` joins |
| Overrides persistence | Database / Storage (Supabase PG) | API / Backend (Python writes via service_role) | JSONB column on `allocator_preferences`; RLS bypassed via service_role per ADR-0003 |
| Scoring run integration | API / Backend (Python, routers/match.py) | — | Inline call inside `_score_one_allocator`; engine already consumes from `prefs["scoring_weight_overrides"]` |
| Delta-triggered rescore enqueue | Database / Storage (pg_cron → SQL function body) | API / Backend (worker dispatches) | pg_cron owns the cadence; worker owns execution — see D-12 open question |
| Audit trail | Database / Storage (audit_log) | API / Backend (analytics-service → `log_audit_event_service` RPC) | Follow Phase 2 mandate precedent via migration 058's service-role RPC |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Positive-outcome signal = realized delta sign. For each eligible `bridge_outcomes` row, success = `1` iff the most-mature non-NULL delta column is strictly `> 0`; `0` iff `≤ 0`.

**D-02:** Delta window = most-mature-available. Prefer `delta_180d`, fall back to `delta_90d`, fall back to `delta_30d` — take the first non-NULL. Outcomes re-classify automatically as windows mature.

**D-03:** Pending allocated outcomes (all `delta_Xd` columns NULL) are EXCLUDED from both the success-rate numerator/denominator AND the per-dimension min-5 threshold. Re-enter once the delta cron populates the first column.

**D-04:** Rejected outcomes count as FAILURE (0) in success_rate AND drive dimension attribution via `rejection_reason`. Uses the Phase 1 enum.

**D-05:** Attribution rule = HYBRID. Rejected rows use `rejection_reason` enum mapping (D-06). Allocated rows attribute to the dimension with the highest contribution in the historical `match_candidates.score_breakdown` — `max(portfolio_fit, preference_fit, track_record, capacity_fit)` on the persisted row.

**D-06:** Rejection-reason → dimension table (locked):
| rejection_reason | attributed dimension |
| --- | --- |
| `mandate_conflict` | `W_PREFERENCE_FIT` |
| `underperforming_peers` | `W_TRACK_RECORD` |
| `timing_wrong` | `W_PORTFOLIO_FIT` |
| `already_owned` | **excluded** (data hygiene, not scoring error) |
| `other` | falls back to score-dominant rule |

**D-07:** Missing-history fallback = UNIFORM attribution. If the `match_candidates` row is gone (retention_sweep keeps last 7), that outcome's success/failure increments each dimension's `(num_successes, num_total)` pair by the same amount. Does NOT drop the row; does NOT try to re-score.

**D-08:** Noise filtering BEFORE success_rate computation:
1. Drop every `kind='rejected' AND rejection_reason='already_owned'` row.
2. Drop every `kind='allocated' AND percent_allocated < 1.0` row.
3. Drop every pending allocated row per D-03.

**D-09:** Invocation point = INLINE inside `_score_one_allocator`, pre-scoring. Call `feedback_engine.compute_adjusted_weights(allocator_id)` after `_load_allocator_context` returns (line 259), merge into `ctx["preferences"]["scoring_weight_overrides"]`, then call `score_candidates` as today.

**D-10:** Persist AND return. Also writes to `allocator_preferences.scoring_weight_overrides` via Supabase UPDATE before returning. Write is idempotent.

**D-11:** TWO layered triggers (no new mechanism):
1. **Every scoring run** — inline call picks up freshest feedback for free.
2. **Delta cron follow-up** — when the Phase 1 `compute_bridge_outcome_deltas` cron populates delta columns AND an allocator has ≥5 attributed outcomes in ≥1 dimension, enqueue `rescore_allocator`.

**D-12:** Delta-hook mechanism = explicit `enqueue_compute_job` call in the delta cron, NOT a Postgres trigger. The delta cron iterates outcomes; the extension is "strictly additive". CONTEXT.md text leans Python; canonical refs lean SQL-side. **See Open Questions — this is the single critical open gap.**

**D-13:** Scale function = LITERAL step per FEEDBACK-02:
```
success_rate < 0.4                 → scale = 0.5
0.4 ≤ success_rate ≤ 0.7           → scale = 1.0
success_rate > 0.7                 → scale = 1.5
```

**D-14:** NO hysteresis — stateless snap-back. Pure function of `(bridge_outcomes, match_history)` at call time.

**D-15:** Min-5 gating is PER-DIMENSION. A dimension `W_i` is eligible for adjustment only when `count(attributed outcomes to W_i after D-08 filtering) ≥ 5`.

**D-16:** Cold-start / under-threshold write shape = OMIT the key. Missing keys map to `1.0×` via `overrides.get(W_i, 1.0)` in match_engine.py. An allocator with zero eligible outcomes gets `scoring_weight_overrides = NULL` (column never written).

### Claude's Discretion

- Internal helper decomposition (follow `match_engine.py` mid-sized private helpers precedent).
- Exact Supabase query shape for the join (single embedded-expansion `select` vs two sequential queries).
- Whether to emit an `audit` event on every override write (lean YES — ADR-0023 + Phase 2 mandate parity).
- Delta-cron enqueue granularity (every transition vs only-threshold-crossing transitions).
- Integration test shape (in-memory Supabase mock vs HAS_LIVE_DB-gated — Phase 3 D-17 precedent = mocked).
- Read-only debug endpoint (`GET /feedback/{allocator_id}/state`) — admin-useful, not required.
- Naming of `REJECTION_REASON_TO_DIMENSION` lookup (lean co-located in `feedback_engine.py`).
- Test-file placement (lean NEW `test_feedback_engine.py`).

### Deferred Ideas (OUT OF SCOPE)

- `FEEDBACK_VERSION` constant (add when rule format changes).
- Sub-weight overrides (`W_SHARPE_LIFT`, etc.) — locked to top-level only in Phase 3 D-09.
- Linear / stepped / continuous shapes (locked to literal step per spec in D-13).
- Hysteresis / decay / sticky (locked to stateless snap-back in D-14).
- Postgres trigger on `bridge_outcomes` UPDATE.
- Admin dashboard / feedback-observability UI (Phase 5 scope).
- Property-based tests, mutation testing (Phase 6 hardening).
- `percent_allocated` as continuous conviction weight (every qualifying row weighs the same).
- Score-proportional attribution (D-05 locked score-dominant).
- Re-scoring against fresh universe (D-07 locked uniform fallback).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FEEDBACK-01 | `feedback_engine.py` (new module) computes per-dimension scoring weight adjustments from `bridge_outcomes` history | **Codebase Finding §1** — `services/` namespace confirmed; `match_engine.py` precedent for pure-function scoring helpers at lines 549–904; `job_worker.py` lazy-import precedent for breaking `routers.match` → `services` cycle at line 1123 |
| FEEDBACK-02 | Adjustment rule: `success_rate < 0.4` → floor; `> 0.7` → ceiling; else no change | **D-13 locked** — literal step; `_clamp(v, 0.5, 1.5)` helper already exists in `match_engine.py` line 87; engine also clamps defensively at line 770 so Phase 4's honest-clamp write is safe |
| FEEDBACK-03 | Minimum 5 outcomes required before any adjustment; cold start falls back to defaults | **D-15 locked** per-dimension; **D-16 locked** omit-the-key; engine's `overrides.get(W_i, 1.0)` at line 770 naturally yields `1.0×` for missing keys |
| FEEDBACK-04 | Adjusted weights persisted to `allocator_preferences.scoring_weight_overrides` JSONB column | **Migration 062 live** (verified line 74–78) — column is JSONB NULL, no default, no DB CHECK (app-layer validation per migration 062 comment line 59-62); Phase 3 golden fixture shows shape `{"W_PORTFOLIO_FIT": 1.3, ...}` |
| FEEDBACK-05 | Every scoring weight dimension adjusts independently per allocator | **D-15 + engine structure** — lines 767–776 read each of four keys independently; missing keys default to `1.0×`; renormalization at line 785 preserves sum=1.0 invariant |
| FEEDBACK-06 | Each scoring run reads overrides from `allocator_preferences` and snapshots them into `match_batches.effective_preferences` | **Already works for free** — `merge_with_defaults` in `match_defaults.py` line 29–41 flat-merges prefs; `score_candidates` line 575 calls it; `effective_preferences` returned in result at line 569 of match_engine.py; router persists at line 292. D-10 persist-and-return is the seam |

## Codebase Research (Verified Signatures + Line Numbers)

### Verification 1: `compute_bridge_outcome_deltas` shape — the D-12 enqueue target

**Expected (CONTEXT.md assumption):** Python delta-cron caller that iterates outcomes.

**Actual (verified via `supabase/migrations/060_bridge_outcome_cron.sql`):**

- Migration file is named **`060_bridge_outcome_cron.sql`** (NOT `060_bridge_outcome_deltas.sql` as CONTEXT.md references).
- The cron is a **pure SQL function** registered directly in pg_cron:
  ```sql
  -- Line 240-244
  PERFORM cron.schedule(
    'compute_bridge_outcome_deltas',
    '0 3 * * *',
    $cron$ SELECT public.compute_bridge_outcome_deltas(); $cron$
  );
  ```
- There is **no Python caller.** `analytics-service/routers/cron.py` contains ONLY the trade-sync cron (`cron_sync`, line 148–281); it does NOT touch `bridge_outcomes` or the delta cron.
- `vercel.json` confirms the Hobby plan 2/2 cron cap is full (`warm-analytics` + `alert-digest`). Adding a new Vercel cron would exceed the cap and is blocked by `src/__tests__/vercel-cron-limits.test.ts`.
- The SQL function body at lines 164–217:
  ```sql
  CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
  RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  -- ... CTE updates delta_30d/90d/180d, returns row count
  ```
  ends with a WITH clause that returns a table of (updated_count, failed_count, batch_started_at).

**Impact on D-12:** The extension MUST be SQL-side `PERFORM enqueue_compute_job(...)` inside the SQL function body, looping over distinct allocator_ids whose outcomes were updated. See Open Question 1 for the recommendation.

### Verification 2: `enqueue_compute_job` RPC signature

**Actual (verified via `supabase/migrations/062_scoring_weight_overrides.sql` lines 291–330):**

```sql
CREATE OR REPLACE FUNCTION enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_allocator_id    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
```

- `p_allocator_id` is the **trailing 7th parameter**, added in Phase 3 migration 062 (line 298).
- Allocator-scoped call shape (line 319–324): when `p_allocator_id IS NOT NULL AND p_strategy_id IS NULL`, calls `_enqueue_compute_job_internal(NULL, NULL, p_kind, ..., p_allocator_id)`.
- **Service-role (analytics-service) can call it directly.** REVOKE from anon/authenticated (line 335). Service_role bypasses REVOKE per ADR-0003.
- The partial unique index `compute_jobs_one_inflight_per_kind_allocator` (migration 062 line 151–154) dedupes concurrent enqueues — multiple calls for the same allocator while one is still `pending|running|done_pending_children` return the same existing job id.

**SQL-side call shape (recommended for D-12):**
```sql
PERFORM enqueue_compute_job(
  p_strategy_id     := NULL,
  p_kind            := 'rescore_allocator',
  p_idempotency_key := NULL,
  p_parent_job_ids  := '{}',
  p_exchange        := NULL,
  p_metadata        := NULL,
  p_allocator_id    := v_allocator_id
);
```

Precedent: `update_allocator_mandates` at migration 062 line 458–466 uses exactly this call shape.

### Verification 3: `match_candidates.score_breakdown` actually contains per-dimension scalars

**Actual (verified via Phase 3 golden fixture `match_engine_v2_golden.json` + `match_engine.py` line 803–824):**

```json
{
  "preference_fit": 0.7333333333333334,
  "mandate_fit_score": 0.875,
  "track_record": 0.5,
  "capacity_fit": 0.95,
  "portfolio_fit": 0.42,   // ONLY in personalized mode (line 821–823)
  "raw": {
    "corr_with_portfolio": null,
    "sharpe_lift": null,
    "dd_improvement": null,
    "manager_aum": 5000000,
    "ticket_concentration": 0.01,
    "sharpe": 1.2,
    "track_record_days": 365,
    "max_drawdown_pct": -0.15,
    "mandate_fit_raw": { /* per-dimension mandate breakdown */ }
  }
}
```

**Key finding for D-05 score-dominant attribution:** The four top-level keys are `portfolio_fit`, `preference_fit` (note: NOT `effective_preference_fit`), `track_record`, `capacity_fit`. These map 1:1 to the four top-level weights. `mandate_fit_score` is a scalar inside `W_PREFERENCE_FIT` (Phase 3 D-02 composition) — it is NOT a top-level dimension, so Phase 4 attribution should NOT use it directly; use `preference_fit` instead.

**CRITICAL NUANCE:** In screening mode, `portfolio_fit` is NOT present in `score_breakdown` (line 821–823 gates insertion on `mode == "personalized"`). This means for screening-mode outcomes:
- Allocated + score-dominant attribution cannot consider `portfolio_fit`.
- Recommended: `max(preference_fit, track_record, capacity_fit)` for screening-mode history.
- Fallback order when ties occur: deterministic alphabetical (`capacity_fit`, `preference_fit`, `track_record`) — planner to confirm.

### Verification 4: `bridge_outcomes` column set (relevant to feedback)

**Actual (verified via `supabase/migrations/059_bridge_outcomes.sql` lines 45–95 + Plan 01-01 summary):**

| Column | Type | Null | Phase 4 use |
|--------|------|------|-------------|
| `id` | UUID | NO | PK |
| `allocator_id` | UUID | NO | WHERE predicate for query scoping |
| `strategy_id` | UUID | NO | Join to match_candidates for D-05 score-dominant attribution |
| `match_decision_id` | UUID | YES | Unused in Phase 4 |
| `kind` | TEXT ('allocated'\|'rejected') | NO | D-04 branch: rejected = failure |
| `percent_allocated` | NUMERIC(5,2) | YES | D-08 filter (<1.0 dropped) |
| `allocated_at` | DATE | YES | Unused in Phase 4 (delta cron uses it) |
| `rejection_reason` | TEXT (enum) | YES | D-06 dimension attribution |
| `note` | TEXT | YES | Unused |
| `delta_30d` | NUMERIC | YES | D-02 most-mature window (fallback 3) |
| `delta_90d` | NUMERIC | YES | D-02 (fallback 2) |
| `delta_180d` | NUMERIC | YES | D-02 (primary, most mature) |
| `estimated_delta_bps` | NUMERIC | YES | Unused (estimate, not realized) |
| `estimated_days` | INT | YES | Unused |
| `deltas_computed_at` | TIMESTAMPTZ | YES | **USE for D-11/D-12 delta-cron transition detection** |
| `needs_recompute` | BOOLEAN | NO | Unused (cron internal) |
| `created_at` | TIMESTAMPTZ | NO | Query ordering for debug |
| `updated_at` | TIMESTAMPTZ | NO | Unused |

Unique index: `bridge_outcomes_unique_per_strategy` on `(allocator_id, strategy_id)`. Row is editable per D-17; `updated_at` auto-refreshes via trigger.

No RLS constraints relevant to Phase 4 — analytics-service runs under `service_role` which bypasses RLS per ADR-0003.

### Verification 5: `allocator_preferences.scoring_weight_overrides` safety for first UPDATE

**Actual (verified via `supabase/migrations/062_scoring_weight_overrides.sql` lines 74–78):**

```sql
ALTER TABLE allocator_preferences
  ADD COLUMN IF NOT EXISTS scoring_weight_overrides JSONB;
```

- JSONB, nullable, **no default**, **no DB CHECK constraint** (migration 062 line 59–62 confirms app-layer validation only).
- Phase 3 status: column added but **Phase 4 is the first writer**.
- Reading pattern (verified at `match_engine.py` line 767): `overrides = prefs.get("scoring_weight_overrides") or {}` — treats NULL and missing and {} identically.

**Safe UPDATE shape for `compute_adjusted_weights`:**

```python
supabase.table("allocator_preferences").update({
    "scoring_weight_overrides": result_dict or None  # D-16: empty -> NULL
}).eq("user_id", allocator_id).execute()
```

Single WHERE eq on PK (user_id). If the allocator has no preferences row yet, the UPDATE is a silent no-op (UPDATE ... WHERE row-not-found returns empty data but does not raise). For cold-start allocators with no preferences row at all, the engine's merge_with_defaults handles the absence fine — no upsert needed for Phase 4.

**Schema-sync contract (already maintained by Phase 3):** `src/lib/admin/match.ts` ALLOCATOR_PREFERENCES_COLUMNS already includes `scoring_weight_overrides`; `src/lib/preferences.ts` AllocatorPreferences interface has `scoring_weight_overrides: Record<string, number> | null`. Phase 4 does NOT touch either — engine reads/writes, no new columns.

### Verification 6: `_score_one_allocator` integration seam (line-exact)

**Actual (verified via `analytics-service/routers/match.py` lines 251–275):**

```python
async def _score_one_allocator(
    allocator_id: str,
    universe: dict[str, Any],
) -> dict[str, Any]:
    """Score a single allocator and persist the batch + candidates."""
    async with _scoring_semaphore:
        start = time.monotonic()

        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)
        # <-- Phase 4 inline call goes HERE (after line 259, before line 265)

        # Build the candidate list from the cached universe
        candidate_strategies = list(universe["strategies_by_id"].values())
        candidate_returns = universe["returns_by_id"]

        result = score_candidates(
            allocator_id=allocator_id,
            preferences=ctx["preferences"],
            # ...
        )
```

**Exact insertion pattern (recommended):**

```python
# After line 259
ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

# Phase 4 / D-09 — compute feedback overrides BEFORE scoring so the engine
# sees them. compute_adjusted_weights is a pure function + persistence side
# effect; safe to run inside the scoring semaphore.
from services.feedback_engine import compute_adjusted_weights  # lazy import per job_worker.py precedent
overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
if ctx["preferences"] is None:
    ctx["preferences"] = {}
# Merge in-memory so score_candidates sees the same value persisted to DB
ctx["preferences"]["scoring_weight_overrides"] = overrides or None
```

**Key observations:**

1. `_load_allocator_context` is synchronous; `_score_one_allocator` wraps it in `asyncio.to_thread` (line 259). Phase 4's `compute_adjusted_weights` should follow the same pattern (it performs Supabase I/O).
2. `ctx["preferences"]` CAN be `None` when the allocator has no `allocator_preferences` row (line 180: `preferences = prefs_result.data`, which is None for no-match). The merge must handle this case.
3. The semaphore at line 33 (`_scoring_semaphore = asyncio.Semaphore(3)`) caps concurrent scoring work at 3 across the process. Phase 4's inline call inherits this cap for free.
4. Pitfall: `prefs` flowing into `score_candidates` (line 265) is passed to `merge_with_defaults` at line 575 which NULL-skips. So even if `compute_adjusted_weights` returns `{}` (no overrides), `prefs["scoring_weight_overrides"] = None` will be preserved correctly by the merge.

### Verification 7: Worker dispatch for delta-cron-triggered rescore

**Actual (verified via `services/job_worker.py` lines 1106–1151 + `test_match_integration.py`):**

- `TIMEOUT_PER_KIND["rescore_allocator"] = 5 * 60` (line 131 in job_worker.py)
- Dispatch ladder includes `elif kind == "rescore_allocator": handler = run_rescore_allocator_job` (line 1188)
- Handler at line 1106–1151:
  - Validates `allocator_id` presence (line 1126)
  - Lazy-imports `_load_candidate_universe` + `_score_one_allocator` from `routers.match` (line 1123) — circular-import safe
  - Calls `_score_one_allocator(allocator_id, universe)` (line 1140) — **Phase 4's inline call inside `_score_one_allocator` runs for free on every dispatch**
  - DONE on empty universe (line 1137); FAILED/transient on scoring exception (line 1145–1149)
- `_should_skip_allocator` at routers/match.py lines 355–407 does NOT fire inside the worker handler — the enqueue itself signals intent (line 1112 comment). Phase 4's new trigger (delta transition) is the enqueue gate, not the skip gate.

**Impact on Phase 4:** If D-12 is implemented SQL-side, the delta cron calls `enqueue_compute_job('rescore_allocator', allocator_id)` → worker picks up job → dispatch routes → `run_rescore_allocator_job` calls `_score_one_allocator` → inline `compute_adjusted_weights` fires with fresh `delta_Xd` columns.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `allocator_preferences.scoring_weight_overrides` (JSONB, currently all NULL — Phase 4 is first writer) | App-layer UPDATE; no migration needed |
| Live service config | pg_cron job `compute_bridge_outcome_deltas` at `0 3 * * *` (live on production Supabase per Plan 01-04 summary); Vercel crons `warm-analytics` + `alert-digest` at 2/2 cap | Extend pg_cron SQL function body (migration) — NO Vercel cron change |
| OS-registered state | None | N/A |
| Secrets/env vars | `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` required by analytics-service (already present; used by `get_supabase()`) | None — already in place |
| Build artifacts | None — Python is not compiled; migration 063 would be the next number IF we need one | Confirm next migration number = 063 if D-12 ships as SQL |

**Nothing found in OS-registered state or secrets** — confirmed by reading `services/db.py` usage pattern across the analytics-service.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.14 runtime | `feedback_engine.py` | ✓ | 3.14 per STACK.md | — |
| supabase-py client | Query + UPDATE | ✓ | In analytics-service requirements | — |
| pytest | Unit tests | ✓ | Via `analytics-service/pytest.ini` | — |
| Live Supabase DB | End-to-end D-17 test (we're NOT doing one per CONTEXT.md) | N/A | — | — |
| pg_cron extension | D-12 SQL-side enqueue | ✓ | Installed on production per Plan 01-04 NOTICE | — |
| `enqueue_compute_job` RPC | Delta-cron follow-up enqueue | ✓ | Live per migration 062 apply | — |
| `rescore_allocator` worker handler | Dispatch | ✓ | Live per Plan 03-02 commit b37a361 | — |
| `log_audit_event_service` RPC | Audit event on feedback write (if going YES) | ✓ | Live per migration 058 | — |

All dependencies ready. **No blocking missing dependencies.**

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| supabase-py | existing (analytics-service) | Supabase queries + UPDATEs + RPC calls | Already used throughout analytics-service; match_engine.py + job_worker.py precedent | [VERIFIED: imported in existing `services/db.py`] |
| pytest + pytest-asyncio (auto mode) | existing (per `pytest.ini`) | Unit tests | `asyncio_mode = auto` means no decorators needed; Phase 3 test_match_integration.py uses this | [VERIFIED: `analytics-service/pytest.ini`] |
| unittest.mock (stdlib) | stdlib | MagicMock / AsyncMock / monkeypatch | Phase 3 D-17 precedent (`test_match_integration.py`) | [VERIFIED: see `test_match_integration.py` line 11] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `services.audit.log_audit_event` | Phase 6 closeout | Fire-and-forget audit emission from analytics-service | Use ONLY if discretion "audit event on write" goes YES (recommended) | [VERIFIED: `analytics-service/services/audit.py`] |
| `services.db.get_supabase` | existing | Service-role Supabase client, bypasses RLS | Required for all DB work in analytics-service | [VERIFIED: used at line 174 of routers/match.py] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lazy import of `compute_adjusted_weights` inside `_score_one_allocator` | Top-level import | Lazy is safer — match_engine.py already imports from match_defaults.py and we want to avoid any future circular risk if feedback_engine imports anything from routers.match | [CITED: `services/job_worker.py:1123` precedent] |
| Postgres trigger on `bridge_outcomes` delta UPDATE | SQL-side PERFORM inside `compute_bridge_outcome_deltas` body | D-12 explicitly locked trigger OUT. Function-body PERFORM is visible in function source + cron.job_run_details — better operability | [CITED: CONTEXT.md D-12] |
| Embedded PostgREST `select` with `match_candidates(score_breakdown)` expansion | Two sequential queries: (1) bridge_outcomes, (2) match_candidates batch | Embedded expansion is more compact but PostgREST embedded-select semantics over OR joins get hairy; two-query approach matches existing patterns in `routers/match.py` lines 193–210 | [VERIFIED: codebase precedent] |

**Installation:** No new packages needed. Zero new dependencies.

## Architecture Patterns

### System Architecture Diagram (Phase 4 data flow)

```
                     ┌─────────────────────────┐
                     │ Allocator Action (admin │
                     │ triggers match recompute)│
                     └────────────┬────────────┘
                                  │ HTTP POST /api/match/recompute
                                  ▼
                    ┌──────────────────────────────┐
                    │ routers/match.py             │
                    │  POST /recompute             │
                    │    → _should_skip_allocator  │ (Phase 3 triple-check)
                    │    → _load_candidate_universe│
                    │    → _score_one_allocator    │  <── Phase 4 insertion point
                    └────────────┬─────────────────┘
                                 │
                                 ▼
                ┌───────────────────────────────────┐
                │ _score_one_allocator (line 251)   │
                │  ctx = _load_allocator_context    │
                │  overrides = compute_adjusted_   │──> feedback_engine.py (NEW)
                │    weights(allocator_id)         │
                │  ctx['preferences']              │
                │    ['scoring_weight_overrides']  │
                │    = overrides                   │
                │  score_candidates(...)           │──> match_engine.py (CONSUMES)
                │  persist match_batches           │
                │  persist match_candidates        │
                └───────────────────────────────────┘

        feedback_engine.compute_adjusted_weights flow:

        ┌─────────────────────────────────────────┐
        │ Supabase query #1: bridge_outcomes      │  <── allocator_id filter
        │  WHERE allocator_id = $1 AND            │
        │    (kind='rejected'                      │
        │     OR (kind='allocated'                 │
        │         AND percent_allocated >= 1.0    │
        │         AND (delta_30d IS NOT NULL       │
        │              OR delta_90d ...            │
        │              OR delta_180d ...)))        │
        └───────────────────┬─────────────────────┘
                            │  (also drop already_owned)
                            ▼
        ┌─────────────────────────────────────────┐
        │ Supabase query #2: match_candidates     │  <── for D-05 attribution
        │  WHERE allocator_id = $1 AND            │
        │    strategy_id IN (<eligible outcomes>) │
        │    ORDER BY created_at DESC             │
        │  (keep most recent-per-strategy)        │
        └───────────────────┬─────────────────────┘
                            │
                            ▼
        ┌─────────────────────────────────────────┐
        │ For each outcome:                       │
        │   determine success (D-01: delta > 0)  │
        │   attribute to dimension (D-05 hybrid)  │
        │     rejected → D-06 enum                │
        │     allocated → max(score_breakdown.*)  │
        │     missing match_candidates → UNIFORM  │
        └───────────────────┬─────────────────────┘
                            │
                            ▼
        ┌─────────────────────────────────────────┐
        │ Compute success_rate per dimension      │
        │   rate_i = successes_i / total_i        │
        │ Apply D-13 step function                │
        │   < 0.4 → 0.5; 0.4–0.7 → 1.0; > 0.7→1.5│
        │ Apply D-15 min-5 gate                   │
        │   total_i < 5 → OMIT (D-16)             │
        └───────────────────┬─────────────────────┘
                            │  result dict
                            ▼
        ┌─────────────────────────────────────────┐
        │ D-10 Persist: UPDATE allocator_         │
        │   preferences.scoring_weight_overrides  │
        │   = result_dict (or NULL if empty)      │
        │ [optional] emit audit event             │
        │ Return result_dict                      │
        └─────────────────────────────────────────┘

        Delta-cron follow-up (D-11 + D-12):

        pg_cron @ 0 3 * * * ──> compute_bridge_outcome_deltas() SQL
                                  │
                                  ├── UPDATE delta_Xd columns ─┐
                                  │                            │
                                  └── FOR v_allocator_id IN    │  (NEW — D-12)
                                        SELECT DISTINCT ...    │
                                      LOOP                     │
                                        PERFORM enqueue_       │
                                          compute_job(         │
                                            'rescore_allocator'│
                                            v_allocator_id)    │
                                      END LOOP;                ▼
                                                   ┌───────────────────┐
                                                   │ compute_jobs row  │
                                                   │   kind='rescore_  │
                                                   │     allocator'    │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ main_worker tick  │
                                                   │   → dispatch()    │
                                                   │   → run_rescore_  │
                                                   │     allocator_job │
                                                   │   → _score_one_   │
                                                   │     allocator     │
                                                   │     (inline       │
                                                   │      feedback)    │
                                                   └───────────────────┘
```

### Recommended Module Structure

```
analytics-service/services/
├── feedback_engine.py        # NEW — one public function + 3 helpers
│   ├── REJECTION_REASON_TO_DIMENSION  # constant (co-located per lean Claude's Discretion)
│   ├── _fetch_eligible_outcomes(allocator_id)   # private: query + D-08 filter
│   ├── _attribute_dimension(outcome, match_cand)  # private: D-05/D-06 logic
│   ├── _compute_success_rates(attributed)  # private: per-dim counters
│   ├── _apply_shape(rates)                 # private: D-13 step + D-15 gate
│   └── compute_adjusted_weights(allocator_id)  # public: orchestrate + persist

analytics-service/tests/
├── test_feedback_engine.py   # NEW — 15-20 pytest unit tests
└── fixtures/
    └── feedback_engine_v1_golden.json  # NEW — frozen expected output
```

### Pattern 1: Pure-Function Scoring Helper

**What:** Private helpers compute subresults; public function orchestrates and performs side effects.
**When to use:** Match_engine's `_compute_preference_fit`, `_compute_mandate_fit_score` pattern.
**Example:**
```python
# Source: services/match_engine.py lines 221+ (analog pattern)
def _compute_success_rates(attributed: dict[str, list[int]]) -> dict[str, float]:
    """Per-dimension success rate: successes/total. Pure function."""
    return {
        dim: sum(outcomes) / len(outcomes)
        for dim, outcomes in attributed.items()
        if len(outcomes) > 0
    }
```

### Pattern 2: Lazy-Import to Break Cycles

**What:** Import inside function body, not module top.
**When to use:** When the importing module is already imported by match_engine/match_defaults transitively.
**Example:**
```python
# Source: services/job_worker.py line 1123
async def run_rescore_allocator_job(job: dict) -> DispatchResult:
    from routers.match import _load_candidate_universe, _score_one_allocator
    # ...
```

For Phase 4, `compute_adjusted_weights` called from `routers/match.py::_score_one_allocator` is the forward direction (routers → services), so NO circular risk for the standard path. Lazy import is needed ONLY if `feedback_engine.py` ends up needing to call anything from `routers.match` (unlikely for the computation itself).

### Pattern 3: Three-Tier RLS + Service-Role Bypass

**What:** Analytics-service runs under `service_role` key, bypasses RLS.
**When to use:** All DB writes from analytics-service (no end-user auth context).
**Example:**
```python
# Source: routers/match.py line 280
supabase = get_supabase()  # returns service-role client
supabase.table("allocator_preferences").update({...}).eq("user_id", allocator_id).execute()
```

### Pattern 4: Golden Snapshot Determinism Test

**What:** Frozen JSON fixture + env-var-triggered regeneration.
**When to use:** Any scoring component whose output should be byte-stable across refactors.
**Example:**
```python
# Source: Phase 3 D-15 #20 precedent
@pytest.mark.skipif(not MANDATE_FIT_IMPORTED, ...)
def test_feedback_engine_v1_golden_snapshot(tmp_path, monkeypatch):
    allocator_id = "test-allocator"
    # ... seed mock Supabase with 12-outcome deterministic history ...
    result = compute_adjusted_weights(allocator_id)
    fixture_path = FIXTURES_DIR / "feedback_engine_v1_golden.json"
    if os.environ.get("REGENERATE_GOLDEN") == "1":
        fixture_path.write_text(json.dumps(result, sort_keys=True, indent=2))
    expected = json.loads(fixture_path.read_text())
    assert json.dumps(result, sort_keys=True) == json.dumps(expected, sort_keys=True)
```

### Anti-Patterns to Avoid

- **Don't query `match_candidates` per-row.** A single `IN (...)` query keyed by the eligible strategy_ids is one round trip; per-row is N+1.
- **Don't implement D-05 score-dominant by re-running `score_candidates`.** The `score_breakdown` JSONB is already persisted. Reading it is one query; re-scoring is 30-candidate full-universe work.
- **Don't write the column on every call if the result is unchanged.** A cheap idempotence guard is OK but not required — UPDATE of an unchanged JSONB is ~0.5ms on a single-row PK match; no real cost.
- **Don't emit the audit event inside the computation.** Emit after the UPDATE succeeds, follow fire-and-forget per `services/audit.py` line 25-42.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Feedback-loop scheduling | Another Vercel cron | `compute_bridge_outcome_deltas` pg_cron + PERFORM enqueue | Vercel Hobby 2/2 cap is full; pg_cron already has the infrastructure + observability via `cron.job_run_details` |
| Enqueue dedup | Your own "is a job already queued?" query | `compute_jobs_one_inflight_per_kind_allocator` partial unique index | Migration 062 line 151 already enforces at DB layer |
| RLS for writes | Add new policies | service_role client bypasses RLS per ADR-0003 | analytics-service always uses service_role; trust boundary already modeled |
| Weight clamp + renormalize | Hand-rolled clamp | `_clamp(v, 0.5, 1.5)` in match_engine.py + engine's existing renormalize at line 785 | Phase 3 already does defense-in-depth clamp; Phase 4's honest output clamp means engine-level defensive clamp is a no-op |
| Audit event | log_audit_event from TS | `services/audit.log_audit_event` (Python) via `log_audit_event_service` RPC | migration 058 service-role-only RPC; analytics-service uses this pattern in bridge_run/simulator_run/optimizer_run |
| Cron extension | New migration file | Amend `compute_bridge_outcome_deltas()` body in a NEW migration 063 (CREATE OR REPLACE) | Migration history stays linear; Phase 3 precedent from 062 step 8 |

**Key insight:** Every piece of infrastructure Phase 4 needs is already alive. Feedback engine is pure function + one UPDATE + (optional) one migration amendment + (optional) one audit emit. Don't invent new plumbing.

## Common Pitfalls

### Pitfall 1: `preferences` can be `None` in `_load_allocator_context`

**What goes wrong:** `ctx["preferences"]` is directly `prefs_result.data`, which is `None` if the allocator has no `allocator_preferences` row yet. Writing `ctx["preferences"]["scoring_weight_overrides"] = overrides` on a None would raise.

**Why it happens:** routers/match.py line 180 sets `preferences = prefs_result.data` without a default.

**How to avoid:**
```python
if ctx["preferences"] is None:
    ctx["preferences"] = {}
ctx["preferences"]["scoring_weight_overrides"] = overrides or None
```

**Warning signs:** Null-pointer-style error at test-setup time; pytest trace through `_score_one_allocator`.

### Pitfall 2: D-12 transport mismatch — delta cron is SQL, not Python

**What goes wrong:** CONTEXT.md D-12 specifies "explicit Python `enqueue_compute_job` call in the delta cron body". There is NO Python delta cron body — `compute_bridge_outcome_deltas` is a pg_cron-scheduled SQL function (migration 060). `analytics-service/routers/cron.py` contains only the trade-sync cron.

**Why it happens:** CONTEXT.md's description conflates pg_cron's observability ("visible in cron logs") with Python cron logs; the SQL function body is visible via `pg_get_functiondef` and `cron.job_run_details`, so the same intent holds — just via SQL not Python.

**How to avoid:** Ship the enqueue loop **inside the SQL function body** as a migration 063 `CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()`. Add a closing loop at the end of the function body:

```sql
-- After the existing CTE chain that UPDATEs delta_30d/90d/180d, append:
FOR v_allocator_id IN
  SELECT DISTINCT allocator_id
  FROM public.bridge_outcomes
  WHERE deltas_computed_at = v_started
    AND kind = 'allocated'
LOOP
  PERFORM enqueue_compute_job(
    p_strategy_id     := NULL,
    p_kind            := 'rescore_allocator',
    p_idempotency_key := NULL,
    p_parent_job_ids  := '{}',
    p_exchange        := NULL,
    p_metadata        := NULL,
    p_allocator_id    := v_allocator_id
  );
END LOOP;
```

Precedent: migration 062 line 458–466 uses the identical call shape from `update_allocator_mandates`. Partial unique index `compute_jobs_one_inflight_per_kind_allocator` dedupes duplicate enqueues.

**Warning signs:** CONTEXT.md's "additive" language suggests Python; reality forces SQL. Surface this as a decision to lock before planning.

### Pitfall 3: Missing `style_excluded` in `match_candidates.exclusion_reason` CHECK constraint

**What goes wrong:** Phase 3 engine writes `exclusion_reason = 'style_excluded'` for D-06 style-excluded candidates, but migration 011 line 111–113 only permits `'below_min_sharpe', 'below_min_track_record', 'excluded_exchange', 'exceeds_max_dd', 'off_mandate_type', 'owned', 'thumbs_down'`. Inserting 'style_excluded' would violate the CHECK.

**Why it happens:** The constraint wasn't expanded when Phase 3 added the new SOFT exclusion reason.

**How to avoid:** Phase 4 is NOT affected — `match_candidates.exclusion_reason` is not used in feedback attribution. Attribution uses `score_breakdown` on scored (non-excluded) rows and `rejection_reason` on `bridge_outcomes`. No style_excluded interaction.

**Warning signs:** N/A for Phase 4.

### Pitfall 4: `match_candidates` row may be absent — must use UNIFORM fallback

**What goes wrong:** `_retention_sweep` at routers/match.py line 410 keeps only the last 7 batches per allocator. An outcome from batch 8+ will have its `match_candidates` row CASCADE-deleted (batch_id → match_candidates FK is `ON DELETE CASCADE` per migration 011 line 104). Attribution via `max(score_breakdown.*)` fails because no row exists.

**Why it happens:** Retention policy is the correct tradeoff — scoring data grows fast — but it creates ghost outcomes.

**How to avoid (D-07 locked):** The outcome's success/failure increments EACH of the four dimension counters by the same amount (UNIFORM). Does NOT drop the row — it still counts toward `num_total` per dimension. Example:
- Allocator has 20 outcomes, 8 are missing `match_candidates`.
- 8 × UNIFORM = each dimension gets +8 outcomes.
- The 12 attributed-correctly outcomes stack on top.
- A dimension with 5 attributed + 8 uniform = 13 total, possibly reaching min-5 threshold.

**Logging recommendation (new):** Log a WARN when missing-rate > 30% of outcomes for a given allocator (observability hint; see Open Question 2).

**Warning signs:** A fresh allocator with 20+ outcomes but no `match_candidates` matches in the query — typical for users who've been on the platform >7 scoring runs.

### Pitfall 5: Supabase-py `or_` operator quoting is fragile

**What goes wrong:** Building a PostgREST `.or_("delta_30d.not.is.null,delta_90d.not.is.null,delta_180d.not.is.null")` filter with mixed syntaxes can silently miss rows or get escaped incorrectly.

**Why it happens:** supabase-py encodes `.or_()` as a URL-encoded query string; commas inside inner conditions need escaping.

**How to avoid:** Build the outcomes query as TWO queries: (1) `kind='rejected' AND rejection_reason != 'already_owned'`, (2) `kind='allocated' AND percent_allocated >= 1.0`. Then do D-03 filtering (any delta non-NULL) in Python. Simpler, less fragile, and the row volume per allocator is bounded (≤ ~hundreds in practice).

**Warning signs:** Missing rows in a query that should match; unexplained empty results.

### Pitfall 6: `score_breakdown` in screening mode omits `portfolio_fit`

**What goes wrong:** match_engine.py line 821–823 gates insertion of `portfolio_fit` on `mode == "personalized"`. For screening-mode allocated outcomes, `score_breakdown["portfolio_fit"]` is missing (KeyError), and D-05 `max(...)` must NOT include it.

**Why it happens:** Screening mode doesn't have a portfolio to fit against; Phase 3 decided not to emit a misleading scalar.

**How to avoid:** In D-05 score-dominant attribution:
```python
dim_candidates = {"W_PREFERENCE_FIT": "preference_fit",
                  "W_TRACK_RECORD": "track_record",
                  "W_CAPACITY_FIT": "capacity_fit"}
if "portfolio_fit" in score_breakdown:  # personalized-mode only
    dim_candidates["W_PORTFOLIO_FIT"] = "portfolio_fit"
max_dim = max(dim_candidates, key=lambda w: score_breakdown[dim_candidates[w]])
```

Alternatively, add an explicit fallback for screening-mode outcomes → never attribute to `W_PORTFOLIO_FIT`. Document the decision.

**Warning signs:** KeyError on `score_breakdown["portfolio_fit"]`; test for screening-mode outcomes.

### Pitfall 7: `allocator_preferences` may not have a row for some allocators

**What goes wrong:** `compute_adjusted_weights` does `.update(...).eq("user_id", allocator_id).execute()`. If no row exists for this user_id, the UPDATE silently writes zero rows (PostgreSQL semantics). The in-memory return is still correct, but the DB persistence is missed.

**Why it happens:** Migration 061 did not backfill `allocator_preferences` rows for all users; the row is created on first mandate write via `update_allocator_mandates` RPC (migration 062 INSERT...ON CONFLICT line 417–429).

**How to avoid:** Two options:
- **Option A (simple):** No-op if the row doesn't exist; log at DEBUG level. The in-memory return still works for the inline call path; the persistence is recovered on next mandate write or via the cron daily sweep.
- **Option B (complete):** Use `upsert` (not update) with `on_conflict="user_id"` to insert a new row with just the overrides key. But this would insert a row with NULL for every other mandate column — semantically "allocator has overrides but no mandate" which is surprising.

**Recommendation:** Option A. Document that Phase 4 writes only when a row exists; inline path doesn't need persistence to function.

**Warning signs:** Phase 5 dashboard queries `scoring_weight_overrides` and gets NULL for an allocator who just completed a scoring run — confusing but self-healing on next mandate write.

### Pitfall 8: Outcomes from v1 batches carry `preference_fit`, not `effective_preference_fit`

**What goes wrong:** Phase 3's composition inside `W_PREFERENCE_FIT` produces `effective_preference_fit = 0.6 * preference_fit + 0.4 * mandate_fit_score`. But the `score_breakdown` JSON persisted at line 803–819 stores the raw `preference_fit` scalar (line 804), NOT the effective one. D-05 score-dominant uses the raw scalar — correct.

**Why it matters:** If a future refactor moves to storing `effective_preference_fit` in `score_breakdown`, attribution would unintentionally weight by mandate_fit too. Stay with `score_breakdown["preference_fit"]`.

**Warning signs:** Attribution counts change across engine version bumps when only the persisted key names change.

## Code Examples

### Example 1: `compute_adjusted_weights` public function shape

```python
# Source: follows match_engine.py helper pattern
from typing import Any, Optional

from services.db import get_supabase
from services.audit import log_audit_event

REJECTION_REASON_TO_DIMENSION: dict[str, str] = {
    "mandate_conflict": "W_PREFERENCE_FIT",
    "underperforming_peers": "W_TRACK_RECORD",
    "timing_wrong": "W_PORTFOLIO_FIT",
    # 'already_owned' dropped per D-08
    # 'other' handled by score-dominant fallback
}

MIN_OUTCOMES_PER_DIMENSION = 5
SCALE_FLOOR = 0.5
SCALE_CEILING = 1.5
RATE_FLOOR_THRESHOLD = 0.4
RATE_CEILING_THRESHOLD = 0.7

ALL_DIMENSIONS = ("W_PORTFOLIO_FIT", "W_PREFERENCE_FIT",
                  "W_TRACK_RECORD", "W_CAPACITY_FIT")


def compute_adjusted_weights(allocator_id: str) -> dict[str, float]:
    """Phase 4 feedback engine public entry point.

    Reads bridge_outcomes + match_candidates.score_breakdown for this
    allocator, attributes each outcome to one of four top-level
    dimensions (D-05 hybrid), computes success_rate per dimension,
    applies the D-13 step function, and returns + persists the overrides.

    Returns a dict of {W_i: scale} for dimensions with ≥5 attributed
    outcomes (per D-15). Dimensions below threshold are OMITTED (D-16).
    An allocator with zero eligible outcomes returns {} and writes NULL
    to the column.
    """
    outcomes = _fetch_eligible_outcomes(allocator_id)
    if not outcomes:
        _persist_overrides(allocator_id, None)
        return {}

    # Attribution + counters
    dim_stats: dict[str, list[int]] = {w: [] for w in ALL_DIMENSIONS}
    strategy_ids = [o["strategy_id"] for o in outcomes]
    score_breakdowns = _fetch_score_breakdowns(allocator_id, strategy_ids)

    for outcome in outcomes:
        dims = _attribute_dimension(outcome, score_breakdowns.get(outcome["strategy_id"]))
        success = _success_value(outcome)
        for dim in dims:
            dim_stats[dim].append(success)

    # Compute rates + apply shape + apply min-5 gate
    result: dict[str, float] = {}
    for dim, outcomes_for_dim in dim_stats.items():
        if len(outcomes_for_dim) < MIN_OUTCOMES_PER_DIMENSION:
            continue  # D-16 omit
        rate = sum(outcomes_for_dim) / len(outcomes_for_dim)
        if rate < RATE_FLOOR_THRESHOLD:
            result[dim] = SCALE_FLOOR
        elif rate > RATE_CEILING_THRESHOLD:
            result[dim] = SCALE_CEILING
        # else: 1.0 is implicit — omit per D-16

    _persist_overrides(allocator_id, result or None)
    return result
```

### Example 2: `_fetch_eligible_outcomes` with D-08 filtering

```python
def _fetch_eligible_outcomes(allocator_id: str) -> list[dict[str, Any]]:
    """Query bridge_outcomes for this allocator, apply D-08 filters.

    Returns a list of outcome dicts. Each dict has the columns needed
    for attribution + success determination.
    """
    supabase = get_supabase()
    # Two queries are simpler than an OR-heavy single query (Pitfall 5).
    rejected = (
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "rejected")
        .neq("rejection_reason", "already_owned")  # D-08 filter #1
        .execute()
    ).data or []

    allocated = (
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "allocated")
        .gte("percent_allocated", 1.0)  # D-08 filter #2
        .execute()
    ).data or []

    # D-03: drop pending allocated (all delta_Xd NULL)
    mature_allocated = [
        o for o in allocated
        if o.get("delta_30d") is not None
        or o.get("delta_90d") is not None
        or o.get("delta_180d") is not None
    ]
    return rejected + mature_allocated
```

### Example 3: `_attribute_dimension` — D-05 hybrid rule

```python
def _attribute_dimension(
    outcome: dict[str, Any],
    score_breakdown: Optional[dict[str, Any]],
) -> list[str]:
    """Returns list of dimensions to attribute this outcome to.

    For rejected outcomes with a mapped reason → [mapped dim].
    For 'other' or allocated or missing-history → score-dominant
    or UNIFORM fallback per D-05/D-07.
    """
    if outcome["kind"] == "rejected":
        reason = outcome.get("rejection_reason")
        if reason in REJECTION_REASON_TO_DIMENSION:
            return [REJECTION_REASON_TO_DIMENSION[reason]]
        # 'other' → fall through to score-dominant

    # Score-dominant branch (covers allocated + rejected-other)
    if score_breakdown is None:
        # D-07 UNIFORM fallback
        return list(ALL_DIMENSIONS)

    # Pitfall 6: portfolio_fit absent in screening mode
    dim_candidates = {
        "W_PREFERENCE_FIT": "preference_fit",
        "W_TRACK_RECORD": "track_record",
        "W_CAPACITY_FIT": "capacity_fit",
    }
    if "portfolio_fit" in score_breakdown:
        dim_candidates["W_PORTFOLIO_FIT"] = "portfolio_fit"

    # Max by scalar value; deterministic tiebreak by dim name (alphabetical)
    max_dim = max(
        dim_candidates.keys(),
        key=lambda w: (score_breakdown[dim_candidates[w]], -ord(w[0]))
    )
    return [max_dim]


def _success_value(outcome: dict[str, Any]) -> int:
    """D-01: success=1 iff most-mature-available delta > 0. D-04: rejected=0."""
    if outcome["kind"] == "rejected":
        return 0
    # Prefer delta_180d, then 90d, then 30d
    for col in ("delta_180d", "delta_90d", "delta_30d"):
        val = outcome.get(col)
        if val is not None:
            return 1 if val > 0 else 0
    # All NULL — should have been filtered out by D-03
    raise ValueError("Pending allocated outcome slipped past D-03 filter")
```

### Example 4: `_persist_overrides` idempotent write + audit emit

```python
def _persist_overrides(
    allocator_id: str,
    overrides: Optional[dict[str, float]],
) -> None:
    """Write the computed overrides to allocator_preferences.
    NULL when empty (D-16 cold-start: column unset).
    Audit event emitted fire-and-forget (discretion YES)."""
    supabase = get_supabase()
    result = supabase.table("allocator_preferences").update({
        "scoring_weight_overrides": overrides,
    }).eq("user_id", allocator_id).execute()

    if not result.data:
        # Pitfall 7: row didn't exist — silent no-op, log at DEBUG
        logger.debug(
            "feedback_engine: no allocator_preferences row for %s; "
            "overrides computed but not persisted",
            allocator_id,
        )
        return

    # Claude's Discretion: emit audit event (lean YES)
    log_audit_event(
        user_id=allocator_id,
        action="feedback.overrides_updated",
        entity_type="allocator_preference_feedback",
        entity_id=allocator_id,
        metadata={
            "dimensions_updated": list(overrides.keys()) if overrides else [],
            "engine_version": "v1",  # feedback rule format version (not engine_version)
        },
    )
```

### Example 5: Delta-cron SQL-side enqueue (migration 063)

```sql
-- supabase/migrations/063_feedback_cron_enqueue.sql
-- Phase 4 / D-12 — extends compute_bridge_outcome_deltas to enqueue
-- rescore_allocator follow-ups for allocators whose outcomes got their
-- delta_Xd columns populated in this run.

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
  v_allocator_id UUID;
BEGIN
  -- ... existing CTE chain (unchanged) ...

  -- NEW (Phase 4 / D-12 / D-11): enqueue rescore_allocator for every allocator
  -- whose outcomes just got a delta update. Partial unique index dedupes if a
  -- rescore is already queued for this allocator.
  FOR v_allocator_id IN
    SELECT DISTINCT allocator_id
    FROM public.bridge_outcomes
    WHERE deltas_computed_at = v_started
      AND kind = 'allocated'
  LOOP
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'rescore_allocator',
        p_idempotency_key := NULL,
        p_parent_job_ids  := '{}',
        p_exchange        := NULL,
        p_metadata        := NULL,
        p_allocator_id    := v_allocator_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        -- Log + continue. A per-allocator enqueue failure should not block
        -- the rest of the cron batch. pg_cron will surface the NOTICE.
        RAISE NOTICE 'feedback enqueue failed for allocator=%: %', v_allocator_id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;

-- Self-verify: function body must reference enqueue_compute_job.
DO $$
DECLARE v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body FROM pg_proc
  WHERE proname = 'compute_bridge_outcome_deltas';
  IF v_body NOT LIKE '%enqueue_compute_job%rescore_allocator%' THEN
    RAISE EXCEPTION 'Migration 063: delta-cron does not reference enqueue_compute_job for rescore_allocator';
  END IF;
END$$;

COMMIT;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Feedback = implicit in whoever-writes-`scoring_weight_overrides` | Explicit `feedback_engine.py` module with single public `compute_adjusted_weights` | Phase 4 (this phase) | Clean separation of scoring (match_engine) vs feedback (feedback_engine); Phase 3's column is already engine-consumed |
| Allocator-scoped compute_jobs did not exist | 3-way scope XOR (strategy / portfolio / allocator) + `rescore_allocator` kind | Phase 3 migration 062 | D-12 enqueue path is already built and tested |
| Audit events in bridge scope only | Extended to `allocator_preference_mandate` (Phase 2) | Phase 2 | Phase 4 adds `allocator_preference_feedback` entity_type to round out the allocator-prefs audit surface |

**Deprecated/outdated:**
- `.planning/phases/03-mandate-aware-scoring-engine/03-02-SUMMARY.md` line 152 says "Phase 4 will need to either (a) add a new compute_job kind `rescore_from_feedback` that mirrors `rescore_allocator` or (b) write to `scoring_weight_overrides` via a SECURITY DEFINER RPC that also PERFORMs an enqueue". **Both (a) and (b) are unnecessary**: Phase 4's inline call at `_score_one_allocator` means every normal scoring run picks up feedback for free; the delta-cron follow-up (D-11/D-12) reuses the existing `rescore_allocator` kind (no new kind). The SUMMARY was written before CONTEXT.md locked D-09 + D-10.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service) with `asyncio_mode = auto` |
| Config file | `analytics-service/pytest.ini` |
| Quick run command | `cd analytics-service && pytest tests/test_feedback_engine.py -x -q` |
| Full suite command | `cd analytics-service && pytest --cov=services --cov-report=term-missing` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEEDBACK-01 | `compute_adjusted_weights` exists + returns dict | unit | `pytest tests/test_feedback_engine.py::test_public_signature -x` | ❌ Wave 0 |
| FEEDBACK-02 | Floor 0.5× when rate<0.4 | unit | `pytest tests/test_feedback_engine.py::test_floor_on_low_rate -x` | ❌ Wave 0 |
| FEEDBACK-02 | Ceiling 1.5× when rate>0.7 | unit | `pytest tests/test_feedback_engine.py::test_ceiling_on_high_rate -x` | ❌ Wave 0 |
| FEEDBACK-02 | No change when 0.4≤rate≤0.7 | unit | `pytest tests/test_feedback_engine.py::test_no_change_in_band -x` | ❌ Wave 0 |
| FEEDBACK-03 | <5 outcomes → no adjustment | unit | `pytest tests/test_feedback_engine.py::test_cold_start_under_five -x` | ❌ Wave 0 |
| FEEDBACK-03 | Exactly 5 → adjustment fires | unit | `pytest tests/test_feedback_engine.py::test_threshold_at_five -x` | ❌ Wave 0 |
| FEEDBACK-04 | `allocator_preferences.scoring_weight_overrides` reflects adjustment | integration | `pytest tests/test_feedback_engine.py::test_persist_column -x` (mocked Supabase) | ❌ Wave 0 |
| FEEDBACK-04 | Empty result → column set to NULL | integration | `pytest tests/test_feedback_engine.py::test_persist_null_on_cold_start -x` | ❌ Wave 0 |
| FEEDBACK-05 | Dimensions adjust independently | unit | `pytest tests/test_feedback_engine.py::test_per_dimension_independence -x` | ❌ Wave 0 |
| FEEDBACK-06 | `match_batches.effective_preferences` snapshots overrides | integration | Covered by Phase 3's existing engine tests — no new test needed (engine reads from prefs → snapshots into effective_preferences automatically); add a regression assertion in `test_feedback_engine.py::test_inline_merge_reaches_snapshot` | ❌ Wave 0 |
| D-05 score-dominant | Allocated outcome → attribution by max(score_breakdown.*) | unit | `pytest tests/test_feedback_engine.py::test_score_dominant_attribution -x` | ❌ Wave 0 |
| D-06 rejection enum | Each enum value maps correctly | unit | `pytest tests/test_feedback_engine.py::test_rejection_reason_mapping -x` | ❌ Wave 0 |
| D-07 uniform fallback | Missing match_candidates → uniform | unit | `pytest tests/test_feedback_engine.py::test_uniform_fallback_missing_history -x` | ❌ Wave 0 |
| D-08 filter #1 | `already_owned` dropped | unit | `pytest tests/test_feedback_engine.py::test_filter_already_owned -x` | ❌ Wave 0 |
| D-08 filter #2 | `percent_allocated < 1.0` dropped | unit | `pytest tests/test_feedback_engine.py::test_filter_small_allocation -x` | ❌ Wave 0 |
| D-03 pending exclusion | All-NULL delta dropped | unit | `pytest tests/test_feedback_engine.py::test_filter_pending -x` | ❌ Wave 0 |
| D-13 step function | Each branch (0.3, 0.4, 0.5, 0.7, 0.8) hit | unit | `pytest tests/test_feedback_engine.py::test_step_function_boundaries -x` | ❌ Wave 0 |
| D-14 stateless | Same inputs → same outputs every call | unit | `pytest tests/test_feedback_engine.py::test_determinism -x` | ❌ Wave 0 |
| D-16 omit keys | Under-threshold dim NOT in result dict | unit | `pytest tests/test_feedback_engine.py::test_omit_undertrained_dims -x` | ❌ Wave 0 |
| Golden fixture | v1 output byte-identical to fixture | unit | `REGENERATE_GOLDEN=1 pytest tests/test_feedback_engine.py::test_golden_snapshot -x` | ❌ Wave 0 |
| D-12 SQL enqueue | Migration 063 amends compute_bridge_outcome_deltas to PERFORM enqueue | integration / migration self-verify | Migration 063 self-verify DO block at apply time | ❌ Wave 0 |
| D-11 integration | rescore_allocator job dispatches → inline feedback fires | integration | `pytest tests/test_feedback_engine.py::test_dispatch_through_worker -x` (mocked, follows Phase 3 precedent) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_feedback_engine.py -x -q` (target <10s)
- **Per wave merge:** `pytest --cov=services.feedback_engine --cov-report=term-missing -x` (target >90% coverage on new module)
- **Phase gate:** Full `analytics-service` suite green before `/gsd-verify-work` (currently 452 tests; Phase 4 adds ~18-22 tests)

### Wave 0 Gaps

- [ ] `analytics-service/tests/test_feedback_engine.py` — NEW file with 18-22 test scaffolds + REGENERATE_GOLDEN hook
- [ ] `analytics-service/tests/fixtures/feedback_engine_v1_golden.json` — NEW frozen golden snapshot; regenerate on first Wave 1 green run
- [ ] No framework install needed — pytest + asyncio-auto already configured

## Implementation Strategy (Sketch — planner owns final structure)

**Single plan (04-01) — as ROADMAP locks:**

**Wave 0 (Red scaffolds):**
- New `analytics-service/tests/test_feedback_engine.py` with 18-22 stub tests + golden-snapshot placeholder (follows Phase 3 WR-01 pattern with `try/except ImportError` guard + `IMPORTS_OK` sentinel).

**Wave 1 (Production code):**
- **Task 1-A — `feedback_engine.py` module:** Public `compute_adjusted_weights` + 3-4 private helpers + `REJECTION_REASON_TO_DIMENSION` constant + module docstring citing CONTEXT.md decisions. No changes to `match_engine.py`.
- **Task 1-B — Integration wiring:** Extend `routers/match.py::_score_one_allocator` (single seam, line 259 insertion). Add a 3-line block that calls `compute_adjusted_weights` via `asyncio.to_thread`, merges into `ctx["preferences"]["scoring_weight_overrides"]`. Handles `ctx["preferences"] is None` edge case (Pitfall 1).
- **Task 1-C — Migration 063 (D-12 SQL-side enqueue):** `CREATE OR REPLACE FUNCTION compute_bridge_outcome_deltas()` with a loop appending `PERFORM enqueue_compute_job('rescore_allocator', allocator_id)` for every distinct allocator whose outcomes were updated in this run. Self-verifying DO block at migration apply.
- **Task 1-D — Golden fixture generation:** Run `REGENERATE_GOLDEN=1 pytest tests/test_feedback_engine.py::test_golden_snapshot`; commit the fixture.

**Wave 2 (Apply migration + verify):**
- Apply migration 063 via `supabase db push` (non-interactive).
- Full test suite + coverage gate.

**Verification hooks:**
- Phase 3's `test_worker_reads_latest_allocator_preferences` at `test_match_integration.py` line 141 proves the dispatch path is fresh-preferences-aware. Phase 4 adds a regression assertion: after `compute_adjusted_weights` + scoring run, the persisted `scoring_weight_overrides` column value matches the `effective_preferences` snapshot on the resulting `match_batches` row.

**Estimated scope:**
- ~200-300 LOC Python (feedback_engine.py)
- ~15 LOC Python (routers/match.py surgical insertion)
- ~50 LOC SQL (migration 063 amendment)
- ~400-500 LOC pytest (18-22 tests + golden fixture)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `analytics-service/routers/cron.py` does NOT contain a delta-cron caller | Codebase Finding §1 | [VERIFIED: full file read, no reference to `compute_bridge_outcome_deltas`] |
| A2 | Vercel Hobby plan is at 2/2 cron cap | Runtime State Inventory | [VERIFIED: `vercel.json` read] |
| A3 | `match_candidates.score_breakdown` top-level keys are `portfolio_fit`, `preference_fit`, `track_record`, `capacity_fit` | Codebase Finding §3 | [VERIFIED: match_engine.py line 803–824 + golden fixture] |
| A4 | `scoring_weight_overrides` is nullable, no DB CHECK, first-writer is Phase 4 | Codebase Finding §5 | [VERIFIED: migration 062 line 74–78] |
| A5 | `enqueue_compute_job` 7-param signature with `p_allocator_id` trailing is production-ready | Codebase Finding §2 | [VERIFIED: migration 062 lines 291–330 + Phase 3 apply log] |
| A6 | Service_role bypasses RLS for `allocator_preferences` UPDATE | Anti-Patterns | [VERIFIED: ADR-0003 + existing analytics-service patterns] |
| A7 | `log_audit_event_service` RPC is still alive and service-role-gated | Architecture Patterns | [VERIFIED: migration 058 + `services/audit.py`] |
| A8 | `_retention_sweep` policy (keep last 7) is unchanged | Pitfall 4 | [VERIFIED: routers/match.py line 410–430] |
| A9 | Python test file `test_feedback_engine.py` doesn't already exist | Validation Architecture | [VERIFIED: `ls analytics-service/tests/`] |
| A10 | `needs_recompute` flag in bridge_outcomes is the cron's internal guard, not feedback-relevant | Verification §4 | [VERIFIED: migration 060 line 184-210] |
| A11 | For screening-mode outcomes, attribution should exclude W_PORTFOLIO_FIT | Pitfall 6 | [ASSUMED — planner should confirm; match_engine.py line 821 gates `portfolio_fit` insertion on mode] |
| A12 | `compute_bridge_outcome_deltas` can be CREATE OR REPLACEd without data-migration risk | Example 5 | [CITED: Phase 3 migration 062 pattern for `update_allocator_mandates` replacement] |

**No assumed-without-verification critical facts.** All of A1-A10, A12 are codebase-verified; A11 is a reasoned inference from observed behavior but merits a planner confirmation.

## Open Questions (for user callout before planning)

### 1. D-12 transport — SQL-side PERFORM vs deferred to follow-up phase (CRITICAL — MUST RESOLVE)

**What we know:**
- CONTEXT.md D-12 mandates "explicit Python `enqueue_compute_job` call in the delta cron body" for visibility + no trigger.
- Reality: Migration 060 registers `compute_bridge_outcome_deltas` directly in pg_cron as a SQL function; there is NO Python delta-cron caller.
- Vercel Hobby plan is at 2/2 cap — cannot add a Python cron to wrap the SQL call.

**What's unclear:** CONTEXT.md's "visible in cron logs" claim was based on a false premise (Python caller existence). Is SQL-side visibility (via `cron.job_run_details` + `pg_get_functiondef`) acceptable?

**Recommendation:** **Ship D-12 as SQL-side `PERFORM enqueue_compute_job(...)` inside the SQL function body (migration 063).** Precedent: `update_allocator_mandates` at migration 062 line 458 uses the identical pattern. Observability: the `RAISE NOTICE` from inside the PL/pgSQL loop is captured in `cron.job_run_details`; the partial unique index dedupes concurrent enqueues.

**Alternative:** Defer D-12 to Phase 5 and ship Phase 4 with only the inline invocation path (every normal recompute picks up feedback). Loses some latency but simplifies the phase.

**User decision needed.** Either (a) accept SQL-side PERFORM in migration 063 as equivalent to D-12's intent, or (b) rewrite D-12 to make the mechanism explicit.

### 2. Should `compute_adjusted_weights` LOG the missing-match_candidates situation for observability?

**What we know:** D-07 locked UNIFORM fallback when `match_candidates` row is aged out. The computation proceeds silently.

**What's unclear:** If retention_sweep is eating >30% of outcomes per allocator, we'd want to know (either raise retention or accept the signal degradation).

**Recommendation:** Log at INFO level when missing-rate exceeds 30% for a given allocator, e.g., `logger.info("feedback_engine: allocator=%s missing_history=%d/%d (%.0f%%)", allocator_id, missing, total, pct)`. Keep at INFO to avoid spam; surface to Grafana as a rate metric. Planner can defer if this adds test complexity.

### 3. Should we emit an `audit` event on every `scoring_weight_overrides` write?

**What we know:** Claude's Discretion (CONTEXT.md lines 81). ADR-0023 mandates audit for allocator-scoped mutations; Phase 2 did this for `allocator_preference_mandate`. Entity-type `allocator_preference_feedback` would round out the symmetry.

**What's unclear:** Any downside to always doing it? The emitter is fire-and-forget and swallows errors.

**Recommendation:** **YES — emit the audit event.** Cost is minimal (one service-role RPC round trip, async-dispatched). Benefit: Phase 5 dashboard + admin UI can query the `audit_log` table for a "feedback adjustment history" view without re-running the engine. Add `"feedback.overrides_updated"` to `AuditAction` union and `"allocator_preference_feedback"` to `AuditEntityType` union (both in `src/lib/audit.ts`). Update ADR-0023 registered-actions table.

### 4. Debug endpoint `GET /feedback/{allocator_id}/state` — include?

**What we know:** Claude's Discretion (CONTEXT.md line 84). Would expose the current `scoring_weight_overrides` + maybe a breakdown of per-dimension counts + the most recent audit event.

**What's unclear:** Phase 5 dashboard will surface this anyway. The endpoint adds API surface area and a new route handler to test.

**Recommendation:** **DEFER.** Phase 5's outcomes dashboard likely needs the same data; defer the endpoint's creation to Phase 5 where it can power the UI directly. Add to Deferred Items if user agrees.

### 5. Test-file placement — extend `test_match_engine.py` or create `test_feedback_engine.py`?

**What we know:** CONTEXT.md leans NEW file (line 86). Pattern precedent: test files mirror their source modules (`test_match_engine.py` ↔ `match_engine.py`, `test_match_defaults.py` ↔ `match_defaults.py`, per `TESTING.md` line 107).

**Recommendation:** **NEW `test_feedback_engine.py`.** Matches established convention; test_match_engine.py is already 946+ lines.

### 6. `screening-mode + allocated-negative` attribution — document the edge case

**What we know:** Pitfall 6 notes that `portfolio_fit` is absent in screening-mode `score_breakdown`. Attribution via `max(preference_fit, track_record, capacity_fit)` for screening outcomes.

**What's unclear:** Does an allocator-who-was-cold-start-then-became-personalized have mixed history? Do attribution mechanisms match across modes? (Short answer: yes, each outcome is attributed based on the `score_breakdown` that existed at intro time, regardless of current mode.)

**Recommendation:** Document this in the module docstring and the test suite. Add explicit test: `test_attribution_screening_mode_excludes_portfolio_fit`.

## References

### Primary (HIGH confidence — codebase-verified)

- `supabase/migrations/059_bridge_outcomes.sql` — bridge_outcomes schema
- `supabase/migrations/060_bridge_outcome_cron.sql` — delta cron SQL function + pg_cron registration
- `supabase/migrations/062_scoring_weight_overrides.sql` — column + enqueue_compute_job + kind XOR + update_allocator_mandates amendment
- `supabase/migrations/011_perfect_match.sql` — match_batches + match_candidates schema
- `supabase/migrations/058_log_audit_event_service.sql` — service-role audit RPC
- `analytics-service/services/match_engine.py` lines 46 (ENGINE_VERSION), 54–63 (top-level weights), 549–904 (score_candidates), 762–792 (overrides consumer)
- `analytics-service/services/match_defaults.py` lines 9–26 (DEFAULT_PREFERENCES including new Phase 3 keys)
- `analytics-service/services/job_worker.py` lines 123–132 (TIMEOUT_PER_KIND), 1106–1151 (run_rescore_allocator_job), 1159–1205 (dispatch)
- `analytics-service/routers/match.py` lines 172–248 (_load_allocator_context), 251–352 (_score_one_allocator), 355–407 (_should_skip_allocator), 410–430 (_retention_sweep)
- `analytics-service/routers/cron.py` — trade-sync cron ONLY; no delta caller (confirming Pitfall 2 + Open Question 1)
- `analytics-service/services/audit.py` — Python log_audit_event wrapper
- `analytics-service/tests/test_match_engine.py` — 20+ Phase 3 test patterns (fixture `_make_candidate` line 49, golden-snapshot pattern, `MANDATE_FIT_IMPORTED` sentinel line 34–39)
- `analytics-service/tests/test_match_integration.py` — Phase 3 integration test patterns
- `analytics-service/tests/conftest.py` — shared fixtures (golden_returns, benchmark_returns)
- `analytics-service/tests/fixtures/match_engine_v2_golden.json` — golden-snapshot precedent
- `analytics-service/pytest.ini` — asyncio_mode=auto
- `vercel.json` — cron cap confirmation
- `src/lib/audit.ts` lines 140–172 (AuditEntityType union, `allocator_preference_mandate` precedent)
- `src/lib/preferences.ts` — AllocatorPreferences interface with `scoring_weight_overrides`
- `src/lib/admin/match.ts` — ALLOCATOR_PREFERENCES_COLUMNS constant

### Secondary (HIGH confidence — context docs)

- `.planning/phases/04-feedback-loop/04-CONTEXT.md` — locked decisions D-01 through D-16
- `.planning/phases/01-outcome-tracker/01-01-SUMMARY.md` — migration 059 apply outcome, column list
- `.planning/phases/01-outcome-tracker/01-04-SUMMARY.md` — migration 060 apply outcome, cron schedule verified
- `.planning/phases/03-mandate-aware-scoring-engine/03-01-SUMMARY.md` — migration 062 apply outcome, engine math
- `.planning/phases/03-mandate-aware-scoring-engine/03-02-SUMMARY.md` — routers/match.py integration, worker dispatch verified
- `.planning/phases/03-mandate-aware-scoring-engine/03-CONTEXT.md` — D-08 multiplicative overrides, D-11 triple check, D-12 Option B rationale
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — D-10 rejection_reason enum justification
- `.planning/codebase/ARCHITECTURE.md` — three-tier split, RLS + service_role + analytics-service pattern
- `.planning/codebase/TESTING.md` — pytest + fixtures conventions
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — audit pattern for allocator-scoped events
- `docs/architecture/adr-0003-service-role-bypass.md` — service_role bypasses RLS
- `.planning/REQUIREMENTS.md` — FEEDBACK-01 through FEEDBACK-06

### No Tertiary Sources

All findings are codebase-verified or from project context docs. No WebSearch, no external docs — the feedback-loop shape is internal to Quantalyze.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — zero new dependencies; all patterns verified in existing code
- Architecture: HIGH — line-exact integration points verified
- Pitfalls: HIGH — Pitfalls 1, 2, 4, 6, 7 discovered by reading code, not speculation
- D-12 transport mechanism: MEDIUM — requires user decision on SQL-side vs deferral

**Research date:** 2026-04-18
**Valid until:** 2026-04-28 (10 days — scope is narrow, codebase is active, Phase 3 was shipped today)

---
*Phase: 04-feedback-loop*
*Research gathered: 2026-04-18*
