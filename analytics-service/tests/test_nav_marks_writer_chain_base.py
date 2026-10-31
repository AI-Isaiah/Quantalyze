"""Phase 167.2.1.1.1 NAVMTM plan 21 - the first mark's base is the writer's own level the day before (gap G-01, D-25, D-26).

What G-01 was
-------------
``apply_marks`` rule 3 took the first mark's base from that mark's own wallet (``w_S - P_S - F_S``
on the day-P&L roll, ``(w_S - F_S) / (1 + r_S)`` on the returns roll). The wallet is read some
hours after the day boundary, so it differs from the writer's realized level at the end of ``S-1``
by ``delta``: open profit is not in it, but whatever the account realized between the boundary and
the read is. In key mode the joined writer basis (the pre-start writer P&L plus ``writer_day_pnl``)
then telescopes back to ``w_S - L_real(S)`` instead of to the realized chain, and the compose
carries that one constant back to inception, where ``replay_key_equity``'s zero-start check reads
it as unfunded capital: ``inception_unreconciled``. Every round-trip fixture of the phase set the
first mark's wallet equal to the realized level (``delta == 0`` by construction), so none could see
it.

The decisions this module pins
------------------------------
D-25 (founder 2026-10-31): "For MT5 and Deribit keys, which carry a full history and the writer
basis, ``apply_marks`` rule 3 takes the first mark's base from the writer's own realized level on
the day before marks start (S-1), the level the pre-start rows are already chained to. It no
longer takes it from the mark's wallet (``w_S - P_S - F_S``)."
D-26 (founder 2026-10-31): "The ``returns`` arm of rule 3 (strategy mode) gets the same fix in the
same plan, so one rule holds in both modes and the boundary move is not dropped from published
strategy returns."
D-04's reason: the cumulative return over the marked series must equal the change in NAV. The first
marked day books the whole boundary move once (open profit, what was realized between the day
boundary and the read, a price move to the read), so with no flow after funding the product of
``(1 + r)`` is ``M_last / L_start``.

Oracles
-------
Every expected number is typed beside its arithmetic from this module's own fixtures, or is the
levels of the no-marks compose of the same deals. None is the code under test.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
import pytest

from services.external_flows import FlowInstant
from services.job_worker import DispatchOutcome
from services.nav_marks_apply import AppliedMark, MarkApplyRefusal, apply_marks
from tests.test_mt5_derive_branch import (  # noqa: F401  (autouse: clears the terminal registry)
    _reset_mt5_terminal_locks,
)
from tests.test_nav_marks_allocated import (
    MARKS as ALLOCATED_MARKS,
    R_0306,
    R_0307,
    config,
    derive_allocated,
    seeded,
)
from tests.test_nav_marks_compose_roundtrip import (
    BTC_CLOSE,
    BTC_MARKS_NATIVE,
    BTC_WALLET_NATIVE,
    KEY_DRB,
    KEY_MT5,
    MT5_ACCOUNT,
    OKX_FLOW,
    OKX_FLOW_DAY,
    OKX_MARKS,
    OKX_TERMINAL,
    KeyDb,
    _mt5_deals_with,
    assert_levels,
    assert_same_before,
    assert_trustworthy,
    btc_closes,
    compose_curve,
    derive_deribit_key,
    derive_mt5_key,
    levels,
    realized_day_pnl,
    realized_levels,
    seed_deribit_marks,
)
from tests.test_nav_marks_composite import MARKS_KEY2, run_deribit_composite, stored
from tests.test_nav_marks_composite_allocated import (
    MARKS as COMPOSITE_ALLOCATED_MARKS,
    run_allocated_composite,
)
from tests.test_nav_marks_derive_apply import (
    REALIZED_THROUGH_0305,
    assert_ccxt_literals,
    assert_mt5_literals,
    assert_rolls_back_to_every_mark,
    at_0010,
    run_deribit,
    run_mt5,
    seed_mark,
)
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    _real_marks_writer,
)

# --------------------------------------------------------------------------------------
# Task 1 - the tracer: an MT5 USD key funded at inception, first mark read after the boundary
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mt5_usd_key_first_mark_read_after_the_boundary_keeps_inception_reconciled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G-01, D-25, D-04, through the real key-mode derive and the real compose. The account is
    funded from zero by a 95_000 deposit on 2025-06-01, so the compose's zero-start check runs on
    it. The writer's level at the end of 10-05 is 105_500 (balance 110_500, less the 5000 deposit
    on 10-07). The first mark (10-06, NAV 105_550, open profit 100.0) has a wallet of 105_450, 50
    BELOW that level: what the account realized between the day boundary and the read.

    The boundary move is booked once, from the writer's level:
      r(10-06) = (105_550 - 105_500) / 105_500 = 50 / 105_500
    and it does not depend on the open profit the mark stores. Read from the wallet (the shipped
    rule) the base is 105_450, r(10-06) is 100 / 105_450, and the writer basis telescopes 50 away
    from the realized chain, which the zero-start check reads as ``inception_unreconciled``."""
    db = KeyDb()
    seed_mark(db, "2026-10-06", 105_550.0, key=KEY_MT5, venue="mt5", open_pnl=100.0,
              native_unit="USD")
    seed_mark(db, "2026-10-08", 110_600.0, key=KEY_MT5, venue="mt5", open_pnl=100.0,
              native_unit="USD")
    deals = _mt5_deals_with({(2025, 6, 1): 95_000.0, (2026, 10, 7): 5000.0})
    result, capture = await derive_mt5_key(monkeypatch, db, account=MT5_ACCOUNT, deals=deals)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    assert "inception_unreconciled" not in payload["degrade_reasons"], payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert db.rows(KEY_MT5)["2026-10-06"] == pytest.approx(50.0 / 105_500.0, abs=1e-12)
    curve = levels(payload)
    base_db = KeyDb()
    _r, base_cap = await derive_mt5_key(
        monkeypatch, base_db, account=MT5_ACCOUNT, deals=deals, apply_nothing=True
    )
    assert_same_before(
        curve, levels(await compose_curve(base_db, base_cap, key=KEY_MT5, venue="mt5")),
        "2026-10-06",
    )
    assert_levels(curve, {"2026-10-06": 105_550.0, "2026-10-08": 110_600.0})


