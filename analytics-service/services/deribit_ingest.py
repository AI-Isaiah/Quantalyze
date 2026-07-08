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
import math
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AbstractSet, Any

import pandas as pd

from services.deribit_txn import (
    _INVERSE_CURRENCIES,
    CASH_BEARING_TYPES,
    deribit_dated_external_flows_usd,
    inverse_days_needing_index,
    txn_rows_to_daily_records,
    txn_rows_to_native_daily,
)
from services.external_flows import USD_FAMILY, ExternalFlow
from services.native_nav import NativeLedger
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
    currency did not reach ``continuation=null`` (a truncated crawl or a dropped
    scope). This is LEDGER completeness — NOT a reconciliation to the fill counts
    18,778 / 21,014 / 61,248, which the Wave-0 probe (BLOCKING_FINDING) proved
    reconcile to no API surface."""


class CurrencyEnumerationError(RuntimeError):
    """``public/get_currencies`` could not be read, so the authoritative,
    balance-INDEPENDENT currency universe cannot be established. Enumerating from
    held balances would drop any currency that HELD history but is now
    zero-balance, and the gate graded against that set is blind to the drop — so
    enumeration fails loud rather than under-anchor the expected coverage."""


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


def _deribit_real_code(exc: BaseException) -> int | None:
    """The Deribit error code from an authoritative ``.code`` INTEGER attribute
    ONLY — never a regex-scraped message run. Used for the -32602 "no wallet"
    reclassification (P70 review H1): treating a currency crawl as complete-empty
    must not rest on a 4-5-digit substring that merely happens to appear in an
    unrelated scrubbed message. ``bool`` is rejected (it is an ``int`` subclass)."""
    code = getattr(exc, "code", None)
    if isinstance(code, bool):
        return None
    return code if isinstance(code, int) else None


# ---------------------------------------------------------------------------
# Scope enumeration + per-scope auth.
# ---------------------------------------------------------------------------


def _subaccount_is_funded(entry: Mapping[str, Any]) -> bool:
    """True if a ``get_subaccounts(with_portfolio=true)`` entry holds ANY nonzero
    equity in any currency. Never raises (untrusted exchange input; string-typed
    numerics coerced)."""
    portfolio = entry.get("portfolio")
    if not isinstance(portfolio, Mapping):
        return False
    for pdata in portfolio.values():
        if not isinstance(pdata, Mapping):
            continue
        raw = pdata.get("equity")
        if raw is None or isinstance(raw, bool):
            continue
        try:
            if float(raw) != 0.0:
                return True
        except (TypeError, ValueError):
            continue
    return False


async def enumerate_scopes(exchange: Any) -> list[Scope]:
    """The scope set to crawl: the key's OWN authenticated account — a single
    scope — with a runtime CHECK that the single-scope premise actually holds.

    P70 live evidence (drb03, 2026-07-05): each LTP read-only key authenticates
    AS one Deribit subaccount and its ``get_account_summaries`` / txn-log /
    trades already return that account's COMPLETE data. ``get_subaccounts``
    returns an empty ``type=main`` parent shell plus the key's own account, and
    the key's own equity is byte-identical to that account's portfolio (acct2
    USDC 622,923.41; acct3 USDT 232,500 — both match exactly). The sibling
    subaccounts are NOT separately reachable (``public/exchange_token`` returns
    BadRequest for client-credentials keys — it needs an OAuth refresh_token).

    Review F-2/C1: rather than TRUST that provisioning contract silently, VERIFY
    it. If ``get_subaccounts(with_portfolio=true)`` shows MORE THAN ONE funded
    account, this key is a parent with separately-funded children a single-scope
    crawl would silently miss → FAIL LOUD (``ScopeAuthError``): use one read-only
    key per subaccount. ``<=1`` funded account (the key's own, or none) is the
    safe single-scope case. A ``get_subaccounts`` read error is non-fatal — the
    key's OWN account still crawls correctly and the equity-vs-rows floor
    (job_worker) is the backstop; the check is skipped, not the crawl."""
    scope = [Scope(label="main", subaccount_id=None, is_main=True)]
    try:
        resp = await exchange.private_get_get_subaccounts({"with_portfolio": "true"})
    except Exception as exc:  # noqa: BLE001 - verification only; crawl is unaffected
        logger.warning(
            "deribit enumerate_scopes: get_subaccounts check skipped (%s); "
            "proceeding single-scope",
            scrub_freeform_string(str(exc)),
        )
        return scope
    result = resp.get("result", []) if isinstance(resp, Mapping) else []
    if not isinstance(result, Sequence):
        return scope
    funded = sum(
        1 for e in result if isinstance(e, Mapping) and _subaccount_is_funded(e)
    )
    if funded > 1:
        raise ScopeAuthError(
            f"Deribit key sees {funded} FUNDED subaccounts — a single-scope crawl "
            "would silently miss the siblings (they are not reachable via "
            "exchange_token). Provision one read-only key PER subaccount (design "
            "§Subaccounts / P72) rather than a parent-account key."
        )
    return scope


async def mint_subaccount_token(exchange: Any, subject_id: str) -> str:
    """Mint a read-scoped token for a subaccount via ``public/exchange_token``
    (param ``subject_id`` — subaccount_id is refused on the read-only LTP keys,
    design §Subaccounts). Raises ``ScopeAuthError`` if no token comes back.

    ⚠️ CURRENTLY UNREACHABLE under single-scope enumeration (``enumerate_scopes``
    returns only the key's own ``main`` scope — the LTP key IS its own subaccount,
    drb03). ``public/exchange_token`` was also live-proven to return BadRequest
    for client-credentials keys (it needs an OAuth refresh_token). RETAINED for a
    possible P72 provisioning revisit; kept tested so the contract stays valid."""
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
    """The AUTHORITATIVE, balance-INDEPENDENT currency universe to crawl — every
    wallet currency listed by ``public/get_currencies``.

    Deliberately NOT derived from held balances: a currency that HELD history but
    is now zero-balance would be dropped, and the completeness gate — graded
    against the same held-derived set — would be blind to the gap (the
    self-referential-gate class). Crawling the full public set instead, a
    currency the account never funded surfaces at the crawl as empty (or a
    per-currency ``-32602`` "no wallet") and is recorded complete-empty there.

    A read error, a non-list result, or an empty list FAILS LOUD
    (``CurrencyEnumerationError``): without the authoritative universe the gate
    cannot prove completeness. ``public/get_currencies`` needs no scope/auth —
    ``scope``/``scope_auth`` are kept for signature stability and are the SAME
    set for every scope (the tradeable universe is account-wide)."""
    try:
        resp = await exchange.public_get_get_currencies()
    except Exception as exc:  # noqa: BLE001 - fail loud, never a silent []
        raise CurrencyEnumerationError(
            "Deribit public/get_currencies failed; cannot establish the "
            f"authoritative currency universe: {scrub_freeform_string(str(exc))}."
        ) from None
    result = resp.get("result", []) if isinstance(resp, Mapping) else None
    out: list[str] = []
    if isinstance(result, Sequence):
        for entry in result:
            if isinstance(entry, Mapping) and entry.get("currency"):
                out.append(str(entry["currency"]))
    if not out:
        raise CurrencyEnumerationError(
            "Deribit public/get_currencies returned no currencies; refusing an "
            "empty currency universe (the gate cannot prove completeness against "
            "an empty expected set)."
        )
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
    last continuation). NEVER returns a partial page set: a structurally-degraded
    200 (non-Mapping body/result or non-list ``logs``) raises rather than being
    read as end-of-history (F-1). A FIRST-page ``-32602`` (no wallet for this
    currency, authoritative ``.code`` only) returns ``[]``; a ``-32602`` after
    rows were fetched propagates (fail loud — never drop real rows, F-3). Every
    other non-10028 error propagates. All ccxt errors are scrubbed before logging.
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
                # -32602 "no wallet for this currency" (F-3/H1): honor as an
                # empty crawl ONLY on the FIRST page with zero rows fetched, and
                # ONLY from an authoritative integer .code (never a regex-scraped
                # one). A -32602 AFTER rows exist, or on a continuation page,
                # would DROP already-fetched data → must fail loud. The full
                # public-currency universe includes currencies never funded; those
                # legitimately -32602 on page 1.
                if (
                    _deribit_real_code(exc) == _NON_MARGIN_CURRENCY_CODE
                    and is_first_page
                    and not rows
                ):
                    return []
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
        # F-1: a well-formed done response is a Mapping result with a `logs` LIST
        # and a (null/int) `continuation`. A STRUCTURALLY-DEGRADED 200 (non-Mapping
        # body/result, or `logs` not a list — a proxy/gateway artifact or an API
        # shape change) must NOT be read as end-of-history: that would silently
        # truncate the ledger and pass the completeness gate. Fail loud instead.
        if not isinstance(resp, Mapping) or not isinstance(resp.get("result"), Mapping):
            raise LedgerTruncatedError(
                f"ledger crawl for scope={scope_label!r} currency={currency!r} got a "
                "structurally-degraded response (non-Mapping body/result) — refusing "
                "to treat it as end-of-history"
            )
        result = resp["result"]
        logs = result.get("logs", [])
        if not isinstance(logs, Sequence) or isinstance(logs, (str, bytes)):
            raise LedgerTruncatedError(
                f"ledger crawl for scope={scope_label!r} currency={currency!r} got a "
                "non-list `logs` field — refusing to treat a degraded page as done"
            )
        rows.extend(r for r in logs if isinstance(r, Mapping))
        continuation = result.get("continuation")
        if not continuation:
            break
    return rows


# ---------------------------------------------------------------------------
# Same-day settlement (delivery-price) index — the quiet-day inverse fallback.
# public/get_delivery_prices publishes a SAME-DAY settlement mark per UTC day;
# it is inside D-07's event window (NOT a period-end/current price), so it is a
# legitimate same-time-basis fallback for a coin cash row on a day the ledger
# itself carries no index (e.g. a negative_balance_fee on a quiet day).
# ---------------------------------------------------------------------------

# Documented max page size for get_delivery_prices (paginated newest-first by
# offset; response result.data = [{date, delivery_price}], result.records_total).
DELIVERY_PRICES_PAGE_COUNT: int = 100
# ponytail: a defensive hard page cap so a delivery-price crawl can NEVER spin
# forever on a misbehaving endpoint — 60×100 = 6,000 days (~16y) far exceeds
# Deribit's history; we always stop far earlier at exhaustion or oldest_day.
DELIVERY_PRICES_MAX_PAGES: int = 60


async def fetch_deribit_settlement_index(
    exchange: Any,
    currency: str,
    *,
    oldest_day: str,
    sleep: SleepFn = asyncio.sleep,
) -> dict[str, float]:
    """Per-UTC-day USD settlement index for ``currency`` from the PUBLIC
    ``public/get_delivery_prices`` endpoint (``index_name={ccy}_usd``).

    Pages by ``offset`` newest-first, accumulating ``{date_iso: delivery_price}``
    for every ``delivery_price > 0``, and STOPS at the first of: a short page
    (< ``count`` rows → history exhausted), the map reaching back to
    ``oldest_day`` (``min(dates) <= oldest_day``), or the defensive
    ``DELIVERY_PRICES_MAX_PAGES`` cap. Paces ``sleep`` between pages (mirrors
    ``paginate_txn_log``'s ``LEDGER_PACE_SECONDS``).

    This is a SAME-DAY settlement mark → D-07-compliant same-time-basis fallback,
    NOT a period-end/current price. A failed public read is NON-fatal to
    correctness — the aggregator still fails loud (Fix A) if a needed day stays
    unvalued — so a fetch error returns whatever was accumulated rather than
    crashing the crawl. Every ccxt error is scrubbed before logging.
    """
    index_name = f"{currency.lower()}_usd"
    prices: dict[str, float] = {}
    for page in range(DELIVERY_PRICES_MAX_PAGES):
        if page:
            await sleep(LEDGER_PACE_SECONDS)
        params: dict[str, Any] = {
            "index_name": index_name,
            "offset": page * DELIVERY_PRICES_PAGE_COUNT,
            "count": DELIVERY_PRICES_PAGE_COUNT,
        }
        try:
            resp = await exchange.public_get_get_delivery_prices(params)
        except Exception as exc:  # noqa: BLE001 - non-fatal; return partial map
            logger.warning(
                "deribit get_delivery_prices failed for index_name=%s offset=%s "
                "(%s); returning %d accumulated day(s)",
                index_name,
                params["offset"],
                scrub_freeform_string(str(exc)),
                len(prices),
            )
            return prices
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        data = result.get("data", []) if isinstance(result, Mapping) else []
        if not isinstance(data, Sequence) or isinstance(data, (str, bytes)):
            return prices
        for entry in data:
            if not isinstance(entry, Mapping):
                continue
            date = entry.get("date")
            raw_price = entry.get("delivery_price")
            if not date or raw_price is None:
                continue
            try:
                price = float(raw_price)
            except (TypeError, ValueError):
                continue
            if price > 0:
                prices.setdefault(str(date), price)
        # ponytail: gate exhaustion on a RAW empty page, not `< count` — decouples
        # termination from the exact `count` ceiling (verified 100 live: count=1000
        # clamps to 100, records_total ~2537) so a future page-size change can
        # never truncate the crawl to page 1. The common case still stops early on
        # the oldest-day / MAX_PAGES guards below.
        if len(data) == 0:
            break  # empty page — history exhausted
        if prices and min(prices) <= oldest_day:
            break  # accumulated back to the oldest needed day (newest-first)
    return prices


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

    ``dated_external_flows`` is the honest per-UTC-day ``list[ExternalFlow]`` of
    every external-flow row (transfer/deposit/withdrawal/reward) valued at its
    event-time USD (linear pass-through; inverse coin × same-day settlement index)
    via ``deribit_dated_external_flows_usd`` — the ONE honest valuation path. It
    feeds ONLY the NAV/TWR core's ``F_t`` term (never the realized sum, from which
    ``_EXTERNAL_FLOW_TYPES`` are structurally excluded → count-once), replacing the
    retired net-scalar anchor correction (F1). A withdrawal is NEGATIVE, a deposit
    POSITIVE; an unvaluable inverse flow FAILS LOUD (LedgerValuationError) rather
    than being silently degraded to heuristic capital.
    ``total_return_rows`` is the count of return-bearing rows across the crawl —
    used for the equity-vs-activity floor (C2: material equity + zero rows is a
    silently-empty green ledger).
    """

    expected: dict[str, list[str]] = field(default_factory=dict)
    entries: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    dated_external_flows: list[ExternalFlow] = field(default_factory=list)
    total_return_rows: int = 0


def _now_ms() -> int:
    return int(time.time() * 1000)


async def build_deribit_indexable_currencies(
    exchange: Any,
    currencies: Sequence[str],
    *,
    static_floor: AbstractSet[str] = _INVERSE_CURRENCIES,
) -> frozenset[str]:
    """The real per-job ``indexable_currencies`` set (contract §7.2): the static
    floor UNIONED with every enumerated non-USD-family currency whose ``{ccy}_usd``
    index resolves finite-positive on ``public/get_index_price``.

    The floor (``_INVERSE_CURRENCIES`` = BTC/ETH) is the degraded-mode default —
    currencies known-resolvable WITHOUT a probe — NEVER the ceiling. SOL is
    indexable because ``sol_usd`` resolves; a tokenized-fund wallet (BUIDL/USYC)
    is NOT because its probe raises / has no index, so it keeps failing loud at the
    census consumers (§7.2 branch-3 by construction). This heals the key-1 SOL
    crash on the existing USD-space path (79-CONTEXT G6, revised).

    Probe discipline (mirrors the verbatim shape at the equity anchor's
    ``public_get_get_index_price`` read): USD-family AND static-floor members are
    NEVER probed (BTC/ETH are members by the floor; USDC/USDT are linear), each
    remaining currency is probed AT MOST ONCE (per-job cache, the
    ``settlement_index_cache`` discipline), an unresolvable/raising probe or a
    non-finite/≤0 ``index_price`` leaves the currency OUT. A raised ccxt error is
    scrubbed before logging (leak discipline, ``scrub_freeform_string``).
    """
    probed: set[str] = set()
    seen: set[str] = set()  # per-job: probe each currency at most once
    for currency in currencies:
        ccy = str(currency).upper()
        # USD-family are linear (never index-multiplied); static-floor members are
        # already indexable by definition — neither is ever probed. `seen` makes a
        # duplicated universe entry cost at most one probe.
        if ccy in USD_FAMILY or ccy in static_floor or ccy in seen:
            continue
        seen.add(ccy)
        try:
            resp = await exchange.public_get_get_index_price(
                {"index_name": f"{ccy.lower()}_usd"}
            )
        except Exception as exc:  # noqa: BLE001 - unresolvable index → not indexable
            logger.debug(
                "deribit indexable probe: %s_usd unresolved (%s)",
                ccy.lower(),
                scrub_freeform_string(str(exc)),
            )
            continue
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        raw = result.get("index_price") if isinstance(result, Mapping) else None
        if raw is None:
            continue
        try:
            price = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(price) or price <= 0:
            continue
        probed.add(ccy)
    return frozenset(static_floor | probed)


async def _crawl_deribit_ledger(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[
    list[dict[str, Any]],
    list[Mapping[str, Any]],
    frozenset[str],
    CompletenessReport,
]:
    """Crawl the txn-log ledger across every scope × currency ONCE, returning
    ``(daily_records, raw_rows, indexable, report)``.

    This is the SHARED crawl both the USD-space
    :func:`fetch_deribit_ledger_daily_records` (which discards ``raw_rows`` /
    ``indexable``) and the native-unit :func:`build_deribit_native_ledger` (which
    reads ``raw_rows`` for ``txn_rows_to_native_daily`` + ``report`` for the
    4-field native flows + ``indexable`` for the marks planner) delegate to — so
    the completeness accounting and the per-job ``indexable`` build happen exactly
    ONCE, never duplicated. ``raw_rows`` is the flat concatenation of every
    (scope, currency) ``paginate_txn_log`` page batch (native pnl is an
    order-independent per-(day,ccy) sum, so flat concatenation is lossless).

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
      * ``LedgerTruncatedError`` (10028 budget exhausted) → ``reached_end=False``
        (incomplete — the gate raises);
      * ``-32602`` (no wallet for this currency) → ``reached_end=True, rows=0``
        (complete-empty: the authoritative universe includes currencies this
        scope never funded; a currency WITH history returns rows, not -32602);
      * any other error → RE-RAISED (fail loud; never swallowed as a skip).

    The LIVE multi-year crawl over real creds is 70-05/live-gated; the producer
    LOGIC here is CI-provable via synthetic scope/currency stubs.
    """
    scopes = await enumerate_scopes(exchange)
    start_ms = since_ms if since_ms is not None else DEFAULT_START_MS
    end_ms = _now_ms()

    # Pass 1 — the AUTHORITATIVE OWED coverage: the balance-independent public
    # currency universe (enumerated ONCE — account-wide) crawled across EVERY
    # enumerated scope. Both enumerations fail loud, so `expected` can never be a
    # silently-truncated set the gate would then be blind to.
    currencies = await enumerate_currencies(exchange, scopes[0], {})
    # Build the REAL indexable set ONCE per job (79-CONTEXT G6, revised): the
    # static floor ∪ every enumerated currency whose {ccy}_usd index resolves. This
    # is threaded live into the :636 supplemental-index gate AND every downstream
    # census consumer (inverse_days_needing_index / txn_rows_to_daily_records /
    # deribit_dated_external_flows_usd) so SOL heals on the existing USD-space path
    # — records returned, no LedgerValuationError — while an un-indexable currency
    # (BUIDL / an unresolvable probe) still refuses loudly. Once-per-job, mirroring
    # the settlement_index_cache discipline below.
    indexable = await build_deribit_indexable_currencies(
        exchange, currencies, static_floor=_INVERSE_CURRENCIES
    )
    expected: dict[str, list[str]] = {}
    scope_auths: dict[str, dict[str, Any]] = {}
    for scope in scopes:
        auth = await resolve_scope_auth(exchange, scope)
        scope_auths[scope.label] = auth
        expected[scope.label] = list(currencies)

    # Pass 2 — crawl every OWED (scope, currency), concatenating the records.
    daily_records: list[dict[str, Any]] = []
    raw_rows_all: list[Mapping[str, Any]] = []
    entries: dict[tuple[str, str], dict[str, Any]] = {}
    dated_external_flows: list[ExternalFlow] = []
    total_return_rows = 0
    # Per-currency same-day settlement-index cache (fetched ONCE per inverse
    # currency, reused across every scope) — public/get_delivery_prices is
    # account-wide, so multiple scopes share the same {date: price} map.
    settlement_index_cache: dict[str, dict[str, float]] = {}
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
            # Any other error propagates → fail loud (never a silent skip). A
            # first-page -32602 "no wallet" is absorbed INSIDE paginate_txn_log
            # (returns [] → recorded complete-empty below); a -32602 AFTER rows
            # were fetched escapes here and fails loud (F-3: never drop real rows).
            #
            # P72: an INVERSE (coin-margined) currency may carry a quiet-day cash
            # row (e.g. a negative_balance_fee) on a day with no OWN same-day
            # index — supply the SAME-DAY settlement index (public/get_delivery_
            # prices) so it values D-07-compliantly instead of failing loud. Fetch
            # ONCE per currency (cached across scopes) and only when such days
            # exist; own-row/ledger index always wins inside the aggregator.
            supplemental: dict[tuple[str, str], float] | None = None
            ccy_upper = currency.upper()
            if ccy_upper in indexable:
                needed = {
                    (d, c)
                    for (d, c) in inverse_days_needing_index(
                        rows, indexable_currencies=indexable
                    )
                    if c == ccy_upper
                }
                if needed:
                    needed_min = min(d for (d, _c) in needed)
                    # (Re)fetch when the cache is absent, empty, or too SHALLOW for
                    # this scope's oldest needed day. A later multi-subaccount scope
                    # needing an OLDER quiet day than the first scope's anchor must
                    # not get a too-shallow cache hit → its row would fail loud even
                    # though the settlement history exists (M1 latent trap). A too-
                    # shallow map is replaced by a deeper fetch from offset 0 (cheap);
                    # the `not cached` guard keeps min({}) from ever running. The
                    # cache is keyed by the UPPERCASED currency (FIX 3) so a lowercase
                    # code can never cause a miss / duplicate fetch.
                    cached = settlement_index_cache.get(ccy_upper)
                    if cached is None or not cached or min(cached) > needed_min:
                        settlement_index_cache[ccy_upper] = (
                            await fetch_deribit_settlement_index(
                                exchange,
                                currency,
                                oldest_day=needed_min,
                                sleep=sleep,
                            )
                        )
                    price_map = settlement_index_cache[ccy_upper]
                    supplemental = {
                        (d, c): price_map[d]
                        for (d, c) in needed
                        if d in price_map
                    }
            records = txn_rows_to_daily_records(
                rows,
                supplemental_index=supplemental,
                indexable_currencies=indexable,
            )
            daily_records.extend(records)
            # Retain the RAW rows (flat) for the native-unit adapter's
            # txn_rows_to_native_daily — a per-(day,ccy) sum that is order- and
            # batch-independent, so flat concatenation across scopes is lossless.
            raw_rows_all.extend(r for r in rows if isinstance(r, Mapping))
            # Accumulate the honest DATED external flows (for the core's F_t term)
            # and the return-bearing row count (for the C2 equity-vs-activity floor).
            # The SAME `supplemental` settlement-index map built for
            # txn_rows_to_daily_records feeds the dated producer — the 75-02 Finding
            # C1 extension of inverse_days_needing_index already widened it to cover
            # inverse external-flow quiet days, so a quiet-day coin withdrawal values
            # against its same-day index instead of failing the whole job. Flow rows
            # are _EXTERNAL_FLOW_TYPES (⊆ INFORMATIONAL_TYPES), so they are excluded
            # from the realized `records` above — count-once by construction.
            dated_external_flows.extend(
                deribit_dated_external_flows_usd(
                    rows,
                    supplemental_index=supplemental,
                    indexable_currencies=indexable,
                )
            )
            total_return_rows += sum(
                1
                for r in rows
                if isinstance(r, Mapping)
                and str(r.get("type", "")) in CASH_BEARING_TYPES
            )
            # An empty crawl (no-wallet currency) is legitimately complete-empty.
            entries[key] = {
                "reached_end": True,
                "rows": len(rows),
                **({"note": "no wallet for currency"} if not rows else {}),
            }

    return daily_records, raw_rows_all, indexable, CompletenessReport(
        expected=expected,
        entries=entries,
        dated_external_flows=dated_external_flows,
        total_return_rows=total_return_rows,
    )


async def fetch_deribit_ledger_daily_records(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[list[dict[str, Any]], CompletenessReport]:
    """Crawl the txn-log ledger across every scope × currency and return the
    accumulated funding-inclusive ``daily_pnl`` records plus a
    ``CompletenessReport`` (the USD-space entry point — byte-identical to the
    pre-80-02 behaviour). Thin delegate to :func:`_crawl_deribit_ledger`, which is
    now shared with the native-unit adapter; the raw rows + indexable set the
    native path needs are discarded here.
    """
    daily_records, _raw_rows, _indexable, report = await _crawl_deribit_ledger(
        exchange, since_ms, sleep=sleep
    )
    return daily_records, report


def _deribit_session_upl_to_usd(
    summaries: Sequence[Any],
    index_prices: Mapping[str, float],
) -> tuple[float, bool]:
    """Sum the per-currency Deribit session open-uPnL wedge into USD, reusing
    the EXACT conversion rule of ``deribit_equity_to_usd``.

    [ASSUMED A1]: ``session_upl`` is the Deribit account-summary open-unrealized
    component (the session unrealized PnL). An absent / null / non-numeric field
    coerces to a 0.0 contribution — NEVER a fabricated value (T-77-05).
    USD-family currencies pass through as USD; a non-linear currency's coin uPnL
    is multiplied by its ``{ccy}_usd`` index.

    A non-linear currency carrying a wedge but no resolvable index contributes
    0.0 rather than raising — the equity anchor (computed FIRST) already fails
    loud for any held currency lacking an index, so this path is only reached
    for the warning-only wedge on a base the anchor already validated; refusing
    to fabricate a USD figure for an unvaluable wedge is the honest default.

    MUST-2 (specialist-silentfailure HIGH-1): returns ``(wedge_usd, unreadable)``.
    Because ``session_upl`` is an ``[ASSUMED A1]`` field NAME, a wrong/renamed
    field would be absent on EVERY summary and silently coalesce to a 0.0 wedge —
    indistinguishable from a genuinely flat book, disabling FLOW-04 for every
    Deribit account with no signal. ``unreadable`` is True when there WERE
    summaries to read but the field was present-and-numeric on NONE of them (a
    wrong field name or a fully-garbled response). A book that is genuinely flat
    reports ``session_upl == 0`` — a PRESENT numeric read — so ``unreadable`` is
    False and the account stays clean ``complete``. The caller raises
    ``unrealized_pnl_unreadable`` (→ ``complete_with_warnings``) so a wrong field
    name is LOUD, not a silent overstatement.
    """
    from services.deribit_txn import _LINEAR_CURRENCIES

    total = 0.0
    saw_summary = False
    read_any = False
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy:
            continue
        saw_summary = True
        raw = summ.get("session_upl")  # [ASSUMED A1]
        if raw is None:
            continue  # absent / null → 0.0 wedge (fallback, never fabricate)
        try:
            upl = float(raw)
        except (TypeError, ValueError):
            continue  # non-numeric → 0.0 wedge (fallback, never fabricate)
        # The field was PRESENT and numeric (even genuine 0.0) — the assumed
        # field name resolves, so this account is not "unreadable".
        read_any = True
        if upl == 0.0:
            continue
        if ccy in _LINEAR_CURRENCIES:
            total += upl  # already USD
            continue
        price = index_prices.get(ccy)
        if price is None:
            continue  # unvaluable wedge → 0.0 contribution (never fabricate)
        total += upl * float(price)
    # Unreadable ONLY when there were summaries yet not a single one carried a
    # readable session_upl — the wrong-field-name / garbled-response signal.
    return total, (saw_summary and not read_any)


@dataclass(frozen=True)
class DeribitNativeAccountState:
    """The Deribit account anchor read in BOTH channels from ONE
    ``get_account_summaries`` response (D5):

      * ``native_equity`` / ``native_upnl`` — per-UPPERCASE-ccy NATIVE units
        (``equity`` / ``session_upl`` verbatim, NEVER index-multiplied); the
        additive channel the 79 native core consumes. ``session_upl`` absent /
        null / non-numeric coerces to ``0.0`` for that currency (never
        fabricated), matching ``_deribit_session_upl_to_usd``'s [ASSUMED A1].
      * ``collapsed_equity_usd`` / ``collapsed_upnl_usd`` + ``upnl_unreadable`` —
        the LEGACY collapsed USD anchor/wedge (``deribit_equity_to_usd`` /
        ``_deribit_session_upl_to_usd``), kept byte-identical for the 80-04 parity
        panel.
      * ``balance_error`` — the DQ flag: a failed/empty summaries read or an
        unvaluable held currency (``deribit_equity_to_usd`` raises).

    App A #6 (D6) holds BY CONSTRUCTION: an unvaluable coin ``session_upl`` is
    SILENTLY zeroed in ``collapsed_upnl_usd`` (the legacy path) but PRESERVED raw
    in ``native_upnl`` — the native core value-gate is what refuses it, not the
    adapter. A FAILED read yields EMPTY native maps; an unvaluable COLLAPSE keeps
    the (readable) native maps while flagging ``balance_error``.
    """

    native_equity: Mapping[str, float]
    native_upnl: Mapping[str, float]
    collapsed_equity_usd: float | None
    collapsed_upnl_usd: float
    balance_error: bool
    upnl_unreadable: bool


async def fetch_deribit_native_account_state(
    exchange: Any,
) -> DeribitNativeAccountState:
    """Read the Deribit account anchor in native + collapsed channels from ONE
    ``get_account_summaries`` response (D5) — the SINGLE summaries fetch and the
    SINGLE code path both ``fetch_deribit_account_equity_and_upnl_usd`` (legacy
    4-tuple) and ``build_deribit_native_ledger`` (native maps) delegate to.

    The native maps are read STRAIGHT off each summary (``equity`` /
    ``session_upl``) in NATIVE units — no ``{ccy}_usd`` multiply. The collapsed
    anchor/wedge reuse the SAME resolved ``index_prices`` (one probe per held
    non-linear currency) so there is NO second fetch of anything. Leak: no raw
    equity/upnl values are logged.
    """
    from services.deribit_txn import _LINEAR_CURRENCIES, deribit_equity_to_usd

    empty: dict[str, float] = {}
    try:
        resp = await exchange.private_get_get_account_summaries({})
    except Exception:  # noqa: BLE001 - a failed read is a DQ flag, not a crash
        return DeribitNativeAccountState(empty, {}, None, 0.0, True, False)
    result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
    summaries = result.get("summaries", []) if isinstance(result, Mapping) else []
    if not isinstance(summaries, Sequence) or not summaries:
        return DeribitNativeAccountState({}, {}, None, 0.0, True, False)

    # Native per-currency maps read from the SAME summaries (D5) — NEVER index-
    # multiplied. session_upl absent/null/non-numeric → 0.0 (never fabricated).
    native_equity: dict[str, float] = {}
    native_upnl: dict[str, float] = {}
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy:
            continue
        native_equity[ccy] = float(summ.get("equity", 0.0) or 0.0)
        raw = summ.get("session_upl")  # [ASSUMED A1]
        upl = 0.0
        if raw is not None:
            try:
                upl = float(raw)
            except (TypeError, ValueError):
                upl = 0.0
        native_upnl[ccy] = upl

    # Resolve one {ccy}_usd index per held non-linear currency for the COLLAPSED
    # anchor/wedge only (the native maps above never touch these).
    index_prices: dict[str, float] = {}
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy or ccy in _LINEAR_CURRENCIES:
            continue
        try:
            ip = await exchange.public_get_get_index_price(
                {"index_name": f"{ccy.lower()}_usd"}
            )
        except Exception:  # noqa: BLE001 - missing index → gate below fails loud
            continue
        ipr = ip.get("result", {}) if isinstance(ip, Mapping) else {}
        price = ipr.get("index_price") if isinstance(ipr, Mapping) else None
        if price is not None:
            try:
                index_prices[ccy] = float(price)
            except (TypeError, ValueError):
                continue

    try:
        equity = deribit_equity_to_usd(summaries, index_prices)
    except ValueError:
        # A coin-margined currency with no resolvable USD index → refuse a
        # coin/non-USD collapsed anchor; flag heuristic capital rather than
        # mis-scale. The NATIVE maps stay (they need no index); the wedge inherits
        # the same fail-loud collapsed disposition (never fabricated).
        return DeribitNativeAccountState(
            native_equity, native_upnl, None, 0.0, True, False
        )
    open_unrealized_usd, upnl_unreadable = _deribit_session_upl_to_usd(
        summaries, index_prices
    )
    return DeribitNativeAccountState(
        native_equity, native_upnl, equity, open_unrealized_usd, False, upnl_unreadable
    )


async def fetch_deribit_account_equity_and_upnl_usd(
    exchange: Any,
) -> tuple[float | None, bool, float, bool]:
    """Total Deribit account equity in USD (the initial-capital anchor) AND the
    companion session open-uPnL wedge, both from ONE ``get_account_summaries``
    response + the SAME resolved index_prices (SC-1) — no new fetch.

    Thin collapsed-4-tuple delegate to :func:`fetch_deribit_native_account_state`
    (byte-identical to the pre-80-02 body): reads
    ``private/get_account_summaries``; each coin-margined currency's coin equity
    is converted at its USD index price (``public/get_index_price`` with
    ``index_name={ccy}_usd``) while USD-family currencies pass through. The money
    math is the pure ``deribit_txn.deribit_equity_to_usd`` — NEVER anchor to a raw
    coin quantity (the anchor-shift class mis-scales every return). The open-uPnL
    wedge sums ``session_upl`` [ASSUMED A1] from the SAME summaries with the SAME
    index_prices; an absent/uncertain field → wedge 0.0 (fallback, never
    fabricated).

    Returns ``(equity, balance_error, open_unrealized_usd, upnl_unreadable)``. A
    failed read or an unvaluable held currency → ``(None, True, 0.0, False)``
    (the wedge inherits the anchor's fail-loud disposition — never fabricated on
    an unvaluable base, and ``unreadable`` is moot on a failed anchor). MUST-2:
    ``upnl_unreadable`` is True when the anchor read cleanly but ``session_upl``
    was absent/unreadable on EVERY summary — the caller surfaces
    ``unrealized_pnl_unreadable`` so a wrong assumed field name is LOUD.
    """
    state = await fetch_deribit_native_account_state(exchange)
    return (
        state.collapsed_equity_usd,
        state.balance_error,
        state.collapsed_upnl_usd,
        state.upnl_unreadable,
    )


async def fetch_deribit_account_equity_usd(
    exchange: Any,
) -> tuple[float | None, bool]:
    """Total Deribit account equity in USD (the initial-capital anchor).

    Thin 2-tuple-preserving delegate to
    :func:`fetch_deribit_account_equity_and_upnl_usd` (equity + balance_error
    elements only) so existing callers/tests are byte-identical.

    Returns ``(equity, balance_error)`` mirroring ``fetch_account_equity_usd``:
    ``balance_error=True`` means the read failed (caller flags heuristic
    capital). ``fetch_account_equity_usd`` (services.exchange) does NOT cover
    deribit — coin-margined USDT balance is not USD equity — so this is the
    deribit-specific anchor.
    """
    equity, balance_error, _upnl, _unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(exchange)
    )
    return equity, balance_error


# ---------------------------------------------------------------------------
# 80-02 — the native-unit venue adapter: assemble a NativeLedger from existing
# Deribit parts for the landed Phase-79 core. Writes NO reconstruction math.
# ---------------------------------------------------------------------------


def _today_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _native_daily_to_series(day_map: Mapping[str, float]) -> pd.Series:
    """D9: convert the pandas-pure ``{utc_day_iso: native_pnl}`` dict
    (``txn_rows_to_native_daily`` output) into a float Series on a tz-naive
    midnight ASCENDING ``DatetimeIndex`` — the ``NativeLedger.native_pnl`` shape.
    This conversion lives HERE (not in the AST-pandas-pure ``deribit_txn.py``)."""
    if not day_map:
        return pd.Series(dtype=float, name="native_pnl")
    days = sorted(day_map)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in days])
    return pd.Series(
        [day_map[d] for d in days], index=index, dtype=float, name="native_pnl"
    )


def _marks_series(price_map: Mapping[str, float]) -> pd.Series:
    """A dense daily USD mark Series on a tz-naive midnight ascending
    ``DatetimeIndex`` from a ``{utc_day_iso: delivery_price}`` map — NEVER
    forward-filled (the map is already dense from ``public/get_delivery_prices``;
    a genuine gap stays a gap so the core's ``missing_daily_marks`` refusal fires)."""
    days = sorted(price_map)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in days])
    return pd.Series(
        [price_map[d] for d in days], index=index, dtype=float, name="mark"
    )


