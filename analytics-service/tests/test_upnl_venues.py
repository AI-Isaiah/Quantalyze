"""Phase 167.2.1.1 UPNLVENUES plan 01 - what Bybit's ``fetch_balance()['total']`` means.

Every path that reads a venue balance has to agree on one question: does the
number ccxt calls ``total`` already include the open positions' unrealized PnL?
For Bybit it does not. ccxt's own ``bybit.parse_balance`` sets each coin's
``total`` from the coin ``walletBalance``; the coin ``equity``, ``unrealisedPnl``,
``totalEquity`` and ``totalPerpUPL`` survive only inside ``info``. A comment in
``services/equity_reconstruction.py`` claimed the opposite, and the reconstruct
anchor dropped the open uPnL for Bybit because of it.

Every balance below goes through ccxt's REAL ``parse_balance`` (no network, no
credentials), and every expected number is read from the payload's own fields or
typed with its arithmetic beside it. None is produced by calling the code under
test: a bare ``{"total": ...}`` mock is exactly how the wrong reading survived.

This module must never set Supabase or exchange env vars and makes no network
call.

Why each group matters (Rule 9):
  * ccxt semantics: the whole phase rests on one fact about ccxt. If a ccxt bump
    changes what ``total`` means, these go RED with the ccxt version in the
    message instead of a stored curve quietly shifting by the open uPnL.
  * reconstruct: the anchor is the level every reconstructed snapshot row is
    shifted to. Reading ``total`` as equity shifts the whole curve down by
    today's open uPnL.
  * derive: the derive anchor is REALIZED basis on purpose (``nav_twr`` subtracts
    a wedge that is structurally 0.0 for Bybit). Inverting the wedge to "match"
    the reconstruct side is the double count, so this pins that it stays put.
  * holdings: AUM is spot value plus each derivative row's uPnL; the spot row must
    carry the walletBalance, not the equity, or uPnL is counted twice.
  * cross-path: three per-path tests can each pass while the three paths still
    disagree. One identity ties them to the same payload.
  * coin coverage: derive reads the USDT coin only; reconstruct and holdings read
    every coin. Not a uPnL question, pinned so the gap is a recorded fact.
  * positions failure: after the fix Bybit depends on ``fetch_positions()``; a
    failed read must stay visible in the log, and never leak a request signature.
"""
from __future__ import annotations

import copy
import logging
import re
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import ccxt
import ccxt.async_support as ccxt_async
import pytest

# The ccxt version whose ``bybit.parse_balance`` these semantics were read from
# (``account['total'] = ... 'walletBalance'``). The pin guard below goes RED when
# analytics-service/requirements.txt moves without these tests being re-read.
CCXT_PIN_READ = "4.5.89"

# A V5 wallet-balance response in ccxt's documented shape. Values are chosen so
# the account's equity differs from its wallet balance (nonzero open uPnL):
# 1000 + 250.5 = 1250.5, typed here, never computed by the code under test.
BYBIT_UNIFIED_WALLET_BALANCE: dict[str, Any] = {
    "retCode": 0,
    "retMsg": "OK",
    "time": 1672125441042,
    "result": {
        "list": [
            {
                "accountType": "UNIFIED",
                "totalEquity": "1250.5",
                "totalWalletBalance": "1000",
                "totalPerpUPL": "250.5",
                "coin": [
                    {
                        "coin": "USDT",
                        "walletBalance": "1000",
                        "equity": "1250.5",
                        "unrealisedPnl": "250.5",
                        "availableToWithdraw": "",
                        "totalPositionIM": "10",
                        "totalOrderIM": "0",
                        "borrowAmount": "0",
                        "spotBorrow": "0",
                        "accruedInterest": "0",
                    }
                ],
            }
        ]
    },
}

