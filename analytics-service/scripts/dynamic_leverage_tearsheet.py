#!/usr/bin/env python3
"""Build a QuantStats tearsheet for a NAV track under a drawdown-responsive
leverage rule.

Motivating question (2026-07-29): take a daily FX NAV track, run it at 30x
notional leverage, and instead of letting notional shrink as equity falls,
lever UP during a drawdown (to a hard 50x ceiling) so the notional stays
pinned at its high-water level.

The rule
--------
Constant-notional-in-drawdown. Target notional is ``base_leverage x HWM``,
where HWM is the running high-water mark of the LEVERED equity curve. Each
day's leverage is set from the prior close::

    L_t = min(max_leverage, base_leverage * HWM_{t-1} / Equity_{t-1})

Because ``HWM >= Equity`` by construction, ``L_t >= base_leverage`` always:
the rule only ever levers UP, and only inside a drawdown. At a new high it
relaxes back to exactly ``base_leverage``. The ceiling binds once equity is
below ``base/max`` of the HWM (at 30x/50x: a -40% drawdown), after which
notional does start shrinking again — the cap is what stops the rule from
being a martingale.

This is deliberately path-dependent and self-referential (leverage reacts to
the levered curve's own drawdown, not the unlevered track's), so it is
integrated day by day rather than vectorised.

Usage
-----
    python scripts/dynamic_leverage_tearsheet.py INPUT.csv --outdir ./out

Input is the standard daily NAV export: a ``Date`` column plus ``NAV``, with
optional ``Daily P&L`` used as a cash-flow cross-check.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # noqa: E402  headless render for the tearsheet plots

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import quantstats as qs  # noqa: E402

# Annualisation clock. 252 matches services/metrics.py's headline risk basis
# (volatility / Sharpe / Sortino) for a business-day track.
PERIODS_PER_YEAR = 252


# --------------------------------------------------------------------------
# Input parsing
# --------------------------------------------------------------------------


def _to_float(value: object) -> float:
    """Parse the export's money/percent strings: ``"$10,004,272.89"``, ``"-$5,915.71"``."""
    if isinstance(value, (int, float, np.floating)):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace("%", "")
    if text in {"", "-", "nan", "None"}:
        return float("nan")
    # "-$5,915.71" has already lost its "$"; a trailing "()" negative is also seen.
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    return float(text)


def load_nav(path: Path) -> tuple[pd.Series, float]:
    """Read the NAV export and return ``(nav_series, inferred_starting_nav)``.

    The export's first row is the first TRADING day, whose ``Daily P&L`` is
    measured against a starting NAV that never appears as its own row. That
    seed is recovered as ``NAV_1 - PnL_1`` so the first day's return is not
    silently dropped.
    """
    # The export carries a blank leading column and a blank first line.
    raw = pd.read_csv(path, skip_blank_lines=True)
    if "Date" not in raw.columns:
        raw = pd.read_csv(path, skiprows=1)
    raw = raw.loc[:, [c for c in raw.columns if not str(c).startswith("Unnamed")]]
    raw = raw.dropna(subset=["Date"])

    dates = pd.to_datetime(raw["Date"])
    nav = pd.Series(
        [_to_float(v) for v in raw["NAV"]], index=dates, name="NAV"
    ).sort_index()

    if "Daily P&L" in raw.columns:
        pnl = pd.Series([_to_float(v) for v in raw["Daily P&L"]], index=dates).sort_index()
        seed = float(nav.iloc[0] - pnl.iloc[0])
        # Cross-check: with no external cash flows, NAV diffs must equal P&L.
        implied = nav.diff().iloc[1:]
        residual = (implied - pnl.iloc[1:]).abs().max()
        if residual > 0.01:
            print(
                f"  ! NAV diffs and Daily P&L disagree by up to ${residual:,.2f} — "
                "the track may contain external cash flows, which would make raw "
                "NAV percentage changes a biased return proxy.",
                file=sys.stderr,
            )
    else:
        seed = float(nav.iloc[0])

    return nav, seed


