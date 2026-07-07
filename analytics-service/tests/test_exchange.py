import asyncio
import pytest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt.async_support as ccxt_async

from services.exchange import (
    aclose_exchange,
    create_exchange,
    normalize_symbol,
    validate_key_permissions,
)


class TestAcloseExchange:
    """QUANTALYZE-8/9/S — aclose_exchange must release the aiohttp
    session/connector even when the awaiting coroutine is cancelled.

    The worker wraps exchange-owning handlers in asyncio.wait_for(...); on
    timeout the handler is CANCELLED and a bare `await exchange.close()` in a
    finally can be interrupted mid-sequence (ccxt close() is multi-await),
    leaking the session/connector to GC ("Unclosed connector"). aclose_exchange
    shields+drains close() so it always runs to completion.
    """

    @pytest.mark.asyncio
    async def test_closes_on_normal_path(self):
        closed = {"done": False}

        class _FakeExchange:
            async def close(self):
                closed["done"] = True

        await aclose_exchange(_FakeExchange())
        assert closed["done"] is True

    @pytest.mark.asyncio
    async def test_close_completes_under_cancellation(self):
        """The load-bearing case: cancel the awaiting frame mid-close and assert
        close() still ran to completion. A bare `await exchange.close()` would
        be aborted by the propagating CancelledError, leaking the connector;
        the shield+drain runs it to the end first."""
        closed = {"done": False}

        class _FakeExchange:
            async def close(self):
                # ccxt close() is a multi-await sequence — simulate yield points
                # at which a propagating CancelledError could otherwise abort it.
                await asyncio.sleep(0)
                await asyncio.sleep(0)
                closed["done"] = True

        ex = _FakeExchange()

        async def _caller():
            await aclose_exchange(ex)

        task = asyncio.ensure_future(_caller())
        await asyncio.sleep(0)  # let _caller enter aclose_exchange + schedule close
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert closed["done"] is True, (
            "aclose_exchange must DRAIN close() to completion under cancellation "
            "so the aiohttp session/connector is actually released (QUANTALYZE-8/9/S)"
        )

    @pytest.mark.asyncio
    async def test_close_error_is_swallowed_not_propagated(self):
        """A close() that raises (e.g. SSL shutdown) is not a leak and must not
        mask the handler's real error — it is logged and swallowed."""

        class _FakeExchange:
            async def close(self):
                raise RuntimeError("SSL shutdown boom")

        # Must NOT raise.
        await aclose_exchange(_FakeExchange())

    def test_worker_handlers_use_aclose_not_raw_close(self):
        """Wiring guard: EVERY exchange-owning module must close via
        aclose_exchange, never a bare `await ...close()` that an asyncio.wait_for
        cancellation can interrupt mid-sequence. Testing the helper alone does
        not prove the call sites invoke it — this fails if any finally is
        reverted to a raw close (QUANTALYZE-8/9/S regression). Covers all 11
        modules that own a ccxt exchange (the diff touched every one).

        Reads the source FILES by path (not `inspect.getsource` on imported
        modules): importing routers.exchange here would load it with the real
        slowapi limiter and pollute sys.modules, breaking
        test_exchange_router_c0202's stub-reload fixture downstream."""
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]  # analytics-service/
        # (relative path, raw close pattern that must NOT remain)
        checks = [
            ("services/job_worker.py", "await ctx.exchange.close()"),
            ("services/equity_reconstruction.py", "await ctx.exchange.close()"),
            ("services/funding_fetch.py", "await exchange.close()"),
            ("routers/cron.py", "await exchange.close()"),
            ("routers/exchange.py", "await exchange.close()"),
            ("routers/internal.py", "await exchange.close()"),
            ("routers/portfolio.py", "await exchange.close()"),
            ("routers/debug_key_flow.py", "await exchange.close()"),
            ("services/ingestion/okx.py", "await ex.close()"),
            ("services/ingestion/bybit.py", "await ex.close()"),
            ("services/ingestion/binance.py", "await ex.close()"),
        ]
        for rel, raw in checks:
            src = (root / rel).read_text()
            assert raw not in src, (
                f"{rel} contains a raw `{raw}` — exchange-owning handlers must "
                "close via aclose_exchange (QUANTALYZE-8/9/S cancellation-safe "
                "close)."
            )
            assert "aclose_exchange" in src, (
                f"{rel} no longer references aclose_exchange — the "
                "cancellation-safe close wiring was removed."
            )

    @pytest.mark.asyncio
    async def test_close_hang_is_bounded_normal_path(self, monkeypatch):
        """A stuck close() must NOT hang aclose_exchange forever (which would
        wedge the sequential worker loop). It's bounded by _ACLOSE_TIMEOUT_S and
        degrades to a logged leak. Without the bound this test would hang."""
        import services.exchange as exchange_mod

        monkeypatch.setattr(exchange_mod, "_ACLOSE_TIMEOUT_S", 0.05)

        class _HangingExchange:
            async def close(self):
                await asyncio.Event().wait()  # never completes

        # Safety net: if the bound is broken this wait_for trips instead of the
        # whole suite hanging.
        await asyncio.wait_for(aclose_exchange(_HangingExchange()), timeout=2.0)

    @pytest.mark.asyncio
    async def test_close_hang_is_bounded_under_cancellation(self, monkeypatch):
        """Under cancellation, a stuck close() drain is also bounded — aclose
        re-raises CancelledError within the bound instead of wedging the loop."""
        import services.exchange as exchange_mod

        monkeypatch.setattr(exchange_mod, "_ACLOSE_TIMEOUT_S", 0.05)

        class _HangingExchange:
            async def close(self):
                await asyncio.Event().wait()

        async def _caller():
            await aclose_exchange(_HangingExchange())

        task = asyncio.ensure_future(_caller())
        await asyncio.sleep(0)
        task.cancel()
        # The bounded drain means this resolves quickly, not after forever.
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=2.0)

    # NOTE: deliberately NO `asyncio.wait_for(handler, timeout)` end-to-end test.
    # Empirically (Python 3.12) wait_for cancels the handler ONCE and then awaits
    # its `finally` to completion, so even a BARE `await exchange.close()` in the
    # finally finishes — such a test passes with AND without aclose_exchange and
    # would be false confidence (Rule 9). The genuine leak/abort case is a cancel
    # landing directly on the close await (worker shutdown / loop teardown), which
    # test_close_completes_under_cancellation models with real teeth (it fails on
    # a bare close). The bounded-drain hang tests above cover the hang class.


class TestNormalizeSymbol:
    """H-0668 — single-source ``normalize_symbol`` helper.

    This is a single-source-enforcement / drift-guard test, NOT a
    fail-without-fix bug repro: the OKX trades branch and the OKX funding
    fetcher were already byte-identical by hand, so there is no live
    mismatch to reproduce. The hazard the refactor closes is *future drift*
    — funding attribution joins ``funding_fees.symbol`` to
    ``positions.symbol`` by exact string equality, so if one of the two
    OKX copies were edited and the other not, OKX funding would silently
    zero-match. Both now route through this one helper; these assertions
    pin the canonical (output-preserving) forms it must keep producing.

    Deliberately NOT asserted: ``normalize_symbol("okx", ...) ==
    normalize_symbol("binance", ...)`` for the same asset. OKX's
    ``BTCUSDTSWAP`` vs Binance's ``BTCUSDT`` divergence is intentional
    (every consumer keys by the ``(symbol, exchange)`` tuple), so asserting
    cross-venue equality would encode a wrong intent.
    """

    def test_okx_instid_dash_strip(self) -> None:
        assert normalize_symbol("okx", "BTC-USDT-SWAP") == "BTCUSDTSWAP"
        assert normalize_symbol("okx", "BTC-USD-SWAP") == "BTCUSDSWAP"
        assert normalize_symbol("okx", "BTC-USDT-231229") == "BTCUSDT231229"

    def test_bybit_v5_passthrough(self) -> None:
        assert normalize_symbol("bybit", "BTCUSDT") == "BTCUSDT"
        assert normalize_symbol("bybit", "ETHUSDT") == "ETHUSDT"

    def test_ccxt_unified_slash_and_quote_suffix_strip(self) -> None:
        assert normalize_symbol("binance", "BTC/USDT:USDT") == "BTCUSDT"
        assert normalize_symbol("binance", "ETH/USD:USD") == "ETHUSD"
        # Unknown CCXT venue falls through the same (else) branch as binance.
        assert normalize_symbol("kraken", "BTC/USDT:USDT") == "BTCUSDT"

    def test_okx_trades_and_funding_share_one_normalizer(self) -> None:
        # The trades pipeline (exchange.py OKX branch) and the funding
        # fetcher (funding_fetch.py OKX branch) both call this exact helper
        # for the same instId, so they cannot drift. Pinned to the form the
        # live-path tests assert (test_exchange.py BTCUSDTSWAP @ the OKX
        # fetch test; test_funding_fetch.py BTCUSDTSWAP @ the OKX funding
        # test) — together those pin both ends to this single source.
        inst_id = "BTC-USDT-SWAP"
        assert normalize_symbol("okx", inst_id) == "BTCUSDTSWAP"


class TestMonetaryPrecisionH0669:
    """H-0669 — monetary fill fields keep exact decimal precision.

    Pre-fix, price/quantity/fee/cost were Python floats inserted into the
    DECIMAL ``trades`` columns; ``float('0.1') * 3 == 0.30000000000000004``
    silently corrupted ``cost`` and high-precision quantities lost digits
    beyond float's ~15-17 sig figs. The fix parses exchange decimal STRINGS to
    Decimal at ingest, computes ``cost`` as an exact Decimal multiply, and
    serializes each monetary field as a numeric STRING.
    """

    def test_make_fill_dict_cost_is_exact_decimal_not_float_drifted(self) -> None:
        from services.exchange import _make_fill_dict

        # Float inputs (the pre-fix shape): float 0.1 * 3.0 drifts to
        # 0.30000000000000004. The exact-Decimal multiply yields 0.3.
        out = _make_fill_dict(
            exchange="okx",
            symbol="BTCUSDT",
            side="buy",
            price=0.1,
            quantity=3.0,
            fee=0.0,
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="fill-1",
            is_maker=False,
            raw_data=None,
        )
        assert isinstance(out["cost"], str)
        assert Decimal(out["cost"]) == Decimal("0.3")
        # Guard against the exact float-drift value the bug produced.
        assert Decimal(out["cost"]) != Decimal(0.1 * 3.0)
        for key in ("price", "quantity", "fee", "cost"):
            assert isinstance(out[key], str)

    def test_make_fill_dict_serializable_string_preserves_full_precision(self) -> None:
        """The persist seam json.dumps()-es the row. A raw Decimal would raise
        TypeError; the numeric-string carrier crosses losslessly and keeps the
        full 18-digit precision a float would have truncated."""
        import json

        from services.exchange import _make_fill_dict

        precise_qty = Decimal("0.123456789012345678")  # 18 digits — beyond float
        out = _make_fill_dict(
            exchange="bybit",
            symbol="BTCUSDT",
            side="sell",
            price=Decimal("60000.5"),
            quantity=precise_qty,
            fee=Decimal("-0.4"),
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="fill-2",
            is_maker=True,
            raw_data=None,
        )
        encoded = json.dumps(out)  # must NOT raise (no raw Decimal in the dict)
        assert '"0.123456789012345678"' in encoded
        assert Decimal(out["quantity"]) == precise_qty

    def test_finite_decimal_rejects_pathological_magnitude_and_length(self) -> None:
        """Security-review hardening: a huge-but-finite magnitude or an
        unbounded digit string must be dropped at validation, matching the
        pre-fix float path (which rejected them as inf). Pre-hardening these
        passed ``is_finite()`` and later raised an uncaught ``decimal.Overflow``
        in the cost multiply, aborting the whole sync."""
        from services.exchange import _finite_decimal, _finite_positive_decimal

        assert _finite_positive_decimal("1E1000000000", label="x") is None
        assert _finite_decimal("1E1000000000", label="x") is None
        # Unbounded-length digit string rejected BEFORE building a huge Decimal.
        assert _finite_decimal("1" * 100, label="x") is None
        # Legitimate values still parse exactly.
        assert _finite_positive_decimal("60000.5", label="x") == Decimal("60000.5")
        assert _finite_decimal("-0.4", label="x") == Decimal("-0.4")
        assert _finite_decimal("0", label="x") == Decimal("0")

    @pytest.mark.asyncio
    async def test_okx_poison_magnitude_fill_dropped_not_job_abort(self) -> None:
        """End-to-end poison-pill regression guard: a malformed huge-but-finite
        fillPx must drop the single fill (like the pre-fix float path), NOT
        raise decimal.Overflow in the cost multiply and abort the whole sync.
        """
        from services.exchange import _fetch_raw_trades_okx_inst_type

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        async def _history(params: dict) -> dict:
            if params.get("instType") != "SPOT":
                return {"data": []}
            return {"data": [
                {
                    "instId": "BTC-USDT",
                    "side": "buy",
                    "fillPx": "1E1000000000",  # finite Decimal, astronomical
                    "fillSz": "0.5",
                    "fee": "0",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-poison",
                    "tradeId": "trade-poison",
                    "execType": "T",
                }
            ]}

        mock_exchange.private_get_trade_fills_history = _history
        # Returns (poison fill dropped) rather than raising.
        fills, _ = await _fetch_raw_trades_okx_inst_type(mock_exchange, None, "SPOT")
        assert fills == []

    @pytest.mark.asyncio
    async def test_okx_malformed_ctval_fill_dropped_not_persisted_infinity(self) -> None:
        """Red-team bypass guard: a malformed ``exchange.markets[...]
        ['contractSize']`` for an instId outside the hardcoded ctVal table
        yields ``float('inf')``; the SWAP ctVal rescale then produced an
        unvalidated ``Decimal('Infinity')`` quantity/cost that skipped
        ``_finite_decimal`` and (now that the carrier is a string) persisted as
        a corrupt ``'Infinity'`` NUMERIC. The post-rescale re-validation must
        DROP the fill instead."""
        from services.exchange import _fetch_raw_trades_okx_inst_type

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # Non-hardcoded instId → ctVal falls back to markets['contractSize'].
        mock_exchange.markets = {"ZZZ/USDT:USDT": {"contractSize": "1e400"}}

        async def _history(params: dict) -> dict:
            if params.get("instType") != "SWAP":
                return {"data": []}
            return {"data": [
                {
                    "instId": "ZZZ-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "1.5",
                    "fillSz": "3",
                    "fee": "0",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-z",
                    "tradeId": "trade-z",
                    "execType": "T",
                }
            ]}

        mock_exchange.private_get_trade_fills_history = _history
        fills, _ = await _fetch_raw_trades_okx_inst_type(mock_exchange, None, "SWAP")
        assert fills == []


def _okx_swap_only(swap_data: list[dict]) -> "AsyncMock":
    """Return an AsyncMock for ``private_get_trade_fills_history`` that
    yields ``swap_data`` when called with ``instType=SWAP`` and an empty
    page for FUTURES/SPOT/MARGIN.

    NEW-C13-02: _fetch_raw_trades_okx fans out across all four instTypes;
    tests that only want to exercise SWAP fills must return empty pages for
    the other three to avoid 4× result multiplication.
    """
    async def _side_effect(params: dict) -> dict:
        if params.get("instType") == "SWAP":
            return {"data": swap_data}
        return {"data": []}
    mock = AsyncMock(side_effect=_side_effect)
    return mock


def _okx_swap_only_pages(pages: list[list[dict]]) -> "AsyncMock":
    """Like ``_okx_swap_only`` but serves a sequence of pages for SWAP
    (cursor-walk tests) and always returns empty for other instTypes.

    ``pages`` is a list of fill-lists. Page *i* is returned on the *i*-th
    call with ``instType=SWAP``. Once exhausted, returns empty.
    """
    swap_call_idx: dict[str, int] = {"n": 0}

    async def _side_effect(params: dict) -> dict:
        if params.get("instType") != "SWAP":
            return {"data": []}
        idx = swap_call_idx["n"]
        swap_call_idx["n"] += 1
        if idx < len(pages):
            return {"data": pages[idx]}
        return {"data": []}

    return AsyncMock(side_effect=_side_effect)


def _attach_paginated_chain(builder: MagicMock, rows: list[dict]) -> None:
    """Mount a chainable ``.order().range().execute()`` on ``builder`` so it
    behaves like a PostgREST builder that's been drained by
    ``paginated_select`` — the first ``.range()`` returns ``rows``,
    subsequent calls return an empty list (short-page natural stop).
    """
    state = {"called": False}

    def _range(start, end):
        sliced = MagicMock()
        if not state["called"]:
            state["called"] = True
            sliced.execute.return_value = MagicMock(data=rows)
        else:
            sliced.execute.return_value = MagicMock(data=[])
        return sliced

    order = MagicMock()
    order.range.side_effect = _range
    order.order.return_value = order
    builder.order.return_value = order


class TestCreateExchange:
    def test_supported_exchanges(self):
        for name in ["binance", "okx", "bybit"]:
            exchange = create_exchange(name, "key", "secret")
            assert exchange is not None
            assert exchange.id == name

    def test_unsupported_exchange_raises(self):
        with pytest.raises(ValueError, match="Unsupported"):
            create_exchange("kraken", "key", "secret")

    def test_okx_passphrase(self):
        exchange = create_exchange("okx", "key", "secret", "passphrase")
        assert exchange.password == "passphrase"

    def test_binance_no_passphrase(self):
        exchange = create_exchange("binance", "key", "secret")
        assert not exchange.password  # empty string or None

    def test_bybit_disables_fetch_currencies(self):
        # Regression: PR following v0.21.0.0 — Bybit's read-only keys hit
        # 403 on /v5/asset/coin/query-info during load_markets, which ccxt
        # re-raises as RateLimitExceeded. We disable fetchCurrencies for
        # Bybit so load_markets stays usable with a pure-read key.
        # Found via Railway log archaeology (correlation_id
        # 10792caf-1d0b-4ed1-8a30-8ac66e03bbf9, 2026-05-05).
        exchange = create_exchange("bybit", "key", "secret")
        assert exchange.has.get("fetchCurrencies") is False, (
            "Bybit must disable fetchCurrencies; pure-read keys 403 on "
            "/v5/asset/coin/query-info"
        )

    def test_other_exchanges_keep_fetch_currencies_default(self):
        # Companion to test_bybit_disables_fetch_currencies — make sure
        # we only flipped the flag for Bybit, not Binance / OKX. Their
        # fetch_currencies endpoints are public-data and don't need
        # elevated scopes.
        for name in ["binance", "okx"]:
            exchange = create_exchange(name, "key", "secret")
            assert exchange.has.get("fetchCurrencies") is not False, (
                f"{name} should NOT have fetchCurrencies disabled"
            )


