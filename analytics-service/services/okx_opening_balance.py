"""A read-only OKX opening-balance oracle (Phase 172 OKXANCHOR, plan 01).

What this is for
----------------
A FORCED rebuild of an OKX allocator account replays the last 89 days of trades from zero
cash and anchors the result to today's venue equity (``totalEq``). When the replay ends far
below that equity, the 5x plausibility gate in ``equity_reconstruction`` refuses the anchor
(``anchor_skipped_implausible``). The gate cannot tell "a large balance was held before the
window" (a correct anchor) from "the replay lost value" (a wrong one). This module is the
independent second opinion the founder asked for (D-01 item 2): the account's balance AT THE
START OF THE REPLAY, read from the venue's own running balance and never from the replay or
the anchor.

What it reads
-------------
* ``GET /api/v5/account/balance`` (one call, by the caller): ``details[].cashBal`` per
  currency. A currency with no bill since the opening instant held its balance unchanged,
  so its opening is today's cash balance.
* ``GET /api/v5/account/bills-archive`` ("last 3 months"): per bill, ``bal`` (the currency's
  balance after the bill) and ``balChg`` (the bill's change). The oldest bill of a currency
  since the opening instant gives that currency's opening as ``bal - balChg``. Three checks
  prove that bill is the first one since the opening and that none is missing: the walk ends
  only when the archive serves a bill from BEFORE the opening instant (an empty page is not
  an end); each currency's chain (``bal`` equals the previous ``bal`` plus ``balChg``, in
  ``billId`` order, EXACTLY) holds; and its newest bill's ``bal`` agrees with today's
  ``cashBal`` exactly or within 1e-12 of the larger of the two (Phase 179 D-07: the two
  endpoints can print one balance at different decimal places, a gap that small is
  rounding and nothing larger is forgiven). The last two do not
  depend on the order the archive replies in.

It is GET-only and writes nothing: no database write, no price-cache write, no order, no
withdrawal, no transfer. NOTHING IN PRODUCTION CALLS IT in plan 01; plan 02 measures it on
the account that was refused and plan 04 wires it into the forced anchor.

The opening instant and the pricing day
---------------------------------------
Two choices differ from the research notes, on purpose:

* The opening INSTANT is 00:00 UTC of the replay's FIRST ROW day, not of the window start.
  ``_compute_daily_equity`` appends a row only ``if breakdown or total:``, so a window whose
  only trade is nine days back yields rows starting on the trade day, and the anchor offset
  is spread over those rows only. The balance the offset must equal is therefore the balance
  before the first row's events. A funding-to-trading transfer before that day then causes no
  false disagreement, while one inside the curve still does (correctly: a uniform offset
  would misstate the rows before it).
* A non-stable currency is priced at the CLOSE of the opening day (the first row's own
  pricing day), not at the previous day's close. Agreement then bounds the level error of
  the first written row, which is the quantity that matters.

What bills cannot see
---------------------
Funding-account balances (``/asset/*``), strategy-bot equity (money moved into a bot leaves
the cash balance), open-position unrealised profit at the opening instant, earn products,
option mark value, and any borrow. A disagreement can therefore be a model gap, not a wrong
anchor. The replay's own blind spots (perp fees, funding, funding-to-trading transfers,
hedge-mode netting) sit in ``anchor - replay_final``, not here.

Failure semantics
-----------------
Only STRUCTURAL gaps are "unavailable": a malformed balance row or bills page, a broken
per-currency chain or one that does not end at today's cash balance, exactly or within 1e-12
of the larger balance (``chain_break``, Phase 179 D-07), a walk
that did not reach a bill from before the opening instant or read no bill since it
(``reach_unproven``: the opening day is the replay's first row, so the account was active on
or after it), a currency that no price source has a price for, or a walk past the page ceiling. Each returns ``opening_usd`` None
with exactly one token from ``OPENING_UNAVAILABLE_REASONS``. A VENUE exception (a 429 that
survives ``_okx_bills_fetch_with_backoff``, a network or authentication error) propagates
unchanged, and so does a price-source fault (a database error, a CoinGecko non-2xx other than
404): a transient fault turned into "unavailable" would become a permanent refusal that the
rebuild's no-automatic-re-crawl rule (PD-I) forbids retrying.
"""
from __future__ import annotations

