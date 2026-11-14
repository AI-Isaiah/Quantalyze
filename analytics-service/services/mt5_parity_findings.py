"""MT5 parity findings: flag classification, cross-surface findings, tracked records.

Success criterion 5 of the parity harness and its tracked census record. This module
turns what the harness measured into text that is safe to commit:

* every stored data-quality flag key gets exactly one class from a CLOSED table built
  from the key tuples ``services.nav_twr`` exports, so a new guard key propagates here
  by construction and an unseen key is ``unknown``, never guessed;
* every cross-surface discrepancy in the surface matrix becomes a named finding with a
  bucket from the one taxonomy in ``services.mt5_parity`` and a root-cause lead;
* the raw census becomes a record per account label;
* ``scan_tracked_text`` is the backstop: it names the rules a text breaks, never the
  text that broke them.

The flag classes are a PROPOSAL for the Phase 155.2 founder sign-off, not a verdict.

PURE. It imports stdlib, ``services.mt5_parity``, ``services.mt5_parity_capture``,
``services.nav_twr`` and ``services.parity_diff``; no database, gateway or network can
be reached from here, and no path is read or written. A rendered record has no field
that can carry an amount, a login, a server, an id or a home path: every float passes
through ``ratio_3sf``, every instant is cut to the minute, every account is a label.
"""
from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta, timezone
from types import MappingProxyType
from typing import Any, Final, Literal

from services.mt5_parity import (
    ANNUALIZATION_CONVENTION,
    BUCKET_LABELS,
    MT5_INCEPTION_IDENTITY_BAND,
    MT5_PARITY_TOLERANCE,
    UNEXPLAINED,
    WEEKEND_ATTESTED_FROM_UTC_HOUR,
    WEEKEND_ATTESTED_TO_UTC_HOUR,
    ratio_3sf,
)
from services.mt5_parity_capture import EXCLUDED_LABEL, parse_utc
from services.nav_twr import (
    NAV_TWR_ANNOTATION_KEYS,
    NAV_TWR_GUARD_KEYS,
    NAV_TWR_LEGACY_GUARD_KEYS,
)
from services.parity_diff import REANNUALIZATION_FACTOR

# --------------------------------------------------------------------------- flags

FlagClass = Literal["explained_acceptable", "defect", "unknown"]

# The marks flags the derive writes beside the annotation keys. ``mark_gap_days`` is in
# this tuple but NOT in the table below: its class depends on its value.
MARKS_KEYS: Final[tuple[str, ...]] = (
    "marks_since",
    "marks_covered_from",
    "marks_trailing_since",
    "mark_gap_days",
)
_VALUE_DEPENDENT_KEY: Final = "mark_gap_days"
_STATUS_WITH_WARNINGS: Final = "complete_with_warnings"
_EXPLAINED_EXTRA: Final[tuple[str, ...]] = (
    "marks_since",
    "marks_covered_from",
    "marks_trailing_since",
    "cumulative_method",
    "native_unit",
)


def _build_flag_table() -> Mapping[str, FlagClass]:
    table: dict[str, FlagClass] = {}
    for key in (*NAV_TWR_GUARD_KEYS, *NAV_TWR_LEGACY_GUARD_KEYS):
        table[key] = "defect"
    for key in (*NAV_TWR_ANNOTATION_KEYS, *_EXPLAINED_EXTRA):
        if key in table:
            raise AssertionError("a flag key is both a guard and an annotation")
        table[key] = "explained_acceptable"
    return MappingProxyType(table)


# PROPOSED classes (Phase 155.2 signs them off): a guard key dropped a return or broke the
# chain; an annotation or marks key only says how the figure was measured.
FLAG_CLASSIFICATION: Final[Mapping[str, FlagClass]] = _build_flag_table()
_GUARD_KEY_SET: Final[frozenset[str]] = frozenset(
    (*NAV_TWR_GUARD_KEYS, *NAV_TWR_LEGACY_GUARD_KEYS)
)


def classify_flag(key: str, value: object) -> FlagClass:
    """The proposed class of one stored flag key; ``unknown`` outside the closed table."""
    if key == _VALUE_DEPENDENT_KEY:
        if isinstance(value, (list, tuple)):
            return "defect" if len(value) > 0 else "explained_acceptable"
        return "unknown"
    return FLAG_CLASSIFICATION.get(key, "unknown")


# ------------------------------------------------------------------------ findings

FindingKind = Literal["flag", "surface", "cross_store"]

_LABEL_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
_WORD_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_REASON_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_:-]{1,64}$")
_SYMBOL_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_ ]{1,120}$")
_SURFACE_RE: Final[re.Pattern[str]] = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_REASON_FALLBACK: Final = "reason_not_renderable"


class LabelMissing(ValueError):
    """A census or matrix ordinal with no usable label: nothing is rendered for it."""


class MatrixMismatch(ValueError):
    """The matrix's account labels differ from the capture's labels."""


@dataclass(frozen=True, slots=True)
class FlagReading:
    account_label: str
    key: str
    flag_class: FlagClass
    computed_at_minute: str


@dataclass(frozen=True, slots=True)
class Finding:
    """One named discrepancy. ``lead`` is a fixed-template sentence naming keys,
    surface ids, symbols, ISO dates, day counts and 3-s.f. ratios, never a raw figure."""

    id: str
    kind: FindingKind
    subject: str
    account_label: str
    bucket: str
    lead: str


@dataclass(frozen=True, slots=True)
class Observation:
    """Something the matrix recorded that is not a discrepancy."""

    account_label: str
    surface: str
    reason: str


