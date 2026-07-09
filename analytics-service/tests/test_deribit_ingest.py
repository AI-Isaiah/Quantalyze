"""Deribit ledger I/O tests (P70 70-03) — the txn-log cash-delta ledger backbone.

CI-runnable, network-free: every exchange is a synthetic stub and the pace/backoff
clock is an injected sleep-spy, so no real time passes and no creds are needed.

The corruption risk this whole plan exists to kill is a SILENTLY-PARTIAL ledger —
a rate-limit-truncated or scope-skipped crawl that renders as a complete track
record. Every test below is RED-first + revert-proof against that failure.
"""
from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any

import ccxt
import pytest

from services import deribit_ingest as di
from services.deribit_ingest import DeribitTransientReadError
from services.deribit_txn import LedgerValuationError


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
    # A non-rate-limit, non-(-32602-no-wallet) error (e.g. 13004 auth) is NOT
    # backed off and NOT swallowed — it surfaces so the producer fails loud.
    # (A first-page -32602 is separately absorbed as no-wallet → [].)
    stub = _TxnLogStub([_DeribitError(13004, "invalid credentials")])
    spy = _SleepSpy()
    with pytest.raises(_DeribitError) as exc:
        await di.paginate_txn_log(stub, "main", "BTC", 0, 100, {}, sleep=spy)
    assert exc.value.code == 13004


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


async def test_enumerate_scopes_is_single_key_own_account() -> None:
    # P70 (drb03): each LTP key IS its own subaccount — a single "main" scope.
    # get_subaccounts shows an empty parent + the key's OWN funded account
    # (1 funded ≤ 1) → safe single-scope.
    stub = _ScopeStub(
        subaccounts={
            "result": [
                {"id": "100", "type": "main", "portfolio": {}},
                {"id": "101", "type": "subaccount",
                 "portfolio": {"USDC": {"equity": 622923.41}}},
            ]
        }
    )
    scopes = await di.enumerate_scopes(stub)
    assert len(scopes) == 1
    assert scopes[0].is_main is True
    assert scopes[0].subaccount_id is None


async def test_enumerate_scopes_fails_loud_on_multiple_funded_subaccounts() -> None:
    # F-2/C1: a parent-account key seeing >1 FUNDED subaccount would silently
    # miss the siblings (unreachable via exchange_token) → fail loud; provision
    # one read-only key per subaccount instead.
    stub = _ScopeStub(
        subaccounts={
            "result": [
                {"id": "101", "portfolio": {"USDC": {"equity": 5000.0}}},
                {"id": "102", "portfolio": {"BTC": {"equity": 0.5}}},
            ]
        }
    )
    with pytest.raises(di.ScopeAuthError):
        await di.enumerate_scopes(stub)


async def test_enumerate_scopes_get_subaccounts_error_proceeds_single_scope() -> None:
    # The verification is best-effort: a get_subaccounts read error does not
    # block the key's own crawl (the equity-vs-rows floor is the backstop).
    class _Boom:
        async def private_get_get_subaccounts(self, params: dict[str, Any]) -> Any:
            raise RuntimeError("subaccounts unavailable")

    scopes = await di.enumerate_scopes(_Boom())
    assert len(scopes) == 1 and scopes[0].is_main


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


async def test_enumerate_currencies_is_full_public_universe_balance_independent() -> None:
    # DISCRIMINATING fixture (pr-test #1): BTC is the ONLY held currency; ETH/USDC
    # are UNHELD. The old held-based logic would return ["BTC"] and DROP ETH/USDC;
    # the balance-INDEPENDENT full-universe logic returns all three. This is the
    # crux of the self-referential-gate fix — a now-zero currency that HELD
    # history must still be crawled, so reverting to held-derivation reddens this.
    stub = _CurrencyStub(
        summaries={"result": {"summaries": [{"currency": "BTC", "equity": 0.5}]}},
        currencies={
            "result": [
                {"currency": "BTC"},
                {"currency": "ETH"},
                {"currency": "USDC"},
            ]
        },
    )
    main = di.Scope(label="main", subaccount_id=None, is_main=True)
    ccys = await di.enumerate_currencies(stub, main, {})
    assert ccys == ["BTC", "ETH", "USDC"]


async def test_enumerate_currencies_fails_loud_on_read_error() -> None:
    # public/get_currencies raising must FAIL LOUD, never return [] — an empty
    # authoritative set would let the gate pass while crawling nothing.
    class _Boom:
        async def public_get_get_currencies(self) -> Any:
            raise RuntimeError("network down")

    main = di.Scope(label="main", subaccount_id=None, is_main=True)
    with pytest.raises(di.CurrencyEnumerationError):
        await di.enumerate_currencies(_Boom(), main, {})


