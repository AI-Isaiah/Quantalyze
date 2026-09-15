"""Phase 164.6.4 (MT5KEEPALIVE) — the SESSION MONITOR: the thing that NOTICES
the MT5 terminal's broker session has lapsed, without a human and without waiting
on an unrelated restart (criterion 2).

WHAT THIS IS FOR. Phase 164.6.2's boot heal is deployed, armed and IDLE: it fires
once at analytics startup, and analytics startup is not correlated with the
terminal losing its session — wave 5 measured NO analytics deployment at all on
the day the session lapsed. The exposure is therefore the DARK WINDOW (``≥2h34m``
confirmed, inside a ``≈8h05m`` bracket) and not the recovery (``00:03:43`` at
worst). This module supplies the trigger the system did not have.

⛔ **THIS IS THE DETECTION POLL CADENCE. IT IS NOT THE KEEPALIVE INTERVAL, AND
THIS PHASE DOES NOT CHOOSE THAT NUMBER** (criterion 1, D-3, and D-06 of Phase
164.6.2). Wave 5 produced exactly ONE observation of each quantity and an interval
set from ``n=1`` is the guess D-06 exists to prevent. The cadence below is derived
from INSTRUMENT BOUNDS and ZERO session-lifetime observations, which is precisely
why choosing it does not violate criterion 1. The keepalive interval is a
DIFFERENT number, chosen in a follow-up against ``n>1`` — and no symbol, env var,
constant or default for it may exist anywhere in ``analytics-service/services/``.
⛔ The module is named for the SESSION MONITOR so a later reader cannot conflate
the two; the first reader to find a knob for the other number will set it.

⚠️ **NAMING, AND IT IS A DELIBERATE CORRECTION TO CONTEXT D-2.** D-2 suggested
``probe_mt5_session_once``. That name claims a READ-ONLY probe, and this function
may send a credential after a ``-6``. A symbol that names the wrong thing is
precisely this repo's recorded defect class, and criterion 3 is about exactly that
distinction. The SHAPE D-2 locks — two symbols, and the loop's ``while`` inside
its own single guard — is honoured exactly; only the name is corrected.

⛔ **TWO SYMBOLS, AND THE REASON IS STRUCTURAL RATHER THAN STYLISTIC.** The
never-raises AST predicate's rule is "EXACTLY ONE top-level statement and it must
be the ``try``". Inlining the tick into the loop would make the loop's guard body
carry both the tick and the ``while``, and the per-tick SURVIVAL property would
stop being separately statable — leaving only the containment half, which on a
loop is the half that ENDS IT. A keepalive that dies silently on tick 3 behind a
green worker is this phase's own defect class arriving inside the fix.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Final

from services.closed_sets import mt5_enabled_is_deliberate, mt5_enabled_server
from services.redact import scrub_freeform_string

# ⛔ IMPORTED UNDER THEIR LEADING UNDERSCORES, DELIBERATELY, and for the reason
# `mt5_relogin` itself gives when it imports `_redact_credential_values` from
# `mt5_client`: these are the SHIPPED controls, and a second copy here would be
# exactly the drift their own gates exist to prevent.
#
#   * `_env_float` is the SHIPPED knob reader. Its properties come with it
#     unchanged — absent/blank/non-numeric/zero/negative/nan/inf all fall back to
#     the default, `math.isfinite` is tested FIRST so a `nan` cannot slip through
#     a naive range check, the effective window can never be empty from either
#     end, and the VALUE is never logged, only the NAME and the fault class.
#   * `_MT5_RELOGIN_BUDGET_CEILING_S` is the heal's DECLARED budget ceiling and is
#     this module's cadence FLOOR — a derivation, not a coincidence (see below).
#   * `_log_configuration_fault_once` is the once-per-process throttle, so a
#     disabled kill switch says so ONCE rather than on every tick forever.
#   * `_MT5_ENABLED_ENV_NAME` is the kill switch's NAME, so the skip line can name
#     the variable without re-spelling the string `closed_sets` owns.
from services.mt5_relogin import (
    _MT5_ENABLED_ENV_NAME,
    _MT5_RELOGIN_BUDGET_CEILING_S,
    _MT5_RELOGIN_LEASE_WAIT_CEILING_S,
    _env_float,
    _log_configuration_fault_once,
    HEAL_SOURCE_SESSION_MONITOR,
    heal_mt5_terminal_session,
)

# ⛔ WR-03 — the disabled-switch reading, COUNTED rather than merely
# logged-once. `_log_configuration_fault_once` throttles to ONE line per
# process, which is invisible after the first tick; recording the refusal as a
# `not_measured` reading puts it on the SAME blind-run counter — ⛔ WR-14
# (round 3) — but only `KIND_DISABLED` (a genuine operator decision) is
# exempted from the blind-run ESCALATION; `KIND_KILL_SWITCH_UNPARSEABLE` (a
# value `mt5_enabled_server()` could not recognise as a decision) is a
# MISCONFIGURATION and stays on the same escalation as
# `busy_skip`/`budget_abandoned`/the `code=0` sentinel.
from services.mt5_session_episodes import (
    KIND_DISABLED,
    KIND_KILL_SWITCH_UNPARSEABLE,
    KIND_TICK_DEADLINE,
    record_mt5_session_reading,
)

logger = logging.getLogger("quantalyze.analytics.mt5_session_monitor")

#: The ONE new knob this phase adds. ⛔ It is the DETECTION POLL INTERVAL.
MT5_SESSION_POLL_INTERVAL_ENV: Final[str] = "MT5_SESSION_POLL_INTERVAL_S"

# --------------------------------------------------------------------------- #
# THE CADENCE, DERIVED SO A READER CAN CHECK IT RATHER THAN TRUST IT. ⛔ NO
# SESSION-LIFETIME OBSERVATION ENTERS ANY OF THESE THREE NUMBERS.
#
#   FLOOR = the heal's DECLARED BUDGET CEILING **plus its bounded lease-acquire
#     CEILING** (WR-08, round 2). A tick must never still be running when the
#     next one starts, or the loop would overlap itself against a shared
#     terminal — but a tick's wall-clock cost is not the budget alone: it is
#     `_relogin_lease_wait_s()` (bounded acquire) PLUS `_relogin_budget_s()`
#     (bounded operation). ⛔ The budget bounds only the `to_thread` body; the
#     acquire happens BEFORE it. A floor equal to the budget ceiling alone let
#     this tick's own `wait_for` (WR-06) pre-empt the heal's own
#     `except asyncio.TimeoutError` arm and its `budget_abandoned` reading —
#     the ONE outcome the heal's own docstring calls "the outcome that leaves
#     the SYSTEM in a state nobody measured" — turning a COUNTED exit into
#     this tick's uncounted-until-WR-07 one. Summing both ceilings makes the
#     bound structural: the slowest tick the heal permits itself (acquire AND
#     operate) still finishes inside one interval, and a retune of either
#     ceiling carries through here rather than silently invalidating this
#     bound. It is also what makes WR-02's "the boot heal owns the boot
#     window uncontested" true BY CONSTRUCTION rather than only for some
#     configurations: `interval >= floor >= actual_lease_wait +
#     actual_budget` holds for every value each knob's own window admits.
#
#   CEILING = 3600 s, the cadence of the independent hourly prod-prober. At or
#     above it this loop measures nothing that instrument does not already
#     measure, so it would add contention for the ONE shared terminal without
#     adding information.
#
#   DEFAULT = 600 s, inside that window. Against the MEASURED exposure (≥2h34m
#     confirmed dark) any cadence in the ten-to-fifteen-minute band collapses the
#     exposure by about one and a half orders of magnitude, and the difference
#     between 600 and 900 is immaterial to that — which is the point: the number
#     is not load-bearing, so it is not a guess dressed as a measurement. Worst
#     case duty cycle is the tick BUDGET over the cadence, about 27% in the
#     pathological case where every tick both times out AND heals, and roughly one
#     round-trip in the overwhelmingly common already-authorized case.
# --------------------------------------------------------------------------- #
_MT5_SESSION_POLL_INTERVAL_FLOOR_S: Final[float] = (
    _MT5_RELOGIN_BUDGET_CEILING_S + _MT5_RELOGIN_LEASE_WAIT_CEILING_S
)
_MT5_SESSION_POLL_INTERVAL_CEILING_S: Final[float] = 3600.0
_MT5_SESSION_POLL_INTERVAL_DEFAULT_S: Final[float] = 600.0


def session_poll_interval_s() -> float:
    """The DETECTION POLL INTERVAL, read PER CALL through the shipped reader.

    ⛔ Per call and never at import — 164.6.2's CR-02, whose own record is that a
    module-scope ``float(os.getenv(...))`` let an operator typo in a Railway
    variable abort uvicorn startup and take the WHOLE analytics service down
    under ``restartPolicyType ON_FAILURE x3``. Reading per call also means a
    retune takes effect on the next tick without a redeploy.
    """
    return _env_float(
        MT5_SESSION_POLL_INTERVAL_ENV,
        _MT5_SESSION_POLL_INTERVAL_DEFAULT_S,
        floor=_MT5_SESSION_POLL_INTERVAL_FLOOR_S,
        ceiling=_MT5_SESSION_POLL_INTERVAL_CEILING_S,
    )


async def run_mt5_session_monitor_tick() -> None:
    """ONE detection tick. Returns ``None`` on every path and NEVER raises.

    ⭐ **IT DELEGATES; IT DOES NOT RE-IMPLEMENT.** ``heal_mt5_terminal_session``
    already does, in order: kill switch -> credentials -> gateway endpoint ->
    BOUNDED lease by ``mt5_terminal_key`` -> ``to_thread`` under a budget ->
    CREDENTIAL-FREE probe -> branch on the code -> heal ONLY ``-6`` -> RE-PROBE ->
    classified verdict; and its five-round-trip budget is already gated by
    ``test_the_budget_covers_every_round_trip_the_worst_case_path_makes``.

    ⛔ NO second detector, NO second lease acquisition, NO second budget and NO
    second verdict vocabulary. ⭐ Delegating adds ZERO entries to
    ``_PRODUCTION_LEASE_SITES`` and zero new ``Mt5Client`` lifetimes to reason
    about — write that as the argument, because it is the reason the roster stays
    at SIX and the reason criterion 4's "it must not steal the terminal from live
    job processing" is inherited rather than re-argued: the heal's acquire is
    BOUNDED, so a busy terminal means SKIP and never QUEUE.

    ⛔ THE MONITOR NEVER LOGS IN TO MEASURE (criterion 3, D-1). The only reading
    it takes is the credential-free detector; the credentialed verb runs only
    after a ``-6``, inside the heal, exactly as it already did at boot.

    ⛔ THE KILL SWITCH IS READ FIRST, BEFORE ANYTHING IS CONSTRUCTED, and a
    disabled switch SKIPS THE TICK rather than ending the loop — so flipping it
    on takes effect without a redeploy. ⛔ Never ``return`` from the LOOP on a
    disabled switch; that would end it for the life of the process.
    """
    try:
        if not mt5_enabled_server():
            # Throttled to once per process: the loop ticks forever, and a
            # disabled switch is an operator DECISION rather than a
            # misconfiguration. ⚠️ It NAMES the variable, because
            # `mt5_enabled_server` is `.strip().lower() == "true"` — `1`, `on` and
            # `yes` all read OFF, so an edit to any of them would otherwise
            # disable the monitor with an EMPTY log.
            _log_configuration_fault_once(
                "mt5_session_monitor_disabled",
                "mt5 session monitor: skipping every tick — %s is not set to "
                "true, so detection is disabled. The terminal keeps whatever "
                "session it already has and NOTHING will notice if it lapses. "
                "The loop keeps running, so flipping the variable takes effect "
                "on the next tick without a redeploy.",
                _MT5_ENABLED_ENV_NAME,
            )
            # ⛔ WR-03 — COUNTED, not merely logged-once. The throttled line
            # above is invisible after the FIRST tick, so a kill switch that
            # was flipped and forgotten would otherwise be indistinguishable
            # in the logs from a monitor that has found the session healthy
            # every tick. This reading is honestly `not_measured` and is
            # ALWAYS counted. ⛔ WR-14 (round 3) — whether it also ESCALATES
            # depends on WHICH kind it records: `KIND_DISABLED` (an
            # `""`/`false` — a genuine operator DECISION) is exempted from
            # raising the log level by `_DECIDED_BLIND_KINDS`, while
            # `KIND_KILL_SWITCH_UNPARSEABLE` (`1`/`on`/`yes`/anything else
            # `mt5_enabled_server()` also reads as OFF) is a
            # MISCONFIGURATION and stays on the same blind-run escalation as
            # `busy_skip`/`budget_abandoned`/the `code=0` sentinel.
            await record_mt5_session_reading(
                (
                    KIND_DISABLED
                    if mt5_enabled_is_deliberate()
                    else KIND_KILL_SWITCH_UNPARSEABLE
                ),
                None,
                source=HEAL_SOURCE_SESSION_MONITOR,
                poll_interval_s=session_poll_interval_s(),
            )
            return
        # ⛔ WR-06 — READ ONCE, and used for BOTH the heal's `poll_interval_s`
        # AND this tick's own outer deadline. The heal's `to_thread` budget
        # bounds only its OWN blocking body — the bounded lease acquire and
        # the recorder's Supabase round trips (up to six, each carrying
        # postgrest-py's 120 s default) are UNBOUNDED at the tick level, so a
        # degraded Supabase could otherwise stretch a single tick past its own
        # configured cadence with nothing logging it. The loop is sequential
        # (tick THEN wait), so this bound adds no overlap risk of its own.
        interval = session_poll_interval_s()
        try:
            await asyncio.wait_for(
                heal_mt5_terminal_session(
                    source=HEAL_SOURCE_SESSION_MONITOR,
                    poll_interval_s=interval,
                ),
                timeout=interval,
            )
        except asyncio.TimeoutError:
            # ⛔ Distinguished from a fault, not folded into the generic "did
            # not complete" wording below: this is a BUDGET BITE, and an
            # operator who cannot tell it from a broken gateway cannot tell a
            # slow sink from a wedged terminal. ⛔ Do NOT widen this to
            # `except OSError`: `asyncio.TimeoutError is TimeoutError` and its
            # MRO runs through `OSError`, which would silently eat this same
            # budget expiry — and `heal_mt5_terminal_session`'s OWN internal
            # `wait_for` too, if this arm were ever copied there.
            logger.error(
                "mt5 session monitor: the tick did not complete inside its "
                "own %.1fs cadence — the terminal keeps whatever session it "
                "already has and the next tick will try again.",
                interval,
            )
            # ⛔ WR-07 (round 2) — COUNTED, exactly as `busy_skip`,
            # `budget_abandoned` and the configuration refusals are. Without
            # this, a degraded Supabase that cuts off every tick at this
            # deadline freezes `_CONSECUTIVE_NOT_MEASURED_READINGS` at
            # whatever it was, and `blind_run_escalation_threshold` can never
            # fire, on the exact fault class the escalation exists to
            # surface.
            #
            # ⚠️ B1 (round 3) — CORRECTED: this was NOT "the ONE
            # non-measuring exit WR-03 did not cover" — measured at HEAD
            # there are THREE more, and each is excluded for a DIFFERENT,
            # stated reason rather than by oversight:
            #   1. `heal_mt5_terminal_session`'s kill-switch arm (the BOOT
            #      heal's, not this tick's) does not record at all — but it
            #      is the single boot-only caller, so
            #      `blind_run_escalation_threshold(None)` is always `None`
            #      and a recording there could never escalate regardless.
            #   2. the outer `except Exception` in `heal_mt5_terminal_session`
            #      and 3. the outer `except Exception` in this module's own
            #      `run_mt5_session_monitor_tick` are both STRUCTURALLY
            #      BARRED from recording: the never-raises AST gate requires
            #      each handler body to be EXACTLY one nested `try`, and a
            #      `record_mt5_session_reading` call there is a second
            #      top-level statement — the same reason
            #      `_stamp_reading_and_measure_gap` and `_count_blind_reading`
            #      are separate functions in `mt5_session_episodes.py`. ⛔ Do
            #      NOT restructure either handler to count them; that fights
            #      the gate this module depends on for its OWN never-raises
            #      guarantee.
            await record_mt5_session_reading(
                KIND_TICK_DEADLINE,
                None,
                source=HEAL_SOURCE_SESSION_MONITOR,
                poll_interval_s=interval,
            )
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        # ⛔ IN-06 — the handler body is itself guarded, because `logger`'s
        # ARGUMENTS are evaluated before logging is entered and stdlib `logging`
        # does not swallow that evaluation. ⛔ `BaseException` on the FALLBACK
        # only, and it wraps NO `await`: `asyncio.CancelledError` is not an
        # `Exception` subclass on this venv (measured, Python 3.12.13), so
        # `except Exception` lets shutdown cancellation through while
        # `except BaseException` around an `await` would swallow it and hang
        # `lifespan`'s 10-second gather.
        try:
            logger.warning(
                "mt5 session monitor: the tick did not complete — continuing; "
                "the terminal keeps whatever session it already has and the "
                "next tick will try again (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 — see the comment; this is the control
            logger.warning(
                "mt5 session monitor: the tick did not complete, and the failure "
                "could not be described — continuing"
            )


async def mt5_session_monitor_loop() -> None:
    """The thin scheduler. Its ``while`` lives INSIDE its own single guard (D-2).

    ⛔ **THIS LOOP IS DELIBERATELY STRICTER THAN ITS THREE NEIGHBOURS.**
    ``dispatch_loop``, ``watchdog_loop`` and ``daily_enqueue_loop`` guard only
    their tick; their ``while`` header, their sleep block and their exit log all
    sit OUTSIDE any handler. For a dispatch loop that is arguably right — one that
    cannot sleep SHOULD take the worker down. For a best-effort MT5 instrument it
    is not: ``main.lifespan``'s ``_crash_handler`` calls ``SHUTDOWN.set()`` on ANY
    background-task exception, which stops dispatch, watchdog and enqueue behind a
    green ``/health``. An MT5 gateway nobody needed would take the analytics
    service down. The asymmetry is written here rather than left to be discovered.

    ⛔ **AND NO HANDLER IN THE ``while`` BODY MAY ``break`` OR ``raise``.** A
    handler that ends the loop is a keepalive that dies silently on tick 3 behind
    a green worker — this phase's own defect class arriving inside the fix. The
    ONLY ``break`` is the one ``SHUTDOWN`` earns.
    """
    try:
        # ⛔ IMPORTED HERE, INSIDE THE GUARD, not at module scope. `main.py`
        # imports `main_worker` lazily for the same reason ("unit tests that
        # import main.py without env vars don't pay the import cost"), and
        # `mt5_relogin`'s own record is that an UNGUARDED module-scope read
        # aborted uvicorn startup and took the whole service down under
        # `restartPolicyType ON_FAILURE x3`. An import fault here is contained by
        # the guard instead of reaching `_crash_handler`.
        from main_worker import SHUTDOWN

        # ⛔ WR-09 (round 2) — SAY THAT WE ARE WAITING. Before this line the
        # loop emitted NOTHING before its first tick, and `main.lifespan`
        # names no task either — so for one full poll interval after every
        # deploy, a healthy monitor and a monitor that does not exist were
        # BYTE-IDENTICAL in the logs. That is precisely the ambiguity this
        # module's own HIGH-1 fix removed for the boot heal ("zero log lines
        # was simultaneously consistent with FIVE hypotheses"): before that
        # fix the monitor could not be in that state, because it ticked at
        # once and a tick always logs; WR-02's reorder re-opened it. A
        # process that does not outlive one interval — two deploys inside
        # ten minutes, a crash loop, any other background task raising and
        # `_crash_handler` calling `SHUTDOWN.set()` — now leaves at least
        # this ONE line saying the monitor was scheduled at all.
        logger.info(
            "mt5 session monitor: started — the boot heal owns the boot "
            "window; the first detection tick runs in %.0fs.",
            session_poll_interval_s(),
        )
        while not SHUTDOWN.is_set():
            # ⛔ WR-02 — WAIT FIRST, TICK SECOND. `main.lifespan` starts
            # `mt5_boot_heal` and `mt5_session_monitor` back to back in the same
            # gather, so ticking immediately here would drive TWO tasks against
            # the ONE shared terminal at the same instant on every deploy — the
            # loser's `busy_skip` is a blind reading, and if the winner finishes
            # inside the lease-acquire window the loser probes the terminal a
            # SECOND time for no information. Waiting first lets the boot heal
            # own the boot window uncontested; the monitor owns everything after
            # it. ⚠️ WR-08 (round 2) — "UNCONTESTED" HOLDS BY CONSTRUCTION,
            # NOT ONLY FOR SOME CONFIGURATIONS: it depends on
            # `interval >= _relogin_lease_wait_s() + _relogin_budget_s()`, and
            # `_MT5_SESSION_POLL_INTERVAL_FLOOR_S`'s own derivation (see above)
            # is exactly that sum's CEILING, so every value the cadence window
            # admits satisfies it. Before that fix the floor was the budget
            # ceiling alone, and at the floor with the budget at ITS ceiling the
            # claim was false. ⚠️ THE HOUSE SLEEP IDIOM, never a bare `asyncio.sleep`:
            # `lifespan`'s shutdown gather waits 10 s and then CANCELS, so a bare
            # sleep on a ten-minute cadence would be force-cancelled on every
            # deploy and the cancellation logged as a failure to exit cleanly.
            #
            # ⚠️ HANDLER ORDER IS LOAD-BEARING. `asyncio.TimeoutError is
            # TimeoutError`, whose MRO runs through `OSError` and `Exception`, so
            # a timeout arriving from anywhere else and landing in a sleep-shaped
            # handler would be read as "the interval elapsed" and produce a HOT
            # loop with no delay at all. The narrow arm is first and means exactly
            # one thing; the broad arm below it logs and does NOT break, because a
            # sleep that failed must not end the loop either.
            try:
                await asyncio.wait_for(
                    SHUTDOWN.wait(), timeout=session_poll_interval_s()
                )
                break
            except asyncio.TimeoutError:
                pass
            except Exception as exc:  # noqa: BLE001 — the control; it CONTINUES
                try:
                    logger.error(
                        "mt5 session monitor: the interval wait failed — the LOOP "
                        "CONTINUES rather than ending (exc_class=%s)",
                        type(exc).__name__,
                    )
                except BaseException:  # noqa: BLE001 — the control
                    logger.error(
                        "mt5 session monitor: the interval wait failed and could "
                        "not be described — the loop continues"
                    )

            # EVERY statement of the body sits inside a per-tick guard. The tick
            # is already never-raising; this is the second half of the D-2
            # property — outer CONTAINMENT and inner per-tick SURVIVAL — and it
            # must hold even if the tick's own guard is one day narrowed.
            try:
                await run_mt5_session_monitor_tick()
            except Exception as exc:  # noqa: BLE001 — the control; it CONTINUES
                try:
                    logger.error(
                        "mt5 session monitor: a tick escaped its own guard — the "
                        "LOOP CONTINUES (exc_class=%s)",
                        type(exc).__name__,
                    )
                except BaseException:  # noqa: BLE001 — the control
                    logger.error(
                        "mt5 session monitor: a tick escaped its own guard and "
                        "could not be described — the loop continues"
                    )

        logger.info("mt5_session_monitor_loop exiting (shutdown)")
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.error(
                "mt5 session monitor: THE LOOP ITSELF STOPPED — nothing will "
                "notice a lapsed broker session until this process restarts. It "
                "is contained rather than raised ON PURPOSE: a raise here reaches "
                "`main.lifespan`'s `_crash_handler`, which calls SHUTDOWN.set() "
                "and stops dispatch, watchdog and enqueue behind a green /health "
                "(exc_class=%s scrubbed=%s)",
                type(exc).__name__,
                # ⛔ Info (round 2) — REAL CONTENT, not just the class. No
                # credential is ever in scope in this handler (the loop's own
                # body never touches one — the tick does, inside ITS OWN
                # guard), so `scrub_freeform_string` is sufficient here; it is
                # NOT the by-value `_describe_exception_for_log` redaction
                # `mt5_relogin`'s outer handler needs, because that path
                # carries a live broker password and this one never does.
                scrub_freeform_string(str(exc)),
            )
        except BaseException:  # noqa: BLE001 — see the comment; this is the control
            logger.error(
                "mt5 session monitor: the loop itself stopped and the failure "
                "could not be described — nothing will notice a lapsed broker "
                "session until this process restarts"
            )
