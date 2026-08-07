"""Allocator-side holdings ingestion (Phase 06, INGEST-03 / INGEST-04 / INGEST-05).

Dual-path CCXT fetch: fetch_balance() for spot + fetch_positions() for derivatives
(D-01). Idempotent upsert into allocator_holdings via (allocator_id, venue, symbol,
asof) unique index (INGEST-04).

Key design decisions (from plan 06-02 + VOICES-ACCEPTED.md):

* Spot-only pricing: we make ONE bulk fetch_tickers() call with the list of
  non-stablecoin assets. Stablecoins (USDT/USDC/BUSD/DAI/TUSD/USD) skip the
  ticker entirely with mark_price = 1.0 — lower API cost, no rate-limit bleed
  onto the strategy-side poll_positions for shared exchanges (RESEARCH §1).

* Derivative rows reuse services.positions.fetch_positions — the same shape
  the strategy-side worker produces — so the two pipelines stay aligned.

* Deribit spot is deferred, derivatives render (Phase 71 / DRB-09). Deribit is
  a derivatives-first venue; fetch_balance() on a derivatives-only account
  returns {'total': {}} which would silently emit zero spot rows. So for
  Deribit the spot side returns [] (deferred — no spot path) WITHOUT erroring,
  and the derivative side syncs normally so the allocator sees their Deribit
  positions. (Phase 71 lifted the former f3 Path-B DeribitNotSupportedError,
  which raised before fetch_balance and failed the whole sync — hiding the
  derivatives too.) Deribit spot ingestion (Path A) stays deferred.

* raw_payload cap — JSONB rows in allocator_holdings are capped at ~4KB
  via json.dumps length check; over-cap payloads are replaced with a
  truncated preview so the table stays indexable and a runaway CCXT
  response (huge `info` blob) can't blow up row size.

* Exception → sync_status mapping lives HERE (not in job_worker.py) so the
  handler's error-UX logic is co-located with the worker concern it serves
  and can be unit-tested without importing the whole job_worker stack.

* Venue-capability dispatch (Phase 151 / AUM-02): ``fetch_allocator_holdings``
  branches on the venue STRING before any fetch, mirroring the construction
  chokepoint ``job_worker._make_exchange_client``. See that function's docstring
  for why the decision is made on the venue name and never on ``hasattr`` /
  ``isinstance``.
"""
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

import ccxt.async_support as ccxt
from supabase import Client

from services.closed_sets import NON_CCXT_VENUES, STABLECOINS
from services.db import db_execute
from services.positions import fetch_positions


# B8b: STABLECOINS (the "treat as cash, mark at $1, skip the ticker fetch" set)
# is single-sourced from services.closed_sets so it can't fork from the equity-
# reconstruction copy. This unifies on the canonical set, which additionally
# treats FDUSD as cash here (the local copy historically omitted it) — FDUSD is
# a $1-pegged stablecoin, so marking it at 1.0 is strictly more correct than
# fetching an FDUSD/USDT ticker.
RAW_PAYLOAD_CAP_BYTES: int = 4096  # D-02 / ~4KB JSONB cap


# ---------------------------------------------------------------------------
# AUM-02 — worker-written sync_error copy is END-USER copy.
#
# Anything this module returns as a ``warning`` (or carries in an
# AllocatorHoldingsSyncTransientError) lands in ``api_keys.sync_error`` and is
# rendered VERBATIM in the browser by AllocatorSyncStatus — there is no
# frontend translation layer. So these strings follow the 151-UI-SPEC copy
# class: ONE sentence, "{what happened} — {what happens next or what to do}",
# joined by a U+2014 em dash, no jargon, and NEVER a Python type/method name or
# a raw exception string. The PROD defect this replaces was literally
# "'Mt5Session' object has no attribute 'fetch_balance'" shown to a user.
#
# Venue names render in product casing via _venue_display below. There is
# deliberately NO shared Python EXCHANGE_DISPLAY map to import (151-PATTERNS
# Correction 2 — the TS one has no Python counterpart, and inventing an
# exported one here would be a second source of truth for venue labels).
# ---------------------------------------------------------------------------
UNSUPPORTED_VENUE_NOTE = (
    "Holdings sync isn't supported for {venue} yet — this key was skipped."
)
MT5_NON_USD_NOTE = (
    "MT5 account currency is {ccy} — USD conversion isn't supported yet, so "
    "this account was skipped."
)
MT5_UNREACHABLE_NOTE = "MT5 terminal unreachable — sync will retry automatically."
MT5_MISSING_ACCOUNT_REF_NOTE = (
    "MT5 holdings sync couldn't identify this account — sync will retry "
    "automatically."
)

