"""Phase 131 — the ``smoothed_mtm`` third factsheet ``pnl_basis`` (01b wiring).

Cross-layer pins for the smoothed_mtm basis: both basis enums carry the member
(config/compute agreement), the ``txn_rows_to_native_daily`` smoothed branch, the
adapter ΔMTM merge in ``build_deribit_native_ledger``, the smoothed-only identity
channels in ``assert_balance_identity``, and the SC-4 byte-identity keystone.

ADDITIVE: every production hunk these pins protect is gated on
``pnl_basis == 'smoothed_mtm'`` OR option classification — the ``cash_settlement``
and ``mark_to_market`` paths stay BYTE-IDENTICAL (SC-4). The 83-PLAN Task-4/6
DELETIONS are explicitly NOT performed under this third-basis framing.
"""
from __future__ import annotations

import asyncio
import struct
from typing import Any

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.native_nav import reconstruct_native_nav_and_twr
from services.allocated_capital import (
    ReturnsDenominatorConfigError,
    _VALID_PNL_BASES,
    parse_returns_denominator_config,
)
from services.deribit_txn import (
    DEFAULT_PNL_BASIS,
    LedgerValuationError,
    PNL_BASIS_CASH_SETTLEMENT,
    PNL_BASIS_MARK_TO_MARKET,
    PNL_BASIS_SMOOTHED_MTM,
    _PNL_BASES,
    assert_balance_identity,
    txn_rows_to_native_daily,
)


# ===========================================================================
# Task 3 — both basis enums carry smoothed_mtm (config/compute agreement) +
# the use_smoothed branch in txn_rows_to_native_daily.
# ===========================================================================


def test_smoothed_mtm_member_of_both_basis_enums() -> None:
    """Enum-sync pin: PNL_BASIS_SMOOTHED_MTM == 'smoothed_mtm' is a member of BOTH
    deribit_txn._PNL_BASES AND allocated_capital._VALID_PNL_BASES; the DEFAULT is
    UNCHANGED and the two existing members survive (SC-4)."""
    assert PNL_BASIS_SMOOTHED_MTM == "smoothed_mtm"
    assert PNL_BASIS_SMOOTHED_MTM in _PNL_BASES
    assert "smoothed_mtm" in _VALID_PNL_BASES
    # DEFAULT untouched — headline / peer-rank basis stays cash_settlement.
    assert DEFAULT_PNL_BASIS == PNL_BASIS_CASH_SETTLEMENT == "cash_settlement"
    # The two existing members are still present in BOTH enums (no rewrite).
    assert {PNL_BASIS_CASH_SETTLEMENT, PNL_BASIS_MARK_TO_MARKET} <= _PNL_BASES
    assert {"cash_settlement", "mark_to_market"} <= _VALID_PNL_BASES


_SMOOTHED_CONFIG_RAW = {
    "denominator": "allocated_capital",
    "pnl_basis": "smoothed_mtm",
    "capital_schedule": [
        {"effective_from": "2025-08-03", "capital_usd": 4000000},
    ],
    "metrics_basis": "active_day",
}


def test_allocated_capital_config_accepts_smoothed_and_rejects_unknown() -> None:
    """The config-layer validation sites (allocated_capital.py:158/:230) accept
    'smoothed_mtm' via _VALID_PNL_BASES and still reject an unknown basis."""
    cfg = parse_returns_denominator_config(_SMOOTHED_CONFIG_RAW)
    assert cfg is not None
    assert cfg.pnl_basis == "smoothed_mtm"
    bad = {**_SMOOTHED_CONFIG_RAW, "pnl_basis": "realized_only"}
    with pytest.raises(ReturnsDenominatorConfigError):
        parse_returns_denominator_config(bad)


def _ms(iso: str) -> int:
    return int(pd.Timestamp(iso, tz="UTC").timestamp() * 1000)


def _opt_trade(
    *, day: str, change: float, commission: float = 0.01, id: int = 1
) -> dict[str, Any]:
    return {
        "type": "trade",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": "BTC",
        "change": change,
        "commission": commission,
        "position": 1.0,
        "timestamp": _ms(f"{day}T10:00:00+00:00"),
        "id": id,
    }


def _summary(*, day: str, rpl: float, upl: float, change: float = 0.0) -> dict[str, Any]:
    return {
        "type": "options_settlement_summary",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": "BTC",
        "change": change,
        "realized_pl": rpl,
        "unrealized_pl": upl,
        "timestamp": _ms(f"{day}T08:00:00+00:00"),
        "id": 900,
    }


def test_smoothed_option_row_contributes_full_change() -> None:
    """Under smoothed_mtm an option trade/delivery row books its FULL native
    `change` on its settlement day (the redistribution happens in the adapter's
    ΔMTM channel, Task 4) — identical to cash_settlement's cash channel, NOT the
    coverage-gated −commission arm of mark_to_market. A summary row is present but
    must not reshape the option cash leg."""
    rows = [
        _opt_trade(day="2025-07-13", change=0.05, commission=0.01, id=1),
        _summary(day="2025-07-14", rpl=0.03, upl=-0.01),
    ]
    native = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    # FULL change booked on the trade day; summary contributes NOTHING.
    assert native == {"BTC": {"2025-07-13": 0.05}}


def test_smoothed_summary_contributes_nothing() -> None:
    """A summary row (realized_pl=0.03, unrealized_pl=-0.01, change==0) under
    smoothed_mtm creates NO native_pnl entry — the summary is a Task-5
    reconciliation cross-check, never an attribution channel."""
    rows = [_summary(day="2025-07-14", rpl=0.03, upl=-0.01)]
    assert txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM) == {}


def test_smoothed_summary_nonzero_change_fails_loud() -> None:
    """The change==0 enforcement on summary rows still fires under smoothed_mtm: a
    nonzero summary `change` is semantics drift → LedgerValuationError (kept
    verbatim from the mark_to_market discipline)."""
    rows = [_summary(day="2025-07-14", rpl=0.03, upl=-0.01, change=0.02)]
    with pytest.raises(LedgerValuationError):
        txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)


