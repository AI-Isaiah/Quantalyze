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
