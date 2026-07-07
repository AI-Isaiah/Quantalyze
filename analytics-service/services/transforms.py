from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, TypedDict

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    # NavTWRMeta extends ReturnsComputationMeta with the additive DQ-01 guard
    # keys. Imported under TYPE_CHECKING only: the runtime import of the core
    # is lazy (inside trades_to_daily_returns_with_status) to break the
    # transforms <-> nav_twr module cycle (nav_twr imports ReturnsComputationMeta
    # from here). ``from __future__ import annotations`` makes every annotation a
    # string so this type is never needed at runtime.
    from services.nav_twr import NavTWRMeta


class ReturnsComputationMeta(TypedDict):
    """Audit-2026-05-07 #9 — metadata about how `trades_to_daily_returns`
    computed initial_capital, plumbed up to the caller so it can populate
    `data_quality_flags` and `strategy_analytics.computation_status`
    accurately.

    Pre-fix the heuristic-capital fallback was indistinguishable from the
    real-balance path at the API surface — a transient exchange-API
    failure silently degraded a verified institutional strategy's
    CAGR/Sharpe by 5–10× and the factsheet rendered the result as
    canonical. The flags below are the contract callers (analytics_runner,
    portfolio router) must read to set the right DQF + computation_status:

      * ``used_heuristic_capital`` — initial_capital came from the
        heuristic fallback (off by 5–10× on volatile strategies),
        not from the exchange API. ALWAYS set when account_balance was
        None or below threshold. Maps to
        ``data_quality_flags.heuristic_capital_used = True``.
      * ``balance_error`` — caller passed ``balance_error=True`` because
        the exchange API failed (network, auth, rate-limit). Pre-fix
        this signal was destroyed by `fetch_usdt_balance` returning a
        bare None on every exception. Maps to
        ``data_quality_flags.balance_error = True``.
      * ``computation_status_hint`` — what the caller should set on
        ``strategy_analytics.computation_status``. Returns
        ``"complete_with_warnings"`` whenever the heuristic was used OR
        the balance read errored; ``"complete"`` only when initial_capital
        came from a legitimate balance read. Mirrors the existing
        complete_with_warnings convention used elsewhere in the runner.
    """
    used_heuristic_capital: bool
    balance_error: bool
    computation_status_hint: str


def trades_to_daily_returns(
    trades: list[dict[str, Any]],
    account_balance: float | None = None,
) -> pd.Series:
    """Convert trade/PnL records to portfolio-level daily returns.

    Args:
        trades: Trade or daily PnL records from the exchange
        account_balance: Actual account balance from exchange API (USDT).
            When provided, used as initial capital for accurate percentage returns.
            When None, falls back to heuristic estimation (less accurate).

    Handles two data formats:
    1. Daily PnL records (order_type='daily_pnl'): dollar P&L per day from exchange bills or CSV
    2. Individual trades: buy/sell with price/quantity

    Audit-2026-05-07 #9 — this is a thin wrapper around
    ``trades_to_daily_returns_with_status`` that drops the
    ``ReturnsComputationMeta`` flags. New code paths that feed
    ``data_quality_flags`` should call the *_with_status form so the
    caller can set ``data_quality_flags.heuristic_capital_used`` and
    ``balance_error`` accurately.
    """
    returns, _meta = trades_to_daily_returns_with_status(
        trades, account_balance=account_balance, balance_error=False
    )
    return returns


