"""MT5OFFSET dry run (Phase 175 plan 04, D-03): which MT5 days move when the broker's clock rule is used.

WHAT THIS MODULE IS. A pure, read-only before/after on a captured MT5 ledger (the
``flowtiming_dry_run`` precedent). It takes ONE JSON file the operator produced in a session
scratchpad and prints a counts-only report:

  * ``--captured``  the MT5 deal ledger of each active key, read once on the worker host by the
                    one-shot capture script: ``{"offset_s": int, "keys": {<key id>: {"status":
                    "captured", "deals": [...], "equity": float, "balance": float, "currency":
                    str} | {"status": "not_captured", "error_class": str}}}``. The key order of the
                    object is the capture order and is the only source of the report's ordinals.

BEFORE is the ledger folded under the LEGACY fixed offset (``--legacy-offset-s``); AFTER is the same
ledger folded under the TARGET clock (a DST rule, ``--rule eu|us``, or a fixed offset,
``--fixed-offset-s``; never both). Per key the report gives: deals, deals that change UTC day, flow
deals that change UTC day, the distinct days involved, flow deals left without an instant by the
target (a repeated or skipped broker hour), NAV-level days changed, return days changed, and a
verdict:

  * ``rebuild``      at least one NAV-LEVEL day changes: the key's allocator snapshots (written once,
                     ``ON CONFLICT DO NOTHING``) hold values the new clock would write differently,
                     so a forced rebuild is needed for this key;
  * ``none``         nothing changes;
  * ``not measured`` the ledger could not be folded; the exception CLASS is reported, never its
                     message.

The stored history may have been written under more than one offset, so the operator runs the script
once per offset the history was written under and unions the ``rebuild`` keys (plan 06).

EXIT STATUS. The report is always written first. The exit status is 1 when the capture holds no keys
or any key is ``not measured`` (the rebuild list is then incomplete, and the report says so), else 0.
A capture ``offset_s`` that differs from ``--legacy-offset-s`` is a stderr WARNING and a report note,
not a refusal: the deals are broker wall times, folded once per offset the history was written under.

It never opens a database connection or a socket, imports no supabase or HTTP client, and writes no
file except where ``--out`` / ``--map-out`` name one.

REDACTION. The report speaks in ordinals ("mt5-key-1") and counts. Identifiers, logins, amounts and
server names are never rendered: ordinals come from capture position, not from any id, and every
rendered string passes ``flowtiming_dry_run._scrub`` (reused, not copied) as a second line. The
ordinal-to-id map is written only where ``--map-out`` names a scratch path.

CLI::

    python -m scripts.mt5offset_dry_run --captured captured.json \
        (--rule eu|us | --fixed-offset-s N) --legacy-offset-s N \
        [--out report.md] [--map-out ordinals.json] [--note TEXT ...]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Mapping, Sequence
from typing import Any

import pandas as pd

from scripts.flowtiming_dry_run import _scrub
from services.account_unit import classify_account_currency
from services.broker_dailies import combine_mt5_deal_ledger, reconstruct_mt5_nav_levels
from services.mt5_deals import classify_deal, deal_utc_day, deal_utc_instant_ms
from services.mt5_server_clock import Mt5ServerClock, fixed_server_clock, server_clock_for_rule

# Relative tolerance for "the same number": a level or a return is unchanged when the two folds
# agree to this, with NaN equal to NaN (an inception gap is a gap on both sides).
_REL_TOL = 1e-9

_COLUMNS = (
    ("deals", "deals"),
    ("moved_deals", "moved deals"),
    ("moved_flow_deals", "moved flow deals"),
    ("moved_days", "moved days"),
    ("instantless_flow_deals", "flow deals without an instant"),
    ("level_days_changed", "NAV-level days changed"),
    ("return_days_changed", "return days changed"),
)


def _error_class(exc: BaseException) -> str:
    """The class name only: a message may carry a deal field, so it is never recorded."""
    return type(exc).__name__


def _by_day(series: pd.Series) -> dict[str, float]:
    return {ts.date().isoformat(): float(value) for ts, value in series.items()}


def _days_changed(before: Mapping[str, float], after: Mapping[str, float]) -> int:
    """Days present on one side only, or on both with values differing beyond ``_REL_TOL``."""
    changed = 0
    for day in set(before) | set(after):
        if day not in before or day not in after:
            changed += 1
            continue
        a, b = before[day], after[day]
        if math.isnan(a) and math.isnan(b):
            continue
        if math.isnan(a) or math.isnan(b):
            changed += 1
            continue
        if abs(a - b) > _REL_TOL * max(abs(a), abs(b)):
            changed += 1
    return changed


def key_shift(
    deals: Sequence[Mapping[str, Any]],
    equity: float,
    balance: float,
    currency: str,
    *,
    legacy_offset_s: int,
    target: Mt5ServerClock,
) -> dict[str, Any]:
    """One key's before/after: the legacy fixed integer against ``target`` on the same ledger.

    Any exception from classification, dating, the currency lookup or the folds gives verdict
    ``not measured`` with only the exception's class name."""
    try:
        moved_deals = 0
        moved_flow_deals = 0
        instantless_flow_deals = 0
        moved_days: set[str] = set()
        for deal in deals:
            is_flow = classify_deal(deal) == "external_flow"
            legacy_day = deal_utc_day(deal.get("time"), legacy_offset_s)
            target_day = deal_utc_day(deal.get("time"), target)
            if legacy_day != target_day:
                moved_deals += 1
                moved_flow_deals += int(is_flow)
                moved_days.update((legacy_day, target_day))
            if (
                is_flow
                and deal_utc_instant_ms(deal, target) is None
                and deal_utc_instant_ms(deal, legacy_offset_s) is not None
            ):
                instantless_flow_deals += 1
        floors = classify_account_currency(currency).floors
        legacy_levels, _ = reconstruct_mt5_nav_levels(
            deals, equity, balance, server_utc_offset_s=legacy_offset_s, floors=floors
        )
        target_levels, _ = reconstruct_mt5_nav_levels(
            deals, equity, balance, server_utc_offset_s=target, floors=floors
        )
        legacy_returns, _ = combine_mt5_deal_ledger(
            deals, equity, balance, server_utc_offset_s=legacy_offset_s, floors=floors
        )
        target_returns, _ = combine_mt5_deal_ledger(
            deals, equity, balance, server_utc_offset_s=target, floors=floors
        )
        level_days_changed = _days_changed(_by_day(legacy_levels), _by_day(target_levels))
        return_days_changed = _days_changed(_by_day(legacy_returns), _by_day(target_returns))
    except Exception as exc:  # noqa: BLE001 - the class is recorded for the key, never hidden
        return {"verdict": "not measured", "error_class": _error_class(exc)}
    return {
        "verdict": "rebuild" if level_days_changed > 0 else "none",
        "error_class": None,
        "deals": len(deals),
        "moved_deals": moved_deals,
        "moved_flow_deals": moved_flow_deals,
        "moved_days": len(moved_days),
        "instantless_flow_deals": instantless_flow_deals,
        "level_days_changed": level_days_changed,
        "return_days_changed": return_days_changed,
    }


