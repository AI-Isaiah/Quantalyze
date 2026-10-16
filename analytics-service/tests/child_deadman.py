"""One shared deadman for the tests that run a child Python process.

Why this module exists (Phase 164.9.8.1 review round 4, WR-01)
--------------------------------------------------------------
Several tests spawn a fresh interpreter (or a nested pytest session) because the
property under test is only observable in a clean process. Their verdict is the
child's exit code and output, never how long it took, so none of them carries a
PERFORMANCE bound: a child pytest session took 50-130 s under starved runners and
any tight number is a bet on CPU speed.

But a child with no bound at all turns a genuine hang into an anonymous
90-minute CI cancellation (or an endless local hang) whose log ends in a row of
dots with no test id and no child output. ``CHILD_DEADMAN_S`` is the answer: a
deadman set an order of magnitude above the worst case ever observed, so it
cannot fire on a slow-but-working child, and when it does fire the test fails
with its purpose named and whatever the child had printed so far.

⛔ This is NOT a stopwatch and must never be tightened to "make the test fast".
It decides nothing about correctness; it only converts "hung" into a named failure.
"""

from __future__ import annotations

import subprocess
from typing import Sequence

import pytest

# ~14x the ~130 s worst case measured under a starved runner.
CHILD_DEADMAN_S = 1800


def _text(partial: str | bytes | None) -> str:
    """``TimeoutExpired`` carries ``bytes`` even when the call used ``text=True``."""
    if partial is None:
        return "<none>"
    if isinstance(partial, bytes):
        return partial.decode("utf-8", errors="replace")
    return partial


def run_child(
    purpose: str,
    args: Sequence[str],
    *,
    cwd: object,
) -> subprocess.CompletedProcess[str]:
    """``subprocess.run`` with captured text output and the shared deadman.

    ``purpose`` names what the child is proving, so a hang reads as a sentence
    about the test and not as an anonymous timeout.
    """
    try:
        return subprocess.run(
            list(args),
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
            timeout=CHILD_DEADMAN_S,
        )
    except subprocess.TimeoutExpired as exc:
        pytest.fail(
            f"child process hung past the {CHILD_DEADMAN_S} s deadman while "
            f"proving: {purpose}. This is a deadman, not a performance bound: "
            f"the child was still running after {CHILD_DEADMAN_S} s, far above "
            "any slow-but-working run.\n"
            f"partial stdout={_text(exc.stdout)!r}\n"
            f"partial stderr={_text(exc.stderr)!r}"
        )
