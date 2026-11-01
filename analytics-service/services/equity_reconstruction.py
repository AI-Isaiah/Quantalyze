"""Phase 07 historical equity reconstruction (D-01 / D-02), reduced by Phase 176.

Phase 176 (LEGACYRETIRE) retired the legacy allocator equity curve. Under D-02 it
removed the writers of that curve (``persist_equity_snapshots`` and the two replace
helpers), the bodies of both job kinds (``reconstruct_allocator_history``,
``refresh_allocator_equity_daily``, now one no-op stub in ``services.job_worker``)
and the bootstrap gate's Python twin. Under D-04 and the founder's go/no-go on plan 11
(2026-11-01) it also removed the history crawl that only those job bodies used.

The D-04 cap and marker helpers (``_mark_api_key_history_reconstructed``,
``_fanout_would_still_retry``, ``HISTORY_RECONSTRUCT_ATTEMPT_CAP`` and their closed
set) stay here inert, byte-identical, pinned by
``test_the_d04_inert_helpers_stay``; TODOS ``176-RECONSTRUCT-CAP-MARKER-INERT``
books their removal.

What the module still provides: ``EquityCurveBuilder``, the marked-equity read
(``read_marked_equity_usd``, ``read_okx_option_exposure``) that the ingestion and
mark paths import, the CoinGecko price helpers and the current-equity anchor read.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Final

import ccxt.async_support as ccxt
import httpx

from services.ccxt_flow_fetch import _rate_limit_sleep
from services.dateday import epoch_ms_to_iso_day
from services.db import db_execute
from services.exchange import aclose_exchange
from services.price_rule import gap_disposition, is_stable_value, usable_price
from services.redact import scrub_freeform_string

if TYPE_CHECKING:
    from services.ingestion.adapter import MetricsSnapshot, Position

logger = logging.getLogger("quantalyze.analytics.equity_reconstruction")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RAW_PAYLOAD_CAP_BYTES: int = 4096


COINGECKO_BASE: str = "https://api.coingecko.com/api/v3"
COINGECKO_MIN_SLEEP_SECS: float = 2.0       # stay below 30 RPM free tier
# MARKSOURCE D-02: the ``token_price_history.source`` tag of a CLOSE-labelled CoinGecko price.
# Rows written before this tag existed are tagged 'coingecko' and carry the price at the START
# of their date (the previous day's close) under that date. They are never read again.
COINGECKO_CLOSE_SOURCE: Final[str] = "coingecko_close"


# Common coingecko ID overrides. Phase 07 MVP uses symbol.lower() for any
# symbol not in this map; manual QA (f9/f4) catches mispricings.
COINGECKO_ID_OVERRIDES: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "USDT": "tether",
    "USDC": "usd-coin",
    "DAI": "dai",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
    "MATIC": "matic-network",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "DOT": "polkadot",
    "ATOM": "cosmos",
}


# ---------------------------------------------------------------------------
# Exception classification (copy of allocator_positions.py pattern)
# ---------------------------------------------------------------------------

def _map_exception_to_sync_status(exc: Exception) -> str:
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"


# ---------------------------------------------------------------------------
# ccxt fetch helpers
# ---------------------------------------------------------------------------

# `_rate_limit_sleep` promoted to services.ccxt_flow_fetch (Phase 76-01) and
# imported above — one definition, shared by the trade/ohlcv paginators here
# and the ccxt transfer fetch.


# `_fetch_transfers` promoted verbatim to
# services.ccxt_flow_fetch.fetch_ccxt_transfers (Phase 76-01) and imported
# above. The allocator-dashboard consumer (_fetch_and_price_window) calls it
# through that shared module so the ccxt flow adapter (76-04) rides the SAME
# fetch path (FLOW-03).


async def _fetch_ohlcv_daily(
    exchange: Any, symbol: str, start_ms: int, end_ms: int,
) -> list[list[Any]]:
    """Daily close OHLCV in [start_ms, end_ms]. Paginate until we reach
    end_ms or the venue stops returning new data.

    /investigate 2026-04-24 (v0.15.4.3): previously broke the loop on
    ``len(page) < 1000`` as an end-of-data heuristic. OKX's candles
    endpoint caps at 300 bars/page, so for any backfill window wider
    than 300 days (we fetch BACKFILL_CAP_DAYS=730 days on every
    reconstruct) the loop terminated after ONE page, 300 days deep,
    leaving the last ~430 days of daily closes unfetched. _price_on's
    bisect then returned the final bar's close (2025-02-17, $2744.46)
    for every modern date, marking the allocator's 21 ETH short to a
    stale price and reporting PERP=-$16,846 on an account whose real
    unrealised PnL was -$210. Remove the premature break — trust the
    cursor-advance and empty-page conditions instead.

    Raises ccxt.BadSymbol for symbols the venue does not list — caller
    uses this as the CoinGecko-fallback trigger.
    """
    all_rows: list[list[Any]] = []
    cursor_ms = start_ms
    day_ms = 24 * 60 * 60 * 1000
    # Safety ceiling: 10 pages × 1000 bars = 10000 candles, more than
    # any 2-year daily window needs. Prevents infinite loops on a
    # venue whose cursor-advance reports the wrong max_ts.
    for _ in range(10):
        if cursor_ms > end_ms:
            break
        page = await exchange.fetch_ohlcv(symbol, "1d", cursor_ms, 1000)
        page = page or []
        if not page:
            break
        all_rows.extend(page)
        max_ts = max((int(row[0]) for row in page), default=cursor_ms)
        if max_ts <= cursor_ms:
            # Cursor didn't advance — we've reached the end of the
            # venue's data for this window, or the venue returned
            # duplicates. Either way, stop.
            break
        if max_ts >= end_ms:
            # Reached the requested end — no need to fetch further.
            break
        cursor_ms = max_ts + day_ms
        await _rate_limit_sleep(exchange)
    return all_rows


# ---------------------------------------------------------------------------
# CoinGecko fallback
# ---------------------------------------------------------------------------

def _coingecko_id_for(symbol: str) -> str:
    return COINGECKO_ID_OVERRIDES.get(symbol.upper(), symbol.lower())


async def _fetch_coingecko_daily_closes(
    symbol: str, start_ts_secs: int, end_ts_secs: int
) -> list[tuple[str, float]]:
    """Hit /coins/{id}/market_chart/range. Returns [(isodate, close_usd), ...].

    CLOSE semantics (MARKSOURCE D-02, the rule of ``services.price_rule``): a point
    stamped ``D 00:00 UTC`` is the price at the START of day D, which is the close of
    day D-1. So the FIRST point stamped on UTC date D+1 is returned as the close of D.
    This is the rule ``services.benchmark._fetch_from_coingecko`` already applies
    (Phase 170.2, measured 2026-10-09: same-date pairing off by up to 2.6 percent,
    shifted pairing about 0.05 percent). The range endpoint is hourly for ranges of 2-90
    days and daily beyond, so the first point of a date is its 00:00 one; later points
    of the same date are ignored, and when that first point is not a usable price
    (not finite, or <= 0) or is stamped an hour or more after midnight (the final point of the
    range is the live price, not a close) the day is a gap rather than being filled from a later hour.
    The close of the day before ``start_ts_secs`` was not asked for and is dropped, and
    the last day's own close is not published until the next 00:00, so it is absent.

    Budget-aware: sleeps COINGECKO_MIN_SLEEP_SECS between calls to stay below
    30 RPM. Never logs the response body (threat T-07-V6) — only symbol +
    date + status.
    """
    cg_id = _coingecko_id_for(symbol)
    url = f"{COINGECKO_BASE}/coins/{cg_id}/market_chart/range"
    params: dict[str, str | int] = {
        "vs_currency": "usd",
        "from": start_ts_secs,
        "to": end_ts_secs,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        try:
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "coingecko fetch failed symbol=%s status=%s",
                symbol, getattr(resp, "status_code", "?"),
            )
            return []
        data = resp.json() or {}

    # Rate-limit throttle to stay under CoinGecko's free-tier 30 RPM limit.
    # Tests monkeypatch COINGECKO_MIN_SLEEP_SECS=0 to keep pytest fast.
    # Narrow swallow (M-1030 sibling): CancelledError must propagate so
    # workers honour SIGTERM mid-throttle.
    try:
        await asyncio.sleep(COINGECKO_MIN_SLEEP_SECS)
    except (TypeError, ValueError) as exc:  # pragma: no cover
        # SPEC-SFH-2 (specialist apply 2026-05-16): match the
        # symmetric handler in ``_rate_limit_sleep`` — both narrowed
        # swallows should log so a future reader can grep the same
        # signal, rather than one path silently dropping.
        logger.warning("coingecko throttle sleep skipped: %s", exc)

    prices = data.get("prices") or []
    out: list[tuple[str, float]] = []
    seen_dates: set[str] = set()
    first_close_day = epoch_ms_to_iso_day(start_ts_secs * 1000)
    for row in prices:
        try:
            ts_ms, price = row[0], row[1]
        except (IndexError, TypeError):
            continue
        iso = epoch_ms_to_iso_day(ts_ms)  # B12: single-sourced epoch-ms → UTC day
        if iso in seen_dates:
            continue
        seen_dates.add(iso)
        if ts_ms % 86_400_000 >= 3_600_000:
            # SF-M7: the first point of the date is not a midnight one (the range's final point is
            # the live intraday price), so the previous day's close is not there: a gap.
            continue
        usable = usable_price(price)
        if usable is None:
            continue  # D-02: a zero, negative or non-finite price is a gap, never a close
        close_day = (date.fromisoformat(iso) - timedelta(days=1)).isoformat()
        if close_day < first_close_day:
            continue  # the close of the day before the window: not asked for
        out.append((close_day, usable))
    logger.info(
        "coingecko fetched symbol=%s days=%d",
        symbol, len(out),
    )
    return out


async def _cache_coingecko_prices(
    supabase: Any, symbol: str, prices: list[tuple[str, float]]
) -> None:
    """Batch-UPSERT close-labelled prices into token_price_history, updating on (symbol, asof).

    MARKSOURCE D-02: rows are tagged ``COINGECKO_CLOSE_SOURCE`` and the upsert UPDATES on
    conflict. The old rows (tag 'coingecko') carry the price at the start of their date
    under that date; they are overwritten day by day as the days are re-fetched and are
    never read (``_read_cached_prices`` filters on the close tag). A do-nothing-on-conflict
    insert would have kept them beside the corrected price.
    """
    if not prices:
        return
    rows = [
        {
            "symbol": symbol,
            "asof": iso,
            "price_usd": price,
            "source": COINGECKO_CLOSE_SOURCE,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        for iso, price in prices
    ]

    def _upsert() -> Any:
        return supabase.table("token_price_history").upsert(
            rows,
            on_conflict="symbol,asof",
        ).execute()

    try:
        await db_execute(_upsert)
    except Exception as exc:  # noqa: BLE001
        logger.warning("token_price_history upsert failed symbol=%s: %s", symbol, exc)


async def _read_cached_prices(
    supabase: Any, symbol: str, start_iso: str, end_iso: str
) -> dict[str, float]:
    """SELECT close-labelled prices from token_price_history; return {asof_iso: price_usd}.

    Only rows tagged ``COINGECKO_CLOSE_SOURCE`` are read: older rows carry the price at the
    START of their date and would be an open read as a close (MARKSOURCE D-02).
    """
    def _sel() -> Any:
        return (
            supabase.table("token_price_history")
            .select("asof, price_usd")
            .eq("symbol", symbol)
            .eq("source", COINGECKO_CLOSE_SOURCE)
            .gte("asof", start_iso)
            .lte("asof", end_iso)
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning("token_price_history read failed symbol=%s: %s", symbol, exc)
        return {}
    data = getattr(res, "data", None) or []
    return {r["asof"]: float(r["price_usd"]) for r in data if r.get("asof") is not None}


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def _reconstruct_outcome_completes_the_key(
    audit_kind: str, *, sibling_lookup_failed: bool, snapshot_lookup_failed: bool,
) -> bool:
    """True when this ladder exit may stamp ``api_keys.history_reconstructed_at``.

    ONE rule for what counts as a completed reconstruct, shared with PR 1's
    backfill (migration 20261014120000, SFH-2), which withholds the marker from
    an audit row carrying ``sibling_check_failed`` or ``snapshot_lookup_failed``
    because those are TRANSIENT FAILURES, not outcomes: neither says the key's
    history was rebuilt, and the next run of the worker may. The marker has no
    expiry, so stamping them would make a stale curve permanent.

    Not a completion: D-15 ``reconstruct_unexpected_noop``; a failed sibling
    lookup (the worker fell back to ON CONFLICT DO NOTHING without knowing
    whether the key is the sole one, so what it persisted may have been dropped
    by a collision); a failed snapshot-presence lookup (an empty replace refused
    because the question went unanswered, not because history was confirmed).
    """
    return (
        audit_kind != "allocator.equity.reconstruct_unexpected_noop"
        and not sibling_lookup_failed
        and not snapshot_lookup_failed
    )


async def _mark_api_key_history_reconstructed(supabase: Any, api_key_id: str) -> None:
    """Stamp ``api_keys.history_reconstructed_at`` for ``api_key_id`` (D-04).

    Called by ``run_reconstruct_allocator_history_job`` at its normal completion
    ladder only, immediately BEFORE the completion audit, and never on a failed
    reconstruct, the short-circuit, or a D-15 no-op. It RAISES when the UPDATE
    raises or touches no row: a swallowed failure would let the job end DONE
    and emit a success audit for a key that is still owed (SC-1), and the daily
    fan-out would then re-crawl it for ever.

    A plain service-role UPDATE rather than a SECURITY DEFINER RPC: only the
    marker's NULL-ness is ever read (never its value), so cross-replica clock
    skew is immaterial, and an RPC would add a function, an ACL and a gate arm
    for no reader. Re-stamping an already-set marker (a re-crawl) is harmless.
    """
    stamp = datetime.now(timezone.utc).isoformat()

    def _upd() -> Any:
        return (
            supabase.table("api_keys")
            .update({"history_reconstructed_at": stamp})
            .eq("id", api_key_id)
            .execute()
        )

    res = await db_execute(_upd)
    if not getattr(res, "data", None):
        raise RuntimeError("api_keys marker update matched no row")


def _account_marker_key_ids(account_keys: Sequence[Mapping[str, Any]]) -> list[str]:
    """The ids a forced ACCOUNT rebuild stamps ``history_reconstructed_at`` on, sorted.

    UPNLVENUES D-04 / PD-O. A rebuilt book is ONE aggregate per day, so a key of the account
    that still looks owed would be re-crawled by the daily fan-out, and its unforced
    reconstruct on a multi-key allocator persists first-writer-wins: it would fill any day
    the rebuilt book lacks with that key's value alone. Every ACTIVE key of the account is
    therefore marked, the job's own and the siblings', including a key that was rebuilt
    through another member of its exchange account (its account's history is the rebuilt one).

    Left as they were: an INACTIVE key (no reconstruct can run for it, the preflight fails it
    permanently, so nothing can re-fill the book through it) and a Deribit key (its history is
    counted as $0 and never rebuilt, so a marker would claim a rebuild that did not happen).
    ``account_keys`` is the persist-time key re-read, the set the window replace was checked
    against.
    """
    return sorted(
        str(row["id"])
        for row in account_keys
        if row.get("is_active") is True
        and _key_venue(row) not in _ACCOUNT_ZERO_CONTRIBUTION_VENUES
    )


class ForcedRebuildRefusedError(RuntimeError):
    """Phase 167.2.1.1 PD-H: raised ONLY on the forced path, when the rebuilt curve could not
    be anchored to today's venue equity including open-position uPnL.

    Caught by the dedicated arm in ``run_reconstruct_allocator_history_job`` before its
    generic ``except Exception``. The message is the static ``forced rebuild refused
    (<reason>)``: ``reason`` is one of ``FORCED_REBUILD_REFUSAL_REASONS`` and no venue
    error text, amount or signature is ever attached.
    """

    def __init__(
        self,
        reason: str,
        opening_check: str | None = None,
        opening_ratios: tuple[float | None, float | None] = (None, None),
    ) -> None:
        self.reason = reason
        # Review SFH-R2-01: (residual, implied) opening ratios over the anchor, 3 significant
        # figures, set only when the bills read cleanly and disagreed. Ratios only.
        self.opening_ratios = opening_ratios
        # Review SFH-03: the OKX bills check's outcome, set only on an
        # ``anchor_skipped_implausible`` refusal. NOT a refusal token and not part of the
        # message: ``_forced_refusal_result`` records it on the refusal's own audit.
        self.opening_check = opening_check
        super().__init__(f"forced rebuild refused ({reason})")


# The reconstruct refuses every Deribit key and the daily refresh skips venue deribit, so both
# allocator writers store a Deribit exchange account as $0. The rebuild counts it, crawls
# nothing and refuses nothing.
_ACCOUNT_ZERO_CONTRIBUTION_VENUES: Final[frozenset[str]] = frozenset({"deribit"})


def _key_venue(key_row: Mapping[str, Any]) -> str:
    """The key's exchange, lower-cased and stripped ("" when it is not a string)."""
    exchange = key_row.get("exchange")
    return exchange.strip().lower() if isinstance(exchange, str) else ""


async def _api_key_already_reconstructed(supabase: Any, api_key_id: str) -> bool:
    """Per-api_key idempotency check, answered from the MARKER ONLY (D-04).

    True when ``api_keys.history_reconstructed_at`` is set for this key. The
    marker is the per-key source of truth: it survives the 30-day retention
    that deletes ``done`` compute_jobs rows, and it is only ever set by a
    completed reconstruct (never by a D-15 no-op).

    A retained ``done`` reconstruct job is NOT evidence, and is never used to
    heal the marker (plan-checker B1): a sole-key no-op
    (``reconstruct_unexpected_noop``) also ends ``done``, so counting that row
    would wave an unrepaired key through for ever. The accepted cost is one
    redundant crawl for a key whose reconstruct completed under the old worker
    after M2's backfill re-run and before this code deployed. This function
    writes nothing and cannot create success evidence for an unmarked key.

    History: Migration 076 made the check per-api_key (an allocator's first
    reconstruct rows had blocked every other key from backfilling, because
    allocator_equity_snapshots aggregates across keys at UPSERT time and cannot
    answer the per-key question). The key row is the per-key record.

    A failed lookup logs and answers False, as before: pre-existing, and a
    re-crawl is safe because D-07 limits the replace to true sole keys.
    """
    def _sel() -> Any:
        return (
            supabase.table("api_keys")
            .select("history_reconstructed_at")
            .eq("id", api_key_id)
            .limit(1)
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "api_keys reconstruct-marker lookup failed for api_key=%s: %s",
            api_key_id, scrub_freeform_string(str(exc)),
        )
        return False
    rows = getattr(res, "data", None) or []
    return any(r.get("history_reconstructed_at") is not None for r in rows)


# Phase 167.1.2 plan 12, review SFH-R2-01: the reconstruct statuses that hold
# a zero-snapshot book's daily refresh. It is the in-flight half of the list
# migration 20260927120000's fan-out counts as "bootstrapped" (its `done` is
# left out on purpose): a done reconstruct already wrote the rows it could, so
# the refresh may start the book. failed_retry is in flight because the worker
# claims it again.
_RECONSTRUCT_IN_FLIGHT_STATUSES: tuple[str, ...] = (
    "pending", "running", "done_pending_children", "failed_retry",
)


# Phase 167.1.2.1 D-09: the daily fan-out stops retrying a key's reconstruct
# after this many attempts and raises a loud event instead. THREE twins carry the
# number: this constant, the SQL `v_reconstruct_attempt_cap` in
# `enqueue_refresh_allocator_equity_for_all`, and the TypeScript
# `HISTORY_RECONSTRUCT_ATTEMPT_CAP`. `tests/test_history_reconstruct_cap_twins.py`
# and `src/__tests__/history-reconstruct-cap-twins.test.ts` pin them equal; this
# comment does not.
HISTORY_RECONSTRUCT_ATTEMPT_CAP: Final[int] = 5

# The `sync_status` values after which the fan-out no longer retries a key (the
# cheap qualifying columns of `enqueue_refresh_allocator_equity_for_all`): the
# credential is revoked, or the key is in a sign-in or hard-error state. A NULL
# status still qualifies.
_NON_RETRYABLE_SYNC_STATUSES: tuple[str, ...] = ("revoked", "sign_in_failed", "error")


def _fanout_would_still_retry(key: Mapping[str, Any]) -> bool:
    """The per-row half of the fan-out's owed predicate (migration
    20261021120000, the ``rk`` query), which the daily fan-out applies per key:
    marker NULL, ``history_reconstruct_attempts < HISTORY_RECONSTRUCT_ATTEMPT_CAP``,
    active, ``sync_status`` not revoked / sign_in_failed / error (NULL allowed),
    not disconnected, not a Deribit key (Deribit reconstruction is refused
    permanently).

    Two terms of that query are NOT row columns and are applied elsewhere:
    the strategy-link filter (``_strategy_linked_key_ids``, review WR-01) and the
    "no reconstruct in flight" term, which this module inverts on purpose (an
    in-flight job is waited on, see ``_owed_reconstructs_for_zero_snapshot_book``).

    One deliberate asymmetry: the fan-out treats ``attempts = 0`` as owed, but this
    predicate requires ``attempts >= 1``. A key no job has ever touched has
    nothing for the refresh to wait on, and holding on it would freeze a
    user-driven first refresh until a fan-out run that the 25-book cap may put
    days away. ``tests/test_fanout_owed_predicate_twins.py`` pins the asymmetry
    and every other term against the migration's text."""
    if key.get("history_reconstructed_at") is not None:
        return False
    attempts = int(key.get("history_reconstruct_attempts") or 0)
    return (
        1 <= attempts < HISTORY_RECONSTRUCT_ATTEMPT_CAP
        and key.get("is_active") is True
        and (key.get("sync_status") or "") not in _NON_RETRYABLE_SYNC_STATUSES
        and key.get("disconnected_at") is None
        and (key.get("exchange") or "").lower() != "deribit"
    )


async def _read_newest_priced(
    supabase: Any,
    allocator_id: str,
    api_key_ids: Sequence[str],
    symbol: str,
    window_end: str,
) -> tuple[str, float] | None:
    """``(asof, mark_price)`` of the newest priced spot row of ``symbol`` held through
    ``api_key_ids`` on or before ``window_end``, or ``None`` when it was never priced.

    The one sizing source of a balance with no price: the refresh's ``_judge_price_gaps`` and the
    Binance mark's dust check (review WR-06) both read it here. NOT wrapped: a failed read raises.
    ``_judge_price_gaps`` lets it raise (T-13); ``_drop_binance_dust_unpriced`` catches it, logs,
    and keeps the unpriced coins named.
    """

    def _sel_newest_priced() -> Any:
        # WR-05: the newest PRICED row of one symbol, not every row. PostgREST answers at
        # most ``max_rows`` (1000) rows and a gap row is stored with ``mark_price`` 0, so a
        # long-stuck balance's last priced row sits at the end of a newest-first read and
        # is cut off.
        return (
            supabase.table("allocator_holdings")
            .select("symbol, mark_price, asof, holding_type")
            .eq("allocator_id", allocator_id)
            .in_("api_key_id", list(api_key_ids))
            .eq("symbol", symbol)
            .eq("holding_type", "spot")
            .gt("mark_price", 0)
            .lte("asof", window_end)
            .order("asof", desc=True)
            .limit(1)
            .execute()
        )

    result = await db_execute(_sel_newest_priced)
    for r in getattr(result, "data", None) or []:
        mark = usable_price(r.get("mark_price"))
        asof = str(r.get("asof") or "")
        if mark is not None and asof:
            return asof, mark
    return None


# The key_inputs anchor tokens that mean the key's live equity read found no
# material capital (job_worker's key-mode derive epilogue: a non-positive
# equity, or one at or under DUST_NAV_FLOOR). Every other state is capital or
# an unknown: a present anchor_usd is material by construction (the writer
# nulls it at or under the floor), balance_error and nonfinite are failed
# reads, and flow_drop is stamped only above the floor.
_NO_CAPITAL_ANCHOR_REASONS: frozenset[str] = frozenset({"dust", "nonpositive"})


# ---------------------------------------------------------------------------
# Shared current-equity read block
# ---------------------------------------------------------------------------


# Phase 167.2.1.1 review WR-02 / SFH-2: bounds for the forced path's completeness check of
# ``fetch_positions()``. ccxt 4.5.88 ``bybit.fetch_positions`` sends ``limit=200`` when the
# caller gives none and does not page by default, so fewer than ``limit`` rows proves the
# read is complete and a full page (200 or more) means it may be truncated. (Bybit's
# ``nextPageCursor`` is not used: it can be non-empty beside a single position.) Bybit also reports the account's ``totalPerpUPL`` (a decimal string at
# ``balance["info"]["result"]["list"][0]``, 8 dp, so rounding is negligible). The two figures
# come from two sequential REST calls, so marks move between them: the tolerance is the
# larger of 1 USD and 0.5% of the wallet figure (the equity before open uPnL), the scale
# the drift follows (it follows notional, not the uPnL). It is wide enough for seconds of
# price movement and far below a missing USDC or inverse position on a book worth anchoring.
_POSITIONS_PAGE_LIMIT: Final[int] = 200


class _AnchorPartialSet(set[str]):
    """The unpriced-asset set ``_fetch_current_equity`` returns, carrying one more fact.

    ``positions_unread`` (review SFH-3) is True when an UNFORCED anchor on a venue that adds
    open uPnL (Bybit, Binance) shipped at the wallet figure because ``fetch_positions()``
    failed. It rides the existing return so the function's signature, and every caller and
    fake that unpacks two values, is unchanged (PD-J).
    """

    positions_unread: bool = False
    # Phase 167.2.1.1.1 plan 15 (L4): the ALL-ASSET wallet total (every held asset priced, BEFORE
    # the positions' uPnL is added), set where the function takes ``_wallet_total``. ``None``
    # until that point is reached. The marks writer needs it to state the open profit as
    # ``total - wallet_total_usd`` and to check the wallet basis against the derive's own USDT
    # figure; it rides this side channel (PD-J) so no caller's two-value unpacking changes.
    wallet_total_usd: float | None = None


_BYBIT_UPNL_TOLERANCE_USD: Final[float] = 1.0
_BYBIT_UPNL_TOLERANCE_REL: Final[float] = 0.005


async def _price_wallet_totals(
    exchange: Any, totals: dict[Any, Any],
) -> tuple[float, _AnchorPartialSet]:
    """Price every held asset of ``balance["total"]`` in USD: the wallet, before any open profit.

    Extracted unchanged from ``_fetch_current_equity`` (Phase 167.2.1.1.1 plan 18) so the forced
    rebuild path and the Bybit UTA mark read (``_read_bybit_uta_mark``) price a wallet with ONE
    rule: stablecoins and ``STABLECOIN_SPLIT_SUFFIXES`` at 1.0, every other asset with
    ``fetch_ticker("<ASSET>/USDT")`` in the order ``totals`` lists them, a failed ticker read
    recorded in the returned partial set (the total is then an undercount).

    MARKSOURCE D-02: a ticker that ANSWERS without a usable ``last`` (missing, ``None``, not a
    finite number, or <= 0) is a gap exactly like a raised read: the asset joins the partial
    set and adds nothing to the total, never a measured $0.
    """
    partial_unpriced = _AnchorPartialSet()
    total = 0.0
    for asset, qty in totals.items():
        if qty is None:
            continue
        try:
            q = float(qty)
        except (TypeError, ValueError):
            continue
        if q <= 0:
            continue
        asset_upper = str(asset).upper()
        # red-team/H-2: STABLECOIN_SPLIT_SUFFIXES (USDE, PYUSD, USDB)
        # are NOT in STABLECOINS (by design — they drive symbol-suffix
        # logic not price-skip logic). But they ARE stable-value assets.
        # Without this guard, fetch_ticker("USDE/USDT") is attempted; on
        # venues without a liquid pair it fails → partial_unpriced.add →
        # anchor unconditionally skipped for every OKX account holding
        # USDe collateral (extremely common). Treat them as $1 per unit.
        # ``is_stable_value`` is STABLECOINS plus those suffixes (price_rule).
        if is_stable_value(asset_upper):
            total += q
            continue
        # Price non-stablecoin spot via a single ticker call. Best-
        # effort — a missing ticker records the asset as unpriced so
        # the caller can decide whether to trust the anchor.
        px = 0.0
        _ticker_fetch_failed = False
        try:
            t = await exchange.fetch_ticker(f"{asset_upper}/USDT")
            _last = usable_price(t.get("last")) if isinstance(t, dict) else None
            if _last is None:
                # D-02: the ticker answered but gave no usable last. That is a hole.
                _ticker_fetch_failed = True
            else:
                px = _last
        except ccxt.RateLimitExceeded:
            # Review F3: a 429 is the venue asking us to back off, not "this asset has no
            # price". It reaches the caller's rate-limit handling instead of joining the
            # partial set.
            raise
        except Exception as ticker_exc:  # noqa: BLE001
            # The class only: ccxt error text can carry a request signature, and the asset is
            # one owner's holding (T-13: never a coin symbol or an amount in a log line).
            logger.warning(
                "_price_wallet_totals: fetch_ticker failed (%s); the asset is unpriced",
                type(ticker_exc).__name__,
            )
            px = 0.0
            _ticker_fetch_failed = True
        # NEW-C01-02 (silent-failure/F-06 fix): track assets that priced
        # to zero because the price is UNKNOWN (auth error, network error,
        # missing ticker) — those represent unknown equity that could cause
        # the anchor to understate the true total. MARKSOURCE D-02 REVERSES
        # this comment's earlier premise that a ticker answering ``None`` or 0
        # was "a genuine zero": a ticker that answers without a usable last is
        # a hole, not a measured zero, and counting the asset at $0 is exactly
        # the undercount the partial set exists to name. The red-team/H-2
        # rationale above stands: stable-value assets never reach this read.
        if _ticker_fetch_failed:
            partial_unpriced.add(asset_upper)
        total += q * px
    return total, partial_unpriced


def _drop_bybit_dust_unpriced(partial: set[str], balance: Any) -> None:
    """Review WR-04 (D-06 on the mark and anchor path): forget unpriced coins that are dust.

    Bybit reports a per-coin ``usdValue`` beside ``totalEquity`` in the wallet-balance entry. When
    EVERY coin we could not price is sized by it, and together they are below the dust floor
    (``price_rule.gap_disposition`` answers ``dust`` against ``totalEquity``), they leave the
    unpriced set: one worthless token with no usable ticker must not refuse every daily mark. A
    coin with no usable ``usdValue`` is not sized, so it stays named and the account stays refused.
    """
    try:
        entry = balance["info"]["result"]["list"][0]
        equity = _finite_float(entry["totalEquity"])
        coins = entry["coin"]
        sizes = {
            str(c["coin"]).upper(): _finite_float(c.get("usdValue")) for c in coins
        }
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        # Review F2: the unpriced set stays as it is, and the log says why no coin was sized.
        logger.warning(
            "_drop_bybit_dust_unpriced: wallet-balance entry unreadable (%s); "
            "unpriced coins stay named",
            type(exc).__name__,
        )
        return
    if not partial or equity is None:
        return
    unpriced = [sizes.get(sym) for sym in partial]
    if any(u is None or u < 0 for u in unpriced):
        return
    unpriced_usd = sum(u for u in unpriced if u is not None)
    if gap_disposition(unpriced_usd, equity) == "dust":
        # Review F2: clearing the set turns a refusal into a mark, so it leaves a record.
        # T-13: the count only, never a coin symbol or a USD figure.
        logger.warning(
            "_drop_bybit_dust_unpriced: %d unpriced coin(s) sized by Bybit's usdValue "
            "are below the dust floor of totalEquity; they leave the unpriced set",
            len(partial),
        )
        partial.clear()


async def _drop_binance_dust_unpriced(
    partial: set[str],
    totals: dict[Any, Any],
    wallet_usd: float,
    supabase: Any,
    allocator_id: str,
    api_key_ids: Sequence[str],
) -> None:
    """Review WR-06 (founder D-10): the Bybit rule for Binance, which reports no per-coin USD.

    Each unpriced coin is sized as its held quantity times its newest priced ``allocator_holdings``
    row (``_read_newest_priced``, the refresh's own source). Only when EVERY unpriced coin is sized,
    and together they are below the dust floor against the priced wallet (``gap_disposition``), do
    they leave the unpriced set. A coin that was never priced stays named and the mark stays refused.
    """
    if not partial:
        return
    held: dict[str, float] = {}
    for asset, qty in totals.items():
        quantity = _finite_float(qty)
        if quantity is not None:
            held[str(asset).upper()] = quantity
    window_end = datetime.now(timezone.utc).date().isoformat()
    unpriced_usd = 0.0
    for symbol in sorted(partial):
        quantity = held.get(symbol)
        if quantity is None:
            return
        try:
            newest = await _read_newest_priced(supabase, allocator_id, api_key_ids, symbol, window_end)
        except Exception as exc:  # noqa: BLE001 - a database error is not a venue balance failure
            logger.warning(
                "_drop_binance_dust_unpriced: the holdings read failed (%s); the %d unpriced "
                "coin(s) stay named",
                type(exc).__name__, len(partial),
            )
            return
        if newest is None:
            logger.warning(
                "_drop_binance_dust_unpriced: %d unpriced coin(s) stay named, one was never priced",
                len(partial),
            )
            return
        unpriced_usd += quantity * newest[1]
    if gap_disposition(unpriced_usd, wallet_usd) == "dust":
        logger.warning(
            "_drop_binance_dust_unpriced: %d unpriced coin(s) sized by their newest priced "
            "holdings rows are below the dust floor of the priced wallet; they leave the "
            "unpriced set",
            len(partial),
        )
        partial.clear()
    else:
        logger.warning(
            "_drop_binance_dust_unpriced: %d unpriced coin(s) stay named, sized by their "
            "newest priced holdings rows, above dust floor of the priced wallet",
            len(partial),
        )


async def _fetch_current_equity(
    exchange: Any,
    venue: str,
    *,
    refuse_unread_positions: bool = False,
    supabase: Any = None,
    allocator_id: str | None = None,
    api_key_ids: Sequence[str] | None = None,
) -> tuple[float | None, set[str]]:
    """Return (equity_usd, partial_unpriced_symbols).

    ``refuse_unread_positions`` (forced path only, Phase 167.2.1.1 PD-H): when True and the
    venue ADDS open-position uPnL here (Bybit, Binance: not ``_UNIFIED_MARGIN_VENUES``), a
    ``fetch_positions()`` that raises, returns a non-list, may be truncated
    (``_POSITIONS_PAGE_LIMIT`` or more rows), carries an open position
    without a numeric uPnL, or (Bybit) sums to something other than the balance's
    ``totalPerpUPL`` raises ``ForcedRebuildRefusedError("positions_unreadable")``
    instead of anchoring without part of the uPnL. False keeps the advisory-anchor
    contract below, unchanged.

    ``equity_usd`` is today's total account equity in USD, or None if we
    can't determine it. ``partial_unpriced_symbols`` is the set of
    non-stablecoin assets whose ticker call failed while they had qty>0 —
    a non-empty set means the equity figure is an undercount and the
    anchor should be skipped (NEW-C01-02 / NEW-C01-03).

    Keeps the semantics of the daily refresh job (v0.15.4.0 fix 2): spot
    rows contribute their marked value, derivative rows contribute
    unrealized PnL only — on unified-margin venues the USDT collateral
    backing perps already sits in the spot row and summing notional on
    top double-counts.

    Wrapped in a blanket try/except: the anchor is advisory, not load-
    bearing. Any exchange error — except ``ccxt.RateLimitExceeded``, which
    propagates to the crawl's rate-limit arm (review F3) — including mocked
    exchanges in tests that don't stub fetch_balance/fetch_positions — returns (None, set())
    so the reconstruction still ships an unanchored series rather than
    failing the whole job.
    """
    partial_unpriced = _AnchorPartialSet()
    # OKX: ccxt's unified fetch_balance() crashes (load_markets keysort,
    # str < None TypeError in ccxt 4.5.x) so the anchor here silently returned
    # None for every OKX account, shipping an UN-anchored reconstructed curve.
    # Read OKX's own marked-to-USD account equity via the raw endpoint instead;
    # totalEq already includes open-position unrealized PnL, so the OKX-only
    # uPnL gate below (``_UNIFIED_MARGIN_VENUES``) is already satisfied.
    if venue.lower() == "okx":
        from services.exchange import fetch_okx_total_equity_usd

        eq = await fetch_okx_total_equity_usd(exchange)
        if eq is not None:
            return eq, partial_unpriced
        # eq is None → fall through to the generic path (which will most
        # likely also fail and return None, preserving the advisory-anchor
        # contract: an un-anchored series ships rather than failing the job).
    try:
        balance = await exchange.fetch_balance()
        if not isinstance(balance, dict):
            return None, partial_unpriced
        totals = balance.get("total") or {}
        if not isinstance(totals, dict):
            return None, partial_unpriced
        total, partial_unpriced = await _price_wallet_totals(exchange, totals)
        if venue.lower() == "bybit":
            _drop_bybit_dust_unpriced(partial_unpriced, balance)
        elif (
            venue.lower() == "binance"
            and supabase is not None
            and allocator_id is not None
            and api_key_ids is not None
        ):
            # Review WR-06: only the NAV mark passes the database and the key (the anchor does
            # not), so the anchor keeps refusing on an unpriced coin.
            await _drop_binance_dust_unpriced(
                partial_unpriced, totals, total, supabase, allocator_id, api_key_ids,
            )

        # NEW-C01-05, reversed for Bybit by Phase 167.2.1.1 (the earlier text
        # claimed Bybit V5 reports fetch_balance['total'] equity-inclusive; it
        # does not). OKX's anchor is the raw ``totalEq`` read above, which
        # already marks open positions to market, so its position loop is
        # skipped (this point is only reached for OKX when that raw read
        # failed). Bybit's ccxt ``total`` is the coin ``walletBalance``
        # (ccxt 4.5.88 ``bybit.parse_balance``, unchanged since 4.5.59) and
        # Binance's default spot ``total`` is free + locked: neither includes
        # open-position uPnL, so both ADD the ``fetch_positions()`` uPnL here.
        # The reconstruct curve is the mark-to-market basis (the replay marks
        # open perps daily and the daily refresh adds derivative uPnL), while
        # the derive anchor in services/exchange.py
        # (``fetch_account_equity_and_upnl_usd``) is the realized basis with a
        # structural 0.0 wedge. They differ by exactly the open uPnL; do not
        # "unify" them.
        _UNIFIED_MARGIN_VENUES = frozenset({"okx"})
        _skip_upnl = venue.lower() in _UNIFIED_MARGIN_VENUES

        try:
            positions = await exchange.fetch_positions()
        except ccxt.RateLimitExceeded:
            # D-10: a 429 is the venue asking this key to back off, not an unreadable position
            # book. It reaches the caller's rate-limit arm (cooldown stamp) like the pricer's.
            raise
        except Exception as _pos_exc:  # noqa: BLE001
            # silent-failure/F-03: bare except silently dropped the error,
            # leaving positions=[] with no log entry. The venues that ADD
            # uPnL here (Bybit, Binance) lose it from the anchor on a failed
            # read, so the anchor understates equity by the open uPnL and
            # shifts the entire reconstructed curve. The anchor still ships at
            # the wallet figure BY DECISION (an unanchored zero-cash replay is
            # worse than a one-day uPnL shift): see TODOS
            # [167.2.1.1-ANCHOR-POSITIONS-READ-FAILURE]. ccxt error text can
            # carry a request signature, so log the class and the scrubbed
            # message, never the raw text.
            logger.warning(
                "_fetch_current_equity: fetch_positions failed venue=%s "
                "exc_class=%s scrubbed=%s - open-position uPnL left out of "
                "the anchor",
                venue, type(_pos_exc).__name__,
                scrub_freeform_string(str(_pos_exc)),
            )
            if refuse_unread_positions and not _skip_upnl:
                # PD-H: `from None` so no venue error text rides the refusal.
                raise ForcedRebuildRefusedError("positions_unreadable") from None
            partial_unpriced.positions_unread = not _skip_upnl
            positions = []
        if not isinstance(positions, list):
            if refuse_unread_positions and not _skip_upnl:
                raise ForcedRebuildRefusedError("positions_unreadable")
            partial_unpriced.positions_unread = not _skip_upnl
            positions = []
        if (
            refuse_unread_positions
            and not _skip_upnl
            and len(positions) >= _POSITIONS_PAGE_LIMIT
        ):
            raise ForcedRebuildRefusedError("positions_unreadable")
        _wallet_total = total
        partial_unpriced.wallet_total_usd = total
        for p in positions:
            if not isinstance(p, dict):
                continue
            if _skip_upnl:
                # uPnL already included in fetch_balance['total'] on
                # unified-margin venues — adding it again double-counts.
                continue
            upnl: Any = p.get("unrealizedPnl")
            try:
                total += float(upnl)
            except (TypeError, ValueError):
                # Unforced: a position without a numeric uPnL is skipped. Forced
                # (review WR-02): an OPEN one refuses; a flat one carries none.
                if refuse_unread_positions:
                    try:
                        _is_open = float(p.get("contracts") or 0) != 0
                    except (TypeError, ValueError):
                        _is_open = True
                    if _is_open:
                        raise ForcedRebuildRefusedError("positions_unreadable") from None
                continue
        if refuse_unread_positions and venue.lower() == "bybit":
            try:
                _reported_upnl = float(balance["info"]["result"]["list"][0]["totalPerpUPL"])
            except (KeyError, IndexError, TypeError, ValueError):
                raise ForcedRebuildRefusedError("positions_unreadable") from None
            if abs((total - _wallet_total) - _reported_upnl) > max(
                _BYBIT_UPNL_TOLERANCE_USD, _BYBIT_UPNL_TOLERANCE_REL * abs(_wallet_total),
            ):
                raise ForcedRebuildRefusedError("positions_unreadable")
        return total, partial_unpriced
    except ForcedRebuildRefusedError:
        # PD-H: a forced-path refusal must reach the handler, not be swallowed by the
        # blanket arm below into `(None, ...)` and misreported as anchor_unreadable.
        raise
    except ccxt.RateLimitExceeded:
        # Review F3: a 429 from the wallet pricer reaches the crawl's rate-limit arm
        # (cooldown stamp); the blanket arm below would turn it into an unanchored series.
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("anchor: _fetch_current_equity failed venue=%s: %s", venue, exc)
        return None, partial_unpriced


def _finite_float(value: Any) -> float | None:
    """``value`` as a finite float, or ``None`` (absent, ``None``, non-numeric, NaN or infinite)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


#: The values Bybit's ``/v5/account/info`` documents for ``marginMode`` (one of them is refused by
#: name below). Anything else is a field this reader has not been shown to describe: refuse.
_BYBIT_MARGIN_MODES: Final[frozenset[str]] = frozenset({"REGULAR_MARGIN", "PORTFOLIO_MARGIN"})


def _bybit_uta2_status(raw: Any) -> bool:
    """True only for a venue-reported ``unifiedMarginStatus`` of 5 or 6 (an integer, or the digits
    of one). A bool, a float, text, ``None`` and a missing field are all False."""
    if isinstance(raw, bool):
        return False
    if isinstance(raw, int):
        return raw in (5, 6)
    if isinstance(raw, str) and raw.isascii() and raw.isdigit():
        return int(raw) in (5, 6)
    return False


async def _read_bybit_uta_mark(exchange: Any) -> tuple[float, float, float] | str:
    """The Bybit mark from the Unified Trading Account's own totals (NAVMTM plan 18, D-17, D-18).

    Returns ``(nav_usd, open_pnl_usd, wallet_usd)`` = ``(totalEquity, totalEquity -
    totalWalletBalance, totalWalletBalance)`` or ONE refusal token from
    ``nav_marks.MARK_REFUSAL_TOKENS``.

    D-17, verbatim: "The Bybit mark takes NAV and open profit from those totals with no position
    walk. It refuses by name when the venue does not itself report UTA 2.0
    (``unifiedMarginStatus`` 5 or 6, never ccxt's default when the field is missing), when the
    account is in isolated margin, when any coin carries a non-zero borrow, when a field is
    missing or not finite, or when Bybit's ``totalWalletBalance`` disagrees with our own
    independently priced wallet (``wallet_total_usd``) beyond the anchor's tolerance. The existing
    ``totalPerpUPL`` cross-check is retired on this path, because it would compare Bybit's figure
    with itself."
    D-18, verbatim: "The Bybit NAV is ``totalEquity`` (wallet plus perpetual and futures open
    profit plus option value). The stored open profit is ``totalEquity - totalWalletBalance``, so
    the D-04 step books option value with the rest of the open profit."

    Sources (the Bybit V5 documentation, re-read 2026-10-26):
    https://bybit-exchange.github.io/docs/v5/account/wallet-balance (``totalEquity`` is "∑Asset
    Equity By USD value of each asset"; a coin's equity is "walletBalance - spotBorrow +
    unrealisedPnl + Asset Option Value" while ``totalWalletBalance`` sums ``walletBalance``, so
    with borrowing the two totals sit on different bases and the derivatives liabilities in
    ``borrowAmount`` ("spot liabilities + derivatives liabilities") are not shown to be netted:
    any non-zero borrow is refused rather than interpreted; "All account wide fields are not
    applicable to isolated margin"),
    https://bybit-exchange.github.io/docs/v5/acct-mode (UTA 2.0 integrates inverse, USDT and USDC
    perpetuals and futures, spot and options; under UTA 1.0 the inverse book sits in a separate
    ``CONTRACT`` account that the UNIFIED totals do not contain) and
    https://bybit-exchange.github.io/docs/v5/account/account-info (``unifiedMarginStatus``,
    ``marginMode``).

    Why the status and margin mode come ONLY from this function's own ``/v5/account/info`` read and
    never from ``exchange.options``: ccxt caches ``options["unifiedMarginStatus"]`` the first time
    ``fetch_balance`` runs and DEFAULTS it to 6 (UTA 2.0 pro) when the field is absent from the
    response (ccxt 4.5.85 and 4.5.88 ``is_unified_enabled``). A venue that said nothing must not
    be believed to be a UTA 2.0 account, so a missing, other or non-numeric status is
    ``account_mode_unsupported``.

    The ladder, in this order, every refusal naming itself and writing nothing: a raised read or a
    response with no list is ``balance_error``; status not 5 or 6 -> ``account_mode_unsupported``;
    ``marginMode`` ``ISOLATED_MARGIN`` -> ``isolated_margin_unsupported`` (absent or not a
    documented mode -> ``uta_totals_unreadable``); a coin list that is not a list, or a
    ``borrowAmount`` that is missing or not finite -> ``uta_totals_unreadable``, else any non-zero
    ``borrowAmount`` -> ``borrow_present``; ``totalEquity`` or ``totalWalletBalance`` missing or
    not finite -> ``uta_totals_unreadable``. Only then is our own wallet priced (a refused account
    costs no ticker read): one of our ticker reads failing -> ``wallet_unpriced`` (judged before
    the comparison, because our wallet is then a known undercount), and ``totalWalletBalance``
    differing from our wallet by more than ``max(_BYBIT_UPNL_TOLERANCE_USD,
    _BYBIT_UPNL_TOLERANCE_REL x |our wallet|)`` -> ``uta_wallet_mismatch``. D-04's
    ``wallet_basis_mismatch`` against the derive's own USDT wallet is judged afterwards, in
    ``nav_marks.build_mark_read``.

    The ``totalPerpUPL`` cross-check is retired HERE only. The forced history-rebuild path
    (``_fetch_current_equity(..., refuse_unread_positions=True)``) still sums the positions it
    reads and checks them against ``totalPerpUPL``: there the positions are an independent reading
    of the same figure. Both paths price a wallet through ``_price_wallet_totals``.

    Calls per Bybit key per UTC day (amends D-16 for Bybit): ONE ``fetch_balance()`` (ccxt adds
    its own cached ``/v5/user/query-api`` and ``/v5/account/info`` reads on a fresh exchange
    object, as before), ONE ``/v5/account/info`` read of our own, and one ``fetch_ticker`` per
    held non-stable coin. No positions read. Venue error text never leaves this function: a raised
    read is logged by exception class only.
    """
    try:
        balance = await exchange.fetch_balance()
        account = await exchange.privateGetV5AccountInfo()
    except ccxt.RateLimitExceeded:
        # D-10: reaches the derive's rate-limit arm (cooldown stamp), not a plain refusal.
        raise
    except Exception as exc:  # noqa: BLE001 - a refused optional read never fails the derive
        # ccxt error text can carry a request signature: the class name only.
        logger.warning(
            "bybit uta mark: venue read failed exc_class=%s", type(exc).__name__,
        )
        return "balance_error"

    try:
        entries = balance["info"]["result"]["list"]
        wallet_balances = balance["total"]
        info = account["result"]
    except (KeyError, TypeError):
        return "balance_error"
    if (
        not isinstance(entries, list)
        or not entries
        or not isinstance(entries[0], dict)
        or not isinstance(wallet_balances, dict)
        or not isinstance(info, dict)
    ):
        return "balance_error"
    entry: dict[str, Any] = entries[0]

    if not _bybit_uta2_status(info.get("unifiedMarginStatus")):
        return "account_mode_unsupported"
    margin_mode = info.get("marginMode")
    if margin_mode == "ISOLATED_MARGIN":
        return "isolated_margin_unsupported"
    if margin_mode not in _BYBIT_MARGIN_MODES:
        return "uta_totals_unreadable"

    coins = entry.get("coin")
    if not isinstance(coins, list):
        return "uta_totals_unreadable"
    borrowed = False
    for coin in coins:
        if not isinstance(coin, dict):
            return "uta_totals_unreadable"
        amount = _finite_float(coin.get("borrowAmount"))
        if amount is None:
            return "uta_totals_unreadable"
        if amount != 0.0:
            borrowed = True
    if borrowed:
        return "borrow_present"

    total_equity = _finite_float(entry.get("totalEquity"))
    total_wallet = _finite_float(entry.get("totalWalletBalance"))
    if total_equity is None or total_wallet is None:
        return "uta_totals_unreadable"

    our_wallet, partial = await _price_wallet_totals(exchange, wallet_balances)
    _drop_bybit_dust_unpriced(partial, balance)
    if partial:
        return "wallet_unpriced"
    if abs(total_wallet - our_wallet) > max(
        _BYBIT_UPNL_TOLERANCE_USD, _BYBIT_UPNL_TOLERANCE_REL * abs(our_wallet),
    ):
        return "uta_wallet_mismatch"
    return total_equity, total_equity - total_wallet, total_wallet


#: The Binance error codes that mean "this key has no access to the European Options account"
#: and therefore no option value (NAVMTM plan 19, D-20, D-22). ⛔ I2: ``-2015`` is a PLACEHOLDER
#: the first post-deploy run (plan 11) measures: ccxt 4.5.85 and 4.5.88 map BOTH ``-2015`` and
#: ``-2014`` (a bad key) to ``AuthenticationError``, so the exception class cannot tell the two
#: apart and the reader goes by the numeric code parsed from the error text. A different code
#: observed after deploy stops plan 11 and goes to the founder.
_BINANCE_OPTIONS_NO_ACCESS_CODES: Final[frozenset[str]] = frozenset({"-2015"})

#: Binance puts ``{"code":-2015,"msg":"..."}`` in the error text ccxt raises; the code is the only
#: part this reader takes from it.
_BINANCE_ERROR_CODE_RE: Final[re.Pattern[str]] = re.compile(r'"code"\s*:\s*"?(-?\d+)"?')


def _binance_error_code(exc: BaseException) -> str | None:
    """The Binance numeric error code in ``exc``'s text (``"-2015"``), or ``None``."""
    match = _BINANCE_ERROR_CODE_RE.search(str(exc))
    return match.group(1) if match else None


