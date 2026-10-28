"""Phase 167.2.1.1.1.1 MARKSOURCE plan 06 - the two allocator curves agree on a book with open positions (SC-2, D-01).

What this pins, and why each case can fail
------------------------------------------
D-01 (founder 2026-10-27, "Keep both, align them"): *a cross-curve test proves agreement within
max($1, 0.5% of level) on marked non-Deribit days.* The allocator has two curves. The legacy
curve is one ``allocator_equity_snapshots`` row per day, written by the refresh from the
holdings the poll stored. The derived curve is the compose over the key derive's marked series.
Both claim to be the account's equity on the day that closed, and before this phase they did not
agree on a book with an open position (RESEARCH R-1: OKX's ``eq`` already contains the open
profit the derivative row carries, so the legacy level counted it twice).

How: ONE hand-typed venue state per marked day D drives BOTH real pipelines.

* Legacy leg: the typed venue payload goes through the real poll
  (``fetch_allocator_holdings``, with ccxt's REAL balance parser for OKX and Bybit), the rows it
  returns are stored as the holdings of the READ day D + 1, and the real
  ``run_refresh_allocator_equity_daily_job`` runs just after midnight of D + 1. It labels its
  one row ``mark_day_for(now)`` = D (plan 05), which is the row compared.
* Derived leg: the SAME typed payload gives the venue's own equity through the real reader
  (OKX ``fetch_account_equity_and_upnl_usd`` over ``totalEq`` / ``upl``; Bybit and Binance
  ``read_marked_equity_usd``), that figure is the stored NAV mark of D, the real key derive
  (``derive_key_ccxt``, ``derive_mt5_key``, ``derive_sfox_key``) persists the marked series, and
  the real compose (``compose_curve``) draws the level. The stored mark is the AUTHORITY: the
  roundtrip module already proves the compose reproduces each mark, and this module re-asserts
  it so a compose that drifted would fail here too.

For every marked non-Deribit day D::

    abs(legacy(D) - derived(D)) <= max(TOLERANCE_USD, TOLERANCE_REL * derived(D))

``TOLERANCE_USD`` and ``TOLERANCE_REL`` are typed ONCE, below.

Every expected level is typed beside the sum it comes from (the roundtrip module's convention),
and nothing is read back from the code under test. The typed figures put each venue family's
failure above the tolerance, so a leg that broke is RED and not hidden inside it: the OKX open
profit (5000 on a 137000 level) is far above 0.5%, which is what turns the ``eq`` double count
(drill D-N8) into a failure; the cassette's own 0.21% open profit would have hidden it.

HONEST SCOPE (RESEARCH A4). Both legs read the SAME typed prices, so this module proves RULE
agreement: the two curves apply one valuation rule to one venue state. It does NOT prove
agreement under clock skew. In PROD the poll and the mark read are minutes to about 90 minutes
apart, and a volatile book can move more than 0.5% in that time; that skew is measured by the
PROD readout (plan 08), not here. The mark WRITER's own refusals (a Bybit wallet outside the
derive's USDT figure, an unpriced asset) are plans 15 and 18's business: on a day the writer
refuses there is no stored mark and the day is not a marked day, so it is not compared.

The stated exclusions (D-01, D-06, D-08: days before ``marks_since``, Deribit, no stored mark, a
refused mark, a held price-gap day, the connect-day row, a dust or unsizable gap, an MT5 BTC
account with no close, sFOX non-stable balances) are asserted by name in the nine
``test_excluded_*`` tests at the end of this module (plan 16), and the runbook's "What the legacy
curve leaves out" table cites those same nine names.
"""
from __future__ import annotations

import copy
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import allocator_positions as ap
from services import price_rule
from services.allocator_positions import (
    SFOX_UNPRICED_ASSETS_NOTE,
    fetch_allocator_holdings,
    persist_native_unpriced_marker,
)
from services.equity_reconstruction import read_marked_equity_usd
from services.exchange import fetch_account_equity_and_upnl_usd
from services.job_worker import DispatchOutcome
from tests import test_refresh_allocator_equity_carry_forward as carry
from tests.test_allocator_positions import (
    _okx_balance_payload,
    _okx_detail,
    real_okx_parse_balance,
)
from tests.test_allocator_positions_non_ccxt import (  # noqa: F401  (autouse: resets the terminal locks)
    API_KEY_ID,
    _account,
    _reset_terminal_locks,
    _RecordingMt5Transport,
    _session,
    _SpecConstrainedSfoxClient,
)
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
)
from tests.test_nav_marks_compose_roundtrip import (
    BTC_CLOSE,
    BTC_MARKS_NATIVE,
    BTC_WALLET_NATIVE,
    KEY,
    KEY_MT5,
    KEY_SFOX,
    MT5_ACCOUNT,
    SFOX_MARKS,
    KeyDb,
    _mt5_deals_with,
    btc_closes,
    compose_curve,
    derive_key_ccxt,
    derive_mt5_key,
    derive_sfox_key,
    levels,
    realized_levels,
    seed_okx_marks,
)
from tests.test_nav_marks_derive_apply import REALIZED_THROUGH_0305, at_0010, seed_mark, series
from tests.test_nav_marks_l4_read import FakeVenue
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    _real_marks_writer,
)
from tests.test_upnl_venues import bybit_coin, real_bybit_parse_balance
from tests.test_upnl_venues_binance import real_binance_parse_balance

# --------------------------------------------------------------------------------------
# The tolerance, typed ONCE (D-01)
# --------------------------------------------------------------------------------------

TOLERANCE_USD = 1.0
TOLERANCE_REL = 0.005


def agree(legacy: float, derived: float) -> bool:
    """D-01: the two curves agree on a marked day within ``max($1, 0.5% of the level)``. The
    level is the derived one, the stored mark being the authority."""
    return abs(legacy - derived) <= max(TOLERANCE_USD, TOLERANCE_REL * derived)


def assert_curves_agree(case: str, legacy: dict[str, float], derived: dict[str, float]) -> None:
    """SC-2 on every marked day of ``derived``; a day the legacy curve lacks is a failure."""
    assert set(derived) <= set(legacy), (
        f"{case}: the legacy curve has no row for {sorted(set(derived) - set(legacy))}"
    )
    for day in sorted(derived):
        assert agree(legacy[day], derived[day]), (
            f"{case} {day}: legacy {legacy[day]} against derived {derived[day]} is outside "
            f"max({TOLERANCE_USD}, {TOLERANCE_REL} x {derived[day]}) = "
            f"{max(TOLERANCE_USD, TOLERANCE_REL * derived[day])}"
        )


# --------------------------------------------------------------------------------------
# The legacy leg: poll rows -> holdings of the READ day -> the real refresh -> the snapshot
# --------------------------------------------------------------------------------------


def store_polled(
    fake: FakeSupabaseClient, key_id: str, day: str, rows: list[dict[str, Any]]
) -> None:
    """Store the rows the poll returned for the read made after day ``day`` closed, as the
    holdings of the READ day ``day`` + 1 (``allocator_holdings.asof`` is the poll day)."""
    read_day = date.fromisoformat(day) + timedelta(days=1)
    for row in rows:
        carry._seed_holding(
            fake, key_id, row["venue"], row["symbol"], read_day, row["value_usd"],
            holding_type=row["holding_type"],
            unrealized_pnl_usd=row["unrealized_pnl_usd"],
            quantity=row["quantity"], mark_price=row["mark_price"],
        )


