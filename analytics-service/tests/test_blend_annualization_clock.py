"""WR-01 (Phase 164.6.6.2.2): a blend's risk is annualized on the blend's clock.

Founder rule: risk is annualized by frequency. Crypto trades every calendar day
(365), traditional markets on weekdays (252), and a BLEND uses 365 if ANY leg is
crypto. Returns annualize on the calendar and are not touched here.

Why this matters: the blend scorers (optimizer, bridge, simulator) hardcoded
sqrt(252), so a crypto book's Sharpe was understated by sqrt(252/365) = 0.831 (a
17% understatement). The numbers looked credible, which is what made the defect
user-facing once the stored curves became real daily returns.

D-08 (founder, 2026-10-07, review round 2 R2-01/R2-02): the three candidate
scorers rank and compare on the EXISTING BOOK's clock, never the candidate's.
`blend_clock` is taken over the book legs only (365 if a book leg is crypto, else
252) and BOTH sides of every delta use it, so a candidate's own `asset_class`
never moves a score and "current" Sharpe equals the portfolio headline. The
per-candidate "blend of book + candidate" clock WR-01 first shipped gave a
crypto-tagged copy of a traditional candidate a sqrt(365/252) = 1.2035x Sharpe
bonus from its label alone. The portfolio headline keeps "365 if any leg is
crypto" (routers/portfolio.py) and is not under test here.

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

# (book asset classes, candidate asset class, expected clock). D-08 (2026-10-07):
# the expected clock is the BOOK's clock (ONE crypto book leg makes it 365). The
# candidate's class is varied across every book to prove it never moves the clock;
# the row that used to expect 365 (traditional book, crypto candidate) is now 252.
_CLOCK_CASES = [
    pytest.param(("crypto", "crypto"), "crypto", 365, id="crypto-book-crypto-cand-365"),
    pytest.param(("crypto", "crypto"), "traditional", 365, id="crypto-book-traditional-cand-365"),
    pytest.param(("traditional", "traditional"), "traditional", 252, id="traditional-book-traditional-cand-252"),
    pytest.param(("traditional", "traditional"), "crypto", 252, id="traditional-book-crypto-cand-stays-252"),
    pytest.param(("traditional", "crypto"), "traditional", 365, id="mixed-book-is-365"),
]


def _other_clock(clock: int) -> int:
    """The clock a scorer would wrongly use if it ignored the book's."""
    return 252 if clock == 365 else 365


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


class TestOptimizerAnnualizesOnTheBookClock:
    @pytest.mark.parametrize("book_classes, cand_class, clock", _CLOCK_CASES)
    def test_sharpe_lift_is_on_the_book_clock(self, book_classes, cand_class, clock):
        book, cand = _book(), _rets(3, mu=0.002)
        weights = {"a": 0.5, "b": 0.5}

        out = find_improvement_candidates(
            book, {"cand": cand}, weights, asset_classes=_classes(book_classes, cand_class)
        )

        baseline = 0.5 * book["a"] + 0.5 * book["b"]
        blend = 0.9 * baseline + 0.1 * cand  # add_weight 0.10 shrinks the book to 0.9
        expected = _oracle_sharpe(blend, clock) - _oracle_sharpe(baseline, clock)
        assert out[0]["sharpe_lift"] == pytest.approx(expected, rel=1e-9)
        wrong_clock = _other_clock(clock)
        wrong = _oracle_sharpe(blend, wrong_clock) - _oracle_sharpe(baseline, wrong_clock)
        assert out[0]["sharpe_lift"] != pytest.approx(wrong, rel=1e-3)

    def test_without_asset_classes_the_clock_is_the_legacy_252(self):
        book, cand = _book(), _rets(3, mu=0.002)
        out = find_improvement_candidates(book, {"cand": cand}, {"a": 0.5, "b": 0.5})
        baseline = 0.5 * book["a"] + 0.5 * book["b"]
        blend = 0.9 * baseline + 0.1 * cand
        assert out[0]["sharpe_lift"] == pytest.approx(
            _oracle_sharpe(blend, 252) - _oracle_sharpe(baseline, 252), rel=1e-9
        )


class TestBridgeAnnualizesOnTheBookClock:
    @pytest.mark.parametrize("book_classes, cand_class, clock", _CLOCK_CASES)
    def test_sharpe_delta_is_on_the_book_clock(self, book_classes, cand_class, clock):
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
        wrong_clock = _other_clock(clock)
        wrong = _oracle_sharpe(new, wrong_clock) - _oracle_sharpe(old, wrong_clock)
        assert out[0]["sharpe_delta"] != pytest.approx(wrong, rel=1e-3)


