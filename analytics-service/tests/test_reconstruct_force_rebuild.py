"""Phase 167.2.1.1 UPNLVENUES, plan 04: a forced rebuild of an already-reconstructed key (D-02).

WHY these tests exist. ``run_reconstruct_allocator_history_job`` short-circuits to DONE
when ``api_keys.history_reconstructed_at`` is set, so enqueueing the existing kind for a
Bybit key whose curve was anchored on the wrong reading (wallet balance without the open
uPnL) does nothing. D-02 forbids hand SQL writes ("use the product's own job paths"), so
the handler honours one job-metadata flag, ``force_rebuild``. Each test is named for the
rule it guards:

1. The recompute must REACH a marked key: a forced job crawls it and the rebuilt curve's
   last row is the venue's coin equity (walletBalance + open uPnL), read from the payload.
2. The default must not move: no metadata, non-dict metadata, or any flag value other than
   JSON true still short-circuits exactly as before, and an unforced job's
   ``reconstruct_started`` audit metadata is byte-identical.
3. The flag must not be settable by a user: the only authenticated-user RPC that enqueues
   this kind passes no ``p_metadata``.
4. A forced rebuild is an ACCOUNT rebuild (UPNLVENUES D-04, this phase's D-01/D-02, decision
   AR-7), whatever the key count: it crawls every exchange account, sums them, and replaces
   only its window, or refuses and writes nothing. Its pins live in
   `tests/test_reconstruct_whole_account.py`; the refusals that need no second key (an
   empty replay, a stored day the rebuild does not reproduce) stay here.
5. The spelling is a contract with the post-deploy enqueue (plan 06): one literal, pinned.
6. Plan 05, PD-H: a forced rebuild replaces a stored curve in ONE write, so it must refuse
   rather than re-bake a wallet-only anchor. When the curve cannot be anchored to today's
   venue equity including the open uPnL, the job FAILS (error_kind "permanent") with a named
   reason and writes nothing: the seeded rows, the marker and the completion audits are
   untouched. The unforced path keeps PD-B (an advisory anchor, wallet figure on a failed
   positions read) and its exact call shape.

Every FORCED test of plan 04 runs on an exchange whose anchor applies (ccxt's real parsed
Bybit balance and a readable BYBIT_LINEAR_POSITIONS), so plan 05's rule that a forced
rebuild writes only an anchored curve leaves them green. No test touches a venue, a database or an
enqueue; the exchange is a stub and the database is the in-memory fake.
"""

from __future__ import annotations

import copy
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import ccxt
import pytest

from services import bybit_unified_flows as buf
from services import equity_reconstruction as er
from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests._okx_bills import OkxBillsArchive, okx_balance_payload, okx_detail
from tests._trade_pages import install_unified_log, unified_flow
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    _install_fake_audit,
    _install_fake_preflight,
    _make_trade,
)
from tests.test_reconstruct_marker_writer import (
    COMPLETION_ACTIONS,
    END_DATE,
    FAILED_ACTION,
    _crawl_exchange,
    _freeze_now,
    _job,
    _marker_of,
    _MarkerFake,
    _seed_key,
)
from tests.test_upnl_venues import (
    BYBIT_LINEAR_POSITIONS,
    BYBIT_UNIFIED_WALLET_BALANCE,
    bybit_coin,
    bybit_wallet_balance,
    real_bybit_parse_balance,
)

MARKER = "2026-03-01T00:00:00+00:00"
ALREADY_RECONSTRUCTED = "already_reconstructed_for_api_key"
STARTED = "allocator.equity.reconstruct_started"
COMPLETE = "allocator.equity.reconstruct_complete"

# The literal metadata key. Spelled out here, never imported, so a rename of the
# constant is a RED here and not a silent follow-along (see the spelling test).
FORCE_KEY = "force_rebuild"


async def _bybit_exchange() -> AsyncMock:
    """The marker-writer crawl exchange, as Bybit, with an anchor that applies.

    ``fetch_balance`` is ccxt's REAL ``bybit.parse_balance`` of the fixture payload
    (``total['USDT']`` is the coin walletBalance, 1000) and ``fetch_positions`` returns the
    fixture's linear position (open uPnL 250.5), so ``_fetch_current_equity`` returns the
    coin equity 1250.5.
    """
    exchange = _crawl_exchange()
    exchange.id = "bybit"
    exchange.fetch_balance = AsyncMock(
        return_value=await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)
    )
    exchange.fetch_positions = AsyncMock(return_value=list(BYBIT_LINEAR_POSITIONS))
    return exchange


def _freeze_now_at(monkeypatch: pytest.MonkeyPatch, instant: datetime) -> None:
    """``_freeze_now`` at an arbitrary tz-aware ``instant`` instead of END_DATE exactly."""

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:  # type: ignore[override]
            return instant if tz else instant.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)


def _forced_job(key_id: str = API_KEY_ID_1) -> dict[str, Any]:
    return {**_job(key_id), "metadata": {FORCE_KEY: True}}


def _audit_reasons(audit: Any) -> list[Any]:
    return [c.kwargs["metadata"].get("reason") for c in audit.call_args_list]


def _audit_metadata(audit: Any, action: str) -> list[dict[str, Any]]:
    return [
        c.kwargs["metadata"] for c in audit.call_args_list if c.kwargs.get("action") == action
    ]


def _venue_coin_equity() -> float:
    """The payload's own coin ``equity``: the oracle, never produced by the code under test."""
    account = BYBIT_UNIFIED_WALLET_BALANCE["result"]["list"][0]
    (coin,) = [c for c in account["coin"] if c["coin"] == "USDT"]
    return float(coin["equity"])


