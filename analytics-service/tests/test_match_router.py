"""Coverage for routers/match.py endpoints and helpers.

The FastAPI surface (POST /api/match/recompute, GET /api/match/eval,
POST /api/match/cron-recompute) is exercised against a bare FastAPI app —
no main.py middleware, no live Supabase, no Sentry. Mocking targets the
module-level Supabase factory only.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Bare FastAPI app with routers.match mounted — no middleware.

    Module-scoped so the FastAPI app + router include only happen once per
    test file. Tests monkeypatch module-level globals on `routers.match`,
    not state on the app itself, so sharing the client is safe.
    """
    from routers.match import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# _kill_switch_enabled fail-open contract
# ---------------------------------------------------------------------------


class TestKillSwitchEnabled:
    """Lock the documented fail-open behaviour. Flipping to fail-closed is a
    SECURITY-relevant change that should require an explicit test update."""

    def test_returns_false_when_row_disabled(self, monkeypatch):
        from routers.match import _kill_switch_enabled

        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
            MagicMock(data={"enabled": False})
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

        assert _kill_switch_enabled() is False

    def test_returns_true_when_no_row(self, monkeypatch):
        from routers.match import _kill_switch_enabled

        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
            MagicMock(data=None)
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

        # Default: no row → engine runs.
        assert _kill_switch_enabled() is True

    def test_fail_open_on_supabase_exception(self, monkeypatch, caplog):
        """A Supabase exception logs at ERROR and the engine stays running.
        Flipping to fail-closed would silently disable the engine on any
        transient DB blip — a worse failure mode than the (loud) contract."""
        from routers.match import _kill_switch_enabled

        sb = MagicMock()
        sb.table.return_value.select.side_effect = RuntimeError("db down")
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            result = _kill_switch_enabled()

        assert result is True
        assert any(
            "kill switch check FAILED" in rec.getMessage()
            for rec in caplog.records
        ), "kill-switch failure must log at ERROR level"


# ---------------------------------------------------------------------------
# POST /api/match/recompute — kill switch + skip + empty universe branches
# ---------------------------------------------------------------------------


class TestRecomputeEndpoint:
    def test_kill_switch_off_returns_disabled_status(self, client, monkeypatch):
        """Every branch carries a `status` discriminator; kill-switch off → 'disabled'."""
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: False)

        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": str(uuid4()), "force": False},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "disabled"
        assert body["disabled"] is True

    def test_skip_path_returns_skipped_status(self, client, monkeypatch):
        """Skipped branch carries status='skipped' + reason."""
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)

        async def _skip(allocator_id, force):
            return True

        monkeypatch.setattr("routers.match._should_skip_allocator", _skip)

        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": str(uuid4()), "force": False},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "skipped"
        assert body["reason"] == "recent_batch"

    def test_empty_universe_returns_400(self, client, monkeypatch):
        """Empty candidate universe → 400."""
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {}, "returns_by_id": {}},
        )

        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": str(uuid4()), "force": True},
        )
        assert r.status_code == 400

    def test_score_exception_returns_500(self, client, monkeypatch):
        """_score_one_allocator raising → 500."""
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {
                "strategies_by_id": {"s1": {}},
                "returns_by_id": {},
            },
        )

        async def _boom(allocator_id, universe):
            raise RuntimeError("scoring failed")

        monkeypatch.setattr("routers.match._score_one_allocator", _boom)

        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": str(uuid4()), "force": True},
        )
        assert r.status_code == 500

    def test_rejects_non_uuid_with_422(self, client):
        """allocator_id is typed as UUID — non-UUID strings must be rejected
        at the request boundary with a 422, not round-tripped to Supabase
        as a 0-row query."""
        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": "../../etc/passwd", "force": False},
        )
        assert r.status_code == 422

        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": "", "force": False},
        )
        assert r.status_code == 422

    def test_ok_path_carries_status_ok(self, client, monkeypatch):
        """Success branch carries status='ok' alongside the result fields."""
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {
                "strategies_by_id": {"s1": {}},
                "returns_by_id": {},
            },
        )

        async def _score(allocator_id, universe):
            return {
                "allocator_id": allocator_id,
                "batch_id": "batch-1",
                "candidate_count": 5,
                "excluded_count": 2,
                "mode": "personalized",
                "filter_relaxed": False,
                "latency_ms": 42,
            }

        monkeypatch.setattr("routers.match._score_one_allocator", _score)
        monkeypatch.setattr("routers.match._retention_sweep", lambda aid: 0)

        r = client.post(
            "/api/match/recompute",
            json={"allocator_id": str(uuid4()), "force": True},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["batch_id"] == "batch-1"

    def test_retention_failure_after_insert_does_not_500(
        self, client, monkeypatch, caplog
    ):
        """A retention sweep failure AFTER a successful insert must not 500
        the request — the batch already landed, and tearing down the response
        produces a partial-success state with no rollback. Log loudly and
        return the result."""
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
        )

        async def _score(allocator_id, universe):
            return {
                "allocator_id": allocator_id,
                "batch_id": "batch-1",
                "candidate_count": 1,
                "excluded_count": 0,
                "mode": "personalized",
                "filter_relaxed": False,
                "latency_ms": 1,
            }

        monkeypatch.setattr("routers.match._score_one_allocator", _score)

        def _retention_boom(_aid):
            raise RuntimeError("retention failed")

        monkeypatch.setattr("routers.match._retention_sweep", _retention_boom)

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            r = client.post(
                "/api/match/recompute",
                json={"allocator_id": str(uuid4()), "force": True},
            )

        assert r.status_code == 200, "retention failure must not 500 after insert"
        assert r.json()["status"] == "ok"
        assert any(
            "retention sweep failed" in rec.getMessage()
            for rec in caplog.records
        )


