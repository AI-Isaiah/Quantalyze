"""NAVMTM plan 13 (D-14): the Deribit NAV twin, built from the SAME crawl with no venue call.

An allocated-capital Deribit account (``exclude_spot_extraction=True``) drops BOTH legs of
every net-extraction spot pair from ``native_pnl`` (Bug B), so its own ledger cannot give
the realized NAV level D-14 needs: the section-5 inception gate would fail and the roll
would drift by every extraction inside a span. ``build_deribit_native_ledger(...,
nav_twin=True)`` re-aggregates the crawl's OWN raw rows with the extraction legs KEPT and
returns that as ``report.nav_twin_ledger``, reusing every other allocated artifact verbatim.

The oracles here are the fake ledger rows and this module's own arithmetic. The fixture:
a 2.0 BTC deposit, a -0.01 BTC perp fee, then one net-extraction ``BTC_USDC`` sell of
1.0 BTC for 60,000 USDC on 2026-03-06. Terminal equity BTC 0.99 / USDC 60,000, so the
twin closes section 5 (BTC: 0.99 = -0.01 - 1.0 + 2.0; USDC: 60,000 = +60,000) and the
allocated ledger, which lacks the legs, does not.
"""
from __future__ import annotations

import datetime as dt
import math
from datetime import date
from typing import Any

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.allocated_capital import CapitalScheduleEntry, ReturnsDenominatorConfig
from services.broker_dailies import combine_native_ledger
from services.deribit_txn import LedgerValuationError
from tests.test_deribit_ingest import _NativeAnchorStub, _patch_pipeline

_EXTRACTION_DAY = pd.Timestamp("2026-03-06")
_FEE_DAY = pd.Timestamp("2026-03-05")


def _ms(day: int, hour: int = 12) -> int:
    return int(dt.datetime(2026, 3, day, hour, tzinfo=dt.timezone.utc).timestamp() * 1000)


_INDEX = {f"2026-03-{d:02d}": 60000.0 for d in range(1, 11)}


def _crawl_rows() -> list[dict[str, Any]]:
    """deposit -> perp fee -> one net-extraction BTC_USDC sell (BTC out, USDC cash in)."""
    return [
        {"type": "deposit", "currency": "BTC", "change": 2.0, "timestamp": _ms(4, 6)},
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.01, "index_price": 60000.0, "timestamp": _ms(5, 8)},
        {"type": "trade", "instrument_name": "BTC_USDC", "currency": "BTC",
         "change": -1.0, "timestamp": _ms(6, 10)},
        {"type": "trade", "instrument_name": "BTC_USDC", "currency": "USDC",
         "change": 60000.0, "timestamp": _ms(6, 10)},
    ]


def _stub() -> _NativeAnchorStub:
    return _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 0.99, "session_upl": 0.0},
            {"currency": "USDC", "equity": 60000.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 60000.0},
    )


def _wire(monkeypatch: Any) -> dict[str, int]:
    """Patch the crawl primitives + the index feed; return a counter of crawl calls."""
    calls = {"crawl": 0}

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        return _crawl_rows() if currency == "BTC" else []

    _patch_pipeline(
        monkeypatch,
        scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]},
        paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return dict(_INDEX)

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    real_crawl = di._crawl_deribit_ledger

    async def _spy(*a: Any, **k: Any) -> Any:
        calls["crawl"] += 1
        return await real_crawl(*a, **k)

    monkeypatch.setattr(di, "_crawl_deribit_ledger", _spy)
    return calls


async def _build(**kwargs: Any) -> tuple[Any, di.CompletenessReport]:
    return await di.build_deribit_native_ledger(_stub(), **kwargs)


def _allocated_config() -> ReturnsDenominatorConfig:
    return ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2026, 3, 1), 1_000_000.0),),
        metrics_basis="active_day",
    )


