"""Phase 167.2.1.1 UPNLVENUES plan 02 -- Binance reads the spot wallet on every path.

D-03 makes Binance code plus tests only (no PROD step: there are no Binance keys).
Measured at the phase base, every Binance path already reads ccxt's default spot
``fetch_balance()['total']`` (free + locked, no unrealized PnL) the same way:

  * derive      -- ``fetch_account_equity_and_upnl_usd``: anchor = the spot USDT
                   total, wedge = a structural 0.0 (the anchor embeds no uPnL).
  * reconstruct -- ``_fetch_current_equity``: spot total PLUS ``fetch_positions``
                   uPnL (the mark-to-market level of a replay that marks open perps).
  * holdings    -- ``fetch_allocator_holdings``: spot rows from the same total,
                   derivative rows carrying each position's uPnL.

The ROADMAP's "Binance double count" is two bases, not a double count: the derive is
the realized-basis NAV chain, the reconstruct anchor is the mark-to-market level, and
neither counts uPnL twice on the spot wallet the repo reads. The cross-path test below
is the executable form of that ruling.

Every payload goes through ccxt's REAL ``binance.parse_balance_custom`` with no network
and no mock of the parser; only the exchange object that serves the parsed balance is a
stub. Expected values are read from the payload fields, never from repo code.

Why each group matters (Rule 9):
  * ccxt-semantics: the whole phase rests on what each Binance wallet type's ``total``
    IS. If ccxt moves the spot ``total`` to include uPnL, or a futures ``total`` stops
    including it, the reconstruct additive path flips between under- and double-count
    and these fail first, carrying ``ccxt.__version__``.
  * per-path: each path must return the figure the payload fields predict. A path that
    drifts to another reading of ``total`` shifts the stored NAV chain or the AUM book.
  * cross-path: the three paths must agree on ONE spot reading. Per-path tests can each
    pass while the paths disagree with each other, which is the defect class.
  * trip-wire: the paths are only consistent while Binance is read with ccxt's default
    type 'spot'. A futures-type read already carries uPnL in ``total``, so the additive
    reconstruct path would count it twice.
"""
from __future__ import annotations

import copy
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import ccxt
import ccxt.async_support as ccxt_async
import pytest

from services.allocator_positions import fetch_allocator_holdings
from services.equity_reconstruction import _fetch_current_equity
from services.exchange import create_exchange, fetch_account_equity_and_upnl_usd

# -- ccxt-documented payloads (response-shape comments inside ``binance.fetch_balance``).
# Values are chosen so the uPnL-inclusive and uPnL-exclusive readings differ.

# GET /api/v3/account (spot): USDT free 900 + locked 100.
BINANCE_SPOT_ACCOUNT: dict[str, Any] = {
    "balances": [{"asset": "USDT", "free": "900", "locked": "100"}],
}

# GET /fapi/v2/account (USD-M futures): wallet 1000 + unrealized 250.5 = margin 1250.5.
# ``updateTime`` must be nonzero: ccxt skips a futures asset whose updateTime is 0.
BINANCE_USDM_ACCOUNT: dict[str, Any] = {
    "assets": [
        {
            "asset": "USDT",
            "walletBalance": "1000",
            "unrealizedProfit": "250.5",
            "marginBalance": "1250.5",
            "availableBalance": "900",
            "updateTime": 1,
        }
    ],
}

# GET /papi/v1/balance (portfolio margin): a list, one entry per asset.
BINANCE_PAPI_BALANCE: list[dict[str, Any]] = [
    {
        "asset": "USDT",
        "totalWalletBalance": "1000",
        "crossMarginAsset": "0",
        "crossMarginBorrowed": "0",
        "crossMarginFree": "0",
        "crossMarginInterest": "0",
        "crossMarginLocked": "0",
        "umWalletBalance": "1000",
        "umUnrealizedPNL": "200.5",
        "cmWalletBalance": "0",
        "cmUnrealizedPNL": "50",
        "updateTime": 1,
    }
]

