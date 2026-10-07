"""Phase 164.6.6.2 (D-18, D-22, D-23): the Python twin of the BTC-native -> USD
return conversion, proven equal to the TypeScript function on ONE shared fixture.

WHY these tests exist: a BTC-denominated account blended with USD strategies must
enter the blend as USD returns, ``(1 + r) * (1 + btc) - 1``. Weighting the raw
BTC return (the defect this module removes) reads a 10% BTC move on a 10% BTC
account as 10% instead of 21%, and no other number on the page says so. The
cases live in ``fixtures/native_to_usd_oracle.json``, which
``src/lib/factsheet/native-to-usd.test.ts`` reads too; every ``expected`` value in
it is a HAND-COMPUTED literal, so neither runtime can pass by agreeing with its
own arithmetic. This file READS the fixture; it never copies a value out of it.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from unittest.mock import patch

from services import benchmark as benchmark_mod
from services.benchmark import BTC_CLOSES_SOURCE, get_btc_closes
from services.native_to_usd import convert_native_returns_to_usd, parse_native_unit

_FIXTURE = Path(__file__).parent / "fixtures" / "native_to_usd_oracle.json"
_ORACLE: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_CASES: list[dict[str, Any]] = _ORACLE["cases"]
_TOL: float = _ORACLE["tolerance"]


def _series(raw: list[dict[str, Any]], name: str = "strategy") -> pd.Series:
    # JSON has no NaN: a null value in the fixture stands for a non-finite number.
    return pd.Series(
        [math.nan if p["value"] is None else p["value"] for p in raw],
        index=pd.DatetimeIndex([p["date"] for p in raw]),
        name=name,
        dtype=float,
    )


def _closes(raw: dict[str, float] | None) -> pd.Series | None:
    if raw is None:
        return None
    dates = sorted(raw)
    return pd.Series(
        [raw[d] for d in dates], index=pd.DatetimeIndex(dates), name="BTC", dtype=float
    )


def test_fixture_pins_the_one_price_window_both_runtimes_read() -> None:
    """The reader's window is part of the contract: stored closes only, no
    bundled prefix. A fixture that changed its ``closes_source`` without the
    reader following would let the two runtimes price different days."""
    assert _ORACLE["closes_source"] == BTC_CLOSES_SOURCE == "benchmark_prices only"
    names = [c["name"] for c in _CASES]
    assert "earliest_dates_before_first_stored_close_are_absent" in names


def test_fixture_is_a_real_oracle() -> None:
    assert _TOL <= 1e-12
    assert _CASES
    for c in _CASES:
        assert len(c["arithmetic"]) > 10, c["name"]
        # `dropped` dates are corrupt closes: they are never in `closes`.
        for d in c["dropped"]:
            assert c["closes"] is None or d not in c["closes"], c["name"]


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_every_fixture_case_matches_its_hand_computed_literal(case: dict[str, Any]) -> None:
    out = convert_native_returns_to_usd(
        _series(case["series"]), case["unit"], _closes(case["closes"])
    )
    assert [d.strftime("%Y-%m-%d") for d in out.index] == [e["date"] for e in case["expected"]]
    for got, e in zip(out.tolist(), case["expected"]):
        assert abs(got - e["value"]) <= _TOL, (case["name"], got, e["value"])


def test_the_oracle_is_021_not_the_raw_btc_010() -> None:
    """The headline case, asserted by literal so a variant that blends the raw
    BTC return cannot hide behind a fixture it also reads."""
    case = next(c for c in _CASES if c["name"] == "two_day_blend_is_021_not_raw_btc_010")
    out = convert_native_returns_to_usd(_series(case["series"]), "BTC", _closes(case["closes"]))
    assert len(out) == 1
    assert out.iloc[0] == pytest.approx(0.21, abs=1e-12)
    assert abs(out.iloc[0] - 0.10) > 0.1


# --- Python-only identity and honesty cases -------------------------------


def test_unit_none_returns_the_same_object() -> None:
    s = _series([{"date": "2026-02-02", "value": 0.01}, {"date": "2026-02-03", "value": -0.02}])
    assert convert_native_returns_to_usd(s, None, _closes({"2026-02-02": 1.0})) is s


def test_unit_without_closes_returns_empty_not_the_input() -> None:
    s = _series([{"date": "2026-02-02", "value": 0.01}, {"date": "2026-02-03", "value": -0.02}])
    out = convert_native_returns_to_usd(s, "BTC", None)
    assert isinstance(out, pd.Series)
    assert out.empty


def test_non_positive_and_non_finite_closes_count_as_missing() -> None:
    """A zero, negative or NaN close cannot price a return: the days around it
    are ABSENT, never 0 and never bridged."""
    s = _series(
        [
            {"date": "2026-02-02", "value": 0.0},
            {"date": "2026-02-03", "value": 0.5},
            {"date": "2026-02-04", "value": 0.5},
            {"date": "2026-02-05", "value": 0.5},
        ]
    )
    for bad in (0.0, -5.0, math.nan, math.inf):
        closes = _closes({"2026-02-02": 100.0, "2026-02-03": bad, "2026-02-04": 121.0, "2026-02-05": 133.1})
        out = convert_native_returns_to_usd(s, "BTC", closes)
        assert out.empty or [d.strftime("%Y-%m-%d") for d in out.index] == ["2026-02-05"], bad
        assert all(math.isfinite(v) for v in out.tolist()), bad


def test_no_zero_is_fabricated_for_an_unpriced_day() -> None:
    s = _series(
        [
            {"date": "2026-02-02", "value": 0.0},
            {"date": "2026-02-03", "value": 0.5},
            {"date": "2026-02-04", "value": 0.2},
        ]
    )
    out = convert_native_returns_to_usd(s, "BTC", _closes({"2026-02-02": 100.0, "2026-02-03": 110.0}))
    assert [d.strftime("%Y-%m-%d") for d in out.index] == ["2026-02-03"]


def test_closes_that_are_not_midnight_normalized_still_pair() -> None:
    """A closes index carrying a time-of-day must not make every day unpriced."""
    s = _series([{"date": "2026-02-02", "value": 0.05}, {"date": "2026-02-03", "value": 0.1}])
    closes = pd.Series(
        [60000.0, 66000.0],
        index=pd.DatetimeIndex(["2026-02-02 00:00:00", "2026-02-03 00:00:00"]),
    )
    out = convert_native_returns_to_usd(s, "BTC", closes)
    assert out.iloc[0] == pytest.approx(0.21, abs=1e-12)


@pytest.mark.parametrize("raw", ["BTC", "ETH", "USDT", "AB", "ABCDEFGHIJ"])
def test_parse_native_unit_accepts_well_formed_codes(raw: str) -> None:
    assert parse_native_unit(raw) == raw


@pytest.mark.parametrize(
    "raw",
    ["btc", "B", "ABCDEFGHIJK", "BTC\n", "BT C", "BTC1", "", None, 7, ["BTC"], {"unit": "BTC"}],
)
def test_parse_native_unit_rejects_anything_else(raw: object) -> None:
    """The unit is jsonb data: a malformed value reads as absent (a USD row)."""
    assert parse_native_unit(raw) is None


# --- get_btc_closes: the DB-only price source ------------------------------


class _FakeBenchmarkClient:
    """A `benchmark_prices` table honouring the keyset read `get_btc_closes`
    issues: symbol filter, `date < cursor`, newest first, page limit."""

    def __init__(self, table_rows: list[dict[str, Any]]) -> None:
        self._rows = table_rows
        self.reads = 0

    def table(self, name: str) -> "_FakeBenchmarkClient":
        assert name == "benchmark_prices"
        self._symbol: str | None = None
        self._lt: str | None = None
        self._limit = 10**9
        return self

    def select(self, _cols: str) -> "_FakeBenchmarkClient":
        return self

    def eq(self, col: str, val: str) -> "_FakeBenchmarkClient":
        assert col == "symbol"
        self._symbol = val
        return self

    def lt(self, col: str, val: str) -> "_FakeBenchmarkClient":
        assert col == "date"
        self._lt = val
        return self

    def order(self, col: str, desc: bool = False) -> "_FakeBenchmarkClient":
        assert col == "date" and desc
        return self

    def limit(self, n: int) -> "_FakeBenchmarkClient":
        self._limit = n
        return self

    def execute(self) -> Any:
        self.reads += 1
        out = [
            r
            for r in self._rows
            if r["symbol"] == self._symbol and (self._lt is None or r["date"] < self._lt)
        ]
        out.sort(key=lambda r: r["date"], reverse=True)
        return type("R", (), {"data": out[: self._limit]})()


def _btc_row(day: str, close: Any, symbol: str = "BTC") -> dict[str, Any]:
    return {"symbol": symbol, "date": day, "close_price": close}


@pytest.mark.asyncio
async def test_get_btc_closes_reads_only_stored_btc_rows_and_adds_no_date() -> None:
    table = [
        _btc_row("2026-02-03", 66000),
        _btc_row("2026-02-02", 60000),
        _btc_row("2026-02-02", 1.0, symbol="ETH"),
    ]
    with patch.object(benchmark_mod, "_benchmark_client", return_value=_FakeBenchmarkClient(table)):
        closes = await get_btc_closes()
    assert closes is not None
    assert [d.strftime("%Y-%m-%d") for d in closes.index] == ["2026-02-02", "2026-02-03"]
    assert closes.tolist() == [60000.0, 66000.0]


@pytest.mark.asyncio
async def test_get_btc_closes_drops_unusable_closes_and_never_bridges_them() -> None:
    """A non-positive, non-finite or non-numeric stored close is a MISSING date
    (the conversion then leaves the days around it absent), not a filled one."""
    table = [
        _btc_row("2026-02-02", 100),
        _btc_row("2026-02-03", 0),
        _btc_row("2026-02-04", -3),
        _btc_row("2026-02-05", "NaN"),
        _btc_row("2026-02-06", None),
        _btc_row("2026-02-07", "abc"),
        _btc_row("2026-02-08", 121),
    ]
    with patch.object(benchmark_mod, "_benchmark_client", return_value=_FakeBenchmarkClient(table)):
        closes = await get_btc_closes()
    assert closes is not None
    assert [d.strftime("%Y-%m-%d") for d in closes.index] == ["2026-02-02", "2026-02-08"]


@pytest.mark.asyncio
async def test_get_btc_closes_pages_through_the_whole_table() -> None:
    table = [_btc_row(f"2026-03-{d:02d}", 100 + d) for d in range(1, 11)]
    client = _FakeBenchmarkClient(table)
    with patch.object(benchmark_mod, "_benchmark_client", return_value=client), patch.object(
        benchmark_mod, "_BTC_CLOSES_PAGE_SIZE", 3
    ):
        closes = await get_btc_closes()
    assert closes is not None
    assert len(closes) == 10  # a page-size cut would have dropped the oldest rows
    assert client.reads == 5  # 3 + 3 + 3 + 1, then the empty page
    assert closes.index.is_monotonic_increasing


@pytest.mark.asyncio
async def test_get_btc_closes_is_none_when_there_is_no_price_source() -> None:
    """Empty table, only-unusable closes and an unconfigured client are all "no
    price source": None, never an empty-but-priced series and never a fixture."""
    with patch.object(benchmark_mod, "_benchmark_client", return_value=_FakeBenchmarkClient([])):
        assert await get_btc_closes() is None
    only_bad = [_btc_row("2026-02-02", 0)]
    with patch.object(benchmark_mod, "_benchmark_client", return_value=_FakeBenchmarkClient(only_bad)):
        assert await get_btc_closes() is None
    with patch.object(benchmark_mod, "_benchmark_client", return_value=None):
        assert await get_btc_closes() is None


@pytest.mark.asyncio
async def test_get_btc_closes_read_failure_is_none_and_loud(caplog: pytest.LogCaptureFixture) -> None:
    class _Boom(_FakeBenchmarkClient):
        def execute(self) -> Any:
            raise OSError("db down")

    with patch.object(benchmark_mod, "_benchmark_client", return_value=_Boom([])):
        with caplog.at_level("WARNING"):
            assert await get_btc_closes() is None
    assert any("BTC closes read failed" in r.message for r in caplog.records)
