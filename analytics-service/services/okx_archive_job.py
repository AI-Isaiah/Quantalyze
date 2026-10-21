"""Durable OKX quarterly-archive job: the skeleton (Phase 167.1.2.2.2.1, plan 07).

Kind ``okx_archive_rebuild`` (D-04). One api_key-scoped job; OKX's own request state is
the state machine, so there is no state table and no link is kept anywhere (RESEARCH
Section 5). This plan owns:

* the worker wiring (``job_worker.dispatch`` arm, 15-minute handler timeout, 30-minute
  watchdog override), and the input validation;
* the D-02 key checks and the account / permission / subtype checks, each of which stops
  the job with a named class and a Result shape v1 block BEFORE any archive call;
* ``preflight`` mode, the operator's answer to "which account, which permission, which
  host does OKX serve the file from", without a shell on Railway;
* the result writer.

Plan 16 (this module's second layer) owns the stateless wait on OKX's archive request and
the download-and-parse ingest; plan 08 (its third layer) adds the evaluation ``calibrate`` ends
with (the live reference, the reconciliation to the cent, the rebuild preview, the D-03 check
and the fingerprint) and ``apply`` mode, which re-runs that same evaluation and then writes
through ``apply_okx_archive_rebuild``, the only write path.

**The wait is stateless (SC-1).** Every claim re-applies each requested quarter (OKX's apply
is idempotent), re-reads the request state, and then does exactly one of: defer
(``defer_compute_job``, attempts untouched, at most one hour, claim-token fenced), re-apply
once, ingest, or give up. The give-up bound comes from OKX's own request ``ts`` (8 h), never
from a counter; because that ``ts`` is unverified, EVERY defer also passes a backstop of
``BACKSTOP_AFTER_S`` (24 h) from the job's own ``created_at`` (F7). One claim as a whole has a
budget (``CLAIM_BUDGET_S``, the handler timeout less a reserve) that every live crawl and the
download are bounded by; running out is the named transient ``claim_budget_exceeded`` (WR-06). Nothing about a download link or a ``ts`` is stored between claims: not in
the job metadata, not in the result, not in a log or an error text (the link is a bearer
token; only its scheme and host are ever described). A restart, an expired link or an empty
link therefore costs a fresh read, never a gap.

**Job contract (identical text in plans 07, 16, 08 and 10).**

``metadata`` input keys (read only; this handler NEVER writes them, because a
read-modify-write of ``compute_jobs.metadata`` races the claim RPC):
``mode`` (``preflight`` | ``calibrate`` | ``apply``), ``quarters`` (1-4 entries
``{"year": int, "quarter": "Q1".."Q4"}``, none the current or a future quarter),
``rebuild_strategy_ids``, ``zero_check_strategy_ids``, ``approved_fingerprint``.

Result: ONE object written with ``set_compute_job_progress`` (an atomic, claim-token
fenced merge) and read back at ``metadata->'member_progress'`` (Result shape v1, below).
``last_error`` is ``okx_archive_rebuild: <stop_class>`` plus dates and counts only.
Amounts appear only inside that database object, never in logs, ``last_error`` or tracked
text.

**Order is the D-02 guarantee.** (1) validate the input; (2) ``_check_keys``, pure
database, no credential, no exchange; (3) ``_allocator_key_preflight`` (decrypts and builds
the exchange client); (4) ``account/config``; (5) ``account/subtypes``; (6) the quarters.
A key D-02 refuses is therefore never decrypted, never has a client constructed and never
reaches OKX; ``_allocator_key_preflight`` alone would answer an inactive key with a plain
FAILED and no result block, and would decrypt any key it does not refuse.

**The apply POST is the last call on its own fresh exchange instance.** ccxt prices
``account/bills-history-archive`` (POST) at cost 72000; measured, the next call on the same
instance then blocks about 7,920 s, past the handler timeout (RESEARCH Pitfall 1). The POST
therefore gets a client of its own, exactly one attempt (a retry loop on a cost-72000 call
stalls for two hours) and a ``finally`` close. The cheap reads use the preflight instance
through ``_okx_bills_fetch_with_backoff``.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation
from typing import Any, Awaitable, Final, Mapping, TypeVar, cast

import ccxt.async_support as ccxt
import httpx

from services import job_worker as _job_worker  # the handler timeout is read through the module
from services.account_identity import venue_account_id_from
from services.ccxt_flow_fetch import fetch_ccxt_transfers
from services.ccxt_flows import ccxt_rows_to_dated_flows
from services.db import db_execute, get_supabase, one, rows
from services.encryption import decrypt_credentials, get_kek
from services.exchange import (
    _okx_bills_fetch_with_backoff,
    aclose_exchange,
    fetch_account_equity_and_upnl_usd,
    fetch_all_trades,
    get_and_clear_last_dq_flags,
)
from services.external_flows import ExternalFlow
from services.funding_fetch import fetch_funding_okx
from services.job_worker import (
    _BROKER_CRAWL_TIMEOUT_S,
    DispatchOutcome,
    DispatchResult,
    _allocator_key_preflight,
    _ccxt_full_history_verdict,
    _defer_lost_ownership,
    _make_exchange_client,
    _resolve_ccxt_flow_price_index,
)
from services.nav_twr import DUST_NAV_FLOOR, NavReconstructionError, flow_retention_floor
from services.okx_archive_classify import (
    ARCHIVE_USD_FAMILY,
    CLASSIFICATION_TABLE_VERSION,
    SUBTYPE_BUCKETS,
    ArchiveAggregate,
    Bucket,
    aggregate_archive,
    MIN_CHAINED_PAIRS,
    verify_bal_chain,
)
from services.okx_archive_download import (
    DownloadRefused,
    LinkExpired,
    describe_href,
    download_archive_csv,
)
from services.okx_archive_files import (
    ArchiveFile,
    ArchiveParseError,
    longest_billless_run,
    parse_archive_csv,
    quarter_bounds,
)
from services.okx_archive_rebuild import (
    RebuildRefused,
    RebuildResult,
    days_to_ranges,
    rebuild_union,
    rows_for_strategy,
    subtract_ranges,
)
from services.okx_archive_reconcile import (
    MIN_ACTIVE_DAYS,
    MIN_COMPARED_DAYS,
    LegReading,
    overlap_evidence,
    overlap_window,
    reconcile_leg,
)
from services.redact import scrub_freeform_string

logger = logging.getLogger(__name__)

KIND: Final[str] = "okx_archive_rebuild"
RESULT_VERSION: Final[int] = 1

# Closed set of stop classes (job contract). ``link_expired``, ``live_fetch_failed`` and
# ``claim_budget_exceeded`` are transient (a retry resumes statelessly); every other class is
# permanent. A stop writes the result block first, then returns FAILED.
STOP_CLASSES: Final[frozenset[str]] = frozenset(
    {
        "invalid_input",
        "key_not_okx",
        "key_disconnected",
        "target_key_disconnected",
        "account_mismatch",
        "perm_not_read_only",
        "subtype_map_drift",
        "archive_request_failed",
        "archive_give_up",
        "download_refused",
        "link_expired",
        "container_unknown",
        "archive_incomplete",
        "header_drift",
        "quarter_range_mismatch",
        "duplicate_bill_conflict",
        "unparseable_amount",
        "unknown_subtype_nonzero",
        "non_usd_ccy",
        "live_anchor_unusable",
        "live_fetch_failed",
        "claim_budget_exceeded",
        "identity_violation",
        "reconcile_miss",
        "d03_zero_day_has_archive_pnl",
        "fingerprint_missing",
        "fingerprint_mismatch",
        "nothing_to_apply",
        "rpc_refused",
    }
)
TRANSIENT_STOP_CLASSES: Final[frozenset[str]] = frozenset(
    {"link_expired", "live_fetch_failed", "claim_budget_exceeded"}
)

# ---------------------------------------------------------------------------
# Timings (RESEARCH A9, discretion), used by the stateless wait.
# ---------------------------------------------------------------------------
#: First status read no earlier than the request ``ts`` + 2 h, unless the apply answered
#: "already exists" (OKX: "check after 2 hours", up to 3 at peak).
FIRST_STATUS_READ_AFTER_S: Final[int] = 2 * 60 * 60
#: Then every 15 minutes.
STATUS_POLL_INTERVAL_S: Final[int] = 15 * 60
#: Give up at ``ts`` + 8 h.
GIVE_UP_AFTER_S: Final[int] = 8 * 60 * 60
#: Re-apply once on ``failed`` while the request is younger than ``GIVE_UP_AFTER_S``.
MAX_REAPPLIES: Final[int] = 1
#: At least 11 s between two apply POSTs (OKX documents 1 per 10 s).
MIN_APPLY_GAP_S: Final[int] = 11
#: ``defer_compute_job`` raises above one hour, so no single wait is longer.
MAX_DEFER_S: Final[int] = 3600
#: A wait shorter than this is a tight loop, not a wait.
MIN_DEFER_S: Final[int] = 60
#: A backstop on WAITING that does not depend on anything OKX says (F7 / WR-04): a job older
#: than this, measured from its own ``compute_jobs.created_at``, is not deferred again. The
#: 8 h bound above reads OKX's request ``ts``, whose meaning is unverified; if it tracks the
#: LATEST apply it never ages and nothing else ends the wait (a defer does not use an attempt).
BACKSTOP_AFTER_S: Final[int] = 24 * 60 * 60
#: A venue rate limit on an archive call defers at least this long (15 minutes), and never
#: stamps the key's 429 (that opens the exchange-wide breaker and pauses normal OKX syncs).
RATE_LIMIT_DEFER_S: Final[int] = 15 * 60

#: How far back the live ``bills-archive`` walk is ASSUMED to reach, in days (CR-01). OKX
#: documents "the last 3 months"; a calendar three months is 89..92 days and
#: ``exchange.fetch_daily_pnl`` itself approximates it as 90. The reach starts at an arbitrary
#: instant, so its first day is PARTIAL, and the job must name that day from the fetch window,
#: never from the first record the crawl happened to return (a quiet stretch or a page-cap cut
#: moves the first record, not the reach). The assumed reach is deliberately the shortest the
#: venue can serve (89) less a day of margin: assuming a SHORTER reach than the venue gives only
#: hands one more whole day to the archive, while assuming a longer one would treat a partial
#: live day as whole, which skews every rebuilt NAV.
LIVE_REACH_ASSUMED_DAYS: Final[int] = 88

#: What is kept back from the handler timeout for the result write and the client closes.
CLAIM_RESERVE_S: Final[float] = 60.0
#: One claim's whole budget (WR-06). A calibrate or apply claim chains two apply POSTs paced
#: >= 11 s apart, status reads, up to two downloads (``TOTAL_TIMEOUT_S`` = 300 s each), the
#: parse, SIX sequential live crawls (each bounded by ``_BROKER_CRAWL_TIMEOUT_S`` = 810 s), the
#: rebuild and the RPCs. Their sum can far exceed the handler timeout, so every step that can
#: take long is bounded by what is LEFT of this budget (``_ClaimBudget``) and running out is the
#: named transient ``claim_budget_exceeded``, never the dispatcher's generic cancellation. It is
#: derived from the kind's handler timeout (the reaper ceiling does not move: plan 07).
CLAIM_BUDGET_S: Final[float] = _job_worker.TIMEOUT_PER_KIND[KIND] - CLAIM_RESERVE_S

# Seams for tests (a fake clock and a recorded sleep); production uses the real ones.
_monotonic = time.monotonic
_sleep = asyncio.sleep


def _wall_ms() -> int:
    """Wall clock in epoch milliseconds, the scale of OKX's request ``ts``."""
    return int(time.time() * 1000)


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


MODES: Final[tuple[str, ...]] = ("preflight", "calibrate", "apply")
#: Every mode is accepted: plan 16 added ``calibrate``, plan 08 adds ``apply``.
ACCEPTED_MODES: Final[tuple[str, ...]] = MODES
_QUARTER_LABELS: Final[tuple[str, ...]] = ("Q1", "Q2", "Q3", "Q4")
_MAX_QUARTERS: Final[int] = 4
_FINGERPRINT_RE: Final[re.Pattern[str]] = re.compile(r"[0-9a-f]{64}")
#: A venue-supplied label (subtype, type, ccy-like class) that may be echoed into the result.
_LABEL_RE: Final[re.Pattern[str]] = re.compile(r"[0-9A-Za-z_-]{1,16}")

_KEY_COLUMNS: Final[str] = "id,exchange,is_active,disconnected_at,sync_status,venue_account_id"

