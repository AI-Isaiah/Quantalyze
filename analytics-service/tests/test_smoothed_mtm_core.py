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
from typing import Any

import pandas as pd
import pytest

from services import deribit_ingest as di
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

    async def private_get_get_account_summaries(self, params: Any) -> Any:
        return {"result": {"summaries": self._summaries}}

    async def public_get_get_index_price(self, params: Any) -> Any:
        return {"result": {"index_price": self._index_price}}

    async def public_get_get_tradingview_chart_data(self, params: Any) -> Any:
        self.chart_calls.append(str(params.get("instrument_name")))
        marks = self._charts.get(str(params.get("instrument_name")), {})
        if not marks:
            return {"result": {"status": "no_data", "ticks": [], "close": []}}
        ticks = [
            int(pd.Timestamp(d, tz="UTC").timestamp() * 1000) for d in marks
        ]
        return {
            "result": {"status": "ok", "ticks": ticks, "close": list(marks.values())}
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
    # Summary on 01-16 08:00 → coverage window (01-15 08:00, 01-16 08:00). The
    # option trade on 01-15 10:00 is IN window: change+commission = −0.05+0.01 = −0.04.
    return [
        _opt_row(instrument=_IN_RET_INSTR, day="2026-01-15", change=-0.05, position=1.0, id=1),
        _summary_row(day="2026-01-16", hour=8, rpl=0.06, upl=0.0),
    ]


# ΔBook over the window = Σ ΔMTM on 01-15 < day <= 01-16 → only 01-16 (0.10).
# Identity: Σ(rpl+upl)=0.06 == (option change+commission)=−0.04 + ΔBook=0.10.
_CC_DELTA = {"BTC": {"2026-01-15": 0.05, "2026-01-16": 0.10}}
_CC_TERMINAL = {"BTC": 0.15}
_CC_OPT_VALUE = {"BTC": 0.15}
_CC_OPT_SESS = {"BTC": 0.0}


def test_smoothed_summary_cross_check_reconciles() -> None:
    """Q3-3: Σ(rpl+upl) over the coverage window == Σ(option change+commission)
    inside + ΔBook. Consistent summary + reconstruction → no raise."""
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
