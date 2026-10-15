"""Phase 167.1.1.1 (BRIDGERETURNS) D-03: the spot half of the shared mark-price rule.

A holding's return is the change of its daily MARK PRICE, never of its dollar value,
so buying, selling or moving more of an asset is not read as a gain or a loss. This
module is the Python twin of ``classifySpotMarks`` in
``src/app/(dashboard)/compare/lib/holding-compare-adapter.ts``. Both runtimes replay
the ONE hand-typed fixture ``tests/fixtures/holding_mark_returns_cases.json``; a rule
change lands in both or neither.

The rule (founder D-03, "Python adopts the TypeScript rule as written"):

* One mark per UTC day, from the row with the latest ``updated_at`` INSTANT
  (``written_at_micros``), ties to the smallest LOWERCASE ``api_key_id``.
* A finite mark at or below 0 is a GAP, skipped BEFORE that pick, so a later failed
  poll never eclipses a valid mark. Nothing is zero-filled or forward-filled.
* A return exists only between two ADJACENT calendar days that both carry a mark, and
  is keyed by the LATER day. A missing day breaks the chain.
* A spot holding needs ``MIN_PRICED_DAYS`` priced days or it is withheld as
  ``too_few_priced_days``.
* A mark that is not a finite number, or an ``asof`` that is not a real calendar date,
  is a read-contract violation (``HoldingMarkContractError``), never a gap.

Pure: no I/O, and nothing here logs a row value.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Final

from services.allocator_equity_derive import written_at_micros
from services.closed_sets import CRYPTO_VENUES, STABLECOINS

# Twin of HOLDING_COMPARE_MIN_PRICED_DAYS (TypeScript); the shared fixture pins both.
MIN_PRICED_DAYS: Final[int] = 30

# Twin of HOLDING_MARK_WITHHELD_REASONS (TypeScript); the shared fixture pins both.
PRICE_RULE_WITHHELD_REASONS: Final[frozenset[str]] = frozenset(
    {"account_balance", "fixed_price", "no_price", "too_few_priced_days"}
)

# ASCII digits only and fullmatch: a bare ``\d`` would accept other scripts' digits and
# ``$`` would accept a trailing newline, neither of which the TypeScript twin does.
_ISO_DAY: Final = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class HoldingMarkContractError(ValueError):
    """A stored row broke the read contract: ``mark_price`` is ``numeric NOT NULL`` and
    ``asof`` is a ``date``. Carries COUNTS only, never a row value. Twin of
    ``HoldingMarkContractError`` in holding-compare-adapter.ts."""

    def __init__(self, bad_marks: int, bad_days: int) -> None:
        super().__init__(
            f"holding rows broke the read contract (marks: {bad_marks}, days: {bad_days})"
        )
        self.bad_marks = bad_marks
        self.bad_days = bad_days


@dataclass(frozen=True)
class DailyMark:
    """One priced day: its ``YYYY-MM-DD`` UTC day and its mark price (above 0)."""

    asof: str
    price: float


@dataclass(frozen=True)
class HoldingMarks:
    """What the spot rule says about one holding.

    ``withheld_reason`` is None when the holding is priced well enough to use.
    ``priced_days`` and ``returns`` are filled whenever marks were read, including the
    ``too_few_priced_days`` case; they are 0 and empty when a venue or symbol gate
    withheld the holding BEFORE any mark was read. ``returns`` pairs each LATER day
    with its adjacent-day return."""

    withheld_reason: str | None
    priced_days: int
    returns: tuple[tuple[str, float], ...]


def _is_finite_number(value: object) -> bool:
    # bool is an int subclass: a stored True must be a violation, as ``typeof`` is in TS.
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _is_real_day(value: object) -> bool:
    if not isinstance(value, str) or _ISO_DAY.fullmatch(value) is None:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def daily_mark_prices(rows: Sequence[Mapping[str, Any]]) -> list[DailyMark]:
    """One mark per calendar day, ascending by ``asof``.

    Every row is checked for the read contract FIRST (a violation raises
    ``HoldingMarkContractError`` carrying counts), then marks at or below 0 are skipped,
    then per ``asof`` the row minimising ``(-written_at_micros(updated_at),
    api_key_id.lower())`` wins: the trick ``one_key_per_account_day`` uses, so two keys
    holding the asset on one venue never merge or double a day. Raises
    ``HoldingsUpdatedAtError`` on an unusable ``updated_at`` of a row that reaches the
    pick. Twin of ``dailyMarkPrices``."""
    bad_marks = 0
    bad_days = 0
    for row in rows:
        if not _is_finite_number(row.get("mark_price")):
            bad_marks += 1
        if not _is_real_day(row.get("asof")):
            bad_days += 1
    if bad_marks > 0 or bad_days > 0:
        raise HoldingMarkContractError(bad_marks, bad_days)

    best: dict[str, tuple[tuple[int, str], float]] = {}
    for row in rows:
        mark = float(row["mark_price"])
        if not mark > 0:
            continue
        order = (-written_at_micros(row.get("updated_at")), str(row["api_key_id"]).lower())
        asof = str(row["asof"])
        current = best.get(asof)
        if current is None or order < current[0]:
            best[asof] = (order, mark)
    return [DailyMark(asof=asof, price=best[asof][1]) for asof in sorted(best)]


def adjacent_daily_returns(points: Sequence[DailyMark]) -> list[tuple[str, float]]:
    """``(later_asof, p_i / p_(i-1) - 1)`` for each pair of consecutive points whose days
    differ by exactly one calendar day. A missing day breaks the chain, so no return
    spans a gap. Twin of ``adjacentDailyReturns``."""
    out: list[tuple[str, float]] = []
    for earlier, later in zip(points, points[1:]):
        gap = date.fromisoformat(later.asof) - date.fromisoformat(earlier.asof)
        if gap.days == 1:
            out.append((later.asof, later.price / earlier.price - 1))
    return out


def spot_withheld_reason(venue: str, symbol: str) -> str | None:
    """Why a spot holding's recorded price is not a market price, or None.

    A venue that is not a crypto exchange is an account balance (``account_balance``)
    whatever its symbol, so it is tested FIRST; then sFOX or a stablecoin symbol is a
    writer constant (``fixed_price``). Case-insensitive. Twin of ``holdingWithheldReason``."""
    if venue.lower() not in CRYPTO_VENUES:
        return "account_balance"
    if venue.lower() == "sfox" or symbol.upper() in STABLECOINS:
        return "fixed_price"
    return None


def classify_spot_marks(
    rows: Sequence[Mapping[str, Any]], *, venue: str, symbol: str
) -> HoldingMarks:
    """The spot withheld ladder, in this order (twin of ``classifySpotMarks``):

    1. ``account_balance``, then ``fixed_price``: decided from venue and symbol alone,
       marks are NOT read (a malformed mark on such a row is not a contract error);
    2. the read contract (``daily_mark_prices`` raises);
    3. ``no_price``: no day carries a valid mark;
    4. ``too_few_priced_days``: fewer than ``MIN_PRICED_DAYS`` priced days, with
       ``priced_days`` and ``returns`` still filled;
    5. otherwise withheld is None.
    """
    reason = spot_withheld_reason(venue=venue, symbol=symbol)
    if reason is not None:
        return HoldingMarks(withheld_reason=reason, priced_days=0, returns=())
    points = daily_mark_prices(rows)
    returns = tuple(adjacent_daily_returns(points))
    if not points:
        return HoldingMarks(withheld_reason="no_price", priced_days=0, returns=())
    if len(points) < MIN_PRICED_DAYS:
        return HoldingMarks(
            withheld_reason="too_few_priced_days", priced_days=len(points), returns=returns
        )
    return HoldingMarks(withheld_reason=None, priced_days=len(points), returns=returns)
