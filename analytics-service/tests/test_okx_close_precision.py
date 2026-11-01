"""The OKX bills oracle's close arm within a trillionth (Phase 179 OKXBILLSCHAIN, plan 04, D-07).

WHY these tests exist (Rule 9): the close arm of ``per_ccy_opening`` (the newest bill's ``bal``
against today's ``cashBal``) is one of the three proofs that let a FORCED rebuild anchor a
curve that replaces stored history in a single write. Founder decision D-07 (2026-10-28,
"Trillionth bound only", superseding the decimal-places half of D-06) lets that close pass only
when the two balances are equal or differ by at most 1e-12 of the larger one, which is exactly
how a4's stable USDT chain read: every interior link exact, the close residual below one part
in a trillion. It is also the decision that could quietly turn the proof into a rubber stamp:
the decimal-places rule it replaced forgave 0.5 against 0.54 on a bill that printed one place.
So each test here can FAIL in a way that matters: one goes RED if the close goes back to exact
equality (a4 refuses again), the others go RED if the allowance widens (any close beyond 1e-12
relative, such as an 8% gap on a one-place print, anchors on an unproven opening) or if the
interior links, which stay exact Decimal equality, loosen. Every number is synthetic and every
expected opening is the test's own constant, never the cash balance and never a recomputation
by the module under test.
"""
from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

import pytest

import scripts.okx_chain_record as rec
from services import okx_bills_chain as chain
from services import okx_opening_balance as obal
from tests._okx_bills import OkxBillsArchive, okx_bill, okx_bill_chain, okx_detail
from tests.test_okx_opening_balance import OPENING_DAY, OPENING_MS, _exchange, _reach_bill, _row

# a4's reading shape: a stable USDT chain, every interior link exact, the newest bal printed at
# 16 places and today's cash at 18 (residual 4e-18, relative about 6.7e-23).
_A4_OPENING = "60000.0000000000000000"
_A4_CASH = "60000.750000000000000004"


async def test_a4s_close_below_one_part_in_a_trillion_proves_the_opening() -> None:
    """The oracle, RED on exact equality: the bills' chain is exact and only the close differs,
    by a residual far below 1e-12 relative. The
    opening is the oldest bill's ``bal`` minus its change (the test's own 60000), never the
    cash balance."""
    usdt = okx_bill_chain(
        "USDT", _A4_OPENING, ["-1.5000000000000000", "2.2500000000000000"],
        first_id=100, first_ts=OPENING_MS + 60_000,
    )
    exchange = _exchange(OkxBillsArchive([_reach_bill(), *usdt]))
    row = _row([okx_detail("USDT", _A4_CASH)])

    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)

    assert reading.unavailable_reason == "none", reading
    assert reading.opening_usd == 60000.0
    assert reading.bills_read == 2


# ---------------------------------------------------------------------------
# Task 2: the close bound at its edges, the exact interior arm
# ---------------------------------------------------------------------------


def _chain(rows: Sequence[tuple[str, str]]) -> list[dict[str, str]]:
    """USDT bills in ``billId`` order from (bal, balChg) pairs."""
    return [
        okx_bill(100 + i, OPENING_MS + 60_000 * (i + 1), "USDT", bal, chg)
        for i, (bal, chg) in enumerate(rows)
    ]


# (id, [(bal, balChg), ...] oldest first, cash text, expected opening or None for chain_break).
# The expected opening is the oldest bill's bal minus its balChg, written out as the test's own
# constant: the cash balance never enters it.
_CLOSE_WORLDS: list[tuple[str, list[tuple[str, str]], str, str | None]] = [
    ("four-places-gap-4e-9", [("12.34567890", "0")], "12.345678904", None),
    ("two-places-half-unit-gap", [("100.50", "0")], "100.505", None),
    ("one-place-8-percent-gap", [("0.5", "0")], "0.54", None),
    ("one-place-hundred-gap", [("100.5", "0")], "100.54", None),
    (
        "relative-arm-only-cash-coarser",
        [("60032.123456789012345678", "0")],
        "60032.1234567890123457",
        "60032.123456789012345678",
    ),
    ("relative-arm-exact-bound", [("1000000000000", "0")], "999999999999", "1000000000000"),
    ("relative-arm-just-over", [("1000000000000", "0")], "999999999998", None),
    ("a4-shape", [("60000.7500000000000000", "0")], "60000.750000000000000004", "60000.7500000000000000"),
    ("exact", [("1002", "0")], "1002", "1002"),
]


@pytest.mark.parametrize(
    ("rows", "cash", "expected"),
    [pytest.param(rows, cash, expected, id=world_id) for world_id, rows, cash, expected in _CLOSE_WORLDS],
)
def test_the_close_rule_at_its_edges(rows: list[tuple[str, str]], cash: str, expected: str | None) -> None:
    """D-07 pinned at its edges, fail closed: the only allowance is 1e-12 of the larger balance
    (inclusive); no decimal-places rule forgives a gap, however few places the bills print. A
    residual one step beyond the bound refuses, and an agreeing close yields the test's own
    opening, not the cash balance."""
    bills = _chain(rows)

    if expected is None:
        with pytest.raises(obal.OpeningUnavailable) as raised:
            obal.per_ccy_opening(bills, {"USDT": Decimal(cash)})
        assert raised.value.reason == "chain_break"
    else:
        openings = obal.per_ccy_opening(bills, {"USDT": Decimal(cash)})
        assert openings["USDT"] == Decimal(expected)


# The interior arm stays EXACT: each world's close is exact, so a refusal can only come from the
# interior link, however small its residual.
_INTERIOR_WORLDS: list[tuple[str, list[tuple[str, str]], str]] = [
    (
        "interior-below-relative-bound",
        [("1000000.0000000000", "0"), ("1000001.0000000001", "1.0000000000")],
        "1000001.0000000001",
    ),
    (
        "interior-below-half-a-print-unit",
        [("100.00", "0"), ("101.00", "1.004")],
        "101.00",
    ),
]


