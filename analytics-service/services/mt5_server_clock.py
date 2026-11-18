"""The MT5 broker's server clock: one pure leaf that says which UTC offset was in
force at a broker wall-clock instant (Phase 175 MT5OFFSET, D-01).

Like ``services/mt5_deals.py`` this module imports ONLY the standard library, so
the correctness tests are network-free and revert-proof, and ``mt5_deals`` can
import it without a cycle (it imports nothing from ``services``).

THE INPUT IS THE BROKER WALL CLOCK. A deal's ``time`` is the broker's server clock
encoded as if it were UTC, returned verbatim by the terminal. To reach UTC the
offset in force at that moment must be removed, but the moment is only known in
the broker's own clock, so the rule is applied by trying both offsets and keeping
the ones consistent with the UTC transition window (the "candidate" formulation).
One consistent offset is an ordinary instant, two is an hour the clock repeated
(autumn), none is an hour the clock skipped (spring).

TWO RULES, same offsets: both ``eu`` and ``us`` run the broker on UTC+2 in
standard time and UTC+3 in daylight time (a New York close plus seven hours for
``us``, the EET/EEST pattern for ``eu``). They differ only in WHEN the clock moves:

    eu   01:00 UTC, last Sunday of March  -> 01:00 UTC, last Sunday of October
    us   02:00 New York time (07:00 UTC) second Sunday of March
         -> 02:00 New York time (06:00 UTC) first Sunday of November

The dates for 2026 and 2027 (UTC):

    eu   2026-03-29 01:00, 2026-10-25 01:00    2027-03-28 01:00, 2027-10-31 01:00
    us   2026-03-08 07:00, 2026-11-01 06:00    2027-03-14 07:00, 2027-11-07 06:00

The rule is valid for years 2007 to 2099 only (the US statute took its current
form in 2007); a wall time outside that span raises ``ValueError`` and the seam
turns it into its own out-of-range failure.

WHY A HAND RULE AND NOT A TZ DATABASE. The rule is the BROKER's, not a city's: a
tz-data update must not silently re-bucket history, and a Linux image carries no
pinned tzdata for the worker (``requirements.txt`` pins it for win32 only). The
statute pair is two short formulas, auditable here and checked against
``zoneinfo`` in the tests, which is the only place ``zoneinfo`` appears.

TIE-BREAK (Phase 175, Claude's discretion under D-07). In a REPEATED hour the DAY
uses the first occurrence (daylight offset) and in a MISSING hour the
pre-transition (standard) offset, which is ``zoneinfo`` ``fold=0``. The INSTANT is
``None`` in both: an ambiguous or skipped broker hour has no trustworthy instant,
and none is invented. The day cannot differ between the two candidates because no
transition sits within an hour of a UTC midnight (property test, 2007-2099).
"""
from __future__ import annotations

import calendar
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Final, Literal

MT5_SERVER_TIME_RULE_ENV = "MT5_SERVER_TIME_RULE"
MT5_SERVER_UTC_OFFSET_ENV = "MT5_SERVER_UTC_OFFSET_S"
# Phase 217 SERVERRULE (Q1): the per-server map, `<64-hex server hash>=<eu|us|utc>`
# entries separated by commas. The two variables above stay the DEFAULT, for every
# server the map does not name.
MT5_SERVER_TIME_RULES_ENV: Final = "MT5_SERVER_TIME_RULES"
MT5_DST_RULE_IDS: frozenset[str] = frozenset({"eu", "us"})

_STANDARD_OFFSET_S = 7200
_DAYLIGHT_OFFSET_S = 10800
# The real-broker bound, restated from ``services/mt5_read.py``
# (``_MT5_MAX_SERVER_UTC_OFFSET_S``); a parity test pins the two together. This
# leaf must not import ``mt5_read``, which pulls the client stack.
_MAX_FIXED_OFFSET_S = 13 * 3600

_FIRST_RULE_YEAR = 2007
_LAST_RULE_YEAR = 2099

