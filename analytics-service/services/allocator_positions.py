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
    STABLECOINS,
    mt5_enabled_server,
)
from services.db import db_execute
from services.mt5_client import (
    Mt5AccountMismatchError,
    Mt5ClientError,
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
from services.mt5_concurrency import (
    _MT5_DERIVE_READ_TIMEOUT_S,
    _mt5_bounded_restart,
    _mt5_terminal_lock_for,
)
from services.positions import fetch_positions


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
    # (a) Kill switch FIRST — the derive arm's exact posture (gate before any
    # decrypt / login / read), so turning MT5_ENABLED off during an incident
    # stops live RPyC reads on this path too. Routed through the honest-skip
    # channel rather than an error: the founder disabled it deliberately, and
    # "not available yet" is the truthful thing to tell the user.
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
    async with _mt5_terminal_lock_for(session.client.terminal_key):
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
    # treating it as USD IS a fabricated rate of 1.0 inside an AUM total. A
    # missing/blank currency is the same problem wearing a different hat: we do
    # not know the denomination, so we do not guess. Honest skip either way.
    raw_ccy = info.get("currency")
    ccy = raw_ccy.strip().upper() if isinstance(raw_ccy, str) else ""
    if not _CURRENCY_CODE_RE.fullmatch(ccy):
        return ([], MT5_NON_USD_NOTE.format(ccy="unknown"))
    if ccy != "USD":
        return ([], MT5_NON_USD_NOTE.format(ccy=ccy))

    # (g) Extraction with the derive arm's fail-loud discipline: a NaN/Inf or
    # non-numeric equity would sail past every downstream denominator guard as a
    # silently poisoned AUM figure. Refuse the anchor rather than publish it.
    try:
        equity = float(info["equity"])
        balance = float(info["balance"])
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "poll_allocator_positions: mt5 account_info missing/non-numeric "
            "equity/balance — refusing to emit a row"
        )
        raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
    if not (math.isfinite(equity) and math.isfinite(balance)):
        logger.warning(
            "poll_allocator_positions: mt5 equity/balance non-finite — refusing "
            "a poisoned anchor"
        )
        raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)

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
                "quantity": equity,
                "value_usd": equity,
                "mark_price": 1.0,
                # No basis, and no derivative uPnL to report: None is the
                # conforming value. A 0.0 here would read downstream as a real
                # measured zero rather than "not applicable".
                "entry_price": None,
                "unrealized_pnl_usd": None,
                "cost_basis_usd": None,
                "raw_payload": _cap_raw_payload(
                    {"currency": ccy, "equity": equity, "balance": balance}
                ),
            }
        ],
        None,
    )


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
_NON_CCXT_HOLDINGS_FETCHERS: dict[str, _NonCcxtHoldingsFetcher] = {
    "mt5": _fetch_mt5_account_rows,
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
