"""OKX archive fills job: the read path (Phase 259 OKXARCHIVEFILLS, plan 05).

OKX's ``fills-history`` reaches back about three months, so a strategy whose track record starts
earlier has no stored fills for its oldest quarters. Those fills are recoverable only from OKX's
quarterly bills archive. This module is the handler for two modes of the ``okx_archive_rebuild``
job kind (CONTEXT, Addendum "Mode, not kind"): there is no migration and no new kind, and the
rebuild modes' contract (``MODES``, ``STOP_CLASSES``, Result shape v1, ``_read_job_input``) is
untouched. ``okx_archive_job.run_okx_archive_rebuild_job`` forks to
``run_okx_archive_fills_job`` as its first statements, with a lazy import (this module imports that
one).

**Modes.** ``fills_calibrate`` is everything except the write: a dry run that exercises every gate
and ends DONE with a result block and ZERO ``trades`` writes (the archive apply is budgeted at a
dozen a day per OKX user, so the first look at the real trade cells must be cheap). ``fills_apply``
runs the same read path and then, only when every gate has passed for every target, writes the
fills (``_write_fills``) and ends ``info.outcome`` ``applied``.

**The wait (GET first, a persisted apply count).** A quarter's request state is READ first, and an
archive request is made only when OKX has NO entry for the quarter (once per quarter per job) or the
state is ``failed`` (at most ``FILLS_MAX_APPLIES_PER_QUARTER`` applies per quarter per job in
total). ``ongoing`` never applies, and ``finished`` applies only when its link is dead: the
download's one fresh read gave no live link, so OKX must generate the file again (``_read_and_gate``,
a counted apply within the same per-quarter cap; a network failure is not a dead link). The count
lives in the job's own result block (``quarters[*].applies``), is read back from the next claim's
``metadata.member_progress`` and is seeded into every quarter entry before any stop or defer can
write the block. It is STORED BEFORE each apply POST (``_counted_apply``): if it cannot be stored no
POST is made and the claim ends with the transient ``fills_count_not_persisted``, so a GET that keeps
answering "no entry" after an apply can never become an apply loop and a timeout on the POST cannot
lose the count. A venue rate limit on the POST is a refusal (no request exists), so it gives the
count back; a count that cannot be read is SPENT. A waiting job is DEFERRED (``defer_compute_job``, attempts untouched, the 24 h backstop) and
never sleeps out OKX's generation time: the only sleep in a claim is the apply pacing. A venue rate
limit defers ``RATE_LIMIT_DEFER_S`` and never stamps the key.

**Input** (``compute_jobs.metadata``, read only, unknown keys ignored because the platform adds its
own): ``mode`` (``fills_calibrate`` | ``fills_apply``); optional ``quarters`` (1-4 entries
``{"year": int, "quarter": "Q1".."Q4"}``, each an ended quarter from 2021) and optional
``fill_strategy_ids`` (a subset of the derived targets). Targets and quarters are DERIVED in-claim,
never carried in metadata: the enqueue dedupe drops new metadata, and a derived plan cannot go stale.

**Targets.** The non-archived strategies on CONNECTED OKX keys that share the job key's non-blank
``venue_account_id``, ordered by strategy id (the index is the result ``position``; the result names
no strategy id). A disconnected sibling is filtered out and counted. A blank stored
``venue_account_id`` on the job key is ``account_mismatch`` before any credential is decrypted.

**Quarters.** A pure function of each target's anchor (its earliest ``csv_daily_returns`` date), the
write bound (one day above ``_okx_fills_begin_floor_ms(now)``, ``WRITE_BOUND_MARGIN_MS`` imported
from ``okx_archive_fills_chain`` where it is defined once), the floor and today: the ended quarters
from 2021 Q1 whose UTC+8 cut range meets [anchor, write bound), plus the ended quarter that contains
the write bound (the reconcile quarter). Quarters before 2021 do not exist and the current quarter is
outside the archive. Every span not read is named in ``info.unread_spans`` with a reason
(``over_cap``, ``not_requested``, ``pre_archive``, ``unreachable``, and per target
``before_anchor``), never hidden.

**Known gap ``259-ARCHIVE-QUARTER-CAP``.** One job reads at most ``MAX_FILLS_QUARTERS`` (4) quarters,
the newest kept, because the archive apply is budgeted at 12 a day per OKX user and one claim's
budget is bounded. The derived quarters it leaves out are listed by tag in
``info.over_cap_quarters`` (for example ``2025-Q1``), in a form an operator copies into a manual
job's ``quarters`` override, at most 4 per job. The automatic chain never walks back through them:
after each cooldown it re-reads the same newest four, idempotently. A quarter whose file OKX still
serves with a live link costs no apply; a quarter whose link has died (links live about 5.5 h and the
chain usually arrives later) costs one counted apply to have the file generated again.
Quarter-walking is not built here.

**Order is the D-02 guarantee.** (1) validate the input; (2) ``_check_keys`` on the job key, pure
database; (3) the targets; (4) ``_check_keys`` on the targets; (5) anchors and the quarter plan, and
the exit when there is nothing to read (no key is decrypted for it); (6)
``_allocator_key_preflight`` (decrypts and builds the exchange client); (7) ``account/config``
against every stored uid; (8) one GET status read per quarter; (9) download through
``okx_archive_job._ingest_quarter`` only; (10) the census; (11) the bal chain over the files;
(12) the mapping; (13) every target's reconcile and legacy reading; (14) ONE result write.

**All or nothing per read.** Any file, mapping or reconcile stop writes nothing for any target and
names the quarter, position and span. Every target's reconcile runs before anything else happens and
a miss on any target stops the whole read with ``fills_reconcile_miss`` naming the position and the
field. An operator can exclude a bad quarter or target with ``quarters`` / ``fill_strategy_ids`` on a
manual job.

**Counted spans.** The legacy reading and ``already_stored`` / ``would_insert`` count only stored
rows whose instant lies inside a quarter this job read: a stored row in a span the job did not read
(over the cap, not requested, or the current quarter) cannot be compared and is never reported as
absent from the archive. Archive fills of a target that lie in a read quarter but before that
target's anchor are counted (``before_anchor``), named as a span and never written. In
``fills_calibrate`` a non-zero legacy ``unequal``, ``absent_in_archive`` or ``unreadable`` is
reported and the job still ends DONE: it is the reading the runbook's go/no-go reads.

**Result** (Result shape v1 keys, none added or removed): ``mode``; ``stop_class``; ``account``;
``quarters`` (one entry per read quarter, with ``role`` and ``applies`` beside the rebuild's keys);
``census`` (the archive's trade-bill counts); ``reconcile`` (``ts_column`` and one reading per
target); ``info`` (``outcome``, ``floor_day``, ``write_bound_day``, ``unread_spans``,
``over_cap_quarters``, ``targets_skipped_disconnected``, ``bal_chain``); ``strategies`` (one entry per
target). Days, counts, quarter tags and positions only.

**Nothing sensitive is kept.** No download link, request ``ts``, amount, uid or tradeId is ever
logged, put in ``last_error``, or stored outside the result's counts. A stop's detail is built from
counts, UTC days and closed field names only. The link is fetched only through ``_ingest_quarter``
(the one SSRF-safe downloader) and lives in this claim's memory.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Final, cast

import ccxt.async_support as ccxt

from services import okx_archive_job as _archive_job
from services.db import db_execute, one, rows
from services.exchange import (
    _okx_bills_fetch_with_backoff,
    _okx_fills_begin_floor_ms,
    aclose_exchange,
)
from services.job_worker import DispatchOutcome, DispatchResult, _allocator_key_preflight
from services.okx_archive_classify import MIN_CHAINED_PAIRS, verify_bal_chain
from services.okx_archive_files import (
    _QUARTER_CUT_UTC_OFFSET_MS,
    ArchiveFile,
    ArchiveParseError,
    quarter_bounds,
)
from services.okx_archive_fills_chain import WRITE_BOUND_MARGIN_MS
from services.okx_archive_fills_map import (
    ARCHIVE_TS_COLUMN,
    MAP_STOP_CLASSES,
    FillsMapError,
    MappedFill,
    archive_census,
    legacy_subset,
    map_trade_bills,
    reconcile_window,
)
from services.okx_archive_job import (
    _ARCHIVE_STATES,
    _KEY_COLUMNS,
    _STATUS_ENDPOINT_METHOD,
    CLAIM_BUDGET_S,
    FIRST_STATUS_READ_AFTER_S,
    GIVE_UP_AFTER_S,
    KIND,
    RATE_LIMIT_DEFER_S,
    STATUS_POLL_INTERVAL_S,
    TRANSIENT_STOP_CLASSES,
    _age_s,
    _ApplyAnswer,
    _ApplyPacer,
    _bal_chain_info,
    _blank_quarter,
    _blank_result,
    _check_account,
    _check_backstop,
    _check_keys,
    _ClaimBudget,
    _defer_job,
    _error_text,
    _ingest_quarter,
    _invalid,
    _iso_day,
    _JobInput,
    _key_is_connected,
    _KeyScope,
    _parse_stop,
    _parse_ts_ms,
    _quarter_tag,
    _QuarterStep,
    _record_ready,
    _safe_bal_chain,
    _Stop,
    _stored_uid,
    _unchainable_tokens,
    _uuid_list,
    _within,
    _write_result,
)

logger = logging.getLogger(__name__)

FILLS_MODES: Final[tuple[str, ...]] = ("fills_calibrate", "fills_apply")
#: The mapper's stops, plus the three the fills path owns: ``fills_write_failed`` (plan 07) and
#: ``fills_count_not_persisted`` (the write-ahead apply count could not be stored, so no apply was
#: POSTed) are transient, ``fills_legacy_mismatch`` is permanent and raised by ``fills_apply`` only.
FILLS_STOP_CLASSES: Final[frozenset[str]] = MAP_STOP_CLASSES | {
    "fills_write_failed",
    "fills_count_not_persisted",
    "fills_legacy_mismatch",
}
FILLS_TRANSIENT_STOP_CLASSES: Final[frozenset[str]] = frozenset(
    {"fills_write_failed", "fills_count_not_persisted"}
)
#: The named known gap ``259-ARCHIVE-QUARTER-CAP``: one job reads at most this many quarters.
MAX_FILLS_QUARTERS: Final[int] = 4
#: Read by plan 06: one quarter is applied for at most this many times, ever (OKX's own cap on a
#: retry of a failed request; the persisted count is what makes the cap survive a restart).
FILLS_MAX_APPLIES_PER_QUARTER: Final[int] = 2
_ARCHIVE_FIRST_QUARTER: Final[tuple[int, str]] = (2021, "Q1")
_QUARTER_LABELS: Final[tuple[str, ...]] = ("Q1", "Q2", "Q3", "Q4")
_STORED_FILL_COLUMNS: Final[str] = (
    "id,exchange_fill_id,symbol,side,price::text,quantity::text,fee::text,fee_currency,timestamp"
)
_STORED_PAGE: Final[int] = 1000

_EPOCH: Final[datetime] = datetime(1970, 1, 1, tzinfo=timezone.utc)
_EPOCH_ORDINAL: Final[int] = date(1970, 1, 1).toordinal()
_DAY_MS: Final[int] = 86_400_000
_MS: Final[timedelta] = timedelta(milliseconds=1)
#: A value that may be echoed into a stop's text: a short run of plain token characters.
_SAFE_TOKEN: Final[re.Pattern[str]] = re.compile(r"[0-9A-Za-z_/(){},.\-]{1,48}")
#: A PostgreSQL SQLSTATE: the only part of a failed write's error that may be logged (its message,
#: details and hint can carry row values).
_SQLSTATE: Final[re.Pattern[str]] = re.compile(r"[0-9A-Z]{5}")


class _FillsStop(Exception):
    """A permanent (or, for ``fills_write_failed``, transient) stop with a closed class.

    The twin of ``okx_archive_job._Stop`` for the classes the rebuild's closed set must not learn
    (a new member there would break its pinned set). ``detail`` holds counts and days only."""

    def __init__(self, stop_class: str, detail: str = "") -> None:
        if stop_class not in FILLS_STOP_CLASSES:  # a typo here would be a silent new class
            raise AssertionError(f"unknown fills stop class {stop_class!r}")
        super().__init__(stop_class)
        self.stop_class = stop_class
        self.detail = detail
        self.census: dict[str, Any] | None = None
        self.info: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _FillsInput:
    mode: str
    #: The operator's ``quarters`` override, or None when the quarters are derived.
    quarters: tuple[tuple[int, str], ...] | None
    #: The operator's ``fill_strategy_ids`` (a narrowing of the derived targets), or None.
    strategy_ids: tuple[str, ...] | None


def _read_fills_input(job: Mapping[str, Any], today: date) -> _FillsInput:
    """Validate ``job['metadata']`` for the two fills modes. Raises ``_Stop('invalid_input')``.
    Unknown keys are ignored: the platform puts its own on ``compute_jobs.metadata``."""
    metadata = job.get("metadata")
    if not isinstance(metadata, Mapping):
        raise _invalid("metadata_not_an_object")
    mode = metadata.get("mode")
    if not isinstance(mode, str) or mode not in FILLS_MODES:
        raise _invalid("mode_unknown")

    quarters: tuple[tuple[int, str], ...] | None = None
    raw_quarters = metadata.get("quarters")
    if raw_quarters is not None:
        if not isinstance(raw_quarters, list) or not 1 <= len(raw_quarters) <= MAX_FILLS_QUARTERS:
            raise _invalid("quarters_count")
        listed: list[tuple[int, str]] = []
        for entry in raw_quarters:
            if not isinstance(entry, Mapping) or set(entry) != {"year", "quarter"}:
                raise _invalid("quarter_entry_shape")
            year, label = entry["year"], entry["quarter"]
            if isinstance(year, bool) or not isinstance(year, int) or year < _ARCHIVE_FIRST_QUARTER[0]:
                raise _invalid("quarter_year")
            if not isinstance(label, str) or label not in _QUARTER_LABELS:
                raise _invalid("quarter_label")
            try:
                _, end_exclusive = quarter_bounds(year, label)
            except (ValueError, OverflowError):
                raise _invalid("quarter_year") from None
            if end_exclusive > today:  # OKX generates a file only for a quarter that has ended
                raise _invalid("quarter_not_over")
            if (year, label) in listed:
                raise _invalid("quarter_duplicate")
            listed.append((year, label))
        quarters = tuple(listed)

    strategy_ids: tuple[str, ...] | None = None
    if metadata.get("fill_strategy_ids") is not None:
        ids = _uuid_list(metadata["fill_strategy_ids"], field="fill_strategy_ids")
        if not ids:
            raise _invalid("fill_strategy_ids_empty")
        strategy_ids = tuple(dict.fromkeys(ids))
    return _FillsInput(mode=mode, quarters=quarters, strategy_ids=strategy_ids)


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

async def _discover_targets(
    supabase: Any, job: Mapping[str, Any], inp: _FillsInput
) -> tuple[tuple[str, ...], int]:
    """The strategies this job reads for, and how many connected-key siblings were skipped.

    Account-scoped (CONTEXT: "one account's file serves every strategy whose key reads that
    account"): every non-archived strategy on a CONNECTED OKX key that shares the job key's
    non-blank stored ``venue_account_id``, ordered by strategy id. The job key's blank stored uid
    stops here, before any credential is decrypted. Disconnected keys' strategies are filtered out
    first (``_check_keys`` raises for ANY disconnected target) and only counted."""
    api_key_id = job.get("api_key_id")

    def _load_job_key() -> Any:
        return (
            supabase.table("api_keys")
            .select(_KEY_COLUMNS)
            .eq("id", api_key_id)
            .maybe_single()
            .execute()
        )

    job_key = one(await db_execute(_load_job_key))
    uid = _stored_uid(job_key.get("venue_account_id")) if job_key is not None else None
    if uid is None:
        raise _Stop("account_mismatch", "stored_uid=missing")

    def _load_account_keys() -> Any:
        return (
            supabase.table("api_keys")
            .select(_KEY_COLUMNS)
            .eq("exchange", "okx")
            .eq("venue_account_id", uid)
            .execute()
        )

    account_keys = {str(r.get("id")): r for r in rows(await db_execute(_load_account_keys))}
    if not account_keys:
        return (), 0
    key_ids = sorted(account_keys)

    def _load_strategies() -> Any:
        return (
            supabase.table("strategies")
            .select("id,api_key_id,status")
            .in_("api_key_id", key_ids)
            .execute()
        )

    connected: list[str] = []
    skipped = 0
    for strategy in rows(await db_execute(_load_strategies)):
        if strategy.get("status") == "archived":
            continue
        key_row = account_keys.get(str(strategy.get("api_key_id")))
        if key_row is None or not _key_is_connected(key_row):
            skipped += 1
            continue
        connected.append(str(strategy.get("id")))
    targets = tuple(sorted(connected))
    if inp.strategy_ids is not None:
        if not set(inp.strategy_ids) <= set(targets):
            raise _invalid("fill_strategy_not_on_account")
        targets = tuple(sorted(inp.strategy_ids))
    return targets, skipped


# ---------------------------------------------------------------------------
# The quarter plan: a pure function of data
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class QuarterPlan:
    #: The quarters to read, oldest first.
    read: tuple[tuple[int, str], ...]
    #: The read quarter that contains the write bound (compared against stored fills), or None.
    reconcile: tuple[int, str] | None
    #: Derived quarters left out by ``MAX_FILLS_QUARTERS``, oldest first (``259-ARCHIVE-QUARTER-CAP``).
    over_cap: tuple[tuple[int, str], ...]
    #: Every span not read: ``{"from_day", "until_day", "reason"}`` (UTC days of the start instant
    #: and of the exclusive end instant).
    unread_spans: tuple[dict[str, str], ...]


def _cut_range(year: int, quarter: str) -> tuple[int, int]:
    """The half-open UTC range, in epoch ms, of one quarter's FILE: OKX cuts a file at 00:00 UTC+8."""
    start, end = quarter_bounds(year, quarter)

    def _ms(day: date) -> int:
        return (day.toordinal() - _EPOCH_ORDINAL) * _DAY_MS - _QUARTER_CUT_UTC_OFFSET_MS

    return _ms(start), _ms(end)


def _utc_day(ms: int) -> str:
    return (_EPOCH + timedelta(milliseconds=ms)).date().isoformat()


def _iso(ms: int) -> str:
    """The exact ISO instant of an epoch-ms value (epoch plus a timedelta, never float arithmetic)."""
    return (_EPOCH + timedelta(milliseconds=ms)).isoformat()


def _span(from_ms: int, until_ms: int, reason: str) -> dict[str, str]:
    return {"from_day": _utc_day(from_ms), "until_day": _utc_day(until_ms), "reason": reason}


def _ended_quarters(today: date) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for year in range(_ARCHIVE_FIRST_QUARTER[0], today.year + 1):
        for label in _QUARTER_LABELS:
            if quarter_bounds(year, label)[1] <= today:
                out.append((year, label))
    return out


def plan_fill_quarters(
    anchors_ms: Sequence[int],
    *,
    write_bound_ms: int,
    floor_ms: int,
    today: date,
    override: tuple[tuple[int, str], ...] | None,
) -> QuarterPlan:
    """Which quarters to read, from the targets' anchors alone.

    ``lo`` is the lowest anchor below the write bound; no such anchor gives an empty plan. Derived
    mode reads the ended quarters (from 2021 Q1) whose cut range meets [lo, write bound), plus the
    ended quarter containing the write bound, keeping the newest ``MAX_FILLS_QUARTERS``; the older
    candidates are ``over_cap``. Override mode reads exactly the operator's quarters (the reconcile
    quarter only when one of them contains the write bound) and names the derived quarters it was
    not asked for as ``not_requested``. ``pre_archive`` (before 2021 Q1) and ``unreachable`` (between
    the current quarter's cut and the fills-history floor, which neither source reaches) are named
    in both modes."""
    below = [a for a in anchors_ms if a < write_bound_ms]
    if not below:
        return QuarterPlan((), None, (), ())
    lo = min(below)
    ended = _ended_quarters(today)
    derived = [yq for yq in ended if _cut_range(*yq)[0] < write_bound_ms and _cut_range(*yq)[1] > lo]
    containing = next(
        (yq for yq in ended if _cut_range(*yq)[0] <= write_bound_ms < _cut_range(*yq)[1]), None
    )
    if containing is not None and containing not in derived:
        derived.append(containing)
    derived.sort()

    spans: list[dict[str, str]] = []
    first_cut_start = _cut_range(*_ARCHIVE_FIRST_QUARTER)[0]
    over_cap: tuple[tuple[int, str], ...] = ()
    if override is None:
        read = tuple(derived[-MAX_FILLS_QUARTERS:])
        over_cap = tuple(derived[: len(derived) - len(read)])
        reconcile = containing if containing in read else None
        if over_cap:
            spans.append(_span(max(lo, first_cut_start), _cut_range(*read[0])[0], "over_cap"))
    else:
        read = tuple(sorted(override))
        reconcile = next(
            (yq for yq in read if _cut_range(*yq)[0] <= write_bound_ms < _cut_range(*yq)[1]), None
        )
        run: list[tuple[int, str]] = []
        runs: list[list[tuple[int, str]]] = []
        for index, yq in enumerate(derived):
            if yq in read:
                continue
            if run and derived.index(run[-1]) + 1 != index:
                runs.append(run)
                run = []
            run.append(yq)
        if run:
            runs.append(run)
        for group in runs:
            spans.append(
                _span(
                    max(lo, _cut_range(*group[0])[0]),
                    min(_cut_range(*group[-1])[1], write_bound_ms),
                    "not_requested",
                )
            )
    if lo < first_cut_start:
        spans.append(_span(lo, first_cut_start, "pre_archive"))
    current = (today.year, f"Q{(today.month - 1) // 3 + 1}")
    unreachable_from = max(lo, _cut_range(*current)[0])
    if unreachable_from < floor_ms:
        spans.append(_span(unreachable_from, floor_ms, "unreachable"))
    spans.sort(key=lambda s: (s["from_day"], s["until_day"], s["reason"]))
    return QuarterPlan(
        read=read, reconcile=reconcile, over_cap=over_cap, unread_spans=tuple(spans)
    )


# ---------------------------------------------------------------------------
# The status read (GET only) and the quarter step
# ---------------------------------------------------------------------------

#: OKX's error for a status GET on a quarter it holds no request for (code 51604), as it appears in
#: the ccxt exception text.
_OKX_NO_REQUEST_CODE: Final[str] = '"code":"51604"'


@dataclass(frozen=True)
class _StatusReading:
    #: ``finished`` | ``ongoing`` | ``failed``, or None when OKX has NO entry for the quarter.
    state: str | None
    #: The signed download link: a bearer token, held in memory for this claim only and kept out
    #: of any repr.
    href: str | None = field(default=None, repr=False)
    ts_ms: int | None = None


async def _read_fills_status(exchange: ccxt.Exchange, year: int, label: str) -> _StatusReading:
    """One GET of the archive request's state for a quarter. GET only: no archive request is made.

    ``_read_quarter_status`` answers ``state=None`` for an empty ``data`` list AND for an unknown
    state word alike. The fills step must tell "OKX has no entry" (a mapping whose ``data`` is an
    empty list) apart from contract drift, so it reads the answer itself: a non-mapping answer, a
    ``data`` that is not a list, a first entry that is not a mapping or a state outside the closed
    vocabulary is ``archive_request_failed``."""
    tag = _quarter_tag(year, label)
    try:
        raw = await _okx_bills_fetch_with_backoff(
            exchange,
            _STATUS_ENDPOINT_METHOD,
            {"year": str(year), "quarter": label},
            label="bills-history-archive",
            page=0,
        )
    except ccxt.ExchangeError as exc:
        # Measured on PROD 2026-11-28: OKX answers a quarter with no request as error 51604
        # ("Initiate a download request before obtaining the hyperlink"), never as an empty
        # ``data`` list. That is "no entry"; every other venue error keeps propagating.
        if _OKX_NO_REQUEST_CODE in str(exc):
            return _StatusReading(state=None)
        raise
    if not isinstance(raw, Mapping):
        raise _Stop("archive_request_failed", f"quarter={tag}")
    data = raw.get("data")
    if not isinstance(data, list):
        raise _Stop("archive_request_failed", f"quarter={tag}")
    if not data:
        return _StatusReading(state=None)
    entry = data[0]
    if not isinstance(entry, Mapping):
        raise _Stop("archive_request_failed", f"quarter={tag}")
    state = entry.get("state")
    if not isinstance(state, str) or state not in _ARCHIVE_STATES:
        raise _Stop("archive_request_failed", f"quarter={tag}")
    href = entry.get("fileHref")
    return _StatusReading(
        state=state,
        href=href if isinstance(href, str) and href.strip() else None,
        ts_ms=_parse_ts_ms(entry.get("ts")),
    )


def _prior_applies(
    job: Mapping[str, Any], quarters: Sequence[tuple[int, str]] = ()
) -> dict[tuple[int, str], int]:
    """The apply count each quarter already spent, read back from this job's own result block.

    ``metadata.member_progress`` is the last result block ``set_compute_job_progress`` stored (the
    claim returns the whole row), so the count survives a defer, a restart and a rate limit. An
    absent block, or a block with no entry for a quarter, means 0 (nothing was ever applied). A count
    that cannot be read means SPENT (``FILLS_MAX_APPLIES_PER_QUARTER``): an entry whose ``applies``
    is not a non-negative int (a bool included) or is absent, and, for every quarter in ``quarters``,
    a block whose shape cannot be read at all. A budget that cannot be evaluated must never read as
    unspent."""
    spent = FILLS_MAX_APPLIES_PER_QUARTER
    metadata = job.get("metadata")
    progress = metadata.get("member_progress") if isinstance(metadata, Mapping) else None
    if progress is None:
        return {}
    if not isinstance(progress, Mapping):
        return {yq: spent for yq in quarters}
    entries = progress.get("quarters")
    if entries is None:
        return {}
    if not isinstance(entries, list):
        return {yq: spent for yq in quarters}
    out: dict[tuple[int, str], int] = {}
    for entry in entries:
        if not isinstance(entry, Mapping):
            return {yq: spent for yq in quarters}
        year, label = entry.get("year"), entry.get("quarter")
        if isinstance(year, bool) or not isinstance(year, int) or not isinstance(label, str):
            return {yq: spent for yq in quarters}
        count = entry.get("applies")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            count = spent
        out[(year, label)] = max(out.get((year, label), 0), count)
    return out


def _job_age_s(job: Mapping[str, Any]) -> float | None:
    """Seconds since the job was created, parsed from ``created_at`` exactly as ``_check_backstop``
    parses it, or None when it cannot be read."""
    raw = job.get("created_at")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        created = datetime.fromisoformat(raw.strip())
    except ValueError:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0.0, (_archive_job._wall_ms() - int(created.timestamp() * 1000)) / 1000.0)


