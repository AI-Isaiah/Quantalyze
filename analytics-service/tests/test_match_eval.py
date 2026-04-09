"""Tests for analytics-service/services/match_eval.py.

Mocking strategy notes:
- compute_hit_rate_metrics defers `from services.db import get_supabase` inside
  the function body. We patch the symbol at its SOURCE location
  (services.db.get_supabase), not the consumer module — that's the only place
  the symbol exists at module scope.
- After the PR 9 batching refactor, compute_hit_rate_metrics issues AT MOST
  three queries regardless of intro count:
    1. match_decisions — fetch all intros in the window
    2. match_batches — `.in_("allocator_id", [...])` for every distinct
       allocator referenced by a valid intro
    3. match_candidates — `.in_("batch_id", [...])` for every batch we
       need a rank from
  The test helper `_make_batched_supabase_mock` routes `supabase.table(name)`
  to the right pre-wired chain for each of the three tables so we can stub
  batches + candidates directly instead of patching the per-intro helper.
- CRITICAL: the rank-lookup test uses spec=SyncSelectRequestBuilder so that
  if anyone reverts the maybe_single fix to maybeSingle, the mock will raise
  AttributeError instead of silently auto-vivifying. This is the regression
  guard for the typo bug found during plan-eng-review.
"""

from unittest.mock import MagicMock, patch

import pytest
from postgrest._sync.request_builder import SyncSelectRequestBuilder

from services.match_eval import (
    _empty_metrics,
    _find_strategy_rank_in_latest_batch_before,
    _week_start_iso,
    compute_hit_rate_metrics,
)


# ─── Pure helpers (existing) ───────────────────────────────────────────


def test_week_start_iso_returns_monday():
    # 2026-04-07 is a Tuesday, so Monday is 2026-04-06
    result = _week_start_iso("2026-04-07T10:00:00Z")
    assert result == "2026-04-06"


def test_week_start_iso_handles_sunday():
    # 2026-04-05 is a Sunday, Monday of that week is 2026-03-30
    result = _week_start_iso("2026-04-05T10:00:00Z")
    assert result == "2026-03-30"


def test_empty_metrics_shape():
    result = _empty_metrics(28)
    assert result["window_days"] == 28
    assert result["intros_shipped"] == 0
    assert result["hits_top_3"] == 0
    assert result["hits_top_10"] == 0
    assert result["hit_rate_top_3"] == 0.0
    assert result["hit_rate_top_10"] == 0.0
    assert result["weekly"] == []
    assert result["missed"] == []


# ─── Helpers for compute_hit_rate_metrics tests ────────────────────────


def _passthrough_chain(final_data):
    """A MagicMock where every builder method returns self and `.execute()`
    returns an object with `.data = final_data`. Works for whatever chain
    of `.select().eq().gte().in_()...` the caller strings together.

    `.range(start, end)` is handled specially to simulate PostgREST
    pagination: the chain returns a 1-page result with the requested
    slice, then a zero-row page to terminate the pagination loop. The
    page size in production is 1000, so any test with <1000 rows gets a
    full page on the first call and an empty page on the second.
    """
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.in_.return_value = chain
    chain.lt.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain

    def _range_side_effect(start, end):
        sliced = MagicMock()
        sliced.execute.return_value = MagicMock(data=final_data[start:end + 1])
        return sliced

    chain.range.side_effect = _range_side_effect
    chain.execute.return_value = MagicMock(data=final_data)
    return chain


def _make_batched_supabase_mock(
    *,
    intros: list[dict],
    batches: list[dict] | None = None,
    candidates: list[dict] | None = None,
) -> MagicMock:
    """Route `supabase.table(name)` to the right pre-wired chain for each of
    the three tables the batched `compute_hit_rate_metrics` queries.

    - `intros`: rows returned for `match_decisions`
    - `batches`: rows for `match_batches` — each row: {id, allocator_id, computed_at}
    - `candidates`: rows for `match_candidates` — each row:
        {batch_id, strategy_id, rank, exclusion_reason}
    """
    chains = {
        "match_decisions": _passthrough_chain(intros),
        "match_batches": _passthrough_chain(batches or []),
        "match_candidates": _passthrough_chain(candidates or []),
    }
    sb = MagicMock()
    sb.table.side_effect = lambda name: chains[name]
    return sb


