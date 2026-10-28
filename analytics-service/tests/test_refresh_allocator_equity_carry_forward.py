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
    _FakeTable,
    _install_fake_audit,
    _install_fake_preflight,
)

TODAY = date(2026, 9, 20)
# Phase 167.2.1.1.1.1 D-01: the legacy refresh labels its one row by the UTC day
# that closed (``mark_day_for``), while holdings are still READ at the run day.
CLOSED_DAY = TODAY - timedelta(days=1)
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
    quantity: float = 1.0,
    mark_price: float | None = None,
) -> None:
    """A stored holdings row. ``mark_price`` None means ``value_usd`` (the original
    shape); a price-gap row is ``value_usd=0.0, mark_price=0.0`` (MARKSOURCE plan 04)."""
    fake.store[("allocator_holdings", (ALLOCATOR_ID, venue, symbol, asof.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": key_id,
        "venue": venue,
        "symbol": symbol,
        "asof": asof.isoformat(),
        "quantity": quantity,
        "mark_price": value_usd if mark_price is None else mark_price,
        "value_usd": value_usd,
        "unrealized_pnl_usd": unrealized_pnl_usd,
        "holding_type": holding_type,
        "updated_at": "2026-09-20T04:00:00+00:00",
    }


async def _run_refresh(
    monkeypatch: pytest.MonkeyPatch,
    fake: FakeSupabaseClient,
    job_key: str,
    *,
    expect_failed: bool = False,
    run_at: tuple[int, int] = (5, 0),
) -> Any:
    """Run the job as ``job_key``'s refresh on TODAY at ``run_at`` (hour, minute)
    UTC, 05:00Z by default. Returns the audit mock."""
    audit = _install_fake_audit(monkeypatch)
    exchange = AsyncMock()
    exchange.id = "okx"
    exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake, exchange)

    from services import equity_reconstruction as er

    now = datetime(TODAY.year, TODAY.month, TODAY.day, *run_at, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:  # type: ignore[override]
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_refresh_allocator_equity_daily_job(
        {"id": f"refresh-{job_key}", "kind": "refresh_allocator_equity_daily", "api_key_id": job_key}
    )
    from services.job_worker import DispatchOutcome

    expected = DispatchOutcome.FAILED if expect_failed else DispatchOutcome.DONE
    assert result.outcome == expected, result
    return audit


def _snapshot_row(fake: FakeSupabaseClient) -> dict[str, Any]:
    """The one legacy row the refresh wrote, labelled the day that closed (D-01)."""
    rows = [
        r for r in fake.rows_for("allocator_equity_snapshots")
        if r["asof"] == CLOSED_DAY.isoformat()
    ]
    assert len(rows) == 1, f"expected exactly one snapshot row for the closed day, got {len(rows)}"
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
# Phase 167.2.1.1.1.1 plan 05 (D-01): the row is labelled the day that closed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_labels_the_closed_day(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-01 (founder 2026-10-27, "Keep both, align them"): legacy rows are
    labelled by the UTC day that closed. A refresh run at 00:55Z on TODAY reads
    the holdings polled on TODAY and writes exactly ONE row, labelled TODAY - 1
    (``mark_day_for``, the label the stored NAV mark of that read carries), so
    the legacy snapshot and the mark describe the same day. A row labelled the
    run day would sit one day ahead of the mark it is compared with."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 1000.0)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_1, run_at=(0, 55))

    rows = fake.rows_for("allocator_equity_snapshots")
    assert [r["asof"] for r in rows] == [CLOSED_DAY.isoformat()], (
        f"expected exactly one row labelled the closed day, got {[r['asof'] for r in rows]}"
    )
    assert rows[0]["value_usd"] == pytest.approx(1000.0)
    assert not [r for r in rows if r["asof"] == TODAY.isoformat()]


@pytest.mark.asyncio
async def test_refresh_reads_the_run_day_holdings_and_carry_age(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 relabels the WRITE only. The READ stays on the run day: an account
    whose latest holdings are dated TODAY - 3 is carried, and its carry age is
    measured from the run day (3), not from the closed-day label (which would
    read 2). ``allocator_holdings.asof`` is the poll day and is not relabelled."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY - timedelta(days=3), 700.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1, run_at=(0, 55))

    rows = fake.rows_for("allocator_equity_snapshots")
    assert [r["asof"] for r in rows] == [CLOSED_DAY.isoformat()]
    assert rows[0]["value_usd"] == pytest.approx(700.0)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["carried_keys"] == 1
    assert metadata["max_carry_age_days"] == 3


@pytest.mark.asyncio
async def test_refresh_at_the_old_clock_labels_the_closed_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 cut-over, outcome 2 (RESEARCH "Cut-over timing"): the label code is
    live while the crons still run on the OLD clock (holdings poll 04:00Z,
    refresh 05:00Z). The 05:00Z run on TODAY ALSO labels the closed day, reading
    the holdings polled on TODAY, so the curve lags the book by one day and
    loses none. Pinned by name because the operator's runbook (plan 07) relies
    on it: deploying the label before moving the clock is safe."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 1000.0)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_1, run_at=(5, 0))

    rows = fake.rows_for("allocator_equity_snapshots")
    assert [r["asof"] for r in rows] == [CLOSED_DAY.isoformat()], (
        f"the old-clock run must label the closed day, got {[r['asof'] for r in rows]}"
    )
    assert rows[0]["value_usd"] == pytest.approx(1000.0)
    assert not [r for r in rows if r["asof"] == TODAY.isoformat()]


@pytest.mark.asyncio
async def test_refresh_keeps_a_row_already_stored_for_its_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 cut-over, outcome 1 (RESEARCH "Cut-over timing"): a snapshot already
    stored for the label (the row a first-connect reconstruct, a forced rebuild
    or an old-regime run left) is KEPT, never replaced: the row is
    first-writer-wins on (allocator_id, asof). Seeded at 999.0; the 00:55Z run
    over holdings worth 1000.0 leaves exactly one CLOSED_DAY row, still 999.0,
    and the job ends DONE with its refresh_complete audit. Every label carries
    one row, whichever regime wrote it first. Plan 07's runbook relies on this
    for the seam day, so it is pinned by name."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 1000.0)
    _seed_snapshot(fake, CLOSED_DAY, 999.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1, run_at=(0, 55))

    rows = fake.rows_for("allocator_equity_snapshots")
    assert [r["asof"] for r in rows] == [CLOSED_DAY.isoformat()], (
        f"the label must carry exactly one row, got {[r['asof'] for r in rows]}"
    )
    assert rows[0]["value_usd"] == pytest.approx(999.0), (
        f"a row already stored for its label was replaced: {rows[0]['value_usd']}"
    )
    metadata = _refresh_complete_metadata(audit)
    assert metadata["days_written"] == 0


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

    row = _snapshot_row(fake)
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

# One exchange account behind two keys. Before 170.4 D-10 (migration
# 20261011120000) the holdings table was last-writer on (allocator_id, venue,
# symbol, asof) with no api_key_id in the key, so the account's rows on a day
# carried whichever key polled it LAST; a pair's two keys never wrote different
# symbols for one account. Since the per-key index both keys can hold rows, and
# the refresh counts the account once through `one_key_per_account_day`. The fixtures below are that
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

    row = _snapshot_row(fake)
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
    """Both keys polled today and each won the race for one symbol. Before Phase
    170.4 plan 11 the account's day was the union of the group's rows (1000).
    D-10 supersedes that: the account is counted once, through ONE key (here a
    tie on ``updated_at``, so the smaller id, key 1), and key 2's BTC row stops
    counting (the disclosed loss of decision (b) / case (a))."""
    fake = FakeSupabaseClient()
    _seed_pair(fake, "duplicate")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 600.0)
    _seed_holding(fake, API_KEY_ID_2, "okx", "BTC", TODAY, 400.0)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(600.0)
    assert row["breakdown"] == {"USDT": 600.0}


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

    row = _snapshot_row(fake)
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

    row = _snapshot_row(fake)
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

    row = _snapshot_row(fake)
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

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
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

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD + 700.0)
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

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD + 400.0)
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

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
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
        rows.append(_snapshot_row(fake))

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

    row = _snapshot_row(fake)
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
#
# Round 3 (SFH-R3-01): that event alone is NOT proof. Zero rows means "nothing
# this poll reads", and a funded account can read that way (the documented
# Bybit UTA parse-empty class, Deribit's skipped spot read). The proving key's
# own live equity read, the anchor its key-mode derive persists in
# key_inputs:<api_key_id>, must ALSO show no material capital
# (anchor_null_reason 'dust' or 'nonpositive'), and it must have been taken at
# or after the clean, empty poll. A missing, failed or older read is no proof,
# and a material read beside the empty poll is a contradiction, logged at
# WARNING. Deribit never supplies the proof. _seed_empty_proof seeds both.
# ---------------------------------------------------------------------------


def _seed_poll_outcome(
    fake: FakeSupabaseClient,
    key_id: str,
    at: datetime,
    *,
    final_status: str | None = "complete",
    row_count: int = 0,
    action: str = "allocator.holdings.sync_completed",
    asof: date | None = None,
    without_asof: bool = False,
    user_id: str = ALLOCATOR_ID,
) -> None:
    """The audit row a holdings poll of ``key_id`` wrote at ``at``.
    ``final_status=None`` is the shape a poll wrote before round 2. ``asof``
    (the day the poll stamped its rows, recorded since round 3) defaults to
    ``at``'s UTC day, the production shape; ``without_asof=True`` is the shape
    a poll wrote before round 3."""
    metadata: dict[str, Any] = {
        "row_count": row_count,
        "holding_type_counts": {"spot": row_count, "derivative": 0},
    }
    if final_status is not None:
        metadata["final_status"] = final_status
    if not without_asof:
        metadata["asof"] = (asof or at.astimezone(timezone.utc).date()).isoformat()
    event_id = f"audit-{key_id}-{at.isoformat()}-{action}"
    fake.store[("audit_log", (event_id,))] = {
        "id": event_id,
        "user_id": user_id,
        "action": action,
        "entity_type": "api_key",
        "entity_id": key_id,
        "metadata": metadata,
        "created_at": at.isoformat(),
    }


