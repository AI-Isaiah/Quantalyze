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


# ---------------------------------------------------------------------------
# M-15 — the enumeration fence, read from the ROUTER'S OWN AST
# ---------------------------------------------------------------------------
#
# What was here before: a bare length assertion on ``_SHAPES`` against the
# literal six — a literal compared against a list literal declared 40 lines
# above it, in this same file. It was the
# programme's own counter-example (non-negotiable #3): the only edit that could
# ever redden it is an edit to the list beside it, so a seventh return site in
# ``routers/process_key.py`` shipped in total silence. Its docstring claimed the
# opposite, which is worse than no fence at all.
#
# RESEARCH C-20 also proves the number itself was a COINCIDENCE: two of the
# handler's returns COLLAPSE onto one shape (both ``_wizard_duplicate_reply``
# call sites) while one EXPANDS into two (``_run_validate_only`` has two
# returns). One collapse cancelling one expansion is what made "six" look
# meaningful. So this fence never counts — it compares SETS.
#
# Direction of the oracle: the ACTUAL side is derived from the router's source
# via ``ast``; the EXPECTED side is a literal set typed here. That is the
# sanctioned direction — a pinned contract confronted with the code's real
# shape — and it is the opposite of literal-vs-literal-in-the-same-file.

import ast  # noqa: E402  (imported here, beside the only test that uses it)
import pathlib  # noqa: E402

# The module under test, by its own import location — never a hand-built path.
_ROUTER_SRC = pathlib.Path(process_key_router.__file__)

# The handler plus every helper one of its returns DELEGATES to. A delegate's
# own returns are 200 shapes just as much as an inline dict is.
_SHAPE_BEARING_FUNCTIONS = ("process_key", "_wizard_duplicate_reply", "_run_validate_only")

# The pinned CONTRACT. Eight entries, not six: five reachable wire shapes
# (rendered by their sorted top-level key names), two delegation edges out of
# ``process_key`` and one delegated error envelope. Adding a 200-capable return
# to any of the three functions adds an entry and reddens this.
_EXPECTED_200_FINGERPRINTS = frozenset(
    {
        "call:_envelope_error",
        "call:_run_validate_only",
        "call:_wizard_duplicate_reply",
        "dict:code,correlation_id,encrypted_credentials,errors,fingerprint,"
        "matched_strategy_id,metrics_snapshot,ok,status,trust_tier,verification_id",
        "dict:code,correlation_id,idempotent,job_state,ok,queued,status,trust_tier,"
        "verification_id",
        "dict:correlation_id,daily_returns_series,ok,preview,read_only,step,valid",
        "dict:correlation_id,ok,queued,verification_id",
        "dict:correlation_id,ok,status,step,strategy_id",
    }
)


def _own_returns(fn: ast.AST) -> list[ast.Return]:
    """Every ``return <expr>`` in ``fn``'s OWN body.

    Nested ``def``/``lambda`` bodies are skipped: ``process_key`` defines
    ``_write_audit_sync`` inline, and a closure's return value never reaches the
    wire as a response.
    """
    found: list[ast.Return] = []

    def _walk(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            if isinstance(child, ast.Return) and child.value is not None:
                found.append(child)
            _walk(child)

    _walk(fn)
    return found


def _declared_status(value: ast.expr) -> int | str | None:
    """The literal ``status_code=`` on a call return, or ``None`` if absent.

    Returns the sentinel ``"NON-LITERAL"`` for a computed status, which the
    fence refuses rather than silently classifying (Rule 12 — fail loud).
    """
    if isinstance(value, ast.Call):
        for kw in value.keywords:
            if kw.arg == "status_code":
                if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, int):
                    return kw.value.value
                return "NON-LITERAL"
    return None


def _dict_literal_keys(node: ast.Dict) -> set[str]:
    keys: set[str] = set()
    for key in node.keys:
        assert isinstance(key, ast.Constant) and isinstance(key.value, str), (
            "a 200 shape built with a computed or **-spread key cannot be "
            "fingerprinted — make it an explicit dict literal or teach this fence"
        )
        keys.add(key.value)
    return keys


def _keys_assigned_to(fn: ast.AST, name: str) -> set[str]:
    """Every key ever put into the local dict called ``name`` — from the dict
    literal it is bound to AND from later ``name["k"] = ...`` assignments.

    ``_run_validate_only`` builds its success envelope this way and adds
    ``preview`` / ``daily_returns_series`` conditionally, so a key-set read from
    the literal alone would miss half the shape.
    """
    keys: set[str] = set()
    for node in ast.walk(fn):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for target in targets:
            if (
                isinstance(target, ast.Name)
                and target.id == name
                and isinstance(node.value, ast.Dict)
            ):
                keys |= _dict_literal_keys(node.value)
            if (
                isinstance(target, ast.Subscript)
                and isinstance(target.value, ast.Name)
                and target.value.id == name
                and isinstance(target.slice, ast.Constant)
                and isinstance(target.slice.value, str)
            ):
                keys.add(target.slice.value)
    return keys


