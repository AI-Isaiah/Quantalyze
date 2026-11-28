"""Phase 256 OKXUNITSWITCH plan 09 (SC-3): one test per UNCHANGED Python reader of a switched OKX account,
fed the REAL derive output for that account.

The headline series of a switched account is all USD (USD through S, the BTC segment converted at each
day's stored close), and it carries NO ``native_unit``; the only unit-ish thing a reader may meet is the
``unit_switch`` marker, a denomination note. So every reader here states the same rule, per its own
entry point: it reads the row as USD, never reads ``unit_switch`` as a unit, calls no USD conversion
(the BTC closes loader is never awaited), and its USD figure equals the same figure computed from the
headline series directly.

Each test first runs the real derive (``run_switched_derive``) and asserts it ended DONE. On origin/main
the derive refuses the account (``daily_pnl_non_usd_okx``), so every test here fails at that first
assertion, by assertion and never by ImportError (the run is pasted in the SUMMARY).

The record is 91 days long (a USDT bill 91 days back, a coin switch 14 days back), so it clears the
runner's 90-day annualisation gate and the simulator's overlap floor, and the BTC segment alone (13 days)
does not: a reader that counted only the coin segment would show it.

Reader census (RESEARCH "Reader census", Python) and the test that holds each rule:

- services/exchange.py fetch (OKX branch): plan 03's pins; the derive tests here and in
  ``test_okx_unit_switch_derive.py`` run it for real.
- services/job_worker.py derive (key + strategy): ``test_okx_unit_switch_derive.py`` and
  ``test_okx_unit_switch_key_mode.py``.
- services/analytics_runner.py: ``test_analytics_runner_pairs_the_benchmark_and_counts_the_whole_record``
- services/wealth_returns.py: ``test_wealth_returns_reads_the_switched_row_as_usd_without_a_placeholder``
- services/allocator_equity_compose.py: ``test_okx_unit_switch_key_mode.py``
- services/strategy_matching.py: ``test_strategy_matching_correlates_the_switched_row_in_usd_without_conversion``
- routers/match.py: ``test_match_router_loaders_read_the_switched_row_as_usd_without_a_unit``
- routers/portfolio.py: ``test_portfolio_router_reads_switched_row_as_usd_without_conversion``
- routers/simulator.py: ``test_simulator_router_reads_switched_row_as_usd_without_conversion``
- services/mt5_parity*.py: ``test_the_mt5_parity_capture_never_selects_an_okx_key``
- scripts/flowtiming_dry_run.py: ``test_the_flowtiming_dry_run_never_treats_an_okx_key_as_mt5``
- services/okx_archive_job.py and routers/cron.py: plan 03's refusal pins
  (``tests/test_okx_unit_switch_fetch.py``): they keep refusing a switched account by name.
- services/nav_twr.py, services/account_unit.py, services/native_to_usd.py: unchanged by construction;
  the converters are never reached for this row (every test below asserts the closes loader is not awaited).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from services.job_worker import DispatchOutcome
from services.wealth_returns import daily_returns_from_row
from tests._curve_fixtures import curve_from_returns
from tests.fixtures.okx_unit_switch_derive_harness import (
    Calendar,
    SwitchedDeriveCapture,
    bill,
    founder_bills,
    run_switched_derive,
)

NATIVE_UNIT_LEAK = {"native_unit": "BTC"}


async def _switched_account(
    *, key_mode: bool = False
) -> tuple[Calendar, SwitchedDeriveCapture, pd.Series]:
    """The real derive of a founder-shaped switched account with a 91-day record. Returns the
    calendar, the capture, and the stored headline as a Series (the csv rows of the run)."""
    cal = Calendar.now()
    bills = [
        bill(20, cal, 91, "USDT", "20", "-2"),
        bill(21, cal, 60, "USDT", "-8", "-1"),
        *founder_bills(cal),
    ]
    run = await run_switched_derive(key_mode=key_mode, cal=cal, bills=bills)
    # RED on origin/main: the derive refuses the account, so nothing below is ever reached.
    assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
    headline = pd.Series(
        {pd.Timestamp(r["date"]): float(r["daily_return"]) for r in run.csv_rows}
    ).sort_index()
    assert len(headline) == 91, len(headline)
    return cal, run, headline


def _flags(run: SwitchedDeriveCapture) -> dict[str, Any]:
    flags = dict(run.prestamp["data_quality_flags"])
    assert "unit_switch" in flags and "native_unit" not in flags, flags
    return flags


def _row(strategy_id: str, headline: pd.Series, flags: dict[str, Any]) -> dict[str, Any]:
    """The ``strategy_analytics`` row shape the readers see: the stored CURVE of the headline."""
    return {
        "strategy_id": strategy_id,
        "returns_series": curve_from_returns(
            [float(v) for v in headline], [d.strftime("%Y-%m-%d") for d in headline.index]
        ),
        "data_quality_flags": flags,
    }


def _usd_twin(headline: pd.Series, seed: int = 11) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0004, 0.006, len(headline)), index=headline.index)


# --- analytics_runner -----------------------------------------------------------------------------


async def _run_runner(
    rows: list[dict[str, Any]], flags: dict[str, Any]
) -> tuple[dict[str, Any], MagicMock, AsyncMock]:
    from services import basis_series
    from services.analytics_runner import run_csv_strategy_analytics
    from tests.test_csv_analytics_runner import _make_broker_supabase_mock

    sb = _make_broker_supabase_mock(
        rows, api_key_id="key-1", asset_class="crypto", existing_flags=flags
    )
    index = pd.date_range(pd.Timestamp(rows[0]["date"]) - pd.Timedelta(days=3), periods=len(rows) + 6)
    bench = AsyncMock(
        return_value=(
            pd.Series(np.random.default_rng(7).normal(0.0, 0.02, len(index)), index=index),
            False,
        )
    )
    spy = MagicMock(side_effect=basis_series.derive_basis_series)
    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.get_benchmark_returns", new=bench
    ), patch("services.basis_series.derive_basis_series", new=spy):
        await run_csv_strategy_analytics("switched-uuid")
    completed = [
        c.args[0]
        for c in sb.table("strategy_analytics").upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    return completed[0], spy, bench


async def test_analytics_runner_pairs_the_benchmark_and_counts_the_whole_record() -> None:
    """Rule: the runner reads the switched account as an ordinary USD row. The benchmark is paired and
    its metrics computed (a native-unit row would skip it), the series it computes on is the WHOLE 91-day
    record, so the 90-day annualisation gate passes; the same runner over the BTC segment alone (13 days)
    is gated, which shows the gate is measuring the whole record."""
    cal, run, headline = await _switched_account()
    flags = _flags(run)
    rows = [{"date": r["date"], "daily_return": r["daily_return"]} for r in run.csv_rows]

    payload, spy, bench = await _run_runner(rows, flags)
    dq = payload["data_quality_flags"]
    assert dq["unit_switch"] == flags["unit_switch"] and "native_unit" not in dq
    bench.assert_awaited_once()
    assert spy.call_args.args[1] is not None, "a USD row is paired with the benchmark"
    assert len(spy.call_args.args[0]) == len(headline), "the runner computes on the whole record"
    assert payload["metrics_json"].get("alpha") is not None
    assert payload["metrics_json"].get("beta") is not None
    assert "insufficient_window" not in dq, "91 days clears the 90-day annualisation gate"
    # 194 D-15, the total-record KPI gate: the runner stores the count of the whole headline's non-NaN
    # returns, and ``record_clears`` (the Python mirror of the TS gate) passes it for a crypto record.
    from services.metrics import record_clears

    assert payload["metrics_json"]["record_observations"] == len(headline)
    span_days = (headline.index[-1] - headline.index[0]).days
    assert record_clears(span_days, len(headline), True) is True

    coin_only = [r for r in rows if r["date"] > flags["unit_switch"]["last_usd_day"]]
    assert 10 < len(coin_only) < 90
    payload_coin, _spy, _bench = await _run_runner(coin_only, flags)
    assert payload_coin["data_quality_flags"].get("insufficient_window") is True
    assert payload_coin["metrics_json"]["record_observations"] == len(coin_only)
    assert record_clears(len(coin_only) - 1, len(coin_only), True) is False


# --- wealth_returns -------------------------------------------------------------------------------


async def test_wealth_returns_reads_the_switched_row_as_usd_without_a_placeholder() -> None:
    """Rule: ``keep_absent`` is honoured only for a row that carries a native unit. The switched row has
    none, so it reads exactly as a USD row: every stored day, no NaN placeholder, both through the
    ``daily_returns`` column and through the stored curve, with and without ``keep_absent``."""
    _cal, run, headline = await _switched_account()
    flags = _flags(run)
    stored = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in headline.items()
    ]
    for source in (
        {"daily_returns": stored},
        {"returns_series": _row("x", headline, flags)["returns_series"]},
    ):
        row = {**source, "data_quality_flags": flags}
        plain = daily_returns_from_row(row, name="sw")
        kept = daily_returns_from_row(row, name="sw", keep_absent=True)
        assert plain is not None and kept is not None
        pd.testing.assert_series_equal(plain, kept)
        assert not kept.isna().any(), "a USD row never carries a NaN placeholder"
        expected = headline.iloc[1:] if "returns_series" in source else headline
        np.testing.assert_allclose(
            plain.reindex(expected.index).to_numpy(), expected.to_numpy(), atol=1e-12
        )


# --- strategy_matching ----------------------------------------------------------------------------


async def test_strategy_matching_correlates_the_switched_row_in_usd_without_conversion(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rule: the matcher puts only native-unit candidates in USD. The switched row is a candidate whose
    series IS the target's USD series, so it is the match; the BTC closes read is stubbed to FAIL, so a
    reader that priced the row (read ``unit_switch`` as a unit) would drop it and find no match."""
    from services.benchmark import BtcClosesReadError
    from tests.test_correlation_residue_sites import _c8, _stub_closes

    _cal, run, headline = await _switched_account()
    flags = _flags(run)
    _stub_closes(
        monkeypatch,
        BtcClosesReadError("the closes must not be read for a USD row"),
        "services.strategy_matching",
        "read_btc_closes",
    )
    candidates = {"switched": headline, "other": _usd_twin(headline)}
    matched = await _c8(headline, candidates, caplog, flags={"switched": flags})
    assert matched == "switched"
    assert not [r for r in caplog.records if "closes unreadable" in r.getMessage()]


