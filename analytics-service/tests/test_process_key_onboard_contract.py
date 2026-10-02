"""Phase 140.1.1 / PYAPIFIX-01 — the Python half of the cross-PROCESS contract.

The finding this file closes is NOT "the reply shape is wrong". It is that
**both suites were green because each mocked the other**: the pytest suite
asserted the reply against expectations written in Python, and the vitest suite
asserted the guard against fixtures written in TypeScript, so nobody ever
compared the two. `routers/process_key.py:_wizard_duplicate_reply` emits
`queued:true` alongside `code`/`idempotent`, and
`src/lib/process-key-onboard-contract.ts` rejects exactly that — a 502 arm
neither suite could see.

So this test does the one thing that closes it: it drives the **REAL**
`/process-key` route through the **FULL** `main.app` middleware stack and
asserts the body equals the **committed** fixture
`tests/fixtures/process_key_onboard_contract.json`, whose OTHER consumer
(`tests/lib/process-key-onboard-contract-parity.test.ts`, added by plan
140.1.1-05) runs the real TypeScript predicate over the same bytes. One
artifact, two processes, zero mocks between them.

Deliberate design constraints, each load-bearing:

* **Nothing is imported from `routers.process_key`.** Not the reply builder,
  not the status constants, not the code string. An oracle that read its
  expectations out of the module under test could not fail when that module
  drifts — which is the precise defect being closed.
* **The FULL stack, not the bare router.** `tests/test_process_key.py`'s
  `client` fixture mounts the router in a bare `FastAPI()` for unit isolation.
  That is the wrong harness here: a contract test that bypasses
  `main.verify_service_key` is not proving the shape that goes on the wire.
  This file uses `main.app`, exactly as that file's `middleware_client` does.
* **Stubs live at the DB/RPC boundary only.** `_wizard_duplicate_reply`,
  `_resume_duplicate_job` and the route handler are never patched — patching
  the reply builder would make this a mock agreeing with a mock again. The
  supabase client is faked because it is a network dependency, and the two
  duplicate arms are selected purely by the `strategy_verifications.status`
  the fake returns (`draft` → resumable → `queued:true`; `published` →
  finished → `queued:false`).
* **The equality is split by intent.** The sorted key set is pinned exactly
  (so a field added or dropped on either side reddens), the five discriminant
  values are pinned exactly, and the four instance-specific keys
  (`verification_id`, `correlation_id`, `status`, `trust_tier`) are pinned by
  TYPE — they carry per-request identifiers, so pinning their values would
  pin the fake rather than the contract.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# The shared artifact. Loaded, never generated: the `python` (ci.yml:933) and
# `frontend-test` (ci.yml:206) jobs are siblings with no `needs:` edge, so a
# file one job writes is invisible to the other.
# ---------------------------------------------------------------------------

_FIXTURE = Path(__file__).parent / "fixtures" / "process_key_onboard_contract.json"
_SPEC: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_CASES: list[dict[str, Any]] = _SPEC["cases"]
_BY_NAME: dict[str, dict[str, Any]] = {c["name"]: c for c in _CASES}

# Keys whose VALUE is the contract — a change here is a contract change.
_DISCRIMINANT_KEYS = ("ok", "code", "idempotent", "queued", "job_state")

# Synthetic identities. Written as literals here AND in the fixture; the two
# are compared, never sourced from one another.
_OWNER_ID = "11111111-aaaa-4aaa-8aaa-000000000001"
_OWNED_STRATEGY_ID = "22222222-bbbb-4bbb-8bbb-000000000002"
_SESSION_ID = "33333333-cccc-4ccc-8ccc-000000000003"
_CORRELATION_ID = "11111111-1111-4111-8111-111111111111"
_TOKEN = "a" * 64


# ---------------------------------------------------------------------------
# DB/RPC boundary fake. This is the ONLY thing stubbed.
# ---------------------------------------------------------------------------


class _Builder:
    """Self-chaining PostgREST builder — mirrors the supabase-py surface the
    route touches. Terminal `.execute()` reads the scripted `(table, op)`
    response."""

    def __init__(self, table: str, client: "_FakeSupabase") -> None:
        self._table = table
        self._client = client
        self._op = "select"

    def select(self, *_a: Any, **_k: Any) -> "_Builder":
        self._op = "select"
        return self

    def insert(self, *_a: Any, **_k: Any) -> "_Builder":
        self._op = "insert"
        return self

    def update(self, *_a: Any, **_k: Any) -> "_Builder":
        self._op = "update"
        return self

    def eq(self, *_a: Any, **_k: Any) -> "_Builder":
        return self

    def maybe_single(self) -> "_Builder":
        return self

    def single(self) -> "_Builder":
        return self

    def limit(self, *_a: Any, **_k: Any) -> "_Builder":
        return self

    def order(self, *_a: Any, **_k: Any) -> "_Builder":
        return self

    def execute(self) -> Any:
        return self._client._execute(self._table, self._op)


class _FakeSupabase:
    """Scripted supabase client. `responses` maps `(table, op)` to a `.data`
    value; `rpc_responses` maps an RPC name the same way."""

    _DEFAULT_DATA: dict[str, Any] = {
        "insert": [{"id": "ver-1"}],
        "select": None,
        "update": [{"id": "s1"}],
    }

    def __init__(
        self,
        *,
        responses: dict[tuple[str, str], Any] | None = None,
        rpc_responses: dict[str, Any] | None = None,
    ) -> None:
        self._responses = dict(responses or {})
        self._rpc_responses = dict(rpc_responses or {})
        self.rpc_calls: list[str] = []

    def table(self, name: str) -> _Builder:
        return _Builder(name, self)

    def rpc(self, name: str, params: Any = None) -> Any:
        outer = self

        class _RpcChain:
            def execute(self) -> Any:
                outer.rpc_calls.append(name)
                return MagicMock(data=outer._rpc_responses.get(name))

        return _RpcChain()

    def _execute(self, table: str, op: str) -> Any:
        if (table, op) in self._responses:
            return MagicMock(data=self._responses[(table, op)])
        return MagicMock(data=self._DEFAULT_DATA.get(op))


def _onboard_body() -> dict[str, Any]:
    """onboard/okx — a long-fetch flow carrying the caller-supplied
    `wizard_session_id` the duplicate path is gated on
    (`process_key.py`'s `idempotent_by_session`). No live TypeScript caller
    sends one today, which is why H-5 is latent; the contract still has to be
    coherent for the callers 140.2/140.3 add."""
    return {
        "flow_type": "onboard",
        "source": "okx",
        "context": {
            "strategy_id": _OWNED_STRATEGY_ID,
            "user_id": _OWNER_ID,
            "wizard_session_id": _SESSION_ID,
            "api_key": "k",
            "api_secret": "s",
        },
    }


@pytest.fixture
def full_stack_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The FULL `main.app` (so `verify_service_key` runs), as a TestClient.

    Copied from `tests/test_process_key.py`'s `middleware_client`. `main` is
    imported inside the fixture, not at module scope, so this file never
    perturbs the import order `tests/test_process_key.py` depends on.
    """
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    import main

    return TestClient(main.app, raise_server_exceptions=False)


def _post_duplicate(client: TestClient, *, existing_status: str) -> Any:
    """Drive the REAL duplicate arm. `existing_status` alone selects which one:
    a resumable `draft` reaches the enqueue, a finished status does not."""
    responses: dict[tuple[str, str], Any] = {
        ("strategies", "select"): {"id": _OWNED_STRATEGY_ID},
        ("strategy_verifications", "select"): {
            "id": "ver-under-test",
            "status": existing_status,
            "trust_tier": "api_verified",
        },
        ("compute_jobs", "select"): {"status": "pending"},
    }
    sb = _FakeSupabase(
        responses=responses,
        rpc_responses={"enqueue_compute_job": "job-under-test"},
    )
    with patch("routers.process_key.get_supabase", return_value=sb):
        return client.post(
            "/process-key",
            json=_onboard_body(),
            headers={
                "Authorization": f"Bearer {_TOKEN}",
                "X-Correlation-Id": _CORRELATION_ID,
            },
        )


def _assert_matches_fixture(actual: dict[str, Any], case_name: str) -> None:
    """The equality itself. The fixture is the ONLY oracle."""
    expected = _BY_NAME[case_name]["body"]

    assert sorted(actual.keys()) == sorted(expected.keys()), (
        f"the real /process-key reply and fixture case '{case_name}' disagree on "
        f"their KEY SET. A field added on either side of this process boundary "
        f"without updating the other is exactly the drift PYAPIFIX-01 closes. "
        f"only in reply: {sorted(set(actual) - set(expected))}; "
        f"only in fixture: {sorted(set(expected) - set(actual))}"
    )

    for key, expected_value in expected.items():
        assert type(actual[key]) is type(expected_value), (
            f"case '{case_name}' key '{key}': the real reply carries "
            f"{type(actual[key]).__name__} but the fixture declares "
            f"{type(expected_value).__name__} — the TypeScript guard type-checks "
            f"every one of these, so a type change is a contract break"
        )

    for key in _DISCRIMINANT_KEYS:
        assert actual[key] == expected[key], (
            f"case '{case_name}' key '{key}': the real reply says "
            f"{actual[key]!r}, the fixture says {expected[key]!r}. These five "
            f"keys ARE the contract — the TypeScript consumer branches on them"
        )


# ---------------------------------------------------------------------------
# Silent-shrink guard (the pii-scrub / window-overlap idiom). A fixture that
# quietly loses cases weakens both consumers at once and nothing else notices.
# ---------------------------------------------------------------------------


def test_fixture_carries_exactly_the_five_declared_cases() -> None:
    assert len(_CASES) == 5, (
        "process_key_onboard_contract.json must carry exactly 5 cases (2 real "
        "emitted shapes + 3 shapes the guard must reject). The 3 negatives are "
        "what stops plan 05's widening from degrading into `() => true`; "
        "dropping them would leave a green suite and no guard"
    )
    verdicts = {c["expect_valid"] for c in _CASES}
    assert verdicts == {True, False}, (
        "both verdicts must appear — an all-positive corpus proves acceptance "
        "with no evidence the guard can still reject anything"
    )
    assert sum(1 for c in _CASES if c["expect_valid"]) == 2
    assert sum(1 for c in _CASES if not c["expect_valid"]) == 3
    assert len({c["name"] for c in _CASES}) == 5, "case names must be unique"


def test_fixture_names_both_cross_process_consumers() -> None:
    """The artifact must say who reads it, or the next author moves it and
    silently unbinds one side (E-P1's header idiom)."""
    joined = " ".join(_SPEC["consumers"])
    assert "tests/test_process_key_onboard_contract.py" in joined
    assert "tests/lib/process-key-onboard-contract-parity.test.ts" in joined


# ---------------------------------------------------------------------------
# The contract itself — real route, real middleware, both duplicate arms.
# ---------------------------------------------------------------------------


def test_queued_true_arm_matches_fixture(full_stack_client: TestClient) -> None:
    """P1 — the resumed wedge. A still-`draft` verification replayed on a
    long-fetch flow re-enqueues, so the reply reports `queued:true` while
    STILL carrying `code`/`idempotent`.

    This is the exact body `isProcessKeyOnboardResponse` rejects at HEAD, and
    the rejection arm answers 502 + Sentry. Pinning it here is what makes the
    TypeScript side's acceptance (plan 05) a proven fact rather than a claim
    about a shape someone typed into a vitest file.
    """
    r = _post_duplicate(full_stack_client, existing_status="draft")

    assert r.status_code == 200, r.text
    _assert_matches_fixture(r.json(), "queued_true_resumed_wedge")


def test_queued_false_arm_matches_fixture(full_stack_client: TestClient) -> None:
    """P2 — a duplicate for a verification that already finished. No background
    job applies, so `queued:false` / `job_state:"not_applicable"`.

    This arm is the regression control: it was accepted by the guard before
    PYAPI-09 and must still be accepted after the widening. Without it, a
    widening that simply stopped inspecting `queued` would look correct.
    """
    r = _post_duplicate(full_stack_client, existing_status="published")

    assert r.status_code == 200, r.text
    _assert_matches_fixture(r.json(), "queued_false_finished_duplicate")


def test_the_two_arms_are_genuinely_different_replies(
    full_stack_client: TestClient,
) -> None:
    """Neither positive case may be a copy of the other.

    Two fixtures that happen to be identical would let a single-arm fix pass
    for a two-arm one — the exact failure `_wizard_duplicate_reply`'s
    one-builder design exists to prevent. Asserted against the REAL replies,
    not the fixture, so it also fails if the route collapses the arms.
    """
    queued_true = _post_duplicate(full_stack_client, existing_status="draft").json()
    queued_false = _post_duplicate(
        full_stack_client, existing_status="published"
    ).json()

    assert queued_true["queued"] is True
    assert queued_false["queued"] is False
    assert queued_true["job_state"] != queued_false["job_state"]


def test_negative_cases_are_not_shapes_the_route_can_emit() -> None:
    """The 3 negatives must be UNREACHABLE, not merely unwanted.

    A negative the route can actually produce would make plan 05's TypeScript
    guard reject live traffic — turning a contract test into a 502 generator.
    Checked structurally against the two proven-real positive shapes.
    """
    real_key_sets = [
        frozenset(_BY_NAME[name]["body"])
        for name in ("queued_true_resumed_wedge", "queued_false_finished_duplicate")
    ]

    for case in _CASES:
        if case["expect_valid"]:
            continue
        body = case["body"]
        differs = frozenset(body) not in real_key_sets or (
            body.get("code") != "WIZARD_DUPLICATE"
        )
        assert differs, (
            f"negative case '{case['name']}' has the same key set AND the same "
            f"code as a shape the real route emits — rejecting it would 502 on "
            f"live traffic"
        )
