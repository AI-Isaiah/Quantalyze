"""Tests for analytics-service/services/allocator_positions.py (Phase 06, Plan 02).

Covers INGEST-03 (worker contract), INGEST-04 (idempotent upsert), and
INGEST-05 (error UX surfacing). Nine required tests per the plan:

  1. test_fetch_allocator_holdings_returns_both_types
  2. test_idempotent_upsert
  3. test_error_status_mapping                       (INGEST-05 core)
  4. test_stablecoin_mark_price_is_one               (D-16 / RESEARCH §1)
  5. test_partial_success_emits_warnings             (complete_with_warnings — Q2)
  6. test_raw_payload_cap_4kb                        (D-02 size cap)
  7. test_deribit_balance_per_currency_shape         (f3 Path B deferral)
  8. test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done (f7)
  9. test_run_poll_allocator_positions_job_auth_error_sets_revoked

Tests mock the CCXT exchange at the instance level and the Supabase
client via MagicMock — no network, no database. The handler-level
tests (8, 9) patch `services.job_worker` entry points directly so we
exercise the full preflight → fetch → persist → audit path without
needing a real KEK or live api_keys row.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt.async_support as ccxt
import pytest

from services.allocator_positions import (  # noqa: E402
    _map_exception_to_sync_status,
    fetch_allocator_holdings,
    persist_allocator_holdings,
)


ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000aa"
API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TODAY = "2026-04-19"


# ---------------------------------------------------------------------------
# Test 1 — both spot and derivative rows returned in one list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_allocator_holdings_returns_both_types(monkeypatch):
    """D-01: each sync emits BOTH spot (from fetch_balance) AND derivative
    (from fetch_positions) rows in a single flat list. Stablecoin (USDT)
    must be priced 1.0 WITHOUT a fetch_tickers call for that symbol."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"BTC": 0.5, "ETH": 2.0, "USDT": 1000.0},
    })
    # fetch_tickers called once with the non-stablecoin symbol list
    mock_exchange.fetch_tickers = AsyncMock(return_value={
        "BTC/USDT": {"last": 50000.0},
        "ETH/USDT": {"last": 3000.0},
    })

    # Patch fetch_positions at the allocator_positions module scope (not
    # at services.positions) because allocator_positions imports it once
    # at module load — monkeypatching the original binding doesn't catch
    # the re-exported reference.
    from services import allocator_positions as ap

    async def _fake_fetch_positions(exchange_name, exchange):
        return [
            {
                "symbol": "BTCUSDT",
                "side": "long",
                "size_base": 0.1,
                "size_usd": 6000.0,
                "entry_price": 59000.0,
                "mark_price": 61000.0,
                "unrealized_pnl": 200.0,
                "exchange": "binance",
            },
        ]

    monkeypatch.setattr(ap, "fetch_positions", _fake_fetch_positions)

    rows, warning = await fetch_allocator_holdings("binance", mock_exchange)

    assert warning is None
    spot = [r for r in rows if r["holding_type"] == "spot"]
    deriv = [r for r in rows if r["holding_type"] == "derivative"]
    assert len(spot) >= 2, f"expected >=2 spot rows, got {spot}"
    assert len(deriv) >= 1, f"expected >=1 derivative row, got {deriv}"

    # USDT row must have mark_price=1.0 — asserted independently of ticker map
    usdt_row = next((r for r in spot if r["symbol"] == "USDT"), None)
    assert usdt_row is not None, "expected a USDT spot row"
    assert usdt_row["mark_price"] == 1.0
    # fetch_tickers was called exactly once (bulk) and the USDT/USDT
    # pair is NOT in the requested symbol list (stablecoin skip).
    assert mock_exchange.fetch_tickers.await_count == 1
    call = mock_exchange.fetch_tickers.await_args
    requested = call.args[0] if call.args else []
    assert "USDT/USDT" not in requested, requested

    # Derivative row shape: D-06 — cost_basis_usd = entry_price * abs(qty)
    d = deriv[0]
    assert d["symbol"] == "BTCUSDT"
    assert d["cost_basis_usd"] == pytest.approx(59000.0 * 0.1)
    assert d["entry_price"] == 59000.0


# ---------------------------------------------------------------------------
# Test 2 — idempotent upsert using the INGEST-04 conflict key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idempotent_upsert(api_key_row_factory):
    """INGEST-04 / SC5: re-running persist with identical rows must use
    `on_conflict="allocator_id,venue,symbol,asof"` and produce the same
    row count. Idempotency is enforced by the DB constraint; the test
    asserts the client call shape."""
    rows = [
        {
            "venue": "binance",
            "symbol": "BTC",
            "holding_type": "spot",
            "side": "flat",
            "quantity": 0.5,
            "value_usd": 30000.0,
            "entry_price": None,
            "mark_price": 60000.0,
            "unrealized_pnl_usd": None,
            "cost_basis_usd": None,
            "raw_payload": {"asset": "BTC", "total": 0.5, "mark_price": 60000.0},
        },
        {
            "venue": "binance",
            "symbol": "BTCUSDT",
            "holding_type": "derivative",
            "side": "long",
            "quantity": 0.1,
            "value_usd": 6000.0,
            "entry_price": 59000.0,
            "mark_price": 61000.0,
            "unrealized_pnl_usd": 200.0,
            "cost_basis_usd": 5900.0,
            "raw_payload": {"symbol": "BTCUSDT"},
        },
    ]

    mock_supabase = MagicMock()
    mock_table = MagicMock()
    mock_upsert = MagicMock()
    mock_upsert.execute.return_value = MagicMock(data=rows)
    mock_table.upsert.return_value = mock_upsert
    mock_supabase.table.return_value = mock_table

    count_1 = await persist_allocator_holdings(
        mock_supabase, rows, ALLOCATOR_ID, API_KEY_ID, TODAY
    )
    count_2 = await persist_allocator_holdings(
        mock_supabase, rows, ALLOCATOR_ID, API_KEY_ID, TODAY
    )

    assert count_1 == 2
    assert count_2 == 2  # same shape, same count

    # The client must use the allocator-holdings table
    mock_supabase.table.assert_called_with("allocator_holdings")
    # The conflict target must be exactly the 4-tuple INGEST-04 spec
    assert mock_table.upsert.call_count == 2
    for call in mock_table.upsert.call_args_list:
        kwargs = call.kwargs
        assert kwargs.get("on_conflict") == "allocator_id,venue,symbol,asof"

    # allocator_id / api_key_id / asof are stamped on every row
    first_payload = mock_table.upsert.call_args_list[0].args[0]
    for r in first_payload:
        assert r["allocator_id"] == ALLOCATOR_ID
        assert r["api_key_id"] == API_KEY_ID
        assert r["asof"] == TODAY


