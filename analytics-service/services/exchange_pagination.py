"""B18 - unified exchange pagination driver.

ONE ``walk_paginated()`` driver + a declarative ``ProviderPaginationContract``
so that "the loop succeeds but silently under-fetches" becomes a review-visible
omission instead of a class of latent PnL/volume-corruption bugs (the source of
NEW-C13-02 only-SWAP, NEW-C30-01 7-day-window, and the G12 cursor findings).

The driver owns ONLY the loop *skeleton*: inst-type fan-out, window walking
(with the ``+1ms`` boundary baked in), the page loop, the natural-stop vs.
ceiling decision, and inst-type coverage tracking. Everything provider-specific
- param building (startTime/endTime/cursor/after/begin), response-shape
validation, row normalisation, cursor extraction, and error->skip policy - lives
in the ``fetch_page`` callback each caller supplies. The driver never inspects a
row's internals and never builds an HTTP param.

Why the stop discipline is a *declared* contract field, not one predicate
(red-team wlsuoht5y): the venues are bimodal. OKX/Binance walks are
SHORT-PAGE-authoritative (a page shorter than the page size means "done");
every Bybit walk is CURSOR-authoritative (it stops only on empty items, an
empty cursor, or a repeated cursor - a short page with a live cursor still has
more rows). A single ``len(rows) < page_size`` stop would silently truncate
every Bybit cursor walk after its first non-full page. So ``stop_on_short_page``
and ``stuck_cursor_is_stop`` are per-contract switches, and ``is_full_page`` is
advisory (honoured only when ``stop_on_short_page`` is set).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field
from typing import Generic, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Milliseconds in a day - window arithmetic is done in ms to match the
# exchange APIs' startTime/endTime contract.
_MS_PER_DAY = 24 * 60 * 60 * 1000


class PaginationCeilingExceeded(RuntimeError):
    """A paginated walk exhausted ``page_cap`` with more rows still remaining.

    Funding fetchers raise the more specific ``FundingFetchCeilingExceeded``
    (a subclass) so the worker classifier's existing ``except`` clauses keep
    working; raw-trade/daily-PnL fetchers flag instead of raising (see
    ``ProviderPaginationContract.on_ceiling``).
    """


@dataclass(frozen=True)
class ProviderPaginationContract:
    """The declared shape of one fetcher's pagination.

    A new fetcher cannot be added to the driver without filling this in, which
    is exactly what makes a silently-skipped inst-type or a missing window walk
    a review-visible omission.
    """

    fetcher: str
    """Human label used in logs / ceiling errors / coverage warnings."""

    page_cap: int
    """Max pages per (inst_type x window) before the ceiling fires."""

    on_ceiling: str
    """``"raise"`` (funding - fail the job) or ``"flag"`` (raw-trades/PnL - DQ flag)."""

    stop_on_short_page: bool
    """True for OKX/Binance (a short page means done); False for cursor-authoritative Bybit."""

    stuck_cursor_is_stop: bool
    """True where a repeated cursor is a natural stop (OKX/Bybit raw-trades, Bybit PnL);
    False for funding (a stuck cursor exhausts to the ceiling rather than stopping)."""

    inst_types: tuple[str, ...] = ()
    """Fan-out keys. ``()`` = a single pass with ``inst_type=None``."""

    gated_inst_types: frozenset[str] = frozenset()
    """Allowlist of inst_types that may actually be fetched. An inst_type that is
    in ``inst_types`` but NOT here is DELIBERATELY GATED (e.g. bybit-inverse
    raw-trades, whose contractSize rescale is unbuilt): the driver skips it
    without fetching and WITHOUT counting it as a missing-coverage omission.
    An empty set means "no gate - all of ``inst_types`` are allowed"."""

    window_max_days: int | None = None
    """``None`` = a single window (forward time-advance or cursor-only). A value
    walks ``[start, now]`` in that many-day windows, passing both bounds."""

    default_lookback_days: int | None = None
    """When ``since_ms`` is None, start this many days before ``now_ms``. ``None``
    leaves the start as None (provider decides / no lower bound)."""

    ceiling_exc: type[Exception] = PaginationCeilingExceeded
    """Exception raised when ``on_ceiling == "raise"``. Funding passes
    ``FundingFetchCeilingExceeded`` so existing handlers stay green."""

    ceiling_label: str = "page_cap"
    """Wording for the page-cap count in the ceiling error message; funding
    uses "MAX_PAGES" so its operator-facing message is unchanged."""


@dataclass
class PageRequest:
    """What the driver hands the provider for one page fetch."""

    inst_type: str | None
    window_start: int | None
    window_end: int | None
    cursor: str


@dataclass
class PageResult(Generic[T]):
    """What the provider hands back after one page fetch.

    ``rows`` are already normalised - the driver only accumulates them. The
    other fields are the *control* signals the driver's stop logic reads; the
    driver never looks inside ``rows``.
    """

    rows: list[T]
    next_cursor: str = ""
    is_full_page: bool = False
    is_empty: bool = False
    """True when the raw page had zero items - a natural stop. Distinct from
    ``not rows`` because a page whose items all failed normalisation is NOT
    empty (it still advances the cursor)."""
    skip_inst_type: bool = False
    """Set by the provider to gracefully abandon this inst_type entirely (e.g.
    bybit-inverse funding on a permission error). The driver drops it from
    coverage and skips its remaining windows - it does NOT trip the ceiling."""


@dataclass
class WalkResult(Generic[T]):
    """The driver's return contract."""

    rows: list[T]
    truncated_inst_types: set[str | None] = field(default_factory=set)
    """inst_types whose walk hit the ceiling under ``on_ceiling == "flag"``."""
    inst_types_covered: set[str | None] = field(default_factory=set)
    inst_types_missing: set[str | None] = field(default_factory=set)
    """Declared-and-allowed inst_types that were NOT fully covered - a
    runtime-skipped one (permission), surfaced for review. A *gated* inst_type
    is never here (it was subtracted from the expected set up front)."""

    @property
    def truncated(self) -> bool:
        return bool(self.truncated_inst_types)


