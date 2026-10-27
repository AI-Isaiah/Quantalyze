"""Phase 171 READCEILING, D-02: the store a resumable Bybit trade read keeps its progress in.

A Bybit account can hold more executions in the replay window than one worker claim can read.
The read therefore works one complete 7-day window at a time and keeps each finished window
here, so a later claim of the same job (or of a later job for the same key) starts where the
last one stopped instead of at the beginning.

What is stored, and why it is raw compact trades and not fold state
-------------------------------------------------------------------
Each complete window is kept as the trades the replay reads, projected to seven positional
fields, in the exact order the read produced them. The replay (``_compute_daily_equity``) then
sees one shape whatever its origin and its output is bit-identical to a single pass. Fold state
was rejected: it would split the 430-line replay into a fold and a mark, and it would reorder
float additions, so cents could move in a data-integrity path.

The positional order is ``PROJECTION_FIELDS``. It is part of ``TRADE_READ_VERSION``: changing
the order, or what the Bybit read covers (Phase 173 will), must bump the version so a window
read under the old rules is never reused. ``fee`` is reduced exactly as the replay reduces it
(a dict becomes ``cost or 0.0``); every other value is kept as it is, ``None`` included.

A window is the unit of atomicity. It is stored whole (every chunk, one ``chunk_count``) or it
is absent, and a window that is not whole, not current or malformed is treated as absent and
re-read, never partially used. A window is a pure function of (key, window start, read
version), so two workers writing the same window write the same bytes.

Tables, access and expiry
-------------------------
``allocator_trade_reads`` holds one state row per api key (grid origin, read version, claim
counters, last job id). ``allocator_trade_read_windows`` holds the windows as numbered chunks
of at most ``STORE_CHUNK_TRADES`` trades. Both are service-role only (the migration revokes
everything else) and every row carries ``expires_at`` seven days out, so nothing lives longer
than that. Physical removal does not need a scheduled job here: ``begin_claim`` calls
``purge_expired`` and a watchdog sweep calls it too.

Claim bookkeeping, and why the stall count is pessimistic
---------------------------------------------------------
Every ``begin_claim`` counts the claim as stalled BEFORE any reading starts; ``record_progress``
resets the count after a window has been stored. A claim cut by the hard crawl bound, reclaimed
by the watchdog or killed with the worker therefore counts as stalled without any code running at
its end. A job that reaches ``STALLED_CLAIMS_LIMIT`` stalled claims is stopped by name
(``TradeReadStalled``) and the job-age backstop (``job_too_old``) is the second bound. A NEW job
for the same key starts at zero stalled claims and keeps the stored windows, so the stop is a
reason a later run can clear.

Store faults are a disposition, not a crash
-------------------------------------------
An exception raised by the client inside any public call (a table that does not exist yet, a
gateway error) is caught, logged once at WARNING with its class name and the key id only, and
answered: ``begin_claim`` returns None (the claim reads without the store), ``load_window``
returns None (the window is re-read), ``save_window`` returns False (the window stays unstored),
``record_progress`` and the purges return normally. ``asyncio.CancelledError`` is never caught.
``TradeReadStalled`` from ``begin_claim`` is a decision, not a fault, and always propagates.
Consequence: a store that answers ``begin_claim`` but refuses every write makes no progress, so
the job ends at the named stall after ``STALLED_CLAIMS_LIMIT`` claims, never in an endless defer
loop.

Module hygiene
--------------
This module imports neither ``services.job_worker`` nor ``services.equity_reconstruction``: the
scope type lives here so the read can consult it without a cycle. Log lines carry counts, class
names and the key id only (never a symbol, an amount, venue text or ``logger.exception``).
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Final, TypeGuard

from services.db import db_execute, rows

logger = logging.getLogger("quantalyze.analytics.trade_read_store")

#: Bumped by any change to the projection's column order or to what the Bybit read covers.
TRADE_READ_VERSION: Final[int] = 1
#: Every stored row expires this long after it was written (seconds).
STORE_EXPIRY_S: Final[int] = 7 * 24 * 3600
#: Most trades in one chunk row. Equal to the migration's ``n_trades`` CHECK, and what keeps one
#: request body small whatever the window holds.
STORE_CHUNK_TRADES: Final[int] = 5000
#: Stalled claims of one job after which the next claim is refused by name.
STALLED_CLAIMS_LIMIT: Final[int] = 3
#: A job older than this (from its own ``created_at``) may no longer wait for a resume.
JOB_BACKSTOP_S: Final[int] = 24 * 3600

STATE_TABLE: Final[str] = "allocator_trade_reads"
WINDOW_TABLE: Final[str] = "allocator_trade_read_windows"
STATE_COLUMNS: Final[tuple[str, ...]] = (
    "api_key_id", "venue", "grid_origin_ms", "read_version", "claims", "stalled_claims",
    "last_job_id", "updated_at", "expires_at",
)
WINDOW_COLUMNS: Final[tuple[str, ...]] = (
    "api_key_id", "window_start_ms", "chunk_index", "chunk_count", "window_end_ms",
    "read_version", "n_trades", "trades", "created_at", "expires_at",
)
#: The positional order of a stored trade (part of ``TRADE_READ_VERSION``).
PROJECTION_FIELDS: Final[tuple[str, ...]] = (
    "timestamp", "symbol", "side", "amount", "price", "cost", "fee",
)

#: Window metadata is read in pages of this many rows, advancing by what a page returned.
_META_PAGE_ROWS: Final[int] = 500
#: A bound on the metadata paging, so a misbehaving gateway cannot loop it forever.
_META_MAX_PAGES: Final[int] = 400
_META_COLUMNS: Final[str] = (
    "window_start_ms,chunk_index,chunk_count,window_end_ms,read_version,n_trades,expires_at"
)
_CHUNK_COLUMNS: Final[str] = (
    "chunk_index,chunk_count,window_end_ms,read_version,n_trades,expires_at,trades"
)


def _wall_ms() -> int:
    """Wall clock in epoch milliseconds (a seam: tests drive it)."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _iso(ms: int) -> str:
    """A fixed-width UTC timestamp, so string comparison orders like time."""
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat(timespec="microseconds")