# ---------------------------------------------------------------------------
# eval lookback_days boundaries
# ---------------------------------------------------------------------------


class TestEvalLookbackBoundaries:
    """1-365 must accept both endpoints; 0 and 366 must reject. A refactor to
    `<= 0` / `>= 365` would silently flip behaviour at the canonical
    7/28/90/365 buttons on the eval dashboard."""

    def test_lookback_0_rejected(self, client, monkeypatch):
        async def _noop(*args, **kwargs):
            return {}

        monkeypatch.setattr(
            "routers.match.compute_hit_rate_metrics", lambda *a, **k: {}
        )
        r = client.get("/api/match/eval?lookback_days=0")
        assert r.status_code == 400

    def test_lookback_1_accepted(self, client, monkeypatch):
        monkeypatch.setattr(
            "routers.match.compute_hit_rate_metrics", lambda *a, **k: {"ok": True}
        )
        r = client.get("/api/match/eval?lookback_days=1")
        assert r.status_code == 200

    def test_lookback_365_accepted(self, client, monkeypatch):
        monkeypatch.setattr(
            "routers.match.compute_hit_rate_metrics", lambda *a, **k: {"ok": True}
        )
        r = client.get("/api/match/eval?lookback_days=365")
        assert r.status_code == 200

    def test_lookback_366_rejected(self, client):
        r = client.get("/api/match/eval?lookback_days=366")
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# _retention_sweep slice + ordering invariants
# ---------------------------------------------------------------------------


class TestRetentionSweep:
    """A regression that flipped `rows[keep:]` to `rows[:keep]` or sorted ASC
    would silently delete the NEWEST batches instead of the oldest —
    invisible until an allocator's queue empties. Lock both invariants with
    a deterministic batch ordering."""

    def test_deletes_oldest_when_above_keep(self, monkeypatch):
        from routers import match as match_mod

        # 10 batches, computed_at DESC — newest first (id-0) to oldest (id-9).
        rows = [{"id": f"id-{i}"} for i in range(10)]
        captured_delete_ids: list[list[str]] = []

        sb = MagicMock()
        # Select chain returns the 10 rows DESC.
        select_chain = MagicMock()
        select_chain.select.return_value.eq.return_value.order.return_value.execute.return_value = (
            MagicMock(data=rows)
        )

        delete_chain = MagicMock()

        def _capture_in(_col, ids):
            captured_delete_ids.append(list(ids))
            return MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))

        delete_chain.delete.return_value.in_.side_effect = _capture_in

        sb.table.side_effect = lambda name: (
            select_chain if name == "match_batches" else MagicMock()
        )
        # Both paths reach .table('match_batches') — same chain handles select +
        # delete because the delete branch uses .delete().in_ on the same mock.
        select_chain.delete = delete_chain.delete

        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        deleted = match_mod._retention_sweep("alloc-1", keep=7)

        assert deleted == 3, "must delete exactly len(rows) - keep = 3"
        assert len(captured_delete_ids) == 1
        assert captured_delete_ids[0] == ["id-7", "id-8", "id-9"], (
            "must delete the 3 OLDEST (tail of DESC list), not the newest"
        )

    def test_returns_zero_when_below_keep(self, monkeypatch):
        from routers import match as match_mod

        rows = [{"id": "id-0"}, {"id": "id-1"}]
        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = (
            MagicMock(data=rows)
        )
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        # 2 rows, keep=7 → nothing to delete
        deleted = match_mod._retention_sweep("alloc-1", keep=7)
        assert deleted == 0

    def test_delete_paginates_large_in_list(self, monkeypatch):
        """An unbounded IN-list DELETE can exceed PostgREST URL limits.
        Verify the sweep chunks deletes into _RETENTION_DELETE_BATCH_SIZE
        pages so the IN-list stays bounded."""
        from routers import match as match_mod

        # 200 batches → after keeping 7, 193 IDs to delete → must be chunked.
        rows = [{"id": f"id-{i}"} for i in range(200)]
        captured_chunks: list[list[str]] = []

        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = (
            MagicMock(data=rows)
        )

        def _capture_in(_col, ids):
            captured_chunks.append(list(ids))
            return MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))

        sb.table.return_value.delete.return_value.in_.side_effect = _capture_in
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        deleted = match_mod._retention_sweep("alloc-1", keep=7)

        assert deleted == 193
        assert len(captured_chunks) > 1, "DELETE must paginate, not send 193 IDs at once"
        for chunk in captured_chunks:
            assert len(chunk) <= match_mod._RETENTION_DELETE_BATCH_SIZE