# ---------------------------------------------------------------------------
# Test 3 — exception → sync_status mapping (INGEST-05)
# ---------------------------------------------------------------------------


def test_error_status_mapping():
    """INGEST-05 / D-07: CCXT exceptions map to api_keys.sync_status values."""
    cases: list[tuple[Exception, str]] = [
        (ccxt.AuthenticationError("401"), "revoked"),
        (ccxt.PermissionDenied("403"), "revoked"),
        (ccxt.RateLimitExceeded("429"), "rate_limited"),
        (ccxt.NetworkError("timeout"), "error"),
        (ccxt.ExchangeNotAvailable("down"), "error"),
        (Exception("boom"), "error"),
    ]
    for exc, expected in cases:
        got = _map_exception_to_sync_status(exc)
        assert got == expected, f"{type(exc).__name__} → got {got!r}, expected {expected!r}"


# ---------------------------------------------------------------------------
# Test 4 — stablecoin skip (no ticker call, mark_price=1.0)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stablecoin_mark_price_is_one(monkeypatch):
    """If the balance is entirely stablecoins, we emit rows with
    mark_price=1.0 without ever calling fetch_tickers (RESEARCH §1 — lower
    API cost, no rate-limit bleed)."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 500.0, "USDC": 250.0, "DAI": 100.0},
    })

    # If this is called, the test fails.
    def _fail(*_a, **_kw):
        raise AssertionError("fetch_tickers should NOT be called for stablecoin-only balance")

    mock_exchange.fetch_tickers = AsyncMock(side_effect=_fail)
    mock_exchange.fetch_ticker = AsyncMock(side_effect=_fail)

    # Patch fetch_positions to return empty so we only exercise the spot path
    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, _warning = await fetch_allocator_holdings("binance", mock_exchange)
    stable_rows = {r["symbol"] for r in rows if r["holding_type"] == "spot"}
    assert stable_rows == {"USDT", "USDC", "DAI"}
    for r in rows:
        if r["holding_type"] == "spot":
            assert r["mark_price"] == 1.0, r

    mock_exchange.fetch_tickers.assert_not_called()
    mock_exchange.fetch_ticker.assert_not_called()


# ---------------------------------------------------------------------------
# Test 5 — partial success (spot OK, positions down) emits warning
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_partial_success_emits_warnings(monkeypatch):
    """RESEARCH Q2: if fetch_balance succeeds and fetch_positions raises
    a non-auth non-429 exception, we persist spot and return a warning
    string. The handler surfaces this as sync_status='complete_with_warnings'.

    151 review CR-03 — the ORACLE MOVED. This test used to assert the venue's
    exception text ("down") appeared in the warning, i.e. it PINNED the leak:
    `warning` is written to `api_keys.sync_error`, which AllocatorSyncStatus
    renders VERBATIM, so echoing `str(exc)` put raw Python in front of an
    allocator (the PROD "'Mt5Session' object has no attribute 'fetch_balance'"
    class). The partial-success CONTRACT — spot persists, derivatives don't, a
    warning is raised — is unchanged and still asserted below; only the string's
    audience changed."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 500.0},
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={})

    from services import allocator_positions as ap

    async def _down(*_a, **_kw):
        raise ccxt.ExchangeNotAvailable("down")

    monkeypatch.setattr(ap, "fetch_positions", _down)

    rows, warning = await fetch_allocator_holdings("binance", mock_exchange)
    assert warning is not None
    # END-USER copy, not the exception: names the venue in product casing, says
    # what happened and what happens next, and carries none of the venue's own
    # error text.
    assert warning == (
        "Couldn't read open positions from Binance — spot balances synced and "
        "positions will retry automatically."
    )
    assert "down" not in warning
    # Spot row persisted even though derivative side failed
    assert any(r["holding_type"] == "spot" and r["symbol"] == "USDT" for r in rows)
    # Zero derivative rows (the fetch raised)
    assert all(r["holding_type"] != "derivative" for r in rows)


# ---------------------------------------------------------------------------
# Test 5b — 151 review E1: the ccxt SPOT arm cannot leak raw Python either
#
# WHY (Rule 9 — intent): `warning` and `AllocatorHoldingsSyncTransientError`'s
# message BOTH land in `api_keys.sync_error`, which `AllocatorSyncStatus`
# renders VERBATIM — there is no frontend translation layer. The derivative arm
# was hardened for that (test 5 above); the spot arm was not, so a malformed
# venue payload (`KeyError('total')`, a `TypeError` in the ticker merge) reached
# the handler's generic `except Exception`, whose `classify_exception`
# fall-through stamps `str(exc)[:500]`. That is the PROD defect class —
# "'Mt5Session' object has no attribute 'fetch_balance'" shown to a user — and
# it was still live for binance/bybit/okx/deribit.
#
# The oracle is the PROPERTY, not the sentence: the exception's own text must
# not appear in what the user is shown, and the two ccxt families the HANDLER
# classifies deliberately (auth → 'revoked', 429 → its own `_stamp_429` arm)
# must still arrive at the handler as themselves.
# ---------------------------------------------------------------------------


def _spot_only_exchange(raiser):
    """A ccxt-shaped mock whose fetch_balance raises `raiser()`."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(side_effect=raiser)
    mock_exchange.fetch_tickers = AsyncMock(return_value={})
    return mock_exchange


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        KeyError("total"),
        TypeError("'NoneType' object is not subscriptable"),
        ccxt.ExchangeNotAvailable("binance GET /api/v3/account 503 <html>maintenance</html>"),
        AttributeError("'Mt5Session' object has no attribute 'fetch_balance'"),
    ],
    ids=["keyerror", "typeerror", "ccxt-exchange-error", "attributeerror"],
)
async def test_spot_fetch_failure_surfaces_end_user_copy_not_python(monkeypatch, exc):
    """A malformed/unavailable venue payload on the SPOT read reaches the caller
    as fixed end-user copy — never the exception's own text."""
    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    def _raise(*_a, **_kw):
        raise exc

    with pytest.raises(ap.AllocatorHoldingsSyncTransientError) as caught:
        await fetch_allocator_holdings("binance", _spot_only_exchange(_raise))

    shown = str(caught.value)
    assert shown == (
        "Couldn't read balances from Binance — sync will retry automatically."
    )
    # The PROPERTY: none of the exception's own text survives into user copy.
    for token in ("total", "NoneType", "maintenance", "Mt5Session", "attribute"):
        if token in str(exc):
            assert token not in shown, f"raw exception text {token!r} leaked into {shown!r}"
    # The diagnosis is not lost — it survives in the exception chain for Sentry.
    assert caught.value.__cause__ is exc


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc_factory",
    [
        lambda: ccxt.AuthenticationError("401 invalid api key"),
        lambda: ccxt.PermissionDenied("403 forbidden"),
        lambda: ccxt.RateLimitExceeded("429 too many requests"),
    ],
    ids=["auth", "permission", "ratelimit"],
)
async def test_spot_fetch_reraises_the_handler_classified_ccxt_types(
    monkeypatch, exc_factory
):
    """The three types the HANDLER has dedicated arms for must still arrive as
    themselves: swallowing them into the transient copy would turn a revoked key
    into an endlessly retrying 'error' and would skip `_stamp_429` entirely."""
    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)
    expected = exc_factory()

    def _raise(*_a, **_kw):
        raise expected

    with pytest.raises(type(expected)):
        await fetch_allocator_holdings("binance", _spot_only_exchange(_raise))