import logging
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Final

import ccxt.async_support as ccxt
import httpx

from services.closed_sets import STABLECOINS
from services.dateday import epoch_ms_to_iso_day
from services.db import db_execute
from services.exchange import _finite_float, _okx_bills_fetch_with_backoff

logger = logging.getLogger("quantalyze.analytics.okx_opening_balance")

#: Every way the oracle can fail to supply an opening. The set is closed: a new way to fail
#: is a decision, not an f-string.
OPENING_UNAVAILABLE_REASONS: Final[frozenset[str]] = frozenset(
    {
        "malformed_balance",
        "malformed_bills",
        "chain_break",
        "reach_unproven",
        "unpriced_ccy",
        "page_ceiling",
    }
)

#: OKX's maximum page size for ``bills-archive``.
BILLS_ARCHIVE_PAGE_ROWS: Final[int] = 100

#: The walk's page ceiling, the ``_TRADE_PASS_PAGE_CEILING`` idiom of
#: ``services/equity_reconstruction.py``: hitting it means "unavailable", never a partial
#: answer. 500 pages is 50000 bills, far beyond any three-month account.
BILLS_ARCHIVE_PAGE_CEILING: Final[int] = 500

#: The agreement tolerance of ``opening_agrees`` (Phase 172 D-01 item 2): the larger of
#: ``OPENING_TOLERANCE_USD`` and ``OPENING_TOLERANCE_REL`` times the anchor. The shape mirrors
#: ``_BYBIT_UPNL_TOLERANCE_USD`` / ``_BYBIT_UPNL_TOLERANCE_REL`` in
#: ``services/equity_reconstruction.py``: a USD floor for tiny accounts and a relative term
#: that scales with the account. The relative value is the founder's recorded choice at
#: plan 03's decision checkpoint (2026-10-27, ``172-03-SUMMARY.md`` ``tolerance-rel:``), and
#: it is NOT a measured calibration. The reading cited at that checkpoint, on the one OKX
#: account the 5x gate refused (a4), was ``opening_residual_over_anchor=-0.0147`` beside
#: ``bal_over_cashbal=0.932``. It came from a PARTIAL bills walk (one page of bills against
#: a far larger trade read), and the oracle as fixed in review round 1 refuses that shape:
#: it demands a walk that reaches the opening and a newest bill that equals today's cash
#: balance. The rule that chose 5% was: the smallest of 0.005, 0.01, 0.02, 0.05 that is at
#: least twice the absolute residual (2 x 0.0147 = 0.0294, so 0.05), and no allowed value
#: exceeds 5%. Plan 05's post-deploy re-read of a4 (the probe prints ``opening_check`` and
#: ``opening_residual_over_anchor`` for an anchored member too) re-measures the residual on a
#: complete walk, and the value is to be re-decided from that reading. Until then ONE
#: account is the only basis and a second OKX account is unmeasured.
OPENING_TOLERANCE_USD: Final[float] = 1.0
OPENING_TOLERANCE_REL: Final[float] = 0.05

#: The relative bound of the close arm in ``close_agrees`` (Phase 179 D-07, founder 2026-10-28,
#: "Trillionth bound only"; it supersedes the decimal-places half of D-06): the newest bill's
#: ``bal`` and today's ``cashBal`` agree when they are equal or differ by no more than this
#: fraction of the larger of the two. Like the opening
#: tolerance above it is a decided value: a change is a founder decision recorded first.
CLOSE_RESIDUAL_REL_BOUND: Final[Decimal] = Decimal("1e-12")