# ---------------------------------------------------------------------------
# cron partial-failure resilience
# ---------------------------------------------------------------------------


class TestCronPartialFailure:
    """Lock the per-allocator try/except contract. A regression that re-raises
    in the inner except would let one bad allocator nuke the entire daily cron."""

    def test_one_allocator_failure_does_not_abort_cron(self, client, monkeypatch):
        """3 allocators, second raises → processed=2, failed=1, cron returns 200."""
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[{"id": "a1"}, {"id": "a2"}, {"id": "a3"}])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
        )

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)

        call_order: list[str] = []

        async def _score(allocator_id, universe):
            call_order.append(allocator_id)
            if allocator_id == "a2":
                raise RuntimeError("a2 explodes")
            return {}

        monkeypatch.setattr("routers.match._score_one_allocator", _score)
        monkeypatch.setattr("routers.match._retention_sweep", lambda aid: 0)

        r = client.post("/api/match/cron-recompute")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["processed"] == 2
        assert body["failed"] == 1
        assert body["skipped"] == 0
        # All three allocators were ATTEMPTED — regression would short-circuit.
        assert call_order == ["a1", "a2", "a3"]

    def test_kill_switch_flip_mid_run_breaks_loop(self, client, monkeypatch):
        """Mid-run kill-switch detection must abort the loop early."""
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[{"id": "a1"}, {"id": "a2"}, {"id": "a3"}])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
        )

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)

        # Kill switch ON for first 2 checks (initial + before a1), OFF on the
        # mid-loop check before a2 → loop breaks before scoring a2.
        kill_calls = {"n": 0}

        def _flip():
            kill_calls["n"] += 1
            # n=1 initial check (route entry) — ON
            # n=2 mid-loop check before allocator a1 — ON
            # n=3 mid-loop check before allocator a2 — OFF
            return kill_calls["n"] <= 2

        monkeypatch.setattr("routers.match._kill_switch_enabled", _flip)

        call_order: list[str] = []

        async def _score(allocator_id, universe):
            call_order.append(allocator_id)
            return {}

        monkeypatch.setattr("routers.match._score_one_allocator", _score)
        monkeypatch.setattr("routers.match._retention_sweep", lambda aid: 0)

        r = client.post("/api/match/cron-recompute")
        assert r.status_code == 200
        # Only a1 was scored — kill-switch flipped before a2.
        assert call_order == ["a1"]
        assert r.json()["processed"] == 1

    def test_retention_sweep_failure_for_one_allocator_does_not_abort_total(
        self, client, monkeypatch
    ):
        """Per-allocator retention failures must not abort the sweep loop.
        Verify total retention is still summed across the surviving allocators."""
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[{"id": "a1"}, {"id": "a2"}, {"id": "a3"}])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
        )

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)

        async def _score(allocator_id, universe):
            return {}

        monkeypatch.setattr("routers.match._score_one_allocator", _score)

        def _retention(aid: str) -> int:
            if aid == "a2":
                raise RuntimeError("retention failed for a2")
            return 5

        monkeypatch.setattr("routers.match._retention_sweep", _retention)

        r = client.post("/api/match/cron-recompute")
        assert r.status_code == 200
        body = r.json()
        # 5 (a1) + 0 (a2 raised) + 5 (a3) = 10
        assert body["retention_deleted"] == 10
        assert body["processed"] == 3


# ---------------------------------------------------------------------------
# cron response shape contract
# ---------------------------------------------------------------------------


class TestCronResponseShape:
    """Lock the unified response shape across all early-return paths so a
    monitoring dashboard reading `duration_s` never gets None back."""

    _REQUIRED_KEYS = {
        "status",
        "processed",
        "skipped",
        "failed",
        "retention_deleted",
        "duration_s",
    }

    def test_kill_switch_branch_has_full_shape(self, client, monkeypatch):
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: False)

        r = client.post("/api/match/cron-recompute")
        body = r.json()
        assert self._REQUIRED_KEYS <= set(body)
        assert body["status"] == "disabled"
        assert isinstance(body["duration_s"], (int, float))

    def test_no_allocators_branch_has_full_shape(self, client, monkeypatch):
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

        r = client.post("/api/match/cron-recompute")
        body = r.json()
        assert self._REQUIRED_KEYS <= set(body)
        assert body["status"] == "no_allocators"
        assert isinstance(body["duration_s"], (int, float))

    def test_empty_universe_branch_has_full_shape(self, client, monkeypatch):
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[{"id": "a1"}])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {}, "returns_by_id": {}},
        )

        r = client.post("/api/match/cron-recompute")
        body = r.json()
        assert self._REQUIRED_KEYS <= set(body)
        assert body["status"] == "empty_universe"
        assert isinstance(body["duration_s"], (int, float))


# ---------------------------------------------------------------------------
# total-failure structural-error logging
# ---------------------------------------------------------------------------