async def _binance_options_call(exchange: Any, method: str, endpoint: str) -> tuple[str, Any]:
    """One Binance European Options read: ``("ok", body)``, ``("no_access", None)`` or
    ``("unreadable", None)``.

    ``no_access`` only for a raised read whose parsed numeric code is in
    ``_BINANCE_OPTIONS_NO_ACCESS_CODES``, never by exception class. Every other raise is
    ``unreadable``. Both outcomes log ONE line in this stable format, which plan 11's post-deploy
    dry run greps to decide whether the pinned code was observed::

        binance options read: endpoint=<marginAccount|position> outcome=<no_access|unreadable> parsed_code=<code|none> exc_class=<class|none>

    ``parsed_code`` is the signed integer parsed from the error text (``-2015``) or ``none``;
    the venue's own text is never logged.
    """
    try:
        body = await getattr(exchange, method)()
    except ccxt.RateLimitExceeded:
        # D-10: reaches the derive's rate-limit arm (cooldown stamp), not a plain refusal.
        raise
    except Exception as exc:  # noqa: BLE001 - a refused optional read never fails the derive
        code = _binance_error_code(exc)
        outcome = "no_access" if code in _BINANCE_OPTIONS_NO_ACCESS_CODES else "unreadable"
        (logger.info if outcome == "no_access" else logger.warning)(
            "binance options read: endpoint=%s outcome=%s parsed_code=%s exc_class=%s",
            endpoint, outcome, code if code is not None else "none", type(exc).__name__,
        )
        return outcome, None
    return "ok", body


