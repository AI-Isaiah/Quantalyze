"""Phase 167.2.1.1.1 NAVMTM plan 17 - an allocated-capital composite's Deribit member follows its key's marked NAV (SC-2, D-14).

What these pin, and why each can fail
-------------------------------------
D-14 (founder 2026-10-26, "Apply marks to them too"): from its first mark, an allocated-capital
strategy's returns follow its key's marked NAV, like every other strategy. A composite whose
``returns_denominator_config`` is set returns allocated-capital P&L for its DERIBIT member (the
selector ``_member_returns_are_allocated``): P&L over scheduled capital, not NAV changes, so the
base the first mark is measured against cannot be rolled back through the returns, and the member's
OWN allocated ledger dropped the net-extraction spot legs (Bug B). Plan 16 does this for a single
allocated strategy; this module pins the same rule for the composite member: the base comes from the
NAV TWIN of the member's own crawl (plan 13), rolled by the day P&L (``roll_basis="day_pnl"``).

The harness runs the REAL ``run_stitch_composite_job`` over a faked supabase and faked venue reads
(plan 09's harness). The three ledger helpers answer by LEDGER IDENTITY, so a base taken from the
allocated ledger is a different number, not the same one by coincidence. Every expected number is
a literal typed beside its arithmetic; the oracles are the stored marks, the fake ledgers and the
test's own arithmetic, never ``apply_marks`` or the job.

The job's clock is frozen at 00:10:30Z of the day after the day it labels (``at_0010``).
"""
from __future__ import annotations

import dataclasses
import logging
from contextlib import ExitStack
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.deribit_ingest import CompletenessReport
from services.external_flows import FlowInstant
from services.job_worker import DispatchOutcome, run_stitch_composite_job
from services.nav_marks import StoredMark
from tests.test_nav_marks_composite import (
    _CONFIG,
    M1_FULL,
    Run,
    day_series,
    stored,
)
from tests.test_flow_price_store import FlowPricesTable, route_flow_prices
from tests.test_nav_marks_derive_apply import (
    assert_flow_index_refusal_copy,
    at_0010,
    candles,
    scripted_chart,
)
from tests.test_stitch_composite_job import (
    _STRATEGY_ID,
    _FakeSupabase,
    _ctx,
    _deribit_patches,
    _member,
    _stub_ledger,
)

TOKEN = "mark_allocated_nav_unreconciled"

#: Member 1 (key-1) is windowed [2026-01-01, 2026-03-01) and holds M1_FULL (02-26 .. 02-28);
#: member 2 (key-2) is windowed [2026-03-01, open) and is the one with marks.
WINDOWS = [("2026-01-01", "2026-03-01"), ("2026-03-01", None)]

#: The allocated-capital returns member 2's combiner yields: one row per day 03-01 .. 03-07.
#: The numbers are arbitrary; the apply keeps every day before the first mark verbatim.
ALLOCATED = {
    "2026-03-01": 0.010, "2026-03-02": -0.004, "2026-03-03": 0.002, "2026-03-04": 0.006,
    "2026-03-05": -0.001, "2026-03-06": 0.003, "2026-03-07": 0.0007,
}
PRE_MARK = {d: v for d, v in ALLOCATED.items() if d <= "2026-03-05"}


@dataclass(frozen=True)
class Levels:
    """What the three ledger helpers return for one ledger: the realized terminal ``(day,
    level)``, the day P&L and the composed flows, by ISO day."""

    terminal: tuple[str, float] | None
    pnl: dict[str, float]
    flows: dict[str, float]


#: The NAV TWIN's levels. Realized terminal 2000.0 on 03-07 with day P&L 5.0 (03-07) and 20.0
#: (03-06) and a 100.0 deposit on 03-06, so by the roll L(d-1) = L(d) - P_d - F_d:
#: L(03-05) = 2000.0 - 5.0 - 20.0 - 100.0 = 1875.0.
TWIN = Levels(("2026-03-07", 2000.0), {"2026-03-06": 20.0, "2026-03-07": 5.0}, {"2026-03-06": 100.0})
#: The ALLOCATED ledger's levels: the net-extraction legs it dropped make its 03-06 P&L 150.0
#: larger. A base rolled from THESE is 2000.0 - 5.0 - 170.0 - 100.0 = 1725.0, which is wrong.
ALLOC = Levels(("2026-03-07", 2000.0), {"2026-03-06": 170.0, "2026-03-07": 5.0}, {"2026-03-06": 100.0})