async def test_enumerate_currencies_fails_loud_on_empty_universe() -> None:
    stub = _CurrencyStub(currencies={"result": []})
    main = di.Scope(label="main", subaccount_id=None, is_main=True)
    with pytest.raises(di.CurrencyEnumerationError):
        await di.enumerate_currencies(stub, main, {})




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
        return [{"type": "settlement", "currency": "USDC", "change": 1.0,
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
        return [{"type": "settlement", "currency": "USDC", "change": cash,
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
        return [{"type": "settlement", "currency": "USDC", "change": 1.0,
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


async def test_no_wallet_empty_crawl_is_complete_empty(monkeypatch: Any) -> None:
    # With the authoritative FULL public-currency universe, a currency the scope
    # never funded surfaces at paginate_txn_log as an EMPTY crawl (a first-page
    # -32602 is absorbed there → []). The producer records that COMPLETE-empty
    # (nothing to crawl), NOT a gap; the gate PASSES.
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "SOL":
            return []  # paginator absorbed a first-page -32602 (no wallet)
        return [{"type": "settlement", "currency": "USDC", "change": 1.0,
                 "timestamp": _DAY_D_MS}]

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC", "SOL"]},
        paginate=_paginate,
    )
    _records, report = await di.fetch_deribit_ledger_daily_records(object())
    entry = report.entries[("main", "SOL")]
    assert entry["reached_end"] is True and entry["rows"] == 0
    # Both currencies accounted for → gate passes (no silent gap).
    di.assert_ledger_complete(report)


async def test_mid_crawl_minus_32602_fails_loud(monkeypatch: Any) -> None:
    # F-3: a -32602 that escapes paginate_txn_log (i.e. raised AFTER rows were
    # fetched — the paginator only absorbs it on page 1 with zero rows) must NOT
    # be recorded complete-empty; it propagates out of the producer (fail loud),
    # never dropping already-fetched rows.
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        raise _DeribitError(-32602, "invalid continuation")  # mid-crawl escape

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    with pytest.raises(_DeribitError):
        await di.fetch_deribit_ledger_daily_records(object())


async def test_paginate_first_page_minus_32602_returns_empty() -> None:
    # A first-page -32602 with an authoritative integer .code = "no wallet" → [].
    stub = _TxnLogStub([_DeribitError(-32602, "not a margin currency")])
    rows = await di.paginate_txn_log(
        stub, "main", "SOL", 0, 1, {}, sleep=_SleepSpy()
    )
    assert rows == []


async def test_paginate_minus_32602_after_rows_fails_loud() -> None:
    # A -32602 on page 2 (after page-1 rows) must NOT be swallowed as no-wallet —
    # it would drop the page-1 rows. It propagates.
    page1 = {"result": {"logs": [{"type": "settlement", "change": 1.0}],
                        "continuation": "cur2"}}
    stub = _TxnLogStub([page1, _DeribitError(-32602, "invalid continuation")])
    with pytest.raises(_DeribitError):
        await di.paginate_txn_log(stub, "main", "BTC", 0, 1, {}, sleep=_SleepSpy())


async def test_paginate_degraded_200_fails_loud() -> None:
    # F-1: a structurally-degraded 200 (non-Mapping result / non-list logs) must
    # NOT be read as end-of-history — it raises LedgerTruncatedError.
    for bad in ({"result": "nope"}, {"result": {"logs": "notalist"}}, "notamapping"):
        stub = _TxnLogStub([bad])
        with pytest.raises(di.LedgerTruncatedError):
            await di.paginate_txn_log(stub, "main", "BTC", 0, 1, {}, sleep=_SleepSpy())


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
# P72 — same-day settlement index (public/get_delivery_prices) + crawl wiring.
#
# The quiet-day inverse fallback: an inverse (coin) cash row on a day the ledger
# itself carries no index is valued via the SAME-DAY delivery-price mark (inside
# D-07's event window, NOT a period-end price). fetch_deribit_settlement_index
# pages the public endpoint newest-first; the producer fetches it once per inverse
# currency and only for days inverse_days_needing_index flags.
# ===========================================================================


class _DeliveryPricesStub:
    """Serves a scripted sequence of public/get_delivery_prices pages / errors."""

    def __init__(self, script: list[Any]) -> None:
        self._script = list(script)
        self.calls: list[dict[str, Any]] = []

    async def public_get_get_delivery_prices(self, params: dict[str, Any]) -> Any:
        self.calls.append(dict(params))
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _delivery_page(rows: list[tuple[str, float]]) -> dict[str, Any]:
    return {
        "result": {
            "data": [{"date": d, "delivery_price": p} for d, p in rows],
            "records_total": len(rows),
        }
    }


async def test_fetch_settlement_index_accumulates_and_stops_at_exhaustion() -> None:
    # Exhaustion is signalled by an EMPTY page — decoupled from the exact `count`
    # ceiling (WR-01): a partial page still yields its rows, and the NEXT (empty)
    # page terminates the crawl. So a 2-row page then an empty page → 2 calls,
    # full accumulated map.
    stub = _DeliveryPricesStub(
        [
            _delivery_page([("2026-01-17", 61000.0), ("2026-01-16", 60000.0)]),
            _delivery_page([]),
        ]
    )
    spy = _SleepSpy()
    prices = await di.fetch_deribit_settlement_index(
        stub, "BTC", oldest_day="2026-01-01", sleep=spy
    )
    assert prices == {"2026-01-17": 61000.0, "2026-01-16": 60000.0}
    assert len(stub.calls) == 2  # page 1 (rows) + page 2 (empty → exhausted)
    # index_name = {ccy}_usd, count 100, contiguous offsets (0, then 100).
    assert stub.calls[0]["index_name"] == "btc_usd"
    assert stub.calls[0]["count"] == 100
    assert stub.calls[0]["offset"] == 0
    assert stub.calls[1]["offset"] == 100


async def test_fetch_settlement_index_stops_at_oldest_day() -> None:
    # A FULL first page (100 rows) already reaching back past oldest_day → STOP;
    # the (existing) second page must NOT be requested (min(dates) <= oldest_day).
    from datetime import date, timedelta

    base = date(2026, 4, 10)
    page1 = _delivery_page(
        [((base - timedelta(days=i)).isoformat(), 60000.0 + i) for i in range(100)]
    )
    page2 = _delivery_page([("2020-01-01", 7000.0)])
    stub = _DeliveryPricesStub([page1, page2])
    spy = _SleepSpy()
    oldest = (base - timedelta(days=50)).isoformat()
    prices = await di.fetch_deribit_settlement_index(
        stub, "ETH", oldest_day=oldest, sleep=spy
    )
    assert len(stub.calls) == 1  # stopped after reaching oldest_day
    assert stub.calls[0]["index_name"] == "eth_usd"
    assert oldest in prices
    assert "2020-01-01" not in prices
    # A pacing wait would only appear between pages; a single page → no wait.
    assert spy.waits == []


async def test_fetch_settlement_index_skips_non_positive_prices() -> None:
    stub = _DeliveryPricesStub(
        [
            _delivery_page(
                [("2026-01-17", 61000.0), ("2026-01-16", 0.0), ("2026-01-15", -5.0)]
            )
        ]
    )
    prices = await di.fetch_deribit_settlement_index(
        stub, "BTC", oldest_day="2026-01-01", sleep=_SleepSpy()
    )
    # Zero and negative delivery prices are dropped (never value coin cash at <=0).
    assert prices == {"2026-01-17": 61000.0}


async def test_fetch_settlement_index_returns_partial_on_fetch_error() -> None:
    # A delivery-price read is NON-fatal to correctness (the aggregator still
    # fails loud if a needed day stays unvalued). Page 1 FULL → paging continues;
    # page 2 raises → return the page-1 map rather than crash the crawl.
    from datetime import date, timedelta

    base = date(2026, 4, 10)
    page1 = _delivery_page(
        [((base - timedelta(days=i)).isoformat(), 60000.0 + i) for i in range(100)]
    )
    stub = _DeliveryPricesStub([page1, RuntimeError("network down")])
    spy = _SleepSpy()
    # oldest_day far in the past forces a second page request (which errors).
    prices = await di.fetch_deribit_settlement_index(
        stub, "BTC", oldest_day="2000-01-01", sleep=spy
    )
    assert len(stub.calls) == 2  # attempted page 2
    assert len(prices) == 100  # page-1 map preserved despite the error


async def test_producer_values_quiet_inverse_day_via_settlement_index(
    monkeypatch: Any,
) -> None:
    # Crawl wiring: the producer fetches the SAME-DAY settlement index for an
    # inverse currency whose crawl carries a quiet-day cash row (no own index),
    # so the row VALUES (change*price) instead of failing loud. Revert-proof:
    # without the supplemental wiring the quiet BTC fee raises ValueError out of
    # txn_rows_to_daily_records and this test errors instead of asserting -45.
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            # quiet BTC negative_balance_fee: nonzero change, NO own index_price.
            return [{"type": "negative_balance_fee", "currency": "BTC",
                     "change": -0.001, "timestamp": _DAY_D_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    fetched: list[tuple[str, str]] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        fetched.append((currency, oldest_day))
        return {"2024-01-02": 45000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    records, report = await di.fetch_deribit_ledger_daily_records(object())
    # The settlement index was fetched for BTC anchored at the quiet day, and the
    # fee valued at -0.001 * 45000 = -45 rather than failing loud.
    assert fetched == [("BTC", "2024-01-02")]
    assert len(records) == 1
    assert records[0]["side"] == "sell"
    assert records[0]["price"] == pytest.approx(45.0, abs=1e-9)
    di.assert_ledger_complete(report)


async def test_fetch_settlement_index_stops_at_max_pages() -> None:
    # A misbehaving endpoint that serves ENDLESS full pages (never a short page,
    # never reaching oldest_day) must not spin forever — the defensive
    # DELIVERY_PRICES_MAX_PAGES cap stops it and returns the partial map. 61 full
    # pages are scripted but only DELIVERY_PRICES_MAX_PAGES (60) are ever consumed.
    from datetime import date, timedelta

    base = date(2026, 4, 10)
    full = di.DELIVERY_PRICES_PAGE_COUNT  # 100 rows → a FULL (non-terminal) page
    pages = [
        _delivery_page(
            [
                (
                    (base - timedelta(days=pg * full + i)).isoformat(),
                    60000.0 + pg * full + i,
                )
                for i in range(full)
            ]
        )
        for pg in range(61)
    ]
    stub = _DeliveryPricesStub(pages)
    spy = _SleepSpy()
    prices = await di.fetch_deribit_settlement_index(
        stub, "BTC", oldest_day="1970-01-01", sleep=spy
    )
    # Stopped at exactly the cap; the 61st page was never requested.
    assert len(stub.calls) == di.DELIVERY_PRICES_MAX_PAGES == 60
    # Partial map returned (every consumed page's rows), not a crash.
    assert len(prices) == 60 * full


async def test_fetch_settlement_index_paces_between_pages() -> None:
    # A >=2-page crawl paces one LEDGER_PACE_SECONDS wait BETWEEN pages (mirrors
    # paginate_txn_log): page 1 full → continue; page 2 empty → history exhausted,
    # stop. Exactly one pacing wait fired (between the two page requests).
    from datetime import date, timedelta

    base = date(2026, 4, 10)
    page1 = _delivery_page(
        [((base - timedelta(days=i)).isoformat(), 60000.0 + i) for i in range(100)]
    )
    page2 = _delivery_page([])  # empty → history exhausted
    stub = _DeliveryPricesStub([page1, page2])
    spy = _SleepSpy()
    prices = await di.fetch_deribit_settlement_index(
        stub, "BTC", oldest_day="1970-01-01", sleep=spy
    )
    assert len(stub.calls) == 2
    # One pace wait, between page 1 and page 2 — never before the first page.
    assert spy.waits == [di.LEDGER_PACE_SECONDS]
    assert len(prices) == 100  # page-1 map accumulated before the empty page


async def test_producer_raises_when_settlement_index_missing_needed_day(
    monkeypatch: Any,
) -> None:
    # Fail-loud: a quiet inverse day whose settlement fetch returns a map MISSING
    # that exact day stays UNVALUED — the aggregator must raise
    # LedgerValuationError (never silently emit / drop the coin cash), even though
    # the fetch itself "succeeded".
    from services.deribit_txn import LedgerValuationError

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [{"type": "negative_balance_fee", "currency": "BTC",
                     "change": -0.001, "timestamp": _DAY_D_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        # A non-empty map that does NOT contain the needed 2024-01-02 quiet day.
        return {"2099-12-31": 45000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    with pytest.raises(LedgerValuationError):
        await di.fetch_deribit_ledger_daily_records(object())


async def test_producer_linear_currency_never_fetches_settlement_index(
    monkeypatch: Any,
) -> None:
    # No-regression: a LINEAR (USD-family) currency crawl never needs a settlement
    # index, so fetch_deribit_settlement_index must NOT be called at all — a
    # needless public fetch for USDC/USDT would be pure waste.
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        return [{"type": "settlement", "currency": "USDC", "change": 10.0,
                 "instrument_name": "BTC_USDC-PERPETUAL", "timestamp": _DAY_D_MS}]

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["USDC"]}, paginate=_paginate,
    )

    called: list[str] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        called.append(currency)
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    records, report = await di.fetch_deribit_ledger_daily_records(object())
    assert called == [], "linear USDC crawl must never fetch a settlement index"
    assert records  # the linear row still values (USD passthrough)
    di.assert_ledger_complete(report)


async def test_multi_scope_older_quiet_day_triggers_deeper_settlement_fetch(
    monkeypatch: Any,
) -> None:
    # Fix 2 (cross-scope cache depth): scope A (main) carries a RECENT quiet BTC
    # day; scope B (sub_1) an OLDER one. The per-currency settlement cache is first
    # anchored on A's recent day (a SHALLOW map that does NOT reach B's older day);
    # B must trigger a DEEPER re-fetch anchored on its older day rather than take a
    # too-shallow cache hit and fail loud. Revert-proof: the pre-Fix cache guard
    # (`if currency not in settlement_index_cache`, first-scope anchor) reuses A's
    # shallow map for B → B's row raises LedgerValuationError and this test errors.
    recent_ms = 1_717_200_000_000  # 2024-06-01 UTC
    old_ms = _DAY_D_MS             # 2024-01-02 UTC
    scopes = [di.Scope("main", None, True), di.Scope("sub_1", "101", False)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency != "BTC":
            return []
        ts = recent_ms if scope_label == "main" else old_ms
        return [{"type": "negative_balance_fee", "currency": "BTC",
                 "change": -0.001, "timestamp": ts}]

    _patch_pipeline(
        monkeypatch,
        scopes=scopes,
        currencies={"main": ["BTC"], "sub_1": ["BTC"]},
        paginate=_paginate,
    )

    fetched_oldest: list[str] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        fetched_oldest.append(oldest_day)
        # A fetch anchored at the OLD day reaches BOTH days; a shallow fetch
        # anchored at the recent day covers ONLY the recent day.
        if oldest_day <= "2024-01-02":
            return {"2024-01-02": 40000.0, "2024-06-01": 60000.0}
        return {"2024-06-01": 60000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    records, report = await di.fetch_deribit_ledger_daily_records(object())
    # BOTH quiet-day rows valued (no raise): main -0.001*60000=-60,
    # sub_1 -0.001*40000=-40.
    prices = {r["timestamp"]: r["price"] for r in records}
    assert prices["2024-06-01T00:00:00+00:00"] == pytest.approx(60.0, abs=1e-9)
    assert prices["2024-01-02T00:00:00+00:00"] == pytest.approx(40.0, abs=1e-9)
    # Re-fetched DEEPER for the older scope: two fetches, the 2nd anchored older.
    assert fetched_oldest == ["2024-06-01", "2024-01-02"]
    di.assert_ledger_complete(report)


# ===========================================================================
# 75-03 — CompletenessReport.dated_external_flows: the crawl accumulates a dated
# list[ExternalFlow] (replacing the net-scalar + saw_unvalued_inverse_flow fields)
# via deribit_dated_external_flows_usd, feeding the honest core's F_t term. The
# quiet-day inverse flow (Finding C1) values via the SAME supplemental fetch that
# feeds txn_rows_to_daily_records — count-once by construction.
# ===========================================================================


async def test_crawl_accumulates_dated_inverse_flow_with_own_index(
    monkeypatch: Any,
) -> None:
    # Dated accumulation proof: crawling scenario 2 (a BTC withdrawal on a day that
    # ALSO carries an index-bearing settlement row) yields ONE correctly-signed,
    # event-time-valued ExternalFlow on the withdrawal's actual UTC day — valued at
    # the OWN same-day index (no external fetch needed). -0.5 * 42000 = -21000.
    from services.external_flows import ExternalFlow
    from tests.fixtures.deribit_flow_fixtures import (
        BTC_INDEX_2026_03_14,
        DAY_INVERSE_WITH_INDEX,
        inverse_flow_day_with_index_rows,
    )

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return inverse_flow_day_with_index_rows()
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    called: list[str] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        called.append(currency)
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    _records, report = await di.fetch_deribit_ledger_daily_records(object())
    # The withdrawal day carries its OWN index (the paired settlement row), so no
    # settlement-index fetch was needed.
    assert called == [], "own-index inverse flow must not trigger a supplemental fetch"
    # Phase 80-01: the producer now emits the 4-field (day, ccy)-keyed form.
    # usd_signed (=-0.5*42000) and the day are byte-identical to the pre-80-01
    # 2-field value; currency="BTC" and quantity=-0.5 (native change) are added.
    assert report.dated_external_flows == [
        ExternalFlow(DAY_INVERSE_WITH_INDEX, -0.5 * BTC_INDEX_2026_03_14, "BTC", -0.5)
    ]


async def test_crawl_c1_quiet_inverse_flow_values_via_settlement_index(
    monkeypatch: Any,
) -> None:
    # C1 end-to-end proof: a QUIET-day BTC withdrawal (no own index) VALUES via the
    # fetched same-day settlement index instead of failing loud — the flow appears
    # in dated_external_flows. Revert-proof: without the 75-02 C1 extension the day
    # is never fetched (inverse_days_needing_index would not emit it) and the flow
    # producer raises LedgerValuationError out of the crawl (this test errors).
    from services.external_flows import ExternalFlow
    from tests.fixtures.deribit_flow_fixtures import (
        DAY_INVERSE_NO_INDEX,
        inverse_flow_day_without_index_rows,
    )

    quiet_price = 43000.0
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return inverse_flow_day_without_index_rows()
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    fetched: list[tuple[str, str]] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        fetched.append((currency, oldest_day))
        return {DAY_INVERSE_NO_INDEX: quiet_price}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    _records, report = await di.fetch_deribit_ledger_daily_records(object())
    # The C1 extension flagged the quiet day → the settlement index was fetched for
    # BTC anchored at that day, and the withdrawal valued at -0.5 * 43000 = -21500
    # rather than failing loud.
    assert fetched == [("BTC", DAY_INVERSE_NO_INDEX)]
    # Phase 80-01: 4-field emit — usd_signed (=-0.5*quiet_price) + day unchanged;
    # native channel currency="BTC", quantity=-0.5 added.
    assert report.dated_external_flows == [
        ExternalFlow(DAY_INVERSE_NO_INDEX, -0.5 * quiet_price, "BTC", -0.5)
    ]


async def test_crawl_accumulates_linear_flow_without_index_fetch(
    monkeypatch: Any,
) -> None:
    # Linear proof: a USDC (linear / USD-family) deposit accumulates a +USD dated
    # flow with NO settlement-index fetch (USD passes through, never index-scaled).
    from services.external_flows import ExternalFlow
    from tests.fixtures.deribit_flow_fixtures import (
        DAY_LINEAR,
        linear_flow_day_rows,
    )

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "USDC":
            return linear_flow_day_rows()
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["USDC"]}, paginate=_paginate,
    )

    called: list[str] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        called.append(currency)
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    _records, report = await di.fetch_deribit_ledger_daily_records(object())
    assert called == [], "a linear USDC deposit must never fetch a settlement index"
    # +50000 USDC deposit passes through as +50000 USD on its own UTC day.
    # Phase 80-01: 4-field emit — usd_signed (=50000) + day unchanged; a linear
    # USDC deposit carries currency="USDC" and quantity=50000 (USD-family: qty==usd).
    assert report.dated_external_flows == [
        ExternalFlow(DAY_LINEAR, 50000.0, "USDC", 50000.0)
    ]


async def test_completeness_report_retired_scalar_fields(monkeypatch: Any) -> None:
    # Field-swap proof: the net-scalar fields are GONE; dated_external_flows +
    # total_return_rows are the survivors.
    report = di.CompletenessReport()
    assert not hasattr(report, "net_external_flow_usd")
    assert not hasattr(report, "saw_unvalued_inverse_flow")
    assert report.dated_external_flows == []
    assert report.total_return_rows == 0


async def test_crawl_flow_row_count_once_absent_from_realized(
    monkeypatch: Any,
) -> None:
    # Count-once proof (crawl level): the deposit flow row is EXCLUDED from the
    # realized daily_records (txn_rows_to_daily_records skips _EXTERNAL_FLOW_TYPES)
    # and appears exactly once in dated_external_flows. Only the linear trade fee
    # (a CASH_BEARING row) reaches realized.
    from services.external_flows import ExternalFlow
    from tests.fixtures.deribit_flow_fixtures import (
        DAY_LINEAR,
        linear_flow_day_rows,
    )

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "USDC":
            return linear_flow_day_rows()
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["USDC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    records, report = await di.fetch_deribit_ledger_daily_records(object())
    # The +50000 deposit is a flow, NOT realized — it must not leak into realized
    # daily_records (else it double-counts against F_t).
    realized_usd = [abs(float(r["price"])) for r in records]
    assert 50000.0 not in realized_usd, "deposit flow leaked into the realized sum"
    # The only realized record is the -5 linear trade fee.
    assert records and all(abs(float(r["price"])) == 5.0 for r in records)
    # The deposit appears exactly once as a dated flow.
    # Phase 80-01: 4-field emit — usd_signed (=50000) + day unchanged; a linear
    # USDC deposit carries currency="USDC" and quantity=50000 (USD-family: qty==usd).
    assert report.dated_external_flows == [
        ExternalFlow(DAY_LINEAR, 50000.0, "USDC", 50000.0)
    ]


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
    # paginator must not double-count it. page1 FULL (count=3) last "B3"; page2
    # re-serves "B3" (the boundary) plus a new "B4" and is short → only one "B3".
    stub = _TradesStub(
        [
            _trades_page([_trade("B1"), _trade("B2"), _trade("B3")], has_more=True),
            _trades_page([_trade("B3"), _trade("B4")], has_more=False),
        ]
    )
    spy = _SleepSpy()
    rows = await di.paginate_trades_id_cursor(stub, "BTC", {}, count=3, sleep=spy)
    assert [r["trade_id"] for r in rows] == ["B1", "B2", "B3", "B4"]
    assert stub.calls[1]["start_id"] == "B3"


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


# ===========================================================================
# 70-04 Task 2 — fetch_raw_trades deribit dispatch + ADVISORY reconcile_fill_count.
#
# The fill-count cross-check is ADVISORY ONLY: the Wave-0 BLOCKING_FINDING proved
# 18,778/21,014/61,248 reconcile to NO API surface (they count fills/legs, not
# txn-log rows). The returns-completeness honesty gate is assert_ledger_complete
# (70-03), NEVER this fill count — so reconcile_fill_count must never raise/gate.
# ===========================================================================


async def test_fetch_raw_trades_dispatches_deribit(monkeypatch: Any) -> None:
    from services import exchange as ex

    sentinel = [{"exchange": "deribit", "exchange_fill_id": "D-1"}]

    async def _fake_fetch(_exchange: Any, _since_ms: Any = None, **_k: Any) -> Any:
        return sentinel

    monkeypatch.setattr(
        "services.deribit_ingest.fetch_deribit_fills", _fake_fetch
    )

    class _Ex:
        id = "deribit"

    out = await ex.fetch_raw_trades(_Ex(), "strat-1", object(), None)
    # The dispatch routed deribit to _fetch_raw_trades_deribit → fetch_deribit_fills.
    assert out == sentinel


def test_reconcile_fill_count_is_advisory_not_raising() -> None:
    # A LARGE shortfall must NOT raise — it yields an advisory report. Structural:
    # there is no count-gate exception type to raise.
    assert not hasattr(di, "DeribitCountGateError")
    report = di.reconcile_fill_count(674, 18_778)
    assert isinstance(report, dict)
    assert report["fetched_total"] == 674
    assert report["known_total"] == 18_778
    assert report["shortfall"] == 18_778 - 674
    assert report["reconciles"] is False
    assert report["advisory"] is True
    # Never raises even on a total (0) shortfall — advisory, not a gate.
    zero = di.reconcile_fill_count(0, 61_248)
    assert zero["reconciles"] is False
    # A perfect match reconciles with zero shortfall.
    exact = di.reconcile_fill_count(21_014, 21_014)
    assert exact["reconciles"] is True and exact["shortfall"] == 0


def test_known_totals_documented_non_reconciling() -> None:
    # KNOWN_TRADE_TOTALS carries the 3 LTP figures for cross-check bookkeeping
    # ONLY — documented advisory + non-reconciling-to-API (Wave-0 finding).
    totals = di.KNOWN_TRADE_TOTALS
    assert len(totals) == 3
    assert set(totals.values()) == {18_778, 21_014, 61_248}
    # The advisory nature is documented (module/docstring/comment marks it).
    import services.deribit_ingest as _mod

    doc = (_mod.reconcile_fill_count.__doc__ or "").lower()
    assert "advisory" in doc


# ===========================================================================
# Plan 79-04 Task 2 — build_deribit_indexable_currencies probe builder + LIVE
# threading into fetch_deribit_ledger_daily_records (SOL heals on the existing
# USD-space path; §7.2, 79-CONTEXT G6 revised).
# ===========================================================================


class _IndexProbeStub:
    """Serves scripted public/get_index_price responses per ``{ccy}_usd`` index
    name and records every probe. A mapped ``Exception`` value RAISES; a float is
    returned as ``{"result": {"index_price": <float>}}``; ``None`` returns a result
    with no ``index_price`` key (an unresolvable-but-non-raising probe)."""

    def __init__(self, prices: dict[str, Any]) -> None:
        self._prices = dict(prices)
        self.probed: list[str] = []

    async def public_get_get_index_price(self, params: dict[str, Any]) -> Any:
        name = params["index_name"]
        self.probed.append(name)
        val = self._prices.get(name, RuntimeError("no such index"))
        if isinstance(val, Exception):
            raise val
        if val is None:
            return {"result": {}}
        return {"result": {"index_price": val}}


async def test_build_indexable_static_floor_plus_probed() -> None:
    """probe_builder: the built set is the static floor ∪ every probed non-USD-
    family currency that resolves finite-positive. SOL resolves → in; BUIDL raises
    → out; BTC is in WITHOUT a probe (floor); USDC is NEVER probed (USD-family).
    Mutation-honest: probing USD-family (assert below) or dropping the floor
    (BTC/ETH assertions) reddens this."""
    stub = _IndexProbeStub(
        {
            "sol_usd": 150.0,
            "buidl_usd": RuntimeError("no index"),
        }
    )
    built = await di.build_deribit_indexable_currencies(
        stub, ["BTC", "ETH", "USDC", "SOL", "BUIDL"]
    )
    assert built == frozenset({"BTC", "ETH", "SOL"})
    # BTC/ETH (floor) and USDC (USD-family) are NEVER probed; SOL and BUIDL are.
    assert stub.probed == ["sol_usd", "buidl_usd"]
    assert "usdc_usd" not in stub.probed
    assert "btc_usd" not in stub.probed


async def test_build_indexable_rejects_non_finite_and_non_positive() -> None:
    """A probe that returns a non-finite / ≤0 / missing index_price leaves the
    currency OUT — a bogus mark can never admit an un-indexable currency (T-79-13).
    Mutation-honest: inverting the success test (admitting on failure) reddens."""
    stub = _IndexProbeStub(
        {
            "sol_usd": 0.0,  # non-positive → out
            "xrp_usd": float("nan"),  # non-finite → out
            "avax_usd": None,  # no index_price key → out
        }
    )
    built = await di.build_deribit_indexable_currencies(
        stub, ["SOL", "XRP", "AVAX"]
    )
    assert built == frozenset({"BTC", "ETH"})  # floor only


async def test_build_indexable_probes_each_currency_at_most_once() -> None:
    """probe_called_once_per_currency: a duplicated universe entry costs at most
    one probe (the per-job cache discipline of settlement_index_cache)."""
    stub = _IndexProbeStub({"sol_usd": 150.0})
    built = await di.build_deribit_indexable_currencies(
        stub, ["SOL", "SOL", "sol"]
    )
    assert built == frozenset({"BTC", "ETH", "SOL"})
    assert stub.probed == ["sol_usd"]  # probed ONCE despite three entries


def test_indexable_set_drives_the_636_gate_source_scan() -> None:
    """built_and_threaded_live (source-scan): the built ``indexable`` set — NOT the
    module constant ``_INVERSE_CURRENCIES`` — drives the :636 supplemental-index
    gate, and it is built right after enumerate_currencies. Mutation-honest:
    reverting the gate to ``ccy_upper in _INVERSE_CURRENCIES`` reddens this."""
    # 80-02: the crawl body (with the :636 gate) is factored into the shared
    # _crawl_deribit_ledger; fetch_deribit_ledger_daily_records is now a thin
    # USD-space delegate. Scan the function that actually owns the gate.
    src = inspect.getsource(di._crawl_deribit_ledger)
    # The built set is constructed once per job right after enumerate_currencies.
    assert "build_deribit_indexable_currencies(" in src
    enum_at = src.index("enumerate_currencies(exchange, scopes[0]")
    build_at = src.index("build_deribit_indexable_currencies(")
    assert build_at > enum_at  # built AFTER the universe is enumerated
    # The gate consults the built set, never the module constant.
    assert "if ccy_upper in indexable:" in src
    assert "if ccy_upper in _INVERSE_CURRENCIES:" not in src


async def test_sol_heals_on_existing_path(monkeypatch: Any) -> None:
    """sol_heals_on_existing_path (the key-1 crash healed in Phase 79): a universe
    including SOL, whose ``sol_usd`` probe resolves finite-positive and whose txn
    log carries a quiet-day SOL cash row, VALUES that row via the same-day
    settlement index and returns records — NO LedgerValuationError.

    The SOL row is a QUIET fee (no own index) so the heal DEPENDS on the built set
    driving the :636 gate: reverting the gate to ``_INVERSE_CURRENCIES``
    un-threads SOL, the supplemental fetch is skipped, and the SOL row fails loud
    for lack of any index — i.e. the neuter reddens this test."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "SOL":
            return [{"type": "negative_balance_fee", "currency": "SOL",
                     "change": -0.5, "timestamp": _DAY_D_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["SOL"]}, paginate=_paginate,
    )

    fetched: list[tuple[str, str]] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        fetched.append((currency, oldest_day))
        return {"2024-01-02": 150.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    # The exchange passed to fetch is the probe stub: sol_usd resolves → SOL indexable.
    exchange = _IndexProbeStub({"sol_usd": 150.0})
    records, report = await di.fetch_deribit_ledger_daily_records(exchange)

    # SOL healed: the same-day index was fetched and the fee valued -0.5*150 = -75.
    assert fetched == [("SOL", "2024-01-02")]
    assert len(records) == 1
    assert records[0]["side"] == "sell"
    assert records[0]["price"] == pytest.approx(75.0, abs=1e-9)
    di.assert_ledger_complete(report)


async def test_sol_still_refuses_when_probe_unresolvable(monkeypatch: Any) -> None:
    """The MIRROR of the heal (fail-loud shape survives, T-79-15): the SAME quiet
    SOL account whose ``sol_usd`` probe RAISES leaves SOL OUT of the built set → the
    SOL row still refuses loudly (LedgerValuationError). A bogus/absent probe can
    never silently admit a currency."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "SOL":
            return [{"type": "negative_balance_fee", "currency": "SOL",
                     "change": -0.5, "timestamp": _DAY_D_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["SOL"]}, paginate=_paginate,
    )

    # sol_usd probe RAISES → SOL ∉ indexable → the row has no basis for an index
    # multiply and fails loud (never blind-multiplied, never silently dropped).
    exchange = _IndexProbeStub({"sol_usd": RuntimeError("no sol index")})
    with pytest.raises(LedgerValuationError):
        await di.fetch_deribit_ledger_daily_records(exchange)


# ===========================================================================
# 80-02 Task 1 — native per-currency equity + session_upl from ONE summaries read
# (D5). The collapsed USD anchor stays byte-identical for the 80-04 parity panel;
# the native maps are the additive channel that feeds the 79 core (App A #6 wedge
# refusal is BY CONSTRUCTION — the native session_upl is passed through, never the
# legacy silent-0.0).
# ===========================================================================


class _NativeAnchorStub:
    """One ``get_account_summaries`` response + per-``{ccy}_usd`` index prices,
    counting summary reads so the single-fetch invariant is pin-able. ``index_price``
    is a ``{CCY: price}`` map, a scalar, or ``None`` (probe raises → unresolvable)."""

    def __init__(
        self,
        *,
        summaries: Any = None,
        index_price: Any = None,
        summaries_exc: BaseException | None = None,
    ) -> None:
        self._summaries = summaries
        self._index_price = index_price
        self._summaries_exc = summaries_exc
        self.summaries_calls = 0

    async def private_get_get_account_summaries(self, params: dict[str, Any]) -> Any:
        self.summaries_calls += 1
        if self._summaries_exc is not None:
            raise self._summaries_exc
        return {"result": {"summaries": self._summaries}}

    async def public_get_get_index_price(self, params: dict[str, Any]) -> Any:
        ccy = str(params["index_name"]).split("_")[0].upper()
        price = (
            self._index_price.get(ccy)
            if isinstance(self._index_price, dict)
            else self._index_price
        )
        # A mapped Exception RAISES it (every call) — lets a test script a
        # transient (ccxt.NetworkError) vs structural (ccxt.ExchangeError) probe.
        if isinstance(price, BaseException):
            raise price
        if price is None:
            raise RuntimeError("no index for " + ccy)
        return {"result": {"index_price": price}}


async def test_native_account_state_reads_native_equity_map() -> None:
    # native_equity is per-UPPERCASE-ccy NATIVE units: 1.5 BTC coins, NEVER
    # 1.5 × 60000. Mutation (a): index-multiplying the native equity map makes
    # BTC == 90000.0 and reddens.
    stub = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 1.5, "session_upl": 0.0},
            {"currency": "USDC", "equity": 40000.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 60000.0},
    )
    state = await di.fetch_deribit_native_account_state(stub)
    assert state.native_equity == {"BTC": 1.5, "USDC": 40000.0}


async def test_native_account_state_native_upnl_coerces_absent_to_zero() -> None:
    # session_upl absent / null / non-numeric coerces to 0.0 for that currency
    # (never fabricated), matching _deribit_session_upl_to_usd's [ASSUMED A1].
    stub = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 2.0, "session_upl": 0.3},
            {"currency": "ETH", "equity": 1.0},  # absent → 0.0
            {"currency": "USDC", "equity": 1.0, "session_upl": None},  # null → 0.0
            {"currency": "SOL", "equity": 1.0, "session_upl": "oops"},  # non-num → 0.0
        ],
        index_price={"BTC": 40000.0, "ETH": 3000.0, "SOL": 150.0},
    )
    state = await di.fetch_deribit_native_account_state(stub)
    assert state.native_upnl["BTC"] == pytest.approx(0.3)
    assert state.native_upnl["ETH"] == 0.0
    assert state.native_upnl["USDC"] == 0.0
    assert state.native_upnl["SOL"] == 0.0


async def test_native_account_state_single_summaries_fetch() -> None:
    # BOTH native maps AND the collapsed USD anchor come from ONE summaries read.
    # Mutation (b): a second get_account_summaries fetch makes summaries_calls == 2
    # and reddens.
    stub = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.3}],
        index_price={"BTC": 40000.0},
    )
    state = await di.fetch_deribit_native_account_state(stub)
    assert stub.summaries_calls == 1
    assert state.native_equity == {"BTC": 2.0}
    assert state.collapsed_equity_usd == pytest.approx(80000.0)


async def test_native_account_state_collapsed_anchor_matches_legacy_tuple() -> None:
    # The collapsed USD anchor + wedge are byte-identical to the legacy 4-tuple the
    # existing callers consume (the delegate returns exactly the state's collapsed
    # fields). Mutation (c): changing the collapsed anchor (e.g. summing native
    # equity instead of the USD collapse) reddens this AND the whole
    # test_job_worker_deribit collapsed suite.
    stub = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.3}],
        index_price={"BTC": 40000.0},
    )
    state = await di.fetch_deribit_native_account_state(stub)
    legacy = await di.fetch_deribit_account_equity_and_upnl_usd(stub)
    assert legacy == (
        state.collapsed_equity_usd,
        state.balance_error,
        state.collapsed_upnl_usd,
        state.upnl_unreadable,
    )
    assert legacy == (pytest.approx(80000.0), False, pytest.approx(12000.0), False)


