"""FLIPRETRY-01 — every derived-equity exchange crawl is hard-bounded.

The v1.11 FLIP wedge root cause: a slow/hanging live exchange crawl inside
``run_derive_broker_dailies_job`` (the deribit native-ledger cash pass ~inception,
or the bybit 19k-row ccxt transfers) blocked the SEQUENTIAL worker's event loop on
an unbounded ``await`` → healthz went stale for 12 minutes. The fix (mirroring the
phase-120 sFOX ``wait_for`` pattern EXACTLY): wrap each crawl in
``asyncio.wait_for(..., timeout=_BROKER_CRAWL_TIMEOUT_S)`` so a hang becomes a
CLASSIFIED TRANSIENT failure (retryable, no terminal stamp), never a wedge.

These are fake-hang wiring tests (Rule 9): the crawl coroutine sleeps past a
monkeypatched sub-second bound; the handler must return a transient FAILED within
wall-clock seconds — proving the bound FIRED (not the sleep). The deribit test
additionally asserts ``error_kind == "transient"`` (NOT ``"permanent"``): in
Python 3.11+ ``asyncio.TimeoutError IS builtins.TimeoutError`` (an ``OSError``
subclass), so the new ``except asyncio.TimeoutError`` arm MUST precede the broader
permanent-stamping arms in the :2309 chain — a mis-ordered arm would dispose the
timeout PERMANENT and defeat the retry intent.
"""
from __future__ import annotations

import asyncio
import types
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import services.job_worker as jw
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job


# ---------------------------------------------------------------------------
# ctx / patch helpers (mirror test_sfox_reconstruct._sfox_ctx)
# ---------------------------------------------------------------------------
def _ctx(exchange: str) -> tuple[MagicMock, dict]:
    """A worker ctx whose supabase captures upserts. strategy_row stays a
    MagicMock (NOT a dict) so the venue-agnostic denominator-config parse resolves
    to None (defaults)."""
    capture: dict = {"upserts": []}
    ctx = MagicMock()
    ctx.exchange = MagicMock()
    ctx.supabase = MagicMock()
    ctx.key_row = {"id": "key-x", "user_id": "alloc-1", "exchange": exchange}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture["upserts"].append((name, payload, kw.get("on_conflict")))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert
        tbl.insert.side_effect = lambda *a, **k: MagicMock(
            execute=MagicMock(return_value=MagicMock(data=[{"id": "x"}]))
        )
        return tbl

    ctx.supabase.table.side_effect = _table
    return ctx, capture


def _common_patches(ctx: MagicMock) -> list:
    """Preflight → ctx, close chokepoint + db_execute stubbed (strategy-mode)."""
    return [
        patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


def _job() -> dict:
    return {"strategy_id": "s-flipretry"}


def _deribit_account_state() -> types.SimpleNamespace:
    """A healthy native anchor: passes the :2281 zero-anchor guard so execution
    reaches the cash-pass crawl."""
    return types.SimpleNamespace(
        balance_error=False,
        native_equity={"BTC": 1.0},
        collapsed_equity_usd=1000.0,
        collapsed_upnl_usd=0.0,
        upnl_unreadable=False,
    )


async def _hang(*a, **k):
    await asyncio.sleep(30)  # far past the monkeypatched sub-second bound


# ---------------------------------------------------------------------------
# Test 1 — deribit cash pass hang → TRANSIENT (arm ordering: NOT permanent)
# ---------------------------------------------------------------------------
async def test_deribit_cash_pass_hang_is_bounded_transient_not_permanent(monkeypatch):
    """C1: build_deribit_native_ledger (the cash pass) hangs → cut at the per-crawl
    bound → transient FAILED. Asserts NOT permanent: the new except asyncio.TimeoutError
    arm precedes the permanent-stamping LedgerCompleteness/LedgerValuation/Nav arms
    (in 3.11+ TimeoutError IS OSError, so a mis-ordered arm would stamp permanent)."""
    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    ctx, capture = _ctx("deribit")
    patches = _common_patches(ctx) + [
        patch(
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=AsyncMock(return_value=_deribit_account_state()),
        ),
        patch(
            "services.deribit_ingest.build_deribit_native_ledger",
            new=AsyncMock(side_effect=_hang),
        ),
    ]
    with _apply(patches):
        result = await asyncio.wait_for(
            run_derive_broker_dailies_job(_job()), timeout=3.0
        )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"  # retryable, NOT permanent
    assert result.error_kind != "permanent"
    assert "FLIPRETRY-01" in (result.error_message or "")
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert not stamps, "a bounded hang is transient — never a terminal stamp"


# ---------------------------------------------------------------------------
# Test 2 — ccxt transfers hang → TRANSIENT
# ---------------------------------------------------------------------------
async def test_ccxt_transfers_hang_is_bounded_transient(monkeypatch):
    """C2: fetch_ccxt_transfers hangs on the ccxt venue (bybit) → cut at the
    per-crawl bound → transient FAILED within the bound."""
    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    ctx, capture = _ctx("bybit")
    patches = _common_patches(ctx) + [
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(1000.0, False, 0.0, False)),
        ),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch(
            "services.funding_fetch.fetch_funding_bybit",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "services.ccxt_flow_fetch.fetch_ccxt_transfers",
            new=AsyncMock(side_effect=_hang),
        ),
    ]
    with _apply(patches):
        result = await asyncio.wait_for(
            run_derive_broker_dailies_job(_job()), timeout=3.0
        )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert "FLIPRETRY-01" in (result.error_message or "")