async def run_legacy_refresh(
    monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, day: str
) -> Any:
    """The real refresh at 01:30Z of ``day`` + 1, which labels its one row ``day`` (plan 05).
    ``carry._run_refresh`` reads the module constant ``TODAY``, which is moved to the read day
    rather than the helper being copied. Returns the audit mock."""
    monkeypatch.setattr(carry, "TODAY", date.fromisoformat(day) + timedelta(days=1))
    return await carry._run_refresh(monkeypatch, fake, API_KEY_ID_1, run_at=(1, 30))


def snapshot_rows(fake: FakeSupabaseClient, day: str) -> list[dict[str, Any]]:
    """The legacy rows the refresh stored for the label ``day``."""
    return [r for r in fake.rows_for("allocator_equity_snapshots") if r["asof"] == day]


async def legacy_levels(
    monkeypatch: pytest.MonkeyPatch, polled: dict[str, list[dict[str, Any]]],
    fake: FakeSupabaseClient | None = None,
) -> dict[str, float]:
    """The legacy curve over the marked days in ``polled``.

    ``polled[D]`` is what the real poll returned for the read made after day D closed. Those
    rows are stored as the holdings of D + 1 (``allocator_holdings.asof`` is the poll day), and
    the real refresh runs at 01:30Z of D + 1, so its one row is labelled D (plan 05). The store
    is shared across the days, so a later day's refresh also sees the earlier snapshot, as in
    production. ``fake`` (plan 16) lets a caller seed the store beforehand and read the stored
    rows, the breakdown record included, afterwards.
    """
    fake = fake if fake is not None else FakeSupabaseClient()
    carry._seed_key(fake, API_KEY_ID_1)
    out: dict[str, float] = {}
    for day in sorted(polled):
        store_polled(fake, API_KEY_ID_1, day, polled[day])
        await run_legacy_refresh(monkeypatch, fake, day)
        rows = snapshot_rows(fake, day)
        assert len(rows) == 1, f"the refresh labelled {len(rows)} rows {day}, expected one"
        out[day] = float(rows[0]["value_usd"])
    return out


# --------------------------------------------------------------------------------------
# Case 1 (the tracer): OKX with an open USDT perp - RESEARCH R-1
# --------------------------------------------------------------------------------------

#: Two adjacent marked days right after the realized series ends (03-05), so no unmarked day
#: sits between the realized terminal and the first mark. The derive runs at 00:10Z on 03-08
#: and labels 03-07.
OKX_D1 = "2026-03-06"
OKX_D2 = "2026-03-07"
OKX_DERIVE_DAY = "2026-03-08"

#: One USDT-margined BTC perp, long 0.5 from an entry of 52000.0 (invented round numbers in the
#: shape of an OKX balance and position).
OKX_PERP_SIZE = 0.5
OKX_PERP_ENTRY = 52_000.0

#: day -> (USDT cashBal, BTC cashBal, BTC/USDT last). Open profit is OKX's ``upl``.
#:   03-06: perp 0.5 x (60000 - 52000) = 4000;  totalEq = 100000 + 0.5 x 60000 + 4000 = 134000
#:   03-07: perp 0.5 x (62000 - 52000) = 5000;  totalEq = 101000 + 0.5 x 62000 + 5000 = 137000
#:   03-05 (plan 16, the day BEFORE the first mark): the same book as 03-06, the realized series'
#:        last day, so its derived level is the realized roll and carries no open profit
OKX_PRESTART = "2026-03-05"
OKX_STATE = {
    OKX_PRESTART: {
        "usdt": "100000", "btc": "0.5", "last": 60_000.0, "upl": "4000", "total_eq": "134000",
    },
    OKX_D1: {"usdt": "100000", "btc": "0.5", "last": 60_000.0, "upl": "4000", "total_eq": "134000"},
    OKX_D2: {"usdt": "101000", "btc": "0.5", "last": 62_000.0, "upl": "5000", "total_eq": "137000"},
}
#: The venue's own equity on each marked day (the typed ``totalEq`` as a number) and the value
#: the ``eq`` double count would have given (equity + the open profit counted a second time).
OKX_EXPECTED = {OKX_D1: 134_000.0, OKX_D2: 137_000.0}
OKX_DOUBLE_COUNTED = {OKX_D1: 138_000.0, OKX_D2: 142_000.0}


def okx_payload(day: str) -> dict[str, Any]:
    """The typed OKX ``/api/v5/account/balance`` response of one read. ``eq = cashBal + upl``
    per currency, and the account carries ``totalEq`` and ``upl`` beside the details, which is
    where the real equity reader looks."""
    s = OKX_STATE[day]
    payload = _okx_balance_payload([
        _okx_detail("USDT", cash_bal=s["usdt"], upl=s["upl"],
                    eq=str(float(s["usdt"]) + float(s["upl"]))),
        _okx_detail("BTC", cash_bal=s["btc"], upl="0", eq=s["btc"]),
    ])
    payload["data"][0]["totalEq"] = s["total_eq"]
    payload["data"][0]["upl"] = s["upl"]
    return payload


def okx_perp(day: str) -> list[dict[str, Any]]:
    """The one open perp as ``fetch_positions`` normalises it."""
    last = OKX_STATE[day]["last"]
    return [{
        "symbol": "BTCUSDT", "side": "long", "size_base": OKX_PERP_SIZE,
        "size_usd": OKX_PERP_SIZE * last, "entry_price": OKX_PERP_ENTRY, "mark_price": last,
        "unrealized_pnl": OKX_PERP_SIZE * (last - OKX_PERP_ENTRY), "exchange": "okx",
    }]


async def okx_polled_rows(
    monkeypatch: pytest.MonkeyPatch, day: str
) -> list[dict[str, Any]]:
    """What the real poll returns for the OKX read of ``day``: ccxt's REAL parser on the typed
    payload serves ``fetch_balance``, the ticker and the position come from the same state."""
    parsed = await real_okx_parse_balance(okx_payload(day))
    exchange = AsyncMock()
    exchange.id = "okx"
    exchange.fetch_balance = AsyncMock(return_value=parsed)
    exchange.fetch_tickers = AsyncMock(return_value={"BTC/USDT": {"last": OKX_STATE[day]["last"]}})

    async def _perp(*_a: Any, **_kw: Any) -> list[dict[str, Any]]:
        return okx_perp(day)

    monkeypatch.setattr(ap, "fetch_positions", _perp)
    rows, warning = await fetch_allocator_holdings("okx", exchange)
    assert warning is None
    return rows


async def okx_equity_read(day: str) -> tuple[float, float]:
    """The venue's equity and open profit for ``day`` through the REAL OKX reader
    (``totalEq`` / ``upl`` of ``private_get_account_balance``), over the SAME typed payload the
    poll parses."""
    exchange = AsyncMock()
    exchange.private_get_account_balance = AsyncMock(return_value=copy.deepcopy(okx_payload(day)))
    equity, balance_error, upl, unreadable = await fetch_account_equity_and_upnl_usd(
        exchange, "okx"
    )
    assert equity is not None and not balance_error and not unreadable
    return equity, upl


async def okx_derived_curve() -> dict[str, float]:
    """The whole derived curve: the earlier mark is stored from the real reader's figures, and the
    later one is written by the real key derive at 00:10Z from its own read of the same kind,
    then the real compose draws every level, the days before the first mark included."""
    db = KeyDb()
    equity_1, upl_1 = await okx_equity_read(OKX_D1)
    seed_mark(db, OKX_D1, equity_1, key=KEY, open_pnl=upl_1, venue="okx")
    equity_2, upl_2 = await okx_equity_read(OKX_D2)
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010(OKX_DERIVE_DAY),
        equity=equity_2, upl=upl_2, flows=[],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks[(KEY, OKX_D2)]["nav_usd"] == equity_2, "the derive stored its own read"
    return levels(await compose_curve(db, capture))


