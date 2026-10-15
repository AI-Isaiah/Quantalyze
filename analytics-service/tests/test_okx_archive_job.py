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
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import ccxt.async_support as ccxt
import httpx
import pytest

import main_worker
from services import job_worker, okx_archive_download, okx_archive_job
from services.job_worker import DispatchOutcome, TIMEOUT_PER_KIND, dispatch
from services.okx_archive_download import LinkExpired

KEY_ID = "11111111-1111-4111-8111-111111111111"
OTHER_KEY_ID = "22222222-2222-4222-8222-222222222222"
STRATEGY_ID = "33333333-3333-4333-8333-333333333333"
STRATEGY_2_ID = "44444444-4444-4444-8444-444444444444"
LINK_SECRETS = ("SECRET-PATH-3f9a", "SECRET-QUERY-77c1", "2026Q3.zip", "2026Q2.zip", "sig=")
FIXTURES = Path(__file__).parent / "fixtures" / "okx_archive"

ENV = {"today": date(2026, 10, 15)}

#: OKX's request ``ts`` for every default answer, and the fake wall clock three hours later:
#: past the 2 h first-read rule and short of the 8 h give-up bound.
REQUEST_TS_MS = 1790000000000
NOW_MS = REQUEST_TS_MS + 3 * 3600 * 1000


def _link(year: str, quarter: str, version: str = "") -> str:
    """A signed-looking link: its path and query are the bearer secrets the job must never
    let out of memory (only the scheme and host may be described)."""
    return f"https://archive.example.test/dl/SECRET-PATH-3f9a/{year}{quarter}{version}.zip?sig=SECRET-QUERY-77c1"


def _finished(year: str, quarter: str, version: str = "", ts: int = REQUEST_TS_MS) -> dict[str, Any]:
    return {"code": "0", "data": [
        {"fileHref": _link(year, quarter, version), "state": "finished", "ts": str(ts)}
    ]}


def _status(state: str, *, href: str = "", ts: int = REQUEST_TS_MS) -> dict[str, Any]:
    return {"code": "0", "data": [{"fileHref": href, "state": state, "ts": str(ts)}]}


def _apply_answer(result: str, ts: int = REQUEST_TS_MS) -> dict[str, Any]:
    return {"code": "0", "data": [{"result": result, "ts": str(ts)}]}

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
        APPLY: _apply_answer("true"),
        STATUS: lambda _inst, params: _finished(params["year"], params["quarter"]),
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
        #: rpc name -> exception raised when it is executed (the call is still recorded).
        self.rpc_errors: dict[str, Exception] = {}

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        self.rpcs.append((name, params))
        self._world.timeline.append(("rpc", name))
        data: Any = self.progress_returns if name == "set_compute_job_progress" else None

        def _execute() -> Any:
            if name in self.rpc_errors:
                raise self.rpc_errors[name]
            return SimpleNamespace(data=data)

        return SimpleNamespace(execute=_execute)


class _World:
    def __init__(self) -> None:
        self.answers: dict[str, Any] = _default_answers()
        self.instances: list[_FakeExchange] = []
        self.timeline: list[tuple[Any, str]] = []
        self.decrypts = 0
        self.constructions = 0
        self.supabase: _FakeSupabase | None = None
        #: Every link handed to the downloader, in order.
        self.downloads: list[str] = []
        #: Queue of exceptions the downloader raises (consumed one per call), then it serves.
        self.download_errors: list[Exception] = []
        #: When set, the downloader serves these bytes instead of the committed fixture.
        self.csv_override: bytes | None = None

    async def download(self, url: str) -> tuple[bytes, str, int]:
        """Stands in for ``okx_archive_download.download_archive_csv``: serves the committed
        quarter fixture the link names, with fixed independent compressed sizes."""
        self.downloads.append(url)
        if self.download_errors:
            raise self.download_errors.pop(0)
        if self.csv_override is not None:
            return self.csv_override, "zip", 1234
        if "2026Q2" in url:
            return (FIXTURES / "q2_like.csv").read_bytes(), "zip", 987
        return (FIXTURES / "q3_like.csv").read_bytes(), "zip", 1234

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
    monkeypatch.setattr(okx_archive_job, "_wall_ms", lambda: NOW_MS)
    monkeypatch.setattr(okx_archive_job, "download_archive_csv", world.download)

    async def _skip_evaluation(*_args: Any, **_kwargs: Any) -> None:
        # Plan 08's evaluation (live crawl, reconciliation, rebuild, apply) is exercised by
        # tests/test_okx_archive_apply.py with its own live-side fakes. These tests protect
        # the wait, the ingest and the refusals in front of it, so they stop where that
        # layer begins and keep asserting the readings that layer must not disturb.
        return None

    monkeypatch.setattr(okx_archive_job, "_run_evaluation", _skip_evaluation)
    return world