def _make_intro(
    allocator_id: str = "alloc-1",
    strategy_id: str = "strat-1",
    created_at: str = "2026-04-07T10:00:00Z",
) -> dict:
    return {
        "allocator_id": allocator_id,
        "strategy_id": strategy_id,
        "created_at": created_at,
        "candidate_id": None,
    }


def _batch(
    id: str,
    allocator_id: str,
    computed_at: str,
) -> dict:
    return {"id": id, "allocator_id": allocator_id, "computed_at": computed_at}


def _candidate(
    batch_id: str,
    strategy_id: str,
    rank: int,
    exclusion_reason: str | None = None,
) -> dict:
    return {
        "batch_id": batch_id,
        "strategy_id": strategy_id,
        "rank": rank,
        "exclusion_reason": exclusion_reason,
    }


# ─── compute_hit_rate_metrics tests ────────────────────────────────────


def test_compute_hit_rate_empty_intros_returns_empty_metrics():
    """The early-return branch when no intros exist in the window."""
    sb = _make_batched_supabase_mock(intros=[])
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)
    assert result == _empty_metrics(28)


def test_compute_hit_rate_top_3_top_10_math():
    """The single most important math test in the file. Three intros with
    ranks [1, 5, None] → 1 hit at top-3, 2 hits at top-10, 2 misses."""
    intros = [
        _make_intro("a1", "s1", "2026-04-07T10:00:00Z"),
        _make_intro("a2", "s2", "2026-04-07T10:00:00Z"),
        _make_intro("a3", "s3", "2026-04-07T10:00:00Z"),
    ]
    # a1 has a prior batch with s1 @ rank 1 → top-3 hit
    # a2 has a prior batch with s2 @ rank 5 → top-10 hit
    # a3 has a prior batch but s3 is not in it → no rank → miss (no_prior_batch-style)
    batches = [
        _batch("b-a1", "a1", "2026-04-06T00:00:00Z"),
        _batch("b-a2", "a2", "2026-04-06T00:00:00Z"),
        _batch("b-a3", "a3", "2026-04-06T00:00:00Z"),
    ]
    candidates = [
        _candidate("b-a1", "s1", 1),
        _candidate("b-a2", "s2", 5),
        # b-a3 has no row for s3 — missing from the map → None
    ]
    sb = _make_batched_supabase_mock(
        intros=intros, batches=batches, candidates=candidates
    )
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    assert result["intros_shipped"] == 3
    assert result["hits_top_3"] == 1
    assert result["hits_top_10"] == 2
    assert result["hit_rate_top_3"] == pytest.approx(1 / 3)
    assert result["hit_rate_top_10"] == pytest.approx(2 / 3)


def test_compute_hit_rate_weekly_aggregation_buckets_by_monday():
    """Three intros across two ISO weeks → weekly list has 2 entries,
    sorted ascending by week_start. Catches the defaultdict + weekday()
    aggregation logic."""
    # 2026-04-06 is a Monday → week_start 2026-04-06
    # 2026-04-07 is a Tuesday → also week_start 2026-04-06
    # 2026-04-13 is the following Monday → week_start 2026-04-13
    intros = [
        _make_intro("a1", "s1", "2026-04-06T10:00:00Z"),
        _make_intro("a1", "s2", "2026-04-07T10:00:00Z"),
        _make_intro("a1", "s3", "2026-04-13T10:00:00Z"),
    ]
    # Single allocator with batches computed before each intro. We place the
    # batch at 2026-04-05 so all three intros resolve to the same batch_id,
    # and candidates for s1/s2/s3 all at rank 1 (all hit).
    batches = [_batch("b-a1", "a1", "2026-04-05T00:00:00Z")]
    candidates = [
        _candidate("b-a1", "s1", 1),
        _candidate("b-a1", "s2", 1),
        _candidate("b-a1", "s3", 1),
    ]
    sb = _make_batched_supabase_mock(
        intros=intros, batches=batches, candidates=candidates
    )
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    weekly = result["weekly"]
    assert len(weekly) == 2
    assert weekly[0]["week_start"] == "2026-04-06"
    assert weekly[0]["intros"] == 2
    assert weekly[0]["hits_top_3"] == 2
    assert weekly[1]["week_start"] == "2026-04-13"
    assert weekly[1]["intros"] == 1
    # Sorted ascending
    assert weekly[0]["week_start"] < weekly[1]["week_start"]