async def okx_derived_levels() -> dict[str, float]:
    """The derived level of each marked day (the curve without its days before the first mark)."""
    curve = await okx_derived_curve()
    return {day: curve[day] for day in (OKX_D1, OKX_D2)}


@pytest.mark.asyncio
async def test_cross_curve_okx_open_perp(monkeypatch: pytest.MonkeyPatch) -> None:
    """SC-2, RESEARCH R-1, drill D-N8. An OKX account with an open perp whose open profit is far
    above 0.5% of the level (4000 on 134000 and 5000 on 137000, against tolerances of 670 and
    685). The venue's equity is totalEq, wallet and open profit once:
      03-06: 100000 + 0.5 x 60000 + 4000 = 134000
      03-07: 101000 + 0.5 x 62000 + 5000 = 137000
    The legacy leg must land on those, not on the double-counted 138000 and 142000 that ccxt's
    ``eq`` (= cashBal + upl) gave when the poll read the USDT row from it and the derivative row
    added the same open profit again."""
    polled = {day: await okx_polled_rows(monkeypatch, day) for day in (OKX_D1, OKX_D2)}
    legacy = await legacy_levels(monkeypatch, polled)
    derived = await okx_derived_levels()

    assert derived == pytest.approx(OKX_EXPECTED, abs=1e-6), "the stored mark is the typed totalEq"
    assert_curves_agree("okx", legacy, derived)
    for day in (OKX_D1, OKX_D2):
        assert legacy[day] != pytest.approx(OKX_DOUBLE_COUNTED[day], abs=1.0), (
            f"{day}: the legacy level is the double-counted one"
        )
        # The double count is above the tolerance, so a return of it cannot hide inside it.
        assert OKX_DOUBLE_COUNTED[day] - OKX_EXPECTED[day] > max(
            TOLERANCE_USD, TOLERANCE_REL * OKX_EXPECTED[day]
        )


# --------------------------------------------------------------------------------------
# The ccxt venues that are not OKX: one derived-leg helper
# --------------------------------------------------------------------------------------

CCXT_D1 = "2026-03-06"
CCXT_D2 = "2026-03-07"
CCXT_DERIVE_DAY = "2026-03-08"


async def stored_mark_levels(
    venue: str, marks: dict[str, tuple[float, float]], *, terminal: float,
) -> dict[str, float]:
    """The derived curve of a ccxt key whose marks are stored: ``marks[D] = (nav, open
    profit)`` from the real reader. Both days' marks exist before the derive runs, so it makes no
    marked-equity read of its own and anchors on the stored one (W3, W7). ``terminal`` is the
    derive's own wallet read, the level its realized series ends on; the compose still draws
    every marked day at its stored mark."""
    db = KeyDb()
    for day, (nav, open_pnl) in marks.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=open_pnl, venue=venue)
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010(CCXT_DERIVE_DAY),
        equity=terminal, upl=0.0, venue=venue, flows=[],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    curve = levels(await compose_curve(db, capture, venue=venue))
    return {day: curve[day] for day in marks}


def assert_marks_are_typed(
    case: str, derived: dict[str, float], expected: dict[str, float]
) -> None:
    """The stored mark is the authority: the compose level of each marked day is the typed venue
    equity, so the leg being compared is anchored on a figure written out by hand."""
    assert derived == pytest.approx(expected, abs=1e-6), f"{case}: the mark is not the typed equity"


# --------------------------------------------------------------------------------------
# Case 2: Bybit - wallet plus open profit against the account's own totalEquity
# --------------------------------------------------------------------------------------

#: day -> USDT walletBalance, BTC walletBalance, BTC/USDT last, perp open profit, and the
#: account totals Bybit reports. One USDT-margined BTC perp, long 0.2 from an entry of 52500.0.
#:   03-06: wallet 50000 + 0.2 x 60000 = 62000;  totalEquity = 62000 + 1500 = 63500
#:   03-07: wallet 50400 + 0.2 x 61000 = 62600;  totalEquity = 62600 + 1700 = 64300
#: The open profit is 0.2 x (60000 - 52500) = 1500 and 0.2 x (61000 - 52500) = 1700, both far
#: above 0.5% of the level (317.5 and 321.5).
BYBIT_STATE = {
    CCXT_D1: {"usdt": "50000", "btc": "0.2", "last": 60_000.0, "upl": "1500",
              "wallet": "62000", "equity": "63500"},
    CCXT_D2: {"usdt": "50400", "btc": "0.2", "last": 61_000.0, "upl": "1700",
              "wallet": "62600", "equity": "64300"},
}
BYBIT_EXPECTED = {CCXT_D1: 63_500.0, CCXT_D2: 64_300.0}
BYBIT_PERP_SIZE = 0.2
BYBIT_PERP_ENTRY = 52_500.0


def bybit_payload(day: str) -> dict[str, Any]:
    """The typed Bybit V5 wallet-balance response of one read. ``bybit_coin`` follows Bybit's
    ``equity = walletBalance + unrealisedPnl`` per coin; the account totals are typed, since
    the BTC wallet is priced at the ticker and no helper here may sum it as a bare quantity."""
    s = BYBIT_STATE[day]
    return {
        "retCode": 0, "retMsg": "OK", "time": 1672125441042,
        "result": {"list": [{
            "accountType": "UNIFIED", "totalEquity": s["equity"],
            "totalWalletBalance": s["wallet"], "totalMarginBalance": s["equity"],
            "totalPerpUPL": s["upl"],
            "coin": [bybit_coin("USDT", s["usdt"], s["upl"]), bybit_coin("BTC", s["btc"], "0")],
        }]},
    }


def linear_position(symbol: str, contracts: float, entry: float, mark: float) -> dict[str, Any]:
    """A ccxt-unified linear position, the shape ``fetch_positions()`` returns. The open profit
    is contracts x (mark - entry) of a long."""
    return {
        "symbol": symbol, "contracts": contracts, "contractSize": 1, "side": "long",
        "notional": contracts * mark, "entryPrice": entry, "markPrice": mark,
        "unrealizedPnl": contracts * (mark - entry),
    }


async def bybit_polled_rows(day: str) -> list[dict[str, Any]]:
    parsed = await real_bybit_parse_balance(bybit_payload(day))
    last = BYBIT_STATE[day]["last"]
    exchange = MagicMock()
    exchange.id = "bybit"
    exchange.fetch_balance = AsyncMock(return_value=copy.deepcopy(parsed))
    exchange.fetch_tickers = AsyncMock(return_value={"BTC/USDT": {"last": last}})
    exchange.fetch_positions = AsyncMock(
        return_value=[linear_position("BTC/USDT:USDT", BYBIT_PERP_SIZE, BYBIT_PERP_ENTRY, last)]
    )
    rows, warning = await fetch_allocator_holdings("bybit", exchange)
    assert warning is None
    return rows