def analyze(
    captured: Mapping[str, Any], *, legacy_offset_s: int, target: Mt5ServerClock
) -> dict[str, Any]:
    """Everything the report says, as plain data. Ordinals are capture order; the ordinal-to-id map
    is kept apart (``ordinals``) and is the only place an id appears."""
    rows: list[dict[str, Any]] = []
    ordinals: dict[str, str] = {}
    for position, (key_id, entry) in enumerate((captured.get("keys") or {}).items(), start=1):
        ordinal = f"mt5-key-{position}"
        ordinals[ordinal] = str(key_id)
        if not isinstance(entry, Mapping) or entry.get("status") != "captured":
            raw = entry.get("error_class") if isinstance(entry, Mapping) else None
            rows.append(
                {
                    "ordinal": ordinal,
                    "verdict": "not measured",
                    "error_class": str(raw) if raw else "NotCaptured",
                }
            )
            continue
        try:
            shift = key_shift(
                entry["deals"],
                float(entry["equity"]),
                float(entry["balance"]),
                str(entry.get("currency") or ""),
                legacy_offset_s=legacy_offset_s,
                target=target,
            )
        except Exception as exc:  # noqa: BLE001 - a malformed entry is a class, not a crash
            shift = {"verdict": "not measured", "error_class": _error_class(exc)}
        rows.append({"ordinal": ordinal, **shift})
    return {"rows": rows, "ordinals": ordinals, "notes": []}