def _binance_options_verdict(
    endpoint: str, rows: Any, fields: tuple[str, ...], *, require_all: bool,
) -> str:
    """``"zero"``, ``"holds"`` or ``"unreadable"`` for one options reply's list of rows.

    Every row must be a dict whose ``fields`` are finite numbers (all of them with
    ``require_all``, else at least one); a row with any non-zero finite value among them is a
    holding. A holding wins over a garbled sibling row. A reply that is not a list is unreadable.
    """
    garbled = holds = False
    if isinstance(rows, list):
        for row in rows:
            values = [_finite_float(row.get(f)) for f in fields] if isinstance(row, dict) else []
            known = [v for v in values if v is not None]
            if not known or (require_all and len(known) != len(fields)):
                garbled = True
            elif any(v != 0.0 for v in known):
                holds = True
    else:
        garbled = True
    if holds:
        return "holds"
    if garbled:
        logger.warning(
            "binance options read: endpoint=%s outcome=unreadable parsed_code=none "
            "exc_class=none", endpoint,
        )
        return "unreadable"
    return "zero"


async def _read_binance_options_exposure(exchange: Any) -> str | None:
    """Whether a Binance key holds European Options value, as a refusal token (plan 19, D-20, D-22).

    ``None`` = zero option value, ``"option_value_unverified"`` = a non-zero options balance or an
    open position, ``"option_value_unreadable"`` = a read or a shape that cannot be trusted. Both
    tokens are in ``nav_marks.MARK_REFUSAL_TOKENS``. Called only after the L4 read on the same key
    has succeeded. Two reads, always both, each judged on its own: ``GET /eapi/v1/marginAccount``
    (``asset[].marginBalance`` and ``asset[].equity`` must both be zero) and
    ``GET /eapi/v1/position`` (a row with a non-zero ``quantity`` or ``markValue`` is an open
    position). A read refused with a code in ``_BINANCE_OPTIONS_NO_ACCESS_CODES`` counts as zero.
    A known holding beats an unreadable sibling.
    """
    margin_state, margin = await _binance_options_call(
        exchange, "eapiPrivateGetMarginAccount", "marginAccount",
    )
    position_state, position = await _binance_options_call(
        exchange, "eapiPrivateGetPosition", "position",
    )
    margin_rows = margin.get("asset") if isinstance(margin, dict) else None
    verdicts = [
        _binance_options_verdict(
            "marginAccount", margin_rows, ("marginBalance", "equity"), require_all=True,
        ) if margin_state == "ok" else ("zero" if margin_state == "no_access" else "unreadable"),
        _binance_options_verdict(
            "position", position, ("quantity", "markValue"), require_all=False,
        ) if position_state == "ok" else ("zero" if position_state == "no_access" else "unreadable"),
    ]
    if "holds" in verdicts:
        return "option_value_unverified"
    if "unreadable" in verdicts:
        return "option_value_unreadable"
    return None


