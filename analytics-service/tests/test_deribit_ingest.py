"""Deribit ledger I/O tests (P70 70-03) — the txn-log cash-delta ledger backbone.

CI-runnable, network-free: every exchange is a synthetic stub and the pace/backoff
clock is an injected sleep-spy, so no real time passes and no creds are needed.

The corruption risk this whole plan exists to kill is a SILENTLY-PARTIAL ledger —
a rate-limit-truncated or scope-skipped crawl that renders as a complete track
record. Every test below is RED-first + revert-proof against that failure.
"""
from __future__ import annotations

import inspect
from typing import Any

import pytest

from services import deribit_ingest as di


# ---------------------------------------------------------------------------
# Stub exchange helpers.
# ---------------------------------------------------------------------------


class _SleepSpy:
    """Records every awaited sleep duration; never actually sleeps."""

    def __init__(self) -> None:
        self.waits: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.waits.append(float(seconds))


class _DeribitError(Exception):
    """ccxt-shaped error carrying a Deribit error code in its message + .code."""

    def __init__(self, code: int, message: str = "") -> None:
        self.code = code
        super().__init__(f"deribit error {code}: {message}")


def _txn_page(logs: list[dict[str, Any]], continuation: Any) -> dict[str, Any]:
    return {"result": {"logs": logs, "continuation": continuation}}


class _TxnLogStub:
    """Serves a scripted sequence of get_transaction_log pages / errors."""

    def __init__(self, script: list[Any]) -> None:
        self._script = list(script)
        self.calls: list[dict[str, Any]] = []

    async def private_get_get_transaction_log(self, params: dict[str, Any]) -> Any:
        self.calls.append(dict(params))
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


# ---------------------------------------------------------------------------
# paginate_txn_log — continuation-to-null.
# ---------------------------------------------------------------------------


async def test_paginate_txn_log_follows_continuation_to_null() -> None:
    stub = _TxnLogStub(
        [
            _txn_page([{"id": 1}, {"id": 2}], 5),
            _txn_page([{"id": 3}], 9),
            _txn_page([{"id": 4}], None),
        ]
    )
    spy = _SleepSpy()
    rows = await di.paginate_txn_log(
        stub, "main", "BTC", 0, 100, {}, sleep=spy
    )
    # ALL rows once, in order, and STOPPED at continuation=null (3 pages only).
    assert [r["id"] for r in rows] == [1, 2, 3, 4]
    assert len(stub.calls) == 3
    # count=250 (documented max) on every request.
    assert all(call["count"] == 250 for call in stub.calls)
    # continuation threaded forward (page 2 carried continuation=5, page 3 =9).
    assert stub.calls[1]["continuation"] == 5
    assert stub.calls[2]["continuation"] == 9


async def test_paginate_txn_log_paces_one_per_sec() -> None:
    stub = _TxnLogStub(
        [
            _txn_page([{"id": 1}], 5),
            _txn_page([{"id": 2}], None),
        ]
    )
    spy = _SleepSpy()
    await di.paginate_txn_log(stub, "main", "BTC", 0, 100, {}, sleep=spy)
    # A pacing wait separated the two page requests (~1 req/s). Revert-proof:
    # remove the pace call and the spy sees no wait between pages.
    assert any(w >= di.LEDGER_PACE_SECONDS for w in spy.waits)


async def test_paginate_txn_log_backs_off_on_10028_then_completes() -> None:
    stub = _TxnLogStub(
        [
            _DeribitError(10028, "too_many_requests"),
            _DeribitError(10028, "too_many_requests"),
            _txn_page([{"id": 1}], None),
        ]
    )
    spy = _SleepSpy()
    rows = await di.paginate_txn_log(stub, "main", "BTC", 0, 100, {}, sleep=spy)
    # Reached continuation=null with the full row set despite two 10028s.
    assert [r["id"] for r in rows] == [1]
    # Exponential backoff: the two retry waits are strictly increasing.
    backoffs = [w for w in spy.waits if w >= di.LEDGER_BACKOFF_BASE_SECONDS]
    assert len(backoffs) >= 2
    assert backoffs[1] > backoffs[0]


