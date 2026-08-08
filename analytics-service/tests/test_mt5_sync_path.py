"""MT5SYNC hotfix (2026-08-06) — regression tests for the KEY-SYNC path
receiving an ``Mt5Session``.

PROD defect: v1.15 (Phase 136) isinstance-routed the DERIVE branch only
(``run_derive_broker_dailies_job``). The KEY-SYNC path still called
ccxt-shaped members on the mt5 holder:

  * ``fetch_allocator_holdings`` → ``_fetch_spot_rows`` →
    ``exchange.fetch_balance()`` → AttributeError
    "'Mt5Session' object has no attribute 'fetch_balance'" → the generic
    ``except Exception`` in ``run_poll_allocator_positions_job`` stamped
    every founder MT5 key ``api_keys.sync_status='error'`` on the daily
    ``enqueue_poll_allocator_positions_for_all_keys`` fan-out (PROD census
    2026-08-05: all 3 founder MT5 keys at sync_status='error').
  * ``run_sync_trades_job`` → ``fetch_all_trades`` → ``fetch_daily_pnl`` →
    ``exchange.id`` → AttributeError "'Mt5Session' object has no attribute
    'id'" (Sentry QUANTALYZE-K).

These are WIRING tests (Rule 9 / test-the-call-site discipline, mirroring
tests/test_mt5_derive_branch.py): they drive the REAL sync handlers with an
offline ``Mt5Session`` built over the ``Mt5Client`` ``_connect`` injection
seam (no ``mt5linux``, no network, no terminal). Pre-fix, the handler tests
fail with exactly the two PROD AttributeErrors above.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

import services.job_worker as jw
from services.allocator_positions import fetch_allocator_holdings
from services.closed_sets import MT5_DISABLED_DETAIL
from services.job_worker import DispatchOutcome
from services.mt5_client import Mt5Client, Mt5Session


ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000aa"
API_KEY_ID = "00000000-0000-0000-0000-000000000001"
EXPECTED_LOGIN = 123456
# Hand literals (oracle discipline): equity ≠ balance so an equity/balance
# swap in the routed read turns the assertion RED.
ACCOUNT_EQUITY = 50_123.45
ACCOUNT_BALANCE = 50_000.0


# ---------------------------------------------------------------------------
# Offline transport double (the mt5_client.py _connect injection seam) —
# minimal subset of tests/test_mt5_derive_branch.py's _FakeMt5Transport.
# ---------------------------------------------------------------------------
class _NT:
    """A netref-namedtuple stand-in: Mt5Client._materialize requires ._asdict()."""

    def __init__(self, d: dict) -> None:
        self._d = dict(d)

    def _asdict(self) -> dict:
        return dict(self._d)


class _FakeMt5Transport:
    """Records every call so 'zero terminal IPC' assertions are falsifiable."""

    def __init__(self, *, account: dict) -> None:
        self._account = account
        self.calls: list[str] = []

    def initialize(self, **kwargs):
        # **kwargs: initialize() carries its own `timeout=` ms ceiling (153.3 / D-24).
        self.calls.append("initialize")
        return True

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        self.calls.append("login")
        return True

    def account_info(self):
        self.calls.append("account_info")
        return _NT(self._account)

    def history_deals_get(self, from_ts, to_ts):  # noqa: ANN001
        self.calls.append("history_deals_get")
        return ()

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


def _session(transport: _FakeMt5Transport) -> Mt5Session:
    def _connect(*, host, port, timeout):  # noqa: ANN001
        return transport

    client = Mt5Client("h", 1, _connect=_connect)
    return Mt5Session(
        client=client,
        login=EXPECTED_LOGIN,
        investor_password="pw",
        server="Broker-Live",
    )


# ---------------------------------------------------------------------------
# 1 — fetch_allocator_holdings: mt5 dispatches away from ccxt, never crashes
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_fetch_allocator_holdings_mt5_dark_skips_without_terminal_ipc(
    monkeypatch,
):
    """Pre-hotfix: AttributeError "'Mt5Session' object has no attribute
    'fetch_balance'" from _fetch_spot_rows — the exact PROD sync_error.

    The hotfix returned a silent ([], None) no-op. Phase 151 (AUM-02) replaced
    it with venue dispatch, so mt5 can never reach the ccxt body. With the
    go-dark flag OFF the branch skips at the kill switch with END-USER copy and
    ZERO terminal IPC — never a pretend-success, never a crash."""
    monkeypatch.delenv("MT5_ENABLED", raising=False)
    transport = _FakeMt5Transport(account=_account())

    rows, warning = await fetch_allocator_holdings("mt5", _session(transport))

    assert rows == []
    assert warning == MT5_DISABLED_DETAIL
    assert transport.calls == [], (
        "the mt5 holdings skip must not perform any terminal IPC; "
        f"observed {transport.calls}"
    )


@pytest.mark.asyncio
async def test_fetch_allocator_holdings_mt5_enabled_reads_account_equity(
    monkeypatch,
):
    """AUM-02, the substantive fix: with MT5 live, an MT5 key CONTRIBUTES —
    one account-equity row read through login + account_info, never a ccxt
    surface and never the deal ledger."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(account=_account())

    rows, warning = await fetch_allocator_holdings(
        "mt5", _session(transport), API_KEY_ID
    )

    assert warning is None
    assert len(rows) == 1
    assert rows[0]["venue"] == "mt5"
    assert rows[0]["value_usd"] == pytest.approx(ACCOUNT_EQUITY)
    assert rows[0]["value_usd"] != pytest.approx(ACCOUNT_BALANCE)
    assert "login" in transport.calls
    assert "account_info" in transport.calls
    assert "history_deals_get" not in transport.calls


