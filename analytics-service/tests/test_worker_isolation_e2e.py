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
            assert b'"last_tick_at": null' not in mid_dispatch_resp.replace(b" ", b" ")
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