class TestValidateKeyPermissions:
    @pytest.mark.asyncio
    async def test_invalid_credentials_returns_auth_error(self):
        """Invalid API credentials should return an error, not crash."""
        exchange = create_exchange("binance", "invalid-key", "invalid-secret")
        result = await validate_key_permissions(exchange)
        # Should have an error message, not crash
        assert result["error"] is not None
        assert result["valid"] is False

    @pytest.mark.asyncio
    async def test_result_structure(self):
        """validate_key_permissions always returns a dict with valid, read_only, error."""
        exchange = create_exchange("binance", "test", "test")
        result = await validate_key_permissions(exchange)
        assert "valid" in result
        assert "read_only" in result
        assert "error" in result

    @pytest.mark.asyncio
    async def test_all_exchanges_handle_bad_keys(self):
        """Every supported exchange should handle bad credentials gracefully."""
        for name in ["binance", "okx", "bybit"]:
            exchange = create_exchange(name, "bad-key", "bad-secret", "bad-pass")
            result = await validate_key_permissions(exchange)
            # Must not crash, must return error
            assert result["error"] is not None, f"{name} did not return error for bad keys"
            assert isinstance(result["error"], str)

    @pytest.mark.asyncio
    async def test_load_markets_failure_does_not_reject_valid_key(self):
        # Regression: a flaky load_markets must NOT cause validate to
        # reject an otherwise-valid key. Real-world trigger:
        # Bybit's /v5/asset/coin/query-info returning 403 (permission /
        # geo-block) — observed against a real read-only key on Railway,
        # 2026-05-05. fetch_balance() is what truly validates; load_markets
        # is only a metadata prime that a bad-network or scope-restricted
        # key can survive without.
        # The post-Phase-18 contract: only ccxt.RateLimitExceeded and
        # ccxt.PermissionDenied get the swallow path — every other class
        # propagates so the outer error_code branches can fire. Use
        # RateLimitExceeded here because that's the documented Bybit
        # quirk this swallow-path was originally added for.
        exchange = MagicMock()
        exchange.id = "bybit"
        exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.RateLimitExceeded(
                "simulated 403 -> RateLimitExceeded on fetch_currencies"
            )
        )
        exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 100}})

        # Patch detect_permissions so we don't touch the real CCXT methods
        with patch("services.key_permissions.detect_permissions", new=AsyncMock(return_value={
            "read": True,
            "trade": False,
            "withdraw": False,
            "probe_error": False,
        })):
            result = await validate_key_permissions(exchange)

        # validation should succeed — load_markets failure was logged + swallowed
        assert result["valid"] is True, (
            "validate_key_permissions must not reject a key when only "
            "load_markets fails; fetch_balance is the real validator"
        )
        assert result["read_only"] is True
        # error should be None / falsy because fetch_balance succeeded and
        # detect_permissions returned read-only scopes
        assert not result["error"]
        exchange.load_markets.assert_awaited_once()
        exchange.fetch_balance.assert_awaited_once()
        # Defense-in-depth markers from Finding 3: callers can correlate
        # later trade-fetch failures back to a markets-not-loaded state.
        assert result["markets_loaded"] is False
        assert result["markets_error"] is not None
        assert "RateLimitExceeded" in result["markets_error"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "exc_cls,expected_error_code,expected_substring",
        [
            (ccxt_async.AuthenticationError, "AUTH_FAILED", "Authentication"),
            (ccxt_async.PermissionDenied, "PERMISSION_DENIED", "denied"),
            (ccxt_async.RateLimitExceeded, "RATE_LIMITED", "rate-limited"),
            (ccxt_async.DDoSProtection, "DDOS_PROTECTION", "edge"),
            (ccxt_async.ExchangeNotAvailable, "EXCHANGE_UNAVAILABLE", "unavailable"),
            (ccxt_async.NetworkError, "NETWORK_UNAVAILABLE", "Network"),
        ],
    )
    async def test_classifies_ccxt_subclasses_to_distinct_error_codes(
        self, exc_cls, expected_error_code, expected_substring
    ):
        """Finding 2 regression: validate_key_permissions must NOT collapse
        every post-load_markets failure into a single 'verify credentials'
        message. Each ccxt subclass maps to a distinct error_code +
        clearer human-readable message so the Next layer can route the
        right envelope and operators can tell genuine bad-key from
        infra failures.
        """
        exchange = MagicMock()
        exchange.id = "binance"
        # load_markets succeeds; the failure happens on fetch_balance so
        # the outer classification handlers fire.
        exchange.load_markets = AsyncMock(return_value={})
        exchange.fetch_balance = AsyncMock(side_effect=exc_cls("simulated"))

        result = await validate_key_permissions(exchange)

        assert result["valid"] is False
        assert result["error_code"] == expected_error_code, (
            f"{exc_cls.__name__} must map to error_code={expected_error_code!r}; "
            f"got {result['error_code']!r}"
        )
        assert result["error"] is not None
        assert expected_substring.lower() in result["error"].lower(), (
            f"{exc_cls.__name__} message must contain {expected_substring!r}; "
            f"got {result['error']!r}"
        )

    @pytest.mark.asyncio
    async def test_unexpected_error_uses_distinct_code(self):
        """The bare-except backstop must use a distinct error_code so the
        Next layer can render an 'unexpected' envelope rather than a
        misleading 'verify credentials' message.
        """
        exchange = MagicMock()
        exchange.id = "binance"
        exchange.load_markets = AsyncMock(return_value={})
        exchange.fetch_balance = AsyncMock(
            side_effect=ValueError("malformed response from exchange")
        )

        result = await validate_key_permissions(exchange)

        assert result["valid"] is False
        assert result["error_code"] == "VALIDATION_UNEXPECTED"
        # The "verify your credentials" string was the pre-fix
        # misdiagnosis — it must not appear on a non-credential error.
        assert "verify your credentials" not in (result["error"] or "").lower()

    @pytest.mark.asyncio
    async def test_load_markets_propagates_non_documented_exceptions(self):
        """Finding 3 regression: load_markets must only swallow the two
        documented ccxt classes (RateLimitExceeded for the Bybit 403
        quirk; PermissionDenied for scope-restricted markets-meta).
        Every other exception class — NetworkError, ExchangeNotAvailable,
        AuthenticationError, ValueError, etc. — must propagate to the
        outer classifier so the wizard gets a real error code.

        Pre-fix: a bare `except Exception` swallowed everything and
        continued to fetch_balance, which often cache-hit for transient
        infra failures, so the key passed validation but trade-fetch
        later collapsed with no breadcrumb.
        """
        exchange = MagicMock()
        exchange.id = "bybit"
        # Simulate a real network outage during load_markets — the post-
        # Finding-3 contract says this MUST propagate, get caught by the
        # outer NetworkError handler, and surface NETWORK_UNAVAILABLE.
        exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.NetworkError(
                "simulated TCP reset / DNS / TLS"
            )
        )
        # fetch_balance must NOT be called — propagation should short-
        # circuit before we reach it.
        exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 100}}
        )

        result = await validate_key_permissions(exchange)

        assert result["valid"] is False
        assert result["error_code"] == "NETWORK_UNAVAILABLE", (
            "load_markets NetworkError must propagate to the outer "
            "classifier, not be swallowed; got error_code="
            f"{result['error_code']!r}"
        )
        # Critical: pre-fix bug had load_markets failures cache-hit
        # fetch_balance and falsely validate. Post-fix, fetch_balance
        # is unreachable when load_markets raises an undocumented class.
        exchange.fetch_balance.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_load_markets_permission_denied_is_swallowed(self):
        """Finding 3: PermissionDenied is the second documented swallow-
        path class (scope-restricted markets-meta endpoint). Verify it
        joins RateLimitExceeded in the swallow set so a key without
        markets-meta scope still validates if fetch_balance succeeds."""
        exchange = MagicMock()
        exchange.id = "bybit"
        exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.PermissionDenied(
                "simulated scope-restricted markets-meta"
            )
        )
        exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 100}}
        )

        with patch(
            "services.key_permissions.detect_permissions",
            new=AsyncMock(
                return_value={
                    "read": True,
                    "trade": False,
                    "withdraw": False,
                    "probe_error": False,
                }
            ),
        ):
            result = await validate_key_permissions(exchange)

        assert result["valid"] is True
        assert result["markets_loaded"] is False
        assert result["markets_error"] is not None
        assert "PermissionDenied" in result["markets_error"]

    @pytest.mark.asyncio
    async def test_result_includes_error_code_field_on_success(self):
        """Public-shape pin: result dict must always include an
        ``error_code`` key (None on success). Callers (Next layer) rely
        on key presence rather than a try/get."""
        exchange = MagicMock()
        exchange.id = "binance"
        exchange.load_markets = AsyncMock(return_value={})
        exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 100}})

        with patch(
            "services.key_permissions.detect_permissions",
            new=AsyncMock(
                return_value={
                    "read": True,
                    "trade": False,
                    "withdraw": False,
                    "probe_error": False,
                }
            ),
        ):
            result = await validate_key_permissions(exchange)

        assert "error_code" in result
        assert result["error_code"] is None
        assert result["valid"] is True
        # Markets loaded successfully — defense-in-depth markers confirm.
        assert result["markets_loaded"] is True
        assert result["markets_error"] is None


# ---------------------------------------------------------------------------
# NEW-C13-10: credential / HMAC-signature redaction in logged exceptions
# ---------------------------------------------------------------------------


class TestC1310CredentialRedaction:
    """NEW-C13-10 — ccxt NetworkError/AuthError for signed requests embed
    the request URL in str(e), which ends with `&signature=<HMAC-SHA256>`.
    These exceptions must be scrubbed before logging.

    Pre-fix: validate_key_permissions used logger.exception() passing exc
    directly, which logs the full traceback (including str(exc)) via the
    stdlib formatter — bypassing the structlog redact processor.

    Post-fix: every exception log in exchange.py routes str(exc) through
    scrub_freeform_string so the HMAC is replaced with REDACTED.
    """

    @pytest.mark.asyncio
    async def test_auth_error_does_not_log_raw_signature(self, caplog) -> None:
        """When fetch_balance raises AuthenticationError embedding a
        &signature= value, the logged message must contain REDACTED,
        not the raw HMAC.
        """
        import logging
        from services.exchange import validate_key_permissions

        FAKE_HMAC = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234"
        exc_msg = (
            f"binance POST https://api.binance.com/api/v3/account"
            f"?timestamp=1700000000000&signature={FAKE_HMAC}"
            f" 401 Null APIError"
        )

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        mock_exchange.load_markets = AsyncMock(return_value={})
        mock_exchange.fetch_balance = AsyncMock(
            side_effect=ccxt_async.AuthenticationError(exc_msg)
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await validate_key_permissions(mock_exchange)

        assert result["valid"] is False
        assert result["error_code"] == "AUTH_FAILED"

        # All captured log records must NOT contain the raw HMAC.
        for record in caplog.records:
            assert FAKE_HMAC not in record.getMessage(), (
                f"Raw HMAC signature leaked into log: {record.getMessage()!r}"
            )

        # At least one record must contain REDACTED (proof scrubbing fired).
        assert any(
            "REDACTED" in record.getMessage()
            for record in caplog.records
        ), (
            "No REDACTED token found in log output — scrub_freeform_string "
            "was not applied to the AuthenticationError message (NEW-C13-10)."
        )

    @pytest.mark.asyncio
    async def test_network_error_does_not_log_raw_signature(self, caplog) -> None:
        """Same contract as auth error — NetworkError for signed requests
        also embeds &signature= in str(exc) (observed on Binance SIGNED endpoints).
        """
        import logging
        from services.exchange import validate_key_permissions

        FAKE_HMAC = "deadbeef" * 8
        exc_msg = (
            f"GET https://api.binance.com/api/v3/openOrders"
            f"?timestamp=1700000000000&signature={FAKE_HMAC}"
            f" connection timeout"
        )

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        mock_exchange.load_markets = AsyncMock(return_value={})
        mock_exchange.fetch_balance = AsyncMock(
            side_effect=ccxt_async.NetworkError(exc_msg)
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await validate_key_permissions(mock_exchange)

        assert result["valid"] is False
        assert result["error_code"] == "NETWORK_UNAVAILABLE"

        for record in caplog.records:
            assert FAKE_HMAC not in record.getMessage(), (
                f"Raw HMAC leaked into log on NetworkError: {record.getMessage()!r}"
            )

    @pytest.mark.asyncio
    async def test_load_markets_failure_does_not_log_raw_signature(self, caplog) -> None:
        """load_markets exception message is also scrubbed before logging
        and before being placed into result['markets_error'].
        """
        import logging
        from services.exchange import validate_key_permissions

        FAKE_HMAC = "cafebabe" * 8
        exc_msg = (
            f"GET https://api.bybit.com/v5/asset/coin/query-info"
            f"?api_key=MYKEY&signature={FAKE_HMAC} 403 forbidden"
        )

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.RateLimitExceeded(exc_msg)
        )
        mock_exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 100}})

        with patch(
            "services.key_permissions.detect_permissions",
            new=AsyncMock(return_value={
                "read": True, "trade": False,
                "withdraw": False, "probe_error": False,
            }),
        ):
            with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
                result = await validate_key_permissions(mock_exchange)

        assert result["valid"] is True  # load_markets failure is swallowed
        assert result["markets_loaded"] is False
        markets_error = result.get("markets_error") or ""

        # markets_error must be scrubbed before persisting.
        assert FAKE_HMAC not in markets_error, (
            f"Raw HMAC leaked into result['markets_error']: {markets_error!r}"
        )

        for record in caplog.records:
            assert FAKE_HMAC not in record.getMessage(), (
                f"Raw HMAC leaked into log on load_markets: {record.getMessage()!r}"
            )


# ---------------------------------------------------------------------------
# fetch_raw_trades
# ---------------------------------------------------------------------------

class TestFetchRawTrades:
    """Tests for services.exchange.fetch_raw_trades.

    Each test mocks the CCXT exchange instance and (where needed) the
    supabase client so no real API calls or DB queries are made.
    """

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_okx_happy_path(self) -> None:
        """OKX fills_history returns 2 fills — verify normalized output.

        NEW-C13-01: fillSz=0.1 contracts × BTC-USDT ctVal=0.01 = 0.001 base units.
        NEW-C13-02: mock returns data only for instType=SWAP; other instTypes
        return empty so the fan-out doesn't multiply results by 4.
        """
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
                "posSide": "long",
            },
            {
                "instId": "BTC-USDT-SWAP",
                "side": "sell",
                "fillPx": "61000",
                "fillSz": "0.1",
                "fee": "-0.61",
                "feeCcy": "USDT",
                "ts": "1700001000000",
                "ordId": "ord-2",
                "tradeId": "trade-2",
                "execType": "M",
                "posSide": "long",
            },
        ])

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        assert len(result) == 2
        assert result[0]["exchange"] == "okx"
        assert result[0]["symbol"] == "BTCUSDTSWAP"
        assert result[0]["side"] == "buy"
        # H-0669 — monetary fields are now exact numeric strings; compare via
        # Decimal (which ignores trailing-zero formatting and is exact).
        assert Decimal(result[0]["price"]) == Decimal("60000")
        # NEW-C13-01: fillSz=0.1 contracts × BTC-USDT ctVal=0.01 = 0.001 base units.
        assert Decimal(result[0]["quantity"]) == Decimal("0.001")
        # Audit-2026-05-07 H-0671 — fee is the signed value from the
        # exchange. The fixture uses fee="-0.6" (a maker rebate) and the
        # post-fix branch persists it unchanged so downstream
        # ``realized_pnl = ... - total_fees`` reduces by the rebate
        # instead of inflating the apparent fee via abs().
        assert Decimal(result[0]["fee"]) == Decimal("-0.6")
        assert result[0]["is_fill"] is True
        assert result[0]["exchange_order_id"] == "ord-1"
        assert result[0]["exchange_fill_id"] == "trade-1"
        assert result[0]["is_maker"] is False  # execType "T" = taker
        assert result[1]["is_maker"] is True  # execType "M" = maker

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_binance_per_symbol(self) -> None:
        """Binance iterates per-symbol via fetch_my_trades."""
        import asyncio
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
        ])

        # Mock supabase to return symbols from both trades and position_snapshots
        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # fetch_my_trades called for each symbol
        assert mock_exchange.fetch_my_trades.await_count >= 1
        assert all(r["is_fill"] is True for r in result)

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_bybit_cursor(self) -> None:
        """Bybit execution_list with cursor pagination — 2 pages."""
        from services.exchange import fetch_raw_trades

        page1 = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "0.6",
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": "false",
                    },
                ],
                "nextPageCursor": "cursor-page2",
            }
        }
        page2 = {
            "result": {
                "list": [
                    {
                        "symbol": "ETHUSDT",
                        "side": "Sell",
                        "execPrice": "3000",
                        "execQty": "1",
                        "execFee": "0.3",
                        "feeCurrency": "USDT",
                        "execTime": "1700001000000",
                        "orderId": "ord-2",
                        "execId": "exec-2",
                        "isMaker": "true",
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            side_effect=[page1, page2]
        )

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        assert len(result) == 2
        assert result[0]["symbol"] == "BTCUSDT"
        assert result[0]["side"] == "buy"
        assert result[0]["is_fill"] is True
        assert result[1]["symbol"] == "ETHUSDT"
        assert result[1]["side"] == "sell"
        assert result[1]["is_maker"] is True
        # Verify cursor pagination: 2 calls
        assert mock_exchange.private_get_v5_execution_list.await_count == 2

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_binance_per_symbol_403(self) -> None:
        """One symbol returns 403 (PermissionDenied), others succeed.
        Verify partial results returned (not full failure)."""
        import asyncio
        from services.exchange import fetch_raw_trades
        import ccxt.async_support as ccxt_async

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        # First symbol succeeds, second raises 403
        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise ccxt_async.PermissionDenied("403 Forbidden")
            return [
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
            ]

        mock_exchange.fetch_my_trades = _fetch_my_trades

        # Mock supabase: return 2 symbols from trades table
        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # Should have partial results from BTCUSDT, not a full failure
        assert len(result) >= 1
        assert all(r["is_fill"] is True for r in result)

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_empty(self) -> None:
        """No fills returned — verify empty list."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": []
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)
        assert result == []

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_overlap_window(self) -> None:
        """Verify since_ms is subtracted by 3600000 (1 hour overlap window)."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        captured_params: list[dict] = []

        async def _capture_params(params):
            captured_params.append(dict(params))
            return {"data": []}

        mock_exchange.private_get_trade_fills_history = _capture_params

        mock_supabase = MagicMock()
        since_ms = 1700000000000  # arbitrary timestamp

        await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=since_ms
        )

        # The effective since should be since_ms - 3_600_000
        expected_effective = str(since_ms - 3_600_000)
        assert len(captured_params) >= 1
        assert captured_params[0].get("begin") == expected_effective


# ---------------------------------------------------------------------------
# Audit-2026-05-07 G12.B.* regression tests
# ---------------------------------------------------------------------------


class TestG12BColdStart:
    """Audit-2026-05-07 G12.B.1 — Binance cold-start failure must raise."""

    @pytest.mark.asyncio
    async def test_cold_start_position_fetch_failure_raises_typed(self) -> None:
        """Pre-fix: cold-start fetch_positions failure was logged as a
        warning and the function continued with symbols=[], yielding an
        empty fills list that callers treated as success. Post-fix: a
        typed ColdStartSymbolDiscoveryError must propagate so the caller
        can mark the sync_trades job for retry instead of cementing a
        false-success state."""
        import asyncio
        from services.exchange import (
            ColdStartSymbolDiscoveryError,
            fetch_raw_trades,
        )

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_positions = AsyncMock(
            side_effect=Exception("simulated 401 from /fapi/v2/positionRisk")
        )

        # supabase returns NO existing symbols → triggers cold-start path.
        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            _attach_paginated_chain(mock_eq2, [])
            _attach_paginated_chain(mock_eq1, [])
            mock_eq1.eq.return_value = mock_eq2
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with pytest.raises(ColdStartSymbolDiscoveryError):
                await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

    @pytest.mark.asyncio
    async def test_cold_start_no_open_positions_raises_typed(self) -> None:
        """Closed-position edge case: cold-start where fetch_positions
        succeeds but returns 0 open positions. Pre-fix this looked like
        success-with-zero-fills. Post-fix it must raise so the caller
        knows symbol discovery yielded nothing."""
        import asyncio
        from services.exchange import (
            ColdStartSymbolDiscoveryError,
            fetch_raw_trades,
        )

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        # All positions flat (contracts=0) → no symbols discovered.
        mock_exchange.fetch_positions = AsyncMock(return_value=[
            {"symbol": "BTC/USDT:USDT", "contracts": 0},
            {"symbol": "ETH/USDT:USDT", "contracts": 0},
        ])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            _attach_paginated_chain(mock_eq2, [])
            _attach_paginated_chain(mock_eq1, [])
            mock_eq1.eq.return_value = mock_eq2
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with pytest.raises(
                ColdStartSymbolDiscoveryError,
                match="no symbols discovered",
            ):
                await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)


class TestG12BBinanceConcurrency:
    """Audit-2026-05-07 G12.B.3 — fan-out per-symbol fetch via gather."""

    @pytest.mark.asyncio
    async def test_binance_per_symbol_uses_asyncio_gather(self) -> None:
        """Pre-fix the per-symbol loop ran sequentially. Post-fix it must
        use asyncio.gather with bounded concurrency. We patch
        asyncio.gather and assert it was called."""
        import asyncio
        import services.exchange as exchange_mod
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [
                        {"symbol": "BTCUSDT"},
                        {"symbol": "ETHUSDT"},
                        {"symbol": "SOLUSDT"},
                    ],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        # Wrap real asyncio.gather so we can assert it fires.
        real_gather = asyncio.gather
        gather_calls: list[int] = []

        async def _spy_gather(*tasks, **kwargs):
            gather_calls.append(len(tasks))
            return await real_gather(*tasks, **kwargs)

        with patch("services.db.db_execute", side_effect=_mock_db_execute), \
             patch.object(exchange_mod.asyncio, "gather", new=_spy_gather):
            await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # Must have called asyncio.gather at least once with all 3 tasks.
        assert any(n >= 3 for n in gather_calls), (
            f"expected asyncio.gather called with >=3 tasks; got {gather_calls!r}"
        )

    @pytest.mark.asyncio
    async def test_binance_per_symbol_partial_failure_logs_and_continues(
        self,
    ) -> None:
        """When one symbol fails, gather(return_exceptions=True) catches
        it; the function logs a warning matching the prior shape and
        returns successful results for the other symbols."""
        import asyncio
        import logging
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise RuntimeError("simulated 500")
            return [
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
            ]

        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "warning",
            ) as mock_warn:
                result = await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

        # 1 successful symbol → 1 fill; failed symbol logged.
        assert len(result) == 1
        assert any(
            "Binance fetch_my_trades failed for" in str(call)
            for call in mock_warn.call_args_list
        )

    @pytest.mark.asyncio
    async def test_binance_per_symbol_cancellation_propagates(self) -> None:
        """Adversarial-review regression (PR #137 follow-up).

        On Python 3.11+, asyncio.gather(return_exceptions=True) captures
        CancelledError as a result item rather than re-raising. If the
        parent task gets cancelled (15-min handler timeout, worker
        shutdown, signal), every per-symbol task receives CancelledError,
        gather "succeeds" with N exception items, and pre-fix the
        function returned an empty fills list — the same false-success
        outcome the audit named.

        Fix: scan results for CancelledError and re-raise so the outer
        wait_for / shutdown propagates correctly. This test patches
        asyncio.gather to return CancelledError items and asserts the
        function re-raises CancelledError instead of swallowing it.
        """
        import asyncio
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        # Force gather to return CancelledError items as if the parent
        # was cancelled mid-fan-out. This mirrors the Python 3.11+ behavior
        # of asyncio.gather(return_exceptions=True).
        cancellation_results = [
            asyncio.CancelledError("simulated parent cancel"),
            asyncio.CancelledError("simulated parent cancel"),
        ]

        async def _fake_gather(*tasks, return_exceptions=False):
            # Drain the coroutines so they don't leak as 'never awaited'
            # warnings during cleanup.
            for t in tasks:
                t.close()
            return cancellation_results

        with patch("services.exchange.asyncio.gather", new=_fake_gather):
            with pytest.raises(asyncio.CancelledError):
                await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

    @pytest.mark.asyncio
    async def test_binance_per_symbol_total_failure_raises_typed(self) -> None:
        """When EVERY per-symbol fetch fails, the function previously
        returned an empty fills list — same false-success outcome that
        ColdStartSymbolDiscoveryError eliminates. Post-fix, total
        per-symbol failure must raise BinancePerSymbolFetchError so the
        worker marks the job failed_retry."""
        import asyncio
        from services.exchange import (
            BinancePerSymbolFetchError,
            fetch_raw_trades,
        )

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _always_fail(symbol, since=None, limit=None):
            raise RuntimeError(f"simulated 500 for {symbol}")

        mock_exchange.fetch_my_trades = _always_fail

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with pytest.raises(BinancePerSymbolFetchError) as exc_info:
                await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )
        # Both failed symbols must be reported.
        assert sorted(exc_info.value.failed_symbols) == ["BTCUSDT", "ETHUSDT"]
        assert isinstance(exc_info.value.first_error, RuntimeError)

    @pytest.mark.asyncio
    async def test_binance_per_symbol_partial_failure_does_not_raise(
        self,
    ) -> None:
        """The partial-success contract must survive: when SOME (not
        all) symbols fail, fills from the successful symbols are
        returned and a per-symbol-failure summary is logged. A
        regression that promoted partial failure to a raise would
        break the existing test_binance_per_symbol_partial_failure
        contract; this test pins both directions explicitly."""
        import asyncio
        import logging
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise RuntimeError("simulated 500")
            return [
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
            ]

        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "warning",
            ) as mock_warn:
                result = await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

        # Partial success — BTCUSDT's fill landed.
        assert len(result) == 1
        # Per-symbol failure logged AND summary logged. Use call.args to
        # inspect the separate args (str(call) shows the format string,
        # not the rendered message).
        per_symbol_logged = any(
            "Binance fetch_my_trades failed for" in str(c.args[0])
            and "ETHUSDT" in c.args
            for c in mock_warn.call_args_list
        )
        summary_logged = any(
            "symbols failed" in str(c.args[0]) and c.args[1:] == (1, 2)
            for c in mock_warn.call_args_list
        )
        assert per_symbol_logged
        assert summary_logged, (
            "partial failure must log a count summary so bad-symbol rate is visible"
        )

    @pytest.mark.asyncio
    async def test_binance_semaphore_does_not_serialize_per_symbol_pages(
        self,
    ) -> None:
        """Phase A moved ``async with sem:`` from outside the per-page
        loop to inside the network call. A regression that re-wraps
        the entire 20-page loop would still let ``asyncio.gather``
        fire 5 tasks concurrently but would force each symbol to hold
        a slot for all 20 RTTs — the test below proves page-1 of
        symbol B can complete BEFORE page-2 of symbol A by
        instrumenting the call ordering."""
        import asyncio
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        # Two symbols, each needing 2 pages. Tracks call ORDER per symbol.
        page_counts: dict[str, int] = {}
        call_log: list[str] = []
        page_2_started = asyncio.Event()

        async def _fetch_my_trades(symbol, since=None, limit=None):
            page_counts[symbol] = page_counts.get(symbol, 0) + 1
            page = page_counts[symbol]
            call_log.append(f"{symbol}-p{page}")
            # Page 1 of symbol A waits for page 1 of symbol B to start
            # before returning, proving they ran concurrently. Page-2
            # tracking signals interleaving: symbol B's page 2 should
            # be able to fire before symbol A's page 2 if the
            # semaphore is per-call (Phase A) rather than per-loop.
            if page == 1:
                # Return a full page so a second page is needed.
                if symbol == "BTCUSDT":
                    # A short delay so B can interleave.
                    await asyncio.sleep(0.01)
                page_2_started.set()
                return [
                    {
                        "symbol": "BTC/USDT:USDT",
                        "side": "buy",
                        "price": 60000.0,
                        "amount": 0.1,
                        "datetime": "2024-01-01T00:00:00Z",
                        "order": f"ord-{symbol}-{i}",
                        "id": f"fill-{symbol}-{i}",
                        "fee": {"cost": 0.6, "currency": "USDT"},
                        "takerOrMaker": "taker",
                        "timestamp": 1700000000000 + i,
                        "info": {},
                    }
                    for i in range(1000)  # full page → triggers page 2
                ]
            return []  # short page → end loop

        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Both symbols ran 2 pages each.
        assert page_counts == {"BTCUSDT": 2, "ETHUSDT": 2}
        # Concurrency proof: ETHUSDT-p1 must appear in call_log
        # BEFORE BTCUSDT-p2 (i.e., page-1 fan-out completes for both
        # symbols before BTCUSDT advances to page-2). With per-loop
        # semaphore + sem=2+ that's preserved; with per-loop semaphore
        # + sem=1 it would serialize — but per-call semaphore (current
        # behavior) guarantees this regardless of sem size. We test
        # the strong invariant.
        eth_p1_idx = call_log.index("ETHUSDT-p1")
        btc_p2_idx = call_log.index("BTCUSDT-p2")
        assert eth_p1_idx < btc_p2_idx, (
            f"ETHUSDT-p1 must complete before BTCUSDT-p2 (per-call semaphore). "
            f"call_log={call_log}"
        )


