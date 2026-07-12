"""Phase 19.1 / CSV → analytics pipeline Plan 02 Task 2.

Tests for run_csv_strategy_analytics — the runner the worker calls for
source='csv' strategies. Re-derived from PR #270 commit 06c38b80 plus
PR #273 hardening (01cbea60).

Coverage:
  - happy path: rows → complete + csv_source=True
  - insufficient history: 1 row → 400 + computation_status=failed
  - benchmark unavailable: stale fetch → complete + benchmark_unavailable
  - PR #273 (T-19.1-03): _mark_unrecoverable upsert fails →
    logger.warning fires BEFORE re-raise; outer 500 still propagates
  - sparse calendar: 60 weekday-only rows complete without raising
"""
from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi import HTTPException

from services.metrics import MetricsResult


def _make_supabase_mock(rows: list[dict]) -> MagicMock:
    """Build a Supabase client mock matching the get_supabase() shape used
    in analytics_runner.py.

    Supports two read patterns:
      1.  .select(...).eq(...).order(...).execute() — legacy direct
          callers (e.g. the strategy-existence probe via .single()).
      2.  .select(...).eq(...).order(...).range(start, end).execute() —
          the WR-02 paginated_select helper used by _load_series. The
          ``range`` page returns ``rows`` once; on the next iteration
          ``paginated_select`` sees len(chunk) < page_size (1000) and
          terminates, so the same mock works for tests that use ≤ 1000
          rows without faking page boundaries explicitly.
    """
    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table

    # .upsert(...).execute() returns a non-erroring MagicMock by default.
    table.upsert.return_value = MagicMock(execute=MagicMock())

    # .select(...).eq(...).order(...).execute() returns the seeded rows.
    select_chain = MagicMock()
    eq_chain = MagicMock()
    order_chain = MagicMock()
    order_chain.execute.return_value = MagicMock(data=rows)
    eq_chain.order.return_value = order_chain
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain

    # WR-01 strategy-existence probe: .select(...).eq(...).single().execute().
    # MEDIUM-1 (v1.9): the runner now reads `api_key_id` off this row to gate the
    # broker-vs-user-CSV NaN reinstatement. Wire a REAL dict (api_key_id=None →
    # user-CSV branch, no reinstatement) so the shared mock preserves today's
    # behavior; broker-sourced tests use _make_broker_supabase_mock below.
    eq_chain.single.return_value = MagicMock(
        execute=MagicMock(
            return_value=MagicMock(
                data={"id": "s", "user_id": "u", "api_key_id": None}
            )
        )
    )

    # WR-02 (19.1-REVIEW): paginated_select calls .order(...).range(s, e)
    # .execute(). Wire the same rows on the range chain so the first
    # page returns everything; paginated_select then short-circuits on
    # the partial-page signal (len(chunk) < 1000).
    range_chain = MagicMock()
    range_chain.execute.return_value = MagicMock(data=rows)
    order_chain.range.return_value = range_chain

    # .rpc(...).execute() — used by the sibling_kinds batch upsert path.
    sb.rpc.return_value = MagicMock(execute=MagicMock())
    return sb


def _make_metrics_result() -> MetricsResult:
    """compute_all_metrics output stub — minimal shape that satisfies the
    runner's payload spread (no sibling_kinds → no batch RPC fired)."""
    return MetricsResult(
        metrics_json={
            "cumulative_return": 0.1,
            "cagr": 0.12,
            "volatility": 0.2,
            "sharpe": 1.5,
            "sortino": 2.0,
            "calmar": 1.0,
            "max_drawdown": -0.05,
            "max_drawdown_duration_days": 5,
            "six_month_return": 0.06,
            "sparkline_returns": [],
            "sparkline_drawdown": [],
            "metrics_json": {},
            "returns_series": [],
            "drawdown_series": [],
            "monthly_returns": {},
            "rolling_metrics": {},
            "return_quantiles": {},
        },
        sibling_kinds={},
    )


@pytest.mark.asyncio
async def test_csv_analytics_happy_path() -> None:
    """Test 1 — 15 rows of daily_returns + benchmark available →
    computation_status='complete', data_quality_flags.csv_source=True,
    trade_metrics/volume_metrics/exposure_metrics all None."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ] * 5  # 15 rows
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(pd.Series([0.001] * 15), False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result == {"status": "complete", "strategy_id": "test-strategy-uuid"}

    upsert_calls = sb.table.return_value.upsert.call_args_list
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    assert len(completed) >= 1, "Expected at least one upsert with status='complete'"
    payload = completed[0].args[0]
    assert payload["data_quality_flags"] == {"csv_source": True}
    assert payload["trade_metrics"] is None
    assert payload["volume_metrics"] is None
    assert payload["exposure_metrics"] is None
    assert payload["computation_error"] is None


@pytest.mark.asyncio
async def test_csv_analytics_insufficient_history() -> None:
    """Test 2 — 1 row → HTTPException(400) AND a final upsert sets
    computation_status='failed' with 'Insufficient CSV history' in the
    computation_error string."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [{"date": "2024-01-01", "daily_return": 0.005}]  # only 1 row
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    assert exc_info.value.status_code == 400
    assert "Insufficient CSV history" in exc_info.value.detail

    upsert_calls = sb.table.return_value.upsert.call_args_list
    failed = [c for c in upsert_calls if c.args[0].get("computation_status") == "failed"]
    assert len(failed) >= 1, "Expected at least one upsert with status='failed'"
    assert "Insufficient CSV history" in failed[0].args[0]["computation_error"]
    # WR-05 (19.1-REVIEW): csv_source provenance flag must survive the
    # insufficient-history failure path so the owner UI renders the
    # "CSV upload failed" pill, not the generic "missing data" copy.
    assert failed[0].args[0].get("data_quality_flags") == {"csv_source": True}
    # SI-02 (MEDIUM-2, v1.9): a runner-owned terminal 'failed' stamp MUST clear
    # the runner-owned computation_warned marker. If a prior run left the marker
    # TRUE (complete_with_warnings), the status bridge branches (a)/(c) read the
    # marker and would RESURRECT complete_with_warnings over this genuine failure
    # (stale metrics for a failed strategy). Clearing it here lets the bridge
    # resolve 'failed'. Neuter: drop `"computation_warned": False` from the
    # source stamp → marker survives TRUE → resurrection → this assert reddens.
    assert failed[0].args[0].get("computation_warned") is False, (
        "insufficient-history 'failed' stamp must set computation_warned=False "
        "(SI-02 stale-marker resurrection guard)"
    )


