"""End-to-end WORKER-02 proof: the v1.12-landed worker hardening keeps the
worker LIVE and healthz HONEST when composed together — not just unit-by-unit.

Root cause this regression-proofs (v1.11 FLIP rollback): the derived-allocator
backfill enqueue wedged the SEQUENTIAL prod worker — one slow/hanging live
exchange crawl blocked the shared event loop, healthz went stale for ~12
minutes, and the 90s auto-restart never fired. The v1.12 groundwork added the
per-crawl ``asyncio.wait_for`` bound + the mid-dispatch ``LAST_TICK_AT``
heartbeat. The existing ``test_main_worker.py`` heartbeat tests MOCK dispatch
and NEVER bind the real healthz TCP server; this file closes exactly that gap
(125-RESEARCH Pattern 2) by composing the REAL pieces:

  * the REAL ``main_worker_healthz.start_healthz_server`` bound on an ephemeral
    port and probed over an actual TCP socket (200 mid-backfill, 503 when stale);
  * the REAL ``main_worker.dispatch_tick`` with its internal heartbeat task;
  * a genuinely-unbounded crawl that ends ONLY via the REAL production
    ``asyncio.wait_for`` / ``_BROKER_CRAWL_TIMEOUT_S`` bound in
    ``services.job_worker`` — the transient classification is produced BY
    production code, the test only ASSERTS the returned DispatchResult
    (P115 self-referential-oracle anti-pattern avoided);
  * a proof the backfill and interactive claim payloads are provably disjoint.

NO production file is modified by this plan — main_worker.py,
main_worker_healthz.py, and services/job_worker.py are read-only here
(re-implementing the landed groundwork is the phase's named failure mode).
"""

import asyncio
import socket
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import main_worker
import main_worker_healthz
import services.deribit_ingest as deribit_ingest
import services.job_worker as job_worker
from main_worker import dispatch_tick
from services.job_worker import DispatchOutcome, DispatchResult


# ---------------------------------------------------------------------------
# TCP probe helpers — no HTTP client dependency, raw asyncio sockets only.
# ---------------------------------------------------------------------------

def _free_ephemeral_port() -> int:
    """Bind a throwaway socket to port 0, read the OS-assigned port, release it.

    The healthz server re-binds this port microseconds later. A tiny TOCTOU
    window exists in theory, but on a loopback test host it is not observed.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])
    finally:
        s.close()


async def _wait_port_listening(port: int, timeout: float = 5.0) -> None:
    """Poll-connect until the healthz server task has reached serve_forever."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
            return
        except (ConnectionRefusedError, OSError):
            await asyncio.sleep(0.01)
    raise AssertionError(f"healthz server never started listening on {port}")


async def _probe_healthz(port: int) -> bytes:
    """Issue a raw HTTP/1.1 GET /healthz over TCP and return the response bytes.

    The outer 5s guard on the response read is a test-body safety net (a genuine
    server hang fails fast instead of hanging CI) — it never wraps a crawl.
    """
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(
        b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
    )
    await writer.drain()
    try:
        data = await asyncio.wait_for(reader.read(-1), timeout=5.0)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
    return data


def _empty_claim_supabase() -> MagicMock:
    mock_supabase = MagicMock()
    chain = MagicMock()
    chain.execute.return_value = MagicMock(data=[])
    mock_supabase.rpc.return_value = chain
    return mock_supabase