def test_smoothed_cash_channel_byte_identical_to_cash_settlement() -> None:
    """SC-4-adjacent (pure layer): the smoothed cash channel output equals the
    cash_settlement output on an options fixture (the ΔMTM redistribution is
    merged by the adapter, NOT here — the pure aggregator is unchanged between the
    two bases). mark_to_market, by contrast, reshapes the option leg."""
    rows = [
        _opt_trade(day="2025-07-13", change=0.05, commission=0.01, id=1),
        _summary(day="2025-07-14", rpl=0.03, upl=-0.01),
    ]
    cash = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_CASH_SETTLEMENT)
    smoothed = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    assert smoothed == cash


# ===========================================================================
# Task 4 — the adapter ΔMTM merge in build_deribit_native_ledger (smoothed-
# gated) + the pre_mark_retention_option_days bucket. All through the REAL
# build_deribit_native_ledger seam (synthetic BTC option rows/marks/summaries +
# a monkeypatched settlement index — no network). The merge is DOUBLY gated:
# basis == smoothed_mtm AND option classification.
# ===========================================================================


def _mk_ms(iso_day: str, hour: int = 10) -> int:
    return int(
        pd.Timestamp(f"{iso_day}T{hour:02d}:00:00", tz="UTC").timestamp() * 1000
    )


def _opt_row(
    *, instrument: str, day: str, change: float, position: float,
    id: int, type: str = "trade", commission: float = 0.01,
) -> dict[str, Any]:
    return {
        "type": type,
        "instrument_name": instrument,
        "currency": "BTC",
        "change": change,
        "commission": commission,
        "position": position,
        "timestamp": _mk_ms(day),
        "id": id,
    }


class _OptionsAdapterStub:
    """A synthetic Deribit exchange for the options smoothed_mtm seam: ONE
    account-summaries response, an index-price for the collapsed anchor, and a
    per-instrument 1D chart-data script (with a call log so a test can assert the
    marks fetcher is NEVER hit on a non-smoothed / perp-only ledger)."""

    def __init__(
        self,
        summaries: list[dict[str, Any]],
        charts: dict[str, dict[str, float]],
        *,
        index_price: float = 60000.0,
    ) -> None:
        self._summaries = summaries
        self._charts = charts
        self._index_price = index_price
        self.chart_calls: list[str] = []
        self.chart_params: list[dict[str, Any]] = []

    async def private_get_get_account_summaries(self, params: Any) -> Any:
        return {"result": {"summaries": self._summaries}}

    async def public_get_get_index_price(self, params: Any) -> Any:
        return {"result": {"index_price": self._index_price}}

    async def public_get_get_tradingview_chart_data(self, params: Any) -> Any:
        # CR-01: the stub RESPECTS start_timestamp/end_timestamp and stamps bars
        # at 08:00 UTC exactly as Deribit does (M7 evidence: bar_stamp_utc 08:00).
        # The original stub ignored the requested range entirely — which is how
        # the midnight end-bound bug (newest day's 08:00 bar never fetched)
        # stayed test-blessed.
        self.chart_calls.append(str(params.get("instrument_name")))
        self.chart_params.append(dict(params))
        marks = self._charts.get(str(params.get("instrument_name")), {})
        start = int(params["start_timestamp"])
        end = int(params["end_timestamp"])
        bars = sorted(
            (int(pd.Timestamp(f"{d}T08:00:00", tz="UTC").timestamp() * 1000), px)
            for d, px in marks.items()
        )
        in_range = [(ts, px) for ts, px in bars if start <= ts <= end]
        if not in_range:
            return {"result": {"status": "no_data", "ticks": [], "close": []}}
        return {
            "result": {
                "status": "ok",
                "ticks": [ts for ts, _ in in_range],
                "close": [px for _, px in in_range],
            }
        }


def _run_options_ledger(
    monkeypatch: Any,
    *,
    btc_rows: list[dict[str, Any]],
    summaries: list[dict[str, Any]],
    charts: dict[str, dict[str, float]],
    pnl_basis: str,
) -> tuple[Any, Any, _OptionsAdapterStub]:
    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return ["BTC"]

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        return list(btc_rows) if currency == "BTC" else []

    async def _index(
        _ex: Any, _ccy: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        # Dense BTC settlement index from the oldest required day to today — covers
        # whatever span the (cash + ΔMTM) native_pnl series ends up requiring.
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

    stub = _OptionsAdapterStub(summaries, charts)
    ledger, report = asyncio.run(
        di.build_deribit_native_ledger(stub, pnl_basis=pnl_basis)
    )
    return ledger, report, stub


# An in-retention (recent expiry) BTC call, opened 01-15, delivered 01-17. Cash
# legs: −0.05 premium on 01-15, +0.03 payout on 01-17. Marks 0.05→0.06 (pos 1.0).
_IN_RET_INSTR = "BTC-17JAN26-100000-C"
_IN_RET_ROWS = [
    _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
    _opt_row(
        instrument=_IN_RET_INSTR, day="2026-01-17", change=0.03, position=0.0, id=2,
        type="delivery",
    ),
]
_IN_RET_CHARTS = {_IN_RET_INSTR: {"2026-01-15": 0.05, "2026-01-16": 0.06}}
# terminal book flat (delivered) → equity == Σ cash change == -0.02.
_IN_RET_SUMMARIES = [
    {"currency": "BTC", "equity": -0.02, "session_upl": 0.0, "options_value": 0.0}
]


def _series_to_daymap(series: pd.Series) -> dict[str, float]:
    return {d.strftime("%Y-%m-%d"): float(v) for d, v in series.items()}


def test_smoothed_adapter_merges_delta_mtm(monkeypatch: Any) -> None:
    """Options fixture under smoothed_mtm: ledger native_pnl == cash channel +
    hand-computed ΔMTM per (day, ccy). Book 0.05→0.06→0 (delivered) ⇒ ΔMTM
    +0.05,+0.01,−0.06; cash −0.05(15),+0.03(17). Merged: 0.0(15),+0.01(16),
    −0.03(17). Telescoping-exact: Σ merged == Σ cash (flat terminal)."""
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_IN_RET_ROWS,
        summaries=_IN_RET_SUMMARIES,
        charts=_IN_RET_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    assert got == pytest.approx(
        {"2026-01-15": 0.0, "2026-01-16": 0.01, "2026-01-17": -0.03}, abs=1e-9
    )
    assert sum(got.values()) == pytest.approx(-0.02, abs=1e-9)  # == Σ cash change


def test_smoothed_merge_wiring_guard(monkeypatch: Any) -> None:
    """WIRING-GUARD: neutering the merge (option_mtm_daily → empties) collapses the
    smoothed series back to the pure cash channel — proving the merge is actually
    INVOKED at the adapter call site, not decorative."""
    monkeypatch.setattr(
        di, "option_mtm_daily", lambda positions, marks: ({}, {})
    )
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_IN_RET_ROWS,
        summaries=_IN_RET_SUMMARIES,
        charts=_IN_RET_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    # Neutered → cash only (no ΔMTM days): −0.05 on 15, +0.03 on 17, no 16.
    assert got == pytest.approx({"2026-01-15": -0.05, "2026-01-17": 0.03}, abs=1e-9)


def test_smoothed_one_expiry_capped_request_per_instrument(monkeypatch: Any) -> None:
    """One marks request per held instrument, instrument name VERBATIM, expiry-
    capped bounds (never past expiry)."""
    _ledger, _report, stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_IN_RET_ROWS,
        summaries=_IN_RET_SUMMARIES,
        charts=_IN_RET_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    assert stub.chart_calls == [_IN_RET_INSTR]  # exactly one, verbatim


def test_cash_settlement_options_zero_marks_fetches(monkeypatch: Any) -> None:
    """SC-4 doubly-gated: the SAME options fixture under cash_settlement fetches
    ZERO option marks (basis gate) and the ledger equals the pure cash golden."""
    ledger, _report, stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_IN_RET_ROWS,
        summaries=_IN_RET_SUMMARIES,
        charts=_IN_RET_CHARTS,
        pnl_basis="cash_settlement",
    )
    assert stub.chart_calls == []  # marks fetcher NEVER called
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    assert got == pytest.approx({"2026-01-15": -0.05, "2026-01-17": 0.03}, abs=1e-9)


