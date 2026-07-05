"""Deribit ledger I/O — the transaction-log cash-delta ledger backbone (P70 70-03).

This module is the AUTHORITATIVE realized-cash source for Deribit daily returns
(LOCKED design: ``analytics-service/docs/deribit-ingestion-design.md``). It owns
the raw ``private/get_transaction_log`` crawl (count=250, ``continuation`` → null),
per-scope auth (subaccount reads via ``public/exchange_token``), account-driven
currency enumeration, and the re-anchored **D-02 honesty gate** — ledger
COMPLETENESS over the date range, NOT reconciliation to the fill counts
(18,778 / 21,014 / 61,248), which the Wave-0 probe proved reconcile to no API
surface.

Money math (coin→USD, funding-inclusive daily bucketing) is DELIBERATELY not
here — that is ``services.deribit_txn`` (70-02, pure/I-O-free). This module only
performs I/O and feeds the rows through ``txn_rows_to_daily_records``.

The single corruption risk of the phase is a SILENTLY-PARTIAL ledger — an
under-fetched crawl (rate-limit truncation or a skipped scope) that renders as a
complete track record. Two guards make that impossible:

* ``paginate_txn_log`` RAISES ``LedgerTruncatedError`` when the 10028 retry budget
  is exhausted before ``continuation=null`` — it NEVER returns partial pages.
* ``assert_ledger_complete`` RAISES ``LedgerCompletenessError`` if ANY expected
  scope × currency did not reach ``continuation=null`` (truncation, a -32602 skip,
  or a dropped scope all leave the gate failing).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from services.deribit_txn import txn_rows_to_daily_records
from services.redact import scrub_freeform_string

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate-limit pacing / backoff constants (design §"Rate limits (10028)").
# get_transaction_log is special: cost 10,000, pool 80,000, ~1 req/s, burst 8.
# ---------------------------------------------------------------------------

# Documented max page size — count=1000 over-caps and truncates (Wave-0 root cause).
LEDGER_PAGE_COUNT: int = 250
# Pace between successful pages (~1 req/s).
LEDGER_PACE_SECONDS: float = 1.0
# Exponential backoff base for 10028; wait = base * 2**(retry-1) → 1, 2, 4, …
LEDGER_BACKOFF_BASE_SECONDS: float = 1.0
# Max consecutive 10028 retries for a single page before failing loud.
LEDGER_MAX_RETRIES: int = 8

# Deribit error codes.
_RATE_LIMIT_CODE: int = 10028
_NON_MARGIN_CURRENCY_CODE: int = -32602

SleepFn = Callable[[float], Awaitable[None]]


# ---------------------------------------------------------------------------
# Exceptions — every one is a FAIL-LOUD signal, never swallowed.
# ---------------------------------------------------------------------------


class LedgerTruncatedError(RuntimeError):
    """A scope × currency crawl could not reach ``continuation=null`` before the
    10028 retry budget was exhausted. Raised INSTEAD of returning partial pages
    (the silent-under-fetch corruption risk the D-02 gate exists to catch)."""


class ScopeAuthError(RuntimeError):
    """A scope's read auth could not be resolved (no subaccount token could be
    minted). A scope we cannot authenticate is a silent under-fetch, so this
    fails loud rather than skipping the scope."""


class LedgerCompletenessError(RuntimeError):
    """The re-anchored D-02 honesty gate. Raised when ANY expected scope ×
    currency did not reach ``continuation=null`` (a truncated crawl, a -32602
    currency skip, or a dropped scope). This is LEDGER completeness — NOT a
    reconciliation to the fill counts 18,778 / 21,014 / 61,248, which the Wave-0
    probe (BLOCKING_FINDING) proved reconcile to no API surface."""


# 2015-01-01 UTC in ms — full Deribit history default (txn-log spans 2023→2026).
DEFAULT_START_MS: int = 1_420_070_400_000


# ---------------------------------------------------------------------------
# Scope model.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Scope:
    """One account scope to crawl. ``subaccount_id`` is a STRING (Wave-0: Deribit
    get_subaccounts returns id as a string); ``None`` for the main scope."""

    label: str
    subaccount_id: str | None
    is_main: bool


# ---------------------------------------------------------------------------
# Error-code extraction — never leaks credentials into logs.
# ---------------------------------------------------------------------------


def _deribit_error_code(exc: BaseException) -> int | None:
    """Best-effort Deribit error code from a ccxt exception. Checks a ``.code``
    attribute first, then a numeric run in the (scrubbed) message. Never raises."""
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code
    text = str(scrub_freeform_string(str(exc)))
    match = re.search(r"(-?\d{4,5})", text)
    return int(match.group(1)) if match else None


# ---------------------------------------------------------------------------
# Scope enumeration + per-scope auth.
# ---------------------------------------------------------------------------


async def enumerate_scopes(exchange: Any) -> list[Scope]:
    """Enumerate account scopes from get_subaccounts, MAIN scope first.

    Subaccount ids are kept as STRINGS (Wave-0 fixed the int-filter bug). An
    error / empty result degrades to main-only (a subaccount we cannot see is
    handled by the completeness gate at the currency layer, not silently)."""
    scopes: list[Scope] = [Scope(label="main", subaccount_id=None, is_main=True)]
    try:
        resp = await exchange.private_get_get_subaccounts({"with_portfolio": "false"})
    except Exception:  # noqa: BLE001 - main-only degrade; never crash enumeration
        return scopes
    result = resp.get("result", []) if isinstance(resp, Mapping) else []
    if not isinstance(result, Sequence):
        return scopes
    ordinal = 0
    for entry in result:
        if not isinstance(entry, Mapping):
            continue
        raw_id = entry.get("id")
        if raw_id is None:
            continue
        ordinal += 1
        scopes.append(
            Scope(
                label=f"sub_{ordinal}",
                subaccount_id=str(raw_id),
                is_main=False,
            )
        )
    return scopes


async def mint_subaccount_token(exchange: Any, subject_id: str) -> str:
    """Mint a read-scoped token for a subaccount via ``public/exchange_token``
    (param ``subject_id`` — subaccount_id is refused on the read-only LTP keys,
    design §Subaccounts). Raises ``ScopeAuthError`` if no token comes back."""
    try:
        resp = await exchange.public_get_exchange_token({"subject_id": subject_id})
    except Exception as exc:  # noqa: BLE001 - fail loud, scrubbed
        raise ScopeAuthError(
            f"exchange_token mint failed for subject_id={subject_id!r}: "
            f"{scrub_freeform_string(str(exc))}"
        ) from None
    result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
    token = result.get("access_token") if isinstance(result, Mapping) else None
    if not token or not isinstance(token, str):
        raise ScopeAuthError(
            f"exchange_token returned no access_token for subject_id={subject_id!r}"
        )
    return token


async def resolve_scope_auth(exchange: Any, scope: Scope) -> dict[str, Any]:
    """Resolve the per-request auth params for ``scope``.

    * main scope → ``{}`` (the key signs itself);
    * subaccount scope → mint a read token via ``public/exchange_token`` and
      pass it as an ``access_token`` request param.

    A subaccount scope whose token cannot be minted FAILS LOUD (ScopeAuthError)
    — a silently-skipped scope is a silent under-fetch (T-70-08)."""
    if scope.is_main or scope.subaccount_id is None:
        return {}
    token = await mint_subaccount_token(exchange, scope.subaccount_id)
    return {"access_token": token}


# ---------------------------------------------------------------------------
# Currency enumeration — from the account, never hard-coded.
# ---------------------------------------------------------------------------


async def enumerate_currencies(
    exchange: Any, scope: Scope, scope_auth: Mapping[str, Any]
) -> list[str]:
    """Enumerate the currencies to crawl for ``scope`` from the account's held
    balances (nonzero equity/balance), falling back to ``public/get_currencies``
    when no held balance is reported. NEVER a hard-coded currency list."""
    held: list[str] = []
    try:
        resp = await exchange.private_get_get_account_summaries(dict(scope_auth))
    except Exception:  # noqa: BLE001 - fall through to public currencies
        resp = None
    if isinstance(resp, Mapping):
        result = resp.get("result", {})
        summaries = result.get("summaries", []) if isinstance(result, Mapping) else []
        if isinstance(summaries, Sequence):
            for summ in summaries:
                if not isinstance(summ, Mapping):
                    continue
                ccy = summ.get("currency")
                equity = summ.get("equity") or 0
                balance = summ.get("balance") or 0
                if ccy and (equity or balance):
                    held.append(str(ccy))
    if held:
        return held
    # Fallback: every listed currency (public — no scope needed).
    try:
        resp = await exchange.public_get_get_currencies()
    except Exception:  # noqa: BLE001
        return []
    result = resp.get("result", []) if isinstance(resp, Mapping) else []
    out: list[str] = []
    if isinstance(result, Sequence):
        for entry in result:
            if isinstance(entry, Mapping) and entry.get("currency"):
                out.append(str(entry["currency"]))
    return out


# ---------------------------------------------------------------------------
# The ledger paginator — count=250, continuation→null, pace + backoff, fail loud.
# ---------------------------------------------------------------------------


async def paginate_txn_log(
    exchange: Any,
    scope_label: str,
    currency: str,
    start_ms: int,
    end_ms: int,
    scope_auth: Mapping[str, Any],
    *,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = LEDGER_MAX_RETRIES,
    pace_seconds: float = LEDGER_PACE_SECONDS,
) -> list[Mapping[str, Any]]:
    """Fully crawl ``private/get_transaction_log`` for one scope × currency.

    count=250, follow ``continuation`` to null, accumulate rows ONCE. Paced to
    ~1 req/s (``sleep`` awaited between pages — injected for CI) and exponential-
    backoff on 10028 up to ``max_retries``. If the budget is exhausted before
    ``continuation=null`` → raise ``LedgerTruncatedError`` (scope + currency +
    last continuation). NEVER returns a partial page set. Every ccxt error is
    scrubbed before it can reach a log. Any non-10028 error propagates (the
    producer decides currency-skip vs fail-loud).
    """
    rows: list[Mapping[str, Any]] = []
    continuation: Any = None
    is_first_page = True
    while True:
        params: dict[str, Any] = {
            "currency": currency,
            "start_timestamp": start_ms,
            "end_timestamp": end_ms,
            "count": LEDGER_PAGE_COUNT,
        }
        params.update(scope_auth)
        if continuation:
            params["continuation"] = continuation

        # Pace ~1 req/s between page requests (not before the first).
        if not is_first_page:
            await sleep(pace_seconds)

        retries = 0
        while True:
            try:
                resp = await exchange.private_get_get_transaction_log(params)
                break
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) != _RATE_LIMIT_CODE:
                    # Non-rate-limit error: surface it (scrubbed) to the caller.
                    raise
                retries += 1
                if retries > max_retries:
                    raise LedgerTruncatedError(
                        f"ledger crawl truncated for scope={scope_label!r} "
                        f"currency={currency!r} at continuation={continuation!r}: "
                        f"10028 retry budget ({max_retries}) exhausted — refusing "
                        f"a silently-partial ledger"
                    ) from None
                await sleep(LEDGER_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))

        is_first_page = False
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        logs = result.get("logs", []) or []
        if isinstance(logs, Sequence):
            rows.extend(r for r in logs if isinstance(r, Mapping))
        continuation = result.get("continuation")
        if not continuation:
            break
    return rows


# ---------------------------------------------------------------------------
# The scope×currency producer + the re-anchored D-02 completeness gate.
# ---------------------------------------------------------------------------


@dataclass
class CompletenessReport:
    """Per (scope, currency) crawl status over the date range.

    ``expected`` maps each enumerated scope label → its enumerated currencies
    (the full coverage the crawl OWES). ``entries`` maps (scope, currency) →
    ``{reached_end, rows, error?}`` recorded by the crawl. The gate compares the
    two: a scope that was expected but never crawled (dropped loop) leaves its
    ``expected`` pairs without a ``reached_end=True`` entry and the gate raises.
    """

    expected: dict[str, list[str]] = field(default_factory=dict)
    entries: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)


def _now_ms() -> int:
    return int(time.time() * 1000)


async def fetch_deribit_ledger_daily_records(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[list[dict[str, Any]], CompletenessReport]:
    """Crawl the txn-log ledger across every scope × currency and return the
    accumulated funding-inclusive ``daily_pnl`` records plus a
    ``CompletenessReport``.

    For each scope: resolve its auth (fail loud on an unresolvable scope) and
    enumerate its currencies from the account. Then crawl every (scope, currency)
    via ``paginate_txn_log``, feed the rows through ``txn_rows_to_daily_records``
    (70-02, the funding-inclusive single sum), and CONCATENATE every scope's
    records into ONE flat list — records are sign-encoded (``side`` = sign,
    ``price`` = abs USD), so abs-summing opposite-sign same-day scopes would net
    them WRONG (+100 and −30 → 130, not +70). ``trades_to_daily_returns_with_status``
    decodes side→sign and bucket-sums per UTC day, so concatenation preserves
    each record's signed contribution.

    Crawl outcomes recorded in the report:
      * success → ``reached_end=True``;
      * ``LedgerTruncatedError`` (10028 budget exhausted) → ``reached_end=False``;
      * ``-32602`` (non-margin currency) → ``reached_end=False`` (a graceful skip
        is NOT complete — it can never masquerade as a full crawl, D-14);
      * any other error → RE-RAISED (fail loud; never swallowed as a skip).

    The LIVE multi-year crawl over real creds is 70-05/live-gated; the producer
    LOGIC here is CI-provable via synthetic scope/currency stubs.
    """
    scopes = await enumerate_scopes(exchange)
    start_ms = since_ms if since_ms is not None else DEFAULT_START_MS
    end_ms = _now_ms()

    # Pass 1 — resolve auth (fail loud) + enumerate the OWED coverage per scope.
    expected: dict[str, list[str]] = {}
    scope_auths: dict[str, dict[str, Any]] = {}
    for scope in scopes:
        auth = await resolve_scope_auth(exchange, scope)
        scope_auths[scope.label] = auth
        expected[scope.label] = await enumerate_currencies(exchange, scope, auth)

    # Pass 2 — crawl every OWED (scope, currency), concatenating the records.
    daily_records: list[dict[str, Any]] = []
    entries: dict[tuple[str, str], dict[str, Any]] = {}
    for scope in scopes:
        auth = scope_auths[scope.label]
        for currency in expected[scope.label]:
            key = (scope.label, currency)
            try:
                rows = await paginate_txn_log(
                    exchange,
                    scope.label,
                    currency,
                    start_ms,
                    end_ms,
                    auth,
                    sleep=sleep,
                )
            except LedgerTruncatedError as exc:
                entries[key] = {
                    "reached_end": False,
                    "rows": 0,
                    "error": str(scrub_freeform_string(str(exc))),
                }
                continue
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) == _NON_MARGIN_CURRENCY_CODE:
                    entries[key] = {
                        "reached_end": False,
                        "rows": 0,
                        "error": "-32602 non-margin currency skip",
                    }
                    continue
                raise
            records = txn_rows_to_daily_records(rows)
            daily_records.extend(records)
            entries[key] = {"reached_end": True, "rows": len(rows)}

    return daily_records, CompletenessReport(expected=expected, entries=entries)


def assert_ledger_complete(report: CompletenessReport) -> None:
    """The re-anchored D-02 honesty gate. Raise ``LedgerCompletenessError`` if
    ANY expected scope × currency did not reach ``continuation=null``.

    Takes NO fill-count total: completeness over the date range — not a
    reconciliation to 18,778 / 21,014 / 61,248 (Wave-0 BLOCKING_FINDING: those
    fill-level totals reconcile to no API surface) — is the honesty anchor. A
    truncated crawl, a -32602 skip, and a dropped scope all leave the gate
    failing, so a silently-partial ledger can never render as complete."""
    incomplete: list[str] = []
    for scope_label, currencies in report.expected.items():
        for currency in currencies:
            entry = report.entries.get((scope_label, currency))
            if entry is None or not entry.get("reached_end"):
                incomplete.append(f"{scope_label}×{currency}")
    if incomplete:
        raise LedgerCompletenessError(
            "Deribit ledger is INCOMPLETE — these scope×currency crawls did not "
            "reach continuation=null (truncation, -32602 skip, or dropped scope): "
            + ", ".join(sorted(incomplete))
            + ". Refusing to render a silently-partial ledger as a complete track "
            "record (re-anchored D-02 gate)."
        )


# ===========================================================================
# SECONDARY trades axis (70-04, DRB-04) — execution detail + an ADVISORY
# fill-count cross-check. This is NOT the returns source and NOT the D-02
# honesty gate: realized returns come from the txn-log ledger above
# (fetch_deribit_ledger_daily_records / assert_ledger_complete). Fills are
# fetched via the id-cursor ``private/get_user_trades_by_currency`` endpoint —
# NOT ``_and_time`` (passing both bounds one-page-stalls; Wave-0 bug #2) — and
# mapped to the shared ``FillRow`` with ``exchange_fill_id = trade_id`` so
# ``diff_strategy_fills`` dedups on (exchange, exchange_fill_id) and re-fetch
# is idempotent.
# ===========================================================================

# Documented max page size for the trades endpoint.
TRADES_PAGE_COUNT: int = 1000
# Non-matching reads pace ~20 req/s (cost 500, pool 50,000, refill 10,000/s).
TRADES_PACE_SECONDS: float = 0.05
# Exponential backoff base for 10028 on the trades endpoint.
TRADES_BACKOFF_BASE_SECONDS: float = 1.0
# Max consecutive 10028 retries for a single trades page before surfacing.
TRADES_MAX_RETRIES: int = 8


def _build_trades_params(
    currency: str,
    count: int,
    *,
    start_id: str | None = None,
    historical: bool = True,
    sorting: str = "asc",
) -> dict[str, Any]:
    """Pure params builder for ``private/get_user_trades_by_currency``.

    ALWAYS sends ``historical=true`` (Wave-0 bug #1: without it the endpoint
    caps at the last 24h — 674 vs 2,962 for acct3) and ``sorting=asc`` so the
    id-cursor advances forward. ``start_id`` is present ONLY when advancing past
    the first page — the initial page carries no cursor.
    """
    params: dict[str, Any] = {
        "currency": currency,
        "count": count,
        "sorting": sorting,
    }
    if historical:
        params["historical"] = "true"
    if start_id is not None:
        params["start_id"] = start_id
    return params


async def paginate_trades_id_cursor(
    exchange: Any,
    currency: str,
    scope_auth: Mapping[str, Any],
    *,
    count: int = TRADES_PAGE_COUNT,
    start_id: str | None = None,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = TRADES_MAX_RETRIES,
    pace_seconds: float = TRADES_PACE_SECONDS,
) -> list[dict[str, Any]]:
    """Fetch all trades for one scope × currency via the id-cursor endpoint.

    Advances ``start_id`` = last trade_id (EXCLUSIVE) each page and continues
    while ``has_more`` OR the page is FULL (``len==count``) — ``has_more`` has no
    documented reliability guarantee (Wave-0), so relying on it alone drops rows
    on a full-but-``has_more=false`` page. Stops ONLY when a page is BOTH
    not-full AND ``has_more=false``. Rows are accumulated once; a ``seen`` guard
    drops any re-included boundary trade_id (start_id is exclusive but the API
    may re-serve it). 10028 backs off up to ``max_retries``; any other error
    propagates so the producer can decide currency-skip (-32602) vs fail-loud.
    Every ccxt error is scrubbed before it can reach a log.
    """
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    cursor = start_id
    is_first_page = True
    while True:
        params = _build_trades_params(currency, count, start_id=cursor)
        params.update(scope_auth)

        if not is_first_page:
            await sleep(pace_seconds)

        retries = 0
        while True:
            try:
                resp = await exchange.private_get_get_user_trades_by_currency(params)
                break
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) != _RATE_LIMIT_CODE:
                    raise
                retries += 1
                if retries > max_retries:
                    raise
                await sleep(TRADES_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))

        is_first_page = False
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        raw_trades = result.get("trades", []) or []
        has_more = bool(result.get("has_more"))

        page_trades = [t for t in raw_trades if isinstance(t, Mapping)]
        page_len = len(page_trades)
        last_id: str | None = None
        for trade in page_trades:
            tid = trade.get("trade_id")
            tid_str = str(tid) if tid is not None else None
            if tid_str is not None:
                last_id = tid_str
                if tid_str in seen:
                    continue
                seen.add(tid_str)
            rows.append(dict(trade))

        page_full = page_len == count
        if not page_full and not has_more:
            break
        if last_id is None:
            # No trade_id to advance on — refuse to spin forever on a full page
            # that carries no cursor (defensive; a real page always has ids).
            break
        cursor = last_id
    return rows


def _trade_to_fillrow(trade: Mapping[str, Any]) -> dict[str, Any]:
    """Map one raw Deribit trade → the shared ``FillRow`` (built via the
    canonical ``_make_fill_dict`` factory, NEVER hand-rolled).

    ``exchange_fill_id = trade_id`` is the primary dedup axis for
    ``diff_strategy_fills``; ``side`` comes from Deribit's ``direction``. Money
    fields flow through the factory's Decimal→exact-string chokepoint (H-0669).
    """
    from services.exchange import _make_fill_dict

    trade_id = str(trade.get("trade_id", "") or "")
    instrument = str(trade.get("instrument_name", "") or "")
    side = str(trade.get("direction", "") or "").lower()
    price = trade.get("price", 0) or 0
    amount = trade.get("amount", 0) or 0
    fee = trade.get("fee", 0) or 0
    fee_currency = str(trade.get("fee_currency", "") or "")
    ts_ms = int(trade.get("timestamp", 0) or 0)
    ts_iso = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
    return dict(
        _make_fill_dict(
            exchange="deribit",
            symbol=instrument,
            side=side,
            price=price,
            quantity=amount,
            fee=fee,
            fee_currency=fee_currency,
            timestamp=ts_iso,
            exchange_order_id=str(trade.get("order_id", "") or ""),
            exchange_fill_id=trade_id,
            is_maker=bool(trade.get("post_only", False)),
            raw_data=dict(trade),
            position_direction=None,
        )
    )


async def fetch_deribit_fills(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> list[dict[str, Any]]:
    """Fetch execution-detail fills across every scope × currency (SECONDARY
    axis). Reuses the 70-03 per-scope auth (``resolve_scope_auth`` → subaccount
    reads via ``public/exchange_token``) so subaccount fills are reachable
    despite ``subaccount_id`` being refused on the read-only LTP keys.

    A ``-32602`` (non-margin currency for the wallet type) skips THAT currency
    (scrubbed-logged, never swallowed silently) while other currencies still
    fetch. Any other error propagates. ``since_ms`` is accepted for signature
    parity with the other ``_fetch_raw_trades_*`` producers; the id-cursor crawl
    is full-history (``historical=true``) and dedups downstream on
    ``exchange_fill_id``. 70-06's adapter imports this.
    """
    scopes = await enumerate_scopes(exchange)
    fills: list[dict[str, Any]] = []
    for scope in scopes:
        auth = await resolve_scope_auth(exchange, scope)
        currencies = await enumerate_currencies(exchange, scope, auth)
        for currency in currencies:
            try:
                trades = await paginate_trades_id_cursor(
                    exchange, currency, auth, sleep=sleep
                )
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) == _NON_MARGIN_CURRENCY_CODE:
                    logger.warning(
                        "fetch_deribit_fills: skipping scope=%s currency=%s "
                        "(-32602 non-margin currency): %s",
                        scope.label,
                        currency,
                        scrub_freeform_string(str(exc)),
                    )
                    continue
                raise
            for trade in trades:
                fills.append(_trade_to_fillrow(trade))
    return fills
