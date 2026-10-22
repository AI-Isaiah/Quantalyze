"""Phase 167.2.1.1.2 ACCTREBUILD, plan 04: the pure rules of the whole-account rebuild.

WHY these tests exist. A stored ``allocator_equity_snapshots`` row is ONE aggregate per
(allocator_id, asof): the sum across every exchange account the allocator holds. A forced
rebuild that crawled one key, or crawled one exchange account twice through two keys that
read it, would write a level that is too low or too high and replace a stored curve with
it. UPNLVENUES D-04 therefore says a forced rebuild of an account with several keys
rebuilds all its keys together, in one replace, or refuses and writes nothing. These tests
pin the rules that decide that, none of which touches a venue or a database:

1. Which key each exchange account is crawled through, which exchange account counts as
   $0 (Deribit, as both allocator writers store it), and which refuses by a named token
   before any venue call (``_select_account_crawl_keys``). This supersedes TODOS
   [167.2.1.1-MULTIKEY-RECOMPUTE]'s "recorded, not recomputed".
2. The ONE window the whole account uses (``_account_rebuild_window``): D-01 / D-05 give
   an account that holds OKX 90 days and every other account 730, and one window serves
   every venue because a stored row is the sum across exchange accounts.
3. The depth the rows carry (``_account_history_depth_months``).
4. How the per-account curves add up (``_sum_account_rows``): only on a day EVERY exchange
   account has a row. A day one account lacks is unknown, so the account total for it is
   left out rather than shown short, and counted, so the later replace (D-02) can refuse
   when a stored day would be left unreproduced.
5. How the per-account telemetry merges (``_merge_account_telemetry``), because the
   handler's audit reads every key of one telemetry dict.

Expected values are typed literals. Every new name is reached through ``er.`` inside the
test body so a missing implementation fails the test instead of the collection.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from services import equity_reconstruction as er


def _key(key_id: str, exchange: str, **overrides: Any) -> dict[str, Any]:
    """An api_keys row that is WORKING by default (active, synced, connected, unstamped)."""
    row: dict[str, Any] = {
        "id": key_id,
        "exchange": exchange,
        "is_active": True,
        "sync_status": "ok",
        "disconnected_at": None,
        "venue_account_id": None,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
    }
    row.update(overrides)
    return row


def _ids(rows: list[Any]) -> list[str]:
    return [str(r["id"]) for r in rows]


def _refusal(keys: list[dict[str, Any]], job_key: str = "key-1") -> str:
    with pytest.raises(er.ForcedRebuildRefusedError) as excinfo:
        er._select_account_crawl_keys(keys, job_key)
    return str(excinfo.value.reason)


# --------------------------------------------------------------------------- selection


def _three_bybit_keys() -> list[dict[str, Any]]:
    """Key 2 reads the same exchange account as key 1 (a marked duplicate)."""
    return [
        _key("key-1", "bybit", venue_account_id="fixture-acct-1"),
        _key(
            "key-2",
            "bybit",
            account_share_kind="duplicate",
            account_shared_with_api_key_id="key-1",
        ),
        _key("key-3", "bybit", venue_account_id="fixture-acct-3"),
    ]


def test_select_crawls_one_key_per_exchange_account() -> None:
    """Two keys that read ONE exchange account must be crawled once: crawling both would
    sum the same account twice into the stored aggregate."""
    selected, skipped = er._select_account_crawl_keys(_three_bybit_keys(), "key-1")
    assert _ids(selected) == ["key-1", "key-3"]
    assert skipped == 0


def test_select_prefers_the_job_key_when_it_is_a_working_member() -> None:
    selected, skipped = er._select_account_crawl_keys(_three_bybit_keys(), "key-2")
    assert _ids(selected) == ["key-2", "key-3"]
    assert skipped == 0


def test_select_covers_a_departed_key_through_a_working_member() -> None:
    """A disconnected key marked as a duplicate of a working one is covered by that
    working one: its account is counted, not refused."""
    keys = _three_bybit_keys()
    keys[1] = _key(
        "key-2",
        "bybit",
        disconnected_at="2026-04-01T00:00:00+00:00",
        account_share_kind="duplicate",
        account_shared_with_api_key_id="key-1",
    )
    selected, skipped = er._select_account_crawl_keys(keys, "key-2")
    assert _ids(selected) == ["key-1", "key-3"]
    assert skipped == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {},
        {"is_active": False},
        {"sync_status": "error"},
    ],
    ids=["working", "inactive", "sync-error"],
)
def test_select_counts_a_deribit_exchange_account_as_zero_whatever_its_state(
    overrides: dict[str, Any],
) -> None:
    """Both allocator writers store a Deribit exchange account as $0 (the reconstruct
    refuses every Deribit key and the daily refresh skips the venue), so the rebuild
    neither crawls it nor refuses on it, whatever the key's state."""
    keys = [
        _key("key-1", "bybit", venue_account_id="fixture-acct-1"),
        _key("key-2", "deribit", venue_account_id="fixture-acct-2", **overrides),
    ]
    selected, skipped = er._select_account_crawl_keys(keys, "key-1")
    assert _ids(selected) == ["key-1"]
    assert skipped == 1