def _at(day: date, hour: int = 4) -> datetime:
    return datetime(day.year, day.month, day.day, hour, 3, tzinfo=timezone.utc)


def _seed_key_inputs(
    fake: FakeSupabaseClient,
    key_id: str,
    anchor_asof: datetime,
    *,
    anchor_usd: float | None = None,
    anchor_null_reason: str | None = "nonpositive",
) -> None:
    """The key_inputs:<key_id> row the key-mode derive persists: the key's own
    live equity read. The defaults are a read that found no capital."""
    kind = f"key_inputs:{key_id}"
    fake.store[("allocator_equity_derived", (ALLOCATOR_ID, kind))] = {
        "allocator_id": ALLOCATOR_ID,
        "kind": kind,
        "payload": {
            "flows": [],
            "anchor_usd": anchor_usd,
            "anchor_null_reason": anchor_null_reason,
            "anchor_asof": anchor_asof.isoformat(),
            "venue": "bybit",
        },
        "computed_at": anchor_asof.isoformat(),
    }


def _seed_empty_proof(fake: FakeSupabaseClient, key_id: str, at: datetime) -> None:
    """A clean, empty poll at ``at`` AND the key's live equity read, taken
    half an hour later, finding no capital: the two halves of a proof."""
    _seed_poll_outcome(fake, key_id, at)
    _seed_key_inputs(fake, key_id, at + timedelta(minutes=30))


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
    _seed_empty_proof(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=claimed_days_ago)))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD), (
        f"an emptied account was carried at its last balance: {row['value_usd']}"
    )
    assert "BTC" not in row["breakdown"]
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 1
    assert metadata["carried_keys"] == 0


