"""Phase 233 DERIBITTRUTH, DBOOK-01: the independent per-day attribution oracle for the Deribit book.

The founder's Deribit book compounds to a very large cumulative figure and nobody can say which
days are booked P&L on a real base and which are not. This script answers that, day by day,
from the STORED inputs only: for each published book return it recomputes

    r_t = (sum over counted keys of the key's booked P&L on day t)
          / (sum over the same keys of the key's level on the previous union day)

with the levels rolled back from ``realized_terminal_usd`` through ``composed_day_pnl`` and
``composed_flows``, and compares it with the stored ``equity_curve.returns`` value under a numeric
equality tolerance. An emptied (dust) level is zero capital in BOTH sums and as a carried level
(DERIBITWEDGE D-01: ``replay_key_equity`` zeroes it after the raw self-check, then
``portfolio_returns`` adds ``equity_prev * ret`` and ``equity_prev``), so a key whose previous-day
level is 0.0 adds nothing to the numerator or the denominator; the emptied scan and the per-key
stamp identity still run on the raw writer-basis levels. The tolerance is NOT a plausibility bound (Phase 194 D-05): nothing here
decides that a return is too large to be real. A day it does not reproduce is withheld under one
name from a closed set; a day it reproduces is "explained".

Why this imports nothing it judges (Pitfall 7). An oracle that imports the arithmetic it judges
agrees with it by construction. The compose and the derive are therefore SPEC here, read and
re-implemented with this file's own code, never imported:

  * ``allocator_equity_compose.portfolio_returns``: union of level days, the level carry rules,
    sit-out of dropped days, the non-positive-denominator skip, the non-finite omission, and the
    ``compose_allocator_equity`` payload (``returns``, ``flags``, ``degrade_reasons``,
    ``inputs.n_keys`` = the count of distinct stitch parents, the present-only exit lists).
  * ``allocator_equity_derive.replay_key_equity`` (the writer-basis backward roll and the level
    identity), ``read_writer_basis`` / ``read_realized_terminal`` / ``read_dropped_day_pnl`` /
    ``read_returns_stamp`` / ``returns_stamp_mismatch_days``.
  * ``nav_twr`` (stored return ``(cur - prev - flow) / prev``).

A test in ``tests/test_deribit_book_oracle.py`` parses this file and fails on any import of a
production module, a network module or a process module.

Export format (a JSON object; the file is produced outside the repo and never enters it)::

    {
      "_comment": "optional string, ignored",
      "book":  {"label": "A", "returns": [{"date", "r"}, ...],
                "flags": ["token", ...], "degrade_reasons": [...],
                "inputs": {"n_keys": 2, "anchor_asof": "<day or null>", "composed_at": "<text>"},
                "unpriced_native_keys": [{"api_key_id": "k4", "day": "<day or null>",
                                          "reason": "day_unknown", "hole_days": [...]}],
                "no_capital_exited_keys": [{"api_key_id": "k2", "reason": "dust", "day": "<day>"}],
                "failing_key_exits": [{"api_key_id": "k3", "reason": "read_incomplete",
                                       "day": "<day or null>"}]},
      "keys":  {"k1": {"composed_day_pnl": [{"utc_day_iso", "pnl_usd"}], "composed_flows":
                [{"utc_day_iso", "flow_usd"}], "dropped_day_pnl": [...], "returns_stamp":
                [{"utc_day_iso", "return"}], "realized_terminal_day", "realized_terminal_usd",
                "anchor_usd", "anchor_null_reason", "options_cash_basis",
                "writer_basis_withheld", "tiny_base_days", "stored_return_days": ["<day>", ...]}},
      "declared": {"counted": ["k1", "k2"], "stitch_parent": {"k2": "k1"},
                   "departed": {"k1": "<last day>"}}
    }

These are PROD's payload shapes: ``flags`` is a sorted array of tokens (the object form
``{"token": true}`` stays readable), the three exit lists are objects, and ``inputs`` is the full
object. An array may also arrive as a list of year slices; the loader flattens it and fails on a
duplicate day. A field whose value is null, or a list of year slices that are all null, is ABSENT,
which is distinct from a present empty array; a null slice beside other slices is skipped. Any
unknown key, wrong type, non-ISO day or non-finite number raises ``ExportError`` naming the field
path, never the value.

The counted key set is a DECLARED input. The compose job picks one login per shared account
(``account_groups``, ``working_holder_predicate``, first return day, read-incomplete markers) and
applies stitch, departed and exit rules at compose time; none of that is in the payload beyond
``inputs.n_keys`` and the exit lists. The orchestrator therefore declares the set (the rule it
follows is the compose job's key read in ``job_worker.run_derive_allocator_equity_job``) and the
oracle only checks that the declared set counts to ``inputs.n_keys``.

The counted-key rule. A counted key with none of the four writer-basis arrays
(``composed_day_pnl``, ``composed_flows``, ``dropped_day_pnl``, ``returns_stamp``) is still counted:
the compose replays it on the legacy roll from its ``csv_daily_returns`` (for example a key that
exited ``read_incomplete``). It carries ``stored_return_days``, its ``csv_daily_returns`` days
(dates only, from ``--print-sql=key_return_days``), and every published day it participates on is
withheld ``no_stored_base_level``. A counted key with no day in any array is refused (exit 2,
``declared.counted[<i>]``), never silently absent. A key with a null anchor, ``anchor_null_reason``
``dust`` and no stored return series is omitted silently by the compose
(``null_anchor_without_returns``) and is NOT counted. How each exit list maps to
``declared.departed``: a ``no_capital_exited_keys`` entry departs on its listed day, so a counted
key named there must be declared departed on that day; a ``failing_key_exits`` entry departs on its
listed day only when that day is before the book's last day (a marked key named with the book's last
day stays in), so a declared departure of such a key must fall on the exit day, and an entry with
day null names a key that was never counted. The loader checks both.

Known limits of this version (named, not silent): a stitched child is modelled as its own key
series with its join and the next day treated as a boundary; the emptied band is scanned on each
key's raw writer-basis levels (the terminal level before the live anchor replaces it) and an
emptied last day keeps 0.0 only when the effective anchor is inside the band of the prior peak,
otherwise it takes the anchor; ``nonfinite_return`` is named and produced
by the loop but no fixture reaches it (the loader refuses non-finite numbers, so only an overflow
sum could); an ``omitted`` day outside the first-to-last published day is named
``outside_published_window`` and still printed day by day.

Closed sets (public constants below): ``WITHHELD_REASONS`` for a published day the oracle does not
reproduce, in priority order; ``OMITTED_REASONS`` for a day of the book's span the compose did not
publish; ``ANNOTATIONS`` for capital-outside-base names that never change a class.

Verdicts and exit codes: 0 CLEAN, 1 STOP, 2 usage or malformed export, 3 VACUOUS.

Redaction contract: the reading is pasted into a tracked file in a public repository, so it
carries labels (``A``, ``k1``), ISO dates, counts, closed names and 3-significant-figure ratios
only, through a closed-vocabulary emitter that refuses anything else. No id, no USD amount, no
venue text. An exception prints its type only (a message can carry an id).

Run recipe: plan 233-07 Task 3 (the orchestrator exports through the MCP read path first, one
statement per call, and falls back to psql, one statement per call, for an array too large for MCP,
with the marker query first on every connection; the export lives in its session scratchpad; then
``python3 deribit_book_oracle.py --input <file>``).
``python3 deribit_book_oracle.py --print-sql[=<label>]`` prints the read-only statements, with
placeholders only, that produce the export. The script holds no connection and no DSN.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Final

# ── closed sets ────────────────────────────────────────────────────────────────────────────────

# A published day the oracle does not reproduce, in priority order. ``emptied_stretch`` is named
# now and its rule lands in plan 233-05 at its priority position.
WITHHELD_REASONS: Final[tuple[str, ...]] = (
    "key_set_not_reproducible",
    "no_stored_base_level",
    "key_basis_not_reproducible",
    "emptied_stretch",
    "attribution_mismatch",
)

# A day in the book's span the compose did not publish.
OMITTED_REASONS: Final[tuple[str, ...]] = (
    "no_stored_base_level",
    "skipped_nonpositive_denominator",
    "missing_return_inside_coverage",
    "nonfinite_return",
    "outside_published_window",
    "omission_unexplained",
)

# Named, never nulled, never change a class.
ANNOTATIONS: Final[tuple[str, ...]] = (
    "capital_outside_base_options_cash",
    "capital_outside_base_flow_day",
    "key_sat_out",
)

VERDICTS: Final[tuple[str, ...]] = ("CLEAN", "STOP", "VACUOUS")
EXIT_CODES: Final[Mapping[str, int]] = {"CLEAN": 0, "STOP": 1, "VACUOUS": 3}

# Numeric EQUALITY floors, NOT plausibility bounds (Phase 194 D-05). The repo's own per-key stamp
# tolerance is 1e-12; the book one is looser because it sums many keys and the levels are rolled
# back through thousands of days.
_BOOK_RETURN_REL_TOL: Final[float] = 1e-9
_BOOK_RETURN_ABS_TOL: Final[float] = 1e-12

# The vacuity floor: a run that explains no published day, or under this share of them, is
# VACUOUS and never green. A stated choice: a mostly-withheld reading is more likely an oracle or
# export defect than a founder question (plan 233-05 Task 3 step 7 re-routes it when the withheld
# reasons are structural).
_MIN_EXPLAINED_SHARE: Final[float] = 0.5

# A REPORTING threshold taken from the CONTEXT measurement (the book's days above 30%). It picks
# which days get an ``oracle-big-day:`` line and splits the cumulative; it never changes a class.
_BIG_DAY_ABS_RETURN: Final[float] = 0.30

# The emptied band, three literal COPIES of ``allocator_equity_derive.EMPTIED_FRACTION``,
# ``EMPTIED_NEGATIVE_FRACTION`` and ``EMPTIED_RESTART_FLOOR_USD`` (the book's own flag). They are
# copies on purpose, so the oracle imports nothing it judges; ``tests/test_deribit_book_oracle.py``
# imports production IN THE TEST ONLY and fails if a copy drifts. The tiny-base constants are NOT
# copied: the oracle never recomputes that rule (tiny days arrive in the dropped set).
_EMPTIED_FRACTION: Final[float] = 0.01
_EMPTIED_NEGATIVE_FRACTION: Final[float] = 1e-4
_EMPTIED_RESTART_FLOOR_USD: Final[float] = 100.0

# The closed exit reasons, literal COPIES of ``allocator_equity_compose.FAILING_KEY_EXIT_REASONS``
# and ``equity_reconstruction._NO_CAPITAL_ANCHOR_REASONS`` (the test pins them equal), and the one
# reason an unpriced native key may carry.
_FAILING_KEY_EXIT_REASONS: Final[frozenset[str]] = frozenset({"sync_failing", "read_incomplete"})
_NO_CAPITAL_EXIT_REASONS: Final[frozenset[str]] = frozenset({"dust", "nonpositive"})
_UNPRICED_REASON: Final[str] = "day_unknown"

# ── errors and small helpers ───────────────────────────────────────────────────────────────────


class ExportError(Exception):
    """A malformed export. The message names a field path and never a value."""


_DAY_RE: Final = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_KEY_LABEL_RE: Final = re.compile(r"^k\d+$")
_BOOK_LABEL_RE: Final = re.compile(r"^[A-Z]$")


def sig3(x: float) -> float | str:
    """Round to three significant figures; a non-finite value reads ``non-finite``.

    A local copy of the body of ``bybit_upnl_probe.sig3`` (never imported)."""
    if not math.isfinite(x):
        return "non-finite"
    return float(f"{x:.3g}")


def _close(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=_BOOK_RETURN_REL_TOL, abs_tol=_BOOK_RETURN_ABS_TOL)


# ── loader ─────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class KeyInputs:
    """One counted key's stored ``key_inputs`` fields."""

    label: str
    pnl: dict[str, float]
    flows: dict[str, float]
    dropped: dict[str, float]
    stamp: dict[str, float] | None
    terminal_day: str | None
    terminal_usd: float | None
    anchor_usd: float | None
    anchor_null_reason: str | None
    options_cash_basis: bool | None
    writer_basis_withheld: str | None
    tiny_base_days: tuple[str, ...]
    stored_return_days: tuple[str, ...] = ()