# One ccxt-unified position dict (the shape ``fetch_positions()`` returns), not a
# raw V5 entry: position uPnL semantics are not in dispute in this phase, only
# ``total`` is. (60000 - 57495) x 0.1 = 250.5.
BYBIT_LINEAR_POSITIONS: list[dict[str, Any]] = [
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


def bybit_coin(coin: str, wallet: str, upnl: str) -> dict[str, str]:
    """A V5 coin row. ``equity`` follows Bybit's documented identity for an
    account with no borrow and no options: walletBalance + unrealisedPnl."""
    equity = str(Decimal(wallet) + Decimal(upnl))
    return {
        "coin": coin,
        "walletBalance": wallet,
        "equity": equity,
        "unrealisedPnl": upnl,
        "availableToWithdraw": "",
        "totalPositionIM": "10",
        "totalOrderIM": "0",
        "borrowAmount": "0",
        "spotBorrow": "0",
        "accruedInterest": "0",
    }


def bybit_wallet_balance(account_type: str, coins: list[dict[str, str]]) -> dict[str, Any]:
    """The same envelope as BYBIT_UNIFIED_WALLET_BALANCE for any account type and
    coin set. Account totals are summed with Decimal (stable coins at 1)."""
    wallet = sum((Decimal(c["walletBalance"]) for c in coins), Decimal(0))
    upnl = sum((Decimal(c["unrealisedPnl"]) for c in coins), Decimal(0))
    return {
        "retCode": 0,
        "retMsg": "OK",
        "time": 1672125441042,
        "result": {
            "list": [
                {
                    "accountType": account_type,
                    "totalEquity": str(wallet + upnl),
                    "totalWalletBalance": str(wallet),
                    "totalPerpUPL": str(upnl),
                    "coin": copy.deepcopy(coins),
                }
            ]
        },
    }


async def real_bybit_parse_balance(payload: dict[str, Any]) -> dict[str, Any]:
    """ccxt's REAL ``bybit.parse_balance`` on ``payload``. No credentials, no
    network; the instance is closed in ``finally``."""
    ex = ccxt_async.bybit({})
    try:
        return ex.parse_balance(copy.deepcopy(payload))
    finally:
        await ex.close()


def _coin_row(payload: dict[str, Any], coin: str) -> dict[str, str]:
    """The payload's own row for ``coin`` (the oracle's source of truth)."""
    for row in payload["result"]["list"][0]["coin"]:
        if row["coin"] == coin:
            return row
    raise AssertionError(f"coin {coin} not in fixture payload")


def _fake_bybit(balance: dict[str, Any], positions: Any) -> MagicMock:
    """A venue stub whose balance is the REAL parsed balance. ``positions`` is a
    list, or an exception instance for ``fetch_positions`` to raise."""
    ex = MagicMock()
    ex.id = "bybit"
    ex.fetch_balance = AsyncMock(return_value=copy.deepcopy(balance))
    if isinstance(positions, BaseException):
        ex.fetch_positions = AsyncMock(side_effect=positions)
    else:
        ex.fetch_positions = AsyncMock(return_value=copy.deepcopy(positions))
    ex.fetch_ticker = AsyncMock(return_value={"last": 0.0})
    ex.fetch_tickers = AsyncMock(return_value={})
    return ex


# ---------------------------------------------------------------------------
# ccxt semantics: what ``total`` IS for Bybit
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("account_type", ["UNIFIED", "CONTRACT"])
async def test_ccxt_semantics_bybit_total_is_the_coin_wallet_balance_not_equity(
    account_type: str,
) -> None:
    payload = bybit_wallet_balance(account_type, [_coin_row(BYBIT_UNIFIED_WALLET_BALANCE, "USDT")])
    coin = _coin_row(payload, "USDT")
    wallet = float(coin["walletBalance"])
    equity = float(coin["equity"])
    assert wallet != equity, "fixture must have nonzero open uPnL or it proves nothing"

    parsed = await real_bybit_parse_balance(payload)

    expected = wallet
    assert parsed["total"]["USDT"] == expected, (
        f"ccxt {ccxt.__version__} ({account_type}): bybit.parse_balance total['USDT'] "
        f"is {parsed['total']['USDT']}, expected the coin walletBalance {expected}. "
        "ccxt's `total` meaning changed: re-read bybit.parse_balance before trusting "
        "any Bybit anchor."
    )
    assert parsed["total"]["USDT"] != equity, (
        f"ccxt {ccxt.__version__} ({account_type}): total['USDT'] equals the coin "
        f"equity {equity}, so it now includes open uPnL and the reconstruct anchor "
        "would double count it."
    )


def test_ccxt_semantics_bybit_fixture_is_self_consistent() -> None:
    """The coin ``equity`` is only a valid independent oracle if Bybit's own
    identity holds in the fixture (zero borrow, no options)."""
    account = BYBIT_UNIFIED_WALLET_BALANCE["result"]["list"][0]
    coin = account["coin"][0]
    assert Decimal(coin["spotBorrow"]) == 0 and Decimal(coin["borrowAmount"]) == 0
    assert Decimal(coin["equity"]) == Decimal(coin["walletBalance"]) + Decimal(coin["unrealisedPnl"]), (
        "coin equity must be walletBalance + unrealisedPnl (Bybit V5 docs, no borrow, no options)"
    )
    assert Decimal(account["totalEquity"]) == Decimal(account["totalWalletBalance"]) + Decimal(
        account["totalPerpUPL"]
    ), "account totalEquity must be totalWalletBalance + totalPerpUPL"
    position_upnl = sum(Decimal(str(p["unrealizedPnl"])) for p in BYBIT_LINEAR_POSITIONS)
    assert position_upnl == Decimal(coin["unrealisedPnl"]), (
        "the position fixture's uPnL must equal the payload's unrealisedPnl, or the "
        "positions and the balance describe different books"
    )


def test_ccxt_pin_is_the_version_these_semantics_were_read_from() -> None:
    """RED when the pin moves without these semantics being re-read. Compares the
    pin to the constant, not the installed version, so a venv one patch behind the
    pin does not fail it (the balance functions are identical across 4.5.59..88)."""
    requirements = Path(__file__).resolve().parents[1] / "requirements.txt"
    match = re.search(r"^ccxt==(\S+)\s*$", requirements.read_text(encoding="utf-8"), re.MULTILINE)
    assert match is not None, "analytics-service/requirements.txt has no `ccxt==` pin"
    assert match.group(1) == CCXT_PIN_READ, (
        f"requirements.txt pins ccxt=={match.group(1)} but these tests were read from "
        f"{CCXT_PIN_READ}. Re-read `bybit.parse_balance` and `binance.parse_balance_custom` "
        "in the new version, then move CCXT_PIN_READ."
    )


# ---------------------------------------------------------------------------
# Reconstruct anchor
# ---------------------------------------------------------------------------


async def test_reconstruct_bybit_anchor_is_wallet_plus_position_upnl() -> None:
    from services.equity_reconstruction import _fetch_current_equity

    coin = _coin_row(BYBIT_UNIFIED_WALLET_BALANCE, "USDT")
    expected = float(coin["equity"])
    assert expected == float(coin["walletBalance"]) + float(coin["unrealisedPnl"])

    parsed = await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)
    anchor, partial = await _fetch_current_equity(
        _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit"
    )

    assert anchor == pytest.approx(expected, abs=1e-9), (
        f"SC-2: ccxt {ccxt.__version__} `total` is the coin walletBalance "
        f"({coin['walletBalance']}), which excludes open uPnL, so the reconstruct "
        f"anchor must add the position uPnL to reach the coin equity {expected}; got {anchor}."
    )
    assert partial == set()


