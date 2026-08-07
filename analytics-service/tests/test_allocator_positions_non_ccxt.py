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
import asyncio
import inspect
import re
import textwrap
import time
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
OTHER_API_KEY_ID = "9f0c1d2e-0000-4000-8000-000000000abc"
EXPECTED_LOGIN = 123456
# Hand literals (economic-oracle discipline): equity ≠ balance, so a row built
# from `balance` turns the assertion RED. MT5's account_info().equity is
# balance + floating uPnL — it is the account's mark-to-market value and
# therefore the only honest AUM contribution.
ACCOUNT_EQUITY = 123456.78
ACCOUNT_BALANCE = 120000.00

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


# ===========================================================================
# Task 2 — the MT5 account-equity branch
# ===========================================================================
#
# The doubles below drive the REAL Mt5Client facade through its `_connect`
# injection seam (the same offline posture tests/test_mt5_derive_branch.py and
# tests/test_mt5_sync_path.py use): no mt5linux, no network, no Wine terminal.
# Using the real facade rather than a mock is deliberate — it makes "the branch
# never touches a ccxt surface" and "the branch never reads open positions"
# STRUCTURAL facts (the facade has no such methods), not mock etiquette.


class _NT:
    """A netref-namedtuple stand-in: Mt5Client._materialize needs ._asdict()."""

    def __init__(self, d: dict) -> None:
        self._d = dict(d)

    def _asdict(self) -> dict:
        return dict(self._d)


class _RecordingMt5Transport:
    """Records every terminal call so 'zero IPC' assertions are falsifiable.

    Spec-constrained by OMISSION: it exposes only initialize/login/account_info/
    last_error/shutdown. It deliberately has NO ``history_deals_get`` and no
    ccxt surface, so a branch that tried to read the deal ledger (the derive
    job's job, not this one) or to call fetch_balance would fail LOUD.
    """

    def __init__(self, *, account: dict, on_account_info=None) -> None:
        self._account = account
        self._on_account_info = on_account_info
        self.calls: list[str] = []

    def initialize(self):
        self.calls.append("initialize")
        return True

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        self.calls.append("login")
        return True

    def account_info(self):
        self.calls.append("account_info")
        if self._on_account_info is not None:
            self._on_account_info()
        return _NT(self._account)

    def last_error(self):
        return (0, "unknown")

    def shutdown(self):
        self.calls.append("shutdown")


def _account(**overrides: object) -> dict:
    base: dict = {
        "login": EXPECTED_LOGIN,
        "equity": ACCOUNT_EQUITY,
        "balance": ACCOUNT_BALANCE,
        "currency": "USD",
    }
    base.update(overrides)
    return base


def _session(transport: _RecordingMt5Transport):
    from services.mt5_client import Mt5Client, Mt5Session

    def _connect(*, host, port, timeout):  # noqa: ANN001
        return transport

    # host/port "h"/1 → terminal_key "h:1", the key the lock-identity tests use.
    client = Mt5Client("h", 1, _connect=_connect)
    return Mt5Session(
        client=client,
        login=EXPECTED_LOGIN,
        investor_password="pw",
        server="Broker-Live",
    )


@pytest.fixture
def mt5_enabled(monkeypatch):
    """MT5_ENABLED is fail-closed and read per-call; turn it ON explicitly."""
    monkeypatch.setenv("MT5_ENABLED", "true")


@pytest.fixture(autouse=True)
def _reset_terminal_locks():
    """Clear the ONE shared registry between tests so a Lock parked here can
    never leak into another test (mirrors tests/test_mt5_concurrency.py)."""
    from services import mt5_concurrency

    mt5_concurrency._MT5_TERMINAL_LOCKS.clear()
    yield
    mt5_concurrency._MT5_TERMINAL_LOCKS.clear()


