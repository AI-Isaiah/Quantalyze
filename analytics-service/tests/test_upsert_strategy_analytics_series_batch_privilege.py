"""H-0762 regression — privilege probe for upsert_strategy_analytics_series_batch.

The MagicMock-backed test in test_analytics_runner.py records call shape but
proves nothing about the privilege posture: a future migration flipping
SECURITY DEFINER off or widening GRANT EXECUTE to authenticated/anon would
not be caught.

This file adds two real probes:

  1. Static check on the migration source (always runs, mirrors the
     test_legacy_table_rls.py pattern). Asserts that
     `REVOKE ALL ON FUNCTION upsert_strategy_analytics_series_batch FROM
     PUBLIC, anon, authenticated` and
     `GRANT EXECUTE ... TO service_role` are both present, and that
     `SECURITY DEFINER` + `SET search_path = public, pg_temp` are declared.

  2. Live anon-key probe (HAS_LIVE_DB-gated). When the test project is
     wired, builds an anon-key Supabase client and tries to invoke the
     RPC; asserts the call fails with PostgREST 42501 (permission_denied)
     or an equivalent HTTP 403. Without this probe, a GRANT regression
     would silently succeed in dev and only surface in prod.

The companion pgTAP-style SQL test at
supabase/tests/test_upsert_strategy_analytics_series_batch_privilege.sql
adds the same posture assertions at the database layer (prosecdef,
proconfig, has_function_privilege). Two layers because a SQL test catches
schema drift even when the analytics-service test job is skipped.
"""
from __future__ import annotations

import os
import pathlib
import re

import pytest


_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260428120919_strategy_analytics_series.sql"
)


def _read_source() -> str:
    return _MIGRATION_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Static migration-source checks (always run; no DB needed)
# ---------------------------------------------------------------------------


def test_revokes_execute_from_anon_authenticated_public() -> None:
    """The single REVOKE that strips PUBLIC + anon + authenticated must
    exist. Without it, anon and authenticated inherit EXECUTE from PUBLIC
    and can call the SECURITY DEFINER RPC, which writes analytics rows as
    the function owner — a tenant-bypass vector.
    """
    src = _read_source()
    pattern = re.compile(
        r"REVOKE\s+ALL\s+ON\s+FUNCTION\s+upsert_strategy_analytics_series_batch"
        r"[^;]*FROM\s+[^;]*PUBLIC[^;]*anon[^;]*authenticated",
        flags=re.IGNORECASE | re.DOTALL,
    )
    assert pattern.search(src), (
        "Migration 087 must REVOKE ALL ON FUNCTION "
        "upsert_strategy_analytics_series_batch FROM PUBLIC, anon, authenticated. "
        "Without this, an authenticated user can call the SECURITY DEFINER RPC "
        "directly and write rows to strategy_analytics_series as the function "
        "owner, bypassing per-strategy RLS."
    )


def test_grants_execute_to_service_role() -> None:
    src = _read_source()
    pattern = re.compile(
        r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+upsert_strategy_analytics_series_batch"
        r"[^;]*TO\s+service_role",
        flags=re.IGNORECASE | re.DOTALL,
    )
    assert pattern.search(src), (
        "service_role must retain EXECUTE so the analytics_runner can "
        "continue to upsert."
    )


def test_function_declared_security_definer() -> None:
    src = _read_source()
    # Capture the full preamble through AS $$ — non-greedy match terminating
    # at LANGUAGE would stop BEFORE SECURITY DEFINER (declared on the next
    # line).
    block = re.search(
        r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+upsert_strategy_analytics_series_batch[\s\S]*?AS\s+\$\$",
        src,
        re.IGNORECASE,
    )
    assert block, "Could not locate upsert_strategy_analytics_series_batch definition."
    assert re.search(r"SECURITY\s+DEFINER", block.group(0), re.IGNORECASE), (
        "upsert_strategy_analytics_series_batch must be SECURITY DEFINER. "
        "Flipping to SECURITY INVOKER would silently fail every legitimate "
        "service-role upsert AND open a privilege-bypass shape if combined "
        "with a GRANT widening."
    )
    assert re.search(
        r"SET\s+search_path\s*=\s*public\s*,\s*pg_temp",
        block.group(0),
        re.IGNORECASE,
    ), (
        "SECURITY DEFINER functions must pin search_path to (public, pg_temp) "
        "to block public-schema function shadowing — H-B hardening."
    )


# ---------------------------------------------------------------------------
# Live anon-key probe (HAS_LIVE_DB-gated)
# ---------------------------------------------------------------------------

_HAS_LIVE_DB = bool(os.environ.get("HAS_LIVE_DB"))
_LIVE_URL = os.environ.get("SUPABASE_URL", "")
_LIVE_ANON = os.environ.get("SUPABASE_ANON_KEY", "")


@pytest.mark.skipif(
    not (_HAS_LIVE_DB and _LIVE_URL and _LIVE_ANON),
    reason="H-0762 live probe needs HAS_LIVE_DB + SUPABASE_URL + SUPABASE_ANON_KEY",
)
def test_anon_client_cannot_call_upsert_strategy_analytics_series_batch() -> None:
    """An anon-key client (no JWT, role=anon) must NOT be able to call the
    RPC. PostgREST surfaces the denial as HTTP 403 with PostgreSQL SQLSTATE
    42501 (permission_denied). Any other shape — 200, 422, 5xx — is a
    privilege regression.
    """
    from supabase import create_client

    client = create_client(_LIVE_URL, _LIVE_ANON)

    # A clearly-fake strategy_id so the RPC can't accidentally land a
    # write even if the privilege check is gone.
    fake_strategy_id = "00000000-0000-0000-0000-000000000000"
    raised = False
    try:
        client.rpc(
            "upsert_strategy_analytics_series_batch",
            {
                "p_strategy_id": fake_strategy_id,
                # Actual signature is (uuid, jsonb) where p_kinds is a JSONB
                # object {kind: payload, ...}.
                "p_kinds": {"test": {}},
            },
        ).execute()
    except Exception as exc:
        # supabase-py raises APIError for non-2xx responses; we want to
        # confirm the underlying SQLSTATE is 42501 OR the HTTP status is 403.
        raised = True
        msg = str(exc)
        # Acceptable shapes:
        #   "42501" (PostgreSQL permission_denied)
        #   "permission denied for function upsert_strategy_analytics_series_batch"
        #   "PGRST301" / 401 / 403 (PostgREST gateway denial)
        acceptable = (
            "42501" in msg
            or "permission denied" in msg.lower()
            or "PGRST301" in msg
            or "401" in msg
            or "403" in msg
        )
        assert acceptable, (
            f"H-0762 regression: anon RPC call did NOT deny with the expected "
            f"permission_denied / 403 shape. Got: {msg!r}. A future GRANT "
            f"widening would surface here."
        )
    assert raised, (
        "H-0762 regression: anon-key client successfully invoked "
        "upsert_strategy_analytics_series_batch. The REVOKE on the migration "
        "is gone or has been overridden by a later GRANT."
    )