async def _persist_apply_count(
    supabase: Any, job: Mapping[str, Any], result: dict[str, Any], tag: str
) -> None:
    """Store the result block (it carries every quarter's ``applies``) or raise the transient
    ``fills_count_not_persisted``. A write that raises, or that is a fenced no-op because the claim
    was lost, is not stored: the caller must not POST an apply it cannot account for."""
    try:
        wrote = await _write_result(supabase, job, result)
    except asyncio.CancelledError:
        raise  # never swallow cancellation
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "okx_archive_rebuild: the apply count for %s could not be stored (%s)",
            tag,
            type(exc).__name__,
        )
        wrote = False
    if not wrote:
        raise _FillsStop("fills_count_not_persisted", f"quarter={tag}")


async def _counted_apply(
    supabase: Any,
    job: Mapping[str, Any],
    result: dict[str, Any],
    entry: dict[str, Any],
    key_row: Mapping[str, Any],
    pacer: _ApplyPacer,
    prior: int,
) -> _ApplyAnswer:
    """One apply POST with a write-ahead count: ``applies`` is raised and STORED before the POST, so
    no exit after it (a timeout, a network error, a crash, a cancelled claim) can lose the count.

    A venue rate limit (``RateLimitExceeded``/``DDoSProtection``) is a refusal: no request exists at
    OKX, so the count goes back to ``prior`` and is stored again before the handler defers. A timeout
    or any other unknown outcome stays counted as spent."""
    year, label = entry["year"], entry["quarter"]
    tag = _quarter_tag(year, label)
    entry["applies"] = prior + 1
    await _persist_apply_count(supabase, job, result, tag)
    try:
        answer = await pacer.apply(key_row, year, label)
    except (ccxt.RateLimitExceeded, ccxt.DDoSProtection):
        entry["applies"] = prior
        await _persist_apply_count(supabase, job, result, tag)
        raise
    entry["applied_existing"] = answer.existing
    return answer