@pytest.mark.asyncio
async def test_poll_outcome_of_another_user_is_not_proof_of_emptiness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RECONMARKER RLS finding 2 (D-18). ``_polled_empty_since`` reads the
    audit_log with the service-role client, which bypasses RLS, so the owner
    check has to be in the query: the TS reader and the migration both filter
    ``user_id`` and this one filtered only ``entity_id``. A clean, empty
    ``sync_completed`` row whose ``user_id`` is NOT the key owner must be
    ignored, so the account is carried and not zeroed (first-writer-wins, so a
    wrong $0 here is permanent)."""
    fake = FakeSupabaseClient()
    _seed_emptied_candidate(fake)
    _seed_poll_outcome(
        fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)),
        user_id="00000000-0000-0000-0000-00000000dead",
    )
    _seed_key_inputs(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)) + timedelta(minutes=30))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["value_usd"] != pytest.approx(HOLDER_USD), (
        "a poll outcome owned by another user zeroed this allocator's account"
    )
    assert "BTC" in _snapshot_row(fake)["breakdown"]
    assert _refresh_complete_metadata(audit)["emptied_accounts"] == 0


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
    _seed_empty_proof(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD), current_status
    assert _refresh_complete_metadata(audit)["emptied_accounts"] == 1


@pytest.mark.asyncio
async def test_a_poll_landing_between_the_two_reads_is_counted_not_zeroed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C2 silent-failure round 2, SFH-R2-01. The refresh reads the account's
    latest asof, then asks for a proof of emptiness, in two round trips. A poll
    that persists today's rows between them is invisible to the first read,
    and an OLDER clean, empty poll outcome makes the second read say "empty"
    (this poll's own audit event lands after its rows, so it cannot veto yet).
    Round 1 zeroed the account and persisted that first-writer-wins (measured:
    1000 where 1510 is right). After a positive proof the refresh re-reads the
    latest asof, and counts the rows it finds there."""
    from services import equity_reconstruction as er

    fake = FakeSupabaseClient()
    _seed_emptied_candidate(fake)
    _seed_empty_proof(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)))
    real_proof = er._polled_empty_since

    async def _poll_lands_mid_refresh(*args: Any, **kwargs: Any) -> bool:
        _seed_holding(fake, API_KEY_ID_2, "bybit", "BTC", TODAY, 510.0)
        return await real_proof(*args, **kwargs)

    monkeypatch.setattr(er, "_polled_empty_since", _poll_lands_mid_refresh)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD + 510.0), (
        f"rows persisted between the two reads were zeroed: {row['value_usd']}"
    )
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 0
    assert metadata["carried_keys"] == 0


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
        pytest.param("clean_event_without_asof", id="clean-empty-event-without-asof"),
        pytest.param("non_ccxt", id="mt5-writes-its-own-empty-marker"),
        pytest.param("no_live_read", id="clean-empty-poll-without-a-live-equity-read"),
        pytest.param("live_read_failed", id="live-equity-read-failed"),
        pytest.param("live_read_flow_drop", id="live-equity-read-material-but-flows-cut"),
        pytest.param("live_read_material", id="live-equity-read-finds-capital"),
        pytest.param("live_read_older", id="live-equity-read-predates-the-empty-poll"),
        pytest.param("deribit", id="deribit-never-proves-emptiness"),
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
    venues return no rows with a warning).

    Round 3 (SFH-R3-01): a clean, empty poll is not proof on its own. The
    key's live equity read must also find no capital, at or after that poll:
    a missing read, a failed read (balance_error), a read that found capital
    (a present anchor, or flow_drop, which is stamped only above the dust
    floor), and a read older than the poll all keep the carry. A Deribit poll
    never proves emptiness: it skips spot before any network call, so zero
    rows means no open positions, not no collateral. A clean, empty event
    without asof (written before round 3, R3-WR-01) never proves either:
    nothing binds its emptiness to a day after the latest rows."""
    fake = FakeSupabaseClient()
    key: dict[str, Any] = {}
    if case == "non_ccxt":
        key = {"exchange": "mt5"}
    elif case == "deribit":
        key = {"exchange": "deribit"}
    _seed_emptied_candidate(fake, **key)
    today_poll = _at(TODAY)
    fresh_read = today_poll + timedelta(minutes=30)
    if case == "no_live_read":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)
    elif case == "live_read_failed":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)
        _seed_key_inputs(fake, API_KEY_ID_2, fresh_read, anchor_null_reason="balance_error")
    elif case == "live_read_flow_drop":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)
        _seed_key_inputs(fake, API_KEY_ID_2, fresh_read, anchor_null_reason="flow_drop")
    elif case == "live_read_material":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)
        _seed_key_inputs(
            fake, API_KEY_ID_2, fresh_read, anchor_usd=500.0 * 400, anchor_null_reason=None
        )
    elif case == "live_read_older":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)
        _seed_key_inputs(fake, API_KEY_ID_2, today_poll - timedelta(hours=22))
    elif case == "deribit":
        _seed_empty_proof(fake, API_KEY_ID_2, today_poll)
    elif case == "poll_same_day_as_rows":
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
        _seed_poll_outcome(
            fake, API_KEY_ID_2, today_poll, final_status=None, without_asof=True
        )
    elif case == "clean_event_without_asof":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll, without_asof=True)
    elif case != "no_poll_outcome":
        _seed_poll_outcome(fake, API_KEY_ID_2, today_poll)
    if not case.startswith(("live_read_", "no_live_read", "deribit")):
        # The poll-side arms get a live read that DOES find no capital, so
        # each arm fails on its own rule, not on a missing read.
        _seed_key_inputs(fake, API_KEY_ID_2, fresh_read)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD + 500.0)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 0
    assert metadata["carried_keys"] == 1


def _seed_snapshot(fake: FakeSupabaseClient, asof: date, value_usd: float) -> None:
    fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "asof": asof.isoformat(),
        "value_usd": value_usd,
        "breakdown": {"BTC": value_usd},
        "source": "exchange_primary",
        "pre_terminus_balance_unknown": False,
    }


@pytest.mark.asyncio
async def test_a_book_whose_every_account_is_proven_empty_writes_a_zero_row(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """C2 silent-failure round 2, SFH-R2-02. The book's only account is proven
    empty. Round 1 took the "no holdings today" branch and wrote NOTHING, so
    the latest persisted snapshot stayed at yesterday's positive balance for
    every reader of the legacy store (match.py, the compare adapter, the GDPR
    export), while the same audit said emptied_accounts=1. With proof in hand
    the day is written as an explicit $0, with its own audit reason, and the
    job logs it at WARNING (counts only).

    Round 3 (SFH-R3-01): a WARNING reaches Sentry only as a breadcrumb
    (sentry_init.py keeps the default LoggingIntegration, event level ERROR),
    so the round-2 derive refusal pages while this $0 write did not. The write
    is now captured once, at level warning, with one static message and no
    key id, allocator id or USD figure."""
    import logging
    from unittest.mock import patch

    caplog.set_level(logging.INFO, logger="quantalyze.analytics.equity_reconstruction")
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "BTC", TODAY - timedelta(days=3), 500.0)
    _seed_snapshot(fake, CLOSED_DAY - timedelta(days=1), 500.0)
    _seed_empty_proof(fake, API_KEY_ID_1, _at(TODAY))

    with patch("services.equity_reconstruction.sentry_sdk") as sentry:
        audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == 0.0
    assert row["breakdown"] == {}
    metadata = _refresh_complete_metadata(audit)
    assert metadata["reason"] == "book_emptied"
    assert metadata["emptied_accounts"] == 1
    assert metadata["days_written"] == 1
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert any("proven empty" in r.getMessage() for r in warnings), caplog.text
    assert "500" not in caplog.text

    assert sentry.capture_message.call_count == 1
    args, kwargs = sentry.capture_message.call_args
    message = args[0]
    assert "book_emptied" in message
    assert kwargs.get("level") == "warning"
    for secret in (API_KEY_ID_1, ALLOCATOR_ID, "o-1", "500"):
        assert secret not in message
    scope = sentry.new_scope.return_value.__enter__.return_value
    tags = {call.args[0]: call.args[1] for call in scope.set_tag.call_args_list}
    assert tags.get("compute_job_id") == f"refresh-{API_KEY_ID_1}"
    assert tags.get("refresh_outcome") == "book_emptied"
    assert ALLOCATOR_ID not in tags.values()


@pytest.mark.asyncio
async def test_a_funded_account_whose_poll_reads_empty_keeps_its_carried_value(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """C2 silent-failure round 3, SFH-R3-01, the reviewer's measured case. A
    bybit key held 200,000 USDT two days ago; yesterday's snapshot is 200,000.
    Yesterday's poll ended 'complete' with 0 rows: the documented Bybit UTA
    parse-empty class, where CCXT's spot 'total' comes back empty for a
    funded account and the fallback misses. Round 2 read that as proof, and
    because it was the book's only account, wrote a permanent $0 day
    (first-writer-wins). The key's own live equity read, taken after that
    poll, still finds 200,000. That is a contradiction, not a proof: today
    persists the carried 200,000, no $0 row, no book_emptied capture, and a
    WARNING (no key id, no USD) says the empty poll was contradicted."""
    import logging
    from unittest.mock import patch

    caplog.set_level(logging.INFO, logger="quantalyze.analytics.equity_reconstruction")
    fake = FakeSupabaseClient()
    _seed_key(
        fake, API_KEY_ID_1, exchange="bybit", sync_status="complete", venue_account_id="b-1"
    )
    _seed_holding(fake, API_KEY_ID_1, "bybit", "USDT", TODAY - timedelta(days=2), 200_000.0)
    _seed_snapshot(fake, CLOSED_DAY - timedelta(days=1), 200_000.0)
    yesterday_poll = _at(TODAY - timedelta(days=1))
    _seed_poll_outcome(fake, API_KEY_ID_1, yesterday_poll)
    _seed_key_inputs(
        fake,
        API_KEY_ID_1,
        yesterday_poll + timedelta(minutes=90),
        anchor_usd=200_000.0,
        anchor_null_reason=None,
    )

    with patch("services.equity_reconstruction.sentry_sdk") as sentry:
        audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(200_000.0), (
        f"a funded account read empty by its poll was zeroed: {row['value_usd']}"
    )
    metadata = _refresh_complete_metadata(audit)
    assert "reason" not in metadata
    assert metadata["emptied_accounts"] == 0
    assert metadata["carried_keys"] == 1
    assert sentry.capture_message.call_count == 0
    contradicted = [
        r for r in caplog.records
        if r.levelno == logging.WARNING and "contradict" in r.getMessage()
    ]
    assert contradicted, caplog.text
    for r in contradicted:
        assert API_KEY_ID_1 not in r.getMessage()
        assert "200000" not in r.getMessage() and "200,000" not in r.getMessage()


HELD_ACTION = "allocator.equity.refresh_held"


def _audit_actions(audit: Any) -> list[str]:
    return [c.kwargs.get("action") for c in audit.call_args_list]


def _held_metadata(audit: Any) -> dict[str, Any]:
    calls = [c for c in audit.call_args_list if c.kwargs.get("action") == HELD_ACTION]
    assert len(calls) == 1, f"expected one {HELD_ACTION} audit, got {len(calls)}"
    metadata: dict[str, Any] = calls[0].kwargs["metadata"]
    return metadata


def _no_snapshot_row(fake: FakeSupabaseClient) -> None:
    rows = [
        r for r in fake.rows_for("allocator_equity_snapshots")
        if r["asof"] == CLOSED_DAY.isoformat()
    ]
    assert rows == [], f"a held day must write no snapshot row, got {len(rows)}"


@pytest.mark.asyncio
async def test_a_book_with_an_account_it_cannot_read_is_not_written_as_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The $0 row needs proof for EVERY counted account. One proven empty and
    one WORKING account that has never been polled is not an empty book, and
    (167.1.2.1.1 D-01) it is not a short book either: the day is HELD, so the
    snapshot store never records the unread account as absent. Before D-01
    this took the no_holdings_today branch, which also wrote nothing but named
    no cause and only for this accidental shape."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "BTC", TODAY - timedelta(days=3), 500.0)
    _seed_empty_proof(fake, API_KEY_ID_1, _at(TODAY))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "never_polled_working"
    assert metadata["emptied_accounts"] == 1
    assert metadata["never_polled_working_accounts"] == 1
    assert metadata["never_polled_keys"] == 1
    assert "allocator.equity.refresh_complete" not in _audit_actions(audit)


@pytest.mark.asyncio
async def test_eligible_key_that_never_polled_is_counted_not_silent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 (167.1.2.1.1) replaces C2 silent-failure SFH-08. SFH-08 wrote the
    day WITHOUT an eligible key that had no holdings row and counted it. That
    persisted a short total, first-writer-wins, so a key added (or a broken
    poller) permanently understated the day. A WORKING key that was never read
    now holds the day: no snapshot row, one refresh_held audit naming why."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "never_polled_working"
    assert metadata["never_polled_keys"] == 1
    assert metadata["never_polled_working_accounts"] == 1
    assert metadata["carried_keys"] == 0
    leaked = {k: v for k, v in metadata.items() if v in (HOLDER_USD, 1000, 1000.0)}
    assert not leaked, f"hold metadata carries a USD figure: {sorted(leaked)}"


@pytest.mark.asyncio
async def test_never_polled_working_account_holds_the_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 / SC-4 (167.1.2.1.1). Two accounts; B's working key has no holdings
    row and no sync_completed event, so nothing says anyone ever read it. A day
    written now omits B's whole balance and first-writer-wins keeps it. The job
    ends DONE with no snapshot insert and one refresh_held audit."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "never_polled_working"
    assert metadata["never_polled_working_accounts"] == 1
    assert metadata["venue"] == "okx"
    assert "allocator.equity.refresh_complete" not in _audit_actions(audit)


@pytest.mark.asyncio
async def test_polled_account_with_no_rows_does_not_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-13 (167.1.2.1.1). An account whose poll COMPLETED and wrote no rows is
    polled_no_rows, not never-polled: PROD has 5 such Deribit keys, and a
    row-only predicate would freeze that book for ever. The sync_completed
    audit event is what tells the two apart. The day is written without it
    (nothing to carry) and the audit counts it."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_poll_outcome(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["polled_no_rows_accounts"] == 1
    assert metadata["never_polled_working_accounts"] == 0


@pytest.mark.asyncio
async def test_a_foreign_owners_poll_event_does_not_release_the_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-10 (167.1.2.1.1). The polled evidence is read for THIS allocator's
    user_id only. A sync_completed row naming the key under another user is not
    proof that this owner's key was read, so the hold stands."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_poll_outcome(
        fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)),
        user_id="00000000-0000-0000-0000-0000000000ff",
    )

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    assert _held_metadata(audit)["reason"] == "never_polled_working"


@pytest.mark.asyncio
async def test_deribit_only_never_polled_does_not_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-13 (167.1.2.1.1), technical choice. Deribit rows add $0 to the refresh
    total (the loop skips venue deribit), so an unread Deribit account cannot
    make the total short. Freezing the day for it would hold the book for a
    $0 contribution. Today's behaviour stays: the day is written, the key is
    counted in never_polled_keys."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="deribit", sync_status="complete", venue_account_id="d-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["never_polled_keys"] == 1
    assert metadata["never_polled_working_accounts"] == 0


class _AuditReadFailsTable(_FakeTable):
    def execute(self) -> Any:
        if self._pending_op == "select":
            raise RuntimeError("fixture: read of audit_log failed")
        return super().execute()


class _AuditReadFails(FakeSupabaseClient):
    """A fake whose audit_log SELECT raises, to prove a failed polled-evidence
    read fails the job instead of falling through to the write."""

    def table(self, name: str) -> _FakeTable:
        if name == "audit_log":
            return _AuditReadFailsTable(name, self.store)
        return super().table(name)


@pytest.mark.asyncio
async def test_failed_polled_evidence_read_fails_the_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-13 (167.1.2.1.1). If the evidence read fails and the code treated that
    as "no event", a polled-but-empty account would look never-polled (or the
    reverse) and the day would be held or written on a guess. The read raises
    into the handler: FAILED job, refresh_failed audit, no snapshot."""
    fake = _AuditReadFails()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1, expect_failed=True)

    _no_snapshot_row(fake)
    actions = _audit_actions(audit)
    assert "allocator.equity.refresh_failed" in actions
    assert HELD_ACTION not in actions


def _sentry_calls(sentry: Any) -> list[tuple[str, dict[str, Any]]]:
    """(message, tags) for each capture_message the job made."""
    scope = sentry.new_scope.return_value.__enter__.return_value
    tags = {call.args[0]: call.args[1] for call in scope.set_tag.call_args_list}
    return [(c.args[0], tags) for c in sentry.capture_message.call_args_list]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_key", "raises"), [(API_KEY_ID_1, True), (API_KEY_ID_2, False)]
)
async def test_hold_sentry_is_raised_by_the_leader_only(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """D-14 (167.1.2.1.1). A book with N keys runs N refresh jobs a day, and all
    N reach the same hold. Every job writes its own audit row, but only the
    LEADER (the smallest working eligible key id of the allocator) raises the
    Sentry event, so one hold is one event, not N. The message is static and carries
    no key id, allocator id, venue id or USD (D-09)."""
    from unittest.mock import patch

    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    with patch("services.equity_reconstruction.sentry_sdk") as sentry:
        audit = await _run_refresh(monkeypatch, fake, job_key)

    _held_metadata(audit)  # every job writes its own audit row
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        message, tags = calls[0]
        assert sentry.capture_message.call_args.kwargs.get("level") == "warning"
        assert tags.get("compute_job_id") == f"refresh-{job_key}"
        assert tags.get("refresh_outcome") == "held_never_polled"
        for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "o-1", "b-1", "bybit", "okx", "1000"):
            assert secret not in message
            assert secret not in [str(v) for v in tags.values()]


