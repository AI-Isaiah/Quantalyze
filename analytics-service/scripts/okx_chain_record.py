"""The chain diagnostic's record (Phase 179 OKXBILLSCHAIN, plan 01).

WHY: when the bills oracle refuses an OKX member with ``chain_break``, the allocator history
probe prints WHY, as the ``chain_*`` keys this module declares. The probe's output is pasted
into a tracked file in a public repo, so every value here is a count, a boolean, a closed
token or ``field-absent``: no amount, no bill id, no free ticker, no venue text. The exact
arithmetic lives in ``services/okx_bills_chain.py``; every decision about what may be PRINTED
lives here. The probe splices ``CHAIN_KEYS``, ``CHAIN_VALIDATORS`` and ``chain_defaults()``
into its three record structures as their last entries, and calls ``measure_chain`` once,
after the oracle has refused with ``chain_break``.

"Not measured" is ``field-absent``, never 0 or False: a 0 here would read as a clean chain.
This module imports nothing from the probe (the probe imports this one).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import date
from decimal import Decimal
from typing import Any

from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure
from services import okx_bills_chain as chain
from services import okx_opening_balance as obal
from services.closed_sets import STABLECOINS

logger = logging.getLogger(__name__)


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_bool_or_absent(x: Any) -> bool:
    return _is_bool(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


def _is_one_of_or_absent(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and (x in allowed or x == FIELD_ABSENT)


def _is_full_match_or_absent(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and (x == FIELD_ABSENT or pattern.fullmatch(x) is not None)


#: The arm that broke, over every currency. ``diverged`` is not an arm: the oracle refused with
#: ``chain_break`` and the re-fold of the same bills found no break (a defect to see, never ``none``).
_ARMS: tuple[str, ...] = ("none", "interior", "close", "both", "diverged")

#: The step a failure belongs to: nothing failed, the pure analysis, or one of the venue groups.
_STEPS: tuple[str, ...] = ("none", "analysis", "close", "repeat", "below_stop", "recent", "sweep")

#: The second walk's chain verdict: not run, a chain that holds, or one of the oracle's reasons.
_REPEAT_REASONS: tuple[str, ...] = ("not-run", "none", *sorted(obal.OPENING_UNAVAILABLE_REASONS))

#: The failure classes a chain step may record: the probe's own, plus ``malformed_data`` for a row
#: or balance OKX served that the oracle's parser refused (a fact about the data, not a venue fault
#: and not a defect in this diagnostic, which stays ``other``).
_FAILURE_CLASSES: tuple[str, ...] = (*FAILURE_CLASSES, "malformed_data")

#: The currency classes the record may name. A free ticker never reaches the record: the
#: closed vocabulary is the one the probe's redaction contract already carries.
_CCY_CLASSES: tuple[str, ...] = ("none", *sorted(STABLECOINS), "BTC", "ETH", "OKB", "other")
_NAMED_NON_STABLE: frozenset[str] = frozenset({"BTC", "ETH", "OKB"})

#: A bill kind prints as ``T.S.I:n``: T and S are OKX's numeric type and subType codes (at most
#: four digits, else ``x``) and I a closed instType (``blank`` for a transfer, else ``x``). Counts
#: are capped at six digits, so no run of ten digits and no amount can pass the grammar.
_INST_TYPES: tuple[str, ...] = ("SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION", "EVENTS")
_MGN_MODES: tuple[str, ...] = ("isolated", "cross", "cash")
_KIND_CAP = 5
_COUNT_CAP = 999_999
_CODE = r"(?:[0-9]{1,4}|x)"
_COUNT = r"[0-9]{1,6}"
_KIND_ENTRY = rf"{_CODE}\.{_CODE}\.(?:{'|'.join(_INST_TYPES)}|blank|x):{_COUNT}"
_KIND_LIST_RE = re.compile(rf"none|{_KIND_ENTRY}(?:,{_KIND_ENTRY}){{0,{_KIND_CAP - 1}}}(?:,other:{_COUNT})?")
_MGN_ENTRY = rf"(?:{'|'.join(_MGN_MODES)}|blank|x):{_COUNT}"
_MGN_LIST_RE = re.compile(rf"none|{_MGN_ENTRY}(?:,{_MGN_ENTRY}){{0,{_KIND_CAP - 1}}}(?:,other:{_COUNT})?")

#: The relative residual's decade, by STRICT less-than against an exact Decimal edge.
_RESIDUAL_EDGES: tuple[tuple[Decimal, str], ...] = (
    (Decimal("1e-12"), "lt_1e-12"),
    (Decimal("1e-9"), "lt_1e-9"),
    (Decimal("1e-6"), "lt_1e-6"),
    (Decimal("1e-3"), "lt_1e-3"),
    (Decimal("1e-1"), "lt_1e-1"),
)
_RESIDUAL_BUCKETS: tuple[str, ...] = ("none", *(label for _, label in _RESIDUAL_EDGES), "ge_1e-1")

#: A break's age (ms) against the newest walked bill, by STRICT less-than.
_AGE_EDGES: tuple[tuple[int, str], ...] = (
    (3_600_000, "lt_1h"),
    (86_400_000, "lt_1d"),
    (604_800_000, "lt_7d"),
    (2_592_000_000, "lt_30d"),
)
_AGE_BUCKETS: tuple[str, ...] = ("none", *(label for _, label in _AGE_EDGES), "ge_30d")

#: How far the 7-day store's newest bill is ahead of the walk's newest (ms), by STRICT less-than.
_LAG_EDGES: tuple[tuple[int, str], ...] = (
    (60_000, "lt_1m"),
    (600_000, "lt_10m"),
    (3_600_000, "lt_1h"),
    (86_400_000, "lt_1d"),
)
_LAG_BUCKETS: tuple[str, ...] = ("none", *(label for _, label in _LAG_EDGES), "ge_1d")

CHAIN_KEYS: tuple[str, ...] = (
    "chain_diagnostic",
    "chain_diagnostic_failure_class",
    "chain_failed_step",
    "chain_arm",
    "chain_ccys_checked",
    "chain_ccys_interior_broken",
    "chain_ccys_close_broken",
    "chain_interior_links",
    "chain_interior_breaks",
    "chain_worst_ccy",
    "chain_worst_ccy_is_stable",
    "chain_close_cash_moved",
    "chain_close_matches_after",
    "chain_calls",
    "chain_break_kinds",
    "chain_break_prev_kinds",
    "chain_break_mgn_modes",
    "chain_break_pos_level",
    "chain_residual_bucket",
    "chain_close_residual_bucket",
    "chain_sig_bal_unchanged",
    "chain_sig_double_count",
    "chain_sig_reorder",
    "chain_sig_other",
    "chain_billid_ts_inversions",
    "chain_same_ts_links",
    "chain_same_ts_breaks",
    "chain_trail_ccys",
    "chain_closes_by_ts_id",
    "chain_closes_by_ts_id_desc",
    "chain_gap_estimate",
    "chain_first_break_age",
    "chain_last_break_age",
    "chain_breaks_in_recent_7d",
    "chain_close_bill_after_utime",
    "chain_close_utime_after_bill",
    "chain_repeat_reason",
    "chain_below_stop",
    "chain_below_stop_ccys",
    "chain_below_stop_complete",
    "chain_ceiling_hit",
    "chain_recent_read",
    "chain_recent_complete",
    "chain_recent_both",
    "chain_recent_only_bills",
    "chain_recent_after_walk",
    "chain_recent_only_archive",
    "chain_recent_field_mismatch",
    "chain_recent_only_bills_kinds",
    "chain_archive_behind",
    "chain_types_probed",
    "chain_types_hidden",
    "chain_inst_types_probed",
    "chain_inst_types_hidden",
    "chain_hidden_kinds",
    "chain_sweep_partial",
    "chain_sweep_complete",
    "chain_recent_refused",
    "chain_sweep_refused",
)

CHAIN_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "chain_diagnostic": _is_one_of(("not-run", "run", "failed")),
    "chain_diagnostic_failure_class": _is_one_of(_FAILURE_CLASSES),
    "chain_failed_step": _is_one_of(_STEPS),
    "chain_arm": _is_one_of_or_absent(_ARMS),
    "chain_ccys_checked": _is_count_or_absent,
    "chain_ccys_interior_broken": _is_count_or_absent,
    "chain_ccys_close_broken": _is_count_or_absent,
    "chain_interior_links": _is_count_or_absent,
    "chain_interior_breaks": _is_count_or_absent,
    "chain_worst_ccy": _is_one_of_or_absent(_CCY_CLASSES),
    "chain_worst_ccy_is_stable": _is_bool_or_absent,
    "chain_close_cash_moved": _is_count_or_absent,
    "chain_close_matches_after": _is_count_or_absent,
    "chain_calls": _is_count_or_absent,
    "chain_break_kinds": _is_full_match_or_absent(_KIND_LIST_RE),
    "chain_break_prev_kinds": _is_full_match_or_absent(_KIND_LIST_RE),
    "chain_break_mgn_modes": _is_full_match_or_absent(_MGN_LIST_RE),
    "chain_break_pos_level": _is_count_or_absent,
    "chain_residual_bucket": _is_one_of_or_absent(_RESIDUAL_BUCKETS),
    "chain_close_residual_bucket": _is_one_of_or_absent(_RESIDUAL_BUCKETS),
    "chain_sig_bal_unchanged": _is_count_or_absent,
    "chain_sig_double_count": _is_count_or_absent,
    "chain_sig_reorder": _is_count_or_absent,
    "chain_sig_other": _is_count_or_absent,
    "chain_billid_ts_inversions": _is_count_or_absent,
    "chain_same_ts_links": _is_count_or_absent,
    "chain_same_ts_breaks": _is_count_or_absent,
    "chain_trail_ccys": _is_count_or_absent,
    "chain_closes_by_ts_id": _is_count_or_absent,
    "chain_closes_by_ts_id_desc": _is_count_or_absent,
    "chain_gap_estimate": _is_count_or_absent,
    "chain_first_break_age": _is_one_of_or_absent(_AGE_BUCKETS),
    "chain_last_break_age": _is_one_of_or_absent(_AGE_BUCKETS),
    "chain_breaks_in_recent_7d": _is_count_or_absent,
    "chain_close_bill_after_utime": _is_count_or_absent,
    "chain_close_utime_after_bill": _is_count_or_absent,
    "chain_repeat_reason": _is_one_of(_REPEAT_REASONS),
    "chain_below_stop": _is_count_or_absent,
    "chain_below_stop_ccys": _is_count_or_absent,
    "chain_below_stop_complete": _is_bool_or_absent,
    "chain_ceiling_hit": _is_bool_or_absent,
    "chain_recent_read": _is_count_or_absent,
    "chain_recent_complete": _is_bool_or_absent,
    "chain_recent_both": _is_count_or_absent,
    "chain_recent_only_bills": _is_count_or_absent,
    "chain_recent_after_walk": _is_count_or_absent,
    "chain_recent_only_archive": _is_count_or_absent,
    "chain_recent_field_mismatch": _is_count_or_absent,
    "chain_recent_only_bills_kinds": _is_full_match_or_absent(_KIND_LIST_RE),
    "chain_archive_behind": _is_one_of_or_absent(_LAG_BUCKETS),
    "chain_types_probed": _is_count_or_absent,
    "chain_types_hidden": _is_count_or_absent,
    "chain_inst_types_probed": _is_count_or_absent,
    "chain_inst_types_hidden": _is_count_or_absent,
    "chain_hidden_kinds": _is_full_match_or_absent(_KIND_LIST_RE),
    "chain_sweep_partial": _is_count_or_absent,
    "chain_sweep_complete": _is_bool_or_absent,
    "chain_recent_refused": _is_count_or_absent,
    "chain_sweep_refused": _is_count_or_absent,
}


def chain_defaults() -> dict[str, Any]:
    """Every chain key at its "not measured" value (field-absent, never 0 or False)."""
    out: dict[str, Any] = {key: FIELD_ABSENT for key in CHAIN_KEYS}
    out["chain_diagnostic"] = "not-run"
    out["chain_diagnostic_failure_class"] = "none"
    out["chain_failed_step"] = "none"
    out["chain_repeat_reason"] = "not-run"
    return out


def _ccy_class(symbol: str | None) -> str:
    """A currency symbol as a member of the closed vocabulary; anything else is "other"."""
    if symbol is None:
        return "none"
    if symbol in STABLECOINS or symbol in _NAMED_NON_STABLE:
        return symbol
    return "other"


def _list_token(counts: Mapping[str, int]) -> str:
    """``token:n`` entries by count (descending) then token, five at most, the rest as ``other:n``."""
    if not counts:
        return "none"
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    shown = [f"{token}:{min(n, _COUNT_CAP)}" for token, n in ordered[:_KIND_CAP]]
    rest = sum(n for _, n in ordered[_KIND_CAP:])
    if rest:
        shown.append(f"other:{min(rest, _COUNT_CAP)}")
    return ",".join(shown)


def _code(raw: str) -> str:
    return raw if re.fullmatch(r"[0-9]{1,4}", raw) else "x"


def _inst(raw: str) -> str:
    if raw == "":
        return "blank"
    return raw if raw in _INST_TYPES else "x"


def _kind_token(kinds: Mapping[tuple[str, str, str], int]) -> str:
    """Bill kinds as the closed ``T.S.I:n`` grammar; raw values that print alike merge."""
    merged: dict[str, int] = {}
    for (bill_type, sub_type, inst_type), n in kinds.items():
        token = f"{_code(bill_type)}.{_code(sub_type)}.{_inst(inst_type)}"
        merged[token] = merged.get(token, 0) + n
    return _list_token(merged)


def _mgn_token(modes: Mapping[str, int]) -> str:
    """Margin modes as the closed ``M:n`` grammar (``blank`` for none, ``x`` for anything else)."""
    merged: dict[str, int] = {}
    for raw, n in modes.items():
        token = "blank" if raw == "" else (raw if raw in _MGN_MODES else "x")
        merged[token] = merged.get(token, 0) + n
    return _list_token(merged)


def _residual_bucket(rel: Decimal | None) -> str:
    """The decade of a relative residual, never an amount; ``none`` when there was no break."""
    if rel is None:
        return "none"
    for edge, label in _RESIDUAL_EDGES:
        if rel < edge:
            return label
    return "ge_1e-1"


def _age_bucket(ms: int | None) -> str:
    """The age bucket of a break, never a timestamp; ``none`` when there was no break."""
    if ms is None:
        return "none"
    for edge, label in _AGE_EDGES:
        if ms < edge:
            return label
    return "ge_30d"


def _lag_bucket(ms: int | None) -> str:
    """How far the 7-day store is ahead of the walk, never a timestamp; field-absent without a 7-day row."""
    if ms is None:
        return FIELD_ABSENT
    if ms <= 0:
        return "none"
    for edge, label in _LAG_EDGES:
        if ms < edge:
            return label
    return "ge_1d"


def _arm(report: chain.ChainReport) -> str:
    interior = report.ccys_interior_broken > 0
    close = report.ccys_close_broken > 0
    if interior and close:
        return "both"
    if interior:
        return "interior"
    if close:
        return "close"
    return "none"


def chain_values(report: chain.ChainReport) -> dict[str, Any]:
    """The report as record values: the only place a count or token is produced for printing."""
    worst = report.worst_ccy
    return {
        "chain_arm": _arm(report),
        "chain_ccys_checked": report.ccys_checked,
        "chain_ccys_interior_broken": report.ccys_interior_broken,
        "chain_ccys_close_broken": report.ccys_close_broken,
        "chain_interior_links": report.interior_links,
        "chain_interior_breaks": report.interior_breaks,
        "chain_worst_ccy": _ccy_class(worst),
        "chain_worst_ccy_is_stable": FIELD_ABSENT if worst is None else worst in STABLECOINS,
        "chain_break_kinds": _kind_token(report.break_kinds),
        "chain_break_prev_kinds": _kind_token(report.break_prev_kinds),
        "chain_break_mgn_modes": _mgn_token(report.break_mgn_modes),
        "chain_break_pos_level": report.break_pos_level,
        "chain_residual_bucket": _residual_bucket(report.max_residual_rel),
        "chain_close_residual_bucket": _residual_bucket(report.max_close_residual_rel),
        "chain_sig_bal_unchanged": report.sig_bal_unchanged,
        "chain_sig_double_count": report.sig_double_count,
        "chain_sig_reorder": report.sig_reorder,
        "chain_sig_other": report.sig_other,
        "chain_billid_ts_inversions": report.billid_ts_inversions,
        "chain_same_ts_links": report.same_ts_links,
        "chain_same_ts_breaks": report.same_ts_breaks,
        "chain_trail_ccys": report.trail_ccys,
        "chain_closes_by_ts_id": report.closes_by_ts_id,
        "chain_closes_by_ts_id_desc": report.closes_by_ts_id_desc,
        "chain_gap_estimate": report.gap_estimate,
        "chain_first_break_age": _age_bucket(report.first_break_age_ms),
        "chain_last_break_age": _age_bucket(report.last_break_age_ms),
        "chain_breaks_in_recent_7d": report.breaks_in_recent_7d,
    }


def race_values(race: chain.CloseRace) -> dict[str, Any]:
    return {
        "chain_close_cash_moved": race.cash_moved,
        "chain_close_matches_after": race.matches_after,
    }


def _lower_bound(count: int, exact: bool) -> int | str:
    """A count read to its end, or a positive count from a read that was cut or empty (a lower
    bound). A zero from a cut or empty read is not measured: field-absent, never 0."""
    return count if exact or count > 0 else FIELD_ABSENT


def _log_failure(step: str, exc: BaseException) -> None:
    """A trace for the process log: the step and the exception CLASS, never the message (a ccxt
    message can carry an amount or an id) and no traceback (which prints it)."""
    logger.warning("okx chain diagnostic failed step=%s exc_class=%s", step, type(exc).__name__)


def _failure_class(exc: BaseException) -> str:
    """The record's class of a failure; never reads the message."""
    if isinstance(exc, obal.OpeningUnavailable):
        return "malformed_data"
    return classify_failure(exc)


