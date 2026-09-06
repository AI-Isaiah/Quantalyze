"""Phase 164.2 / criterion 2 — the WRITER half of ``computation_error`` provenance.

Migration ``20260906120000_computation_error_provenance.sql`` gave
``strategy_analytics`` two nullable marker columns,
``computation_error_source`` and ``computation_error_job_id``, and made
``sync_strategy_analytics_status`` CONDITIONAL on them: branches (b)/(b-prime)
keep an existing sentence only when it carries ``('writer', <the job this
transition resolves>)``, and overwrite it with the per-kind generic otherwise.
A curated sentence that is not stamped is therefore still overwritten — the SQL
half can only respect provenance the writers actually set. This module holds the
two pieces every Python writer needs and neither of the two writer modules owns.

────────────────────────────────────────────────────────────────────────────
WHY THE SOURCE IS DERIVED FROM THE JOB ID RATHER THAN TYPED AS ``"writer"``
────────────────────────────────────────────────────────────────────────────
The migration puts TWO CHECK constraints on the pair, and both sit on the
FAILURE-RECORDING path:

  * ``strategy_analytics_computation_error_source_check`` — the column's domain
    is the single value ``'writer'`` (the T-164.2-11 tampering mitigation);
  * ``strategy_analytics_computation_error_markers_together_check`` —
    ``(computation_error_source IS NULL) = (computation_error_job_id IS NULL)``.

The second one is reachable from here, and the plan's first draft reached it:
``run_csv_strategy_analytics`` takes ``job_id`` as a keyword-only parameter that
DEFAULTS TO NONE, because three of its four callers are not jobs at all (the
CSV-first wizard route, the composite finalizer, the tests). A writer that types
``"computation_error_source": "writer"`` beside ``"computation_error_job_id":
job_id`` therefore emits ``('writer', NULL)`` on every one of those calls, the
pairing CHECK raises 23514, and **the failure is not recorded at all** — no
sentence, no status, nothing for the user or the operator. That is strictly
worse than the pre-164.2 behaviour the whole design is supposed to degrade to.

:func:`provenance_source` closes it at the root: the two markers are decided by
ONE expression, so a half-stamp is not expressible at a call site. The AST
census ``tests/test_computation_error_provenance_census.py`` enforces the SHAPE
— every stamped literal must pass the SAME expression to this function that it
writes into ``computation_error_job_id`` — so the pairing cannot drift back
apart in a later edit.

:func:`upsert_or_drop_provenance` is the belt to that braces, and it is the
resolution of TODOS ``[PROV-WRITER-23514]``: if a 23514 reaches a marker-bearing
payload ANYWAY — a constraint this module does not know about, a future
migration narrowing the domain further — the failure record must survive at the
cost of the provenance, never the other way round. 164.2-REVIEW WR-02 gave it a
second reason to fire, on the same principle and with the same remedy: a
``PGRST204`` naming a marker column means the worker is running AHEAD of the
migration, PostgREST wrote nothing, and the lost payload is the one recording a
failure. Because the helper already sits at every stamped site, T-164.2-17's
deploy window is mitigated at all of them rather than at the one that happened
to have a hand-written arm.

⛔ THIS MODULE DELIBERATELY CONTAINS NO ``.table("strategy_analytics")`` CALL.
``tests/test_computing_started_at_stamp.py`` (JOB-01) and the provenance census
both walk the AST for ``supabase.table("strategy_analytics").upsert(<dict
literal>)`` and can only read a payload that is a literal (or a name bound to
one) AT THE CALL SITE — ``analytics_runner.py``'s
``_guard_failure_payload_inplace`` docblock records what happened the last time
a helper swallowed one: five terminal writers went invisible to the census and
its exempt count silently fell to 0. So the write stays at the site and this
module takes it as a CALLABLE. Do not "simplify" this into a function that
performs the upsert itself.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, Final

from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)

# The ONLY value ``strategy_analytics_computation_error_source_check`` admits.
# Spelled once here rather than at each of the ten writers: the constraint's
# domain and this constant are the two ends of a contract with no compiler
# between them, and ten copies is ten chances for one of them to drift into a
# 23514 on the failure path.
PROVENANCE_SOURCE_WRITER: Final[str] = "writer"

PROVENANCE_SOURCE_KEY: Final[str] = "computation_error_source"
PROVENANCE_JOB_ID_KEY: Final[str] = "computation_error_job_id"

# PostgreSQL's check_violation. PostgREST forwards it verbatim as the error
# ``code`` (it is not one of the PGRST* codes, which are PostgREST's own).
_PG_CHECK_VIOLATION: Final[str] = "23514"

# 164.2-REVIEW WR-03. The SQLSTATE alone is NOT enough to conclude "the database
# refused MY markers". ``strategy_analytics`` carries other CHECK constraints
# today and will gain more; any of them firing on a marker-bearing payload used
# to take the arm below, which cost one wasted round trip and — the part that
# matters — logged an ERROR naming the marker pair for a constraint that has
# nothing to do with it. That log line is, by this module's own docblock, "the
# only place that bug becomes visible", so a wrong diagnosis there sends the
# next operator after the wrong constraint.
#
# ⚠️ A PREFIX, not the two exact constraint names, and that is deliberate. The
# whole point of this helper (TODOS ``[PROV-WRITER-23514]``) is to survive "a
# constraint this module does not know about, a future migration narrowing the
# domain further" — matching the two names known on 2026-09-06 would defeat it
# on exactly the constraint it was written for. PostgreSQL's default naming for
# a column CHECK is ``<table>_<column>_check``, so every present and future
# CHECK over ``computation_error_source`` / ``computation_error_job_id`` carries
# this prefix, and no constraint over another column can.
#   * ``strategy_analytics_computation_error_source_check`` (the domain)
#   * ``strategy_analytics_computation_error_markers_together_check`` (pairing)
# Both are declared in 20260906120000_computation_error_provenance.sql:317,:349.
_MARKER_CONSTRAINT_FRAGMENT: Final[str] = "strategy_analytics_computation_error_"

# PostgREST's OWN code (not a SQLSTATE) for "the schema cache does not know that
# column". It writes NOTHING and the whole payload is lost.
_PGRST_SCHEMA_CACHE_MISS: Final[str] = "PGRST204"

_MARKER_COLUMNS: Final[tuple[str, str]] = (PROVENANCE_SOURCE_KEY, PROVENANCE_JOB_ID_KEY)


def _refuses_a_marker(exc: APIError) -> bool:
    """Is ``exc`` the database refusing THESE two columns, specifically?

    Two ways it can, and they are unrelated failures with the same remedy:

      * ``23514`` — a marker CHECK constraint refused the VALUES (TODOS
        ``[PROV-WRITER-23514]``); matched by constraint name, see
        ``_MARKER_CONSTRAINT_FRAGMENT``.
      * ``PGRST204`` — PostgREST's schema cache does not know the COLUMNS yet,
        i.e. the worker is running ahead of migration
        ``20260906120000_computation_error_provenance.sql`` (164.2-REVIEW
        WR-02). Matched by the column name PostgREST puts in its own message:
        "Could not find the 'computation_error_source' column of
        'strategy_analytics' in the schema cache".

    False for every other failure on this table — a status CHECK, a
    serialization failure, a permission denial, and a ``PGRST204`` naming any
    OTHER column. The caller re-raises those untouched, which is the pre-164.2
    behaviour for all of them, and it is what keeps
    ``analytics_runner._mark_unrecoverable``'s own ``PGRST204`` arm (which owns
    ``computing_started_at``) reachable: that arm's error names its own column,
    so this predicate answers False and the exception reaches it exactly as
    before.
    """
    code = getattr(exc, "code", None)
    message = str(getattr(exc, "message", None) or "")
    if code == _PG_CHECK_VIOLATION:
        return _MARKER_CONSTRAINT_FRAGMENT in message
    if code == _PGRST_SCHEMA_CACHE_MISS:
        return any(column in message for column in _MARKER_COLUMNS)
    return False


def provenance_source(job_id: str | None) -> str | None:
    """``'writer'`` when a job id accompanies it, ``None`` when it does not.

    The pair is all-or-nothing because the pairing CHECK says so, and because a
    half-stamp is READ as an unstamped row anyway (``'writer' AND NULL = <uuid>``
    is NULL, so the bridge's CASE falls to its ELSE arm) — the constraint exists
    to turn that silent degrade into a loud one, and this function exists so the
    loud one never has to fire.

    ``None`` is not a failure mode: it is the BRIDGE-OR-LEGACY provenance value,
    and it reproduces the pre-164.2 behaviour exactly — the bridge writes its
    per-kind generic over the sentence, which is the correct answer for a
    failure that no compute job owns.
    """
    return PROVENANCE_SOURCE_WRITER if job_id is not None else None


def upsert_or_drop_provenance(
    payload: dict[str, Any],
    write: Callable[[], None],
    *,
    where: str,
) -> None:
    """Run ``write``; when the database refuses the MARKERS on a marker-bearing
    ``payload`` — a 23514 on one of their CHECK constraints, or a ``PGRST204``
    saying the columns are not in the schema cache yet — drop the markers and
    run it ONCE more.

    TODOS ``[PROV-WRITER-23514]``. Both marker CHECK constraints sit on the path
    that RECORDS A FAILURE, so a provenance bug must cost the provenance and not
    the failure record. Dropping both keys reproduces today's payload byte for
    byte: NULL markers, the bridge writes the per-kind generic, exactly as it did
    before this phase. The degrade is one-directional and it is the direction
    every unknown in this design resolves to.

    ⚠️ It cannot loop. The retry is issued at most once, from a payload that no
    longer carries either marker key, so it cannot raise the same violation
    again; if it raises anything at all the exception propagates to the caller's
    existing handler, unchanged.

    ⚠️ The 23514 is NOT swallowed for a payload that carries no marker — that
    would be a different constraint, and re-issuing an identical payload would
    be a silent infinite-retry-shaped no-op. It re-raises, which is the
    pre-164.2 behaviour for every other CHECK on this table.

    ⚠️ Nor is it swallowed for a 23514 whose constraint is not one of THIS
    module's (164.2-REVIEW WR-03). The payload half of that test is not enough:
    a status CHECK firing on a payload that happens to carry markers is still
    not a provenance bug, and stripping the provenance would neither fix it nor
    describe it. See ``_MARKER_CONSTRAINT_FRAGMENT``.

    ⭐ A ``PGRST204`` NAMING A MARKER COLUMN takes the same degrade (164.2-REVIEW
    WR-02), and this is the deploy-window mitigation for T-164.2-17 at every
    stamped site rather than at one of them. The migration must reach PROD before
    a worker sends the two new keys; in the window between the Railway deploy and
    the DDL, PostgREST answers ``PGRST204`` and WRITES NOTHING — so the payload
    that is lost is the one RECORDING A FAILURE, and the row sits at 'computing'
    until the 16-hour reaper while the wizard poller spins. Dropping the two
    unknown keys and re-issuing lands exactly the pre-164.2 payload. The phase's
    other argument (migrations auto-apply on merge, Railway deploys after main
    CI) is a property of the pipeline, not of this tree; this arm is the property
    of the tree.

    ⚠️ Any OTHER ``APIError`` propagates untouched, which is load-bearing at
    ``analytics_runner``'s catch-all exit: its enclosing handler catches a
    ``PGRST204`` naming ``computing_started_at`` and re-issues with the minimal
    key set PostgREST knew before THAT column existed. That arm must keep seeing
    its own error, and it does — ``_refuses_a_marker`` answers False for it. The
    two arms COMPOSE at that one site, in either order: PostgREST names ONE
    unknown column per response, so if it names a marker this arm strips the
    pair and the re-issue's own ``PGRST204`` (now naming ``computing_started_at``)
    propagates to that handler; if it names ``computing_started_at`` first this
    predicate is False and that handler runs immediately, re-issuing the five-key
    payload which carries no markers either way.
    """
    try:
        write()
    except APIError as exc:
        if not _refuses_a_marker(exc):
            raise
        if PROVENANCE_SOURCE_KEY not in payload and PROVENANCE_JOB_ID_KEY not in payload:
            raise
        payload.pop(PROVENANCE_SOURCE_KEY, None)
        payload.pop(PROVENANCE_JOB_ID_KEY, None)
        # ERROR, not warning: reaching this line means the database refused the
        # marker pair, which is either a writer bug (23514) or a worker running
        # ahead of its migration (PGRST204). The sentence below is the only
        # place either becomes visible, because the retry makes its user-visible
        # effect indistinguishable from the pre-164.2 world.
        #
        # ⚠️ The CODE is interpolated, never hardcoded. It used to read "(23514:
        # %s)" over a message that could only be a 23514; now two codes reach
        # here and they mean OPPOSITE things — a 23514 is a bug to chase, a
        # PGRST204 is a deploy window that closes itself when PostgREST reloads.
        # Naming the wrong one is the same class of misdiagnosis WR-03 fixed.
        logger.error(
            "strategy_analytics provenance: the database REFUSED the "
            "computation_error markers at %s (%s: %s). Re-issuing the same "
            "failure record WITHOUT provenance so the failure is still "
            "recorded; the status bridge will overwrite the curated sentence "
            "with its per-kind generic for this row (TODOS PROV-WRITER-23514). "
            "A PGRST204 here is the deploy window of migration "
            "20260906120000 and clears on its own; a 23514 does not.",
            where,
            getattr(exc, "code", None),
            exc.message or exc,
        )
        write()