# One ccxt-unified linear position (the shape ``binance.fetch_positions`` returns).
BINANCE_LINEAR_POSITIONS: list[dict[str, Any]] = [
    {
        "symbol": "BTC/USDT:USDT",
        "contracts": 0.1,
        "contractSize": 1,
        "side": "long",
        "notional": 6000.0,
        "entryPrice": 57495.0,
        "markPrice": 60000.0,
        "unrealizedPnl": 250.5,
    }
]


async def real_binance_parse_balance(
    payload: Any,
    type_: str,
    margin_mode: str | None = None,
    portfolio_margin: bool = False,
) -> dict[str, Any]:
    """Run ccxt's REAL ``binance.parse_balance_custom`` on ``payload`` (no network)."""
    exchange = ccxt_async.binance({})
    try:
        parsed: dict[str, Any] = exchange.parse_balance_custom(
            payload, type_, margin_mode, portfolio_margin
        )
        return parsed
    finally:
        await exchange.close()


def _fake_exchange(balance: dict[str, Any], positions: list[dict[str, Any]]) -> MagicMock:
    """A Binance-shaped exchange serving deep copies of ``balance`` and ``positions``."""
    exchange = MagicMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value=copy.deepcopy(balance))
    exchange.fetch_positions = AsyncMock(return_value=copy.deepcopy(positions))
    exchange.fetch_tickers = AsyncMock(return_value={})
    exchange.fetch_ticker = AsyncMock(return_value={"last": 0.0})
    return exchange


# -- ccxt semantics: what each Binance wallet type's ``total`` IS ---------------------


async def test_ccxt_semantics_binance_spot_total_is_free_plus_locked() -> None:
    parsed = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    row = BINANCE_SPOT_ACCOUNT["balances"][0]
    # 900 free + 100 locked = 1000; the spot wallet carries no unrealized PnL.
    expected = float(row["free"]) + float(row["locked"])
    assert parsed["total"]["USDT"] == pytest.approx(expected, abs=1e-9), (
        f"ccxt {ccxt.__version__}: binance spot total must be free + locked "
        f"({expected}), got {parsed['total']['USDT']}"
    )


async def test_ccxt_semantics_binance_usdm_futures_total_already_includes_unrealized_profit() -> None:
    parsed = await real_binance_parse_balance(BINANCE_USDM_ACCOUNT, "linear")
    row = BINANCE_USDM_ACCOUNT["assets"][0]
    margin = float(row["marginBalance"])
    wallet_plus_upnl = float(row["walletBalance"]) + float(row["unrealizedProfit"])  # 1000 + 250.5
    total = parsed["total"]["USDT"]
    assert total == pytest.approx(margin, abs=1e-9), (
        f"ccxt {ccxt.__version__}: binance USD-M (type='linear') total must be "
        f"marginBalance ({margin}), got {total}"
    )
    assert total == pytest.approx(wallet_plus_upnl, abs=1e-9), (
        f"ccxt {ccxt.__version__}: binance USD-M total must be walletBalance + "
        f"unrealizedProfit ({wallet_plus_upnl}): a futures total already carries uPnL, "
        f"got {total}"
    )


async def test_ccxt_semantics_binance_portfolio_margin_total_includes_um_and_cm_unrealized() -> None:
    parsed = await real_binance_parse_balance(BINANCE_PAPI_BALANCE, "spot", None, True)
    entry = BINANCE_PAPI_BALANCE[0]
    # 1000 + 200.5 + 50 = 1250.5
    expected = (
        float(entry["totalWalletBalance"])
        + float(entry["umUnrealizedPNL"])
        + float(entry["cmUnrealizedPNL"])
    )
    assert parsed["total"]["USDT"] == pytest.approx(expected, abs=1e-9), (
        f"ccxt {ccxt.__version__}: binance portfolio-margin total must be "
        f"totalWalletBalance + umUnrealizedPNL + cmUnrealizedPNL ({expected}), "
        f"got {parsed['total']['USDT']}"
    )


