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
  and can be unit-tested without importing the whole job_worker stack. Retry
  DISPOSITION (permanent vs retryable) is the opposite: it belongs to
  ``job_worker.classify_exception`` and is consulted there at call time via
  ``_must_reach_handler_unwrapped`` — never re-listed here, because the two
  classifiers cover different sets and a hand-copied list silently drifts.
  The USER-VISIBLE half of the same decision is ``sync_error_copy``, which the
  handler's failure arms call at the write: the column's text is derived from
  the sync_status, never from the exception that produced it.

* Venue-capability dispatch (Phase 151 / AUM-02): ``fetch_allocator_holdings``
  branches on the venue STRING before any fetch, mirroring the construction
  chokepoint ``job_worker._make_exchange_client``. See that function's docstring
  for why the decision is made on the venue name and never on ``hasattr`` /
  ``isinstance``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from typing import Any, Awaitable, Callable, cast

import ccxt.async_support as ccxt
from supabase import Client

from services.closed_sets import (
    MT5_DISABLED_DETAIL,
    NON_CCXT_VENUES,
    SFOX_DISABLED_DETAIL,
    STABLECOINS,
    mt5_enabled_server,
    sfox_enabled_server,
)
from services.db import db_execute
from services.mt5_client import (
    Mt5AccountMismatchError,
    Mt5ClientError,
    Mt5SessionAbandoned,
    Mt5Session,
)
# MT5CONC-02 — the ONE terminal-lock registry, imported from the leaf module
# plan 151-01 extracted it into. NEVER re-declare a terminal-lock dict here: a
# second registry hands out perfectly functional Locks while the derive job and
# this holdings read hold DIFFERENT ones for the same Wine terminal, so both
# enter its IPC region concurrently and every lock "works" (151-RESEARCH
# Pitfall 2). `_MT5_DERIVE_READ_TIMEOUT_S` is deliberately REUSED rather than
# given its own env knob: the holdings read (login → account_info) is strictly
# shorter than the derive read that bound was sized for, and a second knob
# would be a second thing to retune when the rpyc bound moves.
# ⚠️ 151 review E2, re-cut by WIZFORM-ABANDON / plan 153.5-03: a monkeypatch on
# THIS module only binds what THIS module reads. Since the holdings acquisition
# moved to `mt5_terminal_lease` (D-36 — only the lease has a release hook to bump
# the abandoned-session epoch from), `_mt5_terminal_lock_for` is a RE-EXPORT here
# that nothing in this file reads: the lease resolves it from
# `services.mt5_concurrency`, so a test that wants to intercept the LOCK must
# patch THAT module. The name is kept in the import because the ONE-registry
# identity pins (tests/test_mt5_concurrency.py, tests/test_allocator_positions_
# non_ccxt.py) assert it through this module's binding.
from services.mt5_concurrency import (
    _MT5_DERIVE_READ_TIMEOUT_S,
    _mt5_bounded_restart,
    _mt5_terminal_lock_for,
    mt5_terminal_lease,
)
from services.positions import fetch_positions
from services.sfox_client import (
    SFOX_DEFAULT_RATE_INTERVAL_S,
    SFOX_REQUEST_TIMEOUT_S,
    SfoxApiError,
    SfoxClient,
)


logger = logging.getLogger("quantalyze.analytics.allocator_positions")

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
# Review [1] — a flat/negative MT5 account is a MEASURED state, and one the
# allocator should be told about: their book just lost this account's balance.
MT5_NON_POSITIVE_EQUITY_NOTE = (
    "This MT5 account's equity is zero or negative — it's counted as $0 in "
    "your book."
)
SFOX_FETCH_FAILED_NOTE = (
    "Couldn't fetch balances from sFOX — sync will retry automatically."
)
SFOX_UNPRICED_ASSETS_NOTE = (
    "sFOX balances in {assets} can't be valued in USD yet — those balances "
    "were skipped."
)
# 151 review WR-03 — how many asset codes the note may NAME before it switches
# to "and N more". The point is the SENTENCE, not the inventory: the copy lands
# in a user-visible column rendered verbatim, and the asset codes come from the
# venue, so an unbounded join is both unreadable and a storage-poison surface.
_SFOX_MAX_NAMED_ASSETS = 6
# 151 review CR-03 — the ccxt DERIVATIVE arm's end-user copy. Before this the
# arm stamped ``str(exc)[:500]`` straight into api_keys.sync_error, which
# AllocatorSyncStatus renders VERBATIM: a KeyError/TypeError/ccxt parse failure
# inside fetch_positions reached the allocator as raw Python text. That is the
# very defect class this module's AUM-02 invariant above declares impossible,
# still live for binance/bybit/okx/deribit.
#
# SCOPE OF THIS CONSTANT, stated precisely (the earlier wording — "the exception
# text now lives ONLY in the log / Sentry chain" — was a claim about the WHOLE
# path, and this constant cannot make it): it covers the RETRYABLE derivative
# failure, the one case this arm turns into partial success. A failure the
# classifier calls PERMANENT is re-raised unwrapped (see
# ``_must_reach_handler_unwrapped``) and never reaches this line at all. What
# keeps THAT case's exception text out of the user-visible column is
# ``sync_error_copy`` below, at the write boundary in the handler — not this
# constant.
DERIVATIVE_FETCH_FAILED_NOTE = (
    "Couldn't read open positions from {venue} — spot balances synced and "
    "positions will retry automatically."
)
# 151 review E1 — the ccxt SPOT arm's end-user copy, the sibling
# DERIVATIVE_FETCH_FAILED_NOTE above was given and this arm was not. The spot
# fetch sat OUTSIDE any try: a malformed venue payload (KeyError('total'), a
# TypeError inside the ticker merge, any ccxt parse failure) propagated to the
# handler's generic ``except Exception``, whose ``classify_exception``
# fall-through stamps ``str(exc)[:500]`` into api_keys.sync_error — rendered
# VERBATIM by AllocatorSyncStatus. Same defect, same class, still live for
# binance/bybit/okx/deribit. Same scope caveat as the derivative note above: this
# constant covers the RETRYABLE spot failure only; a PERMANENT one is re-raised
# unwrapped and is kept out of the user-visible column by ``sync_error_copy``
# below. The spot side still FAILS the sync (partial success is a
# derivative-side-only contract), it just fails in English.
SPOT_FETCH_FAILED_NOTE = (
    "Couldn't read balances from {venue} — sync will retry automatically."
)