async def test_paginate_txn_log_truncation_fails_loud() -> None:
    # 10028 beyond the retry budget → must RAISE, never return partial pages.
    stub = _TxnLogStub([_DeribitError(10028)] * 10)
    spy = _SleepSpy()
    with pytest.raises(di.LedgerTruncatedError) as exc:
        await di.paginate_txn_log(
            stub, "sub_1", "ETH", 0, 100, {}, sleep=spy, max_retries=3
        )
    # Names the scope + currency so the operator can see exactly what truncated.
    msg = str(exc.value)
    assert "sub_1" in msg and "ETH" in msg


async def test_paginate_txn_log_non_10028_error_propagates() -> None:
    # A non-rate-limit error (e.g. -32602) is NOT backed off — it surfaces so the
    # producer can decide (currency skip vs fail loud).
    stub = _TxnLogStub([_DeribitError(-32602, "not a margin currency")])
    spy = _SleepSpy()
    with pytest.raises(_DeribitError) as exc:
        await di.paginate_txn_log(stub, "main", "SOL", 0, 100, {}, sleep=spy)
    assert exc.value.code == -32602


async def test_paginate_txn_log_merges_scope_auth_into_params() -> None:
    stub = _TxnLogStub([_txn_page([{"id": 1}], None)])
    spy = _SleepSpy()
    await di.paginate_txn_log(
        stub, "sub_1", "BTC", 0, 100, {"access_token": "tok_sub"}, sleep=spy
    )
    assert stub.calls[0]["access_token"] == "tok_sub"


# ---------------------------------------------------------------------------
# Scope enumeration + per-scope auth.
# ---------------------------------------------------------------------------


class _ScopeStub:
    def __init__(
        self,
        *,
        subaccounts: Any = None,
        exchange_token: Any = None,
    ) -> None:
        self._subaccounts = subaccounts
        self._exchange_token = exchange_token
        self.exchange_token_params: list[dict[str, Any]] = []

    async def private_get_get_subaccounts(self, params: dict[str, Any]) -> Any:
        return self._subaccounts

    async def public_get_exchange_token(self, params: dict[str, Any]) -> Any:
        self.exchange_token_params.append(dict(params))
        if isinstance(self._exchange_token, Exception):
            raise self._exchange_token
        return self._exchange_token


async def test_enumerate_scopes_main_first_ids_are_strings() -> None:
    stub = _ScopeStub(
        subaccounts={"result": [{"id": "101"}, {"id": "102"}]}
    )
    scopes = await di.enumerate_scopes(stub)
    assert scopes[0].is_main is True
    assert scopes[0].subaccount_id is None
    subs = scopes[1:]
    assert [s.subaccount_id for s in subs] == ["101", "102"]
    # ids preserved as STRINGS (Wave-0: get_subaccounts returns id as a string).
    assert all(isinstance(s.subaccount_id, str) for s in subs)


async def test_resolve_scope_auth_main_uses_own_key() -> None:
    stub = _ScopeStub()
    main = di.Scope(label="main", subaccount_id=None, is_main=True)
    auth = await di.resolve_scope_auth(stub, main)
    # Main scope signs with the key itself — no minted token, no subaccount_id.
    assert "access_token" not in auth


async def test_resolve_scope_auth_uses_exchange_token() -> None:
    stub = _ScopeStub(
        exchange_token={"result": {"access_token": "tok_sub_101"}}
    )
    sub = di.Scope(label="sub_1", subaccount_id="101", is_main=False)
    auth = await di.resolve_scope_auth(stub, sub)
    # Minted a subject token via public/exchange_token (param subject_id).
    assert auth["access_token"] == "tok_sub_101"
    assert stub.exchange_token_params[0]["subject_id"] == "101"


async def test_resolve_scope_auth_fails_loud_when_unresolvable() -> None:
    # exchange_token returns no token → the scope CANNOT be authed → fail loud
    # (a silently-skipped scope is a silent under-fetch).
    stub = _ScopeStub(exchange_token={"result": {}})
    sub = di.Scope(label="sub_1", subaccount_id="101", is_main=False)
    with pytest.raises(di.ScopeAuthError):
        await di.resolve_scope_auth(stub, sub)