# ---------------------------------------------------------------------------
# Test 5 — kill switch: no terminal IPC at all while MT5 is dark
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_kill_switch_skips_without_terminal_ipc(monkeypatch):
    """The derive arm gates on mt5_enabled_server() BEFORE any decrypt/login/
    read so an incident rollback stops live RPyC reads. The holdings arm holds
    the same posture — but through the honest-skip channel, not a
    DispatchResult."""
    from services.closed_sets import MT5_DISABLED_DETAIL

    monkeypatch.delenv("MT5_ENABLED", raising=False)
    transport = _RecordingMt5Transport(account=_account())

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert rows == []
    assert warning == MT5_DISABLED_DETAIL
    assert transport.calls == [], (
        f"kill switch must gate BEFORE any terminal IPC; observed {transport.calls}"
    )


# ---------------------------------------------------------------------------
# Test 6 — a USD account yields exactly ONE equity row (equity, NOT balance)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_usd_account_emits_one_equity_row(mt5_enabled):
    """ECONOMIC ORACLE: the row's value is account_info().equity — the
    mark-to-market account value — never ``balance``, which drops the floating
    uPnL of open positions and would under-report a live book's AUM. The
    fixture is built with equity != balance precisely so the two are
    distinguishable."""
    transport = _RecordingMt5Transport(account=_account())

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert warning is None
    assert len(rows) == 1, f"expected exactly one account row, got {rows}"
    row = rows[0]

    assert row["value_usd"] == ACCOUNT_EQUITY
    assert row["quantity"] == ACCOUNT_EQUITY
    assert row["value_usd"] != ACCOUNT_BALANCE, (
        "the row must carry EQUITY (balance + floating uPnL), not balance"
    )
    assert row["venue"] == "mt5"
    assert row["holding_type"] == "spot"
    assert row["side"] == "flat"
    assert row["mark_price"] == 1.0
    # A USD cash-equivalent account row has no basis and no derivative uPnL:
    # None is the conforming value, and a fabricated 0.0 would read downstream
    # as a real measured zero.
    assert row["entry_price"] is None
    assert row["unrealized_pnl_usd"] is None
    assert row["cost_basis_usd"] is None

    # The read is login → account_info, nothing else. No deal ledger (that is
    # run_derive_broker_dailies_job's single path), no open-positions read.
    assert "login" in transport.calls
    assert "account_info" in transport.calls
    assert "history_deals_get" not in transport.calls


# ---------------------------------------------------------------------------
# Test 7 — the symbol is ACCOUNT-SCOPED (Pitfall 1 / T-151-06 / T-151-07)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_symbol_is_account_scoped(mt5_enabled):
    """allocator_holdings is UNIQUE (allocator_id, venue, symbol, asof) with NO
    api_key_id in the key. If every MT5 account wrote the same symbol, the
    founder's three accounts would upsert over each other and AUM would show
    ONE of them. The token must also match [A-Za-z0-9_-]+ (the commit route's
    HOLDING_REF_RE) and must NOT be the broker login (T-151-06, ASVS V8)."""
    rows_a, _ = await fetch_allocator_holdings(
        "mt5", _session(_RecordingMt5Transport(account=_account())), API_KEY_ID
    )
    rows_b, _ = await fetch_allocator_holdings(
        "mt5",
        _session(_RecordingMt5Transport(account=_account())),
        OTHER_API_KEY_ID,
    )

    symbol_a = rows_a[0]["symbol"]
    symbol_b = rows_b[0]["symbol"]

    assert symbol_a == "ACCOUNT-46293712"
    assert re.fullmatch(r"[A-Za-z0-9_-]+", symbol_a), (
        "symbol must satisfy HOLDING_REF_RE — no colons, slashes or spaces"
    )
    assert symbol_a != symbol_b, (
        "two MT5 accounts must produce two DISTINCT symbols, else they collapse "
        "into one holdings row under the unique index"
    )
    assert str(EXPECTED_LOGIN) not in symbol_a, (
        "the broker account number must not ride into the Holdings UI or the "
        "commit fingerprint"
    )


