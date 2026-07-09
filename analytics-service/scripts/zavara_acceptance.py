"""Zavara allocated-capital acceptance harness — drives the PRODUCTION code path.

This is the committed successor to the throwaway ``zavara_verify`` probe: instead
of hand-assembling the aggregation, it runs the SAME production entrypoint the
worker runs —

    build_deribit_native_ledger(exchange, pnl_basis="cash_settlement")

— and then the SAME allocated-capital metrics the worker computes
(``allocated_capital_returns_and_metrics``). So a green run PROVES the productionized
code reproduces the zavara verification (the ledger's ``native_pnl`` IS
``txn_rows_to_native_daily(cash_settlement)`` by construction — the exact per-(day,
ccy) native P&L the <0.001 BTC verification validated), not a parallel re-derivation.

Emits per-key JSON for a LOCAL diff against zavara's reported daily CSV:
  * ``btc_daily``     — the production ledger's per-UTC-day native BTC P&L (the
                        quantity zavara's ``daily_pnl_btc`` column reports);
  * ``metrics``       — the allocated-capital headline (cumulative %, max drawdown %,
                        √365 Sharpe/Sortino, active/calendar day counts) under the
                        zavara capital schedule below.

The capital schedule is embedded here as an ACCEPTANCE FIXTURE — it is NOT written
to any ``strategies`` row (live activation for LTP068 is a separate deliberate step).

Run ON railway (injects the read-only DERIBIT creds for the chosen key):

  railway run -- python -m scripts.zavara_acceptance --key-index 1 > key1.json

Leak discipline: emits ONLY aggregated per-day P&L + scalar metrics (the same class
of quantity zavara's CSV reports) — never a raw balance, mark, secret, or ccxt
exception text (all exceptions are scrubbed to their class name).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Mapping
from typing import Any

import pandas as pd

from services.allocated_capital import (
    allocated_capital_returns_and_metrics,
    exclude_spot_extraction_for,
    metrics_day_basis,
    parse_returns_denominator_config,
)
from services.broker_dailies import gap_fill_daily_returns
from services.deribit_ingest import build_deribit_native_ledger
from services.metrics import compute_all_metrics

# The zavara allocated-capital schedule — an ACCEPTANCE FIXTURE, never attached to a
# live strategy row here (activation is a separate deliberate data change).
_ZAVARA_DENOMINATOR_CONFIG: dict[str, Any] = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "capital_schedule": [
        {"effective_from": "2025-08-03", "capital_usd": 4_000_000},
        {"effective_from": "2025-09-27", "capital_usd": 10_000_000},
        {"effective_from": "2025-12-16", "capital_usd": 1_000_000},
        {"effective_from": "2026-02-01", "capital_usd": 2_000_000},
    ],
    "metrics_basis": "active_day",
    # Fix A: the shipped factsheet compounds ARITHMETICALLY (capital-reset).
    "cumulative_method": "simple",
    # F3 — cap the acceptance window at 2026-03-31: the FAITHFULLY-COVERED span is
    # Aug-2025..Mar-2026 (~85% of the claimed track). Apr-2026+ is NOT corroborable
    # from these keys — capital had migrated OFF the subaccounts (shipped key3 April
    # +0.79% vs zavara composite +9.09%, not comparable). maxDD is IDENTICAL at the
    # Mar and Apr cutoffs (−4.1328%), so nothing is lost on the leverage gate;
    # trimming April just removes a known-wrong, non-corroborable month.
    "mandate_end": "2026-03-31",
}

# Deribit is a crypto venue → the shipped factsheet annualizes on √365 (every
# calendar day trades), matching run_csv_strategy_analytics' asset-class signal.
_CRYPTO_PERIODS_PER_YEAR = 365


def _series_to_day_map(series: pd.Series) -> dict[str, float]:
    """A tz-naive midnight DatetimeIndex Series → ``{YYYY-MM-DD: value}``."""
    return {ts.strftime("%Y-%m-%d"): float(v) for ts, v in series.items()}


# ---------------------------------------------------------------------------
# PURE, credentials-free acceptance helpers (Finding 6). These take already-
# computed daily-% maps + the zavara CSV TEXT (never a live crawl), so they are
# importable and unit-testable offline (tests/test_zavara_acceptance.py). Every
# quantity is aggregated daily-% / a scalar — no raw balance, mark, or secret.
# ---------------------------------------------------------------------------


def parse_zavara_daily_return_pct(csv_text: str) -> dict[str, float]:
    """Parse the zavara CSV TEXT → ``{date: daily_return_pct}`` (the ground-truth
    daily series). The ``cum_return_pct`` column is DELIBERATELY ignored — the
    acceptance note flags it as a different, unreliable basis; only the per-day
    ``daily_return_pct`` shape is matched."""
    import csv as _csv
    import io as _io

    out: dict[str, float] = {}
    for row in _csv.DictReader(_io.StringIO(csv_text)):
        day = str(row.get("date", "")).strip()
        raw = row.get("daily_return_pct")
        if not day or raw is None or str(raw).strip() == "":
            continue
        try:
            out[day] = float(raw)
        except (TypeError, ValueError):
            continue
    return out


def fit_uniform_scale(
    shipped: Mapping[str, float], truth: Mapping[str, float]
) -> tuple[float, float]:
    """The single least-squares uniform SCALE factor ``k`` that best aligns the
    ``shipped`` daily-% series to ``truth`` over their COMMON dates, plus the max
    per-day absolute deviation AFTER scaling (``max|k·shipped − truth|``).

    ``k = Σ(s·t) / Σ(s·s)`` (the least-squares scalar). A well-matched shape has
    ``k ≈ 1`` and a small max deviation; a systematic mis-scaling (e.g. a wrong
    capital base) moves ``k`` off 1 while keeping the shape, and a genuine shape
    mismatch inflates the deviation. Empty overlap / degenerate ``shipped`` →
    ``(nan, nan)``."""
    common = sorted(set(shipped) & set(truth))
    if not common:
        return float("nan"), float("nan")
    s = [float(shipped[d]) for d in common]
    t = [float(truth[d]) for d in common]
    denom = sum(x * x for x in s)
    if denom == 0.0:
        return float("nan"), float("nan")
    k = sum(a * b for a, b in zip(s, t)) / denom
    max_dev = max(abs(k * a - b) for a, b in zip(s, t))
    return k, max_dev


def stitched_arithmetic_maxdd_pct(daily_pct_by_date: Mapping[str, float]) -> float:
    """Max drawdown (%, non-positive) on the ARITHMETIC-cumulative (running-SUM)
    daily-% series in ascending date order — the zavara convention (``basis =
    arithmetic_sum_of_daily_return_pct``). 0.0 for a monotone / empty series. This
    is the SAME running-sum drawdown ``compute_all_metrics`` uses on the simple
    method, applied to the STITCHED (all-keys) daily series."""
    cum = 0.0
    peak = 0.0
    mdd = 0.0
    for day in sorted(daily_pct_by_date):
        cum += float(daily_pct_by_date[day])
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return mdd


def monthly_sums_pct(daily_pct_by_date: Mapping[str, float]) -> dict[str, float]:
    """Arithmetic Σ of daily % per calendar month (``"YYYY-MM"``) — the
    single-convention monthly grid Finding 2 makes the shipped factsheet use, so
    the cells SUM to the arithmetic cumulative headline and are diffable against the
    CSV's own per-month sums."""
    out: dict[str, float] = {}
    for day in sorted(daily_pct_by_date):
        out[day[:7]] = out.get(day[:7], 0.0) + float(daily_pct_by_date[day])
    return out


