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

  151-04 Task 1 — the sFOX balance branch (AUM-05)
  12. test_sfox_stablecoin_rows_contribute_and_the_rest_skip_honestly
  13. test_sfox_all_priceable_book_has_no_warning
  14. test_sfox_kill_switch_skips_without_touching_the_api
  15. test_sfox_fetch_failure_raises_transient_human_copy
  16. test_sfox_empty_book_is_not_an_error

  151-04 Task 2 — the CLASS-closure proof (AUM-02 + AUM-05)
  17. test_non_ccxt_venue_class_is_closed          [parametrized: mt5 / sfox /
                                                    an unknown venue]
  18. test_two_accounts_under_one_allocator_do_not_collapse_on_upsert
  19. test_ccxt_venue_is_untouched_by_the_dispatch  [the control arm]

AUM-05 — why the sFOX branch is proven by TEST and not by a live probe: sFOX
is dark behind `SFOX_ENABLED` with zero stored keys, so "the same test shape
passes for sFOX BEFORE its go-live flip" is the ONLY way this venue's holdings
path can be known-good on the day the founder flips it. `SfoxClient` exposes
`get_balances()`, not ccxt's `fetch_balance()` — a byte-identical latent crash
to the MT5 PROD defect above, invisible only because the flag is off.

Test 17 is the reason this file is shaped the way it is. The ROADMAP binding
trap for this phase is fixing the MT5 INSTANCE rather than the venue CLASS: a
per-venue test suite proves each venue works and proves NOTHING about the next
one. ONE parametrized body over mt5 + sfox + a venue that does not exist is
what makes "no non-ccxt venue can put Python internals in front of a user" a
class-level fact — and it is why the third arm is a made-up venue name, which
by construction cannot have been special-cased.

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
    MT5_NON_USD_NOTE,
    SFOX_UNPRICED_ASSETS_NOTE,
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
    "SfoxClient",
    "fetch_balance",
    "fetch_positions",
)

# The ccxt surface no non-ccxt client may ever be asked for. Handing a
# non-ccxt client to the ccxt body IS the AUM-02 defect, so "these names were
# never invoked" is the structural half of the class proof.
CCXT_METHOD_NAMES = frozenset(
    {"fetch_balance", "fetch_positions", "fetch_tickers", "fetch_ticker"}
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
# Test 4c (151 review CR-03) — the leak invariant, BEHAVIOURAL, on the CCXT arm
#
# The enumerate-the-constants test above is necessary but not sufficient: it can
# only see strings someone remembered to add to its list, so it stayed GREEN
# while `fetch_allocator_holdings`' ccxt derivative arm stamped
# `str(exc)[:500]` — a raw Python exception — into `api_keys.sync_error` for
# binance/bybit/okx/deribit. This drives the real code path with a poisoned
# exception and asserts on the string the worker would WRITE.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ccxt_derivative_failure_never_leaks_the_exception_text():
    """A derivative-side failure on a CCXT venue surfaces END-USER copy.

    The exception message here is deliberately the PROD defect's own text, so a
    regression that re-introduces `str(exc)` fails on the exact string three
    founder accounts were shown.
    """
    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 1000.0}})
    exchange.fetch_positions = AsyncMock(
        side_effect=AttributeError(
            "'Mt5Session' object has no attribute 'fetch_positions'"
        )
    )

    rows, warning = await fetch_allocator_holdings("binance", exchange)

    # PARTIAL SUCCESS is preserved: the spot side still persists. (A "fix" that
    # simply re-raised would pass every leak assertion below and silently cost
    # the allocator their whole spot book.)
    assert [r["symbol"] for r in rows] == ["USDT"]

    assert warning is not None
    for banned in BANNED_INTERNALS:
        assert banned not in warning, (
            f"{banned!r} leaked into the user-visible sync_error {warning!r}"
        )
    assert "—" in warning, f"missing the em-dash copy pattern: {warning!r}"
    assert "Binance" in warning, (
        "the copy must name the venue in product casing, not a raw code"
    )