async def _build_dense_native_marks(
    exchange: Any,
    *,
    indexable: AbstractSet[str],
    native_pnl: Mapping[str, pd.Series],
    native_flows: Sequence[ExternalFlow],
    terminal_native_equity: Mapping[str, float],
    terminal_upnl_native: Mapping[str, float],
    sleep: SleepFn = asyncio.sleep,
) -> dict[str, pd.Series]:
    """The DENSE daily settlement-mark planner (D4). For every INDEXED currency
    carrying nonzero native value (pnl, equity, wedge, or flow), fetch a DENSE
    daily ``{ccy}_usd`` settlement-index Series across ``[oldest activity day,
    today]`` via :func:`fetch_deribit_settlement_index` — NOT pruned to event days
    (the core carries balances forward and needs a mark on every carry-forward day)
    and NEVER forward-filled (a genuine publish gap stays a gap → the core's
    ``missing_daily_marks`` refusal fires, T-80-05).

    USD-family currencies get NO marks entry (their mark is the literal ``1.0`` in
    the core, §4.1). An UNINDEXABLE currency gets NONE either — the adapter never
    fabricates a ``1.0`` mark; the core value-gates and refuses it downstream.
    ``indexable`` is DISJOINT from USD-family (§3.2), so ``ccy in indexable`` ⟺ the
    currency is a branch-2 INDEXED coin."""
    value_ccys: set[str] = set()
    oldest_day: dict[str, str] = {}

    def _note(ccy: str, day: str | None) -> None:
        value_ccys.add(ccy)
        if day is not None:
            prev = oldest_day.get(ccy)
            oldest_day[ccy] = day if prev is None else min(prev, day)

    for ccy, series in native_pnl.items():
        if ccy not in indexable or series.empty:
            continue
        if bool((series.to_numpy(dtype=float) != 0.0).any()):
            _note(ccy, str(series.index[0].strftime("%Y-%m-%d")))
    for flow in native_flows:
        ccy = flow.currency
        if ccy not in indexable:
            continue
        qty = flow.quantity
        if float(flow.usd_signed) != 0.0 or (qty is not None and float(qty) != 0.0):
            _note(ccy, flow.utc_day_iso)
    for source in (terminal_native_equity, terminal_upnl_native):
        for ccy, val in source.items():
            if ccy in indexable and float(val) != 0.0:
                _note(ccy, None)

    marks: dict[str, pd.Series] = {}
    if not value_ccys:
        return marks
    # A currency carrying value ONLY via the anchor/wedge (no ledger day) spans from
    # the earliest day any indexed currency carries, so its dense mark series still
    # covers the whole reconstruction; today's date if nothing carries a day.
    global_oldest = min(oldest_day.values()) if oldest_day else _today_utc_iso()
    for ccy in sorted(value_ccys):
        price_map = await fetch_deribit_settlement_index(
            exchange, ccy, oldest_day=oldest_day.get(ccy, global_oldest), sleep=sleep
        )
        marks[ccy] = _marks_series(price_map)
    return marks