# ---------------------------------------------------------------------------
# Tracer: job metadata -> handler -> persisted rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_forced_rebuild_of_a_marked_bybit_key_reanchors_its_curve_to_the_venue_equity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A marked sole Bybit key, a job carrying ``force_rebuild: true``: the handler crawls
    instead of short-circuiting and the rebuilt curve ends at the venue's coin equity
    (wallet 1000 + open uPnL 250.5 = 1250.5). On the marker short-circuit alone this was
    RED: no crawl, no rows."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert exchange.fetch_my_trades.await_count > 0, (
        "a forced job on a marked key was short-circuited instead of crawled"
    )
    rows = fake.rows_for("allocator_equity_snapshots")
    assert rows, "a forced rebuild persisted no snapshot rows"
    last = max(rows, key=lambda r: r["asof"])
    expected = _venue_coin_equity()
    assert last["value_usd"] == pytest.approx(expected, abs=0.01), (
        f"the rebuilt curve ends at {last['value_usd']}, not the venue's coin equity "
        f"{expected} (wallet balance plus open uPnL): the anchor did not apply"
    )
    assert ALREADY_RECONSTRUCTED not in _audit_reasons(audit), (
        "the marker short-circuit audit fired on a forced job"
    )
    started = _audit_metadata(audit, STARTED)
    assert len(started) == 1 and started[0].get("forced_rebuild") is True, started
    assert _marker_of(fake, API_KEY_ID_1) is not None, (
        "a completed forced rebuild left its key's marker NULL"
    )


# ---------------------------------------------------------------------------
# The default does not move
# ---------------------------------------------------------------------------


async def _assert_short_circuits(
    monkeypatch: pytest.MonkeyPatch, job: dict[str, Any]
) -> None:
    """A marked Bybit key and ``job``: DONE, no crawl, the short-circuit audited, and
    no write to api_keys (a short-circuit never creates marker evidence)."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)

    result = await run_reconstruct_allocator_history_job(job)

    assert result.outcome == DispatchOutcome.DONE, result
    assert exchange.fetch_my_trades.await_count == 0, (
        f"the marked key was crawled for job metadata {job.get('metadata')!r}"
    )
    assert ALREADY_RECONSTRUCTED in _audit_reasons(audit), audit.call_args_list
    assert fake.api_key_updates() == []
    assert not fake.rows_for("allocator_equity_snapshots")
    assert _marker_of(fake, API_KEY_ID_1) == MARKER


@pytest.mark.asyncio
async def test_marked_key_without_the_flag_still_short_circuits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ``metadata`` key at all (the shape of every job enqueued today): unchanged."""
    await _assert_short_circuits(monkeypatch, _job())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata",
    [
        None,
        "force_rebuild",
        ["force_rebuild"],
        {},
        {"force_rebuild": "true"},
        {"force_rebuild": 1},
        {"force_rebuild": False},
    ],
    ids=["none", "string", "list", "empty-dict", "string-true", "int-one", "false"],
)
async def test_force_flag_must_be_json_true(
    monkeypatch: pytest.MonkeyPatch, metadata: Any
) -> None:
    """Only JSON ``true`` forces. Postgres jsonb keeps the type, so a truthy-looking
    string or number is a different value and must NOT rewrite a stored curve: a lenient
    read would let a typo'd or hand-built metadata wipe-and-rebuild a marked key."""
    await _assert_short_circuits(monkeypatch, {**_job(), "metadata": metadata})


