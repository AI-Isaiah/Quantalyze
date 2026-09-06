"""Phase 164.2 / criterion 2 — every Python ``strategy_analytics`` failure writer
stamps ``computation_error`` PROVENANCE in the same statement as the sentence.

Migration ``20260906120000_computation_error_provenance.sql`` made
``sync_strategy_analytics_status`` CONDITIONAL: branches (b) and (b-prime) keep
an existing ``computation_error`` only when the row carries
``computation_error_source = 'writer'`` AND ``computation_error_job_id`` equal to
the job the transition is resolving; otherwise they overwrite it with the
per-kind generic, exactly as they always did. So a curated sentence that is not
stamped is STILL replaced seconds later — **the SQL half can only respect
provenance the writers actually set**, which is why criterion 2 says a SQL-only
fix is not accepted.

A writer that sets ``computation_error`` without the marker is therefore the
failure mode this census catches: delete the two keys from ONE literal and the
census names that ``file:line`` and goes RED.

────────────────────────────────────────────────────────────────────────────
THIS FILE IS NOT THE WHOLE INVARIANT
────────────────────────────────────────────────────────────────────────────
It is the PYTHON half, and it is STATIC. Three other things carry the rest, and
a green here over a red there is a false pass:

  * the SQL half — ``supabase/tests/test_sync_status_curated_copy_survives.sql``
    (plan 07) drives a real ``compute_jobs`` row through ``mark_compute_job_
    failed`` and asserts the curated sentence SURVIVES the transition. Inspecting
    the bridge body was explicitly refused as evidence;
  * the TABLE — the ``BEFORE UPDATE`` trigger
    ``strategy_analytics_drop_stale_error_provenance`` drops both markers from
    any statement that CHANGES the sentence without restating them, which is what
    makes the six repo-wide writers that blank the sentence correct without being
    edited. A static census cannot see a trigger;
  * the RUNTIME — ``tests/test_computation_error_provenance_fallback.py`` proves
    the two marker CHECK constraints cannot cost a failure record (TODOS
    ``[PROV-WRITER-23514]``). This census reads shapes; that one reads behaviour.

────────────────────────────────────────────────────────────────────────────
WHO IS IN THE CLASS, AND WHO IS DELIBERATELY NOT
────────────────────────────────────────────────────────────────────────────
The class is the Python writers of ``strategy_analytics.computation_error``.
Thirteen readable dict literals: eleven that write a sentence and two that blank
one. Named exclusions, each because a marker there would be read by nobody or
would assert something false:

  * ``routers/portfolio.py`` writes ``portfolio_analytics``, which HAS NO BRIDGE
    (``20260826120000:240`` records that there isn't one). It is out of the class
    by TABLE, not by exemption — this census never sees it, because the scan is
    keyed on ``.table("strategy_analytics")``. Stated here because the phase's
    CONTEXT.md originally listed it as a writer to stamp and RESEARCH refuted
    that (correction 4);
  * the FOUR TypeScript pre-enqueue writers (``finalize-wizard`` ×2,
    ``csv-finalize``, ``keys/sync``) all write BEFORE a compute job exists.
    Branch (a) blanks the column when the job starts, and that is correct: their
    sentence describes a state the new computation supersedes;
  * the pg_cron reaper and ``set_wizard_composite_members`` are SQL, and the
    migration header's census says why neither needs a marker of its own.

────────────────────────────────────────────────────────────────────────────
THE SHAPE RULE, AND WHY IT IS NOT "the source must be the string 'writer'"
────────────────────────────────────────────────────────────────────────────
The migration puts a pairing CHECK on the two columns —
``(source IS NULL) = (job_id IS NULL)`` — and that CHECK sits on the
FAILURE-RECORDING path. ``run_csv_strategy_analytics``'s ``job_id`` parameter
DEFAULTS to None for its three non-job callers, so a literal ``"writer"`` typed
beside ``"computation_error_job_id": job_id`` emits ``('writer', NULL)`` on every
one of those calls, raises 23514, and loses the failure record entirely.

So Rule A demands the two markers be decided by ONE expression: the source must
be ``provenance_source(<X>)`` where ``<X>`` is byte-for-byte the same expression
written into ``computation_error_job_id``. That is the half-stamp made
inexpressible at a call site, checked structurally, and it is strictly stronger
than checking for a constant the constraint would have to reject at runtime.
:func:`tests.test_computation_error_provenance_fallback.
test_provenance_source_is_all_or_nothing` binds that shape to the VALUE it
produces, so this file's static rule cannot pass over a helper that returns the
wrong thing.
"""
from __future__ import annotations