async def test_native_account_state_failed_read_empty_native_maps() -> None:
    # A failed summaries read yields EMPTY native maps + the existing
    # (None, True, 0.0, False) collapsed disposition (never fabricated).
    stub = _NativeAnchorStub(summaries_exc=RuntimeError("network down"))
    state = await di.fetch_deribit_native_account_state(stub)
    assert state.native_equity == {}
    assert state.native_upnl == {}
    assert state.collapsed_equity_usd is None
    assert state.balance_error is True
    assert state.collapsed_upnl_usd == 0.0
    assert state.upnl_unreadable is False


async def test_native_upnl_not_zeroed_for_unvaluable_coin_wedge() -> None:
    # App A #6 BY CONSTRUCTION (D6): BTC holds ZERO equity (so the collapsed anchor
    # succeeds) but carries a nonzero coin session_upl with NO resolvable index. The
    # LEGACY collapsed wedge SILENTLY zeros it (_deribit_session_upl_to_usd:844-846).
    # The NATIVE channel MUST keep the raw 0.3 so the 79 core's value-gate can refuse
    # it — never the legacy silent 0.0. Mutation: sourcing native_upnl from the
    # collapsed wedge instead of the raw summary zeros BTC and reddens.
    stub = _NativeAnchorStub(
        summaries=[
            {"currency": "USDC", "equity": 1000.0, "session_upl": 0.0},
            {"currency": "BTC", "equity": 0.0, "session_upl": 0.3},
        ],
        index_price=None,  # no index for BTC → wedge unvaluable in the collapse
    )
    state = await di.fetch_deribit_native_account_state(stub)
    assert state.balance_error is False
    assert state.collapsed_upnl_usd == 0.0  # legacy silent-0.0 for the coin wedge
    assert state.native_upnl["BTC"] == pytest.approx(0.3)  # native channel preserves


# ===========================================================================
# 80-02 Task 2 — build_deribit_native_ledger: dense marks planner + NativeLedger
# assembly. Native pnl (dict→Series, D9), 4-field flows, per-currency native
# anchors/wedge, DENSE daily marks per indexed nonzero currency, full_history=True.
# The 79 core is IMPORTED and fed — never re-implemented.
# ===========================================================================

_DAY1_MS = 1_704_067_200_000  # 2024-01-01 00:00 UTC
_DAY2_MS = _DAY_D_MS          # 2024-01-02 00:00 UTC
_DAY3_MS = 1_704_240_000_000  # 2024-01-03 00:00 UTC


