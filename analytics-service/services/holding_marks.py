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

The DERIVATIVE half (D-02, D-10, D-12) is signed. A derivative's return is the mark-price
return negated for a short, with the direction read from ``side`` ONLY (never from
quantity or value):

* A day's direction is the single value in {long, short} shared by ALL rows of that day,
  every key included and rows whose mark is a gap included. A day with a ``flat`` row, or
  with both long and short rows, has NO direction and is a gap: never a guessed sign.
* The return from day i-1 to day i carries DAY i-1's direction (the position held over
  the interval). It exists only when the two days are adjacent calendar days and BOTH are
  usable (positive mark AND an established direction). ``r_i = s(i-1) * (p_i / p_(i-1) - 1)``
  with ``s = +1`` long and ``-1`` short, floored at ``SIGNED_RETURN_FLOOR`` (-100%).
* An option is withheld as ``option_premium``: its mark is a premium, not a price of the
  underlying exposure, so a signed price return over it would be an invented number.

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
from services.deribit_txn import classify_instrument

# Twin of HOLDING_COMPARE_MIN_PRICED_DAYS (TypeScript); the shared fixture pins both.
MIN_PRICED_DAYS: Final[int] = 30

# Twin of HOLDING_MARK_WITHHELD_REASONS (TypeScript); the shared fixture pins both.
PRICE_RULE_WITHHELD_REASONS: Final[frozenset[str]] = frozenset(
    {
        "account_balance",
        "fixed_price",
        "no_direction",
        "no_price",
        "option_premium",
        "too_few_priced_days",
    }
)

# Twin of SIGNED_RETURN_FLOOR (TypeScript). D-12: a short whose mark more than doubles
# loses more than the position, which a holder cannot; floor each one-day return at -100%
# so NAV never goes negative.
SIGNED_RETURN_FLOOR: Final[float] = -1.0

_DERIVATIVE_SIDES: Final[frozenset[str]] = frozenset({"long", "short", "flat"})

# ASCII digits only and fullmatch: a bare ``\d`` would accept other scripts' digits and
# ``$`` would accept a trailing newline, neither of which the TypeScript twin does.
_ISO_DAY: Final = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class HoldingMarkContractError(ValueError):
    """A stored row broke the read contract: ``mark_price`` is ``numeric NOT NULL``,
    ``asof`` is a ``date`` and a derivative's ``side`` is long, short or flat. Carries
    COUNTS only, never a row value. Twin of ``HoldingMarkContractError`` in
    holding-compare-adapter.ts."""

    def __init__(self, bad_marks: int, bad_days: int, bad_sides: int = 0) -> None:
        detail = f"marks: {bad_marks}, days: {bad_days}"
        if bad_sides > 0:
            detail += f", sides: {bad_sides}"
        super().__init__(f"holding rows broke the read contract ({detail})")
        self.bad_marks = bad_marks
        self.bad_days = bad_days
        self.bad_sides = bad_sides


@dataclass(frozen=True)
class DailyMark:
    """One priced day: its ``YYYY-MM-DD`` UTC day and its mark price (above 0)."""

    asof: str
    price: float


@dataclass(frozen=True)
class DirectedMark:
    """One priced derivative day. ``direction`` is None when the day has no established
    direction (a ``flat`` row, or long and short rows together)."""

    asof: str
    price: float
    direction: str | None


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


def _contract_violations(
    rows: Sequence[Mapping[str, Any]], *, check_side: bool
) -> tuple[int, int, int]:
    """(bad marks, bad days, bad sides). ``side`` is only a derivative's contract."""
    bad_marks = bad_days = bad_sides = 0
    for row in rows:
        if not _is_finite_number(row.get("mark_price")):
            bad_marks += 1
        if not _is_real_day(row.get("asof")):
            bad_days += 1
        if check_side:
            side = row.get("side")
            if not isinstance(side, str) or side not in _DERIVATIVE_SIDES:
                bad_sides += 1
    return bad_marks, bad_days, bad_sides


def _best_mark_per_day(rows: Sequence[Mapping[str, Any]]) -> dict[str, float]:
    """The pick shared by the spot and derivative rules. Rows must already have passed
    the read contract. Marks at or below 0 are skipped first; per ``asof`` the row
    minimising ``(-written_at_micros(updated_at), api_key_id.lower())`` wins."""
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
    return {asof: picked[1] for asof, picked in best.items()}


def daily_mark_prices(rows: Sequence[Mapping[str, Any]]) -> list[DailyMark]:
    """One mark per calendar day, ascending by ``asof``.

    Every row is checked for the read contract FIRST (a violation raises
    ``HoldingMarkContractError`` carrying counts), then marks at or below 0 are skipped,
    then per ``asof`` the row minimising ``(-written_at_micros(updated_at),
    api_key_id.lower())`` wins: the trick ``one_key_per_account_day`` uses, so two keys
    holding the asset on one venue never merge or double a day. Raises
    ``HoldingsUpdatedAtError`` on an unusable ``updated_at`` of a row that reaches the
    pick. Twin of ``dailyMarkPrices``."""
    bad_marks, bad_days, _ = _contract_violations(rows, check_side=False)
    if bad_marks > 0 or bad_days > 0:
        raise HoldingMarkContractError(bad_marks, bad_days)
    best = _best_mark_per_day(rows)
    return [DailyMark(asof=asof, price=best[asof]) for asof in sorted(best)]


