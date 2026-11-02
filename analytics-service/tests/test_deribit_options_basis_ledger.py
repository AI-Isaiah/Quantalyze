"""Phase 185 plan 07 (D-04) - the ingest seam for a Deribit key's OPTIONS-basis ledger.

A key whose returns are measured on the cash basis shows an extreme day when a funded
option round trip pays out against a small wallet. The options basis it needs is the
EXISTING smoothed or mark-to-market assembly, not a new basis. This module pins that
``build_deribit_options_basis_ledger`` builds it from the SAME crawl's raw rows, through
the same code path ``build_deribit_native_ledger`` runs, and therefore:

  * equals the ledger an independent second crawl would build (exact, per currency);
  * adds ZERO transaction-log calls to the one crawl (a second full crawl cannot fit the
    900 s derive budget);
  * leaves the cash path byte-identical and never mutates the cash report;
  * fails loud exactly where the strategy pass fails loud;
  * removes the extreme cash-basis day on RAW ROWS through the real assembler.

Everything runs through the real ``build_deribit_native_ledger`` seam with the same stubs
``test_smoothed_mtm_core`` uses (synthetic rows, no network). Amounts are synthetic.
"""
from __future__ import annotations

import asyncio
import copy
from typing import Any

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.broker_dailies import combine_native_ledger
from services.deribit_txn import LedgerValuationError
from tests.fixtures.deribit_option_round_trip import (
    ROUND_TRIP_S,
    cash_round_trip_ledger,
    options_round_trip_ledger,
)
from tests.test_smoothed_mtm_core import (
    _IN_RET_CHARTS,
    _IN_RET_INSTR,
    _IN_RET_ROWS,
    _IN_RET_SUMMARIES,
    _OptionsAdapterStub,
    _PRE_RET_INSTR,
    _PRE_RET_ROWS,
    _mk_ms,
    _opt_row,
    _opt_trade,
    _summary,
)


def _install_stubs(
    monkeypatch: Any, btc_rows: list[dict[str, Any]]
) -> list[tuple[str, str]]:
    """Install the ``test_smoothed_mtm_core`` crawl stubs and return the paginate call log.

    Every ``paginate_txn_log`` call appends ``(scope_label, currency)``; the options build
    must leave that log exactly as the cash build left it."""
    calls: list[tuple[str, str]] = []

    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return ["BTC"]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        calls.append((scope_label, currency))
        return list(btc_rows) if currency == "BTC" else []

    async def _index(
        _ex: Any, _ccy: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        start = pd.Timestamp(oldest_day).normalize()
        end = pd.Timestamp.now("UTC").tz_localize(None).normalize()
        if end < start:
            end = start
        days = pd.date_range(start, end, freq="D")
        return {d.strftime("%Y-%m-%d"): 60000.0 for d in days}

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", _paginate)
    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _index)
    return calls


def _stub(
    summaries: list[dict[str, Any]], charts: dict[str, dict[str, float]]
) -> _OptionsAdapterStub:
    return _OptionsAdapterStub(summaries, charts)


async def _same_crawl(
    stub: _OptionsAdapterStub,
    calls: list[tuple[str, str]],
    *,
    cash_basis: str = di.DEFAULT_PNL_BASIS,
    options_basis: str,
) -> tuple[Any, Any, Any, Any, int, int]:
    """Cash build with the rows retained, then the options build from that report.

    Returns ``(cash_ledger, cash_report, options_ledger, options_report, calls_after_cash,
    calls_after_options)``."""
    cash_ledger, cash_report = await di.build_deribit_native_ledger(
        stub, pnl_basis=cash_basis, retain_raw_rows=True
    )
    after_cash = len(calls)
    state = await di.fetch_deribit_native_account_state(stub)
    options_ledger, options_report = await di.build_deribit_options_basis_ledger(
        stub, report=cash_report, account_state=state, pnl_basis=options_basis
    )
    return (
        cash_ledger,
        cash_report,
        options_ledger,
        options_report,
        after_cash,
        len(calls),
    )


