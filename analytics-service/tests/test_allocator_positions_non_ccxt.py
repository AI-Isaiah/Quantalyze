"""Non-ccxt venue dispatch at the ONE holdings chokepoint (Phase 151 / AUM-02).

PROD defect this file exists for: `_make_exchange_client` (the CONSTRUCTION
chokepoint) grew `sfox` and `mt5` branches while its holdings CONSUMER
(`fetch_allocator_holdings`) stayed ccxt-only, so an `Mt5Session` reached
`_fetch_spot_rows` → `exchange.fetch_balance()` → AttributeError, and the
handler's generic `except Exception` stamped the raw Python text into
`api_keys.sync_error` — a user-visible column rendered verbatim by
`AllocatorSyncStatus`. PROD census 2026-08-05: all three founder MT5 keys.

Required tests (numbered per 151-03-PLAN):

  Task 1 — dispatch + honest skip + transient plumbing
  1.  test_ccxt_venue_reaches_fetch_balance_unchanged
  2.  test_unknown_non_ccxt_venue_skips_honestly_without_touching_client
  3.  test_handler_stamps_human_copy_on_transient_failure
  4.  test_user_visible_copy_never_leaks_python_internals
  4b. test_non_ccxt_venues_agrees_with_exchange_client_factory

  Task 2 — the MT5 account-equity branch
  5.  test_mt5_kill_switch_skips_without_terminal_ipc
  6.  test_mt5_usd_account_emits_one_equity_row
  7.  test_mt5_symbol_is_account_scoped
  8.  test_mt5_non_usd_currency_skips_honestly
      test_mt5_missing_currency_skips_and_is_never_treated_as_usd
  9.  test_mt5_read_timeout_restarts_and_raises_transient
  10. test_mt5_holdings_branch_shares_the_one_terminal_lock_registry
      test_mt5_holdings_read_contends_on_the_shared_terminal_lock
  11. test_mt5_login_mismatch_never_emits_a_wrong_account_row

Fakes are SPEC-CONSTRAINED on purpose (151-PATTERNS Correction 3): an
`AsyncMock`/`MagicMock` synthesizes any attribute, which would make a
"the client was never touched" assertion vacuous.
"""
from __future__ import annotations

import ast
import inspect
import textwrap
from unittest.mock import AsyncMock, MagicMock

import pytest

import services.allocator_positions as ap
from services.allocator_positions import (
    UNSUPPORTED_VENUE_NOTE,
    fetch_allocator_holdings,
)
from services.closed_sets import NON_CCXT_VENUES


ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000aa"
API_KEY_ID = "46293712-59e6-46c0-8204-5dd32afe2503"

# Every substring that must NEVER appear in a worker-written, user-visible
# string. These are the literal fragments of the PROD sync_error.
BANNED_INTERNALS = (
    "Traceback",
    "AttributeError",
    "object has no attribute",
    "Mt5Session",
    "fetch_balance",
)


class _SpecConstrainedClient:
    """A non-ccxt client double with NO ccxt surface whatsoever.

    Deliberately NOT a MagicMock: a mock synthesizes `fetch_balance`,
    `fetch_positions` and `id` on demand, so the ccxt body would run happily
    against it and "the client was never touched" would assert nothing
    (151-PATTERNS Correction 3). Here ANY attribute access the dispatch
    attempts fails LOUD — including `getattr(exchange, "id", None)`, whose
    default cannot swallow an AssertionError.
    """

    def __getattr__(self, name: str) -> object:
        raise AssertionError(
            f"a non-ccxt venue must never reach the ccxt body; touched {name!r}"
        )


# ---------------------------------------------------------------------------
# Test 1 — ccxt venues fall through byte-unchanged
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ccxt_venue_reaches_fetch_balance_unchanged():
    """The dispatch must be a pure PREPEND: a ccxt venue still reaches
    fetch_balance/fetch_positions exactly as before (the existing
    tests/test_allocator_positions.py suite is the wider pin; this is the
    in-file guard so a dispatch regression fails here too)."""
    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 1000.0}})
    exchange.fetch_positions = AsyncMock(return_value=[])

    rows, warning = await fetch_allocator_holdings("binance", exchange)

    exchange.fetch_balance.assert_awaited_once()
    assert warning is None
    assert [r["symbol"] for r in rows] == ["USDT"]
    assert rows[0]["value_usd"] == 1000.0


# ---------------------------------------------------------------------------
# Test 2 — an unregistered non-ccxt venue skips HONESTLY, never crashes
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_unknown_non_ccxt_venue_skips_honestly_without_touching_client(
    monkeypatch,
):
    """A venue that `_make_exchange_client` can build but this path has no
    fetcher for returns ([], human copy) — the class fix. The synthetic
    venue name is deliberate: pinning this on a REAL venue (e.g. "sfox")
    would silently invalidate the test the moment wave 3 registers its
    fetcher."""
    monkeypatch.setattr(
        ap, "NON_CCXT_VENUES", NON_CCXT_VENUES | {"testvenue"}, raising=True
    )
    client = _SpecConstrainedClient()

    rows, warning = await fetch_allocator_holdings("testvenue", client)

    assert rows == []
    assert warning == UNSUPPORTED_VENUE_NOTE.format(venue="Testvenue")