R_0306 = (1900.0 - 1875.0 - 100.0) / 1875.0  # -0.04
R_0307 = (1910.0 - 1900.0) / 1900.0
#: D-24. The W2 tail row 03-08 is the allocated row 0.0123 with the last mark's open profit
#: reversed: that mark (03-07) has NAV 1910.0 and open profit -90.0.
R_TAIL_0308 = 1.0123 * (1910.0 + 90.0) / 1910.0 - 1.0
#: The first mark's wallet is the twin's realized level on 03-06: 2000.0 less 03-07's day P&L 5.0 =
#: 1995.0, so its open profit is 1900.0 - 1995.0. The base is then 1995.0 - 20.0 - 100.0 = 1875.0.
MARKS = [
    stored("2026-03-06", 1900.0, venue="deribit", open_pnl=-95.0),
    stored("2026-03-07", 1910.0, venue="deribit", open_pnl=-90.0),
]


def config(*, mandate_end: str | None = None, cumulative: str = "simple") -> dict[str, Any]:
    cfg: dict[str, Any] = dict(_CONFIG, cumulative_method=cumulative)
    if mandate_end is not None:
        cfg["mandate_end"] = mandate_end
    return cfg


def _series_of(levels: Levels, kind: str) -> pd.Series:
    values = levels.pnl if kind == "pnl" else levels.flows
    return pd.Series(
        list(values.values()), index=pd.DatetimeIndex(list(values)), dtype="float64"
    )


@dataclass
class AllocatedRun:
    run: Run
    #: one entry per ``build_deribit_native_ledger`` call: the ``nav_twin`` it was given
    builds: list[dict[str, Any]]
    #: the number of times each ledger helper was called
    helper_calls: list[str]

    @property
    def cash_builds(self) -> list[bool]:
        """The ``nav_twin`` request of each CASH-pass member build (the first two calls)."""
        return [b["nav_twin"] for b in self.builds[:2]]