def number_findings(findings: Iterable[Finding]) -> tuple[Finding, ...]:
    """Sort deterministically and assign ``F-155-NN`` ids in that order."""
    ordered = sorted(
        findings, key=lambda f: (f.kind, f.account_label, f.subject, f.bucket, f.lead)
    )
    return tuple(replace(f, id=f"F-155-{i:02d}") for i, f in enumerate(ordered, start=1))


def _checked_label(value: object, where: str) -> str:
    if not isinstance(value, str) or not value:
        raise LabelMissing(f"{where} has no label")
    if not _LABEL_RE.match(value):
        raise ValueError(f"{where} carries a label that is not a plain account label")
    return value


def _minute(value: object, column: str) -> str:
    """An instant cut to the minute, ``n/a`` when absent. A malformed one is refused."""
    if value is None:
        return "n/a"
    return parse_utc(value, column).strftime("%Y-%m-%dT%H:%MZ")


def _safe_reason(value: object) -> str:
    if isinstance(value, str) and _REASON_RE.match(value):
        return value
    return _REASON_FALLBACK


def classify_account_flags(
    label: str, analytics_row: Mapping[str, Any]
) -> tuple[tuple[FlagReading, ...], tuple[Finding, ...]]:
    """Classify every stored flag key of one account.

    Each defect or unknown key is a finding of kind ``flag``. A warned status with no
    guard key stored has no named cause and is an unknown finding of its own."""
    _checked_label(label, "flag classification")
    computed = _minute(analytics_row.get("computed_at"), "computed_at")
    flags = analytics_row.get("data_quality_flags")
    status = analytics_row.get("computation_status")
    readings: list[FlagReading] = []
    findings: list[Finding] = []

    if flags is None:
        flags = {}
    if not isinstance(flags, Mapping):
        findings.append(
            Finding(
                "", "flag", "data_quality_flags", label, "unknown",
                "the stored data_quality_flags is not an object, so no flag key can be read",
            )
        )
        return tuple(readings), tuple(findings)

    for key in sorted(str(k) for k in flags):
        value = flags[key]
        flag_class = classify_flag(key, value)
        readings.append(FlagReading(label, key, flag_class, computed))
        if flag_class == "explained_acceptable":
            continue
        if not _WORD_RE.match(key):
            shown = "a key that is not a plain identifier"
        else:
            shown = key
        if flag_class == "defect" and key == _VALUE_DEPENDENT_KEY:
            lead = (
                f"stored flag {shown} lists {len(value)} flagged mark gap day(s), "
                "so the series has gaps its marks could not fill"
            )
        elif flag_class == "defect":
            lead = (
                f"stored flag {shown} is a guard: it dropped a return or broke "
                "the chain (proposed defect, 155.2 signs off)"
            )
        else:
            lead = f"stored flag {shown} is outside the closed flag table; 155.2 classifies it"
        findings.append(Finding("", "flag", shown, label, flag_class, lead))

    if status == _STATUS_WITH_WARNINGS and not any(k in _GUARD_KEY_SET for k in flags):
        findings.append(
            Finding(
                "", "flag", "computation_status", label, "unknown",
                "computation_status is complete_with_warnings but no key from the closed guard "
                "table is stored, so the warning has no cause this table names",
            )
        )
    return tuple(readings), tuple(findings)


# ----------------------------------------------------------------------- matchers

ANNUALIZATION_MATCH_SIG_FIGS: Final[int] = 3


def _same_sig_figs(x: float, y: float) -> bool:
    spec = f".{ANNUALIZATION_MATCH_SIG_FIGS}g"
    return format(x, spec) == format(y, spec)


def matches_reannualization(a: float, b: float) -> bool:
    """True when two CAGRs differ only by the 252 to 365 basis shift.

    ``(1 + new) = (1 + old) ** (365 / 252)``, so ``ln(1+a) / ln(1+b)`` is the factor or
    its inverse, compared at ``ANNUALIZATION_MATCH_SIG_FIGS``. False for equal values,
    a return at or below -1, a non-finite value, or a zero log."""
    if not (math.isfinite(a) and math.isfinite(b)) or a <= -1.0 or b <= -1.0 or a == b:
        return False
    log_a, log_b = math.log1p(a), math.log1p(b)
    if log_a == 0.0 or log_b == 0.0:
        return False
    return _same_sig_figs(log_a / log_b, REANNUALIZATION_FACTOR) or _same_sig_figs(
        log_b / log_a, REANNUALIZATION_FACTOR
    )


def matches_sharpe_reannualization(a: float, b: float) -> bool:
    """True when two Sharpe ratios differ only by the square root of the factor."""
    if not (math.isfinite(a) and math.isfinite(b)) or a == 0.0 or b == 0.0 or a == b:
        return False
    root = math.sqrt(REANNUALIZATION_FACTOR)
    return _same_sig_figs(a / b, root) or _same_sig_figs(b / a, root)


# ------------------------------------------------------------------------- matrix

SURFACE_ORDER: Final[tuple[str, ...]] = (
    "factsheet",
    "share_card",
    "factsheet_pdf",
    "allocations_strategies_panel",
    "allocations_live_baseline",
    "scenario_composer_book",
    "scenario_composer_route",
    "owner_list_card",
    "discovery_card",
)
_CELL_STATES: Final[frozenset[str]] = frozenset(
    {"value", "withheld", "not_applicable", "same_as", "error"}
)
_VISIBILITIES: Final[frozenset[str]] = frozenset(
    {"owner_visible", "not_rendered_while_unpublished"}
)
_NOT_RENDERED: Final = "not_rendered_while_unpublished"
_GATE_STATES: Final[frozenset[str]] = frozenset({"shown", "short", "withheld"})
_GATED_FIGURES: Final[tuple[str, ...]] = ("cagr", "sharpe", "max_drawdown")
_UNIT_VIEWS: Final[frozenset[str]] = frozenset({"native", "usd"})
_MATRIX_VERSION: Final = 1