def _tags(sentry: Any) -> dict[str, Any]:
    scope = sentry.new_scope.return_value.__enter__.return_value
    return {call.args[0]: call.args[1] for call in scope.set_tag.call_args_list}


async def _run_with_sentry(
    monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, job_key: str = API_KEY_ID_1
) -> tuple[Any, Any]:
    from unittest.mock import patch

    with patch("services.equity_reconstruction.sentry_sdk") as sentry:
        audit = await _run_refresh(monkeypatch, fake, job_key)
    return audit, sentry


def _book_with_account_b(
    fake: FakeSupabaseClient, *, b_age_days: int, b_venue: str = "bybit", **b_key: Any
) -> None:
    """Account A (key 1, okx) polled today. Account B (key 2) last had rows
    ``b_age_days`` ago. B's account id is stamped, so the identity-unknown rule
    (R2-CR-02) is not what decides these cases."""
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(
        fake, API_KEY_ID_2,
        **{"exchange": b_venue, "sync_status": "complete", "venue_account_id": "b-1", **b_key},
    )
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, b_venue, "BTC", TODAY - timedelta(days=b_age_days), 500.0)


@pytest.mark.asyncio
@pytest.mark.parametrize(("age", "held"), [(7, False), (8, True)])
async def test_carry_age_cap_boundary(
    monkeypatch: pytest.MonkeyPatch, age: int, held: bool
) -> None:
    """D-02 / SC-5 (167.1.2.1.1). A carry prices an account at ITS last poll's
    marks. Past CARRY_AGE_CAP_DAYS = 7 days that is no longer the book's value,
    and first-writer-wins would keep it. Age 7 is carried and written; age 8,
    with a WORKING key (so the key is polled and the stale rows are not
    explained by a dead key), holds the day with the count and the age."""
    from services.equity_reconstruction import CARRY_AGE_CAP_DAYS

    assert CARRY_AGE_CAP_DAYS == 7
    fake = FakeSupabaseClient()
    _book_with_account_b(fake, b_age_days=age)

    audit, sentry = await _run_with_sentry(monkeypatch, fake)

    if not held:
        assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD + 500.0)
        assert HELD_ACTION not in _audit_actions(audit)
        assert _refresh_complete_metadata(audit)["max_carry_age_days"] == 7
        assert sentry.capture_message.call_count == 0
        return
    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "carry_over_age"
    assert metadata["over_age_accounts"] == 1
    assert metadata["oldest_over_age_days"] == 8
    assert "allocator.equity.refresh_complete" not in _audit_actions(audit)
    ((message, tags),) = _sentry_calls(sentry)
    assert tags["refresh_outcome"] == "held_carry_over_age"
    assert tags["over_age_accounts"] == 1 and tags["oldest_over_age_days"] == 8
    for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "b-1", "bybit", "500"):
        assert secret not in message


@pytest.mark.asyncio
async def test_over_age_account_with_only_failing_keys_is_left_out_not_held(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-12 (167.1.2.1.1, founder 2026-10-16 "Same split"). An account that is
    over the cap AND whose eligible keys all fail has no key anyone can fix by
    waiting, so holding the day for it would freeze the owner's snapshot store
    for a dead key (T-11). It is left out with a count and a Sentry event
    instead, and the day is written without it."""
    fake = FakeSupabaseClient()
    _book_with_account_b(fake, b_age_days=8, sync_status="error")

    audit, sentry = await _run_with_sentry(monkeypatch, fake)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["over_age_failing_accounts"] == 1
    assert metadata["over_age_accounts"] == 0
    assert metadata["carried_keys"] == 0
    ((message, tags),) = _sentry_calls(sentry)
    assert tags["refresh_outcome"] == "left_out_carry_over_age_failing"
    for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "b-1", "bybit", "500"):
        assert secret not in message


@pytest.mark.asyncio
@pytest.mark.parametrize(("job_key", "raises"), [(API_KEY_ID_1, True), (API_KEY_ID_2, False)])
async def test_never_polled_failing_account_is_left_out_not_held(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """D-01 (167.1.2.1.1). A never-read account whose eligible keys all fail is
    a dead key, and nothing a later poll could fix by waiting. Holding the day
    would freeze the snapshot store for it (T-11), so the day is written
    without it, the audit counts it, and the LEADER job raises one Sentry
    event."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="error", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)

    audit, sentry = await _run_with_sentry(monkeypatch, fake, job_key)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["never_polled_failing_accounts"] == 1
    assert metadata["never_polled_working_accounts"] == 0
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        message, tags = calls[0]
        assert tags["refresh_outcome"] == "left_out_never_polled_failing"
        for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "b-1", "bybit"):
            assert secret not in message


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_key", "raises"),
    [(API_KEY_ID_1, False), (API_KEY_ID_2, True), (API_KEY_ID_3, False)],
)
async def test_the_leader_is_elected_among_working_keys_not_failing_ones(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """SFH M-1 (167.1.2.1.1). The smallest eligible key id used to lead, failing
    keys included, and a failing key's job is the likeliest to die in the
    preflight (decrypt, client build) or defer on the breaker, so the hold's
    one Sentry event never fired. The leader is now the smallest WORKING key.
    Key 1 fails (smallest id, not working); key 2 works and leads; key 3 works
    but never polled, which is the hold. Exactly one event, from key 2's job."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="error", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="okx", sync_status="complete", venue_account_id="o-2")
    _seed_key(fake, API_KEY_ID_3, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_2, "okx", "USDT", TODAY, HOLDER_USD)

    audit, sentry = await _run_with_sentry(monkeypatch, fake, job_key)

    assert _held_metadata(audit)["reason"] == "never_polled_working"
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        assert calls[0][1]["refresh_outcome"] == "held_never_polled"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_key", "raises"), [(API_KEY_ID_1, True), (API_KEY_ID_2, False)]
)
async def test_an_all_failing_book_still_raises_the_left_out_event(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """SFH M-2 (167.1.2.1.1). Every account of the book is never-polled and
    failing, so there are no holdings and the job takes ``no_holdings_today``:
    no snapshot is written at all, the worst case of "left out". The event used
    to sit after the snapshot write and never fired here. With no working key
    the smallest eligible key leads (the fallback)."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="error", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="error", venue_account_id="b-1")

    audit, sentry = await _run_with_sentry(monkeypatch, fake, job_key)

    _no_snapshot_row(fake)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["reason"] == "no_holdings_today"
    assert metadata["never_polled_failing_accounts"] == 2
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        message, tags = calls[0]
        assert tags["refresh_outcome"] == "left_out_never_polled_failing"
        for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "o-1", "b-1", "bybit", "okx"):
            assert secret not in message


@pytest.mark.asyncio
async def test_a_left_out_account_is_raised_when_the_day_waits_on_a_reconstruct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SFH M-2 (167.1.2.1.1), the second early return. A zero-snapshot book whose
    working key still owes its history reconstruct returns
    ``refresh_held_for_reconstruct`` before any write; the failing account the
    day leaves out is raised all the same."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="error", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    for key_id in (API_KEY_ID_1, API_KEY_ID_2):
        fake.store[("api_keys", (key_id,))].update(
            {"history_reconstructed_at": None, "history_reconstruct_attempts": 1}
        )

    audit, sentry = await _run_with_sentry(monkeypatch, fake, API_KEY_ID_1)

    assert "allocator.equity.refresh_held_for_reconstruct" in _audit_actions(audit)
    ((_, tags),) = _sentry_calls(sentry)
    assert tags["refresh_outcome"] == "left_out_never_polled_failing"


@pytest.mark.asyncio
async def test_a_proven_empty_old_account_is_exempt_from_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The cap is about stale VALUE. An account whose poll proved it empty
    contributes $0 whatever its last rows' age, so it is neither carried nor
    held: the emptiness proof is decided BEFORE the cap."""
    fake = FakeSupabaseClient()
    _book_with_account_b(fake, b_age_days=10)
    _seed_empty_proof(fake, API_KEY_ID_2, _at(TODAY))

    audit, sentry = await _run_with_sentry(monkeypatch, fake)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 1
    assert metadata["over_age_accounts"] == 0
    assert metadata["over_age_failing_accounts"] == 0
    assert sentry.capture_message.call_count == 0


@pytest.mark.asyncio
async def test_deribit_only_over_age_account_does_not_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-13 (167.1.2.1.1), technical choice extended to the cap. Deribit rows
    add $0 to the refresh total (the job skips the venue), so a stale Deribit
    carry cannot make the total stale or short, the same reasoning as the
    never-polled Deribit exemption. Holding the day for it would freeze the
    book for a $0 contribution. It is counted for visibility only."""
    fake = FakeSupabaseClient()
    _book_with_account_b(fake, b_age_days=10, b_venue="deribit")

    audit, sentry = await _run_with_sentry(monkeypatch, fake)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["over_age_excluded_venue_accounts"] == 1
    assert metadata["over_age_accounts"] == 0
    assert metadata["over_age_failing_accounts"] == 0
    assert sentry.capture_message.call_count == 0


# ---------------------------------------------------------------------------
# 167.1.2.1.1 SC-6 (D-03), the refresh half: two unstamped working keys of one
# stamping venue may read ONE exchange account, which `account_groups` would
# count as two accounts (no venue_account_id, no marker). The refresh holds the
# day until the stamper groups them; the derive blocks on the same helper.
# ---------------------------------------------------------------------------


