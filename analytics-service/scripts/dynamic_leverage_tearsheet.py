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
    args = ap.parse_args()

    args.outdir.mkdir(parents=True, exist_ok=True)

    nav, seed = load_nav(args.csv)
    raw_returns = nav_to_returns(nav, seed)
    unit_returns = raw_returns / args.source_leverage

    print(f"Loaded {len(raw_returns)} trading days: "
          f"{raw_returns.index[0]:%Y-%m-%d} -> {raw_returns.index[-1]:%Y-%m-%d}")
    print(f"Starting NAV ${seed:,.2f} -> ending NAV ${nav.iloc[-1]:,.2f} "
          f"({nav.iloc[-1] / seed - 1:+.2%} as reported)")

    dynamic = apply_dynamic_leverage(unit_returns, args.base_leverage, args.max_leverage)
    static = apply_static_leverage(unit_returns, args.base_leverage)
    unlevered = apply_static_leverage(unit_returns, 1.0)

    rows = [
        summarise(f"Dynamic {args.base_leverage:g}x->{args.max_leverage:g}x", dynamic, seed),
        summarise(f"Static {args.base_leverage:g}x", static, seed),
        summarise("Unlevered (1x)", unlevered, seed),
    ]
    summary = pd.DataFrame(rows).set_index("strategy")
    summary.to_csv(args.outdir / "leverage_summary.csv")

    daily = pd.DataFrame(
        {
            "nav_reported": nav,
            "return_unit": unit_returns,
            "leverage_dynamic": dynamic.leverage,
            "return_dynamic": dynamic.returns,
            "equity_dynamic": dynamic.equity * seed,
            "notional_dynamic": dynamic.notional * seed,
            "return_static": static.returns,
            "equity_static": static.equity * seed,
            "notional_static": static.notional * seed,
        }
    )
    daily["drawdown_dynamic"] = dynamic.equity / dynamic.equity.cummax() - 1.0
    daily["drawdown_static"] = static.equity / static.equity.cummax() - 1.0
    daily.to_csv(args.outdir / "leverage_daily.csv")

    with pd.option_context("display.width", 200, "display.max_columns", 50):
        print("\n" + summary.to_string(float_format=lambda v: f"{v:,.4f}"))

    # Tearsheet: the dynamic rule benchmarked against flat 30x, so every
    # QuantStats comparison column is exactly the "what did levering up in the
    # drawdown buy me" question.
    dyn_r = dynamic.returns.copy()
    bench_r = static.returns.copy()
    dyn_r.name = f"Dynamic {args.base_leverage:g}x->{args.max_leverage:g}x"
    bench_r.name = f"Static {args.base_leverage:g}x"

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