# ---------------------------------------------------------------------------
# Test 4d (151 review CR-03) — the CLASS gate: no arm may write `str(exc)`
#
# Tests 4 and 4c both prove things about arms that EXIST today. This one is the
# class-level closure the review asked for: it bites on ANY except-arm in the
# module that builds a value from the raw exception text outside of logging —
# including one added tomorrow, for a venue nobody has written yet.
#
# Logging is exempt BY CONSTRUCTION, not by allow-list: `logger.*(...)` calls
# are where the exception text BELONGS (they reach engineers, never the browser).
# ---------------------------------------------------------------------------
def test_no_except_arm_builds_user_copy_from_the_raw_exception():
    """`str(exc)` may reach the log chain and nothing else.

    `api_keys.sync_error` is rendered VERBATIM by AllocatorSyncStatus, and every
    non-logging value an except-arm produces in this module is a candidate for
    that column (a returned `warning`, an
    `AllocatorHoldingsSyncTransientError(...)` message, an f-string built from
    either). Interpolating the exception is therefore the defect, independent of
    which arm does it.
    """
    tree = ast.parse(inspect.getsource(ap))

    def _is_logger_call(node: ast.AST) -> bool:
        return (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "logger"
        )

    offenders: list[str] = []
    for handler in (n for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler)):
        if handler.name is None:
            continue
        bound = handler.name
        for stmt in handler.body:
            # Skip whole statements that ARE a logger call — the exception text
            # is welcome there.
            if isinstance(stmt, ast.Expr) and _is_logger_call(stmt.value):
                continue
            for node in ast.walk(stmt):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "str"
                    and any(
                        isinstance(a, ast.Name) and a.id == bound for a in node.args
                    )
                ):
                    offenders.append(f"line {node.lineno}: str({bound}) outside logging")
                # An f-string interpolating the bound exception is the same leak
                # wearing different syntax.
                if isinstance(node, ast.FormattedValue) and (
                    isinstance(node.value, ast.Name) and node.value.id == bound
                ):
                    offenders.append(f"line {node.lineno}: f-string {{{bound}}}")

    assert offenders == [], (
        "allocator_positions except-arms may pass the raw exception to logging "
        "ONLY — every other use can reach api_keys.sync_error, which the browser "
        f"renders verbatim (AUM-02). Offenders: {offenders}"
    )


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
# Test 7b (151 review WR-01) — a non-positive account equity emits NO row
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("equity", [-4_200.0, 0.0])
async def test_mt5_non_positive_equity_emits_no_row(mt5_enabled, equity):
    """ECONOMIC ORACLE: AUM is a sum, so a NEGATIVE row is subtraction.

    A stopped-out MT5 account reporting negative equity is a real broker state.
    Pre-fix only `math.isfinite` was checked, so that account wrote a row with a
    negative `value_usd` which silently DEFLATED the allocator's AUM — including
    the commit route's server-side audit recompute, where it would understate
    the size recorded against a real mandate decision. A zero writes a measured
    `$0`, which this branch elsewhere argues is a claim, not an absence.

    The ccxt spot path has filtered `float(qty) > 0` since Phase 06; this is the
    same rule, and the parametrization is what makes it a RULE rather than a
    negative-number special case.
    """
    transport = _RecordingMt5Transport(account=_account(equity=equity))

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert rows == [], f"a non-positive equity must contribute no holdings: {rows}"
    # Not an ERROR either: nothing failed, the account simply holds nothing.
    assert warning is None
    # NON-VACUITY: the read really happened (this is not an early bail on some
    # unrelated gate), so the emptiness is the positivity rule's doing.
    assert "account_info" in transport.calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"balance": None}, id="balance-omitted"),
        pytest.param({"balance": "n/a"}, id="balance-non-numeric"),
        pytest.param({"balance": float("nan")}, id="balance-nan"),
    ],
)
async def test_mt5_missing_balance_never_kills_a_healthy_equity_sync(
    mt5_enabled, overrides
):
    """`balance` is DIAGNOSTIC — it reaches `raw_payload` and nothing else.

    Pre-fix it shared the fail-loud extraction with `equity`, so a terminal that
    omitted it (or returned it non-numeric) raised the transient: the allocator
    saw "MT5 terminal unreachable" indefinitely and the account contributed ZERO
    to AUM even though the only economically load-bearing figure — equity — was
    present. The row is what the phase exists to produce; a missing diagnostic
    must never veto it.
    """
    account = _account()
    if overrides["balance"] is None:
        account.pop("balance")
    else:
        account["balance"] = overrides["balance"]
    transport = _RecordingMt5Transport(account=account)

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert warning is None
    assert len(rows) == 1, f"a healthy equity must still emit its row, got {rows}"
    # The economic figure is untouched by the diagnostic's absence.
    assert rows[0]["value_usd"] == ACCOUNT_EQUITY
    # …and the diagnostic degrades to "not reported", never a fabricated 0.0
    # (which would read downstream as a measured zero balance).
    assert rows[0]["raw_payload"]["balance"] is None


