"""Phase 175 MT5OFFSET - the broker clock follows a daylight-saving rule (SC-2, D-01).

The NAVMTM REVIEW-3 WR-02 numbers are the anchor: a 50,000 deposit at true
2026-11-11T00:30Z, a broker on UTC+2 that night, and a mark for 2026-11-10 read at
00:10Z. The deposit is AFTER the read, so the mark does not hold it and the 11-11
mark does. A fixed 10800 offset reads the broker an hour fast in winter, files the
deposit on 2026-11-10 at 23:30Z (before the read) and publishes +4% then +49%
(cumulative +54.98%) where the truth is a single +2% step.

These tests must fail when the offset rule breaks: every expected number is a hand
literal or comes from an independent oracle (``zoneinfo``), never from a value read
back out of the code under test.
"""
from __future__ import annotations

import ast
import calendar
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from services.external_flows import FlowInstant
from services.mt5_deals import deal_utc_day, deal_utc_instant_ms
from services.mt5_deals import Mt5DealClassificationError
from services.mt5_server_clock import (
    MT5_SERVER_CLOCK_CONFIG_MESSAGES,
    Mt5ServerClock,
    Mt5ServerClockConfigError,
    fixed_server_clock,
    resolve_mt5_server_clock,
    server_clock_for_rule,
)
from services.nav_marks_apply import AppliedMark, apply_marks


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _wall_epoch(true_utc_iso: str, offset_hours: int) -> int:
    """The broker WALL clock for a true UTC instant, read as if it were UTC: the
    quantity a deal's ``time`` already is (the terminal returns it verbatim)."""
    true_utc = _at(true_utc_iso)
    wall = true_utc.timestamp() + offset_hours * 3600
    return int(wall)


def _cum_for_deposit(
    clock: object,
    *,
    deposit_true_utc: str,
    broker_offset_hours: int,
    realized_start: str,
    mark_days: tuple[str, str, str],
    read_iso: tuple[str, str, str],
) -> tuple[str, int | None, float]:
    """Run the WR-02 shape through the seam and ``apply_marks``.

    Returns (flow day, flow instant ms, cumulative return of the published series).
    Marks: NAV 102k with 2k open profit, then 152k twice (the deposit is in the
    second mark, not the first).
    """
    wall = _wall_epoch(deposit_true_utc, broker_offset_hours)
    deal = {"time": wall, "time_msc": wall * 1000}
    day = deal_utc_day(deal["time"], clock)  # type: ignore[arg-type]
    instant_ms = deal_utc_instant_ms(deal, clock)  # type: ignore[arg-type]
    assert instant_ms is not None, "an unambiguous hour must keep its instant"
    realized = pd.Series([0.0] * 3, index=pd.date_range(realized_start, periods=3))
    marks = [
        AppliedMark(mark_days[0], 102_000.0, 2_000.0, _at(read_iso[0])),
        AppliedMark(mark_days[1], 152_000.0, 2_000.0, _at(read_iso[1])),
        AppliedMark(mark_days[2], 152_000.0, 2_000.0, _at(read_iso[2])),
    ]
    out = apply_marks(
        realized,
        {day: 50_000.0},
        marks,
        day_pnl={},
        flow_instants=[FlowInstant(instant_ms, day, 50_000.0)],
    )
    cum = float((1 + out.returns).prod() - 1)
    return day, instant_ms, cum


_WINTER = dict(
    deposit_true_utc="2026-11-11T00:30:00+00:00",
    broker_offset_hours=2,
    realized_start="2026-11-07",
    mark_days=("2026-11-10", "2026-11-11", "2026-11-12"),
    read_iso=(
        "2026-11-11T00:10:00+00:00",
        "2026-11-12T00:10:00+00:00",
        "2026-11-13T00:10:00+00:00",
    ),
)

_SUMMER = dict(
    deposit_true_utc="2026-07-15T00:30:00+00:00",
    broker_offset_hours=3,
    realized_start="2026-07-11",
    mark_days=("2026-07-14", "2026-07-15", "2026-07-16"),
    read_iso=(
        "2026-07-15T00:10:00+00:00",
        "2026-07-16T00:10:00+00:00",
        "2026-07-17T00:10:00+00:00",
    ),
)

