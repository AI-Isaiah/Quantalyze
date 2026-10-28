"""Phase 167.2.1.1.1 NAVMTM plan 15 - the Bybit/Binance marked-equity read (L4, D-04, D-16).

What these pin, and why each can fail
-------------------------------------
L4: a Bybit or Binance key's stored mark is read EXACTLY the way the reconstruct anchor reads the
account (``equity_reconstruction._fetch_current_equity(..., refuse_unread_positions=True)``):
every held asset in the wallet, plus the summed position ``unrealizedPnl``, with the forced
path's refusals. A copy of that rule would drift from it, so the mark calls the anchor's own
function through ``read_marked_equity_usd`` and the L4 proof below compares the stored figure to
what the anchor returns on an identical venue.

D-04 (Pitfall 6): the derive's realized series is anchored on the USDT WALLET. A mark whose
all-asset wallet differs from that figure would book the difference (BTC, USDC, ...) as the first
marked day's return, so it is refused (``wallet_basis_mismatch``), and a held asset whose price
could not be read is refused (``wallet_unpriced``). Every stored mark therefore satisfies
``nav_usd - open_pnl_usd == the derive's own USDT wallet`` within the anchor's own tolerance.

D-16 / W3: the read costs one ``fetch_positions``, one ``fetch_balance`` and one ``fetch_ticker``
per held non-stable asset per key per UTC day. When the day's mark is already stored the derive
reads it and makes none of those calls. OKX, Deribit, MT5 and sFOX make no added call.

A refused read never fails the derive and never changes the realized series.

Plan 18 (D-17, D-18) amends L4 for BYBIT only: its mark is the Unified Trading Account's own
total (``totalEquity``), read without a position walk, so the Bybit cases of this module run on a
UTA 2.0 fake (``account_info`` + the wallet-balance totals) and the cases that asserted the
positions read or the ``totalPerpUPL`` refusal on the MARK path are retired (their replacements,
and the D-17 refusals, are in ``test_nav_marks_bybit_uta.py``). Binance is L4 as written.

Every expected number is a literal typed from the fake venue payload with its arithmetic beside
it; the one comparison against the anchor is the L4 proof itself. The in-memory marks table is
plan 06's mirror (``FakeDb``): the SQL gate and the lane probe are the authority on the table.
"""
from __future__ import annotations

import asyncio
import logging
import re
from contextlib import ExitStack
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest

from services.exchange import fetch_account_equity_and_upnl_usd
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    T_0010,
    _ctx,
    _key_inputs,
    _real_marks_writer,
    _returns,
    marks_not_applied,
)

# Captured at import time, before any test patches the module attribute.
_REAL_WALLET_READ = fetch_account_equity_and_upnl_usd

KEY = "key-1"
CLOSED_DAY = "2026-03-01"  # T_0010 is 2026-03-02T00:10:30Z


# --------------------------------------------------------------------------------------
# A fake ccxt venue that counts every call
# --------------------------------------------------------------------------------------


class FakeVenue:
    """The three reads ``_fetch_current_equity`` makes, counted. Any other attribute access
    raises ``AttributeError``, so an unexpected venue call fails the test loudly."""

    def __init__(
        self,
        *,
        wallet: dict[str, float],
        positions: Any = None,
        total_perp_upl: str | None = None,
        tickers: dict[str, float] | None = None,
        ticker_fails: frozenset[str] = frozenset(),
        balance_raises: bool = False,
        positions_raises: bool = False,
        positions_delay_s: float = 0.0,
        balance_delay_s: float = 0.0,
        account_info: dict[str, Any] | None = None,
        uta_totals: dict[str, Any] | None = None,
    ) -> None:
        self.wallet = dict(wallet)
        self.positions: Any = [] if positions is None else positions
        self.total_perp_upl = total_perp_upl
        self.tickers = dict(tickers or {})
        self.ticker_fails = ticker_fails
        self.balance_raises = balance_raises
        self.positions_raises = positions_raises
        self.positions_delay_s = positions_delay_s
        self.balance_delay_s = balance_delay_s
        # Bybit only (plan 18): the venue's own /v5/account/info body and the account totals of
        # the wallet-balance list entry. Both None on Binance, which has neither.
        self.account_info = account_info
        self.uta_totals = uta_totals
        self.account_info_calls = 0
        self.fetch_balance_calls = 0
        self.fetch_positions_calls = 0
        self.fetch_ticker_calls: list[str] = []

    async def fetch_balance(self) -> dict[str, Any]:
        self.fetch_balance_calls += 1
        if self.balance_delay_s:
            await asyncio.sleep(self.balance_delay_s)
        if self.balance_raises:
            raise ccxt.NetworkError("balance read failed")
        out: dict[str, Any] = {"total": dict(self.wallet)}
        item: dict[str, Any] = dict(self.uta_totals or {})
        if self.total_perp_upl is not None:
            item["totalPerpUPL"] = self.total_perp_upl
        if item:
            out["info"] = {"result": {"list": [item]}}
        return out

    async def privateGetV5AccountInfo(self) -> dict[str, Any]:  # noqa: N802 (ccxt's name)
        self.account_info_calls += 1
        assert self.account_info is not None, "this fake venue has no /v5/account/info"
        return {"retCode": 0, "retMsg": "OK", "result": dict(self.account_info)}

    async def fetch_positions(self) -> Any:
        self.fetch_positions_calls += 1
        if self.positions_delay_s:
            await asyncio.sleep(self.positions_delay_s)
        if self.positions_raises:
            raise ccxt.NetworkError("positions read failed")
        return self.positions

    # NAVMTM plan 19 (D-18, D-20): after a successful L4 read the Binance mark also reads the
    # European Options account. The deliberate defaults are "no options" (an all-empty asset list,
    # no position), so plan 15's Binance tests keep their assertions; plan 19's own tests replace
    # these two with counting fakes.
    async def eapiPrivateGetMarginAccount(  # noqa: N802 (ccxt's name)
        self, params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {"asset": []}

    async def eapiPrivateGetPosition(  # noqa: N802 (ccxt's name)
        self, params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return []

    async def fetch_ticker(self, symbol: str) -> dict[str, Any]:
        self.fetch_ticker_calls.append(symbol)
        asset = symbol.split("/")[0]
        if asset in self.ticker_fails:
            raise ccxt.NetworkError("ticker read failed")
        return {"last": self.tickers[asset]}


def _bybit(**kw: Any) -> FakeVenue:
    """Bybit UTA 2.0, USDT 1000.0 wallet and +25.0 of open profit (the plan's first scenario).
    Wallet 1000.0 + uPnL 25.0 = 1025.0.

    The account totals are the fake venue's own arithmetic from its wallet: a USDT/USDC coin
    counts 1.0 and any other coin its ticker, ``totalPerpUPL`` is ``total_perp_upl`` (25.0) and
    ``totalEquity`` is wallet + that. The ``positions`` are what the FORCED rebuild path still
    reads (``_fetch_current_equity``); the Bybit MARK path no longer calls ``fetch_positions``.
    """
    kw.setdefault("wallet", {"USDT": 1000.0})
    wallet_usd = sum(
        float(q) * (1.0 if a in ("USDT", "USDC") else float(kw.get("tickers", {}).get(a, 0.0)))
        for a, q in kw["wallet"].items()
    )
    upl = float(kw.get("total_perp_upl") or 25.0)
    kw.setdefault("account_info", {"unifiedMarginStatus": 5, "marginMode": "REGULAR_MARGIN"})
    kw.setdefault(
        "uta_totals",
        {
            "totalWalletBalance": str(wallet_usd),
            "totalMarginBalance": str(wallet_usd + upl),
            "totalEquity": str(wallet_usd + upl),
            "coin": [{"coin": a, "borrowAmount": "0"} for a in kw["wallet"]],
        },
    )
    kw.setdefault(
        "positions",
        [
            {"symbol": "BTC/USDT:USDT", "contracts": 1, "unrealizedPnl": 25.0},
            {"symbol": "ETH/USDT:USDT", "contracts": 0, "unrealizedPnl": None},
        ],
    )
    kw.setdefault("total_perp_upl", "25")
    return FakeVenue(**kw)


def _binance(**kw: Any) -> FakeVenue:
    """Binance reports no ``totalPerpUPL`` (the anchor runs no cross-check there)."""
    kw.setdefault("wallet", {"USDT": 1000.0})
    kw.setdefault(
        "positions",
        [
            {"symbol": "BTC/USDT:USDT", "contracts": 1, "unrealizedPnl": 25.0},
            {"symbol": "ETH/USDT:USDT", "contracts": 0, "unrealizedPnl": None},
        ],
    )
    return FakeVenue(**kw)


_MAKE = {"bybit": _bybit, "binance": _binance}


# --------------------------------------------------------------------------------------
# The derive harness (copied from plan 06's, with the exchange and the combine exposed)
# --------------------------------------------------------------------------------------


async def _derive(
    db: FakeDb,
    exchange: Any,
    *,
    venue: str = "bybit",
    derive_usdt: float = 1000.0,
    now: datetime = T_0010,
    key_mode: bool = True,
    extra_patches: list[Any] | None = None,
    owner_tables: Any = None,
) -> tuple[Any, dict[str, Any], MagicMock]:
    """Run ``run_derive_broker_dailies_job`` for one ccxt key. The derive's OWN equity read is
    patched to ``derive_usdt`` (its realized USDT wallet figure, wedge 0.0); everything the
    mark path reads comes from ``exchange``."""
    ctx, capture = _ctx(
        db, key_id=KEY, user_id="alloc-1", venue=venue,
        strategy_id=None if key_mode else "strat-1",
    )
    ctx.exchange = exchange
    if owner_tables is not None:
        # The owner's ``api_keys`` and ``allocator_holdings`` come from a FakeSupabaseClient; every
        # other table keeps the harness's routing.
        inner = ctx.supabase.table.side_effect
        ctx.supabase.table.side_effect = lambda name: (
            owner_tables.table(name) if name in ("api_keys", "allocator_holdings") else inner(name)
        )
    preflight = (
        "services.job_worker._allocator_key_preflight"
        if key_mode else "services.job_worker._exchange_preflight"
    )
    meta = {"used_heuristic_capital": False, "series_completeness": "fill_derived_unproven"}
    combine = MagicMock(return_value=(_returns(2), dict(meta)))
    patches = [
        patch(preflight, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(derive_usdt, False, 0.0, False)),
        ),
        patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_binance", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_bybit", new=AsyncMock(return_value=[])),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch("services.broker_dailies.combine_realized_and_funding", new=combine),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=now)),
        *(extra_patches or []),
    ]
    job: dict[str, Any] = {"id": "j", "kind": "derive_broker_dailies"}
    job.update({"api_key_id": KEY} if key_mode else {"strategy_id": "strat-1"})
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(job)
    return result, capture, combine


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: the anchor's own reading is the stored mark (L4)
# --------------------------------------------------------------------------------------