async def run_allocated_composite(
    *,
    marks: dict[str, list[StoredMark]] | None = None,
    cfg: dict[str, Any] | None = None,
    now_day: str = "2026-03-08",
    member2: dict[str, float] | None = None,
    twin: Levels | None = TWIN,
    twin_error: str | None = None,
    twin_error_seq: int = 2,
    helper_raises: Exception | None = None,
    extra_patches: list[Any] | None = None,
    twin_instants: tuple[FlowInstant, ...] = (),
    ledger_marks: dict[str, pd.Series] | None = None,
    chart: Any = None,
    flow_prices: FlowPricesTable | None = None,
) -> AllocatedRun:
    """Run the real composite job over two Deribit members of a composite WITH a config.

    ``twin`` is the NAV twin's levels, attached to every member's report except member
    ``twin_error_seq``'s when ``twin_error`` is set: that member's build failed, its report carries
    no twin and ``twin_error`` names the class (``twin=None``: no member gets a twin). The faked combiner yields
    each member's allocated series in call order: cash m1, cash m2, then mtm m1, mtm m2.

    Phase 177 (DERIBITFLOWS plan 06) keywords, all defaulting to the harness as it was:
    ``twin_instants`` and ``ledger_marks`` are the NAV twin's raw flow instants and per-currency
    day marks (what ``native_flow_instants`` values a non-USD instant at on its own day);
    ``chart`` is the scripted ``get_tradingview_chart_data`` of member 2's exchange, and member 2's
    exchange close is recorded in its ``events`` as ``"close"``; ``flow_prices`` is the in-memory
    ``api_key_flow_prices``, routed on every member."""
    members = [_member(i + 1, ws, we) for i, (ws, we) in enumerate(WINDOWS)]
    strategy_row = {
        "id": _STRATEGY_ID, "asset_class": "crypto",
        "returns_denominator_config": cfg if cfg is not None else config(),
    }
    fake = _FakeSupabase(members=members, strategy_row=strategy_row)
    ctxs: dict[str, MagicMock] = {}
    seq_by_exchange: dict[int, int] = {}
    for m in members:
        c = _ctx("deribit")
        c.key_row = {"id": m["api_key_id"], "user_id": "owner-1", "exchange": "deribit"}
        if chart is not None and m["api_key_id"] == "key-2":
            c.exchange.public_get_get_tradingview_chart_data = chart
        if flow_prices is not None:
            c.supabase.table.side_effect = lambda _name: MagicMock()
            route_flow_prices(c, flow_prices)
        ctxs[m["api_key_id"]] = c
        seq_by_exchange[id(c.exchange)] = int(m["seq"])

    async def _preflight(member_job: dict[str, Any], _caller: str) -> MagicMock:
        return ctxs[member_job["api_key_id"]]

    served = marks or {}
    builds: list[dict[str, Any]] = []
    helper_calls: list[str] = []
    twin_ledgers: list[Any] = []
    alloc_ledger = _stub_ledger()

    async def _build(exchange: Any, *, account_state: Any, pnl_basis: str,
                     exclude_spot_extraction: bool, nav_twin: bool = False) -> Any:
        builds.append({"nav_twin": nav_twin, "exclude_spot_extraction": exclude_spot_extraction})
        report = CompletenessReport(
            total_return_rows=2, indexable_currencies=frozenset({"BTC"}), has_option_activity=False,
        )
        if nav_twin:
            if seq_by_exchange.get(id(exchange)) == twin_error_seq and twin_error is not None:
                report.nav_twin_error = twin_error
            elif twin is not None:
                twin_ledger = dataclasses.replace(
                    alloc_ledger,
                    **({"flow_instants": twin_instants} if twin_instants else {}),
                    **({"marks": ledger_marks} if ledger_marks is not None else {}),
                )
                twin_ledgers.append(twin_ledger)
                report.nav_twin_ledger = twin_ledger
        return alloc_ledger, report

    def _is_twin(ledger: Any) -> bool:
        return any(ledger is t for t in twin_ledgers)

    def _levels(ledger: Any) -> Levels:
        return (twin if twin is not None else TWIN) if _is_twin(ledger) else ALLOC

    def _pnl(ledger: Any, _indexable: Any) -> pd.Series:
        helper_calls.append("pnl")
        if helper_raises is not None and _is_twin(ledger):
            raise helper_raises
        return _series_of(_levels(ledger), "pnl")

    def _flows(ledger: Any, _indexable: Any) -> pd.Series:
        helper_calls.append("flows")
        return _series_of(_levels(ledger), "flows")

    cash_m1, cash_m2 = day_series(M1_FULL), day_series(member2 if member2 is not None else ALLOCATED)
    mtm_m1 = day_series({d: v * 2.0 for d, v in M1_FULL.items()})
    mtm_m2 = day_series({d: v * 2.0 for d, v in (member2 or ALLOCATED).items()})
    patches = [
        *_deribit_patches(
            fake,
            combine_returns=[(cash_m1, {}), (cash_m2, {}), (mtm_m1, {}), (mtm_m2, {})],
            has_option_activity=False,
        ),
        patch("services.deribit_ingest.build_deribit_native_ledger", new=AsyncMock(side_effect=_build)),
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(side_effect=_preflight)),
        patch(
            "services.job_worker.read_key_marks",
            new=MagicMock(side_effect=lambda _sb, key_id: list(served.get(key_id, []))),
        ),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010(now_day))),
        patch("services.broker_dailies.native_ledger_day_pnl", new=MagicMock(side_effect=_pnl)),
        patch("services.broker_dailies.native_ledger_composed_flows", new=MagicMock(side_effect=_flows)),
        *(
            [patch(
                "services.deribit_flow_prices.db_execute",
                new=AsyncMock(side_effect=lambda fn: fn()),
            )] if flow_prices is not None else []
        ),
        *(
            [patch(
                "services.job_worker.aclose_exchange",
                new=AsyncMock(side_effect=lambda ex: chart.events.append("close")
                              if ex is ctxs["key-2"].exchange else None),
            )] if chart is not None else []
        ),
        *(extra_patches or []),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    return AllocatedRun(Run(result, fake, []), builds, helper_calls)


