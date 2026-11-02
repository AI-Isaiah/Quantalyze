"""Phase 185 plan 07 (SC-5) - the shared option round-trip ledger pair.

The shape is the 2025-07-11..13 Deribit round trip that put the founder's key-mode return at
+458 percent in one day: a USDC account funded on 2025-07-10, an option bought on the 11th with
a premium that is about half the wallet, marked on the 12th, and delivered on the 13th with a
payout several times the wallet, alongside a withdrawal. Measured on the CASH basis (every
option leg booked on the day its cash moves) the 13th is an extreme day; measured on the OPTIONS
basis (the same cumulative P&L spread over the days the book was held, the smoothed
mark-to-market assembly) it is not. Both ledgers reach the same terminal equity and the same
cumulative return.

Every amount is a ratio of ``ROUND_TRIP_S``, the day-0 deposit, never a real balance (RESEARCH
Pitfall 6: the USD floors need a large day-0 level; scaling every figure by one constant keeps
every return unchanged). The ledgers are hand-built ``NativeLedger`` objects; the raw-row test in
``test_deribit_options_basis_ledger.py`` shows the real assembler reproduces them.

Oracle, through the repo's own ``combine_native_ledger(ledger, frozenset())``, day 0 being the
funding day (NaN). The research oracle is the first block; the second is what these exact
numbers give (the research figures are rounded, so the tests compare within ``abs=5e-4``):

  basis      day 1     day 2     day 3     cumulative
  cash       -0.4839   +0.0280   +3.3339   +1.2994   (``flow_timing_day_level_large`` set)
  options     0.0000   +0.1740   +0.9586   +1.2994

  cash       -0.4839   +0.0279   +3.3342   +1.2993
  options     0.0000   +0.1740   +0.9585   +1.2993
"""
from __future__ import annotations

import pandas as pd

from services.external_flows import ExternalFlow
from services.native_nav import NativeLedger

# The day-0 deposit. Every other amount below is a ratio of it.
ROUND_TRIP_S: float = 100_000.0

_DAY_0 = "2025-07-10"
_DAYS = ("2025-07-11", "2025-07-12", "2025-07-13")

# Cash basis: the premium lands on day 1 (about half the wallet), the payout on day 3.
_CASH_PNL = (-0.4839 * ROUND_TRIP_S, 0.0144 * ROUND_TRIP_S, 1.7688 * ROUND_TRIP_S)
# Options basis: the same cumulative P&L (1.2993 of the wallet) spread over the held days.
_OPTIONS_PNL = (0.0 * ROUND_TRIP_S, 0.1740 * ROUND_TRIP_S, 1.1253 * ROUND_TRIP_S)
_WITHDRAWAL = -0.6016 * ROUND_TRIP_S  # day 3
_TERMINAL_EQUITY = 1.6977 * ROUND_TRIP_S  # S + cumulative P&L + withdrawal


def _ledger(daily_pnl: tuple[float, float, float]) -> NativeLedger:
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in _DAYS])
    return NativeLedger(
        native_pnl={"USDC": pd.Series(list(daily_pnl), index=index, dtype="float64")},
        terminal_native_equity={"USDC": _TERMINAL_EQUITY},
        marks={},
        native_flows=[
            ExternalFlow(_DAY_0, ROUND_TRIP_S, "USDC", ROUND_TRIP_S),
            ExternalFlow(_DAYS[2], _WITHDRAWAL, "USDC", _WITHDRAWAL),
        ],
        terminal_upnl_native={},
        full_history=True,
    )


def cash_round_trip_ledger() -> NativeLedger:
    """The round trip measured on the CASH basis: the extreme-day ledger."""
    return _ledger(_CASH_PNL)


def options_round_trip_ledger() -> NativeLedger:
    """The same round trip measured on the OPTIONS basis: the same cumulative P&L, spread."""
    return _ledger(_OPTIONS_PNL)