def _parse_ms(value: Any) -> int | None:
    """A stored timestamp as epoch ms, None when it cannot be read."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------


def project_trade(trade: dict[str, Any]) -> list[Any]:
    """The seven positional fields of one ccxt trade, in ``PROJECTION_FIELDS`` order.

    ``fee`` is reduced exactly as the replay reduces a dict fee (``cost or 0.0``); a fee that is
    already a number or ``None`` is kept as it is.
    """
    fee = trade.get("fee")
    if isinstance(fee, dict):
        fee = fee.get("cost") or 0.0
    return [
        trade.get("timestamp"), trade.get("symbol"), trade.get("side"),
        trade.get("amount"), trade.get("price"), trade.get("cost"), fee,
    ]


def _row_shape_ok(row: Any) -> bool:
    return (
        isinstance(row, list)
        and len(row) == len(PROJECTION_FIELDS)
        and _is_int(row[0])
        and (row[1] is None or isinstance(row[1], str))
        and (row[2] is None or isinstance(row[2], str))
    )


def unproject_trade(row: Any) -> dict[str, Any]:
    """The trade dict (the seven ``PROJECTION_FIELDS`` keys only) a stored row stands for.

    Raises ``ValueError`` on a row that is not a 7-element list with an int timestamp and a
    str-or-None symbol and side. The message is static: a malformed row is never quoted.
    """
    if not _row_shape_ok(row):
        raise ValueError("trade read store: malformed stored trade")
    return dict(zip(PROJECTION_FIELDS, row, strict=True))


def _storable(row: list[Any]) -> bool:
    """A projection can be written when it is well shaped and holds no NaN or infinity (the
    wire would carry a token the database cannot parse, or a value that is not a number)."""
    if not _row_shape_ok(row):
        return False
    return all(not isinstance(v, float) or math.isfinite(v) for v in row[3:])


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WindowMeta:
    """A whole, current stored window as ``begin_claim`` found it (no trades loaded)."""

    window_start_ms: int
    window_end_ms: int
    chunk_count: int
    n_trades: int


@dataclass
class ReadState:
    """One key's read position after a claim started."""

    grid_origin_ms: int
    stored: dict[int, WindowMeta]
    claims: int
    stalled_claims: int