def compare_shipped_to_csv(
    shipped_pct_by_date: Mapping[str, float],
    csv_daily_pct: Mapping[str, float],
) -> dict[str, Any]:
    """Bundle the Finding-6 diffs: (a) the uniform scale ``k`` + max per-day
    deviation of the shipped daily % vs the CSV; (b) the arithmetic-cumulative
    maxDD of each; (c) the per-month sums of each (single-convention grid). All
    read-only, credentials-free."""
    k, max_dev = fit_uniform_scale(shipped_pct_by_date, csv_daily_pct)
    shipped_monthly = monthly_sums_pct(shipped_pct_by_date)
    csv_monthly = monthly_sums_pct(csv_daily_pct)
    monthly_max_dev = max(
        (
            abs(shipped_monthly.get(m, 0.0) - csv_monthly.get(m, 0.0))
            for m in set(shipped_monthly) | set(csv_monthly)
        ),
        default=float("nan"),
    )
    return {
        "scale_k": k,
        "max_per_day_abs_dev_pct": max_dev,
        "n_common_days": len(set(shipped_pct_by_date) & set(csv_daily_pct)),
        "shipped_maxdd_pct": stitched_arithmetic_maxdd_pct(shipped_pct_by_date),
        "csv_maxdd_pct": stitched_arithmetic_maxdd_pct(csv_daily_pct),
        "shipped_monthly_pct": shipped_monthly,
        "csv_monthly_pct": csv_monthly,
        "monthly_max_abs_dev_pct": monthly_max_dev,
    }