# ---------------------------------------------------------------------------
# Test 5c (review [2] H1) — the wrapper must not DOWNGRADE a permanent failure
#
# WHY (Rule 9 — intent): the wrapper added in 5b re-raised a hand-written list
# of three ccxt types, copied from `_map_exception_to_sync_status`. That is a
# DIFFERENT classifier from the one that decides retry disposition
# (`job_worker.classify_exception`), and it misses two permanent families:
#
#   * an egress GEO-BLOCK — Binance's regional refusal arrives as
#     `ccxt.ExchangeNotAvailable`, and `is_geo_blocked` intercepts it BEFORE
#     the ccxt hierarchy precisely because no ccxt type identifies it;
#   * `ccxt.BadRequest`.
#
# Downgraded to transient, each buys the full 30s→6h retry ladder plus the
# daily cron re-enqueue against a host that will never answer from this region,
# and the operator-actionable sync_error ("move region or proxy") is replaced
# by "sync will retry automatically" — a promise that cannot be kept. The
# handler's transient arm hardcodes error_kind='transient' and never walks the
# `raise ... from exc` chain, so the downgrade is FINAL.
#
# The oracle is the EQUIVALENCE, not a list: whatever `classify_exception`
# calls permanent must arrive at the handler unwrapped; everything else must
# arrive as fixed copy. Stated that way the test cannot go stale when the
# classifier grows a family — see test 5d for the coupling itself.
# ---------------------------------------------------------------------------

# str() bodies are the real ccxt shapes — `is_geo_blocked` is SIGNATURE-based,
# so a synthetic message would test nothing.
_BINANCE_451 = (
    "binance GET https://api.binance.com/api/v3/account 451 "
    '{"code":0,"msg":"Service unavailable from a restricted location according '
    'to b. Eligibility in https://www.binance.com/en/terms"}'
)
_BYBIT_CLOUDFRONT_403 = (
    "bybit GET https://api.bybit.com/v5/account/wallet-balance 403 "
    "<HTML><HEAD>The Amazon CloudFront distribution is configured to block "
    "access from your country.</HEAD></HTML>"
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc_factory",
    [
        pytest.param(
            lambda: ccxt.ExchangeNotAvailable(_BINANCE_451), id="geo-block-binance-451"
        ),
        pytest.param(
            lambda: ccxt.RateLimitExceeded(_BYBIT_CLOUDFRONT_403),
            id="geo-block-bybit-cloudfront",
        ),
        pytest.param(
            lambda: ccxt.BadRequest('binance {"code":-1121,"msg":"Invalid symbol."}'),
            id="ccxt-badrequest",
        ),
        pytest.param(
            lambda: ccxt.AuthenticationError("401 invalid api key"), id="auth"
        ),
        pytest.param(lambda: ccxt.PermissionDenied("403 forbidden"), id="permission"),
        pytest.param(
            lambda: ccxt.RateLimitExceeded("429 too many requests"), id="ratelimit"
        ),
        pytest.param(
            lambda: ccxt.ExchangeNotAvailable("binance 503 <html>maintenance</html>"),
            id="retryable-maintenance",
        ),
        pytest.param(lambda: ccxt.NetworkError("connection reset"), id="retryable-net"),
        pytest.param(lambda: KeyError("total"), id="retryable-malformed-payload"),
        pytest.param(
            lambda: AttributeError("'Mt5Session' object has no attribute 'fetch_balance'"),
            id="retryable-attributeerror",
        ),
    ],
)
@pytest.mark.parametrize("arm", ["spot", "derivative"])
async def test_permanent_failures_reach_the_handler_unwrapped(
    monkeypatch, exc_factory, arm
):
    """EQUIVALENCE ORACLE: wrap ⇔ the classifier would retry it.

    Both fetch arms are held to it. The derivative arm's partial-success posture
    (persist spot, warn, complete) is for RETRYABLE failures — it already
    re-raised two permanent families (auth / permission) and discarded the spot
    rows to do it, so a permanent failure was never "partial success" there
    either; it just had the same incomplete list. A DONE job carrying "positions
    will retry automatically" is the same broken promise as the retry ladder.
    """
    from services import allocator_positions as ap
    from services.job_worker import classify_exception

    expected = exc_factory()
    kind, _ = classify_exception(expected)
    must_be_unwrapped = kind == "permanent" or isinstance(
        expected, ccxt.RateLimitExceeded
    )

    def _raise(*_a, **_kw):
        raise expected

    async def _araise(*_a, **_kw):
        raise expected

    async def _no_positions(*_a, **_kw):
        return []

    if arm == "spot":
        exchange = _spot_only_exchange(_raise)
        monkeypatch.setattr(ap, "fetch_positions", _no_positions)
    else:
        exchange = AsyncMock()
        exchange.id = "binance"
        exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 500.0}})
        exchange.fetch_tickers = AsyncMock(return_value={})
        monkeypatch.setattr(ap, "fetch_positions", _araise)

    if must_be_unwrapped:
        with pytest.raises(Exception) as caught:  # noqa: PT011 - identity asserted
            await fetch_allocator_holdings("binance", exchange)
        assert caught.value is expected, (
            f"{kind!r} failure was swallowed into "
            f"{type(caught.value).__name__} — the handler can no longer "
            "classify it, and a permanent failure becomes an unbounded retry"
        )
        return

    if arm == "spot":
        with pytest.raises(ap.AllocatorHoldingsSyncTransientError) as wrapped:
            await fetch_allocator_holdings("binance", exchange)
        assert str(wrapped.value) == (
            "Couldn't read balances from Binance — sync will retry automatically."
        )
        assert wrapped.value.__cause__ is expected
    else:
        rows, warning = await fetch_allocator_holdings("binance", exchange)
        assert warning == (
            "Couldn't read open positions from Binance — spot balances synced "
            "and positions will retry automatically."
        )
        assert any(r["holding_type"] == "spot" for r in rows)


# ---------------------------------------------------------------------------
# Test 5d (review [2] H1) — the COUPLING, so the allow-list cannot drift again
#
# Test 5c pins today's families. This one pins the mechanism: the disposition
# is read from `job_worker.classify_exception` AT CALL TIME, so a family added
# to the classifier tomorrow is honoured here with no edit. Re-freeze the
# decision into a local isinstance list and this goes RED — which is the only
# thing that stops the exact regression under repair from recurring.
# ---------------------------------------------------------------------------


