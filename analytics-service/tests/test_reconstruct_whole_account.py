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

Plan 07 adds the other half of D-04, "or refuses and writes nothing": the refusal pins at the
end of this module (every way a sibling exchange account or the account's key set can fail,
and a Deribit account counted as $0). They are also the tokens plan 09's handoff records.

Expected values are typed literals. Every new name is reached through ``er.`` inside the
test body so a missing implementation fails the test instead of the collection.
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock

import ccxt
import pytest

from services import equity_reconstruction as er
from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome, DispatchResult
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    _install_fake_audit,
)
from tests.test_reconstruct_force_rebuild import (
    COMPLETE,
    LEAKED_SIGNATURE,
    MARKER,
    REFUSAL_PREFIX,
    SENTINEL_ROWS,
    SENTINEL_VALUE,
    _audit_metadata,
    _bybit_exchange,
    _forced_job,
    _freeze_now_at,
    _okx_exchange,
    _seed_sentinel_rows,
    _venue_coin_equity,
)
from tests.test_reconstruct_marker_writer import (
    COMPLETION_ACTIONS,
    END_DATE,
    FAILED_ACTION,
    _crawl_exchange,
    _freeze_now,
    _marker_of,
    _MarkerFake,
    _RecordingTable,
)
from tests.test_upnl_venues import (
    BYBIT_LINEAR_POSITIONS,
    BYBIT_UNIFIED_WALLET_BALANCE,
    bybit_coin,
    bybit_wallet_balance,
    real_bybit_parse_balance,
)


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


# --------------------------------------------------------------------------- handler


def _seed_account_key(
    fake: Any,
    key_id: str,
    exchange: str,
    *,
    venue_account_id: str | None,
    marker: str | None = MARKER,
    is_active: bool = True,
    sync_status: str | None = "ok",
    disconnected_at: str | None = None,
    share_kind: str | None = None,
    shared_with: str | None = None,
) -> None:
    """One api_keys row of ALLOCATOR_ID with every column the account rules read."""
    fake.store[("api_keys", (key_id,))] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "exchange": exchange,
        "is_active": is_active,
        "sync_status": sync_status,
        "disconnected_at": disconnected_at,
        "venue_account_id": venue_account_id,
        "account_share_kind": share_kind,
        "account_shared_with_api_key_id": shared_with,
        "history_reconstructed_at": marker,
        "history_reconstruct_attempts": 1,
    }