async def _run(key_index: int, *, csv_path: str | None = None) -> dict[str, Any]:
    from scripts.deribit_acceptance import _build_deribit_exchange
    from services.exchange import aclose_exchange

    # F1: parse the config BEFORE the build so the harness builds the ledger in the
    # SAME mode the worker uses for a config-bearing (allocated) strategy — routed
    # through the ONE shared source. The Zavara fixture is always config-bearing, so
    # ``exclude_spot_extraction`` is True: the harness now exercises the flagship
    # Bug-B net-daily exclusion against live data, and the emitted btc_daily matches
    # zavara's daily_pnl_btc (extraction legs dropped), never the pre-fix leak.
    config = parse_returns_denominator_config(_ZAVARA_DENOMINATOR_CONFIG)
    assert config is not None
    _exclude_spot = exclude_spot_extraction_for(config)

    exchange = _build_deribit_exchange(key_index)
    try:
        # THE production path (worker parity): same pnl_basis + exclude_spot_extraction
        # the worker derives for this config (cash_settlement, spot-extraction dropped).
        ledger, report = await build_deribit_native_ledger(
            exchange,
            pnl_basis=config.pnl_basis,
            exclude_spot_extraction=_exclude_spot,
        )
    finally:
        await aclose_exchange(exchange)

    btc_pnl: Mapping[str, float] = ledger.native_pnl.get(
        "BTC", pd.Series(dtype=float)
    )
    from services.external_flows import USD_FAMILY

    # Leak-safe mark-coverage diagnostic (currency names + DAY COUNTS only, no
    # values): per non-USD-family currency, how many native-P&L days lack a same-day
    # mark. Distinguishes a whole-currency mark hole from a per-day gap.
    coverage: dict[str, dict[str, int]] = {}
    for ccy, pnl in ledger.native_pnl.items():
        cu = str(ccy).upper()
        if cu in USD_FAMILY:
            continue
        mark = ledger.marks.get(ccy)
        if mark is None or len(mark) == 0:
            coverage[cu] = {"pnl_days": int(len(pnl)), "unmarked_days": int(len(pnl))}
            continue
        aligned = mark.reindex(pnl.index)
        coverage[cu] = {
            "pnl_days": int(len(pnl)),
            "unmarked_days": int(aligned.isna().sum()),
        }

    out: dict[str, Any] = {
        "key_index": key_index,
        "currencies": sorted(ledger.native_pnl),
        "mark_coverage": coverage,
        # The zavara-comparable per-day native BTC P&L (production ledger).
        "btc_daily": _series_to_day_map(pd.Series(btc_pnl)),
        "pre_coverage_option_days": [
            f"{c}:{d}" for c, d in report.pre_coverage_option_days
        ],
    }
    try:
        returns, metrics = allocated_capital_returns_and_metrics(
            ledger.native_pnl, ledger.marks, config
        )
        # meta scalars (secondary cross-check — these do NOT ship to the factsheet).
        out["metrics"] = {k: (None if _isnan(v) else v) for k, v in metrics.items()}
        out["n_return_days"] = int(len(returns))

        # Fix F — validate what SHIPS: drive the FULL production factsheet path.
        # combine_native_ledger gap-fills the allocated-capital returns to a dense
        # daily calendar (broker_dailies.gap_fill_daily_returns) before they are
        # persisted to csv_daily_returns and reloaded by run_csv_strategy_analytics,
        # which then calls compute_all_metrics with the strategy's conventions. We
        # reproduce that EXACTLY here (gap-fill → compute_all_metrics with the same
        # crypto/simple/active conventions) so a green diff proves the SHIPPED
        # factsheet — not the non-shipping `meta` scalars — reproduces zavara.
        dense_returns = gap_fill_daily_returns(returns)
        _day_basis = metrics_day_basis(config.metrics_basis)
        if len(dense_returns) >= 2:
            shipped = compute_all_metrics(
                dense_returns,
                None,  # no benchmark needed for the headline diff
                periods_per_year=_CRYPTO_PERIODS_PER_YEAR,
                cumulative_method=config.cumulative_method,
                day_basis=_day_basis,
            )
            mj = shipped.metrics_json
            # The SHIPPED headline scalars diffed against zavara's CSV. cumulative_
            # return / max_drawdown are FRACTIONS (×100 = the reported %).
            out["shipped_metrics"] = {
                "cumulative_return": _none_if_nan(mj.get("cumulative_return")),
                "cumulative_return_pct": _pct(mj.get("cumulative_return")),
                "max_drawdown": _none_if_nan(mj.get("max_drawdown")),
                "max_drawdown_pct": _pct(mj.get("max_drawdown")),
                "sharpe": _none_if_nan(mj.get("sharpe")),
                "sortino": _none_if_nan(mj.get("sortino")),
                "volatility": _none_if_nan(mj.get("volatility")),
                "cagr": _none_if_nan(mj.get("cagr")),
                "calmar": _none_if_nan(mj.get("calmar")),
            }
            out["n_dense_return_days"] = int(len(dense_returns))
            # Finding 6: the SHIPPED per-day return % (fraction × 100) — the exact
            # quantity zavara's ``daily_return_pct`` column reports. Emitted so the
            # orchestrator can stitch all keys into one series; also compared to the
            # CSV in-line when a ``--csv`` path is supplied.
            shipped_daily_pct = {
                d: v * 100.0 for d, v in _series_to_day_map(dense_returns).items()
            }
            out["shipped_daily_return_pct"] = shipped_daily_pct
            if csv_path is not None:
                with open(csv_path, encoding="utf-8") as fh:
                    csv_daily = parse_zavara_daily_return_pct(fh.read())
                out["csv_comparison"] = compare_shipped_to_csv(
                    shipped_daily_pct, csv_daily
                )
    except Exception as e:  # emit diagnostics even when valuation fails loud
        out["metrics_error"] = type(e).__name__
    return out