def _assert_ledgers_equal(got: Any, want: Any) -> None:
    """Exact, per currency: native P&L, marks, terminal wedge, flow instants (and the
    terminal equity and dated flows they sit beside)."""
    assert set(got.native_pnl) == set(want.native_pnl)
    for ccy in want.native_pnl:
        pd.testing.assert_series_equal(
            got.native_pnl[ccy], want.native_pnl[ccy], check_exact=True
        )
    assert set(got.marks) == set(want.marks)
    for ccy in want.marks:
        pd.testing.assert_series_equal(
            got.marks[ccy], want.marks[ccy], check_exact=True
        )
    assert dict(got.terminal_upnl_native) == dict(want.terminal_upnl_native)
    assert dict(got.terminal_native_equity) == dict(want.terminal_native_equity)
    assert tuple(got.flow_instants) == tuple(want.flow_instants)
    assert list(got.native_flows) == list(want.native_flows)
    assert got.full_history == want.full_history


# ===========================================================================
# Task 1 (tracer) - one crawl gives the cash ledger and an options-basis ledger
# equal to an independent build (SC-2).
# ===========================================================================


def test_same_crawl_options_ledger_equals_an_independent_build(
    monkeypatch: Any,
) -> None:
    """D-04: the options ledger assembled from the cash build's retained rows equals the
    one an independent second crawl builds on the same rows. The equality is the proof that
    the extracted assembly IS the code path the cash build runs, not a lookalike."""
    basis = "smoothed_mtm"
    calls = _install_stubs(monkeypatch, _IN_RET_ROWS)
    stub = _stub(_IN_RET_SUMMARIES, _IN_RET_CHARTS)

    async def _go() -> tuple[Any, Any]:
        _c, _cr, options_ledger, _or, _a, _b = await _same_crawl(
            stub, calls, options_basis=basis
        )
        independent, _rep = await di.build_deribit_native_ledger(
            stub, pnl_basis=basis
        )
        return options_ledger, independent

    options_ledger, independent = asyncio.run(_go())
    _assert_ledgers_equal(options_ledger, independent)
    # Non-vacuous: the smoothed basis is not the cash basis on this fixture (the ΔMTM
    # day 2026-01-16 exists only on the options ledger).
    assert "2026-01-16" in {
        d.strftime("%Y-%m-%d") for d in options_ledger.native_pnl["BTC"].index
    }


def test_options_build_adds_no_transaction_log_call(monkeypatch: Any) -> None:
    """T-185-18: a second full crawl cannot fit the 900 s derive budget, so the options
    build must make NO transaction-log call: the paginate log after the cash build plus the
    options build equals the log after the cash build alone."""
    calls = _install_stubs(monkeypatch, _IN_RET_ROWS)
    stub = _stub(_IN_RET_SUMMARIES, _IN_RET_CHARTS)

    _c, _cr, _o, _or, after_cash, after_options = asyncio.run(
        _same_crawl(stub, calls, options_basis="smoothed_mtm")
    )
    assert after_cash > 0, "the cash build must have crawled (else this proves nothing)"
    assert after_options == after_cash


# ===========================================================================
# Task 2 - the seam's guards, retention arms and the shared SC-5 fixture.
# ===========================================================================

_PRE_RET_SUMMARIES = [
    {"currency": "BTC", "equity": -0.01, "session_upl": 0.0, "options_value": 0.0}
]


def test_cash_path_is_unchanged_by_retaining_the_rows(monkeypatch: Any) -> None:
    """The cash path is byte-identical: ``retain_raw_rows`` False and True give equal
    ledgers, the default report holds no rows, and no report repr can leak a raw-row key
    (T-185-20)."""
    _install_stubs(monkeypatch, _IN_RET_ROWS)
    stub = _stub(_IN_RET_SUMMARIES, _IN_RET_CHARTS)

    async def _go() -> tuple[Any, Any, Any, Any]:
        plain, plain_report = await di.build_deribit_native_ledger(stub)
        kept, kept_report = await di.build_deribit_native_ledger(
            stub, retain_raw_rows=True
        )
        return plain, plain_report, kept, kept_report

    plain, plain_report, kept, kept_report = asyncio.run(_go())
    _assert_ledgers_equal(kept, plain)
    assert plain_report.raw_rows is None
    assert kept_report.raw_rows is not None and len(kept_report.raw_rows) == len(
        _IN_RET_ROWS
    )
    # A raw row names its instrument and carries an amount; neither may reach a log line.
    for report in (plain_report, kept_report):
        text = repr(report)
        assert "instrument_name" not in text
        assert _IN_RET_INSTR not in text
        assert "raw_rows" not in text