def _install_account_preflight(
    monkeypatch: pytest.MonkeyPatch,
    fake: Any,
    exchanges: dict[str, Any],
    results: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """A per-key ``_allocator_key_preflight``: ``_install_fake_preflight`` answers the SAME
    exchange and venue for every key id, which cannot model a two-account book.

    A key id found in ``results`` answers that value (a DispatchResult, say), else a ready
    ``_ExchangeContext`` over the key's seeded row and ``exchanges[key_id]``. Returns the
    list every call appends its job dict to, so a test can see which keys were opened."""
    from services import db as db_module
    from services import job_worker as jw

    calls: list[dict[str, Any]] = []

    async def _preflight(job: dict[str, Any], caller_name: str) -> Any:
        calls.append(dict(job))
        key_id = job["api_key_id"]
        if results is not None and key_id in results:
            return results[key_id]
        return jw._ExchangeContext(
            supabase=fake,
            strategy_row=None,
            key_row=dict(fake.store[("api_keys", (key_id,))]),
            exchange=exchanges[key_id],
        )

    monkeypatch.setattr(jw, "_allocator_key_preflight", _preflight)
    monkeypatch.setattr(er, "_allocator_key_preflight", _preflight, raising=False)
    monkeypatch.setattr(db_module, "get_supabase", lambda: fake)
    monkeypatch.setattr(er, "get_supabase", lambda: fake, raising=False)
    return calls


async def _bybit_account_exchange(
    payload: dict[str, Any], positions: list[dict[str, Any]]
) -> AsyncMock:
    """The marker-writer crawl exchange as Bybit whose balance is ccxt's REAL parse of
    ``payload`` and whose open positions are ``positions``."""
    exchange = _crawl_exchange()
    exchange.id = "bybit"
    exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
    exchange.fetch_positions = AsyncMock(return_value=list(positions))
    return exchange


def _usdt_equity(payload: dict[str, Any]) -> float:
    """The payload's own USDT coin ``equity``: the oracle, never produced by the code under test."""
    (coin,) = [c for c in payload["result"]["list"][0]["coin"] if c["coin"] == "USDT"]
    return float(coin["equity"])


def _window_rpc_calls(fake: Any) -> list[dict[str, Any]]:
    return [p for (n, p) in fake.rpc_calls if n == "replace_allocator_equity_snapshots_window"]


@pytest.mark.asyncio
async def test_forced_rebuild_of_a_two_account_book_replaces_its_window_with_the_summed_anchored_curves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """UPNLVENUES D-04 end to end, the tracer of the worker half. An allocator holds two
    distinct Bybit exchange accounts (USDT coin equity 1250.5 and 540). A FORCED rebuild
    crawls both with the anchor, adds them on the shared days, and replaces ONLY its window
    in ONE window call: every in-window row is the sum of the two payloads' own coin
    ``equity`` fields (1790.5), the day older than the window keeps every column it had
    (D-01), and the seam date is recorded (D-03).

    RED on first-writer-wins: a forced persist through the DO-NOTHING path leaves the ten
    sentinel rows untouched (drill D-A). RED at the base commit: the job refused
    ``multi_key`` before any crawl."""
    fake = _MarkerFake()
    _seed_account_key(fake, API_KEY_ID_1, "bybit", venue_account_id="fixture-acct-1")
    _seed_account_key(fake, API_KEY_ID_2, "bybit", venue_account_id="fixture-acct-2")
    _seed_sentinel_rows(fake)
    older_asof = (END_DATE - timedelta(days=800)).date().isoformat()
    older_key = ("allocator_equity_snapshots", (ALLOCATOR_ID, older_asof))
    fake.store[older_key] = {
        "allocator_id": ALLOCATOR_ID,
        "asof": older_asof,
        "value_usd": 777.0,
        "breakdown": {"BTC": 777.0},
        "source": "exchange_primary",
        "history_depth_months": 24,
        "reconstructed_at": "2025-01-01T00:00:00+00:00",
    }
    older_before = copy.deepcopy(fake.store[older_key])
    audit = _install_fake_audit(monkeypatch)
    exchange_1 = await _bybit_exchange()
    payload_2 = bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "500", "40")])
    exchange_2 = await _bybit_account_exchange(
        payload_2, [{**BYBIT_LINEAR_POSITIONS[0], "unrealizedPnl": 40.0}]
    )
    _install_account_preflight(
        monkeypatch, fake, {API_KEY_ID_1: exchange_1, API_KEY_ID_2: exchange_2}
    )
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    for exchange in (exchange_1, exchange_2):
        assert exchange.fetch_my_trades.await_count > 0, "an exchange account was not crawled"
        assert exchange.fetch_positions.await_count > 0, "an exchange account was not anchored"
    assert len(_window_rpc_calls(fake)) == 1, fake.rpc_calls
    assert [n for (n, _p) in fake.rpc_calls if n == "replace_allocator_equity_snapshots"] == []

    expected = round(_venue_coin_equity() + _usdt_equity(payload_2), 2)
    assert expected == 1790.5
    in_window = [
        r for r in fake.rows_for("allocator_equity_snapshots") if r["asof"] != older_asof
    ]
    assert len(in_window) == SENTINEL_ROWS, in_window
    for row in in_window:
        assert row["value_usd"] == pytest.approx(expected, abs=0.01), (
            f"day {row['asof']} holds {row['value_usd']}, not the sum {expected} of both accounts"
        )
        assert row["value_usd"] != SENTINEL_VALUE
    assert fake.store[older_key] == older_before, "the day older than the window was rewritten"

    boundary = fake.store[("allocator_equity_derived", (ALLOCATOR_ID, "snapshot_rebuild_boundary"))]
    assert boundary["payload"] == {
        "boundary_date": (END_DATE - timedelta(days=730)).date().isoformat()
    }

    assert _marker_of(fake, API_KEY_ID_1) != MARKER, "the job's own key was not marked complete"
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete["atomic_replace"] is True
    assert complete["account_rebuild"] is True
    assert complete["account_key_count"] == 2
    assert complete["account_exchange_accounts"] == 2
    assert complete["account_zero_contribution_accounts"] == 0
    assert complete["account_days_incomplete"] == 0
    assert complete["window_days"] == 730
    assert complete["forced_rebuild"] is True


