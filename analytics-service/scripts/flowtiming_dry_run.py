"""FLOWTIMING dry run (164.6.6.2.3 plan 08, D-13): what this phase changes on PROD, with no write.

WHAT THIS MODULE IS. A pure, read-only comparison. It takes two JSON files the operator produced
from PROD in a session scratchpad and prints a counts-only report:

  * ``--before``   the STORED PROD state (SELECT output): per strategy its flags, status and stored
                   per-day returns; per key its venue, unit, stored balance, ``key_inputs`` payload
                   and stored key-mode returns.
  * ``--captured`` the MT5 deal ledger of each active key, read once on the worker host by the
                   one-shot capture script (deals, equity, balance, currency, server offset), or
                   ``not_captured`` with an error class.

BEFORE is the stored state. AFTER is this branch's code run on the same inputs: MT5 through
``broker_dailies.combine_mt5_deal_ledger`` on the captured ledger, Deribit through the stored writer
basis (``composed_day_pnl`` / ``composed_flows`` rolled back from the stored realized terminal).

It never opens a database connection or a socket, imports no supabase or HTTP client, and writes no
file except where ``--out`` / ``--map-out`` name one.

167.1.2 D-27 (USD dust floor $1000 -> $100) is sized SEPARATELY. The AFTER computation runs twice on
the same inputs, once with the pre-D-27 floors passed EXPLICITLY and once with the branch row. It is
explicit because ``nav_twr._guard_denominator`` binds its default ``dust_floor`` when the function is
DEFINED, so patching ``USD_FLOORS`` at run time would never reach it (T-164.6.6.2.3-36).

REDACTION. The report speaks in ordinals ("mt5-key-1"), counts and returns. Identifiers, emails,
logins and amounts are never rendered: ordinals come from list position, not from any id, and every
rendered string passes ``_scrub`` as a second line.

CLI::

    python -m scripts.flowtiming_dry_run --before before.json --captured captured.json \
        --marker-verdict PRODUCTION [--out report.md] [--map-out ordinals.json] [--note TEXT ...]
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from services import nav_twr
from services.account_unit import (
    USD_FLOORS,
    AccountCurrencyBlank,
    AccountCurrencyMalformed,
    AccountCurrencyUnsupported,
    UnitFloors,
    classify_account_currency,
)
from services.allocator_equity_derive import (
    read_dropped_day_pnl,
    read_realized_terminal,
    read_writer_basis,
)
from services.broker_dailies import combine_mt5_deal_ledger

# The USD row as it stood BEFORE 167.1.2 D-27: dust NAV 1000. It is the historical row, written
# here once and used for SIZING ONLY: no service module imports it, and it is always passed
# explicitly (the default of ``_guard_denominator`` binds at definition time).
PRE_D27_USD_FLOORS = UnitFloors(dust_nav=1000.0, material_equity=100.0, residual_abs_tol=1.00)

# Guard keys a stored or recomputed series can carry. ``flow_dominated_guard`` is the retired one
# (D-05): it only ever appears in BEFORE.
_GUARD_KEYS = ("dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard")
_RETIRED_GUARD = "flow_dominated_guard"
_ALL_GUARDS = _GUARD_KEYS + (_RETIRED_GUARD,)
# The flags the NAV/TWR engine itself can emit. A stored row also carries flags later stages add
# (csv_source, native_unit, cumulative_method, insufficient_window): comparing those against a
# recomputation that never runs those stages would report them as "disappearing".
_ENGINE_FLAGS = frozenset(
    _ALL_GUARDS
    + (
        "twr_chain_broken",
        "unrealized_pnl_in_anchor",
        "small_base_measured",
        "flow_timing_day_level",
        "flow_timing_day_level_large",
        "flow_timing_timed_days",
    )
)
_CCXT_VENUES = frozenset({"binance", "okx", "bybit"})
_AGREE_TOL = 1e-6


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _iso(ts: Any) -> str:
    return ts.date().isoformat()  # type: ignore[no-any-return]


def _to_date(iso: str) -> date:
    return date.fromisoformat(iso)


def _group(venue: str | None) -> str:
    """The report's venue grouping: MT5, Deribit, everything else."""
    if venue == "mt5":
        return "MT5"
    if venue == "deribit":
        return "Deribit"
    return "other"


_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_LONG_DIGITS_RE = re.compile(r"\d{9,}")
_HOME_RE = re.compile(r"/(?:Users|home)/\S*")


def _scrub(text: str) -> str:
    """Second line of defence: ids, emails, long digit runs and home paths never reach a report."""
    out = _UUID_RE.sub("[redacted]", str(text))
    out = _EMAIL_RE.sub("[redacted]", out)
    out = _HOME_RE.sub("[redacted]", out)
    return _LONG_DIGITS_RE.sub("[redacted]", out)


def _flag_list(flags: Mapping[str, Any] | None) -> list[str]:
    """The flags a stored row carries as True, sorted. Counts (ints) and strings are not flags."""
    return sorted(k for k, v in (flags or {}).items() if v is True)


class _GuardSpy:
    """Counts every DQ-01 verdict ``nav_twr._guard_denominator`` returns during a block.

    The debug note ``mm2x-dust-guard-after-floor`` used the same spy to see which day fired a guard.
    A day cannot be named from inside the call, so the harness reports EVENTS per guard key (one per
    dropped day on the day-level path, one per dropped cohort on a timed day). The
    ``pnl_dominated_guard`` is wired at the call site, not in this helper, so it is reported by the
    flag only."""

    def __init__(self) -> None:
        self.events: Counter[str] = Counter()
        self._original: Any = None

    def __enter__(self) -> "_GuardSpy":
        self._original = nav_twr._guard_denominator
        original = self._original
        events = self.events

        def spy(prev_nav: float, dust_floor: float = nav_twr.DUST_NAV_FLOOR) -> str | None:
            key: str | None = original(prev_nav, dust_floor)
            if key is not None:
                events[key] += 1
            return key

        nav_twr._guard_denominator = spy
        return self

    def __exit__(self, *_exc: object) -> None:
        nav_twr._guard_denominator = self._original


