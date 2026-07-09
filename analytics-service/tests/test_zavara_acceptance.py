"""Offline (credentials-free) unit tests for the Finding-6 acceptance helpers in
``scripts/zavara_acceptance.py``. These exercise the CSV-only comparison path — the
uniform-scale fit, arithmetic-cumulative maxDD, single-convention monthly grid, and
the multi-key stitch — WITHOUT any live Deribit crawl."""
from __future__ import annotations

import math

import pytest

from scripts.zavara_acceptance import (
    compare_shipped_to_csv,
    fit_uniform_scale,
    monthly_sums_pct,
    parse_zavara_daily_return_pct,
    stitch_key_outputs,
    stitched_arithmetic_maxdd_pct,
)

# A tiny zavara-shaped CSV (the real column order); cum_return_pct is intentionally
# a DIFFERENT/unreliable basis to prove the parser ignores it.
_CSV = (
    "date,capital,btc_price,daily_pnl_btc,daily_pnl_usd,cum_pnl_usd,nav,"
    "daily_return_pct,cum_return_pct\n"
    "2025-08-03,4000000,114672.0,-0.59,-68229.73,-68229.73,3931770.27,-1.7057,-1.7057\n"
    "2025-08-04,4000000,113991.5,0.90,102592.92,34363.19,4034363.19,2.5648,0.8591\n"
    "2025-08-05,4000000,113000.0,0.60,67800.00,102163.19,4102163.19,1.7173,99.9\n"
    "2025-09-02,4000000,110000.0,-1.00,-110000.0,-7836.81,3992163.19,-2.5766,42.0\n"
)


def test_parse_ignores_cum_column_and_reads_daily_return_pct() -> None:
    parsed = parse_zavara_daily_return_pct(_CSV)
    assert parsed == {
        "2025-08-03": -1.7057,
        "2025-08-04": 2.5648,
        "2025-08-05": 1.7173,
        "2025-09-02": -2.5766,
    }


def test_fit_uniform_scale_identity_is_one_zero_dev() -> None:
    truth = parse_zavara_daily_return_pct(_CSV)
    k, dev = fit_uniform_scale(dict(truth), truth)
    assert k == pytest.approx(1.0, abs=1e-12)
    assert dev == pytest.approx(0.0, abs=1e-12)


def test_fit_uniform_scale_detects_systematic_rescale() -> None:
    """A shipped series that is a UNIFORM 2× of truth fits k≈0.5 with ~0 residual —
    the scale is recovered and the shape still matches (deviation ~0)."""
    truth = parse_zavara_daily_return_pct(_CSV)
    shipped = {d: v * 2.0 for d, v in truth.items()}
    k, dev = fit_uniform_scale(shipped, truth)
    assert k == pytest.approx(0.5, rel=1e-12)
    assert dev == pytest.approx(0.0, abs=1e-9)


def test_fit_uniform_scale_shape_mismatch_inflates_deviation() -> None:
    """A genuine SHAPE mismatch (one day flipped) leaves a large post-scale
    deviation even at the best-fit k — the shape-match guard."""
    truth = parse_zavara_daily_return_pct(_CSV)
    shipped = dict(truth)
    shipped["2025-08-04"] = -truth["2025-08-04"]  # flip one day
    k, dev = fit_uniform_scale(shipped, truth)
    assert dev > 1.0  # percent points — clearly not a shape match


def test_fit_uniform_scale_empty_overlap_is_nan() -> None:
    k, dev = fit_uniform_scale({"2030-01-01": 1.0}, {"2025-08-03": -1.7})
    assert math.isnan(k) and math.isnan(dev)


def test_stitched_arithmetic_maxdd_hand_computed() -> None:
    """cum [2,-1,0,-1] off daily [+2,-3,+1,-1]; peak stays 2 → deepest dd = -3."""
    daily = {
        "2025-01-01": 2.0, "2025-01-02": -3.0,
        "2025-01-03": 1.0, "2025-01-04": -1.0,
    }
    assert stitched_arithmetic_maxdd_pct(daily) == pytest.approx(-3.0)
    # Monotone up → no drawdown.
    assert stitched_arithmetic_maxdd_pct({"2025-01-01": 1.0, "2025-01-02": 2.0}) == 0.0


def test_monthly_sums_are_arithmetic_single_convention() -> None:
    """Monthly cells are Σr per month and SUM to the arithmetic cumulative."""
    truth = parse_zavara_daily_return_pct(_CSV)
    monthly = monthly_sums_pct(truth)
    assert monthly["2025-08"] == pytest.approx(-1.7057 + 2.5648 + 1.7173)
    assert monthly["2025-09"] == pytest.approx(-2.5766)
    assert sum(monthly.values()) == pytest.approx(sum(truth.values()))


def test_compare_bundle_reports_k_maxdd_and_monthly() -> None:
    truth = parse_zavara_daily_return_pct(_CSV)
    cmp = compare_shipped_to_csv(dict(truth), truth)
    assert cmp["scale_k"] == pytest.approx(1.0)
    assert cmp["max_per_day_abs_dev_pct"] == pytest.approx(0.0, abs=1e-12)
    assert cmp["n_common_days"] == 4
    assert cmp["shipped_maxdd_pct"] == pytest.approx(cmp["csv_maxdd_pct"])
    assert cmp["monthly_max_abs_dev_pct"] == pytest.approx(0.0, abs=1e-12)


