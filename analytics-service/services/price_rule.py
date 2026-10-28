"""Phase 167.2.1.1.1.1 (MARKSOURCE) D-02, D-04: the ONE stated price rule for open positions.

Every path that turns a quantity into dollars follows the rule below. This docstring IS
the documented rule (CONTEXT D-02: "One documented rule, one test per path"); the paths
that apply it, and the test that pins each, are in ``tests/test_price_rule.py``.

The rule (founder 2026-10-27, "UTC-day close, gaps named"):

* Spot HISTORY is valued at the venue's UTC 1d close of the day itself. The CoinGecko
  fallback is read as a close too: the first point stamped on UTC date D+1 is the close
  of D (the rule ``services.benchmark._fetch_from_coingecko`` already applies).
* A LIVE read at the label boundary (the anchor, the Bybit unified-account mark read)
  uses the venue ticker ``last``.
* DERIVATIVES keep the venue mark and the venue-reported open profit; ``None`` stays
  ``None``. Deribit inverse keeps the index (``index_price``), and falls back to the
  mark only for a non-option.
* Stable-value assets (``STABLECOINS`` plus ``STABLECOIN_SPLIT_SUFFIXES``) are 1.0.
* A missing or unusable price (not a finite number, or <= 0, or a bool) is a NAMED GAP,
  never $0: ``usable_price`` answers ``None`` and the caller names the gap.
* A gap in a HISTORY series is carried at the last usable close for at most
  ``PRICE_GAP_MAX_DAYS`` = 7 days (D-04) and the symbol is NAMED (``carried_symbols``);
  beyond 7 days the symbol is named and SKIPPED (``skipped_symbols``), never carried.
  A live read never carries a price: there is no earlier close to carry.

The one exemption: history perps are marked at the base asset's spot close, because no
historical venue perp mark is stored anywhere. The live read uses the venue mark.

Why BRIDGERETURNS (``services.holding_marks``) uses N = 0 and this rule uses N = 7: a
RETURN is a ratio of two adjacent days, so a missing day has to break the chain, whereas
a LEVEL persists, so an old close is still a statement about the level for a week. A level
may be carried; a return may not.

N = 7 is also the value the founder set as ``equity_reconstruction.CARRY_AGE_CAP_DAYS``
(167.1.2.1.1 D-02); ``tests/test_price_rule.py::test_price_gap_max_days_coupled_to_carry_cap``
fails if the two drift apart.

A balance with NO price on the legacy refresh's read day (a stored gap row: spot, quantity above 0,
no usable mark) is sized, not summed as $0 (D-06, founder 2026-10-27, "Measure PROD, then set a
floor"). Its size is its quantity times the newest priced row of the same account and symbol before
the read day, at any age (review WR-02: a balance once priced keeps holding the day past the carry
cap); the account level is the sum of each row's equity contribution (``services.holding_equity``). ``gap_disposition`` answers ``dust`` when the size is
strictly below ``DUST_FLOOR_SHARE`` x the level, ``hold`` when it is at or above it (or the level is
at or below 0), and ``unsizable`` when the balance was never priced. A ``dust`` balance, and an
``unsizable`` one while ``UNSIZABLE_GAP_HOLDS`` is False, are LEFT OUT of the day and named on the
stored row; a ``hold`` stops the day's write. The holdings poll writes every gap row either way: the
decision belongs to the refresh, not the poll.

Two named legacy exclusions stand outside the rule (D-08, accepted, written in the runbook):
sFOX non-stable balances are not priced at all (AUM-05), and a BTC-unit MT5 account with no
stored close is left out of the legacy refresh by 164.6.6.2.1 R2-WR-01.

Pure: no I/O, and nothing here logs a value.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Sequence
from datetime import date
from typing import Final, Literal

from services.closed_sets import STABLECOIN_SPLIT_SUFFIXES, STABLECOINS

# D-04 (founder): a history close is carried at most this many days. Coupled by an
# equality test, not an import, to ``equity_reconstruction.CARRY_AGE_CAP_DAYS`` (that module
# is ~7000 lines and imports ``job_worker``; this one is a leaf).
PRICE_GAP_MAX_DAYS: Final[int] = 7

# D-06 (founder 2026-10-27, AskUserQuestion "0.1%, unsizable left out"): an unpriced balance
# whose estimated size is strictly below this share of the account's USD level is left out of the
# legacy day with a name, instead of holding it. Set from plan 10's PROD census
# (``docs/runbooks/marksource-okx-census``), which found no unpriced balance at all on 2026-10-27,
# so the floor is precautionary. Read at call time by ``gap_disposition``; written once, here.
DUST_FLOOR_SHARE: Final[float] = 0.001

# RESEARCH F2 (decided in plan 10, same founder answer): False means a gap that cannot be sized
# (the account never priced that symbol) is left out and named,
# True means it holds the day. Read at call time by ``gap_holds_the_day``.
UNSIZABLE_GAP_HOLDS: Final[bool] = False

_STABLE_VALUE: Final[frozenset[str]] = STABLECOINS | STABLECOIN_SPLIT_SUFFIXES


def usable_price(value: object) -> float | None:
    """The price as a float when it is usable, else ``None`` (a named gap, never $0).

    Usable means a finite number strictly above 0. A bool is not a price (it is an ``int``
    subclass, so a stored ``True`` would read as 1.0), and a numeric string is not usable:
    the same shape as ``holding_marks._is_finite_number`` plus the ``> 0`` gap test.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def is_stable_value(asset: str) -> bool:
    """True when the asset is valued at 1.0 per unit (case-insensitive)."""
    return asset.upper() in _STABLE_VALUE


def close_on_or_before(
    days: Sequence[str],
    closes: Sequence[float],
    day: str,
    max_gap_days: int = PRICE_GAP_MAX_DAYS,
) -> tuple[float, int] | None:
    """The close on or before ``day`` and its age in whole days, or ``None`` for a gap.

    ``days`` are ascending ISO ``YYYY-MM-DD`` dates and ``closes`` the parallel prices. The
    age is 0 when ``day`` itself has a close. ``None`` when nothing is on or before ``day``
    or the newest such close is older than ``max_gap_days`` (the age check is strictly
    "older than": age 7 is carried, age 8 is not).
    """
    idx = bisect_right(days, day) - 1
    if idx < 0:
        return None
    age = (date.fromisoformat(day) - date.fromisoformat(days[idx])).days
    if age > max_gap_days:
        return None
    return closes[idx], age


def gap_disposition(
    estimated_usd: float | None, account_level_usd: float
) -> Literal["dust", "hold", "unsizable"]:
    """What an unpriced balance does to the legacy day (D-06).

    ``estimated_usd`` is the balance's size (quantity x its newest priced row, at any age),
    ``None`` when it was never priced: ``unsizable``. A level at or below 0 is no base for a
    share, so it ``hold``s. Otherwise ``dust`` when the size is strictly below
    ``DUST_FLOOR_SHARE`` x the level, else ``hold`` (a size AT the floor holds). The floor is
    read at call time.
    """
    if estimated_usd is None:
        return "unsizable"
    if account_level_usd <= 0:
        return "hold"
    if estimated_usd < DUST_FLOOR_SHARE * account_level_usd:
        return "dust"
    return "hold"


def gap_holds_the_day(disposition: str) -> bool:
    """Whether a ``gap_disposition`` stops the day's write: ``hold`` does, ``dust`` does not,
    and ``unsizable`` follows ``UNSIZABLE_GAP_HOLDS`` (read at call time, F2)."""
    if disposition == "hold":
        return True
    if disposition == "unsizable":
        return UNSIZABLE_GAP_HOLDS
    return False
