import asyncio
import ccxt.async_support as ccxt
import logging
import os
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

from services.ingestion._timestamps import coerce_to_aware_utc
from services.metrics import _safe_float

logger = logging.getLogger("quantalyze.analytics")


# Audit-2026-05-07 C-0225 / M-0663 / H-0670 — per-call transient data-quality
# flags. Callers (job_worker / reconcile) read these via
# ``get_and_clear_last_dq_flags()`` AFTER awaiting ``fetch_raw_trades``. Using
# a ContextVar keeps ``fetch_raw_trades``' public signature stable (returns
# ``list[dict]``) while surfacing partial-failure / truncation / fee-currency-
# mismatch information that would otherwise be silent. Without this, the
# downstream ``data_quality_flags`` on ``strategy_analytics`` cannot reflect
# that a Binance sync only fetched 3 of 5 symbols, or that an OKX pagination
# hit the 100-page cap, or that a fill paid its fee in BNB while the quote
# was USDT.
_LAST_DQ_FLAGS: ContextVar[dict[str, Any]] = ContextVar(
    "_LAST_DQ_FLAGS", default={}
)


def get_and_clear_last_dq_flags() -> dict[str, Any]:
    """Return the data_quality_flags accumulated during the most recent
    ``fetch_raw_trades`` / ``fetch_daily_pnl`` call on this asyncio task,
    then reset to an empty dict.

    The flags are populated transiently inside ``fetch_raw_trades``,
    ``fetch_daily_pnl``, and their per-exchange helpers; callers
    (``services.job_worker.run_sync_trades_job`` and
    ``run_reconcile_strategy_job``) MUST invoke this immediately after
    the await to drain the value, otherwise a subsequent call from the
    same task would see stale flags. Empty dict on no-issue paths (most
    common case).

    Closed audit findings: C-0225 (partial-symbol failures),
    M-0663 (sync_truncated), H-0670 (fee_currency_mismatch).
    """
    flags = _LAST_DQ_FLAGS.get({})
    if flags:
        _LAST_DQ_FLAGS.set({})
    return flags


def _record_dq_flag(key: str, value: Any) -> None:
    """Merge a single data_quality_flag into the per-task buffer.

    Lists are appended (for symbol lists); booleans OR-merge; counters
    sum. Other types overwrite. Defensive: never raises so a logging
    branch can't take down a sync.
    """
    try:
        current = dict(_LAST_DQ_FLAGS.get({}))
        if key in current:
            existing = current[key]
            if isinstance(existing, list) and isinstance(value, list):
                # Dedup while preserving order (small lists).
                merged = list(existing)
                for item in value:
                    if item not in merged:
                        merged.append(item)
                current[key] = merged
            elif isinstance(existing, bool) and isinstance(value, bool):
                current[key] = existing or value
            elif isinstance(existing, (int, float)) and isinstance(
                value, (int, float)
            ) and not isinstance(existing, bool):
                current[key] = existing + value
            else:
                current[key] = value
        else:
            current[key] = value
        _LAST_DQ_FLAGS.set(current)
    except Exception:  # pragma: no cover - defensive
        logger.exception(
            "_record_dq_flag: failed to record key=%s value=%r", key, value
        )


def _infer_quote_currency(symbol: str) -> str | None:
    """Audit-2026-05-07 H-0670 — heuristically extract the quote currency
    from a normalized symbol. Returns ``None`` if we cannot confidently
    infer (caller skips the mismatch check). Covers the four common
    suffixes used by Binance / OKX / Bybit perp + spot lines: USDT,
    USDC, USD, BUSD. CCXT unified ``BTC/USDT:USDT`` is also handled.

    The reader is intentionally conservative — if the symbol ends in
    anything else (BTC-pair tokens, BUSD before delisting, exotic
    venues), we return ``None`` so we don't false-positive on the
    mismatch flag.
    """
    if not symbol:
        return None
    # CCXT unified pattern: "BTC/USDT:USDT" or "BTC/USDT".
    if ":" in symbol:
        quote = symbol.rsplit(":", 1)[1]
        if quote:
            return quote.upper()
    if "/" in symbol:
        quote = symbol.split("/", 1)[1]
        if quote:
            return quote.upper()
    sym_up = symbol.upper()
    # Order matters: USDT/USDC/BUSD before USD (USDT endswith USD too).
    for candidate in ("USDT", "USDC", "BUSD", "USD"):
        if sym_up.endswith(candidate):
            return candidate
    return None


# Cap on the per-task fee-currency mismatch sample list — keeps the
# JSONB row bounded while still giving operators a representative set.
_FEE_CCY_MISMATCH_SAMPLE_CAP = 16


def _check_fee_currency_mismatch(
    *, exchange: str, symbol: str, fee_currency: str | None
) -> None:
    """Audit-2026-05-07 H-0670 — record a transient DQ flag when an
    exchange-reported fee currency differs from the quote currency of
    the trading pair. Examples: BNB-discounted fees on Binance USDT
    pairs, ETH gas-style fees on OKX margin pairs. Pre-fix this was
    silent and ``realized_pnl = ... - total_fees`` mixed currencies as
    if they were all the quote.
    """
    if not fee_currency:
        return
    quote = _infer_quote_currency(symbol)
    if quote is None or fee_currency.upper() == quote:
        return
    _record_dq_flag("fee_currency_mismatch", True)
    existing = _LAST_DQ_FLAGS.get({}).get("fee_currency_mismatch_samples", [])
    if len(existing) >= _FEE_CCY_MISMATCH_SAMPLE_CAP:
        return
    sample = f"{exchange}:{symbol}:{fee_currency}"
    if sample not in existing:
        _record_dq_flag("fee_currency_mismatch_samples", [sample])


def _finite_float(value: Any, *, label: str) -> float | None:
    """Audit-2026-05-07 H-0661 (partial) — exchange-ingestion variant of
    ``_safe_float``: reject bool (which Python's ``float()`` would
    silently coerce to 1.0/0.0) and log at WARNING (not DEBUG) so
    operators see schema drift on the ingestion path. Otherwise
    delegates to ``_safe_float`` for the NaN/inf/non-numeric rejection.
    """
    if isinstance(value, bool):
        logger.warning("_finite_float: bool rejected for %s=%r", label, value)
        return None
    out = _safe_float(value)
    if out is None and value is not None:
        # ``_safe_float`` already DEBUG-logged the rejection cause; mirror
        # at WARNING so the ingestion path's bad-fill signal is visible
        # without flipping LOG_LEVEL=DEBUG.
        logger.warning(
            "_finite_float: rejected %s=%r (NaN/inf or non-numeric)",
            label, value,
        )
    return out


# Audit-2026-05-07 G12.B.5 — overlap window for late-arriving exchange fills.
# Hardcoded to 1 hour (3_600_000 ms) because:
#   * CCXT timestamps are normalized to UTC, but exchange-side propagation lag
#     for fills (especially Binance futures) is documented up to ~30s; OKX has
#     observed multi-minute lag during high-volume windows.
#   * DST transitions don't affect UTC, but exchange timezone reporting can
#     drift around boundaries — the buffer absorbs that without changing the
#     dedup contract (partial unique index on exchange_fill_id is the source
#     of truth; see migration 039).
# Codified here so future changes are intentional, not buried as a magic
# number. Tests in test_exchange.py pin the contract.
OVERLAP_WINDOW_MS = 3_600_000


class ColdStartSymbolDiscoveryError(Exception):
    """Raised when Binance cold-start symbol discovery (fetch_positions
    fallback) fails or yields no symbols. Lets the caller mark the
    sync_trades job for retry instead of cementing a false-success state
    (allocator's Trade Volume tab stays empty even with 90 days of
    trades on the account) — see G12.B.1.
    """


class BinancePerSymbolFetchError(Exception):
    """Raised when the Binance per-symbol fan-out fetch fails for ALL
    symbols. Preserves partial-success when only some symbols failed
    (existing test contract), but a 100% failure rate is the same false-
    success shape that ColdStartSymbolDiscoveryError eliminates — every
    fill is dropped silently and the sync looks empty. Carries
    ``failed_symbols`` and the first underlying error for triage.
    """

    def __init__(self, failed_symbols: list[str], first_error: BaseException) -> None:
        self.failed_symbols = failed_symbols
        self.first_error = first_error
        super().__init__(
            f"Binance per-symbol fetch failed for ALL {len(failed_symbols)} "
            f"symbols (e.g. {failed_symbols[0] if failed_symbols else '<none>'}); "
            f"first error: {first_error!r}"
        )


class FillRow(TypedDict):
    """Shared shape for a normalized fill row written into ``trades``.
    All three branches (OKX, Bybit, CCXT ``_normalize_fill``) build this
    via ``_make_fill_dict``.

    ``position_direction`` (long/short discriminator) is co-located
    inside ``raw_data['position_direction']`` until a ``trades`` column
    migration promotes it — adding it as a top-level key here would
    break the upsert against today's schema.
    """
    exchange: str
    symbol: str
    side: str
    price: float
    quantity: float
    fee: float
    fee_currency: str
    timestamp: str
    order_type: str
    exchange_order_id: str
    exchange_fill_id: str
    is_fill: bool
    is_maker: bool
    cost: float
    raw_data: dict | None