_BILLS_METHOD: Final[str] = "private_get_account_bills_archive"
_BILL_TYPE_TRANSFER: Final[str] = "1"
_DAY_S: Final[int] = 24 * 60 * 60


class OpeningUnavailable(Exception):
    """A structural gap in the oracle's inputs. Internal control flow only."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class OkxOpeningReading:
    """What the oracle measured. ``opening_usd`` is None exactly when the reason is not "none"."""

    opening_usd: float | None
    unavailable_reason: str
    bills_read: int
    blank_inst_type_bills: int
    stable_transfer_net_usd: float
    newest_usdt_bal: float | None
    # The bills the walk kept, in walk order; read by the Phase 179 chain diagnostic, never by the verdict.
    walked: tuple[Mapping[str, str], ...] = ()


def _decimal(value: Any, reason: str) -> Decimal:
    """A finite ``Decimal`` from a venue number, or ``OpeningUnavailable(reason)``.

    Rejects bool (which would coerce to 1/0), anything that is not a str, int or float,
    non-numeric text and NaN/inf. A venue number is never guessed and never zeroed.
    """
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise OpeningUnavailable(reason)
    try:
        out = Decimal(str(value))
    except InvalidOperation:
        raise OpeningUnavailable(reason) from None
    if not out.is_finite():
        raise OpeningUnavailable(reason)
    return out


def _digits(value: Any) -> int | None:
    """The integer in an all-ASCII-digit string, else None."""
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    return None


async def read_okx_balance_row(exchange: Any) -> Mapping[str, Any] | None:
    """One ``GET /api/v5/account/balance``: its ``data[0]`` row, or None when malformed.

    Unlike ``fetch_okx_total_equity_and_upl_usd``, which is advisory and swallows every
    exception into "unreadable", this does NOT catch: a venue exception propagates so a
    transient fault is not read as a missing balance.
    """
    reply: Any = await exchange.private_get_account_balance()
    if not isinstance(reply, dict):
        return None
    data = reply.get("data")
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None
    row: Mapping[str, Any] = data[0]
    return row


def cash_balances(balance_row: Mapping[str, Any]) -> dict[str, Decimal]:
    """``ccy -> cashBal`` from a balance row's ``details``; a malformed row is unavailable."""
    details = balance_row.get("details")
    if not isinstance(details, list):
        raise OpeningUnavailable("malformed_balance")
    out: dict[str, Decimal] = {}
    for detail in details:
        if not isinstance(detail, dict):
            raise OpeningUnavailable("malformed_balance")
        ccy = detail.get("ccy")
        if not isinstance(ccy, str) or not ccy:
            raise OpeningUnavailable("malformed_balance")
        out[ccy] = _decimal(detail.get("cashBal"), "malformed_balance")
    return out


def _page_rows(reply: Any) -> list[Any]:
    """The ``data`` list of a bills reply; anything else is a malformed page."""
    if not isinstance(reply, dict):
        raise OpeningUnavailable("malformed_bills")
    data = reply.get("data")
    if not isinstance(data, list):
        raise OpeningUnavailable("malformed_bills")
    return data


def _parse_bill(row: Any) -> dict[str, str]:
    """One bill as strings, or ``malformed_bills`` when a field the oracle reads is unusable."""
    if not isinstance(row, dict):
        raise OpeningUnavailable("malformed_bills")
    bill_id = _digits(row.get("billId"))
    ts = _digits(row.get("ts"))
    ccy = row.get("ccy")
    if bill_id is None or ts is None or not isinstance(ccy, str) or not ccy:
        raise OpeningUnavailable("malformed_bills")
    bal = _decimal(row.get("bal"), "malformed_bills")
    bal_chg = _decimal(row.get("balChg"), "malformed_bills")
    return {
        "billId": str(bill_id),
        "ts": str(ts),
        "ccy": ccy,
        "bal": str(bal),
        "balChg": str(bal_chg),
        "type": str(row.get("type") or ""),
        "instType": str(row.get("instType") or ""),
        # Diagnostic only (Phase 179): no verdict reads these three.
        "subType": str(row.get("subType") or ""),
        "mgnMode": str(row.get("mgnMode") or ""),
        "posBalChg": str(row.get("posBalChg") or ""),
    }