# Product casing for the two venues this module names in copy. Kept LOCAL and
# private (see the note above): a two-entry display helper, not a registry.
_VENUE_DISPLAY: dict[str, str] = {"mt5": "MT5", "sfox": "sFOX"}


def _venue_display(venue: str) -> str:
    """Render a venue code in product casing for END-USER copy.

    Falls back to title case for a venue with no registered label, so a future
    venue still produces readable copy ("testvenue" → "Testvenue") rather than
    a raw lowercase code.
    """
    return _VENUE_DISPLAY.get(venue, venue.title())


class AllocatorHoldingsSyncTransientError(Exception):
    """A genuine, RETRY-WORTHY venue transport failure during a holdings fetch.

    ``str(self)`` IS end-user copy: the job_worker handler has a DEDICATED
    ``except`` arm for this type that stamps the message verbatim into
    ``api_keys.sync_error`` with ``sync_status='error'`` and
    ``error_kind='transient'`` (so the job retries via the DB backoff).

    It exists so a venue-specific exception (``Mt5ClientError``,
    ``Mt5AccountMismatchError``, a future ``SfoxApiError``) can be converted to
    human copy INSIDE its venue branch and can never reach the handler's generic
    ``except Exception`` arm, whose ``classify_exception`` fall-through stamps
    ``str(exc)`` — the exact arm that put a raw Python AttributeError in front of
    three founder accounts (AUM-02).

    Callers MUST pass a fixed copy constant, never an interpolated exception.
    """


def _extract_bybit_unified_walletbalances(info: dict[str, Any]) -> dict[str, float]:
    """Extract per-coin `walletBalance` from a Bybit V5 unified-account
    `info` payload.

    Bybit Unified Trading Account (UTA) quirk: when an allocator has
    funds locked as derivative collateral, the raw V5 response sets
    `availableToWithdraw: ""` (empty string) on each coin. CCXT's
    `parseBalance` for Bybit can map that empty string to 0 in the
    parsed `total` / `free` dicts — so a user with a $200k USDT margin
    backing their Bybit perp positions sees a zero spot balance after
    CCXT parsing, which silently drops their Bybit collateral from the
    Holdings panel even though the unified account is fully funded.

    The raw V5 payload at
    `info["result"]["list"][N]["coin"][*]["walletBalance"]` is the
    truthful number we want — it's the asset balance the allocator
    actually holds, before unrealised PnL. We extract it directly and
    let the existing pricing path (stablecoin shortcut + fetch_tickers
    for non-stables) value it.

    Returns `{}` on any parse failure (missing keys, non-iterable
    payload, unparseable floats) so the caller can fall through to
    CCXT's parsed `total` dict without crashing the whole sync.
    """
    try:
        accounts = info.get("result", {}).get("list", []) or []
        if not accounts:
            return {}
        # Prefer the UNIFIED account row when multiple are present
        # (sub-account API keys can surface CONTRACT / FUND rows too).
        unified = next(
            (row for row in accounts if row.get("accountType") == "UNIFIED"),
            accounts[0],
        )
        out: dict[str, float] = {}
        for c in unified.get("coin", []) or []:
            symbol = c.get("coin")
            raw_wb = c.get("walletBalance")
            if not symbol or raw_wb in (None, ""):
                continue
            try:
                qty = float(raw_wb)
            except (TypeError, ValueError):
                continue
            if qty > 0:
                out[symbol] = qty
        return out
    except Exception:  # noqa: BLE001
        return {}