# ---------------------------------------------------------------------------
# 2 — run_poll_allocator_positions_job: an mt5 key reaches a SUCCESS status
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_run_poll_allocator_positions_job_mt5_reaches_complete(
    monkeypatch, api_key_row_factory
):
    """The daily fan-out handler must complete for a healthy MT5 key:
    sync_status='complete' + last_sync_at stamped — never the pre-hotfix
    sync_status='error' with the fetch_balance AttributeError.

    Phase 151 (AUM-02) makes this a REAL sync rather than a no-op completion:
    the key's account equity is read and persisted, so an MT5 account actually
    contributes to the allocator's book."""
    from services import audit as audit_module

    monkeypatch.setenv("MT5_ENABLED", "true")

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="mt5"
    )
    transport = _FakeMt5Transport(account=_account())

    mock_supabase = MagicMock()
    updates: list[tuple[str, dict]] = []

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
        exchange=_session(transport),
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)
    monkeypatch.setattr(audit_module, "log_audit_event", MagicMock())

    job = {
        "id": "job-1",
        "kind": "poll_allocator_positions",
        "api_key_id": API_KEY_ID,
    }

    result = await jw.run_poll_allocator_positions_job(job)

    assert result.outcome == DispatchOutcome.DONE, (
        f"expected DONE, got {result.outcome} / {result.error_message}"
    )
    api_key_updates = [p for (name, p) in updates if name == "api_keys"]
    assert api_key_updates, "expected an api_keys status update"
    final = api_key_updates[-1]
    assert final["sync_status"] == "complete"
    assert final.get("sync_error") is None
    assert final.get("last_sync_at"), "last_sync_at must be stamped on success"