@pytest.mark.asyncio
async def test_unforced_reconstruct_started_audit_metadata_is_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unforced job's ``reconstruct_started`` audit metadata is byte-identical to the
    pre-flag shape: ``forced_rebuild`` appears only on a forced job."""
    assert er.BACKFILL_CAP_DAYS == 730, (
        "BACKFILL_CAP_DAYS moved: update the literal below on purpose, not by accident"
    )
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert _audit_metadata(audit, STARTED) == [{"venue": "bybit", "backfill_cap_days": 730}]


# ---------------------------------------------------------------------------
# Contracts: the spelling, and who can set the flag
# ---------------------------------------------------------------------------


def test_force_rebuild_key_spelling_is_the_handoff_literal() -> None:
    """The plan 06 post-deploy handoff enqueues the job with this exact literal in
    ``p_metadata``; there is no compiler between the two spellings, so a rename here that
    the handoff does not follow would silently enqueue a job that short-circuits."""
    assert er.RECONSTRUCT_FORCE_REBUILD_KEY == "force_rebuild", (
        "RECONSTRUCT_FORCE_REBUILD_KEY changed: the plan 06 post-deploy handoff enqueues "
        "with the literal 'force_rebuild'; change both together or the recompute no-ops"
    )


def test_the_user_callable_reconstruct_enqueue_passes_no_metadata() -> None:
    """T-167.2.1.1-10. ``request_allocator_holdings_sync`` is the authenticated user's
    RPC and the only one that enqueues ``reconstruct_allocator_history``. It must pass no
    ``p_metadata``, so an authenticated user cannot set ``force_rebuild``: only a
    service-role or owner-role caller of ``enqueue_compute_job`` can."""
    sql = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "schema"
        / "functions"
        / "request_allocator_holdings_sync.sql"
    ).read_text(encoding="utf-8")
    assert "reconstruct_allocator_history" in sql, (
        "the user RPC no longer enqueues the reconstruct kind: re-read who can enqueue "
        "it before trusting this pin"
    )
    assert "p_metadata" not in sql, (
        "request_allocator_holdings_sync now passes p_metadata to an enqueue: an "
        "authenticated user could set force_rebuild and rewrite a stored curve"
    )


# ---------------------------------------------------------------------------
# Plan 05 (PD-H): a forced rebuild writes an anchored curve or nothing
# ---------------------------------------------------------------------------

SENTINEL_VALUE = 12345.0
SENTINEL_ROWS = 10
REFUSAL_PREFIX = "forced rebuild refused ("
# Planted in the exception the venue raises; it must never reach the job error or the audit.
LEAKED_SIGNATURE = "deadbeef"


def _seed_sentinel_rows(fake: Any, days: int = SENTINEL_ROWS) -> None:
    """``days`` snapshot rows for the allocator, all at the sentinel value: a refused
    forced rebuild must leave every one of them exactly as seeded."""
    for days_back in range(days):
        asof = (END_DATE - timedelta(days=days_back)).date().isoformat()
        fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": SENTINEL_VALUE,
            "breakdown": {"ETH": SENTINEL_VALUE},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }


async def _assert_forced_rebuild_refused(
    monkeypatch: pytest.MonkeyPatch,
    exchange: Any,
    reason: str,
    *,
    crawled: bool = True,
    seeded_days: int = SENTINEL_ROWS,
    extra_asofs: tuple[str, ...] = (),
    venue: str = "bybit",
) -> None:
    """A marked sole key (Bybit unless ``venue``) with ``seeded_days`` sentinel rows, a
    forced job, ``exchange``: the job ends FAILED/permanent naming ``reason``, and NOTHING
    changed: every sentinel row, the marker, no completion audit. ``crawled=False`` is for a
    refusal that must come BEFORE the venue crawl. Static text only: the planted signature
    is absent."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange=venue)
    _seed_sentinel_rows(fake, seeded_days)
    for asof in extra_asofs:
        fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof, "value_usd": SENTINEL_VALUE,
            "breakdown": {"ETH": SENTINEL_VALUE}, "source": "exchange_primary",
            "history_depth_months": 24, "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, venue, fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert (exchange.fetch_my_trades.await_count > 0) is crawled, (
        f"crawled={crawled} but fetch_my_trades awaited {exchange.fetch_my_trades.await_count}x"
    )
    prefix = f"{REFUSAL_PREFIX}{reason})"
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "permanent", result
    assert (result.error_message or "").startswith(prefix), result.error_message
    assert LEAKED_SIGNATURE not in (result.error_message or ""), result.error_message

    rows = fake.rows_for("allocator_equity_snapshots")
    assert len(rows) == seeded_days + len(extra_asofs) and all(
        r.get("value_usd") == SENTINEL_VALUE for r in rows
    ), (
        "a refused forced rebuild changed the stored curve: "
        f"{[(r['asof'], r['value_usd']) for r in rows]}"
    )
    assert _marker_of(fake, API_KEY_ID_1) == MARKER, "a refused forced rebuild moved the marker"
    assert fake.api_key_updates() == [], fake.api_key_updates()

    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert not (set(actions) & COMPLETION_ACTIONS), actions
    (started,) = _audit_metadata(audit, STARTED)
    assert started.get("forced_rebuild") is True, started
    (failed,) = _audit_metadata(audit, FAILED_ACTION)
    assert failed["error_kind"] == "permanent", failed
    assert failed["sanitized_message"].startswith(prefix), failed
    assert LEAKED_SIGNATURE not in failed["sanitized_message"], failed


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_and_writes_nothing_when_the_positions_read_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The tracer for PD-H. Bybit's ``total`` is the wallet balance WITHOUT the open uPnL;
    the anchor adds the uPnL from ``fetch_positions``. When that read fails, an unforced
    reconstruct may still anchor at the wallet figure (PD-B), but a forced one would
    replace the stored curve in one write with exactly the wallet-only anchor this phase
    removes. It must refuse instead. RED on a handler that finishes the forced job DONE
    with the wallet-only anchor and replaces the rows."""
    exchange = await _bybit_exchange()
    exchange.fetch_positions = AsyncMock(
        side_effect=ccxt.NetworkError(f"fixture failure signature={LEAKED_SIGNATURE}")
    )
    await _assert_forced_rebuild_refused(monkeypatch, exchange, "positions_unreadable")


def _position(contracts: float, upnl: Any) -> dict[str, Any]:
    return {**BYBIT_LINEAR_POSITIONS[0], "contracts": contracts, "unrealizedPnl": upnl}


async def _bybit_exchange_with(
    *, positions: list[dict[str, Any]], total_perp_upl: str | None = "250.5"
) -> AsyncMock:
    """A Bybit exchange whose balance is ccxt's REAL parse of the fixture payload with its
    ``totalPerpUPL`` set to ``total_perp_upl`` (None removes it), and whose positions are
    exactly ``positions``."""
    payload = copy.deepcopy(BYBIT_UNIFIED_WALLET_BALANCE)
    account = payload["result"]["list"][0]
    if total_perp_upl is None:
        del account["totalPerpUPL"]
    else:
        account["totalPerpUPL"] = total_perp_upl
    exchange = await _bybit_exchange()
    exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
    exchange.fetch_positions = AsyncMock(return_value=positions)
    return exchange


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "build",
    [
        pytest.param(
            lambda: _bybit_exchange_with(
                positions=[_position(0.1, 250.5), _position(0.2, None)]
            ),
            id="open-position-without-upnl",
        ),
        pytest.param(
            lambda: _bybit_exchange_with(
                positions=[_position(0.1, 250.5), _position(0.2, "n/a")]
            ),
            id="open-position-with-non-numeric-upnl",
        ),
        pytest.param(
            lambda: _bybit_exchange_with(
                positions=[_position(0.1, 250.5)] + [_position(0, None)] * 199
            ),
            id="full-page-of-200-rows",
        ),
        pytest.param(
            lambda: _bybit_exchange_with(positions=[_position(0.1, 250.5)], total_perp_upl="1000"),
            id="positions-disagree-with-totalPerpUPL",
        ),
        pytest.param(
            lambda: _bybit_exchange_with(positions=[_position(0.1, 250.5)], total_perp_upl=None),
            id="totalPerpUPL-absent",
        ),
    ],
)
async def test_forced_rebuild_refuses_when_the_open_upnl_cannot_be_fully_read(
    monkeypatch: pytest.MonkeyPatch, build: Any
) -> None:
    """Review WR-02 / SFH-2. A readable position list can still drop uPnL silently: an open
    position with no numeric uPnL, a truncated read (a full page of
    200 rows), or positions that do not add up to Bybit's own ``totalPerpUPL`` (which also
    covers USDC and inverse positions, never requested by the default read). Each would
    replace the stored curve with an anchor missing some open uPnL, so each refuses. (The two
    open-position cases keep a good position beside the bad one and a matching
    ``totalPerpUPL``, so only the per-position rule can refuse them.)"""
    await _assert_forced_rebuild_refused(monkeypatch, await build(), "positions_unreadable")


@pytest.mark.asyncio
async def test_forced_rebuild_accepts_a_199_row_positions_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The read is sent with limit=200, so 199 rows proves it is complete: no cursor rule is
    needed (Bybit can send a non-empty ``nextPageCursor`` beside a single position), and the
    job must not refuse. RED on a bound below 199."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange_with(
        positions=[_position(0.1, 250.5)] + [_position(0, None)] * 198,
    )
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result


@pytest.mark.asyncio
async def test_forced_rebuild_accepts_flat_positions_and_a_small_totalperpupl_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-02, the other side. A flat position carries no uPnL and is not an open one,
    and the two REST calls are seconds apart, so a 2.5 USD drift between the summed
    positions and ``totalPerpUPL`` (tolerance: the larger of 1 USD and 0.5% of the 1000
    wallet figure, i.e. 5) must not refuse. RED on a check with no tolerance or none for
    flat positions."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange_with(
        positions=[_position(0.1, 250.5), _position(0, None)], total_perp_upl="253",
    )
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_when_the_balance_read_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The balance read is the anchor itself. With it failing, ``_fetch_current_equity``
    answers ``None`` and the curve would ship un-anchored (and, until now, invisibly: no
    telemetry flag is set for an anchor that could not be read). A forced rebuild must
    refuse that too. The positions are readable, so this is NOT ``positions_unreadable``."""
    exchange = await _bybit_exchange()
    exchange.fetch_balance = AsyncMock(
        side_effect=ccxt.NetworkError(f"fixture failure signature={LEAKED_SIGNATURE}")
    )
    await _assert_forced_rebuild_refused(monkeypatch, exchange, "anchor_unreadable")


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_when_the_anchor_would_be_skipped_for_a_partial_ticker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An existing anchor skip: a held non-stable coin whose ticker call fails makes the
    equity figure an undercount, so the crawl ships the replay un-anchored. Unforced that is
    the documented fallback; forced it would replace the stored curve with an un-anchored
    one. The payload is two coins through ccxt's REAL Bybit parser (USDT walletBalance 1000
    with the fixture's 250.5 open uPnL, BTC walletBalance 0.1); the BTC ticker raises; the
    positions are readable and agree with the payload's totalPerpUPL."""
    payload = bybit_wallet_balance(
        "UNIFIED",
        [bybit_coin("USDT", "1000", "250.5"), bybit_coin("BTC", "0.1", "0")],
    )
    exchange = await _bybit_exchange()
    exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
    exchange.fetch_ticker = AsyncMock(
        side_effect=ccxt.NetworkError(f"fixture failure signature={LEAKED_SIGNATURE}")
    )
    await _assert_forced_rebuild_refused(monkeypatch, exchange, "anchor_skipped_partial_ticker")


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_an_empty_replay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review SFH-1, unified (AR-7). A forced replay with no trades or transfers yields no
    rows for that exchange account. An account with no curve cannot be summed (reading it
    as zero would store a total that is too low), and the empty replace path would end DONE
    as ``reconstruct_no_data`` and stamp the marker, so a forced job FAILS with
    ``account_key_no_rows`` instead and every stored row stays."""
    exchange = await _bybit_exchange()
    exchange.fetch_my_trades = AsyncMock(return_value=[])
    await _assert_forced_rebuild_refused(monkeypatch, exchange, "account_key_no_rows")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra_days_back",
    [60, -3],
    ids=["older-than-the-replays-first-row", "day-the-replay-does-not-emit"],
)
async def test_forced_rebuild_refuses_when_stored_history_would_be_dropped(
    monkeypatch: pytest.MonkeyPatch, extra_days_back: int
) -> None:
    """Review WR-01, now D-02 of ACCTREBUILD. The window replace deletes the stored days
    inside its window and inserts only the rebuilt rows. The replay here covers the ten
    sentinel days (the first trade is nine days back); one extra stored day is either 60
    days older than the replay's first row (still inside the 730-day window) or a day after
    the replay's last. Each would be deleted unreproduced, so the refusal comes from the
    window call's own transaction (``history_days_unreproduced``) and all eleven rows
    stay. RED on a replace that deletes the window without comparing."""
    extra = (END_DATE - timedelta(days=extra_days_back)).date().isoformat()
    exchange = await _bybit_exchange()
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "history_days_unreproduced", extra_asofs=(extra,),
    )


@pytest.mark.asyncio
async def test_forced_rebuild_replaces_stored_rows_the_replay_reproduces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-01, the other side: when every stored day is one the replay emits, the
    sole-key forced rebuild still replaces the curve (no sentinel survives)."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    _seed_sentinel_rows(fake)
    _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, await _bybit_exchange())
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    rows = fake.rows_for("allocator_equity_snapshots")
    assert len(rows) == SENTINEL_ROWS and all(r["value_usd"] != SENTINEL_VALUE for r in rows)


@pytest.mark.asyncio
async def test_a_completed_forced_rebuild_says_so_in_its_completion_audit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review SFH-1. ``forced_rebuild: true`` rides the completion audit as well as the
    started audit, so the two events of one job can be joined."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, await _bybit_exchange())
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete.get("forced_rebuild") is True, complete
    assert complete.get("anchor_positions_unread") is False, complete


def _first_call_trades(trades: list[dict[str, Any]]) -> AsyncMock:
    """``fetch_my_trades`` answering ``trades`` once and an empty page afterwards."""
    calls: list[int] = []

    async def _fetch(*_a: Any, **_k: Any) -> list[dict[str, Any]]:
        calls.append(1)
        return trades if len(calls) == 1 else []

    return AsyncMock(side_effect=_fetch)


def _trade_ts() -> int:
    return int((END_DATE - timedelta(days=9)).timestamp() * 1000)


async def _okx_exchange() -> AsyncMock:
    """A Bybit-shaped exchange that answers as OKX, with one BTC buy nine days back."""
    exchange = await _bybit_exchange()
    exchange.id = "okx"
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 50000.0, 1.0)]
    )
    return exchange


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_an_okx_curve_clamped_at_the_90_day_terminus(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-03, ``anchor_skipped_okx_terminus``, as a DIRECT call of the crawl. OKX keeps
    90 days of fills, so a window that starts before that is clamped and the replay starts at
    zero cash; the anchor is skipped because every absolute level is wrong. Forced, the crawl
    must refuse instead of returning the curve. The anchor itself is readable (1250.5), so
    only this arm can refuse. RED with the arm removed.

    Why 89 and why now is frozen after midnight (RESEARCH Q1). The terminus test is
    ``since < now - 90 days``. A start 90 days back is therefore older than the terminus
    once the UTC day has begun, and at exactly 00:00 it is not, which is why now is frozen
    six hours after midnight: at 00:00 the 90-day call would not bite. A start 89 days back
    is newer than the terminus at any time of day and returns rows. The handler never asks
    OKX for 90 days; it asks for 89 (``_account_rebuild_window``), and this call pins that
    arithmetic from the crawl's side.
    """
    monkeypatch.setattr(
        "services.exchange.fetch_okx_total_equity_usd", AsyncMock(return_value=1250.5)
    )
    _freeze_now_at(monkeypatch, END_DATE + timedelta(hours=6))
    fake = _MarkerFake()
    end = END_DATE.date()

    with pytest.raises(er.ForcedRebuildRefusedError) as excinfo:
        await er._fetch_and_price_window(
            await _okx_exchange(), "okx", fake, end - timedelta(days=90), end,
            require_anchor=True,
        )
    assert excinfo.value.reason == "anchor_skipped_okx_terminus"

    rows, hit_terminus, _telemetry = await er._fetch_and_price_window(
        await _okx_exchange(), "okx", fake, end - timedelta(days=89), end,
        require_anchor=True,
    )
    assert rows and hit_terminus is False


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_a_replay_with_an_inverse_perp_fill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-03, ``anchor_skipped_unreliable_replay``. An inverse perp fill is skipped by
    the replay (INVERSE_UNSUPPORTED) while the live anchor still counts its uPnL, so the
    replay's absolute level cannot be trusted. Forced, the stored curve must stay. RED with
    the arm removed: the forced job would replace the curve with an unanchored replay."""
    exchange = await _bybit_exchange()
    exchange.fetch_my_trades = _first_call_trades(
        [
            _make_trade(_trade_ts(), "BTC/USDT", "buy", 50000.0, 1.0),
            _make_trade(_trade_ts(), "BTC/USD:BTC", "buy", 50000.0, 100.0),
        ]
    )
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "anchor_skipped_unreliable_replay",
    )


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_an_implausible_anchor_offset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-03, ``anchor_skipped_implausible``. The replay ends at 10000 (1 BTC bought at
    40000, marked at 50000) and the venue reports 100250.5: an offset of about 90000, over
    5x the last value, which the anchor refuses to spread. The balance and the positions
    agree, so only this arm can refuse. RED with the arm removed."""
    payload = bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "100000", "250.5")])
    exchange = await _bybit_exchange()
    exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 40000.0, 1.0)]
    )
    await _assert_forced_rebuild_refused(monkeypatch, exchange, "anchor_skipped_implausible")


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_an_implausible_okx_anchor_offset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``anchor_skipped_implausible`` for OKX, through the handler. The replay ends at 10000
    (1 BTC bought at 40000, marked at 50000) and ``totalEq`` is 70000: a ratio of 7, above the
    gate's 6, so the 5x arm refuses. The forced 89-day window is the first OKX path on which
    that arm can run at all (the unforced 730-day window hits the terminus arm first), and
    until now only a Bybit exchange exercised it. The bills archive answers empty, so once the
    bills-based opening check exists this refusal stands on an unproven reach; today it stands
    on the 5x arm alone. The job fails permanent and every sentinel row and the marker stay.
    RED with the arm removed."""
    exchange = await _bybit_exchange()
    exchange.id = "okx"
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 40000.0, 1.0)]
    )
    # Both raw OKX methods set explicitly with dict-shaped answers: an unset method on this
    # AsyncMock-based exchange would answer with a MagicMock.
    exchange.private_get_account_balance = AsyncMock(
        return_value=okx_balance_payload("70000", [okx_detail("USDT", "70000")])
    )
    exchange.private_get_account_bills_archive = OkxBillsArchive([])
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "anchor_skipped_implausible", venue="okx"
    )


def test_forced_rebuild_refusal_reasons_are_a_closed_set() -> None:
    """The post-deploy handoff matches the ``forced rebuild refused (`` prefix and these 17
    tokens to decide re-enqueue-once versus record-only (PD-I). An extra reason, or a
    renamed one, that the handoff does not know would be recorded as an unknown failure;
    the set is therefore pinned in both halves, and so is the message each token produces.

    Phase 167.2.1.1.2 D-02 / UPNLVENUES D-04: the four tokens of the sole-key path
    (``multi_key``, ``sibling_lookup_failed``, ``replay_empty``, ``history_outside_replay``)
    left the set with the unified whole-account path (decision AR-7), and their raise sites
    left the handler with them. The raise-site scan at the end pins that from the source:
    the double-quoted lower_snake literals the module passes to ``ForcedRebuildRefusedError(``
    or assigns to ``_refusal =`` EQUAL the 17 tokens, so no token is without a raise site
    and no raise site names a token outside the set.

    Phase 171 READCEILING (plan 10, 2026-10-27): the set gained its 16th token,
    ``account_key_read_stalled`` (a member's resumable read made no progress across claims, or
    its job reached the 24 h backstop; the stored windows are kept, so a later run can clear
    it). It moved with this pin, the two-year-window pin, the probe's derived vocabulary and
    the post-deploy handoff, as the closed-vocabulary rule says.

    Phase 180 BYBITFUNDING (plan 07, 2026-10-28, D-03): the set gained its 17th token,
    ``account_flow_source_unreadable`` (a forced Bybit rebuild whose Unified-edge flow read the
    venue refused or answered unreadably; it clears only when the key's permissions or the
    venue's answer change). It moved with this pin, the two-year-window pin, the raise-site scan,
    the probe's ``_FLOW_SOURCE_REFUSAL`` and the runbook's B'3 list.
    """
    import scripts.allocator_history_probe as hp

    anchor = frozenset(
        {
            "positions_unreadable",
            "anchor_unreadable",
            "anchor_skipped_okx_terminus",
            "anchor_skipped_partial_ticker",
            "anchor_skipped_unreliable_replay",
            "anchor_skipped_implausible",
        }
    )
    account = frozenset(
        {
            "account_state_unreadable",
            "account_identity_pending",
            "account_key_venue_unsupported",
            "account_key_not_working",
            "account_key_read_failed",
            "account_key_no_rows",
            "account_sum_empty",
            "account_keys_changed",
            "history_days_unreproduced",
            "account_key_read_stalled",
            "account_flow_source_unreadable",
        }
    )
    assert er.FORCED_REBUILD_ANCHOR_REASONS == anchor, (
        "FORCED_REBUILD_ANCHOR_REASONS changed: the post-deploy handoff matches these "
        "tokens; change both together"
    )
    assert er.FORCED_REBUILD_ACCOUNT_REASONS == account, (
        "FORCED_REBUILD_ACCOUNT_REASONS changed: the post-deploy handoff matches these "
        "tokens; change both together"
    )
    assert anchor.isdisjoint(account)
    assert len(anchor) + len(account) == 17
    # The probe's refusal literal for an unreadable flow source is a member, and a record
    # carrying it (with its cause) is accepted by the probe's own validator.
    assert hp._FLOW_SOURCE_REFUSAL in account
    assert hp.emit_record(
        hp._account_record(
            "a1",
            "2026-10-28",
            member_refusal=hp._FLOW_SOURCE_REFUSAL,
            bybit_transfers_cause="flow_source_unreadable",
        )
    )
    assert er.FORCED_REBUILD_REFUSAL_REASONS == anchor | account, (
        "FORCED_REBUILD_REFUSAL_REASONS is no longer the union of its two halves"
    )
    for reason in sorted(anchor | account):
        exc = er.ForcedRebuildRefusedError(reason)
        assert exc.reason == reason
        assert str(exc) == f"{REFUSAL_PREFIX}{reason})"

    # Raise-site equality (decision AR-7). The scan reads the source text: a raise that passed
    # a variable would not be seen, which is why every raise names its token as a literal.
    source = Path(er.__file__).read_text(encoding="utf-8")
    raised = set(re.findall(r'ForcedRebuildRefusedError\(\s*"([a-z_]+)"\s*\)', source))
    raised |= set(re.findall(r'_refusal = "([a-z_]+)"', source))
    assert raised == set(er.FORCED_REBUILD_REFUSAL_REASONS), (
        f"raise sites without a token: {sorted(raised - er.FORCED_REBUILD_REFUSAL_REASONS)}; "
        f"tokens without a raise site: {sorted(er.FORCED_REBUILD_REFUSAL_REASONS - raised)}"
    )


@pytest.mark.asyncio
async def test_unforced_reconstruct_with_a_failed_positions_read_still_anchors_at_the_wallet_figure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PD-B is unchanged at handler level. An UNFORCED reconstruct of an unmarked sole
    Bybit key whose positions read raises still ends DONE, anchored at the wallet figure
    (the payload's own walletBalance, 1000), with only a WARNING. The refusal is a forced-
    path rule: an unanchored zero-cash replay is worse than a one-day uPnL shift for a
    FIRST reconstruct, and TODOS [167.2.1.1-ANCHOR-POSITIONS-READ-FAILURE] records both
    halves of that decision."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    exchange.fetch_positions = AsyncMock(
        side_effect=ccxt.NetworkError(f"fixture failure signature={LEAKED_SIGNATURE}")
    )
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, (
        "an unforced reconstruct was refused on a failed positions read: PD-B "
        "(TODOS [167.2.1.1-ANCHOR-POSITIONS-READ-FAILURE]) keeps the wallet-figure anchor "
        f"for every unforced job: {result}"
    )
    rows = fake.rows_for("allocator_equity_snapshots")
    assert rows, "the unforced reconstruct persisted no rows"
    last = max(rows, key=lambda r: r["asof"])
    account = BYBIT_UNIFIED_WALLET_BALANCE["result"]["list"][0]
    (usdt,) = [c for c in account["coin"] if c["coin"] == "USDT"]
    assert last["value_usd"] == pytest.approx(float(usdt["walletBalance"]), abs=0.01), last
    assert FAILED_ACTION not in [c.kwargs["action"] for c in audit.call_args_list]
    assert _marker_of(fake, API_KEY_ID_1) is not None
    # Review SFH-3: the wallet-figure anchor is no longer invisible. The completion audit
    # says the open uPnL was left out. RED on a handler that records nothing.
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete.get("anchor_positions_unread") is True, complete


@pytest.mark.asyncio
async def test_unforced_reconstruct_calls_the_crawl_and_the_anchor_with_their_existing_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PD-J. The new keywords are passed ONLY on the forced branch. Fixed-signature fakes
    (``fake_anchor(exchange, venue)``, ``fake_fetch_and_price(...)``) and AsyncMock patches
    in other suites would raise TypeError on a keyword they do not declare, so an unforced
    job must call the crawl with exactly five positional arguments and the anchor with
    exactly (exchange, venue). Recording wrappers delegate to the real functions."""
    crawl_calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    anchor_calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    real_crawl = er._fetch_and_price_window
    real_anchor = er._fetch_current_equity

    async def _crawl(*args: Any, **kwargs: Any) -> Any:
        crawl_calls.append((args, kwargs))
        return await real_crawl(*args, **kwargs)

    async def _anchor(*args: Any, **kwargs: Any) -> Any:
        anchor_calls.append((args, kwargs))
        return await real_anchor(*args, **kwargs)

    monkeypatch.setattr(er, "_fetch_and_price_window", _crawl)
    monkeypatch.setattr(er, "_fetch_current_equity", _anchor)

    # Unforced, unmarked key.
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange="bybit")
    _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)
    result = await run_reconstruct_allocator_history_job(_job())
    assert result.outcome == DispatchOutcome.DONE, result
    ((crawl_args, crawl_kwargs),) = crawl_calls
    assert len(crawl_args) == 5 and crawl_kwargs == {}, (crawl_args, crawl_kwargs)
    ((anchor_args, anchor_kwargs),) = anchor_calls
    assert anchor_args == (exchange, "bybit") and anchor_kwargs == {}, (
        anchor_args, anchor_kwargs,
    )

    # Forced, marked key: the keywords appear, and only then.
    crawl_calls.clear()
    anchor_calls.clear()
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    result = await run_reconstruct_allocator_history_job(_forced_job())
    assert result.outcome == DispatchOutcome.DONE, result
    ((crawl_args, crawl_kwargs),) = crawl_calls
    assert len(crawl_args) == 5 and crawl_kwargs == {"require_anchor": True}, (
        crawl_args, crawl_kwargs,
    )
    ((anchor_args, anchor_kwargs),) = anchor_calls
    assert anchor_args == (exchange, "bybit")
    assert anchor_kwargs == {"refuse_unread_positions": True}, anchor_kwargs


# ---------------------------------------------------------------------------
# Phase 180 BYBITFUNDING plan 07 (D-03): an unreadable Unified flow source is refused by name
# when forced, fails permanently when unforced, and stays retryable when it is only transient
# ---------------------------------------------------------------------------

FLOW_SOURCE_REFUSAL = "account_flow_source_unreadable"
# The four ways the reader itself refuses an answer (``BybitUnifiedFlowReadError``).
READER_CAUSES = ("non_dict_answer", "repeated_cursor", "wrong_type", "page_ceiling")
VENUE_PERMANENT = (ccxt.PermissionDenied, ccxt.AuthenticationError, ccxt.BadRequest)
VENUE_TRANSIENT = (ccxt.RateLimitExceeded, ccxt.NetworkError, ccxt.RequestTimeout)


def _flows_at(timestamp: int, count: int = 120) -> list[dict[str, Any]]:
    """``count`` TRANSFER_IN rows inside one 7-day window: more than two pages of 50."""
    return [
        unified_flow(f"fake-flow-in-{i}", "TRANSFER_IN", timestamp, change="5")
        for i in range(count)
    ]


def _break_flow_source(
    exchange: Any, cause: str, monkeypatch: pytest.MonkeyPatch, timestamp: int
) -> None:
    """Make ``exchange``'s Unified log fail the reader's own checks, ``cause`` one of
    ``READER_CAUSES``."""
    if cause == "non_dict_answer":
        exchange.private_get_v5_account_transaction_log = AsyncMock(
            return_value=["not", "a", "dict"]
        )
    elif cause == "repeated_cursor":
        install_unified_log(exchange, _flows_at(timestamp), repeat_cursor=True)
    elif cause == "wrong_type":
        install_unified_log(exchange, _flows_at(timestamp), wrong_type=True)
    else:
        assert cause == "page_ceiling", cause
        monkeypatch.setattr(buf, "UNIFIED_FLOW_PAGE_CAP", 2)
        install_unified_log(exchange, _flows_at(timestamp))


def _direct_flow_timestamp() -> int:
    return int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp() * 1000)


