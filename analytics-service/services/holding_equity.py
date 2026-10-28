"""The matcher's AUM basis: what one holding contributes to an allocator's AUM.

Phase 167.1.1.1 D-15 / D-16: the matcher sizes on the same AUM the allocator sees,
so this is NOT a third definition. The canonical rule is ``holdingEquityContribution``
in ``src/lib/holding-equity.ts`` (re-exported by ``src/lib/queries.ts`` and aliased on
the client as ``holdingEquityContributionLocal`` in
``src/app/(dashboard)/allocations/lib/live-holdings-summary.ts``). Python cannot
import TypeScript, so the pin is the shared fixture
``tests/fixtures/holding_equity_contribution_cases.json``, which carries ONE
``expected`` value per case; vitest replays it against the TypeScript functions and
pytest replays it against this one.

The rule:

* a spot holding contributes its ``value_usd``;
* a derivative contributes its SIGNED ``unrealized_pnl_usd`` and never its notional
  ``value_usd`` (a futures contract's notional is not money the allocator holds).
  Deribit and options are included. A losing short's negative P&L stays negative;
  it is never clamped;
* a value that is not a finite number contributes 0.0 (a bool, a string, NaN and
  +/-Infinity count as not finite, exactly as ``Number.isFinite`` reads them).

A derivative whose ``unrealized_pnl_usd`` IS None returns None here, and the
TypeScript function returns null for the same input (Phase 167.1.1.2 D-06; there is
no divergence between the runtimes any more). The caller withholds that holding from
the AUM by name (``pnl_missing``); a missing P&L is never invented as 0 and never
replaced by notional. The fixture pins it (``derivative_null_pnl_is_withheld``
expects null) and a test asserts every case carries a single ``expected``.

This module reads a row and returns a number. It imports nothing from the writers
(``allocator_positions``, ``positions``) and changes none of them (D-17).
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any


def _finite_number(value: Any) -> float | None:
    """``float(value)`` when it is a finite int or float that is not a bool, else None.

    A bool is excluded because ``Number.isFinite(true)`` is false in the TypeScript
    rule, while Python's ``bool`` is an ``int`` subclass.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def holding_equity_contribution(row: Mapping[str, Any]) -> float | None:
    """One holding's contribution to AUM, or None when it must be withheld (D-18).

    None means a derivative with no reported unrealized P&L. Every other input,
    including a non-finite value, gives the number ``holdingEquityContribution``
    gives.
    """
    if row.get("holding_type") == "derivative":
        pnl = row.get("unrealized_pnl_usd")
        if pnl is None:
            return None
        finite = _finite_number(pnl)
        return finite if finite is not None else 0.0
    finite = _finite_number(row.get("value_usd"))
    return finite if finite is not None else 0.0


def is_price_gap_holding(row: Mapping[str, Any]) -> bool:
    """Whether a stored holdings row is a PRICE GAP (Phase 167.2.1.1.1.1 D-07).

    True iff ``holding_type`` is ``spot``, ``quantity`` is a finite number above 0, and
    ``mark_price`` is NOT a finite number above 0. It is the ``holding_marks`` gap rule
    applied to a stored row. A null, absent, zero, negative, NaN, infinite, bool or string
    mark is a gap; a quantity that is zero, negative, non-finite or absent is not (nothing
    is held); a derivative is never a gap.

    The TypeScript twin is ``holdingIsPriceGap`` in ``src/lib/holding-equity.ts`` and the
    fixture ``tests/fixtures/holding_price_gap_cases.json`` pins both. The predicate is
    row-level and pure: the stable-value and Deribit exclusions belong to the refresh, not
    here. It does not touch ``holding_equity_contribution``.
    """
    if row.get("holding_type") != "spot":
        return False
    quantity = _finite_number(row.get("quantity"))
    if quantity is None or quantity <= 0:
        return False
    mark = _finite_number(row.get("mark_price"))
    return mark is None or mark <= 0