@pytest.mark.asyncio
async def test_csv_analytics_benchmark_unavailable() -> None:
    """Test 3 — benchmark fetch raises → runner still completes with
    data_quality_flags={csv_source=True, benchmark_unavailable=True,
    benchmark_note=...}."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(side_effect=Exception("benchmark down"))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result["status"] == "complete"
    upsert_calls = sb.table.return_value.upsert.call_args_list
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    flags = completed[0].args[0]["data_quality_flags"]
    assert flags.get("csv_source") is True
    assert flags.get("benchmark_unavailable") is True
    assert "benchmark_note" in flags


@pytest.mark.asyncio
async def test_mark_unrecoverable_preserves_pre_stamped_guard_flags() -> None:
    """mig 20260707120000 — a transient CSV-run failure must NOT wipe the
    NAV_TWR_GUARD_KEYS that derive_broker_dailies pre-stamped. Pre-fix,
    _mark_unrecoverable wrote {csv_source:True} WHOLESALE, so the failed_retry's
    attempt 2 saw no guard flags → _warned=False → a clean 'complete' over a
    guard-refused series (the exact laundering class the migration kills). The
    failed stamp must READ-MODIFY-WRITE so the retry re-derives
    complete_with_warnings."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5  # 10 rows — past the insufficient-history gate
    sb = _make_supabase_mock(rows)
    # derive_broker_dailies already pre-stamped a NAV guard onto the row; both
    # _read_existing_flags (success path) and _mark_unrecoverable (failure path)
    # read it via .select(...).eq(...).maybe_single().execute().
    sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value = MagicMock(
        execute=MagicMock(
            return_value=MagicMock(
                data={
                    "data_quality_flags": {
                        "negative_nav_guard": True,
                        "csv_source": True,
                    }
                }
            )
        )
    )

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(pd.Series([0.001] * 10), False))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=RuntimeError("transient blip mid-compute")):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    assert exc_info.value.status_code == 500

    upsert_calls = sb.table.return_value.upsert.call_args_list
    failed = [c for c in upsert_calls if c.args[0].get("computation_status") == "failed"]
    assert len(failed) >= 1, "Expected the unrecoverable-failure stamp"
    flags = failed[0].args[0]["data_quality_flags"]
    # The pre-stamped NAV guard SURVIVES the failure stamp (pre-fix: wiped).
    assert flags.get("negative_nav_guard") is True, (
        "the NAV guard pre-stamp must survive so the failed_retry re-derives "
        "complete_with_warnings; pre-fix the wholesale write laundered it"
    )
    assert flags.get("csv_source") is True
    # SI-02 (MEDIUM-2): the unrecoverable 'failed' stamp clears the runner-owned
    # marker so the bridge cannot resurrect complete_with_warnings.
    assert failed[0].args[0].get("computation_warned") is False, (
        "_mark_unrecoverable 'failed' stamp must set computation_warned=False "
        "(SI-02 stale-marker resurrection guard)"
    )


@pytest.mark.asyncio
async def test_mark_unrecoverable_logs_warning_before_reraise(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test 4 — PR #273 / T-19.1-03 mitigation. When compute_all_metrics
    raises AND the failure-path _mark_unrecoverable upsert ALSO raises
    (simulating DB unreachable), the runner must log a logger.warning
    referencing strategy_id and the inner exception BEFORE re-raising
    the outer 500 HTTPException. Without this log evidence, a stuck
    'computing' row leaves operators blind.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    sb = _make_supabase_mock(rows)

    # WR-06 (19.1-REVIEW): route side-effects by the named callable
    # being dispatched, NOT by call-counter position. Counter-based
    # routing silently broke whenever the runner gained a new db_execute
    # call (e.g. the WR-01 strategy-existence probe) — the third call
    # would no longer be _mark_unrecoverable and the warning under test
    # would no longer fire. Naming the callable lets the test detect the
    # specific failing path regardless of how many db_execute calls
    # surround it.

    async def _side_effect_db_execute(fn):
        name = getattr(fn, "__name__", "")
        if name == "_load_series":
            # WR-02: _load_series now returns the rows list directly
            # (paginated_select contract), not a Supabase response wrapper.
            return rows
        if name == "_mark_unrecoverable":
            # Simulate DB unreachable on the failure-marker write — this
            # is the exact path PR #273's warning protects.
            raise RuntimeError("DB unreachable during mark_unrecoverable")
        # All other db_execute calls (strategy-existence probe,
        # _mark_computing, future helpers) succeed with a benign
        # response object whose .data is a truthy list.
        return MagicMock(data=[{"id": "test-strategy-uuid"}])

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.db_execute",
               side_effect=_side_effect_db_execute), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=RuntimeError("compute_all_metrics blew up")):
        caplog.set_level(logging.WARNING, logger="quantalyze.analytics.runner")
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    # Outer 500 must still re-raise.
    assert exc_info.value.status_code == 500
    assert "CSV analytics computation failed" in exc_info.value.detail

    # PR #273 regression assertion — the warning must fire before re-raise.
    warning_records = [
        r for r in caplog.records
        if r.levelno == logging.WARNING
        and "could not mark strategy" in r.getMessage()
    ]
    assert len(warning_records) == 1, (
        f"Expected exactly one 'could not mark strategy ... unrecoverable' "
        f"warning, got {len(warning_records)}. Records: "
        f"{[r.getMessage() for r in caplog.records]}"
    )
    msg = warning_records[0].getMessage()
    assert "test-strategy-uuid" in msg, (
        f"warning must reference strategy_id, got: {msg!r}"
    )
    assert "DB unreachable during mark_unrecoverable" in msg, (
        f"warning must reference the inner mark_unrecoverable exception, "
        f"got: {msg!r}"
    )