async def test_build_native_ledger_assembles_fields(monkeypatch: Any) -> None:
    import pandas as pd

    from services.native_nav import NativeLedger

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                {"type": "settlement", "currency": "BTC", "change": 10.0,
                 "timestamp": _DAY1_MS},
                {"type": "settlement", "currency": "BTC", "change": 20.0,
                 "timestamp": _DAY3_MS},
                {"type": "deposit", "currency": "BTC", "change": 0.5,
                 "timestamp": _DAY1_MS},
            ]
        if currency == "USDC":
            return [{"type": "settlement", "currency": "USDC", "change": 5.0,
                     "timestamp": _DAY2_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["BTC", "USDC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {"2024-01-01": 50000.0, "2024-01-02": 51000.0, "2024-01-03": 52000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 30.5, "session_upl": 0.0},
            {"currency": "USDC", "equity": 5.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 52000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex)

    assert isinstance(ledger, NativeLedger)
    assert isinstance(report, di.CompletenessReport)
    # native_pnl from txn_rows_to_native_daily: the BTC deposit is INFORMATIONAL
    # (flow), excluded — so native_pnl[BTC] is the settlements only, day-ascending.
    btc_pnl = ledger.native_pnl["BTC"]
    assert isinstance(btc_pnl, pd.Series)
    assert list(btc_pnl.index) == [
        pd.Timestamp("2024-01-01"), pd.Timestamp("2024-01-03"),
    ]
    assert btc_pnl.loc[pd.Timestamp("2024-01-01")] == pytest.approx(10.0)
    assert btc_pnl.loc[pd.Timestamp("2024-01-03")] == pytest.approx(20.0)
    assert ledger.native_pnl["USDC"].loc[pd.Timestamp("2024-01-02")] == pytest.approx(
        5.0
    )
    # Native anchors read straight off the summaries (native units).
    assert ledger.terminal_native_equity == {"BTC": 30.5, "USDC": 5.0}
    assert ledger.full_history is True
    # native_flows ARE the crawl's 4-field dated flows (reused, not recomputed).
    assert ledger.native_flows == report.dated_external_flows
    btc_flows = [f for f in ledger.native_flows if f.currency == "BTC"]
    assert btc_flows and btc_flows[0].quantity == pytest.approx(0.5)


async def test_build_native_ledger_uses_injected_state_no_second_read(
    monkeypatch: Any,
) -> None:
    """80-06 (HIGH-1+MEDIUM-1, D5 one-read): given ``account_state=<state>`` the
    builder uses the INJECTED anchor and does NOT fetch a second
    get_account_summaries — so the core anchor + the caller's materiality/C2 basis
    judge the SAME response. Spy: fetch_deribit_native_account_state must NOT be
    called; the ledger anchors on the injected native_equity. Neuter: reverting the
    builder to an unconditional ``await fetch_deribit_native_account_state(exchange)``
    trips the spy (a second read) → RED."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [{"type": "settlement", "currency": "BTC", "change": 10.0,
                     "timestamp": _DAY1_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {"2024-01-01": 50000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    async def _must_not_read(_ex: Any) -> Any:  # pragma: no cover - asserted below
        raise AssertionError(
            "injected account_state must suppress the second summaries read (D5)"
        )

    monkeypatch.setattr(di, "fetch_deribit_native_account_state", _must_not_read)

    injected = di.DeribitNativeAccountState(
        native_equity={"BTC": 99.0},
        native_upnl={},
        collapsed_equity_usd=99.0 * 50000.0,
        collapsed_upnl_usd=0.0,
        balance_error=False,
        upnl_unreadable=False,
        native_options_value={},
    )
    ex = _NativeAnchorStub(summaries=[], index_price={"BTC": 50000.0})
    ledger, _report = await di.build_deribit_native_ledger(
        ex, account_state=injected
    )
    # The ledger anchors on the INJECTED state — never a re-read.
    assert ledger.terminal_native_equity == {"BTC": 99.0}


async def test_build_native_ledger_fallback_reads_once_when_not_injected(
    monkeypatch: Any,
) -> None:
    """Standalone / test callers omit account_state → the builder keeps its
    self-contained fallback read (EXACTLY once, so the branch total stays 1 once
    the caller threads its own read in). Spy call_count == 1."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [{"type": "settlement", "currency": "BTC", "change": 10.0,
                     "timestamp": _DAY1_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {"2024-01-01": 50000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    calls = {"n": 0}
    _real_state = di.fetch_deribit_native_account_state

    async def _counting_state(ex: Any) -> Any:
        calls["n"] += 1
        return await _real_state(ex)

    monkeypatch.setattr(di, "fetch_deribit_native_account_state", _counting_state)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 30.0, "session_upl": 0.0}],
        index_price={"BTC": 50000.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)
    assert calls["n"] == 1, (
        f"fallback must read the anchor exactly once; got {calls['n']}"
    )
    assert ledger.terminal_native_equity == {"BTC": 30.0}


async def test_build_native_ledger_dense_marks_and_usd_absent(
    monkeypatch: Any,
) -> None:
    import pandas as pd

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            # BTC events on day1 and day3 ONLY — NOT day2.
            return [
                {"type": "settlement", "currency": "BTC", "change": 10.0,
                 "timestamp": _DAY1_MS},
                {"type": "settlement", "currency": "BTC", "change": 20.0,
                 "timestamp": _DAY3_MS},
            ]
        if currency == "USDC":
            return [{"type": "settlement", "currency": "USDC", "change": 5.0,
                     "timestamp": _DAY2_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["BTC", "USDC"]}, paginate=_paginate,
    )

    dense = {"2024-01-01": 50000.0, "2024-01-02": 51000.0, "2024-01-03": 52000.0}

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return dict(dense)

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 30.0, "session_upl": 0.0},
            {"currency": "USDC", "equity": 5.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 52000.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)

    btc_marks = ledger.marks["BTC"]
    # DENSE across the fetched span — day2 (51000) is present EVEN THOUGH BTC has no
    # event on day2. Mutation (a): fetching only event days (sparse) drops day2 and
    # reddens this.
    assert list(btc_marks.index) == [pd.Timestamp(d) for d in sorted(dense)]
    assert btc_marks.loc[pd.Timestamp("2024-01-02")] == pytest.approx(51000.0)
    # Mutation (b): USD-family currencies NEVER appear in marks (mark ≡ 1.0 in core).
    assert "USDC" not in ledger.marks
    assert "USD" not in ledger.marks


async def test_build_native_ledger_marks_oldest_day_is_activity(
    monkeypatch: Any,
) -> None:
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                {"type": "settlement", "currency": "BTC", "change": 10.0,
                 "timestamp": _DAY1_MS},
                {"type": "settlement", "currency": "BTC", "change": 20.0,
                 "timestamp": _DAY3_MS},
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    calls: list[tuple[str, str]] = []

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        calls.append((currency, oldest_day))
        return {"2024-01-01": 50000.0, "2024-01-03": 52000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 30.0, "session_upl": 0.0}],
        index_price={"BTC": 52000.0},
    )
    await di.build_deribit_native_ledger(ex)
    # oldest_day is BTC's EARLIEST activity day (2024-01-01), never a hardcoded
    # recent date. Mutation (c): a fixed recent oldest_day reddens.
    assert ("BTC", "2024-01-01") in calls
    assert all(od == "2024-01-01" for (c, od) in calls if c == "BTC")


async def test_build_native_ledger_no_mark_for_unindexable_value_currency(
    monkeypatch: Any,
) -> None:
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        return []  # no ledger cash rows anywhere

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["BTC", "SOL"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {"2024-01-01": 50000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    # SOL held as native dust; sol_usd probe RAISES (empty price map) → SOL is NOT
    # indexable, so the adapter builds NO mark for it (never a fabricated 1.0). The
    # core refuses it downstream if it carries value.
    ex = _NativeAnchorStub(
        summaries=[
            {"currency": "USDC", "equity": 1000.0, "session_upl": 0.0},
            {"currency": "SOL", "equity": 5.0, "session_upl": 0.0},
        ],
        index_price={},  # every non-floor probe raises → SOL unindexable
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)
    assert "SOL" not in ledger.marks
    assert ledger.terminal_native_equity["SOL"] == pytest.approx(5.0)


async def test_build_native_ledger_mark_gap_propagates_core_refusal(
    monkeypatch: Any,
) -> None:
    import pandas as pd

    from services.native_nav import (
        UnmarkableCurrencyError,
        reconstruct_native_nav_and_twr,
    )

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            # BTC events on day1 + day3 ONLY (both have a mark); its balance carries
            # forward through day2.
            return [
                {"type": "settlement", "currency": "BTC", "change": 10.0,
                 "timestamp": _DAY1_MS},
                {"type": "settlement", "currency": "BTC", "change": 30.0,
                 "timestamp": _DAY3_MS},
            ]
        if currency == "USDC":
            # A USDC event on day2 puts day2 in the union calendar — so BTC's
            # carried-forward day2 balance now REQUIRES a day2 mark.
            return [{"type": "settlement", "currency": "USDC", "change": 5.0,
                     "timestamp": _DAY2_MS}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["BTC", "USDC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        # A GENUINE settlement-index publish gap on day2 — the adapter NEVER fills
        # it (T-80-05). day1 + day3 present (so the inception gate reconciles).
        return {"2024-01-01": 50000.0, "2024-01-03": 52000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 40.0, "session_upl": 0.0},
            {"currency": "USDC", "equity": 5.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 52000.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)
    # The gap survives into the marks (never filled).
    assert pd.Timestamp("2024-01-02") not in ledger.marks["BTC"].index
    # Feed the ASSEMBLED ledger to the landed 79 core: BTC carries a nonzero balance
    # forward onto USDC's day2, the mark is missing, and the core REFUSES.
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.reason == "missing_daily_marks"


async def test_build_native_ledger_completeness_report_passed_through(
    monkeypatch: Any,
) -> None:
    scopes = [di.Scope("main", None, True), di.Scope("sub_1", "101", False)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        raise di.LedgerTruncatedError("budget exhausted")

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["USDC"], "sub_1": ["USDC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "USDC", "equity": 1000.0, "session_upl": 0.0}],
    )
    _ledger, report = await di.build_deribit_native_ledger(ex)
    # The crawl's report is returned intact — the adapter does NOT swallow the
    # completeness gate; a truncated crawl still fails assert_ledger_complete.
    with pytest.raises(di.LedgerCompletenessError):
        di.assert_ledger_complete(report)


# ===========================================================================
# 80-02 HIGH-1 — native marks must match the USD path's coverage: the mark
# Series is the UNION of the per-event own-row index_price (_day_ccy_own_index,
# exactly the USD leg's resolution) and the get_delivery_prices supplemental.
# A currency classified INDEXED but with an empty/gappy get_delivery_prices is
# NO LONGER false-refused missing_daily_marks when its own rows carry an index.
# LOW-2 — an INDEXED currency whose MERGED map is empty OMITS the key so the
# F-1 build-time refusal fires cleanly (missing_day_count == 0).
# ===========================================================================


async def test_native_marks_sol_own_index_heals_empty_delivery_prices(
    monkeypatch: Any,
) -> None:
    """HIGH-1 (SOL target class): a SOL bucket classified INDEXED whose
    ``get_delivery_prices(sol_usd)`` returns ``{}`` but whose raw rows carry a SOL
    ``index_price`` on its event days is now VALUED by the core via the own-row
    index — no false ``missing_daily_marks`` refusal. Neuter (drop the own-index
    merge → marks come only from the empty delivery-price map → SOL is omitted and
    false-refuses)."""
    import pandas as pd

    from services.native_nav import reconstruct_native_nav_and_twr

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "SOL":
            # SOL settlements carrying their OWN same-day index_price on both days;
            # equity 5.0 == Σ change (2+3) so the inception gate reconciles to 0.
            return [
                {"type": "settlement", "currency": "SOL", "change": 2.0,
                 "index_price": 150.0, "timestamp": _DAY1_MS},
                {"type": "settlement", "currency": "SOL", "change": 3.0,
                 "index_price": 160.0, "timestamp": _DAY2_MS},
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["SOL"]}, paginate=_paginate,
    )

    # get_delivery_prices(sol_usd) is EMPTY — the narrower endpoint the pre-fix
    # planner relied on has no SOL settlement data at all.
    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    # sol_usd resolves on get_index_price → SOL is classified INDEXED.
    ex = _NativeAnchorStub(
        summaries=[{"currency": "SOL", "equity": 5.0, "session_upl": 0.0}],
        index_price={"SOL": 150.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)

    # The mark Series is populated from the OWN-ROW index (delivery-prices was empty).
    assert "SOL" in ledger.marks
    sol_marks = ledger.marks["SOL"]
    assert sol_marks.loc[pd.Timestamp("2024-01-01")] == pytest.approx(150.0)
    assert sol_marks.loc[pd.Timestamp(_DAY2_MS, unit="ms")] == pytest.approx(160.0)
    # The core VALUES SOL on those days instead of false-refusing missing_daily_marks.
    returns, _meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"SOL"}), venue="deribit"
    )
    assert isinstance(returns, pd.Series)


async def test_native_marks_btc_own_index_fills_delivery_price_gap(
    monkeypatch: Any,
) -> None:
    """HIGH-1 (BTC gap): a BTC event day MISSING from ``get_delivery_prices`` but
    present as an own-row ``index_price`` is covered by the union — the core values
    BTC with no refusal. Neuter (drop the own-index merge → the day2 delivery-price
    gap survives → the core refuses ``missing_daily_marks``)."""
    import pandas as pd

    from services.native_nav import reconstruct_native_nav_and_twr

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            # BTC events on day1/day2/day3, each carrying its own index_price; equity
            # 3.0 == Σ change so the inception gate reconciles to 0.
            return [
                {"type": "settlement", "currency": "BTC", "change": 1.0,
                 "index_price": 50000.0, "timestamp": _DAY1_MS},
                {"type": "settlement", "currency": "BTC", "change": 1.0,
                 "index_price": 51000.0, "timestamp": _DAY2_MS},
                {"type": "settlement", "currency": "BTC", "change": 1.0,
                 "index_price": 52000.0, "timestamp": _DAY3_MS},
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )

    # get_delivery_prices covers day1 + day3 but has a GAP on day2 — only the own-row
    # index_price supplies day2.
    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {"2024-01-01": 50000.0, "2024-01-03": 52000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 3.0, "session_upl": 0.0}],
        index_price={"BTC": 52000.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)

    # day2 — absent from delivery-prices — is present via the own-row index.
    btc_marks = ledger.marks["BTC"]
    assert btc_marks.loc[pd.Timestamp("2024-01-02")] == pytest.approx(51000.0)
    # The core values BTC across day1..day3 with no missing_daily_marks refusal.
    returns, _meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    assert isinstance(returns, pd.Series)


async def test_native_marks_empty_merged_map_omits_key_build_time_refusal(
    monkeypatch: Any,
) -> None:
    """LOW-2: a value-carrying INDEXED currency with NO marks from EITHER source
    (empty delivery-prices AND no own-row index) OMITS the key, so the F-1
    BUILD-time invariant refuses it LOUDLY — ``UnmarkableCurrencyError`` with
    ``missing_day_count == 0`` (the whole Series is absent, refused at
    ``_build_buckets``). SOL here holds real native EQUITY but has NO ledger cash
    rows (so the USD leg does not crash) — the canonical LOW-2 case. Neuter (store
    an empty Series instead of omitting → the build-time guard is skipped; the
    equity-only bucket then does not roll and ``reconstruct`` returns EMPTY with NO
    refusal, silently dropping SOL's real value → the ``pytest.raises`` reddens)."""
    from services.native_nav import (
        UnmarkableCurrencyError,
        reconstruct_native_nav_and_twr,
    )

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        return []  # NO ledger rows anywhere — the USD leg has nothing to value.

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["SOL"]}, paginate=_paginate,
    )

    # get_delivery_prices is empty AND there are no own-index rows → the merged map
    # is empty for a value-carrying INDEXED currency.
    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        # SOL held as real native equity; sol_usd resolves → SOL is INDEXED.
        summaries=[{"currency": "SOL", "equity": 5.0, "session_upl": 0.0}],
        index_price={"SOL": 150.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)
    # The empty map OMITS the key entirely — never an empty Series.
    assert "SOL" not in ledger.marks
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"SOL"}), venue="deribit"
        )
    assert exc.value.reason == "missing_daily_marks"
    # missing_day_count == 0 is the BUILD-time refusal signature (_build_buckets),
    # before any per-day calendar exists.
    assert exc.value.missing_day_count == 0


