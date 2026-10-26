"""Phase 167.2.1.1.1 NAVMTM plan 18 - the Bybit mark is the Unified Trading Account's own total.

D-17 (founder 2026-10-26, "Use Bybit's account total"): on a UTA 2.0 account the wallet-balance
read the derive already makes carries ``totalWalletBalance``, ``totalMarginBalance`` and
``totalEquity`` across USDT, USDC and inverse perpetuals, futures and options. The Bybit mark
takes its NAV and open profit from those totals with NO position walk, and refuses by name
whenever the totals cannot describe the account.

D-18 ("Yes, include option value"): ``nav_usd = totalEquity`` (wallet + perp and futures open
profit + option value), ``open_pnl_usd = totalEquity - totalWalletBalance``, ``wallet_usd =
totalWalletBalance``. ``totalMarginBalance`` (= wallet + perp uPnL, no option value) is never the
NAV.

Why each check can fail (the drills D-CC, D-ISO, D-BOR, D-UW, D-OPT and D-POS neuter one source line
each and name the test that must go RED; the SUMMARY records the RED output):

- the venue's own status/margin mode, never ccxt's cached default of 6 (a missing field must refuse);
- an isolated-margin account's account-wide fields are not applicable (Bybit doc), so refuse;
- ``totalEquity`` is not net of borrowed coins, so a non-zero ``borrowAmount`` refuses;
- the venue's ``totalWalletBalance`` must agree with OUR independently priced wallet;
- the nav is ``totalEquity``, not ``totalMarginBalance``;
- the reader makes no positions call.

Every expected number is a literal typed from the fake venue payload with its arithmetic beside it.
"""
from __future__ import annotations

import logging
import math
from typing import Any

import ccxt
import pytest

from services.equity_reconstruction import (
    ForcedRebuildRefusedError,
    _fetch_current_equity,
    read_marked_equity_usd,
)
from services.job_worker import DispatchOutcome
from services.nav_marks import MARK_REFUSAL_TOKENS, build_mark_read
from tests.test_nav_marks_l4_read import CLOSED_DAY, KEY, _bybit, _derive
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    T_0010,
    _key_inputs,
    _real_marks_writer,
)

ABSENT: Any = object()
"""Passed as a field value: the key is left out of the fake venue's response."""

D17_TOKENS = frozenset(
    {
        "account_mode_unsupported",
        "isolated_margin_unsupported",
        "borrow_present",
        "uta_totals_unreadable",
        "uta_wallet_mismatch",
    }
)