class _NovelPermanentError(Exception):
    """A family the classifier does not know today (stands in for tomorrow's)."""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "verdict, unwrapped",
    [("permanent", True), ("transient", False), ("unknown", False)],
)
async def test_reraise_decision_follows_the_live_classifier(
    monkeypatch, verdict, unwrapped
):
    """The classifier is CONSULTED, not mirrored."""
    from services import allocator_positions as ap
    import services.job_worker as jw

    novel = _NovelPermanentError("a family invented after this module was written")

    def _fake_classify(exc):
        assert exc is novel
        return (verdict, "sanitized")

    monkeypatch.setattr(jw, "classify_exception", _fake_classify)

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    def _raise(*_a, **_kw):
        raise novel

    exchange = _spot_only_exchange(_raise)

    if unwrapped:
        with pytest.raises(_NovelPermanentError) as caught:
            await fetch_allocator_holdings("binance", exchange)
        assert caught.value is novel
    else:
        with pytest.raises(ap.AllocatorHoldingsSyncTransientError):
            await fetch_allocator_holdings("binance", exchange)


@pytest.mark.asyncio
async def test_unclassifiable_exception_still_becomes_end_user_copy(monkeypatch):
    """The wrapper's ORIGINAL reason survives the new predicate.

    Consulting the classifier put a second thing that can fail inside the
    except block — `is_geo_blocked` flattens `str(exc)`, so an exception with a
    raising `__str__` blows up INSIDE the classification. If that escaped, the
    handler's generic arm would stamp whatever came out into a column the
    browser renders verbatim: the AUM-02 defect, reintroduced through the fix
    for it. No classification ⇒ fixed copy, always.
    """
    from services import allocator_positions as ap

    class _RogueStr(Exception):
        def __str__(self) -> str:
            raise RuntimeError("__str__ is hostile")

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    def _raise(*_a, **_kw):
        raise _RogueStr()

    with pytest.raises(ap.AllocatorHoldingsSyncTransientError) as caught:
        await fetch_allocator_holdings("binance", _spot_only_exchange(_raise))

    assert str(caught.value) == (
        "Couldn't read balances from Binance — sync will retry automatically."
    )


# ---------------------------------------------------------------------------
# Test 6 — raw_payload cap at ~4KB
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raw_payload_cap_4kb(monkeypatch):
    """D-02: raw_payload is a JSONB-compatible dict capped at ~4KB. Feed
    a balance whose per-asset payload would exceed 4KB and assert every
    emitted row's raw_payload serializes to ≤4096 bytes."""
    # Construct a balance whose 'info' would be huge — but _fetch_spot_rows
    # caps its own payload. We just need at least one row and ensure its
    # raw_payload doesn't exceed the cap. A derivative row with a huge
    # position dict is the simplest way to exercise the branch too.
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"BTC": 0.5},
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={
        "BTC/USDT": {"last": 50000.0},
    })

    from services import allocator_positions as ap

    # A huge derivative snapshot — simulate 10KB of extra ccxt metadata
    huge_extra = "x" * 10_000

    async def _huge_positions(*_a, **_kw):
        return [{
            "symbol": "BTCUSDT",
            "side": "long",
            "size_base": 0.1,
            "size_usd": 6000.0,
            "entry_price": 59000.0,
            "mark_price": 61000.0,
            "unrealized_pnl": 200.0,
            "exchange": "binance",
            "ccxt_raw_info_blob": huge_extra,
        }]

    monkeypatch.setattr(ap, "fetch_positions", _huge_positions)

    rows, _warning = await fetch_allocator_holdings("binance", mock_exchange)
    for r in rows:
        assert len(json.dumps(r["raw_payload"], default=str)) <= 4096, (
            f"row {r['symbol']} raw_payload over 4KB cap"
        )


# ---------------------------------------------------------------------------
# Test 7 — Phase 71 (DRB-09): Deribit renders derivatives, spot deferred
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deribit_renders_derivatives_spot_deferred(monkeypatch):
    """Phase 71 lifts f3 Path B. A Deribit allocator key no longer errors the
    whole sync: spot is skipped gracefully (Deribit is derivatives-first; spot
    ingestion stays deferred → empty), and the derivative side renders. The
    sync completes cleanly (no exception, no warning), so the allocator sees
    their Deribit positions instead of a deferral error.

    Contract proof that spot was SKIPPED (not fetched): fetch_balance is never
    called — there is no Deribit spot path."""
    from services import allocator_positions as ap

    mock_exchange = AsyncMock()
    mock_exchange.id = "deribit"
    # If spot were attempted, fetch_balance would be called — it must NOT be.
    mock_exchange.fetch_balance = AsyncMock(return_value={"total": {}})

    async def _fake_fetch_positions(exchange_name, exchange):
        return [
            {
                "symbol": "BTC-PERPETUAL",
                "side": "short",
                "size_base": 0.2,
                "size_usd": 10000.0,
                "entry_price": 48000.0,
                "mark_price": 49900.0,
                "unrealized_pnl": 2500.0,
                "exchange": "deribit",
            },
        ]

    monkeypatch.setattr(ap, "fetch_positions", _fake_fetch_positions)

    rows, warning = await fetch_allocator_holdings("deribit", mock_exchange)

    assert warning is None
    # Spot deferred → no spot rows; derivatives render.
    spot = [r for r in rows if r["holding_type"] == "spot"]
    deriv = [r for r in rows if r["holding_type"] == "derivative"]
    assert spot == []
    assert len(deriv) == 1
    assert deriv[0]["symbol"] == "BTC-PERPETUAL"
    assert deriv[0]["venue"] == "deribit"
    assert deriv[0]["unrealized_pnl_usd"] == 2500.0
    # No Deribit spot path — fetch_balance must never be called.
    mock_exchange.fetch_balance.assert_not_called()


def test_deribit_error_class_removed():
    """f3 Path B is lifted — the allocator-side DeribitNotSupportedError no
    longer exists (its only purpose was to defer Deribit spot by raising).
    The SEPARATE equity_reconstruction.DeribitNotSupportedError stays (that
    deferral — reconstruction — is still in force, SC-3)."""
    import services.allocator_positions as ap

    assert not hasattr(ap, "DeribitNotSupportedError")
    # Reconstruction deferral is untouched.
    from services.equity_reconstruction import (
        DeribitNotSupportedError as ReconDeferral,
    )
    assert issubclass(ReconDeferral, ccxt.NotSupported)