# Audit-2026-05-07 G12.B.4 — whitelist for OKX's posSide field. Anything
# outside this set is logged + coerced to None so a malformed exchange
# response can't smuggle an invalid value into the typed column.
_OKX_VALID_POS_SIDES: frozenset[str] = frozenset({"long", "short", "net"})


# Audit-2026-05-07 M-0665 — gate full raw_data storage behind an env flag
# so production storage stays lean (each fill's raw CCXT response is
# 500-2000 bytes; at 50K fills that's ~50-100MB on the trades table).
# A whitelisted subset (the fields position_reconstruction actually
# reads) is always preserved so the downstream contract is unchanged.
# Set EXCHANGE_STORE_RAW_DATA=1 in env to opt back in to full storage
# for forensic / debug strategies. Migration to TOAST EXTERNAL storage
# and ``.select(...)`` column-projection in analytics_runner /
# position_reconstruction are out-of-scope here (cross-file).
_STORE_FULL_RAW_DATA = os.environ.get("EXCHANGE_STORE_RAW_DATA", "0") == "1"
# Whitelist of fields downstream consumers actually read from raw_data.
# position_reconstruction reads ``position_direction`` (set by
# ``_make_fill_dict`` itself) and OKX ``posSide``; the others are kept
# because they appear in existing analytics queries and tests. Keep the
# list small to bound JSONB size.
_RAW_DATA_KEEP_KEYS: frozenset[str] = frozenset({
    "posSide",            # OKX hedge-mode direction
    "position_direction",  # canonical long/short (written by factory)
    "instType",           # OKX instrument type (SPOT/SWAP/FUTURES)
    "category",           # Bybit instrument category
    "execType",           # OKX taker/maker discriminator (already mapped to is_maker but kept for audit)
    "feeCcy",             # OKX fee-currency raw (mirrors fee_currency col)
    "feeCurrency",        # Bybit fee-currency raw
})


def _trim_raw_data(raw_data: dict | None) -> dict | None:
    """Audit-2026-05-07 M-0665 — when ``EXCHANGE_STORE_RAW_DATA`` is off,
    keep only the whitelisted keys from the exchange response. Returns
    ``None`` if the trimmed dict would be empty so the JSONB column
    stays NULL (lowest storage / fastest scan).
    """
    if raw_data is None:
        return None
    if _STORE_FULL_RAW_DATA:
        return raw_data
    trimmed = {
        k: v for k, v in raw_data.items() if k in _RAW_DATA_KEEP_KEYS
    }
    return trimmed if trimmed else None


def _make_fill_dict(
    *,
    exchange: str,
    symbol: str,
    side: str,
    price: float,
    quantity: float,
    fee: float,
    fee_currency: str,
    timestamp: str,
    exchange_order_id: str,
    exchange_fill_id: str,
    is_maker: bool,
    raw_data: dict | None,
    position_direction: Literal["long", "short"] | None = None,
    order_type: str = "fill",
) -> FillRow:
    """Audit-2026-05-07 G12.B.4 — single factory for the 16-key fill dict
    persisted to ``trades``. OKX/Bybit/CCXT branches all delegate here.

    Keeping construction in one place eliminates the drift risk flagged
    by G12.B.4/G12.B.7 (three near-identical builders). ``cost`` is
    computed from ``price * quantity`` so callers cannot accidentally
    pass an inconsistent value.

    ``position_direction`` is the typed long/short discriminator. The
    ``trades`` table does not yet have a dedicated column for it
    (a separate migration is required, out-of-scope for this audit
    batch); for now we co-locate the validated value into
    ``raw_data['position_direction']`` so downstream consumers
    (position_reconstruction) can read it via raw_data without a
    schema change. This keeps the persist path safe while still
    constraining the value upstream.
    """
    # Adversarial-review hardening (security specialist, PR #137 follow-up):
    # the CCXT `_normalize_fill` path passes `trade.get("info")` straight
    # into raw_data with zero whitelisting — so a hostile exchange response
    # could stuff arbitrary `posSide` values that bypass the OKX-direct-API
    # whitelist. PR #140's consumer-side whitelist in
    # _match_positions_fifo defends downstream, but defense-in-depth at
    # ingest closes the door before raw_data is persisted. Always copy
    # raw_data and scrub any `posSide` that isn't in the OKX whitelist.
    if raw_data is not None:
        raw_data = dict(raw_data)
        if "posSide" in raw_data:
            _ps = raw_data["posSide"]
            if _ps not in _OKX_VALID_POS_SIDES and _ps not in ("", None):
                logger.warning(
                    "_make_fill_dict: scrubbing non-whitelisted posSide=%r "
                    "from raw_data before persist (defense-in-depth)",
                    _ps,
                )
                raw_data.pop("posSide", None)
    if position_direction is not None:
        if raw_data is None:
            raw_data = {}
        raw_data["position_direction"] = position_direction
    # Audit-2026-05-07 M-0665 — trim to whitelist before persist so the
    # JSONB column stays small. Full storage is opt-in via env. Apply
    # AFTER position_direction is written so the canonical discriminator
    # always survives the trim.
    raw_data = _trim_raw_data(raw_data)
    return {
        "exchange": exchange,
        "symbol": symbol,
        "side": side,
        "price": price,
        "quantity": quantity,
        "fee": fee,
        "fee_currency": fee_currency,
        "timestamp": timestamp,
        "order_type": order_type,
        "exchange_order_id": exchange_order_id,
        "exchange_fill_id": exchange_fill_id,
        "is_fill": True,
        "is_maker": is_maker,
        "cost": price * quantity,
        "raw_data": raw_data,
    }


EXCHANGE_CLASSES: dict[str, type] = {
    "binance": ccxt.binance,
    "okx": ccxt.okx,
    "bybit": ccxt.bybit,
    "deribit": ccxt.deribit,   # Phase 06 — D-17 exchange coverage; derivative-side only per f3 Path B
}


def create_exchange(exchange_name: str, api_key: str, api_secret: str, passphrase: str | None = None) -> ccxt.Exchange:
    """Create a CCXT exchange instance with read-only credentials."""
    cls = EXCHANGE_CLASSES.get(exchange_name)
    if not cls:
        raise ValueError(f"Unsupported exchange: {exchange_name}")

    config: dict[str, Any] = {
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
    }
    if passphrase:
        config["password"] = passphrase

    exchange = cls(config)

    if exchange_name == "bybit":
        # ccxt's bybit `load_markets()` calls `fetch_currencies()`, which hits
        # `GET /v5/asset/coin/query-info`. That endpoint requires the
        # Wallet > Account Transfer scope; a pure read-only key gets 403,
        # which ccxt re-raises as `RateLimitExceeded`. Currency precision
        # data isn't used for validation OR trade fetching, so we disable
        # the call. Confirmed 2026-05-05 against a live Bybit read-only key
        # via Railway log archaeology (correlation_id
        # 10792caf-1d0b-4ed1-8a30-8ac66e03bbf9).
        exchange.has["fetchCurrencies"] = False

    return exchange