def test_options_build_refuses_a_report_without_raw_rows(monkeypatch: Any) -> None:
    """A programming error is a ``ValueError``, never a silent degrade to the cash basis."""
    _install_stubs(monkeypatch, _IN_RET_ROWS)
    stub = _stub(_IN_RET_SUMMARIES, _IN_RET_CHARTS)

    async def _go() -> None:
        _ledger, report = await di.build_deribit_native_ledger(stub)  # rows NOT kept
        state = await di.fetch_deribit_native_account_state(stub)
        await di.build_deribit_options_basis_ledger(
            stub, report=report, account_state=state, pnl_basis="smoothed_mtm"
        )

    with pytest.raises(ValueError, match="retain_raw_rows"):
        asyncio.run(_go())


def test_options_build_refuses_the_cash_basis(monkeypatch: Any) -> None:
    """The cash basis is not an options basis: asking for it is a programming error, so a
    caller can never believe it measured the options basis and got the cash one."""
    _install_stubs(monkeypatch, _IN_RET_ROWS)
    stub = _stub(_IN_RET_SUMMARIES, _IN_RET_CHARTS)

    async def _go() -> None:
        _ledger, report = await di.build_deribit_native_ledger(
            stub, retain_raw_rows=True
        )
        state = await di.fetch_deribit_native_account_state(stub)
        await di.build_deribit_options_basis_ledger(
            stub, report=report, account_state=state, pnl_basis="cash_settlement"
        )

    with pytest.raises(ValueError, match="not the cash basis"):
        asyncio.run(_go())


def test_options_build_never_mutates_the_cash_report(monkeypatch: Any) -> None:
    """T-185-19: the cash report is the caller's evidence about the cash ledger. The options
    assembly stamps its own ``pre_mark_retention_option_days`` (smoothed only); if it ran on
    the cash report, the cash ledger would warn about retention it never had. Over
    ``_PRE_RET_ROWS`` the cash report stays empty and the options report carries the bucket."""
    calls = _install_stubs(monkeypatch, _PRE_RET_ROWS)
    stub = _stub(_PRE_RET_SUMMARIES, {})

    _c, cash_report, _o, options_report, _a, _b = asyncio.run(
        _same_crawl(stub, calls, options_basis="smoothed_mtm")
    )
    # Taken AFTER the options build; the empty-before half is the cash basis' own contract.
    assert cash_report.pre_mark_retention_option_days == []
    assert options_report is not cash_report
    assert ("BTC", "2023-06-20") in options_report.pre_mark_retention_option_days
    assert options_report.raw_rows is None
    assert cash_report.raw_rows is not None  # the cash report still holds the crawl


def test_pre_retention_days_keep_the_cash_ledgers_exact_values(monkeypatch: Any) -> None:
    """WR-04 / SC-5, F2 f2-a. Over a pre-retention round trip (the venue has no marks) the
    options ledger's ``native_pnl`` equals the cash ledger's EXACTLY on every day, and the
    options report names the bucketed option days; over an in-retention round trip the bucket
    is empty, which is the condition the key-mode caveat clears on."""
    calls = _install_stubs(monkeypatch, _PRE_RET_ROWS)
    cash_ledger, _cr, options_ledger, options_report, _a, _b = asyncio.run(
        _same_crawl(_stub(_PRE_RET_SUMMARIES, {}), calls, options_basis="smoothed_mtm")
    )
    pd.testing.assert_series_equal(
        options_ledger.native_pnl["BTC"], cash_ledger.native_pnl["BTC"], check_exact=True
    )
    assert ("BTC", "2023-06-20") in options_report.pre_mark_retention_option_days

    calls = _install_stubs(monkeypatch, _IN_RET_ROWS)
    *_unused, in_ret_report, _c, _d = asyncio.run(
        _same_crawl(_stub(_IN_RET_SUMMARIES, _IN_RET_CHARTS), calls, options_basis="smoothed_mtm")
    )
    assert in_ret_report.pre_mark_retention_option_days == []