@pytest.mark.asyncio
async def test_an_okx_holding_account_is_rebuilt_over_90_days_and_keeps_older_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """UPNLVENUES D-05 / D-01 end to end (SC-2), decisions AR-4 and AR-5. An allocator holds a
    Bybit account and an OKX account. OKX keeps only 90 days of fills, and a stored row is the
    SUM across exchange accounts, so one window serves every venue: 90 calendar days inclusive
    of today, which is 89 days back. Every crawl, the Bybit one included, receives that one
    start date (2026-01-16, END_DATE minus 89 days, a typed literal here); a Bybit crawl on 730
    days would sum over a different span than the OKX one.

    Why now is frozen six hours after midnight: the terminus test is ``since < now - 90 days``
    and at exactly 00:00 a 90-day start would not bite, so a 90-day mistake would pass unseen.

    AR-4 (founder-visible, the founder may revisit): the rows carry
    ``pre_terminus_balance_unknown`` False, because the 89-day start never reaches the terminus
    and the curve is anchored to the venue's ``totalEq``; and ``history_depth_months`` 3, the
    most limiting venue. The row older than the window is untouched (D-01).

    RED when every crawl is given the 730-day start (drill D-B), and RED when the window is
    90 days back instead of 89 (drill D-C: the OKX crawl then clamps at the terminus and the
    job refuses ``anchor_skipped_okx_terminus``)."""
    okx_anchor = 800.0
    monkeypatch.setattr(
        "services.exchange.fetch_okx_total_equity_usd", AsyncMock(return_value=okx_anchor)
    )
    fake = _MarkerFake()
    _seed_account_key(fake, API_KEY_ID_1, "bybit", venue_account_id="fixture-acct-1")
    _seed_account_key(fake, API_KEY_ID_2, "okx", venue_account_id="fixture-okx-2")
    _seed_sentinel_rows(fake)
    older_asof = (END_DATE - timedelta(days=120)).date().isoformat()
    older_key = ("allocator_equity_snapshots", (ALLOCATOR_ID, older_asof))
    fake.store[older_key] = {
        "allocator_id": ALLOCATOR_ID,
        "asof": older_asof,
        "value_usd": 777.0,
        "breakdown": {"BTC": 777.0},
        "source": "exchange_primary",
        "history_depth_months": 24,
        "pre_terminus_balance_unknown": False,
        "reconstructed_at": "2025-01-01T00:00:00+00:00",
    }
    older_before = copy.deepcopy(fake.store[older_key])
    audit = _install_fake_audit(monkeypatch)
    _install_account_preflight(
        monkeypatch,
        fake,
        {API_KEY_ID_1: await _bybit_exchange(), API_KEY_ID_2: await _okx_exchange()},
    )
    _freeze_now_at(monkeypatch, END_DATE + timedelta(hours=6))

    real_crawl = er._fetch_and_price_window
    crawls: list[tuple[str, date]] = []

    async def _recording_crawl(
        exchange: Any, venue: str, supabase: Any, start_date: date, end_date: date, **kwargs: Any
    ) -> Any:
        crawls.append((venue, start_date))
        return await real_crawl(exchange, venue, supabase, start_date, end_date, **kwargs)

    monkeypatch.setattr(er, "_fetch_and_price_window", _recording_crawl)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    window_start = date(2026, 1, 16)
    assert sorted(crawls) == [("bybit", window_start), ("okx", window_start)], (
        "every crawl of an OKX-holding account must receive the one 89-day start"
    )
    assert len(_window_rpc_calls(fake)) == 1, fake.rpc_calls

    expected = round(_venue_coin_equity() + okx_anchor, 2)
    assert expected == 2050.5
    in_window = [
        r for r in fake.rows_for("allocator_equity_snapshots") if r["asof"] != older_asof
    ]
    assert len(in_window) == SENTINEL_ROWS, in_window
    for row in in_window:
        assert row["value_usd"] == pytest.approx(expected, abs=0.01), (
            f"day {row['asof']} holds {row['value_usd']}, not Bybit plus OKX {expected}"
        )
        assert row["value_usd"] != SENTINEL_VALUE
        assert row["history_depth_months"] == 3, row
        assert row["pre_terminus_balance_unknown"] is False, row  # AR-4
    assert fake.store[older_key] == older_before, "the day older than the window was rewritten"

    boundary = fake.store[("allocator_equity_derived", (ALLOCATOR_ID, "snapshot_rebuild_boundary"))]
    assert boundary["payload"] == {"boundary_date": "2026-01-16"}

    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete["window_days"] == 90
    assert complete["account_exchange_accounts"] == 2
    assert complete["okx_terminus_hit"] is False
    assert complete["account_rebuild"] is True


# ------------------------------------------------------------------ refusals: the account
#
# UPNLVENUES D-04, the "or refuses and writes nothing" half. Every pin below runs a FORCED
# job on key 1 of a two-account book and asserts through ONE helper that the job ended
# FAILED/permanent naming the reason, and that nothing it could have written changed.

_VENUE_METHODS = (
    "fetch_my_trades",
    "fetch_positions",
    "fetch_balance",
    "fetch_ohlcv",
    "fetch_deposits",
    "fetch_withdrawals",
)
_ACCOUNT_TABLES = ("allocator_equity_snapshots", "allocator_equity_derived", "api_keys")


def _book_state(fake: Any) -> dict[str, list[dict[str, Any]]]:
    """A deep copy of every row a refused rebuild must leave exactly as it found it."""
    return {table: copy.deepcopy(fake.rows_for(table)) for table in _ACCOUNT_TABLES}


def _seed_older_row(fake: Any) -> None:
    """One stored day older than any rebuild window: a refusal must keep it too."""
    older_asof = (END_DATE - timedelta(days=800)).date().isoformat()
    fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, older_asof))] = {
        "allocator_id": ALLOCATOR_ID,
        "asof": older_asof,
        "value_usd": 777.0,
        "breakdown": {"BTC": 777.0},
        "source": "exchange_primary",
        "history_depth_months": 24,
        "reconstructed_at": "2025-01-01T00:00:00+00:00",
    }


