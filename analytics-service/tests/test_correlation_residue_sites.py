"""Phase 166.1 plan 03 (D-02, D-07): correlation sites C1-C8 over a residue leg.

A Pearson correlation divides by both legs' standard deviation. pandas does not
treat a residue standard deviation (a compounding NAV constant yield leaves
about 1e-16) as zero, so it returns a noise correlation instead of NaN. Measured
before this plan: the portfolio correlation matrix gave a constant-yield leg
0.05 against noise and 1.0 on its own diagonal, and two strategies with the SAME
constant yield ``corrwith`` each other at 1.0, above the 0.95 match threshold,
so they were reported as the same strategy.

The invariant for every site (D-07): a leg with a compounding-NAV constant
yield produces EXACTLY what an all-zero leg of the same length produces at that
site today. Both are computed in the test, never hard-coded, so the statement is
about economics (no dispersion means no correlation), not about the code. A
cent-rounded NAV is the control on the other side of the floor: it has real
quantisation dispersion and must keep a finite correlation, so widening the
floor goes red.

Every test that feeds a constant yield first asserts its precondition
``0 < std <= residue_floor(mean)``, so it cannot silently run an exact-zero
branch instead of the residue branch.
"""

from __future__ import annotations

import asyncio
import logging
import math
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from services.dispersion import (
    dispersing_corrwith,
    dispersion_is_real,
    pairwise_correlation_or_none,
    residue_floor,
)
from services.match_engine import _compute_corr_with_portfolio
from services.portfolio_optimizer import _avg_corr, find_improvement_candidates
from services.portfolio_risk import compute_correlation_matrix, compute_rolling_correlation
from services.strategy_matching import find_matched_strategy
from tests.dispersion_fixtures import CONSTANT_YIELDS, apy, nav_constant_yield

_YIELD_IDS = list(CONSTANT_YIELDS)


def _residue_leg(yield_id: str, **kwargs: float) -> pd.Series:
    """A NAV constant-yield leg whose std is residue, not an exact zero."""
    leg = nav_constant_yield(CONSTANT_YIELDS[yield_id], **kwargs)
    sd, mean = float(leg.std()), float(leg.mean())
    assert 0.0 < sd <= residue_floor(mean), (
        f"fixture precondition: {yield_id} must be residue, not exact zero (sd={sd})"
    )
    return leg


def _noise(index: pd.Index, seed: int, scale: float = 0.01) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0005, scale, len(index)), index=index)


def _zeros_like(leg: pd.Series) -> pd.Series:
    return pd.Series(0.0, index=leg.index, name=leg.name)