# ---------------------------------------------------------------------------
# Derive anchor: realized basis, structural 0.0 wedge
# ---------------------------------------------------------------------------


async def test_derive_bybit_anchor_is_wallet_balance_with_a_structural_zero_wedge() -> None:
    from services.exchange import fetch_account_equity_and_upnl_usd

    coin = _coin_row(BYBIT_UNIFIED_WALLET_BALANCE, "USDT")
    wallet = float(coin["walletBalance"])
    parsed = await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)

    equity, balance_error, wedge, unreadable = await fetch_account_equity_and_upnl_usd(
        _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit"
    )

    assert (equity, balance_error, wedge, unreadable) == (wallet, False, 0.0, False), (
        f"ccxt {ccxt.__version__}: the Bybit derive anchor is the realized-basis "
        f"walletBalance {wallet} with a structurally 0.0 wedge by design until "
        "Phase 167.2.1.1.1 NAVMTM. A non-zero wedge here is the double count."
    )
    assert equity is not None and equity - wedge == wallet, (
        "nav_twr's terminal_nav = anchor - wedge must stay realized-basis"
    )


# ---------------------------------------------------------------------------
# Holdings poll: spot row = walletBalance, derivative row carries the uPnL
# ---------------------------------------------------------------------------


async def test_holdings_bybit_spot_row_is_wallet_balance_and_derivative_row_carries_upnl() -> None:
    from services.allocator_positions import fetch_allocator_holdings

    coin = _coin_row(BYBIT_UNIFIED_WALLET_BALANCE, "USDT")
    wallet = float(coin["walletBalance"])
    equity = float(coin["equity"])
    parsed = await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)

    # No monkeypatch of fetch_positions: the derivative rows go through the REAL
    # positions seam (the ccxt dicts carry markPrice, entryPrice and unrealizedPnl).
    rows, warning = await fetch_allocator_holdings(
        "bybit", _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS)
    )

    assert warning is None
    spot_rows = [r for r in rows if r["holding_type"] == "spot"]
    deriv_rows = [r for r in rows if r["holding_type"] == "derivative"]
    assert len(spot_rows) == 1 and len(deriv_rows) == 1, f"rows: {rows!r}"
    spot, deriv = spot_rows[0], deriv_rows[0]
    assert spot["symbol"] == "USDT"
    assert spot["quantity"] == pytest.approx(wallet), (
        f"ccxt {ccxt.__version__}: the Bybit USDT spot row must carry the coin "
        f"walletBalance {wallet}, not the equity {equity}"
    )
    assert spot["value_usd"] == pytest.approx(wallet)
    assert deriv["unrealized_pnl_usd"] == pytest.approx(250.5)  # (60000 - 57495) x 0.1
    assert spot["value_usd"] + deriv["unrealized_pnl_usd"] == pytest.approx(equity, abs=1e-9), (
        "AUM = spot value + derivative uPnL must equal the coin equity"
    )