async def _fills_quarter_step(
    supabase: Any,
    key_row: Mapping[str, Any],
    entry: dict[str, Any],
    result: dict[str, Any],
    reading: _StatusReading,
    pacer: _ApplyPacer,
    prior: int,
    job: Mapping[str, Any],
) -> _QuarterStep:
    """One quarter's decision, GET first (CONTEXT Addendum "Apply budget"). ``reading`` is OKX's
    state, already read; ``prior`` is the count of applies this quarter has spent in this job.

    * ``finished`` with a link: ready.
    * ``ongoing``, or ``finished`` without a link: wait ``STATUS_POLL_INTERVAL_S`` (an unreadable
      OKX ``ts`` is ``archive_request_failed``, an age of ``GIVE_UP_AFTER_S`` is ``archive_give_up``).
      NEVER an apply.
    * ``failed``: apply while ``prior < FILLS_MAX_APPLIES_PER_QUARTER``, then wait for the file;
      afterwards ``archive_request_failed``.
    * no entry: apply ONCE (``prior == 0``) and wait; with ``prior >= 1`` OKX is simply not showing
      the request yet, so wait without applying until the job is ``GIVE_UP_AFTER_S`` old.

    The count is raised and STORED (``_counted_apply``) BEFORE the POST, so a timeout, a network error
    or a crash after the POST still counts it; a rate limit, which is a refusal, gives the count back.
    Each apply runs alone on its own fresh client as its last call, through the pacer."""
    year, label = entry["year"], entry["quarter"]
    tag = _quarter_tag(year, label)
    entry["state"] = reading.state
    entry["applies"] = prior
    if reading.state == "finished" and reading.href is not None:
        return _record_ready(entry, reading.href)

    if reading.state in ("ongoing", "finished"):
        age = _age_s(reading.ts_ms)
        if age is None:
            raise _Stop("archive_request_failed", f"quarter={tag} state={reading.state}")
        if age >= GIVE_UP_AFTER_S:
            raise _Stop("archive_give_up", f"quarter={tag} age_h={int(age // 3600)}")
        return _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S)

    if reading.state == "failed":
        if prior >= FILLS_MAX_APPLIES_PER_QUARTER:
            raise _Stop("archive_request_failed", f"quarter={tag} state=failed")
        await _counted_apply(supabase, job, result, entry, key_row, pacer, prior)
        return _QuarterStep(wait_s=FIRST_STATUS_READ_AFTER_S)

    # OKX has no entry for the quarter.
    if prior == 0:
        answer = await _counted_apply(supabase, job, result, entry, key_row, pacer, prior)
        applied_age = _age_s(answer.ts_ms)
        logger.info(
            "okx_archive_rebuild: %s apply existing=%s ts_age_h=%s",
            tag,
            answer.existing,
            "unreadable" if applied_age is None else int(applied_age // 3600),
        )
        if answer.existing:
            return _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S)
        if applied_age is None:
            return _QuarterStep(wait_s=FIRST_STATUS_READ_AFTER_S)
        # OKX takes 2-3 h to generate a file: no point asking before then.
        if applied_age < FIRST_STATUS_READ_AFTER_S:
            return _QuarterStep(wait_s=FIRST_STATUS_READ_AFTER_S - applied_age)
        return _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S)
    age = _job_age_s(job)
    if age is None or age >= GIVE_UP_AFTER_S:
        raise _Stop(
            "archive_request_failed", f"quarter={tag} state=no_entry cause=no_entry_after_apply"
        )
    return _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S)