def _cap_raw_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Truncate a raw_payload JSON dict to fit the ~4KB JSONB cap.

    If the serialized payload exceeds RAW_PAYLOAD_CAP_BYTES, return a
    replacement dict {'truncated': True, 'preview': str[:3900]} so the
    row still persists and the operator can see the first ~4KB of the
    original in the admin UI. default=str handles Decimal/datetime.
    """
    encoded = json.dumps(payload, default=str)
    if len(encoded) <= RAW_PAYLOAD_CAP_BYTES:
        return payload
    return {"truncated": True, "preview": encoded[:3900]}


def _map_exception_to_sync_status(exc: Exception) -> str:
    """INGEST-05 / D-07: map a CCXT exception to the api_keys.sync_status value.

    Table:
      AuthenticationError / PermissionDenied  → 'revoked'
      RateLimitExceeded                       → 'rate_limited'
      everything else (Network, ExchangeNotAvailable,
        generic Exception, ...)               → 'error'
    """
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"


async def _fetch_spot_rows(exchange_name: str, exchange: Any) -> list[dict[str, Any]]:
    """Build spot allocator_holdings rows from fetch_balance() + bulk fetch_tickers().

    Deribit: spot is deferred (Phase 71). Return [] BEFORE any network call —
    the Unified CCXT shape for Deribit derivatives-only accounts returns
    {'total': {}}, which would silently emit zero spot rows, and Deribit spot
    ingestion (Path A) is out of scope. The derivative side still syncs, so the
    allocator sees their Deribit positions.

    Stablecoin optimization: USDT/USDC/BUSD/DAI/TUSD/USD get mark_price=1.0
    without a ticker call.
    """
    # Deribit — spot deferred (no spot path). Skip gracefully; derivatives sync.
    if getattr(exchange, "id", None) == "deribit":
        return []

    balance = await exchange.fetch_balance()
    totals = balance.get("total") or {}

    # Bybit Unified Trading Account fallback (2026-05-20): for UTA users
    # whose funds are locked as derivative collateral, CCXT's parsed
    # `total` dict can be empty/zero because the V5 payload sets
    # `availableToWithdraw: ""`. Read the raw `walletBalance` per coin
    # from `info` and merge it OVER CCXT's parsed totals so the actual
    # collateral surfaces as a spot holding. Without this, an allocator
    # with $200k USDT backing their Bybit perp positions sees zero
    # Bybit spot rows in the Holdings panel even though the unified
    # account is fully funded.
    if getattr(exchange, "id", None) == "bybit":
        raw_wbs = _extract_bybit_unified_walletbalances(balance.get("info") or {})
        if raw_wbs:
            # Merge: raw walletBalance wins when CCXT's parsed total is
            # 0 / missing, but never drops a non-zero CCXT total (defensive
            # against shape drift in either direction).
            merged = dict(totals)
            for asset, qty in raw_wbs.items():
                existing = merged.get(asset)
                if existing is None or float(existing or 0) <= 0:
                    merged[asset] = qty
            totals = merged

    non_zero = {
        asset: float(qty)
        for asset, qty in totals.items()
        if qty is not None and float(qty) > 0
    }
    if not non_zero:
        return []

    # Bulk ticker fetch for non-stablecoin assets only.
    need_tickers = [
        f"{asset}/USDT" for asset in non_zero
        if asset.upper() not in STABLECOINS
    ]
    tickers: dict[str, dict[str, Any]] = {}
    if need_tickers:
        try:
            tickers = await exchange.fetch_tickers(need_tickers) or {}
        except Exception:
            # Per-symbol fallback if bulk fails (some exchanges don't
            # accept a symbol list). Best effort — if a single ticker
            # still fails, we mark the price 0 rather than abort spot.
            tickers = {}
            for sym in need_tickers:
                try:
                    tickers[sym] = await exchange.fetch_ticker(sym)
                except Exception:
                    tickers[sym] = {"last": 0.0}

    rows: list[dict[str, Any]] = []
    for asset, qty in non_zero.items():
        asset_upper = asset.upper()
        if asset_upper in STABLECOINS:
            mark_price = 1.0
        else:
            t = tickers.get(f"{asset}/USDT") or {}
            mark_price = float(t.get("last") or 0.0)
        rows.append({
            "venue": exchange_name,
            "symbol": asset,              # D-16: raw currency code, no suffix
            "holding_type": "spot",
            "side": "flat",
            "quantity": float(qty),
            "value_usd": float(qty) * mark_price,
            "entry_price": None,           # D-06: spot has no basis from the worker
            "mark_price": mark_price,
            "unrealized_pnl_usd": None,
            "cost_basis_usd": None,
            "raw_payload": _cap_raw_payload({
                "asset": asset,
                "total": float(qty),
                "mark_price": mark_price,
            }),
        })
    return rows


async def _fetch_derivative_rows(exchange_name: str, exchange: Any) -> list[dict[str, Any]]:
    """Build derivative allocator_holdings rows by reusing positions.fetch_positions.

    Remaps the strategy-side snapshot shape to the allocator_holdings
    column list (D-01 / D-05). Deribit derivative path IS supported (Phase 71,
    inverse contracts normalized in positions._normalize_deribit_position);
    only the spot side is deferred.
    """
    snapshots = await fetch_positions(exchange_name, exchange)
    rows: list[dict[str, Any]] = []
    for s in snapshots:
        qty = float(s.get("size_base") or 0)
        entry_raw = s.get("entry_price")
        entry = float(entry_raw) if entry_raw is not None else None
        if entry == 0:
            entry = None
        cost_basis = (entry * abs(qty)) if entry is not None else None
        rows.append({
            "venue": exchange_name,
            "symbol": s["symbol"],          # already stripped by _normalize_ccxt_position (D-16)
            "holding_type": "derivative",
            "side": s["side"],
            "quantity": qty,
            "value_usd": float(s.get("size_usd") or 0),
            "entry_price": entry,
            "mark_price": float(s.get("mark_price") or 0),
            "unrealized_pnl_usd": float(s.get("unrealized_pnl") or 0),
            "cost_basis_usd": cost_basis,
            "raw_payload": _cap_raw_payload(s),
        })
    return rows


# The signature every non-ccxt holdings fetcher implements. It mirrors
# fetch_allocator_holdings' own contract — ``(rows, warning)`` — so a venue
# branch can emit rows, an honest skip, or (by raising
# AllocatorHoldingsSyncTransientError) a human-copy retry.
_NonCcxtHoldingsFetcher = Callable[
    [str, Any, str | None], Awaitable[tuple[list[dict[str, Any]], str | None]]
]

# AUM-02 — the venue → holdings-fetcher table. Keyed on the venue STRING,
# mirroring job_worker._make_exchange_client (the construction chokepoint this
# is the consumer half of). A venue in NON_CCXT_VENUES but absent HERE is an
# honest SKIP, never a crash — that gap is the whole class fix. Plan 151-04
# registers "sfox".
_NON_CCXT_HOLDINGS_FETCHERS: dict[str, _NonCcxtHoldingsFetcher] = {}


async def fetch_allocator_holdings(
    exchange_name: str, exchange: Any, api_key_id: str | None = None
) -> tuple[list[dict[str, Any]], str | None]:
    """D-01 + AUM-02: the ONE holdings chokepoint — dispatch, then fetch.

    The sfox-vs-mt5-vs-ccxt HOLDINGS decision lives in exactly ONE place: here.
    (Its construction counterpart is ``job_worker._make_exchange_client``; the
    two must stay in lockstep via ``closed_sets.NON_CCXT_VENUES``.) Dispatch is
    on the venue STRING — never ``isinstance``/``hasattr``, because a duck-typed
    probe silently re-opens this bug class the moment a future client grows a
    same-named method with different semantics, and because the venue name is
    already in hand at the only call site (``ctx.key_row["exchange"]``).

    ``api_key_id`` is threaded through for account-level venues, whose row needs
    an account-scoped ``symbol`` token: ``allocator_holdings`` is UNIQUE on
    (allocator_id, venue, symbol, asof) with NO api_key_id in the key, so two
    accounts on one venue writing the same symbol would upsert over each other
    and AUM would silently reflect one of them.

    Returns ``(rows, warning)`` where ``warning`` is None on full success and a
    string otherwise. The handler maps a non-None warning to
    sync_status='complete_with_warnings' and writes it to
    ``api_keys.sync_error`` — which the UI renders VERBATIM, so every warning
    this function returns must be end-user copy.

    On auth / rate-limit failures the ccxt path re-raises so the handler can map
    to sync_status ('revoked' / 'rate_limited' / 'error') per D-07. Deribit
    completes normally: spot returns [] (deferred) and derivatives render
    (Phase 71).
    """
    # ── AUM-02 venue dispatch (supersedes the MT5SYNC-01 hotfix no-op) ───────
    # MT5SYNC-01 (hotfix PR #667, 2026-08-06) stopgapped the PROD crash with an
    # isinstance(Mt5Session) no-op returning ([], None), on the reasoning that
    # holdings ingestion had no MT5 analog and that a live read here would sit
    # outside the derive path's lock discipline. Phase 151 supersedes BOTH
    # premises: there IS an analog (account_info().equity is exactly the
    # account-level USD anchor an allocator's book needs — and without it three
    # funded MT5 accounts contribute ZERO to AUM), and the terminal lock is now
    # importable from the leaf ``services.mt5_concurrency`` (plan 151-01), so a
    # holdings read shares the ONE registry the derive job serializes on. The
    # hotfix's real achievement — never let a raw AttributeError reach
    # sync_error — is preserved and generalized here: an unregistered non-ccxt
    # venue skips with END-USER copy instead of no-op-completing silently.
    fetcher = _NON_CCXT_HOLDINGS_FETCHERS.get(exchange_name)
    if fetcher is not None:
        return await fetcher(exchange_name, exchange, api_key_id)
    if exchange_name in NON_CCXT_VENUES:
        # Buildable by _make_exchange_client, but no holdings fetcher yet: skip
        # HONESTLY through the existing warning channel (zero new plumbing —
        # the handler already maps a warning to complete_with_warnings). NOTE:
        # a skip still reaches DONE, so `stamp_first_sync_success` fires for a
        # key that synced nothing. Conscious, accepted call: that RPC only gates
        # a one-shot PostHog onboarding event, and treating an honest skip as a
        # failure would be worse UX than a slightly early onboarding ping.
        return ([], UNSUPPORTED_VENUE_NOTE.format(venue=_venue_display(exchange_name)))

    spot_rows: list[dict[str, Any]] = []
    deriv_rows: list[dict[str, Any]] = []
    warning: str | None = None

    # Spot side — any failure (including Deribit Path B) re-raises to
    # the handler; partial success only applies to the derivative side.
    spot_rows = await _fetch_spot_rows(exchange_name, exchange)

    try:
        deriv_rows = await _fetch_derivative_rows(exchange_name, exchange)
    except (
        ccxt.AuthenticationError,
        ccxt.PermissionDenied,
        ccxt.RateLimitExceeded,
    ):
        raise
    except Exception as exc:  # noqa: BLE001
        # Partial success: persist spot, surface the derivative-side error
        # as sync_status='complete_with_warnings' via the handler.
        warning = str(exc)[:500]

    return (spot_rows + deriv_rows, warning)


async def persist_allocator_holdings(
    supabase_client: Client,
    holdings: list[dict[str, Any]],
    allocator_id: str,
    api_key_id: str,
    asof_date: str,
) -> int:
    """INGEST-04: idempotent upsert on (allocator_id, venue, symbol, asof).

    Stamps allocator_id / api_key_id / asof onto every row before the
    upsert so a caller can pass either the raw fetch_allocator_holdings
    output or a pre-stamped list. Re-running with identical input
    produces identical rows because the DB unique index + ON CONFLICT
    DO UPDATE converges.
    """
    if not holdings:
        return 0

    rows = [
        {
            **h,
            "allocator_id": allocator_id,
            "api_key_id": api_key_id,
            "asof": asof_date,
        }
        for h in holdings
    ]

    def _upsert() -> None:
        supabase_client.table("allocator_holdings").upsert(
            rows,
            on_conflict="allocator_id,venue,symbol,asof",
        ).execute()

    await db_execute(_upsert)
    return len(rows)