async def test_twin_keeps_the_extraction_legs_the_allocated_ledger_drops(
    monkeypatch: Any,
) -> None:
    """Bug B: the allocated ledger lacks both legs; the twin has them, and equals the
    native_pnl of a plain ``exclude_spot_extraction=False`` build of the same rows."""
    _wire(monkeypatch)
    ledger, report = await _build(exclude_spot_extraction=True, nav_twin=True)
    twin = report.nav_twin_ledger
    assert twin is not None

    # allocated: only the perp fee survives; BTC day 03-06 and the USDC leg are gone.
    assert list(ledger.native_pnl) == ["BTC"]
    assert _EXTRACTION_DAY not in ledger.native_pnl["BTC"].index
    # twin: both legs of the pair are there, with the fixture's own arithmetic.
    assert twin.native_pnl["BTC"].loc[_EXTRACTION_DAY] == pytest.approx(-1.0, abs=1e-12)
    assert twin.native_pnl["BTC"].loc[_FEE_DAY] == pytest.approx(-0.01, abs=1e-12)
    assert twin.native_pnl["USDC"].loc[_EXTRACTION_DAY] == pytest.approx(60000.0, abs=1e-9)

    nav_ledger, _ = await _build(exclude_spot_extraction=False)
    assert set(twin.native_pnl) == set(nav_ledger.native_pnl)
    for ccy, series in nav_ledger.native_pnl.items():
        pd.testing.assert_series_equal(twin.native_pnl[ccy], series)


async def test_twin_closes_section_5_where_the_allocated_ledger_cannot(
    monkeypatch: Any,
) -> None:
    """The reason the twin exists: through the NAV core the twin reconstructs (section 5
    closes against the venue's terminal equity); the allocated ledger does not."""
    _wire(monkeypatch)
    ledger, report = await _build(exclude_spot_extraction=True, nav_twin=True)
    assert report.nav_twin_ledger is not None

    _returns, meta = combine_native_ledger(report.nav_twin_ledger, report.indexable_currencies)
    assert meta["computation_status_hint"] in ("complete", "complete_with_warnings")

    with pytest.raises(Exception) as excinfo:
        combine_native_ledger(ledger, report.indexable_currencies)
    assert type(excinfo.value).__name__ == "InceptionReconciliationError"


async def test_allocated_ledger_is_unchanged_by_the_twin(monkeypatch: Any) -> None:
    """T-45: native_pnl, marks, flows and the terminal fields of the allocated ledger, and
    the allocated returns built from it, are equal with ``nav_twin`` True and False."""
    _wire(monkeypatch)
    plain, plain_report = await _build(exclude_spot_extraction=True)
    with_twin, twin_report = await _build(exclude_spot_extraction=True, nav_twin=True)

    assert plain_report.nav_twin_ledger is None
    assert twin_report.nav_twin_ledger is not None
    assert set(with_twin.native_pnl) == set(plain.native_pnl)
    for ccy, series in plain.native_pnl.items():
        pd.testing.assert_series_equal(with_twin.native_pnl[ccy], series)
    assert set(with_twin.marks) == set(plain.marks)
    for ccy, series in plain.marks.items():
        pd.testing.assert_series_equal(with_twin.marks[ccy], series)
    assert with_twin.native_flows == plain.native_flows
    assert with_twin.terminal_native_equity == plain.terminal_native_equity
    assert with_twin.terminal_upnl_native == plain.terminal_upnl_native
    assert with_twin.full_history == plain.full_history

    cfg = _allocated_config()
    plain_returns, plain_meta = combine_native_ledger(
        plain, plain_report.indexable_currencies, denominator_config=cfg
    )
    twin_returns, twin_meta = combine_native_ledger(
        with_twin, twin_report.indexable_currencies, denominator_config=cfg
    )
    pd.testing.assert_series_equal(twin_returns, plain_returns)
    assert set(twin_meta) == set(plain_meta)
    for key, value in plain_meta.items():
        other = twin_meta[key]
        if isinstance(value, float) and math.isnan(value):
            # a one-active-day fixture leaves the dispersion metrics NaN on both sides
            assert isinstance(other, float) and math.isnan(other), key
        else:
            assert other == value, key