async def walk_okx_bills_archive(exchange: Any, opening_ms: int) -> list[dict[str, str]]:
    """Every bill with ``ts >= opening_ms``, paged backward by ``billId`` until a bill older
    than the opening instant is served.

    That older bill is the proof the walk is complete: pages are contiguous below the cursor,
    so once a bill from before the opening is served, every bill since the opening was served
    first. An EMPTY page before it is not an end (a short or cut-off walk would otherwise pass
    as complete): it is ``reach_unproven``. No ``begin`` is sent, since a ``begin``-bounded
    query never serves the older bill and its reply order is not guaranteed. No ``instType``
    and no ``ccy`` filter, so a transfer (blank ``instType``) is read too. A stalled cursor (a
    page whose smallest ``billId`` is not below the previous cursor) is malformed rather than
    looped on, and needing more than ``BILLS_ARCHIVE_PAGE_CEILING`` pages is ``page_ceiling``.
    Every page goes through the existing 429 backoff helper.
    """
    kept: dict[str, dict[str, str]] = {}
    cursor: int | None = None
    for page_no in range(1, BILLS_ARCHIVE_PAGE_CEILING + 1):
        params = {"limit": str(BILLS_ARCHIVE_PAGE_ROWS)}
        if cursor is not None:
            params["after"] = str(cursor)
        reply: Any = await _okx_bills_fetch_with_backoff(
            exchange, _BILLS_METHOD, params, label="opening", page=page_no
        )
        rows = _page_rows(reply)
        if not rows:
            raise OpeningUnavailable("reach_unproven")
        page = [_parse_bill(r) for r in rows]
        page_min = min(int(b["billId"]) for b in page)
        if cursor is not None and page_min >= cursor:
            raise OpeningUnavailable("malformed_bills")
        reached_older = False
        for bill in page:
            if int(bill["ts"]) >= opening_ms:
                kept[bill["billId"]] = bill
            else:
                reached_older = True
        if reached_older:
            return list(kept.values())
        cursor = page_min
    raise OpeningUnavailable("page_ceiling")


def close_agrees(newest_bal: Decimal, cash: Decimal) -> bool:
    """True when a currency's newest bill ``bal`` and today's cash balance agree (D-07).

    Either they are equal, or they differ by at most ``CLOSE_RESIDUAL_REL_BOUND`` of the larger
    of the two (inclusive, by multiplication). No decimal-places allowance: a gap that is large
    against the balance (0.5 against 0.54) is never forgiven. This only decides whether the
    chain is proven; it never enters an opening's value.
    """
    residual = abs(newest_bal - cash)
    return residual == 0 or residual <= CLOSE_RESIDUAL_REL_BOUND * max(abs(newest_bal), abs(cash))