async def bybit_mark(day: str) -> tuple[float, float]:
    """The Bybit mark of ``day`` through the REAL reader (``read_marked_equity_usd``): the
    venue's own totalEquity and the open profit as totalEquity less the wallet, over the SAME
    typed payload the poll parses."""
    payload = bybit_payload(day)
    parsed = await real_bybit_parse_balance(payload)
    venue = FakeVenue(
        wallet=parsed["total"], tickers={"BTC": BYBIT_STATE[day]["last"]},
        account_info={"unifiedMarginStatus": 5, "marginMode": "REGULAR_MARGIN"},
        uta_totals=payload["result"]["list"][0],
    )
    read = await read_marked_equity_usd(venue, "bybit")
    assert not isinstance(read, str), f"the Bybit reader refused the typed state: {read}"
    nav, open_pnl, _wallet = read
    return nav, open_pnl


@pytest.mark.asyncio
async def test_cross_curve_bybit_wallet_plus_open_profit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-2, drill D-N21. A Bybit unified account with wallet USDT and BTC and an open perp:
    the venue's equity is the wallet and the open profit once (63500 and 64300, typed above). The
    legacy leg sums the spot rows (walletBalance, through ccxt's real parser) and the derivative
    row's open profit; a refresh that stopped adding the derivative row's profit would read
    62000 and 62600, below the mark by far more than the tolerance."""
    polled = {day: await bybit_polled_rows(day) for day in BYBIT_STATE}
    legacy = await legacy_levels(monkeypatch, polled)
    marks = {day: await bybit_mark(day) for day in BYBIT_STATE}
    derived = await stored_mark_levels("bybit", marks, terminal=50_400.0)

    assert_marks_are_typed("bybit", derived, BYBIT_EXPECTED)
    assert_curves_agree("bybit", legacy, derived)


# --------------------------------------------------------------------------------------
# Case 3: Binance - spot wallet plus the futures position's open profit
# --------------------------------------------------------------------------------------

#: day -> the spot balances (free, locked), ETH/USDT last, and the BTC perp's open profit. The
#: spot total is free + locked, and the venue's equity the mark reads is that wallet at the
#: tickers plus the position's open profit (the reconstruct anchor's own rule, L4):
#:   03-06: USDT 15000 + 5000 = 20000, ETH 1.5 + 0.5 = 2 at 3000 = 6000, open profit 800
#:          -> 20000 + 6000 + 800 = 26800
#:   03-07: USDT 20000, ETH 2 at 3200 = 6400, open profit 900 -> 20000 + 6400 + 900 = 27300
#: The BTC perp is 0.1 long from an entry of 52000.0: 0.1 x (60000 - 52000) = 800 and
#: 0.1 x (61000 - 52000) = 900, above 0.5% of the level (134 and 136.5).
BINANCE_STATE = {
    CCXT_D1: {"eth_last": 3_000.0, "btc_mark": 60_000.0},
    CCXT_D2: {"eth_last": 3_200.0, "btc_mark": 61_000.0},
}
BINANCE_EXPECTED = {CCXT_D1: 26_800.0, CCXT_D2: 27_300.0}
BINANCE_PERP_SIZE = 0.1
BINANCE_PERP_ENTRY = 52_000.0
#: GET /api/v3/account (spot), identical on both days: the wallet does not change, the prices do.
BINANCE_SPOT_ACCOUNT = {
    "balances": [
        {"asset": "USDT", "free": "15000", "locked": "5000"},
        {"asset": "ETH", "free": "1.5", "locked": "0.5"},
    ],
}


async def binance_polled_rows(day: str) -> list[dict[str, Any]]:
    parsed = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    state = BINANCE_STATE[day]
    exchange = MagicMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value=copy.deepcopy(parsed))
    exchange.fetch_tickers = AsyncMock(return_value={"ETH/USDT": {"last": state["eth_last"]}})
    exchange.fetch_positions = AsyncMock(return_value=[
        linear_position("BTC/USDT:USDT", BINANCE_PERP_SIZE, BINANCE_PERP_ENTRY, state["btc_mark"])
    ])
    rows, warning = await fetch_allocator_holdings("binance", exchange)
    assert warning is None
    return rows


async def binance_mark(day: str) -> tuple[float, float]:
    """The Binance mark of ``day`` through the REAL reader: the anchor's own reading, every
    wallet asset at its ticker plus the summed position open profit, over the same parsed wallet
    and the same position the poll reads."""
    parsed = await real_binance_parse_balance(BINANCE_SPOT_ACCOUNT, "spot")
    state = BINANCE_STATE[day]
    venue = FakeVenue(
        wallet=parsed["total"], tickers={"ETH": state["eth_last"]},
        positions=[
            linear_position("BTC/USDT:USDT", BINANCE_PERP_SIZE, BINANCE_PERP_ENTRY,
                            state["btc_mark"])
        ],
    )
    read = await read_marked_equity_usd(venue, "binance")
    assert not isinstance(read, str), f"the Binance reader refused the typed state: {read}"
    nav, open_pnl, _wallet = read
    return nav, open_pnl


@pytest.mark.asyncio
async def test_cross_curve_binance_spot_and_position(monkeypatch: pytest.MonkeyPatch) -> None:
    """SC-2, drill D-N21. A Binance spot wallet (USDT and ETH) with a futures position: the
    equity is the wallet at the tickers plus the open profit, once (26800 and 27300, typed
    above). The legacy leg adds each derivative row's open profit to its spot rows; without it
    the legacy level is 26000 and 26400, below the mark by more than the tolerance."""
    polled = {day: await binance_polled_rows(day) for day in BINANCE_STATE}
    legacy = await legacy_levels(monkeypatch, polled)
    marks = {day: await binance_mark(day) for day in BINANCE_STATE}
    derived = await stored_mark_levels("binance", marks, terminal=20_000.0)

    assert_marks_are_typed("binance", derived, BINANCE_EXPECTED)
    assert_curves_agree("binance", legacy, derived)


# --------------------------------------------------------------------------------------
# Case 4: MT5, USD account - the equity, with a floating profit above the tolerance
# --------------------------------------------------------------------------------------

#: The account_info of each read: equity is balance plus the floating profit of open positions.
#:   10-06: balance 105500.0 + floating 3000.0 = equity 108500.0
#:   10-08: balance 110500.0 + floating 3100.0 = equity 113600.0 (after the 5000 deposit of 10-07)
#: The floating profit is above max(1.0, 0.5% x level) = 542.5 and 568.0, so a leg that read the
#: balance (dropping it) cannot agree. The balances are the deal ledger the derive rolls from:
#: 105500.0 on 10-06 and 110500.0 after the deposit.
MT5_USD_STATE = {
    "2026-10-06": {"equity": 108_500.0, "balance": 105_500.0},
    "2026-10-08": {"equity": 113_600.0, "balance": 110_500.0},
}
MT5_USD_EXPECTED = {"2026-10-06": 108_500.0, "2026-10-08": 113_600.0}


async def mt5_polled_rows(
    monkeypatch: pytest.MonkeyPatch, account: dict[str, Any],
) -> list[dict[str, Any]]:
    """What the real MT5 poll returns for one ``account_info`` (the real facade over a recording
    transport, the real terminal lock)."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(_RecordingMt5Transport(account=account)), API_KEY_ID
    )
    assert warning is None
    return rows