# ===========================================================================
# Case B — long-but-alive backfill keeps the REAL healthz TCP server on 200
# ===========================================================================
class TestHealthzTcpServerHonesty:
    """The heartbeat + real healthz TCP server, composed. A long-but-alive
    dispatch answers 200 over a real socket (heartbeat honest); a forced-stale
    tick answers 503 (staleness contract real, not a stub)."""

    @pytest.mark.asyncio
    async def test_healthz_stays_200_through_long_backfill(self, monkeypatch) -> None:
        """With the heartbeat interval shrunk and the REAL start_healthz_server
        bound on an ephemeral port, a yielding dispatch that outlives several
        heartbeat intervals still answers "200 OK" to a MID-dispatch TCP probe,
        and LAST_TICK_AT advances past the dispatch-start stamp (mid-dispatch
        liveness — the analog's oracle, now over a real socket)."""
        monkeypatch.setattr(main_worker, "_HEARTBEAT_INTERVAL_S", 0.02)

        port = _free_ephemeral_port()
        monkeypatch.setenv("PORT", str(port))

        jobs = [{"id": "job-slow", "kind": "derive_broker_dailies", "strategy_id": "s-slow"}]
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=jobs)
        mock_supabase.rpc.return_value = chain

        started = asyncio.Event()

        async def _slow_dispatch(job):
            # ~15 heartbeat intervals, all yielding (loop stays alive).
            started.set()
            await asyncio.sleep(0.3)
            return DispatchResult(outcome=DispatchOutcome.DONE)

        _saved_tick = main_worker_healthz.LAST_TICK_AT
        server_task = asyncio.create_task(main_worker_healthz.start_healthz_server())
        try:
            await _wait_port_listening(port)

            with patch("main_worker.get_supabase", return_value=mock_supabase), \
                 patch("main_worker.dispatch", new=_slow_dispatch):
                dt = asyncio.create_task(dispatch_tick("worker-hz-alive"))
                await started.wait()
                start_stamp = main_worker_healthz.LAST_TICK_AT
                # Let a couple of heartbeats fire, then probe MID-dispatch.
                await asyncio.sleep(0.05)
                mid_dispatch_resp = await _probe_healthz(port)
                assert not dt.done(), (
                    "probe must be captured WHILE the slow dispatch is in flight"
                )
                await dt

            # 200 captured while the long backfill was still running.
            assert b"200 OK" in mid_dispatch_resp, mid_dispatch_resp[:120]
            assert b'"last_tick_at":' in mid_dispatch_resp
            # Spacing-robust: strip ALL spaces, then assert the null form is absent
            # regardless of the JSON serializer's colon spacing.
            assert b'"last_tick_at":null' not in mid_dispatch_resp.replace(b" ", b"")
            # The heartbeat advanced LAST_TICK_AT during the 0.3s dispatch.
            assert main_worker_healthz.LAST_TICK_AT > start_stamp, (
                "the heartbeat must refresh LAST_TICK_AT during a long backfill; "
                "otherwise a legit >90s crawl false-stales healthz."
            )
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass
            main_worker_healthz.LAST_TICK_AT = _saved_tick

    @pytest.mark.asyncio
    async def test_healthz_503_when_tick_stale(self, monkeypatch) -> None:
        """With LAST_TICK_AT forced past STALE_THRESHOLD and NO dispatch running,
        the same real-socket probe returns "503 Service Unavailable" — proving
        the probe exercises the staleness contract against the deployed server
        code, not a stub that always answers 200."""
        port = _free_ephemeral_port()
        monkeypatch.setenv("PORT", str(port))

        _saved_tick = main_worker_healthz.LAST_TICK_AT
        server_task = asyncio.create_task(main_worker_healthz.start_healthz_server())
        try:
            await _wait_port_listening(port)
            main_worker_healthz.LAST_TICK_AT = time.time() - (
                main_worker_healthz.STALE_THRESHOLD + 10
            )
            resp = await _probe_healthz(port)
            assert b"503 Service Unavailable" in resp, resp[:120]
            assert b'"status": "stale"' in resp
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass
            main_worker_healthz.LAST_TICK_AT = _saved_tick