# D-08 preflight: what the committed table expects of the LIVE ``type`` of a subtype.
# The committed table maps ``subType -> Bucket`` only and carries no type, so the
# expectation is derived from what the bucket MEANS to the live path:
#   FUNDING subtypes are the live type 8 (the live aggregator drops type 8 from realized
#   and `funding_fetch` keys on it), FLOW subtypes are the transfer type 1 (RESEARCH
#   Section 3, both [CITED] to the OKX docs). A subtype counted as REALIZED must be
#   neither a transfer nor funding, or transfers or funding would be summed as P&L; a
#   NON_EXTERNAL subtype must not be funding. Other types are NOT encoded from memory.
_OKX_TRANSFER_BILL_TYPE: Final[str] = "1"
# Function-local in ``exchange.fetch_daily_pnl`` (not importable), so repeated here and
# pinned equal to that literal by a source-text test (TestLiveTypeLiterals).
_OKX_FUNDING_BILL_TYPE: Final[str] = "8"
_EXPECTED_LIVE_TYPE: Final[Mapping[Bucket, str]] = {
    Bucket.FUNDING: _OKX_FUNDING_BILL_TYPE,
    Bucket.FLOW: _OKX_TRANSFER_BILL_TYPE,
}
_FORBIDDEN_LIVE_TYPES: Final[Mapping[Bucket, frozenset[str]]] = {
    Bucket.REALIZED: frozenset({_OKX_TRANSFER_BILL_TYPE, _OKX_FUNDING_BILL_TYPE}),
    Bucket.NON_EXTERNAL: frozenset({_OKX_FUNDING_BILL_TYPE}),
}

_ARCHIVE_STATES: Final[frozenset[str]] = frozenset({"finished", "ongoing", "failed"})
_APPLY_ENDPOINT_METHOD: Final[str] = "private_post_account_bills_history_archive"
_STATUS_ENDPOINT_METHOD: Final[str] = "private_get_account_bills_history_archive"


class _Stop(Exception):
    """A permanent (or, for ``link_expired``, transient) stop with a closed class.

    ``detail`` is appended to ``last_error`` and must hold dates and counts only: never
    venue text, a uid, an amount or a link.
    """

    def __init__(self, stop_class: str, detail: str = "") -> None:
        if stop_class not in STOP_CLASSES:  # a typo here would be a silent new class
            raise AssertionError(f"unknown stop class {stop_class!r}")
        super().__init__(stop_class)
        self.stop_class = stop_class
        self.detail = detail
        #: The Result shape v1 ``census`` of the file that caused this stop, for the two
        #: classification stops the founder must see the per-currency / per-subType counts
        #: of (``non_usd_ccy``, ``unknown_subtype_nonzero``). Counts only, never an amount.
        self.census: dict[str, Any] | None = None
        #: The Result shape v1 ``info`` of a stop that carries evidence beside its class
        #: (``archive_incomplete``: where the running ``bal`` chain broke). Counts and dates only.
        self.info: dict[str, Any] | None = None


_T = TypeVar("_T")


class _ClaimBudget:
    """One claim's wall-clock budget (WR-06), on the monotonic clock seam. Created at the top of
    the handler and handed down to every step that can take long."""

    def __init__(self, seconds: float) -> None:
        self._deadline = _monotonic() + seconds

    def remaining(self) -> float:
        return self._deadline - _monotonic()


async def _within(
    budget: _ClaimBudget, work: Awaitable[_T], *, step: str, cap: float | None = None
) -> _T:
    """Await ``work`` for at most ``min(cap, what is left of the claim's budget)``.

    The budget's own expiry (and starting with nothing left) is the named transient
    ``claim_budget_exceeded`` naming the STEP, so an overlong claim ends as a class an operator
    can read, not as the dispatcher's generic cancellation after a wasted attempt. A
    ``TimeoutError`` the work raises on its own account is NOT the budget's: it propagates
    untouched for whatever already classifies it."""
    remaining = budget.remaining()
    if remaining <= 0:
        close = getattr(work, "close", None)
        if callable(close):
            close()  # never leave a coroutine that was never started un-awaited
        raise _Stop("claim_budget_exceeded", f"step={step}")
    timeout = remaining if cap is None else min(cap, remaining)
    try:
        async with asyncio.timeout(timeout) as scope:
            return await work
    except TimeoutError:
        if scope.expired():
            raise _Stop("claim_budget_exceeded", f"step={step}") from None
        raise


# ---------------------------------------------------------------------------
# Result shape v1
# ---------------------------------------------------------------------------

def _blank_quarter(year: int, quarter: str) -> dict[str, Any]:
    return {
        "year": year,
        "quarter": quarter,
        "state": None,
        "applied_existing": False,
        "href_scheme": None,
        "href_host": None,
        "container": None,
        "compressed_bytes": None,
        "decompressed_bytes": None,
        "has_type_column": None,
        "ts_min_day": None,
        "ts_max_day": None,
        "row_count": None,
        #: ``{days, from, to}``: the longest run of covered days with no bill at all. Beside
        #: ``ts_min_day`` / ``ts_max_day`` it is how a file with a missing head or tail shows.
        "longest_billless_run": None,
    }


def _blank_result(mode: str | None) -> dict[str, Any]:
    """Every top-level key of Result shape v1 is present in every result. A key a mode
    does not reach is null (an array a mode does not reach is null, never omitted).
    ``account`` is always an object: ``uid_match`` / ``read_only`` read False until the
    check has verified them, so an unreached check never reads as a pass."""
    return {
        "result_version": RESULT_VERSION,
        "mode": mode,
        "stop_class": None,
        "account": {
            "uid_match": False,
            "read_only": False,
            "acct_lv": None,
            "fee_type": None,
            "settle_ccy": None,
        },
        "subtypes": None,
        "quarters": None,
        "census": None,
        "reconcile": None,
        "excluded": None,
        "info": None,
        "d03": None,
        "strategies": None,
        "fingerprint": None,
    }


async def _write_result(
    supabase: Any, job: Mapping[str, Any], result: dict[str, Any]
) -> bool:
    """Write the result through ``set_compute_job_progress``: an atomic merge into
    ``metadata.member_progress`` fenced on the claim token. ``compute_jobs.metadata`` is
    never read-modified-written here (it races the claim RPC).

    True when the merge WROTE; False when it was a fenced no-op (this run lost its claim
    token to a watchdog reclaim, so a re-claimed worker owns the row)."""

    def _rpc() -> Any:
        return supabase.rpc(
            "set_compute_job_progress",
            {
                "p_job_id": job.get("id"),
                "p_claim_token": job.get("claim_token"),
                "p_progress": result,
            },
        ).execute()

    resp = await db_execute(_rpc)
    wrote = not (isinstance(resp.data, bool) and resp.data is False)
    if not wrote:
        logger.info(
            "okx_archive_rebuild: set_compute_job_progress returned false for job %s; "
            "this run lost its claim token, so its result block was not stored",
            job.get("id"),
        )
    return wrote


def _error_text(stop_class: str, detail: str = "") -> str:
    return f"{KIND}: {stop_class}" + (f" {detail}" if detail else "")


async def _finish_stop(
    supabase: Any,
    job: Mapping[str, Any],
    result: dict[str, Any],
    stop: _Stop,
) -> DispatchResult:
    """Write the result block FIRST, then return FAILED (the contract's order).

    A failed result write is logged and swallowed on this path: the stop class already
    rides in ``last_error``, and retrying a refusal would only repeat it."""
    result["stop_class"] = stop.stop_class
    if stop.census is not None:
        result["census"] = stop.census
    if stop.info is not None:
        result["info"] = stop.info
    logger.warning("%s", _error_text(stop.stop_class, stop.detail))
    try:
        await _write_result(supabase, job, result)
    except asyncio.CancelledError:
        raise  # never swallow cancellation
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "okx_archive_rebuild: the result block for stop %s could not be written (%s)",
            stop.stop_class,
            type(exc).__name__,
        )
    transient = stop.stop_class in TRANSIENT_STOP_CLASSES
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=_error_text(stop.stop_class, stop.detail),
        error_kind="transient" if transient else "permanent",
    )


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _JobInput:
    mode: str
    quarters: tuple[tuple[int, str], ...]
    #: Strategies whose keys must share the job key's account, in input order, deduped.
    target_strategy_ids: tuple[str, ...]
    #: The strategies to rebuild, in input order. A strategy's ``position`` in a result is its
    #: index here (0-based): the result names no strategy id.
    rebuild_strategy_ids: tuple[str, ...] = ()
    #: D-03: strategies whose stored 0.0 days are checked read-only (calibrate only).
    zero_check_strategy_ids: tuple[str, ...] = ()
    #: Apply only: the fingerprint the founder approved on the calibrate preview.
    approved_fingerprint: str | None = None


def _invalid(reason: str) -> _Stop:
    # The reason code is a fixed literal of this module (never operator or venue text),
    # but ``last_error`` carries dates and counts only, so it is logged, not stored.
    logger.warning("okx_archive_rebuild: invalid_input reason=%s", reason)
    return _Stop("invalid_input")


def _uuid_list(value: object, *, field: str) -> list[str]:
    if not isinstance(value, list):
        raise _invalid(f"{field}_not_a_list")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise _invalid(f"{field}_item_not_a_string")
        try:
            canonical = str(uuid.UUID(item))
        except ValueError:
            raise _invalid(f"{field}_item_not_a_uuid") from None
        if canonical != item.lower():
            raise _invalid(f"{field}_item_not_a_uuid")
        out.append(canonical)
    return out


def _read_job_input(job: Mapping[str, Any]) -> _JobInput:
    """Validate ``job['metadata']``. Raises ``_Stop('invalid_input')`` on any malformed key
    (per D-04 there is no other trigger). Metadata is INPUT ONLY."""
    metadata = job.get("metadata")
    if not isinstance(metadata, Mapping):
        raise _invalid("metadata_not_an_object")

    mode = metadata.get("mode")
    if not isinstance(mode, str) or mode not in MODES:
        raise _invalid("mode_unknown")
    if mode not in ACCEPTED_MODES:
        raise _invalid("mode_not_accepted_yet")

    raw_quarters = metadata.get("quarters")
    if not isinstance(raw_quarters, list) or not 1 <= len(raw_quarters) <= _MAX_QUARTERS:
        raise _invalid("quarters_count")
    today = _utc_today()
    quarters: list[tuple[int, str]] = []
    for entry in raw_quarters:
        if not isinstance(entry, Mapping) or set(entry) != {"year", "quarter"}:
            raise _invalid("quarter_entry_shape")
        year, label = entry["year"], entry["quarter"]
        if isinstance(year, bool) or not isinstance(year, int):
            raise _invalid("quarter_year")
        if not isinstance(label, str) or label not in _QUARTER_LABELS:
            raise _invalid("quarter_label")
        try:
            _, end_exclusive = quarter_bounds(year, label)
        except (ValueError, OverflowError):
            raise _invalid("quarter_year") from None
        # OKX only generates a file for a quarter that has ended.
        if end_exclusive > today:
            raise _invalid("quarter_not_over")
        if (year, label) in quarters:
            raise _invalid("quarter_duplicate")
        quarters.append((year, label))

    rebuild: list[str] = []
    if metadata.get("rebuild_strategy_ids") is not None:
        rebuild = _uuid_list(metadata["rebuild_strategy_ids"], field="rebuild_strategy_ids")
    zero_check: list[str] = []
    if metadata.get("zero_check_strategy_ids") is not None:
        zero_check = _uuid_list(
            metadata["zero_check_strategy_ids"], field="zero_check_strategy_ids"
        )
    fingerprint = metadata.get("approved_fingerprint")
    if fingerprint is not None and not (
        isinstance(fingerprint, str) and _FINGERPRINT_RE.fullmatch(fingerprint)
    ):
        raise _invalid("approved_fingerprint_shape")

    if mode in ("calibrate", "apply"):
        # Contract per-mode rules: the strategies to rebuild are required (a calibration of
        # nothing proves nothing). A strategy listed twice would be rebuilt twice, and a
        # strategy both rebuilt and zero-checked contradicts D-03 (read-only on a strategy
        # that is NOT rebuilt).
        if not rebuild:
            raise _invalid("rebuild_strategy_ids_required")
        if len(set(rebuild)) != len(rebuild):
            raise _invalid("rebuild_strategy_ids_duplicate")
        if set(rebuild) & set(zero_check):
            raise _invalid("zero_check_overlaps_rebuild")
    if mode == "calibrate":
        # The fingerprint belongs to ``apply`` only.
        if fingerprint is not None:
            raise _invalid("approved_fingerprint_not_for_mode")
    if mode == "apply":
        # D-03 is a calibrate check; an apply carrying the key means the operator mixed up
        # the modes (present at all, even empty, is refused).
        if metadata.get("zero_check_strategy_ids") is not None:
            raise _invalid("zero_check_not_for_mode")
        if fingerprint is None:
            # Raised here, before any key or exchange work: an apply that cannot name what
            # the founder approved must not wait hours for a file first.
            raise _Stop("fingerprint_missing")

    targets = tuple(dict.fromkeys([*rebuild, *zero_check]))
    return _JobInput(
        mode=mode,
        quarters=tuple(quarters),
        target_strategy_ids=targets,
        rebuild_strategy_ids=tuple(rebuild),
        zero_check_strategy_ids=tuple(zero_check),
        approved_fingerprint=fingerprint,
    )


# ---------------------------------------------------------------------------
# D-02: the key checks (database only)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _KeyScope:
    """The ``venue_account_id`` of the job's key and of every target strategy's key, the
    ids the live ``account/config`` uid must equal."""

    venue_account_ids: tuple[str | None, ...]