def daily_directed_marks(rows: Sequence[Mapping[str, Any]]) -> list[DirectedMark]:
    """The derivative twin of ``daily_mark_prices`` (D-02): one mark per day, picked
    exactly as the spot rule picks it, plus the day's direction.

    The read contract adds ``side in {long, short, flat}``: anything else (including
    None) raises ``HoldingMarkContractError`` with a ``bad_sides`` count, never a gap.
    The direction comes from ALL rows of the day, every key and every row whose mark is
    a gap included: unanimous long or unanimous short gives that direction, anything
    else (a ``flat`` row, or both sides) gives None. A day with no positive mark is
    absent. Twin of ``dailyDirectedMarks``."""
    bad_marks, bad_days, bad_sides = _contract_violations(rows, check_side=True)
    if bad_marks > 0 or bad_days > 0 or bad_sides > 0:
        raise HoldingMarkContractError(bad_marks, bad_days, bad_sides)
    best = _best_mark_per_day(rows)
    sides_by_day: dict[str, set[str]] = {}
    for row in rows:
        sides_by_day.setdefault(str(row["asof"]), set()).add(str(row["side"]))
    out: list[DirectedMark] = []
    for asof in sorted(best):
        sides = sides_by_day[asof]
        direction = next(iter(sides)) if sides in ({"long"}, {"short"}) else None
        out.append(DirectedMark(asof=asof, price=best[asof], direction=direction))
    return out


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


def signed_adjacent_returns(days: Sequence[DirectedMark]) -> list[tuple[str, float]]:
    """``(later_asof, r)`` for each pair of consecutive days exactly one calendar day apart
    where BOTH days carry a direction. ``r = s(i-1) * (p_i / p_(i-1) - 1)``: the interval
    carries the direction of the EARLIER day (the position held over it), ``s`` is +1 long
    and -1 short, and ``r`` is floored at ``SIGNED_RETURN_FLOOR``. Twin of
    ``signedAdjacentReturns``."""
    out: list[tuple[str, float]] = []
    for earlier, later in zip(days, days[1:]):
        if earlier.direction is None or later.direction is None:
            continue
        if (date.fromisoformat(later.asof) - date.fromisoformat(earlier.asof)).days != 1:
            continue
        sign = 1.0 if earlier.direction == "long" else -1.0
        raw = sign * (later.price / earlier.price - 1)
        out.append((later.asof, max(raw, SIGNED_RETURN_FLOOR)))
    return out


def is_option_symbol(symbol: str) -> bool:
    """True for an option instrument (D-10): the repo's own instrument classifier, so a
    lowercase name and a linear-margin name (``ETH_USDC-27MAR26-50000-C``) are options and
    a perpetual or a dated future is not. Twin of ``isOptionSymbol``."""
    return classify_instrument(symbol) == "option"


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


def classify_derivative_marks(
    rows: Sequence[Mapping[str, Any]], *, symbol: str
) -> HoldingMarks:
    """The derivative withheld ladder, in this order (twin of ``classifyDerivativeMarks``):

    1. ``option_premium``: decided from the symbol alone, marks are NOT read;
    2. the read contract (``daily_directed_marks`` raises, ``side`` included);
    3. ``no_price``: no day carries a positive mark;
    4. ``no_direction``: positive marks exist but no day is usable;
    5. ``too_few_priced_days``: fewer than ``MIN_PRICED_DAYS`` USABLE days (a positive
       mark AND an established direction), with ``priced_days`` and ``returns`` filled;
    6. otherwise withheld is None.
    """
    if is_option_symbol(symbol):
        return HoldingMarks(withheld_reason="option_premium", priced_days=0, returns=())
    days = daily_directed_marks(rows)
    if not days:
        return HoldingMarks(withheld_reason="no_price", priced_days=0, returns=())
    usable = sum(1 for day in days if day.direction is not None)
    if usable == 0:
        return HoldingMarks(withheld_reason="no_direction", priced_days=0, returns=())
    returns = tuple(signed_adjacent_returns(days))
    if usable < MIN_PRICED_DAYS:
        return HoldingMarks(
            withheld_reason="too_few_priced_days", priced_days=usable, returns=returns
        )
    return HoldingMarks(withheld_reason=None, priced_days=usable, returns=returns)


def classify_holding_marks(
    rows: Sequence[Mapping[str, Any]], *, venue: str, symbol: str, holding_type: str
) -> HoldingMarks:
    """Dispatch on ``holding_type``. The DB CHECK admits only ``spot`` and ``derivative``,
    so anything else is a caller bug and raises ``ValueError``."""
    if holding_type == "spot":
        return classify_spot_marks(rows, venue=venue, symbol=symbol)
    if holding_type == "derivative":
        return classify_derivative_marks(rows, symbol=symbol)
    raise ValueError(f"unknown holding_type {holding_type!r}")