def test_cash_report_equals_its_deepcopy_after_the_options_build(
    monkeypatch: Any,
) -> None:
    """The same, stated as equality: a deepcopy taken before the options build compares equal
    to the cash report after it (``raw_rows`` is ``compare=False``)."""
    calls = _install_stubs(monkeypatch, _PRE_RET_ROWS)
    stub = _stub(_PRE_RET_SUMMARIES, {})

    async def _go() -> tuple[Any, Any]:
        _ledger, cash_report = await di.build_deribit_native_ledger(
            stub, retain_raw_rows=True
        )
        before = copy.deepcopy(cash_report)
        state = await di.fetch_deribit_native_account_state(stub)
        await di.build_deribit_options_basis_ledger(
            stub, report=cash_report, account_state=state, pnl_basis="smoothed_mtm"
        )
        return before, cash_report

    before, after = asyncio.run(_go())
    assert after == before
    assert len(calls) == 1  # one crawl; nothing else asked the log


def test_in_retention_hole_in_the_options_build_fails_loud(monkeypatch: Any) -> None:
    """Fail-loud survives the seam: a wholly-empty marks response for an in-retention
    instrument raises ``LedgerValuationError`` from the OPTIONS build (the caller, plan 185-08,
    falls back to cash), while the cash build over the same crawl succeeded."""
    calls = _install_stubs(monkeypatch, _IN_RET_ROWS)
    summaries = [
        {"currency": "BTC", "equity": -0.02, "session_upl": 0.0, "options_value": 0.0}
    ]
    stub = _stub(summaries, {})  # in retention, but the venue returns no bars

    with pytest.raises(LedgerValuationError):
        asyncio.run(_same_crawl(stub, calls, options_basis="smoothed_mtm"))
    assert len(calls) == 1  # the cash build crawled once and finished before the raise


def test_retention_straddler_in_the_options_build_fails_loud(
    monkeypatch: Any,
) -> None:
    """A retention-STRADDLING instrument (old expiry, PARTIAL marks) is never bucketed; its
    head hole fails the OPTIONS build loud exactly as it fails the strategy pass."""
    straddler_rows = [
        _opt_row(instrument=_PRE_RET_INSTR, day="2023-06-20", change=-0.01, position=1.0, id=1),
        _opt_row(
            instrument=_PRE_RET_INSTR, day="2023-06-22", change=0.0, position=0.0, id=2,
            type="delivery",
        ),
    ]
    calls = _install_stubs(monkeypatch, straddler_rows)
    stub = _stub(_PRE_RET_SUMMARIES, {_PRE_RET_INSTR: {"2023-06-20": 0.02}})

    with pytest.raises(LedgerValuationError):
        asyncio.run(_same_crawl(stub, calls, options_basis="smoothed_mtm"))


def test_same_crawl_mark_to_market_equals_an_independent_build(
    monkeypatch: Any,
) -> None:
    """The seam is basis-agnostic: mark-to-market from the same crawl equals an independent
    mark-to-market build, as the smoothed test above does for smoothed."""
    covered_rows = [
        _summary(day="2025-07-12", rpl=0.6, upl=0.41),
        _summary(day="2025-07-14", rpl=0.0, upl=0.0),
        _opt_trade(day="2025-07-13", change=1.0, commission=0.01, id=5),
    ]
    calls = _install_stubs(monkeypatch, covered_rows)
    stub = _stub([{"currency": "BTC", "equity": 1.0, "session_upl": 0.0}], {})

    async def _go() -> tuple[Any, Any]:
        _c, _cr, options_ledger, _or, _a, _b = await _same_crawl(
            stub, calls, options_basis="mark_to_market"
        )
        independent, _rep = await di.build_deribit_native_ledger(
            stub, pnl_basis="mark_to_market"
        )
        return options_ledger, independent

    options_ledger, independent = asyncio.run(_go())
    _assert_ledgers_equal(options_ledger, independent)