def test_mark_to_market_options_zero_marks_fetches(monkeypatch: Any) -> None:
    """SC-4 doubly-gated: a covered-era options fixture under mark_to_market fetches
    ZERO option marks (the smoothed ΔMTM merge is basis-gated OFF)."""
    covered_rows = [
        _summary(day="2025-07-12", rpl=0.6, upl=0.41),
        _summary(day="2025-07-14", rpl=0.0, upl=0.0),
        _opt_trade(day="2025-07-13", change=1.0, commission=0.01, id=5),
    ]
    summaries = [{"currency": "BTC", "equity": 1.0, "session_upl": 0.0}]
    _ledger, _report, stub = _run_options_ledger(
        monkeypatch,
        btc_rows=covered_rows,
        summaries=summaries,
        charts={},
        pnl_basis="mark_to_market",
    )
    assert stub.chart_calls == []


def test_perp_only_smoothed_zero_fetches_byte_identical(monkeypatch: Any) -> None:
    """Perp-only fixture under smoothed_mtm: the replay is empty (no option rows) ⇒
    marks fetcher NEVER called ⇒ no-op merge ⇒ byte-identical to its
    cash_settlement output (classification gate)."""
    perp_rows = [
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": 0.5, "index_price": 60000.0, "timestamp": _mk_ms("2026-01-15")},
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": 0.02, "index_price": 60000.0, "timestamp": _mk_ms("2026-01-16")},
    ]
    summaries = [{"currency": "BTC", "equity": 0.52, "session_upl": 0.0}]
    led_s, _r1, stub_s = _run_options_ledger(
        monkeypatch, btc_rows=perp_rows, summaries=summaries, charts={},
        pnl_basis="smoothed_mtm",
    )
    assert stub_s.chart_calls == []  # no option rows → no fetch
    led_c, _r2, _stub_c = _run_options_ledger(
        monkeypatch, btc_rows=perp_rows, summaries=summaries, charts={},
        pnl_basis="cash_settlement",
    )
    pd.testing.assert_series_equal(
        led_s.native_pnl["BTC"], led_c.native_pnl["BTC"], check_exact=True
    )


# A pre-retention instrument: expiry 2023-06-30 (well past the ~2.5yr chart
# retention horizon), so its 1D chart returns WHOLLY EMPTY.
_PRE_RET_INSTR = "BTC-30JUN23-30000-C"
_PRE_RET_ROWS = [
    _opt_row(instrument=_PRE_RET_INSTR, day="2023-06-20", change=-0.01, position=1.0, id=1),
    _opt_row(
        instrument=_PRE_RET_INSTR, day="2023-06-30", change=0.0, position=0.0, id=2,
        type="delivery",
    ),
]


def test_pre_retention_instrument_bucketed_stays_cash_basis(monkeypatch: Any) -> None:
    """A wholly-EMPTY marks response for an instrument whose expiry predates chart
    retention → NO MTM (its days stay cash-basis), and CompletenessReport gains
    pre_mark_retention_option_days buckets (the complete_with_warnings channel)."""
    summaries = [
        {"currency": "BTC", "equity": -0.01, "session_upl": 0.0, "options_value": 0.0}
    ]
    ledger, report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_PRE_RET_ROWS,
        summaries=summaries,
        charts={},  # wholly-empty → no_data
        pnl_basis="smoothed_mtm",
    )
    # Days stay cash-basis (only the −0.01 premium on 06-20; 0.0 delivery no entry).
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    assert got == pytest.approx({"2023-06-20": -0.01}, abs=1e-9)
    # Pre-retention buckets reported (worker stamps complete_with_warnings later).
    assert ("BTC", "2023-06-20") in report.pre_mark_retention_option_days
    assert report.pre_mark_retention_option_days == sorted(
        report.pre_mark_retention_option_days
    )


def test_in_retention_empty_marks_fails_loud(monkeypatch: Any) -> None:
    """A wholly-EMPTY marks response for an instrument whose expiry is INSIDE the
    retention horizon (recent) → NOT bucketed → option_mtm_daily fails loud at
    ledger build (a listed instrument with a nonzero position and no bar)."""
    summaries = [
        {"currency": "BTC", "equity": -0.02, "session_upl": 0.0, "options_value": 0.0}
    ]
    with pytest.raises(LedgerValuationError):
        _run_options_ledger(
            monkeypatch,
            btc_rows=_IN_RET_ROWS,
            summaries=summaries,
            charts={},  # in-retention but empty → structural hole → fail loud
            pnl_basis="smoothed_mtm",
        )


