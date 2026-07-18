"""SFOX-02 read pull: a thin worker-side orchestration that reads an sFOX
account's balances + trades + transactions through the Phase-118 read-only
`SfoxClient`.

Read-only is STRUCTURAL, not probed (CONTEXT A1 / SFOX-02): `SfoxClient` is a
GET-only adapter with no order/withdraw/transfer surface (118 WR-03), and this
module composes ONLY its three GET read methods. The isinstance guard below
asserts read-only AT THE INGESTION BOUNDARY — a future caller cannot smuggle a
write-capable object (e.g. a ccxt exchange with create_order) through here. This
is NOT a claim that the key's scope was probed read-only (sFOX exposes no
per-key scope endpoint); it is the honest structural guarantee that this code
path can only read.

Scope (Q3 / phase split): this is the READ PULL ONLY. Single-page reads — the
cursors are surfaced by SfoxClient but NOT crawled here; crawl orchestration
with asyncio.wait_for bounds is PHASE 120 (FLIPRETRY-01). No daily-return
reconstruction, no normalization, no DB writes, no ingestion _FACTORIES /
SUPPORTED_SOURCES registration — all phase 120.

Fail-loud (T-119-13 / no invented data): any leg raising SfoxApiError propagates
UNTOUCHED; there is no retry, no backoff, no silent catch, and no partial dict.
An empty account (all legs empty) returns honest empties, never a fabricated
row. The caller owns the client lifecycle (this module never calls aclose) —
mirroring how 119-02's validate branch owns its client.
"""
from __future__ import annotations

from services.sfox_client import SfoxClient


async def read_sfox_account(client: SfoxClient) -> dict:
    """Read an sFOX account's balances + trades + transactions in one pull.

    Composes exactly SfoxClient's three GET read methods (single-page; no cursor
    passed — phase 120 owns crawl orchestration) and returns
    ``{"balances": [...], "trades": [...], "transactions": [...]}``.

    Read-only is asserted at the ingestion boundary: a non-SfoxClient object is
    refused with TypeError before any read, so no write-capable object can be
    smuggled through this boundary. Any leg's SfoxApiError propagates (fail loud;
    the caller decides) — never a partial or fabricated result. The caller owns
    the client's session lifecycle; this function does not close it.
    """
    if not isinstance(client, SfoxClient):
        raise TypeError(
            "read_sfox_account requires a read-only SfoxClient at the ingestion "
            f"boundary (got {type(client).__name__}); a write-capable object "
            "must never be smuggled through this read pull."
        )

    balances = await client.get_balances()
    trades = await client.get_trades()
    transactions = await client.get_transactions()

    return {
        "balances": balances,
        "trades": trades,
        "transactions": transactions,
    }