async def read_okx_option_exposure(exchange: Any) -> str | None:
    """Whether an OKX account holds an open option, as a refusal token (NAVMTM plan 19, D-18, D-19).

    Returns ``None`` when the account holds no open option (the mark is then written as before),
    ``"option_value_unverified"`` when it holds at least one, or ``"option_value_unreadable"``
    when the positions could not be read. Both tokens are in ``nav_marks.MARK_REFUSAL_TOKENS``.

    D-18, verbatim: "each venue's NAV includes open option value or the mark is refused by name;
    option value is never omitted silently." D-19 (founder 2026-10-26, "Refuse until measured"):
    OKX documents ``totalEq`` and per-currency ``eq`` without saying whether option market value
    is inside them
    (https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance), while option value is
    documented per position (``optVal``,
    https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-positions). So an account with an
    open option is refused until the post-deploy measurement shows whether ``totalEq`` carries it
    and a later change lifts the refusal.

    The one call: ``GET /api/v5/account/positions?instType=OPTION`` through ccxt's implicit
    ``privateGetAccountPositions``, once per key per UTC day (the caller skips it when the day's
    mark is already stored). A raised read, a body that is not a dict, a ``data`` that is not a
    list, an entry that is not a dict, or an entry whose ``pos`` is not a finite number is
    ``option_value_unreadable``: a garbled reply is never "no options". A ``pos`` of exactly zero
    is a flat row, not an open option. When an open option and a garbled entry both appear, the
    known holder wins (``option_value_unverified``).

    The caller must make this read on an OPEN exchange, before ``aclose_exchange``: a read on a
    closed ccxt exchange raises and would refuse every OKX key every day (B1). Venue error text
    never leaves this function: a raised read is logged by exception class only, and the logs
    carry counts and tokens, never an amount.
    """
    try:
        response = await exchange.privateGetAccountPositions({"instType": "OPTION"})
    except Exception as exc:  # noqa: BLE001 - a refused optional read never fails the derive
        # ccxt error text can carry a request signature: the class name only.
        logger.warning("okx option exposure: venue read failed exc_class=%s", type(exc).__name__)
        return "option_value_unreadable"
    data = response.get("data") if isinstance(response, dict) else None
    if not isinstance(data, list):
        logger.warning("okx option exposure: positions reply has no data list")
        return "option_value_unreadable"
    open_positions = 0
    garbled = 0
    for entry in data:
        pos = _finite_float(entry.get("pos")) if isinstance(entry, dict) else None
        if pos is None:
            garbled += 1
        elif pos != 0.0:
            open_positions += 1
    if open_positions:
        logger.info(
            "okx option exposure: open option positions present (count=%d garbled=%d)",
            open_positions, garbled,
        )
        return "option_value_unverified"
    if garbled:
        logger.warning("okx option exposure: unreadable position entries (count=%d)", garbled)
        return "option_value_unreadable"
    return None


