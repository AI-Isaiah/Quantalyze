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

# Phase 77 FLOW-04 — terminal uPnL wedge materiality (Q5). When the MTM anchor's
# open-uPnL wedge is |open_unrealized_usd|/anchor_nav > 5%, the realized-basis
# terminal is materially below the reported (MTM) anchor and the intra-window NAV
# excludes that uPnL drift — surfaced via ``unrealized_pnl_in_anchor``. Warning-
# only (never alters a return); rides the SAME complete_with_warnings channel as
# the DQ guards. 5% is the smallest wedge that visibly moves the terminal vs a
# typical daily return; it sits above measurement noise and below the account-
# scale guards (DUST_NAV_FLOOR, FLOW_DOM_RATIO) and is tuned against real accounts
# at the Phase 78 gate exactly like FLOW_DOM_RATIO.
UNREALIZED_MATERIALITY_RATIO = 0.05

# --- DQ-02 flow-coverage terminus retention (per venue) ----------------------
# A deposit older than a venue's deposit/withdrawal-history retention is
# UNFETCHABLE — a genuine coverage gap, not a code bug. Left un-segmented, the
# missing capital drives the early reconstructed NAV <= 0 and is silently
# attributed to performance (the LTP068-inflation class at venue scope). These
# per-venue windows let 76-04 derive a ``flow_coverage_start_day`` so
# ``apply_flow_coverage_terminus`` refuses pre-terminus TWR instead. Named
# explicitly (plan W2) so a >retention-old deposit SEGMENTS + flags rather than
# hard-failing on the construction-sanity residual (which stays ~0 by
# construction even when a flow is merely MISSING vs mis-rolled).
#
# OKX ~90d mirrors the coded trade-history terminus
# (equity_reconstruction.OKX_TRADE_TERMINUS_DAYS = 90, RESEARCH A3). Bybit ~365d
# per the trade-history precedent (job_worker.py:1988 "Bybit last 365 days");
# named with that citation because the exact deposit-history window is
# LOW-confidence and 365d is the safe (over-segmenting) direction. Binance has no
# known deposit-history cap → None → never segments.
OKX_DEPOSIT_TERMINUS_DAYS: int = 90
BYBIT_DEPOSIT_TERMINUS_DAYS: int = 365
BINANCE_DEPOSIT_TERMINUS_DAYS: int | None = None
FLOW_TERMINUS_DAYS_BY_VENUE: dict[str, int | None] = {
    "okx": OKX_DEPOSIT_TERMINUS_DAYS,
    "bybit": BYBIT_DEPOSIT_TERMINUS_DAYS,
    "binance": BINANCE_DEPOSIT_TERMINUS_DAYS,
}


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
    # DQ-02: a flow-coverage retention gap segmented the series at a terminus
    # (pre-terminus TWR refused). 76-04 lifts this into the DataQualityFlags
    # TypedDict + the 74-03 promotion predicate; here it rides the SAME
    # complete_with_warnings channel as the DQ-01 guards (no parallel status).
    flow_coverage_incomplete: bool
    # Phase 77 FLOW-04 — the MTM anchor's open uPnL wedge is material
    # (|open_unrealized_usd|/anchor > UNREALIZED_MATERIALITY_RATIO). Rides the same
    # complete_with_warnings channel as the DQ-01/DQ-02 guards; NO parallel status.
    unrealized_pnl_in_anchor: bool


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
    malformed pnl/flow value fails to a permanent gate, never a silent NaN.

    NaN/Inf are rejected too: ``float('nan')`` parses without a ``ValueError``,
    but a non-finite anchor/pnl/flow would sail past every DQ denominator guard
    (all ``nan <op>`` comparisons are False) and emit a silent NaN return stamped
    ``complete`` — the very "invalid presented as valid" harm this module exists
    to prevent. Fail loud at the single input choke point instead."""
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise NavReconstructionError(
            f"nav_twr non-numeric {field}={value!r} (row={dict(row)!r})"
        ) from exc
    if not np.isfinite(result):
        raise NavReconstructionError(
            f"nav_twr non-finite {field}={value!r} (row={dict(row)!r})"
        )
    return result


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


def _union_flow_days(daily_pnl: pd.Series, flows_by_day: pd.Series) -> pd.Series:
    """Union the external-flow days INTO the daily-pnl index so a flow on a day
    with no return-bearing row becomes a valid zero-pnl NAV day.

    The pnl index is built from cash-bearing rows only (``transforms``'
    ``groupby("date").sum()`` / ``txn_rows_to_daily_records``), so a flow on a day
    with NO trade — an initial deposit before the first trade, or a terminal /
    quiet-day withdrawal (the LTP068 shape) — is dated OUTSIDE that index. Left
    alone it is an ORPHAN that ``_align_flows`` rejects, permanently FAILING the
    whole job for the MAJORITY of real flow-bearing accounts (HIGH-1).

    Placing every flow day into the index (pnl filled 0.0) makes such a day
    flow-neutral: ``pnl_t == 0`` and ``F_t == flow`` so
    ``r_t == (NAV_t - NAV_{t-1} - F_t)/NAV_{t-1} == 0`` — while a DOMINATING flow
    on that same day still trips ``flow_dominated_guard`` (the union changes WHICH
    days exist, never the guard math). Realized cash is never lost: every flow day
    is represented. Flow-less input is returned unchanged (SC-4 byte-identity)."""
    if flows_by_day is None or flows_by_day.empty:
        return daily_pnl
    if daily_pnl.empty:
        # No return-bearing rows at all: every day is a pure-flow (r_t == 0) day.
        return pd.Series(0.0, index=flows_by_day.index, name="daily_pnl")
    new_days = flows_by_day.index.difference(daily_pnl.index)
    if len(new_days) == 0:
        return daily_pnl  # every flow already lands on a return-bearing day
    union_index = daily_pnl.index.union(flows_by_day.index)  # sorted DatetimeIndex
    return daily_pnl.reindex(union_index, fill_value=0.0)


def _align_flows(flows_by_day: pd.Series, index: pd.Index) -> pd.Series:
    """Align a per-day flow Series onto ``index`` (the pnl/NAV timeline).

    Days in ``index`` with no flow are filled with 0.0 (a genuine no-flow day).

    A flow dated on a day NOT present in ``index`` fails loud. This is now a
    DEFENSIVE INVARIANT rather than the primary flow-placement mechanism:
    ``reconstruct_nav_and_twr`` unions every flow day into the pnl index up front
    (``_union_flow_days``, HIGH-1), so a legitimate quiet-day/boundary flow is
    ALWAYS present here and is never rejected. Reaching this raise means the
    union was bypassed (a future refactor regressed the invariant) — fail loud
    rather than silently drop realized cash via ``reindex`` (never lose cash)."""
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
    if flags.get("flow_coverage_incomplete"):
        meta["flow_coverage_incomplete"] = True
    if flags.get("unrealized_pnl_in_anchor"):
        meta["unrealized_pnl_in_anchor"] = True
    return meta


def reconcile_flow_residual(
    terminal_nav: float,
    reconstructed_start: float,
    daily_pnl: pd.Series,
    flows_by_day: pd.Series,
) -> float:
    """DQ-02 CONSTRUCTION self-check — a pure roll-vs-Σ mutation detector.

    ``residual = terminal_nav − reconstructed_start − Σpnl − Σflows``. In the
    backward roll (``nav_twr:reconstruct_nav``) this is ~0 BY CONSTRUCTION:
    ``reconstruct_nav_and_twr`` derives ``reconstructed_start`` from day-0 of the
    SAME rolled ``nav`` (``NAV_0 − pnl_0 − F_0``), so the identity closes for ANY
    anchor value. What a non-zero residual therefore catches is a CODE divergence
    between the backward-roll loop and the Σ of its own inputs — a roll that
    DROPPED or MIS-VALUED a flow (T-76-03-DROP). ``Σpnl``/``Σflows`` are summed
    from the INPUTS (not from the rolled NAV), so a roll that corrupts the early
    NAV cannot cancel itself out here.

    WHAT IT DOES **NOT** DETECT — an economically-wrong anchor / wallet-scope.
    Because ``reconstructed_start`` is reconstructed FROM the (possibly wrong)
    anchor, a mis-scoped anchor (Binance SPOT vs USDⓈ-M, Bybit UNIFIED-only vs
    FUND+UNIFIED) shifts ``terminal`` and ``reconstructed_start`` by the SAME
    amount → the residual stays ~0 and sails through as ``complete`` while
    silently re-scaling every daily return. This is a CONSTRUCTION tautology, NOT
    a wrong-scope guard (proven: a 20%-low anchor passes with a +22% relative
    return change). Wrong scope has NO automated interim net; it is caught ONLY
    at the Phase 78 golden old-vs-new parity panel on known accounts + founder
    confirmation, and no LTP/production factsheet ships until then.

    Tolerance ``max(1.00, 1e-6 * abs(terminal_nav))`` — an absolute cent-floor
    (consistent with the DUST_NAV_FLOOR=$1000 scale) plus a relative band that
    scales with account size. On breach → ``NavReconstructionError`` (permanent,
    loud).

    T-76-03-LEAK: the raise message carries NO raw NAV/flow USD value (account-
    size leak discipline, ``nav_twr`` module docstring)."""
    index = daily_pnl.index
    flows = _align_flows(flows_by_day, index).to_numpy(dtype=float)
    pnl = np.array(
        [
            _coerce_float(v, field="daily_pnl", row={"day": str(index[i])})
            for i, v in enumerate(daily_pnl.to_numpy())
        ]
    )
    terminal = _coerce_float(terminal_nav, field="terminal_nav", row={})
    start = _coerce_float(
        reconstructed_start, field="reconstructed_start", row={}
    )
    residual = terminal - start - float(pnl.sum()) - float(flows.sum())
    tol = max(1.00, 1e-6 * abs(terminal))
    if not np.isfinite(residual) or abs(residual) > tol:
        raise NavReconstructionError(
            "nav_twr DQ-02 construction residual exceeds tolerance — the "
            "backward roll dropped or mis-valued a flow (a roll-loop-vs-Σ code "
            "divergence). NOTE: this self-check does NOT detect a wrong-scope "
            "anchor (that shifts terminal and reconstructed_start together)"
        )
    return residual


def flow_retention_floor(venue: str, now_utc: Any) -> pd.Timestamp | None:
    """The SINGLE normalized retention boundary for ``venue`` —
    ``midnight(now_utc) − retention_days`` — or ``None`` for a no-cap venue
    (Binance). Both the DQ-02 coverage terminus (``flow_coverage_terminus_day``)
    AND the ccxt flow-fetch lower bound (job_worker's ``_flow_since_ms``) derive
    from THIS one helper so the two "retention" definitions can never drift by the
    ≤1-day wall-clock-vs-normalized-midnight gap (LOW-2) as the constants are tuned
    at P78. ``now_utc`` is normalized to midnight so the boundary is a stable UTC
    calendar day, not a moving wall-clock instant."""
    retention_days = FLOW_TERMINUS_DAYS_BY_VENUE.get(venue.lower())
    if retention_days is None:
        return None  # no known retention cap (Binance) → full coverage
    return pd.Timestamp(now_utc).normalize() - pd.Timedelta(days=retention_days)


def flow_coverage_terminus_day(
    venue: str,
    *,
    first_return_day: Any,
    now_utc: Any,
) -> pd.Timestamp | None:
    """Derive the DQ-02 flow-coverage terminus day for ``venue`` — the earliest
    day whose flows are fetchable (and therefore whose reconstructed NAV is
    trustworthy) — or ``None`` when the whole return window is within retention or
    the venue has no known deposit-history cap (Binance).

    Pure: the caller (76-04, I/O) supplies ``now_utc`` so this stays revert-proof
    and clock-free. ``first_return_day``/``now_utc`` accept any
    ``pd.Timestamp``-coercible value. When ``first_return_day`` is already within
    ``retention_days`` of ``now_utc`` there is no gap → ``None`` (no segmentation,
    SC-4 byte-identity preserved)."""
    terminus = flow_retention_floor(venue, now_utc)
    if terminus is None:
        return None  # no known retention cap (Binance) → full coverage
    if pd.Timestamp(first_return_day) >= terminus:
        return None  # entire window within retention → no coverage gap
    return terminus


def apply_flow_coverage_terminus(
    returns: pd.Series,
    flow_coverage_start_day: Any | None,
) -> tuple[pd.Series, dict[str, bool]]:
    """DQ-02 terminus segmentation — a STANDALONE pure helper 76-04 applies to the
    combined returns Series AFTER combine (NOT threaded through transforms.py, so
    the Phase 74 byte-identity pins stay trivially GREEN).

    When ``flow_coverage_start_day`` is set and later than the first return day,
    the pre-terminus window is untrustworthy (a deposit older than the venue's
    retention is unfetchable → the early reconstructed NAV goes <= 0). Segment at
    the last trustworthy day: NaN the returns BEFORE ``flow_coverage_start_day``
    (refuse pre-terminus TWR — NEVER a fabricated number over the gap) and raise
    the ``flow_coverage_incomplete`` flag → ``complete_with_warnings``. A missing
    old deposit is therefore never attributed to performance (T-76-03-GAP).

    ``flow_coverage_start_day is None`` (full coverage / flow-less / no-cap venue)
    → returns UNCHANGED, no flag (SC-4). Transient vs terminal (WR-04): this helper
    segments ONLY on a set start-day signal — a clean end-of-history boundary. A
    transient fetch error is NOT this signal; it bubbles retryable at the I/O layer
    (76-04) and must never reach here as a segment request. So a retryable blip
    cannot over-truncate a good series (T-76-03-TRANS)."""
    if flow_coverage_start_day is None or returns.empty:
        return returns, {}
    start_ts = pd.Timestamp(flow_coverage_start_day)
    if start_ts <= returns.index[0]:
        return returns, {}  # whole window within retention → nothing to refuse
    segmented = returns.copy()
    pre_terminus = segmented.index < start_ts
    segmented[pre_terminus] = np.nan
    return segmented, {"flow_coverage_incomplete": True}


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
    uPnL wedge defaults to 0.0). With ``external_flows`` empty and
    ``open_unrealized_usd == 0.0`` the returned Series is byte-identical to the
    honest transforms.py daily_pnl path for an ``estimated_start > 0`` account
    (SC-4).

    Realized-basis-intraday / MTM-at-endpoint invariant (Phase 77 FLOW-04, Q3):
    Intra-window NAV is realized-basis; uPnL is reconciled only at the terminal
    (endpoint), because historical open-position marks are
    "not retrievable on read-only keys". A material terminal wedge is surfaced
    via ``unrealized_pnl_in_anchor``, and is "never spread across history"
    (that would fabricate marks). Concretely: ``open_unrealized_usd`` is subtracted from
    ``terminal_nav`` BEFORE the backward roll, so EVERY reconstructed intra-window
    NAV — including day n-1 -> day n — excludes uPnL; there is no point at which
    uPnL enters the series, hence NO step discontinuity at the anchor day. No
    per-day historical-uPnL array is ever constructed. When
    ``|open_unrealized_usd| / anchor_nav > UNREALIZED_MATERIALITY_RATIO`` (and the
    anchor is above ``DUST_NAV_FLOOR``), the wedge is material relative to the
    reported anchor and ``unrealized_pnl_in_anchor`` is raised
    (-> ``complete_with_warnings``). The flag carries a BOOL only — the raw USD
    wedge is never logged or emitted (account-size leak class T-77-02).
    """
    flows_by_day = _flows_to_daily_usd(external_flows)
    # HIGH-1: union external-flow days into the pnl index BEFORE reconstruction so
    # a flow on a no-trade day (initial deposit before the first trade; a terminal
    # / quiet-day withdrawal — the LTP068 shape) becomes a valid zero-pnl NAV day
    # (r_t == 0) instead of an orphan that fails the whole job. Placed by
    # inclusion, so realized cash is never lost and a dominating flow still guards.
    daily_pnl = _union_flow_days(daily_pnl, flows_by_day)
    if daily_pnl.empty:
        return pd.Series(dtype=float, name="returns"), _build_nav_meta({})

    anchor = _coerce_float(anchor_nav, field="anchor_nav", row={})
    upnl = _coerce_float(
        open_unrealized_usd, field="open_unrealized_usd", row={}
    )
    terminal_nav = anchor - upnl

    nav = reconstruct_nav(daily_pnl, terminal_nav, flows_by_day)
    # DQ-02 construction-sanity self-check: the backward-roll identity holds BY
    # CONSTRUCTION. ``reconstructed_start`` is the day-0 chain-link denominator
    # (NAV_0 − pnl_0 − F_0) derived from the ACTUAL rolled ``nav``, so this reddens
    # ONLY on a roll that drops/mis-values a flow (a roll-loop-vs-Σ code
    # divergence). It does NOT catch an economically-wrong anchor/wallet-scope —
    # that shifts terminal and reconstructed_start together → residual ~0, caught
    # only at the Phase 78 parity panel + founder confirmation.
    flows0 = _align_flows(flows_by_day, nav.index).iloc[0]
    pnl0 = _coerce_float(
        daily_pnl.iloc[0], field="daily_pnl", row={"day": str(nav.index[0])}
    )
    reconstructed_start = float(nav.iloc[0]) - pnl0 - float(flows0)
    reconcile_flow_residual(
        terminal_nav, reconstructed_start, daily_pnl, flows_by_day
    )
    returns, flags = chain_linked_twr(nav, daily_pnl, flows_by_day)
    # FLOW-04 terminal uPnL wedge materiality (Q5). Evaluate the ratio ONLY on a
    # non-dust anchor — a dust/near-zero base makes |uPnL|/anchor meaningless (and
    # divide-by-tiny explodes it into a false positive); a dust NAV is already
    # flagged by the DQ-01 dust guard on its own merits. A BOOL is merged (never
    # the raw USD wedge — account-size leak T-77-02); no key when immaterial so the
    # SC-4 zero-wedge default stays byte/status-identical.
    if anchor > DUST_NAV_FLOOR and abs(upnl) / anchor > UNREALIZED_MATERIALITY_RATIO:
        flags = {**flags, "unrealized_pnl_in_anchor": True}
    return returns, _build_nav_meta(flags)