class TradeReadDeferred(Exception):
    """This claim ran out of budget before the read was whole; its progress is stored.

    Not a ccxt class, so ``classify_exception`` never calls it permanent. Counts only: the
    message holds three integers and nothing the venue said.
    """

    def __init__(self, windows_done: int, windows_total: int, trades_stored: int) -> None:
        self.windows_done = windows_done
        self.windows_total = windows_total
        self.trades_stored = trades_stored
        super().__init__(
            f"trade read deferred: windows={windows_done}/{windows_total} "
            f"trades_stored={trades_stored}"
        )


class TradeReadStalled(Exception):
    """A read that makes no progress is stopped by name.

    ``cause`` is ``"stalled_claims"`` (``STALLED_CLAIMS_LIMIT`` claims of one job without a
    window stored) or ``"job_age"`` (the job is past ``JOB_BACKSTOP_S``). The stored state is
    kept, so a later run can clear it. Counts only.
    """

    def __init__(self, cause: str, claims: int) -> None:
        self.cause = cause
        self.claims = claims
        super().__init__(f"trade read stalled: cause={cause} claims={claims}")


@dataclass(frozen=True)
class TradeReadScope:
    """What the read needs to consult the store, carried by a ContextVar (see ``trade_read_scope``)
    so the pinned crawl call gains no keyword."""

    supabase: Any
    api_key_id: str | None
    deadline: float
    job_id: str | None
    job_created_at: Any


def _created_ms(created_at: Any) -> int | None:
    if isinstance(created_at, datetime):
        moment = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        return int(moment.timestamp() * 1000)
    return _parse_ms(created_at)


def job_too_old(scope: TradeReadScope) -> bool:
    """True when the job is ``JOB_BACKSTOP_S`` or more past its own ``created_at``. A
    ``created_at`` that cannot be read counts as too old: a bound that cannot be evaluated must
    not become no bound at all (the OKX archive job's F7 precedent)."""
    created = _created_ms(scope.job_created_at)
    if created is None:
        return True
    return max(0.0, (_wall_ms() - created) / 1000.0) >= JOB_BACKSTOP_S


# ---------------------------------------------------------------------------
# Store calls
# ---------------------------------------------------------------------------


def _log_fault(exc: Exception, api_key_id: str, tail: str) -> None:
    """One counts-only WARNING for a store fault: the class name and the key id, never the
    exception text (a PostgREST error can quote the offending row)."""
    logger.warning(
        "trade read store unavailable (%s) key=%s: %s", type(exc).__name__, api_key_id, tail
    )


async def _upsert(supabase: Any, table: str, payload: dict[str, Any], on_conflict: str) -> None:
    def _write() -> Any:
        return supabase.table(table).upsert(payload, on_conflict=on_conflict).execute()

    await db_execute(_write)


def _chunks_of(projected: list[list[Any]]) -> list[list[list[Any]]]:
    """Chunks of at most ``STORE_CHUNK_TRADES``; an empty window is one empty chunk, because
    "this window held nothing" is a result worth keeping."""
    return [
        projected[i:i + STORE_CHUNK_TRADES]
        for i in range(0, len(projected), STORE_CHUNK_TRADES)
    ] or [[]]


