"""The moved-flow price store (Phase 177 DERIBITFLOWS plan 03, D-05).

What this is for
----------------
A Deribit flow that ``apply_marks`` (rule 10) moves into its mark day is counted at the open of the
1-minute perpetual candle that contains it (D-04). Every derive re-applies ALL of a key's marks
from the first one, so without a store each night would re-read every historical moved flow and
its price would only be as stable as Deribit's 1-minute history. D-05 (founder, "Refuse + store
prices"): each resolved price is stored once in ``public.api_key_flow_prices`` and read back on
every later derive. This module is that table's whole read and write path. The caller
(``deribit_flow_prices.resolve_moved_flow_prices``) decides WHICH minutes to read from the venue.

The decisions it carries
------------------------
* Write-once, by grant and by statement. ``service_role`` holds SELECT and INSERT only on the
  table, and :func:`write_flow_prices` inserts ``ON CONFLICT DO NOTHING``
  (an ``upsert`` with duplicates ignored), so the first writer of a ``(api_key_id, instrument,
  minute_ms)`` keeps its price for good (the ``nav_marks.write_nav_mark`` rule).
* THE STORED ROW, NEVER THE LOCAL READ, IS THE AUTHORITY (Pitfall 1). A concurrent derive can
  have stored a different open for the same minute a moment earlier. :func:`write_flow_prices`
  therefore re-selects after the insert and returns THOSE prices, and the caller builds the index
  from them, so two derives of one key can never value one flow differently.
* The read chunk is at most :data:`FLOW_PRICES_CHUNK` minutes per request, far below PostgREST's
  ``max_rows`` clamp (``supabase/config.toml``, 1000). The clamp silently truncates a response, so
  a read that could exceed it could drop a stored price and send the caller back to the venue for
  it. At most 100 minute values per request means at most 100 rows, and more rows than minutes
  asked raises.
* Strict parse. A stored row that is malformed, non-finite, non-positive, outside the chunk, for
  another instrument or from another source raises :class:`FlowPriceStoreError`. It is never
  skipped (a skipped row would be priced from the venue again and could disagree with what the
  database holds) and never defaulted.
* No retry in here. A database error becomes :class:`FlowPriceStoreError` chained from its cause,
  and the job's own retry handling owns the second attempt.
* Deploy order. If the worker deploys before ``20261101120000_api_key_flow_prices.sql`` applied,
  the first read is a database error (the relation does not exist). That is a
  :class:`FlowPriceStoreError` too: loud, and retried, never a price used without the store.

Static error text only: no key id, amount, minute or instrument ever enters an exception message.
Sync functions; callers wrap them in ``services.db.db_execute``.
"""
from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Collection, Mapping
from typing import Any, Final

#: The table plan 02 created. Named once so a typo cannot split reader from writer.
FLOW_PRICES_TABLE: Final[str] = "api_key_flow_prices"

#: The one value the table's ``source`` CHECK admits: the open of the 1-minute perpetual candle.
FLOW_PRICE_SOURCE: Final[str] = "deribit_perp_1m_open"

#: Minutes per request, on both the read and the write. See the module docstring on ``max_rows``.
FLOW_PRICES_CHUNK: Final[int] = 100

_FLOW_PRICE_COLUMNS: Final[str] = "instrument,minute_ms,price,source"


class FlowPriceStoreError(RuntimeError):
    """A stored flow price could not be written or read back. Static text, no amount, key, minute
    or instrument."""


def _parse_stored(row: Mapping[str, Any], instrument: str, chunk: frozenset[int]) -> tuple[int, float]:
    """``(minute_ms, price)`` of a stored row asked for in ``chunk`` of ``instrument``.

    Any deviation raises (``KeyError``, ``TypeError``, ``ValueError`` and ``OverflowError`` from
    the coercions are caught by the caller and re-raised as :class:`FlowPriceStoreError`): the
    row's instrument is the one asked for, its minute is one of the minutes asked for, its price
    is finite and positive, and its source is the closed value."""
    if row["instrument"] != instrument:
        raise ValueError("instrument")
    minute = int(row["minute_ms"])
    if minute not in chunk:
        raise ValueError("minute")
    price = float(row["price"])
    if not math.isfinite(price) or price <= 0.0:
        raise ValueError("price")
    if row["source"] != FLOW_PRICE_SOURCE:
        raise ValueError("source")
    return minute, price


