# Phase 03: Mandate-Aware Scoring Engine — Pattern Map

**Mapped:** 2026-04-18
**Plans:** 03-01 (migration 062 + engine math + unit tests), 03-02 (skip-logic + proactive enqueue + integration tests)
**Files analyzed:** 11 (3 created, 8 modified)
**Analogs found:** 11 / 11 (100% — every file has a direct analog in the current codebase)

---

## File Classification

| New/Modified | File | Role | Data Flow | Closest Analog | Match Quality |
|--------------|------|------|-----------|----------------|---------------|
| **Created** | `supabase/migrations/062_scoring_weight_overrides.sql` | migration | schema DDL + RPC amendment | `supabase/migrations/061_mandate_columns.sql` + `supabase/migrations/048_contact_request_metadata.sql` + `supabase/migrations/036_poll_positions_kind.sql` | exact (multi-pattern composite) |
| **Created** | `analytics-service/tests/test_match_integration.py` | test (integration, mocked Supabase) | request-response + pub-sub | `analytics-service/tests/test_daily_enqueue_lock.py` + `analytics-service/tests/test_job_worker.py` | role-match (both use mocked Supabase chains + AsyncMock dispatch) |
| **Created** | `analytics-service/tests/fixtures/match_engine_v2_golden.json` | test fixture | static JSON | (none — `fixtures/` is empty) | placeholder (created empty; populated on first green run via `REGENERATE_GOLDEN=1`) |
| **Modified** | `analytics-service/services/match_engine.py` | engine | pure compute | (itself — extension, not analog; closest peer: `_compute_preference_fit` at line 221) | self (in-place extension) |
| **Modified** | `analytics-service/services/match_defaults.py` | config/defaults | static dict | (itself — extension) | self (in-place extension) |
| **Modified** | `analytics-service/routers/match.py` | router (caller + skip-logic) | request-response | (itself — extension of `_should_skip_allocator` at line 349) | self (in-place extension) |
| **Modified** | `analytics-service/services/job_worker.py` | worker dispatch | event-driven | (itself — extension of `dispatch()` at line 1110) | self (in-place extension; follows `compute_intro_snapshot` Sprint 5 precedent) |
| **Modified** | `analytics-service/tests/test_match_engine.py` | test (unit) | n/a | (itself — extend with 20 new tests) | self (in-place extension) |
| **Modified** | `analytics-service/tests/test_match_defaults.py` | test (unit) | n/a | (itself — extend with 5 new default-key stubs) | self (in-place extension) |
| **Modified** | `src/lib/admin/match.ts` | ts-const (schema sync) | server-only | (itself — append `", scoring_weight_overrides"` to literal) | self (in-place extension) |
| **Modified** | `src/lib/preferences.ts` | ts-type | server-only | (itself — add one field to `AllocatorPreferences` interface) | self (in-place extension) |
| **Modified** | `src/__tests__/mandate-columns-schema-sync.test.ts` | test (vitest schema-sync) | n/a | (itself — add one `.has()` assertion at line 42–47) | self (in-place extension) |

---

## Pattern Assignments

### `supabase/migrations/062_scoring_weight_overrides.sql` (migration, DDL + RPC)

Single atomic migration composing three existing patterns. The plan blends these rather than picking one.

#### Pattern A — Multi-operation single migration wrapper (from 061)

**Analog:** `supabase/migrations/061_mandate_columns.sql:41-282`

BEGIN/COMMIT wrapper with numbered `STEP N` block comments, ALTER TABLE ADD COLUMN IF NOT EXISTS pattern for idempotency, and a concluding self-verifying DO block that RAISES NOTICE on success.

Structural excerpt (061 lines 41-53):

```sql
BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: Add five mandate columns on allocator_preferences
-- --------------------------------------------------------------------------
-- All nullable with no default (D-09 first-visit renders blank).
ALTER TABLE allocator_preferences
  ADD COLUMN IF NOT EXISTS max_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS correlation_ceiling NUMERIC,
  ADD COLUMN IF NOT EXISTS liquidity_preference TEXT,
  ADD COLUMN IF NOT EXISTS style_exclusions TEXT[],
  ADD COLUMN IF NOT EXISTS mandate_edited_at TIMESTAMPTZ;
```

CHECK constraint idempotency pattern (061 lines 68-73):

```sql
ALTER TABLE allocator_preferences
  DROP CONSTRAINT IF EXISTS allocator_preferences_liquidity_preference_check;

ALTER TABLE allocator_preferences
  ADD CONSTRAINT allocator_preferences_liquidity_preference_check
    CHECK (liquidity_preference IS NULL OR liquidity_preference IN ('high', 'medium', 'low'));
```

#### Pattern B — DROP + ADD CHECK to extend kind_target_coherence (from 036 + 048)

**Analog:** `supabase/migrations/036_poll_positions_kind.sql:46-62` (minimal precedent) and `supabase/migrations/048_contact_request_metadata.sql:113-141` (expanded precedent with explicit kind list)

Postgres does not allow ALTER CONSTRAINT in-place — the DROP + re-ADD pattern is the established approach. **048 is the strongest precedent** because it also extends the CHECK to a new kind with a new entity scope.

Excerpt (048 lines 124-141):

```sql
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL) OR
    (kind IN (
      'sync_trades',
      'compute_analytics',
      'poll_positions',
      'sync_funding',
      'reconcile_strategy',
      'compute_intro_snapshot'
    ) AND strategy_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind <-> target-type coherence. compute_portfolio is portfolio-scoped; every other shipped kind is strategy-scoped. compute_intro_snapshot attaches to the intro target strategy and carries contact_request_id in metadata. See migration 048.';
```

**Deviation for 062:** Extends to a **3-way** scope, not just a new kind in an existing arm. Shape per D-12 Option B:

```sql
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
    (kind = 'rescore_allocator' AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
    (kind IN (
      'sync_trades', 'compute_analytics', 'poll_positions',
      'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot'
    ) AND strategy_id IS NOT NULL)
  );
```

And XOR gets the same DROP+ADD treatment (3-way):

```sql
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_target_xor;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_target_xor CHECK (
    (strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL) OR
    (strategy_id IS NULL AND portfolio_id IS NOT NULL AND allocator_id IS NULL) OR
    (strategy_id IS NULL AND portfolio_id IS NULL AND allocator_id IS NOT NULL)
  );
```