async def test_native_ledger_historical_swap_reconciles_and_swap_day_zero_return(
    monkeypatch: Any,
) -> None:
    """HIGH-1 (end-to-end): an account that DEPOSITED 60,000 USDC then SWAPPED it
    into 1.0 BTC reconciles under ``build_deribit_native_ledger`` →
    ``reconstruct_native_nav_and_twr`` with NO ``InceptionReconciliationError``,
    and the swap day's return is ~0 (the swap is USD-net-zero, so
    ``NAV_usd`` is continuous across it — only real slippage would show).

    Conservation: WITHOUT the native `swap` reclassification the swap legs VANISH.
    The USDC bucket then rolls a +60,000 deposit against a 0 terminal → a −60,000
    pre-history residual → the §5 inception gate BREACHES; the BTC bucket (1.0 BTC
    terminal, no ledger event) silently disappears from NAV. WITH the fix each leg
    enters native_pnl: USDC pre-history rolls to 0 and BTC's +1.0 pnl day explains
    its terminal → both reconcile to ~0.

    Neuter: revert `swap` to a plain INFORMATIONAL skip in ``txn_rows_to_native_daily``
    → ``reconstruct_native_nav_and_twr`` raises ``InceptionReconciliationError`` →
    this test (which asserts NO raise + a ~0 swap-day return) reddens."""
    import pandas as pd

    from services.native_nav import reconstruct_native_nav_and_twr

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "USDC":
            # Day-1 deposit of 60,000 USDC (external flow), then a day-2 swap leg
            # spending it (−60,000 USDC). The deposit is the pre-history explainer;
            # the swap leg is the INTERNAL rebalance that must reach native_pnl.
            return [
                {"type": "deposit", "currency": "USDC", "change": 60000.0,
                 "timestamp": _DAY1_MS},
                {"type": "swap", "currency": "USDC", "change": -60000.0,
                 "timestamp": _DAY2_MS},
            ]
        if currency == "BTC":
            # The other swap leg: +1.0 BTC acquired on day 2 (net-zero vs the
            # −60,000 USDC at the 60,000 BTC mark).
            return [
                {"type": "swap", "currency": "BTC", "change": 1.0,
                 "timestamp": _DAY2_MS},
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes,
        currencies={"main": ["USDC", "BTC"]}, paginate=_paginate,
    )

    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return {"2024-01-01": 60000.0, "2024-01-02": 60000.0}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)

    ex = _NativeAnchorStub(
        # Terminal: the USDC was fully swapped away (0), the 1.0 BTC is held.
        summaries=[
            {"currency": "USDC", "equity": 0.0, "session_upl": 0.0},
            {"currency": "BTC", "equity": 1.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 60000.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(ex)

    # The swap legs reached native_pnl on BOTH currencies (the count-once, native-
    # only inclusion): +1.0 BTC and −60,000 USDC on the swap day.
    assert ledger.native_pnl["BTC"].loc[pd.Timestamp("2024-01-02")] == pytest.approx(
        1.0
    )
    assert ledger.native_pnl["USDC"].loc[pd.Timestamp("2024-01-02")] == pytest.approx(
        -60000.0
    )

    # Reconciles (no InceptionReconciliationError) AND the swap day return is ~0.
    returns, _meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    assert returns.loc[pd.Timestamp("2024-01-02")] == pytest.approx(0.0, abs=1e-9)


# ===========================================================================
# Batch 2 — transient-read robustness (red-team HIGH-2 + LOW-1).
#
# Unifying principle: a TRANSIENT public-read blip (network/timeout/5xx →
# ccxt.NetworkError) must be RETRYABLE — retry with backoff, then raise
# DeribitTransientReadError (which classify_exception routes non-permanent) —
# NEVER silently return a partial/degraded input the core then mis-handles
# (permanent missing_daily_marks refuse, silent UNMARKABLE drop, or a silent
# clean 'complete' where legacy degraded to complete_with_warnings). A GENUINE
# structural condition (a genuinely-absent index → ccxt.ExchangeError/BadSymbol)
# stays an honest skip/return-partial, never retried forever.
# ===========================================================================


class _RepeatingDeliveryStub:
    """Serves ``pages`` in order, then RAISES ``after`` on every subsequent call
    (so a retry loop re-hitting the same offset keeps seeing the same error)."""

    def __init__(self, pages: list[Any], after: BaseException) -> None:
        self._pages = list(pages)
        self._after = after
        self.calls: list[dict[str, Any]] = []

    async def public_get_get_delivery_prices(self, params: dict[str, Any]) -> Any:
        self.calls.append(dict(params))
        if self._pages:
            return self._pages.pop(0)
        raise self._after


async def test_settlement_index_transient_midpage_raises_retryable() -> None:
    """HIGH-2.1 (RED): a mid-pagination TRANSIENT read (ccxt.RequestTimeout — a
    NetworkError subclass) on a page still needing rows is RETRIED with backoff and,
    on budget exhaustion, RAISES DeribitTransientReadError — a retryable disposition
    — rather than silently returning a truncated page-1 map that looks
    complete-but-sparse (which would drive a PERMANENT missing_daily_marks core
    refusal on a mere network blip).

    NEUTER: reverting the mid-pagination handler to swallow-and-return the partial
    ``prices`` makes the call RETURN a 100-day map (no raise) → pytest.raises RED."""
    from datetime import date, timedelta

    base = date(2026, 4, 10)
    page1 = _delivery_page(
        [((base - timedelta(days=i)).isoformat(), 60000.0 + i) for i in range(100)]
    )
    stub = _RepeatingDeliveryStub([page1], ccxt.RequestTimeout("read blip"))
    spy = _SleepSpy()
    with pytest.raises(DeribitTransientReadError):
        # oldest_day far in the past forces a second (transient-failing) page.
        await di.fetch_deribit_settlement_index(
            stub, "BTC", oldest_day="2000-01-01", sleep=spy, max_retries=2
        )
    # page 1 (rows) + 3 attempts at page 2 (initial + 2 retries) before exhaustion.
    assert len(stub.calls) == 4
    assert stub.calls[1]["offset"] == 100  # retried the SAME still-needed offset
    # Exponential backoff between the two retries (1, 2) — the read discipline.
    assert spy.waits[-2:] == [1.0, 2.0]


async def test_settlement_index_structural_nodata_returns_partial() -> None:
    """HIGH-2.1 (RED): a GENUINE benign 'no data' (ccxt.ExchangeError — the exchange
    RESPONDED, NOT a network error) mid-crawl returns the accumulated map as today —
    the own-index union + honest core refusal handle a genuine gap. It is NEVER
    retried forever nor escalated to DeribitTransientReadError.

    NEUTER: treating a structural ExchangeError as transient (retry+raise) makes this
    RAISE instead of returning the 100-day map → RED."""
    from datetime import date, timedelta

    base = date(2026, 4, 10)
    page1 = _delivery_page(
        [((base - timedelta(days=i)).isoformat(), 60000.0 + i) for i in range(100)]
    )
    stub = _RepeatingDeliveryStub([page1], ccxt.ExchangeError("no data for index"))
    spy = _SleepSpy()
    prices = await di.fetch_deribit_settlement_index(
        stub, "BTC", oldest_day="2000-01-01", sleep=spy, max_retries=2
    )
    assert len(prices) == 100  # page-1 map preserved; structural → honest partial
    assert len(stub.calls) == 2  # page 1 + ONE structural page-2 attempt (no retry)
    assert spy.waits == [1.0]  # only the inter-page pace, never a backoff retry


async def test_build_indexable_transient_probe_raises_retryable() -> None:
    """HIGH-2.2 (RED): a TRANSIENT probe (ccxt.RequestTimeout) for a value-carrying
    coin is RETRIED and, on exhaustion, RAISES DeribitTransientReadError — never
    silently DROPS a possibly-INDEXED currency to UNMARKABLE (which would drive a
    PERMANENT core refuse on a network blip).

    NEUTER: reverting the probe handler to swallow-and-continue drops SOL and returns
    the floor {BTC, ETH} with NO raise → pytest.raises RED."""
    stub = _IndexProbeStub({"sol_usd": ccxt.RequestTimeout("probe blip")})
    spy = _SleepSpy()
    with pytest.raises(DeribitTransientReadError):
        await di.build_deribit_indexable_currencies(
            stub, ["SOL"], sleep=spy, max_retries=2
        )
    # SOL probed initial + 2 retries before exhaustion (same index re-hit).
    assert stub.probed == ["sol_usd", "sol_usd", "sol_usd"]
    assert spy.waits == [1.0, 2.0]  # exponential backoff between retries


async def test_build_indexable_structural_probe_skips_not_retried() -> None:
    """HIGH-2.2 (RED): a GENUINE 'index not found' (ccxt.BadSymbol — a business
    response, NOT a network error) leaves the currency OUT (genuinely not indexable)
    exactly as today — probed ONCE, never retried, never raised.

    NEUTER: treating BadSymbol as transient makes this RAISE / re-probe → RED."""
    stub = _IndexProbeStub({"sol_usd": ccxt.BadSymbol("no such index")})
    spy = _SleepSpy()
    built = await di.build_deribit_indexable_currencies(
        stub, ["SOL"], sleep=spy, max_retries=2
    )
    assert built == frozenset({"BTC", "ETH"})  # floor only — SOL genuinely not indexed
    assert stub.probed == ["sol_usd"]  # probed exactly ONCE (no transient retry)
    assert spy.waits == []


async def test_native_account_state_transient_collapsed_probe_raises_retryable() -> None:
    """LOW-1 (RED): a TRANSIENT collapsed-anchor probe blip (ccxt.RequestTimeout) for
    a value-carrying held coin is RETRIED and, on exhaustion, RAISES
    DeribitTransientReadError — a retryable disposition — rather than silently
    setting balance_error=True and letting the branch proceed to a silent clean
    'complete' (skipping the C2 / FLOW-04 / uPnL-unreadable DQ checks gated on
    ``not balance_error``, where legacy degraded to complete_with_warnings).

    NEUTER: reverting the collapsed probe to swallow-and-continue returns a
    DeribitNativeAccountState with balance_error=True and NO raise → pytest.raises
    RED."""
    stub = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 1.5, "session_upl": 0.0}],
        index_price={"BTC": ccxt.RequestTimeout("anchor probe blip")},
    )
    spy = _SleepSpy()
    with pytest.raises(DeribitTransientReadError):
        await di.fetch_deribit_native_account_state(stub, sleep=spy, max_retries=2)
    assert spy.waits == [1.0, 2.0]  # retried with backoff before raising
    # A transient collapsed blip is RETRYABLE, never routed permanent.
    from services.job_worker import classify_exception

    assert classify_exception(DeribitTransientReadError("x"))[0] != "permanent"


async def test_native_account_state_structural_collapsed_probe_flags_balance_error(
) -> None:
    """LOW-1 (RED): a GENUINE unvaluable collapse — a held coin whose {ccy}_usd index
    genuinely does not resolve (ccxt.ExchangeError, a business response) — stays the
    honest structural degrade: balance_error=True with the readable native maps
    intact, NO raise (the core's structural refusal handles it, never an infinite
    retry).

    NEUTER: treating a structural ExchangeError as transient makes this RAISE
    DeribitTransientReadError → RED (an infinite retry on a genuine no-index)."""
    stub = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 1.5, "session_upl": 0.0}],
        index_price={"BTC": ccxt.ExchangeError("no index for BTC")},
    )
    spy = _SleepSpy()
    state = await di.fetch_deribit_native_account_state(stub, sleep=spy, max_retries=2)
    assert state.balance_error is True  # honest structural degrade
    assert state.native_equity == {"BTC": 1.5}  # readable native maps preserved
    assert state.collapsed_equity_usd is None
    assert spy.waits == []  # structural → never retried


# ===========================================================================
# 80-04 sparse-delivery fill: the {ccy}_USDC-PERPETUAL DAILY CLOSE fallback.
# A real Deribit coin key (SOL) carries material capital flows on days with no
# same-day trade (no own index_price) AND no get_delivery_prices entry (SOL's
# delivery series is sparse). Both the usd_signed flow leg and the native core's
# missing_daily_marks guard refused. fetch_deribit_perp_daily_index fills those
# days from the linear USDC perp's daily close — same-exchange same-UTC-day, and
# LOWEST precedence so dense-delivery coins (BTC/ETH) stay byte-identical.
# ===========================================================================


class _ChartDataStub:
    """Serves a scripted public/get_tradingview_chart_data response or error."""

    def __init__(self, script: list[Any]) -> None:
        self._script = list(script)
        self.calls: list[dict[str, Any]] = []

    async def public_get_get_tradingview_chart_data(
        self, params: dict[str, Any]
    ) -> Any:
        self.calls.append(dict(params))
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _chart_ok(day_price: list[tuple[str, float]]) -> dict[str, Any]:
    import pandas as pd

    ticks = [int(pd.Timestamp(d, tz="UTC").timestamp() * 1000) for d, _ in day_price]
    close = [p for _, p in day_price]
    return {"result": {"status": "ok", "ticks": ticks, "close": close}}


async def test_perp_daily_parses_maps_days_and_instrument() -> None:
    stub = _ChartDataStub(
        [_chart_ok([("2025-07-01", 149.13), ("2025-08-04", 166.05)])]
    )
    prices = await di.fetch_deribit_perp_daily_index(
        stub, "SOL", oldest_day="2025-07-01", sleep=_SleepSpy()
    )
    assert prices == {"2025-07-01": 149.13, "2025-08-04": 166.05}
    # The LINEAR USDC-quoted perp (never the coin-margined SOL-PERPETUAL) at 1D.
    assert stub.calls[0]["instrument_name"] == "SOL_USDC-PERPETUAL"
    assert stub.calls[0]["resolution"] == "1D"


async def test_perp_daily_skips_nonpositive_close() -> None:
    stub = _ChartDataStub(
        [_chart_ok([("2025-07-01", 149.0), ("2025-07-02", 0.0), ("2025-07-03", -1.0)])]
    )
    prices = await di.fetch_deribit_perp_daily_index(
        stub, "SOL", oldest_day="2025-07-01", sleep=_SleepSpy()
    )
    assert prices == {"2025-07-01": 149.0}  # 0 and negative closes dropped