# ---------------------------------------------------------------------------
# Test 8 — f7: handler emits allocator.holdings.sync_completed audit event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done(
    monkeypatch, api_key_row_factory
):
    """f7: on DONE, run_poll_allocator_positions_job MUST route an audit
    emission through services.audit.log_audit_event — NOT a local no-op.
    Verified by patching services.audit.log_audit_event and asserting
    exact call shape (action/entity_type/entity_id/metadata)."""
    from services import job_worker as jw
    from services import audit as audit_module

    key_row = api_key_row_factory(id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance")
    mock_supabase = MagicMock()

    # Stub the preflight to return a ready _ExchangeContext. The real
    # preflight would touch KEK / Supabase / ccxt — unnecessary here.
    mock_exchange = MagicMock()
    mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=mock_exchange,
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)

    # Stub fetch + persist
    spot_row = {
        "venue": "binance", "symbol": "BTC", "holding_type": "spot",
        "side": "flat", "quantity": 0.5, "value_usd": 30000.0,
        "entry_price": None, "mark_price": 60000.0,
        "unrealized_pnl_usd": None, "cost_basis_usd": None,
        "raw_payload": {"asset": "BTC"},
    }
    deriv_row = {
        "venue": "binance", "symbol": "BTCUSDT", "holding_type": "derivative",
        "side": "long", "quantity": 0.1, "value_usd": 6000.0,
        "entry_price": 59000.0, "mark_price": 61000.0,
        "unrealized_pnl_usd": 200.0, "cost_basis_usd": 5900.0,
        "raw_payload": {"symbol": "BTCUSDT"},
    }

    # Phase 151 / AUM-02: the chokepoint gained an optional api_key_id kwarg
    # (account-level venues need an account-scoped symbol). Accepted here so the
    # double matches the real call shape.
    async def _fake_fetch(venue, exchange, api_key_id=None):
        return ([spot_row, deriv_row], None)

    async def _fake_persist(supa, rows, allocator_id, api_key_id, asof):
        return len(rows)

    # Patch module-local lookups in the handler. The handler does a local
    # import from services.allocator_positions — patch the symbols on that
    # module so the import binding picks up the mock.
    from services import allocator_positions as ap_mod
    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fake_fetch)
    monkeypatch.setattr(ap_mod, "persist_allocator_holdings", _fake_persist)

    # Make the supabase update path a no-op
    mock_update = MagicMock()
    mock_update.execute.return_value = MagicMock(data=[])
    mock_eq = MagicMock()
    mock_eq.execute.return_value = MagicMock(data=[])
    mock_update.eq.return_value = mock_eq
    mock_table = MagicMock()
    mock_table.update.return_value = mock_update
    mock_supabase.table.return_value = mock_table

    # The f7 patch target — log_audit_event lives in services.audit.
    # The handler does `from services.audit import log_audit_event`,
    # which binds the name at call time. Patch on the audit module so
    # the import inside _emit_audit resolves to our mock.
    log_audit_mock = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", log_audit_mock)

    job = {
        "id": "job-1",
        "kind": "poll_allocator_positions",
        "api_key_id": API_KEY_ID,
    }

    result = await jw.run_poll_allocator_positions_job(job)

    assert result.outcome == jw.DispatchOutcome.DONE

    # Audit emission — exact shape per ADR-0023 taxonomy
    log_audit_mock.assert_called_once()
    _args, kwargs = log_audit_mock.call_args
    assert kwargs["user_id"] == ALLOCATOR_ID
    assert kwargs["action"] == "allocator.holdings.sync_completed"
    assert kwargs["entity_type"] == "api_key"
    assert kwargs["entity_id"] == API_KEY_ID
    assert kwargs["metadata"] == {
        "row_count": 2,
        "holding_type_counts": {"spot": 1, "derivative": 1},
    }


# ---------------------------------------------------------------------------
# Test 9 — auth error maps to sync_status='revoked' + sync_failed audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_poll_allocator_positions_job_auth_error_sets_revoked(
    monkeypatch, api_key_row_factory
):
    """INGEST-05 / D-07: AuthenticationError → api_keys.sync_status='revoked'
    with sanitized sync_error. Audit emits 'allocator.holdings.sync_failed'
    with error_kind/sanitized_message metadata."""
    from services import job_worker as jw
    from services import audit as audit_module
    from services import allocator_positions as ap_mod

    key_row = api_key_row_factory(id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance")
    mock_supabase = MagicMock()
    mock_exchange = MagicMock()
    mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=mock_exchange,
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)

    async def _fail_auth(venue, exchange, api_key_id=None):
        raise ccxt.AuthenticationError("401 invalid api key")

    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fail_auth)

    # Capture the UPDATE call payload
    update_payloads: list[dict] = []

    def _update_payload_capture(payload):
        update_payloads.append(payload)
        m = MagicMock()
        m.eq.return_value.execute.return_value = MagicMock(data=[])
        return m

    mock_table = MagicMock()
    mock_table.update.side_effect = _update_payload_capture
    mock_supabase.table.return_value = mock_table

    log_audit_mock = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", log_audit_mock)

    job = {
        "id": "job-2",
        "kind": "poll_allocator_positions",
        "api_key_id": API_KEY_ID,
    }

    result = await jw.run_poll_allocator_positions_job(job)

    # Handler returns FAILED with error_kind='permanent' so the
    # dispatch loop transitions compute_jobs → failed
    assert result.outcome == jw.DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "401" in (result.error_message or "")

    # The api_keys row was updated with sync_status='revoked' + a sanitized error
    revoked_updates = [p for p in update_payloads if p.get("sync_status") == "revoked"]
    assert revoked_updates, f"expected a revoked UPDATE; got {update_payloads!r}"
    assert revoked_updates[0].get("sync_error")
    assert len(revoked_updates[0]["sync_error"]) <= 500

    # Audit emitted with the failure action + error_kind metadata
    log_audit_mock.assert_called_once()
    _args, kwargs = log_audit_mock.call_args
    assert kwargs["action"] == "allocator.holdings.sync_failed"
    assert kwargs["entity_type"] == "api_key"
    assert kwargs["entity_id"] == API_KEY_ID
    assert kwargs["metadata"]["error_kind"] == "permanent"
    assert "sanitized_message" in kwargs["metadata"]


# ---------------------------------------------------------------------------
# Regression — 2026-05-20: Bybit Unified Trading Account collateral surfaces
# as a spot holding even when CCXT's parsed `total` is empty.
#
# Background: a user with active Bybit perpetual positions saw zero Bybit
# spot rows in the Holdings panel — only OKX spot appeared. Bybit V5 sets
# `coin[*].availableToWithdraw: ""` when funds are locked as derivative
# collateral; CCXT's parseBalance maps the empty string to 0 in the
# parsed `total` dict, so the worker emitted zero spot rows for Bybit
# even though the unified account was fully funded. Fix reads
# `walletBalance` per coin directly from `info["result"]["list"][*]["coin"]`
# and merges it over CCXT's parsed totals when CCXT returns 0/missing.
# ---------------------------------------------------------------------------