# Product casing for the venues this module names in copy. Kept LOCAL and
# private (see the note above): a small display helper, not a registry. Only
# codes whose product casing differs from ``.title()`` need an entry — "binance"
# / "bybit" / "deribit" render correctly from the fallback.
_VENUE_DISPLAY: dict[str, str] = {"mt5": "MT5", "sfox": "sFOX", "okx": "OKX"}


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


def _must_reach_handler_unwrapped(exc: Exception) -> bool:
    """True when ``exc`` must reach the job_worker handler AS ITSELF, i.e. must
    NOT be converted into ``AllocatorHoldingsSyncTransientError`` copy.

    Two, and only two, reasons:

    1. **``job_worker.classify_exception`` calls it PERMANENT.** That function
       — not this module, and not ``_map_exception_to_sync_status`` below — is
       THE AUTHORITY on retry disposition, so it is CONSULTED here rather than
       mirrored. A hand-copied allow-list is what broke this: the first version
       of the wrapper listed the three types ``_map_exception_to_sync_status``
       names, which is a DIFFERENT classifier with a different set, so two
       permanent failures were downgraded to transient — an egress GEO-BLOCK
       (``is_geo_blocked`` intercepts it before the ccxt hierarchy, and Binance
       delivers it as ``ExchangeNotAvailable``, outside any ccxt allow-list)
       and ``ccxt.BadRequest``. Downgrading either buys the full 30s→6h retry
       ladder plus the daily cron re-enqueue against a host that will never
       answer, under the copy "sync will retry automatically" — a promise that
       cannot be kept. The handler's transient arm hardcodes
       ``error_kind='transient'`` and never re-reads the ``__cause__`` chain,
       so a downgrade here is FINAL.
    2. **``ccxt.RateLimitExceeded``**, which the classifier calls transient but
       the handler has a DEDICATED arm for (``_stamp_429`` + the per-exchange
       cooldown shared with strategy-side ``poll_positions``). Swallowing it
       would skip the stamp entirely.

    ``services.job_worker`` is imported INSIDE the function, mirroring the way
    job_worker imports this module: the import graph stays acyclic and this
    module still imports (and unit-tests) without the worker stack. A failure
    to classify — including a rogue ``__str__`` raising inside the classifier —
    returns False, so the caller falls back to fixed end-user copy. Losing the
    diagnosis to the log is strictly better than losing the copy guarantee.
    """
    if isinstance(exc, ccxt.RateLimitExceeded):
        return True
    try:
        from services.job_worker import classify_exception

        kind, _ = classify_exception(exc)
    except Exception:  # noqa: BLE001 - never let classification break the copy path
        logger.warning(
            "fetch_allocator_holdings: could not classify %s — treating it as "
            "retryable and surfacing end-user copy",
            type(exc).__name__,
            exc_info=True,
        )
        return False
    return kind == "permanent"


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


# ---------------------------------------------------------------------------
# AUM-02 — the sync_error WRITE-BOUNDARY copy.
#
# Converting each venue exception to copy inside its own branch (above) is
# necessary but NOT sufficient, and the gap is what re-opened this defect:
# ``fetch_allocator_holdings`` deliberately re-raises anything
# ``classify_exception`` calls PERMANENT (``_must_reach_handler_unwrapped``) so
# the retry disposition survives — and that exception lands in
# ``run_poll_allocator_positions_job``'s generic ``except Exception``, whose
# ``classify_exception`` fall-through returns ``str(exc)[:500]``. Written into
# ``api_keys.sync_error`` that is raw Python (or venue JSON) in front of a user:
# ``binance {"code":-1121,"msg":"Invalid symbol."}``.
#
# The fix is at the WRITE, not in the raise. The handler's failure arms derive
# the column's text from the ``sync_status`` they are about to write and from
# the venue — the two things they legitimately know — so there is no parameter
# through which an exception string can travel. Structural on purpose: the
# alternative (another list of exception types kept in step by hand) is exactly
# how the regression this replaces happened. The diagnosis is NOT lost: the
# classifier's sanitized text still goes to ``compute_jobs.last_error`` via
# DispatchResult, to the ``allocator.holdings.sync_failed`` audit metadata, and
# to the log / Sentry chain — all operator surfaces, none of them rendered to
# the key's owner.
#
# Keys are the ``_map_exception_to_sync_status`` outputs; an unknown status
# falls back to the generic 'error' sentence rather than raising, because a
# KeyError here would abort the very write that clears the UI's 'syncing'
# spinner.
# ---------------------------------------------------------------------------
SYNC_ERROR_COPY_BY_STATUS: dict[str, str] = {
    "revoked": (
        "{venue} rejected these API credentials — reconnect the key to resume "
        "syncing."
    ),
    "rate_limited": (
        "{venue} is rate-limiting us — sync will retry automatically."
    ),
    # Deliberately promises nothing about retrying: this arm covers both a
    # permanent failure (the job will NOT retry) and a retryable one, and the
    # one thing true in both is what the allocator is looking at right now.
    "error": (
        "Couldn't sync holdings from {venue} — the balances shown are from the "
        "last successful sync."
    ),
}