def _seed_two_keys_on_one_venue(
    fake: FakeSupabaseClient, venue: str = "okx", **second: Any
) -> None:
    """Keys 1 and 2: eligible, working, unstamped, unmarked, same venue, each
    with holdings today (so nothing else holds the day)."""
    base = {"exchange": venue, "sync_status": "complete", "venue_account_id": None}
    _seed_key(fake, API_KEY_ID_1, **base)
    _seed_key(fake, API_KEY_ID_2, **{**base, **second})
    _seed_holding(fake, API_KEY_ID_1, venue, "USDT", TODAY, HOLDER_USD)
    _seed_holding(fake, API_KEY_ID_2, venue, "BTC", TODAY, 500.0)


@pytest.mark.asyncio
async def test_two_unstamped_working_keys_on_one_stamping_venue_hold_the_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-6 / D-03 (167.1.2.1.1). Before this, the refresh counted both keys as
    two accounts and wrote 1500 where one shared account may hold 1000,
    first-writer-wins. It now holds until the stamper groups them (grouping
    itself is unchanged)."""
    fake = FakeSupabaseClient()
    _seed_two_keys_on_one_venue(fake)

    audit, sentry = await _run_with_sentry(monkeypatch, fake)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "identity_pending"
    assert metadata["identity_pending_venues"] == 1
    ((message, tags),) = _sentry_calls(sentry)
    assert tags["refresh_outcome"] == "held_identity_pending"
    for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "okx", "1500"):
        assert secret not in message


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        pytest.param("one-key", id="one-unstamped-key"),
        pytest.param("mt5-pair", id="two-mt5-keys-stamp-no-id"),
        pytest.param("one-stamped", id="one-of-the-two-is-stamped"),
        pytest.param("one-failing", id="one-of-the-two-is-failing"),
    ],
)
async def test_a_key_list_that_cannot_double_count_does_not_hold(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """The hold is narrow: one candidate cannot be counted twice, MT5 stamps no
    id (so two MT5 keys are unstampable, not unknown), a stamped key's account
    is known, and a failing key is no candidate (the stamper only runs after a
    successful poll)."""
    fake = FakeSupabaseClient()
    if case == "one-key":
        _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id=None)
        _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    elif case == "mt5-pair":
        _seed_two_keys_on_one_venue(fake, venue="mt5")
    elif case == "one-stamped":
        _seed_two_keys_on_one_venue(fake, venue_account_id="o-2")
    else:
        _seed_two_keys_on_one_venue(fake, sync_status="error")

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert len([
        r for r in fake.rows_for("allocator_equity_snapshots")
        if r["asof"] == CLOSED_DAY.isoformat()
    ]) == 1
    assert HELD_ACTION not in _audit_actions(audit)
    assert _refresh_complete_metadata(audit)["identity_pending_venues"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("venue", "holds"),
    [
        pytest.param("deribit", False, id="deribit-adds-zero-so-no-double-count"),
        pytest.param("okx", True, id="control-okx-pair-still-holds"),
    ],
)
async def test_unstamped_working_deribit_keys_do_not_hold_the_refresh(
    monkeypatch: pytest.MonkeyPatch, venue: str, holds: bool
) -> None:
    """SFH M-3 (167.1.2.1.1). The refresh skips Deribit rows when it sums, so
    two unstamped working Deribit keys cannot double-count anything in its
    total, and holding the day's write for them froze the snapshot store for
    nothing. The derive keeps counting Deribit (its own call is unchanged). The
    okx pair is the control: the same setup on a venue that adds to the total
    does hold."""
    fake = FakeSupabaseClient()
    _seed_two_keys_on_one_venue(fake, venue=venue)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    if holds:
        assert _held_metadata(audit)["reason"] == "identity_pending"
        return
    assert HELD_ACTION not in _audit_actions(audit)
    assert _refresh_complete_metadata(audit)["identity_pending_venues"] == 0


@pytest.mark.asyncio
async def test_hold_reason_precedence_names_never_polled_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two causes at once: the reason is the first in the order
    never_polled_working, carry_over_age, identity_pending, and the audit
    carries every count so the second cause is not lost."""
    fake = FakeSupabaseClient()
    _seed_two_keys_on_one_venue(fake)
    _seed_key(fake, API_KEY_ID_3, exchange="bybit", sync_status="complete", venue_account_id="b-1")

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "never_polled_working"
    assert metadata["never_polled_working_accounts"] == 1
    assert metadata["identity_pending_venues"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("pending", [True, False])
async def test_a_held_first_day_stays_zero_snapshot_and_enqueues_nothing(
    monkeypatch: pytest.MonkeyPatch, pending: bool
) -> None:
    """Pitfall 4 (167.1.2.1.1). A zero-snapshot book whose first day is held
    must stay zero-snapshot, so the fan-out's bootstrap gate is still open
    tomorrow. The identity hold returns BEFORE the owed-reconstruct probe, so
    that probe does not run, writes nothing and enqueues nothing. The control
    (a stamped second key, nothing pending) reaches the owed-reconstruct hold
    with the very same keys, which shows the setup would hold for it."""
    fake = FakeSupabaseClient()
    _seed_two_keys_on_one_venue(
        fake,
        **({} if pending else {"venue_account_id": "o-2"}),
    )
    for key_id in (API_KEY_ID_1, API_KEY_ID_2):
        fake.store[("api_keys", (key_id,))].update(
            {"history_reconstructed_at": None, "history_reconstruct_attempts": 1}
        )

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    assert fake.rows_for("allocator_equity_snapshots") == []
    assert fake.rows_for("compute_jobs") == []
    assert fake.rpc_calls == []
    actions = _audit_actions(audit)
    if pending:
        assert _held_metadata(audit)["reason"] == "identity_pending"
        assert "allocator.equity.refresh_held_for_reconstruct" not in actions
    else:
        assert HELD_ACTION not in actions
        assert "allocator.equity.refresh_held_for_reconstruct" in actions


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


@pytest.mark.asyncio
@pytest.mark.parametrize("member_finds_capital", [True, False])
async def test_a_second_key_on_the_account_that_finds_capital_vetoes_the_proof(
    monkeypatch: pytest.MonkeyPatch, member_finds_capital: bool
) -> None:
    """SFH-R3-01, the group half. Two keys read one bybit account. The holder's
    poll read it empty and the holder's own live read found no capital, but
    the marked key's live read, taken after that poll, found 200,000. Both
    reads are of the same account, so they contradict each other: no proof,
    and the account is carried. Without the member's read, the same setup is
    proven and zeroed, which is what shows the veto is the rule biting."""
    fake = FakeSupabaseClient()
    _seed_pair(
        fake, "duplicate",
        holder={"exchange": "bybit", "sync_status": "complete", "venue_account_id": "b-1"},
        marked={"exchange": "bybit", "sync_status": "complete"},
    )
    _seed_holding(fake, API_KEY_ID_1, "bybit", "USDT", TODAY - timedelta(days=3), 500.0)
    today_poll = _at(TODAY)
    _seed_empty_proof(fake, API_KEY_ID_1, today_poll)
    if member_finds_capital:
        _seed_key_inputs(
            fake, API_KEY_ID_2, today_poll + timedelta(minutes=45),
            anchor_usd=200_000.0, anchor_null_reason=None,
        )

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    metadata = _refresh_complete_metadata(audit)
    if member_finds_capital:
        assert _snapshot_row(fake)["value_usd"] == pytest.approx(500.0)
        assert metadata["emptied_accounts"] == 0
        assert metadata["carried_keys"] == 1
    else:
        assert _snapshot_row(fake)["value_usd"] == 0.0
        assert metadata["reason"] == "book_emptied"
        assert metadata["emptied_accounts"] == 1


# ---------------------------------------------------------------------------
# C2 review round 3, R3-WR-01: the proof binds a poll to the day its rows
# carry, not to the time its audit event was created.
#
# A poll stamps its rows with the UTC day it STARTED (job_worker's today_str,
# taken before the fetch) and emits sync_completed after the fetch, the
# persist and _update_ok. A poll that starts before 00:00 UTC and emits after
# it writes rows dated D and an event created on D+1. When D stays the
# account's latest asof, that event sits inside the proof window
# (created_at >= D+1) with row_count > 0 and vetoed every later clean, empty
# poll until 200 newer events pushed it out: ~200 days of a stale carry,
# first-writer-wins. The event now records the poll's own asof, and the proof
# compares that day with the latest asof.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_poll_that_ran_across_utc_midnight_does_not_veto_a_later_empty_proof(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reviewer's reproduction. Key 2's last rows are at TODAY-3, written
    by a poll that emitted its row_count=1 event at 00:00:04 on TODAY-2. Clean,
    empty polls follow on TODAY-2 and TODAY-1, and the key's live equity read
    after them finds no capital. Round 2 measured 1500 (the stale 500 carried);
    the account is empty, so 1000 is right."""
    fake = FakeSupabaseClient()
    _seed_emptied_candidate(fake)
    rows_day = TODAY - timedelta(days=3)
    straddle_emit = datetime(
        (rows_day + timedelta(days=1)).year,
        (rows_day + timedelta(days=1)).month,
        (rows_day + timedelta(days=1)).day,
        0, 0, 4, tzinfo=timezone.utc,
    )
    _seed_poll_outcome(fake, API_KEY_ID_2, straddle_emit, row_count=1, asof=rows_day)
    for days_ago in (2, 1):
        day = TODAY - timedelta(days=days_ago)
        _seed_poll_outcome(fake, API_KEY_ID_2, _at(day), asof=day)
    _seed_key_inputs(fake, API_KEY_ID_2, _at(TODAY - timedelta(days=1)) + timedelta(minutes=30))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(HOLDER_USD), (
        f"a midnight-straddling poll vetoed the emptiness proof: {row['value_usd']}"
    )
    metadata = _refresh_complete_metadata(audit)
    assert metadata["emptied_accounts"] == 1
    assert metadata["carried_keys"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        pytest.param("legacy_rows_event", id="pre-deploy-event-without-asof-still-vetoes"),
        pytest.param("later_rows_event", id="a-poll-that-wrote-rows-after-the-latest-day-vetoes"),
    ],
)
async def test_events_without_asof_keep_the_created_at_rule(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """An event written before round 3 has no asof, so its rows' day is
    unknown: it keeps round 2's created_at rule, and a row_count > 0 event
    created after the latest day still vetoes (no proof, the account is
    carried). An event WITH an asof after the latest day vetoes as before.
    Such an event never PROVES either: see the clean-empty-event-without-asof
    arm of test_account_without_proof_of_emptiness_is_carried."""
    fake = FakeSupabaseClient()
    _seed_emptied_candidate(fake)
    rows_event_at = _at(TODAY - timedelta(days=2), hour=0)
    if case == "legacy_rows_event":
        _seed_poll_outcome(fake, API_KEY_ID_2, rows_event_at, row_count=1, without_asof=True)
    else:
        _seed_poll_outcome(
            fake, API_KEY_ID_2, rows_event_at, row_count=1, asof=TODAY - timedelta(days=2)
        )
    day = TODAY - timedelta(days=1)
    _seed_poll_outcome(fake, API_KEY_ID_2, _at(day), asof=day)
    _seed_key_inputs(fake, API_KEY_ID_2, _at(day) + timedelta(minutes=30))

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD + 500.0)
    assert _refresh_complete_metadata(audit)["emptied_accounts"] == 0


# ---------------------------------------------------------------------------
# 164.6.6.2.1 R2-WR-01 (D-02, D-08, D-17): the refresh honours the native-unpriced marker
# ---------------------------------------------------------------------------
#
# A BTC-denominated MT5 account whose latest completed day has no stored close polls to NO
# row; the positions poll records that in a service-only ``native_unpriced:<key>`` row of
# ``allocator_equity_derived`` (dated the poll's day). Its EARLIER row is priced at an older
# close. The refresh carries every counted account at its latest ``asof`` "with no staleness
# horizon", and the snapshot it writes is first-writer-wins -- so without this honour the
# stale-close value became the day's permanent legacy total, under a note saying the
# account was left out.

MT5_BTC_USD = 26_100.0


def _seed_unpriced_marker(
    fake: FakeSupabaseClient, key_id: str, day: date, *, valid: bool = True
) -> None:
    fake.store[("allocator_equity_derived", (ALLOCATOR_ID, f"native_unpriced:{key_id}"))] = {
        "allocator_id": ALLOCATOR_ID,
        "kind": f"native_unpriced:{key_id}",
        "payload": (
            {"native_unpriced": True, "asof": day.isoformat()} if valid else {"asof": day.isoformat()}
        ),
    }


def _seed_native_btc_book(fake: FakeSupabaseClient) -> None:
    """An okx key polled today, and an MT5 BTC key whose last PRICED row is yesterday's."""
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2, exchange="mt5")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 1000.0)
    _seed_holding(fake, API_KEY_ID_2, "mt5", "BTC", TODAY - timedelta(days=1), MT5_BTC_USD)