async def test_perp_daily_status_not_ok_returns_empty() -> None:
    stub = _ChartDataStub([{"result": {"status": "no_data", "ticks": [], "close": []}}])
    prices = await di.fetch_deribit_perp_daily_index(
        stub, "SOL", oldest_day="2025-07-01", sleep=_SleepSpy()
    )
    assert prices == {}


async def test_perp_daily_structural_nodata_returns_empty() -> None:
    # A coin with no USDC perp → BadSymbol (the exchange RESPONDED): benign, {}.
    stub = _ChartDataStub([ccxt.BadSymbol("no such instrument")])
    prices = await di.fetch_deribit_perp_daily_index(
        stub, "DOGE", oldest_day="2025-07-01", sleep=_SleepSpy()
    )
    assert prices == {}
    assert len(stub.calls) == 1  # structural → NOT retried


async def test_perp_daily_transient_raises_retryable() -> None:
    # A NetworkError (RequestTimeout) is RETRYABLE: retry with backoff, then raise
    # DeribitTransientReadError on budget exhaustion — never a silent empty map that
    # would drive a PERMANENT missing_daily_marks refusal on a mere blip.
    stub = _ChartDataStub([ccxt.RequestTimeout("blip")] * 3)
    spy = _SleepSpy()
    with pytest.raises(DeribitTransientReadError):
        await di.fetch_deribit_perp_daily_index(
            stub, "SOL", oldest_day="2025-07-01", sleep=spy, max_retries=2
        )
    assert len(stub.calls) == 3  # initial + 2 retries
    assert spy.waits == [1.0, 2.0]  # exponential backoff


def test_price_map_has_gap() -> None:
    # Dense-daily (BTC/ETH shape) spanning [oldest, newest] → NO gap → no perp fetch.
    dense = {"2025-07-01": 1.0, "2025-07-02": 1.0, "2025-07-03": 1.0}
    assert di._price_map_has_gap(dense, "2025-07-01", "2025-07-03") is False
    # Internal calendar gap → needs the perp fill.
    assert di._price_map_has_gap(
        {"2025-07-01": 1.0, "2025-07-03": 1.0}, "2025-07-01", "2025-07-03"
    )
    # A single day at the span START leaves later carry-forward days unmarked (the
    # exact SOL trap: no INTERNAL gap, but doesn't reach newest) → gap.
    assert di._price_map_has_gap({"2025-07-01": 1.0}, "2025-07-01", "2025-07-03")
    # Empty → gap. Not reaching back to oldest → gap.
    assert di._price_map_has_gap({}, "2025-07-01", "2025-07-03") is True
    assert di._price_map_has_gap({"2025-07-03": 1.0}, "2025-07-01", "2025-07-03")


class _MarksStubExchange:
    """Combined stub: sparse delivery-prices + dense USDC-perp daily close."""

    def __init__(
        self, delivery: dict[str, float], perp: dict[str, float]
    ) -> None:
        self._delivery = delivery
        self._perp = perp
        self.perp_calls = 0

    async def public_get_get_delivery_prices(self, params: dict[str, Any]) -> Any:
        # One full page then exhaustion (the fetcher stops on the empty page).
        if params.get("offset", 0) == 0 and self._delivery:
            return {
                "result": {
                    "data": [
                        {"date": d, "delivery_price": p}
                        for d, p in self._delivery.items()
                    ]
                }
            }
        return {"result": {"data": []}}

    async def public_get_get_tradingview_chart_data(
        self, params: dict[str, Any]
    ) -> Any:
        self.perp_calls += 1
        return _chart_ok(sorted(self._perp.items()))


async def test_build_dense_native_marks_fills_sparse_delivery_with_perp() -> None:
    """RED without the fix: a SOL series spanning 07-01..07-03 with delivery holding
    ONLY 07-01 leaves 07-02/07-03 unmarked → core refuses missing_daily_marks. The
    perp daily-close fill densifies the span; delivery WINS on the shared 07-01."""
    import pandas as pd

    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in ("2025-07-01", "2025-07-03")])
    native_pnl = {"SOL": pd.Series([10.0, 5.0], index=idx, name="native_pnl")}
    stub = _MarksStubExchange(
        delivery={"2025-07-01": 150.0},  # sparse: 07-02, 07-03 absent
        perp={"2025-07-01": 149.0, "2025-07-02": 151.0, "2025-07-03": 166.0},
    )
    marks = await di._build_dense_native_marks(
        stub,
        indexable={"SOL"},
        native_pnl=native_pnl,
        native_flows=[],
        terminal_native_equity={"SOL": 0.0},
        terminal_upnl_native={},
        raw_rows=[],
        sleep=_SleepSpy(),
    )
    sol = marks["SOL"]
    got = {d.strftime("%Y-%m-%d"): float(v) for d, v in sol.items()}
    assert got == {"2025-07-01": 150.0, "2025-07-02": 151.0, "2025-07-03": 166.0}
    assert stub.perp_calls == 1  # perp fetched exactly once for the gap


async def test_build_dense_native_marks_dense_delivery_skips_perp() -> None:
    """SC-4: a dense-daily delivery feed (BTC/ETH shape) covers the whole span, so
    the perp fill is NEVER fetched → byte-identical to pre-80-04 behaviour."""
    import pandas as pd

    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in ("2025-07-01", "2025-07-02")])
    native_pnl = {"BTC": pd.Series([1.0, 1.0], index=idx, name="native_pnl")}
    stub = _MarksStubExchange(
        delivery={"2025-07-01": 60000.0, "2025-07-02": 61000.0},  # dense
        perp={"2025-07-01": 1.0, "2025-07-02": 1.0},  # would corrupt if used
    )
    marks = await di._build_dense_native_marks(
        stub,
        indexable={"BTC"},
        native_pnl=native_pnl,
        native_flows=[],
        terminal_native_equity={"BTC": 0.0},
        terminal_upnl_native={},
        raw_rows=[],
        sleep=_SleepSpy(),
    )
    got = {d.strftime("%Y-%m-%d"): float(v) for d, v in marks["BTC"].items()}
    assert got == {"2025-07-01": 60000.0, "2025-07-02": 61000.0}
    assert stub.perp_calls == 0  # dense delivery → perp never consulted


# ===========================================================================
# Phase 82 — options-aware native ledger: coverage-gated re-attribution +
# balance-identity guard wiring + pre-coverage (Q6) flag. All through the REAL
# build_deribit_native_ledger seam (synthetic BTC options rows/summaries + a
# monkeypatched settlement index — no network). RED-first: pre-fix the adapter
# sums option premium as native pnl, ignores the summary channel, and never
# invokes the guard.
# ===========================================================================

import datetime as _dt  # noqa: E402


def _jul_ms(day: int, hour: int = 12) -> int:
    """Epoch-ms for a 2025-07-`day` instant (covered-era anchor)."""
    return int(
        _dt.datetime(2025, 7, day, hour, tzinfo=_dt.timezone.utc).timestamp() * 1000
    )


def _btc_summary(day: int, *, rpl: float = 0.0, upl: float = 0.0) -> dict[str, Any]:
    return {
        "type": "options_settlement_summary",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": "BTC",
        "change": 0.0,
        "realized_pl": rpl,
        "unrealized_pl": upl,
        "timestamp": _jul_ms(day, 8),
    }


def _btc_option_trade(
    day: int, *, change: float, commission: float = 0.01
) -> dict[str, Any]:
    return {
        "type": "trade",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": "BTC",
        "change": change,
        "commission": commission,
        "timestamp": _jul_ms(day, 10),
    }


_JUL_INDEX = {f"2025-07-{d:02d}": 60000.0 for d in range(8, 16)}


def _patch_jul_index(monkeypatch: Any) -> None:
    async def _fetch_index(
        _ex: Any, currency: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        return dict(_JUL_INDEX)

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _fetch_index)


async def test_native_ledger_covered_options_reattributed_and_marks_dense(
    monkeypatch: Any,
) -> None:
    """A covered-era BTC options account through the REAL adapter: option premium
    is EXCLUDED (fee-only) and the summary channel enters native_pnl; the dense
    marks span covers the summary-only day; the balance-identity guard closes.

    Pre-fix: native_pnl[BTC][07-13] would be +1.0 (premium) and there would be no
    07-12 summary entry — this asserts −0.01 and +1.01 respectively → RED."""
    import pandas as pd

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_summary(12, rpl=0.6, upl=0.41),   # carries fee-gross 1.01
                _btc_summary(14, rpl=0.0, upl=0.0),    # upper window bound
                _btc_option_trade(13, change=1.0, commission=0.01),  # inside → −0.01
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 1.0, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")

    btc = ledger.native_pnl["BTC"]
    assert btc.loc[pd.Timestamp("2025-07-12")] == pytest.approx(1.01, abs=1e-9)
    assert btc.loc[pd.Timestamp("2025-07-13")] == pytest.approx(-0.01, abs=1e-9)
    # Dense marks cover the summary-only day 07-12 (it is a native_pnl day).
    assert pd.Timestamp("2025-07-12") in ledger.marks["BTC"].index
    assert pd.Timestamp("2025-07-13") in ledger.marks["BTC"].index
    # Fully covered → no pre-coverage buckets.
    assert report.pre_coverage_option_days == []


async def test_native_ledger_broken_midwindow_closure_raises(
    monkeypatch: Any,
) -> None:
    """The guard is INVOKED at the build call site (wiring-guard discipline): a
    mid-window session with option premium but NO carrying summary breaches the
    balance identity → LedgerValuationError at ledger build.

    Neuter: removing the assert_balance_identity call from the adapter makes this
    build succeed (premium silently dropped) → RED."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_summary(12, rpl=0.0, upl=0.0),   # window bounds only
                _btc_summary(14, rpl=0.0, upl=0.0),
                _btc_option_trade(13, change=1.0, commission=0.01),  # premium dropped
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 1.0, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    with pytest.raises(LedgerValuationError):
        await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")


async def test_native_ledger_pre_coverage_option_days_reported(
    monkeypatch: Any,
) -> None:
    """A pre-rollout BTC option row (before first_summary−24h) falls back to
    cash-basis change and its (ccy, day) bucket is reported for the Q6 warning;
    the balance identity still closes (cash contributions ARE the changes)."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_summary(12, rpl=0.0, upl=0.0),
                _btc_summary(14, rpl=0.0, upl=0.0),
                _btc_option_trade(9, change=2.0),   # pre-rollout → cash fallback
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    _ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")
    assert report.pre_coverage_option_days == [("BTC", "2025-07-09")]


async def test_mixed_era_options_account_resolves_complete_with_warnings(
    monkeypatch: Any,
) -> None:
    """M1 end-to-end: a mixed-era account (covered + pre-rollout option days)
    stamps `pre_summary_rollout_option_dailies` (worker Q6 stamp) and the status
    merge resolves to `complete_with_warnings`, NOT bare `complete` — the flag is
    a registered NAV_TWR_GUARD_KEYS promoter.

    Pre-M1 (flag not in the allow-list): the merge would return `complete` → RED."""
    from services.broker_dailies import combine_native_ledger
    from services.transforms import _merge_status_meta

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_summary(12, rpl=0.6, upl=0.41),
                _btc_summary(14, rpl=0.0, upl=0.0),
                _btc_option_trade(13, change=1.0, commission=0.01),  # covered
                _btc_option_trade(9, change=2.0),                    # pre-rollout
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 3.0, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")
    assert report.pre_coverage_option_days == [("BTC", "2025-07-09")]

    _returns, meta = combine_native_ledger(ledger, report.indexable_currencies)
    # The worker Q6 stamp (job_worker deribit branch):
    meta["pre_summary_rollout_option_dailies"] = [
        f"{ccy}:{day}" for ccy, day in report.pre_coverage_option_days
    ]
    merged = _merge_status_meta(
        meta, used_heuristic_capital=False, balance_error=False
    )
    assert merged["computation_status_hint"] == "complete_with_warnings"
    # The bucket list is carried through verbatim (not coerced to a bare bool).
    assert merged["pre_summary_rollout_option_dailies"] == ["BTC:2025-07-09"]


# ===========================================================================
# Phase 82 Task 2b — combined options+futures session uPnL wedge (§2 Q5). The
# legacy read (summ.get("session_upl")) is FUTURES-only; the §5 wedge must be
# options_session_upl + futures_session_upl so an open options book's inception
# gate closes. BYTE-SAFE for perp-only (options component absent → unchanged).
# ===========================================================================


def test_combined_session_upl_perp_only_byte_identical() -> None:
    """SC-4: a perp-only summary (only the legacy session_upl, no
    options_session_upl) reads BYTE-IDENTICAL to the raw session_upl — the
    options component defaults to 0.0 and is never options-unreadable."""
    value, read_any, opt_unreadable = di._combined_session_upl(
        {"currency": "BTC", "session_upl": 1.5}
    )
    assert value == pytest.approx(1.5, abs=1e-12)
    assert read_any is True
    assert opt_unreadable is False


def test_combined_session_upl_sums_options_and_futures() -> None:
    """An options summary carrying BOTH components sums them (fails pre-fix: the
    futures-only read drops the options component)."""
    value, read_any, _ = di._combined_session_upl(
        {"currency": "BTC", "session_upl": 1.5, "options_session_upl": 0.4}
    )
    assert value == pytest.approx(1.9, abs=1e-12)
    assert read_any is True
    # Explicit futures_session_upl is preferred over legacy session_upl (never
    # double-counted with it) and still adds the options component.
    value2, _r, _o = di._combined_session_upl(
        {
            "currency": "BTC",
            "futures_session_upl": 1.5,
            "session_upl": 1.5,
            "options_session_upl": 0.4,
        }
    )
    assert value2 == pytest.approx(1.9, abs=1e-12)


def test_combined_session_upl_all_absent_is_unreadable() -> None:
    """No wedge component present → read_any False (the MUST-2 unreadable signal
    is preserved: a wholly-absent wedge is 'unreadable', not a silent flat 0.0)."""
    value, read_any, _ = di._combined_session_upl({"currency": "BTC"})
    assert value == pytest.approx(0.0, abs=1e-12)
    assert read_any is False
    # A genuine flat 0.0 IS read (readable iff any component read numerically).
    _v, read2, _o = di._combined_session_upl({"currency": "BTC", "session_upl": 0.0})
    assert read2 is True


