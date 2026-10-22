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
CCXT_PIN_READ = "4.5.88"

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