def trades_to_daily_returns_with_status(
    trades: list[dict[str, Any]],
    account_balance: float | None = None,
    balance_error: bool = False,
    *,
    external_flows: Sequence[Any] | None = None,
    open_unrealized_usd: float = 0.0,
) -> tuple[pd.Series, "NavTWRMeta"]:
    """Audit-2026-05-07 #9 — same conversion as ``trades_to_daily_returns``
    but ALSO returns a ``ReturnsComputationMeta`` describing how
    initial_capital was derived. The caller propagates the flags into
    ``data_quality_flags`` + ``strategy_analytics.computation_status``.

    Args:
        trades: same as ``trades_to_daily_returns``.
        account_balance: actual account balance from the exchange API
            (USDT). When None or below the per-strategy dust threshold,
            the heuristic-capital fallback is used (off by 5–10× on
            volatile strategies).
        balance_error: True when the caller's
            ``fetch_usdt_balance_with_status`` returned ``balance_error=True``.
            DISTINCT from "balance legitimately None" (e.g. drained
            paper account); pre-fix the API collapsed both into a bare
            None and the factsheet showed degraded numbers as canonical.

    Returns:
        ``(returns, meta)`` where ``meta`` is a ``ReturnsComputationMeta``
        dict with the three flags described in the TypedDict docstring.
    """
    # Lazy import breaks the transforms <-> nav_twr module cycle: nav_twr imports
    # ReturnsComputationMeta from this module at import time, so this module must
    # not import nav_twr at module scope.
    from services.nav_twr import reconstruct_nav_and_twr

    used_heuristic_capital = False

    if not trades:
        return pd.Series(dtype=float, name="returns"), _build_meta(
            used_heuristic_capital=False,
            balance_error=balance_error,
        )

    df = pd.DataFrame(trades)
    # Trade timestamps mix precision: raw fills carry microseconds
    # (`...T12:34:56.123456+00:00`) while daily-PnL summary rows are
    # whole-second (`...T00:00:00+00:00`). A bare `pd.to_datetime` (pandas
    # >=2.0) infers the format from element 0 and then fails strictly on the
    # first row of differing precision ("time data ... doesn't match format
    # ... at position N") — the dominant `compute_analytics` failure. Parse
    # each value independently with `format="ISO8601"`; `utc=True` yields a
    # tz-aware UTC column (inputs are already +00:00, so this normalizes, it
    # does not shift).
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601", utc=True)
    df["date"] = df["timestamp"].dt.date

    # Check if this is daily PnL data (from exchange bills API or CSV upload)
    is_daily_pnl = df["order_type"].iloc[0] == "daily_pnl" if "order_type" in df.columns else False

    if is_daily_pnl:
        # Daily PnL: price field contains the dollar P&L for that day
        # side='buy' means profit, side='sell' means loss
        df["daily_pnl"] = df.apply(
            lambda r: float(r["price"]) if r["side"] == "buy" else -float(r["price"]),
            axis=1,
        )
        daily_pnl = df.groupby("date")["daily_pnl"].sum()

        # audit-2026-05-07 C-0233 — dust threshold MUST be a fixed absolute
        # floor, not a function of the largest single-day PnL. Pre-fix:
        # `min_balance = max(daily_pnl.abs().max() * 2, 100)` scaled with the
        # LARGEST single-day P&L. A strategy with one $1M PnL day (Bybit
        # funding spike, OKX inverse-perp glitch, USDT-margin liquidation
        # cascade) gets `min_balance = $2M`; if the actual balance is $500k
        # — a perfectly reasonable institutional balance — the heuristic
        # branch fires and CAGR/Sharpe degrade by 5–10× per the docstring.
        # Manually-verified strategies with one big day show wrong numbers
        # on the public factsheet.
        #
        # The docstring is explicit about intent ("ignore dust accounts,
        # e.g., $0.50 after withdrawal"), so the threshold should be a
        # small absolute number well above genuine dust but well below
        # any real trading balance. $1,000 USDT mirrors the audit's
        # explicit example and is the smallest defensible institutional
        # balance — below that, the % returns are likely already gibberish.
        _DUST_BALANCE_THRESHOLD = 1000.0  # USDT — fixed, not PnL-scaled
        min_balance = _DUST_BALANCE_THRESHOLD
        if account_balance and account_balance > min_balance:
            # Real exchange anchor: today's balance IS the terminal NAV. The core
            # rolls the NAV backward (NAV_{t-1} = NAV_t - pnl_t) so day 0's
            # reconstructed pre-history base equals current_balance - total_pnl —
            # algebraically identical to the old forward equity curve for an
            # estimated_start>0 account (SC-4 byte-identity). The difference: a
            # reconstructed NON-positive base is no longer silently swapped for
            # today's balance; the core's negative_nav_guard FLAGS it (NaN).
            anchor_nav = float(account_balance)
        else:
            # Heuristic capital for CSV uploads with no balance (off by 5-10x on
            # volatile strategies). Audit-2026-05-07 #9: surface the path so the
            # caller sets data_quality_flags.heuristic_capital_used = True and
            # bumps computation_status to 'complete_with_warnings'. Pass a
            # synthetic terminal (base + total_pnl) so the core reconstructs the
            # SAME base the old forward curve started from — byte-identical.
            used_heuristic_capital = True
            mean_abs_pnl = daily_pnl.abs().mean()
            heuristic_base = max(mean_abs_pnl * 100, abs(daily_pnl.sum()), 10000)
            anchor_nav = heuristic_base + daily_pnl.sum()

        # Delegate to the Phase-73 honest core: reconstruct NAV backward from the
        # anchor and chain-link the TWR. No forward equity curve, no
        # prev_equity.replace(0, ...) base swap — a zeroed/negative base FLAGS.
        core_input = pd.Series(
            daily_pnl.to_numpy(),
            index=pd.DatetimeIndex(daily_pnl.index),
            name="daily_pnl",
        )
        returns, nav_meta = reconstruct_nav_and_twr(
            core_input,
            anchor_nav,
            external_flows=external_flows,
            open_unrealized_usd=open_unrealized_usd,
        )
        return returns, _merge_status_meta(
            nav_meta,
            used_heuristic_capital=used_heuristic_capital,
            balance_error=balance_error,
        )

    # Individual trades: aggregate raw fills to a per-day realized-PnL Series
    # (extract helper), then delegate to the SAME honest core as the daily_pnl
    # branch. This is the ONLY way portfolio.py:2260 (real fills) reaches the
    # honest path and satisfies TWR-03's :199 requirement.
    daily_pnl_series, first_net_notional = _individual_trades_daily_pnl(df)

    # audit-2026-05-07 C-0233 — fixed absolute dust floor (not PnL-scaled), same
    # as the daily_pnl branch: one outlier day must not force the heuristic
    # branch when the caller has a legitimate institutional balance.
    min_balance_t = 1000.0  # USDT — fixed dust floor, matches daily_pnl path
    if account_balance and account_balance > min_balance_t:
        # Real anchor: today's balance is the terminal NAV (SC-4 byte-identity
        # for estimated_start>0). A reconstructed non-positive base now FLAGS via
        # the core's negative_nav_guard instead of the deleted substitution.
        anchor_nav = float(account_balance)
    else:
        # Audit-2026-05-07 #9: heuristic-capital surface for the individual path
        # (samples one day's net notional — even less reliable than the daily_pnl
        # heuristic). Surface it. Pass a synthetic terminal (base + total_pnl) so
        # the core reconstructs the SAME base the old forward curve started from.
        used_heuristic_capital = True
        heuristic_base = abs(first_net_notional) or 10000.0
        anchor_nav = heuristic_base + float(daily_pnl_series.sum())

    core_input = pd.Series(
        daily_pnl_series.to_numpy(),
        index=pd.DatetimeIndex(daily_pnl_series.index),
        name="daily_pnl",
    )
    returns, nav_meta = reconstruct_nav_and_twr(
        core_input,
        anchor_nav,
        external_flows=external_flows,
        open_unrealized_usd=open_unrealized_usd,
    )
    return returns, _merge_status_meta(
        nav_meta,
        used_heuristic_capital=used_heuristic_capital,
        balance_error=balance_error,
    )