# The closed set of configuration-fault texts, one per fault. Each names the
# variables and the allowed ids and NEVER the configured value (T-134-01): the
# derive and the backfill put these into job fields that are re-classified and
# shown, and a value could be a secret-grade operator input.
_NEITHER_SET_MESSAGE = (
    "MT5 server clock is not configured: set MT5_SERVER_TIME_RULE to 'eu' or 'us', "
    "or MT5_SERVER_UTC_OFFSET_S to a whole number of seconds — fail loud"
)
_UNKNOWN_RULE_MESSAGE = (
    "MT5_SERVER_TIME_RULE is not a known rule id (allowed: 'eu', 'us') — fail loud"
)
_BOTH_SET_MESSAGE = (
    "MT5_SERVER_TIME_RULE and MT5_SERVER_UTC_OFFSET_S are both set; set exactly "
    "one — fail loud"
)
_MALFORMED_OFFSET_MESSAGE = (
    "MT5_SERVER_UTC_OFFSET_S must be a whole number of seconds within plus or "
    "minus 13 hours — fail loud"
)
_MALFORMED_RULES_MESSAGE = (
    "MT5_SERVER_TIME_RULES must be comma-separated entries of a 64-character "
    "lower-case hex server hash, '=', then 'eu', 'us' or 'utc', with each hash at "
    "most once — fail loud"
)
MT5_SERVER_CLOCK_CONFIG_MESSAGES: tuple[str, ...] = (
    _NEITHER_SET_MESSAGE,
    _UNKNOWN_RULE_MESSAGE,
    _BOTH_SET_MESSAGE,
    _MALFORMED_OFFSET_MESSAGE,
    _MALFORMED_RULES_MESSAGE,
)


class Mt5ServerClockConfigError(Exception):
    """The worker's MT5 server-clock configuration is unusable.

    Deliberately NOT an ``Mt5DealClassificationError``: that class is stamped on a
    user's strategy as a "deal ledger could not be classified" failure, and an
    operator's mistake must not carry that user-attributed sentence. The message is one of a
    closed set (``MT5_SERVER_CLOCK_CONFIG_MESSAGES``) that names variables and
    allowed ids only, never a configured value."""


@dataclass(frozen=True)
class Mt5ServerClock:
    """A broker clock: a DST ``rule`` (``eu`` / ``us``) or the ``fixed`` form that
    removes ``fixed_offset_s`` at every instant.

    All three methods take the deal's wall epoch as whole seconds (the broker wall
    clock encoded as if it were UTC)."""

    rule: Literal["eu", "us", "fixed"]
    fixed_offset_s: int = 0

    def candidates(self, wall_epoch_s: int) -> tuple[int, ...]:
        """Every offset consistent with this wall second, daylight first: one is an
        ordinary instant, two is a repeated hour, none is a skipped hour."""
        if self.rule == "fixed":
            return (self.fixed_offset_s,)
        start, end = _dst_window_utc(self.rule, _wall_year(wall_epoch_s))
        return tuple(
            offset
            for offset in (_DAYLIGHT_OFFSET_S, _STANDARD_OFFSET_S)
            if (offset == _DAYLIGHT_OFFSET_S) == (start <= wall_epoch_s - offset < end)
        )

    def day_offset_s(self, wall_epoch_s: int) -> int:
        """The offset that dates the deal: the first candidate, or the standard
        offset in a skipped hour (``zoneinfo`` ``fold=0``)."""
        if self.rule == "fixed":
            return self.fixed_offset_s
        found = self.candidates(wall_epoch_s)
        return found[0] if found else _STANDARD_OFFSET_S

    def instant_offset_s(self, wall_epoch_s: int) -> int | None:
        """The offset that places the deal in time, or ``None`` in a repeated or
        skipped hour (D-07: an untrustworthy instant is no instant)."""
        if self.rule == "fixed":
            return self.fixed_offset_s
        found = self.candidates(wall_epoch_s)
        return found[0] if len(found) == 1 else None


def fixed_server_clock(offset_s: int) -> Mt5ServerClock:
    """The no-DST clock: ``offset_s`` seconds ahead of UTC at every instant."""
    return Mt5ServerClock(rule="fixed", fixed_offset_s=offset_s)


def server_clock_for_rule(rule_id: str) -> Mt5ServerClock:
    """The DST clock for rule ``eu`` or ``us`` (stripped, lower-cased once)."""
    normalized = str(rule_id).strip().lower()
    if normalized == "eu":
        return Mt5ServerClock(rule="eu")
    if normalized == "us":
        return Mt5ServerClock(rule="us")
    raise Mt5ServerClockConfigError(_UNKNOWN_RULE_MESSAGE)