# ---------------------------------------------------------------------------
# MT5: AFTER on a captured ledger
# ---------------------------------------------------------------------------


def mt5_after(
    deals: Sequence[Mapping[str, Any]],
    equity: float,
    balance: float,
    unit: str,
    offset: int,
    *,
    floors: UnitFloors | None = None,
) -> dict[str, Any]:
    """This branch's ``combine_mt5_deal_ledger`` on a captured ledger.

    ``unit`` is the terminal-reported currency code. ``floors=None`` resolves the unit's own row.
    An explicit ``UnitFloors`` overrides it for a USD-family account only: a native-unit account
    (BTC) is judged on its own row, an override handed to it is ignored, and it is reported with
    ``d27_applicable=False`` ("native unit, D-27 n/a").

    Returns the flags that fired, the first measured day, the measured and NaN day counts, the
    per-day returns, the guard events the DQ-01 helper returned, and the series' first calendar day.
    A raise from the combine (an unclassifiable deal, a structural refusal) propagates to the caller,
    which records the error class for that key."""
    resolved = classify_account_currency(unit)
    used = resolved.floors
    d27_applicable = not resolved.native
    if floors is not None and d27_applicable:
        used = floors
    with _GuardSpy() as spy:
        returns, meta = combine_mt5_deal_ledger(
            deals, equity, balance, server_utc_offset_s=offset, floors=used
        )
    measured: dict[str, float] = {}
    nan_days = 0
    for ts, value in returns.items():
        if math.isnan(value):
            nan_days += 1
        else:
            measured[_iso(ts)] = float(value)
    first_index_day = _iso(returns.index[0]) if len(returns) else None
    return {
        "unit": resolved.code,
        "native_unit": resolved.native,
        "d27_applicable": d27_applicable,
        "flags": _flag_list(meta),
        "returns": measured,
        "first_measured_day": min(measured) if measured else None,
        "first_index_day": first_index_day,
        "measured_days": len(measured),
        "nan_days": nan_days,
        "guard_events": dict(spy.events),
        "day_level_flow_days": int(meta.get("flow_timing_day_level_days", 0) or 0),
        "timed_flow_days": int(meta.get("flow_timing_timed_days", 0) or 0),
        "status_hint": meta.get("computation_status_hint"),
    }


def compare(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, Any]:
    """BEFORE (stored) against AFTER (branch) for one strategy.

    ``before``/``after``: ``{"flags": [...], "returns": {iso day: return}}`` where ``returns`` holds
    the MEASURED days only. ``first_day_shift_days`` is negative when the AFTER series starts
    earlier. A day AFTER measures that BEFORE did not, inside the stored span, is newly measured; one
    past the last stored day is merely ``extended`` (newer than the stored derive, not an effect of
    the phase)."""
    b: Mapping[str, float] = before["returns"]
    a: Mapping[str, float] = after["returns"]
    b_flags, a_flags = set(before["flags"]), set(after["flags"])
    shift: int | None = None
    if b and a:
        shift = (_to_date(min(a)) - _to_date(min(b))).days
    b_last = max(b) if b else None
    newly = [d for d in a if d not in b and (b_last is None or d <= b_last)]
    extended = [d for d in a if b_last is not None and d > b_last]
    lost = [d for d in b if d not in a]
    both = [d for d in a if d in b]
    deltas = [abs(a[d] - b[d]) for d in both]
    return {
        "flags_removed": sorted(b_flags - a_flags),
        "flags_added": sorted(a_flags - b_flags),
        "first_day_shift_days": shift,
        "newly_measured_days": len(newly),
        "extended_days": len(extended),
        "lost_days": len(lost),
        "moved_days": sum(1 for x in deltas if x > 1e-9),
        "max_abs_change": max(deltas) if deltas else 0.0,
    }


# ---------------------------------------------------------------------------
# Deribit: sizing from the stored writer basis
# ---------------------------------------------------------------------------