@pytest.mark.asyncio
async def test_cross_curve_mt5_usd(monkeypatch: pytest.MonkeyPatch) -> None:
    """SC-2, drill D-N22. An MT5 USD account whose open positions float 3000.0 and 3100.0 above
    the balance. Its one holdings row is the account's EQUITY (108500.0 and 113600.0), which is
    also the mark; reading the balance would drop the floating profit and sit 3000.0 and 3100.0
    below it."""
    polled = {
        day: await mt5_polled_rows(
            monkeypatch,
            _account(currency="USD", equity=state["equity"], balance=state["balance"]),
        )
        for day, state in MT5_USD_STATE.items()
    }
    legacy = await legacy_levels(monkeypatch, polled)

    db = KeyDb()
    for day, state in MT5_USD_STATE.items():
        seed_mark(
            db, day, state["equity"], key=KEY_MT5, venue="mt5",
            open_pnl=state["equity"] - state["balance"], native_unit="USD",
        )
    deals = _mt5_deals_with({(2026, 10, 7): 5000.0})
    result, capture = await derive_mt5_key(monkeypatch, db, account=MT5_ACCOUNT, deals=deals)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    curve = levels(await compose_curve(db, capture, key=KEY_MT5, venue="mt5"))
    derived = {day: curve[day] for day in MT5_USD_STATE}

    assert_marks_are_typed("mt5 usd", derived, MT5_USD_EXPECTED)
    assert_curves_agree("mt5 usd", legacy, derived)


# --------------------------------------------------------------------------------------
# Case 5: MT5, BTC account - the native balance at the closed day's stored close, both legs
# --------------------------------------------------------------------------------------

#: The native equity of each read and the stored close of the day that closed (a constant
#: 60000.0 over the whole range, ``btc_closes``). Both legs value the same native balance at that
#: close:
#:   10-05: 0.1090 BTC x 60000.0 = 6540.0
#:   10-08: 0.1115 BTC x 60000.0 = 6690.0
#: A leg that read the native balance as dollars sits at 0.109 and 0.1115, 6540.0 below.
MT5_BTC_EXPECTED = {"2026-10-05": 6_540.0, "2026-10-08": 6_690.0}


@pytest.mark.asyncio
async def test_cross_curve_mt5_btc(monkeypatch: pytest.MonkeyPatch) -> None:
    """SC-2, drill D-N23. An MT5 account denominated in BTC: the poll values the native equity at
    the stored close of the latest completed UTC day, and the stored mark prices the same native
    equity at the close of the mark day, which is that same day. Both land on the dollar value
    (6540.0 and 6690.0, typed above)."""
    assert BTC_MARKS_NATIVE["2026-10-05"] * BTC_CLOSE == pytest.approx(
        MT5_BTC_EXPECTED["2026-10-05"]
    )
    assert BTC_MARKS_NATIVE["2026-10-08"] * BTC_CLOSE == pytest.approx(
        MT5_BTC_EXPECTED["2026-10-08"]
    )
    closes = btc_closes()

    async def _closes() -> Any:
        return closes

    polled: dict[str, list[dict[str, Any]]] = {}
    for day, native in BTC_MARKS_NATIVE.items():
        read_at = datetime.fromisoformat(day).replace(tzinfo=timezone.utc) + timedelta(
            days=1, hours=12
        )
        monkeypatch.setattr(ap, "_utc_now", lambda read_at=read_at: read_at)
        monkeypatch.setattr(ap, "read_btc_closes", _closes)
        polled[day] = await mt5_polled_rows(
            monkeypatch,
            _account(currency="BTC", equity=native, balance=BTC_WALLET_NATIVE[day]),
        )
    legacy = await legacy_levels(monkeypatch, polled)

    db = KeyDb()
    for day, native in BTC_MARKS_NATIVE.items():
        seed_mark(
            db, day, native * BTC_CLOSE, key=KEY_MT5, venue="mt5",
            open_pnl=(native - BTC_WALLET_NATIVE[day]) * BTC_CLOSE,
            native_unit="BTC", nav_native=native,
            open_pnl_native=native - BTC_WALLET_NATIVE[day],
        )
    deals = _mt5_deals_with({(2026, 10, 6): 0.002}, scale=1e-6)
    account = {"equity": 0.1115, "balance": 0.1105, "currency": "BTC", "login": 123456}
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, closes=closes
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    curve = levels(await compose_curve(db, capture, key=KEY_MT5, venue="mt5"))
    derived = {day: curve[day] for day in BTC_MARKS_NATIVE}

    assert_marks_are_typed("mt5 btc", derived, MT5_BTC_EXPECTED)
    assert_curves_agree("mt5 btc", legacy, derived)


# --------------------------------------------------------------------------------------
# Case 6: sFOX - USD and stablecoin balances; the NAV has no open profit
# --------------------------------------------------------------------------------------

#: The balances of each read, a USD balance and a USDC balance (both worth 1.0 each), summing to
#: the account's NAV, which is the stored mark:
#:   03-03: USD 800.0 + USDC 245.0 = 1045.0
#:   03-05: USD 850.0 + USDC 260.0 = 1110.0
#: The USDC balance is above max(1.0, 0.5% x level) = 5.225 and 5.55, so a leg that stopped
#: valuing stablecoins cannot agree.
SFOX_STATE = {
    "2026-03-03": [("USD", "800.0"), ("USDC", "245.0")],
    "2026-03-05": [("USD", "850.0"), ("USDC", "260.0")],
}
SFOX_EXPECTED = {"2026-03-03": 1_045.0, "2026-03-05": 1_110.0}


@pytest.mark.asyncio
async def test_cross_curve_sfox_usd_balances(monkeypatch: pytest.MonkeyPatch) -> None:
    """SC-2, drill D-N24. An sFOX account holding USD and USDC: the NAV is the sum of both (1045.0
    and 1110.0, typed above), with no open profit. The poll values USD and every stablecoin at
    1.0; one that skipped USDC would read 800.0 and 850.0."""
    # The typed balances are the roundtrip scenario's two stored marks, written out by hand.
    assert SFOX_EXPECTED == SFOX_MARKS
    monkeypatch.setenv("SFOX_ENABLED", "true")
    polled: dict[str, list[dict[str, Any]]] = {}
    warnings: list[str | None] = []
    for day, balances in SFOX_STATE.items():
        client = _SpecConstrainedSfoxClient(
            balances=[{"currency": ccy, "balance": qty} for ccy, qty in balances]
        )
        polled[day], warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)
        warnings.append(warning)
    legacy = await legacy_levels(monkeypatch, polled)

    db = KeyDb()
    result, capture = await derive_sfox_key(monkeypatch, db)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    curve = levels(await compose_curve(db, capture, key=KEY_SFOX, venue="sfox"))
    derived = {day: curve[day] for day in SFOX_STATE}

    assert_marks_are_typed("sfox", derived, SFOX_EXPECTED)
    assert_curves_agree("sfox", legacy, derived)
    # Judged AFTER the curves: a poll that skipped a balance names it in a warning, but it is the
    # level the legacy curve then lacks that this case exists to catch.
    assert warnings == [None, None], "every balance of the typed book is priced"


# --------------------------------------------------------------------------------------
# The stated exclusions (plan 16: D-01, D-06, D-08). Each is a test that ASSERTS the
# exclusion, so a day or balance the claim above does not cover is named, never skipped.
# --------------------------------------------------------------------------------------

#: A Binance spot account holding 100000.0 of USDT and ONE unit of a token whose ticker the
#: poll can sometimes not read (invented round numbers in the shape of ``GET /api/v3/account``).
#: The venue's own equity values the token at its last price, the poll's gap row does not.
GAP_ASSET = "XYZ"
GAP_USDT = 100_000.0
GAP_QUANTITY = 1.0
GAP_SPOT_ACCOUNT = {
    "balances": [
        {"asset": "USDT", "free": "100000", "locked": "0"},
        {"asset": GAP_ASSET, "free": "1", "locked": "0"},
    ],
}