def _direct_window() -> tuple[Any, Any]:
    end_date = datetime.now(timezone.utc).date()
    return end_date - timedelta(days=10), end_date


async def _direct_crawl(exchange: Any, *, require_anchor: bool) -> Any:
    start_date, end_date = _direct_window()
    return await er._fetch_and_price_window(
        exchange, "bybit", MagicMock(), start_date, end_date, require_anchor=require_anchor
    )


def _fail_the_log_with(exchange: Any, exc: BaseException) -> None:
    exchange.private_get_v5_account_transaction_log = AsyncMock(side_effect=exc)


@pytest.mark.asyncio
@pytest.mark.parametrize("cause", [c.__name__ for c in VENUE_PERMANENT] + list(READER_CAUSES))
async def test_a_forced_bybit_read_whose_flow_source_is_unreadable_refuses_by_name(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, cause: str
) -> None:
    """D-03: a forced rebuild whose Unified flow read the venue refuses (a permission, an
    authentication or a bad-request error) or answers unreadably (the reader's own four
    refusals) raises the closed refusal ``account_flow_source_unreadable`` before any trade is
    requested, with a static message and no venue exception chained. RED on a rebuild that
    lets the raw error out (the job would read ``unknown``) or that swallows it into an empty
    flow list (a silent 0)."""
    exchange = await _bybit_exchange()
    by_name = {c.__name__: c for c in VENUE_PERMANENT}
    if cause in by_name:
        _fail_the_log_with(exchange, by_name[cause](f"fixture failure signature={LEAKED_SIGNATURE}"))
    else:
        _break_flow_source(exchange, cause, monkeypatch, _direct_flow_timestamp())

    with caplog.at_level("WARNING"), pytest.raises(er.ForcedRebuildRefusedError) as excinfo:
        await _direct_crawl(exchange, require_anchor=True)

    assert excinfo.value.reason == FLOW_SOURCE_REFUSAL
    assert str(excinfo.value) == f"{REFUSAL_PREFIX}{FLOW_SOURCE_REFUSAL})"
    assert LEAKED_SIGNATURE not in str(excinfo.value)
    assert excinfo.value.__cause__ is None and excinfo.value.__suppress_context__ is True
    assert exchange.fetch_my_trades.await_count == 0
    # Round 1 M-4: ``from None`` drops the cause, so the refusal leaves one line naming
    # the exception class, and never the venue's text.
    ours = [r.getMessage() for r in caplog.records if r.name == er.logger.name]
    cause_class = cause if cause in by_name else "BybitUnifiedFlowReadError"
    assert any(f"exc_class={cause_class}" in m for m in ours), ours
    assert not any(LEAKED_SIGNATURE in m for m in ours)


