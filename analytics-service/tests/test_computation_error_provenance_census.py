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
    migration header's census says why neither needs a marker of its own;
  * ⛔ P1 — ``job_worker.run_sync_trades_job._mark_analytics_failed`` — is IN
    the class and is deliberately UNSTAMPED (164.2-REVIEW WR-01). Its handler
    returns ``DispatchOutcome.DONE``, so the bridge reaches it on branch (c),
    which clears the sentence and both markers unconditionally: a marker there
    is never read by any branch that consults one. It is counted separately
    (``EXPECTED_INERT_SITES``) rather than left in the stamped total, because a
    census that counts it as stamped is asserting a protection that does not
    exist — which was the finding. See ``PROVENANCE_INERT_KEYS``.

⚠️ SO A GREEN HERE DOES NOT MEAN "these sentences survive". It means each of
them carries a well-formed marker pair. Whether a given marker is ever READ
depends on which bridge branch the writer's dispatch outcome routes to, and
that is a property of ``main_worker``'s outcome mapping, not of this file. P1
is the site where those two things came apart.

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
from pathlib import Path
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

# ---------------------------------------------------------------------------
# P1 — the INERT carve-out (164.2-REVIEW WR-01)
# ---------------------------------------------------------------------------
# ``job_worker.run_sync_trades_job._mark_analytics_failed``. It writes a curated
# sentence and it is DELIBERATELY UNSTAMPED, because a marker there is read by
# nobody: the handler returns ``DispatchOutcome.DONE`` (the trades persisted),
# ``main_worker.py:929`` maps DONE to ``mark_compute_job_done``, and that RPC's
# ``PERFORM sync_strategy_analytics_status`` finds every job terminal-done and
# takes branch (c) — which writes 'complete', a NULL sentence, NULL markers and
# a fresh ``computed_at``, unconditionally. Stamping it asserts a protection
# that does not exist, which is the false claim the review found.
#
# The erasure itself is PRE-EXISTING (the 161.1 F1 class) and correcting it is
# booked in TODOS.md as ``[SYNCTRADES-ENQUEUE-DONE]``; the writer's own comment
# records why F1's FAILED-instead-of-DONE remedy does not transfer to a
# ``sync_trades`` job. When that lands, this site is re-stamped and this
# carve-out is DELETED — and it cannot be forgotten, because re-stamping moves
# the site out of this signature and takes the count below to 0.
#
# ⭐ IDENTIFIED BY EXACT KEY SET *and* FILE, matching the JOB-01 census's own
# carve-out (``_is_stamp_omission_exempt``), and the file half is load-bearing
# here rather than decoration: ``analytics_runner._upsert_restore`` (P6) carries
# exactly these five keys plus the two markers, so a P6 that lost its markers
# would collapse onto this signature. With the file pin it lands in Rule A's
# defect list by name instead. MEASURED inside ``job_worker.py`` itself, where
# the pin does not help: no other writer there can collapse onto this signature
# — P2 has three keys, and P3/P4/P5 all carry ``data_quality_flags``.
PROVENANCE_INERT_FILE: Final[str] = "job_worker.py"
PROVENANCE_INERT_KEYS: Final[frozenset[str]] = frozenset(
    {
        "strategy_id",
        "computation_status",
        "computation_warned",
        "computing_started_at",
        "computation_error",
    }
)

# Hand-typed floors. A new writer must update this census AND stamp, rather than
# slide in under a green gate.
#    9 stamped — analytics_runner P6-P10 (_upsert_restore, _mark_failed,
#      _mark_truncated, _mark_config_failed, _mark_unrecoverable) and job_worker
#      P2-P5 (the derive guard's _upsert_error_only and _upsert, the composite
#      guard's _upsert_error_only and _upsert).
#    1 exempt — P11.
#    1 inert — P1, see the block above. This was the tenth STAMPED site until
#      164.2-REVIEW WR-01 measured its stamp unreadable.
#    2 resets — analytics_runner._mark_complete and job_worker's composite
#      headline_payload, the two success writers that blank the sentence.
EXPECTED_STAMPED_SITES: Final[int] = 9
EXPECTED_EXEMPT_SITES: Final[int] = 1
EXPECTED_INERT_SITES: Final[int] = 1
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


def _is_inert(site: _WriteSite) -> bool:
    """P1 — the writer whose stamp no bridge branch can read (WR-01)."""
    return (
        site.path.name == PROVENANCE_INERT_FILE
        and _payload_keys(site.payload) == PROVENANCE_INERT_KEYS
    )


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


