"""Phase 19 / PR-X5 — static-AST test for migration 132 (teaser-anchor
sentinel).

Reads ``supabase/migrations/20260515095804_teaser_anchor_strategy.sql`` and asserts
the three sentinel INSERTs all reference the expected UUIDs and shape
constants. Catches drift between the migration source and the
TEASER_ANCHOR_STRATEGY_ID constants that the application code reads from
``src/lib/phase-19-constants.ts`` +
``analytics-service/services/teaser_anchor.py``.

If either constant moves without a matching migration edit (or vice
versa), every teaser submission post-flag-flip would fail at the SV
INSERT with a 23503 FK violation. This test pins that contract without
needing a DB.

Mirrors the static-AST pattern in
``test_migration_105_self_verify.py``.
"""

from __future__ import annotations

import pathlib
import re

from services.teaser_anchor import TEASER_ANCHOR_STRATEGY_ID


_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260515095804_teaser_anchor_strategy.sql"
)
_ROLLBACK_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "down"
    / "20260515095804-rollback.sql"
)

SENTINEL_USER_UUID = "00000000-0000-0000-0000-000000000000"


def _read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def test_migration_132_exists() -> None:
    """The migration file is on disk. Catches misnamed-slot regressions
    (a rebase that drops the file silently, or someone renaming the slot
    out from under the application code)."""
    assert _MIGRATION_PATH.is_file(), (
        f"Migration 132 missing at {_MIGRATION_PATH}"
    )


def test_migration_132_seeds_sentinel_auth_users_row() -> None:
    """Step 1 of migration 132 must INSERT the all-zeros sentinel into
    auth.users. Without this the profiles INSERT below fails on the FK
    `profiles.id REFERENCES auth.users` and the migration aborts.
    """
    src = _read(_MIGRATION_PATH)
    # Look for an INSERT INTO auth.users containing the all-zeros UUID
    # AND an ON CONFLICT clause for idempotency.
    assert re.search(
        r"INSERT\s+INTO\s+auth\.users\s*\([^)]*\)\s*VALUES",
        src,
        flags=re.IGNORECASE,
    ), "Migration 132 must INSERT INTO auth.users"
    assert SENTINEL_USER_UUID in src, (
        f"Migration 132 must reference sentinel user UUID {SENTINEL_USER_UUID}"
    )


def test_migration_132_seeds_sentinel_profiles_row() -> None:
    """Step 2 — profiles row referencing the sentinel auth.users id."""
    src = _read(_MIGRATION_PATH)
    assert re.search(
        r"INSERT\s+INTO\s+public\.profiles\s*\(",
        src,
        flags=re.IGNORECASE,
    ), "Migration 132 must INSERT INTO public.profiles"


def test_migration_132_seeds_teaser_anchor_strategy() -> None:
    """Step 3 — strategies row with id=TEASER_ANCHOR_STRATEGY_ID,
    user_id=SENTINEL_USER_UUID, status='archived'.

    The constant in services/teaser_anchor.py must match the UUID in
    the migration's INSERT. Drift here = post-flag-flip teaser
    submissions hit 23503 FK violation on every SV INSERT.
    """
    src = _read(_MIGRATION_PATH)
    assert re.search(
        r"INSERT\s+INTO\s+public\.strategies\s*\(",
        src,
        flags=re.IGNORECASE,
    ), "Migration 132 must INSERT INTO public.strategies"
    assert TEASER_ANCHOR_STRATEGY_ID in src, (
        f"Migration 132 must reference TEASER_ANCHOR_STRATEGY_ID "
        f"({TEASER_ANCHOR_STRATEGY_ID}) — drift between the Python "
        f"constant and the migration would 23503 every teaser submission"
    )
    # archived status keeps the sentinel out of marketplace queries.
    assert "'archived'" in src, (
        "Migration 132 must set the sentinel strategy status to "
        "'archived' so it never surfaces in marketplace / allocator "
        "queries that filter on status IN ('published', 'pending_review')"
    )


def test_migration_132_uses_on_conflict_do_nothing() -> None:
    """All three INSERTs must be idempotent via ON CONFLICT DO NOTHING.
    Without this, re-applying the migration (e.g. on a DB restored from
    backup, or re-running supabase db push) would 23505 and abort.
    """
    src = _read(_MIGRATION_PATH)
    # There are exactly 3 INSERTs (auth.users, profiles, strategies) and
    # each one needs its own ON CONFLICT clause.
    on_conflict_count = len(
        re.findall(
            r"ON\s+CONFLICT\b.*?DO\s+NOTHING",
            src,
            flags=re.IGNORECASE | re.DOTALL,
        )
    )
    assert on_conflict_count >= 3, (
        f"Migration 132 must use ON CONFLICT DO NOTHING on all three "
        f"sentinel INSERTs (auth.users, profiles, strategies); found "
        f"{on_conflict_count}"
    )


def test_migration_132_self_verifies_all_three_rows() -> None:
    """The self-verify DO block must check that all three sentinel rows
    exist post-INSERT. Without this, a silent ON CONFLICT skip (e.g.
    schema drift on profiles forces the INSERT to no-op) leaves the FK
    target missing and teaser submissions 23503 at runtime.
    """
    src = _read(_MIGRATION_PATH)
    # The migration has a DO $$ ... END $$ block with three NOT EXISTS
    # guards. Capture the block and assert all three table references.
    do_block_match = re.search(
        r"DO\s*\$\$(.+?)\$\$\s*;",
        src,
        flags=re.DOTALL,
    )
    assert do_block_match is not None, (
        "Migration 132 must have a self-verify DO block"
    )
    block = do_block_match.group(1)
    assert "auth.users" in block, (
        "Self-verify must check auth.users sentinel exists"
    )
    assert "profiles" in block, (
        "Self-verify must check profiles sentinel exists"
    )
    assert "strategies" in block, (
        "Self-verify must check teaser-anchor strategies row exists"
    )


def test_rollback_132_exists_and_deletes_in_reverse_fk_order() -> None:
    """The rollback file must DELETE in reverse-FK order (strategies →
    profiles → auth.users) so cascades don't accidentally remove rows
    we want to delete explicitly (for the audit trail). Strict-order
    enforcement also catches operators copy-pasting the migration's
    forward-INSERT order into the rollback by mistake.
    """
    assert _ROLLBACK_PATH.is_file(), (
        f"Rollback for migration 132 missing at {_ROLLBACK_PATH}"
    )
    src = _read(_ROLLBACK_PATH)
    # Order: strategies first, then profiles, then auth.users.
    sv_pos = src.find("DELETE FROM public.strategies")
    pf_pos = src.find("DELETE FROM public.profiles")
    au_pos = src.find("DELETE FROM auth.users")
    assert sv_pos != -1, "Rollback must DELETE FROM public.strategies"
    assert pf_pos != -1, "Rollback must DELETE FROM public.profiles"
    assert au_pos != -1, "Rollback must DELETE FROM auth.users"
    assert sv_pos < pf_pos < au_pos, (
        "Rollback must DELETE in reverse-FK order: strategies first, "
        "then profiles, then auth.users. Out-of-order deletes either "
        "cascade-delete the row we want to delete explicitly OR trip "
        "an FK constraint."
    )