# --- routers/match --------------------------------------------------------------------------------


async def test_match_router_loaders_read_the_switched_row_as_usd_without_a_unit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Rule: both match loaders read ``native_unit`` from the row's flags and nothing else. The switched
    row yields NO unit (``unit_switch`` is not one), and the returns the loaders hand the engine are the
    headline's own days (the boundary reads a stored curve back as returns for days 1..n)."""
    from routers import match as match_mod

    _cal, run, headline = await _switched_account()
    flags = _flags(run)
    analytics = [
        {**_row("s-sw", headline, flags), "sharpe": 1, "max_drawdown": -0.1},
    ]

    def _table(name: str) -> MagicMock:
        t = MagicMock()
        if name == "strategies":
            t.select.return_value.eq.return_value.execute.return_value = MagicMock(
                data=[{"id": "s-sw", "name": "S"}]
            )
            return t
        if name == "strategy_analytics":
            q = MagicMock()
            q.in_.return_value.execute.return_value = MagicMock(data=analytics)
            t.select.return_value = q
        return t

    sb = MagicMock()
    sb.table.side_effect = _table
    monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)
    universe = match_mod._load_candidate_universe()
    assert universe["native_units"] == {}, "unit_switch must never be read as a native unit"
    loaded = universe["returns_by_id"]["s-sw"]
    np.testing.assert_allclose(
        loaded.reindex(headline.index[1:]).to_numpy(), headline.iloc[1:].to_numpy(), atol=1e-12
    )

    ps_rows = [
        {"strategy_id": "s-sw", "current_weight": 1.0, "portfolio_id": "pf-1", "allocated_amount": 100.0}
    ]

    def _ctx_table(name: str) -> MagicMock:
        t = MagicMock()
        if name == "portfolios":
            t.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "pf-1"}])
        elif name == "allocator_preferences":
            t.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = None
        elif name == "portfolio_strategies":
            t.select.return_value.in_.return_value.order.return_value.order.return_value.execute.return_value = (
                MagicMock(data=ps_rows)
            )
        elif name == "strategy_analytics":
            q = MagicMock()
            q.in_.return_value.execute.return_value = MagicMock(data=analytics)
            t.select.return_value = q
        elif name == "allocator_holdings":
            t.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(data=[])
        elif name == "match_decisions":
            t.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        return t

    sb2 = MagicMock()
    sb2.table.side_effect = _ctx_table
    monkeypatch.setattr(match_mod, "get_supabase", lambda: sb2)
    ctx = match_mod._load_allocator_context("alloc-sw")
    assert ctx["native_units"] == {}