# 2026-11-11T00:30Z as epoch milliseconds (1_794_357_000 s, hand literal).
_WINTER_TRUE_INSTANT_MS = 1_794_357_000_000


@pytest.mark.parametrize("rule_id", ["us", "eu"])
def test_mark_placement_winter_deposit_follows_the_dst_rule(rule_id: str) -> None:
    """SC-2: under either DST rule the broker is on UTC+2 on 2026-11-11, so the
    deposit is filed on 2026-11-11 at its true instant and the published series is
    one +2% step (rows 2026-11-10 0.02, 2026-11-11 0.0, 2026-11-12 0.0)."""
    clock = server_clock_for_rule(rule_id)
    day, instant_ms, cum = _cum_for_deposit(clock, **_WINTER)  # type: ignore[arg-type]
    assert day == "2026-11-11"
    assert instant_ms == _WINTER_TRUE_INSTANT_MS
    assert cum == pytest.approx(0.02, abs=1e-9)


def test_mark_placement_winter_rows_are_one_two_percent_step() -> None:
    """The per-row view of the same scenario: the +2% lands on the mark day only."""
    clock = server_clock_for_rule("us")
    wall = _wall_epoch(_WINTER["deposit_true_utc"], 2)  # type: ignore[arg-type]
    deal = {"time": wall, "time_msc": wall * 1000}
    day = deal_utc_day(deal["time"], clock)
    instant_ms = deal_utc_instant_ms(deal, clock)
    assert instant_ms is not None
    realized = pd.Series([0.0] * 3, index=pd.date_range("2026-11-07", periods=3))
    marks = [
        AppliedMark("2026-11-10", 102_000.0, 2_000.0, _at("2026-11-11T00:10:00+00:00")),
        AppliedMark("2026-11-11", 152_000.0, 2_000.0, _at("2026-11-12T00:10:00+00:00")),
        AppliedMark("2026-11-12", 152_000.0, 2_000.0, _at("2026-11-13T00:10:00+00:00")),
    ]
    out = apply_marks(
        realized, {day: 50_000.0}, marks, day_pnl={},
        flow_instants=[FlowInstant(instant_ms, day, 50_000.0)],
    )
    rows = {
        idx.date().isoformat(): round(float(v), 6)
        for idx, v in out.returns.items()
        if idx.date().isoformat() >= "2026-11-10"
    }
    assert rows == {"2026-11-10": 0.02, "2026-11-11": 0.0, "2026-11-12": 0.0}


def test_mark_placement_fixed_10800_control_reproduces_wr02() -> None:
    """The control: the fixed 10800 files the same deposit on 2026-11-10 (an hour
    early) and publishes the WR-02 +54.98%. This is what proves the scenario tells
    the rule from the fixed offset - it is the defect, kept as a regression anchor."""
    day, _instant_ms, cum = _cum_for_deposit(10800, **_WINTER)  # type: ignore[arg-type]
    assert day == "2026-11-10"
    assert cum == pytest.approx(0.549804, abs=1e-6)
    # The wrapped fixed clock is the same arithmetic as the bare int.
    day2, _i2, cum2 = _cum_for_deposit(fixed_server_clock(10800), **_WINTER)  # type: ignore[arg-type]
    assert (day2, cum2) == (day, cum)


@pytest.mark.parametrize("clock", [server_clock_for_rule("us"), server_clock_for_rule("eu"), 10800])
def test_mark_placement_summer_deposit_agrees_with_the_fixed_10800(clock: object) -> None:
    """Summer mirror: in July the broker is on UTC+3 under both rules, so the rule
    and the fixed 10800 agree and the deposit lands after the read (cum +2%)."""
    day, _instant_ms, cum = _cum_for_deposit(clock, **_SUMMER)  # type: ignore[arg-type]
    assert day == "2026-07-15"
    assert cum == pytest.approx(0.02, abs=1e-9)


# ---------------------------------------------------------------------------
# Task 2 - the rule against an independent oracle, golden vectors, the ambiguous
# hours, and the leaf discipline
# ---------------------------------------------------------------------------