@pytest.mark.asyncio
async def test_csv_analytics_unrecoverable_stamps_csv_source_flag() -> None:
    """WR-05 (19.1-REVIEW). When the runner hits the catch-all
    exception path (compute_all_metrics raises) and successfully writes
    the _mark_unrecoverable row, the persisted row must carry
    data_quality_flags={'csv_source': True} so downstream consumers can
    still render the "CSV upload failed" provenance pill. Without the
    flag the owner UI falls back to generic "missing data" copy and
    the user loses the signal that this strategy came from a CSV
    upload (not an exchange-backed sync) in the first place.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=RuntimeError("compute_all_metrics blew up")):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    assert exc_info.value.status_code == 500

    upsert_calls = sb.table.return_value.upsert.call_args_list
    failed = [c for c in upsert_calls if c.args[0].get("computation_status") == "failed"]
    assert len(failed) >= 1, (
        "Expected at least one failed upsert from _mark_unrecoverable"
    )
    # The LAST failed upsert is the _mark_unrecoverable write (there
    # is no insufficient-history write on this path).
    payload = failed[-1].args[0]
    assert payload.get("data_quality_flags") == {"csv_source": True}, (
        f"_mark_unrecoverable must stamp csv_source=True; got: "
        f"{payload.get('data_quality_flags')!r}"
    )
    assert payload["computation_error"] == "CSV analytics computation failed."
    # SI-02 (MEDIUM-2): the unrecoverable 'failed' stamp clears the marker.
    assert payload.get("computation_warned") is False, (
        "_mark_unrecoverable 'failed' stamp must set computation_warned=False "
        "(SI-02 stale-marker resurrection guard)"
    )


@pytest.mark.asyncio
async def test_csv_analytics_paginated_truncation_writes_specific_error() -> None:
    """WR-03 (19.1-REVIEW). When paginated_select raises
    PaginatedSelectTruncated during _load_series, the runner must:
      1. Persist a specific computation_error mentioning the row cap
         and the truncation hint (operator triage signal).
      2. Stamp data_quality_flags.csv_source=True so the provenance
         pill survives the failure (mirrors WR-05).
      3. Re-raise the typed exception so the worker dispatcher's
         classify_exception can tag it as permanent (no retry on a
         data-shape fault), rather than downgrading it to the catch-
         all "CSV analytics computation failed." 500 → indefinite retry.
    """
    from services.analytics_runner import (
        PaginatedSelectTruncated,
        run_csv_strategy_analytics,
    )

    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table
    table.upsert.return_value = MagicMock(execute=MagicMock())
    # Strategy probe must succeed so we reach _load_series.
    select_chain = MagicMock()
    eq_chain = MagicMock()
    eq_chain.single.return_value.execute.return_value = MagicMock(
        data={"id": "trunc-strategy-uuid", "user_id": "u"}
    )
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain

    trunc = PaginatedSelectTruncated(
        page_count=1000, page_size=1000,
        hint="csv_daily_returns strategy_id=trunc-strategy-uuid",
    )

    async def _side_effect_db_execute(fn):
        name = getattr(fn, "__name__", "")
        if name == "_load_series":
            raise trunc
        # All other callables (strategy probe lambda, _mark_computing,
        # _mark_truncated) run for real against the supabase mock so
        # we can assert on the resulting upsert.
        return fn()

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.db_execute",
               side_effect=_side_effect_db_execute):
        with pytest.raises(PaginatedSelectTruncated):
            await run_csv_strategy_analytics("trunc-strategy-uuid")

    # _mark_truncated must have written a failed row with a specific
    # error mentioning the row cap + provenance flag.
    failed = [
        c for c in table.upsert.call_args_list
        if c.args[0].get("computation_status") == "failed"
    ]
    assert len(failed) == 1, (
        f"Expected exactly one failed upsert from _mark_truncated, "
        f"got {len(failed)}"
    )
    payload = failed[0].args[0]
    assert "1,000,000" in payload["computation_error"] or "1000000" in payload["computation_error"], (
        f"computation_error must cite the row cap; got: "
        f"{payload['computation_error']!r}"
    )
    assert payload["data_quality_flags"] == {"csv_source": True}, (
        f"WR-05 provenance flag must survive truncation; got: "
        f"{payload.get('data_quality_flags')!r}"
    )
    # SI-02 (MEDIUM-2): the truncation 'failed' stamp clears the marker.
    assert payload.get("computation_warned") is False, (
        "_mark_truncated 'failed' stamp must set computation_warned=False "
        "(SI-02 stale-marker resurrection guard)"
    )


@pytest.mark.asyncio
async def test_csv_analytics_missing_strategy_raises_404() -> None:
    """Test 6 — WR-01 (19.1-REVIEW). A strategy_id that does not exist in
    the `strategies` table must raise HTTPException(404) BEFORE the
    runner touches strategy_analytics. Without this probe, a deleted-
    between-enqueue-and-dispatch race would land a spurious
    strategy_analytics row and then fail with a misleading
    "Insufficient CSV history" 400.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table

    # Strategy probe path: .table("strategies").select(...).eq(...).single().execute()
    # returns data=None to simulate a missing strategy.
    select_chain = MagicMock()
    eq_chain = MagicMock()
    single_chain = MagicMock()
    single_chain.execute.return_value = MagicMock(data=None)
    eq_chain.single.return_value = single_chain
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain
    # Upsert chain — should never fire on the 404 path, but configure
    # it so an accidental call doesn't AttributeError and mask the bug.
    table.upsert.return_value = MagicMock(execute=MagicMock())

    with patch("services.analytics_runner.get_supabase", return_value=sb):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("deleted-strategy-uuid")

    assert exc_info.value.status_code == 404
    assert "Strategy not found" in exc_info.value.detail
    # Spurious strategy_analytics upsert must NOT have been written —
    # the probe gates the entire pipeline.
    upsert_calls = table.upsert.call_args_list
    assert len(upsert_calls) == 0, (
        f"Missing strategy must not trigger any strategy_analytics upsert; "
        f"got {len(upsert_calls)} call(s)"
    )


