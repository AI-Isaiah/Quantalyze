"""170.4 plan 12 (D-08, D-10, Phase 167.1.1 R-15-1 / R-15-2): the match scorer's
``portfolio_aum`` counts every key's position and each exchange account once.

``_load_holding_portfolio_context`` used to keep ONE row per (venue, symbol,
holding_type) across ALL keys and ALL dates, so two keys on different accounts
holding one symbol under-counted, and a key's row from before its account's newest
day could still win. It now reads each account's newest day from one key
(``account_groups`` + ``one_key_per_account_day``, plan 11) and sums the rest.

Every dollar figure is hand-typed.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import pytest

from routers import match as match_mod
from services.allocator_equity_derive import HoldingsUpdatedAtError
from tests.fake_postgrest import FakeDb

ALLOCATOR = "alloc-1"


def _key(key_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": key_id,
        "user_id": ALLOCATOR,
        "exchange": "binance",
        "venue_account_id": None,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
        **over,
    }


def _holding(
    key: str,
    symbol: str,
    value: float,
    asof: str,
    updated_at: str | None,
    venue: str = "binance",
) -> dict[str, Any]:
    return {
        "allocator_id": ALLOCATOR,
        "api_key_id": key,
        "venue": venue,
        "symbol": symbol,
        "holding_type": "spot",
        "value_usd": value,
        "mark_price": 100.0,
        "side": "flat",
        "unrealized_pnl_usd": None,
        "asof": asof,
        "updated_at": updated_at,
    }


@pytest.fixture(autouse=True)
def _warm_series(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every holding clears the 30-day warm-up gate, so AUM is the plain sum."""
    series = pd.Series([0.001] * 40)
    monkeypatch.setattr(match_mod, "reconstruct_symbol_returns", lambda _s, _sym: series)


def _ctx(monkeypatch: pytest.MonkeyPatch, db: FakeDb) -> dict[str, Any]:
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    return match_mod._load_holding_portfolio_context(ALLOCATOR)


