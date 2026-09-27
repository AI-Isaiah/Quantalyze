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

# A holder's USDT and a marked key's BTC. Different symbols on purpose: the
# assertions must tell WHICH key's dollars reached the total, which a shared
# symbol would hide.
HOLDER_USD = 1000.0
MARKED_USD = 700.0


def _seed_holder_and_marked(fake: FakeSupabaseClient, kind: str, **holder: Any) -> None:
    _seed_key(fake, API_KEY_ID_1, **holder)
    _seed_key(
        fake, API_KEY_ID_2,
        account_share_kind=kind,
        account_shared_with_api_key_id=API_KEY_ID_1,
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY, MARKED_USD)


@pytest.mark.asyncio
async def test_duplicate_key_is_counted_once_through_its_working_holder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01: a key marked 'duplicate' reads an account its live holder already
    reads. Summing both counts one exchange account twice."""
    fake = FakeSupabaseClient()
    _seed_holder_and_marked(fake, "duplicate")

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD), (
        f"the duplicate's dollars were summed on top of its holder's: {row['value_usd']}"
    )
    assert "BTC" not in row["breakdown"]
    assert _refresh_complete_metadata(audit)["excluded_shared_keys"] == 1


@pytest.mark.asyncio
async def test_composite_member_is_counted_once_through_its_eligible_holder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-04: two members of one composite on one account (a key rotation inside
    the composite). The account counts once, through the holder."""
    fake = FakeSupabaseClient()
    _seed_holder_and_marked(fake, "composite_member")

    await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD)
    assert "BTC" not in row["breakdown"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "holder",
    [
        pytest.param({"sync_status": "revoked"}, id="holder-revoked"),
        pytest.param({"disconnected_at": "2026-09-10T00:00:00Z"}, id="holder-disconnected"),
    ],
)
async def test_duplicate_of_a_departed_holder_counts_on_its_own(
    monkeypatch: pytest.MonkeyPatch, holder: dict[str, Any]
) -> None:
    """Reader rule in COMMENT ON COLUMN api_keys.account_share_kind: the marker
    is NOT cleared when the holder departs. A departed holder contributes
    nothing here, so a reader that dropped every 'duplicate' unconditionally
    would count this account through nobody."""
    fake = FakeSupabaseClient()
    _seed_holder_and_marked(fake, "duplicate", **holder)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    row = _today_row(fake)
    assert row["value_usd"] == pytest.approx(MARKED_USD), (
        "the departed holder must contribute nothing and the marked key must "
        f"count on its own; got {row['value_usd']}"
    )
    assert _refresh_complete_metadata(audit)["excluded_shared_keys"] == 0


@pytest.mark.asyncio
async def test_composite_member_of_an_ineligible_holder_counts_on_its_own(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-04 excludes a composite member only while its holder is eligible, i.e.
    while the holder's own holdings are in this sum."""
    fake = FakeSupabaseClient()
    _seed_holder_and_marked(fake, "composite_member", is_active=False)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    assert _today_row(fake)["value_usd"] == pytest.approx(MARKED_USD)


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
    """A fresh key, a quiet key two days stale, and a duplicate of the fresh key."""
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_key(
        fake, API_KEY_ID_3,
        account_share_kind="duplicate",
        account_shared_with_api_key_id=API_KEY_ID_1,
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY - timedelta(days=2), 500.0)
    _seed_holding(fake, API_KEY_ID_3, "binance", "ETH", TODAY, MARKED_USD)


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
