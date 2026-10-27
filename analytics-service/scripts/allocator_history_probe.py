"""Phase 167.2.1.1.2.1 TRADEPAGES probe (D-03, SC-3): how far does an allocator's stored
history sit from a correct re-read of the venue, and does OKX answer fills newest first?

WHY: the allocator history rebuild used to stop reading trades on a page shorter than
the limit it asked for, so a venue that caps a page below that limit (Bybit 100, OKX
100) was read for one page only. Plans 01-04 fix the loop. Before any rebuild runs, the
founder asked (D-03) for a measurement of the stored histories against a correct
re-read, as counts and sizes only. The probe also carries the live check of RESEARCH
A1 (OKX fills-history answers newest first), because the backward walk plan 02 builds
rests on it and plan 06 refuses every rebuild while it is unproven. Run it only after
plans 01-04 are merged and deployed: it measures whatever read is deployed.

WHAT IT DOES, per allocator account holding an active OKX or Bybit key, labelled
a1..aN by the account's earliest such key:
  1. chooses the members and the window exactly as a forced rebuild would
     (_read_account_keys, _select_account_crawl_keys, _account_rebuild_window), with
     the job key the post-deploy plan's forced job uses: the earliest-created working
     Bybit key, else the earliest-created working OKX key, else the earliest active
     OKX or Bybit key. A selection refusal is recorded by its closed-vocabulary token,
     before any decrypt for that account;
  2. re-reads each selected OKX or Bybit member through the rebuild's own read
     (_fetch_and_price_window, anchored), recording per call the row count, the
     distinct trade ids and the oldest timestamp, in memory only. The deposit and
     withdrawal calls of that same read are recorded too, and the account record counts
     the distinct transfer events stamped more than 365 days before the run date
     (``transfers_older_365d``): a 0 there beside a 729-day window means Bybit returned
     nothing that old OR the account has none that old, which this count alone cannot
     tell apart;
  3. compares the summed rebuilt curve with the stored one, but only when every
     exchange account the allocator holds is OKX, Bybit or Deribit (which the rebuild
     counts as $0) and every OKX or Bybit member was read: a stored row is the sum
     across all of the allocator's exchange accounts, so a mixed account (an MT5
     member is not read here) reports comparable false with its read counts;
  4. for each OKX member that read a row, makes ONE raw fills-history read on the
     instrument type that returned the most rows, to learn whether OKX answers newest
     first; and counts the OKX passes that ended on a full page without reaching their
     window start.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo): labels,
counts, booleans, closed-vocabulary tokens and 3-significant-figure ratios, and no
timestamp finer than the run date. No id, amount, venue text or key. The only path to
stdout is ``emit_record``, which refuses any key outside the declared records, any value
outside the declared vocabulary and any float not already rounded to three significant
figures, then re-checks with ``assert_sanitized``. Logging is switched off for the run.
A failed read is recorded by an allow-listed exception CLASS (a ccxt message can carry
a signed URL, an amount or an id), and a run-level failure prints the exception TYPE
only.

READ-ONLY: every database handle is a ``ReadOnlySupabase``, which exposes ``table`` and,
on a table, ``select`` only (every other attribute, ``rpc`` included, is an
AttributeError). That closes the one write hidden inside the rebuild's read, the price
cache write that runs on a BadSymbol fallback. The probe never calls the account crawl
(_crawl_account_key, _crawl_whole_account), the key preflight (_allocator_key_preflight,
whose circuit-breaker arm can write), the 429 stamp (_stamp_429) or any persist path
(replace_equity_snapshots, replace_equity_snapshots_window, persist_equity_snapshots),
and it names no venue write endpoint. A static pin in the tests proves it. Keys are
decrypted inside the worker process and nowhere else; one raw GET per OKX member is the
only venue call outside the rebuild's own read.

D-01 (Phase 171): WHICH LIMIT STOPPED A CUT-SHORT READ. For a member whose read was cut
short (``failure_class`` "truncated") the account record also names ``truncated_site`` (the
limit that stopped it), ``last_window_age_bucket`` (the age of the window it stopped in, in
a closed set of day ranges), ``last_window_calls`` (how many calls that window took) and
``read_elapsed_s`` (whole seconds the read ran, summed over the account's members), beside
the existing ``trade_calls``. The site is read from a typed ``site`` attribute on the raised
exception when one is present (a later plan of the phase adds it) and otherwise DERIVED from
the probe's own in-memory call log, because the reading is taken on the code deployed BEFORE
Phase 171 ships. Three derived tokens: ``bybit_window_ceiling`` (the last 7-day window took
exactly the rebuild's per-window page ceiling of calls and every page advanced),
``bybit_stalled_page`` (the last call was a full page that added no new fill, or returned the
cursor it was sent) and ``bybit_stalled_one_ms`` (that stalled page held fills of a single
millisecond). Anything else is ``unknown``. The stall is tested first because the deployed
read tests it before its ceiling branch. Every ``er`` name the probe reads is listed in
``DEPLOYED_ER_NAMES`` and ``run()`` refuses (exit 2, before any decrypt) when the rebuild
module it runs against lacks one, so this file can be run against older deployed code without
silently misrecording.

USAGE (run once on the worker after the deploy; it takes no arguments, so no identifier
is ever typed):
  railway ssh "cd /app && python -m scripts.allocator_history_probe"
Paste only the lines that start with ``{"`` (one per account, then one summary).

EXIT CODES
----------
  0  every selected OKX or Bybit member was read; one JSON line per account and a
     summary were printed. A selection refusal (a closed-vocabulary ``selection`` token
     on an account record) also exits 0, because no member was attempted and none
     failed. Read ``accounts_read`` and the summary totals ``trades_read`` and
     ``days_compared`` before taking a run as "no difference": 0 there means nothing was
     read or compared, not that the stored history is right
  1  any member read failed or was refused (printed as a record, after every account
     and the summary), or any other failure (the exception TYPE only on stderr)
  2  refused before any decrypt: no active ``okx`` or ``bybit`` key, or more accounts
     than a two-digit label carries
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import re
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from services import equity_reconstruction as er
from services.allocator_equity_derive import working_holder_predicate

# The failure classes this probe may print: the shared allow-list plus "truncated", a trade read
# cut short (er.TruncatedTradeRead), told apart from a venue rejection and from the two-year guard.
_FAILURE_CLASSES: tuple[str, ...] = (*FAILURE_CLASSES, "truncated")

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2

# The venues the probe reads. Anything else an account holds is counted, not read.
_PROBE_VENUES: tuple[str, ...] = ("okx", "bybit")

# The label a1..aN is two digits at most.
_MAX_ACCOUNTS = 99

# A stored day differs from the re-read when the two sums are further apart than this
# (the ACCTREBUILD B'5 convention, 2 dp storage).
_DIFF_THRESHOLD = 0.005

# OKX fills-history serves 100 rows a page; a pass whose last page is this full may have
# stopped with older rows unread.
_OKX_PAGE_ROWS = 100

# Bybit's execution-list page size (the rebuild sends it explicitly); a last call this full may
# have stopped with more fills unread.
_BYBIT_PAGE_ROWS = 100

_LABEL_RE = re.compile(r"^a[0-9]{1,2}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")

_SELECTION_TOKENS: tuple[str, ...] = ("ok", *sorted(er.FORCED_REBUILD_REFUSAL_REASONS))
_REFUSAL_TOKENS: tuple[str, ...] = ("none", *sorted(er.FORCED_REBUILD_REFUSAL_REASONS))

# D-01: the limit that stopped a cut-short read. "none" is an untruncated member; the three derived
# tokens are what the probe can tell from its own call log against the code deployed before this
# phase; the nine typed tokens are the sites the rebuild names once it carries a typed ``site``.
_TRUNCATED_SITES: tuple[str, ...] = (
    "none",
    "unknown",
    "bybit_window_ceiling",
    "bybit_stalled_page",
    "bybit_stalled_one_ms",
    "bybit_not_supported",
    "bybit_no_advance",
    "bybit_segment_ceiling",
    "okx_not_supported",
    "okx_no_advance",
    "okx_page_ceiling",
    "generic_not_supported",
    "generic_no_advance",
    "generic_page_ceiling",
)

# The age of a window's start at the run date, in whole days.
_WINDOW_AGE_BUCKETS: tuple[str, ...] = (
    "none",
    "0-29",
    "30-89",
    "90-179",
    "180-364",
    "365-546",
    "547-729",
    "730+",
)

# Every attribute the probe reads off the rebuild module. ``run()`` refuses before any decrypt when
# the module it runs against lacks one (see ``missing_deployed_names``).
DEPLOYED_ER_NAMES: tuple[str, ...] = (
    "FORCED_REBUILD_REFUSAL_REASONS",
    "ForcedRebuildRefusedError",
    "TruncatedTradeRead",
    "_BYBIT_WINDOW_PAGE_CEILING",
    "_RECONSTRUCT_CRAWL_TIMEOUT_S",
    "_account_rebuild_window",
    "_fetch_and_price_window",
    "_key_venue",
    "_read_account_keys",
    "_select_account_crawl_keys",
    "_sum_account_rows",
)

# The clock behind ``read_elapsed_s``; a seam so a test can set it.
_monotonic = time.monotonic

ACCOUNT_RECORD_KEYS: tuple[str, ...] = (
    "record",
    "account",
    "run_date",
    "selection",
    "okx_members",
    "bybit_members",
    "other_members",
    "zero_contribution_members",
    "window_days",
    "members_read",
    "members_failed",
    "failure_class",
    "member_refusal",
    "trade_calls",
    "trades_read",
    "first_page_rows",
    "okx_order_readings",
    "okx_order_violations",
    "okx_passes_ended_full",
    "comparable",
    "stored_days",
    "rebuilt_days",
    "days_compared",
    "days_differing",
    "max_rel_diff",
    "days_incomplete",
    "transfers_older_365d",
    "truncated_site",
    "last_window_age_bucket",
    "last_window_calls",
    "read_elapsed_s",
)
SUMMARY_RECORD_KEYS: tuple[str, ...] = (
    "record",
    "run_date",
    "accounts",
    "accounts_read",
    "accounts_comparable",
    "accounts_trades_beyond_first_page",
    "accounts_differing",
    "trades_read",
    "days_compared",
    "okx_order_violations",
    "okx_passes_ended_full",
)


# ---------------------------------------------------------------------------
# Whitelist emitter. The ONLY path to stdout.
# ---------------------------------------------------------------------------


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x


def _is_ratio(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


_ACCOUNT_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("account",)),
    "account": _is_str_matching(_LABEL_RE),
    "run_date": _is_str_matching(_DATE_RE),
    "selection": _is_one_of(_SELECTION_TOKENS),
    "okx_members": _is_count,
    "bybit_members": _is_count,
    "other_members": _is_count,
    "zero_contribution_members": _is_count,
    "window_days": _is_count_or_absent,
    "members_read": _is_count,
    "members_failed": _is_count,
    "failure_class": _is_one_of(_FAILURE_CLASSES),
    "member_refusal": _is_one_of(_REFUSAL_TOKENS),
    "trade_calls": _is_count,
    "trades_read": _is_count,
    "first_page_rows": _is_count,
    "okx_order_readings": _is_count,
    "okx_order_violations": _is_count,
    "okx_passes_ended_full": _is_count,
    "comparable": _is_bool,
    "stored_days": _is_count,
    "rebuilt_days": _is_count,
    "days_compared": _is_count,
    "days_differing": _is_count,
    "max_rel_diff": _is_ratio,
    "days_incomplete": _is_count,
    "transfers_older_365d": _is_count,
    "truncated_site": _is_one_of(_TRUNCATED_SITES),
    "last_window_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
    "last_window_calls": _is_count,
    "read_elapsed_s": _is_count,
}

_SUMMARY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("summary",)),
    "run_date": _is_str_matching(_DATE_RE),
    "accounts": _is_count,
    "accounts_read": _is_count,
    "accounts_comparable": _is_count,
    "accounts_trades_beyond_first_page": _is_count,
    "accounts_differing": _is_count,
    "trades_read": _is_count,
    "days_compared": _is_count,
    "okx_order_violations": _is_count,
    "okx_passes_ended_full": _is_count,
}


def _check_keys(path: str, got: Mapping[str, Any], want: Sequence[str]) -> None:
    extra = sorted(set(got) - set(want))
    missing = sorted(set(want) - set(got))
    if extra or missing:
        raise ValueError(f"{path}: keys differ from the whitelist extra={extra} missing={missing}")


def validate_record(record: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` unless ``record`` is exactly the declared vocabulary.

    The message names the PATH of the offending entry and never its value: an
    unredacted amount must not leak through its own rejection."""
    if not isinstance(record, Mapping):
        raise ValueError("record: not a mapping")
    kind = record.get("record")
    if kind == "account":
        want, validators = ACCOUNT_RECORD_KEYS, _ACCOUNT_VALIDATORS
    elif kind == "summary":
        want, validators = SUMMARY_RECORD_KEYS, _SUMMARY_VALIDATORS
    else:
        raise ValueError("record.record: value outside the declared vocabulary")
    _check_keys("record", record, want)
    for key, check in validators.items():
        if not check(record[key]):
            raise ValueError(f"record.{key}: value outside the declared vocabulary")
    assert_sanitized(dict(record))