Current 2-way XOR (from 032:138-141):

```sql
CONSTRAINT compute_jobs_target_xor CHECK (
  (strategy_id IS NOT NULL AND portfolio_id IS NULL) OR
  (strategy_id IS NULL AND portfolio_id IS NOT NULL)
)
```

#### Pattern C — Partial unique index for in-flight dedup (from 032)

**Analog:** `supabase/migrations/032_compute_jobs_queue.sql:179-187`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_strategy
  ON compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');

CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_portfolio
  ON compute_jobs (portfolio_id, kind)
  WHERE portfolio_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');
```

**Deviation for 062:** Add a third mirror for allocator:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_allocator
  ON compute_jobs (allocator_id, kind)
  WHERE allocator_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');
```

#### Pattern D — enqueue_compute_job RPC wrapper with _assert_owner (from 032)

**Analog:** `supabase/migrations/032_compute_jobs_queue.sql:455-481`

```sql
CREATE OR REPLACE FUNCTION enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_compute_job: p_strategy_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');

  RETURN _enqueue_compute_job_internal(
    p_strategy_id, NULL, p_kind, p_idempotency_key,
    p_parent_job_ids, p_exchange, p_metadata
  );
END;
$$;
```

**Deviation for 062:** Append `p_allocator_id UUID DEFAULT NULL` as a new trailing param (preserves backwards-compat — existing callers don't pass it), amend the body to route allocator-scoped calls through `_assert_owner('profiles'::regclass, p_allocator_id, ...)` (or skip ownership entirely, since the RPC is called SECURITY DEFINER from `update_allocator_mandates` where `p_allocator_id := auth.uid()` by construction), and amend `_enqueue_compute_job_internal` to accept the third id column. Planner confirms whether to touch `_enqueue_compute_job_internal` or add a sibling wrapper.

#### Pattern E — RPC-body PERFORM enqueue (NEW — no direct analog; composed from 061 + scheduled_tasks.py call shape)

**Analog fragments:**
- RPC structure: `supabase/migrations/061_mandate_columns.sql:100-212` (full `update_allocator_mandates` body — CREATE OR REPLACE FUNCTION ... SECURITY DEFINER with UPSERT)
- Enqueue call shape (Python side): `analytics-service/services/scheduled_tasks.py:39-58`

```python
def _enqueue_each(supabase: Any, strategy_ids: list[str], kind: str) -> tuple[int, list[str]]:
    enqueued = 0
    errors: list[str] = []
    for sid in strategy_ids:
        try:
            result = supabase.rpc(
                "enqueue_compute_job",
                {"p_strategy_id": sid, "p_kind": kind},
            ).execute()
```

**Deviation for 062:** The Python call shape informs the SQL `PERFORM` line. In the migration, after the UPSERT in `update_allocator_mandates`, append before the final `END;` (061 line 211):

```sql
  -- Proactive rescore enqueue (D-12 Option B). Runs inside the same
  -- transaction as the UPSERT so a rollback leaves no phantom job row.
  -- Single-inflight dedup is handled by
  -- compute_jobs_one_inflight_per_kind_allocator partial unique index.
  PERFORM enqueue_compute_job(
    p_strategy_id := NULL,
    p_kind := 'rescore_allocator',
    p_allocator_id := v_auth_uid
  );
```

#### Pattern F — Self-verifying DO block (from 061 + 048)

**Analog:** `supabase/migrations/061_mandate_columns.sql:222-280` (best), with `supabase/migrations/048_contact_request_metadata.sql:166-275` as a larger reference covering CHECK-constraint assertions too.

061 excerpt (lines 222-250):

```sql
DO $$
DECLARE
  col_count INTEGER;
  fn_exists BOOLEAN;
  fn_secdef BOOLEAN;
  check_exists BOOLEAN;
  self_update_policy_exists BOOLEAN;
BEGIN
  -- 1. All 5 new columns exist on allocator_preferences
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'allocator_preferences'
    AND column_name IN ('max_weight','correlation_ceiling','liquidity_preference','style_exclusions','mandate_edited_at');
  IF col_count < 5 THEN
    RAISE EXCEPTION 'Migration 061 failed: expected 5 new columns on allocator_preferences, found %', col_count;
  END IF;
```

CHECK-constraint-content assertion pattern (048 lines 252-260):

```sql
  -- 5. kind_target_coherence CHECK references compute_intro_snapshot
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint
    WHERE conname = 'compute_jobs_kind_target_coherence';
  IF v_check_def IS NULL OR v_check_def NOT LIKE '%compute_intro_snapshot%' THEN
    RAISE EXCEPTION 'Migration 048 failed: kind_target_coherence does not reference compute_intro_snapshot. Got: %', COALESCE(v_check_def, '<null>');
  END IF;
```

Terminator (061 line 278):

```sql
  RAISE NOTICE 'Migration 061: mandate columns + update_allocator_mandates RPC + self-update RLS removed verified.';
END
$$;
```

**Deviation for 062:** Assert (a) `scoring_weight_overrides` column on `allocator_preferences`; (b) `allocator_id` column on `compute_jobs`; (c) `compute_jobs_target_xor` CHECK def contains `allocator_id`; (d) `compute_jobs_kind_target_coherence` CHECK def contains `rescore_allocator`; (e) `compute_jobs_one_inflight_per_kind_allocator` unique index exists; (f) `enqueue_compute_job` signature includes `p_allocator_id`; (g) `update_allocator_mandates` body contains `PERFORM enqueue_compute_job`. Optionally add a SAVEPOINTed test INSERT of an allocator-scoped `rescore_allocator` row to prove the new CHECK branch accepts it — per CONTEXT.md D-14 step 9.

---

### `analytics-service/tests/test_match_integration.py` (NEW test file)

**Purpose:** Integration tests for `_should_skip_allocator` triple check (D-11) + `rescore_allocator` worker dispatch + RPC PERFORM side effect (D-12). All against mocked Supabase — no live DB.

#### Pattern 1 — Mocked Supabase chain for query assertions (from test_daily_enqueue_lock.py)

**Analog:** `analytics-service/tests/test_daily_enqueue_lock.py:22-76`

```python
from unittest.mock import MagicMock, patch
import asyncio
import pytest

class TestDailyEnqueueConcurrency:
    async def test_concurrent_enqueue_idempotent(self) -> None:
        call_count = 0
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            nonlocal call_count
            chain = MagicMock()
            if name == "enqueue_poll_positions_for_all_strategies":
                call_count += 1
                if call_count == 1:
                    chain.execute.return_value = MagicMock(data=5)
                else:
                    chain.execute.return_value = MagicMock(data=0)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase):
            results = await asyncio.gather(
                daily_enqueue_tick(),
                daily_enqueue_tick(),
            )

        assert call_count == 2
```

**Deviation for 03-02:** Patch `routers.match.get_supabase` (not `main_worker.get_supabase`) and mock the `.table().select().eq().order().limit().execute()` chain for `match_batches`, plus the `.table().select().eq().maybe_single().execute()` chain for `allocator_preferences` (RESEARCH §Test Infrastructure has the exact skeleton):

```python
def test_skip_when_mandate_edited_before_last_batch(monkeypatch):
    mock_sb = MagicMock()
    # match_batches: most recent batch was at 12:00
    mock_sb.table("match_batches").select().eq().order().limit().execute.return_value = \
        MagicMock(data=[{"computed_at": "2026-04-18T12:00:00Z", "engine_version": "v2.0.0"}])
    # allocator_preferences: mandate_edited_at is BEFORE 12:00
    mock_sb.table("allocator_preferences").select().eq().maybe_single().execute.return_value = \
        MagicMock(data={"mandate_edited_at": "2026-04-18T10:00:00Z"})
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)
    # ... assert _should_skip_allocator returns True
```

#### Pattern 2 — AsyncMock handler dispatch verification (from test_job_worker.py)

**Analog:** `analytics-service/tests/test_job_worker.py:146-225`

```python
class TestDispatchRouting:
    @pytest.mark.asyncio
    async def test_dispatch_routes_compute_intro_snapshot(self) -> None:
        """Sprint 5 Task 5.3: kind='compute_intro_snapshot' routes to
        run_compute_intro_snapshot_job. The job carries contact_request_id
        in metadata; the strategy_id arm of kind_target_coherence holds.
        """
        job = {
            "id": "job-intro-1",
            "kind": "compute_intro_snapshot",
            "strategy_id": "strat-intro-1",
            "metadata": {"contact_request_id": "cr-1"},
        }
        with patch(
            "services.job_worker.run_compute_intro_snapshot_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        assert result.outcome == DispatchOutcome.DONE
```

**Deviation for 03-02:** Mirror this exactly for `kind='rescore_allocator'`, patching `services.job_worker.run_rescore_allocator_job` (name TBD — see the `job_worker.py` modification note below). The allocator-scoped job does NOT go through `sync_strategy_analytics_status` (that bridge is strategy-scoped only), so the `with patch(...sync_strategy_analytics_status...)` clause is not needed — but the test SHOULD assert the bridge was NOT called for allocator-scoped jobs (keeps the strategy-scope invariant honest).

```python
@pytest.mark.asyncio
async def test_dispatch_routes_rescore_allocator(self) -> None:
    job = {
        "id": "job-rescore-1",
        "kind": "rescore_allocator",
        "allocator_id": "alloc-1",
    }
    with patch(
        "services.job_worker.run_rescore_allocator_job",
        new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
    ) as mock_handler, patch(
        "services.job_worker.sync_strategy_analytics_status",
        new=AsyncMock(return_value=None),
    ) as mock_bridge:
        result = await dispatch(job)
    mock_handler.assert_awaited_once_with(job)
    assert result.outcome == DispatchOutcome.DONE
    # Allocator-scoped jobs skip the strategy_analytics bridge
    mock_bridge.assert_not_called()
```

#### Pattern 3 — Imports + async test skeleton

Canonical imports (composing the two analogs):

```python
"""Integration tests for routers/match.py skip-logic triple check + D-12 proactive
enqueue + rescore_allocator worker dispatch. Mocked Supabase only — no live DB."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routers.match import _should_skip_allocator, ENGINE_VERSION
from services.job_worker import DispatchOutcome, DispatchResult, dispatch
```

**Deviation:** `pytest.ini` has `asyncio_mode = auto` so the tests do not need `@pytest.mark.asyncio` decorators (test_daily_enqueue_lock.py omits them; test_job_worker.py adds them anyway — both work). Prefer the bare-async-def style from test_daily_enqueue_lock.py since it's shorter and RESEARCH.md confirms `asyncio_mode = auto`.

---

### `analytics-service/tests/fixtures/match_engine_v2_golden.json` (NEW placeholder)

**Purpose:** Frozen JSON fixture for the golden-snapshot test (D-15 #20). Regenerable via `REGENERATE_GOLDEN=1 pytest tests/test_match_engine.py::test_v1_to_v2_golden_snapshot`.

**Analog:** None — `fixtures/` dir is currently empty (`ls fixtures/` returned no files, only `.` and `..`). This is the first fixture.

**Deviation:** Create as a placeholder with `{"version": "v2.0.0", "results": []}` per VALIDATION.md Wave 0. The regeneration pattern lives in `match_engine.py:740-742` (`to_canonical_json`) which already uses `sort_keys=True, default=str`. The test body follows the pattern RESEARCH.md §Codebase Research #4 documents:

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

---

### `analytics-service/services/match_engine.py` (MODIFIED — engine math)

**Role:** engine, pure compute.

**In-file analog for `_compute_mandate_fit_score`:** `_compute_preference_fit` at lines 221-250.

#### Peer-helper signature pattern

**Analog excerpt (lines 221-250):**

```python
def _compute_preference_fit(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
) -> float:
    """Three sub-components averaged: sharpe headroom, track-record headroom, DD headroom."""
    sub_scores = []

    sharpe = candidate.get("sharpe")
    min_sharpe = preferences.get("min_sharpe") or 0.0
    if sharpe is not None:
        cap = max(min_sharpe, 0.5) * 2
        if cap > 0:
            sub_scores.append(_clamp((sharpe - min_sharpe) / cap, 0, 1))

    track = candidate.get("track_record_days") or 0
    min_track = preferences.get("min_track_record_days") or 1
    if min_track > 0:
        sub_scores.append(_clamp((track - min_track) / min_track, 0, 1))

    max_dd = candidate.get("max_drawdown_pct")
    max_dd_tol = preferences.get("max_drawdown_tolerance")
    if max_dd is not None and max_dd_tol is not None and max_dd_tol > 0:
        sub_scores.append(_clamp(1 - (abs(max_dd) / max_dd_tol), 0, 1))

    if not sub_scores:
        return 0.5
    return sum(sub_scores) / len(sub_scores)
```

**Deviation:** D-01 says "empty → 1.0" (not 0.5) and each per-dimension contribution short-circuits to 1.0 on NULL. Signature has two extra params (`corr_with_portfolio`, `add_weight`, `mode`) threaded in from the caller (per RESEARCH.md §Codebase Research #1 and Pitfall 11):

```python
def _compute_mandate_fit_score(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    corr_with_portfolio: Optional[float],
    add_weight: float,
    mode: str,
) -> tuple[float, dict[str, float]]:
    """Average of four per-dimension contributions ∈ [0, 1].
    Empty mandates → every contribution is 1.0 → returns 1.0.
    Returns (score, breakdown_dict) for optional score_breakdown.raw.mandate_fit_raw.
    """
    # mw_score = max_weight contribution (D-03 linear taper)
    # cc_score = correlation_ceiling contribution (D-04 smooth degradation)
    # lp_score = liquidity_preference contribution (D-05 tier-gap)
    # se_score = 1.0 (excluded candidates don't reach this function per D-06)
    ...
    return (sum(contribs) / len(contribs), {...})
```

#### Soft exclusion set extension pattern

**Analog (lines 141-146):**

```python
SOFT_EXCLUSION_REASONS = {
    "below_min_sharpe",
    "below_min_track_record",
    "exceeds_max_dd",
    "off_mandate_type",
}
```

**Deviation for D-06:** Add `"style_excluded"`:

```python
SOFT_EXCLUSION_REASONS = {
    "below_min_sharpe",
    "below_min_track_record",
    "exceeds_max_dd",
    "off_mandate_type",
    "style_excluded",  # Phase 3 / D-06
}
```

#### Eligibility check branch insertion pattern

**Analog (lines 188-192):**

```python
pref_types = preferences.get("preferred_strategy_types") or []
if pref_types:
    cand_type = candidate.get("strategy_type")
    if cand_type and cand_type not in pref_types:
        return ("off_mandate_type", cand_type)

return (None, None)
```

**Deviation for D-06:** Insert immediately after the `off_mandate_type` branch. **Critical correction from RESEARCH Pitfall 1:** compare `candidate.get("subtype")` (NOT `strategy_type`) — SUBTYPES and STRATEGY_TYPES are disjoint enums in `src/lib/constants.ts`.

```python
style_exclusions = preferences.get("style_exclusions") or []
if style_exclusions:
    cand_subtype = candidate.get("subtype")
    if cand_subtype and cand_subtype in style_exclusions:
        return ("style_excluded", cand_subtype)

return (None, None)
```

#### Composition insertion pattern (inside `score_candidates`)

**Analog (lines 625-641):**

```python
preference_fit = _compute_preference_fit(cand, prefs)
track_record = _compute_track_record_score(cand)
capacity_fit = _compute_capacity_fit(cand, prefs)

if mode == "personalized":
    final_score = 100 * (
        W_PORTFOLIO_FIT * portfolio_fit
        + W_PREFERENCE_FIT * preference_fit
        + W_TRACK_RECORD * track_record
        + W_CAPACITY_FIT * capacity_fit
    )
else:
    final_score = 100 * (
        W_SCREENING_PREFERENCE_FIT * preference_fit
        + W_SCREENING_TRACK_RECORD * track_record
        + W_SCREENING_CAPACITY_FIT * capacity_fit
    )
```

**Deviation for D-02 + D-08:** Insert mandate composition between `preference_fit` and `final_score`, and apply `scoring_weight_overrides` multiplicative renormalization to the four top-level weights only (D-09: screening weights unaffected):

```python
preference_fit = _compute_preference_fit(cand, prefs)
mandate_fit_score, mandate_fit_raw = _compute_mandate_fit_score(
    cand, prefs, rc["corr_with_portfolio"], add_weight, mode,
)
effective_preference_fit = 0.6 * preference_fit + 0.4 * mandate_fit_score
track_record = _compute_track_record_score(cand)
capacity_fit = _compute_capacity_fit(cand, prefs)

# D-08: multiplicative overrides on the 4 top-level weights, clamp [0.5, 1.5], renormalize
overrides = prefs.get("scoring_weight_overrides") or {}
scaled = {
    "W_PORTFOLIO_FIT": W_PORTFOLIO_FIT * _clamp(overrides.get("W_PORTFOLIO_FIT", 1.0), 0.5, 1.5),
    "W_PREFERENCE_FIT": W_PREFERENCE_FIT * _clamp(overrides.get("W_PREFERENCE_FIT", 1.0), 0.5, 1.5),
    "W_TRACK_RECORD": W_TRACK_RECORD * _clamp(overrides.get("W_TRACK_RECORD", 1.0), 0.5, 1.5),
    "W_CAPACITY_FIT": W_CAPACITY_FIT * _clamp(overrides.get("W_CAPACITY_FIT", 1.0), 0.5, 1.5),
}
total = sum(scaled.values())
assert total > 0  # Pitfall 3 guard — clamp floor of 0.5 × 0.15 = 0.075 means this never fires
effective = {k: v / total for k, v in scaled.items()}

if mode == "personalized":
    final_score = 100 * (
        effective["W_PORTFOLIO_FIT"] * portfolio_fit
        + effective["W_PREFERENCE_FIT"] * effective_preference_fit
        + effective["W_TRACK_RECORD"] * track_record
        + effective["W_CAPACITY_FIT"] * capacity_fit
    )
else:
    # Screening weights are NOT overridable per D-09.
    final_score = 100 * (
        W_SCREENING_PREFERENCE_FIT * effective_preference_fit
        + W_SCREENING_TRACK_RECORD * track_record
        + W_SCREENING_CAPACITY_FIT * capacity_fit
    )
```

#### score_breakdown dict extension pattern

**Analog (lines 643-661):**

```python
score_breakdown: dict[str, Any] = {
    "preference_fit": preference_fit,
    "track_record": track_record,
    "capacity_fit": capacity_fit,
    "raw": {
        "corr_with_portfolio": rc["corr_with_portfolio"],
        "sharpe_lift": rc["sharpe_lift"],
        "dd_improvement": rc["dd_improvement"],
        "track_record_days": cand.get("track_record_days"),
        "manager_aum": cand.get("manager_aum"),
        "ticket_concentration": rc["ticket_concentration"],
        "sharpe": cand.get("sharpe"),
        "max_drawdown_pct": cand.get("max_drawdown_pct"),
    },
}
if mode == "personalized":
    score_breakdown["portfolio_fit"] = portfolio_fit
```

**Deviation for SCORING-02:** Python dict preserves insert order; place `mandate_fit_score` right after `preference_fit` (per CONTEXT.md Claude's Discretion), add `mandate_fit_raw` to `raw`:

```python
score_breakdown: dict[str, Any] = {
    "preference_fit": preference_fit,
    "mandate_fit_score": mandate_fit_score,  # Phase 3 / SCORING-02
    "track_record": track_record,
    "capacity_fit": capacity_fit,
    "raw": {
        # ... existing keys ...
        "mandate_fit_raw": mandate_fit_raw,  # Phase 3 / Q4 recommendation
    },
}
```

#### Version bump pattern

**Analog (lines 45-46):**

```python
ENGINE_VERSION = "v1.0.0"
WEIGHTS_VERSION = "v1.0.0"
```

**Deviation:** Both bump to `"v2.0.0"` in lockstep (Pitfall 6).

---

### `analytics-service/services/match_defaults.py` (MODIFIED — defaults dict)

**Role:** config/defaults, static dict.

**In-file analog:** the existing `DEFAULT_PREFERENCES` dict at lines 9-19 (the extension point itself).

**Analog excerpt (lines 9-19):**

```python
DEFAULT_PREFERENCES: dict[str, Any] = {
    "max_drawdown_tolerance": 0.30,    # 30% — generous
    "min_track_record_days": 180,      # 6 months
    "min_sharpe": 0.5,                 # half a Sharpe
    "target_ticket_size_usd": 50000.0, # $50k typical institutional ticket
    "max_aum_concentration": 0.20,     # 20% of manager AUM
    "preferred_strategy_types": [],    # empty = no filter
    "preferred_markets": [],           # empty = no filter
    "excluded_exchanges": [],          # empty = no exclusions
    "mandate_archetype": None,
}
```

**Deviation for D-10:** Append 5 keys with `None`/`[]` defaults (semantics: `merge_with_defaults` skips `None` values, so first-visit allocators keep empty-mandate behavior per D-01). **`merge_with_defaults` body itself does NOT change** — RESEARCH.md §Codebase Research #3 confirms `test_merge_keeps_default_when_value_is_none` asserts the existing skip-None semantic.

```python
DEFAULT_PREFERENCES: dict[str, Any] = {
    # ... existing 9 keys ...
    # Phase 3 mandate keys (migration 061 + 062 coverage)
    "max_weight": None,
    "correlation_ceiling": None,
    "liquidity_preference": None,
    "style_exclusions": [],
    "scoring_weight_overrides": None,
}
```

---

### `analytics-service/routers/match.py` (MODIFIED — router + skip-logic)

**Role:** router, request-response.

**In-file analog for `_should_skip_allocator`:** lines 349-370 (the function being extended).

#### Skip-logic extension pattern

**Analog excerpt (lines 349-370):**

```python
async def _should_skip_allocator(allocator_id: str, force: bool) -> bool:
    """Skip if last batch is younger than RECOMPUTE_MIN_AGE_HOURS unless forced."""
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

**Deviation for D-11:**
1. Extend SELECT to `"computed_at, engine_version"`.
2. Add a second query against `allocator_preferences.mandate_edited_at`.
3. Check engine_version mismatch → return False BEFORE the age guard.
4. Check mandate_edited_at > computed_at → return False BEFORE the age guard.

```python
async def _should_skip_allocator(allocator_id: str, force: bool) -> bool:
    """D-11 triple check: force OR engine_version mismatch OR mandate_edited_at > computed_at
    → don't skip. Otherwise apply the RECOMPUTE_MIN_AGE_HOURS age guard."""
    if force:
        return False
    supabase = get_supabase()
    result = await asyncio.to_thread(
        lambda: supabase.table("match_batches")
        .select("computed_at, engine_version")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return False
    last_row = rows[0]
    # v1 → v2 cutover (and any future ENGINE_VERSION bump)
    if last_row.get("engine_version") != ENGINE_VERSION:
        return False
    try:
        last_at = datetime.fromisoformat(last_row["computed_at"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    # Mandate-edit timestamp comparison
    prefs_result = await asyncio.to_thread(
        lambda: supabase.table("allocator_preferences")
        .select("mandate_edited_at")
        .eq("user_id", allocator_id)
        .maybe_single()
        .execute()
    )
    prefs = prefs_result.data or {}
    edited_raw = prefs.get("mandate_edited_at")
    if edited_raw:
        try:
            edited_at = datetime.fromisoformat(edited_raw.replace("Z", "+00:00"))
            if edited_at > last_at:
                return False
        except (ValueError, AttributeError):
            pass
    age_hours = (datetime.now(timezone.utc) - last_at).total_seconds() / 3600
    return age_hours < RECOMPUTE_MIN_AGE_HOURS
```

#### Candidate universe SELECT extension pattern

**Analog (lines 89-97 + 136-154):** the `_load_candidate_universe` SELECT string AND the dict-construction block.

```python
strategies_result = (
    supabase.table("strategies")
    .select(
        "id, name, codename, strategy_types, supported_exchanges, "
        "status, aum, max_capacity, user_id, start_date"
    )
    .eq("status", "published")
    .execute()
)
```

```python
# First strategy type as primary
types = strategy.get("strategy_types") or []
primary_type = types[0] if types else None

# First exchange as primary
exchanges = strategy.get("supported_exchanges") or []
primary_exchange = exchanges[0] if exchanges else None

strategies_by_id[sid] = {
    "strategy_id": sid,
    "name": strategy.get("name"),
    # ...
    "strategy_type": primary_type,
    "exchange": primary_exchange,
    # ...
}
```

**Deviation for Pitfall 1 (style_exclusions subtype mismatch):** Add `subtypes` to the SELECT and populate `candidate["subtype"] = subtypes[0] if subtypes else None`:

```python
.select(
    "id, name, codename, strategy_types, subtypes, supported_exchanges, "
    "status, aum, max_capacity, user_id, start_date"
)
```

```python
subtypes = strategy.get("subtypes") or []
primary_subtype = subtypes[0] if subtypes else None

strategies_by_id[sid] = {
    # ...
    "strategy_type": primary_type,
    "subtype": primary_subtype,  # Phase 3 / SCORING-07 — compared to style_exclusions
    # ...
}
```

---

### `analytics-service/services/job_worker.py` (MODIFIED — dispatch handler)

**Role:** worker dispatch, event-driven.

**In-file analog:** the `dispatch()` function at lines 1110-1188 and the `TIMEOUT_PER_KIND` dict at lines 123-131.

#### Dispatch if/elif ladder extension pattern

**Analog (lines 1121-1140):**

```python
async def dispatch(job: dict) -> DispatchResult:
    """...Handler lookup is done via if/elif rather than a dict so that
    monkeypatching the module-level run_*_job functions in tests works
    correctly (a dict captures references at import time, defeating mocks)."""
    kind = job.get("kind")
    timeout = TIMEOUT_PER_KIND.get(kind, 5 * 60)

    if kind == "sync_trades":
        handler = run_sync_trades_job
    elif kind == "compute_analytics":
        handler = run_compute_analytics_job
    elif kind == "compute_portfolio":
        handler = run_compute_portfolio_job
    elif kind == "poll_positions":
        handler = run_poll_positions_job
    elif kind == "sync_funding":
        handler = run_sync_funding_job
    elif kind == "reconcile_strategy":
        handler = run_reconcile_strategy_job
    elif kind == "compute_intro_snapshot":
        handler = run_compute_intro_snapshot_job
    else:
        handler = None
```

**Deviation for D-12 Option B:** Append one `elif` arm for `rescore_allocator`, and add a `TIMEOUT_PER_KIND` entry. Per RESEARCH.md §Domain Research #3 recovery-path-B notes, the handler calls `_score_one_allocator` from `routers/match.py` with `force=True`:

```python
elif kind == "rescore_allocator":
    handler = run_rescore_allocator_job
```

```python
TIMEOUT_PER_KIND: dict[str, float] = {
    # ... existing 7 entries ...
    "rescore_allocator": 5 * 60,  # 5 minutes — one allocator scoring = universe scan + per-candidate compute
}
```

**New handler function** (new top-level async def — place near the other `run_*_job` handlers; exact file position is planner's call but keep with compute_intro_snapshot / portfolio handlers):

```python
async def run_rescore_allocator_job(job: dict) -> DispatchResult:
    """Handler for D-12 proactive-rescore jobs enqueued from update_allocator_mandates RPC.
    Calls _score_one_allocator with force=True — the enqueue itself is the intent signal."""
    from routers.match import _load_candidate_universe, _score_one_allocator
    allocator_id = job.get("allocator_id")
    if not allocator_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind="permanent",
            error_message="rescore_allocator job missing allocator_id",
        )
    universe = await asyncio.to_thread(_load_candidate_universe)
    if not universe["strategies_by_id"]:
        return DispatchResult(outcome=DispatchOutcome.DONE)  # No-op if universe empty
    await _score_one_allocator(allocator_id, universe)
    return DispatchResult(outcome=DispatchOutcome.DONE)
```

#### Strategy-scoped bridge skip pattern

**Analog (lines 1172-1187):**

```python
# UI status bridge: after every strategy-scoped job, derive the UI
# status from the compute_jobs aggregate and write it into
# strategy_analytics.computation_status. Portfolio jobs skip the bridge.
strategy_id = job.get("strategy_id")
if strategy_id:
    try:
        await sync_strategy_analytics_status(strategy_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "sync_strategy_analytics_status failed for strategy %s: %s",
            strategy_id, exc,
        )
```

**Deviation:** Already correct for `rescore_allocator` — the `if strategy_id:` guard means allocator-scoped jobs skip the bridge naturally. No change needed to this block.

---

### `analytics-service/tests/test_match_engine.py` (MODIFIED — 20 new tests)

**Role:** test (unit).

**In-file analog:** existing `test_determinism` (line 355), `test_engine_version_is_set` (line 533), `_make_candidate` (line 30), `_make_returns_series` (line 50).

#### Fixture extension pattern

**Analog (lines 30-47):**

```python
def _make_candidate(
    strategy_id: str = "s1",
    sharpe: float = 1.5,
    track_record_days: int = 365,
    max_drawdown_pct: float = -0.15,
    manager_aum: float | None = 5_000_000,
    exchange: str = "binance",
    strategy_type: str = "trend_following",
) -> dict[str, Any]:
    return {
        "strategy_id": strategy_id,
        "sharpe": sharpe,
        "track_record_days": track_record_days,
        "max_drawdown_pct": max_drawdown_pct,
        "manager_aum": manager_aum,
        "exchange": exchange,
        "strategy_type": strategy_type,
    }
```

**Deviation for Pitfall 1:** Add `subtype: str | None = None` kwarg. Per RESEARCH.md §Codebase Research #4 the kwarg default should be a valid SUBTYPES value (e.g. `"Mean Reversion"`) OR `None`. Lean `None` default and require tests to pass subtype explicitly:

```python
def _make_candidate(
    # ... existing kwargs ...
    subtype: str | None = None,
) -> dict[str, Any]:
    return {
        # ... existing keys ...
        "subtype": subtype,
    }
```

#### Determinism / JSON pattern (reused for golden snapshot)

**Analog (lines 355-369):**

```python
def test_determinism():
    """Same inputs → byte-identical JSON output."""
    candidates = [_make_candidate(f"s{i}") for i in range(5)]
    args = dict(
        allocator_id="a1",
        preferences={},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    r1 = score_candidates(**args)
    r2 = score_candidates(**args)
    assert to_canonical_json(r1) == to_canonical_json(r2)
```

**Deviation for D-15 #16 and #20:** Extend `args` to include a fully-specified mandate in `preferences` (so determinism covers the new mandate path too) AND add `test_v1_to_v2_golden_snapshot` using the pattern documented in RESEARCH.md §Codebase Research #4 (file-based comparison with `REGENERATE_GOLDEN=1` env-var escape hatch).

#### Engine version assertion pattern

**Analog (lines 533-535):**

```python
def test_engine_version_is_set():
    assert ENGINE_VERSION
    assert WEIGHTS_VERSION
```

**Deviation for Pitfall 6 / D-15 #18:** Tighten to equality on `"v2.0.0"`:

```python
def test_engine_version_bumped():
    assert ENGINE_VERSION == "v2.0.0"
    assert WEIGHTS_VERSION == "v2.0.0"
```

#### Twenty-test extension shape

All 20 tests in D-15 follow the same bare-def style (no class wrapping, no decorators — the file has no `pytest.mark.asyncio` usage). Names map 1:1 to VALIDATION.md Wave 0 rows (`test_mandate_fit_key_present`, `test_max_weight_*`, `test_correlation_ceiling_*`, `test_liquidity_*`, `test_style_exclud_*`, `test_empty_mandates_fit_score_one`, `test_weight_overrides_*`, `test_determinism`, `test_golden_snapshot`). Each test uses `_make_candidate` + `_make_returns_series` + `score_candidates(**args)` + direct assertion on `result["candidates"][i]["score_breakdown"]` or `result["excluded"]`.

---

### `analytics-service/tests/test_match_defaults.py` (MODIFIED — 5 new default-key stubs)

**Role:** test (unit).

**In-file analog:** existing `test_merge_keeps_default_when_value_is_none` at lines 23-26.

**Analog excerpt (full file lines 6-44):**

```python
def test_merge_with_none_returns_defaults():
    result = merge_with_defaults(None)
    assert result == DEFAULT_PREFERENCES
    assert result is not DEFAULT_PREFERENCES  # is a copy, not a reference


def test_merge_keeps_default_when_value_is_none():
    """A None value in prefs should NOT override the default — fields are nullable."""
    result = merge_with_defaults({"min_sharpe": None})
    assert result["min_sharpe"] == DEFAULT_PREFERENCES["min_sharpe"]


def test_merge_handles_array_overrides():
    result = merge_with_defaults({"excluded_exchanges": ["bybit"]})
    assert result["excluded_exchanges"] == ["bybit"]
```

**Deviation for D-10 keys:** Add 5 stub tests asserting each new key has the right default:

```python
def test_default_includes_max_weight_none():
    assert "max_weight" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["max_weight"] is None


def test_default_includes_correlation_ceiling_none():
    assert "correlation_ceiling" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["correlation_ceiling"] is None


def test_default_includes_liquidity_preference_none():
    assert "liquidity_preference" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["liquidity_preference"] is None


def test_default_includes_style_exclusions_empty_list():
    assert "style_exclusions" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["style_exclusions"] == []


def test_default_includes_scoring_weight_overrides_none():
    assert "scoring_weight_overrides" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["scoring_weight_overrides"] is None
```

---

### `src/lib/admin/match.ts` (MODIFIED — ts-const schema sync)

**Role:** ts-const (server-only schema-sync contract).

**In-file analog:** the existing `ALLOCATOR_PREFERENCES_COLUMNS` literal at lines 34-40.

**Analog excerpt (lines 34-40):**

```typescript
export const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, edited_by_user_id, updated_at, " +
  // Phase 2 mandate fields (migration 061)
  "max_weight, correlation_ceiling, liquidity_preference, style_exclusions, mandate_edited_at";
```

**Deviation for Phase 3 schema-sync contract:** Append `", scoring_weight_overrides"` with a new comment line marking migration 062:

```typescript
export const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, edited_by_user_id, updated_at, " +
  // Phase 2 mandate fields (migration 061)
  "max_weight, correlation_ceiling, liquidity_preference, style_exclusions, mandate_edited_at, " +
  // Phase 3 (migration 062)
  "scoring_weight_overrides";
```

---

### `src/lib/preferences.ts` (MODIFIED — ts-type interface)

**Role:** ts-type (server-only type definition).

**In-file analog:** the `AllocatorPreferences` interface at lines 17-39.

**Analog excerpt (lines 17-39):**

```typescript
export interface AllocatorPreferences {
  user_id: string;
  // Self-editable (v1)
  mandate_archetype: string | null;
  target_ticket_size_usd: number | null;
  excluded_exchanges: string[] | null;
  // Admin-only (not exposed via the self-edit API)
  max_drawdown_tolerance: number | null;
  min_track_record_days: number | null;
  min_sharpe: number | null;
  max_aum_concentration: number | null;
  preferred_strategy_types: string[] | null;
  preferred_markets: string[] | null;
  founder_notes: string | null;
  edited_by_user_id: string | null;
  updated_at: string;
  // Phase 2 — mandate columns (migration 061)
  max_weight: number | null;
  correlation_ceiling: number | null;
  liquidity_preference: "high" | "medium" | "low" | null;
  style_exclusions: string[] | null;
  mandate_edited_at: string | null;
}
```

**Deviation for Phase 3:** Append one field with the multiplicative-override shape (D-08). **Do NOT** extend `SELF_EDITABLE_PREFERENCE_FIELDS` — Phase 4 writes to this field from the feedback engine, not the allocator-facing mandate form.

```typescript
export interface AllocatorPreferences {
  // ... existing fields ...
  mandate_edited_at: string | null;
  // Phase 3 — scoring weight overrides (migration 062)
  scoring_weight_overrides: Record<string, number> | null;
}
```

---

### `src/__tests__/mandate-columns-schema-sync.test.ts` (MODIFIED — one new assertion)

**Role:** test (vitest, schema-sync regression guard).

**In-file analog:** lines 42-47 (the existing 6 `.has()` assertions).

**Analog excerpt (lines 40-48):**

```typescript
describe("MANDATE-07: allocator_preferences schema sync", () => {
  it("ALLOCATOR_PREFERENCES_COLUMNS (imported from @/lib/admin/match) contains all Phase 2 mandate columns + edited_by_user_id correction", () => {
    expect(EXPECTED_COLUMNS_SET.has("max_weight")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("correlation_ceiling")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("liquidity_preference")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("style_exclusions")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("mandate_edited_at")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("edited_by_user_id")).toBe(true);
  });
```

**Deviation:** Add one assertion; keep the existing test block. The test name could be updated to mention "+ scoring_weight_overrides for Phase 3" but the minimum-diff path is to add the new `.has()` line:

```typescript
    expect(EXPECTED_COLUMNS_SET.has("edited_by_user_id")).toBe(true);
    // Phase 3 (migration 062)
    expect(EXPECTED_COLUMNS_SET.has("scoring_weight_overrides")).toBe(true);
```

The live-DB layer at lines 50-72 auto-covers the new column (it does a projection select against the full `ALLOCATOR_PREFERENCES_COLUMNS` string — PostgREST 400s on unknown columns), so no additional test scaffolding is needed.

---

## Shared Patterns

### Self-verifying DO block with RAISE NOTICE terminator

**Sources:** `supabase/migrations/061_mandate_columns.sql:222-280`, `supabase/migrations/048_contact_request_metadata.sql:166-275`

**Apply to:** migration 062

Every shipped migration in this project ends with a `DO $$ ... $$;` block that asserts each created schema object exists, and `RAISE NOTICE` on success. The CI/deploy pipeline greps for "Migration NNN: ... verified" in stdout to gate merges.

### Mocked Supabase chain assertion

**Sources:** `analytics-service/tests/test_daily_enqueue_lock.py:28-45`, RESEARCH.md §Test Infrastructure

**Apply to:** `test_match_integration.py` (skip-logic tests + proactive-enqueue assertions)

`MagicMock()` with `.side_effect` or chain-method mocking; `monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)` is the injection seam for router tests. `pytest.ini` has `asyncio_mode = auto` so `async def test_*` works without decorators.

### AsyncMock handler dispatch

**Sources:** `analytics-service/tests/test_job_worker.py:146-225` (all routing tests)

**Apply to:** `test_match_integration.py` rescore_allocator dispatch test

`with patch("services.job_worker.run_<kind>_job", new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)))` is the template. The `sync_strategy_analytics_status` patch is only needed for strategy-scoped jobs — assert `mock_bridge.assert_not_called()` for allocator-scoped ones.

### Schema-sync TS const ↔ Supabase migration

**Sources:** `src/lib/admin/match.ts:34-40`, `src/lib/preferences.ts:17-39`, `src/__tests__/mandate-columns-schema-sync.test.ts:40-48`

**Apply to:** every migration touching `allocator_preferences`

Three-touch pattern per Phase 3:
1. Append column name to `ALLOCATOR_PREFERENCES_COLUMNS` literal.
2. Append field to `AllocatorPreferences` interface.
3. Append `.has(column_name)` assertion to the schema-sync test.

The live-DB layer auto-verifies via `.select(ALLOCATOR_PREFERENCES_COLUMNS).limit(0)` — PostgREST 400s on unknown columns.

### Python type-hints + `from __future__ import annotations`

**Sources:** `analytics-service/services/job_worker.py:36`, `analytics-service/services/scheduled_tasks.py:24`

**Apply to:** new `test_match_integration.py` only (the rest of the Phase 3 files either already have it or don't need it — `match_engine.py` uses `from typing import Any, Optional` directly).

### Hard vs soft eligibility split with relaxation branch

**Source:** `analytics-service/services/match_engine.py:141-146` (sets) + `:487-516` (relaxation branch)

**Apply to:** D-06 `style_excluded` addition — must go in `SOFT_EXCLUSION_REASONS` set AND the relaxation branch's `_eligibility_check_hard_only` (lines 197-213) must NOT check style_exclusions (so the relax pass drops the filter — same as `preferred_strategy_types` at line 494).

### Python dict insertion-order preservation for JSON snapshots

**Source:** `analytics-service/services/match_engine.py:643-657` (existing `score_breakdown` dict construction); `to_canonical_json` at line 740 uses `sort_keys=True` so on-disk snapshots are key-sorted regardless.

**Apply to:** mandate_fit_score placement in score_breakdown dict — insertion order matters for debugger readability and test introspection, but final JSON output is `sort_keys`-sorted so determinism is independent of insertion order.

### `_clamp` helper reuse

**Source:** `analytics-service/services/match_engine.py:86-87`

```python
def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))
```

**Apply to:** `_compute_mandate_fit_score` internals (D-03 max_weight taper uses `max(0, ...)` which is equivalent to `_clamp(..., 0.0, 1.0)`) AND the D-08 weight-override clamp (`_clamp(override, 0.5, 1.5)`).

---

## No Analog Found

No Phase 3 file lacks an analog. All 11 files either extend existing code in-place (8 modified files — the analog IS the file itself) or compose existing patterns (3 created files). The migration 062 is the heaviest composition (5 distinct existing migration patterns woven together), but each pattern has a strong precedent.

**One partial-coverage caveat:** the RPC-body `PERFORM enqueue_compute_job` inside `update_allocator_mandates` (Pattern E above) does not have an exact analog in the current codebase — no migration currently triggers a compute_jobs enqueue from inside another SECURITY DEFINER RPC body. The closest is `scheduled_tasks.py:39-58` which does the same call shape from Python, not SQL. Planner should note this as a minor elevation in architectural risk and double-check the transactional semantics (the PERFORM lives inside the same transaction as the UPSERT — a rollback cleans up both, which is the desired behavior per CONTEXT.md D-12 Option B step 8 ordering note).

---

## Metadata

- **Analog search scope:** `supabase/migrations/` (12 migrations read), `analytics-service/services/` (4 services), `analytics-service/routers/` (1 router), `analytics-service/tests/` (5 test files), `src/lib/` (2 modules), `src/__tests__/` (1 schema-sync test).
- **Files read during mapping:** 14 source files (match_engine.py, match_defaults.py, routers/match.py, job_worker.py, scheduled_tasks.py, test_match_engine.py, test_match_defaults.py, test_daily_enqueue_lock.py, test_job_worker.py, admin/match.ts, preferences.ts, mandate-columns-schema-sync.test.ts, migrations 032/036/048/061).
- **Pattern extraction date:** 2026-04-18.
- **Valid until:** 2026-05-18 (assumes no major refactor to `compute_jobs` schema or `match_engine.py` core).

## PATTERN MAPPING COMPLETE
