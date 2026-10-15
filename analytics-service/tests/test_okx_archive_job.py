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

import ccxt.async_support as ccxt
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


# ---------------------------------------------------------------------------
# Task 2: refusals
# ---------------------------------------------------------------------------

def _assert_refused(
    world: _World,
    outcome: job_worker.DispatchResult,
    stop_class: str,
    *,
    okx_calls: list[str],
    detail: str = "",
) -> dict[str, Any]:
    assert outcome.outcome == DispatchOutcome.FAILED
    assert outcome.error_kind == "permanent"
    expected = f"okx_archive_rebuild: {stop_class}" + (f" {detail}" if detail else "")
    assert outcome.error_message == expected, "last_error carries the class, dates and counts only"
    result = world.result()
    assert result["stop_class"] == stop_class, "the class is in the block that was written"
    assert world.all_calls == okx_calls, "exact OKX call list"
    assert not [c for c in world.all_calls if c in ARCHIVE_ENDPOINTS], "zero archive calls"
    # The block is written BEFORE the FAILED return: it is the last thing that happened.
    assert world.timeline[-1] == ("rpc", "set_compute_job_progress")
    return result


class TestRefusals:
    @pytest.mark.asyncio
    async def test_a_non_okx_job_key_is_refused_with_zero_okx_calls(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The archive endpoint is OKX's; any other venue's key must not even be decrypted."""
        world = _install(monkeypatch, job_key=_key(exchange="binance"))
        outcome = await dispatch(_job({"rebuild_strategy_ids": []}))
        _assert_refused(world, outcome, "key_not_okx", okx_calls=[])
        assert world.constructions == 0 and world.decrypts == 0

    @pytest.mark.parametrize(
        "bad",
        [
            {"disconnected_at": "2026-09-01T00:00:00Z"},
            {"is_active": False},
            {"sync_status": "revoked"},
        ],
        ids=["disconnected", "inactive", "revoked"],
    )
    @pytest.mark.asyncio
    async def test_a_disconnected_inactive_or_revoked_job_key_never_reaches_okx(
        self, monkeypatch: pytest.MonkeyPatch, bad: dict[str, Any]
    ) -> None:
        """D-02: reading a disconnected user's exchange account is what TRADESYNC refused.
        The inactive case matters most: the shared preflight answers an inactive key with a
        plain FAILED and NO result block, and decrypts any key it does not refuse. The
        refusal must come first, write the block, and touch no credential."""
        world = _install(monkeypatch, job_key=_key(**bad))
        outcome = await dispatch(_job({"rebuild_strategy_ids": []}))
        _assert_refused(world, outcome, "key_disconnected", okx_calls=[])
        assert world.constructions == 0, "no exchange client may be built for a refused key"
        assert world.decrypts == 0, "no credential may be decrypted for a refused key"
        assert not [c for t, c in world.supabase.reads if "encrypted" in c or c == "*"], (  # type: ignore[union-attr]
            "the D-02 checks must read identity columns only, never a credential column"
        )

    @pytest.mark.parametrize(
        "bad",
        [
            {"disconnected_at": "2026-09-01T00:00:00Z"},
            {"is_active": False},
            {"sync_status": "revoked"},
        ],
        ids=["disconnected", "inactive", "revoked"],
    )
    @pytest.mark.asyncio
    async def test_a_target_strategy_on_a_refused_key_never_reaches_okx(
        self, monkeypatch: pytest.MonkeyPatch, bad: dict[str, Any]
    ) -> None:
        """D-02 for the strategy being rebuilt: its own key is the account being read, so a
        connected job key must not carry a disconnected target through."""
        world = _install(monkeypatch, targets=[(STRATEGY_ID, _key(OTHER_KEY_ID, **bad))])
        outcome = await dispatch(_job())
        _assert_refused(world, outcome, "target_key_disconnected", okx_calls=[])
        assert world.constructions == 0 and world.decrypts == 0

    @pytest.mark.asyncio
    async def test_a_target_on_a_non_okx_key_is_refused_before_any_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _install(monkeypatch, targets=[(STRATEGY_ID, _key(OTHER_KEY_ID, exchange="bybit"))])
        outcome = await dispatch(_job())
        _assert_refused(world, outcome, "key_not_okx", okx_calls=[])
        assert world.constructions == 0

    @pytest.mark.asyncio
    async def test_an_unknown_target_strategy_is_invalid_input(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _install(monkeypatch)  # the strategy table is empty
        outcome = await dispatch(_job())
        _assert_refused(world, outcome, "invalid_input", okx_calls=[])

    @pytest.mark.asyncio
    async def test_a_uid_that_is_not_the_job_keys_account_is_account_mismatch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Reading the wrong account would rebuild one strategy from another's ledger."""
        world = _happy(monkeypatch)
        world.answers[CONFIG] = {"code": "0", "data": [{"uid": "U-OTHER", "perm": "read_only"}]}
        outcome = await dispatch(_job())
        result = _assert_refused(world, outcome, "account_mismatch", okx_calls=[CONFIG])
        assert result["account"]["uid_match"] is False
        assert "U-OTHER" not in json.dumps(result) + outcome.error_message  # type: ignore[operator]

    @pytest.mark.asyncio
    async def test_a_uid_matching_the_job_key_but_not_a_target_key_is_account_mismatch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The job key may be right while the strategy being rebuilt sits on another account."""
        world = _install(
            monkeypatch, targets=[(STRATEGY_ID, _key(OTHER_KEY_ID, venue_account_id="U2"))]
        )
        outcome = await dispatch(_job())
        result = _assert_refused(world, outcome, "account_mismatch", okx_calls=[CONFIG])
        assert result["account"]["uid_match"] is False

    @pytest.mark.asyncio
    async def test_a_key_with_no_stored_account_id_cannot_match(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Fail-closed: an unstamped key cannot be shown to be the account being read."""
        world = _install(monkeypatch, job_key=_key(venue_account_id=None))
        outcome = await dispatch(_job({"rebuild_strategy_ids": []}))
        _assert_refused(world, outcome, "account_mismatch", okx_calls=[CONFIG])

    @pytest.mark.asyncio
    async def test_a_key_without_read_only_permission_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A key that is not read-only widens the blast radius of everything this job does."""
        world = _happy(monkeypatch)
        world.answers[CONFIG] = {"code": "0", "data": [{"uid": "U1", "perm": "trade"}]}
        outcome = await dispatch(_job())
        result = _assert_refused(world, outcome, "perm_not_read_only", okx_calls=[CONFIG])
        assert result["account"]["uid_match"] is True and result["account"]["read_only"] is False

    @pytest.mark.asyncio
    async def test_a_live_subtype_remapped_away_from_its_bucket_is_subtype_map_drift(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-08: funding subtype 173 re-mapped from type 8 would be summed as P&L (or lost).
        Stops after account/config and account/subtypes, and the result names the subtype."""
        world = _happy(monkeypatch)
        world.answers[SUBTYPES] = {"code": "0", "data": [
            {"type": "2", "subTypes": [{"subType": "173"}, {"subType": "174"}]},
            {"type": "1", "subTypes": [{"subType": "11"}]},
        ]}
        outcome = await dispatch(_job())
        result = _assert_refused(
            world, outcome, "subtype_map_drift", okx_calls=[CONFIG, SUBTYPES],
            detail="drift_subtypes=2",
        )
        assert result["subtypes"]["drift"] == ["173", "174"]

    @pytest.mark.parametrize(
        ("sub_type", "live_type"),
        [("11", "2"), ("1", "1"), ("2", "8"), ("111", "8")],
        ids=["flow-not-transfer", "realized-as-transfer", "realized-as-funding", "non-external-as-funding"],
    )
    @pytest.mark.asyncio
    async def test_each_bucket_rule_of_the_drift_comparison_bites(
        self, monkeypatch: pytest.MonkeyPatch, sub_type: str, live_type: str
    ) -> None:
        world = _happy(monkeypatch)
        world.answers[SUBTYPES] = {"code": "0", "data": [
            {"type": live_type, "subTypes": [{"subType": sub_type}]}
        ]}
        outcome = await dispatch(_job())
        result = _assert_refused(
            world, outcome, "subtype_map_drift", okx_calls=[CONFIG, SUBTYPES],
            detail="drift_subtypes=1",
        )
        assert result["subtypes"]["drift"] == [sub_type]

    @pytest.mark.asyncio
    async def test_an_unreadable_subtype_body_is_a_stop_not_a_pass(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The census is a gate: "could not read the map" must not read as "no drift"."""
        world = _happy(monkeypatch)
        world.answers[SUBTYPES] = {"code": "0", "data": []}
        outcome = await dispatch(_job())
        _assert_refused(
            world, outcome, "subtype_map_drift", okx_calls=[CONFIG, SUBTYPES],
            detail="live_subtypes=0",
        )

    @pytest.mark.parametrize(
        "metadata",
        [
            {"mode": "calibrate"},
            {"mode": "apply"},
            {"mode": "nonsense"},
            {"mode": None},
            {"quarters": [{"year": 2026, "quarter": "Q4"}]},  # the current quarter
            {"quarters": [{"year": 2027, "quarter": "Q1"}]},  # a future quarter
            {"quarters": [{"year": 2026, "quarter": "Q2"}] * 2},  # duplicate
            {"quarters": [{"year": y, "quarter": "Q1"} for y in range(2021, 2026)]},  # five
            {"quarters": []},
            {"quarters": [{"year": 2026, "quarter": "Q5"}]},  # unknown label
            {"quarters": [{"year": 2026.0, "quarter": "Q2"}]},
            {"quarters": [{"year": True, "quarter": "Q2"}]},
            {"quarters": [{"year": 2026, "quarter": "Q2", "extra": 1}]},
            {"quarters": "2026Q2"},
            {"rebuild_strategy_ids": ["not-a-uuid"]},
            {"rebuild_strategy_ids": "oops"},
            {"approved_fingerprint": "ABC"},
        ],
        ids=lambda m: json.dumps(m, default=str)[:40],
    )
    @pytest.mark.asyncio
    async def test_malformed_input_is_invalid_input_with_zero_okx_calls(
        self, monkeypatch: pytest.MonkeyPatch, metadata: dict[str, Any]
    ) -> None:
        """Calibrate and apply are not accepted by this plan; a quarter OKX cannot have a file
        for (current or future) or a malformed request never reaches the exchange."""
        world = _happy(monkeypatch)
        outcome = await dispatch(_job(metadata))
        _assert_refused(world, outcome, "invalid_input", okx_calls=[])
        assert world.constructions == 0

    @pytest.mark.asyncio
    async def test_a_non_object_metadata_is_invalid_input(self, monkeypatch: pytest.MonkeyPatch) -> None:
        world = _happy(monkeypatch)
        job = _job()
        job["metadata"] = None
        outcome = await dispatch(job)
        result = _assert_refused(world, outcome, "invalid_input", okx_calls=[])
        assert result["mode"] is None

    @pytest.mark.asyncio
    async def test_a_venue_refusal_of_the_apply_is_archive_request_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An authentication or permission refusal of the apply is permanent and still writes
        its block; the apply instance is closed on the way out."""
        world = _happy(monkeypatch)

        def _boom(_inst: Any, _params: dict[str, str]) -> Any:
            raise ccxt.AuthenticationError('okx {"code":"50111","msg":"Invalid OK-ACCESS-KEY"}')

        world.answers[APPLY] = _boom
        outcome = await dispatch(_job())
        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == "okx_archive_rebuild: archive_request_failed quarter=2026-Q3"
        result = world.result()
        assert result["stop_class"] == "archive_request_failed"
        assert result["quarters"][0]["state"] is None
        assert all(i.closed for i in world.instances)

    @pytest.mark.asyncio
    async def test_an_apply_rate_limit_is_transient_and_never_stamps_the_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A venue 429 on the apply is retried by the dispatcher; stamping the key's 429
        would open the exchange-wide breaker and pause normal OKX syncs (RESEARCH Section 5).
        The defer-and-wait for it belongs to plan 16."""
        world = _happy(monkeypatch)

        def _limited(_inst: Any, _params: dict[str, str]) -> Any:
            raise ccxt.RateLimitExceeded('okx {"code":"50011","msg":"Too Many Requests"}')

        world.answers[APPLY] = _limited
        outcome = await dispatch(_job())
        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "transient"
        assert "stamp_api_key_429" not in [n for n, _ in world.supabase.rpcs]  # type: ignore[union-attr]
        assert all(i.closed for i in world.instances)


class TestApplyPacing:
    @pytest.mark.asyncio
    async def test_two_applies_are_at_least_eleven_seconds_apart_each_on_its_own_instance(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OKX documents one apply per 10 s. With a fake clock that never advances, the
        second apply must wait the full gap, and no apply shares an instance with another
        call."""
        world = _happy(monkeypatch)
        slept: list[float] = []

        async def _record(seconds: float) -> None:
            slept.append(seconds)

        monkeypatch.setattr(okx_archive_job, "_sleep", _record)
        monkeypatch.setattr(okx_archive_job, "_monotonic", lambda: 1000.0)

        outcome = await dispatch(
            _job({"quarters": [{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]})
        )

        assert outcome.outcome == DispatchOutcome.DONE
        assert slept == [okx_archive_job.MIN_APPLY_GAP_S] and okx_archive_job.MIN_APPLY_GAP_S >= 11
        assert [i.calls for i in world.instances] == [
            [CONFIG, SUBTYPES, STATUS, STATUS], [APPLY], [APPLY]
        ]
        result = world.result()
        assert [(q["year"], q["quarter"]) for q in result["quarters"]] == [(2026, "Q2"), (2026, "Q3")]


# ---------------------------------------------------------------------------
# Result shape v1
# ---------------------------------------------------------------------------

TOP_LEVEL_KEYS = {
    "result_version", "mode", "stop_class", "account", "subtypes", "quarters", "census",
    "reconcile", "excluded", "info", "d03", "strategies", "fingerprint",
}
QUARTER_KEYS = {
    "year", "quarter", "state", "applied_existing", "href_scheme", "href_host", "container",
    "compressed_bytes", "decompressed_bytes", "has_type_column", "ts_min_day", "ts_max_day",
    "row_count",
}
INGEST_KEYS = QUARTER_KEYS - {"year", "quarter", "state", "applied_existing", "href_scheme", "href_host"}


class TestResultShape:
    """Plans 12, 14 and 15 and the runbook's ``job-result`` form read these exact paths, so
    renaming one is a contract change in all of them. A key the mode does not reach is null,
    never omitted: a reader that finds a missing key cannot tell "not reached" from "dropped"."""

    @pytest.mark.asyncio
    async def test_a_preflight_result_has_every_key_with_the_pinned_types(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)

        async def _no_sleep(_seconds: float) -> None:
            return None

        monkeypatch.setattr(okx_archive_job, "_sleep", _no_sleep)
        await dispatch(_job({"quarters": [{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]}))
        result = world.result()

        assert set(result) == TOP_LEVEL_KEYS
        assert result["result_version"] == 1 and result["mode"] == "preflight"
        assert result["stop_class"] is None
        assert isinstance(result["account"]["uid_match"], bool)
        assert isinstance(result["account"]["read_only"], bool)
        assert set(result["account"]) == {"uid_match", "read_only", "acct_lv", "fee_type", "settle_ccy"}
        assert set(result["subtypes"]) == {"live_count", "drift", "unlisted_by_type"}
        assert isinstance(result["subtypes"]["live_count"], int)
        quarters = result["quarters"]
        assert [(q["year"], q["quarter"]) for q in quarters] == [(2026, "Q2"), (2026, "Q3")]
        for q in quarters:
            assert set(q) == QUARTER_KEYS
            assert q["state"] == "finished" and isinstance(q["applied_existing"], bool)
            assert q["href_scheme"] == "https" and q["href_host"] == "archive.example.test"
            assert all(q[k] is None for k in INGEST_KEYS), "ingest keys are present as null"
        for unreached in ("census", "reconcile", "excluded", "info", "d03", "strategies", "fingerprint"):
            assert result[unreached] is None, unreached
        json.dumps(result)  # plain JSON all the way down

    @pytest.mark.asyncio
    async def test_a_refusal_result_has_every_key_too(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A refusal after the account check keeps ``account`` filled and nulls what it did
        not reach."""
        world = _happy(monkeypatch)
        world.answers[CONFIG] = {"code": "0", "data": [{"uid": "U1", "perm": "trade", "acctLv": "3"}]}
        await dispatch(_job())
        result = world.result()

        assert set(result) == TOP_LEVEL_KEYS
        assert result["result_version"] == 1 and result["stop_class"] == "perm_not_read_only"
        assert result["account"]["uid_match"] is True and result["account"]["read_only"] is False
        assert result["account"]["acct_lv"] == "3"
        assert result["subtypes"] is None and result["quarters"] is None
        assert all(result[k] is None for k in TOP_LEVEL_KEYS - {
            "result_version", "mode", "stop_class", "account"})

    @pytest.mark.asyncio
    async def test_a_pre_account_refusal_never_reads_as_a_pass(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Before ``account/config`` ran nothing was verified, so the booleans read False."""
        world = _install(monkeypatch, job_key=_key(is_active=False))
        await dispatch(_job({"rebuild_strategy_ids": []}))
        result = world.result()
        assert set(result) == TOP_LEVEL_KEYS
        assert result["account"]["uid_match"] is False and result["account"]["read_only"] is False

    @pytest.mark.asyncio
    async def test_a_lost_claim_token_does_not_fail_a_clean_preflight(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``set_compute_job_progress`` returns false when a watchdog reclaim moved the row
        on; the late mark is then fenced by the queue, so the handler just reports DONE."""
        world = _happy(monkeypatch)
        world.supabase.progress_returns = False  # type: ignore[union-attr]
        outcome = await dispatch(_job())
        assert outcome.outcome == DispatchOutcome.DONE


class TestStopClassContract:
    def test_the_stop_classes_are_the_closed_contract_set(self) -> None:
        assert okx_archive_job.STOP_CLASSES == {
            "invalid_input", "key_not_okx", "key_disconnected", "target_key_disconnected",
            "account_mismatch", "perm_not_read_only", "subtype_map_drift",
            "archive_request_failed", "archive_give_up", "download_refused", "link_expired",
            "container_unknown", "header_drift", "quarter_range_mismatch",
            "duplicate_bill_conflict", "unparseable_amount", "unknown_subtype_nonzero",
            "non_usd_ccy", "live_anchor_unusable", "identity_violation", "reconcile_miss",
            "d03_zero_day_has_archive_pnl", "fingerprint_missing", "fingerprint_mismatch",
            "rpc_refused",
        }
        assert okx_archive_job.TRANSIENT_STOP_CLASSES == {"link_expired"}

    def test_an_unlisted_class_cannot_be_raised(self) -> None:
        """A typo'd class would otherwise ship as a silent new class no reader knows."""
        with pytest.raises(AssertionError):
            okx_archive_job._Stop("not_a_class")


class TestLiveTypeLiterals:
    def test_the_funding_type_literal_equals_the_live_aggregator_literal(self) -> None:
        """The drift comparison expects funding subtypes to be live type 8 because the live
        path drops type 8 from realized. The literal is function-local in exchange.py, so
        a source-text pin keeps the two from drifting apart."""
        import inspect

        from services import exchange

        assert f'_OKX_FUNDING_BILL_TYPE = "{okx_archive_job._OKX_FUNDING_BILL_TYPE}"' in inspect.getsource(
            exchange.fetch_daily_pnl
        )