# -- each path, on the spot wallet the repo actually reads ----------------------------


async def test_derive_binance_anchor_is_spot_total_with_a_structural_zero_wedge() -> None:
    balance = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    exchange = _fake_exchange(balance, [])
    row = BINANCE_SPOT_ACCOUNT["balances"][0]
    expected = float(row["free"]) + float(row["locked"])  # 900 + 100

    equity, balance_error, wedge, unreadable = await fetch_account_equity_and_upnl_usd(
        exchange, "binance"
    )

    assert equity == pytest.approx(expected, abs=1e-9), (
        f"ccxt {ccxt.__version__}: derive anchor must be the spot USDT total "
        f"({expected}), got {equity}"
    )
    assert (balance_error, wedge, unreadable) == (False, 0.0, False), (
        "derive wedge for Binance is a structural 0.0 (the anchor embeds no uPnL), "
        f"never a read field; got {(balance_error, wedge, unreadable)}"
    )


async def test_reconstruct_binance_anchor_adds_position_upnl_to_the_spot_total() -> None:
    balance = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    exchange = _fake_exchange(balance, BINANCE_LINEAR_POSITIONS)
    row = BINANCE_SPOT_ACCOUNT["balances"][0]
    # spot 1000 + position uPnL 250.5 = 1250.5
    expected = float(row["free"]) + float(row["locked"]) + BINANCE_LINEAR_POSITIONS[0]["unrealizedPnl"]

    equity, partial = await _fetch_current_equity(exchange, "binance")

    assert partial == set()
    assert equity == pytest.approx(expected, abs=1e-9), (
        f"ccxt {ccxt.__version__}: Binance reconstruct anchor is the mark-to-market "
        f"level, spot total + position uPnL ({expected}); got {equity}. A figure equal "
        "to the spot total alone means Binance was wrongly put in the unified-margin "
        "skip set and the open uPnL was dropped."
    )


async def test_holdings_binance_spot_row_is_the_spot_total_and_derivative_row_carries_upnl() -> None:
    balance = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    exchange = _fake_exchange(balance, BINANCE_LINEAR_POSITIONS)
    row = BINANCE_SPOT_ACCOUNT["balances"][0]
    expected_qty = float(row["free"]) + float(row["locked"])  # 900 + 100

    rows, warning = await fetch_allocator_holdings("binance", exchange)

    spot = [r for r in rows if r["holding_type"] == "spot"]
    deriv = [r for r in rows if r["holding_type"] == "derivative"]
    assert warning is None
    assert len(spot) == 1 and spot[0]["symbol"] == "USDT", spot
    assert spot[0]["quantity"] == pytest.approx(expected_qty, abs=1e-9), (
        f"ccxt {ccxt.__version__}: holdings spot quantity must be free + locked "
        f"({expected_qty}), got {spot[0]['quantity']}"
    )
    assert len(deriv) == 1, deriv
    assert deriv[0]["unrealized_pnl_usd"] == pytest.approx(
        BINANCE_LINEAR_POSITIONS[0]["unrealizedPnl"], abs=1e-9
    )