# --- RESEARCH A6: marks span and magnitude on a FUNDED raw-row option round trip ----------
#
# Native BTC, the settlement index stubbed flat at 60,000, so a USD return equals the native
# one. S = 10 BTC is the day-0 deposit; every other amount is a ratio of it. A call on 10 BTC
# of notional is bought for 0.40 per contract (a premium of 0.4 S), marked up 0.06 a contract a
# day (a book move of 0.06 S a day), and delivered for 7.1 BTC (the last mark plus 0.01 S).
_S = 10.0
_RT_INSTR = "BTC-17JAN26-100000-C"
_RT_ROWS: list[dict[str, Any]] = [
    {
        "type": "deposit",
        "currency": "BTC",
        "change": _S,
        "timestamp": _mk_ms("2026-01-10", 9),
        "id": 185_7_001,
    },
    _opt_row(
        instrument=_RT_INSTR, day="2026-01-11", change=-0.4 * _S, position=_S,
        id=185_7_002, commission=0.0,
    ),
    _opt_row(
        instrument=_RT_INSTR, day="2026-01-17", change=0.71 * _S, position=0.0,
        id=185_7_003, type="delivery", commission=0.0,
    ),
]
_RT_CHARTS = {
    _RT_INSTR: {
        "2026-01-11": 0.40,
        "2026-01-12": 0.46,
        "2026-01-13": 0.52,
        "2026-01-14": 0.58,
        "2026-01-15": 0.64,
        "2026-01-16": 0.70,
    }
}
_RT_SUMMARIES = [
    {"currency": "BTC", "equity": 1.31 * _S, "session_upl": 0.0, "options_value": 0.0}
]
# The options basis, typed beside its arithmetic. Net of the premium, the book moves 0.06 S a
# day for five days and the delivery pays 0.01 S over the last mark; the NAV before each day
# is S + the P&L so far:
#   2026-01-11   (-4.0 premium + 4.0 first mark) / 10.0    =  0.0000
#   2026-01-12   0.6 / 10.0                                =  0.0600
#   2026-01-13   0.6 / 10.6                                =  0.0566
#   2026-01-14   0.6 / 11.2                                =  0.0536
#   2026-01-15   0.6 / 11.8                                =  0.0508
#   2026-01-16   0.6 / 12.4                                =  0.0484
#   2026-01-17   (7.1 payout - 7.0 last mark) / 13.0       =  0.0077
_RT_OPTIONS_DAYS = {
    "2026-01-11": 0.0,
    "2026-01-12": 0.06,
    "2026-01-13": 0.6 / 10.6,
    "2026-01-14": 0.6 / 11.2,
    "2026-01-15": 0.6 / 11.8,
    "2026-01-16": 0.6 / 12.4,
    "2026-01-17": 0.1 / 13.0,
}
# The largest mark-driven daily move: the first marked day, 0.6 / 10.0 (the NAV is smallest).
_RT_OPTIONS_BOUND = 0.06
# The cash basis books the premium on day 1 and the payout on the last day:
#   2026-01-11   -4.0 / 10.0  = -0.4000 ;   2026-01-17   +7.1 / 6.0  = +1.1833
_RT_CASH_EXTREME = 7.1 / 6.0


def _day_returns(returns: pd.Series) -> dict[str, float]:
    return {d.strftime("%Y-%m-%d"): float(v) for d, v in returns.items()}


def _round_trip(
    monkeypatch: Any,
) -> tuple[Any, Any, Any, Any, frozenset[str]]:
    calls = _install_stubs(monkeypatch, _RT_ROWS)
    stub = _stub(_RT_SUMMARIES, _RT_CHARTS)
    cash_ledger, cash_report, options_ledger, options_report, _a, _b = asyncio.run(
        _same_crawl(stub, calls, options_basis="smoothed_mtm")
    )
    return (
        cash_ledger,
        cash_report,
        options_ledger,
        options_report,
        cash_report.indexable_currencies,
    )