@pytest.mark.asyncio
async def test_a_marker_dated_after_the_priced_row_leaves_the_account_out_of_the_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Priced row for day N, marker for day N+1: the account is out of today's persisted
    snapshot and the exclusion is COUNTED (counts only, never the USD)."""
    fake = FakeSupabaseClient()
    _seed_native_btc_book(fake)
    _seed_unpriced_marker(fake, API_KEY_ID_2, TODAY)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(1000.0), (
        "the account unpriced today was carried at yesterday's close-priced row: "
        f"{row['value_usd']}"
    )
    assert "BTC" not in row["breakdown"]
    metadata = _refresh_complete_metadata(audit)
    assert metadata["native_unpriced_accounts"] == 1
    assert metadata["carried_keys"] == 0
    leaked = {k: v for k, v in metadata.items() if v == MT5_BTC_USD}
    assert not leaked, f"audit metadata carries a USD figure: {sorted(leaked)}"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        pytest.param("same_day", id="marker-on-the-rows-own-day-keeps-them"),
        pytest.param("older", id="marker-older-than-the-rows-keeps-them"),
        pytest.param("not_a_marker", id="payload-without-the-flag-is-not-a-marker"),
        pytest.param("no_marker", id="no-marker-at-all"),
    ],
)
async def test_a_marker_that_does_not_postdate_the_rows_hides_nothing(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """Strict comparison: a same-day priced poll (unpriced at 00:05, priced at 03:00) writes
    rows dated the marker's own day, and they stand. An old marker never hides a later
    priced row, so the marker is never cleared."""
    fake = FakeSupabaseClient()
    _seed_native_btc_book(fake)
    if case == "same_day":
        _seed_unpriced_marker(fake, API_KEY_ID_2, TODAY - timedelta(days=1))
    elif case == "older":
        _seed_unpriced_marker(fake, API_KEY_ID_2, TODAY - timedelta(days=4))
    elif case == "not_a_marker":
        _seed_unpriced_marker(fake, API_KEY_ID_2, TODAY, valid=False)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(1000.0 + MT5_BTC_USD)
    assert _refresh_complete_metadata(audit)["native_unpriced_accounts"] == 0


@pytest.mark.asyncio
async def test_a_book_whose_only_account_is_unpriced_writes_no_snapshot_and_says_why(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The only counted account is unpriced: there is nothing honest to write, so the
    existing no-holdings branch runs (no row, no zero) and its audit carries the count."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_2, exchange="mt5")
    _seed_holding(fake, API_KEY_ID_2, "mt5", "BTC", TODAY - timedelta(days=1), MT5_BTC_USD)
    _seed_unpriced_marker(fake, API_KEY_ID_2, TODAY)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_2)

    assert fake.rows_for("allocator_equity_snapshots") == []
    metadata = _refresh_complete_metadata(audit)
    assert metadata["reason"] == "no_holdings_today"
    assert metadata["native_unpriced_accounts"] == 1


@pytest.mark.asyncio
async def test_a_failed_marker_read_fails_the_job_instead_of_pinning_a_short_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The snapshot is first-writer-wins, so a refresh that could not read the marker must
    not write the day: it fails loudly (FAILED job plus a refresh_failed audit) and the
    next run retries. Counting the stale row would pin a value the marker exists to deny."""
    fake = FakeSupabaseClient()
    _seed_native_btc_book(fake)
    real_table = fake.table

    class _BrokenTable:
        def __getattr__(self, _name: str) -> Any:
            def _chain(*_a: Any, **_k: Any) -> Any:
                return self

            return _chain

        def execute(self) -> Any:
            raise RuntimeError("marker table unavailable")

    def _table(name: str) -> Any:
        return _BrokenTable() if name == "allocator_equity_derived" else real_table(name)

    monkeypatch.setattr(fake, "table", _table)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1, expect_failed=True)

    assert fake.rows_for("allocator_equity_snapshots") == []
    actions = [c.kwargs.get("action") for c in audit.call_args_list]
    assert "allocator.equity.refresh_failed" in actions


# ---------------------------------------------------------------------------
# Phase 167.2.1.1.1.1 plan 12 (D-04, D-06): a sizable price gap holds the day
# ---------------------------------------------------------------------------


def _seed_gap_book(
    fake: FakeSupabaseClient,
    key_id: str = API_KEY_ID_1,
    *,
    read_day: date = TODAY,
    usdt: float = 500.0,
    symbol: str = "BTC",
    gap_quantity: float = 1.0,
    priced_mark: float | None = 60000.0,
    priced_age_days: int = 2,
    venue: str = "okx",
) -> None:
    """One account's read day: a USDT row, and ``symbol`` held at quantity
    ``gap_quantity`` with NO price (a gap row: value 0.0, mark 0.0, plan 04's shape).
    ``priced_mark`` (None for never) is that symbol's mark on a row ``priced_age_days``
    before the read day, the price the sizing read finds."""
    _seed_holding(fake, key_id, venue, "USDT", read_day, usdt)
    _seed_holding(
        fake, key_id, venue, symbol, read_day, 0.0, quantity=gap_quantity, mark_price=0.0
    )
    if priced_mark is not None:
        _seed_holding(
            fake, key_id, venue, symbol, read_day - timedelta(days=priced_age_days),
            gap_quantity * priced_mark, quantity=gap_quantity, mark_price=priced_mark,
        )