def _bybit_uta_info(coin_balances: list[dict]) -> dict:
    """Build a realistic Bybit V5 fetch-balance `info` payload for tests.

    `coin_balances` is a list of dicts shaped like the rows under
    `info["result"]["list"][0]["coin"]`. Helper keeps the test bodies
    focused on the assertions rather than the V5 envelope shape.
    """
    return {
        "retCode": 0,
        "retMsg": "OK",
        "result": {
            "list": [
                {
                    "accountType": "UNIFIED",
                    "totalEquity": "195591.49",
                    "totalWalletBalance": "192540.04",
                    "coin": coin_balances,
                }
            ]
        },
    }


@pytest.mark.asyncio
async def test_bybit_uta_locked_collateral_surfaces_as_spot_row(monkeypatch):
    """Regression for 2026-05-20: a Bybit UTA user with all funds locked
    as derivative collateral has `availableToWithdraw: ""` per coin,
    which CCXT's parseBalance can map to 0 in `total`. The worker must
    fall back to the raw `walletBalance` so the collateral surfaces as
    a spot row instead of silently disappearing from Holdings."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "bybit"
    # CCXT's parsed `total` is empty/zero — the failure shape we're guarding.
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 0.0},
        "info": _bybit_uta_info([
            {
                "coin": "USDT",
                "equity": "195619.27",
                "walletBalance": "192567.39",  # ← the real number, locked
                "availableToWithdraw": "",
                "locked": "0",
                "usdValue": "195591.49",
                "unrealisedPnl": "3051.88",
            }
        ]),
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={})

    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, warning = await fetch_allocator_holdings("bybit", mock_exchange)
    assert warning is None

    spot_rows = [r for r in rows if r["holding_type"] == "spot"]
    assert len(spot_rows) == 1, (
        f"Expected one Bybit USDT spot row from walletBalance; got {spot_rows!r}"
    )
    row = spot_rows[0]
    assert row["venue"] == "bybit"
    assert row["symbol"] == "USDT"
    assert row["quantity"] == pytest.approx(192567.39)
    # USDT stablecoin shortcut → mark_price = 1.0, value_usd ≈ quantity.
    assert row["mark_price"] == 1.0
    assert row["value_usd"] == pytest.approx(192567.39)


@pytest.mark.asyncio
async def test_bybit_uta_multi_coin_walletbalance_extraction(monkeypatch):
    """A Bybit UTA can hold multiple coins simultaneously (USDT + BTC).
    Both must surface, and the non-stablecoin (BTC) gets priced via
    fetch_tickers — the existing pricing path is unchanged."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "bybit"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        # CCXT parses USDT to 0 (locked), but BTC to its real number.
        "total": {"USDT": 0.0, "BTC": 0.25},
        "info": _bybit_uta_info([
            {
                "coin": "USDT",
                "walletBalance": "50000.0",
                "availableToWithdraw": "",
            },
            {
                "coin": "BTC",
                "walletBalance": "0.25",
                "availableToWithdraw": "0.25",
            },
        ]),
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={
        "BTC/USDT": {"last": 60000.0},
    })

    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, _ = await fetch_allocator_holdings("bybit", mock_exchange)
    symbols = {r["symbol"]: r for r in rows if r["holding_type"] == "spot"}
    assert set(symbols) == {"USDT", "BTC"}, f"expected USDT+BTC, got {set(symbols)}"
    # USDT: walletBalance fallback (CCXT total was 0)
    assert symbols["USDT"]["quantity"] == pytest.approx(50000.0)
    # BTC: CCXT's non-zero total wins (defensive against double-counting)
    assert symbols["BTC"]["quantity"] == pytest.approx(0.25)
    assert symbols["BTC"]["value_usd"] == pytest.approx(0.25 * 60000.0)


@pytest.mark.asyncio
async def test_bybit_walletbalance_never_drops_nonzero_ccxt_total(monkeypatch):
    """Belt-and-suspenders: if CCXT's parsed total IS correct (non-zero)
    AND walletBalance is also present, the merge must NOT double-count
    or replace the CCXT value. CCXT's non-zero total wins; walletBalance
    only fills the 0/missing case."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "bybit"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 100000.0},  # CCXT already correct here
        "info": _bybit_uta_info([
            {
                "coin": "USDT",
                "walletBalance": "999999.0",  # discrepant — must NOT win
                "availableToWithdraw": "100000.0",
            },
        ]),
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={})

    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, _ = await fetch_allocator_holdings("bybit", mock_exchange)
    spot = [r for r in rows if r["holding_type"] == "spot"]
    assert len(spot) == 1
    assert spot[0]["quantity"] == pytest.approx(100000.0), (
        "CCXT's non-zero parsed total must win over raw walletBalance"
    )


@pytest.mark.asyncio
async def test_bybit_walletbalance_extraction_does_not_break_other_exchanges(monkeypatch):
    """The Bybit-specific fallback must NOT run for OKX, Binance, etc.
    Their existing fetch_balance contracts continue to be honoured."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 12345.0},
        # info shaped like Bybit's payload would be ignored for non-Bybit.
        "info": _bybit_uta_info([
            {"coin": "USDT", "walletBalance": "999999.0", "availableToWithdraw": ""}
        ]),
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={})

    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, _ = await fetch_allocator_holdings("okx", mock_exchange)
    spot = [r for r in rows if r["holding_type"] == "spot"]
    assert len(spot) == 1
    assert spot[0]["symbol"] == "USDT"
    # The OKX path used CCXT's parsed total verbatim — no Bybit fallback applied.
    assert spot[0]["quantity"] == pytest.approx(12345.0)