# Figures a surface is built NOT to carry: the surfaces test fills them from NO_FIGURES,
# so a null there is the design and not a gap. Any other surface that shows null for
# a compared figure (cumulative_return, last_return_date, max_drawdown, cagr, sharpe)
# while a sibling shows a value is a finding, unless the cell's own gate state withholds it.
_NOT_CARRIED_BY_DESIGN: Final[Mapping[str, frozenset[str]]] = MappingProxyType(
    {
        "share_card": frozenset({"cumulative_return", "last_return_date"}),
        "allocations_strategies_panel": frozenset({"cumulative_return", "last_return_date", "cagr"}),
        "allocations_live_baseline": frozenset({"cagr"}),
    }
)


@dataclass(frozen=True, slots=True)
class _Cell:
    surface: str
    symbol: str
    visibility: str
    state: str
    reason: str
    unit_view: str
    cum: float | None
    last: str | None
    cagr: float | None
    sharpe: float | None
    mdd: float | None
    gate: Mapping[str, str | None]

    def number(self, figure: str) -> float | None:
        return {
            "cumulative_return": self.cum,
            "cagr": self.cagr,
            "sharpe": self.sharpe,
            "max_drawdown": self.mdd,
        }[figure]


def _mapping(value: object, where: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{where} is not an object")
    return value


def _figure_number(figs: Mapping[str, Any], name: str, where: str) -> float | None:
    value = figs.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{where}: figure {name} is not a number")
    if not math.isfinite(value):
        raise ValueError(f"{where}: figure {name} is not finite")
    return float(value)


def _figure_day(figs: Mapping[str, Any], where: str) -> str | None:
    value = figs.get("last_return_date")
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{where}: figure last_return_date is not a date string")
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise ValueError(f"{where}: figure last_return_date is not an ISO date") from None


def _parse_cell(label: str, raw: object) -> _Cell:
    cell = _mapping(raw, f"{label}: a matrix cell")
    surface = cell.get("surface")
    if not isinstance(surface, str) or not _SURFACE_RE.match(surface):
        raise ValueError(f"{label}: a cell has no plain surface id")
    where = f"{label} {surface}"
    state = cell.get("state")
    if state not in _CELL_STATES:
        raise ValueError(f"{where}: cell state is outside the five known states")
    visibility = cell.get("visibility")
    if visibility not in _VISIBILITIES:
        raise ValueError(f"{where}: cell visibility is outside the two known values")
    unit_view = cell.get("unit_view", "native")
    if unit_view not in _UNIT_VIEWS:
        raise ValueError(f"{where}: unit_view is neither native nor usd")
    symbol = cell.get("symbol")
    symbol_text = symbol if isinstance(symbol, str) and _SYMBOL_RE.match(symbol) else "an unnamed symbol"
    figs = _mapping(cell.get("figures", {}), f"{where}: figures")
    raw_gate = _mapping(cell.get("figure_states", {}), f"{where}: figure_states")
    gate: dict[str, str | None] = {}
    for name in _GATED_FIGURES:
        g = raw_gate.get(name)
        if g is not None and g not in _GATE_STATES:
            raise ValueError(f"{where}: figure_states {name} is outside shown, short, withheld")
        gate[name] = g
    return _Cell(
        surface=surface,
        symbol=symbol_text,
        visibility=str(visibility),
        state=str(state),
        reason=_safe_reason(cell.get("reason")),
        unit_view=str(unit_view),
        cum=_figure_number(figs, "cumulative_return", where),
        last=_figure_day(figs, where),
        cagr=_figure_number(figs, "cagr", where),
        sharpe=_figure_number(figs, "sharpe", where),
        mdd=_figure_number(figs, "max_drawdown", where),
        gate=MappingProxyType(gate),
    )


def _surface_rank(surface: str) -> tuple[int, str]:
    try:
        return SURFACE_ORDER.index(surface), surface
    except ValueError:
        return len(SURFACE_ORDER), surface


def _times_tolerance(gap: float) -> str:
    return ratio_3sf(gap / MT5_PARITY_TOLERANCE)


def _int_field(source: Mapping[str, Any], name: str, where: str) -> int:
    value = source.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{where}: {name} is not a non-negative integer")
    return value


def _cross_store_finding(label: str, raw: object) -> Finding | None:
    if raw is None:
        return None
    store = _mapping(raw, f"{label}: cross_store")
    differing = _int_field(store, "days_differing", f"{label} cross_store")
    if differing == 0:
        return None
    compared = _int_field(store, "days_compared", f"{label} cross_store")
    first = store.get("first_differing_day")
    if not isinstance(first, str):
        raise ValueError(f"{label} cross_store: first_differing_day is not a date string")
    try:
        first_day = date.fromisoformat(first[:10]).isoformat()
    except ValueError:
        raise ValueError(f"{label} cross_store: first_differing_day is not an ISO date") from None
    return Finding(
        "", "cross_store", "cross_store", label, UNEXPLAINED,
        f"the strategy series and the per-key return rows differ on {differing} of "
        f"{compared} days compared, first on {first_day}",
    )


def _classify_account(
    label: str, account: Mapping[str, Any]
) -> tuple[list[Finding], list[Observation]]:
    findings: list[Finding] = []
    observations: list[Observation] = []
    raw_cells = account.get("cells")
    if not isinstance(raw_cells, list):
        raise ValueError(f"{label}: cells is not a list")
    cells = sorted((_parse_cell(label, c) for c in raw_cells), key=lambda c: _surface_rank(c.surface))

    candidates: list[_Cell] = []
    for cell in cells:
        if cell.visibility == _NOT_RENDERED:
            observations.append(Observation(label, cell.surface, _NOT_RENDERED))
        elif cell.state == "not_applicable":
            observations.append(Observation(label, cell.surface, f"not_applicable:{cell.reason}"))
        elif cell.state == "same_as":
            continue
        elif cell.state == "error":
            findings.append(
                Finding(
                    "", "surface", f"{cell.surface}.state", label, UNEXPLAINED,
                    f"{cell.surface} ({cell.symbol}) raised {cell.reason} while computing "
                    "this account",
                )
            )
        else:
            candidates.append(cell)

    values = [c for c in candidates if c.state == "value"]
    withheld_cells = [c for c in candidates if c.state == "withheld"]
    comparable: list[_Cell] = []
    if values:
        # The unit view the comparison runs in is the factsheet's, else the first value
        # cell's; a cell in the other view is recorded, never compared.
        primary = next((c for c in values if c.surface == "factsheet"), values[0])
        for cell in values:
            if cell.unit_view == primary.unit_view:
                comparable.append(cell)
            else:
                observations.append(Observation(label, cell.surface, "not_compared:unit_view"))
    findings.extend(_compare_account(label, comparable))
    if withheld_cells and not values:
        observations.append(Observation(label, "all_surfaces", "withheld:no_surface_shows_a_figure"))
    shower = next((c for c in comparable if any(c.gate[f] == "shown" for f in _GATED_FIGURES)), None)
    if shower is not None:
        for cell in withheld_cells:
            findings.append(
                Finding(
                    "", "surface", f"{cell.surface}.state", label, UNEXPLAINED,
                    f"{cell.surface} withholds every figure while {_anchor_desc(shower, 'figures')} "
                    "shows them: figure gate disagrees across surfaces",
                )
            )

    cross = _cross_store_finding(label, account.get("cross_store"))
    if cross is not None:
        findings.append(cross)
    return findings, observations


def _anchor_desc(anchor: _Cell, what: str) -> str:
    if anchor.surface == "factsheet":
        return "the factsheet cell"
    return f"the {anchor.surface} cell (fallback reference: the factsheet does not carry {what})"


def _first(cells: Sequence[_Cell], carries: Callable[[_Cell], bool]) -> _Cell | None:
    return next((c for c in cells if carries(c)), None)


def _has_number(figure: str) -> Callable[[_Cell], bool]:
    return lambda c: c.number(figure) is not None


def _has_gate(figure: str) -> Callable[[_Cell], bool]:
    return lambda c: c.gate[figure] is not None


def _should_carry(cell: _Cell, figure: str) -> bool:
    """False where the surface is built without the figure, or where the cell's own gate
    withholds it. Only `withheld` does: src/lib/figure-gate.ts says the window qualifies a
    figure (short or full) and never withholds one, so a `short` or unknown cell still
    shows its figure and a dash there is a presence finding."""
    return (
        figure not in _NOT_CARRIED_BY_DESIGN.get(cell.surface, frozenset())
        and cell.gate.get(figure) != "withheld"
    )


def _compare_account(label: str, cells: Sequence[_Cell]) -> list[Finding]:
    """Compare the cells of one unit view, anchoring EACH figure on the first cell in
    surface order that carries that figure (the factsheet when it does). One anchor for
    all figures would let a figure the anchor lacks go uncompared."""
    found: list[Finding] = []

    def add(cell: _Cell, figure: str, bucket: str, lead: str) -> None:
        found.append(Finding("", "surface", f"{cell.surface}.{figure}", label, bucket, lead))

    for figure in ("cumulative_return", "max_drawdown"):
        anchor = _first(cells, _has_number(figure))
        if anchor is None:
            continue
        a = anchor.number(figure)
        name = figure.replace("_", " ")
        for cell in cells:
            b = cell.number(figure)
            if (
                cell is not anchor and a is not None and b is None
                and _should_carry(cell, figure)
            ):
                add(
                    cell, figure, UNEXPLAINED,
                    f"{cell.surface} carries no {name} while {_anchor_desc(anchor, name)} "
                    "shows one: figure presence disagrees across surfaces",
                )
                continue
            if cell is anchor or a is None or b is None or abs(a - b) <= MT5_PARITY_TOLERANCE:
                continue
            add(
                cell, figure, UNEXPLAINED,
                f"{cell.surface} and {_anchor_desc(anchor, name)} disagree on {name} by "
                f"{_times_tolerance(abs(a - b))} times the parity tolerance",
            )

    day_anchor = _first(cells, lambda c: c.last is not None)
    if day_anchor is not None:
        for cell in cells:
            if cell is not day_anchor and cell.last is None and _should_carry(cell, "last_return_date"):
                add(
                    cell, "last_return_date", UNEXPLAINED,
                    f"{cell.surface} carries no last return date while "
                    f"{_anchor_desc(day_anchor, 'a last return date')} ends {day_anchor.last}: "
                    "figure presence disagrees across surfaces",
                )
                continue
            if cell is day_anchor or cell.last is None or cell.last == day_anchor.last:
                continue
            add(
                cell, "last_return_date", UNEXPLAINED,
                f"series ends on a different day: {cell.surface} ends {cell.last}, "
                f"{_anchor_desc(day_anchor, 'a last return date')} ends {day_anchor.last}",
            )

    cagr_anchor = _first(cells, lambda c: c.gate["cagr"] != "withheld" and c.cagr is not None)
    if cagr_anchor is not None and cagr_anchor.cagr is not None:
        ca = cagr_anchor.cagr
        for cell in cells:
            cb = cell.cagr
            if cell is not cagr_anchor and cb is None and _should_carry(cell, "cagr"):
                add(
                    cell, "cagr", UNEXPLAINED,
                    f"{cell.surface} carries no cagr while {_anchor_desc(cagr_anchor, 'a shown CAGR')} "
                    "shows one: figure presence disagrees across surfaces",
                )
                continue
            if (
                cell is cagr_anchor or cell.gate["cagr"] == "withheld" or cb is None
                or abs(ca - cb) <= MT5_PARITY_TOLERANCE
            ):
                continue
            who = f"{cell.surface} and {_anchor_desc(cagr_anchor, 'a shown CAGR')}"
            if matches_reannualization(ca, cb):
                add(
                    cell, "cagr", ANNUALIZATION_CONVENTION,
                    f"{who} differ by the 252 to 365 basis shift on CAGR "
                    f"(log ratio {ratio_3sf(_log_ratio(ca, cb))}, factor "
                    f"{ratio_3sf(REANNUALIZATION_FACTOR)}): one surface reannualizes",
                )
            else:
                add(
                    cell, "cagr", UNEXPLAINED,
                    f"{who} disagree on CAGR by {_times_tolerance(abs(ca - cb))} times the "
                    "parity tolerance and no reannualization explains it",
                )

    sharpe_anchor = _first(cells, lambda c: c.gate["sharpe"] != "withheld" and c.sharpe is not None)
    if sharpe_anchor is not None and sharpe_anchor.sharpe is not None:
        sa = sharpe_anchor.sharpe
        for cell in cells:
            sb = cell.sharpe
            if cell is not sharpe_anchor and sb is None and _should_carry(cell, "sharpe"):
                add(
                    cell, "sharpe", UNEXPLAINED,
                    f"{cell.surface} carries no sharpe while {_anchor_desc(sharpe_anchor, 'a shown Sharpe')} "
                    "shows one: figure presence disagrees across surfaces",
                )
                continue
            if (
                cell is sharpe_anchor or cell.gate["sharpe"] == "withheld" or sb is None
                or ratio_3sf(sa) == ratio_3sf(sb)
            ):
                continue
            who = f"{cell.surface} and {_anchor_desc(sharpe_anchor, 'a shown Sharpe')}"
            if matches_sharpe_reannualization(sa, sb):
                add(
                    cell, "sharpe", ANNUALIZATION_CONVENTION,
                    f"{who} differ by the square root of the 252 to 365 factor on Sharpe "
                    f"(ratio {ratio_3sf(_quotient(sa, sb))}): one surface reannualizes",
                )
            else:
                add(
                    cell, "sharpe", UNEXPLAINED,
                    f"{who} disagree on Sharpe at three significant figures and no "
                    "reannualization explains it",
                )

    for figure in _GATED_FIGURES:
        gate_anchor = _first(cells, _has_gate(figure))
        if gate_anchor is None:
            continue
        anchor_state = gate_anchor.gate[figure]
        for cell in cells:
            state = cell.gate[figure]
            if cell is gate_anchor or state is None:
                continue
            if (anchor_state == "shown") != (state == "shown"):
                add(
                    cell, figure, UNEXPLAINED,
                    f"figure gate disagrees across surfaces: {cell.surface} is {state} on "
                    f"{figure} while {_anchor_desc(gate_anchor, 'a ' + figure + ' gate state')} "
                    f"is {anchor_state}",
                )
    return found


def _quotient(a: float, b: float) -> float | None:
    if b == 0.0:
        return None
    return a / b


def _log_ratio(a: float, b: float) -> float | None:
    la, lb = math.log1p(a), math.log1p(b)
    if la == 0.0 or lb == 0.0:
        return None
    big, small = (la, lb) if abs(la) >= abs(lb) else (lb, la)
    return big / small


def matrix_labels(matrix: Mapping[str, Any]) -> frozenset[str]:
    """The account labels a matrix holds; an account with none is refused."""
    accounts = matrix.get("accounts")
    if not isinstance(accounts, list):
        raise ValueError("matrix has no accounts list")
    return frozenset(
        _checked_label(_mapping(a, "a matrix account").get("label"), "a matrix account")
        for a in accounts
    )


def require_matching_labels(matrix: Mapping[str, Any], capture_labels: Iterable[str]) -> None:
    """Refuse a matrix whose account labels differ from the capture's."""
    held = matrix_labels(matrix)
    expected = frozenset(capture_labels)
    if held != expected:
        extra = sorted(held - expected)
        missing = sorted(expected - held)
        raise MatrixMismatch(
            f"matrix labels differ from the capture's: only in the matrix {extra}, "
            f"only in the capture {missing}"
        )


def require_matching_manifest(matrix: Mapping[str, Any], manifest_sha256: str) -> None:
    """Refuse a matrix that does not name the sealed capture it was built from.

    ``capture_manifest_sha256`` is the sha256 hex of the bytes of
    ``sealed/manifest.json`` (the content of its ``.sha256`` sidecar). A matrix left
    over from an earlier capture with the same labels carries a different digest."""
    held = matrix.get("capture_manifest_sha256")
    if not isinstance(held, str) or not held:
        raise MatrixMismatch("matrix carries no capture_manifest_sha256")
    if held != manifest_sha256:
        raise MatrixMismatch("matrix was built from a different sealed capture manifest")


def classify_matrix(
    matrix: Mapping[str, Any],
) -> tuple[tuple[Finding, ...], tuple[Observation, ...]]:
    """Every cross-surface discrepancy as a named, numbered finding."""
    if matrix.get("matrix_version") != _MATRIX_VERSION:
        raise ValueError("matrix_version is not 1")
    accounts = matrix.get("accounts")
    if not isinstance(accounts, list):
        raise ValueError("matrix has no accounts list")
    findings: list[Finding] = []
    observations: list[Observation] = []
    for raw in accounts:
        account = _mapping(raw, "a matrix account")
        label = _checked_label(account.get("label"), "a matrix account")
        account_findings, account_observations = _classify_account(label, account)
        findings.extend(account_findings)
        observations.extend(account_observations)
    for finding in findings:
        if finding.bucket not in BUCKET_LABELS:
            raise AssertionError("a finding names a bucket outside the taxonomy")
    ordered_obs = tuple(
        sorted(set(observations), key=lambda o: (o.account_label, _surface_rank(o.surface), o.reason))
    )
    return number_findings(findings), ordered_obs


# ------------------------------------------------------------------------ renderers

_SERVER_LITERAL: Final = "unmeasured (155.1 reading owns it)"
_UNPUBLISHED_TEXT: Final = "unpublished: not rendered on published-only surfaces"
_STATUS_WORD_RE: Final[re.Pattern[str]] = re.compile(r"^[a-z_]{1,24}$")
_CURRENCY_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Z]{2,10}$")
_FLAG_KEY_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_NA: Final = "n/a"