# --------------------------------------------------------------------------------------
# Task 1 - the tracer
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_allocated_composite_deribit_member_follows_marked_nav() -> None:
    """Member 2 of an open-mandate allocated composite has stored marks 03-06 (1900.0) and 03-07
    (1910.0); its NAV twin's realized terminal is (03-07, 2000.0), day P&L {03-06: 20.0,
    03-07: 5.0}, composed flows {03-06: 100.0}.

    The base is L(03-05) = 2000.0 - 5.0 - 20.0 - 100.0 = 1875.0. Rows 03-01 .. 03-05 are the
    allocated returns exactly; r(03-06) = (1900.0 - 1875.0 - 100.0) / 1875.0 = -0.04 (the deposit
    is in the numerator) and r(03-07) = (1910.0 - 1900.0) / 1900.0. The allocated 03-06 and 03-07
    rows (0.003 and 0.0007) are NOT written. Member 1 (no marks) is its series verbatim. The cash
    pass asked for the twin for both members."""
    out = await run_allocated_composite(marks={"key-2": MARKS})
    run = out.run
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert {d: v for d, v in rows.items() if d <= "2026-02-28"} == M1_FULL
    assert {d: v for d, v in rows.items() if "2026-03-01" <= d <= "2026-03-05"} == PRE_MARK
    assert rows["2026-03-06"] == pytest.approx(-0.04, abs=1e-12)
    assert rows["2026-03-06"] == pytest.approx(R_0306, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)
    assert sorted(rows) == [*M1_FULL, *PRE_MARK, "2026-03-06", "2026-03-07"]
    # Bug B: a base taken from the allocated ledger's levels would be 1725.0.
    from_allocated_ledger = (1900.0 - 1725.0 - 100.0) / 1725.0
    assert rows["2026-03-06"] != pytest.approx(from_allocated_ledger, abs=1e-6)
    assert out.cash_builds == [True, True], "the cash pass asked each member for the twin"
    assert all(b["exclude_spot_extraction"] for b in out.builds)
    assert [b["nav_twin"] for b in out.builds[2:]] == [False, False], "the mtm pass asks for none"
    assert run.flags()["marks_since"] == "2026-03-06"


@pytest.mark.asyncio
async def test_closed_mandate_composite_builds_no_twin() -> None:
    """The mandate ended 2026-02-15, before the day this run labels (03-07), and no member key has
    a stored mark: no twin is requested, no ledger helper and no ``apply_marks`` is ever called,
    and the persisted rows are the members' allocated series verbatim, with no mark in the flags."""
    with patch("services.job_worker.apply_marks", side_effect=AssertionError("apply_marks was called")):
        out = await run_allocated_composite(cfg=config(mandate_end="2026-02-15"))
    run = out.run
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert out.cash_builds == [False, False]
    assert out.helper_calls == []
    assert run.csv_rows() == {**M1_FULL, **ALLOCATED}
    for key in ("marks_since", "mark_gap_days"):
        assert key not in run.flags()


@pytest.mark.asyncio
async def test_composite_member_mandate_tail_is_kept() -> None:
    """W2. mandate_end 2026-03-08 is not a marked day: the marks on 03-06 and 03-07 are inside the
    window and the mark on 03-09 is outside it. The run is on 03-10 (it labels 03-09), so the
    window has CLOSED: no later in-window mark will ever cover 03-08, so the member's allocated
    row for it (0.0123) is kept with the 03-07 mark's open profit reversed on it (D-24: NAV 1910.0
    and open profit -90.0 give 1.0123 * 2000 / 1910 - 1), nothing is invented for 03-09, and rows
    03-06 and 03-07 are the marked returns.

    While the window is still OPEN (the run is on 03-08 and labels 03-07, before mandate_end) the
    next mark covers 03-08, so no row exists after the last mark."""
    allocated = {**ALLOCATED, "2026-03-08": 0.0123}
    marks = [*MARKS, stored("2026-03-09", 1920.0, venue="deribit")]
    closed = await run_allocated_composite(
        marks={"key-2": marks}, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-10",
        member2=allocated,
    )
    assert closed.run.result.outcome == DispatchOutcome.DONE, closed.run.result.error_message
    rows = closed.run.csv_rows()
    assert {d: v for d, v in rows.items() if d >= "2026-03-01"} == {
        **PRE_MARK, "2026-03-06": pytest.approx(R_0306), "2026-03-07": pytest.approx(R_0307),
        "2026-03-08": pytest.approx(R_TAIL_0308),
    }
    assert "2026-03-09" not in rows

    still_open = await run_allocated_composite(
        marks={"key-2": MARKS}, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-08",
        member2=allocated,
    )
    assert still_open.run.result.outcome == DispatchOutcome.DONE, still_open.run.result.error_message
    assert max(still_open.run.csv_rows()) == "2026-03-07"