async def read_marked_equity_usd(
    exchange: Any,
    venue: str,
    *,
    supabase: Any = None,
    allocator_id: str | None = None,
    api_key_ids: Sequence[str] | None = None,
) -> tuple[float, float, float] | str:
    """The NAVMTM mark's Bybit/Binance read (Phase 167.2.1.1.1 plans 15 and 18, L4, D-04, D-16, D-17).

    Returns ``(nav_usd, open_pnl_usd, wallet_usd)`` or ONE refusal token from
    ``nav_marks.MARK_REFUSAL_TOKENS``.

    BYBIT (plan 18, D-17 and D-18, amending L4 for Bybit): the Unified Trading Account's own
    totals, through ``_read_bybit_uta_mark`` - ``nav_usd = totalEquity`` (option value included),
    ``open_pnl_usd = totalEquity - totalWalletBalance``, ``wallet_usd = totalWalletBalance`` - with
    NO positions call, refused by name for any account those totals cannot describe (not UTA 2.0,
    isolated margin, borrowing, a missing or non-finite field, a wallet that disagrees with our
    own pricing, an unpriced asset). Calls per key per UTC day: one ``fetch_balance()``, one
    ``/v5/account/info`` read, one ``fetch_ticker("<ASSET>/USDT")`` per held non-stable asset.

    BINANCE (plan 15, L4 as written, verbatim): "Bybit and Binance marked equity is wallet balance
    plus position open profit, read the way the reconstruct anchor reads it, never the derive's
    `walletBalance`-only figure." It calls ``_fetch_current_equity(exchange, venue,
    refuse_unread_positions=True)`` ONCE and does not copy its rule: two readings of one rule drift
    apart, and the stored mark is only the anchor's reading while it is the anchor's own function
    that produced it. ``nav_usd`` is the anchor total, ``wallet_usd`` is the anchor's own all-asset
    wallet total (``_AnchorPartialSet.wallet_total_usd``) and ``open_pnl_usd`` is their
    difference, the summed position ``unrealizedPnl``.

    Binance tokens: a ``ForcedRebuildRefusedError`` (a raised, non-list or page-limit positions
    read, an unreadable open position) is ``positions_unreadable``; no total, or no wallet total,
    is ``balance_error``; a held asset whose ticker read failed (the anchor's partial-unpriced set)
    is ``wallet_unpriced``, unless (review WR-06, founder D-10) the caller passes ``supabase``,
    ``allocator_id`` and ``api_key_ids`` (the key's account group, as the refresh sizes it, WR-07)
    and every such asset is sized from its newest priced
    ``allocator_holdings`` row to a sum under the dust floor (``_drop_binance_dust_unpriced``); an
    asset never priced still refuses. Venue error text never leaves this function: the anchor logs
    the scrubbed text, the token carries none.

    Binance calls per key per UTC day (D-16, accepted by the founder): ``fetch_balance()`` once,
    ``fetch_positions()`` once, and ``fetch_ticker("<ASSET>/USDT")`` once per held asset that is
    neither a stablecoin nor one of the extra stablecoin suffixes. What ``fetch_positions()``
    with no arguments requests was read from the installed ccxt 4.5.85 sources (the pin in
    ``requirements.txt`` is 4.5.88: re-read ``binance.fetch_positions_risk`` when it moves):
    one ``positionRisk`` request for the linear USD-M book (after ``load_markets`` and
    ``load_leverage_brackets`` on a fresh exchange object, which ccxt caches per object).

    BINANCE OPTIONS (plan 19, D-18, D-20, D-22): the European Options account is separate and the
    L4 read does not see it. D-18, verbatim: "each venue's NAV includes open option value or the
    mark is refused by name; option value is never omitted silently." D-20 (founder 2026-10-26,
    "Refuse holders; no-access counts as zero"): after the L4 read on the same key has SUCCEEDED,
    ``_read_binance_options_exposure`` reads ``GET /eapi/v1/marginAccount``
    (https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-options/api/rest-api/account,
    fields documented by name only) and ``GET /eapi/v1/position``
    (https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-options/api/rest-api/trade#option-position-information,
    ``markValue`` per position). Every options asset at zero ``marginBalance`` and ``equity`` with
    no open position keeps the L4 tuple; any non-zero balance or open position is
    ``option_value_unverified``; a read refused with a code in
    ``_BINANCE_OPTIONS_NO_ACCESS_CODES`` is zero option value (one log line naming the parsed
    code); any other error or a garbled shape is ``option_value_unreadable``. An L4 refusal is
    returned as it stands and no options read is made.

    ⛔ I2, the limit of what is proven: the constant holds ``-2015`` until the first post-deploy run
    measures the code a key without options permission really receives. The tests pin only what
    ccxt itself states: in ccxt 4.5.85 and 4.5.88 ``binance().exceptions['exact']['-2015']`` is
    ``AuthenticationError``, the SAME class as ``-2014``, so the class cannot tell options
    no-access from a bad key. The reader therefore recognises no-access by the numeric code parsed
    from the error text, never by the exception class, and no test can prove Binance returns
    ``-2015`` for options access. A different observed code stops plan 11 and goes to the founder.

    Added Binance calls per key per UTC day (amends D-16): one ``/eapi/v1/marginAccount`` and one
    ``/eapi/v1/position`` read, both skipped when the day's mark is already stored.

    Only for Bybit and Binance: OKX reads ``totalEq`` from the equity read the derive makes, plus
    (D-19) the one option-positions read of ``read_okx_option_exposure``; the other venues are not
    ccxt venues here.
    """
    if venue.lower() not in ("bybit", "binance"):
        raise ValueError("read_marked_equity_usd: Bybit and Binance only")
    if venue.lower() == "bybit":
        return await _read_bybit_uta_mark(exchange)
    try:
        total, partial = await _fetch_current_equity(
            exchange, venue, refuse_unread_positions=True,
            supabase=supabase, allocator_id=allocator_id, api_key_ids=api_key_ids,
        )
    except ForcedRebuildRefusedError:
        return "positions_unreadable"
    wallet = getattr(partial, "wallet_total_usd", None)
    if total is None or wallet is None:
        return "balance_error"
    if partial:
        return "wallet_unpriced"
    # Plan 19 (D-18, D-20, D-22): the L4 read does not see the separate European Options account.
    options_refusal = await _read_binance_options_exposure(exchange)
    if options_refusal is not None:
        return options_refusal
    return total, total - wallet, wallet