@pytest.mark.asyncio
async def test_mt5_present_balance_is_still_reported(mt5_enabled):
    """Control arm for the degradation above: a real balance still rides into
    raw_payload, so WR-02's fix cannot degenerate into 'always None'."""
    transport = _RecordingMt5Transport(account=_account())

    rows, _ = await fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID)

    assert rows[0]["raw_payload"]["balance"] == ACCOUNT_BALANCE


@pytest.mark.asyncio
async def test_mt5_missing_equity_still_fails_loud(mt5_enabled):
    """The other half of WR-02: relaxing the DIAGNOSTIC must not relax the
    ANCHOR. A missing/non-numeric equity is still a transient — publishing a
    guessed AUM anchor is the one thing worse than not publishing one."""
    account = _account()
    account.pop("equity")
    transport = _RecordingMt5Transport(account=account)

    with pytest.raises(ap.AllocatorHoldingsSyncTransientError):
        await fetch_allocator_holdings("mt5", _session(transport), API_KEY_ID)


@pytest.mark.asyncio
async def test_mt5_positive_equity_still_emits_its_row(mt5_enabled):
    """The positivity guard's control arm: the smallest positive equity still
    contributes, so WR-01's filter cannot degenerate into 'MT5 never syncs'."""
    transport = _RecordingMt5Transport(account=_account(equity=0.01))

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert warning is None
    assert len(rows) == 1
    assert rows[0]["value_usd"] == 0.01


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


# ===========================================================================
# 151-04 Task 1 — the sFOX balance branch (AUM-05)
# ===========================================================================


class _SpecConstrainedSfoxClient:
    """A `SfoxClient` double exposing ONLY the four read methods it really has.

    Spec-constrained by CONSTRUCTION: `__getattr__` fails loud on anything
    else, so a branch that reached for `fetch_balance` (the sFOX shape of the
    MT5 PROD defect) raises HERE with a readable message instead of quietly
    working against a synthesizing mock. `get_balances` is the CONTEXT-locked
    read; the other three exist so the double's shape matches the real facade
    and a future branch calling one of them is visible in `calls`.
    """

    def __init__(
        self,
        *,
        balances: list[dict[str, object]] | None = None,
        raises: BaseException | None = None,
        delay_s: float = 0.0,
    ) -> None:
        self._balances = list(balances or [])
        self._raises = raises
        self._delay_s = delay_s
        self.calls: list[str] = []

    async def get_balances(self) -> list[dict[str, object]]:
        self.calls.append("get_balances")
        if self._delay_s:
            await asyncio.sleep(self._delay_s)
        if self._raises is not None:
            raise self._raises
        return list(self._balances)

    async def get_transactions(self, *args: object, **kwargs: object) -> list:
        self.calls.append("get_transactions")
        return []

    async def get_trades(self, *args: object, **kwargs: object) -> list:
        self.calls.append("get_trades")
        return []

    async def get_balance_history(self, *args: object, **kwargs: object) -> list:
        self.calls.append("get_balance_history")
        return []

    def __getattr__(self, name: str) -> object:
        raise AssertionError(
            f"the sFOX branch must only use the read facade; touched {name!r}"
        )