# ===========================================================================
# Case A — hung crawl times out to transient end-to-end + role disjointness
# ===========================================================================
class TestHungCrawlAndRoleIsolation:
    """A genuinely-unbounded crawl ends ONLY via the REAL production wait_for
    bound and is classified transient BY production code; the worker loop
    survives; and the backfill/interactive claim payloads are provably
    disjoint."""

    @pytest.mark.asyncio
    async def test_hung_crawl_times_out_worker_stays_live(self, monkeypatch) -> None:
        """Drive a derive_broker_dailies job through the REAL production dispatch
        path (services.job_worker.dispatch -> run_derive_broker_dailies_job) with
        the deribit cash-pass crawl patched to a NEVER-completing awaitable. The
        PRODUCTION code runs the wait_for at job_worker.py:2386, hits its
        `except asyncio.TimeoutError` arm (:2623), and returns a
        transient-classified DispatchResult (:2649). The test ONLY asserts the
        returned value — it never computes the classification itself
        (P115 self-referential-oracle anti-pattern).

        SEAM NOTE (empirically verified 2026-07-19): the plan named
        fetch_deribit_native_account_state as the transient seam, but that anchor
        read raises a Deribit transient-read RuntimeError which the outer
        dispatch classifier maps to error kind 'unknown' (still retryable, but
        NOT 'transient'). The seam that genuinely classifies 'transient' is the
        cash-pass crawl build_deribit_native_ledger, which has a dedicated
        `except asyncio.TimeoutError` arm. fetch_deribit_native_account_state is
        still patched here — to a VALID anchor — so execution reaches the cash
        pass; the HUNG crawl is build_deribit_native_ledger.
        """
        # Shrink the REAL module constant so the REAL bound fires fast — never a
        # new bound introduced by the test.
        monkeypatch.setattr(job_worker, "_BROKER_CRAWL_TIMEOUT_S", 0.05)

        # A valid anchor so run_derive_broker_dailies_job reaches the cash pass.
        account_state = SimpleNamespace(
            balance_error=False,
            native_equity={"BTC": 1.0},
            collapsed_equity_usd=50000.0,
            collapsed_upnl_usd=0.0,
            upnl_unreadable=False,
        )

        async def _anchor_ok(*_a, **_k):
            return account_state

        monkeypatch.setattr(
            deribit_ingest, "fetch_deribit_native_account_state", _anchor_ok
        )

        # The hung crawl: an Event that is NEVER set. If the production wait_for
        # bound were removed, this awaitable would hang forever and the outer 5s
        # test-body guard would fail fast (regression-first: the test cannot pass
        # without the v1.12 wait_for groundwork).
        never_completes = asyncio.Event()

        async def _hung_cash_pass(*_a, **_k):
            await never_completes.wait()

        monkeypatch.setattr(
            deribit_ingest, "build_deribit_native_ledger", _hung_cash_pass
        )

        fake_ctx = SimpleNamespace(
            supabase=MagicMock(),
            strategy_row={},
            key_row={"exchange": "deribit", "id": "k-1", "user_id": "u-1"},
            exchange=MagicMock(),
        )

        async def _fake_preflight(job, handler_name):
            return fake_ctx

        monkeypatch.setattr(job_worker, "_exchange_preflight", _fake_preflight)

        _saved_tick = main_worker_healthz.LAST_TICK_AT
        try:
            job = {
                "id": "job-hung",
                "kind": "derive_broker_dailies",
                "strategy_id": "s-hung",
            }
            # Outer 5s guard: a genuine regression (bound removed) fails fast
            # rather than hanging CI. It does NOT wrap the crawl with a
            # classification timeout — production owns that.
            result = await asyncio.wait_for(job_worker.dispatch(job), timeout=5.0)

            # ASSERT ONLY the returned DispatchResult — the oracle is the real
            # production seam, never a test-side re-typing of it.
            observed_outcome = result.outcome
            observed_kind = result.error_kind
            assert observed_outcome == DispatchOutcome.FAILED, (
                f"a bounded hung crawl must FAIL (retryable), got {observed_outcome}"
            )
            assert observed_kind == "transient", (
                "the production cash-pass wait_for bound must classify the hang "
                f"transient (retryable); got {observed_kind!r}"
            )

            # Worker-stays-live oracle (genuinely e2e): after the timeout, a real
            # dispatch_tick still runs and advances LAST_TICK_AT — the loop
            # survived the hang, never a crash, never a wedge.
            monkeypatch.setattr(main_worker, "_HEARTBEAT_INTERVAL_S", 0.02)
            survive_jobs = [
                {"id": "job-ok", "kind": "sync_trades", "strategy_id": "s-ok"}
            ]
            survive_supabase = MagicMock()
            survive_chain = MagicMock()
            survive_chain.execute.return_value = MagicMock(data=survive_jobs)
            survive_supabase.rpc.return_value = survive_chain

            main_worker_healthz.LAST_TICK_AT = 0.0
            before = main_worker_healthz.LAST_TICK_AT
            with patch("main_worker.get_supabase", return_value=survive_supabase), \
                 patch(
                     "main_worker.dispatch",
                     new=AsyncMock(
                         return_value=DispatchResult(outcome=DispatchOutcome.DONE)
                     ),
                 ):
                await dispatch_tick("worker-post-hang")
            after = main_worker_healthz.LAST_TICK_AT
            assert after > before, (
                "after a bounded hung crawl the worker loop must keep ticking; "
                "LAST_TICK_AT must advance on the next dispatch_tick."
            )
        finally:
            # Release the hung awaitable so no orphan task lingers, then restore.
            never_completes.set()
            main_worker_healthz.LAST_TICK_AT = _saved_tick

    @staticmethod
    def _claim_params(mock_supabase: MagicMock) -> dict:
        for c in mock_supabase.rpc.call_args_list:
            if c.args[0] == "claim_compute_jobs_with_priority":
                return c.args[1]
        raise AssertionError("no claim_compute_jobs_with_priority RPC call recorded")

    @pytest.mark.asyncio
    async def test_roles_never_contend(self) -> None:
        """The backfill and interactive workers structurally cannot claim the
        same kinds: role 'backfill' sends p_kind_include == BACKFILL_KINDS (and
        NO exclude); role 'interactive' sends p_kind_exclude == BACKFILL_KINDS
        (and NO include). Driven through dispatch_tick's real claim seam (the
        wiring), not just _claim_kind_args (the helper)."""
        # Direct-helper leg (fast structural pin).
        assert main_worker._claim_kind_args("backfill") == {
            "p_kind_include": list(main_worker.BACKFILL_KINDS)
        }
        assert main_worker._claim_kind_args("interactive") == {
            "p_kind_exclude": list(main_worker.BACKFILL_KINDS)
        }

        # Wiring leg: prove dispatch_tick actually puts those keys on the RPC.
        _saved_latch = (
            main_worker._FALLBACK_CLAIM_RPC,
            main_worker._FALLBACK_LATCHED_AT,
        )
        _saved_tick = main_worker_healthz.LAST_TICK_AT
        main_worker._FALLBACK_CLAIM_RPC = False
        main_worker._FALLBACK_LATCHED_AT = 0.0
        try:
            backfill_supabase = _empty_claim_supabase()
            with patch("main_worker.WORKER_CLAIM_ROLE", "backfill"), \
                 patch("main_worker.get_supabase", return_value=backfill_supabase), \
                 patch("main_worker.dispatch", new=AsyncMock()):
                await dispatch_tick("worker-role-backfill")
            backfill_params = self._claim_params(backfill_supabase)

            interactive_supabase = _empty_claim_supabase()
            with patch("main_worker.WORKER_CLAIM_ROLE", "interactive"), \
                 patch("main_worker.get_supabase", return_value=interactive_supabase), \
                 patch("main_worker.dispatch", new=AsyncMock()):
                await dispatch_tick("worker-role-interactive")
            interactive_params = self._claim_params(interactive_supabase)
        finally:
            (
                main_worker._FALLBACK_CLAIM_RPC,
                main_worker._FALLBACK_LATCHED_AT,
            ) = _saved_latch
            main_worker_healthz.LAST_TICK_AT = _saved_tick

        backfill_kinds = list(main_worker.BACKFILL_KINDS)
        assert backfill_params.get("p_kind_include") == backfill_kinds
        assert "p_kind_exclude" not in backfill_params
        assert interactive_params.get("p_kind_exclude") == backfill_kinds
        assert "p_kind_include" not in interactive_params

        # Disjointness: every kind the backfill worker INCLUDES is exactly a kind
        # the interactive worker EXCLUDES. Backfill claims ONLY `included`;
        # interactive claims everything EXCEPT `excluded == included` → their
        # claim scopes are provably disjoint (the two workers never contend).
        included = set(backfill_params["p_kind_include"])
        excluded = set(interactive_params["p_kind_exclude"])
        assert included == excluded, (
            "backfill-included kinds must be exactly the interactive-excluded kinds"
        )
        for kind in included:
            assert kind in excluded, (
                f"{kind!r} is claimed by backfill but not excluded by interactive "
                "— the roles could contend"
            )
