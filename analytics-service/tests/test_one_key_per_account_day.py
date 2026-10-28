"""Phase 170.4 plan 11 (D-10, D-08): the Python half of the one-key-per-account-day
rule, replayed against the case table the TS twin reads too
(``tests/fixtures/one_key_per_account_day_cases.json``; ``src/lib/holdings-account-day.ts``).

The figures in that file are hand-typed. Nothing here derives an expectation
from the code under test: a survivor list and a dollar sum come from the file,
and the refresh totals below are typed by hand from the rows each test seeds.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from services.allocator_equity_derive import (
    HoldingsUpdatedAtError,
    one_key_per_account_day,
    written_at_micros,
)
from services.equity_reconstruction import run_refresh_allocator_equity_daily_job
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
    _install_fake_audit,
    _install_fake_preflight,
)

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "one_key_per_account_day_cases.json").read_text()
)


def _survivors_by_account(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """What the refresh does per group: the account's rows on its newest day,
    handed to the rule. The case file's ``account`` field is the group."""
    by_account: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_account[row["account"]].append(row)
    out: dict[str, list[dict[str, Any]]] = {}
    for account, group in by_account.items():
        newest = max(r["asof"] for r in group)
        out[account] = one_key_per_account_day([r for r in group if r["asof"] == newest])
    return out


@pytest.mark.parametrize("item", _SPEC["micros"], ids=lambda i: i["ts"])
def test_written_at_micros_matches_the_shared_table(item: dict[str, Any]) -> None:
    assert written_at_micros(item["ts"]) == item["micros"]


@pytest.mark.parametrize("ts", _SPEC["micros_errors"], ids=repr)
def test_written_at_micros_rejects_what_the_shared_table_rejects(ts: str) -> None:
    with pytest.raises(HoldingsUpdatedAtError):
        written_at_micros(ts)


@pytest.mark.parametrize("value", [None, 20261011, {}])
def test_written_at_micros_rejects_a_non_string(value: Any) -> None:
    with pytest.raises(HoldingsUpdatedAtError):
        written_at_micros(value)


def test_the_shared_table_is_not_empty() -> None:
    assert len(_SPEC["cases"]) > 10


@pytest.mark.parametrize("case", _SPEC["cases"], ids=lambda c: c["name"])
def test_one_key_per_account_day_matches_the_shared_table(case: dict[str, Any]) -> None:
    if "expect_error" in case:
        assert case["expect_error"] == HoldingsUpdatedAtError.__name__
        with pytest.raises(HoldingsUpdatedAtError):
            _survivors_by_account(case["rows"])
        return
    survivors = _survivors_by_account(case["rows"])
    got = {
        account: sorted({r["api_key_id"] for r in rows})
        for account, rows in survivors.items()
    }
    assert got == {a: sorted(ids) for a, ids in case["expected"].items()}
    assert sum(r["value_usd"] for rows in survivors.values() for r in rows) == case[
        "expected_sum_usd"
    ]


def test_input_order_is_kept_and_the_input_is_not_mutated() -> None:
    rows = [
        {"api_key_id": "a", "updated_at": "2026-10-11T04:00:00Z", "holding_type": "spot", "symbol": "ETH"},
        {"api_key_id": "b", "updated_at": "2026-10-11T05:00:00Z", "holding_type": "spot", "symbol": "SOL"},
        {"api_key_id": "b", "updated_at": "2026-10-11T05:00:00Z", "holding_type": "spot", "symbol": "BTC"},
    ]
    before = json.dumps(rows)
    assert [r["symbol"] for r in one_key_per_account_day(rows)] == ["SOL", "BTC"]
    assert json.dumps(rows) == before
    assert one_key_per_account_day([]) == []


# ---------------------------------------------------------------------------
# The daily refresh sums one key per account-day (D-10).
# ---------------------------------------------------------------------------

TODAY = date(2026, 10, 11)
# 167.2.1.1.1.1 D-01: the refresh labels its one row the UTC day that closed.
CLOSED_DAY = TODAY - timedelta(days=1)