# ---------------------------------------------------------------------------
# Database reads
# ---------------------------------------------------------------------------

def _anchor_ms_of(day: str) -> int:
    parsed = date.fromisoformat(day)
    return (parsed.toordinal() - _EPOCH_ORDINAL) * _DAY_MS


async def _read_anchor_day(supabase: Any, strategy_id: str) -> str | None:
    """The target's earliest ``csv_daily_returns`` date as a real ``YYYY-MM-DD`` day, or None."""

    def _read() -> Any:
        return (
            supabase.table("csv_daily_returns")
            .select("date")
            .eq("strategy_id", strategy_id)
            .order("date")
            .limit(1)
            .execute()
        )

    found = rows(await db_execute(_read))
    return _iso_day(str(found[0].get("date"))[:10]) if found else None


async def _read_earliest_fill_day(supabase: Any, strategy_id: str) -> str | None:
    """The UTC day of the target's earliest stored OKX fill (reporting only). ``is_fill`` is always
    filtered: the legacy daily rows carry no ``exchange_fill_id``."""

    def _read() -> Any:
        return (
            supabase.table("trades")
            .select("timestamp")
            .eq("strategy_id", strategy_id)
            .eq("exchange", "okx")
            .eq("is_fill", True)
            .order("timestamp")
            .limit(1)
            .execute()
        )

    found = rows(await db_execute(_read))
    return _iso_day(str(found[0].get("timestamp"))[:10]) if found else None