def _seed_two_account_book(fake: Any, second_exchange: str = "bybit") -> None:
    """Two exchange accounts ("fixture-acct-1" job key, "fixture-acct-2" sibling), the ten
    sentinel rows and one older row."""
    _seed_account_key(fake, API_KEY_ID_1, "bybit", venue_account_id="fixture-acct-1")
    _seed_account_key(fake, API_KEY_ID_2, second_exchange, venue_account_id="fixture-acct-2")
    _seed_sentinel_rows(fake)
    _seed_older_row(fake)


async def _sibling_bybit_exchange() -> AsyncMock:
    """The sibling account's Bybit exchange (USDT coin equity 540)."""
    return await _bybit_account_exchange(
        bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "500", "40")]),
        [{**BYBIT_LINEAR_POSITIONS[0], "unrealizedPnl": 40.0}],
    )


def _install_close_recorder(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Record every exchange ``aclose_exchange`` is handed, in order."""
    closed: list[Any] = []

    async def _aclose(exchange: Any) -> None:
        closed.append(exchange)

    monkeypatch.setattr(er, "aclose_exchange", _aclose)
    return closed


def _assert_no_venue_call(exchange: Any, label: str) -> None:
    for method in _VENUE_METHODS:
        assert getattr(exchange, method).await_count == 0, f"{label} saw {method} awaited"


def _assert_account_rebuild_refused(
    fake: Any,
    result: DispatchResult,
    audit: Any,
    reason: str,
    *,
    before: dict[str, list[dict[str, Any]]],
    exchanges_crawled: tuple[Any, ...],
    exchanges_untouched: tuple[Any, ...],
    caplog: pytest.LogCaptureFixture | None = None,
) -> None:
    """The shared assertion of every account refusal (UPNLVENUES D-04).

    FAILED/permanent naming ``reason``; every snapshot row, derived row (the seam record
    included) and api_keys row (the marker included) equal ``before``; no window call and no
    replace call; exactly one reconstruct_failed audit with the same prefix and no completion
    audit; the planted venue signature absent from the error and the audit, and, when
    ``caplog`` is given, from every captured log record. ``caplog`` is passed only by the
    failed-crawl pin: the shipped positions-read WARNING logs the scrubbed venue text and
    ``scrub_freeform_string`` leaves a bare hex word in place, so a log check there would pin
    behaviour this phase does not change.
    """
    prefix = f"{REFUSAL_PREFIX}{reason})"
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "permanent", result
    assert (result.error_message or "").startswith(prefix), result.error_message
    assert LEAKED_SIGNATURE not in (result.error_message or ""), result.error_message

    after = _book_state(fake)
    for table in _ACCOUNT_TABLES:
        assert after[table] == before[table], f"a refused account rebuild changed {table}"
    assert fake.api_key_updates() == [], fake.api_key_updates()
    written = [
        n
        for (n, _p) in fake.rpc_calls
        if n in ("replace_allocator_equity_snapshots_window", "replace_allocator_equity_snapshots")
    ]
    assert written == [], written

    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert not (set(actions) & COMPLETION_ACTIONS), actions
    (failed,) = _audit_metadata(audit, FAILED_ACTION)
    assert failed["error_kind"] == "permanent", failed
    assert failed["sanitized_message"].startswith(prefix), failed
    assert LEAKED_SIGNATURE not in failed["sanitized_message"], failed

    if caplog is not None:
        leaked = [r.getMessage() for r in caplog.records if LEAKED_SIGNATURE in r.getMessage()]
        assert leaked == [], f"the venue text reached the log: {leaked}"
    for index, exchange in enumerate(exchanges_crawled):
        assert exchange.fetch_my_trades.await_count > 0, f"crawled exchange {index} saw no trades read"
    for index, exchange in enumerate(exchanges_untouched):
        _assert_no_venue_call(exchange, f"untouched exchange {index}")


async def _run_forced_two_account_job(
    monkeypatch: pytest.MonkeyPatch,
    fake: Any,
    exchange_1: Any,
    exchange_2: Any,
    results: dict[str, Any] | None = None,
) -> tuple[DispatchResult, Any, dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Install the audit, the per-key preflight and the clock, snapshot the book, run a forced
    job on key 1. Returns the result, the audit mock, the book before, the preflight job log."""
    audit = _install_fake_audit(monkeypatch)
    calls = _install_account_preflight(
        monkeypatch, fake, {API_KEY_ID_1: exchange_1, API_KEY_ID_2: exchange_2}, results
    )
    _freeze_now(monkeypatch)
    before = _book_state(fake)
    result = await run_reconstruct_allocator_history_job(_forced_job())
    return result, audit, before, calls


@pytest.mark.asyncio
async def test_a_sibling_whose_positions_cannot_be_read_refuses_the_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling exchange account whose open positions cannot be read has an unknowable
    open-position uPnL, so its anchor is wrong; summing it would replace the stored curve
    with a total that is short by exactly that uPnL. The whole account refuses."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    exchange_2.fetch_positions = AsyncMock(
        side_effect=ccxt.NetworkError(f"fixture failure signature={LEAKED_SIGNATURE}")
    )

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    _assert_account_rebuild_refused(
        fake, result, audit, "positions_unreadable",
        before=before, exchanges_crawled=(exchange_1, exchange_2), exchanges_untouched=(),
    )


