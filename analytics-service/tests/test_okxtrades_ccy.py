"""Phase 232 OKXTRADES VREAD-06: an OKX bill in a currency that is not a stable coin is never summed.

``fetch_daily_pnl``'s OKX aggregation used to add ``pnl + fee`` per day without reading ``ccy``, so a
BTC bill would have been added to USDT P&L at face value. A bill whose ``ccy`` is stable under
``services.price_rule.is_stable_value`` counts at 1.0 (the codebase's stated rate); a bill with a
nonzero finite ``pnl + fee`` in any other currency (a blank or missing ``ccy`` included) refuses the
WHOLE read by the closed token ``daily_pnl_non_usd_okx``: the read returns ``[]``, the flag is the
boolean True (never venue text) and every reader of the drained flags names it.

Every test drives the REAL ``fetch_daily_pnl`` against ``tests/_okx_bills.py::OkxBillsArchive``,
with the clock pinned as in ``tests/test_okxtrades_walk.py``. ``ccy`` is set explicitly per bill.

PROOF-01. NEUTER (each recorded in the SUMMARY, restored from a byte backup with ``cp`` and
checked with ``cmp``):

- N1 delete the census branch in ``fetch_daily_pnl``: the tracer goes RED on the face-value sum.
- N2 move the currency check above the type-8 funding drop:
  ``test_a_btc_funding_bill_is_dropped_before_the_currency_check``.
- N3 drop the nonzero-amount conjunct: ``test_a_zero_amount_bill_in_another_currency_is_counted_not_refused``.
- N4 remove the token from ``daily_pnl_read_verdict``: the parity matrix in
  ``tests/test_daily_pnl_read_verdict.py``.
- N5 record the census dict as the flag value: ``test_the_flag_carries_no_venue_text``.
- N6 remove the token from ``routers/cron.py::_fetch_degradation``: the cron FLAGS arm and the parity matrix.
- N7 remove the token from ``READ_INCOMPLETE_TOKENS``: the token-set arm and the derive refusal arm.
- N8 add the token to ``_TRANSIENT_REFUSAL_TOKENS``: the permanent-on-first-attempt arm.
"""
from __future__ import annotations

from typing import Any

import pytest

import services.exchange as ex
from services.exchange import fetch_daily_pnl
from tests._okx_bills import OkxBillsArchive, okx_bill

# 2026-11-20T12:00:00Z, the pinned clock (the same instant as tests/test_okxtrades_walk.py).
NOW_MS = 1795176000000
DAY_MS = 86_400_000
# 2026-11-19T12:00:00Z and 2026-11-18T12:00:00Z: inside the live (seven day) reach.
D1_MS = NOW_MS - DAY_MS
D2_MS = NOW_MS - 2 * DAY_MS
D3_MS = NOW_MS - 3 * DAY_MS
D4_MS = NOW_MS - 4 * DAY_MS
SINCE_MS = NOW_MS - 5 * DAY_MS
FLAG = "daily_pnl_non_usd_okx"


class _Exchange:
    """The slice of ccxt.okx the OKX branch of fetch_daily_pnl touches."""

    id = "okx"
    rateLimit = 0

    def __init__(self, rows: list[dict[str, str]]) -> None:
        self.private_get_account_bills = OkxBillsArchive(rows)
        self.private_get_account_bills_archive = OkxBillsArchive(rows)


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)


