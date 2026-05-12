"""
Phase 19 / PR-X2 — regression test: verify_strategy endpoint does NOT write
to ``verification_requests``.

Migration 107 (PR-D) renames ``verification_requests`` to
``verification_requests_legacy`` and replaces it with a read-only VIEW
backed by ``strategy_verifications``. INSERT / UPDATE / DELETE on the VIEW
hit INSTEAD OF triggers that raise SQLSTATE 42501.

The kill-switch auto-rollback path (BACKBONE-05 D-4) falls back to the
legacy Python ``/api/verify-strategy`` endpoint when the unified-backbone
flag flips OFF on a Sentry error-rate breach. If that endpoint still
writes to ``verification_requests`` after PR-D ships, every rollback
request raises 42501 and returns 500 — turning the rollback target into
a kill-loop.

This test parses the router source statically (no DB / FastAPI test client
needed) and catches any regression that re-adds the legacy writes inside
the ``verify_strategy`` function body.
"""
from __future__ import annotations

import ast
import pathlib


_ROUTER_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "routers"
    / "portfolio.py"
)


def _verify_strategy_source() -> str:
    """Return the source of the ``verify_strategy`` function only.

    Static-AST extraction so the regression is scoped to this endpoint
    rather than the whole file — other endpoints (or comments / docstrings
    elsewhere in the file) are free to mention ``verification_requests``.
    """
    tree = ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name == "verify_strategy":
                return ast.get_source_segment(
                    _ROUTER_PATH.read_text(encoding="utf-8"), node
                ) or ""
    raise AssertionError(
        "verify_strategy function not found in routers/portfolio.py"
    )


def test_verify_strategy_does_not_call_supabase_table_verification_requests() -> None:
    """PR-X2 — the legacy ``verify_strategy`` endpoint must NOT execute
    ``.table('verification_requests')`` for INSERT / UPDATE / DELETE.
    After PR-D ships, those operations raise SQLSTATE 42501 from the
    INSTEAD OF triggers on the VIEW and break the kill-switch rollback
    fallback path.
    """
    src = _verify_strategy_source()
    tree = ast.parse(src)

    forbidden_calls: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        # We're looking for either:
        #   supabase.table("verification_requests").insert(...)
        #   supabase.table("verification_requests").update(...)
        #   supabase.table("verification_requests").delete(...)
        # All three are ``Call`` nodes whose chain bottoms out at a
        # ``.table("verification_requests")`` call. Walk the attribute
        # chain looking for that exact pattern.
        cursor: ast.expr = node.func
        while isinstance(cursor, ast.Attribute):
            cursor = cursor.value
        if not isinstance(cursor, ast.Call):
            continue
        if not (
            isinstance(cursor.func, ast.Attribute)
            and cursor.func.attr == "table"
        ):
            continue
        if len(cursor.args) != 1 or not isinstance(cursor.args[0], ast.Constant):
            continue
        if cursor.args[0].value == "verification_requests":
            # Build a human-readable summary for the assertion message.
            forbidden_calls.append(
                f"line ~{node.lineno}: "
                f"supabase.table('verification_requests').<...>"
            )

    assert not forbidden_calls, (
        "verify_strategy must NOT write to verification_requests "
        "(Phase 19 / PR-X2 — migration 107 makes it a read-only VIEW with "
        "INSTEAD OF triggers raising 42501). Found:\n  "
        + "\n  ".join(forbidden_calls)
    )


def test_verify_strategy_generates_local_uuid() -> None:
    """PR-X2 — the endpoint should generate ``verification_id`` locally
    via ``uuid.uuid4()`` rather than reading it back from a DB INSERT.
    Catches a regression that reintroduces the ``vr_insert.data[0]['id']``
    pattern (which only works when the INSERT against
    ``verification_requests`` succeeds).
    """
    src = _verify_strategy_source()
    assert "uuid.uuid4()" in src, (
        "verify_strategy must generate verification_id locally with "
        "uuid.uuid4() — the legacy 'vr_insert.data[0][\"id\"]' pattern "
        "relied on the now-removed verification_requests INSERT and "
        "will raise 42501 once migration 107 ships."
    )
    assert "vr_insert" not in src, (
        "verify_strategy must NOT reference vr_insert anymore — that "
        "variable came from the removed verification_requests INSERT."
    )