# --- routers/portfolio ----------------------------------------------------------------------------


async def test_portfolio_router_reads_switched_row_as_usd_without_conversion() -> None:
    """Rule: the portfolio blend converts only native-unit series. The switched row is blended as it
    stands: the portfolio equity curve equals the weighted hand product of the headline and a USD twin,
    and the closes loader is never awaited. With ``native_unit`` leaking onto the row the same call
    converts (closes awaited and a different curve), so the assertion can fail."""
    from tests.test_portfolio_router_logic import _run_compute

    _cal, run, headline = await _switched_account()
    flags = _flags(run)
    twin = _usd_twin(headline)
    ps = [
        {"strategy_id": "sw", "current_weight": 0.5, "allocated_amount": 100.0,
         "strategies": {"id": "sw", "name": "Switched"}},
        {"strategy_id": "usd-a", "current_weight": 0.5, "allocated_amount": 100.0,
         "strategies": {"id": "usd-a", "name": "Twin"}},
    ]
    closes = pd.Series(
        100_000.0 + 500.0 * np.arange(len(headline) + 5),
        index=pd.date_range(headline.index[0] - pd.Timedelta(days=2), periods=len(headline) + 5),
    )

    def _sa(row_flags: dict[str, Any]) -> list[dict[str, Any]]:
        return [_row("sw", headline, row_flags), _row("usd-a", twin, {})]

    tables, closes_mock = await _run_compute(ps, _sa(flags), closes)
    update = tables["portfolio_analytics"].update.call_args[0][0]
    curve = {p["date"][:10]: p["value"] for p in update["portfolio_equity_curve"]}
    closes_mock.assert_not_awaited()

    # Independent oracle: the weighted hand product of the two USD series (the boundary reads the
    # stored curve back from day 0, G3-1 (a)).
    expected = (1.0 + (0.5 * headline + 0.5 * twin)).cumprod()
    assert set(curve) == {d.strftime("%Y-%m-%d") for d in expected.index}
    for day, level in expected.items():
        assert curve[day.strftime("%Y-%m-%d")] == pytest.approx(float(level), abs=1e-9), day

    # The control: the SAME row with a native unit leaking onto it is converted, so the loader is read.
    leaked_tables, leaked_closes = await _run_compute(ps, _sa({**flags, **NATIVE_UNIT_LEAK}), closes)
    leaked_curve = {
        p["date"][:10]: p["value"]
        for p in leaked_tables["portfolio_analytics"].update.call_args[0][0]["portfolio_equity_curve"]
    }
    assert leaked_closes.await_count == 1
    assert leaked_curve != curve