def test_select_crawls_an_okx_exchange_account() -> None:
    """UPNLVENUES D-05: OKX is rebuilt (over 90 days), never refused."""
    keys = [
        _key("key-1", "bybit", venue_account_id="fixture-acct-1"),
        _key("key-2", "okx", venue_account_id="fixture-okx-2"),
    ]
    selected, skipped = er._select_account_crawl_keys(keys, "key-1")
    assert _ids(selected) == ["key-1", "key-2"]
    assert skipped == 0


@pytest.mark.parametrize(
    "other",
    [
        _key("key-2", "sfox"),
        _key("key-2", "kraken"),
        # A marker across venues: one exchange account cannot be on two venues, so the
        # group is unreadable by any single crawl.
        _key(
            "key-2",
            "okx",
            account_share_kind="duplicate",
            account_shared_with_api_key_id="key-1",
        ),
    ],
    ids=["sfox", "kraken", "bybit-okx-group"],
)
def test_select_refuses_an_exchange_account_no_rebuild_can_read(
    other: dict[str, Any],
) -> None:
    """Summing the readable accounts and silently leaving this one out would store a total
    that claims to cover the whole allocator, so selection refuses before any venue call."""
    keys = [_key("key-1", "bybit", venue_account_id="fixture-acct-1"), other]
    assert _refusal(keys) == "account_key_venue_unsupported"


@pytest.mark.parametrize(
    "overrides",
    [
        {"is_active": False},
        {"disconnected_at": "2026-04-01T00:00:00+00:00"},
        {"sync_status": "revoked"},
        {"sync_status": "sign_in_failed"},
        {"sync_status": "error"},
    ],
    ids=["inactive", "disconnected", "revoked", "sign-in-failed", "error"],
)
def test_select_refuses_an_exchange_account_with_no_working_key(
    overrides: dict[str, Any],
) -> None:
    """An account whose only keys cannot sign in cannot be crawled; leaving it out would
    store its history as $0."""
    keys = [
        _key("key-1", "bybit", venue_account_id="fixture-acct-1"),
        _key("key-2", "bybit", venue_account_id="fixture-acct-2", **overrides),
    ]
    assert _refusal(keys) == "account_key_not_working"


def test_select_refuses_two_unstamped_working_keys_on_one_venue_as_identity_pending() -> None:
    """Two working, unstamped, unmarked keys on one stamping venue may read ONE exchange
    account, which crawling both would count twice. This is the daily refresh's own test."""
    keys = [_key("key-1", "bybit"), _key("key-2", "bybit")]
    assert _refusal(keys) == "account_identity_pending"


# --------------------------------------------------------------------------- window


def test_account_window_is_89_days_back_when_any_selected_key_is_okx() -> None:
    """D-01 / UPNLVENUES D-05, decision AR-5: 90 calendar days inclusive of today, so 89
    days back. 90 back would start older than the OKX terminus once the UTC day has begun
    and every OKX crawl would refuse. One window for the whole account."""
    end = date(2026, 4, 15)
    with_okx = [_key("key-1", "bybit"), _key("key-2", "okx")]
    assert er._account_rebuild_window(with_okx, end) == (date(2026, 1, 16), 90)
    without_okx = [_key("key-1", "bybit"), _key("key-2", "mt5")]
    assert er._account_rebuild_window(without_okx, end) == (date(2024, 4, 15), 730)


def test_account_window_reads_the_exchange_case_blind() -> None:
    end = date(2026, 4, 15)
    assert er._account_rebuild_window([_key("key-1", " OKX ")], end) == (date(2026, 1, 16), 90)


def test_account_depth_is_the_most_limiting_known_venue() -> None:
    assert er._account_history_depth_months(["bybit", "okx"]) == 3
    assert er._account_history_depth_months(["bybit", "mt5"]) == 24
    assert er._account_history_depth_months(["mt5"]) is None
    assert er._account_history_depth_months([]) is None

# --------------------------------------------------------------------------- the sum