@pytest.mark.asyncio
async def test_a_failed_sibling_crawl_refuses_the_account_without_its_text(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A sibling crawl that fails for any reason other than a named refusal still ends the
    whole account refused (account_key_read_failed), and its venue text reaches neither the
    job error, the audit, nor the log: the gather converter is the one place that converts it,
    and it records the exception CLASS only. The sibling's session is closed exactly once."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    # A BARE word, not ``signature=<hex>``: ``scrub_freeform_string`` redacts the keyed form,
    # so only a bare word proves the converter keeps venue text out of the log by construction.
    exchange_2.fetch_my_trades = AsyncMock(
        side_effect=ccxt.ExchangeError(f"fixture failure {LEAKED_SIGNATURE}")
    )
    closed = _install_close_recorder(monkeypatch)

    with caplog.at_level("DEBUG"):
        result, audit, before, _calls = await _run_forced_two_account_job(
            monkeypatch, fake, exchange_1, exchange_2
        )

    _assert_account_rebuild_refused(
        fake, result, audit, "account_key_read_failed",
        before=before, exchanges_crawled=(exchange_2,), exchanges_untouched=(), caplog=caplog,
    )
    assert closed.count(exchange_2) == 1, "the sibling's session was not closed exactly once"


@pytest.mark.asyncio
async def test_a_rate_limited_sibling_is_stamped_and_refuses_the_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling the venue rate-limits is parked behind the circuit breaker (its own key, and
    only its own, is stamped) and the whole account refuses rather than skipping it."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    exchange_2.fetch_my_trades = AsyncMock(side_effect=ccxt.RateLimitExceeded("fixture: slow down"))

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    _assert_account_rebuild_refused(
        fake, result, audit, "account_key_read_failed",
        before=before, exchanges_crawled=(exchange_2,), exchanges_untouched=(),
    )
    stamped = [p for (n, p) in fake.rpc_calls if n == "stamp_api_key_429"]
    assert stamped == [{"p_api_key_id": API_KEY_ID_2}], stamped


@pytest.mark.asyncio
async def test_a_sibling_session_that_cannot_be_built_refuses_before_any_venue_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sessions are built before any crawl starts, so a sibling that cannot sign in refuses
    the account while no exchange, the job key's included, has been asked anything."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    unbuildable = DispatchResult(
        outcome=DispatchOutcome.FAILED, error_message="fixture: no session", error_kind="permanent"
    )

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2, results={API_KEY_ID_2: unbuildable}
    )

    _assert_account_rebuild_refused(
        fake, result, audit, "account_key_read_failed",
        before=before, exchanges_crawled=(), exchanges_untouched=(exchange_1, exchange_2),
    )


@pytest.mark.asyncio
async def test_an_empty_sibling_replay_refuses_the_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling whose replay yields no day would drop out of the sum as an account with no
    history, so the others' total would be stored as if it were the whole book."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    exchange_2.fetch_my_trades = AsyncMock(return_value=[])

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    _assert_account_rebuild_refused(
        fake, result, audit, "account_key_no_rows",
        before=before, exchanges_crawled=(exchange_2,), exchanges_untouched=(),
    )


@pytest.mark.asyncio
async def test_a_cooling_down_sibling_defers_the_whole_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling parked behind its circuit breaker defers THIS job unchanged (the same result
    object, no failed audit): an account is never rebuilt with one exchange account skipped."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    deferred = DispatchResult(outcome=DispatchOutcome.DEFERRED)

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2, results={API_KEY_ID_2: deferred}
    )

    assert result is deferred, result
    assert _audit_metadata(audit, FAILED_ACTION) == []
    assert _book_state(fake) == before, "a deferred account rebuild changed the stored state"
    assert fake.api_key_updates() == []
    _assert_no_venue_call(exchange_1, "the job key's exchange")
    _assert_no_venue_call(exchange_2, "the sibling's exchange")


# ------------------------------------------------------------ refusals: the key set and shape

_THIRD_KEY_ID = "00000000-0000-0000-0000-000000000003"


class _AccountKeyListTable(_RecordingTable):
    """The api_keys table, failing the Nth read of the account's key LIST.

    ``account_shared_with_api_key_id`` is selected only by ``_read_account_keys`` (the
    handler reads that list twice: before the crawl and again before the write), so a select
    naming it identifies that read and no other. The planted signature rides the exception
    text so a refusal that echoed it would show."""

    _is_key_list = False

    def select(self, *args: Any, head: bool = False, **kwargs: Any) -> "_AccountKeyListTable":
        columns = str(args[0]) if args else ""
        self._is_key_list = self._name == "api_keys" and "account_shared_with_api_key_id" in columns
        super().select(*args, head=head, **kwargs)
        return self

    def execute(self) -> Any:
        if self._is_key_list and self._pending_op == "select":
            fake = self._client
            fake.key_list_reads += 1
            if fake.fail_key_list_read == fake.key_list_reads:
                raise RuntimeError("fixture: key list unreadable " + LEAKED_SIGNATURE)
        return super().execute()