# ---------------------------------------------------------------------------
# Test 3 — ccxt price-index hang → TRANSIENT
# ---------------------------------------------------------------------------
async def test_ccxt_price_index_hang_is_bounded_transient(monkeypatch):
    """C3: _resolve_ccxt_flow_price_index hangs (it may hit venue OHLCV I/O) →
    cut at the per-crawl bound → transient FAILED. The transfers crawl returns
    fast so the hang is isolated to the price-index resolve."""
    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    ctx, capture = _ctx("bybit")
    patches = _common_patches(ctx) + [
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(1000.0, False, 0.0, False)),
        ),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch(
            "services.funding_fetch.fetch_funding_bybit",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "services.ccxt_flow_fetch.fetch_ccxt_transfers",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "services.job_worker._resolve_ccxt_flow_price_index",
            new=AsyncMock(side_effect=_hang),
        ),
    ]
    with _apply(patches):
        result = await asyncio.wait_for(
            run_derive_broker_dailies_job(_job()), timeout=3.0
        )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert "FLIPRETRY-01" in (result.error_message or "")


# ---------------------------------------------------------------------------
# Test 4 — behavior-neutral: a FAST non-timeout crawl error still bubbles to the
# existing permanent arm (the wrap only intercepts timeouts)
# ---------------------------------------------------------------------------
async def test_deribit_fast_structural_error_still_permanent_wrap_is_transparent(monkeypatch):
    """The wait_for wrap is behavior-neutral on the happy/error path: a fast crawl
    that raises a STRUCTURAL LedgerValuationError still flows to the pre-existing
    permanent-disposition arm (never swallowed / mis-classified transient by the new
    TimeoutError arm). Proves the wrap passes non-timeout exceptions through
    unchanged AND pins the arm ordering from the other side."""
    from services.deribit_txn import LedgerValuationError

    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 300.0)
    ctx, capture = _ctx("deribit")
    patches = _common_patches(ctx) + [
        patch(
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=AsyncMock(return_value=_deribit_account_state()),
        ),
        patch(
            "services.deribit_ingest.build_deribit_native_ledger",
            new=AsyncMock(side_effect=LedgerValuationError("unvaluable coin cash row")),
        ),
    ]
    with _apply(patches):
        result = await run_derive_broker_dailies_job(_job())
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"  # non-timeout → existing arm, unchanged
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps and stamps[0][1]["computation_status"] == "failed"


# ---------------------------------------------------------------------------
# Test 5 — reconstruct orchestrating crawl hang → TRANSIENT (Task 2, defensive)
# ---------------------------------------------------------------------------
async def test_reconstruct_window_crawl_hang_is_bounded_transient(monkeypatch):
    """The CONTEXT-named legacy path: _fetch_and_price_window (the single
    orchestrating crawl) hangs → cut at the reconstruct per-crawl bound → transient
    FAILED. Defensive half of the A4 mitigation (both pipelines bounded)."""
    import services.equity_reconstruction as er
    from services.equity_reconstruction import run_reconstruct_allocator_history_job

    monkeypatch.setattr(er, "_RECONSTRUCT_CRAWL_TIMEOUT_S", 0.05)
    ctx, _capture = _ctx("bybit")
    job = {"api_key_id": "key-x"}
    patches = [
        patch(
            "services.equity_reconstruction._allocator_key_preflight",
            new=AsyncMock(return_value=ctx),
        ),
        patch("services.equity_reconstruction.aclose_exchange", new=AsyncMock()),
        patch(
            "services.equity_reconstruction._api_key_already_reconstructed",
            new=AsyncMock(return_value=False),
        ),
        patch("services.equity_reconstruction._emit_audit", new=MagicMock()),
        patch(
            "services.equity_reconstruction._fetch_and_price_window",
            new=AsyncMock(side_effect=_hang),
        ),
    ]
    with _apply(patches):
        result = await asyncio.wait_for(
            run_reconstruct_allocator_history_job(job), timeout=3.0
        )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"