def nav_to_returns(nav: pd.Series, seed: float) -> pd.Series:
    """Simple daily returns off the NAV path, seeded so day 1 is retained."""
    full = pd.concat([pd.Series([seed], index=[nav.index[0] - pd.Timedelta(days=1)]), nav])
    returns = full.pct_change().dropna()
    returns.index = nav.index
    return returns.rename("returns")


# --------------------------------------------------------------------------
# The leverage rule
# --------------------------------------------------------------------------


@dataclass
class LeveredTrack:
    returns: pd.Series
    leverage: pd.Series
    equity: pd.Series
    notional: pd.Series
    ruined: bool


def apply_dynamic_leverage(
    unit_returns: pd.Series,
    base_leverage: float,
    max_leverage: float,
) -> LeveredTrack:
    """Integrate the constant-notional-in-drawdown rule day by day.

    ``unit_returns`` are per-unit-of-notional returns (i.e. the track's
    returns already divided by whatever leverage it was reported at). Leverage
    for day t is fixed at t-1's close, so no look-ahead enters the path.
    """
    equity = 1.0
    hwm = 1.0
    lev_path: list[float] = []
    eq_path: list[float] = []
    ret_path: list[float] = []
    notional_path: list[float] = []
    ruined = False

    for r in unit_returns.to_numpy(dtype=float):
        lev = min(max_leverage, base_leverage * hwm / equity)
        levered_r = lev * r
        notional_path.append(lev * equity)
        lev_path.append(lev)
        ret_path.append(levered_r)

        equity *= 1.0 + levered_r
        if equity <= 0.0:
            # Total loss: the position wiped the account. Freeze at zero rather
            # than propagating a negative equity through the rest of the path.
            ruined = True
            equity = 0.0
            eq_path.append(equity)
            remaining = len(unit_returns) - len(eq_path)
            lev_path.extend([0.0] * remaining)
            ret_path.extend([0.0] * remaining)
            notional_path.extend([0.0] * remaining)
            eq_path.extend([0.0] * remaining)
            break

        hwm = max(hwm, equity)
        eq_path.append(equity)

    idx = unit_returns.index
    return LeveredTrack(
        returns=pd.Series(ret_path, index=idx, name="returns"),
        leverage=pd.Series(lev_path, index=idx, name="leverage"),
        equity=pd.Series(eq_path, index=idx, name="equity"),
        notional=pd.Series(notional_path, index=idx, name="notional"),
        ruined=ruined,
    )


def apply_static_leverage(unit_returns: pd.Series, leverage: float) -> LeveredTrack:
    """Constant-leverage comparator: notional rides equity up AND down."""
    returns = (unit_returns * leverage).rename("returns")
    equity = (1.0 + returns).cumprod()
    return LeveredTrack(
        returns=returns,
        leverage=pd.Series(leverage, index=unit_returns.index, name="leverage"),
        equity=equity,
        notional=(equity * leverage).rename("notional"),
        ruined=bool((equity <= 0).any()),
    )


