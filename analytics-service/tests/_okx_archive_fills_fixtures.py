"""Shared constants and hand-typed expected rows for the Phase 259 archive-fills tests.

A plain helper module: no ``Test*`` class and no ``test_*`` function, so pytest collects
nothing from it. Plans 259-04 to 259-07 compare the mapper's output and the job's writes
against the literals below. Every value was typed from the cells of ``fills_q2_2026.csv`` and
``fills_q3_2026.csv`` (or computed once at planning time and pasted as a literal); NOTHING
here is produced by the code under test, which is what makes it an oracle.

All amounts and ids are invented.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Final

FIXTURES_DIR: Final[Path] = Path(__file__).parent / "fixtures" / "okx_archive"
FILLS_Q2_PATH: Final[Path] = FIXTURES_DIR / "fills_q2_2026.csv"
FILLS_Q3_PATH: Final[Path] = FIXTURES_DIR / "fills_q3_2026.csv"

# --------------------------------------------------------------------------- instants
NOW_MS: Final[int] = 1795780800000  # 2026-11-27T12:00:00Z, the test clock
TODAY: Final[str] = "2026-11-27"
FLOOR_MS: Final[int] = 1787918400000  # 2026-08-28T12:00:00Z: now minus three calendar months plus one day
WRITE_BOUND_MS: Final[int] = 1788004800000  # 2026-08-29T12:00:00Z: FLOOR_MS + 86400000
ANCHOR_DAY: Final[str] = "2026-05-01"
ANCHOR_MS: Final[int] = 1777593600000  # 2026-05-01T00:00:00Z
Q1_2026_CUT_START_MS: Final[int] = 1767196800000  # 2025-12-31T16:00:00Z
Q2_2026_CUT: Final[tuple[int, int]] = (
    1774972800000,  # 2026-03-31T16:00:00Z
    1782835200000,  # 2026-06-30T16:00:00Z
)
Q3_2026_CUT: Final[tuple[int, int]] = (
    1782835200000,  # 2026-06-30T16:00:00Z
    1790784000000,  # 2026-09-30T16:00:00Z
)

# --------------------------------------------------------------------------- trade ids
# In ts order. Fixture trade bills (billId -> tradeId -> ts):
#   910000002 -> 880000001 -> 2026-04-10T08:00:00.123Z  (Q2, before the anchor)
#   910000003 -> 880000002 -> 2026-05-05T08:00:00.123Z  (Q2)
#   910000005 -> 880000003 -> 2026-05-20T08:00:00.123Z  (Q2)
#   910000006 -> 880000004 -> 2026-06-10T08:00:00.123Z  (Q2)
#   910000009 -> 880000005 -> 2026-07-15T08:00:00.123Z  (Q3)
#   910000010 -> 880000006 -> 2026-08-10T08:00:00.123Z  (Q3)
#   910000012 -> 880000007 -> 2026-09-03T08:00:00.123Z  (Q3, at or above the write bound)
#   910000013 -> 880000008 -> 2026-09-10T08:00:00.123Z  (Q3, at or above the write bound)
TRADE_IDS_BEFORE_ANCHOR: Final[tuple[str, ...]] = ("880000001",)
TRADE_IDS_WRITE_WINDOW: Final[tuple[str, ...]] = (  # ANCHOR_MS <= ts < WRITE_BOUND_MS, both files
    "880000002",
    "880000003",
    "880000004",
    "880000005",
    "880000006",
)
TRADE_IDS_RECONCILE_WINDOW: Final[tuple[str, ...]] = (  # ts >= WRITE_BOUND_MS, Q3 only
    "880000007",
    "880000008",
)

# The seam between the quarters: the running bal after Q2's last bill and after Q3's first.
# Q3's first bill is a funding bill with balChg -1.10, so 5034.62 - 1.10 = 5033.52.
QUARTER_BALANCES: Final[dict[str, str]] = {
    "q2_last_bal": "5034.62",  # billId 910000007
    "q3_first_bal": "5033.52",  # billId 910000008
}


# --------------------------------------------------------------------------- expected rows
def _expected(
    *,
    side: str,
    price: str,
    quantity: str,
    fee: str,
    timestamp: str,
    order_id: str,
    fill_id: str,
    maker: bool,
    cost: str,
    exec_type: str,
) -> dict[str, Any]:
    """Lay one literal row out in the 15-key shape ``_make_fill_dict`` returns.

    The arguments are the hand-typed values; only the constants shared by every ETH-USDT-SWAP
    archive row (venue, symbol, fee currency, order type, raw_data frame) live here."""
    return {
        "exchange": "okx",
        "symbol": "ETHUSDTSWAP",
        "side": side,
        "price": price,
        "quantity": quantity,
        "fee": fee,
        "fee_currency": "USDT",
        "timestamp": timestamp,
        "order_type": "fill",
        "exchange_order_id": order_id,
        "exchange_fill_id": fill_id,
        "is_fill": True,
        "is_maker": maker,
        "cost": cost,
        "raw_data": {
            "posSide": "net",
            "instType": "SWAP",
            "execType": exec_type,
            "feeCcy": "USDT",
            "_ingest_ctval": 0.1,
            "source": "okx_bills_history_archive",
        },
    }


# Quantity is sz x 0.1 (ETH-USDT contract value) and cost is price x quantity, both as Decimal
# prints them (so cost keeps its trailing zero where the product has one). Timestamps are the
# bill's ts, whose millisecond part is .123.
EXPECTED_ROWS: Final[dict[str, dict[str, Any]]] = {
    "880000001": _expected(
        side="buy", price="2950.25", quantity="0.2", fee="-0.30", cost="590.050", exec_type="T",
        timestamp="2026-04-10T08:00:00.123000+00:00", order_id="770000001", fill_id="880000001", maker=False,
    ),
    "880000002": _expected(
        side="sell", price="3010.5", quantity="0.5", fee="-0.75", cost="1505.25", exec_type="M",
        timestamp="2026-05-05T08:00:00.123000+00:00", order_id="770000002", fill_id="880000002", maker=True,
    ),
    "880000003": _expected(
        side="buy", price="3055.75", quantity="0.4", fee="-0.61", cost="1222.300", exec_type="T",
        timestamp="2026-05-20T08:00:00.123000+00:00", order_id="770000003", fill_id="880000003", maker=False,
    ),
    "880000004": _expected(
        side="sell", price="3120.5", quantity="0.4", fee="-0.62", cost="1248.20", exec_type="M",
        timestamp="2026-06-10T08:00:00.123000+00:00", order_id="770000004", fill_id="880000004", maker=True,
    ),
    "880000005": _expected(
        side="buy", price="3000.5", quantity="0.3", fee="-0.45", cost="900.15", exec_type="T",
        timestamp="2026-07-15T08:00:00.123000+00:00", order_id="770000005", fill_id="880000005", maker=False,
    ),
    "880000006": _expected(
        side="sell", price="3090.25", quantity="0.3", fee="-0.46", cost="927.075", exec_type="M",
        timestamp="2026-08-10T08:00:00.123000+00:00", order_id="770000006", fill_id="880000006", maker=True,
    ),
    "880000007": _expected(
        side="buy", price="3150.75", quantity="0.6", fee="-0.95", cost="1890.450", exec_type="T",
        timestamp="2026-09-03T08:00:00.123000+00:00", order_id="770000007", fill_id="880000007", maker=False,
    ),
    "880000008": _expected(
        side="sell", price="3200.25", quantity="0.6", fee="-0.96", cost="1920.150", exec_type="M",
        timestamp="2026-09-10T08:00:00.123000+00:00", order_id="770000008", fill_id="880000008", maker=True,
    ),
}

# What PostgREST hands back for the same fill, typed by hand and deliberately NOT in the
# mapper's text form: price and fee as floats, quantity padded to the column's 8 decimals, the
# timestamp with a millisecond fraction and no microsecond padding. A reader that compares
# strings fails on every one of these; one that compares values passes.
_STORED: Final[dict[str, tuple[float, str, float, str]]] = {
    "880000001": (2950.25, "0.20000000", -0.3, "2026-04-10T08:00:00.123+00:00"),
    "880000002": (3010.5, "0.50000000", -0.75, "2026-05-05T08:00:00.123+00:00"),
    "880000003": (3055.75, "0.40000000", -0.61, "2026-05-20T08:00:00.123+00:00"),
    "880000004": (3120.5, "0.40000000", -0.62, "2026-06-10T08:00:00.123+00:00"),
    "880000005": (3000.5, "0.30000000", -0.45, "2026-07-15T08:00:00.123+00:00"),
    "880000006": (3090.25, "0.30000000", -0.46, "2026-08-10T08:00:00.123+00:00"),
    "880000007": (3150.75, "0.60000000", -0.95, "2026-09-03T08:00:00.123+00:00"),
    "880000008": (3200.25, "0.60000000", -0.96, "2026-09-10T08:00:00.123+00:00"),
}


def stored_row(trade_id: str, *, strategy_id: str) -> dict[str, Any]:
    """The ``trades`` row PostgREST would return for one fixture fill, in PostgREST's forms."""
    price, quantity, fee, timestamp = _STORED[trade_id]
    expected = EXPECTED_ROWS[trade_id]
    return {
        "strategy_id": strategy_id,
        "exchange": "okx",
        "is_fill": True,
        "exchange_fill_id": trade_id,
        "symbol": expected["symbol"],
        "side": expected["side"],
        "fee_currency": "USDT",
        "price": price,
        "quantity": quantity,
        "fee": fee,
        "timestamp": timestamp,
    }