def per_ccy_opening(
    bills: Sequence[Mapping[str, str]], cash_by_ccy: Mapping[str, Decimal]
) -> dict[str, Decimal]:
    """Each currency's balance at the opening instant.

    A currency with bills opens at its oldest bill's ``bal - balChg``, after the chain check
    proves no bill is missing: every interior link holds exactly, and the newest bill's ``bal``
    agrees with today's cash balance exactly or within 1e-12 of the larger of the two
    (``close_agrees``, Phase 179 D-07; a currency absent from ``cash_by_ccy`` holds 0). A
    currency in ``cash_by_ccy`` with no bill keeps its cash balance (every balance change
    creates a bill, so it held that balance unchanged).
    """
    by_ccy: dict[str, list[Mapping[str, str]]] = {}
    for bill in bills:
        by_ccy.setdefault(bill["ccy"], []).append(bill)
    openings: dict[str, Decimal] = dict(cash_by_ccy)
    for ccy, group in by_ccy.items():
        ordered = sorted(group, key=lambda b: int(b["billId"]))
        first_bal = _decimal(ordered[0]["bal"], "malformed_bills")
        openings[ccy] = first_bal - _decimal(ordered[0]["balChg"], "malformed_bills")
        prev_bal = first_bal
        for bill in ordered[1:]:
            bal = _decimal(bill["bal"], "malformed_bills")
            bal_chg = _decimal(bill["balChg"], "malformed_bills")
            if bal != prev_bal + bal_chg:
                raise OpeningUnavailable("chain_break")
            prev_bal = bal
        if not close_agrees(prev_bal, cash_by_ccy.get(ccy, Decimal(0))):
            raise OpeningUnavailable("chain_break")
    return openings


def _positive_finite(value: float | None) -> float | None:
    if value is None or not math.isfinite(value) or value <= 0:
        return None
    return value


async def _cached_close_on(supabase: Any, ccy: str, iso: str) -> float | None:
    """The cached USD close of ``ccy`` on ``iso``; a database fault raises.

    ``er._read_cached_prices`` swallows every exception into ``{}``, which would read a
    transient fault as "no price" and end as a permanent ``unpriced_ccy`` refusal (PD-I).
    """

    def _sel() -> Any:
        return (
            supabase.table("token_price_history")
            .select("asof, price_usd")
            .eq("symbol", ccy)
            .eq("asof", iso)
            .execute()
        )

    res = await db_execute(_sel)
    for row in getattr(res, "data", None) or []:
        if row.get("asof") == iso and row.get("price_usd") is not None:
            return float(row["price_usd"])
    return None


async def _coingecko_close_on(ccy: str, day_s: int) -> float | None:
    """CoinGecko's USD close of ``ccy`` for the UTC day starting at ``day_s``.

    ``er._fetch_coingecko_daily_closes`` returns ``[]`` on any non-2xx, so a 429 would read as
    "no price" and end as a permanent ``unpriced_ccy`` refusal (PD-I). Here only a 404 (the coin
    is not listed: an answer) means "no price"; every other status raises.
    """
    from services import equity_reconstruction as er

    url = f"{er.COINGECKO_BASE}/coins/{er._coingecko_id_for(ccy)}/market_chart/range"
    params: dict[str, str | int] = {"vs_currency": "usd", "from": day_s, "to": day_s + _DAY_S}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json() or {}
    iso = epoch_ms_to_iso_day(day_s * 1000)
    for row in data.get("prices") or []:
        try:
            if epoch_ms_to_iso_day(row[0]) == iso:
                return float(row[1])
        except (TypeError, ValueError, OSError, IndexError):
            continue  # a malformed point prices nothing
    return None


async def _usd_close_on(
    exchange: Any, supabase: Any, ccy: str, opening_day: date
) -> float | None:
    """The USD close of ``ccy`` on ``opening_day`` from the replay's own price sources.

    OHLCV on the account's venue first; only on ``ccxt.BadSymbol`` the price cache READ and
    then CoinGecko, the replay's own fallback (``_fetch_and_price_window``): an empty candle
    list does not fall back there either. It never writes the price cache. Every failure of a
    source raises; None means every source answered and none has a price for the day.
    """
    # Function-local: services.equity_reconstruction imports services that import this
    # module's neighbours, so a top-level import risks a cycle (the services/nav_marks.py
    # precedent). Calling through the module attribute also lets tests patch it.
    from services import equity_reconstruction as er

    iso = opening_day.isoformat()
    day_s = int(datetime(opening_day.year, opening_day.month, opening_day.day, tzinfo=timezone.utc).timestamp())
    day_ms = day_s * 1000
    try:
        candles = await er._fetch_ohlcv_daily(exchange, f"{ccy}/USDT", day_ms, day_ms)
    except ccxt.BadSymbol:
        price = await _cached_close_on(supabase, ccy, iso)
        if price is None:
            price = await _coingecko_close_on(ccy, day_s)
        return _positive_finite(price)
    for candle in candles:
        try:
            if epoch_ms_to_iso_day(candle[0]) != iso:
                continue
            close = _finite_float(candle[4], label="okx-opening-close")
        except (TypeError, ValueError, OSError, IndexError):
            continue  # a malformed candle prices nothing; the currency stays unpriced
        return _positive_finite(close)
    return None