def sync_error_copy(sync_status: str, venue: str) -> str:
    """The ONLY value a worker FAILURE arm may write to ``api_keys.sync_error``.

    Takes a sync_status and a venue — never an exception, and never a string
    derived from one. See the block comment above for why the guarantee is made
    by the signature rather than by vetting what callers pass.
    """
    template = SYNC_ERROR_COPY_BY_STATUS.get(
        sync_status, SYNC_ERROR_COPY_BY_STATUS["error"]
    )
    return template.format(venue=_venue_display(venue))


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


# A plain currency CODE and nothing else. The currency arrives from the broker's
# terminal and is interpolated into MT5_NON_USD_NOTE — i.e. into
# ``api_keys.sync_error``, which the browser renders VERBATIM. Anything that is
# not a bare alphabetic code renders as "unknown" rather than being echoed
# (T-151-05 / ASVS V7): the copy channel is not a place to pass through
# third-party text.
_CURRENCY_CODE_RE = re.compile(r"[A-Za-z]{2,10}")

# The account-scoped ``symbol`` token must satisfy the commit route's
# HOLDING_REF_RE alphabet (route.ts:81) because holdings fingerprints are
# ``symbol:venue:holding_type`` — a colon/slash/space in the token would break
# the ref parse far downstream, long after this write.
_HOLDING_SYMBOL_RE = re.compile(r"[A-Za-z0-9_-]+")