def test_retention_straddler_partial_marks_not_bucketed_fails_loud(
    monkeypatch: Any,
) -> None:
    """The partition keys on WHOLLY-empty AND expiry-old. A retention-STRADDLING
    instrument (old expiry but PARTIAL marks — head holes) is NOT wholly-empty, so
    it is NEVER bucketed; its head hole falls through to the 01a hole guard and
    fails the ledger build loud (the pinned D-07 consequence)."""
    # Old expiry (< retention cutoff) but PARTIAL marks (06-20 present, 06-21 hole
    # while position is still 1.0) → not wholly-empty → not bucketed → fail loud.
    straddler_rows = [
        _opt_row(instrument=_PRE_RET_INSTR, day="2023-06-20", change=-0.01, position=1.0, id=1),
        _opt_row(
            instrument=_PRE_RET_INSTR, day="2023-06-22", change=0.0, position=0.0, id=2,
            type="delivery",
        ),
    ]
    summaries = [
        {"currency": "BTC", "equity": -0.01, "session_upl": 0.0, "options_value": 0.0}
    ]
    with pytest.raises(LedgerValuationError):
        _run_options_ledger(
            monkeypatch,
            btc_rows=straddler_rows,
            summaries=summaries,
            charts={_PRE_RET_INSTR: {"2023-06-20": 0.02}},  # 06-21 hole (pos 1.0)
            pnl_basis="smoothed_mtm",
        )


# ===========================================================================
# Task 5 — smoothed-only identity channels in assert_balance_identity +
# native_options_session_upl on DeribitNativeAccountState.
# ===========================================================================


def test_state_field_defaults_empty_absent_zero() -> None:
    """SC-4: native_options_session_upl is DEFAULTED — every existing 7-arg
    positional constructor stays valid and an absent field reads 0.0."""
    st = di.DeribitNativeAccountState({}, {}, None, 0.0, True, False, {})
    assert st.native_options_session_upl == {}
    assert st.native_options_session_upl.get("BTC", 0.0) == 0.0


def test_state_reads_options_session_upl_off_summaries() -> None:
    """The options-only session uPnL is read STRAIGHT off the SAME summaries
    response; absent (perp-only / no open options) → 0.0 (never fabricated)."""

    class _Stub:
        async def private_get_get_account_summaries(self, params: Any) -> Any:
            return {"result": {"summaries": [
                {"currency": "BTC", "equity": 1.0, "session_upl": 0.0,
                 "options_value": 0.2, "options_session_upl": 0.05},
                {"currency": "ETH", "equity": 1.0, "session_upl": 0.0},  # absent leg
            ]}}

        async def public_get_get_index_price(self, params: Any) -> Any:
            return {"result": {"index_price": 60000.0}}

    state = asyncio.run(di.fetch_deribit_native_account_state(_Stub()))
    assert state.native_options_session_upl["BTC"] == 0.05
    assert state.native_options_session_upl["ETH"] == 0.0  # absent → 0.0


# --- Book channel (anchor cross-check) through the real adapter ---------------

_OPEN_INSTR = "BTC-30JAN26-100000-C"
_OPEN_ROWS = [
    _opt_row(instrument=_OPEN_INSTR, day="2026-01-15", change=-0.10, position=2.0, id=1),
]
_OPEN_CHARTS = {_OPEN_INSTR: {"2026-01-15": 0.06}}  # Book = 2.0 × 0.06 = 0.12
# anchor settled book = options_value − options_session_upl = 0.15 − 0.03 = 0.12.
_OPEN_SUMMARIES = [
    {"currency": "BTC", "equity": 0.02, "session_upl": 0.0,
     "options_value": 0.15, "options_session_upl": 0.03},
]


def test_smoothed_book_channel_reconciles_open_book(monkeypatch: Any) -> None:
    """Open-at-crawl book: the replayed settled book (2.0 × 0.06 = 0.12) reconciles
    against the anchor's settled book (options_value − options_session_upl = 0.12) →
    build succeeds; the merged series telescopes cash(−0.10) + ΔBook(0.12) = 0.02."""
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_OPEN_ROWS,
        summaries=_OPEN_SUMMARIES,
        charts=_OPEN_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    assert got == pytest.approx({"2026-01-15": 0.02}, abs=1e-9)


def test_smoothed_book_channel_breach_fails_loud_no_leak(monkeypatch: Any) -> None:
    """A perturbed anchor (options_value 0.15 → 0.50, settled 0.47 vs computed
    0.12) breaches the book channel → LedgerValuationError naming the currency and
    a magnitude CLASS only (never a held balance)."""
    bad_summaries = [
        {"currency": "BTC", "equity": 0.02, "session_upl": 0.0,
         "options_value": 0.50, "options_session_upl": 0.03},
    ]
    with pytest.raises(LedgerValuationError) as exc:
        _run_options_ledger(
            monkeypatch,
            btc_rows=_OPEN_ROWS,
            summaries=bad_summaries,
            charts=_OPEN_CHARTS,
            pnl_basis="smoothed_mtm",
        )
    msg = str(exc.value)
    assert "BTC" in msg and "book-channel" in msg
    # Leak discipline: no raw settled balance echoed.
    assert "0.50" not in msg and "0.47" not in msg and "0.12" not in msg


def test_smoothed_book_channel_mark_is_load_bearing(monkeypatch: Any) -> None:
    """Mutation-honesty: perturbing the daily MARK (0.06 → 0.20, Book 0.40 vs the
    anchor's 0.12) breaches the book channel — the marks are load-bearing, not
    decorative."""
    with pytest.raises(LedgerValuationError):
        _run_options_ledger(
            monkeypatch,
            btc_rows=_OPEN_ROWS,
            summaries=_OPEN_SUMMARIES,
            charts={_OPEN_INSTR: {"2026-01-15": 0.20}},  # mark perturbed
            pnl_basis="smoothed_mtm",
        )


