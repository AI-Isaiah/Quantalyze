"""The at-instant price of a Deribit flow a mark moves into its mark day (Phase 177 DERIBITFLOWS).

What this is for
----------------
A mark is read on the UTC day after its label. A Deribit deposit made on that read day before the
read is already in the mark's wallet, so ``apply_marks`` (rule 10) counts it in the mark day. It
used to count a BTC deposit at the own-day ledger mark of the READ day, a price that can sit a
whole day's move away from the price the wallet held it at. The decisions this module implements
are the founder's, recorded in ``177-CONTEXT.md``:

* D-02 (revisited, "Fetch index at flow time"): the price comes from a venue read at the flow's
  moment, made on the derive's own exchange client. ``FlowInstant.amount`` stays the own-day ledger
  mark (what leaves the read day, ``flow_moves_out``) and ``amount_prior_day`` carries the price
  read here (what is counted in the mark day).
* D-04: that price is the ``open`` of the ``{CCY}_USDC-PERPETUAL`` 1-minute candle that contains
  the flow. It is the perpetual's traded price, not Deribit's index.
* D-05: no fallback. A flow with no price is a refusal or a retry, never the own-day amount.

Why the read runs against PREDICTED marks, before the exchange closes
---------------------------------------------------------------------
Which flows a mark moves depends on the mark's ``read_at``, and the derive closes its exchange
client before the apply seam. This derive's own mark is written after that close, so at read time
the marks that will be applied are not all stored yet. The prefetch therefore runs against the
key's stored marks plus the mark this derive is about to write (``MarkReadAt``), through the one
predicate ``nav_marks_apply.placed_flow_instants``. A prediction can still miss (a concurrent
writer, a day already stored by someone else). That is why the apply seam runs
``unpriced_moved_flows`` on the FINAL marks: a moved INDEXED flow without a price fails the derive
loudly instead of silently taking the own-day amount.

Why the price is stored (D-05, plan 03)
---------------------------------------
Every derive re-applies ALL of a key's marks from the first one, so without a store each night would
re-read every historical moved flow, and its price would only be as stable as Deribit's 1-minute
history. :func:`resolve_moved_flow_prices` reads the key's stored prices first
(``services.flow_price_store``), asks the venue only for the MISSING minutes, writes what it read
once and builds the index from the re-selected STORED rows, so the stored price, not the local read,
is what a flow is valued at. A price read correctly is a permanent fact: it is written before the
apply, and stays even if the derive later refuses for an unrelated reason.

I/O: the exchange read in :func:`resolve_moved_flow_prices` and the store's reads and writes; no
logging of amounts, keys or instants.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, NamedTuple

from services.db import db_execute
from services.deribit_ingest import (
    DeribitChartNoDataError,
    SleepFn,
    fetch_deribit_perp_minute_prices,
    perp_minute_instrument,
    price_for_minute,
)
from services.external_flows import FlowInstant
from services.flow_price_store import read_flow_prices, write_flow_prices
from services.nav_marks_apply import placed_flow_instants
from services.native_nav import MarkBranch, classify_currency

_MINUTE_MS = 60_000

# (ISO mark day, the instant its equity was read). ``read_at`` may be None for a mark that moves
# nothing, exactly as ``AppliedMark.read_at``.
MarkReadAt = tuple[str, datetime | None]
_FlowKey = tuple[str, int]


@dataclass(frozen=True)
class MovedFlowPrices:
    """The prices read for a derive's moved INDEXED flows. ``index`` maps ``(CCY, at_ms)`` to the
    candle open; ``no_data`` holds the keys whose read answered with no usable price (a structural
    answer, never a transient one, which raises instead).

    A dataclass and not a ``NamedTuple``: a ``NamedTuple`` field called ``index`` would shadow
    ``tuple.index``, which mypy rejects."""

    index: dict[_FlowKey, float]
    no_data: frozenset[_FlowKey]


class UnpricedMoves(NamedTuple):
    """How many moved INDEXED instants lack a price: ``no_data`` had a structural answer, ``missing``
    were never read at all (a prediction miss)."""

    no_data: int
    missing: int


def wanted_moved_flows(
    flow_instants: Sequence[FlowInstant],
    marks: Sequence[MarkReadAt],
    indexable_currencies: frozenset[str],
) -> list[FlowInstant]:
    """The RAW instants some mark in ``marks`` moves into its mark day (the one predicate,
    ``placed_flow_instants``) whose currency classifies INDEXED, de-duplicated by
    ``(CCY, at_ms)``, in stable order. A USD-family flow needs no price and is never listed."""
    seen: set[_FlowKey] = set()
    out: list[FlowInstant] = []
    for day, read_at in marks:
        for fi in placed_flow_instants(flow_instants, date.fromisoformat(day), read_at):
            if classify_currency(fi.currency, indexable=indexable_currencies) is not MarkBranch.INDEXED:
                continue
            key = (fi.currency.upper(), fi.at_ms)
            if key in seen:
                continue
            seen.add(key)
            out.append(fi)
    return out


def _day_start_ms(day: str) -> int:
    return int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() * 1000)


async def resolve_moved_flow_prices(
    exchange: Any,
    supabase: Any,
    api_key_id: str,
    flow_instants: Sequence[FlowInstant],
    marks: Sequence[MarkReadAt],
    indexable_currencies: frozenset[str],
    *,
    sleep: SleepFn = asyncio.sleep,
    read_venue: bool = True,
) -> MovedFlowPrices:
    """The at-instant price of every wanted moved flow: stored if the key has it, else read on
    ``exchange`` and stored (D-02, D-04, D-05).

    Order (RESEARCH Pattern 3): (1) the wanted moved INDEXED instants (the one predicate); with none,
    return at once, with no store call and no chart request; (2) read the key's stored prices for
    their ``(instrument, minute_ms)`` keys; (3) group only the instants whose key is NOT stored by
    ``(currency, read day)`` and read each group once, over ``[00:00Z of the read day, the group's
    latest instant + 60 s]``; (4) write each group's newly read prices as soon as that group is read
    and re-select, so the STORED row is what the index uses; (5) build the index from stored rows.

    A structural no-data answer (:class:`DeribitChartNoDataError`) puts every instant of its group
    into ``no_data``; an instant whose containing minute has no candle goes there too. A transient
    failure (``DeribitTransientReadError``) or a rate limit (``ccxt.RateLimitExceeded``) propagates
    after the groups already read were stored (a price read correctly is a permanent fact).
    ``FlowPriceStoreError`` propagates unchanged (a store fault is loud, never a price used without
    the store).

    ``read_venue=False`` is the budget floor (WR-02): the store is still read, so every price already
    stored is returned, and the chart is not asked for the minutes still missing. Those stay out of
    ``index`` and out of ``no_data``, which the coverage check counts as ``missing`` (a retry)."""
    wanted = wanted_moved_flows(flow_instants, marks, indexable_currencies)
    index: dict[_FlowKey, float] = {}
    no_data: set[_FlowKey] = set()
    if not wanted:
        return MovedFlowPrices(index, frozenset(no_data))

    def _store_key(fi: FlowInstant) -> _FlowKey:
        return (perp_minute_instrument(fi.currency), fi.at_ms - fi.at_ms % _MINUTE_MS)

    stored: dict[_FlowKey, float] = await db_execute(
        lambda: read_flow_prices(supabase, api_key_id, {_store_key(fi) for fi in wanted})
    )
    groups: dict[tuple[str, str], list[FlowInstant]] = defaultdict(list)
    for fi in wanted:
        if _store_key(fi) not in stored:
            groups[(fi.currency.upper(), fi.day)].append(fi)
    for (currency, day), members in groups.items() if read_venue else ():
        try:
            opens = await fetch_deribit_perp_minute_prices(
                exchange,
                currency,
                start_ms=_day_start_ms(day),
                end_ms=max(fi.at_ms for fi in members) + _MINUTE_MS,
                sleep=sleep,
            )
        except DeribitChartNoDataError:
            no_data.update((currency, fi.at_ms) for fi in members)
            continue
        fetched: dict[_FlowKey, float] = {}
        for fi in members:
            price = price_for_minute(opens, fi.at_ms)
            if price is None:
                no_data.add((currency, fi.at_ms))
            else:
                fetched[_store_key(fi)] = price
        # SF-03: each group is stored as soon as it is read, so a later group's failure or the
        # budget's timeout does not discard the groups already read.
        if fetched:
            stored.update(
                await db_execute(lambda: write_flow_prices(supabase, api_key_id, fetched))
            )
    for fi in wanted:
        price = stored.get(_store_key(fi))
        if price is not None:
            index[(fi.currency.upper(), fi.at_ms)] = price
    return MovedFlowPrices(index, frozenset(no_data))


def unpriced_moved_flows(
    flow_instants: Sequence[FlowInstant],
    marks: Sequence[MarkReadAt],
    indexable_currencies: frozenset[str],
    prices: MovedFlowPrices,
) -> UnpricedMoves:
    """The coverage check, run on the FINAL marks: how many moved INDEXED instants have no price
    in ``prices``. ``no_data`` counts those the read answered structurally, ``missing`` those it
    never read (the prediction did not include the mark that moves them)."""
    no_data = 0
    missing = 0
    for fi in wanted_moved_flows(flow_instants, marks, indexable_currencies):
        key = (fi.currency.upper(), fi.at_ms)
        if key in prices.index:
            continue
        if key in prices.no_data:
            no_data += 1
        else:
            missing += 1
    return UnpricedMoves(no_data, missing)


class MovedFlowCounts(NamedTuple):
    """D-01's counts, nothing else: ``moved`` instants some mark moves into its mark day, of which
    ``at_instant`` carry an at-instant price and ``usd_family`` need none, and ``on_last_mark``
    of the ``moved`` sit under the last mark."""

    moved: int
    at_instant: int
    usd_family: int
    on_last_mark: int


def moved_flow_counts(
    valued_instants: Sequence[FlowInstant], marks: Sequence[MarkReadAt]
) -> MovedFlowCounts:
    """How many flows the marks move, counted over the VALUED instants handed to ``apply_marks``
    through the one rule-10 predicate (``placed_flow_instants``).

    After valuation every Deribit currency reads ``"USD"`` (Pitfall 6), so the currency cannot tell
    the two kinds apart; ``amount_prior_day`` is the one marker left: set for a flow priced at its
    instant, ``None`` for a USD-family flow. An instant is dated the read day of exactly one mark,
    so no instant is counted twice."""
    at_instant = 0
    usd_family = 0
    on_last_mark = 0
    for k, (day, read_at) in enumerate(marks):
        placed = placed_flow_instants(valued_instants, date.fromisoformat(day), read_at)
        priced = sum(1 for fi in placed if fi.amount_prior_day is not None)
        at_instant += priced
        usd_family += len(placed) - priced
        if k == len(marks) - 1:
            on_last_mark = len(placed)
    return MovedFlowCounts(at_instant + usd_family, at_instant, usd_family, on_last_mark)


__all__ = [
    "MarkReadAt",
    "MovedFlowCounts",
    "MovedFlowPrices",
    "UnpricedMoves",
    "moved_flow_counts",
    "resolve_moved_flow_prices",
    "unpriced_moved_flows",
    "wanted_moved_flows",
]