@pytest.mark.asyncio
async def test_csv_analytics_sparse_calendar_completes() -> None:
    """Test 5 — 60 weekday-only rows skipping weekends complete without
    raising. compute_all_metrics is mocked because we are pinning the
    runner's gappy-series handling, not the underlying math."""
    from services.analytics_runner import run_csv_strategy_analytics

    # 60 weekdays (Mon-Fri), starting Mon 2024-01-01.
    dates = pd.bdate_range("2024-01-01", periods=60).strftime("%Y-%m-%d").tolist()
    rows = [
        {"date": d, "daily_return": (0.001 if i % 2 == 0 else -0.002)}
        for i, d in enumerate(dates)
    ]
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(pd.Series([0.0005] * 60), False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result["status"] == "complete"
    upsert_calls = sb.table.return_value.upsert.call_args_list
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    assert len(completed) >= 1, "Sparse-calendar series must complete cleanly"


# ---------------------------------------------------------------------------
# Phase 74 Wave 0 — NaN-tolerance characterization of the two downstream sinks
# ---------------------------------------------------------------------------
# RESEARCH A1 / Pitfall 3: the flow-aware core (nav_twr.chain_linked_twr) emits
# np.nan on a guarded day (estimated_start<=0 -> negative_nav_guard, dust,
# flow-dominated) instead of silently substituting a floor. Before 74-02 flips
# the shared path, we must KNOW whether a returns Series carrying leading AND
# interior NaN survives each downstream sink WITHOUT crashing and WITHOUT
# fabricating a magnitude. This test pins TODAY's behavior of sink (a) — the
# analytics_runner path (compute_all_metrics + compute_period_returns). The
# sink (b) finding (the csv_daily_returns float(val) upsert) is asserted at the
# JSON-transport boundary below. Both findings are written into 74-01-SUMMARY.md
# as the authoritative input to plans 74-03 and 74-04.
class TestNaNReturnsDownstreamTolerance:
    """Characterization pins for a guarded-day NaN-bearing returns Series.

    Sink (a) — compute_all_metrics / compute_period_returns: TOLERATES.
        NaN days are honestly EXCLUDED from the headline scalars (DQ-03 §6.2:
        the cumulative_return compounds the post-last-interior-break suffix;
        skipna .prod() for the MTD/YTD window KPIs) and treated as 0.0 for
        chart-only equity (fillna(0)); a NaN LAST day nulls return_24h via
        _safe_float. len() counts NaN entries so the `len(returns) < 2` guard is
        not tripped by guarded days. No fabricated magnitude is ever produced.

    Sink (b) — csv_daily_returns `float(val)` upsert (job_worker.py:2068/2078):
        NEEDS-A-GUARD. The column is DOUBLE PRECISION (stores NaN fine), but the
        postgrest-py/httpx JSON serializer raises on a non-finite float BEFORE
        the request is sent, so a guarded-day NaN CRASHES the upsert fail-loud
        rather than persisting silently. Guard: skip NaN rows in the upsert
        list-comprehension at job_worker.py:2062-2082 (a guarded day has no
        interpretable return -> it is ABSENT, not stored). Localizable there.
    """

    @staticmethod
    def _nan_bearing_returns() -> pd.Series:
        """A 24/7 daily float Series in the exact shape the flow-aware core
        emits for an estimated_start<=0 account: a LEADING guarded day (NaN),
        an INTERIOR guarded day (NaN), and real returns on the rest."""
        import numpy as np

        idx = pd.date_range("2026-01-01", periods=6, freq="D")
        vals = [np.nan, 0.01, np.nan, -0.02, 0.03, 0.015]
        return pd.Series(vals, index=idx, name="returns").astype("float64")

    def test_nan_returns_downstream_tolerance(self) -> None:
        """Sink (a): compute_all_metrics + compute_period_returns TOLERATE a
        leading+interior NaN series — no crash, and the NaN days are dropped/
        zeroed honestly (never surfaced as a fabricated number)."""
        import numpy as np

        from services.metrics import compute_all_metrics, _safe_float
        from services.portfolio_metrics import compute_period_returns

        returns = self._nan_bearing_returns()

        # --- compute_all_metrics: does NOT crash despite 2 NaN days. ---
        # (len counts NaN entries, so the `len(returns) < 2` precondition is
        #  satisfied by the 6-row series even though only 4 days are real.)
        result = compute_all_metrics(returns)

        # DQ-03 (§6.2): the headline cumulative_return no longer BRIDGES an
        # interior break — it compounds ONLY the maximal contiguous suffix after
        # the LAST interior NaN (index 2 here), proving NaN is honestly excluded
        # (never coerced to 0.0, never propagated as a NaN headline). The leading
        # NaN (index 0) is not an interior break; the suffix is [index 3..5].
        expected_headline = float((1.0 + returns.iloc[3:]).prod() - 1.0)
        assert result["cumulative_return"] == pytest.approx(expected_headline, rel=1e-12)
        assert np.isfinite(result["cumulative_return"]), (
            "headline cumulative_return must be finite (NaN days dropped, not "
            "propagated) — a NaN scalar would render as an invalid factsheet KPI"
        )

        # --- compute_period_returns: NaN days skipped, not fabricated. ---
        # MTD/YTD are WINDOW KPIs (portfolio_metrics.compute_period_returns), out
        # of §6's headline-chain scope: they compound via skipna .prod() over the
        # whole window (the dropna-bridge), unchanged by DQ-03. So they equal the
        # dropna cumulative for this single-month/single-year window.
        expected_bridge = float((1.0 + returns.dropna()).prod() - 1.0)
        periods = compute_period_returns(returns)
        assert periods["return_mtd"] == pytest.approx(expected_bridge, rel=1e-12)
        assert periods["return_ytd"] == pytest.approx(expected_bridge, rel=1e-12)
        # Last day is real (0.015) -> return_24h is that value, unmodified.
        assert periods["return_24h"] == pytest.approx(0.015, rel=1e-12)

        # A guarded LAST day nulls return_24h honestly (None), never a fabricated
        # number: _safe_float(nan) -> None is the honest "no interpretable value".
        last_nan = returns.copy()
        last_nan.iloc[-1] = np.nan
        assert compute_period_returns(last_nan)["return_24h"] is None
        assert _safe_float(float("nan")) is None

    def test_nan_return_upsert_serialization_fails_loud(self) -> None:
        """Sink (b): the csv_daily_returns `float(val)` upsert. The column is
        DOUBLE PRECISION (stores NaN), but the postgrest-py/httpx JSON encoder
        rejects a non-finite float BEFORE the request leaves the process — so a
        guarded-day NaN would CRASH the upsert fail-loud, not persist silently.

        This pins WHY 74-02/74-03 must skip NaN rows in the upsert
        list-comprehension (job_worker.py:2062-2082): the current path cannot
        even transmit a NaN daily_return, and a persisted NaN would be a
        fabricated magnitude for any naive reader of csv_daily_returns."""
        import httpx
        import numpy as np

        # `float(val)` on a numpy NaN does NOT crash at the Python conversion —
        # the failure is downstream at JSON encode (the exact upsert payload).
        val = np.float64(np.nan)
        assert isinstance(float(val), float)  # no crash at job_worker.py:2068

        # The upsert payload shape (one row of the list-comprehension). httpx is
        # the transport postgrest-py 2.31.0 uses; it raises on non-finite floats.
        row_payload = {"strategy_id": "x", "date": "2026-01-01", "daily_return": float(val)}
        with pytest.raises(ValueError, match="not JSON compliant"):
            httpx.Request("POST", "http://csv-daily-returns.local", json=[row_payload])


# ---------------------------------------------------------------------------
# Phase 74 Plan 04 — estimated_start<=0 account renders honest end-to-end
# ---------------------------------------------------------------------------
class TestNaNAccountHonestEndToEnd:
    """The full honest chain for an estimated_start<=0 broker account:

      combine_realized_and_funding emits guarded-day NaN (the flow-aware core's
      negative_nav_guard) -> the broker upsert (job_worker.py) SKIPS those days
      so csv_daily_returns holds only the finite real days (guarded days ABSENT,
      never a fabricated 0.0, never a crash at the httpx JSON encoder) ->
      run_csv_strategy_analytics computes a FINITE factsheet on the surviving
      days and completes without raising.

    This is truth #3: an estimated_start<=0 account is honest end-to-end — no
    fabricated magnitude, no exception — across the broker + CSV analytics path.

    NOTE on status: the broker->CSV path stamps `complete` (with csv_source),
    NOT `complete_with_warnings`. The NAV-denominator guard keys the honest core
    carries on the meta are surfaced as complete_with_warnings only on the
    run_strategy_analytics (stored-trades) callsite wired in 74-03; the CSV job
    (run_csv_strategy_analytics) re-reads csv_daily_returns and has no access to
    the guard meta, and its _mark_complete overwrites data_quality_flags with
    {csv_source: True}. Carrying the guard flag through the CSV job would require
    modifying analytics_runner.py (explicitly out of this plan's scope). The
    honesty this plan guarantees for the CSV path is the absence of any
    fabricated magnitude and the absence of a crash — asserted below.
    """

    @staticmethod
    def _nan_bearing_returns() -> "pd.Series":
        """estimated_start<=0 shape: leading + interior guarded-day NaN, real
        returns on the rest."""
        import numpy as np

        idx = pd.DatetimeIndex(
            ["2024-05-01", "2024-05-02", "2024-05-03",
             "2024-05-04", "2024-05-05", "2024-05-06"]
        )
        return pd.Series(
            [np.nan, 0.012, np.nan, -0.008, 0.021, 0.004],
            index=idx, dtype="float64",
        )

    async def _run_broker_path(self) -> list[dict]:
        """Stage 1 — run the REAL broker handler and capture the exact
        csv_daily_returns rows it persists for an estimated_start<=0 account."""
        from services.job_worker import (
            DispatchOutcome,
            run_derive_broker_dailies_job,
        )

        capture: dict = {"upserts": [], "rpc_calls": []}
        ctx = MagicMock()
        ctx.exchange = AsyncMock()
        ctx.supabase = MagicMock()
        ctx.key_row = {"id": "key-e2e", "exchange": "binance", "user_id": "user-1"}
        ctx.strategy_row = {"id": "strat-e2e", "user_id": "user-1"}

        def _table(name: str) -> MagicMock:
            tbl = MagicMock()

            def _upsert(payload: object, **kw: object) -> MagicMock:
                capture["upserts"].append((name, payload, kw.get("on_conflict")))
                stub = MagicMock()
                stub.execute.return_value = MagicMock(data=1)
                return stub

            tbl.upsert.side_effect = _upsert
            return tbl

        ctx.supabase.table.side_effect = _table

        def _rpc(name: str, payload: dict) -> MagicMock:
            capture["rpc_calls"].append((name, payload))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        ctx.supabase.rpc.side_effect = _rpc

        combine = MagicMock(
            return_value=(
                self._nan_bearing_returns(),
                {"used_heuristic_capital": False, "negative_nav_guard": True},
            )
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-e2e"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])
        ), patch(
            "services.job_worker.aclose_exchange", new=AsyncMock()
        ), patch(
            "services.exchange.fetch_account_equity_usd",
            new=AsyncMock(return_value=(10000.0, False)),
        ), patch(
            "services.funding_fetch.fetch_funding_binance",
            new=AsyncMock(return_value=[]),
        ), patch(
            "services.broker_dailies.combine_realized_and_funding", new=combine
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ):
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        return csv_upserts[0][1]  # the rows payload

    @pytest.mark.asyncio
    async def test_nan_account_honest_end_to_end(self) -> None:
        import httpx
        import numpy as np

        from services.analytics_runner import run_csv_strategy_analytics

        # Stage 1 — broker path: guarded days ABSENT, only finite days persisted.
        rows = await self._run_broker_path()
        assert [r["date"] for r in rows] == [
            "2024-05-02", "2024-05-04", "2024-05-05", "2024-05-06",
        ], f"guarded-day NaN rows must be absent from csv_daily_returns; got {rows!r}"
        for r in rows:
            assert np.isfinite(r["daily_return"])
        # The persisted payload survives the real httpx JSON encoder that rejects
        # non-finite floats — the 74-01 sink-(b) crash cannot occur.
        httpx.Request("POST", "http://csv-daily-returns.local", json=rows)

        # Stage 2 — CSV analytics runs the REAL compute_all_metrics on the
        # surviving finite days and renders a FINITE factsheet, no exception.
        sb = _make_supabase_mock(rows)
        with patch("services.analytics_runner.get_supabase", return_value=sb), \
             patch("services.analytics_runner.get_benchmark_returns",
                   new=AsyncMock(return_value=(None, True))):
            result = await run_csv_strategy_analytics("strat-e2e")

        assert result["status"] == "complete"

        upsert_calls = sb.table.return_value.upsert.call_args_list
        completed = [
            c for c in upsert_calls
            if c.args[0].get("computation_status") == "complete"
        ]
        assert len(completed) == 1, "estimated_start<=0 account must complete cleanly"
        payload = completed[0].args[0]
        # No fabricated / non-finite magnitude reaches the factsheet KPIs.
        for key in ("cumulative_return", "cagr", "volatility", "max_drawdown"):
            assert np.isfinite(payload[key]), (
                f"{key} must be finite — a guarded day must never surface as a "
                f"fabricated or NaN magnitude; got {payload[key]!r}"
            )
        assert payload["data_quality_flags"]["csv_source"] is True


# ---------------------------------------------------------------------------
# MEDIUM-1 (v1.9, DQ-03) — broker-sourced series reinstate the interior-break
# NaN at the CSV persistence boundary so the headline does NOT bridge the break.
# ---------------------------------------------------------------------------
# Root cause: a guarded interior day (flow-dominated / negative-NAV / dust) is
# np.nan and SKIPPED at the csv_daily_returns write (74-04 NaN policy), so it is
# ABSENT from the stored rows. For a BROKER-sourced series (derive_broker_dailies
# gap-fills to a DENSE daily calendar BEFORE the NaN-skip), an in-span missing
# calendar date can ONLY be a refused/guarded day. If the loader rebuilds the
# series verbatim from the stored (sparse) rows, cumulative_twr_segmented finds no
# NaN and compounds ACROSS the break — the exact bridging DQ-03 forbids. The fix
# reindexes a broker-sourced series to its dense [min,max] span and REINSTATES NaN
# on in-span missing dates before compute_all_metrics, so the segmenter sees the
# break and computes the suffix-only headline.
#
# Distinguisher (gated OFF for genuinely-sparse user CSVs): strategies.api_key_id.
# derive_broker_dailies gates its ENTIRE broker path on api_key_id IS NOT NULL
# (services/job_worker.py:_load_strategy_and_key); a user CSV upload has
# api_key_id IS NULL (the wizard "CSV branch"). A user CSV's missing date is
# legitimately absent (weekend / non-trading day), so it must NOT be NaN-filled.
#
# Neuter: skip the reinstatement (drop the broker reindex at the load boundary)
# → the loaded broker series has no interior NaN → cumulative_twr_segmented
# BRIDGES the break → the broker assert below reddens.


def _make_broker_supabase_mock(
    daily_rows: list[dict],
    *,
    api_key_id: str | None,
    returns_denominator_config: object | None = None,
    existing_flags: dict | None = None,
    asset_class: str | None = None,
) -> MagicMock:
    """Supabase mock whose strategy-existence probe returns a REAL strategy row
    with the given api_key_id (broker when non-None), and whose csv_daily_returns
    load (paginated_select) returns daily_rows. strategy_analytics reads/writes
    are inert. ``returns_denominator_config`` (when not None) is placed on the
    strategy row (the allocated-capital override); ``existing_flags`` seeds the
    _read_existing_flags probe (default empty)."""
    sb = MagicMock()
    # Memoize per-name table mocks so upsert/read call history accumulates on ONE
    # stable mock per table (the runner calls supabase.table("strategy_analytics")
    # many times; a fresh mock per call would scatter the upserts and hide them).
    _tables: dict[str, MagicMock] = {}

    def _table(name: str) -> MagicMock:
        if name in _tables:
            return _tables[name]
        tbl = MagicMock()
        _tables[name] = tbl
        if name == "strategies":
            row = {"id": "s", "user_id": "u", "api_key_id": api_key_id,
                   "asset_class": asset_class}
            if returns_denominator_config is not None:
                row["returns_denominator_config"] = returns_denominator_config
            # .select(...).eq(...).single().execute() → real dict.
            single_exec = MagicMock(return_value=MagicMock(data=row))
            tbl.select.return_value.eq.return_value.single.return_value.execute = (
                single_exec
            )
        elif name == "csv_daily_returns":
            # paginated_select: .select(...).eq(...).order(...).range(s,e).execute().
            eq_chain = tbl.select.return_value.eq.return_value
            order_chain = eq_chain.order.return_value
            order_chain.range.return_value.execute.return_value = MagicMock(
                data=daily_rows
            )
            order_chain.execute.return_value = MagicMock(data=daily_rows)
        elif name == "strategy_analytics":
            # _read_existing_flags: .select(...).eq(...).maybe_single().execute().
            tbl.select.return_value.eq.return_value.maybe_single.return_value.execute = (
                MagicMock(return_value=MagicMock(
                    data={"data_quality_flags": existing_flags or {}}
                ))
            )
            tbl.upsert.return_value = MagicMock(execute=MagicMock())
        else:
            tbl.upsert.return_value = MagicMock(execute=MagicMock())
        return tbl

    sb.table.side_effect = _table
    sb.rpc.return_value = MagicMock(execute=MagicMock())
    return sb


# A broker series that WAS dense [01..05] but whose interior day 03 was a guarded
# NaN → SKIPPED at write → ABSENT from the stored rows. Suffix after the break =
# {04, 05}. Bridged (buggy) product ≠ suffix-only product, so the two are
# distinguishable in the headline.
_BROKER_ROWS_GUARDED_INTERIOR = [
    {"date": "2024-01-01", "daily_return": 0.10},
    {"date": "2024-01-02", "daily_return": 0.10},
    # 2024-01-03 ABSENT — the guarded/NaN interior day.
    {"date": "2024-01-04", "daily_return": 0.20},
    {"date": "2024-01-05", "daily_return": 0.20},
]


@pytest.mark.asyncio
async def test_broker_series_reinstates_interior_nan_suffix_only_headline() -> None:
    """MEDIUM-1: a BROKER-sourced series (api_key_id set) whose interior guarded
    day is absent from csv_daily_returns must have the NaN REINSTATED at load so
    the headline compounds ONLY the post-break suffix (not the bridged product)
    and cumulative_twr_segmented raises twr_chain_broken."""
    import numpy as np
    from services.analytics_runner import run_csv_strategy_analytics
    from services.nav_twr import (
        _last_interior_break_suffix,
        cumulative_twr_segmented,
    )

    captured: dict[str, pd.Series] = {}

    def _spy_compute(returns: pd.Series, benchmark_rets=None, *a, **k):  # type: ignore[no-untyped-def]
        captured["returns"] = returns
        return _make_metrics_result()

    sb = _make_broker_supabase_mock(
        _BROKER_ROWS_GUARDED_INTERIOR, api_key_id="key-123"
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=_spy_compute):
        await run_csv_strategy_analytics("broker-strategy-uuid")

    series = captured["returns"]
    # (1) The interior guarded day is REINSTATED as NaN on the dense calendar.
    ts_03 = pd.Timestamp("2024-01-03")
    assert ts_03 in series.index, (
        "broker load must reindex to the dense [min,max] calendar so the absent "
        f"guarded day is present; got index {list(series.index)!r}"
    )
    assert bool(np.isnan(series.loc[ts_03])), (
        "the in-span missing broker date must be reinstated as NaN (the guard), "
        f"got {series.loc[ts_03]!r}"
    )
    assert int(series.notna().sum()) == 4 and int(series.isna().sum()) == 1

    # (2) The headline compounds ONLY the suffix {04,05}, NOT the bridged product.
    value, flags = cumulative_twr_segmented(series)
    suffix_only = (1.20 * 1.20) - 1.0            # 0.44
    bridged = (1.10 * 1.10 * 1.20 * 1.20) - 1.0  # 0.7424
    assert value == pytest.approx(suffix_only), (
        f"headline must be suffix-only {suffix_only}, not the bridged {bridged}; "
        f"got {value}"
    )
    assert value != pytest.approx(bridged)
    # (3) The chain-break flag is raised by the segmenter.
    assert flags.get("twr_chain_broken") is True, (
        "an interior break must raise twr_chain_broken"
    )
    # (4) The CAGR window is the same suffix (2 days), not the full span.
    cagr_idx = _last_interior_break_suffix(series).index
    assert list(cagr_idx) == [pd.Timestamp("2024-01-04"), pd.Timestamp("2024-01-05")]


@pytest.mark.asyncio
async def test_user_csv_sparse_day_not_nan_filled() -> None:
    """MEDIUM-1 contrast: a USER-uploaded sparse CSV (api_key_id IS NULL) whose
    interior date is genuinely absent must NOT be NaN-filled — the missing day is
    legitimately absent (weekend / non-trading), so the loaded series stays sparse
    and the headline compounds every stored day (no fabricated break)."""
    import numpy as np
    from services.analytics_runner import run_csv_strategy_analytics
    from services.nav_twr import cumulative_twr_segmented

    captured: dict[str, pd.Series] = {}

    def _spy_compute(returns: pd.Series, benchmark_rets=None, *a, **k):  # type: ignore[no-untyped-def]
        captured["returns"] = returns
        return _make_metrics_result()

    # Same rows, but api_key_id=None → user CSV: 2024-01-03 is legitimately absent.
    sb = _make_broker_supabase_mock(
        _BROKER_ROWS_GUARDED_INTERIOR, api_key_id=None
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=_spy_compute):
        await run_csv_strategy_analytics("user-csv-strategy-uuid")

    series = captured["returns"]
    # The user CSV series stays SPARSE — no dense reindex, no reinstated NaN.
    assert pd.Timestamp("2024-01-03") not in series.index, (
        "a user CSV's genuinely-absent day must NOT be reindexed in; the missing "
        f"date must stay absent; got index {list(series.index)!r}"
    )
    assert int(series.isna().sum()) == 0, (
        "a user CSV series must carry NO reinstated NaN (that would corrupt "
        "legitimate sparse data)"
    )
    assert len(series) == 4
    # No fabricated break: the headline compounds all four stored days.
    value, flags = cumulative_twr_segmented(series)
    assert value == pytest.approx((1.10 * 1.10 * 1.20 * 1.20) - 1.0)
    assert "twr_chain_broken" not in flags


# ===========================================================================
# T1 (wiring-seam) — run_csv_strategy_analytics MUST thread the strategy's
# conventions into the SHIPPED compute_all_metrics call. Existing tests patch
# compute_all_metrics with a bare return_value and never inspect call args, so a
# reverted threading would ship the old geometric/calendar/252 defaults green.
# S1 — a malformed config is PERMANENT (422/failed), never transient-retried.
# T6 — the allocated warn flag bridges through to complete_with_warnings.
# ===========================================================================

_ALLOC_CFG_SIMPLE_ACTIVE = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "capital_schedule": [{"effective_from": "2025-08-01", "capital_usd": 1_000_000}],
    "metrics_basis": "active_day",
    "cumulative_method": "simple",
}


