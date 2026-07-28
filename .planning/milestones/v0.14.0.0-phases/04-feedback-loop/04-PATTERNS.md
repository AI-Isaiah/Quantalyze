# Phase 04: Feedback Loop — Pattern Map

**Mapped:** 2026-04-18
**Plans:** 04-01 (feedback_engine + routers/match.py wiring + migration 063 + tests)
**Files analyzed:** 5 (4 created, 1 modified)
**Analogs found:** 5 / 5 (100% — every file has a direct, line-verified analog in the current codebase)

---

## File Classification

| New/Modified | File | Role | Data Flow | Closest Analog | Match Quality |
|--------------|------|------|-----------|----------------|---------------|
| **Created** | `analytics-service/services/feedback_engine.py` | pure-function scoring/feedback module with persistence side-effect | request-response + CRUD | `analytics-service/services/match_engine.py` (module shape) + `analytics-service/services/audit.py` (fire-and-forget side-effect) | role-match (composite — compute + UPDATE + audit) |
| **Created** | `analytics-service/tests/test_feedback_engine.py` | test (unit + integration) | n/a | `analytics-service/tests/test_match_engine.py` (fixture + golden-snapshot patterns) + `analytics-service/tests/test_match_integration.py` (try/except ImportError + IMPORTS_OK sentinel + mocked Supabase chains) | role-match (composite — two-file union) |
| **Created** | `analytics-service/tests/fixtures/feedback_engine_v1_golden.json` | test fixture | static JSON | `analytics-service/tests/fixtures/match_engine_v2_golden.json` (only fixture in the dir) | exact |
| **Created** | `supabase/migrations/063_feedback_delta_enqueue.sql` | migration — CREATE OR REPLACE pure SQL function body amendment | — | `supabase/migrations/062_scoring_weight_overrides.sql` (specifically `update_allocator_mandates` at lines 372-471 — same `CREATE OR REPLACE` + trailing `PERFORM enqueue_compute_job(..., p_allocator_id := ...)` pattern) + `supabase/migrations/060_bridge_outcome_cron.sql` (the function being replaced, lines 164-217) | exact (composite — replace + enqueue) |
| **Modified** | `analytics-service/routers/match.py` | router (inline feedback seam) | request-response | (itself — surgical 3-line insert at line 259, between `_load_allocator_context` and `score_candidates`; lazy-import precedent = `services/job_worker.py::run_rescore_allocator_job` line 1123) | self (in-place extension) |

---

## Pattern Assignments

### `analytics-service/services/feedback_engine.py` (NEW — pure-function module + persistence side-effect)

**Purpose:** Single public entry `compute_adjusted_weights(allocator_id) -> dict[str, float]`. Reads `bridge_outcomes` + `match_candidates.score_breakdown`, attributes each outcome to one of four top-level dimensions (D-05 hybrid), computes per-dimension `success_rate`, applies the D-13 step function, writes to `allocator_preferences.scoring_weight_overrides`, emits an audit event, and returns the dict.

Composed from four line-verified analogs — no single file supplies the whole shape. The planner assembles them.

#### Pattern A — Module docstring + typed constants + private helpers + one public entry

**Analog:** `analytics-service/services/match_engine.py` lines 1-19 (module docstring), 21-47 (imports + version constants), 55-68 (module-level constants), 76-88 (private helpers `_safe_float`, `_clamp`), 549-853 (the single public `score_candidates` orchestrating the whole file).

Module header excerpt (`match_engine.py:1-23`):

```python
"""Perfect Match Engine — scores quant strategies for each allocator.

Founder-amplifier model (see docs/superpowers/plans/2026-04-07-perfect-match-engine.md):
this module produces a ranked candidate list that ONLY the founder admin sees in
/admin/match. Allocators never see the score directly — the founder picks 3 candidates
per allocator and ships them via the existing intro flow.

Key design decisions baked in from the dual-voice eng review:
- Hard vs soft eligibility split: hard exclusions (owned, thumbs_down, excluded_exchange)
  are NEVER relaxed; soft exclusions (sharpe, track, dd) get relaxed when <5 candidates.
...
"""

import json
import math
from typing import Any, Optional

import numpy as np
import pandas as pd
```

Module constants block (`match_engine.py:43-68`):

```python
# Versioning for the engine + weight set. Bump on any change to the scoring math
# so historical batches are reproducible / debuggable. Phase 3 bumps both to
# v2.0.0 in lockstep — SCORING-01.
ENGINE_VERSION = "v2.0.0"
WEIGHTS_VERSION = "v2.0.0"

# Top-N candidates returned per batch
TOP_N_CANDIDATES = 30
# ...
# Weights for the personalized score
W_PORTFOLIO_FIT = 0.40
W_PREFERENCE_FIT = 0.30
W_TRACK_RECORD = 0.15
W_CAPACITY_FIT = 0.15
```

Helper signature pattern (`match_engine.py:234-263`):

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
    # ... two more sub-scores ...
    if not sub_scores:
        return 0.5
    return sum(sub_scores) / len(sub_scores)
