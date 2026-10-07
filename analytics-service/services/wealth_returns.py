"""A stored ``strategy_analytics`` row read as DAILY RETURNS: the Python twin of the
TypeScript ``resolveDailyReturnSeries`` (``src/lib/factsheet/resolve-series.ts``).

Phase 164.6.6.2.2 (D-01, D-02). CR-01: ``strategy_analytics.returns_series`` is
the cumulative wealth CURVE the analytics worker writes (``(1 + r).cumprod()``
geometric, ``1 + r.cumsum()`` simple), NOT daily returns. Every Python blend that
weighted it as returns used a level (about 1.0) where a daily return (about
0.00x) belongs. This module is the one shared boundary every blend reads through.

Order (D-02, same as the TypeScript resolver): the row's ``daily_returns``, when
it holds at least one finite value, wins verbatim and ``returns_series`` is
ignored. Only when ``daily_returns`` is absent, null, ``[]``, ``{}`` or holds no
finite value is the daily-return series DERIVED from the curve.

Deriving from the curve (D-01). The method is
``data_quality_flags.cumulative_method`` when it is the literal ``geometric`` or
``simple`` (the raw worker strings); absent reads geometric silently, any other
present value logs one warning and reads geometric::

    geometric:  r_k = w_k / w_{k-1} - 1     both stored-adjacent levels finite and > 0
    simple:     r_k = w_k - w_{k-1}         both stored-adjacent levels finite

Day 0 never emits (it has no stored predecessor). ABSENT-never-0: a day whose
stored-adjacent level pair is unusable is absent from the output, never 0,
never carried forward, never interpolated, and never bridged across a dropped
level (the day after a bad level pairs with the bad level, so it is absent too).
A non-positive level is legal on the simple curve and unusable on the geometric.

Nothing usable returns ``None``, never an empty Series, so each caller's existing
missing-returns accounting is unchanged.

The shared fixture ``tests/fixtures/wealth_to_returns_oracle.json`` is read by
this module's tests and by the TypeScript test, with hand-computed ``expected``
literals; it is what keeps the two runtimes equal (one function per runtime, one
shared oracle).

KNOWN parity gaps with TypeScript, stated so parity is not over-claimed:
(a) a dict-shaped ``returns_series`` is read by TypeScript (via
``normalizeDailyReturns``) but returns None here: no writer produces one and the
oracle uses array curves only; (b) a numeric STRING value is coerced to a number
here by ``pd.to_numeric`` but is non-finite in TypeScript. Duplicate-date dedupe
(last record wins) is Python-only: TypeScript does not dedupe.

Pure: pandas, numpy, math and logging, plus ``parse_native_unit`` from the equally pure
``services.native_to_usd``. No Supabase, no I/O, no router import.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping
from datetime import timedelta
from typing import Any

import numpy as np
import pandas as pd

from services.native_to_usd import parse_native_unit

logger = logging.getLogger("quantalyze.analytics")

CURVE_GEOMETRIC = "geometric"
CURVE_SIMPLE = "simple"


def curve_method_from_flags(flags: Any, *, name: str = "") -> str:
    """The curve's cumulative method off ``data_quality_flags``.

    ``geometric`` and ``simple`` are the only recognised literals. Non-mapping
    flags or an absent / None key read geometric silently (the platform default).
    Any other present value logs ONE warning (the series name only, never the
    value) and reads geometric.
    """
    if not isinstance(flags, Mapping):
        return CURVE_GEOMETRIC
    raw = flags.get("cumulative_method")
    if raw is None:
        return CURVE_GEOMETRIC
    if isinstance(raw, str) and raw in (CURVE_GEOMETRIC, CURVE_SIMPLE):
        return raw
    logger.warning(
        "wealth_returns: unrecognised cumulative_method for %s; reading geometric",
        name or "<unnamed>",
    )
    return CURVE_GEOMETRIC


def records_to_series(
    raw: Any,
    name: str = "",
    *,
    keep_nonfinite: bool = False,
) -> pd.Series | None:
    """Convert ``[{date, value}, ...]`` records to a DatetimeIndex float Series.

    The returned Series is sorted by date and deduped (last record on a date
    wins). G15-006 (audit-2026-05-07): storage drift (duplicate-date backfill
    writes, out-of-order imports) must not silently break a downstream path-
    dependent ``cumprod``.

    G15-008/G15-009 (audit-2026-05-07): ``returns_series`` is JSONB written by
    the analytics worker, so a record that is not a dict, or has no parseable
    date, is skipped and warned about ONCE per series (a count and the series
    name, never a value). Returns None when nothing usable remains, so a router
    falls into its "no returns" path instead of a 500.

    ``keep_nonfinite=False`` drops a record whose value is null, non-numeric or
    non-finite. ``keep_nonfinite=True`` keeps it as NaN: the curve path needs the
    position so the days that pair with it come out absent rather than bridged.
    """
    if not isinstance(raw, list) or not raw:
        return None

    dates: list[Any] = []
    vals: list[Any] = []
    skipped = 0
    for r in raw:
        if not isinstance(r, dict):
            skipped += 1
            continue
        d = r.get("date")
        if d is None:
            skipped += 1
            continue
        v = r.get("value")
        if isinstance(v, bool):
            v = None  # True is not a level of 1.0
        dates.append(d)
        vals.append(v)

    if dates:
        parsed = pd.to_datetime(
            pd.Series(dates, dtype=object), format="ISO8601", errors="coerce"
        )
        numeric = pd.to_numeric(pd.Series(vals, dtype=object), errors="coerce").astype(float)
        ok = parsed.notna().to_numpy()
        skipped += int((~ok).sum())
        if not keep_nonfinite:
            ok = ok & np.isfinite(numeric.to_numpy())
        index = pd.DatetimeIndex(parsed[ok])
        values = numeric[ok].to_numpy()
    else:
        index = pd.DatetimeIndex([])
        values = np.array([], dtype=float)

    if skipped:
        logger.warning(
            "wealth_returns: skipped %d malformed records for %s",
            skipped, name or "<unnamed>",
        )

    if len(index) == 0:
        return None

    series = pd.Series(values, index=index, name=name, dtype=float)
    # G15-006: sort THEN dedupe. Dedupe before sort would keep the last-by-input
    # occurrence rather than the last-by-date one; the contract is "last value
    # on a given date wins", which only holds after a STABLE sort.
    series = series.sort_index(kind="stable")
    return series[~series.index.duplicated(keep="last")]


def curve_to_daily_returns(
    levels: pd.Series | None, method: str, *, keep_absent: bool = False
) -> pd.Series | None:
    """Daily returns from a stored cumulative curve (sorted, deduped levels).

    ``method`` is :data:`CURVE_GEOMETRIC` or :data:`CURVE_SIMPLE`. Pairs each
    level with its STORED predecessor (``shift(1)``); a pair with a non-finite
    member (or, geometric, a non-positive one) is absent, so the day after a bad
    level is absent too rather than bridged. Day 0 never emits. Returns None when
    no day is formable.

    ``keep_absent=True`` (WR-02, 164.6.6.2.2 review) keeps each absent day AFTER
    day 0 in the output as a NaN placeholder at its own date instead of deleting
    it. The one consumer is the native -> USD converter, which prices a day's
    native return by the BTC move over the interval ``[previous series date,
    this date]``: with the absent day deleted that interval silently grew to span
    the whole gap, so a one-day native return was multiplied by a multi-day price
    move. With the placeholder kept, the converter skips the NaN day and prices
    the next day over its own single interval. A series built this way carries
    NaN and MUST go through the converter (which drops it), never into a blend.
    """
    if levels is None or len(levels) < 2:
        return None
    cur = levels.astype(float)
    prev = cur.shift(1)
    both_finite = np.isfinite(cur) & np.isfinite(prev)
    if method == CURVE_SIMPLE:
        mask = both_finite
        with np.errstate(invalid="ignore"):
            out = cur - prev
    else:
        mask = both_finite & (cur > 0) & (prev > 0)
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            out = cur / prev - 1.0
    if keep_absent:
        out = out.where(mask & np.isfinite(out)).iloc[1:]
        if not np.isfinite(out).any():
            return None
    else:
        out = out[mask]
        out = out[np.isfinite(out)]
        if out.empty:
            return None
    out.name = levels.name
    return out


def _normalize_daily_returns(raw: Any, name: str) -> pd.Series | None:
    """Private twin of the TypeScript ``normalizeDailyReturns``: three shapes
    (array of ``{date, value}``, flat ``{date: value}``, nested
    ``{year: {MM-DD: value}}`` with zero-padding), finite values only."""
    if not raw:
        return None
    if isinstance(raw, list):
        return records_to_series(raw, name)
    if not isinstance(raw, dict):
        return None

    def _finite(v: Any) -> bool:
        return (
            isinstance(v, (int, float))
            and not isinstance(v, bool)
            and math.isfinite(v)
        )

    records: list[dict[str, Any]] = []
    for k, v in raw.items():
        if _finite(v):
            records.append({"date": str(k), "value": v})
        elif isinstance(v, dict):
            for kk, vv in v.items():
                if not _finite(vv):
                    continue
                key = str(kk)
                if len(key) == 10:
                    records.append({"date": key, "value": vv})
                else:
                    mm, _, dd = key.partition("-")
                    records.append(
                        {"date": f"{k}-{mm.rjust(2, '0')}-{dd.rjust(2, '0')}", "value": vv}
                    )
    return records_to_series(records, name)


def daily_returns_from_row(
    row: Mapping[str, Any] | None,
    *,
    name: str,
    keep_absent: bool = False,
) -> pd.Series | None:
    """The row's daily returns (D-02 order; see the module docstring).

    ``row`` is a ``strategy_analytics`` row; None, ``{}`` and missing keys are
    tolerated. Returns None when neither source yields a usable day.

    ``keep_absent`` (WR-02): pass True ONLY where the series is handed to
    :func:`services.native_to_usd.convert_native_returns_to_usd` (or the
    ``UsdSeriesConverter``) next. It is honoured only for a row that carries a
    native unit and only on the curve-derived path, where it keeps each absent
    day as a NaN placeholder so the converter prices the following day over its
    own single interval, not over the gap (see :func:`curve_to_daily_returns`).
    A USD row, and a row whose ``daily_returns`` column wins, come back exactly
    as without it, so a USD series can never carry a NaN placeholder.
    """
    if not isinstance(row, Mapping):
        return None
    direct = _normalize_daily_returns(row.get("daily_returns"), name)
    if direct is not None:
        return direct
    levels = records_to_series(row.get("returns_series"), name, keep_nonfinite=True)
    flags = row.get("data_quality_flags")
    method = curve_method_from_flags(flags, name=name)
    native = isinstance(flags, Mapping) and parse_native_unit(flags.get("native_unit")) is not None
    return curve_to_daily_returns(levels, method, keep_absent=keep_absent and native)


def equity_from_daily_returns(returns: pd.Series) -> pd.Series:
    """Internal endpoint-ratio scaffold: a 1.0 base point dated one calendar day
    before the first return, then ``(1.0 + returns).cumprod()``.

    Input to :func:`services.metrics.total_return_from_equity` for BOTH the
    per-strategy TWRs and the portfolio TWR, so ``compute_attribution`` compares
    the same window (days 1..n)::

        total_return_from_equity(equity_from_daily_returns(r)) == prod(1 + r) - 1

    Never persisted or charted.
    """
    if returns.empty:
        return pd.Series([], index=pd.DatetimeIndex([]), name=returns.name, dtype=float)
    ordered = returns.sort_index()
    base_date = pd.Timestamp(ordered.index[0]) - timedelta(days=1)
    grown = (1.0 + ordered.astype(float)).cumprod()
    index = pd.DatetimeIndex([base_date]).append(pd.DatetimeIndex(grown.index))
    values = np.concatenate([[1.0], grown.to_numpy()])
    return pd.Series(values, index=index, name=returns.name, dtype=float)