# ---------------------------------------------------------------------------
# Phase 19 / BACKBONE-06 + BACKBONE-07 — EquityCurveBuilder
# ---------------------------------------------------------------------------
#
# Wraps existing primitives (position_reconstruction.py, funding_fetch.py)
# per ROADMAP REUSE flag. Open perps valued at mark-price. The return-based
# scalars (TWR, YTD, Sharpe, max drawdown) this builder used to compute were
# removed by MARKSOURCE D-03; see the class docstring.
#
# Design notes (verified against the actual primitives 2026-05-08):
# - services.position_reconstruction._match_positions_fifo returns dicts
#   keyed by entry_price_avg / exit_price_avg / size_base / realized_pnl
#   and emits side as "long"/"short" plus opened_at/closed_at as string
#   timestamps. EquityCurveBuilder maps that shape into the
#   services.ingestion.adapter.Position dataclass (entry_price /
#   exit_price / quantity / pnl, datetime fields).
# - Trade.timestamp is a datetime; _match_positions_fifo expects a string
#   timestamp on each fill, so we serialize on the way in.
# - We import _match_positions_fifo via its underscore-prefixed name on
#   purpose (Phase 19 / MC-2 decision: leave private to avoid touching
#   the DB-side tested primitive).

from collections import defaultdict