@pytest.mark.asyncio
async def test_a_forced_bybit_job_on_an_unreadable_flow_source_fails_permanent_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same refusal end to end through the whole-account crawl: the job ends FAILED /
    permanent naming the token, requests no trade, and leaves every stored row, the marker and
    the audit as they were."""
    exchange = await _bybit_exchange()
    _fail_the_log_with(
        exchange, ccxt.PermissionDenied(f"fixture failure signature={LEAKED_SIGNATURE}")
    )
    await _assert_forced_rebuild_refused(monkeypatch, exchange, FLOW_SOURCE_REFUSAL, crawled=False)


@pytest.mark.asyncio
@pytest.mark.parametrize("error", VENUE_TRANSIENT, ids=lambda e: e.__name__)
async def test_a_transient_flow_source_fault_is_not_a_refusal(
    error: type[ccxt.BaseError],
) -> None:
    """A rate limit, a network fault or a timeout on the Unified log is the venue being busy,
    not the key being unable to read it: the SAME exception object propagates (never the
    token), so the whole-account converter and the worker keep treating it as retryable.
    RED on a wrapper that catches everything."""
    exchange = await _bybit_exchange()
    raised = error("fixture transient fault")
    _fail_the_log_with(exchange, raised)

    with pytest.raises(error) as excinfo:
        await _direct_crawl(exchange, require_anchor=True)

    assert excinfo.value is raised
    assert exchange.fetch_my_trades.await_count == 0


def _job_flow_timestamp() -> int:
    return int((END_DATE - timedelta(days=2)).timestamp() * 1000)


@pytest.mark.asyncio
async def test_an_unforced_bybit_read_hit_by_a_permission_error_propagates_it_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only the forced path refuses by name. Unforced, the venue's own error leaves the crawl as
    the same object, and the job worker classifies it."""
    exchange = await _bybit_exchange()
    raised = ccxt.PermissionDenied("fixture permission error")
    _fail_the_log_with(exchange, raised)

    with pytest.raises(ccxt.PermissionDenied) as excinfo:
        await _direct_crawl(exchange, require_anchor=False)

    assert excinfo.value is raised
    assert exchange.fetch_my_trades.await_count == 0