async def _fetch_mt5_account_rows(
    exchange_name: str, exchange: Any, api_key_id: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    """AUM-02 — ONE account-equity holdings row for an MT5 account.

    MT5 has no per-asset holdings to enumerate: the read-only gateway facade
    exposes no open-positions read, and the economically meaningful figure is
    ``account_info().equity`` — balance PLUS the floating uPnL of open
    positions, i.e. the account's mark-to-market value. That single number is
    exactly what an allocator's book needs from this venue, so this branch
    emits exactly one row for it. Using ``balance`` instead would silently drop
    open-position P&L from AUM.

    Mirrors the derive arm's terminal discipline (``job_worker``'s mt5 branch)
    minus the deal ledger: kill switch → shared per-terminal lock → bounded
    off-loop read → login bracket → fail-loud extraction.

    LOGIN BRACKET — PRE only, deliberately. The derive arm brackets pre AND
    post because it does a second economic read (``history_deals_get``) after
    the first assertion, so the account could change between them. Here there
    is exactly ONE economic read, and the login assertion is made on the very
    same ``account_info`` payload that supplies the equity — a mid-read account
    switch therefore cannot produce a wrong-account figure. A POST re-read would
    add a second terminal round-trip and a second failure mode for no additional
    guarantee.

    Raises ``AllocatorHoldingsSyncTransientError`` (str = end-user copy) on any
    genuine transport / trust failure, so the handler retries and no
    venue-specific exception can reach ``classify_exception``'s ``str(exc)``.
    """
    # (a) Kill switch FIRST — the derive arm's exact posture, so turning
    # MT5_ENABLED off during an incident stops live terminal READS on this path
    # too. Routed through the honest-skip channel rather than an error: the
    # founder disabled it deliberately, and "not available yet" is the truthful
    # thing to tell the user.
    #
    # 151 review WR-08 — WHAT THIS GATE ACTUALLY STOPS, stated precisely because
    # an operator makes an incident decision on it. By the time this runs,
    # `_allocator_key_preflight` has already decrypted the credentials and built
    # the client through `job_worker._make_exchange_client` →
    # `_make_mt5_session` → `Mt5Client(...)`, whose `__init__` opens the RPyC
    # transport to the gateway. So flipping MT5_ENABLED off stops every
    # login / account_info / deal read against the terminal — the operations
    # that touch the broker — but NOT the transport connect the preflight
    # already made. (The derive arm at `job_worker`'s mt5 branch has the same
    # shape.) Making "no connect while disabled" true would mean gating at the
    # CONSTRUCTION chokepoint `_make_exchange_client`, which each caller's
    # disabled-path semantics would have to be taught to expect: the holdings
    # arm's honest skip here and the derive arm's permanent-fail DispatchResult
    # both currently depend on a session existing. Deliberately not done in a
    # review fix pass; logged rather than half-built.
    if not mt5_enabled_server():
        return ([], MT5_DISABLED_DETAIL)

    # The row needs an account-scoped symbol; without the key id there is no
    # safe token to write (see the symbol note below). Defensive only —
    # api_keys.id is NOT NULL and the handler always passes it.
    if not api_key_id:
        raise AllocatorHoldingsSyncTransientError(MT5_MISSING_ACCOUNT_REF_NOTE)

    # venue == "mt5" ⇒ the preflight built an Mt5Session. cast() narrows the
    # ccxt.Exchange | SfoxClient | Mt5Session union for mypy --strict, which is
    # why there is no silencing comment here — and note this is a TYPE
    # assertion derived from the venue string, not a runtime isinstance
    # dispatch.
    session = cast(Mt5Session, exchange)

    def _assert_expected_login(info: dict[str, Any]) -> None:
        # MT5CONC-02: the live terminal's account MUST be this key's account.
        # STRICT equality — a MISSING "login" field (info.get → None) FAILS
        # LOUD rather than default-matching, because a terminal that cannot
        # say which account it is on is exactly the case where a wrong-account
        # equity figure would slip into someone's AUM.
        actual_login = info.get("login")
        if actual_login != session.login:
            raise Mt5AccountMismatchError(session.login, actual_login)

    def _mt5_read() -> dict[str, Any]:
        # Blocking RPyC — runs OFF the event loop via to_thread below.
        session.client.login(
            session.login, session.investor_password, session.server
        )
        info = session.client.account_info()  # None → typed raise, never {}
        _assert_expected_login(info)
        return info

    # MT5CONC-02 / WEDGE-01: serialize the ENTIRE terminal-IPC region — the
    # bounded read AND the restart each except arm performs — on the ONE shared
    # per-terminal lock, so this job kind can never interleave with the derive
    # job against the same Wine terminal. The post-read work (currency gate,
    # extraction, row build) stays OUTSIDE the lock: it is pure computation and
    # holding the terminal through it would serialize work that needs no
    # terminal.
    #
    # WIZFORM-ABANDON / D-36 — acquired through the LEASE, not the raw Lock: the
    # lease's `finally` is the ONE release hook, and it is what BUMPS THE TERMINAL
    # EPOCH so a `to_thread` body that outlived the `wait_for` below is refused
    # rather than driving the next holder's terminal. `wait_s` is deliberately
    # omitted (= unbounded acquire, byte-equivalent to the raw
    # `await lock.acquire()` this replaced): ⛔ the bounded arm's
    # `Mt5TerminalBusyError` is the INTERACTIVE validate path's contract (D-29),
    # never this batch poll's — refusing to wait here would drop an allocator's
    # holdings row whenever the derive job happened to hold the terminal.
    async with mt5_terminal_lease(session.client.terminal_key):
        try:
            info = await asyncio.wait_for(
                asyncio.to_thread(_mt5_read), timeout=_MT5_DERIVE_READ_TIMEOUT_S
            )
        except asyncio.TimeoutError as exc:
            # A blocked RPyC/Wine pipe does NOT self-unblock, so actively (and
            # boundedly) restart the terminal before the transient, or every
            # retry inherits the same wedge and burns to failed_final.
            logger.warning(
                "poll_allocator_positions: mt5 holdings read exceeded its "
                "wall-clock bound — classified transient, restarting the "
                "terminal (FLIPRETRY-01 / MT5CONC-01)"
            )
            await _mt5_bounded_restart(session.client)
            raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
        except Mt5SessionAbandoned as exc:
            # ⭐ WIZFORM-ABANDON / D-40. `Mt5SessionAbandoned` is a plain
            # `Exception` (D-42), so it matches none of the three sibling arms
            # here; without this one it left `fetch_allocator_holdings` as a raw
            # type the caller's dedicated `AllocatorHoldingsSyncTransientError`
            # arm cannot see — which is how a fault whose user copy is a FIXED
            # constant ends up as `str(exc)` in an allocator's `sync_error`.
            #
            # ⚠️ On the genuinely abandoned path nobody awaits this read, so the
            # raise reaches no one and this arm never runs (D-39). It exists for
            # the FALSE-POSITIVE path: a legitimate read refused by the fence
            # must be retried and must never be dressed as the allocator's fault.
            #
            # ⛔ NO `_mt5_bounded_restart`, unlike the two arms around it. Those
            # heal a pipe that is OURS and wedged; a fence refusal means the
            # terminal was handed on, so a restart here would fire the one
            # permitted `mt5.shutdown()` on the NEXT holder's session — the
            # -10004 cross-holder outage this phase closes.
            logger.warning(
                "poll_allocator_positions: mt5 holdings read was refused by the "
                "abandoned-session fence — classified transient, retrying; NOT "
                "restarting, because another holder owns the hardware now "
                "(WIZFORM-ABANDON / D-40)"
            )
            raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
        except Mt5AccountMismatchError as exc:
            # A mis-routed / stale terminal is an INFRA fault, never user blame:
            # nothing is returned, nothing is persisted, and the restart heals
            # exactly the stale pipe that causes it. The mismatch detail (two
            # int logins) reaches the log and the exception chain, never the
            # user-visible copy.
            logger.warning(
                "poll_allocator_positions: mt5 login bracket rejected a "
                "mismatched terminal account (%s) — classified transient, "
                "restarting the terminal; NO row emitted (MT5CONC-02)",
                str(exc),
            )
            await _mt5_bounded_restart(session.client)
            raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
        except Mt5ClientError as exc:
            # The key already validated at connect, so a read-time client error
            # is a transport/terminal condition, not a credential verdict:
            # retry. Its text is already secret-scrubbed at construction, but it
            # is still INTERNAL text — only the fixed copy constant is surfaced.
            logger.warning(
                "poll_allocator_positions: mt5 holdings read hit a client "
                "error — classified transient, retrying"
            )
            raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc

    # (f) Currency gate — [A3] fail-loud. An account denominated in anything but
    # USD cannot be valued here without an FX rate we do not have, and silently
    # treating it as USD IS a fabricated rate of 1.0 inside an AUM total. We
    # never guess the denomination.
    #
    # 151 specialist F-2 — but "the terminal reported no currency at all" and
    # "the terminal reported a currency that is not USD" are DIFFERENT
    # conditions and were being collapsed into one, with no log on either arm:
    #
    #   • ABSENT / blank field  → PAYLOAD DEGRADATION, exactly like a missing
    #     `equity` below, and it belongs on the same TRANSIENT posture. Pre-fix
    #     a terminal glitch that dropped only this field from an otherwise
    #     healthy USD account produced the copy "MT5 account currency is unknown
    #     — USD conversion isn't supported yet", which blames a product FX
    #     limitation and implies no retry will ever help, while the sync stamped
    #     `complete_with_warnings` (a HEALTHY-looking state) and the account
    #     contributed $0 to AUM. The next sync would very likely have succeeded.
    #   • PRESENT but not a bare code (garbled / hostile) → still an honest skip
    #     under the "unknown" copy: the terminal DID report a denomination, we
    #     just cannot parse it, and the raw text must never be echoed into
    #     `api_keys.sync_error` (T-151-05 / ASVS V7).
    #   • PRESENT, well-formed, non-USD → the genuine, honest FX skip.
    #
    # Every arm now logs. Pre-fix the currency arms were the ONLY refusals in
    # this function with no logger call, so a fleet-wide gateway regression that
    # dropped the field would have shown ZERO log/Sentry signal — the only
    # evidence being per-user copy in `api_keys.sync_error`.
    raw_ccy = info.get("currency")
    reported_ccy = raw_ccy.strip() if isinstance(raw_ccy, str) else ""
    if reported_ccy == "":
        logger.warning(
            "poll_allocator_positions: mt5 account_info reported no currency "
            "(absent/blank) — payload degradation, classified transient "
            "(NOT an FX-support gap)"
        )
        raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)
    ccy = reported_ccy.upper()
    if not _CURRENCY_CODE_RE.fullmatch(ccy):
        # Bounded, non-echoing diagnostic: enough to recognise a gateway-wide
        # shape regression, never the raw string in full.
        logger.warning(
            "poll_allocator_positions: mt5 account currency is not a bare "
            "code (%d chars, starts %r) — honest skip as 'unknown'",
            len(reported_ccy),
            reported_ccy[:8],
        )
        return ([], MT5_NON_USD_NOTE.format(ccy="unknown"))
    if ccy != "USD":
        logger.info(
            "poll_allocator_positions: mt5 account denominated in %s — honest "
            "skip (no FX rate available)",
            ccy,
        )
        return ([], MT5_NON_USD_NOTE.format(ccy=ccy))

    # (g) Extraction with the derive arm's fail-loud discipline: a NaN/Inf or
    # non-numeric equity would sail past every downstream denominator guard as a
    # silently poisoned AUM figure. Refuse the anchor rather than publish it.
    #
    # 151 review WR-02 — fail loud on EQUITY only. `balance` is DIAGNOSTIC: it
    # appears nowhere but `raw_payload` below, and nothing economic reads it.
    # Extracting it in the same fail-loud breath meant a broker/terminal whose
    # account_info() omits it (or returns it non-numeric) raised a transient, so
    # the allocator saw "MT5 terminal unreachable" forever and the account
    # contributed ZERO to AUM — even though the one figure this branch needs was
    # present and healthy. An absent diagnostic must never veto a real anchor.
    try:
        equity = float(info["equity"])
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "poll_allocator_positions: mt5 account_info missing/non-numeric "
            "equity — refusing to emit a row"
        )
        raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
    if not math.isfinite(equity):
        logger.warning(
            "poll_allocator_positions: mt5 equity non-finite — refusing a "
            "poisoned anchor"
        )
        raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)

    # The diagnostic half: absent / non-numeric / non-finite ⇒ None, which is the
    # conforming "not reported" value for the raw_payload (a 0.0 would read as a
    # measured zero balance, the same lie the row's None fields avoid).
    raw_balance: Any = info.get("balance")
    balance: float | None
    try:
        balance = float(raw_balance)
    except (TypeError, ValueError):
        balance = None
    if balance is not None and not math.isfinite(balance):
        balance = None

    # 151 review WR-01 — a stopped-out MT5 account can report NEGATIVE equity (a
    # real broker state), and a negative `value_usd` would silently DEFLATE the
    # allocator's AUM, including the commit route's server-side audit recompute.
    #
    # Review [1] — WR-01 clamped that by emitting NO ROW, borrowing the ccxt spot
    # path's `float(qty) > 0` filter. The parity does not hold, and the omission
    # is worse than the number it avoided. On the spot path a row is ONE asset
    # among many and a zero balance is genuinely an absence. Here the row IS the
    # account's entire contribution — and `persist_allocator_holdings` only
    # upserts what it is given: it never deletes or zeroes yesterday's row, and
    # the dashboard collapses `allocator_holdings` to the LATEST asof per symbol.
    # So emitting nothing froze the last POSITIVE equity in place forever. An
    # account that blew up kept counting its pre-blowup money in the Holdings
    # tab, in every AUM-derived figure, and in the commit audit — under a
    # `sync_status` of `complete`, with no warning anywhere.
    #
    # A zero here is not the "measured zero" the None fields below avoid: MT5
    # answered, and its answer was "nothing left". Publish that, floored at 0 so
    # WR-01's no-deflation ruling still holds, and SAY SO — losing an account's
    # balance is exactly the kind of change a warning column exists for.
    #
    # Review [2] — the floor gets its OWN name. Rebinding `equity` in place also
    # rewrote the figure that feeds `raw_payload` forty lines down, and
    # raw_payload is the NORMALIZER'S INPUT: the thing the venue actually
    # reported. A broker-reported -4200.0 stored as 0.0 is indistinguishable
    # from a genuinely flat account the moment the logs roll, which destroys the
    # only record of a blow-up. `equity` stays REPORTED; `equity_usd` is the
    # floored, economic figure and is the only one allowed near quantity /
    # value_usd.
    if equity <= 0:
        logger.info(
            "poll_allocator_positions: mt5 account equity is not positive "
            "(%r) — emitting a floored $0 row so the stale prior row cannot "
            "survive as the latest asof",
            equity,
        )
        non_positive_note = MT5_NON_POSITIVE_EQUITY_NOTE
    else:
        non_positive_note = None
    equity_usd = max(equity, 0.0)

    # (h) THE row. `symbol` is ACCOUNT-SCOPED because allocator_holdings is
    # UNIQUE (allocator_id, venue, symbol, asof) with NO api_key_id in the key:
    # a per-venue constant token (e.g. the currency) would make the founder's
    # three MT5 accounts upsert over each other, so AUM would report ONE of them
    # and the surviving row's api_key_id attribution would flip between syncs
    # (151-RESEARCH Pitfall 1).
    #
    # The token is the api_key_id prefix, NOT the broker login: the symbol is
    # user-visible in the Holdings tab and rides inside commit scope-refs, and a
    # broker account number does not belong in either (T-151-06 / ASVS V8).
    #
    # ⚠️ Changing this token later ORPHANS every row written under the old one
    # (they key on symbol) — it is a data-migration decision, not a rename.
    symbol = f"ACCOUNT-{api_key_id[:8]}"
    if not _HOLDING_SYMBOL_RE.fullmatch(symbol):
        # Unreachable for a UUID key id; a loud refusal beats writing a token
        # the commit route's ref parser would later reject.
        raise AllocatorHoldingsSyncTransientError(MT5_MISSING_ACCOUNT_REF_NOTE)

    return (
        [
            {
                "venue": exchange_name,
                "symbol": symbol,
                # A USD account balance is cash-equivalent: quantity IS the USD
                # amount and the mark is 1.0, the same convention the ccxt spot
                # path uses for stablecoins.
                "holding_type": "spot",
                "side": "flat",
                "quantity": equity_usd,
                "value_usd": equity_usd,
                "mark_price": 1.0,
                # No basis, and no derivative uPnL to report: None is the
                # conforming value. A 0.0 here would read downstream as a real
                # measured zero rather than "not applicable".
                "entry_price": None,
                "unrealized_pnl_usd": None,
                "cost_basis_usd": None,
                # REPORTED, never floored — raw_payload is what the venue said.
                "raw_payload": _cap_raw_payload(
                    {"currency": ccy, "equity": equity, "balance": balance}
                ),
            }
        ],
        non_positive_note,
    )


