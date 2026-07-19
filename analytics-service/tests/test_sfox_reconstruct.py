"""SFOX-05 — the sFOX reconstruction math (Wave-0 gap closed).

Two units under test, both feeding the EXISTING primitives (never a bespoke
TWR/derive loop):

  * ``services.broker_dailies.combine_sfox_balance_history`` — the sFOX
    ``usd_value`` NAV series + typed deposit/withdraw flows → a cashflow-neutral
    daily TWR series via the EXISTING ``nav_twr.chain_linked_twr``
    (flow-in-numerator, full DQ-01 guard set). Sibling of
    ``combine_native_ledger``.
  * ``services.sfox_read`` bounded crawls + typed-flow extraction (Task 2).

P115 discipline (money-math oracles must pin ECONOMICS, never re-assert the
impl's own formula): every numeric expectation in the ``combine_*`` suite is
HAND-DERIVED in the test — computed by hand in the comment, written as a literal,
and asserted to ~1e-12. NONE of them is produced by calling the module (or
``chain_linked_twr``) and re-asserting its own output against itself. The
deposit-day anti-pin additionally proves the cashflow-neutral return is
materially different from the naive ``usd_value.pct_change()`` that would book a
deposit as return (Pitfall 1).
"""
from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import combine_sfox_balance_history
from services.external_flows import ExternalFlow
from services.sfox_client import SfoxClient
from services.sfox_read import (
    SfoxCrawlTruncatedError,
    SfoxFlowValuationError,
    crawl_sfox_balance_history,
    crawl_sfox_transactions,
    sfox_flows_by_day,
)

_MS_DAY = 86_400_000  # one day in milliseconds


def _ms(day: str) -> int:
    """UTC-midnight epoch milliseconds for a 'YYYY-MM-DD' day."""
    return int(pd.Timestamp(day, tz="UTC").timestamp() * 1000)


# ---------------------------------------------------------------------------
# fixtures: build a NAV series + a flows series with hand-chosen values.
# ---------------------------------------------------------------------------
def _nav(values, start: str = "2026-01-01") -> pd.Series:
    """Consecutive-daily ``usd_value`` observations on an [us] DatetimeIndex."""
    idx = pd.date_range(start, periods=len(values), freq="D").as_unit("us")
    return pd.Series([float(v) for v in values], index=idx, name="usd_value")


def _flows(mapping: dict[str, float]) -> pd.Series:
    """Signed USD flow-per-day Series ({'YYYY-MM-DD': usd_signed})."""
    if not mapping:
        return pd.Series(dtype="float64", name="flows")
    days = sorted(mapping)
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit("us")
    return pd.Series([float(mapping[d]) for d in days], index=idx, name="flows")


# ---------------------------------------------------------------------------
# Task 1: combine_sfox_balance_history — cashflow-neutral TWR
# ---------------------------------------------------------------------------
def test_deposit_day_books_real_pnl_not_the_deposit_hand_derived_oracle():
    """The load-bearing P115 oracle: a +500 deposit on day 2 must book ONLY the
    day's real PnL (~0.495%), never the deposit (~50%).

    NAV = [1000, 1010, 1515, 1500.15] on 4 consecutive days; +500 deposit day 2.
    HAND-DERIVED expected returns (arithmetic done BY HAND, not by the module):
      day0 = anchor (prev0 = first NAV = 1000)      -> 0.0
      day1 = (1010 - 1000) / 1000                    = 0.01
      day2 = (1515 - 1010 - 500) / 1010 = 5/1010     = 0.004950495049504950...
      day3 = (1500.15 - 1515) / 1515 = -14.85/1515   = -0.009801980198019801...
    The deposit is REMOVED from the numerator so day 2 books $5, not $500.
    """
    nav = _nav([1000.0, 1010.0, 1515.0, 1500.15], start="2026-01-01")
    flows = _flows({"2026-01-03": 500.0})

    returns, meta = combine_sfox_balance_history(nav, flows)

    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-12)
    assert returns.iloc[2] == pytest.approx(0.004950495049504950, abs=1e-12)
    assert returns.iloc[3] == pytest.approx(-0.009801980198019801, abs=1e-12)

    # The deposit day books ~0.495%, categorically NOT ~50%.
    assert abs(returns.iloc[2]) < 0.01

    # Anti-pin (Pitfall 1): the cashflow-neutral return on the deposit day is
    # materially different from the naive usd_value.pct_change() (which counts the
    # deposit as a +50% "return"). This is the check that catches a regression
    # back to usd_value.pct_change().
    naive = nav.pct_change().iloc[2]
    assert naive == pytest.approx(0.5, abs=1e-12)  # (1515 - 1010) / 1010
    assert abs(returns.iloc[2] - naive) > 0.4

    # A clean fixture fires no DQ guard.
    assert meta.get("computation_status_hint") == "complete"


def test_withdrawal_day_books_only_real_pnl():
    """Symmetric to the deposit: a -300 withdrawal books only the real PnL.

    NAV = [1000, 1010, 720, 725]; -300 withdrawal on day 2. Equity DROPS
    1010 -> 720, but 300 of that was withdrawn, so the real PnL is positive:
      day2 = (720 - 1010 - (-300)) / 1010 = 10/1010 = 0.009900990099009901
    (HAND-DERIVED.) The naive pct_change would show ~-28.7%.
    """
    nav = _nav([1000.0, 1010.0, 720.0, 725.0], start="2026-02-01")
    flows = _flows({"2026-02-03": -300.0})

    returns, meta = combine_sfox_balance_history(nav, flows)

    assert returns.iloc[2] == pytest.approx(0.009900990099009901, abs=1e-12)
    # Real PnL is POSITIVE despite equity falling — the withdrawal is removed.
    assert returns.iloc[2] > 0
    naive = nav.pct_change().iloc[2]  # (720 - 1010) / 1010 = -0.2871...
    assert naive < -0.2
    assert abs(returns.iloc[2] - naive) > 0.25