def test_two_keys_on_different_accounts_holding_one_symbol_are_both_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeDb(
        {
            "api_keys": [_key("key-a"), _key("key-b")],
            "allocator_holdings": [
                _holding("key-a", "BTC", 40000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
                _holding("key-b", "BTC", 25000.0, "2026-10-11", "2026-10-11T04:01:00+00:00"),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    ctx = _ctx(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(65000.0)
    assert [s["strategy_id"] for s in ctx["portfolio_strategies"]] == ["holding:binance:BTC:spot"]
    assert ctx["portfolio_weights"] == {"holding:binance:BTC:spot": pytest.approx(1.0)}
    assert len(ctx["holdings_rows_eligible"]) == 1
    assert ctx["holdings_rows_eligible"][0]["value_usd"] == pytest.approx(65000.0)


def test_two_keys_on_one_account_count_the_account_once(monkeypatch: pytest.MonkeyPatch) -> None:
    # key-b is marked a duplicate of key-a. Same day; key-b polled later, so its
    # rows are the account's: BTC 30000 + ETH 5000 = 35000. key-a's BTC 30000 and
    # SOL 12000 do not count.
    db = FakeDb(
        {
            "api_keys": [
                _key("key-a", venue_account_id="acct-D"),
                _key(
                    "key-b",
                    account_share_kind="duplicate",
                    account_shared_with_api_key_id="key-a",
                ),
            ],
            "allocator_holdings": [
                _holding("key-a", "BTC", 30000.0, "2026-10-11", "2026-10-11T04:00:05.123456+00:00"),
                _holding("key-a", "SOL", 12000.0, "2026-10-11", "2026-10-11T04:00:05.123456+00:00"),
                _holding("key-b", "BTC", 30000.0, "2026-10-11", "2026-10-11T04:02:10.5+00:00"),
                _holding("key-b", "ETH", 5000.0, "2026-10-11", "2026-10-11T04:02:10.5+00:00"),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    ctx = _ctx(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(35000.0)
    assert sorted(s["strategy_id"] for s in ctx["portfolio_strategies"]) == [
        "holding:binance:BTC:spot",
        "holding:binance:ETH:spot",
    ]


def test_a_keys_row_before_its_accounts_newest_day_is_not_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # key-a's ETH row is from 10-09, before key-a's own newest day (10-11): gone.
    # key-c shares an account with key-d; key-c's 10-10 row is older than key-d's
    # 10-11 row of the SAME account, so it is gone too. 40000 + 3000 = 43000.
    db = FakeDb(
        {
            "api_keys": [
                _key("key-a"),
                _key("key-c", venue_account_id="acct-E"),
                _key(
                    "key-d",
                    account_share_kind="duplicate",
                    account_shared_with_api_key_id="key-c",
                ),
            ],
            "allocator_holdings": [
                _holding("key-a", "BTC", 40000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
                _holding("key-a", "ETH", 7777.0, "2026-10-09", "2026-10-09T04:00:00+00:00"),
                _holding("key-c", "XRP", 9999.0, "2026-10-10", "2026-10-10T04:00:00+00:00"),
                _holding("key-d", "SOL", 3000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    ctx = _ctx(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(43000.0)
    assert sorted(s["strategy_id"] for s in ctx["portfolio_strategies"]) == [
        "holding:binance:BTC:spot",
        "holding:binance:SOL:spot",
    ]


def test_the_key_read_is_owner_filtered_and_no_audit_log_is_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeDb(
        {
            "api_keys": [_key("key-a"), _key("key-x", user_id="someone-else")],
            "allocator_holdings": [
                _holding("key-a", "BTC", 40000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    _ctx(monkeypatch, db)

    key_reads = [eqs for name, eqs in db.reads if name == "api_keys"]
    assert key_reads and all(("user_id", ALLOCATOR) in eqs for eqs in key_reads)
    assert "audit_log" not in {name for name, _ in db.reads}


def test_a_row_without_a_parseable_updated_at_raises_like_any_failed_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeDb(
        {
            "api_keys": [_key("key-a")],
            "allocator_holdings": [_holding("key-a", "BTC", 40000.0, "2026-10-11", None)],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    with pytest.raises(HoldingsUpdatedAtError):
        _ctx(monkeypatch, db)


def test_a_disconnected_key_and_its_replacement_on_one_login_count_the_account_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """170.4 review CR-01 (D-10): two keys read one account when they share a
    non-blank (exchange, venue_account_id), marker or not. This is how the pair
    arises: the owner disconnects key-a and connects key-b for the same login, so
    key-b takes the freed slot with the same venue_account_id and NO marker, and
    key-a's rows stay. The dashboard, the commit AUM and the commit RPC all call
    that one account, whose newest day is 10-11, so only key-b's rows count:
    BTC 25000 + ETH 5000 = 30000. Grouped by the marker alone, key-a's 10-10 BTC
    40000 was added on top (BTC 65000 + ETH 5000 = 70000)."""
    db = FakeDb(
        {
            "api_keys": [
                _key(
                    "key-a",
                    venue_account_id="login-7",
                    disconnected_at="2026-10-10T09:00:00+00:00",
                ),
                _key("key-b", venue_account_id="login-7"),
            ],
            "allocator_holdings": [
                _holding("key-a", "BTC", 40000.0, "2026-10-10", "2026-10-10T04:00:00+00:00"),
                _holding("key-b", "BTC", 25000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
                _holding("key-b", "ETH", 5000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    ctx = _ctx(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(30000.0)
    assert sorted(s["strategy_id"] for s in ctx["portfolio_strategies"]) == [
        "holding:binance:BTC:spot",
        "holding:binance:ETH:spot",
    ]


def test_one_venue_account_id_on_two_exchanges_is_two_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The identity is the PAIR (exchange, venue_account_id): the same id string
    on binance and on okx is two accounts, both counted: 40000 + 7000 = 47000."""
    db = FakeDb(
        {
            "api_keys": [
                _key("key-a", venue_account_id="login-7"),
                _key("key-c", exchange="okx", venue_account_id="login-7"),
            ],
            "allocator_holdings": [
                _holding("key-a", "BTC", 40000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
                _holding(
                    "key-c", "ETH", 7000.0, "2026-10-11", "2026-10-11T04:00:00+00:00", venue="okx"
                ),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    ctx = _ctx(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(47000.0)


def test_a_quiet_accounts_newest_day_is_read_although_the_history_exceeds_the_server_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """170.4 review WR-03 / SFH-1: the scorer used to read the allocator's whole
    history in one SELECT, newest first. PostgREST's max_rows (1000) cut that
    list silently, so a quiet account whose last poll is older than the newest
    ~1000 rows vanished from the AUM. key-a polls daily: 3 days x 400 symbols
    = 1200 rows, each worth 1.0, so its newest day is 400.0. key-q last polled
    on 10-01 with one BTC row of 9000. Both count: 400 + 9000 = 9400."""
    key_a_rows = [
        _holding("key-a", f"S{n:03d}", 1.0, day, f"{day}T04:00:00+00:00")
        for day in ("2026-10-09", "2026-10-10", "2026-10-11")
        for n in range(400)
    ]
    db = FakeDb(
        {
            "api_keys": [_key("key-a"), _key("key-q")],
            "allocator_holdings": [
                *key_a_rows,
                _holding("key-q", "BTC", 9000.0, "2026-10-01", "2026-10-01T04:00:00+00:00"),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    db.max_rows = 1000
    ctx = _ctx(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(9400.0)
    assert "holding:binance:BTC:spot" in [s["strategy_id"] for s in ctx["portfolio_strategies"]]


def test_a_capped_day_read_fails_instead_of_scoring_a_partial_book(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One key with 1005 rows on its newest day: the server returns 1000 and no
    error. A response that size may be a partial list, so the load raises rather
    than report an AUM for a book it could not fully read."""
    db = FakeDb(
        {
            "api_keys": [_key("key-a")],
            "allocator_holdings": [
                _holding("key-a", f"S{n:04d}", 1.0, "2026-10-11", "2026-10-11T04:00:00+00:00")
                for n in range(1005)
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    db.max_rows = 1000
    with pytest.raises(match_mod.HoldingsReadTruncated):
        _ctx(monkeypatch, db)


def test_a_capped_key_read_fails_instead_of_grouping_a_partial_key_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeDb(
        {
            "api_keys": [_key(f"key-{n:04d}") for n in range(1000)],
            "allocator_holdings": [],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    db.max_rows = 1000
    with pytest.raises(match_mod.HoldingsReadTruncated):
        _ctx(monkeypatch, db)


def test_every_holdings_read_is_owner_filtered_and_scoped_to_one_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeDb(
        {
            "api_keys": [_key("key-a")],
            "allocator_holdings": [
                _holding("key-a", "BTC", 40000.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
                {
                    **_holding("key-a", "BTC", 99.0, "2026-10-11", "2026-10-11T04:00:00+00:00"),
                    "allocator_id": "someone-else",
                },
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [],
        }
    )
    ctx = _ctx(monkeypatch, db)

    holdings_reads = [eqs for name, eqs in db.reads if name == "allocator_holdings"]
    assert holdings_reads and all(("allocator_id", ALLOCATOR) in eqs for eqs in holdings_reads)
    assert all(any(col == "api_key_id" for col, _ in eqs) for eqs in holdings_reads)
    assert ctx["portfolio_aum"] == pytest.approx(40000.0)