# ---------------------------------------------------------------------------
# Currency enumeration — from the account, never hard-coded.
# ---------------------------------------------------------------------------


class _CurrencyStub:
    def __init__(self, *, summaries: Any = None, currencies: Any = None) -> None:
        self._summaries = summaries
        self._currencies = currencies

    async def private_get_get_account_summaries(self, params: dict[str, Any]) -> Any:
        if isinstance(self._summaries, Exception):
            raise self._summaries
        return self._summaries

    async def public_get_get_currencies(self) -> Any:
        return self._currencies


async def test_enumerate_currencies_from_account_not_hardcoded() -> None:
    stub = _CurrencyStub(
        summaries={
            "result": {
                "summaries": [
                    {"currency": "BTC", "equity": 0.5},
                    {"currency": "ETH", "balance": 2.0},
                    {"currency": "USDC", "equity": 0.0, "balance": 0.0},
                ]
            }
        }
    )
    main = di.Scope(label="main", subaccount_id=None, is_main=True)
    ccys = await di.enumerate_currencies(stub, main, {})
    # Only currencies with a nonzero held balance/equity; from the account, not
    # a literal list. USDC (zero) is excluded.
    assert ccys == ["BTC", "ETH"]


async def test_enumerate_currencies_falls_back_to_get_currencies() -> None:
    stub = _CurrencyStub(
        summaries={"result": {"summaries": []}},
        currencies={"result": [{"currency": "BTC"}, {"currency": "ETH"}]},
    )
    main = di.Scope(label="main", subaccount_id=None, is_main=True)
    ccys = await di.enumerate_currencies(stub, main, {})
    assert ccys == ["BTC", "ETH"]


# ===========================================================================
# Task 2 — the scope×currency producer + the re-anchored D-02 completeness gate.
# ===========================================================================

# 2024-01-02 00:00:00 UTC in ms — a fixed "day D" for the cross-scope net test.
_DAY_D_MS = 1_704_153_600_000


def _patch_pipeline(
    monkeypatch: Any,
    *,
    scopes: list[di.Scope],
    currencies: dict[str, list[str]],
    paginate: Callable[..., Awaitable[list[Any]]],
    auth: Callable[..., Awaitable[dict[str, Any]]] | None = None,
) -> None:
    """Monkeypatch the four I/O primitives the producer composes."""

    async def _enumerate_scopes(_exchange: Any) -> list[di.Scope]:
        return scopes

    async def _resolve_scope_auth(_exchange: Any, scope: di.Scope) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(
        _exchange: Any, scope: di.Scope, _auth: Any
    ) -> list[str]:
        return currencies[scope.label]

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", auth or _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", paginate)


async def test_ledger_producer_loops_scope_x_currency(monkeypatch: Any) -> None:
    scopes = [
        di.Scope("main", None, True),
        di.Scope("sub_1", "101", False),
        di.Scope("sub_2", "102", False),
    ]
    calls: list[tuple[str, str]] = []

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        calls.append((scope_label, currency))
        return [{"type": "settlement", "currency": "USDC", "cashflow": 1.0,
                 "timestamp": _DAY_D_MS}]

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC", "ETH"], "sub_1": ["BTC", "ETH"],
                    "sub_2": ["BTC", "ETH"]},
        paginate=_paginate,
    )
    records, report = await di.fetch_deribit_ledger_daily_records(object())
    # paginate called once per (scope, currency) = 3 × 2 = 6.
    assert len(calls) == 6
    assert len(report.entries) == 6
    assert all(e["reached_end"] for e in report.entries.values())
    # daily_records accumulated from every scope×currency crawl.
    assert records
    # The gate passes when everything reached continuation=null.
    di.assert_ledger_complete(report)


