"""Shared source-scan helpers for the repo's static grep/AST gates (D-10).

Before this module existed, ``_repo_root`` was copy-pasted verbatim into four
test files, the comment-detection helper into five under **two** names, and
``_py_scan_files`` into three files with **three DIFFERENT file lists**. That
last divergence was the actual defect: ``test_computing_started_at_stamp``
walked all of ``services/`` while ``test_job07_reaper_off_worker_loop`` and
``test_dark_path_deleted`` cherry-picked two files out of it — and
``test_job07``'s docstring *claimed parity* with ``test_dark_path_deleted``
while asserting it covered "any wiring of reaper work". Consequence: reaper
work landing in any ``services/`` module the two narrow copies did not name by
hand was INVISIBLE to the JOB-07 structural gate, which kept reporting green
over a shrunken surface. That is the same silent-narrowing failure mode as
D-04 — a gate that still passes because it stopped looking, not because the
property holds.

⚠️ No file list here is written by hand: the ``services/``, ``routers/`` and
``scripts/`` surfaces are ``rglob`` walks, deliberately, so a newly-added
module is covered on the day it lands rather than on the day someone
remembers to extend a literal.

One definition, one surface, one place to widen when the repo layout moves.

Import style (repo idiom — ``tests/__init__.py`` exists and ``pytest.ini``
sets ``pythonpath = .``; precedents: ``tests/test_c19_portfolio_fixes.py:29``
importing ``tests.limiter_stub`` and ``tests/test_e2_seam_ledger.py:40``
importing ``tests.e2_fixtures``)::

    from tests._scan_helpers import _py_scan_files, _repo_root

⛔ Deliberately NOT folded in here, because they are different functions that
merely look similar:

  * ``tests/test_job_worker_flipretry.py:278`` ``_strip_comments`` (plural) —
    whole-text → ``str``, not line → ``bool``.
  * ``tests/test_main_worker.py:2174-2185`` and
    ``tests/test_f4_sweep_fixture_parity.py:31`` resolve the repo root as
    ``Path(__file__).resolve().parents[2]`` — a different mechanism reaching
    the same result. Folding them silently would hide that difference.
"""

from __future__ import annotations

from pathlib import Path


def _repo_root() -> Path:
    """The monorepo root — the first ancestor containing BOTH ``src/`` and
    ``analytics-service/``. Resolved by walking up so the scan works from the
    ``analytics-service`` pytest cwd and in CI.

    ⚠️ ``Path(__file__)`` resolves relative to **this** module. Every donor of
    this function lived in ``analytics-service/tests/``, which is exactly where
    this module lives, so the walk-up distance is unchanged by the extraction.
    Moving this file to a different directory depth would silently change what
    every consumer scans.
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / "src").is_dir() and (parent / "analytics-service").is_dir():
            return parent
    raise RuntimeError(
        "could not locate the repo root (an ancestor with both src/ and "
        "analytics-service/)"
    )


def _rel(path: Path) -> str:
    """``path`` relative to the repo root, for readable failure messages."""
    try:
        return str(path.relative_to(_repo_root()))
    except ValueError:  # pragma: no cover - defensive
        return str(path)


def _is_pure_comment(line: str, *, lang: str = "py") -> bool:
    """True when ``line`` is a pure comment for its language.

    Grep-gate hygiene (PATTERNS S-1): a docstring/comment mentioning a token
    must neither trip nor satisfy the gate. LOAD-BEARING for the TypeScript
    half of ``test_computing_started_at_stamp`` —
    ``src/app/api/keys/sync/route.ts`` mentions ``computation_status:'failed'``
    inside a block comment.

    ⚠️ Named ``_is_pure_comment``, not ``_strip_comment``. Three of the four
    donor copies used the latter name, but it is a lie: this returns ``bool``
    and strips nothing. ``test_computing_started_at_stamp.py`` had already
    renamed it honestly; the conflict is resolved in favour of the honest name
    rather than averaged (CONTEXT C-7 / "surface the conflict").
    """
    stripped = line.lstrip()
    if lang == "py":
        return stripped.startswith("#")
    return stripped.startswith("//") or stripped.startswith("*")


def _count_in_text(text: str, token: str, *, lang: str = "py") -> int:
    """Comment-stripped occurrences of ``token`` in ``text``.

    Split out from :func:`_count` so the scanner itself can be exercised
    against synthetic in-memory source — see
    ``test_job07_reaper_off_worker_loop.test_scanner_flags_a_synthetic_reaper_identifier``.
    Without that self-test the structural gates' GREEN would be unfalsifiable.
    """
    return sum(
        line.count(token)
        for line in text.splitlines()
        if not _is_pure_comment(line, lang=lang)
    )


def _count(path: Path, token: str, *, lang: str = "py") -> int:
    """Comment-stripped occurrences of ``token`` in ``path`` (0 if absent)."""
    if not path.exists():
        return 0
    return _count_in_text(path.read_text(), token, lang=lang)


def _py_scan_files() -> list[Path]:
    """The live Python surface every static gate in this repo scans: the two
    entrypoints plus a full walk of ``services/``, ``routers/`` and
    ``scripts/``.

    This is the **union** of the three divergent lists it replaces
    (``{main_worker.py, main.py} ∪ services/** ∪ routers/** ∪ scripts/**``) —
    it is a strict superset of the two narrow copies, which cherry-picked
    ``services/analytics_runner.py`` and ``services/job_worker.py`` out of the
    ``services/`` walk. The subtree walk is deliberate: no gate may hand-list
    the ``services/`` files it happens to know about today, because the next
    module added there would be invisible while the gate still reported green.
    """
    svc = _repo_root() / "analytics-service"
    files: list[Path] = [svc / "main_worker.py", svc / "main.py"]
    for sub in ("services", "routers", "scripts"):
        files.extend(sorted((svc / sub).rglob("*.py")))
    # dedupe (the explicit entrypoints can also fall under a walk) while
    # preserving order, and keep only files that exist.
    seen: set[Path] = set()
    scan: list[Path] = []
    for f in files:
        rf = f.resolve()
        if rf in seen or not rf.exists():
            continue
        seen.add(rf)
        scan.append(rf)
    return scan