class TestCronTotalFailureLogging:
    def test_all_allocators_fail_logs_error(self, client, monkeypatch, caplog):
        """processed=0 + failed>0 = structural problem (schema drift, KEK
        missing, supabase down). Must emit logger.error so Sentry alerts
        fire — would otherwise be silently 200-OK."""
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[{"id": "a1"}, {"id": "a2"}])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
        )

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)

        async def _score(allocator_id, universe):
            raise RuntimeError("schema drift")

        monkeypatch.setattr("routers.match._score_one_allocator", _score)
        monkeypatch.setattr("routers.match._retention_sweep", lambda aid: 0)

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            r = client.post("/api/match/cron-recompute")

        assert r.status_code == 200
        body = r.json()
        assert body["processed"] == 0
        assert body["failed"] == 2
        # Phase B silent-failure F1: status discriminator must distinguish a
        # structural fault from a healthy cron. "ok" with processed=0 and
        # failed>0 would let a dashboard switch green while the engine is
        # broken — operators need a distinct status to alert on.
        assert body["status"] == "total_failure", (
            f"Expected status='total_failure' when every allocator fails; got {body['status']}"
        )
        # Must emit a TOTAL FAILURE error log so Sentry alerts fire.
        assert any(
            "TOTAL FAILURE" in rec.getMessage() for rec in caplog.records
        )

    def test_majority_failure_returns_degraded_status(
        self, client, monkeypatch, caplog
    ):
        """Phase B silent-failure F1: when most (but not all) allocators
        fail, the response must surface 'degraded' so monitoring can
        differentiate partial-success from healthy."""
        sb = MagicMock()
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(data=[{"id": "a1"}, {"id": "a2"}, {"id": "a3"}])
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
        monkeypatch.setattr("routers.match._kill_switch_enabled", lambda: True)
        monkeypatch.setattr(
            "routers.match._load_candidate_universe",
            lambda: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
        )

        async def _no_skip(allocator_id, force):
            return False

        monkeypatch.setattr("routers.match._should_skip_allocator", _no_skip)

        async def _score(allocator_id, universe):
            if allocator_id in ("a1", "a2"):
                raise RuntimeError(f"{allocator_id} explodes")
            return {}

        monkeypatch.setattr("routers.match._score_one_allocator", _score)
        monkeypatch.setattr("routers.match._retention_sweep", lambda aid: 0)

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            r = client.post("/api/match/cron-recompute")

        assert r.status_code == 200
        body = r.json()
        assert body["processed"] == 1
        assert body["failed"] == 2
        assert body["status"] == "degraded", (
            f"Expected status='degraded' when failures outnumber successes; got {body['status']}"
        )


# ---------------------------------------------------------------------------
# demo_only filter on _load_candidate_universe
# ---------------------------------------------------------------------------


class TestLoadCandidateUniverseDemoOnly:
    def test_demo_only_filters_is_example_true(self, monkeypatch):
        """The demo-allocator path must restrict the universe to is_example=true
        strategies so /api/demo/match cannot leak real published strategies via
        the anon public endpoint."""
        from routers import match as match_mod

        # Capture the .eq() chain calls so we can assert is_example=true is applied.
        calls: list[tuple[str, Any]] = []

        sb = MagicMock()
        query = MagicMock()
        sb.table.return_value.select.return_value = query

        def _eq(col, val):
            calls.append((col, val))
            return query  # chainable

        query.eq.side_effect = _eq
        query.execute.return_value = MagicMock(data=[])  # empty universe OK

        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        match_mod._load_candidate_universe(demo_only=True)

        # Must have status=published AND is_example=True predicates.
        assert ("status", "published") in calls
        assert ("is_example", True) in calls

    def test_default_does_not_filter_is_example(self, monkeypatch):
        """Default behaviour (demo_only=False) must NOT add the is_example
        filter — the normal admin cron sees ALL published strategies."""
        from routers import match as match_mod

        calls: list[tuple[str, Any]] = []

        sb = MagicMock()
        query = MagicMock()
        sb.table.return_value.select.return_value = query

        def _eq(col, val):
            calls.append((col, val))
            return query

        query.eq.side_effect = _eq
        query.execute.return_value = MagicMock(data=[])

        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        match_mod._load_candidate_universe()  # default demo_only=False

        assert ("status", "published") in calls
        assert ("is_example", True) not in calls


# ---------------------------------------------------------------------------
# mandate_edited_at parse-failure must not silently pass
# ---------------------------------------------------------------------------


