"""Phase 19 / FINGERPRINT-01..02 — v0 fingerprint computation.

Builds a versioned 5-component fingerprint from a normalized Trade list +
MetricsSnapshot. Output is the locked JSONB shape consumed by migration
105 ``compute_similarity`` (cosine over a 46-dim concatenated vector).

Locked shape (CONTEXT.md L66-72):

  {
    version: 1,
    trade_size_buckets:        [4 floats, sum=1.0]    # USD notional
    hold_duration_buckets:     [4 floats, sum=1.0]    # FIFO holding pair age
    asset_class_mix:           [4 floats, sum=1.0]    # spot / perp_long / perp_short / futures
    instrument_concentration:  [10 floats, sum=1.0]   # top-10 symbols, zero-padded
    temporal_pattern:          [24 floats, sum=1.0]   # UTC hour-of-day
  }

Bucket boundaries are LOCKED — must match the planner's enum exactly so
similarity rankings are stable across deploys. Re-bucketing is a v1 → v2
migration concern (UC-C: pgvector may also subsume this; v0 stays plain
plpgsql / pure Python).

Empty trade list → all components are zero arrays. compute_similarity
returns 0.0 on either-zero norm so the empty case is benign for the
similarity ranker (matches migration 105 behavior).

pgvector explicitly DEFERRED to v2 per UC-C. This module returns a
plain Python tuple-of-floats Fingerprint dataclass; the to_jsonb()
serializer on Fingerprint produces a JSON-compatible dict. No vector
SDK import here.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone

from services.ingestion.adapter import Fingerprint, MetricsSnapshot, Trade


# ---------------------------------------------------------------------------
# Locked bucket boundaries
# ---------------------------------------------------------------------------

# trade_size: USD notional thresholds. Convention: lower bound INCLUSIVE
# ([1000, 10000) lands in bucket 1) — locked so a trade exactly at $10k
# always maps to bucket 2 across deploys.
_TRADE_SIZE_THRESHOLDS: tuple[float, ...] = (1_000.0, 10_000.0, 100_000.0)

# hold_duration: edges in seconds. Convention: lower bound INCLUSIVE.
_HOLD_DURATION_THRESHOLDS: tuple[float, ...] = (
    3_600.0,            # 1 hour
    24 * 3_600.0,       # 1 day
    7 * 24 * 3_600.0,   # 1 week
)


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


def compute_fingerprint_v1(
    trades: list[Trade], metrics: MetricsSnapshot
) -> Fingerprint:
    """Compute the v0 (version=1) fingerprint for a strategy.

    Parameters
    ----------
    trades:
        Normalized Trade list from IngestionAdapter.fetch_raw. Each
        Trade has price, quantity, symbol, side, timestamp, order_type
        (the inputs needed to compute all 5 components).
    metrics:
        MetricsSnapshot — currently unused by the v0 fingerprint
        computation (kept on the signature for v1 → v2 forward compat;
        v2 may pull win_rate / sharpe into the asset_class_mix or
        introduce a new component sourced from metrics).

    Returns
    -------
    Fingerprint:
        Versioned 5-component fingerprint. Empty trades → all-zero
        components (cosine returns 0.0 on either-zero norm — benign for
        the similarity ranker).
    """
    # Suppress unused-arg lint while keeping the signature stable for v2.
    del metrics

    if not trades:
        return Fingerprint()

    return Fingerprint(
        version=1,
        trade_size_buckets=_compute_trade_size_buckets(trades),
        hold_duration_buckets=_compute_hold_duration_buckets(trades),
        asset_class_mix=_compute_asset_class_mix(trades),
        instrument_concentration=_compute_instrument_concentration(trades),
        temporal_pattern=_compute_temporal_pattern(trades),
    )


# ---------------------------------------------------------------------------
# Component 1 — trade_size_buckets
# ---------------------------------------------------------------------------


def _compute_trade_size_buckets(
    trades: list[Trade],
) -> tuple[float, float, float, float]:
    """Distribution of trade USD notionals into 4 buckets.

    Buckets (USD notional = price * quantity):
        0: notional < $1,000
        1: $1,000 <= notional < $10,000
        2: $10,000 <= notional < $100,000
        3: notional >= $100,000

    Convention: lower bound INCLUSIVE. A trade at exactly $1,000 lands
    in bucket 1; a trade at exactly $10,000 lands in bucket 2.
    """
    counts = [0, 0, 0, 0]
    for t in trades:
        notional = float(t.price) * float(t.quantity)
        if notional < _TRADE_SIZE_THRESHOLDS[0]:
            counts[0] += 1
        elif notional < _TRADE_SIZE_THRESHOLDS[1]:
            counts[1] += 1
        elif notional < _TRADE_SIZE_THRESHOLDS[2]:
            counts[2] += 1
        else:
            counts[3] += 1
    total = sum(counts)
    if total == 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        counts[0] / total,
        counts[1] / total,
        counts[2] / total,
        counts[3] / total,
    )


# ---------------------------------------------------------------------------
# Component 2 — hold_duration_buckets
# ---------------------------------------------------------------------------


def _compute_hold_duration_buckets(
    trades: list[Trade],
) -> tuple[float, float, float, float]:
    """Distribution of FIFO-matched holding-pair durations into 4 buckets.

    Pair construction:
      For each symbol, sort fills by timestamp and walk a FIFO queue.
      Buy fills enqueue (qty, ts); sell fills dequeue, producing a
      (open_ts, close_ts) pair per matched unit. The pair's hold
      duration is `close_ts - open_ts` (in seconds).

      Quantity matching is unit-by-unit: a 1-unit sell against a
      0.6-unit buy + 0.4-unit buy produces TWO holding pairs, each
      using the corresponding open timestamp. We approximate by
      treating each fill as one pair-event (matched against the
      oldest available open of opposite side, regardless of qty
      proportion) — adequate for v0 because the bucket boundaries are
      coarse (1h / 24h / 7d) and individual quantity weighting won't
      change the bucket on realistic trade flows.

    Buckets (seconds):
        0: < 3600                  ( <1h )
        1: 3600 <= dur < 86400     ( 1-24h )
        2: 86400 <= dur < 604800   ( 1-7d )
        3: dur >= 604800           ( >7d )

    Convention: lower bound INCLUSIVE.

    Empty pairs (no closed positions, e.g. all-buys input) → all zeros.
    """
    by_symbol: defaultdict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        by_symbol[t.symbol].append(t)

    durations_s: list[float] = []
    for symbol, fills in by_symbol.items():
        fills_sorted = sorted(fills, key=lambda f: _aware_ts(f.timestamp))
        open_queue: list[Trade] = []
        for fill in fills_sorted:
            side = fill.side.lower()
            if not open_queue:
                open_queue.append(fill)
                continue

            opposite = open_queue[0].side.lower()
            if side == opposite:
                # Same direction — extend the open queue.
                open_queue.append(fill)
            else:
                # Closing fill — pair against oldest open (FIFO).
                opener = open_queue.pop(0)
                dur = (
                    _aware_ts(fill.timestamp) - _aware_ts(opener.timestamp)
                ).total_seconds()
                if dur >= 0:
                    durations_s.append(dur)

    if not durations_s:
        return (0.0, 0.0, 0.0, 0.0)

    counts = [0, 0, 0, 0]
    for dur in durations_s:
        if dur < _HOLD_DURATION_THRESHOLDS[0]:
            counts[0] += 1
        elif dur < _HOLD_DURATION_THRESHOLDS[1]:
            counts[1] += 1
        elif dur < _HOLD_DURATION_THRESHOLDS[2]:
            counts[2] += 1
        else:
            counts[3] += 1
    total = sum(counts)
    return (
        counts[0] / total,
        counts[1] / total,
        counts[2] / total,
        counts[3] / total,
    )


# ---------------------------------------------------------------------------
# Component 3 — asset_class_mix
# ---------------------------------------------------------------------------


def _compute_asset_class_mix(
    trades: list[Trade],
) -> tuple[float, float, float, float]:
    """Distribution over [spot, perp_long, perp_short, futures].

    Class detection (heuristic — locked for v0):

      perp:
        - order_type in {'swap', 'perpetual', 'perp'} OR
        - symbol contains ':' (ccxt unified notation: 'BTC/USDT:USDT')
        long  → side == 'buy'
        short → side == 'sell'

      futures:
        - order_type in {'future', 'futures', 'delivery'} OR
        - symbol matches 'X/Y-DDMMM' / 'X/Y_DDMMM' (dated futures)

      spot:
        - everything else (default for unspecified order_type='spot' /
          'limit' / 'market' / 'csv' on a non-perp symbol)

    Convention: each fill contributes a single count to whichever
    bucket it matches. Long/short for perps come strictly from `side`.
    """
    counts = [0, 0, 0, 0]  # spot, perp_long, perp_short, futures
    for t in trades:
        symbol = (t.symbol or "").upper()
        order_type = (t.order_type or "").lower()
        side = (t.side or "").lower()

        is_futures = (
            order_type in ("future", "futures", "delivery")
            or _looks_like_dated_futures(symbol)
        )
        is_perp = (
            order_type in ("swap", "perpetual", "perp")
            or (":" in symbol and not is_futures)
        )

        if is_futures:
            counts[3] += 1
        elif is_perp:
            if side == "sell":
                counts[2] += 1
            else:
                counts[1] += 1
        else:
            counts[0] += 1

    total = sum(counts)
    if total == 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        counts[0] / total,
        counts[1] / total,
        counts[2] / total,
        counts[3] / total,
    )


def _looks_like_dated_futures(symbol: str) -> bool:
    """Heuristic for dated-futures notation: 'BTC/USDT-26DEC' or
    'BTC/USDT_26DEC'. False for plain spot (no separator) and perps
    (use ':' separator)."""
    if "-" not in symbol and "_" not in symbol:
        return False
    # Strip the perp suffix first (':') so 'BTC/USDT:USDT' doesn't trip.
    if ":" in symbol:
        return False
    # Dated futures conventionally have a digit after the separator.
    for sep in ("-", "_"):
        if sep in symbol:
            tail = symbol.split(sep, 1)[1]
            if tail and tail[0].isdigit():
                return True
    return False


# ---------------------------------------------------------------------------
# Component 4 — instrument_concentration (top-10, zero-padded)
# ---------------------------------------------------------------------------


def _compute_instrument_concentration(
    trades: list[Trade],
) -> tuple[float, ...]:
    """Top-10 symbols by trade count, normalized to sum=1.0 over kept top-10.

    Output length is ALWAYS 10 floats — pad with zeros if <10 distinct
    symbols. If >10 distinct symbols, only the top 10 by count are kept;
    the kept slice is re-normalized so the component sums to 1.0
    (cosine well-defined). Order is descending by count; ties broken
    deterministically by symbol name (alphabetical).

    Empty trades → 10 zeros.
    """
    if not trades:
        return tuple([0.0] * 10)

    counter: Counter[str] = Counter(t.symbol for t in trades)
    # Sort: descending by count, ascending by symbol name for tie-break.
    sorted_pairs = sorted(
        counter.items(),
        key=lambda kv: (-kv[1], kv[0]),
    )
    top10 = sorted_pairs[:10]
    kept_total = sum(count for _, count in top10)
    if kept_total == 0:
        return tuple([0.0] * 10)

    weights = [count / kept_total for _, count in top10]
    # Pad with zeros if fewer than 10 distinct symbols.
    while len(weights) < 10:
        weights.append(0.0)
    return tuple(weights)


# ---------------------------------------------------------------------------
# Component 5 — temporal_pattern (UTC hour-of-day, 24 buckets)
# ---------------------------------------------------------------------------


def _compute_temporal_pattern(
    trades: list[Trade],
) -> tuple[float, ...]:
    """Distribution of fill timestamps over UTC hour-of-day (0..23).

    Naive datetimes are interpreted as UTC (matches services/exchange.py
    fetcher convention — the broker SDKs emit UTC datetimes).

    Empty trades → 24 zeros.
    """
    counts = [0] * 24
    for t in trades:
        hour = _aware_ts(t.timestamp).hour
        counts[hour] += 1
    total = sum(counts)
    if total == 0:
        return tuple([0.0] * 24)
    return tuple(c / total for c in counts)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _aware_ts(ts: datetime) -> datetime:
    """Return a UTC-aware datetime.

    Naive datetimes are interpreted as UTC. Aware datetimes are
    converted to UTC for hour-of-day bucket assignment to be locale-
    independent.
    """
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Module exports
# ---------------------------------------------------------------------------

__all__: tuple[str, ...] = ("compute_fingerprint_v1",)
