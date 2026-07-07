"""ACC-01 panel fixtures — per-venue flow-less controls + an LTP068-shaped mover.

These are the SYNTHETIC, committed inputs the Phase 78 golden-parity panel gate
(`scripts/golden_parity.py::gate_account` / `main`) drives OLD-vs-NEW over. There
are NO live keys and NO network access here — this is the CI-gated portion of the
ACC-01 gate (the live `deribit_acceptance.py` re-run is Wave 3, autonomous:false).

Two fixture families:

  (a) flowless_controls() — ONE flow-less control per live venue (Deribit, OKX,
      Bybit, Binance). Each sits in the ``estimated_start > 0`` regime, the
      byte-identity precondition where the NEW honest core
      (``reconstruct_nav_and_twr`` with ``external_flows=None``) is algebraically
      identical to the frozen OLD anchor-to-today oracle (the P74 SC-4 pins). Each
      is tagged ``has_flows=False`` and expected bucket ``UNCHANGED`` — a control
      that MOVES is a regression that must fail CLOSED as UNEXPLAINED, never be
      silently reclassified.

  (b) ltp068_mover() — an LTP068-shaped flow-heavy fixture: a profits-withdrawn
      account (``estimated_start <= 0`` → the OLD ``account_balance`` fallback
      bug) carrying a real dated external withdrawal. The OLD oracle is flow-blind
      and inflates; the NEW flow-aware core reconstructs the honest NAV from the
      dated flow, so the return SERIES moves materially. Tagged ``has_flows=True``,
      expected bucket ``FLOW_MOVED``.

``unexplained_injection()`` reuses the mover's moving inputs but (adversarially)
declares ``has_flows=False`` — the fail-closed / has_flows-flip case the gate MUST
classify UNEXPLAINED (T-78-04 defeat-the-net guard).

Security (T-78-01): these builders return pandas Series / dataclasses only; the
raw USD magnitudes live in code but are NEVER routed to any print/log path (the
driver emits buckets + counts + booleans only — account-size leak discipline).

Purity: stdlib + pandas + in-repo ``services.parity_diff`` bucket labels ONLY. No
I/O, no live keys, no network.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import pandas as pd

from services.parity_diff import FLOW_MOVED, UNCHANGED, UNEXPLAINED


@dataclass
class PanelAccount:
    """One panel account the gate classifies OLD-vs-NEW.

    ``daily_pnl`` is a dollar-P&L-per-day Series (DatetimeIndex). ``has_flows`` is
    the CALLER-KNOWN flow truth (never inferred): the gate passes it straight to
    ``classify_delta`` so a moved-but-flow-less account fails closed as
    UNEXPLAINED. ``expected_bucket`` is the bucket the gate asserts.
    """

    venue: str
    label: str
    daily_pnl: pd.Series
    account_balance: float
    has_flows: bool
    expected_bucket: str
    external_flows: tuple[tuple[str, float], ...] | None = None
    open_unrealized_usd: float = 0.0


def _daily_pnl_series(start: str, pnls: Sequence[float]) -> pd.Series:
    """Build a dollar-P&L-per-day Series on a dense daily DatetimeIndex.

    Matches the ``daily_pnl = df.groupby("date")["daily_pnl"].sum()`` shape both
    the frozen oracle and the honest core consume (one summed row per UTC day).
    """
    index = pd.date_range(start=start, periods=len(pnls), freq="D")
    return pd.Series([float(p) for p in pnls], index=index, name="daily_pnl")


def flowless_controls() -> list[PanelAccount]:
    """One flow-less byte-identity control per live venue (4 controls).

    Every control uses the ``estimated_start > 0`` regime
    (``account_balance > total_pnl``, and ``account_balance`` well above the
    $1000 dust floor) so the NEW ``external_flows=None`` core is byte-identical to
    the OLD oracle — the delta MUST classify UNCHANGED. Distinct P&L shapes per
    venue keep the four controls independent.
    """
    return [
        PanelAccount(
            venue="deribit",
            label="deribit-flowless-control",
            daily_pnl=_daily_pnl_series("2026-05-01", [120.0, -60.0, 200.0, 90.0]),
            account_balance=150_000.0,
            has_flows=False,
            expected_bucket=UNCHANGED,
        ),
        PanelAccount(
            venue="okx",
            label="okx-flowless-control",
            daily_pnl=_daily_pnl_series("2026-05-01", [300.0, 150.0, -80.0, 40.0]),
            account_balance=200_000.0,
            has_flows=False,
            expected_bucket=UNCHANGED,
        ),
        PanelAccount(
            venue="bybit",
            label="bybit-flowless-control",
            daily_pnl=_daily_pnl_series("2026-05-01", [-50.0, 100.0, 75.0, 25.0]),
            account_balance=90_000.0,
            has_flows=False,
            expected_bucket=UNCHANGED,
        ),
        PanelAccount(
            venue="binance",
            label="binance-flowless-control",
            daily_pnl=_daily_pnl_series("2026-05-01", [500.0, 250.0, -120.0, 330.0]),
            account_balance=500_000.0,
            has_flows=False,
            expected_bucket=UNCHANGED,
        ),
    ]


def ltp068_mover() -> PanelAccount:
    """LTP068-shaped flow-heavy fixture — MUST classify FLOW_MOVED.

    Profits-withdrawn shape: total P&L ($9000) exceeds the current
    ``account_balance`` ($6000), so ``estimated_start = balance - total_pnl <= 0``
    → the OLD oracle trips its ``account_balance`` fallback (the +458% LTP068
    inflation mechanism). A REAL dated withdrawal (-$5000 on 2026-04-03) is
    supplied to the NEW honest core, which reconstructs a positive early NAV from
    the flow and chain-links an honest TWR. The two series diverge materially, so
    with the caller-known ``has_flows=True`` the delta is FLOW_MOVED.

    The withdrawal is sub-NAV on its day (prior reconstructed NAV > |flow|), so no
    ``flow_dominated_guard`` fires — the whole series moves cleanly rather than
    NaN-ing out.
    """
    return PanelAccount(
        venue="deribit",
        label="ltp068-shaped-mover",
        daily_pnl=_daily_pnl_series("2026-04-01", [2000.0, 3000.0, 2500.0, 1500.0]),
        account_balance=6_000.0,
        has_flows=True,
        expected_bucket=FLOW_MOVED,
        external_flows=(("2026-04-03", -5000.0),),
    )


def unexplained_injection() -> PanelAccount:
    """The fail-closed / has_flows-flip case: the mover's MOVING inputs but with
    ``has_flows=False`` (a flow-less control that nonetheless moved).

    The gate MUST classify this UNEXPLAINED and fail closed (T-78-04): a moved
    series without declared flows is a regression, never silently reclassified.
    """
    mover = ltp068_mover()
    return PanelAccount(
        venue=mover.venue,
        label="flowless-control-that-moved",
        daily_pnl=mover.daily_pnl,
        account_balance=mover.account_balance,
        has_flows=False,
        expected_bucket=UNEXPLAINED,
        external_flows=mover.external_flows,
        open_unrealized_usd=mover.open_unrealized_usd,
    )


def panel() -> list[PanelAccount]:
    """The full CI panel: the four flow-less controls + the LTP068-shaped mover.

    ``unexplained_injection()`` is deliberately NOT in this panel — a clean panel
    must classify with ZERO UNEXPLAINED. The injection is driven separately by the
    self-test to prove the gate fails closed.
    """
    return [*flowless_controls(), ltp068_mover()]
