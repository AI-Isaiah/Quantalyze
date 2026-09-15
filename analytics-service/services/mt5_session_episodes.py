"""Phase 164.6.4 (MT5KEEPALIVE) — the DURABLE EPISODE RECORDER: every
``authorized ↔ dark`` transition of the MT5 terminal's broker session, written
as ONE ROW PER TRANSITION into ``public.cron_runs``.

WHAT THIS IS FOR (criterion 1). Phase 164.6.2 wave 5 measured the terminal
``≥2h34m`` confirmed dark inside a ``≈8h05m`` bracket while recovery itself took
at most ``00:03:43``. Sizing a keepalive against that ONE observation is the
guess D-06 exists to prevent, so this phase ships the instrument that grows
``n`` instead: an AUTHORIZED run's duration is the session LIFETIME (the number
a successor chooses the keepalive interval from). ⛔ WR-04 — A DARK run's
DURATION is NOT the exposure: on the heal-succeeds path (the ordinary one) the
dark run is opened and closed inside ONE tick, so its duration measures the
HEAL, not the dark window. The exposure is bounded by the dark row's own
``since_previous_reading_s`` — the gap to the previous MEASURED reading — and
is unbounded only where ``started_at_is_lower_bound`` is true. A successor
computing ``SUM(completed_at - started_at) WHERE state = 'dark'`` would read
the exposure as seconds when it is up to a poll interval; read
``since_previous_reading_s`` instead.

⚠️ ``[MT5-VERDICT-SINK-01]`` is the defect class this module closes: a verdict
that can only be seen while it scrolls past. MEASURED 2026-09-05 — ``railway
logs`` returned ZERO lines matching the heal's own verdict. A row outlives the
log.

THE SINK, AND WHY THIS ONE (D-5, founder, 2026-09-15). ``public.cron_runs``
under a NEW ``cron_name``, with NO MIGRATION. VERIFIED rather than assumed:

  * the table is service-role writable by its existing ``cron_runs_service_role``
    policy (``FOR ALL`` with a matching ``WITH CHECK``);
  * ``status='running'`` IS the open episode, and the partial index
    ``idx_cron_runs_running (cron_name, started_at DESC) WHERE status='running'``
    already supports reading it back;
  * ``latest_cron_success(p_cron_name)`` takes a NAME and does not enumerate
    them, so a new name raises no false stale alert;
  * ⭐ RE-MEASURED at HEAD rather than trusted: the four SQL gates that DO count
    this table (``supabase/tests/test_ledger_refresh_fanout.sql`` and
    ``…_composite_arm.sql``, arms M1 and M2) are every one of them NARROWED by
    ``cron_name = 'ledger_refresh_fanout'`` plus ``error`` plus
    ``metadata->>'function'``. A new ``cron_name`` cannot perturb them. ⛔ Never
    introduce an unfiltered count over ``public.cron_runs`` yourself — the
    migration that writes to it forbids ITSELF one, on the stated reasoning that
    the instrument is asserted by the presence of its INSERT in the body text and
    never by a row a tick may or may not have written yet.

⚠️ AND IT IS A STRETCH OF THE TABLE'S OWN STATED PURPOSE, SAID OUT LOUD RATHER
THAN HIDDEN. Migration ``20260408113029_cron_heartbeat.sql`` gives the table the
``COMMENT`` "Heartbeat rows written by cron jobs at start + completion.
Monitored by latest_cron_success() for the 36h stale alert." These rows are NOT
written by a cron job and they are not heartbeats: they are SESSION EPISODES,
written by a ``lifespan`` task, and their ``started_at``/``completed_at`` pair is
a measured DURATION rather than a liveness ping. The shape fits exactly
(``running`` is the open episode, the close carries the outcome), the stretch is
in the WORDS, and a reader who notices the mismatch has found this paragraph
rather than a lie. ⛔ Do NOT "fix" it by editing the table's ``COMMENT`` — that
is a migration, which is precisely what D-5 chose this sink to avoid, and the
comment is accurate about every OTHER writer.

⛔ NEVER ADD ``FORCE ROW LEVEL SECURITY`` TO ``cron_runs``. The heartbeat
migration's own note calls that "the one clause under which owning a table stops
being an exemption", and it would silently drop the dormancy rows this repo's
ledger gates depend on.

⭐ THE SUCCESSOR, NAMED HERE SO THE CHOICE STAYS A DECISION. A dedicated
``public.mt5_session_episodes`` TABLE is the semantically exact home: ``status``
would not be overloaded, the state would be a column rather than a JSON key, and
the lifetime query would be an index scan rather than a JSON filter. It was
DELIBERATELY DEFERRED because it drags a migration, three reviewers, a founder
apply gate and two floor ratchets — while the dark window stays open meanwhile.
A reader who finds this module writing into a heartbeat table has found a
decision, not a gap.

⛔ WHAT MAY NEVER REACH A ROW. No login, no password, no broker server, no
gateway host, no port, no terminal key, and NO free-text detail from
``last_error()``. Names and codes only (T-164.6.2-12), and the endpoint is not
even a name. RESEARCH Open Question 5 settled: ``terminal_key`` is OMITTED — one
terminal exists, and a second is a schema problem for the phase that adds one.

⛔ AND IT NEVER RAISES. Its callers run under ``main.lifespan``'s
``_crash_handler``, which calls ``SHUTDOWN.set()`` on ANY background-task
exception — so a sink fault would stop the dispatch, watchdog and enqueue loops
behind a green ``/health``. Instrumentation must not change what a caller
observes (T-153.3-24, the posture ``mt5_client.emit_mt5_stage_event`` already
carries): a Supabase blip must leave the heal's verdict and its log line
BYTE-IDENTICAL.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Final, NamedTuple

from services.db import db_execute, get_supabase, rows

# ⛔ A STDLIB logger under the `quantalyze.analytics.` prefix — the convention
# `services/mt5_relogin.py` and `services/mt5_client.py` already use, and for the
# reason spelled out there: a module-scope `structlog` proxy freezes the
# processor list at import time, i.e. before `configure_logging()` runs, and
# carries the UNREDACTED chain forever.
logger = logging.getLogger("quantalyze.analytics.mt5_session_episodes")

#: ⭐ THE NEW NAME, and it is new BY DESIGN (D-5). Nothing else writes it, no
#: alert enumerates it, and every shipped gate that counts this table narrows on
#: a DIFFERENT name (re-measured at HEAD — see the module docstring).
MT5_SESSION_EPISODE_CRON_NAME: Final[str] = "mt5_session_episode"

#: The metadata contract's version. ⛔ A row whose `schema_version` this code does
#: not recognise is SUPERSEDED, never closed as a measured transition — see
#: `_recognised_open_state`.
SCHEMA_VERSION: Final[int] = 1
_RECOGNISED_SCHEMA_VERSIONS: Final[frozenset[int]] = frozenset({SCHEMA_VERSION})

# --------------------------------------------------------------------------- #
# The observed STATE of the broker session.
#
# ⛔ `cron_runs.status` is OVERLOADED — its CHECK admits only
# `running`/`ok`/`error`, which are lifecycle tokens for a cron RUN and not a
# vocabulary for a terminal's authorization. The real discriminator is
# `metadata.state`; `status` merely carries "open / ended well / ended badly".
# Stated here and again at the write site, because a reader who infers the state
# from `status` will read every superseded anomaly as a measured dark window.
# --------------------------------------------------------------------------- #
STATE_AUTHORIZED: Final[str] = "authorized"
STATE_DARK: Final[str] = "dark"

#: ⛔ NOT a state a row may ever carry. It is the classification of a reading
#: that MEASURED NOTHING, and its defined behaviour is to write nothing and close
#: nothing.
STATE_NOT_MEASURED: Final[str] = "not_measured"

_MEASURED_STATES: Final[frozenset[str]] = frozenset({STATE_AUTHORIZED, STATE_DARK})

# --------------------------------------------------------------------------- #
# The verdict CLASSES. ⛔ These are the CLASS, never the composed verdict string
# — whose tail is terminal-supplied text and therefore may not reach a row
# (T-164.6.4-08). `services/mt5_relogin.py` builds its verdict reasons FROM these
# constants, so the class in a row and the class in a log line cannot drift.
# --------------------------------------------------------------------------- #
KIND_ALREADY_AUTHORIZED: Final[str] = "already_authorized"
KIND_HEALED: Final[str] = "healed"
KIND_NO_AUTHORIZED_ACCOUNT: Final[str] = "no_authorized_account"
KIND_IPC_FAULT: Final[str] = "ipc_fault"
KIND_CREDENTIAL_REFUSED: Final[str] = "credential_refused"
KIND_HEAL_SENT_IPC_FAULT_ON_REPROBE: Final[str] = "heal_sent_ipc_fault_on_reprobe"
KIND_STILL_UNAUTHORIZED: Final[str] = "still_unauthorized"
KIND_BUSY_SKIP: Final[str] = "busy_skip"
KIND_BUDGET_ABANDONED: Final[str] = "budget_abandoned"

#: ⭐ WR-03 — CONFIGURATION REFUSALS ARE COUNTED, not merely logged-once. Four
#: paths used to return before any reading was recorded — the monitor's own
#: kill-switch arm, the heal's credentials-absent/invalid arms, and its
#: gateway-absent/port-not-numeric arms — and because `_log_configuration_
#: fault_once` throttles to ONE line per process, a monitor that had measured
#: NOTHING for days was byte-identical in the logs to one that had found the
#: session healthy every tick. Recording these as `not_measured` readings puts
#: them on the SAME counter and the SAME blind-run escalation that already
#: covers `busy_skip`/`budget_abandoned`/the `code=0` sentinel. ⛔ Never reuse
#: `KIND_BUSY_SKIP` here — the class in a row and the class in a log line are
#: pinned to each other on purpose.
KIND_DISABLED: Final[str] = "disabled"
KIND_NOT_CONFIGURED: Final[str] = "not_configured"

#: ⭐ The close that is NOT a measurement. A row closed under this kind carries
#: `close_is_measured: false`, and a successor computing lifetimes filters it out.
KIND_SUPERSEDED: Final[str] = "superseded"

#: The MT5 code meaning "the bridge ANSWERED and NO ACCOUNT IS AUTHORIZED" — the
#: ONE code that establishes darkness. Re-spelled here rather than imported from
#: `mt5_relogin` so this module has no import edge back to its own caller.
_MT5_NO_AUTHORIZED_ACCOUNT_CODE: Final[int] = -6

#: ⚠️ IN-02, AND IT IS LOAD-BEARING. `-6` is only ever observable through the
#: SECOND `last_error()` round-trip, so when THAT is the broken one the fault
#: classifies as `0` — a sentinel `_raise_last` uses for THREE distinct faults.
#: A `0` is therefore recorded `unattributed` and NEVER guessed into `authorized`
#: or `dark`.
_UNATTRIBUTED_CODE: Final[int] = 0

#: ⭐ THE ATTRIBUTION LIMIT, IN THE ROW AND NOT ONLY IN THE PROSE (criterion 1,
#: researcher C-6). It is the biggest threat to the n>1 dataset this phase exists
#: to start: the allocator and derive paths call `Mt5Client.login(...)` with
#: PER-CUSTOMER credentials on the SAME shared terminal and `close()` never calls
#: `shutdown()`, so an "authorized" reading may be a customer login rather than
#: the environment account. The TRIGGER stays correct — `-6` means nobody is
#: authorized — but the LIFETIME figure is the part at risk.
#:
#: ⛔ Do NOT "fix" this by reading `account_info()`. That is an extra read this
#: phase is forbidden to add, and it would put the account number into a log on a
#: PUBLIC repo.
ATTRIBUTION_LIMIT: Final[str] = (
    "This reading cannot attribute the authorized session to any particular "
    "account: the detector is credential-free, other paths log in per customer "
    "on the same shared terminal, and close() never calls shutdown(). Treat "
    "authorized-run durations as an UPPER bound on the environment account's "
    "session lifetime."
)


class SessionReading(NamedTuple):
    """One classified observation of the terminal's broker session.

    ``state`` is the discriminator; ``kind`` and ``code`` are what produced it.
    ``unattributed`` marks the IN-02 sentinel — a ``code=0`` fault that names
    three distinct causes and therefore attributes to none of them.
    """

    state: str
    kind: str
    code: int | None
    unattributed: bool


class HealOutcome(NamedTuple):
    """What ``mt5_relogin._heal_blocking`` hands back.

    ⛔ ``verdict`` IS THE COMPOSED STRING, BYTE-UNCHANGED. Every shipped log line
    and the ``startswith(_VERDICT_NOT_HEALED_PREFIX)`` severity branch keep
    reading this one field, so no log-content assertion moves. The other fields
    exist so the recorder never has to PARSE it — string-shape dependency is
    exactly what plan 01 removed from ``initialize_with_credentials``, and
    re-introducing it here to read the class back out would be that defect
    arriving in a new file.

    ``first_*`` is the CREDENTIAL-FREE detector's reading. ``final_*`` is the
    post-heal re-probe's, and is ``None`` when no credentialed call ran — which
    is what makes "a tick that finds the session healthy produces ZERO rows"
    structural rather than incidental.
    """

    verdict: str
    first_kind: str
    first_code: int | None
    final_kind: str | None
    final_code: int | None


# --------------------------------------------------------------------------- #
# (d) THE MEASURED LATENCY BOUND (criterion 2's "MEASURED rather than assumed").
#
# True detection latency is UNKNOWABLE — nothing observes the lapse itself. What
# IS measurable, and what the criterion should be read as demanding, is a BOUND:
# the wall-clock gap since the previous MEASURED reading. ⛔ Do NOT substitute the
# configured cadence for it. An assumed number wearing a measured name is the
# defect class this whole phase is about, and a cadence is exactly the quantity a
# busy skip, a budget abandon or a redeploy makes untrue.
#
# ⚠️ MONOTONIC, never wall clock: NTP steps and container clock skew would
# otherwise produce negative gaps on a table whose whole purpose is durations.
# --------------------------------------------------------------------------- #
_LAST_MEASURED_READING_MONOTONIC: float | None = None


# --------------------------------------------------------------------------- #
# (d) A BLIND INSTRUMENT MUST NOT LOOK LIKE A HEALTHY ONE.
#
# A run of consecutive `not_measured` readings means this mechanism has measured
# NOTHING for that many intervals — and at INFO forever that is indistinguishable
# from a quiet, healthy system. That is the defect class this whole phase exists
# to remove, pointed at the fix: the terminal sat dark for ≥2h34m while every
# instrument stayed quiet, because a quiet instrument and a healthy one emit the
# same thing.
#
# ⭐ THE THRESHOLD IS DERIVED FROM THE CADENCE, NEVER HAND-TYPED. What matters is
# WALL-CLOCK BLINDNESS, not a count of ticks, so the count is recomputed from the
# poll interval the caller actually supplies. A retune of the cadence therefore
# carries through instead of stranding a constant somebody would have to remember
# to move.
#
# ⚠️ THE COUNTER IS IN-PROCESS AND RESETS ON DEPLOY, and that is ACCEPTABLE HERE
# for a reason that does NOT generalise: it gates a LOG LEVEL and never a dataset
# value. The dataset's own state lives in the database and is re-read on every
# observation (see `record_mt5_session_reading`), which is why a redeploy cannot
# truncate an episode. A redeploy CAN restart a blind run's count — the cost is a
# late escalation on a mechanism that also writes nothing while blind, and paying
# it is cheaper than a second durable write path.
# --------------------------------------------------------------------------- #

#: The INDEPENDENT instrument's own window: the hourly production prober's
#: cadence. Re-spelled here rather than imported from
#: `services.mt5_session_monitor` — that module imports `mt5_relogin`, which
#: imports THIS one, so the import edge would be a cycle. ⛔ The re-spelling is
#: pinned against the original by `test_the_independent_window_AGREES_with_the
#: _monitors_own_ceiling`, so the duplication cannot drift silently.
_INDEPENDENT_INSTRUMENT_WINDOW_S: Final[float] = 3600.0

_CONSECUTIVE_NOT_MEASURED_READINGS: int = 0


def blind_run_escalation_threshold(poll_interval_s: float | None) -> int | None:
    """How many CONSECUTIVE ``not_measured`` readings cover the independent
    instrument's own window, or ``None`` when no cadence was supplied.

    ⚠️ ``None`` is the BOOT HEAL's answer and it is correct rather than
    degenerate: that caller fires ONCE per process, so a "run" of blind readings
    there can never exceed one and no wall-clock span can be derived from a
    cadence that does not exist. ⛔ Do NOT substitute the monitor's default
    interval for it — an assumed number wearing a measured name is the defect
    class this phase is about.
    """
    if poll_interval_s is None or poll_interval_s <= 0:
        return None
    return max(1, math.ceil(_INDEPENDENT_INSTRUMENT_WINDOW_S / poll_interval_s))


def _count_blind_reading() -> int:
    """Extend the consecutive-blind run and return its new length.

    ⛔ A SEPARATE FUNCTION for the same reason `_stamp_reading_and_measure_gap`
    is one: the shared never-raises predicate requires
    `record_mt5_session_reading`'s body to be EXACTLY the `try`, and a `global`
    declaration beside it is a second top-level statement.
    """
    global _CONSECUTIVE_NOT_MEASURED_READINGS
    _CONSECUTIVE_NOT_MEASURED_READINGS += 1
    return _CONSECUTIVE_NOT_MEASURED_READINGS


def _clear_blind_run() -> None:
    """A reading that MEASURED something ends the blind run, whatever it found.

    ⭐ `dark` resets it too, and deliberately: the instrument is not blind, it is
    reporting. Darkness is the thing this phase exists to SEE.
    """
    global _CONSECUTIVE_NOT_MEASURED_READINGS
    _CONSECUTIVE_NOT_MEASURED_READINGS = 0


def _reset_session_episode_state_for_tests() -> None:
    """Clear the previous-reading stamp and the consecutive-blind counter.

    ⛔ Test-only, and underscore-prefixed for the same reason
    ``mt5_relogin._reset_relogin_log_throttle_for_tests`` is: module-level state a
    test must be able to clear, in the same package, under the same convention.
    Production never calls it — the stamp is what makes
    ``first_reading_after_boot`` honest, and a blind run that survived into the
    next test would make "it escalated" and "it stayed quiet" indistinguishable.
    """
    global _LAST_MEASURED_READING_MONOTONIC
    _LAST_MEASURED_READING_MONOTONIC = None
    _clear_blind_run()


def _stamp_reading_and_measure_gap() -> tuple[float | None, bool]:
    """Advance the previous-MEASURED-reading stamp and return
    ``(since_previous_reading_s, first_reading_after_boot)``.

    ⛔ A SEPARATE FUNCTION PURELY SO ``record_mt5_session_reading`` NEEDS NO
    ``global`` DECLARATION AT ITS TOP LEVEL. The shared never-raises predicate
    requires that function's body to be EXACTLY ONE statement and for it to be
    the ``try``; a ``global`` beside it is a second top-level statement, and the
    right answer is to keep the gate strict rather than to widen it for a
    declaration. ⛔ Do NOT "simplify" this back inline.
    """
    global _LAST_MEASURED_READING_MONOTONIC
    now = time.monotonic()
    previous = _LAST_MEASURED_READING_MONOTONIC
    _LAST_MEASURED_READING_MONOTONIC = now
    if previous is None:
        return None, True
    return now - previous, False


def classify_reading(kind: str, code: int | None) -> SessionReading:
    """Map a verdict CLASS and an MT5 CODE to an observed session state.

    ⛔ FROM THE CODE, NOT FROM THE VERDICT STRING. The two positive classes carry
    no code at all (a clean probe raises nothing, so there is nothing to read
    ``last_error()`` for), which is why they are matched by class; everything
    else is decided by the code, because the code is the only thing the terminal
    actually answered.

      * class ``already_authorized`` or ``healed``  -> ``authorized``
      * code ``-6``                                 -> ``dark``. THE one code
        meaning the bridge ANSWERED and NO ACCOUNT IS AUTHORIZED.
      * any other code, ``0`` included              -> ``not_measured``; ``0``
        additionally marks the reading ``unattributed`` (IN-02).

    ⚠️ ``busy_skip`` and ``budget_abandoned`` arrive with ``code=None`` and fall
    through to ``not_measured``, which is the whole point: neither measured the
    session. ⛔ Do NOT copy the boot heal's busy-skip RATIONALE into this
    classification. It reasons that "a busy terminal is a terminal somebody is
    already successfully using, which is itself evidence that the session is
    fine" — cheap and defensible for a once-per-boot heal, and UNSOUND for a
    loop: it is a standing claim about session state the tick did not measure,
    and a terminal held by a FAILING job is exactly where it is most wrong.
    """
    if kind in (KIND_ALREADY_AUTHORIZED, KIND_HEALED):
        return SessionReading(STATE_AUTHORIZED, kind, code, False)
    if code == _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
        return SessionReading(STATE_DARK, kind, code, False)
    return SessionReading(
        STATE_NOT_MEASURED, kind, code, code == _UNATTRIBUTED_CODE
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _recognised_open_state(metadata: object) -> str | None:
    """The state an OPEN row claims, or ``None`` when nothing parsed it.

    ⛔ THE ``None`` ARM IS NOT A DEGENERATE CASE, IT IS THE POINT. "Differs" is a
    TOTAL relation and would otherwise swallow an absent, malformed or
    unrecognised-version row into the MEASURED-close arm — fabricating a measured
    lifetime out of a row whose start state was never established. It is the same
    argument that earns ``started_at_is_lower_bound`` and ``unattributed`` their
    places: what was not measured must not be recorded as measured.
    """
    if not isinstance(metadata, dict):
        return None
    if metadata.get("schema_version") not in _RECOGNISED_SCHEMA_VERSIONS:
        return None
    state = metadata.get("state")
    if isinstance(state, str) and state in _MEASURED_STATES:
        return state
    return None


async def _read_open_rows() -> list[dict[str, Any]]:
    """EVERY open row for this ``cron_name``, newest ``started_at`` first.

    ⛔ NEVER ``limit(1)``, and this is (c2)'s whole mechanism. A stateless
    recorder is exactly the design that has to tolerate TWO WRITERS, and Railway
    OVERLAPS CONTAINERS ON DEPLOY — the old one drains while the new one boots —
    so two monitor loops can observe the same terminal for a window. A read that
    takes the newest row and never looks back leaves the older one open FOREVER
    with a null ``completed_at``, and the episode it represents is LOST from the
    very lifetime dataset criterion 1 exists to build.

    ZERO rows and MORE-THAN-ONE row are both real and both have defined
    behaviour; one row is merely the normal path.
    """
    supabase = get_supabase()

    def _select() -> Any:
        return (
            supabase.table("cron_runs")
            .select("id,started_at,metadata")
            .eq("cron_name", MT5_SESSION_EPISODE_CRON_NAME)
            .eq("status", "running")
            .order("started_at", desc=True)
            .execute()
        )

    return rows(await db_execute(_select))


async def _close_row(
    row: dict[str, Any],
    *,
    state: str,
    closing_kind: str,
    closing_code: int | None,
    source: str,
    measured: bool,
) -> bool:
    """Close ONE open row — as a COMPARE-AND-SET. Returns whether THIS call won it.

    ⭐ WR-01. The return value is the ONLY way a caller can tell a CAS that bit
    from one that no-op'd against a row someone else already closed — and that
    distinction is load-bearing for the caller's OWN inference (see
    ``record_mt5_session_reading``, which must not claim a measured transition
    about an UPDATE that matched zero rows). ``True`` means this call's
    ``status='running'`` predicate matched and the row is now closed under this
    call's payload; ``False`` means another writer closed it first and this call
    was a genuine no-op — the row's content is UNCHANGED by this call.

    ⛔ THE ``status='running'`` PREDICATE IS LOAD-BEARING AND IT IS NOT
    DEFENSIVE PROGRAMMING. Without it the fix loses episodes through the very
    discriminator added to protect them. Under the two-container overlap this
    design exists to tolerate: container A closes row R GENUINELY with
    ``close_is_measured: true``; container B — already mid-open, having read R as
    live — issues its superseded close against R and stamps ``false`` over
    ``true``; and the successor's ``close_is_measured`` filter then EXCLUDES a
    genuinely measured episode from the lifetime dataset. MEASURED on a harness:
    unguarded the lifetime dataset came back EMPTY, guarded it came back with the
    episode present.

    ⚠️ READING THE ROW FIRST AND BRANCHING IN PYTHON DOES NOT FIX IT. The
    interleave is between the READ and the WRITE, which is exactly the window a
    compare-and-set closes and a read-then-write does not. The guard belongs in
    the UPDATE's predicate, never in a preceding ``if``.

    ⭐ ``status`` FOLLOWS THE RUN, NOT THE NEW READING. An authorized run whose
    end we MEASURED closes ``ok``; a dark run closes ``error``; and a SUPERSEDED
    close is ``error`` REGARDLESS of the run's state — so ``status='ok'`` keeps
    meaning exactly one thing and an anomaly can never be read as a measured
    session lifetime.
    """
    supabase = get_supabase()
    previous = row.get("metadata")
    metadata: dict[str, Any] = dict(previous) if isinstance(previous, dict) else {}
    metadata.update(
        {
            "closed_by": source,
            "closing_kind": closing_kind,
            "closing_code": closing_code,
            # ⭐ PRESENT ON EVERY CLOSED ROW, true or false. A successor computing
            # session lifetimes filters on it; a missing key would be read as
            # "probably fine", which is the direction that corrupts the dataset.
            "close_is_measured": measured,
        }
    )
    if not measured:
        # ⚠️ Its `completed_at` is the time we NOTICED, not a measured
        # transition — exactly as `started_at_is_lower_bound` marks the mirror
        # case at the other end of the run.
        metadata["completed_at_is_notice_time"] = True

    if measured and state == STATE_AUTHORIZED:
        status = "ok"
        error: str | None = None
    else:
        status = "error"
        opening_kind = metadata.get("opening_kind")
        opening_code = metadata.get("opening_code")
        error = (
            KIND_SUPERSEDED
            if not measured
            else f"{opening_kind}:code={opening_code}"
        )

    payload: dict[str, Any] = {
        "completed_at": _now_iso(),
        "status": status,
        "error": error,
        "metadata": metadata,
    }

    def _update() -> Any:
        return (
            supabase.table("cron_runs")
            .update(payload)
            .eq("id", row.get("id"))
            # ⛔ THE COMPARE-AND-SET. Do not "simplify" this away.
            .eq("status", "running")
            .execute()
        )

    response = await db_execute(_update)
    # ⭐ WR-01 — A ZERO-ROW UPDATE MEANS THE CAS LOST: another writer closed
    # this row first. Fail CLOSED rather than assume the write bit; the caller
    # depends on this to know whether IT measured the transition.
    return bool(rows(response))


async def _open_row(reading: SessionReading, *, source: str,
                    poll_interval_s: float | None,
                    since_previous_reading_s: float | None,
                    first_reading_after_boot: bool,
                    started_at_is_lower_bound: bool) -> None:
    """Open a run for ``reading.state``, restoring the one-open-row invariant first.

    ⛔ THE INVARIANT IS RESTORED BY EVERY WRITE, not only by a read that happened
    to look. Any ``running`` row still standing for this name at this instant —
    including one that appeared between our read and now — is closed
    ``superseded`` before the insert. Each of those closes is the compare-and-set
    above, so re-closing a row we JUST closed truthfully is a NO-OP rather than a
    stamp of ``false`` over ``true``.

    ⭐ ``started_at_is_lower_bound`` IS A PARAMETER AND NOT A CONSTANT ``True``,
    and the distinction is the difference between a bounded and an unbounded
    error on every duration a successor computes from these rows:

      * ``True``  — there was NO open run to continue (a boot, a crash, or a row
        nothing parsed). The state began at some UNKNOWABLE and UNBOUNDED time
        before we first looked, so the run's duration is a lower bound with no
        bound on how far it understates.
      * ``False`` — the run was opened at an OBSERVED TRANSITION: the previous
        state's run was just closed as MEASURED, so the flip happened inside the
        last ``since_previous_reading_s`` seconds, which the row also carries.
        The duration still understates slightly, but by a quantity THIS ROW
        NAMES.

    ⛔ Do NOT collapse them back to an unconditional ``True``. A successor that
    cannot separate "unbounded" from "bounded by one poll interval" must discard
    every row to stay honest, which is the dataset this phase exists to build.
    """
    for stale in await _read_open_rows():
        stale_state = _recognised_open_state(stale.get("metadata"))
        logger.warning(
            "mt5 session episode: an open row was still standing when a new run "
            "was opened (state=%s) — closing it as %s. This is an ANOMALY, not a "
            "normal path: it means two containers observed the same terminal "
            "(a Railway deploy overlap) or a process died between a close and "
            "its paired open.",
            stale_state,
            KIND_SUPERSEDED,
        )
        await _close_row(
            stale,
            state=stale_state or STATE_DARK,
            closing_kind=KIND_SUPERSEDED,
            closing_code=None,
            source=source,
            measured=False,
        )

    supabase = get_supabase()
    payload: dict[str, Any] = {
        "cron_name": MT5_SESSION_EPISODE_CRON_NAME,
        "started_at": _now_iso(),
        "status": "running",
        "error": None,
        # ⛔ METADATA CARRIES THIS AND NOTHING ELSE. No login, no password, no
        # server, no gateway host, no port, no terminal key, and no free-text
        # detail from `last_error()` — names and codes only (T-164.6.2-12).
        "metadata": {
            "schema_version": SCHEMA_VERSION,
            # ⛔ THE REAL DISCRIMINATOR. `status` is overloaded (see `_close_row`).
            "state": reading.state,
            "opened_by": source,
            "opening_kind": reading.kind,
            "opening_code": reading.code,
            "poll_interval_s": poll_interval_s,
            "since_previous_reading_s": since_previous_reading_s,
            "first_reading_after_boot": first_reading_after_boot,
            # ⭐ True when its start is when we first LOOKED rather than a
            # measured transition — see this function's docstring.
            "started_at_is_lower_bound": started_at_is_lower_bound,
            "reading_attributes_account": False,
            "attribution_limit": ATTRIBUTION_LIMIT,
        },
    }

    def _insert() -> Any:
        return supabase.table("cron_runs").insert(payload).execute()

    await db_execute(_insert)


async def record_mt5_session_reading(
    kind: str, code: int | None, *, source: str, poll_interval_s: float | None
) -> None:
    """Record ONE observation. Writes a row only when the state TRANSITIONED.

    ⭐ STATELESS BY CONSTRUCTION, AND THAT IS HOW D-5's BOOT RE-READ IS
    SATISFIED. The open run is re-read from the DATABASE on every observation and
    the decision is taken from that row alone. There is therefore NO in-process
    episode state to reset, and an analytics redeploy — Railway deploys on every
    green ``main`` CI — cannot bias a session lifetime SHORT. ⛔ D-5's warning is
    answered by having no memory, not by remembering harder.

    THE DECISION TABLE, EXACTLY:

      * the reading is ``not_measured`` -> write NOTHING, close NOTHING, return.
        It did not measure that the session recovered, so it may never close an
        episode.
      * an open row exists and its ``metadata.state`` EQUALS the observed state ->
        write NOTHING. ⭐ This is what makes the sink per-TRANSITION rather than
        per-tick: at a ten-minute cadence a per-tick write would be ~144
        rows/day forever, into a shared and gated table, for no information.
      * an open row exists and its state is a RECOGNISED state that DIFFERS ->
        close it as a MEASURED transition, then open a run for the observed
        state whose start is MEASURED too (``started_at_is_lower_bound: false``).
      * ⛔ an open row exists but its state is ABSENT, MALFORMED or from an
        unrecognised ``schema_version`` -> the SUPERSEDED path, never the
        measured-close arm (see ``_recognised_open_state``). The run opened after
        it carries ``started_at_is_lower_bound: true``, because nothing measured
        what it superseded.
      * no open row exists -> open one, ``started_at_is_lower_bound: true``.

    ⛔ NEVER RAISES, AND NEVER CHANGES THE VERDICT. The whole body sits inside ONE
    top-level ``except Exception`` whose handler body is itself exactly one nested
    ``try`` with an ARGUMENT-FREE ``except BaseException`` — the IN-06 shape
    ``heal_mt5_terminal_session`` carries, for the same reason:
    ``logger.warning``'s arguments are evaluated BEFORE logging is entered.

    ⛔ ``except BaseException`` MUST NEVER WRAP AN ``await``. ``asyncio.
    CancelledError`` is not an ``Exception`` subclass on this venv (measured,
    Python 3.12.13), so ``except Exception`` correctly lets shutdown cancellation
    through while ``except BaseException`` would swallow it and hang
    ``lifespan``'s 10-second gather. ⛔ And never ``except OSError`` here:
    ``asyncio.TimeoutError is TimeoutError`` and its MRO runs through
    ``OSError``, so an ``OSError`` handler silently eats a budget expiry.
    """
    try:
        reading = classify_reading(kind, code)
        if reading.state == STATE_NOT_MEASURED:
            # ⛔ CLOSES NOTHING. A busy skip, a budget abandon and the `code=0`
            # sentinel all land here; the ABSENCE of a row is the record that
            # nothing was measured, and `unattributed` names WHY for the `0`
            # case rather than guessing a state out of it (IN-02).
            consecutive = _count_blind_reading()
            threshold = blind_run_escalation_threshold(poll_interval_s)
            # ⛔ THE ESCALATION, and it is the point of the counter. Below the
            # threshold this is ordinary; at or above it the mechanism has
            # measured nothing for at least as long as the INDEPENDENT hourly
            # instrument's own window, and a blind instrument at INFO forever
            # looks exactly like a healthy one.
            blind = threshold is not None and consecutive >= threshold
            logger.log(
                logging.WARNING if blind else logging.INFO,
                "mt5 session episode: reading MEASURED NOTHING "
                "(kind=%s code=%s unattributed=%s source=%s) — no row written "
                "and no episode closed. consecutive_not_measured=%s "
                "escalation_threshold=%s blind=%s",
                reading.kind,
                reading.code,
                reading.unattributed,
                source,
                consecutive,
                threshold,
                blind,
            )
            return
        _clear_blind_run()

        # ⛔ `None` on the first reading of a process, never the cadence
        # constant. An assumed number wearing a measured name is the defect class
        # this phase is about.
        (
            since_previous_reading_s,
            first_reading_after_boot,
        ) = _stamp_reading_and_measure_gap()

        open_rows = await _read_open_rows()
        if len(open_rows) > 1:
            logger.warning(
                "mt5 session episode: %d open rows for %s — the NEWEST is live "
                "and every older one is being closed as %s. More than one open "
                "row is an ANOMALY (a Railway container overlap, or a crash "
                "between a close and its paired open), not a normal path.",
                len(open_rows),
                MT5_SESSION_EPISODE_CRON_NAME,
                KIND_SUPERSEDED,
            )
        live = open_rows[0] if open_rows else None
        for older in open_rows[1:]:
            older_state = _recognised_open_state(older.get("metadata"))
            await _close_row(
                older,
                state=older_state or STATE_DARK,
                closing_kind=KIND_SUPERSEDED,
                closing_code=None,
                source=source,
                measured=False,
            )

        # ⭐ The run about to be opened has a MEASURED start only when a live run
        # was closed as a measured transition immediately before it. Every other
        # path — a boot, a crash, an orphan, a row nothing parsed — leaves the
        # true start UNBOUNDEDLY earlier than `started_at` (see `_open_row`).
        continued_a_measured_run = False
        if live is not None:
            live_state = _recognised_open_state(live.get("metadata"))
            if live_state == reading.state:
                return
            if live_state is None:
                logger.warning(
                    "mt5 session episode: the open row's state could not be "
                    "parsed (absent, malformed, or an unrecognised "
                    "schema_version) — closing it as %s rather than as a "
                    "measured transition. A row NOTHING PARSED must never "
                    "become a measured lifetime.",
                    KIND_SUPERSEDED,
                )
                await _close_row(
                    live,
                    state=STATE_DARK,
                    closing_kind=KIND_SUPERSEDED,
                    closing_code=None,
                    source=source,
                    measured=False,
                )
            else:
                # ⭐ WR-01 — THE INFERENCE IS GATED ON THE CAS OUTCOME, not
                # assumed from having reached this branch. `_close_row`'s
                # `status='running'` predicate is the only thing standing
                # between "we measured this transition" and "another writer
                # already closed this row" — a caller that lost the race must
                # not stamp `started_at_is_lower_bound: false` about a
                # transition it did not measure.
                continued_a_measured_run = await _close_row(
                    live,
                    state=live_state,
                    closing_kind=reading.kind,
                    closing_code=reading.code,
                    source=source,
                    measured=True,
                )
                if not continued_a_measured_run:
                    logger.warning(
                        "mt5 session episode: the measured close lost its "
                        "compare-and-set — another writer closed this run "
                        "first. The run opened next carries "
                        "started_at_is_lower_bound: true, because THIS "
                        "process measured no transition it can bound.",
                    )

        await _open_row(
            reading,
            source=source,
            poll_interval_s=poll_interval_s,
            since_previous_reading_s=since_previous_reading_s,
            first_reading_after_boot=first_reading_after_boot,
            started_at_is_lower_bound=not continued_a_measured_run,
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.warning(
                "mt5 session episode: the reading could not be recorded — the "
                "heal's verdict and log line are unaffected; the next transition "
                "will re-read the open row from the database (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 — see the comment; this is the control
            logger.warning(
                "mt5 session episode: the reading could not be recorded, and the "
                "failure could not be described"
            )


async def record_mt5_heal_outcome(
    outcome: HealOutcome, *, source: str, poll_interval_s: float | None
) -> None:
    """TWO OBSERVATIONS PER TICK WHEN A HEAL RUNS — and one when it does not.

    ⭐ THIS IS WHAT MAKES THE DARK WINDOW MEASURABLE AT ALL. Report the FIRST
    probe's reading, then — only if the credentialed heal actually ran — the
    FINAL one. A tick that finds ``-6`` and heals it therefore produces exactly
    TWO transitions (``authorized -> dark`` and ``dark -> authorized``) and so
    exactly two rows, while a tick that finds the session healthy produces ZERO.

    ⛔ Never called from ``heal_mt5_terminal_session``'s OUTER catch-all: the
    never-raises AST gate requires that handler's body to be EXACTLY one nested
    ``try``, and an extra statement there is a NAMED defect.
    """
    try:
        await record_mt5_session_reading(
            outcome.first_kind,
            outcome.first_code,
            source=source,
            poll_interval_s=poll_interval_s,
        )
        if outcome.final_kind is not None:
            await record_mt5_session_reading(
                outcome.final_kind,
                outcome.final_code,
                source=source,
                poll_interval_s=poll_interval_s,
            )
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.warning(
                "mt5 session episode: the heal outcome could not be recorded "
                "(exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 — see the comment; this is the control
            logger.warning(
                "mt5 session episode: the heal outcome could not be recorded, "
                "and the failure could not be described"
            )