async def test_cross_scope_opposite_sign_nets_signed(monkeypatch: Any) -> None:
    from services.transforms import trades_to_daily_returns_with_status

    scopes = [di.Scope("main", None, True), di.Scope("sub_1", "101", False)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        # Same UTC day D, opposite signs across scopes (linear/USD passthrough).
        cash = 100.0 if scope_label == "main" else -30.0
        return [{"type": "settlement", "currency": "USDC", "cashflow": cash,
                 "timestamp": _DAY_D_MS}]

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC"], "sub_1": ["BTC"]},
        paginate=_paginate,
    )
    records, _report = await di.fetch_deribit_ledger_daily_records(object())
    # CONCATENATED: two sign-encoded records for day D (+100 buy, −30 sell),
    # NOT one abs-summed 130 record.
    assert len(records) == 2
    returns, _meta = trades_to_daily_returns_with_status(
        records, account_balance=100_000.0
    )
    # Net signed day-D return is +70/(100000-70), NOT 130/(...). An abs-sum
    # producer (single 130 record) turns this red.
    assert returns.iloc[0] == pytest.approx(70.0 / (100_000.0 - 70.0))


async def test_completeness_gate_passes_when_all_reached_end() -> None:
    report = di.CompletenessReport(
        expected={"main": ["BTC"], "sub_1": ["BTC"]},
        entries={
            ("main", "BTC"): {"reached_end": True, "rows": 3},
            ("sub_1", "BTC"): {"reached_end": True, "rows": 2},
        },
    )
    di.assert_ledger_complete(report)  # no raise


async def test_completeness_gate_fails_loud_on_missing_scope() -> None:
    # sub_1 is EXPECTED but its crawl never produced an entry (dropped scope) →
    # the re-anchored D-02 gate raises, naming the missing scope×currency.
    report = di.CompletenessReport(
        expected={"main": ["BTC"], "sub_1": ["BTC"]},
        entries={("main", "BTC"): {"reached_end": True, "rows": 3}},
    )
    with pytest.raises(di.LedgerCompletenessError) as exc:
        di.assert_ledger_complete(report)
    assert "sub_1" in str(exc.value) and "BTC" in str(exc.value)


async def test_truncation_propagates_as_incomplete(monkeypatch: Any) -> None:
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "ETH":
            raise di.LedgerTruncatedError("truncated main/ETH")
        return [{"type": "settlement", "currency": "USDC", "cashflow": 1.0,
                 "timestamp": _DAY_D_MS}]

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC", "ETH"]},
        paginate=_paginate,
    )
    _records, report = await di.fetch_deribit_ledger_daily_records(object())
    # The truncated pair is recorded incomplete and the gate REFUSES to pass it.
    assert report.entries[("main", "ETH")]["reached_end"] is False
    with pytest.raises(di.LedgerCompletenessError):
        di.assert_ledger_complete(report)


async def test_minus_32602_skip_leaves_incomplete(monkeypatch: Any) -> None:
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "SOL":
            raise _DeribitError(-32602, "not a margin currency")
        return [{"type": "settlement", "currency": "USDC", "cashflow": 1.0,
                 "timestamp": _DAY_D_MS}]

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC", "SOL"]},
        paginate=_paginate,
    )
    _records, report = await di.fetch_deribit_ledger_daily_records(object())
    # A graceful -32602 currency skip is NOT complete — it cannot masquerade as
    # a full crawl (D-14).
    assert report.entries[("main", "SOL")]["reached_end"] is False
    with pytest.raises(di.LedgerCompletenessError):
        di.assert_ledger_complete(report)


async def test_producer_reraises_unexpected_error(monkeypatch: Any) -> None:
    # A non-10028, non-(-32602) error is NOT swallowed as a skip — it fails loud.
    scopes = [di.Scope("main", None, True)]

    async def _paginate(*_a: Any, **_k: Any) -> list[Any]:
        raise _DeribitError(13004, "invalid credentials")

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC"]},
        paginate=_paginate,
    )
    with pytest.raises(_DeribitError):
        await di.fetch_deribit_ledger_daily_records(object())