async def _run_unforced_bybit_job(
    monkeypatch: pytest.MonkeyPatch, exchange: Any
) -> tuple[Any, Any, Any]:
    """An unmarked sole Bybit key, an UNFORCED job over ``exchange``: (result, fake, audit)."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)
    result = await run_reconstruct_allocator_history_job(_job())
    return result, fake, audit


def _assert_nothing_was_written(fake: Any, audit: Any) -> None:
    assert fake.rows_for("allocator_equity_snapshots") == []
    assert _marker_of(fake, API_KEY_ID_1) is None, "the marker moved"
    assert fake.api_key_updates() == [], fake.api_key_updates()
    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert not (set(actions) & COMPLETION_ACTIONS), actions


@pytest.mark.asyncio
@pytest.mark.parametrize("cause", ["PermissionDenied"] + list(READER_CAUSES))
async def test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, cause: str
) -> None:
    """Orchestrator reading 2 (a behaviour change): an UNFORCED job whose Unified flows cannot be
    read does NOT fall back to the on-chain pair and does NOT write a curve from the trades
    alone. It ends FAILED with error_kind ``permanent`` (the queue does not retry a fault no
    retry can clear), the message is not a forced refusal, no trade is requested and nothing is
    stored. RED on a rebuild that raises the refusal whatever the path (the message would carry
    the forced prefix), and on a classifier that calls the reader's error ``unknown`` (retried)."""
    exchange = await _bybit_exchange()
    if cause == "PermissionDenied":
        _fail_the_log_with(exchange, ccxt.PermissionDenied("fixture permission error"))
    else:
        _break_flow_source(exchange, cause, monkeypatch, _job_flow_timestamp())

    result, fake, audit = await _run_unforced_bybit_job(monkeypatch, exchange)

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "permanent", result
    assert not (result.error_message or "").startswith(REFUSAL_PREFIX), result.error_message
    assert exchange.fetch_my_trades.await_count == 0
    _assert_nothing_was_written(fake, audit)


