"""The OKX bills-chain diagnostic (Phase 179 OKXBILLSCHAIN, plan 01).

Why this exists
---------------
``services.okx_opening_balance`` refuses an account with the token ``chain_break`` when a
currency's running balance does not close, and that one string stands for TWO conditions: an
interior link (a bill's ``bal`` differs from the previous ``bal`` plus its ``balChg``) or the
close (the newest bill's ``bal`` differs from today's ``cashBal``). It also stops at the first
currency that fails, in dict order, so it cannot say how many currencies break or which one
matters. This module re-folds the bills the oracle ALREADY walked and names the arm over EVERY
currency. It never edits the oracle's verdict (the forced rebuild still fails closed on
``chain_break``) and it holds nothing the oracle reads.

What it reads
-------------
Nothing but the walked bills (pure) and, for the close-race question, ONE extra
``GET /api/v5/account/balance`` made AFTER the walk. A cash balance that moved while the walk
was paging is not a broken close, and only a second balance read tells the two apart. Every
venue call goes through ``BudgetedExchange``: it resolves GET-prefixed implicit methods only
and counts each call under ``CHAIN_CALL_CEILING``, so a retry inside the existing 429 backoff
is counted too. It writes nothing: it imports no database module and names no table.
"""
from __future__ import annotations

import re
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Final, NamedTuple

import ccxt.async_support as ccxt

from services import okx_opening_balance as obal
from services.exchange import _okx_bills_fetch_with_backoff

#: A hard ceiling on the venue calls the chain diagnostic makes in one measurement run.
CHAIN_CALL_CEILING: Final[int] = 120

#: ccxt's implicit GET methods for OKX all start with this prefix; nothing else resolves.
_GET_PREFIX: Final[str] = "private_get_"


class CallCeilingReached(Exception):
    """The call budget is spent. Not a venue failure: the diagnostic stopped itself."""


class BudgetedExchange:
    """A GET-only, counted view of an exchange client.

    Only attributes that start with the GET prefix resolve; every other name (a POST implicit
    method, an order, a withdrawal, a trade fetch) is an ``AttributeError``. Each call it hands
    out is counted in ``calls`` and refused BEFORE the inner call once ``calls`` has reached
    the ceiling, so the venue never sees the call that would exceed the budget.
    """

    def __init__(self, inner: Any, ceiling: int) -> None:
        self._inner = inner
        self._ceiling = ceiling
        self.calls = 0

    def __getattr__(self, name: str) -> Callable[..., Awaitable[Any]]:
        if not name.startswith(_GET_PREFIX):
            raise AttributeError(f"BudgetedExchange resolves GET methods only, not {name!r}")
        method = getattr(self._inner, name)

        async def _counted(*args: Any, **kwargs: Any) -> Any:
            if self.calls >= self._ceiling:
                raise CallCeilingReached(self._ceiling)
            self.calls += 1
            return await method(*args, **kwargs)

        return _counted


