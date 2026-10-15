"""Phase 164.9.8.1 PYXDIST (SC-1, D-01): the ``shared_test_db`` xdist group is REAL.

``tests/conftest.py`` has declared, since Phase 97, that every test module which
reaches the lane database is pinned to one xdist group so those modules never
run concurrently on different workers. The declaration was not enough: the hook
that adds the marker ran AFTER xdist's own worker hook had already turned
markers into scheduling keys, so no nodeid ever got the ``@shared_test_db``
suffix and the live fence tests raced each other across workers (the Phase 97
flake).

WHY A SUBPROCESS, NOT ``iter_markers()`` OR ``--collect-only``
--------------------------------------------------------------
The marker is VISIBLE to ``iter_markers()`` and to ``--collect-only`` even when
xdist computed the scheduling key before the conftest added it, so an in-process
check is green over a group that never formed. Only the result lines of a real
distributed run (the ``@shared_test_db`` nodeid suffix and the worker id) prove
that the group exists. This test therefore launches a real ``-n 2 --dist
loadgroup`` child session and reads what a CI reader would read.

The child selection is three OFFLINE tests from a module the conftest sentinels
pin (the partition-column tests of the fence module), so no database is needed.
"""

from __future__ import annotations

import sys
from pathlib import Path

from tests.child_deadman import run_child

SERVICE_ROOT = Path(__file__).resolve().parents[1]

_CHILD_MODULE = "tests/test_compute_jobs_fencing.py"
_CHILD_SELECTION = "partition_columns"
_GROUP_SUFFIX = "@shared_test_db"


def _nodeid_of(result_line: str) -> str:
    """The ``tests/...`` token of a verbose result line, group suffix stripped."""
    token = next(t for t in result_line.split() if t.startswith("tests/"))
    return token.removesuffix(_GROUP_SUFFIX)


def test_shared_db_group_runs_on_one_worker_with_the_group_suffix() -> None:
    """Grouped modules carry the suffix, share ONE worker and keep serial order.

    Without the group, the live fence tests (which seed ``compute_jobs`` rows and
    claim through global RPCs) interleave across workers and one test's claim
    moves another's pending row. That is the Phase 97 flake, so this gate must
    fail whenever the marker stops landing before xdist reads it.
    """
    # The verdict is each child's exit code and output, never how long it took
    # (a child pytest session took 50-130 s under heavy load); `run_child` carries
    # only the shared DEADMAN, which names this test if a child hangs.
    distributed = run_child(
        "the shared_test_db xdist group forms and pins its tests to one worker "
        "(nested `-n 2 --dist loadgroup` session)",
        [
            sys.executable,
            "-m",
            "pytest",
            "-n",
            "2",
            "--dist",
            "loadgroup",
            "-v",
            "-p",
            "no:cacheprovider",
            "--no-cov",
            _CHILD_MODULE,
            "-k",
            _CHILD_SELECTION,
        ],
        cwd=SERVICE_ROOT,
    )
    assert distributed.returncode == 0, distributed.stdout + distributed.stderr

    result_lines = [
        line for line in distributed.stdout.splitlines() if line.startswith("[gw")
    ]
    # AIM: the run produced results. An empty list would pass every `all(...)`.
    assert len(result_lines) >= 3, distributed.stdout

    ungrouped = [line for line in result_lines if _GROUP_SUFFIX not in line]
    assert not ungrouped, (
        f"{len(ungrouped)} result line(s) lack the {_GROUP_SUFFIX} suffix, so the "
        f"group never formed under xdist:\n{distributed.stdout}"
    )

    workers = {line.split()[0] for line in result_lines}
    assert len(workers) == 1, (
        f"grouped tests ran on {sorted(workers)}, expected exactly one worker:\n"
        f"{distributed.stdout}"
    )

    serial = run_child(
        "the serial collection order the distributed run must reproduce",
        [
            sys.executable,
            "-m",
            "pytest",
            "--collect-only",
            "-q",
            "-p",
            "no:xdist",
            "-p",
            "no:cacheprovider",
            "--no-cov",
            _CHILD_MODULE,
            "-k",
            _CHILD_SELECTION,
        ],
        cwd=SERVICE_ROOT,
    )
    assert serial.returncode == 0, serial.stdout + serial.stderr
    collected = [line for line in serial.stdout.splitlines() if line.startswith("tests/")]

    assert [_nodeid_of(line) for line in result_lines] == collected, (
        "grouped tests did not run in serial collection order:\n"
        f"distributed:\n{distributed.stdout}\nserial collection:\n{serial.stdout}"
    )
