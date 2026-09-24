"""Phase 141 / SEAM-06 — resync's draft strategy_verifications write must be
deduped against a DUPLICATE SUBMIT.

⚠️ This line used to read "idempotent for the SEQUENTIAL retry class". Phase
141.1 re-derived that claim and found it false, and 141.2 / D-03 withdrew the
retry grant it justified (the TypeScript seam registry carries a NO verdict for
resync, so no resync retry is issued at all). The corrected statement of what
this file pins lives in `routers/process_key.py`'s SCOPE BOUND comment: the
guard closes the case where the first attempt's draft is STILL IN `draft` when a
duplicate submit arrives, and it is not an idempotency key. Corrected here by
Phase 163 / OPS-09 — the header outlived the correction by one file.

WHY this file exists
--------------------
Phase 141 adds a bounded retry to the Vercel->Railway seam, but a retry may only
be enabled for a flow that cannot double-execute a side effect. `resync` runs on
a SERVER-MINTED `wizard_session_id` (`process_key.py:1018`), so it is
`idempotent_by_session == False` by construction: the onboard duplicate pre-check
(`process_key.py:1351`) never fires for it, and a seam retry that re-reaches the
handler would mint a SECOND draft SV row for the same strategy. resync is
allowlisted for retry (plan 03) ONLY AFTER the dedup this file pins lands
(141-CONTEXT locked decision).

Harness discipline (mirrors `tests/test_process_key_onboard_contract.py`)
-------------------------------------------------------------------------
* The FULL `main.app` stack is driven through a `TestClient`, so
  `verify_service_key` / the rate-limit gate run — not the bare router.
* The ONLY stubbed boundaries are network dependencies:
  `routers.process_key.get_supabase` (the DB), and — for the teaser negative
  control only — `routers.process_key.get_adapter` (the exchange, a network
  boundary identical in kind to the DB). The reply builder,
  `_resume_duplicate_job`, and the route handler are NEVER patched: patching any
  of them would make the oracle agree with a mock instead of the real route.
* The fake supabase is STATEFUL (it stores inserts and honours `.eq()` filters),
  because these tests count rows across two submissions — a scripted response
  fake could not observe a duplicate insert. It deliberately enforces NO
  uniqueness: the DB index behaviour that could dedup is proven separately
  against real Postgres in `supabase/tests/test_resync_retry_single_job.sql`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Literal fixtures. Never imported from the module under test (oracle
# independence).
_TOKEN = "a" * 64
_USER_ID = "aaaaaaaa-0000-4000-8000-000000000001"
_STRATEGY_A = "bbbbbbbb-0000-4000-8000-00000000000a"
_STRATEGY_B = "bbbbbbbb-0000-4000-8000-00000000000b"
_CORRELATION_ID = "11111111-1111-4111-8111-111111111111"

# compute_jobs statuses the enqueue RPC dedupes over (mirrors the real RPC's
# non-terminal set; see test_enqueue_compute_job_dedupe_non_terminal.sql).
_NON_TERMINAL = {"pending", "running", "done_pending_children"}


# ---------------------------------------------------------------------------
# Stateful DB/RPC boundary fake. The ONLY DB stub.
# ---------------------------------------------------------------------------


class _StoreBuilder:
    """Self-chaining PostgREST builder that records its filters/payload so the
    terminal `.execute()` can run a real (tiny) in-memory query."""

    def __init__(self, table: str, client: "_StatefulSupabase") -> None:
        self._table = table
        self._client = client
        self._op = "select"
        self._filters: dict[str, Any] = {}
        self._gte: dict[str, Any] = {}
        self._in: dict[str, list[Any]] = {}
        self._order: list[tuple[str, bool]] = []
        self._payload: Any = None
        self._limit: int | None = None
        self._single = False

    def select(self, *_a: Any, **_k: Any) -> "_StoreBuilder":
        self._op = "select"
        return self

    def insert(self, payload: Any, *_a: Any, **_k: Any) -> "_StoreBuilder":
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload: Any = None, *_a: Any, **_k: Any) -> "_StoreBuilder":
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, col: str, val: Any) -> "_StoreBuilder":
        self._filters[col] = val
        return self

    def in_(self, col: str, values: Any) -> "_StoreBuilder":
        """A REAL ``IN`` filter (2026-09-24, the resync chain-in-flight guard).

        A no-op here would let the guard's kind and status filters be deleted
        with every test still green, so it filters for real."""
        self._in[col] = list(values)
        return self

    def maybe_single(self) -> "_StoreBuilder":
        self._single = True
        return self

    def single(self) -> "_StoreBuilder":
        self._single = True
        return self

    def limit(self, n: int) -> "_StoreBuilder":
        self._limit = n
        return self

    def gte(self, col: str, val: Any) -> "_StoreBuilder":
        """A REAL ``>=`` filter (OPS-09, Phase 163).

        Added when `process_key`'s resync pre-check gained its bounded window. A
        no-op stub here would make the bound untestable: the ancient-orphan case
        would pass whether or not the production code carried the clause.
        """
        self._gte[col] = val
        return self

    def order(self, col: str, *_a: Any, desc: bool = False, **_k: Any) -> "_StoreBuilder":
        """A REAL sort (OPS-09, Phase 163).

        ⚠️ This USED to be `return self` — a silent no-op. That is why it is
        called out: with a no-op `order`, a select's result stayed in insertion
        order, so a test asserting "the pre-check resumes the NEWEST draft" would
        have passed with the production `.order(...)` clause deleted. The gate
        could not fail, which is worse than not having it
        (`tests/test_limiter_identity.py` module docstring, non-negotiable #3).
        """
        self._order.append((col, desc))
        return self

    def execute(self) -> Any:
        return self._client._run(self)


class _StatefulSupabase:
    """A minimal in-memory supabase double. Stores rows per table, honours
    `.eq()` equality filters, and simulates `enqueue_compute_job`'s
    (strategy_id, kind) dedup over non-terminal statuses."""

    def __init__(self, *, strategies: list[dict[str, Any]] | None = None) -> None:
        self.store: dict[str, list[dict[str, Any]]] = {
            "strategies": [dict(r) for r in (strategies or [])],
            "strategy_verifications": [],
            "compute_jobs": [],
        }
        self.rpc_calls: list[str] = []
        self._seq = 0
        # Review-fix round 1 (MEDIUM-3): per-table queue of exceptions a SELECT
        # raises before it reads, one per call, so a test can make a read fail
        # (or fail once and then succeed). A None entry lets that call through.
        # Empty means every read succeeds.
        self.select_failures: dict[str, list[BaseException | None]] = {}

    def table(self, name: str) -> _StoreBuilder:
        return _StoreBuilder(name, self)

    def rpc(self, name: str, params: Any = None) -> Any:
        client = self

        class _Rpc:
            def execute(self_inner) -> Any:
                client.rpc_calls.append(name)
                return client._run_rpc(name, params)

        return _Rpc()

    # -- internals ---------------------------------------------------------

    def _run_rpc(self, name: str, params: Any) -> Any:
        if name == "enqueue_compute_job":
            sid = (params or {}).get("p_strategy_id")
            kind = (params or {}).get("p_kind")
            jobs = self.store["compute_jobs"]
            for j in jobs:
                if (
                    j["strategy_id"] == sid
                    and j["kind"] == kind
                    and j["status"] in _NON_TERMINAL
                ):
                    return MagicMock(data=j["id"])
            self._seq += 1
            jid = f"job-{self._seq}"
            jobs.append(
                {"id": jid, "strategy_id": sid, "kind": kind, "status": "pending"}
            )
            return MagicMock(data=jid)
        return MagicMock(data=None)

    @staticmethod
    def _match(row: dict[str, Any], b: _StoreBuilder) -> bool:
        if not all(row.get(k) == v for k, v in b._filters.items()):
            return False
        if not all(row.get(k) in v for k, v in b._in.items()):
            return False
        for col, bound in b._gte.items():
            actual = row.get(col)
            # FAIL LOUD. A missing column silently compared as "excluded" would
            # make a bounded query look like it filtered when it merely could not
            # see the data. Every column this fake is filtered on is NOT NULL in
            # `supabase/migrations/20260501055202_strategy_verifications.sql`.
            assert actual is not None, (
                f"harness: row in {b._table!r} has no {col!r} to compare against "
                f"the >= bound {bound!r}. The fake's insert path must stamp it "
                "(the real column is NOT NULL DEFAULT now())."
            )
            if actual < bound:
                return False
        return True

    def _run(self, b: _StoreBuilder) -> Any:
        table = self.store.setdefault(b._table, [])
        if b._op == "insert":
            items = b._payload if isinstance(b._payload, list) else [b._payload]
            out: list[dict[str, Any]] = []
            for it in items:
                row = dict(it)
                if not row.get("id"):
                    self._seq += 1
                    row["id"] = f"{b._table[:3]}-{self._seq}"
                # Simulate `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
                # (migration 20260501055202). The route never sends the column, so
                # without this the DB default is invisible to the fake and any
                # `.gte("created_at", ...)` read would see None.
                if not row.get("created_at"):
                    row["created_at"] = datetime.now(timezone.utc).isoformat()
                table.append(row)
                out.append(dict(row))
            return MagicMock(data=out)
        if b._op == "update":
            matched = [r for r in table if self._match(r, b)]
            for r in matched:
                if isinstance(b._payload, dict):
                    r.update(b._payload)
            return MagicMock(data=[dict(r) for r in matched])
        # select
        pending_failures = self.select_failures.get(b._table)
        if pending_failures:
            failure = pending_failures.pop(0)
            if failure is not None:
                raise failure
        matched = [r for r in table if self._match(r, b)]
        # ORDER BY before LIMIT — the SQL evaluation order, and the whole point of
        # the OPS-09 gate. Applied last-key-first so a multi-key `.order()` chain
        # sorts by the FIRST key primarily (Python sorts are stable).
        for col, desc in reversed(b._order):
            matched = sorted(matched, key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        if b._limit is not None:
            matched = matched[: b._limit]
        if b._single:
            # `.maybe_single().execute()` returns None (NOT a resp with
            # data=None) when zero rows match — the exact runtime contract
            # services.db.one() is written against.
            return MagicMock(data=dict(matched[0])) if matched else None
        return MagicMock(data=[dict(r) for r in matched])


# ---------------------------------------------------------------------------
# Harness + bodies.
# ---------------------------------------------------------------------------


@pytest.fixture
def full_stack_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The FULL `main.app` (so `verify_service_key` runs), as a TestClient.
    `main` is imported inside the fixture (not at module scope) so this file
    never perturbs another test module's import order."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    import main

    return TestClient(main.app, raise_server_exceptions=False)


def make_supabase(*owned_strategy_ids: str) -> _StatefulSupabase:
    """A fake seeded so the ownership gate (`_caller_owns_strategy`) passes for
    each id, all owned by `_USER_ID`."""
    return _StatefulSupabase(
        strategies=[{"id": sid, "user_id": _USER_ID} for sid in owned_strategy_ids]
    )


def _resync_body(strategy_id: str) -> dict[str, Any]:
    """/api/keys/sync's shape: resync carries only strategy_id + user_id (no
    api_key/api_secret, no step) — the worker resolves creds server-side."""
    return {
        "flow_type": "resync",
        "source": "binance",
        "context": {"strategy_id": strategy_id, "user_id": _USER_ID},
    }


def _teaser_body() -> dict[str, Any]:
    """teaser is synchronous and requires credentials in context; its
    strategy_id is force-overwritten to the anchor and its session id minted
    fresh server-side."""
    return {
        "flow_type": "teaser",
        "source": "binance",
        "context": {"api_key": "k", "api_secret": "s"},
    }


def _post(client: TestClient, body: dict[str, Any]) -> Any:
    return client.post(
        "/process-key",
        json=body,
        headers={
            "Authorization": f"Bearer {_TOKEN}",
            "X-Correlation-Id": _CORRELATION_ID,
        },
    )


def reject_adapter() -> MagicMock:
    """A teaser adapter whose validate() fails — so the synchronous pipeline
    rejects at the scope gate AFTER the draft SV insert, without any real
    exchange call or further adapter surface (fetch_raw/compute_metrics)."""
    from services.ingestion.adapter import ValidationResult

    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=False,
            read_only=None,
            error_code="AUTH_FAILED",
            human_message="bad key",
            debug_context={},
        )
    )
    return adapter


def _resync_drafts(sb: _StatefulSupabase, strategy_id: str) -> list[dict[str, Any]]:
    return [
        r
        for r in sb.store["strategy_verifications"]
        if r.get("strategy_id") == strategy_id
        and r.get("flow_type") == "resync"
        and r.get("status") == "draft"
    ]


# ---------------------------------------------------------------------------
# The contract.
# ---------------------------------------------------------------------------


def test_retried_resync_yields_one_draft_and_wizard_duplicate(
    full_stack_client: TestClient,
) -> None:
    """SC2 server half — a retried (sequential second identical) resync yields
    exactly ONE draft SV row and a WIZARD_DUPLICATE reply. Before the pre-check
    this observes TWO rows (the RED)."""
    sb = make_supabase(_STRATEGY_A)
    with patch("routers.process_key.get_supabase", return_value=sb):
        r1 = _post(full_stack_client, _resync_body(_STRATEGY_A))
        r2 = _post(full_stack_client, _resync_body(_STRATEGY_A))

    drafts = _resync_drafts(sb, _STRATEGY_A)
    assert len(drafts) == 1, (
        f"a retried (sequential second identical) resync minted {len(drafts)} "
        f"draft strategy_verifications rows for strategy {_STRATEGY_A}, expected "
        f"exactly 1 — the resync draft-SV dedup pre-check did not fire"
    )
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r2.json().get("code") == "WIZARD_DUPLICATE", (
        f"the second (duplicate) resync reply was {r2.json()!r}, expected "
        f"code == 'WIZARD_DUPLICATE' from the shared _wizard_duplicate_reply"
    )


def test_duplicate_path_reenqueues(full_stack_client: TestClient) -> None:
    """The duplicate path resumes the compute_job via _resume_duplicate_job —
    exactly the onboard duplicate contract's enqueue-aware behaviour — so a
    wedged (draft-committed, never-enqueued) session recovers on retry."""
    sb = make_supabase(_STRATEGY_A)
    with patch("routers.process_key.get_supabase", return_value=sb):
        _post(full_stack_client, _resync_body(_STRATEGY_A))
        r2 = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r2.json().get("code") == "WIZARD_DUPLICATE", r2.text
    assert r2.json().get("queued") is True, (
        "the duplicate reply must report queued:true — _resume_duplicate_job "
        "re-enqueues a resumable (draft) long-fetch session"
    )
    assert sb.rpc_calls.count("enqueue_compute_job") >= 2, (
        "enqueue_compute_job must be re-called on the second (duplicate) "
        "submission via _resume_duplicate_job; it was called "
        f"{sb.rpc_calls.count('enqueue_compute_job')} time(s)"
    )


def test_teaser_is_not_deduped_two_rows(full_stack_client: TestClient) -> None:
    """Negative control — the resync-scoped pre-check must NOT widen into
    teaser. Two teaser submissions still mint TWO draft rows (SC3's contract:
    teaser is deliberately non-idempotent)."""
    sb = _StatefulSupabase()  # ownership gate is skipped for teaser
    stub = reject_adapter()
    with patch("routers.process_key.get_supabase", return_value=sb), patch(
        "routers.process_key.get_adapter", return_value=stub
    ):
        _post(full_stack_client, _teaser_body())
        _post(full_stack_client, _teaser_body())

    teaser_rows = [
        r
        for r in sb.store["strategy_verifications"]
        if r.get("flow_type") == "teaser"
    ]
    assert len(teaser_rows) == 2, (
        f"two teaser submissions produced {len(teaser_rows)} SV rows, expected "
        f"2 — the resync dedup must be flow-scoped and must not touch teaser"
    )


def test_resync_dedup_is_strategy_scoped(full_stack_client: TestClient) -> None:
    """The pre-check is strategy-scoped — a resync for strategy B does not hit
    strategy A's draft. Two different strategy_ids → one draft each."""
    sb = make_supabase(_STRATEGY_A, _STRATEGY_B)
    with patch("routers.process_key.get_supabase", return_value=sb):
        _post(full_stack_client, _resync_body(_STRATEGY_A))
        _post(full_stack_client, _resync_body(_STRATEGY_B))

    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1
    assert len(_resync_drafts(sb, _STRATEGY_B)) == 1