```

**Deviation for `feedback_engine.py`:**

- Module docstring cites Phase 4 CONTEXT.md D-01 through D-16 and names FEEDBACK-01 through FEEDBACK-06. The "Founder-amplifier" preamble becomes "Feedback-loop closer — reads `bridge_outcomes`, writes `scoring_weight_overrides`, returns the dict for inline use inside `_score_one_allocator`."
- Module-level constants mirror `match_engine.py`'s style:
  ```python
  REJECTION_REASON_TO_DIMENSION: dict[str, str] = {
      "mandate_conflict": "W_PREFERENCE_FIT",
      "underperforming_peers": "W_TRACK_RECORD",
      "timing_wrong": "W_PORTFOLIO_FIT",
      # 'already_owned' excluded per D-08 filter #1
      # 'other' falls through to score-dominant rule (D-06)
  }
  MIN_OUTCOMES_PER_DIMENSION = 5   # D-15
  SCALE_FLOOR = 0.5                # D-13
  SCALE_CEILING = 1.5              # D-13
  RATE_FLOOR_THRESHOLD = 0.4       # D-13
  RATE_CEILING_THRESHOLD = 0.7     # D-13
  ALL_DIMENSIONS: tuple[str, ...] = (
      "W_PORTFOLIO_FIT", "W_PREFERENCE_FIT", "W_TRACK_RECORD", "W_CAPACITY_FIT",
  )
  ```
- Re-use `_clamp` semantically; **do NOT reimport it** — instead, keep the final scale-value write honest by using the literal constants (`SCALE_FLOOR`, `SCALE_CEILING`) since the step function produces exactly two values. No clamp needed at the write; match_engine clamps again defensively at line 770.
- Helper decomposition — mid-sized private functions, one public orchestrator. Lean toward four privates: `_fetch_eligible_outcomes`, `_fetch_score_breakdowns`, `_attribute_dimension`, `_success_value`. Plus the public `compute_adjusted_weights` that orchestrates.

#### Pattern B — Supabase service-role query + UPDATE from analytics-service

**Analog:** `analytics-service/routers/match.py:87, 172-180, 280`. The service-role client is obtained via `get_supabase()` (from `services.db`), used synchronously, and consumed inside `asyncio.to_thread` at call sites that need to be non-blocking.

Query excerpt (`routers/match.py:172-185`):

```python
def _load_allocator_context(allocator_id: str) -> dict[str, Any]:
    """Load per-allocator data: preferences, portfolio, thumbs-down history."""
    supabase = get_supabase()

    # Preferences
    prefs_result = supabase.table("allocator_preferences").select("*").eq(
        "user_id", allocator_id
    ).maybe_single().execute()
    preferences = prefs_result.data
```

Two-query (rejected + allocated) pattern with filter chains (`routers/match.py:89-98, 182-208`):

```python
strategies_result = (
    supabase.table("strategies")
    .select("id, name, codename, strategy_types, subtypes, supported_exchanges, "
            "status, aum, max_capacity, user_id, start_date")
    .eq("status", "published")
    .execute()
)
strategies = strategies_result.data or []
```

UPDATE shape is not currently used in this router, but the `match_batches` INSERT at `routers/match.py:297-302` shows the `.table(...).insert(...).execute()` pattern + the `if not batch_insert.data: raise RuntimeError(...)` result check.

**Deviation for `feedback_engine.py`:**

Per RESEARCH Pitfall 5 — DO NOT use supabase-py's `.or_()` chain for the three-delta-non-NULL filter. Use two simpler queries + Python-side D-03 filter:

```python
def _fetch_eligible_outcomes(allocator_id: str) -> list[dict[str, Any]]:
    """D-08 noise filtering: exclude already_owned, percent_allocated<1.0, pending."""
    supabase = get_supabase()
    rejected = (
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "rejected")
        .neq("rejection_reason", "already_owned")       # D-08 filter #1
        .execute()
    ).data or []

    allocated = (
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "allocated")
        .gte("percent_allocated", 1.0)                   # D-08 filter #2
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

UPDATE-with-silent-no-op pattern (Pitfall 7 — Option A):

```python
def _persist_overrides(allocator_id: str, overrides: Optional[dict[str, float]]) -> None:
    supabase = get_supabase()
    result = supabase.table("allocator_preferences").update({
        "scoring_weight_overrides": overrides,          # D-16: None when empty → NULL
    }).eq("user_id", allocator_id).execute()
    if not result.data:
        logger.debug(
            "feedback_engine: no allocator_preferences row for %s; "
            "overrides computed but not persisted", allocator_id,
        )
```

**Critical:** Do NOT call `asyncio.to_thread` inside `feedback_engine.py` — the function is synchronous by design (follows `_load_allocator_context` precedent). The caller (`_score_one_allocator`) wraps it via `asyncio.to_thread` at the seam, per pattern C.

#### Pattern C — Fire-and-forget audit emission

**Analog:** `analytics-service/services/audit.py` — the entire file (lines 1-130). This is the canonical Python-side audit path for analytics-service; calls `log_audit_event_service` RPC (migration 058, service-role gated).

Full call-shape excerpt (`audit.py:56-120`):

```python
def log_audit_event(
    user_id: str | UUID,
    action: str,
    entity_type: str,
    entity_id: str | UUID,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget audit event.

    Calls `log_audit_event_service` with the caller-supplied user_id.
    Swallows all RPC errors; never raises to the caller.
    """
    if user_id is None:
        logger.error("[audit] log_audit_event called with NULL user_id ...")
        return

    uid = str(user_id)
    # ...
    try:
        supabase = get_supabase()
        supabase.rpc(
            "log_audit_event_service",
            {
                "p_user_id": uid,
                "p_action": action,
                "p_entity_type": entity_type,
                "p_entity_id": eid,
                "p_metadata": payload,
            },
        ).execute()
    except Exception as exc:  # pragma: no cover - defensive swallow
        logger.error("[audit] log_audit_event_service call threw (dropping): ...")
```

Typical call site (`audit.py:30-39`):

```python
log_audit_event(
    user_id=req.user_id,
    action="bridge.score_candidates",
    entity_type="bridge_run",
    entity_id=req.portfolio_id,
    metadata={
        "underperformer_strategy_id": req.underperformer_strategy_id,
        "candidate_count": len(candidates),
    },
)
```

**Deviation for `feedback_engine.py`:**

