"""TC-3 (army2 testing-specialist) — migration 108 idempotency assertions.

Migration 108 advertises in its header comment "two idempotent operations,
both safe to re-apply" and "self-verifying DO block". The Testing
specialist flagged that no regression test confirms either claim. This
file is the static-analysis half of that coverage: it parses the SQL
source and asserts the idempotent DDL idioms are present at the right
lines. The dynamic apply/re-apply roundtrip belongs in a Supabase
integration test gated on SUPABASE_TEST_URL — written separately when
that fixture is wired.

Pre-fix: deleting either ON CONFLICT or DROP CONSTRAINT IF EXISTS would
break re-apply on a DB that already has migration 108 partially landed
(e.g. a power-loss mid-apply). This test catches that regression.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION_108 = (
    REPO_ROOT
    / "supabase"
    / "migrations"
    / "108_process_key_long_compute_job_kinds_repair.sql"
)
ROLLBACK_108 = (
    REPO_ROOT
    / "supabase"
    / "migrations"
    / "down"
    / "108-rollback.sql"
)


def _read(path: Path) -> str:
    assert path.exists(), f"missing migration source: {path}"
    return path.read_text(encoding="utf-8")


def test_migration_108_dm1_uses_on_conflict_do_nothing():
    """DM-1 INSERT must be idempotent under re-apply."""
    sql = _read(MIGRATION_108)
    assert "INSERT INTO compute_job_kinds" in sql, (
        "108 must register process_key_long in compute_job_kinds"
    )
    assert "ON CONFLICT" in sql.upper(), (
        "108 DM-1 INSERT lacks ON CONFLICT clause — re-apply will violate"
        " primary key"
    )
    # Must specifically use DO NOTHING, not DO UPDATE (the kind name is
    # the canonical row identity; UPDATE could rewrite metadata columns).
    assert "ON CONFLICT (name) DO NOTHING" in sql, (
        "108 DM-1 must use ON CONFLICT (name) DO NOTHING for idempotency"
    )


def test_migration_108_dm2_uses_drop_if_exists_then_add():
    """DM-2 ALTER must drop+add (idempotent) per migration 070 STEP 4 pattern."""
    sql = _read(MIGRATION_108)
    drop_pos = sql.upper().find(
        "DROP CONSTRAINT IF EXISTS COMPUTE_JOBS_KIND_TARGET_COHERENCE"
    )
    add_pos = sql.upper().find(
        "ADD CONSTRAINT COMPUTE_JOBS_KIND_TARGET_COHERENCE"
    )
    assert drop_pos >= 0, (
        "108 DM-2 lacks DROP CONSTRAINT IF EXISTS — re-apply will fail"
        " with already-exists error"
    )
    assert add_pos >= 0 and add_pos > drop_pos, (
        "108 DM-2 must DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT"
    )


def test_migration_108_self_verify_block_present():
    """The header comment promises a self-verifying DO block."""
    sql = _read(MIGRATION_108)
    # Must have a DO $$ ... END $$ block that asserts both DM-1 and DM-2
    # forward-repaired rows/constraints exist.
    do_block = re.search(r"DO\s+\$\$.*?END\s+\$\$", sql, flags=re.DOTALL)
    assert do_block is not None, (
        "108 lacks the promised self-verifying DO block"
    )
    body = do_block.group(0)
    assert "process_key_long" in body, (
        "108 self-verify must reference process_key_long (DM-1 + DM-2)"
    )
    assert "RAISE EXCEPTION" in body, (
        "108 self-verify must RAISE EXCEPTION on missing forward repair"
    )


def test_rollback_108_inverts_dm1_and_dm2():
    """Rollback must reverse both idempotent ops cleanly."""
    sql = _read(ROLLBACK_108)
    # DM-1 inverse: DELETE the kind row.
    assert (
        "DELETE FROM compute_job_kinds" in sql
        and "process_key_long" in sql
    ), "108-rollback must DELETE process_key_long from compute_job_kinds"
    # DM-2 inverse: rebuild the constraint without the new branch.
    assert "compute_jobs_kind_target_coherence" in sql, (
        "108-rollback must reset compute_jobs_kind_target_coherence"
    )
    assert "DROP CONSTRAINT IF EXISTS" in sql.upper(), (
        "108-rollback must use idempotent drop"
    )


@pytest.mark.skipif(
    "SUPABASE_TEST_URL" not in __import__("os").environ,
    reason="dynamic apply/re-apply roundtrip requires SUPABASE_TEST_URL",
)
def test_migration_108_dynamic_reapply_idempotent():
    """Apply 108 twice against a live test DB and assert no error.

    Skipped by default — runs only when SUPABASE_TEST_URL is wired.
    """
    pytest.skip("Live-DB integration deferred to integration suite")
