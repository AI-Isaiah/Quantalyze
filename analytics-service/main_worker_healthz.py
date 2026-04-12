"""Healthz server for the worker process.

Binds to PORT env var (default 8080). Returns 200 with JSON
`{"status": "ok", "last_tick_at": <float>}` if the worker's last dispatch
tick was within 90 seconds. Returns 503 if the last tick was longer ago
(or never happened).

Uses stdlib only — no aiohttp, no FastAPI. Raw asyncio.start_server +
manual HTTP response.

Module-level LAST_TICK_AT is written by dispatch_tick in main_worker.py
after every successful claim batch.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

logger = logging.getLogger("quantalyze.analytics.healthz")

# Written by main_worker.dispatch_tick after every tick
LAST_TICK_AT: float = 0.0

# Tick age threshold (seconds) beyond which healthz returns 503
STALE_THRESHOLD = 90.0


async def _handle_healthz(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Handle a single HTTP request with a bare-bones HTTP/1.1 response."""
    try:
        # Read the request line (we don't need the headers but must consume
        # the read so the TCP buffer doesn't jam).
        try:
            await asyncio.wait_for(reader.readline(), timeout=5.0)
        except asyncio.TimeoutError:
            writer.close()
            return

        # Drain remaining headers
        while True:
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=2.0)
            except asyncio.TimeoutError:
                break
            if line in (b"\r\n", b"\n", b""):
                break

        now = time.time()
        age = now - LAST_TICK_AT if LAST_TICK_AT > 0 else float("inf")
        healthy = age <= STALE_THRESHOLD

        body_data = {
            "status": "ok" if healthy else "stale",
            "last_tick_at": LAST_TICK_AT if LAST_TICK_AT > 0 else None,
            "age_seconds": round(age, 1) if LAST_TICK_AT > 0 else None,
        }
        body = json.dumps(body_data).encode()

        status_line = "200 OK" if healthy else "503 Service Unavailable"
        response = (
            f"HTTP/1.1 {status_line}\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            f"Connection: close\r\n"
            f"\r\n"
        ).encode() + body

        writer.write(response)
        await writer.drain()
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz handler error: %s", exc)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass


async def start_healthz_server() -> None:
    """Start the healthz TCP server. Blocks forever (or until the event
    loop shuts down). Imported by main_worker.main() and passed to
    asyncio.gather."""
    port = int(os.getenv("PORT", "8080"))
    server = await asyncio.start_server(_handle_healthz, "0.0.0.0", port)
    logger.info("Healthz server listening on port %d", port)

    async with server:
        await server.serve_forever()