def _real(value: object, column: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"column {column} is a boolean, not a number")
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ValueError(f"column {column} is not numeric") from None
    if not math.isfinite(result):
        raise ValueError(f"column {column} is not finite")
    return result


def _ratio_cell(value: object, column: str) -> str:
    return ratio_3sf(_real(value, column))


def _count_cell(value: object, column: str) -> str:
    number = _real(value, column)
    if number is None:
        return _NA
    if number != int(number):
        raise ValueError(f"column {column} is not a whole number")
    return str(int(number))


def _day_cell(value: object, column: str) -> str:
    if value is None:
        return _NA
    if not isinstance(value, str):
        raise ValueError(f"column {column} is not a date string")
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise ValueError(f"column {column} is not an ISO date") from None


def _yes_no(value: object, column: str) -> str:
    if value is None:
        return _NA
    if not isinstance(value, bool):
        raise ValueError(f"column {column} is not a boolean")
    return "yes" if value else "no"


def _word_list(value: object, column: str, pattern: re.Pattern[str]) -> tuple[str, ...]:
    if value is None:
        return ()
    items: list[object]
    if isinstance(value, str):
        items = [p for p in value.strip("{}").split(",") if p]
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        raise ValueError(f"column {column} is not a list")
    out: list[str] = []
    for item in items:
        if not isinstance(item, str) or not pattern.match(item):
            raise ValueError(f"column {column} holds an entry that is not a plain word")
        out.append(item)
    return tuple(out)