def _meta_of(window_start_ms: int, chunk_rows: list[dict[str, Any]], now_ms: int) -> WindowMeta | None:
    """The window these chunk rows make up, or None unless it is whole and current: every chunk
    0..N-1 present with one ``chunk_count`` and one ``window_end_ms``, the current read version,
    a future ``expires_at`` and sane counts."""
    if not chunk_rows:
        return None
    ordered = sorted(
        chunk_rows,
        key=lambda r: r["chunk_index"] if _is_int(r.get("chunk_index")) else -1,
    )
    first = ordered[0]
    chunk_count = first.get("chunk_count")
    window_end = first.get("window_end_ms")
    if not (_is_int(chunk_count) and _is_int(window_end)):
        return None
    if chunk_count < 1 or window_end <= window_start_ms or len(ordered) != chunk_count:
        return None
    total = 0
    for expected_index, r in enumerate(ordered):
        n_trades = r.get("n_trades")
        if not _is_int(n_trades):
            return None
        expires_ms = _parse_ms(r.get("expires_at"))
        if (
            r.get("chunk_index") != expected_index
            or r.get("chunk_count") != chunk_count
            or r.get("window_end_ms") != window_end
            or r.get("read_version") != TRADE_READ_VERSION
            or not 0 <= n_trades <= STORE_CHUNK_TRADES
            or expires_ms is None
            or expires_ms <= now_ms
        ):
            return None
        total += n_trades
    return WindowMeta(window_start_ms, window_end, chunk_count, total)


async def _load_window_meta(supabase: Any, api_key_id: str, now_ms: int) -> dict[int, WindowMeta]:
    """Every whole, current window of the key, from metadata alone (the trades column is never
    read here). Paged with ``.range()`` and advanced by what each page returned: a PostgREST row
    cap below the page size makes every page short, so a short page is not the end of the data;
    an empty one is."""
    collected: list[dict[str, Any]] = []
    offset = 0
    for _ in range(_META_MAX_PAGES):
        start = offset

        def _page(start: int = start) -> Any:
            return (
                supabase.table(WINDOW_TABLE)
                .select(_META_COLUMNS)
                .eq("api_key_id", api_key_id)
                .order("window_start_ms")
                .order("chunk_index")
                .range(start, start + _META_PAGE_ROWS - 1)
                .execute()
            )

        page = rows(await db_execute(_page))
        if not page:
            break
        collected.extend(page)
        offset += len(page)
    else:
        raise RuntimeError("trade read store: window metadata exceeded its page bound")

    by_start: dict[int, list[dict[str, Any]]] = {}
    for r in collected:
        start_ms = r.get("window_start_ms")
        if isinstance(start_ms, int) and not isinstance(start_ms, bool):
            by_start.setdefault(start_ms, []).append(dict(r))
    stored: dict[int, WindowMeta] = {}
    for start_ms, chunk_rows in by_start.items():
        meta = _meta_of(start_ms, chunk_rows, now_ms)
        if meta is not None:
            stored[start_ms] = meta
    return stored


async def _delete_keys(supabase: Any, api_key_ids: list[str]) -> None:
    """Both tables' rows of these keys (windows first: they are the bulk)."""
    for table in (WINDOW_TABLE, STATE_TABLE):
        def _delete(table: str = table) -> Any:
            return supabase.table(table).delete().in_("api_key_id", api_key_ids).execute()

        await db_execute(_delete)


def _state_usable(row: dict[str, Any], since_ms: int, now_ms: int) -> bool:
    """A state row is kept only when it is current: this read version, unexpired, well formed,
    and its grid origin is not later than the caller's start (a wider window than the one
    stored cannot reuse windows tiled from a later origin)."""
    origin = row.get("grid_origin_ms")
    claims = row.get("claims")
    stalled = row.get("stalled_claims")
    expires_ms = _parse_ms(row.get("expires_at"))
    return (
        _is_int(origin)
        and _is_int(claims) and claims >= 0
        and _is_int(stalled) and stalled >= 0
        and row.get("read_version") == TRADE_READ_VERSION
        and expires_ms is not None and expires_ms > now_ms
        and since_ms >= origin
    )


