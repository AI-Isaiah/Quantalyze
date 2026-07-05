"""Pure, I/O-free NAV reconstruction + chain-linked time-weighted returns.

Phase 73 (v1.8 Flow-Aware TWR) core. This module is the honest replacement for
the silent base substitution in ``transforms.trades_to_daily_returns_with_status``
(``estimated_start <= 0 -> account_balance`` at L154-159, and the forbidden
zero-to-initial base swap on prev_equity at L175). It NEVER fabricates a base:

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

# ReturnsComputationMeta is imported READ-ONLY — the core extends it additively
# via NavTWRMeta (below); it does NOT modify the transforms.py contract. The two
# existing keys keep their complete/complete_with_warnings semantics; Phase 74
# wires these flags into strategy_analytics.computation_status + the 8 consumers.
from services.transforms import ReturnsComputationMeta

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


class NavTWRMeta(ReturnsComputationMeta, total=False):
    """Extends ``ReturnsComputationMeta`` (read-only from transforms.py) with the
    additive DQ-01 NAV-denominator guard flags. ``total=False`` so a guard key is
    present only when it fired. The inherited keys keep their required semantics:
    the core never uses heuristic capital and reads no balance, so
    ``used_heuristic_capital``/``balance_error`` are always False here.
    ``computation_status_hint`` is ``complete_with_warnings`` when any guard
    fired, else ``complete`` (same convention as transforms._build_meta)."""

    dust_nav_guard: bool
    negative_nav_guard: bool
    flow_dominated_guard: bool


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


def chain_linked_twr(
    nav: pd.Series, daily_pnl: pd.Series, flows_by_day: pd.Series
) -> tuple[pd.Series, dict[str, bool]]:
    """Chain-link the daily time-weighted return from a reconstructed NAV series.

    ``r_t = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}`` — the external flow sits in
    the NUMERATOR (end-of-day convention), never in the base. ``NAV_{t-1}`` is
    the prior day's reconstructed closing NAV; for the first day it is the
    reconstructed pre-history capital ``NAV_0 - pnl_0 - F_0``.

    This function handles only the intrinsic zero-NAV break (a ``NAV_{t-1}`` of
    exactly 0 would divide by zero): that day's return is omitted and the
    ``negative_nav_guard`` flag is raised. The threshold-based dust / negative /
    flow-dominated guards live in the fail-loud guard block (DQ-01) which
    generalises this same break — see ``_guard_denominator``.

    Returns ``(returns, flags)`` where ``returns`` is a ``"returns"``-named
    Series on the NAV DatetimeIndex (broken days are NaN) and ``flags`` maps the
    DQ flag keys that fired to ``True``.
    """
    index = nav.index
    flows = _align_flows(flows_by_day, index).to_numpy(dtype=float)
    nav_vals = nav.to_numpy(dtype=float)
    pnl0 = _coerce_float(
        daily_pnl.iloc[0], field="daily_pnl", row={"day": str(index[0])}
    )

    n = len(index)
    flags: dict[str, bool] = {}
    returns = np.full(n, np.nan)
    for t in range(n):
        cur = nav_vals[t]
        flow_t = flows[t]
        if t == 0:
            prev = cur - pnl0 - flow_t  # reconstructed pre-history capital
        else:
            prev = nav_vals[t - 1]  # NAV_{t-1}

        guard_key = _guard_denominator(prev, flow_t)
        if guard_key is not None:
            flags[guard_key] = True
            continue  # break the chain-link for this day; NEVER substitute

        returns[t] = (cur - prev - flow_t) / prev

    return pd.Series(returns, index=index, name="returns"), flags


def _guard_denominator(prev_nav: float, flow: float) -> str | None:
    """Return the DQ-01 flag key if ``prev_nav`` is not a usable denominator,
    else None. Three fail-loud guards, checked BEFORE the denominator divides —
    each breaks the chain-link for that day and flags, NEVER substitutes a base:

      * negative reconstructed NAV (``prev_nav <= 0``, incl. exactly 0 which
        would divide-by-zero) -> ``negative_nav_guard``. This is the honest
        divergence from transforms.py: the ``estimated_start <= 0`` account
        flags here instead of silently substituting today's balance.
      * dust NAV (``0 < prev_nav < DUST_NAV_FLOOR``) -> ``dust_nav_guard`` — a
        percentage return on a sub-$1000 base is gibberish.
      * flow-dominated (``|flow| >= FLOW_DOM_RATIO * prev_nav``) ->
        ``flow_dominated_guard`` — the external flow dwarfs prior capital.

    There is deliberately NO clamp/floor/replace here: a guarded day yields NaN
    (a break), never a fabricated number (the forbidden substitution class the
    source-scan test bans)."""
    if prev_nav <= 0:
        return "negative_nav_guard"
    if prev_nav < DUST_NAV_FLOOR:
        return "dust_nav_guard"
    if abs(flow) >= FLOW_DOM_RATIO * prev_nav:
        return "flow_dominated_guard"
    return None


def cumulative_twr(returns: pd.Series) -> float:
    """Cumulative chain-linked return ``Π(1 + r) - 1`` over the retained
    (non-broken) days. Returns NaN when no day survived the guards."""
    retained = returns.dropna()
    if retained.empty:
        return float("nan")
    return float((1.0 + retained).prod() - 1.0)


def _build_nav_meta(flags: Mapping[str, bool]) -> NavTWRMeta:
    """Build the returned ``NavTWRMeta``. ``computation_status_hint`` is
    ``complete_with_warnings`` when any DQ guard fired, else ``complete`` —
    reusing the transforms.py convention. The two inherited keys
    (``used_heuristic_capital``, ``balance_error``) keep their semantics; the
    core never uses heuristic capital (it reconstructs from the real anchor) and
    does not read a balance, so both are False here. Guard flags are ADDITIVE and
    present only when they fired (keys assigned explicitly for mypy)."""
    warn = bool(flags)
    meta: NavTWRMeta = {
        "used_heuristic_capital": False,
        "balance_error": False,
        "computation_status_hint": (
            "complete_with_warnings" if warn else "complete"
        ),
    }
    if flags.get("dust_nav_guard"):
        meta["dust_nav_guard"] = True
    if flags.get("negative_nav_guard"):
        meta["negative_nav_guard"] = True
    if flags.get("flow_dominated_guard"):
        meta["flow_dominated_guard"] = True
    return meta


def reconstruct_nav_and_twr(
    daily_pnl: pd.Series,
    anchor_nav: float,
    *,
    external_flows: Sequence[Any] | None = None,
    open_unrealized_usd: float = 0.0,
) -> tuple[pd.Series, NavTWRMeta]:
    """Public entry: reconstruct the daily NAV backward from ``anchor_nav`` and
    chain-link the daily time-weighted return.

    ``terminal_nav = anchor_nav - open_unrealized_usd`` (realized basis; the
    uPnL wedge defaults to 0.0 and is Phase 77's job to fill). With
    ``external_flows`` empty and ``open_unrealized_usd == 0.0`` the returned
    Series is byte-identical to the honest transforms.py daily_pnl path for an
    ``estimated_start > 0`` account (SC-4).
    """
    flows_by_day = _flows_to_daily_usd(external_flows)
    if daily_pnl.empty:
        return pd.Series(dtype=float, name="returns"), _build_nav_meta({})

    terminal_nav = _coerce_float(
        anchor_nav, field="anchor_nav", row={}
    ) - _coerce_float(open_unrealized_usd, field="open_unrealized_usd", row={})

    nav = reconstruct_nav(daily_pnl, terminal_nav, flows_by_day)
    returns, flags = chain_linked_twr(nav, daily_pnl, flows_by_day)
    return returns, _build_nav_meta(flags)