def _status_cell(row: Mapping[str, Any]) -> str:
    statuses = _word_list(row.get("strategy_statuses"), "strategy_statuses", _STATUS_WORD_RE)
    if not statuses:
        return "no strategy linked"
    return " / ".join(_UNPUBLISHED_TEXT if s == "draft" else s for s in statuses)


def _unit_cell(row: Mapping[str, Any]) -> str:
    currency = row.get("account_currency")
    if currency is None:
        shown = _NA  # NULL is normal: an MT5 key before its first post-deploy derive
    elif isinstance(currency, str) and _CURRENCY_RE.match(currency):
        shown = currency
    else:
        raise ValueError("column account_currency is not a currency code")
    native = row.get("native_unit_marked")
    if native is not None and not isinstance(native, bool):
        raise ValueError("column native_unit_marked is not a boolean")
    return f"{shown}, native unit marked" if native else shown


def _identity_cell(value: object) -> str:
    ratio = _real(value, "identity_ratio")
    if ratio is None:
        return "not measurable"
    verdict = "within band" if abs(ratio) <= MT5_INCEPTION_IDENTITY_BAND else "outside band"
    return f"{ratio_3sf(ratio)} ({verdict})"


def _server_cell(value: object) -> str:
    if value != _SERVER_LITERAL:
        raise ValueError("column server is not the census literal; a real server is never rendered")
    return _SERVER_LITERAL