@pytest.mark.parametrize(
    ("rows", "cash"),
    [pytest.param(rows, cash, id=world_id) for world_id, rows, cash in _INTERIOR_WORLDS],
)
def test_an_interior_residual_of_the_allowed_size_still_breaks_the_chain(
    rows: list[tuple[str, str]], cash: str
) -> None:
    """A missing bill hides inside a link's residual, however small, so the interior arm takes
    NO allowance: D-06/D-07 relax the close only. A test that stayed green while the interior arm
    loosened would let a chain with a missing bill prove an opening."""
    with pytest.raises(obal.OpeningUnavailable) as raised:
        obal.per_ccy_opening(_chain(rows), {"USDT": Decimal(cash)})

    assert raised.value.reason == "chain_break"


def test_the_close_bound_and_the_reason_set_are_the_decided_values() -> None:
    """D-06/D-07 fix the bound and the reason set ("No new reason token"); D-08 (founder 2026-10-28,
    "Tighten to 2%") fixes the opening tolerance at 0.02. Each changes only by a founder decision
    recorded first, so a drift in either value, or a seventh token, must be a red test and not a
    quiet edit."""
    assert obal.CLOSE_RESIDUAL_REL_BOUND == Decimal("1e-12")
    assert obal.OPENING_TOLERANCE_REL == 0.02
    assert obal.OPENING_UNAVAILABLE_REASONS == frozenset(
        {"chain_break", "malformed_balance", "malformed_bills", "page_ceiling", "reach_unproven", "unpriced_ccy"}
    )


@pytest.mark.parametrize(
    ("bal", "cash"),
    [pytest.param("0.5", "0.54", id="half-vs-0.54"), pytest.param("100.5", "100.54", id="100.5-vs-100.54")],
)
def test_a_one_place_print_does_not_forgive_a_visible_gap(bal: str, cash: str) -> None:
    """SFH-179-04-01: a bill that prints one decimal place against a cash balance that prints
    two used to pass the close (the gap is under half a unit of the next place). D-07 deletes
    that rule: the oracle refuses ``chain_break`` and the diagnostic names the close arm, so an
    8% gap on a half-unit balance cannot anchor a rebuild that replaces stored history."""
    bills = _chain([(bal, "0")])
    cash_map = {"USDT": Decimal(cash)}

    with pytest.raises(obal.OpeningUnavailable) as raised:
        obal.per_ccy_opening(bills, cash_map)
    report = chain.analyse_chain(bills, cash_map)

    assert raised.value.reason == "chain_break"
    assert report.close_broken == frozenset({"USDT"})
    assert report.ccys_interior_broken == 0


# ---------------------------------------------------------------------------
# Task 3: the diagnostic classifies the close exactly as the oracle does
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("rows", "cash"),
    [pytest.param(rows, cash, id=world_id) for world_id, rows, cash, _expected in _CLOSE_WORLDS],
)
def test_the_diagnostic_classifies_the_close_exactly_as_the_oracle(
    rows: list[tuple[str, str]], cash: str
) -> None:
    """The next probe reading names the arm the oracle fired (D-03). If the diagnostic kept an
    exact close while the oracle accepts one within a trillionth, a4's reading would say the close
    is broken for an account whose refusal came from somewhere else, and the founder would
    chase the wrong arm. Every close world goes through both and the two must agree."""
    bills = _chain(rows)
    cash_map = {"USDT": Decimal(cash)}
    try:
        obal.per_ccy_opening(bills, cash_map)
        oracle_breaks = False
    except obal.OpeningUnavailable as exc:
        assert exc.reason == "chain_break"
        oracle_breaks = True

    report = chain.analyse_chain(bills, cash_map)

    assert ("USDT" in report.close_broken) is oracle_breaks


def test_an_interior_break_beside_a_close_inside_the_allowance_reads_interior_not_both() -> None:
    """The oracle refuses on the interior link here; its close is inside 1e-12 relative. The
    record must say ``interior``. Reading ``both`` would send the founder looking
    at a close that the oracle itself accepts (the arm ``diverged`` check in the chain record
    depends on the diagnostic sharing the oracle's close rule)."""
    bills = _chain([("99.50", "0"), ("100.50", "5.00")])
    cash_map = {"USDT": Decimal("100.5000000000001")}
    with pytest.raises(obal.OpeningUnavailable) as raised:
        obal.per_ccy_opening(bills, cash_map)
    assert raised.value.reason == "chain_break"

    report = chain.analyse_chain(bills, cash_map)

    assert rec.chain_values(report)["chain_arm"] == "interior"
    assert report.ccys_close_broken == 0


def test_a_close_cleared_within_a_trillionth_by_the_post_walk_read_counts_in_matches_after() -> None:
    """The close race asks whether the cash balance merely moved while the walk paged. A later
    read within 1e-12 of the newest bill clears the close exactly as the oracle would, so it
    must count; a later read that is merely close (100.504 against 100.50) does not clear it,
    as the oracle would not."""
    bills = _chain([("100.50", "0")])
    report = chain.analyse_chain(bills, {"USDT": Decimal("100.40")})
    assert report.close_broken == frozenset({"USDT"})

    cleared = chain.close_race(report, {"USDT": Decimal("100.40")}, {"USDT": Decimal("100.5000000000001")})
    near = chain.close_race(report, {"USDT": Decimal("100.40")}, {"USDT": Decimal("100.504")})

    assert cleared.matches_after == 1
    assert cleared.cash_moved == 1
    assert near.matches_after == 0
    assert near.cash_moved == 1
