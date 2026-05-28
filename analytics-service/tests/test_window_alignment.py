"""B3 (audit-2026-05-07) — window_alignment regression tests.

The shared helper is the single source of truth for the intersection-
of-dates alignment that match_engine and simulator_scoring previously
duplicated. These tests pin (a) the contract returned by
``align_current_and_proposed`` and (b) the structural protection that
NEW-C08-01 / NEW-C11-03 closed: a long-history portfolio + short low-vol
candidate cannot manufacture artificial Sharpe lift because both sides
score on the same intersection window.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from services.window_alignment import (
    AlignmentMetadata,
    align_current_and_proposed,
    overlap_days,
)


def _make_returns(dates: list[str], values: list[float]) -> pd.Series:
    idx = pd.to_datetime(dates)
    return pd.Series(values, index=idx)


def _make_port_df(columns: dict[str, list[float]], dates: list[str]) -> pd.DataFrame:
    idx = pd.to_datetime(dates)
    return pd.DataFrame(columns, index=idx)


class TestAlignCurrentAndProposed:
    """Contract pin for the shared alignment helper."""

    def test_intersection_only_keeps_overlapping_rows(self) -> None:
        # Portfolio has dates 2026-01-01..2026-01-05; candidate has only
        # 2026-01-03..2026-01-07. Intersection is 2026-01-03..2026-01-05
        # (3 days). The helper must return that, not the union.
        port = _make_port_df(
            {"s1": [0.01, 0.01, 0.01, 0.01, 0.01]},
            ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"],
        )
        cand = _make_returns(
            ["2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07"],
            [0.02, 0.02, 0.02, 0.02, 0.02],
        )
        result = align_current_and_proposed(
            port, cand, candidate_id="cand", min_overlap_days=1,
        )
        assert result.overlap_days == 3
        assert result.sufficient is True
        assert list(result.port_aligned.columns) == ["s1"]
        assert len(result.port_aligned) == 3
        assert len(result.candidate_aligned) == 3
        # aligned_concat includes the candidate as the trailing column.
        assert list(result.aligned_concat.columns) == ["s1", "cand"]
        assert list(result.aligned_concat.index) == [
            pd.Timestamp("2026-01-03"),
            pd.Timestamp("2026-01-04"),
            pd.Timestamp("2026-01-05"),
        ]

    def test_dropna_excludes_rows_with_any_nan(self) -> None:
        # A NaN anywhere in port_df OR candidate must drop that row from
        # the intersection — pad/ffill would manufacture observations.
        port = _make_port_df(
            {"s1": [0.01, np.nan, 0.01], "s2": [0.02, 0.02, np.nan]},
            ["2026-01-01", "2026-01-02", "2026-01-03"],
        )
        cand = _make_returns(
            ["2026-01-01", "2026-01-02", "2026-01-03"], [0.03, 0.03, 0.03],
        )
        result = align_current_and_proposed(
            port, cand, candidate_id="cand", min_overlap_days=1,
        )
        # Only 2026-01-01 has all three values non-null.
        assert result.overlap_days == 1
        assert list(result.aligned_concat.index) == [pd.Timestamp("2026-01-01")]

    def test_sufficient_false_when_below_min_overlap_days(self) -> None:
        # Helper must NEVER silently truncate. When the intersection is
        # below the caller-supplied floor, ``sufficient=False`` lets the
        # caller emit its domain-specific "insufficient_data" branch
        # rather than scoring on a sub-floor window.
        port = _make_port_df(
            {"s1": [0.01] * 100},
            pd.date_range("2026-01-01", periods=100, freq="D").strftime("%Y-%m-%d").tolist(),
        )
        cand = _make_returns(
            pd.date_range("2026-04-01", periods=5, freq="D").strftime("%Y-%m-%d").tolist(),
            [0.02] * 5,
        )
        result = align_current_and_proposed(
            port, cand, candidate_id="cand", min_overlap_days=30,
        )
        # 5-day overlap < 30-day floor → not sufficient.
        assert result.overlap_days == 5
        assert result.sufficient is False
        # Helper still returned the aligned frames so caller can render
        # disclosure ("scored over 5 days; need 30") without re-joining.
        assert len(result.port_aligned) == 5
        assert len(result.candidate_aligned) == 5

    def test_b3_no_artificial_sharpe_lift_from_truncated_window(self) -> None:
        # NEW-C08-01 / NEW-C11-03 regression. The pre-fix bug: portfolio
        # scored its Sharpe over the FULL history (100 days, ~normal
        # vol), while the proposed-portfolio was scored over the
        # candidate's short low-vol window (30 days). The delta
        # manufactured a Sharpe lift that wasn't real — just regime
        # mismatch.
        #
        # With the shared alignment helper, BOTH the current_port
        # baseline AND the proposed_port baseline must use
        # ``alignment.port_aligned`` (intersection only). A test that
        # uses the helper correctly produces zero artificial lift when
        # the candidate equals the portfolio over the intersection.
        port = _make_port_df(
            {"s1": np.random.RandomState(42).randn(100).tolist()},
            pd.date_range("2026-01-01", periods=100, freq="D").strftime("%Y-%m-%d").tolist(),
        )
        # Candidate has exactly the same returns as s1 over a 30-day
        # tail window. The "proposed" portfolio is functionally
        # identical to current, so the delta MUST be zero.
        tail_dates = pd.date_range("2026-03-12", periods=30, freq="D").strftime("%Y-%m-%d").tolist()
        tail_returns = port["s1"].iloc[-30:].values
        cand = _make_returns(tail_dates, list(tail_returns))

        result = align_current_and_proposed(
            port, cand, candidate_id="cand", min_overlap_days=30,
        )
        assert result.sufficient is True
        # The current-port Sharpe over the intersection must equal the
        # candidate's Sharpe over the same intersection — proves both
        # are computed on the SAME window.
        current_on_intersection = result.port_aligned["s1"]
        candidate_on_intersection = result.candidate_aligned
        # Same data → same Sharpe → zero lift. Use mean/std as a proxy.
        np.testing.assert_array_almost_equal(
            current_on_intersection.values,
            candidate_on_intersection.values,
            decimal=10,
        )


class TestOverlapDaysHelper:
    """The cheap-overlap-count helper used by analytics callers that
    don't need the full alignment frames."""

    def test_portfolio_only_overlap(self) -> None:
        port = _make_port_df(
            {"s1": [0.01, np.nan, 0.01], "s2": [0.02, 0.02, np.nan]},
            ["2026-01-01", "2026-01-02", "2026-01-03"],
        )
        # Only 2026-01-01 has both s1 and s2 non-null.
        assert overlap_days(port) == 1

    def test_portfolio_plus_candidate_overlap(self) -> None:
        port = _make_port_df(
            {"s1": [0.01, 0.01, 0.01]},
            ["2026-01-01", "2026-01-02", "2026-01-03"],
        )
        cand = _make_returns(
            ["2026-01-02", "2026-01-03", "2026-01-04"], [0.02, 0.02, 0.02],
        )
        # Intersection is 2026-01-02..03 (2 days).
        assert overlap_days(port, cand) == 2