def _status_word(value: object, column: str) -> str:
    if value is None:
        return _NA
    if not isinstance(value, str) or not _STATUS_WORD_RE.match(value):
        raise ValueError(f"column {column} is not a plain status word")
    return value


def _flag_keys_cell(value: object) -> str:
    keys = _word_list(value, "flag_keys", _FLAG_KEY_RE)
    return ", ".join(sorted(keys)) if keys else "none"


_ACCOUNT_COLUMNS: Final[tuple[str, ...]] = (
    "Account", "Unit", "Published status", "S raw marks", "S key inputs", "S flags",
    "S agree", "Marks", "Last mark day", "First return", "Last return",
    "Record span days", "Record observations", "Computed at", "Computation status",
    "Flag keys", "Keys sharing login", "Server", "Inception identity",
)


def _account_cells(label: str, row: Mapping[str, Any]) -> tuple[str, ...]:
    return (
        label,
        _unit_cell(row),
        _status_cell(row),
        _day_cell(row.get("s_raw_marks"), "s_raw_marks"),
        _day_cell(row.get("s_key_inputs"), "s_key_inputs"),
        _day_cell(row.get("s_flags"), "s_flags"),
        _yes_no(row.get("s_agree"), "s_agree"),
        _count_cell(row.get("mark_count"), "mark_count"),
        _day_cell(row.get("last_mark_day"), "last_mark_day"),
        _day_cell(row.get("first_return_date"), "first_return_date"),
        _day_cell(row.get("last_return_date"), "last_return_date"),
        _count_cell(row.get("record_span_days"), "record_span_days"),
        _count_cell(row.get("record_observations"), "record_observations"),
        _minute(row.get("computed_at"), "computed_at"),
        _status_word(row.get("computation_status"), "computation_status"),
        _flag_keys_cell(row.get("flag_keys")),
        _count_cell(row.get("keys_sharing_login"), "keys_sharing_login"),
        _server_cell(row.get("server")),
        _identity_cell(row.get("identity_ratio")),
    )