async def _read_stored_fills(
    supabase: Any, strategy_id: str, start_ms: int, end_ms: int, budget: _ClaimBudget
) -> list[dict[str, Any]]:
    """The target's stored OKX fills with ``start_ms <= timestamp < end_ms``, paged by 1000.

    The bounds are exact ISO instants (epoch plus a timedelta). Each page is bounded by what is left
    of the claim's budget: running out is the named transient ``claim_budget_exceeded``."""
    start_iso, end_iso = _iso(start_ms), _iso(end_ms)
    out: list[dict[str, Any]] = []
    offset = 0
    while True:

        def _page(first: int = offset) -> Any:
            return (
                supabase.table("trades")
                .select(_STORED_FILL_COLUMNS)
                .eq("strategy_id", strategy_id)
                .eq("exchange", "okx")
                .eq("is_fill", True)
                .gte("timestamp", start_iso)
                .lt("timestamp", end_iso)
                .order("timestamp")
                .order("id")
                .range(first, first + _STORED_PAGE - 1)
                .execute()
            )

        batch = rows(await _within(budget, db_execute(_page), step="stored_read"))
        out.extend(batch)
        if len(batch) < _STORED_PAGE:
            return out
        offset += _STORED_PAGE


def _row_instant_ms(row: Mapping[str, Any]) -> int | None:
    """A stored row's instant, read from its raw ``timestamp`` on its own (a row whose price cannot
    be read still has an instant, and must reach the legacy reading as ``unreadable``)."""
    raw = row.get("timestamp")
    if not isinstance(raw, str):
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (parsed - _EPOCH) // _MS


def _inside_ranges(row: Mapping[str, Any], ranges: Sequence[tuple[int, int]]) -> bool:
    """True when the row's instant lies inside one of the read quarters' cut ranges. A row whose
    instant cannot be read is KEPT, so it surfaces as ``unreadable`` instead of vanishing."""
    instant = _row_instant_ms(row)
    if instant is None:
        return True
    return any(start <= instant < end for start, end in ranges)


# ---------------------------------------------------------------------------
# Stops and the finisher
# ---------------------------------------------------------------------------

def _detail_text(detail: Mapping[str, Any]) -> str:
    """A mapper stop's detail as ``key=value`` tokens. Only ints, short plain tokens (a UTC day, a
    closed field name, a value-free shape) and ``a:1,b:2`` tallies are echoed; anything else is
    dropped, never rendered."""
    tokens: list[str] = []
    for key in sorted(detail):
        value = detail[key]
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            tokens.append(f"{key}={value}")
        elif isinstance(value, str) and _SAFE_TOKEN.fullmatch(value):
            tokens.append(f"{key}={value}")
        elif isinstance(value, Mapping):
            tally = ",".join(
                f"{k}:{v}"
                for k, v in sorted(value.items())
                if isinstance(k, str)
                and _SAFE_TOKEN.fullmatch(k)
                and isinstance(v, int)
                and not isinstance(v, bool)
            )
            if tally:
                tokens.append(f"{key}={tally}")
    return " ".join(tokens)


def _stop_from_map(exc: FillsMapError) -> _FillsStop:
    return _FillsStop(exc.stop_class, _detail_text(exc.detail))


async def _finish_fills_stop(
    supabase: Any,
    job: Mapping[str, Any],
    result: dict[str, Any],
    stop: _Stop | _FillsStop,
) -> DispatchResult:
    """Write the result block FIRST, then return FAILED. Mirrors ``okx_archive_job._finish_stop``
    except that a stop's ``info`` is MERGED into the result's ``info`` (the rebuild's overwrites it),
    because the read path's ``info`` already holds the spans and the plan.

    A failed result write is logged and swallowed on this path (the stop class already rides in
    ``last_error`` and retrying a refusal would only repeat it) except cancellation."""
    result["stop_class"] = stop.stop_class
    if stop.census is not None:
        result["census"] = stop.census
    info = result.get("info")
    if stop.info is not None:
        info = {**(info or {}), **stop.info}
    if info is not None:
        info["outcome"] = "stopped"
        result["info"] = info
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
    transient = (
        stop.stop_class in TRANSIENT_STOP_CLASSES
        or stop.stop_class in FILLS_TRANSIENT_STOP_CLASSES
    )
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=_error_text(stop.stop_class, stop.detail),
        error_kind="transient" if transient else "permanent",
    )