# ---------------------------------------------------------------------------
# The two helpers in services/dispersion.py
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_pairwise_helper_constant_leg_is_none(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    noise = _noise(const.index, seed=1)
    assert pairwise_correlation_or_none(const, noise) is None
    assert pairwise_correlation_or_none(noise, const) is None
    assert pairwise_correlation_or_none(const, _residue_leg(yield_id, start=5_000.0)) is None


def test_pairwise_helper_two_correlated_noisy_legs_are_finite() -> None:
    idx = nav_constant_yield(1e-4).index
    a = _noise(idx, seed=1)
    b = 0.8 * a + _noise(idx, seed=2, scale=0.004)
    r = pairwise_correlation_or_none(a, b)
    assert r is not None and math.isfinite(r) and r > 0.5


def test_pairwise_helper_cent_rounded_nav_keeps_a_correlation() -> None:
    """T-166.1-18: a cent-rounded 1% APY NAV has real quantisation dispersion.
    A floor widened past it would call it constant and report no correlation."""
    leg = nav_constant_yield(apy(0.01), cents=True)
    assert dispersion_is_real(float(leg.std()), float(leg.mean())), "control must disperse"
    r = pairwise_correlation_or_none(leg, _noise(leg.index, seed=3))
    assert r is not None and math.isfinite(r)


def test_pairwise_helper_uses_only_the_overlapping_rows() -> None:
    """The dispersion test judges the rows the correlation uses: a leg that is a
    constant yield on the overlap is None even though it moves outside it (a
    test over the whole leg would call it dispersing and return the residue
    correlation)."""
    const = _residue_leg("daily_1e-4")
    idx = const.index
    moving = _noise(idx, seed=4)
    flat_on_overlap = moving.copy()
    flat_on_overlap.iloc[100:] = const.iloc[100:]
    other = _noise(idx[100:], seed=5)
    assert pairwise_correlation_or_none(flat_on_overlap, other) is None
    assert pairwise_correlation_or_none(moving, other) is not None


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_dispersing_corrwith_drops_a_residue_column_and_keeps_a_noisy_one(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    target = _noise(const.index, seed=6)
    near = target + _noise(const.index, seed=7, scale=0.001)
    out = dispersing_corrwith(pd.DataFrame({"const": const, "near": near}), target)
    assert list(out.index) == ["near"]
    assert math.isfinite(float(out["near"])) and float(out["near"]) > 0.95


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_dispersing_corrwith_is_empty_when_the_target_is_residue(yield_id: str) -> None:
    target = _residue_leg(yield_id)
    frame = pd.DataFrame({
        "noisy": _noise(target.index, seed=8),
        "same_yield": _residue_leg(yield_id, start=5_000.0),
    })
    out = dispersing_corrwith(frame, target)
    assert out.empty and out.dtype == float


# ---------------------------------------------------------------------------
# C1 - portfolio_risk.compute_correlation_matrix
# ---------------------------------------------------------------------------


def _c1_legs(const: pd.Series) -> dict[str, pd.Series]:
    n = _noise(const.index, seed=11)
    m = 0.5 * n + _noise(const.index, seed=12)
    return {"k": const, "n": n, "m": m}


def test_c1_all_zero_leg_reads_none_on_its_row_column_and_diagonal() -> None:
    """The D-07 reference, measured on today's code: pandas gives an all-zero
    column NaN on its row, column and diagonal, and ``_safe_float`` maps each to
    None. This is the only shape the fix may emit for a residue leg."""
    zero = pd.Series(0.0, index=nav_constant_yield(1e-4).index)
    out = compute_correlation_matrix(_c1_legs(zero))
    assert all(out["k"][c] is None for c in ("k", "n", "m"))
    assert out["n"]["k"] is None and out["m"]["k"] is None


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c1_constant_yield_leg_equals_the_all_zero_leg(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    with_const = compute_correlation_matrix(_c1_legs(const))
    with_zero = compute_correlation_matrix(_c1_legs(_zeros_like(const)))
    assert with_const == with_zero
    assert with_const["k"]["k"] is None
    assert all(with_const["k"][c] is None and with_const[c]["k"] is None for c in ("n", "m"))
    nm = with_const["n"]["m"]
    assert nm is not None and math.isfinite(nm)


# ---------------------------------------------------------------------------
# C2 - portfolio_risk.compute_rolling_correlation
# ---------------------------------------------------------------------------


def test_c2_all_zero_leg_gives_an_empty_series() -> None:
    """The D-07 reference, measured on today's code: every window of an
    all-zero leg is NaN and is dropped, so the pair's series is empty."""
    zero = pd.Series(0.0, index=nav_constant_yield(1e-4).index)
    assert compute_rolling_correlation({"k": zero, "n": _noise(zero.index, seed=21)}) == {"k:n": []}


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c2_constant_yield_leg_equals_the_all_zero_leg(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    n = _noise(const.index, seed=21)
    m = 0.6 * n + _noise(const.index, seed=22)
    with_const = compute_rolling_correlation({"k": const, "n": n, "m": m})
    with_zero = compute_rolling_correlation({"k": _zeros_like(const), "n": n, "m": m})
    assert with_const == with_zero
    assert with_const["k:n"] == [] and with_const["k:m"] == []
    assert len(with_const["n:m"]) > 0
    assert all(p["value"] is not None and math.isfinite(p["value"]) for p in with_const["n:m"])


# ---------------------------------------------------------------------------
# C3 - portfolio_optimizer.find_improvement_candidates: corr_with_portfolio
# ---------------------------------------------------------------------------


def _c3_corr(port_leg: pd.Series, candidate: pd.Series) -> object:
    out = find_improvement_candidates({"p": port_leg}, {"c": candidate}, {"p": 1.0})
    assert [r["strategy_id"] for r in out] == ["c"], "the noisy candidate must be scored"
    return out[0]["corr_with_portfolio"]


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c3_corr_with_a_constant_yield_portfolio_equals_the_all_zero_portfolio(yield_id: str) -> None:
    """S2 already drops a residue CANDIDATE, so the reachable residue leg is the
    portfolio baseline: a portfolio of one constant-yield strategy. Only the
    correlation key is compared; the blends differ, so the deltas legitimately do."""
    const = _residue_leg(yield_id)
    candidate = _noise(const.index, seed=31)
    with_zero = _c3_corr(_zeros_like(const), candidate)
    assert with_zero is None, "D-07 reference: an all-zero portfolio has no correlation today"
    assert _c3_corr(const, candidate) == with_zero


@pytest.mark.parametrize("flat", ["constant_yield", "all_zero"])
def test_c3_sharpe_lift_over_a_flat_portfolio_is_none_not_zero(flat: str) -> None:
    """HIGH-1 (round-1 SFH), D7 (founder 2026-09-26): a portfolio that does not
    disperse has no Sharpe, so the lift over it does not exist. It was a
    fabricated 0.0, which the card read as "no change". The score still ranks:
    the missing axis contributes an explicit 0 there, uniform across candidates.
    Constant-yield and all-zero books must read the same."""
    const = _residue_leg("daily_1e-4")
    port = const if flat == "constant_yield" else _zeros_like(const)
    out = find_improvement_candidates({"p": port}, {"c": _noise(const.index, seed=34)}, {"p": 1.0})
    assert [r["strategy_id"] for r in out] == ["c"], "the noisy candidate must still be ranked"
    row = out[0]
    assert row["sharpe_lift"] is None
    assert row["corr_with_portfolio"] is None
    assert isinstance(row["score"], float) and math.isfinite(row["score"])


def test_c3_narrative_tolerates_a_none_sharpe_lift() -> None:
    """The narrative read `sharpe_lift > 0` off the top suggestion; a None lift
    (HIGH-1) must drop the recommendation sentence, not raise TypeError."""
    from services.portfolio_optimizer import generate_narrative

    text = generate_narrative({
        "optimizer_suggestions": [{"strategy_id": "c", "sharpe_lift": None}],
        "attribution_breakdown": [{"strategy_name": "A", "contribution": -0.01}],
        "portfolio_sharpe": 1.0,
        "risk_decomposition": [{"strategy_id": "a"}],
    })
    assert "expected Sharpe moves" not in text


def test_c3_two_correlated_noisy_legs_keep_a_correlation() -> None:
    idx = nav_constant_yield(1e-4).index
    port = _noise(idx, seed=32)
    corr = _c3_corr(port, 0.7 * port + _noise(idx, seed=33, scale=0.005))
    assert isinstance(corr, float) and math.isfinite(corr) and corr > 0.5


# ---------------------------------------------------------------------------
# C4 - portfolio_optimizer._avg_corr
# ---------------------------------------------------------------------------


def _c4_frame(first: pd.Series) -> pd.DataFrame:
    n = _noise(first.index, seed=41)
    return pd.DataFrame({"k": first, "n": n, "m": 0.5 * n + _noise(first.index, seed=42)})


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c4_avg_corr_with_a_constant_yield_column_equals_the_all_zero_column(yield_id: str) -> None:
    """Round-1 WR-03 (the rule recorded in 166.1-CONTEXT): a flat column's pairs
    are SKIPPED and the defined pairs averaged, as the risk panel does. So one
    constant-yield or all-zero sleeve no longer voids the average for the whole
    book; both read the same, and both equal the one defined pair (n, m). It was
    None for the whole frame, which dropped the diversification axis from every
    scorer while the risk panel still showed an average."""
    const = _residue_leg(yield_id)
    frame_zero = _c4_frame(_zeros_like(const))
    with_zero = _avg_corr(frame_zero)
    only_pair = float(frame_zero["n"].corr(frame_zero["m"]))
    assert with_zero == pytest.approx(only_pair), "the flat column's pairs are skipped"
    assert _avg_corr(_c4_frame(const)) == with_zero


@pytest.mark.parametrize("flat", ["constant_yield", "all_zero"])
def test_wr03_both_average_rules_skip_the_flat_pairs_and_count_them(flat: str) -> None:
    """The scorers' average and the risk panel's average are one rule: skip the
    undefined pairs, and state how many pairs were used (1 of 3 here)."""
    from services.dispersion import average_pairwise_correlation
    from services.portfolio_risk import compute_avg_pairwise_correlation_with_pairs

    const = _residue_leg("daily_1e-4")
    frame = _c4_frame(const if flat == "constant_yield" else _zeros_like(const))
    scorer = average_pairwise_correlation(frame)
    panel = compute_avg_pairwise_correlation_with_pairs(
        compute_correlation_matrix({c: frame[c] for c in frame.columns})
    )
    assert scorer[1:] == (1, 3) and panel[1:] == (1, 3)
    assert scorer[0] == pytest.approx(panel[0])


def test_wr03_match_engine_flat_candidate_has_no_correlation_reduction() -> None:
    """With the flat candidate's pairs skipped, the current and proposed averages
    cover the same pairs; without the leg guard the reduction is a fabricated
    0.0. It was None before WR-03 (the whole average was None) and stays None."""
    from services.match_engine import _compute_portfolio_fit_components

    const = _residue_leg("daily_1e-4")
    idx = const.index
    book = {"a": _noise(idx, seed=121), "b": _noise(idx, seed=122)}
    weights = {"a": 0.5, "b": 0.5}
    port = (pd.DataFrame(book) * pd.Series(weights)).sum(axis=1)
    out = _compute_portfolio_fit_components(port, weights, book, const, 0.10)
    assert out["sharpe_lift"] is not None, "the blend is scored, so the guard is what nulls corr"
    assert out["corr_reduction"] is None


def test_c4_avg_corr_of_noisy_columns_is_finite() -> None:
    idx = nav_constant_yield(1e-4).index
    avg = _avg_corr(_c4_frame(_noise(idx, seed=43)))
    assert avg is not None and math.isfinite(avg)


# ---------------------------------------------------------------------------
# C5 - match_engine._compute_corr_with_portfolio
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c5_constant_yield_leg_equals_the_all_zero_leg(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    noise = _noise(const.index, seed=51)
    zero = _zeros_like(const)
    assert _compute_corr_with_portfolio(zero, noise) is None, "D-07 reference (portfolio leg)"
    assert _compute_corr_with_portfolio(noise, zero) is None, "D-07 reference (candidate leg)"
    assert _compute_corr_with_portfolio(const, noise) is None
    assert _compute_corr_with_portfolio(noise, const) is None


def test_c5_two_correlated_noisy_legs_keep_a_correlation() -> None:
    idx = nav_constant_yield(1e-4).index
    a = _noise(idx, seed=52)
    r = _compute_corr_with_portfolio(a, 0.8 * a + _noise(idx, seed=53, scale=0.004))
    assert r is not None and math.isfinite(r) and r > 0.5


# ---------------------------------------------------------------------------
# C6 - routers/portfolio.py BTC benchmark_comparison, driven end to end
# ---------------------------------------------------------------------------


def _c6_supabase(returns: pd.Series) -> tuple[MagicMock, MagicMock]:
    """A stub client for _compute_portfolio_analytics: one strategy at weight 1."""
    records = [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in returns.items()]
    equity = [
        {"date": r["date"], "value": float(e)}
        for r, e in zip(records, (1.0 + returns).cumprod())
    ]
    pa = MagicMock()
    pa.insert.return_value.execute.return_value = MagicMock(data=[{"id": "analytics-1"}])
    pa.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    pa.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    ps = MagicMock()
    ps.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[
        {"strategy_id": "s1", "current_weight": 1.0, "strategies": {"id": "s1", "name": "S1"}},
    ])
    sa = MagicMock()
    sa.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[
        {"strategy_id": "s1", "returns_series": records, "equity_curve": equity, "total_aum": 100.0},
    ])
    pal = MagicMock()
    pal.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    pal.insert.return_value.execute.return_value = MagicMock(data=[{"id": "alert-1"}])
    pf = MagicMock()
    pf.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data={"created_at": "2024-01-01T00:00:00+00:00"}
    )
    ws = MagicMock()
    ws.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(data=[])
    strat = MagicMock()
    strat.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
    tables = {
        "portfolio_analytics": pa, "portfolio_strategies": ps, "strategy_analytics": sa,
        "portfolio_alerts": pal, "portfolios": pf, "weight_snapshots": ws, "strategies": strat,
    }
    sb = MagicMock()
    sb.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    return sb, pa


def _c6_correlation(strategy_returns: pd.Series, btc: pd.Series) -> object:
    from routers import portfolio as portfolio_mod

    sb, pa = _c6_supabase(strategy_returns)

    async def _btc(symbol: str) -> tuple[pd.Series, bool]:
        return btc, False

    prior = sys.modules.get("routers.portfolio")
    sys.modules["routers.portfolio"] = portfolio_mod
    try:
        # Round-1 IN-06: the fresh semaphore (asyncio.run gets a new loop) is
        # scoped to this call and the module global is restored on exit, so no
        # loop-bound semaphore is left behind for later tests.
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(portfolio_mod, "_compute_semaphore", asyncio.Semaphore(3))
            with patch.object(portfolio_mod, "get_supabase", return_value=sb), \
                 patch.object(portfolio_mod, "get_benchmark_returns", side_effect=_btc):
                asyncio.run(portfolio_mod._compute_portfolio_analytics("portfolio-1"))
    finally:
        if prior is None:
            sys.modules.pop("routers.portfolio", None)
        else:
            sys.modules["routers.portfolio"] = prior
    payload = pa.update.call_args_list[-1][0][0]
    bc = payload["benchmark_comparison"]
    assert bc is not None and bc["symbol"] == "BTC", "the benchmark block must have run"
    return bc["correlation"]


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c6_benchmark_correlation_of_a_constant_yield_portfolio_equals_the_all_zero_one(
    yield_id: str,
) -> None:
    const = _residue_leg(yield_id)
    btc = _noise(const.index, seed=61, scale=0.03)
    with_zero = _c6_correlation(_zeros_like(const), btc)
    assert with_zero is None, "D-07 reference: an all-zero portfolio has no BTC correlation today"
    assert _c6_correlation(const, btc) == with_zero


def test_c6_leaves_the_module_semaphore_as_it_found_it() -> None:
    """Round-1 IN-06: the helper used to assign a new semaphore to the module
    global and never restore it."""
    from routers import portfolio as portfolio_mod

    before = portfolio_mod._compute_semaphore
    idx = nav_constant_yield(1e-4).index
    btc = _noise(idx, seed=64, scale=0.03)
    _c6_correlation(0.3 * btc + _noise(idx, seed=65), btc)
    assert portfolio_mod._compute_semaphore is before


def test_c6_a_noisy_portfolio_keeps_its_benchmark_correlation() -> None:
    idx = nav_constant_yield(1e-4).index
    btc = _noise(idx, seed=62, scale=0.03)
    corr = _c6_correlation(0.3 * btc + _noise(idx, seed=63), btc)
    assert isinstance(corr, float) and math.isfinite(corr) and corr > 0.3


# ---------------------------------------------------------------------------
# C7 - the corrwith matching block inside routers/portfolio.py verify_strategy
# ---------------------------------------------------------------------------
#
# C7 has no pure seam (it sits inside the verify-strategy endpoint, after a
# venue fetch), so its semantics are tested through dispersing_corrwith exactly
# as the block uses it (corrwith, then dropna, then idxmax over the threshold),
# and the block is pinned to call it.


def _c7_block(target: pd.Series, existing: dict[str, pd.Series]) -> str | None:
    """The verify_strategy matching block's decision, fed by the helper."""
    from routers.portfolio import _MATCH_CORRELATION_THRESHOLD

    aligned = pd.concat([target.rename("_target"), pd.DataFrame(existing)], axis=1).dropna()
    corrs_clean = dispersing_corrwith(aligned.drop(columns=["_target"]), aligned["_target"]).dropna()
    if corrs_clean.empty:
        return None
    best = corrs_clean.idxmax()
    return str(best) if corrs_clean[best] > _MATCH_CORRELATION_THRESHOLD else None


def _verify_strategy_source() -> str:
    import ast
    import pathlib

    from routers import portfolio as portfolio_mod

    text = pathlib.Path(portfolio_mod.__file__).read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "verify_strategy":
            return ast.get_source_segment(text, node) or ""
    raise LookupError("verify_strategy not found in routers/portfolio.py")


def _code_lines(src: str) -> str:
    return "\n".join(line for line in src.splitlines() if not line.lstrip().startswith("#"))


def test_c7_verify_strategy_matches_through_dispersing_corrwith() -> None:
    code = _code_lines(_verify_strategy_source())
    assert "dispersing_corrwith(" in code, "C7 must use the dispersion-aware corrwith"
    assert ".corrwith(" not in code, "a raw pandas corrwith would match residue legs again"
    assert "corrs_clean = corrs.dropna()" in code and "_MATCH_CORRELATION_THRESHOLD" in code


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c7_two_strategies_with_the_same_constant_yield_do_not_match(yield_id: str) -> None:
    target = _residue_leg(yield_id)
    twin = _residue_leg(yield_id, start=5_000.0)
    assert _c7_block(target, {"twin": twin}) is None
    zero = _zeros_like(target)
    assert _c7_block(zero, {"twin": _zeros_like(twin)}) is None, "D-07 reference: no_match"


def test_c7_a_near_identical_noisy_candidate_still_matches() -> None:
    idx = nav_constant_yield(1e-4).index
    target = _noise(idx, seed=71)
    near = target + _noise(idx, seed=72, scale=0.0005)
    assert _c7_block(target, {"near": near, "other": _noise(idx, seed=73)}) == "near"


# ---------------------------------------------------------------------------
# C8 - services/strategy_matching.find_matched_strategy
# ---------------------------------------------------------------------------


class _Query:
    """``table(...).select(...).eq/in_(...).limit(...).execute()`` over fixed rows."""

    def __init__(self, data: list[dict[str, object]]) -> None:
        self._data = data

    def select(self, *_a: object, **_k: object) -> "_Query":
        return self

    def eq(self, *_a: object, **_k: object) -> "_Query":
        return self

    def in_(self, *_a: object, **_k: object) -> "_Query":
        return self

    def limit(self, *_a: object, **_k: object) -> "_Query":
        return self

    def execute(self) -> SimpleNamespace:
        return SimpleNamespace(data=self._data)


class _StubClient:
    def __init__(self, candidates: dict[str, pd.Series]) -> None:
        self._published = [{"id": sid} for sid in candidates]
        self._analytics = [
            {
                "strategy_id": sid,
                "returns_series": [
                    {"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in s.items()
                ],
            }
            for sid, s in candidates.items()
        ]

    def table(self, name: str) -> _Query:
        return _Query(self._published if name == "strategies" else self._analytics)


def _c8(target: pd.Series, candidates: dict[str, pd.Series], caplog: pytest.LogCaptureFixture) -> str | None:
    caplog.clear()
    caplog.set_level(logging.DEBUG, logger="quantalyze.analytics")
    target = target.copy()
    target.index = pd.DatetimeIndex(target.index.strftime("%Y-%m-%d"))
    return find_matched_strategy(target, _StubClient(candidates))


def _matching_failed_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if "matching failed" in r.getMessage()]


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c8_two_strategies_with_the_same_constant_yield_do_not_match(
    yield_id: str, caplog: pytest.LogCaptureFixture
) -> None:
    target = _residue_leg(yield_id)
    twin = _residue_leg(yield_id, start=5_000.0)
    assert _c8(target, {"twin": twin}, caplog) is None
    assert _matching_failed_lines(caplog) == []


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c8_constant_yield_answer_equals_the_all_zero_answer(
    yield_id: str, caplog: pytest.LogCaptureFixture
) -> None:
    """D-07: an all-zero target and candidate give no match (None) today, and a
    constant-yield pair must give the same answer."""
    target = _residue_leg(yield_id)
    twin = _residue_leg(yield_id, start=5_000.0)
    with_zero = _c8(_zeros_like(target), {"twin": _zeros_like(twin)}, caplog)
    assert with_zero is None
    assert _c8(target, {"twin": twin}, caplog) == with_zero


def test_c8_no_dispersing_candidate_is_an_explicit_none_not_a_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Every candidate flat (an all-zero one and a constant yield): None through
    the explicit empty-result branch. Before the fix, idxmax over an all-NaN
    Series raised into the broad except and logged "matching failed", so a
    warning that should mean a real failure also fired on ordinary data."""
    idx = nav_constant_yield(1e-4).index
    target = _noise(idx, seed=81)
    zero = pd.Series(0.0, index=idx)
    for candidates in (
        {"zero": zero},
        {"yield": _residue_leg("daily_1e-4")},
        {"zero": zero, "yield": _residue_leg("daily_1e-4")},
    ):
        assert _c8(target, candidates, caplog) is None
        assert _matching_failed_lines(caplog) == [], sorted(candidates)


def test_c8_a_flat_target_is_an_explicit_none_not_a_failure(caplog: pytest.LogCaptureFixture) -> None:
    idx = nav_constant_yield(1e-4).index
    candidates = {"noisy": _noise(idx, seed=82)}
    assert _c8(pd.Series(0.0, index=idx), candidates, caplog) is None
    assert _matching_failed_lines(caplog) == []
    assert _c8(_residue_leg("daily_1e-4"), candidates, caplog) is None
    assert _matching_failed_lines(caplog) == []


def test_c8_a_near_identical_noisy_candidate_still_matches(caplog: pytest.LogCaptureFixture) -> None:
    idx = nav_constant_yield(1e-4).index
    target = _noise(idx, seed=83)
    near = target + _noise(idx, seed=84, scale=0.0005)
    candidates = {"near": near, "other": _noise(idx, seed=85), "yield": _residue_leg("daily_1e-4")}
    assert _c8(target, candidates, caplog) == "near"


def test_c8_a_real_failure_still_logs_matching_failed(caplog: pytest.LogCaptureFixture) -> None:
    """The broad except stays for real failures: the warning keeps its meaning."""

    class _Broken:
        def table(self, name: str) -> _Query:
            raise RuntimeError("boom")

    caplog.clear()
    caplog.set_level(logging.WARNING, logger="quantalyze.analytics")
    idx = nav_constant_yield(1e-4).index
    assert find_matched_strategy(_noise(idx, seed=86), _Broken()) is None
    assert len(_matching_failed_lines(caplog)) == 1


# ---------------------------------------------------------------------------
# HIGH-2 / WR-02 (round 1) - the simulator and bridge deltas over a flat leg
#
# 166.1 D7 (founder 2026-09-26): a delta whose either side does not exist is
# None, never a 0.0 that the simulator panel and ReplacementCard read as
# "unchanged". A constant-yield leg and an all-zero leg must read the same.
# ---------------------------------------------------------------------------

_FLAT_KINDS = ["constant_yield", "all_zero"]


def _flat_leg(kind: str) -> pd.Series:
    const = _residue_leg("daily_1e-4")
    return const if kind == "constant_yield" else _zeros_like(const)


def _simulate(book: dict[str, pd.Series], candidate: pd.Series) -> dict:
    from services.simulator_scoring import simulate_add_candidate

    weights = {sid: 1.0 / len(book) for sid in book}
    out = simulate_add_candidate(book, "cand", candidate, weights)
    assert out["status"] == "ok"
    return out


@pytest.mark.parametrize("kind", _FLAT_KINDS)
def test_high2_simulator_flat_candidate_has_no_correlation_delta(kind: str) -> None:
    """The SFH reproduction: a noisy two-strategy book plus a flat candidate gave
    corr_delta 0.0, "Correlation unchanged (±0.000)"."""
    flat = _flat_leg(kind)
    book = {"a": _noise(flat.index, seed=91), "b": _noise(flat.index, seed=92)}
    out = _simulate(book, flat)
    assert out["deltas"]["corr_delta"] is None


@pytest.mark.parametrize("kind", _FLAT_KINDS)
def test_high2_simulator_flat_book_has_no_sharpe_delta(kind: str) -> None:
    """A book with no Sharpe gave sharpe_delta 0.0 beside current.sharpe None."""
    flat = _flat_leg(kind)
    out = _simulate({"f": flat}, _noise(flat.index, seed=93))
    assert out["current"]["sharpe"] is None
    assert out["deltas"]["sharpe_delta"] is None


def test_high2_simulator_noisy_legs_keep_every_delta() -> None:
    idx = nav_constant_yield(1e-4).index
    book = {"a": _noise(idx, seed=94), "b": _noise(idx, seed=95)}
    deltas = _simulate(book, _noise(idx, seed=96))["deltas"]
    for key in ("sharpe_delta", "dd_delta", "corr_delta", "concentration_delta"):
        assert isinstance(deltas[key], float) and math.isfinite(deltas[key]), key


def _replace(book: dict[str, pd.Series], candidate: pd.Series) -> dict:
    from services.bridge_scoring import find_replacement_candidates

    weights = {sid: 1.0 / len(book) for sid in book}
    out = find_replacement_candidates(book, {"cand": candidate}, weights, "inc")
    assert [r["strategy_id"] for r in out] == ["cand"], "the candidate must still be ranked"
    row = out[0]
    assert isinstance(row["composite_score"], float) and math.isfinite(row["composite_score"])
    return row


@pytest.mark.parametrize("kind", _FLAT_KINDS)
def test_high2_bridge_flat_candidate_has_no_correlation_delta(kind: str) -> None:
    flat = _flat_leg(kind)
    idx = flat.index
    book = {"a": _noise(idx, seed=101), "b": _noise(idx, seed=102), "inc": _noise(idx, seed=103)}
    assert _replace(book, flat)["corr_delta"] is None


@pytest.mark.parametrize("kind", _FLAT_KINDS)
def test_high2_bridge_flat_incumbent_has_no_correlation_delta(kind: str) -> None:
    flat = _flat_leg(kind)
    idx = flat.index
    book = {"a": _noise(idx, seed=104), "b": _noise(idx, seed=105), "inc": flat}
    assert _replace(book, _noise(idx, seed=106))["corr_delta"] is None


@pytest.mark.parametrize("kind", _FLAT_KINDS)
def test_high2_bridge_flat_book_has_no_sharpe_delta(kind: str) -> None:
    flat = _flat_leg(kind)
    book = {"a": flat.rename("a"), "inc": flat.rename("inc")}
    assert _replace(book, _noise(flat.index, seed=107))["sharpe_delta"] is None


def test_high2_bridge_noisy_legs_keep_every_delta() -> None:
    idx = nav_constant_yield(1e-4).index
    book = {"a": _noise(idx, seed=108), "b": _noise(idx, seed=109), "inc": _noise(idx, seed=110)}
    row = _replace(book, _noise(idx, seed=111))
    for key in ("sharpe_delta", "dd_delta", "corr_delta"):
        assert isinstance(row[key], float) and math.isfinite(row[key]), key