class _AccountFake(_MarkerFake):
    def __init__(self) -> None:
        super().__init__()
        self.key_list_reads = 0
        # 1-based index of the key-list read that fails; 0 = none fails.
        self.fail_key_list_read = 0

    def table(self, name: str) -> Any:
        return _AccountKeyListTable(name, self.store, self)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failing_read", "crawled"),
    [(1, False), (2, True)],
    ids=["before-the-crawl", "at-persist-time"],
)
async def test_an_unreadable_key_list_refuses_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, failing_read: int, crawled: bool
) -> None:
    """The rebuild cannot say which exchange accounts the book holds without its key list, so
    an unreadable list refuses account_state_unreadable. Read before the crawl, it refuses
    before any venue call; read again at persist time (to see whether the set moved), it
    refuses with the crawl already done and still writes nothing."""
    fake = _AccountFake()
    fake.fail_key_list_read = failing_read
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    assert fake.key_list_reads == failing_read, "the key list was not read the expected number of times"
    _assert_account_rebuild_refused(
        fake, result, audit, "account_state_unreadable",
        before=before,
        exchanges_crawled=(exchange_1, exchange_2) if crawled else (),
        exchanges_untouched=() if crawled else (exchange_1, exchange_2),
    )


def _mutate_on_first_trades_call(exchange: Any, mutate: Any) -> None:
    """Run ``mutate`` as the exchange's first ``fetch_my_trades`` call begins (mid-crawl), then
    answer exactly what the exchange would have answered."""
    answers = exchange.fetch_my_trades.side_effect
    first = True

    async def _side_effect(*_args: Any, **_kwargs: Any) -> Any:
        nonlocal first
        if first:
            first = False
            mutate()
        return next(answers)

    exchange.fetch_my_trades = AsyncMock(side_effect=_side_effect)


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", ["added", "removed"])
async def test_a_key_set_that_moved_during_the_crawl_refuses_the_account(
    monkeypatch: pytest.MonkeyPatch, moved: str
) -> None:
    """A key added or removed while the crawl runs changes which exchange accounts the window
    may claim to cover, so the persist-time re-read refuses account_keys_changed and writes
    nothing. The moved row itself stays moved: the job never touches api_keys."""
    fake = _AccountFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()

    def _add_third_key() -> None:
        _seed_account_key(fake, _THIRD_KEY_ID, "bybit", venue_account_id="fixture-acct-3")

    def _remove_second_key() -> None:
        del fake.store[("api_keys", (API_KEY_ID_2,))]

    _mutate_on_first_trades_call(
        exchange_1, _add_third_key if moved == "added" else _remove_second_key
    )

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    # ``before`` was taken before the job; the one row the test itself moved is the only
    # difference the api_keys equality may see, and it is asserted separately.
    if moved == "added":
        assert ("api_keys", (_THIRD_KEY_ID,)) in fake.store
        before["api_keys"].append(copy.deepcopy(fake.store[("api_keys", (_THIRD_KEY_ID,))]))
    else:
        assert ("api_keys", (API_KEY_ID_2,)) not in fake.store
        before["api_keys"] = [r for r in before["api_keys"] if r["id"] != API_KEY_ID_2]
    _assert_account_rebuild_refused(
        fake, result, audit, "account_keys_changed",
        before=before, exchanges_crawled=(exchange_1, exchange_2), exchanges_untouched=(),
    )