# ---------------------------------------------------------------------------
# The handler
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Prepared:
    """What the database-only phase decided: the targets, their anchors, the clock-derived bounds
    and the quarter plan."""

    inp: _FillsInput
    scope: _KeyScope
    strategy_ids: tuple[str, ...]
    #: Per target, in position order: the anchor in epoch ms, or None for a target with no anchor.
    anchors_ms: tuple[int | None, ...]
    write_bound_ms: int
    plan: QuarterPlan
    #: The applies each read quarter already spent in this job (``_prior_applies``).
    prior_applies: dict[tuple[int, str], int]


def _role_of(year: int, quarter: str, lo: int, write_bound_ms: int) -> str:
    start, end = _cut_range(year, quarter)
    writes = start < write_bound_ms and end > lo
    reconciles = start <= write_bound_ms < end
    if writes and reconciles:
        return "write_reconcile"
    if reconciles:
        return "reconcile"
    return "write" if writes else "out_of_window"


def _blank_target(position: int, state: str, anchor_day: str | None, earliest: str | None) -> dict[str, Any]:
    return {
        "position": position,
        "state": state,
        "anchor_day": anchor_day,
        "earliest_stored_fill_day": earliest,
        "write_from_day": None,
        "write_bound_day": None,
        "archive_fills_in_window": 0,
        "already_stored": 0,
        "would_insert": 0,
        "inserted": None,
        "before_anchor": 0,
        "legacy": None,
    }


async def _prepare(
    supabase: Any, job: Mapping[str, Any], result: dict[str, Any]
) -> _Prepared:
    """Everything that needs the database and no credential: the input, the D-02 key checks, the
    targets, their anchors and the quarter plan. Seeds the result's ``quarters``, ``strategies``,
    ``reconcile`` and ``info``."""
    inp = _read_fills_input(job, _archive_job._utc_today())
    result["mode"] = inp.mode
    await _check_keys(supabase, job, _JobInput(mode=inp.mode, quarters=(), target_strategy_ids=()))
    strategy_ids, skipped = await _discover_targets(supabase, job, inp)
    scope = await _check_keys(
        supabase, job, _JobInput(mode=inp.mode, quarters=(), target_strategy_ids=strategy_ids)
    )

    anchor_days: list[str | None] = []
    earliest_days: list[str | None] = []
    for strategy_id in strategy_ids:
        anchor_days.append(await _read_anchor_day(supabase, strategy_id))
        earliest_days.append(await _read_earliest_fill_day(supabase, strategy_id))
    anchors = tuple(None if day is None else _anchor_ms_of(day) for day in anchor_days)

    now_ms = _archive_job._wall_ms()
    floor_ms = _okx_fills_begin_floor_ms(now_ms)
    write_bound_ms = floor_ms + WRITE_BOUND_MARGIN_MS
    plan = plan_fill_quarters(
        [a for a in anchors if a is not None],
        write_bound_ms=write_bound_ms,
        floor_ms=floor_ms,
        today=_archive_job._utc_today(),
        override=inp.quarters,
    )

    strategies: list[dict[str, Any]] = []
    spans: list[dict[str, Any]] = [dict(s) for s in plan.unread_spans]
    for position, anchor in enumerate(anchors):
        if anchor is None:
            state = "no_anchor"
        elif anchor >= write_bound_ms:
            state = "anchor_in_reach"
        else:
            state = "read"
        strategies.append(_blank_target(position, state, anchor_days[position], earliest_days[position]))
        if state == "read" and plan.read:
            oldest_start = _cut_range(*plan.read[0])[0]
            if anchor is not None and anchor > oldest_start:
                spans.append(
                    {
                        "from_day": _utc_day(oldest_start),
                        "until_day": _utc_day(anchor),
                        "reason": "before_anchor",
                        "position": position,
                    }
                )
    lows = [a for a in anchors if a is not None and a < write_bound_ms]
    lo = min(lows) if lows else write_bound_ms
    # The carried apply counts are seeded HERE, before ``_allocator_key_preflight``: every later
    # result write (a stop or a defer before any quarter is stepped included) replaces the stored
    # block whole, so each one must carry every quarter's count or it would zero it.
    prior = _prior_applies(job, plan.read)
    result["quarters"] = [
        {
            **_blank_quarter(year, label),
            "role": _role_of(year, label, lo, write_bound_ms),
            "applies": prior.get((year, label), 0),
        }
        for year, label in plan.read
    ]
    result["strategies"] = strategies
    result["reconcile"] = {"ts_column": ARCHIVE_TS_COLUMN, "strategies": []}
    result["info"] = {
        "outcome": None,
        "floor_day": _utc_day(floor_ms),
        "write_bound_day": _utc_day(write_bound_ms),
        "unread_spans": spans,
        "over_cap_quarters": [_quarter_tag(y, q) for (y, q) in plan.over_cap],
        "targets_skipped_disconnected": skipped,
        "bal_chain": None,
    }
    return _Prepared(
        inp=inp,
        scope=scope,
        strategy_ids=strategy_ids,
        anchors_ms=anchors,
        write_bound_ms=write_bound_ms,
        plan=plan,
        prior_applies=prior,
    )


def _summed_ccys(files: Sequence[ArchiveFile]) -> frozenset[str]:
    """The currencies the bal chain must prove complete: those with a nonzero ``pnl``, ``fee`` or
    ``balChg`` on any bill. Computed here (the fills read has no other use for the rebuild's
    classification, whose own stops belong to the daily rebuild). A blank currency is left out: a
    blank-ccy bill with an effect is stopped by the chain itself as ``unchainable_row``."""
    return frozenset(
        row.ccy
        for file in files
        for row in file.rows
        if row.ccy and (row.pnl != 0 or row.fee != 0 or row.bal_chg != 0)
    )


async def _verify_chain(files: list[ArchiveFile], tags: list[str]) -> dict[str, Any]:
    """The one completeness proof, over the files together so a quarter seam is chained too. A stop
    carries the same text and ``info.bal_chain`` the rebuild's ``_census_of`` gives."""
    try:
        chain = await asyncio.to_thread(verify_bal_chain, files, _summed_ccys(files))
    except ArchiveParseError as exc:
        stop = _parse_stop(exc)
        if exc.stop_class == "archive_incomplete":
            info = _bal_chain_info(exc.detail)
            stop.detail = f"{stop.detail} cause={info['reason']}"
            if info["reason"] == "unchainable_row":
                stop.detail = f"{stop.detail} {_unchainable_tokens(exc.detail, tags)}"
            stop.info = {"bal_chain": info}
        raise stop from None
    return {
        **_safe_bal_chain(chain),
        "blank_ccy_skipped": chain["blank_ccy_skipped"],
        "floor": MIN_CHAINED_PAIRS,
    }


def _miss_reading(exc: FillsMapError) -> dict[str, Any]:
    """The result entry of a target whose reconcile missed: counts and the first failing field."""
    detail = exc.detail
    out: dict[str, Any] = {"position": detail.get("position"), "state": "miss"}
    for key in ("field", "pairs", "archive_count", "stored_count", "ts_column", "ts_match", "fill_time_match"):
        value = detail.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            out[key] = value
        elif isinstance(value, str) and _SAFE_TOKEN.fullmatch(value):
            out[key] = value
    tally = detail.get("misses_by_field")
    out["misses_by_field"] = (
        {k: v for k, v in tally.items() if isinstance(k, str) and isinstance(v, int)}
        if isinstance(tally, Mapping)
        else {}
    )
    return out