class TestShouldSkipMandateParseFailure:
    async def test_malformed_mandate_edited_at_forces_recompute(
        self, monkeypatch, caplog
    ):
        """A corrupted mandate_edited_at used to be swallowed with bare `pass`,
        silently downgrading Trigger 3 into a no-op. Now: log a WARNING and
        treat parse failure as 'recompute needed' (return False)."""
        from routers.match import ENGINE_VERSION, _should_skip_allocator

        now = _dt.datetime.now(_dt.timezone.utc)
        one_hour_ago = (
            (now - _dt.timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        )

        sb = MagicMock()
        # match_batches → fresh batch with current engine version
        sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {"computed_at": one_hour_ago, "engine_version": ENGINE_VERSION}
                ]
            )
        )
        # allocator_preferences → garbage timestamp that fromisoformat cannot parse
        sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
            MagicMock(data={"mandate_edited_at": "definitely-not-an-iso-timestamp"})
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            result = await _should_skip_allocator("alloc-1", force=False)

        assert result is False, (
            "bad mandate_edited_at must force a recompute, not silently skip"
        )
        assert any(
            "bad mandate_edited_at" in rec.getMessage() for rec in caplog.records
        )

    # Phase B pr-test-analyzer F9: Trigger 2 (engine_version mismatch) forces
    # a recompute regardless of computed_at recency. A regression that flips
    # the engine_version comparison would silently downgrade this to a no-op
    # — the same class of silent-skip the mandate_edited_at parse-failure
    # test pins, but for a different trigger.
    async def test_engine_version_mismatch_forces_recompute(
        self, monkeypatch
    ):
        from routers.match import ENGINE_VERSION, _should_skip_allocator

        now = _dt.datetime.now(_dt.timezone.utc)
        one_hour_ago = (
            (now - _dt.timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        )

        sb = MagicMock()
        # match_batches → FRESH batch (1h old, well within the 12h age guard)
        # but written by an OLDER engine version → Trigger 2 must force a
        # recompute regardless of recency.
        stale_version = (
            "v0-stale" if ENGINE_VERSION != "v0-stale" else "v1-fallback"
        )
        sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {"computed_at": one_hour_ago, "engine_version": stale_version}
                ]
            )
        )
        sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
            MagicMock(data={"mandate_edited_at": None})
        )
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

        result = await _should_skip_allocator("alloc-version-drift", force=False)
        assert result is False, (
            "engine_version mismatch must force recompute even within the "
            "12h age guard. Got True — Trigger 2 is silently degraded."
        )


# ---------------------------------------------------------------------------
# Orphan rollback + demo-allocator filter at the orchestrator boundary
# ---------------------------------------------------------------------------