def _attested(friday: date) -> tuple[datetime, datetime]:
    start = datetime.combine(friday, time(WEEKEND_ATTESTED_FROM_UTC_HOUR), tzinfo=timezone.utc)
    end = datetime.combine(
        friday + timedelta(days=2), time(WEEKEND_ATTESTED_TO_UTC_HOUR), tzinfo=timezone.utc
    )
    return start, end


def _edge_window_cell(friday: date, present: bool, marked_at: object) -> str:
    if not present or marked_at is None:
        return "no mark"
    lo, hi = _attested(friday)
    instant = parse_utc(marked_at, "marked_at")
    return "attested" if lo <= instant <= hi else "outside weekend window"


def _table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    lines.extend("| " + " | ".join(r) + " |" for r in rows)
    return lines


def _retained(
    rows: Sequence[Mapping[str, Any]], labels: Mapping[str, str], what: str
) -> tuple[list[tuple[str, Mapping[str, Any]]], Mapping[str, Any]]:
    """Split a census result into labelled account rows and its ``all`` row."""
    summary: Mapping[str, Any] | None = None
    kept: list[tuple[str, Mapping[str, Any]]] = []
    counted = 0
    for row in rows:
        ordinal = row.get("key_ordinal")
        if ordinal == "all":
            if summary is not None:
                raise ValueError(f"{what} has two 'all' rows")
            summary = row
            continue
        counted += 1
        if not isinstance(ordinal, str) or ordinal not in labels:
            raise LabelMissing(f"{what} holds an ordinal with no label")
        label = labels[ordinal]
        if label == EXCLUDED_LABEL:
            continue
        kept.append((_checked_label(label, f"{what} ordinal"), row))
    if summary is None:
        raise ValueError(f"{what} has no 'all' row; the result is truncated or not a census")
    return kept, MappingProxyType({**summary, "_counted": counted})


def render_census_markdown(
    census_rows: Sequence[Mapping[str, Any]],
    edges_rows: Sequence[Mapping[str, Any]],
    labels: Mapping[str, str],
) -> str:
    """The tracked census record: one row per account label and a Friday-edges table."""
    accounts, acc_all = _retained(census_rows, labels, "census-accounts")
    edges, edge_all = _retained(edges_rows, labels, "census-edges")
    keys_examined = _real(acc_all.get("keys_examined"), "keys_examined")
    rows_examined = _real(edge_all.get("rows_examined"), "rows_examined")
    if keys_examined is None or int(keys_examined) != acc_all["_counted"]:
        raise ValueError("census-accounts 'all' row does not match the rows returned")
    if rows_examined is None or int(rows_examined) != edge_all["_counted"]:
        raise ValueError("census-edges 'all' row does not match the rows returned")

    lines = [
        "# MT5 parity census",
        "",
        "Labels, buckets, day counts and ratios to three significant figures only. "
        "Amounts, logins, servers and ids are never rendered.",
        "",
        "## Accounts",
        "",
    ]
    lines += _table(
        _ACCOUNT_COLUMNS,
        [_account_cells(label, row) for label, row in sorted(accounts, key=lambda p: p[0])],
    )
    lines += ["", "## Friday edges", ""]
    edge_rows: list[tuple[str, ...]] = []
    for label, row in sorted(edges, key=lambda p: (p[0], str(p[1].get("friday")))):
        raw_friday = row.get("friday")
        if raw_friday is None:
            edge_rows.append((label, "none", "no", _NA, _NA, _NA, "no mark"))
            continue
        friday = date.fromisoformat(_day_cell(raw_friday, "friday"))
        present = row.get("mark_present")
        if not isinstance(present, bool):
            raise ValueError("column mark_present is not a boolean")
        edge_rows.append(
            (
                label,
                friday.isoformat(),
                "yes" if present else "no",
                _ratio_cell(row.get("open_pnl_ratio"), "open_pnl_ratio"),
                _minute(row.get("marked_at"), "marked_at"),
                _ratio_cell(row.get("hours_after_utc_midnight"), "hours_after_utc_midnight"),
                _edge_window_cell(friday, present, row.get("marked_at")),
            )
        )
    lines += _table(
        ("Account", "Friday", "Mark present", "Open P&L ratio", "Marked at",
         "Hours after UTC midnight", "Weekend window"),
        edge_rows,
    )
    lines += [
        "",
        f"keys_examined: {int(keys_examined)}; rows_examined: {int(rows_examined)}",
    ]
    return "\n".join(lines) + "\n"


