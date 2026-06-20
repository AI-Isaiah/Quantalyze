"""
Phase 19 / army2 / CT-2 — regression test for verification_requests_legacy
table privilege grants.

The M-6 public_token-gated SELECT policy on verification_requests_legacy
has no token-match condition, only:
    public_token IS NOT NULL AND expires_at > now() AND created_at > now() - interval '90 days'
SEC-2 already REVOKEd direct SELECT from anon, but authenticated retained
the default GRANT. Any logged-in user could SELECT every legacy teaser row
(including emails + ciphertext blobs).

The public-status route uses createAdminClient (RLS bypass) — no
authenticated direct path is needed. CT-2 REVOKEs SELECT/INSERT/UPDATE/DELETE
from authenticated and adds an in-migration `has_table_privilege` assertion.

This test parses the migration source statically (no DB required) and
catches any regression that drops the REVOKE.
"""
from __future__ import annotations

import pathlib
import re


_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260620120000_verification_requests_view_shim_apply.sql"
)


def _read_source() -> str:
    return _MIGRATION_PATH.read_text(encoding="utf-8")


def test_revokes_select_from_authenticated_on_legacy_table() -> None:
    """CT-2 — migration 107 must REVOKE SELECT from authenticated on
    verification_requests_legacy. Without this, any logged-in user can
    SELECT all legacy teaser rows because the M-6 policy USING clause
    has no token match.
    """
    src = _read_source()
    # The REVOKE statement must mention SELECT, the table, and authenticated.
    pattern = re.compile(
        r"REVOKE\s+[^;]*SELECT[^;]*\bON\s+verification_requests_legacy\b"
        r"[^;]*FROM\s+[^;]*\bauthenticated\b",
        flags=re.IGNORECASE | re.DOTALL,
    )
    assert pattern.search(src), (
        "Migration 107 must REVOKE SELECT ON verification_requests_legacy "
        "FROM authenticated. The M-6 policy USING clause has no token "
        "match — without an explicit REVOKE, every authenticated user "
        "can SELECT all teaser rows including emails and ciphertext blobs."
    )


def test_in_migration_self_verify_for_authenticated_revoke() -> None:
    """CT-2 — migration 107 must include an in-migration assertion
    that authenticated has NO SELECT on verification_requests_legacy
    so a future GRANT regression fails loud at apply time."""
    src = _read_source()
    # Look for has_table_privilege check on authenticated for the legacy table
    pattern = re.compile(
        r"has_table_privilege\(\s*'authenticated'\s*,\s*"
        r"'public\.verification_requests_legacy'\s*,\s*'SELECT'\s*\)",
        flags=re.IGNORECASE,
    )
    assert pattern.search(src), (
        "Migration 107 must call has_table_privilege('authenticated', "
        "'public.verification_requests_legacy', 'SELECT') in a self-verify "
        "DO block so a future GRANT regression fails loud at apply time."
    )