# ---------------------------------------------------------------------------
# Rule C — the stamped literal's write must go THROUGH the retry helper (IN-04)
# ---------------------------------------------------------------------------
# Before 164.2-REVIEW WR-02 this was unpinned and harmless: the helper only
# caught a 23514, and `provenance_source` had already closed the reachable 23514
# at the root, so deleting the wrapper at any of the sites changed nothing a
# test could see. WR-02 made it LOAD-BEARING — it now also carries the PGRST204
# deploy-window degrade for the two columns this phase added — and an unpinned
# routing is then exactly the "arm that cannot fail" class this phase exists to
# remove: `upsert_or_drop_provenance(_x_payload, _write_x, ...)` could be
# replaced by a bare `_write_x()` at any site and every other gate stays green.
#
# The rule is structural, and it is the same shape as Rule A: the FIRST
# POSITIONAL argument must be the very name the payload literal is bound to.
# Passing some other dict would type-check, run, and silently degrade nothing.
_ROUTING_HELPER: Final[str] = "upsert_or_drop_provenance"

_Span = tuple[int, int]


def _span(node: ast.AST) -> _Span:
    """(first line, last line) of a node. Used to re-find a payload literal in a
    SECOND parse of the same file, since the census's scan and this rule do not
    share a tree and node identity therefore cannot be relied on."""
    return (getattr(node, "lineno", 0), getattr(node, "end_lineno", 0) or 0)


def _enclosing_function(
    tree: ast.AST, span: _Span
) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    """The INNERMOST function whose body contains ``span``.

    Innermost matters: the payload of P1-style writers is assigned in a closure
    (``_mark_x``) that ALSO calls the helper, while the actual ``.upsert(...)``
    sits one level deeper in a second closure (``_write_x``). Anchoring on the
    deepest function would look for the helper in the wrong scope; anchoring on
    the outermost would accept a helper call from an unrelated sibling arm.
    """
    best: ast.FunctionDef | ast.AsyncFunctionDef | None = None
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        end = node.end_lineno or 0
        if node.lineno <= span[0] and end >= span[1]:
            if best is None or node.lineno > best.lineno:
                best = node
    return best


def _bound_name(scope: ast.AST, span: _Span) -> str | None:
    """The name the dict literal at ``span`` is assigned to inside ``scope``."""
    for node in ast.walk(scope):
        if isinstance(node, ast.AnnAssign):
            if (
                node.value is not None
                and _span(node.value) == span
                and isinstance(node.target, ast.Name)
            ):
                return node.target.id
        elif isinstance(node, ast.Assign) and _span(node.value) == span:
            for target in node.targets:
                if isinstance(target, ast.Name):
                    return target.id
    return None