# ---------------------------------------------------------------------------
# Source-scan gates: the new bounded sites exist; no logger.exception introduced
# ---------------------------------------------------------------------------
def _strip_comments(text: str) -> str:
    """Drop full-line comments (the grep-gate hygiene rule) so a token inside a
    comment never counts — mirrors test_sfox_reconstruct._stripped_job_worker_source."""
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )


def _deribit_branch_region() -> str:
    text = Path(jw.__file__).read_text()
    start = text.index('if venue == "deribit":')
    end = text.index('elif venue == "sfox":', start)
    return _strip_comments(text[start:end])


def _ccxt_branch_region() -> str:
    text = Path(jw.__file__).read_text()
    # The ccxt arm is the trailing `else:` of the venue dispatch, up to the
    # outer `except ccxt.RateLimitExceeded`.
    start = text.index("\n        else:\n", text.index('elif venue == "sfox":'))
    end = text.index("except ccxt.RateLimitExceeded as exc:", start)
    return _strip_comments(text[start:end])


def test_deribit_cash_pass_is_wait_for_bounded():
    """C1: the deribit cash pass wraps build_deribit_native_ledger in
    asyncio.wait_for on the _BROKER_CRAWL_TIMEOUT_S bound."""
    region = _deribit_branch_region()
    assert "asyncio.wait_for(" in region
    assert "build_deribit_native_ledger" in region
    assert "_BROKER_CRAWL_TIMEOUT_S" in region


def test_ccxt_branch_has_three_bounded_crawls():
    """C2+C3: the ccxt branch wraps BOTH fetch_ccxt_transfers awaits + the
    _resolve_ccxt_flow_price_index await in asyncio.wait_for (>=3 bounds)."""
    region = _ccxt_branch_region()
    assert region.count("asyncio.wait_for(") >= 3
    assert "fetch_ccxt_transfers" in region
    assert "_resolve_ccxt_flow_price_index" in region
    assert "_BROKER_CRAWL_TIMEOUT_S" in region


def test_no_logger_exception_at_new_catch_sites():
    """T-123-02: the new TimeoutError catch sites use logger.warning with static
    scrubbed text — NEVER logger.exception (H-3 HMAC-in-URL leak class)."""
    assert "logger.exception" not in _deribit_branch_region()
    assert "logger.exception" not in _ccxt_branch_region()


def test_broker_crawl_timeout_constant_defined():
    """The bound is a module constant, env-overridable via BROKER_CRAWL_TIMEOUT_S."""
    assert isinstance(jw._BROKER_CRAWL_TIMEOUT_S, float)


# ===========================================================================
# HIGH #2 (specialist fan-out) — the LARGEST crawls were previously UNWRAPPED:
# fetch_all_trades (bybit-19k full history), fetch_account_equity_and_upnl_usd,
# fetch_funding_*, and the deribit anchor fetch_deribit_native_account_state. A
# hang there re-created the exact v1.11 wedge. These pin the new wraps.
# ===========================================================================
async def test_ccxt_fetch_all_trades_hang_is_bounded_transient(monkeypatch):
    """HIGH #2: fetch_all_trades (since_ms=None ⇒ ENTIRE history — the named
    bybit-19k wedge) hangs → cut at the per-crawl bound → transient FAILED, never
    an unbounded wedge of the sequential loop."""
    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    ctx, _capture = _ctx("bybit")
    patches = _common_patches(ctx) + [
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(1000.0, False, 0.0, False)),
        ),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(side_effect=_hang)),
    ]
    with _apply(patches):
        result = await asyncio.wait_for(
            run_derive_broker_dailies_job(_job()), timeout=3.0
        )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert "FLIPRETRY-01" in (result.error_message or "")