def _row(
    asof: str,
    value: float,
    breakdown: dict[str, Any] | None,
    source: str = "exchange_primary",
    unknown: bool = False,
) -> dict[str, Any]:
    return {
        "asof": asof,
        "value_usd": value,
        "breakdown": breakdown,
        "source": source,
        "pre_terminus_balance_unknown": unknown,
    }


def test_sum_adds_each_shared_days_rows_and_merges_their_breakdowns() -> None:
    """A stored row is the account total, so each shared day is the sum of the accounts'
    values and of their breakdown entries."""
    a = [
        _row("2026-04-13", 100.10, {"BTC": 60.05, "ETH": 40.05, "STARTING_BALANCE": 10.0}),
        _row("2026-04-14", 110.20, {"BTC": 70.10, "ETH": 40.10, "STARTING_BALANCE": 10.0}),
        _row("2026-04-15", 120.30, {"BTC": 80.15, "ETH": 40.15, "STARTING_BALANCE": 10.0}),
    ]
    b = [
        _row("2026-04-13", 50.01, {"BTC": 20.01, "SOL": 30.0, "STARTING_BALANCE": 5.0}),
        _row("2026-04-14", 51.02, {"BTC": 21.02, "SOL": 30.0, "STARTING_BALANCE": 5.0}),
        _row("2026-04-15", 52.03, {"BTC": 22.03, "SOL": 30.0, "STARTING_BALANCE": 5.0}),
    ]
    rows, incomplete = er._sum_account_rows([a, b])
    assert incomplete == 0
    assert [r["asof"] for r in rows] == ["2026-04-13", "2026-04-14", "2026-04-15"]
    assert [r["value_usd"] for r in rows] == [150.11, 161.22, 172.33]
    assert rows[0]["breakdown"] == {
        "BTC": 80.06,
        "ETH": 40.05,
        "SOL": 30.0,
        "STARTING_BALANCE": 15.0,
    }
    assert rows[2]["breakdown"] == {
        "BTC": 102.18,
        "ETH": 40.15,
        "SOL": 30.0,
        "STARTING_BALANCE": 15.0,
    }
    assert {r["source"] for r in rows} == {"exchange_primary"}
    assert {r["pre_terminus_balance_unknown"] for r in rows} == {False}


def test_sum_marks_a_mixed_source_and_ors_the_terminus_flag() -> None:
    a = [_row("2026-04-14", 10.0, {"BTC": 10.0}, source="exchange_primary", unknown=False)]
    b = [_row("2026-04-14", 5.0, {"BTC": 5.0}, source="coingecko", unknown=True)]
    rows, incomplete = er._sum_account_rows([a, b])
    assert incomplete == 0
    assert len(rows) == 1
    assert rows[0]["source"] == "mixed"
    assert rows[0]["pre_terminus_balance_unknown"] is True
    assert rows[0]["value_usd"] == 15.0


def test_a_missing_breakdown_stays_out_of_the_merge() -> None:
    """An MT5-shaped row has no breakdown; it adds its value and no entries."""
    mt5 = [_row("2026-04-14", 40.0, None)]
    bybit = [_row("2026-04-14", 60.0, {"BTC": 60.0})]
    rows, _ = er._sum_account_rows([mt5, bybit])
    assert rows[0]["value_usd"] == 100.0
    assert rows[0]["breakdown"] == {"BTC": 60.0}
    none_rows, _ = er._sum_account_rows([mt5, [_row("2026-04-14", 1.0, None)]])
    assert none_rows[0]["value_usd"] == 41.0
    assert none_rows[0]["breakdown"] is None


def test_a_day_any_exchange_account_lacks_is_left_out_and_counted() -> None:
    """A day one exchange account has no row is UNKNOWN for that account. Zero-filling it
    would store a total that is too low and look real; so the day is left out and counted,
    and D-02 refuses the replace if a stored day would be left unreproduced."""
    days = [f"2026-04-{d:02d}" for d in range(1, 11)]
    a = [_row(day, 100.0, {"BTC": 100.0}) for day in days]
    # B starts two days later (04-03), has an interior gap (04-06) and ends a day early
    # (no 04-10): it holds 04-03, 04-04, 04-05, 04-07, 04-08, 04-09.
    b_days = ["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-07", "2026-04-08", "2026-04-09"]
    b = [_row(day, 10.0, {"ETH": 10.0}) for day in b_days]
    rows, incomplete = er._sum_account_rows([a, b])
    assert [r["asof"] for r in rows] == b_days
    assert incomplete == 4
    assert {r["value_usd"] for r in rows} == {110.0}
    for day in ("2026-04-01", "2026-04-02", "2026-04-06", "2026-04-10"):
        assert day not in [r["asof"] for r in rows]