def deribit_sizing(payload: Mapping[str, Any], *, dust_floor: float) -> dict[str, Any]:
    """The end-of-day return of every NAV day of a Deribit key, from its stored writer basis.

    The levels are the stored realized terminal rolled BACK through ``composed_day_pnl`` and
    ``composed_flows`` (``L_{t-1} = L_t - pnl_t - F_t``). A day's end-of-day return is ``pnl_t /
    L_{t-1}`` (the flow sits in the numerator's removal, D-05/D-07), judged by the branch's own
    ``_guard_denominator`` with ``dust_floor`` passed EXPLICITLY and ``PNL_DOM_RATIO``. Day 0 is the
    inception (D-01/D-12) when it carries a positive flow on a base within the residual tolerance.

    "Dropped flow days" are the stored dropped days that carry a flow: the days the TWR left out
    before. ``newly_measured`` counts those a remaining guard no longer drops, ``still_dropped`` the
    guard that still does."""
    try:
        basis = read_writer_basis(payload)
    except (ValueError, TypeError) as exc:
        return {"ok": False, "reason": f"corrupt_writer_basis:{type(exc).__name__}"}
    if basis is None:
        return {"ok": False, "reason": "no_writer_basis"}
    flows, pnl = basis
    try:
        terminal = read_realized_terminal(payload)
        dropped = read_dropped_day_pnl(payload)
    except (ValueError, TypeError) as exc:
        return {"ok": False, "reason": f"corrupt_stored_input:{type(exc).__name__}"}
    if terminal is None:
        return {"ok": False, "reason": "no_realized_terminal"}
    terminal_day, terminal_level = terminal
    all_days = sorted(set(pnl) | set(flows))
    if terminal_day not in all_days:
        return {"ok": False, "reason": "terminal_day_not_in_basis"}
    days = [d for d in all_days if d <= terminal_day]
    prior: dict[str, float] = {}
    level = terminal_level
    for d in reversed(days):
        level = level - pnl.get(d, 0.0) - flows.get(d, 0.0)
        prior[d] = level
    verdict: dict[str, dict[str, Any]] = {}
    returns: dict[str, float] = {}
    for i, d in enumerate(days):
        base, day_pnl, flow = prior[d], pnl.get(d, 0.0), flows.get(d, 0.0)
        inception = i == 0 and flow > 0.0 and abs(base) <= USD_FLOORS.residual_abs_tol
        guard: str | None = None
        r: float | None = None
        if not inception:
            guard = nav_twr._guard_denominator(base, dust_floor)
            if guard is None and abs(day_pnl) >= nav_twr.PNL_DOM_RATIO * base:
                guard = "pnl_dominated_guard"
            if guard is None:
                r = day_pnl / base
                returns[d] = r
        verdict[d] = {
            "r": r,
            "guard": guard,
            "flow": flow != 0.0,
            "dropped_stored": d in dropped,
            "inception": inception,
        }
    dropped_flow = [
        d for d, v in verdict.items() if v["dropped_stored"] and v["flow"] and not v["inception"]
    ]
    newly = [d for d in dropped_flow if verdict[d]["guard"] is None]
    still = Counter(verdict[d]["guard"] for d in dropped_flow if verdict[d]["guard"] is not None)
    return {
        "ok": True,
        "reason": None,
        "dust_floor": dust_floor,
        "nav_days": len(days),
        "days_after_terminal": len(all_days) - len(days),
        "flow_days": sum(1 for v in verdict.values() if v["flow"]),
        "verdict": verdict,
        "returns": returns,
        "inception_days": sum(1 for v in verdict.values() if v["inception"]),
        "dropped_flow_days": len(dropped_flow),
        "newly_measured": len(newly),
        "still_dropped": dict(still),
        "max_abs_new_return": max((abs(verdict[d]["r"]) for d in newly), default=0.0),
        "new_ge_10pct": sum(1 for d in newly if abs(verdict[d]["r"]) >= 0.10),
        "new_ge_100pct": sum(1 for d in newly if abs(verdict[d]["r"]) >= 1.0),
    }


def deribit_crosscheck(
    sizing: Mapping[str, Any], stored_returns: Mapping[str, float]
) -> dict[str, int]:
    """How many days both the recomputation and the stored key series measure, and how many agree
    (within ``1e-6``). A guard on the recomputation itself: where the stored basis and the stored
    series disagree the sizing cannot be trusted for that key."""
    mine: Mapping[str, float] = sizing.get("returns", {})
    both = [d for d in mine if d in stored_returns]
    agree = sum(
        1
        for d in both
        if abs(mine[d] - stored_returns[d]) <= _AGREE_TOL * (1.0 + abs(stored_returns[d]))
    )
    return {"both_measured": len(both), "agree": agree, "disagree": len(both) - agree}


# ---------------------------------------------------------------------------
# 167.1.2 D-27 sizing
# ---------------------------------------------------------------------------