#: The venue groups' own deadline (seconds, over all five). The probe runs this inside its one crawl
#: bound; a hang here ends as a recorded ``Timeout`` and not as the loss of the first reading.
CHAIN_TIMEOUT_S: float = 300.0


def _now_ms() -> int:
    return int(time.time() * 1000)


#: A group's result: the keys it measured, and whether it stopped itself at the call ceiling.
_GroupResult = tuple[dict[str, Any], bool]


async def measure_chain(
    client: Any,
    reading: obal.OkxOpeningReading,
    balance_row: Mapping[str, Any],
    opening_day: date,
    walk_started_ms: int | None = None,
    budget_s: float | None = None,
) -> dict[str, Any]:
    """Name the arm, currency, race and re-read of a ``chain_break``, read-only.

    ``walk_started_ms`` is the wall-clock instant (epoch ms) the oracle's walk began: a bill the
    archive should have served is one stamped before it, a bill stamped after it arrived later. When
    the caller does not pass it, the instant this function is entered stands in, which is after the
    walk ended, so a bill stamped DURING the walk reads as one the walk should have served.

    The venue groups share one deadline, ``CHAIN_TIMEOUT_S`` or the caller's ``budget_s`` if that is
    smaller (what is left of the caller's own bound): a group still running at it is recorded as a
    ``Timeout`` at its step and stops the run.

    Never raises an ``Exception`` and never reads an exception message: a failure is recorded
    by CLASS and by the step it happened in, and the keys measured before it stay. It returns
    only keys in ``CHAIN_KEYS``, so it cannot overwrite a key the oracle's reading owns (the
    first reading's ``opening_unavailable_reason`` is the probe's key and is never returned).

    The venue groups run in order over ONE counted budget: close, repeat, below_stop, recent, sweep. A group
    that hits ``CHAIN_CALL_CEILING`` leaves its keys at their defaults, sets ``chain_ceiling_hit``
    and stops the run. A malformed row (``OpeningUnavailable``) is about the data, not the venue:
    the first such failure's class and step are recorded and the independent groups after it still run.
    Any other exception records its class and step (replacing a recorded malformed one, never a diverged
    re-fold's ``analysis``) and stops the run, because a venue fault that outlived the backoff would repeat on the next
    group. A ceiling is the diagnostic stopping itself and never changes a verdict.
    ``chain_ceiling_hit`` is False only when no group failed: after any failure it stays field-absent.
    """
    out = chain_defaults()
    if walk_started_ms is None:
        walk_started_ms = _now_ms()
    if not reading.walked:
        # A chain_break always carries the bills it walked. An empty hand-over is a defect to
        # see, not a clean reading.
        return {
            **out,
            "chain_diagnostic": "failed",
            "chain_diagnostic_failure_class": "other",
            "chain_failed_step": "analysis",
        }
    try:
        cash_before = obal.cash_balances(balance_row)
        report = chain.analyse_chain(reading.walked, cash_before)
        clocks = chain.utime_race(report, chain.balance_utimes(balance_row))
        measured = chain_values(report)
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        _log_failure("analysis", exc)
        return {
            **out,
            "chain_diagnostic": "failed",
            "chain_diagnostic_failure_class": _failure_class(exc),
            "chain_failed_step": "analysis",
        }
    out = {**out, "chain_diagnostic": "run", **measured}
    if out["chain_arm"] == "none":
        # The caller only asks after a ``chain_break`` refusal, so a re-fold that holds disagrees
        # with the oracle. A clean-looking ``none`` beside a refusal would hide that.
        out = {
            **out,
            "chain_arm": "diverged",
            "chain_diagnostic": "failed",
            "chain_diagnostic_failure_class": "other",
            "chain_failed_step": "analysis",
        }
    if clocks is not None:
        out = {**out, "chain_close_bill_after_utime": clocks[0], "chain_close_utime_after_bill": clocks[1]}

    budget = chain.BudgetedExchange(client, chain.CHAIN_CALL_CEILING)
    opening_ms = chain.opening_ms(opening_day)

    async def _close() -> _GroupResult:
        cash_after = await chain.read_cash_after(budget)
        return race_values(chain.close_race(report, cash_before, cash_after)), False

    async def _repeat() -> _GroupResult:
        return {"chain_repeat_reason": await chain.repeat_chain_verdict(budget, opening_ms)}, False

    async def _below_stop() -> _GroupResult:
        below = await chain.read_below_stop(budget, opening_ms, reading.walked)
        return {
            "chain_below_stop": _lower_bound(below.count, below.complete),
            "chain_below_stop_ccys": _lower_bound(below.ccys, below.complete),
            "chain_below_stop_complete": below.complete,
        }, False

    async def _recent() -> _GroupResult:
        recent = await chain.read_recent_bills(budget)
        overlap = chain.recent_overlap(reading.walked, recent.rows, opening_ms, walk_started_ms)
        # An empty read compared nothing, and a cut read compared only what it reached.
        exact = recent.complete and bool(recent.rows)
        return {
            "chain_recent_read": len(recent.rows),
            "chain_recent_complete": recent.complete,
            "chain_recent_refused": recent.refused,
            "chain_recent_both": _lower_bound(overlap.both, exact),
            "chain_recent_only_bills": _lower_bound(overlap.only_bills, exact),
            "chain_recent_after_walk": _lower_bound(overlap.after_walk, exact),
            "chain_recent_only_archive": _lower_bound(overlap.only_archive, exact),
            "chain_recent_field_mismatch": _lower_bound(overlap.field_mismatch, exact),
            "chain_recent_only_bills_kinds": (
                _kind_token(overlap.only_bills_kinds) if exact or overlap.only_bills_kinds else FIELD_ABSENT
            ),
            "chain_archive_behind": _lag_bucket(overlap.behind_ms),
        }, recent.ceiling_hit

    async def _sweep() -> _GroupResult:
        types = await chain.read_bill_types(budget)
        sweep = await chain.sweep_hidden(budget, opening_ms, reading.walked, types, walk_started_ms)
        return {
            "chain_types_probed": sweep.types_probed,
            "chain_types_hidden": sweep.types_hidden,
            "chain_inst_types_probed": sweep.inst_types_probed,
            "chain_inst_types_hidden": sweep.inst_types_hidden,
            "chain_hidden_kinds": _kind_token(sweep.hidden_kinds),
            "chain_sweep_partial": sweep.partial,
            "chain_sweep_complete": sweep.complete,
            "chain_sweep_refused": sweep.refused,
        }, sweep.ceiling_hit

    groups: tuple[tuple[str, Callable[[], Awaitable[_GroupResult]]], ...] = (
        ("close", _close),
        ("repeat", _repeat),
        ("below_stop", _below_stop),
        ("recent", _recent),
        ("sweep", _sweep),
    )
    ceiling_hit = False
    any_failed = False
    deadline = time.monotonic() + (CHAIN_TIMEOUT_S if budget_s is None else min(CHAIN_TIMEOUT_S, budget_s))
    for step, run in groups:
        try:
            values, stopped = await asyncio.wait_for(run(), max(0.0, deadline - time.monotonic()))
        except chain.CallCeilingReached:
            ceiling_hit = True
            break
        except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
            _log_failure(step, exc)
            any_failed = True
            if isinstance(exc, obal.OpeningUnavailable):
                # Not the run's end: the first such failure is kept, a later stopper overwrites it
                # (never an analysis divergence).
                if out["chain_failed_step"] == "none":
                    out = {**out, "chain_diagnostic_failure_class": "malformed_data", "chain_failed_step": step}
                continue
            if out["chain_failed_step"] != "analysis":
                # A diverged re-fold is a defect a later venue fault must not hide.
                out = {**out, "chain_diagnostic_failure_class": _failure_class(exc), "chain_failed_step": step}
            break
        out = {**out, **values}
        if stopped:
            ceiling_hit = True
            break
    if ceiling_hit:
        out["chain_ceiling_hit"] = True
    elif not any_failed:
        # Plan 179-03 reads False as "every group ran": a group that failed leaves it field-absent.
        out["chain_ceiling_hit"] = False
    out["chain_calls"] = budget.calls
    return out