@pytest.fixture
def sfox_enabled(monkeypatch):
    """SFOX_ENABLED is fail-closed and read per-call; turn it ON explicitly."""
    monkeypatch.setenv("SFOX_ENABLED", "true")


# ---------------------------------------------------------------------------
# Test 12 — USD + stablecoins contribute at 1.0; everything else skips HONESTLY
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sfox_stablecoin_rows_contribute_and_the_rest_skip_honestly(
    sfox_enabled,
):
    """sFOX's `get_balances` returns per-asset STRING quantities with NO USD
    valuation field, and the GET-only facade has no ticker endpoint — so a
    non-stable asset CANNOT be priced here without inventing a rate. USD and
    stablecoins mark at 1.0 (the ccxt spot path's own convention); every other
    asset is skipped and NAMED, never valued at a made-up number."""
    from services.allocator_positions import SFOX_UNPRICED_ASSETS_NOTE

    client = _SpecConstrainedSfoxClient(
        balances=[
            {"currency": "usd", "balance": "1000.5"},
            {"currency": "USDC", "balance": "250"},
            {"currency": "btc", "balance": "0.5"},
        ]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert len(rows) == 2, f"only the priceable assets may contribute: {rows}"
    by_symbol = {r["symbol"]: r for r in rows}
    assert set(by_symbol) == {"USD", "USDC"}

    # ECONOMIC ORACLE (hand literals): a cash-equivalent row's USD value IS its
    # quantity at a mark of exactly 1.0 — never recomputed from the impl.
    assert by_symbol["USD"]["quantity"] == 1000.50
    assert by_symbol["USD"]["value_usd"] == 1000.50
    assert by_symbol["USDC"]["quantity"] == 250.00
    assert by_symbol["USDC"]["value_usd"] == 250.00

    for row in rows:
        assert row["venue"] == "sfox"
        assert row["mark_price"] == 1.0
        assert row["holding_type"] == "spot"
        assert row["side"] == "flat"
        assert row["entry_price"] is None
        assert row["unrealized_pnl_usd"] is None
        assert row["cost_basis_usd"] is None
        assert re.fullmatch(r"[A-Za-z0-9_-]+", str(row["symbol"])), (
            "symbol must satisfy the commit route's HOLDING_REF_RE alphabet"
        )

    assert warning == (
        "sFOX balances in BTC can't be valued in USD yet — those balances "
        "were skipped."
    )
    assert warning == SFOX_UNPRICED_ASSETS_NOTE.format(assets="BTC")
    assert client.calls == ["get_balances"], (
        f"the CONTEXT-locked read is get_balances and nothing else: {client.calls}"
    )


# ---------------------------------------------------------------------------
# Test 13 — an all-priceable book warns about nothing
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sfox_all_priceable_book_has_no_warning(sfox_enabled):
    """A warning is a USER-VISIBLE stamp (`complete_with_warnings` +
    `api_keys.sync_error`). A fully-valued book must produce NONE — otherwise
    the channel cries wolf and the honest skip stops meaning anything."""
    client = _SpecConstrainedSfoxClient(
        balances=[
            {"currency": "USD", "balance": "10"},
            {"currency": "USDT", "balance": "20"},
        ]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert warning is None
    assert sorted(r["symbol"] for r in rows) == ["USD", "USDT"]
    assert sum(r["value_usd"] for r in rows) == 30.0


# ---------------------------------------------------------------------------
# Test 14 — kill-switch parity with the MT5 arm: zero API traffic while dark
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sfox_kill_switch_skips_without_touching_the_api(monkeypatch):
    """`SFOX_ENABLED` is fail-closed and gates BEFORE any network call, exactly
    as the MT5 arm gates before any terminal IPC — so the go-live flip is the
    ONLY thing that can put live sFOX traffic on this path."""
    from services.closed_sets import SFOX_DISABLED_DETAIL

    monkeypatch.delenv("SFOX_ENABLED", raising=False)
    client = _SpecConstrainedSfoxClient(
        balances=[{"currency": "USD", "balance": "10"}]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert rows == []
    assert warning == SFOX_DISABLED_DETAIL
    assert client.calls == [], (
        f"the kill switch must gate BEFORE any sFOX request; observed {client.calls}"
    )


# ---------------------------------------------------------------------------
# Test 15 — a transport failure is human copy + a RETRY, never str(exc)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sfox_fetch_failure_raises_transient_human_copy(sfox_enabled):
    """`SfoxApiError` carries an upstream, scrubbed-but-INTERNAL detail. Only
    the fixed copy constant may reach `api_keys.sync_error`; the upstream text
    reaches the log and the exception chain (T-151-10 / ASVS V7)."""
    from services.allocator_positions import (
        AllocatorHoldingsSyncTransientError,
        SFOX_FETCH_FAILED_NOTE,
    )
    from services.sfox_client import SfoxApiError

    upstream = SfoxApiError(503, "upstream said SfoxClient.fetch_balance blew up")
    client = _SpecConstrainedSfoxClient(raises=upstream)

    with pytest.raises(AllocatorHoldingsSyncTransientError) as excinfo:
        await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert str(excinfo.value) == SFOX_FETCH_FAILED_NOTE
    for banned in BANNED_INTERNALS:
        assert banned not in str(excinfo.value)
    assert excinfo.value.__cause__ is upstream, (
        "the upstream detail must survive in the chain for logs/Sentry"
    )


# ---------------------------------------------------------------------------
# Test 16 — an empty book is not an error
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sfox_empty_book_is_not_an_error(sfox_enabled):
    """A funded-but-emptied sFOX account legitimately holds nothing. Zero rows
    with no warning is the truthful answer — an error here would stamp a red
    sync status on a perfectly healthy key."""
    client = _SpecConstrainedSfoxClient(balances=[])

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert rows == []
    assert warning is None


# ---------------------------------------------------------------------------
# Rule-2 additions: hostile/zero/garbage rows (T-151-10 / T-151-11)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sfox_asset_code_is_never_echoed_raw_into_user_copy(sfox_enabled):
    """The currency code is VENUE-controlled text landing in a column the
    browser renders verbatim. Only a plain code may be echoed; anything else
    is named "unknown" (T-151-10 / ASVS V7) — the same allow-list posture the
    MT5 currency gate takes."""
    from services.allocator_positions import SFOX_UNPRICED_ASSETS_NOTE

    hostile = "<script>alert(1)</script>"
    client = _SpecConstrainedSfoxClient(
        balances=[{"currency": hostile, "balance": "5"}]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert rows == [], "an unidentifiable asset must contribute NO row"
    assert warning == SFOX_UNPRICED_ASSETS_NOTE.format(assets="unknown")
    assert hostile not in (warning or "")


@pytest.mark.asyncio
async def test_sfox_zero_balances_are_skipped_and_never_named(sfox_enabled):
    """A zero balance is not skipped MONEY — naming it in the warning would
    tell the user their BTC was dropped when they hold no BTC."""
    client = _SpecConstrainedSfoxClient(
        balances=[
            {"currency": "USD", "balance": "100"},
            {"currency": "USD", "balance": "0"},
            {"currency": "BTC", "balance": "0"},
            {"currency": "ETH", "balance": "0.0"},
        ]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert [r["symbol"] for r in rows] == ["USD"]
    assert rows[0]["value_usd"] == 100.0
    assert warning is None, (
        f"zero-balance assets are not skipped money; got {warning!r}"
    )


@pytest.mark.asyncio
async def test_sfox_unparseable_balance_is_skipped_not_valued(sfox_enabled):
    """[A3] no-invented-data: a null/NaN/garbage quantity has no honest USD
    value. It is skipped and NAMED (degrading the one asset) rather than
    coerced to 0.0 — a fabricated zero inside an AUM total — and rather than
    failing the whole key, which would drop the rest of a healthy book."""
    from services.allocator_positions import SFOX_UNPRICED_ASSETS_NOTE

    client = _SpecConstrainedSfoxClient(
        balances=[
            {"currency": "USD", "balance": "100"},
            {"currency": "USDC", "balance": None},
            {"currency": "USDT", "balance": "NaN"},
        ]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert [r["symbol"] for r in rows] == ["USD"]
    assert warning == SFOX_UNPRICED_ASSETS_NOTE.format(assets="USDC, USDT")


@pytest.mark.asyncio
async def test_sfox_malformed_row_is_named_not_dropped(sfox_enabled):
    """A non-dict element violates the row shape pinned by
    tests/test_sfox_client.py. It cannot be read, so it must not disappear
    silently — an asset the user holds that the sync quietly forgot is worse
    than one it names as skipped."""
    from services.allocator_positions import SFOX_UNPRICED_ASSETS_NOTE

    client = _SpecConstrainedSfoxClient(
        balances=[{"currency": "USD", "balance": "7"}, "not-a-row"]
    )

    rows, warning = await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert [r["symbol"] for r in rows] == ["USD"]
    assert warning == SFOX_UNPRICED_ASSETS_NOTE.format(assets="unknown")


@pytest.mark.asyncio
async def test_sfox_read_is_wall_clock_bounded(sfox_enabled, monkeypatch):
    """T-151-12 / WEDGE-01: the worker loop is SEQUENTIAL. A stalled sFOX read
    must hit a known ceiling and classify transient, never hold the loop."""
    from services.allocator_positions import (
        AllocatorHoldingsSyncTransientError,
        SFOX_FETCH_FAILED_NOTE,
    )

    monkeypatch.setattr(ap, "_SFOX_HOLDINGS_READ_TIMEOUT_S", 0.05)
    client = _SpecConstrainedSfoxClient(
        balances=[{"currency": "USD", "balance": "1"}], delay_s=0.6
    )

    with pytest.raises(AllocatorHoldingsSyncTransientError) as excinfo:
        await fetch_allocator_holdings("sfox", client, API_KEY_ID)

    assert str(excinfo.value) == SFOX_FETCH_FAILED_NOTE


# ===========================================================================
# 151-04 Task 2 — the CLASS-closure proof
# ===========================================================================
#
# Each probe returns (client, get_calls). Every arm is deliberately steered at
# its branch's WARNING path: the warning is the string that actually reaches
# `api_keys.sync_error`, so an arm that only exercised the happy path would
# assert the leak invariant against copy no user ever sees.

# A venue that DOES NOT EXIST. Chosen so the arm cannot have been special-cased
# anywhere in the production code — the only thing that can make it pass is the
# generic skip arm, which is what "the class is closed" means.
UNKNOWN_VENUE = "kraken-futures-hypothetical"


def _mt5_class_probe():
    """MT5 arm: a EUR account — the branch's honest-skip path."""
    transport = _RecordingMt5Transport(account=_account(currency="EUR"))
    return _session(transport), (lambda: list(transport.calls))


def _sfox_class_probe():
    """sFOX arm: a non-priceable asset — the branch's honest-skip path."""
    client = _SpecConstrainedSfoxClient(
        balances=[{"currency": "btc", "balance": "0.5"}]
    )
    return client, (lambda: list(client.calls))


def _unknown_class_probe():
    """Unknown-venue arm: buildable by a future factory branch, no fetcher."""
    client = _SpecConstrainedClient()
    return client, (lambda: [])


CLASS_PROBES = [
    ("mt5", _mt5_class_probe, MT5_NON_USD_NOTE.format(ccy="EUR")),
    ("sfox", _sfox_class_probe, SFOX_UNPRICED_ASSETS_NOTE.format(assets="BTC")),
    (
        UNKNOWN_VENUE,
        _unknown_class_probe,
        UNSUPPORTED_VENUE_NOTE.format(venue=UNKNOWN_VENUE.title()),
    ),
]


# ---------------------------------------------------------------------------
# Test 17 — THE class proof: one body, every non-ccxt venue
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "venue,make_probe,expected_warning",
    CLASS_PROBES,
    ids=["mt5", "sfox", "unknown-venue"],
)
async def test_non_ccxt_venue_class_is_closed(
    venue, make_probe, expected_warning, monkeypatch, mt5_enabled, sfox_enabled
):
    """THE class proof (AUM-02 + AUM-05). ONE test body over every non-ccxt
    venue — the live ones AND a venue that does not exist — asserting the three
    properties that together mean this defect class is closed:

      (a) the call either returns or raises ONLY
          AllocatorHoldingsSyncTransientError (any other exception type escapes
          to the handler's generic arm, which is what stamped the PROD
          AttributeError);
      (b) no ccxt method is ever invoked on the venue's client (the fakes are
          spec-constrained, so an attempt fails LOUD rather than being
          synthesized);
      (c) nothing the user can see — the returned warning or the raised
          exception's str() — contains a Python internal.

    The acceptance sentence this file exists to satisfy: "the same test shape
    passes for sFOX BEFORE its go-live flip". sFOX has no live key and no live
    API to observe, so a per-venue suite written after each flip would learn
    about the next venue's crash from a user's sync_error, exactly as MT5 did.
    """
    monkeypatch.setattr(
        ap, "NON_CCXT_VENUES", NON_CCXT_VENUES | {venue}, raising=True
    )
    client, get_calls = make_probe()

    warning: str | None = None
    raised: Exception | None = None
    # (a) Only the purpose-built transient may escape. Any other exception type
    # propagates out of this `try` and fails the test — deliberately NOT caught,
    # because "it raised something" is the defect, and swallowing it here would
    # reproduce the bug the module exists to prevent.
    try:
        rows, warning = await fetch_allocator_holdings(venue, client, API_KEY_ID)
    except ap.AllocatorHoldingsSyncTransientError as exc:
        raised = exc
    else:
        assert isinstance(rows, list)

    # (b) STRUCTURAL: the ccxt surface is not even present on these clients, so
    # the ccxt body could not have run against them silently.
    for name in CCXT_METHOD_NAMES:
        assert name not in dir(type(client)), (
            f"{venue}: the probe grew a ccxt surface ({name}) — the "
            "'never reached the ccxt body' assertion would be vacuous"
        )
    # ...and BEHAVIOURAL: nothing ccxt-shaped was actually called.
    assert CCXT_METHOD_NAMES.isdisjoint(get_calls()), (
        f"{venue}: a ccxt method was invoked on a non-ccxt client: {get_calls()}"
    )

    # (c) THE greppable UI-SPEC invariant (T-151-05 / T-151-10 / ASVS V7).
    user_visible = [s for s in (warning, str(raised) if raised else None) if s]
    assert user_visible, f"{venue}: the arm produced no user-visible outcome"
    for copy in user_visible:
        for banned in BANNED_INTERNALS:
            assert banned not in copy, (
                f"{venue}: {banned!r} leaked into user copy {copy!r}"
            )
        assert "—" in copy, f"{venue}: missing the em-dash copy pattern: {copy!r}"

    # And the arm reached ITS OWN branch, not a neighbour's. Without this the
    # whole parametrization would stay green with a venue's fetcher deleted —
    # the generic skip arm produces banned-substring-clean copy too.
    assert warning == expected_warning, (
        f"{venue}: expected its own branch's copy, got {warning!r}"
    )


# ---------------------------------------------------------------------------
# Test 18 — ECONOMIC ORACLE 5: two accounts, two rows, no collapse
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_two_accounts_under_one_allocator_do_not_collapse_on_upsert(
    mt5_enabled,
):
    """T-151-07 / Pitfall 1, proven at the WIRING (Rule 9), not on a helper.

    `allocator_holdings` is UNIQUE on (allocator_id, venue, symbol, asof) with
    NO api_key_id in the key. The founder runs THREE MT5 accounts under one
    allocator: if their rows shared a symbol, the upsert's ON CONFLICT would
    converge them to ONE row and AUM would report a single account's equity
    while the survivor's attribution flipped between syncs. So this drives the
    real `persist_allocator_holdings` against a mock supabase and asserts on
    the captured payload."""
    rows_a, warn_a = await fetch_allocator_holdings(
        "mt5",
        _session(_RecordingMt5Transport(account=_account(equity=111111.11))),
        API_KEY_ID,
    )
    rows_b, warn_b = await fetch_allocator_holdings(
        "mt5",
        _session(_RecordingMt5Transport(account=_account(equity=222222.22))),
        OTHER_API_KEY_ID,
    )

    assert warn_a is None and warn_b is None
    assert rows_a[0]["symbol"] != rows_b[0]["symbol"], (
        "two funded accounts must produce two DISTINCT symbols"
    )

    captured: dict[str, object] = {}
    mock_supabase = MagicMock()

    def _upsert(rows, on_conflict=None):  # noqa: ANN001
        captured["rows"] = rows
        captured["on_conflict"] = on_conflict
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=rows)
        return chain

    table = MagicMock()
    table.upsert.side_effect = _upsert
    mock_supabase.table.return_value = table

    written = await ap.persist_allocator_holdings(
        mock_supabase,
        rows_a + rows_b,
        allocator_id=ALLOCATOR_ID,
        api_key_id=API_KEY_ID,
        asof_date="2026-08-07",
    )

    assert written == 2
    upserted = captured["rows"]
    assert isinstance(upserted, list) and len(upserted) == 2, (
        f"both accounts must survive to the upsert: {upserted}"
    )

    # HAND LITERALS (economic-oracle discipline): never recomputed from the
    # implementation, so a branch that summed, averaged or dropped one account
    # turns this RED instead of agreeing with itself.
    assert sorted(r["value_usd"] for r in upserted) == [111111.11, 222222.22]

    # The conflict target is what actually decides collapse — so assert the two
    # rows differ in the KEY TUPLE, not merely in some field.
    assert captured["on_conflict"] == "allocator_id,venue,symbol,asof"
    keys = {
        (r["allocator_id"], r["venue"], r["symbol"], r["asof"]) for r in upserted
    }
    assert len(keys) == 2, (
        f"both rows landed on ONE conflict key — the upsert would keep one: {keys}"
    )


# ---------------------------------------------------------------------------
# Test 19 — the control arm: a ccxt venue is untouched by all of the above
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ccxt_venue_is_untouched_by_the_dispatch(mt5_enabled, sfox_enabled):
    """The class fix is ADDITIVE by construction: the dispatch is a prepend,
    and a venue in neither the fetcher table nor NON_CCXT_VENUES still falls
    through to the byte-unchanged ccxt body. Without this control arm the
    parametrized proof above could be satisfied by a dispatch that swallowed
    every venue — including the ones that sync fine today."""
    assert "binance" not in NON_CCXT_VENUES
    assert "binance" not in ap._NON_CCXT_HOLDINGS_FETCHERS

    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 4200.0}})
    exchange.fetch_positions = AsyncMock(return_value=[])

    rows, warning = await fetch_allocator_holdings("binance", exchange, API_KEY_ID)

    exchange.fetch_balance.assert_awaited_once()
    assert warning is None
    assert [r["symbol"] for r in rows] == ["USDT"]
    assert rows[0]["value_usd"] == 4200.0