def _seed_key(fake: FakeSupabaseClient, key_id: str, **overrides: Any) -> None:
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
    value_usd: float,
    updated_at: str,
    holding_type: str = "spot",
    unrealized_pnl_usd: float | None = None,
) -> None:
    fake.store[("allocator_holdings", (ALLOCATOR_ID, venue, symbol, TODAY.isoformat(), key_id))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": key_id,
        "venue": venue,
        "symbol": symbol,
        "asof": TODAY.isoformat(),
        "quantity": 1.0,
        "mark_price": value_usd,
        "value_usd": value_usd,
        "unrealized_pnl_usd": unrealized_pnl_usd,
        "holding_type": holding_type,
        "updated_at": updated_at,
    }


async def _run_refresh(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient) -> None:
    _install_fake_audit(monkeypatch)
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
        {
            "id": "refresh-170-4-11",
            "kind": "refresh_allocator_equity_daily",
            "api_key_id": API_KEY_ID_1,
        }
    )
    from services.job_worker import DispatchOutcome

    assert result.outcome == DispatchOutcome.DONE, result


def _today_total(fake: FakeSupabaseClient) -> float:
    rows = [
        r for r in fake.rows_for("allocator_equity_snapshots")
        if r["asof"] == CLOSED_DAY.isoformat()
    ]
    assert len(rows) == 1, f"expected exactly one snapshot row for the closed day, got {len(rows)}"
    return float(rows[0]["value_usd"])


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["duplicate", "composite_member"])
async def test_one_account_with_two_keys_holding_the_day_counts_once(
    monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    """Holder a and key b (marked of a) both hold rows on the latest day. b's poll
    is later, so b's rows are the account's: 30000 + 5000 = 35000, not the 65000
    both keys' rows sum to (a: BTC 25000, ETH 5000)."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(
        fake,
        API_KEY_ID_2,
        account_share_kind=kind,
        account_shared_with_api_key_id=API_KEY_ID_1,
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "BTC", 25000.0, "2026-10-11T04:00:05.123456+00:00")
    _seed_holding(fake, API_KEY_ID_1, "okx", "ETH", 5000.0, "2026-10-11T04:00:05.123456+00:00")
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", 30000.0, "2026-10-11T04:02:10.5Z")
    _seed_holding(fake, API_KEY_ID_2, "bybit", "ETH", 5000.0, "2026-10-11T04:02:10.5Z")

    await _run_refresh(monkeypatch, fake)

    assert _today_total(fake) == pytest.approx(35000.0)


@pytest.mark.asyncio
async def test_two_different_accounts_on_one_day_sum_both(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08: keys on DIFFERENT accounts each keep their own rows."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_holding(fake, API_KEY_ID_1, "okx", "BTC", 25000.0, "2026-10-11T04:00:05Z")
    _seed_holding(fake, API_KEY_ID_1, "okx", "ETH", 5000.0, "2026-10-11T04:00:05Z")
    _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", 30000.0, "2026-10-11T03:00:00Z")
    _seed_holding(fake, API_KEY_ID_2, "bybit", "ETH", 5000.0, "2026-10-11T03:00:00Z")

    await _run_refresh(monkeypatch, fake)

    assert _today_total(fake) == pytest.approx(65000.0)


@pytest.mark.asyncio
async def test_a_later_spot_only_poll_keeps_the_earlier_keys_derivative_pnl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WR-01: key a's complete poll wrote spot and a derivative position; key b (marked
    of a) polled later and read spot only. The spot class is b's (30000), and a's
    derivative unrealised P&L (800) still counts: 30000 + 800 = 30800, not the 30000
    a per-account winner gives."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(
        fake,
        API_KEY_ID_2,
        account_share_kind="duplicate",
        account_shared_with_api_key_id=API_KEY_ID_1,
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "BTC", 25000.0, "2026-10-11T04:00:05Z")
    _seed_holding(
        fake,
        API_KEY_ID_1,
        "okx",
        "ETH-PERP",
        4000.0,
        "2026-10-11T04:00:05Z",
        holding_type="derivative",
        unrealized_pnl_usd=800.0,
    )
    _seed_holding(fake, API_KEY_ID_2, "okx", "BTC", 30000.0, "2026-10-11T04:02:10Z")

    await _run_refresh(monkeypatch, fake)

    assert _today_total(fake) == pytest.approx(30800.0)
