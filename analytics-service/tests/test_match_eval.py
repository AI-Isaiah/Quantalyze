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
    assert result["skipped"] == 0
    assert result["skipped_rate"] == 0.0
    assert result["hits_top_3"] == 0
    assert result["hits_top_10"] == 0
    assert result["hit_rate_top_3"] == 0.0
    assert result["hit_rate_top_10"] == 0.0
    assert result["weekly"] == []
    assert result["missed"] == []


def test_compute_hit_rate_surfaces_skipped_count():
    """The denominator (`total = intros - skipped`) used to be the only
    place skipped intros appeared, so a run where 80% of intros raised
    looked identical to a healthy 20-intro run. Post-fix, ``skipped``
    and ``skipped_rate`` are first-class telemetry on the response."""
    intros = [
        _make_intro("a1", "s1", "2026-04-07T10:00:00Z"),
        {"allocator_id": "a2", "strategy_id": "s2"},  # missing created_at
        _make_intro("a3", "s3", "2026-04-07T10:00:00Z"),
        {},  # totally malformed
    ]
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

    assert result["intros_shipped"] == 2
    assert result["skipped"] == 2, (
        "skipped count must be returned so bad-row rate is observable"
    )
    assert result["skipped_rate"] == pytest.approx(0.5)


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
    # audit-2026-05-07 #27 follow-up: match_candidates query now appends
    # `.is_("exclusion_reason", "null")` so the planner can ride the
    # partial index `idx_match_cand_batch_rank` (WHERE exclusion_reason
    # IS NULL). The mock must passthrough `.is_()` so existing tests
    # that build a chain via `_passthrough_chain` for match_candidates
    # don't break when the runner adds the new chain element.
    chain.is_.return_value = chain
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
    crashing with a ZeroDivisionError on the hit_rate numerator. The
    skipped count must still surface so a 100%-malformed run is
    distinguishable from a 0-intros run."""
    intros = [
        {"allocator_id": "a1"},  # missing strategy_id + created_at
        {"strategy_id": "s1"},  # missing allocator_id + created_at
    ]
    sb = _make_batched_supabase_mock(intros=intros)
    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    expected = _empty_metrics(28)
    expected["skipped"] = 2
    expected["skipped_rate"] = 1.0
    assert result == expected


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


# ─── audit-2026-05-07 #27 + #52 regression tests ──────────────────────


def _capture_chain(final_data, recorded_orders: list[tuple[str, bool]]):
    """Like ``_passthrough_chain`` but records every ``.order(column, desc=)``
    call so the test can assert the composite ORDER BY is what we expect.
    Default ``desc`` mirrors the real postgrest signature (False)."""
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.in_.return_value = chain
    chain.lt.return_value = chain
    # audit-2026-05-07 #27 follow-up: match_candidates query now appends
    # `.is_("exclusion_reason", "null")` for partial-index alignment.
    # The capture chain must passthrough `.is_()` so the order recorder
    # still sees the composite ORDER BY downstream.
    chain.is_.return_value = chain
    chain.limit.return_value = chain

    def _order_side_effect(column, *, desc=False, **_kw):
        recorded_orders.append((column, bool(desc)))
        return chain

    chain.order.side_effect = _order_side_effect

    def _range_side_effect(start, end):
        sliced = MagicMock()
        sliced.execute.return_value = MagicMock(data=final_data[start:end + 1])
        return sliced

    chain.range.side_effect = _range_side_effect
    chain.execute.return_value = MagicMock(data=final_data)
    return chain


def test_compute_hit_rate_orders_match_batches_by_allocator_id_and_computed_at_desc():
    """audit-2026-05-07 #27 regression — pre-fix the helper paginated
    `match_batches` ordered by `id` (UUIDv4 PK), defeating
    `idx_match_batches_allocator_recent` AND racing concurrent inserts.
    Lock the composite ordering shape so anyone reverting it triggers
    a failing test BEFORE the silently-corrupted hit-rate metrics ship."""
    intros = [_make_intro(allocator_id="alloc-1")]
    batches = [_batch("batch-1", "alloc-1", "2026-04-06T10:00:00Z")]
    candidates = [_candidate("batch-1", "strat-1", rank=1)]

    batches_orders: list[tuple[str, bool]] = []
    candidates_orders: list[tuple[str, bool]] = []

    chains = {
        "match_decisions": _passthrough_chain(intros),
        "match_batches": _capture_chain(batches, batches_orders),
        "match_candidates": _capture_chain(candidates, candidates_orders),
    }
    sb = MagicMock()
    sb.table.side_effect = lambda name: chains[name]

    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    # Sanity: the pipeline still yields the expected hit so we know the
    # ordering change didn't accidentally drop the candidate.
    assert result["hits_top_3"] == 1
    # match_batches MUST be ordered by (allocator_id ASC, computed_at DESC).
    assert batches_orders == [
        ("allocator_id", False),
        ("computed_at", True),
    ], (
        "match_batches pagination must order by (allocator_id, computed_at "
        f"DESC) to ride idx_match_batches_allocator_recent; got {batches_orders}"
    )
    # match_candidates MUST be ordered by (batch_id, rank) so the query
    # rides idx_match_cand_batch_rank.
    assert candidates_orders == [
        ("batch_id", False),
        ("rank", False),
    ], (
        "match_candidates pagination must order by (batch_id, rank) to ride "
        f"idx_match_cand_batch_rank; got {candidates_orders}"
    )


def test_compute_hit_rate_issues_one_match_batches_query_per_call():
    """audit-2026-05-07 #26/#27 regression — the audit's correctness concern
    is that long-lived allocators were forcing a per-batch query. Lock the
    one-query-per-call contract: regardless of intro/batch fan-out,
    `compute_hit_rate_metrics` must hit `match_batches` via a single
    `.in_("allocator_id", [...])` call (then paginate via `.range()`),
    NOT once per batch.

    Counts `chain.execute()` calls on the match_batches branch and asserts
    it equals the number of pagination pages (1 here, since the test data
    fits in <1000 rows). Anything >1 means we re-introduced the N+1."""
    intros = [
        _make_intro(allocator_id=f"alloc-{i}", strategy_id=f"strat-{i}")
        for i in range(5)
    ]
    batches = [
        _batch(f"batch-{i}", f"alloc-{i}", "2026-04-06T10:00:00Z")
        for i in range(5)
    ]
    candidates = [_candidate(f"batch-{i}", f"strat-{i}", rank=2) for i in range(5)]

    # Track how many times `.range(...).execute()` is invoked against
    # match_batches. Each pagination page = one call. <1000 rows => 1 call.
    range_call_count = {"match_batches": 0, "match_candidates": 0}

    def _make_counting_chain(name, final_data):
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gte.return_value = chain
        chain.in_.return_value = chain
        chain.lt.return_value = chain
        # audit-2026-05-07 #27 follow-up: match_candidates query now appends
        # `.is_("exclusion_reason", "null")` so the planner can ride the
        # partial index `idx_match_cand_batch_rank` (WHERE exclusion_reason
        # IS NULL). Counting chain must passthrough `.is_()` so the chain
        # walks all the way to `.range()` for the pagination counter.
        chain.is_.return_value = chain
        chain.limit.return_value = chain
        chain.order.return_value = chain

        def _range_side_effect(start, end):
            range_call_count[name] += 1
            sliced = MagicMock()
            sliced.execute.return_value = MagicMock(data=final_data[start:end + 1])
            return sliced

        chain.range.side_effect = _range_side_effect
        chain.execute.return_value = MagicMock(data=final_data)
        return chain

    chains = {
        "match_decisions": _passthrough_chain(intros),
        "match_batches": _make_counting_chain("match_batches", batches),
        "match_candidates": _make_counting_chain("match_candidates", candidates),
    }
    sb = MagicMock()
    sb.table.side_effect = lambda name: chains[name]

    with patch("services.db.get_supabase", return_value=sb):
        compute_hit_rate_metrics(lookback_days=28)

    # 5 allocators, all in a single .in_() filter; pagination is 1 page
    # because the test data is well under page_size=1000. If anyone
    # reverts to per-batch lookups, this becomes >=5.
    assert range_call_count["match_batches"] == 1, (
        f"match_batches should be one query (then 1 pagination page) "
        f"per call to compute_hit_rate_metrics; got "
        f"{range_call_count['match_batches']} pages — possible N+1 regression"
    )
    assert range_call_count["match_candidates"] == 1, (
        f"match_candidates should be one query (then 1 pagination page) "
        f"per call; got {range_call_count['match_candidates']} pages"
    )


# ─── audit-2026-05-07 C-0231 — match_batches must be bounded by max intro ─


def test_compute_hit_rate_bounds_match_batches_by_max_intro_ts():
    """audit-2026-05-07 C-0231 regression — pre-fix the paginated
    match_batches SELECT filtered ONLY by `.in_("allocator_id", ...)`,
    pulling the ENTIRE allocator-batch history every call. For a long-
    lived allocator with thousands of historical batches that's quadratic
    memory growth as match_batches fills. The "latest batch before intro"
    lookup only ever consults rows older than the newest intro in this
    window, so the query MUST add `.lt("computed_at", max_intro_ts)` to
    bound the fetch.

    Lock the fix: capture every `.lt(column, value)` call on match_batches
    and assert one of them filters `computed_at` by the max intro
    timestamp."""
    # Two intros at distinct timestamps so the max-intro bound is
    # observable. The newest intro is at 2026-04-10T15:00:00Z.
    intros = [
        _make_intro("alloc-1", "strat-1", "2026-04-07T10:00:00Z"),
        _make_intro("alloc-1", "strat-2", "2026-04-10T15:00:00Z"),
    ]
    batches = [_batch("batch-1", "alloc-1", "2026-04-06T00:00:00Z")]
    candidates = [
        _candidate("batch-1", "strat-1", rank=1),
        _candidate("batch-1", "strat-2", rank=1),
    ]

    lt_filters: list[tuple[str, str]] = []

    def _make_lt_recording_chain(final_data):
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gte.return_value = chain
        chain.in_.return_value = chain
        chain.is_.return_value = chain
        chain.limit.return_value = chain
        chain.order.return_value = chain

        def _lt_side_effect(column, value):
            lt_filters.append((column, value))
            return chain

        chain.lt.side_effect = _lt_side_effect

        def _range_side_effect(start, end):
            sliced = MagicMock()
            sliced.execute.return_value = MagicMock(data=final_data[start:end + 1])
            return sliced

        chain.range.side_effect = _range_side_effect
        chain.execute.return_value = MagicMock(data=final_data)
        return chain

    chains = {
        "match_decisions": _passthrough_chain(intros),
        "match_batches": _make_lt_recording_chain(batches),
        "match_candidates": _passthrough_chain(candidates),
    }
    sb = MagicMock()
    sb.table.side_effect = lambda name: chains[name]

    with patch("services.db.get_supabase", return_value=sb):
        result = compute_hit_rate_metrics(lookback_days=28)

    # Sanity: pipeline still works with the new bound — the batch at
    # 2026-04-06 is strictly less than the max intro at 2026-04-10, so
    # both intros resolve to that batch and hit at rank 1.
    assert result["intros_shipped"] == 2
    assert result["hits_top_3"] == 2

    # The fix: at least one .lt(...) call on match_batches must filter
    # `computed_at` by the newest intro timestamp in the window. Without
    # the bound, lt_filters would be empty and the query would pull the
    # entire allocator history.
    computed_at_bounds = [
        (col, val) for (col, val) in lt_filters if col == "computed_at"
    ]
    assert computed_at_bounds, (
        "match_batches query must .lt('computed_at', max_intro_ts) to "
        "bound the fetch — without this bound the fetch is O(historical "
        f"batches per allocator), not O(window). Got lt filters: {lt_filters}"
    )
    # The bound must use the newest intro's timestamp (so no relevant
    # row is excluded).
    bound_values = [v for (_, v) in computed_at_bounds]
    assert "2026-04-10T15:00:00Z" in bound_values, (
        "the lt bound must be the max intro timestamp in the window "
        f"(2026-04-10T15:00:00Z), got {bound_values}"
    )


def test_paginated_select_raises_on_hard_cap():
    """audit-2026-05-07 #52 regression — pre-fix the helper logged a
    warning and silently sliced. We now raise PaginatedSelectTruncated so
    callers cannot accidentally aggregate over a partial window."""
    from services.db import paginated_select, PaginatedSelectTruncated

    full_page_data = [{"id": f"row-{i}"} for i in range(2)]

    builder = MagicMock()
    builder.order.return_value = builder

    def _range_always_returns_full_page(start, end):
        sliced = MagicMock()
        # Always return a full page so the natural-stop branch never fires
        sliced.execute.return_value = MagicMock(data=full_page_data)
        return sliced

    builder.range.side_effect = _range_always_returns_full_page

    with pytest.raises(PaginatedSelectTruncated) as exc_info:
        # Use tiny page_size and hard_cap_pages so the test runs fast
        paginated_select(
            builder,
            order_by=(("id", False),),
            page_size=2,
            hard_cap_pages=3,
            truncation_hint="test_hint",
        )
    assert exc_info.value.page_count == 3
    assert exc_info.value.page_size == 2
    assert exc_info.value.hint == "test_hint"
    assert "test_hint" in str(exc_info.value)


def test_paginated_select_accepts_composite_order_by():
    """audit-2026-05-07 #27 — the helper must accept a tuple-of-tuples
    ordering shape so callers can ride composite indexes
    (e.g. (allocator_id ASC, computed_at DESC) -> idx_match_batches_allocator_recent).
    Lock that the helper applies each .order() in sequence with the right
    desc flag."""
    from services.db import paginated_select

    recorded: list[tuple[str, bool]] = []
    builder = MagicMock()

    def _order_side_effect(column, *, desc=False, **_kw):
        recorded.append((column, bool(desc)))
        return builder

    builder.order.side_effect = _order_side_effect

    def _range_returns_short_page(start, end):
        sliced = MagicMock()
        sliced.execute.return_value = MagicMock(data=[])  # short page → stop
        return sliced

    builder.range.side_effect = _range_returns_short_page

    rows = paginated_select(
        builder,
        order_by=(("allocator_id", False), ("computed_at", True)),
        page_size=10,
        hard_cap_pages=3,
    )
    assert rows == []
    assert recorded == [("allocator_id", False), ("computed_at", True)]


def test_paginated_select_no_false_positive_at_exact_boundary():
    """Audit-2026-05-07 red-team follow-up — a dataset of EXACTLY
    hard_cap_pages × page_size rows must NOT raise PaginatedSelectTruncated.

    Pre-fix the loop exhausted on a final full page without ever seeing
    a short page, mistaking complete reads at the boundary for truncation.
    The peek-one-extra-page step distinguishes "exactly all rows" (peek
    returns empty → return) from "real overflow" (peek returns more → raise).
    """
    from services.db import paginated_select

    page_size = 2
    hard_cap_pages = 3
    # Total dataset = 6 rows (exactly hard_cap_pages × page_size). The
    # first 3 paginated calls each return a full 2-row page; the boundary
    # peek (call #4) must return empty → no raise.
    pages: list[list[dict]] = [
        [{"id": "row-0"}, {"id": "row-1"}],
        [{"id": "row-2"}, {"id": "row-3"}],
        [{"id": "row-4"}, {"id": "row-5"}],
        [],  # boundary peek → empty
    ]
    call_count = {"n": 0}

    builder = MagicMock()
    builder.order.return_value = builder

    def _range_side_effect(start, end):
        idx = call_count["n"]
        call_count["n"] += 1
        sliced = MagicMock()
        sliced.execute.return_value = MagicMock(
            data=pages[idx] if idx < len(pages) else []
        )
        return sliced

    builder.range.side_effect = _range_side_effect

    rows = paginated_select(
        builder,
        order_by=(("id", False),),
        page_size=page_size,
        hard_cap_pages=hard_cap_pages,
        truncation_hint="boundary_test",
    )
    assert len(rows) == 6, (
        f"Expected all 6 rows returned at exact boundary; got {len(rows)}: {rows}"
    )
    assert call_count["n"] == 4, (
        f"Expected 3 paginated calls + 1 boundary peek = 4; got {call_count['n']}"
    )
