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
``bal_chain_break``, ``too_few_pairs`` and ``unchainable_row`` (D-16: its detail splits the cause
into ``blank_ccy`` and ``nondigit_bill_id`` and names the rows per file and their first and last
UTC day; D-17: it also names the value-free shape and the length of the first non-digit billId).
Details hold counts, months, dates, subtype labels and that closed-grammar shape only.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from types import MappingProxyType
from typing import AbstractSet, Any, Final, Mapping, Sequence

from services.okx_archive_files import ArchiveFile, ArchiveParseError, ArchiveRow, quarter_edge_days


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
    #: Whole UTC days with a daily total: every file's ``covered_days`` plus each quarter-edge day
    #: both neighbouring files reached (D-15). Every sum above is gated on this set.
    covered_days: frozenset[str]
    #: Quarter-edge UTC days both neighbouring files were read for: their totals hold both halves.
    edge_days_whole: frozenset[str]
    #: Quarter-edge UTC days only one file reached. No daily total, no row, never 0.0 (TRADESYNC D-02).
    edge_days_missing: frozenset[str]
    #: The currencies whose money the legs above actually add up: a USD-family currency with a
    #: nonzero effect on a bill that reached the realized, funding, flow or non-external sum.
    #: This is the scope of ``verify_bal_chain``'s ``MIN_CHAINED_PAIRS`` floor (WR-01): a
    #: currency the aggregate never sums (a coin-margined option) has no published figure
    #: resting on its completeness.
    summed_ccys: frozenset[str]


# D-17: the value-free shape of a billId that is still not all ASCII digits after the strip. An
# ASCII digit is ``9``, an ASCII letter ``A``, tab/space/double quote/apostrophe a fixed name, and any
# other character its two-letter Unicode category, so a shape holds no character of the id.
_SHAPE_NAMES: Final[Mapping[str, str]] = MappingProxyType({"\t": "TAB", " ": "SP", '"': "DQ", "'": "SQ"})
_SHAPE_MAX_RUNS: Final[int] = 8
# One run: a symbol, then ``{n}`` when it repeats (n >= 2, at most 6 digits: Python's default csv
# field limit of 131072 characters already stops a longer cell as ``malformed_csv``).
_SHAPE_RUN: Final[str] = (
    r"(?:9|A|TAB|SP|DQ|SQ|L[ultmo]|M[nce]|N[dlo]|P[cdseifo]|S[mcko]|Z[slp]|C[cfsno])"
    r"(?:\{(?:[2-9]|[1-9][0-9]{1,5})\})?"
)
#: The whole grammar of a shape, defined beside the code that makes shapes and imported by the job,
#: which echoes a shape only when this matches it in full: one run, up to seven more preceded by
#: ``-``, then an optional ``-MORE``.
NONDIGIT_SHAPE_RE: Final[re.Pattern[str]] = re.compile(
    rf"{_SHAPE_RUN}(?:-{_SHAPE_RUN}){{0,{_SHAPE_MAX_RUNS - 1}}}(?:-MORE)?"
)


def _bill_id_shape(bill_id: str) -> str:
    """D-17: the value-free shape of ``bill_id``, matched in full by ``NONDIGIT_SHAPE_RE``.

    Each character becomes a symbol (``9`` for an ASCII digit, ``A`` for an ASCII letter, ``TAB``,
    ``SP``, ``DQ`` or ``SQ`` for those four, else its Unicode general category such as ``Po`` or
    ``Sm``), equal neighbours merge into a run (``9{4}`` for four digits in a row), runs are joined
    by ``-``, and an id with more than ``_SHAPE_MAX_RUNS`` runs ends ``-MORE``. A shape never holds
    a character of the id: its only digits are the symbol ``9`` and run counts."""
    runs: list[list[Any]] = []
    for ch in bill_id:
        if "0" <= ch <= "9":
            symbol = "9"
        elif ch.isascii() and ch.isalpha():
            symbol = "A"
        else:
            symbol = _SHAPE_NAMES.get(ch) or unicodedata.category(ch)
        if runs and runs[-1][0] == symbol:
            runs[-1][1] += 1
        else:
            runs.append([symbol, 1])
    parts = [symbol if count == 1 else f"{symbol}{{{count}}}" for symbol, count in runs[:_SHAPE_MAX_RUNS]]
    if len(runs) > _SHAPE_MAX_RUNS:
        parts.append("MORE")
    return "-".join(parts)