def _stored_uid(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    return text or None


def _key_is_connected(key_row: Mapping[str, Any]) -> bool:
    """Connected = active, not disconnected, not revoked. Fail-closed: an ``is_active`` that
    is anything but ``True`` (including NULL) reads as not connected."""
    return (
        key_row.get("is_active") is True
        and key_row.get("disconnected_at") is None
        and key_row.get("sync_status") != "revoked"
    )


async def _check_keys(
    supabase: Any, job: Mapping[str, Any], inp: _JobInput
) -> _KeyScope:
    """D-02, pure database: no credential is decrypted, no exchange client is built and
    OKX is never called for a key this refuses. Reading a disconnected user's exchange
    account is what TRADESYNC refused, and the job refuses it first.

    The job key must be OKX (``key_not_okx``), active, connected and not revoked
    (``key_disconnected``); every target strategy's key the same (``target_key_disconnected``,
    or ``key_not_okx``). Only the identity columns are read, never a credential column."""
    api_key_id = job.get("api_key_id")
    if not isinstance(api_key_id, str) or not api_key_id:
        raise _invalid("api_key_id_missing")

    def _load_job_key() -> Any:
        return (
            supabase.table("api_keys")
            .select(_KEY_COLUMNS)
            .eq("id", api_key_id)
            .maybe_single()
            .execute()
        )

    job_key = one(await db_execute(_load_job_key))
    if job_key is None:
        raise _Stop("key_disconnected")  # the key is gone: nothing to read
    if job_key.get("exchange") != "okx":
        raise _Stop("key_not_okx")
    if not _key_is_connected(job_key):
        raise _Stop("key_disconnected")

    uids: list[str | None] = [_stored_uid(job_key.get("venue_account_id"))]
    if inp.target_strategy_ids:
        ids = list(inp.target_strategy_ids)

        def _load_strategies() -> Any:
            return supabase.table("strategies").select("id,api_key_id").in_("id", ids).execute()

        strategy_rows = {
            str(r.get("id")): r for r in rows(await db_execute(_load_strategies))
        }
        if len(strategy_rows) != len(ids):
            raise _invalid("target_strategy_not_found")
        key_ids = sorted({str(r["api_key_id"]) for r in strategy_rows.values() if r.get("api_key_id")})
        key_rows: dict[str, Mapping[str, Any]] = {}
        if key_ids:

            def _load_target_keys() -> Any:
                return (
                    supabase.table("api_keys").select(_KEY_COLUMNS).in_("id", key_ids).execute()
                )

            key_rows = {str(r.get("id")): r for r in rows(await db_execute(_load_target_keys))}
        for strategy_id in ids:
            key_id = strategy_rows[strategy_id].get("api_key_id")
            target_key = key_rows.get(str(key_id)) if key_id else None
            if target_key is None:
                raise _Stop("target_key_disconnected")  # no key row: nothing connected
            if target_key.get("exchange") != "okx":
                raise _Stop("key_not_okx")
            if not _key_is_connected(target_key):
                raise _Stop("target_key_disconnected")
            uids.append(_stored_uid(target_key.get("venue_account_id")))
    return _KeyScope(venue_account_ids=tuple(uids))


# ---------------------------------------------------------------------------
# Account, permission and subtype checks (the first OKX calls)
# ---------------------------------------------------------------------------

def _label(value: object) -> str | None:
    """A short venue class (``acctLv``, ``feeType``, ``settleCcy``) that may be echoed;
    anything else is dropped rather than echoed."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    return text if _LABEL_RE.fullmatch(text) else None


def _first_entry(raw: object) -> Mapping[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    data = raw.get("data")
    if isinstance(data, list) and data and isinstance(data[0], Mapping):
        return data[0]
    return None


async def _check_account(
    exchange: ccxt.Exchange, scope: _KeyScope, result: dict[str, Any]
) -> None:
    """ONE ``account/config`` call. The uid must equal ``venue_account_id`` of the job's key
    AND of every target strategy's key (reading the wrong account would rebuild one
    strategy from another's ledger), and ``perm`` must contain ``read_only`` (a key
    without it widens the blast radius). ``acctLv``, ``feeType`` and ``settleCcy`` are
    recorded as classes for diagnosis only, never a gate (RESEARCH Section 7)."""
    raw = await _okx_bills_fetch_with_backoff(
        exchange, "private_get_account_config", {}, label="account/config", page=0
    )
    entry = _first_entry(raw)
    account = result["account"]
    if entry is not None:
        account["acct_lv"] = _label(entry.get("acctLv"))
        account["fee_type"] = _label(entry.get("feeType"))
        account["settle_ccy"] = _label(entry.get("settleCcy"))
    uid = venue_account_id_from("okx", raw) if isinstance(raw, Mapping) else None
    # Fail-closed: a missing uid, or a key with no stored venue_account_id, never matches.
    uid_match = uid is not None and all(
        stored is not None and stored == uid for stored in scope.venue_account_ids
    )
    perm = entry.get("perm") if entry is not None else None
    perms = {p.strip() for p in perm.split(",")} if isinstance(perm, str) else set()
    account["uid_match"] = uid_match
    account["read_only"] = "read_only" in perms
    if not uid_match:
        raise _Stop("account_mismatch")
    if not account["read_only"]:
        raise _Stop("perm_not_read_only")


_MALFORMED: Final[str] = "(malformed)"


def _malformed_or(value: object) -> str:
    text = _label(value)
    return text if text is not None else _MALFORMED


def _parse_live_subtypes(raw: object) -> dict[str, str] | None:
    """``subType -> type`` from the ``account/subtypes`` body, or None when the body has no
    recognisable entry. OKX nests each ``type`` entry's list of ``{subType: ...}`` objects
    under ``subTypeDetails`` (OKX v5 docs, "Get bill types"; the first real preflight, run
    2026-10-20, read 0 entries while this looked for ``subTypes``). A flat ``{type, subType}``
    entry is still accepted."""
    if not isinstance(raw, Mapping):
        return None
    data = raw.get("data")
    if not isinstance(data, list):
        return None
    live: dict[str, str] = {}
    for item in data:
        if not isinstance(item, Mapping):
            continue
        type_raw = item.get("type")
        nested = next(
            (item[k] for k in ("subTypeDetails",) if isinstance(item.get(k), list)), None
        )
        pairs: list[tuple[object, object]] = []
        if nested is not None:
            pairs = [
                (sub.get("subType"), type_raw) for sub in nested if isinstance(sub, Mapping)
            ]
        elif item.get("subType") is not None:
            pairs = [(item.get("subType"), type_raw)]
        for sub_type, type_ in pairs:
            live[_malformed_or(sub_type)] = _malformed_or(type_)
    return live or None


def _disagrees(sub_type: str, live_type: str) -> bool:
    bucket = SUBTYPE_BUCKETS.get(sub_type)
    if bucket is None:
        return False
    expected = _EXPECTED_LIVE_TYPE.get(bucket)
    if expected is not None and live_type != expected:
        return True
    return live_type in _FORBIDDEN_LIVE_TYPES.get(bucket, frozenset())


async def _subtypes_census(
    exchange: ccxt.Exchange, result: dict[str, Any]
) -> dict[str, str]:
    """D-08, preflight half: ONE ``account/subtypes`` call, compared with the committed
    classification table. A subtype whose live type disagrees with the table is a permanent
    ``subtype_map_drift`` (an unnoticed re-mapping would misclassify P&L as flows). Subtypes
    the table does not list are counted by type and reported, never silently absorbed. A
    body with no recognisable entry cannot be compared and stops the same way: the census
    is a gate, so "could not read it" must not read as "no drift"."""
    raw = await _okx_bills_fetch_with_backoff(
        exchange, "private_get_account_subtypes", {}, label="account/subtypes", page=0
    )
    live = _parse_live_subtypes(raw)
    if live is None:
        result["subtypes"] = {"live_count": 0, "drift": [], "unlisted_by_type": {}}
        raise _Stop("subtype_map_drift", "live_subtypes=0")
    drift = sorted(
        (sub for sub, type_ in live.items() if _disagrees(sub, type_)),
        key=lambda s: (len(s), s),
    )
    unlisted = Counter(type_ for sub, type_ in live.items() if sub not in SUBTYPE_BUCKETS)
    result["subtypes"] = {
        "live_count": len(live),
        "drift": drift,
        "unlisted_by_type": dict(sorted(unlisted.items())),
    }
    if drift:
        raise _Stop("subtype_map_drift", f"drift_subtypes={len(drift)}")
    return live


# ---------------------------------------------------------------------------
# The quarter step: stateless against OKX's own request state (SC-1)
# ---------------------------------------------------------------------------

def _quarter_tag(year: int, quarter: str) -> str:
    return f"{year}-{quarter}"


def _parse_ts_ms(value: object) -> int | None:
    """OKX's request ``ts`` (epoch milliseconds, as digits), else None. A value that is not
    plain digits is unreadable, never guessed."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    if not (text.isascii() and text.isdigit()) or len(text) > 16:
        return None
    return int(text)


def _age_s(ts_ms: int | None) -> float | None:
    """Seconds since OKX first saw the request (never negative: a ``ts`` ahead of this
    clock reads as a brand-new request), or None when ``ts`` is unreadable."""
    if ts_ms is None:
        return None
    return max(0.0, (_wall_ms() - ts_ms) / 1000.0)


@dataclass(frozen=True)
class _ApplyAnswer:
    #: OKX said a file already exists for the quarter (``result: true``).
    existing: bool
    #: The request's first-request time, or None when OKX did not return a readable one.
    ts_ms: int | None


@dataclass(frozen=True)
class _StatusReading:
    #: ``finished`` | ``ongoing`` | ``failed``, or None when OKX answered nothing readable.
    state: str | None
    #: The signed download link. A bearer token: held in memory for this claim only, never
    #: stored, logged or put in an error (``repr=False`` keeps it out of any repr too).
    href: str | None = field(default=None, repr=False)
    ts_ms: int | None = None


@dataclass(frozen=True)
class _QuarterStep:
    #: The link when the quarter is ready to read (memory only, see ``_StatusReading``).
    href: str | None = field(default=None, repr=False)
    #: Seconds to wait when the quarter is not ready.
    wait_s: float = 0.0


async def _apply_quarter_on_fresh_instance(
    key_row: Mapping[str, Any], year: int, quarter: str
) -> _ApplyAnswer:
    """Request one quarter with ONE apply POST on an exchange instance of its own, the
    last call on that instance (ccxt prices it at cost 72000: any later call on the same
    instance blocks about two hours). Exactly one attempt, never routed through
    ``_okx_bills_fetch_with_backoff`` (a retry loop on this call stalls for two hours),
    and the client is closed in ``finally``.

    A transient venue failure (``ccxt.OperationFailed``: rate limit, network) propagates for
    the handler to defer; any other venue refusal is ``archive_request_failed``."""
    api_key, api_secret, passphrase = decrypt_credentials(dict(key_row), get_kek())
    client = _make_exchange_client(key_row["exchange"], api_key, api_secret, passphrase)
    try:
        try:
            raw = await getattr(client, _APPLY_ENDPOINT_METHOD)(
                {"year": str(year), "quarter": quarter}
            )
        except ccxt.OperationFailed:
            raise
        except ccxt.BaseError as exc:
            logger.warning(
                "okx_archive_rebuild: apply for %s refused by the venue (%s): %s",
                _quarter_tag(year, quarter),
                type(exc).__name__,
                scrub_freeform_string(str(exc))[:200],
            )
            raise _Stop("archive_request_failed", f"quarter={_quarter_tag(year, quarter)}") from None
    finally:
        await aclose_exchange(client)
    entry = _first_entry(raw)
    if entry is None:
        raise _Stop("archive_request_failed", f"quarter={_quarter_tag(year, quarter)}")
    return _ApplyAnswer(
        existing=str(entry.get("result")).strip().lower() == "true",
        ts_ms=_parse_ts_ms(entry.get("ts")),
    )


class _ApplyPacer:
    """Spaces the apply POSTs of ONE claim at least ``MIN_APPLY_GAP_S`` apart (OKX documents
    one per 10 s). Per claim and in memory only: across claims the defer is the spacing."""

    def __init__(self) -> None:
        self._last: float | None = None

    async def apply(self, key_row: Mapping[str, Any], year: int, quarter: str) -> _ApplyAnswer:
        if self._last is not None:
            wait = MIN_APPLY_GAP_S - (_monotonic() - self._last)
            if wait > 0:
                await _sleep(wait)
        self._last = _monotonic()
        return await _apply_quarter_on_fresh_instance(key_row, year, quarter)


async def _read_quarter_status(
    exchange: ccxt.Exchange, year: int, quarter: str
) -> _StatusReading:
    """One status read on the preflight instance. The link rides in the returned reading for
    this claim only."""
    raw = await _okx_bills_fetch_with_backoff(
        exchange,
        _STATUS_ENDPOINT_METHOD,
        {"year": str(year), "quarter": quarter},
        label="bills-history-archive",
        page=0,
    )
    entry = _first_entry(raw)
    if entry is None:
        return _StatusReading(state=None)
    state = entry.get("state")
    href = entry.get("fileHref")
    return _StatusReading(
        state=state if isinstance(state, str) and state in _ARCHIVE_STATES else None,
        href=href if isinstance(href, str) and href.strip() else None,
        ts_ms=_parse_ts_ms(entry.get("ts")),
    )