@dataclass(frozen=True)
class ChainReport:
    """What re-folding the walked bills found, over every currency."""

    ccys_checked: int
    ccys_interior_broken: int
    ccys_close_broken: int
    interior_links: int
    interior_breaks: int
    #: The raw symbol of the worst currency, in memory only; the record prints its class.
    worst_ccy: str | None
    #: Each currency's newest bill's ``bal`` and ``ts`` (newest by ``billId``, the oracle's key).
    newest_bal: Mapping[str, Decimal]
    newest_ts: Mapping[str, int]
    #: The currencies whose newest ``bal`` differs from today's cash balance.
    close_broken: frozenset[str]
    #: Over every interior break: the raw (type, subType, instType) of the breaking bill and of
    #: the bill before it, and the breaking bill's raw mgnMode, each with a count.
    break_kinds: Mapping[tuple[str, str, str], int]
    break_prev_kinds: Mapping[tuple[str, str, str], int]
    break_mgn_modes: Mapping[str, int]
    #: Breaking bills carrying a non-zero position-level change (``posBalChg``).
    break_pos_level: int
    #: The largest interior residual and the largest close residual, each RELATIVE to the
    #: balances around it (never an amount); None when there is no such break.
    max_residual_rel: Decimal | None
    max_close_residual_rel: Decimal | None
    #: One signature per interior break; the four counts sum to ``interior_breaks``.
    sig_bal_unchanged: int
    sig_double_count: int
    sig_reorder: int
    sig_other: int
    #: Ordering and ties (plan 179-02). Adjacent pairs in ``billId`` order whose later bill has a
    #: strictly smaller ``ts``; adjacent pairs sharing one ``ts``, and how many of those break.
    billid_ts_inversions: int
    same_ts_links: int
    same_ts_breaks: int
    #: Currencies that admit an order-independent chain (the balance-multiset trail), and how
    #: many bills the multiset says are missing. Necessary, not sufficient: see ``_trail``.
    trail_ccys: int
    gap_estimate: int
    #: Of the currencies with an interior break in ``billId`` order, how many have none when
    #: re-ordered by (ts, billId) and by (ts, -billId).
    closes_by_ts_id: int
    closes_by_ts_id_desc: int
    #: Break ages in ms against the newest walked bill of ANY currency: the oldest break, the
    #: newest break (None with no break) and the breaks younger than seven days.
    first_break_age_ms: int | None
    last_break_age_ms: int | None
    breaks_in_recent_7d: int


class _Break(NamedTuple):
    """One interior break: the link's index in ``billId`` order and the numbers around it."""

    link: int
    residual: Decimal
    bal: Decimal
    prev_bal: Decimal
    change: Decimal


def _kind(bill: Mapping[str, str]) -> tuple[str, str, str]:
    return (bill.get("type", ""), bill.get("subType", ""), bill.get("instType", ""))


def _nonzero_finite(text: str) -> bool:
    try:
        value = Decimal(text)
    except InvalidOperation:
        return False
    return value.is_finite() and value != 0


#: Seven days in milliseconds, the span of OKX's ``/account/bills`` store.
_WEEK_MS: Final[int] = 604_800_000


def _interior_breaks(ordered: Sequence[Mapping[str, str]]) -> int:
    """Interior links of ``ordered`` (already in the order to test) where ``bal`` is not the
    previous ``bal`` plus ``balChg``."""
    prev = Decimal(ordered[0]["bal"])
    broken = 0
    for bill in ordered[1:]:
        bal = Decimal(bill["bal"])
        if bal != prev + Decimal(bill["balChg"]):
            broken += 1
        prev = bal
    return broken


def _trail(group: Sequence[Mapping[str, str]]) -> tuple[bool, int]:
    """(an order-independent chain exists, bills the multiset says are missing) for one currency.

    Every bill is an edge from ``bal - balChg`` to ``bal``. A chain in SOME order needs the
    multiset of starts to match the multiset of ends except for one unmatched start (the
    opening) and one unmatched end (the newest balance). Both multisets hold one entry per
    bill, so the unmatched starts and the unmatched ends are always equal and one count says
    both. More than one unmatched means a bill's start is nowhere among the ends: one bill
    missing per extra. The test is necessary, not sufficient (Assumption A8): it ignores
    connectivity, so a cycle plus a disjoint path would pass. It only says "no reordering can
    fix this" when it fails.
    """
    starts: Counter[Decimal] = Counter()
    ends: Counter[Decimal] = Counter()
    for bill in group:
        bal = Decimal(bill["bal"])
        starts[bal - Decimal(bill["balChg"])] += 1
        ends[bal] += 1
    unmatched = sum((starts - ends).values())
    return unmatched <= 1, max(0, unmatched - 1)


def _signatures(breaks: Sequence[_Break]) -> tuple[int, int, int, int]:
    """(bal_unchanged, double_count, reorder, other) for one currency's breaks in link order.

    Consecutive breaks form a run. A run of two or more whose residuals sum to exactly zero is a
    local reordering (no money missing; an interior swap of two bills makes three such breaks,
    a, -a-b and b). Every other break is judged alone: the balance did not move
    (``bal_unchanged``), the residual equals the bill's own change (``double_count``), or
    anything else (a missing bill leaves the missing change as the residual).
    """
    runs: list[list[_Break]] = []
    for brk in breaks:
        if runs and brk.link == runs[-1][-1].link + 1:
            runs[-1].append(brk)
        else:
            runs.append([brk])
    unchanged = double = reorder = other = 0
    for run in runs:
        if len(run) >= 2 and sum((b.residual for b in run), Decimal(0)) == 0:
            reorder += len(run)
            continue
        for brk in run:
            if brk.bal == brk.prev_bal and brk.change != 0:
                unchanged += 1
            elif brk.residual == brk.change and brk.change != 0:
                double += 1
            else:
                other += 1
    return unchanged, double, reorder, other


