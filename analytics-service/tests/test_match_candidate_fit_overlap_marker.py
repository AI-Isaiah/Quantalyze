"""167.1.1.1 (BRIDGERETURNS) GAP-01: a candidate whose returns share fewer than 30 days with the
book is NAMED, so a null portfolio fit is never an unexplained null.

``score_candidates`` aligns each candidate to the book on their shared days. Under 30 shared days
the fit components (sharpe_lift, corr_reduction, dd_improvement) are correctly null, and before
GAP-01 nothing said why. D-22's book-level ``book_join_marker`` (see
``test_match_book_join_marker.py``) is the naming precedent: the candidate's persisted
``score_breakdown.raw`` now carries ``fit_unavailable_reason`` (``"overlap_below_min"``),
``fit_overlap_days`` and ``fit_min_overlap_days`` on that path only, and ``data_completeness`` is
None there, because it measures the book's own join and must not read complete beside a null fit.

The cause is written to ``raw`` only. ``reasons`` feeds the allocator card and the intro pre-fill,
so arm A also pins that no reason names shared days.

Every date and count below is typed by hand, never derived from the code under test.
Series are non-flat, hand-written formulas:
  book      return_i = 0.002 * ((i % 5) - 2)   + 0.0005   (i = 0.. from the first date)
  candidate return_j = 0.003 * ((j % 4) - 1.5) + 0.0002   (j = 0.. from the first date)
"""

from __future__ import annotations

import json
from typing import Any

import pandas as pd

from routers import match as match_mod
from services import match_engine
from services.match_engine import score_candidates

# The book: one holding, 60 consecutive daily returns, 2026-01-01 .. 2026-03-01 inclusive.
BOOK = pd.Series(
    [0.002 * ((i % 5) - 2) + 0.0005 for i in range(60)],
    index=pd.date_range("2026-01-01", "2026-03-01", freq="D"),
)

REASON_KEYS = ("fit_unavailable_reason", "fit_overlap_days", "fit_min_overlap_days")


def _candidate(sid: str) -> dict[str, Any]:
    return {
        "strategy_id": sid,
        "sharpe": 1.5,
        "track_record_days": 365,
        "max_drawdown_pct": -0.15,
        "manager_aum": 5_000_000,
        "exchange": "binance",
        "strategy_type": "trend_following",
    }


def _candidate_series(start: str, end: str) -> pd.Series:
    index = pd.date_range(start, end, freq="D")
    return pd.Series(
        [0.003 * ((j % 4) - 1.5) + 0.0002 for j in range(len(index))],
        index=index,
    )


def _raw_of(series: pd.Series | None, *, personalized: bool = True) -> dict[str, Any]:
    """Score one candidate against the book and return its persisted ``raw`` after the JSON
    round trip (what the database receives), asserting the candidate was scored."""
    result = score_candidates(
        allocator_id="alloc-1",
        preferences=None,
        portfolio_strategies=[{"strategy_id": "p1"}] if personalized else [],
        portfolio_returns={"p1": BOOK} if personalized else {},
        portfolio_weights={"p1": 1.0} if personalized else {},
        candidate_strategies=[_candidate("c1")],
        candidate_returns={"c1": series} if series is not None else {},
        portfolio_aum=1_000_000,
    )
    assert result["mode"] == ("personalized" if personalized else "screening")
    assert [c["strategy_id"] for c in result["candidates"]] == ["c1"]
    breakdown = json.loads(json.dumps(result["candidates"][0]["score_breakdown"]))
    raw: dict[str, Any] = breakdown["raw"]
    return raw


def _reasons_of(series: pd.Series) -> list[str]:
    result = score_candidates(
        allocator_id="alloc-1",
        preferences=None,
        portfolio_strategies=[{"strategy_id": "p1"}],
        portfolio_returns={"p1": BOOK},
        portfolio_weights={"p1": 1.0},
        candidate_strategies=[_candidate("c1")],
        candidate_returns={"c1": series},
        portfolio_aum=1_000_000,
    )
    return list(result["candidates"][0]["reasons"])