def _routing_defect(tree: ast.AST, payload_span: _Span) -> str | None:
    """``None`` when the payload at ``payload_span`` is handed to the helper."""
    scope = _enclosing_function(tree, payload_span)
    if scope is None:
        return (
            f"the stamped payload is not inside a function, so its routing "
            f"through {_ROUTING_HELPER} cannot be read. {_ROUTING_HELPER} takes "
            f"the write as a CALLABLE, which requires a closure."
        )
    name = _bound_name(scope, payload_span)
    if name is None:
        return (
            f"the stamped payload is not bound to a name in "
            f"{scope.name!r}, so nothing can be passed to {_ROUTING_HELPER}. "
            f"The helper MUTATES the payload it is given, so it must receive "
            f"the same dict object the write closure reads."
        )
    for node in ast.walk(scope):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == _ROUTING_HELPER
            and node.args
            and isinstance(node.args[0], ast.Name)
            and node.args[0].id == name
        ):
            return None
    return (
        f"{name} is stamped but {scope.name!r} never passes it to "
        f"{_ROUTING_HELPER}. The write then has NO deploy-window degrade: a "
        f"PGRST204 naming a marker column (the window before migration "
        f"20260906120000 reaches PROD) loses the whole failure record, because "
        f"PostgREST writes nothing on a schema-cache miss — the row is left at "
        f"'computing' until the 16-hour reaper (164.2-REVIEW WR-02 / IN-04)."
    )


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
    both markers, decided by one expression — except P11, exempt by exact shape,
    and P1, inert by exact shape and file.

    Rule B. Every literal that BLANKS the sentence blanks both markers.

    Rule C (164.2-REVIEW IN-04). Every STAMPED literal is handed to
    ``upsert_or_drop_provenance`` by name, in the function that binds it.
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

    trees: dict[Path, ast.Module] = {}
    defects: list[str] = []
    routing: list[str] = []
    routed_count = 0
    for site in sites:
        where = f"{_rel(site.path)}:{site.lineno}"
        if _is_none(_dict_value(site.payload, _ERROR_KEY)):
            problem = _reset_defect(site)
        elif _is_exempt(site) or _is_inert(site):
            continue
        else:
            problem = _pairing_defect(site)
            if problem is None:
                # Rule C, stamped sites only. P11 writes its re-issue directly
                # BY DESIGN (a helper there would re-send the unknown columns)
                # and P1 has nothing to degrade; both are skipped above.
                if site.path not in trees:
                    trees[site.path] = ast.parse(
                        site.path.read_text(encoding="utf-8")
                    )
                routed_count += 1
                routed = _routing_defect(trees[site.path], _span(site.payload))
                if routed is not None:
                    routing.append(f"{where}: {routed}")
        if problem is not None:
            defects.append(f"{where}: {problem}")

    assert not defects, (
        "computation_error provenance is missing or malformed at:\n  "
        + "\n  ".join(defects)
        + "\nEvery Python writer of strategy_analytics.computation_error must "
        "decide computation_error_source and computation_error_job_id in the "
        "SAME dict literal as the sentence (Phase 164.2 / criterion 2)."
    )
    assert not routing, (
        "these stamped writers do not route their write through "
        f"{_ROUTING_HELPER}:\n  " + "\n  ".join(routing)
    )
    assert routed_count == EXPECTED_STAMPED_SITES, (
        f"Rule C was evaluated at {routed_count} sites, not "
        f"{EXPECTED_STAMPED_SITES}. `assert not routing` is satisfied VACUOUSLY "
        f"by a rule that never ran, so the count of EVALUATIONS is pinned "
        f"beside the count of sites — a guard rearrangement that skips Rule C "
        f"reddens here instead of reporting green over nothing."
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

    writes = [s for s in sites if not _is_none(_dict_value(s.payload, _ERROR_KEY))]
    stamped = [s for s in writes if not _is_exempt(s) and not _is_inert(s)]
    exempt = [s for s in writes if _is_exempt(s)]
    inert = [s for s in writes if _is_inert(s)]
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
    assert len(inert) == EXPECTED_INERT_SITES, (
        f"expected exactly {EXPECTED_INERT_SITES} INERT writer (P1, "
        f"job_worker._mark_analytics_failed — see 164.2-REVIEW WR-01), found "
        f"{len(inert)}:\n  " + _where(inert)
        + "\n0 means P1 was re-stamped (or removed) without deleting this "
        "carve-out. If TODOS [SYNCTRADES-ENQUEUE-DONE] has landed and the "
        "handler now returns FAILED on that path, that is CORRECT — delete "
        "PROVENANCE_INERT_* and raise EXPECTED_STAMPED_SITES back to 10 in the "
        "same commit. If it has not landed, a stamp there is a protection that "
        "branch (c) erases one RPC later.\n2 means a SECOND writer in "
        f"{PROVENANCE_INERT_FILE} lost its markers and collapsed onto P1's "
        "signature — a defect being absorbed by a carve-out meant for one site."
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


def test_the_inert_carve_out_is_matched_by_shape_and_can_still_fire() -> None:
    """P1's carve-out (WR-01) has the same anti-vacuity duty as P11's, plus one
    more: it must not be widened into an excuse for a writer that COULD be read.

    Two halves, and the second is the one that makes the first mean something:
    the signature is pinned by value, and the classifier is exercised against
    hand-built payloads so its green over the live tree is falsifiable without
    editing the live tree.
    """
    assert PROVENANCE_INERT_KEYS == frozenset(
        {
            "strategy_id",
            "computation_status",
            "computation_warned",
            "computing_started_at",
            "computation_error",
        }
    ), (
        "P1's signature moved. Widening it excuses writers whose markers WOULD "
        "be read — the carve-out is scoped to the one site measured unreadable."
    )
    assert _SOURCE_KEY not in PROVENANCE_INERT_KEYS
    assert _JOB_ID_KEY not in PROVENANCE_INERT_KEYS
    assert PROVENANCE_INERT_KEYS != PROVENANCE_EXEMPT_KEYS, (
        "the two carve-outs must stay distinguishable: P11 omits "
        "computing_started_at and carries data_quality_flags, P1 the reverse"
    )

    def _site(file_name: str, source: str) -> _WriteSite:
        payload = ast.parse(source, mode="eval").body
        assert isinstance(payload, ast.Dict)
        return _WriteSite(Path(f"/synthetic/{file_name}"), 1, payload, "n1")

    p1_shape = (
        '{"strategy_id": s, "computation_status": "failed",'
        ' "computation_warned": False, "computing_started_at": None,'
        ' "computation_error": "boom"}'
    )
    assert _is_inert(_site(PROVENANCE_INERT_FILE, p1_shape)), (
        "the classifier no longer recognises P1's own shape — the live count "
        "below would then be 0 for the wrong reason"
    )
    assert not _is_inert(_site("analytics_runner.py", p1_shape)), (
        "the FILE half is load-bearing: analytics_runner._upsert_restore (P6) "
        "carries exactly these five keys plus the markers, so an unstamped P6 "
        "must land in Rule A's defects by name, not vanish into P1's carve-out"
    )
    assert not _is_inert(
        _site(
            PROVENANCE_INERT_FILE,
            '{"strategy_id": s, "computation_status": "failed",'
            ' "computation_warned": False, "computing_started_at": None,'
            ' "computation_error": "boom", "data_quality_flags": f}',
        )
    ), "one extra key must COLLAPSE the carve-out, never widen it"


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


def test_rule_c_fires_on_a_writer_that_skips_the_retry_helper() -> None:
    """Self-test for Rule C (164.2-REVIEW IN-04), on the SAME real shape.

    Rule C's green over the live tree is worth nothing unless it can go red, and
    "remove the helper at a real site and watch it red" is a neuter, not a test.
    These four modules are the live writers' shape — payload bound in a closure,
    the ``.upsert(...)`` one closure deeper — put through the same functions:

      1. routed correctly            → None
      2. helper deleted, bare write  → RED, and it names the payload
      3. helper called with the WRONG dict → RED (an arg check, not a name-in-
         the-file check; ``in`` on the source text would pass this)
      4. payload inlined at the write, bound to nothing → RED
    """

    def _defect(source: str) -> str | None:
        tree = ast.parse(source)
        payloads = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Dict)
            and any(
                isinstance(k, ast.Constant) and k.value == _ERROR_KEY
                for k in node.keys
            )
        ]
        assert len(payloads) == 1, f"fixture must hold one payload, got {payloads!r}"
        return _routing_defect(tree, _span(payloads[0]))

    _WRITE = (
        '            supabase.table("strategy_analytics").upsert(\n'
        "                p, on_conflict=\"strategy_id\"\n"
        "            ).execute()\n"
    )

    routed = (
        "def handler():\n"
        "    def mark():\n"
        '        p = {"computation_error": "boom",\n'
        '             "computation_error_source": provenance_source(j),\n'
        '             "computation_error_job_id": j}\n'
        "        def write():\n" + _WRITE + '        upsert_or_drop_provenance(p, write, where="x")\n'
    )
    assert _defect(routed) is None, _defect(routed)

    bare = (
        "def handler():\n"
        "    def mark():\n"
        '        p = {"computation_error": "boom",\n'
        '             "computation_error_source": provenance_source(j),\n'
        '             "computation_error_job_id": j}\n'
        "        def write():\n" + _WRITE + "        write()\n"
    )
    problem = _defect(bare) or ""
    assert _ROUTING_HELPER in problem and problem.startswith("p is stamped"), problem

    wrong_dict = (
        "def handler():\n"
        "    def mark():\n"
        '        p = {"computation_error": "boom",\n'
        '             "computation_error_source": provenance_source(j),\n'
        '             "computation_error_job_id": j}\n'
        "        def write():\n" + _WRITE + '        upsert_or_drop_provenance(other, write, where="x")\n'
    )
    assert _ROUTING_HELPER in (_defect(wrong_dict) or ""), (
        "the helper MUTATES the dict it is given; passing a different one "
        "degrades nothing, so the FIRST ARGUMENT is the whole rule"
    )

    unbound = (
        "def handler():\n"
        "    def mark():\n"
        '        supabase.table("strategy_analytics").upsert(\n'
        '            {"computation_error": "boom",\n'
        '             "computation_error_source": provenance_source(j),\n'
        '             "computation_error_job_id": j}\n'
        "        ).execute()\n"
    )
    assert "not bound to a name" in (_defect(unbound) or "")