# --- CR-02: marks window reaches the last SETTLEMENT, not the last EVENT ------
#
# An OPEN instrument (final replayed position nonzero) stays exposed through the
# current settlement boundary, not just its last trade day. The marks window must
# therefore extend to min(last settled bar day, expiry) so (a) the ΔMTM series
# carries the book on every held day after the last trade and (b) the terminal
# book reconciles against the anchor's CURRENT settled book. Before the fix the
# window ended at the last EVENT day: a lone open position truncated its series
# and breached the book channel on any mark move, and a second instrument trading
# LATER extended the global grid past the first one's fetched marks → a spurious
# D-07 "structural hole" naming a healthy instrument.

# Open call: bought 2.0 on 01-15 (premium 0.05/contract → change −0.10), HELD.
# Venue bars through 01-17 with a MOVED mark (0.06 → 0.08); expiry 30JAN26 caps
# the window deterministically. Settled book = 2.0 × 0.08 = 0.16.
_HELD_INSTR = "BTC-30JAN26-100000-C"
_HELD_ROWS = [
    _opt_row(instrument=_HELD_INSTR, day="2026-01-15", change=-0.10, position=2.0, id=1),
]
_HELD_CHARTS = {
    _HELD_INSTR: {"2026-01-15": 0.06, "2026-01-16": 0.07, "2026-01-17": 0.08}
}
# Deribit economics: equity = cash + futures_session_upl + options_value
#                 = −0.10 + 0.0 + 0.16 = 0.06 (settled anchor 0.16 − 0.0 = 0.16).
_HELD_SUMMARIES = [
    {"currency": "BTC", "equity": 0.06, "session_upl": 0.0,
     "options_value": 0.16, "options_session_upl": 0.0},
]


def test_smoothed_open_position_marked_through_last_settled_day(
    monkeypatch: Any,
) -> None:
    """CR-02(a): an open position with ≥2 settled days after its last trade and a
    MOVED mark builds green with the ΔMTM carried on EVERY held day — under the
    old last-EVENT window the terminal book was stale (0.12 vs the anchor's 0.16)
    and the book channel hard-failed a healthy account."""
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_HELD_ROWS,
        summaries=_HELD_SUMMARIES,
        charts=_HELD_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    # cash −0.10 on 15; ΔMTM +0.12 (15), +0.02 (16), +0.02 (17).
    assert got == pytest.approx(
        {"2026-01-15": 0.02, "2026-01-16": 0.02, "2026-01-17": 0.02}, abs=1e-9
    )
    # M5: total == Σchange + Book(last settlement).
    assert sum(got.values()) == pytest.approx(-0.10 + 0.16, abs=1e-9)


def test_smoothed_interleaved_instruments_no_spurious_hole(
    monkeypatch: Any,
) -> None:
    """CR-02(b): instrument A held OPEN past its last event while instrument B
    trades later. The global grid runs to B's last day; A's marks must be fetched
    through it — under the old per-instrument last-EVENT window A had no marks
    past its own trade day and the hole guard falsely named A."""
    instr_b = "BTC-20JAN26-90000-P"
    rows = [
        _opt_row(instrument=_HELD_INSTR, day="2026-01-15", change=-0.10, position=2.0, id=1),
        _opt_row(instrument=instr_b, day="2026-01-18", change=-0.02, position=1.0, id=2),
        _opt_row(
            instrument=instr_b, day="2026-01-19", change=0.01, position=0.0, id=3,
            type="delivery",
        ),
    ]
    charts = {
        _HELD_INSTR: {
            "2026-01-15": 0.06, "2026-01-16": 0.07, "2026-01-17": 0.08,
            "2026-01-18": 0.05, "2026-01-19": 0.09,
        },
        instr_b: {"2026-01-18": 0.02},
    }
    # cash = −0.10 − 0.02 + 0.01 = −0.11; settled book = 2.0 × 0.09 = 0.18 (B flat);
    # equity = cash + options_value = 0.07.
    summaries = [
        {"currency": "BTC", "equity": 0.07, "session_upl": 0.0,
         "options_value": 0.18, "options_session_upl": 0.0},
    ]
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=rows,
        summaries=summaries,
        charts=charts,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    # Book: 0.12, 0.14, 0.16, 2×0.05+1×0.02=0.12, 2×0.09=0.18 →
    # ΔMTM: +0.12, +0.02, +0.02, −0.04, +0.06; cash: −0.10(15), −0.02(18), +0.01(19).
    assert got == pytest.approx(
        {
            "2026-01-15": 0.02, "2026-01-16": 0.02, "2026-01-17": 0.02,
            "2026-01-18": -0.06, "2026-01-19": 0.07,
        },
        abs=1e-9,
    )
    assert sum(got.values()) == pytest.approx(-0.11 + 0.18, abs=1e-9)