class TestG12BFillRowFactory:
    """Audit-2026-05-07 G12.B.4 — _make_fill_dict + posSide whitelist."""

    def test_make_fill_dict_returns_required_keys(self) -> None:
        from services.exchange import _make_fill_dict

        out = _make_fill_dict(
            exchange="okx",
            symbol="BTCUSDT",
            side="buy",
            price=60000.0,
            quantity=0.1,
            fee=0.6,
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="fill-1",
            is_maker=False,
            raw_data={"foo": "bar"},
            position_direction="long",
        )
        required = {
            "exchange", "symbol", "side", "price", "quantity",
            "fee", "fee_currency", "timestamp", "order_type",
            "exchange_order_id", "exchange_fill_id", "is_fill",
            "is_maker", "cost", "raw_data",
        }
        assert required.issubset(set(out.keys()))
        # cost must derive from price * quantity (exact Decimal; H-0669).
        assert Decimal(out["cost"]) == Decimal("6000")
        assert out["is_fill"] is True
        # position_direction stashed into raw_data, not a top-level key.
        assert out["raw_data"]["position_direction"] == "long"

    def test_make_fill_dict_skips_position_direction_when_none(self) -> None:
        from services.exchange import _make_fill_dict

        out = _make_fill_dict(
            exchange="bybit",
            symbol="BTCUSDT",
            side="sell",
            price=60000.0,
            quantity=0.1,
            fee=0.6,
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="fill-1",
            is_maker=True,
            raw_data={"foo": "bar"},
            position_direction=None,
        )
        # When direction is None, raw_data must not be mutated.
        assert "position_direction" not in (out["raw_data"] or {})

    @pytest.mark.asyncio
    async def test_okx_valid_pos_side_preserved(self) -> None:
        """OKX with valid posSide=short must end up in raw_data."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so other instTypes return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "sell",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
                "posSide": "short",
            },
        ])

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        assert result[0]["raw_data"]["posSide"] == "short"
        assert result[0]["raw_data"]["position_direction"] == "short"

    @pytest.mark.asyncio
    async def test_okx_bogus_pos_side_logged_and_dropped(self) -> None:
        """An out-of-whitelist posSide value must be coerced to None,
        with a warning logged. raw_data must NOT carry the invalid value
        as posSide (we only stamp the whitelisted ones)."""
        import logging
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so other instTypes return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "sell",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
                "posSide": "bogus",
            },
        ])

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        assert len(result) == 1
        # No position_direction stamped into raw_data when bogus.
        assert "position_direction" not in result[0]["raw_data"]
        # Warning fired with the expected text.
        assert any(
            "invalid posSide" in str(call)
            for call in mock_warn.call_args_list
        )


class TestG12BOverlapWindow:
    """Audit-2026-05-07 G12.B.5 — codify overlap behavior at boundaries."""

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_late_arriving_fill_outside_overlap(
        self,
    ) -> None:
        """If the exchange returns a fill whose timestamp predates the
        overlap window (since_ms - 7_200_000, i.e. 2h before window),
        current behavior is to capture it (we don't filter on the client
        side; dedup via partial unique index handles re-runs). This test
        codifies that contract — a future change that adds a hard filter
        must update this assertion intentionally.
        """
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        late_ts_ms = 1700000000000 - 7_200_000  # 2h before "since"

        # NEW-C13-02: use _okx_swap_only so other instTypes return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(late_ts_ms),
                "ordId": "ord-late",
                "tradeId": "trade-late",
                "execType": "T",
            },
        ])

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=1700000000000
        )

        # Late-arriving fill IS captured today (overlap window is a
        # request-side hint, not a client-side filter).
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "trade-late"

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_dst_boundary_no_double_count(
        self,
    ) -> None:
        """A fill at a DST-boundary timestamp must NOT be double-counted.
        We model this by returning the same fill twice (same tradeId);
        the function returns both entries (dedup is at the DB layer via
        partial unique index, not in fetch_raw_trades). But the count
        must remain stable across calls, never silently expanding."""
        from services.exchange import fetch_raw_trades

        # Spring-forward 2024 in US Eastern: 2024-03-10 02:00 -> 03:00
        # local. UTC of equivalent moment ~ 2024-03-10T07:00:00Z =
        # 1710054000000 ms. The contract: a single fill with that
        # timestamp returns exactly one row, even on repeat calls.
        dst_ts_ms = 1710054000000

        swap_fills = [
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(dst_ts_ms),
                "ordId": "ord-dst",
                "tradeId": "trade-dst",
                "execType": "T",
            },
        ]

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so other instTypes return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only(swap_fills)

        mock_supabase = MagicMock()
        first = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=dst_ts_ms
        )
        second = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=dst_ts_ms
        )

        assert len(first) == 1
        assert len(second) == 1
        # Identity of the fill must be stable across runs — no silent
        # duplication of the same (exchange_fill_id, timestamp) tuple.
        assert first[0]["exchange_fill_id"] == second[0]["exchange_fill_id"]
        assert first[0]["timestamp"] == second[0]["timestamp"]


class TestG12BPaginationGuards:
    """Audit-2026-05-07 G12.B.6 — stuck-cursor + page-cap warnings."""

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_bybit_stuck_cursor_terminates(
        self,
    ) -> None:
        """Bybit returning the SAME nextPageCursor on every call must
        trigger early termination + a warning, not 100 iterations of
        duplicate fills."""
        import logging
        from services.exchange import fetch_raw_trades

        page = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "0.6",
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": "false",
                    },
                ],
                "nextPageCursor": "STUCK",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # Always return the same page with the same cursor.
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Loop must terminate before the 100-page cap.
        assert mock_exchange.private_get_v5_execution_list.await_count < 100
        # Stuck-cursor warning must have fired.
        assert any(
            "Pagination stuck" in str(call) and "bybit" in str(call)
            for call in mock_warn.call_args_list
        )
        # We get exactly 2 fills: one from page 1, one from page 2 (which
        # shows up as stuck on the third try).
        assert len(result) >= 1

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_okx_empty_tradeId_on_full_page_terminates(
        self,
    ) -> None:
        """OKX with empty tradeId on the LAST row of a FULL (100-fill) page
        must trigger the stuck-cursor guard and log a warning.

        Adversarial-review hardening (PR #137 follow-up): the previous
        test exercised this guard on a 1-fill page, but a short page is
        a legitimate end-of-data signal — firing the stuck warning there
        is a false positive. The guard now ONLY fires on full pages
        (where stuck cursor would otherwise loop until the page cap).
        """
        import logging
        from services.exchange import fetch_raw_trades

        # Build a full 100-fill page where the last row has empty tradeId.
        fills = []
        for i in range(99):
            fills.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })
        # Tail row carries empty tradeId — that's the stuck signal.
        fills.append({
            "instId": "BTC-USDT-SWAP",
            "side": "buy",
            "fillPx": "60000",
            "fillSz": "0.1",
            "fee": "-0.6",
            "feeCcy": "USDT",
            "ts": "1700000000000",
            "ordId": "ord-tail",
            "tradeId": "",
            "execType": "T",
        })
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty
        # and don't receive the stuck-full-page (which would multiply results).
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _okx_swap_only(fills)

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # SWAP fires 1 call (stuck guard triggers), FUTURES/SPOT/MARGIN each
        # fire 1 call (empty page = natural break) → 4 total.
        assert mock_exchange.private_get_trade_fills_history.await_count == 4
        # Stuck-cursor warning fired with okx + SWAP tag.
        assert any(
            "Pagination stuck" in str(call) and "okx" in str(call)
            for call in mock_warn.call_args_list
        )
        # 100 fills from SWAP captured before the stuck guard fires.
        assert len(result) == 100

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_okx_short_page_no_false_stuck_warning(
        self,
    ) -> None:
        """OKX short final page (<100 fills) sharing tradeId with prior
        page's cursor must NOT fire the stuck-cursor warning. The
        natural-break exit (`len(data) < 100`) takes precedence so we
        don't poison operator logs with false-positive 'stuck' warnings
        on legitimate end-of-data boundaries.

        Adversarial-review regression (PR #137 follow-up). Pre-fix, a
        legitimate short final page would log 'Pagination stuck' AND
        also suppress the page-cap warning (because natural_break=True),
        masking real truncation."""
        import logging
        from services.exchange import fetch_raw_trades

        # Single short page with 1 fill — natural end-of-data.
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty.
        swap_fills = [
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "",  # would have tripped pre-fix
                "execType": "T",
            },
        ]

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _okx_swap_only(swap_fills)

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        assert len(result) == 1
        # No stuck-cursor warning — short page is the natural exit, not a stuck signal.
        assert not any(
            "Pagination stuck" in str(call) for call in mock_warn.call_args_list
        ), f"Short final page must not log stuck warning. Saw: {mock_warn.call_args_list}"


class TestG12BBybitIsMaker:
    """Audit-2026-05-07 G12.B.9 — coerce isMaker to bool across types."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "raw_value,expected",
        [
            (True, True),
            ("true", True),
            ("True", True),
            ("TRUE", True),
            (False, False),
            ("false", False),
            (None, False),
            # Empty string was previously caught as False by `== 'true'`
            # but isn't a documented Bybit shape; pin the safe-default so
            # a future refactor cannot promote empty strings to True.
            ("", False),
        ],
    )
    async def test_bybit_is_maker_handles_bool_and_string(
        self, raw_value, expected
    ) -> None:
        from services.exchange import fetch_raw_trades

        page = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "0.6",
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": raw_value,
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        assert result[0]["is_maker"] is expected


# ─── audit-2026-05-07 #9 — fetch_usdt_balance_with_status regression ────


class TestFetchUsdtBalanceWithStatus:
    """Audit-2026-05-07 #9 — pre-fix `fetch_usdt_balance` collapsed
    "balance unavailable due to error" and "balance legitimately not
    provided" into a bare None. The new `fetch_usdt_balance_with_status`
    distinguishes them so the caller can set
    `data_quality_flags.balance_error = True` AND
    `strategy_analytics.computation_status = 'complete_with_warnings'`
    when a transient exchange-API failure forces the heuristic-capital
    fallback path. These tests lock the contract."""

    @pytest.mark.asyncio
    async def test_success_returns_balance_and_no_error(self):
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 12345.67}}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance == 12345.67
        assert balance_error is False

    @pytest.mark.asyncio
    async def test_exchange_api_exception_returns_none_with_error_true(
        self,
    ):
        """The audit's headline case: a transient OKX 5xx must NOT look
        identical to a paper account with zero balance. Pre-fix both
        landed on a bare None and the factsheet rendered the heuristic-
        capital result as canonical CAGR/Sharpe."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            side_effect=RuntimeError("OKX 5xx during balance read")
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is True, (
            "fetch_usdt_balance_with_status MUST propagate "
            "balance_error=True on any exchange-API exception so the "
            "caller can stamp data_quality_flags.balance_error and "
            "computation_status='complete_with_warnings'"
        )

    @pytest.mark.asyncio
    async def test_legitimate_zero_balance_returns_none_with_error_false(
        self,
    ):
        """A successful read against a drained / paper account is NOT an
        error. Caller treats this as legitimate-no-balance (different
        UI text from the degraded path)."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 0}}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is False

    @pytest.mark.asyncio
    async def test_missing_usdt_field_returns_none_with_error_false(self):
        """An account without a USDT key is also a legitimate state —
        e.g. a futures-only account holding margin in a different
        currency. Must not be treated as a balance_error."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": {"BTC": 0.5}}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is False

    @pytest.mark.asyncio
    async def test_malformed_response_shape_returns_balance_error(self):
        """A misbehaving exchange that returns an unexpected shape
        (e.g. None, list, string) must surface as balance_error=True
        rather than silently inheriting the heuristic path. Tests the
        defensive try/except around the .get(...).get(...) chain."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        # `total` field is None instead of a dict — `.get("USDT", 0)`
        # against None raises AttributeError.
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": None}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is True

    @pytest.mark.asyncio
    async def test_fetch_usdt_balance_wrapper_drops_error_flag(self):
        """The legacy `fetch_usdt_balance` wrapper is preserved for
        backwards compatibility. Confirm it still returns None on
        exception (loses the flag — that's the point of the new API)."""
        from services.exchange import fetch_usdt_balance

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            side_effect=RuntimeError("transient")
        )
        balance = await fetch_usdt_balance(mock_exchange)
        assert balance is None


# ─── audit-2026-05-07 C-0226 / H-0667 — unparseable timestamps dropped ────