# ---------------------------------------------------------------------------
# Test 8 — non-USD / unknown currency skips honestly, never assumed USD
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_non_usd_currency_skips_honestly(mt5_enabled):
    """A EUR account has no USD figure without an FX rate we do not have.
    Defaulting to USD would fabricate a rate of 1.0 — an invented number inside
    an AUM total. Skip with honest copy instead."""
    from services.allocator_positions import MT5_NON_USD_NOTE

    transport = _RecordingMt5Transport(account=_account(currency="EUR"))

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert rows == []
    assert warning == MT5_NON_USD_NOTE.format(ccy="EUR")


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_ccy", [None, "", "   "])
async def test_mt5_missing_currency_skips_and_is_never_treated_as_usd(
    mt5_enabled, bad_ccy
):
    """[A3] fail-loud rule: a missing/blank currency must NOT be read as USD.
    An absent field means we do not know the denomination — and a silently
    assumed USD is the same fabricated 1.0 FX rate by another route."""
    from services.allocator_positions import MT5_NON_USD_NOTE

    transport = _RecordingMt5Transport(account=_account(currency=bad_ccy))

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert rows == [], "an unknown-currency account must contribute NO row"
    assert warning == MT5_NON_USD_NOTE.format(ccy="unknown")


@pytest.mark.asyncio
async def test_mt5_currency_is_never_echoed_raw_into_user_copy(mt5_enabled):
    """The currency string is TERMINAL-controlled text landing in a column the
    browser renders verbatim. Only a plain currency code may be echoed; any
    other shape renders as "unknown" (T-151-05 / ASVS V7)."""
    from services.allocator_positions import MT5_NON_USD_NOTE

    hostile = "<script>alert(1)</script>"
    transport = _RecordingMt5Transport(account=_account(currency=hostile))

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert rows == []
    assert warning == MT5_NON_USD_NOTE.format(ccy="unknown")
    assert hostile not in (warning or "")


# ---------------------------------------------------------------------------
# Test 9 — a hung read is bounded, restarts the terminal, and RETRIES
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_read_timeout_restarts_and_raises_transient(
    mt5_enabled, monkeypatch
):
    """WEDGE-01 / MT5CONC-01 class: a blocked Wine pipe will not self-unblock,
    so the read is wall-clock bounded, the terminal is ACTIVELY (and boundedly)
    restarted, and the failure is a RETRYABLE transient carrying human copy —
    never an unbounded wedge of the sequential worker, never str(exc)."""
    from services.allocator_positions import (
        AllocatorHoldingsSyncTransientError,
        MT5_UNREACHABLE_NOTE,
    )

    restarts: list[object] = []

    async def _fake_restart(client):
        restarts.append(client)

    monkeypatch.setattr(ap, "_MT5_DERIVE_READ_TIMEOUT_S", 0.05)
    monkeypatch.setattr(ap, "_mt5_bounded_restart", _fake_restart)

    transport = _RecordingMt5Transport(
        account=_account(), on_account_info=lambda: time.sleep(0.6)
    )

    with pytest.raises(AllocatorHoldingsSyncTransientError) as excinfo:
        await fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID)

    assert str(excinfo.value) == MT5_UNREACHABLE_NOTE
    assert restarts, "a timed-out read must actively restart the terminal"


# ---------------------------------------------------------------------------
# Test 10 — the holdings branch uses the ONE terminal-lock registry
# ---------------------------------------------------------------------------
def test_mt5_holdings_branch_shares_the_one_terminal_lock_registry():
    """THE binding trap (151-RESEARCH Pitfall 2): a private
    ``_TERMINAL_LOCKS = {}`` in allocator_positions hands out a perfectly
    functional Lock, so any "it locked" assertion stays green while the derive
    and holdings arms hold DIFFERENT locks against the same Wine terminal. The
    only oracle that bites is OBJECT IDENTITY."""
    from services import job_worker as jw
    from services import mt5_concurrency

    assert ap._mt5_terminal_lock_for is mt5_concurrency._mt5_terminal_lock_for
    assert ap._mt5_terminal_lock_for is jw._mt5_terminal_lock_for

    lock = ap._mt5_terminal_lock_for("h:1")
    assert lock is mt5_concurrency._mt5_terminal_lock_for("h:1")
    assert lock is jw._mt5_terminal_lock_for("h:1")