@pytest.mark.asyncio
async def test_bybit_malformed_info_falls_back_to_ccxt_total(monkeypatch):
    """A garbled `info` payload (missing keys, wrong types) must not
    crash the sync — the extractor returns `{}` and the existing
    CCXT-parsed `total` path is used as-is. Belt-and-suspenders against
    Bybit V5 shape drift."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "bybit"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 7777.0},
        "info": {"retCode": 0, "result": "this should be a dict, not a string"},
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={})

    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, _ = await fetch_allocator_holdings("bybit", mock_exchange)
    spot = [r for r in rows if r["holding_type"] == "spot"]
    assert len(spot) == 1
    # Existing CCXT total path used — no crash on the malformed info.
    assert spot[0]["quantity"] == pytest.approx(7777.0)


# ---------------------------------------------------------------------------
# AUM-02 WRITE BOUNDARY (2026-08-08) — no exception's str() may reach
# api_keys.sync_error, for ANY exception type, on ANY arm.
#
# WHY (Rule 9 — intent): `sync_error` is product copy. AllocatorSyncStatus.tsx
# renders it VERBATIM under the sync pill (`helperText = syncError ?? ""`), with
# no translation layer. The PROD incident behind this module's AUM-02 block was
# literally "'Mt5Session' object has no attribute 'fetch_balance'" shown to
# three founder accounts.
#
# The defect kept coming back because the guard was always placed at the RAISE:
# each venue branch converted ITS exception to copy, so the guarantee held only
# for exceptions somebody had thought of. Then `fetch_allocator_holdings` was
# (correctly) taught to re-raise anything `classify_exception` calls PERMANENT
# unwrapped — the retry disposition has to survive, since the handler's
# transient arm hardcodes error_kind='transient' and never walks the __cause__
# chain — and that re-raise handed the handler's generic `except Exception` a
# live exception again. `classify_exception`'s fall-through is `str(exc)[:500]`,
# so `binance {"code":-1121,"msg":"Invalid symbol."}` became the sentence a user
# read under "Sync failed".
#
# These tests pin the guarantee at the WRITE instead: whatever arrives, the
# column gets `sync_error_copy(status, venue)` — derived from the status and the
# venue, with no parameter an exception string could travel through. The oracle
# is deliberately "the raw text is ABSENT from the column and PRESENT on the
# operator surfaces", not "the copy equals X": that is the actual product
# invariant, and it cannot go stale when a new exception family appears.
# ---------------------------------------------------------------------------

# A string no copy constant could ever legitimately contain.
_CANARY = "CANARY-9f3b raw exception text {\"code\":-1121} <html>"


class _UnanticipatedVenueError(Exception):
    """An exception family invented AFTER the write boundary was built.

    The point of the whole fix: the guarantee must not depend on this type
    being known to `classify_exception`, to `_map_exception_to_sync_status`, or
    to any list in `allocator_positions`.
    """


def _drive_allocator_sync(
    monkeypatch,
    key_row,
    *,
    fetch=None,
    persist=None,
    exchange=None,
):
    """Run run_poll_allocator_positions_job with every collaborator stubbed.

    Returns (result, update_payloads, audit_mock). `update_payloads` is every
    dict handed to `api_keys.update(...)` — i.e. exactly what would land in the
    user-visible column.
    """
    from services import job_worker as jw
    from services import audit as audit_module
    from services import allocator_positions as ap_mod

    mock_supabase = MagicMock()
    mock_exchange = exchange if exchange is not None else MagicMock()
    if exchange is None:
        mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=mock_exchange,
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)

    if fetch is not None:
        monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", fetch)
    if persist is not None:
        monkeypatch.setattr(ap_mod, "persist_allocator_holdings", persist)
    else:
        async def _ok_persist(supa, rows, allocator_id, api_key_id, asof):
            return len(rows)
        monkeypatch.setattr(ap_mod, "persist_allocator_holdings", _ok_persist)

    update_payloads: list[dict] = []

    def _capture(payload):
        update_payloads.append(payload)
        m = MagicMock()
        m.eq.return_value.execute.return_value = MagicMock(data=[])
        return m

    mock_table = MagicMock()
    mock_table.update.side_effect = _capture
    mock_supabase.table.return_value = mock_table

    log_audit_mock = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", log_audit_mock)

    job = {
        "id": "job-aum02",
        "kind": "poll_allocator_positions",
        "api_key_id": key_row["id"],
    }
    return jw.run_poll_allocator_positions_job(job), update_payloads, log_audit_mock


def _sync_errors(update_payloads):
    return [
        p["sync_error"]
        for p in update_payloads
        if p.get("sync_error") is not None
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc_factory",
    [
        pytest.param(
            lambda: ccxt.BadRequest(f"binance {_CANARY}"), id="ccxt-badrequest"
        ),
        pytest.param(
            lambda: ccxt.BadSymbol(f"binance {_CANARY}"), id="ccxt-badsymbol"
        ),
        pytest.param(
            lambda: ccxt.AuthenticationError(f"401 {_CANARY}"), id="auth-revoked"
        ),
        pytest.param(
            lambda: ccxt.PermissionDenied(f"403 {_CANARY}"), id="permission-revoked"
        ),
        pytest.param(
            lambda: ccxt.ExchangeNotAvailable(f"503 {_CANARY}"), id="ccxt-unknown"
        ),
        pytest.param(lambda: KeyError(_CANARY), id="plain-keyerror"),
        pytest.param(
            lambda: AttributeError(
                "'Mt5Session' object has no attribute 'fetch_balance'"
            ),
            id="the-prod-defect-itself",
        ),
        # THE point of the exercise: a family nobody has written a branch for.
        pytest.param(
            lambda: _UnanticipatedVenueError(_CANARY), id="never-seen-before-type"
        ),
    ],
)
async def test_no_exception_text_ever_reaches_sync_error(
    monkeypatch, api_key_row_factory, exc_factory
):
    """ANY exception escaping the fetch chokepoint ⇒ the column gets COPY.

    Parametrized over the families that exist today AND one invented for this
    test, because a guarantee that only covers anticipated types is the bug.
    """
    from services import job_worker as jw
    from services.allocator_positions import SYNC_ERROR_COPY_BY_STATUS

    expected = exc_factory()

    async def _fail(venue, exchange, api_key_id=None):
        raise expected

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance"
    )
    coro, payloads, audit_mock = _drive_allocator_sync(
        monkeypatch, key_row, fetch=_fail
    )
    result = await coro

    assert result.outcome == jw.DispatchOutcome.FAILED

    written = _sync_errors(payloads)
    assert written, f"expected a sync_error write; got {payloads!r}"
    for text in written:
        # (1) The raw text is ABSENT from the user-visible column.
        assert _CANARY not in text, (
            f"raw exception text reached api_keys.sync_error: {text!r}"
        )
        assert "fetch_balance" not in text
        assert "Error" not in text and "Exception" not in text
        # (2) And what IS there is one of the copy constants, rendered.
        assert text in {
            tpl.format(venue="Binance")
            for tpl in SYNC_ERROR_COPY_BY_STATUS.values()
        }, f"sync_error is not a known copy constant: {text!r}"

    # (3) The DIAGNOSIS is not lost — it survives on the operator surfaces.
    # compute_jobs.last_error and the audit metadata are admin-only; that is
    # where an engineer reads what actually happened.
    diagnostic = (result.error_message or "") + str(
        audit_mock.call_args.kwargs["metadata"]
    )
    assert (_CANARY in diagnostic) or ("fetch_balance" in diagnostic), (
        "the exception text must survive on the operator surfaces — copy at the "
        "write boundary must not become copy everywhere"
    )


@pytest.mark.asyncio
async def test_permanent_derivative_failure_shows_copy_not_venue_json(
    monkeypatch, api_key_row_factory
):
    """The red team's exact scenario, end to end, through the REAL fetch path.

    Spot works, `fetch_positions` raises `ccxt.BadRequest`. The classifier calls
    that permanent, so `fetch_allocator_holdings` re-raises it UNWRAPPED (that
    coupling is load-bearing — a permanent failure downgraded to transient buys
    the 30s→6h ladder against a host that will never answer). It therefore
    reaches the handler's generic arm as a live exception, which is precisely
    why the guarantee has to live at the write.
    """
    from services import job_worker as jw
    from services import allocator_positions as ap

    venue_json = 'binance {"code":-1121,"msg":"Invalid symbol."}'
    boom = ccxt.BadRequest(venue_json)

    async def _positions_fail(*_a, **_kw):
        raise boom

    monkeypatch.setattr(ap, "fetch_positions", _positions_fail)

    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 250000.0}})
    exchange.fetch_tickers = AsyncMock(return_value={})
    exchange.close = AsyncMock()

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance"
    )
    coro, payloads, _audit = _drive_allocator_sync(
        monkeypatch, key_row, exchange=exchange
    )
    result = await coro

    written = _sync_errors(payloads)
    assert written
    for text in written:
        assert "-1121" not in text
        assert "Invalid symbol" not in text
        assert "{" not in text and "}" not in text
    assert written[-1] == (
        "Couldn't sync holdings from Binance — the balances shown are from the "
        "last successful sync."
    )

    # The classification SURVIVED — this is the half the previous round fixed
    # and this one must not undo.
    assert result.error_kind == "permanent"
    assert "-1121" in (result.error_message or "")


@pytest.mark.asyncio
async def test_rate_limit_arm_writes_copy_not_the_geo_block_body(
    monkeypatch, api_key_row_factory
):
    """The 429/geo-block arm writes to the same column and must obey the same
    rule. Pre-fix it wrote the classifier's operator instruction ("move region
    or proxy") plus the raw CloudFront HTML body into product copy."""
    from services import job_worker as jw

    boom = ccxt.RateLimitExceeded(_BYBIT_CLOUDFRONT_403)

    async def _fail(venue, exchange, api_key_id=None):
        raise boom

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="bybit"
    )
    coro, payloads, _audit = _drive_allocator_sync(
        monkeypatch, key_row, fetch=_fail
    )
    result = await coro

    written = _sync_errors(payloads)
    assert written
    for text in written:
        assert "CloudFront" not in text
        assert "proxy" not in text
        assert "<HTML>" not in text
    # A geo-block is NOT a rate limit — the status split is preserved.
    assert [p["sync_status"] for p in payloads if "sync_status" in p] == ["error"]
    assert result.error_kind == "permanent"