def test_gate_is_not_fill_count_reconciliation() -> None:
    # Structural: the gate takes ONLY the report — no fill-count total. The
    # Wave-0 BLOCKING_FINDING proved 18,778/21,014/61,248 reconcile to no API
    # surface, so completeness — not reconciliation — is the honesty anchor.
    params = list(inspect.signature(di.assert_ledger_complete).parameters)
    assert params == ["report"]
    lowered = " ".join(params).lower()
    assert "total" not in lowered and "count" not in lowered and "known" not in lowered


# ===========================================================================
# 70-04 Task 1 — the SECONDARY trades axis: id-cursor fill fetch + FillRow map.
#
# This axis is execution detail + an ADVISORY fill-count cross-check — NOT the
# returns source (returns come from the txn-log ledger above). Every test is
# RED-first + revert-proof against the Wave-0 one-page-stall (bug #2) and the
# 24h-cap (bug #1: without historical=true the endpoint returns only 24h).
# ===========================================================================


def _trades_page(trades: list[dict[str, Any]], has_more: bool) -> dict[str, Any]:
    return {"result": {"trades": trades, "has_more": has_more}}


class _TradesStub:
    """Serves a scripted sequence of get_user_trades_by_currency pages / errors."""

    def __init__(self, script: list[Any]) -> None:
        self._script = list(script)
        self.calls: list[dict[str, Any]] = []

    async def private_get_get_user_trades_by_currency(
        self, params: dict[str, Any]
    ) -> Any:
        self.calls.append(dict(params))
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _trade(trade_id: str) -> dict[str, Any]:
    return {
        "trade_id": trade_id,
        "instrument_name": "BTC-PERPETUAL",
        "direction": "buy",
        "price": 100.0,
        "amount": 1.0,
        "timestamp": 1_720_000_000_000,
        "fee": 0.0,
        "fee_currency": "BTC",
        "order_id": "ord",
    }


async def test_id_cursor_advances_start_id() -> None:
    # page1 FULL (len==count==2, last trade_id "T1"), page2 partial has_more=false
    # → page2 requested with start_id="T1", then STOP. No dup, no re-fetch of T1.
    stub = _TradesStub(
        [
            _trades_page([_trade("T0"), _trade("T1")], has_more=True),
            _trades_page([_trade("T2")], has_more=False),
        ]
    )
    spy = _SleepSpy()
    rows = await di.paginate_trades_id_cursor(stub, "BTC", {}, count=2, sleep=spy)
    assert [r["trade_id"] for r in rows] == ["T0", "T1", "T2"]
    assert len(stub.calls) == 2
    assert "start_id" not in stub.calls[0]  # initial page has no cursor
    assert stub.calls[1]["start_id"] == "T1"  # advanced to last of page1


async def test_id_cursor_continue_while_full_even_if_has_more_false() -> None:
    # A FULL page (len==count) with has_more=false STILL fetches the next page —
    # has_more has no documented reliability guarantee (Wave-0). Relying solely on
    # has_more would drop A3 → this test goes red if the loop stops on has_more.
    stub = _TradesStub(
        [
            _trades_page([_trade("A1"), _trade("A2")], has_more=False),
            _trades_page([_trade("A3")], has_more=False),
        ]
    )
    spy = _SleepSpy()
    rows = await di.paginate_trades_id_cursor(stub, "ETH", {}, count=2, sleep=spy)
    assert [r["trade_id"] for r in rows] == ["A1", "A2", "A3"]
    assert len(stub.calls) == 2


async def test_id_cursor_dedups_boundary_trade_id() -> None:
    # start_id is EXCLUSIVE but Deribit may re-include the boundary trade — the
    # paginator must not double-count it. page2 re-serves "B2" (the page1 last)
    # plus a new "B3"; only one "B2" survives.
    stub = _TradesStub(
        [
            _trades_page([_trade("B1"), _trade("B2")], has_more=True),
            _trades_page([_trade("B2"), _trade("B3")], has_more=False),
        ]
    )
    spy = _SleepSpy()
    rows = await di.paginate_trades_id_cursor(stub, "BTC", {}, count=2, sleep=spy)
    assert [r["trade_id"] for r in rows] == ["B1", "B2", "B3"]