class TestScoreOneAllocatorOrphanRollback:
    """When match_candidates insert fails, the parent match_batches row must
    be deleted so we never leave an orphan batch with candidate_count > 0
    and zero children (the dataloss shape the recompute pipeline is designed
    to avoid).

    The unit-of-work here is the orchestration in _score_one_allocator. We
    monkey-patch every dependency below the Supabase boundary so the
    candidate-insert failure path can be driven deterministically."""

    async def test_failed_candidate_insert_rolls_back_batch_row(
        self, monkeypatch, caplog
    ):
        from routers import match as match_mod

        # Capture the delete that the rollback fires.
        captured_deletes: list[tuple[str, str]] = []

        # Build a chained supabase mock where match_batches.insert returns
        # data (so we get a batch_id) but match_candidates.insert returns
        # empty data (silent FK violation shape).
        sb = MagicMock()

        def _table(name):
            t = MagicMock()
            if name == "match_batches":
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": "batch-xyz"}]
                )
                # Capture the rollback delete
                def _eq_capture(col, val):
                    captured_deletes.append((col, val))
                    return MagicMock(execute=MagicMock(return_value=MagicMock(data=[{"id": val}])))
                t.delete.return_value.eq.side_effect = _eq_capture
            elif name == "match_candidates":
                # Insert "succeeds" at the network level but returns empty
                # data — exactly the silent FK-violation shape.
                t.insert.return_value.execute.return_value = MagicMock(data=[])
            return t

        sb.table.side_effect = _table
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        # Stub out the helpers _score_one_allocator awaits before the insert.
        monkeypatch.setattr(
            match_mod,
            "_load_allocator_context",
            lambda aid: {
                "preferences": {},
                "portfolio_strategies": [],
                "portfolio_weights": {},
                "portfolio_returns": {},
                "portfolio_aum": None,
                "thumbs_down_ids": set(),
                "_holdings_rows_eligible": [],
            },
        )
        # Patch the lazy import inside _score_one_allocator
        import services.feedback_engine
        monkeypatch.setattr(
            services.feedback_engine, "compute_adjusted_weights", lambda aid: {}
        )
        # Stub score_candidates to return a candidate set non-empty enough to
        # trigger the match_candidates insert branch.
        monkeypatch.setattr(
            match_mod,
            "score_candidates",
            lambda **kw: {
                "candidates": [
                    {
                        "strategy_id": "strat-1",
                        "score": 88,
                        "score_breakdown": {},
                        "reasons": [],
                        "rank": 1,
                    }
                ],
                "excluded": [],
                "excluded_total": 0,
                "mode": "personalized",
                "filter_relaxed": False,
                "effective_preferences": {},
                "effective_thresholds": {},
                "source_strategy_count": 1,
            },
        )

        universe = {
            "strategies_by_id": {"strat-1": {"strategy_id": "strat-1"}},
            "returns_by_id": {},
        }

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            with pytest.raises(RuntimeError, match="match_candidates insert failed"):
                await match_mod._score_one_allocator(
                    "11111111-1111-1111-1111-111111111111", universe
                )

        # The rollback DELETE must have fired with the parent batch id.
        assert ("id", "batch-xyz") in captured_deletes, (
            "orphan batch row must be deleted on candidate-insert failure"
        )
        assert any(
            "rolling back" in rec.getMessage() for rec in caplog.records
        )

    # Phase B pr-test-analyzer F5: the existing test exercises the `data=[]`
    # network-success-but-empty-data path. The OTHER failure mode (insert
    # raises an exception) must ALSO roll back the parent batch AND chain
    # the original exception via `from insert_err`.
    async def test_insert_raising_exception_still_rolls_back_batch(
        self, monkeypatch, caplog
    ):
        from routers import match as match_mod

        captured_deletes: list[tuple[str, str]] = []
        sb = MagicMock()

        def _table(name):
            t = MagicMock()
            if name == "match_batches":
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": "batch-raise"}]
                )

                def _eq_capture(col, val):
                    captured_deletes.append((col, val))
                    return MagicMock(
                        execute=MagicMock(
                            return_value=MagicMock(data=[{"id": val}])
                        )
                    )

                t.delete.return_value.eq.side_effect = _eq_capture
            elif name == "match_candidates":
                # Insert RAISES — different control path from the data=[] case.
                t.insert.return_value.execute.side_effect = RuntimeError(
                    "FK violation: batch_id"
                )
            return t

        sb.table.side_effect = _table
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        monkeypatch.setattr(
            match_mod,
            "_load_allocator_context",
            lambda aid: {
                "preferences": {},
                "portfolio_strategies": [],
                "portfolio_weights": {},
                "portfolio_returns": {},
                "portfolio_aum": None,
                "thumbs_down_ids": set(),
                "_holdings_rows_eligible": [],
            },
        )
        import services.feedback_engine
        monkeypatch.setattr(
            services.feedback_engine, "compute_adjusted_weights", lambda aid: {}
        )
        monkeypatch.setattr(
            match_mod,
            "score_candidates",
            lambda **kw: {
                "candidates": [
                    {
                        "strategy_id": "strat-1",
                        "score": 88,
                        "score_breakdown": {},
                        "reasons": [],
                        "rank": 1,
                    }
                ],
                "excluded": [],
                "excluded_total": 0,
                "mode": "personalized",
                "filter_relaxed": False,
                "effective_preferences": {},
                "effective_thresholds": {},
                "source_strategy_count": 1,
            },
        )

        universe = {
            "strategies_by_id": {"strat-1": {"strategy_id": "strat-1"}},
            "returns_by_id": {},
        }

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            with pytest.raises(RuntimeError, match="match_candidates insert failed") as excinfo:
                await match_mod._score_one_allocator(
                    "22222222-2222-2222-2222-222222222222", universe
                )

        # The rollback DELETE must have fired with the parent batch id even
        # though insert raised (vs. returning empty data).
        assert ("id", "batch-raise") in captured_deletes, (
            "orphan batch row must be deleted on candidate-insert raise too"
        )
        # The original FK error must be chained via __cause__ so the operator
        # can see the root cause.
        assert excinfo.value.__cause__ is not None
        assert "FK violation" in str(excinfo.value.__cause__)

    # Phase B pr-test-analyzer F6: if the rollback DELETE itself raises
    # (e.g. RLS regression that lets INSERT but not DELETE), the function
    # must STILL surface the insert-failure RuntimeError (not the delete
    # error) so operators don't chase the wrong root cause.
    async def test_rollback_delete_failure_does_not_mask_insert_error(
        self, monkeypatch, caplog
    ):
        from routers import match as match_mod

        sb = MagicMock()

        def _table(name):
            t = MagicMock()
            if name == "match_batches":
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": "batch-cleanup-fail"}]
                )
                # Delete raises — the inner except must catch and log.
                t.delete.return_value.eq.return_value.execute.side_effect = (
                    RuntimeError("delete forbidden by RLS")
                )
            elif name == "match_candidates":
                t.insert.return_value.execute.return_value = MagicMock(data=[])
            return t

        sb.table.side_effect = _table
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        monkeypatch.setattr(
            match_mod,
            "_load_allocator_context",
            lambda aid: {
                "preferences": {},
                "portfolio_strategies": [],
                "portfolio_weights": {},
                "portfolio_returns": {},
                "portfolio_aum": None,
                "thumbs_down_ids": set(),
                "_holdings_rows_eligible": [],
            },
        )
        import services.feedback_engine
        monkeypatch.setattr(
            services.feedback_engine, "compute_adjusted_weights", lambda aid: {}
        )
        monkeypatch.setattr(
            match_mod,
            "score_candidates",
            lambda **kw: {
                "candidates": [
                    {
                        "strategy_id": "strat-1",
                        "score": 88,
                        "score_breakdown": {},
                        "reasons": [],
                        "rank": 1,
                    }
                ],
                "excluded": [],
                "excluded_total": 0,
                "mode": "personalized",
                "filter_relaxed": False,
                "effective_preferences": {},
                "effective_thresholds": {},
                "source_strategy_count": 1,
            },
        )

        universe = {
            "strategies_by_id": {"strat-1": {"strategy_id": "strat-1"}},
            "returns_by_id": {},
        }

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            with pytest.raises(RuntimeError, match="match_candidates insert failed"):
                await match_mod._score_one_allocator(
                    "33333333-3333-3333-3333-333333333333", universe
                )

        # Both log lines must be emitted so the operator sees the cascade.
        messages = [rec.getMessage() for rec in caplog.records]
        assert any("rolling back" in m for m in messages), (
            "expected 'rolling back' attempt log when insert returned empty data"
        )
        assert any(
            "failed to roll back" in m or "rollback" in m.lower() for m in messages
        ), "expected cleanup-failure log when rollback delete also raises"