async def gap_polled_rows(xyz_last: float | None) -> tuple[list[dict[str, Any]], str | None]:
    """What the real poll returns for the gap account when the token's ticker gives
    ``xyz_last`` (``None``: the ticker answers nothing, so the token is a NAMED gap row, value
    0.0 and mark 0.0, and the poll's warning says so)."""
    parsed = await real_binance_parse_balance(GAP_SPOT_ACCOUNT, "spot")
    exchange = MagicMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value=copy.deepcopy(parsed))
    exchange.fetch_tickers = AsyncMock(
        return_value={} if xyz_last is None else {f"{GAP_ASSET}/USDT": {"last": xyz_last}}
    )
    exchange.fetch_positions = AsyncMock(return_value=[])
    return await fetch_allocator_holdings("binance", exchange)


async def gap_mark(xyz_last: float) -> tuple[float, float]:
    """The venue's own mark of the gap account through the REAL reader: every wallet asset at
    its ticker. The venue always knows the token's price, which the poll sometimes does not."""
    parsed = await real_binance_parse_balance(GAP_SPOT_ACCOUNT, "spot")
    venue = FakeVenue(wallet=parsed["total"], tickers={GAP_ASSET: xyz_last})
    read = await read_marked_equity_usd(venue, "binance")
    assert not isinstance(read, str), f"the Binance reader refused the typed state: {read}"
    nav, open_pnl, _wallet = read
    return nav, open_pnl


@pytest.mark.asyncio
async def test_excluded_dust_price_gap_is_left_out_by_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-06 (founder 2026-10-27, "Measure PROD, then set a floor"), drills D-N25 and D-N25b.
    A balance the poll could not price is a gap row. Below the recorded floor it is LEFT OUT of
    the legacy row and NAMED on the stored record instead of holding the day, and the two curves
    still agree on that day.

    The agreement claim rests on one inequality: a left-out balance is below
    ``DUST_FLOOR_SHARE`` of the level, so it is below ``TOLERANCE_REL`` of it only while the floor
    is at or under the tolerance. That is asserted FIRST, so a founder floor above 0.5% fails
    here with its cause and never as an unexplained agreement miss.

    Typed (the Binance book above, 03-06 and 03-07):
      03-06  USDT 100000.0 + 1 x 50.0 (XYZ priced by the poll)       = 100050.0 (both curves)
      03-07  the poll cannot price XYZ: legacy leaves it out         = 100000.0
             size of the left-out balance 1 x 50.0 = 50.0 against a floor of 0.001 x 100000.0
             = 100.0 (dust); the venue's equity still values it       = 100050.0 (derived)
             |100000.0 - 100050.0| = 50.0 <= max(1.0, 0.005 x 100050.0) = 500.25 (agree)."""
    assert price_rule.DUST_FLOOR_SHARE <= TOLERANCE_REL, (
        f"D-06 floor above the D-01 tolerance: DUST_FLOOR_SHARE {price_rule.DUST_FLOOR_SHARE} > "
        f"TOLERANCE_REL {TOLERANCE_REL}. A dust gap left out of the legacy row could then exceed "
        "the agreement tolerance, so the floor and the tolerance must be re-decided together; "
        "this test is never loosened to pass."
    )
    polled: dict[str, list[dict[str, Any]]] = {}
    warnings: dict[str, str | None] = {}
    for day, last in ((CCXT_D1, 50.0), (CCXT_D2, None)):
        polled[day], warnings[day] = await gap_polled_rows(last)
    assert warnings[CCXT_D1] is None, "the priced day is clean"
    assert warnings[CCXT_D2] is not None, "the poll names the unpriced balance to its owner"
    gap_row = next(r for r in polled[CCXT_D2] if r["symbol"] == GAP_ASSET)
    assert (gap_row["value_usd"], gap_row["mark_price"]) == (0.0, 0.0), "the poll writes the gap"
    assert gap_row["raw_payload"]["price_gap"] is True

    fake = FakeSupabaseClient()
    legacy = await legacy_levels(monkeypatch, polled, fake=fake)
    marks = {day: await gap_mark(50.0) for day in (CCXT_D1, CCXT_D2)}
    derived = await stored_mark_levels("binance", marks, terminal=GAP_USDT)

    assert_marks_are_typed("dust", derived, {CCXT_D1: 100_050.0, CCXT_D2: 100_050.0})
    assert legacy == pytest.approx({CCXT_D1: 100_050.0, CCXT_D2: 100_000.0}, abs=1e-6), (
        "the dust balance is left out of the legacy row, and the priced day counts it"
    )
    assert_curves_agree("dust", legacy, derived)
    # The size of what was left out is below the floor, which is below the tolerance.
    left_out_usd = GAP_QUANTITY * 50.0
    assert price_rule.gap_disposition(left_out_usd, GAP_USDT) == "dust"
    assert left_out_usd <= max(TOLERANCE_USD, TOLERANCE_REL * derived[CCXT_D2])
    # Named, on the stored row itself, with that symbol and nothing summed.
    breakdown = snapshot_rows(fake, CCXT_D2)[0]["breakdown"]
    assert breakdown["__price_gap_left_out__"] == {
        "count": 1, "symbols": [GAP_ASSET], "dust": 1, "unsizable": 0,
    }
    assert GAP_ASSET not in breakdown
    assert "__price_gap_left_out__" not in snapshot_rows(fake, CCXT_D1)[0]["breakdown"]


@pytest.mark.asyncio
async def test_excluded_unsizable_price_gap_follows_the_recorded_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-06, plan 10's recorded line ``unsizable: left-out``, drill D-N28. An unpriced balance
    with no priced row of the same symbol in the last 7 days cannot be sized. Under the recorded
    decision (``UNSIZABLE_GAP_HOLDS`` False) it is LEFT OUT and named as ``unsizable`` (not
    ``dust``); no agreement is claimed for that day, because the balance has no price anywhere
    the legacy curve can read. Under the other decision (patched here) the day has NO legacy row.

    Typed (the Binance book above, one day): USDT 100000.0 and 1 x XYZ with no earlier priced row
    -> legacy 100000.0 with ``{count: 1, symbols: [XYZ], dust: 0, unsizable: 1}``; held -> no row."""
    assert price_rule.UNSIZABLE_GAP_HOLDS is False, (
        "plan 10 recorded `unsizable: left-out` (founder 2026-10-27); this test pins that decision"
    )
    rows, warning = await gap_polled_rows(None)
    assert warning is not None
    assert price_rule.gap_disposition(None, GAP_USDT) == "unsizable"

    fake = FakeSupabaseClient()
    legacy = await legacy_levels(monkeypatch, {CCXT_D2: rows}, fake=fake)
    assert legacy == pytest.approx({CCXT_D2: GAP_USDT}, abs=1e-6)
    stored = snapshot_rows(fake, CCXT_D2)[0]["breakdown"]
    assert stored["__price_gap_left_out__"] == {
        "count": 1, "symbols": [GAP_ASSET], "dust": 0, "unsizable": 1,
    }

    monkeypatch.setattr(price_rule, "UNSIZABLE_GAP_HOLDS", True)
    held = FakeSupabaseClient()
    carry._seed_key(held, API_KEY_ID_1)
    store_polled(held, API_KEY_ID_1, CCXT_D2, rows)
    audit = await run_legacy_refresh(monkeypatch, held, CCXT_D2)
    assert snapshot_rows(held, CCXT_D2) == [], "the other decision holds the day: no legacy row"
    assert carry._held_metadata(audit)["reason"] == "price_gap"