# One exit-list entry: (key label, reason or None, day or None).
ExitEntry = tuple[str, str | None, str | None]


@dataclass(frozen=True)
class Book:
    label: str
    returns: dict[str, float]
    flags: dict[str, Any]
    degrade_reasons: tuple[str, ...]
    n_keys: int
    unpriced_native_keys: tuple[ExitEntry, ...]
    no_capital_exited_keys: tuple[ExitEntry, ...]
    failing_key_exits: tuple[ExitEntry, ...]


@dataclass(frozen=True)
class Declared:
    counted: tuple[str, ...]
    stitch_parent: dict[str, str]
    departed: dict[str, str]


@dataclass(frozen=True)
class Export:
    book: Book
    keys: dict[str, KeyInputs]
    declared: Declared


def _obj(
    path: str, raw: Any, allowed: Collection[str], required: Collection[str] = ()
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ExportError(f"{path}: expected an object")
    for name in raw:
        if name not in allowed:
            # The unknown name is export data and could be an id: report the path only.
            raise ExportError(f"{path}: unknown field")
    for name in required:
        if name not in raw:
            raise ExportError(f"{path}.{name}: missing")
    return raw


def _num(path: str, raw: Any) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ExportError(f"{path}: expected a number")
    value = float(raw)
    if not math.isfinite(value):
        raise ExportError(f"{path}: non-finite number")
    return value


def _num_or_none(path: str, raw: Any) -> float | None:
    return None if raw is None else _num(path, raw)


def _count(path: str, raw: Any) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise ExportError(f"{path}: expected a non-negative integer")
    return raw


def _day(path: str, raw: Any) -> str:
    if not isinstance(raw, str) or not _DAY_RE.match(raw):
        raise ExportError(f"{path}: expected an ISO day")
    try:
        date.fromisoformat(raw)
    except ValueError:
        raise ExportError(f"{path}: expected an ISO day") from None
    return raw


def _day_or_none(path: str, raw: Any) -> str | None:
    return None if raw is None else _day(path, raw)


def _str_or_none(path: str, raw: Any) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ExportError(f"{path}: expected a string")
    return raw


def _bool_or_none(path: str, raw: Any) -> bool | None:
    if raw is None:
        return None
    if not isinstance(raw, bool):
        raise ExportError(f"{path}: expected a boolean")
    return raw


def _flatten(path: str, raw: Any) -> list[Any] | None:
    """An array, or a list of year slices flattened into one array; ``None`` when ABSENT.

    A null value, or a list of year slices that are all null, is absent. A present empty array is
    present and empty. A null slice beside other slices is skipped."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ExportError(f"{path}: expected an array")
    if raw and all(item is None or isinstance(item, list) for item in raw):
        parts = [item for item in raw if item is not None]
        if not parts:
            return None
        return [item for part in parts for item in part]
    if any(item is None or isinstance(item, list) for item in raw):
        raise ExportError(f"{path}: mixed rows and slices")
    return list(raw)


def _day_values(path: str, raw: Any, day_key: str, value_key: str) -> dict[str, float] | None:
    rows = _flatten(path, raw)
    if rows is None:
        return None
    out: dict[str, float] = {}
    for index, row in enumerate(rows):
        row_path = f"{path}[{index}]"
        fields = _obj(row_path, row, (day_key, value_key), (day_key, value_key))
        day = _day(f"{row_path}.{day_key}", fields[day_key])
        if day in out:
            raise ExportError(f"{row_path}.{day_key}: duplicate day")
        out[day] = _num(f"{row_path}.{value_key}", fields[value_key])
    return out


def _day_list(path: str, raw: Any) -> tuple[str, ...] | None:
    items = _flatten(path, raw)
    if items is None:
        return None
    out: list[str] = []
    for index, item in enumerate(items):
        day = _day(f"{path}[{index}]", item)
        if day in out:
            raise ExportError(f"{path}[{index}]: duplicate day")
        out.append(day)
    return tuple(out)


def _label_list(path: str, raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        raise ExportError(f"{path}: expected an array")
    out: list[str] = []
    for index, item in enumerate(raw):
        if not isinstance(item, str) or not _KEY_LABEL_RE.match(item):
            raise ExportError(f"{path}[{index}]: expected a key label")
        out.append(item)
    return tuple(out)


_KEY_FIELDS: Final = (
    "composed_day_pnl",
    "composed_flows",
    "dropped_day_pnl",
    "returns_stamp",
    "realized_terminal_day",
    "realized_terminal_usd",
    "anchor_usd",
    "anchor_null_reason",
    "options_cash_basis",
    "writer_basis_withheld",
    "tiny_base_days",
    "stored_return_days",
)
_BOOK_FIELDS: Final = (
    "label",
    "returns",
    "flags",
    "degrade_reasons",
    "inputs",
    "unpriced_native_keys",
    "no_capital_exited_keys",
    "failing_key_exits",
)


def _load_key(label: str, raw: Any) -> KeyInputs:
    path = f"keys.{label}"
    f = _obj(path, raw, _KEY_FIELDS)
    pnl = _day_values(f"{path}.composed_day_pnl", f.get("composed_day_pnl"), "utc_day_iso", "pnl_usd")
    flows = _day_values(f"{path}.composed_flows", f.get("composed_flows"), "utc_day_iso", "flow_usd")
    dropped = _day_values(f"{path}.dropped_day_pnl", f.get("dropped_day_pnl"), "utc_day_iso", "pnl_usd")
    stamp = _day_values(f"{path}.returns_stamp", f.get("returns_stamp"), "utc_day_iso", "return")
    stored = _day_list(f"{path}.stored_return_days", f.get("stored_return_days"))
    if stored is not None and any(part is not None for part in (pnl, flows, dropped, stamp)):
        raise ExportError(f"{path}.stored_return_days: only a key with no writer-basis array carries stored return days")
    return KeyInputs(
        label=label,
        pnl=pnl or {},
        flows=flows or {},
        dropped=dropped or {},
        stamp=stamp,
        terminal_day=_day_or_none(f"{path}.realized_terminal_day", f.get("realized_terminal_day")),
        terminal_usd=_num_or_none(f"{path}.realized_terminal_usd", f.get("realized_terminal_usd")),
        anchor_usd=_num_or_none(f"{path}.anchor_usd", f.get("anchor_usd")),
        anchor_null_reason=_str_or_none(f"{path}.anchor_null_reason", f.get("anchor_null_reason")),
        options_cash_basis=_bool_or_none(f"{path}.options_cash_basis", f.get("options_cash_basis")),
        writer_basis_withheld=_str_or_none(f"{path}.writer_basis_withheld", f.get("writer_basis_withheld")),
        tiny_base_days=_day_list(f"{path}.tiny_base_days", f.get("tiny_base_days")) or (),
        stored_return_days=stored or (),
    )


def _exit_list(path: str, raw: Any, reasons: frozenset[str] | None) -> tuple[ExitEntry, ...]:
    """One of the three exit lists: objects with a k-label, a closed reason and a day or null.

    ``reasons`` is the closed set for ``failing_key_exits`` / ``no_capital_exited_keys``; ``None``
    reads ``unpriced_native_keys`` (an optional ``reason`` equal to ``day_unknown`` and optional
    ``hole_days``). A null list is absent; a bare label is refused."""
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ExportError(f"{path}: expected an array")
    unpriced = reasons is None
    allowed = ("api_key_id", "day", "reason", "hole_days") if unpriced else ("api_key_id", "day", "reason")
    required = ("api_key_id", "day") if unpriced else ("api_key_id", "day", "reason")
    out: list[ExitEntry] = []
    for index, item in enumerate(raw):
        entry_path = f"{path}[{index}]"
        e = _obj(entry_path, item, allowed, required)
        label = e["api_key_id"]
        if not isinstance(label, str) or not _KEY_LABEL_RE.match(label):
            raise ExportError(f"{entry_path}.api_key_id: expected a key label")
        day = _day_or_none(f"{entry_path}.day", e["day"])
        reason = e.get("reason")
        if reasons is not None:
            if not isinstance(reason, str) or reason not in reasons:
                raise ExportError(f"{entry_path}.reason: expected a closed exit reason")
        elif reason is not None and reason != _UNPRICED_REASON:
            raise ExportError(f"{entry_path}.reason: expected a closed exit reason")
        if unpriced:
            _day_list(f"{entry_path}.hole_days", e.get("hole_days"))
        out.append((label, reason, day))
    return tuple(out)


def _load_flags(raw: Any) -> dict[str, Any]:
    """``book.flags``: PROD's sorted array of tokens (each stored as true) or the object form."""
    if raw is None:
        return {}
    if isinstance(raw, list):
        flags: dict[str, Any] = {}
        for index, token in enumerate(raw):
            if not isinstance(token, str) or not _TOKEN_RE.match(token) or token in flags:
                raise ExportError(f"book.flags[{index}]: expected a unique lower-case token")
            flags[token] = True
        return flags
    if not isinstance(raw, dict):
        raise ExportError("book.flags: expected an array or an object")
    for value in raw.values():
        if value is not None and not isinstance(value, (bool, int, float, str)):
            raise ExportError("book.flags: expected scalar values")
    return dict(raw)


def _load_book(raw: Any) -> Book:
    f = _obj("book", raw, _BOOK_FIELDS, ("label", "returns", "inputs"))
    label = f["label"]
    if not isinstance(label, str) or not _BOOK_LABEL_RE.match(label):
        raise ExportError("book.label: expected one capital letter")
    inputs = _obj("book.inputs", f["inputs"], ("n_keys", "anchor_asof", "composed_at"), ("n_keys",))
    _day_or_none("book.inputs.anchor_asof", inputs.get("anchor_asof"))
    _str_or_none("book.inputs.composed_at", inputs.get("composed_at"))
    reasons_raw = f.get("degrade_reasons") or []
    if not isinstance(reasons_raw, list) or not all(isinstance(r, str) for r in reasons_raw):
        raise ExportError("book.degrade_reasons: expected an array of strings")
    returns = _day_values("book.returns", f["returns"], "date", "r")
    if returns is None:
        raise ExportError("book.returns: expected an array")
    return Book(
        label=label,
        returns=returns,
        flags=_load_flags(f.get("flags")),
        degrade_reasons=tuple(reasons_raw),
        n_keys=_count("book.inputs.n_keys", inputs["n_keys"]),
        unpriced_native_keys=_exit_list("book.unpriced_native_keys", f.get("unpriced_native_keys"), None),
        no_capital_exited_keys=_exit_list(
            "book.no_capital_exited_keys", f.get("no_capital_exited_keys"), _NO_CAPITAL_EXIT_REASONS
        ),
        failing_key_exits=_exit_list("book.failing_key_exits", f.get("failing_key_exits"), _FAILING_KEY_EXIT_REASONS),
    )


def _load_declared(raw: Any, keys: Mapping[str, KeyInputs]) -> Declared:
    f = _obj("declared", raw, ("counted", "stitch_parent", "departed"), ("counted",))
    counted = _label_list("declared.counted", f["counted"])
    if len(set(counted)) != len(counted):
        raise ExportError("declared.counted: duplicate label")
    for index, label in enumerate(counted):
        if label not in keys:
            raise ExportError(f"declared.counted[{index}]: no such key")
        k = keys[label]
        if not (k.pnl or k.flows or k.dropped or k.stamp or k.stored_return_days):
            # A counted key the compose replays has at least one day somewhere; none means the
            # export lost it, and a silent absence would read as an unattributed book.
            raise ExportError(f"declared.counted[{index}]: counted key has no level day")
    stitch_raw = f.get("stitch_parent", {})
    if not isinstance(stitch_raw, dict):
        raise ExportError("declared.stitch_parent: expected an object")
    stitch: dict[str, str] = {}
    for child, parent in stitch_raw.items():
        if child not in counted or not isinstance(parent, str) or parent not in keys:
            raise ExportError("declared.stitch_parent: expected labels of known keys")
        stitch[child] = parent
    departed_raw = f.get("departed", {})
    if not isinstance(departed_raw, dict):
        raise ExportError("declared.departed: expected an object")
    departed: dict[str, str] = {}
    for label, last_day in departed_raw.items():
        if label not in counted:
            raise ExportError("declared.departed: expected labels of counted keys")
        departed[label] = _day("declared.departed.<label>", last_day)
    return Declared(counted, stitch, departed)


def _refuse_id_shaped(path: str, raw: Any) -> None:
    """Refuse a UUID-shaped string anywhere in the export, the ``_comment`` included.

    The export is labelled by hand (``A``, ``k1``): an id in it means the labelling step was
    skipped, and an id must never reach the reading or a tracked file. The error names the field
    path only. A dict key is checked before the walk descends under it, so an id-shaped key is
    reported as ``<key>`` and never echoed."""
    if isinstance(raw, str):
        if _UUID_RE.search(raw):
            raise ExportError(f"{path}: id-shaped value refused")
    elif isinstance(raw, dict):
        for name in raw:
            if isinstance(name, str) and _UUID_RE.search(name):
                raise ExportError(f"{path}.<key>: id-shaped key refused")
        for name, value in raw.items():
            _refuse_id_shaped(f"{path}.{name}", value)
    elif isinstance(raw, list):
        for index, value in enumerate(raw):
            _refuse_id_shaped(f"{path}[{index}]", value)


def _check_exit_agreement(book: Book, declared: Declared) -> None:
    """The exit lists and ``declared.departed`` must agree (the job's departure rule)."""
    for index, (label, _reason, day) in enumerate(book.no_capital_exited_keys):
        if label in declared.counted and (day is None or declared.departed.get(label) != day):
            raise ExportError(
                f"book.no_capital_exited_keys[{index}]: a counted key's no-capital exit must be declared departed on its day"
            )
    for index, (label, _reason, day) in enumerate(book.failing_key_exits):
        if day is None:
            if label in declared.counted:
                raise ExportError(
                    f"book.failing_key_exits[{index}]: an exit with no day must not name a counted key"
                )
        elif label in declared.departed and declared.departed[label] != day:
            raise ExportError(f"book.failing_key_exits[{index}]: the declared departure and the exit day disagree")


def load_export(path: str) -> Export:
    """Read and strictly validate an export file."""
    with open(path, encoding="utf-8") as handle:
        raw = json.load(handle)
    _refuse_id_shaped("export", raw)
    top = _obj("export", raw, ("_comment", "book", "keys", "declared"), ("book", "keys", "declared"))
    if "_comment" in top and not isinstance(top["_comment"], str):
        raise ExportError("export._comment: expected a string")
    keys_raw = top["keys"]
    if not isinstance(keys_raw, dict):
        raise ExportError("keys: expected an object")
    keys: dict[str, KeyInputs] = {}
    for label, record in keys_raw.items():
        if not isinstance(label, str) or not _KEY_LABEL_RE.match(label):
            raise ExportError("keys: expected key labels")
        keys[label] = _load_key(label, record)
    book = _load_book(top["book"])
    declared = _load_declared(top["declared"], keys)
    _check_exit_agreement(book, declared)
    return Export(book, keys, declared)


# ── levels ─────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class KeyLevels:
    """A key's level days and, when the writer basis reproduces, its BOOK levels.

    ``level`` is what the book sums and carries: the writer-basis level with every emptied day at
    0.0 (an emptied level is zero capital, as the compose counts it) and the last day decided by
    the live anchor. ``emptied`` names the emptied days, scanned on the RAW levels."""

    label: str
    days: tuple[str, ...]
    level: dict[str, float] | None
    has_basis: bool
    writer_mode: bool
    stamp_available: bool
    stamp_bad_days: frozenset[str]
    emptied: frozenset[str] = frozenset()


def roll_key_levels(key: KeyInputs) -> KeyLevels:
    """The writer-basis backward roll, the per-key stamp identity check, then the book levels.

    Level days are the union of P&L, flow, dropped, stamped and stored-return days (a key with no
    writer basis has only the last, and no level). The terminal level sits on
    the last P&L day and ``level(prev) = level(day) - F(day) - P(day)``. The stored return on a
    day with a return is ``P(day) / level(prev)``, checked against the stamp under the book
    tolerances. Both the identity and the emptied scan run on these RAW levels (the SPEC's
    Pitfall 6); only then does the book level zero every emptied day, as ``replay_key_equity``
    does. The last day follows the SPEC's anchor block: when it is emptied and the effective
    anchor (``anchor_usd``, or the realized terminal when that is null, the job's no-capital
    exit) is inside the two-sided band of the prior peak at that day, the level stays 0.0;
    otherwise a positive live anchor replaces it. A last day that is not emptied takes a positive
    ``anchor_usd`` as before (a step on that one day, the carried base past the key's own end)."""
    stamp = key.stamp or {}
    days = tuple(sorted(set(key.pnl) | set(key.flows) | set(key.dropped) | set(stamp) | set(key.stored_return_days)))
    has_basis = bool(key.pnl) and key.terminal_day is not None and key.terminal_usd is not None
    stamp_available = key.stamp is not None
    if not days or not has_basis or key.terminal_usd is None:
        return KeyLevels(key.label, days, None, has_basis, False, stamp_available, frozenset())
    last_pnl_day = max(key.pnl)
    writer_mode = (
        all(d in key.pnl or stamp[d] == 0.0 for d in stamp)
        and all(d in key.pnl for d in key.flows)
        and key.terminal_day == last_pnl_day
        and days[-1] == last_pnl_day
    )
    if not writer_mode:
        return KeyLevels(key.label, days, None, has_basis, False, stamp_available, frozenset())
    level: dict[str, float] = {days[-1]: key.terminal_usd}
    for index in range(len(days) - 1, 0, -1):
        day = days[index]
        level[days[index - 1]] = level[day] - key.flows.get(day, 0.0) - key.pnl.get(day, 0.0)
    bad: set[str] = set()
    if stamp_available:
        for index in range(1, len(days)):
            day = days[index]
            prev_level = level[days[index - 1]]
            if day in key.dropped and day not in stamp:
                continue
            if not (prev_level > 0.0):
                continue
            expected = key.pnl.get(day, 0.0) / prev_level
            if not _close(stamp.get(day, 0.0), expected):
                bad.add(day)
    emptied, peak_at_last_day = emptied_scan(days, level, key.flows)
    book = dict(level)
    for day in emptied:
        book[day] = 0.0
    last = days[-1]
    if last in emptied:
        anchor = key.anchor_usd if key.anchor_usd is not None else key.terminal_usd
        in_band = (
            peak_at_last_day is not None
            and -_EMPTIED_NEGATIVE_FRACTION * peak_at_last_day <= anchor < _emptied_ceiling(peak_at_last_day)
        )
        if not in_band and anchor > 0.0:
            book[last] = anchor
    elif key.anchor_usd is not None and key.anchor_usd > 0.0:
        book[last] = key.anchor_usd
    return KeyLevels(key.label, days, book, True, True, stamp_available, frozenset(bad), emptied)


def _last_le(sorted_days: Sequence[str], day: str) -> str | None:
    """The greatest listed day on or before ``day`` (binary search), else ``None``."""
    lo, hi = 0, len(sorted_days)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_days[mid] <= day:
            lo = mid + 1
        else:
            hi = mid
    return sorted_days[lo - 1] if lo else None


def _carry_day(levels: KeyLevels, rotated: bool, day: str) -> str | None:
    """The listed day whose level applies on ``day``: none before the key's first day, the day
    itself when listed, none past the last day for a rotated-out key, otherwise the prior listed
    day (the SPEC's ``_level_on``)."""
    if not levels.days or day < levels.days[0]:
        return None
    if day > levels.days[-1] and rotated:
        return None
    return _last_le(levels.days, day)


def _next_day(day: str) -> str:
    return (date.fromisoformat(day) + timedelta(days=1)).isoformat()


def _coverage_rotations(levels: Mapping[str, KeyLevels]) -> frozenset[str]:
    """The keys a DISJOINT coverage handoff rotates out (the SPEC's ``segment_coverage`` seams).

    A day belongs to the keys that have a level day on it. Consecutive calendar days with an
    identical covering set form one segment; a change of the set or a calendar gap starts a new
    one. Between two adjacent segments whose covering sets are disjoint, and whose key windows
    (first day to last day plus one, half open) do not overlap, the earlier segment's keys are
    rotated out. Overlapping transitions share a key, carry no seam, and an early-ended key that
    still overlaps another keeps carrying its last level."""
    covered = {label: set(lv.days) for label, lv in levels.items() if lv.days}
    union = sorted({day for days in covered.values() for day in days})
    segments: list[tuple[frozenset[str], str, str]] = []
    cur_keys: frozenset[str] | None = None
    start = ""
    prev: str | None = None
    for day in union:
        today = frozenset(label for label, days in covered.items() if day in days)
        gap = prev is not None and (date.fromisoformat(day) - date.fromisoformat(prev)).days > 1
        if cur_keys is None:
            cur_keys, start = today, day
        elif today != cur_keys or gap:
            assert prev is not None
            segments.append((cur_keys, start, prev))
            cur_keys, start = today, day
        prev = day
    if cur_keys is not None and prev is not None:
        segments.append((cur_keys, start, prev))
    window = {label: (levels[label].days[0], _next_day(levels[label].days[-1])) for label in covered}
    rotated: set[str] = set()
    for (a_keys, _a_start, _a_end), (b_keys, _b_start, _b_end) in zip(segments, segments[1:]):
        if not a_keys.isdisjoint(b_keys):
            continue
        if any(
            window[p][0] < window[n][1] and window[n][0] < window[p][1] for p in a_keys for n in b_keys
        ):
            continue
        rotated.update(a_keys)
    return frozenset(rotated)


def _emptied_ceiling(peak: float) -> float:
    return min(_EMPTIED_FRACTION * peak, _EMPTIED_RESTART_FLOOR_USD)


def emptied_scan(
    days: Sequence[str], level: Mapping[str, float], flows: Mapping[str, float]
) -> tuple[frozenset[str], float | None]:
    """The emptied level days of a key's RAW writer-basis levels, and the prior peak at its last day.

    The SPEC's chronological scan: the prior peak is the maximum over EARLIER non-emptied
    positive levels (an emptied day never lifts it); a level is emptied when it is from
    ``_EMPTIED_NEGATIVE_FRACTION`` of the prior peak below zero up to the smaller of
    ``_EMPTIED_FRACTION`` of the prior peak and ``_EMPTIED_RESTART_FLOOR_USD``; a day with a
    positive flow right after an emptied day ends the stretch when it lifts the level out of the
    band (the peak restarts at that level). The last day is scanned on the raw terminal level,
    before any live anchor; the peak recorded for it is the one BEFORE that day is scanned
    (``peak_at_last_day``), which decides the anchor band."""
    peak: float | None = None
    peak_at_last_day: float | None = None
    prev_emptied = False
    out: set[str] = set()
    last_index = len(days) - 1
    for index, day in enumerate(days):
        value = level[day]
        if index == last_index:
            peak_at_last_day = peak
        ends_stretch = (
            index > 0
            and prev_emptied
            and flows.get(day, 0.0) > 0.0
            and peak is not None
            and value >= _emptied_ceiling(peak)
        )
        if ends_stretch:
            if value > 0.0:
                peak = value
            prev_emptied = False
        elif peak is not None and -_EMPTIED_NEGATIVE_FRACTION * peak <= value < _emptied_ceiling(peak):
            out.add(day)
            prev_emptied = True
        else:
            if value > 0.0:
                peak = value if peak is None else max(peak, value)
            prev_emptied = False
    return frozenset(out), peak_at_last_day


# ── the book ───────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DayRepro:
    """What the oracle makes of one union day."""

    day: str
    value: float | None
    omitted: str | None
    participants: tuple[str, ...]
    sat_out: tuple[str, ...]
    contributions: dict[str, float]


@dataclass(frozen=True)
class BookRepro:
    union: tuple[str, ...]
    days: dict[str, DayRepro]


def reproduce_book(
    keys: Mapping[str, KeyInputs],
    levels: Mapping[str, KeyLevels],
    departed: Collection[str] = (),
) -> BookRepro:
    """The SPEC's union-day loop with this file's own numbers.

    A key participates on a day when it has a level on the previous union day and on the day. A
    participating key whose day is a dropped day with no stored return sits out of both sums. The
    numerator is the participating keys' booked P&L on the day and the denominator their book
    levels on the previous union day; a participant whose previous book level is 0.0 (an emptied
    level is zero capital) adds 0.0 to BOTH sums, whatever its P&L (``portfolio_returns`` adds
    ``equity_prev * ret`` and ``equity_prev``). A day with no previous union day, no participant,
    no positive denominator or a non-finite sum is omitted under a name; a day on which a
    participant sat out and the denominator is exactly 0.0 is absent from the compose and omitted
    as ``missing_return_inside_coverage``, a branch that precedes the non-positive skip."""
    union = tuple(sorted({day for lv in levels.values() for day in lv.days}))
    # A declared departure and a disjoint coverage handoff both rotate a key out; an overlapping
    # key that ended early is neither, so its last level carries with no P&L.
    rotated = set(departed) | _coverage_rotations(levels)
    out: dict[str, DayRepro] = {}
    for index, day in enumerate(union):
        if index == 0:
            out[day] = DayRepro(day, None, "no_stored_base_level", (), (), {})
            continue
        prev = union[index - 1]
        parts: list[str] = []
        sat_out: list[str] = []
        for label in sorted(levels):
            lv = levels[label]
            carry_prev = _carry_day(lv, label in rotated, prev)
            carry_day = _carry_day(lv, label in rotated, day)
            if carry_prev is None or carry_day is None:
                continue
            parts.append(label)
            key = keys[label]
            stored_returns = key.stamp or {}
            if day in lv.days and day in key.dropped and day not in stored_returns:
                sat_out.append(label)
        counted = [label for label in parts if label not in sat_out]
        if not parts:
            out[day] = DayRepro(day, None, "skipped_nonpositive_denominator", (), (), {})
            continue
        if not counted:
            out[day] = DayRepro(day, None, "missing_return_inside_coverage", tuple(parts), tuple(sat_out), {})
            continue
        if any(levels[label].level is None for label in counted):
            out[day] = DayRepro(day, None, None, tuple(parts), tuple(sat_out), {})
            continue
        numer = 0.0
        denom = 0.0
        contributions: dict[str, float] = {}
        for label in counted:
            lv = levels[label]
            assert lv.level is not None
            carry_prev = _carry_day(lv, label in rotated, prev)
            assert carry_prev is not None
            prev_level = lv.level[carry_prev]
            pnl = keys[label].pnl.get(day, 0.0) if day in lv.days else 0.0
            if prev_level == 0.0:
                pnl = 0.0  # zero capital adds nothing to either sum, never its stored P&L
            contributions[label] = pnl
            numer += pnl
            denom += prev_level
        if not math.isfinite(numer) or not math.isfinite(denom):
            out[day] = DayRepro(day, None, "nonfinite_return", tuple(parts), tuple(sat_out), contributions)
            continue
        if sat_out and denom == 0.0:
            out[day] = DayRepro(day, None, "missing_return_inside_coverage", tuple(parts), tuple(sat_out), contributions)
            continue
        if not (denom > 0.0):
            out[day] = DayRepro(day, None, "skipped_nonpositive_denominator", tuple(parts), tuple(sat_out), contributions)
            continue
        value = numer / denom
        if not math.isfinite(value):
            out[day] = DayRepro(day, None, "nonfinite_return", tuple(parts), tuple(sat_out), contributions)
            continue
        out[day] = DayRepro(day, value, None, tuple(parts), tuple(sat_out), contributions)
    return BookRepro(union, out)


@dataclass(frozen=True)
class KeySetCheck:
    declared: int
    n_keys: int
    reproduced: bool


def check_key_set(export: Export) -> KeySetCheck:
    """The declared counted set, as distinct stitch parents, against ``inputs.n_keys``."""
    parents = {export.declared.stitch_parent.get(label, label) for label in export.declared.counted}
    return KeySetCheck(len(parents), export.book.n_keys, len(parents) == export.book.n_keys)


@dataclass(frozen=True)
class DayClass:
    day: str
    kind: str  # "explained" | "withheld" | "omitted"
    reason: str | None
    published: float | None
    oracle: float | None


@dataclass(frozen=True)
class Classification:
    days: tuple[DayClass, ...]
    annotations: dict[str, tuple[str, ...]]


def _boundary_days(export: Export, repro: BookRepro, levels: Mapping[str, KeyLevels]) -> frozenset[str]:
    """Days on a declared departure or stitch boundary: the boundary day and the next union day."""
    out: set[str] = set()

    def add_around(day: str) -> None:
        out.add(day)
        later = [d for d in repro.union if d > day]
        if later:
            out.add(later[0])

    for last_day in export.declared.departed.values():
        add_around(last_day)
    for child, parent in export.declared.stitch_parent.items():
        if child != parent and child in levels and levels[child].days:
            add_around(levels[child].days[0])
    return frozenset(out)


def _structural_reason(
    rep: DayRepro | None, keys: Mapping[str, KeyInputs], levels: Mapping[str, KeyLevels]
) -> str | None:
    """Why a day cannot be reproduced from the stored basis, else ``None``."""
    if rep is None or not rep.participants:
        return "no_stored_base_level"
    if any(not levels[label].has_basis for label in rep.participants):
        return "no_stored_base_level"
    for label in rep.participants:
        lv = levels[label]
        if (
            keys[label].writer_basis_withheld is not None
            or not lv.writer_mode
            or not lv.stamp_available
            or rep.day in lv.stamp_bad_days
        ):
            return "key_basis_not_reproducible"
    return None


def classify_days(
    export: Export,
    repro: BookRepro,
    levels: Mapping[str, KeyLevels],
    key_set: KeySetCheck,
) -> Classification:
    """Exactly one class per day of the span and of the published window.

    A published day is explained only when the oracle reproduces its value AND every participating
    key's basis holds (so a stamp that disagrees with P over the previous level withholds the day
    even if the book value happens to match). Otherwise it is withheld under the first matching name
    of ``WITHHELD_REASONS``: an unreproduced key set, then a day on a declared departure or stitch
    boundary, then no stored base level, then a key basis that does not reproduce, then a
    participating key whose level sat inside the emptied band (``emptied_stretch``), then a plain
    attribution mismatch.

    A day of the span the compose did not publish is omitted under the reason the loop recorded,
    else ``no_stored_base_level``; a day the oracle computes outside the first-to-last published day
    is ``outside_published_window``, and one inside it is ``omission_unexplained``. Annotations
    (capital outside the base, a key that sat out) are named per day and never change a class."""
    published = export.book.returns
    boundary = _boundary_days(export, repro, levels)
    emptied = {label: lv.emptied for label, lv in levels.items()}
    window = (min(published), max(published)) if published else None
    out: list[DayClass] = []
    for day in sorted(set(repro.union) | set(published)):
        rep = repro.days.get(day)
        oracle_value = rep.value if rep is not None else None
        if day in published:
            pub = published[day]
            structural = _structural_reason(rep, export.keys, levels)
            value_ok = oracle_value is not None and _close(oracle_value, pub)
            if not key_set.reproduced:
                out.append(DayClass(day, "withheld", "key_set_not_reproducible", pub, oracle_value))
            elif value_ok and structural is None:
                out.append(DayClass(day, "explained", None, pub, oracle_value))
            elif day in boundary:
                out.append(DayClass(day, "withheld", "key_set_not_reproducible", pub, oracle_value))
            elif structural is not None:
                out.append(DayClass(day, "withheld", structural, pub, oracle_value))
            elif rep is not None and _in_emptied_band(rep, day, repro.union, levels, emptied):
                out.append(DayClass(day, "withheld", "emptied_stretch", pub, oracle_value))
            else:
                out.append(DayClass(day, "withheld", "attribution_mismatch", pub, oracle_value))
            continue
        assert rep is not None
        if rep.omitted is not None:
            reason = rep.omitted
        elif rep.value is None:
            reason = "no_stored_base_level"
        elif window is None or not window[0] <= day <= window[1]:
            reason = "outside_published_window"
        else:
            reason = "omission_unexplained"
        out.append(DayClass(day, "omitted", reason, None, oracle_value))
    return Classification(tuple(out), _annotate(export, repro))


def _in_emptied_band(
    rep: DayRepro,
    day: str,
    union: Sequence[str],
    levels: Mapping[str, KeyLevels],
    emptied: Mapping[str, frozenset[str]],
) -> bool:
    """A participating key's previous or same-day level is inside its emptied band."""
    index = union.index(day)
    if index == 0:
        return False
    prev = union[index - 1]
    for label in rep.participants:
        for at in (prev, day):
            applies = _last_le(levels[label].days, at)
            if applies is not None and applies in emptied[label]:
                return True
    return False


def _annotate(export: Export, repro: BookRepro) -> dict[str, tuple[str, ...]]:
    """Capital outside the base, named per day and never nulled (CONTEXT Q4; RESEARCH A5b).

    ``capital_outside_base_options_cash``: a participating key whose open option book is outside
    its base. ``capital_outside_base_flow_day``: a participating key with a non-zero composed flow
    on the day. ``key_sat_out``: a participating key the writer dropped that day. Any day of the
    span can carry them; none changes a class or a value."""
    out: dict[str, tuple[str, ...]] = {}
    for day, rep in repro.days.items():
        names: set[str] = set()
        for label in rep.participants:
            key = export.keys[label]
            if key.options_cash_basis:
                names.add("capital_outside_base_options_cash")
            if key.flows.get(day, 0.0) != 0.0:
                names.add("capital_outside_base_flow_day")
        if rep.sat_out:
            names.add("key_sat_out")
        if names:
            out[day] = tuple(name for name in ANNOTATIONS if name in names)
    return out


@dataclass(frozen=True)
class Analysis:
    export: Export
    key_set: KeySetCheck
    repro: BookRepro
    classification: Classification


def analyse(export: Export) -> Analysis:
    counted = {label: export.keys[label] for label in export.declared.counted}
    levels = {label: roll_key_levels(key) for label, key in counted.items()}
    repro = reproduce_book(counted, levels, set(export.declared.departed))
    key_set = check_key_set(export)
    return Analysis(export, key_set, repro, classify_days(export, repro, levels, key_set))


def decide_verdict(analysis: Analysis) -> str:
    """The verdict, decided in this order: an unreproduced key set is STOP (never VACUOUS, even
    though it withholds every published day); a run that explains no published day, or under
    ``_MIN_EXPLAINED_SHARE`` of them, is VACUOUS (never green); any withheld published day or
    unexplained omission is STOP; otherwise CLEAN."""
    if not analysis.key_set.reproduced:
        return "STOP"
    days = analysis.classification.days
    explained = [d for d in days if d.kind == "explained"]
    withheld = [d for d in days if d.kind == "withheld"]
    published = len(explained) + len(withheld)
    if not explained or len(explained) / published < _MIN_EXPLAINED_SHARE:
        return "VACUOUS"
    unexplained = [d for d in days if d.kind == "omitted" and d.reason == "omission_unexplained"]
    if withheld or unexplained:
        return "STOP"
    return "CLEAN"


# ── the closed-vocabulary emitter ──────────────────────────────────────────────────────────────

_PREFIXES: Final[tuple[str, ...]] = (
    "oracle-book:",
    "oracle-key-set:",
    "oracle-withheld:",
    "oracle-omitted:",
    "oracle-annotation:",
    "oracle-cumulative:",
    "oracle-big-day:",
    "oracle-degrade:",
    "oracle-verdict:",
)
_CLOSED_NAMES: Final[frozenset[str]] = frozenset(
    WITHHELD_REASONS + OMITTED_REASONS + ANNOTATIONS + VERDICTS + ("yes", "no", "none", "reproduced", "not_reproduced", "not_computed")
)
_TOKEN_RE: Final = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_SIG_RE: Final = re.compile(r"^-?\d+(\.\d+)?(e[+-]\d+)?$|^non-finite$")
_UUID_RE: Final = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_LONG_DIGITS_RE: Final = re.compile(r"\d{7,}")


@dataclass(frozen=True)
class Val:
    """A value tagged with the vocabulary it must belong to."""

    kind: str
    raw: object


def _lab(s: str) -> Val:
    return Val("label", s)


def _dt(s: str) -> Val:
    return Val("date", s)


def _cnt(n: int) -> Val:
    return Val("count", n)


def _sig(x: float) -> Val:
    return Val("sig3", x)


def _xv(x: float) -> Val:
    return Val("x", x)


def _nm(s: str) -> Val:
    return Val("name", s)


def _tok(s: str) -> Val:
    return Val("token", s)


def _nms(names: Sequence[str]) -> Val:
    return Val("names", tuple(names))


def _sig_text(x: object) -> str:
    if not isinstance(x, float) or isinstance(x, bool):
        raise ValueError("emitter: expected a float")
    rounded = sig3(x)
    text = rounded if isinstance(rounded, str) else f"{rounded:.3g}"
    if "e" in text and isinstance(rounded, float) and 1.0 <= abs(rounded) < 1e6:
        text = str(int(rounded))  # 3270, not 3.27e+03
    if not _SIG_RE.match(text):
        raise ValueError("emitter: sig3 outside vocabulary")
    return text


def _render_val(val: Val) -> str:
    raw = val.raw
    if val.kind == "label":
        if not isinstance(raw, str) or not (_KEY_LABEL_RE.match(raw) or _BOOK_LABEL_RE.match(raw) or raw == "none"):
            raise ValueError("emitter: label outside vocabulary")
        return raw
    if val.kind == "date":
        if not isinstance(raw, str):
            raise ValueError("emitter: date outside vocabulary")
        _day("emitter.date", raw)
        return raw
    if val.kind == "count":
        if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
            raise ValueError("emitter: count outside vocabulary")
        return str(raw)
    if val.kind == "sig3":
        return _sig_text(raw)
    if val.kind == "x":
        text = _sig_text(raw)
        return "non_finite" if text == "non-finite" else "x" + text
    if val.kind == "name":
        if not isinstance(raw, str) or raw not in _CLOSED_NAMES:
            raise ValueError("emitter: name outside the closed sets")
        return raw
    if val.kind == "names":
        if not isinstance(raw, tuple) or not all(isinstance(n, str) and n in _CLOSED_NAMES for n in raw):
            raise ValueError("emitter: names outside the closed sets")
        return ",".join(raw) if raw else "none"
    if val.kind == "token":
        if not isinstance(raw, str) or not _TOKEN_RE.match(raw):
            raise ValueError("emitter: token outside vocabulary")
        return raw
    raise ValueError("emitter: unknown value kind")


Row = tuple[str, tuple[tuple[str, Val], ...]]


def _render_rows(rows: Sequence[Row]) -> list[str]:
    """Render rows through the closed vocabulary; refuse anything outside it."""
    lines: list[str] = []
    for prefix, fields in rows:
        if prefix not in _PREFIXES:
            raise ValueError("emitter: unknown line prefix")
        lines.append(" ".join([prefix] + [f"{name}={_render_val(val)}" for name, val in fields]))
    text = "\n".join(lines)
    if _UUID_RE.search(text) or _LONG_DIGITS_RE.search(text):
        raise ValueError("emitter: identifier-shaped text in the reading")
    return lines


def _product(returns: Iterable[float]) -> float:
    """Compound a series of returns: the product of ``1 + r``."""
    total = 1.0
    for r in returns:
        total *= 1.0 + r
    return total


def emit_reading(analysis: Analysis) -> list[str]:
    """The redacted reading, as lines, the verdict last."""
    cls = analysis.classification
    book = analysis.export.book
    explained = [d for d in cls.days if d.kind == "explained"]
    withheld = [d for d in cls.days if d.kind == "withheld"]
    omitted = [d for d in cls.days if d.kind == "omitted"]
    published = len(explained) + len(withheld)
    unexplained = [d for d in omitted if d.reason == "omission_unexplained"]
    ks = analysis.key_set
    rows: list[Row] = [
        (
            "oracle-book:",
            (
                ("book", _lab(book.label)),
                ("published", _cnt(published)),
                ("explained", _cnt(len(explained))),
                ("withheld", _cnt(len(withheld))),
                ("omitted", _cnt(len(omitted))),
                ("annotated", _cnt(len(cls.annotations))),
            ),
        ),
        (
            "oracle-key-set:",
            (
                ("declared", _cnt(ks.declared)),
                ("n_keys", _cnt(ks.n_keys)),
                ("reproduced", _nm("yes" if ks.reproduced else "no")),
            ),
        ),
    ]
    for day in withheld:
        assert day.reason is not None
        rows.append(("oracle-withheld:", (("date", _dt(day.day)), ("reason", _nm(day.reason)))))
    for day in omitted:
        assert day.reason is not None
        rows.append(("oracle-omitted:", (("date", _dt(day.day)), ("reason", _nm(day.reason)))))
    pub_days = [d for d in cls.days if d.kind in ("explained", "withheld")]
    explained_by_day = {d.day: d for d in explained}
    present = [a for a in ANNOTATIONS if any(a in names for names in cls.annotations.values())]
    if not present:
        rows.append(("oracle-annotation:", (("name", _nm("none")), ("days", _cnt(0)))))
    for ann in present:
        days_with = [day for day, names in cls.annotations.items() if ann in names]
        explained_with = [explained_by_day[day] for day in days_with if day in explained_by_day]
        rows.append(
            (
                "oracle-annotation:",
                (
                    ("name", _nm(ann)),
                    ("days", _cnt(len(days_with))),
                    ("explained_days", _cnt(len(explained_with))),
                    ("explained_cumulative", _xv(_product(d.oracle for d in explained_with if d.oracle is not None))),
                ),
            )
        )
    annotated_days = set(cls.annotations)
    rows.append(
        (
            "oracle-cumulative:",
            (
                ("published", _xv(_product(d.published for d in pub_days if d.published is not None))),
                ("explained", _xv(_product(d.oracle for d in explained if d.oracle is not None))),
                (
                    "explained_unannotated",
                    _xv(_product(d.oracle for d in explained if d.oracle is not None and d.day not in annotated_days)),
                ),
                (
                    "published_without_big_days",
                    _xv(
                        _product(
                            d.published
                            for d in pub_days
                            if d.published is not None and abs(d.published) <= _BIG_DAY_ABS_RETURN
                        )
                    ),
                ),
            ),
        )
    )
    for day in pub_days:
        if day.published is None or not abs(day.published) > _BIG_DAY_ABS_RETURN:
            continue
        rep = analysis.repro.days.get(day.day)
        contributions = rep.contributions if rep is not None else {}
        total = sum(abs(v) for v in contributions.values())
        top = max(contributions, key=lambda label: abs(contributions[label])) if contributions else None
        share = abs(contributions[top]) / total if top is not None and total > 0.0 else 0.0
        rows.append(
            (
                "oracle-big-day:",
                (
                    ("date", _dt(day.day)),
                    ("r", _sig(day.published)),
                    ("key", _lab(top if top is not None else "none")),
                    ("share", _sig(share)),
                    ("annotations", _nms(cls.annotations.get(day.day, ()))),
                ),
            )
        )
    for reason in book.degrade_reasons:
        rows.append(("oracle-degrade:", (("kind", _tok("degrade_reason")), ("name", _tok(reason)))))
    for flag, value in book.flags.items():
        fields: list[tuple[str, Val]] = [("kind", _tok("flag")), ("name", _tok(flag))]
        if isinstance(value, bool):
            fields.append(("state", _tok("true" if value else "false")))
        elif isinstance(value, int) and value >= 0:
            fields.append(("count", _cnt(value)))
        rows.append(("oracle-degrade:", tuple(fields)))
    for list_name, members in (
        ("unpriced_native_keys", book.unpriced_native_keys),
        ("no_capital_exited_keys", book.no_capital_exited_keys),
        ("failing_key_exits", book.failing_key_exits),
    ):
        if members:
            rows.append(
                (
                    "oracle-degrade:",
                    (("kind", _tok("exit_list")), ("name", _tok(list_name)), ("count", _cnt(len(members)))),
                )
            )
    rows.append(
        (
            "oracle-verdict:",
            (
                ("verdict", _nm(decide_verdict(analysis))),
                ("withheld_published", _cnt(len(withheld))),
                ("omission_unexplained", _cnt(len(unexplained))),
                ("key_set", _nm("reproduced" if ks.reproduced else "not_reproduced")),
            ),
        )
    )
    return _render_rows(rows)


# ── the read-only statements the orchestrator runs ───────────────────────────────────────────────

# Each statement is a single SELECT or WITH, ends in ``;``, carries psql-style placeholders only
# (``:'book_id'``) that the orchestrator fills in privately, and writes nothing. The ``api_keys``
# columns in ``book_key_rows`` are the ones ``job_worker.run_derive_allocator_equity_job`` selects
# in its ``_load_keys``; ``venue_account_id`` is replaced by a rank so that no account identifier
# leaves the database. ``key_array_by_year`` serves the book's ``returns`` (``:'kind'`` =
# ``equity_curve``, ``:'field'`` = ``returns``) and every per-key array, one year at a time.
_SQL_STATEMENTS: Final[tuple[tuple[str, str, str], ...]] = (
    (
        "book_curve",
        "the book's stored curve: everything but the returns array (fetch that with key_array_by_year)",
        "SELECT payload -> 'flags' AS flags,\n"
        "       payload -> 'degrade_reasons' AS degrade_reasons,\n"
        "       payload -> 'inputs' AS inputs,\n"
        "       payload -> 'unpriced_native_keys' AS unpriced_native_keys,\n"
        "       payload -> 'no_capital_exited_keys' AS no_capital_exited_keys,\n"
        "       payload -> 'failing_key_exits' AS failing_key_exits,\n"
        "       jsonb_array_length(payload -> 'returns') AS n_returns\n"
        "  FROM allocator_equity_derived\n"
        " WHERE allocator_id = :'book_id' AND kind = 'equity_curve';",
    ),
    (
        "book_key_kinds",
        "the key_inputs rows under the book (one kind per key)",
        "SELECT kind\n"
        "  FROM allocator_equity_derived\n"
        " WHERE allocator_id = :'book_id' AND kind LIKE 'key_inputs:%'\n"
        " ORDER BY kind;",
    ),
    (
        "key_scalars",
        "one key's scalar fields (run once per :'key_kind')",
        "SELECT payload -> 'realized_terminal_day' AS realized_terminal_day,\n"
        "       payload -> 'realized_terminal_usd' AS realized_terminal_usd,\n"
        "       payload -> 'anchor_usd' AS anchor_usd,\n"
        "       payload -> 'anchor_null_reason' AS anchor_null_reason,\n"
        "       payload -> 'options_cash_basis' AS options_cash_basis,\n"
        "       payload -> 'writer_basis_withheld' AS writer_basis_withheld,\n"
        "       payload -> 'tiny_base_days' AS tiny_base_days\n"
        "  FROM allocator_equity_derived\n"
        " WHERE allocator_id = :'book_id' AND kind = :'key_kind';",
    ),
    (
        "key_array_by_year",
        "one array field of one row, sliced to [:'from_day', :'to_day') (the day key is date or utc_day_iso)",
        "SELECT jsonb_path_query_array(\n"
        "         payload -> :'field',\n"
        "         '$[*] ? ((@.date >= $lo && @.date < $hi) || (@.utc_day_iso >= $lo && @.utc_day_iso < $hi))',\n"
        "         jsonb_build_object('lo', :'from_day'::text, 'hi', :'to_day'::text)\n"
        "       ) AS slice\n"
        "  FROM allocator_equity_derived\n"
        " WHERE allocator_id = :'book_id' AND kind = :'kind';",
    ),
    (
        "book_key_rows",
        "the api_keys columns the compose job selects, account id replaced by a rank",
        "SELECT id, is_active, sync_status, disconnected_at, exchange,\n"
        "       dense_rank() OVER (ORDER BY exchange, venue_account_id) AS account_group,\n"
        "       account_shared_with_api_key_id, account_share_kind, history_inclusion\n"
        "  FROM api_keys\n"
        " WHERE user_id = :'book_id'\n"
        " ORDER BY account_group, id;",
    ),
    (
        "key_return_days",
        "one key's csv_daily_returns days in [:'from_day', :'to_day'), as one JSON array of ISO days (NULL when none)",
        "SELECT jsonb_agg(to_char(date, 'YYYY-MM-DD') ORDER BY date) AS days\n"
        "  FROM csv_daily_returns\n"
        " WHERE allocator_id = :'book_id' AND api_key_id = :'key_id'\n"
        "   AND date >= :'from_day'::date AND date < :'to_day'::date;",
    ),
)
SQL_LABELS: Final[tuple[str, ...]] = tuple(label for label, _what, _sql in _SQL_STATEMENTS)


def print_sql(labels: Sequence[str] = ()) -> str:
    """The statements under their labels, ``;``-terminated; every statement when no label is given."""
    by_label = {label: (what, sql) for label, what, sql in _SQL_STATEMENTS}
    wanted = list(labels) if labels else list(SQL_LABELS)
    parts: list[str] = []
    for label in wanted:
        if label not in by_label:
            raise ValueError("unknown statement label")
        what, sql = by_label[label]
        parts.append(f"-- oracle ({label}): {what}\n{sql}\n")
    return "\n".join(parts)


_PRINT_SQL_USAGE: Final = "usage: deribit_book_oracle.py [--print-sql[=<label>,...] | --input <export.json>]"


def _print_sql_main(args: Sequence[str]) -> int:
    """``--print-sql`` takes no other argument: it touches no database and reads no export."""
    if len(args) != 1:
        print("failed: --print-sql takes no other argument", file=sys.stderr)
        print(_PRINT_SQL_USAGE, file=sys.stderr)
        return 2
    labels = [x for x in args[0].partition("=")[2].split(",") if x] if "=" in args[0] else []
    try:
        text = print_sql(labels)
    except ValueError:
        print("failed: unknown --print-sql label (known: " + ", ".join(SQL_LABELS) + ")", file=sys.stderr)
        return 2
    sys.stdout.write(text)
    return 0


# ── entry point ────────────────────────────────────────────────────────────────────────────────


def main(argv: Sequence[str] | None = None) -> int:
    args_in = list(sys.argv[1:] if argv is None else argv)
    if any(a == "--print-sql" or a.startswith("--print-sql=") for a in args_in):
        return _print_sql_main(args_in)
    parser = argparse.ArgumentParser(
        prog="deribit_book_oracle",
        description="Independent per-day attribution oracle for the Deribit book (offline export).",
    )
    parser.add_argument("--input", required=True, help="path to the offline export (JSON)")
    args = parser.parse_args(argv)
    try:
        analysis = analyse(load_export(args.input))
        lines = emit_reading(analysis)
        verdict = decide_verdict(analysis)
    except ExportError as exc:
        # The message names a field path only, by construction.
        print(f"failed: ExportError ({exc})", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - a message can carry an id: print the type only
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return 2
    print("\n".join(lines))
    return EXIT_CODES[verdict]


if __name__ == "__main__":
    sys.exit(main())