def _parse_fixed_offset_s(raw: str) -> int:
    """The stripped, non-empty ``MT5_SERVER_UTC_OFFSET_S`` as seconds within the
    13 h real-broker bound, or the malformed fault. ASCII digits with an optional
    sign only: ``int()`` alone would also take ``1_000`` and non-ASCII digits."""
    body = raw[1:] if raw[0] in "+-" else raw
    if not (body.isascii() and body.isdigit()):
        raise Mt5ServerClockConfigError(_MALFORMED_OFFSET_MESSAGE)
    offset_s = int(raw)
    if abs(offset_s) > _MAX_FIXED_OFFSET_S:
        raise Mt5ServerClockConfigError(_MALFORMED_OFFSET_MESSAGE)
    return offset_s


def resolve_mt5_server_clock(environ: Mapping[str, str] | None = None) -> Mt5ServerClock:
    """The ONE place the worker's MT5 server clock is read (D-01).

    ``MT5_SERVER_TIME_RULE`` names a DST rule (``eu`` or ``us``);
    ``MT5_SERVER_UTC_OFFSET_S`` alone is the fixed form for a no-DST broker. The
    fixed integer IS a configured clock, so it resolves on its own (production
    carries only the integer until the rule is set). It FAILS LOUD when neither
    variable is set (the silent ``"0"`` default is gone), when the rule id is
    unknown, when both are set (two answers, so neither wins) and when the
    integer is malformed or beyond 13 h. Each variable is stripped once and the
    rule lower-cased once; empty after stripping means unset.

    Read per call, never cached: a test sets the environment per case, and a
    Railway variable change restarts the process anyway. ``environ`` defaults to
    ``os.environ``."""
    source = os.environ if environ is None else environ
    rule = (source.get(MT5_SERVER_TIME_RULE_ENV) or "").strip().lower()
    offset = (source.get(MT5_SERVER_UTC_OFFSET_ENV) or "").strip()
    if rule:
        if rule not in MT5_DST_RULE_IDS:
            raise Mt5ServerClockConfigError(_UNKNOWN_RULE_MESSAGE)
        if offset:
            raise Mt5ServerClockConfigError(_BOTH_SET_MESSAGE)
        return server_clock_for_rule(rule)
    if not offset:
        raise Mt5ServerClockConfigError(_NEITHER_SET_MESSAGE)
    return fixed_server_clock(_parse_fixed_offset_s(offset))


_HEX_DIGITS: Final = frozenset("0123456789abcdef")
_SERVER_HASH_LEN: Final = 64
_RULES_MAP_VALUES: Final = frozenset({"eu", "us", "utc"})


@dataclass(frozen=True)
class Mt5ServerClockSelection:
    """The clock chosen for one account server and whether the map named it.

    ``mapped`` is the RETURNED flag, never derived by comparing ``clock`` with the
    default: a server mapped to the same rule as the default is still mapped, and
    that is what keeps its mismatch a refusal (Phase 217 Q2)."""

    clock: Mt5ServerClock
    mapped: bool


def parse_mt5_server_time_rules(
    environ: Mapping[str, str] | None = None,
) -> dict[str, Mt5ServerClock]:
    """The per-server clock map from ``MT5_SERVER_TIME_RULES`` (Phase 217, Q1).

    Grammar: comma-separated ``<hash>=<rule>`` entries. Each entry and each side of
    the ``=`` is stripped, empty entries are skipped, the rule is lower-cased and
    the hash is NOT (a hash is exactly 64 lower-case hex digits, checked by
    character set so upper case and non-ASCII are faults). ``rule`` is ``eu``,
    ``us`` or ``utc``; ``utc`` is the fixed offset 0 and exists only as a map value
    (it is not a valid ``MT5_SERVER_TIME_RULE``). A hash named twice is a fault
    whatever its values. Unset, empty and all-blank give an empty map.

    Any fault raises ``Mt5ServerClockConfigError`` with the one closed text, which
    never carries any part of the value (T-134-01). A bad map must never degrade
    to an empty one: that would date a mapped server under the wrong rule."""
    source = os.environ if environ is None else environ
    raw = source.get(MT5_SERVER_TIME_RULES_ENV) or ""
    rules: dict[str, Mt5ServerClock] = {}
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        key, separator, value = entry.partition("=")
        key = key.strip()
        value = value.strip().lower()
        if (
            not separator
            or len(key) != _SERVER_HASH_LEN
            or not set(key) <= _HEX_DIGITS
            or key in rules
            or value not in _RULES_MAP_VALUES
        ):
            raise Mt5ServerClockConfigError(_MALFORMED_RULES_MESSAGE)
        rules[key] = (
            fixed_server_clock(0) if value == "utc" else server_clock_for_rule(value)
        )
    return rules