def read_flow_prices(
    supabase: Any, api_key_id: str, keys: Collection[tuple[str, int]]
) -> dict[tuple[str, int], float]:
    """The stored prices of ``api_key_id`` for ``keys`` (``(instrument, minute_ms)``), as
    ``{(instrument, minute_ms): price}``. A key with no stored row is absent from the result.

    One request per instrument and per sorted chunk of at most :data:`FLOW_PRICES_CHUNK` minutes.
    Empty ``keys`` makes no request. A database error, a response larger than its chunk, a repeated
    minute or any row failing the strict parse raises :class:`FlowPriceStoreError`."""
    by_instrument: dict[str, set[int]] = defaultdict(set)
    for instrument, minute_ms in keys:
        by_instrument[instrument].add(minute_ms)
    out: dict[tuple[str, int], float] = {}
    for instrument in sorted(by_instrument):
        minutes = sorted(by_instrument[instrument])
        for start in range(0, len(minutes), FLOW_PRICES_CHUNK):
            chunk = minutes[start : start + FLOW_PRICES_CHUNK]
            try:
                result = (
                    supabase.table(FLOW_PRICES_TABLE)
                    .select(_FLOW_PRICE_COLUMNS)
                    .eq("api_key_id", api_key_id)
                    .eq("instrument", instrument)
                    .in_("minute_ms", chunk)
                    .execute()
                )
            except Exception as exc:
                raise FlowPriceStoreError("api_key_flow_prices: read failed") from exc
            rows = list(result.data or [])
            if len(rows) > len(chunk):
                raise FlowPriceStoreError("api_key_flow_prices: read returned more rows than asked")
            asked = frozenset(chunk)
            seen: set[int] = set()
            for row in rows:
                try:
                    minute, price = _parse_stored(row, instrument, asked)
                except (KeyError, TypeError, ValueError, OverflowError) as exc:
                    raise FlowPriceStoreError("api_key_flow_prices: a stored row is not valid") from exc
                if minute in seen:
                    raise FlowPriceStoreError("api_key_flow_prices: a stored minute came back twice")
                seen.add(minute)
                out[(instrument, minute)] = price
    return out


def write_flow_prices(
    supabase: Any, api_key_id: str, prices: Mapping[tuple[str, int], float]
) -> dict[tuple[str, int], float]:
    """Insert ``prices`` write-once, then return the prices the database holds for those keys.

    ``ON CONFLICT DO NOTHING``: the first writer of ``(api_key_id, instrument, minute_ms)`` wins and
    a later one changes nothing, so a key that was already stored comes back with its STORED price
    and not the one passed in (Pitfall 1). Inserts go in chunks of at most
    :data:`FLOW_PRICES_CHUNK` rows. A key that is missing after the insert cannot happen (the
    insert either wrote it or lost to a row that exists) and raises. Empty ``prices`` makes no
    request. A database error raises :class:`FlowPriceStoreError`."""
    if not prices:
        return {}
    rows = [
        {
            "api_key_id": api_key_id,
            "instrument": instrument,
            "minute_ms": minute_ms,
            "price": price,
            "source": FLOW_PRICE_SOURCE,
        }
        for (instrument, minute_ms), price in sorted(prices.items())
    ]
    for start in range(0, len(rows), FLOW_PRICES_CHUNK):
        try:
            supabase.table(FLOW_PRICES_TABLE).upsert(
                rows[start : start + FLOW_PRICES_CHUNK],
                on_conflict="api_key_id,instrument,minute_ms",
                ignore_duplicates=True,
            ).execute()
        except Exception as exc:
            raise FlowPriceStoreError("api_key_flow_prices: insert failed") from exc
    stored = read_flow_prices(supabase, api_key_id, prices.keys())
    if len(stored) != len(prices):
        raise FlowPriceStoreError(
            "api_key_flow_prices: no row for a key after an insert that can only lose to an "
            "existing row"
        )
    return stored


__all__ = [
    "FLOW_PRICES_CHUNK",
    "FLOW_PRICES_TABLE",
    "FLOW_PRICE_SOURCE",
    "FlowPriceStoreError",
    "read_flow_prices",
    "write_flow_prices",
]