# A plain ASSET code and nothing else. sFOX's `currency` is VENUE-controlled
# text that reaches BOTH a user-visible warning (SFOX_UNPRICED_ASSETS_NOTE →
# api_keys.sync_error, rendered verbatim) and the row's ``symbol`` column (which
# rides inside commit scope-refs). The alphabet is exactly _HOLDING_SYMBOL_RE's
# plus a length bound, so a code that passes here is HOLDING_REF_RE-safe by
# construction and there is no second, forkable symbol check. Anything else is
# named "unknown" rather than echoed (T-151-10 / ASVS V7) — the same allow-list
# posture the MT5 currency gate takes, for the same reason: the copy channel is
# not a place to pass through third-party text.
_SFOX_ASSET_CODE_RE = re.compile(r"[A-Za-z0-9_-]{1,16}")

# Outer wall-clock bound on the balances read. SfoxClient already bounds the
# HTTP transport at SFOX_REQUEST_TIMEOUT_S; this wait_for is the belt for
# everything OUTSIDE that bound — chiefly `_rate_gate`'s min-interval sleep — so
# a wedged client can never hold the SEQUENTIAL worker loop past a known ceiling
# (T-151-12 / WEDGE-01). DERIVED from the client's own constants rather than
# given a new env knob: a second knob would be a second thing to retune when the
# transport bound moves, and this must always sit strictly ABOVE it or the outer
# bound would pre-empt the transport's own timeout.
_SFOX_HOLDINGS_READ_TIMEOUT_S = SFOX_REQUEST_TIMEOUT_S + SFOX_DEFAULT_RATE_INTERVAL_S