def test_compute_hit_rate_missed_reasons():
    """Locks in the labels surfaced in /admin/match/eval. rank=None means
    'no_prior_batch'; rank>3 means 'not_in_top_3'."""
    intros = [
        _make_intro("a1", "s_no_batch", "2026-04-07T10:00:00Z"),
        _make_intro("a2", "s_low_rank", "2026-04-07T10:00:00Z"),
    ]
    # a1 has NO prior batch → no_prior_batch
    # a2 has a prior batch with s_low_rank @ rank 7 → not_in_top_3
    batches = [_batch("b-a2", "a2", "2026-04-06T00:00:00Z")]
    candidates = [_candidate("b-a2", "s_low_rank", 7)]
    sb = _make_batched_supabase_mock(
        intros=intros, batches=batches, candidates=candidates
    )
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    missed = result["missed"]
    assert len(missed) == 2
    by_strategy = {m["strategy_id"]: m for m in missed}
    assert by_strategy["s_no_batch"]["reason"] == "no_prior_batch"
    assert by_strategy["s_no_batch"]["rank_if_any"] is None
    assert by_strategy["s_low_rank"]["reason"] == "not_in_top_3"
    assert by_strategy["s_low_rank"]["rank_if_any"] == 7


def test_compute_hit_rate_missed_list_capped_at_50():
    """The missed list is capped at 50 entries to protect payload size.
    Feed 60 misses, assert exactly 50 in the result."""
    intros = [_make_intro(f"a{i}", f"s{i}") for i in range(60)]
    # No batches → every intro is no_prior_batch → all miss
    sb = _make_batched_supabase_mock(intros=intros)
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    assert result["intros_shipped"] == 60
    assert len(result["missed"]) == 50


def test_compute_hit_rate_skips_malformed_intro_rows():
    """A single malformed match_decisions row (missing created_at) used to
    crash the eval endpoint with a KeyError, taking down /admin/match/eval.
    After the PR 1 input-validation fix, the malformed row is logged +
    skipped and the metrics still compute over the valid rows.
    """
    intros = [
        _make_intro("a1", "s1", "2026-04-07T10:00:00Z"),
        {"allocator_id": "a2", "strategy_id": "s2"},  # missing created_at
        _make_intro("a3", "s3", "2026-04-07T10:00:00Z"),
    ]
    # Both valid intros hit at rank 1.
    batches = [
        _batch("b-a1", "a1", "2026-04-06T00:00:00Z"),
        _batch("b-a3", "a3", "2026-04-06T00:00:00Z"),
    ]
    candidates = [
        _candidate("b-a1", "s1", 1),
        _candidate("b-a3", "s3", 1),
    ]
    sb = _make_batched_supabase_mock(
        intros=intros, batches=batches, candidates=candidates
    )
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    # Only the two valid intros should be counted — the malformed row is
    # skipped, not counted as a miss and not counted in the denominator.
    assert result["intros_shipped"] == 2
    assert result["hits_top_3"] == 2
    assert result["hit_rate_top_3"] == pytest.approx(1.0)


def test_compute_hit_rate_returns_empty_when_all_rows_malformed():
    """If every row is malformed we should return empty metrics instead of
    crashing with a ZeroDivisionError on the hit_rate numerator."""
    intros = [
        {"allocator_id": "a1"},  # missing strategy_id + created_at
        {"strategy_id": "s1"},  # missing allocator_id + created_at
    ]
    sb = _make_batched_supabase_mock(intros=intros)
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    assert result == _empty_metrics(28)


def test_compute_hit_rate_batched_picks_most_recent_batch_before_intro():
    """Regression guard for the batched resolver: when an allocator has
    multiple batches, only the most recent one BEFORE the intro timestamp
    should count. The older batch had s1 at rank 1 (hit); the newer batch
    — which is AFTER the intro — should be ignored. Expected: miss."""
    intros = [_make_intro("a1", "s1", "2026-04-07T10:00:00Z")]
    batches = [
        # Older batch BEFORE the intro — s1 is at rank 1 here, but this
        # isn't the most-recent-before. Wait — it IS the most recent before.
        _batch("b-old", "a1", "2026-04-06T00:00:00Z"),
        # Newer batch AFTER the intro — should be ignored.
        _batch("b-new", "a1", "2026-04-08T00:00:00Z"),
    ]
    candidates = [
        # b-old contains s1 at rank 1 — should hit
        _candidate("b-old", "s1", 1),
        # b-new contains s1 at rank 99 — should NOT be used (it's after the intro)
        _candidate("b-new", "s1", 99),
    ]
    sb = _make_batched_supabase_mock(
        intros=intros, batches=batches, candidates=candidates
    )
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    # The older batch is the most recent BEFORE the intro, and s1 is at
    # rank 1 in that batch → top-3 hit.
    assert result["intros_shipped"] == 1
    assert result["hits_top_3"] == 1


