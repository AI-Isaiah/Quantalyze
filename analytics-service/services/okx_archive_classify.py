"""Classification and per-day aggregation of OKX archive bills (Phase 167.1.2.2.2.1, plan 02).

Pure module: stdlib plus ``okx_archive_files`` only. Turns verified archive files into
per-UTC-day dollar legs that mirror what the live path (``exchange.fetch_daily_pnl``,
``funding_fetch.fetch_funding_okx``) produces from the same ledger, so the two can be
compared to the cent (D-09, D-10).

Classification (D-08) is a COMMITTED ``subType`` table. The archive CSV has no
guaranteed ``type`` column, so ``subType`` is the key.

Provenance of the table: every subtype number below is one the phase RESEARCH, Section 3
("Bill-type classification"), quotes as cited from the OKX docs' bills ``px`` table
(trade 1-6, block trade 204-209, partial liquidation 100-103, liquidation 104-107,
liquidation transfer 110/111, delivery 112/113, forced repayment 114/115, 16, 17,
exercise 170-172, funding fee expense/income 173/174) or from the Get bill types example
(type Transfer, subtypes 11 and 12). Types and subtypes that RESEARCH marks as assumed
(ADL, clawback, strategy transfer, convert, earn and the rest) are DELIBERATELY ABSENT:
they classify as UNKNOWN and fail loud on a nonzero effect until the founder-reviewed
census extends the table. Do not encode a number from memory here.

* FUNDING     173, 174    own stream, amount = ``pnl``, no instType filter
* FLOW        11, 12      external capital, signed by ``balChg``
* REALIZED    trade-like  ``pnl + fee``, restricted to the live path's instType set
* NON_EXTERNAL 110, 111, 114, 115, 16, 17   balance movements that are neither P&L nor
                          external capital (liquidation transfers are NOT flows)
* UNKNOWN     everything else: a nonzero effect is a permanent stop

Stop classes raised here (all ``okx_archive_files.ArchiveParseError``):
``subtype_map_drift``, ``unknown_subtype_nonzero``, ``non_usd_ccy``,
``duplicate_bill_conflict``, and (``verify_bal_chain``) ``archive_incomplete``. Details hold
counts, months, dates and subtype labels only.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from types import MappingProxyType
from typing import Any, Final, Mapping, Sequence

from services.okx_archive_files import ArchiveFile, ArchiveParseError, ArchiveRow


class Bucket(str, Enum):
    REALIZED = "realized"
    FUNDING = "funding"
    FLOW = "flow"
    NON_EXTERNAL = "non_external"
    UNKNOWN = "unknown"


# Bumped whenever a subtype is added to or moved within SUBTYPE_BUCKETS.
CLASSIFICATION_TABLE_VERSION: Final[str] = "okx-subtype-seed-v1"

# Pinned equal, element for element and in order, to EVERY instType list literal in
# ``exchange.fetch_daily_pnl`` (the bills loop and the bills-archive loop) by a
# source-text test. The archive leg must cover the same rows the live leg does.
LIVE_REALIZED_INST_TYPES: Final[tuple[str, ...]] = ("SWAP", "FUTURES", "SPOT", "MARGIN")

# Currencies summed as dollars with no conversion. Anything else with a nonzero effect
# on a counted row is a permanent stop (founder must-settle: currency).
ARCHIVE_USD_FAMILY: Final[frozenset[str]] = frozenset({"USDT", "USDC", "USD"})

_REALIZED_SUBTYPES: Final[tuple[str, ...]] = (
    # trade
    "1", "2", "3", "4", "5", "6",
    # block trade
    "204", "205", "206", "207", "208", "209",
    # partial liquidation
    "100", "101", "102", "103",
    # liquidation
    "104", "105", "106", "107",
    # delivery
    "112", "113",
    # exercise
    "170", "171", "172",
)
_FUNDING_SUBTYPES: Final[tuple[str, ...]] = ("173", "174")
_FLOW_SUBTYPES: Final[tuple[str, ...]] = ("11", "12")
_NON_EXTERNAL_SUBTYPES: Final[tuple[str, ...]] = ("110", "111", "114", "115", "16", "17")


def _build_table() -> Mapping[str, Bucket]:
    table: dict[str, Bucket] = {}
    for bucket, subtypes in (
        (Bucket.REALIZED, _REALIZED_SUBTYPES),
        (Bucket.FUNDING, _FUNDING_SUBTYPES),
        (Bucket.FLOW, _FLOW_SUBTYPES),
        (Bucket.NON_EXTERNAL, _NON_EXTERNAL_SUBTYPES),
    ):
        for subtype in subtypes:
            if subtype in table:  # a subtype in two buckets is a table bug, not a runtime case
                raise AssertionError(f"subType {subtype} listed in two buckets")
            table[subtype] = bucket
    return MappingProxyType(table)


SUBTYPE_BUCKETS: Final[Mapping[str, Bucket]] = _build_table()

_BLANK: Final[str] = "(blank)"


@dataclass(frozen=True)
class ArchiveAggregate:
    realized_by_day: dict[str, Decimal]
    funding_by_day: dict[str, Decimal]
    flows_by_day: dict[str, Decimal]
    non_external_by_day: dict[str, Decimal]
    excluded_by_month: dict[str, dict[str, Decimal]]
    census: dict[str, Any]
    unknown_zero_effect: int
    covered_days: frozenset[str]
    bal_continuity: dict[str, dict[str, int]]


def _bill_order_key(row: ArchiveRow) -> tuple[bool, int, str]:
    return (not row.bill_id.isdigit(), int(row.bill_id) if row.bill_id.isdigit() else 0, row.bill_id)


def _bal_continuity(rows: Sequence[ArchiveRow]) -> dict[str, dict[str, int]]:
    """Per ccy: how many consecutive-bill pairs break ``bal == previous bal + balChg``.

    An information reading in billId order; never a gate (RESEARCH Section 4).
    """
    previous: dict[str, Decimal] = {}
    out: dict[str, dict[str, int]] = {}
    for row in sorted(rows, key=_bill_order_key):
        entry = out.setdefault(row.ccy or _BLANK, {"checked": 0, "mismatches": 0})
        prior = previous.get(row.ccy)
        if prior is not None:
            entry["checked"] += 1
            if row.bal != prior + row.bal_chg:
                entry["mismatches"] += 1
        previous[row.ccy] = row.bal
    return dict(sorted(out.items()))


def _chain_file(file: ArchiveFile) -> dict[str, dict[str, Any]]:
    """Per ccy of ONE file: pairs checked, pairs that break ``bal == previous bal + balChg``
    in billId order, and the UTC day of the first break. Raises ``archive_incomplete`` when a
    row cannot be placed in a chain (no ccy, or a billId that is not an integer), because a
    chain that cannot be evaluated must never be assumed to hold."""
    unchainable = sum(1 for row in file.rows if not row.ccy or not row.bill_id.isdigit())
    if unchainable:
        raise ArchiveParseError(
            "archive_incomplete", {"reason": "unchainable_row", "rows": unchainable}
        )
    previous: dict[str, Decimal] = {}
    out: dict[str, dict[str, Any]] = {}
    for row in sorted(file.rows, key=_bill_order_key):
        entry = out.setdefault(row.ccy, {"checked": 0, "breaks": 0, "first_break_day": None})
        prior = previous.get(row.ccy)
        if prior is not None:
            entry["checked"] += 1
            if row.bal != prior + row.bal_chg:
                entry["breaks"] += 1
                if entry["first_break_day"] is None:
                    entry["first_break_day"] = row.day
        previous[row.ccy] = row.bal
    return dict(sorted(out.items()))


def verify_bal_chain(files: Sequence[ArchiveFile]) -> None:
    """F1: prove each quarter file is the COMPLETE ledger of its quarter, or stop.

    The job reads a quarter file as complete: a covered day with no bill becomes an explicit
    zero-P&L day, and the RPC then removes that day from ``unrecovered_gaps``. Nothing else
    authenticates the interior of the file (Q2 has no live overlap; Q3's July is never
    compared). OKX's ``bal`` is the balance after each bill, so per ccy and in billId order
    each ``bal`` must equal the previous ``bal`` plus its ``balChg``; a row missing from the
    file breaks the chain at the next bill of that ccy. Every file is chained on its own, and
    any break is a permanent ``archive_incomplete`` carrying counts and dates only.

    What this proves is INTERIOR completeness. A file missing its first or last bills still
    chains; ``ts_min_day``, ``ts_max_day`` and the longest bill-less run per quarter are
    reported beside it for that reason. RESEARCH A7 (``bal`` chains exactly on a real file)
    was unmeasured when this became a gate: the first real calibrate is its measurement, and
    a false stop here is a fail-closed stop, never a published figure."""
    readings = [_chain_file(file) for file in files]
    if any(entry["breaks"] for reading in readings for entry in reading.values()):
        raise ArchiveParseError(
            "archive_incomplete",
            {
                "reason": "bal_chain_break",
                "files": [
                    {"ts_min_day": file.ts_min_day, "ts_max_day": file.ts_max_day, "ccys": reading}
                    for file, reading in zip(files, readings)
                ],
            },
        )


def _sorted_counts(counter: Mapping[str, int]) -> dict[str, int]:
    return dict(sorted(counter.items()))


def aggregate_archive(
    files: Sequence[ArchiveFile], subtype_types: Mapping[str, str] | None
) -> ArchiveAggregate:
    """Classify every bill of the verified files and sum the per-day legs.

    ``subtype_types`` is the live ``subType -> type`` map (``/account/subtypes``). When a
    file carries a ``type`` column each value is cross-checked against it; with no map
    the cross-check is skipped.
    """
    unique: dict[str, ArchiveRow] = {}
    for file in files:
        for row in file.rows:
            earlier = unique.get(row.bill_id)
            if earlier is None:
                unique[row.bill_id] = row
            elif earlier != row:
                raise ArchiveParseError("duplicate_bill_conflict", {"across_files": len(files)})
    rows = list(unique.values())

    realized: dict[str, Decimal] = defaultdict(Decimal)
    funding: dict[str, Decimal] = defaultdict(Decimal)
    flows: dict[str, Decimal] = defaultdict(Decimal)
    non_external: dict[str, Decimal] = defaultdict(Decimal)
    excluded: dict[str, dict[str, Decimal]] = {}

    by_ccy: dict[str, int] = defaultdict(int)
    by_inst: dict[str, int] = defaultdict(int)
    by_sub: dict[str, int] = defaultdict(int)
    by_bucket: dict[str, int] = defaultdict(int)
    excluded_non_usd = 0
    unknown_zero = 0
    unknown_nonzero: dict[str, int] = defaultdict(int)
    map_drift: dict[str, int] = defaultdict(int)
    non_usd_rows: dict[str, int] = defaultdict(int)
    non_usd_months: dict[str, set[str]] = defaultdict(set)

    for row in rows:
        bucket = SUBTYPE_BUCKETS.get(row.sub_type, Bucket.UNKNOWN)
        by_ccy[row.ccy or _BLANK] += 1
        by_inst[row.inst_type or _BLANK] += 1
        by_sub[row.sub_type or _BLANK] += 1
        by_bucket[bucket.value] += 1

        if row.type_raw is not None and subtype_types is not None:
            mapped = subtype_types.get(row.sub_type)
            if mapped is not None and mapped != row.type_raw:
                map_drift[row.sub_type] += 1

        nonzero = row.pnl != 0 or row.fee != 0 or row.bal_chg != 0
        usd = row.ccy in ARCHIVE_USD_FAMILY
        month = row.day[:7]

        if bucket is Bucket.UNKNOWN:
            if nonzero:
                unknown_nonzero[row.sub_type or _BLANK] += 1
            else:
                unknown_zero += 1
            continue

        if bucket is Bucket.NON_EXTERNAL:
            if usd:
                non_external[row.day] += row.bal_chg
            continue

        if bucket is Bucket.REALIZED and row.inst_type not in LIVE_REALIZED_INST_TYPES:
            # Rows the live path never sees (OPTION, EVENTS, blank instType, ...):
            # reported per month and class, never summed into the realized leg.
            if usd:
                cls = row.inst_type or "BLANK"
                month_entry = excluded.setdefault(month, {})
                month_entry[cls] = month_entry.get(cls, Decimal(0)) + row.pnl + row.fee
            elif nonzero:
                excluded_non_usd += 1
            continue

        if not usd:
            if nonzero:
                non_usd_rows[row.ccy or _BLANK] += 1
                non_usd_months[row.ccy or _BLANK].add(month)
            continue

        if bucket is Bucket.REALIZED:
            realized[row.day] += row.pnl + row.fee
        elif bucket is Bucket.FUNDING:
            funding[row.day] += row.pnl
        else:
            flows[row.day] += row.bal_chg

    if map_drift:
        raise ArchiveParseError("subtype_map_drift", {"sub_types": _sorted_counts(map_drift)})
    if unknown_nonzero:
        raise ArchiveParseError("unknown_subtype_nonzero", {"sub_types": _sorted_counts(unknown_nonzero)})
    if non_usd_rows:
        raise ArchiveParseError(
            "non_usd_ccy",
            {
                "ccys": {
                    ccy: {"rows": non_usd_rows[ccy], "months": sorted(non_usd_months[ccy])}
                    for ccy in sorted(non_usd_rows)
                }
            },
        )

    census = {
        "rows": len(rows),
        "by_ccy": _sorted_counts(by_ccy),
        "by_inst_type": _sorted_counts(by_inst),
        "by_sub_type": _sorted_counts(by_sub),
        "by_bucket": _sorted_counts(by_bucket),
        "excluded_non_usd_rows": excluded_non_usd,
        "table_version": CLASSIFICATION_TABLE_VERSION,
    }
    return ArchiveAggregate(
        realized_by_day=dict(realized),
        funding_by_day=dict(funding),
        flows_by_day=dict(flows),
        non_external_by_day=dict(non_external),
        excluded_by_month=excluded,
        census=census,
        unknown_zero_effect=unknown_zero,
        covered_days=frozenset().union(*(f.covered_days for f in files)),
        bal_continuity=_bal_continuity(rows),
    )