def test_combined_session_upl_open_book_missing_options_leg_is_unreadable() -> None:
    """F1: an OPEN option book (`options_value` != 0) with a READABLE futures leg
    but an ABSENT/non-numeric `options_session_upl` is options-UNREADABLE — the
    futures leg must NOT mask the missing options wedge (the pre-fix OR-accumulator
    silently coerced it to 0.0 with no signal)."""
    # Readable futures leg + missing options leg on an open book → unreadable.
    _v, read_any, opt_unreadable = di._combined_session_upl(
        {"currency": "BTC", "futures_session_upl": 1.5, "options_value": 0.7}
    )
    assert read_any is True          # futures leg read fine (would mask pre-fix)
    assert opt_unreadable is True
    # A non-numeric options leg on an open book is ALSO unreadable (never a
    # fabricated 0.0).
    _v2, _r2, opt_unreadable2 = di._combined_session_upl(
        {"currency": "BTC", "session_upl": 1.5, "options_session_upl": "x",
         "options_value": 0.7}
    )
    assert opt_unreadable2 is True
    # Perp-only (options_value 0/absent) is never options-unreadable.
    _v3, _r3, opt_unreadable3 = di._combined_session_upl(
        {"currency": "BTC", "session_upl": 1.5}
    )
    assert opt_unreadable3 is False
    # An open book WITH a readable options leg is readable.
    _v4, _r4, opt_unreadable4 = di._combined_session_upl(
        {"currency": "BTC", "session_upl": 1.5, "options_session_upl": 0.2,
         "options_value": 0.7}
    )
    assert opt_unreadable4 is False


def test_combined_session_upl_present_but_null_futures_consults_fallback() -> None:
    """F2: a PRESENT-but-null `futures_session_upl` must consult the legacy
    `session_upl` fallback (pre-fix the loop broke on key PRESENCE, so a null
    preferred field silently dropped the real value → 0.0 wedge)."""
    value, read_any, _ = di._combined_session_upl(
        {"currency": "BTC", "futures_session_upl": None, "session_upl": 1.2}
    )
    assert value == pytest.approx(1.2, abs=1e-12)
    assert read_any is True
    # Null futures + null fallback → wholly unreadable (read_any False, no fabricate).
    _v, read2, _o = di._combined_session_upl(
        {"currency": "BTC", "futures_session_upl": None, "session_upl": None}
    )
    assert read2 is False
    # A successful preferred read still wins and does NOT also consult the fallback
    # (never double-count two present spellings).
    value3, _r3, _o3 = di._combined_session_upl(
        {"currency": "BTC", "futures_session_upl": 1.5, "session_upl": 9.9}
    )
    assert value3 == pytest.approx(1.5, abs=1e-12)


def test_combined_session_upl_garbled_futures_leg_is_unreadable() -> None:
    """F3 (regression): a GARBLED (present-but-non-numeric) FUTURES wedge is schema
    drift → the combined component-unreadable signal fires, SYMMETRIC to the options
    leg, even when a readable options leg would otherwise mask it. The garbled leg
    contributes 0.0 (never fabricated). Pre-fix the futures leg tracked no
    unreadable signal, so a readable options leg set read_any=True and shipped a
    silently-zeroed futures wedge clean.

    NOTE: the third return element is now the COMBINED component-unreadable flag
    (options-leg OR futures-leg), lifted by the caller into
    unrealized_pnl_unreadable — see `_combined_session_upl`."""
    # (a) garbled futures `session_upl` masked by a readable options leg → unreadable.
    value, read_any, unreadable = di._combined_session_upl(
        {"currency": "BTC", "session_upl": "GARBLED", "options_session_upl": 0.4,
         "options_value": 0.7}
    )
    assert value == pytest.approx(0.4, abs=1e-12)  # only options leg (futures → 0.0)
    assert read_any is True            # options leg read (masks the garble pre-fix)
    assert unreadable is True          # garbled futures leg surfaced (F3)
    # A garbled EXPLICIT futures_session_upl is likewise unreadable (no options leg).
    _v2, _r2, unreadable2 = di._combined_session_upl(
        {"currency": "BTC", "futures_session_upl": "x"}
    )
    assert unreadable2 is True
    # (b) SC-4: clean perp-only (numeric session_upl, no options) → byte-identical
    # value, read, and NOT unreadable — no new flag on a healthy perp-only account.
    v3, r3, unreadable3 = di._combined_session_upl(
        {"currency": "BTC", "session_upl": 1.5}
    )
    assert v3 == pytest.approx(1.5, abs=1e-12)
    assert r3 is True
    assert unreadable3 is False
    # (c) ABSENT session_upl entirely → benign (existing behavior): read_any False,
    # NOT unreadable (absent ≠ garbled; never fabricated).
    v4, r4, unreadable4 = di._combined_session_upl({"currency": "BTC"})
    assert v4 == pytest.approx(0.0, abs=1e-12)
    assert r4 is False
    assert unreadable4 is False


def test_deribit_session_upl_garbled_futures_masked_by_options_reddens() -> None:
    """F3 (regression, account-level RED-proof): a GARBLED futures wedge on one
    summary, MASKED by a readable options leg, must still raise the account-level
    unreadable signal `_deribit_session_upl_to_usd` returns. Pre-fix the readable
    options leg set read_any=True and the account shipped a silently-zeroed FUTURES
    wedge as clean `complete` — this asserts it now reddens (unreadable=True) with
    the futures value still honestly 0.0 (never fabricated). The options leg reads
    fine here, so the ONLY path to unreadable=True is the F3 futures-garble signal —
    isolating the regression from the F1 options-leg signal."""
    total, unreadable = di._deribit_session_upl_to_usd(
        [{"currency": "BTC", "session_upl": "GARBLED", "options_session_upl": 0.4,
          "options_value": 0.7}],
        {"BTC": 60000.0},
    )
    # Garbled futures → 0.0 contribution; options 0.4 BTC × 60000 index.
    assert total == pytest.approx(0.4 * 60000.0, abs=1e-6)
    assert unreadable is True


async def test_native_account_state_open_book_missing_options_leg_warns() -> None:
    """F1 end-to-end: an OPEN-options account whose futures wedge reads but whose
    options wedge field is absent surfaces `upnl_unreadable` (→
    unrealized_pnl_unreadable warning), NOT a silent 0-wedge overstatement."""
    opts = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.3,
                    "options_value": 0.7}],
        index_price={"BTC": 60000.0},
    )
    state = await di.fetch_deribit_native_account_state(opts)
    assert state.upnl_unreadable is True


async def test_native_account_state_wedge_is_combined(monkeypatch: Any) -> None:
    """fetch_deribit_native_account_state's native_upnl is the COMBINED wedge; a
    perp-only account stays byte-identical, an options account sums both."""
    perp = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.3}],
        index_price={"BTC": 60000.0},
    )
    state_perp = await di.fetch_deribit_native_account_state(perp)
    assert state_perp.native_upnl == {"BTC": pytest.approx(0.3, abs=1e-12)}

    opts = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 2.0, "session_upl": 0.3,
             "options_session_upl": 0.5}
        ],
        index_price={"BTC": 60000.0},
    )
    state_opts = await di.fetch_deribit_native_account_state(opts)
    # Combined 0.8 (fails pre-fix futures-only read = 0.3).
    assert state_opts.native_upnl == {"BTC": pytest.approx(0.8, abs=1e-12)}


async def test_native_account_state_reads_options_value_per_currency() -> None:
    """CR-01 step 1: `native_options_value` is read off the SAME summaries response
    (`options_value` per currency) — a nonzero value marks a provably-OPEN option
    book for the balance-identity exemption. Absent on perp-only summaries → 0.0
    (SC-4 byte-safe pattern)."""
    opts = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 2.0, "session_upl": 0.3,
             "options_value": 0.7},
            {"currency": "ETH", "equity": 5.0, "session_upl": 0.0},  # no options_value
        ],
        index_price={"BTC": 60000.0, "ETH": 3000.0},
    )
    state = await di.fetch_deribit_native_account_state(opts)
    assert state.native_options_value["BTC"] == pytest.approx(0.7, abs=1e-12)
    # ETH summary has NO options_value → 0.0 (never fabricated), byte-safe.
    assert state.native_options_value["ETH"] == pytest.approx(0.0, abs=1e-12)


async def test_native_account_state_options_value_empty_on_failed_read() -> None:
    """A failed / empty summaries read yields an EMPTY native_options_value map
    (the error constructors pass `{}`), consistent with the other native maps."""
    failed = _NativeAnchorStub(summaries_exc=RuntimeError("boom"))
    state = await di.fetch_deribit_native_account_state(failed)
    assert state.native_options_value == {}
    empty = _NativeAnchorStub(summaries=[])
    state2 = await di.fetch_deribit_native_account_state(empty)
    assert state2.native_options_value == {}


# ===========================================================================
# Phase 82 Task 3 — END-TO-END through the production seam
# (build_deribit_native_ledger → combine_native_ledger): a covered options
# account returns SANE daily returns (premium day ≈ −fee/NAV, not the pre-fix
# +65% spike) and the §5 inception gate closes; a material summary perturbation
# is load-bearing (breaches the guard); the TOTAL is era-invariant.
# ===========================================================================


def _btc_deposit(day: int, *, change: float) -> dict[str, Any]:
    return {
        "type": "deposit",
        "currency": "BTC",
        "change": change,
        "timestamp": _jul_ms(day, 6),
    }


async def _covered_options_ledger(monkeypatch: Any, *, perturb_rpl: float = 0.0):
    """A covered-era BTC options account seeded by a 1.0 BTC deposit: option
    premium excluded (fee-only), summary carries the fee-gross economics, §5
    closes (terminal 2.0 BTC = Σpnl 1.0 + Σflow 1.0). ``perturb_rpl`` materially
    corrupts the summary to prove the balance-identity guard is load-bearing."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_deposit(10, change=1.0),                       # external capital
                _btc_summary(12, rpl=0.6 + perturb_rpl, upl=0.4007),  # fee-gross 1.0007
                _btc_summary(14, rpl=0.0, upl=0.0),                # window upper bound
                _btc_option_trade(13, change=1.0, commission=0.0007),  # inside → −0.0007
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    return await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")


async def test_e2e_covered_options_sane_returns_and_inception_closes(
    monkeypatch: Any,
) -> None:
    """The premium day (2025-07-13) return is ≈ −fee/NAV (|r| < 0.01), NOT the
    pre-fix +65% premium spike, AND the §5 inception gate closes (no
    InceptionReconciliationError). Pre-fix: day-13 native_pnl would be +1.0 BTC
    (premium) → a >100% spike → RED."""
    import pandas as pd

    from services.broker_dailies import combine_native_ledger

    ledger, report = await _covered_options_ledger(monkeypatch)
    returns, meta = combine_native_ledger(ledger, report.indexable_currencies)

    r13 = float(returns.loc[pd.Timestamp("2025-07-13")])
    assert abs(r13) < 0.01, f"premium day return {r13} should be fee-sized, not a spike"
    assert pd.notna(r13)
    # combine_native_ledger did NOT raise InceptionReconciliationError → §5 closed.
    # (The inception-seed deposit legitimately trips flow_dominated on day-0, an
    # artifact of the minimal fixture — unrelated to the options fix — so the
    # status may be complete_with_warnings; what matters is no inception BREACH.)
    assert meta["computation_status_hint"] in ("complete", "complete_with_warnings")
    # A fully-covered account is NOT flagged pre-coverage.
    assert "pre_summary_rollout_option_dailies" not in meta
    assert report.pre_coverage_option_days == []


async def test_e2e_material_summary_perturbation_breaches_guard(
    monkeypatch: Any,
) -> None:
    """Mutation-honesty: perturbing one summary's realized_pl by a MATERIAL amount
    breaks the covered-era closure (Σ(rpl+upl) ≠ Σ_inside(change+commission)) →
    assert_balance_identity raises at ledger build → the identity is load-bearing,
    not tolerant-by-accident."""
    with pytest.raises(LedgerValuationError):
        await _covered_options_ledger(monkeypatch, perturb_rpl=0.5)


async def test_e2e_total_is_era_invariant(monkeypatch: Any) -> None:
    """A mixed-era account: covered-era option days are reshaped (fee-only) and
    pre-coverage option days stay cash-basis, but the per-currency TOTAL native
    pnl equals Σchange over cash-bearing rows either way (the balance identity
    holds across both eras — Σchange is exact regardless of era)."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_summary(12, rpl=0.6, upl=0.4007),   # covered fee-gross 1.0007
                _btc_summary(14, rpl=0.0, upl=0.0),
                _btc_option_trade(13, change=1.0, commission=0.0007),  # covered → −0.0007
                _btc_option_trade(9, change=0.3),        # pre-rollout → cash 0.3
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 1.3, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")

    # Σ native pnl BTC == Σchange over cash-bearing rows (both eras): the covered
    # day (−0.0007) + pre-rollout day (+0.3) + summary (+1.0007) = 1.3; Σchange
    # over the two option trades = 1.0 + 0.3 = 1.3. Era-invariant total.
    total_native = float(ledger.native_pnl["BTC"].sum())
    assert total_native == pytest.approx(1.3, abs=1e-9)
    # The pre-rollout day is FLAGGED (cash-basis), the covered day is not.
    assert report.pre_coverage_option_days == [("BTC", "2025-07-09")]


async def test_allocated_capital_path_and_null_config_byte_identical(
    monkeypatch: Any,
) -> None:
    """Item 3 (allocated-capital denominator) through the production seam:

    * config=None (EVERY normal strategy) → the NAV reconstruction path,
      BYTE-IDENTICAL to the no-arg ``combine_native_ledger`` (same returns Series,
      same meta, no ``returns_denominator`` marker);
    * config PRESENT → the allocated-capital path: returns = daily_pnl_usd / capital,
      BYPASSING ``reconstruct_native_nav_and_twr``/§5, with the zavara-convention
      metrics on ``meta``. Reuses the ledger's ``native_pnl`` × ``marks`` (Option 2 —
      the validated series), so the daily_pnl_usd never leaks a spot extraction."""
    import pandas as pd

    from services.allocated_capital import parse_returns_denominator_config
    from services.broker_dailies import combine_native_ledger

    ledger, report = await _covered_options_ledger(monkeypatch)

    # NULL-config → NAV path, byte-identical to the no-arg call.
    nav_returns, nav_meta = combine_native_ledger(ledger, report.indexable_currencies)
    nav_returns2, nav_meta2 = combine_native_ledger(
        ledger, report.indexable_currencies, denominator_config=None
    )
    pd.testing.assert_series_equal(nav_returns, nav_returns2)
    assert nav_meta == nav_meta2
    assert "returns_denominator" not in nav_meta  # NAV path — no allocated marker

    # WITH config → allocated-capital path (bypasses §5; marked in meta).
    cfg = parse_returns_denominator_config(
        {
            "denominator": "allocated_capital",
            "pnl_basis": "mark_to_market",
            "capital_schedule": [
                {"effective_from": "2025-07-01", "capital_usd": 1_000_000}
            ],
            "metrics_basis": "active_day",
        }
    )
    ac_returns, ac_meta = combine_native_ledger(
        ledger, report.indexable_currencies, denominator_config=cfg
    )
    assert ac_meta["returns_denominator"] == "allocated_capital"
    assert "cumulative_return_pct" in ac_meta and "max_drawdown_pct" in ac_meta
    assert len(ac_returns) > 0
    # The allocated path is INDEPENDENT of the NAV reconstruction (different math).
    assert ac_returns.name == "returns"


# ===========================================================================
# CR-01 — open-option balance-identity exemption through the production seam.
# An OPEN option book at crawl leaves the strict guard's residual = terminal open
# MTM (it closes only for a flat-at-settlement book). The exemption lets §5 be the
# authoritative reconciliation; a real hole for the exempted currency still fails
# loud at §5. Fixtures reuse the _btc_* / _NativeAnchorStub seam helpers.
# ===========================================================================