@pytest.mark.asyncio
@pytest.mark.parametrize("error", VENUE_TRANSIENT, ids=lambda e: e.__name__)
async def test_an_unforced_transient_flow_fault_still_retries(
    monkeypatch: pytest.MonkeyPatch, error: type[ccxt.BaseError]
) -> None:
    """A transient fault on the Unified log still ends the unforced job FAILED with error_kind
    ``transient`` (the queue retries it), with no curve, marker or completion audit written. The
    429 cooldown stamp a rate limit writes is expected and is not asserted on."""
    exchange = await _bybit_exchange()
    _fail_the_log_with(exchange, error("fixture transient fault"))

    result, fake, audit = await _run_unforced_bybit_job(monkeypatch, exchange)

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result
    assert exchange.fetch_my_trades.await_count == 0
    assert fake.rows_for("allocator_equity_snapshots") == []
    assert _marker_of(fake, API_KEY_ID_1) is None
    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert not (set(actions) & COMPLETION_ACTIONS), actions


def test_the_runbook_lists_every_refusal_token_once() -> None:
    """The post-deploy handoff (runbook section B'3, rule 3) decides re-enqueue-once versus
    record-only from two lists. They must name EVERY token of the closed set exactly once, with
    the count the runbook states and the counts it gives each list, or an operator meets a
    refusal the runbook does not know. RED when a token is added to the code and not to the
    runbook (this was already true of ``account_key_read_stalled`` before Phase 180)."""
    runbook = (
        Path(__file__).resolve().parents[2]
        / "docs" / "runbooks" / "marksource-okx-history-correction.md"
    )
    text = re.sub(r"\s+", " ", runbook.read_text(encoding="utf-8"))
    total = len(er.FORCED_REBUILD_REFUSAL_REASONS)
    assert f"`FORCED_REBUILD_REFUSAL_REASONS`, {total} tokens, and a token outside it" in text

    once = re.search(r"Re-enqueue ONCE\*\* \(.*?\) for these (\d+): (.*?)\. If it refuses again", text)
    record = re.search(r"Record only, no re-run\*\* for these (\d+): (.*?) Note each one's count", text)
    assert once and record, "B'3 rule 3 changed shape: the two lists could not be read"
    once_tokens = re.findall(r"`([a-z_]+)`", once.group(2))
    record_tokens = re.findall(r"`([a-z_]+)`", record.group(2))

    assert int(once.group(1)) == len(once_tokens), (once.group(1), once_tokens)
    assert int(record.group(1)) == len(record_tokens), (record.group(1), record_tokens)
    assert len(set(once_tokens)) == len(once_tokens), "a token is listed twice for re-enqueue"
    assert len(set(record_tokens)) == len(record_tokens), "a token is listed twice for record-only"
    assert set(once_tokens).isdisjoint(record_tokens)
    assert set(once_tokens) | set(record_tokens) == set(er.FORCED_REBUILD_REFUSAL_REASONS), (
        f"runbook only: {sorted((set(once_tokens) | set(record_tokens)) - er.FORCED_REBUILD_REFUSAL_REASONS)}; "
        f"code only: {sorted(er.FORCED_REBUILD_REFUSAL_REASONS - (set(once_tokens) | set(record_tokens)))}"
    )