Lean YES on audit emission (Claude's Discretion in CONTEXT.md + RESEARCH Open Question 3 recommendation). Emit only on successful UPDATE (i.e., after `_persist_overrides` returns and `result.data` was non-empty):

```python
log_audit_event(
    user_id=allocator_id,
    action="feedback.overrides_updated",
    entity_type="allocator_preference_feedback",
    entity_id=allocator_id,
    metadata={
        "dimensions_updated": list(overrides.keys()) if overrides else [],
        "engine_version": "v1",   # feedback rule format version
    },
)
```

Planner note: `action="feedback.overrides_updated"` and `entity_type="allocator_preference_feedback"` are NEW taxonomy values. Per ADR-0023 these should be added to `src/lib/audit.ts` `AuditAction` + `AuditEntityType` unions. This is strictly additive and does NOT require a DB migration (audit_log has no CHECK on action/entity_type text).

**Gotcha:** The `auth.users` row may not exist for a cron-triggered `allocator_id` if the allocator was deleted; the audit RPC will raise, be caught, and logged at ERROR with the `[audit]` prefix. Expected and safe per the fire-and-forget contract.

#### Pattern D — Main orchestration function — public entry

**Analog:** `analytics-service/services/match_engine.py::score_candidates` (lines 549-853) — the single public entry-point that coordinates the private helpers, handles edge cases, returns a dict.

Signature pattern (`match_engine.py:549-574`):

```python
def score_candidates(
    allocator_id: str,
    preferences: Optional[dict[str, Any]],
    # ... seven more kwargs ...
) -> dict[str, Any]:
    """Score every candidate strategy for an allocator. See module docstring.

    Returns a dict with shape:
    {
      "mode": "personalized" | "screening",
      ...
    }
    """
    prefs = merge_with_defaults(preferences or {})
    # ...
```

Empty-result short-circuit (`match_engine.py:641-653`):

```python
# If still empty, return empty
if not eligible:
    return {
        "mode": mode,
        "filter_relaxed": filter_relaxed,
        # ...
        "candidates": [],
        "excluded": _serialize_excluded(_top_excluded(excluded, prefs)),
        # ...
    }
```

**Deviation for `compute_adjusted_weights`:**

```python
def compute_adjusted_weights(allocator_id: str) -> dict[str, float]:
    """Phase 4 feedback engine public entry point.

    Reads bridge_outcomes + match_candidates.score_breakdown for this
    allocator, attributes each outcome to one of four top-level
    dimensions (D-05 hybrid), computes success_rate per dimension,
    applies the D-13 step function, and returns + persists the overrides.

    Returns a dict of {W_i: scale} for dimensions with >=5 attributed
    outcomes (per D-15). Dimensions below threshold are OMITTED (D-16).
    An allocator with zero eligible outcomes returns {} and writes NULL
    to the column.

    Side effects:
      - UPDATEs allocator_preferences.scoring_weight_overrides (D-10).
      - Emits audit event on successful UPDATE (action='feedback.overrides_updated').
    """
    outcomes = _fetch_eligible_outcomes(allocator_id)
    if not outcomes:
        _persist_overrides(allocator_id, None)  # D-16: empty -> NULL
        return {}
    # ... attribute, compute rates, apply shape ...
    _persist_overrides(allocator_id, result or None)
    return result
```

**Critical:** The empty-result branch MUST still call `_persist_overrides(allocator_id, None)` to clear a previously non-NULL column value for an allocator whose signal has regressed. RESEARCH Pitfall 7 applies (silent no-op if row doesn't exist — acceptable).

---

### `analytics-service/tests/test_feedback_engine.py` (NEW — 18-22 tests + golden snapshot)

**Purpose:** Unit + integration tests for `compute_adjusted_weights` and helpers. Two analogs supply the full pattern.

#### Pattern 1 — `try/except ImportError` + `IMPORTS_OK` sentinel for Wave 0 red-scaffold

**Analog:** `analytics-service/tests/test_match_integration.py:14-31` — the canonical Wave 0 guard pattern from Phase 3.

Full excerpt (`test_match_integration.py:14-31`):

```python
# Wave 0: these imports may fail if Wave 1 hasn't run yet. Guard so the
# file still collects and the specific tests skip cleanly.
try:
    from routers.match import _should_skip_allocator, ENGINE_VERSION
    from services.job_worker import (
        DispatchOutcome,
        DispatchResult,
        dispatch,
    )
    IMPORTS_OK = True
except ImportError:
    _should_skip_allocator = None  # type: ignore
    ENGINE_VERSION = "v2.0.0"       # sentinel; real value arrives in Wave 1
    dispatch = None                  # type: ignore
    DispatchOutcome = None           # type: ignore
    DispatchResult = None            # type: ignore
    IMPORTS_OK = False
```

Per-test guard (`test_match_integration.py:41-42`):

```python
async def test_skip_force_and_fresh(monkeypatch):
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder — imports not ready")
```

**Deviation for `test_feedback_engine.py`:**

```python
try:
    from services.feedback_engine import (
        compute_adjusted_weights,
        REJECTION_REASON_TO_DIMENSION,
        MIN_OUTCOMES_PER_DIMENSION,
        SCALE_FLOOR,
        SCALE_CEILING,
        ALL_DIMENSIONS,
    )
    IMPORTS_OK = True
except ImportError:
    compute_adjusted_weights = None  # type: ignore
    REJECTION_REASON_TO_DIMENSION = {}  # type: ignore
    MIN_OUTCOMES_PER_DIMENSION = 5
    SCALE_FLOOR = 0.5
    SCALE_CEILING = 1.5
    ALL_DIMENSIONS = (
        "W_PORTFOLIO_FIT", "W_PREFERENCE_FIT", "W_TRACK_RECORD", "W_CAPACITY_FIT",
    )
    IMPORTS_OK = False
```

#### Pattern 2 — Mocked Supabase chain with monkeypatch

**Analog:** `analytics-service/tests/test_match_integration.py:50-55` — the `.table.return_value.select.return_value.eq.return_value.(...).execute.return_value` MagicMock chain.

Full excerpt (`test_match_integration.py:50-57`):

```python
mock_sb = MagicMock()
mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
    MagicMock(data=[{"computed_at": one_hour_ago, "engine_version": ENGINE_VERSION}])
mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = \
    MagicMock(data={"mandate_edited_at": two_hours_ago})
monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

result = await _should_skip_allocator("alloc-1", force=False)
```

**Deviation for `test_feedback_engine.py`:**

Tests patch `services.feedback_engine.get_supabase` (not `routers.match.get_supabase`) — because the feedback engine has its own `get_supabase()` import. Mock two query chains: `bridge_outcomes` (twice — rejected + allocated filters) and `match_candidates` (for score_breakdown lookup), plus the `.update().eq().execute()` chain on `allocator_preferences`:

```python
def test_persist_column(monkeypatch):
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    mock_sb = MagicMock()
    # bridge_outcomes rejected query — returns 5 mandate_conflict rows
    # bridge_outcomes allocated query — returns 5 rows with positive delta_90d
    # match_candidates query — returns score_breakdown stubs
    # allocator_preferences update — returns non-empty data
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value = \
        MagicMock(data=[{"user_id": "alloc-1"}])
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)

    result = compute_adjusted_weights("alloc-1")
    # Assert UPDATE called with the expected JSONB shape
    update_call = mock_sb.table.return_value.update.call_args
    assert "scoring_weight_overrides" in update_call[0][0]
```

Per-test helper to build a bridge_outcomes row (mirrors `_make_candidate` from `test_match_engine.py:49-68`):

```python
def _make_outcome(
    strategy_id: str = "strat-1",
    kind: str = "allocated",
    percent_allocated: float | None = 10.0,
    rejection_reason: str | None = None,
    delta_180d: float | None = 0.05,
    delta_90d: float | None = None,
    delta_30d: float | None = None,
) -> dict:
    return {
        "strategy_id": strategy_id,
        "kind": kind,
        "percent_allocated": percent_allocated,
        "rejection_reason": rejection_reason,
        "delta_180d": delta_180d,
        "delta_90d": delta_90d,
        "delta_30d": delta_30d,
    }
```

#### Pattern 3 — Golden snapshot test with `REGENERATE_GOLDEN=1` escape hatch

**Analog:** `analytics-service/tests/test_match_engine.py:1020-1055` — the canonical golden-snapshot test.

Full excerpt (`test_match_engine.py:1020-1055`):

```python
def test_v1_to_v2_golden_snapshot():
    """Frozen v2.0.0 output for a deterministic 3-candidate universe. Catches
    accidental math drift across future refactors. Regenerate via
    REGENERATE_GOLDEN=1 pytest tests/test_match_engine.py::test_v1_to_v2_golden_snapshot.
    """
    candidates = [
        _make_candidate(f"s{i}", sharpe=1.0 + i * 0.1, subtype="Mean Reversion")
        for i in range(3)
    ]
    args = dict(
        allocator_id="a1",
        preferences={
            "max_weight": 0.10,
            "correlation_ceiling": 0.5,
            "liquidity_preference": "high",
            "style_exclusions": [],
            "scoring_weight_overrides": None,
        },
        # ...
    )
    result = score_candidates(**args)
    actual = to_canonical_json(result)
    expected_path = FIXTURES_DIR / "match_engine_v2_golden.json"
    if os.environ.get("REGENERATE_GOLDEN"):
        expected_path.write_text(actual + "\n")
        pytest.skip(
            "Regenerated golden fixture — re-run without REGENERATE_GOLDEN to assert"
        )
    expected = expected_path.read_text().strip()
    assert actual == expected, (
        "Golden snapshot drift — regen via REGENERATE_GOLDEN=1 if math change is intentional"
    )
```

`FIXTURES_DIR` anchor (`test_match_engine.py:41`):

```python
FIXTURES_DIR = Path(__file__).parent / "fixtures"
```

**Deviation for `test_feedback_engine.py::test_golden_snapshot`:**

- The test needs NO `score_candidates` invocation — it seeds mocked Supabase with a deterministic 12-outcome allocator history (per CONTEXT.md Specifics flow) + deterministic `match_candidates.score_breakdown` fixtures, then calls `compute_adjusted_weights("test-allocator")`.
- The golden JSON is the `{W_i: scale}` output dict — flat and small (at most 4 keys).
- No `to_canonical_json` helper needed — `json.dumps(result, sort_keys=True)` inline is enough for this shape.

```python
def test_golden_snapshot(monkeypatch):
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # Seed deterministic outcomes + match_candidates
    # ... monkeypatch.setattr("services.feedback_engine.get_supabase", ...) ...

    result = compute_adjusted_weights("test-allocator")
    actual = json.dumps(result, sort_keys=True)
    expected_path = FIXTURES_DIR / "feedback_engine_v1_golden.json"
    if os.environ.get("REGENERATE_GOLDEN"):
        expected_path.write_text(actual + "\n")
        pytest.skip(
            "Regenerated golden fixture — re-run without REGENERATE_GOLDEN to assert"
        )
    expected = expected_path.read_text().strip()
    assert actual == expected, (
        "Golden snapshot drift — regen via REGENERATE_GOLDEN=1 if math change is intentional"
    )
```

#### Pattern 4 — Per-test dispatch integration via `asyncio_mode = auto`

**Analog:** `analytics-service/tests/test_match_integration.py:108-135` — dispatch-routing test with AsyncMock.

Full excerpt (`test_match_integration.py:108-135`):

```python
async def test_dispatch_routes_rescore_allocator():
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
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
    mock_bridge.assert_not_called()
```

**Deviation for `test_feedback_engine.py::test_dispatch_through_worker` (Phase 4 D-11 integration):**

The test simulates the cron → enqueue → dispatch → `run_rescore_allocator_job` → `_score_one_allocator` → `compute_adjusted_weights` chain. The delta-cron enqueue itself is tested via migration 063's self-verify DO block; the Python side tests that the handler produces the right end state.

```python
async def test_dispatch_through_worker(monkeypatch):
    """D-11 integration: delta-cron enqueue → worker dispatch →
    run_rescore_allocator_job → _score_one_allocator → compute_adjusted_weights
    runs inline and populates scoring_weight_overrides."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # Patch:
    #   - routers.match._load_candidate_universe (fresh 1-strategy universe)
    #   - routers.match._load_allocator_context (no prefs row)
    #   - services.feedback_engine.get_supabase (returns outcomes + breakdowns)
    #   - routers.match.get_supabase (for match_batches insert)
    #   - routers.match.score_candidates (captures the preferences it sees)

    from services.job_worker import run_rescore_allocator_job
    job = {"id": "job-1", "kind": "rescore_allocator", "allocator_id": "alloc-1"}
    result = await run_rescore_allocator_job(job)
    assert result.outcome == DispatchOutcome.DONE
    # Assert the effective preferences passed to score_candidates include the
    # feedback-engine-written scoring_weight_overrides dict (not None).
```

#### Test roster (from RESEARCH Validation Architecture)

Per-requirement tests — planner copies the scaffolds exactly:

- `test_public_signature` (FEEDBACK-01)
- `test_floor_on_low_rate`, `test_ceiling_on_high_rate`, `test_no_change_in_band`, `test_step_function_boundaries` (FEEDBACK-02, D-13)
- `test_cold_start_under_five`, `test_threshold_at_five` (FEEDBACK-03, D-15)
- `test_persist_column`, `test_persist_null_on_cold_start` (FEEDBACK-04, D-10, D-16)
- `test_per_dimension_independence` (FEEDBACK-05)
- `test_inline_merge_reaches_snapshot` (FEEDBACK-06)
- `test_score_dominant_attribution` (D-05)
- `test_rejection_reason_mapping` (D-06)
- `test_uniform_fallback_missing_history` (D-07)
- `test_filter_already_owned`, `test_filter_small_allocation`, `test_filter_pending` (D-08, D-03)
- `test_determinism` (D-14)
- `test_omit_undertrained_dims` (D-16)
- `test_attribution_screening_mode_excludes_portfolio_fit` (Pitfall 6)
- `test_golden_snapshot` (Pattern 3 above)
- `test_dispatch_through_worker` (D-11 integration)

---

### `analytics-service/tests/fixtures/feedback_engine_v1_golden.json` (NEW fixture)

**Analog:** `analytics-service/tests/fixtures/match_engine_v2_golden.json` — the only file in the fixtures directory. Single-line JSON, flat dict, `sort_keys=True` serialization. File confirmed to exist via `ls` (one line containing the full match_engine v2 golden dict).

**Deviation:**

- **Shape:** much smaller than match_engine_v2. The file holds a flat dict of at most 4 keys (one per top-level dimension that crossed the threshold):
  ```json
  {"W_PORTFOLIO_FIT": 1.5}
  ```
  Or for a fully-adjusted allocator:
  ```json
  {"W_CAPACITY_FIT": 1.0, "W_PORTFOLIO_FIT": 1.5, "W_PREFERENCE_FIT": 0.5, "W_TRACK_RECORD": 1.0}
  ```
  Note: `1.0` entries are omitted in production (D-16 omits under-threshold dims AND in-band 1.0 is not written — see CONTEXT.md D-13: only floor/ceiling write a key), so the actual golden likely has only floor/ceiling keys.

- **Wave 0 state:** Create as a placeholder that fails the assert deliberately until `REGENERATE_GOLDEN=1` runs once on Wave 1 green. Seed with `{}` — the test will skip on first real run with REGENERATE_GOLDEN=1 and succeed thereafter.

- **Regeneration command** (in commit message / runbook):
  ```bash
  cd analytics-service && REGENERATE_GOLDEN=1 pytest tests/test_feedback_engine.py::test_golden_snapshot -x
  ```

---

### `supabase/migrations/063_feedback_delta_enqueue.sql` (NEW migration)

**Purpose:** `CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()` to append a `FOR v_allocator_id IN ... LOOP PERFORM enqueue_compute_job(p_kind:='rescore_allocator', p_allocator_id:=v_allocator_id); END LOOP;` block at the end of the function body. The existing delta-writing CTE stays unchanged; only the post-UPDATE allocator loop is new.

Two analogs combine for the full shape.

#### Pattern A — `CREATE OR REPLACE FUNCTION ... SECURITY DEFINER` body amendment (from 062)

**Analog:** `supabase/migrations/062_scoring_weight_overrides.sql:372-471` — the amended `update_allocator_mandates` function, specifically the trailing `PERFORM enqueue_compute_job` block inserted between the UPSERT body and the final `END;`.

Trailing PERFORM block (`062_scoring_weight_overrides.sql:453-466`):

```sql
  -- 5. Proactive rescore enqueue (D-12 Option B). Runs in the same transaction
  --    as the UPSERT so a rollback leaves no phantom job row. Single-inflight
  --    dedup handled by compute_jobs_one_inflight_per_kind_allocator partial
  --    unique index. Fires on every mandate write; no change detector
  --    (CONTEXT Claude's Discretion — simplest, partial unique index dedupes).
  PERFORM enqueue_compute_job(
    p_strategy_id     := NULL,
    p_kind            := 'rescore_allocator',
    p_idempotency_key := NULL,
    p_parent_job_ids  := '{}',
    p_exchange        := NULL,
    p_metadata        := NULL,
    p_allocator_id    := v_auth_uid
  );
END;
$$;
```

**This is the canonical call shape.** Migration 063 uses identical arg names; only the source of `v_allocator_id` differs (SELECT DISTINCT vs `auth.uid()`).

#### Pattern B — Existing function body being replaced (from 060)

**Analog:** `supabase/migrations/060_bridge_outcome_cron.sql:164-217` — the function definition that Phase 4 replaces.

Full existing body (`060_bridge_outcome_cron.sql:164-217`):

```sql
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
BEGIN
  WITH candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    JOIN public.strategy_analytics AS sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
  ),
  computed AS (
    SELECT
      c.id,
      public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
      public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
      public.extract_delta(c.series, c.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM candidates c
    LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT COUNT(*)::INT INTO v_updated FROM updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;
```

**Key observations for planner:**

1. `v_started` is already declared in the DECLARE block — **reuse** it as the `WHERE deltas_computed_at = v_started` predicate for the new loop (matches the exact value the UPDATE used).
2. The existing function **does NOT declare** a cursor or allocator_id variable — migration 063 must ADD `v_allocator_id UUID;` to the DECLARE block.
3. The `RETURN QUERY` line is at the very end, before `END; $$;`. The new PERFORM loop MUST go BETWEEN the CTE chain's closing `;` (after `SELECT COUNT(*)::INT INTO v_updated FROM updated;`) and `RETURN QUERY`.
4. `SECURITY DEFINER` + `SET search_path = public, pg_catalog` stays unchanged. `enqueue_compute_job` is in the `public` schema, so the set search_path is sufficient.

**Deviation — full migration 063 body (combines Pattern A + B):**

```sql
-- Migration 063: feedback delta-cron enqueue — extends
-- compute_bridge_outcome_deltas() to append rescore_allocator enqueues for
-- every distinct allocator whose outcomes got delta columns populated in this
-- run. Sprint 8 / Phase 4 — Feedback Loop (D-11, D-12).
--
-- What this does
-- --------------
-- 1. CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas() with a
--    strictly additive trailing block: after the existing CTE chain that
--    UPDATEs delta_30d/90d/180d, iterates DISTINCT allocator_ids whose
--    outcomes got deltas_computed_at = v_started (the just-finished batch)
--    and PERFORMs enqueue_compute_job with kind=rescore_allocator. Dedup
--    handled by compute_jobs_one_inflight_per_kind_allocator partial unique
--    index (migration 062 step 6). Atomic with delta write (same SQL txn).
-- 2. Self-verifying DO block asserts the new function body references
--    enqueue_compute_job AND rescore_allocator (string search in
--    pg_get_functiondef output).
--
-- What this does NOT do
-- ---------------------
-- - No schema changes. No new columns, no new CHECK constraints.
-- - No change to the existing CTE chain — the delta math is identical.
-- - No change to pg_cron schedule — the existing cron.schedule('compute_
--   bridge_outcome_deltas', '0 3 * * *', ...) from migration 060 step 5
--   keeps firing; it just now does more work per run.
-- - No new RLS policies. SECURITY DEFINER + service_role EXECUTE grant
--   preserved from migration 060.

BEGIN;

SET lock_timeout = '3s';

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
  v_allocator_id UUID;   -- NEW: Phase 4 / D-12
BEGIN
  -- ... unchanged CTE chain from migration 060 lines 175-213 ...
  WITH candidates AS (
    -- (identical to migration 060)
    ...
  ),
  computed AS ( ... ),
  updated AS ( ... )
  SELECT COUNT(*)::INT INTO v_updated FROM updated;

  -- NEW (Phase 4 / D-12 / D-11): enqueue rescore_allocator for every allocator
  -- whose outcomes just got a delta update. Partial unique index
  -- compute_jobs_one_inflight_per_kind_allocator dedupes if a rescore is
  -- already queued. Failures are logged via NOTICE and do not block the
  -- rest of the cron batch (feedback latency > cron-crash is the right
  -- tradeoff — the next daily run recovers missed allocators).
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
        RAISE NOTICE 'feedback enqueue failed for allocator=%: %',
          v_allocator_id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;

-- REVOKE/GRANT preserved from migration 060 — CREATE OR REPLACE does not
-- change the grant state, but re-assert for clarity.
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;

-- Self-verify: function body must reference enqueue_compute_job AND
-- rescore_allocator. Catches a future accidental CREATE OR REPLACE that drops
-- the new logic.
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc
    WHERE proname = 'compute_bridge_outcome_deltas'
      AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 063 failed: compute_bridge_outcome_deltas function not found';
  END IF;
  IF v_body NOT LIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'Migration 063 failed: compute_bridge_outcome_deltas body does not reference enqueue_compute_job';
  END IF;
  IF v_body NOT LIKE '%rescore_allocator%' THEN
    RAISE EXCEPTION 'Migration 063 failed: compute_bridge_outcome_deltas body does not reference rescore_allocator';
  END IF;
  RAISE NOTICE 'Migration 063: compute_bridge_outcome_deltas amended with rescore_allocator enqueue loop verified.';
END$$;

COMMIT;
```

**Critical integration gotchas:**

1. **RLS bypass:** `compute_bridge_outcome_deltas` is already `SECURITY DEFINER`; `enqueue_compute_job` itself is `SECURITY DEFINER`. The PERFORM inside the function body runs under the function-owner role (postgres) which bypasses all RLS. No additional grants needed.
2. **Dedup via partial unique index:** `compute_jobs_one_inflight_per_kind_allocator` (migration 062 step 6) catches duplicate enqueues. Multiple same-allocator PERFORMs in one batch are a no-op after the first success.
3. **`auth.uid()` NOT available:** The cron session has `auth.uid() = NULL` (per migration 060's comment at lines 156-162 explaining why `log_audit_event` is skipped). DO NOT use `auth.uid()` in the new loop — use the local `v_allocator_id` from the SELECT instead.
4. **`SAVEPOINT` inside the loop:** Per migration 061's PL/pgSQL save point precedent, an inner `BEGIN...EXCEPTION WHEN OTHERS...END` block acts as a subtransaction — catches an individual enqueue failure without aborting the whole cron batch. Essential because a failing enqueue should not roll back the just-written delta columns.
5. **`deltas_computed_at = v_started` predicate:** Uses strict equality (not `>=`) because v_started is the batch's `NOW()` snapshot and the UPDATE sets `deltas_computed_at = v_started`. All rows written in this batch have an identical timestamp; equality is the cleanest predicate.

---

### `analytics-service/routers/match.py` (MODIFIED — surgical 3-line insert at line 259)

**Purpose:** Wire the Phase 4 feedback engine into `_score_one_allocator` between `_load_allocator_context` (line 259) and `score_candidates` (line 265). The insert handles Pitfall 1 (`ctx["preferences"] is None`) inline.

#### Pattern A — Function body extension with `asyncio.to_thread` for synchronous Supabase work

**Analog:** `analytics-service/routers/match.py:251-275` — the `_score_one_allocator` body, specifically the `asyncio.to_thread(_load_allocator_context, allocator_id)` call at line 259. The sync helper is a precedent: `feedback_engine.compute_adjusted_weights` is also synchronous (it does Supabase I/O with the sync client) and must be wrapped the same way.

Full existing body (`routers/match.py:251-275`):

```python
async def _score_one_allocator(
    allocator_id: str,
    universe: dict[str, Any],
) -> dict[str, Any]:
    """Score a single allocator and persist the batch + candidates."""
    async with _scoring_semaphore:
        start = time.monotonic()

        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

        # Build the candidate list from the cached universe
        candidate_strategies = list(universe["strategies_by_id"].values())
        candidate_returns = universe["returns_by_id"]

        result = score_candidates(
            allocator_id=allocator_id,
            preferences=ctx["preferences"],
            portfolio_strategies=ctx["portfolio_strategies"],
            portfolio_returns=ctx["portfolio_returns"],
            portfolio_weights=ctx["portfolio_weights"],
            candidate_strategies=candidate_strategies,
            candidate_returns=candidate_returns,
            thumbs_down_ids=ctx["thumbs_down_ids"],
            portfolio_aum=ctx["portfolio_aum"],
        )
```

#### Pattern B — Lazy-import precedent from `job_worker.py::run_rescore_allocator_job`

**Analog:** `analytics-service/services/job_worker.py:1121-1123`:

```python
async def run_rescore_allocator_job(job: dict) -> DispatchResult:
    # ...
    # Deferred import to avoid circular dependency — routers/match.py
    # imports from services.match_engine, which is a peer of services.job_worker.
    from routers.match import _load_candidate_universe, _score_one_allocator
```

**Directional note:** The `routers.match` → `services.feedback_engine` direction is the NORMAL direction (routers import from services); no circular risk. Lazy import is NOT required for the routers/match.py side, but keeping it lazy matches the precedent and defers the import cost until needed. Planner's call — lean top-level import since it's the forward direction.

**Deviation — the exact 3-line insert at line 259:**

```python
        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

        # Phase 4 / D-09 + D-10 — compute feedback overrides BEFORE scoring so
        # the engine sees them via prefs["scoring_weight_overrides"]. The
        # function is a synchronous Supabase caller with a persistence side
        # effect; wrap in asyncio.to_thread to match _load_allocator_context's
        # pattern. Pitfall 1: ctx["preferences"] can be None when the allocator
        # has no allocator_preferences row — normalize to {} before merging.
        from services.feedback_engine import compute_adjusted_weights
        overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
        if ctx["preferences"] is None:
            ctx["preferences"] = {}
        ctx["preferences"]["scoring_weight_overrides"] = overrides or None

        # Build the candidate list from the cached universe
        candidate_strategies = list(universe["strategies_by_id"].values())
        # ... rest unchanged ...
```

**Critical integration gotchas:**

1. **Concurrency:** `_score_one_allocator` holds `_scoring_semaphore` (cap=3 at line 33). `compute_adjusted_weights` runs inside that lock. Adds at most a few dozen ms per allocator (two `.select().execute()` + one `.update().execute()` = ~10-50ms in practice) — well within the RECOMPUTE_MIN_AGE_HOURS budget.
2. **`ctx["preferences"] is None` branch (Pitfall 1):** When an allocator has never set any preference, `_load_allocator_context` returns `preferences=None` (line 180). The feedback engine still ran (it doesn't need a prefs row to read bridge_outcomes), so we need to assign a fresh dict before mutating. Assigning `None` to `scoring_weight_overrides` on an empty prefs dict is safe — `score_candidates` at line 575 calls `merge_with_defaults(preferences or {})` which handles both None and {}.
3. **`overrides or None`:** An empty dict `{}` is falsy → becomes `None` in the merge. Consistent with D-16 write-NULL-on-cold-start semantics. Engine reads `prefs.get("scoring_weight_overrides") or {}` at line 767, so None/{}/empty-dict all yield the same behavior (no scaling).
4. **Exception propagation:** If `compute_adjusted_weights` raises (e.g., Supabase outage), the exception bubbles up to `_score_one_allocator`'s caller. The inline call does NOT swallow errors because feedback failure should not silently degrade scoring to v1 behavior. Acceptable tradeoff — if feedback fetch is broken, the whole scoring run should fail loudly. (Planner can revisit if ops wants graceful-degradation.)
5. **Import placement:** Place `from services.feedback_engine import compute_adjusted_weights` inside the function body (lazy) — keeps the module's top-level import section untouched and documents that this is a Phase 4 addition. Alternative: top-level import — planner's choice. Per research §Pattern 2 there's no circular risk; lazy is just cleaner for a surgical Phase 4 seam.

**No schema-sync changes.** Per RESEARCH §Verification 5, `src/lib/admin/match.ts::ALLOCATOR_PREFERENCES_COLUMNS` already includes `scoring_weight_overrides` (Phase 3 append); `src/lib/preferences.ts::AllocatorPreferences` already types it as `Record<string, number> | null`. Phase 4 is the first writer but requires ZERO TS-side changes.

---

## Shared Patterns

### Lazy-import for router → services back-edges

**Source:** `analytics-service/services/job_worker.py:1121-1123`
**Apply to:** `analytics-service/routers/match.py` (Phase 4 insert) — lean toward lazy to match precedent; no hard requirement since direction is forward

```python
# Deferred import to avoid circular dependency
from routers.match import _load_candidate_universe, _score_one_allocator
```

### Supabase service-role client singleton (bypasses RLS per ADR-0003)

**Source:** `analytics-service/services/db.py:7-14`
**Apply to:** Every DB read/write from `feedback_engine.py` and from the `_score_one_allocator` seam

```python
@lru_cache(maxsize=1)
def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)
```

### `merge_with_defaults` NULL-skip semantic (no change needed)

**Source:** `analytics-service/services/match_defaults.py:29-41`
**Apply to:** `feedback_engine.py` inline merge into `ctx["preferences"]["scoring_weight_overrides"] = overrides or None` — the merge is safe because None values are skipped.

```python
def merge_with_defaults(prefs: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(DEFAULT_PREFERENCES)
    if not prefs:
        return merged
    for key, value in prefs.items():
        if value is not None:
            merged[key] = value
    return merged
```

`DEFAULT_PREFERENCES["scoring_weight_overrides"] = None` (already in place since Phase 3). No Phase 4 change.

### Async `asyncio.to_thread` wrap for synchronous Supabase work

**Source:** `analytics-service/routers/match.py:259, 298, 332`
**Apply to:** All `feedback_engine` calls from async contexts (the `_score_one_allocator` seam)

```python
ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)
# Phase 4:
overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
```

### Fire-and-forget audit event (never raises to caller)

**Source:** `analytics-service/services/audit.py:1-130`
**Apply to:** `feedback_engine._persist_overrides` — emit ONLY after successful UPDATE (non-empty `result.data`)

```python
log_audit_event(
    user_id=allocator_id,
    action="feedback.overrides_updated",
    entity_type="allocator_preference_feedback",
    entity_id=allocator_id,
    metadata={"dimensions_updated": list(overrides.keys()) if overrides else [],
              "engine_version": "v1"},
)
```

New taxonomy values to register in `src/lib/audit.ts`:
- `AuditAction`: add `"feedback.overrides_updated"`
- `AuditEntityType`: add `"allocator_preference_feedback"`

### Per-allocator partial unique index for enqueue dedup

**Source:** `supabase/migrations/062_scoring_weight_overrides.sql` step 6 (line 151, indexname `compute_jobs_one_inflight_per_kind_allocator`)
**Apply to:** The migration 063 PERFORM loop — no new index needed; the existing one catches duplicate enqueues across concurrent delta-cron runs and between delta-cron + mandate-edit paths.

### try/except ImportError + IMPORTS_OK sentinel

**Source:** `analytics-service/tests/test_match_integration.py:14-31`
**Apply to:** Every new test file that imports Wave-1 symbols — guards the test file's collection from failing if the module doesn't exist yet (Wave 0 red scaffold).

### `pytest.ini` asyncio_mode = auto

**Source:** `analytics-service/pytest.ini`
**Apply to:** `test_feedback_engine.py` — async def tests need NO `@pytest.mark.asyncio` decorator. Prefer bare-async-def style per `test_match_integration.py` precedent.

---

## No Analog Found

**None.** All 5 files have a direct, line-verified analog in the current codebase. Phase 4 is a clean amplification of Phase 3's infrastructure — every new pattern composes from existing ones.

---

## Metadata

**Analog search scope:**
- `analytics-service/services/` (feedback_engine.py, match_engine.py, match_defaults.py, audit.py, db.py, job_worker.py)
- `analytics-service/routers/` (match.py)
- `analytics-service/tests/` (test_match_engine.py, test_match_integration.py, fixtures/)
- `supabase/migrations/` (059_bridge_outcomes, 060_bridge_outcome_cron, 062_scoring_weight_overrides)
- `.planning/phases/03-mandate-aware-scoring-engine/03-PATTERNS.md` (structural template)

**Files scanned:** 13 (read in non-overlapping targeted ranges; no file > 2,000 lines required a whole-file load).

**Files with direct analogs:** 5/5 (100%).

**Key insight for planner:** Phase 4 introduces zero new patterns. Every seam reuses an existing pattern from Phase 3 (migration 062's PERFORM enqueue, test_match_integration's IMPORTS_OK sentinel, match_engine's pure-function shape, audit.py's fire-and-forget, routers/match.py's asyncio.to_thread wrap, migration 060's SECURITY DEFINER pg_cron function). The composition is where the work lives — not the pattern invention.

**Pattern extraction date:** 2026-04-18