@pytest.mark.asyncio
async def test_mt5_holdings_read_contends_on_the_shared_terminal_lock(mt5_enabled):
    """Identity of the helper is necessary but not sufficient — the branch must
    actually ACQUIRE the lock around its terminal IPC. Hold the shared lock for
    this terminal and the holdings read must BLOCK. Under a duplicate registry
    (or an unlocked read) it would sail straight through."""
    from services import mt5_concurrency

    transport = _RecordingMt5Transport(account=_account())
    held = mt5_concurrency._mt5_terminal_lock_for("h:1")

    async with held:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID),
                timeout=0.25,
            )

    assert transport.calls == [], (
        "the read must wait for the terminal lock before any IPC; observed "
        f"{transport.calls}"
    )


# ---------------------------------------------------------------------------
# Test 11 — the login bracket: never a wrong-account equity row
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_login_mismatch_never_emits_a_wrong_account_row(
    mt5_enabled, monkeypatch
):
    """T-151-09 / MT5CONC-02: the live terminal presenting a DIFFERENT account
    than the connected key is a mis-routed/stale-terminal infra fault. The
    equity read must be REFUSED (no row at all — a wrong-account figure inside
    a user's AUM is data corruption), the terminal restarted, and the job
    retried with human copy."""
    from services.allocator_positions import (
        AllocatorHoldingsSyncTransientError,
        MT5_UNREACHABLE_NOTE,
    )

    restarts: list[object] = []

    async def _fake_restart(client):
        restarts.append(client)

    monkeypatch.setattr(ap, "_mt5_bounded_restart", _fake_restart)
    transport = _RecordingMt5Transport(account=_account(login=999_999))

    with pytest.raises(AllocatorHoldingsSyncTransientError) as excinfo:
        await fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID)

    assert str(excinfo.value) == MT5_UNREACHABLE_NOTE
    assert restarts, "a mis-routed terminal must be restarted"
    for banned in BANNED_INTERNALS:
        assert banned not in str(excinfo.value)


@pytest.mark.asyncio
async def test_mt5_missing_login_field_fails_loud(mt5_enabled, monkeypatch):
    """A MISSING ``login`` field must FAIL LOUD, never default-match. ``info.get``
    returning None compared against an int login is the exact silent
    default-match this guard exists to prevent."""
    from services.allocator_positions import AllocatorHoldingsSyncTransientError

    async def _fake_restart(client):
        return None

    monkeypatch.setattr(ap, "_mt5_bounded_restart", _fake_restart)
    account = _account()
    del account["login"]
    transport = _RecordingMt5Transport(account=account)

    with pytest.raises(AllocatorHoldingsSyncTransientError):
        await fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID)


# ---------------------------------------------------------------------------
# Poisoned / missing equity — refuse the anchor
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"equity": float("nan")},
        {"equity": float("inf")},
        {"equity": "not-a-number"},
    ],
)
async def test_mt5_poisoned_equity_is_refused(mt5_enabled, monkeypatch, overrides):
    """A NaN/Inf/garbage equity would sail past every downstream denominator
    guard as a silently poisoned AUM figure. Refuse it — no row."""
    from services.allocator_positions import AllocatorHoldingsSyncTransientError

    async def _fake_restart(client):
        return None

    monkeypatch.setattr(ap, "_mt5_bounded_restart", _fake_restart)
    transport = _RecordingMt5Transport(account=_account(**overrides))

    with pytest.raises(AllocatorHoldingsSyncTransientError):
        await fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID)