# ---------------------------------------------------------------------------
# 3 — run_sync_trades_job: mt5 routes balance to account_info, skips ccxt
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_run_sync_trades_job_mt5_routes_balance_and_skips_ccxt(monkeypatch):
    """Pre-fix: AttributeError "'Mt5Session' object has no attribute 'id'"
    from fetch_all_trades → fetch_daily_pnl (Sentry QUANTALYZE-K). Post-fix:
    the mt5 arm reads equity via the Mt5Client login+account_info path,
    persists it through advance_sync_cursor (account_balance_usdt +
    last_sync_at), never calls the sync_trades RPC (no ccxt daily-PnL rows
    exist for mt5), and still enqueues the derive_broker_dailies follow-on
    (the SINGLE mt5 deal-ledger read path from Phase 136)."""
    transport = _FakeMt5Transport(account=_account())

    mock_supabase = MagicMock()
    rpc_calls: list[tuple[str, dict]] = []

    def _rpc(name: str, payload: dict) -> MagicMock:
        rpc_calls.append((name, payload))
        stub = MagicMock()
        stub.execute.return_value = MagicMock(data=True)
        return stub

    mock_supabase.rpc.side_effect = _rpc
    # strategy_analytics flag reads/writes (only reached when raw-trade
    # ingestion is enabled) — inert chain.
    tbl = MagicMock()
    tbl.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=None
    )
    tbl.upsert.return_value.execute.return_value = MagicMock(data=1)
    mock_supabase.table.return_value = tbl

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row={"id": "strat-mt5", "user_id": "u1"},
        key_row={
            "id": "key-mt5",
            "user_id": "u1",
            "exchange": "mt5",
            "last_sync_at": None,
            "last_fetched_trade_timestamp": None,
        },
        exchange=_session(transport),
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_exchange_preflight", _fake_preflight)

    job = {"id": "job-1", "kind": "sync_trades", "strategy_id": "strat-mt5"}

    result = await jw.run_sync_trades_job(job)

    assert result.outcome == DispatchOutcome.DONE, (
        f"expected DONE, got {result.outcome} / {result.error_message}"
    )
    assert result.trade_count == 0

    # The routed read reached the terminal via login + account_info —
    # NEVER a ccxt fetch surface.
    assert "login" in transport.calls
    assert "account_info" in transport.calls
    assert "history_deals_get" not in transport.calls, (
        "sync_trades must not mint a second mt5 deal-ledger read path — "
        "the deal fetch belongs to run_derive_broker_dailies_job"
    )

    by_name = {name: payload for (name, payload) in rpc_calls}
    assert "sync_trades" not in by_name, (
        "no ccxt daily-PnL rows exist for mt5 — the sync_trades RPC must not run"
    )
    advance = by_name.get("advance_sync_cursor")
    assert advance is not None, f"expected advance_sync_cursor, got {rpc_calls}"
    assert advance["p_account_balance"] == pytest.approx(ACCOUNT_EQUITY)
    assert advance["p_last_sync_at"] is not None

    follow_on = by_name.get("enqueue_compute_job")
    assert follow_on is not None, "expected the derive_broker_dailies follow-on"
    assert follow_on["p_kind"] == "derive_broker_dailies"


# ---------------------------------------------------------------------------
# 4/5/6 — _fetch_mt5_account_balance edge discipline
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_fetch_mt5_account_balance_returns_equity():
    """account_info().equity (balance + floating uPnL — the v1.8 MT5
    convention the derive anchor uses) is the account_balance_usdt analog."""
    transport = _FakeMt5Transport(account=_account())
    value = await jw._fetch_mt5_account_balance(_session(transport))
    assert value == pytest.approx(ACCOUNT_EQUITY)


@pytest.mark.asyncio
async def test_fetch_mt5_account_balance_refuses_mismatched_login():
    """MT5CONC-02 login bracket: a mis-routed terminal presenting a DIFFERENT
    account must NEVER have its equity stamped onto this key — best-effort
    None, sync continues without a balance snapshot."""
    transport = _FakeMt5Transport(account=_account(login=999_999))
    value = await jw._fetch_mt5_account_balance(_session(transport))
    assert value is None


@pytest.mark.asyncio
async def test_fetch_mt5_account_balance_refuses_non_finite():
    """A NaN/Inf equity is a poisoned snapshot — refuse it (None), mirroring
    the derive branch's non-finite anchor refusal."""
    transport = _FakeMt5Transport(account=_account(equity=float("nan")))
    value = await jw._fetch_mt5_account_balance(_session(transport))
    assert value is None


@pytest.mark.asyncio
async def test_fetch_mt5_account_balance_read_error_is_best_effort_none(monkeypatch):
    """A transport raise mirrors fetch_usdt_balance's swallow-with-warning
    ccxt contract: None, never a job-failing raise (the balance snapshot is
    advisory; the derive follow-on owns the load-bearing equity read)."""
    transport = _FakeMt5Transport(account=_account())

    def _boom():
        raise RuntimeError("wedged pipe")

    transport.account_info = _boom  # type: ignore[method-assign]
    value = await jw._fetch_mt5_account_balance(_session(transport))
    assert value is None