# --- routers/simulator ----------------------------------------------------------------------------


async def test_simulator_router_reads_switched_row_as_usd_without_conversion() -> None:
    """Rule: the simulator weights whatever series it is given, converting only native-unit ones. A
    switched CANDIDATE enters the add-blend as the headline it is: the proposed curve equals the one
    from the same row with no flags at all, the closes loader is never awaited, and a leaked
    ``native_unit`` makes it convert (closes awaited, a different curve)."""
    from tests.test_simulator_router import _simulate

    _cal, run, headline = await _switched_account()
    flags = _flags(run)
    twin = _usd_twin(headline)
    closes = pd.Series(
        100_000.0 + 500.0 * np.arange(len(headline) + 5),
        index=pd.date_range(headline.index[0] - pd.Timedelta(days=2), periods=len(headline) + 5),
    )
    ps = [{"strategy_id": "s-1", "current_weight": 1.0}]
    portfolio = [{**_row("s-1", twin, {})}]

    async def _go(row_flags: dict[str, Any] | None) -> tuple[Any, AsyncMock]:
        candidate = {**_row("c-1", headline, {}), "data_quality_flags": row_flags}
        return await _simulate(portfolio, candidate, ps, closes)  # type: ignore[no-untyped-call, no-any-return]

    result, closes_mock = await _go(flags)
    closes_mock.assert_not_awaited()
    baseline, _ = await _go(None)
    assert result["equity_curve_proposed"] == baseline["equity_curve_proposed"]
    assert len(result["equity_curve_proposed"]) >= 35

    leaked, leaked_closes = await _go({**flags, **NATIVE_UNIT_LEAK})
    assert leaked_closes.await_count == 1
    assert leaked["equity_curve_proposed"] != result["equity_curve_proposed"]


