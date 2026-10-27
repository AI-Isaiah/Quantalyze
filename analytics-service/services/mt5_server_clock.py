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
from typing import Literal

MT5_SERVER_TIME_RULE_ENV = "MT5_SERVER_TIME_RULE"
MT5_SERVER_UTC_OFFSET_ENV = "MT5_SERVER_UTC_OFFSET_S"
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
MT5_SERVER_CLOCK_CONFIG_MESSAGES: tuple[str, ...] = (
    _NEITHER_SET_MESSAGE,
    _UNKNOWN_RULE_MESSAGE,
    _BOTH_SET_MESSAGE,
    _MALFORMED_OFFSET_MESSAGE,
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