async def _read(rows: list[dict[str, str]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    ex.get_and_clear_last_dq_flags()
    out = await fetch_daily_pnl(_Exchange(rows), SINCE_MS)  # type: ignore[arg-type]
    return out, ex.get_and_clear_last_dq_flags()


def _bill(bill_id: int, ts: int, ccy: str | None, pnl: str, fee: str, *, bill_type: str = "2") -> dict[str, str]:
    bill = okx_bill(
        bill_id, ts, ccy or "USDT", "10000", pnl, bill_type=bill_type, inst_type="SWAP", pnl=pnl, fee=fee
    )
    if ccy is None:
        del bill["ccy"]
    else:
        bill["ccy"] = ccy
    return bill


class TestOkxNonUsdBillRefusedByName:
    async def test_tracer_a_mixed_currency_day_is_refused_by_name_never_summed(self) -> None:
        from routers.cron import _fetch_degradation

        rows = [_bill(1, D1_MS, "USDT", "10", "-1"), _bill(2, D1_MS + 1000, "BTC", "0.5", "0")]

        out, flags = await _read(rows)

        # Pre-fix: one row with price == 9.5 (the face-value sum) and no flag.
        assert out == [], f"a mixed-currency day was summed at face value: {out}"
        assert flags.get(FLAG) is True
        reasons, _error_class = _fetch_degradation(flags)
        assert FLAG in reasons

    @pytest.mark.parametrize("ccy", ["", None], ids=["blank", "missing"])
    async def test_a_blank_or_missing_ccy_with_an_amount_is_refused(self, ccy: str | None) -> None:
        out, flags = await _read([_bill(1, D1_MS, ccy, "10", "-1")])

        assert out == []
        assert flags.get(FLAG) is True

    async def test_usdg_is_refused_by_name(self) -> None:
        # USDG is an OKX USD-margined settle coin that is not in the shared stable-coin rule.
        out, flags = await _read([_bill(1, D1_MS, "USDG", "10", "-1")])

        assert out == []
        assert flags.get(FLAG) is True

    async def test_stable_coins_count_at_one(self) -> None:
        rows = [
            _bill(1, D4_MS, "USDT", "10", "-1"),
            _bill(2, D3_MS, "USDC", "7", "-0.5"),
            _bill(3, D2_MS, "DAI", "3", "-1"),
            _bill(4, D1_MS, "usdt", "4", "-0.25"),
        ]

        out, flags = await _read(rows)

        assert flags == {}
        # Hand-computed pnl + fee per day, abs() in price and the side carrying the sign.
        assert [(r["timestamp"][:10], r["price"]) for r in out] == [
            ("2026-11-16", 9.0),
            ("2026-11-17", 6.5),
            ("2026-11-18", 2.0),
            ("2026-11-19", 3.75),
        ]

    async def test_a_btc_funding_bill_is_dropped_before_the_currency_check(self) -> None:
        rows = [
            _bill(1, D1_MS, "USDT", "10", "-1"),
            _bill(2, D1_MS + 1000, "BTC", "0.5", "0", bill_type="8"),
        ]

        out, flags = await _read(rows)

        assert flags == {}
        assert [r["price"] for r in out] == [9.0]

    async def test_a_zero_amount_bill_in_another_currency_is_counted_not_refused(self) -> None:
        # pnl 0.5 + fee -0.5 is exactly zero: it contributes 0 at any rate, so it cannot mix.
        rows = [
            _bill(1, D1_MS, "USDT", "10", "-1"),
            _bill(2, D1_MS + 1000, "BTC", "0.5", "-0.5"),
        ]

        out, flags = await _read(rows)

        assert flags == {}
        assert [r["price"] for r in out] == [9.0]

    async def test_an_unreadable_amount_in_another_currency_is_dropped_as_malformed_not_summed(self) -> None:
        rows = [
            _bill(1, D1_MS, "USDT", "10", "-1"),
            _bill(2, D1_MS + 1000, "BTC", "nan", "0"),
        ]

        out, flags = await _read(rows)

        assert flags.get("daily_pnl_malformed_okx") is True
        assert FLAG not in flags
        assert [r["price"] for r in out] == [9.0]

    async def test_the_flag_carries_no_venue_text(self, caplog: pytest.LogCaptureFixture) -> None:
        venue_text = "ABCDEFGHIJKLMNOPQRST"  # 20 characters: past the 16-character code limit
        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            out, flags = await _read([_bill(1, D1_MS, venue_text, "1", "0")])

        assert out == []
        assert flags[FLAG] is True  # the boolean, never the census dict or a code
        text = " ".join(rec.getMessage() for rec in caplog.records)
        assert "malformed" in text
        assert venue_text not in text