# RETIRED by plan 18 (D-17): ``test_bybit_mark_reads_as_the_reconstruct_anchor``. It asserted that
# the Bybit mark equals ``_fetch_current_equity``'s positions-based reading and that the mark
# path makes one ``fetch_positions`` call. The Bybit mark is now the account's own
# ``totalEquity`` with no positions call; ``test_nav_marks_bybit_uta.py`` pins that instead.


@pytest.mark.asyncio
async def test_binance_mark_reads_as_the_reconstruct_anchor() -> None:
    from services.equity_reconstruction import _fetch_current_equity

    db = FakeDb()
    venue = _binance()
    result, _capture, _combine = await _derive(db, venue, venue="binance")
    assert result.outcome == DispatchOutcome.DONE
    row = db.marks[(KEY, CLOSED_DAY)]
    assert row["venue"] == "binance"
    assert row["nav_usd"] == 1025.0 and row["open_pnl_usd"] == 25.0
    assert venue.fetch_positions_calls == 1
    anchor_nav, _partial = await _fetch_current_equity(
        _binance(), "binance", refuse_unread_positions=True
    )
    assert row["nav_usd"] == anchor_nav


@pytest.mark.asyncio
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
@pytest.mark.parametrize("key_mode", [True, False], ids=["key-mode", "strategy-mode"])
async def test_both_modes_store_the_mark(venue_name: str, key_mode: bool) -> None:
    db = FakeDb()
    result, _capture, _combine = await _derive(
        db, _MAKE[venue_name](), venue=venue_name, key_mode=key_mode
    )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks[(KEY, CLOSED_DAY)]["nav_usd"] == 1025.0


@pytest.mark.asyncio
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
@pytest.mark.parametrize(
    "wallet,tickers,derive_usdt,expect_row",
    [
        # BTC 0.1 x 60000.0 = 6000.0 of holdings the realized series never contained: the step
        # would book 6000.0 of BTC as the first marked day's return.
        ({"USDT": 1000.0, "BTC": 0.1}, {"BTC": 60000.0}, 1000.0, False),
        # USDC 500.0 at 1.0: all-asset wallet 1500.0 against the derive's 1000.0.
        ({"USDT": 1000.0, "USDC": 500.0}, {}, 1000.0, False),
        # USDC 0.5: wallet 1000.5, inside max(1.0, 0.005 x 1000.0) = 5.0.
        ({"USDT": 1000.0, "USDC": 0.5}, {}, 1000.0, True),
    ],
    ids=["btc-holding", "usdc-500", "usdc-dust-inside-tolerance"],
)
async def test_non_usdt_wallet_holdings_refuse_the_mark(
    venue_name: str, wallet: dict[str, float], tickers: dict[str, float],
    derive_usdt: float, expect_row: bool,
) -> None:
    db = FakeDb()
    venue = _MAKE[venue_name](wallet=wallet, tickers=tickers)
    result, capture, _combine = await _derive(
        db, venue, venue=venue_name, derive_usdt=derive_usdt
    )
    assert result.outcome == DispatchOutcome.DONE
    if expect_row:
        row = db.marks[(KEY, CLOSED_DAY)]
        assert row["nav_usd"] == 1025.5 and row["open_pnl_usd"] == 25.0  # 1000.5 + 25.0
        assert "nav_mark_refusal" not in _key_inputs(capture)
    else:
        assert db.marks == {}
        assert _key_inputs(capture)["nav_mark_refusal"] == "wallet_basis_mismatch"