def _created_at(ms: int) -> str:
    """The ISO string PostgREST returns for ``compute_jobs.created_at``."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def _job(
    metadata: dict[str, Any] | None = None,
    *,
    api_key_id: str | None = KEY_ID,
    created_at: Any = ...,
) -> dict[str, Any]:
    """A claimed row. ``created_at`` defaults to the time of OKX's request (three hours
    before the fake clock), a job well inside every bound."""
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
        "created_at": _created_at(REQUEST_TS_MS) if created_at is ... else created_at,
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
# Plan 16 Task 1: the calibrate tracer (wait across a restart, then ingest)
# ---------------------------------------------------------------------------

#: Independent literals for the committed ``q3_like.csv`` fixture, counted from the file
#: itself with ``cut``/``sort``/``uniq`` (not from the parser): 22 distinct bills, UTC days
#: 2026-07-01 .. 2026-09-30, three USDC rows (one with P&L, two zero-effect, so the USDC chain
#: has the two pairs the completeness floor needs) among nineteen USDT.
Q3_EXPECTED = {
    "row_count": 22,
    "ts_min_day": "2026-07-01",
    "ts_max_day": "2026-09-30",
    "compressed_bytes": 1234,  # what the fake downloader reports, passed through unchanged
}
Q3_CENSUS = {
    "by_ccy": {"USDC": 3, "USDT": 19},
    "by_inst_type": {"(blank)": 2, "FUTURES": 1, "OPTION": 1, "SPOT": 1, "SWAP": 17},
    "by_sub_type": {
        "1": 4, "100": 1, "104": 1, "11": 1, "110": 1, "12": 1,
        "173": 3, "174": 2, "2": 6, "3": 1, "5": 1,
    },
    "unknown_zero_effect": 0,
}


def _calibrate(extra: dict[str, Any] | None = None, **kw: Any) -> dict[str, Any]:
    return _job({"mode": "calibrate", **(extra or {})}, **kw)


class TestTracerCalibrateIngest:
    @pytest.mark.asyncio
    async def test_a_calibrate_job_defers_then_a_restarted_claim_ingests_the_quarter(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """SC-1 in one scenario. OKX takes hours to generate a quarterly file, so the first
        claim finds the request still `ongoing` and must park the job (attempts untouched),
        not fail it. The worker then restarts: the next claim has NO memory of the first,
        yet re-reads OKX, gets a fresh link, downloads and reads the file. The link is a
        bearer token and appears in no RPC parameter, log record or error text."""
        caplog.set_level(logging.DEBUG)

        first = _happy(monkeypatch)
        first.answers[APPLY] = _apply_answer("false")
        first.answers[STATUS] = _status("ongoing")
        waiting = await dispatch(_calibrate())

        assert waiting.outcome == DispatchOutcome.DEFERRED
        assert [n for n, _ in first.supabase.rpcs] == ["defer_compute_job"]  # type: ignore[union-attr]
        (_, defer), = first.supabase.rpcs  # type: ignore[union-attr]
        assert defer["p_job_id"] == "job-1" and defer["p_claim_token"] == "tok-1"
        assert 0 < defer["p_defer_seconds"] <= 3600
        assert defer["p_reason"].startswith("okx_archive_rebuild: waiting")
        assert first.downloads == [], "nothing is downloaded while the request is ongoing"

        # Restart: a brand-new world (new exchange instances, new database fake). Nothing
        # from the first claim can reach it except through OKX.
        second = _happy(monkeypatch)
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DONE and outcome.error_message is None
        assert second.downloads == [_link("2026", "Q3")]
        result = second.result()
        assert result["mode"] == "calibrate" and result["stop_class"] is None
        (quarter,) = result["quarters"]
        assert quarter == {
            "year": 2026, "quarter": "Q3", "state": "finished", "applied_existing": True,
            "href_scheme": "https", "href_host": "archive.example.test",
            "container": "zip",
            "compressed_bytes": Q3_EXPECTED["compressed_bytes"],
            "decompressed_bytes": len((FIXTURES / "q3_like.csv").read_bytes()),
            "has_type_column": False,
            "ts_min_day": Q3_EXPECTED["ts_min_day"], "ts_max_day": Q3_EXPECTED["ts_max_day"],
            "row_count": Q3_EXPECTED["row_count"],
            # Worked from the fixture's ts column with date arithmetic: its bills fall on 13
            # days and the longest quiet stretch of the quarter is 09-16..09-29.
            "longest_billless_run": {"days": 14, "from": "2026-09-16", "to": "2026-09-29"},
        }
        assert result["census"] == Q3_CENSUS
        for not_yet in ("reconcile", "excluded", "info", "d03", "strategies", "fingerprint"):
            assert result[not_yet] is None, f"{not_yet} belongs to plan 08"

        everything = (
            json.dumps([first.supabase.rpcs, second.supabase.rpcs], default=str)  # type: ignore[union-attr]
            + caplog.text + repr(waiting) + repr(outcome)
        )
        for secret in LINK_SECRETS:
            assert secret not in everything, f"the link leaked: {secret!r}"
        names = [n for n, _ in second.supabase.rpcs]  # type: ignore[union-attr]
        assert names == ["set_compute_job_progress"], "no table write, no mark_*, no defer"

    @pytest.mark.asyncio
    async def test_two_quarters_are_ingested_in_input_order_into_one_census(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Calibrate reads every requested quarter, in the order asked, and the census is the
        union (the same bill in two files would be a conflict, which the aggregator owns)."""
        world = _happy(monkeypatch)

        async def _no_sleep(_s: float) -> None:
            return None

        monkeypatch.setattr(okx_archive_job, "_sleep", _no_sleep)
        outcome = await dispatch(_calibrate({"quarters": [
            {"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]}))

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.downloads == [_link("2026", "Q2"), _link("2026", "Q3")]
        result = world.result()
        q2, q3 = result["quarters"]
        assert (q2["quarter"], q2["row_count"], q2["compressed_bytes"]) == ("Q2", 14, 987)
        assert (q3["quarter"], q3["row_count"], q3["compressed_bytes"]) == ("Q3", 22, 1234)
        assert sum(result["census"]["by_ccy"].values()) == 14 + 22

    @pytest.mark.asyncio
    async def test_the_module_keeps_no_mutable_state_between_claims(self) -> None:
        """Statelessness is the property that makes a restart harmless. A module-level dict,
        list or set is exactly where a link, a `ts` or a "second failure" counter would hide,
        so a new one must be a conscious, reviewed addition to this allow-list."""
        constants = {"_EXPECTED_LIVE_TYPE", "_FORBIDDEN_LIVE_TYPES", "_PARSE_STOP_CLASS"}
        mutable = {
            name for name, value in vars(okx_archive_job).items()
            if isinstance(value, (dict, list, set, bytearray)) and not name.startswith("__")
        }
        assert mutable <= constants, f"module-level mutable state: {sorted(mutable - constants)}"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "metadata",
        [
            {"rebuild_strategy_ids": []},
            {"rebuild_strategy_ids": None},
            {"approved_fingerprint": "a" * 64},  # apply-only key
        ],
        ids=["empty-rebuild-list", "missing-rebuild-list", "fingerprint-on-calibrate"],
    )
    async def test_calibrate_input_rules_follow_the_contract(
        self, monkeypatch: pytest.MonkeyPatch, metadata: dict[str, Any]
    ) -> None:
        """A calibration of no strategy proves nothing, and `approved_fingerprint` belongs to
        apply only: a calibrate carrying one means the operator mixed up the modes."""
        world = _happy(monkeypatch)
        outcome = await dispatch(_calibrate(metadata))
        _assert_refused(world, outcome, "invalid_input", okx_calls=[])


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


def _assert_stopped(
    world: _World, outcome: job_worker.DispatchResult, stop_class: str, *, detail: str = ""
) -> dict[str, Any]:
    """A stop AFTER the archive was requested: permanent, class + counts only in `last_error`,
    and the result block was written before the FAILED return."""
    assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
    expected = f"okx_archive_rebuild: {stop_class}" + (f" {detail}" if detail else "")
    assert outcome.error_message == expected
    result = world.result()
    assert result["stop_class"] == stop_class
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
        """A quarter OKX cannot have a file for (current or future) or a malformed request
        never reaches the exchange. (An apply without its fingerprint is `fingerprint_missing`,
        not `invalid_input`: tests/test_okx_archive_apply.py pins it.)"""
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
# Plan 16 Task 2: the wait survives restarts, never burns a retry, never wedges
# ---------------------------------------------------------------------------

H = 3600 * 1000  # one hour in ms, the scale of OKX's request ts
MARK = "mark_compute_job_done", "mark_compute_job_failed"


class _Clock:
    """A fake monotonic clock whose ``sleep`` advances it, so spacing is a measurement."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def _use_clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    clock = _Clock()
    monkeypatch.setattr(okx_archive_job, "_monotonic", clock)
    monkeypatch.setattr(okx_archive_job, "_sleep", clock.sleep)
    return clock


def _defers(world: _World) -> list[dict[str, Any]]:
    return [p for n, p in world.supabase.rpcs if n == "defer_compute_job"]  # type: ignore[union-attr]


def _rpc_names(world: _World) -> list[str]:
    return [n for n, _ in world.supabase.rpcs]  # type: ignore[union-attr]


def _applies(world: _World) -> int:
    return world.all_calls.count(APPLY)


def _sequence(*answers: Any) -> Callable[[Any, dict[str, str]], Any]:
    """An answer that gives each successive call its own response (the last one repeats)."""
    calls = {"n": 0}

    def _answer(_inst: Any, _params: dict[str, str]) -> Any:
        value = answers[min(calls["n"], len(answers) - 1)]
        calls["n"] += 1
        return value

    return _answer


class _PgError(Exception):
    """What PostgREST surfaces for a fenced defer: the SQLSTATE rides in ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class TestRateLimitedApply:
    @pytest.mark.asyncio
    async def test_every_apply_is_the_last_call_on_its_own_instance_and_spaced_by_the_clock(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """T-RL-1. ccxt prices the apply POST at 72000, so the next call on the same instance
        blocks about two hours; and OKX documents one apply per 10 s. Both are properties of
        the SEQUENCE of calls, so they are asserted on the recorded timeline against a fake
        clock, across two quarters."""
        world = _happy(monkeypatch)
        clock = _use_clock(monkeypatch)
        apply_times: list[float] = []

        def _apply(_inst: Any, _params: dict[str, str]) -> Any:
            apply_times.append(clock.now)
            return _apply_answer("true")

        world.answers[APPLY] = _apply
        outcome = await dispatch(_calibrate({"quarters": [
            {"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]}))

        assert outcome.outcome == DispatchOutcome.DONE
        apply_instances = [i for i in world.instances if APPLY in i.calls]
        assert len(apply_instances) == 2 and apply_instances[0] is not apply_instances[1]
        for inst in apply_instances:
            assert inst.calls == [APPLY], "the POST is the ONLY (hence last) call on its instance"
            assert inst.closed
        assert APPLY not in world.instances[0].calls, "the preflight instance never POSTs"
        assert len(apply_times) == 2 and apply_times[1] - apply_times[0] >= 11

    @pytest.mark.asyncio
    async def test_a_rate_limited_apply_defers_at_least_fifteen_minutes_and_never_stamps_the_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A venue 429 on the apply is a reason to wait, not to fail: stamping the key's 429
        would open the exchange-wide breaker and pause every normal OKX sync for a quota
        this job alone burned (RESEARCH Section 5). It defers, as a deferral (attempts
        untouched), for at least the 15 minutes OKX's per-account window needs."""
        world = _happy(monkeypatch)
        stamped: list[object] = []

        async def _spy(*a: object, **k: object) -> None:
            stamped.append(a)

        monkeypatch.setattr(job_worker, "_stamp_429", _spy)

        def _limited(_inst: Any, _params: dict[str, str]) -> Any:
            raise ccxt.RateLimitExceeded('okx {"code":"50011","msg":"Too Many Requests"}')

        world.answers[APPLY] = _limited
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DEFERRED
        (defer,) = _defers(world)
        assert 900 <= defer["p_defer_seconds"] <= 3600 and defer["p_claim_token"] == "tok-1"
        assert stamped == [] and "stamp_api_key_429" not in _rpc_names(world)
        assert not [n for n in _rpc_names(world) if n.startswith("mark_")]
        assert all(i.closed for i in world.instances), "the apply instance is closed on the way out"

    @pytest.mark.parametrize("exc", [ccxt.RateLimitExceeded, ccxt.DDoSProtection])
    @pytest.mark.asyncio
    async def test_a_rate_limited_status_read_defers_too(
        self, monkeypatch: pytest.MonkeyPatch, exc: type[Exception]
    ) -> None:
        """The status read goes through the retrying helper; a 429 that survives its retries
        must end as the same defer, not as a failed attempt and not as a key stamp."""
        from services import exchange as exchange_module

        monkeypatch.setattr(exchange_module, "OKX_BILLS_BACKOFF_BASE_S", 0.0)
        monkeypatch.setattr(exchange_module.random, "uniform", lambda _a, _b: 0.0)
        world = _happy(monkeypatch)

        def _limited(_inst: Any, _params: dict[str, str]) -> Any:
            raise exc("okx 429")

        world.answers[STATUS] = _limited
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert _defers(world)[0]["p_defer_seconds"] >= 900
        assert "stamp_api_key_429" not in _rpc_names(world)


class TestWaitIsADeferNeverAFailure:
    @pytest.mark.asyncio
    async def test_a_fresh_request_waits_for_the_first_read_without_asking_okx_yet(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OKX needs 2-3 h to generate a file, so asking sooner only burns rate limit. The
        remaining ~2 h exceeds the one-hour cap `defer_compute_job` enforces in SQL, so the
        wait is clamped to it: an unclamped call would RAISE in the database and fail a job
        that should simply wait. (T-LINK-5: p_defer_seconds <= 3600.)"""
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 60_000)  # requested 1 min ago
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DEFERRED
        (defer,) = _defers(world)
        assert defer["p_defer_seconds"] == 3600, "clamped to the SQL cap, never above it"
        assert defer["p_claim_token"] == "tok-1" and defer["p_job_id"] == "job-1"
        assert STATUS not in world.all_calls, "no status read before the 2 h first-read rule"
        assert _rpc_names(world) == ["defer_compute_job"], "no result block, no mark_*"

    @pytest.mark.asyncio
    async def test_an_ongoing_request_defers_fifteen_minutes_with_a_short_reason(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """T-LINK-5. `last_error` receives the defer reason: a class and counts, never the
        request `ts` or the link, because `last_error` is shown to operators."""
        caplog.set_level(logging.DEBUG)
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = _status("ongoing", ts=NOW_MS - 3 * H)
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DEFERRED and outcome.error_message is None
        (defer,) = _defers(world)
        assert defer["p_defer_seconds"] == 900
        assert defer["p_reason"] == "okx_archive_rebuild: waiting quarters_ready=0/1"
        assert str(NOW_MS - 3 * H) not in json.dumps(world.supabase.rpcs) + caplog.text  # type: ignore[union-attr]
        assert not [n for n in _rpc_names(world) if n.startswith("mark_")]
        assert world.downloads == []

    @pytest.mark.parametrize(
        ("age_ms", "expect_give_up"),
        [(8 * H - 1000, False), (8 * H, True), (9 * H, True)],
        ids=["one-second-short", "exactly-eight-hours", "nine-hours"],
    )
    @pytest.mark.asyncio
    async def test_the_give_up_bound_comes_from_okx_ts_at_eight_hours(
        self, monkeypatch: pytest.MonkeyPatch, age_ms: int, expect_give_up: bool
    ) -> None:
        """A request OKX never finishes must end, and the bound is the REQUEST's age from
        OKX's own `ts` (a counter would reset with every restart and so never fire)."""
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - age_ms)
        world.answers[STATUS] = _status("ongoing", ts=NOW_MS - age_ms)
        outcome = await dispatch(_calibrate())

        if expect_give_up:
            result = _assert_stopped(
                world, outcome, "archive_give_up", detail=f"quarter=2026-Q3 age_h={age_ms // H}"
            )
            assert result["quarters"][0]["state"] == "ongoing"
            assert world.instances[0].calls == [CONFIG, SUBTYPES, STATUS] and _applies(world) == 1
        else:
            assert outcome.outcome == DispatchOutcome.DEFERRED

    @pytest.mark.asyncio
    async def test_a_failed_request_is_reapplied_exactly_once_then_the_job_waits(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OKX can fail a generation. One re-apply while the request is young is the
        remedy; a second POST must also respect the 10 s rule and use a fresh instance."""
        world = _happy(monkeypatch)
        clock = _use_clock(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = _sequence(
            _status("failed", ts=NOW_MS - 3 * H), _status("ongoing", ts=NOW_MS - 10 * 1000)
        )
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert _applies(world) == 2, "one apply per claim plus exactly ONE re-apply"
        assert _defers(world)[0]["p_defer_seconds"] == 900
        assert clock.slept and clock.slept[0] >= 11, "the re-apply waited out the 10 s rule"
        apply_instances = [i for i in world.instances if APPLY in i.calls]
        assert all(i.calls == [APPLY] for i in apply_instances) and len(apply_instances) == 2

    @pytest.mark.asyncio
    async def test_a_second_failure_is_a_permanent_stop_not_a_third_apply(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A request that fails again after the re-apply will not heal: loop on it and the
        job waits for ever on a file that will never exist."""
        world = _happy(monkeypatch)
        _use_clock(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = _status("failed", ts=NOW_MS - 3 * H)
        outcome = await dispatch(_calibrate())

        result = _assert_stopped(world, outcome, "archive_request_failed", detail="quarter=2026-Q3")
        assert world.instances[0].calls == [CONFIG, SUBTYPES, STATUS, STATUS]
        assert _applies(world) == 2 and result["quarters"][0]["state"] == "failed"

    @pytest.mark.asyncio
    async def test_an_old_failed_request_is_permanent_without_a_reapply(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 9 * H)
        world.answers[STATUS] = _status("failed", ts=NOW_MS - 9 * H)
        outcome = await dispatch(_calibrate())

        _assert_stopped(world, outcome, "archive_request_failed", detail="quarter=2026-Q3")
        assert world.instances[0].calls == [CONFIG, SUBTYPES, STATUS] and _applies(world) == 1

    @pytest.mark.asyncio
    async def test_a_reapply_that_heals_the_request_carries_on_to_the_ingest(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        _use_clock(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = _sequence(
            _status("failed", ts=NOW_MS - 3 * H), _finished("2026", "Q3", ts=NOW_MS - 3 * H)
        )
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.downloads == [_link("2026", "Q3")] and _applies(world) == 2

    @pytest.mark.parametrize("mode", ["calibrate", "preflight"])
    @pytest.mark.asyncio
    async def test_finished_with_an_empty_link_never_reaches_done(
        self, monkeypatch: pytest.MonkeyPatch, mode: str
    ) -> None:
        """T-LINK-4. `finished` with no `fileHref` is the lost-link bug in its purest form:
        a job that took it for success would report DONE with the data missing. It re-applies
        once (a fresh link is what a new request produces) and waits."""
        world = _happy(monkeypatch)
        _use_clock(monkeypatch)
        world.answers[STATUS] = _status("finished", href="")
        outcome = await dispatch(_calibrate({"mode": mode}))

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert _applies(world) == 2 and world.downloads == []
        assert _rpc_names(world) == ["defer_compute_job"], "no result block claims `finished`"
        assert _defers(world)[0]["p_defer_seconds"] == 900

    @pytest.mark.asyncio
    async def test_an_empty_link_that_the_reapply_replaces_is_ingested(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        _use_clock(monkeypatch)
        world.answers[STATUS] = _sequence(
            _status("finished", href=""), _finished("2026", "Q3")
        )
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.downloads == [_link("2026", "Q3")]

    @pytest.mark.asyncio
    async def test_an_empty_link_on_an_old_request_gives_up(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        world.answers[STATUS] = _status("finished", href="", ts=NOW_MS - 9 * H)
        outcome = await dispatch(_calibrate())

        _assert_stopped(world, outcome, "archive_give_up", detail="quarter=2026-Q3 age_h=9")

    @pytest.mark.asyncio
    async def test_an_unreadable_state_is_a_loud_stop_not_a_wait(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OKX's state vocabulary is closed. Something else is contract drift, and waiting
        eight hours to find out would hide it."""
        world = _happy(monkeypatch)
        world.answers[STATUS] = {"code": "0", "data": [{"state": "paused", "ts": str(REQUEST_TS_MS)}]}
        outcome = await dispatch(_calibrate())

        _assert_stopped(world, outcome, "archive_request_failed", detail="quarter=2026-Q3")

    @pytest.mark.asyncio
    async def test_a_lost_claim_while_deferring_yields_without_raising(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A watchdog reclaim hands the row to another worker; our fenced defer then raises
        SQLSTATE 55006. The other worker owns the wait, so this one just steps aside."""
        world = _happy(monkeypatch)
        world.answers[STATUS] = _status("ongoing", ts=NOW_MS - 3 * H)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.supabase.rpc_errors["defer_compute_job"] = _PgError(  # type: ignore[union-attr]
            "55006", "defer_compute_job: job preempted by watchdog reclaim"
        )
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert len(_defers(world)) == 1

    @pytest.mark.asyncio
    async def test_a_genuine_defer_failure_is_not_swallowed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A database outage on the defer is not "someone else owns it": it must surface so
        the dispatcher can classify it, not report a wait that was never recorded."""
        world = _happy(monkeypatch)
        world.answers[STATUS] = _status("ongoing", ts=NOW_MS - 3 * H)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.supabase.rpc_errors["defer_compute_job"] = RuntimeError("database unavailable")  # type: ignore[union-attr]
        with pytest.raises(RuntimeError, match="database unavailable"):
            await okx_archive_job.run_okx_archive_rebuild_job(_calibrate())


class TestBackstopDeadline:
    """F7 / WR-04. The 8 h give-up bound is computed from OKX's request ``ts``, whose meaning
    is unverified (RESEARCH marks it both "the apply time" and "the first-request time"). If
    OKX returns the time of the LATEST apply, every claim sees an age near zero, re-applies and
    defers, and the job parks in ``pending`` for ever without a word. Deferral does not use up
    an attempt, so nothing else ends it. The backstop does not depend on the venue: the job's
    own ``created_at`` plus 24 h, for every path that would defer."""

    @pytest.mark.asyncio
    async def test_a_request_whose_ts_never_ages_is_given_up_on_by_the_jobs_own_age(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        # OKX answers every apply with a brand-new ts (one minute old): the wait never ends.
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 60_000)
        job = _calibrate(created_at=_created_at(NOW_MS - 25 * H))

        outcome = await dispatch(job)

        result = _assert_stopped(world, outcome, "archive_give_up", detail="backstop age_h=25")
        assert _defers(world) == [], "no defer was recorded"
        assert result["stop_class"] == "archive_give_up"

    @pytest.mark.asyncio
    async def test_an_ongoing_request_on_an_old_job_is_given_up_on_too(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = _status("ongoing", ts=NOW_MS - 3 * H)

        outcome = await dispatch(_calibrate(created_at=_created_at(NOW_MS - 30 * H)))

        _assert_stopped(world, outcome, "archive_give_up", detail="backstop age_h=30")

    @pytest.mark.asyncio
    async def test_a_rate_limit_defer_has_the_same_backstop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A 429 that never lifts must not park the job for ever either."""
        world = _happy(monkeypatch)

        def _limited(_inst: Any, _params: dict[str, str]) -> Any:
            raise ccxt.RateLimitExceeded("okx 429")

        world.answers[APPLY] = _limited
        outcome = await dispatch(_calibrate(created_at=_created_at(NOW_MS - 26 * H)))

        _assert_stopped(world, outcome, "archive_give_up", detail="backstop age_h=26")
        assert _defers(world) == []

    @pytest.mark.parametrize(
        ("age_ms", "gives_up"),
        [(24 * H - 1000, False), (24 * H, True)],
        ids=["one-second-short", "exactly-twenty-four-hours"],
    )
    @pytest.mark.asyncio
    async def test_the_bound_is_twenty_four_hours(
        self, monkeypatch: pytest.MonkeyPatch, age_ms: int, gives_up: bool
    ) -> None:
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = _status("ongoing", ts=NOW_MS - 3 * H)

        outcome = await dispatch(_calibrate(created_at=_created_at(NOW_MS - age_ms)))

        if gives_up:
            _assert_stopped(world, outcome, "archive_give_up", detail="backstop age_h=24")
        else:
            assert outcome.outcome == DispatchOutcome.DEFERRED

    @pytest.mark.parametrize("created_at", [None, "", "not-a-timestamp", 12345])
    @pytest.mark.asyncio
    async def test_a_job_whose_age_cannot_be_read_is_not_allowed_to_wait(
        self, monkeypatch: pytest.MonkeyPatch, created_at: Any
    ) -> None:
        """A bound that cannot be evaluated must not become no bound at all."""
        world = _happy(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 60_000)

        outcome = await dispatch(_calibrate(created_at=created_at))

        _assert_stopped(world, outcome, "archive_give_up", detail="backstop age=unreadable")

    @pytest.mark.asyncio
    async def test_a_job_that_is_ready_to_ingest_is_never_stopped_by_its_age(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The backstop ends WAITING, not work: a file that is ready is read at any age."""
        world = _happy(monkeypatch)

        outcome = await dispatch(_calibrate(created_at=_created_at(NOW_MS - 100 * H)))

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.downloads == [_link("2026", "Q3")]


class TestPreflightSharesWait:
    """Plan 12's founder step reads a PREFLIGHT result and needs both quarters `finished`
    in it. OKX takes 2-3 h to generate a file, so a preflight that did not wait could only
    ever report `ongoing`, and the founder's unified-account question would never be
    answered. Preflight therefore goes through the SAME stateless step as calibrate and
    differs only after every quarter is `finished`: it records the host and stops."""

    QUARTERS = [{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]

    def _claim(self, monkeypatch: pytest.MonkeyPatch, q2: dict[str, Any], q3: dict[str, Any]) -> _World:
        world = _happy(monkeypatch)
        _use_clock(monkeypatch)
        world.answers[APPLY] = _apply_answer("false", ts=NOW_MS - 3 * H)
        world.answers[STATUS] = lambda _i, params: q2 if params["quarter"] == "Q2" else q3
        return world

    @pytest.mark.asyncio
    async def test_preflight_waits_until_both_quarters_are_finished_and_never_downloads(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ongoing = _status("ongoing", ts=NOW_MS - 3 * H)
        downloads: list[str] = []

        # Claim 1: both ongoing.
        w1 = self._claim(monkeypatch, ongoing, ongoing)
        o1 = await dispatch(_job({"quarters": self.QUARTERS}))
        assert o1.outcome == DispatchOutcome.DEFERRED
        assert _defers(w1)[0]["p_claim_token"] == "tok-1"
        assert "set_compute_job_progress" not in _rpc_names(w1), "no block may claim `finished`"
        downloads += w1.downloads

        # Claim 2 (fresh fakes, nothing carried over): Q2 finished, Q3 still ongoing.
        w2 = self._claim(
            monkeypatch, _finished("2026", "Q2", ts=NOW_MS - 3 * H), ongoing
        )
        o2 = await dispatch(_job({"quarters": self.QUARTERS}))
        assert o2.outcome == DispatchOutcome.DEFERRED
        assert _defers(w2)[0]["p_reason"] == "okx_archive_rebuild: waiting quarters_ready=1/2"
        assert "set_compute_job_progress" not in _rpc_names(w2)
        downloads += w2.downloads

        # Claim 3: both finished with a link -> ONE v1 block, DONE.
        w3 = self._claim(
            monkeypatch,
            _finished("2026", "Q2", ts=NOW_MS - 3 * H),
            _finished("2026", "Q3", ts=NOW_MS - 3 * H),
        )
        o3 = await dispatch(_job({"quarters": self.QUARTERS}))
        assert o3.outcome == DispatchOutcome.DONE
        result = w3.result()
        assert result["mode"] == "preflight" and result["stop_class"] is None
        assert [(q["year"], q["quarter"], q["state"]) for q in result["quarters"]] == [
            (2026, "Q2", "finished"), (2026, "Q3", "finished")]
        for q in result["quarters"]:
            assert q["href_scheme"] == "https" and q["href_host"] == "archive.example.test"
            assert all(q[k] is None for k in INGEST_KEYS), "preflight never ingests"
        assert result["census"] is None
        downloads += w3.downloads

        assert downloads == [], "preflight never calls the downloader, on any claim"
        for world in (w1, w2, w3):
            assert set(_rpc_names(world)) <= {"defer_compute_job", "set_compute_job_progress"}


# ---------------------------------------------------------------------------
# Plan 16 Task 3: ingest edges, a lost or expired link never yields a partial result
# ---------------------------------------------------------------------------

LINK_FULL = _link("2026", "Q3")
ALLOWED_WRITES = {"set_compute_job_progress", "defer_compute_job"}


def _assert_no_other_writes(world: _World) -> None:
    """The ingest may write NOTHING but the progress block and a defer: a lost link that
    left a half-applied rebuild behind is the failure this plan exists to prevent. The
    recording supabase fake has no insert/update/delete at all, so a table write would
    raise; this also pins that no other RPC (apply, mark_*, stamp) was called."""
    assert set(_rpc_names(world)) <= ALLOWED_WRITES, _rpc_names(world)
    assert all(table in ("api_keys", "strategies") for table, _ in world.supabase.reads)  # type: ignore[union-attr]


class TestLostOrExpiredLink:
    @pytest.mark.parametrize(
        "make_exc",
        [
            lambda: httpx.ConnectError(f"cannot reach {LINK_FULL}"),
            lambda: httpx.ReadTimeout(f"timed out fetching {LINK_FULL}"),
            lambda: TimeoutError(f"deadline for {LINK_FULL}"),
        ],
        ids=["connect-error", "read-timeout", "total-deadline"],
    )
    @pytest.mark.asyncio
    async def test_a_download_that_fails_after_finished_is_transient_with_no_partial_result(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
        make_exc: Callable[[], Exception],
    ) -> None:
        """T-LINK-1. OKX answered `finished` and then the download died. The job must come
        back later (transient FAILED, retried by the queue) and write nothing that a later
        reader could mistake for a finished quarter. The exceptions here deliberately carry
        the signed URL in their message, as httpx's do: it must not reach last_error, the
        result block or a log."""
        caplog.set_level(logging.DEBUG)
        world = _happy(monkeypatch)
        world.download_errors.append(make_exc())
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "transient"
        assert outcome.error_message == "okx_archive_rebuild: link_expired quarter=2026-Q3 cause=network"
        result = world.result()
        assert result["stop_class"] == "link_expired" and result["census"] is None
        assert result["quarters"][0]["row_count"] is None, "nothing was read, so nothing is claimed"
        _assert_no_other_writes(world)
        everything = json.dumps(world.supabase.rpcs, default=str) + caplog.text + repr(outcome)  # type: ignore[union-attr]
        for secret in LINK_SECRETS:
            assert secret not in everything, f"the link leaked: {secret!r}"

    @pytest.mark.asyncio
    async def test_a_403_triggers_one_fresh_status_read_and_one_retry_with_the_new_link(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """T-LINK-3. OKX links expire (about 5.5 h): a 403/410 means "ask again", and the
        retry must use the link from the FRESH read, not the dead one."""
        world = _happy(monkeypatch)
        world.answers[STATUS] = _sequence(_finished("2026", "Q3", "v1"), _finished("2026", "Q3", "v2"))
        world.download_errors.append(LinkExpired())
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.downloads == [_link("2026", "Q3", "v1"), _link("2026", "Q3", "v2")]
        assert world.instances[0].calls == [CONFIG, SUBTYPES, STATUS, STATUS], "exactly one fresh read"
        assert _applies(world) == 1, "the refresh is a read; it does not re-apply"
        assert world.result()["quarters"][0]["row_count"] == 22

    @pytest.mark.asyncio
    async def test_a_second_403_is_transient_link_expired_not_a_third_try(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _happy(monkeypatch)
        world.answers[STATUS] = _sequence(_finished("2026", "Q3", "v1"), _finished("2026", "Q3", "v2"))
        world.download_errors.extend([LinkExpired(), LinkExpired()])
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "transient"
        assert outcome.error_message == "okx_archive_rebuild: link_expired quarter=2026-Q3 cause=expired_twice"
        assert world.downloads == [_link("2026", "Q3", "v1"), _link("2026", "Q3", "v2")]
        assert world.instances[0].calls == [CONFIG, SUBTYPES, STATUS, STATUS]
        _assert_no_other_writes(world)

    @pytest.mark.asyncio
    async def test_a_403_whose_fresh_read_has_no_link_is_transient_link_expired(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If OKX no longer offers a link when asked again, there is nothing to retry with:
        come back later (the next claim re-applies and waits properly), never DONE."""
        world = _happy(monkeypatch)
        world.answers[STATUS] = _sequence(_finished("2026", "Q3", "v1"), _status("ongoing"))
        world.download_errors.append(LinkExpired())
        outcome = await dispatch(_calibrate())

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "transient"
        assert outcome.error_message == "okx_archive_rebuild: link_expired quarter=2026-Q3 cause=no_fresh_link"
        assert world.downloads == [_link("2026", "Q3", "v1")]

    @pytest.mark.asyncio
    async def test_after_a_lost_link_a_restarted_claim_gets_a_fresh_link_and_reuses_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """T-LINK-2 (variant). A claim dies on a lost link; the next one starts with fresh
        fakes, so the only way it can finish is by asking OKX again."""
        first = _happy(monkeypatch)
        first.answers[STATUS] = _sequence(_finished("2026", "Q3", "dead"), _finished("2026", "Q3", "dead2"))
        first.download_errors.extend([LinkExpired(), LinkExpired()])
        lost = await dispatch(_calibrate())
        assert lost.outcome == DispatchOutcome.FAILED

        second = _happy(monkeypatch)
        second.answers[STATUS] = _finished("2026", "Q3", "fresh")
        done = await dispatch(_calibrate())

        assert done.outcome == DispatchOutcome.DONE
        assert second.downloads == [_link("2026", "Q3", "fresh")], "no link from the lost claim"
        assert STATUS in second.instances[0].calls, "the new claim re-read OKX"
        assert second.result()["quarters"][0]["row_count"] == 22


class TestDownloadRefusals:
    @pytest.mark.asyncio
    async def test_the_real_downloader_refuses_a_host_not_on_the_allow_list(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The link is untrusted input. Here the REAL downloader runs with an allow-list the
        test empties itself (plan 13 populates the shipped one, so leaning on its being empty
        would break there). The refusal is permanent, the result names the host the link
        pointed at, and nothing of the path or query survives anywhere."""
        caplog.set_level(logging.DEBUG)
        world = _happy(monkeypatch)
        monkeypatch.setattr(okx_archive_job, "download_archive_csv", okx_archive_download.download_archive_csv)
        monkeypatch.setattr(okx_archive_download, "ARCHIVE_ALLOWED_HOSTS", frozenset())
        outcome = await dispatch(_calibrate())

        result = _assert_stopped(
            world, outcome, "download_refused", detail="quarter=2026-Q3 reason=host_not_allowed"
        )
        assert result["quarters"][0]["href_host"] == "archive.example.test"
        assert result["quarters"][0]["container"] is None
        assert world.downloads == [], "the fake downloader was bypassed"
        _assert_no_other_writes(world)
        everything = json.dumps(world.supabase.rpcs, default=str) + caplog.text + repr(outcome)  # type: ignore[union-attr]
        for secret in LINK_SECRETS:
            assert secret not in everything, f"the link leaked: {secret!r}"

    @pytest.mark.parametrize("reason", sorted(okx_archive_download.REFUSAL_REASONS))
    @pytest.mark.asyncio
    async def test_every_refusal_reason_is_a_permanent_download_refused(
        self, monkeypatch: pytest.MonkeyPatch, reason: str
    ) -> None:
        world = _happy(monkeypatch)
        world.download_errors.append(okx_archive_download.DownloadRefused(reason))
        outcome = await dispatch(_calibrate())

        _assert_stopped(world, outcome, "download_refused", detail=f"quarter=2026-Q3 reason={reason}")


def _q3_lines() -> list[str]:
    return (FIXTURES / "q3_like.csv").read_text().splitlines()


PARSE_CASES: list[tuple[str, Callable[[], bytes], str, str]] = [
    # (id, bytes served, expected stop class in the closed set, parser/classifier label)
    ("header-drift", lambda: (FIXTURES / "q3_like.csv").read_bytes().replace(b"billId", b"billID", 1),
     "header_drift", "header_drift"),
    ("wrong-quarter", lambda: (FIXTURES / "q2_like.csv").read_bytes(),
     "quarter_range_mismatch", "quarter_range_mismatch"),
    ("conflicting-duplicate",
     lambda: ("\n".join([*_q3_lines(), _q3_lines()[1].replace("10.50", "99.99")]) + "\n").encode(),
     "duplicate_bill_conflict", "duplicate_bill_conflict"),
    ("unparseable-amount", lambda: (FIXTURES / "q3_like.csv").read_bytes().replace(b"10.50", b"ten", 1),
     "unparseable_amount", "unparseable_amount"),
    ("undecodable", lambda: b"\xff\xfe\x00bad", "header_drift", "undecodable_file"),
    ("header-only", lambda: (_q3_lines()[0] + "\n").encode(), "quarter_range_mismatch", "empty_file"),
    ("missing-bill-id", lambda: ("\n".join([_q3_lines()[0], _q3_lines()[1].replace("700000001", "", 1)]) + "\n").encode(),
     "duplicate_bill_conflict", "missing_bill_id"),
    ("non-usd-nonzero", lambda: (FIXTURES / "q3_like.csv").read_bytes().replace(b"USDT,10.50", b"BTC,10.50", 1),
     "non_usd_ccy", "non_usd_ccy"),
    ("unknown-subtype-nonzero",
     lambda: (FIXTURES / "q3_like.csv").read_bytes().replace(b"SWAP,700000001,2,", b"SWAP,700000001,99999,", 1),
     "unknown_subtype_nonzero", "unknown_subtype_nonzero"),
]


#: The two classification stops whose result block carries the file's census (counts only):
#: the founder reads the per-currency / per-subType picture there to decide what to do.
#: Independent literals: each is `Q3_CENSUS` with the one row the case edits moved by hand
#: (`PARSE_CASES`: the first USDT row becomes BTC; the first `SWAP ... 2` row becomes 99999).
CENSUS_ON_STOP = {
    "non_usd_ccy": {
        **Q3_CENSUS,
        "by_ccy": {"BTC": 1, "USDC": 3, "USDT": 18},
    },
    "unknown_subtype_nonzero": {
        **Q3_CENSUS,
        "by_sub_type": {**Q3_CENSUS["by_sub_type"], "2": 5, "99999": 1},
    },
}


class TestIngestStops:
    @pytest.mark.parametrize(
        ("served", "stop_class", "label"),
        [pytest.param(b, c, lbl, id=i) for i, b, c, lbl in PARSE_CASES],
    )
    @pytest.mark.asyncio
    async def test_a_file_that_cannot_be_read_exactly_is_a_permanent_stop_with_its_class(
        self, monkeypatch: pytest.MonkeyPatch, served: Callable[[], bytes], stop_class: str, label: str
    ) -> None:
        """No archive checksum exists, so the parser's pins and the classification are the only
        authentication of the file (CONTEXT D-09/D-10): each must stop the job LOUD, with the
        result block written first, and never surface a figure. The size readings of the
        download that DID happen survive in the block, because calibration compares them
        with the caps."""
        world = _happy(monkeypatch)
        world.csv_override = served()
        outcome = await dispatch(_calibrate())

        result = _assert_stopped(world, outcome, stop_class, detail=f"quarter=2026-Q3 parse={label}"
                                 if label not in ("non_usd_ccy", "unknown_subtype_nonzero")
                                 else f"parse={label}")
        quarter = result["quarters"][0]
        assert quarter["container"] == "zip" and quarter["compressed_bytes"] == 1234
        assert quarter["decompressed_bytes"] == len(world.csv_override)
        if label in CENSUS_ON_STOP:
            # Plan 16 left this null; the founder cannot decide a currency or a subtype from
            # `parse=<label>` alone (carry-forward to plan 08, RESEARCH Section 1).
            assert result["census"] == CENSUS_ON_STOP[label]
        else:
            assert result["census"] is None
        for forbidden in ("10.50", "99.99", "700000001"):
            assert forbidden not in json.dumps(result) + (outcome.error_message or "")
        _assert_no_other_writes(world)

    def test_every_stop_the_parser_and_classifier_can_raise_maps_into_the_closed_set(self) -> None:
        """The contract's stop classes are closed, but plan 02's parser has stops of its own.
        This scans the two modules' raise sites, so a new parser stop with no mapping fails
        here instead of surfacing at runtime as a KeyError in the middle of a calibration."""
        import inspect
        import re

        from services import okx_archive_classify, okx_archive_files

        raised = set()
        for module in (okx_archive_files, okx_archive_classify):
            raised |= set(re.findall(r'ArchiveParseError\(\s*"([a-z_]+)"', inspect.getsource(module)))
        assert raised >= {"header_drift", "empty_file", "non_usd_ccy"}, "the scan found the raise sites"
        assert raised <= set(okx_archive_job._PARSE_STOP_CLASS), raised - set(okx_archive_job._PARSE_STOP_CLASS)
        assert set(okx_archive_job._PARSE_STOP_CLASS.values()) <= okx_archive_job.STOP_CLASSES

    def test_a_signed_link_never_appears_in_the_repr_of_a_value_that_carries_it(self) -> None:
        """The link rides in two small dataclasses for the length of a claim. A repr in a
        log line or an assertion message is the easiest way for it to escape."""
        reading = okx_archive_job._StatusReading(state="finished", href=LINK_FULL, ts_ms=1)
        step = okx_archive_job._QuarterStep(href=LINK_FULL)
        for secret in LINK_SECRETS:
            assert secret not in repr(reading) + repr(step)


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
    "longest_billless_run",
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
    async def test_a_calibrate_result_carries_the_ingest_readings_with_the_pinned_types(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Plan 14's founder step compares these readings with the download caps and reads
        the census; the types are part of that contract."""
        world = _happy(monkeypatch)

        async def _no_sleep(_s: float) -> None:
            return None

        monkeypatch.setattr(okx_archive_job, "_sleep", _no_sleep)
        await dispatch(_calibrate({"quarters": [
            {"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]}))
        result = world.result()

        assert set(result) == TOP_LEVEL_KEYS and result["mode"] == "calibrate"
        for q in result["quarters"]:
            assert set(q) == QUARTER_KEYS
            assert q["container"] in ("zip", "gzip")
            assert isinstance(q["compressed_bytes"], int) and not isinstance(q["compressed_bytes"], bool)
            assert isinstance(q["decompressed_bytes"], int) and not isinstance(q["decompressed_bytes"], bool)
            assert isinstance(q["has_type_column"], bool)
            assert isinstance(q["ts_min_day"], str) and isinstance(q["ts_max_day"], str)
            assert isinstance(q["row_count"], int) and not isinstance(q["row_count"], bool)
        census = result["census"]
        assert set(census) == {"by_ccy", "by_inst_type", "by_sub_type", "unknown_zero_effect"}
        for key in ("by_ccy", "by_inst_type", "by_sub_type"):
            assert all(isinstance(k, str) and isinstance(v, int) for k, v in census[key].items()), key
        assert isinstance(census["unknown_zero_effect"], int)
        assert "(blank)" in census["by_inst_type"], "the aggregator's own empty-cell label passes through"
        json.dumps(result)

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
            "container_unknown", "archive_incomplete", "header_drift", "quarter_range_mismatch",
            "duplicate_bill_conflict", "unparseable_amount", "unknown_subtype_nonzero",
            "non_usd_ccy", "live_anchor_unusable", "live_fetch_failed", "claim_budget_exceeded",
            "identity_violation", "reconcile_miss",
            "d03_zero_day_has_archive_pnl", "fingerprint_missing", "fingerprint_mismatch",
            "nothing_to_apply", "rpc_refused",
        }
        assert okx_archive_job.TRANSIENT_STOP_CLASSES == {
            "link_expired", "live_fetch_failed", "claim_budget_exceeded"
        }

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
