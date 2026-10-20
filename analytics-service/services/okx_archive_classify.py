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
* NON_EXTERNAL 110, 111, 114, 115, 16, 17   balance movements that are not external capital
                          (liquidation transfers are NOT flows). Their ``pnl + fee`` is still
                          inside the live number, so inside the live instType set it joins the
                          realized leg; their ``balChg`` is collected apart
* UNKNOWN     everything else: a nonzero effect is a permanent stop

Stop classes raised here (all ``okx_archive_files.ArchiveParseError``):
``subtype_map_drift``, ``unknown_subtype_nonzero``, ``non_usd_ccy``,
``duplicate_bill_conflict``, and (``verify_bal_chain``) ``archive_incomplete`` with the reasons
``bal_chain_break``, ``too_few_pairs`` and ``unchainable_row``. Details hold counts, months,
dates and subtype labels only.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from enum import Enum
from types import MappingProxyType
from typing import AbstractSet, Any, Final, Mapping, Sequence

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

# The completeness floor of ``verify_bal_chain``: a currency whose money the aggregate SUMS
# (``ArchiveAggregate.summed_ccys``: a nonzero pnl, fee or balChg on a bill that reaches the
# realized, funding, flow or non-external leg) must have at least this many chained pairs, i.e. at least
# three bills whose running ``bal`` agrees with their ``balChg``. One pair is a single link
# between two neighbouring bills: it says nothing about whether the weeks around them are
# present, and zero pairs (a lone bill) was never evaluated at all, so a chain that "passed"
# on 0 or 1 pair was indistinguishable from a real proof (silent-failure round 2, N1). Two is
# the smallest number that includes a bill that is both a successor and a predecessor. It is
# a floor on evidence, not a statistical bound: how far the pairs reach is reported beside it
# (``first_day`` / ``last_day`` per currency) for the founder's go/no-go.
MIN_CHAINED_PAIRS: Final[int] = 2

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
    #: The currencies whose money the legs above actually add up: a USD-family currency with a
    #: nonzero effect on a bill that reached the realized, funding, flow or non-external sum.
    #: This is the scope of ``verify_bal_chain``'s ``MIN_CHAINED_PAIRS`` floor (WR-01): a
    #: currency the aggregate never sums (a coin-margined option) has no published figure
    #: resting on its completeness.
    summed_ccys: frozenset[str]


def _bill_order_key(row: ArchiveRow) -> tuple[bool, int, str]:
    return (not row.bill_id.isdigit(), int(row.bill_id) if row.bill_id.isdigit() else 0, row.bill_id)


def _adjacent_runs(files: Sequence[ArchiveFile]) -> list[list[int]]:
    """Indices of ``files`` grouped into runs of ADJACENT quarters, each run in time order.

    Two files are adjacent when the second's first covered day is the day after the first's
    last. Only adjacent quarters share a balance history that must chain: Q2 and Q4 without
    Q3 legitimately differ, and chaining across that hole would stop a complete pair of files."""
    order = sorted(range(len(files)), key=lambda i: min(files[i].covered_days, default=""))
    runs: list[list[int]] = []
    for i in order:
        covered = files[i].covered_days
        if runs and covered and files[runs[-1][-1]].covered_days:
            previous_last = date.fromisoformat(max(files[runs[-1][-1]].covered_days))
            if date.fromisoformat(min(covered)) == previous_last + timedelta(days=1):
                runs[-1].append(i)
                continue
        runs.append([i])
    return runs


