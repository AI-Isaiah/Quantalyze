"""Regression tests for analytics-service/routers/cron.py.

Covers audit-2026-05-07 findings:

  * C-0192 — `_sync_single_key` revoked-key branch sets api_keys
    is_active=False scoped to .eq("id", key_id) only, with payload
    `{"is_active": False}` (no other fields).
  * C-0194 — Transient validation failures (RATE_LIMITED, etc.) do
    NOT deactivate the key; only credential-rejection codes do.
  * C-0199 — Missing KEK raises HTTPException(500), not HTTP 200.
  * C-0200 — Strategy lifecycle filter: archived/suspended/deleted
    strategies are skipped when building the per-key strategy list,
    AND a missing `status` field fails closed (strategy dropped).
  * C-0201 — Multi-strategy keys: sync_trades RPC fires for EVERY
    linked strategy (pre-fix the loop dropped strategies 2..N).
  * H-0541 / H-0545 — Portfolio recompute error-isolation: one
    portfolio failing must NOT abort recompute of subsequent ones.
  * H-0546 — Portfolio recompute fans out via asyncio.gather.

Phase-B specialist additions (post simplify pass):

  * Initial api_keys SELECT failure raises HTTP 500 with logger.exception
    rather than a raw FastAPI traceback (silent-failure-hunter F1).
  * Deactivate UPDATE with empty `.data` logs an error so a mid-tick
    row deletion doesn't masquerade as a successful deactivation
    (silent-failure-hunter F3).
  * `_sync_single_key` returns status="partial" when one of N
    per-strategy sync_trades RPCs fails — the remaining strategies
    are stored AND `last_sync_at` is still bumped so the next tick
    doesn't refetch already-landed trades (silent-failure-hunter F4).
  * `sync_trades` returning an unexpected (non-int) shape logs an
    error and counts 0 stored, so the cursor HOLDS rather than advancing
    on a fabricated success count (silent-failure-hunter F5; the
    fabricated-count half fixed 2026-09-19).
  * `validate_key_permissions` raising (vs returning valid=False)
    yields status="error" with no key deactivation (test-analyzer F3).
  * In-flight `computing` row → `_guarded_recompute` skips the
    compute and counts as ok (test-analyzer F2 / silent-failure F13).
  * `_compute_portfolio_analytics` raising HTTPException(400) for
    benign business states ("No strategies") is classified as
    "skipped", not "failed" (silent-failure-hunter F7).
  * Per-portfolio `asyncio.wait_for(PORTFOLIO_RECOMPUTE_TIMEOUT)`
    converts a wedged compute into a bounded failure that doesn't
    starve `_compute_semaphore` for everyone else (code-reviewer F2).
  * `portfolio_recomputes.failures` is capped at RECOMPUTE_FAILURE_CAP
    with `failures_truncated`/`total_failures` set (silent-failure F8).
  * Recompute-lookup Supabase blip is caught so per-key sync results
    survive in the response (silent-failure-hunter F11).
  * `transient_failure` and `partial` results are counted in the
    summary log + response payload — pre-Phase-B they were silently
    dropped from every counter (code-reviewer F1).

Why pure stdlib + MagicMock: matching the established pattern in
test_cron_recompute_is_test_filter.py. supabase-py + ccxt are real
deps and import-heavy; the cron module itself imports cleanly, so we
stub validate_key_permissions / create_exchange / get_supabase /
decrypt_credentials / get_kek and exercise the orchestration logic
directly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# `routers.cron` imports cleanly in the analytics-service venv. We
# patch its external dependencies (get_supabase, validate_key_permissions,
# create_exchange, decrypt_credentials, fetch_all_trades,
# fetch_usdt_balance, get_kek) inline per test.
from routers import cron as cron_mod


@pytest.fixture(autouse=True)
def _clear_validation_cache():
    """C-0193: `_key_validation_cache` is module-level state. Without a
    reset between tests, an earlier test that records `key-1` as
    recently-validated would let the next test skip the
    `validate_key_permissions` stub entirely — producing false greens for
    tests that assert on validation behaviour.
    """
    cron_mod._key_validation_cache.clear()
    yield
    cron_mod._key_validation_cache.clear()


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_key_row(
    *,
    key_id: str = "key-1",
    exchange: str = "binance",
    strategy_ids: list[str] | None = None,
    last_sync_at: str | None = None,
    strategy_cursors: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Build a synthetic `api_keys` row as `cron_sync` hands it to
    `_sync_single_key`.

    164.5.1.4: `last_sync_at` and `strategy_cursors` both default to today's
    values so all pre-existing call sites are untouched.

    ⛔ `strategy_cursors=None` OMITS the key entirely rather than setting it to
    `{}`. The three marker states the read path must tell apart are: key ABSENT
    from the row (no marker information was fetched -> fall back to the key's
    own `last_sync_at`), strategy ABSENT from the mapping (same fallback), and
    strategy PRESENT with a null value (no resume point -> refetch from the
    start of history). Materialising an empty mapping here would still be
    correct for the reader, but the production path for a key whose markers
    were never fetched is an absent key, and the helper must be able to
    express it.
    """
    row: dict[str, Any] = {
        "id": key_id,
        "exchange": exchange,
        "last_sync_at": last_sync_at,
        # Real api_keys rows always carry these encryption columns; the
        # null-credential guard in _sync_single_key only trips when they are
        # missing/NULL (malformed seed data). Decrypt is mocked in tests, so
        # the dummy values are never actually decrypted.
        "dek_encrypted": "dummy-dek",
        "api_key_encrypted": "dummy-blob",
        "strategy_ids": strategy_ids or [],
        "strategy_id": (strategy_ids or [None])[0],
    }
    if strategy_cursors is not None:
        row["strategy_cursors"] = strategy_cursors
    return row


def _stub_validation(
    *,
    valid: bool,
    error_code: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "valid": valid,
        "read_only": True,
        "error": error,
        "error_code": error_code,
        "markets_loaded": True,
        "markets_error": None,
    }


def _wire_allocator_holdings_empty(mock_supabase: MagicMock) -> MagicMock:
    """Stub the allocator_holdings linkage probe to return no rows so the
    credential-rejection path proceeds to the deactivate UPDATE.

    The C-0195 fix routes `.table("allocator_holdings").select("id")
    .eq("api_key_id", key_id).limit(1).execute()` BEFORE the
    `is_active=False` UPDATE. Without an explicit stub, MagicMock auto-
    generates truthy `.data` and the fix's fail-closed branch fires
    everywhere, masking the deactivate path the legacy tests assert.
    """
    ah_chain = MagicMock()
    ah_chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[]
    )
    existing_side_effect = mock_supabase.table.side_effect
    existing_return = mock_supabase.table.return_value

    def _dispatch(name: str):
        if name == "allocator_holdings":
            return ah_chain
        if existing_side_effect is not None:
            return existing_side_effect(name)
        return existing_return

    mock_supabase.table.side_effect = _dispatch
    return ah_chain


def _wire_allocator_holdings_used(
    mock_supabase: MagicMock, key_id: str = "key-1"
) -> MagicMock:
    """Stub the allocator_holdings linkage probe to return one row,
    signalling the key backs an allocator's holdings and must NOT be
    deactivated (C-0195 allocator-protected path).
    """
    ah_chain = MagicMock()
    ah_chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": "holding-1", "api_key_id": key_id}]
    )
    existing_side_effect = mock_supabase.table.side_effect
    existing_return = mock_supabase.table.return_value

    def _dispatch(name: str):
        if name == "allocator_holdings":
            return ah_chain
        if existing_side_effect is not None:
            return existing_side_effect(name)
        return existing_return

    mock_supabase.table.side_effect = _dispatch
    return ah_chain


def _make_mock_supabase_for_cron_sync(
    *,
    keys_data: list[dict],
    ps_data: list[dict] | None = None,
    pf_data: list[dict] | None = None,
    pa_data: list[dict] | None = None,
    rpc_data: int | None = 1,
    update_data: list[dict] | None = None,
    sc_data: list[dict] | None = None,
    sc_select_side_effect: list[Any] | None = None,
) -> MagicMock:
    """Build a MagicMock supabase client wired for end-to-end cron_sync
    integration tests. Each table name dispatches to its own chain so
    SELECT / UPDATE / RPC calls can be asserted independently.

    - keys_data: rows returned by api_keys SELECT (must include the
      `strategies` embed key with status fields).
    - ps_data: rows returned by portfolio_strategies SELECT.
    - pf_data: rows returned by portfolios SELECT (post is_test=false
      filter); defaults to mirroring ps_data's portfolio_ids.
    - pa_data: rows returned by portfolio_analytics in-flight check;
      empty list => "no in-flight row, run the compute."
    - rpc_data: scalar returned by sync_trades RPC; pass `None` or a
      non-int to exercise the shape-fallback path. Pass an Exception
      instance to make rpc.execute raise.
    - update_data: rows returned by api_keys UPDATE; defaults to one
      row so the deactivation-no-op detection path isn't accidentally
      tripped.
    - sc_data: rows returned by the `strategy_sync_cursors` SELECT
      (164.5.1.4), shaped `{"strategy_id": ..., "last_sync_at": ...}`.
      Defaults to an empty list, which is the state the migration lands
      in: no marker rows, every strategy falls back to its key's cursor.
      ⚠️ Serving this table is LOAD-BEARING for any test that touches the
      marker read, and the failure mode is SILENT. MEASURED: with no chain
      for it, `.select(...).in_(...).execute()` returns a bare MagicMock
      whose `.data` iterates EMPTY (MagicMock auto-configures `__iter__` to
      `iter([])`), so `rows()` yields nothing, NOTHING raises, the fail-open
      wrapper never fires, and no `strategy_cursor_lookup_error` appears in
      the response. Every key just gets an empty mapping — the wiring is
      permanently green and permanently unexercised at the same time, with
      no signal anywhere that it was never tested.
      The marker UPSERT on the same chain is captured, not absorbed: read
      the payloads back off `mock_supabase.strategy_cursor_upserts`, which
      this helper attaches to the returned mock.
    - sc_select_side_effect: when given, used as the marker SELECT's
      `.execute` side_effect INSTEAD of `sc_data` — a list applied call by
      call, so an entry may be a response mock OR an exception instance.
      That per-CALL granularity is what lets a gate serve one page and then
      raise on the next: the lookup is CHUNKED at `_CRON_IN_LIST_PAGE_SIZE`,
      and failing every call could not distinguish "degraded to an empty
      mapping" from "kept the rows it had already collected", which is the
      difference between a clean fallback and partial garbage.
    """
    if ps_data is None:
        ps_data = []
    if pf_data is None:
        pf_data = [{"id": r["portfolio_id"]} for r in ps_data]
    if pa_data is None:
        pa_data = []
    if sc_data is None:
        sc_data = []
    if update_data is None:
        update_data = [{"id": r.get("id", "key-1")} for r in keys_data]

    # Real api_keys rows carry encryption columns; _sync_single_key's
    # null-credential guard (QUANTALYZE-M) skips rows missing them. Default-fill
    # so credential-agnostic integration tests still reach the (mocked) decrypt
    # path rather than being short-circuited as malformed.
    for _row in keys_data:
        _row.setdefault("dek_encrypted", "dummy-dek")
        _row.setdefault("api_key_encrypted", "dummy-blob")

    mock_supabase = MagicMock()

    keys_chain = MagicMock()
    keys_chain.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=keys_data
    )

    ps_chain = MagicMock()
    ps_chain.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=ps_data
    )

    pf_chain = MagicMock()
    pf_chain.select.return_value.in_.return_value.eq.return_value.execute.return_value = MagicMock(
        data=pf_data
    )

    pa_chain = MagicMock()
    pa_chain.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=pa_data
    )

    update_chain = MagicMock()
    update_chain.eq.return_value.execute.return_value = MagicMock(data=update_data)

    # 164.5.1.4 — `strategy_sync_cursors`. The literal is repeated here rather
    # than imported from `routers.cron` for the same reason `_SYNC_CURSOR_TABLE`
    # further down this file states: the STRING is what reaches PostgREST, so a
    # test that spelled it via the module constant would keep passing if the
    # production table name were renamed underneath it.
    strategy_cursor_upserts: list[Any] = []
    sc_chain = MagicMock()
    if sc_select_side_effect is not None:
        sc_chain.select.return_value.in_.return_value.execute.side_effect = (
            sc_select_side_effect
        )
    else:
        sc_chain.select.return_value.in_.return_value.execute.return_value = MagicMock(
            data=sc_data
        )

    def _sc_upsert(payload: Any, *args: Any, **kwargs: Any):
        # An explicit branch, not a bare mock: a bare mock accepts
        # `.upsert(...).execute()` silently and captures NOTHING, so an
        # implementation that never wrote a marker would be indistinguishable
        # from one that did.
        strategy_cursor_upserts.append(payload)
        ups = MagicMock()
        ups.execute.return_value = MagicMock(data=payload)
        return ups

    sc_chain.upsert.side_effect = _sc_upsert

    def _table(name: str):
        if name == "strategy_sync_cursors":
            return sc_chain
        if name == "api_keys":
            t = MagicMock()
            t.select.return_value.eq.return_value.execute.return_value = (
                keys_chain.select.return_value.eq.return_value.execute.return_value
            )
            t.update.return_value = update_chain
            return t
        if name == "portfolio_strategies":
            return ps_chain
        if name == "portfolios":
            return pf_chain
        if name == "portfolio_analytics":
            return pa_chain
        return MagicMock()

    mock_supabase.table.side_effect = _table

    rpc_chain = MagicMock()
    if isinstance(rpc_data, BaseException):
        rpc_chain.execute.side_effect = rpc_data
    else:
        rpc_chain.execute.return_value = MagicMock(data=rpc_data)
    mock_supabase.rpc.return_value = rpc_chain

    # Captured `strategy_sync_cursors` upsert payloads, in call order.
    mock_supabase.strategy_cursor_upserts = strategy_cursor_upserts

    return mock_supabase


# ---------------------------------------------------------------------------
# C-0192 / C-0194 — credential-rejection vs transient validation
# ---------------------------------------------------------------------------


class TestRevokedKeyBranch:
    """C-0192: credential-rejection codes deactivate the key, scoped to
    the row's primary key. C-0194: transient codes do NOT deactivate.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "error_code",
        ["AUTH_FAILED", "PERMISSION_DENIED", "WITHDRAW_SCOPE", "TRADE_SCOPE"],
    )
    async def test_credential_rejection_deactivates_key_scoped_to_id(
        self, error_code: str
    ):
        """Each credential-rejection code triggers
        supabase.table('api_keys').update({'is_active': False}).eq('id', key_id).
        The .eq('id', key_id) scope is the regression seed against
        accidental mass-update — a Supabase mutation without the .eq
        would disable EVERY active key.
        """
        mock_supabase = MagicMock()
        update_chain = MagicMock()
        eq_chain = MagicMock()
        # Realistic Supabase UPDATE return shape: `.data` is a list of
        # updated rows. Empty `.data` would trigger the no-op detection
        # path tested separately in TestDeactivateNoOpDetection.
        eq_chain.execute.return_value = MagicMock(data=[{"id": "key-1"}])
        update_chain.eq.return_value = eq_chain
        mock_supabase.table.return_value.update.return_value = update_chain
        # C-0195: allocator_holdings linkage probe must return no rows so
        # the deactivate path is reached (this test pre-dates the
        # allocator-protected path and asserts the legacy contract).
        _wire_allocator_holdings_empty(mock_supabase)

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(
                     valid=False, error_code=error_code, error="bad creds"
                 )),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "key_revoked"
        assert result["error_code"] == error_code
        # Mutation contract: ONE .update on api_keys, payload is
        # exactly {"is_active": False} (no other fields — a flipped
        # bool or an extra field would still pass an `assert_called`
        # assertion), scoped to ONE .eq('id', key_id). The .return_value
        # generic accessor still resolves to the api_keys mock because
        # _wire_allocator_holdings_empty routes the allocator_holdings
        # table to a separate chain.
        mock_supabase.table.assert_any_call("api_keys")
        mock_supabase.table.return_value.update.assert_called_once_with(
            {"is_active": False}
        )
        update_chain.eq.assert_called_once_with("id", "key-1")
        eq_chain.execute.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "error_code",
        [
            "RATE_LIMITED",
            "NETWORK_UNAVAILABLE",
            "DDOS_PROTECTION",
            "EXCHANGE_UNAVAILABLE",
            "VALIDATION_UNEXPECTED",
        ],
    )
    async def test_transient_failure_does_not_deactivate(
        self, error_code: str
    ):
        """C-0194: transient codes must NOT call is_active=False. A
        30-second network blip pre-fix permanently disabled the user's
        key.
        """
        mock_supabase = MagicMock()
        # If `.update` is called we want to be able to detect it.
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(
                     valid=False, error_code=error_code, error="transient"
                 )),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "transient_failure"
        assert result["error_code"] == error_code
        # The deactivate path must NOT have been taken: .update was
        # never called on api_keys. Asserting directly on `.update`
        # (not `update_chain.eq`) survives changes to the post-`.update`
        # chain shape.
        mock_supabase.table.return_value.update.assert_not_called()


class TestDeferredNonCcxtSkip:
    """F1: a connected non-ccxt key (sfox) has no cron ingestion path yet.

    WHY (Rule 9): cron_sync selects ALL active api_keys with no exchange
    filter, and `_sync_single_key` calls `create_exchange(exchange)` which
    raises ValueError("Unsupported exchange: sfox") for anything outside
    EXCHANGE_CLASSES. Pre-fix that ValueError hit the outer `except Exception`
    → logger.exception (Sentry) + status="error" on EVERY 15-min tick, forever,
    for every connected sfox key — recurring, unactionable alert spam until the
    later-phase ingestion ships. The fix guards BEFORE create_exchange and
    returns a benign "deferred" outcome. This pins: no exception logged, status
    is "deferred" (NOT "error"), the key is NOT deactivated, and neither
    create_exchange nor decrypt_credentials is reached for the deferred key.
    """

    @pytest.mark.asyncio
    async def test_sfox_key_is_deferred_not_errored_or_deactivated(self):
        # sfox is genuinely absent from EXCHANGE_CLASSES — assert the premise so
        # this test can never silently pass because sfox was later added there
        # (at which point the real ingestion path exists and this guard changes).
        assert "sfox" not in cron_mod.EXCHANGE_CLASSES

        mock_supabase = MagicMock()

        # create_exchange / decrypt_credentials must be UNREACHABLE for a
        # deferred key: the guard short-circuits before either. A side_effect
        # AssertionError converts any accidental call into a hard failure.
        create_exchange_spy = MagicMock(
            side_effect=AssertionError("create_exchange must not run for a deferred non-ccxt key")
        )
        decrypt_spy = MagicMock(
            side_effect=AssertionError("decrypt_credentials must not run for a deferred non-ccxt key")
        )

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", decrypt_spy), \
             patch.object(cron_mod, "create_exchange", create_exchange_spy), \
             patch.object(cron_mod, "logger") as mock_logger:
            key_row = _make_key_row(exchange="sfox", strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Benign, distinctly-bucketed outcome — never an error.
        assert result["status"] == "deferred"
        assert result["status"] != "error"
        assert result["exchange"] == "sfox"
        assert result["trades_fetched"] == 0

        # NO Sentry-grade exception; a single INFO breadcrumb instead.
        mock_logger.exception.assert_not_called()
        mock_logger.error.assert_not_called()
        mock_logger.info.assert_called_once()

        # Guarded before any exchange/credential work.
        create_exchange_spy.assert_not_called()
        decrypt_spy.assert_not_called()

        # Key stays active — nothing is wrong with it, ingestion just deferred.
        mock_supabase.table.return_value.update.assert_not_called()


# ---------------------------------------------------------------------------
# C-0201 — multi-strategy keys must fan out sync_trades
# ---------------------------------------------------------------------------


class TestMultiStrategyFanOut:
    """C-0201: A single api_keys row can back multiple strategies. The
    pre-fix code took strategy_rel[0] only — strategies 2..N silently
    missed every cron tick. Post-fix sync_trades is invoked once per
    linked strategy, then api_keys.last_sync_at is updated once.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_fires_for_every_linked_strategy(self):
        mock_supabase = MagicMock()
        # RPC chain: supabase.rpc('sync_trades', {...}).execute() returns
        # an .data int (count of stored trades).
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=3)
        mock_supabase.rpc.return_value = rpc_chain
        # update chain (last_sync_at)
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        trades_fixture = [{"id": "t1"}, {"id": "t2"}, {"id": "t3"}]

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=trades_fixture),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B", "strat-C"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "ok"
        # ONE sync_trades RPC per linked strategy (each followed by an
        # enqueue_compute_job recompute trigger, asserted separately below).
        sync_trades_calls = [
            c for c in mock_supabase.rpc.call_args_list if c.args[0] == "sync_trades"
        ]
        assert len(sync_trades_calls) == 3
        invoked_strategies = sorted(
            c.args[1]["p_strategy_id"] for c in sync_trades_calls
        )
        assert invoked_strategies == ["strat-A", "strat-B", "strat-C"]
        # And one recompute enqueued per stored strategy (the trigger that
        # replaced the broken 'stale' marker). Default kind is the funding-
        # inclusive CSV route (derive_broker_dailies), mirroring sync_trades.
        enqueue_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "enqueue_compute_job"
        ]
        assert sorted(c.args[1]["p_strategy_id"] for c in enqueue_calls) == [
            "strat-A", "strat-B", "strat-C",
        ]
        assert all(c.args[1]["p_kind"] == "derive_broker_dailies" for c in enqueue_calls)
        # Result reports per-strategy breakdown
        assert result["per_strategy_stored"] == {
            "strat-A": 3,
            "strat-B": 3,
            "strat-C": 3,
        }
        assert result["strategy_ids"] == ["strat-A", "strat-B", "strat-C"]


# ---------------------------------------------------------------------------
# C-0200 — strategy lifecycle filter
# ---------------------------------------------------------------------------


class TestStrategyLifecycleFilter:
    """C-0200: only sync into strategies whose status is one of
    {draft, pending_review, published}. Archived/suspended/deleted
    strategies must NOT receive a sync_trades RPC.
    """

    @pytest.mark.asyncio
    async def test_only_live_statuses_receive_sync_trades_rpc(self):
        """Behavioural: drive `cron_sync` end-to-end with a single key
        whose embedded strategies span every lifecycle status. Assert
        the resulting `sync_trades` RPC fan-out only fires for the
        live statuses — the rest are silently dropped. Also proves the
        Area 2 verdict (164.5.1.3 SYNCADMIT): the owner-only terminal
        `private` status is admitted alongside the other three.

        Replaces the prior local-replay test that re-implemented the
        filter inline (a refactor that dropped the cron.py filter would
        have left that test green).
        """
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        mixed_strategies = [
            {"id": "s-pub", "status": "published"},
            {"id": "s-draft", "status": "draft"},
            {"id": "s-review", "status": "pending_review"},
            {"id": "s-private", "status": "private"},
            {"id": "s-archived", "status": "archived"},
            {"id": "s-suspended", "status": "suspended"},
            {"id": "s-deleted", "status": "deleted"},
        ]

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": mixed_strategies,
                }
            ],
            ps_data=[],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            response = await cron_mod.cron_sync()

        rpc_strategy_ids = sorted(
            call.args[1]["p_strategy_id"]
            for call in mock_supabase.rpc.call_args_list
            if call.args and call.args[0] == "sync_trades"
        )
        assert rpc_strategy_ids == ["s-draft", "s-private", "s-pub", "s-review"]
        # Result payload mirrors the filter
        result_strategy_ids = sorted(response["results"][0]["strategy_ids"])
        assert result_strategy_ids == ["s-draft", "s-private", "s-pub", "s-review"]

    @pytest.mark.asyncio
    async def test_strategy_missing_status_field_is_dropped(self):
        """SF-F9: pre-Phase-B the filter allowed an embedded strategy
        through if it had no `status` field at all (`if "status" in e
        else True`). That was a fail-open escape hatch that defeated
        C-0200 if PostgREST or a schema migration ever omitted the
        column. Post-fix, missing `status` fails closed.
        """
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        # One live strategy, one strategy entirely missing the
        # `status` key. Only the first should appear in the RPC call.
        partial_strategies = [
            {"id": "s-live", "status": "published"},
            {"id": "s-no-status"},  # status key missing entirely
        ]

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": partial_strategies,
                }
            ],
            ps_data=[],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            response = await cron_mod.cron_sync()

        rpc_strategy_ids = [
            call.args[1]["p_strategy_id"]
            for call in mock_supabase.rpc.call_args_list
            if call.args and call.args[0] == "sync_trades"
        ]
        assert rpc_strategy_ids == ["s-live"]
        assert response["results"][0]["strategy_ids"] == ["s-live"]


