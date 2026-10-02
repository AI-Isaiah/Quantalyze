"""Phase 141 / SC3 server half — teaser is DELIBERATELY non-idempotent.

WHY this pin exists
-------------------
It makes plan 04's TypeScript no-retry rule for teaser LOAD-BEARING rather than
decorative. The server genuinely mints a FRESH verification per teaser
submission — a new uuid4 session id and a new strategy_verifications row (and,
downstream, a public_token / lead) at `process_key.py:938`. So a seam retry of a
teaser call would DOUBLE-MINT. If a refactor ever made teaser reuse a
caller-supplied session id (or minted a constant), the distinct-session
assertion below reddens — which is the proof the non-idempotency is real, not
assumed.

Division of labor (the CONTEXT "real DB-observing test, not a mock tautology"
requirement)
------------------------------------------------------------------------------
The stateful fake store faithfully ACCEPTS both inserts — it enforces no
uniqueness, so it proves the ROUTE emits two writes. The REAL Postgres index
behaviour that could have deduped distinct-session rows (and 23505'd same-session
rows) is proven separately against the live test DB in
`supabase/tests/test_resync_retry_single_job.sql` (assertions b/c). Together they
are the DB-real evidence chain: the route mints two rows per two teaser calls,
and the real (strategy_id, wizard_session_id) index admits distinct-session rows
while rejecting same-session ones.

Harness: reuses `tests/test_resync_draft_dedup.py`'s stateful fake + reject
adapter — no third harness invented. Only `routers.process_key.get_supabase` and
`routers.process_key.get_adapter` (both NETWORK boundaries) are patched; the
route handler and reply path are never touched.
"""

from __future__ import annotations

from unittest.mock import patch

from tests.test_resync_draft_dedup import (  # noqa: F401 — full_stack_client is a re-exported fixture
    _StatefulSupabase,
    _post,
    _teaser_body,
    full_stack_client,
    reject_adapter,
)

# The teaser anchor strategy id, pinned as a LITERAL — never imported from
# services.teaser_anchor / routers.process_key (oracle independence). Every
# teaser SV row anchors here (process_key.py:937, the :936 overwrite target).
_TEASER_ANCHOR_STRATEGY_ID = "00000000-0000-0000-0000-000000000001"


def test_two_teaser_calls_mint_two_distinct_session_rows(full_stack_client) -> None:
    sb = _StatefulSupabase()  # ownership gate is skipped for teaser
    stub = reject_adapter()
    with patch("routers.process_key.get_supabase", return_value=sb), patch(
        "routers.process_key.get_adapter", return_value=stub
    ):
        _post(full_stack_client, _teaser_body())
        _post(full_stack_client, _teaser_body())

    rows = [
        r
        for r in sb.store["strategy_verifications"]
        if r.get("flow_type") == "teaser"
    ]
    assert len(rows) == 2, (
        f"two identical teaser submissions minted {len(rows)} "
        f"strategy_verifications rows, expected 2 — teaser is deliberately "
        f"non-idempotent (a fresh verification per landing-page submission)"
    )

    sessions = {r["wizard_session_id"] for r in rows}
    assert len(sessions) == 2, (
        "the two teaser rows share a wizard_session_id — the server-side fresh "
        "uuid4 mint (process_key.py:938) is not firing. A seam retry of teaser "
        "would then collapse onto ONE verification instead of double-minting, "
        "silently making teaser look idempotent when it must not be"
    )

    for r in rows:
        assert r["strategy_id"] == _TEASER_ANCHOR_STRATEGY_ID, (
            f"a teaser SV row anchored on {r['strategy_id']!r}, expected the "
            f"teaser anchor {_TEASER_ANCHOR_STRATEGY_ID!r} — teaser is anchor-less "
            f"by definition and its strategy_id is force-overwritten server-side"
        )
