"""A Bybit-faithful double for the funding-evidence GETs (Phase 180 BYBITFUNDING).

A helper module, never collected as tests (no ``test_`` functions), in the voice of
``tests/_trade_pages.py``: it answers the way Bybit v5 does, so a reader that mis-windows, mis-pages
or mis-reads a status sees fewer rows than the book holds and a test notices.

Vendor rules mirrored (Bybit v5 docs, read 2026-10-28):

- the record endpoints (on-chain deposits, internal deposits, withdrawals) refuse a request whose
  ``endTime - startTime`` is not LESS than 30 days; the two transfer lists refuse a span of more
  than 7 days (``ccxt.BadRequest`` either way);
- rows come NEWEST FIRST, at most ``min(limit, 50)`` a page, paged by an opaque cursor
  (``nextPageCursor``, empty on the last page), under ``result.<rows key>``;
- ``startTime`` and ``endTime`` arrive as strings; a row is answered when its stamp lies in
  ``[startTime, endTime]``.

This module hard-codes the endpoint facts on purpose (method, rows key, id and time field) instead
of importing them from the code under test: a wrong field name there must show up as an empty read.
Fixture ids start ``fake-transfer-`` (and universal rows carry member ids that start
``fake-member-``) so a leak assertion has something to look for.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import ccxt.async_support as ccxt

DAY_MS = 24 * 60 * 60 * 1000
PAGE_CAP = 50

# name -> (raw method, rows key, id field, time field, max span in ms, span is strict)
_ENDPOINTS: dict[str, tuple[str, str, str, str, int, bool]] = {
    "onchain_dep": ("private_get_v5_asset_deposit_query_record", "rows", "id", "successAt", 30 * DAY_MS, True),
    "internal_dep": (
        "private_get_v5_asset_deposit_query_internal_record", "rows", "id", "createdTime", 30 * DAY_MS, True,
    ),
    "withdraw_all": (
        "private_get_v5_asset_withdraw_query_record", "rows", "withdrawId", "createTime", 30 * DAY_MS, True,
    ),
    "inter_xfer": (
        "private_get_v5_asset_transfer_query_inter_transfer_list", "list", "transferId", "timestamp", 7 * DAY_MS, False,
    ),
    "universal_xfer": (
        "private_get_v5_asset_transfer_query_universal_transfer_list", "list", "transferId", "timestamp", 7 * DAY_MS, False,
    ),
}

QUERY_API = "private_get_v5_user_query_api"
TRANSACTION_LOG = "private_get_v5_account_transaction_log"

#: Every raw method this double answers: the five asset GETs, the key-info GET and the Unified
#: transaction log.
METHODS: tuple[str, ...] = (*(entry[0] for entry in _ENDPOINTS.values()), QUERY_API, TRANSACTION_LOG)

#: What an ``effects`` entry may be: ``None`` (answer normally), an exception instance (raised),
#: ``"malformed"`` (a non-dict answer), ``"repeat"`` (rows as normal, but the cursor it answers is
#: the one it was sent, or a fixed one when none was sent: a cursor that never advances) or
#: ``"hang"`` (never answers). The transaction log also takes ``"wrong_type"`` (a row of another
#: type rides along with the page, as if the venue ignored the ``type`` filter).
Effect = Any


class EvidenceBook:
    """Rows per raw method, the vendor rules over them, and a log of every call."""

    def __init__(self) -> None:
        self._entries: dict[str, list[tuple[int, dict[str, Any]]]] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.effects: dict[str, list[Effect]] = {}
        # The ``result`` of ``/v5/user/query-api``. It carries the key's own UID and its parent's,
        # so a redaction test has something to look for. Replace it to change what the key is.
        self.key_info: Any = {
            "isMaster": True,
            "uta": 1,
            "userID": "fake-userid-777",
            "parentUid": "fake-parentuid-888",
        }

    def add(
        self,
        name: str,
        stamp_ms: int,
        status: str,
        rid: str | None = None,
        **extra: Any,
    ) -> dict[str, Any]:
        """Add one row to endpoint ``name``: its id field, its time field (a string of digits, as
        Bybit sends it) and its status, plus any ``extra`` field."""
        method, _rows_key, id_field, time_field, _span, _strict = _ENDPOINTS[name]
        row: dict[str, Any] = {time_field: str(stamp_ms), "status": status, **extra}
        if name == "universal_xfer":
            row = {"fromMemberId": "fake-member-from", "toMemberId": "fake-member-to", **row}
        if rid is not None:
            row[id_field] = rid
        self._entries.setdefault(method, []).append((stamp_ms, row))
        return row

    def add_log(self, log_type: str, stamp_ms: int, rid: str | None = None, **extra: Any) -> dict[str, Any]:
        """Add one row of ``log_type`` to the Unified transaction log: its ``type``, its
        ``transactionTime`` (a string of digits, as Bybit sends it) and, when given, its ``id``."""
        row: dict[str, Any] = {"type": log_type, "transactionTime": str(stamp_ms), **extra}
        if rid is not None:
            row["id"] = rid
        self._entries.setdefault(TRANSACTION_LOG, []).append((stamp_ms, row))
        return row

    def calls_to(self, name: str) -> list[dict[str, Any]]:
        """The params of every call endpoint ``name`` received, in order. ``"transaction_log"``
        names the Unified transaction log."""
        method = TRANSACTION_LOG if name == "transaction_log" else _ENDPOINTS[name][0]
        return [params for called, params in self.calls if called == method]

    def _answer(
        self, method: str, rows_key: str, max_span: int, strict: bool
    ) -> Callable[[dict[str, Any]], Awaitable[Any]]:
        async def _get(params: dict[str, Any]) -> Any:
            self.calls.append((method, dict(params)))
            queue = self.effects.get(method, [])
            effect = queue.pop(0) if queue else None
            if isinstance(effect, BaseException):
                raise effect
            if effect == "hang":
                await asyncio.Event().wait()
            if effect == "malformed":
                return "not-a-dict"
            start, end = int(params["startTime"]), int(params["endTime"])
            span = end - start
            if (span >= max_span) if strict else (span > max_span):
                raise ccxt.BadRequest("fake bybit: the time span is over the endpoint's limit")
            is_log = method == TRANSACTION_LOG
            if is_log and params.get("accountType") != "UNIFIED":
                raise ccxt.BadRequest("fake bybit: the transaction log was not asked for the Unified account")
            inside = sorted(
                (
                    entry
                    for entry in self._entries.get(method, [])
                    if start <= entry[0] <= end and (not is_log or entry[1]["type"] == params.get("type"))
                ),
                key=lambda entry: entry[0],
                reverse=True,
            )
            size = min(int(params.get("limit", "20")), PAGE_CAP)
            sent = str(params.get("cursor") or "")
            offset = int(sent[1:]) if sent[1:].isdigit() else 0
            chunk = [dict(row) for _stamp, row in inside[offset : offset + size]]
            more = offset + size < len(inside)
            cursor = f"c{offset + size}" if more else ""
            if effect == "repeat":
                cursor = sent or "c-stuck"
            if effect == "wrong_type":
                chunk = [{"type": "TRADE", "transactionTime": str(end), "id": "fake-transfer-wrong-type"}, *chunk]
            return {"retCode": 0, "result": {rows_key: chunk, "nextPageCursor": cursor}}

        return _get

    async def _query_api(self, params: dict[str, Any] | None = None) -> Any:
        self.calls.append((QUERY_API, dict(params or {})))
        queue = self.effects.get(QUERY_API, [])
        effect = queue.pop(0) if queue else None
        if isinstance(effect, BaseException):
            raise effect
        if effect == "hang":
            await asyncio.Event().wait()
        if effect == "malformed":
            return "not-a-dict"
        return {"retCode": 0, "result": self.key_info}

    def attach(self, client: Any) -> None:
        """Set this book's raw GET methods on ``client``, the Unified transaction log included."""
        setattr(client, QUERY_API, self._query_api)
        for method, rows_key, _id_field, _time_field, max_span, strict in _ENDPOINTS.values():
            setattr(client, method, self._answer(method, rows_key, max_span, strict))
        setattr(client, TRANSACTION_LOG, self._answer(TRANSACTION_LOG, "list", 7 * DAY_MS, False))