@pytest.mark.asyncio
async def test_refresh_holds_on_a_sizable_price_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-04 / D-N6. The read day holds 500.0 of USDT and 1.0 BTC with no price. The newest
    priced BTC row, two days earlier, says 60000.0, so the unpriced balance is
    1.0 x 60000.0 = 60000.0 against a floor of 0.001 x 500.0 = 0.50: far above it. Writing
    the day would store 500.0 for a book worth ~60500.0, and the snapshot is
    first-writer-wins, so the day is HELD by name (167.1.2.1.1 D-01) and nothing is written."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(fake)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "price_gap"
    assert metadata["price_gap_accounts"] == 1
    assert "allocator.equity.refresh_complete" not in _audit_actions(audit)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_key", "raises"), [(API_KEY_ID_1, True), (API_KEY_ID_2, False)]
)
async def test_price_gap_hold_sentry_is_leader_only(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """D-14 (167.1.2.1.1) for the new reason: one hold, one Sentry event, from the leader
    (smallest working eligible key). An integer ``price_gap_accounts`` tag and a closed
    outcome token; no id, venue id, symbol or USD figure in the message or any tag."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_gap_book(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_2, "bybit", "USDT", TODAY, 700.0)

    audit, sentry = await _run_with_sentry(monkeypatch, fake, job_key)

    assert _held_metadata(audit)["reason"] == "price_gap"
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        message, tags = calls[0]
        assert sentry.capture_message.call_args.kwargs.get("level") == "warning"
        assert tags.get("refresh_outcome") == "held_price_gap"
        assert tags.get("price_gap_accounts") == 1
        assert isinstance(tags.get("price_gap_accounts"), int)
        for secret in (
            API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "o-1", "b-1", "okx", "bybit",
            "BTC", "60000", "500", "700",
        ):
            assert secret not in message
            assert secret not in [str(v) for v in tags.values()]


@pytest.mark.asyncio
async def test_price_gap_is_not_a_stable_value_derivative_or_deribit_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PATTERNS trap 9. `is_price_gap_holding` is row-level and pure; the refresh adds the
    two exclusions it owns. A stable-value spot row (USDE is valued 1.0), a derivative row
    and a Deribit spot row, each at mark 0.0, leave the day WRITTEN: none of them is an
    unpriced balance the refresh counts, so no hold and no sizing read is needed."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 1000.0)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDE", TODAY, 0.0, quantity=5.0, mark_price=0.0)
    _seed_holding(
        fake, API_KEY_ID_1, "okx", "BTCUSDTSWAP", TODAY, 0.0,
        holding_type="derivative", unrealized_pnl_usd=7.0, quantity=2.0, mark_price=0.0,
    )
    _seed_holding(fake, API_KEY_ID_1, "deribit", "ETH", TODAY, 0.0, quantity=3.0, mark_price=0.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    # 1000.0 USDT + 7.0 derivative P&L (USDE and the Deribit spot row add 0.0).
    assert _snapshot_row(fake)["value_usd"] == pytest.approx(1007.0)
    assert HELD_ACTION not in _audit_actions(audit)
    assert _refresh_complete_metadata(audit)["price_gap_accounts"] == 0


@pytest.mark.asyncio
async def test_hold_reason_precedence_puts_price_gap_last(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reason is the first in never_polled_working, carry_over_age, identity_pending,
    price_gap; every count rides in the audit so the lower cause is not lost. The gap
    alone gives price_gap."""
    both = FakeSupabaseClient()
    _seed_key(both, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(both, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_gap_book(both, API_KEY_ID_1)
    audit = await _run_refresh(monkeypatch, both, API_KEY_ID_1)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "never_polled_working"
    assert metadata["never_polled_working_accounts"] == 1
    assert metadata["price_gap_accounts"] == 1

    alone = FakeSupabaseClient()
    _seed_key(alone, API_KEY_ID_1)
    _seed_gap_book(alone, API_KEY_ID_1)
    audit = await _run_refresh(monkeypatch, alone, API_KEY_ID_1)
    assert _held_metadata(audit)["reason"] == "price_gap"


@pytest.mark.asyncio
async def test_carried_account_with_a_gap_holds(monkeypatch: pytest.MonkeyPatch) -> None:
    """A working account last read two days ago is carried (age 2, inside the cap of 7).
    Its rows carry a gap whose size is read against ITS read day: 1.0 ETH x 2000.0 =
    2000.0, priced on a row 2 days before that read day (TODAY - 4), against a floor of
    0.001 x 300.0 = 0.30. The carried account holds the day like a fresh one."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_gap_book(
        fake, API_KEY_ID_2, read_day=TODAY - timedelta(days=2), usdt=300.0,
        symbol="ETH", priced_mark=2000.0, venue="bybit",
    )

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "price_gap"
    assert metadata["price_gap_accounts"] == 1
    assert metadata["carried_keys"] == 1


# ---------------------------------------------------------------------------
# Plan 12 (D-06, F2, D-12): a dust or unsizable gap is left out and named
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_leaves_out_a_dust_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-06 / D-N14. USDT 100000.0 and 1.0 XYZ with no price; the newest priced XYZ row
    says 50.0, so the unpriced balance is 1.0 x 50.0 = 50.00 against a floor of
    0.001 x 100000.0 = 100.00: below it. Holding the day for a balance that small would
    freeze the store for a rounding error, so the day is WRITTEN at 100000.0 without an
    XYZ key and the audit counts the left-out row. A hold is a Sentry event, a leave-out is
    not."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(fake, usdt=100000.0, symbol="XYZ", priced_mark=50.0)

    audit, sentry = await _run_with_sentry(monkeypatch, fake)

    row = _snapshot_row(fake)
    assert row["value_usd"] == pytest.approx(100000.0)
    assert "XYZ" not in row["breakdown"]
    metadata = _refresh_complete_metadata(audit)
    assert metadata["price_gap_dust_rows"] == 1
    assert metadata["price_gap_accounts"] == 0
    assert HELD_ACTION not in _audit_actions(audit)
    assert sentry.capture_message.call_count == 0


@pytest.mark.asyncio
async def test_dust_left_out_is_named_on_the_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-06 / D-N15. The dust book of the test above (USDT 100000.0 and 1.0 XYZ at no price,
    the XYZ row two days earlier at 50.0: 50.00 against a floor of 100.00) writes the day
    WITHOUT the balance, and the stored row itself says what was left out: one record,
    ``{count: 1, symbols: ["XYZ"], dust: 1, unsizable: 0}``, not only the audit. A book
    with no left-out gap carries no such key."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(fake, usdt=100000.0, symbol="XYZ", priced_mark=50.0)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    breakdown = _snapshot_row(fake)["breakdown"]
    assert breakdown["__price_gap_left_out__"] == {
        "count": 1,
        "symbols": ["XYZ"],
        "dust": 1,
        "unsizable": 0,
    }
    assert breakdown["USDT"] == pytest.approx(100000.0)

    clean = FakeSupabaseClient()
    _seed_key(clean, API_KEY_ID_1)
    _seed_holding(clean, API_KEY_ID_1, "okx", "USDT", TODAY, 100000.0)
    await _run_refresh(monkeypatch, clean, API_KEY_ID_1)
    assert "__price_gap_left_out__" not in _snapshot_row(clean)["breakdown"]


@pytest.mark.asyncio
async def test_unsizable_left_out_is_named_on_the_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-06. A book with a priced USDT row and one XYZ gap that was never priced is
    unsizable; the recorded choice leaves it out, and the record counts it under
    ``unsizable`` (not ``dust``) next to the priced balance that was written."""
    from services import price_rule

    monkeypatch.setattr(price_rule, "UNSIZABLE_GAP_HOLDS", False)
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(fake, usdt=1000.0, symbol="XYZ", priced_mark=None)

    await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    assert _snapshot_row(fake)["breakdown"]["__price_gap_left_out__"] == {
        "count": 1,
        "symbols": ["XYZ"],
        "dust": 0,
        "unsizable": 1,
    }


@pytest.mark.asyncio
async def test_price_gap_left_out_only_book_writes_no_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-06 / D-N26. A book whose ONLY row is an unsizable gap (XYZ held, never priced) has
    nothing left to write once the gap is left out: no snapshot, and the
    ``refresh_complete`` audit says why, ``price_gap_left_out``, so a later reader does not
    take the missing day for "no holdings". With a derivative that reports no P&L in the
    same book the older reason ``derivative_pnl_unreported`` wins (checked first); a book
    with nothing at all keeps ``no_holdings_today``."""
    from services import price_rule

    monkeypatch.setattr(price_rule, "UNSIZABLE_GAP_HOLDS", False)

    only_gap = FakeSupabaseClient()
    _seed_key(only_gap, API_KEY_ID_1)
    _seed_holding(only_gap, API_KEY_ID_1, "okx", "XYZ", TODAY, 0.0, mark_price=0.0)
    audit = await _run_refresh(monkeypatch, only_gap, API_KEY_ID_1)
    _no_snapshot_row(only_gap)
    assert _refresh_complete_metadata(audit)["reason"] == "price_gap_left_out"
    assert _refresh_complete_metadata(audit)["price_gap_unsizable_rows"] == 1

    with_derivative = FakeSupabaseClient()
    _seed_key(with_derivative, API_KEY_ID_1)
    _seed_holding(with_derivative, API_KEY_ID_1, "okx", "XYZ", TODAY, 0.0, mark_price=0.0)
    _seed_holding(
        with_derivative, API_KEY_ID_1, "okx", "BTCUSDT", TODAY, 1000.0,
        holding_type="derivative", unrealized_pnl_usd=None,
    )
    audit = await _run_refresh(monkeypatch, with_derivative, API_KEY_ID_1)
    _no_snapshot_row(with_derivative)
    assert _refresh_complete_metadata(audit)["reason"] == "derivative_pnl_unreported"

    # No holdings at all (the only key never polled and failing, the shape of
    # test_an_all_failing_book_still_raises_the_left_out_event): no gap to name.
    empty = FakeSupabaseClient()
    _seed_key(empty, API_KEY_ID_1, exchange="okx", sync_status="error", venue_account_id="o-1")
    audit = await _run_refresh(monkeypatch, empty, API_KEY_ID_1)
    _no_snapshot_row(empty)
    assert _refresh_complete_metadata(audit)["reason"] == "no_holdings_today"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("priced_age_days", "unsizable_holds", "held"),
    [
        (None, False, False),  # never priced, recorded choice: left out
        (None, True, True),  # never priced, flag flipped: holds
        (8, False, True),  # WR-02: sized from its newest priced row at ANY age, so it holds
        (8, True, True),
        (30, False, True),  # D-04: a gap past N days still holds the day
        (7, False, True),  # a price 7 days back: 1.0 x 100.0 >= 0.001 x 1000.0
    ],
)
async def test_refresh_unsizable_gap_follows_the_recorded_decision(
    monkeypatch: pytest.MonkeyPatch,
    priced_age_days: int | None,
    unsizable_holds: bool,
    held: bool,
) -> None:
    """F2 (decided in plan 10, founder 2026-10-27 "unsizable left out"). USDT 1000.0 and
    1.0 XYZ with no price on the read day. A balance that was NEVER priced cannot be sized:
    the recorded choice (UNSIZABLE_GAP_HOLDS False) writes the day at 1000.0 and counts the
    row; the flag flipped holds it. A balance priced at ANY age (7, 8 or 30 days back;
    review WR-02) sizes from its newest priced row (1.0 x 100.0 = 100.0 against
    0.001 x 1000.0 = 1.0) and holds whatever the flag: D-04 holds a gap past N days and
    D-06 leaves out only what is below the floor."""
    from services import price_rule

    monkeypatch.setattr(price_rule, "UNSIZABLE_GAP_HOLDS", unsizable_holds)
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(
        fake, usdt=1000.0, symbol="XYZ",
        priced_mark=None if priced_age_days is None else 100.0,
        priced_age_days=priced_age_days or 0,
    )

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    if held:
        _no_snapshot_row(fake)
        assert _held_metadata(audit)["reason"] == "price_gap"
        return
    assert _snapshot_row(fake)["value_usd"] == pytest.approx(1000.0)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["price_gap_unsizable_rows"] == 1
    assert metadata["price_gap_dust_rows"] == 0
    assert metadata["price_gap_accounts"] == 0


@pytest.mark.asyncio
async def test_a_long_stuck_balance_is_sized_past_the_response_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WR-05. PostgREST answers at most ``max_rows`` rows (1000 in supabase/config.toml), and a
    gap row is stored with ``mark_price`` 0, so a balance stuck for a long time buries its own
    last priced row under newer gap rows. A sizing read that returns every row newest-first is
    cut off before that row, the balance reads as never priced, and a material holding is left
    out of a first-writer-wins row. Six newer gap rows sit above the one priced row here, against
    a response cap of five: the read must ask for the newest PRICED row alone, so the balance is
    still sized (1.0 x 100.0 against 0.001 x 1000.0) and the day is held by name."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(fake, usdt=1000.0, symbol="XYZ", priced_mark=100.0, priced_age_days=30)
    for age in range(1, 7):
        _seed_holding(
            fake, API_KEY_ID_1, "okx", "XYZ", TODAY - timedelta(days=age), 0.0, mark_price=0.0
        )
    monkeypatch.setattr(_FakeTable, "max_rows", 5)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    assert _held_metadata(audit)["reason"] == "price_gap"


@pytest.mark.asyncio
@pytest.mark.parametrize(("dust_rows", "held"), [(2, False), (3, True)])
async def test_many_dust_rows_that_add_up_past_the_floor_hold_the_day(
    monkeypatch: pytest.MonkeyPatch, dust_rows: int, held: bool
) -> None:
    """SF-M2. Level 100000.0, floor 0.001 x 100000.0 = 100.0. Each unpriced balance is
    1.0 x 40.0 = 40.0, dust on its own. Two of them add up to 80.0 (still below the floor):
    the day is written and both are named. Three add up to 120.0, at or past it, so the
    sum of the rows judged dust is judged like one balance and the day is held (judging each
    row alone would let any number of dust rows leave out an unbounded share)."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 100000.0)
    for name in ("AAA", "BBB", "CCC")[:dust_rows]:
        _seed_holding(fake, API_KEY_ID_1, "okx", name, TODAY, 0.0, mark_price=0.0)
        _seed_holding(fake, API_KEY_ID_1, "okx", name, TODAY - timedelta(days=2), 40.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    if held:
        _no_snapshot_row(fake)
        metadata = _held_metadata(audit)
        assert metadata["reason"] == "price_gap"
        assert metadata["price_gap_dust_rows"] == 0
        return
    assert _snapshot_row(fake)["value_usd"] == pytest.approx(100000.0)
    assert _refresh_complete_metadata(audit)["price_gap_dust_rows"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(("job_key", "raises"), [(API_KEY_ID_1, True), (API_KEY_ID_2, False)])
async def test_unsizable_leave_out_raises_the_leader_event(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """SF-M1. A balance never priced is left out by the recorded choice, and the day is
    written short by it. That is as silent as the failing-account leave-out, so the leader
    raises the same kind of static event (no id, no symbol, no USD), once. Dust stays quiet
    (test_refresh_leaves_out_a_dust_gap)."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="complete", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_gap_book(
        fake, API_KEY_ID_2, usdt=400.0, symbol="XYZ", priced_mark=None, venue="bybit"
    )

    audit, sentry = await _run_with_sentry(monkeypatch, fake, job_key)

    assert _refresh_complete_metadata(audit)["price_gap_unsizable_rows"] == 1
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        message, tags = calls[0]
        assert tags["refresh_outcome"] == "left_out_price_gap_unsizable"
        for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "b-1", "bybit", "XYZ"):
            assert secret not in message


@pytest.mark.asyncio
async def test_refresh_reads_the_floor_from_the_rule_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-N16. The refresh never names a share. A gap sized at 10% of its account's level
    (900.0 USDT, XYZ priced at 90.0: 90.0 / 900.0) holds under the recorded floor of
    0.001. With the rule module's floor patched to 0.5 (a size must reach 0.5 x 900.0 =
    450.0 to hold) the SAME book is dust and the day is written, so the disposition
    follows the one constant."""
    from services import price_rule

    def _book() -> FakeSupabaseClient:
        fake = FakeSupabaseClient()
        _seed_key(fake, API_KEY_ID_1)
        _seed_gap_book(fake, usdt=900.0, symbol="XYZ", priced_mark=90.0)
        return fake

    held_fake = _book()
    audit = await _run_refresh(monkeypatch, held_fake, API_KEY_ID_1)
    _no_snapshot_row(held_fake)
    assert _held_metadata(audit)["reason"] == "price_gap"

    monkeypatch.setattr(price_rule, "DUST_FLOOR_SHARE", 0.5)
    written_fake = _book()
    audit = await _run_refresh(monkeypatch, written_fake, API_KEY_ID_1)
    assert _snapshot_row(written_fake)["value_usd"] == pytest.approx(900.0)
    assert _refresh_complete_metadata(audit)["price_gap_dust_rows"] == 1


@pytest.mark.asyncio
async def test_a_sizable_gap_wins_over_a_dust_gap_of_the_same_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hold wins. Level 100000.0, floor 0.001 x 100000.0 = 100.0. BIG is 1.0 x 5000.0 =
    5000.0 (sizable), SMALL is 1.0 x 5.0 = 5.0 (dust). The day is held, and the dust row is
    NOT counted: nothing is written, so there is nothing to name as left out."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_gap_book(fake, usdt=100000.0, symbol="BIG", priced_mark=5000.0)
    _seed_holding(fake, API_KEY_ID_1, "okx", "SMALL", TODAY, 0.0, mark_price=0.0)
    _seed_holding(fake, API_KEY_ID_1, "okx", "SMALL", TODAY - timedelta(days=2), 5.0)

    audit = await _run_refresh(monkeypatch, fake, API_KEY_ID_1)

    _no_snapshot_row(fake)
    metadata = _held_metadata(audit)
    assert metadata["reason"] == "price_gap"
    assert metadata["price_gap_accounts"] == 1
    assert metadata["price_gap_dust_rows"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(("job_key", "raises"), [(API_KEY_ID_1, True), (API_KEY_ID_2, False)])
async def test_price_gap_failing_account_is_left_out(
    monkeypatch: pytest.MonkeyPatch, job_key: str, raises: bool
) -> None:
    """D-12 "Same split" (167.1.2.1.1) for the gap. Account B has a sizable gap (1.0 ETH x
    2000.0 against a floor of 0.001 x 400.0 = 0.40) but its only eligible key FAILS, so no
    later poll fixes it by waiting: holding the day would freeze the owner's store for a
    dead key (T-11). The day is written at 1000.0 WITHOUT B, the audit counts it, and the
    leader raises one static event."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="okx", sync_status="complete", venue_account_id="o-1")
    _seed_key(fake, API_KEY_ID_2, exchange="bybit", sync_status="error", venue_account_id="b-1")
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, HOLDER_USD)
    _seed_gap_book(
        fake, API_KEY_ID_2, usdt=400.0, symbol="ETH", priced_mark=2000.0, venue="bybit"
    )

    audit, sentry = await _run_with_sentry(monkeypatch, fake, job_key)

    assert _snapshot_row(fake)["value_usd"] == pytest.approx(HOLDER_USD)
    assert HELD_ACTION not in _audit_actions(audit)
    metadata = _refresh_complete_metadata(audit)
    assert metadata["price_gap_failing_accounts"] == 1
    assert metadata["price_gap_accounts"] == 0
    calls = _sentry_calls(sentry)
    assert len(calls) == (1 if raises else 0), calls
    if raises:
        message, tags = calls[0]
        assert tags["refresh_outcome"] == "left_out_price_gap_failing"
        for secret in (API_KEY_ID_1, API_KEY_ID_2, ALLOCATOR_ID, "b-1", "bybit", "ETH", "2000"):
            assert secret not in message


@pytest.mark.asyncio
async def test_left_out_gap_symbols_are_collected_sorted_and_capped_at_fifty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Named, never silent: plan 15 stamps ``price_gap_left_out_symbols`` on the stored row.
    60 dust rows (each 1.0 x 1.0 = 1.0 against 0.001 x 10000000.0 = 10000.0) are all counted,
    and the names collected are sorted and capped at 50 (the same bound as the
    perp-P&L-missing list), so the first 50 in sort order survive."""
    from services.equity_reconstruction import _fetch_latest_holdings_per_eligible_key

    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1)
    _seed_holding(fake, API_KEY_ID_1, "okx", "USDT", TODAY, 10_000_000.0)
    names = [f"S{i:02d}" for i in range(60)]
    for name in names:
        _seed_holding(fake, API_KEY_ID_1, "okx", name, TODAY, 0.0, mark_price=0.0)
        _seed_holding(fake, API_KEY_ID_1, "okx", name, TODAY - timedelta(days=1), 1.0)

    latest = await _fetch_latest_holdings_per_eligible_key(
        fake, ALLOCATOR_ID, TODAY.isoformat(), job_api_key_id=API_KEY_ID_1
    )

    assert latest.price_gap_dust_rows == 60
    assert latest.price_gap_unsizable_rows == 0
    assert latest.price_gap_left_out_symbols == tuple(names[:50])
    assert [r["symbol"] for r in latest.rows] == ["USDT"]
