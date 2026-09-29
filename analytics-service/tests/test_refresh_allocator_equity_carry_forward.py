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
# held its last positive day forever. The evidence that an account is empty is
# a SUCCESSFUL holdings poll claimed on a day AFTER the account's latest row:
# the poll computes its asof after its claim, so a poll that wrote rows has
# asof >= its claim day. api_keys.last_sync_at is NOT that evidence: cron-sync
# (routers/cron.py) also advances it for every active key with no new trades,
# every tick, and writes no sync_status.
# ---------------------------------------------------------------------------


def _seed_done_poll(fake: FakeSupabaseClient, key_id: str, claimed_at: datetime) -> None:
    job_id = f"poll-{key_id}-{claimed_at.isoformat()}"
    fake.store[("compute_jobs", (job_id,))] = {
        "id": job_id,
        "kind": "poll_allocator_positions",
        "api_key_id": key_id,
        "status": "done",
        "claimed_at": claimed_at.isoformat(),
    }


def _at(day: date, hour: int = 4) -> datetime:
    return datetime(day.year, day.month, day.day, hour, 3, tzinfo=timezone.utc)


def _seed_emptied_candidate(fake: FakeSupabaseClient, **key: Any) -> None:
    """Key 1 is a live okx account polled today. Key 2's account had BTC three
    days ago and no row since."""
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete")
    _seed_key(fake, API_KEY_ID_2, **{"exchange": "bybit", "sync_status": "complete", **key})
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
    _seed_done_poll(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=claimed_days_ago)))

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
    "case",
    [
        pytest.param("no_done_poll", id="no-done-poll"),
        pytest.param("poll_same_day_as_rows", id="poll-claimed-on-the-rows-day"),
        pytest.param("warnings", id="last-poll-had-warnings"),
        pytest.param("failing", id="last-poll-failed"),
        pytest.param("non_ccxt", id="mt5-writes-its-own-empty-marker"),
        pytest.param("poll_not_done", id="poll-still-running"),
    ],
)
async def test_account_without_proof_of_emptiness_is_carried(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """Only a successful ccxt poll claimed after the last row proves an empty
    account. Without that proof the D-07 carry holds (never a false $0): no done
    poll; a poll claimed on the rows' own day (it wrote them); a last poll with a
    warning (complete_with_warnings: a derivative read failed, so empty spot is
    not an empty account) or a failure; a non-ccxt venue (MT5 persists an
    explicit empty marker row itself; sFOX and unsupported venues return no
    rows with a warning); a poll that has not finished."""
    fake = FakeSupabaseClient()
    key: dict[str, Any] = {}
    if case == "warnings":
        key = {"sync_status": "complete_with_warnings"}
    elif case == "failing":
        key = {"sync_status": "error"}
    elif case == "non_ccxt":
        key = {"exchange": "mt5"}
    _seed_emptied_candidate(fake, **key)
    if case == "poll_same_day_as_rows":
        _seed_done_poll(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=3), hour=23))
    elif case == "poll_not_done":
        _seed_done_poll(fake, API_KEY_ID_2, _at(TODAY))
        fake.store[("compute_jobs", (f"poll-{API_KEY_ID_2}-{_at(TODAY).isoformat()}",))][
            "status"
        ] = "running"
    elif case != "no_done_poll":
        _seed_done_poll(fake, API_KEY_ID_2, _at(TODAY))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD + 500.0)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 0
    assert metadata["carried_keys"] == 1