@pytest.mark.asyncio
async def test_marks_after_mandate_end_are_not_applied_to_the_member() -> None:
    """MEDIUM-2 (T-167.2.1.1.1-46). Marks on 03-06, 03-07 and 03-08. mandate_end 2026-03-07: only
    the first two apply, and no row exists after 03-07. mandate_end 2026-03-05 (the window closed
    before the first mark): no mark is inside it, so the member is its allocated series verbatim,
    no twin was asked for, and the flags say nothing about marks."""
    marks = [*MARKS, stored("2026-03-08", 1920.0, venue="deribit")]
    inside = await run_allocated_composite(
        marks={"key-2": marks}, cfg=config(mandate_end="2026-03-07"), now_day="2026-03-09",
    )
    assert inside.run.result.outcome == DispatchOutcome.DONE, inside.run.result.error_message
    rows = inside.run.csv_rows()
    assert max(rows) == "2026-03-07", "no row after mandate_end"
    assert rows["2026-03-06"] == pytest.approx(R_0306, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)

    before = await run_allocated_composite(
        marks={"key-2": marks}, cfg=config(mandate_end="2026-03-05"), now_day="2026-03-09",
        member2=PRE_MARK,
    )
    assert before.run.result.outcome == DispatchOutcome.DONE, before.run.result.error_message
    assert before.run.csv_rows() == {**M1_FULL, **PRE_MARK}
    assert before.cash_builds == [False, False]
    assert "marks_since" not in before.run.flags()


@pytest.mark.asyncio
async def test_simple_sum_rule_for_the_composite() -> None:
    """The simple-sum rule (NAVMTM D-14). The composite keeps its configured cumulative_method
    'simple' and the headline cumulative return is the SUM of every persisted row (member 1's
    three rows 0.010 - 0.004 + 0.006 = 0.012, member 2's five allocated rows 0.013, the marked
    -0.04 and 10 / 1900), and it differs from the compounded figure on the same rows."""
    out = await run_allocated_composite(marks={"key-2": MARKS})
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    rows = out.run.csv_rows()
    summed = 0.012 + 0.013 + (-0.04) + 10.0 / 1900.0
    compounded = 1.0
    for value in rows.values():
        compounded *= 1.0 + value
    compounded -= 1.0
    head = out.run.headline()
    assert head is not None
    cumulative = head["metrics_json_by_basis"]["cash_settlement"]["cumulative_return"]
    assert sum(rows.values()) == pytest.approx(summed, abs=1e-12)
    assert abs(compounded - summed) > 1e-5, "the fixture must tell the two rules apart"
    assert cumulative == pytest.approx(summed, abs=1e-9)
    assert cumulative != pytest.approx(compounded, abs=1e-6)


# --------------------------------------------------------------------------------------
# Task 2 - W1 both ways, the L3 refusals
# --------------------------------------------------------------------------------------

REFUSAL = f"run_stitch_composite_job: nav marks refused (seq=2, {TOKEN})"