def verify_bal_chain(
    files: Sequence[ArchiveFile], summed_ccys: AbstractSet[str]
) -> dict[str, Any]:
    """F1 / WR-01: prove the requested quarter files are the COMPLETE ledger, or stop.

    The job reads a quarter file as complete: a covered day with no bill becomes an explicit
    zero-P&L day, and the RPC then removes that day from ``unrecovered_gaps``. Nothing else
    authenticates the interior of the file (Q2 has no live overlap; Q3's July is never
    compared; D-03 reads one strategy). OKX's ``bal`` is the balance after each bill, so per
    ccy and in billId order each ``bal`` must equal the previous ``bal`` plus its ``balChg``;
    a row missing from the file breaks the chain at the next bill of that ccy.

    This is the ONE gated chain. It runs per currency over the deduplicated rows of every run
    of ADJACENT requested quarters together, so the Q2 tail -> Q3 head seam is checked too:
    a truncated end of one file or start of the next breaks it there (a per-file chain left
    that seam unchecked). Two stops, both ``archive_incomplete`` and both writing nothing:

    * ``bal_chain_break``: any pair breaks anywhere. The detail names, per ccy, the breaks,
      how many of them sit on a pair that crosses two files (``seam_breaks``) and the day of
      the first, and each file's ts range.
    * ``too_few_pairs``: a ccy in ``summed_ccys`` (the currencies whose money the aggregate adds
      up, ``ArchiveAggregate.summed_ccys``) has fewer than ``MIN_CHAINED_PAIRS`` pairs, so its
      completeness cannot be proven. A currency outside that set (a coin-margined option) is
      not floored, because no published figure rests on its completeness, but its breaks above
      still stop the job and it still appears in the reading. A break is reported before this.

    On success it returns the reading the job records in ``info.bal_chain``:
    ``{"ccys": {ccy: {pairs_checked, first_day, last_day}}, "total_pairs": n}``.

    What the chain proves is INTERIOR completeness plus the seam between adjacent quarters.
    It cannot prove the HEAD of the earliest file or the TAIL of the latest: a file missing
    its first or last bills still chains. ``ts_min_day``, ``ts_max_day`` and the longest
    bill-less run per quarter are reported for that reason, and only a gap day inside that
    unprovable head or tail needs the founder's judgment. RESEARCH A7 (``bal`` chains exactly
    on a real file) was unmeasured when this became a gate: the first real calibrate is its
    measurement, and a false stop here is a fail-closed stop, never a published figure."""
    unchainable = sum(
        1 for file in files for row in file.rows if not row.ccy or not row.bill_id.isdigit()
    )
    if unchainable:
        raise ArchiveParseError(
            "archive_incomplete", {"reason": "unchainable_row", "rows": unchainable}
        )
    runs = _adjacent_runs(files)
    ccys: dict[str, dict[str, Any]] = {}
    for run in runs:
        unique: dict[str, tuple[ArchiveRow, int]] = {}
        for index in run:
            for row in files[index].rows:
                kept = unique.get(row.bill_id)
                if kept is None:
                    unique[row.bill_id] = (row, index)
                elif kept[0] != row:
                    raise ArchiveParseError("duplicate_bill_conflict", {"across_files": len(files)})
        previous: dict[str, tuple[ArchiveRow, int]] = {}
        for row, index in sorted(unique.values(), key=lambda pair: _bill_order_key(pair[0])):
            entry = ccys.setdefault(
                row.ccy,
                {"pairs_checked": 0, "first_day": row.day, "last_day": row.day,
                 "breaks": 0, "first_break_day": None, "seam_breaks": 0},
            )
            entry["first_day"] = min(entry["first_day"], row.day)
            entry["last_day"] = max(entry["last_day"], row.day)
            prior = previous.get(row.ccy)
            if prior is not None:
                entry["pairs_checked"] += 1
                if row.bal != prior[0].bal + row.bal_chg:
                    entry["breaks"] += 1
                    if prior[1] != index:
                        entry["seam_breaks"] += 1
                    if entry["first_break_day"] is None or row.day < entry["first_break_day"]:
                        entry["first_break_day"] = row.day
            previous[row.ccy] = (row, index)
    ccys = dict(sorted(ccys.items()))
    total_pairs = sum(entry["pairs_checked"] for entry in ccys.values())
    starved = sorted(
        ccy
        for ccy in summed_ccys
        if ccys.get(ccy, {}).get("pairs_checked", 0) < MIN_CHAINED_PAIRS
    )
    broken = any(entry["breaks"] for entry in ccys.values())
    if broken or starved:
        raise ArchiveParseError(
            "archive_incomplete",
            {
                "reason": "bal_chain_break" if broken else "too_few_pairs",
                "ccys": ccys,
                "total_pairs": total_pairs,
                "starved": starved,
                "files": [
                    {"ts_min_day": file.ts_min_day, "ts_max_day": file.ts_max_day} for file in files
                ],
            },
        )
    return {
        "ccys": {
            ccy: {
                "pairs_checked": entry["pairs_checked"],
                "first_day": entry["first_day"],
                "last_day": entry["last_day"],
            }
            for ccy, entry in ccys.items()
        },
        "total_pairs": total_pairs,
    }


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
    summed: set[str] = set()

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
            # WR-01. The live aggregator sums ``pnl + fee`` of EVERY non-funding bill in its
            # four instTypes, whatever the subtype, so a liquidation transfer or forced
            # repayment carrying either is inside the live number even though it is not
            # external capital. The archive realized leg must be the same set. Its balChg is
            # still collected apart (never a flow). A coin-denominated row the live path would
            # have summed as dollars is a ``non_usd_ccy`` stop like every other counted bucket.
            in_live_set = row.inst_type in LIVE_REALIZED_INST_TYPES
            if not usd:
                if not in_live_set:
                    if nonzero:
                        excluded_non_usd += 1
                elif nonzero:
                    non_usd_rows[row.ccy or _BLANK] += 1
                    non_usd_months[row.ccy or _BLANK].add(month)
                continue
            non_external[row.day] += row.bal_chg
            if nonzero:
                summed.add(row.ccy)
            if in_live_set:
                realized[row.day] += row.pnl + row.fee
            elif row.pnl + row.fee != 0:
                cls = row.inst_type or "BLANK"
                month_entry = excluded.setdefault(month, {})
                month_entry[cls] = month_entry.get(cls, Decimal(0)) + row.pnl + row.fee
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

        if nonzero:
            summed.add(row.ccy)
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
        summed_ccys=frozenset(summed),
    )