def _fingerprint(fn: ast.AST, value: ast.expr) -> str:
    """A rendering that is stable under line churn and changes on shape change.

    Deliberately NEVER keyed on a line number or an ordinal — M-15b.
    """
    if isinstance(value, ast.Await):
        value = value.value
    if isinstance(value, ast.Dict):
        return "dict:" + ",".join(sorted(_dict_literal_keys(value)))
    if isinstance(value, ast.Call):
        func = value.func
        callee = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        assert callee, f"un-nameable callee in a 200-capable return: {ast.dump(value)[:120]}"
        return "call:" + callee
    if isinstance(value, ast.Name):
        return "dict:" + ",".join(sorted(_keys_assigned_to(fn, value.id)))
    raise AssertionError(
        f"a 200-capable return this fence cannot render: {type(value).__name__} — "
        "teach the fence rather than deleting the shape"
    )


def _collect_200_shapes() -> tuple[set[str], list[tuple[str, int, object]]]:
    """Walk the router's source; split its returns into 200-capable shapes and
    the explicitly-statused ones the fence must ignore."""
    tree = ast.parse(_ROUTER_SRC.read_text(encoding="utf-8"))
    functions = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    shapes: set[str] = set()
    excluded: list[tuple[str, int, object]] = []
    for name in _SHAPE_BEARING_FUNCTIONS:
        assert name in functions, f"{name} vanished from {_ROUTER_SRC.name}"
        fn = functions[name]
        for ret in _own_returns(fn):
            status = _declared_status(ret.value)
            if status is not None and status != 200:
                excluded.append((name, ret.lineno, status))
                continue
            shapes.add(_fingerprint(fn, ret.value))
    return shapes, excluded


def test_pyapi_10a_the_200_shape_set_matches_the_pinned_contract():
    """M-15 — the enumeration fence, derived from ``routers/process_key.py``'s AST.

    A 200-capable return is one with no ``status_code=`` keyword, or one whose
    ``status_code=`` is the literal 200. That predicate is load-bearing: this
    handler also returns ``JSONResponse(status_code=401/403/422/424, ...)``, and a
    naive walk would sweep those in — either reddening on a legitimate error arm
    or silently widening the pinned set, which is the very defect class the fence
    exists to catch.
    """
    shapes, excluded = _collect_200_shapes()

    assert shapes == _EXPECTED_200_FINGERPRINTS, (
        "the /process-key 200 surface changed shape.\n"
        f"  only in the router:   {sorted(shapes - _EXPECTED_200_FINGERPRINTS)}\n"
        f"  only in the contract: {sorted(_EXPECTED_200_FINGERPRINTS - shapes)}\n"
        "Add a reachability fixture to _SHAPES and pin the new shape here, or "
        "restore the removed one."
    )


def test_pyapi_10a_non_200_returns_are_excluded_from_the_shape_fence():
    """The 200-capable filter, asserted from the other side (checker W-4).

    Named explicitly: the ``403`` ownership/scope refusals and plan
    140.1.1-02's ``424`` venue-transient arm are error arms on this same
    handler. They must never enter the 200 fingerprint set — if they did, the
    fence would be pinning error shapes as success shapes and a genuinely new
    200 could hide among them.
    """
    _, excluded = _collect_200_shapes()
    statuses = {status for _, _, status in excluded}

    assert "NON-LITERAL" not in statuses, (
        "a return with a computed status_code cannot be classified 200-capable "
        "or not — make it a literal so this fence stays decidable"
    )
    assert 403 in statuses, "the 403 refusal arms must be excluded by the filter"
    assert 424 in statuses, (
        "plan 140.1.1-02's 424 venue-transient arm must be excluded by the filter"
    )
    assert all(status != 200 for _, _, status in excluded)


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


# ---------------------------------------------------------------------------
# PYAPI-10b — the security verdict is not delivered under a success status
# ---------------------------------------------------------------------------

_CANARY_SECRET = "CANARY-SECRET-3f9a2b"


