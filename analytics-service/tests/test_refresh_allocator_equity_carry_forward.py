"""Phase 167.1.2 plan 10 (D-07): the legacy daily refresh counts every eligible
key at that key's LATEST holdings, and counts one exchange account once.

WHY this matters. ``run_refresh_allocator_equity_daily_job`` writes the legacy
``allocator_equity_snapshots`` row that match.py's per-symbol breakdown and the
compare adapter still read. Before this plan it summed only ``asof = today``
holdings, so a key that had not polled yet today contributed $0 and the day's
row showed a fake crash (the founder's -50% "crash" was this defect on the
book curve). And because the row is first-writer-wins on (allocator_id, asof),
whichever key's job ran first decided which patchwork of keys the day kept.

Every test here drives the real job against the in-memory fake the existing
refresh tests use (``tests/test_equity_reconstruction.py``), so the assertion
is on the persisted snapshot row, not on a helper's return value.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from services.equity_reconstruction import run_refresh_allocator_equity_daily_job
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
    _install_fake_audit,
    _install_fake_preflight,
)

TODAY = date(2026, 9, 20)
API_KEY_ID_3 = "00000000-0000-0000-0000-000000000003"


def _seed_key(fake: FakeSupabaseClient, key_id: str, **overrides: Any) -> None:
    """An api_keys row of the allocator. Defaults to an ELIGIBLE, unmarked key
    (``eligible_key_predicate``: is_active, not revoked, not disconnected)."""
    row: dict[str, Any] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "is_active": True,
        "sync_status": "ok",
        "disconnected_at": None,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
    }
    row.update(overrides)
    fake.store[("api_keys", (key_id,))] = row


def _seed_holding(
    fake: FakeSupabaseClient,
    key_id: str,
    venue: str,
    symbol: str,
    asof: date,
    value_usd: float,
    *,
    holding_type: str = "spot",
    unrealized_pnl_usd: float | None = None,
) -> None:
    fake.store[("allocator_holdings", (ALLOCATOR_ID, venue, symbol, asof.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": key_id,
        "venue": venue,
        "symbol": symbol,
        "asof": asof.isoformat(),
        "quantity": 1.0,
        "mark_price": value_usd,
        "value_usd": value_usd,
        "unrealized_pnl_usd": unrealized_pnl_usd,
        "holding_type": holding_type,
    }


async def _run_refresh(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, job_key: str) -> Any:
    """Run the job as ``job_key``'s refresh on TODAY. Returns the audit mock."""
    audit = _install_fake_audit(monkeypatch)
    exchange = AsyncMock()
    exchange.id = "okx"
    exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake, exchange)

    from services import equity_reconstruction as er

    now = datetime(TODAY.year, TODAY.month, TODAY.day, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:  # type: ignore[override]
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_refresh_allocator_equity_daily_job(
        {"id": f"refresh-{job_key}", "kind": "refresh_allocator_equity_daily", "api_key_id": job_key}
    )
    from services.job_worker import DispatchOutcome

    assert result.outcome == DispatchOutcome.DONE, result
    return audit


def _today_row(fake: FakeSupabaseClient) -> dict[str, Any]:
    rows = [
        r for r in fake.rows_for("allocator_equity_snapshots")
        if r["asof"] == TODAY.isoformat()
    ]
    assert len(rows) == 1, f"expected exactly one snapshot row for today, got {len(rows)}"
    return rows[0]


def _refresh_complete_metadata(audit: Any) -> dict[str, Any]:
    calls = [
        c for c in audit.call_args_list
        if c.kwargs.get("action") == "allocator.equity.refresh_complete"
    ]
    assert len(calls) == 1, f"expected one refresh_complete audit, got {len(calls)}"
    metadata: dict[str, Any] = calls[0].kwargs["metadata"]
    return metadata


# ---------------------------------------------------------------------------
# Task 1 (tracer): a key that did not poll today still counts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_quiet_key_counts_at_its_latest_holdings_not_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """Key A polled today; key B last polled two days ago. The day's row is A's
    today PLUS B's last known holdings. Before plan 10 B counted $0 and the
    snapshot showed the book losing B's whole balance overnight.

    B also has an OLDER day (five days ago) with a different value, so the test
    fails if the read takes any day but B's own latest one on or before today.
    """
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 1000.0)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=2), 500.0)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=5), 9999.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(1500.0), (
        "the quiet key must be carried at its latest holdings (500), not read "
        f"as $0 and not at an older day; got {row['value_usd']}"
    )
    assert row["breakdown"] == {"USDT": 1000.0, "BTC": 500.0}

    metadata = _refresh_complete_metadata(audit)
    assert metadata["carried_keys"] == 1
    # T-167.1.2-32: counts only. No figure the snapshot carries may leak into
    # the audit metadata, whatever key it sits under.
    leaked = {k: v for k, v in metadata.items() if v in (1000.0, 500.0, 1500.0)}
    assert not leaked, f"audit metadata carries a USD figure: {sorted(leaked)}"


# ---------------------------------------------------------------------------
# Task 2: one account counted once, write order irrelevant, departed keys out
# ---------------------------------------------------------------------------

# One exchange account behind two keys. The holdings table is last-writer on
# (allocator_id, venue, symbol, asof) with no api_key_id in the key, so the
# account's rows on a day carry whichever key polled it LAST; a pair's two keys
# never write different symbols for one account. The fixtures below are that
# production shape: one venue, one symbol set, and the api_key_id stamp is the
# only thing that varies. TODAY_USD and STALE_USD differ so the total names the
# day the account was read on.
HOLDER_USD = 1000.0
TODAY_USD = 1000.0
STALE_USD = 800.0


def _seed_account_day(
    fake: FakeSupabaseClient, owner_key: str, asof: date, value_usd: float
) -> None:
    """The shared okx account's rows on ``asof``, stamped with the key that
    polled it last that day."""
    _seed_holding(fake, owner_key, "okx", "USDT", asof, value_usd * 0.6)
    _seed_holding(fake, owner_key, "okx", "BTC", asof, value_usd * 0.4)


def _seed_pair(
    fake: FakeSupabaseClient,
    kind: str,
    *,
    holder: dict[str, Any] | None = None,
    marked: dict[str, Any] | None = None,
) -> None:
    """Holder H (API_KEY_ID_1) and a key M (API_KEY_ID_2) marked ``kind`` of H.
    The marked key's venue id is NULL in production; the refresh reads none."""
    _seed_key(fake, API_KEY_ID_1, **(holder or {}))
    _seed_key(
        fake, API_KEY_ID_2,
        account_share_kind=kind,
        account_shared_with_api_key_id=API_KEY_ID_1,
        **(marked or {}),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["duplicate", "composite_member"])
async def test_shared_account_is_read_by_group_not_by_the_holders_own_rows(
    monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    """C2 review CR-03. Both keys poll the one account; M polled last today, so
    TODAY's rows carry M's id, and H's own-named rows are three days old. Plan
    10 excluded M and read H's own rows at H's latest day, persisting the
    three-day-old total as today's snapshot. The account is read as a GROUP:
    the group's latest day over every member's rows, summed once."""
    fake = FakeSupabaseClient()
    _seed_pair(fake, kind)
    _seed_account_day(fake, API_KEY_ID_1, TODAY - timedelta(days=3), STALE_USD)
    _seed_account_day(fake, API_KEY_ID_2, TODAY, TODAY_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(TODAY_USD), (
        f"the account was read at the holder's stale own rows: {row['value_usd']}"
    )
    assert row["breakdown"] == {"USDT": 600.0, "BTC": 400.0}
    metadata = _refresh_complete_metadata(audit)
    assert metadata["excluded_shared_keys"] == 1
    assert metadata["carried_keys"] == 0


@pytest.mark.asyncio
async def test_shared_account_rows_split_across_both_keys_are_summed_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both keys polled today and each won the race for one symbol. The account's
    day is the union of the group's rows, one row per symbol, never a key's half."""
    fake = FakeSupabaseClient()
    _seed_pair(fake, "duplicate")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 600.0)
    _seed_holding(fake, API_KEY_ID_2, "okx", "BTC", TODAY, 400.0)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(1000.0)
    assert row["breakdown"] == {"USDT": 600.0, "BTC": 400.0}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["duplicate", "composite_member"])
@pytest.mark.parametrize(
    "holder",
    [
        pytest.param({"is_active": False}, id="holder-inactive"),
        pytest.param({"sync_status": "error"}, id="holder-error"),
        pytest.param({"sync_status": "sign_in_failed"}, id="holder-sign-in-failed"),
        pytest.param({"sync_status": "revoked"}, id="holder-revoked"),
        pytest.param({"disconnected_at": "2026-09-10T00:00:00Z"}, id="holder-disconnected"),
    ],
)
async def test_account_behind_a_non_working_holder_is_counted_once_by_the_healthy_key(
    monkeypatch: pytest.MonkeyPatch, kind: str, holder: dict[str, Any]
) -> None:
    """C2 review CR-01 / SFH-01 / SFH-03 (D-18). The holder stopped polling (an
    inactive key is never polled; a failing one polls and fails), so its own
    rows are old, and the healthy marked key has polled the account today.

    Before this fix an inactive holder took the healthy key out with it and the
    account was counted by NOBODY; an error / sign_in_failed holder stayed
    counted at its frozen rows while the healthy key's fresh ones were thrown
    away every day, persisted first-writer-wins. The account is counted once, at
    today's rows — never twice (the naive predicate swap would have summed the
    failing holder's carried rows beside the healthy key's)."""
    fake = FakeSupabaseClient()
    _seed_pair(fake, kind, holder=holder)
    _seed_account_day(fake, API_KEY_ID_1, TODAY - timedelta(days=5), STALE_USD)
    _seed_account_day(fake, API_KEY_ID_2, TODAY, TODAY_USD)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(TODAY_USD), (
        f"expected the account once at today's rows (1000); got {row['value_usd']}"
    )


@pytest.mark.asyncio
async def test_shared_account_with_no_working_key_is_carried_once_and_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-18, neither key works (both eligible, both failing). The account is
    carried ONCE at its last rows — never $0 and never twice — and the refresh
    says so: no_working_accounts in the audit, beside carried_keys."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_3)
    _seed_holding(fake, API_KEY_ID_3, "bybit", "ETH", TODAY, 300.0)
    _seed_pair(
        fake, "duplicate",
        holder={"sync_status": "error"},
        marked={"sync_status": "sign_in_failed"},
    )
    _seed_account_day(fake, API_KEY_ID_1, TODAY - timedelta(days=4), STALE_USD)
    _seed_account_day(fake, API_KEY_ID_2, TODAY - timedelta(days=2), TODAY_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_3)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(300.0 + TODAY_USD)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["no_working_accounts"] == 1
    assert metadata["carried_keys"] == 1
    assert metadata["excluded_shared_keys"] == 1


# ---------------------------------------------------------------------------
# C2 review round 2, R2-CR-02: an identity-unknown, not-working account is not
# carried.
#
# The pre-C1 credential rotation: old key A stopped working before C1's stamper
# existed, so its venue_account_id is NULL forever (the stamper runs only after
# a successful poll), and new key B was stamped plainly and left UNMARKED (no
# live holder carried the id). account_groups makes them two groups, and the
# per-key carry summed A's last rows beside B's today: the account twice,
# every day, first-writer-wins (the reviewer measured 2000 where 1000 is
# right). On main the today-only read gave 1000.
#
# The fix is the smallest one that needs no new identity data: a group none of
# whose eligible keys is WORKING (D-18) and none of whose keys carries a
# venue_account_id, on a venue that stamps one, is not carried forward. Only
# its same-day rows count, which is main's pre-C2 behaviour for such a key.
# The trade (pinned below): a GENUINELY separate account behind a failing,
# never-stamped key drops out of the day's row on a quiet day, exactly as on
# main.
# ---------------------------------------------------------------------------


def _seed_unmarked_rotation(fake: FakeSupabaseClient, **old_key: Any) -> None:
    """Old key A (API_KEY_ID_1): failing, never stamped, unmarked, its rows five
    days old. New key B (API_KEY_ID_2): working, stamped, unmarked, polled the
    same okx account today (same symbols, so today's rows carry B's id)."""
    _seed_key(
        fake, API_KEY_ID_1,
        **{"exchange": "okx", "sync_status": "error", "venue_account_id": None, **old_key},
    )
    _seed_key(
        fake, API_KEY_ID_2,
        exchange="okx", sync_status="complete", venue_account_id="okx-uid-1",
    )
    _seed_account_day(fake, API_KEY_ID_1, TODAY - timedelta(days=5), TODAY_USD)
    _seed_account_day(fake, API_KEY_ID_2, TODAY, TODAY_USD)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["error", "sign_in_failed"])
async def test_unmarked_rotation_does_not_count_the_account_twice(
    monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    """The reviewer's case: 2000 persisted where the account holds 1000."""
    fake = FakeSupabaseClient()
    _seed_unmarked_rotation(fake, sync_status=status)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(TODAY_USD), (
        f"one account counted twice through an unstamped failing key: {row['value_usd']}"
    )
    metadata = _refresh_complete_metadata(audit)
    assert metadata["identity_unknown_not_carried"] == 1
    assert metadata["carried_keys"] == 0


@pytest.mark.asyncio
async def test_a_separate_account_behind_a_failing_unstamped_key_drops_out_on_a_quiet_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The trade R2-CR-02 accepts, pinned so it is a decision and not an
    accident. A bybit account that really is separate sits behind a failing
    key that was never stamped; nothing can tell it apart from the rotation
    above. On a day it has no rows it is not carried, as on main, and the
    audit counts it so the drop is not silent."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="okx-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="error", venue_account_id=None)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=2), 500.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _today_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert _refresh_complete_metadata(audit)["identity_unknown_not_carried"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "old_key",
    [
        pytest.param({"sync_status": "complete"}, id="working-unstamped-key"),
        pytest.param({"venue_account_id": "okx-uid-0"}, id="failing-stamped-key"),
        pytest.param({"exchange": "mt5"}, id="failing-key-on-a-venue-that-stamps-no-id"),
    ],
)
async def test_the_identity_unknown_rule_leaves_other_carries_alone(
    monkeypatch: pytest.MonkeyPatch, old_key: dict[str, Any]
) -> None:
    """The rule is narrow. A WORKING key is still carried when it has not
    polled yet today (D-07), stamped or not. A failing key whose account id is
    KNOWN is identity-known, so it is carried. A failing key on a venue that
    never stamps an id (MT5, sFOX) is not "unknown", it is unstampable, and it
    keeps its carry."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, **{"exchange": "okx", "sync_status": "error", **old_key})
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY - timedelta(days=2), 700.0)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    assert _today_row(fake)["value_usd"] == pytest.approx(HOLDER_USD + 700.0)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["identity_unknown_not_carried"] == 0
    assert metadata["carried_keys"] == 1


@pytest.mark.asyncio
async def test_identity_unknown_not_working_key_still_counts_its_same_day_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only the CARRY is withheld. Rows the key's account has TODAY are counted,
    which is what main's today-only read did for it."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="error", venue_account_id=None)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 400.0)
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    assert _today_row(fake)["value_usd"] == pytest.approx(HOLDER_USD + 400.0)
    assert _refresh_complete_metadata(audit)["identity_unknown_not_carried"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "departed",
    [
        pytest.param({"sync_status": "revoked"}, id="revoked"),
        pytest.param({"disconnected_at": "2026-09-10T00:00:00Z"}, id="disconnected"),
    ],
)
async def test_departed_key_contributes_nothing_even_with_holdings_today(
    monkeypatch: pytest.MonkeyPatch, departed: dict[str, Any]
) -> None:
    """A revoked or disconnected key is not eligible, so its rows (even today's)
    stay out of the total; nothing carries it forward."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_3, **departed)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_3, "binance", "ETH", TODAY, 400.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _today_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert _refresh_complete_metadata(audit)["eligible_keys"] == 1


def _seed_book(fake: FakeSupabaseClient) -> None:
    """A fresh key, a quiet key two days stale, and a duplicate of the fresh key
    that polled the shared account after it today (so today's row carries the
    duplicate's id: the same store key, overwritten, as in production)."""
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_key(
        fake, API_KEY_ID_3,
        account_share_kind="duplicate",
        account_shared_with_api_key_id=API_KEY_ID_1,
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=2), 500.0)
    _seed_holding(fake, API_KEY_ID_3, "okx", "USDT", TODAY, HOLDER_USD)