_MODES: Final[frozenset[str]] = frozenset({"synthetic", "real"})


def render_findings_markdown(
    findings: Sequence[Finding],
    observations: Sequence[Observation],
    flag_readings: Sequence[FlagReading],
    mode: str,
) -> str:
    """The tracked findings record, rendered from typed findings only."""
    if mode not in _MODES:
        raise ValueError("mode is neither synthetic nor real")
    lines = ["# MT5 parity findings", ""]
    if mode == "synthetic":
        lines += ["SYNTHETIC INPUT: a rehearsal of the harness, not a parity result.", ""]
    lines += [
        "Flag classes are a PROPOSAL for the Phase 155.2 founder sign-off, "
        "never a final acceptance.",
        "",
        "## Findings",
        "",
    ]
    if findings:
        for f in findings:
            lines.append(
                f"- {f.id} [{f.kind}] {f.account_label} {f.subject}, bucket {f.bucket}: {f.lead}"
            )
    else:
        lines.append("None.")
    lines += ["", "## Observations", ""]
    if observations:
        for o in observations:
            lines.append(f"- {o.account_label} {o.surface}: {o.reason}")
    else:
        lines.append("None.")
    lines += ["", "## Flag classification (proposed)", ""]
    by_label: dict[str, list[FlagReading]] = {}
    for r in flag_readings:
        by_label.setdefault(r.account_label, []).append(r)
    if by_label:
        for label in sorted(by_label):
            readings = by_label[label]
            lines.append(f"### {label} (computed {readings[0].computed_at_minute})")
            lines.append("")
            for r in sorted(readings, key=lambda r: r.key):
                lines.append(f"- {r.key}: {r.flag_class}")
            lines.append("")
    else:
        lines += ["None.", ""]
    return "\n".join(lines).rstrip("\n") + "\n"


# -------------------------------------------------------------------------- scanner

ScanProfile = Literal["record", "fixture"]

_ZERO_UUID_PREFIX: Final = "00000000-0000-4000-8000-"
_UUID_RE: Final[re.Pattern[str]] = re.compile(
    r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f])"
)
# Assembled from parts so this module's own source never holds the path prefix.
_HOME_DIRS: Final = "|".join(("Us" + "ers", "ho" + "me"))
_HOME_PATH_RE: Final[re.Pattern[str]] = re.compile(
    "(?<![\\w.~-])/(?:" + _HOME_DIRS + ")/|[A-Za-z]:\\\\(?:" + "Us" + "ers" + ")\\\\"
)
_LONG_HEX_RE: Final[re.Pattern[str]] = re.compile(r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{16,}")
# A run of digits that does not follow a decimal point after a digit (the fraction of a
# decimal): ratio_3sf can render 0.000412. A letter then a dot is not a decimal.
_DIGIT_RUN_RE: Final[re.Pattern[str]] = re.compile(r"(?<!\d)(?<!\d\.)\d{5,}")
_DECIMAL_RE: Final[re.Pattern[str]] = re.compile(
    r"(?<![\w.])\d+(?:\.\d+)+(?:[eE][+-]?\d+)?(?!\w)"
)
_PHASE_ID_RE: Final[re.Pattern[str]] = re.compile(r"\d{3}(?:\.\d)+")
_THOUSANDS_RE: Final[re.Pattern[str]] = re.compile(r"(?<![\d,])\d{1,3}(?:,\d{3})+(?!\d)")

_RECORD_RULES: Final[tuple[str, ...]] = (
    "uuid", "home_path", "digit_run_5", "long_hex", "sig_figs_gt_3", "thousands_separated",
)
_FIXTURE_RULES: Final[frozenset[str]] = frozenset({"uuid", "home_path"})


def _too_precise(token: str) -> bool:
    if _PHASE_ID_RE.fullmatch(token):
        return False
    mantissa = re.split(r"[eE]", token, maxsplit=1)[0]
    if mantissa.count(".") != 1:
        return True
    whole, frac = mantissa.split(".")
    return len((whole + frac).lstrip("0")) > 3


def scan_tracked_text(text: str, profile: ScanProfile = "record") -> tuple[str, ...]:
    """The sorted names of the rules ``text`` breaks, never the text that broke them.

    ``record`` runs every rule; ``fixture`` runs only ``uuid`` and ``home_path``,
    because fixtures legitimately carry synthetic amounts. The synthetic zero-pattern
    UUID and the repo's phase-id shape are exempt."""
    hits: set[str] = set()
    masked = text
    for match in _UUID_RE.finditer(text):
        if not match.group(0).lower().startswith(_ZERO_UUID_PREFIX):
            hits.add("uuid")
    masked = _UUID_RE.sub(" ", masked)
    if _HOME_PATH_RE.search(text):
        hits.add("home_path")
    if profile == "record":
        if _LONG_HEX_RE.search(masked):
            hits.add("long_hex")
        if _DIGIT_RUN_RE.search(masked):
            hits.add("digit_run_5")
        if any(_too_precise(m.group(0)) for m in _DECIMAL_RE.finditer(masked)):
            hits.add("sig_figs_gt_3")
        if _THOUSANDS_RE.search(masked):
            hits.add("thousands_separated")
    result = tuple(sorted(hits))
    allowed = _FIXTURE_RULES if profile == "fixture" else frozenset(_RECORD_RULES)
    if not set(result) <= allowed:
        raise AssertionError("the scanner produced a rule outside its profile")
    return result