async def _begin_claim(
    supabase: Any, api_key_id: str, venue: str, since_ms: int, job_id: str | None
) -> ReadState:
    now_ms = _wall_ms()

    def _read_state() -> Any:
        return (
            supabase.table(STATE_TABLE)
            .select(",".join(STATE_COLUMNS))
            .eq("api_key_id", api_key_id)
            .execute()
        )

    found = rows(await db_execute(_read_state))
    row = dict(found[0]) if found else None
    if row is not None and not _state_usable(row, since_ms, now_ms):
        await _delete_keys(supabase, [api_key_id])
        row = None

    if row is None:
        origin, claims, stalled = since_ms, 1, 1
    else:
        origin = int(row["grid_origin_ms"])
        # Another job starts at zero stalled claims and keeps the stored windows: the stop is
        # a reason a later run can clear.
        prior_stalled = int(row["stalled_claims"]) if row.get("last_job_id") == job_id else 0
        if prior_stalled >= STALLED_CLAIMS_LIMIT:
            raise TradeReadStalled("stalled_claims", int(row["claims"]))
        claims = int(row["claims"]) + 1
        stalled = prior_stalled + 1

    # Pessimistic: this claim counts as stalled until record_progress says otherwise, so a
    # claim that is cut, reclaimed or killed needs no code at its end to be counted.
    await _upsert(
        supabase,
        STATE_TABLE,
        {
            "api_key_id": api_key_id,
            "venue": venue,
            "grid_origin_ms": origin,
            "read_version": TRADE_READ_VERSION,
            "claims": claims,
            "stalled_claims": stalled,
            "last_job_id": job_id,
            "updated_at": _iso(now_ms),
            "expires_at": _iso(now_ms + STORE_EXPIRY_S * 1000),
        },
        "api_key_id",
    )
    await purge_expired(supabase)
    stored = await _load_window_meta(supabase, api_key_id, now_ms)
    return ReadState(origin, stored, claims, stalled)


async def begin_claim(
    supabase: Any, api_key_id: str, *, venue: str, since_ms: int, job_id: str | None
) -> ReadState | None:
    """Start one claim of the read of ``api_key_id`` and say what is already stored.

    In this order: read the key's state row; discard both tables' rows of the key when its read
    version differs, it has expired or ``since_ms`` is earlier than its grid origin; reset the
    stalled count when ``job_id`` is not the job that last claimed; raise ``TradeReadStalled``
    (writing nothing) when this job already has ``STALLED_CLAIMS_LIMIT`` stalled claims; count
    the claim (claims and stalled claims, both +1, expiry refreshed); purge expired rows; load
    the metadata of the whole, current windows. Only the first claim's ``since_ms`` becomes the
    grid origin, so windows stay aligned while ``since_ms`` moves forward a day at a time.

    Returns None on a store fault (this claim reads without the store); see the module docstring.
    """
    try:
        return await _begin_claim(supabase, api_key_id, venue, since_ms, job_id)
    except TradeReadStalled:
        raise
    except Exception as exc:  # noqa: BLE001 - disposition: this claim reads without the store
        _log_fault(exc, api_key_id, "this claim reads without the store")
        return None


async def record_progress(supabase: Any, api_key_id: str) -> None:
    """At least one window was stored in this claim: the job is not stalled."""
    try:
        def _reset() -> Any:
            return (
                supabase.table(STATE_TABLE)
                .update({"stalled_claims": 0, "updated_at": _iso(_wall_ms())})
                .eq("api_key_id", api_key_id)
                .execute()
            )

        await db_execute(_reset)
    except Exception as exc:  # noqa: BLE001 - disposition: normal return
        _log_fault(exc, api_key_id, "the stalled-claims count was not reset")


async def purge_keys(supabase: Any, api_key_ids: list[str]) -> None:
    """Delete these keys' rows in both tables. Best effort: the 7-day expiry is the backstop."""
    if not api_key_ids:
        return
    try:
        await _delete_keys(supabase, list(api_key_ids))
    except Exception as exc:  # noqa: BLE001 - disposition: normal return
        logger.warning(
            "trade read store unavailable (%s) keys=%d: rows left to expire",
            type(exc).__name__, len(api_key_ids),
        )