def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)


# ---------------------------------------------------------------------------
# Read-only database handle.
# ---------------------------------------------------------------------------


class _ReadOnlyTable:
    """A table handle that can select and nothing else."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def select(self, *args: Any, **kwargs: Any) -> Any:
        return self._inner.select(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)


class ReadOnlySupabase:
    """A database client for the probe that cannot write.

    ``table(name)`` hands out a handle exposing ``select`` only; every other attribute of
    the client or of a table handle, ``rpc`` included, is an ``AttributeError``. It is
    passed to the rebuild's own read, whose only write (the price cache on a BadSymbol
    fallback) then fails inside its own caught exception instead of reaching PROD."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def table(self, name: str) -> _ReadOnlyTable:
        return _ReadOnlyTable(self._inner.table(name))

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)


# ---------------------------------------------------------------------------
# Pure layer: what the recorded calls, the raw OKX answer and the two curves say.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Call:
    """One recorded ``fetch_my_trades`` call. Ids and timestamps stay in memory."""

    since: int | None
    params: dict[str, Any]
    rows: int
    ids: tuple[tuple[Any, str], ...]
    rows_without_id: int
    oldest_ts: int | None
    newest_ts: int | None = None
    cursor_repeated: bool = False


def _as_int(raw: Any) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float) and raw == raw and abs(raw) != float("inf"):
        return int(raw)
    return None