def apply_monthly_notional(
    unit_returns: pd.Series,
    base_leverage: float,
    max_leverage: float | None = None,
) -> LeveredTrack:
    """The live mechanism: notional is FIXED within a calendar month.

    Founder clarification (2026-07-29): the strategy compounds monthly, not
    per-trade. Notional is struck at each month open from that month's opening
    equity and then held flat all month — a -36% day does not shrink the
    position, and a +36% day does not grow it. Only at the next month open does
    notional re-strike off the realised P&L.

    So within month m, equity evolves LINEARLY in the running sum of unit
    returns::

        E_t = E_open,m * (1 + L_m * C_t),   C_t = sum of unit returns month-to-date

    which makes the month's return exactly ``L_m * (arithmetic sum of daily
    unit returns)`` — no intra-month volatility drag, because there is no
    intra-month compounding. Across months the E_open chain compounds
    geometrically.

    The daily series returned is the true time-weighted daily return,
    ``L*r_t / (1 + L*C_{t-1})``, whose product reproduces the month-end equity
    exactly. Note its percentage magnitude DECAYS as equity rises within a
    month (fixed notional over a larger base) — that is the mechanism, not an
    artefact.

    If ``max_leverage`` is set, the drawdown lever-up rides on the same monthly
    clock: leverage is re-struck at each month open as
    ``min(max_leverage, base * HWM / E_open)`` and held for the month.

    Intra-month insolvency is checked at every step: once ``1 + L*C_t <= 0``
    the account is gone mid-month regardless of how the month would have ended.
    """
    idx = unit_returns.index
    periods = idx.to_period("M")

    equity = 1.0
    hwm = 1.0
    lev_path: list[float] = []
    eq_path: list[float] = []
    ret_path: list[float] = []
    notional_path: list[float] = []
    ruined = False

    for month in periods.unique():
        mask = periods == month
        month_returns = unit_returns[mask].to_numpy(dtype=float)

        open_equity = equity
        if max_leverage is None:
            lev = base_leverage
        else:
            lev = min(max_leverage, base_leverage * hwm / open_equity)
        notional = lev * open_equity  # struck once, held all month

        running = 0.0
        prev_equity = open_equity
        for r in month_returns:
            running += r
            new_equity = open_equity * (1.0 + lev * running)
            lev_path.append(notional / prev_equity if prev_equity > 0 else 0.0)
            notional_path.append(notional)
            if new_equity <= 0.0:
                # Margin call mid-month: fixed notional cannot de-risk into it.
                ruined = True
                ret_path.append(-1.0)
                eq_path.append(0.0)
                remaining = len(unit_returns) - len(eq_path)
                lev_path.extend([0.0] * remaining)
                ret_path.extend([0.0] * remaining)
                notional_path.extend([0.0] * remaining)
                eq_path.extend([0.0] * remaining)
                break
            ret_path.append(new_equity / prev_equity - 1.0)
            eq_path.append(new_equity)
            prev_equity = new_equity

        if ruined:
            break
        equity = prev_equity
        hwm = max(hwm, equity)

    return LeveredTrack(
        returns=pd.Series(ret_path, index=idx, name="returns"),
        leverage=pd.Series(lev_path, index=idx, name="leverage"),
        equity=pd.Series(eq_path, index=idx, name="equity"),
        notional=pd.Series(notional_path, index=idx, name="notional"),
        ruined=ruined,
    )


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------