def _individual_trades_daily_pnl(df: pd.DataFrame) -> tuple[pd.Series, float]:
    """Aggregate raw individual fills into a per-day realized-PnL Series for the
    honest core. ``notional = price * quantity`` (sells negated), ``fee_usd``
    subtracted: ``pnl_day = net_notional - total_fees``. Returns
    ``(pnl_series, first_day_net_notional)`` — the second value seeds the
    heuristic base (``abs(first net notional) or 10000``) when no account balance
    is available. The returned Series is named to match the core's daily_pnl
    input; the caller converts its index to a DatetimeIndex before delegating."""
    df = df.copy()
    df["notional"] = df["price"].astype(float) * df["quantity"].astype(float)
    df.loc[df["side"] == "sell", "notional"] *= -1
    df["fee_usd"] = df["fee"].fillna(0).astype(float)

    daily_agg = df.groupby("date").agg(
        net_notional=("notional", "sum"),
        total_fees=("fee_usd", "sum"),
    )
    daily_agg["pnl"] = daily_agg["net_notional"] - daily_agg["total_fees"]
    return daily_agg["pnl"], float(daily_agg["net_notional"].iloc[0])


# DQ-01 NAV-denominator guards + the FLOW-04/DQ-02 warn flags the core
# (reconstruct_nav_and_twr) may raise on its NavTWRMeta. ALL are carried through
# _merge_status_meta ADDITIVELY and fold into complete_with_warnings, exactly like
# _build_nav_meta — so the core's materiality/coverage judgment is the SINGLE
# source and is never silently dropped at the transforms boundary (MEDIUM-1). A
# flow-less / immaterial account never sets any of these, so the SC-4 / Phase 74
# byte-identity accounts stay `complete`.
_GUARD_KEYS = (
    "dust_nav_guard",
    "negative_nav_guard",
    "flow_dominated_guard",
    "flow_coverage_incomplete",
    "unrealized_pnl_in_anchor",
    # MUST-2 (v1.8): the uPnL wedge field was unreadable on a MTM venue. Like
    # flow_coverage_incomplete it is set by the broker wiring post-combine, not
    # the core, so nav_meta never carries it HERE — but it is registered for
    # single-source consistency (the SC-4 / P74 byte-identity accounts never set
    # it, so their status is unchanged).
    "unrealized_pnl_unreadable",
)