class TestScoreOneAllocatorDemoFilter:
    """When the allocator being scored is the seeded demo allocator
    (ALLOCATOR_ACTIVE_ID), the candidate universe must be post-filtered to
    is_example=true strategies only. Real published strategies must NEVER
    land in match_candidates for that allocator — otherwise the public
    /api/demo/match endpoint would leak them."""

    async def test_demo_allocator_universe_is_filtered_to_examples(
        self, monkeypatch
    ):
        from routers import match as match_mod

        # Capture which candidates were passed to score_candidates.
        captured_kw: dict[str, Any] = {}

        def _fake_score(**kw):
            captured_kw.update(kw)
            return {
                "candidates": [],
                "excluded": [],
                "excluded_total": 0,
                "mode": "screening",
                "filter_relaxed": False,
                "effective_preferences": {},
                "effective_thresholds": {},
                "source_strategy_count": len(kw.get("candidate_strategies", [])),
            }

        monkeypatch.setattr(match_mod, "score_candidates", _fake_score)

        # Stub the dependencies the function awaits.
        monkeypatch.setattr(
            match_mod,
            "_load_allocator_context",
            lambda aid: {
                "preferences": {},
                "portfolio_strategies": [],
                "portfolio_weights": {},
                "portfolio_returns": {},
                "portfolio_aum": None,
                "thumbs_down_ids": set(),
                "_holdings_rows_eligible": [],
            },
        )
        import services.feedback_engine
        monkeypatch.setattr(
            services.feedback_engine, "compute_adjusted_weights", lambda aid: {}
        )

        # Supabase mock — match_batches.insert returns a row, no candidates
        # actually insert (empty result triggers cleanup, but we don't care
        # here — we only care about which strategies WERE passed to scoring).
        sb = MagicMock()

        def _table(name):
            t = MagicMock()
            if name == "match_batches":
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": "batch-1"}]
                )
                t.delete.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
            return t

        sb.table.side_effect = _table
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        universe = {
            "strategies_by_id": {
                "ex-1": {"strategy_id": "ex-1", "name": "Example A", "is_example": True},
                "ex-2": {"strategy_id": "ex-2", "name": "Example B", "is_example": True},
                "real-1": {"strategy_id": "real-1", "name": "Real Strat", "is_example": False},
                "real-2": {"strategy_id": "real-2", "name": "Other Real", "is_example": False},
            },
            "returns_by_id": {},
        }

        # Score the DEMO allocator — universe must be filtered to is_example=true
        await match_mod._score_one_allocator(match_mod._DEMO_ALLOCATOR_ID, universe)

        scored_ids = {
            s["strategy_id"] for s in captured_kw["candidate_strategies"]
        }
        assert scored_ids == {"ex-1", "ex-2"}, (
            "demo allocator must only score is_example=true strategies; "
            f"got {scored_ids}"
        )

    async def test_non_demo_allocator_sees_full_universe(self, monkeypatch):
        """Default path: a real allocator's universe is NOT filtered."""
        from routers import match as match_mod

        captured_kw: dict[str, Any] = {}

        def _fake_score(**kw):
            captured_kw.update(kw)
            return {
                "candidates": [],
                "excluded": [],
                "excluded_total": 0,
                "mode": "screening",
                "filter_relaxed": False,
                "effective_preferences": {},
                "effective_thresholds": {},
                "source_strategy_count": len(kw.get("candidate_strategies", [])),
            }

        monkeypatch.setattr(match_mod, "score_candidates", _fake_score)
        monkeypatch.setattr(
            match_mod,
            "_load_allocator_context",
            lambda aid: {
                "preferences": {},
                "portfolio_strategies": [],
                "portfolio_weights": {},
                "portfolio_returns": {},
                "portfolio_aum": None,
                "thumbs_down_ids": set(),
                "_holdings_rows_eligible": [],
            },
        )
        import services.feedback_engine
        monkeypatch.setattr(
            services.feedback_engine, "compute_adjusted_weights", lambda aid: {}
        )

        sb = MagicMock()

        def _table(name):
            t = MagicMock()
            if name == "match_batches":
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": "batch-1"}]
                )
                t.delete.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
            return t

        sb.table.side_effect = _table
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        universe = {
            "strategies_by_id": {
                "ex-1": {"strategy_id": "ex-1", "is_example": True},
                "real-1": {"strategy_id": "real-1", "is_example": False},
            },
            "returns_by_id": {},
        }

        # Real allocator UUID — must see BOTH example and real strategies.
        await match_mod._score_one_allocator(
            "22222222-2222-2222-2222-222222222222", universe
        )

        scored_ids = {
            s["strategy_id"] for s in captured_kw["candidate_strategies"]
        }
        assert scored_ids == {"ex-1", "real-1"}, (
            "non-demo allocator must see the full universe"
        )