def _page_cursor(rows: Sequence[Mapping[str, Any]]) -> str | None:
    """The Bybit ``nextPageCursor`` left on a row's ``info``, read as the rebuild reads it. Only
    compared with the cursor the call was sent; the text is never stored."""
    for row in rows:
        info = row.get("info")
        if isinstance(info, Mapping) and info.get("nextPageCursor"):
            return str(info["nextPageCursor"])
    return None


def _describe_call(args: tuple[Any, ...], kwargs: Mapping[str, Any], page: Any) -> _Call:
    since = args[1] if len(args) > 1 else kwargs.get("since")
    params = args[3] if len(args) > 3 else kwargs.get("params")
    rows = [t for t in (page or []) if isinstance(t, Mapping)]
    ids = tuple((t.get("symbol"), str(t["id"])) for t in rows if t.get("id") is not None)
    stamps = [s for s in (_as_int(t.get("timestamp")) for t in rows) if s is not None]
    sent = params.get("cursor") if isinstance(params, Mapping) else None
    returned = _page_cursor(rows)
    return _Call(
        since=_as_int(since),
        params=dict(params) if isinstance(params, Mapping) else {},
        rows=len(rows),
        ids=ids,
        rows_without_id=sum(1 for t in rows if t.get("id") is None),
        oldest_ts=min(stamps) if stamps else None,
        newest_ts=max(stamps) if stamps else None,
        cursor_repeated=returned is not None and sent is not None and returned == str(sent),
    )