#: One stored holdings row in the shape ``store_polled`` reads, for a book that is not the
#: subject of the test (a USDT balance, valued at 1.0).
def usdt_row(value: float) -> dict[str, Any]:
    return {
        "venue": "okx", "symbol": "USDT", "holding_type": "spot", "value_usd": value,
        "unrealized_pnl_usd": None, "quantity": value, "mark_price": 1.0,
    }


@pytest.mark.asyncio
async def test_excluded_pre_start_days_are_realized_basis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 exclusion 1; NAVMTM L1 and D-09. The cross-curve claim covers days FROM the first
    stored mark (``marks_since``). A day before it is on the REALIZED basis: the derived level
    is the realized series rolled back from its terminal, which carries no open profit, while
    the legacy row is the venue's equity on that day, open profit included. So the two differ by
    exactly the open profit, and no agreement is claimed.

    Typed (OKX book of the tracer case, first mark 03-06, realized series through 03-05):
      realized terminal on 03-05 = the first mark's wallet = 134000.0 - 4000.0 = 130000.0
      03-04 = 130000.0 / (1 + 0.004), 03-03 = that / (1 + 0.003), ... (``realized_levels``)
      legacy 03-05 = 100000.0 + 0.5 x 60000.0 + 4000.0 = 134000.0
      134000.0 - 130000.0 = 4000.0 (the open profit), above max(1.0, 0.005 x 130000.0) = 650.0."""
    assert OKX_PRESTART < OKX_D1, "the day under test is before marks_since"
    curve = await okx_derived_curve()
    oracle = realized_levels(REALIZED_THROUGH_0305, OKX_PRESTART, 130_000.0, {})
    for day, level in oracle.items():
        assert curve[day] == pytest.approx(level, rel=1e-9), f"{day} is not the realized roll"

    legacy = await legacy_levels(
        monkeypatch, {OKX_PRESTART: await okx_polled_rows(monkeypatch, OKX_PRESTART)}
    )
    assert legacy[OKX_PRESTART] == pytest.approx(134_000.0, abs=1e-6)
    assert legacy[OKX_PRESTART] - curve[OKX_PRESTART] == pytest.approx(4_000.0, abs=1e-6)
    assert not agree(legacy[OKX_PRESTART], curve[OKX_PRESTART]), (
        "a pre-start day is excluded because the two curves are on different bases there"
    )


@pytest.mark.asyncio
async def test_excluded_deribit_holdings_are_not_in_the_legacy_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 exclusion 2. Deribit is absent from the legacy curve: the refresh skips every
    ``deribit`` row (the reconstruct refuses Deribit keys), so a Deribit derivative beside an OKX
    book changes nothing. The comparison therefore runs on the non-Deribit book and agrees.

    Typed: the OKX book of 03-06 (100000.0 + 0.5 x 60000.0 + 4000.0 = 134000.0) beside a Deribit
    inverse perpetual with an open profit of 900.0. Legacy stays 134000.0 (not 134900.0)."""
    deribit_row: dict[str, Any] = {
        "venue": "deribit", "symbol": "BTC-PERPETUAL", "holding_type": "derivative",
        "value_usd": 80_000.0, "unrealized_pnl_usd": 900.0, "quantity": 1.0,
        "mark_price": 80_000.0,
    }
    okx_rows = await okx_polled_rows(monkeypatch, OKX_D1)
    alone = await legacy_levels(monkeypatch, {OKX_D1: okx_rows})
    beside = await legacy_levels(monkeypatch, {OKX_D1: [*okx_rows, deribit_row]})
    derived = await okx_derived_levels()

    assert alone == pytest.approx({OKX_D1: 134_000.0}, abs=1e-6)
    assert beside == pytest.approx(alone, abs=1e-6), "a Deribit row reached the legacy row"
    assert beside[OKX_D1] != pytest.approx(134_900.0, abs=1.0)
    assert_curves_agree("okx beside deribit", beside, {OKX_D1: derived[OKX_D1]})


@pytest.mark.asyncio
async def test_excluded_no_mark_and_refused_mark_days_have_no_derived_level() -> None:
    """D-01 exclusion 3; NAVMTM D-05 and MARKSOURCE plan 03. A day with no stored mark has no
    derived level, and a day whose mark was REFUSED (the open profit was unreadable) gets none
    either, with no live-read step booked after the last mark. The cross-curve claim is made on
    the derived curve's own days, so these days are outside it.

    Typed (the roundtrip scenario): marks 03-06 = 1050.0 and 03-08 = 1071.0, so 03-07 has no
    mark (D-05); the derive at 00:10Z on 03-11 reads equity 1215.0 it cannot split into wallet
    and open profit, so 03-10 stores none (refused, ``upnl_unreadable``), and 03-09 has none.
    The curve ends on the 03-08 mark, 1071.0; the 144.0 up to the live 1215.0 is no step."""
    db = KeyDb()
    seed_okx_marks(db, {"2026-03-06": 1050.0, "2026-03-08": 1071.0})
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1215.0,
        upl=215.0, flows=[], upnl_unreadable=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    unmarked = ("2026-03-07", "2026-03-09", "2026-03-10")
    for day in unmarked:
        assert (KEY, day) not in db.marks, f"{day} stored a mark"
    curve = levels(await compose_curve(db, capture))
    for day in unmarked:
        assert day not in curve, f"{day} has a derived level without a mark"
    assert curve["2026-03-06"] == pytest.approx(1050.0, rel=1e-9)
    assert curve["2026-03-08"] == pytest.approx(1071.0, abs=1e-9), "no live step on the mark day"
    assert max(curve) == "2026-03-08"