@pytest.mark.asyncio
async def test_allocated_member_twin_unbuildable_without_marks_is_stitched_as_today(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """W1 (a), T-167.2.1.1.1-59. Member 2's twin could not be built (``nav_twin_error``
    'LedgerValuationError') and no member key has a stored mark: there is nothing to apply, so
    the composite persists exactly the rows, headline and flags of a run whose twin was fine and
    that has no marks, and ONE log line names ``nav_twin_unbuildable``, the seq and the class."""
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    out = await run_allocated_composite(twin_error="LedgerValuationError")
    run = out.run
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    lines = [r.getMessage() for r in caplog.records if "nav_twin_unbuildable" in r.getMessage()]
    assert len(lines) == 1 and "seq=2" in lines[0] and "LedgerValuationError" in lines[0], lines
    base = await run_allocated_composite()
    assert base.run.result.outcome == DispatchOutcome.DONE, base.run.result.error_message
    assert run.csv_rows() == base.run.csv_rows() == {**M1_FULL, **ALLOCATED}
    assert run.flags() == base.run.flags()
    assert run.headline() == base.run.headline()


def _assert_refused_and_wrote_nothing(run: Run) -> None:
    result = run.result
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert result.error_message == REFUSAL
    assert not run.wrote_anything_but_a_failed_stamp()
    assert run.headline() is None
    stamps = [p for t, p, _c in run.fake.upserts if t == "strategy_analytics"]
    assert len(stamps) == 1 and stamps[0]["computation_status"] == "failed"
    assert "degraded_members" not in stamps[0].get("data_quality_flags", {})
    copy = stamps[0]["computation_error"]
    assert not any(ch.isdigit() for ch in copy), copy
    for amount in ("1900", "1910", "1875", "2000"):
        assert amount not in result.error_message


@pytest.mark.asyncio
async def test_allocated_member_twin_unbuildable_with_marks_refuses_the_composite() -> None:
    """W1 (b), L3, T-167.2.1.1.1-48. The same twin failure with a stored in-window mark to apply:
    FAILED permanent naming ``mark_allocated_nav_unreconciled`` and the member seq, and nothing
    written but the failed stamp (no csv row, headline or flags)."""
    out = await run_allocated_composite(
        marks={"key-2": MARKS}, twin_error="LedgerValuationError"
    )
    _assert_refused_and_wrote_nothing(out.run)


@pytest.mark.asyncio
async def test_allocated_member_section5_refusal_refuses_the_composite() -> None:
    """L3. The twin exists but its ``native_ledger_day_pnl`` raises
    ``InceptionReconciliationError`` (the twin cannot pass section 5 either). With a stored
    in-window mark that is the same named refusal and the same nothing-written."""
    from services.native_nav import InceptionReconciliationError

    out = await run_allocated_composite(
        marks={"key-2": MARKS},
        helper_raises=InceptionReconciliationError(
            currencies=["BTC"], venue="deribit", breach_ratio=3.0
        ),
    )
    _assert_refused_and_wrote_nothing(out.run)


@pytest.mark.asyncio
async def test_allocated_member_mark_outside_its_window_cannot_refuse_the_composite() -> None:
    """Member 1's window closed on 03-01, so a mark of ITS key dated 03-06 can change nothing the
    window shows and must not refuse the composite even though its twin cannot be built (plan 09's
    rule for a closed window, kept for the allocated member)."""
    out = await run_allocated_composite(
        marks={"key-1": [stored("2026-03-06", 1900.0, venue="deribit")]},
        twin_error="LedgerValuationError", twin_error_seq=1,
    )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    assert out.run.csv_rows() == {**M1_FULL, **ALLOCATED}


@pytest.mark.asyncio
async def test_an_allocated_member_that_stops_getting_marks_is_named_unless_its_mandate_closed() -> None:
    """SFH round 2 N2, the allocated twin. The member's marks end at 03-07. The run on 03-10 labels
    03-09: with the mandate still open the composite names 2026-03-08 as the first day without a
    row; once the mandate has closed (mandate_end 03-08) the member keeps its tail (D-24) and the
    composite names nothing."""
    allocated = {**ALLOCATED, "2026-03-08": 0.0123}
    open_run = await run_allocated_composite(
        marks={"key-2": MARKS}, cfg=config(), now_day="2026-03-10", member2=allocated,
    )
    assert open_run.run.result.outcome == DispatchOutcome.DONE, open_run.run.result.error_message
    assert open_run.run.flags()["marks_trailing_since"] == "2026-03-08"

    closed = await run_allocated_composite(
        marks={"key-2": MARKS}, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-10",
        member2=allocated,
    )
    assert closed.run.result.outcome == DispatchOutcome.DONE, closed.run.result.error_message
    assert "marks_trailing_since" not in closed.run.flags()


@pytest.mark.asyncio
async def test_a_member_rotated_out_under_an_open_mandate_is_not_named_as_paused() -> None:
    """REVIEW-3 WR-01. Member 1 is windowed [01-01, 03-01) and the mandate is OPEN (no
    mandate_end). Its marks reach 02-28, the last day of its window, and member 2's marks reach
    03-07, the day this run labels. A closed member window is closed whatever the mandate does, so
    nothing is paused and the composite publishes no ``marks_trailing_since``."""
    key1_marks = [stored("2026-02-27", 1000.0, venue="deribit"),
                  stored("2026-02-28", 1001.0, venue="deribit")]
    out = await run_allocated_composite(
        marks={"key-1": key1_marks, "key-2": MARKS}, cfg=config(), now_day="2026-03-08",
    )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    assert "marks_trailing_since" not in out.run.flags()


@pytest.mark.asyncio
async def test_a_member_rotated_out_under_an_open_mandate_keeps_its_tail_to_its_window_end() -> None:
    """REVIEW-3 WR-01, the tail half. Member 1's marks stop at 02-26, two days before the end of
    its window, and the mandate is OPEN. Nothing later can cover its days after the last mark, so
    member 1 keeps its own realized rows for 02-27 and 02-28 verbatim, with the 02-26 mark's open
    profit reversed on the first of them (D-24: NAV 1000.0 and open profit 50.0 give
    0.996 * 950 / 1000 - 1 for 02-27, where the allocated row is -0.004)."""
    key1_marks = [stored("2026-02-26", 1000.0, venue="deribit", open_pnl=50.0)]
    out = await run_allocated_composite(
        marks={"key-1": key1_marks, "key-2": MARKS}, cfg=config(), now_day="2026-03-08",
    )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    rows = out.run.csv_rows()
    assert rows["2026-02-27"] == pytest.approx(0.996 * 950.0 / 1000.0 - 1.0)
    assert rows["2026-02-28"] == pytest.approx(0.006)


# --------------------------------------------------------------------------------------
# Phase 177 DERIBITFLOWS plan 06 - the allocated member's NAV twin counts a moved flow at its candle open
# --------------------------------------------------------------------------------------


def _ms(*args: int) -> int:
    import datetime as dt

    return int(dt.datetime(*args, tzinfo=dt.timezone.utc).timestamp() * 1000)


#: The twin's levels as TWIN, plus a 0.0002 BTC deposit on 03-08 (own-day amount 21.0).
TWIN_MOVED = Levels(
    ("2026-03-07", 2000.0), {"2026-03-06": 20.0, "2026-03-07": 5.0},
    {"2026-03-06": 100.0, "2026-03-08": 21.0},
)
_MOVED_MARKS = [
    stored("2026-03-06", 1900.0, venue="deribit", open_pnl=-95.0),
    stored("2026-03-07", 1930.1, venue="deribit", open_pnl=-69.9),
]
_MOVED_MINUTE = _ms(2026, 3, 8, 0, 5)
_MOVED_INSTANTS = (FlowInstant(_ms(2026, 3, 8, 0, 5, 20), "2026-03-08", 0.0002, "BTC"),)
_MOVED_LEDGER_MARKS = {"BTC": day_series({"2026-03-07": 100_000.0, "2026-03-08": 105_000.0})}
_MOVED_CANDLES = candles(
    (_MOVED_MINUTE - 60_000, 100_400.0), (_MOVED_MINUTE, 100_500.0), (_MOVED_MINUTE + 60_000, 100_600.0),
)


async def run_allocated_moved(chart: Any, table: FlowPricesTable, **kw: Any) -> AllocatedRun:
    return await run_allocated_composite(
        marks={"key-2": _MOVED_MARKS}, twin=TWIN_MOVED, twin_instants=_MOVED_INSTANTS,
        ledger_marks=_MOVED_LEDGER_MARKS, chart=chart, flow_prices=table, **kw,
    )


@pytest.mark.asyncio
async def test_allocated_member_moved_btc_flow_priced_at_the_instant_price() -> None:
    """Phase 177 D-04 on an allocated composite member, with the member's EXACT marks. The NAV
    twin of key-2 carries a 0.0002 BTC deposit at 00:05:20Z on 03-08, before the 00:10Z read of the
    03-07 mark (NAV 1930.1), so it is inside that mark's wallet. The twin's own-day mark for 03-08
    is 105000.0 (0.0002 x 105000.0 = 21.0, the composed flow of 03-08). It is COUNTED in 03-07 at the
    open of the 1-minute BTC_USDC-PERPETUAL candle that contains it (00:05, open 100500.0; 00:04
    and 00:06 open 100400.0 and 100600.0):
      counted in 03-07:  0.0002 x 100500.0 = 20.1
      r(03-07) = (1930.1 - 1900.0 - 20.1) / 1900.0 = 10.0 / 1900.0
    where own-day pricing counts 21.0 and stores 9.1 / 1900.0. r(03-06) = (1900.0 - 1875.0 - 100.0)
    / 1875.0 = -0.04 is unchanged. The read is made while the member's exchange is open."""
    table = FlowPricesTable()
    chart = scripted_chart(_MOVED_CANDLES)()
    out = await run_allocated_moved(chart, table)
    run = out.run
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-03-07"] == pytest.approx(10.0 / 1900.0, abs=1e-12)
    assert rows["2026-03-06"] == pytest.approx(-0.04, abs=1e-12)
    assert len(chart.calls) == 1
    assert chart.events.index("chart") < chart.events.index("close"), "read on an open exchange"
    assert table.prices("key-2") == {("BTC_USDC-PERPETUAL", _MOVED_MINUTE): 100_500.0}


@pytest.mark.asyncio
async def test_allocated_member_moved_flow_no_data_refuses_the_composite() -> None:
    """D-05, T-177-24. The oracle's scenario with the chart answering ``no_data``. The allocated
    member's moved BTC deposit has no price, so it is NOT counted at the own-day 21.0 (the composite
    would be DONE with 9.1 / 1900.0): the composite refuses by name, permanent, and persists nothing
    but the failed stamp. One chart call (a structural answer is not retried). The shared
    ``_assert_refused_and_wrote_nothing`` pins the other token, so the same shape is stated here."""
    table = FlowPricesTable()
    chart = scripted_chart({"result": {"status": "no_data"}})()
    out = await run_allocated_moved(chart, table)
    run = out.run
    assert run.result.outcome == DispatchOutcome.FAILED
    assert run.result.error_kind == "permanent"
    assert run.result.error_message == (
        "run_stitch_composite_job: nav marks refused (seq=2, mark_flow_index_unavailable)"
    )
    assert not run.wrote_anything_but_a_failed_stamp()
    assert run.headline() is None
    stamps = [p for t, p, _c in run.fake.upserts if t == "strategy_analytics"]
    assert len(stamps) == 1 and stamps[0]["computation_status"] == "failed"
    assert_flow_index_refusal_copy(stamps[0]["computation_error"])
    assert len(chart.calls) == 1
    assert table.rows == {}


@pytest.mark.asyncio
async def test_allocated_member_flows_moved_log(caplog: pytest.LogCaptureFixture) -> None:
    """D-01, composites, the allocated member. The oracle's scenario (one BTC deposit moved into
    the 03-07 mark, the last) logs one counts-only INFO line beside the member's applied line:
    moved=1 at_instant=1 usd_family=0 on_last_mark=1. A member with no flow instant logs the same
    line at zero. No key id, amount, minute or instrument."""
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        out = await run_allocated_moved(scripted_chart(_MOVED_CANDLES)(), FlowPricesTable())
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    prefix = "run_stitch_composite_job: deribit flows moved by marks"
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith(prefix)]
    assert lines == [f"{prefix} (seq=2 moved=1 at_instant=1 usd_family=0 on_last_mark=1)"]

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        zero = await run_allocated_composite(marks={"key-2": MARKS})
    assert zero.run.result.outcome == DispatchOutcome.DONE, zero.run.result.error_message
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith(prefix)]
    assert lines == [f"{prefix} (seq=2 moved=0 at_instant=0 usd_family=0 on_last_mark=0)"]
    assert not any("key-" in line for line in lines)