def _record_ready(entry: dict[str, Any], href: str) -> _QuarterStep:
    """The quarter is ready: record the link's scheme and host (and nothing else about it)."""
    scheme, host = describe_href(href)
    if not host:
        # A finished request whose link names no host cannot be read, and a preflight that
        # reports ``finished`` must have the host to report.
        raise _Stop("archive_request_failed", f"quarter={_quarter_tag(entry['year'], entry['quarter'])} link=unreadable")
    entry["href_scheme"] = scheme or None
    entry["href_host"] = host
    logger.info(
        "okx_archive_rebuild: %s finished, link scheme=%s host=%s",
        _quarter_tag(entry["year"], entry["quarter"]),
        scheme,
        host,
    )
    return _QuarterStep(href=href)


async def _quarter_step(
    exchange: ccxt.Exchange,
    key_row: Mapping[str, Any],
    entry: dict[str, Any],
    pacer: _ApplyPacer,
) -> _QuarterStep:
    """ONE claim's decision for ONE quarter, derived from OKX alone (RESEARCH Pattern 1).

    Apply (idempotent), read the state, then ready / wait / stop. Nothing is remembered:
    the same inputs on a different worker give the same answer, which is what makes a
    restart harmless. The request ``ts`` is read from OKX on every claim, so the 8 h bound
    survives restarts and cannot be reset by one.

    * ``finished`` with a link: ready.
    * ``ongoing``: wait (give up at ``GIVE_UP_AFTER_S`` from ``ts``).
    * ``failed``, or ``finished`` WITHOUT a link (a job that took that for success would
      report DONE with the data missing): re-apply ``MAX_REAPPLIES`` times and read again;
      a request that is still ``failed`` afterwards is a permanent stop, and one still
      linkless waits."""
    year, label = entry["year"], entry["quarter"]
    tag = _quarter_tag(year, label)
    answer = await pacer.apply(key_row, year, label)
    entry["applied_existing"] = answer.existing
    # RESEARCH leaves the meaning of ``ts`` open (the apply time, or the first request's). Its
    # age class on every claim is how the first real run measures it: a request that ages
    # across claims has a stable ts, one that keeps reading young does not. Hours only.
    _ts_age = _age_s(answer.ts_ms)
    logger.info(
        "okx_archive_rebuild: %s apply existing=%s ts_age_h=%s",
        tag,
        answer.existing,
        "unreadable" if _ts_age is None else int(_ts_age // 3600),
    )

    if not answer.existing:
        # OKX takes 2-3 h to generate a file: no point asking before then.
        age = _age_s(answer.ts_ms)
        if age is not None and age < FIRST_STATUS_READ_AFTER_S:
            return _QuarterStep(wait_s=FIRST_STATUS_READ_AFTER_S - age)

    ts_ms = answer.ts_ms
    reapplies = 0
    while True:
        reading = await _read_quarter_status(exchange, year, label)
        entry["state"] = reading.state
        if reading.state is None:
            # The state vocabulary is closed; anything else is contract drift, and waiting
            # eight hours to discover it would hide it.
            raise _Stop("archive_request_failed", f"quarter={tag}")
        if reading.state == "finished" and reading.href is not None:
            return _record_ready(entry, reading.href)

        if reading.ts_ms is not None:
            ts_ms = reading.ts_ms
        age = _age_s(ts_ms)
        if age is None:
            # Without OKX's ts there is no bound on the wait: refuse to wait unboundedly.
            raise _Stop("archive_request_failed", f"quarter={tag}")
        too_old = age >= GIVE_UP_AFTER_S
        if reading.state == "ongoing":
            if too_old:
                raise _Stop("archive_give_up", f"quarter={tag} age_h={int(age // 3600)}")
            return _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S)

        # ``failed``, or ``finished`` with no link.
        linkless = reading.state == "finished"
        if too_old:
            if linkless:
                raise _Stop("archive_give_up", f"quarter={tag} age_h={int(age // 3600)}")
            raise _Stop("archive_request_failed", f"quarter={tag}")
        if reapplies >= MAX_REAPPLIES:
            if linkless:
                return _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S)
            raise _Stop("archive_request_failed", f"quarter={tag}")
        reapplies += 1
        renewed = await pacer.apply(key_row, year, label)
        if renewed.ts_ms is not None:
            ts_ms = renewed.ts_ms


# ---------------------------------------------------------------------------
# Waiting: defer_compute_job
# ---------------------------------------------------------------------------

def _check_backstop(job: Mapping[str, Any]) -> None:
    """Raise ``archive_give_up`` when this job is too old to wait any longer. Called by every
    path that would defer. A ``created_at`` that cannot be read is treated as too old to wait:
    a bound that cannot be evaluated must not become no bound at all."""
    raw = job.get("created_at")
    created_ms: int | None = None
    if isinstance(raw, str) and raw.strip():
        try:
            created = datetime.fromisoformat(raw.strip())
        except ValueError:
            created = None
        if created is not None:
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            created_ms = int(created.timestamp() * 1000)
    if created_ms is None:
        raise _Stop("archive_give_up", "backstop age=unreadable")
    age = max(0.0, (_wall_ms() - created_ms) / 1000.0)
    if age >= BACKSTOP_AFTER_S:
        raise _Stop("archive_give_up", f"backstop age_h={int(age // 3600)}")


async def _defer_job(
    supabase: Any, job: Mapping[str, Any], seconds: float, reason: str
) -> DispatchResult:
    """Park the job: ``defer_compute_job`` returns it to ``pending`` at ``now + seconds``,
    decrements ``attempts`` (waiting never burns a retry) and is fenced on the claim token.

    The SQL raises above 3600 s, so the wait is clamped here; ``reason`` becomes
    ``last_error`` and must hold a short class and counts only (no ``ts``, no link).

    Every wait passes the backstop first (``_check_backstop``): a job past ``BACKSTOP_AFTER_S``
    ends in the named ``archive_give_up`` instead of parking again."""
    _check_backstop(job)
    defer_seconds = int(min(max(seconds, MIN_DEFER_S), MAX_DEFER_S))

    def _defer() -> None:
        supabase.rpc(
            "defer_compute_job",
            {
                "p_job_id": job.get("id"),
                "p_defer_seconds": defer_seconds,
                "p_reason": reason,
                "p_claim_token": job.get("claim_token"),
            },
        ).execute()

    try:
        await db_execute(_defer)
    except asyncio.CancelledError:
        raise  # never swallow cancellation
    except Exception as exc:  # noqa: BLE001
        if _defer_lost_ownership(exc):
            # A watchdog reclaim gave the row to another worker: it owns the wait now.
            logger.info(
                "okx_archive_rebuild: defer for job %s preempted; another worker owns it",
                job.get("id"),
            )
            return DispatchResult(outcome=DispatchOutcome.DEFERRED)
        raise
    logger.info("%s (defer %ds)", reason, defer_seconds)
    return DispatchResult(outcome=DispatchOutcome.DEFERRED)


# ---------------------------------------------------------------------------
# Ingest: download, parse, classify (calibrate; apply reuses it in plan 08)
# ---------------------------------------------------------------------------

#: Parse and classification stops mapped into the closed ``STOP_CLASSES``. The first four
#: and the three classification stops keep their names; the parser's remaining stops have
#: no class of their own in the contract, so they map to the nearest one by WHAT FAILED, and
#: the original label always rides in ``last_error`` (``parse=<label>``).
_PARSE_STOP_CLASS: Final[Mapping[str, str]] = {
    "header_drift": "header_drift",
    "quarter_range_mismatch": "quarter_range_mismatch",
    "duplicate_bill_conflict": "duplicate_bill_conflict",
    "unparseable_amount": "unparseable_amount",
    "subtype_map_drift": "subtype_map_drift",
    "unknown_subtype_nonzero": "unknown_subtype_nonzero",
    "non_usd_ccy": "non_usd_ccy",
    # The file's layout is not the pinned one:
    "undecodable_file": "header_drift",
    "malformed_csv": "header_drift",
    "malformed_row": "header_drift",
    "unparseable_ts": "header_drift",
    # A header-only file has no row to authenticate the quarter against:
    "empty_file": "quarter_range_mismatch",
    # Without a billId neither dedup nor conflict detection is possible:
    "missing_bill_id": "duplicate_bill_conflict",
    # The running ``bal`` does not chain: the file is missing rows (verify_bal_chain):
    "archive_incomplete": "archive_incomplete",
}


def _parse_stop(exc: ArchiveParseError, tag: str | None = None) -> _Stop:
    detail = f"parse={exc.stop_class}" if tag is None else f"quarter={tag} parse={exc.stop_class}"
    return _Stop(_PARSE_STOP_CLASS[exc.stop_class], detail)


#: The aggregator's own label for an empty cell (``okx_archive_classify._BLANK``); pinned
#: equal by a census test, not imported (it is private there).
_BLANK_LABEL: Final[str] = "(blank)"


def _safe_counts(counts: Mapping[str, int]) -> dict[str, int]:
    """Counts keyed by labels that came from a file: a label that is not a short plain token
    is merged into ``(malformed)`` rather than echoed into the result."""
    out: dict[str, int] = {}
    for key, count in counts.items():
        safe = key if key == _BLANK_LABEL else (_malformed_or(key) if key else _MALFORMED)
        out[safe] = out.get(safe, 0) + count
    return dict(sorted(out.items()))


async def _download_quarter(
    exchange: ccxt.Exchange, entry: dict[str, Any], href: str, budget: _ClaimBudget
) -> tuple[bytes, str, int]:
    """Download one quarter's file. A 403/410 (an expired link, about 5.5 h after
    generation) is answered with exactly ONE fresh status read and ONE retry on the link
    that read returns; a second expiry, or a read with no link, is the transient
    ``link_expired``: come back later, never DONE with data missing.

    Every exception that can carry the signed URL in its message (httpx's do) is turned
    into a fixed-vocabulary stop here, with ``from None``, so the link reaches neither
    ``last_error`` nor a log."""
    year, label = entry["year"], entry["quarter"]
    tag = _quarter_tag(year, label)
    refreshed = False
    while True:
        try:
            return await _within(budget, download_archive_csv(href), step="download")
        except LinkExpired:
            if refreshed:
                raise _Stop("link_expired", f"quarter={tag} cause=expired_twice") from None
            refreshed = True
            reading = await _read_quarter_status(exchange, year, label)
            if reading.state != "finished" or reading.href is None:
                raise _Stop("link_expired", f"quarter={tag} cause=no_fresh_link") from None
            href = reading.href
        except DownloadRefused as refusal:
            # ``reason`` is the downloader's closed vocabulary; the host rides in the block.
            raise _Stop("download_refused", f"quarter={tag} reason={refusal.reason}") from None
        except (httpx.HTTPError, TimeoutError):
            raise _Stop("link_expired", f"quarter={tag} cause=network") from None


async def _ingest_quarter(
    exchange: ccxt.Exchange, entry: dict[str, Any], href: str, budget: _ClaimBudget
) -> ArchiveFile:
    """Download one quarter's file, record the Result shape v1 readings and parse it.

    The parsed file lives in the caller's local variables for this claim only."""
    year, label = entry["year"], entry["quarter"]
    tag = _quarter_tag(year, label)
    csv_bytes, container, compressed_bytes = await _download_quarter(exchange, entry, href, budget)
    entry["container"] = container
    entry["compressed_bytes"] = compressed_bytes
    entry["decompressed_bytes"] = len(csv_bytes)
    try:
        parsed = await asyncio.to_thread(parse_archive_csv, csv_bytes, year=year, quarter=label)
    except ArchiveParseError as exc:
        raise _parse_stop(exc, tag) from None
    entry["has_type_column"] = parsed.has_type_column
    entry["ts_min_day"] = parsed.ts_min_day
    entry["ts_max_day"] = parsed.ts_max_day
    entry["row_count"] = parsed.row_count
    entry["longest_billless_run"] = longest_billless_run(parsed)
    return parsed


def _stop_census(files: list[ArchiveFile]) -> dict[str, Any]:
    """The Result shape v1 ``census`` of files that stopped in classification.

    ``aggregate_archive`` raises BEFORE it returns a census, and its stop detail is
    deliberately not echoed (file-derived labels). The two stops where the founder must see
    the per-currency / per-subType picture to decide (``non_usd_ccy``,
    ``unknown_subtype_nonzero``) therefore get the same counts the clean census carries,
    computed here from the same de-duplicated rows. Counts only, never an amount; a label
    that is not a short plain token is merged into ``(malformed)`` as everywhere else."""
    unique: dict[str, Any] = {}
    for file in files:
        for row in file.rows:
            unique.setdefault(row.bill_id, row)
    by_ccy: Counter[str] = Counter()
    by_inst: Counter[str] = Counter()
    by_sub: Counter[str] = Counter()
    unknown_zero = 0
    for row in unique.values():
        by_ccy[row.ccy or _BLANK_LABEL] += 1
        by_inst[row.inst_type or _BLANK_LABEL] += 1
        by_sub[row.sub_type or _BLANK_LABEL] += 1
        if SUBTYPE_BUCKETS.get(row.sub_type, Bucket.UNKNOWN) is Bucket.UNKNOWN and not (
            row.pnl != 0 or row.fee != 0 or row.bal_chg != 0
        ):
            unknown_zero += 1
    return {
        "by_ccy": _safe_counts(by_ccy),
        "by_inst_type": _safe_counts(by_inst),
        "by_sub_type": _safe_counts(by_sub),
        "unknown_zero_effect": unknown_zero,
    }