class TestG12BUnparseableTimestampDrops:
    """Audit-2026-05-07 C-0226 / H-0667 — pre-fix, an OKX/Bybit fill with
    a missing or non-digit timestamp silently fell back to
    ``datetime.now(timezone.utc)``. That phantom wall-clock timestamp
    then became the most-recent fill for the symbol in FIFO
    reconstruction, breaking position open/close ordering, ROI, duration
    and daily volume attribution. Post-fix the fill is dropped (with a
    logger.error) so the malformed input is visible instead of silently
    corrupting downstream analytics."""

    @pytest.mark.asyncio
    async def test_okx_unparseable_ts_dropped(self) -> None:
        import logging
        from services.exchange import fetch_raw_trades

        good_ts = "1700000000000"

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": good_ts,
                "ordId": "ord-good",
                "tradeId": "trade-good",
                "execType": "T",
            },
            {
                # Missing ``ts`` entirely — pre-fix this synthesized
                # ``datetime.now()`` and persisted a phantom-now row.
                "instId": "ETH-USDT-SWAP",
                "side": "buy",
                "fillPx": "3000",
                "fillSz": "1",
                "fee": "-0.3",
                "feeCcy": "USDT",
                "ordId": "ord-bad",
                "tradeId": "trade-bad",
                "execType": "T",
            },
            {
                # Non-digit ``ts`` — also pre-fix collapsed to now().
                "instId": "SOL-USDT-SWAP",
                "side": "sell",
                "fillPx": "100",
                "fillSz": "1",
                "fee": "-0.05",
                "feeCcy": "USDT",
                "ts": "not-a-number",
                "ordId": "ord-bad2",
                "tradeId": "trade-bad2",
                "execType": "T",
            },
        ])

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Only the well-formed fill makes it through; the two bad rows
        # are dropped.
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "trade-good"
        # Both drops must emit a logger.error pinning the malformed row.
        assert mock_err.call_count == 2
        assert all(
            "unparseable ts" in str(call)
            for call in mock_err.call_args_list
        )

    @pytest.mark.asyncio
    async def test_bybit_unparseable_execTime_dropped(self) -> None:
        import logging
        from services.exchange import fetch_raw_trades

        page = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "0.6",
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-good",
                        "execId": "exec-good",
                        "isMaker": "false",
                    },
                    {
                        # Missing ``execTime`` — pre-fix → datetime.now().
                        "symbol": "ETHUSDT",
                        "side": "Buy",
                        "execPrice": "3000",
                        "execQty": "1",
                        "execFee": "0.3",
                        "feeCurrency": "USDT",
                        "orderId": "ord-bad",
                        "execId": "exec-bad",
                        "isMaker": "false",
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Only the well-formed fill survives.
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "exec-good"
        assert mock_err.call_count == 1
        assert "unparseable execTime" in str(mock_err.call_args_list[0])


# ─── audit-2026-05-07 C-0227 — pagination must not silently truncate ────


class TestG12BPaginationFailureReRaises:
    """Audit-2026-05-07 C-0227 — pre-fix the OKX/Bybit per-page exception
    handler logged a warning and ``break``'d, returning fills collected
    so far. A transient 429 / 5xx on page 7 of 12 silently truncated
    history — the caller treated it as success, leaving the allocator's
    Volume/Positions tabs stale with no data_quality_flag. Post-fix the
    exception is re-raised so the sync_trades job is marked failed_retry
    and resumes via cursor on the next attempt."""

    @pytest.mark.asyncio
    async def test_okx_per_page_failure_re_raises(self) -> None:
        from services.exchange import fetch_raw_trades

        # Page 1 succeeds with a FULL page (so the loop will try page 2);
        # page 2 raises.
        fills_page_1 = []
        for i in range(100):
            fills_page_1.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(1700000000000 + i),
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })

        call_count = {"n": 0}

        async def _fills_history(params):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return {"data": fills_page_1}
            raise RuntimeError("simulated 5xx on page 2")

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        mock_supabase = MagicMock()
        with pytest.raises(RuntimeError, match="simulated 5xx"):
            await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

    @pytest.mark.asyncio
    async def test_bybit_per_page_failure_re_raises(self) -> None:
        from services.exchange import fetch_raw_trades

        page_1 = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "0.6",
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": "false",
                    },
                ],
                "nextPageCursor": "page-2-cursor",
            }
        }

        call_count = {"n": 0}

        async def _execution_list(params):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return page_1
            raise RuntimeError("simulated 429 on page 2")

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = _execution_list

        mock_supabase = MagicMock()
        with pytest.raises(RuntimeError, match="simulated 429"):
            await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )


# ─── audit-2026-05-07 H-0671 — maker rebates preserve negative sign ────


class TestG12BMakerRebatePreservesSign:
    """Audit-2026-05-07 H-0671 — pre-fix the OKX/Bybit/CCXT branches all
    applied ``abs(fee)`` so a maker rebate (negative fee on the
    exchange) silently became a positive cost. Downstream
    ``realized_pnl = ... - total_fees`` then subtracted an inflated
    fee, under-reporting P&L for maker-heavy strategies. Post-fix the
    signed value flows through unchanged."""

    @pytest.mark.asyncio
    async def test_okx_maker_rebate_stays_negative(self) -> None:
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.4",  # maker rebate
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "M",
            },
        ])

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        # Sign must be preserved — this is the contract H-0671 fixes.
        assert Decimal(result[0]["fee"]) == Decimal("-0.4")

    @pytest.mark.asyncio
    async def test_bybit_maker_rebate_stays_negative(self) -> None:
        from services.exchange import fetch_raw_trades

        page = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "-0.4",  # maker rebate
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": True,
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        assert Decimal(result[0]["fee"]) == Decimal("-0.4")

    def test_normalize_fill_ccxt_maker_rebate_stays_negative(self) -> None:
        """CCXT unified shape — _normalize_fill must also preserve sign.
        Used by the Binance branch via fetch_my_trades. Pre-fix this was
        ``abs(float(fee_info.get('cost', 0) or 0))``."""
        from services.exchange import _normalize_fill

        out = _normalize_fill(
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": -0.4, "currency": "USDT"},
                "takerOrMaker": "maker",
                "info": {},
            },
            "binance",
        )
        assert Decimal(out["fee"]) == Decimal("-0.4")


# ─── audit-2026-05-07 H-0662 — Binance fetch_my_trades paginates ────


class TestG12BBinancePaginationLoop:
    """Audit-2026-05-07 H-0662 — pre-fix _fetch_raw_trades_binance called
    fetch_my_trades once with limit=1000 and no pagination loop. Binance
    caps each call at 1000 rows, so a high-frequency strategy with
    >1000 fills since last_sync silently truncated. Post-fix the loop
    advances ``since`` past the last fill's timestamp until a short
    page returns or the 20-page cap fires."""

    @pytest.mark.asyncio
    async def test_binance_paginates_past_1000_fills(self) -> None:
        import asyncio
        from services.exchange import fetch_raw_trades

        # Page 1: exactly 1000 fills (full page → loop continues).
        # Page 2: 1 fill (short page → loop breaks).
        page_1 = [
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": f"ord-{i}",
                "id": f"fill-{i}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "timestamp": 1700000000000 + i,
                "info": {},
            }
            for i in range(1000)
        ]
        page_2 = [
            {
                "symbol": "BTC/USDT:USDT",
                "side": "sell",
                "price": 60500.0,
                "amount": 0.1,
                "datetime": "2024-01-01T01:00:00Z",
                "order": "ord-tail",
                "id": "fill-tail",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "timestamp": 1700001000000,
                "info": {},
            }
        ]

        call_log: list[int | None] = []

        async def _fetch_my_trades(symbol, since=None, limit=None):
            call_log.append(since)
            if len(call_log) == 1:
                return page_1
            return page_2

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(mock_eq2, [{"symbol": "BTCUSDT"}])
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # We expect both pages to be merged: 1000 + 1 = 1001.
        assert len(result) == 1001
        # Two pages were fetched, second with since set to last timestamp.
        assert len(call_log) == 2
        # NEW-C13-03: Page 2's ``since`` must equal (not +1) the last
        # timestamp of page 1 so same-ms fills at page boundaries are not
        # skipped. Boundary duplicates are deduplicated by the unique index.
        assert call_log[1] == page_1[-1]["timestamp"]

    @pytest.mark.asyncio
    async def test_binance_pagination_hits_page_cap(self) -> None:
        """If the venue keeps returning full pages, the 20-page cap must
        eventually terminate the loop (no runaway iteration)."""
        import asyncio
        import logging
        from services.exchange import fetch_raw_trades

        # Always return a full page so the loop keeps going.
        full_page = [
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": f"ord-{i}",
                "id": f"fill-{i}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                # Tick the timestamp forward so cursor advances.
                "timestamp": 1700000000000 + i,
                "info": {},
            }
            for i in range(1000)
        ]

        call_count = {"n": 0}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            call_count["n"] += 1
            # Increment timestamps so cursor moves forward; CCXT mutation
            # safe since list reconstruction below.
            return [
                {**row, "timestamp": row["timestamp"] + call_count["n"] * 1_000_000}
                for row in full_page
            ]

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(mock_eq2, [{"symbol": "BTCUSDT"}])
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "warning",
            ) as mock_warn:
                result = await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

        # Exactly 20 fetch calls — the BINANCE_PAGE_CAP.
        assert call_count["n"] == 20
        assert len(result) == 20 * 1000
        # Page-cap warning must fire.
        assert any(
            "page cap" in str(call) and "BTCUSDT" in str(call)
            for call in mock_warn.call_args_list
        )


# ─── audit-2026-05-07 H-0665/H-0666 — OKX cursor direction + begin per-page ──


class TestG12BOkxCursorAndBegin:
    """Audit-2026-05-07 H-0665 + H-0666 — OKX fills-history pagination.

    H-0665: cursor pagination must use ``after=<billId>`` (records older
    than the cursor) not ``before=<billId>`` (newer). DESC-sorted data
    means ``data[-1]`` is the OLDEST row; ``before`` on the oldest
    asked for records newer than it — oscillating until the 100-page
    cap silently truncated.

    H-0666: ``begin`` must be sent on every page, not only page 1. Pre-fix
    OKX defaulted to a 7-day window on later pages, silently truncating
    a 90-day backfill.
    """

    @pytest.mark.asyncio
    async def test_okx_pagination_uses_after_cursor(self) -> None:
        from services.exchange import fetch_raw_trades

        captured_params: list[dict] = []

        page_1_fills = []
        for i in range(100):
            page_1_fills.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(1700000000000 + i),
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })
        page_2 = {"data": []}

        async def _fills_history(params):
            captured_params.append(dict(params))
            if len(captured_params) == 1:
                return {"data": page_1_fills}
            return page_2

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        mock_supabase = MagicMock()
        await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )

        # Page 1: no cursor.
        assert "after" not in captured_params[0]
        assert "before" not in captured_params[0]
        # Page 2: must use ``after`` (old-direction), not ``before``.
        assert captured_params[1].get("after") == "trade-99"
        assert "before" not in captured_params[1], (
            "OKX must paginate with ``after`` to walk into older history; "
            "``before`` walks toward newer records and oscillates."
        )

    @pytest.mark.asyncio
    async def test_okx_pagination_walks_after_cursor_across_multiple_pages(
        self,
    ) -> None:
        """Multi-page walk: a regression that picked ``data[0]`` (NEWEST,
        DESC-sorted) instead of ``data[-1]`` (OLDEST) would have passed
        the single-page after-cursor test as long as `data[0]` happened
        to differ from `data[-1]`. This 3-page test pins the cursor
        source: every subsequent page's ``after`` must equal the OLDEST
        ``tradeId`` from the prior page (last entry of DESC-sorted data),
        NOT the newest."""
        from services.exchange import fetch_raw_trades

        captured_params: list[dict] = []

        # Three full pages of 100 fills each (DESC by ts in real OKX),
        # then a short page of 5 (natural stop).
        def _build_page(start_idx: int, count: int) -> list[dict]:
            return [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    # DESC ts within page (newest first); page boundaries
                    # also descend.
                    "ts": str(1700000000000 - (start_idx + i)),
                    "ordId": f"ord-{start_idx + i}",
                    "tradeId": f"trade-{start_idx + i}",
                    "execType": "T",
                }
                for i in range(count)
            ]

        swap_pages = [
            _build_page(0, 100),    # page 1: trade-0 (newest) ... trade-99 (oldest)
            _build_page(100, 100),  # page 2: trade-100 ... trade-199
            _build_page(200, 100),  # page 3: trade-200 ... trade-299
            _build_page(300, 5),    # page 4: short page → natural stop
        ]

        # NEW-C13-02: wrap in a function that records params AND returns data only
        # for instType=SWAP. Other instTypes return empty (no param capture needed
        # for the cursor-direction assertion which is SWAP-specific).
        async def _fills_history_capturing(params: dict) -> dict:
            captured_params.append(dict(params))
            if params.get("instType") != "SWAP":
                return {"data": []}
            # For SWAP: use position in captured SWAP params list
            swap_calls = [p for p in captured_params if p.get("instType") == "SWAP"]
            idx = len(swap_calls) - 1
            return {"data": swap_pages[idx] if idx < len(swap_pages) else []}

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history_capturing

        mock_supabase = MagicMock()
        await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # Filter to SWAP params only for cursor-direction assertions.
        swap_params = [p for p in captured_params if p.get("instType") == "SWAP"]
        assert len(swap_params) == 4
        # Page 1: no cursor.
        assert "after" not in swap_params[0]
        # Pages 2-4: cursor MUST be the OLDEST tradeId of the prior page
        # (last entry, DESC-sorted), NOT the newest (first entry).
        assert swap_params[1]["after"] == "trade-99", (
            "page 2 cursor must be data[-1] (oldest); a regression that "
            "picked data[0] (newest) would oscillate"
        )
        assert swap_params[2]["after"] == "trade-199"
        assert swap_params[3]["after"] == "trade-299"

    @pytest.mark.asyncio
    async def test_okx_begin_sent_on_every_page(self) -> None:
        from services.exchange import fetch_raw_trades

        captured_params: list[dict] = []

        page_1_fills = []
        for i in range(100):
            page_1_fills.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(1700000000000 + i),
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })

        async def _fills_history(params):
            captured_params.append(dict(params))
            if len(captured_params) == 1:
                return {"data": page_1_fills}
            return {"data": []}

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        since_ms = 1690000000000  # caller-supplied window
        mock_supabase = MagicMock()
        await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=since_ms
        )

        # Both pages must carry the `begin` time bound (effective_since
        # = since_ms - OVERLAP_WINDOW_MS = since_ms - 3_600_000).
        expected_begin = str(since_ms - 3_600_000)
        assert len(captured_params) >= 2
        for i, p in enumerate(captured_params):
            assert p.get("begin") == expected_begin, (
                f"OKX page {i + 1} missing/wrong begin — pre-fix this was "
                f"only sent on page 1 and later pages fell back to OKX's "
                f"default 7-day window. Got: {p!r}"
            )


# ─── audit-2026-05-07 H-0673 — CCXT timestamp normalized to ISO UTC ────


class TestG12BCcxtTimestampNormalization:
    """Audit-2026-05-07 H-0673 — pre-fix, _normalize_fill wrote
    ``trade.get("datetime", "")`` straight through. An empty default
    cascaded into ``datetime.fromisoformat("")`` (silently swallowed
    by position_reconstruction) and ``new Date("")`` (Invalid Date in
    PositionsTab.tsx). Post-fix the field is a uniform ISO-8601 UTC
    string OR the fill is dropped with a logger.error."""

    def test_normalize_fill_prefers_numeric_timestamp(self) -> None:
        """CCXT unified shape carries both ``datetime`` (ISO string) and
        ``timestamp`` (millis). The numeric form is canonical; ensure we
        produce a tz-aware ISO string from it."""
        from services.exchange import _normalize_fill

        out = _normalize_fill(
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "",  # Pre-fix would have persisted ""
                "timestamp": 1700000000000,
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
            "binance",
        )
        assert out is not None
        # Parseable, tz-aware ISO string.
        parsed = datetime.fromisoformat(out["timestamp"])
        assert parsed.tzinfo is not None
        assert int(parsed.timestamp() * 1000) == 1700000000000

    def test_normalize_fill_falls_back_to_datetime_string(self) -> None:
        """If only ``datetime`` is provided (no numeric timestamp), the
        ISO string is normalized to UTC with a +00:00 / Z suffix."""
        from services.exchange import _normalize_fill

        out = _normalize_fill(
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
            "binance",
        )
        assert out is not None
        parsed = datetime.fromisoformat(out["timestamp"])
        assert parsed.tzinfo is not None

    def test_normalize_fill_drops_fill_with_no_timestamp(self) -> None:
        """No ``datetime`` and no ``timestamp`` — pre-fix this persisted
        an empty-string field; post-fix the fill is dropped and a
        logger.error fires so the malformed row is visible."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    # NO datetime, NO timestamp.
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is None
        assert mock_err.call_count == 1
        assert "unparseable timestamp" in str(mock_err.call_args_list[0])

    def test_normalize_fill_drops_bool_timestamp(self) -> None:
        """Python's ``True`` is an ``int`` subclass (``True == 1``).
        Without an explicit bool guard ``coerce_to_aware_utc(True, ...)``
        produces ``float(True)/1000 = 0.001`` → 1970-01-01T00:00:00.001
        phantom row, same FIFO-corruption shape as ``timestamp=0``."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "",
                    "timestamp": True,  # bool, int subclass
                    "order": "ord-1",
                    "id": "fill-bool",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is None, "bool timestamp must be treated as missing"
        assert mock_err.call_count == 1

    def test_normalize_fill_drops_zero_epoch_timestamp(self) -> None:
        """Numeric ``timestamp=0`` is the same FIFO-poisoning shape as the
        H-0673 bug: ``coerce_to_aware_utc(0)`` would produce a
        1970-01-01 phantom row that becomes the "earliest fill" for the
        symbol. Post-fix, epoch-zero is treated as missing — the fill is
        dropped just like an absent timestamp."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "",
                    "timestamp": 0,  # epoch sentinel
                    "order": "ord-1",
                    "id": "fill-zero",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is None, "epoch-zero timestamp must be treated as missing"
        assert mock_err.call_count == 1

    def test_normalize_fill_drops_missing_price_or_amount(self) -> None:
        """Pre-Phase B `_normalize_fill` silently substituted ``0`` for
        missing/non-numeric ``price`` or ``amount`` — same silent-failure
        shape as the H-0673 timestamp bug. Post-fix, both are required
        and the fill is dropped if either is missing."""
        import logging
        from services.exchange import _normalize_fill

        for missing in ("price", "amount"):
            base = {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": f"fill-missing-{missing}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            }
            base.pop(missing)
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "error",
            ) as mock_err:
                out = _normalize_fill(base, "binance")
            assert out is None, (
                f"fill missing {missing} must be dropped, not silently zeroed"
            )
            assert mock_err.call_count == 1
            assert "missing/non-numeric" in str(mock_err.call_args_list[0])

    def test_normalize_fill_logs_warning_on_primary_field_parse_failure(
        self,
    ) -> None:
        """When ``timestamp`` is present but unparseable AND ``datetime``
        is healthy, the fill should still land — but a WARNING must fire
        so primary-field producer drift is visible (a silent fallback
        masks an upstream poisoning bug)."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "timestamp": "not-a-number",  # garbage primary field
                    "order": "ord-1",
                    "id": "fill-fallback",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is not None, "fallback to datetime should succeed"
        assert mock_warn.call_count >= 1, (
            "primary-field parse failure must log a warning, not fall through silently"
        )


# ─── audit-2026-05-07 H-0663 — OKX funding-row contract ────