def _bill_order_key(row: ArchiveRow) -> tuple[bool, int, str]:
    digits = row.bill_id.isascii() and row.bill_id.isdigit()
    return (not digits, int(row.bill_id) if digits else 0, row.bill_id)


def _adjacent_runs(files: Sequence[ArchiveFile]) -> list[list[int]]:
    """Indices of ``files`` grouped into runs of ADJACENT quarters, each run in time order.

    Two files are adjacent when the first's ``tail_edge_day`` is the second's ``head_edge_day``:
    OKX's UTC+8 cut splits that one UTC day between them (D-15), so the shared edge day is what
    joins them. Only adjacent quarters share a balance history that must chain: Q2 and Q4 without
    Q3 legitimately differ, and chaining across that hole would stop a complete pair of files."""
    order = sorted(range(len(files)), key=lambda i: files[i].head_edge_day)
    runs: list[list[int]] = []
    for i in order:
        if runs and files[runs[-1][-1]].tail_edge_day == files[i].head_edge_day:
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
    that seam unchecked). Adjacent means sharing a quarter-edge UTC day (D-15), and every row is
    chained, edge-day rows included, because they are real bills. Two stops, both ``archive_incomplete`` and both writing nothing:

    * ``bal_chain_break``: any pair breaks anywhere. The detail names, per ccy, the breaks,
      how many of them sit on a pair that crosses two files (``seam_breaks``) and the day of
      the first, and each file's ts range.
    * ``too_few_pairs``: a ccy in ``summed_ccys`` (the currencies whose money the aggregate adds
      up, ``ArchiveAggregate.summed_ccys``) has fewer than ``MIN_CHAINED_PAIRS`` pairs, so its
      completeness cannot be proven. A currency outside that set (a coin-margined option) is
      not floored, because no published figure rests on its completeness, but its breaks above
      still stop the job and it still appears in the reading. A break is reported before this.

    ``unchainable_row`` (D-16) is raised before any chaining, for a bill the chain cannot place:
    a blank ``ccy`` with an effect (``blank_ccy``) or a ``billId`` that is not all digits
    (``nondigit_bill_id``, whatever its ``ccy`` or effect). One bill can carry both causes;
    ``rows`` counts each stopping bill once. D-17: its detail also carries ``first_nondigit_shape``
    and ``first_nondigit_len``, the value-free shape (``_bill_id_shape``) and the length of the FIRST
    non-digit billId in the order the files are passed and then row order (None when there is none).

    D-16 skip: a bill with a blank ``ccy``, an all-digit ``billId`` and ZERO BALANCE EFFECT
    (``balChg``, ``pnl`` and ``fee`` all exactly 0, the negation of ``aggregate_archive``'s
    ``nonzero``; ``bal`` is state, not effect, and ``posBalChg`` / ``posBal`` are never read)
    is left out of the chain only and counted in ``blank_ccy_skipped``. It fits no currency's
    chain, and since it changed no balance its neighbours still satisfy ``bal == previous bal +
    balChg`` without it, so skipping it can neither hide a break nor make one. The skip comes
    after the de-duplication and conflict check. ``aggregate_archive`` still classifies and
    counts the bill. The detail carries
    the totals, the first and last UTC day of those bills and, per file in the order passed,
    the same counts and days beside the file's ts range. Counts and dates only.

    On success it returns the reading the job records in ``info.bal_chain``:
    ``{"ccys": {ccy: {pairs_checked, first_day, last_day}}, "total_pairs": n,
    "blank_ccy_skipped": n}``; every stop detail carries ``blank_ccy_skipped`` too.

    What the chain proves is INTERIOR completeness plus the seam between adjacent quarters.
    It cannot prove the HEAD of the earliest file or the TAIL of the latest: a file missing
    its first or last bills still chains. ``ts_min_day``, ``ts_max_day`` and the longest
    bill-less run per quarter are reported for that reason, and only a gap day inside that
    unprovable head or tail needs the founder's judgment. RESEARCH A7 (``bal`` chains exactly
    on a real file) was unmeasured when this became a gate: the first real calibrate is its
    measurement, and a false stop here is a fail-closed stop, never a published figure."""
    # D-16: the bills the chain cannot place are counted per file, with the cause split and the
    # first and last UTC day, so the stop names what stopped it. Counts and days only.
    tally: list[dict[str, Any]] = []
    skipped = 0
    first_shape: str | None = None
    first_len: int | None = None
    seen: set[str] = set()
    for file in files:
        stopping_days: list[str] = []
        blank = nondigit = 0
        for row in file.rows:
            if row.bill_id in seen:  # a bill in two files counts once, first file wins
                continue
            seen.add(row.bill_id)
            row_blank = not row.ccy
            row_nondigit = not (row.bill_id.isascii() and row.bill_id.isdigit())
            # D-16: zero balance effect is the negation of ``aggregate_archive``'s ``nonzero``.
            zero_effect = row.bal_chg == 0 and row.pnl == 0 and row.fee == 0
            if row_nondigit or (row_blank and not zero_effect):
                stopping_days.append(row.day)
            elif row_blank:
                skipped += 1
            if row_blank and not zero_effect:
                blank += 1
            if row_nondigit:
                nondigit += 1
                if first_shape is None:
                    first_shape = _bill_id_shape(row.bill_id)
                    first_len = len(row.bill_id)
        tally.append(
            {
                "ts_min_day": file.ts_min_day,
                "ts_max_day": file.ts_max_day,
                "rows": len(stopping_days),
                "blank_ccy": blank,
                "nondigit_bill_id": nondigit,
                "first_day": min(stopping_days, default=None),
                "last_day": max(stopping_days, default=None),
            }
        )
    unchainable = sum(entry["rows"] for entry in tally)
    if unchainable:
        days = [d for entry in tally for d in (entry["first_day"], entry["last_day"]) if d is not None]
        raise ArchiveParseError(
            "archive_incomplete",
            {
                "reason": "unchainable_row",
                "rows": unchainable,
                "blank_ccy": sum(entry["blank_ccy"] for entry in tally),
                "nondigit_bill_id": sum(entry["nondigit_bill_id"] for entry in tally),
                "first_day": min(days),
                "last_day": max(days),
                "first_nondigit_shape": first_shape,
                "first_nondigit_len": first_len,
                "files": tally,
                "blank_ccy_skipped": skipped,
            },
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
            if not row.ccy:
                # D-16: only a zero-effect, all-digit blank-ccy bill gets here (any other raised
                # above). It fits no currency's chain and moved no balance, so its neighbours
                # chain without it; no ``""`` entry is made and ``previous`` is not set from it.
                continue
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
                "blank_ccy_skipped": skipped,
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
        "blank_ccy_skipped": skipped,
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

    # D-15: a quarter-edge UTC day has a daily total only when both neighbouring files were read.
    # Classification below still reads EVERY row; only the sums are gated on ``covered``.
    whole, missing = quarter_edge_days(files)
    covered = frozenset().union(*(f.covered_days for f in files)) | whole

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
            if row.day not in covered:
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
                if row.day not in covered:
                    continue
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

        if row.day not in covered:
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
        covered_days=covered,
        edge_days_whole=whole,
        edge_days_missing=missing,
        summed_ccys=frozenset(summed),
    )
