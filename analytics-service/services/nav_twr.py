"""Pure, I/O-free NAV reconstruction + chain-linked time-weighted returns.

Phase 73 (v1.8 Flow-Aware TWR) core. This module is the honest replacement for
the silent base substitution in ``transforms.trades_to_daily_returns_with_status``
(``estimated_start <= 0 -> account_balance`` at L154-159, and the forbidden
``prev_equity.replace(0, initial_capital)`` at L175). It NEVER fabricates a base:

  1. Reconstruct a per-day NAV series BACKWARD from the real exchange anchor:
     ``NAV_{t-1} = NAV_t - pnl_t - F_t`` (dated flows on their UTC days). The
     terminal NAV is ``anchor_nav - open_unrealized_usd`` (realized basis; the
     uPnL wedge parameter defaults to 0.0 and is Phase 77's job to fill).
  2. Chain-link a true daily time-weighted return with the flow in the
     NUMERATOR (end-of-day convention):
     ``r_t = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}``  and cumulative ``Π(1+r)-1``.
  3. Guard EVERY NAV denominator fail-loud (dust / negative / flow-dominated):
     the day's chain-link breaks and ``computation_status_hint`` becomes
     ``complete_with_warnings`` — a wrong NAV denominator is the harm class this
     whole milestone kills, so we flag, we never substitute a floor.

Purity: stdlib + pandas + numpy + in-repo discipline only. No network, no I/O,
no DB, no logging of raw NAV/flow USD values (account-size leak — T-73-02).

``ExternalFlow`` contract (shape only; sourcing/valuation is Phase 75):
    a ``(utc_day_iso: str, usd_signed: float)`` pair — deposit positive,
    withdrawal negative, denominated in USD on its UTC calendar day. Epoch-ms
    and datetime day-keys are tolerated via the shared ``_row_utc_day`` helper.

Discipline mirrors ``services/deribit_txn.py`` (``LedgerValuationError`` ->
``NavReconstructionError``; ``_coerce_float`` contextual fail-loud coercion;
the single shared UTC-day bucketing helper so a midnight-adjacent flow lands on
the same ``t`` as the pnl it offsets — Pitfall #11).
"""
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd

# Single shared UTC-day boundary helper for BOTH flow and pnl bucketing. Do NOT
# fork a second date helper — a divergent midnight boundary would land a flow on
# the wrong day and silently mis-attribute a return (Pitfall #11).
from services.deribit_txn import _row_utc_day

# Dust floor for a NAV denominator (USD). Matches transforms.py
# ``_DUST_BALANCE_THRESHOLD`` — below this a percentage return is gibberish, so
# the day is flagged, never divided.
DUST_NAV_FLOOR = 1000.0

# Flow-dominated guard ratio: when ``|F_t| >= FLOW_DOM_RATIO * NAV_{t-1}`` the
# external flow dwarfs the prior capital and the day's return is not
# interpretable — break the link + flag. 1.0 (flow >= 100% of prior NAV) is the
# conservative locked default (DQ-01); it only raises a WARNING, never alters a
# computed return, and is tuned against real accounts at the Phase 78 gate.
FLOW_DOM_RATIO = 1.0


class NavReconstructionError(ValueError):
    """A NAV/TWR input could not be structurally reconstructed — permanent and
    structural (a schema-drifted flow amount, an undatable flow, an orphan flow
    day), NOT a transient network condition. Mirrors
    ``deribit_txn.LedgerValuationError`` so the worker's network over-catch
    cannot mistake a structural failure for a retryable one."""


def _coerce_float(value: Any, *, field: str, row: Mapping[str, Any]) -> float:
    """Coerce an untrusted numeric field to ``float`` or fail loud with context.

    Raises ``NavReconstructionError`` (permanent, structural) rather than a bare
    ``ValueError``/``TypeError`` — mirrors ``deribit_txn._coerce_float`` so every
    malformed pnl/flow value fails to a permanent gate, never a silent NaN."""
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise NavReconstructionError(
            f"nav_twr non-numeric {field}={value!r} (row={dict(row)!r})"
        ) from exc


def _flows_to_daily_usd(external_flows: Sequence[Any] | None) -> pd.Series:
    """Sum signed external-flow USD per UTC calendar day.

    ``external_flows`` is a sequence of ``(utc_day_iso, usd_signed)`` pairs
    (deposit +, withdrawal −). Two flows on the same UTC day collapse to one
    summed row. Returns an empty float Series when there are no flows. The
    day-key uses the SAME ``_row_utc_day`` helper as pnl bucketing so a
    midnight-adjacent flow cannot drift onto the wrong day."""
    if not external_flows:
        return pd.Series(dtype=float, name="flows")

    sums: dict[str, float] = defaultdict(float)
    for i, flow in enumerate(external_flows):
        day_raw, usd_raw = flow
        day = _row_utc_day(day_raw)  # 'YYYY-MM-DD' (fails loud if undatable)
        usd = _coerce_float(
            usd_raw, field="usd_signed", row={"index": i, "day": day}
        )
        sums[day] += usd

    ordered_days = sorted(sums)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in ordered_days])
    return pd.Series([sums[d] for d in ordered_days], index=index, name="flows")


def _align_flows(flows_by_day: pd.Series, index: pd.Index) -> pd.Series:
    """Align a per-day flow Series onto ``index`` (the pnl/NAV timeline).

    A flow dated on a day NOT present in ``index`` fails loud — a flow we cannot
    place is realized cash we would otherwise silently lose (never drop cash).
    Days in ``index`` with no flow are filled with 0.0 (a genuine no-flow day)."""
    if flows_by_day is None or flows_by_day.empty:
        return pd.Series(0.0, index=index, name="flows")

    orphans = flows_by_day.index.difference(index)
    if len(orphans) > 0:
        raise NavReconstructionError(
            f"nav_twr flow(s) dated outside the return window: "
            f"{[str(d) for d in orphans]}"
        )
    return flows_by_day.reindex(index, fill_value=0.0)


def reconstruct_nav(
    daily_pnl: pd.Series, terminal_nav: float, flows_by_day: pd.Series
) -> pd.Series:
    """Roll the daily NAV series BACKWARD from the terminal anchor.

    ``NAV_{t-1} = NAV_t - pnl_t - F_t``; the NAV at the last index equals
    ``terminal_nav`` exactly. Both ``pnl_t`` and ``F_t`` are fail-loud coerced.
    Returned Series is indexed by ``daily_pnl.index`` (end-of-day NAV per day).
    """
    if daily_pnl.empty:
        return pd.Series(dtype=float, name="nav")

    index = daily_pnl.index
    flows = _align_flows(flows_by_day, index).to_numpy(dtype=float)
    pnl = np.array(
        [
            _coerce_float(v, field="daily_pnl", row={"day": str(index[i])})
            for i, v in enumerate(daily_pnl.to_numpy())
        ]
    )
    terminal = _coerce_float(terminal_nav, field="terminal_nav", row={})

    n = len(index)
    nav = np.empty(n, dtype=float)
    nav[n - 1] = terminal
    for t in range(n - 1, 0, -1):
        nav[t - 1] = nav[t] - pnl[t] - flows[t]

    return pd.Series(nav, index=index, name="nav")