# --------------------------------------------------------------------------------------
# Task 2 - strategy mode, the allocated twin and composite Deribit members (D-26)
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("first_wallet", [980.0, 1020.0], ids=["below", "above"])
async def test_deribit_strategy_first_mark_books_the_whole_boundary_move(
    first_wallet: float,
) -> None:
    """D-26, Deribit strategy mode on the NAV path. The writer's level at the end of 03-05 is
    1000.0. The first mark (03-06, NAV 1050.0) has a wallet 20.0 below or above it, so its open
    profit is 70.0 or 30.0. The boundary move is booked once from the writer's level:
      r(03-06) = (1050 - 1000) / 1000 = 0.05
    and, with the 03-07 gap-day deposit of 50 in the base, r(03-08) = (1120 - 1100) / 1100. Read
    from the wallet, r(03-06) would be 70 / 980 or 30 / 1020."""
    run = await run_deribit(first_wallet=first_wallet)
    assert_ccxt_literals(run)
    assert_rolls_back_to_every_mark(run)


@pytest.mark.asyncio
@pytest.mark.parametrize("btc", [False, True], ids=["usd", "btc"])
async def test_mt5_strategy_first_mark_books_the_whole_boundary_move(
    monkeypatch: pytest.MonkeyPatch, btc: bool,
) -> None:
    """D-26, MT5 strategy mode, USD and native BTC. The writer's level at the end of the day
    before the first mark is 105_500 (USD) / 0.1085 BTC. The seeded first mark has open profit 70.0
    (USD) / 0.0007 BTC, so its wallet is 20.0 / 0.0002 BTC BELOW that level. r(first) is still
    50 / 105_500 (0.0005 / 0.1085 BTC): the boundary move is booked once from the writer's level and
    does not depend on the open profit the mark stores."""
    run = await run_mt5(monkeypatch, btc=btc, first_open=0.0007 if btc else 70.0)
    assert_mt5_literals(run, btc=btc)
    assert_rolls_back_to_every_mark(run)


