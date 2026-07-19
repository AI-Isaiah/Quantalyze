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
    """action→sign map (deposit +, withdraw −, credit +, charge −); same-UTC-day
    flows aggregate; buy/sell are internal rotations and are EXCLUDED; returns both
    the daily Series and the list[ExternalFlow] evidence."""
    txns = [
        {"id": 1, "action": "deposit", "currency": "USD", "amount": "1000", "timestamp": _ms("2026-01-02")},
        {"id": 2, "action": "withdraw", "currency": "USD", "amount": "300", "timestamp": _ms("2026-01-02")},
        {"id": 3, "action": "credit", "currency": "USD", "amount": "50", "timestamp": _ms("2026-01-03")},
        {"id": 4, "action": "charge", "currency": "USD", "amount": "20", "timestamp": _ms("2026-01-03")},
        {"id": 5, "action": "buy", "currency": "BTC", "amount": "0.1", "timestamp": _ms("2026-01-03")},
        {"id": 6, "action": "sell", "currency": "BTC", "amount": "0.1", "timestamp": _ms("2026-01-03")},
    ]

    series, evidence = sfox_flows_by_day(txns)

    d2 = pd.Timestamp("2026-01-02").as_unit("us")
    d3 = pd.Timestamp("2026-01-03").as_unit("us")
    # 2026-01-02: +1000 (deposit) − 300 (withdraw) = +700
    # 2026-01-03: +50 (credit) − 20 (charge) = +30 ; buy/sell EXCLUDED
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
