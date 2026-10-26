"""The marks writer (Phase 167.2.1.1.1 NAVMTM, plan 06): store each key's marked NAV, once a day.

What this is for
----------------
From the day NAVMTM deploys, every derive of an OKX, Deribit, MT5 or sFOX key stores that
key's marked-to-market NAV (equity INCLUDING open profit), the open profit itself, the
instant the equity was read, and the native figures, in ``api_key_nav_marks``. This module
is the writer's whole logic: build the mark from the read the derive already made, insert
it write-once, and hand back the row the database holds. Consuming marks (applying them to
returns and to the compose inputs) is plan 07's. Bybit and Binance are plan 15's (L4, D-10
as amended by D-16): their marked equity needs a positions read plan 06 does not make, so
``UNIFORM_READ_VENUES`` below does not list them. Plan 15 reads them the way the reconstruct
anchor does (``equity_reconstruction.read_marked_equity_usd``) and hands the result to
``build_mark_read(marked_equity=...)``, which keeps the mark open profit only (D-04).

The decisions it carries
------------------------
D-01  One row per key per day in ``api_key_nav_marks`` (plan 01's table).
D-02  The mark comes from the equity read the derive ALREADY made. ``build_mark_read`` is a
      pure function of that read; it makes no venue call.
D-03  ``marked_at`` is the UTC instant OUR derive finished its equity read, and the mark is
      labelled the UTC day that just closed: ``mark_day = UTC date of marked_at - 1``
      (``mark_day_for``). The table's CHECK enforces the same equation, so a drifted label
      is refused by the database as well.
D-06  First writer wins. ``write_nav_mark`` inserts ``ON CONFLICT DO NOTHING``
      (``upsert(..., ignore_duplicates=True)``), which needs INSERT alone: ``service_role``
      holds no UPDATE or DELETE on the table.
D-07  Store the native amount and unit, the USD figure and the close day that priced it. A
      USD-family read stores unit ``USD`` with native amounts equal to the USD ones and no
      ``price_day``. A BTC-unit MT5 account stores unit ``BTC``, its native equity and open
      profit, the USD figures priced through ``price_live_balance`` at the stored close of
      ``latest_completed_close_day`` (which IS the mark day), and that day as ``price_day``.
      Deribit is multi-currency, so it stores no single native number: ``native_detail``
      carries the per-currency native equity and open profit and ``usd_basis`` (the pricing
      basis of the USD figures: each currency at Deribit's own index read at ``marked_at``).
D-09  No backfill. This module reads no position history of any kind: ``api_key_nav_marks``
      is the only table it touches, and a test spies on every table name it is given.
D-10  Bybit and Binance get a positions read of their own (plan 15, amended by D-16).
D-11  No time-of-day window. A read at any time of the UTC day after the label still writes
      the mark, and ``marked_at`` records the real time.
L3    A re-derive never replaces a stored mark: the insert is write-once.
L4    Bybit and Binance marked equity is wallet balance plus position open profit, read the way
      the reconstruct anchor reads it (``MARKED_EQUITY_VENUES`` below, plan 15).

Pitfall 1: THE STORED ROW, NEVER THE LOCAL READ, IS THE AUTHORITY
-----------------------------------------------------------------
Two derives for one key on one UTC day (the key-mode fan-out and a strategy-mode derive)
read the venue seconds apart. The loser's insert is ignored, but if its own read then fed
its series the stored mark and the persisted returns would disagree by the move between the
two reads. ``write_nav_mark`` therefore re-selects the row for ``(api_key_id, mark_day)``
after the insert and returns THAT row. A caller keeps what comes back and never its own
``MarkRead``.

Refuse, never invent
--------------------
``build_mark_read`` returns a token from the closed set ``MARK_REFUSAL_TOKENS`` instead of a
mark when the read cannot be trusted. A refusal writes nothing and never fails the derive.
Tokens and counts are the only thing it ever logs: no amount, no venue error text.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Final, NamedTuple

import pandas as pd

from services.native_to_usd import price_live_balance
from services.nav_twr import DUST_NAV_FLOOR

#: The table plan 01 created. Named once so a typo cannot split reader from writer.
MARKS_TABLE: Final[str] = "api_key_nav_marks"

#: The native unit this writer can price into USD (the MT5 BTC-unit account). Any other
#: native unit is refused with ``native_unit``. ``job_worker._BTC_PRICED_UNIT`` is the same
#: value, pinned equal by a test.
PRICED_NATIVE_UNIT: Final[str] = "BTC"

#: The venues whose mark comes from the equity read the derive already makes (D-02), so the
#: writer adds no venue call for them. Bybit and Binance (L4, D-16) are plan 15's.
UNIFORM_READ_VENUES: Final[frozenset[str]] = frozenset({"okx", "deribit", "mt5", "sfox"})

#: The venues whose mark is the reconstruct anchor's own reading (L4, plan 15): wallet balance
#: plus position open profit, read through ``equity_reconstruction.read_marked_equity_usd``.
MARKED_EQUITY_VENUES: Final[frozenset[str]] = frozenset({"bybit", "binance"})

#: Deribit's ``native_detail["usd_basis"]``: each currency's native amount priced at
#: Deribit's own index read at ``marked_at`` (no daily close, so ``price_day`` stays NULL).
DERIBIT_USD_BASIS: Final[str] = "venue_index_at_marked_at"

#: Every reason a mark is refused. The first seven are the ones this plan's ladder can raise
#: by itself; the next three are the positions/wallet reasons plan 15 supplies for Bybit and
#: Binance through ``build_mark_read(refusal=...)``, and the last five are plan 18's D-17
#: reasons for a Bybit account whose Unified Trading Account totals cannot describe it, plus plan
#: 19's two D-18 reasons for an OKX or Binance account whose option value the NAV is not shown to
#: carry. They live here so an operator reads one
#: set. ``native_unit`` / ``native_unpriced`` / ``balance_error`` / ``nonfinite`` /
#: ``nonpositive`` / ``dust`` are the epilogue's ``anchor_null_reason`` words.
MARK_REFUSAL_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "balance_error",
        "upnl_unreadable",
        "nonfinite",
        "nonpositive",
        "dust",
        "native_unit",
        "native_unpriced",
        "positions_unreadable",
        "wallet_unpriced",
        "wallet_basis_mismatch",
        # D-17 (plan 18): the Bybit Unified Trading Account totals cannot describe this account.
        "account_mode_unsupported",
        "isolated_margin_unsupported",
        "borrow_present",
        "uta_totals_unreadable",
        "uta_wallet_mismatch",
        # D-18 (plan 19): the account holds option value the NAV is not shown to carry
        # (``option_value_unverified``), or its option positions could not be read
        # (``option_value_unreadable``). OKX (D-19) and Binance (D-20, D-22).
        "option_value_unverified",
        "option_value_unreadable",
    }
)

#: Keyset page size and ceiling for ``read_key_marks``. A key has at most one mark a day, so
#: the ceiling (one million rows) is a corruption tripwire, never a working limit.
_MARKS_PAGE_SIZE: Final[int] = 1000
_MARKS_HARD_CAP_PAGES: Final[int] = 1000

_STORED_COLUMNS: Final[str] = (
    "mark_day,marked_at,venue,nav_usd,open_pnl_usd,nav_native,open_pnl_native,native_unit"
)


class NavMarkError(RuntimeError):
    """A stored mark could not be written or read back. Static text, no amount."""


@dataclass(frozen=True)
class MarkRead:
    """One mark as this derive read it, before the database has had its say.

    Never an authority on its own (Pitfall 1): ``write_nav_mark`` returns the stored row.
    """

    venue: str
    mark_day: date
    marked_at: datetime
    nav_usd: float
    open_pnl_usd: float
    nav_native: float | None
    open_pnl_native: float | None
    native_unit: str | None
    price_day: date | None
    native_detail: dict[str, Any] | None

    def to_row(self, api_key_id: str, allocator_id: str) -> dict[str, Any]:
        """The insert dict: ISO strings, every float checked finite (JSONB and NUMERIC both
        refuse NaN, and a refusal at the database would loop the job's retries)."""
        for name in ("nav_usd", "open_pnl_usd", "nav_native", "open_pnl_native"):
            value = getattr(self, name)
            if value is not None and not math.isfinite(value):
                raise ValueError(f"MarkRead.{name} is not finite")
        if self.mark_day != mark_day_for(self.marked_at):
            # The table's CHECK says the same; failing here names the cause.
            raise ValueError("MarkRead.mark_day is not the UTC day before marked_at")
        return {
            "api_key_id": api_key_id,
            "allocator_id": allocator_id,
            "mark_day": self.mark_day.isoformat(),
            "marked_at": self.marked_at.astimezone(timezone.utc).isoformat(),
            "venue": self.venue,
            "nav_usd": self.nav_usd,
            "open_pnl_usd": self.open_pnl_usd,
            "nav_native": self.nav_native,
            "open_pnl_native": self.open_pnl_native,
            "native_unit": self.native_unit,
            "price_day": self.price_day.isoformat() if self.price_day is not None else None,
            "native_detail": self.native_detail,
        }


class StoredMark(NamedTuple):
    """One row as the database holds it. The authority for everything downstream."""

    mark_day: str
    marked_at: str
    venue: str
    nav_usd: float
    open_pnl_usd: float
    nav_native: float | None
    native_unit: str | None
    open_pnl_native: float | None = None


def mark_day_for(marked_at: datetime) -> date:
    """The UTC date of ``marked_at`` minus one day (D-03, D-11).

    A read at 00:10Z on the 2nd labels the 1st, and a retry at 23:59:59Z on the 2nd still
    does. There is no time-of-day window. ``marked_at`` must be timezone-aware.
    """
    if marked_at.tzinfo is None or marked_at.tzinfo.utcoffset(marked_at) is None:
        raise ValueError("mark_day_for needs a timezone-aware datetime")
    return marked_at.astimezone(timezone.utc).date() - timedelta(days=1)


def deribit_native_detail(
    native_equity: Mapping[str, float],
    native_upnl: Mapping[str, float],
    open_profit: Mapping[str, float],
) -> dict[str, Any]:
    """Deribit's ``native_detail`` (D-07, OQ-4): the per-currency native equity, session uPnL and
    open profit from the SAME account summary the collapsed USD figures came from, plus the
    pricing basis of those USD figures. Sorted by currency so equal reads store equal JSON.

    ``upnl`` is the per-currency SESSION uPnL (futures plus options, as it has always been
    stored). ``open_profit`` is the per-currency NAV minus wallet in native units (NAVMTM D-21,
    ``equity - balance``), so ``sum(open_profit x index)`` is the stored ``open_pnl_usd``; a
    reader that wants the stored open profit takes this key and never the session uPnL."""
    return {
        "equity": {str(c): float(native_equity[c]) for c in sorted(native_equity)},
        "upnl": {str(c): float(native_upnl[c]) for c in sorted(native_upnl)},
        "open_profit": {str(c): float(open_profit[c]) for c in sorted(open_profit)},
        "usd_basis": DERIBIT_USD_BASIS,
    }


def _detail_is_finite(detail: Mapping[str, Any]) -> bool:
    for key in ("equity", "upnl", "open_profit"):
        side = detail.get(key)
        if not isinstance(side, Mapping):
            return False
        if not all(isinstance(v, float) and math.isfinite(v) for v in side.values()):
            return False
    return True


def build_mark_read(
    *,
    venue: str,
    marked_at: datetime,
    equity: float | None,
    open_pnl: float | None,
    balance_error: bool,
    upnl_unreadable: bool,
    native_unit: str | None = None,
    btc_closes: pd.Series | None = None,
    native_detail: Mapping[str, Any] | None = None,
    refusal: str | None = None,
    marked_equity: tuple[float, float, float] | str | None = None,
    usdt_wallet_usd: float | None = None,
) -> MarkRead | str:
    """Build a mark from the read the derive already made, or return a refusal token. Pure.

    ``equity`` and ``open_pnl`` are in the account's own unit: dollars for a USD-family
    read, the native unit for a native MT5 account (``native_unit`` names it). ``native_detail``
    marks a multi-currency read (Deribit) whose native figures are not one number.
    ``refusal`` carries a token the caller already decided (plan 15's positions and wallet
    reasons); it is judged after the read flags and before the arithmetic. With no figures to
    judge (``equity`` is ``None``) the token is returned as it stands rather than being
    reported as ``balance_error``.

    ``marked_equity`` (Bybit and Binance only, L4) is ``read_marked_equity_usd``'s result: the
    tuple ``(nav_usd, open_pnl_usd, wallet_usd)``, or the refusal token it returned. It stands
    in for ``equity``/``open_pnl`` (pass ``None`` for both) and ``usdt_wallet_usd`` is the
    derive's OWN USDT wallet figure, the level its realized series is anchored on. D-04: the
    mark must stay open profit, so a mark whose all-asset wallet differs from that figure by
    more than the anchor's own tolerance is refused ``wallet_basis_mismatch``; the step it would
    book as the first marked day's return would contain holdings the series never held.

    The ladder, in the order the key_inputs epilogue judges the same reasons: ``native_unit``,
    ``native_unpriced``, ``balance_error``, ``upnl_unreadable``, the caller's token,
    ``nonfinite``, ``nonpositive``, ``dust``. (A non-finite NATIVE amount is ``nonfinite``,
    judged before it is priced.)
    """
    mark_day = mark_day_for(marked_at)  # also refuses a naive datetime

    marked_wallet: float | None = None
    if marked_equity is not None:
        if (
            venue not in MARKED_EQUITY_VENUES
            or equity is not None
            or open_pnl is not None
            or native_unit is not None
            or native_detail is not None
            or refusal is not None
        ):
            raise ValueError(
                "build_mark_read: marked_equity is for Bybit and Binance and replaces "
                "equity, open_pnl and refusal"
            )
        if isinstance(marked_equity, str):
            refusal = marked_equity
        else:
            equity, open_pnl, marked_wallet = marked_equity

    if native_unit is not None and native_unit != PRICED_NATIVE_UNIT:
        return "native_unit"

    nav_usd: float | None
    open_usd: float | None
    price_day: date | None = None
    nav_native: float | None
    open_native: float | None
    unit_out: str | None
    if native_unit is not None and equity is not None and not math.isfinite(float(equity)):
        # Judged before pricing: a NaN amount is "not finite", never "no close".
        return "nonfinite"
    if native_detail is not None:
        # Multi-currency (Deribit): the USD figures are the collapsed ones the venue priced.
        nav_usd, open_usd = equity, open_pnl
        nav_native = open_native = None
        unit_out = None
    elif native_unit is None:
        # USD family: the native amounts equal the USD ones (NM-2).
        nav_usd, open_usd = equity, open_pnl
        nav_native, open_native = equity, open_pnl
        unit_out = "USD"
    else:
        # A priced native unit (BTC). Only the close of the mark day itself prices it: an
        # older close is never used (Pitfall 3), so a missing one refuses the mark.
        nav_native, open_native = equity, open_pnl
        unit_out = native_unit
        nav_priced = (
            price_live_balance(float(equity), native_unit, btc_closes, marked_at)
            if equity is not None
            else None
        )
        if nav_priced is None:
            return "native_unpriced"
        nav_usd, priced_day = nav_priced[0], nav_priced[1]
        price_day = priced_day.date()
        open_usd = None
        if open_pnl is not None:
            open_priced = price_live_balance(float(open_pnl), native_unit, btc_closes, marked_at)
            if open_priced is None:
                return "native_unpriced"
            open_usd = open_priced[0]

    if refusal is not None and refusal not in MARK_REFUSAL_TOKENS:
        raise ValueError("build_mark_read: refusal is not in MARK_REFUSAL_TOKENS")
    if balance_error or (nav_usd is None and refusal is None):
        return "balance_error"
    if upnl_unreadable or (open_usd is None and refusal is None):
        return "upnl_unreadable"
    if refusal is not None:
        return refusal
    assert nav_usd is not None and open_usd is not None  # both judged above
    finite = [nav_usd, open_usd]
    if nav_native is not None and open_native is not None:
        finite += [nav_native, open_native]
    if marked_wallet is not None:
        finite.append(marked_wallet)
        if usdt_wallet_usd is not None:
            finite.append(usdt_wallet_usd)
    if not all(math.isfinite(float(v)) for v in finite):
        return "nonfinite"
    if native_detail is not None and not _detail_is_finite(native_detail):
        return "nonfinite"
    if marked_wallet is not None:
        if usdt_wallet_usd is None:
            return "balance_error"  # the derive's own wallet read gave no figure to compare
        # Function-local: services.equity_reconstruction imports services.job_worker, which
        # imports this module, so a top-level import here is a cycle. Both modules are fully
        # loaded by the time this runs. The tolerance is the anchor's own shape, the larger of
        # 1 USD and 0.5% of the wallet (marks move between two sequential reads, and drift
        # follows the wallet's notional): reusing it means the mark and the anchor agree on what
        # "the same wallet" means. Beyond it the step would not be open profit (D-04).
        from services.equity_reconstruction import (
            _BYBIT_UPNL_TOLERANCE_REL,
            _BYBIT_UPNL_TOLERANCE_USD,
        )

        if abs(marked_wallet - usdt_wallet_usd) > max(
            _BYBIT_UPNL_TOLERANCE_USD, _BYBIT_UPNL_TOLERANCE_REL * abs(usdt_wallet_usd)
        ):
            return "wallet_basis_mismatch"
    if nav_usd <= 0.0:
        return "nonpositive"
    if abs(nav_usd) <= DUST_NAV_FLOOR:
        return "dust"

    return MarkRead(
        venue=venue,
        mark_day=mark_day,
        marked_at=marked_at.astimezone(timezone.utc),
        nav_usd=float(nav_usd),
        open_pnl_usd=float(open_usd),
        nav_native=None if nav_native is None else float(nav_native),
        open_pnl_native=None if open_native is None else float(open_native),
        native_unit=unit_out,
        price_day=price_day,
        native_detail=None if native_detail is None else dict(native_detail),
    )


def _parse_stored(row: Mapping[str, Any]) -> StoredMark:
    """A database row as a ``StoredMark``. A malformed row raises (KeyError, TypeError,
    ValueError): a stored mark that cannot be read is never silently skipped."""
    nav_native = row.get("nav_native")
    open_pnl_native = row.get("open_pnl_native")
    native_unit = row.get("native_unit")
    return StoredMark(
        mark_day=str(row["mark_day"]),
        marked_at=str(row["marked_at"]),
        venue=str(row["venue"]),
        nav_usd=float(row["nav_usd"]),
        open_pnl_usd=float(row["open_pnl_usd"]),
        nav_native=None if nav_native is None else float(nav_native),
        native_unit=None if native_unit is None else str(native_unit),
        open_pnl_native=None if open_pnl_native is None else float(open_pnl_native),
    )


def read_stored_mark(supabase: Any, api_key_id: str, mark_day: date) -> StoredMark | None:
    """The one stored mark for ``(api_key_id, mark_day)``, or ``None``. Sync: callers wrap it
    in ``db_execute``. Plan 15's derive calls it before the Bybit/Binance read (W3)."""
    result = (
        supabase.table(MARKS_TABLE)
        .select(_STORED_COLUMNS)
        .eq("api_key_id", api_key_id)
        .eq("mark_day", mark_day.isoformat())
        .limit(1)
        .execute()
    )
    rows = list(result.data or [])
    if not rows:
        return None
    return _parse_stored(rows[0])


def write_nav_mark(
    supabase: Any, read: MarkRead, *, api_key_id: str, allocator_id: str
) -> StoredMark:
    """Insert ``read`` write-once, then return the row the database holds for the day.

    ``ON CONFLICT DO NOTHING``: the first writer of ``(api_key_id, mark_day)`` wins (D-06) and
    a later one changes nothing. The row is re-selected and THAT row is returned, so the loser
    of a race uses the winner's figures and never its own read (Pitfall 1). A row that is
    missing after the insert cannot happen (the insert either wrote it or lost to one that
    did) and raises. Sync: callers wrap it in ``db_execute``. A database error bubbles and
    the job retries.
    """
    supabase.table(MARKS_TABLE).upsert(
        read.to_row(api_key_id, allocator_id),
        on_conflict="api_key_id,mark_day",
        ignore_duplicates=True,
    ).execute()
    stored = read_stored_mark(supabase, api_key_id, read.mark_day)
    if stored is None:
        raise NavMarkError(
            "api_key_nav_marks: no row for the key and day after an insert that cannot lose "
            "to anything but an existing row"
        )
    return stored


def read_key_marks(supabase: Any, api_key_id: str) -> list[StoredMark]:
    """Every stored mark of the key, ascending by ``mark_day``. Sync.

    KEYSET pagination on ``mark_day`` like ``analytics_runner._load_strategy_daily_returns``:
    ``(api_key_id, mark_day)`` is UNIQUE, so with the key fixed by ``eq`` a ``mark_day >
    cursor`` cursor is a total order and a page boundary can neither repeat nor skip a day.
    The read stops on the first EMPTY page, never a short one (PostgREST clamps ``limit`` to
    its ``max_rows``). Past the page ceiling it raises ``NavMarkError``.
    """
    out: list[StoredMark] = []
    pages = 0
    cursor: str | None = None
    while True:
        query = (
            supabase.table(MARKS_TABLE).select(_STORED_COLUMNS).eq("api_key_id", api_key_id)
        )
        if cursor is not None:
            query = query.gt("mark_day", cursor)
        result = query.order("mark_day", desc=False).limit(_MARKS_PAGE_SIZE).execute()
        chunk = list(result.data or [])
        if not chunk:
            return out
        if pages >= _MARKS_HARD_CAP_PAGES:
            raise NavMarkError("api_key_nav_marks: read hit the page ceiling")
        pages += 1
        parsed = [_parse_stored(r) for r in chunk]
        out.extend(parsed)
        cursor = parsed[-1].mark_day
