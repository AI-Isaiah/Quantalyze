"""F-4 sweep <-> fixture drift gate (IN-10, CR-2 root cause).

The F-4 memberKeyIds re-stamp lives as THREE byte-consistent copies of the same
``has_series`` EXISTS predicate:

  1. the production sweep RESTAMP  — scripts/sweeps/f4-memberkeyids-restamp.sql
  2. the fixture RESTAMP copy      — supabase/tests/test_scenario_downgrade_sweep.sql
  3. the fixture idempotency copy  — supabase/tests/test_scenario_downgrade_sweep.sql

CR-2 existed BECAUSE the 730-day date window was added to the runtime
(queries.ts:2577) but not mirrored into these three inlined copies, and nothing
forced them to agree. A predicate can silently drift in ONE copy — e.g. someone
tightens the window in the sweep but forgets the fixture, so CI keeps passing
against a fixture that no longer matches what runs in prod.

This test extracts the ``has_series`` predicate from all three sites (comments
stripped, whitespace normalized) and asserts they are IDENTICAL. It is the CI
gate that kills that drift class at the root — if any copy diverges, this fails
loudly with the mismatched texts.

Pure-stdlib, I/O-free (reads two repo files); no DB, no ccxt. Runs in the fast
analytics-service pytest job.
"""

from __future__ import annotations

import re
from pathlib import Path

# analytics-service/tests/ -> repo root is parents[2].
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SWEEP = _REPO_ROOT / "scripts" / "sweeps" / "f4-memberkeyids-restamp.sql"
_FIXTURE = _REPO_ROOT / "supabase" / "tests" / "test_scenario_downgrade_sweep.sql"

# EXISTS ( SELECT 1 FROM csv_daily_returns ... ) AS has_series
# Anchored on the csv_daily_returns SELECT so a stray `EXISTS (` that might
# appear in prose is never a false start (comments are stripped first anyway).
_PREDICATE_RE = re.compile(
    r"EXISTS\s*\(\s*(SELECT\s+1\s+FROM\s+csv_daily_returns.*?)\)\s*AS\s+has_series",
    re.DOTALL | re.IGNORECASE,
)
_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_WS_RE = re.compile(r"\s+")


def _normalized_predicates(path: Path) -> list[str]:
    """Return every has_series predicate in `path`, comments stripped and
    whitespace collapsed to a single space."""
    text = path.read_text()
    # Strip SQL line comments FIRST — the sweep/fixture headers reference
    # `EXISTS (SELECT 1 ...)` in prose, which would otherwise be a false match.
    text = _LINE_COMMENT_RE.sub("", text)
    return [
        _WS_RE.sub(" ", block).strip()
        for block in _PREDICATE_RE.findall(text)
    ]


def test_sweep_and_fixture_has_series_predicates_are_identical() -> None:
    sweep_preds = _normalized_predicates(_SWEEP)
    fixture_preds = _normalized_predicates(_FIXTURE)

    # The sweep has exactly ONE RESTAMP predicate; the fixture inlines it TWICE
    # (RESTAMP + idempotency re-run). If these counts change, the extraction or
    # the files drifted structurally — fail so a human re-checks the gate.
    assert len(sweep_preds) == 1, (
        f"expected exactly 1 has_series predicate in the sweep, found "
        f"{len(sweep_preds)}: {sweep_preds!r}"
    )
    assert len(fixture_preds) == 2, (
        f"expected exactly 2 has_series predicates in the fixture, found "
        f"{len(fixture_preds)}: {fixture_preds!r}"
    )

    all_preds = sweep_preds + fixture_preds
    distinct = set(all_preds)
    assert len(distinct) == 1, (
        "F-4 sweep <-> fixture has_series predicate DRIFT detected — the three "
        "inlined copies must be byte-consistent (this is the CR-2 root cause). "
        f"Distinct variants:\n" + "\n".join(f"  - {p!r}" for p in sorted(distinct))
    )

    # Belt-and-braces: the 730-day window (CR-2) and the finite filter (WR-01)
    # must both be present — a predicate that agrees across copies but drops
    # either bound would still be wrong in all three.
    the_pred = distinct.pop()
    assert "730 days" in the_pred, "730-day date window (CR-2) missing from predicate"
    assert "'NaN'::float8" in the_pred, "NaN finite filter (WR-01) missing from predicate"