# ---------------------------------------------------------------------------
# Red-team CRITICAL (audit-2026-05-07) — explicitly_excluded must not reach
# match_candidates while the SQL CHECK migration is still pending. See
# routers/match.py persistence-boundary filter for the failure mode this
# pins (CHECK violation tears down the whole batch via rollback).
# ---------------------------------------------------------------------------


class TestScoreOneAllocatorExplicitlyExcludedFilter:
    """Red-team CRITICAL: H-0705 added ExclusionReason.EXPLICITLY_EXCLUDED
    ('explicitly_excluded') as a NEW enum value, but no companion migration
    widened the SQL CHECK on match_candidates.exclusion_reason. The persistence
    boundary in routers/match.py must therefore drop rows with that reason
    until the CHECK migration ships — otherwise the bulk insert raises and
    the rollback path tears down the entire match_batches parent row.

    This test fails-closed on a regression to (a) persisting the reason
    directly OR (b) accidentally renaming the magic string."""

    async def test_explicitly_excluded_rows_are_not_persisted_to_match_candidates(
        self, monkeypatch
    ):
        from routers import match as match_mod

        # Capture every row passed to match_candidates.insert(...).
        captured_inserts: list[list[dict[str, Any]]] = []

        sb = MagicMock()

        def _table(name):
            t = MagicMock()
            if name == "match_batches":
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": "batch-explicit-filter"}]
                )
            elif name == "match_candidates":
                def _capture_insert(rows):
                    captured_inserts.append(rows)
                    return MagicMock(
                        execute=MagicMock(
                            return_value=MagicMock(data=rows)
                        )
                    )

                t.insert.side_effect = _capture_insert
            return t

        sb.table.side_effect = _table
        monkeypatch.setattr(match_mod, "get_supabase", lambda: sb)

        monkeypatch.setattr(
            match_mod,
            "_load_allocator_context",
            lambda aid: {
                "preferences": {},
                "portfolio_strategies": [],
                "portfolio_weights": {},
                "portfolio_returns": {},
                "portfolio_aum": None,
                "thumbs_down_ids": set(),
                "_holdings_rows_eligible": [],
            },
        )
        import services.feedback_engine
        monkeypatch.setattr(
            services.feedback_engine, "compute_adjusted_weights", lambda aid: {}
        )

        # score_candidates returns ONE legitimate candidate + ONE explicitly_excluded
        # row + ONE below_min_sharpe row. The persistence layer must keep
        # the candidate + the below_min_sharpe row but drop explicitly_excluded.
        monkeypatch.setattr(
            match_mod,
            "score_candidates",
            lambda **kw: {
                "candidates": [
                    {
                        "strategy_id": "good-strat",
                        "score": 75,
                        "score_breakdown": {},
                        "reasons": [],
                        "rank": 1,
                    }
                ],
                "excluded": [
                    {
                        "strategy_id": "banned-strat",
                        "exclusion_reason": "explicitly_excluded",
                        "exclusion_provenance": "caller",
                    },
                    {
                        "strategy_id": "low-sharpe-strat",
                        "exclusion_reason": "below_min_sharpe",
                        "exclusion_provenance": "0.50",
                    },
                ],
                "excluded_total": 2,
                "mode": "personalized",
                "filter_relaxed": False,
                "effective_preferences": {},
                "effective_thresholds": {},
                "source_strategy_count": 3,
            },
        )

        universe = {
            "strategies_by_id": {
                "good-strat": {"strategy_id": "good-strat"},
                "banned-strat": {"strategy_id": "banned-strat"},
                "low-sharpe-strat": {"strategy_id": "low-sharpe-strat"},
            },
            "returns_by_id": {},
        }

        await match_mod._score_one_allocator(
            "44444444-4444-4444-4444-444444444444", universe
        )

        assert len(captured_inserts) == 1, (
            "expected exactly one match_candidates insert call"
        )
        inserted_rows = captured_inserts[0]
        inserted_reasons = [r["exclusion_reason"] for r in inserted_rows]
        # The legitimate candidate has exclusion_reason=None; the soft exclusion
        # passes through; the explicitly_excluded row is filtered out.
        assert "explicitly_excluded" not in inserted_reasons, (
            "explicitly_excluded must be dropped at the persistence boundary "
            "until the SQL CHECK migration ships — otherwise the bulk insert "
            "raises a CHECK violation and tears down the parent batch row"
        )
        assert "below_min_sharpe" in inserted_reasons, (
            "other exclusion reasons must still persist normally"
        )
        # The good candidate (rank=1) must still appear.
        ranked_ids = {r["strategy_id"] for r in inserted_rows if r["rank"] is not None}
        assert ranked_ids == {"good-strat"}