# ---------------------------------------------------------------------------
# Test 3 — the handler stamps HUMAN copy (not str(exc) internals) and retries
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_handler_stamps_human_copy_on_transient_failure(
    monkeypatch, api_key_row_factory
):
    """WIRING test (Rule 9): drives the REAL handler. A venue branch raising
    AllocatorHoldingsSyncTransientError must reach its DEDICATED except arm —
    stamping str(exc) verbatim as sync_error with sync_status='error' and
    error_kind='transient' — and must NEVER fall through to the generic
    `except Exception` arm whose classify_exception str(exc) stamped the PROD
    AttributeError.

    FALSIFIER OBSERVED: with the dedicated arm commented out, this fails —
    classify_exception maps the unknown exception type to 'permanent'.
    """
    import services.job_worker as jw
    from services import audit as audit_module
    from services.allocator_positions import (
        AllocatorHoldingsSyncTransientError,
        MT5_UNREACHABLE_NOTE,
    )

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="mt5"
    )

    updates: list[tuple[str, dict]] = []
    mock_supabase = MagicMock()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _update(payload: dict) -> MagicMock:
            updates.append((name, payload))
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.execute.return_value = MagicMock(data=[{"id": API_KEY_ID}])
            return chain

        tbl.update.side_effect = _update
        return tbl

    mock_supabase.table.side_effect = _table

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=MagicMock(),
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    async def _raise_transient(exchange_name, exchange, api_key_id=None):
        raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)
    monkeypatch.setattr(ap, "fetch_allocator_holdings", _raise_transient)
    monkeypatch.setattr(audit_module, "log_audit_event", MagicMock())

    result = await jw.run_poll_allocator_positions_job(
        {"id": "job-1", "kind": "poll_allocator_positions", "api_key_id": API_KEY_ID}
    )

    assert result.outcome == jw.DispatchOutcome.FAILED
    assert result.error_kind == "transient", (
        "a genuine venue transport failure must RETRY, not fail permanently"
    )

    api_key_updates = [p for (name, p) in updates if name == "api_keys"]
    assert api_key_updates, "expected an api_keys status update"
    final = api_key_updates[-1]
    assert final["sync_status"] == "error"
    assert final["sync_error"] == MT5_UNREACHABLE_NOTE


# ---------------------------------------------------------------------------
# Test 4 — the leak invariant (T-151-05 / ASVS V7)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_user_visible_copy_never_leaks_python_internals(monkeypatch):
    """Every worker-written string this plan can put in `api_keys.sync_error`
    is END-USER copy: no traceback, no exception class name, no internal
    type or method name."""
    from services.allocator_positions import (
        MT5_NON_USD_NOTE,
        MT5_UNREACHABLE_NOTE,
    )

    monkeypatch.setattr(
        ap, "NON_CCXT_VENUES", NON_CCXT_VENUES | {"testvenue"}, raising=True
    )
    _rows, skip_note = await fetch_allocator_holdings(
        "testvenue", _SpecConstrainedClient()
    )

    candidates = [
        skip_note,
        MT5_UNREACHABLE_NOTE,
        MT5_NON_USD_NOTE.format(ccy="EUR"),
        UNSUPPORTED_VENUE_NOTE.format(venue="MT5"),
    ]
    for copy in candidates:
        assert copy is not None
        for banned in BANNED_INTERNALS:
            assert banned not in copy, f"{banned!r} leaked into user copy {copy!r}"
        # The copy class: "{what happened} — {what next}", em dash, one sentence.
        assert "—" in copy, f"missing the em-dash copy pattern: {copy!r}"


# ---------------------------------------------------------------------------
# Test 4b — the single-source drift gate
# ---------------------------------------------------------------------------
def test_non_ccxt_venues_agrees_with_exchange_client_factory():
    """NON_CCXT_VENUES must mirror `_make_exchange_client`'s non-ccxt branches
    EXACTLY. A venue added to the factory without an entry here re-opens the
    AUM-02 crash class (it would be built, then handed to the ccxt body); an
    entry here without a factory branch would skip a venue that in fact syncs
    fine."""
    import services.job_worker as jw

    tree = ast.parse(textwrap.dedent(inspect.getsource(jw._make_exchange_client)))
    fn = tree.body[0]
    assert isinstance(fn, ast.FunctionDef)

    branch_venues: set[str] = set()
    for node in ast.walk(fn):
        if not isinstance(node, ast.Compare):
            continue
        if not (isinstance(node.left, ast.Name) and node.left.id == "exchange_name"):
            continue
        if not (len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq)):
            # A future `in (...)` / `not in` arm changes the extraction shape —
            # fail LOUD rather than silently under-reporting the factory's set.
            raise AssertionError(
                "unrecognized _make_exchange_client dispatch shape — update this "
                "gate (and NON_CCXT_VENUES) deliberately"
            )
        comparator = node.comparators[0]
        assert isinstance(comparator, ast.Constant) and isinstance(
            comparator.value, str
        ), "expected a string-literal venue comparison"
        branch_venues.add(comparator.value)

    assert branch_venues, "extracted no venue literals — the gate would be vacuous"
    assert branch_venues == set(NON_CCXT_VENUES), (
        f"_make_exchange_client branches on {sorted(branch_venues)} but "
        f"closed_sets.NON_CCXT_VENUES holds {sorted(NON_CCXT_VENUES)} — keep "
        "them in lockstep (AUM-02)"
    )