async def _evaluate_targets(
    supabase: Any,
    prepared: _Prepared,
    mapped: list[MappedFill],
    result: dict[str, Any],
    budget: _ClaimBudget,
) -> None:
    """Every target's legacy reading, counts and reconcile, with nothing written. Every target is
    evaluated before anything else happens; a miss is recorded in that target's reading and the
    FIRST miss (lowest position) stops the whole read once all readings are in the result."""
    plan = prepared.plan
    write_bound_ms = prepared.write_bound_ms
    read_ranges = [_cut_range(*yq) for yq in plan.read]
    reconcile_end = _cut_range(*plan.reconcile)[1] if plan.reconcile is not None else None
    readings: list[dict[str, Any]] = result["reconcile"]["strategies"]
    first_miss: FillsMapError | None = None
    for position, strategy_id in enumerate(prepared.strategy_ids):
        entry = result["strategies"][position]
        anchor_ms = prepared.anchors_ms[position]
        if entry["state"] != "read" or anchor_ms is None:
            readings.append({"position": position, "state": "not_read"})
            continue
        write_set = [m for m in mapped if anchor_ms <= m.row_ms < write_bound_ms]
        stored = await _read_stored_fills(supabase, strategy_id, anchor_ms, write_bound_ms, budget)
        # A stored row in a span this job did not read cannot be compared with an archive bill.
        comparable = [r for r in stored if _inside_ranges(r, read_ranges)]
        stored_ids = {str(r.get("exchange_fill_id")) for r in comparable}
        already = sum(1 for m in write_set if m.trade_id in stored_ids)
        entry["write_from_day"] = _utc_day(anchor_ms)
        entry["write_bound_day"] = _utc_day(write_bound_ms)
        entry["archive_fills_in_window"] = len(write_set)
        entry["already_stored"] = already
        entry["would_insert"] = len(write_set) - already
        entry["before_anchor"] = sum(1 for m in mapped if m.row_ms < anchor_ms)
        entry["legacy"] = legacy_subset(mapped, comparable)
        if reconcile_end is None:
            readings.append({"position": position, "state": "not_performed"})
            continue
        window = [m for m in mapped if write_bound_ms <= m.row_ms < reconcile_end]
        window_stored = await _read_stored_fills(
            supabase, strategy_id, write_bound_ms, reconcile_end, budget
        )
        try:
            readings.append(reconcile_window(window, window_stored, position=position))
        except FillsMapError as exc:
            readings.append(_miss_reading(exc))
            if first_miss is None:
                first_miss = exc
    if first_miss is not None:
        raise _stop_from_map(first_miss)
    if prepared.inp.mode == "fills_apply":
        _legacy_gate(result["strategies"])


def _legacy_gate(strategies: Sequence[Mapping[str, Any]]) -> None:
    """The ``fills_apply`` go/no-go: the runbook refuses a calibrate whose legacy reading has a
    non-zero ``unequal``, ``absent_in_archive`` or ``unreadable``, so the automatic chain must never
    write what the runbook would refuse. Raised after every target's reading is in the result (a
    reconcile miss, raised before this, takes precedence) and before ``_write_fills``, so a mismatch
    on ANY target writes nothing for ALL of them. The stop is permanent (the chain's cooldown counts
    it) and its detail is counts and the lowest position only. ``fills_calibrate`` never reaches this:
    it reports the same reading and ends DONE."""
    first: tuple[int, int, int, int] | None = None
    targets = 0
    for entry in strategies:
        legacy = entry.get("legacy")
        if not isinstance(legacy, Mapping):
            continue
        unequal = int(legacy["unequal"])
        absent = int(legacy["absent_in_archive"])
        unreadable = int(legacy["unreadable"])
        if unequal + absent + unreadable > 0:
            targets += 1
            if first is None:
                first = (int(entry["position"]), unequal, absent, unreadable)
    if first is not None:
        position, unequal, absent, unreadable = first
        raise _FillsStop(
            "fills_legacy_mismatch",
            f"position={position} unequal={unequal} absent_in_archive={absent} "
            f"unreadable={unreadable} targets={targets}",
        )


async def _write_fills(
    supabase: Any,
    prepared: _Prepared,
    mapped: Sequence[MappedFill],
    result: dict[str, Any],
    budget: _ClaimBudget,
) -> None:
    """``fills_apply`` only, after every gate for every target has passed: store each read target's
    archive fills in [anchor, write bound) through the SAME upsert the live fills read uses
    (``run_sync_trades_job``, Phase 2): ``on_conflict`` the ``trades_dedup_fill`` key,
    ``ignore_duplicates=True`` (the unique index is the arbiter, never a pre-insert probe), batches of
    100. The row sent is a copy of the mapped row plus ``strategy_id``. PostgREST answers an
    ignore-duplicates upsert with only the rows it inserted, so ``len(resp.data)`` is the inserted
    count; when the answer is not a list the target's ``inserted`` becomes None and
    ``info.inserted_count_unreadable`` is set (the runbook's PROD after-count is then the authority).
    ``inserted`` is recorded after every batch, so a failure leaves the partial count in the result.

    Each target's batches go NEWEST FIRST, so a write that stops part way leaves the OLDEST fills
    unwritten and the target's earliest stored fill stays far from its anchor: the chain's reach test
    keeps answering "not reached" and the next chained read completes the rest through the idempotent
    upsert (oldest first would land the fill nearest the anchor first and end the chain early).

    A batch that raises ends ``fills_write_failed`` (transient, resumable: the unique index absorbs
    the rows that landed); only the exception CLASS and, when it is a 5-character SQLSTATE, its
    ``code`` are logged, because the text can carry row values. ``inserted_before_failure`` is
    ``unknown`` when any written target's count is None. The claim budget's ``_Stop`` propagates as
    itself after that target's ``inserted`` is set to None (the batch in flight may have landed). The
    fills cursor and the re-read bound are never touched."""
    info: dict[str, Any] = result["info"]
    for position, strategy_id in enumerate(prepared.strategy_ids):
        entry = result["strategies"][position]
        anchor_ms = prepared.anchors_ms[position]
        if entry["state"] != "read" or anchor_ms is None:
            continue
        write_rows = [
            m.row
            for m in sorted(
                (m for m in mapped if anchor_ms <= m.row_ms < prepared.write_bound_ms),
                key=lambda m: m.row_ms,
                reverse=True,
            )
        ]
        inserted: int | None = 0
        entry["inserted"] = inserted
        for i in range(0, len(write_rows), 100):
            batch = write_rows[i:i + 100]

            def _insert(batch_rows: list[dict[str, Any]] = batch, sid: str = strategy_id) -> Any:
                return (
                    supabase.table("trades")
                    .upsert(
                        [{"strategy_id": sid, **row} for row in batch_rows],
                        on_conflict="strategy_id,exchange,exchange_fill_id",
                        ignore_duplicates=True,
                    )
                    .execute()
                )

            try:
                resp = await _within(budget, db_execute(_insert), step="write")
            except asyncio.CancelledError:
                raise
            except _Stop:
                # The budget ran out around the batch: it may or may not have landed.
                entry["inserted"] = None
                raise
            except Exception as exc:  # noqa: BLE001
                code = getattr(exc, "code", None)
                logger.error(
                    "okx_archive_rebuild: a fills write batch failed (%s%s)",
                    type(exc).__name__,
                    f" code={code}" if isinstance(code, str) and _SQLSTATE.fullmatch(code) else "",
                )
                counts = [
                    s["inserted"]
                    for s in result["strategies"][: position + 1]
                    if s["state"] == "read"
                ]
                total = (
                    "unknown"
                    if any(c is None or isinstance(c, bool) for c in counts)
                    else sum(counts)
                )
                raise _FillsStop(
                    "fills_write_failed",
                    f"position={position} inserted_before_failure={total}",
                ) from None
            data = getattr(resp, "data", None)
            if inserted is not None and isinstance(data, list):
                inserted += len(data)
            else:
                inserted = None
                info["inserted_count_unreadable"] = True
            entry["inserted"] = inserted


@dataclass(frozen=True)
class _Waiting:
    """At least one quarter is not ready: the claim ends with a defer of ``seconds`` (the shortest
    wait of any quarter), ``ready`` of ``total`` quarters being ready now."""

    seconds: float
    ready: int
    total: int