class TestG12BOkxFundingRowContract:
    """Audit-2026-05-07 H-0663 — OKX's
    ``private_get_trade_fills_history`` endpoint is documented to
    return trade fills only (execType: T/M, etc.); funding rate entries
    live in ``private_get_account_bills``. This test codifies the
    contract: a fills_history response is treated as trades. If OKX
    ever changes the endpoint shape to mix funding rows in, the
    qty<=0 guard in services/position_reconstruction.py would still
    skip them — but the regression test below pins the current
    behavior so an accidental change in either layer is visible.

    The test treats a hypothetical funding-shaped row (fillSz='0',
    subType='8' — the OKX bill subType for funding fee) as a non-fill:
    qty<=0 means it's filtered downstream by the qty<=0 guard in
    services/position_reconstruction.py and contributes 0 quantity.
    """

    @pytest.mark.asyncio
    async def test_okx_zero_qty_row_passes_through_with_qty_zero(self) -> None:
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            # Normal fill — fillSz=0.1 contracts × BTC-USDT ctVal=0.01 = 0.001 base.
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-fill",
                "tradeId": "trade-fill",
                "execType": "T",
            },
            # Funding-shaped row (qty=0, OKX bill subType=8) — if
            # this ever shows up in fills_history (it shouldn't),
            # the qty=0 carries through and downstream filters at
            # qty<=0 in position_reconstruction.
            {
                "instId": "BTC-USDT-SWAP",
                "side": "",
                "fillPx": "0",
                "fillSz": "0",
                "fee": "-0.5",
                "feeCcy": "USDT",
                "ts": "1700001000000",
                "ordId": "",
                "tradeId": "trade-funding",
                "execType": "",
                "subType": "8",  # OKX bill funding-fee subType
            },
        ])

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )

        # NEW-C13-11: zero-price/zero-qty rows are now dropped at ingest
        # (by _finite_positive_float) rather than passed through to the DB.
        # The normal fill is kept; the funding-shaped row (fillPx=0, fillSz=0)
        # is dropped with an ERROR log. This is the correct behavior: persisting
        # zero-qty rows to the DB is unnecessary churn since position_reconstruction
        # would skip them anyway at the qty<=0 guard (line 904).
        assert len(result) == 1
        normal = [r for r in result if r["exchange_fill_id"] == "trade-fill"][0]
        # NEW-C13-01: fillSz=0.1 contracts × BTC-USDT ctVal=0.01 = 0.001 base units.
        assert Decimal(normal["quantity"]) == Decimal("0.001")
        # Confirm the funding-shaped row was dropped (not in result)
        funding_rows = [
            r for r in result if r.get("exchange_fill_id") == "trade-funding"
        ]
        assert len(funding_rows) == 0, (
            "NEW-C13-11: zero-price/zero-qty OKX row must be dropped at ingest"
        )


# audit-2026-05-07 silent-failure sweep regression
class TestFetchDailyPnlBybitFailLoud:
    """Pre-sweep, `fetch_daily_pnl` wrapped the Bybit closed-pnl RPC and
    the timestamp ISO-conversion loop in a single `except: pass`. Two
    distinct failure modes (RPC raise vs ISO conversion raise) silently
    collapsed into "no bybit daily_pnl" with no Railway log. Post-sweep,
    the call remains best-effort (the parent sync still wants to continue)
    BUT a WARNING is emitted naming the failure mode.
    """

    @pytest.mark.asyncio
    async def test_bybit_closed_pnl_rpc_failure_emits_warning(self, caplog):
        import logging
        from services.exchange import fetch_daily_pnl

        # Bybit ccxt mock whose closed_pnl endpoint raises.
        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            side_effect=RuntimeError("simulated Bybit closed_pnl RPC failure")
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Failure-soft contract: the call returned without raising.
        assert result == []
        # Operator visibility: a WARNING named the failure mode.
        # Review-cluster gate (audit-2026-05-07): tightened from the
        # loose 'bybit' substring filter to require the exact log prefix
        # the sweep introduced. Loose match could pass on an UNRELATED
        # future warning that happens to contain 'bybit' from a different
        # module.
        matching = [
            r for r in caplog.records
            if "Bybit closed_pnl" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Bybit closed_pnl RPC failure must produce a WARNING log "
            "with prefix 'Bybit closed_pnl' (post audit-2026-05-07 "
            "silent-failure sweep) so operators can distinguish 'Bybit "
            "blip / auth fail' from 'no closed positions on the account'."
        )
        # silent-failure/F-05 HMAC-leak fix: exc_info must NOT be set on
        # this inner warning — exc_info=True embeds the full exception string
        # including &signature=<HMAC-SHA256> from ccxt NetworkError URLs,
        # bypassing the redact processor (NEW-C13-10 / red-team/H-3).
        # The scrubbed message in exc_class=.../scrubbed=... args is sufficient.
        assert all(r.exc_info is None for r in matching), (
            "Bybit closed_pnl WARNING must NOT use exc_info=True — "
            "ccxt exception strings can contain HMAC signatures "
            "(silent-failure/F-05, NEW-C13-10)"
        )
        # Pin the boundary: the inner WARNING must be THE log — the
        # outer wrapper's ERROR ('fetch_daily_pnl failed') must NOT
        # fire. A refactor that re-raises from the inner Bybit branch
        # would create a doubled WARNING+ERROR; this assertion catches it.
        assert not any(
            r.levelno == logging.ERROR
            and "fetch_daily_pnl failed" in r.getMessage()
            for r in caplog.records
        ), (
            "Bybit closed_pnl failure must NOT escalate to the outer "
            "fetch_daily_pnl ERROR — the fail-loud transformation is "
            "WARNING-only at the inner branch (best-effort enrichment)"
        )

    @pytest.mark.asyncio
    async def test_bybit_closed_pnl_item_parse_failure_emits_warning(self, caplog):
        """A malformed item INSIDE the Bybit closed_pnl response (e.g.,
        ``cumEntryValue='NaN-string'`` which ``_finite_float`` rejects)
        triggers the per-row drop branch in the Bybit aggregator.
        Pre-sweep, the outer bare-pass swallowed parse failures and
        downstream rows aggregated incorrectly with no log. Post-sweep,
        a WARNING fires with the 'Bybit closed_pnl row dropped' prefix.

        Review-cluster gate rename (audit-2026-05-07): the prior test
        name 'test_bybit_iso_conversion_failure' was misleading — the
        actual trigger is per-row field parsing, not the ISO
        conversion. C-0319 cutover (Bybit funding exclusion) refactored
        the per-item parse from a ``closedPnl`` float to a
        cumEntryValue / cumExitValue / openFee / closeFee
        reconstruction; the fixture now plants NaN on cumEntryValue,
        which is the equivalent rejection path under the new schema.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        # ``_finite_float`` rejects 'NaN-string' on cumEntryValue and
        # emits a WARNING; the aggregator then drops the row via the
        # per-row 'Bybit closed_pnl row dropped' WARNING.
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Sell",
                            "cumEntryValue": "NaN-string",
                            "cumExitValue": "1010",
                            "openFee": "0",
                            "closeFee": "0",
                            "closedPnl": "10",
                            "createdTime": "1700000000000",
                        }
                    ]
                }
            }
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Failure-soft contract: the call returned without raising.
        assert isinstance(result, list)
        # Operator visibility: WARNING with the 'Bybit closed_pnl'
        # prefix (matches both the row-drop WARNING and the outer
        # fetch-failure WARNING).
        matching = [
            r for r in caplog.records
            if "Bybit closed_pnl" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Bybit closed_pnl item-parse failure must produce a WARNING "
            "log with prefix 'Bybit closed_pnl' (post audit-2026-05-07 "
            "silent-failure sweep)"
        )

    @pytest.mark.asyncio
    async def test_bybit_iso_conversion_overflow_emits_warning(self, caplog):
        """PR #181 take-2 silent-failure-hunter F13 + pr-test LOW #3:
        the original Bybit-branch WARNING text 'Bybit closed_pnl fetch
        / ISO-conversion failed' names TWO failure modes. The renamed
        sibling test_bybit_closed_pnl_item_parse_failure covers the
        per-item parse path; the RPC-failure test covers the RPC path.
        This test exercises the TRUE ISO-conversion failure mode: a
        createdTime that passes the isdigit() guard but overflows when
        passed to datetime.fromtimestamp via int(ts_raw) / 1000.

        Take-2 atomicity (red-team F5): in addition to emitting the
        WARNING, the failure must NOT partially mutate daily_pnl —
        either all entries are converted, or none are (atomic
        contract). After F5, the Bybit ISO conversion builds a NEW
        list before mutating daily_pnl; on mid-loop failure, the
        partial state is discarded and daily_pnl remains uniform.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        # 22-digit createdTime passes `str.isdigit()` but `int(.) / 1000`
        # overflows datetime.fromtimestamp on most platforms (year ~10^14).
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "closedPnl": "5.0",
                            "createdTime": "9" * 22,
                        }
                    ]
                }
            }
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)

        # F5 atomicity: on ISO failure, no Bybit rows leak into daily_pnl
        # (build-then-extend means a mid-loop overflow discards the
        # partial converted list).
        assert isinstance(result, list)
        # Operator visibility: WARNING fired for the ISO-conversion path.
        matching = [
            r for r in caplog.records
            if "Bybit closed_pnl" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Bybit ISO-conversion overflow must produce a WARNING log "
            "with prefix 'Bybit closed_pnl' (PR #181 take-2 F13)"
        )


# PR #181 take-2 silent-failure-hunter F4: OKX bills aggregator pre-take2
# had no else branch on the `ts_raw.isdigit()` guard — bills with empty
# or non-digit ts were silently dropped. Now logs a WARNING with
# billId + billType for cross-exchange triage consistency.
class TestFetchDailyPnlOkxFailLoud:
    """Take-2 regression coverage for the OKX bill-aggregator silent-drop fix."""

    @pytest.mark.asyncio
    async def test_okx_bill_dropped_on_non_digit_ts_logs_warning(self, caplog):
        """A bill with a non-digit ts (e.g., ISO string from a schema drift)
        must produce a WARNING naming the billId / billType so operators
        can spot the regression instead of seeing silently truncated
        daily_pnl.
        """
        import logging
        from datetime import datetime, timezone, timedelta
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "okx"
        # Recent bills: one valid, one with non-digit ts (mimics OKX
        # returning an ISO string for a future schema-drift bill).
        valid_ts = str(int(datetime.now(timezone.utc).timestamp() * 1000))
        recent_resp = {
            "data": [
                {"ts": valid_ts, "pnl": "1.0", "fee": "0", "billId": "B1", "billType": "8"},
                {"ts": "2026-01-01T00:00:00Z", "pnl": "2.0", "fee": "0", "billId": "B2", "billType": "8"},
                {"ts": "", "pnl": "3.0", "fee": "0", "billId": "B3", "billType": "8"},
            ]
        }
        archive_resp = {"data": []}

        async def mock_recent(params):
            return recent_resp

        async def mock_archive(params):
            return archive_resp

        mock_exchange.private_get_account_bills = AsyncMock(
            side_effect=mock_recent
        )
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            side_effect=mock_archive
        )

        # since_ms recent (no archive needed)
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp() * 1000)
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            await fetch_daily_pnl(mock_exchange, since_ms=since_ms)

        dropped = [
            r for r in caplog.records
            if "OKX bill dropped" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        # Both bad bills (ISO + empty-string) should emit a WARNING.
        assert len(dropped) >= 2, (
            "PR #181 take-2 F4: each OKX bill with non-digit ts must "
            f"emit a WARNING; observed {len(dropped)}"
        )
        msgs = " | ".join(r.getMessage() for r in dropped)
        assert "B2" in msgs, "WARNING must include billId for the ISO-ts row"
        assert "B3" in msgs, "WARNING must include billId for the empty-ts row"


# PR #181 take-2 silent-failure-hunter F3: fetch_mark_prices pre-take2
# silently dropped Binance/Bybit rows whose markPrice was missing or
# malformed. Now logs a WARNING with the symbol + the unparseable
# markPrice value. Schema drift on the ticker endpoint would corrupt
# valuation (caller treats absent symbols as flat positions) with no
# operator signal without this WARNING.
class TestFetchMarkPricesFailLoud:
    """Take-2 regression coverage for the per-row silent-drop fix."""

    @pytest.mark.asyncio
    async def test_binance_drops_unparseable_mark_price_with_warning(self, caplog):
        import logging
        from services.exchange import (
            fetch_mark_prices,
            _reset_mark_price_cache_for_tests,
        )

        _reset_mark_price_cache_for_tests()
        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        # Mixed response: BTCUSDT is fine, ETHUSDT has a non-numeric markPrice.
        mock_exchange.fapiPublic_get_premiumindex = AsyncMock(
            return_value=[
                {"symbol": "BTCUSDT", "markPrice": "60000.0"},
                {"symbol": "ETHUSDT", "markPrice": "NaN-string"},
                {"symbol": "SOLUSDT"},  # missing markPrice entirely
            ]
        )
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_mark_prices(
                mock_exchange, ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
            )
        # The good row is kept; the bad rows are dropped.
        assert result.get("BTCUSDT") == 60000.0
        assert "ETHUSDT" not in result
        assert "SOLUSDT" not in result
        # WARNINGs must name the dropped symbols.
        drops = [
            r for r in caplog.records
            if "fetch_mark_prices Binance" in r.getMessage()
            and "dropping sym=" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert len(drops) >= 2, (
            f"PR #181 take-2 F3: expected per-symbol WARNING for each "
            f"dropped row; observed {len(drops)}"
        )
        msgs = " | ".join(r.getMessage() for r in drops)
        assert "ETHUSDT" in msgs, "WARNING must name ETHUSDT drop"
        assert "SOLUSDT" in msgs, "WARNING must name SOLUSDT drop"

    @pytest.mark.asyncio
    async def test_bybit_drops_unparseable_mark_price_with_warning(self, caplog):
        import logging
        from services.exchange import (
            fetch_mark_prices,
            _reset_mark_price_cache_for_tests,
        )

        _reset_mark_price_cache_for_tests()
        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_market_tickers = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {"symbol": "BTCUSDT", "markPrice": "60000.0"},
                        {"symbol": "ETHUSDT", "markPrice": "NaN-string"},
                    ]
                }
            }
        )
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_mark_prices(
                mock_exchange, ["BTCUSDT", "ETHUSDT"]
            )
        assert result.get("BTCUSDT") == 60000.0
        assert "ETHUSDT" not in result
        drops = [
            r for r in caplog.records
            if "fetch_mark_prices Bybit" in r.getMessage()
            and "dropping sym=ETHUSDT" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert drops, (
            "PR #181 take-2 F3: ETHUSDT drop must emit a Bybit-specific "
            "WARNING naming the symbol"
        )


# Review-cluster gate (audit-2026-05-07): the Binance branch fix in
# fetch_daily_pnl's `except Exception` arm — pre-gate it had NO
# regression test. A /simplify pass that drops the new WARNING would
# land silently.
class TestFetchDailyPnlBinanceFailLoud:
    """Pre-sweep, the Binance futures-income failure path silently
    swallowed the exception and fell back to BTC spot trades with no
    log attributing the fallback to a futures-income drift. Post-sweep,
    a WARNING fires before the fallback so operators can spot systemic
    issues (Binance schema change, auth failure masquerading as
    futures-permission denial) instead of only seeing 'BTC spot
    fallback fired' in the data.
    """

    @pytest.mark.asyncio
    async def test_binance_futures_income_failure_logs_warning_before_fallback(
        self, caplog
    ):
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        # fapiPrivate_get_income raises → WARNING + fallback to fetch_my_trades.
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=RuntimeError(
                "simulated Binance futures-income RPC failure"
            )
        )
        # The fallback returns one trade so we can verify the path was taken.
        # Note: ccxt trade dicts use `datetime` as the ISO-string key (the
        # Binance fallback in fetch_daily_pnl reads `t["datetime"]`),
        # distinct from Python's datetime module. The fallback ALSO reads
        # `t["symbol"]` /
        # `t["side"]` / etc. via subscript (no .get default), so the
        # mock must populate every required key.
        mock_exchange.fetch_my_trades = AsyncMock(
            return_value=[
                {
                    "symbol": "BTC/USDT",
                    "amount": 0.1,
                    "price": 50000.0,
                    "side": "buy",
                    "fee": {"cost": 0.5, "currency": "USDT"},
                    "timestamp": 1700000000000,
                    "datetime": "2023-11-14T22:13:20.000Z",
                    "type": "market",
                }
            ]
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Failure-soft + fallback contract: result is non-empty (fallback ran).
        assert isinstance(result, list)
        assert len(result) >= 1, (
            "Binance branch must fall back to fetch_my_trades when "
            "futures-income raises; fallback produced no rows"
        )
        # Operator visibility: WARNING naming the Binance futures-income mode.
        matching = [
            r for r in caplog.records
            if "Binance futures-income" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Binance futures-income failure must produce a WARNING log with "
            "prefix 'Binance futures-income' (post audit-2026-05-07 "
            "silent-failure sweep); the prior bare-pass swallow is a "
            "regression"
        )
        # PR #181 take-2 security F7: structured-logging contract changed
        # to drop exc_info=True on this site to prevent ccxt network-class
        # exception messages from leaking the signed URL +
        # &signature=<HMAC> into the traceback. The new contract carries
        # the exception class via `exc_class=` and the scrubbed message
        # via `scrubbed=` in the WARNING template.
        assert any(
            "exc_class=" in r.getMessage() for r in matching
        ), (
            "Binance futures-income WARNING must include exc_class= label "
            "(PR #181 take-2 HMAC-leak fix)"
        )
        assert any(
            "scrubbed=" in r.getMessage() for r in matching
        ), (
            "Binance futures-income WARNING must include scrubbed= label "
            "for the redacted message (PR #181 take-2 HMAC-leak fix)"
        )
        assert all(
            r.exc_info is None for r in matching
        ), (
            "Binance futures-income WARNING must NOT use exc_info=True — "
            "the traceback's first line includes str(exc) which carries "
            "the signed URL + signature. Use scrubbed string instead."
        )

    @pytest.mark.asyncio
    async def test_binance_fallback_failure_escapes_to_outer_error(self, caplog):
        """Documents the cascade boundary (silent-failure-hunter LOW #5):
        if BOTH futures-income AND the fallback fetch_my_trades raise,
        the inner Binance WARNING fires AND the OUTER 'fetch_daily_pnl
        failed' ERROR also fires (because the fallback has no try/except
        of its own). Operators see TWO logs and can disambiguate
        'transient' vs 'systemic' Binance issues. This test pins that
        boundary so a future refactor wrapping the fallback in its own
        try/except doesn't silently swallow the cascade.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=RuntimeError("simulated futures-income failure")
        )
        mock_exchange.fetch_my_trades = AsyncMock(
            side_effect=RuntimeError("simulated spot-trades fallback failure")
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Outer wrapper still returns [] (best-effort enrichment path).
        assert result == []
        # Inner WARNING fired naming the futures-income mode.
        inner = [
            r for r in caplog.records
            if "Binance futures-income" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert inner, "inner Binance WARNING must fire"
        # Outer wrapper ERROR fired (fallback also raised, escapes to L620).
        outer = [
            r for r in caplog.records
            if "fetch_daily_pnl failed" in r.getMessage()
            and r.levelno == logging.ERROR
        ]
        assert outer, (
            "outer fetch_daily_pnl ERROR must fire when the fallback also "
            "raises — this is the documented cascade contract"
        )

    @pytest.mark.asyncio
    async def test_binance_futures_income_warning_scrubs_hmac_signature(
        self, caplog
    ):
        """PR #181 take-2 security F7: the Binance futures-income WARNING
        previously used `exc_info=True` and interpolated the raw exception.
        For ccxt network-class errors (RequestTimeout, ExchangeNotAvailable
        etc.) the exception message embeds the signed request URL, which
        ends with `&signature=<HMAC-SHA256>` for signed fapiPrivate
        endpoints. The new contract scrubs the message via
        `services.redact.scrub_freeform_string` so the HMAC is replaced
        with the REDACTED token before reaching Railway/Sentry. Pre-take2
        the HMAC plaintext landed in logs on every Binance fapi network
        failure.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        # Simulate the shape of a ccxt RequestTimeout: `details` =
        # `id method url`, where url contains `&signature=<HMAC>`.
        # The exception's str() will carry this verbatim.
        fake_url = (
            "https://fapi.binance.com/fapi/v1/income?"
            "timestamp=1700000000000&recvWindow=5000&"
            "signature=abcdef0123456789deadbeefcafebabe1111222233334444"
        )
        signed_exc_msg = f"binance GET {fake_url}"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=RuntimeError(signed_exc_msg)
        )
        # Fallback succeeds so we only observe the inner WARNING.
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            await fetch_daily_pnl(mock_exchange)

        binance_warns = [
            r for r in caplog.records
            if "Binance futures-income" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert binance_warns, "Binance WARNING must fire on RPC failure"
        # The raw HMAC plaintext must NOT appear anywhere in the WARNING
        # message text.
        for rec in binance_warns:
            msg = rec.getMessage()
            assert "abcdef0123456789deadbeefcafebabe1111222233334444" not in msg, (
                f"HMAC signature plaintext leaked into Binance WARNING: {msg!r}"
            )
            # exc_info must be None (we dropped it as part of the scrub fix).
            assert rec.exc_info is None, (
                "Binance WARNING must not carry exc_info=True (HMAC-leak fix)"
            )


# ---------------------------------------------------------------------------
# Audit-2026-05-07 cluster-I regression tests
# ---------------------------------------------------------------------------
# Pins the new data-quality-flag surface, finite-value validation, fee-
# currency mismatch detection, raw_data trimming, and OKX funding-bill
# filter introduced by FIX-LIST-FIXED-cluster-I. Each test fails without
# the corresponding fix.
# ---------------------------------------------------------------------------


class TestClusterIDqFlagBuffer:
    """C-0225 / M-0663 / H-0670 — per-task DQ flag buffer for partial
    failures, sync truncation, and fee-currency mismatches."""

    def test_get_and_clear_returns_empty_on_no_flags(self) -> None:
        """A clean call returns ``{}`` and leaves the buffer empty."""
        from services.exchange import get_and_clear_last_dq_flags
        # Drain whatever any previous test left behind.
        get_and_clear_last_dq_flags()
        assert get_and_clear_last_dq_flags() == {}

    def test_record_dq_flag_merges_list_dedup(self) -> None:
        """List values dedup-merge instead of replacing."""
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _record_dq_flag("binance_partial_symbols", ["BTCUSDT"])
        _record_dq_flag(
            "binance_partial_symbols", ["BTCUSDT", "ETHUSDT"],
        )
        flags = get_and_clear_last_dq_flags()
        assert flags["binance_partial_symbols"] == ["BTCUSDT", "ETHUSDT"]
        # Drain.
        assert get_and_clear_last_dq_flags() == {}

    def test_record_dq_flag_bool_or_merge(self) -> None:
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _record_dq_flag("sync_truncated_okx", False)
        _record_dq_flag("sync_truncated_okx", True)
        flags = get_and_clear_last_dq_flags()
        assert flags["sync_truncated_okx"] is True


class TestClusterIBinancePartialFailureSurface:
    """C-0225 — partial-symbol Binance failures now surface to the DQ
    buffer so the worker can stamp them into ``strategy_analytics``."""

    @pytest.mark.asyncio
    async def test_partial_failure_records_failed_symbols(self) -> None:
        import asyncio
        from services.exchange import (
            fetch_raw_trades,
            get_and_clear_last_dq_flags,
        )

        # Drain any flags from previous tests.
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise RuntimeError("simulated ETH 500")
            return [
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
            ]

        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        flags = get_and_clear_last_dq_flags()
        # Pre-fix: flags["binance_partial_symbols"] was never set, partial
        # failures were log-only and the allocator dashboard rendered the
        # successful subset as canonical. This is the load-bearing assert.
        assert "binance_partial_symbols" in flags
        assert "ETHUSDT" in flags["binance_partial_symbols"]
        assert "BTCUSDT" not in flags["binance_partial_symbols"]

    @pytest.mark.asyncio
    async def test_full_success_leaves_dq_buffer_clean(self) -> None:
        """A clean sync must NOT leak a stale flag into the buffer."""
        import asyncio
        from services.exchange import (
            fetch_raw_trades,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
        ])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(mock_eq2, [{"symbol": "BTCUSDT"}])
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        flags = get_and_clear_last_dq_flags()
        assert flags.get("binance_partial_symbols") is None