@pytest.mark.asyncio
async def test_curves_with_no_shared_day_refuse_the_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two exchange accounts whose curves share no day sum to nothing; storing either curve
    alone would claim a total that covers one account. The crawl is stubbed to hand each key
    typed rows on disjoint days, so only the sum can refuse."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()

    def _days(first_back: int, last_back: int) -> list[dict[str, Any]]:
        return [
            _row(
                (END_DATE - timedelta(days=back)).date().isoformat(),
                100.0 + back,
                {"BTC": 100.0 + back},
            )
            for back in range(first_back, last_back + 1)
        ]

    curves = {API_KEY_ID_1: _days(0, 4), API_KEY_ID_2: _days(5, 9)}

    async def _stub_crawl(
        _supabase: Any, key_row: Any, _exchange: Any, *_args: Any
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return curves[str(key_row["id"])], er._mt5_telemetry()

    monkeypatch.setattr(er, "_crawl_account_key", _stub_crawl)

    result, audit, before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    _assert_account_rebuild_refused(
        fake, result, audit, "account_sum_empty",
        before=before, exchanges_crawled=(), exchanges_untouched=(exchange_1, exchange_2),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("second_exchange", "second_sync_status", "reason"),
    [
        ("sfox", "ok", "account_key_venue_unsupported"),
        ("bybit", "revoked", "account_key_not_working"),
    ],
    ids=["venue-the-rebuild-cannot-read", "only-key-revoked"],
)
async def test_an_exchange_account_the_rebuild_cannot_read_refuses_before_any_venue_call(
    monkeypatch: pytest.MonkeyPatch, second_exchange: str, second_sync_status: str, reason: str
) -> None:
    """Summing the readable accounts and leaving this one out would store a total that claims
    to cover the whole book, so selection refuses before ANY venue call and before the
    sibling's session is even opened."""
    fake = _MarkerFake()
    _seed_two_account_book(fake, second_exchange)
    fake.store[("api_keys", (API_KEY_ID_2,))]["sync_status"] = second_sync_status
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()

    result, audit, before, calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    _assert_account_rebuild_refused(
        fake, result, audit, reason,
        before=before, exchanges_crawled=(), exchanges_untouched=(exchange_1, exchange_2),
    )
    assert [c["api_key_id"] for c in calls] == [API_KEY_ID_1], "a sibling session was opened"


@pytest.mark.asyncio
async def test_a_deribit_exchange_account_is_counted_as_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both allocator writers store a Deribit exchange account as $0 (the reconstruct refuses
    every Deribit key and the daily refresh skips the venue), so the rebuild neither crawls it
    nor refuses on it: the job ends DONE with every in-window row equal to the Bybit account's
    own coin equity (computed here from its payload), and the audit counts the Deribit account
    as a zero contribution."""
    fake = _MarkerFake()
    _seed_two_account_book(fake, "deribit")
    older_asof = (END_DATE - timedelta(days=800)).date().isoformat()
    audit = _install_fake_audit(monkeypatch)
    exchange_1 = await _bybit_exchange()
    calls = _install_account_preflight(monkeypatch, fake, {API_KEY_ID_1: exchange_1})
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert [c["api_key_id"] for c in calls] == [API_KEY_ID_1], "a Deribit session was built"
    expected = round(_usdt_equity(BYBIT_UNIFIED_WALLET_BALANCE), 2)
    assert expected == 1250.5
    in_window = [r for r in fake.rows_for("allocator_equity_snapshots") if r["asof"] != older_asof]
    assert len(in_window) == SENTINEL_ROWS, in_window
    for row in in_window:
        assert row["value_usd"] == pytest.approx(expected, abs=0.01), (
            f"day {row['asof']} holds {row['value_usd']}, not the Bybit account alone {expected}"
        )
        assert row["value_usd"] != SENTINEL_VALUE
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete["account_key_count"] == 2
    assert complete["account_exchange_accounts"] == 1
    assert complete["account_zero_contribution_accounts"] == 1


# ------------------------------------------------------------ mixed venues and the marker rule
#
# UPNLVENUES D-04 across venues, and PD-O (the marker rule). A rebuilt account's book is ONE
# aggregate per day, so a later UNFORCED reconstruct of a sibling that still looks owed would
# first-writer-wins-fill any day the rebuilt book lacks with that key's value alone. Every
# ACTIVE key of the rebuilt account is therefore stamped with the job's own; an inactive key
# (no reconstruct can run for it) and a Deribit key (its history is counted as $0, not
# rebuilt, so a marker would claim a rebuild that never happened) are left as they were.

MT5_LEVEL = 300.0


def _install_recording_mt5_fetch(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Replace ``_mt5_fetch_window`` with a recording fake that answers ten typed deal-ledger
    days (END_DATE minus 9..0) at MT5_LEVEL, no breakdown, and MT5's own telemetry."""
    calls: list[dict[str, Any]] = []

    async def _fake(exchange: Any, **kwargs: Any) -> Any:
        calls.append({"exchange": exchange, **kwargs})
        rows = [
            _row((END_DATE - timedelta(days=back)).date().isoformat(), MT5_LEVEL, None)
            for back in range(9, -1, -1)
        ]
        return rows, False, er._mt5_telemetry()

    monkeypatch.setattr(er, "_mt5_fetch_window", _fake)
    return calls


@pytest.mark.asyncio
async def test_a_mixed_mt5_and_bybit_account_is_rebuilt_with_each_venues_reader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """UPNLVENUES D-04 across venues, PD-O, SC-3. An allocator holds an MT5 key (key 1, the
    job's, marked) and a Bybit key (key 2, marker NULL). A FORCED rebuild reads the MT5
    exchange account from its deal ledger (no anchor step, no ccxt trade read) and the Bybit
    one through the anchored crawl; every stored row is the per-day sum (300.0 plus the Bybit
    payload's own USDT coin equity, computed here) and carries depth 24, the Bybit-limited
    depth (MT5 has none). Both keys end marked: key 2 would otherwise stay owed and a later
    unforced reconstruct of it would fill the rebuilt book with its own value alone.

    RED at PLAN_BASE: only the job key was stamped, so key 2's marker stayed NULL (drill J)."""
    fake = _MarkerFake()
    _seed_account_key(fake, API_KEY_ID_1, "mt5", venue_account_id="fixture-mt5-1")
    _seed_account_key(fake, API_KEY_ID_2, "bybit", venue_account_id="fixture-acct-2", marker=None)
    _seed_sentinel_rows(fake)
    audit = _install_fake_audit(monkeypatch)
    mt5_exchange = _crawl_exchange()
    mt5_exchange.id = "mt5"
    payload_2 = bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "500", "40")])
    bybit_exchange = await _bybit_account_exchange(
        payload_2, [{**BYBIT_LINEAR_POSITIONS[0], "unrealizedPnl": 40.0}]
    )
    _install_account_preflight(
        monkeypatch, fake, {API_KEY_ID_1: mt5_exchange, API_KEY_ID_2: bybit_exchange}
    )
    mt5_calls = _install_recording_mt5_fetch(monkeypatch)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert [c["api_key_id"] for c in mt5_calls] == [API_KEY_ID_1], mt5_calls
    assert mt5_calls[0]["exchange"] is mt5_exchange
    assert bybit_exchange.fetch_positions.await_count > 0, "the Bybit account was not anchored"
    assert bybit_exchange.fetch_my_trades.await_count > 0, "the Bybit account was not crawled"
    _assert_no_venue_call(mt5_exchange, "the MT5 key's exchange")

    expected = round(MT5_LEVEL + _usdt_equity(payload_2), 2)
    assert expected == 840.0
    rows = fake.rows_for("allocator_equity_snapshots")
    assert len(rows) == SENTINEL_ROWS, rows
    for row in rows:
        assert row["value_usd"] == pytest.approx(expected, abs=0.01), (
            f"day {row['asof']} holds {row['value_usd']}, not MT5 plus Bybit {expected}"
        )
        assert row["history_depth_months"] == 24, row

    assert _marker_of(fake, API_KEY_ID_1) != MARKER, "the job's own key was not re-stamped"
    assert _marker_of(fake, API_KEY_ID_2) is not None, (
        "a sibling of the rebuilt account was left owed: a later unforced reconstruct of it "
        "would fill the rebuilt book with that key's value alone"
    )
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete["account_rebuild"] is True
    assert complete["account_key_count"] == 2
    assert complete["window_days"] == 730