def _merge_status_meta(
    nav_meta: Mapping[str, Any],
    *,
    used_heuristic_capital: bool,
    balance_error: bool,
) -> "NavTWRMeta":
    """Fold the core's ``NavTWRMeta`` (DQ-01 guard flags) together with the
    transforms-side ``used_heuristic_capital`` / ``balance_error`` signals.

    The core always yields ``used_heuristic_capital=False`` / ``balance_error=
    False`` (it reconstructs from the real anchor and reads no balance), so this
    function is the single place the two signal families combine:
    ``complete_with_warnings`` iff the heuristic was used OR the balance read
    errored OR any core warn flag fired. The additive keys (dust/negative/
    flow-dominated NAV guards + the FLOW-04 ``unrealized_pnl_in_anchor`` /
    DQ-02 ``flow_coverage_incomplete``) are carried THROUGH onto the returned meta
    so 74-03 can lift them into the data-quality flags — the core's judgment is the
    single source and is never dropped here (MEDIUM-1)."""
    guard_fired = any(nav_meta.get(k) for k in _GUARD_KEYS)
    warn = used_heuristic_capital or balance_error or guard_fired
    meta: NavTWRMeta = {
        "used_heuristic_capital": used_heuristic_capital,
        "balance_error": balance_error,
        "computation_status_hint": (
            "complete_with_warnings" if warn else "complete"
        ),
    }
    # Explicit assignments (not a loop) keep the TypedDict literal-key types
    # checkable under mypy --strict, mirroring nav_twr._build_nav_meta.
    if nav_meta.get("dust_nav_guard"):
        meta["dust_nav_guard"] = True
    if nav_meta.get("negative_nav_guard"):
        meta["negative_nav_guard"] = True
    if nav_meta.get("flow_dominated_guard"):
        meta["flow_dominated_guard"] = True
    if nav_meta.get("flow_coverage_incomplete"):
        meta["flow_coverage_incomplete"] = True
    if nav_meta.get("unrealized_pnl_in_anchor"):
        meta["unrealized_pnl_in_anchor"] = True
    if nav_meta.get("unrealized_pnl_unreadable"):
        meta["unrealized_pnl_unreadable"] = True
    return meta


def _build_meta(
    *, used_heuristic_capital: bool, balance_error: bool
) -> "NavTWRMeta":
    """Build the ``ReturnsComputationMeta`` returned to the caller.

    The ``computation_status_hint`` is "complete_with_warnings" when
    either ``used_heuristic_capital`` or ``balance_error`` is set,
    otherwise "complete". The consumer in ``analytics_runner.py``
    promotes ``strategy_analytics.computation_status`` to
    "complete_with_warnings" specifically when one of these two
    consumer-migration flags fires.

    Section-level flags (position_metrics_failed,
    position_side_volume_failed, trade_mix_approximation,
    account_balance_unavailable, no_linked_api_key,
    benchmark_unavailable, etc.) deliberately keep
    computation_status='complete' even when their corresponding DQF
    keys fire — eight frontend consumers gate exact-string on
    `computation_status === "complete"` (factsheet PDFs, discovery
    page, strategy detail, portfolios, queries, PerformanceReport,
    SyncProgress). Promoting those flags would break PDF rendering
    and metric grids on every demo strategy and every strategy with
    a stale benchmark. Migrating the consumers to accept both states
    is a separate follow-up PR.
    """
    if used_heuristic_capital or balance_error:
        hint = "complete_with_warnings"
    else:
        hint = "complete"
    return {
        "used_heuristic_capital": used_heuristic_capital,
        "balance_error": balance_error,
        "computation_status_hint": hint,
    }


def downsample_series(series: list[dict[str, Any]], target_points: int = 90) -> list[float]:
    """Downsample a time series to target_points for sparklines."""
    if len(series) <= target_points:
        return [p["value"] for p in series]

    step = len(series) / target_points
    return [series[int(i * step)]["value"] for i in range(target_points)]


def cap_data_points(data: list[Any], max_points: int = 5000) -> list[Any]:
    """Truncate data to max_points, keeping the most recent."""
    if len(data) <= max_points:
        return data
    return data[-max_points:]