import ast
from typing import Final

# D-10: the scan surface is single-sourced. This census walks exactly the files
# every other static gate in this repo walks, so a services/ module added
# tomorrow is covered on the day it lands.
from tests._scan_helpers import _py_scan_files, _rel

# The AST resolver, the payload helpers and the JOB-01 exempt key set are
# imported from the sibling census rather than re-implemented. That is
# deliberate and it is the D-10 lesson applied again: the last time a scan
# helper was copy-pasted the copies diverged into three different file lists and
# one of them reported green over a shrunken surface. Two censuses that disagree
# about what a "write site" is would be the same defect in a new place.
from tests.test_computing_started_at_stamp import (  # noqa: PLC2701
    _STAMP_OMISSION_EXEMPT_KEYS,
    _dict_value,
    _has_key,
    _is_none,
    _payload_keys,
    _scan_python,
    _WriteSite,
)

_ERROR_KEY: Final[str] = "computation_error"
_SOURCE_KEY: Final[str] = "computation_error_source"
_JOB_ID_KEY: Final[str] = "computation_error_job_id"

# The helper every stamped literal must route its source through. Matched by
# NAME in the AST — the value it returns is pinned behaviourally in
# tests/test_computation_error_provenance_fallback.py, which is where a value
# assertion belongs.
_SOURCE_HELPER: Final[str] = "provenance_source"

# P11 — ``analytics_runner._mark_unrecoverable``'s D-02/R2 re-issue, the payload
# PostgREST accepts while its schema cache predates the newest column on this
# table. It is marker-free ON PURPOSE: this phase adds TWO new columns, so
# naming them in the re-issue would defeat the arm on the very deploy window it
# exists for, and the already-failed job would leave its row 'computing'
# forever. Losing provenance there costs the curated sentence and nothing else.
#
# ⭐ IDENTIFIED BY EXACT KEY SET, never by file or function name, and IMPORTED
# from the JOB-01 census rather than re-typed — the two gates exempt the SAME
# payload for related reasons, and a second hand-typed copy could drift into
# exempting a payload the other one still polices. The shape match is safe in
# both directions: delete the re-issue and the exempt count falls to 0 (a dead
# carve-out reddens); strip the markers off the compliant SIBLING payload in the
# same function and its key set collapses onto this signature, taking the count
# to 2 (the defect reddens here instead of being absorbed).
PROVENANCE_EXEMPT_KEYS: Final[frozenset[str]] = _STAMP_OMISSION_EXEMPT_KEYS

# Hand-typed floors. A new writer must update this census AND stamp, rather than
# slide in under a green gate.
#   10 stamped — analytics_runner P6-P10 (_upsert_restore, _mark_failed,
#      _mark_truncated, _mark_config_failed, _mark_unrecoverable) and job_worker
#      P1-P5 (_mark_analytics_failed, the derive guard's _upsert_error_only and
#      _upsert, the composite guard's _upsert_error_only and _upsert).
#    1 exempt — P11.
#    2 resets — analytics_runner._mark_complete and job_worker's composite
#      headline_payload, the two success writers that blank the sentence.
EXPECTED_STAMPED_SITES: Final[int] = 10
EXPECTED_EXEMPT_SITES: Final[int] = 1
EXPECTED_RESET_SITES: Final[int] = 2


def _error_sites(sites: list[_WriteSite]) -> list[_WriteSite]:
    """Every readable ``strategy_analytics`` write literal naming the sentence.

    Note this is a DIFFERENT filter from the JOB-01 census's ``kept``, which
    keys on ``computation_status``. Two of the sites here carry no status at all
    — the D-15 ``_upsert_error_only`` pair, which record a failure WITHOUT
    downgrading a funded account's publish state — and they are exactly the
    writers whose sentence is the entire explanation the account holder gets.
    """
    return [s for s in sites if _has_key(s.payload, _ERROR_KEY)]


def _is_exempt(site: _WriteSite) -> bool:
    return _payload_keys(site.payload) == PROVENANCE_EXEMPT_KEYS