class TestClusterIFeeCurrencyMismatch:
    """H-0670 — fee_currency != quote-currency must surface a DQ flag."""

    def test_infer_quote_currency_handles_common_shapes(self) -> None:
        from services.exchange import _infer_quote_currency
        assert _infer_quote_currency("BTC/USDT:USDT") == "USDT"
        assert _infer_quote_currency("BTC/USDT") == "USDT"
        assert _infer_quote_currency("BTCUSDT") == "USDT"
        assert _infer_quote_currency("BTCUSDC") == "USDC"
        assert _infer_quote_currency("BTCUSD") == "USD"
        # No confident inference -> None (avoids false positives).
        assert _infer_quote_currency("BTCETH") is None
        assert _infer_quote_currency("") is None

    def test_mismatch_sets_flag_and_sample(self) -> None:
        from services.exchange import (
            _check_fee_currency_mismatch,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _check_fee_currency_mismatch(
            exchange="binance", symbol="BTCUSDT", fee_currency="BNB",
        )
        flags = get_and_clear_last_dq_flags()
        # Pre-fix: silent. Post-fix: DQ flag with bounded sample list.
        assert flags["fee_currency_mismatch"] is True
        assert "binance:BTCUSDT:BNB" in flags["fee_currency_mismatch_samples"]

    def test_match_does_not_set_flag(self) -> None:
        from services.exchange import (
            _check_fee_currency_mismatch,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _check_fee_currency_mismatch(
            exchange="binance", symbol="BTCUSDT", fee_currency="USDT",
        )
        flags = get_and_clear_last_dq_flags()
        assert flags.get("fee_currency_mismatch") is None


class TestClusterIFiniteFloat:
    """H-0661 (partial) — reject NaN/inf at the ingestion boundary so
    they can't land in the typed numeric columns and silently corrupt
    every downstream metric. Full pydantic validation is deferred."""

    def test_finite_float_accepts_normal_values(self) -> None:
        from services.exchange import _finite_float
        assert _finite_float("60000.5", label="price") == 60000.5
        assert _finite_float(60000, label="price") == 60000.0
        assert _finite_float(0, label="fee") == 0.0
        # Negative is fine — fee can be a maker rebate.
        assert _finite_float(-0.6, label="fee") == -0.6

    def test_finite_float_rejects_nan_inf(self) -> None:
        from services.exchange import _finite_float
        assert _finite_float(float("nan"), label="price") is None
        assert _finite_float(float("inf"), label="price") is None
        assert _finite_float(float("-inf"), label="price") is None
        assert _finite_float("nan", label="price") is None
        assert _finite_float("inf", label="price") is None

    def test_finite_float_rejects_non_numeric(self) -> None:
        from services.exchange import _finite_float
        assert _finite_float("not-a-number", label="price") is None
        assert _finite_float(None, label="price") is None
        # Bool must NOT silently coerce (True is int subclass).
        assert _finite_float(True, label="price") is None
        assert _finite_float(False, label="price") is None


class TestClusterIRawDataTrim:
    """M-0665 — raw_data is trimmed to a whitelist of fields downstream
    consumers actually read, so the JSONB column stays small. Set
    EXCHANGE_STORE_RAW_DATA=1 in env to opt back into full storage."""

    def test_trim_drops_unrelated_keys(self) -> None:
        from services.exchange import _trim_raw_data
        full = {
            "posSide": "long",
            "feeCcy": "USDT",
            "marginMode": "cross",   # not in whitelist
            "lever": "10",            # not in whitelist
            "uTime": "1700000000000",  # not in whitelist
        }
        trimmed = _trim_raw_data(full)
        assert trimmed == {"posSide": "long", "feeCcy": "USDT"}

    def test_trim_returns_none_on_empty_after_trim(self) -> None:
        """No whitelisted keys -> NULL JSONB (lowest storage)."""
        from services.exchange import _trim_raw_data
        assert _trim_raw_data({}) is None
        assert _trim_raw_data({"marginMode": "cross"}) is None

    def test_trim_passes_none_through(self) -> None:
        from services.exchange import _trim_raw_data
        assert _trim_raw_data(None) is None

    def test_full_storage_env_opt_in(self, monkeypatch) -> None:
        """When ``EXCHANGE_STORE_RAW_DATA=1``, no trimming occurs.

        The module-level ``_STORE_FULL_RAW_DATA`` constant is captured
        at import time, so we patch it directly for this test rather
        than relying on env var re-reads.
        """
        from services import exchange as svc
        monkeypatch.setattr(svc, "_STORE_FULL_RAW_DATA", True)
        full = {"marginMode": "cross", "lever": "10"}
        assert svc._trim_raw_data(full) == full

    def test_make_fill_dict_trims_raw_data_by_default(self) -> None:
        from services.exchange import _make_fill_dict
        out = _make_fill_dict(
            exchange="okx",
            symbol="BTCUSDTSWAP",
            side="buy",
            price=60000.0,
            quantity=0.1,
            fee=-0.6,
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="trade-1",
            is_maker=False,
            raw_data={
                "posSide": "long",
                "marginMode": "cross",  # trimmed away
                "ordType": "market",     # trimmed away
            },
            position_direction="long",
        )
        rd = out["raw_data"]
        # Whitelist survives, plus the canonical position_direction
        # injected by the factory.
        assert "posSide" in rd
        assert rd["position_direction"] == "long"
        # Unwhitelisted keys must NOT leak through.
        assert "marginMode" not in rd
        assert "ordType" not in rd


class TestClusterIOkxFundingBillFilter:
    """C-0319 — OKX fetch_daily_pnl must drop bills with type=='8'
    (funding-fee) so daily_pnl does not double-count funding that is
    ALSO ingested via services.funding_fetch. Mirrors the Binance
    Sprint 5.6 ``incomeType`` filter cutover."""

    @pytest.mark.asyncio
    async def test_okx_funding_bills_excluded_from_daily_pnl(self) -> None:
        """A bill with type='8' (funding) must NOT contribute to the
        aggregated daily total. Pre-fix it was summed into
        ``daily_pnl`` and rendered on the equity-curve while also
        being attributed separately under positions.funding_pnl,
        inflating perceived economic P&L by the funding amount."""
        from services.exchange import fetch_daily_pnl

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        # Two bills on the same day, identical magnitude. The funding
        # bill (type=8) MUST be dropped, leaving only the trade-pnl
        # bill (type=2). Pre-fix the aggregator would sum both.
        page = {
            "data": [
                {
                    "billId": "bill-trade",
                    "type": "2",
                    "pnl": "10",
                    "fee": "0",
                    "ts": "1700000000000",
                    "instType": "SWAP",
                    "billType": "trade",
                },
                {
                    "billId": "bill-funding",
                    "type": "8",
                    "pnl": "10",
                    "fee": "0",
                    "ts": "1700000000000",
                    "instType": "SWAP",
                    "billType": "funding",
                },
            ]
        }
        empty = {"data": []}

        call_state = {"n": 0}

        async def _bills(params):
            call_state["n"] += 1
            return page if call_state["n"] == 1 else empty

        mock_exchange.private_get_account_bills = _bills
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": []}
        )

        result = await fetch_daily_pnl(mock_exchange, since_ms=None)
        # Exactly one daily-PnL row, equal to the trade bill only.
        okx_rows = [r for r in result if r.get("exchange") == "okx"]
        assert len(okx_rows) == 1
        # Magnitude must equal the trade bill (10), NOT the sum (20).
        assert okx_rows[0]["price"] == 10.0


class TestClusterIBybitFundingFlag:
    """C-0319 (Bybit cutover) — Bybit's ``closedPnl`` is the
    funding-INCLUSIVE cashflow per Bybit's own help-center formula:

        closedPnl = positionPnl - openFee - closeFee - sumFunding

    The cutover reconstructs realized-PnL-EXCLUDING-funding directly
    from ``cumEntryValue``, ``cumExitValue``, ``openFee``, ``closeFee``
    (fields the same response returns) and pushes that into
    ``daily_pnl``. The ``bybit_daily_pnl_includes_funding`` DQ flag is
    therefore retired — these tests pin the post-cutover contract.
    """

    @pytest.mark.asyncio
    async def test_bybit_daily_pnl_no_funding_flag_post_cutover(self) -> None:
        """Post-cutover: the legacy ``bybit_daily_pnl_includes_funding``
        flag must NEVER fire, regardless of whether closed_pnl returned
        rows. This is the regression that pins the cutover — pre-cutover
        ``fetch_daily_pnl`` stamped the flag on every non-empty Bybit
        response."""
        from services.exchange import (
            fetch_daily_pnl,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Sell",          # closing a long
                            "cumEntryValue": "1000",
                            "cumExitValue": "1015",
                            "openFee": "0.5",
                            "closeFee": "0.5",
                            "closedPnl": "12.0",
                            "createdTime": "1700000000000",
                        }
                    ]
                }
            }
        )

        await fetch_daily_pnl(mock_exchange, since_ms=None)
        flags = get_and_clear_last_dq_flags()
        assert flags.get("bybit_daily_pnl_includes_funding") is None, (
            "C-0319 cutover: bybit_daily_pnl_includes_funding flag is "
            "retired. fetch_daily_pnl must never set it post-cutover."
        )

    @pytest.mark.asyncio
    async def test_bybit_no_rows_no_flag(self) -> None:
        """When Bybit returns no closed positions, the legacy flag
        must NOT fire (the flag is retired by C-0319)."""
        from services.exchange import (
            fetch_daily_pnl,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={"result": {"list": []}}
        )

        await fetch_daily_pnl(mock_exchange, since_ms=None)
        flags = get_and_clear_last_dq_flags()
        assert flags.get("bybit_daily_pnl_includes_funding") is None


class TestClusterIBybitFundingCutoverC0319:
    """C-0319 (Bybit cutover) — regression suite pinning the cumEntry/
    cumExit reconstruction. These tests would FAIL under the
    pre-cutover code path (which shipped ``closedPnl`` as-is into
    ``daily_pnl``), so they encode the FIX, not just the resulting
    behaviour."""

    @pytest.mark.asyncio
    async def test_C0319_bybit_funding_excluded_from_daily_pnl_long(
        self,
    ) -> None:
        """A long-side closure that paid 2.10 USDT of cumulative funding
        during its lifetime: pre-cutover ``closedPnl`` already subtracts
        funding (and trading fees), so shipping closedPnl as-is into
        daily_pnl LOSES 2.10 of realized PnL (the funding line then
        re-adds 2.10 in positions.funding_pnl, completing the
        double-count). Post-cutover, daily_pnl carries the
        realized-PnL-EXCLUDING-funding figure (positionPnl - fees).
        """
        from services.exchange import fetch_daily_pnl

        # Bybit-help-center worked example for a closing Sell of 0.4 BTC:
        # entry=6000, exit=5000 — but the help-center example is a SHORT.
        # We re-use the same arithmetic for a long (side=Sell closing a
        # buy position): positionPnl = exit - entry = 1015 - 1000 = 15
        # USDT. Fees: openFee=0.5, closeFee=0.5. Funding paid=2.10.
        # Bybit closedPnl = 15 - 0.5 - 0.5 - 2.10 = 11.90.
        # realized_pnl_ex_funding = 15 - 0.5 - 0.5 = 14.0.
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Sell",
                            "cumEntryValue": "1000",
                            "cumExitValue": "1015",
                            "openFee": "0.5",
                            "closeFee": "0.5",
                            "closedPnl": "11.90",
                            "createdTime": "1700000000000",
                        }
                    ]
                }
            }
        )

        result = await fetch_daily_pnl(mock_exchange, since_ms=None)
        bybit_rows = [r for r in result if r.get("exchange") == "bybit"]
        # One day, one aggregate row.
        assert len(bybit_rows) == 1, bybit_rows
        # Magnitude = realized PnL EXCLUDING funding (14.0), NOT the
        # funding-inclusive closedPnl (11.90). This is the C-0319 fix.
        assert bybit_rows[0]["price"] == pytest.approx(14.0), (
            "Post-C-0319: daily_pnl magnitude must equal positionPnl - "
            "openFee - closeFee (funding excluded), not closedPnl which "
            "bakes funding in. Got %r." % bybit_rows[0]["price"]
        )
        # Positive realized: side encodes sign convention used by
        # transforms.trades_to_daily_returns_with_status.
        assert bybit_rows[0]["side"] == "buy"

    @pytest.mark.asyncio
    async def test_C0319_bybit_funding_excluded_from_daily_pnl_short(
        self,
    ) -> None:
        """Short-side closure (side=Buy on the closing leg).
        positionPnl = cumEntryValue - cumExitValue. Help-center example:
        entry=6000, exit=5000 on 0.4 BTC short → positionPnl = +400.
        After 1.32 + 1.10 fees: realized_pnl_ex_funding = 397.58.
        Bybit closedPnl after 2.10 funding = 395.48."""
        from services.exchange import fetch_daily_pnl

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Buy",
                            "cumEntryValue": "2400",  # 0.4 * 6000
                            "cumExitValue": "2000",   # 0.4 * 5000
                            "openFee": "1.32",
                            "closeFee": "1.1",
                            "closedPnl": "395.48",
                            "createdTime": "1700000000000",
                        }
                    ]
                }
            }
        )

        result = await fetch_daily_pnl(mock_exchange, since_ms=None)
        bybit_rows = [r for r in result if r.get("exchange") == "bybit"]
        assert len(bybit_rows) == 1
        assert bybit_rows[0]["price"] == pytest.approx(397.58), (
            "Short-side: positionPnl = cumEntryValue - cumExitValue. "
            "Expected 400 - 1.32 - 1.1 = 397.58."
        )
        assert bybit_rows[0]["side"] == "buy"

    @pytest.mark.asyncio
    async def test_C0319_bybit_funding_excluded_aggregates_by_day(
        self,
    ) -> None:
        """Multiple closures on the same UTC day collapse into a single
        daily aggregate row (mirroring the OKX branch contract)."""
        from services.exchange import fetch_daily_pnl

        # Two timestamps within the same UTC day. 1700006400000 ms =
        # 2023-11-15 00:00:00 UTC; 1700049600000 ms = 2023-11-15
        # 12:00:00 UTC. Both land on 2023-11-15.
        same_day_ts = "1700006400000"
        same_day_ts2 = "1700049600000"
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT", "side": "Sell",
                            "cumEntryValue": "1000",
                            "cumExitValue": "1010",
                            "openFee": "0", "closeFee": "0",
                            "closedPnl": "10",
                            "createdTime": same_day_ts,
                        },
                        {
                            "symbol": "ETHUSDT", "side": "Sell",
                            "cumEntryValue": "500",
                            "cumExitValue": "505",
                            "openFee": "0", "closeFee": "0",
                            "closedPnl": "5",
                            "createdTime": same_day_ts2,
                        },
                    ]
                }
            }
        )

        result = await fetch_daily_pnl(mock_exchange, since_ms=None)
        bybit_rows = [r for r in result if r.get("exchange") == "bybit"]
        # Two closures, one aggregated daily row.
        assert len(bybit_rows) == 1
        # 10 + 5 = 15 realized-PnL-ex-funding for the day.
        assert bybit_rows[0]["price"] == pytest.approx(15.0)
        assert bybit_rows[0]["symbol"] == "PORTFOLIO"

    @pytest.mark.asyncio
    async def test_C0319_bybit_funding_drops_non_finite_row(self) -> None:
        """Schema-drift defense: a single row with non-finite cumEntry
        is dropped (with a WARNING) and does not poison the day's
        aggregate."""
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT", "side": "Sell",
                            "cumEntryValue": "NaN",
                            "cumExitValue": "1010",
                            "openFee": "0", "closeFee": "0",
                            "closedPnl": "10",
                            "createdTime": "1700000000000",
                        },
                        {
                            "symbol": "ETHUSDT", "side": "Sell",
                            "cumEntryValue": "500",
                            "cumExitValue": "505",
                            "openFee": "0", "closeFee": "0",
                            "closedPnl": "5",
                            "createdTime": "1700000000000",
                        },
                    ]
                }
            }
        )

        import logging as _logging
        caplog_logger = _logging.getLogger("quantalyze.analytics")
        caplog_logger.setLevel(logging.WARNING)
        result = await fetch_daily_pnl(mock_exchange, since_ms=None)
        bybit_rows = [r for r in result if r.get("exchange") == "bybit"]
        # The clean row survives; the NaN row is filtered.
        assert len(bybit_rows) == 1
        assert bybit_rows[0]["price"] == pytest.approx(5.0)


class TestClusterIOkxFiniteValidation:
    """H-0661 (partial) — OKX fills with NaN/inf price or amount must
    be dropped, not coerced into the typed numeric column."""

    @pytest.mark.asyncio
    async def test_okx_nan_fill_dropped(self) -> None:
        from services.exchange import _fetch_raw_trades_okx

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "nan",     # rejected by _finite_float
                "fillSz": "0.1",
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
            },
            {
                "instId": "BTC-USDT-SWAP",
                "side": "sell",
                "fillPx": "60000",
                "fillSz": "inf",     # rejected
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700001000000",
                "ordId": "ord-2",
                "tradeId": "trade-2",
                "execType": "T",
            },
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700002000000",
                "ordId": "ord-3",
                "tradeId": "trade-3",
                "execType": "T",
            },
        ])

        result = await _fetch_raw_trades_okx(mock_exchange, None)
        # Only the third (clean) fill survives.
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "trade-3"


