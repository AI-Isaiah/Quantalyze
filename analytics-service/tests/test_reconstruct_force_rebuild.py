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
4. The multi-key limit is recorded, not hidden: with any sibling api_keys row the persist
   half still takes first-writer-wins DO NOTHING, so a forced job cannot overwrite rows
   written with the old anchor. TODOS [167.2.1.1-MULTIKEY-RECOMPUTE] (booked by plan 06)
   owns that gap and the handoff records such allocators as "recorded, not recomputed".
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
    _install_fake_audit,
    _install_fake_preflight,
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
# The recorded limit: a multi-key allocator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_forced_rebuild_cannot_overwrite_a_multi_key_allocators_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The recorded limit (T-07-V5b). With ANY other api_keys row for the same user the
    persist half is first-writer-wins DO NOTHING, so a forced rebuild crawls but cannot
    replace the rows an old anchor wrote: ten sentinel rows survive and the completion
    audit reports no atomic replace and no purge. This is NOT a fix: it is the pinned
    reason plan 06 books TODOS [167.2.1.1-MULTIKEY-RECOMPUTE] and the post-deploy handoff
    records such allocators as "recorded, not recomputed" (SC-3)."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    _seed_key(fake, API_KEY_ID_2, marker=MARKER, exchange="okx")
    for days_back in range(10):
        asof = (END_DATE - timedelta(days=days_back)).date().isoformat()
        fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": 12345.0,
            "breakdown": {"ETH": 12345.0},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert exchange.fetch_my_trades.await_count > 0, "the forced job did not crawl"
    survivors = [
        r for r in fake.rows_for("allocator_equity_snapshots") if r.get("value_usd") == 12345.0
    ]
    assert len(survivors) == 10, (
        "a forced rebuild overwrote a multi-key allocator's rows (first-writer-wins "
        f"DO NOTHING is the contract); {len(survivors)} of 10 sentinel rows survive. "
        "TODOS [167.2.1.1-MULTIKEY-RECOMPUTE] owns the recompute of these allocators."
    )
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete.get("atomic_replace") is False, complete
    assert complete.get("stale_snapshots_purged") == 0, complete


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


def _seed_sentinel_rows(fake: Any) -> None:
    """Ten snapshot rows for the allocator, all at the sentinel value: a refused forced
    rebuild must leave every one of them exactly as seeded."""
    for days_back in range(SENTINEL_ROWS):
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
    monkeypatch: pytest.MonkeyPatch, exchange: Any, reason: str
) -> None:
    """A marked SOLE Bybit key with ten sentinel rows, a forced job, ``exchange``: the job
    ends FAILED/permanent naming ``reason``, and NOTHING changed: every sentinel row, the
    marker, no completion audit. Static text only: the planted signature is absent."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    _seed_sentinel_rows(fake)
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert exchange.fetch_my_trades.await_count > 0, "the forced job did not crawl"
    prefix = f"{REFUSAL_PREFIX}{reason})"
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "permanent", result
    assert (result.error_message or "").startswith(prefix), result.error_message
    assert LEAKED_SIGNATURE not in (result.error_message or ""), result.error_message

    rows = fake.rows_for("allocator_equity_snapshots")
    assert len(rows) == SENTINEL_ROWS and all(
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