# ---------------------------------------------------------------------------
# SC-2 as ONE invariant: every path reads `total` the same way
# ---------------------------------------------------------------------------


async def test_cross_path_bybit_reconstruct_equals_derive_plus_upnl_equals_holdings() -> None:
    from services.allocator_positions import fetch_allocator_holdings
    from services.equity_reconstruction import _fetch_current_equity
    from services.exchange import fetch_account_equity_and_upnl_usd

    coin = _coin_row(BYBIT_UNIFIED_WALLET_BALANCE, "USDT")
    # E: the oracle, read from the payload. U: the fixture positions' own uPnL.
    expected_equity = float(coin["equity"])
    position_upnl = sum(float(p["unrealizedPnl"]) for p in BYBIT_LINEAR_POSITIONS)

    parsed = await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)
    # A separate fake per path, each built from deep copies, so no path can
    # mutate another's input.
    reconstruct, _ = await _fetch_current_equity(_fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit")
    derive, _err, wedge, _unreadable = await fetch_account_equity_and_upnl_usd(
        _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit"
    )
    rows, warning = await fetch_allocator_holdings("bybit", _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS))
    assert warning is None
    holdings = sum(r["value_usd"] for r in rows if r["holding_type"] == "spot") + sum(
        r["unrealized_pnl_usd"] for r in rows if r["holding_type"] == "derivative"
    )

    assert reconstruct is not None and derive is not None
    detail = (
        f"reconstruct R={reconstruct}, derive D={derive}, open uPnL U={position_upnl}, "
        f"holdings H={holdings}, coin equity E={expected_equity}, wedge={wedge}; "
        f"ccxt {ccxt.__version__}"
    )
    assert wedge == 0.0, f"the derive wedge must stay structurally 0.0: {detail}"
    assert reconstruct == pytest.approx(derive + position_upnl, abs=1e-9), (
        f"SC-2: every path reads `total` the same way, as the wallet figure; the "
        f"mark-to-market reconstruct and the realized derive differ by exactly the "
        f"open uPnL: {detail}"
    )
    assert reconstruct == pytest.approx(holdings, abs=1e-9), f"SC-2: reconstruct != holdings AUM: {detail}"
    assert reconstruct == pytest.approx(expected_equity, abs=1e-9), (
        f"SC-2: reconstruct != the payload's coin equity: {detail}"
    )