class TestClusterIBybitFeeCurrencyMismatchFlag:
    """H-0670 — Bybit fill paying fee in BNB on a USDT pair must
    surface the mismatch flag."""

    @pytest.mark.asyncio
    async def test_bnb_fee_on_usdt_pair_flags_mismatch(self) -> None:
        from services.exchange import (
            _fetch_raw_trades_bybit,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Buy",
                            "execPrice": "60000",
                            "execQty": "0.1",
                            "execFee": "0.0001",
                            "feeCurrency": "BNB",  # mismatch
                            "execTime": "1700000000000",
                            "orderId": "ord-1",
                            "execId": "exec-1",
                            "isMaker": "false",
                        }
                    ],
                    "nextPageCursor": "",
                }
            }
        )

        await _fetch_raw_trades_bybit(mock_exchange, None)
        flags = get_and_clear_last_dq_flags()
        assert flags.get("fee_currency_mismatch") is True
        samples = flags.get("fee_currency_mismatch_samples") or []
        assert any("BNB" in s for s in samples)


class TestClusterIPageCapTruncationFlag:
    """M-0663 — hitting the 100-page pagination cap must surface a
    DQ flag so the admin compute-jobs UI / health card can show
    truncation. Pre-fix it was log-only."""

    @pytest.mark.asyncio
    async def test_okx_page_cap_records_dq_flag(self) -> None:
        from services.exchange import (
            _fetch_raw_trades_okx,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        # Return a full page (100 fills) on every call so the loop never
        # naturally breaks. The cursor advances each page.
        call_state = {"n": 0}

        def _fill(idx: int) -> dict:
            return {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.001",
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": f"ord-{idx}",
                "tradeId": f"trade-{call_state['n']}-{idx}",
                "execType": "T",
            }

        async def _history(params):
            call_state["n"] += 1
            return {
                "data": [_fill(i) for i in range(100)],
            }

        mock_exchange.private_get_trade_fills_history = _history

        result = await _fetch_raw_trades_okx(mock_exchange, since_ms=None)
        # NEW-C13-02: fan-out hits page cap for all 4 instTypes.
        # 4 instTypes × 100 pages × 100 fills = 40_000 fills total.
        assert len(result) == 4 * 100 * 100
        flags = get_and_clear_last_dq_flags()
        assert flags.get("sync_truncated_okx") is True
        # 4 instTypes × PAGE_CAP=100 = 400 total pages recorded.
        assert flags.get("sync_truncated_okx_pages") == 4 * 100


class TestClusterIDqBufferResetOnEntry:
    """Defense-in-depth: ``fetch_raw_trades`` resets the buffer at
    entry so a stale flag from a prior call cannot leak into a clean
    sync's reported flags."""

    @pytest.mark.asyncio
    async def test_entry_seam_clears_stale_flags(self) -> None:
        import asyncio
        from services.exchange import (
            _record_dq_flag,
            fetch_raw_trades,
            get_and_clear_last_dq_flags,
        )
        # Plant a stale flag from a prior call.
        get_and_clear_last_dq_flags()
        _record_dq_flag("binance_partial_symbols", ["STALE_SYMBOL"])

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(mock_eq2, [{"symbol": "BTCUSDT"}])
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        flags = get_and_clear_last_dq_flags()
        # Stale flag is gone.
        assert "STALE_SYMBOL" not in (flags.get("binance_partial_symbols") or [])


class TestClusterIH0668SymbolNormalizationDocumented:
    """H-0668 — documents that OKX produces ``BTCUSDTSWAP`` while
    Binance/Bybit produce ``BTCUSDT``. The fix calls for full
    canonicalization across exchanges, but doing it silently at the
    writer would split historical OKX positions (old rows
    ``BTCUSDTSWAP`` vs new ``BTCUSDT``) without a backfill migration.
    This test pins the current divergence so a future migration PR
    has a tripwire — when the divergence is closed, this assertion
    must be flipped to assert equality.

    Testing-batch fix (2026-05-17): the prior implementation only
    asserted properties of inline string transforms in the test itself
    — it never invoked the production canonicalizer, so a regression
    that changed ``_normalize_fill`` or ``_fetch_raw_trades_okx``
    would NOT have failed this tripwire. Now we exercise the real
    paths.
    """

    @pytest.mark.asyncio
    async def test_okx_and_binance_currently_produce_different_canonical_forms(
        self,
    ) -> None:
        from services.exchange import _fetch_raw_trades_okx, _normalize_fill

        # OKX production path: invoke _fetch_raw_trades_okx against a
        # single-fill mock so the assertion reflects whatever the OKX
        # canonicalizer ACTUALLY produces today (currently
        # ``instId.replace('-', '')`` inside _fetch_raw_trades_okx).
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # NEW-C13-02: use _okx_swap_only so FUTURES/SPOT/MARGIN return empty.
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.001",
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
            }
        ])
        okx_rows = await _fetch_raw_trades_okx(mock_exchange, since_ms=None)
        assert len(okx_rows) == 1
        okx_canonical = okx_rows[0]["symbol"]

        # Binance production path: invoke _normalize_fill directly with
        # a CCXT-unified trade dict. The function applies the
        # slash/colon-suffix transform when building ``normalized_symbol``.
        binance_fill = _normalize_fill(
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
            "binance",
        )
        assert binance_fill is not None
        binance_canonical = binance_fill["symbol"]

        # PRE-fix state (documented). When a follow-up PR introduces a
        # cross-exchange canonicalizer + backfill migration, flip this
        # assert to ``==`` and remove the audit note in
        # FIX-LIST-FIXED-cluster-I.md.
        assert okx_canonical != binance_canonical
        assert okx_canonical == "BTCUSDTSWAP"
        assert binance_canonical == "BTCUSDT"


class TestClusterIDqFlagMergeSemantics:
    """Audit-2026-05-07 testing batch — pin the merge semantics of
    ``_record_dq_flag``. The docstring promises lists dedup-append,
    booleans OR-merge, counters sum, but only the list and bool branches
    had pinned tests. A regression that drops either guard (counter
    branch, bool guard against True+True=2) would silently corrupt the
    ``data_quality_flags`` JSONB across every truncated/partial sync.
    """

    def test_record_dq_flag_int_counter_sums(self) -> None:
        """Two int writes to the same key MUST sum (not overwrite).
        The page-count flags (sync_truncated_okx_pages,
        sync_truncated_bybit_pages) rely on this for cumulative
        cross-instrument-type totals.
        """
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _record_dq_flag("sync_truncated_okx_pages", 100)
        _record_dq_flag("sync_truncated_okx_pages", 50)
        flags = get_and_clear_last_dq_flags()
        assert flags["sync_truncated_okx_pages"] == 150

    def test_record_dq_flag_bool_does_not_sum(self) -> None:
        """The ``not isinstance(existing, bool)`` guard prevents True+True
        from collapsing to 2 under the (int, float) sum branch. A
        regression dropping the guard would turn a stable boolean
        truncation signal into an unbounded integer.
        """
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _record_dq_flag("sync_truncated_okx", True)
        _record_dq_flag("sync_truncated_okx", True)
        flags = get_and_clear_last_dq_flags()
        assert flags["sync_truncated_okx"] is True


class TestClusterIFeeCurrencyMismatchSampleCap:
    """H-0670 — ``_FEE_CCY_MISMATCH_SAMPLE_CAP`` bounds the sample list
    so a strategy with many distinct mismatching pairs can't grow the
    JSONB row unboundedly. Pin the invariant so a future refactor that
    drops the cap or flips ordering (last-N vs first-N) is caught.
    """

    def test_sample_cap_preserves_first_n_samples(self) -> None:
        from services.exchange import (
            _FEE_CCY_MISMATCH_SAMPLE_CAP,
            _check_fee_currency_mismatch,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        # 20 distinct symbols, all USDT-quoted, all paying fee in BNB.
        for i in range(20):
            _check_fee_currency_mismatch(
                exchange="binance",
                symbol=f"SYM{i:03d}USDT",
                fee_currency="BNB",
            )
        flags = get_and_clear_last_dq_flags()
        samples = flags["fee_currency_mismatch_samples"]
        # Bounded by the cap (16 today).
        assert len(samples) == _FEE_CCY_MISMATCH_SAMPLE_CAP
        # First-N preservation contract — adding more mismatches after
        # the cap is reached MUST NOT evict earlier samples. Operators
        # otherwise lose representative early observations.
        assert samples[0] == "binance:SYM000USDT:BNB"
        assert samples[_FEE_CCY_MISMATCH_SAMPLE_CAP - 1] == (
            f"binance:SYM{_FEE_CCY_MISMATCH_SAMPLE_CAP - 1:03d}USDT:BNB"
        )

    def test_unknown_quote_does_not_flag(self) -> None:
        """Conservative branch in ``_check_fee_currency_mismatch``: when
        ``_infer_quote_currency`` returns None (exotic pair we can't
        confidently classify), the mismatch flag MUST NOT fire — else
        every BTC-pair / exotic-quote strategy false-positives.
        """
        from services.exchange import (
            _check_fee_currency_mismatch,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()
        _check_fee_currency_mismatch(
            exchange="binance", symbol="BTCETH", fee_currency="BNB",
        )
        flags = get_and_clear_last_dq_flags()
        assert flags == {}


class TestClusterIDqBufferDrainResetsState:
    """Audit-2026-05-07 testing batch — pin the drain-and-reset side
    effect of ``get_and_clear_last_dq_flags`` on a NON-empty buffer.
    The empty-buffer case is already covered
    (test_get_and_clear_returns_empty_on_no_flags); without this test,
    a regression that drops the ``_LAST_DQ_FLAGS.set({})`` line in
    ``get_and_clear_last_dq_flags`` would leak stale flags to the next
    sync on the same asyncio task.
    """

    def test_get_and_clear_resets_after_nonempty_drain(self) -> None:
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        # Clean any residue from previous tests.
        get_and_clear_last_dq_flags()
        _record_dq_flag("binance_partial_symbols", ["BTCUSDT"])
        # First drain returns the populated state.
        first = get_and_clear_last_dq_flags()
        assert first["binance_partial_symbols"] == ["BTCUSDT"]
        # Second drain on the same task MUST return {}.
        assert get_and_clear_last_dq_flags() == {}


class TestClusterIBybitPageCapTruncationFlag:
    """M-0663 — mirror ``TestClusterIPageCapTruncationFlag`` for the
    Bybit branch. Bybit uses ``nextPageCursor`` cursor pagination
    instead of OKX's after-id; the natural-stop logic is different so
    the regression surface is different too. A regression that flips
    the Bybit ``natural_break`` invariant would silently drop the
    truncation signal for every Bybit perp strategy.
    """

    @pytest.mark.asyncio
    async def test_bybit_page_cap_records_dq_flag(self) -> None:
        from services.exchange import (
            _fetch_raw_trades_bybit,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"

        # Return a full page (100 fills) AND a non-empty rotating
        # nextPageCursor on every call so the loop never naturally
        # breaks via the cursor sentinel. Distinct cursor per call so
        # the stuck-cursor guard (G12.B.6) does not short-circuit.
        call_state = {"n": 0}

        async def _execution_list(params):
            call_state["n"] += 1
            return {
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Buy",
                            "execPrice": "60000",
                            "execQty": "0.001",
                            "execFee": "0",
                            "feeCurrency": "USDT",
                            "execTime": "1700000000000",
                            "orderId": f"ord-{call_state['n']}-{i}",
                            "execId": f"exec-{call_state['n']}-{i}",
                            "isMaker": "false",
                        }
                        for i in range(100)
                    ],
                    "nextPageCursor": f"cursor-{call_state['n']}",
                }
            }

        mock_exchange.private_get_v5_execution_list = _execution_list

        result = await _fetch_raw_trades_bybit(mock_exchange, since_ms=None)
        # 100 pages × 100 fills.
        assert len(result) == 100 * 100
        flags = get_and_clear_last_dq_flags()
        assert flags.get("sync_truncated_bybit") is True
        assert flags.get("sync_truncated_bybit_pages") == 100


class TestRedTeamPhase2RegressionEntrySeamClobbers:
    """Audit-2026-05-07 red-team CRITICAL conf=9 — Phase-2 introduced a
    silent-drop regression where ``fetch_raw_trades`` reset the per-task
    DQ buffer at its entry seam, wiping flags set by an earlier
    ``fetch_daily_pnl`` call before the worker could drain them. The
    fix is a drain BETWEEN the two exchange calls in the worker.

    Post-C-0319 (Bybit cutover) the ``bybit_daily_pnl_includes_funding``
    flag is retired (funding is now correctly excluded from daily_pnl
    via cumEntryValue/cumExitValue reconstruction). The
    entry-seam-clobber contract still holds for OTHER DQ flags — we
    pin it here using the ``sync_truncated_bybit`` flag, which fires
    in the same code path and exercises the same per-task buffer.
    """

    @pytest.mark.asyncio
    async def test_dq_flag_survives_fetch_raw_trades_reset(
        self,
    ) -> None:
        """A DQ flag set during fetch_daily_pnl must be capturable by a
        drain placed BETWEEN fetch_daily_pnl and fetch_raw_trades.
        Pins the contract: callers MUST drain between the two exchange
        calls or the trades-sync entry-seam reset clobbers the flag.
        """
        import asyncio
        from services.exchange import (
            _record_dq_flag,
            fetch_daily_pnl,
            fetch_raw_trades,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.markets = {}
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "side": "Sell",
                            "cumEntryValue": "1000",
                            "cumExitValue": "1015",
                            "openFee": "0.5",
                            "closeFee": "0.5",
                            "closedPnl": "11.90",
                            "createdTime": "1700000000000",
                        }
                    ]
                }
            }
        )
        # Bybit fetch_raw_trades reads from private_get_v5_execution_list.
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value={"result": {"list": [], "nextPageCursor": ""}}
        )

        mock_supabase = MagicMock()

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        # Step 1: fetch_daily_pnl runs. To pin the entry-seam contract
        # without depending on the retired C-0319 flag, plant a
        # synthetic DQ flag that the per-task buffer carries forward.
        await fetch_daily_pnl(mock_exchange, since_ms=None)
        _record_dq_flag("test_entry_seam_marker", True)
        # Step 2: simulated worker-side drain — the fix's contract.
        daily_flags = get_and_clear_last_dq_flags()
        assert daily_flags.get("test_entry_seam_marker") is True, (
            "Drain between fetch_daily_pnl and fetch_raw_trades must "
            "capture flags set during the daily_pnl call."
        )

        # Step 3: fetch_raw_trades — its entry-seam reset must NOT see
        # the flag (we already drained), so the reset is a no-op in
        # terms of dropped signal.
        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)
        post_flags = get_and_clear_last_dq_flags()
        assert post_flags.get("test_entry_seam_marker") is None


class TestRedTeamListMergeCap:
    """Audit-2026-05-07 red-team MEDIUM conf=8 — ``_record_dq_flag``'s
    list-merge branch had no cap. A Binance allocator whose 1500-symbol
    cold-start sweep all 500-errors could land 1500 strings in the
    JSONB row, blowing past TOAST inline threshold. Pin the cap at
    ``_DQ_LIST_MERGE_CAP``.
    """

    def test_list_merge_caps_at_dq_list_merge_cap(self) -> None:
        from services.exchange import (
            _DQ_LIST_MERGE_CAP,
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        # Push more than the cap in one shot.
        oversized = [f"SYM{i}" for i in range(_DQ_LIST_MERGE_CAP * 4)]
        _record_dq_flag("binance_partial_symbols", oversized)
        flags = get_and_clear_last_dq_flags()
        merged = flags.get("binance_partial_symbols") or []
        assert len(merged) <= _DQ_LIST_MERGE_CAP, (
            f"list-merge cap breached: {len(merged)} > {_DQ_LIST_MERGE_CAP}"
        )

    def test_list_merge_cap_holds_across_appends(self) -> None:
        """Two separate _record_dq_flag calls that each push 40 items
        must still respect the global cap on the merged value.
        """
        from services.exchange import (
            _DQ_LIST_MERGE_CAP,
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        _record_dq_flag(
            "binance_partial_symbols",
            [f"SYM_A_{i}" for i in range(40)],
        )
        _record_dq_flag(
            "binance_partial_symbols",
            [f"SYM_B_{i}" for i in range(40)],
        )
        flags = get_and_clear_last_dq_flags()
        merged = flags.get("binance_partial_symbols") or []
        assert len(merged) <= _DQ_LIST_MERGE_CAP


class TestRedTeamContextVarSharedDefaultIsolation:
    """Audit-2026-05-07 red-team MEDIUM conf=8 — the ContextVar default
    ``{}`` is shared across every reader. ``get_and_clear_last_dq_flags``
    must return a defensive copy so callers that mutate the return value
    cannot mutate the shared module default and leak across tasks.
    """

    def test_get_and_clear_returns_defensive_copy(self) -> None:
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        _record_dq_flag("sync_truncated_okx", True)
        drained = get_and_clear_last_dq_flags()
        assert drained.get("sync_truncated_okx") is True

        # Mutating the drained dict must NOT pollute the next drain.
        drained["sync_truncated_okx"] = "POISONED"
        drained["new_key"] = "leak"
        next_drain = get_and_clear_last_dq_flags()
        assert next_drain == {}, (
            "get_and_clear must return a defensive copy; "
            f"shared-default leak detected: {next_drain!r}"
        )


class TestBybitDailyPnlStartTimePagination:
    """Regression — 2026-05-21 user dogfood report.

    Pre-fix, ``fetch_daily_pnl`` for Bybit called the closed-pnl endpoint
    with ``{"category": "linear", "limit": 200}`` — no ``startTime``, no
    cursor pagination. Bybit V5's documented behaviour for
    ``/v5/position/closed-pnl`` is: "If startTime is not passed, only
    return last 7 days data" with a "maximum interval between startTime
    and endTime is 7 days". So a long-history account (months or years
    of closed positions) was being truncated to the trailing 7 calendar
    days, capping every new strategy at ``GATE_INSUFFICIENT_DAYS`` even
    though the user had ample data.

    The fix walks the [since_ms, now] interval in 7-day windows and
    paginates each window via ``nextPageCursor``. These tests pin:

    1. ``startTime`` is always sent (never the default-7-days behaviour).
    2. When ``since_ms=None``, the first window starts ~365 days back.
    3. ``nextPageCursor`` is followed within a window.
    """

    @pytest.mark.asyncio
    async def test_startTime_is_passed_when_since_ms_none(self):
        """Without this assertion, Bybit would silently default to last
        7 days and the truncation bug returns."""
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={"result": {"list": [], "nextPageCursor": ""}},
        )

        await fetch_daily_pnl(mock_exchange, since_ms=None)

        # At least one call must have been made.
        assert mock_exchange.private_get_v5_position_closed_pnl.call_count >= 1, (
            "Bybit closed-pnl endpoint must be invoked at least once"
        )
        # Every call must include startTime — pre-fix this was absent.
        for call in mock_exchange.private_get_v5_position_closed_pnl.call_args_list:
            params = call.args[0] if call.args else call.kwargs
            assert "startTime" in params, (
                f"startTime missing from Bybit closed-pnl call params={params!r}; "
                "without it Bybit defaults to last 7 days and truncates history"
            )
            assert "endTime" in params, (
                f"endTime missing from Bybit closed-pnl call params={params!r}; "
                "windowed pagination requires explicit endTime per Bybit's 7-day cap"
            )

    @pytest.mark.asyncio
    async def test_default_lookback_at_least_60_days(self):
        """For a brand-new key (no checkpoint), the very first window's
        startTime must reach back well beyond the previous 7-day cap.
        We pin 60 days as a conservative floor — the fix uses 365 days,
        but the contract this test enforces is 'not just last 7 days'."""
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={"result": {"list": [], "nextPageCursor": ""}},
        )

        before_call_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        await fetch_daily_pnl(mock_exchange, since_ms=None)

        # The earliest startTime across all calls must be >= 60 days back.
        sixty_days_ago_ms = before_call_ms - 60 * 24 * 60 * 60 * 1000
        all_start_times = [
            int(c.args[0]["startTime"])
            for c in mock_exchange.private_get_v5_position_closed_pnl.call_args_list
        ]
        earliest_start = min(all_start_times)
        assert earliest_start <= sixty_days_ago_ms, (
            f"Earliest startTime is {earliest_start}, expected <= {sixty_days_ago_ms}. "
            "For a fresh sync the lookback must extend at least 60 days back, "
            "otherwise long-history accounts hit GATE_INSUFFICIENT_DAYS unnecessarily."
        )

    @pytest.mark.asyncio
    async def test_followsNextPageCursor_within_window(self):
        """Within a 7-day window, the second call must include
        ``cursor`` from the first call's ``nextPageCursor``. Without
        this, only the first 200 records per window are pulled and a
        busy account's history is silently truncated."""
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"

        # First call returns a page with cursor; second returns empty
        # to terminate the inner loop and move to the next window.
        # We give just one item so the body parses cleanly.
        valid_item = {
            "symbol": "BTCUSDT",
            "cumEntryValue": "1000",
            "cumExitValue": "1010",
            "openFee": "0.5",
            "closeFee": "0.5",
            "side": "Sell",
            "createdTime": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
        }
        response_page_1 = {
            "result": {"list": [valid_item], "nextPageCursor": "cursor_abc"}
        }
        response_empty = {"result": {"list": [], "nextPageCursor": ""}}
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            side_effect=[response_page_1] + [response_empty] * 200,
        )

        await fetch_daily_pnl(mock_exchange, since_ms=None)

        # Find the call that came AFTER the cursor-bearing one — must
        # carry that cursor in its params.
        calls = mock_exchange.private_get_v5_position_closed_pnl.call_args_list
        assert len(calls) >= 2, (
            f"Only {len(calls)} call(s) made; pagination must issue at least a "
            "second call to consume the nextPageCursor"
        )
        # The call immediately after the cursor-bearing response must include cursor
        cursor_followed = any(
            call.args[0].get("cursor") == "cursor_abc" for call in calls[1:]
        )
        assert cursor_followed, (
            "No subsequent call carried cursor='cursor_abc'; nextPageCursor was "
            "not followed and the truncation bug persists at the page-level even "
            "after the startTime fix"
        )