#: The ``archive_incomplete`` reasons ``verify_bal_chain`` raises: a closed vocabulary, the only
#: text of the stop that reaches ``last_error`` (as ``cause=``).
_ARCHIVE_INCOMPLETE_REASONS: Final[frozenset[str]] = frozenset(
    {"bal_chain_break", "too_few_pairs", "unchainable_row"}
)


def _bal_chain_info(detail: Mapping[str, Any]) -> dict[str, Any]:
    """The Result ``info.bal_chain`` of an ``archive_incomplete`` stop: the reason, per ccy the
    pairs checked, the first and last day the chain reaches and (on a break) the breaks, how
    many sit on a pair that crosses two files and the day of the first, the total, the starved
    ccys and each file's ts range. Counts and dates only; a ccy label that is not a short
    plain token is merged into ``(malformed)`` as everywhere else."""
    out = _safe_bal_chain(detail)
    reason = detail.get("reason")
    out = {"reason": reason if reason in _ARCHIVE_INCOMPLETE_REASONS else _MALFORMED, **out}
    if "starved" in detail:
        out["starved"] = sorted(_malformed_or(ccy) for ccy in detail["starved"])
    if "files" in detail:
        out["files"] = [
            {"ts_min_day": file["ts_min_day"], "ts_max_day": file["ts_max_day"]}
            for file in detail["files"]
        ]
    out["floor"] = MIN_CHAINED_PAIRS
    return out


def _safe_bal_chain(reading: Mapping[str, Any]) -> dict[str, Any]:
    """``{"ccys": ..., "total_pairs": n}`` of a ``verify_bal_chain`` reading (or of a stop's
    detail) with ccy labels made safe. Labels that collapse to the same safe label merge."""
    ccys: dict[str, dict[str, Any]] = {}
    for ccy, entry in reading.get("ccys", {}).items():
        safe = _malformed_or(ccy)
        kept = ccys.get(safe)
        if kept is None:
            ccys[safe] = dict(entry)
            continue
        kept["pairs_checked"] += entry["pairs_checked"]
        kept["first_day"] = min(kept["first_day"], entry["first_day"])
        kept["last_day"] = max(kept["last_day"], entry["last_day"])
        for count in ("breaks", "seam_breaks"):
            if count in entry:
                kept[count] = kept.get(count, 0) + entry[count]
        days = [d for d in (kept.get("first_break_day"), entry.get("first_break_day")) if d is not None]
        if "first_break_day" in entry:
            kept["first_break_day"] = min(days, default=None)
    return {"ccys": ccys, "total_pairs": reading.get("total_pairs")}


#: Classification stops whose result block carries the file's census (see ``_stop_census``).
_CENSUS_ON_STOP: Final[frozenset[str]] = frozenset({"non_usd_ccy", "unknown_subtype_nonzero"})


async def _census_of(
    files: list[ArchiveFile], live_types: Mapping[str, str]
) -> tuple[dict[str, Any], ArchiveAggregate, dict[str, Any]]:
    """Classify every bill of the verified files and return the Result shape v1 ``census``
    (counts only, never an amount), the aggregate the evaluation reads and the ``bal_chain``
    reading of the one gated chain (``info.bal_chain`` of a passing run)."""
    try:
        aggregate = await asyncio.to_thread(aggregate_archive, files, live_types)
        # F1 / WR-01: only after the rows classify, prove the quarters are whole, per currency
        # across adjacent files. Interior and seam completeness is what lets a bill-less
        # covered day stand as a real zero.
        chain = await asyncio.to_thread(verify_bal_chain, files, aggregate.summed_ccys)
    except ArchiveParseError as exc:
        stop = _parse_stop(exc)
        if exc.stop_class in _CENSUS_ON_STOP:
            stop.census = _stop_census(files)
        if exc.stop_class == "archive_incomplete":
            info = _bal_chain_info(exc.detail)
            stop.detail = f"{stop.detail} cause={info['reason']}"
            stop.info = {"bal_chain": info}
        raise stop from None
    census = aggregate.census
    return (
        {
            "by_ccy": _safe_counts(census["by_ccy"]),
            "by_inst_type": _safe_counts(census["by_inst_type"]),
            "by_sub_type": _safe_counts(census["by_sub_type"]),
            "unknown_zero_effect": aggregate.unknown_zero_effect,
        },
        aggregate,
        {**_safe_bal_chain(chain), "floor": MIN_CHAINED_PAIRS},
    )


@dataclass(frozen=True)
class _Ingested:
    """The verified files, their classification and the proof that they chain, for this claim
    only."""

    files: list[ArchiveFile]
    aggregate: ArchiveAggregate
    bal_chain: dict[str, Any]


async def _ingest_all(
    exchange: ccxt.Exchange,
    quarters: list[dict[str, Any]],
    steps: list[_QuarterStep],
    live_types: Mapping[str, str],
    result: dict[str, Any],
    budget: _ClaimBudget,
) -> _Ingested:
    files: list[ArchiveFile] = []
    for entry, step in zip(quarters, steps):
        assert step.href is not None  # every quarter was ready, or the job deferred
        files.append(await _ingest_quarter(exchange, entry, step.href, budget))
    result["census"], aggregate, bal_chain = await _census_of(files, live_types)
    return _Ingested(files=files, aggregate=aggregate, bal_chain=bal_chain)


# ---------------------------------------------------------------------------
# Evaluation (plan 08): the live reference, the reconciliation to the cent, the rebuild
# preview, the D-03 check and the fingerprint. ``calibrate`` ends here; ``apply`` runs the
# SAME code and then writes (so what the founder approved is exactly what apply re-checks).
# ---------------------------------------------------------------------------

#: The unit of a D-03 hit and of nothing else: a stored 0.0 day is a hit when the archive
#: realized or funding sum for it, rounded to the cent (half up), is not zero.
_CENT: Final[Decimal] = Decimal("0.01")
#: Wide enough that rounding an archive sum (bounded to 30 digits per cell) cannot raise.
_WIDE: Final[Context] = Context(prec=80)
_READ_PAGE: Final[int] = 1000
#: The provenance source the RPC pins (``c_source`` in the migration, ``RECONSTRUCTED_SOURCE``
#: in the public reader). A stored range with any other source is not this job's.
_ARCHIVE_SOURCE: Final[str] = "okx_bills_history_archive"
#: ``info.stored_vs_core``: one basis point of return, the return-space analogue of the cent.
#: A reported reading, never a gate (D-09: information, not a gate).
STORED_VS_CORE_TOL: Final[float] = 1e-4
#: Misses echoed per leg (the count is always exact; the list is for reading, not for gating).
_MAX_MISSES_REPORTED: Final[int] = 100
_ISO_DAY_RE: Final[re.Pattern[str]] = re.compile(r"\d{4}-\d{2}-\d{2}")
_FAR_FUTURE_DAY: Final[str] = "2999-12-31"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dec(value: Decimal) -> str:
    """Canonical text of a Decimal: no exponent, no trailing zeros (10.50 and 10.5 read the
    same), ``"0"`` for any zero."""
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def _cent_nonzero(value: Decimal) -> bool:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP, context=_WIDE) != 0


