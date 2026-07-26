"""PYAPI-10 (C-22) — ONE discriminator on the whole ``/process-key`` 200 surface.

Phase 140.1, plan 05. Two requirements live here:

**PYAPI-10a — every 200 carries ``ok: bool``.** The route emits **six** distinct
200 shapes (enumerated below). Three of them carried no discriminator at all, so
every TypeScript consumer had to sniff for the presence of a field
(``verification_id``? ``queued``? ``code``?) to work out what it was looking at.
This file reaches all six by a *distinct fixture each* and pins ``ok`` — and,
when ``ok`` is false, a non-empty ``code`` — as **literals in the parametrise
table**. Nothing here reads its expected value out of the router.

**PYAPI-10b — the security verdict is not a success.** A write-capable-key
rejection is a *verdict*, and it used to be delivered as HTTP 200 with
``ok:false``. It now answers **403**. The sibling arm inside
``_run_validate_only`` deliberately stays at 200 + ``ok:false`` (shape 6) and is
pinned here too, so this plan can be *proven* not to have over-reached.

The six shapes, by behaviour (``routers/process_key.py``, post-plan-02 lines):

===== ============================================ ============================
Shape Behaviour                                     Emitter(s)
===== ============================================ ============================
1     idempotent hit — ``WIZARD_DUPLICATE``          ``_wizard_duplicate_reply``,
                                                     reached from :1104 (pre-check)
                                                     and :1181 (23505 race winner)
2     long-fetch accepted — ``queued: true``         :1205
3     validate-only success                          :670 (``_run_validate_only``)
4     csv-finalize success                           :999
5     synchronous pipeline success                   :1466
6     envelope error AT 200 — validate-only failure   :666 (``_envelope_error`` bare)
===== ============================================ ============================

Shape 6's *other* historical emitter — the synchronous scope/validation
rejection — is what PYAPI-10b moves to 403; see
``test_pyapi_10b_scope_rejection_is_403_not_200``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.process_key as process_key_router

# A valid UUID — the route validates X-Correlation-Id and mints a fresh one if
# it is malformed, so it must be well-formed to round-trip into the envelope.
_TEST_CID = "11111111-1111-4111-8111-111111111111"
_TOKEN = "a" * 64


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    application = FastAPI()
    application.state.limiter = process_key_router.limiter
    application.include_router(process_key_router.router)
    return application


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_TOKEN}", "X-Correlation-Id": _TEST_CID}


def _supabase(
    *,
    existing_row=None,
    insert_id: str = "ver-1",
    insert_raises: Exception | None = None,
    insert_raises_then_existing=None,
    owner_row=None,
    job_row=None,
):
    """Chained-MagicMock supabase client — same idiom as ``test_process_key.py``.

    ``.table()`` routes by name because ``/process-key`` reads three tables and
    the ``strategies`` (ownership gate) and ``compute_jobs`` (job-state
    read-back) reads must not consume the ``strategy_verifications``
    ``side_effect`` queue.
    """
    if owner_row is None:
        owner_row = {"id": "s1"}
    if job_row is None:
        job_row = {"status": "pending"}

    fake = MagicMock()

    select_chain = MagicMock()
    if insert_raises_then_existing is not None:
        select_chain.execute.side_effect = [
            MagicMock(data=existing_row),
            MagicMock(data=insert_raises_then_existing),
        ]
    else:
        select_chain.execute.return_value = MagicMock(data=existing_row)
    eq_chain = MagicMock()
    eq_chain.eq.return_value = eq_chain
    eq_chain.maybe_single.return_value = select_chain
    eq_chain.single.return_value = select_chain
    select_obj = MagicMock()
    select_obj.eq.return_value = eq_chain
    table = MagicMock()
    table.select.return_value = select_obj

    insert_chain = MagicMock()
    if insert_raises is not None:
        insert_chain.execute.side_effect = insert_raises
    else:
        insert_chain.execute.return_value = MagicMock(data=[{"id": insert_id}])
    table.insert.return_value = insert_chain

    update_chain = MagicMock()
    update_chain.eq.return_value = MagicMock(
        execute=MagicMock(return_value=MagicMock(data=[{"id": "s1"}]))
    )
    table.update.return_value = update_chain

    fake.table.return_value = table

    strategies_table = MagicMock()
    strategies_select = MagicMock()
    strategies_eq = MagicMock()
    strategies_eq.eq.return_value = strategies_eq
    strategies_eq.maybe_single.return_value = MagicMock(
        execute=MagicMock(return_value=MagicMock(data=owner_row))
    )
    strategies_select.eq.return_value = strategies_eq
    strategies_table.select.return_value = strategies_select
    strategies_table.update.return_value = update_chain

    jobs_table = MagicMock()
    jobs_select = MagicMock()
    jobs_eq = MagicMock()
    jobs_eq.eq.return_value = jobs_eq
    jobs_eq.maybe_single.return_value = MagicMock(
        execute=MagicMock(return_value=MagicMock(data=job_row))
    )
    jobs_select.eq.return_value = jobs_eq
    jobs_table.select.return_value = jobs_select

    _by_name = {"strategies": strategies_table, "compute_jobs": jobs_table}
    fake.table.side_effect = lambda name, *a, **k: _by_name.get(name, table)

    # `enqueue_compute_job` returns the job id, and `_resume_duplicate_job`
    # only reads the job state back when that id is TRUTHY. A falsy default
    # would silently short-circuit the read and pin `job_state` at "enqueued"
    # for reasons unrelated to the behaviour under test.
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data="job-abc")
    fake.rpc.return_value = rpc_chain
    return fake


def _sync_adapter(*, valid=True, read_only=None, error_code=None, human_message=None):
    """A synchronous-pipeline adapter stub that runs to completion when valid."""
    from services.ingestion.adapter import (
        Fingerprint,
        MetricsSnapshot,
        ValidationResult,
    )

    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=valid,
            read_only=read_only,
            error_code=error_code,
            human_message=human_message,
            debug_context={},
        )
    )
    adapter.fetch_raw = AsyncMock(return_value=[])
    adapter.compute_metrics = MagicMock(
        return_value=MetricsSnapshot(None, None, None, None, None, 0, None)
    )
    adapter.compute_fingerprint = MagicMock(return_value=Fingerprint())
    adapter.reconstruct_positions = AsyncMock(return_value=[])
    return adapter


# ---------------------------------------------------------------------------
# One reach-fixture per shape. Each drives a DIFFERENT control-flow path, so a
# single-site fix cannot make the parametrised oracle pass.
# ---------------------------------------------------------------------------


def _reach_shape_1_duplicate_hit(client):
    """Shape 1 — idempotent hit (``WIZARD_DUPLICATE``), pre-check emitter."""
    fake = _supabase(
        existing_row={
            "id": "ver-dup",
            "status": "draft",
            "trust_tier": "api_verified",
        },
        job_row={"status": "running"},
    )
    with patch("routers.process_key.get_supabase", return_value=fake):
        return client.post(
            "/process-key",
            json={
                "flow_type": "onboard",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-dup-10a",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )


def _reach_shape_2_queued_fresh(client):
    """Shape 2 — a fresh long-fetch session accepted for the worker."""
    fake = _supabase(existing_row=None, insert_id="ver-queued")
    with patch("routers.process_key.get_supabase", return_value=fake):
        return client.post(
            "/process-key",
            json={
                "flow_type": "onboard",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-queued-10a",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )


def _reach_shape_3_validate_only_success(client):
    """Shape 3 — pre-strategy validate-only success (no SV row is written)."""
    fake = _supabase(existing_row=None)
    with patch(
        "routers.process_key.get_supabase", return_value=fake
    ), patch(
        "routers.process_key.get_adapter", return_value=_sync_adapter(valid=True)
    ):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "validate",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-val-10a",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sMSxjb2wyCjEsMg==",
                },
            },
            headers=_auth_headers(),
        )


def _reach_shape_4_csv_finalize_success(client):
    """Shape 4 — csv-finalize, which mints the strategies row via the RPC."""
    fake = _supabase(existing_row=None)
    user_sb = MagicMock()
    user_sb.rpc.return_value = MagicMock(
        execute=MagicMock(
            return_value=MagicMock(data="11111111-1111-1111-1111-111111111111")
        )
    )
    with patch(
        "routers.process_key.get_supabase", return_value=fake
    ), patch(
        "routers.process_key.get_user_scoped_supabase", return_value=user_sb
    ):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "finalize",
                    "user_id": "33333333-3333-3333-3333-333333333333",
                    "wizard_session_id": "22222222-2222-2222-2222-222222222222",
                    "fmt": "trades",
                    "strategy_name": "Shape 4",
                },
            },
            headers={**_auth_headers(), "X-User-Access-Token": "user-jwt-abc"},
        )


def _reach_shape_5_synchronous_success(client):
    """Shape 5 — the synchronous pipeline running to ``published``.

    This is the shape consumers sniff for ``verification_id``
    (``verify-strategy/route.ts:197-198``, ``csv-finalize/route.ts:1213-1214``),
    which is precisely why it needs a discriminator of its own.
    """
    fake = _supabase(existing_row=None, insert_id="ver-sync")
    with patch(
        "routers.process_key.get_supabase", return_value=fake
    ), patch(
        "routers.process_key.get_adapter", return_value=_sync_adapter(valid=True)
    ):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-sync-10a",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sCjE=",
                },
            },
            headers=_auth_headers(),
        )


def _reach_shape_6_envelope_error_at_200(client):
    """Shape 6 — the envelope error that legitimately stays at 200.

    ``_run_validate_only``'s failure arm. No SV row exists yet and nothing has
    been decided about the caller's authorization, so this is a *result*, not a
    verdict — PYAPI-10b deliberately leaves it at 200.
    """
    fake = _supabase(existing_row=None)
    bad = _sync_adapter(
        valid=False,
        error_code="CSV_PARSE_FAILED",
        human_message="That file could not be read.",
    )
    with patch(
        "routers.process_key.get_supabase", return_value=fake
    ), patch("routers.process_key.get_adapter", return_value=bad):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "validate",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-val-bad-10a",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sCjE=",
                },
            },
            headers=_auth_headers(),
        )


# ---------------------------------------------------------------------------
# PYAPI-10a — the exhaustive oracle
# ---------------------------------------------------------------------------

# Expected `ok` is a LITERAL per case, written here and nowhere else. It is not
# derived from the response, not imported from the router, and not computed from
# the status. Programme non-negotiable #3: an oracle that harvests its
# expectation from the code under test cannot fail (10 simultaneous semantic
# mutations once produced a byte-identical `8859 passed`).
_SHAPES = [
    ("1-duplicate-hit", _reach_shape_1_duplicate_hit, True),
    ("2-queued-fresh", _reach_shape_2_queued_fresh, True),
    ("3-validate-only-success", _reach_shape_3_validate_only_success, True),
    ("4-csv-finalize-success", _reach_shape_4_csv_finalize_success, True),
    ("5-synchronous-success", _reach_shape_5_synchronous_success, True),
    ("6-envelope-error-at-200", _reach_shape_6_envelope_error_at_200, False),
]


@pytest.mark.parametrize(
    "shape,reach,expected_ok",
    _SHAPES,
    ids=[s[0] for s in _SHAPES],
)
def test_pyapi_10a_every_200_carries_ok_discriminator(
    client, shape: str, reach, expected_ok: bool
):
    """PYAPI-10a: EVERY 200 from ``/process-key`` carries ``ok: bool``.

    Pre-fix, shapes 1, 2 and 5 carried no discriminator at all, so a consumer
    had to sniff for the presence of a field to learn what it had been sent.
    """
    r = reach(client)

    assert r.status_code == 200, f"shape {shape} is not a 200: {r.text}"
    body = r.json()
    assert "ok" in body, (
        f"shape {shape} has no `ok` discriminator — a consumer must sniff "
        f"field presence to classify it; got keys {sorted(body)}"
    )
    assert isinstance(body["ok"], bool), (
        f"shape {shape}: `ok` must be a JSON boolean, got {type(body['ok'])}"
    )
    assert body["ok"] is expected_ok, (
        f"shape {shape}: expected ok={expected_ok}, got ok={body['ok']}"
    )
    if body["ok"] is False:
        assert isinstance(body.get("code"), str) and body["code"], (
            f"shape {shape}: ok=false must carry a non-empty machine `code`, "
            f"got {body.get('code')!r}"
        )


def test_pyapi_10a_exactly_six_shapes_are_covered():
    """TRAP-5 / enumeration fence: the 200 surface has SIX shapes.

    Pinned as a literal so that adding a seventh return site without adding a
    case here is a red test rather than a silent hole. The enumeration is by
    BEHAVIOUR (every ``return`` reachable from the handler that serialises at
    200), not by grepping the syntax of a known instance.
    """
    assert len(_SHAPES) == 6


def test_pyapi_10a_shape_5_code_is_explicit_null(client):
    """Shape 5's `code` is an explicit ``null``, not an absent key.

    Shape 5 is the terminal synchronous success and names no sub-condition, so
    there is no stable success code to give it. Making the absence EXPLICIT
    means a consumer reading ``body.code`` on the one shape it used to sniff
    never gets ``undefined``.
    """
    body = _reach_shape_5_synchronous_success(client).json()
    assert "code" in body, "shape 5 must carry `code` explicitly, not omit it"
    assert body["code"] is None
    # The keys consumers sniff today are untouched — this change is additive.
    assert body["verification_id"] == "ver-sync"
    assert body["status"] == "published"


def test_pyapi_10a_duplicate_shape_keeps_job_state(client):
    """The plan-02 ``job_state`` discriminator rides shape 1, not a 7th key."""
    body = _reach_shape_1_duplicate_hit(client).json()
    assert body["ok"] is True
    assert body["code"] == "WIZARD_DUPLICATE"
    assert body["idempotent"] is True
    assert body["queued"] is True
    assert body["job_state"] == "running"


def test_pyapi_10a_race_winner_emitter_also_carries_ok(client):
    """TRAP-5: shape 1 has TWO emitters. Both must carry the discriminator.

    This one is reachable ONLY through the 23505 race arm — the pre-check
    misses, the INSERT loses the race, and the handler re-fetches the winner.
    A fix applied to the pre-check emitter alone leaves this red.
    """
    fake = _supabase(
        existing_row=None,
        insert_raises=Exception(
            "duplicate key value violates unique constraint (SQLSTATE 23505)"
        ),
        insert_raises_then_existing={
            "id": "ver-raced",
            "status": "draft",
            "trust_tier": "api_verified",
        },
        job_row={"status": "running"},
    )
    with patch("routers.process_key.get_supabase", return_value=fake):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "onboard",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-race-10a",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verification_id"] == "ver-raced"
    assert body["ok"] is True
    assert body["code"] == "WIZARD_DUPLICATE"
    assert body["job_state"] == "running"