@pytest.mark.asyncio
async def test_excluded_price_gap_day_has_no_legacy_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 exclusion 4; D-04 as refined by D-06 (plan 12). A balance the poll could not price
    whose size is AT OR ABOVE the recorded floor holds the legacy day: no row is written, the
    refresh says ``price_gap``, and the derived curve (which has the venue's own equity) has a
    level the legacy curve lacks. The day is outside the claim.

    Typed (the Binance book above): 03-06 prices XYZ at 5000.0 (USDT 100000.0 + 1 x 5000.0 =
    105000.0 on both curves); 03-07 the poll cannot price it. Its size is 1 x 5000.0 = 5000.0
    against a floor of 0.001 x 100000.0 = 100.0, so the day is held."""
    polled: dict[str, list[dict[str, Any]]] = {}
    for day, last in ((CCXT_D1, 5_000.0), (CCXT_D2, None)):
        polled[day], _warning = await gap_polled_rows(last)
    fake = FakeSupabaseClient()
    carry._seed_key(fake, API_KEY_ID_1)
    audits = {}
    for day in (CCXT_D1, CCXT_D2):
        store_polled(fake, API_KEY_ID_1, day, polled[day])
        audits[day] = await run_legacy_refresh(monkeypatch, fake, day)
    marks = {day: await gap_mark(5_000.0) for day in (CCXT_D1, CCXT_D2)}
    derived = await stored_mark_levels("binance", marks, terminal=GAP_USDT)

    assert_marks_are_typed("price gap", derived, {CCXT_D1: 105_000.0, CCXT_D2: 105_000.0})
    assert [r["value_usd"] for r in snapshot_rows(fake, CCXT_D1)] == [105_000.0]
    assert snapshot_rows(fake, CCXT_D2) == [], "a sizable gap writes no legacy row"
    held = carry._held_metadata(audits[CCXT_D2])
    assert held["reason"] == "price_gap" and held["price_gap_accounts"] == 1
    legacy_days = {r["asof"] for r in fake.rows_for("allocator_equity_snapshots")}
    assert set(derived) - legacy_days == {CCXT_D2}, "the held day is the one the legacy lacks"


@pytest.mark.asyncio
async def test_excluded_connect_day_row_is_first_writer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 exclusion 5; RESEARCH A8. The snapshot is first-writer-wins on (allocator, day). A
    first-connect reconstruct writes the in-progress day's row, and the refresh that follows
    keeps it: that day's legacy level is the reconstruct's, not the refresh's rule, so the
    agreement claim does not cover it.

    Typed (OKX book of 03-06, derived 134000.0): the reconstruct left 133000.0 for 03-06; the
    refresh would have written 134000.0 and leaves 133000.0. 134000.0 - 133000.0 = 1000.0 is
    above max(1.0, 0.005 x 134000.0) = 670.0, so the stored row does NOT agree."""
    stored_by_reconstruct = 133_000.0
    fake = FakeSupabaseClient()
    carry._seed_key(fake, API_KEY_ID_1)
    carry._seed_snapshot(fake, date.fromisoformat(OKX_D1), stored_by_reconstruct)
    store_polled(fake, API_KEY_ID_1, OKX_D1, await okx_polled_rows(monkeypatch, OKX_D1))
    audit = await run_legacy_refresh(monkeypatch, fake, OKX_D1)
    derived = await okx_derived_levels()

    rows = snapshot_rows(fake, OKX_D1)
    assert [r["value_usd"] for r in rows] == [stored_by_reconstruct], "the refresh replaced the row"
    assert carry._refresh_complete_metadata(audit)["days_written"] == 0
    assert derived[OKX_D1] == pytest.approx(134_000.0, abs=1e-6)
    assert not agree(rows[0]["value_usd"], derived[OKX_D1])


@pytest.mark.asyncio
async def test_excluded_native_unpriced_mt5_is_left_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08 (founder 2026-10-27, "Accept, named in runbook"); 164.6.6.2.1 R2-WR-01; TODOS
    ``167.2.1.1.1.1-MT5-BTC-MISSING-CLOSE-LEGACY-EXCLUSION``. A BTC-unit MT5 account whose
    latest completed day has no stored close is not priced by the poll (no row, a marker is
    written), and the refresh leaves the account out of the legacy row instead of carrying its
    older row at an older close. This is accepted, not a hold, and not a finding.

    Typed: an OKX USDT book of 100000.0 and an MT5 BTC account of 0.1090 BTC x 60000.0 = 6540.0
    on 10-05 (legacy 106540.0). On 10-08 the close is missing: legacy is 100000.0, short by
    exactly the account's last priced value, 6540.0."""
    d1, d2 = "2026-10-05", "2026-10-08"
    monkeypatch.setattr(ap, "read_btc_closes", None)  # replaced per day below
    fake = FakeSupabaseClient()
    carry._seed_key(fake, API_KEY_ID_1)
    carry._seed_key(fake, API_KEY_ID_2, exchange="mt5")
    audits = {}
    notes = {}
    for day, native, wallet, closes in (
        (d1, 0.1090, 0.1085, btc_closes()),
        (d2, 0.1115, 0.1105, btc_closes().loc[:"2026-10-07"]),  # no close for 10-08
    ):
        read_at = datetime.fromisoformat(day).replace(tzinfo=timezone.utc) + timedelta(
            days=1, hours=12
        )

        async def _closes(closes: Any = closes) -> Any:
            return closes

        monkeypatch.setattr(ap, "_utc_now", lambda read_at=read_at: read_at)
        monkeypatch.setattr(ap, "read_btc_closes", _closes)
        monkeypatch.setenv("MT5_ENABLED", "true")
        mt5_rows, note = await fetch_allocator_holdings(
            "mt5",
            _session(_RecordingMt5Transport(
                account=_account(currency="BTC", equity=native, balance=wallet)
            )),
            API_KEY_ID,
        )
        notes[day] = note
        store_polled(fake, API_KEY_ID_1, day, [usdt_row(100_000.0)])
        store_polled(fake, API_KEY_ID_2, day, mt5_rows)
        if not mt5_rows:
            read_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
            await persist_native_unpriced_marker(fake, ALLOCATOR_ID, API_KEY_ID_2, read_day)
        audits[day] = await run_legacy_refresh(monkeypatch, fake, day)

    assert notes[d1] is None and notes[d2] is not None, "only 10-08 lacks its close"
    assert isinstance(notes[d2], ap.NativeUnpricedNote)
    priced_value = 0.1090 * BTC_CLOSE
    assert priced_value == pytest.approx(6_540.0)
    legacy = {d: float(snapshot_rows(fake, d)[0]["value_usd"]) for d in (d1, d2)}
    assert legacy == pytest.approx({d1: 106_540.0, d2: 100_000.0}, abs=1e-6)
    assert legacy[d1] - legacy[d2] == pytest.approx(priced_value, abs=1e-6)
    assert carry._refresh_complete_metadata(audits[d1])["native_unpriced_accounts"] == 0
    assert carry._refresh_complete_metadata(audits[d2])["native_unpriced_accounts"] == 1


@pytest.mark.asyncio
async def test_excluded_sfox_non_stable_balances_are_unpriced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08; AUM-05; TODOS ``167.2.1.1.1.1-SFOX-NONSTABLE-LEGACY-EXCLUSION``. The sFOX read has
    no price source, so the poll values USD and stable coins at 1.0 and SKIPS every other
    balance, naming it in its warning. sFOX's own NAV (the stored mark) includes that balance,
    so the legacy row is short by its value. Accepted, not a finding.

    Typed (03-05 of the sFOX roundtrip scenario): USD 850.0 + USDC 160.0 + 0.001 BTC at the
    venue's 100000.0 = 100.0 -> NAV 850.0 + 160.0 + 100.0 = 1110.0 (the stored mark).
    Legacy = 850.0 + 160.0 = 1010.0; the difference is 100.0, above max(1.0, 0.005 x 1110.0)."""
    day = "2026-03-05"
    monkeypatch.setenv("SFOX_ENABLED", "true")
    client = _SpecConstrainedSfoxClient(balances=[
        {"currency": "USD", "balance": "850.0"},
        {"currency": "USDC", "balance": "160.0"},
        {"currency": "BTC", "balance": "0.001"},
    ])
    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)
    assert warning == SFOX_UNPRICED_ASSETS_NOTE.format(assets="BTC")
    assert sorted(r["symbol"] for r in rows) == ["USD", "USDC"], "BTC is not a holdings row"
    legacy = await legacy_levels(monkeypatch, {day: rows})

    db = KeyDb()
    result, capture = await derive_sfox_key(monkeypatch, db)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    curve = levels(await compose_curve(db, capture, key=KEY_SFOX, venue="sfox"))

    btc_value = 0.001 * 100_000.0
    assert btc_value == pytest.approx(100.0)
    assert SFOX_MARKS[day] == 850.0 + 160.0 + btc_value
    assert curve[day] == pytest.approx(1_110.0, abs=1e-6), "the NAV includes the BTC balance"
    assert legacy[day] == pytest.approx(1_010.0, abs=1e-6), "the legacy row leaves it out"
    assert curve[day] - legacy[day] == pytest.approx(btc_value, abs=1e-6)
    assert not agree(legacy[day], curve[day])