@pytest.mark.asyncio
async def test_allocated_deribit_strategy_base_comes_from_the_twin_chain() -> None:
    """D-26, D-14. An allocated-capital Deribit strategy takes its base from the NAV twin's own
    chain: terminal 2000.0 on 03-07 less the twin's day P&L (20.0, 5.0) and deposit (100.0) is
    1875.0 at the end of 03-05. The first mark's wallet is 2025.0 (150.0 above the twin's level on
    its own day), which must not matter: r(03-06) = (1900 - 1875 - 100) / 1875 = -0.04."""
    run = await derive_allocated(
        seeded(ALLOCATED_MARKS, first_wallet=2025.0), cfg=config(), now_day="2026-03-08"
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert run.rows["2026-03-06"] == pytest.approx(R_0306, abs=1e-12)
    assert run.rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)


@pytest.mark.asyncio
async def test_deribit_composite_member_base_comes_from_the_writer_chain() -> None:
    """D-26, a composite's Deribit member (cash basis). Its realized terminal is 1000.0 on 03-05.
    The first mark (03-06, NAV 1050.0) has open profit 80.0, a wallet of 970.0, 30.0 below that
    level. r(03-06) = (1050 - 1000) / 1000 = 0.05, as in
    ``test_deribit_member_marks_apply_to_cash_only``."""
    run, _ctxs = await run_deribit_composite(
        marks={"key-2": [stored("2026-03-06", 1050.0, open_pnl=80.0), *MARKS_KEY2[1:]]}
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert run.csv_rows()["2026-03-06"] == pytest.approx(0.05, abs=1e-12)


@pytest.mark.asyncio
async def test_allocated_composite_member_base_comes_from_the_twin_chain() -> None:
    """D-26, D-14, an allocated composite's Deribit member. Its NAV twin's chain gives 1875.0 at
    the end of 03-05. The first mark's open profit is -65.0 (wallet 1965.0, not the 1995.0 of the
    shared fixture), which must not matter: r(03-06) = -0.04 and r(03-07) = 10 / 1900, as
    ``test_allocated_composite_deribit_member_follows_marked_nav`` asserts."""
    marks = [
        stored("2026-03-06", 1900.0, venue="deribit", open_pnl=-65.0),
        COMPOSITE_ALLOCATED_MARKS[1],
    ]
    out = await run_allocated_composite(marks={"key-2": marks})
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    rows = out.run.csv_rows()
    assert rows["2026-03-06"] == pytest.approx(-0.04, abs=1e-12)
    assert rows["2026-03-06"] == pytest.approx(R_0306, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)


# --------------------------------------------------------------------------------------
# Task 3 - the key-mode matrix, the CR-01 guards and the rule's unit cases
# --------------------------------------------------------------------------------------


async def _mt5_usd_key_scenario(
    monkeypatch: pytest.MonkeyPatch, *, first_open: float
) -> tuple[KeyDb, Any]:
    """The tracer's account (funded from zero by a 95_000 deposit on 2025-06-01, writer level
    105_500 at the end of 10-05) with the first mark's open profit ``first_open``: its wallet is
    ``105_550 - first_open``. Returns the db and the derive's capture."""
    db = KeyDb()
    seed_mark(db, "2026-10-06", 105_550.0, key=KEY_MT5, venue="mt5", open_pnl=first_open,
              native_unit="USD")
    seed_mark(db, "2026-10-08", 110_600.0, key=KEY_MT5, venue="mt5", open_pnl=100.0,
              native_unit="USD")
    deals = _mt5_deals_with({(2025, 6, 1): 95_000.0, (2026, 10, 7): 5000.0})
    result, capture = await derive_mt5_key(monkeypatch, db, account=MT5_ACCOUNT, deals=deals)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return db, capture


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "band_multiple", [0.0, 0.99, -0.99, 1.01, -1.01],
    ids=["zero", "inside_up", "inside_down", "outside_up", "outside_down"],
)
async def test_mt5_usd_key_band_edge_neighbours_book_the_boundary_once(
    monkeypatch: pytest.MonkeyPatch, band_multiple: float
) -> None:
    """D-25 on both sides of the zero-start band (1e-4 of the compose's level on the key's first
    return day, ``allocator_equity_derive._INCEPTION_ZERO_START_BAND``). The first mark's wallet is
    the writer's 105_500 plus ``band_multiple`` bands. The band is read off the no-marks compose of
    the same deals (this test's own oracle). Whatever the wallet, the key composes clean and the
    first marked day books the move from the writer's level, 50 / 105_500. Under the wallet base only
    ``zero`` would hold: a wallet 0.99 band off reads trustworthy and still books the wrong return,
    and 1.01 bands off reads ``inception_unreconciled``."""
    base_db = KeyDb()
    deals = _mt5_deals_with({(2025, 6, 1): 95_000.0, (2026, 10, 7): 5000.0})
    _r, base_cap = await derive_mt5_key(
        monkeypatch, base_db, account=MT5_ACCOUNT, deals=deals, apply_nothing=True
    )
    base_curve = levels(await compose_curve(base_db, base_cap, key=KEY_MT5, venue="mt5"))
    first_return_day = min(base_db.rows(KEY_MT5))
    band = 1e-4 * base_curve[first_return_day]
    wallet = 105_500.0 + band_multiple * band
    db, capture = await _mt5_usd_key_scenario(monkeypatch, first_open=105_550.0 - wallet)
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    assert "inception_unreconciled" not in payload["degrade_reasons"], payload["degrade_reasons"]
    assert_trustworthy(payload)
    assert db.rows(KEY_MT5)["2026-10-06"] == pytest.approx(50.0 / 105_500.0, abs=1e-12)
    assert_same_before(levels(payload), base_curve, "2026-10-06")