def _hours(offset_s: int) -> str:
    return f"{offset_s / 3600:+g} h"


def render_report(
    analysis: Mapping[str, Any], *, target_label: str, legacy_offset_s: int
) -> str:
    """The markdown report: a header naming the target and the legacy offset, a per-key table, a
    rebuild tally and any notes. Every line passes ``_scrub``."""
    rows: Sequence[Mapping[str, Any]] = analysis["rows"]
    lines = [
        "# MT5 server-clock dry run",
        "",
        f"- Target clock: {target_label}",
        f"- Legacy offset: {_hours(legacy_offset_s)}",
        "",
        "| key | verdict | " + " | ".join(label for _, label in _COLUMNS) + " | error class |",
        "|---|---|" + "---|" * len(_COLUMNS) + "---|",
    ]
    for row in rows:
        cells = [str(row["ordinal"]), str(row["verdict"])]
        cells += [str(row.get(field, "-")) for field, _ in _COLUMNS]
        cells.append(str(row.get("error_class") or "-"))
        lines.append("| " + " | ".join(cells) + " |")
    rebuild = sum(1 for r in rows if r["verdict"] == "rebuild")
    not_measured = sum(1 for r in rows if r["verdict"] == "not measured")
    lines += ["", f"Keys needing a forced rebuild: {rebuild} of {len(rows)}."]
    lines.append(f"Keys not measured: {not_measured} of {len(rows)}.")
    if not rows:
        lines.append("INCOMPLETE: the capture holds no keys, so nothing was measured.")
    elif not_measured:
        lines.append("INCOMPLETE: the rebuild count above leaves out the keys not measured.")
    for note in analysis.get("notes", []):
        lines.append(f"- Note: {note}")
    return _scrub("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MT5OFFSET dry run report (read-only).")
    parser.add_argument("--captured", required=True, help="path to the captured-ledger JSON (scratch)")
    target_group = parser.add_mutually_exclusive_group(required=True)
    target_group.add_argument("--rule", choices=("eu", "us"), help="the broker's daylight-saving rule")
    target_group.add_argument(
        "--fixed-offset-s", type=int, help="a fixed target offset in seconds (no daylight saving)"
    )
    parser.add_argument(
        "--legacy-offset-s",
        type=int,
        required=True,
        help="the fixed offset the stored history was written under",
    )
    parser.add_argument("--out", help="write the report here instead of stdout")
    parser.add_argument("--map-out", help="write the ordinal map (scratch only; it holds ids)")
    parser.add_argument("--note", action="append", default=[], help="a line to add under the header")
    args = parser.parse_args(argv)

    if args.rule is not None:
        target = server_clock_for_rule(args.rule)
        target_label = f"rule {args.rule}"
    else:
        target = fixed_server_clock(args.fixed_offset_s)
        target_label = f"fixed {_hours(args.fixed_offset_s)}"

    with open(args.captured, encoding="utf-8") as fh:
        captured = json.load(fh)
    analysis = analyze(captured, legacy_offset_s=args.legacy_offset_s, target=target)
    analysis["notes"] = [_scrub(n) for n in args.note]
    captured_offset_s = captured.get("offset_s")
    if captured_offset_s is not None and captured_offset_s != args.legacy_offset_s:
        # Not a refusal: the deals are broker wall times, so one capture is folded under each
        # offset the history was written under (plan 06). The mismatch is made loud instead.
        mismatch = (
            f"capture offset_s={captured_offset_s} differs from --legacy-offset-s={args.legacy_offset_s}; "
            "the BEFORE fold uses --legacy-offset-s"
        )
        sys.stderr.write(f"WARNING: {mismatch}\n")
        analysis["notes"].append(mismatch)
    text = render_report(analysis, target_label=target_label, legacy_offset_s=args.legacy_offset_s)
    if args.map_out:
        with open(args.map_out, "w", encoding="utf-8") as fh:
            json.dump(analysis["ordinals"], fh)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    rows = analysis["rows"]
    not_measured = sum(1 for r in rows if r["verdict"] == "not measured")
    if not rows or not_measured:
        sys.stderr.write(
            f"INCOMPLETE: {not_measured} of {len(rows)} keys not measured; "
            "the rebuild list is not complete\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