async def read_okx_opening(
    exchange: Any, supabase: Any, opening_day: date, balance_row: Mapping[str, Any]
) -> OkxOpeningReading:
    """The account's USD opening balance at 00:00 UTC of ``opening_day``, or why it is unknown."""
    opening_ms = int(
        datetime(
            opening_day.year, opening_day.month, opening_day.day, tzinfo=timezone.utc
        ).timestamp()
        * 1000
    )
    bills_read = 0
    bills: list[dict[str, str]] = []
    blank_inst_type = 0
    transfer_net = Decimal(0)
    newest_usdt_bal: float | None = None
    try:
        cash_by_ccy = cash_balances(balance_row)
        bills = await walk_okx_bills_archive(exchange, opening_ms)
        bills_read = len(bills)
        blank_inst_type = sum(1 for b in bills if b["instType"] == "")
        transfer_net = sum(
            (Decimal(b["balChg"]) for b in bills if b["type"] == _BILL_TYPE_TRANSFER and b["ccy"] in STABLECOINS),
            Decimal(0),
        )
        usdt = [b for b in bills if b["ccy"] == "USDT"]
        if usdt:
            newest_usdt_bal = float(Decimal(max(usdt, key=lambda b: int(b["billId"]))["bal"]))
        if not bills:
            raise OpeningUnavailable("reach_unproven")
        openings = per_ccy_opening(bills, cash_by_ccy)
        total = Decimal(0)
        for ccy in sorted(openings):
            amount = openings[ccy]
            if ccy in STABLECOINS:
                total += amount
            elif amount != 0:
                price = await _usd_close_on(exchange, supabase, ccy, opening_day)
                if price is None:
                    raise OpeningUnavailable("unpriced_ccy")
                total += amount * Decimal(str(price))
        return OkxOpeningReading(
            opening_usd=float(total),
            unavailable_reason="none",
            bills_read=bills_read,
            blank_inst_type_bills=blank_inst_type,
            stable_transfer_net_usd=float(transfer_net),
            newest_usdt_bal=newest_usdt_bal,
            walked=tuple(bills),
        )
    except OpeningUnavailable as exc:
        logger.info("okx opening unavailable: reason=%s", exc.reason)
        return OkxOpeningReading(
            opening_usd=None,
            unavailable_reason=exc.reason,
            bills_read=bills_read,
            blank_inst_type_bills=blank_inst_type,
            stable_transfer_net_usd=float(transfer_net),
            newest_usdt_bal=newest_usdt_bal,
            walked=tuple(bills),
        )


def opening_agrees(anchor: float, replay_final: float, oracle_opening: float) -> bool:
    """True when the opening the anchor implies is within tolerance of the bills' opening.

    ``anchor - replay_final`` is the cash the replay started without (the offset the anchor
    would spread); ``oracle_opening`` is what the venue's own running balances say the account
    held at the start of the first written row. Agreement bounds the level error of that first
    row, because the oracle values the opening at the first row's own close (plan 01).
    """
    return abs((anchor - replay_final) - oracle_opening) <= max(OPENING_TOLERANCE_USD, OPENING_TOLERANCE_REL * abs(anchor))