# ---------------------------------------------------------------------------
# Coin coverage (booked gap, not a uPnL question)
# ---------------------------------------------------------------------------


async def test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin() -> None:
    from services.equity_reconstruction import _fetch_current_equity
    from services.exchange import fetch_account_equity_and_upnl_usd

    payload = bybit_wallet_balance(
        "UNIFIED",
        [bybit_coin("USDT", "1000", "250.5"), bybit_coin("USDC", "200", "0")],
    )
    parsed = await real_bybit_parse_balance(payload)

    derive, _err, _wedge, _unreadable = await fetch_account_equity_and_upnl_usd(
        _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit"
    )
    reconstruct, _ = await _fetch_current_equity(_fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit")

    note = (
        f"ccxt {ccxt.__version__}: pins the booked gap, TODOS [167.2.1.1-DERIVE-USDT-ONLY-ANCHOR]; "
        "update this test and the entry together if the derive starts reading other coins"
    )
    assert derive == 1000.0, f"derive reads the USDT coin only (1000), got {derive}; {note}"
    # 1000 USDT + 200 USDC (a stablecoin, priced at 1) + 250.5 open uPnL
    assert reconstruct == pytest.approx(1450.5, abs=1e-9), (
        f"reconstruct sums every stable coin plus the position uPnL, got {reconstruct}; {note}"
    )


# ---------------------------------------------------------------------------
# Positions read failure (decision PD-B, default path)
# ---------------------------------------------------------------------------


async def test_reconstruct_bybit_positions_read_failure_anchors_at_wallet_and_logs_the_drop(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from services.equity_reconstruction import _fetch_current_equity

    parsed = await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)
    failing = ccxt.NetworkError(
        "bybit GET https://api.bybit.com/v5/position/list?category=linear&signature=deadbeef"
    )

    with caplog.at_level(logging.WARNING):
        anchor, partial = await _fetch_current_equity(_fake_bybit(parsed, failing), "bybit")

    note = (
        "default (unforced) path: the anchor ships at the wallet figure by decision, "
        "owned by TODOS [167.2.1.1-ANCHOR-POSITIONS-READ-FAILURE]"
    )
    assert (anchor, partial) == (1000.0, set()), f"{note}; got {(anchor, partial)}"
    drops = [r for r in caplog.records if "fetch_positions failed" in r.getMessage()]
    assert len(drops) == 1, f"exactly one WARNING must record the dropped uPnL; {note}"
    message = drops[0].getMessage()
    assert drops[0].levelno == logging.WARNING
    assert "venue=bybit" in message and "exc_class=NetworkError" in message, message
    assert "deadbeef" not in caplog.text, (
        "the request signature must not reach the log (ccxt error text can carry one)"
    )