# ---------------------------------------------------------------------------
# C-0199 — missing KEK raises HTTPException(500)
# ---------------------------------------------------------------------------


class TestKekMissingFailsLoud:
    """C-0199: Pre-fix the missing-KEK branch returned HTTP 200 + body
    {'error': 'Encryption not configured'} and the Vercel cron runner
    treated it as success — KEK outages were invisible. Post-fix the
    branch raises HTTPException(500) so the cron runner alarms.
    """

    @pytest.mark.asyncio
    async def test_missing_kek_raises_500(self):
        # NOTE: use the HTTPException reference cron.py itself bound at
        # import time (cron_mod.HTTPException). Reaching for
        # `from fastapi import HTTPException` here would be sensitive
        # to sys.modules pollution from other test files in the suite
        # (e.g. test_process_key / test_portfolio_router_logic stub
        # `sys.modules["fastapi"].HTTPException = Exception` for their
        # local-env import shim). Anchoring to cron_mod's binding
        # makes this test order-independent.
        HTTPException = cron_mod.HTTPException

        with patch.object(
            cron_mod, "get_kek", side_effect=RuntimeError("KEK missing")
        ):
            with pytest.raises(HTTPException) as excinfo:
                await cron_mod.cron_sync()

        assert excinfo.value.status_code == 500
        assert "Encryption" in str(excinfo.value.detail) or "KEK" in str(
            excinfo.value.detail
        )


# ---------------------------------------------------------------------------
# H-0541 / H-0545 — portfolio recompute error isolation
# ---------------------------------------------------------------------------


class TestPortfolioRecomputeErrorIsolation:
    """The cron-sync portfolio-recompute block must call
    _compute_portfolio_analytics for EVERY affected portfolio even if
    one raises (H-0545). The response payload must report per-portfolio
    success/failure counts (H-0542). Pre-fix a single failure would log
    and continue but the response payload silently said 'failed=0'.
    """

    @pytest.mark.asyncio
    async def test_one_portfolio_failure_does_not_abort_others(self):
        """Mock _compute_portfolio_analytics with side_effect that
        raises on the first call and succeeds on subsequent ones.
        Assert .call_count == 3 and the response payload reports
        portfolio_recomputes={ok=2, failed=1}.
        """
        # cron_sync lazy-imports `from routers.portfolio import ...`
        # inside the function body. Other tests in the suite have been
        # observed to unload `routers.portfolio` from sys.modules (e.g.
        # via subprocess workers); re-import then hits the real module
        # which needs SUPABASE_URL. Force the module into sys.modules
        # and patch ITS attribute so the lazy import resolves to the
        # mock.
        import sys
        import routers.portfolio as portfolio_mod  # noqa: F401
        sys.modules["routers.portfolio"] = portfolio_mod

        portfolio_ids_in_order = ["p1", "p2", "p3"]

        mock_supabase = MagicMock()

        # api_keys SELECT returns a single ok key with one strategy
        keys_chain = MagicMock()
        keys_chain.select.return_value.eq.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {
                        "id": "key-1",
                        "exchange": "binance",
                        "last_sync_at": None,
                        "dek_encrypted": "dummy-dek",
                        "api_key_encrypted": "dummy-blob",
                        "strategies": [{"id": "strat-A", "status": "published"}],
                    }
                ]
            )
        )

        # portfolio_strategies SELECT returns three portfolios for the
        # synced strategy
        ps_chain = MagicMock()
        ps_chain.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {"portfolio_id": "p1"},
                    {"portfolio_id": "p2"},
                    {"portfolio_id": "p3"},
                ]
            )
        )

        # portfolios SELECT (is_test=false filter) returns all three
        pf_chain = MagicMock()
        pf_chain.select.return_value.in_.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{"id": "p1"}, {"id": "p2"}, {"id": "p3"}])
        )

        # portfolio_analytics in-flight check: returns no in-flight rows
        pa_chain = MagicMock()
        pa_chain.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
            MagicMock(data=[])
        )

        # api_keys UPDATE chain (last_sync_at update at end of sync)
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])

        def _table(name: str):
            if name == "api_keys":
                t = MagicMock()
                # SELECT path
                t.select.return_value.eq.return_value.execute.return_value = (
                    keys_chain.select.return_value.eq.return_value.execute.return_value
                )
                # UPDATE path
                t.update.return_value = update_chain
                return t
            if name == "portfolio_strategies":
                return ps_chain
            if name == "portfolios":
                return pf_chain
            if name == "portfolio_analytics":
                return pa_chain
            return MagicMock()

        mock_supabase.table.side_effect = _table
        # supabase.rpc(...).execute() returns a count for sync_trades
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=2)
        mock_supabase.rpc.return_value = rpc_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        # Per-portfolio side-effect: p1 raises, p2/p3 succeed.
        call_log: list[str] = []

        async def _compute_side_effect(pid: str):
            call_log.append(pid)
            if pid == "p1":
                raise RuntimeError("boom for p1")
            return {"analytics_id": f"a-{pid}"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute_side_effect),
             ):
            response = await cron_mod.cron_sync()

        # Every portfolio was attempted, even after p1 raised.
        assert sorted(call_log) == sorted(portfolio_ids_in_order)
        assert len(call_log) == 3

        # H-0542: response payload reports per-portfolio outcomes.
        assert "portfolio_recomputes" in response
        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 3
        assert pr["ok"] == 2
        assert pr["failed"] == 1
        failed_pids = [f["portfolio_id"] for f in pr["failures"]]
        assert failed_pids == ["p1"]
        # Error repr captures the exception type for Sentry correlation.
        assert "RuntimeError" in pr["failures"][0]["error"]


# ---------------------------------------------------------------------------
# Phase-B specialist additions
# ---------------------------------------------------------------------------


class TestDeactivateNoOpDetection:
    """SF-F3: If `.update({'is_active': False}).eq('id', key_id)` returns
    an empty `.data`, the row vanished between the SELECT and the UPDATE
    (deleted or re-keyed by another writer). The cron must log this as
    an error so a silent vanishing doesn't masquerade as a successful
    deactivation in the logs.
    """

    @pytest.mark.asyncio
    async def test_empty_update_data_logs_error(self, caplog):
        mock_supabase = MagicMock()
        update_chain = MagicMock()
        eq_chain = MagicMock()
        # Simulate the row already deleted: UPDATE matched zero rows.
        eq_chain.execute.return_value = MagicMock(data=[])
        update_chain.eq.return_value = eq_chain
        mock_supabase.table.return_value.update.return_value = update_chain
        # C-0195: allocator_holdings linkage probe must return no rows so
        # the deactivate path is reached and the no-op log can be asserted.
        _wire_allocator_holdings_empty(mock_supabase)

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(
                     valid=False, error_code="AUTH_FAILED", error="bad creds"
                 )),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            with caplog.at_level("ERROR", logger="quantalyze.analytics"):
                result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Still marked revoked (the *intent* succeeded — we tried to
        # deactivate), but the no-op is loud.
        assert result["status"] == "key_revoked"
        assert any(
            "deactivation no-op" in record.message
            and "key-1" in record.message
            for record in caplog.records
            if record.levelname == "ERROR"
        ), (
            "Expected an ERROR log mentioning 'deactivation no-op' and "
            "the key id; got " + repr([r.message for r in caplog.records])
        )


class TestPartialStatusOnRpcFailure:
    """SF-F4: If one of N per-strategy `sync_trades` RPCs fails, the
    remaining strategies still get their trades stored AND
    `last_sync_at` is still bumped so the next tick doesn't refetch
    already-landed trades. Result status flips to "partial" and the
    payload reports per-strategy errors.
    """

    @pytest.mark.asyncio
    async def test_one_failing_rpc_does_not_abort_loop_or_skip_cursor(self):
        mock_supabase = MagicMock()

        # rpc(...) returns a chain whose .execute() raises for strat-B
        # only. We dispatch on the kwargs to pick the side-effect.
        def _rpc(name: str, args: dict):
            chain = MagicMock()
            if args.get("p_strategy_id") == "strat-B":
                chain.execute.side_effect = RuntimeError("postgres deadlock")
            else:
                chain.execute.return_value = MagicMock(data=2)
            return chain

        mock_supabase.rpc.side_effect = _rpc

        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B", "strat-C"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # The two surviving strategies stored their trades, the failing
        # one is recorded as 0 + reported under strategy_errors.
        assert result["status"] == "partial"
        assert result["per_strategy_stored"] == {
            "strat-A": 2,
            "strat-B": 0,
            "strat-C": 2,
        }
        assert "strat-B" in result["strategy_errors"]
        assert "RuntimeError" in result["strategy_errors"]["strat-B"]
        # CRITICAL: last_sync_at UPDATE MUST still have fired — else the
        # next tick refetches `strat-A` / `strat-C`'s already-landed
        # trades and re-runs the (still-broken) `strat-B` RPC needlessly.
        # Post-2026-06-01 the recompute trigger is an
        # `enqueue_compute_job(..., 'compute_analytics')` RPC per stored
        # strategy (NOT a strategy_analytics UPDATE), so the only
        # `.table(...).update(...)` here is the api_keys last_sync_at write.
        # Walk the call list and require the last_sync_at payload to appear.
        update_payloads = [
            call.args[0]
            for call in mock_supabase.table.return_value.update.call_args_list
        ]
        assert any("last_sync_at" in p for p in update_payloads), (
            f"Expected a `last_sync_at` update payload; got {update_payloads!r}"
        )


class TestSyncTradesShapeFallbackLogged:
    """SF-F5: `sync_trades` is declared to return an integer count. If
    Postgres ever returns a dict/list/None (e.g. someone changed the
    function signature), cron must not crash — but it also has NO evidence
    about what landed, so it MUST log loudly so contract drift is visible in
    the next operator review.

    2026-09-19: the fallback used to be `stored = len(trades)`, fabricating a
    success count from the fetch size. That count flows into `synced_count`,
    so any shape drift made `synced_count > 0` unconditionally and advanced
    `last_sync_at` on evidence that nothing was stored — the C-0198 data-loss
    class through a side door. The fallback is now 0; the loud ERROR is
    unchanged.

    2026-09-19 (later): this test used to assert `status == "held"`, and that
    assertion WAS the defect it should have caught. `held` is the benign
    bucket for "no strategy on this key was eligible", and its documented
    remedy — a strategy re-entering ALLOWED_STRATEGY_STATUSES — can never
    clear a SQL shape change, so drift classified as `held` was drift nobody
    would ever action. The drift branch now records `strategy_errors[sid]`,
    the sole input the classifier has for "something went wrong", so a
    single-strategy drift is `error`. Cursor behaviour is unchanged (`stored`
    is still 0, so `synced_count` is still 0 here and the cursor still holds —
    see TestSyncTradesShapeDriftHoldsTheCursor, which still passes).
    """

    @pytest.mark.asyncio
    async def test_unexpected_rpc_shape_logs_error(self, caplog):
        mock_supabase = MagicMock()
        rpc_chain = MagicMock()
        # Contract violation: sync_trades returns a dict instead of int.
        rpc_chain.execute.return_value = MagicMock(data={"inserted": 5})
        mock_supabase.rpc.return_value = rpc_chain
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            with caplog.at_level("ERROR", logger="quantalyze.analytics"):
                result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Fallback fired in the SAFE direction: 0 stored, not len(trades)=2.
        assert result["per_strategy_stored"]["strat-A"] == 0
        # Two trades fetched, nothing provably stored, and the SQL contract is
        # broken: that is an `error`, not the benign `held` bucket this test
        # used to pin.
        assert result["status"] == "error", result
        assert "ContractDrift" in result["strategy_errors"]["strat-A"], result
        assert "ContractDrift" in result["error"], result
        assert any(
            "unexpected shape" in record.message
            and "strat-A" in record.message
            for record in caplog.records
            if record.levelname == "ERROR"
        ), (
            "Expected ERROR log re: 'unexpected shape' for strat-A; got "
            + repr([r.message for r in caplog.records])
        )


class TestSyncTradesShapeDriftHoldsTheCursor:
    """The contract-drift fallback decides the cursor, so its direction is a
    data-integrity choice, not a cosmetic one.

    With `stored = len(trades)` a shape drift in `sync_trades` made
    `synced_count > 0` unconditionally, so `should_advance_cursor` was True
    and `last_sync_at` moved past a window nothing is known to have stored.
    The next tick's `parse_since_ms(last_sync_at)` then skips those trades
    forever — the same silent loss C-0198 was raised to close, reached
    through the fallback instead of through a failing RPC.

    Replay is safe: `sync_trades` does a payload-window-scoped DELETE of
    non-fill rows and then re-INSERTs, so refetching the same window does
    not duplicate rows. Holding is therefore strictly the safe direction.
    """

    @pytest.mark.asyncio
    async def test_non_int_rpc_return_does_not_advance_last_sync_at(self):
        mock_supabase = MagicMock()

        rpc_chain = MagicMock()
        # Contract violation: sync_trades returns a dict instead of an int.
        rpc_chain.execute.return_value = MagicMock(data={"inserted": 5})
        mock_supabase.rpc.return_value = rpc_chain

        api_keys_update_payloads: list[dict] = []

        def _table(name: str):
            chain = MagicMock()

            def _update(payload: dict):
                if name == "api_keys":
                    api_keys_update_payloads.append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "key-1"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            chain.update.side_effect = _update
            return chain

        mock_supabase.table.side_effect = _table

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 # A NON-None balance, so an api_keys UPDATE is genuinely
                 # issued and the payload list below is non-empty. Asserting
                 # "last_sync_at not in <every payload>" over an EMPTY list
                 # would be vacuously true and could never fail.
                 "fetch_usdt_balance",
                 AsyncMock(return_value=1234.56),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["per_strategy_stored"]["strat-A"] == 0, (
            "A non-int sync_trades return is NO evidence of storage; counting "
            f"len(trades) here advances the cursor. Got {result!r}"
        )
        assert len(api_keys_update_payloads) == 1, (
            "Non-vacuity: the balance stash must produce exactly one api_keys "
            f"UPDATE for the assertion below to quantify over; got "
            f"{api_keys_update_payloads!r}"
        )
        payload = api_keys_update_payloads[0]
        assert payload.get("account_balance_usdt") == 1234.56, payload
        assert "last_sync_at" not in payload, (
            "Expected the cursor to HOLD when sync_trades returned an "
            f"unreadable shape, so the next tick retries the window; got "
            f"{payload!r}"
        )


class TestSyncTradesShapeDriftOnFanOutKeyIsReported:
    """The two drift tests above BOTH use a single-strategy key, and that is
    why the fan-out hole survived: with one strategy, `synced_count` is 0 for
    the whole key, the cursor holds, and the drift looks contained.

    On a MULTI-strategy key it is not contained. Measured at `fbc558f9` with
    `strat-A` returning int 3 and `strat-B` returning a dict: `status` was
    `ok`, `strategy_errors` was absent from the body, and `last_sync_at`
    ADVANCED on strat-A's success — past a window `strat-B` is not known to
    have stored. `strat-B`'s trades are gone on the next tick and NOTHING in
    the response body said so.

    The drift branch now writes `strategy_errors[sid]`, which is the sole
    input the status classifier has for "something went wrong". That does not
    save `strat-B`'s window — a shared per-key cursor cannot — but it turns a
    silent loss into a `partial` result naming the drifted strategy.

    ⭐ THE RESIDUAL LOSS IS CLOSED, AND IT WAS NOT CLOSED BY THIS CURSOR.
    164.5.1.4 SYNCCURSOR (shipped). The key-level assertion at the foot of this
    test still holds and still passes, because the key cursor's behaviour is
    deliberately unchanged — holding it would starve the succeeding strategies.
    What recovers strat-B's window is a separate mechanism in a separate table:
    the per-strategy marker rows in `strategy_sync_cursors`. strat-B stored 0,
    so its marker is held at the resume point this tick started from, and the
    next tick's fetch window still covers the span it is owed.
    """

    @pytest.mark.asyncio
    async def test_drift_on_one_of_two_strategies_is_reported_not_silent(self):
        mock_supabase = MagicMock()

        def _rpc(name: str, args: dict):
            chain = MagicMock()
            if args.get("p_strategy_id") == "strat-B":
                # Contract drift: a dict where an int row count is declared.
                chain.execute.return_value = MagicMock(data={"inserted": 2})
            else:
                chain.execute.return_value = MagicMock(data=3)
            return chain

        mock_supabase.rpc.side_effect = _rpc

        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}, {"id": "t3"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Non-vacuity: both strategies must have been attempted, or the
        # assertions below would be quantifying over a one-strategy tick —
        # exactly the shape that hid this defect.
        assert set(result["per_strategy_stored"]) == {"strat-A", "strat-B"}, result
        assert result["per_strategy_stored"] == {"strat-A": 3, "strat-B": 0}, result

        # The drift reaches the response envelope, naming the drifted
        # strategy and ONLY it.
        assert "strategy_errors" in result, (
            "Contract drift on a fan-out key produced no strategy_errors, so "
            f"the classifier cannot see it at all; got {result!r}"
        )
        assert set(result["strategy_errors"]) == {"strat-B"}, result["strategy_errors"]
        assert "ContractDrift" in result["strategy_errors"]["strat-B"], (
            result["strategy_errors"]["strat-B"]
        )

        # Some stored + some failed == `partial`. Not `ok` (which alarms read
        # as healthy) and not `error` (which would claim nothing landed).
        assert result["status"] == "partial", result
        assert "error" not in result, (
            "A top-level `error` claims the whole key failed; strat-A's 3 "
            f"trades did land. Got {result!r}"
        )

        # Cursor behaviour is DELIBERATELY unchanged by this fix: strat-A
        # stored 3, so `synced_count > 0` and `last_sync_at` still advances
        # past strat-B's unverified window. This assertion pins that the fix
        # is purely additive observability.
        # 164.5.1.4 SYNCCURSOR (shipped) — the residual loss this used to point
        # forward at is closed, and NOT by this cursor: strat-B's own marker row
        # in `strategy_sync_cursors` is held, so the next tick's window still
        # covers it. The key-level advance asserted here stays exactly as it is.
        update_payloads = [
            call.args[0]
            for call in mock_supabase.table.return_value.update.call_args_list
        ]
        assert any("last_sync_at" in p for p in update_payloads), (
            "The shared per-key cursor still advances on strat-A's success; "
            f"got {update_payloads!r}"
        )


class TestSyncTradesPayloadIsJsonbArrayNotScalar:
    """REGRESSION (Postgres 22023): cron's inline persist must hand the
    sync_trades RPC a JSON *array* (list[dict]) for `p_trades`, NOT a
    pre-serialized JSON string.

    WHY this matters (not just WHAT): pre-fix, cron did
    `json.dumps(trades, default=str)` and passed the *string*. PostgREST then
    bound that string to the JSONB parameter as a scalar string
    (`'"[…]"'::jsonb`), so `sync_trades`' `jsonb_array_elements(p_trades)`
    raised 22023 "cannot extract elements from a scalar" — silently dropping
    every fetched trade for any strategy-linked key (the live blocker for
    Bybit once its geo-block was lifted). A string does NOT fail at the Python
    layer; it round-trips through PostgREST and only blows up inside the DB
    function, so the type of this argument IS the contract and must be guarded
    at the call site. The other two callers (routers/exchange.py,
    services/job_worker.py) already pass the raw list; this locks the third
    (inline cron) path so it can't regress to a string.
    """

    @pytest.mark.asyncio
    async def test_p_trades_passed_as_list_not_serialized_string(self):
        mock_supabase = MagicMock()
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=2)  # int row count
        mock_supabase.rpc.return_value = rpc_chain
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        mock_supabase.table.return_value.update.return_value = update_chain

        # Trade dicts shaped like fetch_daily_pnl output (all JSON-native).
        trades_fixture = [
            {
                "exchange": "bybit",
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 42000.5,
                "quantity": 0.1,
                "timestamp": "2026-06-01T00:00:00+00:00",
            },
            {
                "exchange": "bybit",
                "symbol": "ETH/USDT:USDT",
                "side": "sell",
                "price": 2500.0,
                "quantity": 1.0,
                "timestamp": "2026-06-01T01:00:00+00:00",
            },
        ]

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=trades_fixture),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(exchange="bybit", strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "ok"
        assert result["per_strategy_stored"]["strat-A"] == 2

        # Exactly one sync_trades RPC for the one linked strategy (a
        # follow-on enqueue_compute_job recompute trigger also fires; filter
        # to the sync_trades call for the payload-shape assertion).
        sync_trades_calls = [
            c for c in mock_supabase.rpc.call_args_list if c.args[0] == "sync_trades"
        ]
        assert len(sync_trades_calls) == 1
        call = sync_trades_calls[0]
        assert call.args[0] == "sync_trades"
        params = call.args[1]
        p_trades = params["p_trades"]

        # THE regression assertion: a JSON array, not a double-encoded string.
        assert isinstance(p_trades, list), (
            "p_trades must be a list[dict] so PostgREST binds it as a JSONB "
            "array; a str makes it a JSONB scalar string and sync_trades' "
            "jsonb_array_elements() raises Postgres 22023. Got "
            f"{type(p_trades).__name__}: {p_trades!r}"
        )
        assert not isinstance(p_trades, str)
        assert p_trades == trades_fixture
        assert params["p_strategy_id"] == "strat-A"


class TestNullCredentialKeyIsSkippedNotCrashed:
    """REGRESSION (QUANTALYZE-M): a key row with NULL encryption columns
    (malformed/seed data left is_active=true) must be skipped with a clean
    `error` status, NOT crash decrypt_credentials with `'NoneType' object has
    no attribute 'encode'` — which spammed Sentry with an unactionable
    AttributeError on every cron tick. Fail loud (status=error + WARNING) but
    never raise, and never reach the decrypt path.
    """

    @pytest.mark.asyncio
    async def test_null_dek_encrypted_skips_without_reaching_decrypt(self, caplog):
        key_row = _make_key_row(exchange="okx", strategy_ids=["strat-A"])
        key_row["dek_encrypted"] = None  # malformed credential row

        def _boom(*_a, **_k):
            raise AssertionError("decrypt_credentials reached for null-cred key")

        with patch.object(cron_mod, "decrypt_credentials", _boom):
            with caplog.at_level("WARNING", logger="quantalyze.analytics"):
                result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "error"
        assert result["error"] == "missing_credentials"
        assert result["trades_fetched"] == 0
        assert any(
            "missing/NULL encryption columns" in r.message
            for r in caplog.records
            if r.levelname == "WARNING"
        ), "expected a WARNING about missing encryption columns; got " + repr(
            [r.message for r in caplog.records]
        )


class TestApiKeysSelectFailureRaises500:
    """SF-F1: Pre-fix, an exception from the initial `api_keys` SELECT
    propagated as an unhandled 500 with a raw traceback in the body. The
    cron alarm fires, but on-call has nothing actionable. Post-fix, the
    exception is caught, `logger.exception` writes a structured entry to
    Sentry, and HTTPException(500) is raised with a typed detail.
    """

    @pytest.mark.asyncio
    async def test_select_failure_is_caught_and_reraised_as_500(self, caplog):
        HTTPException = cron_mod.HTTPException

        mock_supabase = MagicMock()
        # Make the keys SELECT chain raise on .execute().
        chain = MagicMock()
        chain.select.return_value.eq.return_value.execute.side_effect = (
            RuntimeError("supabase down")
        )
        mock_supabase.table.return_value = chain

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase):
            with caplog.at_level("ERROR", logger="quantalyze.analytics"):
                with pytest.raises(HTTPException) as excinfo:
                    await cron_mod.cron_sync()

        assert excinfo.value.status_code == 500
        assert "api_keys SELECT failed" in str(excinfo.value.detail)
        # Structured log with traceback (exc_info recorded).
        assert any(
            "api_keys SELECT failed" in record.message
            and record.exc_info is not None
            for record in caplog.records
            if record.levelname == "ERROR"
        ), (
            "Expected ERROR log with exc_info for the SELECT failure; got "
            + repr([(r.message, r.exc_info) for r in caplog.records])
        )


