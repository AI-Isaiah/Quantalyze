"""Phase 142 (JOB-07) — the strategy_analytics stuck-`computing` reaper must
NEVER run on the worker's shared asyncio event loop.

Root cause this regression-proofs (WEDGE-01, v1.11 FLIP rollback): heavy
synchronous work on the shared loop froze the healthz heartbeat — the worker
went dark for ~12 minutes while the 90s auto-restart never fired because
``LAST_TICK_AT`` was stamped by the very loop that was wedged.

**Why this file is shaped the way it is.** The reaper lands in pg_cron BY
CONSTRUCTION (142-CONTEXT, "Reaper mechanism & scheduling"), so there is no
worker-loop code path to stall. That makes the naive behavioural form of this
gate — "drive a backlog, assert healthz stays 200" — *incapable of failing*: it
passes trivially, today and forever, for any implementation. A test that cannot
fail is not evidence. The gate therefore has two halves, and the teeth live in
the first plus the controls:

  * **STRUCTURAL (the enforceable property)** — no reaper identifier is
    reachable from the worker's dispatch surface. Comment-stripped token scan
    over the dispatch-reachable files, mirroring the established grep-gate style
    of ``tests/test_dark_path_deleted.py:23-118``. Paired with a scanner
    self-test so the gate is demonstrably capable of RED (a synthetic line
    bearing the cron jobname MUST be flagged), and an anti-vacuity assert so a
    broken path resolution cannot green-skip the whole file.
  * **BEHAVIOURAL + CONTROL PAIR** (``TestReaperOffWorkerLoopBehavior``, below)
    — a real healthz TCP probe against the real deployed server, plus the
    falsifier that gives the 200 meaning: the same work run BLOCKING
    (``time.sleep``) starves the probe and freezes ``LAST_TICK_AT``, while the
    YIELDING twin (``asyncio.sleep``) stays fast and green. The pair differs in
    exactly one token, so it pins the PROPERTY (blocking vs yielding), not an
    implementation detail.

**Honesty bound** (research §JOB-07; ``main_worker.py:637-641``): the heartbeat
catches a LOOP-BLOCKING freeze (a non-yielding await / CPU spin / deadlock). It
does NOT catch a YIELDING single-job hang — a dead upstream we keep awaiting
leaves the loop alive, so healthz stays green. That case is backstopped by the
per-kind outer ``wait_for`` and the DB watchdog re-claim, NOT by healthz. No
assertion in this file may be read as covering it.

Second direction (JOB-02 hygiene): the superseded one-off
``scripts/reset_stuck_computing_rows.py`` is DELETED in this phase and must stay
deleted — it is broken code, not a reference implementation (142-RESEARCH C-5).
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Forbidden tokens — LOCAL literals, deliberately never a shared constant.
# ---------------------------------------------------------------------------
# Nothing in production Python may know these names. Importing them from a
# shared module would defeat the gate twice over: the import site would itself
# be a reachable reference, and the scan would then be comparing the surface
# against a value the surface supplies.
#
#   * REAPER_CRON_JOBNAME — the pg_cron job created by plan 142-04's migration.
#     Its presence anywhere on the dispatch surface means reaper work was wired
#     onto the worker loop (the WEDGE-01 regression).
#   * DELETED_ONE_OFF_STEM — the superseded script; guards resurrection.
REAPER_CRON_JOBNAME = "reap_strategy_analytics_stuck_computing"
DELETED_ONE_OFF_STEM = "reset_stuck_computing_rows"
FORBIDDEN_TOKENS = (REAPER_CRON_JOBNAME, DELETED_ONE_OFF_STEM)


# ---------------------------------------------------------------------------
# Scan helpers — same idioms as tests/test_dark_path_deleted.py:37-95.
# ---------------------------------------------------------------------------


def _repo_root() -> Path:
    """The monorepo root — the first ancestor containing BOTH ``src/`` and
    ``analytics-service/``. Resolved by walking up so the scan works from the
    ``analytics-service`` pytest cwd and in CI."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "src").is_dir() and (parent / "analytics-service").is_dir():
            return parent
    raise RuntimeError(
        "could not locate the repo root (an ancestor with both src/ and "
        "analytics-service/)"
    )


def _strip_comment(line: str, *, lang: str = "py") -> bool:
    """True when ``line`` is a pure comment for its language (grep-gate
    hygiene: a docstring/comment mentioning a token must neither trip nor
    satisfy the gate)."""
    stripped = line.lstrip()
    if lang == "py":
        return stripped.startswith("#")
    return stripped.startswith("//") or stripped.startswith("*")


def _count_in_text(text: str, token: str, *, lang: str = "py") -> int:
    """Comment-stripped occurrences of ``token`` in ``text``.

    Split out from :func:`_count` so the scanner itself can be exercised
    against synthetic in-memory source — see
    ``test_scanner_flags_a_synthetic_reaper_identifier``. Without that
    self-test the structural gate's GREEN would be unfalsifiable.
    """
    return sum(
        line.count(token)
        for line in text.splitlines()
        if not _strip_comment(line, lang=lang)
    )


def _count(path: Path, token: str, *, lang: str = "py") -> int:
    """Comment-stripped occurrences of ``token`` in ``path``."""
    if not path.exists():
        return 0
    return _count_in_text(path.read_text(), token, lang=lang)