def _oracle_offsets(rule_id: str, naive_wall: datetime) -> tuple[int, int]:
    """The (fold=0, fold=1) UTC offset in seconds the broker clock has at a naive
    wall time, from the tz database. An independent invariant: it shares no formula
    with the module under test.

    ``eu`` is Athens (EET/EEST). ``us`` is the broker's New York close plus seven
    hours: the offset is 7 h plus New York's own offset at the wall time minus 7 h.
    A missing tz database raises here and fails the test; there is no skip."""
    if rule_id == "eu":
        zone = ZoneInfo("Europe/Athens")
        return (
            int(naive_wall.replace(tzinfo=zone, fold=0).utcoffset().total_seconds()),  # type: ignore[union-attr]
            int(naive_wall.replace(tzinfo=zone, fold=1).utcoffset().total_seconds()),  # type: ignore[union-attr]
        )
    zone = ZoneInfo("America/New_York")
    new_york_local = naive_wall - timedelta(hours=7)
    return (
        7 * 3600
        + int(new_york_local.replace(tzinfo=zone, fold=0).utcoffset().total_seconds()),  # type: ignore[union-attr]
        7 * 3600
        + int(new_york_local.replace(tzinfo=zone, fold=1).utcoffset().total_seconds()),  # type: ignore[union-attr]
    )


@pytest.mark.parametrize("rule_id", ["eu", "us"])
def test_rule_matches_zoneinfo_at_every_quarter_hour_2024_to_2029(rule_id: str) -> None:
    """D-01: at every quarter-hour wall time of six years the rule's day offset is
    the oracle's fold=0 offset, and the instant offset is None exactly when the
    oracle's two folds disagree (a repeated or skipped hour), else the same offset."""
    clock = server_clock_for_rule(rule_id)
    naive = datetime(2024, 1, 1)
    end = datetime(2030, 1, 1)
    step = timedelta(minutes=15)
    checked = 0
    none_instants = 0
    while naive < end:
        wall = int(naive.replace(tzinfo=timezone.utc).timestamp())
        fold0, fold1 = _oracle_offsets(rule_id, naive)
        assert clock.day_offset_s(wall) == fold0, (rule_id, naive)
        expected_instant = None if fold0 != fold1 else fold0
        assert clock.instant_offset_s(wall) == expected_instant, (rule_id, naive)
        none_instants += expected_instant is None
        checked += 1
        naive += step
    # Hand-typed floors: 2192 days x 96 quarter-hours = 210,432 per rule. A loop that
    # silently ran short, or an oracle that never saw an ambiguous hour, fails here.
    assert checked >= 210_000
    # 6 years x 2 transitions x 4 quarter-hours in the repeated or skipped hour.
    assert none_instants == 48


@pytest.mark.parametrize(
    ("rule_id", "wall", "expected"),
    [
        # eu autumn 2026: 04:00 -> 03:00, so 03:00-03:59 is repeated.
        ("eu", (2026, 10, 25, 2, 59, 59), (10800,)),
        ("eu", (2026, 10, 25, 3, 0, 0), (10800, 7200)),
        ("eu", (2026, 10, 25, 3, 59, 59), (10800, 7200)),
        ("eu", (2026, 10, 25, 4, 0, 0), (7200,)),
        # eu spring 2027: 03:00 -> 04:00, so 03:00-03:59 is skipped.
        ("eu", (2027, 3, 28, 2, 59, 59), (7200,)),
        ("eu", (2027, 3, 28, 3, 0, 0), ()),
        ("eu", (2027, 3, 28, 3, 59, 59), ()),
        ("eu", (2027, 3, 28, 4, 0, 0), (10800,)),
        # us autumn 2026: 09:00 -> 08:00, so 08:00-08:59 is repeated.
        ("us", (2026, 11, 1, 7, 59, 59), (10800,)),
        ("us", (2026, 11, 1, 8, 0, 0), (10800, 7200)),
        ("us", (2026, 11, 1, 8, 59, 59), (10800, 7200)),
        ("us", (2026, 11, 1, 9, 0, 0), (7200,)),
        # us spring 2027: 09:00 -> 10:00, so 09:00-09:59 is skipped.
        ("us", (2027, 3, 14, 8, 59, 59), (7200,)),
        ("us", (2027, 3, 14, 9, 0, 0), ()),
        ("us", (2027, 3, 14, 9, 59, 59), ()),
        ("us", (2027, 3, 14, 10, 0, 0), (10800,)),
    ],
)
def test_candidates_golden_vectors(
    rule_id: str, wall: tuple[int, int, int, int, int, int], expected: tuple[int, ...]
) -> None:
    """Hand-derived transition table (175-RESEARCH Pattern 1): the 16 rows are the
    two rules x autumn/spring x the second before, the first and last second of the
    odd hour, and the first second after."""
    epoch = int(datetime(*wall, tzinfo=timezone.utc).timestamp())
    assert server_clock_for_rule(rule_id).candidates(epoch) == expected