# --- mt5_parity and the flowtiming dry run (RESEARCH assumption A3) -------------------------------

_PARITY_DIR = Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "mt5-parity"


async def test_the_mt5_parity_capture_never_selects_an_okx_key() -> None:
    """A3, settled. ``services/mt5_parity*`` has no venue branch of its own: the accounts it reads are
    chosen by the committed capture statements, and each of them scopes its key set to
    ``ak.exchange = 'mt5'``. So an OKX key, switched or not, never enters the harness. Pinned on the
    statements that run (a new statement without the predicate is the failure). The key under test is
    the switched account's own: the real key derive stamps ``venue: okx`` on its ``key_inputs`` row,
    which is the value those predicates are compared against."""
    _cal, run, _headline = await _switched_account(key_mode=True)
    (payload,) = [
        p["payload"]
        for name, p, _c in run.upserts
        if name == "allocator_equity_derived" and str(p["kind"]).startswith("key_inputs:")
    ]
    assert payload["venue"] == "okx"
    statements = sorted(
        p for p in _PARITY_DIR.glob("*.sql") if p.name not in {"marker.sql"}
    )
    assert statements, "no capture statements found"
    keyed = [p for p in statements if "api_keys" in p.read_text()]
    assert len(keyed) >= 8, [p.name for p in keyed]
    for path in keyed:
        text = path.read_text()
        assert re.search(r"ak\.exchange\s*=\s*'mt5'", text), f"{path.name} does not scope to mt5"


async def test_the_flowtiming_dry_run_never_treats_an_okx_key_as_mt5() -> None:
    """A3, settled. The dry run's MT5 loop and its MT5 re-derivation key on ``venue == "mt5"``. An OKX
    key (the switched account's key, with the key_inputs payload the derive just wrote) is counted only
    under its own ordinal in the non-MT5 group: no MT5 entry, no MT5 row."""
    from scripts import flowtiming_dry_run as dr

    _cal, run, headline = await _switched_account(key_mode=True)
    (payload,) = [
        p["payload"]
        for name, p, _c in run.upserts
        if name == "allocator_equity_derived" and str(p["kind"]).startswith("key_inputs:")
    ]
    assert "native_unit" not in payload
    before = {
        "run_date": "2026-11-27",
        "strategies": [],
        "keys": [
            {
                "id": "k-okx", "label": "x", "venue": "okx", "unit": "USD", "native": False,
                "balance_usdt": None, "active": True, "disconnected": False,
                "key_returns": {d.strftime("%Y-%m-%d"): float(v) for d, v in headline.items()},
                "payload": payload, "anchor_null_reason": None, "anchor_usd_null": False,
                "composite_member": False, "anchor_usd": payload["anchor_usd"],
            }
        ],
    }
    analysis = dr.analyze(before, {"offset_s": 0, "keys": {}})
    assert analysis["mt5_keys"] == {} and analysis["mt5_rows"] == []