def select_mt5_server_clock(
    default: Mt5ServerClock,
    rules: Mapping[str, Mt5ServerClock],
    server_hash: str | None,
) -> Mt5ServerClockSelection:
    """The clock for one account server: its map entry, else ``default``. The hash is
    the caller's (``server_label_hash``); ``None`` (a blank or missing server) is
    never looked up and takes the default, unmapped."""
    if server_hash is not None and server_hash in rules:
        return Mt5ServerClockSelection(clock=rules[server_hash], mapped=True)
    return Mt5ServerClockSelection(clock=default, mapped=False)


def _wall_year(wall_epoch_s: int) -> int:
    """The calendar year of the wall epoch; ValueError outside the rule's span.
    An undatable epoch raises OverflowError / OSError / ValueError from the
    conversion, which the seam maps to its own out-of-range failure."""
    year = datetime.fromtimestamp(wall_epoch_s, tz=timezone.utc).year
    if not _FIRST_RULE_YEAR <= year <= _LAST_RULE_YEAR:
        raise ValueError("MT5 server-clock rule covers years 2007-2099 only")
    return year


def _nth_sunday(year: int, month: int, n: int) -> date:
    """The n-th Sunday of the month (n > 0), or the last one (n == -1)."""
    if n > 0:
        first = date(year, month, 1)
        first += timedelta(days=(6 - first.weekday()) % 7)
        return first + timedelta(weeks=n - 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - 6) % 7)


def _utc_epoch(day: date, hour: int) -> int:
    midnight = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    return int(midnight.timestamp()) + hour * 3600


@lru_cache(maxsize=None)
def _dst_window_utc(rule: str, year: int) -> tuple[int, int]:
    """The UTC daylight window ``[start, end)`` of ``rule`` in ``year``."""
    if rule == "eu":
        return (
            _utc_epoch(_nth_sunday(year, 3, -1), 1),
            _utc_epoch(_nth_sunday(year, 10, -1), 1),
        )
    if rule == "us":
        return (
            _utc_epoch(_nth_sunday(year, 3, 2), 7),
            _utc_epoch(_nth_sunday(year, 11, 1), 6),
        )
    raise ValueError("unknown MT5 server-clock rule")


# ---------------------------------------------------------------------------
# Phase 155.1 SERVERCLOCK (MT5-06) — the live reading, assessed against the
# configured clock. Pure and network-free like the rest of this leaf: it takes
# the ALREADY-resolved ``Mt5ServerClock`` and never resolves a second one
# (``test_one_clock_per_derive``).
# ---------------------------------------------------------------------------

# D-08: the measured offset is the newest tick's wall time minus the worker's UTC
# now, rounded to this many seconds (a broker offset is a whole quarter hour).
MT5_SERVER_CLOCK_ROUND_S: Final[int] = 900

# D-19 (founder, 2026-11-16): a reading whose rounding residual exceeds this many
# seconds is ``unmeasured``, never asserted. It is a margin over the 0.292 s
# maximum residual in ``155.1-SPIKE-READINGS.md`` run 3 (the daily session break,
# the worst of the three live runs). It is the ONLY bound: no plausibility class
# and no freshness constant exist, because a tick's age cannot be observed apart
# from the rule, so an off-rule offset is a ``mismatch`` (D-19).
MT5_SERVER_CLOCK_RESIDUAL_BOUND_S: Final[float] = 5.0

# The verdict and reason sets are CLOSED: the migration's named CHECKs mirror them
# and ``tests/test_mt5_server_clock_readings_parity.py`` pins that they agree.
MT5_SERVER_CLOCK_VERDICTS: Final = ("match", "mismatch", "unmeasured")
MT5_SERVER_CLOCK_UNMEASURED_REASONS: Final = (
    "no_tick",
    "tick_read_failed",
    "residual_over_bound",
    "tick_time_out_of_range",
    "expected_unassertable",
)


