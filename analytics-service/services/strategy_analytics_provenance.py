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
cost of the provenance, never the other way round.

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
    """Run ``write``; on a 23514 against a marker-bearing ``payload``, drop the
    markers and run it ONCE more.

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

    ⚠️ Any OTHER ``APIError`` propagates untouched, which is load-bearing at
    ``analytics_runner``'s catch-all exit: its enclosing handler catches
    ``PGRST204`` (the schema-cache miss of the deploy window) and re-issues with
    the minimal key set PostgREST knew before these columns existed. That arm
    must keep seeing its own error.
    """
    try:
        write()
    except APIError as exc:
        if getattr(exc, "code", None) != _PG_CHECK_VIOLATION:
            raise
        if PROVENANCE_SOURCE_KEY not in payload and PROVENANCE_JOB_ID_KEY not in payload:
            raise
        payload.pop(PROVENANCE_SOURCE_KEY, None)
        payload.pop(PROVENANCE_JOB_ID_KEY, None)
        # ERROR, not warning: reaching this line means a writer emitted a marker
        # pair the database refused, which is a bug report. The sentence below
        # is the only place that bug becomes visible, because the retry makes
        # its user-visible effect indistinguishable from the pre-164.2 world.
        logger.error(
            "strategy_analytics provenance: the database REFUSED the "
            "computation_error markers at %s (23514: %s). Re-issuing the same "
            "failure record WITHOUT provenance so the failure is still "
            "recorded; the status bridge will overwrite the curated sentence "
            "with its per-kind generic for this row (TODOS PROV-WRITER-23514).",
            where,
            exc.message or exc,
        )
        write()