class EquityCurveBuilder:
    """Phase 19 / BACKBONE-06 + BACKBONE-07.

    Reconstructs positions from raw trades, with mark-price valuation for
    open perpetual positions and funding-rate accumulation, and composes the
    closed-trade totals into a MetricsSnapshot.

    Wraps existing primitives (RESEARCH gotcha L1720 — Option B chosen):
      - position_reconstruction._match_positions_fifo (private; imported
        directly because we don't touch the existing tested DB primitive)
      - services.funding_fetch primitives (8h bucket dedup)
      - services.exchange.fetch_mark_prices(instruments) (60s in-process
        cache)

    MARKSOURCE D-03: the return scalars (TWR, YTD, Sharpe, max drawdown) were
    removed because no reader exists and the backbone owns those metrics. The
    snapshot carries them as None. They also booked every open position's whole
    profit on the last bar as one day's return, which this class no longer does.
    """

    # Synthetic starting NAV used when the caller does not supply one.
    # Daily returns are computed as ``daily_pnl / nav_yesterday`` which
    # demands a finite, non-zero base. 100_000 USDT is a realistic
    # placeholder for a self-reported strategy where capital is unknown
    # (matches the convention in services/metrics.py + analytics_runner.py
    # where starting NAV is implicit). Tests that need an absolute return
    # number can pass starting_nav explicitly.
    DEFAULT_STARTING_NAV: float = 100_000.0

    def __init__(
        self,
        trades: list[Any],  # list[Trade] — annotation kept loose to avoid circular import
        mark_prices: dict[str, float] | None = None,
        starting_nav: float | None = None,
    ) -> None:
        self.trades = sorted(trades, key=lambda t: t.timestamp)
        self.mark_prices = mark_prices or {}
        self.starting_nav = float(
            starting_nav if starting_nav is not None else self.DEFAULT_STARTING_NAV
        )
        self._funding_pnl_by_day: dict[date, float] = {}
        # CR-perf-2 — cache reconstruct_positions output, so a second read of
        # the positions does not fire _match_positions_fifo again.
        self._positions_cache: list[Any] | None = None

    # ------------------------------------------------------------------
    # Position reconstruction (in-memory, not persisted)
    # ------------------------------------------------------------------

    def reconstruct_positions(self) -> "list[Position]":
        """In-memory FIFO matching (NOT persisted to DB).

        Calls existing services.position_reconstruction._match_positions_fifo
        (private — Phase 19 / MC-2 Option B). CR-perf-2 — result cached on
        self._positions_cache.
        """
        if self._positions_cache is not None:
            return self._positions_cache

        from services.ingestion.adapter import Position
        from services.position_reconstruction import _match_positions_fifo

        positions_by_symbol: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for trade in self.trades:
            ts = trade.timestamp
            if isinstance(ts, datetime):
                ts_str = ts.isoformat().replace("+00:00", "Z")
            else:
                ts_str = str(ts)
            positions_by_symbol[trade.symbol].append(
                {
                    "side": trade.side,
                    "price": float(trade.price),
                    "quantity": float(trade.quantity),
                    "fee": float(trade.fee or 0.0),
                    "timestamp": ts_str,
                }
            )

        all_positions: list[dict[str, Any]] = []
        for symbol, fills in positions_by_symbol.items():
            # Explicit decision (review): a corrupt zero/non-finite-entry
            # position dropped by _match_positions_fifo IS surfaced — it emits
            # an unconditional logger.warning. This in-memory equity path has no
            # persisted data_quality_flags channel (unlike the DB-backed
            # reconstruct_positions in position_reconstruction.py), so we
            # deliberately do NOT thread a dropped_flags accumulator here — it
            # would be write-only state that nothing reads.
            matched = _match_positions_fifo(symbol, fills, strategy_id="<in-memory>")
            all_positions.extend(matched)

        # Attach mark prices to open positions (BACKBONE-06).
        # NEW-C01-07: collect symbols whose mark price is missing so we can
        # emit a single warning rather than silently zero-ing unrealized_pnl.
        mark_price_missing_symbols: set[str] = set()
        for pos in all_positions:
            if pos.get("status") == "open":
                sym = pos.get("symbol", "")
                mark = self.mark_prices.get(sym)
                if mark is not None:
                    pos["mark_price"] = float(mark)
                    entry = float(pos.get("entry_price_avg") or 0.0)
                    qty = float(pos.get("size_base") or 0.0)
                    side = pos.get("side")
                    if side == "long":
                        pos["unrealized_pnl"] = (mark - entry) * qty
                    else:
                        pos["unrealized_pnl"] = (entry - mark) * qty
                else:
                    # NEW-C01-07: mark price missing — unrealized_pnl will be
                    # absent/zero, silently understating equity for this position.
                    mark_price_missing_symbols.add(sym)

        if mark_price_missing_symbols:
            logger.warning(
                "EquityCurveBuilder.reconstruct_positions: mark price missing "
                "for %d open position symbol(s) %r — unrealized_pnl will be "
                "absent (equity understated). Supply mark_prices= to fix.",
                len(mark_price_missing_symbols),
                sorted(mark_price_missing_symbols),
            )

        positions_typed = [
            Position(**_position_dict_to_position_kwargs(p)) for p in all_positions
        ]
        self._positions_cache = positions_typed
        return positions_typed

    # ------------------------------------------------------------------
    # Funding-rate accumulation
    # ------------------------------------------------------------------

    def attach_funding(self, funding_rows: list[dict[str, Any]]) -> None:
        """Sum signed funding payments into self._funding_pnl_by_day.

        Each ``funding_row`` shape: ``{timestamp, symbol, payment, ...}``.
        Bucketed by UTC date; 8h cycles (per services/funding_fetch.py)
        are aggregated up to a daily slot for the equity-curve consumer.

        NEW-C30-02: rows whose ``currency`` field is present but not a
        USD-quote stablecoin (e.g. BTC for inverse perps) are skipped with
        a WARNING rather than added at face value, which would produce an
        ~$6 payment being recorded as $0.0001 (magnitude error ~5 orders).
        """
        _USD_QUOTE_CURRENCIES = frozenset(
            {"USDT", "USDC", "BUSD", "USD", "TUSD", "FDUSD"}
        )
        for row in funding_rows or []:
            ts = row.get("timestamp")
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if not isinstance(ts, datetime):
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            d = ts.astimezone(timezone.utc).date()
            # NEW-C30-02: skip base-coin-denominated (inverse perp) rows.
            currency = (row.get("currency") or "").upper()
            if currency and currency not in _USD_QUOTE_CURRENCIES:
                logger.warning(
                    "attach_funding: skipped funding row currency=%r symbol=%r "
                    "— not a USD-quote stablecoin; add currency conversion to "
                    "include inverse-perp funding in the equity curve "
                    "(NEW-C30-02)",
                    currency, row.get("symbol"),
                )
                continue
            payment = row.get("payment", row.get("amount", 0.0))
            try:
                amount = float(payment)
            except (TypeError, ValueError):
                continue
            self._funding_pnl_by_day[d] = (
                self._funding_pnl_by_day.get(d, 0.0) + amount
            )

    # ------------------------------------------------------------------
    # MetricsSnapshot composition
    # ------------------------------------------------------------------

    def to_metrics_snapshot(self) -> "MetricsSnapshot":
        """Compose into a services.ingestion.adapter.MetricsSnapshot.

        The four return scalars are None (MARKSOURCE D-03); total_pnl is the
        closed positions' P&L plus funding, and open profit is not in it.
        """
        from services.ingestion.adapter import MetricsSnapshot

        positions = self.reconstruct_positions()
        closed = [p for p in positions if p.status == "closed"]
        wins = [
            p for p in closed if p.pnl is not None and p.pnl > 0
        ]
        win_rate = (len(wins) / len(closed)) if closed else None
        total_pnl = sum(
            float(p.pnl or 0.0) for p in closed
        ) + sum(self._funding_pnl_by_day.values())

        return MetricsSnapshot(
            sharpe=None,
            twr=None,
            ytd=None,
            max_drawdown=None,
            total_pnl=float(total_pnl),
            trade_count=len(self.trades),
            win_rate=win_rate,
        )