def test_compute_hit_rate_batched_excluded_candidates_do_not_count_as_hit():
    """Excluded candidates (exclusion_reason IS NOT NULL) must not be counted
    as hits — matches the legacy helper's `.is_("exclusion_reason", None)`
    filter. Locks in this behaviour across the batching refactor.
    """
    intros = [_make_intro("a1", "s1", "2026-04-07T10:00:00Z")]
    batches = [_batch("b-a1", "a1", "2026-04-06T00:00:00Z")]
    candidates = [
        # Present at rank 1 but EXCLUDED — should be treated as missing.
        _candidate("b-a1", "s1", 1, exclusion_reason="not_verified"),
    ]
    sb = _make_batched_supabase_mock(
        intros=intros, batches=batches, candidates=candidates
    )
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    assert result["intros_shipped"] == 1
    assert result["hits_top_3"] == 0
    # The intro is counted as a miss with reason "no_prior_batch" because
    # the excluded candidate is filtered out of the rank map.
    assert len(result["missed"]) == 1
    assert result["missed"][0]["rank_if_any"] is None


# ─── _find_strategy_rank_in_latest_batch_before tests ──────────────────


def test_find_rank_no_prior_batch_returns_none():
    """If no match_batches row exists before the timestamp, return None."""
    sb = MagicMock()
    batches_chain = MagicMock()
    batches_chain.select.return_value = batches_chain
    batches_chain.eq.return_value = batches_chain
    batches_chain.lt.return_value = batches_chain
    batches_chain.order.return_value = batches_chain
    batches_chain.limit.return_value = batches_chain
    batches_chain.execute.return_value = MagicMock(data=[])
    sb.table.return_value = batches_chain

    result = _find_strategy_rank_in_latest_batch_before(
        sb, "alloc-1", "strat-1", "2026-04-07T10:00:00Z"
    )
    assert result is None


def test_find_rank_in_batch_returns_rank_value():
    """REGRESSION TEST for the maybeSingle → maybe_single typo bug
    discovered during plan-eng-review.

    The candidate-lookup chain ends with .maybe_single().execute(). Before
    the fix it was .maybeSingle() (camelCase), which would AttributeError
    at runtime against a real postgrest builder.

    To prove this test catches a regression of that bug, the OBJECT on
    which .maybe_single() is called is spec'd against the real
    SyncSelectRequestBuilder class. With the spec, .maybeSingle would raise
    AttributeError ('Mock object has no attribute maybeSingle'); only
    .maybe_single succeeds. If anyone reverts the fix, this test fails
    immediately.
    """
    sb = MagicMock()

    # Branch 1: match_batches query (no spec — we control its shape directly)
    batches_chain = MagicMock()
    batches_chain.select.return_value = batches_chain
    batches_chain.eq.return_value = batches_chain
    batches_chain.lt.return_value = batches_chain
    batches_chain.order.return_value = batches_chain
    batches_chain.limit.return_value = batches_chain
    batches_chain.execute.return_value = MagicMock(data=[{"id": "batch-uuid"}])

    # Branch 2: match_candidates query.
    # We build the chain in two parts:
    #   - cands_table: the result of supabase.table("match_candidates"),
    #     unconstrained because table() returns a SyncRequestBuilder which
    #     has .select but the test doesn't need to spec it.
    #   - selectable: the post-select object, SPEC'D against the real
    #     SyncSelectRequestBuilder. The chain methods .eq, .is_,
    #     .maybe_single all live here. If maybe_single is misnamed, the
    #     spec'd mock raises AttributeError instead of auto-vivifying.
    selectable = MagicMock(spec=SyncSelectRequestBuilder)
    # Wire chain methods to return self (each builder method returns Self)
    selectable.eq.return_value = selectable
    selectable.is_.return_value = selectable
    selectable.maybe_single.return_value = selectable
    selectable.execute.return_value = MagicMock(data={"rank": 7})

    cands_table = MagicMock()
    cands_table.select.return_value = selectable

    def route_table(name):
        return {"match_batches": batches_chain, "match_candidates": cands_table}[name]

    sb.table.side_effect = route_table

    result = _find_strategy_rank_in_latest_batch_before(
        sb, "alloc-1", "strat-1", "2026-04-07T10:00:00Z"
    )
    assert result == 7