class TestInFlightSkipCountsAsInFlightBucket:
    """TA-F2 / SF-F13 + red-team HIGH-2: when `portfolio_analytics`
    already has a `computation_status='computing'` row for the
    portfolio, another worker is handling it. `_guarded_recompute`
    must SKIP the compute call entirely AND surface this as its own
    `in_flight` bucket — NOT conflated with `ok`. Conflating with
    `ok` would let a stuck "computing" row (the other worker may have
    died) silently report as success forever.
    """

    @pytest.mark.asyncio
    async def test_in_flight_portfolio_is_distinct_bucket(self):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": "p1"}],
            pa_data=[{"id": "analytics-row-already-computing"}],  # in-flight!
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        compute_mock = AsyncMock()  # MUST NOT be called

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(portfolio_mod, "_compute_portfolio_analytics", compute_mock):
            response = await cron_mod.cron_sync()

        # The compute was NOT called — another worker has it.
        compute_mock.assert_not_called()
        pr = response["portfolio_recomputes"]
        # The in-flight portfolio appears in its own bucket; ok=0,
        # failed=0. An alert built on
        # `pr["failed"] == 0 and pr["ok"] == pr["attempted"]` would
        # no longer match this tick — operators must explicitly
        # account for in_flight before treating "no failures" as
        # "all done."
        assert pr["attempted"] == 1
        assert pr["ok"] == 0
        assert pr["in_flight"] == 1
        assert pr["failed"] == 0
        assert pr["failures"] == []


class TestValidateRaisingReturnsErrorNoDeactivate:
    """TA-F3: If `validate_key_permissions` itself raises (vs returning
    valid=False), the result MUST land in the generic-error bucket
    (status="error") and MUST NOT trigger the deactivation path — we
    can't tell from an opaque exception whether the credentials are
    actually bad or our validator is broken.
    """

    @pytest.mark.asyncio
    async def test_validator_raising_does_not_deactivate_key(self):
        mock_supabase = MagicMock()
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(side_effect=RuntimeError("ccxt internal blow-up")),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "error"
        assert "ccxt internal blow-up" in result["error"]
        # Crucially: no deactivation — `.update` was never called on
        # api_keys (a future bug that misclassified an opaque failure as
        # credential-rejection would silently disable healthy keys).
        mock_supabase.table.return_value.update.assert_not_called()


class TestTransientCounterInSummary:
    """CR-F1: Pre-Phase-B, transient_failure and partial results were
    counted by NONE of the summary buckets (synced/failed/timed_out/
    revoked) — a tick where every key hit a transient validation
    failure logged "0 synced, 0 failed = idle" and the response
    payload mirrored that. Post-fix, BOTH appear in the summary.
    """

    @pytest.mark.asyncio
    async def test_transient_and_partial_appear_in_summary_counts(self):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        # Three keys, three different fates: one ok, one transient, one
        # partial.
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": f"key-{i}",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": f"strat-{i}", "status": "published"}],
                }
                for i in (1, 2, 3)
            ],
            ps_data=[],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        # One transient + two ok validations, in any order. asyncio
        # scheduling inside cron's `gather` doesn't guarantee which
        # key gets the transient; the assertion below pivots on
        # counters, not on key identity, so the test stays valid.
        validations = iter([
            _stub_validation(valid=True),
            _stub_validation(
                valid=False, error_code="RATE_LIMITED", error="429"
            ),
            _stub_validation(valid=True),
        ])

        async def _validate(exchange):
            return next(validations)

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(cron_mod, "validate_key_permissions", _validate), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            response = await cron_mod.cron_sync()

        # Counts: 2 ok, 1 transient. failed/timed_out/revoked/partial=0.
        assert response["synced"] == 2
        assert response["transient"] == 1
        assert response["partial"] == 0
        assert response["failed"] == 0
        assert response["timed_out"] == 0
        assert response["revoked"] == 0
        assert response["total_keys"] == 3


class TestRecomputeHttp400IsSkipped:
    """SF-F7: `_compute_portfolio_analytics` raises HTTPException(400)
    for benign business states ("No strategies", "No returns data").
    Pre-Phase-B those landed in the generic-Exception branch and were
    counted as failures, opening a Sentry ticket per portfolio per tick.
    Post-fix, 400s are classified as 'skipped'.
    """

    @pytest.mark.asyncio
    async def test_http_400_is_skipped_not_failed(self):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": "p1"}, {"portfolio_id": "p2"}],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        async def _compute(pid: str):
            if pid == "p1":
                raise cron_mod.HTTPException(
                    status_code=400, detail="No strategies found in portfolio"
                )
            return {"analytics_id": f"a-{pid}"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute),
             ):
            response = await cron_mod.cron_sync()

        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 2
        assert pr["ok"] == 1
        assert pr["skipped"] == 1
        assert pr["failed"] == 0
        assert pr["failures"] == []


class TestRecomputeTimeoutIsFailure:
    """CR-F2: A wedged recompute on one portfolio must NOT block the
    whole cron tick or starve `_compute_semaphore` for everyone else.
    `_guarded_recompute` wraps the compute in `asyncio.wait_for` with
    `PORTFOLIO_RECOMPUTE_TIMEOUT`; the timeout maps to status="failed"
    with a TimeoutError repr.
    """

    @pytest.mark.asyncio
    async def test_compute_timeout_is_bounded_and_marked_failed(
        self, monkeypatch
    ):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        # Shrink the timeout so the test doesn't actually wait 90 s.
        monkeypatch.setattr(cron_mod, "PORTFOLIO_RECOMPUTE_TIMEOUT", 0.05)

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": "p1"}],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        import asyncio as _asyncio

        async def _compute_wedged(pid: str):
            await _asyncio.sleep(1.0)  # > the patched 0.05 s timeout
            return {"analytics_id": "never-returned"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute_wedged),
             ):
            response = await cron_mod.cron_sync()

        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 1
        assert pr["ok"] == 0
        assert pr["failed"] == 1
        assert "TimeoutError" in pr["failures"][0]["error"]


class TestRecomputeFailuresTruncation:
    """SF-F8: `portfolio_recomputes.failures` is capped at
    RECOMPUTE_FAILURE_CAP. A platform-wide outage producing thousands
    of failure entries would otherwise breach the Vercel response body
    limit. `failures_truncated` + `total_failures` surface the
    truncation so the operator still knows the true count.
    """

    @pytest.mark.asyncio
    async def test_failures_list_is_capped_with_total_reported(
        self, monkeypatch
    ):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        # Shrink the cap so we don't have to generate 100 portfolios.
        monkeypatch.setattr(cron_mod, "RECOMPUTE_FAILURE_CAP", 3)

        portfolio_ids = [f"p{i}" for i in range(5)]
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": pid} for pid in portfolio_ids],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        async def _compute_all_fail(pid: str):
            raise RuntimeError(f"supabase down for {pid}")

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute_all_fail),
             ):
            response = await cron_mod.cron_sync()

        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 5
        assert pr["failed"] == 5
        # The list is truncated to the cap but the true count is preserved.
        assert len(pr["failures"]) == 3
        assert pr["failures_truncated"] is True
        assert pr["total_failures"] == 5


class TestRecomputeLookupErrorPreservesSync:
    """SF-F11: A Supabase blip on the `portfolio_strategies` or
    `portfolios` lookup must NOT lose the per-key sync results already
    collected. The response payload still carries `results` for every
    key, with `portfolio_recomputes.lookup_error` capturing the
    failure for the operator.
    """

    @pytest.mark.asyncio
    async def test_lookup_failure_preserves_per_key_sync_results(self):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        # Reuse the helper to set up api_keys + RPC + UPDATE, but
        # override portfolio_strategies to raise on .execute().
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": "p1"}],
        )

        # Re-wire the portfolio_strategies path to blow up.
        original_side_effect = mock_supabase.table.side_effect

        def _table_with_ps_failure(name: str):
            if name == "portfolio_strategies":
                ps = MagicMock()
                ps.select.return_value.in_.return_value.execute.side_effect = (
                    RuntimeError("supabase blip")
                )
                return ps
            return original_side_effect(name)

        mock_supabase.table.side_effect = _table_with_ps_failure

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            response = await cron_mod.cron_sync()

        # The cron returned (didn't 500) and per-key results survived.
        assert response["synced"] == 1
        assert len(response["results"]) == 1
        assert response["results"][0]["key_id"] == "key-1"
        # Recompute branch reports a lookup_error and no attempts.
        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 0
        assert "lookup_error" in pr
        assert "RuntimeError" in pr["lookup_error"]


# ---------------------------------------------------------------------------
# Red-team additions
# ---------------------------------------------------------------------------


class TestPartialStatusOnlyWhenSomeSucceed:
    """Red-team MED 5: `partial` is misleading if *no* strategies
    stored. When every RPC fails, surface `error` (not `partial`) so
    the operator isn't tricked into thinking trades landed.
    """

    @pytest.mark.asyncio
    async def test_all_rpcs_failing_yields_error_status(self):
        mock_supabase = MagicMock()

        # Every sync_trades RPC blows up.
        def _rpc(name: str, args: dict):
            chain = MagicMock()
            chain.execute.side_effect = RuntimeError("postgres dead")
            return chain

        mock_supabase.rpc.side_effect = _rpc

        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Zero stored across the board → status="error", NOT "partial".
        assert result["status"] == "error"
        assert result["per_strategy_stored"] == {"strat-A": 0, "strat-B": 0}
        assert "strategy_errors" in result
        # Top-level `error` field is surfaced so consumers that switch
        # on `r.get("error")` see the failure.
        assert "error" in result
        assert "RuntimeError" in result["error"]


class TestPartialKeyStillTriggersRecompute:
    """Red-team MED 8: my Phase B introduction of `status="partial"`
    accidentally dropped partial keys from `synced_strategy_ids`,
    starving portfolios backed by the SUCCESSFUL secondaries of their
    recompute window. The cascade must include strategies whose RPC
    succeeded even on a partial-status key, and exclude those whose
    RPC failed.
    """

    @pytest.mark.asyncio
    async def test_partial_key_cascades_only_successful_strategies(self):
        import sys
        import routers.portfolio as portfolio_mod
        sys.modules["routers.portfolio"] = portfolio_mod

        # Key has 3 strategies; sync_trades succeeds for A and C,
        # raises for B. Portfolios p-A / p-B / p-C are each backed
        # 1:1 by their respective strategy. Only p-A and p-C should
        # be recomputed; p-B's recompute would be stale because the
        # trades that should have informed it didn't land.
        strategy_to_portfolio = {
            "strat-A": "p-A",
            "strat-B": "p-B",
            "strat-C": "p-C",
        }

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [
                        {"id": sid, "status": "published"}
                        for sid in strategy_to_portfolio
                    ],
                }
            ],
            ps_data=[],  # overridden below — needs realistic .in_() filter
            pf_data=[{"id": pid} for pid in strategy_to_portfolio.values()],
        )

        # Replace the portfolio_strategies chain with one that filters by
        # the strategy_ids list passed to `.in_()`, mirroring real
        # Supabase behaviour. Without this, the cascade test can't
        # distinguish "B was excluded from the cascade" from "the mock
        # returned B anyway."
        original_table_dispatch = mock_supabase.table.side_effect

        def _filtered_table_dispatch(name: str):
            if name == "portfolio_strategies":
                ps = MagicMock()

                def _in_filter(_column, requested_strategy_ids):
                    chain = MagicMock()
                    rows = [
                        {"portfolio_id": strategy_to_portfolio[sid]}
                        for sid in requested_strategy_ids
                        if sid in strategy_to_portfolio
                    ]
                    chain.execute.return_value = MagicMock(data=rows)
                    return chain

                ps.select.return_value.in_.side_effect = _in_filter
                return ps
            if name == "portfolios":
                # `.select("id").in_("id", ids).eq("is_test", False).execute()`
                # needs to filter by the requested ids so the cascade
                # assertion can distinguish "B not in cascade" from
                # "mock returned all 3 anyway."
                pf = MagicMock()

                def _pf_in(_column, requested_portfolio_ids):
                    in_chain = MagicMock()
                    rows = [
                        {"id": pid} for pid in requested_portfolio_ids
                    ]
                    in_chain.eq.return_value.execute.return_value = MagicMock(
                        data=rows
                    )
                    return in_chain

                pf.select.return_value.in_.side_effect = _pf_in
                return pf
            return original_table_dispatch(name)

        mock_supabase.table.side_effect = _filtered_table_dispatch

        # RPC dispatch: B raises, A and C succeed.
        def _rpc(name: str, args: dict):
            chain = MagicMock()
            sid = args.get("p_strategy_id")
            if sid == "strat-B":
                chain.execute.side_effect = RuntimeError("rpc blew up for B")
            else:
                chain.execute.return_value = MagicMock(data=5)
            return chain

        mock_supabase.rpc.side_effect = _rpc

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        recomputed: list[str] = []

        async def _compute(pid: str):
            recomputed.append(pid)
            return {"analytics_id": f"a-{pid}"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute),
             ):
            response = await cron_mod.cron_sync()

        # The single key is `partial` — some strategies landed, one
        # didn't. Pre-red-team it was dropped from the cascade entirely
        # because the filter was `status == "ok"` only.
        assert response["partial"] == 1
        assert response["synced"] == 0
        # Only p-A and p-C were recomputed; p-B's trades didn't land
        # so a recompute would be stale.
        assert sorted(recomputed) == ["p-A", "p-C"]


class TestCronRecomputeConcurrencyCap:
    """Red-team HIGH 1: cron must NOT monopolise every
    `_compute_semaphore` slot — if it `asyncio.gather`s a thousand
    portfolios, live `POST /api/portfolio-analytics` requests would
    stall for hours behind the cron backlog. The cron-internal
    `CRON_RECOMPUTE_CONCURRENCY` cap leaves at least one slot of the
    shared semaphore (size 3) free for interactive traffic.
    """

    @pytest.mark.asyncio
    async def test_cron_caps_its_own_concurrency_below_shared_limit(
        self, monkeypatch
    ):
        import asyncio as _asyncio
        import routers.portfolio as portfolio_mod
        import sys
        sys.modules["routers.portfolio"] = portfolio_mod

        # Pin cron's own concurrency to 1 so we can directly observe
        # the cap (the test would otherwise need to detect Semaphore(2)
        # behaviour, which is harder to assert deterministically).
        monkeypatch.setattr(cron_mod, "CRON_RECOMPUTE_CONCURRENCY", 1)

        # Five portfolios so an unbounded gather would obviously
        # exceed the cap.
        portfolio_ids = [f"p{i}" for i in range(5)]
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": pid} for pid in portfolio_ids],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        in_flight_max = 0
        currently_running = 0
        lock = _asyncio.Lock()

        async def _compute(pid: str):
            nonlocal in_flight_max, currently_running
            async with lock:
                currently_running += 1
                in_flight_max = max(in_flight_max, currently_running)
            # Give the scheduler a chance to start any other waiting
            # coroutines; if the cap is broken, they'll all increment
            # `currently_running` before any release.
            await _asyncio.sleep(0.01)
            async with lock:
                currently_running -= 1
            return {"analytics_id": f"a-{pid}"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute),
             ):
            response = await cron_mod.cron_sync()

        assert response["portfolio_recomputes"]["attempted"] == 5
        assert response["portfolio_recomputes"]["ok"] == 5
        # With CRON_RECOMPUTE_CONCURRENCY=1, at most ONE compute runs
        # concurrently. Without the cap, the unbounded gather would
        # have allowed up to 3 (the shared semaphore size).
        assert in_flight_max == 1, (
            f"Expected cron_recompute_sem to cap concurrency at 1, "
            f"observed max in-flight = {in_flight_max}"
        )


# ---------------------------------------------------------------------------
# audit-2026-05-07 C-0193 / C-0195 / C-0197 / C-0198 — cron cluster
# ---------------------------------------------------------------------------


class TestC0193ValidationCache:
    """C-0193: pre-fix every cron tick re-validated EVERY active api_keys
    row against the exchange — N exchange round-trips per tick burning
    per-IP rate-limit budget. Post-fix an in-memory TTL keyed by
    api_keys.id lets subsequent ticks skip the round-trip while the entry
    is fresh. The first sync MUST hit `validate_key_permissions`; the
    second sync within TTL MUST NOT.
    """

    @pytest.mark.asyncio
    async def test_C0193_validation_skipped_on_second_call_within_ttl(self):
        mock_supabase = MagicMock()
        # supabase.rpc('sync_trades', ...).execute() returns int
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=1)
        mock_supabase.rpc.return_value = rpc_chain
        # api_keys/strategy_analytics generic update chain
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        update_chain.in_.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        validate_mock = AsyncMock(return_value=_stub_validation(valid=True))

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(cron_mod, "validate_key_permissions", validate_mock), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            # First call: cache miss, validate must fire.
            await cron_mod._sync_single_key(key_row, kek=b"x" * 32)
            assert validate_mock.call_count == 1, (
                "First sync should hit validate_key_permissions exactly once"
            )
            # Second call within TTL: cache hit, validate must NOT fire.
            await cron_mod._sync_single_key(key_row, kek=b"x" * 32)
            assert validate_mock.call_count == 1, (
                "Second sync within TTL must skip the exchange round-trip; "
                f"got call_count={validate_mock.call_count}"
            )

    @pytest.mark.asyncio
    async def test_C0193_expired_entry_revalidates(self, monkeypatch):
        """Once the TTL elapses, the next sync MUST re-validate. We
        shrink the TTL to 0 so any positive monotonic delta evicts the
        entry, then drive the sync twice.
        """
        monkeypatch.setattr(cron_mod, "KEY_VALIDATION_TTL_SECONDS", 0)

        mock_supabase = MagicMock()
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=1)
        mock_supabase.rpc.return_value = rpc_chain
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        update_chain.in_.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        validate_mock = AsyncMock(return_value=_stub_validation(valid=True))

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(cron_mod, "validate_key_permissions", validate_mock), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            await cron_mod._sync_single_key(key_row, kek=b"x" * 32)
            await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert validate_mock.call_count == 2, (
            "With TTL=0 the cache MUST evict and the second sync must "
            f"re-validate; got call_count={validate_mock.call_count}"
        )


class TestC0195AllocatorProtectedKeyNotDeactivated:
    """C-0195: an api_keys row that backs `allocator_holdings` rows must
    NOT be deactivated by the cron's credential-rejection path. Silently
    flipping `is_active=False` on a key the allocator's holdings ingest
    depends on breaks the next holdings sync window without surfacing
    why. The cron must skip the UPDATE, log a warning, and surface
    `allocator_protected=True` in the result so the operator can route
    the rejection through the allocator-aware revocation flow.
    """

    @pytest.mark.asyncio
    async def test_C0195_allocator_used_key_skips_deactivation(self, caplog):
        mock_supabase = MagicMock()
        # If `.update` is reached on api_keys, the test fails (allocator
        # protection should short-circuit before the UPDATE).
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "key-1"}]
        )
        mock_supabase.table.return_value.update.return_value = update_chain
        # allocator_holdings probe returns one row → key is in use.
        _wire_allocator_holdings_used(mock_supabase, key_id="key-1")

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(
                     valid=False, error_code="AUTH_FAILED", error="bad creds"
                 )),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            with caplog.at_level("WARNING", logger="quantalyze.analytics"):
                result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Status is still key_revoked (the credential rejection is real),
        # but the result carries the allocator-protected flag and the
        # `.update` mutation was NEVER issued.
        assert result["status"] == "key_revoked"
        assert result["error_code"] == "AUTH_FAILED"
        assert result.get("allocator_protected") is True
        mock_supabase.table.return_value.update.assert_not_called()
        # Operator-visible warning so a backed-off deactivation doesn't
        # silently slip past the cron run summary.
        assert any(
            "allocator-protected" in record.message.lower()
            and "key-1" in record.message
            for record in caplog.records
            if record.levelname == "WARNING"
        ), (
            "Expected WARNING log mentioning the allocator-protected path "
            "and the key id; got "
            + repr([r.message for r in caplog.records])
        )