def _position_dict_to_position_kwargs(p: dict[str, Any]) -> dict[str, Any]:
    """Map ``_match_positions_fifo`` output dict → ``Position`` dataclass kwargs.

    ``_match_positions_fifo`` keys (verified):
      strategy_id, symbol, side ("long"/"short"), status ("open"/"closed"),
      entry_price_avg, exit_price_avg, size_base, size_peak, realized_pnl,
      fee_total, roi, duration_days, opened_at (str|None),
      closed_at (str|None), fill_count, funding_pnl, [unrealized_pnl, mark_price]

    ``Position`` fields:
      strategy_id, symbol, side, opened_at (datetime), closed_at (datetime|None),
      entry_price, exit_price, quantity, pnl, funding_pnl, status, roi,
      duration_days
    """
    def _parse_dt(value: object) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    opened_at_dt = _parse_dt(p.get("opened_at")) or datetime.now(timezone.utc)
    closed_at_dt = _parse_dt(p.get("closed_at"))

    pnl_value: float | None
    if p.get("status") == "open":
        pnl_value = p.get("unrealized_pnl")
        if pnl_value is not None:
            pnl_value = float(pnl_value)
    else:
        rp = p.get("realized_pnl")
        pnl_value = float(rp) if rp is not None else None

    return {
        "strategy_id": p.get("strategy_id", "<in-memory>"),
        "symbol": p.get("symbol", ""),
        "side": p.get("side", ""),
        "opened_at": opened_at_dt,
        "closed_at": closed_at_dt,
        "entry_price": float(p.get("entry_price_avg") or 0.0),
        "exit_price": (
            float(p["exit_price_avg"])
            if p.get("exit_price_avg") is not None
            else None
        ),
        "quantity": float(p.get("size_base") or 0.0),
        "pnl": pnl_value,
        "funding_pnl": (
            float(p["funding_pnl"])
            if p.get("funding_pnl") is not None
            else None
        ),
        "status": p.get("status", "closed"),
        "roi": (
            float(p["roi"]) if p.get("roi") is not None else None
        ),
        "duration_days": (
            float(p["duration_days"])
            if p.get("duration_days") is not None
            else None
        ),
    }