def test_smoothed_open_future_expiry_capped_at_last_settled_day(
    monkeypatch: Any,
) -> None:
    """CR-02: an open instrument whose expiry is in the FUTURE is fetched through
    the last SETTLED bar day (bar stamped D 08:00 completes at D+1 08:00 — the
    current partial bar is never ingested), NEVER through expiry or `now()`. The
    stub scripts a bar PAST the settled day to prove the cap excludes it."""
    monkeypatch.setattr(di, "_last_settled_option_mark_day", lambda: "2026-01-17")
    instr = "BTC-26MAR27-100000-C"  # expiry 2027-03-26 — far future
    rows = [
        _opt_row(instrument=instr, day="2026-01-15", change=-0.10, position=2.0, id=1),
    ]
    charts = {
        instr: {
            "2026-01-15": 0.06, "2026-01-16": 0.07, "2026-01-17": 0.08,
            # Stamped 2026-01-18 08:00 — the first bar past the settled window;
            # ingesting it would poison the terminal book with an unsettled mark.
            "2026-01-18": 0.50,
        }
    }
    ledger, _report, stub = _run_options_ledger(
        monkeypatch,
        btc_rows=rows,
        summaries=_HELD_SUMMARIES,
        charts=charts,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    assert got == pytest.approx(
        {"2026-01-15": 0.02, "2026-01-16": 0.02, "2026-01-17": 0.02}, abs=1e-9
    )
    # The requested end bound is last_settled + 24h (covers 01-17's 08:00 bar,
    # excludes 01-18's) — never expiry (2027) and never now().
    (params,) = stub.chart_params
    assert params["end_timestamp"] == _ms("2026-01-18T00:00:00+00:00")


def test_smoothed_worthless_option_zero_close_is_not_a_hole(
    monkeypatch: Any,
) -> None:
    """WR-04 wiring: a held deep-OTM option whose daily bar closes at 0.0 is a
    LEGITIMATE worthless mark, not a missing bar. The old fetcher dropped the
    0.0 close (cloned from the perp-index sibling) and the D-07 guard then
    hard-failed the healthy position as a 'structural hole'. The premium
    collapse must instead be BOOKED: ΔMTM carries −Book on the worthless day."""
    instr = "BTC-17JAN26-100000-C"
    rows = [
        _opt_row(instrument=instr, day="2026-01-15", change=-0.05, position=1.0, id=1),
        _opt_row(
            instrument=instr, day="2026-01-17", change=0.0, position=0.0, id=2,
            type="delivery",
        ),
    ]
    charts = {instr: {"2026-01-15": 0.05, "2026-01-16": 0.0}}  # worthless on 16
    summaries = [
        {"currency": "BTC", "equity": -0.05, "session_upl": 0.0, "options_value": 0.0}
    ]
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=rows,
        summaries=summaries,
        charts=charts,
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    # cash −0.05 (15) + ΔMTM +0.05 (15), −0.05 (16, the premium collapse).
    assert got == pytest.approx({"2026-01-15": 0.0, "2026-01-16": -0.05}, abs=1e-9)
    assert sum(got.values()) == pytest.approx(-0.05, abs=1e-9)


# --- WR-01: H1 terminal wedge under smoothed — §5 inception closure -----------


def test_smoothed_terminal_wedge_and_inception_closure_open_book(
    monkeypatch: Any,
) -> None:
    """WR-01: under smoothed the ΔMTM merge ALREADY carries the settled open book
    into native_pnl (terminal_book == options_value − options_session_upl, book-
    channel-guarded), so the H1 terminal wedge must be the combined session uPnL
    ONLY — adding ``options_value`` (the CASH arm's wedge) counts the settled
    book TWICE and §5 permanently fails a healthy open-book account by
    ≈ options_value.

    Hand-derived Deribit economics (NOT the code's own formula), with BOTH
    session legs nonzero so the combined-wedge decomposition is load-bearing:
      settled book = 2.0 × mark(0.08) = 0.16
      options_session_upl = 0.02 (current-session move) → options_value = 0.18
      futures/base session_upl = 0.01;  cash = Σchange = −0.10
      equity = cash + futures_session_upl + options_value = 0.09  (M5 anchor
      identity: equity − combined_upl == cash + options_value − options_session_upl)
      Σ native_pnl (smoothed) = cash + settled book = 0.06
      required wedge = equity − Σnative_pnl = 0.03 = combined session uPnL —
      exactly ``native_upnl``; the old arm's 0.03 + 0.18 = 0.21 strands a −0.12
      §5 residual."""
    summaries = [
        {"currency": "BTC", "equity": 0.09, "session_upl": 0.01,
         "options_value": 0.18, "options_session_upl": 0.02},
    ]
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=_HELD_ROWS,
        summaries=summaries,
        charts=_HELD_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    # The wedge is the COMBINED session uPnL only — never + options_value.
    assert ledger.terminal_upnl_native["BTC"] == pytest.approx(0.03, abs=1e-12)
    # §5-through: the inception reconciliation closes on the open book (the old
    # wedge raised InceptionReconciliationError with residual ≈ options_value).
    returns, _meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    assert len(returns) > 0


# --- Cash channel (strict, ALL currencies) -----------------------------------


def test_smoothed_cash_channel_dropped_option_row_fails_loud() -> None:
    """The strict cash channel runs over ALL currencies under smoothed (no
    open-option exemption). Dropping one option trade contribution from native_daily
    (while the row stays in the reference Σchange) breaches it — mutation-honesty
    that the cash channel actually reconciles the option cash legs."""
    rows = [
        _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
        _opt_row(
            instrument=_IN_RET_INSTR, day="2026-01-17", change=0.03, position=0.0, id=2,
            type="delivery",
        ),
    ]
    native_daily = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    # Green as-is (cash channel closes Σ==Σchange).
    assert_balance_identity(rows, native_daily, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    # Drop the +0.03 delivery contribution from native_daily → Σ mismatch → raise.
    dropped = {"BTC": {"2026-01-15": -0.05}}
    with pytest.raises(LedgerValuationError):
        assert_balance_identity(rows, dropped, pnl_basis=PNL_BASIS_SMOOTHED_MTM)


# --- Summary cross-check (Q3-3) ----------------------------------------------


def _summary_row(*, day: str, hour: int, rpl: float, upl: float) -> dict[str, Any]:
    return {
        "type": "options_settlement_summary",
        "instrument_name": _IN_RET_INSTR,
        "currency": "BTC",
        "change": 0.0,
        "realized_pl": rpl,
        "unrealized_pl": upl,
        "timestamp": int(
            pd.Timestamp(f"{day}T{hour:02d}:00:00", tz="UTC").timestamp() * 1000
        ),
        "id": 900,
    }


def _cross_check_rows() -> list[dict[str, Any]]:
    # Summary on 01-16 08:00 → coverage window [01-15 08:00, 01-16 08:00]. The
    # option trade on 01-15 10:00 is IN window: change+commission = −0.05+0.01 = −0.04.
    #
    # WR-02 — the summary oracle is HAND-DERIVED from Deribit economics, never
    # from the code's own slice formula: bought 1.0 intra-session at trade price
    # 0.04 (cash change −0.05 = premium 0.04 + fee 0.01; E3: Σ(rpl+upl) is GROSS
    # of fees since it closes against Σ(change+commission)); the session settles
    # at the 01-16 08:00 boundary, whose settled mark is the close of the bar
    # STAMPED 01-15 (M4) = 0.05. Nothing was closed → rpl = 0; upl = settlement
    # mark − trade price = 0.05 − 0.04 = 0.01.
    return [
        _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
        _summary_row(day="2026-01-16", hour=8, rpl=0.0, upl=0.01),
    ]


# Marks (bar-stamp-day keyed, M4): 01-15 → 0.05, 01-16 → 0.15; position 1.0 from
# 01-15 → ΔMTM {01-15: +0.05, 01-16: +0.10}; terminal book 0.15.
# ΔBook over the window = Book(end boundary 01-16 08:00) − Book(start boundary
# 01-15 08:00) = Book[01-15] − Book[01-14] → the day slice [01-15, 01-16) → 0.05
# (the bar stamped D completes at D+1 08:00, so Book at a boundary "X 08:00" is
# the day-keyed Book[X−1]).
# Identity: Σ(rpl+upl)=0.01 == (option change+commission)=−0.04 + ΔBook=0.05.
_CC_DELTA = {"BTC": {"2026-01-15": 0.05, "2026-01-16": 0.10}}
_CC_TERMINAL = {"BTC": 0.15}
_CC_OPT_VALUE = {"BTC": 0.15}
_CC_OPT_SESS = {"BTC": 0.0}


def test_smoothed_summary_cross_check_reconciles() -> None:
    """Q3-3: Σ(rpl+upl) over the coverage window == Σ(option change+commission)
    inside + ΔBook. Consistent summary + reconstruction → no raise. WR-02: the
    first trade lands AFTER 08:00 on the window-start day, so its opening book
    entry ΔMTM[start_day] MUST be inside the ΔBook slice exactly as its cash is
    inside the ms window — the old (start_day, end_day] slice dropped it and
    breached this economics-derived fixture by the position's full book value."""
    rows = _cross_check_rows()
    native_daily = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    assert_balance_identity(
        rows,
        native_daily,
        pnl_basis=PNL_BASIS_SMOOTHED_MTM,
        terminal_book=_CC_TERMINAL,
        native_options_value=_CC_OPT_VALUE,
        native_options_session_upl=_CC_OPT_SESS,
        option_delta_mtm=_CC_DELTA,
    )


def test_smoothed_summary_cross_check_trailing_trade_after_window() -> None:
    """WR-02 boundary class 2: a trade on the window-END day AFTER the last
    summary's 08:00 stamp is OUTSIDE the ms cash window — its book entry
    ΔMTM[end_day] must be OUTSIDE the ΔBook slice too. The old slice summed it
    and breached by ≈ the position's book value on any crawl-day trade."""
    rows = _cross_check_rows() + [
        {
            "type": "trade",
            "instrument_name": _IN_RET_INSTR,
            "currency": "BTC",
            "change": -0.07,
            "commission": 0.01,
            "position": 2.0,  # bought 1.0 more at 01-16 10:00 (post-summary)
            "timestamp": int(
                pd.Timestamp("2026-01-16T10:00:00", tz="UTC").timestamp() * 1000
            ),
            "id": 2,
        }
    ]
    # EOD positions: 01-15 → 1.0, 01-16 → 2.0; marks 0.05 / 0.15 →
    # Book 0.05 → 0.30, ΔMTM {01-15: +0.05, 01-16: +0.25}, terminal 0.30.
    delta = {"BTC": {"2026-01-15": 0.05, "2026-01-16": 0.25}}
    native_daily = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    assert_balance_identity(
        rows,
        native_daily,
        pnl_basis=PNL_BASIS_SMOOTHED_MTM,
        terminal_book={"BTC": 0.30},
        native_options_value={"BTC": 0.30},
        native_options_session_upl={"BTC": 0.0},
        option_delta_mtm=delta,
    )


def test_smoothed_summary_cross_check_flat_flat_closes_like_e3() -> None:
    """Phase-82 E3 pin (<$1 flat-flat closure): a position opened AND closed
    strictly inside the window (both boundaries flat) closes
    Σ(rpl+upl) == Σ(change+commission) with ΔBook == 0 — the settled evidence
    the boundary slice must never contradict. Hand-derived: buy 1.0 @0.04
    (change −0.05, fee 0.01), sell @0.06 (change +0.05, fee 0.01) → session
    rpl = 0.06 − 0.04 = 0.02 = (−0.04) + (+0.06)."""
    rows = [
        _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
        {
            "type": "trade",
            "instrument_name": _IN_RET_INSTR,
            "currency": "BTC",
            "change": 0.05,
            "commission": 0.01,
            "position": 0.0,  # sold back at 01-15 14:00 → flat EOD
            "timestamp": int(
                pd.Timestamp("2026-01-15T14:00:00", tz="UTC").timestamp() * 1000
            ),
            "id": 2,
        },
        _summary_row(day="2026-01-16", hour=8, rpl=0.02, upl=0.0),
    ]
    native_daily = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    assert_balance_identity(
        rows,
        native_daily,
        pnl_basis=PNL_BASIS_SMOOTHED_MTM,
        terminal_book={"BTC": 0.0},
        native_options_value={"BTC": 0.0},
        native_options_session_upl={"BTC": 0.0},
        option_delta_mtm={},
    )


def test_smoothed_summary_cross_check_breach_fails_loud() -> None:
    """The summaries keep POLICING: a summary whose rpl+upl diverges materially
    from the cash+ΔBook reconstruction (0.06 → 0.50) raises."""
    rows = [
        _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
        _summary_row(day="2026-01-16", hour=8, rpl=0.50, upl=0.0),  # perturbed
    ]
    native_daily = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    with pytest.raises(LedgerValuationError) as exc:
        assert_balance_identity(
            rows,
            native_daily,
            pnl_basis=PNL_BASIS_SMOOTHED_MTM,
            terminal_book=_CC_TERMINAL,
            native_options_value=_CC_OPT_VALUE,
            native_options_session_upl=_CC_OPT_SESS,
            option_delta_mtm=_CC_DELTA,
        )
    assert "BTC" in str(exc.value) and "cross-check" in str(exc.value)


def test_non_smoothed_bases_ignore_smoothed_channels() -> None:
    """SC-4: passing terminal_book / anchors under cash_settlement or
    mark_to_market is a NO-OP — the smoothed channels are pnl_basis-gated, so a
    wildly-wrong terminal_book never fires on the existing bases."""
    rows = [
        _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
    ]
    native_daily = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_CASH_SETTLEMENT)
    # A grossly-wrong terminal_book that WOULD breach the book channel under
    # smoothed is silently ignored under cash_settlement.
    assert_balance_identity(
        rows,
        native_daily,
        pnl_basis=PNL_BASIS_CASH_SETTLEMENT,
        terminal_book={"BTC": 999.0},
        native_options_value={"BTC": 0.0},
        native_options_session_upl={"BTC": 0.0},
        option_delta_mtm={},
    )


# ===========================================================================
# Task 6 — SC-4 byte-identity pins + total-preservation acceptance (A–D). These
# are the phase's CLOSING pins (tests only): if one reddens, the defect is
# upstream in Tasks 3–5 and is fixed THERE, never here.
# ===========================================================================

# A multi-day option held to a FLAT delivery, with exact-binary marks/cash so the
# telescoping is FLOAT-EXACT. Book 0.5→0.75→0.25→0 ⇒ ΔMTM +0.5,+0.25,−0.5,−0.25
# (Σ = 0 = terminal). Cash: −0.25 premium (01-15), +0.125 payout (01-18).
_A_INSTR = "BTC-18JAN26-100000-C"
_A_ROWS = [
    _opt_row(instrument=_A_INSTR, day="2026-01-15", change=-0.25, position=1.0, id=1),
    _opt_row(
        instrument=_A_INSTR, day="2026-01-18", change=0.125, position=0.0, id=2,
        type="delivery",
    ),
]
_A_CHARTS = {_A_INSTR: {"2026-01-15": 0.5, "2026-01-16": 0.75, "2026-01-17": 0.25}}
_A_SUMMARIES = [
    {"currency": "BTC", "equity": -0.125, "session_upl": 0.0, "options_value": 0.0}
]


def test_acceptance_A_redistribution_preserves_total(monkeypatch: Any) -> None:
    """Acceptance A: a multi-day option with a FLAT terminal book → the smoothed_mtm
    per-ccy total EXACTLY equals the cash_settlement total (redistribution preserves
    the sum). Float-exact fixture (exact-binary marks/cash)."""
    led_s, _rs, _ss = _run_options_ledger(
        monkeypatch, btc_rows=_A_ROWS, summaries=_A_SUMMARIES, charts=_A_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    led_c, _rc, _sc = _run_options_ledger(
        monkeypatch, btc_rows=_A_ROWS, summaries=_A_SUMMARIES, charts=_A_CHARTS,
        pnl_basis="cash_settlement",
    )
    total_s = float(led_s.native_pnl["BTC"].sum())
    total_c = float(led_c.native_pnl["BTC"].sum())
    assert total_s == total_c == -0.125  # exact
    assert struct.pack("<d", total_s) == struct.pack("<d", total_c)


def test_acceptance_B_no_session_lumps(monkeypatch: Any) -> None:
    """Acceptance B: the smoothed series SPREADS the option P&L across the held days
    (each day ≈ its hand-computed mark delta) — NO day carries the whole session
    swing. Contrast: cash_settlement lumps the premium on the single trade day."""
    led_s, _r, _s = _run_options_ledger(
        monkeypatch, btc_rows=_A_ROWS, summaries=_A_SUMMARIES, charts=_A_CHARTS,
        pnl_basis="smoothed_mtm",
    )
    smoothed = _series_to_daymap(led_s.native_pnl["BTC"])
    # cash(−0.25 on 15, +0.125 on 18) + ΔMTM(+0.5,+0.25,−0.5,−0.25) →
    expected = {
        "2026-01-15": 0.25, "2026-01-16": 0.25, "2026-01-17": -0.5, "2026-01-18": -0.125,
    }
    assert smoothed == pytest.approx(expected, abs=1e-12)
    # Spread across ≥3 held days — no single session-lump day.
    assert sum(1 for v in smoothed.values() if abs(v) > 1e-12) >= 3
    # cash_settlement, by contrast, touches only the trade + delivery days.
    led_c, _rc, _sc = _run_options_ledger(
        monkeypatch, btc_rows=_A_ROWS, summaries=_A_SUMMARIES, charts=_A_CHARTS,
        pnl_basis="cash_settlement",
    )
    cash = _series_to_daymap(led_c.native_pnl["BTC"])
    assert set(cash) == {"2026-01-15", "2026-01-18"}


def test_acceptance_C_non_flat_terminal_telescopes(monkeypatch: Any) -> None:
    """Acceptance C: open-position-at-anchor → smoothed total == Σchange + Book(last
    settlement), with the book-channel guard green on the settled-book anchor
    decomposition (options_value − options_session_upl == terminal_book)."""
    led_s, _r, _s = _run_options_ledger(
        monkeypatch, btc_rows=_OPEN_ROWS, summaries=_OPEN_SUMMARIES,
        charts=_OPEN_CHARTS, pnl_basis="smoothed_mtm",
    )
    total = float(led_s.native_pnl["BTC"].sum())
    sigma_change = -0.10  # the sole option premium cash leg
    terminal_book = 0.12  # 2.0 × 0.06
    assert total == pytest.approx(sigma_change + terminal_book, abs=1e-12)


_D_INSTR = "BTC-18JAN26-90000-C"
_D_ROWS = [
    _opt_row(instrument=_D_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
    _opt_row(
        instrument=_D_INSTR, day="2026-01-18", change=0.0, position=0.0, id=2,
        type="delivery",
    ),
]


def test_acceptance_D_sparse_mark_hole_fails_loud_naming_instrument_day(
    monkeypatch: Any,
) -> None:
    """Acceptance D: a HOLE inside a listed instrument's life (in-retention, position
    carried 1.0 on 01-16 but no bar) fails loud AT LEDGER BUILD naming instrument +
    the earliest missing day — no interpolation, no session-lump fallback."""
    summaries = [
        {"currency": "BTC", "equity": -0.05, "session_upl": 0.0, "options_value": 0.0}
    ]
    with pytest.raises(LedgerValuationError) as exc:
        _run_options_ledger(
            monkeypatch,
            btc_rows=_D_ROWS,
            summaries=summaries,
            # 01-16 missing while position is 1.0 → structural hole.
            charts={_D_INSTR: {"2026-01-15": 0.05, "2026-01-17": 0.04}},
            pnl_basis="smoothed_mtm",
        )
    msg = str(exc.value)
    assert _D_INSTR in msg and "2026-01-16" in msg