async def purge_expired(supabase: Any) -> None:
    """Delete every key's expired rows in both tables. Best effort."""
    try:
        now_iso = _iso(_wall_ms())
        for table in (WINDOW_TABLE, STATE_TABLE):
            def _delete(table: str = table) -> Any:
                return supabase.table(table).delete().lte("expires_at", now_iso).execute()

            await db_execute(_delete)
    except Exception as exc:  # noqa: BLE001 - disposition: normal return
        logger.warning(
            "trade read store unavailable (%s): expired rows left in place", type(exc).__name__
        )


async def load_window(
    supabase: Any, api_key_id: str, meta: WindowMeta
) -> list[dict[str, Any]] | None:
    """The trades of one stored window, in the order they were stored, or None when the window
    is not whole, not current or does not parse (the caller re-reads it)."""
    try:
        def _fetch() -> Any:
            return (
                supabase.table(WINDOW_TABLE)
                .select(_CHUNK_COLUMNS)
                .eq("api_key_id", api_key_id)
                .eq("window_start_ms", meta.window_start_ms)
                .order("chunk_index")
                .execute()
            )

        chunk_rows = [dict(r) for r in rows(await db_execute(_fetch))]
        found = _meta_of(meta.window_start_ms, chunk_rows, _wall_ms())
        if found != meta:
            logger.warning(
                "trade read store: stored window unusable (chunks_or_header) key=%s chunks=%d",
                api_key_id, len(chunk_rows),
            )
            return None
        trades: list[dict[str, Any]] = []
        for r in sorted(chunk_rows, key=lambda c: int(c["chunk_index"])):
            payload = r.get("trades")
            if not isinstance(payload, list) or len(payload) != r["n_trades"]:
                logger.warning(
                    "trade read store: stored window unusable (chunk_count_mismatch) key=%s chunk=%d",
                    api_key_id, int(r["chunk_index"]),
                )
                return None
            try:
                trades.extend(unproject_trade(item) for item in payload)
            except ValueError:
                logger.warning(
                    "trade read store: stored window unusable (malformed_trade) key=%s chunk=%d",
                    api_key_id, int(r["chunk_index"]),
                )
                return None
        return trades
    except Exception as exc:  # noqa: BLE001 - disposition: the window is re-read
        _log_fault(exc, api_key_id, "the window is re-read")
        return None


async def save_window(
    supabase: Any,
    api_key_id: str,
    window_start_ms: int,
    window_end_ms: int,
    trades: list[dict[str, Any]],
) -> bool:
    """Keep one COMPLETE window. True when every chunk was written.

    The window's existing rows are deleted first, so a re-read that produced fewer chunks
    leaves no stale chunk behind. A window holding a value the wire cannot carry (NaN,
    infinity) or a trade that does not project is not stored: False, one WARNING, nothing
    written.
    """
    try:
        projected = [project_trade(t) for t in trades]
        if not all(_storable(r) for r in projected):
            logger.warning(
                "trade read store: window not stored (unstorable_value) key=%s trades=%d",
                api_key_id, len(projected),
            )
            return False
        chunks = _chunks_of(projected)
        expires_at = _iso(_wall_ms() + STORE_EXPIRY_S * 1000)

        def _clear() -> Any:
            return (
                supabase.table(WINDOW_TABLE)
                .delete()
                .eq("api_key_id", api_key_id)
                .eq("window_start_ms", window_start_ms)
                .execute()
            )

        await db_execute(_clear)
        for index, chunk in enumerate(chunks):
            await _upsert(
                supabase,
                WINDOW_TABLE,
                {
                    "api_key_id": api_key_id,
                    "window_start_ms": window_start_ms,
                    "chunk_index": index,
                    "chunk_count": len(chunks),
                    "window_end_ms": window_end_ms,
                    "read_version": TRADE_READ_VERSION,
                    "n_trades": len(chunk),
                    "trades": chunk,
                    "expires_at": expires_at,
                },
                "api_key_id,window_start_ms,chunk_index",
            )
        return True
    except Exception as exc:  # noqa: BLE001 - disposition: the window stays unstored
        _log_fault(exc, api_key_id, "the window stays unstored; its trades stay in this claim")
        return False