async def _read_and_gate(
    supabase: Any,
    exchange: ccxt.Exchange,
    key_row: Mapping[str, Any],
    job: Mapping[str, Any],
    prepared: _Prepared,
    result: dict[str, Any],
    budget: _ClaimBudget,
) -> _Waiting | list[MappedFill]:
    """The exchange phase: the account check, the status reads (and the budgeted applies), then,
    only when every quarter is ready, the downloads and every gate. A list (the mapped archive
    fills, every gate passed) means the read completed; a ``_Waiting`` means nothing was downloaded
    and the job must be deferred."""
    await _check_account(exchange, prepared.scope, result)
    quarters: list[dict[str, Any]] = result["quarters"]
    pacer = _ApplyPacer()
    steps: list[_QuarterStep] = []
    for entry in quarters:
        reading = await _read_fills_status(exchange, entry["year"], entry["quarter"])
        prior = prepared.prior_applies.get((entry["year"], entry["quarter"]), 0)
        steps.append(
            await _fills_quarter_step(supabase, key_row, entry, result, reading, pacer, prior, job)
        )
    waits = [step.wait_s for step in steps if step.href is None]
    if waits:
        return _Waiting(seconds=min(waits), ready=len(steps) - len(waits), total=len(steps))
    hrefs: list[str] = []
    for step in steps:
        assert step.href is not None  # a ready quarter has its link, or the step waited or stopped
        hrefs.append(step.href)
    files: list[ArchiveFile] = []
    for entry, href in zip(quarters, hrefs):
        try:
            files.append(await _ingest_quarter(exchange, entry, href, budget))
        except _Stop as stop:
            # A ``finished`` quarter whose link is dead (the download's one fresh read gave no live
            # link either) cannot be read until OKX generates the file again: re-apply once, counted
            # and stored like any apply, within the per-quarter cap. A network failure is not a dead
            # link, and a spent quarter keeps the transient ``link_expired``.
            dead = stop.stop_class == "link_expired" and "cause=network" not in stop.detail
            if not dead or entry["applies"] >= FILLS_MAX_APPLIES_PER_QUARTER:
                raise
            answer = await _counted_apply(
                supabase, job, result, entry, key_row, pacer, entry["applies"]
            )
            wait_s = STATUS_POLL_INTERVAL_S if answer.existing else FIRST_STATUS_READ_AFTER_S
            return _Waiting(seconds=wait_s, ready=len(files), total=len(quarters))
    result["census"] = archive_census(files)
    tags = [_quarter_tag(entry["year"], entry["quarter"]) for entry in quarters]
    result["info"]["bal_chain"] = await _verify_chain(files, tags)
    mapped = await asyncio.to_thread(map_trade_bills, files)
    await _evaluate_targets(supabase, prepared, mapped, result, budget)
    return mapped


async def _fills_defer(
    supabase: Any,
    job: Mapping[str, Any],
    result: dict[str, Any],
    seconds: float,
    reason: str,
) -> DispatchResult:
    """Park the job. The result block is written FIRST (best effort: the exception class is logged
    and swallowed, cancellation is never swallowed) because it carries the persisted apply counts the
    next claim reads back; then ``_defer_job`` parks the row (attempts untouched, clamped to an
    hour). A job past the 24 h backstop is not parked: ``_check_backstop`` runs first so the stop
    path writes the block once. ``reason`` becomes ``last_error``: a class and counts only."""
    try:
        _check_backstop(job)
    except _Stop as stop:
        return await _finish_fills_stop(supabase, job, result, stop)
    info = result.get("info")
    if isinstance(info, dict):
        info["outcome"] = "waiting"
    try:
        await _write_result(supabase, job, result)
    except asyncio.CancelledError:
        raise  # never swallow cancellation
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "okx_archive_rebuild: the result block of a waiting job could not be written (%s)",
            type(exc).__name__,
        )
    try:
        return await _defer_job(supabase, job, seconds, reason)
    except _Stop as stop:
        return await _finish_fills_stop(supabase, job, result, stop)


async def run_okx_archive_fills_job(job: dict[str, Any]) -> DispatchResult:
    """``okx_archive_rebuild`` handler for the modes ``fills_calibrate`` and ``fills_apply`` (reached
    through the fork at the top of ``run_okx_archive_rebuild_job``). See the module docstring for the
    order, which is the D-02 guarantee."""
    # ``get_supabase`` is read off the module at call time (the tests patch it there); it is an
    # import of that module, not one of its exports, hence the ``Any`` view.
    supabase = cast(Any, _archive_job).get_supabase()
    result = _blank_result(None)
    budget = _ClaimBudget(CLAIM_BUDGET_S)
    metadata = job.get("metadata")
    raw_mode = metadata.get("mode") if isinstance(metadata, Mapping) else None
    if isinstance(raw_mode, str) and raw_mode in FILLS_MODES:
        result["mode"] = raw_mode  # only a closed-set value is ever echoed

    try:
        prepared = await _prepare(supabase, job, result)
    except (_Stop, _FillsStop) as stop:
        return await _finish_fills_stop(supabase, job, result, stop)

    if not prepared.plan.read:
        # Nothing to read: no key is decrypted, no client built, OKX is not called.
        result["info"]["outcome"] = "nothing_to_read"
        json.dumps(result)
        await _write_result(supabase, job, result)
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # A DEFERRED (the circuit breaker's) passes straight through; a FAILED returned after the key
    # checks passed is a race with a concurrent key change and passes unchanged.
    ctx = await _allocator_key_preflight(job, "run_okx_archive_fills_job")
    if isinstance(ctx, DispatchResult):
        return ctx
    try:
        exchange = cast("ccxt.Exchange", ctx.exchange)
        try:
            gated = await _read_and_gate(
                supabase, exchange, ctx.key_row, job, prepared, result, budget
            )
            if not isinstance(gated, _Waiting) and prepared.inp.mode == "fills_apply":
                # Every quarter is read and every gate has passed for every target.
                await _write_fills(supabase, prepared, gated, result, budget)
        except (_Stop, _FillsStop) as stop:
            return await _finish_fills_stop(supabase, job, result, stop)
        except FillsMapError as exc:
            return await _finish_fills_stop(supabase, job, result, _stop_from_map(exc))
        except (ccxt.RateLimitExceeded, ccxt.DDoSProtection) as exc:
            # A venue rate limit is a reason to wait, never to fail, and it is NEVER stamped onto
            # the key, because ``stamp_api_key_429`` opens the exchange-wide breaker and pauses every normal
            # OKX sync for a quota this job alone spent.
            logger.warning(
                "okx_archive_rebuild: venue rate limit (%s); deferring %ds",
                type(exc).__name__,
                RATE_LIMIT_DEFER_S,
            )
            return await _fills_defer(
                supabase, job, result, RATE_LIMIT_DEFER_S, f"{KIND}: waiting rate_limited"
            )
        if isinstance(gated, _Waiting):
            return await _fills_defer(
                supabase,
                job,
                result,
                gated.seconds,
                f"{KIND}: waiting fills quarters_ready={gated.ready}/{gated.total}",
            )
        # ``fills_apply`` has written above; ``fills_calibrate`` ends with the reading.
        result["info"]["outcome"] = (
            "applied" if prepared.inp.mode == "fills_apply" else "read_complete"
        )
        # DONE is only honest once the result is stored: a failed write propagates and the
        # dispatcher retries the whole (idempotent) claim.
        json.dumps(result)  # the object must be plain JSON: no Decimal, no datetime
        await _write_result(supabase, job, result)
        return DispatchResult(outcome=DispatchOutcome.DONE)
    finally:
        await aclose_exchange(ctx.exchange)