def analyse_chain(
    walked: Sequence[Mapping[str, str]], cash_by_ccy: Mapping[str, Decimal]
) -> ChainReport:
    """Re-fold the walked bills per currency with the oracle's own arithmetic.

    Exact ``Decimal`` equality, ``billId`` order and a currency absent from the cash map
    reading 0, as ``per_ccy_opening`` does, but counting over EVERY currency instead of
    stopping at the first failure. The walked values are strings ``_parse_bill`` already
    validated, so ``Decimal(text)`` is safe on them.
    """
    by_ccy: dict[str, list[Mapping[str, str]]] = {}
    for bill in walked:
        by_ccy.setdefault(bill["ccy"], []).append(bill)

    interior_links = 0
    interior_breaks = 0
    breaks_by_ccy: dict[str, int] = {}
    newest_bal: dict[str, Decimal] = {}
    newest_ts: dict[str, int] = {}
    close_broken: set[str] = set()
    kinds: Counter[tuple[str, str, str]] = Counter()
    prev_kinds: Counter[tuple[str, str, str]] = Counter()
    mgn_modes: Counter[str] = Counter()
    pos_level = 0
    residuals: list[Decimal] = []
    close_residuals: list[Decimal] = []
    sigs = [0, 0, 0, 0]
    inversions = same_ts_links = same_ts_breaks = 0
    trail_ccys = gap_estimate = closes_by_ts_id = closes_by_ts_id_desc = 0
    break_ts: list[int] = []
    for ccy, group in by_ccy.items():
        ordered = sorted(group, key=lambda b: int(b["billId"]))
        prev_bal = Decimal(ordered[0]["bal"])
        ccy_breaks: list[_Break] = []
        for link, bill in enumerate(ordered[1:], start=1):
            bal = Decimal(bill["bal"])
            change = Decimal(bill["balChg"])
            interior_links += 1
            residual = bal - (prev_bal + change)
            ts, prev_ts = int(bill["ts"]), int(ordered[link - 1]["ts"])
            if ts < prev_ts:
                inversions += 1
            if ts == prev_ts:
                same_ts_links += 1
                if residual != 0:
                    same_ts_breaks += 1
            if residual != 0:
                break_ts.append(ts)
                ccy_breaks.append(_Break(link, residual, bal, prev_bal, change))
                kinds[_kind(bill)] += 1
                prev_kinds[_kind(ordered[link - 1])] += 1
                mgn_modes[bill.get("mgnMode", "")] += 1
                if _nonzero_finite(bill.get("posBalChg", "")):
                    pos_level += 1
                # A non-zero residual means the three numbers are not all zero.
                residuals.append(abs(residual) / max(abs(bal), abs(prev_bal), abs(change)))
            prev_bal = bal
        has_trail, missing = _trail(ordered)
        trail_ccys += has_trail
        gap_estimate += missing
        if ccy_breaks:
            if _interior_breaks(sorted(group, key=lambda b: (int(b["ts"]), int(b["billId"])))) == 0:
                closes_by_ts_id += 1
            if _interior_breaks(sorted(group, key=lambda b: (int(b["ts"]), -int(b["billId"])))) == 0:
                closes_by_ts_id_desc += 1
        interior_breaks += len(ccy_breaks)
        breaks_by_ccy[ccy] = len(ccy_breaks)
        sigs = [a + b for a, b in zip(sigs, _signatures(ccy_breaks))]
        newest_bal[ccy] = prev_bal
        newest_ts[ccy] = int(ordered[-1]["ts"])
        cash = cash_by_ccy.get(ccy, Decimal(0))
        if prev_bal != cash:
            close_broken.add(ccy)
            close_residuals.append(abs(prev_bal - cash) / max(abs(prev_bal), abs(cash)))

    # Ages run against the newest STAMP of any bill, not the newest billId, so an inversion
    # cannot make an age negative.
    reference = max((int(b["ts"]) for b in walked), default=0)
    ages = [reference - ts for ts in break_ts]
    broken = [c for c in by_ccy if breaks_by_ccy[c] > 0 or c in close_broken]
    # Most interior breaks first, then a close break, then the symbol: a stable, total order.
    worst = min(broken, key=lambda c: (-breaks_by_ccy[c], 0 if c in close_broken else 1, c), default=None)
    return ChainReport(
        ccys_checked=len(by_ccy),
        ccys_interior_broken=sum(1 for n in breaks_by_ccy.values() if n > 0),
        ccys_close_broken=len(close_broken),
        interior_links=interior_links,
        interior_breaks=interior_breaks,
        worst_ccy=worst,
        newest_bal=newest_bal,
        newest_ts=newest_ts,
        close_broken=frozenset(close_broken),
        break_kinds=dict(kinds),
        break_prev_kinds=dict(prev_kinds),
        break_mgn_modes=dict(mgn_modes),
        break_pos_level=pos_level,
        max_residual_rel=max(residuals, default=None),
        max_close_residual_rel=max(close_residuals, default=None),
        sig_bal_unchanged=sigs[0],
        sig_double_count=sigs[1],
        sig_reorder=sigs[2],
        sig_other=sigs[3],
        billid_ts_inversions=inversions,
        same_ts_links=same_ts_links,
        same_ts_breaks=same_ts_breaks,
        trail_ccys=trail_ccys,
        gap_estimate=gap_estimate,
        closes_by_ts_id=closes_by_ts_id,
        closes_by_ts_id_desc=closes_by_ts_id_desc,
        first_break_age_ms=max(ages, default=None),
        last_break_age_ms=min(ages, default=None),
        breaks_in_recent_7d=sum(1 for age in ages if age < _WEEK_MS),
    )


