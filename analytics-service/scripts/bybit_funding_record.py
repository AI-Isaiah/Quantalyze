"""How a Bybit account was funded, as counts and closed tokens (Phase 180 BYBITFUNDING, plan 01).

WHY (SC-1): the allocator history probe reads a Bybit member's trades and its on-chain transfers,
and the account a6 shows zero deposits and zero withdrawals beside 203467 trades. Money can reach a
Bybit account by routes that read does not see (internal deposits, inter-account and sub-account
transfers). This module reads those routes, read-only, and prints per source how many successful
rows the key could see, how many are older than 365 days, how old the oldest is, how many sit in
any other status, how far back the source answered, and a closed state token.

These are EVIDENCE reads (D-01), not the rebuild's flow source: they feed no gate and change
neither a member's outcome nor its forced-pass counters. The probe's output is pasted into a
tracked file in a public repo, so every value here is a count, a closed age bucket, a closed token,
a boolean or ``field-absent``: no transfer id, member id, UID, amount, timestamp or venue text.

"Not measured" is ``field-absent``, never 0: a source the key cannot read, or a window that never
answered, must not read as a source that holds nothing (D-03). A source that runs past its own bound
is the state ``Timeout`` and never a count of 0, and the next source still runs. This module imports
nothing from the probe (the probe imports this one).

CENSUS (orchestrator reading 3): Earn, staking, bonus-transfer and PEF transaction-log types are NOT
flows in this phase. The probe takes ONE aggregate count of eight such candidate types
(``CENSUS_LOG_TYPES``, RESEARCH Q2.3) from the Unified transaction log, under its own bound, as
evidence the founder reads at SC-3. It never feeds a gate and never becomes a flow.

LIMITATION (SC-1, stated and not silent), in RESEARCH Q2.2's words, on one line so a search finds it:
by D-01's own edge logic an Earn subscription is a flow out of the Unified wallet, so an account that used Earn gets a replay whose level is off by the staked amount while it is staked; the anchor offset spreads that difference, and the 5x implausibility bound is the only backstop.

READ-ONLY: every call here is a raw GET through the existing client. Seven raw methods are named: the
five asset record and transfer-list reads, the key-info read and the Unified transaction log. A test
pins that set on this file's own text, so a venue write cannot be added without that test going red.
"""
from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure
from services.exchange_pagination import (
    PageRequest,
    PageResult,
    PaginationCeilingExceeded,
    ProviderPaginationContract,
    walk_paginated,
)

_MS_PER_DAY = 86_400_000

#: The age of a stamp at the run date, in whole days. A COPY of the probe's ``_WINDOW_AGE_BUCKETS``
#: on purpose, because the probe imports this module; a test pins the two equal.
AGE_BUCKETS: tuple[str, ...] = (
    "none",
    "0-29",
    "30-89",
    "90-179",
    "180-364",
    "365-546",
    "547-729",
    "730+",
)

#: What a source's state may read. ``not-run`` is the default (the evidence was not taken),
#: ``read`` a source that answered every window it was asked, ``not-master`` a master-only source
#: that a sub key never called, ``malformed`` an answer of the wrong shape, ``ceiling`` a walk that
#: hit the page cap, and the rest the probe's own failure classes.
SOURCE_STATES: tuple[str, ...] = (
    "not-run",
    "read",
    "not-master",
    "malformed",
    "ceiling",
    *(name for name in FAILURE_CLASSES if name != "none"),
)


class EvidenceShapeError(RuntimeError):
    """A venue answer of a shape this module does not accept. Static text only, never venue text."""


class EvidenceCeilingExceeded(PaginationCeilingExceeded):
    """A source's walk hit its page cap with more rows remaining."""