def test_deposit_after_last_nav_day_ingests_no_orphan_raise_cr01():
    """CR-01 (the money-path blocker) refined by F2/F6: a deposit dated AFTER the
    last EOD balance-history day — the ordinary "fund the account, then
    connect/resync" flow (balance-history's last snapshot is yesterday; the deposit
    is today) — must NOT raise NavReconstructionError. The flow day is unioned into
    the CHAIN-LINK index (so _align_flows never orphan-raises), the deposit books
    cashflow-neutral (never counted as return), and — F2/F6 — the out-of-span flow
    day is then STRIPPED from the emitted series: it carried only a NaN and must
    NOT appear as a phantom row or widen the stamped span past the last observed
    NAV day (that would be a fabricated, inception/terminus-shifting artifact).

    NAV observed [1000, 1010] on 01-01/01-02 (last EOD = 01-02); a +500 deposit
    dated 01-03 (today — no EOD snapshot yet). HAND-DERIVED:
      day0 (01-01) = 0.0 anchor (prev0 = first NAV = 1000)
      day1 (01-02) = (1010 - 1000)/1000                 = 0.01
      01-03: NOT in the series — no NAV observation covers it yet; the deposit is
             neither booked nor lost, simply not-yet-reflected (the next crawl,
             once an EOD snapshot exists for it, picks it up honestly).
    """
    nav = _nav([1000.0, 1010.0], start="2026-01-01")  # last EOD = 01-02
    flows = _flows({"2026-01-03": 500.0})  # deposit dated AFTER the last NAV day

    # Pre-fix this raised NavReconstructionError (orphan flow); post-fix it does not.
    returns, meta = combine_sfox_balance_history(nav, flows)

    d0 = pd.Timestamp("2026-01-01").as_unit("us")
    d1 = pd.Timestamp("2026-01-02").as_unit("us")
    d2 = pd.Timestamp("2026-01-03").as_unit("us")
    assert returns.loc[d0] == pytest.approx(0.0, abs=1e-12)
    assert returns.loc[d1] == pytest.approx(0.01, abs=1e-12)
    # F2/F6: the out-of-span boundary flow day is NOT fabricated into the series and
    # does NOT widen the stamped span past the last observed NAV day.
    assert d2 not in returns.index
    assert returns.index.max() == d1
    # The deposit's naive +50%-ish return (500/1010) appears NOWHERE.
    assert not np.any(np.isclose(returns.dropna().to_numpy(), 500.0 / 1010.0))


def test_pre_inception_deposit_does_not_raise_orphan_cr01():
    """CR-01 symmetric case refined by F2/F6: a funding deposit dated a day BEFORE
    the first EOD balance-history snapshot must also not raise. It is unioned into
    the chain-link index (no orphan raise) but — F2/F6 — the out-of-span day is
    STRIPPED from the emitted series, so the displayed inception is NOT shifted
    earlier onto a phantom pre-inception day."""
    nav = _nav([1000.0, 1010.0, 1020.0], start="2026-02-02")  # first EOD = 02-02
    flows = _flows({"2026-02-01": 400.0})  # deposit dated BEFORE the first NAV day

    returns, meta = combine_sfox_balance_history(nav, flows)  # must not raise

    d_pre = pd.Timestamp("2026-02-01").as_unit("us")
    d_first = pd.Timestamp("2026-02-02").as_unit("us")
    # F2/F6: inception is the first OBSERVED NAV day, never shifted earlier onto the
    # out-of-span flow day.
    assert d_pre not in returns.index
    assert returns.index.min() == d_first


def test_flow_multiple_days_before_first_nav_fabricates_no_flat_days_f2():
    """F2/F6 (a): a flow dated MULTIPLE (>=2) days before the first NAV day must
    NOT fabricate flat 0.0 pre-inception days, and must NOT shift the displayed
    inception earlier.

    Pre-fix, ``combine_sfox_balance_history`` unioned the flow day into the NAV
    index THEN ran ``gap_fill_daily_returns`` (reindex fill_value=0.0). Because the
    union only added the single flow day (not the calendar days between it and the
    NAV span), gap_fill then FABRICATED 0.0 returns on those intervening days and
    pulled ``returns.index.min()`` back to the flow day — a fabricated,
    inception-shifting pre-history that says "flat, no change" on days the account
    was never observed. Post-fix the series is restricted to the OBSERVED NAV span,
    so those days simply do not exist.

    NAV observed 01-10/01-11/01-12; a +5000 deposit dated 01-07 (3 days pre-NAV).
    """
    nav = _nav([100000.0, 101000.0, 102000.0], start="2026-01-10")
    flows = _flows({"2026-01-07": 5000.0})  # 3 days before the first NAV day

    returns, meta = combine_sfox_balance_history(nav, flows)

    # Inception is the first observed NAV day — never the pre-inception flow day.
    assert returns.index.min() == pd.Timestamp("2026-01-10").as_unit("us")
    # None of the pre-inception calendar days were fabricated into the series.
    for d in ("2026-01-07", "2026-01-08", "2026-01-09"):
        assert pd.Timestamp(d).as_unit("us") not in returns.index
    # No fabricated flat 0.0 return sits before the first real move.
    # (day-0 01-10 is a NaN anchor here because its prev is the un-observed
    #  pre-inception NAV; the honest daily moves begin 01-11.)
    assert returns.loc[pd.Timestamp("2026-01-11").as_unit("us")] == pytest.approx(
        (101000.0 - 100000.0) / 100000.0, abs=1e-12
    )
    # A clean, hole-free observed span reports no coverage gap.
    assert meta.get("nav_coverage_gap_days", 0) == 0


