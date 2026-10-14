"""Phase 167.1.2.1 RECONMARKER, plan 07 Task 3 (D-09): the attempt cap has three
copies, and this test keeps the Python one equal to the SQL one.

THE THREE COPIES. A key that still owes its history is enqueued by the daily
fan-out at most ``v_reconstruct_attempt_cap`` times (SQL, in
``enqueue_refresh_allocator_equity_for_all``), the worker's hold and its Sentry
event stop at ``HISTORY_RECONSTRUCT_ATTEMPT_CAP`` (this service), and the
"history could not be rebuilt" note reads ``HISTORY_RECONSTRUCT_ATTEMPT_CAP``
(``src/lib/constants.ts``). A comment does not keep three numbers equal; a test
does. The TypeScript half is ``src/__tests__/history-reconstruct-cap-twins.test.ts``.

Two pins, both of which must be able to fail:
  1. Python == the integer read from the NEWEST migration that declares
     ``v_reconstruct_attempt_cap`` (read as text, never typed here), so a later
     migration that moves the SQL cap reddens this test.
  2. Both == 5, hand-typed (D-09). The founder's number is typed on purpose: the
     SQL and Python sides could otherwise move together and no test would notice.

No migration declaring the constant is a loud failure, not a vacuous pass.
"""

from __future__ import annotations

import re
from pathlib import Path

from services.equity_reconstruction import HISTORY_RECONSTRUCT_ATTEMPT_CAP

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATIONS = _REPO_ROOT / "supabase" / "migrations"

# D-09, hand-typed: the founder's decision. NOT derived from either side.
_D09_CAP = 5

_DECL_RE = re.compile(
    r"v_reconstruct_attempt_cap\s+CONSTANT\s+integer\s*:=\s*(\d+)\s*;",
    re.IGNORECASE,
)


def _sql_cap() -> tuple[str, int]:
    """(file name, value) of the newest migration declaring the constant."""
    declaring: list[tuple[str, int]] = []
    for path in sorted(_MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        # A declaration quoted in a comment is not a declaration.
        code = "\n".join(
            line for line in text.splitlines() if not line.lstrip().startswith("--")
        )
        match = _DECL_RE.search(code)
        if match:
            declaring.append((path.name, int(match.group(1))))
    assert declaring, (
        f"no migration under {_MIGRATIONS} declares v_reconstruct_attempt_cap, so the "
        "SQL cap cannot be read and the Python cap is unpinned (a silent pass here "
        "would defeat the test)"
    )
    return declaring[-1]


def test_python_cap_equals_the_sql_cap() -> None:
    name, sql_cap = _sql_cap()
    assert HISTORY_RECONSTRUCT_ATTEMPT_CAP == sql_cap, (
        f"HISTORY_RECONSTRUCT_ATTEMPT_CAP is {HISTORY_RECONSTRUCT_ATTEMPT_CAP} but "
        f"v_reconstruct_attempt_cap in {name} is {sql_cap}. The fan-out stops "
        "enqueueing at the SQL value, so the worker's hold and its Sentry event "
        "would fire at a different attempt than the one that actually ends the retries."
    )


def test_the_cap_is_the_founders_five() -> None:
    name, sql_cap = _sql_cap()
    assert sql_cap == _D09_CAP, (
        f"v_reconstruct_attempt_cap in {name} is {sql_cap}; D-09 fixed it at {_D09_CAP}. "
        "Moving the cap is a decision, not an edit: change D-09 first, then all three copies."
    )
    assert HISTORY_RECONSTRUCT_ATTEMPT_CAP == _D09_CAP