@dataclass(frozen=True)
class CloseRace:
    """Whether the close arm only failed because the cash balance moved during the walk."""

    #: Currencies whose cash balance differs between the read before and the read after the walk.
    cash_moved: int
    #: Close-broken currencies whose newest ``bal`` equals the cash balance read AFTER the walk.
    matches_after: int


async def read_cash_after(exchange: Any) -> dict[str, Decimal]:
    """``ccy -> cashBal`` from one balance GET made after the walk.

    A malformed reply is ``OpeningUnavailable("malformed_balance")``; a venue exception
    propagates unchanged (the caller records it by class).
    """
    row = await obal.read_okx_balance_row(exchange)
    if row is None:
        raise obal.OpeningUnavailable("malformed_balance")
    return obal.cash_balances(row)


def close_race(
    report: ChainReport,
    cash_before: Mapping[str, Decimal],
    cash_after: Mapping[str, Decimal],
) -> CloseRace:
    """Count the currencies whose cash moved, and the close breaks the later read clears."""
    zero = Decimal(0)
    moved = sum(
        1 for ccy in report.newest_bal if cash_before.get(ccy, zero) != cash_after.get(ccy, zero)
    )
    matches = sum(
        1 for ccy in report.close_broken if report.newest_bal[ccy] == cash_after.get(ccy, zero)
    )
    return CloseRace(cash_moved=moved, matches_after=matches)


def opening_ms(day: date) -> int:
    """00:00 UTC of ``day`` in epoch milliseconds, computed exactly as ``read_okx_opening`` does."""
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


def balance_utimes(row: Mapping[str, Any]) -> dict[str, int]:
    """``ccy -> uTime`` (the balance row's own update time) for the entries that carry one.

    Only an all-ASCII-digit string is a clock; anything else is skipped, never guessed. The
    caller has already run ``cash_balances`` on the row, which proves ``details`` is a list of
    dicts, but this stays tolerant on its own.
    """
    details = row.get("details")
    if not isinstance(details, list):
        return {}
    out: dict[str, int] = {}
    for detail in details:
        if not isinstance(detail, dict):
            continue
        ccy = detail.get("ccy")
        clock = obal._digits(detail.get("uTime"))
        if isinstance(ccy, str) and ccy and clock is not None:
            out[ccy] = clock
    return out


