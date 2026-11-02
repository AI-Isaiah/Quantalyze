"""Phase 176 LEGACYRETIRE, plan 15 (D-02): no production string names a dropped object.

WHAT THIS REPLACES. ``tests/test_derive_allocator_equity_job.py`` carried a fake
PostgREST that raised the instant a compose touched the legacy
``allocator_equity_snapshots`` table (the derive-compose legacy-table guard). That guard covered
ONE handler through ONE fake, and after the table is dropped a fake refusing a table
that no longer exists guards nothing. This pin moves the same protection from one
fake to the whole service.

WHY IT MATTERS. A string naming a dropped table or function reaches PostgREST only at
run time, and on PROD it fails the job there (``PGRST205`` / ``PGRST202``). CI would
stay green. Scanning the source for the name moves that failure to CI.

WHAT IT SCANS. Every tracked ``.py`` file under ``services/``, ``routers/``,
``models/`` and ``scripts/`` plus the four entry points. The list comes from
``git ls-files``, so a new file is covered without an edit here. Within each file it
walks the AST and checks every string constant that is NOT a docstring (the first
statement of a module, class or function body); f-string literal parts count.

WHY CONSTANTS AND NOT COMMENTS. A comment and a docstring cannot reach PostgREST; only
a string value that flows into ``.table(...)`` / ``.rpc(...)`` or a query can. The
history of the retirement is rightly written in those places, so scanning prose would
force the explanation out of the code that most needs it.

DROPPED OBJECTS (migration ``20261104120000_drop_allocator_equity_snapshots.sql``):
the table, its ``replace_`` RPC, ``extract_symbol_value_at`` and the fan-out enqueue.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

ANALYTICS_ROOT = Path(__file__).resolve().parents[1]

# Substrings, so ``replace_allocator_equity_snapshots`` is also caught by the first
# entry; it is listed anyway so a failure message names the object that was meant.
DROPPED_OBJECTS = (
    "allocator_equity_snapshots",
    "replace_allocator_equity_snapshots",
    "extract_symbol_value_at",
    "enqueue_refresh_allocator_equity_for_all",
)

SCAN_PATHSPECS = (
    "services",
    "routers",
    "models",
    "scripts",
    "main.py",
    "main_worker.py",
    "main_worker_healthz.py",
    "sentry_init.py",
)


def _tracked_python_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--", *SCAN_PATHSPECS],
        cwd=ANALYTICS_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [ANALYTICS_ROOT / p for p in out.split("\0") if p.endswith(".py")]


def _docstring_constants(tree: ast.AST) -> set[int]:
    """ids of the Constant nodes that are module/class/function docstrings."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                ids.add(id(body[0].value))
    return ids


def _offences(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    docstrings = _docstring_constants(tree)
    rel = path.relative_to(ANALYTICS_ROOT)
    found: list[str] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in docstrings
        ):
            for name in DROPPED_OBJECTS:
                if name in node.value:
                    found.append(f"{rel}:{node.lineno} names {name!r}")
                    break
    return found


def test_no_production_string_names_a_dropped_object() -> None:
    files = _tracked_python_files()
    # The scan must be live: an empty or truncated list would pass vacuously.
    scanned = {str(p.relative_to(ANALYTICS_ROOT)) for p in files}
    assert "services/job_worker.py" in scanned, (
        "git ls-files did not list services/job_worker.py, so the scan is vacuous"
    )
    assert "main.py" in scanned and "main_worker.py" in scanned

    offences = [line for path in files for line in _offences(path)]
    assert not offences, (
        "production code names an object the Phase 176 drop migration removes; "
        "on PROD this fails the job at run time, not in CI:\n  " + "\n  ".join(offences)
    )
