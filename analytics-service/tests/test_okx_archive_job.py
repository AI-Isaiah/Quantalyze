"""Phase 167.1.2.2.2.1 plan 07: the durable ``okx_archive_rebuild`` job's skeleton.

What these tests protect, in one paragraph (Rule 9): the job reads a user's OKX account with
a decrypted key on a worker. It must never read an account TRADESYNC refused (D-02), never
read the wrong account, never run on a key wider than read-only, and never trust an OKX
re-mapping of bill types silently (D-08), and every one of those refusals must happen
BEFORE any archive call (the apply POST costs a rate-limit budget and starts a file OKX
generates for hours). The operator reads the outcome through one result object whose shape
three later plans and a runbook depend on. A signed download link is a bearer token and must
appear nowhere durable.

The fakes record every call by endpoint and instance, so "zero archive calls", "the apply is
the last call on its own instance" and "the factory was never invoked" are assertions about
what was actually called, not about what the code says.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from types import SimpleNamespace
from typing import Any, Callable

import pytest

import main_worker
from services import job_worker, okx_archive_job
from services.job_worker import DispatchOutcome, TIMEOUT_PER_KIND, dispatch

KEY_ID = "11111111-1111-4111-8111-111111111111"
OTHER_KEY_ID = "22222222-2222-4222-8222-222222222222"
STRATEGY_ID = "33333333-3333-4333-8333-333333333333"
STRATEGY_2_ID = "44444444-4444-4444-8444-444444444444"
LINK = "https://archive.example.test/dl/SECRET-PATH-3f9a/q3.zip?sig=SECRET-QUERY-77c1"
LINK_SECRETS = ("SECRET-PATH-3f9a", "SECRET-QUERY-77c1", "q3.zip", "sig=")

ENV = {"today": date(2026, 10, 15)}

CONFIG = "private_get_account_config"
SUBTYPES = "private_get_account_subtypes"
APPLY = "private_post_account_bills_history_archive"
STATUS = "private_get_account_bills_history_archive"
ARCHIVE_ENDPOINTS = (APPLY, STATUS)


def _key(
    key_id: str = KEY_ID,
    *,
    exchange: str = "okx",
    is_active: bool = True,
    disconnected_at: str | None = None,
    sync_status: str = "idle",
    venue_account_id: str | None = "U1",
) -> dict[str, Any]:
    return {
        "id": key_id,
        "exchange": exchange,
        "is_active": is_active,
        "disconnected_at": disconnected_at,
        "sync_status": sync_status,
        "venue_account_id": venue_account_id,
        "last_429_at": None,
        "user_id": "user-1",
        # Encrypted slots exist on the row; the D-02 reads must never ask for them.
        "api_key_encrypted": "enc",
    }


def _subtypes_answer(extra: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "code": "0",
        "data": [
            {"type": "1", "typeDesc": "Transfer",
             "subTypes": [{"subType": "11"}, {"subType": "12"}]},
            {"type": "2", "typeDesc": "Trade",
             "subTypes": [{"subType": "1"}, {"subType": "2"}, {"subType": "9999"}]},
            {"type": "8", "typeDesc": "Funding",
             "subTypes": [{"subType": "173"}, {"subType": "174"}]},
            *(extra or []),
        ],
    }


def _default_answers() -> dict[str, Any]:
    return {
        CONFIG: {
            "code": "0",
            "data": [{
                "uid": "U1", "perm": "read_only,trade", "acctLv": "2",
                "feeType": "0", "settleCcy": "USDT",
            }],
        },
        SUBTYPES: _subtypes_answer(),
        APPLY: {"code": "0", "data": [{"result": "true", "ts": "1790000000000"}]},
        STATUS: {"code": "0", "data": [
            {"fileHref": LINK, "state": "finished", "ts": "1790000000000"}
        ]},
    }


class _FakeExchange:
    """Records every venue call by endpoint, in order, per instance."""

    def __init__(self, world: "_World", index: int) -> None:
        self._world = world
        self.index = index
        self.calls: list[str] = []
        self.closed = False

    def __getattr__(self, name: str) -> Callable[..., Any]:
        if not name.startswith("private_"):
            raise AttributeError(name)

        async def _method(params: dict[str, str] | None = None) -> Any:
            self.calls.append(name)
            self._world.timeline.append((self.index, name))
            answer = self._world.answers[name]
            if callable(answer):
                answer = answer(self, params or {})
            return answer

        return _method

    async def close(self) -> None:
        self.closed = True


class _Query:
    def __init__(self, db: "_FakeSupabase", table: str) -> None:
        self._db, self._table = db, table
        self._cols = "*"
        self._eq: tuple[str, Any] | None = None
        self._in: tuple[str, list[Any]] | None = None
        self._single = False

    def select(self, cols: str) -> "_Query":
        self._cols = cols
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self._eq = (col, val)
        return self

    def in_(self, col: str, vals: list[Any]) -> "_Query":
        self._in = (col, list(vals))
        return self

    def maybe_single(self) -> "_Query":
        self._single = True
        return self

    def execute(self) -> Any:
        self._db.reads.append((self._table, self._cols))
        found = list(self._db.tables.get(self._table, []))
        if self._eq is not None:
            found = [r for r in found if r.get(self._eq[0]) == self._eq[1]]
        if self._in is not None:
            found = [r for r in found if r.get(self._in[0]) in self._in[1]]
        if self._single:
            return SimpleNamespace(data=found[0] if found else None)
        return SimpleNamespace(data=found)


class _FakeSupabase:
    def __init__(self, tables: dict[str, list[dict[str, Any]]], world: "_World") -> None:
        self.tables = tables
        self.reads: list[tuple[str, str]] = []
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        self._world = world
        self.progress_returns: bool = True

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        self.rpcs.append((name, params))
        self._world.timeline.append(("rpc", name))
        data: Any = self.progress_returns if name == "set_compute_job_progress" else None
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))


class _World:
    def __init__(self) -> None:
        self.answers: dict[str, Any] = _default_answers()
        self.instances: list[_FakeExchange] = []
        self.timeline: list[tuple[Any, str]] = []
        self.decrypts = 0
        self.constructions = 0
        self.supabase: _FakeSupabase | None = None

    def make(self, exchange_name: str, api_key: str, api_secret: str, passphrase: Any) -> _FakeExchange:
        self.constructions += 1
        instance = _FakeExchange(self, len(self.instances))
        self.instances.append(instance)
        return instance

    def decrypt(self, key_row: Any, kek: Any) -> tuple[str, str, str]:
        self.decrypts += 1
        return ("api-key", "api-secret", "passphrase")

    @property
    def all_calls(self) -> list[str]:
        return [name for inst in self.instances for name in inst.calls]

    def progress_writes(self) -> list[dict[str, Any]]:
        assert self.supabase is not None
        return [p for n, p in self.supabase.rpcs if n == "set_compute_job_progress"]

    def result(self) -> dict[str, Any]:
        writes = self.progress_writes()
        assert len(writes) == 1, f"expected exactly one result write, got {len(writes)}"
        assert writes[0]["p_claim_token"] == "tok-1", "the write must carry the claim token"
        assert writes[0]["p_job_id"] == "job-1"
        result: dict[str, Any] = writes[0]["p_progress"]
        return result


def _install(
    monkeypatch: pytest.MonkeyPatch,
    *,
    job_key: dict[str, Any] | None = None,
    targets: list[tuple[str, dict[str, Any]]] | None = None,
) -> _World:
    """Patch every seam in BOTH modules: ``_allocator_key_preflight`` lives in job_worker and
    reads its module globals, the fresh-instance apply reads this module's. The same
    recorders sit behind both, so "never invoked" covers either path."""
    world = _World()
    key_rows = [job_key if job_key is not None else _key()]
    strategy_rows: list[dict[str, Any]] = []
    for strategy_id, target_key in targets or []:
        strategy_rows.append({"id": strategy_id, "api_key_id": target_key["id"]})
        if target_key["id"] not in {k["id"] for k in key_rows}:
            key_rows.append(target_key)
    supabase = _FakeSupabase({"api_keys": key_rows, "strategies": strategy_rows}, world)
    world.supabase = supabase
    for module in (job_worker, okx_archive_job):
        monkeypatch.setattr(module, "get_supabase", lambda: supabase)
        monkeypatch.setattr(module, "get_kek", lambda: b"kek")
        monkeypatch.setattr(module, "decrypt_credentials", world.decrypt)
        monkeypatch.setattr(module, "_make_exchange_client", world.make)
    monkeypatch.setattr(okx_archive_job, "_utc_today", lambda: ENV["today"])
    return world


def _job(metadata: dict[str, Any] | None = None, *, api_key_id: str | None = KEY_ID) -> dict[str, Any]:
    base: dict[str, Any] = {
        "mode": "preflight",
        "quarters": [{"year": 2026, "quarter": "Q3"}],
        "rebuild_strategy_ids": [STRATEGY_ID],
    }
    base.update(metadata or {})
    return {
        "id": "job-1",
        "kind": "okx_archive_rebuild",
        "api_key_id": api_key_id,
        "strategy_id": None,
        "claim_token": "tok-1",
        "metadata": base,
        "attempts": 1,
        "max_attempts": 3,
    }


def _happy(monkeypatch: pytest.MonkeyPatch) -> _World:
    return _install(monkeypatch, targets=[(STRATEGY_ID, _key(OTHER_KEY_ID))])


# ---------------------------------------------------------------------------
# Task 1: the tracer
# ---------------------------------------------------------------------------

class TestTracerPreflight:
    @pytest.mark.asyncio
    async def test_preflight_runs_end_to_end_and_reports_account_and_link_host_only(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The CONTEXT founder question (which account, which permission, which host serves
        the file) is answered by an enqueued job, not a shell on Railway, and the answer
        names the link's scheme and host only: the link is a bearer token."""
        caplog.set_level(logging.DEBUG)
        world = _happy(monkeypatch)

        outcome = await dispatch(_job())

        assert outcome.outcome == DispatchOutcome.DONE
        assert outcome.error_message is None
        result = world.result()
        assert result["mode"] == "preflight"
        assert result["stop_class"] is None
        assert result["account"] == {
            "uid_match": True, "read_only": True,
            "acct_lv": "2", "fee_type": "0", "settle_ccy": "USDT",
        }
        assert result["subtypes"] == {
            "live_count": 7,
            "drift": [],
            "unlisted_by_type": {"2": 1},  # 9999 is live, absent from the committed table
        }
        (quarter,) = result["quarters"]
        assert quarter["state"] == "finished"
        assert quarter["applied_existing"] is True
        assert quarter["href_scheme"] == "https"
        assert quarter["href_host"] == "archive.example.test"

        everything = json.dumps(world.progress_writes()) + caplog.text + repr(outcome)
        for secret in LINK_SECRETS:
            assert secret not in everything, f"the link leaked: {secret!r}"
        assert "U1" not in json.dumps(result), "the account uid must not be stored"

    @pytest.mark.asyncio
    async def test_apply_is_the_last_call_on_its_own_fresh_instance(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ccxt prices the apply POST at 72000; the next call on that instance blocks about
        two hours. So the POST is the final call on a client of its own, and the cheap
        reads stay on the preflight instance."""
        world = _happy(monkeypatch)

        await dispatch(_job())

        assert [i.calls for i in world.instances] == [[CONFIG, SUBTYPES, STATUS], [APPLY]]
        assert all(i.closed for i in world.instances), "every client must be closed"
        assert world.constructions == 2 and world.decrypts == 2

    def test_kind_is_wired_with_the_contract_timeouts(self) -> None:
        """One claim is bounded at 15 minutes; the OKX wait is a deferral, not this timeout.
        The kind is claimed by the interactive loop (not a BACKFILL kind), enqueues nothing
        and is nobody's follow-on."""
        assert TIMEOUT_PER_KIND["okx_archive_rebuild"] == 15 * 60
        assert main_worker.WATCHDOG_PER_KIND_OVERRIDES["okx_archive_rebuild"] == "30 minutes"
        assert "okx_archive_rebuild" not in main_worker.BACKFILL_KINDS
        chain = job_worker.JOB_CHAIN_FOLLOW_ON
        assert "okx_archive_rebuild" not in chain
        assert all("okx_archive_rebuild" not in tail for tail in chain.values())

    @pytest.mark.asyncio
    async def test_dispatch_routes_the_kind_to_the_handler(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An unknown kind fails straight to failed_final on an OLD worker; this pins that
        the NEW worker knows the kind (the deploy-order fact in the runbook)."""
        seen: list[str] = []

        async def _fake(job: dict[str, Any]) -> job_worker.DispatchResult:
            seen.append(job["id"])
            return job_worker.DispatchResult(outcome=DispatchOutcome.DONE)

        monkeypatch.setattr(okx_archive_job, "run_okx_archive_rebuild_job", _fake)
        outcome = await dispatch(_job())

        assert outcome.outcome == DispatchOutcome.DONE and seen == ["job-1"]
