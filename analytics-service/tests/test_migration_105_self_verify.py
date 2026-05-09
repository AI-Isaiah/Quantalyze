"""
Phase 19 / army2 / CT-1 — regression test for migration 105's self-verify.

The DO block at the end of migration 105 originally checked
indexname='strategies_fingerprint_partial_idx', but I-perf-2 (this same
migration) renamed the index to strategies_fingerprint_gin_idx. A fresh
apply on a clean DB would always RAISE EXCEPTION 'partial index missing'
and abort the migration — a deploy blocker.

This test parses the migration source directly (no DB required) so it
runs in the default pytest gauntlet and catches the regression statically.
"""
from __future__ import annotations

import pathlib
import re


_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "105_strategies_fingerprint_compute_similarity.sql"
)


def _read_migration_source() -> str:
    return _MIGRATION_PATH.read_text(encoding="utf-8")


def _extract_self_verify_block(src: str) -> str:
    """Return the DO $$ ... END $$; block at the end of migration 105.

    There's only one DO block in this migration (the self-verify). If
    that ever changes the regex below will need an anchor update.
    """
    match = re.search(r"DO\s*\$\$(.+?)\$\$\s*;", src, flags=re.DOTALL)
    assert match is not None, "Could not locate DO $$ ... $$; self-verify block"
    return match.group(1)


def test_self_verify_references_gin_index_name() -> None:
    """CT-1 — the self-verify must check the post-rename index name.

    Pre-fix this asserts on the old name 'strategies_fingerprint_partial_idx'
    which DROPs immediately above; the migration always aborts on fresh apply.
    """
    block = _extract_self_verify_block(_read_migration_source())
    assert "strategies_fingerprint_gin_idx" in block, (
        "self-verify must reference the renamed gin index "
        "'strategies_fingerprint_gin_idx', not the dropped partial-btree name"
    )
    # And the dropped name must NOT appear inside the verify block.
    # (it may still appear elsewhere in the file as part of DROP INDEX IF EXISTS)
    assert "strategies_fingerprint_partial_idx" not in block, (
        "self-verify still references the dropped index name — fresh applies "
        "will always raise 'partial index missing' and abort"
    )


def test_self_verify_locks_index_type_to_gin() -> None:
    """CT-1 — also assert the index is a GIN, not a btree, so a future
    regression that swaps the access method back to btree fails loud."""
    block = _extract_self_verify_block(_read_migration_source())
    # The verify block must include an indexdef LIKE '%USING gin%' check
    # so the access method is locked in.
    assert "USING gin" in block, (
        "self-verify must assert indexdef LIKE '%USING gin%' so a future "
        "regression cannot silently revert the access method to btree"
    )