def test_curves_that_share_no_day_sum_to_no_row() -> None:
    a = [_row("2026-04-01", 1.0, None), _row("2026-04-02", 1.0, None)]
    b = [_row("2026-04-03", 2.0, None)]
    rows, incomplete = er._sum_account_rows([a, b])
    assert rows == []
    assert incomplete == 3


def test_the_truncated_flag_survives_and_a_structured_entry_is_never_summed() -> None:
    """``__truncated__`` is a flag, so it survives as True. ``__pnl_missing__`` is a dict
    record, never a number: it is left out of the numeric sum and raises nothing."""
    a = [
        _row(
            "2026-04-14",
            10.0,
            {"BTC": 10.0, "__truncated__": True, "__pnl_missing__": {"count": 1, "symbols": ["X"]}},
        )
    ]
    b = [_row("2026-04-14", 5.0, {"BTC": 5.0})]
    rows, incomplete = er._sum_account_rows([a, b])
    assert incomplete == 0
    breakdown = rows[0]["breakdown"]
    assert breakdown["__truncated__"] is True
    assert breakdown["BTC"] == 15.0
    assert "__pnl_missing__" not in breakdown


def test_a_single_account_comes_back_with_the_same_days() -> None:
    a = [
        _row("2026-04-13", 100.0, {"BTC": 100.0}),
        _row("2026-04-15", 120.0, {"BTC": 120.0}),
    ]
    rows, incomplete = er._sum_account_rows([a])
    assert incomplete == 0
    assert [(r["asof"], r["value_usd"]) for r in rows] == [
        ("2026-04-13", 100.0),
        ("2026-04-15", 120.0),
    ]


# --------------------------------------------------------------------------- telemetry


def test_merge_account_telemetry_unions_lists_ors_flags_and_reads_mt5_defaults() -> None:
    """The handler's audit INDEXES the four lists and reads the anchor flags with
    ``.get``; the merged dict must satisfy both, and MT5's telemetry omits the anchor
    keys on purpose, so they are read with defaults."""
    ccxt_part: dict[str, Any] = {
        "skipped_symbols": ["B", "A"],
        "unknown_perp_symbols": ["U1"],
        "inverse_perp_symbols": [],
        "ctval_drift_warnings": [{"symbol": "S1"}],
        "pre_terminus_balance_unknown": False,
        "anchor_partial_ticker_symbols": ["P2"],
        "anchor_offset_implausible": False,
        "anchor_replay_unreliable": True,
        "anchor_offset_skipped_usd": 10.01,
        "anchor_positions_unread": False,
    }
    other_ccxt: dict[str, Any] = {
        "skipped_symbols": ["A", "C"],
        "unknown_perp_symbols": [],
        "inverse_perp_symbols": ["I1"],
        "ctval_drift_warnings": [{"symbol": "S2"}],
        "pre_terminus_balance_unknown": True,
        "anchor_partial_ticker_symbols": ["P1", "P2"],
        "anchor_offset_implausible": True,
        "anchor_replay_unreliable": False,
        "anchor_offset_skipped_usd": 5.5,
        "anchor_positions_unread": True,
    }
    merged = er._merge_account_telemetry([ccxt_part, other_ccxt, er._mt5_telemetry()])
    assert merged["skipped_symbols"] == ["A", "B", "C"]
    assert merged["unknown_perp_symbols"] == ["U1"]
    assert merged["inverse_perp_symbols"] == ["I1"]
    assert merged["ctval_drift_warnings"] == [{"symbol": "S1"}, {"symbol": "S2"}]
    assert merged["anchor_partial_ticker_symbols"] == ["P1", "P2"]
    assert merged["pre_terminus_balance_unknown"] is True
    assert merged["anchor_offset_implausible"] is True
    assert merged["anchor_replay_unreliable"] is True
    assert merged["anchor_positions_unread"] is True
    assert merged["anchor_offset_skipped_usd"] == 15.51


def test_merge_account_telemetry_of_mt5_alone_is_the_honest_default() -> None:
    merged = er._merge_account_telemetry([er._mt5_telemetry()])
    for name in ("skipped_symbols", "unknown_perp_symbols", "inverse_perp_symbols", "ctval_drift_warnings"):
        assert merged[name] == []
    assert merged["pre_terminus_balance_unknown"] is False
    assert merged["anchor_offset_implausible"] is False
    assert merged["anchor_replay_unreliable"] is False
    assert merged["anchor_positions_unread"] is False
    assert merged["anchor_offset_skipped_usd"] == 0.0
    assert merged["anchor_partial_ticker_symbols"] == []