def _iso_day(value: object) -> str | None:
    """``value`` when it is a real ``YYYY-MM-DD`` calendar day (the compact ``YYYYMMDD`` form
    that ``date.fromisoformat`` also accepts is not), else None."""
    if not isinstance(value, str) or not _ISO_DAY_RE.fullmatch(value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def _days_in(first: str, last: str) -> list[str]:
    start, end = date.fromisoformat(first), date.fromisoformat(last)
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def _expand(ranges: list[dict[str, str]]) -> set[str]:
    out: set[str] = set()
    for r in ranges:
        out.update(_days_in(r["from"], r["to"]))
    return out


# ----- the live side, crawled fresh at job time (D-09) ------------------------------------

@dataclass(frozen=True)
class _LiveReference:
    """What the live derive would see right now, from the same functions and bounds, so the
    comparison with the archive is two endpoints of one ledger minutes apart."""

    equity: float | None
    balance_error: bool
    #: Already noise-guarded exactly as the derive does (0.0 on a heuristic or dust anchor).
    open_unrealized_usd: float
    upnl_unreadable: bool
    realized: list[dict[str, Any]]
    funding: list[Any]
    flows: list[ExternalFlow]
    full_history: bool
    realized_by_day: dict[str, Decimal]
    funding_by_day: dict[str, Decimal]
    #: The live realized reach's boundary day, derived from the FETCH WINDOW (never from the
    #: first record): OKX cut the reach at an arbitrary instant that day, so it is partial,
    #: never compared, and owned by the archive (CR-01).
    reach_boundary_day: str
    #: The first day the live realized P&L owns: the day after the boundary day.
    first_full_day: str
    #: The first day of the live deposit/withdrawal window (``flow_retention_floor``), or None
    #: for a venue with no retention cap. The archive's transfer bills are used before it,
    #: the live flows from it (F4).
    flow_window_first_day: str | None


def _record_day(timestamp: object) -> str:
    day = _iso_day(str(timestamp)[:10])
    if day is None:
        raise _Stop("live_anchor_unusable", "live_record=undatable")
    return day


def _decimal_of(value: object) -> Decimal:
    try:
        out = value if isinstance(value, Decimal) else Decimal(repr(float(value)))  # type: ignore[arg-type]
    except (InvalidOperation, TypeError, ValueError):
        raise _Stop("live_anchor_unusable", "live_amount=unreadable") from None
    if not out.is_finite():
        raise _Stop("live_anchor_unusable", "live_amount=unreadable")
    return out


def _live_realized_by_day(records: list[dict[str, Any]]) -> dict[str, Decimal]:
    """Signed dollars per UTC day from the ``fetch_daily_pnl`` records (``side`` encodes the
    sign, ``price`` is the absolute amount)."""
    out: dict[str, Decimal] = {}
    for rec in records:
        day = _record_day(rec.get("timestamp"))
        amount = _decimal_of(rec.get("price"))
        out[day] = out.get(day, Decimal(0)) + (amount if rec.get("side") == "buy" else -amount)
    return out


def _live_funding_by_day(funding_rows: list[Any]) -> dict[str, Decimal]:
    out: dict[str, Decimal] = {}
    for row in funding_rows:
        stamp = row.get("timestamp")
        if isinstance(stamp, datetime):
            aware = stamp if stamp.tzinfo is not None else stamp.replace(tzinfo=timezone.utc)
            day = aware.astimezone(timezone.utc).date().isoformat()
        else:
            day = _record_day(stamp)
        out[day] = out.get(day, Decimal(0)) + _decimal_of(row.get("amount"))
    return out


#: ccxt exception classes ``fetch_daily_pnl`` records (by name) for a venue rate limit.
_RATE_LIMIT_CLASSES: Final[frozenset[str]] = frozenset({"RateLimitExceeded", "DDoSProtection"})
_CLASS_NAME_RE: Final[re.Pattern[str]] = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")


def _check_live_realized_flags(flags: Mapping[str, Any]) -> None:
    """Turn what ``fetch_daily_pnl`` left in the DQ buffer into a decision, never into data.

    * a swallowed venue rate limit is re-raised as ``ccxt.RateLimitExceeded`` so the handler
      defers (and, as everywhere in this job, never stamps the key);
    * any other swallowed fetch error is the transient ``live_fetch_failed`` (the exception
      CLASS only, never its text, which can carry a signed URL): a failed crawl is not a
      quiet account, and an empty series must not reach the reconciliation;
    * a page-cap truncation means the OLDEST live days are missing, the very days the
      reconciliation and the NAV roll lean on: the live realized series is unusable."""
    if flags.get("daily_pnl_fetch_error"):
        name = flags.get("daily_pnl_fetch_error_class")
        if name in _RATE_LIMIT_CLASSES:
            raise ccxt.RateLimitExceeded("live realized crawl was rate limited")
        label = name if isinstance(name, str) and _CLASS_NAME_RE.fullmatch(name) else _MALFORMED
        raise _Stop("live_fetch_failed", f"class={label}")
    if flags.get("daily_pnl_truncated_okx"):
        raise _Stop("live_anchor_unusable", "live_realized=truncated")


async def _live_reference(
    exchange: ccxt.Exchange, supabase: Any, api_key_id: str, budget: _ClaimBudget
) -> _LiveReference:
    """The live derive's crawl for an OKX key, with its bounds: equity and open uPnL, the
    FULL realized history (``since_ms=None``), OKX funding, and ccxt deposits and withdrawals
    valued by the same flow valuer. Each crawl is bounded by ``_BROKER_CRAWL_TIMEOUT_S`` AND by
    what is left of the claim's budget (WR-06); running out is the named transient
    ``claim_budget_exceeded`` naming the step (a retry resumes statelessly). A venue rate limit
    is deferred by the handler."""
    equity, balance_error, open_unrealized, upnl_unreadable = await _within(
        budget, fetch_account_equity_and_upnl_usd(exchange, "okx"),
        step="live_equity", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
    realized = await _within(
        budget, fetch_all_trades(exchange, since_ms=None),
        step="live_realized", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
    # F2 / WR-03: the fetch swallows every error and returns what it has; the only trace is
    # the per-task DQ buffer. Read it NOW, before any other crawl can reset it.
    _check_live_realized_flags(get_and_clear_last_dq_flags())
    funding = await _within(
        budget, fetch_funding_okx(exchange, api_key_id, None),
        step="live_funding", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
    now_utc = _utc_now()
    now_ms = int(now_utc.timestamp() * 1000)
    floor = flow_retention_floor("okx", now_utc)
    flow_since_ms = 0 if floor is None else max(0, int(floor.timestamp() * 1000))
    deposits = await _within(
        budget, fetch_ccxt_transfers(exchange, "deposits", flow_since_ms, now_ms),
        step="live_deposits", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
    withdrawals = await _within(
        budget, fetch_ccxt_transfers(exchange, "withdrawals", flow_since_ms, now_ms),
        step="live_withdrawals", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
    flow_rows = list(deposits) + list(withdrawals)
    price_index = await _within(
        budget, _resolve_ccxt_flow_price_index(exchange, "okx", supabase, flow_rows),
        step="live_prices", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
    try:
        flows = ccxt_rows_to_dated_flows(flow_rows, venue="okx", price_index=price_index)
    except NavReconstructionError:
        # A coin flow with no same-day price, or a schema-drifted amount: the live anchor
        # cannot be rolled, and a rebuild must not guess it. (Message dropped: it can carry
        # a raw amount.)
        raise _Stop("live_anchor_unusable", "live_flows=unvaluable") from None

    # The derive's noise guard: the open-uPnL wedge is only trustworthy on a trustworthy anchor.
    if balance_error or equity is None or abs(equity) <= DUST_NAV_FLOOR:
        open_unrealized = 0.0

    realized_by_day = _live_realized_by_day(realized)
    reach_boundary = (now_utc - timedelta(days=LIVE_REACH_ASSUMED_DAYS)).date()
    return _LiveReference(
        equity=equity,
        balance_error=balance_error,
        open_unrealized_usd=open_unrealized,
        upnl_unreadable=upnl_unreadable,
        realized=realized,
        funding=list(funding),
        flows=list(flows),
        # The same verdict the derive passes (164.6.6.2.3 D-11), on the same live inputs.
        full_history=_ccxt_full_history_verdict("okx", realized, funding, now_utc),
        realized_by_day=realized_by_day,
        funding_by_day=_live_funding_by_day(list(funding)),
        reach_boundary_day=reach_boundary.isoformat(),
        first_full_day=(reach_boundary + timedelta(days=1)).isoformat(),
        flow_window_first_day=None if floor is None else floor.date().isoformat(),
    )


# ----- reconciliation (D-09, D-10, D-11) --------------------------------------------------

def _windows(
    quarters: list[tuple[int, str]], first_full_day: date, today: date
) -> list[tuple[str, str]]:
    """The inclusive overlap windows of the requested quarters, adjacent ones merged."""
    runs: list[tuple[str, str]] = []
    for year, label in quarters:
        start, end_excl = quarter_bounds(year, label)
        window = overlap_window(start, end_excl, first_full_day, today)
        if window is not None:
            runs.append(window)
    merged: list[list[str]] = []
    for first, last in sorted(runs):
        if merged and date.fromisoformat(first) <= date.fromisoformat(merged[-1][1]) + timedelta(days=1):
            merged[-1][1] = max(merged[-1][1], last)
        else:
            merged.append([first, last])
    return [(first, last) for first, last in merged]


def _leg_of(readings: list[LegReading]) -> dict[str, Any]:
    """One Result shape v1 ``Leg`` from the reading of each window (usually one)."""
    misses = [m for r in readings for m in r.misses]
    return {
        "ok": all(r.ok for r in readings),
        "days_compared": sum(r.days_compared for r in readings),
        "active_days": sum(r.active_days for r in readings),
        "max_abs_diff": _dec(max((r.max_abs_diff for r in readings), default=Decimal(0))),
        "window_total_diff": _dec(sum((r.window_total_diff for r in readings), Decimal(0))),
        "days_over_half_cent": sum(r.days_over_half_cent for r in readings),
        "days_over_cent": sum(r.days_over_cent for r in readings),
        "first_offending": [m[0] for m in misses[:10]],
        "misses": [
            {"date": day, "archive": _dec(archive), "live": _dec(live)}
            for day, archive, live in misses[:_MAX_MISSES_REPORTED]
        ],
    }


def _reconcile(
    result: dict[str, Any],
    aggregate: ArchiveAggregate,
    live: _LiveReference,
    quarters: list[tuple[int, str]],
) -> list[tuple[str, str]]:
    """D-09 / D-10: the realized leg and the funding leg per day and on the window total over
    the overlap window, with ``TOLERANCE_USD`` only (``reconcile_leg`` carries it, with no
    parameter). The excluded classes and flow totals are reported, never gated. The window
    opens the day after the reach boundary day, which comes from the fetch window (CR-01): a
    day the crawl missed inside it is then an archive-only day and a miss, not an unexamined
    one. A miss, or no window at all, is the permanent ``reconcile_miss`` (D-11). Returns the
    windows."""
    reconcile: dict[str, Any] = {
        "window": None,
        "excluded_boundary_day": live.reach_boundary_day,
        "realized": None,
        "funding": None,
    }
    result["reconcile"] = reconcile
    result["excluded"] = {
        "excluded_by_month": {
            month: {cls: _dec(total) for cls, total in sorted(by_class.items())}
            for month, by_class in sorted(aggregate.excluded_by_month.items())
        }
    }
    windows = _windows(quarters, date.fromisoformat(live.first_full_day), _utc_today())
    if not windows:
        # Calibration cannot be taken: the live reach no longer touches the verified quarters
        # (RESEARCH Pitfall 9). The runbook names the date.
        raise _Stop("reconcile_miss", "window=none")
    reconcile["window"] = {"from": windows[0][0], "to": windows[-1][1]}
    realized_readings = [
        reconcile_leg("realized", aggregate.realized_by_day, live.realized_by_day, w) for w in windows
    ]
    funding_readings = [
        reconcile_leg("funding", aggregate.funding_by_day, live.funding_by_day, w) for w in windows
    ]
    reconcile["realized"] = _leg_of(realized_readings)
    reconcile["funding"] = _leg_of(funding_readings)
    if all(r.ok for r in realized_readings + funding_readings):
        # F3: agreement only authenticates the file when the window could have disagreed. Two
        # empty series agree however wrong the file is, so a short or quiet window is a stop of
        # its own. Judged on the realized leg: that is the P&L being rebuilt.
        days, active, enough = overlap_evidence(realized_readings)
        if not enough:
            raise _Stop(
                "reconcile_miss",
                f"cause=insufficient_overlap window={windows[0][0]}..{windows[-1][1]} "
                f"days={days} active={active} need_days={MIN_COMPARED_DAYS} "
                f"need_active={MIN_ACTIVE_DAYS}",
            )
        return windows
    offending = sorted(
        {m[0] for r in realized_readings + funding_readings for m in r.misses}
    )
    detail = f"window={windows[0][0]}..{windows[-1][1]}"
    detail += f" realized_days_over_cent={reconcile['realized']['days_over_cent']}"
    detail += f" funding_days_over_cent={reconcile['funding']['days_over_cent']}"
    if offending:
        detail += f" offending={offending[0]}..{offending[-1]}"
    else:
        detail += " cause=window_total"
    raise _Stop("reconcile_miss", detail)


# ----- reads of the stored side -----------------------------------------------------------

async def _read_daily_returns(
    supabase: Any, strategy_id: str, first: str, last: str
) -> list[dict[str, Any]]:
    """A strategy's stored ``csv_daily_returns`` rows in ``[first, last]``, keyset-paged on
    the date (a PostgREST response is capped, and a page boundary must never lose a day)."""
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:

        def _page(after: str | None = cursor) -> Any:
            query = (
                supabase.table("csv_daily_returns")
                .select("date,daily_return")
                .eq("strategy_id", strategy_id)
                .gte("date", first)
                .lte("date", last)
            )
            if after is not None:
                query = query.gt("date", after)
            return query.order("date", desc=False).limit(_READ_PAGE).execute()

        chunk = rows(await db_execute(_page))
        out.extend(chunk)
        if len(chunk) < _READ_PAGE:
            return out
        cursor = str(chunk[-1]["date"])


def _refused(position: int, reason: str) -> _Stop:
    """A state the RPC cannot express, decided before the first RPC (D-11). ``reason`` is a
    fixed literal of this module."""
    return _Stop("rpc_refused", f"position={position} reason={reason}")


def _stored_ranges(
    provenance: object, key: str, position: int, *, archive_only: bool
) -> list[dict[str, str]]:
    """``[{from, to}]`` sorted, from ``series_provenance[key]``. A malformed record is a
    stop, not a guess (the RPC refuses it too, and it must be refused before the first call).
    With ``archive_only`` only entries whose ``source`` is the archive's are returned."""
    if provenance is None:
        return []
    if not isinstance(provenance, Mapping):
        raise _refused(position, "provenance_malformed")
    raw = provenance.get(key)
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise _refused(position, f"{key}_malformed")
    out: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, Mapping):
            raise _refused(position, f"{key}_malformed")
        if archive_only and entry.get("source") != _ARCHIVE_SOURCE:
            continue
        first, last = _iso_day(entry.get("from")), _iso_day(entry.get("to"))
        if first is None or last is None or last < first:
            raise _refused(position, f"{key}_malformed")
        out.append({"from": first, "to": last})
    return sorted(out, key=lambda r: (r["from"], r["to"]))


@dataclass(frozen=True)
class _TargetPlan:
    """One rebuild target's slice of the preview, and what apply sends for it."""

    position: int
    strategy_id: str
    #: The stored gaps as read (``p_expected_gaps``).
    stored_gaps: list[dict[str, str]]
    #: The rows to insert (covered, in a stored gap, finite, no existing row, before the live
    #: first day). Empty when the target has nothing left to write.
    rows: list[dict[str, Any]]
    #: The narrowed gaps the RPC must compute for itself (``p_expected_gaps_after``).
    expected_after: list[dict[str, str]]
    #: Resumability rule 1: covered, finite, before the live first day, and either a stored
    #: gap day with no row or a day inside a stored archive range. It equals the row date set
    #: before this target's RPC commits and after it, which is why the fingerprint hashes it.
    planned_dates: list[str]
    #: True when ``planned_dates`` is non-empty and every planned day already lies inside a
    #: stored archive-sourced ``reconstructed_ranges`` entry: the proof that THIS job applied
    #: this target already (WR-05).
    archive_covers_planned: bool


def _plan_target(
    position: int,
    strategy_id: str,
    provenance: object,
    existing_days: set[str],
    rebuilt: RebuildResult,
    covered: frozenset[str],
) -> _TargetPlan:
    gaps = _stored_ranges(provenance, "unrecovered_gaps", position, archive_only=False)
    archive_ranges = _stored_ranges(provenance, "reconstructed_ranges", position, archive_only=True)
    rows_out, expected_after = rows_for_strategy(rebuilt, gaps, existing_days, covered)
    gap_days_without_row = _expand(gaps) - existing_days
    eligible = gap_days_without_row | _expand(archive_ranges)
    finite = {
        ts.date().isoformat()
        for ts, value in rebuilt.returns.items()
        if math.isfinite(float(value))
    }
    planned = sorted(
        day for day in eligible if day in finite and day in covered and day < rebuilt.live_first_day
    )
    recorded = _expand(archive_ranges)
    return _TargetPlan(
        position=position,
        strategy_id=strategy_id,
        stored_gaps=gaps,
        rows=rows_out,
        expected_after=expected_after,
        planned_dates=planned,
        archive_covers_planned=bool(planned) and all(day in recorded for day in planned),
    )


# ----- D-03 --------------------------------------------------------------------------------

async def _d03_check(
    supabase: Any, zero_check_ids: tuple[str, ...], aggregate: ArchiveAggregate
) -> dict[str, Any]:
    """D-03, read-only: every stored 0.0-return day of each zero-check strategy that lies
    inside a verified quarter is compared with the archive. A day whose archive realized or
    funding sum is nonzero at the cent is a hit. Nothing is ever rewritten."""
    covered = aggregate.covered_days
    first, last = min(covered), max(covered)
    checked = 0
    hits: list[dict[str, Any]] = []
    for strategy_id in zero_check_ids:
        for row in await _read_daily_returns(supabase, strategy_id, first, last):
            day, value = str(row["date"]), row.get("daily_return")
            if day not in covered or value is None or float(value) != 0.0:
                continue
            checked += 1
            realized = aggregate.realized_by_day.get(day, Decimal(0))
            funding = aggregate.funding_by_day.get(day, Decimal(0))
            if _cent_nonzero(realized) or _cent_nonzero(funding):
                hits.append(
                    {
                        "date": day,
                        "stored_return": float(value),
                        "archive_realized": _dec(realized),
                        "archive_funding": _dec(funding),
                    }
                )
    hits.sort(key=lambda h: h["date"])
    return {"checked_days": checked, "hits": hits}


# ----- information readings (never gates) -------------------------------------------------

def _balance_vs_nav(files: list[ArchiveFile], live: _LiveReference) -> dict[str, Any]:
    """The archive's USD-family balance after its last bill on or before the reach boundary
    day (the last day the archive owns), against the NAV the live roll puts at the end of that
    day: today's equity less the open-uPnL wedge less every live P&L, funding and flow dated
    from the first full live day on. The union rolls its archive days from exactly this NAV,
    so a large ``diff`` is the one reading that checks the anchor itself (CR-01)."""
    prev = live.reach_boundary_day
    owned = live.first_full_day
    latest: dict[str, Any] = {}
    for file in files:
        for row in file.rows:
            if row.day > prev or row.ccy not in ARCHIVE_USD_FAMILY:
                continue
            order = (row.ts_ms, int(row.bill_id) if row.bill_id.isdigit() else 0, row.bill_id)
            kept = latest.get(row.ccy)
            if kept is None or order > kept[0]:
                latest[row.ccy] = (order, row.bal)
    archive_bal = sum((bal for _, bal in latest.values()), Decimal(0)) if latest else None
    rolled: Decimal | None = None
    if live.equity is not None and math.isfinite(live.equity):
        after = sum(
            (v for d, v in live.realized_by_day.items() if d >= owned), Decimal(0)
        ) + sum((v for d, v in live.funding_by_day.items() if d >= owned), Decimal(0))
        after += sum(
            (Decimal(repr(float(f.usd_signed))) for f in live.flows if f.utc_day_iso >= owned),
            Decimal(0),
        )
        rolled = Decimal(repr(live.equity)) - Decimal(repr(live.open_unrealized_usd)) - after
    return {
        "day": prev,
        "archive_balance_usd_family": None if archive_bal is None else _dec(archive_bal),
        "rolled_nav": None if rolled is None else _dec(rolled),
        "diff": None if archive_bal is None or rolled is None else _dec(archive_bal - rolled),
    }


#: How many days either side of the flow seam (``live_flows_from_day``) the seam reading looks.
#: A movement straddles the seam when its on-chain leg and its funding-to-trading transfer fall
#: on different sides of it; those legs are usually minutes to a few days apart, so a week each
#: way catches the realistic cases and stays small enough to read. A reading, not a bound.
FLOW_SEAM_MARGIN_DAYS: Final[int] = 7


def _flow_readings(
    aggregate: ArchiveAggregate, live: _LiveReference, reconcile_days: set[str]
) -> tuple[dict[str, str], dict[str, Any] | None]:
    """The two flow readings, both measured around the REAL flow seam (WR-03), never gated.

    The rebuild uses archive transfer bills dated before ``live.flow_window_first_day`` and
    live deposits and withdrawals from it on, so a movement whose two legs straddle the seam
    is either in neither source or in both. The reconcile window opens at the live P&L reach
    (run date minus 87 days), not at the flow seam (midnight minus 90 days), so a total over
    it never looks at the seam.

    * ``flow_totals_overlap``: the archive and live flow totals from the seam to the last covered
      archive day (WR-02: the days BOTH sources can carry; the live flows start at the seam, so
      an earlier start compared a stretch where only the archive can have data, and a movement
      counted by both sources across the seam read as agreement). A venue with no deposit
      retention cap has no seam; its total stays over the reconcile window.
    * ``flow_seam``: within ``FLOW_SEAM_MARGIN_DAYS`` before the seam and up to as many days
      after it, but never past the last covered archive day (WR-04), the archive transfers the
      roll USES (before it), the archive transfers it DISCARDS (from it on), and the live flows
      it uses (from it on). ``diff`` is discarded minus used: nonzero when the sources disagree
      after the seam, which is what a straddle looks like. ``None`` with no seam. When the
      archive ends before the seam there is nothing to compare: the three after-seam readings
      and ``diff`` are ``None`` and ``unmeasurable`` says why, so it never reads as a zero."""
    seam = live.flow_window_first_day
    live_flows = [(f.utc_day_iso, Decimal(repr(float(f.usd_signed)))) for f in live.flows]
    if seam is None:
        days = reconcile_days
        archive_total = sum((v for d, v in aggregate.flows_by_day.items() if d in days), Decimal(0))
        live_total = sum((v for d, v in live_flows if d in days), Decimal(0))
        return {"archive": _dec(archive_total), "live": _dec(live_total)}, None

    seam_day = date.fromisoformat(seam)
    margin = timedelta(days=FLOW_SEAM_MARGIN_DAYS)
    first = (seam_day - margin).isoformat()
    last_covered = max(aggregate.covered_days, default=first)
    archive_total = sum(
        (v for d, v in aggregate.flows_by_day.items() if seam <= d <= last_covered), Decimal(0)
    )
    live_total = sum((v for d, v in live_flows if seam <= d <= last_covered), Decimal(0))
    # WR-04: the live side counts days the archive cannot carry once the archive ends, so the
    # after-window stops at the archive's last covered day.
    after_last = min((seam_day + margin - timedelta(days=1)).isoformat(), last_covered)
    archive_before = sum(
        (v for d, v in aggregate.flows_by_day.items() if first <= d < seam), Decimal(0)
    )
    reading: dict[str, Any] = {
        "seam_day": seam,
        "margin_days": FLOW_SEAM_MARGIN_DAYS,
        "window": {"from": first, "to": after_last},
        "archive_before_seam_used": _dec(archive_before),
    }
    if after_last < seam:
        reading.update(
            archive_from_seam_discarded=None,
            live_from_seam_used=None,
            diff=None,
            unmeasurable="archive_ends_before_the_seam",
        )
    else:
        archive_after = sum(
            (v for d, v in aggregate.flows_by_day.items() if seam <= d <= after_last), Decimal(0)
        )
        live_after = sum((v for d, v in live_flows if seam <= d <= after_last), Decimal(0))
        reading.update(
            archive_from_seam_discarded=_dec(archive_after),
            live_from_seam_used=_dec(live_after),
            diff=_dec(archive_after - live_after),
        )
    return {"archive": _dec(archive_total), "live": _dec(live_total)}, reading


async def _stored_vs_core(
    supabase: Any, target_ids: tuple[str, ...], rebuilt: RebuildResult
) -> dict[str, Any]:
    """Each target's STORED live-day returns against the live-only core's, over the days both
    carry. A reading of whether the stored live series still matches what the derive would
    write today; never a gate. The first live day is left out (it is no longer day 0 in the
    union, and ``first_live_day_differs`` already reports it)."""
    core = {ts.date().isoformat(): float(v) for ts, v in rebuilt.returns.items()}
    compared = 0
    offending: list[str] = []
    for strategy_id in target_ids:
        stored = await _read_daily_returns(
            supabase, strategy_id, rebuilt.live_first_day, _FAR_FUTURE_DAY
        )
        for row in stored:
            day, value = str(row["date"]), row.get("daily_return")
            if day <= rebuilt.live_first_day or value is None or day not in core:
                continue
            if not (math.isfinite(core[day]) and math.isfinite(float(value))):
                continue
            compared += 1
            if abs(float(value) - core[day]) > STORED_VS_CORE_TOL:
                offending.append(day)
    offending.sort()
    return {
        "days_compared": compared,
        "days_over_cent": len(offending),
        "first_offending": offending[:10],
    }


def _returns_summary(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The founder's preview of the VALUES a target's rows carry (F4): the smallest and the
    largest daily return and the compounded return of the whole stretch, as plain floats
    (a return is a ratio, not an amount). ``None`` when there is no row. ``cumulative`` is
    ``None`` when a day's return would make the compounding meaningless (<= -100%): an
    uncomputable value is null, never a guess.

    These are anchored on today's equity, so they are NOT in the fingerprint (a legitimate
    equity move between calibrate and apply must not void the approval); they are what the
    founder reads to judge the numbers the fingerprint deliberately does not pin."""
    if not rows:
        return None
    values = [float(r["daily_return"]) for r in rows]
    factors = [1.0 + v for v in values]
    return {
        "min": min(values),
        "max": max(values),
        "cumulative": math.prod(factors) - 1.0 if all(f > 0.0 for f in factors) else None,
    }


# ----- the fingerprint (T-167.1.2.2.2.1-20) -----------------------------------------------

def _fingerprint(
    aggregate: ArchiveAggregate, quarters: list[dict[str, Any]], plans: list[_TargetPlan]
) -> str:
    """sha256 of a canonical JSON of what the founder reviews: the per-day archive aggregates
    as Decimal strings, the census, the classification table version, each quarter's content
    readings and each target's PLANNED date list in input order.

    NEVER a live-anchored return value: those move with the equity anchor between a
    calibrate and an apply, and the approval is of the archive and the days, not of numbers
    the live account will change. The quarter readings are content-derived only
    (``state``, ``applied_existing``, the link and the compressed size can differ between two
    runs over the same file)."""

    def _per_day(by_day: Mapping[str, Decimal]) -> dict[str, str]:
        return {day: _dec(by_day[day]) for day in sorted(by_day)}

    payload = {
        "table_version": CLASSIFICATION_TABLE_VERSION,
        "realized": _per_day(aggregate.realized_by_day),
        "funding": _per_day(aggregate.funding_by_day),
        "flows": _per_day(aggregate.flows_by_day),
        "non_external": _per_day(aggregate.non_external_by_day),
        "excluded": {
            month: {cls: _dec(total) for cls, total in sorted(by_class.items())}
            for month, by_class in sorted(aggregate.excluded_by_month.items())
        },
        "census": aggregate.census,
        "unknown_zero_effect": aggregate.unknown_zero_effect,
        "quarters": [
            {
                "year": q["year"],
                "quarter": q["quarter"],
                "has_type_column": q["has_type_column"],
                "ts_min_day": q["ts_min_day"],
                "ts_max_day": q["ts_max_day"],
                "row_count": q["row_count"],
            }
            for q in quarters
        ],
        "targets": [plan.planned_dates for plan in plans],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ----- the evaluation ----------------------------------------------------------------------

@dataclass(frozen=True)
class _Evaluation:
    fingerprint: str
    plans: list[_TargetPlan]


async def _load_provenance(supabase: Any, strategy_ids: list[str]) -> dict[str, Any]:
    """``strategy_id -> series_provenance`` for the rebuild targets (a missing row is absent)."""

    def _load() -> Any:
        return (
            supabase.table("strategy_analytics")
            .select("strategy_id,series_provenance")
            .in_("strategy_id", strategy_ids)
            .execute()
        )

    return {str(r.get("strategy_id")): r.get("series_provenance") for r in rows(await db_execute(_load))}


async def _evaluate(
    supabase: Any,
    exchange: ccxt.Exchange,
    api_key_id: str,
    inp: _JobInput,
    ingested: _Ingested,
    quarter_entries: list[dict[str, Any]],
    result: dict[str, Any],
    budget: _ClaimBudget,
) -> _Evaluation:
    """The calibrate evaluation, shared by ``calibrate`` and ``apply``. Every stop here is
    raised BEFORE any write, and apply's first RPC comes after this returns, so a reconcile
    miss (or any other evaluation stop) can never follow a committed target (D-11)."""
    aggregate = ingested.aggregate
    quarters = list(inp.quarters)

    live = await _live_reference(exchange, supabase, api_key_id, budget)
    windows = _reconcile(result, aggregate, live, quarters)

    if inp.mode == "calibrate":
        # D-03 is a calibrate check; apply refuses the key at input.
        result["d03"] = await _d03_check(supabase, inp.zero_check_strategy_ids, aggregate)
        if result["d03"]["hits"]:
            dates = [h["date"] for h in result["d03"]["hits"]]
            raise _Stop(
                "d03_zero_day_has_archive_pnl",
                f"hits={len(dates)} first={dates[0]} last={dates[-1]}",
            )

    if live.upnl_unreadable and not (
        live.balance_error
        or live.equity is None
        or abs(live.equity) <= DUST_NAV_FLOOR
    ):
        # OKX returned totalEq but a garbled upl: the anchor may embed mark-to-market the
        # roll cannot subtract. The derive only warns; a rebuild must not guess.
        raise _Stop("live_anchor_unusable", "upnl_unreadable")

    target_ids = list(inp.rebuild_strategy_ids)
    provenance = await _load_provenance(supabase, target_ids)
    for position, strategy_id in enumerate(target_ids):
        if strategy_id not in provenance:
            raise _refused(position, "no_analytics_row")
    stored_gaps = [
        _stored_ranges(provenance[sid], "unrecovered_gaps", i, archive_only=False)
        for i, sid in enumerate(target_ids)
    ]
    archive_ranges = [
        _stored_ranges(provenance[sid], "reconstructed_ranges", i, archive_only=True)
        for i, sid in enumerate(target_ids)
    ]
    # Resumability rule 2: the earliest day across every target's stored gaps AND archive
    # ranges, so a committed target narrowing its own gap does not move the rebuild window.
    candidates = [r["from"] for group in (*stored_gaps, *archive_ranges) for r in group]
    from_day = min(candidates) if candidates else min(aggregate.covered_days)

    try:
        rebuilt = rebuild_union(
            live_realized=live.realized,
            live_funding=live.funding,
            live_flows=live.flows,
            equity=live.equity,
            balance_error=live.balance_error,
            open_unrealized_usd=live.open_unrealized_usd,
            full_history=live.full_history,
            archive_realized_by_day=aggregate.realized_by_day,
            archive_funding_by_day=aggregate.funding_by_day,
            archive_flows_by_day=aggregate.flows_by_day,
            covered_days=aggregate.covered_days,
            from_day=from_day,
            live_pnl_from_day=live.first_full_day,
            live_flows_from_day=live.flow_window_first_day,
        )
    except RebuildRefused as refusal:
        raise _Stop(refusal.stop_class) from None

    plans: list[_TargetPlan] = []
    for position, strategy_id in enumerate(target_ids):
        gaps = stored_gaps[position]
        existing: set[str] = set()
        if gaps:
            span = await _read_daily_returns(
                supabase, strategy_id, min(g["from"] for g in gaps), max(g["to"] for g in gaps)
            )
            existing = {str(r["date"]) for r in span}
        plans.append(
            _plan_target(
                position, strategy_id, provenance[strategy_id], existing, rebuilt,
                aggregate.covered_days,
            )
        )

    # The information readings (never gates).
    planned_union = sorted({d for plan in plans for d in plan.planned_dates})
    active = [
        d for d in planned_union
        if aggregate.realized_by_day.get(d, Decimal(0)) != 0
        or aggregate.funding_by_day.get(d, Decimal(0)) != 0
        or aggregate.flows_by_day.get(d, Decimal(0)) != 0
    ]
    window_days = sorted({d for first, last in windows for d in _days_in(first, last)})
    archive_only = sorted(
        d for d in window_days
        if (_cent_nonzero(aggregate.realized_by_day.get(d, Decimal(0))) and d not in live.realized_by_day)
        or (_cent_nonzero(aggregate.funding_by_day.get(d, Decimal(0))) and d not in live.funding_by_day)
    )
    flow_totals, flow_seam = _flow_readings(aggregate, live, set(window_days))
    result["info"] = {
        "bal_chain": ingested.bal_chain,
        "flow_totals_overlap": flow_totals,
        "flow_seam": flow_seam,
        "realized_balance_vs_rolled_nav": _balance_vs_nav(ingested.files, live),
        "live_from": {"pnl": live.first_full_day, "flows": live.flow_window_first_day},
        "first_live_day_differs": rebuilt.first_live_day_differs,
        "archive_days_prepended": rebuilt.archive_days_prepended,
        "gap_days_active": len(active),
        "gap_days_quiet": len(planned_union) - len(active),
        "archive_only_in_live_reach": archive_only,
        "stored_vs_core": await _stored_vs_core(supabase, inp.rebuild_strategy_ids, rebuilt),
    }
    result["strategies"] = [
        {
            "position": plan.position,
            "insert_days": len(plan.rows),
            "insert_ranges": days_to_ranges(r["date"] for r in plan.rows),
            "insert_returns": _returns_summary(plan.rows),
            "apply_state": _target_state(plan),
            "gaps_before": plan.stored_gaps,
            "gaps_after": plan.expected_after,
            "rpc": None,
        }
        for plan in plans
    ]
    fingerprint = _fingerprint(aggregate, quarter_entries, plans)
    result["fingerprint"] = fingerprint
    return _Evaluation(fingerprint=fingerprint, plans=plans)


# ----- apply: the only write path (D-05, D-11, D-12) ----------------------------------------

def _is_refusal(exc: BaseException) -> bool:
    """The RPC's own refusals: 22023 (malformed input, row outside every stored gap, a missing
    ``strategy_analytics`` row) and P0001 (``gaps_changed``, ``gaps_after_mismatch``). By the
    SQLSTATE the driver surfaces, never by message."""
    return getattr(exc, "code", None) in ("22023", "P0001")


def _target_state(plan: _TargetPlan) -> str:
    """What an apply does with one target (resumability rule 3, WR-05).

    * ``insert``: there are rows to write; one RPC.
    * ``already_applied``: nothing left to write and nothing left to narrow, AND the target's
      stored archive ``reconstructed_ranges`` already cover every day this plan would have
      planned. That is the only proof this job applied the target before.
    * ``gap_delta``: nothing to write but the stored gaps would still change (a live row filled
      a gap day since the read). The RPC refuses an empty ``p_rows`` by contract, so this
      cannot be expressed through it.
    * ``nothing_to_apply``: nothing to write and nothing recorded: a wrong strategy id, a
      strategy with no stored gap, a gap wholly outside the ingested quarters, or one whose
      every day the NaN guard left out. Calling that ``already_applied`` reported a successful
      re-run that never happened."""
    if plan.rows:
        return "insert"
    if plan.expected_after != plan.stored_gaps:
        return "gap_delta"
    return "already_applied" if plan.archive_covers_planned else "nothing_to_apply"


async def _apply_targets(
    supabase: Any, job: Mapping[str, Any], plans: list[_TargetPlan], result: dict[str, Any]
) -> None:
    """Call ``apply_okx_archive_rebuild`` once per target, in input order, recording each
    answer in ``strategies[i].rpc``. Everything evaluation can decide has been decided before
    this runs, so a stop here is the RPC's own refusal (``rpc_refused``, naming the position)
    or a transport failure, which writes the per-target record and re-raises for the worker to
    retry (the re-claim resumes through ``_target_state``)."""
    strategies = result["strategies"]

    # A target the RPC cannot express (rows empty, gaps would still change: live rows filled
    # gap days since the read) and a target with nothing to apply at all are decided here,
    # before the FIRST call, and write nothing.
    for plan in plans:
        if _target_state(plan) == "gap_delta":
            raise _refused(plan.position, "empty_rows_gap_delta")
    idle = [plan.position for plan in plans if _target_state(plan) == "nothing_to_apply"]
    if idle:
        for position in idle:
            strategies[position]["rpc"] = {"status": "nothing_to_apply", "error_class": None}
        raise _Stop("nothing_to_apply", f"position={idle[0]}")

    for plan in plans:
        entry = strategies[plan.position]
        if _target_state(plan) == "already_applied":
            entry["insert_days"] = 0
            entry["insert_ranges"] = []
            entry["insert_returns"] = None
            entry["rpc"] = {"status": "already_applied", "error_class": None}
            continue

        def _rpc(p: _TargetPlan = plan) -> Any:
            return supabase.rpc(
                "apply_okx_archive_rebuild",
                {
                    "p_strategy_id": p.strategy_id,
                    "p_rows": p.rows,
                    "p_expected_gaps": p.stored_gaps,
                    "p_expected_gaps_after": p.expected_after,
                },
            ).execute()

        try:
            response = await db_execute(_rpc)
            answer = response.data
            status = answer.get("status") if isinstance(answer, Mapping) else None
            if status not in ("applied", "already_applied"):
                raise RuntimeError("apply_okx_archive_rebuild: unreadable answer")
        except asyncio.CancelledError:
            raise  # never swallow cancellation
        except Exception as exc:  # noqa: BLE001
            if _is_refusal(exc):
                logger.warning(
                    "okx_archive_rebuild: apply_okx_archive_rebuild refused position %d (%s): %s",
                    plan.position,
                    getattr(exc, "code", None),
                    scrub_freeform_string(str(exc))[:200],
                )
                entry["rpc"] = {"status": None, "error_class": "rpc_refused"}
                applied = sum(1 for s in strategies if (s["rpc"] or {}).get("status") == "applied")
                raise _Stop("rpc_refused", f"position={plan.position} applied={applied}") from None
            # Not a stop class: a timeout, a connection error or a 5xx may have arrived after
            # the commit. Record where each target stands, then let the worker's own error
            # classification retry; the re-claim resumes through rule 3.
            entry["rpc"] = {"status": None, "error_class": "rpc_transport"}
            logger.error(
                "okx_archive_rebuild: apply_okx_archive_rebuild transport failure at position %d (%s)",
                plan.position,
                type(exc).__name__,
            )
            try:
                await _write_result(supabase, job, result)
            except asyncio.CancelledError:
                raise
            except Exception as write_exc:  # noqa: BLE001
                logger.error(
                    "okx_archive_rebuild: the per-target record could not be written (%s)",
                    type(write_exc).__name__,
                )
            raise
        entry["rpc"] = {"status": status, "error_class": None}
        if status == "already_applied":
            entry["insert_days"] = 0
            entry["insert_ranges"] = []
            entry["insert_returns"] = None
        elif answer.get("inserted") != len(plan.rows):
            # D-12 at work: a live day appeared since the read and kept its row. Counts only.
            logger.warning(
                "okx_archive_rebuild: position %d inserted %s of %d planned rows",
                plan.position,
                answer.get("inserted"),
                len(plan.rows),
            )


async def _run_evaluation(
    supabase: Any,
    job: Mapping[str, Any],
    exchange: ccxt.Exchange,
    inp: _JobInput,
    ingested: _Ingested,
    quarter_entries: list[dict[str, Any]],
    result: dict[str, Any],
    budget: _ClaimBudget,
) -> None:
    """Calibrate and apply: evaluate, then (apply only) gate on the approved fingerprint and
    write. The fingerprint comparison, like every evaluation stop, precedes the first RPC."""
    evaluation = await _evaluate(
        supabase, exchange, str(job.get("api_key_id")), inp, ingested, quarter_entries, result,
        budget,
    )
    if inp.mode != "apply":
        return
    if inp.approved_fingerprint != evaluation.fingerprint:
        raise _Stop("fingerprint_mismatch")
    await _apply_targets(supabase, job, evaluation.plans, result)


# ---------------------------------------------------------------------------
# The handler
# ---------------------------------------------------------------------------

async def run_okx_archive_rebuild_job(job: dict[str, Any]) -> DispatchResult:
    """``dispatch()`` handler for kind ``okx_archive_rebuild`` (``preflight``, ``calibrate``
    and ``apply``). See the module docstring for the order, which is the D-02 guarantee, and
    for the stateless wait."""
    supabase = get_supabase()
    result = _blank_result(None)
    budget = _ClaimBudget(CLAIM_BUDGET_S)
    metadata = job.get("metadata")
    raw_mode = metadata.get("mode") if isinstance(metadata, Mapping) else None
    if isinstance(raw_mode, str) and raw_mode in MODES:
        result["mode"] = raw_mode  # only a closed-set value is ever echoed

    try:
        inp = _read_job_input(job)
        scope = await _check_keys(supabase, job, inp)
    except _Stop as stop:
        return await _finish_stop(supabase, job, result, stop)

    # A DEFERRED (the circuit breaker's) passes straight through; a FAILED returned after
    # _check_keys passed is a race with a concurrent key change and passes unchanged.
    ctx = await _allocator_key_preflight(job, "run_okx_archive_rebuild_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    try:
        exchange = cast("ccxt.Exchange", ctx.exchange)
        try:
            await _check_account(exchange, scope, result)
            live_types = await _subtypes_census(exchange, result)
            quarters = [_blank_quarter(year, label) for year, label in inp.quarters]
            result["quarters"] = quarters
            pacer = _ApplyPacer()
            steps = [await _quarter_step(exchange, ctx.key_row, q, pacer) for q in quarters]
            waits = [step.wait_s for step in steps if step.href is None]
            if waits:
                ready = len(steps) - len(waits)
                return await _defer_job(
                    supabase, job, min(waits),
                    f"{KIND}: waiting quarters_ready={ready}/{len(steps)}",
                )
            if inp.mode in ("calibrate", "apply"):
                ingested = await _ingest_all(exchange, quarters, steps, live_types, result, budget)
                await _run_evaluation(
                    supabase, job, exchange, inp, ingested, quarters, result, budget
                )
        except _Stop as stop:
            return await _finish_stop(supabase, job, result, stop)
        except (ccxt.RateLimitExceeded, ccxt.DDoSProtection) as exc:
            # A venue rate limit is a reason to wait, not to fail, and it is NEVER stamped
            # onto the key, because ``stamp_api_key_429`` opens the exchange-wide breaker and pauses
            # every normal OKX sync for a quota this job alone spent.
            logger.warning(
                "okx_archive_rebuild: venue rate limit (%s); deferring %ds",
                type(exc).__name__,
                RATE_LIMIT_DEFER_S,
            )
            try:
                return await _defer_job(
                    supabase, job, RATE_LIMIT_DEFER_S, f"{KIND}: waiting rate_limited"
                )
            except _Stop as stop:
                return await _finish_stop(supabase, job, result, stop)
        # DONE is only honest once the result is stored: a failed write propagates and the
        # dispatcher retries the whole (idempotent) claim.
        json.dumps(result)  # the object must be plain JSON: no Decimal, no datetime
        await _write_result(supabase, job, result)
        return DispatchResult(outcome=DispatchOutcome.DONE)
    finally:
        await aclose_exchange(ctx.exchange)