def _daily_rows_15() -> list[dict]:
    return [
        {"date": f"2025-08-{d:02d}", "daily_return": 0.001 if d % 2 else -0.0005}
        for d in range(1, 16)
    ]


@pytest.mark.asyncio
async def test_csv_runner_threads_config_into_compute_all_metrics() -> None:
    """T1 [highest]: an api_key_id-bearing strategy with a simple/active_day config
    → compute_all_metrics called with periods_per_year=365, cumulative_method=
    'simple', day_basis='active'. Reverting the threading (defaults) reddens."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1", asset_class="crypto",
        returns_denominator_config=_ALLOC_CFG_SIMPLE_ACTIVE,
    )
    spy = MagicMock(return_value=_make_metrics_result())
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics", spy):
        await run_csv_strategy_analytics("s")

    assert spy.call_count == 1
    kwargs = spy.call_args.kwargs
    assert kwargs["periods_per_year"] == 365
    assert kwargs["cumulative_method"] == "simple"
    assert kwargs["day_basis"] == "active"


@pytest.mark.asyncio
async def test_csv_runner_config_none_broker_is_geometric_calendar_365() -> None:
    """T1 companion (#597): asset_class=crypto + NO config → crypto √365 but the
    DEFAULT geometric/calendar conventions (byte-identical to the pre-Fix-A recompute)."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1", asset_class="crypto"
    )
    spy = MagicMock(return_value=_make_metrics_result())
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics", spy):
        await run_csv_strategy_analytics("s")

    kwargs = spy.call_args.kwargs
    assert kwargs["periods_per_year"] == 365
    assert kwargs["cumulative_method"] == "geometric"
    assert kwargs["day_basis"] == "calendar"