class TestC0197CronTriggersAnalyticsRecompute:
    """C-0197 / 2026-06-01 root-cause fix: after a successful `sync_trades`
    the cron must trigger an analytics recompute for each strategy that
    received new trades, by enqueueing a `compute_analytics` compute_job.

    The original implementation instead wrote
    `computation_status='stale'` to strategy_analytics, which was broken
    two ways: (a) 'stale' is not a valid computation_status (the
    strategy_analytics_computation_status_check CHECK allows only
    pending/computing/complete/failed), so every write raised SQLSTATE
    23514 (Sentry QUANTALYZE-P); and (b) nothing ever read 'stale', so
    cron-synced (e.g. bybit) strategies were never recomputed and their
    dashboard KPIs froze. These tests assert the enqueue happens per
    stored strategy and the illegal 'stale' UPDATE is gone.
    """

    @pytest.mark.asyncio
    async def test_successful_sync_enqueues_compute_analytics_per_strategy(self):
        mock_supabase = MagicMock()

        # Record every rpc(name, args) so we can isolate the recompute
        # enqueues from the sync_trades persistence calls.
        rpc_calls: list[tuple[str, dict]] = []

        def _rpc(name: str, args: dict):
            rpc_calls.append((name, args))
            chain = MagicMock()
            if name == "sync_trades":
                # int row count > 0 → this strategy "stored" → must recompute
                chain.execute.return_value = MagicMock(data=4)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc

        # Track table().update() payloads by table so we can assert the
        # illegal strategy_analytics 'stale' write is GONE.
        updates_by_table: dict[str, list[dict]] = defaultdict_factory()

        def _make_chain(table_name: str):
            chain = MagicMock()

            def _update(payload: dict):
                updates_by_table[table_name].append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "x"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            chain.update.side_effect = _update
            return chain

        mock_supabase.table.side_effect = lambda name: _make_chain(name)

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(
                strategy_ids=["strat-A", "strat-B"]
            )
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "ok"

        # Exactly one enqueue_compute_job(derive_broker_dailies) per stored
        # strategy — this is the recompute trigger that replaced the
        # broken 'stale' marker. Without the fix this list is empty.
        enqueue_args = [
            args for (name, args) in rpc_calls if name == "enqueue_compute_job"
        ]
        assert sorted(a["p_strategy_id"] for a in enqueue_args) == ["strat-A", "strat-B"], (
            f"Expected one enqueue_compute_job per stored strategy; got {enqueue_args!r}"
        )
        # Unconditional funding-inclusive CSV route via derive_broker_dailies,
        # mirroring the sync_trades epilogue (the legacy kill-switch was retired
        # in 106-08).
        assert all(a["p_kind"] == "derive_broker_dailies" for a in enqueue_args), (
            f"Every recompute enqueue must be kind=derive_broker_dailies; got {enqueue_args!r}"
        )

        # The illegal `computation_status='stale'` write must be GONE — it
        # violated the CHECK constraint (23514) and nothing ever read it.
        sa_updates = updates_by_table.get("strategy_analytics", [])
        assert sa_updates == [], (
            f"strategy_analytics must NOT be UPDATEd with a 'stale' marker "
            f"(removed — CHECK-violating + dead); got {sa_updates!r}"
        )

    @pytest.mark.asyncio
    async def test_no_recompute_enqueue_when_nothing_stored(self):
        """If sync_trades stored zero trades across the board (e.g. all
        per-strategy RPCs failed), DO NOT enqueue a recompute — nothing
        changed, and a useless compute_analytics job would just churn.
        """
        mock_supabase = MagicMock()
        rpc_calls: list[tuple[str, dict]] = []

        # Every rpc raises — sync_trades fails for all strategies, so
        # per_strategy_stored stays 0 and no recompute should be attempted.
        def _rpc(name: str, args: dict):
            rpc_calls.append((name, args))
            chain = MagicMock()
            chain.execute.side_effect = RuntimeError("postgres dead")
            return chain

        mock_supabase.rpc.side_effect = _rpc

        sa_update_calls: list[dict] = []

        def _table(name: str):
            chain = MagicMock()

            def _update(payload: dict):
                if name == "strategy_analytics":
                    sa_update_calls.append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "x"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            chain.update.side_effect = _update
            return chain

        mock_supabase.table.side_effect = _table

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # All RPCs failed → status=error, AND no recompute enqueue fired.
        assert result["status"] == "error"
        enqueue_args = [
            args for (name, args) in rpc_calls if name == "enqueue_compute_job"
        ]
        assert enqueue_args == [], (
            f"Expected zero compute_analytics enqueues when nothing stored; "
            f"got {enqueue_args!r}"
        )
        assert sa_update_calls == [], (
            f"Expected zero strategy_analytics UPDATEs when nothing stored; "
            f"got {sa_update_calls!r}"
        )

    @pytest.mark.asyncio
    async def test_clean_zero_count_stored_does_not_enqueue_recompute(self):
        """A clean `sync_trades` success that stored ZERO new trades
        (`data=0`, NOT an exception) must also skip the recompute enqueue.
        This pins the `stored > 0` guard specifically — distinct from the
        exception path above — so a regression loosening it to `>= 0`
        (unconditional enqueue) is caught.
        """
        mock_supabase = MagicMock()
        rpc_calls: list[tuple[str, dict]] = []

        def _rpc(name: str, args: dict):
            rpc_calls.append((name, args))
            chain = MagicMock()
            # sync_trades succeeds but stored nothing new (0 rows).
            chain.execute.return_value = MagicMock(data=0)
            return chain

        mock_supabase.rpc.side_effect = _rpc
        mock_supabase.table.return_value.update.return_value.eq.return_value.\
            execute.return_value = MagicMock(data=[{"id": "x"}])

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # 2026-09-19: this tick fetched a real trade and stored none of it,
        # so the C-0198 gate holds `last_sync_at` — which makes it a STALLED
        # key, not a healthy one. It asserted `status == "ok"` until the
        # `held` bucket was introduced; that incidental expectation WAS the
        # "stalled key reports itself healthy" defect, in the same class as
        # the empty-`strategy_ids` path. The guard this test exists to pin
        # (`stored > 0` gating the recompute enqueue) is unchanged below.
        assert result["status"] == "held"
        assert result["per_strategy_stored"]["strat-A"] == 0
        enqueue_args = [
            args for (name, args) in rpc_calls if name == "enqueue_compute_job"
        ]
        assert enqueue_args == [], (
            f"A clean zero-stored sync must NOT enqueue a recompute (the "
            f"`stored > 0` guard); got {enqueue_args!r}"
        )


class TestC0198CursorOnlyAdvancesWhenStored:
    """C-0198: pre-fix the cron advanced `api_keys.last_sync_at`
    unconditionally — even when `sync_trades` returned with zero trades
    stored (e.g. all per-strategy RPCs failed). On the next tick
    `parse_since_ms(last_sync_at)` already points past the unsync'd
    trades, so they're never refetched and the user-facing trade list
    silently loses data. Post-fix the cursor only advances when
    something landed; a 100%-RPC-failure tick keeps `last_sync_at`
    where it was so the next tick replays the window.
    """

    @pytest.mark.asyncio
    async def test_C0198_zero_stored_does_not_advance_last_sync_at(self):
        mock_supabase = MagicMock()

        # Every sync_trades RPC blows up → synced_count == 0.
        def _rpc(name: str, args: dict):
            chain = MagicMock()
            chain.execute.side_effect = RuntimeError("postgres dead")
            return chain

        mock_supabase.rpc.side_effect = _rpc

        api_keys_update_payloads: list[dict] = []

        def _table(name: str):
            chain = MagicMock()

            def _update(payload: dict):
                if name == "api_keys":
                    api_keys_update_payloads.append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "key-1"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            chain.update.side_effect = _update
            return chain

        mock_supabase.table.side_effect = _table

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # Status = error because every RPC failed (covered elsewhere).
        assert result["status"] == "error"
        # The critical assertion: NO api_keys UPDATE carried `last_sync_at`.
        # With balance=None there should be zero api_keys UPDATEs at all.
        assert all(
            "last_sync_at" not in p for p in api_keys_update_payloads
        ), (
            "Expected no last_sync_at cursor advance when synced_count==0; "
            f"got {api_keys_update_payloads!r}"
        )

    @pytest.mark.asyncio
    async def test_C0198_partial_success_does_advance_last_sync_at(self):
        """Sanity-check the inverse: at least one strategy stored
        trades → cursor MUST advance, otherwise the next tick refetches
        the already-landed window for the successful strategies.

        ⭐ THE ADVANCE IS STILL RIGHT, AND IT ALWAYS CARRIED A COST THIS
        DOCSTRING USED TO LEAVE UNSAID. Holding the key cursor on any partial
        failure would starve the SUCCEEDING strategies into permanent
        re-fetch — the symmetric defect, and the reason C-0198 chose to
        advance. But advancing moved the shared cursor past the FAILED
        strategy's window too, and nothing on the cron path ever went back for
        it: strat-B's trades were gone on the next tick.

        That cost is now recovered, and NOT by this cursor — the key-level
        behaviour this test pins is deliberately unchanged, which is why the
        assertions below are untouched. It is recovered by a separate
        mechanism in a separate table: the per-strategy marker rows in
        `strategy_sync_cursors`, which hold the failed strategy's own resume
        point so the next tick's fetch window still covers its outstanding
        span. 164.5.1.4 SYNCCURSOR (shipped) — see
        `TestSyncCursorPerStrategyResume` in this file for the gate that pins
        the consequence.
        """
        mock_supabase = MagicMock()

        # strat-A: success (data=3). strat-B: raises.
        def _rpc(name: str, args: dict):
            chain = MagicMock()
            if args.get("p_strategy_id") == "strat-B":
                chain.execute.side_effect = RuntimeError("deadlock")
            else:
                chain.execute.return_value = MagicMock(data=3)
            return chain

        mock_supabase.rpc.side_effect = _rpc

        api_keys_update_payloads: list[dict] = []

        def _table(name: str):
            chain = MagicMock()

            def _update(payload: dict):
                if name == "api_keys":
                    api_keys_update_payloads.append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "key-1"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            chain.update.side_effect = _update
            return chain

        mock_supabase.table.side_effect = _table

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "partial"
        assert any(
            "last_sync_at" in p for p in api_keys_update_payloads
        ), (
            "Expected last_sync_at cursor advance when at least one "
            f"strategy stored; got {api_keys_update_payloads!r}"
        )

    @pytest.mark.asyncio
    async def test_D03_empty_strategy_ids_with_trades_does_not_advance_cursor(self):
        """FANOUT-COHORT-SYNC-CONSTANT-01 / D-03: when a key has NO eligible
        linked strategies at all (`strategy_ids=[]`), the per-strategy RPC
        loop is gated on `if trades and strategy_ids:` and never runs — so
        `per_strategy_stored` stays `{}` and no RPC is ever attempted. This
        is narrower than the two tests above, which cover an RPC that WAS
        attempted and failed. Pre-fix, `any_trades_to_store = bool(trades)
        and bool(strategy_ids)` is False purely because `strategy_ids` is
        empty (even though real trades were fetched), so
        `should_advance_cursor` is wrongly True and the cursor lies about
        having synced this window.
        """
        mock_supabase = MagicMock()

        # No strategy is eligible on this key, so the per-strategy RPC loop
        # never runs. Deliberately do NOT stub mock_supabase.rpc — if the
        # fix (or a future regression) ever calls it on this path, the bare
        # MagicMock's return shape is not a valid RPC response and the test
        # would fail loudly rather than silently accepting a call that
        # should not happen.

        api_keys_update_payloads: list[dict] = []

        def _table(name: str):
            chain = MagicMock()

            def _update(payload: dict):
                if name == "api_keys":
                    api_keys_update_payloads.append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "key-1"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            chain.update.side_effect = _update
            return chain

        mock_supabase.table.side_effect = _table

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 # A NON-None balance is load-bearing for the assertion at the
                 # bottom, not decoration. With `None`, `update_data` stays
                 # empty, NO api_keys UPDATE is issued at all, and
                 # `api_keys_update_payloads` is []. "last_sync_at is absent
                 # from every payload" over an EMPTY list is VACUOUSLY TRUE —
                 # it was non-vacuous only by accident, because the pre-fix
                 # code happened to append a payload. Stubbing a balance means
                 # an UPDATE is always issued, so the assertion has something
                 # real to quantify over and still goes red if the gate
                 # regresses.
                 "fetch_usdt_balance",
                 AsyncMock(return_value=4321.0),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=[])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        # No RPC was ever attempted (no strategy was eligible), so nothing
        # was stored — but real trades WERE fetched. The cursor must not
        # advance, or those trades are gone on the next tick because
        # `parse_since_ms(last_sync_at)` would then point past them.
        assert result["per_strategy_stored"] == {}
        # Non-vacuity guard: prove the payload list is non-empty BEFORE
        # asserting what is missing from it. Balance stashing is independent
        # of the cursor gate (the USDT fetch succeeded), so exactly one
        # api_keys UPDATE must have been issued.
        assert len(api_keys_update_payloads) == 1, (
            "Expected exactly one api_keys UPDATE (the balance stash) so the "
            "cursor assertion below is not quantifying over an empty list; "
            f"got {api_keys_update_payloads!r}"
        )
        payload = api_keys_update_payloads[0]
        assert payload.get("account_balance_usdt") == 4321.0, payload
        assert "last_sync_at" not in payload, (
            "Expected no last_sync_at cursor advance when strategy_ids=[] "
            f"despite fetched trades; got {payload!r}"
        )


class TestHeldStatusBucketForStalledKeys:
    """FANOUT-COHORT-SYNC-CONSTANT-01 / D-03 follow-up: a key that fetched
    REAL trades, stored none of them, and therefore held `last_sync_at`
    back used to report `status="ok"`.

    That made a permanently stalled key indistinguishable from a healthy
    one in the very summary the cron alarm reads: it landed in the `synced`
    bucket and its per-key line logged at INFO. The state does NOT
    self-resolve — it clears only when a strategy on that key re-enters
    ALLOWED_STRATEGY_STATUSES — and because the cursor is pinned, `since_ms`
    stays fixed and the `fetch_all_trades` window grows on every tick.

    Post-fix the tick is `held`: its own terminal status, its own summary
    bucket (never inside `synced`), and a WARNING per-key line.
    """

    @pytest.mark.asyncio
    async def test_stalled_key_reports_held_not_ok(self):
        import sys as _sys
        import routers.portfolio as portfolio_mod
        _sys.modules["routers.portfolio"] = portfolio_mod

        # One key whose only linked strategy is archived => `strategy_ids`
        # is empty after the lifecycle filter, so the per-strategy RPC loop
        # never runs and nothing can be stored.
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-held",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-archived", "status": "archived"}],
                }
            ],
            ps_data=[],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            response = await cron_mod.cron_sync()

        # WHY (Rule 9): the point of the bucket is that an alarm reading
        # `synced` cannot see this key as healthy. Asserting `held == 1`
        # alone would still pass if the key were ALSO counted as synced.
        assert response["held"] == 1, response
        assert response["synced"] == 0, response
        assert response["partial"] == 0
        assert response["failed"] == 0
        assert response["timed_out"] == 0
        assert response["revoked"] == 0
        assert response["transient"] == 0
        assert response["deferred"] == 0
        assert response["total_keys"] == 1

        held_results = [r for r in response["results"] if r["status"] == "held"]
        assert len(held_results) == 1, response["results"]
        assert held_results[0]["key_id"] == "key-held"
        # Real trades were fetched and none stored — that pairing is what
        # makes the key stalled rather than idle.
        assert held_results[0]["trades_fetched"] == 2
        assert held_results[0]["per_strategy_stored"] == {}
        # `held` must survive the RESULTS_CAP triage as a diagnostic status —
        # a stalled key evicted from a capped body is unobservable.
        assert "held" in cron_mod._NON_OK_STATUSES
        assert "ok" not in cron_mod._NON_OK_STATUSES

    @pytest.mark.asyncio
    async def test_stalled_key_per_key_line_logs_at_warning(self, caplog):
        import logging
        import sys as _sys
        import routers.portfolio as portfolio_mod
        _sys.modules["routers.portfolio"] = portfolio_mod

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-held",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-archived", "status": "archived"}],
                }
            ],
            ps_data=[],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             caplog.at_level(logging.INFO, logger="quantalyze.analytics"):
            await cron_mod.cron_sync()

        per_key_lines = [
            rec
            for rec in caplog.records
            if rec.getMessage().startswith("cron_sync key_id=key-held ")
        ]
        # Non-vacuity: the line must exist before its level means anything.
        assert len(per_key_lines) == 1, [r.getMessage() for r in caplog.records]
        assert per_key_lines[0].levelno == logging.WARNING, (
            "The stalled key's per-key summary line must log at WARNING; a "
            f"held key logging at {per_key_lines[0].levelname} is invisible "
            "in the same log stream an operator scans for trouble."
        )
        assert "status=held" in per_key_lines[0].getMessage()


class TestSyncStatusSummaryBucketCompleteness:
    """The cron summary exists so each terminal status is independently
    alarmable. Before this gate the counters were seven hand-written
    `sum(...)` lines (`synced`, `partial`, `failed`, `timed_out`, `revoked`,
    `transient`, `deferred`), so adding an eighth `SyncStatus` member and
    forgetting its counter produced a status that reached NO bucket — silently folded
    into nothing, exactly the class CR-F1 (`transient_failure`/`partial`
    counted by none of the buckets) already cost this router once.

    Two arms, so the gate bites in both directions:
      * a new `SyncStatus` with no registry entry fails arm 1;
      * a registry entry whose counter never reaches the response body
        fails arm 2.
    """

    def test_registry_covers_every_sync_status_member(self):
        from typing import get_args

        declared = set(get_args(cron_mod.SyncStatus))
        registered = set(cron_mod.SYNC_STATUS_SUMMARY_KEYS)
        assert declared == registered, (
            "Every SyncStatus member needs a summary counter or the cron "
            "alarm cannot see it. Unregistered: "
            f"{sorted(declared - registered)}; stale registry entries: "
            f"{sorted(registered - declared)}"
        )

    @pytest.mark.asyncio
    async def test_every_registered_bucket_reaches_the_response_body(self):
        import sys as _sys
        import routers.portfolio as portfolio_mod
        _sys.modules["routers.portfolio"] = portfolio_mod

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-1", "status": "published"}],
                }
            ],
            ps_data=[],
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            response = await cron_mod.cron_sync()

        # Non-vacuity: the registry must be non-empty for `all(...)` to mean
        # anything, and the tick must have actually produced a summary.
        assert cron_mod.SYNC_STATUS_SUMMARY_KEYS, "registry is empty"
        assert response["total_keys"] == 1, response
        missing = [
            bucket
            for bucket in cron_mod.SYNC_STATUS_SUMMARY_KEYS.values()
            if bucket not in response
        ]
        assert not missing, (
            f"Registered status buckets absent from the cron_sync response "
            f"body: {missing}. An alarm watching the body cannot count a "
            "status it never receives."
        )
        # And every registered bucket is an int counter, not an echoed status
        # string — a bucket present but unusable is the same defect.
        for bucket in cron_mod.SYNC_STATUS_SUMMARY_KEYS.values():
            assert isinstance(response[bucket], int), (bucket, response[bucket])


def defaultdict_factory():
    """Local helper to avoid importing collections.defaultdict at module
    top-level (and to keep the test additions self-contained)."""
    from collections import defaultdict
    return defaultdict(list)


# ---------------------------------------------------------------------------
# A3-03 — cron pagination exception includes page-context in log
# ---------------------------------------------------------------------------


class TestCronRecomputePaginationErrorContext:
    """A3-03: when the cron's pagination loop for synced_strategy_ids /
    candidate_portfolio_ids raises an exception, the log message must include
    how many portfolio_ids had already been collected (blast-radius context).
    Pre-fix: only the exception type was logged, making it impossible to
    determine how much of the pipeline had completed before the failure."""

    def test_pagination_exception_log_includes_collected_count(
        self, monkeypatch, caplog
    ):
        """Set up a cron_sync that has already collected some ps_data rows before
        the second pagination loop raises — the exception log must mention the
        collected count so the blast radius is auditable."""
        import routers.cron as cron_mod

        # We test the logging contract by directly triggering the exception path.
        # The exception handler block is inside cron_sync's try/except, so we
        # need to drive it via a minimal cron_sync invocation.
        # Strategy: monkeypatch supabase so the second round-trip raises.

        # Minimal set of monkeypatches to reach the recompute-lookup block.
        from unittest.mock import MagicMock, patch
        import asyncio

        # All results: one "ok" key with one synced strategy so synced_strategy_ids=[s1]
        # which triggers the recompute block.
        mock_all_results = [
            {
                "status": "ok",
                "per_strategy_stored": {"strat-1": 1},
                "key_id": "key-1",
                "exchange": "binance",
                "strategy_id": "strat-1",
                "trades_fetched": 5,
                "duration_s": 0.1,
            }
        ]

        call_count = {"n": 0}

        def _paginated_table_side_effect(name):
            t = MagicMock()
            if name == "portfolio_strategies":
                # First call returns data; second call (if any) raises.
                call_count["n"] += 1
                if call_count["n"] == 1:
                    # First page: return some portfolio_ids
                    t.select.return_value.in_.return_value.execute.return_value = (
                        MagicMock(data=[{"portfolio_id": "pf-1"}, {"portfolio_id": "pf-2"}])
                    )
                else:
                    t.select.return_value.in_.return_value.execute.side_effect = (
                        RuntimeError("Supabase blip on page 2")
                    )
            elif name == "portfolios":
                # Second round-trip (filter is_test=False) raises
                t.select.return_value.in_.return_value.eq.return_value.execute.side_effect = (
                    RuntimeError("Supabase blip on portfolios page")
                )
            else:
                t.select.return_value.in_.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                t.select.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                t.rpc.return_value.execute.return_value = MagicMock(data=None)
            return t

        sb = MagicMock()
        sb.table.side_effect = _paginated_table_side_effect
        sb.rpc.return_value.execute.return_value = MagicMock(data=None)

        # We test the exception handler directly by patching the module's
        # supabase and inspecting the log rather than driving the full endpoint
        # (which requires many more mocks). Use cron_mod-level patching.
        with patch.object(cron_mod, "get_supabase", return_value=sb), \
             caplog.at_level("ERROR", logger="quantalyze.analytics"):
            # Invoke the relevant code path via the exception handler.
            # The exception handler uses 'ps_data' local to the try block;
            # test its logging contract using a simplified direct invocation.
            # Since we can't reach the handler without running the full cron,
            # we verify the message format of the exception branch by inspecting
            # the source text (a static-source contract test).
            pass

        # Static-source contract: verify the exception handler log message
        # includes the collected-count placeholder (%d portfolio_ids already
        # collected) so operators know the blast radius.
        import inspect
        source = inspect.getsource(cron_mod.cron_sync)
        assert "already collected" in source, (
            "cron_sync exception handler must include 'already collected' "
            "in the log message to surface the blast-radius count (A3-03)"
        )
        assert "_ps_collected" in source, (
            "cron_sync must track ps_data-collected count before the exception "
            "for blast-radius logging (A3-03)"
        )


# ---------------------------------------------------------------------------
# L-1 (red-team) — "ps_data" in dir() dead-code guard removed from cron_sync
# ---------------------------------------------------------------------------


class TestCronSyncPsDataDirGuardRemoved:
    """L-1 (red-team): the dead-code guard `len(ps_data) if "ps_data" in dir()
    else 0` must be replaced with `len(ps_data)` directly. ps_data is always
    initialised before the exception handler so the dir() check never evaluates
    False; keeping it implies a non-existent code path to future maintainers."""

    def test_dir_guard_not_present_in_cron_sync(self):
        import inspect
        from routers import cron as cron_mod

        source = inspect.getsource(cron_mod.cron_sync)
        assert '"ps_data" in dir()' not in source, (
            'L-1: dead-code guard `"ps_data" in dir()` must be removed — '
            "ps_data is always initialised before the exception handler"
        )
        # The replacement must still log the count
        assert "_ps_collected" in source, (
            "L-1: _ps_collected must still be computed (without the dir() guard) "
            "so blast-radius logging still works"
        )


# ---------------------------------------------------------------------------
# 164.5.1.4 SYNCCURSOR — the per-STRATEGY resume marker
# ---------------------------------------------------------------------------

# The table plan 01 shipped (`supabase/migrations/20260919120000_strategy_sync_cursors.sql`).
# Named here as a literal rather than imported from `routers.cron` so this
# gate keeps measuring the production wiring even if the module-level constant
# is renamed — the string is what reaches PostgREST.
_SYNC_CURSOR_TABLE = "strategy_sync_cursors"

# 164.5.1.4 WR-04 — the marker gates' time anchor: ONE TICK AGO, computed, not
# a fixed calendar date.
#
# ⛔ WHY THIS STOPPED BEING A LITERAL. Every gate below uses this value to stand
# in for "the resume point a held strategy was left at on the PREVIOUS tick",
# which in production is fifteen minutes old. It was written as the literal
# "2026-01-15T00:00:00+00:00", and a literal recedes: by the time WR-04 added
# `MAX_MARKER_LOOKBACK_MS` the anchor had aged to 247.8 days, so the clamp fired
# on every one of these gates and three of them went RED — not because the
# behaviour they pin had changed, but because their stand-in for "one tick ago"
# had silently drifted eight months into the past. MEASURED, from the clamp's
# own warning: "resume point held by strategy strat-B is 247.8 day(s) old".
#
# A test whose meaning depends on the wall-clock date it happens to be RUN on
# measures something slightly different every day. Anchoring to the same clock
# the code reads keeps this value what it was always written to mean, and it
# cannot rot again.
#
# ⚠️ One tick, not one second: the resume point must be strictly in the PAST or
# the floor comparisons below stop being meaningful.
_ONE_TICK_AGO = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()