def test_day0_inception_flow_forced_to_zero_anchor_wr01():
    """WR-01: a funding deposit dated ON the inception day must NOT emit a spurious
    ``-F_0/first_observed`` anchor-day return. prev0 = first_observed already
    reflects the same-day deposit, so F_0 is forced to 0 (dropped) → the anchor
    stays the honest 0.0.

    NAV = [1000, 1010] on 01-01/01-02; a +500 deposit dated 01-01 (inception day).
    Pre-fix returns[0] = (1000 - 1000 - 500)/1000 = -0.5 (spurious). Post-fix 0.0.
    day1 is unaffected: (1010 - 1000)/1000 = 0.01 (HAND-DERIVED).
    """
    nav = _nav([1000.0, 1010.0], start="2026-01-01")
    flows = _flows({"2026-01-01": 500.0})  # deposit ON the inception day

    returns, meta = combine_sfox_balance_history(nav, flows)

    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)  # honest anchor, not -0.5
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-12)
    # The spurious -0.5 anchor return must appear NOWHERE.
    assert not np.any(np.isclose(returns.dropna().to_numpy(), -0.5))
    # A clean anchor fires no DQ guard.
    assert meta.get("computation_status_hint") == "complete"


def test_day0_is_anchor_no_return():
    """A3 [ASSUMED]: prev0 = first OBSERVED usd_value → day-0 emits no movement
    (0.0 anchor); returns begin on day 1. Convention resolves empirically in the
    SFOX-06 founder evidence run — if the live run contradicts, amend HERE."""
    nav = _nav([2000.0, 2100.0], start="2026-03-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert returns.iloc[1] == pytest.approx(0.05, abs=1e-12)  # (2100-2000)/2000


def test_interior_missing_nav_day_breaks_that_day_and_next_never_bridged():
    """An UNOBSERVED interior NAV day is UNKNOWN, not flat: it must break, and a
    bridged multi-day return must never appear on the following day, nor may the
    missing day be fabricated as 0.0.

    Feed observes 04-01, 04-02, 04-04, 04-05 (04-03 ABSENT). Reindexed to every
    calendar day, 04-03 is NaN (never 0.0-filled) → it breaks, and 04-04 (NaN
    prev) breaks too. 04-05 (consecutive observed pair 04-04 -> 04-05) IS
    computed. The bridged (1030-1010)/1010 return must appear NOWHERE.
    """
    idx = pd.DatetimeIndex(
        [pd.Timestamp(d) for d in ("2026-04-01", "2026-04-02", "2026-04-04", "2026-04-05")]
    ).as_unit("us")
    nav = pd.Series([1000.0, 1010.0, 1030.0, 1040.0], index=idx, name="usd_value")

    returns, meta = combine_sfox_balance_history(nav, _flows({}))

    d3 = pd.Timestamp("2026-04-03").as_unit("us")
    d4 = pd.Timestamp("2026-04-04").as_unit("us")
    d5 = pd.Timestamp("2026-04-05").as_unit("us")
    assert math.isnan(returns.loc[d3])  # missing day itself breaks (not 0.0)
    assert math.isnan(returns.loc[d4])  # next day (NaN prev) also breaks
    assert returns.loc[d5] == pytest.approx((1040.0 - 1030.0) / 1030.0, abs=1e-12)

    bridged = (1030.0 - 1010.0) / 1010.0
    assert not np.any(np.isclose(returns.dropna().to_numpy(), bridged))

    # F2/F6 (b): the missing interior day is an HONEST coverage gap — the meta must
    # reflect it (never a silent 'complete' over a holed sampled span), and the real
    # PnL on the following observed pair is preserved (NOT zeroed).
    assert meta.get("computation_status_hint") != "complete"
    assert meta.get("nav_coverage_gap_days", 0) >= 1


def test_flow_dominated_guard_fires_and_surfaces_in_meta():
    """DQ-01 inherited: |flow| >= FLOW_DOM_RATIO(1.0) * prior NAV → the day breaks
    (NaN) and flow_dominated_guard rides the meta."""
    nav = _nav([2000.0, 2010.0, 5100.0, 5110.0], start="2026-05-01")
    flows = _flows({"2026-05-03": 3000.0})  # 3000 >= 1.0 * 2010 → dominated

    returns, meta = combine_sfox_balance_history(nav, flows)

    d = pd.Timestamp("2026-05-03").as_unit("us")
    assert math.isnan(returns.loc[d])
    assert meta.get("flow_dominated_guard") is True
    assert meta.get("computation_status_hint") == "complete_with_warnings"


def test_dust_nav_guard_fires_when_prev_below_floor():
    """DQ-01 inherited: a prior NAV below DUST_NAV_FLOOR ($1000) is not a usable
    denominator → dust_nav_guard break."""
    nav = _nav([500.0, 600.0, 650.0], start="2026-06-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    assert math.isnan(returns.iloc[1])  # prev = 500 < floor
    assert meta.get("dust_nav_guard") is True
    assert meta.get("computation_status_hint") == "complete_with_warnings"


def test_negative_nav_guard_fires_when_prev_nav_nonpositive():
    """DQ-01 inherited: a prior NAV of exactly 0 (divide-by-zero) → negative_nav_guard."""
    nav = _nav([2000.0, 0.0, 2000.0], start="2026-07-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    d = pd.Timestamp("2026-07-03").as_unit("us")  # prev (07-02) == 0
    assert math.isnan(returns.loc[d])
    assert meta.get("negative_nav_guard") is True


def test_empty_nav_returns_empty_series_honest():
    """Degenerate: empty NAV → empty Series (honest; the <2-finite gate proper
    lives downstream in derive_basis_series)."""
    returns, meta = combine_sfox_balance_history(
        pd.Series(dtype="float64"), _flows({})
    )
    assert returns.empty


def test_single_point_nav_no_computable_return():
    """Degenerate: a single observed point has no prior day → no computable
    return; never an invented row."""
    nav = _nav([1000.0], start="2026-08-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    assert returns.empty


def test_non_finite_usd_value_point_breaks_never_propagates_number():
    """A non-finite usd_value point (NaN/Inf in the feed) breaks that day AND the
    following day (NaN prev), never propagating a fabricated number."""
    nav = _nav([1000.0, float("nan"), 1030.0, 1040.0], start="2026-09-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    d2 = pd.Timestamp("2026-09-02").as_unit("us")
    d3 = pd.Timestamp("2026-09-03").as_unit("us")
    d4 = pd.Timestamp("2026-09-04").as_unit("us")
    assert math.isnan(returns.loc[d2])  # the NaN point breaks
    assert math.isnan(returns.loc[d3])  # the following day (NaN prev) breaks
    assert returns.loc[d4] == pytest.approx((1040.0 - 1030.0) / 1030.0, abs=1e-12)


# ---------------------------------------------------------------------------
# Task 2: bounded crawls + typed-flow extraction (services.sfox_read)
# ---------------------------------------------------------------------------
def _sfox_client() -> SfoxClient:
    """A REAL SfoxClient (so the isinstance boundary passes) with no live session."""
    return SfoxClient(api_key="secretkey123456")


async def test_crawl_transactions_follows_cursor_to_exhaustion_in_order():
    """The `after` id cursor is followed page-by-page to exhaustion; all rows are
    returned in order and the requests are SERIAL (one after another)."""
    page1 = [{"id": "1"}, {"id": "2"}]
    page2 = [{"id": "3"}, {"id": "4"}]
    page3 = [{"id": "5"}]
    pages = {None: page1, "2": page2, "4": page3, "5": []}

    client = _sfox_client()
    client.get_transactions = AsyncMock(
        side_effect=lambda from_ms=None, to_ms=None, limit=None, after=None: pages[after]
    )

    rows = await crawl_sfox_transactions(client, from_ms=0)

    assert [r["id"] for r in rows] == ["1", "2", "3", "4", "5"]
    # cursor followed: None -> "2" -> "4" -> "5" (four serial requests).
    afters = [c.kwargs.get("after") for c in client.get_transactions.await_args_list]
    assert afters == [None, "2", "4", "5"]


async def test_crawl_transactions_missing_id_cursor_fails_loud_not_keyerror():
    """WR-02: a schema-drifted transactions page whose last row lacks an `id`
    cursor must raise the TYPED SfoxCrawlTruncatedError (→ permanent, terminal
    stamp at the worker), NEVER a bare KeyError that escapes as transient and
    retries forever (the CR-01 DoS class). Pre-fix `page[-1]["id"]` raised KeyError."""
    client = _sfox_client()
    # A non-empty page whose LAST row has no `id` field (schema drift).
    client.get_transactions = AsyncMock(
        return_value=[{"id": "1"}, {"action": "deposit", "amount": "100"}]
    )
    with pytest.raises(SfoxCrawlTruncatedError):
        await crawl_sfox_transactions(client, from_ms=0)


async def test_crawl_transactions_empty_id_cursor_fails_loud():
    """WR-02: an `id` present but empty/None is not a usable cursor → typed
    truncation, never a silent loop on a degenerate `after`."""
    client = _sfox_client()
    client.get_transactions = AsyncMock(return_value=[{"id": None}])
    with pytest.raises(SfoxCrawlTruncatedError):
        await crawl_sfox_transactions(client, from_ms=0)


async def test_crawl_transactions_budget_exhaustion_raises_truncated():
    """A crawl that never exhausts within the hard request budget raises a typed
    truncation error — never a silent partial."""
    client = _sfox_client()
    # Always a fresh non-empty page whose last id advances → never terminates.
    counter = {"n": 0}

    def _page(from_ms=None, to_ms=None, limit=None, after=None):
        counter["n"] += 1
        return [{"id": str(counter["n"])}]

    client.get_transactions = AsyncMock(side_effect=_page)

    with pytest.raises(SfoxCrawlTruncatedError):
        await crawl_sfox_transactions(client, from_ms=0)


async def test_crawl_balance_history_full_window_returns_rows_and_earliest():
    """A crawl that reaches the requested recent edge returns its rows plus the
    observed earliest timestamp."""
    start = _ms("2026-01-01")
    end = _ms("2026-01-04")
    rows_full = [
        {"timestamp": _ms("2026-01-01"), "usd_value": "1000"},
        {"timestamp": _ms("2026-01-02"), "usd_value": "1010"},
        {"timestamp": _ms("2026-01-03"), "usd_value": "1020"},
        {"timestamp": _ms("2026-01-04"), "usd_value": "1030"},
    ]

    client = _sfox_client()

    def _bh(start_date_ms, end_date_ms=None, interval=86400):
        # One page covers the whole window; a follow-up (past the edge) is empty.
        return rows_full if start_date_ms <= start else []

    client.get_balance_history = AsyncMock(side_effect=_bh)

    rows, earliest = await crawl_sfox_balance_history(client, start, end)

    assert [r["usd_value"] for r in rows] == ["1000", "1010", "1020", "1030"]
    assert earliest == _ms("2026-01-01")


async def test_crawl_balance_history_recent_edge_shortfall_raises():
    """Pitfall 4: a crawl whose latest point stops MATERIALLY short of the
    requested recent edge is a truncation, never a complete-but-short series."""
    start = _ms("2026-01-01")
    end = _ms("2026-01-31")
    short_rows = [
        {"timestamp": _ms("2026-01-01"), "usd_value": "1000"},
        {"timestamp": _ms("2026-01-02"), "usd_value": "1010"},
    ]  # latest 2026-01-02, ~29 days short of the requested 2026-01-31 edge

    client = _sfox_client()

    def _bh(start_date_ms, end_date_ms=None, interval=86400):
        return short_rows if start_date_ms <= start else []

    client.get_balance_history = AsyncMock(side_effect=_bh)

    with pytest.raises(SfoxCrawlTruncatedError):
        await crawl_sfox_balance_history(client, start, end)


async def test_crawl_balance_history_earliest_after_start_is_not_error():
    """A1: the earliest returned point being AFTER the requested start is NOT an
    error (docs-silent depth → the earliest point is the empirical inception); it
    is surfaced to the caller."""
    start = _ms("2026-01-01")
    end = _ms("2026-01-10")
    rows = [
        {"timestamp": _ms("2026-01-05"), "usd_value": "1000"},  # inception > start
        {"timestamp": _ms("2026-01-10"), "usd_value": "1050"},  # reaches the edge
    ]

    client = _sfox_client()

    def _bh(start_date_ms, end_date_ms=None, interval=86400):
        return rows if start_date_ms <= start else []

    client.get_balance_history = AsyncMock(side_effect=_bh)

    out_rows, earliest = await crawl_sfox_balance_history(client, start, end)
    assert earliest == _ms("2026-01-05")  # empirical inception surfaced, no raise
    assert len(out_rows) == 2


async def test_crawl_balance_history_budget_exhaustion_raises():
    """A balance-history crawl that keeps advancing without ever reaching the edge
    exhausts the hard request budget → typed truncation."""
    start = _ms("2026-01-01")
    end = _ms("2030-01-01")  # far future the mock never reaches

    client = _sfox_client()

    def _bh(start_date_ms, end_date_ms=None, interval=86400):
        # A single advancing point per call — progresses forever, never hits edge.
        return [{"timestamp": start_date_ms + _MS_DAY, "usd_value": "1000"}]

    client.get_balance_history = AsyncMock(side_effect=_bh)

    with pytest.raises(SfoxCrawlTruncatedError):
        await crawl_sfox_balance_history(client, start, end)


def test_sfox_flows_by_day_signs_excludes_rotations_and_aggregates():
    """F3: only the DEFINITIVELY-external types classify — deposit +, withdraw −;
    same-UTC-day flows aggregate; buy/sell are internal rotations and are EXCLUDED;
    returns both the daily Series and the list[ExternalFlow] evidence.

    (charge/credit are no longer silently signed — see
    test_sfox_flows_by_day_unclassified_type_fails_loud_f3.)"""
    txns = [
        {"id": 1, "action": "deposit", "currency": "USD", "amount": "1000", "timestamp": _ms("2026-01-02")},
        {"id": 2, "action": "withdraw", "currency": "USD", "amount": "300", "timestamp": _ms("2026-01-02")},
        {"id": 3, "action": "withdraw", "currency": "USD", "amount": "20", "timestamp": _ms("2026-01-03")},
        {"id": 4, "action": "deposit", "currency": "USD", "amount": "50", "timestamp": _ms("2026-01-03")},
        {"id": 5, "action": "buy", "currency": "BTC", "amount": "0.1", "timestamp": _ms("2026-01-03")},
        {"id": 6, "action": "sell", "currency": "BTC", "amount": "0.1", "timestamp": _ms("2026-01-03")},
    ]

    series, evidence = sfox_flows_by_day(txns)

    d2 = pd.Timestamp("2026-01-02").as_unit("us")
    d3 = pd.Timestamp("2026-01-03").as_unit("us")
    # 2026-01-02: +1000 (deposit) − 300 (withdraw) = +700
    # 2026-01-03: +50 (deposit) − 20 (withdraw) = +30 ; buy/sell EXCLUDED
    assert series.loc[d2] == pytest.approx(700.0)
    assert series.loc[d3] == pytest.approx(30.0)
    assert set(series.index) == {d2, d3}
    # evidence = the 4 external flows only (rotations excluded).
    assert len(evidence) == 4
    assert all(isinstance(e, ExternalFlow) for e in evidence)
    signed = {(e.utc_day_iso, round(e.usd_signed, 2)) for e in evidence}
    assert ("2026-01-02", 1000.0) in signed
    assert ("2026-01-02", -300.0) in signed
    assert ("2026-01-03", 50.0) in signed
    assert ("2026-01-03", -20.0) in signed


@pytest.mark.parametrize("unclassified", ["charge", "credit", "fee", "interest", "rebate"])
def test_sfox_flows_by_day_unclassified_type_fails_loud_f3(unclassified):
    """F3 (money-path, DERIBIT-CORRECTION precedent): a transaction type that is NOT
    definitively deposit/withdraw (flow) or buy/sell (rotation) — charge, credit,
    fee, interest, rebate, ... — MUST fail loud, never be silently classified. The
    economic meaning (fee vs flow vs rebate) is UNVERIFIED, and mis-treating a fee as
    an external outflow backs it out of the TWR numerator and OVERSTATES performance.
    Fail loud and wait for real-account evidence."""
    txns = [
        {"id": 1, "action": "deposit", "currency": "USD", "amount": "1000", "timestamp": _ms("2026-01-02")},
        {"id": 2, "action": unclassified, "currency": "USD", "amount": "20", "timestamp": _ms("2026-01-03")},
    ]
    with pytest.raises(SfoxFlowValuationError, match="unclassified sFOX transaction type"):
        sfox_flows_by_day(txns)


def test_sfox_flows_by_day_non_usd_flow_raises_never_guessed():
    """A deposit/withdraw whose USD value is not derivable from its OWN fields
    (non-USD currency, no usable USD field) RAISES — never guessed, never dropped
    (a mis-valued flow silently corrupts the TWR)."""
    txns = [
        {"id": 1, "action": "deposit", "currency": "BTC", "amount": "0.5", "timestamp": _ms("2026-01-02")},
    ]
    with pytest.raises(SfoxFlowValuationError):
        sfox_flows_by_day(txns)


def test_sfox_flows_by_day_empty_is_honest_empty():
    """An empty account → honest empties everywhere (no fabricated flow)."""
    series, evidence = sfox_flows_by_day([])
    assert series.empty
    assert evidence == []


def test_extracted_flows_feed_combine_cashflow_neutral_end_to_end():
    """Wiring (Rule 9): the flows Series produced by sfox_flows_by_day aligns
    (index unit/day) with the combine_sfox_balance_history NAV reindex and books
    the deposit day cashflow-neutral (the P115 oracle value)."""
    txns = [
        {"id": 1, "action": "deposit", "currency": "USD", "amount": "500", "timestamp": _ms("2026-01-03")},
    ]
    flows, _evidence = sfox_flows_by_day(txns)
    nav = _nav([1000.0, 1010.0, 1515.0, 1500.15], start="2026-01-01")

    returns, _meta = combine_sfox_balance_history(nav, flows)
    # (1515 − 1010 − 500) / 1010 = 0.004950495049504950 — deposit removed.
    assert returns.iloc[2] == pytest.approx(0.004950495049504950, abs=1e-12)


@pytest.mark.parametrize("not_client", [object(), None, MagicMock()])
async def test_crawls_refuse_non_sfoxclient_at_boundary(not_client):
    """Read-only ingestion boundary: a non-SfoxClient object is refused with a
    TypeError BEFORE any read (the read_sfox_account precedent)."""
    with pytest.raises(TypeError):
        await crawl_sfox_balance_history(not_client, 0, 1)
    with pytest.raises(TypeError):
        await crawl_sfox_transactions(not_client, 0)


# ---------------------------------------------------------------------------
# Task 1 (plan 120-03): the elif venue=="sfox" worker branch + preflight/close
# seams. These are the wiring behaviors — a hang is bounded+retryable, every
# fail-loud disposition stamps + is permanent, the happy path rides the SHARED
# backbone, and the preflight/close chokepoints route sfox to the SfoxClient.
# ---------------------------------------------------------------------------
import asyncio
import re
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import services.job_worker as jw
from services.exchange import aclose_exchange
from services.job_worker import (
    DispatchOutcome,
    _make_exchange_client,
    _sfox_rows_to_usd_value_series,
    run_derive_broker_dailies_job,
)


def _bh_row(day: str, usd_value) -> dict:
    return {"timestamp": _ms(day), "usd_value": usd_value}


def _sfox_ctx(exchange: str = "sfox") -> tuple[MagicMock, dict]:
    """A worker ctx whose supabase captures upserts (mirrors the deribit test
    seam). strategy_row is a MagicMock (NOT a dict) so the venue-agnostic
    denominator-config / asset-class parses both resolve to None (defaults)."""
    capture: dict = {"upserts": []}
    ctx = MagicMock()
    ctx.exchange = MagicMock()  # the crawls are mocked, so the client is inert
    ctx.supabase = MagicMock()
    ctx.key_row = {"id": "key-sfox", "user_id": "alloc-1", "exchange": exchange}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture["upserts"].append((name, payload, kw.get("on_conflict")))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert
        tbl.insert.side_effect = lambda *a, **k: MagicMock(
            execute=MagicMock(return_value=MagicMock(data=[{"id": "x"}]))
        )
        return tbl

    ctx.supabase.table.side_effect = _table
    return ctx, capture


def _sfox_branch_patches(
    ctx: MagicMock,
    *,
    bh_return=None,
    bh_side_effect=None,
    txn_return=None,
    key_mode: bool,
) -> list:
    """Patch set for the sfox worker branch: preflight → ctx, the two crawls
    mocked at services.sfox_read (the branch imports them at call time), the
    close chokepoint + db_execute stubbed. combine_sfox_balance_history and the
    derive/persist backbone run FOR REAL (proving the ONE-path wiring)."""
    preflight = (
        "services.job_worker._allocator_key_preflight"
        if key_mode
        else "services.job_worker._exchange_preflight"
    )
    bh_mock = (
        AsyncMock(side_effect=bh_side_effect)
        if bh_side_effect is not None
        else AsyncMock(return_value=(bh_return or [], None))
    )
    return [
        patch(preflight, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.sfox_read.crawl_sfox_balance_history", new=bh_mock),
        patch(
            "services.sfox_read.crawl_sfox_transactions",
            new=AsyncMock(return_value=(txn_return or [])),
        ),
    ]


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


def _job(key_mode: bool) -> dict:
    return {"api_key_id": "key-sfox"} if key_mode else {"strategy_id": "s-sfox"}


# --- preflight + close chokepoints -----------------------------------------
def test_make_exchange_client_sfox_returns_sfoxclient():
    """The single preflight chokepoint constructs a GET-only SfoxClient for
    sfox (create_exchange RAISES for sfox) from the TRIMMED api_key; the secret
    is never passed (single-Bearer contract)."""
    client = _make_exchange_client("sfox", "  tok-abc  ", "ignored-secret", None)
    assert isinstance(client, SfoxClient)
    # The trimmed token is the Bearer (a trailing-newline token authenticates
    # identically to the validate path's .trim()).
    assert client._api_key == "tok-abc"


async def test_aclose_exchange_routes_sfoxclient_to_aclose():
    """The close chokepoint routes a SfoxClient to its OWN bounded aclose() and
    returns before the ccxt close() sequence (which SfoxClient does not implement)."""
    client = SfoxClient(api_key="secretkey123456")
    client.aclose = AsyncMock()
    await aclose_exchange(client)
    client.aclose.assert_awaited_once()


# --- the branch: hang is bounded + retryable (FLIPRETRY-01) ----------------
async def test_sfox_crawl_hang_is_bounded_transient_not_permanent(monkeypatch):
    """T-120-10 / FLIPRETRY-01: a crawl that sleeps past the per-crawl bound is
    converted to a CLASSIFIED TRANSIENT failure — asserted NOT permanent, NO
    terminal stamp — and the test returns fast (the bound fired, not the sleep)."""
    monkeypatch.setattr(jw, "_SFOX_CRAWL_TIMEOUT_S", 0.05)

    async def _hang(*a, **k):
        await asyncio.sleep(5)  # far past the 0.05s bound

    ctx, capture = _sfox_ctx()
    patches = _sfox_branch_patches(ctx, key_mode=False)
    # Replace the balance-history crawl with a hanging coroutine.
    patches[3] = patch(
        "services.sfox_read.crawl_sfox_balance_history",
        new=AsyncMock(side_effect=_hang),
    )
    with _apply(patches):
        result = await asyncio.wait_for(
            run_derive_broker_dailies_job(_job(key_mode=False)), timeout=2.0
        )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"  # retryable, NOT permanent
    assert result.error_kind != "permanent"
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert not stamps, "a bounded hang is transient — never a terminal stamp"


# --- fail-loud dispositions: truncation / unvaluable / material floor -------
async def test_sfox_crawl_truncation_is_permanent_with_stamp():
    """T-120-11: a truncated/under-fetched crawl (the assert_ledger_complete
    analog) → permanent FAILED + terminal strategy_analytics stamp; no partial
    track record is ever written."""
    ctx, capture = _sfox_ctx()
    patches = _sfox_branch_patches(
        ctx,
        bh_side_effect=SfoxCrawlTruncatedError("stopped short at a page boundary"),
        key_mode=False,
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps and stamps[0][1]["computation_status"] == "failed"


async def test_sfox_unvaluable_flow_is_permanent_with_stamp():
    """T-120-11: a typed unvaluable flow (a non-USD-family deposit) → permanent
    FAILED + stamp (the LedgerValuationError disposition parity). sfox_flows_by_day
    runs FOR REAL here — the raise comes from the real extractor."""
    ctx, capture = _sfox_ctx()
    patches = _sfox_branch_patches(
        ctx,
        bh_return=[_bh_row("2026-01-01", "1000"), _bh_row("2026-01-02", "1010")],
        txn_return=[
            {"id": 1, "action": "deposit", "currency": "BTC",
             "amount": "0.5", "timestamp": _ms("2026-01-02")},
        ],
        key_mode=False,
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps and stamps[0][1]["computation_status"] == "failed"


async def test_sfox_material_balance_floor_fails_loud():
    """T-120-12: a materially-funded account (>$100 terminal) with <2 usable NAV
    days is a silently-empty (green) track record → permanent FAILED + stamp
    naming the material equity, BEFORE combine. No leaked raw balance digits with
    a decimal (the ~USD magnitude is rounded to whole dollars)."""
    ctx, capture = _sfox_ctx()
    patches = _sfox_branch_patches(
        ctx,
        bh_return=[_bh_row("2026-01-01", "50000")],  # single point, $50k material
        key_mode=False,
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "material equity" in (result.error_message or "")
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps and stamps[0][1]["computation_status"] == "failed"


async def test_sfox_tiny_empty_account_flows_to_honest_downstream_gate():
    """A genuinely tiny/empty account (terminal below the $100 floor, single
    point) does NOT trip the material floor — it flows to the honest downstream
    <2-day gate. Key-mode returns DONE (no invented rows, no material failure)."""
    ctx, capture = _sfox_ctx()
    patches = _sfox_branch_patches(
        ctx,
        bh_return=[_bh_row("2026-01-01", "10")],  # $10 — below the floor
        key_mode=True,
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job(_job(key_mode=True))
    assert result.outcome == DispatchOutcome.DONE
    # NOT the material-balance permanent failure.
    for _name, payload, _oc in capture["upserts"]:
        assert "material equity" not in str(payload)


# --- CR-01: boundary-flow money path + defensive combine catch --------------
async def test_sfox_deposit_dated_after_last_nav_day_ingests_no_retry_cr01():
    """CR-01 end-to-end (THE money path): a deposit dated AFTER the last EOD
    balance-history snapshot (the fund-then-connect flow) ingests cleanly through
    the worker — DONE, no NavReconstructionError, no transient retry, no terminal
    `failed` stamp. Pre-fix the orphan flow raised inside combine and escaped the
    sfox branch to the retry-forever dispatcher (T-74-02 DoS)."""
    ctx, capture = _sfox_ctx()
    nav_rows = [
        _bh_row("2026-01-01", "100000"),
        _bh_row("2026-01-02", "101000"),  # last EOD snapshot (yesterday)
    ]
    # +5000 deposit dated 01-03 — AFTER the last NAV day (the orphan-flow trigger).
    txns = [
        {"id": 1, "action": "deposit", "currency": "USD", "amount": "5000",
         "timestamp": _ms("2026-01-03")},
    ]
    patches = _sfox_branch_patches(
        ctx, bh_return=nav_rows, txn_return=txns, key_mode=False
    )
    with _apply(patches), patch(
        "services.basis_series.persist_basis_series", new=MagicMock()
    ):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.DONE
    # It ingested — no terminal failed stamp, no retry classification.
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    for _name, payload, _oc in stamps:
        assert payload.get("computation_status") != "failed"


async def test_sfox_combine_nav_reconstruction_error_is_permanent_with_stamp():
    """CR-01 defense-in-depth: if combine_sfox_balance_history raises a STRUCTURAL
    NavReconstructionError (a residual schema-drift case the union cannot absorb),
    the sfox branch disposes PERMANENT with a terminal strategy_analytics stamp —
    NEVER letting it escape to the generic dispatcher (retry-forever, no stamp: the
    T-74-02 DoS). Neuter the try/except at the combine site → this reddens."""
    from services.nav_twr import NavReconstructionError

    ctx, capture = _sfox_ctx()
    patches = _sfox_branch_patches(
        ctx,
        bh_return=[_bh_row("2026-01-01", "1000"), _bh_row("2026-01-02", "1010")],
        txn_return=[],
        key_mode=False,
    )
    with _apply(patches), patch(
        "services.broker_dailies.combine_sfox_balance_history",
        new=MagicMock(
            side_effect=NavReconstructionError("orphan flow outside the window")
        ),
    ):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"  # NOT transient/unknown retry-forever
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps and stamps[0][1]["computation_status"] == "failed"


# --- happy path: rides the SHARED backbone (ONE-path, no clobber) -----------
async def test_sfox_happy_path_rides_shared_derive_persist_cash_series():
    """SFOX-05: a fixture NAV+flows crawl → combine_sfox_balance_history →
    the UNCHANGED derive_basis_series/persist_basis_series. Proven by capturing
    persist_basis_series: a cash_settlement basis row with a non-None result is
    persisted (the sfox returns rode the shared backbone). combine and derive run
    FOR REAL — no parallel path."""
    ctx, _capture = _sfox_ctx()
    nav_rows = [
        _bh_row("2026-01-01", "1000"),
        _bh_row("2026-01-02", "1010"),
        _bh_row("2026-01-03", "1020"),
        _bh_row("2026-01-04", "1030"),
    ]
    persisted: list[tuple] = []

    def _capture_persist(_supabase, _sid, *, basis, result):
        persisted.append((basis, result))

    patches = _sfox_branch_patches(
        ctx, bh_return=nav_rows, txn_return=[], key_mode=False
    )
    with _apply(patches), patch(
        "services.basis_series.persist_basis_series", new=_capture_persist
    ):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.DONE
    cash = [(b, r) for (b, r) in persisted if b == "cash_settlement"]
    assert cash, "sfox returns must ride the shared cash_settlement derive/persist"
    assert cash[0][1] is not None, "a real cash basis series result was persisted"


async def test_sfox_native_returns_not_clobbered_by_ccxt_combine():
    """The money-critical :2645 fix: combine_realized_and_funding (the ccxt
    USD-space combine) must NEVER run for sfox — it would OVERWRITE the native
    reconstructed returns with an empty realized/funding stream. Neuter the
    _NATIVE_RETURNS_VENUES guard (revert to `!= 'deribit'`) → this reddens."""
    ctx, _capture = _sfox_ctx()
    nav_rows = [
        _bh_row("2026-01-01", "1000"),
        _bh_row("2026-01-02", "1010"),
        _bh_row("2026-01-03", "1020"),
    ]
    patches = _sfox_branch_patches(
        ctx, bh_return=nav_rows, txn_return=[], key_mode=False
    )
    with _apply(patches), patch(
        "services.broker_dailies.combine_realized_and_funding",
        new=MagicMock(side_effect=AssertionError(
            "combine_realized_and_funding must NOT run for sfox (native returns)"
        )),
    ), patch(
        "services.basis_series.persist_basis_series", new=MagicMock()
    ):
        result = await run_derive_broker_dailies_job(_job(key_mode=False))
    assert result.outcome == DispatchOutcome.DONE


def test_sfox_rows_to_usd_value_series_fails_loud_on_garbage():
    """The NAV parse coerces fail-loud on a garbage usd_value — never silently
    0.0 (which would fabricate NAV)."""
    good = _sfox_rows_to_usd_value_series(
        [_bh_row("2026-01-01", "1000"), _bh_row("2026-01-02", "1010")]
    )
    assert list(good.to_numpy()) == [1000.0, 1010.0]
    with pytest.raises(SfoxFlowValuationError):
        _sfox_rows_to_usd_value_series([_bh_row("2026-01-01", "not-a-number")])


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf", "Infinity", float("nan"), float("inf")])
def test_sfox_rows_to_usd_value_series_fails_loud_on_non_finite_f7(bad):
    """F7 (P120 red-team): float('nan')/float('inf') SUCCEED, so a non-finite
    usd_value would slip through as a poisoned NAV point — silently corrupting the
    whole TWR denominator chain — despite the parse docstring promising to fail
    loud on it. A non-finite NAV point must RAISE (never coerce, never propagate)."""
    with pytest.raises(SfoxFlowValuationError, match="non-finite"):
        _sfox_rows_to_usd_value_series([_bh_row("2026-01-01", bad)])


# --- source-scan gates: ONE-path + wait_for bound --------------------------
def _stripped_job_worker_source() -> str:
    """job_worker.py with full-line comments stripped (the grep-gate hygiene
    rule) so a call site inside a comment never counts."""
    text = Path(jw.__file__).read_text()
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )


def test_one_path_derive_basis_series_call_sites_unchanged():
    """ONE-path proof: the sfox branch adds ZERO new backbone call sites — the
    comment-stripped job_worker.py contains exactly the 4 pre-phase
    derive_basis_series( call sites."""
    stripped = _stripped_job_worker_source()
    assert stripped.count("derive_basis_series(") == 4


def test_sfox_branch_has_two_bounded_crawls():
    """FLIPRETRY-01: the sfox branch wraps BOTH live crawls in asyncio.wait_for.
    Slice the branch region and count the bounds (>=2)."""
    text = Path(jw.__file__).read_text()
    start = text.index('elif venue == "sfox":')
    # The branch ends at the trailing `else:` (the ccxt arm).
    end = text.index("\n        else:", start)
    branch = text[start:end]
    assert branch.count("asyncio.wait_for(") >= 2
    assert 'crawl_sfox_balance_history' in branch
    assert 'crawl_sfox_transactions' in branch


def test_native_returns_venues_guard_defined_and_used():
    """The _NATIVE_RETURNS_VENUES set is defined AND used at the combine guard
    (definition + the :2645 guard = >=2 comment-stripped references)."""
    stripped = _stripped_job_worker_source()
    assert stripped.count("_NATIVE_RETURNS_VENUES") >= 2
