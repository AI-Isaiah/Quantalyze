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
the download-and-parse ingest ``calibrate`` ends with; plan 08 adds the reconciliation, the
rebuild, the D-03 check, the fingerprint and ``apply`` mode to this same module.

**The wait is stateless (SC-1).** Every claim re-applies each requested quarter (OKX's apply
is idempotent), re-reads the request state, and then does exactly one of: defer
(``defer_compute_job``, attempts untouched, at most one hour, claim-token fenced), re-apply
once, ingest, or give up. The give-up bound comes from OKX's own request ``ts`` (8 h), never
from a counter. Nothing about a download link or a ``ts`` is stored between claims: not in
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
import json
import logging
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Final, Mapping, cast

import ccxt.async_support as ccxt

from services.account_identity import venue_account_id_from
from services.db import db_execute, get_supabase, one, rows
from services.encryption import decrypt_credentials, get_kek
from services.exchange import _okx_bills_fetch_with_backoff, aclose_exchange
from services.job_worker import (
    DispatchOutcome,
    DispatchResult,
    _allocator_key_preflight,
    _defer_lost_ownership,
    _make_exchange_client,
)
from services.okx_archive_classify import SUBTYPE_BUCKETS, Bucket, aggregate_archive
from services.okx_archive_download import describe_href, download_archive_csv
from services.okx_archive_files import (
    ArchiveFile,
    ArchiveParseError,
    parse_archive_csv,
    quarter_bounds,
)
from services.redact import scrub_freeform_string

logger = logging.getLogger(__name__)

KIND: Final[str] = "okx_archive_rebuild"
RESULT_VERSION: Final[int] = 1

# Closed set of stop classes (job contract). ``link_expired`` is transient; every other
# class is permanent. A stop writes the result block first, then returns FAILED.
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
        "header_drift",
        "quarter_range_mismatch",
        "duplicate_bill_conflict",
        "unparseable_amount",
        "unknown_subtype_nonzero",
        "non_usd_ccy",
        "live_anchor_unusable",
        "identity_violation",
        "reconcile_miss",
        "d03_zero_day_has_archive_pnl",
        "fingerprint_missing",
        "fingerprint_mismatch",
        "rpc_refused",
    }
)
TRANSIENT_STOP_CLASSES: Final[frozenset[str]] = frozenset({"link_expired"})

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
#: A venue rate limit on an archive call defers at least this long (15 minutes), and never
#: stamps the key's 429 (that opens the exchange-wide breaker and pauses normal OKX syncs).
RATE_LIMIT_DEFER_S: Final[int] = 15 * 60

# Seams for tests (a fake clock and a recorded sleep); production uses the real ones.
_monotonic = time.monotonic
_sleep = asyncio.sleep


def _wall_ms() -> int:
    """Wall clock in epoch milliseconds, the scale of OKX's request ``ts``."""
    return int(time.time() * 1000)


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