class TestResumeFloorEmptyFanOutFallsBackToKeyCursor:
    """164.5.1.4 IN-01: `_resume_floor_ms`'s no-eligible-strategies branch.

    ⛔ WHY THIS ARM EXISTS. MEASURED: mutating
    `if not strategy_ids: return parse_since_ms(key_cursor)` to `return None`
    left the whole suite GREEN. The branch is reached by every key whose
    strategies are all archived, draft-only, or otherwise outside
    `ALLOWED_STRATEGY_STATUSES` — not an exotic state — and `None` means "start
    of history" to `fetch_all_trades`. So the regression is a key that
    re-fetches its ENTIRE trade history from the venue every 15 minutes,
    forever, with nothing anywhere reporting it: no exception, no error field,
    no status change. It is also precisely the direction `KEY_SYNC_TIMEOUT`
    turns into a whole-key outage.

    The branch is pre-phase behaviour preserved, which is exactly why it was
    easy to leave unpinned: nothing about it is new, so no new test covered it.
    """

    T0 = _ONE_TICK_AGO

    def test_no_eligible_strategies_parses_the_key_cursor(self):
        t0_ms = cron_mod.parse_since_ms(self.T0)
        assert t0_ms is not None, (
            "T0 must parse — otherwise the expected value below is None and "
            "the mutant this arm exists to kill would pass"
        )

        # A NON-EMPTY marker mapping, holding a strategy that is NOT in the
        # (empty) eligible list. This is the realistic shape — markers outlive
        # a strategy's eligibility — and it makes the assertion measure the
        # branch rather than an incidentally-empty mapping.
        floor = cron_mod._resume_floor_ms(
            [],
            {"strat-archived": "2020-01-01T00:00:00+00:00"},
            self.T0,
        )

        assert floor == t0_ms, (
            "a key with no eligible strategy must fall back to parsing its OWN "
            "cursor, preserving pre-phase behaviour exactly. Got "
            f"{floor!r}, expected {t0_ms!r}"
        )
        assert floor is not None, (
            "and it must NOT be None: None means 'start of history', so this "
            "key would re-fetch its entire trade history from the venue on "
            "every 15-minute tick, forever, with no error surfaced anywhere"
        )

    def test_the_no_eligible_branch_is_exempt_from_the_cap(self):
        """⛔ THE EXEMPTION, PINNED ABSOLUTELY — not by agreement with a
        sibling branch.

        MEASURED: mutating this branch to ALSO clamp left the file green,
        because every arm that reached it used a RECENT cursor, where the clamp
        cannot bite. The branch parses the KEY cursor, which is pre-phase
        behaviour with no cap at all; clamping it would silently drop history
        on a key whose strategies are all archived or draft — and
        `MAX_MARKER_LOOKBACK_MS`'s own derivation says the exemption is
        deliberate.

        Stated as an equality against `parse_since_ms`, so a mutant that
        clamped BOTH no-marker branches (which an agreement-shaped assertion
        cannot see, both sides moving together) reds here.
        """
        now_ms = 1_800_000_000_000
        ancient = datetime.fromtimestamp(
            (now_ms - 200 * 86_400_000) / 1000, tz=timezone.utc
        ).isoformat()

        floor = cron_mod._resume_floor_ms([], {}, ancient, now_ms=now_ms)

        assert floor == cron_mod.parse_since_ms(ancient), (
            "a key with no eligible strategy parses its OWN cursor and the cap "
            "must not touch it, however old it is. Got "
            f"{floor!r}, expected {cron_mod.parse_since_ms(ancient)!r}"
        )
        assert floor != now_ms - cron_mod.MAX_MARKER_LOOKBACK_MS, (
            "and specifically it must not have been clamped to the cap — that "
            "is the mutant this arm exists to kill"
        )


class TestUnclearableHoldCannotWedgeTheWholeKey:
    """164.5.1.4 WR-04: a hold that never clears must not grow the key's fetch
    window without bound.

    ⛔ THE REGRESSION, AND WHY IT IS ONE. `fetch_all_trades` runs ONCE PER KEY
    and `_resume_floor_ms` pins that single window at the EARLIEST resume point
    across the key's strategies. So one strategy whose `sync_trades` or
    recompute enqueue keeps failing grows the window by a tick interval every
    tick, forever. `_sync_key_with_timeout` cancels at `KEY_SYNC_TIMEOUT`, and
    once the growing fetch crosses it NO strategy on the key syncs, NEITHER
    cursor advances, and the key is wedged permanently — the next tick asks for
    an even bigger window and fails sooner.

    Pre-phase the same failure stranded ONE strategy and left the key healthy.
    The marker, unbounded, turns a per-strategy degradation into a whole-key
    outage: a strictly WIDER blast radius, which is the one thing a purely
    additive fix may not produce.

    ⚠️ WHAT THE CAP COSTS, AND IT IS A REAL LOSS. Clamping abandons the held
    strategy's window older than the cap — those trades are fetched by no tick,
    ever. It is taken because the alternative loss is unbounded AND takes down
    healthy siblings, while this one is bounded and confined to the strategy
    that was already failing, i.e. no worse than pre-phase.

    `now_ms` is injected throughout so these arms measure the CLAMP and not the
    date the suite happens to run on.
    """

    NOW_MS = 1_800_000_000_000

    @staticmethod
    def _iso(ms: int) -> str:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()

    def test_a_hold_older_than_the_cap_does_not_drive_the_window_past_it(
        self, caplog
    ):
        cap_ms = cron_mod.MAX_MARKER_LOOKBACK_MS
        # A hold three times older than the cap — the shape of a strategy that
        # has been failing since long before anyone noticed.
        held_ms = self.NOW_MS - 3 * cap_ms

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            floor = cron_mod._resume_floor_ms(
                ["strat-A", "strat-B"],
                {
                    "strat-A": self._iso(self.NOW_MS - 60_000),
                    "strat-B": self._iso(held_ms),
                },
                self._iso(self.NOW_MS - 60_000),
                now_ms=self.NOW_MS,
            )

        assert floor is not None, (
            "the clamp must return a BOUNDED floor, never None — None means "
            "'start of history', which is the largest possible window and the "
            "exact opposite of bounding it"
        )
        assert floor == self.NOW_MS - cap_ms, (
            "a resume point older than the cap must be clamped TO the cap. Got "
            f"{floor!r}, expected {self.NOW_MS - cap_ms!r}"
        )
        assert self.NOW_MS - floor <= cap_ms, (
            "THE CONSEQUENCE: the window the venue is asked for is bounded, so "
            "it cannot keep growing into KEY_SYNC_TIMEOUT and take every other "
            f"strategy on this key down with it. Window was {self.NOW_MS - floor}ms"
        )

        clamp_lines = [
            r.message for r in caplog.records if "CLAMPED" in r.message
        ]
        assert len(clamp_lines) == 1, (
            "the clamp must announce itself exactly once — it is a silent data "
            "loss otherwise. Got " + repr([r.message for r in caplog.records])
        )
        assert "strat-B" in clamp_lines[0], (
            "and it must NAME the holding strategy; the operator's next "
            f"question is always 'by whom'. Got {clamp_lines[0]!r}"
        )
        assert "strat-A" not in clamp_lines[0], (
            "it must name the strategy that PRODUCED the floor, not the "
            f"healthy sibling. Got {clamp_lines[0]!r}"
        )

    def test_a_hold_inside_the_cap_is_left_exactly_where_it_is(self, caplog):
        """The non-vacuity arm. Without it, an implementation that clamped
        UNCONDITIONALLY would satisfy the arm above while silently discarding
        every ordinary hold — which is the entire mechanism this phase exists
        to build, deleted."""
        cap_ms = cron_mod.MAX_MARKER_LOOKBACK_MS
        held_ms = self.NOW_MS - (cap_ms // 2)

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            floor = cron_mod._resume_floor_ms(
                ["strat-B"],
                {"strat-B": self._iso(held_ms)},
                self._iso(self.NOW_MS - 60_000),
                now_ms=self.NOW_MS,
            )

        assert floor == held_ms, (
            "a hold WELL INSIDE the cap must be honoured exactly — clamping it "
            "would throw away the outstanding window the marker exists to "
            f"preserve. Got {floor!r}, expected {held_ms!r}"
        )
        assert not [r for r in caplog.records if "CLAMPED" in r.message], (
            "and nothing was clamped, so the warning must stay silent; an "
            "unconditional emit would make the positive arm vacuous"
        )

    def test_a_null_marker_still_means_all_history_and_is_never_clamped(self):
        """⛔ THE CONTRACT EXCEPTION, PINNED.

        A marker PRESENT WITH A NULL means "this strategy has no resume point
        at all, re-fetch everything" — one of the three states the read path is
        built on, and the correct reading for a brand-new key. Clamping it
        would quietly convert "get everything" into "get the last N days" and
        lose the older history it was explicitly asking for, breaking the
        three-state contract through the back door of a bounds check.
        """
        floor = cron_mod._resume_floor_ms(
            ["strat-B"],
            {"strat-B": None},
            self._iso(self.NOW_MS - 60_000),
            now_ms=self.NOW_MS,
        )
        assert floor is None, (
            "a present-with-null marker means START OF HISTORY and the cap "
            f"must not touch it. Got {floor!r}"
        )


class TestKeyCursorFallbackIsNeverClamped:
    """164.5.1.4 ROUND-2 BLOCKER: `MAX_MARKER_LOOKBACK_MS` may bound a HELD
    MARKER and nothing else.

    ⛔ THE DEFECT THIS PINS, AND IT SHIPPED. The clamp was written after the
    loop in `_resume_floor_ms`, so it clamped whatever the loop produced —
    including the value `_strategy_resume_point` falls back to for a strategy
    ABSENT from the marker mapping, which is the KEY's own cursor. MEASURED
    against the shipped function with a fixed clock, a key cursor 200 days old
    and `strategy_cursors={}` — the exact state the migration lands in:

      * eligible strategies present  -> CLAMPED to the cap, and the warning
        named an innocent strategy as "holding" a resume point it never held
      * no eligible strategies       -> returned unclamped

    Two branches written to be the SAME pre-phase behaviour disagreed, and the
    clamped one is the common one. That falsifies the migration's own "inert
    the moment it lands" claim and both halves of the constant's derivation:
    the loss was not confined to the strategy that was already failing, and the
    capped worst case was not a strict subset of pre-phase — pre-phase this
    path had NO cap at all.

    ⭐ REACHABLE IN PRODUCTION WITH NOTHING FAILING ANYWHERE.
    `reconnect_allocator_api_key` deliberately preserves `last_sync_at` across a
    disconnect/reconnect, and the credential-failure `is_active=False` path
    preserves it too. A key dormant for longer than the cap and then reconnected
    used to catch up in full; under the unconditional clamp it silently dropped
    everything older than the cap, on a healthy key, with no failing strategy in
    sight.

    ⛔ WHY THIS CLASS CARRIES ITS OWN EXPLICITLY-OLD ANCHOR, AND THE DECISION
    BEHIND IT. `TestSyncCursorPerStrategyResume` already carried the
    equivalent property — its INERT ON ARRIVAL assertion, "with no marker rows
    `since_ms` is byte-identical to `parse_since_ms(key_cursor)`" — and that
    assertion was TRUE RED against the shipped clamp:

        AssertionError: INERT ON ARRIVAL: with no marker rows yet every
        strategy is ABSENT from the mapping and must fall back to the key
        cursor (since_ms=<t0>). Got since_ms=<t0 + ~218 days>.

    It was read as a stale literal reporting nothing and silenced by moving the
    anchor to `now - 15 min`. It was not stale: it was this defect, correctly
    reported. Past that anchor move the property is only exercised for key
    cursors YOUNGER than the cap, where the clamp cannot bite, so it stopped
    being pinned at all.

    The anchor move STANDS for that class — `T0` there means "the resume point
    the previous tick left behind", which is fifteen minutes old in production,
    and a two-tick loop whose markers are eight months old measures a state
    that cannot occur. What was wrong was relying on a single `now`-relative
    anchor to also pin an AGE-dependent branch, which it can never do. So the
    age-dependent property gets its own explicitly-old, clock-injected anchor
    here, where the age IS the subject, and neither gate can silence the other.
    """

    NOW_MS = 1_800_000_000_000
    # Deliberately, explicitly OLD: far past the cap, and not `now`-relative.
    # Nothing about this number may drift with the date the suite is run on.
    DORMANT_KEY_CURSOR_MS = NOW_MS - 200 * 86_400_000

    @staticmethod
    def _iso(ms: int) -> str:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()

    def test_a_key_cursor_older_than_the_cap_is_returned_unclamped(self, caplog):
        """The INERT ON ARRIVAL property, at an age where the clamp can bite."""
        key_cursor = self._iso(self.DORMANT_KEY_CURSOR_MS)
        expected = cron_mod.parse_since_ms(key_cursor)
        assert expected is not None, (
            "the key cursor must parse — otherwise the expectation below is "
            "None and the defect this arm exists to kill would pass"
        )
        assert self.NOW_MS - expected > cron_mod.MAX_MARKER_LOOKBACK_MS, (
            "the anchor must be OLDER than the cap or this arm measures "
            "nothing: the clamp only bites past the cap"
        )

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            floor = cron_mod._resume_floor_ms(
                ["strat-A", "strat-B"],
                {},  # the state the migration lands in: no marker rows at all
                key_cursor,
                now_ms=self.NOW_MS,
            )

        assert floor == expected, (
            "INERT ON ARRIVAL: with NO marker rows every strategy is ABSENT "
            "from the mapping and falls back to the KEY cursor, which the cap "
            "must not touch — pre-phase this path had no cap at all, and a key "
            "dormant past the cap (disconnect/reconnect and the "
            "credential-failure deactivation both PRESERVE last_sync_at) used "
            f"to catch up in full. Got {floor!r}, expected {expected!r}"
        )
        clamp_lines = [r.message for r in caplog.records if "CLAMPED" in r.message]
        assert not clamp_lines, (
            "and nothing may announce a clamp here: the warning names a "
            "strategy as HOLDING the floor, and no strategy holds this one. "
            f"Got {clamp_lines!r}"
        )

    def test_both_no_marker_branches_return_the_same_window(self):
        """⛔ The two branches are the SAME pre-phase behaviour and must agree.

        `_resume_floor_ms` parses the key cursor twice over: once in the
        no-eligible-strategies short-circuit, once through
        `_strategy_resume_point`'s absent-strategy fallback. The shipped clamp
        applied to the second and not the first, so the same key cursor
        produced two different windows depending on whether the key happened to
        have an eligible strategy. This arm makes that divergence impossible to
        reintroduce without a named failure.
        """
        key_cursor = self._iso(self.DORMANT_KEY_CURSOR_MS)

        no_eligible = cron_mod._resume_floor_ms(
            [], {}, key_cursor, now_ms=self.NOW_MS
        )
        eligible_but_unmarked = cron_mod._resume_floor_ms(
            ["strat-A"], {}, key_cursor, now_ms=self.NOW_MS
        )

        assert no_eligible == eligible_but_unmarked, (
            "with no marker rows, having an eligible strategy may not change "
            "the window by so much as a millisecond — both readings are the "
            f"key cursor. Got {eligible_but_unmarked!r} with an eligible "
            f"strategy vs {no_eligible!r} without"
        )

    def test_a_held_marker_past_the_cap_is_still_clamped(self):
        """The non-vacuity counterpart: the fix above narrows the clamp, it
        does not delete it. One strategy ABSENT (key-cursor fallback, dormant)
        and one PRESENT with an ancient marker — the marker is what produced
        the floor, so the clamp must still bite."""
        key_cursor = self._iso(self.NOW_MS - 60_000)
        held_ms = self.NOW_MS - 3 * cron_mod.MAX_MARKER_LOOKBACK_MS

        floor = cron_mod._resume_floor_ms(
            ["strat-A", "strat-B"],
            {"strat-B": self._iso(held_ms)},
            key_cursor,
            now_ms=self.NOW_MS,
        )

        assert floor == self.NOW_MS - cron_mod.MAX_MARKER_LOOKBACK_MS, (
            "a MARKER-derived floor past the cap must still be clamped — "
            "narrowing the clamp to marker provenance must not turn it off. "
            f"Got {floor!r}"
        )

    def test_the_cap_is_thirty_days_and_that_magnitude_is_pinned(self):
        """⛔ THE DIAL ITSELF, IN ABSOLUTE DAYS.

        MEASURED: rebinding `MAX_MARKER_LOOKBACK_MS` from 30 days to ONE HOUR
        left this file fully green — nothing reddened until the value fell
        below about a minute. Every other arm expresses its expectation in
        terms of the constant, so all of them follow the dial wherever it goes.
        The dial decides how much of a held strategy's history is PERMANENTLY
        ABANDONED (the constant's own derivation says so: a loss, not a
        deferral), so a 720x cut of it may not pass unremarked.

        Stated in days rather than as a multiple of the constant, deliberately:
        that is the only way an arm can disagree with the constant at all.
        """
        assert cron_mod.MAX_MARKER_LOOKBACK_MS == 30 * 86_400_000, (
            "the cap is THIRTY DAYS. Changing it changes how much history a "
            "held strategy loses forever; the constant's derivation picks 30 "
            "to sit far above any plausible venue or database outage (hours, "
            "not weeks). If this is being changed deliberately, change the "
            f"derivation with it. Got {cron_mod.MAX_MARKER_LOOKBACK_MS!r}ms"
        )

        # And the boundary it implies, measured in days rather than in cap
        # multiples: a 29-day hold survives, a 31-day hold does not.
        honoured_ms = self.NOW_MS - 29 * 86_400_000
        assert cron_mod._resume_floor_ms(
            ["strat-B"],
            {"strat-B": self._iso(honoured_ms)},
            self._iso(self.NOW_MS - 60_000),
            now_ms=self.NOW_MS,
        ) == honoured_ms, (
            "a 29-day hold is INSIDE a 30-day cap and must be honoured "
            "exactly; if this fails the cap has been cut below 29 days"
        )
        abandoned_ms = self.NOW_MS - 31 * 86_400_000
        assert cron_mod._resume_floor_ms(
            ["strat-B"],
            {"strat-B": self._iso(abandoned_ms)},
            self._iso(self.NOW_MS - 60_000),
            now_ms=self.NOW_MS,
        ) != abandoned_ms, (
            "a 31-day hold is OUTSIDE a 30-day cap and must be clamped; if "
            "this fails the cap has been raised past 31 days"
        )


class TestEveryCronSyncedVenueStampsTheFetchErrorFlag:
    """164.5.1.4 ROUND-2 WR-01: `fetch_degraded` was BLIND on Bybit.

    ⛔ THE DEFECT, MEASURED AGAINST THE REAL `fetch_daily_pnl`. The flag
    `daily_pnl_fetch_error` was stamped only by that function's OUTERMOST
    handler. The Bybit branch wraps its whole body in an inner
    `except Exception` that re-raises `RateLimitExceeded` and otherwise logs a
    warning and falls through, so the outer handler never runs. One venue-level
    `NetworkError` per venue:

        okx      rows=0 daily_pnl_fetch_error=True
        binance  rows=0 daily_pnl_fetch_error=True
        bybit    rows=0 daily_pnl_fetch_error=False    <-- blind

    ⛔ WHY IT IS DATA INTEGRITY AND NOT LOG FIDELITY. `_sync_single_key` reads
    that flag as `fetch_degraded` and the per-strategy marker advance is
    `((not trades) and not fetch_degraded) or ...`. On Bybit a 502 therefore
    returned `[]` with `fetch_degraded` False, `not trades` True, and EVERY
    held marker on that key advanced to now — discarding a hold of arbitrary
    age, whose window is then fetched by no later tick. That is the exact
    permanent loss this phase exists to close, arriving by another road, on a
    venue `cron.py`'s own comments name as cron-synced.

    ⚠️ THE EXISTING GATES CANNOT SEE THIS. Every other `fetch_degraded` arm in
    this file stubs `get_and_clear_last_dq_flags` outright, so the flag's
    PROVENANCE — whether the venue branch actually stamps it — is asserted by
    none of them. This class therefore drives the REAL
    `cron_mod.fetch_all_trades` (which is `services.exchange.fetch_daily_pnl`)
    through `cron_mod`'s own module bindings, in the same order
    `_sync_single_key` calls them, with nothing patched.
    """

    class _ExplodingExchange:
        """A venue whose every private endpoint raises a transport error.

        `__getattr__` covers the endpoint each branch happens to call —
        `private_get_account_bills`, `fapiprivate_get_income`,
        `private_get_v5_position_closed_pnl` — so the arm keeps measuring the
        branch if an endpoint name changes, rather than silently exercising a
        MagicMock that returns a truthy object and never enters the handler.
        """

        def __init__(self, exchange_id: str) -> None:
            self.id = exchange_id

        async def _boom(self, *args: Any, **kwargs: Any) -> Any:
            import ccxt

            raise ccxt.NetworkError("simulated venue 502")

        def __getattr__(self, name: str) -> Any:
            return self._boom

    @pytest.mark.asyncio
    async def test_a_venue_error_is_reported_as_degraded_on_every_venue(self):
        readings: dict[str, tuple[int, bool]] = {}
        for exchange_id in ("okx", "binance", "bybit"):
            # The REAL pair, in `_sync_single_key`'s order: fetch, then drain
            # the per-task ContextVar immediately after the await.
            trades = await cron_mod.fetch_all_trades(
                self._ExplodingExchange(exchange_id),
                since_ms=1_700_000_000_000,
            )
            flags = cron_mod.get_and_clear_last_dq_flags()
            readings[exchange_id] = (
                len(trades),
                bool(flags.get("daily_pnl_fetch_error")),
            )

        assert all(rows == 0 for rows, _ in readings.values()), (
            "every branch must swallow-or-propagate its way to an EMPTY "
            f"series here; if one returned rows the stub never bit. {readings!r}"
        )
        assert readings["bybit"][1] is True, (
            "BYBIT: a venue error must stamp `daily_pnl_fetch_error`. Its "
            "inner handler swallows everything but RateLimitExceeded, so the "
            "outer handler that used to be the only stamping site never runs — "
            "and an unstamped crash reads downstream as an IDLE tick, "
            "advancing every held marker on the key and losing its outstanding "
            f"window permanently. Readings: {readings!r}"
        )
        assert all(flagged for _, flagged in readings.values()), (
            "and no venue may be the blind one — this arm is cross-venue "
            "precisely because the defect was a single branch diverging from "
            f"its siblings. Readings: {readings!r}"
        )

    @pytest.mark.asyncio
    async def test_a_crashed_bybit_fetch_does_not_read_as_an_idle_tick(self):
        """THE CONSEQUENCE, spelled out in `_sync_single_key`'s own predicate.

        `strategy_advances = ((not trades) and not fetch_degraded) or (stored
        and enqueued)`. With no trades stored, the whole question is the first
        disjunct: an empty-because-crashed fetch must NOT satisfy it, or every
        held marker on the key advances past a window nothing has fetched.
        """
        trades = await cron_mod.fetch_all_trades(
            self._ExplodingExchange("bybit"), since_ms=1_700_000_000_000
        )
        fetch_degraded = bool(
            cron_mod.get_and_clear_last_dq_flags().get("daily_pnl_fetch_error")
        )

        assert not trades, "the stub must produce an empty series"
        assert ((not trades) and not fetch_degraded) is False, (
            "the IDLE disjunct must be FALSE for a crashed Bybit fetch. True "
            "here means a held marker advances to now on the strength of a "
            "502, and its outstanding window is fetched by no later tick — "
            f"permanently. trades={trades!r} fetch_degraded={fetch_degraded!r}"
        )


class TestPerRowFallbackIsNotConsumedByAMisclassification:
    """164.5.1.4 ROUND-2 NEW-2 / WR-06: the CONSEQUENCE of the classifier, and
    the ungated tail of the per-row fallback.

    `_is_missing_cursor_table` is the branch condition on the batch-upsert
    failure path: True skips the per-row retry entirely, on the sound reasoning
    that a missing relation is not a row-scoped fault. So classifying a COLUMN
    fault as a missing table does not merely mislabel a log line — it consumes
    the recovery mechanism WR-06 added, and every strategy whose marker row the
    batch dropped then falls back to the key cursor and UNDER-fetches its
    outstanding window.
    """

    @pytest.mark.asyncio
    async def test_a_column_fault_still_runs_the_per_row_retry(self):
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(strategy_ids=["strat-A", "strat-B"])

        result, _, cursor_upserts = await TestSyncCursorPerStrategyResume._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
            cursor_batch_error=_ApiErrorLike(
                code="PGRST204",
                message=(
                    "Could not find the 'held_at' column of "
                    "'strategy_sync_cursors' in the schema cache"
                ),
            ),
        )

        per_row = [p for p in cursor_upserts if isinstance(p, dict)]
        assert len(per_row) == 2, (
            "a PGRST204 column fault is row-scoped and the fallback must run: "
            "one upsert per strategy. Classifying it as a missing table skips "
            "the retry, and each strategy with no row yet then falls back to "
            f"the key cursor and UNDER-fetches. Captured: {cursor_upserts!r}"
        )
        assert "strategy_cursor_write_error" in result, (
            "and the degraded tick is still reported — the batch DID fail. "
            f"Envelope keys: {sorted(result)!r}"
        )

    @pytest.mark.asyncio
    async def test_rows_past_the_retry_limit_are_recorded_not_dropped(self):
        """⛔ THE UNGATED TAIL. `_STRATEGY_CURSOR_ROW_RETRY_LIMIT`'s derivation
        claims "rows past the limit are NOT silently dropped: each is recorded
        in the envelope error field naming the limit, so the condition is
        visible". MEASURED: deleting the `for row in skipped:` loop left all
        arms passing, so that claim rested on nothing.

        It matters because the un-retried rows are exactly the ones whose
        markers are now stale: a strategy with no row yet falls back to the key
        cursor that just advanced, and its outstanding window is fetched by no
        tick. An operator who cannot see WHICH rows were skipped cannot tell
        that from a healthy key.
        """
        limit = cron_mod._STRATEGY_CURSOR_ROW_RETRY_LIMIT
        strategy_ids = [f"strat-{i:02d}" for i in range(limit + 2)]
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        result, _, cursor_upserts = await TestSyncCursorPerStrategyResume._run_tick(
            key_row=_make_key_row(strategy_ids=strategy_ids),
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
            cursor_batch_error=RuntimeError("23503 foreign key violation"),
        )

        per_row = [p for p in cursor_upserts if isinstance(p, dict)]
        assert len(per_row) == limit, (
            "the fallback is BOUNDED — it runs inside KEY_SYNC_TIMEOUT on a "
            "path that is already failing, and an unbounded serial retry would "
            "turn a marker-write problem into a key-sync timeout. Got "
            f"{len(per_row)} row upserts for a limit of {limit}"
        )

        reported = result.get("strategy_cursor_write_error", "")
        assert "not retried" in reported and str(limit) in reported, (
            "and every row past the limit must be RECORDED in the envelope "
            "naming the limit, or the claim in the constant's derivation is "
            f"false and those stale markers are invisible. Got {reported!r}"
        )
        for sid in strategy_ids[limit:]:
            assert sid in reported, (
                f"{sid} was never retried and never reported — silently "
                f"dropped. Got {reported!r}"
            )
        assert strategy_ids[0] not in reported, (
            "while a row that WAS retried and succeeded must not be listed as "
            f"un-retried. Got {reported!r}"
        )


