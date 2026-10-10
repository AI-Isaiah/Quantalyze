"""BTC-native -> USD daily returns: the Python twin of the TypeScript
``convertNativeReturnsToUsd`` (``src/lib/factsheet/native-to-usd.ts``).

Phase 164.6.6.2 (D-18, D-22, D-23). A BTC-denominated account's daily returns
become the USD daily returns of the same account, so they can be weighted
beside USD strategies. Founder, D-18: "BTC times BTC USD price = value, and
then you blend it."

The arithmetic, per strategy date ``d_k`` (``k >= 1``)::

    usd_k = (1 + r_k) * (P(d_k) / P(d_{k-1})) - 1

``r_k`` is the account's own (BTC) return and ``P`` the BTC daily close. It is
the return of the USD value ``NAV_btc * P``: a BTC NAV of 1.0 -> 1.1 with closes
60000 -> 66000 gives ``(1.1 * 66000) / (1.0 * 60000) - 1 = 0.21``. Weighting
the raw BTC return 0.10 instead silently drops the price leg of the account's
USD exposure.

Day 0 is dropped (RESEARCH Pitfall 9): the first day has no prior priced USD
value, so a USD return for it would be a price move the account was not yet
exposed to.

Honesty (T-164.6.6.2-41): a day whose USD return cannot be formed from two
priced days is ABSENT from the output, never 0, carried forward or
interpolated. That is the TypeScript pairing rule, restated: day ``k`` is
priced only when EVERY calendar day in ``[d_{k-1}, d_k]`` has a usable close
(BTC trades seven days a week, so a Friday-to-Monday interval needs the
Saturday and Sunday closes too), and a close that is non-finite or not
positive counts as missing. A non-finite input return is absent too.

A NON-FINITE return is how an absent day is KEPT in the input (WR-02): the
curve boundary, asked with ``keep_absent=True``, leaves a NaN at the date of a
day it could not form. This converter skips that day and prices the NEXT day
against the NaN day's own date, so a one-day native return is multiplied by the
price move over that same single day, never over the whole gap. The output never
carries a NaN.

``unit is None`` is a USD row: the SAME object is returned, untouched. A unit
with no price source (``btc_closes is None``) returns an EMPTY series, since no
price is invented: the caller must read that as "no BTC price source", never as
a flat account. BTC is the only native unit this phase admits (D-06), so any
non-None unit is priced by the BTC closes.

Levels (Phase 164.6.6.2.1, D-02): :func:`convert_native_levels_to_usd` prices a
native LEVEL (an equity or balance, not a return) on day ``D`` as
``level_D * P(D)``, with the stored close of that same day and no other. A
native NAV of 1.0 -> 1.1 with closes 60000 -> 66000 gives 60000.0 -> 72600.0,
and 72600 / 60000 - 1 = 0.21 is exactly what the returns converter above
returns for the same pair, so levels and returns agree by construction. A day
without a usable close is absent: a price is never forward-filled and never the
nearest close. :func:`price_live_balance` is the scalar twin for a live balance
and prices it only at the stored close of the latest COMPLETED UTC day (D-17).

The shared fixture ``tests/fixtures/native_to_usd_oracle.json`` is read by this
module's tests and by the TypeScript test, with hand-computed ``expected``
literals; it is what keeps the two runtimes equal (D-23: one function per
runtime, one shared oracle).

Pure: pandas only, no Supabase, no network. The one piece of I/O the blends
need, the BTC closes, is injected into :class:`UsdSeriesConverter` as a loader.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Awaitable, Callable, Iterable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

logger = logging.getLogger("quantalyze.analytics")

# The TypeScript `RETURNS_UNIT_RE` (src/lib/factsheet/returns-unit.ts), the same
# rule as the database CHECK on `data_quality_flags.native_unit`.
_UNIT_RE = re.compile(r"[A-Z]{2,10}")


def parse_native_unit(raw: Any) -> str | None:
    """Parse an untrusted unit (a jsonb value off ``data_quality_flags``).

    Anything that is not a well-formed code reads as absent, so a malformed
    value is treated as a USD row rather than as a unit. ``fullmatch`` (not
    ``match`` with ``$``) so a trailing newline is not accepted.
    """
    if not isinstance(raw, str):
        return None
    return raw if _UNIT_RE.fullmatch(raw) else None


def _usable_closes(btc_closes: pd.Series) -> dict[pd.Timestamp, float]:
    """The closes that can price a return, keyed by their UTC calendar day."""
    out: dict[pd.Timestamp, float] = {}
    for ts, close in btc_closes.items():
        try:
            value = float(close)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value) or value <= 0:
            continue
        out[pd.Timestamp(ts).normalize()] = value
    return out


def convert_native_returns_to_usd(
    series: pd.Series,
    unit: str | None,
    btc_closes: pd.Series | None,
) -> pd.Series:
    """Convert a native-unit daily returns series to USD daily returns.

    ``series``: DatetimeIndex -> the account's daily return in its native unit.
    ``btc_closes``: DatetimeIndex -> BTC USD close, the stored closes only.
    See the module docstring for the arithmetic and the honesty rules.
    """
    if unit is None:
        return series
    if btc_closes is None:
        return pd.Series([], index=pd.DatetimeIndex([]), name=series.name, dtype=float)

    closes = _usable_closes(btc_closes)
    ordered = series.sort_index()

    dates: list[pd.Timestamp] = []
    values: list[float] = []
    day = timedelta(days=1)
    for k in range(1, len(ordered)):
        cur = pd.Timestamp(ordered.index[k]).normalize()
        prev = pd.Timestamp(ordered.index[k - 1]).normalize()
        if cur <= prev:
            continue  # a repeated date has no interval to price
        r = ordered.iloc[k]
        if r is None or not math.isfinite(float(r)):
            continue
        # Every calendar day in [prev, cur] must hold a usable close: both
        # endpoints are closes and no day between them is missing.
        covered = True
        d = prev
        while d <= cur:
            if d not in closes:
                covered = False
                break
            d += day
        if not covered:
            continue
        dates.append(cur)
        values.append((1.0 + float(r)) * (closes[cur] / closes[prev]) - 1.0)

    return pd.Series(values, index=pd.DatetimeIndex(dates), name=series.name, dtype=float)


def convert_native_levels_to_usd(
    levels: pd.Series,
    unit: str | None,
    btc_closes: pd.Series | None,
) -> pd.Series:
    """Convert a native-unit daily LEVEL series to USD levels (D-02).

    The USD level on day ``D`` is the native level times the stored close of
    ``D``, for the days that have both; every other day is ABSENT. Entry
    contract mirrors :func:`convert_native_returns_to_usd`: ``unit is None``
    returns the SAME object; a unit with no price source (``btc_closes is
    None``) returns an EMPTY series with a ``DatetimeIndex``.

    A price is never forward-filled, never the nearest close, never zero.
    Carrying the NATIVE balance across quiet days is the caller's business and
    is legitimate (a BTC balance does not change because nobody traded); a
    PRICE fill is not, since it would state a USD value no stored close backs.
    The result is a float series sorted by day, with the input's name.
    """
    if unit is None:
        return levels
    if btc_closes is None:
        return pd.Series([], index=pd.DatetimeIndex([]), name=levels.name, dtype=float)

    closes = _usable_closes(btc_closes)
    dates: list[pd.Timestamp] = []
    values: list[float] = []
    for ts, level in levels.sort_index().items():
        try:
            native = float(level)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(native):
            continue
        day = pd.Timestamp(ts).normalize()
        close = closes.get(day)
        if close is None:
            continue
        dates.append(day)
        values.append(native * close)

    return pd.Series(values, index=pd.DatetimeIndex(dates), name=levels.name, dtype=float)


def latest_completed_close_day(now: datetime) -> pd.Timestamp:
    """UTC midnight of the latest COMPLETED UTC day: the day before the UTC date
    of ``now`` (D-17).

    ``benchmark_prices`` never holds today's row (``_completed_days_only``), so
    the latest close a live balance can ever use is the previous UTC day's. That
    refines D-08's "same UTC day". ``now`` must be timezone-aware (``ValueError``
    otherwise), so a naive local clock can never pick the day.
    """
    if now.tzinfo is None or now.tzinfo.utcoffset(now) is None:
        raise ValueError("latest_completed_close_day needs a timezone-aware datetime")
    today = now.astimezone(timezone.utc).date()
    return pd.Timestamp(today - timedelta(days=1))


def price_live_balance(
    native_amount: float,
    unit: str | None,
    btc_closes: pd.Series | None,
    now: datetime,
) -> tuple[float, pd.Timestamp] | None:
    """Price a live native balance in USD, or ``None`` (D-17).

    Returns ``(native_amount x close, day)`` where ``day`` is
    :func:`latest_completed_close_day` and ``close`` is the stored close of
    exactly that day. It never looks at any other day: an older close, or
    today's if one is present, is never used. Example: 0.4213 BTC at a stored
    61950.00 close dated the previous UTC day is 26099.535 (0.4213 x 61950.00 =
    24780 + 1319.535), dated that day.

    ``None`` for ``unit is None`` (a USD-family balance is not priced here), no
    price source, a non-finite amount, or no usable close on that one day. The
    caller stores the returned day beside the USD value (D-17's label rule; plan
    07 writes it to ``api_keys.account_balance_usdt_close_date``).
    """
    if unit is None or btc_closes is None:
        return None
    try:
        amount = float(native_amount)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(amount):
        return None
    day = latest_completed_close_day(now)
    close = _usable_closes(btc_closes).get(day)
    if close is None:
        return None
    return amount * close, day


def native_units_by_id(
    analytics_rows: Iterable[Mapping[str, Any]], id_key: str = "strategy_id"
) -> dict[str, str]:
    """``{strategy id: native unit}`` for the ``strategy_analytics`` rows that
    carry one, read from ``data_quality_flags.native_unit`` on the SAME row the
    caller reads ``returns_series`` from.

    A row with no ``data_quality_flags``, a non-dict one, no ``native_unit`` or
    a malformed one (:func:`parse_native_unit`) is a USD row and is absent from
    the result.
    """
    units: dict[str, str] = {}
    for row in analytics_rows:
        flags = row.get("data_quality_flags")
        if not isinstance(flags, Mapping):
            continue
        unit = parse_native_unit(flags.get("native_unit"))
        if unit is not None:
            units[row[id_key]] = unit
    return units


class UsdSeriesConverter:
    """Per-request conversion of a blend's strategy series to USD (D-23).

    The weighted blends (portfolio analytics, optimizer, bridge, simulator, the
    match engine's personalized series) weight whatever series they are given, so
    every native-unit series is converted BEFORE the weighted sum. This holds the
    BTC closes for one request: ``load_closes`` is awaited at most once, and only
    when some series actually carries a unit, so a USD-only request reads nothing
    extra and behaves exactly as before.

    ``load_closes`` is passed in (not imported) so this module stays free of I/O.
    """

    def __init__(self, load_closes: Callable[[], Awaitable[pd.Series | None]]) -> None:
        self._load_closes = load_closes
        self._closes: pd.Series | None = None
        self._loaded = False

    async def _btc_closes(self) -> pd.Series | None:
        if not self._loaded:
            self._closes = await self._load_closes()
            self._loaded = True
        return self._closes

    async def convert(
        self,
        series_by_id: dict[str, pd.Series],
        units_by_id: Mapping[str, str],
    ) -> tuple[dict[str, pd.Series], list[str]]:
        """Return ``(converted map, dropped ids)``.

        Series without a unit pass through as the same objects; with no unit at
        all the input dict itself comes back and no closes are read. A unit whose
        conversion is EMPTY (no price source, or no priced interval) is dropped
        from the map and named in ``dropped ids``, logged: the caller routes it
        through its existing missing-series path rather than weighting a flat or
        raw-BTC series.
        """
        if not any(sid in units_by_id for sid in series_by_id):
            return series_by_id, []
        closes = await self._btc_closes()
        out: dict[str, pd.Series] = {}
        dropped: list[str] = []
        for sid, series in series_by_id.items():
            unit = units_by_id.get(sid)
            if unit is None:
                out[sid] = series
                continue
            converted = convert_native_returns_to_usd(series, unit, closes)
            if converted.empty:
                dropped.append(sid)
                continue
            out[sid] = converted
        if dropped:
            logger.warning(
                "native -> USD conversion left %d strategy series empty (%s); "
                "dropped from the blend: %s",
                len(dropped),
                "no BTC price source" if closes is None else "no priced interval",
                dropped,
            )
        return out, dropped