def _post_sync_rejection(client, *, read_only, error_code, human_message):
    """Drive the synchronous pipeline's rejection gate.

    ``flow_type=teaser`` because it is exempt from the ownership gate and is a
    real caller of the synchronous pipeline.
    """
    fake = _supabase(existing_row=None, insert_id="ver-reject")
    adapter = _sync_adapter(
        valid=True,
        read_only=read_only,
        error_code=error_code,
        human_message=human_message,
    )
    with patch(
        "routers.process_key.get_supabase", return_value=fake
    ), patch("routers.process_key.get_adapter", return_value=adapter):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wiz-reject-10b",
                    "api_key": "k",
                    "api_secret": _CANARY_SECRET,
                },
            },
            headers=_auth_headers(),
        )
    return r, fake, adapter


@pytest.mark.parametrize(
    "read_only,error_code,expected_code",
    [
        (False, "TRADE_SCOPE", "TRADE_SCOPE"),
        (False, "WITHDRAW_SCOPE", "WITHDRAW_SCOPE"),
        # IMP-2: the error_code arm wins even when the adapter left
        # read_only=True.
        (True, "WITHDRAW_SCOPE", "WITHDRAW_SCOPE"),
        # SF-2: no error_code at all still rejects, under the registered
        # fallback code.
        (False, None, "VALIDATION_UNEXPECTED"),
    ],
    ids=["trade_scope", "withdraw_scope", "error_code_wins", "fallback_code"],
)
def test_pyapi_10b_write_capable_key_rejection_is_403(
    client, read_only, error_code, expected_code
):
    """PYAPI-10b: a write-capable-key rejection answers **403**, never 200.

    This is a security VERDICT about the caller's credentials. Delivering it
    under a success status is the finding's actual severity — a consumer that
    branches on the status line alone (and TRAP-2 says it may have to) reads
    "your write-capable key was accepted".

    Statuses and codes below are LITERALS. Nothing is imported from the router.
    """
    r, fake, adapter = _post_sync_rejection(
        client,
        read_only=read_only,
        error_code=error_code,
        human_message="Key has trading permissions. Please use a read-only key.",
    )

    assert r.status_code == 403, (
        f"a scope rejection must not be a success status; got "
        f"{r.status_code} with body {r.text}"
    )
    body = r.json()
    # The full envelope survives the status move — 140.3 renders from it.
    assert body["ok"] is False
    assert body["code"] == expected_code
    assert body["human_message"]
    assert body["correlation_id"] == _TEST_CID
    assert body["recoverable"] is False
    assert body["debug_context"]["verification_id"] == "ver-reject"

    # Orthogonal invariants that must survive the status change.
    adapter.fetch_raw.assert_not_called()
    assert _CANARY_SECRET not in r.text, "the rejection must not echo credentials"
    draft_calls = [
        c
        for c in fake.rpc.call_args_list
        if c.args
        and c.args[0] == "transition_strategy_verification"
        and c.args[1].get("p_new_status") == "draft"
    ]
    assert draft_calls, "the rejection must transition the verification to draft"


def test_pyapi_10b_validate_only_failure_stays_200(client):
    """The scope fence, stated as a test: 10b moved ONE arm, not both.

    ``_run_validate_only``'s failure return is the *other* bare
    ``_envelope_error`` on this route. It is a validation RESULT for a session
    that has no verification row and no authorization decision behind it, so it
    keeps 200 + ``ok:false``. Pinning it means this plan can be proven not to
    have over-reached — and means a later "consistency" edit that moves it has
    to argue with a test.
    """
    r = _reach_shape_6_envelope_error_at_200(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == "CSV_PARSE_FAILED"


def test_pyapi_10b_csv_finalize_401_and_422_arms_unchanged(client):
    """Anti-over-reach control: the route's other 4xx envelopes are untouched.

    If the 403 change had been applied to ``_envelope_error`` itself rather
    than to one return site, these two would move too.
    """
    fake = _supabase(existing_row=None)
    with patch("routers.process_key.get_supabase", return_value=fake), patch(
        "routers.process_key.get_user_scoped_supabase"
    ):
        no_token = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "finalize",
                    "user_id": "33333333-3333-3333-3333-333333333333",
                    "wizard_session_id": "22222222-2222-2222-2222-222222222222",
                    "fmt": "trades",
                    "strategy_name": "No token",
                },
            },
            headers=_auth_headers(),  # no X-User-Access-Token
        )
    assert no_token.status_code == 401, no_token.text
    assert no_token.json()["code"] == "CSV_FINALIZE_FAILED"

    fake2 = _supabase(existing_row=None)
    with patch("routers.process_key.get_supabase", return_value=fake2):
        missing_sid = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "user_id": "u1",
                    "wizard_session_id": "wiz-no-sid-10b",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sCjE=",
                },
            },
            headers=_auth_headers(),
        )
    assert missing_sid.status_code == 422, missing_sid.text
    assert missing_sid.json()["code"] == "MISSING_STRATEGY_ID"
