"""Test doubles for the cross-process MT5 terminal lease (Phase 230, MT5D-02).

Two backends, one seam (``services.mt5_xlease.set_xlease_backend_for_tests``):

* ``GrantingXLeaseBackend`` is the SUITE DEFAULT (installed by an autouse fixture in
  ``tests/conftest.py``). It answers True to everything and records the calls, so the
  roughly 17 modules that drive the real ``mt5_terminal_lease`` keep their behaviour
  and no unit test reaches a real project through the lease.
* ``FakeXLeaseBackend`` implements the SQL semantics of plan 01's three RPCs over one
  dict, with an injectable clock, so a test can put two "processes" (two in-process
  lock registries) over ONE shared database and watch them contend.

The semantics, exactly as plan 01 declares them: a terminal is free when its owner
token is NULL or expired on the database clock; a same-token acquire is idempotent
(and extends the expiry); release clears the token; renew matches the token
regardless of expiry and answers False for a foreign or cleared token.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


class GrantingXLeaseBackend:
    """Answers True to every call and records them. The suite default."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def acquire(
        self, digest: str, token: uuid.UUID, holder: str, site: str, ttl_s: int
    ) -> bool:
        self.calls.append(("acquire", (digest, token, holder, site, ttl_s)))
        return True

    async def renew(self, digest: str, token: uuid.UUID, ttl_s: int) -> bool:
        self.calls.append(("renew", (digest, token, ttl_s)))
        return True

    async def release(self, digest: str, token: uuid.UUID) -> bool:
        self.calls.append(("release", (digest, token)))
        return True


@dataclass
class _Row:
    owner_token: uuid.UUID | None
    expires_at: float
    holder: str
    site: str


class FakeXLeaseBackend:
    """The lease table and its three RPCs, in memory."""

    def __init__(self, now: Callable[[], float] = time.monotonic) -> None:
        self.now = now
        self.rows: dict[str, _Row] = {}
        self.calls: list[tuple[str, str, uuid.UUID]] = []
        #: Per-method awaitable run before the call touches the row (a delay or a
        #: gate); a test sets it to simulate a slow RPC.
        self.before: dict[str, Callable[[], Any]] = {}
        #: Per-method exception raised instead of answering.
        self.raises: dict[str, BaseException] = {}
        #: Acquire calls answered False, the count the wait event is built on.
        self.refusals = 0

    async def _gate(self, method: str) -> None:
        hook = self.before.get(method)
        if hook is not None:
            await hook()
        exc = self.raises.get(method)
        if exc is not None:
            raise exc

    def _free(self, row: _Row | None) -> bool:
        return row is None or row.owner_token is None or row.expires_at <= self.now()

    async def acquire(
        self, digest: str, token: uuid.UUID, holder: str, site: str, ttl_s: int
    ) -> bool:
        self.calls.append(("acquire", digest, token))
        await self._gate("acquire")
        row = self.rows.get(digest)
        if self._free(row) or (row is not None and row.owner_token == token):
            self.rows[digest] = _Row(token, self.now() + ttl_s, holder, site)
            return True
        self.refusals += 1
        return False

    async def renew(self, digest: str, token: uuid.UUID, ttl_s: int) -> bool:
        self.calls.append(("renew", digest, token))
        await self._gate("renew")
        row = self.rows.get(digest)
        if row is not None and row.owner_token == token:
            row.expires_at = self.now() + ttl_s
            return True
        return False

    async def release(self, digest: str, token: uuid.UUID) -> bool:
        self.calls.append(("release", digest, token))
        await self._gate("release")
        row = self.rows.get(digest)
        if row is not None and row.owner_token == token:
            row.owner_token = None
            row.expires_at = self.now()
            return True
        return False

    def holds(self, digest: str) -> bool:
        """True while some token holds the terminal (not free)."""
        return not self._free(self.rows.get(digest))

    def count(self, method: str) -> int:
        return sum(1 for call in self.calls if call[0] == method)


async def sleep_forever() -> None:
    """A ``before`` hook that never lets the call proceed (until cancelled)."""
    await asyncio.Event().wait()