def _pairing_defect(site: _WriteSite) -> str | None:
    """``None`` when the literal's two markers are decided by ONE expression."""
    source = _dict_value(site.payload, _SOURCE_KEY)
    job_id = _dict_value(site.payload, _JOB_ID_KEY)
    if source is None or job_id is None:
        missing = [
            k
            for k in (_SOURCE_KEY, _JOB_ID_KEY)
            if not _has_key(site.payload, k)
        ]
        return (
            f"writes {_ERROR_KEY} but the literal is missing {missing!r}. The "
            f"marker must be in the SAME dict as the sentence: a marker written "
            f"by a separate statement is dropped by the BEFORE UPDATE trigger "
            f"strategy_analytics_drop_stale_error_provenance, and an unstamped "
            f"sentence is overwritten by the bridge's per-kind generic."
        )
    if not (
        isinstance(source, ast.Call)
        and isinstance(source.func, ast.Name)
        and source.func.id == _SOURCE_HELPER
        and len(source.args) == 1
        and not source.keywords
    ):
        return (
            f"{_SOURCE_KEY} is {ast.dump(source)!r}, not a "
            f"{_SOURCE_HELPER}(<job id>) call. The two markers must be decided "
            f"by one expression — a literal 'writer' beside a job id that can be "
            f"None emits ('writer', NULL), which "
            f"strategy_analytics_computation_error_markers_together_check "
            f"rejects with 23514 ON THE FAILURE-RECORDING PATH."
        )
    if ast.dump(source.args[0]) != ast.dump(job_id):
        return (
            f"{_SOURCE_KEY} is derived from {ast.dump(source.args[0])!r} but "
            f"{_JOB_ID_KEY} is {ast.dump(job_id)!r}. Two different expressions "
            f"can disagree, which is the half-stamp the pairing CHECK exists to "
            f"reject; they must be the SAME expression."
        )
    return None


def _reset_defect(site: _WriteSite) -> str | None:
    """``None`` when a sentence-blanking literal blanks both markers too."""
    for key in (_SOURCE_KEY, _JOB_ID_KEY):
        if not _has_key(site.payload, key):
            return (
                f"blanks {_ERROR_KEY} but never names {key}. A marker left "
                f"standing over a NULLed sentence is read by "
                f"sync_strategy_analytics_status as a writer's claim over text "
                f"that is gone: branch (b) keeps the 'existing sentence' — NULL "
                f"— and the row renders computation_status='failed' with no "
                f"sentence at all."
            )
        if not _is_none(_dict_value(site.payload, key)):
            return (
                f"blanks {_ERROR_KEY} but writes a non-None {key}, which claims "
                f"provenance for a sentence that no longer exists."
            )
    return None


def test_python_failure_writers_stamp_provenance() -> None:
    """Rule A. Every ``strategy_analytics`` literal that WRITES a sentence carries
    both markers, decided by one expression — except P11, exempt by exact shape.

    Rule B. Every literal that BLANKS the sentence blanks both markers.
    """
    files = _py_scan_files()
    assert files, "the python scan found no files — path resolution is broken"

    scan = _scan_python(files)
    sites = _error_sites(scan.all_sites)
    assert sites, (
        "the python scan resolved zero computation_error payloads — the scan "
        "surface or the chain-scope rule is broken. It must find the "
        "analytics_runner and job_worker failure writers; a census that stopped "
        "looking reports green over nothing."
    )

    defects: list[str] = []
    for site in sites:
        where = f"{_rel(site.path)}:{site.lineno}"
        if _is_none(_dict_value(site.payload, _ERROR_KEY)):
            problem = _reset_defect(site)
        elif _is_exempt(site):
            continue
        else:
            problem = _pairing_defect(site)
        if problem is not None:
            defects.append(f"{where}: {problem}")

    assert not defects, (
        "computation_error provenance is missing or malformed at:\n  "
        + "\n  ".join(defects)
        + "\nEvery Python writer of strategy_analytics.computation_error must "
        "decide computation_error_source and computation_error_job_id in the "
        "SAME dict literal as the sentence (Phase 164.2 / criterion 2)."
    )