async def validate_key_permissions(exchange: ccxt.Exchange) -> dict[str, Any]:
    """Validate that the API key is functional using safe read-only operations.

    Public shape: ``{valid, read_only, error, error_code, markets_loaded,
    markets_error, probe_error}``. ``error_code`` is a stable discriminator
    (e.g. ``"AUTH_FAILED"``, ``"PERMISSION_DENIED"``, ``"RATE_LIMITED"``,
    ``"NETWORK_UNAVAILABLE"``, ``"VALIDATION_UNEXPECTED"``) so the Next layer
    can route to a precise envelope without parsing the human-readable
    ``error`` string. Sprint 5 Task 5.8 moved the per-exchange permission
    probes into ``services.key_permissions``; ``read_only`` here is derived
    from the triple as ``read and not trade and not withdraw``.
    """
    from services.key_permissions import detect_permissions

    result: dict[str, Any] = {
        "valid": False,
        "read_only": False,
        "error": None,
        "error_code": None,
        # Defense-in-depth markers: callers (e.g. trade fetch) can correlate
        # later failures back to a load_markets that didn't actually load.
        "markets_loaded": False,
        "markets_error": None,
    }

    try:
        try:
            await exchange.load_markets()
            result["markets_loaded"] = True
        except (ccxt.RateLimitExceeded, ccxt.PermissionDenied) as load_exc:
            # Documented swallow-path: Bybit's read-only key triggers
            # /v5/asset/coin/query-info → 403, which ccxt re-raises as
            # RateLimitExceeded. Also covers documented PermissionDenied
            # for keys without scope on the markets-meta endpoint.
            # `fetch_balance()` is the real validation, and per-exchange
            # permission probes don't depend on markets being loaded.
            logger.warning(
                "validate_key_permissions: load_markets failed on %s — %s: %s; "
                "continuing with fetch_balance (markets_loaded=False)",
                exchange.id,
                type(load_exc).__name__,
                load_exc,
            )
            result["markets_error"] = (
                f"{type(load_exc).__name__}: {load_exc}"
            )
        # Note: every other exception class (NetworkError, AuthenticationError,
        # ExchangeNotAvailable, etc.) is intentionally allowed to propagate
        # to the outer handler so it lands in the right error_code branch
        # below — the outer handler is the single classification surface.
        await exchange.fetch_balance()
        result["valid"] = True
    # IMPORTANT: order matters. ccxt's hierarchy is:
    #   PermissionDenied ⊂ AuthenticationError ⊂ ExchangeError
    #   RateLimitExceeded, DDoSProtection, ExchangeNotAvailable ⊂ NetworkError
    # Subclasses MUST be checked before their superclasses or every
    # PermissionDenied/RateLimit/DDoS will land on the wrong branch.
    except ccxt.PermissionDenied as exc:
        # Right credentials, wrong scope (or IP allowlist mismatch on
        # exchanges that map IP-block to PermissionDenied). Must precede
        # AuthenticationError because PermissionDenied subclasses it.
        logger.exception(
            "validate_key_permissions: ccxt.PermissionDenied on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Key denied permission. Confirm the key has read-only scope "
            "and that your IP allowlist includes our service."
        )
        result["error_code"] = "PERMISSION_DENIED"
        return result
    except ccxt.AuthenticationError as exc:
        # Genuine bad credentials, signature mismatch, expired key.
        logger.exception(
            "validate_key_permissions: ccxt.AuthenticationError on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = "Authentication failed. Check your API key and secret."
        result["error_code"] = "AUTH_FAILED"
        return result
    except ccxt.DDoSProtection as exc:
        # Cloudflare / WAF block — distinct from a genuine rate-limit
        # because retrying immediately won't help (typically a geo / ASN
        # block on the egress IP). Must precede NetworkError /
        # RateLimitExceeded since DDoSProtection subclasses NetworkError.
        logger.exception(
            "validate_key_permissions: ccxt.DDoSProtection on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Exchange blocked the validation request at the edge "
            "(DDoS / WAF protection). Check region / IP allowlist."
        )
        result["error_code"] = "DDOS_PROTECTION"
        return result
    except ccxt.RateLimitExceeded as exc:
        # Real rate-limit OR (per-exchange) the documented Bybit quirk
        # where 403 on a scoped endpoint surfaces as RateLimitExceeded.
        # Must precede NetworkError since RateLimitExceeded subclasses it.
        logger.exception(
            "validate_key_permissions: ccxt.RateLimitExceeded on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Exchange rate-limited the validation request. Wait a moment "
            "and try again — repeated failures may indicate a missing "
            "read scope."
        )
        result["error_code"] = "RATE_LIMITED"
        return result
    except ccxt.ExchangeNotAvailable as exc:
        # Exchange is down (5xx, maintenance window, regional outage).
        # Must precede NetworkError since ExchangeNotAvailable subclasses it.
        logger.exception(
            "validate_key_permissions: ccxt.ExchangeNotAvailable on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Exchange is currently unavailable. Try again in a few minutes."
        )
        result["error_code"] = "EXCHANGE_UNAVAILABLE"
        return result
    except ccxt.NetworkError as exc:
        # Transport-level (timeout, DNS, TLS, connection reset). Not a
        # credential problem. Backstop for the network family.
        logger.exception(
            "validate_key_permissions: ccxt.NetworkError on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Network error reaching the exchange. Check connectivity "
            "and try again."
        )
        result["error_code"] = "NETWORK_UNAVAILABLE"
        return result
    except Exception as exc:  # noqa: BLE001
        # Phase 18 root-cause for the recurring "code: UNKNOWN, please
        # verify your credentials" wizard fail (found 2026-05-05 via
        # Bybit E2E + Railway log archaeology). Pre-fix the bare `except`
        # lost the ccxt error class + body and misdiagnosed every infra
        # failure as bad credentials. The discriminating ccxt branches
        # above now route specific failures; this catch-all stays as a
        # backstop for unexpected ccxt subclasses or stdlib exceptions
        # (e.g. ValueError from a malformed response). It carries a
        # distinct error_code so the Next layer can render an "unexpected"
        # envelope rather than misleading the user with a "verify
        # credentials" message.
        logger.exception(
            "validate_key_permissions: unexpected error on %s — %s: %s",
            exchange.id,
            type(exc).__name__,
            exc,
        )
        result["error"] = (
            "Key validation failed unexpectedly. Contact support if this "
            "persists."
        )
        result["error_code"] = "VALIDATION_UNEXPECTED"
        return result

    if exchange.id not in EXCHANGE_CLASSES:
        result["error"] = "Unsupported exchange for permission verification."
        result["error_code"] = "UNSUPPORTED_EXCHANGE"
        return result

    # Pre-store path: no api_key_id yet, bypass cache.
    perms = await detect_permissions(exchange, api_key_id=None)
    has_withdraw = perms.get("withdraw", False)
    has_trade = perms.get("trade", False)
    has_read = perms.get("read", False)
    probe_error = perms.get("probe_error", False)

    result["read_only"] = bool(has_read and not has_trade and not has_withdraw)
    # Surface the transient flag so callers can avoid persisting a
    # fail-CLOSED default as if it were a real probe result.
    result["probe_error"] = bool(probe_error)

    if has_withdraw:
        result["error"] = "Key has withdrawal permissions. Please use a read-only key."
        result["error_code"] = "WITHDRAW_SCOPE"
    elif has_trade:
        result["error"] = "Key has trading permissions. Please use a read-only key."
        result["error_code"] = "TRADE_SCOPE"

    return result


async def fetch_daily_pnl(exchange: ccxt.Exchange, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from the exchange account bills/ledger.

    Instead of scanning every trading pair for individual trades (200+ API calls),
    this fetches account-level P&L history directly. Much faster and gives us
    exactly what we need for analytics: daily profit/loss.
    """
    # Audit-2026-05-07 C-0319 / maintainability — same entry-seam reset as
    # ``fetch_raw_trades``. ``fetch_daily_pnl`` writes the
    # ``bybit_daily_pnl_includes_funding`` flag (Bybit branch); if a caller
    # invokes ``fetch_raw_trades`` and then ``fetch_daily_pnl`` on the same
    # asyncio task without an intervening drain, stale flags from the
    # trades-sync (e.g. ``binance_partial_symbols``) would otherwise leak
    # into the daily-PnL caller's view. Resetting here mirrors the
    # per-call isolation contract documented in ``_LAST_DQ_FLAGS``.
    _LAST_DQ_FLAGS.set({})

    daily_pnl: list[dict[str, Any]] = []

    try:
        if exchange.id == "okx":
            # OKX: fetch account bills (P&L history) with pagination for full history
            from datetime import datetime, timezone, timedelta
            all_bills: list[dict] = []

            # Fetch bills across all instrument types, paginate for full history
            for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                after_id = ""
                type_count = 0

                for page in range(100):
                    params: dict[str, str] = {"instType": inst_type, "limit": "100"}
                    if since_ms:
                        params["begin"] = str(since_ms)
                    if after_id:
                        params["after"] = after_id

                    try:
                        bills = await exchange.private_get_account_bills(params)
                        data = bills.get("data", [])
                        if not data:
                            break
                        all_bills.extend(data)
                        type_count += len(data)
                        after_id = data[-1].get("billId", "")
                        if len(data) < 100:
                            break
                    except Exception as e:
                        logger.warning("OKX bills fetch failed for %s page %d: %s", inst_type, page, str(e))
                        break

                if type_count > 0:
                    logger.info("OKX %s: fetched %d bills", inst_type, type_count)

            # Fetch bills-archive for older history (>3 months)
            # Only fetch archive if we need data older than 90 days
            archive_bills: list[dict] = []
            three_months_ago_ms = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp() * 1000)
            should_fetch_archive = since_ms is None or since_ms < three_months_ago_ms
            if not should_fetch_archive:
                logger.info("OKX: skipping archive API (since_ms is within 3 months)")
            else:
                logger.info("OKX: fetching archive API for older history...")
                for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                    after_id = ""
                    type_count = 0
                    for page in range(100):
                        params: dict[str, str] = {"instType": inst_type, "limit": "100"}
                        if since_ms:
                            params["begin"] = str(since_ms)
                        if after_id:
                            params["after"] = after_id
                        try:
                            bills = await exchange.private_get_account_bills_archive(params)
                            data = bills.get("data", [])
                            if not data:
                                break
                            archive_bills.extend(data)
                            type_count += len(data)
                            after_id = data[-1].get("billId", "")
                            if len(data) < 100:
                                break
                        except Exception as e:
                            logger.warning("OKX archive failed for %s: %s", inst_type, str(e))
                            break
                    if type_count > 0:
                        logger.info("OKX archive %s: fetched %d bills", inst_type, type_count)

            # Merge recent + archive and deduplicate by billId
            merged_bills = all_bills + archive_bills
            seen_ids: set[str] = set()
            unique_bills: list[dict] = []
            for bill in merged_bills:
                bid = bill.get("billId", "")
                if bid and bid not in seen_ids:
                    seen_ids.add(bid)
                    unique_bills.append(bill)
                elif not bid:
                    logger.warning("OKX bill missing billId, cannot deduplicate: %s", bill.get("ts", "unknown"))
                    unique_bills.append(bill)
            all_bills = unique_bills

            logger.info(
                "OKX total: %d bills (%d recent + %d archive, %d after dedup)",
                len(all_bills), len(merged_bills) - len(archive_bills),
                len(archive_bills), len(all_bills)
            )

            # Aggregate bills into daily PnL
            from collections import defaultdict
            daily_totals: dict[str, float] = defaultdict(float)

            # Audit-2026-05-07 C-0319 — funding-fee bills (type=8) flow into a
            # separate ``funding_fees`` table via services.funding_fetch. Pre-
            # fix, this aggregator summed every bill regardless of ``type``,
            # so OKX/Bybit perps double-counted funding once in ``daily_pnl``
            # (consumed by transforms.py → Sharpe / equity curve) and once in
            # ``positions.funding_pnl``. Mirror the Binance ``incomeType``
            # filter cutover (Sprint 5.6) by dropping type=='8' here.
            _OKX_FUNDING_BILL_TYPE = "8"
            _okx_funding_bills_dropped = 0
            for bill in all_bills:
                bill_type = str(bill.get("type", "")).strip()
                if bill_type == _OKX_FUNDING_BILL_TYPE:
                    _okx_funding_bills_dropped += 1
                    continue
                pnl_val = float(bill.get("pnl", 0)) + float(bill.get("fee", 0))
                ts_raw = bill.get("ts", "")
                if ts_raw and ts_raw.isdigit():
                    dt = datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc)
                    day_key = dt.strftime("%Y-%m-%d")
                    daily_totals[day_key] += pnl_val
                else:
                    # PR #181 take-2 silent-failure-hunter HIGH F4: pre-take2,
                    # this guard had no else branch — bills with empty or
                    # non-digit ts were silently dropped. A schema drift
                    # (OKX returning ISO strings, leading whitespace, exponent
                    # notation) would lose every bill from a page with no
                    # operator signal. Mirror the Binance/Bybit fetch_daily_pnl
                    # WARNING severity for cross-exchange triage consistency.
                    logger.warning(
                        "OKX bill dropped: unparseable ts=%r (billId=%s, billType=%s)",
                        ts_raw, bill.get("billId"), bill.get("billType"),
                    )

            logger.info(
                "OKX: %d bills aggregated to %d daily PnL entries "
                "(%d funding-fee bills excluded — see services.funding_fetch)",
                len(all_bills), len(daily_totals), _okx_funding_bills_dropped,
            )

            for day, pnl in sorted(daily_totals.items()):
                daily_pnl.append({
                    "exchange": "okx",
                    "symbol": "PORTFOLIO",
                    "side": "buy" if pnl >= 0 else "sell",
                    "price": abs(pnl),
                    "quantity": 1,
                    "fee": 0,
                    "fee_currency": "USDT",
                    "timestamp": f"{day}T00:00:00+00:00",
                    "order_type": "daily_pnl",
                })

        elif exchange.id == "binance":
            # Binance: fetch income history (futures P&L)
            try:
                params = {"limit": 1000}
                if since_ms:
                    params["startTime"] = since_ms
                income = await exchange.fapiPrivate_get_income(params)
                for item in income:
                    # Sprint 5.6 cutover: FUNDING_FEE no longer routes into
                    # daily_pnl. Funding is ingested separately via
                    # services.funding_fetch → funding_fees table.
                    # See migration 044 for the forward-only rationale.
                    if item.get("incomeType") in ("REALIZED_PNL", "COMMISSION"):
                        daily_pnl.append({
                            "exchange": "binance",
                            "symbol": item.get("symbol", "PORTFOLIO"),
                            "side": "buy" if float(item.get("income", 0)) >= 0 else "sell",
                            "price": abs(float(item.get("income", 0))),
                            "quantity": 1,
                            "fee": 0,
                            "fee_currency": "USDT",
                            "timestamp": item.get("time", ""),
                            "order_type": "daily_pnl",
                        })
                for entry in daily_pnl:
                    if entry["timestamp"] and str(entry["timestamp"]).isdigit():
                        from datetime import datetime, timezone
                        ts = int(entry["timestamp"]) / 1000
                        entry["timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception as exc:  # noqa: BLE001
                # fail-soft fallback: keep the spot-trades fallback so the
                # parent sync never aborts on Binance futures-income drift,
                # but log the underlying error so operators can spot a
                # systemic regression (Binance schema change, auth failure
                # masquerading as futures-permission denial) instead of
                # only seeing "BTC spot fallback fired" in the data.
                # PR #181 take-2 security F7: ccxt's network-class exceptions
                # for Binance signed requests embed the request URL in
                # str(exc) — that URL ends with `&signature=<HMAC-SHA256>`.
                # Scrub the exception message through scrub_freeform_string
                # before logging so the HMAC signature is replaced with the
                # REDACTED token. The exc_info=True traceback's first line
                # also includes str(exc), so we hand the scrubbed message
                # via the format-arg (str(exc)) AND set exc_class so
                # operators still get the exception type for triage. The
                # raw `exc` object is no longer interpolated.
                from .redact import scrub_freeform_string
                exc_class = type(exc).__name__
                scrubbed_msg = scrub_freeform_string(str(exc))
                logger.warning(
                    "Binance futures-income failed (falling back to BTC spot trades), exc_class=%s, scrubbed=%s",
                    exc_class, scrubbed_msg,
                )
                # Fallback: fetch spot trades for BTC only
                trades = await exchange.fetch_my_trades("BTC/USDT", since=since_ms, limit=1000)
                for t in trades:
                    daily_pnl.append({
                        "exchange": "binance", "symbol": t["symbol"],
                        "side": t["side"], "price": t["price"],
                        "quantity": t["amount"],
                        "fee": t.get("fee", {}).get("cost"),
                        "fee_currency": t.get("fee", {}).get("currency"),
                        "timestamp": t["datetime"], "order_type": t.get("type"),
                    })

        elif exchange.id == "bybit":
            # Bybit: fetch closed PnL.
            # audit-2026-05-07 silent-failure sweep: the previous bare
            # `except: pass` here wrapped BOTH the Bybit RPC and the
            # timestamp ISO-conversion loop. Two distinct failure modes
            # collapsed into one silent surface:
            #   (a) RPC raised — bybit daily_pnl silently missing,
            #       caller could not distinguish "no closed positions" from
            #       "Bybit blip / auth failure / network".
            #   (b) ISO conversion raised on a malformed createdTime —
            #       timestamps stayed as digit-strings or empty, and the
            #       downstream `datetime.fromisoformat` consumer raised
            #       another layer up with NO context about why.
            # Both are now logged at WARNING. We deliberately keep the
            # call best-effort (no re-raise) because fetch_daily_pnl is
            # a fire-and-forget enrichment path — its failure must not
            # abort the parent sync. But the silent surface is gone.
            # fail-soft: best-effort enrichment, but log the failure mode.
            try:
                params = {"category": "linear", "limit": 200}
                result = await exchange.private_get_v5_position_closed_pnl(params)
                items = result.get("result", {}).get("list", [])
                # Audit-2026-05-07 C-0319 — Bybit's ``position_closed_pnl``
                # endpoint returns ``closedPnl`` as a COMBINED cashflow
                # (realized PnL + funding) per the funding_fees migration
                # preamble (services.funding_fetch). There is no per-row
                # type filter the way OKX exposes; the only safe option
                # for now is to surface a data-quality flag so downstream
                # equity-curve / Sharpe computations can warn that the
                # daily_pnl figure for Bybit perp strategies includes
                # funding which is ALSO ingested separately into
                # ``funding_fees``. A migration to a non-funding endpoint
                # (or per-row split) is the durable fix; flag here is the
                # defense-in-depth so the double-count is at least
                # visible to operators / the admin health card.
                if items:
                    _record_dq_flag(
                        "bybit_daily_pnl_includes_funding", True
                    )
                # PR #181 take-2 red-team HIGH F5: build the Bybit-branch rows
                # locally first, run the ISO conversion as a pure build of a
                # NEW list, and only mutate `daily_pnl` on full success. The
                # prior in-place mutation could partially convert entries —
                # if entry N succeeded but entry N+1 raised, daily_pnl held a
                # mix of ISO strings and digit-string timestamps. Downstream
                # `transforms.trades_to_daily_returns_with_status` then ran
                # `pd.to_datetime(df['timestamp'])` on the mixed column and
                # raised a cryptic format-mismatch error with NO link back to
                # the Bybit WARNING. Atomic conversion preserves uniform
                # timestamp format and keeps the failure mode localized.
                bybit_rows = [
                    {
                        "exchange": "bybit",
                        "symbol": item.get("symbol", "PORTFOLIO"),
                        "side": "buy" if float(item.get("closedPnl", 0)) >= 0 else "sell",
                        "price": abs(float(item.get("closedPnl", 0))),
                        "quantity": 1,
                        "fee": 0,
                        "fee_currency": "USDT",
                        "timestamp": item.get("createdTime", ""),
                        "order_type": "daily_pnl",
                    }
                    for item in items
                ]
                # Build converted-timestamp variant in a fresh list. On full
                # success, we extend daily_pnl with the converted rows. On
                # mid-loop failure, the except clause runs without mutating
                # daily_pnl (preserving caller-visible uniformity).
                from datetime import datetime, timezone
                converted_rows: list[dict[str, Any]] = []
                for entry in bybit_rows:
                    new_entry = dict(entry)
                    ts_raw = entry["timestamp"]
                    if ts_raw and str(ts_raw).isdigit():
                        ts = int(ts_raw) / 1000
                        new_entry["timestamp"] = datetime.fromtimestamp(
                            ts, tz=timezone.utc
                        ).isoformat()
                    converted_rows.append(new_entry)
                daily_pnl.extend(converted_rows)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Bybit closed_pnl fetch / ISO-conversion failed: %s",
                    exc, exc_info=True,
                )

    except Exception as e:
        logger.error("fetch_daily_pnl failed: %s", str(e))

    return daily_pnl


async def fetch_raw_trades(
    exchange: ccxt.Exchange,
    strategy_id: str,
    supabase,
    since_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch raw fill-level trades from the exchange.

    Returns a list of dicts normalized to the trades table schema with
    is_fill=True. Overlap window: subtracts 1 hour from since_ms for
    late-arriving fills; dedup is handled by the DB partial unique index.
    """
    from services.db import db_execute

    fills: list[dict[str, Any]] = []

    # Audit-2026-05-07 C-0225 / M-0663 / H-0670 — reset the per-task DQ
    # buffer at the entry seam so callers can read the flags accumulated
    # by THIS sync only, never a stale value from a prior call on the
    # same asyncio task. ``get_and_clear_last_dq_flags`` is the read-and-
    # reset surface; this reset is the write-side defense-in-depth.
    _LAST_DQ_FLAGS.set({})

    # Apply overlap window for late-arriving fills (see OVERLAP_WINDOW_MS).
    effective_since = None
    if since_ms is not None:
        effective_since = since_ms - OVERLAP_WINDOW_MS

    try:
        if exchange.id == "binance":
            fills = await _fetch_raw_trades_binance(
                exchange, strategy_id, supabase, effective_since
            )
        elif exchange.id == "okx":
            fills = await _fetch_raw_trades_okx(exchange, effective_since)
        elif exchange.id == "bybit":
            fills = await _fetch_raw_trades_bybit(exchange, effective_since)
        else:
            logger.warning("fetch_raw_trades: unsupported exchange %s", exchange.id)
    except Exception as e:
        logger.error("fetch_raw_trades failed for %s: %s", exchange.id, str(e))
        raise

    logger.info(
        "fetch_raw_trades: %d fills from %s for strategy %s",
        len(fills), exchange.id, strategy_id,
    )
    return fills


async def _fetch_raw_trades_binance(
    exchange: ccxt.Exchange,
    strategy_id: str,
    supabase,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Binance: per-symbol iteration using fetch_my_trades."""
    from services.db import db_execute, paginated_select

    # DISTINCT symbols across trades + position_snapshots. Paginated
    # because PostgREST caps responses at 1000 rows by default — without
    # this, a strategy with >1000 fill or snapshot rows silently drops
    # symbols from discovery and per-symbol pagination then skips real
    # history (defeating the H-0662 fix below).
    def _get_symbols():
        trade_rows = paginated_select(
            supabase.table("trades")
            .select("symbol")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True),
            order_by=(("id", False),),
            truncation_hint=f"trades.symbol strategy_id={strategy_id}",
        )
        pos_rows = paginated_select(
            supabase.table("position_snapshots")
            .select("symbol")
            .eq("strategy_id", strategy_id),
            order_by=(("id", False),),
            truncation_hint=f"position_snapshots.symbol strategy_id={strategy_id}",
        )
        symbols: set[str] = set()
        for row in (*trade_rows, *pos_rows):
            sym = row.get("symbol")
            if sym:
                symbols.add(sym)
        return list(symbols)

    symbols = await db_execute(_get_symbols)

    # Cold start: fetch current positions to get symbols.
    #
    # Audit-2026-05-07 G12.B.1 — pre-fix this except branch silently
    # logged and continued with symbols=[]. The caller saw an empty fills
    # list and treated the sync as "0 fills, success", so an allocator
    # with 90 days of trades got an empty Trade Volume tab. Now we raise
    # a typed ColdStartSymbolDiscoveryError so the caller can mark the
    # sync_trades job for retry.
    is_cold_start = not symbols
    if is_cold_start:
        try:
            positions = await exchange.fetch_positions()
            for pos in positions:
                sym = pos.get("symbol")
                contracts = pos.get("contracts") or 0
                if sym and float(contracts) > 0:
                    symbols.append(sym)
            # Deduplicate
            symbols = list(set(symbols))
            logger.info(
                "Binance cold start: discovered %d symbols from positions", len(symbols)
            )
        except Exception as e:
            logger.warning("Binance cold start position fetch failed: %s", str(e))
            raise ColdStartSymbolDiscoveryError(str(e)) from e

        # G12.B.1 closed-position edge case: fetch_positions only returns
        # currently-open positions, so a strategy that closed everything
        # yesterday discovers 0 symbols. There's no `update_strategy_analytics`
        # helper available at this layer; raise the typed error so the
        # caller can stamp `cold_start_pending=true` (TODO: G12.B.8 covers
        # the broader closed-position-history backfill via account-history
        # endpoints — out of scope for this batch).
        if not symbols:
            raise ColdStartSymbolDiscoveryError(
                "no symbols discovered on cold start; closed-position history "
                "requires manual seed"
            )

    # Bounded-concurrency fan-out (Semaphore=5). CCXT's per-instance
    # rate limiter is shared across coroutines and throttles correctly;
    # the semaphore caps in-flight requests so we don't trip 429s.
    sem = asyncio.Semaphore(5)

    # Build {normalized_symbol: ccxt_symbol} once. Per-symbol scans of
    # exchange.markets (~1500 entries on Binance) inside _fetch_one were
    # O(N_symbols × M_markets) per sync.
    ccxt_symbol_by_normalized: dict[str, str] = {}
    if hasattr(exchange, "markets") and exchange.markets:
        for mkt_symbol in exchange.markets:
            normalized = (
                mkt_symbol.replace("/", "")
                .replace(":USDT", "")
                .replace(":USD", "")
            )
            ccxt_symbol_by_normalized[normalized] = mkt_symbol

    async def _fetch_one(symbol: str):
        # Normalize symbol for CCXT: BTCUSDT -> BTC/USDT:USDT
        ccxt_symbol = symbol
        if "/" not in ccxt_symbol:
            ccxt_symbol = ccxt_symbol_by_normalized.get(symbol, symbol)

        # H-0662: Binance caps fetch_my_trades at 1000 rows per call.
        # Paginate by advancing ``since`` past the last fill's timestamp
        # until a short page returns or we hit the cap (20 × 1000 =
        # 20K fills/symbol). Mirrors the OKX/Bybit page-cap contract.
        BINANCE_PAGE_CAP = 20
        all_trades: list[dict] = []
        current_since = since_ms
        for _page in range(BINANCE_PAGE_CAP):
            # Hold the semaphore only across the network call so one
            # heavy symbol can't monopolize a slot for 20 sequential RTTs
            # while sibling symbols block.
            async with sem:
                batch = await exchange.fetch_my_trades(
                    ccxt_symbol, since=current_since, limit=1000
                )
            if not batch:
                break
            all_trades.extend(batch)
            if len(batch) < 1000:
                break
            last_ts = batch[-1].get("timestamp")
            if not isinstance(last_ts, (int, float)):
                # No cursor → can't safely advance without risking an
                # infinite loop. Stop here.
                logger.warning(
                    "Binance fetch_my_trades %s: missing 'timestamp' "
                    "on last fill, stopping pagination at %d fills",
                    symbol, len(all_trades),
                )
                break
            current_since = int(last_ts) + 1
        else:
            logger.warning(
                "Binance fetch_my_trades %s: hit %d-page cap; "
                "possible truncation past %d fills",
                symbol, BINANCE_PAGE_CAP, len(all_trades),
            )
        return symbol, all_trades

    tasks = [_fetch_one(s) for s in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Adversarial-review hardening (PR #137 follow-up):
    # `asyncio.gather(return_exceptions=True)` on Python 3.11+ captures
    # CancelledError as a result item rather than re-raising it. This
    # creates a silent-failure mode under parent cancellation (15-min
    # handler timeout, worker shutdown, signal): every per-symbol task
    # gets a CancelledError, the gather "succeeds" with N exception
    # objects, and the function returns an empty fills list — same
    # false-success outcome G12.B.1 was supposed to eliminate. Scan
    # for CancelledError BEFORE classifying as per-symbol-failed and
    # re-raise so the outer wait_for / shutdown propagates correctly.
    if any(isinstance(item, asyncio.CancelledError) for item in results):
        raise asyncio.CancelledError(
            "Binance per-symbol gather cancelled (parent timeout / shutdown)"
        )

    fills: list[dict[str, Any]] = []
    failed_symbols: list[str] = []
    first_error: BaseException | None = None
    for idx, item in enumerate(results):
        if isinstance(item, BaseException):
            # Per-symbol "Binance fetch_my_trades failed for" log shape is
            # load-bearing for existing correlation_id log queries.
            symbol = symbols[idx] if idx < len(symbols) else "<unknown>"
            failed_symbols.append(symbol)
            if first_error is None:
                first_error = item
            logger.warning(
                "Binance fetch_my_trades failed for %s: %s", symbol, str(item)
            )
            continue
        _symbol, trades = item
        for t in trades:
            normalized = _normalize_fill(t, exchange.id)
            if normalized is not None:
                fills.append(normalized)

    if failed_symbols:
        # Partial-failure summary so the bad-symbol rate is visible in logs
        # even when some symbols succeeded.
        logger.warning(
            "Binance per-symbol fetch: %d/%d symbols failed",
            len(failed_symbols), len(symbols),
        )
        # Audit-2026-05-07 C-0225 — pre-fix, partial-symbol failures were
        # logged but not surfaced. Allocator dashboards rendered the
        # successful subset as canonical, silently dropping (e.g.) ETH
        # fills while showing BTC fills. Surface the failed symbols via
        # the per-task DQ buffer so the worker can stamp them into
        # ``strategy_analytics.data_quality_flags.binance_partial_symbols``.
        # Total-failure escalation (next branch) still raises so the job
        # is marked failed_retry.
        _record_dq_flag("binance_partial_symbols", list(failed_symbols))
        # Total failure with no successful symbols mirrors the
        # ColdStartSymbolDiscoveryError contract — every fill is silently
        # dropped, so the sync looks empty. Raise so the worker marks the
        # job failed_retry instead of cementing zero-fills success.
        if len(failed_symbols) == len(symbols) and first_error is not None:
            raise BinancePerSymbolFetchError(failed_symbols, first_error)

    return fills


async def _fetch_raw_trades_okx(
    exchange: ccxt.Exchange,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """OKX: private_get_trade_fills_history with cursor-based pagination."""
    fills: list[dict[str, Any]] = []
    cursor = ""
    prev_cursor = ""
    natural_break = False

    PAGE_CAP = 100
    for page in range(PAGE_CAP):
        params: dict[str, str] = {"instType": "SWAP", "limit": "100"}
        # OKX fills-history returns DESC-sorted data; ``after=<billId>``
        # fetches records OLDER than the cursor (``before`` fetches NEWER).
        # Using ``before`` here would oscillate until the page cap (H-0665).
        if cursor:
            params["after"] = cursor
        # ``begin`` must be sent on every page — without it OKX falls back
        # to its default window (often 7 days) on pages 2+ and silently
        # truncates a 90-day backfill (H-0666).
        if since_ms:
            params["begin"] = str(since_ms)

        try:
            result = await exchange.private_get_trade_fills_history(params)
            data = result.get("data", [])
            if not data:
                natural_break = True
                break

            for fill in data:
                ts_raw = fill.get("ts", "")
                if ts_raw and ts_raw.isdigit():
                    ts_dt = datetime.fromtimestamp(
                        int(ts_raw) / 1000, tz=timezone.utc
                    )
                else:
                    # Drop fills with unparseable ``ts`` rather than
                    # substituting wall-clock time — phantom timestamps
                    # corrupt FIFO position reconstruction silently
                    # (C-0226 / H-0667). Log the parse target + fill_id
                    # only (never the raw fill body) so attacker- or
                    # PII-bearing fields can't reach log aggregation.
                    logger.error(
                        "OKX fill dropped: unparseable ts=%r (instId=%s, tradeId=%s)",
                        ts_raw,
                        fill.get("instId"),
                        fill.get("tradeId"),
                    )
                    continue

                symbol = fill.get("instId", "").replace("-", "")
                side = fill.get("side", "").lower()
                # Audit-2026-05-07 H-0661 — finite-value validation. Pre-fix
                # NaN/inf strings could land in the typed numeric columns and
                # corrupt every downstream metric. Drop the fill on a
                # non-finite price / amount; treat non-finite fee as 0.
                price_chk = _finite_float(fill.get("fillPx", 0), label="OKX fillPx")
                amount_chk = _finite_float(fill.get("fillSz", 0), label="OKX fillSz")
                if price_chk is None or amount_chk is None:
                    logger.error(
                        "OKX fill dropped: non-finite price=%r or amount=%r "
                        "(instId=%s, tradeId=%s)",
                        fill.get("fillPx"), fill.get("fillSz"),
                        fill.get("instId"), fill.get("tradeId"),
                    )
                    continue
                price = price_chk
                amount = amount_chk
                # Preserve signed fee so maker rebates (negative) reduce
                # ``total_fees`` instead of inflating it via abs() (H-0671).
                fee_chk = _finite_float(fill.get("fee", 0), label="OKX fee")
                fee = fee_chk if fee_chk is not None else 0.0
                fee_currency = fill.get("feeCcy", "USDT")
                # Audit-2026-05-07 H-0670 — surface mismatch when fees are
                # paid in a currency other than the pair's quote.
                _check_fee_currency_mismatch(
                    exchange="okx", symbol=symbol, fee_currency=fee_currency,
                )
                is_maker = fill.get("execType", "") == "M"

                raw_data = dict(fill)
                # Audit-2026-05-07 G12.B.4 — populate position_direction
                # via whitelist instead of raw passthrough. OKX's posSide
                # is documented as long/short/net, but anything else
                # would silently land in the typed column. Reject and
                # log so contract violations are visible.
                pos_side_raw = fill.get("posSide")
                position_direction: Literal["long", "short"] | None = None
                if pos_side_raw is None or pos_side_raw == "":
                    position_direction = None
                elif pos_side_raw in _OKX_VALID_POS_SIDES:
                    # Preserve raw_data alignment with prior behavior.
                    raw_data["posSide"] = pos_side_raw
                    if pos_side_raw == "net":
                        # 'net' is one-way mode — direction is implied by
                        # side, not a long/short hedge flag.
                        position_direction = None
                    else:
                        position_direction = pos_side_raw  # "long" | "short"
                else:
                    logger.warning(
                        "invalid posSide value=%s, using None", pos_side_raw
                    )
                    position_direction = None

                fills.append(_make_fill_dict(
                    exchange="okx",
                    symbol=symbol,
                    side=side,
                    price=price,
                    quantity=amount,
                    fee=fee,
                    fee_currency=fee_currency,
                    timestamp=ts_dt.isoformat(),
                    exchange_order_id=fill.get("ordId", ""),
                    exchange_fill_id=fill.get("tradeId", ""),
                    is_maker=is_maker,
                    raw_data=raw_data,
                    position_direction=position_direction,
                ))

            new_cursor = data[-1].get("tradeId", "")

            # Adversarial-review hardening (PR #137 follow-up): a short
            # final page that legitimately shares its trailing tradeId
            # with the previous page's cursor would otherwise trip the
            # stuck-cursor warning even though we're about to break
            # naturally on `len(data) < 100`. Take the natural-break
            # exit FIRST so short pages don't produce false-positive
            # "stuck" warnings.
            if len(data) < 100:
                prev_cursor = new_cursor
                cursor = new_cursor
                natural_break = True
                break

            # Audit-2026-05-07 G12.B.6 — stuck-cursor guard (full pages
            # only). If the exchange returns the same trailing tradeId
            # twice on a FULL page, we'd otherwise loop until the page
            # cap and yield 100 pages of duplicates. Empty tradeId is
            # also a hard stop (the next request would re-issue with
            # no `before`, restarting from the most recent).
            if not new_cursor:
                logger.warning(
                    "Pagination stuck on cursor=%s for exchange=okx; terminating early",
                    new_cursor,
                )
                natural_break = True
                break
            if prev_cursor and new_cursor == prev_cursor:
                logger.warning(
                    "Pagination stuck on cursor=%s for exchange=okx; terminating early",
                    new_cursor,
                )
                natural_break = True
                break

            prev_cursor = new_cursor
            cursor = new_cursor
        except Exception as e:
            # Re-raise per-page failures so the sync_trades job is marked
            # failed_retry and resumes via cursor on the next attempt
            # instead of silently truncating mid-pagination (C-0227).
            logger.error(
                "OKX fills fetch failed page %d (re-raising to fail the sync): %s",
                page, str(e),
            )
            raise

    if not natural_break:
        # Audit-2026-05-07 M-0663 — record a transient DQ flag so the
        # caller (job_worker) can stamp ``sync_truncated_okx`` into
        # ``strategy_analytics.data_quality_flags``. Pre-fix the warning
        # was log-only; the admin compute-jobs UI / health card had no
        # way to surface truncation. A 90-day backfill on a busy
        # strategy can exceed 100 pages × 100 fills = 10K and lose the
        # tail silently.
        logger.warning(
            "Pagination hit %d-page cap for okx; possible truncation",
            PAGE_CAP,
        )
        _record_dq_flag("sync_truncated_okx", True)
        _record_dq_flag("sync_truncated_okx_pages", int(PAGE_CAP))

    return fills


async def _fetch_raw_trades_bybit(
    exchange: ccxt.Exchange,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Bybit: private_get_v5_execution_list with cursor-based pagination."""
    fills: list[dict[str, Any]] = []
    cursor = ""
    natural_break = False

    PAGE_CAP = 100
    for page in range(PAGE_CAP):
        params: dict[str, str] = {"category": "linear", "limit": "100"}
        if cursor:
            params["cursor"] = cursor
        if since_ms and not cursor:
            params["startTime"] = str(since_ms)

        try:
            result = await exchange.private_get_v5_execution_list(params)
            items = result.get("result", {}).get("list", [])
            if not items:
                natural_break = True
                break

            for fill in items:
                ts_raw = fill.get("execTime", "")
                if ts_raw and ts_raw.isdigit():
                    ts_dt = datetime.fromtimestamp(
                        int(ts_raw) / 1000, tz=timezone.utc
                    )
                else:
                    # Drop fills with unparseable ``execTime`` (C-0226 /
                    # H-0667) — same rationale as the OKX branch. Log
                    # whitelisted fields only.
                    logger.error(
                        "Bybit fill dropped: unparseable execTime=%r (symbol=%s, execId=%s)",
                        ts_raw,
                        fill.get("symbol"),
                        fill.get("execId"),
                    )
                    continue

                symbol = fill.get("symbol", "")
                side = fill.get("side", "").lower()
                # Audit-2026-05-07 H-0661 — finite-value validation; same
                # rationale as the OKX branch.
                price_chk = _finite_float(
                    fill.get("execPrice", 0), label="Bybit execPrice"
                )
                amount_chk = _finite_float(
                    fill.get("execQty", 0), label="Bybit execQty"
                )
                if price_chk is None or amount_chk is None:
                    logger.error(
                        "Bybit fill dropped: non-finite price=%r or amount=%r "
                        "(symbol=%s, execId=%s)",
                        fill.get("execPrice"), fill.get("execQty"),
                        fill.get("symbol"), fill.get("execId"),
                    )
                    continue
                price = price_chk
                amount = amount_chk
                # Preserve signed fee so maker rebates remain negative
                # (H-0671) — same rationale as the OKX branch.
                fee_chk = _finite_float(
                    fill.get("execFee", 0), label="Bybit execFee"
                )
                fee = fee_chk if fee_chk is not None else 0.0
                fee_currency = fill.get("feeCurrency", "USDT")
                # Audit-2026-05-07 H-0670 — fee-currency mismatch flag.
                _check_fee_currency_mismatch(
                    exchange="bybit", symbol=symbol, fee_currency=fee_currency,
                )
                # Audit-2026-05-07 G12.B.9 — Bybit V5 sometimes returns
                # boolean true/false (post JSON decode) and sometimes
                # capital "True"/"TRUE". Strict string equality silently
                # mis-classifies maker fills as taker, distorting the
                # maker_ratio analytic + fee analysis. Accept either
                # boolean True or any case-insensitive "true" string.
                _raw_is_maker = fill.get("isMaker")
                is_maker = _raw_is_maker is True or (
                    isinstance(_raw_is_maker, str)
                    and _raw_is_maker.lower() == "true"
                )

                fills.append(_make_fill_dict(
                    exchange="bybit",
                    symbol=symbol,
                    side=side,
                    price=price,
                    quantity=amount,
                    fee=fee,
                    fee_currency=fee_currency,
                    timestamp=ts_dt.isoformat(),
                    exchange_order_id=fill.get("orderId", ""),
                    exchange_fill_id=fill.get("execId", ""),
                    is_maker=is_maker,
                    raw_data=dict(fill),
                    # Audit-2026-05-07 G12.B.4 — Bybit-side direction
                    # derivation (closeOnTrigger, hedge mode flag) is
                    # not in this batch's scope. Leave None; downstream
                    # consumers fall back to side-based inference.
                    position_direction=None,
                ))

            next_cursor = result.get("result", {}).get("nextPageCursor", "")
            # Audit-2026-05-07 G12.B.6 — stuck-cursor guard. If Bybit
            # returns the SAME nextPageCursor on a subsequent call, we'd
            # otherwise loop until the page cap. Falsy nextPageCursor is
            # the documented natural-stop condition.
            if not next_cursor:
                natural_break = True
                break
            if next_cursor == cursor:
                logger.warning(
                    "Pagination stuck on cursor=%s for exchange=bybit; terminating early",
                    next_cursor,
                )
                natural_break = True
                break
            cursor = next_cursor
        except Exception as e:
            # Re-raise per-page failures (C-0227) — same rationale as the
            # OKX branch.
            logger.error(
                "Bybit execution list failed page %d (re-raising to fail the sync): %s",
                page, str(e),
            )
            raise

    if not natural_break:
        # Audit-2026-05-07 M-0663 — same DQ flag pattern as OKX. Bybit
        # cursor pagination doesn't expose a "has_more" hint other than
        # nextPageCursor, so hitting the page cap is the only signal
        # truncation occurred.
        logger.warning(
            "Pagination hit %d-page cap for bybit; possible truncation",
            PAGE_CAP,
        )
        _record_dq_flag("sync_truncated_bybit", True)
        _record_dq_flag("sync_truncated_bybit_pages", int(PAGE_CAP))

    return fills


def _normalize_fill(trade: dict, exchange_id: str) -> FillRow | None:
    """Normalize a CCXT unified trade to our fill dict shape.

    Delegates to ``_make_fill_dict`` so OKX, Bybit, and CCXT branches
    share a single 16-key contract. Returns ``None`` for fills missing
    or carrying unparseable price/quantity/timestamp; callers MUST
    filter ``None`` before persisting (H-0673; silent-failure parity
    with the OKX/Bybit branches).
    """
    fee_info = trade.get("fee") or {}
    # Maker rebates arrive as negative fee.cost in CCXT's unified shape;
    # preserve the sign so position_reconstruction's
    # ``realized_pnl -= total_fees`` subtracts a smaller total instead of
    # an inflated one (H-0671).
    fee_cost = _safe_float(fee_info.get("cost"))
    if fee_cost is None:
        fee_cost = 0.0  # CCXT omits fee on some venues; treat as 0 fee.
    fee_currency = fee_info.get("currency", "USDT") or "USDT"

    # Drop fill on missing/non-numeric price or quantity. Pre-Phase B
    # this branch silently substituted 0, mirroring the H-0673 timestamp
    # bug — a phantom $0 row inflated total_fills, dragged volume %s
    # toward "no signal", and let maker rebates land on a 0-priced fill.
    price = _safe_float(trade.get("price"))
    amount = _safe_float(trade.get("amount"))
    if price is None or amount is None:
        logger.error(
            "CCXT fill dropped: missing/non-numeric price=%r or amount=%r "
            "(exchange=%s, fill_id=%r)",
            trade.get("price"), trade.get("amount"),
            exchange_id, trade.get("id"),
        )
        return None

    # Prefer numeric ``timestamp`` (CCXT unified ms); fall back to
    # ``datetime`` (ISO with Z). Empty-string, None, 0 (epoch), and bool
    # are skipped — a 1970 phantom row corrupts FIFO ordering identically
    # to the H-0673 bug, and ``True`` (bool, int subclass) would coerce
    # to epoch+1ms. ``not raw`` covers all four falsy shapes in one check.
    # On per-iteration parse failure, log at WARN so primary-field
    # producer drift is visible even when the fallback succeeds.
    timestamp_iso: str | None = None
    for field, raw in (
        ("timestamp", trade.get("timestamp")),
        ("datetime", trade.get("datetime")),
    ):
        if not raw or isinstance(raw, bool):
            continue
        try:
            timestamp_iso = coerce_to_aware_utc(raw, "ccxt").isoformat()
            break
        except (TypeError, ValueError, OSError, OverflowError) as exc:
            logger.warning(
                "CCXT fill: %s parse failed (%s=%r): %s; trying fallback",
                field, field, raw, exc,
            )
            continue
    if timestamp_iso is None:
        logger.error(
            "CCXT fill dropped: unparseable timestamp "
            "(exchange=%s, fill_id=%r, datetime=%r, timestamp=%r)",
            exchange_id, trade.get("id"),
            trade.get("datetime"), trade.get("timestamp"),
        )
        return None

    normalized_symbol = (
        trade.get("symbol", "")
        .replace("/", "").replace(":USDT", "").replace(":USD", "")
    )
    # Audit-2026-05-07 H-0670 — fee-currency mismatch flag. Use the
    # CCXT-unified ``symbol`` (pre-normalization, with the "BTC/USDT:USDT"
    # form) so ``_infer_quote_currency`` can use the explicit ":USDT"
    # marker; fall back to the normalized form if absent.
    _quote_source_symbol = trade.get("symbol") or normalized_symbol
    _check_fee_currency_mismatch(
        exchange=exchange_id,
        symbol=_quote_source_symbol,
        fee_currency=fee_currency,
    )

    return _make_fill_dict(
        exchange=exchange_id,
        symbol=normalized_symbol,
        side=trade.get("side", ""),
        price=price,
        quantity=amount,
        fee=fee_cost,
        fee_currency=fee_currency,
        timestamp=timestamp_iso,
        exchange_order_id=trade.get("order", ""),
        exchange_fill_id=trade.get("id", ""),
        is_maker=trade.get("takerOrMaker") == "maker",
        raw_data=trade.get("info"),
        position_direction=None,
    )


async def fetch_all_trades(exchange: ccxt.Exchange, symbol: str | None = None, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from exchange. Uses account-level APIs instead of
    scanning individual trading pairs (which is 200+ API calls on OKX)."""
    return await fetch_daily_pnl(exchange, since_ms)


def parse_since_ms(
    last_sync_at: str | None,
    preferred: str | None = None,
) -> int | None:
    """Parse an ISO timestamp to milliseconds epoch.

    When `preferred` is provided and non-null, it is used in place of
    `last_sync_at`. This is how sync_trades resumes from the
    `last_fetched_trade_timestamp` partial-success checkpoint (migration 045)
    while keeping `last_sync_at` fallback behavior for callers that haven't
    adopted the new cursor.
    """
    value = preferred if preferred is not None else last_sync_at
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception as exc:
        # Audit-2026-05-07 #10: returning None silently means "fetch from
        # the beginning of time" to fetch_all_trades, which burns API
        # quota and can collide with sync_trades' DELETE+INSERT (audit
        # item #2). Log the bad value so an operator can spot a malformed
        # ISO timestamp on api_keys.last_sync_at instead of debugging a
        # quiet full-history refetch.
        logger.warning(
            "parse_since_ms: failed to parse %r — caller will refetch from start: %s",
            value, exc,
        )
        return None


async def fetch_usdt_balance(exchange: ccxt.Exchange) -> float | None:
    """Fetch total USDT balance from exchange. Returns None on failure.

    Audit-2026-05-07 #9 — this thin wrapper is preserved for backwards
    compatibility with callers that don't yet care about the
    distinction between "balance unavailable due to error" and "balance
    legitimately not provided" (e.g. an account with zero USDT). New
    code paths that feed `data_quality_flags` should call
    `fetch_usdt_balance_with_status` instead and propagate the
    `balance_error` flag through to `strategy_analytics.computation_status
    = 'complete_with_warnings'` when the heuristic-capital fallback is
    used. The two-state wrapper drops the error flag, so a transient
    exchange-API failure here looks identical to a legitimate "no
    balance" reading — exactly the silent-degradation surface the
    audit flagged. See `fetch_usdt_balance_with_status` below.
    """
    balance, _err = await fetch_usdt_balance_with_status(exchange)
    return balance


async def fetch_usdt_balance_with_status(
    exchange: ccxt.Exchange,
) -> tuple[float | None, bool]:
    """Audit-2026-05-07 #9 — fetch total USDT balance AND surface whether
    an error prevented the read.

    Returns a ``(balance, balance_error)`` tuple:

        * ``(float, False)`` — successful read, positive USDT balance.
        * ``(None, False)`` — successful read, zero / missing USDT
          balance (drained or unfunded account). NOT an error condition.
        * ``(None, True)`` — exchange API failure (network, rate-limit,
          auth, malformed response). Caller MUST propagate this through
          to `data_quality_flags.balance_error = True` AND set
          `strategy_analytics.computation_status = 'complete_with_warnings'`
          when the heuristic-capital fallback is used downstream.

    Pre-fix `fetch_usdt_balance` collapsed both `(None, False)` and
    `(None, True)` into a bare `None`, so a transient OKX 5xx during
    the analytics window silently degraded a verified institutional
    strategy's CAGR/Sharpe by 5–10× via the heuristic-capital path
    (`transforms.py::trades_to_daily_returns`). The factsheet rendered
    those degraded numbers as canonical, with no DQF chip and no
    operator alert.
    """
    try:
        balance = await exchange.fetch_balance()
    except Exception as e:
        # Use exception() to capture the full traceback so operators can
        # tell auth failures (revoked key) from rate-limit surges from
        # network drops without re-running the job. The pre-fix
        # warning(str(e)) lost the stack and obscured root cause.
        logger.exception("Could not fetch account balance: %s", str(e))
        return None, True
    try:
        usdt_total = balance.get("total", {}).get("USDT", 0)
        if usdt_total and float(usdt_total) > 0:
            return float(usdt_total), False
    except (TypeError, ValueError, AttributeError) as e:
        # Malformed response shape from a misbehaving exchange / mock —
        # treat as an error read, not as a legitimate "no balance".
        logger.exception(
            "Malformed balance response shape: %s", str(e)
        )
        return None, True
    # Successful read, but USDT balance is zero / absent. Legitimate
    # state for a paper / drained account; not an error.
    return None, False


# ---------------------------------------------------------------------------
# Phase 19 / BACKBONE-06 — fetch_mark_prices for open-perp valuation.
# ---------------------------------------------------------------------------
# 60s in-process cache prevents fan-out hammering the broker on every
# equity-curve recompute. Mirrors the existing in-process cache pattern
# elsewhere in services/ (e.g. key_permissions._FAIL_CLOSED).
import time

_MARK_PRICE_CACHE: dict[str, tuple[float, float]] = {}
_MARK_PRICE_TTL_S = 60.0


async def fetch_mark_prices(
    exchange: ccxt.Exchange,
    instruments: list[str],
) -> dict[str, float]:
    """Phase 19 / BACKBONE-06. Fetch current mark prices for open perp instruments.

    60s in-process cache prevents fan-out hammering on equity-curve
    recompute. Returns ``{symbol: price}`` for every requested symbol that
    has a mark; symbols missing on the exchange are absent from the dict
    (caller decides what to do — typical CSV path supplies an empty list).

    Per-exchange branches:
      * OKX:     ``public_get_public_mark_price({"instId": sym})`` →
                 ``data[0].markPx``.
      * Binance: ``fapiPublic_get_premiumindex()`` (mark-price endpoint;
                 returns a list keyed by ``symbol`` + ``markPrice``).
      * Bybit:   ``private_get_v5_market_tickers({"category": "linear"})``
                 → ``result.list[*].markPrice``.

    Failures are logged at warning level; the symbol simply does not appear
    in the returned dict. The caller should fall back to the entry price
    or treat the open position as flat.
    """
    now = time.monotonic()
    result: dict[str, float] = {}
    to_fetch: list[str] = []
    for sym in instruments or []:
        cached = _MARK_PRICE_CACHE.get(sym)
        if cached and cached[1] > now:
            result[sym] = cached[0]
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return result

    if exchange.id == "okx":
        # CR-perf-1 — wrap per-symbol calls in asyncio.gather so a portfolio
        # with N open perps takes ~one round-trip instead of N sequential
        # ones. OKX has no instType-wide batch endpoint that returns a
        # single-shot list of mark prices, so we still fan out one request
        # per symbol — but in parallel. return_exceptions=True keeps a
        # single failed symbol from torpedoing the whole batch.
        import asyncio

        async def _fetch_one(sym: str):
            try:
                resp = await exchange.public_get_public_mark_price(
                    {"instId": sym}
                )
                rows = (resp or {}).get("data") or []
                if not rows:
                    return sym, None
                return sym, float(rows[0]["markPx"])
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "fetch_mark_prices OKX failed for %s: %s", sym, exc
                )
                return sym, None

        gathered = await asyncio.gather(
            *(_fetch_one(s) for s in to_fetch), return_exceptions=False
        )
        for sym, price in gathered:
            if price is None:
                continue
            result[sym] = price
            _MARK_PRICE_CACHE[sym] = (price, now + _MARK_PRICE_TTL_S)
    elif exchange.id == "binance":
        try:
            resp = await exchange.fapiPublic_get_premiumindex()
            rows = resp if isinstance(resp, list) else []
            wanted = set(to_fetch)
            for row in rows:
                sym = row.get("symbol")
                if sym in wanted:
                    try:
                        price = float(row["markPrice"])
                    except (KeyError, TypeError, ValueError) as exc:
                        # PR #181 take-2 silent-failure-hunter HIGH F3:
                        # the prior bare `continue` silently dropped any
                        # row whose markPrice was missing or malformed.
                        # Caller (per docstring above) treats absent
                        # symbols as flat positions in equity-curve
                        # recompute — schema drift would silently corrupt
                        # valuation. Mirror the OKX per-symbol WARNING.
                        logger.warning(
                            "fetch_mark_prices Binance: dropping sym=%s unparseable markPrice=%r: %s",
                            sym, row.get("markPrice"), exc,
                        )
                        continue
                    result[sym] = price
                    _MARK_PRICE_CACHE[sym] = (
                        price,
                        now + _MARK_PRICE_TTL_S,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_mark_prices Binance failed: %s", exc)
    elif exchange.id == "bybit":
        try:
            resp = await exchange.private_get_v5_market_tickers(
                {"category": "linear"}
            )
            tickers = (resp or {}).get("result", {}).get("list", []) or []
            wanted = set(to_fetch)
            for row in tickers:
                sym = row.get("symbol")
                if sym in wanted:
                    try:
                        price = float(row["markPrice"])
                    except (KeyError, TypeError, ValueError) as exc:
                        # PR #181 take-2 silent-failure-hunter HIGH F3:
                        # same silent-drop pattern as Binance — log the
                        # symbol that was dropped so schema drift surfaces.
                        logger.warning(
                            "fetch_mark_prices Bybit: dropping sym=%s unparseable markPrice=%r: %s",
                            sym, row.get("markPrice"), exc,
                        )
                        continue
                    result[sym] = price
                    _MARK_PRICE_CACHE[sym] = (
                        price,
                        now + _MARK_PRICE_TTL_S,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_mark_prices Bybit failed: %s", exc)
    else:
        logger.warning(
            "fetch_mark_prices: unknown exchange.id=%s", exchange.id
        )

    return result


def _reset_mark_price_cache_for_tests() -> None:
    """Test-only helper: clear the in-process mark-price cache."""
    _MARK_PRICE_CACHE.clear()