@pytest.mark.asyncio
async def test_csv_runner_no_api_key_is_252() -> None:
    """T1 companion: user CSV (api_key_id None) with no asset_class → 252,
    geometric, calendar."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(_daily_rows_15(), api_key_id=None)
    spy = MagicMock(return_value=_make_metrics_result())
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics", spy):
        await run_csv_strategy_analytics("s")

    kwargs = spy.call_args.kwargs
    assert kwargs["periods_per_year"] == 252
    assert kwargs["cumulative_method"] == "geometric"
    assert kwargs["day_basis"] == "calendar"


@pytest.mark.asyncio
async def test_csv_runner_csv_crypto_is_365() -> None:
    """#597 crux: a CSV-uploaded strategy (api_key_id None) MARKED crypto annualizes
    √365 — the whole point of decoupling the clock from the api_key_id ingestion
    proxy. Reverting to `365 if api_key_id` reddens this (would give 252)."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id=None, asset_class="crypto"
    )
    spy = MagicMock(return_value=_make_metrics_result())
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics", spy):
        await run_csv_strategy_analytics("s")

    assert spy.call_args.kwargs["periods_per_year"] == 365


@pytest.mark.asyncio
async def test_csv_runner_malformed_config_is_permanent_not_transient() -> None:
    """S1: a malformed returns_denominator_config raises
    ReturnsDenominatorConfigError INSIDE the metrics block. The runner must
    disposition it PERMANENT (HTTPException 422 → classify_exception permanent) and
    stamp failed — NOT let the generic `except Exception` downgrade it to a
    transient 500 that retries forever."""
    from services.analytics_runner import run_csv_strategy_analytics

    bad_cfg = {**_ALLOC_CFG_SIMPLE_ACTIVE, "metrics_basis": "not_a_basis"}
    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1", returns_denominator_config=bad_cfg,
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("s")
    assert exc_info.value.status_code == 422  # 4xx → classify_exception PERMANENT
    # A failed stamp with csv_source preserved was written to strategy_analytics.
    sa = sb.table("strategy_analytics")
    upserts = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and c.args[0].get("computation_status") == "failed"
    ]
    assert any(
        u.args[0].get("data_quality_flags", {}).get("csv_source") for u in upserts
    )