@dataclass(frozen=True)
class EvidenceSource:
    """One Bybit v5 GET read as evidence (Bybit docs, read 2026-10-28)."""

    name: str
    method: str  # the raw ccxt method
    window_days: int  # the longest span one request may cover, in whole days
    rows_key: str  # the key under ``result`` that holds the rows
    id_field: str
    time_field: str
    success_statuses: frozenset[str]
    master_only: bool
    extra_params: tuple[tuple[str, str], ...]


#: The five sources, in the order Bybit's docs list them. The record endpoints (on-chain deposits,
#: internal deposits, withdrawals) refuse a span that is not LESS than 30 days, so 29; the two
#: transfer lists take 7. An on-chain deposit is a success at ``3``, at ``10012`` (credited to the
#: funding pool) and at ``70012`` (still successful after rollback review); an internal deposit at
#: ``2``. The withdrawal record answers a master UID's key only, and ``withdrawType`` 2 is "all".
EVIDENCE_SOURCES: tuple[EvidenceSource, ...] = (
    EvidenceSource(
        name="onchain_dep",
        method="private_get_v5_asset_deposit_query_record",
        window_days=29,
        rows_key="rows",
        id_field="id",
        time_field="successAt",
        success_statuses=frozenset({"3", "10012", "70012"}),
        master_only=False,
        extra_params=(),
    ),
    EvidenceSource(
        name="internal_dep",
        method="private_get_v5_asset_deposit_query_internal_record",
        window_days=29,
        rows_key="rows",
        id_field="id",
        time_field="createdTime",
        success_statuses=frozenset({"2"}),
        master_only=False,
        extra_params=(),
    ),
    EvidenceSource(
        name="withdraw_all",
        method="private_get_v5_asset_withdraw_query_record",
        window_days=29,
        rows_key="rows",
        id_field="withdrawId",
        time_field="createTime",
        success_statuses=frozenset({"success", "BlockchainConfirmed"}),
        master_only=True,
        extra_params=(("withdrawType", "2"),),
    ),
    EvidenceSource(
        name="inter_xfer",
        method="private_get_v5_asset_transfer_query_inter_transfer_list",
        window_days=7,
        rows_key="list",
        id_field="transferId",
        time_field="timestamp",
        success_statuses=frozenset({"SUCCESS"}),
        master_only=False,
        extra_params=(),
    ),
    EvidenceSource(
        name="universal_xfer",
        method="private_get_v5_asset_transfer_query_universal_transfer_list",
        window_days=7,
        rows_key="list",
        id_field="transferId",
        time_field="timestamp",
        success_statuses=frozenset({"SUCCESS"}),
        master_only=False,
        extra_params=(),
    ),
)

#: The sources whose rows can bring money INTO the account (plan 03's funding explanation reads
#: this); ``withdraw_all`` cannot.
INFLOW_SOURCE_NAMES: tuple[str, ...] = ("onchain_dep", "internal_dep", "inter_xfer", "universal_xfer")

SOURCE_FIELD_SUFFIXES: tuple[str, ...] = (
    "rows",
    "older_365d",
    "oldest_age_bucket",
    "other_status_rows",
    "depth_bucket",
    "state",
)

#: The key's own flags come first: whether it is a master key (a sub key cannot read the withdrawal
#: record) and whether the account is a UTA. Booleans read strictly, never an id.
KEY_INFO_KEYS: tuple[str, ...] = ("bybit_key_info_state", "bybit_is_master", "bybit_is_uta")

KEY_INFO_STATES: tuple[str, ...] = (
    "not-run",
    "read",
    "malformed",
    *(name for name in FAILURE_CLASSES if name != "none"),
)

#: The transaction-log types the census counts: transfer-like types that cross the Unified edge but
#: are NOT flows in this phase (RESEARCH Q2.3). The census is evidence for SC-3, never a flow and
#: never a gate input. ``type`` is one value per request, so each type is its own walk.
CENSUS_LOG_TYPES: tuple[str, ...] = (
    "ONCHAINEARN_SUBSCRIPTION",
    "ONCHAINEARN_REDEMPTION",
    "FLEXIBLE_STAKING_SUBSCRIPTION",
    "FLEXIBLE_STAKING_REDEMPTION",
    "BONUS_TRANSFER_IN",
    "BONUS_TRANSFER_OUT",
    "PEF_TRANSFER_IN",
    "PEF_TRANSFER_OUT",
)