def _py_scan_files() -> list[Path]:
    """The worker's DISPATCH-REACHABLE Python surface: the runner + worker +
    cron entrypoints plus a full walk of ``routers/`` and ``scripts/``. Any
    wiring of reaper work onto the shared event loop would land in one of
    these (same file list as ``test_dark_path_deleted._py_scan_files``)."""
    svc = _repo_root() / "analytics-service"
    files: list[Path] = [
        svc / "services" / "analytics_runner.py",
        svc / "services" / "job_worker.py",
        svc / "routers" / "cron.py",
        svc / "main_worker.py",
        svc / "main.py",
    ]
    for sub in ("routers", "scripts"):
        files.extend(sorted((svc / sub).rglob("*.py")))
    # dedupe (cron.py is also under the routers walk) while preserving the
    # explicit entrypoints, and keep only files that exist.
    seen: set[Path] = set()
    scan: list[Path] = []
    for f in files:
        rf = f.resolve()
        if rf in seen or not rf.exists():
            continue
        seen.add(rf)
        scan.append(rf)
    return scan


# ---------------------------------------------------------------------------
# STRUCTURAL — the reaper identifier is unreachable from the worker surface.
# ---------------------------------------------------------------------------


def test_no_reaper_identifier_on_worker_surface() -> None:
    """ZERO comment-stripped occurrences of the reaper cron jobname (or the
    deleted one-off's module stem) anywhere on the dispatch-reachable Python
    surface.

    This is the JOB-07 property in its enforceable form. The reaper is a
    pg_cron-scheduled SQL function in a separate failure domain; the moment any
    of its identifiers becomes reachable from ``dispatch_tick``, someone has
    started running janitor work on the money-pipeline worker's shared loop —
    the WEDGE-01 class. Failure message names file:line per hit so the
    offending wiring is findable without re-grepping.
    """
    scan = _py_scan_files()
    # Anti-vacuity (S-5): a broken _repo_root/rglob would return [] and every
    # assert below would pass over nothing.
    assert scan, "the py scan found no files — path resolution is broken"
    assert any(f.name == "main_worker.py" for f in scan), (
        "the scan surface must include main_worker.py (the dispatch_tick "
        "entrypoint); without it the gate cannot see the loop it guards"
    )

    offenders: list[str] = []
    for path in scan:
        text = path.read_text()
        for lineno, line in enumerate(text.splitlines(), start=1):
            if _strip_comment(line):
                continue
            for token in FORBIDDEN_TOKENS:
                if token in line:
                    offenders.append(f"{path}:{lineno}: {token}")

    assert not offenders, (
        "JOB-07 violated: a reaper identifier is reachable from the worker's "
        "dispatch surface. The strategy_analytics stuck-`computing` reaper runs "
        "in pg_cron precisely so no janitor work can block the shared asyncio "
        "event loop (WEDGE-01). Move it back to pg_cron:\n"
        + "\n".join(offenders)
    )


def test_scanner_flags_a_synthetic_reaper_identifier() -> None:
    """Positive control for the structural gate: the scanner MUST flag a
    synthetic source line that wires the reaper jobname onto the worker, and
    MUST NOT flag a comment that merely mentions it.

    Without this, ``test_no_reaper_identifier_on_worker_surface`` green could
    mean either "the property holds" or "the scanner is broken/never matches".
    This is the SC-4 structural half proving it is capable of RED.
    """
    violating_source = (
        "async def dispatch_tick(worker_id):\n"
        f'    await run_cron_job("{REAPER_CRON_JOBNAME}")\n'
    )
    assert _count_in_text(violating_source, REAPER_CRON_JOBNAME) == 1, (
        "the scanner failed to flag a synthetic line wiring the reaper jobname "
        "into dispatch_tick — the structural gate cannot fail, so its GREEN is "
        "worthless"
    )

    commented_source = (
        f"# the reaper is pg_cron-only: {REAPER_CRON_JOBNAME}\n"
        "async def dispatch_tick(worker_id):\n"
        "    return None\n"
    )
    assert _count_in_text(commented_source, REAPER_CRON_JOBNAME) == 0, (
        "grep-gate hygiene broken: a pure comment mentioning the jobname must "
        "neither trip nor satisfy the gate"
    )

    # Same two directions for the deleted-script stem, so a resurrection guard
    # that silently stopped matching is caught too.
    assert (
        _count_in_text(f'    subprocess.run(["python", "-m", "scripts.{DELETED_ONE_OFF_STEM}"])\n', DELETED_ONE_OFF_STEM)
        == 1
    )
    assert _count_in_text(f"    # {DELETED_ONE_OFF_STEM}\n", DELETED_ONE_OFF_STEM) == 0


def test_superseded_one_off_stays_deleted() -> None:
    """``analytics-service/scripts/reset_stuck_computing_rows.py`` stays deleted.

    It is NOT a working reference implementation. It selects and filters on
    ``updated_at`` — a column ``strategy_analytics`` does not have — so under
    PostgREST it raises SQLSTATE 42703 and reaps nothing (142-RESEARCH C-5).
    Its user-facing message ("interrupted during platform upgrade") is a false,
    dated cause, and it never clears ``computation_warned``, so a row it *did*
    reach could launder through the status bridge into
    ``complete_with_warnings`` — a false success on a money surface.

    The pg_cron reaper introduced by this phase's migration supersedes it. If
    the script is ever recreated, this assert is the loud stop.
    """
    svc = _repo_root() / "analytics-service"
    rel = f"scripts/{DELETED_ONE_OFF_STEM}.py"
    assert not (svc / rel).exists(), (
        f"{rel} was recreated — it must stay deleted: it filters on a "
        "non-existent `updated_at` column (42703), misattributes the cause, and "
        "omits the `computation_warned = FALSE` clear. The pg_cron reaper "
        "supersedes it; do not resurrect the one-off."
    )