# ---------------------------------------------------------------------------
# NEW-C13-01: OKX fillSz contract-to-base normalization
# NEW-C13-02: OKX instType fan-out (SWAP + FUTURES + SPOT + MARGIN)
# ---------------------------------------------------------------------------


class TestClusterIC1301OkxContractNormalization:
    """NEW-C13-01 — OKX SWAP/FUTURES fillSz is in CONTRACTS, not base units.
    Storing raw fillSz as quantity causes 100×–10000× position/PnL inflation.
    The fix multiplies fillSz × contractSize at ingest.
    """

    def test_okx_contract_size_lookup_known_symbol(self) -> None:
        """_okx_contract_size_for_inst_id returns the hardcoded ctVal for
        a known symbol (BTC-USDT-SWAP → 0.01 BTC per contract).
        """
        from services.exchange import _okx_contract_size_for_inst_id

        assert _okx_contract_size_for_inst_id("BTC-USDT-SWAP") == 0.01
        assert _okx_contract_size_for_inst_id("ETH-USDT-SWAP") == 0.1
        assert _okx_contract_size_for_inst_id("SOL-USDT-SWAP") == 1.0
        assert _okx_contract_size_for_inst_id("DOGE-USDT-SWAP") == 1000.0

    def test_okx_contract_size_futures_same_prefix(self) -> None:
        """FUTURES instIds share the BASE-QUOTE prefix lookup.
        BTC-USDT-231229 → 0.01 (same as BTC-USDT-SWAP).
        """
        from services.exchange import _okx_contract_size_for_inst_id

        assert _okx_contract_size_for_inst_id("BTC-USDT-231229") == 0.01

    def test_okx_contract_size_unknown_emits_dq_flag(self) -> None:
        """Unknown symbols fall through to 1.0 and stamp okx_unknown_ctval."""
        from services.exchange import _okx_contract_size_for_inst_id, get_and_clear_last_dq_flags

        get_and_clear_last_dq_flags()
        ct = _okx_contract_size_for_inst_id("UNKNOWN-COIN-SWAP")
        assert ct == 1.0
        flags = get_and_clear_last_dq_flags()
        assert flags.get("okx_unknown_ctval") is True

    @pytest.mark.asyncio
    async def test_okx_swap_fill_quantity_normalized_from_contracts(self) -> None:
        """SWAP fill: fillSz=10 contracts × BTC-USDT ctVal=0.01 → quantity=0.1.

        Pre-fix: quantity=10 (raw contract count, inflated by 100×).
        Post-fix: quantity=0.1 (normalized to base units).
        """
        from services.exchange import _fetch_raw_trades_okx

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "10",  # 10 contracts × 0.01 BTC/contract = 0.1 BTC
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
            }
        ])

        result = await _fetch_raw_trades_okx(mock_exchange, None)
        assert len(result) == 1
        assert Decimal(result[0]["quantity"]) == Decimal("0.1"), (
            f"Expected 10 contracts × 0.01 ctVal = 0.1 BTC, got {result[0]['quantity']}. "
            "NEW-C13-01: fillSz must be normalized from contracts to base units."
        )

    @pytest.mark.asyncio
    async def test_okx_futures_fill_quantity_normalized_from_contracts(self) -> None:
        """FUTURES fill uses the same ctVal lookup as SWAP."""
        from services.exchange import _fetch_raw_trades_okx_inst_type

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        async def _history(params: dict) -> dict:
            if params.get("instType") != "FUTURES":
                return {"data": []}
            return {"data": [
                {
                    "instId": "BTC-USDT-231229",
                    "side": "sell",
                    "fillPx": "65000",
                    "fillSz": "5",  # 5 contracts × 0.01 = 0.05 BTC
                    "fee": "0",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-fut",
                    "tradeId": "trade-fut",
                    "execType": "T",
                }
            ]}

        mock_exchange.private_get_trade_fills_history = _history
        fills, cap_hit = await _fetch_raw_trades_okx_inst_type(mock_exchange, None, "FUTURES")
        assert len(fills) == 1
        assert Decimal(fills[0]["quantity"]) == Decimal("0.05"), (
            f"Expected 5 contracts × 0.01 ctVal = 0.05 BTC, got {fills[0]['quantity']}. "
            "NEW-C13-01: FUTURES fills need same normalization as SWAP."
        )

    @pytest.mark.asyncio
    async def test_okx_spot_fill_quantity_not_normalized(self) -> None:
        """SPOT fills: fillSz is already in base units. Must NOT be multiplied
        by a ctVal.
        """
        from services.exchange import _fetch_raw_trades_okx_inst_type

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        async def _history(params: dict) -> dict:
            if params.get("instType") != "SPOT":
                return {"data": []}
            return {"data": [
                {
                    "instId": "BTC-USDT",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.5",  # 0.5 BTC — base units already
                    "fee": "0",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-spot",
                    "tradeId": "trade-spot",
                    "execType": "T",
                }
            ]}

        mock_exchange.private_get_trade_fills_history = _history
        fills, _ = await _fetch_raw_trades_okx_inst_type(mock_exchange, None, "SPOT")
        assert len(fills) == 1
        # SPOT: no normalization → quantity == fillSz exactly.
        assert Decimal(fills[0]["quantity"]) == Decimal("0.5"), (
            f"SPOT fill must not be contract-normalized. Got {fills[0]['quantity']}."
        )

    @pytest.mark.asyncio
    async def test_okx_ingest_ctval_metadata_stamped_on_linear_fills(self) -> None:
        """When ctVal normalization is applied, _ingest_ctval is stamped
        into the raw fill dict so downstream audit can verify normalization.
        """
        from services.exchange import _fetch_raw_trades_okx

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _okx_swap_only([
            {
                "instId": "ETH-USDT-SWAP",
                "side": "buy",
                "fillPx": "3000",
                "fillSz": "2",  # 2 contracts × 0.1 ETH = 0.2 ETH
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": "ord-1",
                "tradeId": "trade-1",
                "execType": "T",
            }
        ])

        result = await _fetch_raw_trades_okx(mock_exchange, None)
        assert len(result) == 1
        raw_data = result[0].get("raw_data") or {}
        assert raw_data.get("_ingest_ctval") == pytest.approx(0.1), (
            "Linear fills must stamp _ingest_ctval=0.1 for ETH-USDT-SWAP"
        )


class TestClusterIC1302OkxInstTypeFanOut:
    """NEW-C13-02 — _fetch_raw_trades_okx must fan out across SWAP, FUTURES,
    SPOT, and MARGIN instTypes. Pre-fix only SWAP was fetched; any OKX
    strategy with SPOT or FUTURES activity was silently truncated.
    """

    @pytest.mark.asyncio
    async def test_fills_from_all_inst_types_are_aggregated(self) -> None:
        """When each instType returns 1 fill, the aggregator returns 4 fills total."""
        from services.exchange import _fetch_raw_trades_okx, _OKX_FILL_INST_TYPES

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        async def _history(params: dict) -> dict:
            inst_type = params.get("instType", "")
            return {"data": [
                {
                    "instId": f"BTC-USDT-{inst_type}",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.001",  # 0.001 BTC-equivalent
                    "fee": "0",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": f"ord-{inst_type}",
                    "tradeId": f"trade-{inst_type}",
                    "execType": "T",
                }
            ]}

        mock_exchange.private_get_trade_fills_history = _history

        result = await _fetch_raw_trades_okx(mock_exchange, None)
        # All 4 instTypes should contribute 1 fill each.
        assert len(result) == len(_OKX_FILL_INST_TYPES), (
            f"Expected {len(_OKX_FILL_INST_TYPES)} fills (one per instType), "
            f"got {len(result)}. NEW-C13-02: fan-out must cover all instTypes."
        )

    @pytest.mark.asyncio
    async def test_all_four_inst_types_queried(self) -> None:
        """_fetch_raw_trades_okx must send at least one request per instType
        in _OKX_FILL_INST_TYPES. Pre-fix only SWAP was requested.
        """
        from services.exchange import _fetch_raw_trades_okx, _OKX_FILL_INST_TYPES

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        queried_types: list[str] = []

        async def _history(params: dict) -> dict:
            queried_types.append(params.get("instType", ""))
            return {"data": []}

        mock_exchange.private_get_trade_fills_history = _history

        await _fetch_raw_trades_okx(mock_exchange, None)

        for inst_type in _OKX_FILL_INST_TYPES:
            assert inst_type in queried_types, (
                f"instType={inst_type!r} was not queried. "
                "NEW-C13-02: _fetch_raw_trades_okx must fan out across all instTypes."
            )

    @pytest.mark.asyncio
    async def test_inst_type_cap_hit_aggregates_dq_flags(self) -> None:
        """When SWAP hits the page cap (100 pages), sync_truncated_okx must
        be flagged and sync_truncated_okx_pages must reflect 100 (one instType).
        Other instTypes return empty, so total pages = 100.
        """
        from services.exchange import _fetch_raw_trades_okx, get_and_clear_last_dq_flags

        get_and_clear_last_dq_flags()
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        call_n: dict[str, int] = {}

        def _fill(idx: int, inst_type: str) -> dict:
            return {
                "instId": f"BTC-USDT-{inst_type}",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.001",
                "fee": "0",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": f"ord-{inst_type}-{idx}",
                "tradeId": f"trade-{inst_type}-{call_n.get(inst_type, 0)}-{idx}",
                "execType": "T",
            }

        async def _history(params: dict) -> dict:
            inst_type = params.get("instType", "")
            call_n[inst_type] = call_n.get(inst_type, 0) + 1
            if inst_type == "SWAP":
                # Always return a full page → never breaks → hits page cap.
                return {"data": [_fill(i, inst_type) for i in range(100)]}
            return {"data": []}

        mock_exchange.private_get_trade_fills_history = _history
        result = await _fetch_raw_trades_okx(mock_exchange, None)

        # SWAP contributes 100 pages × 100 fills = 10_000; others empty.
        assert len(result) == 100 * 100
        flags = get_and_clear_last_dq_flags()
        assert flags.get("sync_truncated_okx") is True
        assert flags.get("sync_truncated_okx_pages") == 100, (
            f"Expected 100 pages (SWAP only hit cap), got "
            f"{flags.get('sync_truncated_okx_pages')}"
        )


class TestClusterIC1301BybitCategoryGuard:
    """NEW-C13-01 (Bybit half) — the Bybit ingest path supports ONLY
    ``category="linear"`` because that's the only branch where
    ``execQty`` arrives in base units. ``category="inverse"`` reports
    ``execQty`` in USD (contracts) and would require a contractSize
    rescale before persisting — the OKX-style position-size inflation
    bug NEW-C13-01 closed for OKX. A future caller adding inverse must
    update ``_BYBIT_FILL_CATEGORIES`` AND wire the rescale; the guard
    fails loud so that combination cannot land by accident.
    """

    @pytest.mark.asyncio
    async def test_default_category_linear_passes(self) -> None:
        # Sanity: the production caller (which omits the category kwarg
        # and gets the linear default) must still work.
        from services.exchange import (
            _fetch_raw_trades_bybit,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value={"result": {"list": [], "nextPageCursor": ""}}
        )
        result = await _fetch_raw_trades_bybit(mock_exchange, None)
        assert result == []
        flags = get_and_clear_last_dq_flags()
        # No category guard should have fired for the linear default.
        assert flags.get("bybit_unsupported_category") is None

    @pytest.mark.asyncio
    async def test_inverse_category_rejected_with_dq_flag(self) -> None:
        from services.exchange import (
            _fetch_raw_trades_bybit,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # Should never be called — the guard rejects before the round trip.
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value={"result": {"list": [], "nextPageCursor": ""}}
        )
        with pytest.raises(ValueError) as exc_info:
            await _fetch_raw_trades_bybit(mock_exchange, None, category="inverse")
        assert "category='inverse'" in str(exc_info.value)
        # Round trip never happened — guard fired first.
        mock_exchange.private_get_v5_execution_list.assert_not_called()
        flags = get_and_clear_last_dq_flags()
        assert flags.get("bybit_unsupported_category") is True

    @pytest.mark.asyncio
    async def test_spot_category_rejected_with_dq_flag(self) -> None:
        # Bybit spot fills currently route through the CCXT generic
        # `_normalize_fill` path, not this function. A future caller
        # passing category="spot" here would silently double-ingest spot
        # via two paths with different normalization — reject explicitly.
        from services.exchange import (
            _fetch_raw_trades_bybit,
            get_and_clear_last_dq_flags,
        )
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value={"result": {"list": [], "nextPageCursor": ""}}
        )
        with pytest.raises(ValueError):
            await _fetch_raw_trades_bybit(mock_exchange, None, category="spot")
        flags = get_and_clear_last_dq_flags()
        assert flags.get("bybit_unsupported_category") is True


# ===========================================================================
# Phase 77-02 / SC-1 — venue-gated companion open-uPnL reads (FLOW-04).
#
# OKX `upl` rides the SAME private_get_account_balance response as `totalEq`
# (no new HTTP round-trip). Bybit/Binance anchor on realized-basis
# walletBalance, so their wedge is STRUCTURALLY 0.0 — subtracting a non-zero
# wedge there is the Pitfall-2 double-count.
# ===========================================================================


@pytest.mark.asyncio
async def test_okx_upl_single_call_companion() -> None:
    """OKX companion returns (equity, balance_error, upl) from a SINGLE
    private_get_account_balance call — the upl is the sibling wedge in the
    SAME response as totalEq. Awaited-exactly-once proves no new fetch."""
    from services.exchange import fetch_account_equity_and_upnl_usd

    mock_exchange = AsyncMock()
    mock_exchange.private_get_account_balance = AsyncMock(
        return_value={"data": [{"totalEq": "100000", "upl": "8000"}]}
    )
    eq, balance_error, upl, unreadable = await fetch_account_equity_and_upnl_usd(
        mock_exchange, "okx"
    )
    assert eq == pytest.approx(100000.0)
    assert balance_error is False
    assert upl == pytest.approx(8000.0)
    # A present, numeric upl is readable (MUST-2): no unreadable flag.
    assert unreadable is False
    # No new fetch: upl rides the totalEq response object.
    assert mock_exchange.private_get_account_balance.await_count == 1


@pytest.mark.asyncio
async def test_okx_upl_negative_sign_preserved() -> None:
    """A negative `upl` (net open loss) is trusted verbatim — the wedge sign
    is preserved, not abs()'d."""
    from services.exchange import fetch_account_equity_and_upnl_usd

    mock_exchange = AsyncMock()
    mock_exchange.private_get_account_balance = AsyncMock(
        return_value={"data": [{"totalEq": "100000", "upl": "-4000"}]}
    )
    _eq, _err, upl, _unreadable = await fetch_account_equity_and_upnl_usd(
        mock_exchange, "okx"
    )
    assert upl == pytest.approx(-4000.0)


@pytest.mark.asyncio
async def test_okx_missing_upl_wedge_zero_but_flagged_unreadable() -> None:
    """totalEq present but no `upl` key (or null) → wedge 0.0 (never
    fabricated) AND ``unreadable`` True (MUST-2): a garbled/absent wedge on a
    readable anchor is an inconsistent response the caller must surface, NOT a
    clean zero. Mutation-honest: reverting _okx_upl_or_zero to return a bare
    float turns the ``unreadable is True`` assertions RED."""
    from services.exchange import fetch_account_equity_and_upnl_usd

    ex_absent = AsyncMock()
    ex_absent.private_get_account_balance = AsyncMock(
        return_value={"data": [{"totalEq": "100000"}]}
    )
    eq, err, upl, unreadable = await fetch_account_equity_and_upnl_usd(
        ex_absent, "okx"
    )
    assert eq == pytest.approx(100000.0)
    assert err is False
    assert upl == 0.0
    assert unreadable is True, "absent upl on a readable anchor must flag unreadable"

    ex_null = AsyncMock()
    ex_null.private_get_account_balance = AsyncMock(
        return_value={"data": [{"totalEq": "100000", "upl": None}]}
    )
    _eq, _err, upl_null, unreadable_null = await fetch_account_equity_and_upnl_usd(
        ex_null, "okx"
    )
    assert upl_null == 0.0
    assert unreadable_null is True, "null upl on a readable anchor must flag unreadable"

    # A PRESENT numeric 0.0 upl is a genuinely flat book — readable, NOT flagged.
    ex_flat = AsyncMock()
    ex_flat.private_get_account_balance = AsyncMock(
        return_value={"data": [{"totalEq": "100000", "upl": "0"}]}
    )
    _eqf, _errf, upl_flat, unreadable_flat = await fetch_account_equity_and_upnl_usd(
        ex_flat, "okx"
    )
    assert upl_flat == 0.0
    assert unreadable_flat is False, "present-0 upl is a clean flat book, not unreadable"


@pytest.mark.asyncio
async def test_bybit_binance_wedge_zero() -> None:
    """Bybit/Binance anchor on realized-basis walletBalance → wedge is
    STRUCTURALLY 0.0 regardless of balance (Q2 / Pitfall-2 double-count
    guard). The dispatch never reads a upl field for these venues."""
    from services.exchange import fetch_account_equity_and_upnl_usd

    for venue in ("bybit", "binance"):
        with patch(
            "services.exchange.fetch_usdt_balance_with_status",
            new=AsyncMock(return_value=(123456.0, False)),
        ):
            eq, err, upl, unreadable = await fetch_account_equity_and_upnl_usd(
                AsyncMock(), venue
            )
        assert eq == pytest.approx(123456.0)
        assert err is False
        assert upl == 0.0, f"{venue} wedge must be structurally 0.0"
        # Realized-basis venues have NO wedge field to read → never unreadable.
        assert unreadable is False, f"{venue} has no wedge field, not unreadable"


@pytest.mark.asyncio
async def test_okx_balance_error_wedge_zero() -> None:
    """A failed/empty OKX response → (None, True, 0.0): no equity, balance
    error, and the wedge forced to 0.0 (no equity → no trustworthy wedge)."""
    from services.exchange import fetch_account_equity_and_upnl_usd

    ex_boom = AsyncMock()
    ex_boom.private_get_account_balance = AsyncMock(
        side_effect=RuntimeError("boom")
    )
    eq, err, upl, unreadable = await fetch_account_equity_and_upnl_usd(
        ex_boom, "okx"
    )
    assert eq is None
    assert err is True
    assert upl == 0.0
    # A failed read has no trustworthy anchor → unreadable is moot/False (the
    # balance_error is the flagged problem, not the wedge).
    assert unreadable is False

    ex_empty = AsyncMock()
    ex_empty.private_get_account_balance = AsyncMock(return_value={"data": []})
    eq2, err2, upl2, unreadable2 = await fetch_account_equity_and_upnl_usd(
        ex_empty, "okx"
    )
    assert eq2 is None
    assert err2 is True
    assert upl2 == 0.0
    assert unreadable2 is False