async def test_deribit_native_account_state_hang_is_bounded_transient(monkeypatch):
    """HIGH #2: the deribit anchor read fetch_deribit_native_account_state hangs →
    cut at the per-crawl bound and routed to the DeribitTransientReadError retryable
    path (the SAME path the empty-anchor case uses), never an unbounded await."""
    from services.deribit_ingest import DeribitTransientReadError

    monkeypatch.setattr(jw, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    ctx, _capture = _ctx("deribit")
    patches = _common_patches(ctx) + [
        patch(
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=AsyncMock(side_effect=_hang),
        ),
    ]
    with _apply(patches):
        with pytest.raises(DeribitTransientReadError, match="FLIPRETRY-01"):
            await asyncio.wait_for(
                run_derive_broker_dailies_job(_job()), timeout=3.0
            )


def test_ccxt_equity_trades_funding_now_bounded():
    """HIGH #2 source scan: the ccxt equity anchor, full-history trades, and funding
    crawls are now wait_for-wrapped too (previously bare awaits). Total bounded
    awaits in the branch ≥6 (equity + trades + ≥1 funding + 2 transfers + price)."""
    region = _ccxt_branch_region()
    assert "fetch_account_equity_and_upnl_usd" in region
    assert "fetch_all_trades" in region
    assert region.count("asyncio.wait_for(") >= 6


def test_deribit_native_account_state_is_wait_for_bounded():
    """HIGH #2 source scan: the deribit anchor read is wrapped, and a timeout is
    raised as DeribitTransientReadError (the retryable class)."""
    region = _deribit_branch_region()
    assert "fetch_deribit_native_account_state" in region
    assert "DeribitTransientReadError" in region


def test_sfox_txn_crawl_has_own_larger_budget_bound():
    """MED #3: /v1/account/transactions is rate-gated at 10s/req, so the 50-page
    budget needs ~600s. The transactions crawl gets its OWN bound (sized to that
    budget, capped to fit the outer), strictly larger than the balance-history
    bound — else a >30-page ledger false-times-out into an infinite transient
    retry → failed_final."""
    from services.sfox_read import sfox_transactions_crawl_wallclock_budget_s

    assert jw._SFOX_TXN_CRAWL_TIMEOUT_S > jw._SFOX_CRAWL_TIMEOUT_S
    # It is min(rate-budget, outer-fit cap), so never ABOVE the rate budget.
    assert jw._SFOX_TXN_CRAWL_TIMEOUT_S <= sfox_transactions_crawl_wallclock_budget_s() + 1e-6
    text = Path(jw.__file__).read_text()
    sfox_start = text.index('elif venue == "sfox":')
    sfox_end = text.index("\n        else:\n", sfox_start)
    sfox_region = _strip_comments(text[sfox_start:sfox_end])
    assert "_SFOX_TXN_CRAWL_TIMEOUT_S" in sfox_region
    assert "crawl_sfox_transactions" in sfox_region


def test_crawl_bounds_fit_under_outer_budget():
    """Red-team (MED): a per-crawl bound the account can PASS while the OUTER
    wait_for still kills the job mid-persist is no fix. Pin the composition:
    (1) the mirrored outer budget equals the real TIMEOUT_PER_KIND entry;
    (2) sfox bh + txn + post-crawl reserve ≤ outer (serial-sum invariant);
    (3) the deribit/ccxt bound is not tighter than the outer envelope (a bound
        below legit crawl duration manufactures false transients → failed_final)."""
    outer = jw.TIMEOUT_PER_KIND["derive_broker_dailies"]
    assert jw._DERIVE_OUTER_BUDGET_S == outer, "mirrored outer budget drifted from TIMEOUT_PER_KIND"
    assert (
        jw._SFOX_CRAWL_TIMEOUT_S
        + jw._SFOX_TXN_CRAWL_TIMEOUT_S
        + jw._DERIVE_POST_CRAWL_RESERVE_S
        <= outer
    ), "sfox bh + txn + reserve exceeds the outer budget — the outer would kill a legit large account"
    assert jw._BROKER_CRAWL_TIMEOUT_S <= outer
    # And the deribit/ccxt bound is NOT the old flat 300s that false-timed-out
    # OKX/bybit/deribit large accounts (must leave room for their real durations).
    assert jw._BROKER_CRAWL_TIMEOUT_S >= outer - jw._DERIVE_POST_CRAWL_RESERVE_S
