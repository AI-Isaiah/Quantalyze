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
4. A forced rebuild runs on a SOLE-key allocator only (review CR-01). With any sibling
   api_keys row, or a sibling lookup that cannot answer, it refuses (`multi_key`,
   `sibling_lookup_failed`) before the crawl and writes nothing: the DO-NOTHING persist
   would otherwise gap-fill the aggregate curve with this one key's value. Multi-key
   accounts belong to Phase 167.2.1.1.2 ACCTREBUILD (CONTEXT D-05).
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
from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import ccxt
import pytest

from services import equity_reconstruction as er
from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    _FakeTable,
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
    sibling: bool = False,
    fail_sibling_lookup: bool = False,
    seeded_days: int = SENTINEL_ROWS,
    extra_asofs: tuple[str, ...] = (),
    venue: str = "bybit",
    second_sibling_check: er.SiblingCheckResult | None = None,
) -> None:
    """A marked key (Bybit unless ``venue``) with ``seeded_days`` sentinel rows (sole-key unless ``sibling``), a
    forced job, ``exchange``: the job ends FAILED/permanent naming ``reason``, and NOTHING
    changed: every sentinel row, the marker, no completion audit. ``crawled=False`` is for a
    refusal that must come BEFORE the venue crawl. Static text only: the planted signature
    is absent."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange=venue)
    if sibling:
        _seed_key(fake, API_KEY_ID_2, marker=MARKER, exchange="okx")
    fake.fail_sibling_lookup = fail_sibling_lookup
    _seed_sentinel_rows(fake, seeded_days)
    for asof in extra_asofs:
        fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof, "value_usd": SENTINEL_VALUE,
            "breakdown": {"ETH": SENTINEL_VALUE}, "source": "exchange_primary",
            "history_depth_months": 24, "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }
    if second_sibling_check is not None:
        # The first (pre-crawl) lookup is the real one; every later lookup answers
        # ``second_sibling_check``, as if a key appeared or the read failed mid-crawl.
        _real_lookup = er._allocator_has_other_api_keys
        _lookups: list[None] = []

        async def _lookup(*args: Any, **kwargs: Any) -> er.SiblingCheckResult:
            _lookups.append(None)
            if len(_lookups) == 1:
                return await _real_lookup(*args, **kwargs)
            return second_sibling_check

        monkeypatch.setattr(er, "_allocator_has_other_api_keys", _lookup)
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
async def test_forced_rebuild_refuses_a_multi_key_allocator_and_adds_no_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review CR-01. A multi-key allocator's rows are one aggregate curve across keys. The
    DO-NOTHING persist cannot change an existing day, but it INSERTS this one key's replay
    value into any day the aggregate is missing. Nine of the ten days are seeded (one is
    missing); the refusal must leave exactly nine rows, none new, and must come before the
    crawl. RED on a handler that crawls and persists: the missing day gains a row carrying
    this key's own value."""
    exchange = await _bybit_exchange()
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "multi_key", crawled=False, sibling=True, seeded_days=9,
    )


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_when_the_sibling_lookup_cannot_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review SFH-1. A failed sibling lookup used to read as "has siblings" and end DONE
    after a full crawl. A forced job must instead refuse: the allocator may be sole-key,
    and a silent DONE would leave the curve on the old anchor with a success audit."""
    exchange = await _bybit_exchange()
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "sibling_lookup_failed", crawled=False, fail_sibling_lookup=True,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("second_check", "reason"),
    [
        (er.SiblingCheckResult(True, True, "fixture: second lookup failed"), "sibling_lookup_failed"),
        (er.SiblingCheckResult(True, False, None), "multi_key"),
    ],
    ids=["second-lookup-fails", "key-added-during-the-crawl"],
)
async def test_forced_rebuild_refuses_when_the_persist_time_sibling_lookup_disagrees(
    monkeypatch: pytest.MonkeyPatch, second_check: er.SiblingCheckResult, reason: str,
) -> None:
    """Round-2 SFH. The pre-crawl lookup passes (sole key); the persist half looks again.
    If that second lookup fails, or a key now exists, the DO-NOTHING persist would either
    end DONE with nothing replaced or gap-fill the aggregate curve with this key's values
    (nine of ten days are seeded, so it would INSERT the missing day). The job must refuse
    with the named reason and leave exactly the nine seeded rows. RED on a persist half
    that does not read ``forced``."""
    exchange = await _bybit_exchange()
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, reason, seeded_days=9, second_sibling_check=second_check,
    )


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_an_empty_replay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review SFH-1. A forced replay with no trades or transfers yields no rows. The empty
    sole-key replace is already refused downstream, but that path ends DONE as
    ``reconstruct_no_data`` and stamps the marker; a forced job must FAIL instead."""
    exchange = await _bybit_exchange()
    exchange.fetch_my_trades = AsyncMock(return_value=[])
    await _assert_forced_rebuild_refused(monkeypatch, exchange, "replay_empty")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra_days_back",
    [60, -3],
    ids=["older-than-the-replays-first-row", "day-the-replay-does-not-emit"],
)
async def test_forced_rebuild_refuses_when_stored_history_would_be_dropped(
    monkeypatch: pytest.MonkeyPatch, extra_days_back: int
) -> None:
    """Review WR-01. The sole-key replace DELETEs every stored row and inserts only the
    replay. The replay here covers the ten sentinel days (the first trade is nine days
    back); one extra stored day is either 60 days older than the replay's first row or a day
    after the replay's last. Each would be silently deleted, so the job must refuse and
    leave all eleven rows. RED on a handler that goes straight to the replace."""
    extra = (END_DATE - timedelta(days=extra_days_back)).date().isoformat()
    exchange = await _bybit_exchange()
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "history_outside_replay", extra_asofs=(extra,),
    )