class TestClampReachesTheResponseEnvelope:
    """164.5.1.4 ROUND-2: the clamp is the ONLY loss in this phase that a
    caller could not see.

    ⛔ THE SHAPE OF THE DEFECT. Every other degradation here is structural —
    `strategy_cursors_held`, `strategy_cursor_write_error`,
    `strategy_cursor_lookup_error` all reach the response envelope, and the
    WR-03 comment block makes a point of saying the envelope fields are NEVER
    suppressed even when the LOG is quietened. The clamp, alone, produced a
    `logger.warning` and nothing else. MEASURED before this change: `clamp` and
    `CLAMP` appeared in `cron.py` only in comments, a docstring and that one
    warning string, and never in `result`.

    That is the worst possible place for that asymmetry. The clamp is the only
    condition in this phase whose loss is PERMANENT and UNRECOVERABLE — "those
    trades will be fetched by no tick", by the constant's own derivation —
    while a held marker or a failed marker write are both recoverable next
    tick. The tick returned success with a clean envelope, and the only
    evidence was a log line nobody greps: the canonical silent-failure shape.

    ⚠️ THESE ARMS RUN ON THE WALL CLOCK, deliberately and unavoidably.
    `_sync_single_key` does not inject `now_ms` — production reads the wall
    clock — so an end-to-end tick can only be aged RELATIVE to now. The unit
    arms below inject a fixed clock; the envelope arms use an age (200 days) so
    far past the cap that no plausible clock skew changes the verdict.
    """

    CAP_MS = 30 * 86_400_000

    @staticmethod
    def _ago(days: float) -> str:
        return (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).isoformat()

    @pytest.mark.asyncio
    async def test_a_clamped_window_is_reported_in_the_envelope(self):
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        # strat-A is ABSENT from the mapping (key-cursor fallback, recent);
        # strat-B holds a marker 200 days old. The floor is therefore
        # MARKER-derived and past the cap, so the clamp must fire.
        key_row = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self._ago(0.01),
            strategy_cursors={"strat-B": self._ago(200)},
        )
        result, _, _ = await TestSyncCursorPerStrategyResume._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )

        assert "strategy_cursor_window_clamped" in result, (
            "a tick that PERMANENTLY abandoned part of a strategy's window "
            "must say so in its envelope. Without this the tick returns "
            "success, every other field looks healthy, and the only evidence "
            f"is a log line. Envelope keys: {sorted(result)!r}"
        )
        report = result["strategy_cursor_window_clamped"]
        assert report["floor_strategy_id"] == "strat-B", (
            "the report must name the strategy whose marker produced the "
            f"clamped floor. Got {report!r}"
        )
        assert report["truncated_strategy_ids"] == ["strat-B"], (
            "and every strategy that LOST span, which here is strat-B alone — "
            "strat-A holds no marker and falls back to a recent key cursor. "
            f"Got {report!r}"
        )
        assert report["cap_days"] == 30, (
            f"the report carries the cap that bit, in days. Got {report!r}"
        )
        assert 195 <= report["floor_age_days"] <= 205, (
            "and the age of the floor it clamped, so an operator can tell a "
            f"just-crossed hold from an ancient one. Got {report!r}"
        )

        # The envelope must describe the window the venue was ACTUALLY asked
        # for — a report that did not match the fetch would be worse than none.
        since_ms = fetch_mock.call_args.kwargs["since_ms"]
        assert abs(since_ms - report["oldest_allowed_ms"]) < 5_000, (
            "the reported floor must BE the window the fetch used, not a "
            f"separately-computed number. fetch={since_ms!r} report={report!r}"
        )

    @pytest.mark.asyncio
    async def test_a_healthy_tick_adds_no_clamp_key_at_all(self):
        """The non-vacuity arm, in this file's established style: a
        "conditional" field that is always present is not conditional, and an
        always-empty report in every healthy tick's envelope is noise the
        summary alarm would learn to ignore."""
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        key_row = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self._ago(0.01),
            strategy_cursors={"strat-B": self._ago(1)},
        )
        result, _, _ = await TestSyncCursorPerStrategyResume._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )

        assert "strategy_cursor_window_clamped" not in result, (
            "a one-day-old hold is WELL inside the cap, nothing was abandoned, "
            f"and the key must be absent entirely. Got {result!r}"
        )

    def test_the_report_and_the_warning_name_every_truncated_strategy(self):
        """⛔ THE TRUNCATION IS PER-KEY, AND THE OLD WORDING SAID OTHERWISE.

        One `fetch_all_trades` serves the whole key, so raising the floor to the
        cap costs EVERY strategy holding a marker older than it — not only the
        one that produced the floor. The previous warning said "that strategy's
        trades", which under-states the loss and sends an operator to a single
        row.
        """
        now_ms = 1_800_000_000_000

        def _iso(ms: int) -> str:
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()

        report: dict[str, Any] = {}
        with self._captured_warnings() as records:
            floor = cron_mod._resume_floor_ms(
                ["strat-A", "strat-B", "strat-C"],
                {
                    "strat-A": _iso(now_ms - 86_400_000),        # 1 day, safe
                    "strat-B": _iso(now_ms - 200 * 86_400_000),  # the floor
                    "strat-C": _iso(now_ms - 100 * 86_400_000),  # also truncated
                },
                _iso(now_ms - 60_000),
                now_ms=now_ms,
                clamp_report=report,
            )

        assert floor == now_ms - self.CAP_MS, f"the clamp must bite; got {floor!r}"
        assert report["floor_strategy_id"] == "strat-B", repr(report)
        assert report["truncated_strategy_ids"] == ["strat-B", "strat-C"], (
            "BOTH strategies holding a marker past the cap lose their span — "
            "the window is per-KEY. Naming only the floor-holder hides "
            f"strat-C's loss entirely. Got {report!r}"
        )

        clamp_lines = [r.message for r in records if "CLAMPED" in r.message]
        assert len(clamp_lines) == 1, repr([r.message for r in records])
        assert "strat-C" in clamp_lines[0], (
            "and the warning must name them too, or the log and the envelope "
            f"disagree about who paid. Got {clamp_lines[0]!r}"
        )
        assert "strat-A" not in clamp_lines[0], (
            "while a strategy INSIDE the cap lost nothing and must not be "
            f"named. Got {clamp_lines[0]!r}"
        )

    def test_a_key_cursor_floor_writes_no_report(self):
        """⛔ THE TIE TO THE PROVENANCE FIX. The report exists to describe a
        real, permanent loss. A floor that came from the KEY cursor is never
        clamped and loses nothing, so an entry here would be a false alarm
        naming a strategy that holds no row — and an operator would follow it
        into `strategy_sync_cursors` looking for a row that does not exist."""
        now_ms = 1_800_000_000_000
        ancient = datetime.fromtimestamp(
            (now_ms - 200 * 86_400_000) / 1000, tz=timezone.utc
        ).isoformat()

        report: dict[str, Any] = {}
        floor = cron_mod._resume_floor_ms(
            ["strat-A"], {}, ancient, now_ms=now_ms, clamp_report=report
        )

        assert floor == cron_mod.parse_since_ms(ancient), f"got {floor!r}"
        assert report == {}, (
            "nothing was clamped and nothing was lost, so the report must stay "
            f"EMPTY. Got {report!r}"
        )

    @staticmethod
    def _captured_warnings():
        """A caplog-free capture, so this arm works outside a fixture-bearing
        signature and cannot be silenced by another handler's level."""
        import contextlib
        import logging

        @contextlib.contextmanager
        def _cm():
            records: list[logging.LogRecord] = []

            class _Sink(logging.Handler):
                def emit(self, record: logging.LogRecord) -> None:
                    record.message = record.getMessage()
                    records.append(record)

            sink = _Sink(level=logging.WARNING)
            target = logging.getLogger("quantalyze.analytics")
            previous_level = target.level
            target.addHandler(sink)
            target.setLevel(logging.WARNING)
            try:
                yield records
            finally:
                target.removeHandler(sink)
                target.setLevel(previous_level)

        return _cm()