def _windows(
    start: int | None, now_ms: int, window_max_days: int | None
) -> Iterator[tuple[int | None, int | None]]:
    """Yield ``(window_start, window_end)`` pairs.

    ``window_max_days is None`` -> a single ``(start, None)`` window (the provider
    sends no endTime). Otherwise walk ``[start, now_ms]`` in fixed windows with
    ``next_start = prev_end + 1`` - the exact NEW-C30-01 boundary (advance past
    the previous window end by 1ms so adjacent windows neither overlap nor leave
    a 1ms gap). ``start`` is treated as 0 when None for the walked case (a window
    walk requires a lower bound; callers that walk always pass one).
    """
    if window_max_days is None:
        yield (start, None)
        return
    window_ms = window_max_days * _MS_PER_DAY
    w_start = start if start is not None else 0
    while w_start < now_ms:
        w_end = min(w_start + window_ms, now_ms)
        yield (w_start, w_end)
        w_start = w_end + 1


async def walk_paginated(
    contract: ProviderPaginationContract,
    *,
    since_ms: int | None,
    now_ms: int,
    fetch_page: Callable[[PageRequest], Awaitable[PageResult[T]]],
) -> WalkResult[T]:
    """Drive a paginated fetch per ``contract``, delegating each page to ``fetch_page``.

    The loop is the single source of "did we reach the end" truth: a NATURAL
    STOP is any ``break`` (empty page; empty cursor; short page when
    ``stop_on_short_page``; repeated cursor when ``stuck_cursor_is_stop``). The
    ``for...else`` runs only when no natural stop fired - i.e. ``page_cap`` was
    exhausted on a still-live page - which is the one true "more remains"
    condition that raises or flags.
    """
    rows: list[T] = []
    covered: set[str | None] = set()
    truncated: set[str | None] = set()

    start: int | None
    if since_ms is not None:
        start = since_ms
    elif contract.default_lookback_days is not None:
        start = now_ms - contract.default_lookback_days * _MS_PER_DAY
    else:
        start = None

    inst_types: tuple[str | None, ...] = contract.inst_types or (None,)
    for inst_type in inst_types:
        if (
            contract.gated_inst_types
            and inst_type is not None
            and inst_type not in contract.gated_inst_types
        ):
            # DELIBERATELY GATED - never fetched, never an omission.
            continue
        covered.add(inst_type)
        abandon_inst_type = False
        for (w_start, w_end) in _windows(start, now_ms, contract.window_max_days):
            if abandon_inst_type:
                break
            cursor = ""
            for _page in range(contract.page_cap):
                res = await fetch_page(PageRequest(inst_type, w_start, w_end, cursor))
                if res.skip_inst_type:
                    covered.discard(inst_type)
                    abandon_inst_type = True
                    break
                rows.extend(res.rows)
                if res.is_empty:
                    break
                prev_cursor = cursor
                cursor = res.next_cursor
                if not cursor:
                    break
                if contract.stop_on_short_page and not res.is_full_page:
                    break
                if contract.stuck_cursor_is_stop and cursor == prev_cursor:
                    break
            else:
                # page_cap exhausted on a still-live page - the one true
                # "more remains". Raise (funding) or flag (raw-trades/PnL).
                if contract.on_ceiling == "raise":
                    raise contract.ceiling_exc(
                        f"{contract.fetcher} exhausted "
                        f"{contract.ceiling_label}="
                        f"{contract.page_cap} on inst_type={inst_type} "
                        f"window=[{w_start},{w_end}] with more rows remaining"
                    )
                truncated.add(inst_type)
                logger.warning(
                    "%s hit page_cap=%d ceiling on inst_type=%s window=[%s,%s] "
                    "- results truncated",
                    contract.fetcher, contract.page_cap, inst_type, w_start, w_end,
                )

    # Coverage: a gated inst_type is subtracted from the expected set up front,
    # so a gated type can NEVER appear as missing. A runtime-skipped one does.
    declared: set[str | None] = {it for it in inst_types if it is not None}
    gated: set[str | None] = (
        declared - set(contract.gated_inst_types)
        if contract.gated_inst_types
        else set()
    )
    expected = declared - gated
    missing = expected - covered

    return WalkResult(
        rows=rows,
        truncated_inst_types=truncated,
        inst_types_covered=covered,
        inst_types_missing=missing,
    )