#: The census's two keys come LAST, after every source's.
CENSUS_KEYS: tuple[str, ...] = ("bybit_other_transfer_like_rows", "bybit_other_transfer_like_state")

#: A census state is a source state without ``not-master``: the log is not master-only.
CENSUS_STATES: tuple[str, ...] = tuple(state for state in SOURCE_STATES if state != "not-master")

FUNDING_KEYS: tuple[str, ...] = (
    KEY_INFO_KEYS
    + tuple(f"bybit_{source.name}_{suffix}" for source in EVIDENCE_SOURCES for suffix in SOURCE_FIELD_SUFFIXES)
    + CENSUS_KEYS
)


def _is_bool_or_absent(x: Any) -> bool:
    return isinstance(x, bool) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_count_or_absent(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


def _is_one_of_or_absent(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and (x in allowed or x == FIELD_ABSENT)


def _validator_for(suffix: str) -> Callable[[Any], bool]:
    if suffix == "state":
        return _is_one_of(SOURCE_STATES)
    if suffix in ("oldest_age_bucket", "depth_bucket"):
        return _is_one_of_or_absent(AGE_BUCKETS)
    return _is_count_or_absent


FUNDING_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "bybit_key_info_state": _is_one_of(KEY_INFO_STATES),
    "bybit_is_master": _is_bool_or_absent,
    "bybit_is_uta": _is_bool_or_absent,
    **{
        f"bybit_{source.name}_{suffix}": _validator_for(suffix)
        for source in EVIDENCE_SOURCES
        for suffix in SOURCE_FIELD_SUFFIXES
    },
    "bybit_other_transfer_like_rows": _is_count_or_absent,
    "bybit_other_transfer_like_state": _is_one_of(CENSUS_STATES),
}


def funding_defaults() -> dict[str, Any]:
    """Every funding key at its "not measured" value: field-absent, every state ``not-run``."""
    out: dict[str, Any] = {key: FIELD_ABSENT for key in FUNDING_KEYS}
    out["bybit_key_info_state"] = "not-run"
    for source in EVIDENCE_SOURCES:
        out[f"bybit_{source.name}_state"] = "not-run"
    out["bybit_other_transfer_like_state"] = "not-run"
    return out


#: Bybit's page size for these endpoints, and the most pages one window may take before the walk
#: stops itself as a ``ceiling``.
EVIDENCE_PAGE_SIZE = 50
EVIDENCE_PAGE_CAP = 200

#: One source's own deadline (seconds). A module constant so a test can lower it: a source still
#: running at it is recorded as ``Timeout`` and the next source still runs.
EVIDENCE_SOURCE_TIMEOUT_S: float = 420.0

#: The census's own deadline (seconds). It is 8 types times about 105 windows, about 840 calls and
#: about 6 minutes on a normal day (RESEARCH Q7), so a source's 420 s would cut it on a slow one.
CENSUS_TIMEOUT_S: float = 600.0


def _now_ms() -> int:
    """The clock behind the first window's end; a seam so a test can set it."""
    return int(time.time() * 1000)


def _day_ms(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


def age_bucket(stamp_ms: int | None, run_day: date) -> str:
    """The closed age bucket of a stamp: whole days from ``stamp_ms`` to the run day's UTC
    midnight. ``None`` (no stamp known) is "none". The same edges as the probe's
    ``window_age_bucket``."""
    if stamp_ms is None:
        return "none"
    days = max(0, (_day_ms(run_day) - stamp_ms) // _MS_PER_DAY)
    for upper, token in ((30, "0-29"), (90, "30-89"), (180, "90-179"), (365, "180-364")):
        if days < upper:
            return token
    if days < 547:
        return "365-546"
    return "547-729" if days < 730 else "730+"


def _windows_newest_first(since_ms: int, now_ms: int, window_days: int) -> list[tuple[int, int]]:
    """``[since_ms, now_ms]`` as windows of ``window_days`` days, newest first. The windows tile the
    range: the next one ends one millisecond before the previous one starts."""
    span = window_days * _MS_PER_DAY
    out: list[tuple[int, int]] = []
    end = now_ms
    while end > since_ms:
        start = max(since_ms, end - span)
        out.append((start, end))
        end = start - 1
    return out


@dataclass
class _SourceSink:
    """What one source's walk has read so far. Rows are appended AS THEY ARRIVE, so a bound that
    fires keeps what was read; ``deepest_start`` is the start of the oldest window that was
    answered in full (None until one was)."""

    rows: list[Mapping[str, Any]] = field(default_factory=list)
    deepest_start: int | None = None


def _page_of(answer: Any, rows_key: str) -> tuple[list[Mapping[str, Any]], str]:
    """One page's rows and next cursor, or ``EvidenceShapeError`` for an answer of the wrong shape.
    Nothing is returned for a page with a row that is not an object, so a refused page counts no row."""
    if not isinstance(answer, dict):
        raise EvidenceShapeError("evidence answer is not an object")
    result = answer.get("result")
    if not isinstance(result, dict):
        raise EvidenceShapeError("evidence result is not an object")
    items = result.get(rows_key)
    if not isinstance(items, list):
        raise EvidenceShapeError("evidence rows are not a list")
    for item in items:
        if not isinstance(item, dict):
            raise EvidenceShapeError("evidence row is not an object")
    cursor = result.get("nextPageCursor")
    if cursor is not None and not isinstance(cursor, str):
        raise EvidenceShapeError("evidence cursor is not a string")
    return items, cursor or ""


async def _read_source(
    client: Any, source: EvidenceSource, since_ms: int, now_ms: int, sink: _SourceSink
) -> None:
    """Read ``source`` newest window first into ``sink``. Stops at the first failure: the windows
    already read keep their rows, and ``deepest_start`` says how far back it answered. The
    driver owns the cursor loop and the ceiling."""
    contract = ProviderPaginationContract(
        fetcher=f"bybit_funding_record.{source.name}",
        page_cap=EVIDENCE_PAGE_CAP,
        on_ceiling="raise",
        # Every Bybit walk is cursor-authoritative: a short page with a live cursor has more rows.
        stop_on_short_page=False,
        # A repeated cursor exhausts to the ceiling and raises: it is never a quiet stop.
        stuck_cursor_is_stop=False,
        inst_types=(),
        window_max_days=source.window_days,
        ceiling_exc=EvidenceCeilingExceeded,
    )

    async def _fetch_page(req: PageRequest) -> PageResult[Any]:
        params: dict[str, str] = {
            "limit": str(EVIDENCE_PAGE_SIZE),
            "startTime": str(req.window_start),
            "endTime": str(req.window_end),
            **dict(source.extra_params),
        }
        if req.cursor:
            params["cursor"] = req.cursor
        items, cursor = _page_of(await getattr(client, source.method)(params), source.rows_key)
        sink.rows.extend(items)
        return PageResult(rows=[], next_cursor=cursor, is_empty=not items)

    for window_start, window_end in _windows_newest_first(since_ms, now_ms, source.window_days):
        await walk_paginated(contract, since_ms=window_start, now_ms=window_end, fetch_page=_fetch_page)
        sink.deepest_start = window_start


async def _read_census(client: Any, since_ms: int, now_ms: int, sink: _SourceSink) -> None:
    """Read the census types from the Unified transaction log into ``sink``, newest 7-day window
    first, one ``walk_paginated`` call per window over every census type (``type`` is one value per
    request). Stops at the first failure, like ``_read_source``. A row whose ``type`` is not the one
    requested is a malformed answer: the log did not honour the filter, and the row is not counted."""
    contract = ProviderPaginationContract(
        fetcher="bybit_funding_record.census",
        page_cap=EVIDENCE_PAGE_CAP,
        on_ceiling="raise",
        stop_on_short_page=False,
        stuck_cursor_is_stop=False,
        inst_types=CENSUS_LOG_TYPES,
        window_max_days=7,
        ceiling_exc=EvidenceCeilingExceeded,
    )

    async def _fetch_page(req: PageRequest) -> PageResult[Any]:
        params: dict[str, str] = {
            "accountType": "UNIFIED",
            "type": str(req.inst_type),
            "limit": str(EVIDENCE_PAGE_SIZE),
            "startTime": str(req.window_start),
            "endTime": str(req.window_end),
        }
        if req.cursor:
            params["cursor"] = req.cursor
        items, cursor = _page_of(await client.private_get_v5_account_transaction_log(params), "list")
        if any(item.get("type") != req.inst_type for item in items):
            raise EvidenceShapeError("census row is not of the requested type")
        sink.rows.extend(items)
        return PageResult(rows=[], next_cursor=cursor, is_empty=not items)

    for window_start, window_end in _windows_newest_first(since_ms, now_ms, 7):
        await walk_paginated(contract, since_ms=window_start, now_ms=window_end, fetch_page=_fetch_page)
        sink.deepest_start = window_start


def _census_values(sink: _SourceSink, state: str) -> dict[str, Any]:
    """The census's two values. The count is field-absent until a window was answered; once one
    was, it counts distinct ids (an id-less row once each), and when the state is not ``read`` it is
    a lower bound over the windows that answered."""
    rows: Any = FIELD_ABSENT
    if sink.deepest_start is not None:
        ids = {str(row["id"]) for row in sink.rows if row.get("id") is not None}
        rows = len(ids) + sum(1 for row in sink.rows if row.get("id") is None)
    return {"bybit_other_transfer_like_rows": rows, "bybit_other_transfer_like_state": state}


_DIGITS_RE = re.compile(r"[0-9]+")


def _stamp_of(row: Mapping[str, Any], time_field: str) -> int:
    """A success row's stamp (ms). An int, or a string of digits; anything else is a malformed
    answer, and a stamp is never invented."""
    raw = row.get(time_field)
    if isinstance(raw, bool):
        raise EvidenceShapeError("evidence stamp is not a number")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and _DIGITS_RE.fullmatch(raw):
        return int(raw)
    raise EvidenceShapeError("evidence stamp is not a number")


def _source_values(source: EvidenceSource, sink: _SourceSink, state: str, run_day: date) -> dict[str, Any]:
    """One source's record values. Counts and buckets are field-absent unless a window answered:
    a source that never answered must not read as one that holds nothing."""
    values: dict[str, Any] = {
        f"bybit_{source.name}_{suffix}": FIELD_ABSENT for suffix in SOURCE_FIELD_SUFFIXES
    }
    values[f"bybit_{source.name}_state"] = state
    if sink.deepest_start is None:
        return values
    # A success row counts once per id however many windows returned it; an id-less row counts each time.
    success: dict[str, int] = {}
    success_no_id: list[int] = []
    other: set[str] = set()
    other_no_id = 0
    for row in sink.rows:
        raw_id = row.get(source.id_field)
        row_id = None if raw_id is None else str(raw_id)
        if str(row.get("status")) in source.success_statuses:
            stamp = _stamp_of(row, source.time_field)
            if row_id is None:
                success_no_id.append(stamp)
            else:
                success.setdefault(row_id, stamp)
        elif row_id is None:
            other_no_id += 1
        else:
            other.add(row_id)
    stamps = [*success.values(), *success_no_id]
    cutoff = _day_ms(run_day - timedelta(days=365))
    name = source.name
    values[f"bybit_{name}_rows"] = len(stamps)
    values[f"bybit_{name}_older_365d"] = sum(1 for stamp in stamps if stamp < cutoff)
    values[f"bybit_{name}_oldest_age_bucket"] = age_bucket(min(stamps) if stamps else None, run_day)
    values[f"bybit_{name}_other_status_rows"] = len(other) + other_no_id
    values[f"bybit_{name}_depth_bucket"] = age_bucket(sink.deepest_start, run_day)
    return values


def _state_of(exc: BaseException) -> str:
    """The record's state for a source that failed. Never reads a message: a ccxt message can
    carry a signed URL, an amount or an id."""
    if isinstance(exc, EvidenceShapeError):
        return "malformed"
    if isinstance(exc, EvidenceCeilingExceeded):
        return "ceiling"
    return classify_failure(exc)


async def read_key_info(client: Any) -> dict[str, Any]:
    """The key's master/sub and UTA flags from ``/v5/user/query-api``, as booleans.

    ``isMaster`` is a boolean only when the answer says ``true`` or ``false``; ``uta`` is 1 (a UTA)
    or 0 (a regular account) as a number that is not a boolean. Anything else (a string, a missing
    field) is field-absent, so a flag is never guessed. Nothing else from the answer is kept: the
    answer carries the key's own UID and its parent's, and neither is printed. Never raises an
    ``Exception``."""
    out: dict[str, Any] = {
        "bybit_key_info_state": "not-run",
        "bybit_is_master": FIELD_ABSENT,
        "bybit_is_uta": FIELD_ABSENT,
    }
    try:
        answer = await asyncio.wait_for(client.private_get_v5_user_query_api(), EVIDENCE_SOURCE_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        return {**out, "bybit_key_info_state": classify_failure(exc)}
    result = answer.get("result") if isinstance(answer, dict) else None
    if not isinstance(result, dict):
        return {**out, "bybit_key_info_state": "malformed"}
    master = result.get("isMaster")
    uta = result.get("uta")
    return {
        "bybit_key_info_state": "read",
        "bybit_is_master": master if isinstance(master, bool) else FIELD_ABSENT,
        "bybit_is_uta": (
            uta == 1 if isinstance(uta, int) and not isinstance(uta, bool) and uta in (0, 1) else FIELD_ABSENT
        ),
    }


async def measure_funding(client: Any, since_ms: int, run_day: date) -> dict[str, Any]:
    """Read the key's flags and every evidence source, read-only, and return only ``FUNDING_KEYS``.

    A master-only source is not called when the key is exactly NOT a master key: it prints
    ``not-master`` with field-absent counts. When the flag is True or field-absent it is called,
    and a refusal is its state. Each source runs under its own ``EVIDENCE_SOURCE_TIMEOUT_S``: one that fails, or runs out of
    time, is recorded by its state and the next source still runs. Never raises an ``Exception``
    (a cancellation still propagates) and never reads an exception message.
    """
    out = {**funding_defaults(), **await read_key_info(client)}
    now_ms = _now_ms()
    for source in EVIDENCE_SOURCES:
        if source.master_only and out["bybit_is_master"] is False:
            out = {**out, f"bybit_{source.name}_state": "not-master"}
            continue
        sink = _SourceSink()
        try:
            await asyncio.wait_for(
                _read_source(client, source, since_ms, now_ms, sink), EVIDENCE_SOURCE_TIMEOUT_S
            )
            state = "read"
        except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
            state = _state_of(exc)
        try:
            values = _source_values(source, sink, state, run_day)
        except EvidenceShapeError:
            # A success row whose stamp cannot be read makes every count of this source untrustworthy.
            values = _source_values(source, _SourceSink(), "malformed", run_day)
        out = {**out, **values}
    census = _SourceSink()
    try:
        await asyncio.wait_for(_read_census(client, since_ms, now_ms, census), CENSUS_TIMEOUT_S)
        census_state = "read"
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        census_state = _state_of(exc)
    return {**out, **_census_values(census, census_state)}