@pytest.mark.asyncio
@pytest.mark.parametrize("wallet_offset", [0.0, -0.0002], ids=["zero", "below"])
async def test_mt5_btc_key_first_mark_off_the_writer_level_keeps_inception_reconciled(
    monkeypatch: pytest.MonkeyPatch, wallet_offset: float
) -> None:
    """G-01 for an MT5 key in BTC, converted to dollars at the stored closes. The account is
    funded from zero by a 0.098 BTC deposit on 2025-06-01 (0.095 does not fund the scaled ledger),
    so the zero-start check runs. The writer's level at the end of 10-04 is 0.1085 BTC. The first
    mark (10-05, NAV 0.1090) has its wallet 0.0002 BTC below that level in the ``below`` case. In
    both: trustworthy and r(10-05) = 0.0005 / 0.1085, the move from the writer's level."""
    deals = _mt5_deals_with({(2025, 6, 1): 0.098, (2026, 10, 6): 0.002}, scale=1e-6)
    account = {"equity": 0.1115, "balance": 0.1105, "currency": "BTC", "login": 123456}
    db = KeyDb()
    for k, (day, native) in enumerate(BTC_MARKS_NATIVE.items()):
        wallet = BTC_WALLET_NATIVE[day] + (wallet_offset if k == 0 else 0.0)
        seed_mark(
            db, day, native * BTC_CLOSE, key=KEY_MT5, venue="mt5",
            open_pnl=(native - wallet) * BTC_CLOSE, native_unit="BTC", nav_native=native,
            open_pnl_native=native - wallet,
        )
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, closes=btc_closes()
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    assert "inception_unreconciled" not in payload["degrade_reasons"], payload["degrade_reasons"]
    assert_trustworthy(payload)
    assert db.rows(KEY_MT5)["2026-10-05"] == pytest.approx(0.0005 / 0.1085, abs=1e-9)
    base_db = KeyDb()
    _r, base_cap = await derive_mt5_key(
        monkeypatch, base_db, account=account, deals=deals, closes=btc_closes(),
        apply_nothing=True,
    )
    assert_same_before(
        levels(payload), levels(await compose_curve(base_db, base_cap, key=KEY_MT5, venue="mt5")),
        "2026-10-05",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "wallet_offset", [0.0, 0.05, -5.0], ids=["zero", "inside", "outside"]
)
async def test_deribit_key_from_inception_first_mark_off_the_writer_level_reconciles(
    wallet_offset: float,
) -> None:
    """G-01 for a Deribit key whose writer chain starts at a funding day (02-28, day P&L 0.0, the
    composed flow equal to the realized level there), so the zero-start check runs. The writer's
    level at the end of 03-05 is 1000.0 and the first mark's wallet is that plus ``wallet_offset``:
    0.05 is inside the band (0.0996) and 5.0 below it is outside. Whatever the wallet: trustworthy,
    r(03-06) = 0.05 from the writer's level, and every level from 03-01 through 03-05 is the one
    this module rolls back from the terminal. Inside the band the wallet base reads trustworthy and
    still books the wrong first return."""
    realized = realized_levels(REALIZED_THROUGH_0305, "2026-03-05", OKX_TERMINAL, {})
    funding = realized["2026-03-01"] / (1.0 + REALIZED_THROUGH_0305["2026-03-01"])
    db = KeyDb()
    for k, (day, nav) in enumerate(OKX_MARKS.items()):
        wallet = OKX_TERMINAL + (wallet_offset if k == 0 else 0.0)
        seed_mark(db, day, nav, key=KEY_DRB, venue="deribit", open_pnl=nav - wallet,
                  native_unit=None)
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1215.0, collapsed_upnl=215.0, now=at_0010("2026-03-11"),
        day_pnl={
            "2026-02-28": 0.0,
            **realized_day_pnl(REALIZED_THROUGH_0305, "2026-03-05", OKX_TERMINAL),
        },
        composed_flows={"2026-02-28": funding, OKX_FLOW_DAY: OKX_FLOW},
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
    assert "inception_unreconciled" not in payload["degrade_reasons"], payload["degrade_reasons"]
    assert_trustworthy(payload)
    assert db.rows(KEY_DRB)["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    curve = levels(payload)
    assert_levels(curve, {d: v for d, v in realized.items() if "2026-03-01" <= d <= "2026-03-05"})
    assert_levels(curve, OKX_MARKS)


@pytest.mark.asyncio
async def test_two_consecutive_mt5_key_derives_store_a_byte_identical_first_return(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CR-01 under D-25, MT5. Derive A is the tracer's scenario. Derive B runs on the same db a day
    later, after a 2000.0 deposit made at 12:00 on 10-09 (after the 10-08 mark's read), so its
    ledger GROWS (balance 112_500) and it writes its own 10-09 mark at NAV 112_700. Its open profit
    (200.0) differs from A's (100.0) on purpose: the realized balance moves only by the deposit
    while the live equity moves by more, so a base read from the live equity would move between the
    two derives. The writer's own level at the end of 10-05 does not move when the ledger grows, so
    the first marked day's return is the same float."""
    db, _capture = await _mt5_usd_key_scenario(monkeypatch, first_open=100.0)
    first = db.rows(KEY_MT5)["2026-10-06"]
    grown = _mt5_deals_with({
        (2025, 6, 1): 95_000.0, (2026, 10, 7): 5000.0, (2026, 10, 9): 2000.0,
    })
    result, _cap = await derive_mt5_key(
        monkeypatch, db, account={**MT5_ACCOUNT, "equity": 112_700.0, "balance": 112_500.0},
        deals=grown, now=datetime(2026, 10, 10, 10, 0, tzinfo=timezone.utc),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks[(KEY_MT5, "2026-10-09")]["open_pnl_usd"] == 200.0, "derive B wrote its own mark"
    assert db.rows(KEY_MT5)["2026-10-06"] == first


@pytest.mark.asyncio
async def test_two_consecutive_deribit_key_derives_store_a_byte_identical_first_return() -> None:
    """CR-01 under D-25, Deribit. Derive A reads a live wallet of 1000.0 (collapsed equity 1215.0
    less 215.0 of open profit). Derive B, a day later, reads 1100.0 (1300.0 less 200.0): the live
    wallet moved 100.0, the ledger did not. The first marked day's base is the writer's own level
    from the ledger, so the stored first return is the same float after both derives."""
    db = KeyDb()
    seed_deribit_marks(db)
    result, _cap = await derive_deribit_key(
        db, collapsed_equity=1215.0, collapsed_upnl=215.0, now=at_0010("2026-03-11")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    first = db.rows(KEY_DRB)["2026-03-06"]
    result, _cap = await derive_deribit_key(
        db, collapsed_equity=1300.0, collapsed_upnl=200.0, now=at_0010("2026-03-12")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert (KEY_DRB, "2026-03-11") in db.marks, "derive B wrote its own mark"
    assert db.rows(KEY_DRB)["2026-03-06"] == first


# --------------------------------------------------------------------------------------
# The rule on its own: a synthetic writer chain from inception
# --------------------------------------------------------------------------------------
#
# Days from 2023-06-27 (day 0), a 30_000.0 deposit on day 0, day P&L 0.0 on day 0 and then 37.5
# when the index is a multiple of 3 and -12.25 otherwise. Levels are the forward sum
# ``L(d) = L(d-1) + P_d + F_d`` and the daily return is ``P_d / L(d-1)``. Every amount is a multiple
# of 0.25, so each sum below is exact in floating point and ``==`` states the rule, not rounding.

_DAY0 = date(2023, 6, 27)
_OPEN_PROFIT = 250.0


def _iso(k: int) -> str:
    return (_DAY0 + timedelta(days=k)).isoformat()


class _Chain:
    """The writer's own P&L, flows, levels and realized returns for days ``0 .. last``."""

    def __init__(self, last: int, extra_flows: dict[int, float] | None = None) -> None:
        self.flows: dict[int, float] = {0: 30_000.0, **(extra_flows or {})}
        self.pnl: dict[int, float] = {
            k: (0.0 if k == 0 else (37.5 if k % 3 == 0 else -12.25)) for k in range(last + 1)
        }
        self.level: dict[int, float] = {}
        previous = 0.0
        for k in range(last + 1):
            previous = previous + self.pnl[k] + self.flows.get(k, 0.0)
            self.level[k] = previous
        self.returns = pd.Series(
            [self.pnl[k] / self.level[k - 1] for k in range(1, last + 1)],
            index=pd.DatetimeIndex([pd.Timestamp(_iso(k)) for k in range(1, last + 1)]),
            dtype="float64",
        )

    def day_pnl(self) -> dict[str, float]:
        return {_iso(k): v for k, v in self.pnl.items()}

    def flows_by_day(self) -> dict[str, float]:
        return {_iso(k): v for k, v in self.flows.items()}

    def terminal(self, k: int) -> tuple[str, float]:
        return (_iso(k), self.level[k])


def _mark(k: int, nav: float, open_pnl: float = _OPEN_PROFIT) -> AppliedMark:
    """A mark of day ``k``, read at 00:10Z of the next UTC day."""
    d = _DAY0 + timedelta(days=k + 1)
    return AppliedMark(
        _iso(k), nav, open_pnl, datetime(d.year, d.month, d.day, 0, 10, tzinfo=timezone.utc)
    )


@pytest.mark.parametrize(
    ("roll_basis", "delta"),
    [
        ("day_pnl", -50.0), ("day_pnl", 0.0), ("day_pnl", 2.0),
        ("returns", -50.0), ("returns", 0.0), ("returns", 2.0),
    ],
    ids=[
        "day_pnl-below", "day_pnl-zero", "day_pnl-above",
        "returns-below", "returns-zero", "returns-above",
    ],
)
def test_writer_chain_base_is_the_writers_own_level_the_day_before(
    roll_basis: str, delta: float
) -> None:
    """D-25 (``day_pnl`` arm) and D-26 (``returns`` arm). The first mark is on day 28 with open
    profit 250.0 and a wallet ``delta`` away from the writer's level on day 28. The base is the
    writer's own level the day before, ``L(27)``, whatever ``delta`` is, in both roll bases:
      r(28) = (M_28 - L(27)) / L(27)
    from the fixture's own levels."""
    chain = _Chain(30)
    nav = chain.level[28] + delta + _OPEN_PROFIT
    out = apply_marks(
        chain.returns.iloc[:29], {_iso(0): 30_000.0}, [_mark(28, nav), _mark(29, nav + 100.0)],
        day_pnl=chain.day_pnl(), roll_basis=roll_basis,  # type: ignore[arg-type]
        writer_terminal=chain.terminal(29),
    )
    expected = (nav - chain.level[27]) / chain.level[27]
    assert out.returns[pd.Timestamp(_iso(28))] == pytest.approx(expected, rel=1e-12)
    assert out.writer_day_pnl[_iso(28)] == nav - chain.level[27]


def test_writer_chain_base_reads_nothing_from_the_first_marks_wallet() -> None:
    """The base is the writer's, so the open profit the mark stores (and with it the wallet
    ``nav - open_pnl``) cannot reach the first return: open profit 0.0, 250.0 and 5000.0 at a
    fixed NAV give equal first returns, in both roll bases."""
    chain = _Chain(30)
    nav = chain.level[28] + 400.0
    for roll_basis in ("day_pnl", "returns"):
        firsts = [
            apply_marks(
                chain.returns.iloc[:29], {_iso(0): 30_000.0},
                [_mark(28, nav, open_pnl), _mark(29, nav + 100.0)],
                day_pnl=chain.day_pnl(), roll_basis=roll_basis,  # type: ignore[arg-type]
                writer_terminal=chain.terminal(29),
            ).returns[pd.Timestamp(_iso(28))]
            for open_pnl in (0.0, 250.0, 5000.0)
        ]
        assert firsts[0] == firsts[1] == firsts[2]
        assert firsts[0] == (nav - chain.level[27]) / chain.level[27]


@pytest.mark.parametrize("roll_basis", ["day_pnl", "returns"], ids=["day_pnl", "returns"])
def test_writer_chain_cumulative_return_equals_the_nav_change(roll_basis: str) -> None:
    """D-04. The pre-start rows chain from the funding deposit to ``L(27)`` and the two marked rows
    chain from ``L(27)`` to the last mark's NAV, so the product of ``(1 + r)`` over every output row
    less one is ``M_last / 30_000 - 1``: the cumulative return is the change in NAV. Non-vacuity:
    with the mark's wallet 50.0 off the writer's level and no writer terminal, the wallet base
    misses that by more than 1e-6 relative."""
    chain = _Chain(30)
    nav_28 = chain.level[28] - 50.0 + _OPEN_PROFIT
    nav_29 = nav_28 + 100.0
    kwargs: dict[str, Any] = dict(
        day_pnl=chain.day_pnl(), roll_basis=roll_basis,
    )
    marks = [_mark(28, nav_28), _mark(29, nav_29)]
    flows = {_iso(0): 30_000.0}
    with_terminal = apply_marks(
        chain.returns.iloc[:29], flows, marks, writer_terminal=chain.terminal(29), **kwargs
    )
    target = nav_29 / 30_000.0 - 1.0
    assert float((1.0 + with_terminal.returns).prod() - 1.0) == pytest.approx(target, rel=1e-12)
    without = apply_marks(chain.returns.iloc[:29], flows, marks, **kwargs)
    assert abs(float((1.0 + without.returns).prod() - 1.0) - target) > 1e-6 * abs(target)


def test_writer_chain_first_return_is_final_when_the_ledger_grows() -> None:
    """CR-01 under D-25 at the rule. A first call has its terminal on day 29. A second call runs
    after the ledger grew by one day (P 37.5 and a 250.0 flow on day 30), so its terminal is on
    day 30 and it carries a third mark. The writer's level at the end of day 27 is the same, so the
    first marked day's return and writer P&L are equal."""
    first_chain = _Chain(29)
    grown = _Chain(30, extra_flows={30: 250.0})
    assert grown.level[29] == first_chain.level[29]
    nav_28 = first_chain.level[28] - 50.0 + _OPEN_PROFIT
    marks = [_mark(28, nav_28), _mark(29, nav_28 + 100.0)]
    flows = {_iso(0): 30_000.0}
    one = apply_marks(
        first_chain.returns, flows, marks, day_pnl=first_chain.day_pnl(), roll_basis="day_pnl",
        writer_terminal=first_chain.terminal(29),
    )
    two = apply_marks(
        grown.returns, {**flows, _iso(30): 250.0}, [*marks, _mark(30, nav_28 + 700.0)],
        day_pnl=grown.day_pnl(), roll_basis="day_pnl", writer_terminal=grown.terminal(30),
    )
    day = pd.Timestamp(_iso(28))
    assert two.returns[day] == one.returns[day]
    assert two.writer_day_pnl[_iso(28)] == one.writer_day_pnl[_iso(28)]


def test_writer_chain_rolls_over_the_writers_own_flows_not_the_placed_ones() -> None:
    """Rule 10 and D-23. The writer has a 500.0 flow on day 29, its terminal's day, and a flow
    instant dated day 29 made before the day-28 mark's read moves it into day 28 (valued at its
    prior-day amount, 480.0). The writer's level obeys the writer's own flow day, so the roll back to
    day 27 subtracts that 500.0 on day 29, not the placed 480.0 on day 28:
      r(28) = (M_28 - L(27) - 480.0) / L(27)."""
    chain = _Chain(29, extra_flows={29: 500.0})
    nav_28 = chain.level[28] + 480.0 + _OPEN_PROFIT
    read = datetime(*(_DAY0 + timedelta(days=29)).timetuple()[:3], 0, 5, tzinfo=timezone.utc)
    instant = FlowInstant(int(read.timestamp() * 1000), _iso(29), 500.0, "USD", 480.0)
    out = apply_marks(
        chain.returns, chain.flows_by_day(), [_mark(28, nav_28), _mark(29, nav_28 + 600.0)],
        day_pnl=chain.day_pnl(), roll_basis="day_pnl", flow_instants=[instant],
        writer_terminal=chain.terminal(29),
    )
    assert out.flow_moves == {_iso(28): 480.0}
    expected = (nav_28 - chain.level[27] - 480.0) / chain.level[27]
    assert out.returns[pd.Timestamp(_iso(28))] == pytest.approx(expected, rel=1e-12)


def test_writer_terminal_before_the_day_before_start_carries_the_level_forward() -> None:
    """The writer's chain stops on day 25 (terminal ``L(25)``), a 100.0 flow lands on day 26 and
    the first mark is on day 28. Nothing else happens on days 26 and 27, so the level at the end of
    day 27 is ``L(25) + 100.0`` and r(28) = (M_28 - that) / that."""
    chain = _Chain(25)
    carried = chain.level[25] + 100.0
    nav_28 = carried + 90.0
    out = apply_marks(
        chain.returns, {**chain.flows_by_day(), _iso(26): 100.0}, [_mark(28, nav_28)],
        day_pnl=chain.day_pnl(), roll_basis="day_pnl", writer_terminal=chain.terminal(25),
    )
    assert out.returns[pd.Timestamp(_iso(28))] == pytest.approx(
        (nav_28 - carried) / carried, rel=1e-12
    )


def test_writer_terminal_needs_day_pnl() -> None:
    """A writer terminal without a day P&L is a programming error of the caller, not a refusal."""
    chain = _Chain(29)
    with pytest.raises(ValueError, match="writer_terminal needs day_pnl"):
        apply_marks(
            chain.returns, chain.flows_by_day(), [_mark(28, 40_000.0)],
            writer_terminal=chain.terminal(29),
        )


@pytest.mark.parametrize(
    "terminal", [(_iso(29), float("nan")), ("2023-7-25", 40_000.0)], ids=["nan_level", "bad_day"]
)
def test_a_malformed_writer_terminal_refuses(terminal: tuple[str, float]) -> None:
    """A terminal that is not a finite level on a canonical ISO day is refused like a malformed
    flow (rule 12): the closed token and no partial application."""
    chain = _Chain(29)
    with pytest.raises(MarkApplyRefusal) as excinfo:
        apply_marks(
            chain.returns, chain.flows_by_day(), [_mark(28, 40_000.0)],
            day_pnl=chain.day_pnl(), roll_basis="day_pnl", writer_terminal=terminal,
        )
    assert excinfo.value.token == "mark_input_nonfinite"