# --------------------------------------------------------------------------------------
# The pure rule: build_mark_read with the wrapper's tuple and the derive's own USDT wallet
# --------------------------------------------------------------------------------------


def _build(**kw: Any) -> Any:
    from services.nav_marks import build_mark_read

    base: dict[str, Any] = {
        "venue": "bybit", "marked_at": T_0010, "equity": None, "open_pnl": None,
        "balance_error": False, "upnl_unreadable": False,
        "marked_equity": (1025.0, 25.0, 1000.0), "usdt_wallet_usd": 1000.0,
    }
    base.update(kw)
    return build_mark_read(**base)


def test_wallet_basis_tolerance_edges_are_the_anchors_own() -> None:
    # max(1.0, 0.005 x 1000.0) = 5.0: exactly 5.0 apart is inside, a cent more is refused.
    inside = _build(marked_equity=(1030.0, 25.0, 1005.0))
    assert not isinstance(inside, str) and inside.nav_usd == 1030.0
    assert _build(marked_equity=(1030.01, 25.0, 1005.01)) == "wallet_basis_mismatch"
    assert _build(marked_equity=(1020.0, 25.0, 995.0)).nav_usd == 1020.0
    assert _build(marked_equity=(1019.99, 25.0, 994.99)) == "wallet_basis_mismatch"
    # A wallet of 150.0: the absolute 1.0 floor wins over 0.5% of 150.0 = 0.75 (the dust floor
    # of a mark is 100.0, so the wallet cannot be smaller than that).
    assert _build(marked_equity=(181.0, 30.0, 151.0), usdt_wallet_usd=150.0).nav_usd == 181.0
    assert (
        _build(marked_equity=(181.5, 30.0, 151.5), usdt_wallet_usd=150.0)
        == "wallet_basis_mismatch"
    )


def test_wallet_basis_needs_the_derives_own_wallet_and_finite_figures() -> None:
    assert _build(usdt_wallet_usd=None) == "balance_error"
    assert _build(marked_equity=(1025.0, 25.0, float("nan"))) == "nonfinite"
    assert _build(usdt_wallet_usd=float("nan")) == "nonfinite"


def test_the_wrappers_token_is_the_refusal_and_the_closed_set_is_enforced() -> None:
    assert _build(marked_equity="positions_unreadable") == "positions_unreadable"
    assert _build(marked_equity="wallet_unpriced") == "wallet_unpriced"
    assert _build(marked_equity="balance_error") == "balance_error"
    with pytest.raises(ValueError):
        _build(marked_equity="made_up_reason")


def test_a_marked_equity_read_is_only_for_bybit_and_binance_and_replaces_equity() -> None:
    with pytest.raises(ValueError):
        _build(venue="okx")
    with pytest.raises(ValueError):
        _build(equity=1025.0)  # both a marked_equity and an equity: ambiguous
    assert _build(venue="binance").venue == "binance"


def test_the_derives_own_balance_flag_still_wins() -> None:
    assert _build(balance_error=True) == "balance_error"


# --------------------------------------------------------------------------------------
# Task 2 - every unsafe read refused, W3, no added call elsewhere
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
async def test_unpriced_wallet_asset_refuses_the_mark(venue_name: str) -> None:
    """A held non-stable asset whose ticker raised is unknown equity: refuse, store nothing."""
    db = FakeDb()
    venue = _MAKE[venue_name](
        wallet={"USDT": 1000.0, "BTC": 0.1}, ticker_fails=frozenset({"BTC"}),
    )
    result, capture, _combine = await _derive(db, venue, venue=venue_name)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "wallet_unpriced"
    assert venue.fetch_ticker_calls == ["BTC/USDT"]


_FULL_PAGE = [{"symbol": f"S{i}/USDT:USDT", "contracts": 0, "unrealizedPnl": 0.0} for i in range(200)]