@pytest.mark.asyncio
async def test_write_order_does_not_change_the_persisted_row(monkeypatch: pytest.MonkeyPatch) -> None:
    """The row is first-writer-wins on (allocator_id, asof) (``persist_equity_
    snapshots`` upserts with ignore_duplicates, which the fake honours). Each
    key's job now computes the same book total, so whichever key writes first,
    the day keeps the same row. Run A-then-B on one store and B-then-A on
    another; compare the persisted rows."""
    rows = []
    for order in ((API_KEY_ID_1, API_KEY_ID_2), (API_KEY_ID_2, API_KEY_ID_1)):
        fake = FakeSupabaseClient()
        _seed_book(fake)
        for key_id in order:
            await _run_refresh(monkeypatch, fake, key_id)
        rows.append(_today_row(fake))

    first, second = rows
    assert first["value_usd"] == second["value_usd"] == pytest.approx(HOLDER_USD + 500.0)
    assert first["breakdown"] == second["breakdown"] == {"USDT": HOLDER_USD, "BTC": 500.0}


@pytest.mark.asyncio
async def test_carried_key_keeps_the_deribit_skip_and_the_upnl_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    """The summation below the read is unchanged for carried rows: a Deribit row
    is skipped, a derivative contributes its uPnL (never notional), and a
    derivative with NULL uPnL lands in the perp_upnl_missing audit."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    stale = TODAY - timedelta(days=1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(
        fake, API_KEY_ID_2, "bybit", "ETHUSDT", stale, 50_000.0,
        holding_type="derivative", unrealized_pnl_usd=25.0,
    )
    _seed_holding(
        fake, API_KEY_ID_2, "bybit", "SOLUSDT", stale, 9_000.0,
        holding_type="derivative", unrealized_pnl_usd=None,
    )
    _seed_holding(
        fake, API_KEY_ID_2, "deribit", "BTC-PERPETUAL", stale, 80_000.0,
        holding_type="derivative", unrealized_pnl_usd=333.0,
    )

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD + 25.0)
    missing = [
        c for c in audit.call_args_list
        if c.kwargs.get("action") == "allocator.equity.perp_upnl_missing"
    ]
    assert len(missing) == 1
    assert missing[0].kwargs["metadata"]["symbols"] == ["SOLUSDT"]
    assert _refresh_complete_metadata(audit)["carried_keys"] == 1


# ---------------------------------------------------------------------------
# C2 review CR-04: an EMPTIED account is $0, not its last balance forever.
#
# The ccxt spot builder keeps only qty > 0 and persist_allocator_holdings
# writes nothing for an empty list, so an account that was fully withdrawn and
# stays connected keeps polling successfully and writes no row. The carry then
# held its last positive day forever. api_keys.last_sync_at is NOT evidence of
# emptiness: cron-sync (routers/cron.py) also advances it for every active key
# with no new trades, every tick, and writes no sync_status.
#
# Round 2 (R2-CR-01): the proof is the proving POLL's own recorded outcome,
# never the key's CURRENT sync_status. Round 1 admitted a done poll only while
# the key read exactly 'complete' at refresh time, so a later 429
# ('rate_limited') or a manual sync ('syncing') put a proven-empty account
# back at its old balance, first-writer-wins. The poll records its outcome in
# the allocator.holdings.sync_completed audit event it emits on success:
# row_count (always) and final_status (added in this round). Proof = such an
# event for a ccxt member, created on a day after the account's latest row,
# with final_status 'complete' and row_count 0.
# ---------------------------------------------------------------------------


def _seed_poll_outcome(
    fake: FakeSupabaseClient,
    key_id: str,
    at: datetime,
    *,
    final_status: str | None = "complete",
    row_count: int = 0,
    action: str = "allocator.holdings.sync_completed",
) -> None:
    """The audit row a holdings poll of ``key_id`` wrote at ``at``.
    ``final_status=None`` is the shape a poll wrote before this round."""
    metadata: dict[str, Any] = {
        "row_count": row_count,
        "holding_type_counts": {"spot": row_count, "derivative": 0},
    }
    if final_status is not None:
        metadata["final_status"] = final_status
    event_id = f"audit-{key_id}-{at.isoformat()}-{action}"
    fake.store[("audit_log", (event_id,))] = {
        "id": event_id,
        "user_id": ALLOCATOR_ID,
        "action": action,
        "entity_type": "api_key",
        "entity_id": key_id,
        "metadata": metadata,
        "created_at": at.isoformat(),
    }


def _at(day: date, hour: int = 4) -> datetime:
    return datetime(day.year, day.month, day.day, hour, 3, tzinfo=timezone.utc)


def _seed_emptied_candidate(fake: FakeSupabaseClient, **key: Any) -> None:
    """Key 1 is a live okx account polled today. Key 2's account had BTC three
    days ago and no row since. Key 2 carries its stamped account id, so the
    identity-unknown rule (R2-CR-02) is not what decides these cases."""
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete")
    _seed_key(
        fake, API_KEY_ID_2,
        **{
            "exchange": "bybit",
            "sync_status": "complete",
            "venue_account_id": "bybit-uid-2",
            **key,
        },
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=3), 500.0)


@pytest.mark.asyncio
@pytest.mark.parametrize("claimed_days_ago", [0, 2])
async def test_account_polled_empty_after_its_last_row_contributes_zero(
    monkeypatch: pytest.MonkeyPatch, claimed_days_ago: int
) -> None:
    """Polled successfully today (or two days ago), zero rows since, rows three
    days ago: the account is empty and contributes $0, and the audit counts it."""
    fake = FakeSupabaseClient()
    _seed_emptied_candidate(fake)
    _seed_poll_outcome(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=claimed_days_ago)))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD), (
        f"an emptied account was carried at its last balance: {row['value_usd']}"
    )
    assert "BTC" not in row["breakdown"]
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 1
    assert metadata["carried_keys"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "current_status",
    ["complete", "rate_limited", "syncing", "idle", "complete_with_warnings", "error"],
)
async def test_proven_empty_account_stays_zero_whatever_the_keys_current_status(
    monkeypatch: pytest.MonkeyPatch, current_status: str
) -> None:
    """C2 review round 2, R2-CR-01. The proving poll ran clean yesterday
    (final_status 'complete', 0 rows). Today the key reads a transient status:
    a 429 on a later poll wrote 'rate_limited', a manual sync wrote 'syncing'.
    Round 1 judged the proof on that CURRENT status and re-carried the old
    balance (measured 1500 where 1000 is right). The proof belongs to the poll
    that ran, so the account stays at $0."""
    fake = FakeSupabaseClient()
    _seed_emptied_candidate(fake, sync_status=current_status)
    _seed_poll_outcome(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _today_row(fake)["value_usd"] == pytest.approx(HOLDER_USD), current_status
    assert _refresh_complete_metadata(audit)["emptied_accounts"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        pytest.param("no_poll_outcome", id="no-recorded-poll"),
        pytest.param("poll_same_day_as_rows", id="poll-on-the-rows-day"),
        pytest.param("warnings", id="proving-poll-had-warnings"),
        pytest.param("poll_failed", id="the-poll-failed"),
        pytest.param("poll_wrote_rows", id="the-poll-wrote-rows"),
        pytest.param("pre_round_event", id="event-without-final-status"),
        pytest.param("non_ccxt", id="mt5-writes-its-own-empty-marker"),
    ],
)
async def test_account_without_proof_of_emptiness_is_carried(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """Only a clean, empty ccxt poll recorded after the last row proves an
    empty account. Without that proof the D-07 carry holds (never a false $0):
    no recorded poll; a poll on the rows' own day (it wrote them); a proving
    poll whose own outcome was complete_with_warnings (a derivative read
    failed, so empty spot is not an empty account); a poll that failed (it
    records sync_failed, never sync_completed); a poll that wrote rows (rows
    landed after the read, so the account is not empty); an event written
    before final_status was recorded (its outcome is unknown); a non-ccxt venue
    (MT5 persists an explicit empty marker row itself; sFOX and unsupported
    venues return no rows with a warning)."""
    fake = FakeSupabaseClient()
    key: dict[str, Any] = {}
    if case == "non_ccxt":
        key = {"exchange": "mt5"}
    _seed_emptied_candidate(fake, **key)
    today_poll = _at(TODAY)
    if case == "poll_same_day_as_rows":
        _seed_poll_outcome(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=3), hour=23))
    elif case == "warnings":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll, final_status="complete_with_warnings")
    elif case == "poll_failed":
        _seed_poll_outcome(
            fake, API_KEY_ID_2, today_poll, action="allocator.holdings.sync_failed"
        )
    elif case == "poll_wrote_rows":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll, row_count=3)
    elif case == "pre_round_event":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll, final_status=None)
    elif case != "no_poll_outcome":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD + 500.0)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 0
    assert metadata["carried_keys"] == 1


@pytest.mark.asyncio
async def test_eligible_key_that_never_polled_is_counted_not_silent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C2 silent-failure SFH-08: an eligible key with no holdings row yet (a key
    just added, or a broken poller) adds $0 to the day's row. Holding the write
    for it is a design call not taken here; the day is written without it, and
    the audit says how many such keys there were."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _today_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["never_polled_keys"] == 1
    assert metadata["carried_keys"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(("stale_days", "warns"), [(2, False), (3, False), (5, True)])
async def test_carry_age_is_recorded_and_an_old_carry_warns(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    stale_days: int,
    warns: bool,
) -> None:
    """C2 silent-failure SFH-09: a carried account contributes its value_usd
    from its last poll, priced at THAT day's marks, and D-07 sets no horizon.
    The only trace was the aggregate carried_keys count. The oldest carry's age
    in days is now in the audit, and a carry older than
    CARRY_AGE_WARN_DAYS logs a WARNING (no id, no USD)."""
    import logging

    from services.equity_reconstruction import CARRY_AGE_WARN_DAYS

    assert CARRY_AGE_WARN_DAYS == 3
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.equity_reconstruction")
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=stale_days), 500.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _refresh_complete_metadata(audit)["max_carry_age_days"] == stale_days
    carry_warnings = [
        r for r in caplog.records
        if r.levelno == logging.WARNING and "carried" in r.getMessage()
    ]
    assert bool(carry_warnings) is warns, caplog.text
    assert API_KEY_ID_2 not in caplog.text
    assert "500" not in " ".join(r.getMessage() for r in carry_warnings)


@pytest.mark.asyncio
async def test_no_carry_records_a_zero_carry_age(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _refresh_complete_metadata(audit)["max_carry_age_days"] == 0