@pytest.mark.asyncio
async def test_persist_failure_writes_copy_not_the_db_exception(
    monkeypatch, api_key_row_factory
):
    """The third write site: a PostgREST/DB failure after a SUCCESSFUL fetch.

    Same defect class, sourced from our own storage layer — schema-cache misses
    and constraint names are not product copy either.
    """
    async def _ok_fetch(venue, exchange, api_key_id=None):
        return ([], None)

    async def _persist_boom(*_a, **_kw):
        raise RuntimeError(_CANARY)

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="okx"
    )
    coro, payloads, _audit = _drive_allocator_sync(
        monkeypatch, key_row, fetch=_ok_fetch, persist=_persist_boom
    )
    await coro

    written = _sync_errors(payloads)
    assert written
    for text in written:
        assert _CANARY not in text
    assert written[-1] == (
        "Couldn't sync holdings from OKX — the balances shown are from the last "
        "successful sync."
    )


def test_transient_error_is_only_ever_constructed_from_a_copy_constant():
    """The one remaining channel whose str() IS written verbatim.

    `AllocatorHoldingsSyncTransientError`'s handler arm stamps `str(exc)` into
    the column by design — the type's contract is "my message is end-user copy".
    That contract is enforced at the CONSTRUCTOR, in source: every raise site
    must pass a module copy constant (optionally `.format`-ed for the venue),
    never an interpolated exception. A future `raise
    AllocatorHoldingsSyncTransientError(str(exc))` goes RED here.

    AST, not text: a reformat must not turn this RED, and a leak must not hide
    behind one. (The sibling closure in test_allocator_positions_non_ccxt.py
    bans `str(exc)` / f-strings inside except arms; this one bans everything
    that is not a copy constant at the constructor, including a value built
    somewhere else and carried in.)
    """
    import ast
    import inspect
    import re as _re
    from services import allocator_positions as ap

    tree = ast.parse(inspect.getsource(ap))
    constant_name = _re.compile(r"^[A-Z][A-Z0-9_]*_NOTE$")

    def _is_copy_constant(node: ast.expr) -> bool:
        # NAME_OF_NOTE
        if isinstance(node, ast.Name):
            return bool(constant_name.match(node.id))
        # NAME_OF_NOTE.format(venue=...)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "format"
            and isinstance(node.func.value, ast.Name)
        ):
            return bool(constant_name.match(node.func.value.id))
        return False

    sites = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "AllocatorHoldingsSyncTransientError"
    ]
    assert sites, "no construction sites found — the scan is not seeing the code"

    for call in sites:
        assert len(call.args) == 1 and _is_copy_constant(call.args[0]), (
            "AllocatorHoldingsSyncTransientError must be constructed from a "
            f"copy constant; line {call.lineno} passes "
            f"{ast.unparse(call.args[0]) if call.args else '<no argument>'!r}"
        )


def test_sync_error_copy_constants_are_product_copy():
    """Copy-class gate (151-UI-SPEC): ONE sentence, "{what happened} — {what
    next}", U+2014 em dash, no Python/venue jargon. This column is rendered
    verbatim in the browser."""
    from services.allocator_positions import (
        SYNC_ERROR_COPY_BY_STATUS,
        sync_error_copy,
    )

    for status, template in SYNC_ERROR_COPY_BY_STATUS.items():
        text = sync_error_copy(status, "okx")
        assert "OKX" in text, f"{status}: venue not rendered in product casing"
        assert "—" in text, f"{status}: needs an em dash"
        assert " -- " not in text and " - " not in text
        assert text.endswith("."), f"{status}: not a sentence"
        assert text.count(".") == 1, f"{status}: more than one sentence"
        assert "{" not in text and "}" not in text
        for jargon in ("Error", "Exception", "None", "()", "_"):
            assert jargon not in text, f"{status}: leaks jargon {jargon!r}"

    # An unknown status must still produce copy, never a KeyError — this call
    # sits inside the write that clears the UI's 'syncing' spinner.
    assert sync_error_copy("a-status-invented-later", "binance") == (
        SYNC_ERROR_COPY_BY_STATUS["error"].format(venue="Binance")
    )
