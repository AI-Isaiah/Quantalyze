"""WR-01 (Phase 164.6.6.2.2): a blend's risk is annualized on the blend's clock.

Founder rule: risk is annualized by frequency. Crypto trades every calendar day
(365), traditional markets on weekdays (252), and a BLEND uses 365 if ANY leg is
crypto. Returns annualize on the calendar and are not touched here.

Why this matters: the blend scorers (optimizer, bridge, simulator) hardcoded
sqrt(252), so a crypto book's Sharpe was understated by sqrt(252/365) = 0.831 (a
17% understatement). The numbers looked credible, which is what made the defect
user-facing once the stored curves became real daily returns.

Every expectation below is an INDEPENDENT numpy oracle (mean / std(ddof=1) *
sqrt(clock) over a blend built in the test), never the production helper, and the
crypto cases also assert the answer is NOT the sqrt(252) one, so a scorer that
keeps its hardcoded clock cannot pass.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from services.bridge_scoring import find_replacement_candidates
from services.metrics import blend_periods_per_year
from services.portfolio_optimizer import _compute_sharpe, find_improvement_candidates
from services.simulator_scoring import simulate_add_candidate

_N = 90

# (book asset classes, candidate asset class, expected clock). The mixed rows are
# the ones the founder rule exists for: ONE crypto leg anywhere makes the blend 365.
_CLOCK_CASES = [
    pytest.param(("crypto", "crypto"), "crypto", 365, id="crypto-blend-sqrt365"),
    pytest.param(("traditional", "traditional"), "traditional", 252, id="traditional-blend-sqrt252"),
    pytest.param(("traditional", "traditional"), "crypto", 365, id="crypto-candidate-makes-blend-365"),
    pytest.param(("traditional", "crypto"), "traditional", 365, id="mixed-book-is-365"),
]


def _rets(seed: int, mu: float = 0.001, sigma: float = 0.02) -> pd.Series:
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-01", periods=_N, freq="D")
    return pd.Series(rng.normal(mu, sigma, _N), index=dates)


def _oracle_sharpe(r: pd.Series, clock: int) -> float:
    """mean / std(ddof=1) * sqrt(clock), spelled out so no production code is in it."""
    return float(np.mean(r.to_numpy()) / np.std(r.to_numpy(), ddof=1) * math.sqrt(clock))


def _book() -> dict[str, pd.Series]:
    return {"a": _rets(1, mu=0.0012), "b": _rets(2, mu=0.0008)}


def _classes(book_classes: tuple[str, str], cand_class: str) -> dict[str, str]:
    return {"a": book_classes[0], "b": book_classes[1], "cand": cand_class}


class TestBlendClock:
    def test_crypto_only_is_365(self):
        assert blend_periods_per_year(["crypto", "crypto"]) == 365

    def test_traditional_only_is_252(self):
        assert blend_periods_per_year(["traditional", "traditional"]) == 252

    def test_one_crypto_leg_makes_the_blend_365(self):
        assert blend_periods_per_year(["traditional", "crypto", "traditional"]) == 365

    def test_unknown_and_empty_read_as_252(self):
        assert blend_periods_per_year([None, None]) == 252
        assert blend_periods_per_year([]) == 252

    def test_compute_sharpe_scales_with_the_clock_it_is_given(self):
        r = _rets(7)
        assert _compute_sharpe(r, periods_per_year=365) == pytest.approx(
            _oracle_sharpe(r, 365), rel=1e-12
        )
        # The default stays the legacy 252 clock.
        assert _compute_sharpe(r) == pytest.approx(_oracle_sharpe(r, 252), rel=1e-12)


class TestOptimizerAnnualizesOnTheBlendClock:
    @pytest.mark.parametrize("book_classes, cand_class, clock", _CLOCK_CASES)
    def test_sharpe_lift_is_on_the_blend_clock(self, book_classes, cand_class, clock):
        book, cand = _book(), _rets(3, mu=0.002)
        weights = {"a": 0.5, "b": 0.5}

        out = find_improvement_candidates(
            book, {"cand": cand}, weights, asset_classes=_classes(book_classes, cand_class)
        )

        baseline = 0.5 * book["a"] + 0.5 * book["b"]
        blend = 0.9 * baseline + 0.1 * cand  # add_weight 0.10 shrinks the book to 0.9
        expected = _oracle_sharpe(blend, clock) - _oracle_sharpe(baseline, clock)
        assert out[0]["sharpe_lift"] == pytest.approx(expected, rel=1e-9)
        if clock == 365:
            wrong = _oracle_sharpe(blend, 252) - _oracle_sharpe(baseline, 252)
            assert out[0]["sharpe_lift"] != pytest.approx(wrong, rel=1e-3)

    def test_without_asset_classes_the_clock_is_the_legacy_252(self):
        book, cand = _book(), _rets(3, mu=0.002)
        out = find_improvement_candidates(book, {"cand": cand}, {"a": 0.5, "b": 0.5})
        baseline = 0.5 * book["a"] + 0.5 * book["b"]
        blend = 0.9 * baseline + 0.1 * cand
        assert out[0]["sharpe_lift"] == pytest.approx(
            _oracle_sharpe(blend, 252) - _oracle_sharpe(baseline, 252), rel=1e-9
        )


class TestBridgeAnnualizesOnTheBlendClock:
    @pytest.mark.parametrize("book_classes, cand_class, clock", _CLOCK_CASES)
    def test_sharpe_delta_is_on_the_blend_clock(self, book_classes, cand_class, clock):
        book, cand = _book(), _rets(3, mu=0.002)
        weights = {"a": 0.5, "b": 0.5}

        # Replace "a" with the candidate: the incumbent's weight moves to it.
        out = find_replacement_candidates(
            book, {"cand": cand}, weights, "a", asset_classes=_classes(book_classes, cand_class)
        )

        old = 0.5 * book["a"] + 0.5 * book["b"]
        new = 0.5 * book["b"] + 0.5 * cand
        expected = _oracle_sharpe(new, clock) - _oracle_sharpe(old, clock)
        assert out[0]["sharpe_delta"] == pytest.approx(expected, rel=1e-9)
        if clock == 365:
            wrong = _oracle_sharpe(new, 252) - _oracle_sharpe(old, 252)
            assert out[0]["sharpe_delta"] != pytest.approx(wrong, rel=1e-3)


class TestSimulatorAnnualizesOnTheBlendClock:
    @pytest.mark.parametrize("book_classes, cand_class, clock", _CLOCK_CASES)
    def test_current_proposed_and_delta_are_on_the_blend_clock(
        self, book_classes, cand_class, clock
    ):
        book, cand = _book(), _rets(3, mu=0.002)

        out = simulate_add_candidate(
            portfolio_returns=book,
            candidate_id="cand",
            candidate_returns=cand,
            weights={"a": 0.5, "b": 0.5},
            asset_classes=_classes(book_classes, cand_class),
        )

        current = 0.5 * book["a"] + 0.5 * book["b"]
        proposed = 0.9 * current + 0.1 * cand
        assert out["status"] == "ok"
        assert out["current"]["sharpe"] == pytest.approx(_oracle_sharpe(current, clock), rel=1e-9)
        assert out["proposed"]["sharpe"] == pytest.approx(_oracle_sharpe(proposed, clock), rel=1e-9)
        assert out["deltas"]["sharpe_delta"] == pytest.approx(
            _oracle_sharpe(proposed, clock) - _oracle_sharpe(current, clock), rel=1e-9
        )
        if clock == 365:
            assert out["current"]["sharpe"] != pytest.approx(
                _oracle_sharpe(current, 252), rel=1e-3
            )