async def test_cross_path_binance_reconstruct_equals_derive_plus_upnl_equals_holdings() -> None:
    """SC-2 as ONE invariant: R == D + U == H == O on one parsed spot balance."""
    balance = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")

    # A separate fake exchange per path, each built from deep copies of the SAME parsed
    # balance and the SAME fixture positions, so no path can consume another's state.
    r_exchange = _fake_exchange(balance, BINANCE_LINEAR_POSITIONS)
    d_exchange = _fake_exchange(balance, BINANCE_LINEAR_POSITIONS)
    h_exchange = _fake_exchange(balance, BINANCE_LINEAR_POSITIONS)

    reconstruct, _partial = await _fetch_current_equity(r_exchange, "binance")
    derive, _err, wedge, _unreadable = await fetch_account_equity_and_upnl_usd(
        d_exchange, "binance"
    )
    rows, _warning = await fetch_allocator_holdings("binance", h_exchange)

    upnl = sum(float(p["unrealizedPnl"]) for p in BINANCE_LINEAR_POSITIONS)  # U = 250.5
    holdings = sum(r["value_usd"] for r in rows if r["holding_type"] == "spot") + sum(
        r["unrealized_pnl_usd"] for r in rows if r["holding_type"] == "derivative"
    )
    payload_row = BINANCE_SPOT_ACCOUNT["balances"][0]
    oracle = float(payload_row["free"]) + float(payload_row["locked"]) + upnl  # 900+100+250.5

    assert reconstruct is not None and derive is not None
    msg = (
        f"ccxt {ccxt.__version__}: Binance cross-path identity broke. "
        f"reconstruct R={reconstruct}, derive D={derive}, uPnL U={upnl}, "
        f"holdings H={holdings}, payload oracle O={oracle}. The identity "
        "R == D + U == H == O is the ruling on ROADMAP evidence (2): two bases, "
        "one reading of the spot total, no double count."
    )
    assert reconstruct == pytest.approx(derive + upnl, abs=1e-9), msg
    assert reconstruct == pytest.approx(holdings, abs=1e-9), msg
    assert reconstruct == pytest.approx(oracle, abs=1e-9), msg
    assert wedge == 0.0, msg


# -- trip-wire: the paths are consistent ONLY while Binance is read as spot ----------


async def test_binance_tripwire_repo_reads_the_spot_wallet_only() -> None:
    # (a) create_exchange keeps ccxt's default type 'spot' (no network: construction only).
    client = create_exchange("binance", "k", "s")
    try:
        default_type = client.options["defaultType"]
    finally:
        await client.close()  # type: ignore[no-untyped-call]
    guidance = (
        "If Binance is ever read with a futures type, its fetch_balance() total "
        "already includes uPnL and the reconstruct additive path double counts. "
        "Change the _UNIFIED_MARGIN_VENUES skip set and the derive wedge together "
        "and close TODOS [167.2.1.1-BINANCE-FUTURES-WALLET-UNREAD]."
    )
    assert default_type == "spot", (
        f"ccxt {ccxt.__version__}: binance defaultType is {default_type!r}, not 'spot'. "
        + guidance
    )

    # (b) both anchors call fetch_balance() with NO arguments (no type override).
    balance = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    derive_exchange = _fake_exchange(balance, [])
    await fetch_account_equity_and_upnl_usd(derive_exchange, "binance")
    reconstruct_exchange = _fake_exchange(balance, BINANCE_LINEAR_POSITIONS)
    await _fetch_current_equity(reconstruct_exchange, "binance")
    for path, ex in (("derive", derive_exchange), ("reconstruct", reconstruct_exchange)):
        assert ex.fetch_balance.await_args_list == [((), {})], (
            f"{path} anchor must await fetch_balance() with no arguments, got "
            f"{ex.fetch_balance.await_args_list}. " + guidance
        )

    # (c) a futures-type total exceeds the spot-style wallet by exactly unrealizedProfit,
    # which is why a futures-type read would double count under the additive path.
    usdm = await real_binance_parse_balance(BINANCE_USDM_ACCOUNT, "linear")
    asset = BINANCE_USDM_ACCOUNT["assets"][0]
    assert usdm["total"]["USDT"] - float(asset["walletBalance"]) == pytest.approx(
        float(asset["unrealizedProfit"]), abs=1e-9
    ), (
        f"ccxt {ccxt.__version__}: USD-M total must exceed the wallet figure by "
        f"unrealizedProfit. " + guidance
    )