async def build_deribit_native_ledger(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[NativeLedger, CompletenessReport]:
    """Assemble a :class:`~services.native_nav.NativeLedger` for the landed Phase-79
    native core from existing Deribit parts + the 80-01 siblings (NAT-04). It
    writes NO reconstruction math — the core rolls, values, and refuses.

    Six fields, all per-currency native:
      * ``native_pnl`` — ``txn_rows_to_native_daily`` over the crawl's RAW rows,
        each ``{day: native_change}`` dict converted to a tz-naive midnight Series
        (D9).
      * ``terminal_native_equity`` / ``terminal_upnl_native`` — the per-currency
        native anchor + wedge read from the ONE ``get_account_summaries`` response
        (:func:`fetch_deribit_native_account_state`). The unmarkable-wedge App A #6
        refusal is delivered BY CONSTRUCTION — the raw native ``session_upl`` is
        passed through and the core's value-gate refuses it.
      * ``marks`` — a DENSE daily ``{ccy}_usd`` settlement-index Series per INDEXED
        nonzero currency (:func:`_build_dense_native_marks`); USD-family absent.
      * ``native_flows`` — the crawl's 4-field ``(day, ccy)`` dated flows, reused
        verbatim from ``report.dated_external_flows`` (never recomputed).
      * ``full_history=True`` — Deribit's txn-log reaches inception, so the §5
        inception gate reconciles against a pre-history balance of 0.

    Returns ``(NativeLedger, CompletenessReport)``; the caller still runs
    :func:`assert_ledger_complete` on the report (the adapter never swallows it).
    The collapsed USD anchor stays available via
    :func:`fetch_deribit_native_account_state` for the 80-04 parity panel.
    Leak: no raw balances/marks/flows logged."""
    _daily_records, raw_rows, indexable, report = await _crawl_deribit_ledger(
        exchange, since_ms, sleep=sleep
    )
    native_pnl: dict[str, pd.Series] = {
        ccy: _native_daily_to_series(day_map)
        for ccy, day_map in txn_rows_to_native_daily(raw_rows).items()
    }
    native_flows = report.dated_external_flows
    state = await fetch_deribit_native_account_state(exchange)
    marks = await _build_dense_native_marks(
        exchange,
        indexable=indexable,
        native_pnl=native_pnl,
        native_flows=native_flows,
        terminal_native_equity=state.native_equity,
        terminal_upnl_native=state.native_upnl,
        sleep=sleep,
    )
    ledger = NativeLedger(
        native_pnl=native_pnl,
        terminal_native_equity=state.native_equity,
        marks=marks,
        native_flows=native_flows,
        terminal_upnl_native=state.native_upnl,
        full_history=True,
    )
    return ledger, report


def assert_ledger_complete(report: CompletenessReport) -> None:
    """The re-anchored D-02 honesty gate. Raise ``LedgerCompletenessError`` if
    ANY expected scope × currency did not reach ``continuation=null``.

    Takes NO fill-count total: completeness over the date range — not a
    reconciliation to 18,778 / 21,014 / 61,248 (Wave-0 BLOCKING_FINDING: those
    fill-level totals reconcile to no API surface) — is the honesty anchor. A
    truncated crawl and a dropped scope leave the gate failing, so a silently-
    partial ledger can never render as complete. ``expected`` is anchored on the
    enumeration-INDEPENDENT truth (authoritative subaccount set + full public
    currency universe, both fail-loud), so under-enumeration cannot slip past."""
    incomplete: list[str] = []
    for scope_label, currencies in report.expected.items():
        for currency in currencies:
            entry = report.entries.get((scope_label, currency))
            if entry is None or not entry.get("reached_end"):
                incomplete.append(f"{scope_label}×{currency}")
    if incomplete:
        raise LedgerCompletenessError(
            "Deribit ledger is INCOMPLETE — these scope×currency crawls did not "
            "reach continuation=null (truncation or dropped scope): "
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
        # enumerate_currencies FAILS LOUD (CurrencyEnumerationError) on an
        # unenumerable universe — intentional and consistent with the returns
        # path: fills is an execution-detail / advisory-cross-check axis, and an
        # unenumerable universe means we cannot honestly bound coverage, so it
        # surfaces (classified by the ingestion dispatcher) rather than silently
        # returning an empty fill set.
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


# ---------------------------------------------------------------------------
# ADVISORY fill-count cross-check — NOT the honesty gate.
# ---------------------------------------------------------------------------

# The three LTP account fill totals observed out-of-band. Wave-0 BLOCKING_FINDING:
# these figures reconcile to NO API surface (they appear to count fills/legs, not
# transaction-log rows), so they are an OPTIONAL cross-check ONLY. The
# returns-completeness honesty gate is ``assert_ledger_complete`` (70-03), NEVER
# this fill count. Keyed by account label for bookkeeping — do NOT wire any of
# these into a fail-loud gate.
KNOWN_TRADE_TOTALS: dict[str, int] = {
    "ltp_1": 18_778,
    "ltp_2": 21_014,
    "ltp_3": 61_248,
}


def reconcile_fill_count(fetched_total: int, known_total: int) -> dict[str, Any]:
    """ADVISORY fill-count cross-check — RETURNS a diff report and NEVER raises.

    This is DELIBERATELY not a gate. The Wave-0 BLOCKING_FINDING proved the known
    fill totals (18,778 / 21,014 / 61,248) reconcile to NO API surface, so a
    shortfall here is advisory evidence only — it is emitted as a WARN-severity
    report, never a ``DeribitCountGateError`` (no such type exists by design). The
    returns-completeness honesty gate is ``assert_ledger_complete`` (70-03, ledger
    COMPLETENESS over the date range), NOT this count. A caller may log/record the
    report; it must never mistake a fill-count shortfall for the ledger gate.
    """
    shortfall = max(known_total - fetched_total, 0)
    reconciles = fetched_total == known_total
    return {
        "fetched_total": fetched_total,
        "known_total": known_total,
        "diff": fetched_total - known_total,
        "shortfall": shortfall,
        "reconciles": reconciles,
        "advisory": True,
        "severity": "info" if reconciles else "warn",
        "note": (
            "ADVISORY ONLY — fill totals reconcile to no API surface (Wave-0 "
            "BLOCKING_FINDING). The returns honesty gate is ledger completeness "
            "(assert_ledger_complete, 70-03), NEVER this fill count."
        ),
    }