def _sunday(year: int, month: int, which: int) -> int:
    """Day-of-month of the which-th Sunday (1-based) or the last one (which == -1),
    from ``calendar`` (a different route than the module's date arithmetic)."""
    sundays = [
        week[calendar.SUNDAY]
        for week in calendar.monthcalendar(year, month)
        if week[calendar.SUNDAY] != 0
    ]
    return sundays[which - 1] if which > 0 else sundays[-1]


def test_the_utc_day_cannot_differ_between_the_two_candidates_2007_to_2099() -> None:
    """No transition sits within an hour of a UTC midnight, so the repeated and the
    skipped broker hours date to the same UTC day whichever candidate is taken. This
    is what lets the day use the first occurrence while the instant is None."""
    hours_checked = 0
    for year in range(2007, 2100):
        transitions = (
            ("eu", 3, _sunday(year, 3, -1), 3, 0),  # skipped 03:00-03:59 wall
            ("eu", 10, _sunday(year, 10, -1), 3, 2),  # repeated 03:00-03:59 wall
            ("us", 3, _sunday(year, 3, 2), 9, 0),  # skipped 09:00-09:59 wall
            ("us", 11, _sunday(year, 11, 1), 8, 2),  # repeated 08:00-08:59 wall
        )
        for rule_id, month, day, hour, expected_candidates in transitions:
            clock = server_clock_for_rule(rule_id)
            for second_in_hour in (0, 3599):
                wall = int(
                    datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp()
                ) + second_in_hour
                # The hour really is the odd one (the test can fail on a wrong date).
                assert len(clock.candidates(wall)) == expected_candidates, (rule_id, year)
                day_a = datetime.fromtimestamp(wall - 7200, tz=timezone.utc).date()
                day_b = datetime.fromtimestamp(wall - 10800, tz=timezone.utc).date()
                assert day_a == day_b, (rule_id, year, second_in_hour)
                hours_checked += 1
    # 93 years x 4 transitions x 2 edges.
    assert hours_checked == 744


def test_the_clock_module_is_a_stdlib_leaf() -> None:
    """The module imports only the standard library: no pandas, no network, no other
    ``services`` module (the same discipline as ``mt5_deals``, which imports it).
    Read by path and parsed, never imported and inspected."""
    source = Path(__file__).resolve().parents[1] / "services" / "mt5_server_clock.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, "a relative import would reach another services module"
            assert node.module is not None
            imported.add(node.module)
    allowed = {
        "__future__",
        "calendar",
        "collections.abc",
        "dataclasses",
        "datetime",
        "functools",
        "math",
        "os",
        "typing",
    }
    assert imported <= allowed, sorted(imported - allowed)
    # Anti-vacuity: the scan saw the imports the module is known to make.
    assert {"datetime", "dataclasses", "functools", "calendar"} <= imported


def test_a_fixed_clock_returns_its_offset_at_every_instant_without_a_year() -> None:
    """The no-DST form never computes a year, so it is valid for any epoch."""
    clock = fixed_server_clock(10800)
    for wall in (0, 1_741_615_507, 4_102_444_800 * 2):
        assert clock.candidates(wall) == (10800,)
        assert clock.day_offset_s(wall) == 10800
        assert clock.instant_offset_s(wall) == 10800
    assert clock == Mt5ServerClock(rule="fixed", fixed_offset_s=10800)