MODES: Final[tuple[str, ...]] = ("preflight", "calibrate", "apply")
#: Modes accepted so far. Plan 16 added ``calibrate`` (ends after ingest); plan 08 adds ``apply``.
ACCEPTED_MODES: Final[tuple[str, ...]] = ("preflight", "calibrate")
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

    if mode == "calibrate":
        # Contract per-mode rules: the strategies to rebuild are required (a calibration of
        # nothing proves nothing), and the fingerprint belongs to ``apply`` only.
        if not rebuild:
            raise _invalid("rebuild_strategy_ids_required")
        if fingerprint is not None:
            raise _invalid("approved_fingerprint_not_for_mode")

    targets = tuple(dict.fromkeys([*rebuild, *zero_check]))
    return _JobInput(mode=mode, quarters=tuple(quarters), target_strategy_ids=targets)


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
    recognisable entry. The exact response shape is unmeasured until the first real call
    (RESEARCH Section 3 quotes only an example), so both nestings are accepted: a ``type``
    entry carrying a list of ``{subType: ...}`` objects (under ``subTypes`` or ``subType``)
    or a flat ``{type, subType}`` entry."""
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
            (item[k] for k in ("subTypes", "subType") if isinstance(item.get(k), list)), None
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

async def _defer_job(
    supabase: Any, job: Mapping[str, Any], seconds: float, reason: str
) -> DispatchResult:
    """Park the job: ``defer_compute_job`` returns it to ``pending`` at ``now + seconds``,
    decrements ``attempts`` (waiting never burns a retry) and is fenced on the claim token.

    The SQL raises above 3600 s, so the wait is clamped here; ``reason`` becomes
    ``last_error`` and must hold a short class and counts only (no ``ts``, no link)."""
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


async def _ingest_quarter(entry: dict[str, Any], href: str) -> ArchiveFile:
    """Download one quarter's file, record the Result shape v1 readings and parse it.

    The parsed file lives in the caller's local variables for this claim only."""
    year, label = entry["year"], entry["quarter"]
    tag = _quarter_tag(year, label)
    csv_bytes, container, compressed_bytes = await download_archive_csv(href)
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
    return parsed


async def _census_of(
    files: list[ArchiveFile], live_types: Mapping[str, str]
) -> dict[str, Any]:
    """Classify every bill of the verified files and return the Result shape v1 ``census``:
    counts only, never an amount."""
    try:
        aggregate = await asyncio.to_thread(aggregate_archive, files, live_types)
    except ArchiveParseError as exc:
        raise _parse_stop(exc) from None
    census = aggregate.census
    return {
        "by_ccy": _safe_counts(census["by_ccy"]),
        "by_inst_type": _safe_counts(census["by_inst_type"]),
        "by_sub_type": _safe_counts(census["by_sub_type"]),
        "unknown_zero_effect": aggregate.unknown_zero_effect,
    }


async def _ingest_all(
    quarters: list[dict[str, Any]],
    steps: list[_QuarterStep],
    live_types: Mapping[str, str],
    result: dict[str, Any],
) -> None:
    files: list[ArchiveFile] = []
    for entry, step in zip(quarters, steps):
        assert step.href is not None  # every quarter was ready, or the job deferred
        files.append(await _ingest_quarter(entry, step.href))
    result["census"] = await _census_of(files, live_types)


# ---------------------------------------------------------------------------
# The handler
# ---------------------------------------------------------------------------

async def run_okx_archive_rebuild_job(job: dict[str, Any]) -> DispatchResult:
    """``dispatch()`` handler for kind ``okx_archive_rebuild`` (``preflight`` and
    ``calibrate``). See the module docstring for the order, which is the D-02 guarantee,
    and for the stateless wait."""
    supabase = get_supabase()
    result = _blank_result(None)
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
            if inp.mode == "calibrate":
                await _ingest_all(quarters, steps, live_types, result)
        except _Stop as stop:
            return await _finish_stop(supabase, job, result, stop)
        except (ccxt.RateLimitExceeded, ccxt.DDoSProtection) as exc:
            # A venue rate limit is a reason to wait, not to fail, and it is NEVER stamped
            # onto the key: ``stamp_api_key_429`` opens the exchange-wide breaker and pauses
            # every normal OKX sync for a quota this job alone spent.
            logger.warning(
                "okx_archive_rebuild: venue rate limit (%s); deferring %ds",
                type(exc).__name__,
                RATE_LIMIT_DEFER_S,
            )
            return await _defer_job(
                supabase, job, RATE_LIMIT_DEFER_S, f"{KIND}: waiting rate_limited"
            )
        # DONE is only honest once the result is stored: a failed write propagates and the
        # dispatcher retries the whole (idempotent) claim.
        json.dumps(result)  # the object must be plain JSON: no Decimal, no datetime
        await _write_result(supabase, job, result)
        return DispatchResult(outcome=DispatchOutcome.DONE)
    finally:
        await aclose_exchange(ctx.exchange)