async def _fetch_sfox_balance_rows(
    exchange_name: str, exchange: Any, api_key_id: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    """AUM-05 — spot holdings rows for an sFOX account, priceable assets only.

    `SfoxClient` is a GET-only facade with FOUR read methods, none of them the
    ccxt balance call the module docstring above names — so handing an sFOX
    client to the ccxt body is byte-identical to the MT5 PROD defect this phase
    closes, invisible today only because sFOX is dark behind ``SFOX_ENABLED``
    with zero stored keys. This branch exists so the venue is proven correct
    BEFORE its go-live flip rather than by it.

    PRICING — the honest bound. ``get_balances()`` returns per-asset STRING
    quantities with NO USD valuation field, and the facade has no ticker
    endpoint, so a non-stable asset CANNOT be priced here without a cross-venue
    price source we do not have. USD and members of ``STABLECOINS`` are
    cash-equivalent and mark at 1.0 (exactly what the ccxt spot path does for
    the same set); every other asset is SKIPPED and NAMED in the warning. A
    fabricated rate inside an AUM total is the one outcome that must never
    happen (T-151-11 / no-invented-data).

    ``get_balances`` is the CONTEXT-locked read. ``get_balance_history``'s daily
    ``usd_value`` would give an account-level NAV anchor with no pricing problem
    at all (structurally what MT5's ``account_info().equity`` is), but it is a
    different method than the one locked — logged in TODOS.md as a deferred
    improvement for the sFOX go-live phase (151-RESEARCH Open Q2), not taken
    here.

    ``symbol`` is the asset code, matching the ccxt spot path's convention
    (``_fetch_spot_rows`` writes the bare currency code). It is deliberately NOT
    account-scoped the way the MT5 row is: MT5 has no per-asset symbol at all,
    so its row needed an account token to avoid collapsing under the
    (allocator_id, venue, symbol, asof) unique index, whereas a per-asset venue
    shares the ccxt path's long-standing behaviour of aggregating an allocator's
    keys per asset. Diverging here would fork the holdings shape by venue.

    Raises ``AllocatorHoldingsSyncTransientError`` (str = end-user copy) on a
    transport failure, so the handler retries and no ``SfoxApiError`` text can
    reach ``classify_exception``'s ``str(exc)``.
    """
    # (a) Kill switch FIRST — before any network call, the MT5 arm's exact
    # posture. sFOX is dark until the founder flips SFOX_ENABLED on the worker,
    # and the honest-skip channel tells the user the truth ("not yet
    # available") rather than stamping an error on a healthy key.
    if not sfox_enabled_server():
        return ([], SFOX_DISABLED_DETAIL)

    # venue == "sfox" ⇒ the preflight built a SfoxClient (job_worker's
    # _make_exchange_client). A TYPE assertion derived from the venue string —
    # never a runtime isinstance/hasattr dispatch, which is the duck-typed probe
    # this whole class fix exists to avoid.
    client = cast(SfoxClient, exchange)

    try:
        balances = await asyncio.wait_for(
            client.get_balances(), timeout=_SFOX_HOLDINGS_READ_TIMEOUT_S
        )
    except (SfoxApiError, asyncio.TimeoutError) as exc:
        # SfoxApiError's detail is already secret-scrubbed at construction, but
        # it is still INTERNAL text (upstream bodies, status codes). Only the
        # fixed copy constant is surfaced; the detail survives in the log and in
        # the exception chain for Sentry.
        logger.warning(
            "poll_allocator_positions: sfox balances read failed — classified "
            "transient, retrying (%s)",
            type(exc).__name__,
        )
        raise AllocatorHoldingsSyncTransientError(SFOX_FETCH_FAILED_NOTE) from exc

    rows: list[dict[str, Any]] = []
    unpriced: set[str] = set()

    for entry in balances:
        if not isinstance(entry, dict):
            # The row shape is pinned by tests/test_sfox_client.py; a non-dict
            # element is a contract violation we cannot read, so it becomes the
            # anonymous "unknown" entry rather than disappearing silently.
            unpriced.add("unknown")
            continue

        raw_ccy = entry.get("currency")
        code = raw_ccy.strip().upper() if isinstance(raw_ccy, str) else ""
        if not _SFOX_ASSET_CODE_RE.fullmatch(code):
            # We cannot name it and we cannot safely write it as a symbol, so
            # it becomes the anonymous "unknown" entry in the warning rather
            # than either an echoed hostile string or a silent disappearance.
            code = ""

        # Annotated Any: `.get` on a dict[str, Any] widens to `Any | None`, and
        # the float() below is deliberately allowed to see whatever the venue
        # sent — the except arm right beneath it IS the shape check.
        raw_qty: Any = entry.get("balance")
        try:
            qty = float(raw_qty)
        except (TypeError, ValueError):
            qty = math.nan
        if not math.isfinite(qty):
            # [A3] A null/NaN/garbage quantity has no honest USD value. Skip and
            # NAME it — coercing to 0.0 would be a fabricated zero inside an AUM
            # total. Deliberately NOT a hard failure (unlike the MT5 arm, whose
            # single row IS the whole contribution): failing the key here would
            # drop the rest of a healthy book over one malformed asset.
            logger.warning(
                "poll_allocator_positions: sfox balance for %s was not a finite "
                "number — skipping that asset, not valuing it",
                code or "unknown",
            )
            unpriced.add(code or "unknown")
            continue
        if qty <= 0:
            # A zero balance is not skipped MONEY — naming it would tell the
            # user their BTC was dropped when they hold no BTC.
            continue
        if not code:
            unpriced.add("unknown")
            continue
        if code not in STABLECOINS:
            unpriced.add(code)
            continue

        rows.append({
            "venue": exchange_name,
            "symbol": code,
            "holding_type": "spot",
            "side": "flat",
            "quantity": qty,
            # Cash-equivalent: the mark is exactly 1.0, so the USD value IS the
            # quantity — the same convention _fetch_spot_rows applies to this
            # very set of assets.
            "value_usd": qty,
            "mark_price": 1.0,
            # No basis and no derivative uPnL to report: None is the conforming
            # value; a 0.0 would read downstream as a real measured zero.
            "entry_price": None,
            "unrealized_pnl_usd": None,
            "cost_basis_usd": None,
            "raw_payload": _cap_raw_payload({"currency": code, "balance": qty}),
        })

    # 151 review WR-03 — BOUND the enumeration. `unpriced` is unbounded and its
    # members are VENUE-CONTROLLED text (`entry["currency"]`, allow-listed but up
    # to 16 chars each), and this string is written to `api_keys.sync_error`,
    # which AllocatorSyncStatus renders VERBATIM. An account holding 100+ assets
    # produced a multi-kilobyte wall of tickers where one sentence belongs. Name
    # a handful and COUNT the rest: the copy stays one readable sentence, and the
    # allocator still learns the true scale of what was skipped.
    named = sorted(unpriced)
    label = ", ".join(named[:_SFOX_MAX_NAMED_ASSETS])
    if len(named) > _SFOX_MAX_NAMED_ASSETS:
        label += f" and {len(named) - _SFOX_MAX_NAMED_ASSETS} more"
    warning = SFOX_UNPRICED_ASSETS_NOTE.format(assets=label) if unpriced else None
    return (rows, warning)


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
# honest SKIP, never a crash — that gap is the whole class fix. Both venues the
# factory can build are registered here as of 151-04; the skip arm remains the
# standing contract for the NEXT venue added to the factory, so its first sync
# is an honest skip rather than an AttributeError in front of a user.
_NON_CCXT_HOLDINGS_FETCHERS: dict[str, _NonCcxtHoldingsFetcher] = {
    "mt5": _fetch_mt5_account_rows,
    "sfox": _fetch_sfox_balance_rows,
}


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
    #
    # 151 review E1 — the derivative arm's posture, exactly: an exception the
    # HANDLER classifies deliberately re-raises untouched (see
    # _must_reach_handler_unwrapped — job_worker.classify_exception is the
    # authority on that, NOT a list kept here), and every OTHER exception is
    # converted to the fixed copy constant before it can reach the handler's
    # generic arm and be stamped as raw Python. Unlike the derivative arm this
    # is NOT partial success — there is no book without balances — so it raises
    # AllocatorHoldingsSyncTransientError, the type whose ``str()`` IS end-user
    # copy and which the handler retries.
    try:
        spot_rows = await _fetch_spot_rows(exchange_name, exchange)
    except Exception as exc:  # noqa: BLE001
        if _must_reach_handler_unwrapped(exc):
            raise
        logger.warning(
            "fetch_allocator_holdings: spot-side read failed for %s (%s) — "
            "surfacing end-user copy (AUM-02)",
            exchange_name,
            type(exc).__name__,
            exc_info=True,
        )
        raise AllocatorHoldingsSyncTransientError(
            SPOT_FETCH_FAILED_NOTE.format(venue=_venue_display(exchange_name))
        ) from exc

    try:
        deriv_rows = await _fetch_derivative_rows(exchange_name, exchange)
    except Exception as exc:  # noqa: BLE001
        # A PERMANENT failure is not partial success. This arm already re-raised
        # two of them (auth / permission → the handler's 'revoked' path) and
        # discarded the spot rows to do it; the predicate just completes that
        # same rule over the classifier's whole permanent set, so a geo-block or
        # a BadRequest can no longer be reported as "positions will retry
        # automatically" on a DONE job that will never retry into a different
        # answer. Everything the classifier would retry keeps the partial-
        # success posture below.
        #
        # RE-AFFIRMED 2026-08-08, after the raw-text regression that rode in with
        # this predicate. The alternative considered was restoring "permanent ⇒
        # partial success" for non-credential failures, so a healthy Binance spot
        # balance is not withheld from AUM because fetch_positions 4xx'd. Not
        # taken, for two reasons. (1) It needs a SECOND axis — "is this permanent
        # failure ALSO a key-level verdict?" — and a second hand-tuned axis is
        # exactly the mechanism that produced the regression being repaired.
        # (2) It is wrong for the venue where it would matter most: Deribit spot
        # is deferred (``_fetch_spot_rows`` returns [] with no network call), so
        # for Deribit this arm IS the whole book and "partial success" would
        # stamp complete_with_warnings on a key contributing nothing. ONE rule
        # instead: permanent ⇒ the key's sync failed; retryable derivative-only
        # failure ⇒ partial success. What the regression actually cost the user
        # was the COPY, and that is fixed at the write boundary (sync_error_copy)
        # rather than by re-opening the disposition.
        if _must_reach_handler_unwrapped(exc):
            raise
        # Partial success: persist spot, surface the derivative-side failure as
        # sync_status='complete_with_warnings' via the handler.
        #
        # 151 review CR-03 — the warning is END-USER copy (it is rendered
        # verbatim by AllocatorSyncStatus), so it is the fixed copy constant and
        # never ``str(exc)``. The diagnosis stays in the log + the exception
        # chain, which is where an engineer reads it; the exception TYPE is
        # named in the log line so triage does not need the traceback to
        # classify it.
        logger.warning(
            "fetch_allocator_holdings: derivative-side read failed for %s (%s) "
            "— spot rows persisted, surfacing end-user copy (AUM-02)",
            exchange_name,
            type(exc).__name__,
            exc_info=True,
        )
        warning = DERIVATIVE_FETCH_FAILED_NOTE.format(
            venue=_venue_display(exchange_name)
        )

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
