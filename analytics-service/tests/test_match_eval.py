"""Tests for analytics-service/services/match_eval.py.

Mocking strategy notes:
- compute_hit_rate_metrics defers `from services.db import get_supabase` inside
  the function body. We patch the symbol at its SOURCE location
  (services.db.get_supabase), not the consumer module — that's the only place
  the symbol exists at module scope.
- The supabase chain (`.table().select().eq().gte().execute()`) returns Self
  on each builder method, so we can wire one MagicMock to return itself for
  every chain method and override .execute() to return data.
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


def _make_intros_supabase_mock(intros: list[dict]) -> MagicMock:
    """Build a MagicMock that returns the given list of intro rows when
    compute_hit_rate_metrics queries the match_decisions table.

    The chain is .table('match_decisions').select(...).eq(...).gte(...).execute()
    Each chain method returns the same mock (chain returns self), and .execute()
    returns an object whose .data is the intros list.
    """
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.execute.return_value = MagicMock(data=intros)

    sb = MagicMock()
    sb.table.return_value = chain
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


# ─── compute_hit_rate_metrics tests ────────────────────────────────────


def test_compute_hit_rate_empty_intros_returns_empty_metrics():
    """The early-return branch when no intros exist in the window."""
    sb = _make_intros_supabase_mock([])
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)
    assert result == _empty_metrics(28)


def test_compute_hit_rate_top_3_top_10_math():
    """The single most important math test in the file. Three intros with
    ranks [1, 5, None] → 1 hit at top-3, 2 hits at top-10, 2 misses."""
    intros = [
        _make_intro("a1", "s1"),
        _make_intro("a2", "s2"),
        _make_intro("a3", "s3"),
    ]
    sb = _make_intros_supabase_mock(intros)
    rank_lookup = {("a1", "s1"): 1, ("a2", "s2"): 5, ("a3", "s3"): None}

    def fake_find_rank(_supabase, allocator_id, strategy_id, _ts):
        return rank_lookup[(allocator_id, strategy_id)]

    with patch("services.db.get_supabase", return_value=sb), patch(
        "services.match_eval._find_strategy_rank_in_latest_batch_before",
        side_effect=fake_find_rank,
    ):
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
    sb = _make_intros_supabase_mock(intros)
    with patch("services.db.get_supabase", return_value=sb), patch(
        "services.match_eval._find_strategy_rank_in_latest_batch_before",
        return_value=1,  # All hit
    ):
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
        _make_intro("a1", "s_no_batch"),
        _make_intro("a2", "s_low_rank"),
    ]
    rank_lookup = {("a1", "s_no_batch"): None, ("a2", "s_low_rank"): 7}

    def fake_find_rank(_supabase, allocator_id, strategy_id, _ts):
        return rank_lookup[(allocator_id, strategy_id)]

    sb = _make_intros_supabase_mock(intros)
    with patch("services.db.get_supabase", return_value=sb), patch(
        "services.match_eval._find_strategy_rank_in_latest_batch_before",
        side_effect=fake_find_rank,
    ):
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
    sb = _make_intros_supabase_mock(intros)
    with patch("services.db.get_supabase", return_value=sb), patch(
        "services.match_eval._find_strategy_rank_in_latest_batch_before",
        return_value=None,  # All miss
    ):
        result = compute_hit_rate_metrics(lookback_days=28)

    assert result["intros_shipped"] == 60
    assert len(result["missed"]) == 50


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
