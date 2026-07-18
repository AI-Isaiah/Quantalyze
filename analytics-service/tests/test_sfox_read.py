"""SFOX-02 — the worker-side read pull `services.sfox_read.read_sfox_account`.

A thin orchestration that reads an sFOX account's balances + trades +
transactions through the Phase-118 read-only `SfoxClient`. Full daily-return
reconstruction, cursor crawl, and `get_adapter("sfox")` registration are PHASE
120 — this suite proves the read pull + read-only ingestion-boundary assertion
+ honest fail-loud ONLY. The live prod-read leg is founder-gated (Q3); this
mocked suite carries the phase (a live read is never faked).

P115 discipline: every oracle asserts against KNOWN mock payloads handed to the
client's read methods — never the module's own transform of them (no
self-referential oracle). The client's three GET reads are replaced with
AsyncMocks on a REAL SfoxClient instance, so `isinstance(client, SfoxClient)`
holds AND the returned bytes are the fixture payloads verbatim.

Regression gates — WHY each case matters (Rule 9):
  - 3-leg composition: read_sfox_account must return exactly the three legs
    (balances/trades/transactions) sourced from the client's GET reads. If a leg
    is dropped or a key renamed, phase-120 reconstruction consumes a truncated
    account. Asserted against the distinct fixture payload per leg.
  - honest empty: an empty account (all legs []) returns honest empties, never a
    fabricated row (T-119-13 / no-invented-data).
  - per-leg fail-LOUD: a SfoxApiError on ANY of the three legs propagates and NO
    partial dict is returned — a partial/fabricated read masking an upstream
    failure is T-119-13. Tested for each leg independently.
  - read-only ingestion boundary (T-119-12): a non-SfoxClient object (e.g. a
    future ccxt exchange smuggling write methods) is refused at the boundary
    (TypeError). Structural GET-only adapter (118 WR-03) is the other half.
  - write-surface grep gate (T-119-12): the module source references only the
    client's read surface (get_balances/get_trades/get_transactions/aclose) and
    contains NO order/withdraw/transfer/POST token. Comment lines are filtered
    first (a bare unfiltered gate is forbidden — it would trip on this very
    docstring's prose).
  - caller owns the session: read_sfox_account does NOT aclose the client (the
    caller owns lifecycle, mirroring 119-02's validate branch). A stray aclose
    here would close a session the caller still needs.
"""
from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.sfox_client import SfoxApiError, SfoxClient
from services.sfox_read import read_sfox_account

API_KEY = "secretkey123456"

# Distinct, hand-authored fixture payloads — the independent oracle. Each leg
# gets a shape unmistakably its own so a leg swap (balances<->trades) is caught.
BALANCES_FIXTURE = [{"currency": "USD", "balance": "100.5"}]
TRADES_FIXTURE = [{"trade_id": 7, "quantity": "0.5"}]
TRANSACTIONS_FIXTURE = [{"id": 42, "account_balance": "100.5", "type": "deposit"}]


def _mock_client(
    balances=BALANCES_FIXTURE,
    trades=TRADES_FIXTURE,
    transactions=TRANSACTIONS_FIXTURE,
) -> SfoxClient:
    """A REAL SfoxClient (so the isinstance boundary passes) with its three GET
    read methods replaced by AsyncMocks returning the fixture payloads. No
    network is ever touched; aclose is stubbed to detect a stray close."""
    client = SfoxClient(api_key=API_KEY)
    client.get_balances = AsyncMock(return_value=balances)
    client.get_trades = AsyncMock(return_value=trades)
    client.get_transactions = AsyncMock(return_value=transactions)
    client.aclose = AsyncMock()
    return client


async def test_reads_all_three_legs_from_client_get_methods():
    """3-leg composition: the result carries balances/trades/transactions sourced
    verbatim from the client's three GET reads (asserted against the distinct
    fixture payloads, not the module's own transform)."""
    client = _mock_client()
    out = await read_sfox_account(client)

    assert out == {
        "balances": BALANCES_FIXTURE,
        "trades": TRADES_FIXTURE,
        "transactions": TRANSACTIONS_FIXTURE,
    }
    # Each read method was actually awaited (the wiring, not just the shape).
    client.get_balances.assert_awaited_once()
    client.get_trades.assert_awaited_once()
    client.get_transactions.assert_awaited_once()