def utime_race(report: ChainReport, utimes: Mapping[str, int]) -> tuple[int, int] | None:
    """(currencies whose newest bill is LATER than the balance's clock, currencies whose clock is
    later than their newest bill), over the walked currencies that have a clock.

    A bill newer than the balance row means the row was read before that bill landed (a stale or
    lagging balance); a clock newer than the newest bill means the balance moved with no bill the
    walk saw. None when no walked currency has a clock: not measured, never zero.
    """
    shared = [ccy for ccy in report.newest_ts if ccy in utimes]
    if not shared:
        return None
    bill_later = sum(1 for ccy in shared if report.newest_ts[ccy] > utimes[ccy])
    clock_later = sum(1 for ccy in shared if utimes[ccy] > report.newest_ts[ccy])
    return bill_later, clock_later


async def repeat_chain_verdict(exchange: Any, opening_ms: int) -> str:
    """The chain verdict of a SECOND walk, not a second opening.

    Replays the oracle's chain decision (``read_okx_opening``'s order: cash balances, walk, an
    empty walk, ``per_ccy_opening``) on a fresh balance row, without pricing, so it never returns
    ``unpriced_ccy`` and needs no database. ``"none"`` on the same reason-free pass, otherwise the
    oracle's own reason. Read beside the first reading it separates a transient break (the second
    walk closes) from a structural one (the same reason again). Every other exception, a venue
    fault or ``CallCeilingReached``, propagates.
    """
    row = await obal.read_okx_balance_row(exchange)
    if row is None:
        return "malformed_balance"
    try:
        cash = obal.cash_balances(row)
        bills = await obal.walk_okx_bills_archive(exchange, opening_ms)
        if not bills:
            raise obal.OpeningUnavailable("reach_unproven")
        obal.per_ccy_opening(bills, cash)
    except obal.OpeningUnavailable as exc:
        return exc.reason
    return "none"


@dataclass(frozen=True)
class BelowStop:
    """In-window bills the archive serves BELOW the walk's smallest kept ``billId``."""

    count: int
    ccys: int
    #: False on a full page: a ``begin``-bounded reply may be oldest first, so one page is a
    #: presence check and not a walk.
    complete: bool


async def read_below_stop(
    exchange: Any, opening_ms: int, walked: Sequence[Mapping[str, str]]
) -> BelowStop:
    """ONE ``begin``-bounded archive page below the walk's smallest ``billId``.

    The walk stops at the first page that holds a bill older than the opening, so an in-window
    bill whose ``billId`` sits below that page is never read. This counts them (ts at or after
    the opening, ``billId`` below the walk's smallest) and their currencies.
    """
    stop = min(int(b["billId"]) for b in walked)
    params = {"limit": str(obal.BILLS_ARCHIVE_PAGE_ROWS), "begin": str(opening_ms), "after": str(stop)}
    reply: Any = await _okx_bills_fetch_with_backoff(
        exchange, obal._BILLS_METHOD, params, label="chain-below-stop", page=1
    )
    rows = obal._page_rows(reply)
    below = [
        bill
        for bill in (obal._parse_bill(r) for r in rows)
        if int(bill["ts"]) >= opening_ms and int(bill["billId"]) < stop
    ]
    return BelowStop(
        count=len(below),
        ccys=len({b["ccy"] for b in below}),
        complete=len(rows) < obal.BILLS_ARCHIVE_PAGE_ROWS,
    )


#: Pages of the 7-day ``/account/bills`` store read before giving up (a page is 100 bills).
RECENT_PAGE_CEILING: Final[int] = 10

#: The archive's documented ``instType`` filter values (OKX v5 docs).
SWEEP_INST_TYPES: Final[tuple[str, ...]] = ("SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION", "EVENTS")

_RECENT_METHOD: Final[str] = "private_get_account_bills"
_SUBTYPES_METHOD: Final[str] = "private_get_account_subtypes"
_TYPE_CODE = re.compile(r"[0-9]{1,4}")