def test_history_true_param_present() -> None:
    # historical=true + sorting=asc ALWAYS (omitting historical caps at 24h —
    # Wave-0 bug #1); start_id present only when advancing.
    params = di._build_trades_params("BTC", 1000)
    assert params["historical"] == "true"
    assert params["sorting"] == "asc"
    assert params["currency"] == "BTC"
    assert params["count"] == 1000
    assert "start_id" not in params
    advanced = di._build_trades_params("BTC", 1000, start_id="Z9")
    assert advanced["start_id"] == "Z9"


def test_trade_to_fillrow_sets_exchange_fill_id() -> None:
    trade = {
        "trade_id": "ETH-42",
        "instrument_name": "ETH-PERPETUAL",
        "direction": "sell",
        "price": 2000.0,
        "amount": 10.0,
        "timestamp": 1_720_000_000_000,
        "fee": 0.5,
        "fee_currency": "ETH",
        "order_id": "ord-1",
    }
    row = di._trade_to_fillrow(trade)
    # exchange_fill_id = Deribit trade_id → diff_strategy_fills PK dedup axis.
    assert row["exchange_fill_id"] == "ETH-42"
    assert row["exchange"] == "deribit"
    assert row["side"] == "sell"
    # Monetary fields are EXACT numeric strings (H-0669), never floats.
    assert row["price"] == "2000.0"
    assert row["quantity"] == "10.0"
    assert isinstance(row["price"], str) and isinstance(row["quantity"], str)
    assert row["timestamp"].startswith("2024-")  # ISO event time
    assert row["is_fill"] is True


async def test_minus_32602_skips_currency(monkeypatch: Any) -> None:
    # A -32602 "not supported for wallet type" on one currency is skipped (0 rows,
    # scrubbed-logged) while others still fetch — never swallowed silently.
    calls: list[str] = []

    async def _enum_scopes(_ex: Any) -> list[di.Scope]:
        return [di.Scope("main", None, True)]

    async def _auth(_ex: Any, _s: di.Scope) -> dict[str, Any]:
        return {}

    async def _enum_ccy(_ex: Any, _s: di.Scope, _a: Any) -> list[str]:
        return ["BTC", "SOL"]

    async def _paginate(
        _ex: Any, currency: str, _scope_auth: Any, **_k: Any
    ) -> list[Any]:
        calls.append(currency)
        if currency == "SOL":
            raise _DeribitError(-32602, "not supported for wallet type")
        return [_trade("B1")]

    monkeypatch.setattr(di, "enumerate_scopes", _enum_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enum_ccy)
    monkeypatch.setattr(di, "paginate_trades_id_cursor", _paginate)
    fills = await di.fetch_deribit_fills(object(), None)
    assert calls == ["BTC", "SOL"]  # SOL was attempted, not pre-filtered
    assert len(fills) == 1  # only BTC produced a fill; SOL skipped gracefully
    assert fills[0]["exchange_fill_id"] == "B1"


async def test_fetch_deribit_fills_reuses_scope_auth(monkeypatch: Any) -> None:
    # Subaccount fills are reachable because the fetch reuses the 70-03 per-scope
    # auth (resolve_scope_auth) — the minted token flows into paginate.
    seen_auth: list[Any] = []

    async def _enum_scopes(_ex: Any) -> list[di.Scope]:
        return [di.Scope("sub_1", "101", False)]

    async def _auth(_ex: Any, scope: di.Scope) -> dict[str, Any]:
        return {"access_token": "tok_sub_101"}

    async def _enum_ccy(_ex: Any, _s: di.Scope, _a: Any) -> list[str]:
        return ["BTC"]

    async def _paginate(
        _ex: Any, currency: str, scope_auth: Any, **_k: Any
    ) -> list[Any]:
        seen_auth.append(scope_auth)
        return [_trade("S1")]

    monkeypatch.setattr(di, "enumerate_scopes", _enum_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enum_ccy)
    monkeypatch.setattr(di, "paginate_trades_id_cursor", _paginate)
    fills = await di.fetch_deribit_fills(object(), None)
    assert seen_auth == [{"access_token": "tok_sub_101"}]
    assert len(fills) == 1
