"""ACC-01 golden-parity: the FROZEN anchor-to-today oracle.

This module re-materialises the OLD (pre-73, silently-inflated) daily-returns
behaviour so the golden old-vs-new parity harness has an honest OLD series to
diff the NEW flow-aware core against.

The OLD formula was DELETED from ``services/transforms.py`` in P73/P74. It
survives verbatim at the v1.8-branch merge-base commit ``9a1e7b8e``. The two
functions below are a VERBATIM TRANSCRIPTION of that code — NOT a paraphrase,
NOT a runtime import of the deleted module (RESEARCH rejected re-importing the
old ``transforms`` because it pulls the whole service graph and would drift).

Provenance (source of truth for BOTH branches):
    git show 9a1e7b8e:analytics-service/services/transforms.py  (L148-215)
    9a1e7b8e == `git merge-base v1.8-flow-aware-twr main` (confirmed).
    daily_pnl branch:          def trades_to_daily_returns_with_status @ L70,
                               dust-floor + equity math @ L146-181.
    individual-trades branch:  same function, else-branch @ L183-217.

DO NOT "fix" anything here. The `estimated_start <= 0 -> account_balance`
fallback IS the +458% LTP068 inflation bug — reproducing it exactly is the
whole point. Any drift from the real pre-73 output is caught by the
mutation-honest golden pin in tests/test_golden_parity.py.

Security (T-78-01): this module returns pandas Series / booleans only. It never
prints or embeds raw USD NAV / flow / balance magnitudes anywhere (account-size
leak class, T-73-02 / T-77-02 discipline).

stdlib + pandas + numpy ONLY. No import of services.transforms / services.nav_twr.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

# Fixed absolute dust floor (audit-2026-05-07 C-0233), NOT PnL-scaled.
# Verbatim from 9a1e7b8e:services/transforms.py L146 / L195.
_DUST_BALANCE_THRESHOLD = 1000.0  # USDT


def old_anchor_to_today_returns(
    daily_pnl: pd.Series,
    account_balance: float | None,
) -> pd.Series:
    """Frozen pre-73 anchor-to-today returns — daily_pnl branch (the LTP path).

    frozen from 9a1e7b8e:services/transforms.py L148-215 — DO NOT "fix", this
    IS the OLD behaviour we diff against. The `estimated_start > 0 else
    account_balance` fallback IS the +458% LTP068 bug.

    Args:
        daily_pnl: dollar P&L per day, indexed by date (already grouped — this
            is the ``daily_pnl = df.groupby("date")["daily_pnl"].sum()`` result
            in the real pre-73 code; the deterministic parse/group prelude is
            upstream of the buggy formula and is not transcribed here).
        account_balance: current account balance (USDT), or None.

    Returns:
        The OLD daily-returns Series (index=DatetimeIndex, name="returns"),
        byte-identical to pre-73 ``trades_to_daily_returns_with_status`` on the
        same aggregated daily_pnl.
    """
    # --- verbatim from 9a1e7b8e:services/transforms.py L146-176 (daily_pnl branch) ---
    min_balance = _DUST_BALANCE_THRESHOLD
    if account_balance and account_balance > min_balance:
        # Derive starting balance from current balance and cumulative PnL.
        # starting_balance = current_balance - total_pnl
        total_pnl = daily_pnl.sum()
        estimated_start = account_balance - total_pnl
        if estimated_start > 0:
            initial_capital = estimated_start
        else:
            # Account gained more than its starting balance (e.g. 10x return).
            # Use current balance as a reasonable upper bound.  <-- THE BUG
            initial_capital = account_balance
    else:
        # Fallback heuristic for CSV uploads where no balance is available.
        # Off by 5-10x for volatile strategies.
        mean_abs_pnl = daily_pnl.abs().mean()
        initial_capital = max(mean_abs_pnl * 100, abs(daily_pnl.sum()), 10000)

    # Build equity curve and compute returns.
    equity = initial_capital + daily_pnl.cumsum()
    prev_equity = equity.shift(1).fillna(initial_capital)
    # Avoid division by zero.
    prev_equity = prev_equity.replace(0, initial_capital)
    returns_values = daily_pnl / prev_equity
    # --- end verbatim (daily_pnl branch) ---

    return pd.Series(
        returns_values.values,
        # `returns_values.index` is the groupby("date") index of python `date`
        # objects, which pandas 3.0 infers as `[s]`; the witness in
        # test_golden_parity is built via `pd.to_datetime([...])` (`[us]`), so
        # pin the oracle to the same `[us]` unit for byte-identity (#593).
        index=pd.DatetimeIndex(returns_values.index).as_unit("us"),
        name="returns",
    )


# ---------------------------------------------------------------------------
# ACC-01 PANEL-GATE DRIVER (Plan 78-02)
# ---------------------------------------------------------------------------
# The driver below is the ACC-01 gate itself: it drives the frozen oracle above
# (the OLD series) against the LIVE flow-aware core (the NEW series) through the
# already-shipped ``services/parity_diff.py::classify_delta`` primitive, asserts
# the expected bucket per account, and FAILS CLOSED on any UNEXPLAINED delta.
#
# Purity note: the service-graph imports (parity_diff / nav_twr / metrics) are
# LOCAL to the driver functions on purpose — ``import scripts.golden_parity`` and
# the frozen oracle transcription above stay dependency-free (the golden-pin test
# imports only ``old_anchor_to_today_returns`` and must NOT drag the service
# graph). The driver is fixture/live-run only; it is NOT wired into
# ``.github/workflows/ci.yml`` (the Task-3 self-test is the CI gate — RESEARCH
# Pitfall 4).
#
# Security (T-78-01): the driver emits classification BUCKETS + COUNTS + BOOLEANS
# only. It NEVER prints or embeds a raw USD NAV / flow / balance / return
# magnitude (account-size leak class).


def _cagr_calmar(returns: pd.Series) -> dict[str, float | None]:
    """Extract just ``{"cagr", "calmar"}`` from the LIVE metrics core.

    Both sides go through HEAD ``compute_all_metrics`` (the 365-calendar CAGR
    clock), so on a byte-identical series the scalars are identical and the delta
    buckets UNCHANGED — the REANNUALIZATION 365/252 shift is only reachable by an
    ASYMMETRIC (252-vs-365) metrics pair, exercised directly in the self-test
    (LOW-3), never through this both-at-HEAD driver.

    A series with fewer than two valid (non-NaN) points has no defined CAGR; return
    ``None`` scalars in that case (``classify_delta`` only consults the metrics when
    the SERIES is unchanged, so an all-moved series never depends on this).
    """
    from services.metrics import compute_all_metrics

    if returns.dropna().shape[0] < 2:
        return {"cagr": None, "calmar": None}
    metrics_json = compute_all_metrics(returns).metrics_json
    return {"cagr": metrics_json.get("cagr"), "calmar": metrics_json.get("calmar")}


def gate_account(
    daily_pnl: pd.Series,
    account_balance: float | None,
    *,
    external_flows: Any | None,
    open_unrealized_usd: float,
    has_flows: bool,
    expected_bucket: str,
) -> bool:
    """Classify ONE account's OLD-vs-NEW return delta and assert the expected bucket.

    OLD is the frozen anchor-to-today oracle (flow-blind). NEW is the LIVE
    flow-aware core (``reconstruct_nav_and_twr``: reconstruct NAV backward from the
    real anchor, chain-link the TWR with dated flows in the numerator — the exact
    terminus ``transforms``/``broker_dailies`` delegate to; NOT a reimplemented
    chain-link). ``has_flows`` is ALWAYS caller-supplied (never inferred): a
    flow-less control that MOVES fails CLOSED as UNEXPLAINED.

    Raises ``AssertionError`` when the delta classifies UNEXPLAINED (fail-closed).
    Returns ``bucket == expected_bucket``.
    """
    from services.nav_twr import reconstruct_nav_and_twr
    from services.parity_diff import UNEXPLAINED, classify_delta

    old_returns = old_anchor_to_today_returns(daily_pnl, account_balance)

    # Feed the LIVE core the SAME anchor the honest transforms.py daily_pnl branch
    # uses (today's balance IS the terminal NAV); it rolls the NAV backward and
    # chain-links the TWR. external_flows=None on a control ⇒ byte-identical to OLD.
    core_input = pd.Series(
        daily_pnl.to_numpy(),
        index=pd.DatetimeIndex(daily_pnl.index),
        name="daily_pnl",
    )
    new_returns, _meta = reconstruct_nav_and_twr(
        core_input,
        float(account_balance) if account_balance is not None else 0.0,
        external_flows=external_flows,
        open_unrealized_usd=open_unrealized_usd,
    )

    bucket = classify_delta(
        old_returns,
        new_returns,
        old_metrics=_cagr_calmar(old_returns),
        new_metrics=_cagr_calmar(new_returns),
        has_flows=has_flows,
    )

    # Fail closed: an UNEXPLAINED delta is never accepted (T-73-04 / T-78-04). The
    # message carries the bucket label only — no USD magnitude (T-78-01).
    assert bucket != UNEXPLAINED, (
        f"ACC-01 gate breach: account classified {bucket!r} "
        f"(expected {expected_bucket!r}) — fail closed"
    )
    return bucket == expected_bucket


def main(accounts: Any | None = None) -> int:
    """Panel driver: classify every account, print buckets/counts, exit nonzero on
    ANY mismatch or ANY UNEXPLAINED.

    ``accounts`` is an iterable of ``PanelAccount`` (defaults to the CI panel). The
    return value is a process exit code (0 = clean panel, 1 = breach). Emits ONLY
    labels + buckets + booleans + counts — never a raw USD magnitude (T-78-01).
    """
    from services.parity_diff import UNEXPLAINED

    if accounts is None:
        from tests.fixtures.golden_parity.panel_fixtures import panel

        accounts = panel()

    passed = 0
    failed = 0
    for acct in accounts:
        try:
            ok = gate_account(
                acct.daily_pnl,
                acct.account_balance,
                external_flows=acct.external_flows,
                open_unrealized_usd=acct.open_unrealized_usd,
                has_flows=acct.has_flows,
                expected_bucket=acct.expected_bucket,
            )
        except AssertionError as exc:
            # UNEXPLAINED fail-closed (or any in-gate assertion). Report + count.
            print(f"  {acct.label}: {UNEXPLAINED} -> FAIL ({exc})")
            failed += 1
            continue
        status = "ok" if ok else "FAIL"
        print(
            f"  {acct.label}: expected {acct.expected_bucket} -> "
            f"{'match' if ok else 'MISMATCH'} [{status}]"
        )
        if ok:
            passed += 1
        else:
            failed += 1

    print(f"ACC-01 panel: {passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


def old_anchor_to_today_returns_from_trades(
    trades: list[dict[str, Any]],
    account_balance: float | None,
) -> pd.Series:
    """Frozen pre-73 anchor-to-today returns — individual-trades branch.

    frozen from 9a1e7b8e:services/transforms.py L148-215 — DO NOT "fix", this
    IS the OLD behaviour we diff against (Open Question 2: the parallel
    individual-trades branch at the same ref). Same `estimated_start > 0 else
    account_balance` fallback and `.replace(0, initial_capital)` divide-guard as
    the daily_pnl branch. Fixture coverage lives on the daily_pnl branch (the
    LTP path); this branch is covered-by-transcription.

    Args:
        trades: individual buy/sell records (order_type != 'daily_pnl') with
            timestamp / side / price / quantity / fee fields.
        account_balance: current account balance (USDT), or None.

    Returns:
        The OLD daily-returns Series (index=DatetimeIndex, name="returns").
    """
    # --- verbatim from 9a1e7b8e:services/transforms.py L98-116 + L178-212 ---
    df = pd.DataFrame(trades)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601", utc=True)
    df["date"] = df["timestamp"].dt.date

    df["notional"] = df["price"].astype(float) * df["quantity"].astype(float)
    df.loc[df["side"] == "sell", "notional"] *= -1
    df["fee_usd"] = df["fee"].fillna(0).astype(float)

    daily_agg = df.groupby("date").agg(
        net_notional=("notional", "sum"),
        total_fees=("fee_usd", "sum"),
    )
    daily_agg["pnl"] = daily_agg["net_notional"] - daily_agg["total_fees"]

    min_balance_t = _DUST_BALANCE_THRESHOLD  # 1000.0 — fixed dust floor, matches daily_pnl path
    if account_balance and account_balance > min_balance_t:
        total_pnl = daily_agg["pnl"].sum()
        estimated_start = account_balance - total_pnl
        initial_capital = estimated_start if estimated_start > 0 else account_balance
    else:
        initial_capital = abs(daily_agg["net_notional"].iloc[0]) or 10000

    equity = initial_capital + daily_agg["pnl"].cumsum()
    prev_equity = equity.shift(1).fillna(initial_capital)
    prev_equity = prev_equity.replace(0, initial_capital)
    returns_values = daily_agg["pnl"] / prev_equity
    # --- end verbatim (individual-trades branch) ---

    return pd.Series(
        returns_values.values,
        # See the daily_pnl-branch oracle above: pin the `date`-object groupby
        # index to `[us]` so pandas 3.0's `[s]` inference does not break
        # byte-identity against the `[us]` witness (#593).
        index=pd.DatetimeIndex(returns_values.index).as_unit("us"),
        name="returns",
    )


if __name__ == "__main__":  # pragma: no cover - CLI entry, exercised via main()
    import sys

    sys.exit(main())