# ---------------------------------------------------------------------------
# 2026-09-24 — the resync chain-in-flight guard.
#
# Found live: a manager's wizard reload during a ~16-minute Bybit chain started
# a SECOND chain, because the draft pre-check only matches `status='draft'` and
# process_key_long moves the verification out of draft within seconds. The SQL
# status bridge then wrote `computing` back over the first chain's `complete`,
# so the wizard poll never saw it finish.
#
# The oracle below is independent of the module under test: the chain kinds
# and statuses are typed here, not imported.
# ---------------------------------------------------------------------------

_CHAIN_KINDS_LITERAL = (
    "process_key_long",
    "sync_trades",
    "derive_broker_dailies",
    "compute_analytics_from_csv",
)
_NON_TERMINAL_LITERAL = ("pending", "running", "failed_retry", "done_pending_children")


def _seed_advanced_session(
    sb: _StatefulSupabase,
    strategy_id: str,
    *,
    job_kind: str,
    job_status: str,
    **job_fields: Any,
) -> dict[str, Any]:
    """A first resync whose verification has LEFT draft, with one chain job of
    `job_kind` at `job_status`. The shape the live incident had."""
    ver = {
        "id": "ver-advanced",
        "strategy_id": strategy_id,
        "wizard_session_id": "dddddddd-0000-4000-8000-00000000000d",
        "status": "validated",
        "trust_tier": "api_verified",
        "flow_type": "resync",
        "source": "bybit",
        "correlation_id": "33333333-3333-4333-8333-333333333333",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    sb.store["strategy_verifications"].append(ver)
    sb.store["compute_jobs"].append(
        {
            "id": "job-seeded",
            "strategy_id": strategy_id,
            "kind": job_kind,
            "status": job_status,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **job_fields,
        }
    )
    return ver


@pytest.mark.parametrize("job_status", _NON_TERMINAL_LITERAL)
@pytest.mark.parametrize("job_kind", _CHAIN_KINDS_LITERAL)
def test_resync_while_a_chain_job_is_non_terminal_starts_no_second_chain(
    full_stack_client: TestClient, job_kind: str, job_status: str
) -> None:
    """A resync that arrives after the first session left draft, while any job
    of the chain is still non-terminal, is a WIZARD_DUPLICATE: no new draft,
    no enqueue call. This is the reload/Retry case from the live incident."""
    sb = make_supabase(_STRATEGY_A)
    # Only process_key_long carries its session's verification_id (the
    # follow-on hops are enqueued with no metadata), as in production.
    job_fields: dict[str, Any] = (
        {"metadata": {"verification_id": "ver-advanced"}}
        if job_kind == "process_key_long"
        else {}
    )
    ver = _seed_advanced_session(
        sb, _STRATEGY_A, job_kind=job_kind, job_status=job_status, **job_fields
    )
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload.get("code") == "WIZARD_DUPLICATE", (
        f"a {job_kind} job at {job_status} is a chain still doing work; a resync "
        f"now must not start a second chain. got {payload}"
    )
    assert payload["queued"] is True and payload["job_state"] == "running", payload
    if job_kind == "process_key_long":
        # The job names its own session, and it is the newest: its status holds.
        assert payload["verification_id"] == ver["id"], payload
        assert payload["status"] == ver["status"], payload
    else:
        # A follow-on hop names no session, so no verification's status is
        # presented as this chain's (review-fix round 1, MEDIUM-4).
        assert payload["verification_id"] is None, payload
        assert payload["status"] is None, payload
    assert _resync_drafts(sb, _STRATEGY_A) == [], "no new draft may be minted"
    assert "enqueue_compute_job" not in sb.rpc_calls, (
        f"no job may be enqueued while the chain is in flight; rpc_calls={sb.rpc_calls}"
    )


@pytest.mark.parametrize("job_status", ("done", "failed_final"))
def test_resync_after_the_chain_finished_starts_a_new_chain(
    full_stack_client: TestClient, job_status: str
) -> None:
    """Negative control: a TERMINAL chain job must not block. Without this the
    guard could pass the test above by refusing every resync."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(
        sb, _STRATEGY_A, job_kind="compute_analytics_from_csv", job_status=job_status
    )
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.status_code == 200, r.text
    assert r.json().get("code") != "WIZARD_DUPLICATE", r.json()
    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1
    assert "enqueue_compute_job" in sb.rpc_calls


def test_resync_is_not_blocked_by_a_non_chain_job(full_stack_client: TestClient) -> None:
    """Negative control on KIND: a running recurring job (reconcile_strategy)
    says nothing about the factsheet chain and must not block a resync."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(sb, _STRATEGY_A, job_kind="reconcile_strategy", job_status="running")
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.json().get("code") != "WIZARD_DUPLICATE", r.json()
    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1


def test_resync_is_not_blocked_by_another_strategys_chain(
    full_stack_client: TestClient,
) -> None:
    """The guard is strategy-scoped: strategy B's running chain does not block
    a resync of strategy A."""
    sb = make_supabase(_STRATEGY_A, _STRATEGY_B)
    _seed_advanced_session(sb, _STRATEGY_B, job_kind="sync_trades", job_status="running")
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.json().get("code") != "WIZARD_DUPLICATE", r.json()
    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1


def test_resync_chain_kinds_match_the_typescript_factsheet_chain() -> None:
    """Drift pin: the Python guard derives its kinds from JOB_CHAIN_FOLLOW_ON,
    while the wizard's progress read uses FACTSHEET_CHAIN_KINDS in
    src/lib/compute-state.ts. They must name the same chain (the TS set also
    keeps the legacy `compute_analytics` kind for historical rows)."""
    import re
    from pathlib import Path

    from routers.process_key import _NON_TERMINAL_JOB_STATUSES, _RESYNC_CHAIN_KINDS

    ts = (Path(__file__).resolve().parents[2] / "src/lib/compute-state.ts").read_text()
    block = re.search(r"FACTSHEET_CHAIN_KINDS = \[(.*?)\] as const", ts, re.S)
    assert block is not None, "FACTSHEET_CHAIN_KINDS not found in compute-state.ts"
    ts_kinds = set(re.findall(r'"([a-z_]+)"', block.group(1)))
    assert ts_kinds - {"compute_analytics"} == set(_RESYNC_CHAIN_KINDS)
    assert set(_RESYNC_CHAIN_KINDS) == set(_CHAIN_KINDS_LITERAL)
    assert set(_NON_TERMINAL_JOB_STATUSES) == set(_NON_TERMINAL_LITERAL)
    # The status half (review-fix round 1): the wizard reads "in flight" off
    # `IN_FLIGHT_JOB_STATUSES`, and the server refuses a resync over
    # `_NON_TERMINAL_JOB_STATUSES`. If they differ, the client and the server
    # disagree about whether a chain is running.
    status_block = re.search(r"IN_FLIGHT_JOB_STATUSES = \[(.*?)\] as const", ts, re.S)
    assert status_block is not None, "IN_FLIGHT_JOB_STATUSES not found in compute-state.ts"
    ts_statuses = set(re.findall(r'"([a-z_]+)"', status_block.group(1)))
    assert ts_statuses == set(_NON_TERMINAL_JOB_STATUSES), (ts_statuses, _NON_TERMINAL_JOB_STATUSES)


def test_the_ts_dead_row_mirror_uses_the_same_live_window() -> None:
    """Round-2 review: `computeJobDeadReason` in src/lib/compute-state.ts mirrors
    `_chain_job_dead_reason`'s observable arms, including the age bound. If the
    two windows differ, a surface reports as dead (and offers a Retry for) a
    job the server still treats as live, or the reverse."""
    import re
    from pathlib import Path

    from routers.process_key import _RESYNC_CHAIN_JOB_LIVE_WINDOW

    ts = (Path(__file__).resolve().parents[2] / "src/lib/compute-state.ts").read_text()
    m = re.search(r"export const CHAIN_JOB_LIVE_WINDOW_MS = ([0-9_ *]+);", ts)
    assert m is not None, "CHAIN_JOB_LIVE_WINDOW_MS not found in compute-state.ts"
    factors = [int(f.replace("_", "")) for f in m.group(1).split("*")]
    ts_ms = 1
    for f in factors:
        ts_ms *= f
    assert ts_ms == int(_RESYNC_CHAIN_JOB_LIVE_WINDOW.total_seconds() * 1000), (
        ts_ms, _RESYNC_CHAIN_JOB_LIVE_WINDOW,
    )


# ---------------------------------------------------------------------------
# Review-fix round 1 (MEDIUM-3) — the guard's two reads go through
# `db_read_with_retry`, and a read that still fails never becomes a 500.
# ---------------------------------------------------------------------------


class _GatewayTimeout(Exception):
    """A PostgREST-shaped gateway 504: `db_read_with_retry` retries on `.code`."""

    code = "504"


@pytest.fixture
def _no_retry_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    import services.db as db_mod

    monkeypatch.setattr(db_mod, "DB_READ_BACKOFF_BASE_S", 0.0)
    monkeypatch.setattr(db_mod, "DB_READ_JITTER_MAX_S", 0.0)


def test_resync_chain_read_failure_falls_through_to_a_new_chain(
    full_stack_client: TestClient,
) -> None:
    """A compute_jobs read that fails for good must not answer 500 on a user's
    Retry. The guard is skipped and the resync takes the pre-guard path: a new
    draft and an enqueue."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(sb, _STRATEGY_A, job_kind="sync_trades", job_status="running")
    sb.select_failures["compute_jobs"] = [RuntimeError("synthetic read failure")]
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.status_code == 200, r.text
    assert r.json().get("code") != "WIZARD_DUPLICATE", r.json()
    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1
    assert "enqueue_compute_job" in sb.rpc_calls


def test_resync_chain_read_gateway_timeout_is_retried(
    full_stack_client: TestClient, _no_retry_sleep: None
) -> None:
    """One gateway 504 on the compute_jobs read is retried, and the retried
    read still finds the running chain: the resync is a duplicate."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(sb, _STRATEGY_A, job_kind="sync_trades", job_status="running")
    sb.select_failures["compute_jobs"] = [_GatewayTimeout("gateway timeout")]
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.status_code == 200, r.text
    assert r.json().get("code") == "WIZARD_DUPLICATE", r.json()
    assert "enqueue_compute_job" not in sb.rpc_calls


def test_resync_verification_read_failure_still_refuses_the_second_chain(
    full_stack_client: TestClient,
) -> None:
    """When the job read found a running chain but the verification read fails,
    the chain is still in flight: the reply is a duplicate with no
    verification status, never a 500 and never a second chain."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(sb, _STRATEGY_A, job_kind="sync_trades", job_status="running")
    # The first strategy_verifications read is the draft pre-check, which
    # finds nothing; the failures land on the guard's verification read.
    sb.select_failures["strategy_verifications"] = [
        None,
        RuntimeError("synthetic read failure"),
    ]
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload.get("code") == "WIZARD_DUPLICATE", payload
    assert payload["status"] is None, payload
    assert "enqueue_compute_job" not in sb.rpc_calls


# ---------------------------------------------------------------------------
# Review-fix round 1 (HIGH-1) — "non-terminal" is not "live". A job whose
# worker keeps dying cycles running -> pending for ever (the watchdog reset
# leaves `attempts` alone and the claim does not cap it), so it must not refuse
# a resync for ever. Nor may a row older than the single-hop window.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("job_status", "job_fields"),
    [
        pytest.param(
            "pending",
            {"attempts": 1, "max_attempts": 3, "last_error": "worker_stalled"},
            id="watchdog-reset-worker-stalled",
        ),
        pytest.param(
            "pending",
            {"attempts": 3, "max_attempts": 3, "last_error": None},
            id="pending-with-its-budget-spent",
        ),
        pytest.param(
            "running",
            {"attempts": 5, "max_attempts": 3, "last_error": None},
            id="running-past-its-budget",
        ),
        pytest.param(
            "running",
            {
                "attempts": 1,
                "max_attempts": 3,
                "created_at": (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat(),
            },
            id="older-than-the-live-window",
        ),
    ],
)
def test_resync_is_not_refused_by_a_chain_job_that_is_not_live(
    full_stack_client: TestClient, job_status: str, job_fields: dict[str, Any]
) -> None:
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(
        sb, _STRATEGY_A, job_kind="sync_trades", job_status=job_status, **job_fields
    )
    with (
        patch("routers.process_key.get_supabase", return_value=sb),
        patch("routers.process_key.sentry_sdk.capture_message") as capture,
    ):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.status_code == 200, r.text
    assert r.json().get("code") != "WIZARD_DUPLICATE", (
        f"a {job_status} row {job_fields} is not a live chain; refusing the resync "
        f"would strand the user. got {r.json()}"
    )
    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1
    assert "enqueue_compute_job" in sb.rpc_calls
    if "created_at" not in job_fields:
        # A crash-looping row is reported, not skipped silently.
        assert capture.call_count == 1, capture.call_args_list


def test_a_running_job_on_its_final_attempt_is_still_live(
    full_stack_client: TestClient,
) -> None:
    """Control: the claim counts the attempt it starts, so a running row AT its
    budget is its legitimate last try and must still refuse a second chain."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(
        sb, _STRATEGY_A, job_kind="sync_trades", job_status="running",
        attempts=3, max_attempts=3, last_error=None,
    )
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.json().get("code") == "WIZARD_DUPLICATE", r.json()
    assert "enqueue_compute_job" not in sb.rpc_calls