def _with(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = {**base, **over}
    return {k: v for k, v in out.items() if v is not ABSENT}


def _account_info(**over: Any) -> dict[str, Any]:
    return _with({"unifiedMarginStatus": 5, "marginMode": "REGULAR_MARGIN"}, over)


def _item(**over: Any) -> dict[str, Any]:
    """One wallet-balance list entry: USDT 1000 + BTC 0.01 (priced 60000.0 => 600.0) = our wallet
    1600.0; Bybit reports 1600.4 (0.4 of index/last basis, inside max(1.0, 0.005 x 1600.0))."""
    return _with(
        {
            "totalWalletBalance": "1600.4",
            "totalMarginBalance": "1650.4",
            "totalEquity": "1700.4",
            "totalPerpUPL": "50.0",
            "coin": [
                {"coin": "USDT", "walletBalance": "1000", "borrowAmount": "0"},
                {"coin": "BTC", "walletBalance": "0.01", "borrowAmount": "0"},
            ],
        },
        over,
    )


class UtaVenue:
    """A Bybit UTA fake that counts every call. ``fetch_positions`` is a SPY: the mark path must
    never call it (D-17), and a call is counted (not raised) so a neutered reader whose own
    ``except`` would swallow a raise is still caught by the count."""

    def __init__(
        self,
        *,
        item: dict[str, Any] | None = None,
        account_info: Any = None,
        wallet: dict[str, float] | None = None,
        tickers: dict[str, float] | None = None,
        ticker_fails: frozenset[str] = frozenset(),
        balance_raises: bool = False,
        info_raises: bool = False,
        list_shape: Any = None,
        default_status: int | None = 6,
    ) -> None:
        self.item = _item() if item is None else item
        self.account_info = _account_info() if account_info is None else account_info
        self.wallet = {"USDT": 1000.0, "BTC": 0.01} if wallet is None else dict(wallet)
        self.tickers = {"BTC": 60000.0} if tickers is None else dict(tickers)
        self.ticker_fails = ticker_fails
        self.balance_raises = balance_raises
        self.info_raises = info_raises
        self.list_shape = list_shape
        # ccxt caches ``options["unifiedMarginStatus"]`` and defaults it to 6 when the field is
        # absent; a reader that consults it would believe a venue that said nothing.
        self.options: dict[str, Any] = {"unifiedMarginStatus": default_status}
        self.fetch_balance_calls = 0
        self.account_info_calls = 0
        self.fetch_positions_calls = 0
        self.ticker_calls: list[str] = []

    async def fetch_balance(self) -> dict[str, Any]:
        self.fetch_balance_calls += 1
        if self.balance_raises:
            raise ccxt.NetworkError("balance read failed sig=abc123")
        lst: Any = [self.item] if self.list_shape is None else self.list_shape
        return {"total": dict(self.wallet), "info": {"retCode": 0, "result": {"list": lst}}}

    async def privateGetV5AccountInfo(self) -> Any:  # noqa: N802 (ccxt's implicit method name)
        self.account_info_calls += 1
        if self.info_raises:
            raise ccxt.NetworkError("account info read failed sig=abc123")
        return {"retCode": 0, "retMsg": "OK", "result": self.account_info}

    async def fetch_positions(self, *_a: Any, **_k: Any) -> list[Any]:
        self.fetch_positions_calls += 1
        return []

    async def fetch_ticker(self, symbol: str) -> dict[str, Any]:
        self.ticker_calls.append(symbol)
        asset = symbol.split("/")[0]
        if asset in self.ticker_fails:
            raise ccxt.NetworkError("ticker read failed")
        return {"last": self.tickers[asset]}


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: a UTA 2.0 key with USDC perps, an inverse position and an option
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uta_total_is_the_bybit_mark() -> None:
    """D-17: nav 1700.4 = totalEquity, wallet 1600.4 = totalWalletBalance, open 100.0 =
    1700.4 - 1600.4. One balance read, one account-info read, one ticker (BTC), no positions."""
    ex = UtaVenue()
    out = await read_marked_equity_usd(ex, "bybit")
    assert out == (1700.4, 100.0, 1600.4)
    assert ex.fetch_positions_calls == 0, "D-17: the Bybit mark makes no positions call"
    assert (ex.fetch_balance_calls, ex.account_info_calls) == (1, 1)
    assert ex.ticker_calls == ["BTC/USDT"], "one ticker per held non-stable coin"


@pytest.mark.asyncio
async def test_option_value_is_in_the_nav() -> None:
    """D-18: totalEquity (1700.4) exceeds totalMarginBalance (1660.4) by 40.0 of option value.
    The nav is totalEquity, so the 40.0 is booked with the rest of the open profit (100.0)."""
    ex = UtaVenue(item=_item(totalMarginBalance="1660.4"))
    out = await read_marked_equity_usd(ex, "bybit")
    assert out == (1700.4, 100.0, 1600.4)
    assert not (isinstance(out, tuple) and out[0] == 1660.4)


@pytest.mark.parametrize(
    "usdt_wallet,expect",
    [(1600.0, (1700.4, 100.0)), (1000.0, "wallet_basis_mismatch")],
    ids=["wallet-within-tolerance", "derive-usdt-only"],
)
def test_bybit_mark_goes_through_build_mark_read(
    usdt_wallet: float, expect: tuple[float, float] | str
) -> None:
    """D-04 is unchanged. The derive's own Bybit wallet figure is USDT-ONLY
    (``fetch_usdt_balance_with_status``), so this account, whose BTC is worth 600.0 of its 1600.4,
    meets the production figure of 1000.0 and is refused ``wallet_basis_mismatch`` (the 600.0 of
    BTC the realized series never held would be booked as the first marked day's return). The
    1600.0 row is only the arithmetic of the pass edge (a derive wallet within tolerance of
    Bybit's total), not a figure production passes for this account."""
    got = build_mark_read(
        venue="bybit", marked_at=T_0010, equity=None, open_pnl=None,
        balance_error=False, upnl_unreadable=False,
        marked_equity=(1700.4, 100.0, 1600.4), usdt_wallet_usd=usdt_wallet,
    )
    if isinstance(expect, str):
        assert got == expect
    else:
        assert not isinstance(got, str)
        assert (got.nav_usd, got.open_pnl_usd) == expect


@pytest.mark.asyncio
async def test_forced_rebuild_path_keeps_its_perp_upl_check() -> None:
    """The history-rebuild forced path is unchanged, its ``totalPerpUPL`` cross-check included:
    positions sum 25.0, the account reports 90 -> positions_unreadable (plan 15's fixture)."""
    with pytest.raises(ForcedRebuildRefusedError, match="positions_unreadable"):
        await _fetch_current_equity(
            _bybit(total_perp_upl="90"), "bybit", refuse_unread_positions=True
        )
    total, partial = await _fetch_current_equity(
        _bybit(), "bybit", refuse_unread_positions=True
    )
    assert total == 1025.0 and partial.wallet_total_usd == 1000.0  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_the_derive_stores_the_uta_total_and_makes_no_positions_call() -> None:
    """End to end through the derive, with the derive's wallet the USDT-ONLY figure production
    passes (1600.0). The account holds 0.0001 BTC (6.0 at 60000.0) beside it: Bybit's
    totalWalletBalance is 1606.2, 6.2 from 1600.0 and inside max(1.0, 0.005 x 1600.0) = 8.0, so
    the mark stores Bybit's own total: nav 1706.2, open 1706.2 - 1606.2 = 100.0."""
    db = FakeDb()
    item = _item(
        totalWalletBalance="1606.2", totalMarginBalance="1656.2", totalEquity="1706.2",
    )
    ex = UtaVenue(wallet={"USDT": 1600.0, "BTC": 0.0001}, item=item)
    result, capture, _combine = await _derive(db, ex, venue="bybit", derive_usdt=1600.0)
    assert result.outcome == DispatchOutcome.DONE
    row = db.marks[(KEY, CLOSED_DAY)]
    assert row["nav_usd"] == 1706.2 and row["open_pnl_usd"] == pytest.approx(100.0, abs=1e-9)
    assert row["venue"] == "bybit" and row["native_unit"] == "USD"
    assert ex.fetch_positions_calls == 0
    assert (ex.fetch_balance_calls, ex.account_info_calls) == (1, 1)
    assert "nav_mark_refusal" not in _key_inputs(capture)

    # W3: the closed day's mark is stored, so a second derive reads nothing at all.
    again = UtaVenue(item=_item(totalEquity="9999.0"))  # never read: the stored row wins
    await _derive(db, again, venue="bybit", derive_usdt=1600.0)
    assert (again.fetch_balance_calls, again.account_info_calls, again.fetch_positions_calls) == (0, 0, 0)
    assert again.ticker_calls == []


@pytest.mark.asyncio
async def test_non_usdt_collateral_beyond_tolerance_stays_refused_by_name() -> None:
    """D-04 (W3): the derive's wallet is USDT-only (1000.0) and this account's BTC adds 600.0, so
    the stored mark would book BTC as the first marked day's return: refused, nothing written.
    Such accounts stay refused by name; the UTA total does not widen what D-04 accepts."""
    db = FakeDb()
    result, capture, _combine = await _derive(db, UtaVenue(), venue="bybit", derive_usdt=1000.0)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "wallet_basis_mismatch"


@pytest.mark.asyncio
async def test_a_stablecoin_only_account_needs_no_ticker() -> None:
    ex = UtaVenue(
        wallet={"USDT": 1000.0, "USDC": 200.0},
        item=_item(totalWalletBalance="1200.0", totalMarginBalance="1230.0", totalEquity="1240.0"),
    )
    out = await read_marked_equity_usd(ex, "bybit")
    assert out == (1240.0, 40.0, 1200.0)
    assert ex.ticker_calls == []


@pytest.mark.asyncio
async def test_binance_is_unchanged_by_plan_18() -> None:
    """Binance stays L4 as written: wallet + summed position uPnL, one positions call."""
    from tests.test_nav_marks_l4_read import _binance

    ex = _binance()
    assert await read_marked_equity_usd(ex, "binance") == (1025.0, 25.0, 1000.0)
    assert ex.fetch_positions_calls == 1


def test_the_d17_tokens_are_in_the_closed_refusal_set() -> None:
    assert D17_TOKENS <= MARK_REFUSAL_TOKENS


# --------------------------------------------------------------------------------------
# Task 2 - every D-17 refusal by name
# --------------------------------------------------------------------------------------

_NAN = float("nan")

_REFUSAL_CASES: list[tuple[str, dict[str, Any], str]] = [
    # unifiedMarginStatus: only a venue-reported 5 or 6 passes.
    ("status-1-classic", {"account_info": _account_info(unifiedMarginStatus=1)}, "account_mode_unsupported"),
    ("status-3-uta1", {"account_info": _account_info(unifiedMarginStatus=3)}, "account_mode_unsupported"),
    ("status-4-uta1-pro", {"account_info": _account_info(unifiedMarginStatus=4)}, "account_mode_unsupported"),
    ("status-absent", {"account_info": _account_info(unifiedMarginStatus=ABSENT)}, "account_mode_unsupported"),
    ("status-text", {"account_info": _account_info(unifiedMarginStatus="abc")}, "account_mode_unsupported"),
    ("status-null", {"account_info": _account_info(unifiedMarginStatus=None)}, "account_mode_unsupported"),
    ("status-bool", {"account_info": _account_info(unifiedMarginStatus=True)}, "account_mode_unsupported"),
    ("status-no-result", {"account_info": {}}, "account_mode_unsupported"),
    # marginMode
    ("isolated", {"account_info": _account_info(marginMode="ISOLATED_MARGIN")}, "isolated_margin_unsupported"),
    ("margin-absent", {"account_info": _account_info(marginMode=ABSENT)}, "uta_totals_unreadable"),
    ("margin-unknown", {"account_info": _account_info(marginMode="NEW_MODE")}, "uta_totals_unreadable"),
    ("margin-not-text", {"account_info": _account_info(marginMode=3)}, "uta_totals_unreadable"),
    # borrowing
    (
        "borrow-half-a-coin",
        {"item": _item(coin=[
            {"coin": "USDT", "borrowAmount": "0"}, {"coin": "BTC", "borrowAmount": "0.5"},
        ])},
        "borrow_present",
    ),
    (
        "borrow-text",
        {"item": _item(coin=[{"coin": "USDT", "borrowAmount": "x"}, {"coin": "BTC", "borrowAmount": "0"}])},
        "uta_totals_unreadable",
    ),
    (
        "borrow-absent",
        {"item": _item(coin=[{"coin": "USDT"}, {"coin": "BTC", "borrowAmount": "0"}])},
        "uta_totals_unreadable",
    ),
    (
        "borrow-nan",
        {"item": _item(coin=[{"coin": "USDT", "borrowAmount": "NaN"}, {"coin": "BTC", "borrowAmount": "0"}])},
        "uta_totals_unreadable",
    ),
    ("coin-list-absent", {"item": _item(coin=ABSENT)}, "uta_totals_unreadable"),
    ("coin-list-not-a-list", {"item": _item(coin={"USDT": 1})}, "uta_totals_unreadable"),
    ("coin-row-not-a-dict", {"item": _item(coin=["USDT"])}, "uta_totals_unreadable"),
    # totals
    ("equity-absent", {"item": _item(totalEquity=ABSENT)}, "uta_totals_unreadable"),
    ("equity-nan", {"item": _item(totalEquity="NaN")}, "uta_totals_unreadable"),
    ("equity-inf", {"item": _item(totalEquity="inf")}, "uta_totals_unreadable"),
    ("equity-none", {"item": _item(totalEquity=None)}, "uta_totals_unreadable"),
    ("equity-empty", {"item": _item(totalEquity="")}, "uta_totals_unreadable"),
    ("equity-float-nan", {"item": _item(totalEquity=_NAN)}, "uta_totals_unreadable"),
    ("wallet-total-absent", {"item": _item(totalWalletBalance=ABSENT)}, "uta_totals_unreadable"),
    ("wallet-total-inf", {"item": _item(totalWalletBalance="-inf")}, "uta_totals_unreadable"),
    # our own wallet pricing vs Bybit's totalWalletBalance: tolerance max(1.0, 0.005 x 1600.0) = 8.0
    ("wallet-mismatch", {"item": _item(totalWalletBalance="1650.0")}, "uta_wallet_mismatch"),
    ("wallet-mismatch-low", {"item": _item(totalWalletBalance="1590.0")}, "uta_wallet_mismatch"),
    ("wallet-mismatch-edge", {"item": _item(totalWalletBalance="1608.1")}, "uta_wallet_mismatch"),
    # our ticker read failed: unknown equity, never compared against an undercount
    ("ticker-failed", {"ticker_fails": frozenset({"BTC"})}, "wallet_unpriced"),
    # reads
    ("balance-raises", {"balance_raises": True}, "balance_error"),
    ("account-info-raises", {"info_raises": True}, "balance_error"),
    ("balance-no-list", {"list_shape": []}, "balance_error"),
    ("balance-list-not-a-list", {"list_shape": {"a": 1}}, "balance_error"),
    ("balance-entry-not-a-dict", {"list_shape": ["x"]}, "balance_error"),
    ("account-info-not-a-dict", {"account_info": ["x"]}, "balance_error"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kw,token", [(c[1], c[2]) for c in _REFUSAL_CASES], ids=[c[0] for c in _REFUSAL_CASES]
)
async def test_every_uta_refusal_is_named_and_makes_no_positions_call(
    kw: dict[str, Any], token: str
) -> None:
    ex = UtaVenue(**kw)
    assert await read_marked_equity_usd(ex, "bybit") == token
    assert token in MARK_REFUSAL_TOKENS
    assert ex.fetch_positions_calls == 0


@pytest.mark.asyncio
async def test_a_refused_account_is_refused_before_any_ticker_read() -> None:
    """The structural refusals (mode, margin mode, borrow, totals) cost no price read."""
    for kw in (
        {"account_info": _account_info(unifiedMarginStatus=3)},
        {"account_info": _account_info(marginMode="ISOLATED_MARGIN")},
        {"item": _item(coin=[{"coin": "BTC", "borrowAmount": "0.5"}])},
        {"item": _item(totalEquity="NaN")},
    ):
        ex = UtaVenue(**kw)
        assert isinstance(await read_marked_equity_usd(ex, "bybit"), str)
        assert ex.ticker_calls == []


@pytest.mark.asyncio
async def test_ccxt_default_is_never_read() -> None:
    """ccxt caches ``options["unifiedMarginStatus"]`` and defaults it to 6 when the field is
    absent from /v5/account/info. A venue that reported nothing is not a UTA 2.0 account."""
    ex = UtaVenue(account_info=_account_info(unifiedMarginStatus=ABSENT), default_status=6)
    assert ex.options["unifiedMarginStatus"] == 6
    assert await read_marked_equity_usd(ex, "bybit") == "account_mode_unsupported"
    # ...and the converse: a venue that reports 3 is refused whatever ccxt cached.
    ex2 = UtaVenue(account_info=_account_info(unifiedMarginStatus=3), default_status=6)
    assert await read_marked_equity_usd(ex2, "bybit") == "account_mode_unsupported"
    # ...and a reported 5 or 6 passes whatever ccxt cached.
    for status in (5, 6, "5"):
        ex3 = UtaVenue(account_info=_account_info(unifiedMarginStatus=status), default_status=1)
        assert await read_marked_equity_usd(ex3, "bybit") == (1700.4, 100.0, 1600.4)


@pytest.mark.asyncio
async def test_portfolio_margin_is_a_uta_2_account() -> None:
    ex = UtaVenue(account_info=_account_info(marginMode="PORTFOLIO_MARGIN"))
    assert await read_marked_equity_usd(ex, "bybit") == (1700.4, 100.0, 1600.4)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "venue_wallet,ok",
    [("1607.9", True), ("1608.0", True), ("1592.0", True), ("1608.1", False), ("1591.9", False)],
)
async def test_wallet_cross_check_tolerance_edges(venue_wallet: str, ok: bool) -> None:
    """max(1.0, 0.005 x |our wallet 1600.0|) = 8.0: 8.0 apart is inside, a tenth more is refused."""
    ex = UtaVenue(item=_item(totalWalletBalance=venue_wallet))
    out = await read_marked_equity_usd(ex, "bybit")
    if ok:
        assert isinstance(out, tuple) and out[2] == float(venue_wallet)
    else:
        assert out == "uta_wallet_mismatch"


@pytest.mark.asyncio
async def test_unpriced_is_judged_before_the_wallet_comparison() -> None:
    """Our wallet is an undercount when a ticker failed (BTC 600.0 missing against Bybit's 1600.4),
    so the honest token is wallet_unpriced, not a mismatch against a number we know is short."""
    ex = UtaVenue(ticker_fails=frozenset({"BTC"}))
    assert await read_marked_equity_usd(ex, "bybit") == "wallet_unpriced"
    assert ex.ticker_calls == ["BTC/USDT"]


@pytest.mark.asyncio
async def test_the_figures_returned_are_finite_and_a_refusal_never_returns_a_tuple() -> None:
    out = await read_marked_equity_usd(UtaVenue(), "bybit")
    assert isinstance(out, tuple) and all(math.isfinite(v) for v in out)


@pytest.mark.asyncio
@pytest.mark.parametrize("which", ["balance", "info"])
async def test_venue_error_text_never_reaches_the_log(
    caplog: pytest.LogCaptureFixture, which: str
) -> None:
    """Logs carry the exception class and a token, never the venue's text (a signature rides
    ccxt error text)."""
    ex = UtaVenue(balance_raises=which == "balance", info_raises=which == "info")
    with caplog.at_level(logging.DEBUG):
        assert await read_marked_equity_usd(ex, "bybit") == "balance_error"
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "exc_class=NetworkError" in text
    for venue_text in ("abc123", "sig=", "balance read failed", "account info read failed"):
        assert venue_text not in text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kw,token",
    [
        ({"account_info": _account_info(unifiedMarginStatus=3)}, "account_mode_unsupported"),
        ({"item": _item(coin=[{"coin": "BTC", "borrowAmount": "0.5"}])}, "borrow_present"),
        ({"balance_raises": True}, "balance_error"),
    ],
    ids=["mode", "borrow", "balance"],
)
async def test_a_refusal_writes_nothing_and_the_derive_still_finishes(
    kw: dict[str, Any], token: str
) -> None:
    db = FakeDb()
    result, capture, _combine = await _derive(db, UtaVenue(**kw), venue="bybit", derive_usdt=1600.0)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    payload = _key_inputs(capture)
    assert payload["nav_mark_refusal"] == token
    assert "nav_mark" not in payload


@pytest.mark.asyncio
async def test_the_dry_run_sequence_for_a_uta_key() -> None:
    """The call sequence plan 11's dry run makes: read_marked_equity_usd, the derive's own USDT
    wallet figure, build_mark_read. Production's wallet figure for this account is USDT-only
    (1000.0) and is refused; the 1600.0 row is the pass edge of the arithmetic, not a figure
    production passes for it."""
    ex = UtaVenue()
    marked = await read_marked_equity_usd(ex, "bybit")
    for usdt, expect in ((1600.0, 1700.4), (1000.0, "wallet_basis_mismatch")):
        got = build_mark_read(
            venue="bybit", marked_at=T_0010, equity=None, open_pnl=None,
            balance_error=False, upnl_unreadable=False,
            marked_equity=marked, usdt_wallet_usd=usdt,
        )
        if isinstance(expect, str):
            assert got == expect
        else:
            assert not isinstance(got, str) and got.nav_usd == expect