async def test_twin_makes_no_extra_crawl(monkeypatch: Any) -> None:
    calls = _wire(monkeypatch)
    await _build(exclude_spot_extraction=True, nav_twin=True)
    assert calls["crawl"] == 1


async def test_twin_reuses_the_allocated_marks(monkeypatch: Any) -> None:
    """The marks are the allocated ledger's own object, never rebuilt (T-45)."""
    _wire(monkeypatch)
    ledger, report = await _build(exclude_spot_extraction=True, nav_twin=True)
    assert report.nav_twin_ledger is not None
    assert report.nav_twin_ledger.marks is ledger.marks


async def test_nav_twin_requires_the_allocated_mode(monkeypatch: Any) -> None:
    """The NAV path is already its own twin: asking for one beside it is a caller bug."""
    calls = _wire(monkeypatch)
    with pytest.raises(ValueError):
        await _build(exclude_spot_extraction=False, nav_twin=True)
    assert calls["crawl"] == 0


# --- W1: a twin that cannot be built never fails the build -------------------------------


def _fail_on(monkeypatch: Any, name: str, *, when_extraction: bool) -> None:
    """Make ``di.<name>`` raise ``LedgerValuationError`` for exactly one of the two modes
    (``exclude_spot_extraction`` True = the allocated call, False = the NAV-mode twin call),
    delegating to the real function otherwise."""
    real = getattr(di, name)

    def _wrapper(*args: Any, **kwargs: Any) -> Any:
        if bool(kwargs.get("exclude_spot_extraction", False)) is when_extraction:
            raise LedgerValuationError("fixture: injected failure")
        return real(*args, **kwargs)

    monkeypatch.setattr(di, name, _wrapper)


async def _assert_isolated(monkeypatch: Any, name: str) -> None:
    """Build the allocated ledger WITHOUT a twin first (the oracle), then inject the NAV-mode
    failure in ``di.<name>`` and build WITH one: same allocated ledger, no twin, error named."""
    _wire(monkeypatch)
    plain, _ = await _build(exclude_spot_extraction=True)
    _fail_on(monkeypatch, name, when_extraction=False)
    ledger, report = await _build(exclude_spot_extraction=True, nav_twin=True)
    assert report.nav_twin_ledger is None
    assert report.nav_twin_error == "LedgerValuationError"
    assert set(ledger.native_pnl) == set(plain.native_pnl)
    for ccy, series in plain.native_pnl.items():
        pd.testing.assert_series_equal(ledger.native_pnl[ccy], series)
    for ccy, series in plain.marks.items():
        pd.testing.assert_series_equal(ledger.marks[ccy], series)


async def test_twin_identity_failure_is_isolated(monkeypatch: Any, caplog: Any) -> None:
    """W1 / T-54: the NAV-mode identity raises; the build still returns the allocated ledger
    and report exactly as without a twin, and the report names why."""
    with caplog.at_level("WARNING", logger="services.deribit_ingest"):
        await _assert_isolated(monkeypatch, "assert_balance_identity")
    assert "nav twin unbuildable (error=LedgerValuationError)" in caplog.text


async def test_twin_aggregation_failure_is_isolated(monkeypatch: Any) -> None:
    """W1: the NAV-mode aggregation raises: same outcome."""
    await _assert_isolated(monkeypatch, "txn_rows_to_native_daily")


@pytest.mark.parametrize("name", ["assert_balance_identity", "txn_rows_to_native_daily"])
async def test_allocated_failure_still_raises(monkeypatch: Any, name: str) -> None:
    """Isolation covers ONLY the twin: a failure of the ALLOCATED aggregation or identity
    propagates exactly as today, with or without a twin requested."""
    _wire(monkeypatch)
    _fail_on(monkeypatch, name, when_extraction=True)
    with pytest.raises(LedgerValuationError):
        await _build(exclude_spot_extraction=True, nav_twin=True)
    with pytest.raises(LedgerValuationError):
        await _build(exclude_spot_extraction=True)