@dataclass(frozen=True)
class RecentRead:
    """What the 7-day store served, newest first."""

    rows: tuple[dict[str, str], ...]
    #: True only when a short page ended the read. A stalled cursor, the page ceiling and the
    #: call ceiling all leave it False.
    complete: bool
    ceiling_hit: bool
    #: Pages the venue refused or served malformed (the read stops at the first): a deterministic
    #: refusal shows here instead of looking like an unexplained incomplete read.
    refused: int = 0


async def read_recent_bills(exchange: Any) -> RecentRead:
    """Page ``GET /account/bills`` (the last 7 days) newest first by ``after``.

    Every page goes through the 429 backoff helper. The read ends complete on a page shorter
    than the page size, incomplete on a stalled cursor (a page whose smallest ``billId`` is not
    below the cursor; that repeat is not kept) or after ``RECENT_PAGE_CEILING`` pages, and on
    ``CallCeilingReached`` returns the rows so far with ``ceiling_hit``.
    """
    rows: list[dict[str, str]] = []
    cursor: int | None = None
    try:
        for page_no in range(1, RECENT_PAGE_CEILING + 1):
            params = {"limit": str(obal.BILLS_ARCHIVE_PAGE_ROWS)}
            if cursor is not None:
                params["after"] = str(cursor)
            reply: Any = await _okx_bills_fetch_with_backoff(
                exchange, _RECENT_METHOD, params, label="chain-recent", page=page_no
            )
            page = [obal._parse_bill(r) for r in obal._page_rows(reply)]
            if len(page) < obal.BILLS_ARCHIVE_PAGE_ROWS:
                rows.extend(page)
                return RecentRead(tuple(rows), True, False)
            page_min = min(int(b["billId"]) for b in page)
            if cursor is not None and page_min >= cursor:
                return RecentRead(tuple(rows), False, False)
            rows.extend(page)
            cursor = page_min
    except CallCeilingReached:
        return RecentRead(tuple(rows), False, True)
    except ccxt.AuthenticationError:
        raise
    except (ccxt.ExchangeError, obal.OpeningUnavailable):
        # The venue refused a page, or served one the parser refuses: keep the pages already
        # read, as an incomplete read.
        return RecentRead(tuple(rows), False, False, refused=1)
    return RecentRead(tuple(rows), False, False)


@dataclass(frozen=True)
class RecentOverlap:
    """The 7-day store against the walk: who has what."""

    both: int
    #: In the 7-day store only, and not after the walk: a real absence from the archive walk.
    only_bills: int
    #: In the 7-day store above the walk's largest ``billId`` and stamped at or after the walk's
    #: start: it arrived after the walk began.
    after_walk: int
    #: Walked bills stamped after the 7-day store's oldest bill that the store lacks.
    only_archive: int
    field_mismatch: int
    only_bills_kinds: Mapping[tuple[str, str, str], int]
    #: The newest stamp the 7-day store holds from before the walk began, minus the walk's newest;
    #: None when the store held no such bill.
    behind_ms: int | None


def _after_the_walk(bill: Mapping[str, str], walk_max: int, walk_started_ms: int) -> bool:
    """A bill the walk cannot have served: above its largest ``billId`` AND stamped at or after the
    instant it began. A bill above the largest ``billId`` but stamped BEFORE that instant is one the
    archive should have served (a hidden bill newer than every served bill), never one that arrived
    later."""
    return int(bill["billId"]) > walk_max and int(bill["ts"]) >= walk_started_ms


def _same_bill(a: Mapping[str, str], b: Mapping[str, str]) -> bool:
    return (
        a["ccy"] == b["ccy"]
        and a["ts"] == b["ts"]
        and Decimal(a["bal"]) == Decimal(b["bal"])
        and Decimal(a["balChg"]) == Decimal(b["balChg"])
    )