@pytest.mark.asyncio
async def test_the_stored_history_guard_reads_past_the_response_row_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-01 follow-up. PostgREST caps one response at its max rows (1000 on
    Supabase), so a single SELECT of an allocator's snapshot days can come back truncated
    and the subset check would pass on days it never saw. Here the cap is 5 rows and the
    extra stored day (60 days older than the replay) is the eleventh row, so it is only
    seen if the read pages. RED on a single unpaged SELECT: the guard passes and the
    forced replace deletes that day."""
    monkeypatch.setattr(_FakeTable, "max_rows", 5)
    real_paginated_select = er.paginated_select
    monkeypatch.setattr(
        er,
        "paginated_select",
        lambda builder, order_by, **kw: real_paginated_select(
            builder, order_by, page_size=5, **kw
        ),
    )
    extra = (END_DATE - timedelta(days=60)).date().isoformat()
    await _assert_forced_rebuild_refused(
        monkeypatch, await _bybit_exchange(), "history_outside_replay", extra_asofs=(extra,),
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


@pytest.mark.asyncio
async def test_forced_rebuild_refuses_an_okx_curve_clamped_at_the_90_day_terminus(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-03, ``anchor_skipped_okx_terminus``. OKX keeps 90 days of fills, so a 730 day
    window is clamped and the replay starts at zero cash; the anchor is skipped because
    every absolute level is wrong. Unforced that ships the replay; forced it would replace
    the stored curve with it. The anchor itself is readable (1250.5), so only this arm
    can refuse. RED with the arm removed."""
    monkeypatch.setattr(
        "services.exchange.fetch_okx_total_equity_usd", AsyncMock(return_value=1250.5)
    )
    exchange = await _bybit_exchange()
    exchange.id = "okx"
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 50000.0, 1.0)]
    )
    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "anchor_skipped_okx_terminus", venue="okx",
    )


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


def test_forced_rebuild_refusal_reasons_are_a_closed_set() -> None:
    """The post-deploy handoff matches the ``forced rebuild refused (`` prefix and these 15
    tokens to decide re-enqueue-once versus record-only (PD-I). An extra reason, or a
    renamed one, that the handoff does not know would be recorded as an unknown failure;
    the set is therefore pinned in both halves, and so is the message each token produces.

    Phase 167.2.1.1.2 D-02 / UPNLVENUES D-04: the four tokens of the sole-key path
    (``multi_key``, ``sibling_lookup_failed``, ``replay_empty``, ``history_outside_replay``)
    left the set with the unified whole-account path. Until plan 06 removes their raise
    sites from the handler this test pins the VOCABULARY only; the raise-site equality scan
    (every token a ``raise ForcedRebuildRefusedError`` names is in the set, and every token
    in the set is raised) arrives in plan 06, when the handler's sole-key raises leave.
    """
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
    assert len(anchor) + len(account) == 15
    assert er.FORCED_REBUILD_REFUSAL_REASONS == anchor | account, (
        "FORCED_REBUILD_REFUSAL_REASONS is no longer the union of its two halves"
    )
    for reason in sorted(anchor | account):
        exc = er.ForcedRebuildRefusedError(reason)
        assert exc.reason == reason
        assert str(exc) == f"{REFUSAL_PREFIX}{reason})"


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