def test_provenance_census_counts() -> None:
    """Anti-vacuity. EXACT counts, hand-typed, so a NEW writer forces a conscious
    update of this census instead of sliding in under a green Rule A.

    Rule A above is satisfied VACUOUSLY by an empty class, and by a class that
    silently shrank. These three counters are what make its green mean something:
    they fail on a site that disappeared, on a site that stopped being readable,
    and on a compliant site that was quietly absorbed into the P11 exemption.
    """
    scan = _scan_python(_py_scan_files())
    sites = _error_sites(scan.all_sites)

    stamped = [
        s
        for s in sites
        if not _is_none(_dict_value(s.payload, _ERROR_KEY)) and not _is_exempt(s)
    ]
    exempt = [
        s
        for s in sites
        if not _is_none(_dict_value(s.payload, _ERROR_KEY)) and _is_exempt(s)
    ]
    resets = [s for s in sites if _is_none(_dict_value(s.payload, _ERROR_KEY))]

    def _where(group: list[_WriteSite]) -> str:
        return "\n  ".join(f"{_rel(s.path)}:{s.lineno}" for s in group)

    assert len(stamped) == EXPECTED_STAMPED_SITES, (
        f"expected exactly {EXPECTED_STAMPED_SITES} STAMPED python "
        f"computation_error writers, found {len(stamped)}:\n  " + _where(stamped)
    )
    assert len(exempt) == EXPECTED_EXEMPT_SITES, (
        f"expected exactly {EXPECTED_EXEMPT_SITES} EXEMPT writer (P11, the "
        f"D-02/R2 schema-cache-miss re-issue), found {len(exempt)}:\n  "
        + _where(exempt)
        + "\n0 means the exemption is dead — delete it rather than leave a "
        "carve-out covering nothing. 2 means a compliant sibling payload lost "
        "its markers and collapsed onto P11's key set, which is a DEFECT being "
        "absorbed by a carve-out that was only ever meant to cover one write."
    )
    assert len(resets) == EXPECTED_RESET_SITES, (
        f"expected exactly {EXPECTED_RESET_SITES} success writers that blank "
        f"computation_error, found {len(resets)}:\n  " + _where(resets)
    )


def test_the_exempt_payload_is_matched_by_shape_not_by_name() -> None:
    """The exemption's own anti-vacuity. It must key on the KEY SET, so that
    adding a key to P11 collapses the exemption instead of widening it.

    Without this, ``PROVENANCE_EXEMPT_KEYS`` could drift into a superset that
    quietly excuses a real writer, and every test above would stay green.
    """
    assert PROVENANCE_EXEMPT_KEYS == frozenset(
        {
            "strategy_id",
            "computation_status",
            "computation_warned",
            "computation_error",
            "data_quality_flags",
        }
    ), (
        "P11's exempt signature moved. It is the FIVE keys PostgREST knew before "
        "20260802120000 added computing_started_at; the marker columns are "
        "deliberately absent. Widening this set excuses writers it was never "
        "meant to cover."
    )
    assert _SOURCE_KEY not in PROVENANCE_EXEMPT_KEYS
    assert _JOB_ID_KEY not in PROVENANCE_EXEMPT_KEYS


def test_the_rules_fire_on_synthetic_defects() -> None:
    """Self-test. Rule A and Rule B are exercised against hand-built payloads, so
    their green over the live tree is falsifiable without editing the live tree.

    The four cases are the four ways a writer has actually gone wrong on this
    column: forgetting a key, typing the constant instead of deriving it,
    deriving it from a DIFFERENT expression than the one written into the job id,
    and leaving a marker standing over a blanked sentence.
    """

    def _site(source: str) -> _WriteSite:
        payload = ast.parse(source, mode="eval").body
        assert isinstance(payload, ast.Dict)
        return _WriteSite(_py_scan_files()[0], 1, payload, "literal")

    good = _site(
        '{"computation_error": "boom",'
        ' "computation_error_source": provenance_source(job_id),'
        ' "computation_error_job_id": job_id}'
    )
    assert _pairing_defect(good) is None

    missing = _site('{"computation_error": "boom"}')
    assert "missing" in (_pairing_defect(missing) or "")

    constant = _site(
        '{"computation_error": "boom",'
        ' "computation_error_source": "writer",'
        ' "computation_error_job_id": job_id}'
    )
    assert "not a provenance_source" in (_pairing_defect(constant) or "")

    mismatched = _site(
        '{"computation_error": "boom",'
        ' "computation_error_source": provenance_source(other_id),'
        ' "computation_error_job_id": job_id}'
    )
    assert "the SAME expression" in (_pairing_defect(mismatched) or "")

    good_reset = _site(
        '{"computation_error": None,'
        ' "computation_error_source": None,'
        ' "computation_error_job_id": None}'
    )
    assert _reset_defect(good_reset) is None

    stale_marker = _site(
        '{"computation_error": None,'
        ' "computation_error_source": provenance_source(job_id),'
        ' "computation_error_job_id": job_id}'
    )
    assert "no longer exists" in (_reset_defect(stale_marker) or "")

    half_reset = _site('{"computation_error": None, "computation_error_source": None}')
    assert "never names computation_error_job_id" in (_reset_defect(half_reset) or "")