def recent_overlap(
    walked: Sequence[Mapping[str, str]],
    recent_rows: Sequence[Mapping[str, str]],
    opening_ms: int,
    walk_started_ms: int,
) -> RecentOverlap:
    """Compare the walked bills with the 7-day store by ``billId`` (pure).

    ``walk_started_ms`` is the wall-clock instant the walk began. A 7-day bill the walk did not
    serve is ``only_bills`` unless it is after the walk (above the walk's largest ``billId`` and
    stamped at or after that instant)."""
    walk_by_id = {b["billId"]: b for b in walked}
    recent_by_id = {b["billId"]: b for b in recent_rows}
    walk_max = max((int(i) for i in walk_by_id), default=0)

    both = [i for i in recent_by_id if i in walk_by_id]
    only_bills = [
        recent_by_id[i]
        for i in recent_by_id
        if i not in walk_by_id
        and not _after_the_walk(recent_by_id[i], walk_max, walk_started_ms)
        and int(recent_by_id[i]["ts"]) >= opening_ms
    ]
    after_walk = sum(
        1 for i in recent_by_id if i not in walk_by_id and _after_the_walk(recent_by_id[i], walk_max, walk_started_ms)
    )
    oldest = min((int(b["ts"]) for b in recent_rows), default=None)
    only_archive = (
        0
        if oldest is None
        else sum(1 for i, b in walk_by_id.items() if i not in recent_by_id and int(b["ts"]) > oldest)
    )
    # Lag is measured over bills that existed before the walk began: a bill created during the run
    # is not the archive lagging.
    newest_recent = max((int(b["ts"]) for b in recent_rows if int(b["ts"]) < walk_started_ms), default=None)
    newest_walked = max((int(b["ts"]) for b in walked), default=0)
    return RecentOverlap(
        both=len(both),
        only_bills=len(only_bills),
        after_walk=after_walk,
        only_archive=only_archive,
        field_mismatch=sum(1 for i in both if not _same_bill(walk_by_id[i], recent_by_id[i])),
        only_bills_kinds=dict(Counter(_kind(b) for b in only_bills)),
        behind_ms=None if newest_recent is None else newest_recent - newest_walked,
    )


async def read_bill_types(exchange: Any) -> tuple[str, ...]:
    """The bill type codes ``GET /account/subtypes`` lists, in numeric order, deduplicated.

    ONE call through the backoff helper. Both shapes the archive job's parser accepts are read
    (a ``type`` entry with a nested ``subTypeDetails`` list, and a flat ``{type, subType}``
    entry); a type code is one to four ASCII digits. An unrecognisable reply is zero types, a
    count the record prints, never a pass.
    """
    reply: Any = await _okx_bills_fetch_with_backoff(
        exchange, _SUBTYPES_METHOD, {}, label="chain-subtypes", page=0
    )
    if not isinstance(reply, Mapping):
        return ()
    data = reply.get("data")
    if not isinstance(data, list):
        return ()
    types: set[str] = set()
    for item in data:
        if not isinstance(item, Mapping):
            continue
        recognised = isinstance(item.get("subTypeDetails"), list) or item.get("subType") is not None
        code = item.get("type")
        if recognised and isinstance(code, str) and _TYPE_CODE.fullmatch(code):
            types.add(code)
    return tuple(sorted(types, key=int))


@dataclass(frozen=True)
class Sweep:
    """Which filters serve an in-window bill the unfiltered walk never served."""

    types_probed: int
    types_hidden: int
    inst_types_probed: int
    inst_types_hidden: int
    #: Probes that returned a full page: a presence check that may have missed more.
    partial: int
    #: Raw (type, subType, instType) of the hidden bills, each bill counted once across filters.
    hidden_kinds: Mapping[tuple[str, str, str], int]
    complete: bool
    ceiling_hit: bool
    #: Filters the venue refused or answered with a page the parser refuses.
    refused: int = 0