def d27_compare(
    old: Mapping[str, Mapping[str, Mapping[str, Any]]],
    new: Mapping[str, Mapping[str, Mapping[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Per venue, the days whose verdict flips because the USD dust floor moved 1000 -> 100.

    ``old`` / ``new``: ``{venue: {ordinal: result}}`` where each result holds a ``returns`` map of
    the MEASURED days. A day measured only at the new floor was dust-guarded at the old one
    (``to_measured``); the reverse is ``to_dust_guarded``. ``max_abs_change`` is the largest
    absolute return on a flipped day (the return that appears or disappears)."""
    out: dict[str, dict[str, Any]] = {}
    for venue in sorted(set(old) | set(new)):
        o, n = old.get(venue, {}), new.get(venue, {})
        to_measured = to_dust = 0
        biggest = 0.0
        shared = sorted(set(o) & set(n))
        for ordinal in shared:
            o_ret, n_ret = o[ordinal]["returns"], n[ordinal]["returns"]
            for d in n_ret:
                if d not in o_ret:
                    to_measured += 1
                    biggest = max(biggest, abs(n_ret[d]))
            for d in o_ret:
                if d not in n_ret:
                    to_dust += 1
                    biggest = max(biggest, abs(o_ret[d]))
        out[venue] = {
            "keys": len(shared),
            "to_measured": to_measured,
            "to_dust_guarded": to_dust,
            "max_abs_change": biggest,
        }
    return out


# Each channel's own operator and the venues whose code path runs it (read at the sites named in
# the plan: ``job_worker._run_key_mode_compose_epilogue``, the Deribit-collapsed, MT5 and ccxt wedge
# gates in ``run_derive_broker_dailies_job``, ``nav_twr.reconstruct_nav_and_twr`` and the stitched
# ccxt member ``_reconstruct_ccxt_member``). ``abs_le``: the gate FIRES when ``abs(x) <= floor``;
# ``gt``: it fires when ``x > floor``.
_CHANNELS: dict[str, tuple[str, frozenset[str] | None]] = {
    "epilogue_anchor_null": ("abs_le", None),
    "deribit_wedge": ("gt", frozenset({"deribit"})),
    "mt5_wedge": ("gt", frozenset({"mt5"})),
    "ccxt_wedge": ("gt", _CCXT_VENUES),
    "nav_twr_wedge": ("gt", frozenset({"mt5", "sfox"}) | _CCXT_VENUES),
    "stitched_ccxt_member": ("abs_le", _CCXT_VENUES),
}
_GROUPS = ("MT5", "Deribit", "other")


def _fires(operator: str, x: float, floor: float) -> bool:
    return abs(x) <= floor if operator == "abs_le" else x > floor


def gate_channel_flips(
    keys: Sequence[Mapping[str, Any]], *, old_floor: float = 1000.0, new_floor: float = 100.0
) -> dict[str, Any]:
    """Per channel and venue group, how many keys' gate verdict differs between the two floors.

    ``keys``: ``{"venue", "unit", "native", "gate_input"}`` (``gate_input`` None when nothing is
    stored). A native-unit key reads its own row, which D-27 did not move: counted as ``native_na``,
    never evaluated. A key with no stored input is ``not_sized``. ``ccxt_heuristic_candidates``
    counts ccxt keys whose stored balance lies in (new_floor, old_floor]: the transforms anchor stops
    falling back to heuristic capital for them at the recompute. Candidates, not a sized change."""
    channels: dict[str, dict[str, dict[str, int]]] = {
        name: {g: {"keys": 0, "flips": 0, "not_sized": 0, "native_na": 0} for g in _GROUPS}
        for name in _CHANNELS
    }
    in_interval = no_input = 0
    candidates = ccxt_unsized = 0
    for key in keys:
        venue = str(key.get("venue"))
        x = key.get("gate_input")
        native = bool(key.get("native"))
        if not native:
            if x is None:
                no_input += 1
            elif new_floor <= float(x) <= old_floor:
                in_interval += 1
        if venue in _CCXT_VENUES and not native:
            if x is None:
                ccxt_unsized += 1
            elif new_floor < float(x) <= old_floor:
                candidates += 1
        for name, (operator, venues) in _CHANNELS.items():
            if venues is not None and venue not in venues:
                continue
            row = channels[name][_group(venue)]
            row["keys"] += 1
            if native:
                row["native_na"] += 1
            elif x is None:
                row["not_sized"] += 1
            elif _fires(operator, float(x), old_floor) != _fires(operator, float(x), new_floor):
                row["flips"] += 1
    return {
        "channels": channels,
        "keys_in_interval": in_interval,
        "keys_without_input": no_input,
        "ccxt_heuristic_candidates": candidates,
        "ccxt_unsized": ccxt_unsized,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _error_class(exc: BaseException) -> str:
    return type(exc).__name__


def _classify_row(
    status: str,
    detail: str | None,
    after: Mapping[str, Any] | None,
    before_returns: Mapping[str, float],
) -> dict[str, Any]:
    """The verdict for a flagged MT5 strategy row: confirmed day-0, confirmed flow-only, other, or
    not captured. Day-0 means the stored series' LEADING gap (calendar days between the ledger's
    first day and the first stored return) was caused by the inception rule; flow-only means the
    gaps were INTERIOR days (flow days) and the leading edge was fine."""
    if status != "ok" or after is None:
        # The interior gap needs no ledger: it is the stored series' own missing days.
        stored_interior: int | None = None
        if before_returns:
            first, last = min(before_returns), max(before_returns)
            span = (_to_date(last) - _to_date(first)).days + 1
            stored_interior = max(0, span - len(before_returns))
        return {
            "verdict": "not captured",
            "detail": detail or status,
            "leading": None,
            "interior": stored_interior,
        }
    remaining = sorted(set(after["flags"]) & set(_GUARD_KEYS))
    leading = interior = 0
    if before_returns and after.get("first_index_day"):
        first, last = min(before_returns), max(before_returns)
        leading = max(0, (_to_date(first) - _to_date(after["first_index_day"])).days)
        span = (_to_date(last) - _to_date(first)).days + 1
        interior = max(0, span - len(before_returns))
    if remaining:
        return {
            "verdict": "other",
            "detail": "guard remains: " + ", ".join(remaining),
            "leading": leading,
            "interior": interior,
        }
    if leading > 0:
        verdict = "confirmed day-0"
    elif interior > 0:
        verdict = "confirmed flow-only"
    else:
        verdict = "other"
    return {
        "verdict": verdict,
        "detail": "no guard left" if verdict != "other" else "no missing stored day to explain the flag",
        "leading": leading,
        "interior": interior,
    }


def analyze(before: Mapping[str, Any], captured: Mapping[str, Any]) -> dict[str, Any]:
    """Everything the report says, as plain data. ``before`` and ``captured`` are the two scratch
    JSON documents (see the module docstring)."""
    offset = int(captured.get("offset_s", 0) or 0)
    cap_keys: Mapping[str, Any] = captured.get("keys", {}) or {}
    keys: Sequence[Mapping[str, Any]] = before.get("keys", []) or []
    strategies: Sequence[Mapping[str, Any]] = before.get("strategies", []) or []

    # Ordinals come from list position only: the SELECTs order rows by creation, so they are stable
    # between runs and never derived from an identifier.
    key_ord: dict[str, str] = {}
    counters: Counter[str] = Counter()
    for k in keys:
        venue = str(k.get("venue") or "none")
        counters[venue] += 1
        key_ord[str(k["id"])] = f"{venue}-key-{counters[venue]}"
    strat_ord: dict[str, str] = {}
    s_counters: Counter[str] = Counter()
    for s in strategies:
        venue = str(s.get("venue") or "none")
        prefix = "keyless" if venue == "none" else venue
        s_counters[prefix] += 1
        strat_ord[str(s["id"])] = f"{prefix}-strategy-{s_counters[prefix]}"

    # ---- MT5 keys: captured ledger -> AFTER at the branch row and at the pre-D-27 row.
    mt5_keys: dict[str, dict[str, Any]] = {}
    for k in keys:
        if k.get("venue") != "mt5":
            continue
        kid = str(k["id"])
        ordinal = key_ord[kid]
        entry: dict[str, Any] = {"ordinal": ordinal, "status": "not_captured", "detail": "not attempted"}
        if not k.get("active", True) or k.get("disconnected"):
            entry["detail"] = "key disconnected"
        else:
            cap = cap_keys.get(kid)
            if cap is not None and cap.get("status") == "captured":
                try:
                    unit = str(cap.get("currency") or k.get("unit") or "")
                    equity, balance = float(cap["equity"]), float(cap["balance"])
                    branch = mt5_after(cap["deals"], equity, balance, unit, offset)
                    legacy = (
                        mt5_after(
                            cap["deals"], equity, balance, unit, offset, floors=PRE_D27_USD_FLOORS
                        )
                        if branch["d27_applicable"]
                        else None
                    )
                    entry = {
                        "ordinal": ordinal,
                        "status": "ok",
                        "detail": None,
                        "after": branch,
                        "after_pre_d27": legacy,
                        "equity": equity,
                        "unit": branch["unit"],
                        "native": branch["native_unit"],
                    }
                except Exception as exc:  # noqa: BLE001 - the class is recorded for the key, never hidden
                    entry = {
                        "ordinal": ordinal,
                        "status": "error",
                        "detail": f"combine raised: {_error_class(exc)}",
                    }
            elif cap is not None:
                entry["detail"] = str(cap.get("error_class") or "unknown error class")
        mt5_keys[kid] = entry

    # ---- MT5 strategies (the flagged rows).
    mt5_rows: list[dict[str, Any]] = []
    keyless_rows: list[dict[str, Any]] = []
    for s in strategies:
        flags = s.get("flags") or {}
        flagged = any(flags.get(g) for g in _ALL_GUARDS)
        s_venue = s.get("venue")
        if s_venue == "mt5":
            kentry = mt5_keys.get(str(s.get("key_id")))
            before_state: dict[str, Any] = {
                "flags": [f for f in _flag_list(flags) if f in _ENGINE_FLAGS],
                "returns": dict(s.get("returns") or {}),
            }
            cmp_ = None
            after = None
            status: str = "not_captured"
            detail: str | None = "no key row"
            if kentry is not None:
                status, detail = kentry["status"], kentry.get("detail")
                if status == "ok":
                    after = kentry["after"]
                    cmp_ = compare(before_state, after)
            verdict = (
                _classify_row(status, detail, after, before_state["returns"]) if flagged else None
            )
            mt5_rows.append(
                {
                    "ordinal": strat_ord[str(s["id"])],
                    "key_ordinal": key_ord.get(str(s.get("key_id"))),
                    "flagged": flagged,
                    "before_flags": [f for f in before_state["flags"] if f in _ALL_GUARDS],
                    "before_status": s.get("status"),
                    "status": status,
                    "detail": detail,
                    "after_flags": []
                    if after is None
                    else [f for f in after["flags"] if f in _GUARD_KEYS],
                    "after_guard_events": {} if after is None else after["guard_events"],
                    "compare": cmp_,
                    "verdict": verdict,
                }
            )
        elif flagged:
            keyless_rows.append(
                {
                    "ordinal": strat_ord[str(s["id"])],
                    "before_flags": [f for f in _flag_list(flags) if f in _ALL_GUARDS],
                    "before_status": s.get("status"),
                }
            )

    # ---- The BTC MT5 reference account (the MM-2x shape): day 0 and day 1, before and after.
    reference: dict[str, Any] | None = None
    btc_all = [k for k in keys if k.get("venue") == "mt5" and k.get("unit") == "BTC"]
    if btc_all:
        kid = str(btc_all[0]["id"])
        kentry = mt5_keys.get(kid, {})
        if kentry.get("status") == "ok":
            after = kentry["after"]
            first = after["first_index_day"]
            second_iso = (
                None if first is None else date.fromordinal(_to_date(first).toordinal() + 1).isoformat()
            )
            stored: dict[str, float] = {}
            for s in strategies:
                if str(s.get("key_id")) == kid:
                    stored = dict(s.get("returns") or {})
                    break
            reference = {
                "status": "ok",
                "day0_before": stored.get(first) if first else None,
                "day0_after": after["returns"].get(first) if first else None,
                "day1_before": stored.get(second_iso) if second_iso else None,
                "day1_after": after["returns"].get(second_iso) if second_iso else None,
                "after_flags": [f for f in after["flags"] if f in _GUARD_KEYS],
            }
        else:
            reference = {"status": "not_captured", "detail": kentry.get("detail")}

    # ---- Deribit sizing from the stored writer basis, at the branch floor and at the old one.
    deribit: list[dict[str, Any]] = []
    deribit_new: dict[str, dict[str, Any]] = {}
    deribit_old: dict[str, dict[str, Any]] = {}
    for k in keys:
        if k.get("venue") != "deribit":
            continue
        ordinal = key_ord[str(k["id"])]
        payload = k.get("payload") or {}
        new = deribit_sizing(payload, dust_floor=USD_FLOORS.dust_nav)
        old = deribit_sizing(payload, dust_floor=PRE_D27_USD_FLOORS.dust_nav)
        row: dict[str, Any] = {"ordinal": ordinal, "ok": new["ok"], "reason": new.get("reason")}
        if new["ok"]:
            deribit_new[ordinal], deribit_old[ordinal] = new, old
            row.update(
                {
                    "nav_days": new["nav_days"],
                    "flow_days": new["flow_days"],
                    "dropped_flow_days": new["dropped_flow_days"],
                    "newly_measured": new["newly_measured"],
                    "still_dropped": new["still_dropped"],
                    "max_abs_new_return": new["max_abs_new_return"],
                    "new_ge_10pct": new["new_ge_10pct"],
                    "new_ge_100pct": new["new_ge_100pct"],
                    "inception_days": new["inception_days"],
                    "series_sig": hash(tuple((d, round(v, 9)) for d, v in sorted(new["returns"].items()))),
                    "crosscheck": deribit_crosscheck(new, dict(k.get("key_returns") or {})),
                }
            )
        deribit.append(row)

    # ---- Other venues: flows stored.
    other_keys = [k for k in keys if k.get("venue") not in ("mt5", "deribit")]
    other = {
        "keys": len(other_keys),
        "keys_with_flows": sum(1 for k in other_keys if (k.get("payload") or {}).get("flows")),
        "flow_days": sum(len((k.get("payload") or {}).get("flows") or []) for k in other_keys),
    }

    # ---- D-27.
    old_by_venue: dict[str, dict[str, Any]] = {"MT5": {}, "Deribit": deribit_old}
    new_by_venue: dict[str, dict[str, Any]] = {"MT5": {}, "Deribit": deribit_new}
    for e in mt5_keys.values():
        if e.get("status") == "ok" and e["after_pre_d27"] is not None:
            old_by_venue["MT5"][e["ordinal"]] = e["after_pre_d27"]
            new_by_venue["MT5"][e["ordinal"]] = e["after"]
    d27 = d27_compare(old_by_venue, new_by_venue)
    # Keys on one account carry one series; the D-27 Deribit flips are also counted once per series.
    seen_sig: dict[int, str] = {}
    for row in deribit:
        if row["ok"]:
            seen_sig.setdefault(row["series_sig"], row["ordinal"])
    uniq_ord = set(seen_sig.values())
    d27_distinct = d27_compare(
        {"Deribit": {o: v for o, v in deribit_old.items() if o in uniq_ord}},
        {"Deribit": {o: v for o, v in deribit_new.items() if o in uniq_ord}},
    )["Deribit"]
    gate_keys: list[dict[str, Any]] = []
    gate_sources: Counter[str] = Counter()
    for k in keys:
        if not k.get("active", True) or k.get("disconnected"):
            continue
        entry = mt5_keys.get(str(k["id"]), {})
        native = bool(k.get("native"))
        unit = k.get("unit") or "USD"
        # The measured gate input, in the order the plan fixes: the captured MT5 equity, else the
        # stored last-derive USD balance. A key with neither falls back to the stored derive anchor
        # (the equity the last key-mode derive anchored to) and then to the stored realized
        # terminal (that equity less the open P&L), each labelled as such in the report; a key with
        # none of the four is not sized.
        x = None
        if entry.get("status") == "ok":
            x, native, unit, source = entry["equity"], bool(entry["native"]), entry["unit"], "captured"
        elif k.get("balance_usdt") is not None:
            x, source = k["balance_usdt"], "stored balance"
        elif k.get("anchor_usd") is not None:
            x, source = k["anchor_usd"], "stored anchor"
        elif k.get("terminal_usd") is not None:
            x, source = k["terminal_usd"], "stored terminal"
        else:
            source = "none"
        if native:
            source = "native (n/a)"
        gate_sources[source] += 1
        gate_keys.append({"venue": k.get("venue"), "unit": unit, "native": native, "gate_input": x})
    gates = gate_channel_flips(gate_keys)
    dust_null = Counter(
        _group(k.get("venue")) for k in keys if k.get("anchor_null_reason") == "dust"
    )

    return {
        "run_date": before.get("run_date"),
        "offset_s": offset,
        "notes": [],
        "ordinals": {"keys": key_ord, "strategies": strat_ord},
        "mt5_keys": mt5_keys,
        "mt5_rows": mt5_rows,
        "keyless_rows": keyless_rows,
        "reference": reference,
        "deribit": deribit,
        "other": other,
        "d27": d27,
        "d27_deribit_distinct": d27_distinct,
        "gates": gates,
        "gate_sources": dict(gate_sources),
        "dust_null": dict(dust_null),
    }


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def _pct(x: float | None) -> str:
    return "none" if x is None else f"{x * 100:+.2f}%"


def _row(*cells: Any) -> str:
    return "| " + " | ".join(str(c) for c in cells) + " |"


def _flags(flags: Sequence[str]) -> str:
    return ", ".join(flags) if flags else "none"


def render_report(analysis: Mapping[str, Any], *, marker_verdict: str) -> str:
    """The counts-only DRYRUN document. Ordinals, counts and returns; every string is scrubbed."""
    a = analysis
    out: list[str] = []
    w = out.append
    w("# FLOWTIMING dry run (D-13): before and after, PROD, no write")
    w("")
    w(f"- Marker query verdict: **{marker_verdict}**")
    w(f"- Run date: {a.get('run_date')}")
    w("- Method: BEFORE is the stored PROD state. AFTER is this branch's code on the same inputs "
      "(MT5: the captured deal ledger through `combine_mt5_deal_ledger`; Deribit: the stored "
      "writer basis rolled back from the stored realized terminal, end-of-day convention).")
    w("- Every PROD statement was a SELECT. Counts, ordinals and returns only.")
    for note in a.get("notes", []):
        w(f"- Note: {note}")
    w("")

    mt5_keys = list(a["mt5_keys"].values())
    ok_keys = [e for e in mt5_keys if e["status"] == "ok"]
    w("## Capture status (MT5)")
    w("")
    w(f"MT5 keys: {len(mt5_keys)}. Captured and recomputed: {len(ok_keys)}.")
    for e in mt5_keys:
        if e["status"] != "ok":
            w(f"- {e['ordinal']}: not captured: {e['detail']}")
    w("")

    mt5_rows = a["mt5_rows"]
    flagged = [r for r in mt5_rows if r["flagged"]]
    w("## Per venue")
    w("")
    w(_row("Venue", "Strategies / keys", "Flagged rows before", "Flags that disappear", "Day-level flow days after"))
    w(_row("---", "---", "---", "---", "---"))
    removed: Counter[str] = Counter()
    day_level = 0
    for r in flagged:
        if r["compare"] is not None:
            removed.update(r["compare"]["flags_removed"])
    for e in ok_keys:
        day_level += e["after"]["day_level_flow_days"]
    w(_row(
        "MT5",
        f"{len(mt5_rows)} strategies / {len(mt5_keys)} keys",
        len(flagged),
        ", ".join(f"{k} x{v}" for k, v in sorted(removed.items())) or "none measured",
        day_level if ok_keys else "not captured",
    ))
    dr_rows = a["deribit"]
    w(_row("Deribit", f"0 strategies / {len(dr_rows)} keys", 0,
           "key-mode only; flags are not stored per key", "all flow days (end-of-day)"))
    o = a["other"]
    w(_row("other", f"{o['keys']} keys", 0, "none", f"{o['flow_days']} stored flow days"))
    w("")

    w("## MT5: per strategy, before and after")
    w("")
    w(_row("Strategy", "Key", "Flags before", "Flags after", "First-day shift (days)",
           "Newly measured days", "Days moved", "Max abs change", "Days still dropped (guard events)"))
    w(_row(*["---"] * 9))
    for r in mt5_rows:
        c = r["compare"]
        if c is None:
            w(_row(r["ordinal"], r["key_ordinal"], _flags(r["before_flags"]),
                   f"not captured: {r['detail']}", "-", "-", "-", "-", "-"))
            continue
        events = ", ".join(f"{k} x{v}" for k, v in sorted(r["after_guard_events"].items())) or "none"
        w(_row(r["ordinal"], r["key_ordinal"], _flags(r["before_flags"]), _flags(r["after_flags"]),
               c["first_day_shift_days"], c["newly_measured_days"], c["moved_days"],
               f"{c['max_abs_change']:.4f}", events))
    w("")

    w("## The flagged rows: day-0 caused?")
    w("")
    w("Verdicts: confirmed day-0 (the leading gap was the inception day), confirmed flow-only "
      "(interior flow days), other, not captured.")
    w("")
    total_flagged = len(flagged) + len(a["keyless_rows"])
    w(f"Flagged rows: {total_flagged} ({len(flagged)} on an MT5 key, {len(a['keyless_rows'])} keyless).")
    w("")
    w(_row("Row", "Verdict", "Detail", "Leading gap (days)", "Interior gap (days)"))
    w(_row("---", "---", "---", "---", "---"))
    for r in flagged:
        v = r["verdict"]
        w(_row(r["ordinal"], v["verdict"], v["detail"],
               "-" if v["leading"] is None else v["leading"],
               "-" if v["interior"] is None else v["interior"]))
    for r in a["keyless_rows"]:
        w(_row(r["ordinal"], "composite or keyless",
               "flags are a member union and clear when the members recompute", "-", "-"))
    w("")

    ref = a["reference"]
    w("## The BTC MT5 reference account")
    w("")
    if ref is None:
        w("No BTC MT5 key stored.")
    elif ref["status"] != "ok":
        w(f"Not captured: {ref.get('detail')}")
    else:
        w(_row("Day", "Return before", "Return after"))
        w(_row("---", "---", "---"))
        w(_row("day 0 (first deposit)", _pct(ref["day0_before"]), _pct(ref["day0_after"])))
        w(_row("day 1 (the 1.0 deposit day)", _pct(ref["day1_before"]), _pct(ref["day1_after"])))
        w("")
        w(f"Guard flags after: {_flags(ref['after_flags'])}.")
    w("")

    w("## D-05 + D-07 sizing: flow days now measured")
    w("")
    w("MT5 flow days are measured on their timestamps (D-02/D-03). A non-MT5 flow day counts at the "
      "end of its day (D-07), so its return can be large; `pnl_dominated_guard` (10x) is the backstop.")
    w("")
    ok_d = [r for r in dr_rows if r["ok"]]
    w(_row("Deribit key", "NAV days", "Flow days", "Dropped flow days (stored)", "Newly measured",
           "Still dropped (guard)", "Largest new |return|", "New days >= 10% / >= 100%",
           "Stored-series agreement"))
    w(_row(*["---"] * 9))
    for r in dr_rows:
        if not r["ok"]:
            w(_row(r["ordinal"], "-", "-", "-", "-", f"not sized: {r['reason']}", "-", "-", "-"))
            continue
        cc = r["crosscheck"]
        still = ", ".join(f"{k} x{v}" for k, v in sorted(r["still_dropped"].items())) or "none"
        w(_row(r["ordinal"], r["nav_days"], r["flow_days"], r["dropped_flow_days"], r["newly_measured"],
               still, f"{r['max_abs_new_return']:.4f}",
               f"{r['new_ge_10pct']} / {r['new_ge_100pct']}",
               f"{cc['agree']} of {cc['both_measured']}"))
    total_dropped = sum(r["dropped_flow_days"] for r in ok_d)
    total_new = sum(r["newly_measured"] for r in ok_d)
    biggest = max((r["max_abs_new_return"] for r in ok_d), default=0.0)
    big10 = sum(r["new_ge_10pct"] for r in ok_d)
    big100 = sum(r["new_ge_100pct"] for r in ok_d)
    still_all: Counter[str] = Counter()
    for r in ok_d:
        still_all.update(r["still_dropped"])
    w("")
    w(f"Deribit: {len(ok_d)} of {len(dr_rows)} keys sized. {total_dropped} stored dropped flow days; "
      f"{total_new} now carry an end-of-day return; still dropped: "
      f"{', '.join(f'{k} x{v}' for k, v in sorted(still_all.items())) or 'none'}. "
      f"Largest absolute new return: {biggest * 100:.2f}%; {big10} of those days are >= 10% and "
      f"{big100} are >= 100%.")
    uniq = list({r["series_sig"]: r for r in ok_d}.values())
    u_still: Counter[str] = Counter()
    for r in uniq:
        u_still.update(r["still_dropped"])
    w(f"Keys on one account repeat one series: the {len(ok_d)} sized keys carry {len(uniq)} distinct "
      "series, so the counts above repeat across keys that share an account. Counting each distinct "
      f"series once: {sum(r['dropped_flow_days'] for r in uniq)} stored dropped flow days; "
      f"{sum(r['newly_measured'] for r in uniq)} now carry an end-of-day return "
      f"({sum(r['new_ge_10pct'] for r in uniq)} at least 10%, "
      f"{sum(r['new_ge_100pct'] for r in uniq)} at least 100%); still dropped: "
      f"{', '.join(f'{k} x{v}' for k, v in sorted(u_still.items())) or 'none'}.")
    w(f"Other venues (Bybit, OKX): {o['keys_with_flows']} of {o['keys']} keys have stored flows "
      f"({o['flow_days']} flow days), so there is no non-MT5 flow day to size outside Deribit.")
    w("")

    w("## 167.1.2 D-27 (USD dust floor $1000 -> $100)")
    w("")
    w("Sized separately from the section above. The AFTER computation ran twice on the same inputs: "
      "the pre-D-27 floors passed explicitly, then the branch row.")
    w("")
    w("### Days whose verdict flips, per venue")
    w("")
    w(_row("Venue", "Keys compared", "Dust-guarded -> measured", "Measured -> dust-guarded",
           "Largest |return| on flipped days"))
    w(_row("---", "---", "---", "---", "---"))
    for venue in _GROUPS:
        d = a["d27"].get(venue)
        if venue == "other":
            w(_row("other", "-", "not sized", "not sized", "no stored basis; see the ccxt candidates below"))
        elif venue == "MT5" and not ok_keys:
            w(_row("MT5", 0, "not captured", "not captured", "-"))
        elif d is not None:
            w(_row(venue, d["keys"], d["to_measured"], d["to_dust_guarded"],
                   f"{d['max_abs_change'] * 100:.2f}%"))
    dd = a["d27_deribit_distinct"]
    w("")
    w(f"Deribit keys that share an account repeat one series. Counting each distinct series once: "
      f"{dd['keys']} series, {dd['to_measured']} days dust-guarded -> measured, "
      f"{dd['to_dust_guarded']} measured -> dust-guarded.")
    w("")
    g = a["gates"]
    w("### Channels (key counts whose verdict flips between the two floors)")
    w("")
    gs = a["gate_sources"]
    w("Gate input: the captured MT5 equity where captured, else the stored `account_balance_usdt`, "
      "else the stored derive anchor, else the stored realized terminal. A native-unit key reads its own row and is counted as n/a. "
      f"Active keys by input source: {', '.join(f'{k} {v}' for k, v in sorted(gs.items())) or 'none'}.")
    w("")
    w(_row("Channel", "Venue", "Keys", "Flips", "Not sized (no stored input)", "Native n/a"))
    w(_row(*["---"] * 6))
    for channel, groups in g["channels"].items():
        for venue in _GROUPS:
            row = groups[venue]
            if row["keys"] == 0:
                continue
            w(_row(channel, venue, row["keys"], row["flips"], row["not_sized"], row["native_na"]))
    w("")
    total_flips = sum(r["flips"] for grp in g["channels"].values() for r in grp.values())
    if total_flips == 0 and g["keys_in_interval"] == 0 and g["keys_without_input"] == 0:
        w("Measured: no PROD key has a gate input in [100, 1000], and none lacks a stored input, so no "
          "channel flips.")
    else:
        w(f"Keys with a gate input in [100, 1000]: {g['keys_in_interval']}. Keys with no stored input "
          f"(not sized): {g['keys_without_input']}. Total channel flips: {total_flips}.")
    w("")
    w("### Epilogue dust anchor null (upper bound)")
    w("")
    dn = a["dust_null"]
    w(f"`key_inputs` payloads stamped `anchor_null_reason='dust'` today: {sum(dn.values())} "
      f"({', '.join(f'{k} {v}' for k, v in sorted(dn.items())) or 'none'}). This is the upper bound "
      "of the epilogue channel.")
    w("")
    w("### ccxt heuristic-anchor candidates")
    w("")
    w(f"Candidates: {g['ccxt_heuristic_candidates']} ccxt keys have a stored balance in (100, 1000], "
      f"so their anchor stops falling back to heuristic capital at the recompute "
      f"({g['ccxt_unsized']} ccxt keys have no stored balance). They are candidates, not a sized "
      "change: their return change needs the ccxt trades and a live balance, which this dry run does "
      "not capture.")
    w("")
    w("`verify_strategy`'s live effect of the floor is not sized: it has no stored inputs.")
    w("")
    return _scrub("\n".join(out))


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FLOWTIMING dry run report (read-only).")
    parser.add_argument("--before", required=True, help="path to the stored-state JSON (scratch)")
    parser.add_argument("--captured", help="path to the captured-inputs JSON (scratch)")
    parser.add_argument("--marker-verdict", required=True, help="the recorded marker verdict line")
    parser.add_argument("--out", help="write the report here instead of stdout")
    parser.add_argument("--map-out", help="write the ordinal map (scratch only; it holds ids)")
    parser.add_argument("--note", action="append", default=[], help="a line to add under the header")
    args = parser.parse_args(argv)

    with open(args.before, encoding="utf-8") as fh:
        before = json.load(fh)
    captured: Mapping[str, Any] = {"offset_s": 0, "keys": {}}
    if args.captured:
        with open(args.captured, encoding="utf-8") as fh:
            captured = json.load(fh)
    analysis = analyze(before, captured)
    analysis["notes"] = [_scrub(n) for n in args.note]
    text = render_report(analysis, marker_verdict=_scrub(args.marker_verdict))
    if args.map_out:
        with open(args.map_out, "w", encoding="utf-8") as fh:
            json.dump(analysis["ordinals"], fh)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