class _TradeRecorder:
    """Wraps a client's ``fetch_my_trades`` so every call is recorded, in memory only,
    and the answer is handed back unchanged."""

    def __init__(self, client: Any) -> None:
        self.calls: list[_Call] = []
        original = client.fetch_my_trades

        async def _recorded(*args: Any, **kwargs: Any) -> Any:
            page = await original(*args, **kwargs)
            self.calls.append(_describe_call(args, kwargs, page))
            return page

        client.fetch_my_trades = _recorded

        # The rebuild's own transfer read, recorded the same way: (kind, id, timestamp).
        self.transfers: list[tuple[str, Any, int | None]] = []
        for kind, name in (("deposits", "fetch_deposits"), ("withdrawals", "fetch_withdrawals")):
            fetcher = getattr(client, name, None)
            if fetcher is not None:
                setattr(client, name, self._recording_transfers(kind, fetcher))

    def _recording_transfers(self, kind: str, fetcher: Any) -> Callable[..., Any]:
        async def _recorded_transfers(*args: Any, **kwargs: Any) -> Any:
            page = await fetcher(*args, **kwargs)
            for row in page or []:
                if isinstance(row, Mapping):
                    self.transfers.append((kind, row.get("id"), _as_int(row.get("timestamp"))))
            return page

        return _recorded_transfers


def trades_read(calls: Sequence[_Call]) -> int:
    """Distinct (symbol, id) fills across the calls; a row without an id counts once each.
    The key carries the symbol because OKX numbers ``tradeId`` per instrument."""
    seen: set[tuple[Any, str]] = set()
    no_id = 0
    for call in calls:
        seen |= set(call.ids)
        no_id += call.rows_without_id
    return len(seen) + no_id


def transfers_older_than(transfers: Sequence[tuple[str, Any, int | None]], cutoff_ms: int) -> int:
    """Distinct transfer events stamped before ``cutoff_ms``: a (kind, id) pair counts once
    however many overlapping windows returned it; an event without an id counts each time."""
    seen: set[tuple[str, str]] = set()
    no_id = 0
    for kind, transfer_id, stamp in transfers:
        if stamp is None or stamp >= cutoff_ms:
            continue
        if transfer_id is None:
            no_id += 1
        else:
            seen.add((kind, str(transfer_id)))
    return len(seen) + no_id


def _passes(calls: Sequence[_Call]) -> dict[Any, list[_Call]]:
    """The calls grouped by the ``type`` param (an OKX instrument-type pass), in order."""
    grouped: dict[Any, list[_Call]] = {}
    for call in calls:
        grouped.setdefault(call.params.get("type"), []).append(call)
    return grouped