async def sweep_hidden(
    exchange: Any,
    opening_ms: int,
    walked: Sequence[Mapping[str, str]],
    types: Sequence[str],
    walk_started_ms: int,
) -> Sweep:
    """Probe each bill type, then each documented ``instType``, with ONE ``begin``-bounded archive page.

    A bill is hidden when its ``billId`` is not in the walk, its stamp is at or after the opening
    instant and it is not after the walk (above the walk's largest ``billId`` and stamped at or
    after ``walk_started_ms``). Above the walk's largest ``billId`` the archive may only have been
    late to ingest a bill (this sweep runs well after the walk), so such a bill that one unfiltered
    newest-first page read now also serves is not hidden by its type. A
    filter with at least one hidden bill counts as hidden. ``CallCeilingReached`` stops the
    sweep incomplete; a filter the venue refuses (an exchange error other than authentication) is
    skipped and leaves it incomplete, with the probes already measured kept (so is a page the
    parser refuses). A 429 that outlives
    the backoff, a network fault and an authentication failure propagate.
    """
    walked_ids = {b["billId"] for b in walked}
    walk_max = max((int(i) for i in walked_ids), default=0)
    filters = [("type", t) for t in types] + [("instType", i) for i in SWEEP_INST_TYPES]
    probed = {"type": 0, "instType": 0}
    hidden_filters = {"type": 0, "instType": 0}
    partial = 0
    seen: set[str] = set()
    kinds: Counter[tuple[str, str, str]] = Counter()
    ceiling_hit = False
    rejected = 0
    served_now: set[str] = set()
    try:
        newest: Any = await _okx_bills_fetch_with_backoff(
            exchange, obal._BILLS_METHOD, {"limit": str(obal.BILLS_ARCHIVE_PAGE_ROWS)},
            label="chain-sweep-unfiltered", page=1,
        )
        page = [obal._parse_bill(r) for r in obal._page_rows(newest)]
        served_now = {b["billId"] for b in page}
        if len(page) >= obal.BILLS_ARCHIVE_PAGE_ROWS and min(int(b["billId"]) for b in page) > walk_max:
            # A full page that stops above the walk could not rule lag out below it.
            rejected += 1
    except CallCeilingReached:
        return Sweep(0, 0, 0, 0, 0, {}, False, True)
    except ccxt.AuthenticationError:
        raise
    except (ccxt.ExchangeError, obal.OpeningUnavailable):
        # Without the unfiltered page an above-walk bill cannot be told from lag: the sweep still
        # runs (such a bill counts as hidden) and says it is not complete.
        rejected += 1
    for name, value in filters:
        params = {name: value, "begin": str(opening_ms), "limit": str(obal.BILLS_ARCHIVE_PAGE_ROWS)}
        try:
            reply: Any = await _okx_bills_fetch_with_backoff(
                exchange, obal._BILLS_METHOD, params, label="chain-sweep", page=1
            )
        except CallCeilingReached:
            ceiling_hit = True
            break
        except ccxt.AuthenticationError:
            raise
        except ccxt.ExchangeError:
            # The venue refused this one filter: the probes already measured stay, and the
            # sweep is no longer complete.
            rejected += 1
            continue
        try:
            rows = obal._page_rows(reply)
            parsed = [obal._parse_bill(r) for r in rows]
        except obal.OpeningUnavailable:
            # A page the parser refuses is a filter that did not answer: same as a refusal.
            rejected += 1
            continue
        hidden = [
            bill
            for bill in parsed
            if bill["billId"] not in walked_ids
            and not _after_the_walk(bill, walk_max, walk_started_ms)
            and int(bill["ts"]) >= opening_ms
            and bill["billId"] not in (served_now if int(bill["billId"]) > walk_max else ())
        ]
        probed[name] += 1
        if len(rows) >= obal.BILLS_ARCHIVE_PAGE_ROWS:
            partial += 1
        if hidden:
            hidden_filters[name] += 1
        for bill in hidden:
            if bill["billId"] not in seen:
                seen.add(bill["billId"])
                kinds[_kind(bill)] += 1
    return Sweep(
        types_probed=probed["type"],
        types_hidden=hidden_filters["type"],
        inst_types_probed=probed["instType"],
        inst_types_hidden=hidden_filters["instType"],
        partial=partial,
        hidden_kinds=dict(kinds),
        # A sweep that probed no type filter (an unrecognised /account/subtypes reply) searched
        # for hidden types in no place at all, and a refused filter was not searched either:
        # that is "not measured", never a complete sweep.
        complete=not ceiling_hit and rejected == 0 and probed["type"] > 0,
        ceiling_hit=ceiling_hit,
        refused=rejected,
    )