def test_arm_a_eight_shared_days_names_the_cause() -> None:
    # Candidate 2026-02-22 .. 2026-03-17 is 24 returns; the dates it shares with the book
    # (ends 2026-03-01) are 2026-02-22 .. 2026-03-01 = 8.
    series = _candidate_series("2026-02-22", "2026-03-17")
    raw = _raw_of(series)
    assert raw["sharpe_lift"] is None
    assert raw["dd_improvement"] is None
    assert raw["fit_unavailable_reason"] == "overlap_below_min"
    assert raw["fit_overlap_days"] == 8
    assert raw["fit_min_overlap_days"] == 30
    assert raw["data_completeness"] is None
    # The cause is admin-only: it never reaches the allocator-facing reasons.
    for reason in _reasons_of(series):
        assert "shared day" not in reason
        assert "overlap" not in reason.lower()


def test_arm_b_thirty_shared_days_computes_and_carries_no_marker() -> None:
    # 2026-01-31 .. 2026-03-01 is 30 returns, all shared with the book: the boundary computes.
    raw = _raw_of(_candidate_series("2026-01-31", "2026-03-01"))
    assert raw["sharpe_lift"] is not None
    for key in REASON_KEYS:
        assert key not in raw
    assert raw["data_completeness"] == 1.0


def test_arm_c_twenty_nine_shared_days_is_the_boundary_below() -> None:
    # 2026-02-01 .. 2026-03-01 is 29 returns, all shared.
    raw = _raw_of(_candidate_series("2026-02-01", "2026-03-01"))
    assert raw["fit_unavailable_reason"] == "overlap_below_min"
    assert raw["fit_overlap_days"] == 29
    assert raw["fit_min_overlap_days"] == 30
    assert raw["data_completeness"] is None


def test_arm_d_screening_mode_carries_no_marker() -> None:
    raw = _raw_of(_candidate_series("2026-02-22", "2026-03-17"), personalized=False)
    for key in REASON_KEYS:
        assert key not in raw


def test_arm_e_one_constant_feeds_both_markers() -> None:
    assert match_engine.PORTFOLIO_FIT_MIN_OVERLAP_DAYS == 30
    assert match_mod._BOOK_JOIN_MIN_DAYS == match_engine.PORTFOLIO_FIT_MIN_OVERLAP_DAYS


def test_arm_f_a_candidate_with_no_returns_series_is_named() -> None:
    # SFH-R5 M1: the candidate is eligible but has NO entry in ``candidate_returns`` (the
    # universe load skipped it, or its USD conversion dropped it). The fit is null, and the
    # persisted raw must say why: zero shared days against the 30 required.
    raw = _raw_of(None)
    assert raw["sharpe_lift"] is None
    assert raw["corr_with_portfolio"] is None
    assert raw["dd_improvement"] is None
    assert raw["fit_unavailable_reason"] == "no_candidate_returns"
    assert raw["fit_overlap_days"] == 0
    assert raw["fit_min_overlap_days"] == 30
    assert raw["data_completeness"] is None
    # Admin-only, like overlap_below_min: no allocator-facing reason names it.
    result = score_candidates(
        allocator_id="alloc-1",
        preferences=None,
        portfolio_strategies=[{"strategy_id": "p1"}],
        portfolio_returns={"p1": BOOK},
        portfolio_weights={"p1": 1.0},
        candidate_strategies=[_candidate("c1")],
        candidate_returns={},
        portfolio_aum=1_000_000,
    )
    for reason in result["candidates"][0]["reasons"]:
        assert "daily returns" not in reason
        assert "shared day" not in reason
        assert "overlap" not in reason.lower()


def test_arm_g_an_empty_returns_series_is_named_like_an_absent_one() -> None:
    raw = _raw_of(pd.Series(dtype=float))
    assert raw["fit_unavailable_reason"] == "no_candidate_returns"
    assert raw["fit_overlap_days"] == 0
    assert raw["fit_min_overlap_days"] == 30
    assert raw["data_completeness"] is None


def test_arm_h_screening_mode_without_a_series_still_carries_no_marker() -> None:
    # Screening never attempts the fit, so a missing series is not a missing-fit cause.
    raw = _raw_of(None, personalized=False)
    for key in REASON_KEYS:
        assert key not in raw