# ---------------------------------------------------------------------------
# Task 3 - the one fail-loud resolver
# ---------------------------------------------------------------------------

_RULE = "MT5_SERVER_TIME_RULE"
_OFFSET = "MT5_SERVER_UTC_OFFSET_S"


@pytest.mark.parametrize(
    ("environ", "expected"),
    [
        ({_RULE: "us"}, server_clock_for_rule("us")),
        ({_RULE: " EU "}, server_clock_for_rule("eu")),
        ({_OFFSET: "10800"}, fixed_server_clock(10800)),
        ({_OFFSET: "-18000"}, fixed_server_clock(-18000)),
        ({_OFFSET: " 7200 "}, fixed_server_clock(7200)),
        ({_OFFSET: "46800"}, fixed_server_clock(46800)),
        ({_OFFSET: "+3600"}, fixed_server_clock(3600)),
        # An empty companion variable is unset, not a second answer.
        ({_RULE: "us", _OFFSET: "  "}, server_clock_for_rule("us")),
        ({_RULE: "", _OFFSET: "7200"}, fixed_server_clock(7200)),
    ],
)
def test_the_resolver_turns_a_setting_into_a_clock(
    environ: dict[str, str], expected: Mt5ServerClock
) -> None:
    assert resolve_mt5_server_clock(environ) == expected


# (environment, a value planted in it that no message may echo)
_FAULTS: list[tuple[dict[str, str], str | None]] = [
    ({}, None),
    ({_RULE: "", _OFFSET: "  "}, None),
    ({_RULE: "summer"}, "summer"),
    ({_RULE: "summer", _OFFSET: "10800"}, "summer"),
    ({_RULE: "us", _OFFSET: "10800"}, "10800"),
    ({_RULE: "eu", _OFFSET: "7200"}, "7200"),
    ({_OFFSET: "10800.0"}, "10800.0"),
    ({_OFFSET: "3h"}, "3h"),
    ({_OFFSET: "true"}, "true"),
    ({_OFFSET: "46801"}, "46801"),
    ({_OFFSET: "-46801"}, "46801"),
    ({_OFFSET: "1_000"}, "1_000"),
    ({_OFFSET: "+-5"}, "+-5"),
    ({_OFFSET: "+"}, None),
]


@pytest.mark.parametrize(("environ", "planted"), _FAULTS)
def test_the_resolver_fails_loud_with_a_closed_value_free_message(
    environ: dict[str, str], planted: str | None
) -> None:
    """D-01: no silent default. Each fault raises one text from the closed set that
    names the variables and never the configured value (T-134-01)."""
    with pytest.raises(Mt5ServerClockConfigError) as raised:
        resolve_mt5_server_clock(environ)
    message = str(raised.value)
    assert message in MT5_SERVER_CLOCK_CONFIG_MESSAGES
    assert _RULE in message or _OFFSET in message
    if planted is not None:
        assert planted not in message


def test_each_configuration_fault_has_its_own_message() -> None:
    """Four faults (neither set, unknown rule id, both set, malformed integer), four
    distinct texts, and the table above reaches every one of them."""
    assert len(MT5_SERVER_CLOCK_CONFIG_MESSAGES) == 4
    assert len(set(MT5_SERVER_CLOCK_CONFIG_MESSAGES)) == 4
    seen: set[str] = set()
    for environ, _planted in _FAULTS:
        with pytest.raises(Mt5ServerClockConfigError) as raised:
            resolve_mt5_server_clock(environ)
        seen.add(str(raised.value))
    assert seen == set(MT5_SERVER_CLOCK_CONFIG_MESSAGES)
    for message in MT5_SERVER_CLOCK_CONFIG_MESSAGES:
        assert message.endswith("— fail loud")


def test_the_unknown_rule_id_through_the_clock_builder_uses_the_same_closed_text() -> None:
    with pytest.raises(Mt5ServerClockConfigError) as raised:
        server_clock_for_rule("summer")
    assert str(raised.value) in MT5_SERVER_CLOCK_CONFIG_MESSAGES
    assert "summer" not in str(raised.value)