def _seed_keys_outside_the_rebuild(fake: Any, case: str) -> None:
    """Key 1 (the job's, Bybit, marked) and key 3 (Bybit, NULL marker) are rebuilt; key 2
    is the key the rebuild must leave as it found it."""
    _seed_account_key(fake, API_KEY_ID_1, "bybit", venue_account_id="fixture-acct-1")
    _seed_account_key(fake, _THIRD_KEY_ID, "bybit", venue_account_id="fixture-acct-3", marker=None)
    if case == "inactive_duplicate":
        _seed_account_key(
            fake, API_KEY_ID_2, "bybit", venue_account_id=None, marker=None, is_active=False,
            share_kind="duplicate", shared_with=API_KEY_ID_1,
        )
    else:
        _seed_account_key(
            fake, API_KEY_ID_2, "deribit", venue_account_id="fixture-acct-2", marker=None
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["inactive_duplicate", "deribit"])
async def test_keys_outside_the_rebuild_keep_their_marker(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """PD-O: an inactive key (no reconstruct can run for it, the preflight fails it
    permanently) and a Deribit key (its history is counted as $0, never rebuilt, so a marker
    would claim a rebuild that never happened) keep a NULL marker, while the active sibling
    of the rebuilt account (key 3) is stamped."""
    fake = _MarkerFake()
    _seed_keys_outside_the_rebuild(fake, case)
    _seed_sentinel_rows(fake)
    _install_fake_audit(monkeypatch)
    _install_account_preflight(
        monkeypatch,
        fake,
        {API_KEY_ID_1: await _bybit_exchange(), _THIRD_KEY_ID: await _sibling_bybit_exchange()},
    )
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert _marker_of(fake, API_KEY_ID_1) != MARKER, "the job's own key was not re-stamped"
    assert _marker_of(fake, _THIRD_KEY_ID) is not None, "an active sibling was left owed"
    assert _marker_of(fake, API_KEY_ID_2) is None, f"a {case} key was stamped"


@pytest.mark.asyncio
async def test_a_failed_marker_stamp_on_a_rebuilt_account_fails_the_job_transient(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A marker that cannot be written must not end the job DONE: the account's keys would be
    left owed under a success audit. FAILED/transient is safe to retry because the forced
    rebuild is idempotent under the window replace, so the replaced rows stay."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    fake.fail_update_tables.add("api_keys")
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()

    result, audit, _before, _calls = await _run_forced_two_account_job(
        monkeypatch, fake, exchange_1, exchange_2
    )

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result
    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert not (set(actions) & COMPLETION_ACTIONS), actions
    older_asof = (END_DATE - timedelta(days=800)).date().isoformat()
    in_window = [r for r in fake.rows_for("allocator_equity_snapshots") if r["asof"] != older_asof]
    assert len(in_window) == SENTINEL_ROWS, in_window
    assert all(r["value_usd"] != SENTINEL_VALUE for r in in_window), (
        "the replaced rows were rolled back; the retry relies on them being idempotent, not gone"
    )