class TestSimulatorAnnualizesOnTheBookClock:
    @pytest.mark.parametrize("book_classes, cand_class, clock", _CLOCK_CASES)
    def test_current_proposed_and_delta_are_on_the_book_clock(
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
        assert out["current"]["sharpe"] != pytest.approx(
            _oracle_sharpe(current, _other_clock(clock)), rel=1e-3
        )


# --- D-08: a candidate's label never moves its score or its rank ------------------

_TRADITIONAL_BOOK = ("traditional", "traditional")
_CRYPTO_BOOK = ("crypto", "crypto")


def _twin_classes(book_classes: tuple[str, str]) -> dict[str, str]:
    """Two candidates with the SAME series, differing only in asset_class."""
    return {
        "a": book_classes[0],
        "b": book_classes[1],
        "twin_crypto": "crypto",
        "twin_traditional": "traditional",
    }


class TestIdenticalCandidatesScoreEqualWhateverTheirLabel:
    """D-08 / R2-01: the label is not performance, so it cannot move a rank."""

    @pytest.mark.parametrize("book_classes", [_TRADITIONAL_BOOK, _CRYPTO_BOOK])
    @pytest.mark.parametrize("order", [("twin_crypto", "twin_traditional"), ("twin_traditional", "twin_crypto")])
    def test_optimizer_scores_label_only_twins_exactly_equal(self, book_classes, order):
        book, cand = _book(), _rets(3, mu=0.002)
        candidates = {sid: cand.copy() for sid in order}

        out = find_improvement_candidates(
            book, candidates, {"a": 0.5, "b": 0.5}, asset_classes=_twin_classes(book_classes)
        )

        by_id = {row["strategy_id"]: row for row in out}
        assert set(by_id) == {"twin_crypto", "twin_traditional"}
        for field in ("score", "sharpe_lift", "dd_improvement", "corr_with_portfolio"):
            assert by_id["twin_crypto"][field] == by_id["twin_traditional"][field], field
        # Equal scores keep the submission order: the label never promotes a twin.
        assert [row["strategy_id"] for row in out] == list(order)

    @pytest.mark.parametrize("book_classes", [_TRADITIONAL_BOOK, _CRYPTO_BOOK])
    @pytest.mark.parametrize("order", [("twin_crypto", "twin_traditional"), ("twin_traditional", "twin_crypto")])
    def test_bridge_scores_label_only_twins_exactly_equal(self, book_classes, order):
        book, cand = _book(), _rets(3, mu=0.002)
        candidates = {sid: cand.copy() for sid in order}

        out = find_replacement_candidates(
            book, candidates, {"a": 0.5, "b": 0.5}, "a", asset_classes=_twin_classes(book_classes)
        )

        by_id = {row["strategy_id"]: row for row in out}
        assert set(by_id) == {"twin_crypto", "twin_traditional"}
        for field in ("composite_score", "sharpe_delta", "dd_delta", "corr_delta", "fit_label"):
            assert by_id["twin_crypto"][field] == by_id["twin_traditional"][field], field
        assert [row["strategy_id"] for row in out] == list(order)

    @pytest.mark.parametrize("book_classes", [_TRADITIONAL_BOOK, _CRYPTO_BOOK])
    def test_simulator_scores_label_only_twins_exactly_equal(self, book_classes):
        book, cand = _book(), _rets(3, mu=0.002)
        outs = {}
        for sid, label in (("twin_crypto", "crypto"), ("twin_traditional", "traditional")):
            outs[label] = simulate_add_candidate(
                portfolio_returns=book,
                candidate_id=sid,
                candidate_returns=cand.copy(),
                weights={"a": 0.5, "b": 0.5},
                asset_classes=_twin_classes(book_classes),
            )
        assert outs["crypto"]["status"] == outs["traditional"]["status"] == "ok"
        for side in ("current", "proposed", "deltas"):
            assert outs["crypto"][side] == outs["traditional"][side], side


class TestCurrentSharpeIsTheBooksOwnReading:
    """D-08 / R2-02: "current" is the book, so the candidate cannot change it."""

    @pytest.mark.parametrize("cand_class", ["crypto", "traditional"])
    def test_traditional_book_current_sharpe_is_the_sqrt252_reading(self, cand_class):
        book, cand = _book(), _rets(3, mu=0.002)
        out = simulate_add_candidate(
            portfolio_returns=book,
            candidate_id="cand",
            candidate_returns=cand,
            weights={"a": 0.5, "b": 0.5},
            asset_classes=_classes(_TRADITIONAL_BOOK, cand_class),
        )
        current = 0.5 * book["a"] + 0.5 * book["b"]
        assert out["current"]["sharpe"] == pytest.approx(_oracle_sharpe(current, 252), rel=1e-9)
        # The 365 reading is the one the dashboard would never show for this book.
        assert out["current"]["sharpe"] != pytest.approx(_oracle_sharpe(current, 365), rel=1e-3)

    @pytest.mark.parametrize("cand_class", ["crypto", "traditional"])
    def test_crypto_book_everything_is_on_sqrt365(self, cand_class):
        book, cand = _book(), _rets(3, mu=0.002)
        weights = {"a": 0.5, "b": 0.5}
        classes = _classes(_CRYPTO_BOOK, cand_class)
        current = 0.5 * book["a"] + 0.5 * book["b"]
        proposed = 0.9 * current + 0.1 * cand

        sim = simulate_add_candidate(
            portfolio_returns=book, candidate_id="cand", candidate_returns=cand,
            weights=weights, asset_classes=classes,
        )
        assert sim["current"]["sharpe"] == pytest.approx(_oracle_sharpe(current, 365), rel=1e-9)
        assert sim["proposed"]["sharpe"] == pytest.approx(_oracle_sharpe(proposed, 365), rel=1e-9)

        opt = find_improvement_candidates(book, {"cand": cand}, weights, asset_classes=classes)
        assert opt[0]["sharpe_lift"] == pytest.approx(
            _oracle_sharpe(proposed, 365) - _oracle_sharpe(current, 365), rel=1e-9
        )

        new = 0.5 * book["b"] + 0.5 * cand
        old = 0.5 * book["a"] + 0.5 * book["b"]
        bridge = find_replacement_candidates(book, {"cand": cand}, weights, "a", asset_classes=classes)
        assert bridge[0]["sharpe_delta"] == pytest.approx(
            _oracle_sharpe(new, 365) - _oracle_sharpe(old, 365), rel=1e-9
        )