def test_stitch_keys_combines_nonoverlapping_and_flags_overlap() -> None:
    """Sequential subaccounts stitch into ONE series; the combined maxDD is computed
    on the whole stitched arithmetic-cumulative, and an accidental date overlap
    across keys is surfaced (never silently coalesced)."""
    key1 = {"2025-08-01": 2.0, "2025-08-02": -3.0}
    key2 = {"2025-09-01": 1.0, "2025-09-02": -1.0}
    res = stitch_key_outputs([key1, key2])
    assert res["n_stitched_days"] == 4
    assert res["overlap_days"] == []
    # cum [2,-1,0,-1] → deepest -3.
    assert res["stitched_maxdd_pct"] == pytest.approx(-3.0)
    assert res["stitched_cumulative_pct"] == pytest.approx(-1.0)
    # An overlap across keys is reported.
    dup = stitch_key_outputs([{"2025-08-01": 1.0}, {"2025-08-01": 9.0}])
    assert dup["overlap_days"] == ["2025-08-01"]


def test_stitch_with_csv_recovers_scale_and_maxdd() -> None:
    """The stitched shipped series vs the CSV: k≈1, tiny deviation, and the combined
    maxDD matches the CSV's — the end-to-end Finding-6 acceptance shape (offline)."""
    truth = parse_zavara_daily_return_pct(_CSV)
    # Split the truth across two "keys" by month (non-overlapping).
    key_aug = {d: v for d, v in truth.items() if d.startswith("2025-08")}
    key_sep = {d: v for d, v in truth.items() if d.startswith("2025-09")}
    res = stitch_key_outputs([key_aug, key_sep], truth)
    assert res["csv_comparison"]["scale_k"] == pytest.approx(1.0)
    assert res["csv_comparison"]["max_per_day_abs_dev_pct"] == pytest.approx(0.0, abs=1e-9)
    assert res["stitched_maxdd_pct"] == pytest.approx(
        res["csv_comparison"]["csv_maxdd_pct"]
    )


# ---------------------------------------------------------------------------
# L2 — the committed acceptance GATE must be fail-loud: a caught money-guard
# exception (metrics_error present) exits NONZERO so it can never be mistaken for
# a green acceptance run.
# ---------------------------------------------------------------------------


def test_l2_metrics_error_exits_nonzero(monkeypatch: object) -> None:
    import scripts.zavara_acceptance as za

    async def _fake_run(key_index: int, *, csv_path: object = None) -> dict:
        return {"key_index": key_index, "metrics_error": "AllocatedCapitalValuationError"}

    monkeypatch.setattr(za, "_run", _fake_run)  # type: ignore[attr-defined]
    assert za.main(["--key-index", "1"]) == 1


def test_l2_clean_run_exits_zero(monkeypatch: object) -> None:
    import scripts.zavara_acceptance as za

    async def _fake_run(key_index: int, *, csv_path: object = None) -> dict:
        return {"key_index": key_index, "shipped_metrics": {"sharpe": 1.0}}

    monkeypatch.setattr(za, "_run", _fake_run)  # type: ignore[attr-defined]
    assert za.main(["--key-index", "1"]) == 0


# ---------------------------------------------------------------------------
# F1 — the harness MUST build the ledger in the SAME spot-exclusion mode the
# worker uses for a config-bearing (allocated) strategy (True). Parity pinned so
# the harness can never silently validate a different mode than production ships.
# ---------------------------------------------------------------------------


def test_f1_harness_builds_ledger_with_worker_spot_mode(monkeypatch: object) -> None:
    import asyncio
    from types import SimpleNamespace

    import scripts.deribit_acceptance as da
    import scripts.zavara_acceptance as za
    import services.exchange as se
    from services.allocated_capital import (
        exclude_spot_extraction_for,
        parse_returns_denominator_config,
    )

    captured: dict = {}

    async def _fake_build(exchange, *, pnl_basis, exclude_spot_extraction=False):
        captured["pnl_basis"] = pnl_basis
        captured["exclude_spot_extraction"] = exclude_spot_extraction
        ledger = SimpleNamespace(native_pnl={}, marks={})
        report = SimpleNamespace(
            pre_coverage_option_days=[], indexable_currencies=frozenset()
        )
        return ledger, report

    async def _fake_close(_ex: object) -> None:
        return None

    monkeypatch.setattr(za, "build_deribit_native_ledger", _fake_build)  # type: ignore[attr-defined]
    monkeypatch.setattr(da, "_build_deribit_exchange", lambda _i: object())  # type: ignore[attr-defined]
    monkeypatch.setattr(se, "aclose_exchange", _fake_close)  # type: ignore[attr-defined]

    asyncio.run(za._run(1))  # type: ignore[attr-defined]

    cfg = parse_returns_denominator_config(za._ZAVARA_DENOMINATOR_CONFIG)  # type: ignore[attr-defined]
    # Parity: the harness passes EXACTLY what the worker derives for this config.
    assert captured["exclude_spot_extraction"] == exclude_spot_extraction_for(cfg)
    assert captured["exclude_spot_extraction"] is True  # the allocated path
    assert captured["pnl_basis"] == cfg.pnl_basis  # cash_settlement