def summarise(name: str, track: LeveredTrack, starting_nav: float) -> dict[str, object]:
    r = track.returns
    dd = track.equity / track.equity.cummax() - 1.0
    years = (r.index[-1] - r.index[0]).days / 365.0
    total = float(track.equity.iloc[-1] - 1.0)
    return {
        "strategy": name,
        "total_return": total,
        "ending_nav": starting_nav * float(track.equity.iloc[-1]),
        "cagr": (1.0 + total) ** (1.0 / years) - 1.0 if years > 0 and total > -1 else float("nan"),
        "volatility": float(r.std(ddof=1) * np.sqrt(PERIODS_PER_YEAR)),
        "sharpe": float(qs.stats.sharpe(r, periods=PERIODS_PER_YEAR)),
        "sortino": float(qs.stats.sortino(r, periods=PERIODS_PER_YEAR)),
        "max_drawdown": float(dd.min()),
        "best_day": float(r.max()),
        "worst_day": float(r.min()),
        "avg_leverage": float(track.leverage.mean()),
        "max_leverage": float(track.leverage.max()),
        "ruined": track.ruined,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path, help="daily NAV export")
    ap.add_argument("--outdir", type=Path, default=Path("."), help="where to write the tearsheet")
    ap.add_argument("--base-leverage", type=float, default=30.0, help="baseline / at-high-water leverage")
    ap.add_argument("--max-leverage", type=float, default=50.0, help="hard ceiling reached in drawdown")
    ap.add_argument(
        "--source-leverage",
        type=float,
        default=1.0,
        help=(
            "leverage the INPUT track was already run at. Returns are divided by "
            "this to get per-unit-of-notional returns before re-levering. Leave at "
            "1.0 if the export is an unlevered/1x track."
        ),
    )
    ap.add_argument("--title", default="FX Daily — Dynamic Leverage", help="tearsheet title")
    ap.add_argument(
        "--mechanism",
        choices=("monthly", "daily"),
        default="monthly",
        help=(
            "how notional re-strikes. 'monthly' (the live mechanism): notional is "
            "fixed within a calendar month and re-struck at each month open. "
            "'daily': notional tracks equity every day (continuous compounding)."
        ),
    )
    ap.add_argument(
        "--sweep",
        type=float,
        nargs="*",
        default=[10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 75.0, 100.0],
        help="leverage levels to tabulate alongside the headline run",
    )
    ap.add_argument("--no-dynamic", action="store_true", help="skip the drawdown lever-up variant")
    ap.add_argument(
        "--benchmark-leverage",
        type=float,
        default=30.0,
        help="leverage of the static comparator shown as the tearsheet benchmark",
    )
    args = ap.parse_args()

    args.outdir.mkdir(parents=True, exist_ok=True)

    nav, seed = load_nav(args.csv)
    raw_returns = nav_to_returns(nav, seed)
    unit_returns = raw_returns / args.source_leverage

    print(f"Loaded {len(raw_returns)} trading days: "
          f"{raw_returns.index[0]:%Y-%m-%d} -> {raw_returns.index[-1]:%Y-%m-%d}")
    print(f"Starting NAV ${seed:,.2f} -> ending NAV ${nav.iloc[-1]:,.2f} "
          f"({nav.iloc[-1] / seed - 1:+.2%} as reported)")

    # Month-by-month arithmetic sums drive everything under the monthly
    # mechanism: month return == leverage x sum, so the worst monthly sum sets
    # the wipeout leverage and the worst intra-month running sum sets the
    # margin-call leverage (which is the binding one).
    by_month = unit_returns.groupby(unit_returns.index.to_period("M"))
    monthly = pd.DataFrame(
        {
            "sum_unit_return": by_month.sum(),
            "worst_intramonth_cum": by_month.apply(lambda s: s.cumsum().min()),
            "days": by_month.size(),
        }
    )
    monthly.to_csv(args.outdir / "monthly_unit_returns.csv")
    worst_month = float(monthly["sum_unit_return"].min())
    worst_intramonth = float(monthly["worst_intramonth_cum"].min())

    shown = monthly.copy()
    shown["sum_unit_return"] = (shown["sum_unit_return"] * 100).round(4)
    shown["worst_intramonth_cum"] = (shown["worst_intramonth_cum"] * 100).round(4)
    print("\nMonthly arithmetic sum of unit returns (the fixed-notional month return per 1x, %):")
    print(shown.to_string())

    # The binding constraint is the worst INTRA-month running loss, not the
    # worst month-end sum: fixed notional cannot de-risk into a mid-month hole,
    # so the account is called there even if the month would have closed green.
    print(f"\n  worst full month          : {worst_month:+.4%}", end="")
    print(f"  -> month-end wipeout at {abs(1 / worst_month):,.0f}x" if worst_month < 0
          else "  (no losing month in sample)")
    print(f"  worst intra-month drawdown: {worst_intramonth:+.4%}"
          f"  -> MARGIN CALL at {abs(1 / worst_intramonth):,.0f}x  <-- binding constraint")

    # Identity check: under a fixed monthly notional the month return must be
    # exactly leverage x the arithmetic sum. Verifies the integrator.
    _probe = apply_monthly_notional(unit_returns, 10.0, None)
    _probe_monthly = _probe.equity.groupby(_probe.equity.index.to_period("M")).last()
    _probe_open = _probe_monthly.shift(1).fillna(1.0)
    _identity = (_probe_monthly / _probe_open - 1.0) - 10.0 * monthly["sum_unit_return"]
    assert _identity.abs().max() < 1e-9, f"monthly identity violated: {_identity.abs().max()}"

    if args.mechanism == "monthly":
        run_static = lambda lev: apply_monthly_notional(unit_returns, lev, None)  # noqa: E731
        run_dynamic = lambda: apply_monthly_notional(  # noqa: E731
            unit_returns, args.base_leverage, args.max_leverage
        )
    else:
        run_static = lambda lev: apply_static_leverage(unit_returns, lev)  # noqa: E731
        run_dynamic = lambda: apply_dynamic_leverage(  # noqa: E731
            unit_returns, args.base_leverage, args.max_leverage
        )

    static = run_static(args.base_leverage)
    unlevered = run_static(1.0)

    rows = [summarise(f"Static {args.base_leverage:g}x", static, seed)]
    if not args.no_dynamic:
        dynamic = run_dynamic()
        rows.insert(
            0, summarise(f"Dynamic {args.base_leverage:g}x->{args.max_leverage:g}x", dynamic, seed)
        )
    else:
        dynamic = static
    rows.append(summarise("Unlevered (1x)", unlevered, seed))
    summary = pd.DataFrame(rows).set_index("strategy")
    summary.to_csv(args.outdir / "leverage_summary.csv")

    # Leverage sweep: where the mechanism stops being survivable.
    sweep_rows = []
    for lev in sorted(set(args.sweep) | {args.base_leverage}):
        sweep_rows.append(summarise(f"{lev:g}x", run_static(lev), seed))
    sweep = pd.DataFrame(sweep_rows).set_index("strategy")
    sweep.to_csv(args.outdir / "leverage_sweep.csv")
    print("\nLeverage sweep (" + args.mechanism + " notional):")
    print(
        sweep[["total_return", "max_drawdown", "worst_day", "sharpe", "ruined"]]
        .assign(
            total_return=lambda d: (d.total_return * 100).map("{:,.1f}%".format),
            max_drawdown=lambda d: (d.max_drawdown * 100).map("{:.1f}%".format),
            worst_day=lambda d: (d.worst_day * 100).map("{:.1f}%".format),
            sharpe=lambda d: d.sharpe.round(2),
        )
        .to_string()
    )

    daily = pd.DataFrame(
        {
            "nav_reported": nav,
            "return_unit": unit_returns,
            "leverage_dynamic": dynamic.leverage,
            "return_dynamic": dynamic.returns,
            "equity_dynamic": dynamic.equity * seed,
            "notional_dynamic": dynamic.notional * seed,
            "return_static": static.returns,
            # EFFECTIVE leverage = notional / CURRENT equity. Under the monthly
            # mechanism this drifts away from the nominal figure all month:
            # UP as equity falls (the position does not shrink into a loss) and
            # DOWN as equity rises. Nominal leverage is only exact at month open.
            "leverage_static_effective": static.leverage,
            "equity_static": static.equity * seed,
            "notional_static": static.notional * seed,
        }
    )
    daily["drawdown_dynamic"] = dynamic.equity / dynamic.equity.cummax() - 1.0
    daily["drawdown_static"] = static.equity / static.equity.cummax() - 1.0
    daily.to_csv(args.outdir / "leverage_daily.csv")

    with pd.option_context("display.width", 200, "display.max_columns", 50):
        print("\n" + summary.to_string(float_format=lambda v: f"{v:,.4f}"))

    # Tearsheet: headline track vs the comparison leverage, so every QuantStats
    # comparison column answers "what did the extra leverage actually buy me".
    if args.no_dynamic:
        headline, headline_name = static, f"Static {args.base_leverage:g}x"
    else:
        headline = dynamic
        headline_name = f"Dynamic {args.base_leverage:g}x->{args.max_leverage:g}x"
    bench_track = run_static(args.benchmark_leverage)

    dyn_r = headline.returns.copy()
    bench_r = bench_track.returns.copy()
    dyn_r.name = headline_name
    bench_r.name = f"Static {args.benchmark_leverage:g}x"

    out_html = args.outdir / "quantstats_dynamic_leverage.html"
    qs.reports.html(
        dyn_r,
        benchmark=bench_r,
        rf=0.0,
        periods_per_year=PERIODS_PER_YEAR,
        title=args.title,
        output=str(out_html),
        download_filename=str(out_html),
    )
    print(f"\nWrote {out_html}")
    print(f"Wrote {args.outdir / 'leverage_summary.csv'}")
    print(f"Wrote {args.outdir / 'leverage_daily.csv'}")

    if dynamic.ruined:
        print("\n!! The dynamic track was fully wiped out — leverage rule is not survivable "
              "on this path.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    os.environ.setdefault("MPLBACKEND", "Agg")
    raise SystemExit(main())
