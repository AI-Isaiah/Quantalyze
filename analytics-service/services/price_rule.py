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
* A live read never carries a price: there is no earlier close to carry. (The helper that
  carried a HISTORY close for up to 7 days, and its ``PRICE_GAP_MAX_DAYS`` constant, were
  deleted in Phase 224 because nothing called them.)

The one exemption: history perps are marked at the base asset's spot close, because no
historical venue perp mark is stored anywhere. The live read uses the venue mark.

A balance with NO price on the legacy refresh's read day (a stored gap row: spot, quantity above 0,
no usable mark) is sized, not summed as $0 (D-06, founder 2026-10-27, "Measure PROD, then set a
floor"). Its size is its quantity times the newest priced row of the same account and symbol before
the read day, at any age (review WR-02: a balance once priced keeps holding the day past the carry
cap); the account level is the sum of each row's equity contribution (``services.holding_equity``). ``gap_disposition`` answers ``dust`` when the size is
strictly below ``DUST_FLOOR_SHARE`` x the level, ``hold`` when it is at or above it (or the level is
at or below 0), and ``unsizable`` when the balance was never priced. A ``dust`` balance, and an
``unsizable`` one (the account never priced that symbol; RESEARCH F2, same founder answer as D-06), are LEFT OUT of the day and named on the
stored row; a ``hold`` stops the day's write. The holdings poll writes every gap row either way: the
decision belongs to the refresh, not the poll.

Two named legacy exclusions stand outside the rule (D-08, accepted, written in the runbook):
sFOX non-stable balances are not priced at all (AUM-05), and a BTC-unit MT5 account with no
stored close is left out of the legacy refresh by 164.6.6.2.1 R2-WR-01.

Pure: no I/O, and nothing here logs a value.
"""

from __future__ import annotations

import math
from typing import Final, Literal

from services.closed_sets import STABLECOIN_SPLIT_SUFFIXES, STABLECOINS

# D-06 (founder 2026-10-27, AskUserQuestion "0.1%, unsizable left out"): an unpriced balance
# whose estimated size is strictly below this share of the account's USD level is left out of the
# legacy day with a name, instead of holding it. Set from plan 10's PROD census
# (``docs/runbooks/marksource-okx-census``), which found no unpriced balance at all on 2026-10-27,
# so the floor is precautionary. Read at call time by ``gap_disposition``; written once, here.
DUST_FLOOR_SHARE: Final[float] = 0.001

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