# Plan 18 (D-17) retired the Bybit rows that asserted the positions read or the ``totalPerpUPL``
# cross-check on the mark path (raised, non-list, full page, non-numeric uPnL, a disagreeing or
# absent ``totalPerpUPL``); the Bybit refusals are in ``test_nav_marks_bybit_uta.py``.
_REFUSALS = [
    ("binance", {"positions_raises": True}, "positions_unreadable"),
    ("binance", {"positions": {"not": "a list"}}, "positions_unreadable"),
    ("binance", {"positions": _FULL_PAGE}, "positions_unreadable"),
    (
        "binance",
        {"positions": [{"symbol": "BTC/USDT:USDT", "contracts": 1, "unrealizedPnl": "abc"}]},
        "positions_unreadable",
    ),
    ("bybit", {"balance_raises": True}, "balance_error"),
    ("binance", {"balance_raises": True}, "balance_error"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "venue_name,kw,token", _REFUSALS, ids=[f"{v}-{t}-{i}" for i, (v, _k, t) in enumerate(_REFUSALS)]
)
async def test_every_unsafe_read_is_refused_and_the_derive_still_finishes(
    venue_name: str, kw: dict[str, Any], token: str
) -> None:
    db = FakeDb()
    kw = dict(kw)
    venue = _MAKE[venue_name]()
    if "total_perp_upl" in kw:
        venue.total_perp_upl = kw.pop("total_perp_upl")
    for name, value in kw.items():
        setattr(venue, name, value)
    result, capture, _combine = await _derive(db, venue, venue=venue_name)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    payload = _key_inputs(capture)
    assert payload["nav_mark_refusal"] == token
    assert "nav_mark" not in payload


@pytest.mark.asyncio
async def test_a_read_over_the_bound_is_a_refusal_not_a_failed_derive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-167.2.1.1.1-23: the L4 read is bounded by the derive's own per-crawl bound, and
    exceeding it is positions_unreadable. It must not take the derive's own timeout arm
    (FAILED, transient), which would retry the whole derive for a refused optional read."""
    import services.job_worker as jw

    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    db = FakeDb()
    venue = _bybit(balance_delay_s=5.0)  # plan 18: Bybit makes no positions call
    result, capture, _combine = await _derive(db, venue, venue="bybit")
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "positions_unreadable"


@pytest.mark.asyncio
async def test_an_exception_the_wrapper_did_not_turn_into_a_token_is_a_refusal() -> None:
    """Anything the wrapper lets escape is still positions_unreadable, never a failed derive."""
    db = FakeDb()
    boom = AsyncMock(side_effect=RuntimeError("venue text that must not leak: sig=abc123"))
    result, capture, _combine = await _derive(
        db, _bybit(), venue="bybit",
        extra_patches=[patch("services.equity_reconstruction.read_marked_equity_usd", new=boom)],
    )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "positions_unreadable"
    assert "abc123" not in repr(capture["upserts"])


@pytest.mark.asyncio
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
async def test_a_429_on_the_mark_read_stamps_the_cooldown_and_refuses_as_balance_error(
    venue_name: str, caplog: pytest.LogCaptureFixture
) -> None:
    """D-10: a 429 on the mark read is the venue asking this key to back off, so it stamps
    ``last_429_at`` (the circuit breaker the sibling jobs read) like every other handler's 429
    arm, refuses as ``balance_error`` (not ``positions_unreadable``: nothing about positions was
    learned) and still finishes the derive. The WARNING names the venue only: no key id."""
    db = FakeDb()
    exc = ccxt.RateLimitExceeded("venue text that must not leak: sig=abc123")
    boom = AsyncMock(side_effect=exc)
    stamp = AsyncMock()
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result, capture, _combine = await _derive(
            db, _MAKE[venue_name](), venue=venue_name,
            extra_patches=[
                patch("services.equity_reconstruction.read_marked_equity_usd", new=boom),
                patch("services.job_worker._stamp_429", new=stamp),
            ],
        )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "balance_error"
    stamp.assert_awaited_once()
    assert stamp.await_args.args[1]["id"] == KEY and stamp.await_args.args[2] is exc
    lines = [r.getMessage() for r in caplog.records if "rate limited" in r.getMessage()]
    assert len(lines) == 1 and venue_name in lines[0], caplog.text
    assert KEY not in lines[0] and "api_key=" not in lines[0] and "abc123" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "venue_name,method",
    [
        ("binance", "fetch_positions"),
        ("bybit", "fetch_balance"),
        ("bybit", "privateGetV5AccountInfo"),
        ("binance", "eapiPrivateGetMarginAccount"),
        ("binance", "eapiPrivateGetPosition"),
    ],
)
async def test_a_429_from_every_mark_read_reaches_the_cooldown_stamp(
    venue_name: str, method: str
) -> None:
    """SFH MEDIUM-2 (D-10): the 429 arm only helps if a 429 from EACH venue read on the mark path
    survives ``read_marked_equity_usd``. Binance ``fetch_positions``, Bybit ``fetch_balance`` and
    ``/v5/account/info`` and both Binance options reads each used to turn it into a plain refusal
    (``positions_unreadable``, ``balance_error``, ``option_value_unreadable``) with no stamp."""
    venue = _MAKE[venue_name]()
    exc = ccxt.RateLimitExceeded("venue text that must not leak: sig=abc123")
    setattr(venue, method, AsyncMock(side_effect=exc))
    stamp = AsyncMock()
    db = FakeDb()
    result, capture, _combine = await _derive(
        db, venue, venue=venue_name,
        extra_patches=[patch("services.job_worker._stamp_429", new=stamp)],
    )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "balance_error"
    stamp.assert_awaited_once()
    assert stamp.await_args.args[2] is exc


@pytest.mark.asyncio
@pytest.mark.parametrize("refuse_unread_positions", [True, False], ids=["forced", "advisory"])
async def test_a_429_from_the_anchors_positions_read_reaches_the_reconstruct_crawl(
    refuse_unread_positions: bool,
) -> None:
    """The reconstruct path calls the same ``_fetch_current_equity``; its callers
    (``_fetch_and_price_window``'s two callers) both have a ``ccxt.RateLimitExceeded`` arm that
    stamps the cooldown, so the 429 must reach them in the forced and the advisory call, as the
    pricer's already does (review F3), not be logged away as an unreadable position book."""
    from services.equity_reconstruction import _fetch_current_equity

    venue = _binance()
    venue.fetch_positions = AsyncMock(side_effect=ccxt.RateLimitExceeded("429"))
    with pytest.raises(ccxt.RateLimitExceeded):
        await _fetch_current_equity(
            venue, "binance", refuse_unread_positions=refuse_unread_positions
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
async def test_stored_mark_skips_the_l4_read(venue_name: str) -> None:
    """W3 / D-16: the first derive of the closed day reads (one positions, one balance); a
    second derive of the same key and day finds the stored row and makes NO L4 call, and the
    stored row is what it keeps (Pitfall 1), even though its venue would now read differently."""
    db = FakeDb()
    first = _MAKE[venue_name]()
    await _derive(db, first, venue=venue_name)
    # Bybit (plan 18) reads the account totals, so it makes no positions call at all.
    positions_calls = {"bybit": 0, "binance": 1}[venue_name]
    assert (first.fetch_positions_calls, first.fetch_balance_calls) == (positions_calls, 1)

    later = datetime(2026, 3, 2, 0, 50, 0, tzinfo=timezone.utc)
    second = _MAKE[venue_name](
        wallet={"USDT": 1000.0},
        positions=[{"symbol": "BTC/USDT:USDT", "contracts": 1, "unrealizedPnl": 60.0}],
        total_perp_upl="60",
    )
    result, capture, _combine = await _derive(db, second, venue=venue_name, now=later)
    assert result.outcome == DispatchOutcome.DONE
    assert second.fetch_positions_calls == 0
    assert second.fetch_balance_calls == 0
    assert second.account_info_calls == 0
    assert second.fetch_ticker_calls == []
    assert len(db.marks) == 1 and len(db.upserts) == 1, "no second write attempt either"
    echo = _key_inputs(capture)["nav_mark"]
    assert echo["nav_usd"] == 1025.0 and echo["open_pnl_usd"] == 25.0
    assert echo["marked_at"] == "2026-03-02T00:10:30+00:00"


@pytest.mark.asyncio
async def test_a_stored_row_of_another_day_does_not_skip_the_read() -> None:
    """The skip is per (key, closed day): yesterday's row must not suppress today's read."""
    db = FakeDb()
    await _derive(db, _bybit(), venue="bybit")
    next_day = datetime(2026, 3, 3, 0, 10, 30, tzinfo=timezone.utc)
    venue = _bybit()
    await _derive(db, venue, venue="bybit", now=next_day)
    assert venue.fetch_balance_calls == 1  # plan 18: Bybit's read is the balance totals
    assert sorted(day for (_k, day) in db.marks) == ["2026-03-01", "2026-03-02"]


class _SpyOkxVenue:
    """OKX's mark comes from the equity read the derive already makes, plus (plan 19, D-18,
    D-19) ONE option-positions read. That read answers "no options" and is recorded; this
    exchange fails the test on ANY other call, so an added OKX read cannot pass unnoticed."""

    def __init__(self) -> None:
        self.option_reads: list[Any] = []

    async def privateGetAccountPositions(self, params: Any = None) -> dict[str, Any]:  # noqa: N802
        self.option_reads.append(params)
        return {"data": []}

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"OKX mark path touched the venue: {name}")


def _l4_spies() -> tuple[AsyncMock, MagicMock, list[Any]]:
    wrapper = AsyncMock(return_value=(1.0, 0.0, 1.0))
    stored = MagicMock(return_value=None)
    return wrapper, stored, [
        patch("services.equity_reconstruction.read_marked_equity_usd", new=wrapper),
        patch("services.job_worker.read_stored_mark", new=stored),
    ]


@pytest.mark.asyncio
async def test_okx_deribit_mt5_sfox_make_no_added_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-02 / D-16: the L4 read is Bybit/Binance only, and the stored-mark pre-read is theirs and,
    since plan 19 (D-18, D-19), OKX's. OKX therefore makes exactly one option-positions read and
    one stored-mark read and never the L4 read; MT5, sFOX and Deribit touch neither spy. (Each
    derive is shown to have stored its mark, so the spies saw a derive that really ran.)"""
    from services.deribit_ingest import DeribitNativeAccountState
    from tests.test_mtm_single_key import (
        _apply as _drb_apply,
        _base_patches,
        _cash_series,
        _ctx as _drb_ctx,
        _ledger_meta,
        _report,
        _stub_native_ledger,
    )
    from tests.test_nav_marks_reads import _derive_mt5
    from tests.test_nav_marks_writer import route_marks
    from tests.test_sfox_reconstruct import (
        _apply as _sfox_apply,
        _bh_row,
        _sfox_branch_patches,
        _sfox_ctx,
    )

    # --- OKX (a venue object that fails on any call) ---
    wrapper, stored, spies = _l4_spies()
    db = FakeDb()
    okx_venue = _SpyOkxVenue()
    result, _capture, _combine = await _derive(
        db, okx_venue, venue="okx", derive_usdt=1050.0, extra_patches=spies,
    )
    assert result.outcome == DispatchOutcome.DONE and list(db.marks) == [(KEY, CLOSED_DAY)]
    assert wrapper.await_count == 0 and stored.call_count == 1
    assert okx_venue.option_reads == [{"instType": "OPTION"}]

    # --- MT5 ---
    wrapper, stored, spies = _l4_spies()
    db = FakeDb()
    with ExitStack() as stack:
        for p in spies:
            stack.enter_context(p)
        result, _capture = await _derive_mt5(
            monkeypatch, db, key_mode=True,
            account={"balance": 110500.0, "equity": 110600.0, "currency": "USD", "login": 123456},
        )
    assert result.outcome == DispatchOutcome.DONE and len(db.marks) == 1
    assert wrapper.await_count == 0 and stored.call_count == 0

    # --- sFOX ---
    monkeypatch.setenv("SFOX_ENABLED", "true")
    wrapper, stored, spies = _l4_spies()
    db = FakeDb()
    ctx, _capture = _sfox_ctx()
    route_marks(ctx, db)
    nav_rows = [_bh_row(d, v) for d, v in (
        ("2026-01-01", "1000"), ("2026-01-02", "1010"), ("2026-01-03", "1020"), ("2026-01-04", "1030"),
    )]
    patches = _sfox_branch_patches(ctx, bh_return=nav_rows, txn_return=[], key_mode=True)
    patches.append(patch("services.job_worker._utc_now", new=MagicMock(return_value=T_0010)))
    with _sfox_apply(patches + spies), patch(
        "services.basis_series.persist_basis_series", new=MagicMock()
    ):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-sfox"})
    assert result.outcome == DispatchOutcome.DONE and len(db.marks) == 1
    assert wrapper.await_count == 0 and stored.call_count == 0

    # --- Deribit ---
    wrapper, stored, spies = _l4_spies()
    db = FakeDb()
    ctx, _capture = _drb_ctx(strategy_row=None, key_mode=True)
    route_marks(ctx, db)
    state = DeribitNativeAccountState(
        native_equity={"BTC": 0.02}, native_upnl={"BTC": 0.001},
        collapsed_equity_usd=2000.0, collapsed_upnl_usd=120.0,
        balance_error=False, upnl_unreadable=False, native_options_value={},
        # D-21: the mark's open profit is NAV minus wallet at the read's own index.
        native_balance={"BTC": 0.0188}, index_usd_snapshot={"BTC": 100000.0},
    )
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=AsyncMock(return_value=(_stub_native_ledger(), _report(has_option_activity=False))),
        combine_mock=MagicMock(return_value=(_cash_series(), _ledger_meta())),
        state_spy=AsyncMock(return_value=state),
    ) + [patch("services.job_worker._utc_now", new=MagicMock(return_value=T_0010)), marks_not_applied()]
    with _drb_apply(patches + spies):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    assert result.outcome == DispatchOutcome.DONE and len(db.marks) == 1
    assert wrapper.await_count == 0 and stored.call_count == 0


@pytest.mark.asyncio
async def test_realized_series_is_unchanged_by_the_l4_read() -> None:
    """The derive's return series is computed from the realized-basis wallet figure and open
    uPnL wedge 0.0 and nothing the L4 read produced. The combine receives identical arguments
    whether the L4 read succeeded, was refused, or was skipped by a stored mark."""
    # 1. a successful read
    db_ok = FakeDb()
    _r, cap_ok, combine_ok = await _derive(db_ok, _bybit(), venue="bybit")
    # 2. a refused read (the balance read raised)
    db_bad = FakeDb()
    _r, cap_bad, combine_bad = await _derive(
        db_bad, _bybit(balance_raises=True), venue="bybit"
    )
    # 3. a skipped read (the day's mark already stored)
    db_skip = FakeDb()
    await _derive(db_skip, _bybit(), venue="bybit")
    skipped = _bybit()
    _r, cap_skip, combine_skip = await _derive(db_skip, skipped, venue="bybit")
    assert skipped.fetch_balance_calls == 0
    assert len(db_ok.marks) == 1 and db_bad.marks == {}

    def _args(m: MagicMock) -> Any:
        assert m.call_count == 1
        return m.call_args

    assert _args(combine_ok) == _args(combine_bad) == _args(combine_skip)
    assert _args(combine_ok).kwargs["account_balance"] == 1000.0  # the realized USDT wallet
    assert _args(combine_ok).kwargs["open_unrealized_usd"] == 0.0  # the structural wedge
    returns_ok = [u for u in cap_ok["upserts"] if u[0] == "csv_daily_returns"]
    returns_bad = [u for u in cap_bad["upserts"] if u[0] == "csv_daily_returns"]
    returns_skip = [u for u in cap_skip["upserts"] if u[0] == "csv_daily_returns"]
    # Plan 12: from the first stored mark the persisted key series is the MARKED series, so the
    # run that stored a mark and the run that skipped its read on that stored mark persist the
    # same rows. What the L4 read must not touch is the REALIZED series: every day before the
    # first mark is the combine's own value, identical to the run that stored no mark at all.
    assert returns_ok == returns_skip

    def _by_day(upserts: list[Any]) -> dict[str, float]:
        return {r["date"]: r["daily_return"] for r in upserts[0][1]}

    mark_day = next(iter(db_ok.marks))[1]
    realized_before = {d: v for d, v in _by_day(returns_bad).items() if d < mark_day}
    assert realized_before
    assert {d: v for d, v in _by_day(returns_ok).items() if d < mark_day} == realized_before


@pytest.mark.asyncio
async def test_the_derives_own_realized_read_is_called_exactly_as_before() -> None:
    """The mark path adds a read; it does not replace or re-sign the derive's own one."""
    spy = AsyncMock(return_value=(1000.0, False, 0.0, False))
    db = FakeDb()
    result, _capture, _combine = await _derive(
        db, _bybit(), venue="bybit",
        extra_patches=[patch("services.exchange.fetch_account_equity_and_upnl_usd", new=spy)],
    )
    assert result.outcome == DispatchOutcome.DONE
    assert spy.await_count == 1
    assert spy.await_args.args[1] == "bybit" and len(spy.await_args.args) == 2


# --------------------------------------------------------------------------------------
# The anchor's side channel
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_anchor_exposes_its_wallet_total_beside_its_unchanged_two_value_return() -> None:
    from services.equity_reconstruction import _fetch_current_equity

    out = await _fetch_current_equity(_bybit(), "bybit", refuse_unread_positions=True)
    assert len(out) == 2
    total, partial = out
    assert total == 1025.0
    assert partial.wallet_total_usd == 1000.0  # type: ignore[attr-defined]
    assert isinstance(partial, set) and not partial


@pytest.mark.asyncio
async def test_the_wrapper_maps_each_anchor_outcome_to_its_token() -> None:
    from services.equity_reconstruction import read_marked_equity_usd

    assert await read_marked_equity_usd(_bybit(), "bybit") == (1025.0, 25.0, 1000.0)
    assert await read_marked_equity_usd(_binance(), "binance") == (1025.0, 25.0, 1000.0)
    assert await read_marked_equity_usd(_binance(positions_raises=True), "binance") == "positions_unreadable"
    assert await read_marked_equity_usd(_bybit(balance_raises=True), "bybit") == "balance_error"
    assert (
        await read_marked_equity_usd(
            _bybit(wallet={"USDT": 1000.0, "BTC": 0.1}, ticker_fails=frozenset({"BTC"})), "bybit"
        )
        == "wallet_unpriced"
    )
    with pytest.raises(ValueError):
        await read_marked_equity_usd(_bybit(), "okx")


@pytest.mark.asyncio
async def test_the_venue_error_text_never_reaches_the_refusal_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Logs carry ids, tokens and counts only (the plan's rule)."""
    import logging

    db = FakeDb()
    venue = _bybit(balance_raises=True)
    with caplog.at_level(logging.DEBUG, logger="quantalyze.analytics.job_worker"):
        await _derive(db, venue, venue="bybit")
    mark_lines = [r.getMessage() for r in caplog.records if "nav mark refused" in r.getMessage()]
    # (The token itself is asserted through key_inputs elsewhere: a process-wide log redactor
    # another suite may have installed rewrites "token=..." in a message, so it is not asserted
    # on the text here.)
    assert len(mark_lines) == 1 and "venue=bybit" in mark_lines[0]
    assert "balance read failed" not in " ".join(mark_lines)


# --------------------------------------------------------------------------------------
# The dry-run call sequence plan 11 runs before the merge (read-only, writes nothing)
# --------------------------------------------------------------------------------------


async def _dry_run_one_key(exchange: Any, venue: str) -> Any:
    """EXACTLY the sequence plan 11's pre-merge dry run makes for one key, and the one the
    derive makes: the derive's own USDT wallet read, the anchor-style marked read, and
    ``build_mark_read`` on both. No ``write_nav_mark``, no database call."""
    from services.equity_reconstruction import read_marked_equity_usd
    from services.exchange import fetch_account_equity_and_upnl_usd
    from services.nav_marks import build_mark_read

    usdt_wallet, balance_error, _wedge, upnl_unreadable = await fetch_account_equity_and_upnl_usd(
        exchange, venue
    )
    marked = await read_marked_equity_usd(exchange, venue)
    return build_mark_read(
        venue=venue,
        marked_at=datetime.now(timezone.utc),
        equity=None,
        open_pnl=None,
        balance_error=balance_error,
        upnl_unreadable=upnl_unreadable,
        marked_equity=marked,
        usdt_wallet_usd=usdt_wallet,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
@pytest.mark.parametrize(
    "wallet,tickers,token",
    [
        ({"USDT": 1000.0}, {}, None),
        ({"USDT": 1000.0, "BTC": 0.1}, {"BTC": 60000.0}, "wallet_basis_mismatch"),
    ],
    ids=["markable", "mixed-basis"],
)
async def test_the_dry_run_sequence_reaches_the_verdict_the_derive_stores(
    venue_name: str, wallet: dict[str, float], tickers: dict[str, float], token: str | None
) -> None:
    """The operator's dry run and the derive must not be able to disagree: both run through the
    same three calls, so the dry run's verdict IS what the derive would store or refuse."""
    dry = await _dry_run_one_key(_MAKE[venue_name](wallet=wallet, tickers=tickers), venue_name)
    db = FakeDb()
    # The real derive-side wallet read is a USDT-only read over the same venue; reproduce it by
    # letting the derive use the real ``fetch_account_equity_and_upnl_usd`` on the fake venue.
    result, capture, _combine = await _derive(
        db, _MAKE[venue_name](wallet=wallet, tickers=tickers), venue=venue_name,
        extra_patches=[patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=_REAL_WALLET_READ,
        )],
    )
    assert result.outcome == DispatchOutcome.DONE
    if token is None:
        assert not isinstance(dry, str)
        assert db.marks[(KEY, CLOSED_DAY)]["nav_usd"] == dry.nav_usd == 1025.0
    else:
        assert dry == token and db.marks == {}
        assert _key_inputs(capture)["nav_mark_refusal"] == token


# --------------------------------------------------------------------------------------
# Review WR-06 / D-10: a Binance coin with no ticker is sized from its newest priced holdings row
# --------------------------------------------------------------------------------------

ALLOC = "alloc-1"


def _holdings(*rows: tuple[str, str, float, float], api_key: str = KEY) -> Any:
    """A supabase fake whose ``allocator_holdings`` holds ``(symbol, asof, quantity, mark_price)``
    rows of ``api_key`` (this key by default). ``mark_price`` 0 is the stored shape of a poll that
    could not price the coin."""
    from tests.test_equity_reconstruction import FakeSupabaseClient

    fake = FakeSupabaseClient()
    for symbol, asof, quantity, mark in rows:
        fake.store[("allocator_holdings", (ALLOC, "binance", symbol, asof))] = {
            "allocator_id": ALLOC, "api_key_id": api_key, "venue": "binance", "symbol": symbol,
            "asof": asof, "holding_type": "spot", "quantity": quantity, "mark_price": mark,
            "value_usd": quantity * mark,
        }
    return fake


async def _binance_mark(
    wallet: dict[str, float], fake: Any, api_key_ids: list[str] | None = None
) -> Any:
    from services.equity_reconstruction import read_marked_equity_usd

    return await read_marked_equity_usd(
        _binance(wallet=wallet, ticker_fails=frozenset(a for a in wallet if a != "USDT")),
        "binance", supabase=fake, allocator_id=ALLOC, api_key_ids=api_key_ids or [KEY],
    )


@pytest.mark.asyncio
async def test_a_dust_coin_with_no_ticker_does_not_refuse_the_mark() -> None:
    """WR-06 (founder D-10): DUST has no ticker, but its newest priced holdings row sizes it:
    5.0 x 0.01 = 0.05 USD, under DUST_FLOOR_SHARE (0.001) x the 1000.0 wallet = 1.0. The mark is
    the anchor's own reading of the priced wallet (1000.0) plus the 25.0 position profit."""
    fake = _holdings(("DUST", "2026-02-20", 5.0, 0.01), ("DUST", "2026-02-28", 5.0, 0.0))
    assert await _binance_mark({"USDT": 1000.0, "DUST": 5.0}, fake) == (1025.0, 25.0, 1000.0)


@pytest.mark.asyncio
async def test_a_coin_over_the_dust_floor_still_refuses_the_mark() -> None:
    """5000.0 x 0.01 = 50.0 USD against a 1.0 floor: a material balance is never dropped."""
    fake = _holdings(("DUST", "2026-02-20", 5000.0, 0.01))
    assert await _binance_mark({"USDT": 1000.0, "DUST": 5000.0}, fake) == "wallet_unpriced"


@pytest.mark.asyncio
async def test_a_never_priced_coin_still_refuses_the_mark() -> None:
    """Only a stored mark_price of 0 exists for DUST: it was never priced, so it cannot be sized."""
    fake = _holdings(("DUST", "2026-02-28", 5.0, 0.0))
    assert await _binance_mark({"USDT": 1000.0, "DUST": 5.0}, fake) == "wallet_unpriced"


@pytest.mark.asyncio
async def test_one_unsizable_coin_keeps_the_refusal_for_the_sized_one_too() -> None:
    """The set clears only when EVERY unpriced coin is sized: DUST is dust, GHOST was never priced."""
    fake = _holdings(("DUST", "2026-02-20", 5.0, 0.01))
    wallet = {"USDT": 1000.0, "DUST": 5.0, "GHOST": 1.0}
    assert await _binance_mark(wallet, fake) == "wallet_unpriced"


@pytest.mark.asyncio
async def test_the_summed_dust_is_judged_not_each_coin(caplog: pytest.LogCaptureFixture) -> None:
    """Two coins at 0.6 USD each are each under the 1.0 floor but 1.2 together are not."""
    fake = _holdings(("AAA", "2026-02-20", 6.0, 0.1), ("BBB", "2026-02-20", 6.0, 0.1))
    assert await _binance_mark({"USDT": 1000.0, "AAA": 6.0, "BBB": 6.0}, fake) == "wallet_unpriced"


@pytest.mark.asyncio
async def test_clearing_the_unpriced_set_is_logged_without_a_key_label(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    fake = _holdings(("DUST", "2026-02-20", 5.0, 0.01))
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction"):
        await _binance_mark({"USDT": 1000.0, "DUST": 5.0}, fake)
    lines = [r for r in caplog.records if "leave the unpriced set" in r.getMessage()]
    assert len(lines) == 1 and lines[0].levelno == logging.WARNING
    text = lines[0].getMessage()
    # T-13 (plan 15: never in a log line): the count of coins, no symbol and no USD size (0.05).
    assert "1 unpriced coin" in text
    assert "DUST" not in text and "0.05" not in text
    assert "api_key" not in text and KEY not in text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows,wallet,phrase",
    [
        # Only a stored mark_price of 0 exists for DUST: never priced.
        ([("DUST", "2026-02-28", 5.0, 0.0)], {"USDT": 1000.0, "DUST": 5.0}, "never priced"),
        # 5000.0 x 0.01 = 50.0 USD against a 1.0 floor.
        ([("DUST", "2026-02-20", 5000.0, 0.01)], {"USDT": 1000.0, "DUST": 5000.0}, "above dust floor"),
    ],
    ids=["never-priced", "above-floor"],
)
async def test_a_coin_that_stays_named_says_why_in_one_warning(
    rows: list[tuple[str, str, float, float]], wallet: dict[str, float], phrase: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """SFH MEDIUM-low: the two silent refusals of the dust check each leave one WARNING that gives
    the count of unpriced coins and the reason, and no key. T-13 (plan 15: never in a log line):
    no coin symbol and no USD figure (50.0, 1000.0) in either."""
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction"):
        assert await _binance_mark(wallet, _holdings(*rows)) == "wallet_unpriced"
    lines = [r.getMessage() for r in caplog.records if "_drop_binance_dust_unpriced" in r.getMessage()]
    assert len(lines) == 1 and phrase in lines[0] and "1 unpriced coin" in lines[0], caplog.text
    assert "DUST" not in lines[0] and not re.search(r"\d+\.\d", lines[0]), lines[0]
    assert KEY not in lines[0] and "api_key" not in lines[0]


@pytest.mark.asyncio
async def test_a_coin_absent_from_the_held_quantities_is_not_sized_as_zero() -> None:
    """``held.get(symbol, 0.0)`` sized a coin the wallet does not list as 0.0 USD, which is dust,
    and cleared it. A coin with no quantity cannot be sized: the set is left as it was."""
    from services.equity_reconstruction import _drop_binance_dust_unpriced

    partial = {"GHOST"}
    await _drop_binance_dust_unpriced(
        partial, {"USDT": 1000.0}, 1000.0, _holdings(("GHOST", "2026-02-20", 1.0, 0.01)), ALLOC, [KEY],
    )
    assert partial == {"GHOST"}


@pytest.mark.asyncio
async def test_a_key_row_without_an_owner_is_refused_not_sized_from_no_allocator() -> None:
    """The derive reads ``key_row["user_id"]`` (the owner-coherence rule); the mark read does the
    same. ``.get`` handed ``None`` on to the read, which silently skipped the sizing."""
    import services.job_worker as jw

    ctx = MagicMock()
    ctx.key_row = {"id": KEY, "exchange": "binance"}
    spy = AsyncMock(return_value=(1.0, 0.0, 1.0))
    with (
        patch("services.job_worker.read_stored_mark", new=MagicMock(return_value=None)),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.equity_reconstruction.read_marked_equity_usd", new=spy),
    ):
        _stored, read, _at = await jw._read_marked_equity_once_per_day(ctx, "binance")
    assert read == "positions_unreadable"
    spy.assert_not_called()


@pytest.mark.asyncio
async def test_a_failing_holdings_read_keeps_the_coin_named_and_says_so(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """SFH MEDIUM-1: a database error in the sizing read is not a venue balance failure. It must
    not reach ``_fetch_current_equity``'s catch-all (which would refuse the mark as
    ``balance_error``): the coins stay named, so the mark refuses ``wallet_unpriced``, and one
    WARNING names the exception class and the count of coins, never a key or a coin symbol
    (T-13, plan 15)."""
    fake = _holdings(("DUST", "2026-02-20", 5.0, 0.01))

    def _table(name: str) -> Any:
        raise RuntimeError("holdings read failed: key-1")

    fake.table = _table  # type: ignore[method-assign]
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction"):
        assert await _binance_mark({"USDT": 1000.0, "DUST": 5.0}, fake) == "wallet_unpriced"
    lines = [r.getMessage() for r in caplog.records if "holdings read failed" in r.getMessage()]
    assert len(lines) == 1 and "RuntimeError" in lines[0], caplog.text
    assert "1 unpriced coin" in lines[0] and "DUST" not in lines[0], lines[0]
    assert KEY not in lines[0] and "api_key" not in lines[0]


@pytest.mark.asyncio
async def test_the_derive_hands_its_database_and_key_to_the_mark_read() -> None:
    """The call site: without the client, the allocator and the key id the read cannot size."""
    spy = AsyncMock(return_value="wallet_unpriced")
    owner = _owner_keys(
        {"id": KEY, "account_share_kind": None, "account_shared_with_api_key_id": None},
    )
    result, _capture, _combine = await _derive(
        FakeDb(), _binance(), venue="binance", owner_tables=owner,
        extra_patches=[patch("services.equity_reconstruction.read_marked_equity_usd", new=spy)],
    )
    assert result.outcome == DispatchOutcome.DONE
    kwargs = spy.await_args.kwargs
    assert kwargs["allocator_id"] == "alloc-1" and kwargs["api_key_ids"] == [KEY]
    assert kwargs["supabase"] is not None


SIBLING = "key-0"


def _owner_keys(*rows: dict[str, Any], holdings: Any = None) -> Any:
    """A FakeSupabaseClient holding the owner's ``api_keys`` rows (plus ``holdings``' rows)."""
    fake = holdings if holdings is not None else _holdings()
    for row in rows:
        fake.store[("api_keys", (row["id"],))] = {"user_id": ALLOC, **row}
    return fake


@pytest.mark.asyncio
async def test_a_rotated_keys_dust_is_sized_through_its_account_groups_sibling_row(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """WR-07 (D-10 "the refresh's source"): the refresh sizes a balance across the whole account
    group, so a key re-added to an account whose coin lost its ticker before the new key's first
    poll must size it through the sibling key's priced row, as the refresh does. DUST is held
    through the sibling (5.0 x 0.01 = 0.05 USD, under the 1.0 floor): the mark is the anchor's
    reading, and the log line names no key."""
    owner = _owner_keys(
        {"id": KEY, "account_share_kind": "duplicate", "account_shared_with_api_key_id": SIBLING},
        {"id": SIBLING, "account_share_kind": None, "account_shared_with_api_key_id": None},
        holdings=_holdings(("DUST", "2026-02-20", 5.0, 0.01), api_key=SIBLING),
    )
    db = FakeDb()
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction"):
        result, _capture, _combine = await _derive(
            db, _binance(wallet={"USDT": 1000.0, "DUST": 5.0}, ticker_fails=frozenset({"DUST"})),
            venue="binance", owner_tables=owner,
        )
    assert result.outcome == DispatchOutcome.DONE
    row = db.marks[(KEY, CLOSED_DAY)]
    assert row["nav_usd"] == 1025.0 and row["open_pnl_usd"] == 25.0
    cleared = [r.getMessage() for r in caplog.records if "leave the unpriced set" in r.getMessage()]
    assert len(cleared) == 1 and SIBLING not in cleared[0] and KEY not in cleared[0]


@pytest.mark.asyncio
async def test_a_key_outside_the_account_group_does_not_size_the_coin() -> None:
    """The group is the account, not the allocator: a priced row held through an UNRELATED key of
    the same owner (no share marker) sizes nothing, so DUST stays unpriced and the mark refuses."""
    owner = _owner_keys(
        {"id": KEY, "account_share_kind": None, "account_shared_with_api_key_id": None},
        {"id": SIBLING, "account_share_kind": None, "account_shared_with_api_key_id": None},
        holdings=_holdings(("DUST", "2026-02-20", 5.0, 0.01), api_key=SIBLING),
    )
    db = FakeDb()
    result, capture, _combine = await _derive(
        db, _binance(wallet={"USDT": 1000.0, "DUST": 5.0}, ticker_fails=frozenset({"DUST"})),
        venue="binance", owner_tables=owner,
    )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "wallet_unpriced"


def _stale_here_fresh_at_the_sibling() -> Any:
    """DUST is priced at 0.01 in THIS key's old row (5.0 x 0.01 = 0.05, under the 1.0 floor) and at
    1.0 in the SIBLING's newer row (5.0 x 1.0 = 5.0, over it). Sized from this key alone the coin
    reads as dust and is dropped from a write-once mark; sized across the account group it does
    not."""
    fake = _holdings(("DUST", "2026-02-10", 5.0, 0.01))
    fake.store[("allocator_holdings", (ALLOC, "binance", "DUST", "2026-02-20"))] = {
        "allocator_id": ALLOC, "api_key_id": SIBLING, "venue": "binance", "symbol": "DUST",
        "asof": "2026-02-20", "holding_type": "spot", "quantity": 5.0, "mark_price": 1.0,
        "value_usd": 5.0,
    }
    return fake


@pytest.mark.asyncio
async def test_an_unreadable_account_group_skips_the_dust_check_instead_of_sizing_from_this_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Final fixer round, SFH MEDIUM-1: when the owner's keys cannot be read the group is UNKNOWN,
    not narrowed to this key. The mark is write-once, so sizing DUST from this key's stale 0.01
    row would store a mark with an unpriced coin dropped. The dust check is skipped, the mark
    refuses ``wallet_unpriced``, and one WARNING says so with the exception class and the venue,
    no key id."""
    owner = _owner_keys(
        {"id": KEY, "account_share_kind": "duplicate", "account_shared_with_api_key_id": SIBLING},
        {"id": SIBLING, "account_share_kind": None, "account_shared_with_api_key_id": None},
        holdings=_stale_here_fresh_at_the_sibling(),
    )
    real_table = owner.table

    def _table(name: str) -> Any:
        if name == "api_keys":
            raise RuntimeError("api_keys read failed: key-1")
        return real_table(name)

    owner.table = _table  # type: ignore[method-assign]
    db = FakeDb()
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result, capture, _combine = await _derive(
            db, _binance(wallet={"USDT": 1000.0, "DUST": 5.0}, ticker_fails=frozenset({"DUST"})),
            venue="binance", owner_tables=owner,
        )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "wallet_unpriced"
    lines = [r.getMessage() for r in caplog.records if "account group" in r.getMessage()]
    assert len(lines) == 1 and "RuntimeError" in lines[0] and "binance" in lines[0], caplog.text
    assert KEY not in lines[0] and "api_key=" not in lines[0]


@pytest.mark.asyncio
async def test_a_key_in_no_account_group_skips_the_dust_check_and_says_so(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Final fixer round, SFH MEDIUM-1: the owner's keys read fine but none of the groups holds this
    key (a deleted or foreign row). That is an unknown group too, not this key alone: the dust
    check is skipped, the mark refuses ``wallet_unpriced``, and one WARNING names the venue only."""
    owner = _owner_keys(
        {"id": SIBLING, "account_share_kind": None, "account_shared_with_api_key_id": None},
        holdings=_stale_here_fresh_at_the_sibling(),
    )
    db = FakeDb()
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result, capture, _combine = await _derive(
            db, _binance(wallet={"USDT": 1000.0, "DUST": 5.0}, ticker_fails=frozenset({"DUST"})),
            venue="binance", owner_tables=owner,
        )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "wallet_unpriced"
    lines = [r.getMessage() for r in caplog.records if "no account group" in r.getMessage()]
    assert len(lines) == 1 and "binance" in lines[0], caplog.text
    assert KEY not in lines[0] and "api_key=" not in lines[0]


@pytest.mark.asyncio
async def test_bybit_does_not_read_the_account_group() -> None:
    """Final fixer round, SFH MEDIUM-1: only Binance sizes a coin across the group (Bybit's mark is
    the UTA's own totals), so a Bybit derive neither reads ``api_keys`` for it nor hands the read a
    group."""
    owner = _owner_keys()
    touched: list[str] = []
    real_table = owner.table

    def _table(name: str) -> Any:
        touched.append(name)
        return real_table(name)

    owner.table = _table  # type: ignore[method-assign]
    spy = AsyncMock(return_value="wallet_unpriced")
    result, _capture, _combine = await _derive(
        FakeDb(), _bybit(), venue="bybit", owner_tables=owner,
        extra_patches=[patch("services.equity_reconstruction.read_marked_equity_usd", new=spy)],
    )
    assert result.outcome == DispatchOutcome.DONE
    assert "api_keys" not in touched
    assert spy.await_args.kwargs["api_key_ids"] is None