def _open_book_paginate(*, drop_day12_summary: bool = False):
    """A covered-era BTC options account with an OPEN position at crawl: the
    day-12 summary carries +0.5 unrealized STILL open (Σupl telescopes to a
    terminal open MTM of +0.09 vs the flat-closing 1.01), so the strict identity
    residual is 0.09 → it would false-fire without the CR-01 exemption.

    ``drop_day12_summary`` injects a MISSING-summary hole of size 1.1 → §5 must
    fire (InceptionReconciliationError) for the exempted currency."""

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency != "BTC":
            return []
        rows: list[Any] = [_btc_deposit(10, change=1.0)]  # seed capital (flow)
        if not drop_day12_summary:
            rows.append(_btc_summary(12, rpl=0.6, upl=0.5))  # 1.1 incl open unreal.
        rows.append(_btc_summary(14, rpl=0.0, upl=0.0))      # upper window bound
        rows.append(_btc_option_trade(13, change=1.0, commission=0.01))  # −0.01
        return rows

    return _paginate


async def test_open_book_exempt_passes_and_flat_book_still_guarded(
    monkeypatch: Any,
) -> None:
    """CR-01 REGRESSION: an OPEN-book account (options_value != 0, telescoping
    summaries) FAILS the strict guard today (residual = terminal open MTM 0.09) and
    PASSES with the exemption. Neuter (drop the open_option_ccys wiring / read
    options_value as 0) → build raises LedgerValuationError → RED.

    Companion: a FLAT quiet book (no options_value, no trailing rows) exempts
    NOTHING → the strict guard still runs and closes (byte regression preserved)."""
    scopes = [di.Scope("main", None, True)]
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(),
    )
    _patch_jul_index(monkeypatch)

    # OPEN book: anchor summary carries a nonzero options_value → BTC exempt.
    open_ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.59, "session_upl": 0.5,
                    "options_value": 0.5}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(open_ex, pnl_basis="mark_to_market")
    # Exemption surfaced for the harness (NOT a warning — an open book is normal).
    assert report.balance_identity_open_option_ccys == ["BTC"]
    # §5 still closes for the intact open book (no InceptionReconciliationError).
    from services.broker_dailies import combine_native_ledger

    combine_native_ledger(ledger, report.indexable_currencies)  # must not raise

    # FLAT quiet book (Phoenix-shaped): a fully-covered flat closure with NO
    # options_value → nothing exempted → the strict guard runs and closes.
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_covered_flat_paginate(),
    )
    flat_ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 1.0, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    _fledger, freport = await di.build_deribit_native_ledger(flat_ex, pnl_basis="mark_to_market")
    assert freport.balance_identity_open_option_ccys == []  # nothing exempted


async def test_b1_cash_settlement_disables_open_option_exemption(
    monkeypatch: Any,
) -> None:
    """B1 (BLOCKER): ``build_deribit_native_ledger`` applies the open-option
    exemption ONLY under mark_to_market. Under cash_settlement (the allocated /
    Zavara path, where §5 is BYPASSED by combine_native_ledger) an OPEN-book account
    is NOT exempted → ``open_option_ccys=frozenset()`` → the strict Σnative==Σchange
    identity stays live (the ONLY fail-loud reconciliation on that path).

    Mutation-honest: reverting the pnl_basis gate makes the cash_settlement build
    report ['BTC'] (exempted) → RED here."""
    scopes = [di.Scope("main", None, True)]
    anchor = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.5,
                    "options_value": 0.5}],
        index_price={"BTC": 60000.0},
    )
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(),
    )
    _patch_jul_index(monkeypatch)
    # cash_settlement (DEFAULT): open book NOT exempted; strict guard runs + closes
    # (every option row books full change so Σnative == Σchange exactly).
    _lc, rc = await di.build_deribit_native_ledger(anchor)
    assert rc.balance_identity_open_option_ccys == []

    # mark_to_market: the open book IS exempted (existing behaviour preserved).
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(),
    )
    _lm, rm = await di.build_deribit_native_ledger(anchor, pnl_basis="mark_to_market")
    assert rm.balance_identity_open_option_ccys == ["BTC"]


def _covered_flat_paginate():
    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency != "BTC":
            return []
        return [
            _btc_summary(12, rpl=0.6, upl=0.41),  # flat closure 1.01
            _btc_summary(14, rpl=0.0, upl=0.0),
            _btc_option_trade(13, change=1.0, commission=0.01),  # −0.01
        ]

    return _paginate


# ===========================================================================
# H1 (BLOCKER) — a NAV-path Deribit account holding an OPEN option book at crawl
# must reconcile at §5 under cash_settlement. The open book's settled mark
# (options_value, already inside the venue `equity`) is valued INTO the terminal
# wedge so terminal_equity == Σnative_pnl + Σflow + wedge; without it §5 strands
# the mark → permanent-FAILED on a healthy account. This was the shipped
# NAV+options+cash_settlement §5 combination's coverage gap.
# ===========================================================================


async def test_h1_cash_settlement_open_book_reconciles_at_inception(
    monkeypatch: Any,
) -> None:
    """H1: drive the OPEN-book fixture through the PRODUCTION NAV chain under
    cash_settlement (build defaults → combine_native_ledger(config=None)) and assert
    §5 CLOSES. Cash-consistent equity 3.0 = Σflow(1.0 deposit) + Σnative_pnl(1.0
    cash) + session_upl(0.5) + options_value(0.5).

    Mutation-honest: reverting the H1 fix (wedge = session_upl only) leaves the 0.5
    open-book mark unexplained → InceptionReconciliationError → RED (both the
    wedge-value assertion and the combine below redden)."""
    from services.broker_dailies import combine_native_ledger

    scopes = [di.Scope("main", None, True)]
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(),
    )
    _patch_jul_index(monkeypatch)
    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 3.0, "session_upl": 0.5,
                    "options_value": 0.5}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex)  # default cash_settlement
    # The open book's settled mark is valued INTO the wedge (session 0.5 + options 0.5).
    assert ledger.terminal_upnl_native["BTC"] == pytest.approx(1.0)
    # §5 reconciles through the production combine (no InceptionReconciliationError).
    _returns, meta = combine_native_ledger(ledger, report.indexable_currencies)
    assert meta["computation_status_hint"] in ("complete", "complete_with_warnings")


async def test_h1_no_open_book_wedge_is_session_upl_only(
    monkeypatch: Any,
) -> None:
    """H1 (b): a NAV account with NO open option book (options_value absent) keeps
    the wedge == session uPnL — BYTE-IDENTICAL to pre-H1 — and §5 closes as before.
    A perp settlement + a nonzero session_upl, no options."""
    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [{"type": "settlement", "instrument_name": "BTC-PERPETUAL",
                     "currency": "BTC", "change": -0.01, "index_price": 60000.0,
                     "timestamp": _jul_ms(11, 8)}]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)
    # equity 0.29 = Σnative_pnl(-0.01) + session_upl(0.30); NO options_value.
    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 0.29, "session_upl": 0.30}],
        index_price={"BTC": 60000.0},
    )
    from services.broker_dailies import combine_native_ledger

    ledger, report = await di.build_deribit_native_ledger(ex)
    # Wedge is session-uPnL only (no options contribution) → byte-identical.
    assert ledger.terminal_upnl_native.get("BTC", 0.0) == pytest.approx(0.30)
    combine_native_ledger(ledger, report.indexable_currencies)  # §5 closes, no raise


async def test_h1_mark_to_market_wedge_excludes_options_value(
    monkeypatch: Any,
) -> None:
    """H1 (c): under mark_to_market the open book is carried into native_pnl by the
    summary channel, so the wedge stays session-uPnL ONLY (options_value NOT added —
    adding it would DOUBLE-COUNT). The MTM open-book §5 closure is preserved."""
    from services.broker_dailies import combine_native_ledger

    scopes = [di.Scope("main", None, True)]
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(),
    )
    _patch_jul_index(monkeypatch)
    # MTM-calibrated equity 2.59 = Σflow(1.0) + Σnative_pnl_MTM(1.09) + session_upl(0.5).
    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.59, "session_upl": 0.5,
                    "options_value": 0.5}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")
    # Wedge is session uPnL ONLY — options_value NOT folded in under MTM.
    assert ledger.terminal_upnl_native["BTC"] == pytest.approx(0.5)
    combine_native_ledger(ledger, report.indexable_currencies)  # §5 closes, no raise


async def test_open_book_missing_summary_hole_fails_at_inception_gate(
    monkeypatch: Any,
) -> None:
    """CR-01: the exemption is NOT a silent skip — for the EXEMPTED currency a
    dropped cash row / missing summary of size x surfaces at §5 as a residual → the
    authoritative InceptionReconciliationError (same permanent-FAILED disposition
    the strict guard would have). Drops the day-12 summary (size 1.1)."""
    from services.broker_dailies import combine_native_ledger
    from services.native_nav import InceptionReconciliationError

    scopes = [di.Scope("main", None, True)]
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(drop_day12_summary=True),
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.59, "session_upl": 0.5,
                    "options_value": 0.5}],
        index_price={"BTC": 60000.0},
    )
    # BTC is exempt → the strict guard does NOT fire at build; the ledger builds.
    ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")
    assert report.balance_identity_open_option_ccys == ["BTC"]
    # §5 catches the 1.1 hole for the exempted currency (fail-loud preserved).
    with pytest.raises(InceptionReconciliationError):
        combine_native_ledger(ledger, report.indexable_currencies)


async def test_open_book_renamed_options_value_field_fails_loud(
    monkeypatch: Any,
) -> None:
    """CR-01 renamed-field safety: if ``options_value`` is ABSENT on an actually-
    OPEN book (a renamed/garbled field → native_options_value 0.0) and there is no
    trailing option activity, the currency is NOT exempted → the strict guard
    false-fires LOUD (LedgerValuationError). Never a silent pass over an open book
    the exemption failed to recognise."""
    scopes = [di.Scope("main", None, True)]
    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]},
        paginate=_open_book_paginate(),
    )
    _patch_jul_index(monkeypatch)

    # OPEN book but the anchor summary has NO options_value → BTC NOT exempted.
    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 2.59, "session_upl": 0.5}],
        index_price={"BTC": 60000.0},
    )
    with pytest.raises(LedgerValuationError):
        await di.build_deribit_native_ledger(ex, pnl_basis="mark_to_market")


# ===========================================================================
# Finding 1 (HIGH) — spot-extraction exclusion is ALLOCATED-PATH ONLY. On the
# NAV path (config=None → build_deribit_native_ledger default
# exclude_spot_extraction=False) a spot SELL is RETAINED in native_pnl so the §5
# inception reconciliation closes; the allocated path drops it. Reuses the
# _btc_deposit / _NativeAnchorStub / _patch_jul_index seam.
# ===========================================================================


def _btc_usdc_sell(day: int, *, btc: float, usdc: float) -> list[dict[str, Any]]:
    """A BTC_USDC spot SELL posted as two mirror legs (BTC out, USDC cash in)."""
    return [
        {"type": "trade", "instrument_name": "BTC_USDC", "currency": "BTC",
         "change": btc, "timestamp": _jul_ms(day, 10)},
        {"type": "trade", "instrument_name": "BTC_USDC", "currency": "USDC",
         "change": usdc, "timestamp": _jul_ms(day, 10)},
    ]


async def test_nav_path_spot_sell_retained_and_inception_closes(
    monkeypatch: Any,
) -> None:
    """Finding 1a (BLOCKER regression): a NAV-path Deribit account (config=None,
    default exclude_spot_extraction=False) that SELLS spot BTC_USDC RETAINS the
    spot legs in native_pnl and the §5 inception gate closes.

    Fixture: deposit 2.0 BTC (flow) then sell 1.0 BTC → 60,000 USDC. Terminal
    equity BTC 1.0 (= 2.0 deposit − 1.0 sold), USDC 60,000. §5 per currency:
    BTC 1.0 = Σpnl(−1.0) + Σflow(+2.0); USDC 60,000 = Σpnl(+60,000) + Σflow(0).

    Pre-fix (UNCONDITIONAL exclusion): the sell is net-extraction so BOTH legs are
    dropped → native_pnl has no BTC day-12 entry → §5 residual = 1.0 BTC →
    InceptionReconciliationError. Both assertions below therefore RED on pre-fix."""
    import pandas as pd

    from services.broker_dailies import combine_native_ledger

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [_btc_deposit(10, change=2.0), *_btc_usdc_sell(12, btc=-1.0, usdc=60000.0)]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 1.0, "session_upl": 0.0},
            {"currency": "USDC", "equity": 60000.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 60000.0},
    )
    # DEFAULT exclude_spot_extraction=False (NAV path): build must NOT raise.
    ledger, report = await di.build_deribit_native_ledger(ex)
    # The spot SELL leg is RETAINED in native_pnl (the Finding-1 fix).
    assert ledger.native_pnl["BTC"].loc[pd.Timestamp("2025-07-12")] == pytest.approx(
        -1.0, abs=1e-12
    )
    assert ledger.native_pnl["USDC"].loc[pd.Timestamp("2025-07-12")] == pytest.approx(
        60000.0, abs=1e-9
    )
    # §5 inception reconciliation closes (no InceptionReconciliationError). The
    # inception-seed deposit may legitimately warn (flow_dominated) — what matters
    # is no inception BREACH.
    _returns, meta = combine_native_ledger(ledger, report.indexable_currencies)
    assert meta["computation_status_hint"] in ("complete", "complete_with_warnings")


async def test_allocated_path_spot_sell_excluded(monkeypatch: Any) -> None:
    """Finding 1b: the ALLOCATED path (exclude_spot_extraction=True) still DROPS the
    net-extraction spot legs from native_pnl (existing Zavara behaviour preserved).
    The deposit/perp cash stays; only the spot extraction is removed."""
    import pandas as pd

    scopes = [di.Scope("main", None, True)]

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
                 "currency": "BTC", "change": -0.01, "index_price": 60000.0,
                 "timestamp": _jul_ms(11, 8)},
                *_btc_usdc_sell(12, btc=-1.0, usdc=60000.0),
            ]
        return []

    _patch_pipeline(
        monkeypatch, scopes=scopes, currencies={"main": ["BTC"]}, paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)

    ex = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": 0.99, "session_upl": 0.0},
            {"currency": "USDC", "equity": 60000.0, "session_upl": 0.0},
        ],
        index_price={"BTC": 60000.0},
    )
    ledger, _report = await di.build_deribit_native_ledger(
        ex, exclude_spot_extraction=True
    )
    # The perp settlement fee stays; the spot SELL legs are DROPPED.
    assert ledger.native_pnl["BTC"].loc[pd.Timestamp("2025-07-11")] == pytest.approx(
        -0.01, abs=1e-12
    )
    assert pd.Timestamp("2025-07-12") not in ledger.native_pnl["BTC"].index
    assert "USDC" not in ledger.native_pnl  # the +60,000 cash leg dropped too
