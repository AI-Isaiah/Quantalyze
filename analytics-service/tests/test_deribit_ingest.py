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

import pytest

from services import deribit_ingest as di
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