def first_page_rows(venue: str, calls: Sequence[_Call]) -> int:
    """What the old loop kept. Bybit: the rows of the first call. OKX: the rows of each
    pass's first call (the call without ``until``, else the pass's first), summed."""
    if venue != "okx":
        return calls[0].rows if calls else 0
    total = 0
    for pass_calls in _passes(calls).values():
        first = next((c for c in pass_calls if "until" not in c.params), pass_calls[0])
        total += first.rows
    return total


def okx_passes_ended_full(calls: Sequence[_Call]) -> int:
    """OKX passes whose last call returned a full page while its oldest row is still newer
    than that call's ``since``: the walk stopped with the window start unreached."""
    count = 0
    for pass_calls in _passes(calls).values():
        last = pass_calls[-1]
        if (
            last.rows >= _OKX_PAGE_ROWS
            and last.oldest_ts is not None
            and last.since is not None
            and last.oldest_ts > last.since
        ):
            count += 1
    return count


def window_age_bucket(since_ms: int | None, run_day: date) -> str:
    """The closed age bucket of a window start: whole days from ``since_ms`` to the run day's
    UTC midnight. ``None`` (no start known) is "none"."""
    if since_ms is None:
        return "none"
    days = max(0, (_day_ms(run_day) - since_ms) // 86_400_000)
    for upper, token in ((30, "0-29"), (90, "30-89"), (180, "90-179"), (365, "180-364")):
        if days < upper:
            return token
    if days < 547:
        return "365-546"
    return "547-729" if days < 730 else "730+"


def last_window_calls(calls: Sequence[_Call]) -> int:
    """How many trailing calls share the last call's ``since``: one Bybit window is read with
    the same start on every call, so this is the call count of the window the read stopped in."""
    if not calls:
        return 0
    count = 0
    for call in reversed(calls):
        if call.since != calls[-1].since:
            break
        count += 1
    return count


def derive_truncated_site(venue: str, calls: Sequence[_Call]) -> str:
    """Which limit stopped a Bybit read, told from the call log alone (the code deployed before
    Phase 171 carries no typed site). The stall is tested first because the deployed read tests
    it before its page-ceiling branch, so a 100th call that stalls is the stall. A full last page
    is a stall when it added no fill an earlier call had not already returned (the deployed
    ``seen`` set spans the whole read) or returned the cursor it was sent. Anything the log
    cannot tell is "unknown"."""
    if venue != "bybit":
        return "unknown"
    window = list(calls)[len(calls) - last_window_calls(calls) :]
    if not window:
        return "unknown"
    last = window[-1]
    if last.rows >= _BYBIT_PAGE_ROWS:
        earlier: set[tuple[Any, str]] = set()
        for call in calls[:-1]:
            earlier |= set(call.ids)
        added = last.rows_without_id > 0 or any(i not in earlier for i in last.ids)
        if not added or last.cursor_repeated:
            return "bybit_stalled_one_ms" if last.oldest_ts == last.newest_ts else "bybit_stalled_page"
    if len(window) == er._BYBIT_WINDOW_PAGE_CEILING:
        return "bybit_window_ceiling"
    return "unknown"


def truncated_site_of(exc: BaseException, venue: str, calls: Sequence[_Call]) -> str:
    """The typed ``site`` the rebuild put on the exception when it carries one, else the site
    derived from the call log. A typed site outside the declared tokens is "unknown": vocabulary
    drift must not be mapped onto a derived answer."""
    typed = getattr(exc, "site", None)
    if isinstance(typed, str):
        return typed if typed in _TRUNCATED_SITES else "unknown"
    return derive_truncated_site(venue, calls)


def missing_deployed_names() -> list[str]:
    """The ``DEPLOYED_ER_NAMES`` the rebuild module this probe runs against does not define."""
    return [name for name in DEPLOYED_ER_NAMES if not hasattr(er, name)]


def _busiest_inst_type(calls: Sequence[_Call]) -> str | None:
    """The instrument type of the pass that returned the most rows, upper-cased."""
    best: str | None = None
    best_rows = 0
    for kind, pass_calls in _passes(calls).items():
        rows = sum(c.rows for c in pass_calls)
        if isinstance(kind, str) and rows > best_rows:
            best, best_rows = kind.upper(), rows
    return best


def okx_newest_first(raw: Any) -> bool | str:
    """Does an OKX fills-history answer list its rows newest first?

    ``True`` when the ``ts`` values never increase and the first is later than the last,
    ``False`` when they rise anywhere, and ``field-absent`` when the answer cannot say:
    not a mapping, no ``data`` list, fewer than two rows, a ``ts`` that is not a number,
    or equal timestamps throughout."""
    data = raw.get("data") if isinstance(raw, Mapping) else None
    if not isinstance(data, list) or len(data) < 2:
        return FIELD_ABSENT
    stamps: list[int] = []
    for row in data:
        value = row.get("ts") if isinstance(row, Mapping) else None
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return FIELD_ABSENT
        try:
            stamps.append(int(value))
        except ValueError:
            return FIELD_ABSENT
    if all(s == stamps[0] for s in stamps):
        return FIELD_ABSENT
    if any(later > earlier for earlier, later in zip(stamps, stamps[1:])):
        return False
    return True


def compare_days(
    stored: Mapping[str, float], rebuilt: Mapping[str, float]
) -> tuple[int, int, float | str]:
    """(days in both, days that differ, largest relative difference to 3 figures).

    A day differs when the two sums are further apart than ``_DIFF_THRESHOLD``. The
    relative difference is taken against the stored value over the days whose stored
    value is not 0; with no such day it reads ``field-absent``, never 0."""
    common = sorted(set(stored) & set(rebuilt))
    differing = 0
    largest: float | None = None
    for day in common:
        diff = abs(rebuilt[day] - stored[day])
        if diff > _DIFF_THRESHOLD:
            differing += 1
        if stored[day] != 0:
            rel = diff / abs(stored[day])
            largest = rel if largest is None or rel > largest else largest
    ratio: float | str = FIELD_ABSENT
    if largest is not None:
        shown = sig3(largest)
        ratio = shown if isinstance(shown, float) else FIELD_ABSENT
    return len(common), differing, ratio


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _day_ms(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


# ---------------------------------------------------------------------------
# I/O layer. Select reads and venue GETs only.
# ---------------------------------------------------------------------------


@dataclass
class _MemberResult:
    read: bool
    failure_class: str = "none"
    refusal: str = "none"
    rows: list[dict[str, Any]] = field(default_factory=list)
    calls: list[_Call] = field(default_factory=list)
    transfers: list[tuple[str, Any, int | None]] = field(default_factory=list)
    order: bool | str | None = None  # None: no raw ordering read was made
    truncated_site: str = "none"
    last_window_age_bucket: str = "none"
    last_window_calls: int = 0
    elapsed_s: int = 0


async def _read_member(
    client: Any,
    venue: str,
    supabase: ReadOnlySupabase,
    window_start: date,
    end_date: date,
    recorder: _TradeRecorder,
) -> tuple[list[dict[str, Any]], bool | str | None]:
    """The rebuild's own read, then (OKX only) one raw ordering read."""
    rows, _hit_terminus, _telemetry = await er._fetch_and_price_window(
        client, venue, supabase, window_start, end_date, require_anchor=True
    )
    order: bool | str | None = None
    inst_type = _busiest_inst_type(recorder.calls) if venue == "okx" else None
    if inst_type is not None:
        raw = await client.private_get_trade_fills_history(
            {
                "instType": inst_type,
                "begin": str(_day_ms(window_start)),
                "end": str(_day_ms(end_date + timedelta(days=1))),
                "limit": str(_OKX_PAGE_ROWS),
            }
        )
        order = okx_newest_first(raw)
    return rows, order


async def _probe_member(
    credentials_row: Mapping[str, Any] | None,
    venue: str,
    supabase: ReadOnlySupabase,
    kek: bytes,
    window_start: date,
    end_date: date,
) -> _MemberResult:
    """Decrypt, build the client, read the window, close the client. A failure is
    recorded by CLASS (or, for a rebuild refusal, by its token); the message is never read."""
    from services.encryption import decrypt_credentials
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    client: Any = None
    recorder: _TradeRecorder | None = None
    started: float | None = None

    def _elapsed() -> int:
        return 0 if started is None else max(0, int(_monotonic() - started))

    try:
        if credentials_row is None:
            raise LookupError("selected member is not among the active keys read")
        api_key, api_secret, passphrase = decrypt_credentials(dict(credentials_row), kek)
        client = _make_exchange_client(venue, api_key, api_secret, passphrase)
        recorder = _TradeRecorder(client)
        started = _monotonic()
        rows, order = await asyncio.wait_for(
            _read_member(client, venue, supabase, window_start, end_date, recorder),
            er._RECONSTRUCT_CRAWL_TIMEOUT_S,
        )
        return _MemberResult(
            read=True,
            rows=rows,
            calls=recorder.calls,
            transfers=recorder.transfers,
            order=order,
            elapsed_s=_elapsed(),
        )
    except er.ForcedRebuildRefusedError as exc:
        calls = recorder.calls if recorder is not None else []
        moved = recorder.transfers if recorder is not None else []
        if exc.reason in er.FORCED_REBUILD_REFUSAL_REASONS:
            return _MemberResult(
                read=False, refusal=exc.reason, calls=calls, transfers=moved, elapsed_s=_elapsed()
            )
        return _MemberResult(
            read=False, failure_class="other", calls=calls, transfers=moved, elapsed_s=_elapsed()
        )
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        calls = recorder.calls if recorder is not None else []
        moved = recorder.transfers if recorder is not None else []
        truncated = isinstance(exc, er.TruncatedTradeRead)
        return _MemberResult(
            read=False,
            failure_class="truncated" if truncated else classify_failure(exc),
            calls=calls,
            transfers=moved,
            truncated_site=truncated_site_of(exc, venue, calls) if truncated else "none",
            last_window_age_bucket=(
                window_age_bucket(calls[-1].since if calls else None, end_date) if truncated else "none"
            ),
            last_window_calls=last_window_calls(calls) if truncated else 0,
            elapsed_s=_elapsed(),
        )
    finally:
        if client is not None:
            await aclose_exchange(client)


def choose_job_key(account_rows: Sequence[Mapping[str, Any]]) -> str:
    """The key id a forced rebuild of this account would be queued on: the earliest-created
    working Bybit key, else the earliest-created working OKX key, else the earliest active
    OKX or Bybit key. ``account_rows`` is in ``created_at`` order."""
    for venue in ("bybit", "okx"):
        for row in account_rows:
            if er._key_venue(row) == venue and working_holder_predicate(row):
                return str(row["id"])
    return str(account_rows[0]["id"])


async def _stored_curve(
    supabase: ReadOnlySupabase, allocator_id: str, window_start: date
) -> dict[str, float]:
    """The stored ``asof -> value_usd`` of one allocator from the window start on."""
    from services.db import db_execute, rows

    def _load() -> Any:
        return (
            supabase.table("allocator_equity_snapshots")
            .select("asof, value_usd")
            .eq("allocator_id", allocator_id)
            .gte("asof", window_start.isoformat())
            .execute()
        )

    return {str(r["asof"]): float(r["value_usd"]) for r in rows(await db_execute(_load))}


def _account_record(label: str, run_date: str, **values: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "record": "account",
        "account": label,
        "run_date": run_date,
        "selection": "ok",
        "okx_members": 0,
        "bybit_members": 0,
        "other_members": 0,
        "zero_contribution_members": 0,
        "window_days": FIELD_ABSENT,
        "members_read": 0,
        "members_failed": 0,
        "failure_class": "none",
        "member_refusal": "none",
        "trade_calls": 0,
        "trades_read": 0,
        "first_page_rows": 0,
        "okx_order_readings": 0,
        "okx_order_violations": 0,
        "okx_passes_ended_full": 0,
        "comparable": False,
        "stored_days": 0,
        "rebuilt_days": 0,
        "days_compared": 0,
        "days_differing": 0,
        "max_rel_diff": FIELD_ABSENT,
        "days_incomplete": 0,
        "transfers_older_365d": 0,
        "truncated_site": "none",
        "last_window_age_bucket": "none",
        "last_window_calls": 0,
        "read_elapsed_s": 0,
    }
    return {**record, **values}


async def _probe_account(
    label: str,
    allocator_id: str,
    account_rows: Sequence[Mapping[str, Any]],
    supabase: ReadOnlySupabase,
    kek: bytes,
    run_date: str,
    end_date: date,
) -> dict[str, Any]:
    """Select, window, re-read and compare ONE account, exactly as a forced rebuild would
    choose its members and window. Nothing is written."""
    job_key_id = choose_job_key(account_rows)
    try:
        account_keys = await er._read_account_keys(supabase, allocator_id, job_key_id)
        selected, zero_contribution = er._select_account_crawl_keys(account_keys, job_key_id)
    except er.ForcedRebuildRefusedError as exc:
        # An out-of-vocabulary reason is refused by the emitter, loudly, not mapped.
        return _account_record(label, run_date, selection=exc.reason)

    window_start, window_days = er._account_rebuild_window(selected, end_date)
    venues = [er._key_venue(member) for member in selected]
    credentials = {str(row["id"]): row for row in account_rows}

    results: list[_MemberResult] = []
    venue_of: list[str] = []
    for member, venue in zip(selected, venues):
        if venue not in _PROBE_VENUES:
            continue
        results.append(
            await _probe_member(
                credentials.get(str(member.get("id"))), venue, supabase, kek, window_start, end_date
            )
        )
        venue_of.append(venue)

    failed = [r for r in results if not r.read]
    first_failure = next((r for r in failed if r.failure_class != "none"), None)
    readings = [r.order for r in results if isinstance(r.order, bool)]
    record = _account_record(
        label,
        run_date,
        okx_members=venues.count("okx"),
        bybit_members=venues.count("bybit"),
        other_members=sum(1 for v in venues if v not in _PROBE_VENUES),
        zero_contribution_members=zero_contribution,
        window_days=window_days,
        members_read=len(results) - len(failed),
        members_failed=len(failed),
        failure_class=first_failure.failure_class if first_failure is not None else "none",
        member_refusal=next((r.refusal for r in failed if r.refusal != "none"), "none"),
        trade_calls=sum(len(r.calls) for r in results),
        trades_read=sum(trades_read(r.calls) for r in results),
        first_page_rows=sum(first_page_rows(v, r.calls) for v, r in zip(venue_of, results)),
        okx_order_readings=len(readings),
        okx_order_violations=sum(1 for ok in readings if ok is False),
        okx_passes_ended_full=sum(
            okx_passes_ended_full(r.calls) for v, r in zip(venue_of, results) if v == "okx"
        ),
        transfers_older_365d=sum(
            transfers_older_than(r.transfers, _day_ms(end_date - timedelta(days=365)))
            for r in results
        ),
        truncated_site=first_failure.truncated_site if first_failure is not None else "none",
        last_window_age_bucket=(
            first_failure.last_window_age_bucket if first_failure is not None else "none"
        ),
        last_window_calls=first_failure.last_window_calls if first_failure is not None else 0,
        read_elapsed_s=sum(r.elapsed_s for r in results),
    )

    comparable = bool(results) and not failed and len(results) == len(selected)
    comparison: dict[str, Any] = {}
    if comparable:
        summed, days_incomplete = er._sum_account_rows([r.rows for r in results])
        stored = await _stored_curve(supabase, allocator_id, window_start)
        rebuilt = {str(row["asof"]): float(row["value_usd"]) for row in summed}
        compared, differing, largest = compare_days(stored, rebuilt)
        comparison = {
            "stored_days": len(stored),
            "rebuilt_days": len(rebuilt),
            "days_compared": compared,
            "days_differing": differing,
            "max_rel_diff": largest,
            "days_incomplete": days_incomplete,
        }
    return {**record, "comparable": comparable, **comparison}


def summarize(records: Sequence[Mapping[str, Any]], run_date: str) -> dict[str, Any]:
    """The summary line: counts only."""
    return {
        "record": "summary",
        "run_date": run_date,
        "accounts": len(records),
        "accounts_read": sum(
            1
            for r in records
            if r["selection"] == "ok" and r["members_failed"] == 0 and r["members_read"] > 0
        ),
        "accounts_comparable": sum(1 for r in records if r["comparable"] is True),
        "accounts_trades_beyond_first_page": sum(
            1 for r in records if r["trades_read"] > r["first_page_rows"]
        ),
        "accounts_differing": sum(
            1 for r in records if r["comparable"] is True and r["days_differing"] > 0
        ),
        "trades_read": sum(r["trades_read"] for r in records),
        "days_compared": sum(r["days_compared"] for r in records),
        "okx_order_violations": sum(r["okx_order_violations"] for r in records),
        "okx_passes_ended_full": sum(r["okx_passes_ended_full"] for r in records),
    }


async def run() -> int:
    """Select the active OKX / Bybit keys, refuse before any decrypt, then measure each
    account in ``created_at`` order and print one JSON line per account and a summary."""
    from services.db import db_execute, get_supabase, rows
    from services.encryption import get_kek

    missing = missing_deployed_names()
    if missing:
        print(
            f"refused: the deployed rebuild lacks {len(missing)} name(s) this probe reads",
            file=sys.stderr,
        )
        return EXIT_REFUSED

    supabase = ReadOnlySupabase(get_supabase())

    def _load_keys() -> Any:
        return (
            supabase.table("api_keys")
            .select("*")
            .in_("exchange", list(_PROBE_VENUES))
            .eq("is_active", True)
            .order("created_at")
            .execute()
        )

    key_rows = rows(await db_execute(_load_keys))
    if not key_rows:
        print("refused: no active okx or bybit key", file=sys.stderr)
        return EXIT_REFUSED
    accounts: dict[str, list[dict[str, Any]]] = {}
    for key_row in key_rows:
        accounts.setdefault(str(key_row.get("user_id")), []).append(key_row)
    if len(accounts) > _MAX_ACCOUNTS:
        print("refused: more accounts than the label can carry", file=sys.stderr)
        return EXIT_REFUSED

    kek = get_kek()
    end_date = _utc_today()
    run_date = end_date.strftime("%Y-%m-%d")
    records: list[dict[str, Any]] = []
    for index, (allocator_id, account_rows) in enumerate(accounts.items(), start=1):
        record = await _probe_account(
            f"a{index}", allocator_id, account_rows, supabase, kek, run_date, end_date
        )
        records.append(record)
        print(emit_record(record), flush=True)
    print(emit_record(summarize(records, run_date)), flush=True)
    return EXIT_FAILED if any(r["members_failed"] > 0 for r in records) else EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="TRADEPAGES read-only allocator history probe (takes no arguments)"
    )
    parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