@pytest.mark.asyncio
async def test_csv_runner_bridges_mandate_window_excluded_days_warn() -> None:
    """T6 / S3: an existing_flags carrying mandate_window_excluded_days=True bridges
    THROUGH run_csv_strategy_analytics via ALLOCATED_CAPITAL_GUARD_KEYS → the
    completed status is complete_with_warnings and the flag is preserved on the
    persisted data_quality_flags."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        existing_flags={"mandate_window_excluded_days": True},
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("s")

    # (The runner's RETURN value is always {"status": "complete"} by design — the
    # real status lands on the strategy_analytics.computation_status upsert.)
    assert result["strategy_id"] == "s"
    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and c.args[0].get("computation_status") == "complete_with_warnings"
    ]
    assert completed, "expected a complete_with_warnings upsert (S3 bridge)"
    assert completed[0].args[0]["data_quality_flags"].get(
        "mandate_window_excluded_days"
    ) is True


@pytest.mark.asyncio
async def test_noncomposite_rederive_nulls_stale_by_basis() -> None:
    """Finding 5 (non-composite direction): a strategy that STOPS being a composite
    (members removed → single-key path) is re-derived HERE. Its prior row still
    carries a composite metrics_json_by_basis object (incl. a stale mark_to_market
    key) and composite DQ flags. The fresh single-key headline must NULL
    metrics_json_by_basis so a stale composite object can't linger next to a
    single-key headline (silent basis-toggle disagreement). The freshly-built
    data_quality_flags already drops the composite-only flags (wholesale column
    replace). Neuter (drop the null) → the stale object survives → this reddens."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        existing_flags={
            "csv_source": True, "composite": True, "per_key": {},
            "gap_day_count": 3, "mtm_gated_reason": "unsmoothed_options_book",
        },
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        await run_csv_strategy_analytics("was-composite-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    payload = completed[0].args[0]
    # (a) the stale composite by-basis object is nulled (SQL NULL).
    assert "metrics_json_by_basis" in payload
    assert payload["metrics_json_by_basis"] is None
    # (b) the fresh flags drop the composite-only keys (wholesale replace).
    dq = payload["data_quality_flags"]
    assert "composite" not in dq
    assert "per_key" not in dq
    assert "mtm_gated_reason" not in dq


@pytest.mark.asyncio
async def test_pure_single_key_rederive_leaves_by_basis_untouched() -> None:
    """Finding 5 converse: a strategy that was NEVER a composite (no prior
    `composite` flag) must be byte-identical — the single-key recompute must NOT
    add a metrics_json_by_basis=None column write (which would be a behavior change
    on the untouched single-key path). Only a prior-composite row is nulled."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        existing_flags={"csv_source": True},  # never a composite
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        await run_csv_strategy_analytics("pure-single-key-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    assert "metrics_json_by_basis" not in completed[0].args[0], (
        "a never-composite single-key recompute must not touch metrics_json_by_basis"
    )


# ===========================================================================
# Phase 101 Plan 02 (MTM-01) — the broker derive PRESTAMPS
# data_quality_flags.mtm_gated_reason (job_worker._prestamp_dq_flags) when the
# single-key mark_to_market pass structurally degrades, THEN enqueues this CSV
# run. run_csv_strategy_analytics rebuilds data_quality_flags WHOLESALE, so an
# unbridged reason is wiped seconds after being stamped and the Phase-102
# disabled-with-reason UI would read nothing. The bridge carries it
# PRESENT-ONLY + NON-PROMOTING, and EXCLUDES composite→single transitions so a
# stale composite-era reason can't masquerade as a fresh single-key verdict.
# ===========================================================================


@pytest.mark.asyncio
async def test_mtm_gated_reason_survives_finalizer_single_key() -> None:
    """WIRING (load-bearing): a single-key (never-composite) row whose broker
    prestamp carries data_quality_flags.mtm_gated_reason='mtm_summary_coverage_incomplete'
    must STILL carry that reason after the finalizer's wholesale flag rebuild.
    Neuter (delete the present-only carry in run_csv_strategy_analytics) → the
    reason is wiped → this reddens. The assertion pins the imported constant so a
    rename of MTM_REASON_SUMMARY_COVERAGE cannot silently decouple the two sites."""
    from services.analytics_runner import run_csv_strategy_analytics
    from services.stitch_composite import MTM_REASON_SUMMARY_COVERAGE

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        # prestamp shape from a degraded single-key MTM derive (NOT composite).
        existing_flags={
            "csv_source": True,
            "mtm_gated_reason": "mtm_summary_coverage_incomplete",
        },
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        await run_csv_strategy_analytics("single-key-mtm-degraded-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    dq = completed[0].args[0]["data_quality_flags"]
    assert dq.get("mtm_gated_reason") == MTM_REASON_SUMMARY_COVERAGE, (
        "the prestamped single-key mtm_gated_reason must SURVIVE the finalizer's "
        "wholesale data_quality_flags rebuild (Phase-102 reads it); the wholesale "
        f"rebuild wiped it — got {dq!r}"
    )


@pytest.mark.asyncio
async def test_mtm_gated_reason_does_not_promote_status() -> None:
    """NON-PROMOTING: the carried mtm_gated_reason is an availability annotation
    (like insufficient_window / HARD-04), NOT a NAV_TWR_GUARD_KEYS warn flag, so
    it must NEVER promote computation_status to complete_with_warnings nor set the
    runner-owned computation_warned marker. Neuter (add mtm_gated_reason to the
    guard-key promotion loop) → status becomes complete_with_warnings → reddens."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        existing_flags={
            "csv_source": True,
            "mtm_gated_reason": "mtm_summary_coverage_incomplete",
        },
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        await run_csv_strategy_analytics("single-key-mtm-nonpromote-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    payload = completed[0].args[0]
    assert payload["computation_status"] == "complete", (
        "mtm_gated_reason must not promote status (exact-string 'complete', not "
        f"'complete_with_warnings'); got {payload['computation_status']!r}"
    )
    assert payload["computation_warned"] is False, (
        "mtm_gated_reason must not set the runner-owned computation_warned marker"
    )


@pytest.mark.asyncio
async def test_mtm_gated_reason_dropped_on_composite_to_single() -> None:
    """DROP-STALE (exclusion is load-bearing): a row that WAS a composite carrying
    a composite-era mtm_gated_reason must NOT carry it forward into the fresh
    single-key headline — a stale composite verdict must never masquerade as a
    fresh single-key one (mirrors the Finding-5 by-basis NULLing). Neuter (drop the
    `and not _was_composite` exclusion) → the stale reason survives → this reddens.
    metrics_json_by_basis is NULLed by the existing Finding-5 branch (unchanged)."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        existing_flags={
            "csv_source": True,
            "composite": True,
            # a composite-era reason (Phase-90 vocabulary) on the prior row.
            "mtm_gated_reason": "unsmoothed_options_book",
        },
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        await run_csv_strategy_analytics("was-composite-mtm-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    payload = completed[0].args[0]
    assert "mtm_gated_reason" not in payload["data_quality_flags"], (
        "a composite-era mtm_gated_reason must NOT survive into the single-key "
        f"headline; got {payload['data_quality_flags']!r}"
    )
    # the existing Finding-5 branch still NULLs the stale composite by-basis object.
    assert payload.get("metrics_json_by_basis") is None


@pytest.mark.asyncio
async def test_mtm_gated_reason_absence_is_absence() -> None:
    """ABSENCE-IS-ABSENCE: a single-key row with NO prestamped mtm_gated_reason
    must produce fresh flags with NO mtm_gated_reason key (no fabricated reason,
    no None-valued key). Guards against a bridge that unconditionally writes the
    key (e.g. `dq['mtm_gated_reason'] = existing.get(...)` → a None value)."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1",
        existing_flags={"csv_source": True},  # no mtm_gated_reason prestamped
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        await run_csv_strategy_analytics("single-key-no-mtm-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    dq = completed[0].args[0]["data_quality_flags"]
    assert "mtm_gated_reason" not in dq, (
        "no prestamped reason → the key must be ABSENT (not None-valued); "
        f"got {dq!r}"
    )