def test_a_live_job_still_refuses_beside_a_dead_one(full_stack_client: TestClient) -> None:
    """Control: skipping a dead row must not skip the live row behind it."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(
        sb, _STRATEGY_A, job_kind="derive_broker_dailies", job_status="running",
        attempts=1, max_attempts=3, last_error=None,
        created_at=(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
    )
    sb.store["compute_jobs"].append(
        {
            "id": "job-dead",
            "strategy_id": _STRATEGY_A,
            "kind": "sync_trades",
            "status": "pending",
            "attempts": 1,
            "max_attempts": 3,
            "last_error": "worker_stalled",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    assert r.json().get("code") == "WIZARD_DUPLICATE", r.json()
    assert "enqueue_compute_job" not in sb.rpc_calls


# ---------------------------------------------------------------------------
# Review-fix round 1 (MEDIUM-4) — the reply never presents an unrelated
# verification's status as the running chain's.
# ---------------------------------------------------------------------------


def test_chain_reply_does_not_borrow_a_newer_unrelated_verifications_status(
    full_stack_client: TestClient,
) -> None:
    """The running chain belongs to an OLDER verification; a newer one exists
    (for example a failed onboard attempt). The reply names the chain's own
    session and carries no status, never the newer row's `failed`."""
    sb = make_supabase(_STRATEGY_A)
    _seed_advanced_session(
        sb, _STRATEGY_A, job_kind="process_key_long", job_status="running",
        metadata={"verification_id": "ver-advanced"},
    )
    sb.store["strategy_verifications"].append(
        {
            "id": "ver-newer-unrelated",
            "strategy_id": _STRATEGY_A,
            "status": "failed",
            "trust_tier": "api_verified",
            "flow_type": "resync",
            "created_at": (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat(),
        }
    )
    with patch("routers.process_key.get_supabase", return_value=sb):
        r = _post(full_stack_client, _resync_body(_STRATEGY_A))

    payload = r.json()
    assert payload.get("code") == "WIZARD_DUPLICATE", payload
    assert payload["verification_id"] == "ver-advanced", payload
    assert payload["status"] is None, payload
    assert payload["trust_tier"] is None, payload