def _none_if_nan(v: Any) -> Any:
    return None if _isnan(v) or v is None else v


def _pct(v: Any) -> Any:
    return None if _isnan(v) or v is None else float(v) * 100.0


def _isnan(v: Any) -> bool:
    return isinstance(v, float) and v != v


def stitch_key_outputs(
    per_key_daily_pct: list[Mapping[str, float]],
    csv_daily_pct: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Stitch each key's ``shipped_daily_return_pct`` map into ONE arithmetic daily
    series (sequential subaccounts — dates do not overlap across keys) and report
    the combined arithmetic-cumulative maxDD + cumulative. When ``csv_daily_pct`` is
    supplied, also fit the uniform scale and per-day/per-month deviations of the
    STITCHED series against the CSV. Pure / offline — no creds."""
    stitched: dict[str, float] = {}
    overlaps: list[str] = []
    for m in per_key_daily_pct:
        for day, val in m.items():
            if day in stitched:
                overlaps.append(day)
            stitched[day] = float(val)
    out: dict[str, Any] = {
        "n_stitched_days": len(stitched),
        "overlap_days": sorted(set(overlaps)),
        "stitched_maxdd_pct": stitched_arithmetic_maxdd_pct(stitched),
        "stitched_cumulative_pct": sum(stitched.values()),
    }
    if csv_daily_pct is not None:
        out["csv_comparison"] = compare_shipped_to_csv(stitched, csv_daily_pct)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--key-index", type=int, help="live per-key run (needs Deribit creds)"
    )
    p.add_argument(
        "--csv", type=str, default=None,
        help="zavara CSV path — diff the shipped daily series against it (offline)",
    )
    p.add_argument(
        "--stitch", nargs="+", default=None, metavar="KEY_JSON",
        help="offline: stitch per-key JSON outputs into one series + combined maxDD",
    )
    args = p.parse_args(argv)

    # OFFLINE stitch mode — no live crawl, no creds. Reads the per-key JSON files
    # emitted by earlier live runs plus (optionally) the CSV.
    if args.stitch is not None:
        per_key: list[Mapping[str, float]] = []
        for path in args.stitch:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            per_key.append(doc.get("shipped_daily_return_pct", {}))
        csv_daily = None
        if args.csv is not None:
            with open(args.csv, encoding="utf-8") as fh:
                csv_daily = parse_zavara_daily_return_pct(fh.read())
        print(json.dumps(stitch_key_outputs(per_key, csv_daily), sort_keys=True))
        return 0

    if args.key_index is None:
        p.error("either --key-index (live) or --stitch (offline) is required")
    try:
        result = asyncio.run(_run(args.key_index, csv_path=args.csv))
    except Exception as e:  # scrub — never surface ccxt text / secrets
        print(json.dumps({"error": type(e).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    # L2: this is the committed acceptance GATE — its own success signal must be
    # fail-loud. A money-guard exception was caught into ``metrics_error`` (so the
    # diagnostics still print) but the run is NOT a pass: exit nonzero so a caught
    # valuation failure can never be mistaken for a green acceptance.
    if result.get("metrics_error"):
        print(
            json.dumps({"acceptance_failed": result["metrics_error"]}),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