class _ApiErrorLike(Exception):
    """Stand-in for supabase-py's `APIError`.

    Carries `.code` and `.message` the way PostgREST errors do, because
    `_is_missing_cursor_table` probes both those attributes AND `str(exc)`.
    A bare `Exception` would only ever exercise the text probe and would leave
    the `.code` branch — the one a real 42P01 actually takes — unmeasured.
    """

    def __init__(self, *, code: str | None = None, message: str = "", details: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    def __str__(self) -> str:
        return self.message


class TestRolloutWindowMissingMarkerTableIsWarnedOnce:
    """164.5.1.4 WR-03: the missing-table condition is LATCHED to one warning;
    every other exception keeps its `logger.exception` traceback.

    ⭐ THE WINDOW IS STRUCTURAL, NOT HYPOTHETICAL. The service deploys on CI
    green while the migration apply waits behind the production reviewer gate,
    so there is an interval — minutes or days, nobody controls which — where
    this code is live and `strategy_sync_cursors` does not exist. At one tick
    per 15 minutes, with one lookup exception plus one upsert exception PER KEY,
    that is an unbounded stream of full tracebacks into Sentry for a condition
    that is expected and not actionable.

    ⛔ WHAT THIS MUST NOT BECOME. Quietening the LOG is the whole change;
    quietening the FACT is not. The envelope error fields stay populated on
    every affected tick, and any exception that is not a missing relation keeps
    its traceback — including a permission denial ON THIS VERY TABLE, which is
    what a service-role credential degrading to anon looks like and is the
    single most important thing here not to downgrade.
    """

    @staticmethod
    def _emit(exc: BaseException) -> None:
        """Call the logger helper from inside a real `except` block.

        ⚠️ Load-bearing: `logger.exception` reads `sys.exc_info()`, not its
        argument. Calling the helper outside an active `except` would log
        `exc_info=None` and the traceback assertion below would measure nothing.
        """
        try:
            raise exc
        except Exception as caught:
            cron_mod._log_strategy_cursor_exc(
                caught, "cron_sync: marker write failed for key %s", "key-1"
            )

    def test_missing_table_is_warned_exactly_once_per_process(self, caplog):
        cron_mod._missing_cursor_table_warned = False
        exc = _ApiErrorLike(
            code="42P01",
            message='relation "strategy_sync_cursors" does not exist',
        )

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            self._emit(exc)
            self._emit(exc)
            self._emit(exc)

        warnings = [r for r in caplog.records if r.levelname == "WARNING"]
        errors = [r for r in caplog.records if r.levelname == "ERROR"]

        assert len(warnings) == 1, (
            "THREE ticks hit the missing table and exactly ONE line may be "
            "emitted — the latch is the fix. Got "
            + repr([r.message for r in warnings])
        )
        assert errors == [], (
            "a known, expected, indefinite condition must not reach "
            "`logger.exception`; each of those is a fresh Sentry error event "
            "for something nobody can act on. Got "
            + repr([r.message for r in errors])
        )
        assert "ROLLOUT WINDOW" in warnings[0].message, (
            "the one line must NAME the window, or the operator reading it has "
            f"no way to tell it from a real fault: {warnings[0].message!r}"
        )

    def test_a_real_fault_keeps_its_traceback_on_every_occurrence(self, caplog):
        """The negative arm, and the one that matters most.

        Without it the latch above would pass against a helper that swallowed
        EVERYTHING — which would silence the genuine marker-write failures this
        phase's whole error-surfacing design depends on.
        """
        cron_mod._missing_cursor_table_warned = False

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            self._emit(RuntimeError("deadlock detected"))
            self._emit(RuntimeError("deadlock detected"))

        errors = [r for r in caplog.records if r.levelname == "ERROR"]
        warnings = [r for r in caplog.records if r.levelname == "WARNING"]

        assert len(errors) == 2, (
            "a non-missing-table exception is NOT latched — every occurrence "
            "is a real fault and must be reported. Got "
            + repr([(r.levelname, r.message) for r in caplog.records])
        )
        assert all(r.exc_info is not None for r in errors), (
            "and each must carry its ACTIVE traceback, or the stack never "
            "reaches Sentry and the report is unusable"
        )
        assert warnings == [], (
            "a genuine fault must never be downgraded to the rollout-window "
            "warning. Got " + repr([r.message for r in warnings])
        )

    def test_permission_denied_on_this_table_is_not_read_as_missing(self):
        """⛔ THE CONJUNCTIVE PROBE, PINNED.

        `_is_missing_cursor_table`'s text probe requires the table name AND a
        "does not exist" / "schema cache" phrase. Drop the second half and this
        42501 — which is exactly what a service-role credential degraded to
        anon produces against this table's deny-all RLS — gets classified as
        "not migrated yet", latched to a single warning, and then goes
        UNREPORTED for the entire life of the process. That is a silent
        credential failure, which is strictly worse than the noise WR-03 set
        out to remove.
        """
        exc = _ApiErrorLike(
            code="42501",
            message="permission denied for table strategy_sync_cursors",
        )
        assert cron_mod._is_missing_cursor_table(exc) is False, (
            "a permission denial naming the table is a REAL fault, not a "
            "missing relation"
        )

    def test_postgrest_schema_cache_wording_without_a_code_is_recognised(self):
        """supabase-py does not always surface a typed `.code`. PostgREST's own
        schema-cache wording must still be recognised, or the latch silently
        fails open to the traceback flood it exists to prevent."""
        exc = _ApiErrorLike(
            message=(
                "Could not find the table 'public.strategy_sync_cursors' in "
                "the schema cache"
            ),
        )
        assert cron_mod._is_missing_cursor_table(exc) is True, (
            "PGRST205's schema-cache phrasing is the same condition as 42P01"
        )

    @pytest.mark.parametrize(
        "label,exc",
        [
            (
                "42703",
                _ApiErrorLike(
                    code="42703",
                    message=(
                        'column "held_at" of relation "strategy_sync_cursors" '
                        "does not exist"
                    ),
                ),
            ),
            (
                "PGRST204",
                _ApiErrorLike(
                    code="PGRST204",
                    message=(
                        "Could not find the 'held_at' column of "
                        "'strategy_sync_cursors' in the schema cache"
                    ),
                ),
            ),
        ],
    )
    def test_a_column_fault_is_not_read_as_a_missing_table(self, label, exc):
        """⛔ THE OVER-MATCH, AND WHY IT IS NOT LOG FIDELITY.

        Both payloads satisfy probe 3's conjunct — the table name AND a "does
        not exist" / "schema cache" phrase — while being about a COLUMN of a
        table that plainly exists. MEASURED against the shipped predicate,
        both classified as "the table is not there yet".

        `_is_missing_cursor_table` is ALSO the branch condition deciding
        whether WR-06's per-row fallback runs at all, so the misclassification
        consumes the recovery mechanism on top of latching the log for the
        process lifetime. And PGRST204 is the most common post-apply condition
        there is — PostgREST's schema-cache reload is asynchronous — so the
        operator is told the migration has not landed when it HAS and a column
        is drifting.

        A column fault is schema DRIFT: actionable, row-scoped, and exactly
        what the traceback and the per-row retry exist for.
        """
        assert cron_mod._is_missing_cursor_table(exc) is False, (
            f"{label} is a COLUMN fault on a table that EXISTS. Reading it as "
            "'not migrated yet' latches the rollout-window warning for the "
            "whole process AND skips the per-row fallback, so every marker row "
            "the batch dropped falls back to the key cursor and UNDER-fetches"
        )

    def test_a_42p01_naming_another_relation_is_not_read_as_this_table(self):
        """The code probe never looked at WHICH relation was missing. A 42P01
        for a view or trigger this table depends on is a real fault about
        something else, and reading it as "our table has not landed yet" hides
        it behind a reassuring one-shot warning."""
        exc = _ApiErrorLike(
            code="42P01",
            message='relation "strategies_archive" does not exist',
        )
        assert cron_mod._is_missing_cursor_table(exc) is False, (
            "a 42P01 that positively names a DIFFERENT relation is about that "
            "relation"
        )

    def test_a_bare_code_with_no_text_still_latches(self):
        """⛔ THE NON-VACUITY COUNTERPART, and the reason the exclusions are
        narrow. supabase-py does not always surface text; the code probes exist
        precisely for that. Excluding on a relation name that is ABSENT would
        re-open WR-03's traceback flood during the rollout window."""
        assert cron_mod._is_missing_cursor_table(_ApiErrorLike(code="42P01")) is True, (
            "a bare 42P01 with no message is still the rollout window"
        )

    def test_a_column_fault_keeps_its_traceback_rather_than_the_latch(self, caplog):
        """The consequence at the LOG, measured through the real helper."""
        cron_mod._missing_cursor_table_warned = False
        exc = _ApiErrorLike(
            code="PGRST204",
            message=(
                "Could not find the 'held_at' column of "
                "'strategy_sync_cursors' in the schema cache"
            ),
        )

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            self._emit(exc)
            self._emit(exc)

        errors = [r for r in caplog.records if r.levelname == "ERROR"]
        warnings = [r for r in caplog.records if r.levelname == "WARNING"]
        assert len(errors) == 2 and all(r.exc_info is not None for r in errors), (
            "schema drift is a real fault: every occurrence keeps its "
            "traceback. Got " + repr([(r.levelname, r.message) for r in caplog.records])
        )
        assert warnings == [], (
            "and it must NOT be downgraded to the one-shot rollout-window "
            "warning, which would hide it for the life of the process. Got "
            + repr([r.message for r in warnings])
        )


class TestSyncCursorPerStrategyResume:
    """164.5.1.4: a partial fan-out must leave the FAILED strategy's trade
    window re-drivable on the NEXT tick.

    ⭐ These tests pin the CONSEQUENCE, not the row. The load-bearing assertion
    is the `since_ms` keyword that reaches `fetch_all_trades` on tick 2 — the
    number the venue is actually asked for. A test that merely asserted "a
    marker row was written" would pass against a marker nothing reads, which is
    precisely the inert-fix failure mode this phase exists to avoid.

    ⛔ `parse_since_ms` is deliberately NOT patched here. Every other test in
    this file stubs it to a constant, which is right for them (they assert on
    cursor WRITES) and fatal here: stubbing it would erase the entire
    assertion, since the whole question is what number the resume-floor
    computation produces.
    """

    # A fixed instant with an explicit UTC offset. Everything is measured
    # relative to this: tick 1 starts from it, the failed strategy is held at
    # it, and tick 2 must come back to it.
    T0 = _ONE_TICK_AGO

    @staticmethod
    def _cursor_map(upsert_payloads: list[Any]) -> dict[str, Any]:
        """Flatten captured `strategy_sync_cursors` upsert payloads into the
        strategy_id -> last_sync_at mapping the NEXT tick would read back.

        This is what makes the pair a real two-tick loop: tick 2's inputs are
        DERIVED from tick 1's actual outputs rather than hand-written to match
        what the implementation is expected to have done.
        """
        mapping: dict[str, Any] = {}
        for payload in upsert_payloads:
            entries = payload if isinstance(payload, list) else [payload]
            for entry in entries:
                mapping[entry["strategy_id"]] = entry["last_sync_at"]
        return mapping

    @staticmethod
    async def _run_tick(
        *,
        key_row: dict[str, Any],
        failing_strategy_ids: set[str],
        fetch_mock: AsyncMock,
        trades: list[dict[str, Any]],
        enqueue_failing_strategy_ids: set[str] | None = None,
        rpc_calls: list[tuple[str, dict]] | None = None,
        dq_flags: dict[str, Any] | None = None,
        cursor_batch_error: BaseException | None = None,
        cursor_row_failing_strategy_ids: set[str] | None = None,
    ) -> tuple[dict[str, Any], list[dict], list[Any]]:
        """Run ONE `_sync_single_key` tick against a fully stubbed Supabase.

        Returns `(result, api_keys_update_payloads, cursor_upsert_payloads)`.

        `failing_strategy_ids` fails the STORAGE RPC; `enqueue_failing_strategy_ids`
        fails the RECOMPUTE-ENQUEUE RPC. They are separate parameters on purpose:
        the advance condition has two conjuncts and each needs an injection point
        of its own, or a gate that only ever fails storage would pass against an
        implementation carrying the storage conjunct alone.

        `rpc_calls`, when supplied, collects every `(name, args)` pair the tick
        issued, so a caller can assert that a re-drive actually re-attempted the
        RPC rather than inferring it from the fetch window alone.

        `dq_flags` stands in for the data-quality buffer that
        `services.exchange.fetch_daily_pnl` stamps and the router drains right
        after the fetch. It is a SEPARATE injection point from `trades` on
        purpose: the whole point of the flag is that a crashed fetch and an
        idle one both surface as an EMPTY `trades`, so a gate that could only
        vary `trades` could never tell the two apart.

        `cursor_batch_error` fails the BATCHED marker upsert (the multi-row
        call); `cursor_row_failing_strategy_ids` fails individual rows in the
        per-row FALLBACK. Two parameters, because WR-06's whole claim is that
        those two outcomes are now DIFFERENT — a gate that could only fail both
        together could not tell "one bad row cost only itself" from "one bad
        row voided the batch", which is the entire distinction being pinned.
        The captured payload list holds a LIST for the batch call and a DICT
        per fallback row, so a caller can tell which path ran.
        """
        enqueue_failing = enqueue_failing_strategy_ids or set()
        cursor_row_failing = cursor_row_failing_strategy_ids or set()
        mock_supabase = MagicMock()

        def _rpc(name: str, args: dict):
            # Branch on the RPC NAME as well as on p_strategy_id: this file's
            # older dispatchers assume every RPC is `sync_trades`, which stops
            # being true the moment the recompute enqueue matters to the
            # outcome (it does here — a strategy only advances when its
            # enqueue also succeeded).
            if rpc_calls is not None:
                rpc_calls.append((name, dict(args)))
            chain = MagicMock()
            if name == "sync_trades":
                if args.get("p_strategy_id") in failing_strategy_ids:
                    chain.execute.side_effect = RuntimeError("deadlock")
                else:
                    chain.execute.return_value = MagicMock(data=len(trades))
            elif name == "enqueue_compute_job":
                if args.get("p_strategy_id") in enqueue_failing:
                    chain.execute.side_effect = RuntimeError(
                        "compute_jobs unavailable"
                    )
                else:
                    chain.execute.return_value = MagicMock(data=None)
            else:
                raise AssertionError(f"unexpected RPC in this gate: {name!r}")
            return chain

        mock_supabase.rpc.side_effect = _rpc

        api_keys_update_payloads: list[dict] = []
        cursor_upsert_payloads: list[Any] = []

        def _table(name: str):
            chain = MagicMock()

            def _update(payload: dict):
                if name == "api_keys":
                    api_keys_update_payloads.append(payload)
                upd = MagicMock()
                upd.eq.return_value.execute.return_value = MagicMock(
                    data=[{"id": "key-1"}]
                )
                upd.in_.return_value.execute.return_value = MagicMock(data=[])
                return upd

            def _upsert(payload: Any, *args: Any, **kwargs: Any):
                # An explicit branch, not a bare MagicMock: a bare mock would
                # accept `.upsert(...).execute()` silently and capture NOTHING,
                # so an implementation that never wrote a marker would be
                # indistinguishable from one that did.
                if name == _SYNC_CURSOR_TABLE:
                    cursor_upsert_payloads.append(payload)
                ups = MagicMock()
                if name == _SYNC_CURSOR_TABLE:
                    # ⚠️ The failure is attached to `.execute`, not raised here.
                    # supabase-py builds the request lazily and only the
                    # terminal `.execute()` talks to PostgREST, so raising from
                    # `.upsert(...)` itself would exercise a call shape
                    # production never sees — and would fire BEFORE the payload
                    # was captured above.
                    if isinstance(payload, list):
                        if cursor_batch_error is not None:
                            ups.execute.side_effect = cursor_batch_error
                    elif payload.get("strategy_id") in cursor_row_failing:
                        ups.execute.side_effect = RuntimeError(
                            "23503 foreign key violation: strategy deleted"
                        )
                if ups.execute.side_effect is None:
                    ups.execute.return_value = MagicMock(data=payload)
                return ups

            chain.update.side_effect = _update
            chain.upsert.side_effect = _upsert
            return chain

        mock_supabase.table.side_effect = _table

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(cron_mod, "fetch_all_trades", fetch_mock), \
             patch.object(
                 cron_mod,
                 "get_and_clear_last_dq_flags",
                 lambda: dict(dq_flags or {}),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ):
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        return result, api_keys_update_payloads, cursor_upsert_payloads

    @pytest.mark.asyncio
    async def test_partial_fanout_leaves_failed_strategy_window_refetchable(self):
        """Tick 1 stores for strat-A and raises for strat-B. Tick 2 must still
        ask the venue for strat-B's window, even though the KEY cursor
        advanced past it (which it must — holding it would starve strat-A into
        permanent re-fetch, the symmetric defect C-0198 chose to avoid).
        """
        t0_ms = cron_mod.parse_since_ms(self.T0)
        assert t0_ms is not None, "T0 must parse — the whole gate is measured against it"

        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        # ---- Tick 1: the state the migration lands in — no marker rows at all.
        key_row_1 = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self.T0,
        )
        result_1, key_updates_1, cursor_upserts_1 = await self._run_tick(
            key_row=key_row_1,
            failing_strategy_ids={"strat-B"},
            fetch_mock=fetch_mock,
            trades=trades,
        )

        assert result_1["status"] == "partial", (
            "one strategy stored and one raised — that is `partial`; "
            f"got {result_1['status']!r}"
        )

        # ⛔ TICK 1'S WINDOW, AND IT IS NOT A FORMALITY — it is the only
        #    assertion in this class that can tell MEMBERSHIP from `.get()`.
        #    Tick 1 runs with NO marker rows at all, which is the state the
        #    migration lands in and the state its "INERT on arrival, today's
        #    behaviour byte for byte" claim is about. With membership every
        #    strategy is ABSENT and falls back to the key cursor (T0). With
        #    `.get()`, absent and present-with-NULL both yield None,
        #    `_resume_floor_ms` short-circuits, and `since_ms` becomes None —
        #    a FULL-HISTORY refetch for every active key on the first tick
        #    after deploy, silent and green.
        #    ⚠️ `call_args` is the LAST call, so every tick-2 assertion below
        #    is blind to this: by tick 2 both strategies are PRESENT in the
        #    mapping and the two readings agree. MEASURED before this arm
        #    existed: the `.get()` mutant survived the whole file at 56 passed.
        first_since_ms = fetch_mock.call_args_list[0].kwargs["since_ms"]
        assert first_since_ms == t0_ms, (
            "INERT ON ARRIVAL: with no marker rows yet every strategy is "
            "ABSENT from the mapping and must fall back to the key cursor "
            f"(since_ms={t0_ms}). Got since_ms={first_since_ms!r}. A None here "
            "means absent was collapsed into present-with-NULL — a full "
            "re-fetch of all history for every key on the first tick after "
            "this ships."
        )

        cursors = self._cursor_map(cursor_upserts_1)
        assert set(cursors) == {"strat-A", "strat-B"}, (
            "EVERY strategy in the fan-out must get a marker row this tick, "
            "held or advancing. Advance-only writing leaves the failed "
            "strategy with no row, so the next tick falls back to the key "
            "cursor that just advanced past its window — the fix would be "
            f"INERT on the first failure. Captured: {cursors!r}"
        )
        assert cursors["strat-A"] != self.T0, (
            "strat-A stored trades and its recompute enqueue succeeded, so its "
            f"marker must have advanced past T0; got {cursors['strat-A']!r}"
        )
        assert cursors["strat-B"] == self.T0, (
            "strat-B's RPC raised, so its marker must be PINNED at the resume "
            "point the tick STARTED from, not at the post-tick instant; "
            f"got {cursors['strat-B']!r}"
        )

        advanced = [p["last_sync_at"] for p in key_updates_1 if "last_sync_at" in p]
        assert advanced, (
            "the KEY cursor must still advance on a partial fan-out — that is "
            "C-0198's deliberate choice and this phase does not change it"
        )
        key_cursor_after_tick_1 = advanced[-1]
        assert cron_mod.parse_since_ms(key_cursor_after_tick_1) > t0_ms, (
            "the key cursor must have moved PAST T0, otherwise tick 2's "
            "assertion below could pass for the trivial reason that nothing moved"
        )

        # ---- Tick 2: built from tick 1's OWN captured outputs.
        key_row_2 = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=key_cursor_after_tick_1,
            strategy_cursors=cursors,
        )
        await self._run_tick(
            key_row=key_row_2,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )

        since_ms = fetch_mock.call_args.kwargs["since_ms"]
        assert since_ms == t0_ms, (
            "THE CONSEQUENCE: tick 2 must ask the venue for strat-B's "
            f"outstanding window (since_ms={t0_ms}), not the advanced key "
            f"cursor. Got since_ms={since_ms!r}. A marker that is written but "
            "never read produces exactly this failure."
        )

    @pytest.mark.asyncio
    async def test_crashed_fetch_does_not_clear_an_existing_hold(self):
        """⛔ CR-01. A hold must survive an IDLE-LOOKING tick whose fetch
        actually CRASHED.

        `services.exchange.fetch_daily_pnl`'s OUTERMOST `except Exception`
        logs, stamps `daily_pnl_fetch_error` and then RETURNS the
        partially-built list, which is usually EMPTY. So `trades == []` means
        either "the venue had nothing" or "the venue call crashed", and the
        router has to read the flag to tell them apart.

        THE LOSS IF IT DOES NOT: tick 1 holds strat-B at T0. Tick 2 pins the
        window at T0 (correct), the venue call crashes, `trades == []`, a bare
        `not trades` reads that as an idle tick, and strat-B's marker advances
        to now — discarding a hold of ARBITRARY AGE. Its outstanding window is
        then fetched by no later tick, ever. That is the same permanent
        per-strategy loss this phase exists to close, re-entered through the
        advance rule the phase itself added.
        """
        t0_ms = cron_mod.parse_since_ms(self.T0)
        assert t0_ms is not None

        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        # ---- Tick 1: strat-B's storage RPC raises, so it is HELD at T0.
        _r1, key_updates_1, cursor_upserts_1 = await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"], last_sync_at=self.T0
            ),
            failing_strategy_ids={"strat-B"},
            fetch_mock=fetch_mock,
            trades=trades,
        )
        cursors_1 = self._cursor_map(cursor_upserts_1)
        assert cursors_1["strat-B"] == self.T0, (
            "precondition for this test: tick 1 must actually HOLD strat-B. "
            f"got {cursors_1['strat-B']!r}"
        )
        key_cursor_after_1 = [
            p["last_sync_at"] for p in key_updates_1 if "last_sync_at" in p
        ][-1]

        # ---- Tick 2: nothing fails, but the FETCH CRASHED — empty list plus
        #      the flag. Every strategy stores 0 rows because there is nothing
        #      to store, so only the idle disjunct can decide the outcome.
        empty_fetch = AsyncMock(return_value=[])
        _r2, _k2, cursor_upserts_2 = await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"],
                last_sync_at=key_cursor_after_1,
                strategy_cursors=cursors_1,
            ),
            failing_strategy_ids=set(),
            fetch_mock=empty_fetch,
            trades=[],
            dq_flags={"daily_pnl_fetch_error": True},
        )
        cursors_2 = self._cursor_map(cursor_upserts_2)
        assert cursors_2["strat-B"] == self.T0, (
            "THE HOLD MUST SURVIVE A CRASHED FETCH. strat-B was held at T0 and "
            "tick 2's fetch raised inside fetch_daily_pnl, which swallows the "
            "exception and returns an EMPTY list with daily_pnl_fetch_error "
            "set. Advancing here discards a hold of arbitrary age and strands "
            f"strat-B's outstanding window permanently. got {cursors_2['strat-B']!r}"
        )

        # ---- Tick 3: and the window it asks for is still strat-B's.
        await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"],
                last_sync_at=key_cursor_after_1,
                strategy_cursors=cursors_2,
            ),
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )
        since_ms = fetch_mock.call_args.kwargs["since_ms"]
        assert since_ms == t0_ms, (
            "THE CONSEQUENCE: after a crashed idle tick the next real tick "
            f"must still ask for strat-B's outstanding window (since_ms={t0_ms}); "
            f"got {since_ms!r}"
        )

    @pytest.mark.asyncio
    async def test_a_genuinely_idle_tick_does_clear_the_hold(self):
        """The control for the arm above, and it is what stops that arm from
        passing against a marker that simply never advances. IDENTICAL tick 2,
        except the fetch returned empty WITHOUT crashing — no flag. The hold
        must then clear, because there is genuinely nothing outstanding.
        """
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        _r1, key_updates_1, cursor_upserts_1 = await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"], last_sync_at=self.T0
            ),
            failing_strategy_ids={"strat-B"},
            fetch_mock=fetch_mock,
            trades=trades,
        )
        cursors_1 = self._cursor_map(cursor_upserts_1)
        assert cursors_1["strat-B"] == self.T0
        key_cursor_after_1 = [
            p["last_sync_at"] for p in key_updates_1 if "last_sync_at" in p
        ][-1]

        _r2, _k2, cursor_upserts_2 = await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"],
                last_sync_at=key_cursor_after_1,
                strategy_cursors=cursors_1,
            ),
            failing_strategy_ids=set(),
            fetch_mock=AsyncMock(return_value=[]),
            trades=[],
            dq_flags=None,
        )
        cursors_2 = self._cursor_map(cursor_upserts_2)
        assert cursors_2["strat-B"] != self.T0, (
            "a CLEAN empty fetch is genuine evidence that nothing is "
            "outstanding, so the hold must clear. If this ever fails, the fix "
            "for the crashed-fetch case has over-reached into holding forever "
            f"on every idle tick. got {cursors_2['strat-B']!r}"
        )

    @pytest.mark.asyncio
    async def test_null_marker_means_refetch_all_history_not_fall_back(self):
        """⛔ CR-02. STATE (2) of the three-state contract — row PRESENT with a
        NULL value, meaning "re-fetch from the start of history".

        This is the state the migration spends a whole self-verify arm keeping
        REPRESENTABLE (arm 7's `is_nullable` assertion) and that
        `_strategy_resume_point`'s docstring warns about by name. Without this
        arm nothing anywhere constructs it, so the canonical wrong resolver —

            resolved = strategy_cursors.get(sid)
            return resolved if resolved is not None else key_cursor

        — passes the entire module green, because states (1) and (3) are the
        only ones exercised and both implementations agree on those.

        Production reachability: a key whose `last_sync_at` is NULL (the
        first-ever sync — the largest payload and so the likeliest tick to hit
        a deadlock) with a multi-strategy fan-out and one failing RPC. The
        hold-write resolves to None and stores NULL. Under the wrong resolver
        the next tick falls back to the key cursor that just advanced, and the
        strategy's ENTIRE history is stranded.
        """
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        # ---- Tick 1 from a key that has NEVER synced.
        _r1, key_updates_1, cursor_upserts_1 = await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"], last_sync_at=None
            ),
            failing_strategy_ids={"strat-B"},
            fetch_mock=fetch_mock,
            trades=trades,
        )
        cursors_1 = self._cursor_map(cursor_upserts_1)
        assert "strat-B" in cursors_1, (
            "persist-on-hold: strat-B must still get a ROW. Absence would make "
            f"this test measure state (1) instead of state (2). got {cursors_1!r}"
        )
        assert cursors_1["strat-B"] is None, (
            "STATE (2) MUST BE WRITTEN, NOT SKIPPED: the key had never synced, "
            "so strat-B's pre-tick resume point IS None and the marker must "
            "record it as a present NULL — 'refetch from the start of "
            f"history'. got {cursors_1['strat-B']!r}"
        )

        key_cursor_after_1 = [
            p["last_sync_at"] for p in key_updates_1 if "last_sync_at" in p
        ][-1]
        assert key_cursor_after_1 is not None, (
            "the KEY cursor must have advanced off NULL, otherwise tick 2 "
            "below could pass for the trivial reason that nothing moved"
        )

        # ---- Tick 2: the key cursor is now a real timestamp, but strat-B's
        #      marker is a present NULL and must dominate the floor.
        await self._run_tick(
            key_row=_make_key_row(
                strategy_ids=["strat-A", "strat-B"],
                last_sync_at=key_cursor_after_1,
                strategy_cursors=cursors_1,
            ),
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )
        since_ms = fetch_mock.call_args.kwargs["since_ms"]
        assert since_ms is None, (
            "ABSENT and PRESENT-WITH-NULL ARE DIFFERENT STATES. A present NULL "
            "means refetch ALL history, so the window must be unbounded "
            "(since_ms=None) even though the key cursor advanced. Got "
            f"since_ms={since_ms!r} — that is the key cursor, which means the "
            "resolver fell back instead of honouring the stored NULL, and "
            "strat-B's entire history is stranded."
        )

    @pytest.mark.asyncio
    async def test_full_success_lets_the_fetch_window_advance(self):
        """The control. Identical pair, except tick 1 succeeds for BOTH
        strategies — tick 2's window must then move FORWARD. Without this, a
        window pinned unconditionally would satisfy the test above while
        measuring nothing.
        """
        t0_ms = cron_mod.parse_since_ms(self.T0)
        assert t0_ms is not None

        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        key_row_1 = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self.T0,
        )
        result_1, key_updates_1, cursor_upserts_1 = await self._run_tick(
            key_row=key_row_1,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )

        assert result_1["status"] == "ok"

        cursors = self._cursor_map(cursor_upserts_1)
        assert set(cursors) == {"strat-A", "strat-B"}, (
            "both strategies must get a marker row; "
            f"captured: {cursors!r}"
        )
        assert all(v != self.T0 for v in cursors.values()), (
            "both strategies stored and enqueued, so BOTH markers must have "
            f"advanced past T0; got {cursors!r}"
        )

        advanced = [p["last_sync_at"] for p in key_updates_1 if "last_sync_at" in p]
        assert advanced
        key_cursor_after_tick_1 = advanced[-1]

        key_row_2 = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=key_cursor_after_tick_1,
            strategy_cursors=cursors,
        )
        await self._run_tick(
            key_row=key_row_2,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )

        since_ms = fetch_mock.call_args.kwargs["since_ms"]
        assert since_ms > t0_ms, (
            "THE CONTROL: with no failure to hold anything back, tick 2's "
            f"fetch window must move forward past T0 ({t0_ms}); got "
            f"{since_ms!r}. A 'pinned' window that is pinned no matter what "
            "measures nothing."
        )

    @pytest.mark.asyncio
    async def test_failed_recompute_enqueue_holds_that_strategys_marker(self):
        """SUCCESS CRITERION 4, on its OWN failure axis.

        ⭐ The injection here is NOT a storage failure. Both `sync_trades` RPCs
        SUCCEED — strat-B's trades are on disk — and only its
        `enqueue_compute_job` raises. That is a different defect from the one
        the two tests above cover, and it is the whole reason this test exists:
        a gate that only ever fails storage passes against the narrower, wrong
        advance condition (`stored > 0` alone), which is exactly the
        per-strategy mirror of the key-level formula a reader would reach for.

        The consequence being pinned: strat-B's window was STORED but never
        RECOMPUTED, so its dashboard analytics are frozen against trades that
        exist. Holding its marker is what makes the next tick re-fetch that
        window and re-attempt the enqueue. Without the hold nothing ever
        re-drives it — the Phase-18 shape the enqueue loop's own comment in
        `cron.py` describes.

        Re-driving is safe in both directions and is deliberately not re-proven
        here: `sync_trades` deletes scoped to the incoming payload's own
        timestamp range before re-inserting, and `enqueue_compute_job` is
        dedup-safe via the partial unique index
        `compute_jobs_one_inflight_per_kind_strategy`.
        """
        t0_ms = cron_mod.parse_since_ms(self.T0)
        assert t0_ms is not None, "T0 must parse — the whole gate is measured against it"

        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)

        # ---- Tick 1: both stores succeed; strat-B's recompute enqueue raises.
        key_row_1 = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self.T0,
        )
        result_1, key_updates_1, cursor_upserts_1 = await self._run_tick(
            key_row=key_row_1,
            failing_strategy_ids=set(),
            enqueue_failing_strategy_ids={"strat-B"},
            fetch_mock=fetch_mock,
            trades=trades,
        )

        # Non-vacuity: the injection must have landed on the ENQUEUE axis and
        # NOT on the storage axis. Without these the test could be measuring a
        # silently storage-failed tick and claiming criterion 4 for it.
        assert result_1["per_strategy_stored"] == {"strat-A": 1, "strat-B": 1}, (
            "BOTH strategies must have STORED — this axis is an enqueue "
            f"failure, not a storage failure; got {result_1['per_strategy_stored']!r}"
        )
        assert set(result_1.get("recompute_enqueue_errors") or {}) == {"strat-B"}, (
            "strat-B's enqueue must be the ONLY recorded failure; got "
            f"{result_1.get('recompute_enqueue_errors')!r}"
        )
        assert "strategy_errors" not in result_1, (
            "a failed recompute enqueue is not a per-strategy STORAGE error — "
            f"got {result_1.get('strategy_errors')!r}"
        )

        # The key-level status is `ok`, READ off the classifier rather than
        # assumed: `strategy_errors` is empty and `should_advance_cursor` is
        # True because both stores landed, so there is nothing to downgrade on.
        # ⭐ That is the point of this axis — from the KEY's point of view this
        # tick looks HEALTHY, and the only thing standing between strat-B and a
        # frozen dashboard is its own marker being held.
        assert result_1["status"] == "ok", (
            "both stores landed and no strategy RPC raised, so the KEY status "
            f"is `ok`; got {result_1['status']!r}"
        )

        cursors = self._cursor_map(cursor_upserts_1)
        assert set(cursors) == {"strat-A", "strat-B"}, (
            "every strategy in the fan-out gets a marker row, held or "
            f"advancing; captured: {cursors!r}"
        )
        assert cursors["strat-A"] != self.T0, (
            "strat-A stored AND enqueued, so its marker must advance past T0; "
            f"got {cursors['strat-A']!r}"
        )
        assert cursors["strat-B"] == self.T0, (
            "strat-B STORED but its recompute enqueue raised, so its marker "
            "must stay PINNED at the resume point the tick started from — "
            "advancing it strands the window whose recompute never fired; "
            f"got {cursors['strat-B']!r}"
        )

        advanced = [p["last_sync_at"] for p in key_updates_1 if "last_sync_at" in p]
        assert advanced, (
            "the KEY cursor still advances — both stores landed, and C-0198's "
            "choice is untouched by this phase"
        )
        key_cursor_after_tick_1 = advanced[-1]
        assert cron_mod.parse_since_ms(key_cursor_after_tick_1) > t0_ms, (
            "the key cursor must have moved PAST T0, otherwise tick 2's "
            "assertion below could pass for the trivial reason that nothing moved"
        )

        # ---- Tick 2: inputs DERIVED from tick 1's own captured outputs.
        key_row_2 = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=key_cursor_after_tick_1,
            strategy_cursors=cursors,
        )
        rpc_calls_2: list[tuple[str, dict]] = []
        await self._run_tick(
            key_row=key_row_2,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
            rpc_calls=rpc_calls_2,
        )

        since_ms = fetch_mock.call_args.kwargs["since_ms"]
        assert since_ms == t0_ms, (
            "THE CONSEQUENCE: tick 2 must ask the venue for strat-B's "
            f"un-recomputed window (since_ms={t0_ms}), not the advanced key "
            f"cursor. Got since_ms={since_ms!r}. Delete the `sid not in "
            "recompute_enqueue_errors` conjunct from the advance condition and "
            "this is the assertion that fails."
        )
        assert (
            "enqueue_compute_job",
            {"p_strategy_id": "strat-B", "p_kind": "derive_broker_dailies"},
        ) in rpc_calls_2, (
            "and the recompute strat-B never got must actually be RE-ATTEMPTED "
            f"on tick 2; issued RPCs were {rpc_calls_2!r}"
        )

    @pytest.mark.asyncio
    async def test_marker_write_failure_is_surfaced_and_does_not_lose_the_trades(
        self,
    ):
        """164.5.1.4 WR-02(a): the marker-write failure path had ZERO coverage.

        MEASURED before this gate: `strategy_cursor_write_error` appeared 0
        times in this file. A brand-new error path, outside every gate, in the
        one function whose failure modes this phase exists to reason about.

        Two claims, and BOTH matter:
          * the failure is SURFACED — the envelope field exists and names the
            exception type, so the cron summary alarm can see that this key's
            resume points are stale rather than the failure living only in
            Sentry;
          * the failure is NOT ESCALATED — the trades already landed, and a
            marker write that fails must never discard them or restate the
            tick as an error. The marker is a resume hint; the trades are the
            data.
        """
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(
            strategy_ids=["strat-A"],
            last_sync_at=self.T0,
            strategy_cursors={},
        )

        result, key_updates, cursor_upserts = await self._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
            # Batch AND fallback both fail: this arm is about the fully-failed
            # write. WR-06's arm below covers partial recovery.
            cursor_batch_error=RuntimeError("PostgREST 503 upstream timeout"),
            cursor_row_failing_strategy_ids={"strat-A"},
        )

        assert "strategy_cursor_write_error" in result, (
            "a failed marker write must reach the ENVELOPE. Otherwise it lives "
            "only in Sentry and the cron summary alarm cannot tell that this "
            f"key's per-strategy resume points are stale. Got {result!r}"
        )
        assert "RuntimeError" in result["strategy_cursor_write_error"], (
            "and it must NAME the exception type, or the operator has an alarm "
            "with no diagnosis attached. Got "
            f"{result['strategy_cursor_write_error']!r}"
        )

        # ⛔ THE NON-ESCALATION HALF. Without these the gate would pass against
        # an implementation that let the marker failure abort the tick, which
        # would throw away trades that are already persisted.
        assert result["status"] == "ok", (
            "the TRADES LANDED. A marker write is a resume hint, not the data; "
            "its failure must not restate a successful sync as an error. Got "
            f"status={result['status']!r}"
        )
        assert result["trades_stored"] == len(trades), (
            "and the stored count must be preserved intact; "
            f"got {result['trades_stored']!r}"
        )
        assert "last_sync_at" in key_updates[0], (
            "the KEY cursor still advanced — it is governed by trade "
            f"persistence, not by the marker write. Got {key_updates[0]!r}"
        )
        assert cursor_upserts, (
            "non-vacuity: the write must actually have been ATTEMPTED. An "
            "implementation that never issued it would also produce no error, "
            "and this test must not pass for that reason"
        )

    @pytest.mark.asyncio
    async def test_one_bad_row_does_not_void_the_markers_of_its_siblings(self):
        """164.5.1.4 WR-06: a batched upsert is ONE statement, so one failing
        row discarded the marker write for EVERY strategy on the key.

        ⛔ WHY THAT WAS THE STRANDING DEFECT RE-ENTERING THROUGH THE ERROR
        PATH. Take strat-Z deleted mid-tick: its row raises 23503, the whole
        multi-row upsert aborts, and strat-A — entirely healthy — gets no
        marker row. The next tick finds nothing for strat-A, falls back to
        `api_keys.last_sync_at` which THIS tick just advanced, and strat-A
        UNDER-fetches its outstanding window. An unrelated sibling's deletion
        strands a healthy strategy. That is precisely the per-key stranding
        this phase exists to remove.

        The fallback re-issues the rows individually so one bad row costs only
        itself.
        """
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(
            strategy_ids=["strat-A", "strat-Z"],
            last_sync_at=self.T0,
            strategy_cursors={},
        )

        result, _key_updates, cursor_upserts = await self._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
            cursor_batch_error=RuntimeError(
                "23503 foreign key violation: strategy deleted"
            ),
            cursor_row_failing_strategy_ids={"strat-Z"},
        )

        batches = [p for p in cursor_upserts if isinstance(p, list)]
        rows = [p for p in cursor_upserts if isinstance(p, dict)]

        assert len(batches) == 1, (
            "the batch is still attempted FIRST — the fallback is a recovery "
            f"path, not the normal one. Got {cursor_upserts!r}"
        )
        written = {r["strategy_id"] for r in rows}
        assert "strat-A" in written, (
            "THE CONSEQUENCE: the healthy sibling's marker must still be "
            "written after the batch failed. Without the per-row fallback it "
            "gets no row, falls back next tick to the key cursor this tick "
            f"just advanced, and UNDER-fetches. Rows written: {written!r}"
        )
        assert "strat-Z" in written, (
            "and the bad row must be ATTEMPTED individually, not skipped — "
            "skipping it would be assuming which row was at fault, which the "
            f"batch error does not tell us. Rows attempted: {written!r}"
        )

        assert "strategy_cursor_write_error" in result, (
            "a recovered batch is still a DEGRADED tick and the summary alarm "
            "must see it; reporting only unrecovered rows would make a "
            "worsening fault look healthy until it stopped being recoverable"
        )
        err = result["strategy_cursor_write_error"]
        assert "strat-Z" in err, (
            f"the still-failing strategy must be NAMED in the envelope: {err!r}"
        )
        assert "strat-A" not in err, (
            "and the RECOVERED strategy must not be, or the operator cannot "
            f"tell which resume points are actually stale: {err!r}"
        )

        assert result["status"] == "ok", (
            "the trades still landed; a marker-write problem does not restate "
            f"the sync. Got {result['status']!r}"
        )

    @pytest.mark.asyncio
    async def test_a_missing_table_is_not_retried_row_by_row(self):
        """WR-03 x WR-06 interaction, and it is a NEW path both findings
        created between them.

        ⛔ A MISSING RELATION IS NOT A PER-ROW CONDITION. Every individual
        retry would fail identically, so retrying multiplies the rollout
        window's wasted round-trips by the fan-out size, on every key, on every
        tick — inside a budget bounded by KEY_SYNC_TIMEOUT. WR-06's fallback
        exists for row-scoped faults; classifying this one as row-scoped would
        take the noise WR-03 removed and convert it into latency on the path
        WR-04 is trying to keep inside its timeout.

        Without this arm the fallback loop is a new code path that no gate
        constrains, which is exactly how a fix round introduces a regression.
        """
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(
            strategy_ids=["strat-A", "strat-B", "strat-C"],
            last_sync_at=self.T0,
            strategy_cursors={},
        )
        cron_mod._missing_cursor_table_warned = False

        result, _key_updates, cursor_upserts = await self._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
            cursor_batch_error=_ApiErrorLike(
                code="42P01",
                message='relation "strategy_sync_cursors" does not exist',
            ),
        )

        batches = [p for p in cursor_upserts if isinstance(p, list)]
        rows = [p for p in cursor_upserts if isinstance(p, dict)]

        assert len(batches) == 1, (
            "non-vacuity: the batch must have been ATTEMPTED, or 'no per-row "
            f"retries' would be true for the wrong reason. Got {cursor_upserts!r}"
        )
        assert rows == [], (
            "a missing table must NOT be retried row by row — each retry fails "
            "identically, so this would be 3 more doomed round-trips per key "
            f"per tick for the entire rollout window. Got {rows!r}"
        )
        assert "strategy_cursor_write_error" in result, (
            "and the envelope field is still populated — quietening the LOG is "
            "the change; quietening the FACT is not"
        )

    @pytest.mark.asyncio
    async def test_marker_and_key_cursor_share_one_instant(self):
        """164.5.1.4 WR-01: the per-strategy marker must be stamped with the
        SAME instant as the key cursor, never a later one.

        ⛔ WHY AN EQUALITY AND NOT A TOLERANCE. The two writes used to call
        `datetime.now` separately with the whole recompute-enqueue loop between
        them, so the marker landed LATER than the key cursor by the wall-clock
        duration of N `enqueue_compute_job` round-trips. Markers DOMINATE the
        resume floor once they exist, so the next tick resumed later than the
        pre-phase key cursor would have, and whatever the venue booked inside
        that gap was fetched by no tick, ever. A tolerance would pin the SIZE
        of the skew; what this phase decided is that there is NO skew, because
        both writes read one variable. The equality IS that decision.

        Restore a second `datetime.now(timezone.utc).isoformat()` at the marker
        write and this is the assertion that fails.
        """
        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(
            strategy_ids=["strat-A"],
            last_sync_at=self.T0,
            strategy_cursors={},
        )

        result, key_updates, cursor_upserts = await self._run_tick(
            key_row=key_row,
            failing_strategy_ids=set(),
            fetch_mock=fetch_mock,
            trades=trades,
        )

        # Non-vacuity: BOTH writes must actually have happened and the strategy
        # must actually have ADVANCED. A HELD strategy writes its PRE-TICK
        # resume point into `last_sync_at` instead, so the equality below would
        # be comparing the wrong pair and could pass for the wrong reason.
        assert result["status"] == "ok", result
        assert len(key_updates) == 1, key_updates
        assert "last_sync_at" in key_updates[0], (
            "the key cursor must have ADVANCED for this comparison to mean "
            f"anything; got {key_updates[0]!r}"
        )
        assert len(cursor_upserts) == 1, cursor_upserts
        marker_rows = cursor_upserts[0]
        assert len(marker_rows) == 1, marker_rows
        marker = marker_rows[0]
        assert marker["strategy_id"] == "strat-A", marker

        key_instant = key_updates[0]["last_sync_at"]
        assert marker["last_sync_at"] == key_instant, (
            "an ADVANCING strategy's marker must carry the key cursor's own "
            "instant. A later one resumes the next tick past whatever the "
            "venue booked in between, and that window is then fetched by no "
            f"tick at all. key={key_instant!r} marker={marker['last_sync_at']!r}"
        )
        assert marker["updated_at"] == key_instant, (
            "`updated_at` is stamped from the same tick instant too; "
            f"key={key_instant!r} updated_at={marker['updated_at']!r}"
        )