def test_a_configuration_error_can_never_be_stamped_on_a_users_strategy() -> None:
    """Pitfall 3: ``Mt5DealClassificationError`` is mapped to a user-facing
    "deal ledger could not be classified" stamp, so an operator's mistake must not
    be one."""
    assert not issubclass(Mt5ServerClockConfigError, Mt5DealClassificationError)
    assert issubclass(Mt5ServerClockConfigError, Exception)
    assert Mt5ServerClockConfigError.__bases__ == (Exception,)


def test_the_resolver_reads_the_process_environment_afresh_each_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no mapping the resolver reads ``os.environ`` on every call: two different
    settings in one test give two different clocks (no cache)."""
    monkeypatch.delenv(_RULE, raising=False)
    monkeypatch.setenv(_OFFSET, "10800")
    first = resolve_mt5_server_clock()
    monkeypatch.setenv(_OFFSET, "7200")
    second = resolve_mt5_server_clock()
    monkeypatch.delenv(_OFFSET)
    monkeypatch.setenv(_RULE, "us")
    third = resolve_mt5_server_clock()
    assert (first, second, third) == (
        fixed_server_clock(10800),
        fixed_server_clock(7200),
        server_clock_for_rule("us"),
    )
    monkeypatch.delenv(_RULE)
    with pytest.raises(Mt5ServerClockConfigError):
        resolve_mt5_server_clock()


def test_the_fixed_offset_bound_equals_the_clients_real_broker_bound() -> None:
    """The leaf restates the 13 h bound (it must not import ``mt5_read``, which pulls
    the client stack); this test may, and pins the two together."""
    from services.mt5_read import _MT5_MAX_SERVER_UTC_OFFSET_S

    assert _MT5_MAX_SERVER_UTC_OFFSET_S == 13 * 3600
    at_bound = resolve_mt5_server_clock({_OFFSET: str(_MT5_MAX_SERVER_UTC_OFFSET_S)})
    assert at_bound == fixed_server_clock(_MT5_MAX_SERVER_UTC_OFFSET_S)
    with pytest.raises(Mt5ServerClockConfigError):
        resolve_mt5_server_clock({_OFFSET: str(_MT5_MAX_SERVER_UTC_OFFSET_S + 1)})


# ---------------------------------------------------------------------------
# Plan 05 - D-01 pins: one reader of the settings, one clock per consumer
# ---------------------------------------------------------------------------
#
# The defect these keep out: SEVEN scattered inline reads of the offset variable, each
# with its own silent "0" default, so one site could be corrected and another forgotten
# (D-01), and RESEARCH Pitfall 4: two clocks inside one derive would place a flow against
# one day's mark and its P&L against another's. They read the SOURCE with ``ast`` and not
# with grep because the variable names appear in comments and docstrings (absent from the
# AST) and because a string constant is the only form a read can take. Files are read by
# path and parsed; nothing is imported to be inspected. Every count and floor below is a
# hand-typed literal: a size compared with its own derivation cannot fail.

_ANALYTICS_ROOT = Path(__file__).resolve().parents[1]  # analytics-service/
_CLOCK_RELPATH = "services/mt5_server_clock.py"
# The files the CI mypy line covers: three packages plus four top-level modules.
_SCANNED_PACKAGES = ("services", "routers", "models")
_SCANNED_MODULES = ("main.py", "main_worker.py", "main_worker_healthz.py", "sentry_init.py")
_SETTING_NAMES = frozenset({_OFFSET, _RULE})
# Calls that carry the broker's offset into the deal arithmetic.
_OFFSET_SITE_CALLS = frozenset(
    {
        "combine_mt5_deal_ledger",
        "mt5_day_pnl",
        "reconstruct_mt5_nav_levels",
        "deal_utc_day",
        "deal_utc_instant_ms",
    }
)


def _scanned_sources() -> list[Path]:
    files = [
        path
        for package in _SCANNED_PACKAGES
        for path in sorted((_ANALYTICS_ROOT / package).rglob("*.py"))
    ]
    files += [_ANALYTICS_ROOT / name for name in _SCANNED_MODULES]
    return files


def _setting_constants(tree: ast.AST) -> list[str]:
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value in _SETTING_NAMES
    ]


def _function(tree: ast.AST, name: str) -> ast.AST:
    found = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    ]
    assert len(found) == 1, f"expected exactly one def {name!r}, found {len(found)}"
    return found[0]


def _call_name(call: ast.Call) -> str | None:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _calls_to(scope: ast.AST, names: frozenset[str] | set[str]) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(scope)
        if isinstance(node, ast.Call) and _call_name(node) in names
    ]


def _passes_clock(call: ast.Call, clock_name: str) -> bool:
    """True when the call hands the Name ``clock_name`` as ``server_utc_offset_s=`` or as
    its second positional argument (the form ``deal_utc_day`` / ``deal_utc_instant_ms``
    take)."""
    for keyword in call.keywords:
        if keyword.arg == "server_utc_offset_s":
            return isinstance(keyword.value, ast.Name) and keyword.value.id == clock_name
    return (
        len(call.args) >= 2
        and isinstance(call.args[1], ast.Name)
        and call.args[1].id == clock_name
    )


def _resolve_bound_to(scope: ast.AST, target: str) -> int:
    """How many ``<target> = resolve_mt5_server_clock(...)`` assignments the scope holds."""
    return sum(
        1
        for node in ast.walk(scope)
        if isinstance(node, ast.Assign)
        and isinstance(node.value, ast.Call)
        and _call_name(node.value) == "resolve_mt5_server_clock"
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == target
    )


def test_single_reader() -> None:
    """D-01: the two worker settings are read in ONE place. No string constant equal to
    either variable name appears outside ``services/mt5_server_clock.py`` anywhere the CI
    mypy line looks, so a future inline ``os.getenv("MT5_SERVER_UTC_OFFSET_S", "0")`` (the
    scattered silent default this phase removed) reddens here."""
    files = _scanned_sources()
    # Anti-vacuity: an empty or truncated scan finds nothing and would pass. 124 files at
    # the time of writing; the floor leaves room for a deletion but not for a missed package.
    assert len(files) >= 120, f"only {len(files)} files scanned"
    clock_path = _ANALYTICS_ROOT / _CLOCK_RELPATH
    assert clock_path in files

    offenders: list[str] = []
    clock_constants: list[str] = []
    for path in files:
        constants = _setting_constants(ast.parse(path.read_text(), filename=str(path)))
        if path == clock_path:
            clock_constants = constants
        elif constants:
            offenders.append(f"{path.relative_to(_ANALYTICS_ROOT)}: {sorted(set(constants))}")
    # Positive control: the predicate still matches the one file that is allowed to hold them.
    assert clock_constants.count(_OFFSET) >= 1 and clock_constants.count(_RULE) >= 1, (
        f"the predicate no longer finds the settings in {_CLOCK_RELPATH}: {clock_constants}"
    )
    assert offenders == [], (
        "the MT5 server-clock settings are read outside the resolver: " + "; ".join(offenders)
    )


def test_one_clock_per_derive() -> None:
    """Pitfall 4: ``run_derive_broker_dailies_job`` resolves the broker clock exactly once,
    binds it to ``_mt5_clock``, and every one of the six offset-carrying calls uses that
    name, so no two sites of one derive can see different clocks."""
    path = _ANALYTICS_ROOT / "services/job_worker.py"
    scope = _function(ast.parse(path.read_text(), filename=str(path)), "run_derive_broker_dailies_job")

    assert len(_calls_to(scope, {"resolve_mt5_server_clock"})) == 1
    assert _resolve_bound_to(scope, "_mt5_clock") == 1
    sites = _calls_to(scope, _OFFSET_SITE_CALLS)
    assert len(sites) == 6, f"{len(sites)} offset-carrying calls: {[_call_name(c) for c in sites]}"
    stray = [_call_name(c) for c in sites if not _passes_clock(c, "_mt5_clock")]
    assert stray == [], f"offset sites that do not pass _mt5_clock: {stray}"