@dataclass(frozen=True)
class Mt5ServerClockAssessment:
    """One reading's verdict. ``raw_offset_s`` is the unrounded newest-tick minus
    UTC-now, ``measured_offset_s`` its 900 s rounding, ``residual_s`` the rounding
    residual (``measured - raw``), ``expected_offset_s`` the configured clock's
    offset at the tick's wall instant, ``newest_tick_age_s`` is ``expected - raw``
    (the tick's age PLUS any offset error: in a mismatch row the two cannot be
    told apart). Each is ``None`` where the branch never got that far."""

    verdict: str
    reason: str | None
    raw_offset_s: float | None
    measured_offset_s: int | None
    expected_offset_s: int | None
    residual_s: float | None
    newest_tick_age_s: float | None


def assess_server_clock_reading(
    clock: Mt5ServerClock,
    *,
    newest_tick_ms: int | None,
    utc_now_ms: int,
    tick_read_failed: bool = False,
) -> Mt5ServerClockAssessment:
    """Compare the live reading with the configured clock. NEVER raises.

    Order (D-08, D-09, D-10, D-19): a failed tick read, no tick, an undatable tick
    and a residual over the bound are ``unmeasured`` with their reason; an
    ``expected`` of ``None`` (a repeated or skipped broker hour, D-09) is
    ``unmeasured`` too; otherwise ``match`` when the rounded measured offset equals
    the expected one, else ``mismatch``."""
    if tick_read_failed:
        return Mt5ServerClockAssessment(
            "unmeasured", "tick_read_failed", None, None, None, None, None
        )
    if newest_tick_ms is None:
        return Mt5ServerClockAssessment(
            "unmeasured", "no_tick", None, None, None, None, None
        )
    raw = (newest_tick_ms - utc_now_ms) / 1000.0
    measured = int(
        round(raw / MT5_SERVER_CLOCK_ROUND_S) * MT5_SERVER_CLOCK_ROUND_S
    )
    residual = measured - raw
    try:
        expected = clock.instant_offset_s(newest_tick_ms // 1000)
    except (ValueError, OverflowError, OSError):
        # An undatable tick carries NO offsets: the reading's offsets are INTEGER
        # columns and a tick this far out would not fit one, which would fail the
        # insert (the first write of every derive) on every retry.
        return Mt5ServerClockAssessment(
            "unmeasured", "tick_time_out_of_range", None, None, None, None, None
        )
    age = None if expected is None else expected - raw
    if abs(residual) > MT5_SERVER_CLOCK_RESIDUAL_BOUND_S:
        return Mt5ServerClockAssessment(
            "unmeasured", "residual_over_bound", raw, measured, expected, residual, age
        )
    if expected is None:
        return Mt5ServerClockAssessment(
            "unmeasured", "expected_unassertable", raw, measured, None, residual, None
        )
    return Mt5ServerClockAssessment(
        "match" if measured == expected else "mismatch",
        None,
        raw,
        measured,
        expected,
        residual,
        age,
    )


def format_offset_hours(offset_s: int) -> str:
    """An offset as signed hours and minutes: ``+2h``, ``+3h``, ``+5h30m``,
    ``-1h45m``. HOURS, never seconds, because ``scrub_alert_detail`` replaces any
    run of five or more digits and ``10800`` would read ``<digits>``."""
    sign = "-" if offset_s < 0 else "+"
    total = abs(offset_s)
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    text = f"{sign}{hours}h"
    if minutes or seconds:
        text += f"{minutes}m"
    if seconds:
        text += f"{seconds}s"
    return text


class Mt5ServerClockMismatchError(Exception):
    """The live server clock disagrees with the configured rule (D-01, D-11).

    The text carries the rule id and the two offsets in HOURS only: no server
    name, no hash, no login, no environment-variable name. It is the single source
    of the message the derive stores in ``compute_jobs.error_message``."""

    def __init__(
        self, *, rule: str, expected_offset_s: int, measured_offset_s: int
    ) -> None:
        self.rule = rule
        self.expected_offset_s = expected_offset_s
        self.measured_offset_s = measured_offset_s
        super().__init__(
            "MT5 server clock does not match the configured rule "
            f"(rule={rule} expected={format_offset_hours(expected_offset_s)} "
            f"measured={format_offset_hours(measured_offset_s)})"
        )