def test_a6_every_marked_day_has_a_mark_and_the_core_raises_no_missing_marks(
    monkeypatch: Any,
) -> None:
    """RESEARCH A6 (a): every day carrying a nonzero ΔMTM for an indexed currency has a mark
    in the options ledger's ``marks``, and ``combine_native_ledger`` raises no
    ``missing_daily_marks`` refusal on it."""
    cash, _cr, options, _or, indexable = _round_trip(monkeypatch)
    delta_mtm = (
        options.native_pnl["BTC"].sub(cash.native_pnl["BTC"], fill_value=0.0)
    )
    marked_days = [d for d, v in delta_mtm.items() if abs(v) > 1e-12]
    assert len(marked_days) >= 6, "the fixture must carry a multi-day ΔMTM run"
    mark_days = set(options.marks["BTC"].index)
    assert [d for d in marked_days if d not in mark_days] == []
    combine_native_ledger(options, indexable)  # must not raise


def test_a6_the_cash_basis_shows_the_extreme_day_from_raw_rows(
    monkeypatch: Any,
) -> None:
    """RESEARCH A6 (b): the defect, reproduced from raw rows. On the cash ledger the premium
    lands on one day and the payout on another: at least one day has |r| > 0.5."""
    cash, _cr, _o, _or, indexable = _round_trip(monkeypatch)
    returns, _meta = combine_native_ledger(cash, indexable)
    days = _day_returns(returns)
    assert max(abs(v) for v in days.values() if v == v) > 0.5
    assert days["2026-01-11"] == pytest.approx(-0.4, abs=5e-4)
    assert days["2026-01-17"] == pytest.approx(_RT_CASH_EXTREME, abs=5e-4)


def test_a6_the_options_basis_removes_the_extreme_day_through_the_real_assembler(
    monkeypatch: Any,
) -> None:
    """RESEARCH A6 (c): the SAME rows, assembled by the real ``_assemble_deribit_native_ledger``
    on the options basis, give every day its typed value and none beyond the typed
    mark-driven bound - well under 0.5."""
    _c, _cr, options, _or, indexable = _round_trip(monkeypatch)
    returns, _meta = combine_native_ledger(options, indexable)
    days = _day_returns(returns)
    for day, want in _RT_OPTIONS_DAYS.items():
        assert days[day] == pytest.approx(want, abs=5e-4), day
    finite = [abs(v) for v in days.values() if v == v]
    assert max(finite) <= _RT_OPTIONS_BOUND + 5e-4
    assert max(finite) < 0.5


# --- the shared SC-5 fixture: the oracle, pinned once ---------------------------------------


def test_round_trip_fixture_cash_pair_gives_the_research_oracle() -> None:
    returns, meta = combine_native_ledger(cash_round_trip_ledger(), frozenset())
    assert ROUND_TRIP_S == 100_000.0
    day0, d1, d2, d3 = returns.tolist()
    assert day0 != day0  # the funding day is NaN
    assert d1 == pytest.approx(-0.4839, abs=5e-4)
    assert d2 == pytest.approx(0.0280, abs=5e-4)
    assert d3 == pytest.approx(3.3339, abs=5e-4)
    assert float((1 + returns.fillna(0.0)).prod() - 1) == pytest.approx(1.2994, abs=5e-4)
    assert meta.get("flow_timing_day_level_large") is True


def test_round_trip_fixture_options_pair_gives_the_research_oracle() -> None:
    returns, meta = combine_native_ledger(options_round_trip_ledger(), frozenset())
    day0, d1, d2, d3 = returns.tolist()
    assert day0 != day0
    assert d1 == pytest.approx(0.0, abs=5e-4)
    assert d2 == pytest.approx(0.1740, abs=5e-4)
    assert d3 == pytest.approx(0.9586, abs=5e-4)
    assert float((1 + returns.fillna(0.0)).prod() - 1) == pytest.approx(1.2994, abs=5e-4)
    assert "flow_timing_day_level_large" not in meta