async def test_single_page_no_cursor_passed():
    """Single-page (phase 120 owns crawl): the reads are called with NO cursor
    argument. A crawl leaking into this phase would pass after/last_seen_id."""
    client = _mock_client()
    await read_sfox_account(client)
    assert client.get_balances.await_args == ((), {})
    assert client.get_trades.await_args == ((), {})
    assert client.get_transactions.await_args == ((), {})


async def test_empty_account_returns_honest_empties():
    """T-119-13 / no invented data: an empty account (all legs []) returns honest
    empty lists — never a fabricated row."""
    client = _mock_client(balances=[], trades=[], transactions=[])
    out = await read_sfox_account(client)
    assert out == {"balances": [], "trades": [], "transactions": []}


@pytest.mark.parametrize("failing_leg", ["get_balances", "get_trades", "get_transactions"])
async def test_any_leg_sfox_api_error_propagates_no_partial(failing_leg):
    """T-119-13 fail-LOUD: a SfoxApiError on ANY leg propagates untouched and NO
    partial dict is returned (never a partial/fabricated read masking a failure)."""
    client = _mock_client()
    getattr(client, failing_leg).side_effect = SfoxApiError(500, "boom")

    with pytest.raises(SfoxApiError):
        await read_sfox_account(client)


async def test_caller_owns_session_read_does_not_aclose():
    """The caller owns the client lifecycle (mirrors 119-02's validate branch):
    read_sfox_account must NOT aclose the client out from under the caller."""
    client = _mock_client()
    await read_sfox_account(client)
    client.aclose.assert_not_awaited()


@pytest.mark.parametrize(
    "not_a_client",
    [
        MagicMock(name="ccxt_exchange_smuggling_write_methods"),
        object(),
        None,
        {"get_balances": lambda: []},
    ],
)
async def test_non_sfoxclient_refused_at_ingestion_boundary(not_a_client):
    """T-119-12 (read-only at the ingestion boundary): a non-SfoxClient object —
    e.g. a future ccxt exchange carrying create_order/withdraw — is refused with
    a TypeError BEFORE any read, so a write-capable object can never be smuggled
    through this boundary."""
    with pytest.raises(TypeError):
        await read_sfox_account(not_a_client)


def test_write_surface_grep_gate():
    """T-119-12 structural gate: the module source references ONLY the client's
    read surface (get_balances/get_trades/get_transactions/aclose) and contains
    NO order/withdraw/transfer/POST token. Comment lines (and the docstring) are
    stripped first — a bare unfiltered gate would trip on prose (forbidden)."""
    src_path = Path(__file__).resolve().parents[1] / "services" / "sfox_read.py"
    source = src_path.read_text()

    # Strip the module docstring, then all comment lines (grep -v '^\s*#'
    # equivalent) so the gate scans EXECUTABLE code only, never prose.
    import ast

    tree = ast.parse(source)
    doc = ast.get_docstring(tree)  # module docstring text (prose) removed below
    code_lines = [
        ln for ln in source.splitlines() if not re.match(r"^\s*#", ln)
    ]
    code = "\n".join(code_lines)
    if doc is not None:
        code = code.replace(doc, "")

    lowered = code.lower()
    for forbidden in ("create_order", "place_order", "cancel_order", "withdraw", "transfer", "post"):
        assert forbidden not in lowered, (
            f"sfox_read.py executable code references a write/forbidden token: {forbidden!r}"
        )

    # Positive: the only client-surface methods referenced are the read set.
    referenced = set(re.findall(r"\.(get_[a-z_]+|aclose)\b", code))
    allowed = {"get_balances", "get_trades", "get_transactions", "aclose"}
    assert referenced <= allowed, (
        f"sfox_read.py references non-read client methods: {referenced - allowed}"
    )
    assert {"get_balances", "get_trades", "get_transactions"} <= referenced