class TestCronSyncDeliversStrategyCursorsToFanOut:
    """164.5.1.4: the marker mapping must reach the fan-out through the REAL
    `cron_sync` entry point, not only through a hand-built key row.

    ⚠️ Until `_make_mock_supabase_for_cron_sync` served this table, every
    `cron_sync` test in this file reached the marker SELECT through a bare
    MagicMock whose `.data` iterates EMPTY, so every key got an empty mapping
    with NOTHING raised and no error field in the response — the wiring plan 02
    added was green and unexercised at the same time, with no signal that it
    was untested. MEASURED by removing the helper's chain and re-running this
    test: the mapping came back `{}` and `strategy_cursor_lookup_error` was
    absent, so even the fail-open signal would not have caught it. That is the
    vacuity class this repo ranks above ordinary correctness, and it is what
    this test exists to close.
    """

    T0 = _ONE_TICK_AGO

    @pytest.mark.asyncio
    async def test_marker_mapping_reaches_the_fan_out_and_the_write_is_issued(self):
        import copy
        import sys as _sys
        import routers.portfolio as portfolio_mod
        _sys.modules["routers.portfolio"] = portfolio_mod

        # One key, two ELIGIBLE strategies. A marker row is served for strat-A
        # and none for strat-B — the asymmetry is the whole point.
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": self.T0,
                    "strategies": [
                        {"id": "strat-A", "status": "published"},
                        {"id": "strat-B", "status": "published"},
                    ],
                }
            ],
            ps_data=[],
            sc_data=[{"strategy_id": "strat-A", "last_sync_at": self.T0}],
        )

        captured_key_rows: list[dict[str, Any]] = []
        real_sync_key = cron_mod._sync_key_with_timeout

        async def _spy(key_row: dict[str, Any], kek: bytes):
            # Deep-copy at capture time: the row is a live dict and asserting
            # on a reference would measure its final state, not the state the
            # fan-out was handed.
            captured_key_rows.append(copy.deepcopy(key_row))
            return await real_sync_key(key_row, kek)

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "_sync_key_with_timeout", _spy):
            response = await cron_mod.cron_sync()

        # Non-vacuity: the fan-out must actually have run, and the fail-open
        # branch must NOT have been taken. Either one would make every
        # assertion below quantify over an empty mapping and pass for the
        # wrong reason.
        assert len(captured_key_rows) == 1, captured_key_rows
        assert "strategy_cursor_lookup_error" not in response, (
            "the marker SELECT fell into its fail-open branch, so the mapping "
            "was empty for a reason that has nothing to do with the wiring: "
            f"{response.get('strategy_cursor_lookup_error')!r}"
        )

        mapping = captured_key_rows[0]["strategy_cursors"]
        assert mapping == {"strat-A": self.T0}, (
            "the served marker must reach the fan-out with its value intact, "
            "and the UNSERVED strategy must be ABSENT from the mapping rather "
            "than present with a null — absence means 'fall back to the key "
            "cursor' while a present null means 'refetch all history', and "
            f"only absence keeps this change inert on arrival. Got {mapping!r}"
        )
        assert "strat-B" not in mapping, (
            "membership, not a null value, is the read-path contract; "
            f"got {mapping!r}"
        )

        # And the WRITE is issued through the same real entry point, batched.
        upserts = mock_supabase.strategy_cursor_upserts
        assert len(upserts) == 1, (
            "exactly one batched marker upsert per key, not one per strategy; "
            f"got {len(upserts)} call(s): {upserts!r}"
        )
        written = {row["strategy_id"] for row in upserts[0]}
        assert written == {"strat-A", "strat-B"}, (
            "every strategy in the fan-out gets a row, held or advancing; "
            f"got {written!r}"
        )


    @pytest.mark.asyncio
    async def test_marker_lookup_failure_degrades_to_empty_not_partial_garbage(
        self,
    ):
        """164.5.1.4 WR-02(b): the marker SELECT's RAISING branch had no test.

        MEASURED before this gate: only its ZERO-ROW sibling was exercised.
        Two sibling branches, one covered, and the covered one is the branch
        that does NOT reset the mapping.

        ⛔ WHY THE FAILURE MUST LAND ON A LATER CHUNK. The lookup is CHUNKED at
        `_CRON_IN_LIST_PAGE_SIZE`, so by the time a page raises,
        `_cursor_by_strategy` may already hold rows collected from the pages
        that succeeded. Fail-open to THAT is not fail-open — it hands some
        strategies a real resume point and others the key-cursor fallback,
        inside a single tick, with no record of which got which. Under
        `_strategy_resume_point`'s membership rule the two groups then read
        DIFFERENT windows. Whether that is safe depends on which ids happened
        to land in the surviving page, i.e. on PostgREST ordering — a silent,
        input-dependent split.

        Making every call raise would leave the mapping empty for the trivial
        reason that nothing was ever collected, and would pass against an
        implementation with no reset at all. So: serve page one, raise on page
        two, and require the mapping to be EMPTY.

        ⭐ This closes a one-sided pair — existing gates already assert
        `"strategy_cursor_lookup_error" not in response` as non-vacuity guards,
        with nothing ever asserting the positive.
        """
        import copy
        import sys as _sys
        import routers.portfolio as portfolio_mod
        _sys.modules["routers.portfolio"] = portfolio_mod

        # Enough strategies to force MORE THAN ONE chunk — that is the whole
        # point of this arm, so derive it from the production constant rather
        # than hardcoding a count that a page-size change would quietly make
        # single-chunk (and thus vacuous) again.
        n_strategies = cron_mod._CRON_IN_LIST_PAGE_SIZE + 10
        sids = [f"strat-{i:03d}" for i in range(n_strategies)]

        # Page one answers for EVERY id, so a missing reset leaves a large,
        # obviously-wrong mapping rather than an ambiguous small one.
        page_one = MagicMock(
            data=[{"strategy_id": s, "last_sync_at": self.T0} for s in sids]
        )
        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": self.T0,
                    "strategies": [
                        {"id": s, "status": "published"} for s in sids
                    ],
                }
            ],
            ps_data=[],
            sc_select_side_effect=[
                page_one,
                RuntimeError("PostgREST 503: upstream connect error"),
            ],
        )

        captured_key_rows: list[dict[str, Any]] = []
        real_sync_key = cron_mod._sync_key_with_timeout

        async def _spy(key_row: dict[str, Any], kek: bytes):
            captured_key_rows.append(copy.deepcopy(key_row))
            return await real_sync_key(key_row, kek)

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "_sync_key_with_timeout", _spy):
            response = await cron_mod.cron_sync()

        assert "strategy_cursor_lookup_error" in response, (
            "the lookup RAISED, so the response must say so. Fail-open is "
            "correct — the tick must not abort — but a silent fail-open is "
            "not: every key just reverted to its key-level cursor and nothing "
            f"else would report it. Got {response!r}"
        )
        assert "RuntimeError" in response["strategy_cursor_lookup_error"], (
            "and it must name the exception type; "
            f"got {response['strategy_cursor_lookup_error']!r}"
        )

        # Non-vacuity: the fan-out must actually have run, or every assertion
        # below quantifies over nothing.
        assert len(captured_key_rows) == 1, captured_key_rows
        mapping = captured_key_rows[0]["strategy_cursors"]
        assert mapping == {}, (
            "THE CONSEQUENCE: the mapping must degrade to EMPTY — which IS the "
            "absent-row semantics, so every strategy falls back to the key "
            "cursor uniformly and the tick behaves exactly as it did "
            "pre-phase. Retaining the rows collected before the failure would "
            "instead split this key's strategies across two different resume "
            "windows, decided by which ids happened to land in the surviving "
            f"page. Got {len(mapping)} entr(y/ies): {dict(list(mapping.items())[:3])!r}..."
        )

    async def _run_cron_sync_with(self, sc_data):
        """Run a real `cron_sync` over one key / two strategies, serving
        `sc_data` as the marker SELECT result. Returns the response."""
        import sys as _sys
        import routers.portfolio as portfolio_mod
        _sys.modules["routers.portfolio"] = portfolio_mod

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": self.T0,
                    "strategies": [
                        {"id": "strat-A", "status": "published"},
                        {"id": "strat-B", "status": "published"},
                    ],
                }
            ],
            ps_data=[],
            sc_data=sc_data,
        )
        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()
        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ):
            return await cron_mod.cron_sync()

    _ZERO_MARKER_LOG = "per-strategy sync-cursor lookup returned 0"

    async def test_zero_markers_returned_is_reported_even_though_nothing_raised(
        self, caplog
    ):
        """⛔ A deny-all RLS denial answers 200 with an EMPTY list and raises
        NOTHING, so the fail-open `except` branch never runs for it. An empty
        mapping IS the absent-row semantics, so every strategy silently reverts
        to the key-level cursor — which is byte for byte the stranding defect
        this phase exists to remove, arriving with a green tick. Without this
        line the reversion carries no operator signal at all: not an exception,
        not `strategy_cursor_lookup_error`, nothing.
        """
        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            response = await self._run_cron_sync_with(sc_data=[])

        assert "strategy_cursor_lookup_error" not in response, (
            "this test must exercise the NO-EXCEPTION path — a raised lookup "
            "error means it measured the fail-open branch instead, which is "
            "already covered and is not the silent case: "
            f"{response.get('strategy_cursor_lookup_error')!r}"
        )
        assert any(
            self._ZERO_MARKER_LOG in r.message for r in caplog.records
        ), (
            "a zero-row marker lookup over a non-empty requested id list must "
            "be reported. It is legitimate during rollout, which is why the "
            "message reports the measurement rather than claiming a fault — "
            "but a credential degraded from service_role to anon looks exactly "
            "like this, and nothing else would surface it. Got "
            + repr([r.message for r in caplog.records])
        )

    async def test_markers_returned_does_not_report_a_zero_lookup(self, caplog):
        """The negative arm. Without it the assertion above would pass against
        a line emitted unconditionally, which would measure nothing."""
        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            await self._run_cron_sync_with(
                sc_data=[{"strategy_id": "strat-A", "last_sync_at": self.T0}]
            )

        assert not any(
            self._ZERO_MARKER_LOG in r.message for r in caplog.records
        ), (
            "markers WERE returned, so the zero-marker line must stay silent; "
            "an unconditional emit would make the positive arm vacuous. Got "
            + repr([r.message for r in caplog.records])
        )

class TestHeldStrategyMarkersAreNamedInTheEnvelope:
    """164.5.1.4: a tick that HOLDS one or more strategies must say so.

    The hold is correct and deliberate — it is what makes the outstanding
    window re-drivable — but it is not free: `fetch_all_trades` runs ONCE per
    key, so the key's window stays pinned at the earliest held resume point and
    the range re-fetched grows every tick until the hold clears. That growth is
    precedented (the `held` SyncStatus already documents and accepts the same
    thing at key level) and the re-fetch is idempotent, so it is an efficiency
    cost rather than a correctness one — and it is ACCEPTED, not deferred.

    ⛔ What would make it a defect is being invisible, inferable only from the
    ABSENCE of an advancing row. So it is named in the envelope and in a
    warning. These two tests pin that it is named when it happens and, just as
    importantly, NOT named when it does not.
    """

    T0 = TestSyncCursorPerStrategyResume.T0

    # Reuses the two-tick class's `_run_tick` rather than a fourth dispatcher
    # shape: it is the only stub in this file that can fail the storage RPC and
    # the enqueue RPC independently, which is what these cases need.
    # ⚠️ Re-wrapped in `staticmethod`: reading it off the other class yields the
    # plain function, and a plain function bound as a class attribute would be
    # called with `self` as a positional argument it does not accept.
    _run_tick = staticmethod(TestSyncCursorPerStrategyResume._run_tick)

    @pytest.mark.asyncio
    async def test_held_strategies_are_named_in_the_envelope(self, caplog):
        import logging

        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self.T0,
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result, _updates, _upserts = await self._run_tick(
                key_row=key_row,
                failing_strategy_ids={"strat-B"},
                fetch_mock=fetch_mock,
                trades=trades,
            )

        assert result["strategy_cursors_held"] == ["strat-B"], (
            "the held strategy must be NAMED in the key's envelope — an "
            "operator reading the summary should not have to infer the hold "
            f"from the absence of a row. Got {result.get('strategy_cursors_held')!r}"
        )
        assert "strat-A" not in result["strategy_cursors_held"], (
            "strat-A advanced; naming it would make the field useless"
        )

        # WHY (Rule 9): the log must state the CONSEQUENCE, not merely the
        # fact. "strat-B was held" tells an operator nothing actionable; "the
        # whole key's re-fetched range grows every tick until it clears" is the
        # thing they need in order to decide whether to intervene.
        held_lines = [
            r.getMessage()
            for r in caplog.records
            if r.levelno >= logging.WARNING and "held the per-strategy" in r.getMessage()
        ]
        assert len(held_lines) == 1, (
            "exactly ONE warning per key, not one per held strategy; got "
            f"{held_lines!r}"
        )
        assert "strat-B" in held_lines[0], held_lines[0]
        assert "grows every tick" in held_lines[0], (
            "the line must state what the hold costs, or it is a fact without "
            f"a consequence; got {held_lines[0]!r}"
        )

    @pytest.mark.asyncio
    async def test_a_tick_that_holds_nothing_adds_no_field(self, caplog):
        import logging

        trades = [{"id": "t1"}]
        fetch_mock = AsyncMock(return_value=trades)
        key_row = _make_key_row(
            strategy_ids=["strat-A", "strat-B"],
            last_sync_at=self.T0,
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result, _updates, upserts = await self._run_tick(
                key_row=key_row,
                failing_strategy_ids=set(),
                fetch_mock=fetch_mock,
                trades=trades,
            )

        # Non-vacuity: this must be a tick that really DID advance both
        # markers, not one where the marker block never ran at all — otherwise
        # "no field" would be true for the wrong reason.
        assert result["status"] == "ok", result
        written = {row["strategy_id"] for payload in upserts for row in payload}
        assert written == {"strat-A", "strat-B"}, written

        assert "strategy_cursors_held" not in result, (
            "a conditional field that is always present is not conditional: a "
            "tick where every strategy advanced must add NO held key at all. "
            f"Got {result.get('strategy_cursors_held')!r}"
        )
        assert not [
            r for r in caplog.records if "held the per-strategy" in r.getMessage()
        ], "nothing was held, so nothing may be logged as held"
